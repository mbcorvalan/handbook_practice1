// Contract between the model and the app, defined with Zod.
//
// There are TWO schemas, on purpose:
//
// 1) ModelOutputSchema: the "flat" shape we ask the model for through
//    structured outputs. The API guarantees the JSON follows this shape
//    (fields, types, and channelId being one of the catalog IDs or null).
//
// 2) CommandSchema: the contract the app is willing to EXECUTE.
//    It is a discriminated union on "action": each action requires its own
//    fields. For example, select_channel without a channelId is invalid.
//
// The first one constrains what the model can write. The second one decides
// whether that is enough to act on. We always validate with the second one
// before executing.

import { z } from "zod";
import { CHANNEL_IDS, findChannel } from "./catalog";

// ---------- 1) What the model returns ----------

/*
Lo que se le pide al modelo, chaneliD dato verificado con asi el modelo no puede invetar IDS

*/

export const ModelOutputSchema = z.object({
  action: z
    .enum(["select_channel", "needs_more_info", "unsupported_command"])
    .describe("What you understood needs to be done."),
  channelId: z
    .enum(CHANNEL_IDS)
    .nullable()
    .describe("Catalog ID. Only with select_channel; otherwise null."),
  question: z
    .string()
    .nullable()
    .describe("Short question for the listener. Only with needs_more_info; otherwise null."),
  reason: z
    .string()
    .describe("Brief explanation of the decision (for the log, never spoken out loud)."),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;

// ---------- 2) What the app accepts to execute ----------

const SelectChannel = z.object({
  action: z.literal("select_channel"),
  channelId: z.string().min(1),
  reason: z.string(),
});

const NeedsMoreInfo = z.object({
  action: z.literal("needs_more_info"),
  question: z.string().trim().min(1),
  reason: z.string(),
});

const UnsupportedCommand = z.object({
  action: z.literal("unsupported_command"),
  reason: z.string(),
});

/*
Lo que la app aceptar ejectura es una union por action y puede ser selectchannel , needsMoreInfor, unpsorrtedCoomand
*/

export const CommandSchema = z.discriminatedUnion("action", [
  SelectChannel,
  NeedsMoreInfo,
  UnsupportedCommand,
]);

export type Command = z.infer<typeof CommandSchema>;

// ---------- Full validation before executing ----------

export type ValidationResult =
  | { ok: true; command: Command }
  | { ok: false; stage: "json" | "schema" | "catalog"; errors: string[] };

/**
 * Takes the COMPLETE text the model generated and decides whether it can be executed.
 * Steps: 1) it is JSON?  2) it matches CommandSchema ? 3) the ID exists in the catalog?
 */
export function validateModelText(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, stage: "json", errors: ["The response is not valid JSON."] };
  }

  const parsed = CommandSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      stage: "schema",
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const command = parsed.data;
  if (command.action === "select_channel" && !findChannel(command.channelId)) {
    return {
      ok: false,
      stage: "catalog",
      errors: [`channelId "${command.channelId}" does not exist in the catalog.`],
    };
  }

  return { ok: true, command };
}
