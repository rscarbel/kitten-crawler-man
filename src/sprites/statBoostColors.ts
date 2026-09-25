/**
 * Colour table for the stat-boost potion's fanfare (see
 * `DungeonUIRenderer.renderStatBoostFlash`). Lives under `src/sprites/` with
 * the rest of the game's art palettes, since a colour ramp is art data rather
 * than a game rule.
 */

import type { StatName } from '../Player';
import type { Rgb } from './status/statusPaint';

/** The additive spark inside every rising mote, whatever stat it belongs to. */
export const STAT_BOOST_MOTE_HEAT: Rgb = [255, 255, 246];

/** Burst/glow/text colour per stat, so the fanfare reads as that stat's own colour. */
export const STAT_BOOST_COLOR: Record<StatName, Rgb> = {
  strength: [239, 68, 68],
  intelligence: [56, 189, 248],
  constitution: [74, 222, 128],
  dexterity: [250, 204, 21],
};
