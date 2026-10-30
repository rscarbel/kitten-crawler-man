/**
 * The thief over Taloncrest's roofs at dusk: a Hawkfolk in a dark hooded
 * cloak on broad grey wings, seen from above as it flies, the calico from the
 * General Store hung from its talons once it has her.
 *
 * The party does not yet know whose wings these are, so the figure gives them
 * only what a watcher on the street could make out against the evening: the
 * hood with a hooked beak jutting from it, the cloak streaming behind, and
 * wings the grey of the feather from the mill, every flight feather drawn.
 *
 * Painted facing +x and turned to its heading at the blit, so one row serves
 * every direction it flies. Its light falls straight down onto its back
 * rather than from a side, so turning the picture never turns the light.
 *
 * Rows, each a looping wingbeat of {@link WINGBEAT_FRAMES}:
 *    fly    talons tucked under the tail
 *    carry  legs hung back, the cat clutched under a closed tail
 */

import { lerp, rgba } from './bipedArt';
import { FEATHER_SHAFT } from './missingCatsArt';
import { AVIEL_GREY, BEAK, CERE, LEG_SCALE, TALON } from './hawkfolk/palette';
import type { Ramp } from './hawkfolk/paint';
import { fillSoftEllipse, strokeSoftCrease, withClip } from './softShade';
import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawFigureCached, prewarmFigureState } from '../figure/figureFrameCache';

const WINGBEAT_FRAMES = 8;
const STATES = ['fly', 'carry'] as const;
type ThiefRow = (typeof STATES)[number];

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per `size`: the unit every part below is measured in. */
const UNIT = 100;
/** Wide and deep enough for the wings at full stretch and the cat hung behind. */
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 190;
/** The body's centre, which is the point it turns about and the point its caller places. */
const CENTRE_X = 92;
const CENTRE_Y = FRAME_HEIGHT / 2;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const DEGREE = Math.PI / 180;

// ── Palette ──────────────────────────────────────────────────────────────────

const OUTLINE = '#15131a';
/** The outline as a share of `size`: about one screen pixel at the size it flies at. */
const OUTLINE_SHARE = 0.026;
/** The outline is stroked under the fills, so only the outer half of the stroke shows. */
const STROKE_UNDER_WIDTH = 2;

/** Aviel's own plumage, which is the feather's grey, so the deacon, the thief and the feather are plainly one bird's. */
const WING: Ramp = AVIEL_GREY.body;
const WING_TIP = '#3a3e46';
const FEATHER_SEAM = '#2a2d33';
const COVERT_LIGHT = '#c8ccd2';

const CLOAK: Ramp = { dark: '#141c22', mid: '#283a43', light: '#4a6672' };
const HOOD_SHADOW = '#07090b';

const TAIL: Ramp = { dark: '#4a4e56', mid: '#7d838c', light: '#a2a8b0' };
const TAIL_BAND = '#33363d';

const CALICO_WHITE: Ramp = { dark: '#bfb6a6', mid: '#eee8dc', light: '#fcf9f2' };
const CALICO_ORANGE = '#d0802e';
const CALICO_BLACK = '#25201d';
const CAT_EAR_INNER = '#c98a7a';

// ── Wingbeat ─────────────────────────────────────────────────────────────────

/**
 * From above a wing is read by how far it reaches out, not how high it is:
 * one raised toward the camera shortens, one pressed below level shortens
 * less. These are the wing's angle off level at each end of the beat.
 */
const DOWNSTROKE_ELEVATION = -18 * DEGREE;
const UPSTROKE_ELEVATION = 62 * DEGREE;
/** A raised wing is nearer the evening sky and catches a little more of it. */
const RAISED_WING_BRIGHTEN = 0.16;

interface WingbeatPose {
  /** 0 at the bottom of the downstroke, 1 at the top of the upstroke. */
  readonly raised: number;
  /** How folded the hand is: 0 through the downstroke, rising to 1 mid-upstroke. */
  readonly flex: number;
  /** Lateral reach left after foreshortening, 0 to 1. */
  readonly reach: number;
}

function wingbeatPose(frame: number): WingbeatPose {
  const angle = (frame / WINGBEAT_FRAMES) * FULL_TURN;
  const raised = HALF + HALF * Math.cos(angle);
  const elevation = lerp(DOWNSTROKE_ELEVATION, UPSTROKE_ELEVATION, raised);
  return { raised, flex: Math.max(0, -Math.sin(angle)), reach: Math.cos(elevation) };
}

// ── Coordinates ──────────────────────────────────────────────────────────────

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A point in the figure's own units (forward +x, `size` = 1) as cell pixels. */
function cell(x: number, y: number): Point {
  return { x: CENTRE_X + x * UNIT, y: CENTRE_Y + y * UNIT };
}

function moveTo(ctx: CanvasRenderingContext2D, point: Point): void {
  ctx.moveTo(point.x, point.y);
}

function lineTo(ctx: CanvasRenderingContext2D, point: Point): void {
  ctx.lineTo(point.x, point.y);
}

function curveTo(ctx: CanvasRenderingContext2D, control: Point, to: Point): void {
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
}

function mix(from: Point, to: Point, share: number): Point {
  return { x: lerp(from.x, to.x, share), y: lerp(from.y, to.y, share) };
}

