/** Carl's heart-print boxer shorts, cuffed round each thigh. */

import { angleBetween, HALF_PI, mixPt, offset, pt, TWO_PI } from './geometry';
import { addCapsule, crease, fillCapsule, printHash, shadeClipped, shadeForm } from './paint';
import { COTTON, HEART_RED, HEART_RED_DARK, LIGHT, receded, SKIN } from './palette';
import { THIGH_LENGTH, THIGH_WIDTH } from './proportions';
import { type BoneChain, type ViewSpec } from './rig';
import { lerp, mix, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse, withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

const SHORTS_TOP_RISE = 0.055;
const SHORTS_HEM_DROP = 0.29;
const SHORTS_HIP_FLARE = 1.22;
/**
 * The hem still has to cover the tops of the thighs (`LEG_ROOT_HALF +
 * THIGH_WIDTH`), so it cannot go much below 1.4. Wider than this and the boxers
 * reach nearly as far as his shoulders, which leaves a hanging arm no room to
 * clear his hip.
 */
const SHORTS_HEM_FLARE = 1.42;
/** A kicking jacket hem means a big move, and the loose legs swing out with it. */
const SHORTS_FLARE_KICK = 1.15;
const WAISTBAND_HEIGHT = 0.042;
const WAISTBAND_RUCK_OPACITY = 0.45;
/** How far below the waistband's top edge the jacket's shade reaches. */
const JACKET_OCCLUSION_DEPTH = 0.055;
const JACKET_OCCLUSION_ALPHA = 0.75;

/** The hem never rides further than this down a thigh, however short the leg. */
const SHORTS_MAX_THIGH_SHARE = 0.62;
/** Cloth stands off the leg it covers by this much. */
const CUFF_SLACK = 1.15;
/**
 * Edge-on the cuff wraps the thigh's depth where the hem crosses it, which is
 * less than the thigh's full `PROFILE_THIGH_DEPTH` swell lower down; wrapped
 * round the full swell the cuffs flare into a skirt.
 */
const PROFILE_CUFF_DEPTH = 1.15;
/**
 * How far inboard of its own root a cuff may reach. Held short of the
 * centreline so the two openings leave the V that reads as boxers rather than
 * meeting into a skirt — and, edge-on where the roots nearly coincide, so the
 * two do not cross each other.
 */
const CUFF_INNER_REACH = 0.95;
/** Where down the leg the side seam bows out, as a share of the hem drop. */
const SIDE_SEAM_AT = 0.6;
const CROTCH_RISE = 0.42;
/**
 * Loose cotton hangs lowest halfway across each leg opening, so a hem cut as a
 * straight chord reads as cardboard. The sag is a share of the opening's width.
 */
const HEM_SAG = 0.14;
/**
 * Each leg hangs in one broad fold from the seat to the hem, a little inboard
 * of the middle of the opening, where the cloth has slack between the thigh's
 * front and the crotch seam.
 */
const DRAPE_FOLD_ACROSS = 0.42;
/** How far up the hem the fold pulls it, against the opening's width. */
const HEM_FOLD_TUCK = 0.04;
/** Each half of a scalloped hem sags this much of its own width. */
const SCALLOP_SAG = 0.16;
/** Edge-on each half keeps the plain hem's sag, so the whole hem hangs as one curve. */
const PROFILE_SCALLOP_SAG = HEM_SAG;

/** A leg opening: where the cuff meets the thigh, and which way is outboard. */
interface LegOpening {
  readonly outer: Pt;
  readonly inner: Pt;
  readonly seam: Pt;
  /** Unit vector across the thigh toward the outer side of this leg. */
  readonly outward: Pt;
  /** Unit vector down the thigh. */
  readonly down: Pt;
  /**
   * Where the leg's one drape fold meets the hem: the cloth tucks up into the
   * fold, so the hem scallops either side of it instead of running straight.
   */
  readonly foldFoot: Pt;
  /** How far the free edge trails the thigh, which bends the fold with it. */
  readonly flutter: Pt;
  /** How far each half of the hem sags, as a share of its own width. */
  readonly scallop: number;
}

/**
 * A leg opening: a band lying across the thigh, square to it, at a fixed
 * distance down the leg.
 *
 * Rotating a fixed hem about the hip does not work — the turn has to be damped
 * and capped to keep the crotch from sweeping across the body, and a capped hem
 * simply stops covering a thigh raised past the cap. Following the thigh's own
 * direction covers it at any angle by construction.
 */
function legOpening(
  leg: BoneChain,
  outwardSign: number,
  outerHalf: number,
  innerHalf: number,
  flutter: Pt,
  profile: boolean,
): LegOpening {
  const span = Math.hypot(leg.joint.x - leg.root.x, leg.joint.y - leg.root.y);
  const dirX = span === 0 ? 0 : (leg.joint.x - leg.root.x) / span;
  const dirY = span === 0 ? 1 : (leg.joint.y - leg.root.y) / span;
  const along = Math.min(SHORTS_HEM_DROP, span * SHORTS_MAX_THIGH_SHARE);
  const centre = offset(leg.root, dirX * along, dirY * along);
  // Square to the thigh, so the opening reads as a cuff rather than as a
  // horizontal cut across a diagonal leg.
  const acrossX = dirY * outwardSign;
  const acrossY = -dirX * outwardSign;
  // The waistband is sewn to the body and the hem hangs free, so a lagging cuff
  // swings its outer corner the full distance, its crotch corner (stitched to
  // the other leg) half as far, and the side seam by how far down it sits.
  const swing = (p: Pt, share: number): Pt => offset(p, flutter.x * share, flutter.y * share);
  const outer = swing(offset(centre, acrossX * outerHalf, acrossY * outerHalf), 1);
  const inner = swing(
    offset(centre, -acrossX * innerHalf, -acrossY * innerHalf),
    CROTCH_CORNER_SWING,
  );
  const hemWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  // Edge-on the two openings lie one over the other, and two scalloped hems
  // crossing each other draw a zigzag that reads as torn cloth.
  const tuck = profile ? 0 : hemWidth * HEM_FOLD_TUCK;
  const foldFoot = offset(mixPt(inner, outer, DRAPE_FOLD_ACROSS), -dirX * tuck, -dirY * tuck);
  return {
    outer,
    inner,
    foldFoot,
    flutter,
    scallop: profile ? PROFILE_SCALLOP_SAG : SCALLOP_SAG,
    seam: swing(
      offset(
        offset(leg.root, dirX * along * SIDE_SEAM_AT, dirY * along * SIDE_SEAM_AT),
        acrossX * outerHalf,
        acrossY * outerHalf,
      ),
      SIDE_SEAM_AT,
    ),
    outward: pt(acrossX, acrossY),
    down: pt(dirX, dirY),
  };
}

/** The lowest point of a sagging hem between two cuff corners. */
function hemSag(a: Pt, b: Pt, down: Pt, sag = HEM_SAG): Pt {
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  return offset(mixPt(a, b, HALF), down.x * width * sag, down.y * width * sag);
}

const HALF = 0.5;

/**
 * Soft cotton has no sharp corner where the side seam meets the hem: each
 * outer corner is rounded off over this distance along both edges. Left
 * square, a fluttering cuff's corner flicks out like a torn flap.
 */
const CORNER_ROUND = 0.035;

/** A point `distance` from `from` toward `to`, but never past halfway. */
function toward(from: Pt, to: Pt, distance: number): Pt {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span === 0) return from;
  const step = Math.min(distance, span * HALF) / span;
  return mixPt(from, to, step);
}

