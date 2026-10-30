/**
 * The Hawkfolk who flies in through the cattery's observatory window during
 * the Warden's binding to carry one bound cat out: Deacon Aviel himself, in
 * his temple robe and circlet, or a High Roost hawk sent in his place. Both
 * are the town's own Hawkfolk on the shared rig, wearing the looks they wear
 * on the street, so the figure the player sees fly in is one they have met.
 *
 * Rows, all looping wingbeats unless marked:
 *    fly_down / fly_up      8 frames, legs tucked under
 *    carry_down / carry_up  8 frames, legs hung straight with the talons closed on a cat
 *    stoop_side             8 frames, one-shot: settle, reach down to the cat, spring off
 *
 * Flight has no profile row: side on, the rig folds a spread wing into the
 * body and the beat stops reading, so a bird crossing the room is drawn from
 * above, facing the camera or away from it.
 *
 * The bird flies at whatever height its caller lifts it to; every row is
 * painted standing on its own ground line, so the caller's shadow and the
 * figure's feet stay one translate apart.
 */

import { deg, easeInOut, hump, lerp } from './bipedArt';
import {
  drawHawkfolk,
  hawkfolkRestingPose,
  type HawkfolkLegPose,
  type HawkfolkPose,
  type HawkfolkView,
  type HawkfolkWingPose,
} from './hawkfolk/rig';
import { hawkfolkLookById, type HawkfolkLook, type HawkfolkLookId } from './hawkfolk/cast';
import { HAWKFOLK_BUILDS } from './hawkfolk/palette';
import { HAWKFOLK_CAST_SCALE, HAWKFOLK_CAST_TILE_SCALE } from './hawkfolkCastFigure';
import { rgba } from './town/townArt';
import type { RGB } from './town/townPalette';
import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawFigureCached, prewarmFigureState } from '../figure/figureFrameCache';

/** Who the party's choice about Aviel sent through the window. */
export type TowerCarrierKind = 'deacon_aviel' | 'roost_hawk';

const CARRIER_LOOKS = {
  deacon_aviel: 'resident_deacon_aviel',
  roost_hawk: 'noble_goldenbarred_standard',
} as const satisfies Record<TowerCarrierKind, HawkfolkLookId>;

/** What the carrier is doing, as far as its figure is concerned. */
export type TowerCarrierAction = 'fly' | 'carry' | 'stoop';

const FLAP_FRAMES = 8;
const STOOP_FRAMES = 8;
const FULL_TURN = Math.PI * 2;

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Wide enough for both wings at the top of the upstroke, flight feathers fanned. */
const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 176;
const GROUND_MARGIN = 14;
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = FRAME_HEIGHT - GROUND_MARGIN;
/** Matches the street cast, so a carrier stands the height of the same Hawkfolk on the street. */
const GROUND_OFFSET_IN_TILE = 0.9;
const TILE_X = (FRAME_WIDTH - HAWKFOLK_CAST_TILE_SCALE) / 2;
const TILE_Y = Math.round(ORIGIN_Y - HAWKFOLK_CAST_TILE_SCALE * GROUND_OFFSET_IN_TILE);

// ── Poses ────────────────────────────────────────────────────────────────────

const REST = hawkfolkRestingPose();

/**
 * The wingbeat: spread just past level at the bottom of the downstroke and
 * raised into a high V at the top of the upstroke, flight feathers fanned the
 * whole way. A wing that folds on the upstroke reads as a flail at 32px.
 */
const DOWNSTROKE_SPREAD = 1.15;
const UPSTROKE_SPREAD = 2.5;
const DOWNSTROKE_ELBOW = 0.15;
const UPSTROKE_ELBOW = 0.6;
/** The body rides up a little on each downstroke. */
const FLAP_BOB = 0.05;
const FLIGHT_LEAN = deg(14);

/** Legs folded up under the body in flight, talons closed. */
const TUCKED_LEG: HawkfolkLegPose = {
  footAhead: -0.06,
  footOut: 0.05,
  footLift: 0.28,
  tarsusTilt: deg(-55),
  toeCurl: 1,
};
/** Legs hung straight down under a cat, talons closed on her. */
const CARRY_LEG: HawkfolkLegPose = {
  footAhead: 0.02,
  footOut: 0.06,
  footLift: 0.04,
  tarsusTilt: deg(-8),
  toeCurl: 1,
};
const HALF = 0.5;

