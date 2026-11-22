// Builds the CONTEXT the model receives on every call.
//
// The model has no memory between calls: everything it "knows" comes from here.
//   - system:   product rules + catalog (the same on every call)
//   - messages: relevant turns from the history + the current request,
//               with the pending request if the radio had asked something.

import { CATALOG } from "./catalog";
import type { HistoryTurn, PendingClarification } from "./api-types";

/** How many previous turns we send. More turns = more context, but more cost and noise. */
export const MAX_HISTORY_TURNS = 6;

const PRODUCT_RULES = `
You are the voice-command interpreter of a physical radio that plays live streams from YouTube channels.
You receive what the listener said into the microphone (already transcribed) and return ONE action in the requested format.

Possible actions:
- select_channel: the request clearly identifies ONE channel from the catalog. Return its channelId.
- needs_more_info: the request is to play a channel, but it is not enough to know which one. Return a question.
- unsupported_command: the request is out of scope (volume, weather, time, searching for a specific video, a channel not in the catalog, small talk).

Rules:
1. You can only choose channels from the catalog, always by their channelId. Never invent IDs.
2. Recognize channels by name or alias, even if misspelled or lowercase (speech transcription is not perfect).
3. You have no memory of preferences or habits. Expressions like "the usual one", "my favorite", "the one I like" or "put it on" do not identify a channel: use needs_more_info.
4. You may only resolve a reference using the history if the history makes it clear (for example "go back to the previous one" right after a channel was played).
5. If you receive a PENDING REQUEST, the new sentence is probably the answer to the question the radio asked. Combine both: if the answer names a channel, the original request is complete and select_channel applies.
6. The needs_more_info question must say what information is missing, be short and easy to say out loud. English, no emojis. If there are only a few possible options, you may name them.
7. You only interpret the request. You do not know whether the channel is streaming live: the system checks that afterwards. Do not mention it.
8. In "reason", explain in one sentence why you chose that action.
`.trim();

/** Builds the system prompt: the product rules (PRODUCT_RULES) plus the catalog as JSON inside <catalog>. */
export function buildSystemPrompt(): string {
  const catalog = CATALOG.map((c) => ({
    channelId: c.channelId,
    name: c.name,
    aliases: c.aliases,
  }));

  return `${PRODUCT_RULES}

<catalog>
${JSON.stringify(catalog, null, 2)}
</catalog>`;
}

/**
 * The listener's text goes inside XML-like tags (<current_request>, <pending_request>).
 * Removing "<" and ">" stops someone from typing "</current_request>" to close the tag
 * and make their own text look like instructions.
 */
function sanitize(text: string): string {
  return text.replace(/[<>]/g, "");
}

/**
 * Builds the messages: the last 6 turns (MAX_HISTORY_TURNS), each one as a
 * user/assistant pair, followed by the current request.
 */
export function buildMessages(
  history: HistoryTurn[],
  pending: PendingClarification | null,
  utterance: string,
): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  // Previous turns: what the listener said and the action that was decided.
  // This way the model sees "what happened before" in the same format it will produce.
  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    messages.push({ role: "user", content: sanitize(turn.utterance) });
    messages.push({
      role: "assistant",
      content: JSON.stringify(turn.command ?? { action: "error", reason: "turn without a valid action" }),
    });
  }

  // Current turn. If there is a pending clarification, we make it explicit:
  // we don't rely on the model "inferring" it from the history.
  let content = `<current_request>${sanitize(utterance)}</current_request>`;
  if (pending) {
    content =
      `<pending_request>
The listener had said: "${sanitize(pending.originalRequest)}"
The radio asked: "${sanitize(pending.question)}"
The sentence below is their answer.
</pending_request>

` + content;
  }
  messages.push({ role: "user", content });

  return messages;
}
