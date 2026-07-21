import fs from "fs";
import JSZip from "jszip";
import { zodResponseFormat } from "openai/helpers/zod";
import { openai, REASONING_MODEL } from "../openai";
import { AnastasisProductSpec } from "../spec/schema";
import type { ProgressEmitter } from "./events";

const SAMPLE_ROWS = 5;

const MATCH_PROMPT = `You are the "match" stage of Anastasis. You receive:
1. A draft AnastasisProductSpec derived from watching a screen recording.
2. A summary of the user's data export: for each file, its name, column headers, a few sample rows, and the total data row count.

Produce the FINAL spec by cross-checking the two:

- For each spec field that matches an export column: provenance stays "confirmed". Keep the field name aligned with the export column name (snake_case).
- For each export column with NO on-screen evidence in the draft spec: add it to the entity with provenance "data_only" (it must be stored but never rendered).
- For each spec field with NO matching export column: set provenance "ui_only" and set "default" to a sensible derivation.
- Build migration_plan: one entry per entity, with source_file, a field_map entry per target field that comes from the export (transform is "copy" unless a conversion is clearly needed), and row_count_expected set EXACTLY to the data row count reported for that file.
- Keep views, workflows, and excluded from the draft unless the export contradicts them.
- If an export file corresponds to a feature in "excluded" (e.g. it was never used on screen), still include its entity and migration entry so the data is preserved, but do NOT add views for it.
- Record any unresolved ambiguity in open_questions.

Do not invent columns, files, or counts.`;

type ExportSummary = {
  files: {
    name: string;
    headers: string[];
    sampleRows: string[][];
    rowCount: number;
  }[];
};

/** Parses a CSV file's text into rows (handles quoted fields). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Reads the export ZIP and summarizes each CSV/JSON file inside it. */
export async function summarizeExport(zipPath: string): Promise<ExportSummary> {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Export ZIP not found: ${zipPath}`);
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const files: ExportSummary["files"] = [];

  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (name.endsWith(".csv")) {
      const rows = parseCsv(await entry.async("text"));
      files.push({
        name,
        headers: rows[0] ?? [],
        sampleRows: rows.slice(1, 1 + SAMPLE_ROWS),
        rowCount: Math.max(rows.length - 1, 0),
      });
    } else if (name.endsWith(".json")) {
      const data = JSON.parse(await entry.async("text"));
      const records: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
      const headers = records[0] ? Object.keys(records[0]) : [];
      files.push({
        name,
        headers,
        sampleRows: records
          .slice(0, SAMPLE_ROWS)
          .map((r) => headers.map((h) => String(r[h] ?? ""))),
        rowCount: records.length,
      });
    }
  }
  return { files };
}

/**
 * Cross-checks the draft spec against the export ZIP and returns the
 * final spec with provenance and migration_plan filled in.
 */
export async function match(
  draftSpec: AnastasisProductSpec,
  zipPath: string,
  emit: ProgressEmitter
): Promise<AnastasisProductSpec> {
  emit("match", "Opening your data export...");
  const summary = await summarizeExport(zipPath);
  for (const f of summary.files) {
    emit("match", `Found ${f.name}: ${f.rowCount} rows, columns: ${f.headers.join(", ")}.`);
  }

  emit("match", "Lining your data up with what I saw on screen...");
  const response = await openai.beta.chat.completions.parse({
    model: REASONING_MODEL,
    messages: [
      { role: "system", content: MATCH_PROMPT },
      {
        role: "user",
        content: `DRAFT SPEC:\n${JSON.stringify(draftSpec, null, 2)}\n\nEXPORT SUMMARY:\n${JSON.stringify(summary, null, 2)}`,
      },
    ],
    response_format: zodResponseFormat(AnastasisProductSpec, "product_spec"),
  });

  const spec = response.choices[0].message.parsed;
  if (!spec) {
    throw new Error("Match stage returned no parseable spec");
  }

  const totalFields = spec.entities.reduce((n, e) => n + e.fields.length, 0);
  const confirmed = spec.entities.reduce(
    (n, e) => n + e.fields.filter((f) => f.provenance === "confirmed").length,
    0
  );
  emit("match", `Matched ${confirmed} of ${totalFields} data fields to the screen recording.`);
  for (const plan of spec.migration_plan) {
    emit("match", `Will migrate ${plan.row_count_expected} ${plan.entity} record(s) from ${plan.source_file}.`);
  }
  return spec;
}
