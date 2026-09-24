/**
 * The five fairies as painted figures: the choreography, the cell geometry,
 * and one `FigureDef` per kind.
 *
 * This module is choreography and nothing else: one pose function per row and
 * the placement of a pose inside its cell. Anatomy, palette and every stroke of
 * paint live in `fairyArt.ts`; frame counts and release frames live in
 * `fairyTiming.ts`, which behaviour code reads so a spell lands on the frame
 * that draws it.
 *
 * Every row is painted from three viewpoints: `<row>` (facing the camera),
 * `<row>_side` (facing +X, mirrored by the runtime for -X) and `<row>_away`.
 *
 * The art invariants live in `scripts/gates-fairy.ts`, which the review harness
 * runs: `npm run render:fairy`.
 */

import { clamp01, deg, easeInOut, easeOut, hump, lerp } from './carlArt';
import {
  type FairyEffect,
  type FairyPose,
  type FairyView,
  type LimbPose,
  drawFairy,
  restFairyPose,
} from './fairyArt';
import {
  FAIRY_HOVER_LIFT_TILES,
  FAIRY_KINDS,
  type FairyKind,
  type FairyRow,
  fairyRowFrames,
  fairyRowSpec,
  fairyRowsOf,
} from './fairyTiming';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell every pose is painted into, and where the fairy's own tile sits in
 * it. Sized to the raised wings and the widest spell effect with a few pixels
 * spare; the gates fail any frame that paints against an edge, which is what
 * would say a pose has outgrown it.
 */
const FRAME_WIDTH = 108;
const FRAME_HEIGHT = 124;
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
const TILE_Y = 38;

export const FAIRY_VIEWS: readonly FairyView[] = ['front', 'side', 'away'];

/** The state name for a row seen from a view. */
export function fairyStateName(row: FairyRow, view: FairyView): string {
  if (view === 'side') return `${row}_side`;
  if (view === 'away') return `${row}_away`;
  return row;
}

// ── Temperament ──────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
/** Legs trail the body's bob by this share of a beat: they hang, they are not driven. */
const LEG_LAG = 0.2;
const LEG_PAIR_OFFSET = 0.35;
/** The second leg of a pair swings further than the first, so the dangle is never a mirror. */
const OFF_LEG_SWAY = 1.4;

function limb(flex: number, abduct: number, bend: number): LimbPose {
  return { flex, abduct, bend };
}

function lerpLimb(a: LimbPose, b: LimbPose, t: number): LimbPose {
  return limb(lerp(a.flex, b.flex, t), lerp(a.abduct, b.abduct, t), lerp(a.bend, b.bend, t));
}

/**
 * How a kind carries itself in the air. The hover loop is one wingbeat long,
 * so no kind can sway slower than the others; what separates them is posture,
 * how much of the beat reaches the body, and whether that motion is a clean
 * sine or has faster harmonics riding on it. Every oscillation here is a whole
 * harmonic of the beat, so the loop closes.
 */
interface Temperament {
  /** Tiles the body rises and falls with the beat. */
  readonly bob: number;
  /** Tiles of third-harmonic jitter on the bob: restlessness. */
  readonly bobJitter: number;
  /** Tiles the body hangs below the common hover height, + down. */
  readonly sink: number;
  /** Radians the body rolls either way with the beat. */
  readonly roll: number;
  /** Tiles the body drifts either way with the beat. */
  readonly sway: number;
  /** Tiles of second-harmonic drift jitter. */
  readonly swayJitter: number;
  /** A constant lean, radians: a roll from the front, a glide from the side. */
  readonly lean: number;
  /** A constant head tilt, radians, and how much it nods with the beat. */
  readonly headDroop: number;
  readonly headNod: number;
  /** Radians the limbs dangle through with the beat. */
  readonly legSway: number;
  readonly armSway: number;
  readonly arm: LimbPose;
  /** The two legs are held differently: a poised foot, a tucked knee. */
  readonly legRight: LimbPose;
  readonly legLeft: LimbPose;
  readonly wingFlap: number;
}

