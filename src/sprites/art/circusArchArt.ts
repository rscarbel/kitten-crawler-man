/**
 * The circus entry arch's crossbar and sign, and the marionette clown that
 * hangs from it.
 *
 * The arch's two posts are ordinary baked structures (`circusArt.ts`), but
 * the bar between them spans however far apart the road set them — four to
 * eight tiles, running across the screen or up it — so it cannot be one sheet
 * frame. `CircusGroundsAmbience` paints it once per site with these painters
 * into its own surface and blits it every frame; the marionette is painted
 * once and swung live.
 *
 * Painted on the circus vocabulary: the circus ramps, one silhouette outline
 * in warm ink, the upper-left sun, brush-painted capitals.
 */

import type { BrushPigment } from './brushStroke';
import { paintWord, wordWidth } from './circusLettering';
import { fillSoftEllipse } from './softShade';
import { inkOutline, outlineWidthPx, rgb, rgba } from './town/townArt';
import { TOWN_CONTACT_SHADOW, getCircusRamp, mix, shade, type Ramp } from './town/townPalette';
import type { Rng } from '../person/rng';

type Ctx = CanvasRenderingContext2D;

const BLOOD = getCircusRamp('circus_blood');
const BONE = getCircusRamp('circus_bone');
const BRUISE = getCircusRamp('circus_bruise');
const BRASS = getCircusRamp('circus_brass');
const NAVY = getCircusRamp('circus_navy');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const MILDEW = getCircusRamp('circus_mildew');
const BACKSTAGE = getCircusRamp('circus_backstage');
const STRAW = getCircusRamp('circus_straw');

const FULL_TURN = Math.PI * 2;

// ── The crossbar ──────────────────────────────────────────────────────────────

/** The beam's thickness, in tiles. */
export const ARCH_BEAM_THICKNESS_TILES = 0.2;
/** How far below the beam the sign board hangs on its chains, in tiles. */
const SIGN_DROP_TILES = 0.14;
/** The sign board's depth across the beam: its height when the beam runs across the screen. */
const SIGN_BOARD_DEPTH_TILES = 1.02;
/** How far in from each post the board stops, in tiles, so it hangs clear of both. */
const SIGN_POST_CLEARANCE_TILES = 0.55;
const SIGN_TRIM_TILES = 0.06;
const BEAM_STRIPE_PITCH_TILES = 0.42;
const BEAM_STRIPE_SLANT = 0.5;
const CHAIN_WIDTH_TILES = 0.035;
const BULB_SPACING_TILES = 0.24;
const BULB_RADIUS_TILES = 0.04;
/** Every so many bulbs is gone altogether, leaving its socket. */
const BROKEN_BULB_SHARE = 0.3;
const TITLE_HEIGHT_SHARE = 0.44;
const SUBTITLE_HEIGHT_SHARE = 0.2;
const LINE_GAP_SHARE = 0.08;
/** A crack runs through the board where a guy rope once pulled it askew. */
const CRACK_WIDTH_TILES = 0.03;
const MILDEW_BLOOM_ALPHA = 0.35;
const MILDEW_BLOOMS = 3;
const BEAM_SHADE_ALPHA = 0.4;
/** The beam's sunlit edge: a faint bone sheen fading to nothing by this share of its thickness. */
const BEAM_SHEEN_ALPHA = 0.2;
const BEAM_SHEEN_FADE_STOP = 0.45;
const SIGN_LETTER_SOAK_ALPHA = 0.3;
/** Mildew blooms land in the board's middle span, clear of the corners, sized as shares of the board. */
const MILDEW_SPAN_START_SHARE = 0.15;
const MILDEW_SPAN_SHARE = 0.7;
const MILDEW_BLOOM_WIDTH_SHARE = 0.12;
const MILDEW_BLOOM_HEIGHT_SHARE = 0.22;
/** A surviving bulb's grey glass inside its brass socket, as a share of the socket's radius. */
const BULB_GLASS_RADIUS_SHARE = 0.72;
const CRACK_ALPHA = 0.8;
/** The crack starts somewhere in this span of the board's width, off-centre toward the far post. */
const CRACK_START_SHARE = 0.6;
const CRACK_START_SPREAD_SHARE = 0.2;
const CRACK_SEGMENTS = 4;
/** How far each crack segment wanders sideways, as a share of the board's width. */
const CRACK_WANDER_SHARE = 0.06;
const BOARD_SHADOW_HEIGHT_TILES = 0.12;
const BOARD_SHADOW_ALPHA = 0.25;
/** The two chains hang this far in from each end of the board, as a share of its width. */
const CHAIN_INSET_SHARE = 0.12;

