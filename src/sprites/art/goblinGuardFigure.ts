/**
 * The prison goblins as painted figures: the patrol guard, the gate guard and
 * the prisoner. Choreography, cell geometry and the three `FigureDef`s.
 *
 * None of them fights, so there are no attack rows. The guards' walk, idle and
 * flinch borrow the sword goblin's legs and breath through {@link poseFor} and
 * re-place the arms: a baton in the near hand, and for a patrol guard a
 * flashlight held out ahead in the far hand. Their own rows — the patrol's
 * sweep and alert, the gate guard's talk, the prisoner's rattle, lean and
 * heckle — are authored here as edits to those poses.
 *
 * Every figure is drawn facing +X; the runtime mirrors it for the other facing.
 * The art invariants live in `scripts/gates-goblin-guard.ts`:
 * `npm run render:goblin-guard`.
 */

import {
  ARCHETYPE_SCALE,
  along,
  buildSkeleton,
  deg,
  drawGoblin,
  farArmSpan,
  lerp,
  offHandWristAngle,
  restingPose,
  shoulderHeight,
  type GoblinPose,
  type GoblinProp,
  type GoblinStyle,
  type Pt,
} from './goblinArt';
import {
  FLASHLIGHT_LENS_DISTANCE,
  GOBLIN_GATE_GUARD_STYLE,
  GOBLIN_GUARD_SCALE,
  GOBLIN_GUARD_STYLE,
  GOBLIN_PRISONER_SCALE,
  GOBLIN_PRISONER_STYLE,
  makeEmptyGripProp,
  makeFlashlightProp,
  makeGuardBatonProp,
} from './goblinGuardArt';
import {
  ROWS,
  TILE_SCALE,
  cyclePhase,
  goblinWalkGroundPerCycleTiles,
  poseFor,
  type RowSpec,
} from './goblinFigure';
import { type FigureDef, figureStates } from '../figure/figureDef';

const FULL_CYCLE = Math.PI * 2;

/** Whose legs and breath the guards borrow. */
const CHOREOGRAPHY = 'sword';

function sharedRow(name: string): RowSpec {
  const row = ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`the goblin rows have no "${name}"`);
  return row;
}

const WALK_ROW = sharedRow('walk');
const IDLE_ROW = sharedRow('idle');
const FLINCH_ROW = sharedRow('flinch');

/** The patrol guard's rows. */
export const GOBLIN_GUARD_ROWS: readonly RowSpec[] = [
  WALK_ROW,
  IDLE_ROW,
  { name: 'sweep', frameCount: 24, kind: 'loop' },
  { name: 'alert', frameCount: 8, kind: 'loop' },
  FLINCH_ROW,
];

/** The gate guard's rows. */
export const GOBLIN_GATE_GUARD_ROWS: readonly RowSpec[] = [
  WALK_ROW,
  IDLE_ROW,
  { name: 'talk', frameCount: 16, kind: 'loop' },
  FLINCH_ROW,
];

/** The prisoner's rows: scenery idles, all loops. */
export const GOBLIN_PRISONER_ROWS: readonly RowSpec[] = [
  { name: 'idle', frameCount: 16, kind: 'loop' },
  { name: 'rattle', frameCount: 12, kind: 'loop' },
  { name: 'lean', frameCount: 16, kind: 'loop' },
  { name: 'heckle', frameCount: 12, kind: 'loop' },
];

/** Ground one guard walk cycle covers, in tiles: the sword gait at the guard's draw scale. */
export const GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES =
  (goblinWalkGroundPerCycleTiles(CHOREOGRAPHY) * GOBLIN_GUARD_SCALE) /
  ARCHETYPE_SCALE[CHOREOGRAPHY];

const BATON = makeGuardBatonProp();
const FLASHLIGHT = makeFlashlightProp();
const EMPTY_GRIP = makeEmptyGripProp();

function rowIn(rows: readonly RowSpec[], figure: string, state: string): RowSpec {
  const row = rows.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`${figure} paints no row "${state}"`);
  return row;
}

/** A sine on the row's own loop, `cycles` whole turns per loop so it seams. */
function loopWave(frame: number, frameCount: number, cycles = 1): number {
  return Math.sin(cyclePhase(frame, frameCount) * FULL_CYCLE * cycles);
}

