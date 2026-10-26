/**
 * The Sequin Tailcoat on the human crawler: a ringmaster's red coat crusted
 * with sequins, frogged in gold across the chest, cut away square at the
 * front of the waist, with two tails hanging behind to the backs of his
 * knees. At the tile it is a bright red body and sleeves, a white shirtfront
 * in the V of the lapels, gold bars across the chest, a scatter of sparkle,
 * and from behind or edge-on the two tails below his waist.
 *
 * It covers his chest: the coat's own white dress shirtfront fills the V, so
 * whatever shirt his look wears under it would only fight it at the collar.
 */

import type { BipedBackFrame, BipedTorsoFrame } from '../../art/biped/bipedParts';
import { deriveGlossRamp } from '../../art/biped/palette';
import type { TorsoFrame } from '../../art/biped/torso';
import { pt } from '../../art/biped/geometry';
import { rgba, type Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { coatSkirt, paintSkirt, skirtPieceIs, type SkirtCut, type SkirtShape } from './coatSkirt';
import { fillPolygon, paintCoverBody, withDeepShade, strokeLine, withinTorso } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** The cat's ringmaster red, so the two crawlers' coats are the one coat. */
const RINGMASTER_RED = withDeepShade(deriveGlossRamp('#c41e2a'));
const GOLD = '#f0c93c';
const SHIRTFRONT = '#efe8da';
const SHIRTFRONT_SHADE = '#bdb2a0';
const BOW_TIE = '#1d1418';
/** The sequins catch the light white-pink against the red, as on the cat's coat. */
const SEQUIN = '#ffd6cc';
const SEQUIN_GLINT = '#ffffff';

/** Satin over padding folds softer than leather. */
const SATIN_FOLD_WEIGHT = 0.6;
const SATIN_SEAM_WEIGHT = 0.5;

/** The V of the lapels head-on, down to where the coat closes over his chest. */
const V_TOP_HALF = 0.1;
const V_TOP_Y = -0.06;
const V_BOTTOM_Y = 0.22;
const SHIRTFRONT_SHADE_ALPHA = 0.6;
const SHIRTFRONT_SHADE_HALF = 0.015;
/** The lapels' gold-edged fronts, standing out past the V either side. */
const LAPEL_TRIM_WIDTH = 0.028;
/** A black bow at the throat. */
const BOW_Y = -0.02;
const BOW_HALF = 0.05;
const BOW_HEIGHT = 0.03;

/** Gold frogging: bars across his chest below the V, each ending in a gold knot. */
const FROG_YS: readonly number[] = [0.26, 0.33];
const FROG_HALF = 0.13;
const FROG_WIDTH = 0.026;
const FROG_KNOT_RADIUS = 0.022;
/** Edge-on, the bars are short stubs at the front of his chest. */
const PROFILE_FROG_FRONT = 0.22;
const PROFILE_FROG_BACK = 0.1;
const PROFILE_LAPEL_X = 0.19;
const PROFILE_LAPEL_TOP_Y = -0.02;

/** A gold band along the coat's square-cut front hem. */
const HEM_TRIM_RISE = 0.025;
const HEM_TRIM_WIDTH = 0.03;
/** How far past the torso a band runs, so the clip, not its end, finishes it at his sides. */
const OVERREACH = 0.5;
/** The two gold buttons at the back of the waist the tails hang from. */
const BACK_BUTTON_HALF = 0.07;
const BACK_COLLAR_HALF = 0.11;
const BACK_COLLAR_Y = -0.04;

/** Sequins on a grid; one point in `SEQUIN_EVERY` catches the light, one in `GLINT_EVERY` of those blazes. */
const SEQUIN_PITCH = 0.06;
const SEQUIN_RADIUS = 0.014;
const SEQUIN_EVERY = 3;
const GLINT_EVERY = 3;
/** Large odd multipliers and a fold that scatter the lit sequins. */
const SEQUIN_HASH_ROW = 0x9e3779b1;
const SEQUIN_HASH_COLUMN = 0x85ebca6b;
const SEQUIN_HASH_SHIFT = 13;
/** The grid spans this far round the torso frame's origin, enough to cover the coat. */
const TORSO_SEQUIN_HALF = 0.36;
const TORSO_SEQUIN_TOP = -0.1;
const TORSO_SEQUIN_BOTTOM = 0.62;
/** Down the tails the grid runs in the skirt's own u, v, this many points across and down. */
const TAIL_SEQUIN_ACROSS = 7;
const TAIL_SEQUIN_DOWN = 8;
const FULL_TURN = Math.PI * 2;
/** Each sequin sits in the middle of its grid cell. */
const CELL_CENTRE = 0.5;

/** Two tails from the waist to the backs of his knees, parted up most of their length. */
const TAILS: SkirtCut = {
  length: 0.62,
  waistHalf: 0.19,
  hemHalf: 0.22,
  profileBehind: 0.14,
  profileFrontShare: -0.3,
  profileAhead: 0,
  splitRise: 0.75,
  splitOpen: 0.7,
};
const TAIL_PIPING_WIDTH = 0.026;

function sequinLit(row: number, column: number): number | null {
  const hash = Math.imul(row, SEQUIN_HASH_ROW) ^ Math.imul(column, SEQUIN_HASH_COLUMN);
  const folded = (hash ^ (hash >>> SEQUIN_HASH_SHIFT)) >>> 0;
  if (folded % SEQUIN_EVERY !== 0) return null;
  return Math.floor(folded / SEQUIN_EVERY) % GLINT_EVERY;
}

function paintSequin(ctx: Ctx, p: Pt, glint: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, SEQUIN_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = glint === 0 ? SEQUIN_GLINT : SEQUIN;
  ctx.fill();
}

function paintTorsoSequins(ctx: Ctx, torso: TorsoFrame, depth: number): void {
  const columns = Math.ceil((TORSO_SEQUIN_HALF * 2) / SEQUIN_PITCH);
  const rows = Math.ceil((TORSO_SEQUIN_BOTTOM - TORSO_SEQUIN_TOP) / SEQUIN_PITCH);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const glint = sequinLit(row, column);
      if (glint === null) continue;
      const x = (-TORSO_SEQUIN_HALF + column * SEQUIN_PITCH) * depth;
      paintSequin(ctx, torso.at(x, TORSO_SEQUIN_TOP + row * SEQUIN_PITCH), glint);
    }
  }
}