/** Pale greasepaint letters on a painted board. */
function signPigment(board: Ramp): BrushPigment {
  return {
    body: rgb(BONE.light),
    buildUp: rgb(BONE.accent),
    wetEdge: rgb(BONE.mid),
    bareSurface: rgb(board.mid),
    soak: rgba(BONE.light, SIGN_LETTER_SOAK_ALPHA),
  };
}

/** Where a crossbar surface's beam runs, in its own pixels: a straight line from one post cap to the other. */
export interface CrossbarLayout {
  /** Surface size, in pixels. */
  readonly width: number;
  readonly height: number;
  /** Each post cap's centre on the surface, first post first. */
  readonly capA: { readonly x: number; readonly y: number };
  readonly capB: { readonly x: number; readonly y: number };
  /** Where the marionette's control bar hangs from the beam, on the surface. */
  readonly hang: { readonly x: number; readonly y: number };
}

/** Margin kept round the painted bar on its surface, in tiles, so the outline and the board's shadow fit. */
const SURFACE_MARGIN_TILES = 0.6;

/**
 * The surface and cap positions for a bar spanning `spanTiles` between post
 * caps, across the screen (`across`) or up it.
 */
export function crossbarLayout(
  spanTiles: number,
  across: boolean,
  tileScale: number,
): CrossbarLayout {
  const margin = SURFACE_MARGIN_TILES * tileScale;
  const span = spanTiles * tileScale;
  const hangDepth = (SIGN_DROP_TILES + SIGN_BOARD_DEPTH_TILES) * tileScale;
  if (across) {
    const width = Math.ceil(span + margin * 2);
    const height = Math.ceil(margin * 2 + hangDepth);
    const capY = margin;
    return {
      width,
      height,
      capA: { x: margin, y: capY },
      capB: { x: margin + span, y: capY },
      hang: { x: margin + span / 2, y: capY + hangDepth },
    };
  }
  const width = Math.ceil(margin * 2 + SIGN_BOARD_DEPTH_TILES * tileScale);
  const height = Math.ceil(span + margin * 2);
  const capX = width / 2;
  return {
    width,
    height,
    capA: { x: capX, y: margin },
    capB: { x: capX, y: margin + span },
    hang: { x: capX, y: margin + span * UP_SCREEN_HANG_SHARE },
  };
}

