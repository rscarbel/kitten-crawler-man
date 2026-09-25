/**
 * The Grave Bull as a painted figure: the rows, the cell, and
 * `GRAVE_BULL_FIGURE`. The look, its decorations and its bones are in
 * `graveBullArt.ts`; the anatomy is the cow painter's.
 *
 * Rows:
 *    walk / walk_side / walk_away       16 frames, the cow's walk, head carried low
 *    idle / idle_side / idle_away       12 frames
 *    paw / paw_side / paw_away          10 frames — the charge telegraph
 *    charge / charge_side / charge_away 12 frames, looping, head down
 *    impact / impact_side / impact_away  8 frames — the recoil off a wall
 *    death_side                         12 frames, in profile, falling into its bones
 *    gore_*                              one frame each, loose bones
 *
 * The art invariants live in `scripts/gates-grave-bull.ts`:
 * `npm run render:grave-bull`.
 */

import { clamp01, easeInOut, easeOut } from './carlArt';
import { GROUND_Y, drawCow, type CowPose, type CowView } from './cowArt';
import { TILE_SCALE, cowRowsFor, cowStateName, strideFoot } from './cowFigure';
import {
  GRAVE_BULL_GORE_STATES,
  GRAVE_BULL_LOOK,
  GRAVE_BULL_SCALE,
  drawBullBonePile,
  drawGraveBullChains,
  drawHoofDust,
  graveBullLook,
  paintGraveBullGore,
  type GraveBullGoreState,
} from './graveBullArt';
import { COW_TILES_PER_TROT_CYCLE, COW_TILES_PER_WALK_CYCLE } from '../cowTiming';
import { type FigureDef, figureStates } from '../figure/figureDef';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

/** Poses are sampled at the middle of a frame's hold, not its start. */
const MID_FRAME = 0.5;

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * The cell: a 1.2× bull is well over two tiles long in profile, mirrored about
 * its tile's centre, and its horns and the chains off them stand high.
 */
const FRAME_WIDTH = 208;
const FRAME_HEIGHT = 168;
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
const TILE_Y = 78;
export const GRAVE_BULL_ORIGIN_X = FRAME_WIDTH / 2;
export const GRAVE_BULL_ORIGIN_Y = TILE_Y + TILE_SCALE / 2;
/** The ground line in the cell, which the bull is scaled up about. */
export const GRAVE_BULL_GROUND_Y = GRAVE_BULL_ORIGIN_Y + GROUND_Y * TILE_SCALE;

export const GRAVE_BULL_WALK_FRAMES = 16;
export const GRAVE_BULL_IDLE_FRAMES = 12;
export const GRAVE_BULL_PAW_FRAMES = 10;
export const GRAVE_BULL_CHARGE_FRAMES = 12;
export const GRAVE_BULL_IMPACT_FRAMES = 8;
export const GRAVE_BULL_DEATH_FRAMES = 12;

/** Ground the walk and the charge cover a cycle, in tiles: the cow's, at the bull's size. */
export const GRAVE_BULL_TILES_PER_WALK_CYCLE = COW_TILES_PER_WALK_CYCLE * GRAVE_BULL_SCALE;
export const GRAVE_BULL_TILES_PER_CHARGE_CYCLE = COW_TILES_PER_TROT_CYCLE * GRAVE_BULL_SCALE;

// ── Carriage ─────────────────────────────────────────────────────────────────

/** The head carried low and the ears pinned: a bull that means it. */
const MENACE_NECK = 0.18;
const MENACE_HEAD = 0.1;
const PINNED_EARS = -0.7;
/** The jaw hangs a little; the dead do not chew cud. */
const SLACK_JAW = 0.25;

function menace(pose: CowPose): CowPose {
  return {
    ...pose,
    neck: pose.neck + MENACE_NECK,
    headPitch: pose.headPitch + MENACE_HEAD,
    earL: PINNED_EARS,
    earR: PINNED_EARS,
    jaw: SLACK_JAW,
    jawSide: 0,
    eyeOpen: 1,
  };
}

