import fs from "fs";
import { openai, VISION_MODEL } from "../openai";
import type { ProgressEmitter } from "./events";

const BATCH_SIZE = 10;

const WATCH_PROMPT = `You are watching sequential screenshots from a screen recording of a person using a web application. For each batch of frames, write detailed observation notes covering:

1. SCREENS: every distinct screen or page visible, with its verbatim title/heading.
2. UI ELEMENTS: buttons, inputs, dropdowns, columns, cards, nav links — with their VERBATIM on-screen labels (exact text, exact casing).
3. DATA: field names and example values visible on records.
4. ACTIONS: what the user did between frames (clicked X, typed Y, dragged card from column A to column B, opened dialog Z) and what changed as a result.
5. UNUSED: any visible feature/nav item the user never interacted with.

Be exhaustive and literal. Quote all labels exactly as shown. Do not guess at functionality you cannot see.`;

/**
 * Sends frames to the vision model in batches and returns
 * consolidated observation notes.
 */
export async function watchFrames(
  framePaths: string[],
  emit: ProgressEmitter
): Promise<string> {
  const notes: string[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < framePaths.length; i += BATCH_SIZE) {
    batches.push(framePaths.slice(i, i + BATCH_SIZE));
  }

  emit("watch", `Watching your recording (${framePaths.length} key moments)...`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const images = batch.map((p) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/jpeg;base64,${fs.readFileSync(p).toString("base64")}`,
        detail: "high" as const,
      },
    }));

    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: WATCH_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Frames ${b * BATCH_SIZE + 1}-${b * BATCH_SIZE + batch.length} of ${framePaths.length}, in chronological order. Write your observation notes.`,
            },
            ...images,
          ],
        },
      ],
    });

    notes.push(response.choices[0].message.content ?? "");
    emit("watch", `Studied moments ${b * BATCH_SIZE + 1}-${b * BATCH_SIZE + batch.length}...`);
  }

  emit("watch", "Finished watching. Writing up what the app does...");
  return notes.join("\n\n---\n\n");
}