function flapWing(phase: number): HawkfolkWingPose {
  const raised = HALF + HALF * Math.cos(phase * FULL_TURN);
  return {
    shoulderSwing: 0,
    shoulderSpread: lerp(DOWNSTROKE_SPREAD, UPSTROKE_SPREAD, raised),
    elbowBend: lerp(DOWNSTROKE_ELBOW, UPSTROKE_ELBOW, raised),
    handOpen: 1,
    flare: 1,
  };
}

function flightPose(phase: number, leg: HawkfolkLegPose): HawkfolkPose {
  const raised = HALF + HALF * Math.cos(phase * FULL_TURN);
  const wing = flapWing(phase);
  return {
    ...REST,
    bob: -(1 - raised) * FLAP_BOB,
    lean: FLIGHT_LEAN,
    nearLeg: leg,
    farLeg: leg,
    nearWing: wing,
    farWing: wing,
  };
}

/** Of the stoop, where the landing has settled and where the reach is deepest. */
const STOOP_SETTLED = 0.3;
const STOOP_REACHED = 0.65;
const STOOP_CROUCH = 0.7;
const STOOP_LEAN = deg(34);
const STOOP_HEAD_DROP = 0.08;
/** Wings mantled half open over the cat while the bird bends to her. */
const MANTLE_SPREAD = 0.7;
const MANTLE_ELBOW = 0.2;
const LANDING_SPREAD = 1.9;
/** The spring off the floor at the end of the stoop, rig units. */
const SPRING_LIFT = 0.12;
const STOOP_FOOT_AHEAD = 0.05;

/**
 * Lands, bends to the cat with its wings mantled over her, and springs off
 * with her: the landing wings folding in, the reach, then the wings thrown up
 * for the first beat as the legs straighten.
 */