/** `length` along `angle` from `origin`, where angle 0 points straight out to `side` and positive swings it forward. */
function reachOut(
  origin: Point,
  angle: number,
  length: number,
  side: number,
  reach: number,
): Point {
  return {
    x: origin.x + Math.sin(angle) * length,
    y: origin.y + side * Math.cos(angle) * length * reach,
  };
}

// ── Feathers ─────────────────────────────────────────────────────────────────

/** A feather's widest point, as a share of its length from the base. */
const FEATHER_WIDEST_SHARE = 0.55;

/** A tapered vane with a rounded tip from `base` to `tip`, `width` across at its widest, in units. */
function traceFeather(ctx: CanvasRenderingContext2D, base: Point, tip: Point, width: number): void {
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * width * HALF;
  const ny = (dx / length) * width * HALF;
  const widest = mix(base, tip, FEATHER_WIDEST_SHARE);
  const tipRound = mix(base, tip, 1 + width / length);
  ctx.moveTo(cell(base.x, base.y).x, cell(base.x, base.y).y);
  curveTo(ctx, cell(widest.x + nx, widest.y + ny), cell(tip.x + nx * HALF, tip.y + ny * HALF));
  curveTo(ctx, cell(tipRound.x, tipRound.y), cell(tip.x - nx * HALF, tip.y - ny * HALF));
  curveTo(ctx, cell(widest.x - nx, widest.y - ny), cell(base.x, base.y));
  ctx.closePath();
}

const FEATHER_TIP_DARKENS_FROM = 0.45;
const FEATHER_SEAM_ALPHA = 0.55;
const FEATHER_SEAM_WIDTH = 1.1;
const FEATHER_SHAFT_WIDTH = 0.9;
const FEATHER_SHAFT_SHARE = 0.8;

interface Feather {
  readonly base: Point;
  readonly tip: Point;
  readonly width: number;
}

/** A feather filled darker toward its tip, its shaft drawn down the middle. */
function paintFeather(
  ctx: CanvasRenderingContext2D,
  feather: Feather,
  root: string,
  tipInk: string,
  shaftAlpha: number,
): void {
  const base = cell(feather.base.x, feather.base.y);
  const tip = cell(feather.tip.x, feather.tip.y);
  const fill = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
  fill.addColorStop(0, root);
  fill.addColorStop(FEATHER_TIP_DARKENS_FROM, root);
  fill.addColorStop(1, tipInk);
  ctx.fillStyle = fill;
  ctx.beginPath();
  traceFeather(ctx, feather.base, feather.tip, feather.width);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = FEATHER_SEAM_ALPHA;
  ctx.strokeStyle = FEATHER_SEAM;
  ctx.lineWidth = FEATHER_SEAM_WIDTH;
  ctx.stroke();
  ctx.globalAlpha = shaftAlpha;
  ctx.strokeStyle = FEATHER_SHAFT;
  ctx.lineWidth = FEATHER_SHAFT_WIDTH;
  ctx.beginPath();
  moveTo(ctx, base);
  lineTo(ctx, mix(base, tip, FEATHER_SHAFT_SHARE));
  ctx.stroke();
  ctx.restore();
}

// ── The wing ─────────────────────────────────────────────────────────────────

const SHOULDER: Point = { x: 0.05, y: 0.1 };
const ARM_LENGTH = 0.25;
/** The arm reaches a little forward on the downstroke and drops back as the hand folds. */
const ARM_FORWARD = 14 * DEGREE;
const ARM_FOLDED_BACK = -8 * DEGREE;
const HAND_LENGTH = 0.2;
/** How far the hand sweeps back from the arm, spread and folded. */
const HAND_SWEEP_SPREAD = 16 * DEGREE;
const HAND_SWEEP_FOLDED = 58 * DEGREE;

const PRIMARY_COUNT = 6;
const PRIMARY_LENGTH_LEAD = 0.3;
const PRIMARY_LENGTH_REAR = 0.24;
const PRIMARY_WIDTH = 0.085;
/** Where along the hand the primaries root, wrist to tip. */
const PRIMARY_ROOT_FROM = 0.05;
const PRIMARY_ROOT_TO = 0.85;
/** The fan between the leading and rearmost primary: slotted wide on the downstroke, closed on the upstroke. */
const PRIMARY_FAN_SPREAD = 78 * DEGREE;
const PRIMARY_FAN_FOLDED = 34 * DEGREE;

const SECONDARY_COUNT = 7;
const SECONDARY_LENGTH = 0.24;
const SECONDARY_WIDTH = 0.1;
/** Secondaries hang back, a touch outward toward the wingtip. */
const SECONDARY_SPLAY = -80 * DEGREE;

const COVERT_ROWS = 2;
const COVERTS_PER_ROW = 6;
const COVERT_LENGTH = [0.12, 0.08] as const;
const COVERT_WIDTH = 0.07;
/** The outer coverts run onto the hand only as far as the primaries' first roots and a little past. */
const COVERTS_ON_HAND_SHARE = PRIMARY_ROOT_FROM * 2;
const LEADING_EDGE_WIDTH = 3.2;
const LEADING_EDGE_ALPHA = 0.7;
const SHAFT_ALPHA_PRIMARY = 0.45;
const SHAFT_ALPHA_SECONDARY = 0.3;
/** The trailing half of the wing in its own shade, over the fills, so the wing has a lit and an unlit side. */
const WING_SHADE_ALPHA = 0.32;