function armLength(style: GoblinStyle): number {
  return style.proportions.upperArmLength + style.proportions.forearmLength;
}

// ── The patrol guard ─────────────────────────────────────────────────────────

/**
 * How the lamp arm is held, as a direction from the far shoulder (radians below
 * forward), a share of the arm's reach, and the lamp's own angle. Held out
 * ahead of the belly, pointing at the floor a few tiles on: where the cone
 * lands in the world.
 */
interface LampHold {
  readonly armAngle: number;
  readonly reach: number;
  readonly beam: number;
}

const WALK_LAMP: LampHold = { armAngle: deg(18), reach: 0.96, beam: deg(12) };
const IDLE_LAMP: LampHold = { armAngle: deg(22), reach: 0.95, beam: deg(18) };
/** Struck, he keeps the lamp but it drops toward the floor with his arm. */
const FLINCH_LAMP: LampHold = { armAngle: deg(18), reach: 0.98, beam: deg(34) };
/** The sweep swings the lamp arm between these two holds and back, once a loop. */
const SWEEP_LAMP_LOW: LampHold = { armAngle: deg(46), reach: 0.9, beam: deg(28) };
const SWEEP_LAMP_HIGH: LampHold = { armAngle: deg(18), reach: 0.95, beam: deg(2) };
const SWEEP_LEAN = deg(4);
const SWEEP_HEAD_LEAD = 0.035;
const SWEEP_HEAD_TILT = deg(5);
/** The alert: lamp thrust out at eye level, pointing. */
const ALERT_LAMP: LampHold = { armAngle: deg(-18), reach: 0.97, beam: deg(-4) };
/** The alert baton: raised from the near shoulder, angled up and forward. */
const ALERT_BATON_ARM_ANGLE = deg(72);
const ALERT_BATON_REACH = 0.62;
const ALERT_BATON_ANGLE = deg(-40);
const ALERT_MOUTH = 0.7;
const ALERT_SHOUT_PULSE = 0.25;
const ALERT_LEAN = deg(-3);
const ALERT_HEAD_LEAD = 0.04;
const ALERT_HEAD_TILT = deg(-5);
const ALERT_BOB = 0.012;

function holdLamp(style: GoblinStyle, pose: GoblinPose, hold: LampHold): GoblinPose {
  const shoulder = buildSkeleton(style, pose).farShoulder;
  return {
    ...pose,
    farHand: along(shoulder, hold.armAngle, farArmSpan(style.proportions) * hold.reach),
    offHandAngle: hold.beam,
  };
}

function lerpHold(a: LampHold, b: LampHold, t: number): LampHold {
  return {
    armAngle: lerp(a.armAngle, b.armAngle, t),
    reach: lerp(a.reach, b.reach, t),
    beam: lerp(a.beam, b.beam, t),
  };
}

/** The idle's pose resampled onto another loop's length, so its breath seams there too. */
function idleOn(style: GoblinStyle, frame: number, frameCount: number): GoblinPose {
  const idleFrame = (frame / frameCount) * IDLE_ROW.frameCount;
  return poseFor(CHOREOGRAPHY, style, BATON, IDLE_ROW, idleFrame);
}

function sweepPose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_GUARD_STYLE;
  const base = idleOn(style, frame, frameCount);
  const wave = loopWave(frame, frameCount);
  const rise = (wave + 1) / 2;
  return holdLamp(
    style,
    {
      ...base,
      lean: base.lean + SWEEP_LEAN * wave,
      headLead: base.headLead + SWEEP_HEAD_LEAD * wave,
      headTilt: base.headTilt - SWEEP_HEAD_TILT * wave,
      eyeOpen: 1,
    },
    lerpHold(SWEEP_LAMP_LOW, SWEEP_LAMP_HIGH, rise),
  );
}

function alertPose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_GUARD_STYLE;
  const base = idleOn(style, frame, frameCount);
  const shout = loopWave(frame, frameCount, 2);
  const braced: GoblinPose = {
    ...base,
    bob: base.bob - ALERT_BOB * Math.abs(shout),
    lean: ALERT_LEAN,
    headLead: ALERT_HEAD_LEAD,
    headTilt: ALERT_HEAD_TILT,
    mouthOpen: ALERT_MOUTH + ALERT_SHOUT_PULSE * Math.abs(shout),
    eyeOpen: 1,
    offHandInFront: true,
  };
  const nearShoulder = buildSkeleton(style, braced).nearShoulder;
  return holdLamp(
    style,
    {
      ...braced,
      nearHand: along(nearShoulder, ALERT_BATON_ARM_ANGLE, armLength(style) * ALERT_BATON_REACH),
      weaponAngle: ALERT_BATON_ANGLE,
    },
    ALERT_LAMP,
  );
}

