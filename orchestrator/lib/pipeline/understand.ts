import { zodResponseFormat } from "openai/helpers/zod";
import { openai, REASONING_MODEL } from "../openai";
import { AnastasisProductSpec } from "../spec/schema";
import type { ProgressEmitter } from "./events";

const UNDERSTAND_PROMPT = `You are the "understand" stage of Anastasis, a tool that resurrects dead web apps from a screen recording plus a data export.

You receive observation notes written while watching a screen recording. Produce a draft AnastasisProductSpec describing what the app fundamentally IS.

Rules:
- entities/fields: only what the notes show evidence for. Use snake_case names. verbatim_label must be the exact on-screen text quoted in the notes.
- provenance: use "confirmed" for now — the match stage will adjust after seeing the export. Fields visible on screen only, with no export yet, still start as "confirmed".
- views/actions: only the actions the user was actually seen performing.
- workflows: one entry per observed cause-and-effect interaction (trigger = what the user did, effect = what visibly changed). Phrase both GENERICALLY — the recording is an example of behavior, not a script. Write "user creates a task and it appears in the To Do column", not "user creates a task named demo and the To Do count goes from 128 to 129". Specific titles the user typed and exact on-screen totals are incidental to one session; the behavior is what gets rebuilt and tested.
- excluded: every feature visible in the notes that the user never used, with reason "detected but never used in recording".
- migration_plan: leave as an empty array — it is filled by the match stage.
- open_questions: anything ambiguous you could not resolve from the notes.

Do not invent features. Absence of evidence means absence from the spec.`;

/**
 * Turns observation notes into a draft product spec via structured output.
 */
export async function understand(
  observationNotes: string,
  emit: ProgressEmitter
): Promise<AnastasisProductSpec> {
  emit("understand", "Figuring out what this app fundamentally is...");

  const response = await openai.beta.chat.completions.parse({
    model: REASONING_MODEL,
    messages: [
      { role: "system", content: UNDERSTAND_PROMPT },
      { role: "user", content: observationNotes },
    ],
    response_format: zodResponseFormat(AnastasisProductSpec, "product_spec"),
  });

  const spec = response.choices[0].message.parsed;
  if (!spec) {
    throw new Error("Understand stage returned no parseable spec");
  }

  emit(
    "understand",
    `This looks like "${spec.app_name}" with ${spec.views.length} view(s), ${spec.entities.length} data type(s), and ${spec.workflows.length} workflow(s).`
  );
  for (const ex of spec.excluded) {
    emit("understand", `Skipping "${ex.feature}" — ${ex.reason}.`);
  }
  return spec;
}