function paintBeam(
  ctx: Ctx,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ts: number,
): void {
  const thickness = ARCH_BEAM_THICKNESS_TILES * ts;
  const across = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const x = Math.min(from.x, to.x) - (across ? 0 : thickness / 2);
  const y = Math.min(from.y, to.y) - (across ? thickness / 2 : 0);
  const w = across ? Math.abs(to.x - from.x) : thickness;
  const h = across ? thickness : Math.abs(to.y - from.y);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(BONE.mid);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgb(BLOOD.mid);
  const pitch = BEAM_STRIPE_PITCH_TILES * ts;
  const length = across ? w : h;
  for (let along = -pitch; along < length + pitch; along += pitch) {
    ctx.beginPath();
    if (across) {
      ctx.moveTo(x + along, y + h);
      ctx.lineTo(x + along + pitch / 2, y + h);
      ctx.lineTo(x + along + pitch / 2 + h * BEAM_STRIPE_SLANT, y);
      ctx.lineTo(x + along + h * BEAM_STRIPE_SLANT, y);
    } else {
      ctx.moveTo(x, y + along);
      ctx.lineTo(x, y + along + pitch / 2);
      ctx.lineTo(x + w, y + along + pitch / 2 - w * BEAM_STRIPE_SLANT);
      ctx.lineTo(x + w, y + along - w * BEAM_STRIPE_SLANT);
    }
    ctx.closePath();
    ctx.fill();
  }
  // Round timber: lit on the sun's side, falling into shade on the other.
  const round = across
    ? ctx.createLinearGradient(0, y, 0, y + h)
    : ctx.createLinearGradient(x, 0, x + w, 0);
  round.addColorStop(0, rgba(BONE.accent, BEAM_SHEEN_ALPHA));
  round.addColorStop(BEAM_SHEEN_FADE_STOP, rgba(TOWN_CONTACT_SHADOW, 0));
  round.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, BEAM_SHADE_ALPHA));
  ctx.fillStyle = round;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

interface Board {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function paintBoard(ctx: Ctx, board: Board, ts: number, rng: Rng): void {
  const face = BRUISE;
  ctx.beginPath();
  ctx.rect(board.x, board.y, board.w, board.h);
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.fillRect(board.x, board.y, board.w, board.h);
  const trim = SIGN_TRIM_TILES * ts;
  const faceGradient = ctx.createLinearGradient(0, board.y, 0, board.y + board.h);
  faceGradient.addColorStop(0, rgb(face.light));
  faceGradient.addColorStop(1, rgb(face.mid));
  ctx.fillStyle = faceGradient;
  ctx.fillRect(board.x + trim, board.y + trim, board.w - trim * 2, board.h - trim * 2);
  // Mildew creeping in from the bottom edge, where rain sits on the trim.
  for (let bloom = 0; bloom < MILDEW_BLOOMS; bloom++) {
    const cx = board.x + board.w * (MILDEW_SPAN_START_SHARE + MILDEW_SPAN_SHARE * rng());
    fillSoftEllipse(
      ctx,
      cx,
      board.y + board.h - trim,
      board.w * MILDEW_BLOOM_WIDTH_SHARE,
      board.h * MILDEW_BLOOM_HEIGHT_SHARE,
      rgb(MILDEW.mid),
      MILDEW_BLOOM_ALPHA,
    );
  }
  // Dead bulbs round the edge: grey glass, sockets where a bulb has gone.
  const perimeter = 2 * (board.w + board.h);
  const count = Math.floor(perimeter / (BULB_SPACING_TILES * ts));
  const radius = BULB_RADIUS_TILES * ts;
  for (let bulb = 0; bulb < count; bulb++) {
    let along = (bulb / count) * perimeter;
    let x: number;
    let y: number;
    if (along < board.w) {
      x = board.x + along;
      y = board.y + trim / 2;
    } else if ((along -= board.w) < board.h) {
      x = board.x + board.w - trim / 2;
      y = board.y + along;
    } else if ((along -= board.h) < board.w) {
      x = board.x + board.w - along;
      y = board.y + board.h - trim / 2;
    } else {
      along -= board.w;
      x = board.x + trim / 2;
      y = board.y + board.h - along;
    }
    ctx.fillStyle = rgb(BRASS.shadow);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.fill();
    if (rng() < BROKEN_BULB_SHARE) continue;
    ctx.fillStyle = rgb(mix(BACKSTAGE.light, STRAW.shadow, 0.5));
    ctx.beginPath();
    ctx.arc(x, y, radius * BULB_GLASS_RADIUS_SHARE, 0, FULL_TURN);
    ctx.fill();
  }
}

function paintCrack(ctx: Ctx, board: Board, ts: number, rng: Rng): void {
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, CRACK_ALPHA);
  ctx.lineWidth = CRACK_WIDTH_TILES * ts;
  ctx.beginPath();
  const startX = board.x + board.w * (CRACK_START_SHARE + CRACK_START_SPREAD_SHARE * rng());
  ctx.moveTo(startX, board.y);
  for (let step = 1; step <= CRACK_SEGMENTS; step++) {
    const wander = (rng() - 0.5) * board.w * CRACK_WANDER_SHARE;
    ctx.lineTo(startX + wander, board.y + (board.h * step) / CRACK_SEGMENTS);
  }
  ctx.stroke();
}