/** The pose one frame of one of the patrol guard's rows resolves to. */
export function goblinGuardPose(row: RowSpec, frame: number): GoblinPose {
  const style = GOBLIN_GUARD_STYLE;
  switch (row.name) {
    case 'walk':
      return holdLamp(style, poseFor(CHOREOGRAPHY, style, BATON, row, frame), WALK_LAMP);
    case 'idle':
      return holdLamp(style, poseFor(CHOREOGRAPHY, style, BATON, row, frame), IDLE_LAMP);
    case 'sweep':
      return sweepPose(frame, row.frameCount);
    case 'alert':
      return alertPose(frame, row.frameCount);
    case 'flinch':
      return holdLamp(style, poseFor(CHOREOGRAPHY, style, BATON, row, frame), FLINCH_LAMP);
    default:
      throw new Error(`no guard pose for row ${row.name}`);
  }
}

// ── The gate guard ───────────────────────────────────────────────────────────

/** The free hand set on the back of the hip, fist in, elbow out behind. */
const HAND_ON_HIP_BACK = 1.05;
const HAND_ON_HIP_RISE = 0.2;
/** Talking, he wags the baton from the near shoulder. */
const TALK_ARM_ANGLE = deg(60);
const TALK_REACH = 0.6;
const TALK_BATON_ANGLE = deg(-52);
const TALK_WAG = deg(9);
const TALK_WAGS_PER_LOOP = 2;
const TALK_SYLLABLES_PER_LOOP = 3;
const TALK_MOUTH = 0.6;
const TALK_NOD = deg(2.5);

function handOnHip(style: GoblinStyle, pose: GoblinPose): GoblinPose {
  const p = style.proportions;
  const hip = buildSkeleton(style, pose).hip;
  return {
    ...pose,
    farHand: {
      x: hip.x - p.hipHalfWidth * HAND_ON_HIP_BACK,
      y: hip.y - p.torsoLength * HAND_ON_HIP_RISE,
    },
  };
}

function talkPose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_GATE_GUARD_STYLE;
  const base = handOnHip(style, idleOn(style, frame, frameCount));
  const wag = loopWave(frame, frameCount, TALK_WAGS_PER_LOOP);
  const syllable = loopWave(frame, frameCount, TALK_SYLLABLES_PER_LOOP);
  const nearShoulder = buildSkeleton(style, base).nearShoulder;
  return {
    ...base,
    nearHand: along(nearShoulder, TALK_ARM_ANGLE - TALK_WAG * wag, armLength(style) * TALK_REACH),
    weaponAngle: TALK_BATON_ANGLE + TALK_WAG * wag,
    mouthOpen: TALK_MOUTH * Math.max(0, syllable),
    headTilt: base.headTilt + TALK_NOD * wag,
    eyeOpen: 1,
  };
}

/** The pose one frame of one of the gate guard's rows resolves to. */
export function goblinGateGuardPose(row: RowSpec, frame: number): GoblinPose {
  const style = GOBLIN_GATE_GUARD_STYLE;
  switch (row.name) {
    case 'walk':
    case 'flinch':
      return poseFor(CHOREOGRAPHY, style, BATON, row, frame);
    case 'idle':
      return handOnHip(style, poseFor(CHOREOGRAPHY, style, BATON, row, frame));
    case 'talk':
      return talkPose(frame, row.frameCount);
    default:
      throw new Error(`no gate guard pose for row ${row.name}`);
  }
}

// ── The prisoner ─────────────────────────────────────────────────────────────

const BREATH_SWELL = 0.02;
const BREATH_SETTLE = 0.006;
const BREATH_HEAD_LIFT = deg(1);
const PRISONER_BLINK_FRAME = 6;
const BLINK_EYE = 0.1;
const SLUMPED_EYE = 0.9;

