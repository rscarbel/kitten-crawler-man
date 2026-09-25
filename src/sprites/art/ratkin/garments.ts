/**
 * The ratkin wardrobe: one factory per garment, each returning a
 * {@link GarmentLayer} whose slot painters are pure functions of the frame they
 * are handed.
 *
 * Every garment is drawn off the solved skeleton and the torso's per-view span,
 * so one path serves all three views: head-on the span's lead and trail are his
 * two sides, edge-on they are his belly and his back. What a view genuinely
 * changes — an apron seen from behind is only its ties, a coat's opening only
 * shows head-on — is branched on `frame.view` inside the layer.
 *
 * Asymmetric details (a satchel, a sash, a purse, a notched ear) are placed with
 * `frame.rightSide`, never with a fixed sign, so they stay on the same side of
 * his body when he turns round.
 *
 * Silhouette and one colour carry a character at tile size; everything finer
 * here (quilting, knit lines, flour, sawdust) is for the close-up and is kept
 * faint so it cannot fight the silhouette at 32 pixels.
 */

import { type Pt, lerp, mix } from '../carlArt';
import { ratkinArmWidths, ratkinLegWidths } from '../ratKinArt';
import type { ArmFrame, GarmentFrame, GarmentLayer, HemShape } from './outfit';
import {
  BODY_OUTLINE_WIDTH,
  DETAIL_OUTLINE_WIDTH,
  MIDPOINT,
  OUTLINE,
  type Ramp,
  SHEEN_ALPHA,
  TWO_PI,
  fillCapsule,
  fillOutlined,
  mixPt,
  offset,
  outlineCapsule,
  pt,
  sheenSegment,
  traceRoundRect,
} from './paint';

type Ctx = CanvasRenderingContext2D;

// ── Shared hem geometry ──────────────────────────────────────────────────────

/** Mordecai's tunic: ends above the knee so the legs stay legible. */
export const TUNIC_HEM: HemShape = { drop: 0.3, flare: 1.24, collarRise: 0.045, sway: 0.05 };
const TUNIC_HEM_SAG = 0.03;
/** A shadow down the far side, so the garment wraps a body instead of facing one. */
const BODY_SHADE_ALPHA = 0.55;
const BODY_SHADE_WIDTH = 0.055;

interface HemPoints {
  readonly hemY: number;
  readonly hemFront: number;
  readonly hemBack: number;
  readonly collarY: number;
  readonly sway: number;
}

function hemPoints(frame: GarmentFrame, hem: HemShape): HemPoints {
  const { hip, shoulder } = frame.skeleton;
  const span = frame.span;
  const sway = frame.pose.hemSway * hem.sway;
  return {
    hemY: hip.y + hem.drop,
    hemFront: hip.x + span.hipLead * hem.flare + sway,
    hemBack:
      hip.x -
      span.hipTrail * (frame.view === 'side' ? (hem.profileTrailFlare ?? hem.flare) : hem.flare) +
      sway,
    collarY: shoulder.y - hem.collarRise,
    sway,
  };
}

/** The body garment's outline — collar, both flanks, and a sagging hem. */
function traceBodyGarment(frame: GarmentFrame, hem: HemShape, sag: number): void {
  const { ctx } = frame;
  const { hip, waist, chest, shoulder } = frame.skeleton;
  const span = frame.span;
  const h = hemPoints(frame, hem);
  ctx.beginPath();
  ctx.moveTo(shoulder.x + span.shoulderLead, h.collarY);
  ctx.quadraticCurveTo(chest.x + span.chestLead, chest.y, waist.x + span.waistLead, waist.y);
  ctx.lineTo(h.hemFront, h.hemY);
  ctx.quadraticCurveTo(hip.x + h.sway, h.hemY + sag, h.hemBack, h.hemY);
  ctx.lineTo(waist.x - span.waistTrail, waist.y);
  ctx.quadraticCurveTo(
    chest.x - span.chestTrail,
    chest.y,
    shoulder.x - span.shoulderTrail,
    h.collarY,
  );
  ctx.closePath();
}

/** The body garment's shaded trailing flank. */
function shadeBodyGarment(frame: GarmentFrame, hem: HemShape, dark: string): void {
  const { ctx } = frame;
  const { waist, chest, shoulder } = frame.skeleton;
  const span = frame.span;
  const h = hemPoints(frame, hem);
  ctx.save();
  ctx.globalAlpha = BODY_SHADE_ALPHA;
  ctx.beginPath();
  ctx.moveTo(shoulder.x - span.shoulderTrail, shoulder.y);
  ctx.quadraticCurveTo(chest.x - span.chestTrail, chest.y, waist.x - span.waistTrail, waist.y);
  ctx.lineTo(h.hemBack, h.hemY);
  ctx.lineTo(h.hemBack + BODY_SHADE_WIDTH, h.hemY);
  ctx.quadraticCurveTo(
    chest.x - span.chestTrail + BODY_SHADE_WIDTH,
    chest.y,
    shoulder.x - span.shoulderTrail + BODY_SHADE_WIDTH,
    shoulder.y,
  );
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.restore();
}

function paintBodyGarment(frame: GarmentFrame, hem: HemShape, cloth: Ramp, sag: number): void {
  fillOutlined(frame.ctx, () => traceBodyGarment(frame, hem, sag), cloth.mid, BODY_OUTLINE_WIDTH);
  shadeBodyGarment(frame, hem, cloth.dark);
}

/** Runs `paint` clipped to the body garment's outline, for patterns and texture. */
function withinBodyGarment(frame: GarmentFrame, hem: HemShape, paint: () => void): void {
  const { ctx } = frame;
  ctx.save();
  traceBodyGarment(frame, hem, TUNIC_HEM_SAG);
  ctx.clip();
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

// ── Sleeves ──────────────────────────────────────────────────────────────────

/** How far a sleeve reaches down the arm. */
export type SleeveLength = 'cap' | 'rolled' | 'long' | 'none';

/** How far down the upper arm the cap sleeve reaches. */
const CAP_SLEEVE_END = 0.55;
/** The sleeve is padded over the arm inside it, which is what makes it cloth. */
const SLEEVE_BULK = 0.012;
const SLEEVE_TAPER = 0.75;
/** A rolled sleeve ends just past the elbow, in a fat roll of cloth. */
const ROLLED_SLEEVE_PAST_ELBOW = 0.22;
const SLEEVE_ROLL_BULK = 0.024;
const SLEEVE_ROLL_LENGTH = 0.035;
/** A long sleeve stops short of the wrist, so the paw keeps its own outline. */
const LONG_SLEEVE_END = 0.86;
const CUFF_BULK = 0.018;

/**
 * The garment's sleeve over one arm.
 *
 * The cap sleeve is drawn with the arm rather than with the garment because it
 * has to follow the arm through its swing: without it the shoulder is an
 * unbroken column of fur running out of a coloured shape, and the eye reads no
 * arm at all.
 */
function paintSleeve(frame: GarmentFrame, arm: ArmFrame, length: SleeveLength, cloth: Ramp): void {
  if (length === 'none') return;
  const { ctx } = frame;
  const { chain, shade } = arm;
  const widths = ratkinArmWidths(arm.widthScale);
  const fill = mix(cloth.mid, OUTLINE, shade);
  const light = mix(cloth.light, OUTLINE, shade);

  if (length === 'cap') {
    const cuff = mixPt(chain.root, chain.joint, CAP_SLEEVE_END);
    const rootWidth = widths.root + SLEEVE_BULK;
    const cuffWidth = lerp(widths.root, widths.joint, CAP_SLEEVE_END) + SLEEVE_BULK * SLEEVE_TAPER;
    outlineCapsule(ctx, chain.root, cuff, rootWidth, cuffWidth);
    fillCapsule(ctx, chain.root, cuff, rootWidth, cuffWidth, fill);
    sheenSegment(ctx, chain.root, cuff, rootWidth, light, SHEEN_ALPHA);
    return;
  }

  const rootWidth = widths.root + SLEEVE_BULK;
  const elbowWidth = widths.joint + SLEEVE_BULK;
  outlineCapsule(ctx, chain.root, chain.joint, rootWidth, elbowWidth);
  if (length === 'rolled') {
    const rollEnd = mixPt(chain.joint, chain.end, ROLLED_SLEEVE_PAST_ELBOW);
    const rollWidth = widths.joint + SLEEVE_ROLL_BULK;
    const rollStart = mixPt(chain.joint, chain.end, ROLLED_SLEEVE_PAST_ELBOW - SLEEVE_ROLL_LENGTH);
    fillCapsule(ctx, chain.root, chain.joint, rootWidth, elbowWidth, fill);
    outlineCapsule(ctx, rollStart, rollEnd, rollWidth, rollWidth);
    fillCapsule(ctx, rollStart, rollEnd, rollWidth, rollWidth, cloth.light);
    sheenSegment(ctx, chain.root, chain.joint, rootWidth, light, SHEEN_ALPHA);
    return;
  }
  const cuffAt = mixPt(chain.joint, chain.end, LONG_SLEEVE_END);
  const cuffWidth = widths.tip + CUFF_BULK;
  outlineCapsule(ctx, chain.joint, cuffAt, elbowWidth, cuffWidth);
  fillCapsule(ctx, chain.root, chain.joint, rootWidth, elbowWidth, fill);
  fillCapsule(ctx, chain.joint, cuffAt, elbowWidth, cuffWidth, fill);
  sheenSegment(ctx, chain.root, chain.joint, rootWidth, light, SHEEN_ALPHA);
}

// ── Body garments ────────────────────────────────────────────────────────────

export interface BodyGarmentOptions {
  readonly cloth: Ramp;
  readonly sleeve?: SleeveLength;
  readonly hem?: HemShape;
}

/**
 * A plain belted-length tunic or shirt, the base most outfits build on.
 *
 * Mordecai's much-mended tunic is this with its defaults and cap sleeves.
 */
export function tunic({
  cloth,
  sleeve = 'cap',
  hem = TUNIC_HEM,
}: BodyGarmentOptions): GarmentLayer {
  return {
    name: 'tunic',
    hem,
    torso: (frame) => paintBodyGarment(frame, hem, cloth, TUNIC_HEM_SAG),
    arm: (frame, arm) => paintSleeve(frame, arm, sleeve, cloth),
  };
}

/** A shirt: the tunic cut short, to be worn under an apron, a vest or a jack. */
export const SHIRT_HEM: HemShape = { drop: 0.16, flare: 1.14, collarRise: 0.035, sway: 0.03 };

export function shirt({
  cloth,
  sleeve = 'long',
  hem = SHIRT_HEM,
}: BodyGarmentOptions): GarmentLayer {
  return { ...tunic({ cloth, sleeve, hem }), name: 'shirt' };
}

/** A coat to the knee. The skirts of it are what make an elder read as dignified. */
const LONG_COAT_HEM: HemShape = { drop: 0.5, flare: 1.42, collarRise: 0.06, sway: 0.07 };
const COAT_SAG = 0.045;
const LAPEL_DEPTH = 0.16;
const LAPEL_WIDTH = 0.06;
const COAT_OPENING_WIDTH = 0.012;

export interface CoatOptions {
  readonly cloth: Ramp;
  /** The lapels and cuffs. */
  readonly trim: Ramp;
}

export function longCoat({ cloth, trim }: CoatOptions): GarmentLayer {
  const hem = LONG_COAT_HEM;
  return {
    name: 'long coat',
    hem,
    torso: (frame) => {
      paintBodyGarment(frame, hem, cloth, COAT_SAG);
      const { ctx, skeleton } = frame;
      const h = hemPoints(frame, hem);
      if (frame.view === 'away') {
        // A back vent, the one line that says "coat" from behind.
        ctx.strokeStyle = cloth.dark;
        ctx.lineWidth = COAT_OPENING_WIDTH;
        ctx.beginPath();
        ctx.moveTo(skeleton.hip.x + h.sway, skeleton.hip.y);
        ctx.lineTo(skeleton.hip.x + h.sway, h.hemY);
        ctx.stroke();
        return;
      }
      // Head-on the opening runs down the middle; edge-on it is his front edge.
      const frontX = frame.view === 'side' ? frame.span.chestLead * MIDPOINT : 0;
      const top = pt(skeleton.shoulder.x + frontX, h.collarY);
      const bottom = pt(skeleton.hip.x + h.sway + frontX, h.hemY);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = COAT_OPENING_WIDTH;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
      for (const side of frame.view === 'side' ? [1] : [-1, 1]) {
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(top.x, top.y);
            ctx.lineTo(top.x + LAPEL_WIDTH * side, top.y);
            ctx.lineTo(top.x, top.y + LAPEL_DEPTH);
            ctx.closePath();
          },
          trim.mid,
          DETAIL_OUTLINE_WIDTH,
        );
      }
    },
    arm: (frame, arm) => paintSleeve(frame, arm, 'long', cloth),
  };
}

