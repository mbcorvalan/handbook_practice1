// SIMULATED YouTube lookup: "is this channel streaming live right now?"
//
// It separates two different questions:
//   - What did the listener want?      -> answered by the model (channelId)
//   - Can it be played right now?      -> answered by this code (external data)
//
// YouTube is not called here: the result is chosen by whoever is testing
// (scenario). Every result carries simulated: true so it is never confused
// with real data. For the real version, this function would call the
// YouTube Data API v3 (search.list with channelId, eventType=live, type=video)
// and return exactly the same three cases.

import type { Channel } from "./catalog";
import type {
  LatestUploadResult,
  LatestUploadScenario,
  LiveLookupResult,
  LookupScenario,
} from "./api-types";

const SIMULATED_LATENCY_MS = 400;

export async function lookupLive(
  channel: Channel,
  scenario: LookupScenario,
): Promise<LiveLookupResult> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  switch (scenario) {
    case "live_found":
      return {
        status: "live_found",
        simulated: true,
        videoId: `sim-${channel.name.toLowerCase().replace(/\s+/g, "-")}-live`,
        title: `${channel.name} live (simulated)`,
      };
    case "no_live_found":
      return { status: "no_live_found", simulated: true };
    case "lookup_failed":
      return {
        status: "lookup_failed",
        simulated: true,
        error: "Simulated timeout while querying YouTube",
      };
  }
}

// SIMULATED YouTube lookup: "what is the most recent video this channel uploaded?"
//
// For the real version: every channel has an "uploads" playlist whose ID is the
// channelId with "UC" replaced by "UU". playlistItems.list on that playlist
// (maxResults=1) returns the latest upload and costs far less quota than search.list.

export async function lookupLatestUpload(
  channel: Channel,
  scenario: LatestUploadScenario,
): Promise<LatestUploadResult> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  switch (scenario) {
    case "latest_found":
      return {
        status: "latest_found",
        simulated: true,
        videoId: `sim-${channel.name.toLowerCase().replace(/\s+/g, "-")}-latest`,
        title: `${channel.name} · latest episode (simulated)`,
        publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
      };
    case "no_uploads":
      return { status: "no_uploads", simulated: true };
    case "lookup_failed":
      return {
        status: "lookup_failed",
        simulated: true,
        error: "Simulated error while fetching the latest upload",
      };
  }
}