/** Where the cell bars stand ahead of him, from the point between his feet. */
const BAR_FORWARD = 0.5;
/** His fists close on the bars at about shoulder height, the far one a little lower. */
const BAR_GRIP_RISE = 0.02;
const FAR_GRIP_DROP = 0.06;
const FAR_GRIP_BACK = 0.03;
const RATTLES_PER_LOOP = 2;
const RATTLE_SWAY = 0.03;
const RATTLE_HAND_SHAKE = 0.014;
const RATTLE_LEAN = deg(3);
const RATTLE_MOUTH = 0.45;
const RATTLE_MOUTH_PULSE = 0.4;

/** Leaning back against the cell wall, arms folded, chin up. */
const LEAN_BACK = deg(-16);
const LEAN_SWAY = -0.05;
const LEAN_FOOT_FORWARD = 0.08;
const LEAN_HEAD_TILT = deg(-7);
const FOLDED_NEAR_HAND = { x: 0.15, heightShare: 0.6 } as const;
const FOLDED_FAR_HAND = { x: 0.09, heightShare: 0.64 } as const;

/** Heckling: a fist shaken high from the near shoulder, leaning in, jaw working. */
const HECKLE_ARM_ANGLE = deg(-72);
const HECKLE_REACH = 0.9;
const HECKLES_PER_LOOP = 2;
const HECKLE_SHAKE = 0.045;
const HECKLE_LEAN = deg(7);
const HECKLE_HEAD_LEAD = 0.04;
const HECKLE_MOUTH = 0.55;
const HECKLE_MOUTH_PULSE = 0.45;

function prisonerBreath(frame: number, frameCount: number): GoblinPose {
  const rest = restingPose(GOBLIN_PRISONER_STYLE);
  const breath = loopWave(frame, frameCount);
  return {
    ...rest,
    bob: -BREATH_SETTLE * breath,
    torsoSquash: 1 + BREATH_SWELL * breath,
    headTilt: -BREATH_HEAD_LIFT * breath,
    eyeOpen: frame === PRISONER_BLINK_FRAME ? BLINK_EYE : SLUMPED_EYE,
  };
}

function rattlePose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_PRISONER_STYLE;
  const base = prisonerBreath(frame, frameCount);
  const shake = loopWave(frame, frameCount, RATTLES_PER_LOOP);
  const gripY = -shoulderHeight(style.proportions) - BAR_GRIP_RISE;
  const handShake = RATTLE_HAND_SHAKE * shake;
  return {
    ...base,
    sway: RATTLE_SWAY * shake,
    lean: RATTLE_LEAN * shake,
    nearHand: { x: BAR_FORWARD + handShake, y: gripY },
    farHand: { x: BAR_FORWARD - FAR_GRIP_BACK + handShake, y: gripY + FAR_GRIP_DROP },
    mouthOpen: RATTLE_MOUTH + RATTLE_MOUTH_PULSE * Math.abs(shake),
    eyeOpen: 1,
  };
}

function leanPose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_PRISONER_STYLE;
  const base = prisonerBreath(frame, frameCount);
  const shoulder = shoulderHeight(style.proportions);
  return {
    ...base,
    lean: LEAN_BACK,
    sway: LEAN_SWAY,
    nearFoot: { x: base.nearFoot.x + LEAN_FOOT_FORWARD, y: 0 },
    nearHand: { x: FOLDED_NEAR_HAND.x, y: -shoulder * FOLDED_NEAR_HAND.heightShare },
    farHand: { x: FOLDED_FAR_HAND.x, y: -shoulder * FOLDED_FAR_HAND.heightShare },
    headTilt: base.headTilt + LEAN_HEAD_TILT,
  };
}

function hecklePose(frame: number, frameCount: number): GoblinPose {
  const style = GOBLIN_PRISONER_STYLE;
  const shake = loopWave(frame, frameCount, HECKLES_PER_LOOP);
  const base: GoblinPose = {
    ...prisonerBreath(frame, frameCount),
    lean: HECKLE_LEAN,
    headLead: HECKLE_HEAD_LEAD,
    mouthOpen: HECKLE_MOUTH + HECKLE_MOUTH_PULSE * Math.abs(shake),
    eyeOpen: 1,
  };
  const shoulder = buildSkeleton(style, base).nearShoulder;
  const fist: Pt = along(shoulder, HECKLE_ARM_ANGLE, armLength(style) * HECKLE_REACH);
  return { ...base, nearHand: { x: fist.x, y: fist.y + HECKLE_SHAKE * shake } };
}

