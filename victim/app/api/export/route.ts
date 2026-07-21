import { NextResponse } from "next/server";
import JSZip from "jszip";
import db, { Task, Tag } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvEscape(value: string | null): string {
  if (value === null) return "";
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(headers: string[], rows: (string | null)[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

export async function GET() {
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY created_at").all() as Task[];
  const tags = db.prepare("SELECT * FROM tags ORDER BY name").all() as Tag[];

  const tasksCsv = toCsv(
    ["id", "title", "status", "priority", "due_date", "created_at", "tag_id"],
    tasks.map((t) => [
      t.id,
      t.title,
      t.status,
      t.priority,
      t.due_date,
      t.created_at,
      t.tag_id,
    ])
  );
  const tagsCsv = toCsv(
    ["id", "name"],
    tags.map((t) => [t.id, t.name])
  );

  const zip = new JSZip();
  zip.file("tasks.csv", tasksCsv);
  zip.file("tags.csv", tagsCsv);
  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="taskflow-export.zip"',
    },
  });
}
