/**
 * Every glob kind's three figures and the row each draw wrapper asks for, in
 * one table the glob gates and the review harness both read, so a new kind
 * cannot ship baked by one and unchecked by the other.
 */

import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  FIREBALL_BOLT_FIGURE,
  FIREBALL_BOLT_STATE,
  FIREBALL_BURST_FIGURE,
  FIREBALL_BURST_STATE,
  FIREBALL_FLAME_FIGURE,
  FIREBALL_FLAME_STATE,
} from '../src/sprites/art/fireballFigure.js';
import {
  ACID_BOLT_STATE,
  ACID_BURST_STATE,
  ACID_GLOB_BOLT_FIGURE,
  ACID_GLOB_BURST_FIGURE,
  ACID_GLOB_PUDDLE_FIGURE,
  ACID_PUDDLE_STATE,
} from '../src/sprites/art/acidGlobFigure.js';
import { ALL_GLOB_KINDS, type GlobKind } from '../src/systems/globShot.js';

/** A figure and the one row of it the runtime draws. */
export interface DrawnRow {
  readonly def: FigureDef;
  readonly state: string;
}

export interface GlobFigureSet {
  readonly kind: GlobKind;
  readonly bolt: DrawnRow;
  readonly burst: DrawnRow;
  readonly puddle: DrawnRow;
  /**
   * Whether the puddle is anchored at its base with its ink rising off it, as
   * fire does, rather than lying flat around its anchor, as a pool does.
   */
  readonly puddleRisesOffBase: boolean;
}

const SETS = {
  fireball: {
    bolt: { def: FIREBALL_BOLT_FIGURE, state: FIREBALL_BOLT_STATE },
    burst: { def: FIREBALL_BURST_FIGURE, state: FIREBALL_BURST_STATE },
    puddle: { def: FIREBALL_FLAME_FIGURE, state: FIREBALL_FLAME_STATE },
    puddleRisesOffBase: true,
  },
  acid: {
    bolt: { def: ACID_GLOB_BOLT_FIGURE, state: ACID_BOLT_STATE },
    burst: { def: ACID_GLOB_BURST_FIGURE, state: ACID_BURST_STATE },
    puddle: { def: ACID_GLOB_PUDDLE_FIGURE, state: ACID_PUDDLE_STATE },
    puddleRisesOffBase: false,
  },
} as const satisfies Record<GlobKind, Omit<GlobFigureSet, 'kind'>>;

export const GLOB_FIGURE_SETS: readonly GlobFigureSet[] = ALL_GLOB_KINDS.map((kind) => ({
  kind,
  ...SETS[kind],
}));