/** The pose one frame of one of the prisoner's rows resolves to. */
export function goblinPrisonerPose(row: RowSpec, frame: number): GoblinPose {
  switch (row.name) {
    case 'idle':
      return prisonerBreath(frame, row.frameCount);
    case 'rattle':
      return rattlePose(frame, row.frameCount);
    case 'lean':
      return leanPose(frame, row.frameCount);
    case 'heckle':
      return hecklePose(frame, row.frameCount);
    default:
      throw new Error(`no prisoner pose for row ${row.name}`);
  }
}

/** Which of the prisoner's hands are closed on something: the bars, a folded arm, a shaken fist. */
function prisonerGrips(state: string): {
  near: GoblinProp | undefined;
  far: GoblinProp | undefined;
} {
  switch (state) {
    case 'rattle':
    case 'lean':
      return { near: EMPTY_GRIP, far: EMPTY_GRIP };
    case 'heckle':
      return { near: EMPTY_GRIP, far: undefined };
    default:
      return { near: undefined, far: undefined };
  }
}

// ── Cell geometry and figures ────────────────────────────────────────────────

/** Where the figure's tile sits inside its cell; the gates re-check nothing reaches the edge. */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

const GUARD_GEOMETRY: CellGeometry = { frameWidth: 112, frameHeight: 90, tileX: 24, tileY: 13 };
const PRISONER_GEOMETRY: CellGeometry = { frameWidth: 84, frameHeight: 85, tileX: 10, tileY: 11 };

function stateFrames(rows: readonly RowSpec[]): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return frames;
}

function paintGuardFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const pose = goblinGuardPose(rowIn(GOBLIN_GUARD_ROWS, 'goblin_guard', state), frame);
  drawGoblin(
    ctx,
    GUARD_GEOMETRY.frameWidth / 2,
    GUARD_GEOMETRY.tileY + TILE_SCALE,
    TILE_SCALE * GOBLIN_GUARD_SCALE,
    GOBLIN_GUARD_STYLE,
    pose,
    BATON,
    FLASHLIGHT,
  );
}

function paintGateGuardFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const pose = goblinGateGuardPose(
    rowIn(GOBLIN_GATE_GUARD_ROWS, 'goblin_gate_guard', state),
    frame,
  );
  drawGoblin(
    ctx,
    GUARD_GEOMETRY.frameWidth / 2,
    GUARD_GEOMETRY.tileY + TILE_SCALE,
    TILE_SCALE * GOBLIN_GUARD_SCALE,
    GOBLIN_GATE_GUARD_STYLE,
    pose,
    BATON,
  );
}

function paintPrisonerFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const pose = goblinPrisonerPose(rowIn(GOBLIN_PRISONER_ROWS, 'goblin_prisoner', state), frame);
  const grips = prisonerGrips(state);
  drawGoblin(
    ctx,
    PRISONER_GEOMETRY.frameWidth / 2,
    PRISONER_GEOMETRY.tileY + TILE_SCALE,
    TILE_SCALE * GOBLIN_PRISONER_SCALE,
    GOBLIN_PRISONER_STYLE,
    pose,
    grips.near,
    grips.far,
  );
}

/** A patrol guard: uniform, peaked cap, key ring, baton in the near hand, flashlight in the far. */
export const GOBLIN_GUARD_FIGURE: FigureDef = {
  id: 'goblin_guard',
  ...GUARD_GEOMETRY,
  tileScale: TILE_SCALE,
  skipSupersample: true,
  states: figureStates(stateFrames(GOBLIN_GUARD_ROWS)),
  paintFrame: paintGuardFrame,
};

/** The gate guard: braided cap, big gold key ring, baton, and a free hand on his hip. */
export const GOBLIN_GATE_GUARD_FIGURE: FigureDef = {
  id: 'goblin_gate_guard',
  ...GUARD_GEOMETRY,
  tileScale: TILE_SCALE,
  skipSupersample: true,
  states: figureStates(stateFrames(GOBLIN_GATE_GUARD_ROWS)),
  paintFrame: paintGateGuardFrame,
};

/** A prisoner in the cell block, in striped rags. */
export const GOBLIN_PRISONER_FIGURE: FigureDef = {
  id: 'goblin_prisoner',
  ...PRISONER_GEOMETRY,
  tileScale: TILE_SCALE,
  skipSupersample: true,
  states: figureStates(stateFrames(GOBLIN_PRISONER_ROWS)),
  paintFrame: paintPrisonerFrame,
};