const TEMPERAMENTS: ReadonlyMap<FairyKind, Temperament> = new Map<FairyKind, Temperament>([
  [
    // A sentry: upright, legs together, barely moved by its rigid wings.
    'shield',
    {
      bob: 0.006,
      bobJitter: 0,
      sink: 0,
      roll: 0,
      sway: 0,
      swayJitter: 0,
      lean: 0,
      headDroop: 0,
      headNod: 0,
      legSway: deg(2),
      armSway: deg(1),
      arm: limb(deg(8), deg(9), deg(14)),
      legRight: limb(deg(-4), deg(2), deg(8)),
      legLeft: limb(deg(-4), deg(2), deg(8)),
      wingFlap: 1,
    },
  ],
  [
    // Drifts: the whole body rocks on the beat with its arms opened, one knee lifted.
    'healer',
    {
      bob: 0.05,
      bobJitter: 0,
      sink: 0,
      roll: deg(10),
      sway: 0.05,
      swayJitter: 0,
      lean: 0,
      headDroop: deg(-6),
      headNod: deg(8),
      legSway: deg(10),
      armSway: deg(12),
      arm: limb(deg(14), deg(34), deg(34)),
      legRight: limb(deg(-10), deg(6), deg(24)),
      legLeft: limb(deg(22), deg(4), deg(80)),
      wingFlap: 1,
    },
  ],
  [
    // Glides: leaned into its flight, one leg drawn back straight like a skater's.
    'ice',
    {
      bob: 0.02,
      bobJitter: 0,
      sink: 0,
      roll: deg(3),
      sway: 0.02,
      swayJitter: 0,
      lean: deg(10),
      headDroop: deg(-4),
      headNod: 0,
      legSway: deg(3),
      armSway: deg(4),
      arm: limb(deg(4), deg(40), deg(12)),
      legRight: limb(deg(-6), deg(4), deg(10)),
      legLeft: limb(deg(-40), deg(14), deg(4)),
      wingFlap: 1,
    },
  ],
  [
    // Never still: fists up, knees kicking, the body twitching on every flicker of the wings.
    'fire',
    {
      bob: 0.03,
      bobJitter: 0.03,
      sink: 0,
      roll: deg(5),
      sway: 0.008,
      swayJitter: 0.04,
      lean: 0,
      headDroop: 0,
      headNod: deg(10),
      legSway: deg(22),
      armSway: deg(18),
      arm: limb(deg(30), deg(30), deg(95)),
      legRight: limb(deg(4), deg(8), deg(64)),
      legLeft: limb(deg(-24), deg(8), deg(30)),
      wingFlap: 1,
    },
  ],
  [
    // Hangs: low, head bowed, arms dead at its sides, heaved up by each labouring beat.
    'necro',
    {
      bob: 0.06,
      bobJitter: 0,
      sink: 0.01,
      roll: deg(2),
      sway: 0,
      swayJitter: 0,
      lean: 0,
      headDroop: deg(16),
      headNod: deg(6),
      legSway: deg(4),
      armSway: deg(2),
      arm: limb(deg(2), deg(6), deg(4)),
      legRight: limb(deg(0), deg(2), deg(4)),
      legLeft: limb(deg(0), deg(2), deg(4)),
      wingFlap: 1,
    },
  ],
]);

function temperamentOf(kind: FairyKind): Temperament {
  const temperament = TEMPERAMENTS.get(kind);
  if (temperament === undefined) throw new Error(`no fairy temperament "${kind}"`);
  return temperament;
}

/** Offsets the fire fairy's jitter harmonics from its beat, so the twitches never land on the stroke. */
const JITTER_PHASE = 1.3;
/** The jitter runs at three times the wingbeat: several twitches to a stroke. */
const JITTER_HARMONIC = 3;
/** The body lags the wings by this share of a beat: the downstroke lifts it a moment later. */
const BODY_LAG = 0.12;

/** Maps an oscillation in -1…1 onto 0…1, for motion that only ever goes one way from rest. */
function rising(wave: number): number {
  return (1 + wave) / 2;
}

/** The base every row starts from: hanging in the air, one wingbeat at `phase`. */
function hoverPose(kind: FairyKind, phase: number): FairyPose {
  const t = temperamentOf(kind);
  const rest = restFairyPose(FAIRY_HOVER_LIFT_TILES);
  const beat = phase * TAU;
  const body = beat - BODY_LAG * TAU;
  const legSway = (offset: number): number => Math.sin(beat - (LEG_LAG + offset) * TAU);
  const armSway = Math.sin(beat - LEG_LAG * TAU) * t.armSway;
  const jitter = Math.sin(JITTER_HARMONIC * body + JITTER_PHASE);
  return {
    ...rest,
    wingPhase: phase,
    flicker: phase,
    wingFlap: t.wingFlap,
    // Upward only: the hover height is as low as the shadow's gap allows, and
    // a bob that dipped below it would read as the fairy touching down.
    bob: t.sink - rising(Math.sin(body)) * t.bob - rising(jitter) * t.bobJitter,
    drift: Math.cos(body) * t.sway + Math.sin(2 * body + JITTER_PHASE) * t.swayJitter,
    tilt: t.lean + Math.cos(body) * t.roll,
    headTilt: t.headDroop + Math.sin(body - LEG_LAG * TAU) * t.headNod,
    legRight: limb(
      t.legRight.flex + legSway(0) * t.legSway,
      t.legRight.abduct,
      t.legRight.bend + legSway(0) * t.legSway,
    ),
    legLeft: limb(
      t.legLeft.flex + legSway(LEG_PAIR_OFFSET) * t.legSway,
      t.legLeft.abduct,
      t.legLeft.bend + legSway(LEG_PAIR_OFFSET) * t.legSway * OFF_LEG_SWAY,
    ),
    armRight: limb(t.arm.flex, t.arm.abduct + armSway, t.arm.bend),
    armLeft: limb(t.arm.flex, t.arm.abduct + armSway, t.arm.bend),
  };
}