function paintShirtfront(ctx: Ctx, torso: TorsoFrame): void {
  const { at } = torso;
  const left = at(-V_TOP_HALF, V_TOP_Y);
  const right = at(V_TOP_HALF, V_TOP_Y);
  const point = at(0, V_BOTTOM_Y);
  fillPolygon(ctx, [left, right, point], SHIRTFRONT);
  strokeLine(
    ctx,
    [at(0, V_TOP_Y), point],
    rgba(SHIRTFRONT_SHADE, SHIRTFRONT_SHADE_ALPHA),
    SHIRTFRONT_SHADE_HALF,
  );
  strokeLine(ctx, [left, point, right], GOLD, LAPEL_TRIM_WIDTH);
  const bow = at(0, BOW_Y);
  fillPolygon(
    ctx,
    [
      pt(bow.x - BOW_HALF, bow.y - BOW_HEIGHT),
      pt(bow.x + BOW_HALF, bow.y + BOW_HEIGHT),
      pt(bow.x + BOW_HALF, bow.y - BOW_HEIGHT),
      pt(bow.x - BOW_HALF, bow.y + BOW_HEIGHT),
    ],
    BOW_TIE,
  );
}

function paintGoldKnot(ctx: Ctx, p: Pt): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, FROG_KNOT_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = GOLD;
  ctx.fill();
}

function paintFrogging(ctx: Ctx, torso: TorsoFrame): void {
  for (const y of FROG_YS) {
    const left = torso.at(-FROG_HALF, y);
    const right = torso.at(FROG_HALF, y);
    strokeLine(ctx, [left, right], GOLD, FROG_WIDTH);
    paintGoldKnot(ctx, left);
    paintGoldKnot(ctx, right);
  }
}