interface WingLayout {
  readonly primaries: readonly Feather[];
  readonly secondaries: readonly Feather[];
  readonly coverts: readonly Feather[];
  readonly shoulder: Point;
  readonly wrist: Point;
  readonly tip: Point;
}

function wingLayout(beat: WingbeatPose, side: number): WingLayout {
  const shoulder: Point = { x: SHOULDER.x, y: SHOULDER.y * side };
  const armAngle = lerp(ARM_FORWARD, ARM_FOLDED_BACK, beat.flex);
  const wrist = reachOut(shoulder, armAngle, ARM_LENGTH, side, beat.reach);
  const handAngle = armAngle - lerp(HAND_SWEEP_SPREAD, HAND_SWEEP_FOLDED, beat.flex);
  const tip = reachOut(wrist, handAngle, HAND_LENGTH, side, beat.reach);
  const fan = lerp(PRIMARY_FAN_SPREAD, PRIMARY_FAN_FOLDED, beat.flex);

  const primaries: Feather[] = [];
  for (let i = 0; i < PRIMARY_COUNT; i++) {
    const share = i / (PRIMARY_COUNT - 1);
    const root = mix(wrist, tip, lerp(PRIMARY_ROOT_TO, PRIMARY_ROOT_FROM, share));
    const angle = handAngle - fan * share;
    const length = lerp(PRIMARY_LENGTH_LEAD, PRIMARY_LENGTH_REAR, share);
    primaries.push({
      base: root,
      tip: reachOut(root, angle, length, side, beat.reach),
      width: PRIMARY_WIDTH,
    });
  }

  const secondaries: Feather[] = [];
  for (let i = 0; i < SECONDARY_COUNT; i++) {
    const share = (i + HALF) / SECONDARY_COUNT;
    const root = mix(shoulder, wrist, share);
    secondaries.push({
      base: root,
      tip: reachOut(root, SECONDARY_SPLAY, SECONDARY_LENGTH, side, beat.reach),
      width: SECONDARY_WIDTH,
    });
  }

  const coverts: Feather[] = [];
  for (let row = 0; row < COVERT_ROWS; row++) {
    const length = COVERT_LENGTH[row] ?? COVERT_LENGTH[0];
    for (let i = 0; i < COVERTS_PER_ROW; i++) {
      const share = (i + HALF * row) / COVERTS_PER_ROW;
      const onArm = share < HALF;
      const root = onArm
        ? mix(shoulder, wrist, share / HALF)
        : mix(wrist, tip, ((share - HALF) / HALF) * COVERTS_ON_HAND_SHARE);
      coverts.push({
        base: root,
        tip: reachOut(root, SECONDARY_SPLAY, length, side, beat.reach),
        width: COVERT_WIDTH,
      });
    }
  }
  return { primaries, secondaries, coverts, shoulder, wrist, tip };
}

function traceWing(ctx: CanvasRenderingContext2D, wing: WingLayout): void {
  for (const feather of [...wing.primaries, ...wing.secondaries, ...wing.coverts]) {
    traceFeather(ctx, feather.base, feather.tip, feather.width);
  }
  const root = cell(wing.shoulder.x, wing.shoulder.y);
  const wrist = cell(wing.wrist.x, wing.wrist.y);
  const back = cell(wing.shoulder.x - SECONDARY_LENGTH * HALF, wing.shoulder.y);
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.lineTo(back.x, back.y);
  ctx.closePath();
}

function paintWing(ctx: CanvasRenderingContext2D, wing: WingLayout, beat: WingbeatPose): void {
  for (const feather of [...wing.secondaries].reverse()) {
    paintFeather(ctx, feather, WING.mid, WING.dark, SHAFT_ALPHA_SECONDARY);
  }
  for (const feather of wing.primaries) {
    paintFeather(ctx, feather, WING.mid, WING_TIP, SHAFT_ALPHA_PRIMARY);
  }
  for (const feather of [...wing.coverts].reverse()) {
    paintFeather(ctx, feather, WING.light, WING.mid, 0);
  }

  const leadingStart = cell(wing.shoulder.x, wing.shoulder.y);
  const leadingWrist = cell(wing.wrist.x, wing.wrist.y);
  const leadingHand = cell(
    lerp(wing.wrist.x, wing.tip.x, PRIMARY_ROOT_TO),
    lerp(wing.wrist.y, wing.tip.y, PRIMARY_ROOT_TO),
  );

  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceWing(ctx, wing);
    },
    () => {
      const chordBack = cell(wing.wrist.x - SECONDARY_LENGTH, wing.wrist.y);
      const shade = ctx.createLinearGradient(
        leadingWrist.x,
        leadingWrist.y,
        chordBack.x,
        chordBack.y,
      );
      shade.addColorStop(0, rgba(WING.dark, 0));
      shade.addColorStop(1, rgba(WING.dark, WING_SHADE_ALPHA));
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      if (beat.raised > 0) {
        ctx.fillStyle = rgba(WING.light, RAISED_WING_BRIGHTEN * beat.raised);
        ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      }
    },
  );

  ctx.save();
  ctx.globalAlpha = LEADING_EDGE_ALPHA;
  ctx.strokeStyle = COVERT_LIGHT;
  ctx.lineWidth = LEADING_EDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  moveTo(ctx, leadingStart);
  lineTo(ctx, leadingWrist);
  lineTo(ctx, leadingHand);
  ctx.stroke();
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_ROOT: Point = { x: -0.28, y: 0 };
const TAIL_FEATHERS = 5;
const TAIL_LENGTH = 0.27;
const TAIL_FEATHER_WIDTH = 0.085;
/** The fan's half-angle: open, and closed tight over a cat. */
const TAIL_FAN_OPEN = 22 * DEGREE;
const TAIL_FAN_CLOSED = 7 * DEGREE;
/** The fan opens a little more as the wings come down, steering. */
const TAIL_FAN_BEAT = 6 * DEGREE;
const TAIL_BAND_FROM = 0.68;
const TAIL_BAND_TO = 0.82;