/** A one-shot row's progress, 0 on its first frame and 1 on its last. */
function rowProgress(frame: number, frames: number): number {
  return frames <= 1 ? 1 : frame / (frames - 1);
}

/**
 * Wing phase through a one-shot row: the beat keeps going at the hover's pace,
 * so a cast never freezes the wings.
 */
function castWingPhase(frame: number): number {
  return (frame / fairyRowFrames('hover')) % 1;
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

/** The hit star: full on the frame the blow lands, shrinking on the next, gone after. */
const HURT_IMPACT: readonly number[] = [1, 0.55];

/**
 * How a kind takes a blow. Every hurt is a snap and a settle; what the snap
 * does to the body is the kind's own.
 */
interface HurtStyle {
  /** How hard each frame is still reacting, 1 at the peak. */
  readonly recoil: readonly number[];
  readonly tilt: number;
  /** Alternates the tilt's sign frame to frame: a body that sputters rather than reels. */
  readonly tiltAlternates: boolean;
  readonly drift: number;
  /** Tiles the body is knocked, + down. */
  readonly jolt: number;
  readonly arm: LimbPose;
  readonly legRight: LimbPose;
  readonly legLeft: LimbPose;
  /** Extra wingbeat amplitude at the peak; negative locks the wings. */
  readonly wingThrash: number;
  /** How far the wings droop at the peak, 0–1. */
  readonly wingDroop: number;
  readonly headSnap: number;
  /** How far the body goes to its dead colour at the peak. */
  readonly pallor: number;
  /** How far the body gutters out of sight at the peak, 0–1. */
  readonly fadeDip: number;
  /** How much of its glow the body loses at the peak. */
  readonly glowLoss: number;
}

const HURT_STYLES: ReadonlyMap<FairyKind, HurtStyle> = new Map<FairyKind, HurtStyle>([
  [
    // Stiffens: barely knocked, arms snapped across its chest, wings locked; the blow cracks.
    'shield',
    {
      recoil: [1, 0.9, 0.5, 0.15],
      tilt: deg(-9),
      tiltAlternates: false,
      drift: -0.08,
      jolt: 0.01,
      arm: limb(deg(72), deg(-18), deg(100)),
      legRight: limb(deg(-2), deg(0), deg(2)),
      legLeft: limb(deg(-2), deg(0), deg(2)),
      wingThrash: -1,
      wingDroop: 0,
      headSnap: deg(-4),
      pallor: 0.35,
      fadeDip: 0,
      glowLoss: 0,
    },
  ],
  [
    // Wilts: sags, head and wings drooping, arms falling, knees drawn up; it is slow to recover.
    'healer',
    {
      recoil: [0.75, 1, 0.8, 0.45],
      tilt: deg(14),
      tiltAlternates: false,
      drift: 0.06,
      jolt: 0.07,
      arm: limb(deg(4), deg(4), deg(6)),
      legRight: limb(deg(40), deg(6), deg(110)),
      legLeft: limb(deg(30), deg(6), deg(120)),
      wingThrash: -0.6,
      wingDroop: 0.55,
      headSnap: deg(26),
      pallor: 0.3,
      fadeDip: 0,
      glowLoss: 0.4,
    },
  ],
  [
    // Recoils clean and sharp, flung back with its arms thrown wide, and snaps straight again.
    'ice',
    {
      recoil: [1, 0.45, 0.15, 0.04],
      tilt: deg(-36),
      tiltAlternates: false,
      drift: -0.11,
      jolt: -0.03,
      arm: limb(deg(-25), deg(80), deg(4)),
      legRight: limb(deg(-24), deg(16), deg(20)),
      legLeft: limb(deg(-6), deg(12), deg(8)),
      wingThrash: 0.5,
      wingDroop: 0,
      headSnap: deg(-14),
      pallor: 0,
      fadeDip: 0,
      glowLoss: 0,
    },
  ],
  [
    // Sputters: jerked up, arms flung high, guttering dark and twitching one way then the other as its flames spit.
    'fire',
    {
      recoil: [1, 0.8, 0.5, 0.2],
      tilt: deg(-24),
      tiltAlternates: true,
      drift: -0.09,
      jolt: -0.05,
      arm: limb(deg(10), deg(140), deg(20)),
      legRight: limb(deg(-10), deg(16), deg(90)),
      legLeft: limb(deg(20), deg(14), deg(70)),
      wingThrash: 0.9,
      wingDroop: 0,
      headSnap: deg(-16),
      pallor: 0,
      fadeDip: 0,
      glowLoss: 0.4,
    },
  ],
  [
    // Wavers: goes half to smoke where it was struck, doubled over, and draws itself back together.
    'necro',
    {
      recoil: [1, 0.75, 0.45, 0.15],
      tilt: deg(10),
      tiltAlternates: false,
      drift: -0.1,
      jolt: 0.03,
      arm: limb(deg(40), deg(10), deg(60)),
      legRight: limb(deg(30), deg(4), deg(60)),
      legLeft: limb(deg(20), deg(4), deg(50)),
      wingThrash: 0.3,
      wingDroop: 0.2,
      headSnap: deg(22),
      pallor: 0,
      fadeDip: 0.35,
      glowLoss: 0.5,
    },
  ],
]);

function hurtStyleOf(kind: FairyKind): HurtStyle {
  const style = HURT_STYLES.get(kind);
  if (style === undefined) throw new Error(`no fairy hurt style "${kind}"`);
  return style;
}

function hurtPose(kind: FairyKind, frame: number): FairyPose {
  const style = hurtStyleOf(kind);
  const k = style.recoil[Math.min(frame, style.recoil.length - 1)] ?? 0;
  const base = hoverPose(kind, castWingPhase(frame));
  const sign = style.tiltAlternates && frame % 2 === 1 ? -1 : 1;
  return {
    ...base,
    tilt: lerp(base.tilt, style.tilt * sign, k),
    drift: base.drift + style.drift * k,
    bob: base.bob + style.jolt * k,
    armRight: lerpLimb(base.armRight, style.arm, k),
    armLeft: lerpLimb(base.armLeft, style.arm, k),
    legRight: lerpLimb(base.legRight, style.legRight, k),
    legLeft: lerpLimb(base.legLeft, style.legLeft, k),
    eyesShut: k,
    flash: HURT_IMPACT[frame] ?? 0,
    impact: HURT_IMPACT[frame] ?? 0,
    wingFlap: Math.max(0, base.wingFlap + k * style.wingThrash),
    wingSpread: 1 - k * style.wingDroop,
    headTilt: lerp(base.headTilt, style.headSnap, k),
    pallor: k * style.pallor,
    fade: 1 - k * style.fadeDip,
    glow: 1 - k * style.glowLoss,
  };
}

// ── Death ────────────────────────────────────────────────────────────────────

type Ease = (t: number) => number;

const easeInQuad: Ease = (t) => t * t;

/**
 * How a kind dies. Every death has to bring the body down to the ground and
 * then leave nothing but a trace, so the corpse fizzles instead of popping;
 * inside that, each kind goes its own way: a guardian slumping to its knees
 * against the shield it has driven into the ground, a falling leaf,
 * a shattered sculpture, a guttering ember, a collapsing shroud.
 */
interface DeathStyle {
  /** Share of the row spent stricken in the air before the fall. */
  readonly strickenEnd: number;
  /** Share of the row at which the body lands. */
  readonly landed: number;
  readonly fallEase: Ease;
  /** Body rotation once landed, radians. */
  readonly roll: number;
  /** Tilt, arms and legs at the killing blow. */
  readonly throeTilt: number;
  readonly throeArm: LimbPose;
  readonly throeLeg: LimbPose;
  /** Arms and legs once landed. */
  readonly limpArm: LimbPose;
  readonly limpLeg: LimbPose;
  /** How far the wings fold once landed, and whether they keep beating through the fall. */
  readonly wingCrumple: number;
  readonly wingsLock: boolean;
  /** Tiles either way a falling leaf rocks on its way down, and how many times. */
  readonly swayDrift: number;
  readonly swayCycles: number;
  readonly swayRoll: number;
  /** The toes' height once landed: below the ground line when the body has rolled flat. */
  readonly lyingLift: number;
  readonly headDroop: number;
  /** How far the body goes to its dead colour, and by what share of the row it has. */
  readonly pallor: number;
  readonly pallorBy: number;
  /** How much of its glow the body has lost by the time it lands. */
  readonly glowLoss: number;
  /** Share of the row at which the body starts coming apart, and how it fades once it does. */
  readonly dissolveStart: number;
  readonly fadeEase: Ease;
  /** Opacity left on the last frame: a trace of the body, or none once it has shattered. */
  readonly finalFade: number;
  /** Whether the body lets go of a shield that falls on its own and stands planted beside it. */
  readonly dropsShield: boolean;
}

const DEATH_FINAL_FADE = 0.15;
/** An ice fairy is gone this many times faster than the others once it has shattered. */
const ICE_SHATTER_SPEED = 3;
/**
 * All an ice fairy leaves once it has shattered: a trace too faint to see.
 * Any more and the body lingers behind its own shards as a second, ghostly
 * fairy.
 */
const ICE_SHATTERED_TRACE = 0.04;

const DEATH_STYLES: ReadonlyMap<FairyKind, DeathStyle> = new Map<FairyKind, DeathStyle>([
  [
    'shield',
    {
      strickenEnd: 0.1,
      landed: 0.45,
      fallEase: easeInQuad,
      roll: deg(34),
      throeTilt: deg(-4),
      throeArm: limb(deg(2), deg(8), deg(4)),
      throeLeg: limb(deg(0), deg(1), deg(2)),
      limpArm: limb(deg(30), deg(40), deg(50)),
      limpLeg: limb(deg(80), deg(4), deg(150)),
      wingCrumple: 1,
      wingsLock: true,
      swayDrift: 0,
      swayCycles: 0,
      swayRoll: 0,
      lyingLift: -0.02,
      headDroop: deg(26),
      pallor: 0.75,
      pallorBy: 0.4,
      glowLoss: 1,
      dissolveStart: 0.5,
      fadeEase: easeInOut,
      finalFade: DEATH_FINAL_FADE,
      dropsShield: true,
    },
  ],
  [
    'healer',
    {
      strickenEnd: 0.1,
      landed: 0.7,
      fallEase: easeInOut,
      roll: deg(78),
      throeTilt: deg(10),
      throeArm: limb(deg(10), deg(20), deg(20)),
      throeLeg: limb(deg(30), deg(6), deg(100)),
      limpArm: limb(deg(60), deg(10), deg(100)),
      limpLeg: limb(deg(70), deg(4), deg(130)),
      wingCrumple: 1,
      wingsLock: false,
      swayDrift: 0.07,
      swayCycles: 1.5,
      swayRoll: deg(18),
      lyingLift: -0.18,
      headDroop: deg(24),
      pallor: 0.8,
      pallorBy: 0.75,
      glowLoss: 0.9,
      dissolveStart: 0.72,
      fadeEase: easeInOut,
      finalFade: DEATH_FINAL_FADE,
      dropsShield: false,
    },
  ],
  [
    'ice',
    {
      strickenEnd: 0.1,
      landed: 0.4,
      fallEase: easeInQuad,
      roll: deg(50),
      throeTilt: deg(-18),
      throeArm: limb(deg(34), deg(36), deg(96)),
      throeLeg: limb(deg(-30), deg(16), deg(10)),
      limpArm: limb(deg(34), deg(36), deg(96)),
      limpLeg: limb(deg(-30), deg(16), deg(10)),
      wingCrumple: 0,
      wingsLock: true,
      swayDrift: 0,
      swayCycles: 0,
      swayRoll: 0,
      lyingLift: -0.16,
      headDroop: deg(-10),
      pallor: 0.75,
      pallorBy: 0.12,
      glowLoss: 0.5,
      dissolveStart: 0.4,
      fadeEase: (t) => easeOut(clamp01(t * ICE_SHATTER_SPEED)),
      finalFade: ICE_SHATTERED_TRACE,
      dropsShield: false,
    },
  ],
  [
    'fire',
    {
      strickenEnd: 0.12,
      landed: 0.62,
      fallEase: easeOut,
      roll: deg(80),
      throeTilt: deg(14),
      throeArm: limb(deg(12), deg(150), deg(8)),
      throeLeg: limb(deg(-20), deg(14), deg(55)),
      limpArm: limb(deg(40), deg(30), deg(60)),
      limpLeg: limb(deg(35), deg(8), deg(70)),
      wingCrumple: 0.9,
      wingsLock: false,
      swayDrift: 0,
      swayCycles: 0,
      swayRoll: 0,
      lyingLift: -0.2,
      headDroop: deg(12),
      pallor: 0.9,
      pallorBy: 0.75,
      glowLoss: 1,
      dissolveStart: 0.35,
      fadeEase: easeInOut,
      finalFade: DEATH_FINAL_FADE,
      dropsShield: false,
    },
  ],
  [
    'necro',
    {
      strickenEnd: 0.1,
      landed: 0.45,
      fallEase: easeInQuad,
      roll: deg(14),
      throeTilt: deg(-8),
      throeArm: limb(deg(20), deg(120), deg(10)),
      throeLeg: limb(deg(10), deg(4), deg(20)),
      limpArm: limb(deg(4), deg(10), deg(10)),
      limpLeg: limb(deg(80), deg(4), deg(150)),
      wingCrumple: 1,
      wingsLock: false,
      swayDrift: 0,
      swayCycles: 0,
      swayRoll: 0,
      lyingLift: -0.02,
      headDroop: deg(34),
      pallor: 0.3,
      pallorBy: 0.5,
      glowLoss: 0.8,
      dissolveStart: 0.2,
      fadeEase: easeInOut,
      finalFade: DEATH_FINAL_FADE,
      dropsShield: false,
    },
  ],
]);

/** The dust starts as the body reaches the ground and has settled a few frames later. */
const DEATH_DUST_LEAD = 0.08;
const DEATH_DUST_SPAN = 0.35;
/** The head snaps back at the killing blow, then drops to the style's droop as the body falls. */
const DEATH_THROE_HEAD = deg(-14);

function deathStyleOf(kind: FairyKind): DeathStyle {
  const style = DEATH_STYLES.get(kind);
  if (style === undefined) throw new Error(`no fairy death style "${kind}"`);
  return style;
}

function deathPose(kind: FairyKind, frame: number, frames: number): FairyPose {
  const style = deathStyleOf(kind);
  const t = rowProgress(frame, frames);
  const hover = hoverPose(kind, castWingPhase(frame));
  const base = style.wingsLock ? { ...hover, wingPhase: 0, wingFlap: 0 } : hover;
  const strickenShare = clamp01(t / style.strickenEnd);
  const stricken = 1 - strickenShare;
  const fall = style.fallEase(
    clamp01((t - style.strickenEnd) / (style.landed - style.strickenEnd)),
  );
  const fizzle = clamp01((t - style.dissolveStart) / (1 - style.dissolveStart));
  const airborne = 1 - fall;
  const rock = Math.sin(fall * style.swayCycles * TAU);
  const throeArm = lerpLimb(base.armRight, style.throeArm, strickenShare);
  return {
    ...base,
    lift: lerp(FAIRY_HOVER_LIFT_TILES, style.lyingLift, fall),
    bob: base.bob * airborne,
    drift: base.drift * airborne + rock * style.swayDrift * airborne,
    tilt:
      lerp(lerp(base.tilt, style.throeTilt, strickenShare), style.roll, fall) +
      rock * style.swayRoll * airborne,
    wingSpread: 1 - fall * style.wingCrumple,
    wingFlap: base.wingFlap * airborne,
    armRight: lerpLimb(throeArm, style.limpArm, fall),
    armLeft: lerpLimb(throeArm, style.limpArm, fall),
    legRight: lerpLimb(style.throeLeg, style.limpLeg, fall),
    legLeft: lerpLimb(style.throeLeg, style.limpLeg, fall * DEATH_OFF_LEG_SHARE),
    eyesShut: 1,
    flash: t < style.strickenEnd ? 1 : 0,
    headTilt: lerp(DEATH_THROE_HEAD * stricken, style.headDroop, fall),
    dissolve: fizzle,
    // Eased in, not out: the body lies there a beat before it goes, which is
    // what separates a death from a dash that streaks away.
    fade: lerp(1, style.finalFade, style.fadeEase(fizzle)),
    impact: t < style.strickenEnd ? 1 : 0,
    dust: clamp01((t - (style.landed - DEATH_DUST_LEAD)) / DEATH_DUST_SPAN),
    glow: 1 - fall * style.glowLoss,
    pallor: style.pallor * clamp01(t / style.pallorBy),
    sigilDrop: style.dropsShield ? fall : 0,
  };
}

/** The second leg lags the first into its landed pose, so the fallen body is not a mirror. */
const DEATH_OFF_LEG_SHARE = 0.6;

// ── Casts ────────────────────────────────────────────────────────────────────

interface CastTiming {
  /** 0 → 1 across the windup, reaching 1 on the release frame. */
  readonly windup: number;
  /** 0 before the release frame, then 0 → 1 across the frames after it, starting above 0 on the release frame itself. */
  readonly after: number;
}

function castTiming(row: FairyRow, frame: number): CastTiming {
  const spec = fairyRowSpec(row);
  const release = spec.releaseFrame ?? spec.frames - 1;
  const windup = release <= 0 ? 1 : clamp01(frame / release);
  const tail = spec.frames - release;
  const after = frame < release ? 0 : (frame - release + 1) / Math.max(1, tail);
  return { windup, after };
}

function withEffect(
  pose: FairyPose,
  effect: FairyEffect,
  amount: number,
  progress: number,
  release: number,
): FairyPose {
  return {
    ...pose,
    effect,
    effectAmount: clamp01(amount),
    effectProgress: clamp01(progress),
    effectRelease: clamp01(release),
  };
}

const WARD_ARMS_UP = limb(deg(24), deg(142), deg(-12));
/** How far the arms come back down after the glyph has gone. */
const WARD_SETTLE = 0.3;
const WARD_AFTERGLOW_LOSS = 0.5;
const WARD_LEAN_BACK = deg(-6);
const WARD_HEAD_UP = deg(-8);

/** Arms sweep up and out; the sigil flares, and on release throws off its hexagon. */
function wardPose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_ward', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const sweep = easeInOut(windup);
  const settle = after * WARD_SETTLE;
  const arm = lerpLimb(base.armRight, WARD_ARMS_UP, sweep - settle);
  return withEffect(
    {
      ...base,
      armRight: arm,
      armLeft: arm,
      tilt: WARD_LEAN_BACK * sweep,
      headTilt: WARD_HEAD_UP * sweep,
    },
    'ward',
    sweep * (1 - after * WARD_AFTERGLOW_LOSS),
    windup,
    after,
  );
}

