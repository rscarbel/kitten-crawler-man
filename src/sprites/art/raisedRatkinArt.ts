/**
 * The raised dead of Briar Hollow: the village's own ratkin, called back up by
 * the necromancer. The looks only — the rows live in `raisedRatkinFigure.ts`.
 *
 * They are painted on the shared ratkin rig, so the only way to make one is an
 * outfit: a rot palette, three garments people were buried or fell in, and a
 * handful of layers that say *dead* rather than *dressed*:
 *
 * - grey-green fur with bare patches of dead skin on the limbs and skull;
 * - a tear in the flank that shows the ribs, in profile;
 * - blue eye-points — the necromancer's light, the same colour as his lantern;
 * - torn hems hanging in strips.
 *
 * None of these alone keeps a raised ratkin from reading as a villager at a 32
 * px tile; the hunch and the dragging foot in the rows do most of that. These
 * carry it once the player looks.
 */

import { deg, lerp, mix, type Pt } from './carlArt';
import type { GarmentLayer, HemShape, RatkinOutfit } from './ratkin/outfit';
import { hood, notchedEar, paddedJack, robe, smock, speckle } from './ratkin/garments';
import {
  BODY_OUTLINE_WIDTH,
  DETAIL_OUTLINE_WIDTH,
  MIDPOINT,
  OUTLINE,
  type Ramp,
  TWO_PI,
  fillCapsule,
  fillOutlined,
  mixPt,
  offset,
  outlineCapsule,
  pt,
  rotate,
} from './ratkin/paint';
import { hollowSoulPalette } from '../soulPalette';

type Ctx = CanvasRenderingContext2D;

/** The three looks the dead come back in. */
export type RaisedRatkinLook = 'smock' | 'jack' | 'shroud';

export const RAISED_RATKIN_LOOKS: readonly RaisedRatkinLook[] = ['smock', 'jack', 'shroud'];

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Grey-green, the colour a rat goes in the ground. Every living villager's fur
 * is a brown, a grey or a ginger; nothing alive in the village is this.
 */
const ROT_FUR: Ramp = { dark: '#2c362b', mid: '#56624e', light: '#7c8a70' };
const ROT_BELLY: Ramp = { dark: '#5a6452', mid: '#838c76', light: '#a3ab93' };
/** Dead skin where the fur has come away: bloodless, faintly green. */
const DEAD_SKIN: Ramp = { dark: '#5d6056', mid: '#8b8e80', light: '#aeb09f' };
const DEAD_TAIL: Ramp = { dark: '#4f5047', mid: '#76776a', light: '#96978a' };
/** The eye bead itself; the glow round it is a head layer. */
const DEAD_EYE = '#cfe6ff';
const BONE = '#ddd3b6';
const CAVITY = '#140f0c';
const GRAVE_DIRT = '#2b2218';

/**
 * The farmer's smock, faded to the grey of the field he was buried by. Kept
 * off the warm browns living villagers wear, so the brown-clad dead do not
 * lean on their eye-light alone.
 */
const SMOCK_CLOTH: Ramp = { dark: '#45443a', mid: '#6d6a56', light: '#8b8870' };
/** A militia jack gone to mould, and its rotten leather gorget. */
const JACK_CLOTH: Ramp = { dark: '#2e3438', mid: '#4d575a', light: '#687476' };
const JACK_GORGET: Ramp = { dark: '#2e2419', mid: '#4f3f2c', light: '#6c5a40' };
/**
 * Grave linen, gone the grey-green of the ground it lay in: no living
 * villager's clothes are this colour, where a clean grey cloak would be.
 */
const SHROUD_CLOTH: Ramp = { dark: '#565c49', mid: '#7e846c', light: '#9da388' };
const SHROUD_CORD = '#4c4535';
const SPEAR_WOOD: Ramp = { dark: '#3d2d1c', mid: '#6a5238', light: '#8a7050' };

// ── Rot ──────────────────────────────────────────────────────────────────────

/** Where along a limb's two segments the bare patches sit, per limb kind. */
const LIMB_PATCHES: readonly { readonly along: number; readonly size: number }[] = [
  { along: 0.35, size: 0.034 },
  { along: 1.45, size: 0.028 },
];
/** A bald patch on the skull, in head-local units. */
const SKULL_PATCH: Pt = { x: 0.03, y: -0.05 };
const SKULL_PATCH_SIZE = 0.045;

