// Playback policy: once we KNOW which channel the listener wants, what do we play?
//
//   1. If the channel is live            -> play the live stream.
//   2. If it is not live                 -> play the channel's latest video by default.
//   3. If it has no videos at all        -> play nothing ("no content to show").
//
// This is a product rule, so it lives in code, not in the model's prompt.
// The model only says "which channel"; this file decides "what plays".

import type { Channel } from "./catalog";
import type {
  ChannelScenario,
  LatestUploadResult,
  LiveLookupResult,
  PlaybackPlan,
} from "./api-types";
import { lookupLatestUpload, lookupLive } from "./youtube-mock";

export interface PlaybackDecision {
  live: LiveLookupResult;
  latestUpload: LatestUploadResult | null;
  playback: PlaybackPlan | null;
}

export async function resolvePlayback(
  channel: Channel,
  scenario: ChannelScenario,
): Promise<PlaybackDecision> {
  const live = await lookupLive(channel, scenario);

  if (live.status === "live_found") {
    return {
      live,
      latestUpload: null,
      playback: { kind: "live", videoId: live.videoId, title: live.title },
    };
  }

  // Not live -> fall back to the latest video (second lookup).
  const latestUpload = await lookupLatestUpload(channel, scenario);
  const playback: PlaybackPlan | null =
    latestUpload.status === "latest_found"
      ? { kind: "latest_upload", videoId: latestUpload.videoId, title: latestUpload.title }
      : null;

  return { live, latestUpload, playback };
}