const HEAL_CUPPED = limb(deg(38), deg(12), deg(72));
const HEAL_RAISED = limb(deg(58), deg(10), deg(62));
/** The head bows over the cupped hands. */
const HEAL_HEAD_BOW = deg(10);
const HEAL_AFTERGLOW_LOSS = 0.6;

/** Cupped hands come up before the chest and lift as a bloom opens between them. */
function healPose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_heal', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const cup = easeOut(clamp01(windup * 2));
  const lift = easeInOut(clamp01(windup * 2 - 1));
  const cupped = lerpLimb(base.armRight, HEAL_CUPPED, cup);
  const arm = lerpLimb(cupped, HEAL_RAISED, lift);
  return withEffect(
    { ...base, armRight: arm, armLeft: arm, headTilt: HEAL_HEAD_BOW * cup * (1 - after) },
    'heal',
    cup * (1 - after * HEAL_AFTERGLOW_LOSS),
    windup,
    after,
  );
}

/**
 * Straight out at shoulder height and angled forward: pointed at the camera,
 * the arm of the front view foreshortens to a stub and the lance with it, and
 * pointed out to the side, the profile's arm would. This splits the two, so
 * the arm reads as a level point from the front and from the side.
 */
const BEAM_POINT = limb(deg(40), deg(80), deg(0));
const BEAM_OFF_ARM = limb(deg(-24), deg(34), deg(30));
const BEAM_LEAN = deg(10);
/** The pointing arm is up by this share of the windup; the rest is frost gathering at the fingertip. */
const BEAM_ARM_UP = 0.3;
const BEAM_RECOIL = deg(-8);
const BEAM_KICKBACK = deg(-6);
/** Frost starts gathering halfway through the arm coming up, not after it. */
const BEAM_GATHER_OVERLAP = 0.5;