/** Where the side seam leaves off to round the outer corner. */
function seamCornerStart(opening: LegOpening): Pt {
  return toward(opening.outer, opening.seam, CORNER_ROUND);
}

/**
 * The hem of one leg opening between its rounded outer corner and its crotch
 * corner: two soft scallops hanging either side of the tuck where the drape
 * fold meets it. From the outer corner the path must already stand at
 * {@link seamCornerStart}; toward it, the path ends there.
 */
function traceHem(ctx: Ctx, opening: LegOpening, fromOuter: boolean): void {
  const hemCorner = toward(opening.outer, opening.foldFoot, CORNER_ROUND);
  const outerSag = hemSag(opening.outer, opening.foldFoot, opening.down, opening.scallop);
  const innerSag = hemSag(opening.foldFoot, opening.inner, opening.down, opening.scallop);
  if (fromOuter) {
    ctx.quadraticCurveTo(opening.outer.x, opening.outer.y, hemCorner.x, hemCorner.y);
    ctx.quadraticCurveTo(outerSag.x, outerSag.y, opening.foldFoot.x, opening.foldFoot.y);
    ctx.quadraticCurveTo(innerSag.x, innerSag.y, opening.inner.x, opening.inner.y);
    return;
  }
  const seamCorner = seamCornerStart(opening);
  ctx.quadraticCurveTo(innerSag.x, innerSag.y, opening.foldFoot.x, opening.foldFoot.y);
  ctx.quadraticCurveTo(outerSag.x, outerSag.y, hemCorner.x, hemCorner.y);
  ctx.quadraticCurveTo(opening.outer.x, opening.outer.y, seamCorner.x, seamCorner.y);
}

/** The solved outline of the shorts, shared by the fill, the clips and the folds. */
interface ShortsShape {
  readonly hip: Pt;
  readonly top: number;
  readonly hipHalf: number;
  readonly crotch: Pt;
  readonly right: LegOpening;
  readonly left: LegOpening;
}

/**
 * The shorts hang off the waist, but each leg of them is a cuff wrapped round
 * its own thigh. Drawn as a fixed trapezoid the boxers stay bolt upright
 * through a kick while the leg inside swings away, and the raised thigh comes
 * out bare — which is the one thing that reads as cardboard.
 */