function tailFeathers(beat: WingbeatPose, carrying: boolean): readonly Feather[] {
  const halfFan = carrying ? TAIL_FAN_CLOSED : TAIL_FAN_OPEN + TAIL_FAN_BEAT * (1 - beat.raised);
  const feathers: Feather[] = [];
  for (let i = 0; i < TAIL_FEATHERS; i++) {
    const share = i / (TAIL_FEATHERS - 1);
    const angle = Math.PI + lerp(-halfFan, halfFan, share);
    const tip: Point = {
      x: TAIL_ROOT.x + Math.cos(angle) * TAIL_LENGTH,
      y: TAIL_ROOT.y + Math.sin(angle) * TAIL_LENGTH,
    };
    feathers.push({ base: TAIL_ROOT, tip, width: TAIL_FEATHER_WIDTH });
  }
  return feathers;
}

function traceTail(ctx: CanvasRenderingContext2D, feathers: readonly Feather[]): void {
  for (const feather of feathers) traceFeather(ctx, feather.base, feather.tip, feather.width);
}

/** Outermost feathers first, so the centre pair lies on top as a hawk's does. */
function paintTail(ctx: CanvasRenderingContext2D, feathers: readonly Feather[]): void {
  const middle = (feathers.length - 1) / 2;
  const order = feathers
    .map((feather, index) => ({ feather, nearness: Math.abs(index - middle) }))
    .sort((a, b) => b.nearness - a.nearness);
  for (const { feather } of order) {
    paintFeather(ctx, feather, TAIL.mid, TAIL.dark, SHAFT_ALPHA_SECONDARY);
  }
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceTail(ctx, feathers);
    },
    () => {
      const near = cell(TAIL_ROOT.x - TAIL_LENGTH * TAIL_BAND_FROM, 0);
      const far = cell(TAIL_ROOT.x - TAIL_LENGTH * TAIL_BAND_TO, 0);
      ctx.fillStyle = TAIL_BAND;
      ctx.fillRect(far.x, 0, near.x - far.x, FRAME_HEIGHT);
    },
  );
}

// ── Legs and the cat ─────────────────────────────────────────────────────────

const TUCKED_FOOT: Point = { x: -0.27, y: 0.055 };
const TUCKED_FOOT_RADIUS = 0.032;
const HIP: Point = { x: -0.18, y: 0.05 };
const CARRY_FOOT: Point = { x: -0.5, y: 0.06 };
const SHANK_WIDTH = 4.5;
/** The shank is a dark stroke with a lit one inside it, this many pixels narrower each side. */
const SHANK_RIM_PX = 1;
const TALON_LENGTH = 0.035;
const TALON_WIDTH = 1.6;
const TALON_SPLAY = [-0.6, 0, 0.6] as const;

