// Playback policy: once we KNOW which channel the listener wants, what do we play?
//
//   1. If the channel is live          -> play the live stream.
//   2. If it is confirmed NOT live     -> play the channel's latest upload.
//   3. If the live lookup FAILED       -> play nothing. We don't know whether it
//      is live, so falling back to an old video could hide a live stream.
//
// This is a product rule, so it lives in code, not in the model's prompt.
// The model only says "which channel"; this file decides "what plays".

import type { Channel } from "./catalog";
import type {
  LatestUploadResult,
  LatestUploadScenario,
  LiveLookupResult,
  LookupScenario,
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
  liveScenario: LookupScenario,
  latestScenario: LatestUploadScenario,
): Promise<PlaybackDecision> {
  const live = await lookupLive(channel, liveScenario);

  if (live.status === "live_found") {
    return {
      live,
      latestUpload: null,
      playback: { kind: "live", videoId: live.videoId, title: live.title },
    };
  }

  if (live.status === "lookup_failed") {
    return { live, latestUpload: null, playback: null };
  }

  // no_live_found -> fall back to the latest upload (second lookup).
  const latestUpload = await lookupLatestUpload(channel, latestScenario);
  const playback: PlaybackPlan | null =
    latestUpload.status === "latest_found"
      ? { kind: "latest_upload", videoId: latestUpload.videoId, title: latestUpload.title }
      : null;

  return { live, latestUpload, playback };
}