function solveShorts(
  hip: Pt,
  halfWidth: number,
  flare: number,
  view: ViewSpec,
  legs: LegPair,
  flutter: ShortsFlutter,
): ShortsShape {
  const top = hip.y - SHORTS_TOP_RISE;
  const hem = hip.y + SHORTS_HEM_DROP;
  const hemHalf = halfWidth * lerp(SHORTS_HEM_FLARE, SHORTS_HEM_FLARE * SHORTS_FLARE_KICK, flare);
  // Taken off the solved legs, not re-derived from the hip width: the roots move
  // with `view.lateral`, which narrows far faster than the hip does, and a cuff
  // centred where the leg *isn't* misses it by its own error.
  const rootHalf = Math.abs(legs.right.root.x - hip.x);
  // A cuff must clear the thigh it wraps, whatever the hip flare works out to.
  // Edge-on the flare-derived width came out a third narrower than the leg.
  const thighHalf = view.profile ? THIGH_WIDTH * PROFILE_CUFF_DEPTH : THIGH_WIDTH;
  const clearsThigh = thighHalf * CUFF_SLACK;
  const outerHalf = Math.max(hemHalf - rootHalf, clearsThigh);
  const innerHalf = Math.min(rootHalf * CUFF_INNER_REACH, clearsThigh);
  return {
    hip,
    top,
    hipHalf: halfWidth * SHORTS_HIP_FLARE,
    crotch: pt(hip.x, lerp(hem, lerp(top, hem, CROTCH_RISE), view.crotchNotch)),
    right: legOpening(legs.right, 1, outerHalf, innerHalf, flutter.right ?? STILL, view.profile),
    left: legOpening(legs.left, -1, outerHalf, innerHalf, flutter.left ?? STILL, view.profile),
  };
}

function traceShorts(ctx: Ctx, shape: ShortsShape): void {
  const { hip, top, hipHalf, crotch, right, left } = shape;
  ctx.beginPath();
  ctx.moveTo(hip.x - hipHalf, top);
  ctx.lineTo(hip.x + hipHalf, top);
  const rightCorner = seamCornerStart(right);
  ctx.quadraticCurveTo(right.seam.x, right.seam.y, rightCorner.x, rightCorner.y);
  traceHem(ctx, right, true);
  ctx.quadraticCurveTo(crotch.x, crotch.y, left.inner.x, left.inner.y);
  traceHem(ctx, left, false);
  ctx.quadraticCurveTo(left.seam.x, left.seam.y, hip.x - hipHalf, top);
  ctx.closePath();
}

/** The two solved legs, so the shorts can follow the thighs they cover. */
interface LegPair {
  readonly left: BoneChain;
  readonly right: BoneChain;
}

/**
 * How far each cuff's free edge trails where the thigh would carry it, in
 * figure units; absent rides rigidly with the leg.
 */
interface ShortsFlutter {
  readonly left?: Pt;
  readonly right?: Pt;
}

const STILL = pt(0, 0);
const CROTCH_CORNER_SWING = 0.5;

// ── One leg of the shorts as its own tube of cloth ──────────────────────────

/**
 * A leg panel's clip reaches past the silhouette on every open side, so the
 * shorts' own outline — not the panel — decides where the cloth ends.
 */
const PANEL_OVERSHOOT = 0.08;

/** A leg of the shorts as a cylinder of cloth round its thigh. */
interface ClothTube {
  /** Centre of the tube where it leaves the seat. */
  readonly root: Pt;
  /** Centre of the tube at the hem. */
  readonly tip: Pt;
  readonly rootHalf: number;
  readonly tipHalf: number;
}

function legTube(shape: ShortsShape, opening: LegOpening): ClothTube {
  const tip = mixPt(opening.outer, opening.inner, 0.5);
  const root = mixPt(opening.seam, shape.crotch, 0.5);
  return {
    root,
    tip,
    rootHalf: Math.hypot(opening.seam.x - shape.crotch.x, opening.seam.y - shape.crotch.y) / 2,
    tipHalf: Math.hypot(opening.outer.x - opening.inner.x, opening.outer.y - opening.inner.y) / 2,
  };
}

/**
 * The region one leg of the shorts owns: bounded above by the fold that runs
 * from the hip seam down into the crotch, which is where a real pair of boxers
 * breaks from seat into leg.
 */
function tracePanel(ctx: Ctx, shape: ShortsShape, opening: LegOpening): void {
  const reachOut = (p: Pt, dir: Pt): Pt =>
    offset(p, dir.x * PANEL_OVERSHOOT, dir.y * PANEL_OVERSHOOT);
  const seam = reachOut(opening.seam, opening.outward);
  const outer = reachOut(reachOut(opening.outer, opening.outward), opening.down);
  const inner = reachOut(opening.inner, opening.down);
  ctx.beginPath();
  ctx.moveTo(seam.x, seam.y);
  ctx.lineTo(shape.crotch.x, shape.crotch.y);
  ctx.lineTo(inner.x, inner.y);
  ctx.lineTo(outer.x, outer.y);
  ctx.closePath();
}

// ── The heart print ─────────────────────────────────────────────────────────

/**
 * Few and large. Fifteen hearts at 0.03 tiles came out under two pixels each on
 * the sheet, which is not a heart at any distance — it is a polka dot.
 */
const HEART_SIZE = 0.1;
/** A heart this far round a tube is edge-on; past it the print is on the far side. */
const HEART_MAX_WRAP = 1.15;
/** Floor on the foreshortened width, so the edge hearts stay hearts, not dashes. */
const HEART_MIN_SQUASH = 0.75;
const HEART_JITTER = 0.05;