/** A robe to the ankles. */
const ROBE_HEM: HemShape = {
  drop: 0.86,
  flare: 1.5,
  collarRise: 0.05,
  sway: 0.06,
  profileTrailFlare: 2.3,
};

export function robe({ cloth, sleeve = 'long' }: BodyGarmentOptions): GarmentLayer {
  return { ...tunic({ cloth, sleeve, hem: ROBE_HEM }), name: 'robe' };
}

/** A loose child's smock, wide at the hem, with a gathered yoke across the chest. */
const SMOCK_HEM: HemShape = { drop: 0.34, flare: 1.55, collarRise: 0.04, sway: 0.06 };
const SMOCK_YOKE_ALPHA = 0.55;

export function smock({ cloth, sleeve = 'rolled' }: BodyGarmentOptions): GarmentLayer {
  const hem = SMOCK_HEM;
  return {
    name: 'smock',
    hem,
    torso: (frame) => {
      paintBodyGarment(frame, hem, cloth, TUNIC_HEM_SAG);
      const { ctx, skeleton, span } = frame;
      ctx.save();
      ctx.globalAlpha = SMOCK_YOKE_ALPHA;
      ctx.strokeStyle = cloth.light;
      ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(skeleton.chest.x - span.chestTrail, skeleton.chest.y);
      ctx.lineTo(skeleton.chest.x + span.chestLead, skeleton.chest.y);
      ctx.stroke();
      ctx.restore();
    },
    arm: (frame, arm) => paintSleeve(frame, arm, sleeve, cloth),
  };
}

/** A knitted wrap worn like a cardigan: long, loose, crossed over the front. */
/** Hip-length, with a ribbed band: a cardigan, never a second long coat. */
const WRAP_HEM: HemShape = { drop: 0.16, flare: 1.3, collarRise: 0.05, sway: 0.04 };
const WRAP_RIB_HEIGHT = 0.05;
const KNIT_LINES = 5;
const KNIT_ALPHA = 0.35;