/** One arm comes up and points; frost gathers at the fingertip through the hold, and discharges. */
function beamPose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_beam', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const raise = easeOut(clamp01(windup / BEAM_ARM_UP));
  const gatherStart = BEAM_ARM_UP * BEAM_GATHER_OVERLAP;
  const gather = clamp01((windup - gatherStart) / (1 - gatherStart));
  const recoil = after > 0 ? BEAM_RECOIL : 0;
  return withEffect(
    {
      ...base,
      armRight: lerpLimb(
        base.armRight,
        limb(BEAM_POINT.flex + recoil, BEAM_POINT.abduct, 0),
        raise,
      ),
      armLeft: lerpLimb(base.armLeft, BEAM_OFF_ARM, raise),
      tilt: BEAM_LEAN * raise + (after > 0 ? BEAM_KICKBACK : 0),
    },
    'beam',
    gather,
    windup,
    after,
  );
}

/**
 * Up and back over the throwing shoulder. Past the vertical, a swing back
 * reverses the sideways sense of the abduction, so a wound arm abducted
 * outward would carry the ball across the chest and the throw read as
 * juggling; the negative abduction is what keeps it out on its own side.
 */
const LOB_WOUND = limb(deg(-150), deg(-40), deg(30));
const LOB_RELEASE = limb(deg(62), deg(44), deg(12));
const LOB_FOLLOW = limb(deg(118), deg(40), deg(20));
const LOB_OFF_ARM = limb(deg(40), deg(40), deg(40));
/** Share of the windup spent winding back; the rest is the underhand swing through. */
const LOB_WIND_SHARE = 0.55;
const LOB_WIND_LEAN = deg(-10);
const LOB_THROW_LEAN = deg(12);
const LOB_RECOVER = 0.5;