function paintFoot(ctx: CanvasRenderingContext2D, at: Point, pointing: number): void {
  const foot = cell(at.x, at.y);
  ctx.save();
  ctx.strokeStyle = TALON;
  ctx.lineWidth = TALON_WIDTH;
  ctx.lineCap = 'round';
  for (const splay of TALON_SPLAY) {
    const angle = pointing + splay;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(
      foot.x + Math.cos(angle) * TALON_LENGTH * UNIT,
      foot.y + Math.sin(angle) * TALON_LENGTH * UNIT,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function paintTuckedFeet(ctx: CanvasRenderingContext2D): void {
  for (const side of [-1, 1] as const) {
    const at: Point = { x: TUCKED_FOOT.x, y: TUCKED_FOOT.y * side };
    const foot = cell(at.x, at.y);
    ctx.fillStyle = LEG_SCALE.mid;
    ctx.beginPath();
    ctx.arc(foot.x, foot.y, TUCKED_FOOT_RADIUS * UNIT, 0, FULL_TURN);
    ctx.fill();
    paintFoot(ctx, at, Math.PI);
  }
}

function paintCarryLegs(ctx: CanvasRenderingContext2D): void {
  for (const side of [-1, 1] as const) {
    const hip = cell(HIP.x, HIP.y * side);
    const foot = cell(CARRY_FOOT.x, CARRY_FOOT.y * side);
    ctx.save();
    ctx.strokeStyle = LEG_SCALE.dark;
    ctx.lineWidth = SHANK_WIDTH + SHANK_RIM_PX;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
    ctx.strokeStyle = LEG_SCALE.light;
    ctx.lineWidth = SHANK_WIDTH - SHANK_RIM_PX;
    ctx.stroke();
    ctx.restore();
    paintFoot(ctx, { x: CARRY_FOOT.x, y: CARRY_FOOT.y * side }, Math.PI + side * HALF);
  }
}

/** The cat hangs crosswise under the tail, head out to one side and her tail to the other. */
const CAT_CENTRE: Point = { x: -0.56, y: 0 };
const CAT_BODY_HALF_LENGTH = 0.17;
const CAT_BODY_HALF_WIDTH = 0.08;
const CAT_HEAD: Point = { x: -0.55, y: 0.2 };
const CAT_HEAD_RADIUS = 0.07;
const CAT_EAR_HEIGHT = 0.06;
const CAT_EAR_SPREAD = 0.045;
/** Ear tips sit wider than their bases, the ears pricked out to either side. */
const CAT_EAR_FLARE = 1.5;
const CAT_LEG_LENGTH = 0.07;
const CAT_LEG_WIDTH = 4;
/** Her legs hang down, so from above they trail back in the wind of the flight. */
const CAT_LEGS: readonly Point[] = [
  { x: -0.61, y: 0.1 },
  { x: -0.62, y: 0.04 },
  { x: -0.62, y: -0.06 },
  { x: -0.61, y: -0.12 },
];
const CAT_TAIL_ROOT: Point = { x: -0.57, y: -0.16 };
const CAT_TAIL_BEND: Point = { x: -0.68, y: -0.24 };
const CAT_TAIL_TIP: Point = { x: -0.75, y: -0.19 };
const CAT_TAIL_WIDTH = 5;
/** Her tail swings with each beat. */
const CAT_TAIL_SWING = 0.03;
/** The tip swings further than the bend, as a hanging tail whips. */
const CAT_TAIL_TIP_SWING = 2;

function traceCatBody(ctx: CanvasRenderingContext2D): void {
  const centre = cell(CAT_CENTRE.x, CAT_CENTRE.y);
  ctx.moveTo(centre.x + CAT_BODY_HALF_WIDTH * UNIT, centre.y);
  ctx.ellipse(
    centre.x,
    centre.y,
    CAT_BODY_HALF_WIDTH * UNIT,
    CAT_BODY_HALF_LENGTH * UNIT,
    0,
    0,
    FULL_TURN,
  );
  const head = cell(CAT_HEAD.x, CAT_HEAD.y);
  ctx.moveTo(head.x + CAT_HEAD_RADIUS * UNIT, head.y);
  ctx.arc(head.x, head.y, CAT_HEAD_RADIUS * UNIT, 0, FULL_TURN);
  for (const side of [-1, 1] as const) {
    const earBase = cell(CAT_HEAD.x + side * CAT_EAR_SPREAD, CAT_HEAD.y + CAT_HEAD_RADIUS * HALF);
    const earTip = cell(
      CAT_HEAD.x + side * CAT_EAR_SPREAD * CAT_EAR_FLARE,
      CAT_HEAD.y + CAT_HEAD_RADIUS + CAT_EAR_HEIGHT * HALF,
    );
    const earInner = cell(CAT_HEAD.x, CAT_HEAD.y + CAT_HEAD_RADIUS);
    ctx.moveTo(earBase.x, earBase.y);
    ctx.lineTo(earTip.x, earTip.y);
    ctx.lineTo(earInner.x, earInner.y);
    ctx.closePath();
  }
}

function catTailPoints(beat: WingbeatPose): readonly [Point, Point, Point] {
  const swing = (beat.raised - HALF) * CAT_TAIL_SWING;
  return [
    cell(CAT_TAIL_ROOT.x, CAT_TAIL_ROOT.y),
    cell(CAT_TAIL_BEND.x, CAT_TAIL_BEND.y + swing),
    cell(CAT_TAIL_TIP.x, CAT_TAIL_TIP.y + swing * CAT_TAIL_TIP_SWING),
  ];
}

function strokeCatLimbs(ctx: CanvasRenderingContext2D, beat: WingbeatPose, extra: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = CAT_LEG_WIDTH + extra;
  for (const leg of CAT_LEGS) {
    const root = cell(leg.x + CAT_LEG_LENGTH, leg.y);
    const paw = cell(leg.x, leg.y);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.lineTo(paw.x, paw.y);
    ctx.stroke();
  }
  const [root, bend, tip] = catTailPoints(beat);
  ctx.lineWidth = CAT_TAIL_WIDTH + extra;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(bend.x, bend.y, tip.x, tip.y);
  ctx.stroke();
  ctx.restore();
}

const CAT_ORANGE_PATCH: Point = { x: -0.57, y: 0.07 };
const CAT_BLACK_PATCH: Point = { x: -0.55, y: -0.09 };
const CAT_PATCH_RADIUS = 0.06;
const CAT_FACE_PATCH: Point = { x: -0.53, y: 0.22 };
const CAT_FACE_PATCH_RADIUS = 0.045;

function paintCat(ctx: CanvasRenderingContext2D, beat: WingbeatPose): void {
  ctx.strokeStyle = CALICO_WHITE.dark;
  strokeCatLimbs(ctx, beat, 0);
  const centre = cell(CAT_CENTRE.x, CAT_CENTRE.y);
  const fill = ctx.createLinearGradient(
    centre.x + CAT_BODY_HALF_WIDTH * UNIT,
    centre.y,
    centre.x - CAT_BODY_HALF_WIDTH * UNIT,
    centre.y,
  );
  fill.addColorStop(0, CALICO_WHITE.light);
  fill.addColorStop(1, CALICO_WHITE.dark);
  ctx.fillStyle = fill;
  ctx.beginPath();
  traceCatBody(ctx);
  ctx.fill();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceCatBody(ctx);
    },
    () => {
      const patch = (at: Point, radius: number, ink: string): void => {
        const middle = cell(at.x, at.y);
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(middle.x, middle.y, radius * UNIT, 0, FULL_TURN);
        ctx.fill();
      };
      patch(CAT_ORANGE_PATCH, CAT_PATCH_RADIUS, CALICO_ORANGE);
      patch(CAT_BLACK_PATCH, CAT_PATCH_RADIUS, CALICO_BLACK);
      patch(CAT_FACE_PATCH, CAT_FACE_PATCH_RADIUS, CALICO_ORANGE);
    },
  );
  const head = cell(CAT_HEAD.x, CAT_HEAD.y + CAT_HEAD_RADIUS * HALF);
  ctx.fillStyle = CAT_EAR_INNER;
  ctx.beginPath();
  ctx.arc(head.x, head.y, CAT_FACE_PATCH_RADIUS * HALF * UNIT, 0, FULL_TURN);
  ctx.fill();
}

// ── Cloak and hood ───────────────────────────────────────────────────────────

const CLOAK_SHOULDER_X = 0.13;
const CLOAK_SHOULDER_HALF = 0.165;
const CLOAK_WAIST: Point = { x: -0.1, y: 0.13 };
const CLOAK_HEM_X = -0.34;
/** The cloak's sides belly out past the waist as the air fills them. */
const CLOAK_BILLOW = 1.15;
const CLOAK_HEM_HALF = 0.17;
/** The hem's three points flutter out of step with one another as the wings beat. */
const HEM_POINTS = 4;
const HEM_FLUTTER = 0.04;
const HEM_NOTCH = 0.05;
const FOLD_WIDTH = 2.2;
const FOLD_ALPHA = 0.8;
const SPINE_LIGHT_ALPHA = 0.55;

function hemPoint(index: number, frame: number): Point {
  const share = index / (HEM_POINTS - 1);
  const phase = (frame / WINGBEAT_FRAMES + share * HALF) * FULL_TURN;
  return {
    x: CLOAK_HEM_X - HEM_FLUTTER * (1 + Math.sin(phase)),
    y: lerp(-CLOAK_HEM_HALF, CLOAK_HEM_HALF, share),
  };
}

function traceCloak(ctx: CanvasRenderingContext2D, frame: number): void {
  moveTo(ctx, cell(CLOAK_SHOULDER_X, -CLOAK_SHOULDER_HALF));
  curveTo(
    ctx,
    cell(CLOAK_WAIST.x, -CLOAK_WAIST.y * CLOAK_BILLOW),
    cell(CLOAK_HEM_X, -CLOAK_HEM_HALF),
  );
  for (let i = 0; i < HEM_POINTS; i++) {
    const point = hemPoint(i, frame);
    const next = hemPoint(i + 1, frame);
    lineTo(ctx, cell(point.x, point.y));
    if (i + 1 < HEM_POINTS) {
      lineTo(ctx, cell(CLOAK_HEM_X + HEM_NOTCH, lerp(point.y, next.y, HALF)));
    }
  }
  curveTo(
    ctx,
    cell(CLOAK_WAIST.x, CLOAK_WAIST.y * CLOAK_BILLOW),
    cell(CLOAK_SHOULDER_X, CLOAK_SHOULDER_HALF),
  );
  curveTo(
    ctx,
    cell(CLOAK_SHOULDER_X + CLOAK_SHOULDER_HALF, 0),
    cell(CLOAK_SHOULDER_X, -CLOAK_SHOULDER_HALF),
  );
  ctx.closePath();
}

function paintCloak(ctx: CanvasRenderingContext2D, frame: number): void {
  const left = cell(0, -CLOAK_SHOULDER_HALF);
  const right = cell(0, CLOAK_SHOULDER_HALF);
  const fill = ctx.createLinearGradient(left.x, left.y, right.x, right.y);
  fill.addColorStop(0, CLOAK.dark);
  fill.addColorStop(HALF, CLOAK.light);
  fill.addColorStop(1, CLOAK.dark);
  ctx.fillStyle = fill;
  ctx.beginPath();
  traceCloak(ctx, frame);
  ctx.fill();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceCloak(ctx, frame);
    },
    () => {
      for (let i = 0; i < HEM_POINTS - 1; i++) {
        const notch = lerp(-CLOAK_HEM_HALF, CLOAK_HEM_HALF, (i + HALF) / (HEM_POINTS - 1));
        const shoulder = cell(CLOAK_SHOULDER_X * HALF, notch * HALF);
        const hem = cell(CLOAK_HEM_X + HEM_NOTCH, notch);
        strokeSoftCrease(
          ctx,
          FOLD_WIDTH,
          CLOAK.dark,
          () => {
            ctx.moveTo(shoulder.x, shoulder.y);
            ctx.lineTo(hem.x, hem.y);
          },
          FOLD_ALPHA,
        );
      }
      const neck = cell(CLOAK_SHOULDER_X, 0);
      const hem = cell(CLOAK_HEM_X, 0);
      strokeSoftCrease(
        ctx,
        FOLD_WIDTH,
        CLOAK.light,
        () => {
          ctx.moveTo(neck.x, neck.y);
          ctx.lineTo(hem.x, hem.y);
        },
        SPINE_LIGHT_ALPHA,
      );
    },
  );
}