export function wrap({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  const hem = WRAP_HEM;
  return {
    name: 'wrap',
    hem,
    torso: (frame) => {
      paintBodyGarment(frame, hem, cloth, TUNIC_HEM_SAG);
      const { ctx, skeleton, span } = frame;
      const h = hemPoints(frame, hem);
      withinBodyGarment(frame, hem, () => {
        ctx.globalAlpha = KNIT_ALPHA;
        ctx.strokeStyle = cloth.dark;
        ctx.lineWidth = DETAIL_OUTLINE_WIDTH * MIDPOINT;
        const left = skeleton.hip.x - span.hipTrail * hem.flare;
        const right = skeleton.hip.x + span.hipLead * hem.flare;
        for (let i = 1; i < KNIT_LINES; i++) {
          const x = lerp(left, right, i / KNIT_LINES);
          ctx.beginPath();
          ctx.moveTo(x, h.collarY);
          ctx.lineTo(x + h.sway, h.hemY);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = cloth.light;
        ctx.fillRect(
          skeleton.hip.x - span.hipTrail * hem.flare * 2,
          h.hemY - WRAP_RIB_HEIGHT,
          (span.hipTrail + span.hipLead) * hem.flare * 2,
          WRAP_RIB_HEIGHT * 2,
        );
      });
      if (frame.view !== 'front') return;
      // The crossover: one front laid over the other, down to the opposite hip.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(skeleton.shoulder.x + span.shoulderLead * MIDPOINT * frame.rightSide, h.collarY);
      ctx.lineTo(skeleton.hip.x - span.hipTrail * MIDPOINT * frame.rightSide, skeleton.hip.y);
      ctx.stroke();
    },
    arm: (frame, arm) => paintSleeve(frame, arm, 'long', cloth),
  };
}

/** A quilted gambeson with a leather gorget — the militia's whole kit. */
const JACK_HEM: HemShape = { drop: 0.24, flare: 1.32, collarRise: 0.05, sway: 0.04 };
const QUILT_ROWS = 4;
const QUILT_ALPHA = 0.5;
const GORGET_WIDTH = 0.05;
const GORGET_REACH = 0.8;

export interface PaddedJackOptions {
  readonly cloth: Ramp;
  readonly gorget: Ramp;
}

export function paddedJack({ cloth, gorget }: PaddedJackOptions): GarmentLayer {
  const hem = JACK_HEM;
  return {
    name: 'padded jack',
    hem,
    torso: (frame) => {
      paintBodyGarment(frame, hem, cloth, TUNIC_HEM_SAG);
      const { ctx, skeleton, span } = frame;
      const h = hemPoints(frame, hem);
      withinBodyGarment(frame, hem, () => {
        ctx.globalAlpha = QUILT_ALPHA;
        ctx.strokeStyle = cloth.dark;
        ctx.lineWidth = DETAIL_OUTLINE_WIDTH * MIDPOINT;
        for (let i = 1; i <= QUILT_ROWS; i++) {
          const y = lerp(skeleton.shoulder.y, h.hemY, i / (QUILT_ROWS + 1));
          ctx.beginPath();
          ctx.moveTo(skeleton.hip.x - span.hipTrail * hem.flare * 2, y);
          ctx.lineTo(skeleton.hip.x + span.hipLead * hem.flare * 2, y);
          ctx.stroke();
        }
      });
      const left = pt(skeleton.shoulder.x - span.shoulderTrail * GORGET_REACH, h.collarY);
      const right = pt(skeleton.shoulder.x + span.shoulderLead * GORGET_REACH, h.collarY);
      outlineCapsule(ctx, left, right, GORGET_WIDTH, GORGET_WIDTH);
      fillCapsule(ctx, left, right, GORGET_WIDTH, GORGET_WIDTH, gorget.mid);
      sheenSegment(ctx, left, right, GORGET_WIDTH, gorget.light, SHEEN_ALPHA);
    },
    arm: (frame, arm) => paintSleeve(frame, arm, 'long', cloth),
  };
}

/** A sleeveless vest, open down the front over whatever is under it. */
const VEST_HEM: HemShape = { drop: 0.08, flare: 1.18, collarRise: 0.02, sway: 0.02 };
const VEST_OPENING = 0.05;
const VEST_PATTERN_STEP = 0.07;
const VEST_PATTERN_R = 0.018;

export interface VestOptions {
  readonly cloth: Ramp;
  /** The colour showing through the front opening — the shirt under it. */
  readonly opening: string;
  /** A small diamond print, in this colour. */
  readonly pattern?: string;
}

export function vest({ cloth, opening, pattern }: VestOptions): GarmentLayer {
  const hem = VEST_HEM;
  return {
    name: 'vest',
    hem,
    torso: (frame) => {
      paintBodyGarment(frame, hem, cloth, TUNIC_HEM_SAG);
      const { ctx, skeleton, span } = frame;
      const h = hemPoints(frame, hem);
      if (pattern !== undefined) {
        withinBodyGarment(frame, hem, () => {
          ctx.fillStyle = pattern;
          const left = skeleton.hip.x - span.hipTrail * 2;
          const right = skeleton.hip.x + span.hipLead * 2;
          let row = 0;
          for (let y = h.collarY; y < h.hemY; y += VEST_PATTERN_STEP) {
            const stagger = row % 2 === 0 ? 0 : VEST_PATTERN_STEP * MIDPOINT;
            for (let x = left + stagger; x < right; x += VEST_PATTERN_STEP) {
              ctx.beginPath();
              ctx.moveTo(x, y - VEST_PATTERN_R);
              ctx.lineTo(x + VEST_PATTERN_R, y);
              ctx.lineTo(x, y + VEST_PATTERN_R);
              ctx.lineTo(x - VEST_PATTERN_R, y);
              ctx.closePath();
              ctx.fill();
            }
            row++;
          }
        });
      }
      if (frame.view !== 'front') return;
      // The open front: a V of the shirt showing between the two panels.
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(skeleton.shoulder.x - span.shoulderTrail * MIDPOINT, h.collarY);
          ctx.lineTo(skeleton.shoulder.x + span.shoulderLead * MIDPOINT, h.collarY);
          ctx.lineTo(skeleton.hip.x + VEST_OPENING, h.hemY);
          ctx.lineTo(skeleton.hip.x - VEST_OPENING, h.hemY);
          ctx.closePath();
        },
        opening,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

/** A long skirt from the waist to just above the feet. */
const SKIRT_DROP = 0.84;
const SKIRT_FLARE = 1.6;
/** Behind him in profile the skirt has to clear the hocks, which ride well back. */
const SKIRT_PROFILE_TRAIL_FLARE = 2.3;
const SKIRT_WAIST = 0.96;
const SKIRT_SWAY = 0.07;
const SKIRT_SAG = 0.04;

export function skirt({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'skirt',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const { hip, waist } = skeleton;
      const sway = frame.pose.hemSway * SKIRT_SWAY;
      const hemY = hip.y + SKIRT_DROP;
      const front = hip.x + span.hipLead * SKIRT_FLARE + sway;
      const backFlare = frame.view === 'side' ? SKIRT_PROFILE_TRAIL_FLARE : SKIRT_FLARE;
      const back = hip.x - span.hipTrail * backFlare + sway;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(waist.x - span.waistTrail * SKIRT_WAIST, waist.y);
          ctx.lineTo(waist.x + span.waistLead * SKIRT_WAIST, waist.y);
          ctx.quadraticCurveTo(hip.x + span.hipLead * SKIRT_FLARE, hip.y, front, hemY);
          ctx.quadraticCurveTo(hip.x + sway, hemY + SKIRT_SAG, back, hemY);
          ctx.quadraticCurveTo(
            hip.x - span.hipTrail * SKIRT_FLARE,
            hip.y,
            waist.x - span.waistTrail * SKIRT_WAIST,
            waist.y,
          );
          ctx.closePath();
        },
        cloth.mid,
        BODY_OUTLINE_WIDTH,
      );
      ctx.save();
      ctx.globalAlpha = BODY_SHADE_ALPHA;
      ctx.strokeStyle = cloth.dark;
      ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(hip.x + sway, hemY);
      ctx.stroke();
      ctx.restore();
    },
  };
}

// ── Legs ─────────────────────────────────────────────────────────────────────

const TROUSER_BULK = 0.014;
/** Rolled trousers stop halfway down the shank, which leaves the hock bare. */
const ROLLED_TROUSER_END = 0.45;
const TROUSER_END = 0.92;

export function trousers({
  cloth,
  rolled = false,
}: {
  readonly cloth: Ramp;
  readonly rolled?: boolean;
}): GarmentLayer {
  return {
    name: 'trousers',
    leg: (frame, leg) => {
      const { ctx } = frame;
      const widths = ratkinLegWidths(leg.foot.nearness, leg.widthScale);
      const { chain } = leg;
      const fill = mix(cloth.mid, OUTLINE, leg.shade);
      const end = mixPt(chain.joint, chain.end, rolled ? ROLLED_TROUSER_END : TROUSER_END);
      const endWidth = lerp(widths.joint, widths.belly, rolled ? 1 : MIDPOINT) + TROUSER_BULK;
      outlineCapsule(
        ctx,
        chain.root,
        chain.joint,
        widths.root + TROUSER_BULK,
        widths.joint + TROUSER_BULK,
      );
      outlineCapsule(ctx, chain.joint, end, widths.joint + TROUSER_BULK, endWidth);
      fillCapsule(
        ctx,
        chain.root,
        chain.joint,
        widths.root + TROUSER_BULK,
        widths.joint + TROUSER_BULK,
        fill,
      );
      fillCapsule(ctx, chain.joint, end, widths.joint + TROUSER_BULK, endWidth, fill);
      if (rolled) {
        const roll = mixPt(chain.joint, chain.end, ROLLED_TROUSER_END - SLEEVE_ROLL_LENGTH);
        fillCapsule(ctx, roll, end, endWidth, endWidth, mix(cloth.light, OUTLINE, leg.shade));
      }
    },
  };
}

const KNEE_PAD_R = 0.07;

export function kneePads({ leather }: { readonly leather: Ramp }): GarmentLayer {
  return {
    name: 'knee pads',
    leg: (frame, leg) => {
      const { ctx } = frame;
      const knee = leg.chain.joint;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(knee.x, knee.y, KNEE_PAD_R * leg.widthScale, 0, TWO_PI);
        },
        mix(leather.mid, OUTLINE, leg.shade),
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

const MUD_ALPHA = 0.7;
const MUD_FROM = 0.45;
const MUD_WIDTH_SHARE = 1.05;

/** Mud caked up the shins and over the feet. */
export function muddyLegs({ mud }: { readonly mud: string }): GarmentLayer {
  return {
    name: 'muddy legs',
    leg: (frame, leg) => {
      const { ctx } = frame;
      const widths = ratkinLegWidths(leg.foot.nearness, leg.widthScale);
      const from = mixPt(leg.chain.joint, leg.chain.end, MUD_FROM);
      ctx.save();
      ctx.globalAlpha = MUD_ALPHA;
      fillCapsule(
        ctx,
        from,
        leg.chain.end,
        widths.belly * MUD_WIDTH_SHARE,
        widths.tip * MUD_WIDTH_SHARE,
        mud,
      );
      fillCapsule(ctx, leg.chain.end, leg.foot.ball, widths.tip, widths.tip, mud);
      ctx.restore();
    },
  };
}

// ── Torso accessories ────────────────────────────────────────────────────────

const STRAP_WIDTH = 0.024;
const STRAP_AT = 0.5;
const STRAP_DROP = 0.06;

/**
 * A strap slung from one shoulder across to the other hip.
 *
 * Head-on and from behind it crosses from the wearer's left shoulder, which is
 * the opposite side of the picture in the two views: left alone it reads as the
 * strap jumping shoulders when he turns round. Edge-on it runs from his front
 * down to his back.
 */
export function shoulderStrap({ leather }: { readonly leather: Ramp }): GarmentLayer {
  return {
    name: 'shoulder strap',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const strapSide = frame.view === 'side' ? 1 : -frame.rightSide;
      const strapTop = offset(skeleton.shoulder, span.shoulderLead * STRAP_AT * strapSide, 0);
      const strapBottom = pt(
        skeleton.waist.x - span.waistTrail * STRAP_AT * strapSide,
        skeleton.waist.y + STRAP_DROP,
      );
      outlineCapsule(ctx, strapTop, strapBottom, STRAP_WIDTH, STRAP_WIDTH);
      fillCapsule(ctx, strapTop, strapBottom, STRAP_WIDTH, STRAP_WIDTH, leather.mid);
    },
  };
}

const BELT_AT = 0.52;
const BELT_HEIGHT = 0.042;
const BUCKLE_WIDTH = 0.045;
const BUCKLE_INSET = 0.62;

interface BeltLine {
  readonly y: number;
  readonly front: number;
  readonly back: number;
}

/** Where a belt cinched over a garment with this hem sits. */
function beltLine(frame: GarmentFrame, over: HemShape): BeltLine {
  const { waist } = frame.skeleton;
  const span = frame.span;
  const h = hemPoints(frame, over);
  return {
    y: lerp(waist.y, h.hemY, BELT_AT),
    front: lerp(waist.x + span.waistLead, h.hemFront, BELT_AT),
    back: lerp(waist.x - span.waistTrail, h.hemBack, BELT_AT),
  };
}

export interface BeltOptions {
  readonly leather: Ramp;
  readonly buckle: string;
  /** The hem of the garment the belt is cinched over. */
  readonly over?: HemShape;
}

export function belt({ leather, buckle, over = TUNIC_HEM }: BeltOptions): GarmentLayer {
  return {
    name: 'belt',
    torso: (frame) => {
      const { ctx } = frame;
      const line = beltLine(frame, over);
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.rect(line.back, line.y - BELT_HEIGHT / 2, line.front - line.back, BELT_HEIGHT);
        },
        leather.mid,
        DETAIL_OUTLINE_WIDTH,
      );
      ctx.fillStyle = buckle;
      ctx.fillRect(
        line.front - BUCKLE_WIDTH,
        line.y - (BELT_HEIGHT * BUCKLE_INSET) / 2,
        BUCKLE_WIDTH,
        BELT_HEIGHT * BUCKLE_INSET,
      );
    },
  };
}

const POUCH_WIDTH = 0.075;
const POUCH_HEIGHT = 0.085;
const POUCH_BACK = 0.1;
const POUCH_ROUND = 0.3;

