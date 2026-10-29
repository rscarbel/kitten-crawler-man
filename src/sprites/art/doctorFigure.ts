/**
 * The safe-room doctor: a human who keeps a corner of every safe room, on the
 * human rig (`biped/figure.ts`) in a long white coat over dark clothes, the
 * coat's sleeves rolled to the elbow, with a stethoscope round the neck
 * (`doctorArt.ts`).
 *
 * Every safe room's doctor is a different person: `doctorLookForRoom` turns a
 * room's seed (`safeRoomSeed`, from its map and its index there) into a skin
 * tone, hair, build and body from the human cast's
 * own swatches, hairstyles and facial hair (`townCastLooks.ts`,
 * `human/castHead.ts`). Each look is its own `FigureDef` with the look's id
 * in its figure id, so two doctors never share a cached cell.
 *
 * The doctor stands at a cabinet and always faces south, so every row is
 * painted head-on only:
 *
 *   idle    — the rig's breathing idle, arms hanging at the sides
 *   writing — notes on a clipboard held at the chest, the pen moving along a line
 *   sorting — one reach up and back into the cabinet, a bottle brought forward
 *             and turned in the hand, then put back
 *   treat   — half a pace forward, a quick dose and a wrap of a bandage, and
 *             back; it starts and ends on the idle's first frame
 */

import { TILE_SIZE } from '../../core/constants';
import { safeRoomSeed, type SafeRoomId } from '../../map/safeRoomId';
import {
  BUILD_WIDTH_SCALE,
  FEMININE_EXPRESSION,
  FEMININE_WIDTH_SCALE,
  HAIR_COLOR_BASES,
  MASCULINE_EXPRESSION,
  SKIN_TONE_BASES,
  type TownCastBuild,
} from '../person/townCastLooks';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { drawFigureCached, prewarmFigureState } from '../figure/figureFrameCache';
import { ResidentRows, type ResidentSpan } from '../figure/residentRows';
import { stillOutfit } from '../garments/human/humanDressing';
import { DAVE_JACKET } from '../garments/human/daveJacket';
import {
  resetTownsfolkLegwear,
  setTownsfolkLegwear,
  TOWNSFOLK_SHOES,
  TOWNSFOLK_TROUSERS,
  type TownsfolkLegwear,
} from '../garments/human/townsfolkLegwear';
import { outfitOf } from '../garments/outfit';
import { type BipedAttachments, drawBipedFront } from './biped/figure';
import { type BipedPose, buildSkeleton, VIEWS } from './biped/rig';
import { deriveGlossRamp, deriveRamp, type GlossRamp, type Ramp } from './biped/palette';
import { handGrip } from './biped/limbs';
import { SHOULDER_Y } from './biped/proportions';
import { RIG_GARMENT_CUT } from './biped/torso';
import { ROLLED_SLEEVE } from './biped/sleeve';
import type { HeadFeaturePainter } from './biped/head';
import type { FacialHairKind, HairStyleKind } from './human/castHead';
import { idleFront } from './human/idles';
import { towards, rolled, turnHand } from './human/handTurn';
import {
  heldFrameAt,
  IDLE_BREATH_TICKS,
  IDLE_FRAME_TICKS,
  IDLE_FRAMES,
  idleBlinkLid,
  idleBreathPhase,
  TICKS_PER_SECOND,
} from './human/timing';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { type HumanLook, lookPxPerUnit } from '../looks/humanLook';
import { RIG_LOOK } from '../looks/humans/rig';
import { clamp01, deg, easeInOut, hump, lerp, type Pt, ramp } from './bipedArt';
import {
  COAT_CLOTH,
  COAT_HEM_DROP,
  doctorAttachments,
  type DoctorDress,
  type DoctorKit,
  EMPTY_HANDS,
} from './doctorArt';

type Ctx = CanvasRenderingContext2D;

// ── Actions ──────────────────────────────────────────────────────────────────

export const DOCTOR_ACTIONS = ['idle', 'writing', 'sorting', 'treat'] as const;
export type DoctorAction = (typeof DOCTOR_ACTIONS)[number];

// ── Who the doctor is ────────────────────────────────────────────────────────

/**
 * Skin tones: the human cast's own, with a paler and a deeper tone either
 * side of its range, so the doctors run the whole span of real skin, and a
 * light tan between the cast's fair and tan. Eight, so the list's length
 * shares no factor with the hair colours' seven and no skin always comes
 * with the same hair.
 */