/** The title every arch carries, and the second line when the board is long enough. */
const ARCH_TITLE = "GRIMALDI'S";
const ARCH_SUBTITLE = 'TRAVELLING CIRCUS';
/** Up the screen the board is narrow, so the letters are stacked; a short one says only this. */
const ARCH_STACKED_SHORT = 'CIRCUS';

/**
 * Paints the whole crossbar — beam, chains and sign board with its lettering
 * — onto a surface laid out by `crossbarLayout`.
 */
export function paintArchCrossbar(
  ctx: Ctx,
  layout: CrossbarLayout,
  across: boolean,
  tileScale: number,
  rng: Rng,
): void {
  const ts = tileScale;
  const { capA, capB } = layout;
  const clearance = SIGN_POST_CLEARANCE_TILES * ts;
  const drop = SIGN_DROP_TILES * ts;
  const depth = SIGN_BOARD_DEPTH_TILES * ts;
  const board: Board = across
    ? { x: capA.x + clearance, y: capA.y + drop, w: capB.x - capA.x - clearance * 2, h: depth }
    : {
        x: capA.x - depth / 2,
        y: capA.y + clearance,
        w: depth,
        h: (capB.y - capA.y) * UP_SCREEN_BOARD_SHARE - clearance,
      };

  // The board's shadow on the air behind it is not a thing; its soft shadow
  // under the beam is, and it keeps the board from reading pasted on.
  fillSoftEllipse(
    ctx,
    board.x + board.w / 2,
    board.y + board.h,
    board.w * 0.5,
    ts * BOARD_SHADOW_HEIGHT_TILES,
    rgb(TOWN_CONTACT_SHADOW),
    BOARD_SHADOW_ALPHA,
  );

  ctx.strokeStyle = rgb(IRON_CHAIN);
  ctx.lineWidth = CHAIN_WIDTH_TILES * ts;
  const nearChainX = board.x + board.w * CHAIN_INSET_SHARE;
  const farChainX = board.x + board.w * (1 - CHAIN_INSET_SHARE);
  const hooks = across
    ? [
        { from: { x: nearChainX, y: capA.y }, to: { x: nearChainX, y: board.y } },
        { from: { x: farChainX, y: capA.y }, to: { x: farChainX, y: board.y } },
      ]
    : [];
  for (const hook of hooks) {
    ctx.beginPath();
    ctx.moveTo(hook.from.x, hook.from.y);
    ctx.lineTo(hook.to.x, hook.to.y);
    ctx.stroke();
  }

  // The beam first: running up the screen, the board hangs over it and would
  // otherwise have its letters struck through.
  paintBeam(ctx, capA, capB, ts);
  paintBoard(ctx, board, ts, rng);
  paintCrack(ctx, board, ts, rng);
  const pigment = signPigment(BRUISE);
  const trim = SIGN_TRIM_TILES * ts * 2;
  if (across) {
    const inner = board.h - trim * 2;
    const titleHeight = inner * TITLE_HEIGHT_SHARE;
    const subtitleHeight = inner * SUBTITLE_HEIGHT_SHARE;
    const available = board.w - trim * 2;
    const titleSize = Math.min(
      titleHeight,
      (titleHeight * available) / wordWidth(ARCH_TITLE, titleHeight),
    );
    const subtitleSize = Math.min(
      subtitleHeight,
      (subtitleHeight * available) / wordWidth(ARCH_SUBTITLE, subtitleHeight),
    );
    const gap = inner * LINE_GAP_SHARE;
    const top = board.y + trim + (inner - titleSize - subtitleSize - gap) / 2;
    const centreX = board.x + board.w / 2;
    paintWord(ctx, ARCH_TITLE, centreX, top, titleSize, pigment, rng);
    paintWord(ctx, ARCH_SUBTITLE, centreX, top + titleSize + gap, subtitleSize, pigment, rng);
  } else {
    const inner = board.h - trim * 2;
    const letterStep = board.w * STACKED_LETTER_STEP_SHARE;
    const word =
      Array.from(ARCH_TITLE).length * letterStep <= inner ? ARCH_TITLE : ARCH_STACKED_SHORT;
    const letters = Array.from(word).filter((letter) => letter !== "'");
    const step = Math.min(letterStep, inner / letters.length);
    const size = step * STACKED_LETTER_SIZE_SHARE;
    let top = board.y + trim + (inner - step * letters.length) / 2;
    for (const letter of letters) {
      paintWord(ctx, letter, board.x + board.w / 2, top, size, pigment, rng);
      top += step;
    }
  }
}