/** A pouch hung off the back of a belt. */
export function beltPouch({
  leather,
  over = TUNIC_HEM,
}: {
  readonly leather: Ramp;
  readonly over?: HemShape;
}): GarmentLayer {
  return {
    name: 'belt pouch',
    torso: (frame) => {
      const line = beltLine(frame, over);
      fillOutlined(
        frame.ctx,
        () =>
          traceRoundRect(
            frame.ctx,
            line.back + POUCH_BACK,
            line.y,
            POUCH_WIDTH,
            POUCH_HEIGHT,
            POUCH_HEIGHT * POUCH_ROUND,
          ),
        leather.dark,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

/** Where on the belt line the wearer's right hip is, in this view. */
function rightHipX(frame: GarmentFrame, line: BeltLine, inset: number): number {
  if (frame.view === 'side') return lerp(line.back, line.front, MIDPOINT);
  return frame.rightSide > 0 ? line.front - inset : line.back + inset;
}

const PURSE_R = 0.045;
const PURSE_INSET = 0.07;

/** A round coin purse on the right hip. */
export function purse({
  leather,
  over = TUNIC_HEM,
}: {
  readonly leather: Ramp;
  readonly over?: HemShape;
}): GarmentLayer {
  return {
    name: 'purse',
    torso: (frame) => {
      const line = beltLine(frame, over);
      const x = rightHipX(frame, line, PURSE_INSET);
      fillOutlined(
        frame.ctx,
        () => {
          frame.ctx.beginPath();
          frame.ctx.arc(x, line.y + PURSE_R, PURSE_R, 0, TWO_PI);
        },
        leather.mid,
        DETAIL_OUTLINE_WIDTH,
      );
      frame.ctx.fillStyle = leather.light;
      frame.ctx.fillRect(x - PURSE_R * MIDPOINT, line.y, PURSE_R, DETAIL_OUTLINE_WIDTH);
    },
  };
}

const TOOL_HANDLE_LENGTH = 0.16;
const TOOL_HANDLE_WIDTH = 0.014;
const TOOL_INSET = 0.05;
const BLUEPRINT_LENGTH = 0.22;
const BLUEPRINT_WIDTH = 0.026;
const BLUEPRINT_TILT = 0.5;

export interface ToolBeltOptions {
  readonly leather: Ramp;
  readonly buckle: string;
  readonly handle: Ramp;
  /** A rolled plan tucked through the belt at the back, in this colour. */
  readonly blueprint?: Ramp;
  readonly over?: HemShape;
}

/** A heavy belt hung with tool handles — the builder's badge. */
export function toolBelt({
  leather,
  buckle,
  handle,
  blueprint,
  over = TUNIC_HEM,
}: ToolBeltOptions): GarmentLayer {
  const base = belt({ leather, buckle, over });
  return {
    name: 'tool belt',
    torso: (frame) => {
      const { ctx } = frame;
      const line = beltLine(frame, over);
      if (blueprint !== undefined) {
        // Behind the belt, slanting up past his back: a roll of blue is the
        // only engineer's cue that survives the tile.
        const root = pt(line.back + TOOL_INSET, line.y);
        const top = offset(root, -BLUEPRINT_LENGTH * BLUEPRINT_TILT, -BLUEPRINT_LENGTH);
        outlineCapsule(ctx, root, top, BLUEPRINT_WIDTH, BLUEPRINT_WIDTH);
        fillCapsule(ctx, root, top, BLUEPRINT_WIDTH, BLUEPRINT_WIDTH, blueprint.mid);
      }
      base.torso?.(frame);
      for (const at of [TOOL_INSET, line.front - line.back - TOOL_INSET * 2]) {
        const top = pt(line.back + at + TOOL_INSET, line.y);
        const bottom = offset(top, 0, TOOL_HANDLE_LENGTH);
        outlineCapsule(ctx, top, bottom, TOOL_HANDLE_WIDTH, TOOL_HANDLE_WIDTH);
        fillCapsule(ctx, top, bottom, TOOL_HANDLE_WIDTH, TOOL_HANDLE_WIDTH, handle.mid);
      }
    },
  };
}

/** An apron: a bib to the chest or a half-apron from the waist. */
const APRON_HEM_DROP = 0.4;
const APRON_WIDTH_SHARE = 0.78;
const APRON_PROFILE_THICKNESS = 0.05;
const APRON_TIE_WIDTH = 0.016;
const APRON_TIE_LOOP = 0.04;

export interface ApronOptions {
  readonly cloth: Ramp;
  readonly bib?: boolean;
  /** How far below the hip the apron hangs; aprons for heavy work run longer. */
  readonly drop?: number;
}

export function apron({ cloth, bib = true, drop = APRON_HEM_DROP }: ApronOptions): GarmentLayer {
  return {
    name: 'apron',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const { hip, waist, chest, neck } = skeleton;
      const sway = frame.pose.hemSway * TUNIC_HEM.sway;
      const top = bib ? chest : waist;
      const topHalf = (bib ? span.chestLead : span.waistLead) * APRON_WIDTH_SHARE;
      const hemY = hip.y + drop;

      if (frame.view === 'away') {
        // From behind an apron is its strings: a bow at the small of the back.
        ctx.strokeStyle = cloth.mid;
        ctx.lineWidth = APRON_TIE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(waist.x - span.waistTrail, waist.y);
        ctx.lineTo(waist.x + span.waistLead, waist.y);
        ctx.stroke();
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(waist.x + APRON_TIE_LOOP * side, waist.y, APRON_TIE_LOOP, 0, TWO_PI);
          ctx.stroke();
        }
        return;
      }

      if (frame.view === 'side') {
        const frontTop = pt(top.x + (bib ? span.chestLead : span.waistLead), top.y);
        const belly = pt(waist.x + span.waistLead, waist.y);
        const hemFront = pt(hip.x + span.hipLead * TUNIC_HEM.flare + sway, hemY);
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(frontTop.x - APRON_PROFILE_THICKNESS, frontTop.y);
            ctx.lineTo(frontTop.x + APRON_PROFILE_THICKNESS * MIDPOINT, frontTop.y);
            ctx.quadraticCurveTo(
              belly.x + APRON_PROFILE_THICKNESS,
              belly.y,
              hemFront.x + APRON_PROFILE_THICKNESS,
              hemFront.y,
            );
            ctx.lineTo(hemFront.x - APRON_PROFILE_THICKNESS * 2, hemFront.y);
            ctx.quadraticCurveTo(
              belly.x - APRON_PROFILE_THICKNESS,
              belly.y,
              frontTop.x - APRON_PROFILE_THICKNESS,
              frontTop.y,
            );
            ctx.closePath();
          },
          cloth.mid,
          DETAIL_OUTLINE_WIDTH,
        );
        ctx.strokeStyle = cloth.dark;
        ctx.lineWidth = APRON_TIE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(waist.x + span.waistLead, waist.y);
        ctx.lineTo(waist.x - span.waistTrail, waist.y);
        ctx.stroke();
        return;
      }

      const hemHalf = span.hipLead * TUNIC_HEM.flare * APRON_WIDTH_SHARE;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(top.x - topHalf, top.y);
          ctx.lineTo(top.x + topHalf, top.y);
          ctx.lineTo(hip.x + hemHalf + sway, hemY);
          ctx.lineTo(hip.x - hemHalf + sway, hemY);
          ctx.closePath();
        },
        cloth.mid,
        BODY_OUTLINE_WIDTH,
      );
      ctx.save();
      ctx.globalAlpha = BODY_SHADE_ALPHA;
      ctx.fillStyle = cloth.dark;
      ctx.fillRect(hip.x - hemHalf + sway, hemY - BODY_SHADE_WIDTH, hemHalf * 2, BODY_SHADE_WIDTH);
      ctx.restore();
      if (!bib) return;
      ctx.strokeStyle = cloth.dark;
      ctx.lineWidth = APRON_TIE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(top.x - topHalf, top.y);
      ctx.lineTo(neck.x, neck.y);
      ctx.lineTo(top.x + topHalf, top.y);
      ctx.stroke();
    },
  };
}

const CHAIN_WIDTH = 0.022;
const CHAIN_SAG = 0.2;
const CHAIN_SPREAD = 0.8;
const MEDALLION_R = 0.05;
const CHAIN_LINKS = 7;
const LINK_R = 0.012;

export interface ChainOptions {
  readonly metal: Ramp;
}