/**
 * Winds the fireball back high over the shoulder while it swells, swings it
 * down and through underhand, and lets go on the release frame with the hand
 * rising in front.
 */
function lobPose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_lob', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const wind = easeInOut(clamp01(windup / LOB_WIND_SHARE));
  const swing = easeInOut(clamp01((windup - LOB_WIND_SHARE) / (1 - LOB_WIND_SHARE)));
  const wound = lerpLimb(base.armRight, LOB_WOUND, wind);
  const swung = lerpLimb(wound, LOB_RELEASE, swing);
  const arm = after > 0 ? lerpLimb(LOB_RELEASE, LOB_FOLLOW, after) : swung;
  const lean =
    LOB_WIND_LEAN * wind * (1 - swing) + LOB_THROW_LEAN * swing * (1 - after * LOB_RECOVER);
  return withEffect(
    {
      ...base,
      armRight: arm,
      armLeft: lerpLimb(base.armLeft, LOB_OFF_ARM, wind),
      tilt: lean,
    },
    'lob',
    after > 0 ? 1 : wind,
    windup,
    after,
  );
}

/**
 * Up and forward rather than straight up and out: raised in the side plane the
 * arms of the profile would project straight up behind the hood and vanish.
 */
const RAISE_ARMS = limb(deg(45), deg(135), deg(-20));
const RAISE_HEAD_UP = deg(-12);
const RAISE_LEAN_BACK = deg(-5);

