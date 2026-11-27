// Types shared between the page (client) and /api/command (server).
// Because they live in one file, if one side changes, TypeScript flags the other.

import type { Command } from "./contract";

// ---------- Conversational state ----------

/** A request left half-done because the radio had to ask something. */
export interface PendingClarification {
  /** What the listener originally said, e.g. "Play the usual one". */
  originalRequest: string;
  /** What the radio asked, e.g. "Which channel do you want to listen to?". */
  question: string;
}

/** An already resolved turn, as we send it back to the model as history. */
export interface HistoryTurn {
  utterance: string;
  command: Command | null;
}

// ---------- YouTube lookup (simulated) ----------

/**
 * What the simulated channel looks like right now:
 * - live:         streaming live
 * - latest_video: not live, but has uploaded videos
 * - no_content:   not live and has never uploaded anything
 */
export type ChannelScenario = "live" | "latest_video" | "no_content";

export type LiveLookupResult =
  | { status: "live_found"; simulated: true; videoId: string; title: string }
  | { status: "no_live_found"; simulated: true };

export type LatestUploadResult =
  | { status: "latest_found"; simulated: true; videoId: string; title: string; publishedAt: string }
  | { status: "no_uploads"; simulated: true };

/** What the player is told to play, decided by code (never by the model). */
export interface PlaybackPlan {
  kind: "live" | "latest_upload";
  videoId: string;
  title: string;
}

// ---------- Request ----------

export interface CommandRequest {
  utterance: string;
  history: HistoryTurn[];
  pending: PendingClarification | null;
  /** What the simulated YouTube channel looks like in this test. */
  scenario: ChannelScenario;
}

// ---------- Response: NDJSON events (one JSON line per event) ----------

/** Call log: exactly what was sent to the model. */
export interface CallLog {
  model: string;
  effort: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  outputSchema: unknown;
}

export interface FinalResult {
  /** Full text the model generated (before validation). */
  rawText: string;
  /** Model that actually answered (may change if there was a fallback). */
  respondedBy: string;
  stopReason: string | null;
  validation:
    | { ok: true; command: Command }
    | { ok: false; stage: string; errors: string[] };
  /** Only present when select_channel was executed. */
  lookup: LiveLookupResult | null;
  /** Only present when the live lookup returned no_live_found. */
  latestUpload: LatestUploadResult | null;
  /** What the player should play, or null if there is nothing to play. */
  playback: PlaybackPlan | null;
  channelName: string | null;
  /** What the radio would say out loud. */
  reply: string;
  /** Conversational state for the next turn. */
  nextPending: PendingClarification | null;
}

export type StreamEvent =
  | { type: "context"; log: CallLog }
  | { type: "delta"; text: string }
  | { type: "final"; result: FinalResult }
  | { type: "error"; message: string };