/** Where a heart sits on a tube: how far down it (0–1) and how far round it (radians). */
interface PrintSpot {
  readonly along: number;
  readonly wrap: number;
}

/**
 * Placed round the tube rather than across the picture: `wrap` 0 faces the
 * viewer, ±π/2 is the tube's edge, positive turns outboard. The print is two
 * rows over the whole garment — the seat's and the legs' — because at the tile
 * a third row packs the hearts close enough to average into a pink blur.
 */
const LEG_PRINT: readonly PrintSpot[] = [{ along: 0.62, wrap: 0.3 }];
/** The seat is a wide, short tube: one row just under the waistband, above the leg folds. */
const SEAT_PRINT: readonly PrintSpot[] = [
  { along: 0.5, wrap: -0.55 },
  { along: 0.5, wrap: 0.55 },
];
/**
 * Edge-on the seat is only a hip deep, so three hearts across it land side by
 * side with the legs' hearts at the same height and run together into one red
 * streak, which reads as a smear of blood. One heart, set high on the hip
 * above the legs' row, keeps every heart a separate spot on white.
 */
const PROFILE_SEAT_PRINT: readonly PrintSpot[] = [{ along: 0.3, wrap: 0 }];

/** The heart in the key light, at rest, and turned into the shadow. */
const HEART_LIT = HEART_RED;
/**
 * The print stays a clean, bright red at rest. At the 32 px tile a heart is two
 * or three pixels, and a dark, deep red dot on white is a drop of blood: what
 * says "printed cotton" is a colour as light as a dye on white cloth can be.
 */
const HEART_BASE_DARKENING = 0.15;
const HEART_BASE = mix(HEART_RED, HEART_RED_DARK, HEART_BASE_DARKENING);
/**
 * Dyed cloth in shade goes the way the white around it does — cooler and
 * greyer — so the shadowed heart is pulled toward the cotton's own blue-grey,
 * a dusty rose, never toward maroon, which is the colour of dried blood.
 */
const HEART_SHADE_GREYING = 0.25;
const HEART_SHADE = mix(HEART_RED, COTTON.dark, HEART_SHADE_GREYING);
/** The terminator band the print changes value across, in the 0–1 lit-to-shadow units. */
const HEART_TERMINATOR = 0.58;
const HEART_TERMINATOR_HALF = 0.1;
const HEART_LIT_BELOW = 0.22;

function heartColour(shade: number): string {
  if (shade < HEART_LIT_BELOW) return mix(HEART_LIT, HEART_BASE, shade / HEART_LIT_BELOW);
  const intoShadow =
    (shade - (HEART_TERMINATOR - HEART_TERMINATOR_HALF)) / (HEART_TERMINATOR_HALF * 2);
  return mix(HEART_BASE, HEART_SHADE, Math.min(1, Math.max(0, intoShadow)));
}

/** A heart's shape as shares of its size, measured from its centre with +y toward the point. */
const HEART_LOBE_REACH = 0.5;
const HEART_POINT_DROP = 0.72;
const HEART_SIDE_DROP = 0.1;
const HEART_LOBE_TOP = 0.75;
const HEART_CLEFT_RISE = 0.18;

/** A heart pointing down local +y, centred on the origin. */
function traceHeart(ctx: Ctx, size: number): void {
  const lobe = size * HEART_LOBE_REACH;
  const point = size * HEART_POINT_DROP;
  const side = size * HEART_SIDE_DROP;
  const lobeTop = -size * HEART_LOBE_TOP;
  const cleft = -size * HEART_CLEFT_RISE;
  ctx.beginPath();
  ctx.moveTo(0, point);
  ctx.bezierCurveTo(-size, side, -lobe, lobeTop, 0, cleft);
  ctx.bezierCurveTo(lobe, lobeTop, size, side, 0, point);
  ctx.closePath();
}

/**
 * Prints hearts onto a tube of cloth. Each heart stands along the tube, is
 * squeezed across it by how far round the tube it sits, and takes the value of
 * the cloth at that point — lit, half-tone or shadow — so the print wraps the
 * form instead of floating over it like a sticker.
 */
function printTube(
  ctx: Ctx,
  tube: ClothTube,
  spots: readonly PrintSpot[],
  seed: number,
  outboard: Pt,
): void {
  const angle = angleBetween(tube.root, tube.tip);
  const acrossX = -Math.sin(angle);
  const acrossY = Math.cos(angle);
  // A positive wrap turns toward `outboard`, so the two legs carry mirrored
  // prints. Sharing one wrap direction lands both legs' edge hearts on the same
  // side, and edge-on — where the legs sit one behind the other — on top of each
  // other as one red smear.
  const wrapSign = acrossX * outboard.x + acrossY * outboard.y >= 0 ? 1 : -1;
  const litSide = acrossX * LIGHT.x + acrossY * LIGHT.y >= 0 ? 1 : -1;
  spots.forEach((spot, i) => {
    const wrap = (spot.wrap + (printHash(seed, i) - 0.5) * HEART_JITTER * 2) * wrapSign;
    if (Math.abs(wrap) > HEART_MAX_WRAP) return;
    const along = spot.along + (printHash(i, seed) - 0.5) * HEART_JITTER;
    const centre = mixPt(tube.root, tube.tip, along);
    const half = lerp(tube.rootHalf, tube.tipHalf, along);
    const sideways = Math.sin(wrap) * half;
    const shade = (1 - litSide * Math.sin(wrap)) / 2;
    ctx.save();
    ctx.translate(centre.x + acrossX * sideways, centre.y + acrossY * sideways);
    ctx.rotate(angle - HALF_PI);
    ctx.scale(Math.max(HEART_MIN_SQUASH, Math.cos(wrap)), 1);
    traceHeart(ctx, HEART_SIZE);
    ctx.fillStyle = heartColour(shade);
    ctx.fill();
    ctx.restore();
  });
}

