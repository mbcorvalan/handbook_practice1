// SIMULATED YouTube lookups.
//
// It separates two different questions:
//   - What did the listener want?      -> answered by the model (channelId)
//   - Can it be played right now?      -> answered by this code (external data)
//
// YouTube is not called here: the channel's state is chosen by whoever is
// testing (scenario). Every result carries simulated: true so it is never
// confused with real data.

import type { Channel } from "./catalog";
import type { ChannelScenario, LatestUploadResult, LiveLookupResult } from "./api-types";

const SIMULATED_LATENCY_MS = 400;

const slug = (channel: Channel) => channel.name.toLowerCase().replace(/\s+/g, "-");

// "Is this channel streaming live right now?"
// For the real version: YouTube Data API v3, search.list with
// channelId, eventType=live, type=video.
export async function lookupLive(
  channel: Channel,
  scenario: ChannelScenario,
): Promise<LiveLookupResult> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  if (scenario === "live") {
    return {
      status: "live_found",
      simulated: true,
      videoId: `sim-${slug(channel)}-live`,
      title: `${channel.name} live (simulated)`,
    };
  }
  return { status: "no_live_found", simulated: true };
}

// "What is the most recent video this channel uploaded?"
// For the real version: every channel has an "uploads" playlist whose ID is the
// channelId with "UC" replaced by "UU". playlistItems.list on that playlist
// (maxResults=1) returns the latest upload and costs far less quota than search.list.
export async function lookupLatestUpload(
  channel: Channel,
  scenario: ChannelScenario,
): Promise<LatestUploadResult> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));

  if (scenario === "no_content") {
    return { status: "no_uploads", simulated: true };
  }
  return {
    status: "latest_found",
    simulated: true,
    videoId: `sim-${slug(channel)}-latest`,
    title: `${channel.name} · latest episode (simulated)`,
    publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  };
}