const HOOD_CENTRE: Point = { x: 0.16, y: 0 };
const HOOD_HALF_LENGTH = 0.115;
const HOOD_HALF_WIDTH = 0.11;
/** The hood's point lies back down the cloak between the shoulders. */
const HOOD_POINT_X = -0.02;
/** The hood's back drapes wider than its crown before narrowing to the point. */
const HOOD_DRAPE_FLARE = 1.2;
const HOOD_OPENING: Point = { x: 0.255, y: 0 };
const HOOD_OPENING_HALF_WIDTH = 0.06;
const HOOD_OPENING_DEPTH = 0.03;
const HOOD_LIGHT_OFFSET = 0.02;
const HOOD_LIGHT_ALPHA = 0.85;
/** How far in from each side of the hood its shading fades out. */
const HOOD_SIDE_FADE = 0.3;
const BEAK_ROOT_X = 0.245;
const BEAK_TIP_X = 0.34;
const BEAK_HALF_WIDTH = 0.032;
/** The hook bends down and so, from above, a little to one side of the beak's line. */
const BEAK_HOOK = 0.01;
const CERE_RADIUS = 0.016;

function traceHood(ctx: CanvasRenderingContext2D): void {
  const front = cell(HOOD_CENTRE.x + HOOD_HALF_LENGTH, 0);
  moveTo(ctx, cell(HOOD_POINT_X, 0));
  curveTo(
    ctx,
    cell(HOOD_CENTRE.x - HOOD_HALF_LENGTH, -HOOD_HALF_WIDTH * HOOD_DRAPE_FLARE),
    cell(HOOD_CENTRE.x, -HOOD_HALF_WIDTH),
  );
  curveTo(ctx, cell(HOOD_CENTRE.x + HOOD_HALF_LENGTH, -HOOD_HALF_WIDTH), front);
  curveTo(
    ctx,
    cell(HOOD_CENTRE.x + HOOD_HALF_LENGTH, HOOD_HALF_WIDTH),
    cell(HOOD_CENTRE.x, HOOD_HALF_WIDTH),
  );
  curveTo(
    ctx,
    cell(HOOD_CENTRE.x - HOOD_HALF_LENGTH, HOOD_HALF_WIDTH * HOOD_DRAPE_FLARE),
    cell(HOOD_POINT_X, 0),
  );
  ctx.closePath();
}