/**
 * A bare patch as fractions of its size: a tilted oval of skin, with a darker
 * sore set low and forward in it so the patch reads as broken hide, not a spot.
 */
const BARE_PATCH = {
  aspect: 0.7,
  tiltDeg: 20,
  soreOffsetX: 0.3,
  soreOffsetY: 0.2,
  soreRadiusX: 0.45,
  soreRadiusY: 0.3,
} as const;

function limbPoint(root: Pt, joint: Pt, end: Pt, along: number): Pt {
  return along <= 1 ? mixPt(root, joint, along) : mixPt(joint, end, along - 1);
}

function barePatch(ctx: Ctx, at: Pt, size: number, shade: number): void {
  ctx.fillStyle = mix(DEAD_SKIN.mid, OUTLINE, shade);
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, size, size * BARE_PATCH.aspect, deg(BARE_PATCH.tiltDeg), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = mix(DEAD_SKIN.dark, OUTLINE, shade);
  ctx.beginPath();
  ctx.ellipse(
    at.x + size * BARE_PATCH.soreOffsetX,
    at.y + size * BARE_PATCH.soreOffsetY,
    size * BARE_PATCH.soreRadiusX,
    size * BARE_PATCH.soreRadiusY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/** Mange: bare dead skin showing through the fur on the limbs and the crown. */
function rotPatches(): GarmentLayer {
  return {
    name: 'rot patches',
    arm: (frame, arm) => {
      const { root, joint, end } = arm.chain;
      const spot = LIMB_PATCHES[arm.right ? 0 : 1];
      barePatch(frame.ctx, limbPoint(root, joint, end, spot.along), spot.size, arm.shade);
    },
    leg: (frame, leg) => {
      const { root, joint, end } = leg.chain;
      const spot = LIMB_PATCHES[leg.near ? 1 : 0];
      barePatch(frame.ctx, limbPoint(root, joint, end, spot.along), spot.size, leg.shade);
    },
    head: (frame) => {
      if (frame.view === 'away') {
        barePatch(frame.ctx, pt(-SKULL_PATCH.x, SKULL_PATCH.y), SKULL_PATCH_SIZE, 0);
        return;
      }
      barePatch(frame.ctx, SKULL_PATCH, SKULL_PATCH_SIZE, 0);
    },
  };
}

/** The flank tear, as fractions of the torso's reach and its height from chest to waist. */
const RIB_TEAR_ACROSS = 0.35;
const RIB_TEAR_HALF_WIDTH = 0.1;
const RIB_TEAR_HALF_HEIGHT = 0.115;
const RIB_COUNT = 4;
const RIB_WIDTH = 0.014;
/** Head-on the wound is smaller, off to one side, and shows two ribs. */
const FACING_TEAR_SCALE = 0.75;
const FACING_RIBS = 2;
/** From behind the tear is between the shoulder blades, over the spine. */
const BACK_TEAR_SCALE = 1.05;
const SPINE_KNOBS = 4;
/** Head-on the tear sits further off the breastbone than in profile, so it lands on one side of the chest. */
const FACING_TEAR_OFF_CENTRE = 1.4;
/** Ragged, not an oval: a hole with a smooth edge reads as a pocket. */
const TEAR_EDGE_POINTS = 9;
/** Every other edge point is pulled in this far, which is what makes the edge ragged. */
const TEAR_NOTCH_DEPTH = 0.72;

/** Alpha of the wound's inner light at its centre, midway and at its rim. */
const WOUND_GLOW = {
  coreAlpha: 0.95,
  midStop: 0.45,
  midAlpha: 0.75,
  rimAlpha: 0.1,
} as const;
/** The glow is filled over a square twice the tear's radius each way; the clip trims it to the tear. */
const WOUND_GLOW_FILL_REACH = 2;
const WOUND_GLOW_FILL_SPAN = 4;

/** The spine knobs, in tear radii: the column's half-length and its full length, and each knob's size. */
const SPINE_COLUMN = {
  halfLength: 0.8,
  length: 1.6,
  knobRadiusX: 0.28,
  knobRadiusY: 0.12,
} as const;

/**
 * The rib arcs, in tear radii. Each runs past the tear's edge so the clip cuts
 * it rather than it stopping short, and sags down in the middle and rises
 * higher at the front than the back, the way ribs curve round a chest.
 */
const RIB_ARC = {
  stackHalfHeight: 0.7,
  stackHeight: 1.4,
  overhang: 1.1,
  backRise: 0.25,
  sag: 0.2,
  frontRise: 0.3,
} as const;

/**
 * A tear through the clothes and the hide over the ribs, lit blue from inside,
 * with pale rib arcs across it. In profile it opens on the flank and is the
 * thing the eye finds first; head-on it is a smaller wound on one side of the
 * chest; from behind it is over the spine.
 */
function exposedRibs(): GarmentLayer {
  return {
    name: 'exposed ribs',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const profile = frame.view === 'side';
      const away = frame.view === 'away';
      const scale = profile ? 1 : away ? BACK_TEAR_SCALE : FACING_TEAR_SCALE;
      const across = profile
        ? skeleton.chest.x - span.chestTrail * RIB_TEAR_ACROSS
        : away
          ? skeleton.chest.x
          : skeleton.chest.x -
            span.chestTrail * RIB_TEAR_ACROSS * FACING_TEAR_OFF_CENTRE * frame.rightSide;
      const centre = pt(across, lerp(skeleton.chest.y, skeleton.waist.y, MIDPOINT));
      const rx = RIB_TEAR_HALF_WIDTH * scale;
      const ry = RIB_TEAR_HALF_HEIGHT * scale;
      const tear = (): void => {
        ctx.beginPath();
        const points = TEAR_EDGE_POINTS;
        for (let i = 0; i <= points; i++) {
          const a = (i / points) * TWO_PI;
          const jag = i % 2 === 0 ? 1 : TEAR_NOTCH_DEPTH;
          const p = pt(centre.x + Math.cos(a) * rx * jag, centre.y + Math.sin(a) * ry * jag);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      };
      fillOutlined(ctx, tear, CAVITY, DETAIL_OUTLINE_WIDTH);
      ctx.save();
      tear();
      ctx.clip();
      // The necromancer's light burns inside the wound, so a raised ratkin
      // carries its blue from every side — from behind, where the eyes cannot
      // be seen, this is the one mark of it.
      const { core, mid } = hollowSoulPalette;
      const glow = ctx.createRadialGradient(
        centre.x,
        centre.y,
        0,
        centre.x,
        centre.y,
        Math.max(rx, ry),
      );
      glow.addColorStop(0, `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${WOUND_GLOW.coreAlpha})`);
      glow.addColorStop(
        WOUND_GLOW.midStop,
        `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, ${WOUND_GLOW.midAlpha})`,
      );
      glow.addColorStop(1, `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, ${WOUND_GLOW.rimAlpha})`);
      ctx.fillStyle = glow;
      ctx.fillRect(
        centre.x - rx * WOUND_GLOW_FILL_REACH,
        centre.y - ry * WOUND_GLOW_FILL_REACH,
        rx * WOUND_GLOW_FILL_SPAN,
        ry * WOUND_GLOW_FILL_SPAN,
      );
      if (away) {
        ctx.fillStyle = BONE;
        for (let i = 0; i < SPINE_KNOBS; i++) {
          const y =
            centre.y -
            ry * SPINE_COLUMN.halfLength +
            (i / (SPINE_KNOBS - 1)) * ry * SPINE_COLUMN.length;
          ctx.beginPath();
          ctx.ellipse(
            centre.x,
            y,
            rx * SPINE_COLUMN.knobRadiusX,
            ry * SPINE_COLUMN.knobRadiusY,
            0,
            0,
            TWO_PI,
          );
          ctx.fill();
        }
        ctx.restore();
        return;
      }
      ctx.strokeStyle = BONE;
      ctx.lineWidth = RIB_WIDTH * scale;
      ctx.lineCap = 'round';
      const ribs = profile ? RIB_COUNT : FACING_RIBS;
      for (let i = 0; i < ribs; i++) {
        const y =
          centre.y -
          ry * RIB_ARC.stackHalfHeight +
          (i / Math.max(1, ribs - 1)) * ry * RIB_ARC.stackHeight;
        ctx.beginPath();
        ctx.moveTo(centre.x - rx * RIB_ARC.overhang, y - ry * RIB_ARC.backRise);
        ctx.quadraticCurveTo(
          centre.x,
          y + ry * RIB_ARC.sag,
          centre.x + rx * RIB_ARC.overhang,
          y - ry * RIB_ARC.frontRise,
        );
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/** Big enough that the glow survives the 32 px tile as more than one pixel. */
const EYE_GLOW_RADIUS = 0.085;
const EYE_CORE_RADIUS = 0.03;
/** The eye glow falls off fast past a hot centre and fades out entirely at its rim. */
const EYE_GLOW = {
  coreAlpha: 0.95,
  midStop: 0.35,
  midAlpha: 0.6,
} as const;

function eyeGlow(ctx: Ctx, at: Pt): void {
  const { core, mid, deep } = hollowSoulPalette;
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, EYE_GLOW_RADIUS);
  g.addColorStop(0, `rgba(${core[0]}, ${core[1]}, ${core[2]}, ${EYE_GLOW.coreAlpha})`);
  g.addColorStop(EYE_GLOW.midStop, `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, ${EYE_GLOW.midAlpha})`);
  g.addColorStop(1, `rgba(${deep[0]}, ${deep[1]}, ${deep[2]}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, EYE_GLOW_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = `rgb(${core[0]}, ${core[1]}, ${core[2]})`;
  ctx.beginPath();
  ctx.arc(at.x, at.y, EYE_CORE_RADIUS, 0, TWO_PI);
  ctx.fill();
}

/**
 * The necromancer's light in the dead eyes: a blue point with a soft glow,
 * the brightest thing on the figure. From behind there is nothing to see.
 */
function glowingEyes(): GarmentLayer {
  return {
    name: 'glowing eyes',
    head: (frame) => {
      const { ctx, head } = frame;
      if (frame.view === 'away') return;
      if (frame.view === 'side') {
        eyeGlow(ctx, head.eye);
        return;
      }
      eyeGlow(ctx, head.eye);
      eyeGlow(ctx, pt(-head.eye.x, head.eye.y));
    },
  };
}

/** The strips a torn hem hangs in: position across the hem, and how far each hangs. */
const TATTERS: readonly { readonly across: number; readonly length: number }[] = [
  { across: 0.12, length: 0.1 },
  { across: 0.38, length: 0.06 },
  { across: 0.62, length: 0.12 },
  { across: 0.86, length: 0.07 },
];
const TATTER_WIDTH = 0.045;
/**
 * A strip's shape: its tip swings with a share of the hem's sway so it lags
 * the cloth, and leans a little forward; its root is tucked just above the hem
 * so no gap shows at the seam; and its trailing edge kinks in partway down.
 */
const TATTER_SHAPE = {
  swayFollow: 0.6,
  tipLean: 0.2,
  hemTuck: 0.01,
  kinkInset: 0.1,
  kinkDown: 0.6,
} as const;
/**
 * The rent's kink and its top, measured from where it leaves the hem: it runs
 * forward to the kink, then back behind its own start, so it zigzags like a tear.
 */
const HEM_RENT = {
  kinkForward: 0.02,
  kinkRise: 0.09,
  topBack: 0.01,
  topRise: 0.15,
} as const;

/**
 * Strips of cloth hanging below a torn hem, following the hem's own geometry
 * so they ride with the garment. Drawn over the garment's edge rather than
 * cut from it: cutting would punch holes through the legs painted beneath.
 */
function tatteredHem(hem: HemShape, cloth: Ramp): GarmentLayer {
  return {
    name: 'tattered hem',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const sway = frame.pose.hemSway * hem.sway;
      const trailFlare = frame.view === 'side' ? (hem.profileTrailFlare ?? hem.flare) : hem.flare;
      const hemY = skeleton.hip.y + hem.drop;
      const back = skeleton.hip.x - span.hipTrail * trailFlare + sway;
      const front = skeleton.hip.x + span.hipLead * hem.flare + sway;
      for (const tatter of TATTERS) {
        const x = lerp(back, front, tatter.across);
        const tip = pt(
          x + sway * TATTER_SHAPE.swayFollow + TATTER_WIDTH * TATTER_SHAPE.tipLean,
          hemY + tatter.length,
        );
        fillOutlined(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(x - TATTER_WIDTH * MIDPOINT, hemY - TATTER_SHAPE.hemTuck);
            ctx.lineTo(x + TATTER_WIDTH * MIDPOINT, hemY - TATTER_SHAPE.hemTuck);
            ctx.lineTo(tip.x, tip.y);
            ctx.lineTo(
              x - TATTER_WIDTH * TATTER_SHAPE.kinkInset,
              hemY + tatter.length * TATTER_SHAPE.kinkDown,
            );
            ctx.closePath();
          },
          cloth.dark,
          DETAIL_OUTLINE_WIDTH,
        );
      }
      // A dark rent up from the hem, so the cloth reads as torn and not as cut.
      ctx.save();
      ctx.strokeStyle = CAVITY;
      ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
      ctx.beginPath();
      const rentX = lerp(back, front, 0.5);
      ctx.moveTo(rentX, hemY);
      ctx.lineTo(rentX + HEM_RENT.kinkForward, hemY - HEM_RENT.kinkRise);
      ctx.lineTo(rentX - HEM_RENT.topBack, hemY - HEM_RENT.topRise);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** The broken spear shaft: its length, and how far its splintered end juts past the paw. */
const SHAFT_LENGTH = 0.44;
const SHAFT_WIDTH = 0.026;
const SHAFT_GRIP = 0.35;
const SPLINTERS = 3;
/**
 * Held across the forearm line rather than along it, the way a slack grip lets
 * a pole swing: tipped a fixed angle off the forearm. In profile it tips back;
 * head-on it tips outward, to whichever side the holding arm is on.
 */
const SHAFT_TIP_PROFILE_DEG = -35;
const SHAFT_TIP_FACING_DEG = 25;
/** The splinters fan across less than the shaft's width, so they stay inside its end. */
const SPLINTER_SPREAD = 0.7;
/** Alternate splinters jut further, so the snapped end reads as broken and not trimmed. */
const SPLINTER_REACH = 0.035;
const SPLINTER_REACH_ALTERNATE = 0.03;
const SPLINTER_HALF_BASE = 0.008;

/**
 * What is left of a militia spear: a short shaft snapped off above the grip,
 * dangling from a slack paw. Drawn along the forearm so it follows the arm
 * through every row without the rig having to know it is there.
 */
function brokenShaft(): GarmentLayer {
  return {
    name: 'broken spear shaft',
    front: (frame) => {
      const arm = frame.rightSide > 0 ? frame.skeleton.nearArm : frame.skeleton.farArm;
      const dx = arm.end.x - arm.joint.x;
      const dy = arm.end.y - arm.joint.y;
      const len = Math.hypot(dx, dy) || 1;
      const dir = pt(dx / len, dy / len);
      const axis = rotate(
        dir,
        deg(frame.view === 'side' ? SHAFT_TIP_PROFILE_DEG : SHAFT_TIP_FACING_DEG * frame.rightSide),
      );
      const butt = offset(
        arm.end,
        -axis.x * SHAFT_LENGTH * SHAFT_GRIP,
        -axis.y * SHAFT_LENGTH * SHAFT_GRIP,
      );
      const top = offset(butt, axis.x * SHAFT_LENGTH, axis.y * SHAFT_LENGTH);
      const { ctx } = frame;
      outlineCapsule(ctx, butt, top, SHAFT_WIDTH, SHAFT_WIDTH);
      fillCapsule(ctx, butt, top, SHAFT_WIDTH, SHAFT_WIDTH, SPEAR_WOOD.mid);
      const normal = pt(-axis.y, axis.x);
      ctx.fillStyle = SPEAR_WOOD.light;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = DETAIL_OUTLINE_WIDTH * MIDPOINT;
      for (let i = 0; i < SPLINTERS; i++) {
        const across = (i - (SPLINTERS - 1) / 2) * SHAFT_WIDTH * SPLINTER_SPREAD;
        const base = offset(top, normal.x * across, normal.y * across);
        const reach = SPLINTER_REACH + (i % 2) * SPLINTER_REACH_ALTERNATE;
        ctx.beginPath();
        ctx.moveTo(base.x - normal.x * SPLINTER_HALF_BASE, base.y - normal.y * SPLINTER_HALF_BASE);
        ctx.lineTo(base.x + axis.x * reach, base.y + axis.y * reach);
        ctx.lineTo(base.x + normal.x * SPLINTER_HALF_BASE, base.y + normal.y * SPLINTER_HALF_BASE);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
  };
}

/** The cords a shroud is bound with: heights between shoulder and hem, as fractions. */
const BINDINGS: readonly number[] = [0.18, 0.46, 0.74];
const BINDING_WIDTH = 0.018;
/**
 * Each cord stops just inside the shroud's edge, and dips in the middle and
 * rises higher at the back than the front, the way a cord pulled round a body
 * sits.
 */
const BINDING_ARC = {
  inset: 0.95,
  backRise: 0.02,
  sag: 0.025,
  frontRise: 0.01,
} as const;

/** The cords a body is wound into its shroud with, across the chest, waist and legs. */
function graveBindings(hem: HemShape): GarmentLayer {
  return {
    name: 'grave bindings',
    torso: (frame) => {
      const { ctx, skeleton, span } = frame;
      const hemY = skeleton.hip.y + hem.drop;
      ctx.save();
      ctx.strokeStyle = SHROUD_CORD;
      ctx.lineWidth = BINDING_WIDTH;
      for (const at of BINDINGS) {
        const y = lerp(skeleton.shoulder.y, hemY, at);
        const reach = lerp(span.chestLead, span.hipLead * hem.flare, at);
        const trail = lerp(span.chestTrail, span.hipTrail * hem.flare, at);
        const x = lerp(skeleton.chest.x, skeleton.hip.x, at);
        ctx.beginPath();
        ctx.moveTo(x - trail * BINDING_ARC.inset, y - BINDING_ARC.backRise);
        ctx.quadraticCurveTo(
          x,
          y + BINDING_ARC.sag,
          x + reach * BINDING_ARC.inset,
          y - BINDING_ARC.frontRise,
        );
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ── The three looks ──────────────────────────────────────────────────────────

const DIRT_SEED = 71;
/** Faint and sparse: grave dirt is a smudge on the close-up, never a pattern at tile size. */
const GRAVE_DIRT_SPECKS = { alpha: 0.55, count: 9, size: 0.016 } as const;

function graveDirt(seed: number): GarmentLayer {
  return speckle({
    colour: GRAVE_DIRT,
    alpha: GRAVE_DIRT_SPECKS.alpha,
    count: GRAVE_DIRT_SPECKS.count,
    size: GRAVE_DIRT_SPECKS.size,
    areas: ['torso', 'arms', 'head'],
    seed,
  });
}

/**
 * The rot every raised ratkin shares, laid over whatever it was buried in. The
 * eye glow is not in it: it has to be the last head layer, over a hood.
 */
function rotLayers(seed: number): readonly GarmentLayer[] {
  return [rotPatches(), graveDirt(seed), exposedRibs()];
}

const SMOCK = smock({ cloth: SMOCK_CLOTH, sleeve: 'rolled' });
const JACK = paddedJack({ cloth: JACK_CLOTH, gorget: JACK_GORGET });
const SHROUD = robe({ cloth: SHROUD_CLOTH, sleeve: 'long' });

/** Every body garment here declares its hem; a missing one is a wiring mistake, not a look. */
function hemOf(layer: GarmentLayer): HemShape {
  if (layer.hem === undefined) throw new Error(`${layer.name} declares no hem to tear`);
  return layer.hem;
}

function raisedOutfit(garments: readonly GarmentLayer[]): RatkinOutfit {
  return {
    fur: ROT_FUR,
    belly: ROT_BELLY,
    skin: DEAD_SKIN,
    tailSkin: DEAD_TAIL,
    eyeTint: DEAD_EYE,
    build: 'slight',
    garments,
    heldProp: 'none',
  };
}

/**
 * The three raised outfits: a farmer in his torn smock, a militiaman in his
 * rotted jack still gripping the stump of his spear, and one of the buried in
 * her grave linen, bound and hooded.
 */
export const RAISED_OUTFITS: Readonly<Record<RaisedRatkinLook, RatkinOutfit>> = {
  smock: raisedOutfit([
    SMOCK,
    tatteredHem(hemOf(SMOCK), SMOCK_CLOTH),
    ...rotLayers(DIRT_SEED),
    notchedEar(),
    glowingEyes(),
  ]),
  jack: raisedOutfit([
    JACK,
    tatteredHem(hemOf(JACK), JACK_CLOTH),
    ...rotLayers(DIRT_SEED + 1),
    brokenShaft(),
    glowingEyes(),
  ]),
  shroud: raisedOutfit([
    SHROUD,
    graveBindings(hemOf(SHROUD)),
    tatteredHem(hemOf(SHROUD), SHROUD_CLOTH),
    ...rotLayers(DIRT_SEED + 2),
    hood({ cloth: SHROUD_CLOTH }),
    glowingEyes(),
  ]),
};

/** The cloth colour of each look, for the heap its death leaves behind. */
export const RAISED_CLOTH: Readonly<Record<RaisedRatkinLook, Ramp>> = {
  smock: SMOCK_CLOTH,
  jack: JACK_CLOTH,
  shroud: SHROUD_CLOTH,
};

// ── What is left ─────────────────────────────────────────────────────────────

const PILE_HALF_WIDTH = 0.32;
const PILE_HEIGHT = 0.16;
/** The heap starts at this share of its height as the body falls, and grows the rest as it settles. */
const PILE_START_HEIGHT = 0.4;
const PILE_SETTLE_GROWTH = 0.6;

/**
 * The mound's outline, in half-widths across and pile heights up: rising
 * slowly at the back to a peak behind centre where the skull rests, dipping,
 * then falling steeply at the front.
 */
const MOUND = {
  backControlX: 0.8,
  peakX: 0.2,
  peakRise: 1.05,
  shoulderControlX: 0.3,
  shoulderControlRise: 1.3,
  frontX: 0.7,
  frontRise: 0.7,
  frontControlRise: 0.3,
} as const;
/** The shadowed fold in the cloth, forward of centre and low on the mound. */
const MOUND_FOLD = {
  x: 0.25,
  rise: 0.35,
  radiusX: 0.45,
  radiusY: 0.3,
} as const;

/** The skull lies at the mound's peak, snout pointing forward and down. */
const PILE_SKULL = {
  x: 0.3,
  rise: 1.05,
  radiusX: 0.075,
  radiusY: 0.055,
  tiltDeg: -10,
  snoutRootX: 0.05,
  snoutTopRise: 0.02,
  snoutTipX: 0.16,
  snoutTipDrop: 0.02,
  snoutJawDrop: 0.045,
  socketX: 0.02,
  socketRise: 0.005,
  socketRadius: 0.02,
} as const;
/** Below this the skull's eye-light is too faint to be worth a gradient. */
const SKULL_LIGHT_CUTOFF = 0.01;

/**
 * The heap a raised ratkin collapses into: its clothes in a low mound with a
 * rat skull and a few long bones on top. `settle` runs 0 (the heap forming) to
 * 1 (settled); the skull's eye-light goes out as it settles.
 */
export function drawBonePile(ctx: Ctx, look: RaisedRatkinLook, settle: number): void {
  const cloth = RAISED_CLOTH[look];
  const grow = Math.min(1, Math.max(0, settle));
  const h = PILE_HEIGHT * (PILE_START_HEIGHT + PILE_SETTLE_GROWTH * grow);
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(-PILE_HALF_WIDTH, 0);
      ctx.quadraticCurveTo(
        -PILE_HALF_WIDTH * MOUND.backControlX,
        -h,
        -PILE_HALF_WIDTH * MOUND.peakX,
        -h * MOUND.peakRise,
      );
      ctx.quadraticCurveTo(
        PILE_HALF_WIDTH * MOUND.shoulderControlX,
        -h * MOUND.shoulderControlRise,
        PILE_HALF_WIDTH * MOUND.frontX,
        -h * MOUND.frontRise,
      );
      ctx.quadraticCurveTo(PILE_HALF_WIDTH, -h * MOUND.frontControlRise, PILE_HALF_WIDTH, 0);
      ctx.closePath();
    },
    cloth.mid,
    BODY_OUTLINE_WIDTH,
  );
  ctx.fillStyle = cloth.dark;
  ctx.beginPath();
  ctx.ellipse(
    PILE_HALF_WIDTH * MOUND_FOLD.x,
    -h * MOUND_FOLD.rise,
    PILE_HALF_WIDTH * MOUND_FOLD.radiusX,
    h * MOUND_FOLD.radiusY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  for (const [ax, ay, bx, by] of PILE_BONES) {
    const a = pt(ax * PILE_HALF_WIDTH, -h * ay);
    const b = pt(bx * PILE_HALF_WIDTH, -h * by);
    outlineCapsule(ctx, a, b, BONE_WIDTH, BONE_WIDTH);
    fillCapsule(ctx, a, b, BONE_WIDTH, BONE_WIDTH, BONE);
  }
  const skull = pt(-PILE_HALF_WIDTH * PILE_SKULL.x, -h * PILE_SKULL.rise);
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(
        skull.x,
        skull.y,
        PILE_SKULL.radiusX,
        PILE_SKULL.radiusY,
        deg(PILE_SKULL.tiltDeg),
        0,
        TWO_PI,
      );
      ctx.moveTo(skull.x + PILE_SKULL.snoutRootX, skull.y - PILE_SKULL.snoutTopRise);
      ctx.lineTo(skull.x + PILE_SKULL.snoutTipX, skull.y + PILE_SKULL.snoutTipDrop);
      ctx.lineTo(skull.x + PILE_SKULL.snoutRootX, skull.y + PILE_SKULL.snoutJawDrop);
      ctx.closePath();
    },
    BONE,
    DETAIL_OUTLINE_WIDTH,
  );
  const socket = pt(skull.x + PILE_SKULL.socketX, skull.y - PILE_SKULL.socketRise);
  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.arc(socket.x, socket.y, PILE_SKULL.socketRadius, 0, TWO_PI);
  ctx.fill();
  const light = 1 - grow;
  if (light > SKULL_LIGHT_CUTOFF) {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * light;
    eyeGlow(ctx, socket);
    ctx.restore();
  }
}

const BONE_WIDTH = 0.022;
/** Each bone as (from x, from height, to x, to height), in pile units. */
const PILE_BONES: readonly (readonly [number, number, number, number])[] = [
  [-0.1, 0.9, 0.75, 0.55],
  [0.2, 0.3, 0.9, 0.2],
];

const DIRT_CLODS = 7;
const DIRT_REACH = 0.34;
/** The hole's full half-width once open; it starts at a share of that and widens the rest. */
const BREACH_HALF_WIDTH = 0.3;
const BREACH_START_WIDTH = 0.4;
const BREACH_OPEN_GROWTH = 0.6;
/** The ring of disturbed earth round the hole, and how flat the ground squashes it and the hole. */
const BREACH_RIM = 0.06;
const BREACH_RIM_FLATTEN = 0.32;
const BREACH_HOLE_FLATTEN = 0.28;
/** Clods are a lighter, drier earth than the dirt they were thrown out of. */
const CLOD_EARTH = '#5a4a36';
/** Turns the clod ring so no clod sits exactly level with the hole's edge. */
const CLOD_ANGLE_OFFSET = 0.4;
/**
 * Each clod's distance is scattered by a cheap stride hash of its index: a
 * share of the reach, plus up to a third more.
 */
const CLOD_NEAREST = 0.7;
const CLOD_SCATTER_STRIDE = 37;
const CLOD_SCATTER_STEPS = 10;
const CLOD_SCATTER_DIVISOR = 30;
/** Clods land on the ground plane, so their ring is squashed like the hole and sits just above its centre. */
const CLOD_RING_FLATTEN = 0.35;
const CLOD_RING_LIFT = 0.01;
const CLOD_RADIUS = 0.022;

/**
 * The earth broken open where a raised ratkin claws up out of it: a dark
 * hole and clods thrown out round it. `open` runs 0 (the first crack) to 1.
 */
export function drawGraveBreach(ctx: Ctx, open: number): void {
  const t = Math.min(1, Math.max(0, open));
  if (t <= 0) return;
  const rx = BREACH_HALF_WIDTH * (BREACH_START_WIDTH + BREACH_OPEN_GROWTH * t);
  ctx.fillStyle = GRAVE_DIRT;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + BREACH_RIM, (rx + BREACH_RIM) * BREACH_RIM_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = CAVITY;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, rx * BREACH_HOLE_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = mix(GRAVE_DIRT, CLOD_EARTH, 0.5);
  for (let i = 0; i < DIRT_CLODS; i++) {
    const a = (i / DIRT_CLODS) * TWO_PI + CLOD_ANGLE_OFFSET;
    const scatter = ((i * CLOD_SCATTER_STRIDE) % CLOD_SCATTER_STEPS) / CLOD_SCATTER_DIVISOR;
    const r = DIRT_REACH * (CLOD_NEAREST + scatter) * t;
    ctx.beginPath();
    ctx.arc(
      Math.cos(a) * r,
      Math.sin(a) * r * CLOD_RING_FLATTEN - CLOD_RING_LIFT,
      CLOD_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}