/** A mayor's chain of office: a heavy gold U across the chest with a medallion. */
export function chainOfOffice({ metal }: ChainOptions): GarmentLayer {
  return {
    name: 'chain of office',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const { shoulder, chest } = skeleton;
      let from: Pt;
      let to: Pt;
      let control: Pt;
      let medallion: Pt | null;
      if (frame.view === 'side') {
        from = pt(shoulder.x - span.shoulderTrail * MIDPOINT, shoulder.y);
        to = pt(chest.x + span.chestLead * CHAIN_SPREAD, chest.y + CHAIN_SAG * MIDPOINT);
        control = pt(chest.x, chest.y + CHAIN_SAG * MIDPOINT);
        medallion = to;
      } else {
        from = pt(shoulder.x - span.shoulderTrail * CHAIN_SPREAD, shoulder.y);
        to = pt(shoulder.x + span.shoulderLead * CHAIN_SPREAD, shoulder.y);
        const drop = frame.view === 'away' ? CHAIN_SAG * MIDPOINT : CHAIN_SAG;
        control = pt(shoulder.x, shoulder.y + drop * 2);
        medallion = frame.view === 'away' ? null : pt(shoulder.x, shoulder.y + drop);
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = CHAIN_WIDTH + DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      ctx.stroke();
      ctx.strokeStyle = metal.mid;
      ctx.lineWidth = CHAIN_WIDTH;
      ctx.stroke();
      ctx.fillStyle = metal.light;
      for (let i = 1; i < CHAIN_LINKS; i++) {
        const t = i / CHAIN_LINKS;
        const a = mixPt(from, control, t);
        const b = mixPt(control, to, t);
        const link = mixPt(a, b, t);
        ctx.beginPath();
        ctx.arc(link.x, link.y, LINK_R, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
      if (medallion === null) return;
      const centre = medallion;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(centre.x, centre.y, MEDALLION_R, 0, TWO_PI);
        },
        metal.light,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

const SASH_WIDTH = 0.045;
const SASH_KNOT_R = 0.04;
const SASH_TAIL = 0.14;

/** A captain's sash from the right shoulder to the left hip, knotted there. */
export function sash({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'sash',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const { shoulder, hip, waist } = skeleton;
      let from: Pt;
      let to: Pt;
      if (frame.view === 'side') {
        from = pt(shoulder.x, shoulder.y);
        to = pt(waist.x + span.waistLead, hip.y);
      } else {
        from = pt(shoulder.x + span.shoulderLead * CHAIN_SPREAD * frame.rightSide, shoulder.y);
        to = pt(hip.x - span.hipTrail * CHAIN_SPREAD * frame.rightSide, hip.y);
      }
      outlineCapsule(ctx, from, to, SASH_WIDTH, SASH_WIDTH);
      fillCapsule(ctx, from, to, SASH_WIDTH, SASH_WIDTH, cloth.mid);
      sheenSegment(ctx, from, to, SASH_WIDTH, cloth.light, SHEEN_ALPHA);
      const tail = offset(to, 0, SASH_TAIL);
      outlineCapsule(ctx, to, tail, SASH_WIDTH * MIDPOINT, SASH_WIDTH);
      fillCapsule(ctx, to, tail, SASH_WIDTH * MIDPOINT, SASH_WIDTH, cloth.dark);
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(to.x, to.y, SASH_KNOT_R, 0, TWO_PI);
        },
        cloth.mid,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

/** Big enough to survive the tile: at game size the knot has to be a red mark, not a speck. */
const KNOT_EMBLEM_R = 0.034;
const SATCHEL_WIDTH = 0.17;
const SATCHEL_HEIGHT = 0.15;
const SATCHEL_DROP = 0.02;
/** How far past the robe's edge an arm-free bag's centre sits, as a share of its half width. */
const SATCHEL_EDGE_OVERHANG = 0.4;

/**
 * Head-on, how far out from the hip the bag's centre hangs. It rests against
 * the garment's edge at the hip — and when the right arm hangs down across that
 * edge, just outside the arm instead, so the bag and its knot are never hidden
 * behind the paw. With the arm raised it falls back against the body rather
 * than floating out where the arm used to be.
 */
function facingSatchelReach(frame: GarmentFrame, top: number): number {
  const { skeleton, span } = frame;
  const halfWidth = SATCHEL_WIDTH * MIDPOINT;
  const edge = span.hipLead * TUNIC_HEM.flare + halfWidth * SATCHEL_EDGE_OVERHANG;
  const arm = frame.rightSide < 0 ? skeleton.farArm : skeleton.nearArm;
  const armWidth = ratkinArmWidths(frame.build.limbWidth).joint;
  let reach = edge;
  for (const point of [arm.joint, arm.end]) {
    const overlapsBag = point.y + armWidth >= top && point.y - armWidth <= top + SATCHEL_HEIGHT;
    if (!overlapsBag) continue;
    const outward = (point.x - skeleton.hip.x) * frame.rightSide + armWidth;
    reach = Math.max(reach, outward + halfWidth);
  }
  return reach;
}
const EMBLEM_STROKE = 0.014;

export interface SatchelOptions {
  readonly leather: Ramp;
  /** The stitched knot on the flap. */
  readonly emblem: string;
}

/**
 * A satchel on the right hip on a strap from the left shoulder, its flap
 * stitched with a knot — a healer's mark of this village's own, not a cross.
 */
export function satchel({ leather, emblem }: SatchelOptions): GarmentLayer {
  const strap = shoulderStrap({ leather });
  const paintBag = (frame: GarmentFrame): void => {
    const { ctx, skeleton, span } = frame;
    const { hip } = skeleton;
    const top = hip.y - SATCHEL_DROP;
    const x =
      frame.view === 'side'
        ? hip.x - span.hipTrail * MIDPOINT
        : hip.x + frame.rightSide * facingSatchelReach(frame, top);
    fillOutlined(
      ctx,
      () =>
        traceRoundRect(
          ctx,
          x - SATCHEL_WIDTH * MIDPOINT,
          top,
          SATCHEL_WIDTH,
          SATCHEL_HEIGHT,
          SATCHEL_HEIGHT * POUCH_ROUND,
        ),
      leather.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    if (frame.view === 'away') return;
    const centre = pt(x, top + SATCHEL_HEIGHT * MIDPOINT);
    ctx.save();
    ctx.strokeStyle = emblem;
    ctx.lineWidth = EMBLEM_STROKE;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, KNOT_EMBLEM_R, 0, TWO_PI);
    ctx.moveTo(centre.x - KNOT_EMBLEM_R, centre.y - KNOT_EMBLEM_R);
    ctx.lineTo(centre.x + KNOT_EMBLEM_R, centre.y + KNOT_EMBLEM_R);
    ctx.moveTo(centre.x + KNOT_EMBLEM_R, centre.y - KNOT_EMBLEM_R);
    ctx.lineTo(centre.x - KNOT_EMBLEM_R, centre.y + KNOT_EMBLEM_R);
    ctx.stroke();
    ctx.restore();
  };
  return {
    name: 'satchel',
    torso: (frame) => {
      strap.torso?.(frame);
      if (frame.view !== 'front') paintBag(frame);
    },
    // Head-on the bag hangs outside the arm, and it is the healer's one mark:
    // painted under the arm it vanishes behind the paw in her standing pose,
    // which is the pose she is seen in most.
    front: (frame) => {
      if (frame.view === 'front') paintBag(frame);
    },
  };
}

const KERCHIEF_HALF = 0.1;
const KERCHIEF_POINT = 0.15;
const KERCHIEF_KNOT_R = 0.026;

/** A kerchief knotted at the throat, its point hanging on the chest. */
export function neckKerchief({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'neck kerchief',
    // Over the neck's fur, which is drawn after every torso layer and would
    // otherwise bury a kerchief knotted at the throat.
    front: (frame) => {
      const { ctx, skeleton, span } = frame;
      const { neck, shoulder } = skeleton;
      if (frame.view === 'side') {
        const knot = pt(neck.x + span.shoulderLead * STRAP_AT, shoulder.y);
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(neck.x - span.shoulderTrail * STRAP_AT, shoulder.y - KERCHIEF_KNOT_R);
            ctx.lineTo(knot.x + KERCHIEF_KNOT_R, knot.y - KERCHIEF_KNOT_R);
            ctx.lineTo(knot.x + KERCHIEF_KNOT_R, knot.y + KERCHIEF_POINT * MIDPOINT);
            ctx.lineTo(neck.x - span.shoulderTrail * STRAP_AT, shoulder.y + KERCHIEF_KNOT_R);
            ctx.closePath();
          },
          cloth.mid,
          DETAIL_OUTLINE_WIDTH,
        );
        return;
      }
      const pointDown = frame.view === 'away' ? KERCHIEF_POINT * MIDPOINT : KERCHIEF_POINT;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(shoulder.x - KERCHIEF_HALF, shoulder.y);
          ctx.lineTo(shoulder.x + KERCHIEF_HALF, shoulder.y);
          ctx.lineTo(shoulder.x, shoulder.y + pointDown);
          ctx.closePath();
        },
        cloth.mid,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

// ── Over-the-shoulder layers (drawn over the arms) ───────────────────────────

const SHAWL_DROP = 0.2;
const SHAWL_SPREAD = 1.28;
const SHAWL_BACK_POINT = 0.36;
const SHAWL_FRINGE_ALPHA = 0.6;

/** The drape of a shawl or capelet: over both shoulders and down the chest. */
function paintShoulderDrape(
  frame: GarmentFrame,
  cloth: Ramp,
  drop: number,
  pointed: boolean,
  spread = SHAWL_SPREAD,
): void {
  const { ctx, skeleton, span } = frame;
  const { shoulder, neck } = skeleton;
  const outline = (): void => {
    ctx.beginPath();
    if (frame.view === 'side') {
      const back = pt(shoulder.x - span.shoulderTrail * spread, shoulder.y + drop);
      const front = pt(shoulder.x + span.shoulderLead * spread, shoulder.y + drop);
      ctx.moveTo(neck.x - span.shoulderTrail * MIDPOINT, neck.y);
      ctx.quadraticCurveTo(back.x, shoulder.y, back.x, back.y + (pointed ? drop : 0));
      ctx.quadraticCurveTo(shoulder.x, shoulder.y + drop * 2, front.x, front.y);
      ctx.quadraticCurveTo(front.x, shoulder.y, neck.x + span.shoulderLead * MIDPOINT, neck.y);
    } else {
      const left = pt(shoulder.x - span.shoulderTrail * spread, shoulder.y + drop);
      const right = pt(shoulder.x + span.shoulderLead * spread, shoulder.y + drop);
      // A shawl comes to a point down the back; a capelet's hem is a round
      // curve, deepest at the middle, which is what keeps it from reading as a
      // flat bib pasted on.
      const pointY =
        frame.view === 'away' && pointed
          ? shoulder.y + SHAWL_BACK_POINT
          : shoulder.y + drop * (pointed ? 1 : CAPELET_HEM_ROUNDING);
      ctx.moveTo(neck.x - span.shoulderTrail * MIDPOINT, neck.y);
      ctx.quadraticCurveTo(left.x, shoulder.y, left.x, left.y);
      ctx.quadraticCurveTo(shoulder.x - span.shoulderTrail * MIDPOINT, pointY, shoulder.x, pointY);
      ctx.quadraticCurveTo(shoulder.x + span.shoulderLead * MIDPOINT, pointY, right.x, right.y);
      ctx.quadraticCurveTo(right.x, shoulder.y, neck.x + span.shoulderLead * MIDPOINT, neck.y);
    }
    ctx.closePath();
  };
  fillOutlined(ctx, outline, cloth.mid, BODY_OUTLINE_WIDTH);
  ctx.save();
  outline();
  ctx.clip();
  ctx.globalAlpha = SHAWL_FRINGE_ALPHA;
  ctx.strokeStyle = cloth.dark;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(shoulder.x - span.shoulderTrail * spread * 2, shoulder.y + drop);
  ctx.lineTo(shoulder.x + span.shoulderLead * spread * 2, shoulder.y + drop);
  ctx.stroke();
  ctx.restore();
}

export function shawl({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return { name: 'shawl', front: (frame) => paintShoulderDrape(frame, cloth, SHAWL_DROP, true) };
}

const MANTLE_DROP = 0.3;
/** How much deeper a capelet's hem hangs at the middle than at the shoulders. */
const CAPELET_HEM_ROUNDING = 1.2;
/** Wider than a shawl: a capelet stands off the shoulders rather than hugging them. */
const MANTLE_SPREAD = 1.6;

/** A healer's mantle: a pale capelet over both shoulders. */
export function mantle({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'mantle',
    front: (frame) => paintShoulderDrape(frame, cloth, MANTLE_DROP, false, MANTLE_SPREAD),
  };
}

const CLOAK_DROP = 0.62;
const CLOAK_SPREAD = 2;
const CLOAK_SWAY = 0.09;
const CLOAK_CAPELET_DROP = 0.16;
const CLASP_R = 0.024;

export interface CloakOptions {
  readonly cloth: Ramp;
  readonly clasp: string;
}

/**
 * A long cloak. Seen head-on or edge-on it hangs behind him and shows past his
 * body on both sides; from behind it covers his back from shoulder to knee.
 */
export function cloak({ cloth, clasp }: CloakOptions): GarmentLayer {
  const paintFall = (frame: GarmentFrame): void => {
    const { ctx, skeleton, span } = frame;
    const { shoulder, hip } = skeleton;
    const sway = frame.pose.hemSway * CLOAK_SWAY;
    const hemY = hip.y + CLOAK_DROP;
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        if (frame.view === 'side') {
          ctx.moveTo(shoulder.x + span.shoulderLead * MIDPOINT, shoulder.y - CLASP_R);
          ctx.quadraticCurveTo(
            shoulder.x - span.shoulderTrail * CLOAK_SPREAD,
            shoulder.y,
            hip.x - span.hipTrail * CLOAK_SPREAD - sway,
            hemY,
          );
          ctx.lineTo(hip.x + span.hipLead * MIDPOINT - sway, hemY);
          ctx.lineTo(shoulder.x + span.shoulderLead * MIDPOINT, shoulder.y);
        } else {
          ctx.moveTo(shoulder.x - span.shoulderTrail, shoulder.y - CLASP_R);
          ctx.lineTo(shoulder.x + span.shoulderLead, shoulder.y - CLASP_R);
          ctx.quadraticCurveTo(
            shoulder.x + span.shoulderLead * CLOAK_SPREAD,
            hip.y,
            hip.x + span.hipLead * CLOAK_SPREAD + sway,
            hemY,
          );
          ctx.lineTo(hip.x - span.hipTrail * CLOAK_SPREAD + sway, hemY);
          ctx.quadraticCurveTo(
            shoulder.x - span.shoulderTrail * CLOAK_SPREAD,
            hip.y,
            shoulder.x - span.shoulderTrail,
            shoulder.y - CLASP_R,
          );
        }
        ctx.closePath();
      },
      frame.view === 'away' ? cloth.mid : cloth.dark,
      BODY_OUTLINE_WIDTH,
    );
    if (frame.view !== 'away') return;
    ctx.save();
    ctx.globalAlpha = BODY_SHADE_ALPHA;
    ctx.strokeStyle = cloth.dark;
    ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(shoulder.x + span.shoulderLead * MIDPOINT * side, shoulder.y);
      ctx.lineTo(hip.x + span.hipLead * CLOAK_SPREAD * MIDPOINT * side + sway, hemY);
      ctx.stroke();
    }
    ctx.restore();
  };
  return {
    name: 'cloak',
    back: (frame) => {
      if (frame.view !== 'away') paintFall(frame);
    },
    front: (frame) => {
      // From behind the cloak is the outermost thing on him, over the jack
      // and over arms that are already tucked behind his back.
      if (frame.view === 'away') {
        paintFall(frame);
        return;
      }
      paintShoulderDrape(frame, cloth, CLOAK_CAPELET_DROP, false);
      const { ctx, skeleton } = frame;
      const claspAt = frame.view === 'side' ? skeleton.neck : skeleton.shoulder;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(claspAt.x, claspAt.y, CLASP_R, 0, TWO_PI);
        },
        clasp,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

const YOKE_HALF = 0.46;
const YOKE_WIDTH = 0.026;
const YOKE_ROPE = 0.46;
const YOKE_PROFILE_REACH = 0.3;
const YOKE_BUCKET_HALF = 0.07;
const YOKE_BUCKET_HEIGHT = 0.11;
/** How much narrower a bucket's base is than its mouth. */
const YOKE_BUCKET_TAPER = 0.62;

export interface YokeOptions {
  readonly wood: Ramp;
  readonly bucket: Ramp;
  readonly water: string;
}

/**
 * A carrying yoke across the shoulders with a bucket on each end — the widest
 * thing on anyone in the village, which is the point.
 */
export function bucketYoke({ wood, bucket, water }: YokeOptions): GarmentLayer {
  const paintBucket = (ctx: Ctx, hook: Pt): void => {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
    const top = offset(hook, 0, YOKE_ROPE);
    ctx.beginPath();
    ctx.moveTo(hook.x, hook.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    fillOutlined(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(top.x - YOKE_BUCKET_HALF, top.y);
        ctx.lineTo(top.x + YOKE_BUCKET_HALF, top.y);
        ctx.lineTo(top.x + YOKE_BUCKET_HALF * YOKE_BUCKET_TAPER, top.y + YOKE_BUCKET_HEIGHT);
        ctx.lineTo(top.x - YOKE_BUCKET_HALF * YOKE_BUCKET_TAPER, top.y + YOKE_BUCKET_HEIGHT);
        ctx.closePath();
      },
      bucket.mid,
      DETAIL_OUTLINE_WIDTH,
    );
    ctx.fillStyle = water;
    ctx.fillRect(top.x - YOKE_BUCKET_HALF, top.y, YOKE_BUCKET_HALF * 2, DETAIL_OUTLINE_WIDTH * 2);
  };
  return {
    name: 'bucket yoke',
    front: (frame) => {
      const { ctx, skeleton } = frame;
      const { shoulder } = skeleton;
      const swing = frame.pose.hemSway * TUNIC_HEM.sway;
      const reach = frame.view === 'side' ? YOKE_PROFILE_REACH : YOKE_HALF;
      const left = pt(shoulder.x - reach, shoulder.y);
      const right = pt(shoulder.x + reach, shoulder.y);
      paintBucket(ctx, offset(left, swing, 0));
      paintBucket(ctx, offset(right, swing, 0));
      outlineCapsule(ctx, left, right, YOKE_WIDTH, YOKE_WIDTH);
      fillCapsule(ctx, left, right, YOKE_WIDTH, YOKE_WIDTH, wood.mid);
      sheenSegment(ctx, left, right, YOKE_WIDTH, wood.light, SHEEN_ALPHA);
    },
  };
}

// ── Arms and paws ────────────────────────────────────────────────────────────

const GLOVE_CUFF_LENGTH = 0.07;
const GLOVE_CUFF_BULK = 0.022;

/** Heavy work gloves: dark paws and a flared cuff. */
export function gloves({ leather }: { readonly leather: Ramp }): GarmentLayer {
  return {
    name: 'gloves',
    pawTint: leather,
    arm: (frame, arm) => {
      const { ctx } = frame;
      const widths = ratkinArmWidths(arm.widthScale);
      const { chain } = arm;
      const length = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
      const back = length === 0 ? 0 : GLOVE_CUFF_LENGTH / length;
      const cuffStart = mixPt(chain.end, chain.joint, back);
      const width = widths.tip + GLOVE_CUFF_BULK;
      outlineCapsule(ctx, cuffStart, chain.end, width, width);
      fillCapsule(ctx, cuffStart, chain.end, width, width, mix(leather.mid, OUTLINE, arm.shade));
    },
  };
}

const CUSHION_R = 0.04;
const PIN_R = 0.008;
const PIN_OFFSETS: readonly Pt[] = [
  { x: -0.018, y: -0.016 },
  { x: 0.014, y: -0.02 },
  { x: 0.002, y: 0.012 },
];

/** A pincushion worn on the left wrist. */
export function pincushion({
  cloth,
  pin,
}: {
  readonly cloth: Ramp;
  readonly pin: string;
}): GarmentLayer {
  return {
    name: 'pincushion',
    arm: (frame, arm) => {
      if (arm.right) return;
      const { ctx } = frame;
      const wrist = mixPt(arm.chain.joint, arm.chain.end, LONG_SLEEVE_END);
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(wrist.x, wrist.y, CUSHION_R, 0, TWO_PI);
        },
        mix(cloth.mid, OUTLINE, arm.shade),
        DETAIL_OUTLINE_WIDTH,
      );
      ctx.fillStyle = pin;
      for (const at of PIN_OFFSETS) {
        ctx.beginPath();
        ctx.arc(wrist.x + at.x, wrist.y + at.y, PIN_R, 0, TWO_PI);
        ctx.fill();
      }
    },
  };
}

// ── Head ─────────────────────────────────────────────────────────────────────

const BRIM_HALF = 0.3;
const BRIM_THICKNESS = 0.045;
const STRAW_CROWN_HALF = 0.12;
const STRAW_CROWN_HEIGHT = 0.12;
const HAT_SEAT = 0.72;
const HAT_BAND = 0.028;
const PROFILE_BRIM_BACK = 0.04;

/** Where a hat sits: its seat on the skull, in head space. */
function hatSeatY(frame: GarmentFrame): number {
  return -frame.head.skullHalfHeight * HAT_SEAT;
}

/** A crown and brim — the shape every hat here is a variation of. */
function paintBrimmedHat(
  frame: GarmentFrame,
  brimHalf: number,
  crownHalf: number,
  crownHeight: number,
  domed: boolean,
  body: Ramp,
  band: string | null,
): void {
  const { ctx } = frame;
  const seat = hatSeatY(frame);
  const brimCentreX = frame.view === 'side' ? -PROFILE_BRIM_BACK : 0;
  const brimRy = frame.view === 'side' ? BRIM_THICKNESS * MIDPOINT : BRIM_THICKNESS;
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(brimCentreX, seat, brimHalf, brimRy, 0, 0, TWO_PI);
    },
    body.dark,
    DETAIL_OUTLINE_WIDTH,
  );
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      if (domed) {
        ctx.ellipse(brimCentreX, seat, crownHalf, crownHeight, 0, Math.PI, TWO_PI);
        ctx.closePath();
      } else {
        traceRoundRect(
          ctx,
          brimCentreX - crownHalf,
          seat - crownHeight,
          crownHalf * 2,
          crownHeight,
          crownHalf * POUCH_ROUND,
        );
      }
    },
    body.mid,
    DETAIL_OUTLINE_WIDTH,
  );
  if (band !== null) {
    ctx.fillStyle = band;
    ctx.fillRect(brimCentreX - crownHalf, seat - HAT_BAND * 2, crownHalf * 2, HAT_BAND);
  }
  ctx.save();
  ctx.globalAlpha = SHEEN_ALPHA;
  ctx.fillStyle = body.light;
  ctx.beginPath();
  ctx.ellipse(
    brimCentreX,
    seat - BRIM_THICKNESS * MIDPOINT,
    brimHalf * STRAP_AT,
    brimRy * MIDPOINT,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

export function strawHat({
  straw,
  band,
}: {
  readonly straw: Ramp;
  readonly band: string;
}): GarmentLayer {
  return {
    name: 'straw hat',
    head: (frame) =>
      paintBrimmedHat(frame, BRIM_HALF, STRAW_CROWN_HALF, STRAW_CROWN_HEIGHT, false, straw, band),
  };
}

const KETTLE_BRIM_HALF = 0.235;
const KETTLE_CROWN_HALF = 0.15;
const KETTLE_CROWN_HEIGHT = 0.15;

/** A militia kettle hat: a steel dome with a broad brim. */
export function kettleHat({ steel }: { readonly steel: Ramp }): GarmentLayer {
  return {
    name: 'kettle hat',
    head: (frame) =>
      paintBrimmedHat(
        frame,
        KETTLE_BRIM_HALF,
        KETTLE_CROWN_HALF,
        KETTLE_CROWN_HEIGHT,
        true,
        steel,
        null,
      ),
  };
}

const CAP_DOME_SHARE = 1.06;
const CAP_DOME_HEIGHT = 0.1;
const CAP_BILL_REACH = 0.12;
const CAP_BILL_THICKNESS = 0.022;
const CAP_BILL_HALF = 0.09;

/** A close cap with a short bill. */
export function cap({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'cap',
    head: (frame) => {
      const { ctx } = frame;
      const seat = hatSeatY(frame);
      const halfWidth = frame.head.skullHalfWidth * CAP_DOME_SHARE;
      if (frame.view === 'side') {
        const billTip = pt(halfWidth + CAP_BILL_REACH * MIDPOINT, seat + CAP_BILL_THICKNESS);
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(0, seat);
            ctx.lineTo(billTip.x, billTip.y);
            ctx.lineTo(billTip.x, billTip.y + CAP_BILL_THICKNESS);
            ctx.lineTo(0, seat + CAP_BILL_THICKNESS);
            ctx.closePath();
          },
          cloth.dark,
          DETAIL_OUTLINE_WIDTH,
        );
      } else if (frame.view === 'front') {
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.ellipse(
              0,
              seat + CAP_BILL_THICKNESS,
              CAP_BILL_HALF,
              CAP_BILL_THICKNESS,
              0,
              0,
              TWO_PI,
            );
          },
          cloth.dark,
          DETAIL_OUTLINE_WIDTH,
        );
      }
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(0, seat, halfWidth, CAP_DOME_HEIGHT, 0, Math.PI, TWO_PI);
          ctx.closePath();
        },
        cloth.mid,
        DETAIL_OUTLINE_WIDTH,
      );
    },
  };
}