const PALEST_SKIN = '#f6dcc8';
const LIGHT_TAN_SKIN = '#e3b48c';
const DEEPEST_SKIN = '#3a2314';
const DOCTOR_SKIN_BASES: readonly string[] = [
  PALEST_SKIN,
  LIGHT_TAN_SKIN,
  ...SKIN_TONE_BASES,
  DEEPEST_SKIN,
];

/** Hair colours: the cast's own, and white, for the oldest heads. */
const WHITE_HAIR = '#d9d5cc';
const DOCTOR_HAIR_BASES: readonly string[] = [...HAIR_COLOR_BASES, WHITE_HAIR];

/** Every hairstyle a doctor of each body can wear; a bald head and a receding line among the men's. */
const MASCULINE_HAIRSTYLES: readonly HairStyleKind[] = ['sidePart', 'bald', 'curly', 'receding'];
const FEMININE_HAIRSTYLES: readonly HairStyleKind[] = ['bun', 'ponytail', 'long', 'curly'];
/** Facial hair, clean-shaven twice in the cycle: most doctors keep a shaven face. */
const MASCULINE_FACIAL_HAIR: readonly FacialHairKind[] = [
  'none',
  'fullBeard',
  'none',
  'moustache',
  'goatee',
];
const DOCTOR_BUILDS: readonly Exclude<TownCastBuild, 'child'>[] = ['standard', 'slight', 'heavy'];
const DOCTOR_BODIES: readonly boolean[] = [false, true];

/** Dark tops for under the coat: charcoal, navy, deep teal, plum and black. */
const SHIRT_BASES: readonly string[] = ['#2a2d36', '#1f2d48', '#1f3a38', '#3b2433', '#1c1c20'];
const TROUSER_BASES: readonly string[] = ['#24252b', '#1d2333', '#2e2924'];
const SHOE_BASES: readonly string[] = ['#1a1616', '#2a1d14'];

/**
 * One trait's choice for a room: the room's seed stepped round the trait's
 * list by a stride sharing no factor with its length. Rooms on one map have
 * consecutive seeds, so neighbouring rooms differ in every trait, and since
 * the lists' lengths share no common cycle shorter than their product's, rooms
 * far apart differ in at least one.
 */
interface TraitCycle {
  readonly stride: number;
  readonly offset: number;
}

const SKIN_CYCLE: TraitCycle = { stride: 3, offset: 2 };
const HAIR_CYCLE: TraitCycle = { stride: 2, offset: 4 };
const STYLE_CYCLE: TraitCycle = { stride: 1, offset: 0 };
const FACIAL_CYCLE: TraitCycle = { stride: 2, offset: 1 };
const BUILD_CYCLE: TraitCycle = { stride: 1, offset: 0 };
const BODY_CYCLE: TraitCycle = { stride: 1, offset: 0 };
const SHIRT_CYCLE: TraitCycle = { stride: 3, offset: 0 };
const TROUSER_CYCLE: TraitCycle = { stride: 2, offset: 0 };
const SHOE_CYCLE: TraitCycle = { stride: 1, offset: 0 };

function traitIndex(seed: number, length: number, cycle: TraitCycle): number {
  const raw = seed * cycle.stride + cycle.offset;
  return ((raw % length) + length) % length;
}

function traitOf<T>(seed: number, list: readonly T[], cycle: TraitCycle): T {
  return list[traitIndex(seed, list.length, cycle)];
}

/** One safe room's doctor: who they are, seeded by the room. Opaque to callers except `id`. */
export interface DoctorLook {
  readonly id: string;
  readonly skin: Ramp;
  readonly hair: Ramp;
  readonly hairStyle: HairStyleKind;
  readonly facialHair: FacialHairKind;
  readonly feminine: boolean;
  readonly widthScale: number;
  readonly shirt: GlossRamp;
  readonly trousers: GlossRamp;
  readonly shoes: GlossRamp;
}