const IRON_CHAIN = shade(NAVY.shadow, 0.9);
/**
 * Up the screen the board takes the north half of the span and the
 * marionette hangs over the south half, so the two do not paint over each
 * other where they cross the road.
 */
const UP_SCREEN_BOARD_SHARE = 0.5;
const UP_SCREEN_HANG_SHARE = 0.56;
/** Up the screen each stacked letter takes this share of the board's width, and is this share of its step tall. */
const STACKED_LETTER_STEP_SHARE = 0.62;
const STACKED_LETTER_SIZE_SHARE = 0.8;

// ── The marionette ────────────────────────────────────────────────────────────

/** Where the marionette's parts sit, in tiles below its control bar's pivot and across from it. */
export const MARIONETTE = {
  /** Surface size, in tiles. */
  widthTiles: 0.9,
  heightTiles: 1.45,
  /** Length of the strings from the control bar to the head. */
  stringTiles: 0.3,
  controlHalfWidthTiles: 0.26,
  headRadiusTiles: 0.12,
  bodyTiles: 0.36,
  armTiles: 0.3,
  legTiles: 0.36,
  shoeTiles: 0.12,
} as const;

/** The pivot — the control bar's middle — on the marionette's surface, in tiles. */
export const MARIONETTE_PIVOT = { x: MARIONETTE.widthTiles / 2, y: 0.08 } as const;

/**
 * The marionette's limp pose, in tiles off its joints: the head lolled one way,
 * the hips the other, the held-up left arm bent short and the slack right one
 * hanging full length, knees and toes turned out.
 */
const MARIONETTE_POSE = {
  headLeanTiles: 0.03,
  hipSwayTiles: 0.01,
  shoulderHalfWidthTiles: 0.12,
  shoulderDropTiles: 0.06,
  leftHandOutTiles: 0.1,
  /** The held-up left arm reaches only this share of its length below the shoulder. */
  leftArmReachShare: 0.55,
  rightHandOutTiles: 0.02,
  leftKneeOutTiles: 0.08,
  rightKneeOutTiles: 0.07,
  kneeShare: 0.5,
  footSplayTiles: 0.1,
} as const;