// ── Folds ───────────────────────────────────────────────────────────────────

/** Cotton folds are broad and soft: a wide core at low opacity. */
const COTTON_CREASE_WIDTH = 0.02;
const COTTON_CREASE_OPACITY = 0.55;
/** The stitched hem turns up this far inside the opening. */
const HEM_TURN_UP = 0.03;
const HEM_CREASE_OPACITY = 0.75;
/** The seat-to-leg fold from the crotch dies out this far toward the hip. */
const CROTCH_FOLD_REACH = 0.72;
const CROTCH_FOLD_SMILE = 0.025;
const CROTCH_FOLD_BEND_AT = 0.4;
/**
 * The cloth bunched in the crotch: a second, shorter pair of whiskers fanning
 * down each leg from the seam, under the first.
 */
const BUNCH_FOLD_REACH = 0.5;
const BUNCH_FOLD_TOWARD_HEM = 0.45;
/**
 * The drape fold starts under the seat-to-leg fold and runs down the leg to
 * the hem's tuck. Wider and softer than a crease — a valley between two lit
 * ridges — so it survives the tile as a shade band rather than a line.
 */
const DRAPE_FOLD_TOP = 0.2;
const DRAPE_FOLD_WIDTH = 0.03;
const DRAPE_FOLD_OPACITY = 0.6;
/** The valley is deepest a little below the fold's middle, where the slack gathers. */
const DRAPE_VALLEY_AT = 0.6;
/** The lit ridge sits beside the valley, toward the key, a valley's width away. */
const DRAPE_RIDGE_OFFSET = 1.6;
const DRAPE_RIDGE_ALPHA = 0.7;
/**
 * The fold's free end trails the thigh with the hem: its foot swings this
 * share of the hem's flutter, so the fold leans with the stride.
 */
const DRAPE_FOLD_BOW = 0.8;

/**
 * The turned-up hem of each opening given, as one crease with a subpath per
 * leg.
 */
function paintHems(ctx: Ctx, openings: readonly LegOpening[]): void {
  crease(
    ctx,
    () => {
      ctx.beginPath();
      for (const opening of openings) {
        const up = (p: Pt): Pt =>
          offset(p, -opening.down.x * HEM_TURN_UP, -opening.down.y * HEM_TURN_UP);
        const turned: LegOpening = {
          ...opening,
          outer: up(opening.outer),
          inner: up(opening.inner),
          foldFoot: up(opening.foldFoot),
        };
        const start = seamCornerStart(turned);
        ctx.moveTo(start.x, start.y);
        traceHem(ctx, turned, true);
      }
    },
    COTTON_CREASE_WIDTH,
    COTTON,
    HEM_CREASE_OPACITY,
  );
}

/**
 * A leg's drape fold as two planes: a shaded valley and, on its lit side, the
 * ridge of cloth the key catches. At the tile a crease line is a pixel of noise;
 * a pair of value bands two pixels wide is a fold. Painted after the print, so
 * a heart that falls in the valley darkens with the cloth.
 */
function paintDrapeFold(ctx: Ctx, shape: ShortsShape, opening: LegOpening): void {
  const swing = (p: Pt, share: number): Pt =>
    offset(p, opening.flutter.x * share, opening.flutter.y * share);
  const top = mixPt(mixPt(shape.crotch, opening.seam, HALF), opening.foldFoot, DRAPE_FOLD_TOP);
  paintFoldBand(ctx, top, swing(opening.foldFoot, DRAPE_FOLD_BOW));
}

/** A soft fold between `top` and `bottom`: a shaded valley with a lit ridge on its key side. */
function paintFoldBand(ctx: Ctx, top: Pt, bottom: Pt): void {
  const centre = mixPt(top, bottom, DRAPE_VALLEY_AT);
  const length = Math.hypot(bottom.x - top.x, bottom.y - top.y);
  const angle = angleBetween(top, bottom);
  const across = pt(-Math.sin(angle), Math.cos(angle));
  const litSide = across.x * LIGHT.x + across.y * LIGHT.y >= 0 ? 1 : -1;
  const ridgeOffset = DRAPE_FOLD_WIDTH * DRAPE_RIDGE_OFFSET * litSide;
  fillSoftEllipse(
    ctx,
    centre.x + across.x * ridgeOffset,
    centre.y + across.y * ridgeOffset,
    length * HALF,
    DRAPE_FOLD_WIDTH,
    COTTON.rim,
    DRAPE_RIDGE_ALPHA,
    angle,
  );
  fillSoftEllipse(
    ctx,
    centre.x,
    centre.y,
    length * HALF,
    DRAPE_FOLD_WIDTH,
    COTTON.dark,
    DRAPE_FOLD_OPACITY,
    angle,
  );
}