const COW_ROWS = cowRowsFor('adult');

function cowRow(action: 'walk' | 'idle' | 'trot', view: CowView): (frame: number) => CowPose {
  const row = COW_ROWS.find((r) => r.name === cowStateName(action, view));
  if (row === undefined) throw new Error(`the cow paints no ${action} ${view}`);
  return row.pose;
}

// ── Paw: the charge telegraph ────────────────────────────────────────────────

/** Two scrapes of the forefoot back through the dirt, the head dropping lower each time. */
const PAW_SCRAPES = 2;
const PAW_REACH = 0.2;
const PAW_LIFT = 0.12;
/**
 * The head drops to knee height with the face level and the horns aimed
 * forward — any lower and the wind-up reads as a bull grazing.
 */
const PAW_NECK = 0.55;
const PAW_HEAD = -0.05;
const PAW_ROCK = 0.04;
const PAW_PITCH = 0.06;
/** It crouches onto its forequarters, set to go. */
const PAW_CROUCH = 0.05;
/** Share of the paw spent dropping the head, before it holds low for the scrapes. */
const PAW_LOWER_SPAN = 0.3;
/**
 * Share of each scrape the hoof is in the air reaching forward; the rest is
 * the drag back through the dirt, which is when the dust flies.
 */
const PAW_SWING_SHARE = 0.45;
const PAW_DRAG_SHARE = 0.55;
/** The snort comes late in each scrape, after the drag has started. */
const SNORT_FROM = 0.55;
const SNORT_SPAN = 0.45;
/** An agitated lash: three swings over the paw, near full width, carried high. */
const PAW_TAIL_LASHES = 3;
const PAW_TAIL_SWING = 0.8;
const PAW_TAIL_LIFT = 0.3;

export function pawPose(view: CowView, frame: number): CowPose {
  const t = (frame + MID_FRAME) / GRAVE_BULL_PAW_FRAMES;
  const base = menace(cowRow('idle', view)(0));
  const lower = easeInOut(clamp01(t / PAW_LOWER_SPAN));
  const scrape = strideFoot(t * PAW_SCRAPES, 0, PAW_REACH, PAW_LIFT, PAW_SWING_SHARE);
  return {
    ...base,
    neck: base.neck + lower * PAW_NECK,
    headPitch: base.headPitch + lower * PAW_HEAD,
    lunge: -Math.sin(t * PAW_SCRAPES * TWO_PI) * PAW_ROCK,
    bob: lower * PAW_CROUCH,
    pitch: lower * PAW_PITCH,
    frontR: scrape,
    tailSwing: Math.sin(t * TWO_PI * PAW_TAIL_LASHES) * PAW_TAIL_SWING,
    tailLift: PAW_TAIL_LIFT,
    time: t,
  };
}

/** How much dust is in the air at a frame: kicked up as each scrape drags back. */
export function scrapeAt(frame: number): number {
  const t = (frame + MID_FRAME) / GRAVE_BULL_PAW_FRAMES;
  const beat = (t * PAW_SCRAPES) % 1;
  return beat > PAW_SWING_SHARE ? (beat - PAW_SWING_SHARE) / PAW_DRAG_SHARE : 0;
}

/** How much snort is on screen at a frame: a puff at each scrape's end. */
export function snortAt(frame: number): number {
  const t = (frame + MID_FRAME) / GRAVE_BULL_PAW_FRAMES;
  const beat = (t * PAW_SCRAPES) % 1;
  return beat > SNORT_FROM ? (beat - SNORT_FROM) / SNORT_SPAN : 0;
}

// ── Charge ───────────────────────────────────────────────────────────────────

const CHARGE_NECK = 0.6;
const CHARGE_HEAD = 0.32;
const CHARGE_LUNGE = 0.06;
/** Low to the ground and pitched nose-down behind the horns. */
const CHARGE_CROUCH = 0.04;
const CHARGE_PITCH = 0.08;
const CHARGE_TAIL = 0.9;