function traceBeak(ctx: CanvasRenderingContext2D): void {
  moveTo(ctx, cell(BEAK_ROOT_X, -BEAK_HALF_WIDTH));
  curveTo(ctx, cell(BEAK_TIP_X - BEAK_HALF_WIDTH, -BEAK_HALF_WIDTH), cell(BEAK_TIP_X, BEAK_HOOK));
  curveTo(
    ctx,
    cell(BEAK_TIP_X - BEAK_HALF_WIDTH, BEAK_HALF_WIDTH),
    cell(BEAK_ROOT_X, BEAK_HALF_WIDTH),
  );
  ctx.closePath();
}

function paintHead(ctx: CanvasRenderingContext2D): void {
  const beakRoot = cell(BEAK_ROOT_X, 0);
  const beakTip = cell(BEAK_TIP_X, 0);
  const beakFill = ctx.createLinearGradient(beakRoot.x, beakRoot.y, beakTip.x, beakTip.y);
  beakFill.addColorStop(0, BEAK.light);
  beakFill.addColorStop(1, BEAK.dark);
  ctx.fillStyle = beakFill;
  ctx.beginPath();
  traceBeak(ctx);
  ctx.fill();
  const cere = cell(BEAK_ROOT_X + CERE_RADIUS, 0);
  ctx.fillStyle = CERE;
  ctx.beginPath();
  ctx.arc(cere.x, cere.y, CERE_RADIUS * UNIT, 0, FULL_TURN);
  ctx.fill();

  ctx.fillStyle = CLOAK.mid;
  ctx.beginPath();
  traceHood(ctx);
  ctx.fill();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceHood(ctx);
    },
    () => {
      const crown = cell(HOOD_CENTRE.x - HOOD_LIGHT_OFFSET, 0);
      fillSoftEllipse(
        ctx,
        crown.x,
        crown.y,
        HOOD_HALF_LENGTH * UNIT,
        HOOD_HALF_WIDTH * UNIT * HALF,
        CLOAK.light,
        HOOD_LIGHT_ALPHA,
      );
      const rim = cell(HOOD_CENTRE.x, HOOD_HALF_WIDTH);
      const rimFar = cell(HOOD_CENTRE.x, -HOOD_HALF_WIDTH);
      const sides = ctx.createLinearGradient(rimFar.x, rimFar.y, rim.x, rim.y);
      sides.addColorStop(0, rgba(CLOAK.dark, 1));
      sides.addColorStop(HOOD_SIDE_FADE, rgba(CLOAK.dark, 0));
      sides.addColorStop(1 - HOOD_SIDE_FADE, rgba(CLOAK.dark, 0));
      sides.addColorStop(1, rgba(CLOAK.dark, 1));
      ctx.fillStyle = sides;
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      const opening = cell(HOOD_OPENING.x, HOOD_OPENING.y);
      ctx.fillStyle = HOOD_SHADOW;
      ctx.beginPath();
      ctx.ellipse(
        opening.x,
        opening.y,
        HOOD_OPENING_DEPTH * UNIT,
        HOOD_OPENING_HALF_WIDTH * UNIT,
        0,
        0,
        FULL_TURN,
      );
      ctx.fill();
    },
  );
}

