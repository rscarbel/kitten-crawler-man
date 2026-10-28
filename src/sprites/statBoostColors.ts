/**
 * Colour table for the stat-boost potion's fanfare (see
 * `renderStatBoostFlash` in `src/systems/worldEffects.ts`). Lives under `src/sprites/` with
 * the rest of the game's art palettes, since a colour ramp is art data rather
 * than a game rule.
 */

import type { StatId } from '../core/party/stats';
import type { Rgb } from './status/statusPaint';

/** The additive spark inside every rising mote, whatever stat it belongs to. */
export const STAT_BOOST_MOTE_HEAT: Rgb = [255, 255, 246];

/** Burst/glow/text colour per stat, so the fanfare reads as that stat's own colour. */
export const STAT_BOOST_COLOR: Record<StatId, Rgb> = {
  melee: [239, 68, 68],
  magic: [56, 189, 248],
  health: [74, 222, 128],
  evasiveness: [250, 204, 21],
  ranged: [167, 139, 250],
  explosivesHandling: [251, 146, 60],
};