export function chargePose(view: CowView, frame: number): CowPose {
  const trot = cowRow('trot', view)(frame);
  const base = menace(trot);
  return {
    ...base,
    neck: base.neck + CHARGE_NECK,
    headPitch: base.headPitch + CHARGE_HEAD,
    lunge: base.lunge + CHARGE_LUNGE,
    bob: base.bob + CHARGE_CROUCH,
    pitch: base.pitch + CHARGE_PITCH,
    tailLift: CHARGE_TAIL,
  };
}

// ── Impact ───────────────────────────────────────────────────────────────────

/** Rearing back off the wall, then settling, head shaking. */
const IMPACT_RECOIL: readonly number[] = [1, 0.85, 0.6, 0.45, 0.3, 0.18, 0.08, 0];
const IMPACT_PITCH = -0.3;
const IMPACT_LUNGE = -0.16;
const IMPACT_HEAD_SHAKE = 0.25;
/**
 * Radians of head shake per frame: not a divisor of the row, so the shake
 * does not repeat a pose while it dies away.
 */
const IMPACT_SHAKE_RATE = 1.9;
const IMPACT_HEAD_TILT = 0.2;
/** The rear lifts it off the ground and throws the neck up and back. */
const IMPACT_RISE = 0.03;
const IMPACT_NECK_RAISE = 0.2;
/** Both forefeet come up off the wall, the left a little higher and further. */
const IMPACT_FORE_LEFT = { dx: 0.1, dy: 0.14 } as const;
const IMPACT_FORE_RIGHT = { dx: 0.08, dy: 0.12 } as const;

export function impactPose(view: CowView, frame: number): CowPose {
  const base = menace(cowRow('idle', view)(0));
  const recoil = IMPACT_RECOIL[frame] ?? 0;
  const shake = Math.sin(frame * IMPACT_SHAKE_RATE) * (1 - frame / GRAVE_BULL_IMPACT_FRAMES);
  return {
    ...base,
    pitch: recoil * IMPACT_PITCH,
    lunge: recoil * IMPACT_LUNGE,
    bob: -recoil * IMPACT_RISE,
    neck: base.neck - recoil * IMPACT_NECK_RAISE,
    headTurn: shake * IMPACT_HEAD_SHAKE,
    headTilt: shake * IMPACT_HEAD_TILT,
    frontL: {
      dx: recoil * IMPACT_FORE_LEFT.dx,
      dy: -recoil * IMPACT_FORE_LEFT.dy,
      lift: recoil,
    },
    frontR: {
      dx: recoil * IMPACT_FORE_RIGHT.dx,
      dy: -recoil * IMPACT_FORE_RIGHT.dy,
      lift: recoil,
    },
    tailSwing: shake,
    time: frame / GRAVE_BULL_IMPACT_FRAMES,
  };
}

// ── Death ────────────────────────────────────────────────────────────────────

const DEATH_KNEES_END = 0.4;
const DEATH_HEAP_FROM = 0.3;
const DEATH_SETTLED_AT = 0.75;
/** The hind legs fold a beat after the fore, so it goes down front first. */
const DEATH_HIND_LAG = 0.15;
/** As the knees go the head drops and cocks, and the eyes half close. */
const DEATH_NECK_DROP = 0.4;
const DEATH_HEAD_TILT = 0.3;
const DEATH_EYE_CLOSE = 0.5;
/** The body starts flattening part-way into the fall, ahead of the bones showing. */
const DEATH_SQUASH_LEAD = 0.6;
/** Fully squashed, the body spreads a little and flattens nearly to the ground. */
const DEATH_SQUASH_SPREAD = 0.15;
const DEATH_SQUASH_FLATTEN = 0.85;

