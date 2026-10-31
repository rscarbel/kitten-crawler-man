/**
 * When everything happens as a key is forged, as pure functions of the
 * frame: the fragments summoned into a wide ring of columns, their orbit
 * tightening and quickening, the slam together in a white flash, the whole
 * key hanging in god rays with its seams glowing once, and the words.
 * Nothing here keeps state, so a skip is a jump to `settledAt` and a gallery
 * fixture is a frame number.
 *
 * Frames are 60 per second. The beats are fitted to the recordings as
 * delivered: the summons peaks in its first half second, the orbit's build
 * is at its loudest from about 1.5 s to 2.5 s and dies away after, so the
 * pieces slam together at 2.5 s rather than at the end of the file; the
 * flash's hit is a few frames into its file, and the fanfare swells for two
 * seconds before it holds.
 */

import { decay, easeInOut, easeOut, span } from './fragmentTimeline';
import { FULL_TURN } from '../../../sprites/lightMaps';

const SUMMON_STAGGER_FRAMES = 10;
const SUMMON_FADE_FRAMES = 24;
const SUMMON_FRAMES = 60;
const ORBIT_FRAMES = 150;
/** The flash's hit sits this far into its recording. */
const FLASH_SOUND_LEAD = 9;
const FLASH_FRAMES = 44;
/** The fanfare starts as the white begins to clear. */
const FANFARE_AFTER_FUSE = 14;
const SEAM_FROM_FUSE = 36;
const SEAM_FRAMES = 60;
const TITLE_AFTER_FUSE = 90;
const SUBLINE_AFTER_TITLE = 30;
const SETTLE_AFTER_SUBLINE = 60;

export const FORGE_BEATS = (() => {
  const orbitFrom = SUMMON_FRAMES;
  const fuseAt = orbitFrom + ORBIT_FRAMES;
  const titleAt = fuseAt + TITLE_AFTER_FUSE;
  const sublineAt = titleAt + SUBLINE_AFTER_TITLE;
  return {
    orbitFrom,
    fuseAt,
    flashEnd: fuseAt + FLASH_FRAMES,
    seamFrom: fuseAt + SEAM_FROM_FUSE,
    titleAt,
    sublineAt,
    settledAt: sublineAt + SETTLE_AFTER_SUBLINE,
  } as const;
})();

/** The frames each cue is raised on, so its loudest moment lands on its beat. */
export const FORGE_CUE_FRAMES = {
  forgeSummon: 0,
  forgeOrbitBuild: FORGE_BEATS.orbitFrom,
  forgeFlash: FORGE_BEATS.fuseAt - FLASH_SOUND_LEAD,
  forgeFanfare: FORGE_BEATS.fuseAt + FANFARE_AFTER_FUSE,
} as const;

/** Continue stays inert this long after the forge settles. */
export const FORGE_CONTINUE_GUARD_FRAMES = 18;

const BACKDROP_ALPHA = 0.96;
const BACKDROP_FRAMES = 20;

/** How dark the world under the forge is; it opens straight from a fragment's ceremony, which is already dark. */
export function forgeBackdrop(frame: number): number {
  const FROM = 0.9;
  return BACKDROP_ALPHA * (FROM + (1 - FROM) * span(frame, 0, BACKDROP_FRAMES));
}

/** The frame fragment `index` starts appearing in its column. */
export function forgeSummonFrame(index: number): number {
  return index * SUMMON_STAGGER_FRAMES;
}

/** How far fragment `index` has appeared in its column, 0 to 1. */
export function forgeSummoned(frame: number, index: number): number {
  const from = forgeSummonFrame(index);
  return easeOut(span(frame, from, from + SUMMON_FADE_FRAMES));
}

/** The ring's radius as a share of its starting radius when the pieces meet. */
const ORBIT_END_RADIUS = 0;
/** Whole turns the ring makes on the way in; the speed climbs the whole way. */
const ORBIT_TURNS = 3.25;

/** Where the ring of fragments is: its radius share and its turn in radians. */
export function forgeOrbit(
  frame: number,
  reducedMotion: boolean,
): { readonly radius: number; readonly turn: number; readonly progress: number } {
  const p = span(frame, FORGE_BEATS.orbitFrom, FORGE_BEATS.fuseAt);
  if (reducedMotion) return { radius: 1, turn: 0, progress: p };
  const closing = p * p;
  const radius = 1 - (1 - ORBIT_END_RADIUS) * closing;
  return { radius, turn: closing * p * ORBIT_TURNS * FULL_TURN, progress: p };
}

/** How solid the fragments still are: they vanish into the flash, or fade out under reduced motion. */
export function forgePiecesAlpha(frame: number, reducedMotion: boolean): number {
  const { orbitFrom, fuseAt } = FORGE_BEATS;
  if (reducedMotion) return 1 - span(frame, orbitFrom, fuseAt);
  return frame < fuseAt ? 1 : 0;
}

/** How solid the whole key is. */
export function forgeKeyAlpha(frame: number, reducedMotion: boolean): number {
  const { orbitFrom, fuseAt } = FORGE_BEATS;
  if (reducedMotion) return easeInOut(span(frame, orbitFrom, fuseAt));
  return frame < fuseAt ? 0 : 1;
}

/** The white-out as the pieces meet, 0 to 1. */
export function forgeFlash(frame: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return decay(frame, FORGE_BEATS.fuseAt, FLASH_FRAMES);
}

const TREMBLE_MAX = 0.55;
const SLAM_SHAKE_FRAMES = 30;

/** How hard the screen shakes: a tremble that climbs with the orbit, then the slam. */
export function forgeShake(frame: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const { orbitFrom, fuseAt } = FORGE_BEATS;
  const tremble = frame < fuseAt ? TREMBLE_MAX * span(frame, orbitFrom, fuseAt) ** 2 : 0;
  return Math.max(tremble, decay(frame, fuseAt, SLAM_SHAKE_FRAMES));
}

/** How brightly the seams where the pieces joined glow: once, then gone. */
export function forgeSeamGlow(frame: number): number {
  const p = span(frame, FORGE_BEATS.seamFrom, FORGE_BEATS.seamFrom + SEAM_FRAMES);
  return p <= 0 || p >= 1 ? 0 : Math.sin(p * Math.PI);
}

const RAYS_IN_FRAMES = 30;

/** How strong the god rays behind the whole key are. */
export function forgeRays(frame: number): number {
  return easeOut(span(frame, FORGE_BEATS.fuseAt, FORGE_BEATS.fuseAt + RAYS_IN_FRAMES));
}

const WORD_FADE_FRAMES = 14;
const TITLE_SLAM_FRAMES = 14;
const TITLE_SLAM_FROM = 2;
const TITLE_SOLID_SHARE = 0.5;

export function forgeWords(frame: number): {
  readonly title: number;
  readonly titleScale: number;
  readonly subline: number;
} {
  const { titleAt, sublineAt } = FORGE_BEATS;
  const slam = easeOut(span(frame, titleAt, titleAt + TITLE_SLAM_FRAMES));
  return {
    title: span(frame, titleAt, titleAt + TITLE_SLAM_FRAMES * TITLE_SOLID_SHARE),
    titleScale: TITLE_SLAM_FROM - (TITLE_SLAM_FROM - 1) * slam,
    subline: span(frame, sublineAt, sublineAt + WORD_FADE_FRAMES),
  };
}