/** The doctor who keeps `room`, the same person on every visit. */
export function doctorLookForRoom(room: SafeRoomId): DoctorLook {
  const seed = safeRoomSeed(room);
  const skinIndex = traitIndex(seed, DOCTOR_SKIN_BASES.length, SKIN_CYCLE);
  const hairIndex = traitIndex(seed, DOCTOR_HAIR_BASES.length, HAIR_CYCLE);
  const feminine = traitOf(seed, DOCTOR_BODIES, BODY_CYCLE);
  const hairStyle = traitOf(
    seed,
    feminine ? FEMININE_HAIRSTYLES : MASCULINE_HAIRSTYLES,
    STYLE_CYCLE,
  );
  const facialHair = feminine ? 'none' : traitOf(seed, MASCULINE_FACIAL_HAIR, FACIAL_CYCLE);
  const build = traitOf(seed, DOCTOR_BUILDS, BUILD_CYCLE);
  const shirtIndex = traitIndex(seed, SHIRT_BASES.length, SHIRT_CYCLE);
  const trouserIndex = traitIndex(seed, TROUSER_BASES.length, TROUSER_CYCLE);
  const shoeIndex = traitIndex(seed, SHOE_BASES.length, SHOE_CYCLE);
  const body = feminine ? 'f' : 'm';
  return {
    id: [
      'doctor',
      `s${skinIndex}`,
      `h${hairIndex}`,
      hairStyle,
      facialHair,
      build,
      body,
      `c${shirtIndex}${trouserIndex}${shoeIndex}`,
    ].join('_'),
    skin: deriveRamp(DOCTOR_SKIN_BASES[skinIndex]),
    hair: deriveRamp(DOCTOR_HAIR_BASES[hairIndex]),
    hairStyle,
    facialHair,
    feminine,
    widthScale: BUILD_WIDTH_SCALE[build] * (feminine ? FEMININE_WIDTH_SCALE : 1),
    shirt: deriveGlossRamp(SHIRT_BASES[shirtIndex]),
    trousers: deriveGlossRamp(TROUSER_BASES[trouserIndex]),
    shoes: deriveGlossRamp(SHOE_BASES[shoeIndex]),
  };
}

// ── The look on the rig ──────────────────────────────────────────────────────

/** The coat flares out from the waist a little, as a coat open below its last button hangs. */
const COAT_HEM_FLARE = 1.18;
/** Cotton drill: its folds lie softer than leather's and its yoke seam is a fine line. */
const COAT_FOLD_WEIGHT = 0.5;
const COAT_SEAM_WEIGHT = 0.15;

/** The rig paints no hair: the look's own is painted over the head by the attachments. */
const HAIR_PAINTED_BY_ATTACHMENT: HeadFeaturePainter = () => undefined;

function humanLookOf(look: DoctorLook): HumanLook {
  return {
    ...RIG_LOOK,
    id: look.id,
    skin: look.skin,
    hair: look.hair,
    garment: COAT_CLOTH,
    garmentCut: {
      ...RIG_GARMENT_CUT,
      hemDrop: COAT_HEM_DROP,
      hasHardware: false,
      hemFlare: COAT_HEM_FLARE,
      foldWeight: COAT_FOLD_WEIGHT,
      seamWeight: COAT_SEAM_WEIGHT,
    },
    sleeveCut: ROLLED_SLEEVE,
    hairstyle: HAIR_PAINTED_BY_ATTACHMENT,
    facialHair: null,
    expression: look.feminine ? FEMININE_EXPRESSION : MASCULINE_EXPRESSION,
    widthScale: look.widthScale,
    baseGarments: [DAVE_JACKET],
  };
}

// ── Shared choreography ──────────────────────────────────────────────────────

type Side = 'left' | 'right';

const HALF = 0.5;

/** A keyed track: values at shares of the row, eased between neighbouring keys. */
type Keys<T> = readonly (readonly [number, T])[];

function keyedPt(t: number, keys: Keys<Pt>): Pt {
  const [firstAt, first] = keys[0];
  if (t <= firstAt) return first;
  for (let i = 1; i < keys.length; i++) {
    const [at, value] = keys[i];
    if (t <= at) {
      const [fromAt, from] = keys[i - 1];
      const s = easeInOut((t - fromAt) / (at - fromAt));
      return { x: lerp(from.x, value.x, s), y: lerp(from.y, value.y, s) };
    }
  }
  return keys[keys.length - 1][1];
}

function keyed(t: number, keys: Keys<number>): number {
  return keyedPt(
    t,
    keys.map(([at, value]): readonly [number, Pt] => [at, { x: value, y: 0 }]),
  ).x;
}

/** Where his wrists hang on the idle's first frame, in the pose's own coordinates. */
const SEAM_SKELETON = buildSkeleton(idleFront(0), VIEWS.front);
const SEAM_WRIST: Readonly<Record<Side, Pt>> = {
  left: SEAM_SKELETON.leftArm.end,
  right: SEAM_SKELETON.rightArm.end,
};

/** Places one hand by its target, its arm solved from it rather than posed by the idle's joint angles. */
function placeHand(pose: BipedPose, side: Side, target: Pt, depth: number): void {
  if (side === 'left') {
    pose.leftArmAngles = null;
    pose.leftHand = target;
    pose.leftHandDepth = depth;
    pose.leftArmBehind = depth < 0;
  } else {
    pose.rightArmAngles = null;
    pose.rightHand = target;
    pose.rightHandDepth = depth;
    pose.rightArmBehind = depth < 0;
  }
}

