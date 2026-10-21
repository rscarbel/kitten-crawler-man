/**
 * The seven goblin builds painted on the goblin rig, as one set of subjects
 * for the review harness and the art gates.
 *
 * The five armed builds share one set of rows; the two bombers each have their
 * own. Everything that measures or renders something any goblin has goes
 * through these, so a gate written once runs over all seven.
 */

import {
  ARCHETYPE_SCALE,
  GOBLIN_ARMED_ARCHETYPES,
  GOBLIN_FIGURES,
  GOBLIN_STYLES,
  GORE_RECENTRE,
  ROWS,
  goblinPose,
  type GoblinArmedArchetype,
  type RowSpec,
} from '../src/sprites/art/goblinFigure.js';
import type { GoblinArchetype, GoblinPose, GoblinStyle, Pt } from '../src/sprites/art/goblinArt.js';
import { BOMBER_SCALE, GOBLIN_BOMBER_STYLES } from '../src/sprites/art/goblinBomberArt.js';
import {
  GOBLIN_BOMBER_FIGURES,
  GOBLIN_BOMBER_GORE_RECENTRE,
  GOBLIN_BOMBER_ROWS,
  goblinBomberPose,
} from '../src/sprites/art/goblinBomberFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

export function isArmed(archetype: GoblinArchetype): archetype is GoblinArmedArchetype {
  return GOBLIN_ARMED_ARCHETYPES.some((armed) => armed === archetype);
}

export function figureOf(archetype: GoblinArchetype): FigureDef {
  return isArmed(archetype) ? GOBLIN_FIGURES[archetype] : GOBLIN_BOMBER_FIGURES[archetype];
}

export function styleOf(archetype: GoblinArchetype): GoblinStyle {
  return isArmed(archetype) ? GOBLIN_STYLES[archetype] : GOBLIN_BOMBER_STYLES[archetype];
}

/** How much of its authored size a build is drawn at. */
export function scaleOf(archetype: GoblinArchetype): number {
  return isArmed(archetype) ? ARCHETYPE_SCALE[archetype] : BOMBER_SCALE[archetype];
}

export function goreRecentreOf(archetype: GoblinArchetype): ReadonlyMap<string, Pt> {
  return isArmed(archetype) ? GORE_RECENTRE[archetype] : GOBLIN_BOMBER_GORE_RECENTRE[archetype];
}

export function rowsOf(archetype: GoblinArchetype): readonly RowSpec[] {
  return isArmed(archetype) ? ROWS : GOBLIN_BOMBER_ROWS[archetype];
}

export function rowOf(archetype: GoblinArchetype, name: string): RowSpec {
  const row = rowsOf(archetype).find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`goblin_${archetype} paints no row "${name}"`);
  return row;
}

export function poseOf(archetype: GoblinArchetype, row: RowSpec, frame: number): GoblinPose {
  return isArmed(archetype)
    ? goblinPose(archetype, row, frame)
    : goblinBomberPose(archetype, row.name, frame);
}