/**
 * The seat-to-leg folds, the bunching in the crotch, each leg's drape fold and
 * both turned-up hems. Each kind is one path with a subpath per leg, so the
 * pair costs one crease rather than two: a crease is six strokes of its path,
 * and the folds are most of what the boxers cost.
 */
function paintFolds(ctx: Ctx, shape: ShortsShape): void {
  const { crotch } = shape;
  const whisker = (opening: LegOpening) => ({
    end: mixPt(crotch, opening.seam, CROTCH_FOLD_REACH),
    bend: offset(mixPt(crotch, opening.seam, CROTCH_FOLD_BEND_AT), 0, CROTCH_FOLD_SMILE),
    bunch: mixPt(
      mixPt(crotch, opening.seam, BUNCH_FOLD_REACH),
      opening.foldFoot,
      BUNCH_FOLD_TOWARD_HEM,
    ),
  });
  const left = whisker(shape.left);
  const right = whisker(shape.right);
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(left.end.x, left.end.y);
      ctx.quadraticCurveTo(left.bend.x, left.bend.y, crotch.x, crotch.y);
      ctx.quadraticCurveTo(right.bend.x, right.bend.y, right.end.x, right.end.y);
      for (const side of [left, right]) {
        ctx.moveTo(crotch.x, crotch.y);
        ctx.quadraticCurveTo(side.bend.x, side.bend.y, side.bunch.x, side.bunch.y);
      }
    },
    COTTON_CREASE_WIDTH,
    COTTON,
    COTTON_CREASE_OPACITY,
  );

  for (const opening of [shape.left, shape.right]) {
    paintDrapeFold(ctx, shape, opening);
  }

  paintHems(ctx, [shape.left, shape.right]);
}

/** One leg of the shorts: its own tube of cloth, shaded in its own frame and printed. */
function paintLegPanel(
  ctx: Ctx,
  shape: ShortsShape,
  opening: LegOpening,
  tube: ClothTube,
  seed: number,
): void {
  withClip(
    ctx,
    () => tracePanel(ctx, shape, opening),
    () => {
      tracePanel(ctx, shape, opening);
      ctx.fillStyle = COTTON.base;
      ctx.fill();
      shadeClipped(ctx, { from: tube.root, to: tube.tip }, COTTON, {
        halfWidth: Math.max(tube.rootHalf, tube.tipHalf),
        contrast: LEG_CONTRAST,
        terminator: LEG_TERMINATOR,
        softness: LEG_SOFTNESS,
        fillBase: false,
      });
      printTube(ctx, tube, LEG_PRINT, seed, opening.outward);
    },
  );
}

// ── The boxers ──────────────────────────────────────────────────────────────

/** Cotton is matte and broad: a softer terminator than the leather's. */
const SEAT_CONTRAST = 0.8;
const SEAT_SOFTNESS = 1.8;
const LEG_CONTRAST = 1;
/**
 * White cotton has to read as white at the tile, so most of each leg stays in
 * the lit values and the shadow is a band down the far edge. Pushed toward the
 * middle, the cool shade spreads until the shorts read lavender-grey.
 */
const LEG_TERMINATOR = 0.68;
const LEG_SOFTNESS = 1.3;
const SEAT_PRINT_SEED = 7;
/** The seat is one tube across both hips; its print has no leg to mirror for. */
const SEAT_OUTBOARD = pt(1, 0);
const LEFT_PRINT_SEED = 3;
const RIGHT_PRINT_SEED = 5;

/**
 * The boxers. `notch` is how deep the leg openings cut: edge-on you see one hip
 * wrapped in cloth, and cutting the full crotch V there splits the shorts into
 * two panels with bare body showing between them. `waistband` false leaves
 * the band and the jacket's shade on it out, for a repaint over parts that
 * never reach it.
 */