/** A hand on its way from the seam's hang to `target`, `share` of the way. */
function fromSeam(side: Side, target: Pt, share: number): Pt {
  const seam = SEAM_WRIST[side];
  return { x: lerp(seam.x, target.x, share), y: lerp(seam.y, target.y, share) };
}

/** The bottle's own angle in the hand for its long axis to point along `aim` on screen. */
function bottleAngleFor(pose: BipedPose, aim: number): number {
  const chain = buildSkeleton(pose, VIEWS.front).rightArm;
  return aim - handGrip(chain).haftAngle;
}

const BOTTLE_UPRIGHT = deg(-90);
/** Head-on the bottle is held round its body with the back of the hand toward the camera. */
const BOTTLE_PALM = towards(-0.5, 0, -0.85);
const BOTTLE_PALM_TURNED = towards(0.5, 0, -0.85);

function holdBottle(pose: BipedPose, aim: number, turn: number): void {
  pose.rightHandShape = 'grip';
  turnHand(pose, 'right', rolled(BOTTLE_PALM, BOTTLE_PALM_TURNED, turn));
  pose.heldProps = [{ kind: 'bottle', hand: 'right', angle: bottleAngleFor(pose, aim) }];
}

/** The idle frame every one-shot leaves from and returns to. */
function seamPose(): BipedPose {
  return idleFront(0);
}

