/**
 * Shared quest stage banners, so every questline announces a stage the same
 * way. Callers own the countdown timers and pass frames-remaining.
 * A quest's completion is announced on the shared quest-complete screen
 * (`src/ui/questReward/`), not here.
 */

import type { TopBandEntry } from './hud/topBand';
import { stackedBandEntry, TOP_BAND_WIDTH, type BandRow, type BandTone } from './hud/topBandStack';

const FRAMES_PER_SECOND = 60;

/** Stage-banner display time. */
const BANNER_SECONDS = 4;
export const QUEST_BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;

export interface QuestBannerOptions {
  /** Unique within the band this frame. */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | null;
  /** Frames the banner has left; it fades over its last second. */
  readonly framesLeft: number;
  /** What the stage means for the player; the title and the card edge take its colour. */
  readonly tone?: BandTone;
}

/**
 * A quest's stage banner as a top-band entry, or `null` once its time is up.
 * Callers own the countdown and pass the frames remaining.
 */
export function questBannerEntry(opts: QuestBannerOptions): TopBandEntry | null {
  if (opts.framesLeft <= 0) return null;
  const tone = opts.tone ?? 'success';
  const fading = opts.framesLeft < BANNER_FADE_FRAMES;
  const subtitle = opts.subtitle ?? null;
  const rows: BandRow[] = [
    { kind: 'text', text: opts.title, role: 'heading', tone, wrap: true, maxLines: 2 },
  ];
  if (subtitle !== null) {
    rows.push({ kind: 'text', text: subtitle, role: 'secondary', wrap: true, maxLines: 2 });
  }
  return stackedBandEntry({
    id: opts.id,
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.wide,
    accentTone: tone,
    alpha: fading ? opts.framesLeft / BANNER_FADE_FRAMES : undefined,
    rows,
  });
}