/** The marionette's rig and costume, in tiles. */
const MARIONETTE_DRESS = {
  stringWidthTiles: 0.012,
  stringAlpha: 0.7,
  controlBarWidthTiles: 0.05,
  /** The slack right-hand string bows out past the bar's end and sags toward the hand. */
  slackStringBowTiles: 0.4,
  slackStringSagTiles: 0.2,
  limbWidthTiles: 0.07,
  /** Near-black, a shade warmer and lighter than the silhouette ink, so the limbs stay one opaque stroke. */
  limbInk: [22, 16, 16],
  gloveRadiusTiles: 0.045,
  toeOutTiles: 0.04,
  shoeHalfHeightTiles: 0.045,
  hemHalfWidthTiles: 0.12,
  diamondTiles: 0.09,
  diamondRows: 5,
  /** Diamond columns either side of the neck. */
  diamondHalfColumns: 2,
  tunicShadeAlpha: 0.3,
  tunicShadeWidthTiles: 0.2,
  /** Ruff petals either side of the centre one. */
  ruffHalfPetals: 2,
  ruffPetalTiles: 0.045,
  ruffDropTiles: 0.01,
} as const;

/** The marionette's face, in shares of its head's radius. */
const MARIONETTE_FACE = {
  shadeAlpha: 0.22,
  shadeOffsetX: 0.35,
  shadeOffsetY: 0.2,
  shadeRadius: 0.85,
  hairOut: 1.05,
  hairRaise: 0.2,
  hairRadius: 0.45,
  eyeLineTiles: 0.018,
  eyeSize: 0.28,
  eyeSpread: 0.4,
  eyeRaise: 0.15,
  noseDrop: 0.15,
  noseRadius: 0.24,
  grinDrop: 0.2,
  grinRadius: 0.55,
  /** The grin's arc, in half-turns, from its right corner round the bottom to its left. */
  grinStartTurns: 0.15,
  grinEndTurns: 0.85,
  hatBrimLeftOut: 0.6,
  hatBrimLeftRaise: 0.75,
  hatBrimRightOut: 0.7,
  hatBrimRightRaise: 0.6,
  hatTipOut: 0.45,
  hatTipRaise: 2.1,
} as const;