/** Arms lift high, palms up, and wisps climb off them; on release a column of them rises. */
function raisePose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_raise', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const lift = easeInOut(windup);
  const arm = lerpLimb(base.armRight, RAISE_ARMS, lift);
  return withEffect(
    {
      ...base,
      armRight: arm,
      armLeft: arm,
      headTilt: RAISE_HEAD_UP * lift,
      tilt: RAISE_LEAN_BACK * lift,
    },
    'raise',
    lift,
    (frame / fairyRowFrames('cast_raise')) % 1,
    after,
  );
}

const PUSH_DRAWN = limb(deg(28), deg(30), deg(120));
const PUSH_THRUST = limb(deg(86), deg(38), deg(0));
const PUSH_DRAW_LEAN = deg(-8);
const PUSH_THRUST_LEAN = deg(10);
/** Tiles the body draws back, then lunges, behind the thrust. */
const PUSH_DRAW_DRIFT = -0.02;
const PUSH_THRUST_DRIFT = 0.03;

/** Palms draw back to the chest while a ring closes in, then thrust out as it bursts. */
function pushPose(kind: FairyKind, frame: number): FairyPose {
  const { windup, after } = castTiming('cast_push', frame);
  const base = hoverPose(kind, castWingPhase(frame));
  const draw = easeInOut(windup);
  const drawn = lerpLimb(base.armRight, PUSH_DRAWN, draw);
  const thrust = after > 0 ? easeOut(clamp01(after * 2)) : 0;
  const arm = lerpLimb(drawn, PUSH_THRUST, thrust);
  return withEffect(
    {
      ...base,
      armRight: arm,
      armLeft: arm,
      tilt: PUSH_DRAW_LEAN * draw * (1 - thrust) + PUSH_THRUST_LEAN * thrust,
      drift: PUSH_DRAW_DRIFT * draw * (1 - thrust) + PUSH_THRUST_DRIFT * thrust,
    },
    'push',
    Math.max(draw, hump(after)),
    windup,
    after,
  );
}