export function deathPose(frame: number): CowPose {
  const t = frame / (GRAVE_BULL_DEATH_FRAMES - 1);
  const base = menace(cowRow('idle', 'side')(0));
  const knees = easeOut(clamp01(t / DEATH_KNEES_END));
  return {
    ...base,
    lowerFore: knees,
    lowerHind: easeInOut(clamp01((t - DEATH_HIND_LAG) / DEATH_KNEES_END)),
    neck: base.neck + knees * DEATH_NECK_DROP,
    headTilt: knees * DEATH_HEAD_TILT,
    eyeOpen: 1 - knees * DEATH_EYE_CLOSE,
    time: t,
  };
}

function deathProgress(frame: number): { squash: number; heap: number } {
  const t = frame / (GRAVE_BULL_DEATH_FRAMES - 1);
  return {
    squash: easeInOut(
      clamp01(
        (t - DEATH_HEAP_FROM * DEATH_SQUASH_LEAD) /
          (DEATH_SETTLED_AT - DEATH_HEAP_FROM * DEATH_SQUASH_LEAD),
      ),
    ),
    heap: clamp01((t - DEATH_HEAP_FROM) / (DEATH_SETTLED_AT - DEATH_HEAP_FROM)),
  };
}

// ── Row table ────────────────────────────────────────────────────────────────

export type GraveBullAction = 'walk' | 'idle' | 'paw' | 'charge' | 'impact' | 'death';

export interface GraveBullRowSpec {
  readonly name: string;
  readonly action: GraveBullAction;
  readonly view: CowView;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly pose: (frame: number) => CowPose;
}

const ALL_VIEWS: readonly CowView[] = ['front', 'side', 'back'];

/**
 * Which views each action is painted in. The death is unaimed and drawn in
 * profile only: a bull falls onto its side, and only the side shows the heap
 * as the length of animal it was.
 */
export const GRAVE_BULL_ACTION_VIEWS: Readonly<Record<GraveBullAction, readonly CowView[]>> = {
  walk: ALL_VIEWS,
  idle: ALL_VIEWS,
  paw: ALL_VIEWS,
  charge: ALL_VIEWS,
  impact: ALL_VIEWS,
  death: ['side'],
};

/** The state name for an action in a view: `paw`, `paw_side`, `paw_away`. */
export function graveBullStateName(action: GraveBullAction, view: CowView): string {
  if (view === 'side') return `${action}_side`;
  if (view === 'back') return `${action}_away`;
  return action;
}

/**
 * Game ticks each frame is held for. The paw is the charge's telegraph:
 * `GRAVE_BULL_PAW_FRAMES × 6` is its 60-tick length. The walk and the charge
 * are paced by ground covered instead; their entries are for the preview.
 */
export const GRAVE_BULL_TICKS_PER_FRAME: Readonly<Record<GraveBullAction, number>> = {
  walk: 4,
  idle: 6,
  paw: 6,
  charge: 3,
  impact: 4,
  death: 5,
};

function rowsFor(
  action: GraveBullAction,
  frameCount: number,
  loops: boolean,
  pose: (view: CowView, frame: number) => CowPose,
): GraveBullRowSpec[] {
  return GRAVE_BULL_ACTION_VIEWS[action].map((view) => ({
    name: graveBullStateName(action, view),
    action,
    view,
    frameCount,
    loops,
    pose: (frame) => pose(view, frame),
  }));
}

export const GRAVE_BULL_ROWS: readonly GraveBullRowSpec[] = [
  ...rowsFor('walk', GRAVE_BULL_WALK_FRAMES, true, (v, f) => menace(cowRow('walk', v)(f))),
  ...rowsFor('idle', GRAVE_BULL_IDLE_FRAMES, true, (v, f) => menace(cowRow('idle', v)(f))),
  ...rowsFor('paw', GRAVE_BULL_PAW_FRAMES, false, pawPose),
  ...rowsFor('charge', GRAVE_BULL_CHARGE_FRAMES, true, chargePose),
  ...rowsFor('impact', GRAVE_BULL_IMPACT_FRAMES, false, impactPose),
  ...rowsFor('death', GRAVE_BULL_DEATH_FRAMES, false, (_v, f) => deathPose(f)),
];