export function drawShorts(
  ctx: Ctx,
  hip: Pt,
  halfWidth: number,
  flare: number,
  view: ViewSpec,
  legs: LegPair,
  flutter: ShortsFlutter = {},
  waistband = true,
): void {
  const { showsBack } = view;
  const shape = solveShorts(hip, halfWidth, flare, view, legs, flutter);
  const traceCloth = (): void => traceShorts(ctx, shape);
  const seat: ClothTube = {
    root: pt(hip.x, shape.top),
    tip: shape.crotch,
    rootHalf: shape.hipHalf,
    tipHalf: shape.hipHalf,
  };
  const tubes = [legTube(shape, shape.left), legTube(shape, shape.right)] as const;

  ctx.save();
  traceCloth();
  ctx.fillStyle = COTTON.base;
  ctx.fill();
  withClip(ctx, traceCloth, () => {
    shadeClipped(ctx, { from: seat.root, to: seat.tip }, COTTON, {
      halfWidth: seat.rootHalf,
      contrast: SEAT_CONTRAST,
      softness: SEAT_SOFTNESS,
      fillBase: false,
    });
    const seatPrint = view.profile ? PROFILE_SEAT_PRINT : SEAT_PRINT;
    printTube(ctx, seat, seatPrint, SEAT_PRINT_SEED + (showsBack ? 1 : 0), SEAT_OUTBOARD);

    // Far leg first, so in profile the near leg's cloth laps over it.
    const legPanels = [
      [shape.left, tubes[0], LEFT_PRINT_SEED],
      [shape.right, tubes[1], RIGHT_PRINT_SEED],
    ] as const;
    for (const [opening, tube, seed] of legPanels) paintLegPanel(ctx, shape, opening, tube, seed);

    paintFolds(ctx, shape);
  });

  if (!waistband) {
    ctx.restore();
    return;
  }
  const bandLeft = pt(hip.x - shape.hipHalf, shape.top);
  const bandRight = pt(hip.x + shape.hipHalf, shape.top);
  fillCapsule(ctx, bandLeft, bandRight, WAISTBAND_HEIGHT, WAISTBAND_HEIGHT, COTTON.base);
  const traceWaist = (): void => {
    traceCloth();
    addCapsule(ctx, bandLeft, bandRight, WAISTBAND_HEIGHT, WAISTBAND_HEIGHT);
  };
  withClip(ctx, traceWaist, () => {
    // The elastic gathers the cotton into a soft ruck just under the band.
    const bandFoot = shape.top + WAISTBAND_HEIGHT;
    crease(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(bandLeft.x, bandFoot);
        ctx.lineTo(bandRight.x, bandFoot);
      },
      COTTON_CREASE_WIDTH,
      COTTON,
      WAISTBAND_RUCK_OPACITY,
    );
    // The jacket hem overhangs the waistband and shades it from the key; the
    // slab shadow the figure lays under the jacket is two scratch pixels, which
    // is a hairline at the tile, so the occlusion is carried down the band here.
    const occlusion = ctx.createLinearGradient(0, shape.top, 0, shape.top + JACKET_OCCLUSION_DEPTH);
    occlusion.addColorStop(0, rgba(COTTON.shadow, JACKET_OCCLUSION_ALPHA));
    occlusion.addColorStop(1, rgba(COTTON.shadow, 0));
    ctx.fillStyle = occlusion;
    ctx.fillRect(
      bandLeft.x - WAISTBAND_HEIGHT,
      shape.top - WAISTBAND_HEIGHT,
      shape.hipHalf * 2 + WAISTBAND_HEIGHT * 2,
      JACKET_OCCLUSION_DEPTH + WAISTBAND_HEIGHT,
    );
  });
  ctx.restore();
}

// ── A leg of the shorts seen end-on ─────────────────────────────────────────

/**
 * A thigh driven at the camera carries its leg of the shorts with it: the
 * cotton tube runs from the seat toward the viewer, so all that shows of it is
 * its open end, a ring of cloth round the thigh, with the knee standing out of
 * it in front. Painted over the shorts and under the knee, it is what says the
 * knee is coming at the viewer rather than a leg painted on top of the boxers.
 */
const END_ON_CUFF_SLACK = 1.5;
/**
 * The flattest the opening draws, however little the thigh points at the
 * camera; flatter than this the ring is a sliver the leg covers anyway.
 */
const END_ON_MIN_ROUNDNESS = 0.35;
/** How far round the ring's rim the cotton's shade band reaches. */
const END_ON_SOFTNESS = 1.4;
/**
 * The thigh fills the opening but not all of it: loose cotton stands off the
 * leg, and the gap between shows as a dark crescent on the hip side, the side
 * the thigh leaves the opening away from.
 */
const END_ON_THIGH_SHARE = 0.66;
const END_ON_HOLE_ALPHA = 0.9;
/** The thigh's end rounds away from the key: shaded like the ball of a limb. */
const END_ON_THIGH_SOFTNESS = 1.6;
/**
 * The thigh inside the opening sits back in the shorts' shade, a step darker
 * than the knee in front of it. Lit like the knee, thigh and knee merge into
 * one pale disc over the shorts, which reads as a ball held there; stepped
 * down, the white ring, the shaded thigh and the lit knee stack in depth.
 */
const END_ON_THIGH_SHADE = 0.5;
const END_ON_THIGH_RAMP = receded(SKIN, END_ON_THIGH_SHADE);

/**
 * The open end of one leg of the shorts, seen along the thigh, with the thigh
 * filling it. `leg` is the leg as drawn; `towardCamera` (0–1) is how squarely
 * the thigh points at the viewer, which is how round the opening draws — a
 * circle square to the thigh, foreshortened along the thigh's line on the
 * screen.
 */