// ── Anchors the runtime reads ────────────────────────────────────────────────

/** A point on a figure, in tiles from the top-left of the tile it is drawn on. */
export interface TileAnchor {
  readonly x: number;
  readonly y: number;
}

/** A rig point (figure units, origin between the feet) as tiles from the tile's top-left, facing +X. */
function rigToTile(point: Pt, scale: number): TileAnchor {
  return { x: TILE_CENTRE + point.x * scale, y: 1 + point.y * scale };
}
const TILE_CENTRE = 0.5;

/** Where the flashlight's lens is, and which way it points, on one frame of a patrol guard row. */
export interface GuardLens extends TileAnchor {
  /** The lamp's own axis in screen space, radians from +X with +Y down. */
  readonly angle: number;
}

/**
 * The flashlight's lens for one frame of a patrol guard row, in tiles from the
 * top-left of the tile the sprite is drawn on, mirrored for a guard facing
 * left (`facingX < 0`) exactly as the sprite is: about the tile's centre.
 *
 * The prison's lighting starts each cone here, so the beam leaves the lamp the
 * player sees rather than the middle of the goblin.
 */
export function guardLensAnchor(state: string, frame: number, facingX: number): GuardLens {
  const row = rowIn(GOBLIN_GUARD_ROWS, 'goblin_guard', state);
  const pose = goblinGuardPose(row, ((frame % row.frameCount) + row.frameCount) % row.frameCount);
  const skeleton = buildSkeleton(GOBLIN_GUARD_STYLE, pose);
  const angle = offHandWristAngle(skeleton, pose);
  const lens = rigToTile(
    along(skeleton.farArm.end, angle, FLASHLIGHT_LENS_DISTANCE),
    GOBLIN_GUARD_SCALE,
  );
  if (facingX >= 0) return { ...lens, angle };
  return { x: 1 - lens.x, y: lens.y, angle: Math.PI - angle };
}

/**
 * Where the rig paints the near and far eyes, in head half-widths across and
 * head radii down, +X forward. The eye placement takes their midpoint, and the
 * gates measure the painted eye glow against it, so a rig change that moves the
 * eyes turns them red rather than leaving the shine off the face.
 */
const NEAR_EYE_IN_HEAD = { x: 0.3, y: -0.1 } as const;
const FAR_EYE_IN_HEAD = { x: 0.76, y: -0.12 } as const;

/** The midpoint of a prison goblin's two eyes, in tiles from its tile's top-left, facing +X. */
export function goblinEyeAnchor(style: GoblinStyle, pose: GoblinPose, scale: number): TileAnchor {
  const skeleton = buildSkeleton(style, pose);
  const p = style.proportions;
  const r = p.headRadius;
  const rx = r * p.headWidthFactor;
  const local: Pt = {
    x: (rx * (NEAR_EYE_IN_HEAD.x + FAR_EYE_IN_HEAD.x)) / 2,
    y: (r * (NEAR_EYE_IN_HEAD.y + FAR_EYE_IN_HEAD.y)) / 2,
  };
  const cos = Math.cos(skeleton.headAngle);
  const sin = Math.sin(skeleton.headAngle);
  const eye: Pt = {
    x: skeleton.headCentre.x + local.x * cos - local.y * sin,
    y: skeleton.headCentre.y + local.x * sin + local.y * cos,
  };
  return rigToTile(eye, scale);
}

/** The patrol guard's eyes at rest, which every guard figure shares: one build, one stance. */
export const GOBLIN_GUARD_EYE_ANCHOR: TileAnchor = goblinEyeAnchor(
  GOBLIN_GUARD_STYLE,
  goblinGuardPose(IDLE_ROW, 0),
  GOBLIN_GUARD_SCALE,
);

/** The prisoner's eyes on his idle's first frame. */
export const GOBLIN_PRISONER_EYE_ANCHOR: TileAnchor = goblinEyeAnchor(
  GOBLIN_PRISONER_STYLE,
  goblinPrisonerPose(rowIn(GOBLIN_PRISONER_ROWS, 'goblin_prisoner', 'idle'), 0),
  GOBLIN_PRISONER_SCALE,
);