function limb(
  ctx: Ctx,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * Paints the marionette hanging still from its control bar, onto a surface
 * `MARIONETTE.widthTiles` by `MARIONETTE.heightTiles` tiles. The ambience
 * rotates the whole surface about `MARIONETTE_PIVOT` to swing it.
 *
 * A clown, because it is Grimaldi's: greasepaint face, a red nose, a ruff,
 * a diamond-patched tunic and shoes too big for it — limp, head lolled, one
 * arm's string gone slack.
 */
export function paintMarionette(ctx: Ctx, tileScale: number): void {
  const ts = tileScale;
  const m = MARIONETTE;
  const pose = MARIONETTE_POSE;
  const dress = MARIONETTE_DRESS;
  const face = MARIONETTE_FACE;
  const pivotX = MARIONETTE_PIVOT.x * ts;
  const pivotY = MARIONETTE_PIVOT.y * ts;
  const headY = pivotY + m.stringTiles * ts;
  const head = { x: pivotX + pose.headLeanTiles * ts, y: headY };
  const neck = { x: pivotX, y: headY + m.headRadiusTiles * ts };
  const hip = { x: pivotX - pose.hipSwayTiles * ts, y: neck.y + m.bodyTiles * ts };
  const shoulderHalfWidth = pose.shoulderHalfWidthTiles * ts;
  const shoulderY = neck.y + pose.shoulderDropTiles * ts;
  const shoulderL = { x: neck.x - shoulderHalfWidth, y: shoulderY };
  const shoulderR = { x: neck.x + shoulderHalfWidth, y: shoulderY };
  const handL = {
    x: shoulderL.x - pose.leftHandOutTiles * ts,
    y: shoulderL.y + m.armTiles * ts * pose.leftArmReachShare,
  };
  const handR = { x: shoulderR.x + pose.rightHandOutTiles * ts, y: shoulderR.y + m.armTiles * ts };
  const kneeY = hip.y + m.legTiles * ts * pose.kneeShare;
  const kneeL = { x: hip.x - pose.leftKneeOutTiles * ts, y: kneeY };
  const kneeR = { x: hip.x + pose.rightKneeOutTiles * ts, y: kneeY };
  const footSplay = pose.footSplayTiles * ts;
  const footY = hip.y + m.legTiles * ts;
  const footL = { x: hip.x - footSplay, y: footY };
  const footR = { x: hip.x + footSplay, y: footY };
  const lineWidth = Math.max(1, dress.stringWidthTiles * ts);

  // The control bar and its strings: head, the left hand held up, and the
  // right hand's string gone slack.
  ctx.strokeStyle = rgb(ROT_TIMBER.mid);
  ctx.lineWidth = dress.controlBarWidthTiles * ts;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pivotX - m.controlHalfWidthTiles * ts, pivotY);
  ctx.lineTo(pivotX + m.controlHalfWidthTiles * ts, pivotY);
  ctx.stroke();
  ctx.strokeStyle = rgba(BONE.light, dress.stringAlpha);
  ctx.lineWidth = lineWidth;
  const strings: ReadonlyArray<{ from: number; to: { x: number; y: number } }> = [
    { from: 0, to: { x: head.x, y: head.y - m.headRadiusTiles * ts } },
    { from: -m.controlHalfWidthTiles, to: handL },
  ];
  for (const string of strings) {
    ctx.beginPath();
    ctx.moveTo(pivotX + string.from * ts, pivotY);
    ctx.lineTo(string.to.x, string.to.y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(pivotX + m.controlHalfWidthTiles * ts, pivotY);
  ctx.quadraticCurveTo(
    pivotX + dress.slackStringBowTiles * ts,
    handR.y - dress.slackStringSagTiles * ts,
    handR.x,
    handR.y,
  );
  ctx.stroke();

  const limbWidth = dress.limbWidthTiles * ts;
  const ink = rgb(dress.limbInk);
  const outlinedLimbWidth = limbWidth + 2 * outlineWidthPx(ts);
  const outlineLimb = (from: { x: number; y: number }, to: { x: number; y: number }): void =>
    limb(ctx, from, to, outlinedLimbWidth, ink);
  for (const [from, to] of [
    [shoulderL, handL],
    [shoulderR, handR],
    [hip, kneeL],
    [kneeL, footL],
    [hip, kneeR],
    [kneeR, footR],
  ] as const) {
    outlineLimb(from, to);
  }
  limb(ctx, shoulderL, handL, limbWidth, rgb(BLOOD.mid));
  limb(ctx, shoulderR, handR, limbWidth, rgb(BONE.mid));
  limb(ctx, hip, kneeL, limbWidth, rgb(BONE.mid));
  limb(ctx, kneeL, footL, limbWidth, rgb(BONE.mid));
  limb(ctx, hip, kneeR, limbWidth, rgb(BLOOD.mid));
  limb(ctx, kneeR, footR, limbWidth, rgb(BLOOD.mid));
  for (const hand of [handL, handR]) {
    ctx.fillStyle = rgb(BONE.accent);
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, dress.gloveRadiusTiles * ts, 0, FULL_TURN);
    ctx.fill();
  }
  // Shoes far too big for it, toes turned out.
  for (const [foot, side] of [
    [footL, -1],
    [footR, 1],
  ] as const) {
    ctx.beginPath();
    const toeX = foot.x + side * dress.toeOutTiles * ts;
    const shoeHalfHeight = dress.shoeHalfHeightTiles * ts;
    ctx.ellipse(toeX, foot.y, m.shoeTiles * ts, shoeHalfHeight, 0, 0, FULL_TURN);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BLOOD.shadow);
    ctx.fill();
  }

  // The tunic: a diamond-patched smock from neck to hip.
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  const hemHalfWidth = dress.hemHalfWidthTiles * ts;
  ctx.lineTo(hip.x + hemHalfWidth, hip.y);
  ctx.lineTo(hip.x - hemHalfWidth, hip.y);
  ctx.closePath();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(BONE.mid);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgb(BLOOD.mid);
  const diamond = dress.diamondTiles * ts;
  for (let row = 0; row < dress.diamondRows; row++) {
    for (let col = -dress.diamondHalfColumns; col <= dress.diamondHalfColumns; col++) {
      if ((row + col) % 2 !== 0) continue;
      const cx = neck.x + col * diamond;
      const cy = neck.y + row * diamond;
      ctx.beginPath();
      ctx.moveTo(cx, cy - diamond / 2);
      ctx.lineTo(cx + diamond / 2, cy);
      ctx.lineTo(cx, cy + diamond / 2);
      ctx.lineTo(cx - diamond / 2, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, dress.tunicShadeAlpha);
  ctx.fillRect(neck.x, neck.y, dress.tunicShadeWidthTiles * ts, hip.y - neck.y);
  ctx.restore();

  ctx.fillStyle = rgb(BONE.light);
  const petalRadius = dress.ruffPetalTiles * ts;
  const ruffY = neck.y + dress.ruffDropTiles * ts;
  for (let petal = -dress.ruffHalfPetals; petal <= dress.ruffHalfPetals; petal++) {
    ctx.beginPath();
    ctx.arc(neck.x + petal * dress.ruffPetalTiles * ts, ruffY, petalRadius, 0, FULL_TURN);
    ctx.fill();
  }

  // The head: greasepaint white, lolled to one side, crosses for eyes.
  const headRadius = m.headRadiusTiles * ts;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headRadius, 0, FULL_TURN);
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(BONE.accent);
  ctx.fill();
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, face.shadeAlpha);
  ctx.beginPath();
  ctx.arc(
    head.x + headRadius * face.shadeOffsetX,
    head.y + headRadius * face.shadeOffsetY,
    headRadius * face.shadeRadius,
    0,
    FULL_TURN,
  );
  ctx.fill();
  // Tufts of faded orange hair either side.
  ctx.fillStyle = rgb(mix(BLOOD.light, BRASS.light, 0.5));
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      head.x + side * headRadius * face.hairOut,
      head.y - headRadius * face.hairRaise,
      headRadius * face.hairRadius,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.strokeStyle = rgb(BACKSTAGE.shadow);
  ctx.lineWidth = Math.max(1, face.eyeLineTiles * ts);
  const eye = headRadius * face.eyeSize;
  for (const side of [-1, 1]) {
    const ex = head.x + side * headRadius * face.eyeSpread;
    const ey = head.y - headRadius * face.eyeRaise;
    ctx.beginPath();
    ctx.moveTo(ex - eye / 2, ey - eye / 2);
    ctx.lineTo(ex + eye / 2, ey + eye / 2);
    ctx.moveTo(ex + eye / 2, ey - eye / 2);
    ctx.lineTo(ex - eye / 2, ey + eye / 2);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(BLOOD.light);
  ctx.beginPath();
  ctx.arc(head.x, head.y + headRadius * face.noseDrop, headRadius * face.noseRadius, 0, FULL_TURN);
  ctx.fill();
  // A painted grin, too wide.
  ctx.strokeStyle = rgb(BLOOD.mid);
  ctx.beginPath();
  ctx.arc(
    head.x,
    head.y + headRadius * face.grinDrop,
    headRadius * face.grinRadius,
    Math.PI * face.grinStartTurns,
    Math.PI * face.grinEndTurns,
  );
  ctx.stroke();
  // A little cone hat, knocked askew.
  ctx.beginPath();
  ctx.moveTo(
    head.x - headRadius * face.hatBrimLeftOut,
    head.y - headRadius * face.hatBrimLeftRaise,
  );
  ctx.lineTo(
    head.x + headRadius * face.hatBrimRightOut,
    head.y - headRadius * face.hatBrimRightRaise,
  );
  ctx.lineTo(head.x + headRadius * face.hatTipOut, head.y - headRadius * face.hatTipRaise);
  ctx.closePath();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(NAVY.light);
  ctx.fill();
}