function poseFor(kind: FairyKind, row: FairyRow, frame: number): FairyPose {
  const frames = fairyRowFrames(row);
  if (row === 'hover') return hoverPose(kind, frame / frames);
  if (row === 'hurt') return hurtPose(kind, frame);
  if (row === 'death') return deathPose(kind, frame, frames);
  if (row === 'cast_ward') return wardPose(kind, frame);
  if (row === 'cast_heal') return healPose(kind, frame);
  if (row === 'cast_beam') return beamPose(kind, frame);
  if (row === 'cast_lob') return lobPose(kind, frame);
  if (row === 'cast_raise') return raisePose(kind, frame);
  return pushPose(kind, frame);
}

/** Every pose a kind can be painted in, for gates that measure the choreography itself. */
export function fairyPoseOf(kind: FairyKind, row: FairyRow, frame: number): FairyPose {
  return poseFor(kind, row, frame);
}

// ── Figures ──────────────────────────────────────────────────────────────────

interface StateRef {
  readonly row: FairyRow;
  readonly view: FairyView;
}

function stateTable(kind: FairyKind): ReadonlyMap<string, StateRef> {
  const table = new Map<string, StateRef>();
  for (const row of fairyRowsOf(kind)) {
    for (const view of FAIRY_VIEWS) table.set(fairyStateName(row, view), { row, view });
  }
  return table;
}

function fairyFigure(kind: FairyKind): FigureDef {
  const states = stateTable(kind);
  const frames: Record<string, number> = {};
  for (const [name, ref] of states) frames[name] = fairyRowFrames(ref.row);
  return {
    id: `fairy_${kind}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: TILE_SCALE,
    states: figureStates(frames),
    // The outline is one screen pixel at whatever density the cell is painted
    // at; supersampling would bake it at half a pixel and smear it into the fill.
    skipSupersample: true,
    paintFrame: (ctx, state, frame) => {
      const ref = states.get(state);
      if (ref === undefined) return;
      ctx.save();
      try {
        ctx.translate(TILE_X + TILE_SCALE / 2, TILE_Y + TILE_SCALE / 2);
        ctx.scale(TILE_SCALE, TILE_SCALE);
        drawFairy(ctx, kind, ref.view, poseFor(kind, ref.row, frame));
      } finally {
        ctx.restore();
      }
    },
  };
}

/** One figure per kind; each paints only its own casting rows. */
export const FAIRY_FIGURES: ReadonlyMap<FairyKind, FigureDef> = new Map(
  FAIRY_KINDS.map((kind) => [kind, fairyFigure(kind)] as const),
);

export function fairyFigureOf(kind: FairyKind): FigureDef {
  const figure = FAIRY_FIGURES.get(kind);
  if (figure === undefined) throw new Error(`no fairy figure "${kind}"`);
  return figure;
}