export function graveBullRow(state: string): GraveBullRowSpec | undefined {
  return GRAVE_BULL_ROWS.find((row) => row.name === state);
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** How much bigger than a tile a gore piece's unit is painted. */
const GORE_TILES_PER_UNIT = 1.6;
/** Pixels per piece unit a loose bone is painted at. */
const GORE_UNIT = TILE_SCALE * GORE_TILES_PER_UNIT;

function isGoreState(state: string): state is GraveBullGoreState {
  return GRAVE_BULL_GORE_STATES.some((s) => s === state);
}

/** The cow painter's space, scaled up about the ground line under the tile. */
function intoBullSpace(ctx: Ctx): void {
  ctx.translate(GRAVE_BULL_ORIGIN_X, GRAVE_BULL_GROUND_Y);
  ctx.scale(TILE_SCALE * GRAVE_BULL_SCALE, TILE_SCALE * GRAVE_BULL_SCALE);
  ctx.translate(0, -GROUND_Y);
}

function paintGraveBullFrame(ctx: Ctx, state: string, frame: number): void {
  const row = graveBullRow(state);
  if (row === undefined) {
    if (!isGoreState(state)) return;
    ctx.save();
    ctx.translate(FRAME_WIDTH / 2, FRAME_HEIGHT / 2);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    paintGraveBullGore(ctx, state);
    ctx.restore();
    return;
  }
  const pose = row.pose(frame);
  ctx.save();
  intoBullSpace(ctx);
  if (row.action === 'death') {
    const { squash, heap } = deathProgress(frame);
    ctx.save();
    ctx.translate(0, GROUND_Y);
    ctx.scale(1 + squash * DEATH_SQUASH_SPREAD, 1 - squash * DEATH_SQUASH_FLATTEN);
    ctx.translate(0, -GROUND_Y);
    if (squash < 1) {
      drawCow(ctx, row.view, pose, GRAVE_BULL_LOOK);
      drawGraveBullChains(ctx, row.view, pose);
    }
    ctx.restore();
    if (heap > 0) {
      ctx.save();
      ctx.translate(0, GROUND_Y);
      drawBullBonePile(ctx, heap);
      ctx.restore();
    }
  } else {
    const snort = row.action === 'paw' ? snortAt(frame) : 0;
    // The eyes burn brighter as the wind-up builds, peaking as it breaks.
    const glare = row.action === 'paw' ? (frame + 1) / GRAVE_BULL_PAW_FRAMES : 0;
    drawCow(
      ctx,
      row.view,
      pose,
      row.action === 'paw' ? graveBullLook(snort, glare) : GRAVE_BULL_LOOK,
    );
    drawGraveBullChains(ctx, row.view, pose);
    if (row.action === 'charge' && row.view === 'side') {
      const b = GRAVE_BULL_LOOK.build;
      drawHoofDust(ctx, b.hindFootX + pose.hindL.dx + pose.lunge, GROUND_Y, pose.hindL.lift);
      drawHoofDust(ctx, b.hindFootX + pose.hindR.dx + pose.lunge, GROUND_Y, pose.hindR.lift);
    }
    if (row.action === 'paw' && row.view === 'side') {
      drawHoofDust(
        ctx,
        GRAVE_BULL_LOOK.build.foreFootX + pose.frontR.dx + pose.lunge,
        GROUND_Y,
        scrapeAt(frame),
      );
    }
  }
  ctx.restore();
}

function graveBullStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of GRAVE_BULL_ROWS) frames[row.name] = row.frameCount;
  for (const state of GRAVE_BULL_GORE_STATES) frames[state] = 1;
  return frames;
}

export const GRAVE_BULL_FIGURE: FigureDef = {
  id: 'grave_bull',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(graveBullStateFrames()),
  paintFrame: paintGraveBullFrame,
};