function stoopPose(progress: number): HawkfolkPose {
  const settling = Math.min(1, progress / STOOP_SETTLED);
  const reach = hump(Math.min(1, progress / STOOP_REACHED));
  const springing = Math.max(0, (progress - STOOP_REACHED) / (1 - STOOP_REACHED));
  const spread = lerp(
    lerp(LANDING_SPREAD, MANTLE_SPREAD, easeInOut(settling)),
    UPSTROKE_SPREAD,
    easeInOut(springing),
  );
  const wing: HawkfolkWingPose = {
    shoulderSwing: 0,
    shoulderSpread: spread,
    elbowBend: lerp(MANTLE_ELBOW, UPSTROKE_ELBOW, springing),
    handOpen: 1,
    flare: 1,
  };
  const planted: HawkfolkLegPose = { ...REST.nearLeg, footAhead: STOOP_FOOT_AHEAD };
  const leg: HawkfolkLegPose =
    springing > 0 ? { ...CARRY_LEG, footLift: springing * SPRING_LIFT } : planted;
  return {
    ...REST,
    crouch: STOOP_CROUCH * reach,
    lean: lerp(STOOP_LEAN * reach, FLIGHT_LEAN, springing),
    bob: -springing * SPRING_LIFT,
    headDrop: STOOP_HEAD_DROP * reach,
    nearLeg: leg,
    farLeg: leg,
    nearWing: wing,
    farWing: wing,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface CarrierRow {
  readonly name: string;
  readonly view: HawkfolkView;
  readonly frames: number;
  readonly pose: (frame: number) => HawkfolkPose;
}

/** Which way a flying carrier faces: toward the camera or away from it. */
export type TowerCarrierFlightView = Extract<HawkfolkView, 'down' | 'up'>;

const VIEWS: readonly TowerCarrierFlightView[] = ['down', 'up'];

/** The row an action plays in a view. The stoop is only ever seen side on. */
function towerCarrierState(action: TowerCarrierAction, view: TowerCarrierFlightView): string {
  if (action === 'stoop') return 'stoop_side';
  return `${action}_${view}`;
}

const ROWS: readonly CarrierRow[] = [
  ...VIEWS.map((view): CarrierRow => ({
    name: towerCarrierState('fly', view),
    view,
    frames: FLAP_FRAMES,
    pose: (frame) => flightPose(frame / FLAP_FRAMES, TUCKED_LEG),
  })),
  ...VIEWS.map((view): CarrierRow => ({
    name: towerCarrierState('carry', view),
    view,
    frames: FLAP_FRAMES,
    pose: (frame) => flightPose(frame / FLAP_FRAMES, CARRY_LEG),
  })),
  {
    name: towerCarrierState('stoop', 'down'),
    view: 'side',
    frames: STOOP_FRAMES,
    pose: (frame) => stoopPose(frame / (STOOP_FRAMES - 1)),
  },
];

const ROWS_BY_NAME: ReadonlyMap<string, CarrierRow> = new Map(ROWS.map((row) => [row.name, row]));

function carrierPainter(look: HawkfolkLook) {
  const scale = HAWKFOLK_CAST_SCALE * HAWKFOLK_BUILDS[look.outfit.build].scale;
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = ROWS_BY_NAME.get(state);
    if (row === undefined) return;
    ctx.save();
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(HAWKFOLK_CAST_TILE_SCALE * scale, HAWKFOLK_CAST_TILE_SCALE * scale);
    drawHawkfolk(ctx, row.view, row.pose(frame), look.outfit);
    ctx.restore();
  };
}

function carrierFigureOf(kind: TowerCarrierKind): FigureDef {
  const frames: Record<string, number> = {};
  for (const row of ROWS) frames[row.name] = row.frames;
  return {
    id: `tower_carrier_${kind}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: HAWKFOLK_CAST_TILE_SCALE,
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: carrierPainter(hawkfolkLookById(CARRIER_LOOKS[kind])),
  };
}

const FIGURES: Readonly<Record<TowerCarrierKind, FigureDef>> = {
  deacon_aviel: carrierFigureOf('deacon_aviel'),
  roost_hawk: carrierFigureOf('roost_hawk'),
};

export function towerCarrierFigure(kind: TowerCarrierKind): FigureDef {
  return FIGURES[kind];
}

/** Every row the carrier plays, warmed before it flies in so its first beat is never a cold bake. */
export function prewarmTowerCarrier(kind: TowerCarrierKind): void {
  for (const row of ROWS) prewarmFigureState(FIGURES[kind], row.name);
}

/**
 * Draws the carrier with its feet on the ground point (`groundX`, `groundY`),
 * screen pixels, lifted `heightPx` off it. A wingbeat row loops on `beat`
 * (any real number of frames); the stoop plays once through `beat` 0..1,
 * side on, facing the cat it bends to, and ignores `view`.
 */
export function drawTowerCarrier(
  ctx: CanvasRenderingContext2D,
  kind: TowerCarrierKind,
  action: TowerCarrierAction,
  view: TowerCarrierFlightView,
  facingLeft: boolean,
  beat: number,
  groundX: number,
  groundY: number,
  heightPx: number,
  tileSize: number,
): void {
  const figure = FIGURES[kind];
  const state = towerCarrierState(action, view);
  const frame =
    action === 'stoop'
      ? Math.min(STOOP_FRAMES - 1, Math.floor(beat * STOOP_FRAMES))
      : Math.floor(((beat % FLAP_FRAMES) + FLAP_FRAMES) % FLAP_FRAMES);
  const tileLeft = groundX - tileSize * HALF;
  const tileTop = groundY - heightPx - tileSize * GROUND_OFFSET_IN_TILE;
  const flipX = facingLeft && action === 'stoop';
  drawFigureCached(ctx, figure, state, frame, tileLeft, tileTop, tileSize, { flipX });
}

/** Shadow width and depth on the floor under the carrier, as shares of a tile; it shrinks as the bird climbs. */
const SHADOW_WIDTH_TILES = 0.9;
const SHADOW_DEPTH_TILES = 0.22;
const SHADOW_ALPHA = 0.3;
const SHADOW_HIGH_SHRINK = 0.45;
/** The flight height at which the shadow has shrunk all it will. */
const SHADOW_HIGH_TILES = 1.5;
const SHADOW_INK: RGB = [0, 0, 0];

/** The carrier's shadow on the floor at (`groundX`, `groundY`), screen pixels: where over the room it is. */
export function drawTowerCarrierShadow(
  ctx: CanvasRenderingContext2D,
  groundX: number,
  groundY: number,
  heightPx: number,
  tileSize: number,
  alpha = 1,
): void {
  const climb = Math.min(1, heightPx / (SHADOW_HIGH_TILES * tileSize));
  const shrink = 1 - SHADOW_HIGH_SHRINK * climb;
  ctx.save();
  ctx.fillStyle = rgba(SHADOW_INK, SHADOW_ALPHA * alpha);
  ctx.beginPath();
  ctx.ellipse(
    groundX,
    groundY,
    tileSize * SHADOW_WIDTH_TILES * HALF * shrink,
    tileSize * SHADOW_DEPTH_TILES * HALF * shrink,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();
}