function paintProfileFront(ctx: Ctx, torso: TorsoFrame): void {
  const depth = torso.cut.profileDepth;
  const lapelX = PROFILE_LAPEL_X * depth;
  strokeLine(
    ctx,
    [torso.at(lapelX, PROFILE_LAPEL_TOP_Y), torso.at(lapelX, V_BOTTOM_Y)],
    GOLD,
    LAPEL_TRIM_WIDTH,
  );
  for (const y of FROG_YS) {
    strokeLine(
      ctx,
      [torso.at(PROFILE_FROG_BACK * depth, y), torso.at(PROFILE_FROG_FRONT * depth, y)],
      GOLD,
      FROG_WIDTH,
    );
  }
}

function paintHemTrim(ctx: Ctx, torso: TorsoFrame): void {
  strokeLine(
    ctx,
    [torso.hem(-OVERREACH, -HEM_TRIM_RISE), torso.hem(OVERREACH, -HEM_TRIM_RISE)],
    GOLD,
    HEM_TRIM_WIDTH,
  );
}

function paintBackDetail(ctx: Ctx, torso: TorsoFrame): void {
  for (const side of [-1, 1]) paintGoldKnot(ctx, torso.at(side * BACK_BUTTON_HALF, torso.waistY));
  strokeLine(
    ctx,
    [torso.at(-BACK_COLLAR_HALF, BACK_COLLAR_Y), torso.at(BACK_COLLAR_HALF, BACK_COLLAR_Y)],
    GOLD,
    LAPEL_TRIM_WIDTH,
  );
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  paintCoverBody(ctx, frame, context, RINGMASTER_RED, {
    foldWeight: SATIN_FOLD_WEIGHT,
    seamWeight: SATIN_SEAM_WEIGHT,
  });
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    paintTorsoSequins(ctx, torso, view.profile ? torso.cut.profileDepth : 1);
    paintHemTrim(ctx, torso);
    if (view.profile) {
      paintProfileFront(ctx, torso);
      return;
    }
    if (view.showsBack) {
      paintBackDetail(ctx, torso);
      return;
    }
    paintFrogging(ctx, torso);
  });
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar' && !frame.view.profile && !frame.view.showsBack) {
    paintShirtfront(ctx, frame.torso);
  }
}

function paintTailSequins(ctx: Ctx, skirt: SkirtShape): void {
  for (let row = 0; row < TAIL_SEQUIN_DOWN; row++) {
    for (let column = 0; column < TAIL_SEQUIN_ACROSS; column++) {
      const glint = sequinLit(row + TAIL_SEQUIN_DOWN, column);
      if (glint === null) continue;
      const acrossShare = (column + CELL_CENTRE) / TAIL_SEQUIN_ACROSS;
      const u = acrossShare * 2 - 1;
      const v = (row + CELL_CENTRE) / TAIL_SEQUIN_DOWN;
      paintSequin(ctx, skirt.at(u, v), glint);
    }
  }
}

function paintBack(ctx: Ctx, frame: BipedBackFrame): void {
  if (!skirtPieceIs(frame)) return;
  const skirt = coatSkirt(frame, TAILS);
  // Head-on the tails hang behind his legs; what shows of them past his
  // thighs is a sliver either side that reads as something floating there.
  if (!frame.view.profile && !frame.view.showsBack) return;
  paintSkirt(ctx, skirt, RINGMASTER_RED, () => {
    paintTailSequins(ctx, skirt);
    withClip(
      ctx,
      () => skirt.trace(ctx),
      () => {
        skirt.trace(ctx);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = TAIL_PIPING_WIDTH;
        ctx.stroke();
      },
    );
  });
}

export const SEQUIN_TAILCOAT = defineGarment({
  id: 'human_sequin_tailcoat',
  name: 'Sequin Tailcoat',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['torso', 'back'],
  covers: ['chest'],
  sleeves: { cloth: RINGMASTER_RED },
  paint: { torso: humanEveryView(paintTorso), back: humanEveryView(paintBack) },
});