/**
 * Narrower than the skull, so fur shows between the scarf and each ear: a scarf
 * that fills the gap joins the two ears into one heart-shaped blob.
 */
const SCARF_DOME_SHARE = 0.9;
const SCARF_DOME_HEIGHT = 1.08;
/** Where the scarf's edge crosses the brow: above the eyes, which must stay visible. */
const SCARF_DOME_FLOOR = 0.52;
/** Edge-on the scarf sits back on the skull, off the brow. */
const SCARF_PROFILE_BACK = 0.3;
const SCARF_TAIL = 0.05;
const SCARF_NAPE_KNOT = 0.55;
const SCARF_TAIL_WIDTH = 0.025;

export interface HeadscarfOptions {
  readonly cloth: Ramp;
  /** Knotted under the chin (a headscarf) or behind the head (a bandana). */
  readonly tie: 'chin' | 'nape';
}

/** A scarf tied over the crown; the ears stay out either side of it. */
export function headscarf({ cloth, tie }: HeadscarfOptions): GarmentLayer {
  return {
    name: 'headscarf',
    head: (frame) => {
      const { ctx, head } = frame;
      const halfWidth = head.skullHalfWidth * SCARF_DOME_SHARE;
      const top = -head.skullHalfHeight * SCARF_DOME_HEIGHT;
      const floor = -head.skullHalfHeight * SCARF_DOME_FLOOR;
      const centreX = frame.view === 'side' ? -head.skullHalfWidth * SCARF_PROFILE_BACK : 0;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(centreX - halfWidth, floor);
          ctx.quadraticCurveTo(centreX - halfWidth, top, centreX, top);
          ctx.quadraticCurveTo(centreX + halfWidth, top, centreX + halfWidth, floor);
          ctx.closePath();
        },
        cloth.mid,
        DETAIL_OUTLINE_WIDTH,
      );
      const knotAtBack = tie === 'nape' || frame.view === 'side';
      if (frame.view === 'front' && !knotAtBack) {
        for (const side of [-1, 1]) {
          const from = pt(halfWidth * side, floor);
          const to = pt(head.skullHalfWidth * MIDPOINT * side, head.skullHalfHeight);
          outlineCapsule(ctx, from, to, SCARF_TAIL_WIDTH, SCARF_TAIL_WIDTH);
          fillCapsule(ctx, from, to, SCARF_TAIL_WIDTH, SCARF_TAIL_WIDTH, cloth.mid);
        }
        return;
      }
      if (frame.view === 'front') return;
      // From behind the knot sits low at the nape, clear of the gap between the ears.
      const knot =
        frame.view === 'side'
          ? pt(centreX - halfWidth, floor)
          : pt(0, head.skullHalfHeight * SCARF_NAPE_KNOT);
      const tail = offset(knot, frame.view === 'side' ? -SCARF_TAIL * MIDPOINT : 0, SCARF_TAIL);
      outlineCapsule(ctx, knot, tail, SCARF_TAIL_WIDTH * 2, SCARF_TAIL_WIDTH);
      fillCapsule(ctx, knot, tail, SCARF_TAIL_WIDTH * 2, SCARF_TAIL_WIDTH, cloth.mid);
    },
  };
}