function isSeam(t: number): boolean {
  return t <= 0 || t >= 1;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

function idlePose(frame: number): BipedPose {
  return idleFront(idleBreathPhase(frame), idleBlinkLid(frame));
}

// ── Writing ──────────────────────────────────────────────────────────────────

const WRITING_FRAMES = 12;
const WRITING_SECONDS = 2.4;

/** Head bowed over the board, eyes on the page. */
const WRITING_CHIN = -0.5;
const WRITING_GAZE = -0.6;
const WRITING_HEAD_TILT = deg(4);
/**
 * His left hand under the board's outer corner, out toward his left side, so
 * the board stands clear of the writing arm crossing in from his right.
 */
const CLIPBOARD_HAND: Pt = { x: -0.19, y: -1.24 };
const CLIPBOARD_HAND_DEPTH = 0.2;
/** The pen's line across the page, in the pose's own coordinates: his right toward +X. */
const PEN_LINE_FROM: Pt = { x: -0.01, y: -1.43 };
const PEN_LINE_TO: Pt = { x: -0.13, y: -1.41 };
const PEN_HAND_DEPTH = 0.25;
/** The share of the loop spent writing along the line; the rest carries the pen back. */
const WRITING_STROKE_SHARE = 0.75;
/** The small up-and-down of letters being formed, and how many fit along the line. */
const LETTER_HEIGHT = 0.012;
const LETTERS_PER_LINE = 5;
/** How far the pen lifts off the page as it is carried back. */
const PEN_LIFT = 0.025;
const PEN_FIST = 0.7;
const CLIPBOARD_FIST = 0.6;
/** He breathes once per pass of the line, and blinks as the pen goes back. */
const WRITING_BLINK_FRAME = 10;

function writingPose(frame: number): BipedPose {
  const t = frame / WRITING_FRAMES;
  const pose = idleFront(t, frame === WRITING_BLINK_FRAME ? 1 : 0);
  pose.chinLift = WRITING_CHIN;
  pose.gazeUp = WRITING_GAZE;
  pose.headTilt = WRITING_HEAD_TILT;
  placeHand(pose, 'left', CLIPBOARD_HAND, CLIPBOARD_HAND_DEPTH);
  pose.leftFist = CLIPBOARD_FIST;

  const writing = t < WRITING_STROKE_SHARE;
  const along = writing
    ? t / WRITING_STROKE_SHARE
    : 1 - (t - WRITING_STROKE_SHARE) / (1 - WRITING_STROKE_SHARE);
  const letters = writing ? Math.sin(along * Math.PI * 2 * LETTERS_PER_LINE) * LETTER_HEIGHT : 0;
  const lift = writing
    ? 0
    : hump((t - WRITING_STROKE_SHARE) / (1 - WRITING_STROKE_SHARE)) * PEN_LIFT;
  const pen: Pt = {
    x: lerp(PEN_LINE_FROM.x, PEN_LINE_TO.x, along),
    y: lerp(PEN_LINE_FROM.y, PEN_LINE_TO.y, along) + letters - lift,
  };
  placeHand(pose, 'right', pen, PEN_HAND_DEPTH);
  pose.rightFist = PEN_FIST;
  return pose;
}

const WRITING_KIT: DoctorKit = { clipboard: true, pen: true };

// ── Sorting ──────────────────────────────────────────────────────────────────

const SORTING_FRAMES = 16;
const SORTING_SECONDS = 3;

/** Up and back over his right shoulder, into the cabinet behind him. */
const SHELF_ABOVE_SHOULDERS = 0.32;
const SHELF_REACH: Pt = { x: 0.3, y: SHOULDER_Y - SHELF_ABOVE_SHOULDERS };
const SHELF_DEPTH = -0.35;
/** The hand settles a little inward and down as it closes on the bottle on the shelf. */
const SHELF_GRAB: Pt = { x: SHELF_REACH.x - 0.02, y: SHELF_REACH.y + 0.03 };
/** The bottle held up before his chest to be read, drifting a little as he turns it. */
const EXAMINE_AT: Pt = { x: 0.05, y: -1.42 };
const EXAMINE_DRIFTED: Pt = { x: EXAMINE_AT.x + 0.02, y: EXAMINE_AT.y + 0.02 };
const EXAMINE_DEPTH = 0.25;
/** The empty hand closes as it rises toward the shelf. */
const REACH_FIST_FROM = 0.1;
const REACH_FIST_TO = 0.2;

const SORTING_HAND: Keys<Pt> = [
  [0, SEAM_WRIST.right],
  [0.2, SHELF_REACH],
  [0.28, SHELF_GRAB],
  [0.42, EXAMINE_AT],
  [0.64, EXAMINE_DRIFTED],
  [0.78, SHELF_REACH],
  [0.84, SHELF_REACH],
  [1, SEAM_WRIST.right],
];
const SORTING_DEPTH: Keys<number> = [
  [0, 0],
  [0.2, SHELF_DEPTH],
  [0.28, SHELF_DEPTH],
  [0.42, EXAMINE_DEPTH],
  [0.64, EXAMINE_DEPTH],
  [0.78, SHELF_DEPTH],
  [0.84, SHELF_DEPTH],
  [1, 0],
];
/** The shoulders turn toward the reach; the head follows the hand. */
const SORTING_TWIST: Keys<number> = [
  [0, 0],
  [0.2, 0.35],
  [0.28, 0.35],
  [0.42, 0.08],
  [0.64, 0.08],
  [0.78, 0.35],
  [0.84, 0.35],
  [1, 0],
];
const SORTING_HEAD_TURN: Keys<number> = [
  [0, 0],
  [0.2, 0.45],
  [0.28, 0.45],
  [0.42, 0.12],
  [0.64, 0.12],
  [0.78, 0.45],
  [0.84, 0.35],
  [1, 0],
];
const SORTING_CHIN: Keys<number> = [
  [0, 0],
  [0.2, 0.25],
  [0.28, 0.25],
  [0.42, -0.35],
  [0.64, -0.35],
  [0.78, 0.25],
  [0.84, 0.2],
  [1, 0],
];
/** The bottle is in his hand from the grab to the put-back. */
const BOTTLE_TAKEN = 0.27;
const BOTTLE_RETURNED = 0.8;
/** While he reads it he turns it about its long axis, and tips it a little to see the label. */
const BOTTLE_TURNING_FROM = 0.44;
const BOTTLE_TURNING_TO = 0.66;
const BOTTLE_TIP = deg(18);

function sortingPose(frame: number): BipedPose {
  const t = frame / (SORTING_FRAMES - 1);
  const pose = seamPose();
  if (isSeam(t)) return pose;
  placeHand(pose, 'right', keyedPt(t, SORTING_HAND), keyed(t, SORTING_DEPTH));
  pose.twist = keyed(t, SORTING_TWIST);
  pose.headTurn = keyed(t, SORTING_HEAD_TURN);
  pose.chinLift = keyed(t, SORTING_CHIN);
  if (t >= BOTTLE_TAKEN && t <= BOTTLE_RETURNED) {
    const turning = ramp(t, BOTTLE_TURNING_FROM, BOTTLE_TURNING_TO);
    const tip = Math.sin(turning * Math.PI * 2) * BOTTLE_TIP;
    holdBottle(pose, BOTTLE_UPRIGHT + tip, turning);
  } else {
    pose.rightFist = lerp(pose.rightFist, 1, ramp(t, REACH_FIST_FROM, REACH_FIST_TO));
  }
  return pose;
}

// ── Treat ────────────────────────────────────────────────────────────────────

const TREAT_FRAMES = 20;
const TREAT_SECONDS = 3.4;

/** Half a pace toward the camera, in tiles: how far down the screen the step carries him. */
const TREAT_STEP_TILES = 0.22;
/** Share of the row each foot is off the floor: out right then left, back left then right. */
interface FootLift {
  readonly side: Side;
  readonly from: number;
  readonly to: number;
}
const TREAT_FOOT_LIFTS: readonly FootLift[] = [
  { side: 'right', from: 0.03, to: 0.15 },
  { side: 'left', from: 0.15, to: 0.27 },
  { side: 'left', from: 0.79, to: 0.885 },
  { side: 'right', from: 0.885, to: 0.98 },
];
const FOOT_LIFT = 0.07;
/** How far through the step he has come, 0 at the cabinet to 1 at his patient. */
const TREAT_STEP: Keys<number> = [
  [0.03, 0],
  [0.15, 0.5],
  [0.27, 1],
  [0.79, 1],
  [0.885, 0.5],
  [0.98, 0],
];

/** Both hands brought forward and together before the bottom of his chest. */
const TREAT_HANDS_AT: Pt = { x: 0, y: -1.3 };
const TREAT_HAND_DEPTH = 0.3;
const TREAT_HAND_APART = 0.06;
/** The dose: his right hand presses down twice into the left. */
const DOSE_FROM = 0.33;
const DOSE_TO = 0.45;
const DOSE_PRESSES = 2;
const DOSE_PRESS = 0.04;
/** The bandage wrapped round: the hands circle each other twice. */
const WRAP_FROM = 0.45;
const WRAP_TO = 0.7;
const WRAP_TURNS = 2;
const WRAP_RADIUS_ACROSS = 0.1;
const WRAP_RADIUS_UP = 0.06;
/** Hands come forward while he steps in, and go back to his sides before he steps out. */
const HANDS_IN_FROM = 0.2;
const HANDS_IN_TO = 0.33;
const HANDS_OUT_FROM = 0.7;
const HANDS_OUT_TO = 0.79;
/** He leans in over his patient and looks down at the work. */
const TREAT_PITCH = 0.18;
const TREAT_CHIN = -0.4;
const TREAT_GAZE = -0.5;

function treatStepShare(t: number): number {
  return keyed(t, TREAT_STEP);
}

function treatPose(frame: number): BipedPose {
  const t = frame / (TREAT_FRAMES - 1);
  const pose = seamPose();
  if (isSeam(t)) return pose;

  for (const lift of TREAT_FOOT_LIFTS) {
    if (t <= lift.from || t >= lift.to) continue;
    const height = hump((t - lift.from) / (lift.to - lift.from)) * FOOT_LIFT;
    if (lift.side === 'left') pose.leftFoot = { x: pose.leftFoot.x, y: -height };
    else pose.rightFoot = { x: pose.rightFoot.x, y: -height };
  }

  const handsIn = ramp(t, HANDS_IN_FROM, HANDS_IN_TO) * (1 - ramp(t, HANDS_OUT_FROM, HANDS_OUT_TO));
  if (handsIn <= 0) return pose;

  const lean = handsIn;
  pose.torsoPitch = TREAT_PITCH * lean;
  pose.chinLift = TREAT_CHIN * lean;
  pose.gazeUp = TREAT_GAZE * lean;

  let right: Pt = { x: TREAT_HANDS_AT.x + TREAT_HAND_APART, y: TREAT_HANDS_AT.y };
  let left: Pt = { x: TREAT_HANDS_AT.x - TREAT_HAND_APART, y: TREAT_HANDS_AT.y };
  if (t > DOSE_FROM && t < DOSE_TO) {
    const press = hump((((t - DOSE_FROM) / (DOSE_TO - DOSE_FROM)) * DOSE_PRESSES) % 1);
    right = { x: right.x - TREAT_HAND_APART * HALF, y: right.y + press * DOSE_PRESS };
  }
  if (t >= WRAP_FROM && t <= WRAP_TO) {
    const wrap = (t - WRAP_FROM) / (WRAP_TO - WRAP_FROM);
    const angle = wrap * WRAP_TURNS * Math.PI * 2;
    const fade = hump(wrap);
    const dx = Math.cos(angle) * WRAP_RADIUS_ACROSS * fade;
    const dy = Math.sin(angle) * WRAP_RADIUS_UP * fade;
    right = { x: right.x + dx, y: right.y + dy };
    left = { x: left.x - dx, y: left.y - dy };
  }
  placeHand(pose, 'right', fromSeam('right', right, handsIn), TREAT_HAND_DEPTH * handsIn);
  placeHand(pose, 'left', fromSeam('left', left, handsIn), TREAT_HAND_DEPTH * handsIn);
  pose.leftArmBehind = false;
  pose.rightArmBehind = false;
  return pose;
}

// ── Row table ────────────────────────────────────────────────────────────────

interface DoctorRow {
  readonly frames: number;
  readonly loops: boolean;
  /** Ticks at 60 a second one pass of the row takes. */
  readonly ticks: number;
  readonly pose: (frame: number) => BipedPose;
  readonly kit: DoctorKit;
  /** How far down his tile the frame's body stands, in tiles: only the treat steps. */
  readonly stepTiles: (frame: number) => number;
}

const STANDS_STILL = (): number => 0;

const DOCTOR_ROWS: Readonly<Record<DoctorAction, DoctorRow>> = {
  idle: {
    frames: IDLE_FRAMES,
    loops: true,
    ticks: IDLE_BREATH_TICKS,
    pose: idlePose,
    kit: EMPTY_HANDS,
    stepTiles: STANDS_STILL,
  },
  writing: {
    frames: WRITING_FRAMES,
    loops: true,
    ticks: Math.round(WRITING_SECONDS * TICKS_PER_SECOND),
    pose: writingPose,
    kit: WRITING_KIT,
    stepTiles: STANDS_STILL,
  },
  sorting: {
    frames: SORTING_FRAMES,
    loops: false,
    ticks: Math.round(SORTING_SECONDS * TICKS_PER_SECOND),
    pose: sortingPose,
    kit: EMPTY_HANDS,
    stepTiles: STANDS_STILL,
  },
  treat: {
    frames: TREAT_FRAMES,
    loops: false,
    ticks: Math.round(TREAT_SECONDS * TICKS_PER_SECOND),
    pose: treatPose,
    kit: EMPTY_HANDS,
    stepTiles: (frame) => treatStepShare(frame / (TREAT_FRAMES - 1)) * TREAT_STEP_TILES,
  },
};

/** Frames (at 60 fps) one pass of the row takes. */
export function doctorActionDurationFrames(action: DoctorAction): number {
  return DOCTOR_ROWS[action].ticks;
}

/** Whether the row loops (idle, writing) or plays once (sorting, treat). */
export function doctorActionLoops(action: DoctorAction): boolean {
  return DOCTOR_ROWS[action].loops;
}

/** The frame of a row a phase 0..1 through one pass of it draws. */
function doctorFrame(action: DoctorAction, phase: number): number {
  const row = DOCTOR_ROWS[action];
  if (action === 'idle') {
    const wrapped = phase - Math.floor(phase);
    return heldFrameAt(IDLE_FRAME_TICKS, wrapped * IDLE_BREATH_TICKS);
  }
  if (!row.loops) return Math.round(clamp01(phase) * (row.frames - 1));
  const wrapped = phase - Math.floor(phase);
  return Math.floor(wrapped * row.frames) % row.frames;
}

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / DOCTOR_TILE_SCALE`. */
const DOCTOR_TILE_SCALE = 64;
/**
 * Room for the reach up over his head, a heavy build's arms, and below the
 * soles the treat's step toward the camera plus the contact shadow.
 */
const CELL_WIDTH = 150;
const CELL_HEIGHT = 208;
const SHADOW_MARGIN = 12;
const STEP_MARGIN = Math.ceil(TREAT_STEP_TILES * DOCTOR_TILE_SCALE);
const GROUND_Y = CELL_HEIGHT - SHADOW_MARGIN - STEP_MARGIN;
const ORIGIN_X = CELL_WIDTH / 2;
const HALF_TILE = DOCTOR_TILE_SCALE / 2;

/** The cast's trousers and shoes over the rig's bare legs, and the recut jacket as the coat. */
const DOCTOR_LEGWEAR = [TOWNSFOLK_TROUSERS, TOWNSFOLK_SHOES];

function buildDoctorFigure(look: DoctorLook): FigureDef {
  const humanLook = humanLookOf(look);
  const unitPx = lookPxPerUnit(humanLook, HUMAN_CELL_PX_PER_UNIT);
  const outfit = stillOutfit(outfitOf(humanLook, DOCTOR_LEGWEAR));
  const dress: DoctorDress = {
    head: { hairStyle: look.hairStyle, facialHair: look.facialHair, hair: look.hair },
    shirt: look.shirt,
    trousers: look.trousers,
  };
  const legwear: TownsfolkLegwear = {
    cloth: look.trousers,
    cut: 'trousers',
    footwear: look.shoes,
    muddy: false,
  };
  const attachmentsByKit = new Map<DoctorKit, BipedAttachments>();
  const attachmentsFor = (kit: DoctorKit): BipedAttachments => {
    const known = attachmentsByKit.get(kit);
    if (known !== undefined) return known;
    const made = doctorAttachments(dress, kit);
    attachmentsByKit.set(kit, made);
    return made;
  };
  const frames: Record<string, number> = {};
  for (const action of DOCTOR_ACTIONS) frames[action] = DOCTOR_ROWS[action].frames;

  return {
    id: `human:${look.id}`,
    frameWidth: CELL_WIDTH,
    frameHeight: CELL_HEIGHT,
    tileX: ORIGIN_X - HALF_TILE,
    tileY: GROUND_Y - DOCTOR_TILE_SCALE,
    tileScale: DOCTOR_TILE_SCALE,
    // The rig composes on its own surface at the bake's density with a
    // one-pixel outline; a supersampled bake would only smear it.
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: (ctx: Ctx, state: string, frame: number) => {
      const action = DOCTOR_ACTIONS.find((candidate) => candidate === state);
      if (action === undefined) return;
      const row = DOCTOR_ROWS[action];
      const pose: BipedPose = { ...row.pose(frame), outfit };
      // Reset in `finally`: a painter that throws mid-bake must not leave the
      // next figure baked in this doctor's legwear.
      setTownsfolkLegwear(legwear);
      ctx.save();
      try {
        ctx.translate(ORIGIN_X, GROUND_Y + row.stepTiles(frame) * DOCTOR_TILE_SCALE);
        ctx.scale(unitPx.x, unitPx.y);
        drawBipedFront(ctx, pose, { look: humanLook, attachments: attachmentsFor(row.kit) });
      } finally {
        ctx.restore();
        resetTownsfolkLegwear();
      }
    },
  };
}

const FIGURES_BY_LOOK = new Map<string, FigureDef>();

/** The figure one doctor is painted as, built the first time it is asked for. */
export function doctorFigure(look: DoctorLook): FigureDef {
  const known = FIGURES_BY_LOOK.get(look.id);
  if (known !== undefined) return known;
  const figure = buildDoctorFigure(look);
  FIGURES_BY_LOOK.set(look.id, figure);
  return figure;
}

// ── Runtime ──────────────────────────────────────────────────────────────────

/**
 * Every row a doctor plays, held warm while they are drawn or about to be:
 * the treatment and the cabinet visit start on a press or a timer, long after
 * the idle sweep would have released rows that had not been drawn.
 */
const RESIDENT_SPANS: readonly ResidentSpan[] = DOCTOR_ACTIONS.map((action) => ({
  row: action,
  frames: DOCTOR_ROWS[action].frames,
}));

/** One hold per look: a hold re-asks for its rows from scratch whenever its figure changes. */
const RESIDENT_ROWS_BY_LOOK = new Map<string, ResidentRows>();

/**
 * Keeps every row of one doctor warm, queuing any that is cold. Call on every
 * rendered frame the doctor is on screen or about to scroll onto it.
 */
export function keepDoctorWarm(look: DoctorLook): void {
  let rows = RESIDENT_ROWS_BY_LOOK.get(look.id);
  if (rows === undefined) {
    rows = new ResidentRows(RESIDENT_SPANS);
    RESIDENT_ROWS_BY_LOOK.set(look.id, rows);
  }
  rows.hold(doctorFigure(look));
}

/**
 * Draws the doctor. `(x, y)` is the screen top-left of the tile they stand on (as drawFigureCached / drawScientist).
 * `phase` is 0..1 through one pass of the row.
 */
export function drawDoctor(
  ctx: CanvasRenderingContext2D,
  look: DoctorLook,
  action: DoctorAction,
  phase: number,
  x: number,
  y: number,
  tileSize: number,
): void {
  drawFigureCached(ctx, doctorFigure(look), action, doctorFrame(action, phase), x, y, tileSize);
}

/**
 * Bakes every row of one doctor ahead of the room being entered: a cell on
 * the human rig costs far more than one frame's bake budget, so a doctor
 * first drawn cold would stand blank or half-drawn for a moment.
 */
export function prewarmDoctor(look: DoctorLook): void {
  const figure = doctorFigure(look);
  for (const action of DOCTOR_ACTIONS) prewarmFigureState(figure, action);
}

/**
 * How far above the top of their tile the highest ink of the standing rows
 * reaches, in screen pixels at the game's 32 px tile — where a marker or a
 * speech bubble over the head hangs. Measured off the art by
 * `scripts/render-doctor.ts`, across every look it renders.
 */
export const DOCTOR_HEAD_TOP_ABOVE_TILE_PX = 21;

/** Screen y of the top of the head at any tile size, given the screen y of the top of their tile (like scientistHeadTop). */
export function doctorHeadTop(tileTopY: number, tileSize: number): number {
  return tileTopY - (DOCTOR_HEAD_TOP_ABOVE_TILE_PX * tileSize) / TILE_SIZE;
}