// ── The whole figure ─────────────────────────────────────────────────────────

/** Past this much lift the wings rise above the shoulders of the cloak and are drawn over its edge. */
const WINGS_OVER_CLOAK_FROM = 0.55;

function traceSilhouette(
  ctx: CanvasRenderingContext2D,
  wings: readonly WingLayout[],
  tail: readonly Feather[],
  frame: number,
): void {
  for (const wing of wings) traceWing(ctx, wing);
  traceTail(ctx, tail);
  traceCloak(ctx, frame);
  traceHood(ctx);
  traceBeak(ctx);
}

function paintThief(ctx: CanvasRenderingContext2D, row: ThiefRow, frame: number): void {
  const beat = wingbeatPose(frame);
  const carrying = row === 'carry';
  const wings = [wingLayout(beat, -1), wingLayout(beat, 1)];
  const tail = tailFeathers(beat, carrying);
  const outline = OUTLINE_SHARE * UNIT;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = outline * STROKE_UNDER_WIDTH;
  ctx.beginPath();
  traceSilhouette(ctx, wings, tail, frame);
  ctx.stroke();
  if (carrying) {
    ctx.beginPath();
    traceCatBody(ctx);
    ctx.stroke();
    strokeCatLimbs(ctx, beat, outline * STROKE_UNDER_WIDTH);
  }
  ctx.restore();

  const wingsOverCloak = beat.raised >= WINGS_OVER_CLOAK_FROM;
  if (!wingsOverCloak) for (const wing of wings) paintWing(ctx, wing, beat);
  paintTail(ctx, tail);
  if (carrying) {
    paintCat(ctx, beat);
    paintCarryLegs(ctx);
  } else {
    paintTuckedFeet(ctx);
  }
  paintCloak(ctx, frame);
  if (wingsOverCloak) for (const wing of wings) paintWing(ctx, wing, beat);
  paintHead(ctx);
}

function isThiefRow(state: string): state is ThiefRow {
  return STATES.some((row) => row === state);
}

const WINGED_THIEF_FIGURE: FigureDef = {
  id: 'missing_cats_winged_thief',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: CENTRE_X,
  tileY: CENTRE_Y,
  tileScale: UNIT,
  states: figureStates({ fly: WINGBEAT_FRAMES, carry: WINGBEAT_FRAMES }),
  paintFrame: (ctx, state, frame) => {
    if (isThiefRow(state)) paintThief(ctx, state, frame);
  },
};

/** The figure itself, for the review harness. */
export function wingedThiefFigure(): FigureDef {
  return WINGED_THIEF_FIGURE;
}

/** How many tiles across the thief is drawn wherever it flies in the world: the `size` its painters take, in tiles. */
export const WINGED_THIEF_SIZE_TILES = 1.4;

/** Both rows, warmed as the thief comes on so its first beat is never a cold bake. */
export function prewarmWingedThief(): void {
  for (const row of STATES) prewarmFigureState(WINGED_THIEF_FIGURE, row);
}

/**
 * The thief centred on the origin, `size` pixels being the unit the figure is
 * measured in (its wings reach about one and a half of them tip to tip).
 * `heading` is in radians, 0 = east. `wingbeat` counts whole beats and may be
 * any real number; it loops. With `carrying` the cat hangs from its talons.
 */
export function drawWingedThief(
  ctx: CanvasRenderingContext2D,
  size: number,
  heading: number,
  wingbeat: number,
  carrying: boolean,
): void {
  const looped = wingbeat - Math.floor(wingbeat);
  const frame = Math.min(WINGBEAT_FRAMES - 1, Math.floor(looped * WINGBEAT_FRAMES));
  const row: ThiefRow = carrying ? 'carry' : 'fly';
  drawFigureCached(ctx, WINGED_THIEF_FIGURE, row, frame, 0, 0, size, { rotation: heading });
}

const SHADOW_ALPHA = 0.28;
const SHADOW_WIDTH_SHARE = 0.9;
const SHADOW_HEIGHT_SHARE = 0.2;
const SHADOW_INK = '#000000';

/**
 * The thief's shadow on the ground under it, `size` pixels being the
 * figure's unit: the one part of it that sits on the street, so a player can
 * tell where over the roofs it is.
 */
export function drawWingedThiefShadow(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.fillStyle = rgba(SHADOW_INK, SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    size * SHADOW_WIDTH_SHARE * HALF,
    size * SHADOW_HEIGHT_SHARE * HALF,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();
}