const HOOD_SPREAD = 1.4;
const HOOD_PEAK = 1.7;
const HOOD_NAPE = 1.15;
const HOOD_EAR_BUMP = 0.5;

/**
 * A hood pulled up. It covers the ears, so it keeps two soft bumps where they
 * push the cloth up — a hooded ratkin with a smooth hood reads as a person.
 */
export function hood({ cloth }: { readonly cloth: Ramp }): GarmentLayer {
  return {
    name: 'hood',
    head: (frame) => {
      const { ctx, head } = frame;
      const rx = head.skullHalfWidth;
      const ry = head.skullHalfHeight;
      const bump = head.earRadius * HOOD_EAR_BUMP;
      fillOutlined(
        ctx,
        () => {
          ctx.beginPath();
          if (frame.view === 'side') {
            ctx.moveTo(rx * MIDPOINT, -ry * HOOD_SPREAD * MIDPOINT);
            ctx.quadraticCurveTo(rx * MIDPOINT, -ry * HOOD_PEAK, -rx * MIDPOINT, -ry * HOOD_PEAK);
            ctx.arc(head.ear.x, head.ear.y, bump, -Math.PI, 0);
            ctx.quadraticCurveTo(-rx * HOOD_SPREAD, -ry, -rx * HOOD_SPREAD, ry * HOOD_NAPE);
            ctx.lineTo(0, ry * HOOD_NAPE);
            ctx.quadraticCurveTo(rx * MIDPOINT, 0, rx * MIDPOINT, -ry * HOOD_SPREAD * MIDPOINT);
          } else {
            ctx.moveTo(-rx * HOOD_SPREAD, ry * HOOD_NAPE);
            ctx.quadraticCurveTo(-rx * HOOD_SPREAD, -ry * HOOD_PEAK, 0, -ry * HOOD_PEAK);
            ctx.quadraticCurveTo(
              rx * HOOD_SPREAD,
              -ry * HOOD_PEAK,
              rx * HOOD_SPREAD,
              ry * HOOD_NAPE,
            );
            if (frame.view === 'front') {
              // The face opening: the hood frames the muzzle rather than covering it.
              ctx.lineTo(rx * MIDPOINT, ry * HOOD_NAPE);
              ctx.quadraticCurveTo(rx, -ry, 0, -ry);
              ctx.quadraticCurveTo(-rx, -ry, -rx * MIDPOINT, ry * HOOD_NAPE);
            }
          }
          ctx.closePath();
        },
        cloth.mid,
        BODY_OUTLINE_WIDTH,
      );
      if (frame.view === 'side') return;
      for (const side of [-1, 1]) {
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.arc(head.ear.x * side, -ry * HOOD_SPREAD, bump, Math.PI, TWO_PI);
            ctx.closePath();
          },
          cloth.mid,
          DETAIL_OUTLINE_WIDTH,
        );
      }
    },
  };
}