export function drawShortsLegEndOn(
  ctx: Ctx,
  leg: BoneChain,
  towardCamera: number,
  flutter: Pt = STILL,
): void {
  const hemShare = Math.min(SHORTS_HEM_DROP / THIGH_LENGTH, SHORTS_MAX_THIGH_SHARE);
  const mouth = offset(mixPt(leg.root, leg.joint, hemShare), flutter.x, flutter.y);
  const radius = THIGH_WIDTH * END_ON_CUFF_SLACK;
  const squash = Math.max(END_ON_MIN_ROUNDNESS, Math.min(1, towardCamera));
  const angle = angleBetween(leg.root, leg.joint);
  const thighRadius = radius * END_ON_THIGH_SHARE;
  const alongThigh = pt(Math.cos(angle), Math.sin(angle));
  const traceMouth = (): void => {
    ctx.beginPath();
    ctx.ellipse(mouth.x, mouth.y, radius * squash, radius, angle, 0, TWO_PI);
  };
  // The thigh leaves the opening toward the knee, so the gap round it opens on
  // the far (hip) side of the ring.
  const thighCentre = offset(
    mouth,
    alongThigh.x * (radius - thighRadius) * squash,
    alongThigh.y * (radius - thighRadius) * squash,
  );
  const across = pt(-alongThigh.y, alongThigh.x);

  ctx.save();
  traceMouth();
  ctx.fillStyle = COTTON.base;
  ctx.fill();
  withClip(ctx, traceMouth, () => {
    shadeClipped(
      ctx,
      {
        from: offset(mouth, -alongThigh.x * radius, -alongThigh.y * radius),
        to: offset(mouth, alongThigh.x * radius, alongThigh.y * radius),
      },
      COTTON,
      { halfWidth: radius, softness: END_ON_SOFTNESS, fillBase: false },
    );
    ctx.beginPath();
    ctx.ellipse(mouth.x, mouth.y, thighRadius * squash, thighRadius, angle, 0, TWO_PI);
    ctx.fillStyle = rgba(COTTON.deep, END_ON_HOLE_ALPHA);
    ctx.fill();
    const traceThighEnd = (): void => {
      ctx.beginPath();
      ctx.ellipse(
        thighCentre.x,
        thighCentre.y,
        thighRadius * squash,
        thighRadius,
        angle,
        0,
        TWO_PI,
      );
    };
    shadeForm(
      ctx,
      traceThighEnd,
      {
        from: offset(thighCentre, -across.x * thighRadius, -across.y * thighRadius),
        to: offset(thighCentre, across.x * thighRadius, across.y * thighRadius),
      },
      END_ON_THIGH_RAMP,
      { halfWidth: thighRadius, softness: END_ON_THIGH_SOFTNESS },
    );
  });
  ctx.restore();
}

/**
 * How far past the centreline, and below the hip, the repainted half of the
 * shorts may reach: far enough to hold any cuff, however it flutters.
 */
const HALF_SHORTS_REACH = 2;
/**
 * The hem's shadow on the knee under it: the cool plum every cast shadow in the
 * figure uses, a band just below the hem.
 */
const HEM_SHADOW = '#2b1a2e';
const HEM_SHADOW_ALPHA = 0.5;
const HEM_SHADOW_DROP = 0.02;
const HEM_SHADOW_DEPTH = 0.05;

/**
 * One side of the shorts painted again, over a leg whose knee comes forward
 * of them. The floor is seen from above, so a thigh held out toward the camera
 * shows its top, and the loose leg of the shorts lies over it: the knee and
 * shin come out from under the hem, not from the waistband. The whole side is
 * repainted — seat, leg and hem — so no part of the knee shows above the cloth.
 * `side` is the leg as drawn.
 */
export function drawShortsLegOver(
  ctx: Ctx,
  hip: Pt,
  halfWidth: number,
  flare: number,
  view: ViewSpec,
  legs: LegPair,
  flutter: ShortsFlutter,
  side: 'left' | 'right',
): void {
  const outward = side === 'left' ? -1 : 1;
  const shape = solveShorts(hip, halfWidth, flare, view, legs, flutter);
  const opening = side === 'left' ? shape.left : shape.right;
  // The hem shades the knee coming out under it. Laid only on what is
  // already painted, so the shade never spills past the leg onto the floor.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const hemMiddle = mixPt(opening.inner, opening.outer, HALF);
  const hemWidth = Math.hypot(opening.outer.x - opening.inner.x, opening.outer.y - opening.inner.y);
  fillSoftEllipse(
    ctx,
    hemMiddle.x + opening.down.x * HEM_SHADOW_DROP,
    hemMiddle.y + opening.down.y * HEM_SHADOW_DROP,
    hemWidth * HALF,
    HEM_SHADOW_DEPTH,
    HEM_SHADOW,
    HEM_SHADOW_ALPHA,
    angleBetween(opening.inner, opening.outer),
  );
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    Math.min(hip.x, hip.x + outward * HALF_SHORTS_REACH),
    hip.y - HALF_SHORTS_REACH,
    HALF_SHORTS_REACH,
    HALF_SHORTS_REACH * 2,
  );
  ctx.clip();
  // The knee under it is clipped at the hip, well below the waistband, which
  // the shorts already painted stays untouched.
  drawShorts(ctx, hip, halfWidth, flare, view, legs, flutter, false);
  ctx.restore();
}
