// What the radio SAYS and the state left for the next turn.
//
// Built by the code, not the model: this way the sentences are predictable and
// depend on verified facts (validated action + YouTube result).

import type { Command } from "./contract";
import type { LatestUploadResult, LiveLookupResult, PendingClarification } from "./api-types";

export function buildReply(
  command: Command,
  channelName: string | null,
  lookup: LiveLookupResult | null,
  latestUpload: LatestUploadResult | null,
): string {
  switch (command.action) {
    case "needs_more_info":
      return command.question;
    case "unsupported_command":
      return "I can't do that yet. I can play a channel's live stream.";
    case "select_channel":
      if (!lookup) return `Looking for ${channelName}.`;
      switch (lookup.status) {
        case "live_found":
          return `Playing ${channelName} live.`;
        case "no_live_found":
          // Fallback: the reply makes clear this is NOT live, so nobody is misled.
          if (latestUpload?.status === "latest_found") {
            return `${channelName} isn't live right now. Playing their latest video: ${latestUpload.title}.`;
          }
          return `There's no content to show for ${channelName}.`;
      }
  }
}

/**
 * Conversational state for the next turn.
 * - needs_more_info: the request stays pending. If one was already pending,
 *   we keep the ORIGINAL request (the listener may need two clarifications).
 * - any other action: the request is closed (resolved or discarded).
 */
export function nextPendingState(
  command: Command,
  utterance: string,
  previous: PendingClarification | null,
): PendingClarification | null {
  if (command.action === "needs_more_info") {
    return {
      originalRequest: previous?.originalRequest ?? utterance,
      question: command.question,
    };
  }
  return null;
}