const LENS_SCALE = 1.35;
const SPECTACLE_STROKE = 0.011;

export function spectacles({ frame: rim }: { readonly frame: string }): GarmentLayer {
  return {
    name: 'spectacles',
    head: (frame) => {
      if (frame.view === 'away') return;
      const { ctx, head } = frame;
      const r = head.eyeRadius * LENS_SCALE;
      ctx.save();
      ctx.strokeStyle = rim;
      ctx.lineWidth = SPECTACLE_STROKE;
      ctx.beginPath();
      if (frame.view === 'side') {
        ctx.arc(head.eye.x, head.eye.y, r, 0, TWO_PI);
        ctx.moveTo(head.eye.x - r, head.eye.y);
        ctx.lineTo(head.ear.x, head.eye.y);
      } else {
        for (const side of [-1, 1]) {
          ctx.moveTo(head.eye.x * side + r, head.eye.y);
          ctx.arc(head.eye.x * side, head.eye.y, r, 0, TWO_PI);
        }
        ctx.moveTo(-head.eye.x + r, head.eye.y);
        ctx.lineTo(head.eye.x - r, head.eye.y);
      }
      ctx.stroke();
      ctx.restore();
    },
  };
}

const GOGGLE_R = 0.06;
const GOGGLE_RISE = 0.62;
const GOGGLE_STRAP = 0.028;

/** Goggles pushed up on the brow, their strap round the skull. */
export function browGoggles({
  strap,
  lens,
  rim,
}: {
  readonly strap: Ramp;
  readonly lens: string;
  readonly rim: string;
}): GarmentLayer {
  return {
    name: 'brow goggles',
    head: (frame) => {
      const { ctx, head } = frame;
      const y = -head.skullHalfHeight * GOGGLE_RISE;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = GOGGLE_STRAP + DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(-head.skullHalfWidth, y);
      ctx.lineTo(head.skullHalfWidth, y);
      ctx.stroke();
      ctx.strokeStyle = strap.mid;
      ctx.lineWidth = GOGGLE_STRAP;
      ctx.stroke();
      ctx.restore();
      if (frame.view === 'away') return;
      const lenses = frame.view === 'side' ? [head.eye.x] : [-head.eye.x, head.eye.x];
      for (const x of lenses) {
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.arc(x, y, GOGGLE_R, 0, TWO_PI);
          },
          rim,
          DETAIL_OUTLINE_WIDTH,
        );
        ctx.beginPath();
        ctx.arc(x, y, GOGGLE_R * STRAP_AT, 0, TWO_PI);
        ctx.fillStyle = lens;
        ctx.fill();
      }
    },
  };
}

const PENCIL_LENGTH = 0.13;
const PENCIL_WIDTH = 0.012;

/** A pencil tucked behind the right ear. */
export function pencilBehindEar({ wood }: { readonly wood: string }): GarmentLayer {
  return {
    name: 'pencil',
    head: (frame) => {
      const { ctx, head } = frame;
      const earX = frame.view === 'side' ? head.ear.x : head.ear.x * frame.rightSide;
      const root = pt(earX, head.ear.y + head.earRadius);
      const tip = offset(
        root,
        PENCIL_LENGTH * MIDPOINT * (frame.view === 'side' ? 1 : frame.rightSide),
        -PENCIL_LENGTH * MIDPOINT,
      );
      outlineCapsule(ctx, root, tip, PENCIL_WIDTH, PENCIL_WIDTH);
      fillCapsule(ctx, root, tip, PENCIL_WIDTH, PENCIL_WIDTH, wood);
    },
  };
}

// ── Fur marks ────────────────────────────────────────────────────────────────

const EAR_NOTCH_R = 0.03;
const EAR_NOTCH_AT = 0.85;

/**
 * A notch torn out of the left ear. Cut rather than painted: the ear is the
 * topmost ink on the head, so the notch shows as a bite out of the silhouette.
 */
export function notchedEar(): GarmentLayer {
  return {
    name: 'notched ear',
    head: (frame) => {
      const { ctx, head } = frame;
      const side = frame.view === 'side' ? 1 : -frame.rightSide;
      const notch = pt(
        head.ear.x * side + head.earRadius * EAR_NOTCH_AT * side * MIDPOINT,
        head.ear.y - head.earRadius * EAR_NOTCH_AT,
      );
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(notch.x, notch.y, EAR_NOTCH_R, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    },
  };
}

const SCAR_LENGTH = 0.07;
const SCAR_WIDTH = 0.01;

/** A pale scar through the whiskers, on the left cheek. */
export function whiskerScar({ colour }: { readonly colour: string }): GarmentLayer {
  return {
    name: 'whisker scar',
    head: (frame) => {
      if (frame.view === 'away') return;
      const { ctx, head } = frame;
      const centre =
        frame.view === 'side'
          ? mixPt(head.eye, head.nose, MIDPOINT)
          : pt(-head.eye.x * frame.rightSide, head.eye.y + head.eyeRadius * 2);
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = SCAR_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(centre.x - SCAR_LENGTH * MIDPOINT, centre.y - SCAR_LENGTH * MIDPOINT);
      ctx.lineTo(centre.x + SCAR_LENGTH * MIDPOINT, centre.y + SCAR_LENGTH * MIDPOINT);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** Where a speckle layer lands. */
export type SpeckleArea = 'torso' | 'arms' | 'head';

export interface SpeckleOptions {
  readonly colour: string;
  readonly alpha: number;
  /** Dots per area. */
  readonly count: number;
  readonly size: number;
  readonly areas: readonly SpeckleArea[];
  /** Picks this layer's own scatter, so two speckled characters differ. */
  readonly seed: number;
}

/** A fixed, frame-independent scatter in the unit square. */
function scatter(seed: number, index: number): Pt {
  const hash = (n: number): number => {
    const s = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  return { x: hash(index * 2 + 1), y: hash(index * 2 + 2) };
}

const SPECKLE_TORSO_SHARE = 0.8;

/**
 * Flour, soot, sawdust, singes or mottling: dots scattered over the body at
 * fixed places relative to the skeleton, so they ride with him frame to frame
 * instead of crawling over his fur.
 */
export function speckle({ colour, alpha, count, size, areas, seed }: SpeckleOptions): GarmentLayer {
  const dot = (ctx: Ctx, at: Pt): void => {
    ctx.beginPath();
    ctx.arc(at.x, at.y, size, 0, TWO_PI);
    ctx.fill();
  };
  return {
    name: 'speckle',
    torso: (frame) => {
      if (!areas.includes('torso')) return;
      const { ctx, skeleton, span } = frame;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colour;
      for (let i = 0; i < count; i++) {
        const u = scatter(seed, i);
        const y = lerp(skeleton.shoulder.y, skeleton.hip.y, u.y);
        const x = lerp(
          skeleton.chest.x - span.chestTrail * SPECKLE_TORSO_SHARE,
          skeleton.chest.x + span.chestLead * SPECKLE_TORSO_SHARE,
          u.x,
        );
        dot(ctx, pt(x, y));
      }
      ctx.restore();
    },
    arm: (frame, arm) => {
      if (!areas.includes('arms')) return;
      const { ctx } = frame;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = mix(colour, OUTLINE, arm.shade);
      for (let i = 0; i < count; i++) {
        const u = scatter(seed + 1, i);
        const along =
          u.x < MIDPOINT
            ? mixPt(arm.chain.root, arm.chain.joint, u.y)
            : mixPt(arm.chain.joint, arm.chain.end, u.y);
        dot(ctx, along);
      }
      ctx.restore();
    },
    head: (frame) => {
      if (!areas.includes('head')) return;
      const { ctx, head } = frame;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colour;
      for (let i = 0; i < count; i++) {
        const u = scatter(seed + 2, i);
        dot(
          ctx,
          pt(
            lerp(-head.skullHalfWidth, head.skullHalfWidth, u.x) * SPECKLE_TORSO_SHARE,
            lerp(-head.skullHalfHeight, head.skullHalfHeight, u.y) * SPECKLE_TORSO_SHARE,
          ),
        );
      }
      ctx.restore();
    },
  };
}

const PATCH_SIZE = 0.08;
const PATCH_SPOTS: readonly Pt[] = [
  { x: 0.45, y: 0.3 },
  { x: -0.4, y: 0.72 },
];
const STITCH_DASH = 0.012;

/** Square patches sewn over a worn garment, with their stitching showing. */
export function patches({
  cloth,
  thread,
}: {
  readonly cloth: Ramp;
  readonly thread: string;
}): GarmentLayer {
  return {
    name: 'patches',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      for (const spot of PATCH_SPOTS) {
        const reach = spot.x > 0 ? span.chestLead : span.chestTrail;
        const x = skeleton.chest.x + reach * spot.x;
        const y = lerp(skeleton.shoulder.y, skeleton.hip.y + TUNIC_HEM.drop, spot.y);
        ctx.fillStyle = cloth.mid;
        ctx.fillRect(x - PATCH_SIZE * MIDPOINT, y - PATCH_SIZE * MIDPOINT, PATCH_SIZE, PATCH_SIZE);
        ctx.save();
        ctx.setLineDash([STITCH_DASH, STITCH_DASH]);
        ctx.strokeStyle = thread;
        ctx.lineWidth = DETAIL_OUTLINE_WIDTH * MIDPOINT;
        ctx.strokeRect(
          x - PATCH_SIZE * MIDPOINT,
          y - PATCH_SIZE * MIDPOINT,
          PATCH_SIZE,
          PATCH_SIZE,
        );
        ctx.restore();
      }
    },
  };
}
