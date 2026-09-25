/**
 * The thrall: a spectral ratkin laborer, hooded and ragged, raised to work a
 * tree or a rock for whoever summoned it.
 *
 * Painted on the Briar Hollow cast's own rig, cell and rows, in an outfit of
 * its own. Its colours are the soul green's own dim family — the runtime
 * washes it further green and draws it translucent (`thrallSprite.ts`), but a
 * figure already painted in those tones keeps its shading under the wash
 * instead of turning to a flat green smear.
 *
 * Two figures, not one: what it holds is painted into the cell, and a cell is
 * shared by every draw, so the axeman and the pickman are each their own
 * `FigureId`. The tier of the summoner's tool is not shown on a thrall; the
 * ghost wash would take its colour anyway.
 */

import type { FigureDef } from '../figure/figureDef';
import type { RatKinView } from './ratKinArt';
import { IDLE_FRAMES, WALK_FRAMES, cyclePhase } from './ratKinFigure';
import {
  type CastRowSpec,
  WORK_FRAMES,
  castStateName,
  ratkinOutfitFigure,
} from './ratkinCastFigure';
import { castIdlePose, castWalkPose, castWorkPose } from './ratkin/castRows';
import { hood, patches, trousers, tunic } from './ratkin/garments';
import type { HeldPropKind, RatkinOutfit } from './ratkin/outfit';
import type { Ramp } from './ratkin/paint';
import type { ToolKind } from '../../core/toolTiers';

function ramp(dark: string, mid: string, light: string): Ramp {
  return { dark, mid, light };
}

/** Pale, drained fur: the colour of something that used to be a rat. */
const THRALL_FUR = ramp('#4b5a52', '#7f9489', '#b3c7ba');
const THRALL_BELLY = ramp('#6d8277', '#a3b8ab', '#d2e2d6');
/** Grave-cloth: a grey-green gone threadbare, and darker patches sewn over the holes. */
const THRALL_CLOTH = ramp('#243329', '#3d5445', '#5d7a66');
const THRALL_PATCH = ramp('#1a261e', '#2c3d32', '#43594a');
const THRALL_THREAD = '#9fdcae';
/** The hood a shade deeper than the tunic, so the face sits in its shadow. */
const THRALL_HOOD = ramp('#18241c', '#2a3b30', '#415a49');
/** The eye bead lit from inside rather than dark. */
const THRALL_EYE = '#d8ffd9';

function thrallOutfit(heldProp: HeldPropKind): RatkinOutfit {
  return {
    fur: THRALL_FUR,
    belly: THRALL_BELLY,
    eyeTint: THRALL_EYE,
    build: 'slight',
    garments: [
      trousers({ cloth: THRALL_CLOTH, rolled: true }),
      tunic({ cloth: THRALL_CLOTH, sleeve: 'rolled' }),
      patches({ cloth: THRALL_PATCH, thread: THRALL_THREAD }),
      hood({ cloth: THRALL_HOOD }),
    ],
    heldProp,
    tailHip: 'left',
  };
}

/** The thrall's look with an axe; the pickman differs only in what it holds. */
export const THRALL_OUTFIT: RatkinOutfit = thrallOutfit('woodaxe');

const ALL_VIEWS: readonly RatKinView[] = ['front', 'side', 'away'];
/** The cast's work rows exist head-on and in profile; a thrall working away from the camera uses the profile. */
const WORK_VIEWS: readonly RatKinView[] = ['front', 'side'];

function thrallRows(prop: HeldPropKind): readonly CastRowSpec[] {
  const rows: CastRowSpec[] = [];
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('walk', view),
      role: 'walk',
      view,
      frameCount: WALK_FRAMES,
      loops: true,
      pose: (f) => castWalkPose(cyclePhase(f, WALK_FRAMES), view, prop),
    });
    rows.push({
      name: castStateName('idle', view),
      role: 'idle',
      view,
      frameCount: IDLE_FRAMES,
      loops: true,
      pose: (f) => castIdlePose(cyclePhase(f, IDLE_FRAMES), view, prop),
    });
  }
  // The field hand's overhead swing down to the ground is the one work loop
  // that is both a chop and a strike with a pick.
  for (const view of WORK_VIEWS) {
    rows.push({
      name: castStateName('work', view),
      role: 'work',
      view,
      frameCount: WORK_FRAMES,
      loops: true,
      pose: (f) => castWorkPose(cyclePhase(f, WORK_FRAMES), view, 'hoe'),
    });
  }
  return rows;
}

const THRALL_FIGURES: Readonly<Record<ToolKind, FigureDef>> = {
  axe: ratkinOutfitFigure('thrall_axe', THRALL_OUTFIT, thrallRows('woodaxe')),
  pickaxe: ratkinOutfitFigure('thrall_pick', thrallOutfit('pickaxe'), thrallRows('pickaxe')),
};

/** The thrall figure holding `tool`. */
export function thrallFigure(tool: ToolKind): FigureDef {
  return THRALL_FIGURES[tool];
}

/** Frames in the thrall's work loop, for pacing it to the harvest. */
export const THRALL_WORK_FRAMES = WORK_FRAMES;
