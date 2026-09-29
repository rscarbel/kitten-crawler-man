/**
 * What a skyfowl wears, how it is built, and what it carries — the outfit the
 * shared skyfowl rig (`rig.ts`) is handed for every frame.
 *
 * One rig paints every skyfowl in the game. A citizen, a named resident and a
 * street-tough mob differ only in the {@link SkyfowlOutfit} passed in: a
 * plumage pattern, a build, an ordered stack of garment layers and an
 * optional held prop.
 */

import type { Pt } from '../carlArt';
import { fillSoftEllipse } from '../softShade';
import { fillCapsule, outlineCapsule, pt, type Ramp } from './paint';
import type { SkyfowlBuild, SkyfowlBuildSpec } from './palette';
import type { SkyfowlPose, SkyfowlView } from './rig';
import { SKYFOWL_BUILDS } from './palette';
import type { PlumagePattern } from './palette';

type Ctx = CanvasRenderingContext2D;

interface LegChainLike {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly hock: Pt;
  readonly toe: Pt;
}

/**
 * One garment, as a set of slot painters. Every slot is optional; each is
 * called at a fixed depth in the rig's draw order, in the order the layers
 * appear in {@link SkyfowlOutfit.garments} (back to front).
 */
export interface SkyfowlGarmentLayer {
  readonly name: string;
  torso?(
    ctx: Ctx,
    pose: SkyfowlPose,
    build: SkyfowlBuildSpec,
    lateral: number,
    view: SkyfowlView,
  ): void;
  leg?(
    ctx: Ctx,
    pose: SkyfowlPose,
    build: SkyfowlBuildSpec,
    leg: LegChainLike,
    near: boolean,
  ): void;
  head?(ctx: Ctx, pose: SkyfowlPose, build: SkyfowlBuildSpec): void;
  front?(ctx: Ctx, pose: SkyfowlPose, build: SkyfowlBuildSpec): void;
}

/** A prop held in the near wing's hand; drawn from the hand's solved position. */
export interface SkyfowlHeldProp {
  readonly name: string;
  draw(ctx: Ctx, hand: Pt, view: SkyfowlView): void;
}

export interface SkyfowlOutfit {
  readonly plumage: PlumagePattern;
  readonly build: SkyfowlBuild;
  readonly garments: readonly SkyfowlGarmentLayer[];
  readonly heldProp?: SkyfowlHeldProp;
}

// ── Garment factories ────────────────────────────────────────────────────────

// Y-coordinates below are figure-space (ground at 0, up negative), pinned
// against the rig's own landmarks: hip -0.86, waist -0.98, chest -1.30,
// shoulder -1.42, head centre -1.78. A garment is drawn wider than the body's
// own silhouette at that height (`CHEST_HALF_WIDTH`/`SHOULDER_HALF_WIDTH` are
// 0.23/0.24) so it visibly steps past the body outline instead of blending
// into it — the failure mode of a garment drawn flush with the torso.
const HIP_Y = -0.86;
const WAIST_Y = -0.98;
const CHEST_Y = -1.3;
const SHOULDER_Y = -1.42;
/** The knee, where the feathered thigh ends — a garment's hem reaching here tucks the whole thigh away, leaving only the bare shank and talon below it. */
const KNEE_Y = -0.6;

/**
 * Traces actual garment geometry — a neckline notch, shoulders, a waist that
 * pulls in, a hem that flares back out and closes with a slight curve rather
 * than a capsule's round cap — so a garment reads as cloth draped over a
 * body, not a smooth egg-shaped shell. `halfWidth` sets the shoulder width;
 * the waist and hem are fractions of it.
 */
function traceGarment(ctx: Ctx, topY: number, bottomY: number, w: number): void {
  const span = bottomY - topY;
  const waistY = topY + span * 0.55;
  const waistW = w * 0.74;
  const hemW = w * 0.94;
  const neckW = w * 0.32;
  ctx.beginPath();
  ctx.moveTo(-neckW, topY);
  ctx.lineTo(-w, topY + span * 0.04);
  ctx.lineTo(-waistW, waistY);
  ctx.lineTo(-hemW, bottomY - span * 0.03);
  ctx.quadraticCurveTo(0, bottomY, hemW, bottomY - span * 0.03);
  ctx.lineTo(waistW, waistY);
  ctx.lineTo(w, topY + span * 0.04);
  ctx.lineTo(neckW, topY);
  ctx.quadraticCurveTo(0, topY + span * 0.05, -neckW, topY);
  ctx.closePath();
}

function torsoBand(
  cloth: Ramp,
  topY: number,
  bottomY: number,
  halfWidth: number,
  wrapsBehind = true,
): SkyfowlGarmentLayer['torso'] {
  return (ctx, _pose, build, lateral, view) => {
    if (!wrapsBehind && view === 'up') return;
    const w = halfWidth * build.bodyWidth * lateral;
    const span = bottomY - topY;
    ctx.save();
    ctx.strokeStyle = '#160f0a';
    ctx.lineWidth = 0.02;
    ctx.lineJoin = 'round';
    traceGarment(ctx, topY, bottomY, w);
    ctx.stroke();
    ctx.fillStyle = cloth.mid;
    ctx.fill();
    // Form shading, clipped to the garment's own outline. Kept modest so the
    // base tone stays dominant: a garment shaded toward its own dark ramp
    // stop reads as a cloth fold, not a different, near-black material.
    ctx.save();
    traceGarment(ctx, topY, bottomY, w);
    ctx.clip();
    fillSoftEllipse(ctx, w * 0.45, topY + span * 0.75, w * 0.5, span * 0.4, cloth.dark, 0.16);
    fillSoftEllipse(ctx, -w * 0.4, topY + span * 0.22, w * 0.42, span * 0.32, cloth.light, 0.15);
    ctx.restore();
    // Hem line: a darker stroke at the bottom edge, the cue that reads as
    // "this is a separate garment" rather than a colour change on the body.
    ctx.strokeStyle = cloth.dark;
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(-w * 0.9, bottomY - span * 0.03);
    ctx.quadraticCurveTo(0, bottomY, w * 0.9, bottomY - span * 0.03);
    ctx.stroke();
    ctx.restore();
  };
}

export function apron(cloth: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'apron',
    torso: torsoBand(cloth, WAIST_Y, KNEE_Y + 0.06, 0.27, false),
    front: (ctx, _pose, build) => {
      // A pouch at the hip: the merchant's small silhouette tell.
      const w = 0.27 * build.bodyWidth;
      ctx.save();
      ctx.fillStyle = cloth.dark;
      ctx.beginPath();
      ctx.ellipse(w * 0.55, HIP_Y + 0.06, 0.045, 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}

export function cuirass(metal: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'cuirass',
    torso: torsoBand(metal, SHOULDER_Y + 0.02, KNEE_Y + 0.08, 0.29),
    front: (ctx) => {
      // Tabard flap: hangs a step below the cuirass's own hem, and a centre seam.
      const hem = KNEE_Y + 0.08;
      ctx.save();
      ctx.fillStyle = metal.dark;
      ctx.globalAlpha = 0.9;
      fillCapsule(ctx, pt(0, hem - 0.02), pt(0, hem + 0.08), 0.08, 0.06, metal.dark);
      ctx.strokeStyle = metal.dark;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0, SHOULDER_Y + 0.04);
      ctx.lineTo(0, hem);
      ctx.stroke();
      ctx.restore();
    },
  };
}

export function toolBelt(leather: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'toolBelt',
    torso: (ctx, _pose, build, lateral) => {
      const w = 0.24 * build.bodyWidth * lateral;
      ctx.save();
      fillCapsule(ctx, pt(-w, HIP_Y + 0.04), pt(w, HIP_Y + 0.04), 0.022, 0.022, leather.mid);
      ctx.fillStyle = leather.dark;
      ctx.fillRect(-0.03, HIP_Y - 0.02, 0.06, 0.09);
      // A mallet slung at the hip: the labourer's own silhouette tell.
      ctx.strokeStyle = leather.dark;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(w * 0.75, HIP_Y - 0.02);
      ctx.lineTo(w * 0.75, HIP_Y + 0.18);
      ctx.stroke();
      ctx.fillStyle = leather.dark;
      ctx.fillRect(w * 0.75 - 0.035, HIP_Y - 0.05, 0.07, 0.035);
      ctx.restore();
    },
  };
}

/** A long coat: stops just past the hip, so the shank and talon stay clear of the hem. */
export function clerkVest(cloth: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'clerkVest',
    torso: torsoBand(cloth, SHOULDER_Y + 0.02, KNEE_Y, 0.28),
    front: (ctx) => {
      // A satchel strap crossing the coat: the clerk's own silhouette tell.
      ctx.save();
      outlineCapsule(ctx, pt(-0.14, SHOULDER_Y + 0.05), pt(0.1, HIP_Y - 0.06), 0.016, 0.016);
      fillCapsule(
        ctx,
        pt(-0.14, SHOULDER_Y + 0.05),
        pt(0.1, HIP_Y - 0.06),
        0.016,
        0.016,
        cloth.dark,
      );
      ctx.fillStyle = cloth.dark;
      ctx.fillRect(0.06, HIP_Y - 0.1, 0.07, 0.06);
      ctx.restore();
    },
  };
}

/**
 * A stole, not a full robe: a short vest base plus two narrow strips hanging
 * from the shoulders and a sky sigil on the chest, so the legs stay clear and
 * the role reads by its own cue rather than by "the long one."
 */
export function templeRobe(cloth: Ramp): SkyfowlGarmentLayer {
  const sigil = '#7ca0ac';
  return {
    name: 'templeRobe',
    torso: torsoBand(cloth, SHOULDER_Y + 0.02, KNEE_Y - 0.04, 0.27),
    front: (ctx) => {
      ctx.save();
      outlineCapsule(ctx, pt(-0.1, SHOULDER_Y + 0.04), pt(-0.06, HIP_Y), 0.018, 0.014);
      fillCapsule(ctx, pt(-0.1, SHOULDER_Y + 0.04), pt(-0.06, HIP_Y), 0.018, 0.014, cloth.dark);
      outlineCapsule(ctx, pt(0.1, SHOULDER_Y + 0.04), pt(0.06, HIP_Y), 0.018, 0.014);
      fillCapsule(ctx, pt(0.1, SHOULDER_Y + 0.04), pt(0.06, HIP_Y), 0.018, 0.014, cloth.dark);
      ctx.fillStyle = sigil;
      ctx.beginPath();
      ctx.arc(0, CHEST_Y + 0.05, 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cloth.dark;
      ctx.lineWidth = 0.008;
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** A cape with a high collar and gold trim: stops at the hip, so the legs still show. */
export function nobleCloak(cloth: Ramp): SkyfowlGarmentLayer {
  const gold = '#d4b04a';
  return {
    name: 'nobleCloak',
    torso: torsoBand(cloth, SHOULDER_Y - 0.02, KNEE_Y - 0.02, 0.32),
    front: (ctx) => {
      ctx.save();
      // High collar behind the neck.
      ctx.fillStyle = cloth.dark;
      ctx.beginPath();
      ctx.ellipse(0, SHOULDER_Y - 0.02, 0.14, 0.06, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // Gold trim down the front edge.
      ctx.strokeStyle = gold;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0, SHOULDER_Y);
      ctx.lineTo(0, KNEE_Y - 0.02);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * A single strap over one shoulder, not a crossed pair — a crossed pair reads
 * at 32px as the same silhouette the street-tough's ragged wrap uses, which
 * would let a player mistake a porter for a target.
 */
export function packHarness(leather: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'packHarness',
    torso: (ctx, _pose, build, lateral, view) => {
      const w = 0.26 * build.bodyWidth * lateral;
      // The bundle itself, riding high on the back — visible past the
      // shoulders in every view, which is the porter's own silhouette tell.
      if (view !== 'down') {
        ctx.save();
        ctx.fillStyle = leather.dark;
        ctx.beginPath();
        ctx.ellipse(
          0,
          SHOULDER_Y - 0.06,
          0.15 * build.bodyWidth,
          0.16 * build.bodyWidth,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.strokeStyle = leather.mid;
        ctx.lineWidth = 0.01;
        ctx.beginPath();
        ctx.moveTo(-0.1, SHOULDER_Y - 0.06);
        ctx.lineTo(0.1, SHOULDER_Y - 0.06);
        ctx.stroke();
        ctx.restore();
      }
      outlineCapsule(ctx, pt(-w * 0.55, SHOULDER_Y + 0.03), pt(w * 0.4, HIP_Y), 0.024, 0.024);
      fillCapsule(
        ctx,
        pt(-w * 0.55, SHOULDER_Y + 0.03),
        pt(w * 0.4, HIP_Y),
        0.024,
        0.024,
        leather.mid,
      );
    },
  };
}

export function smock(cloth: Ramp): SkyfowlGarmentLayer {
  return { name: 'smock', torso: torsoBand(cloth, CHEST_Y, KNEE_Y + 0.08, 0.25) };
}

/**
 * A base work tunic: plain, unadorned cloth reaching the knee, worn under a
 * belt or a harness strap. Without it a role whose only garment is a thin
 * strap or belt line (the labourer, the porter) leaves its whole thigh bare,
 * which reads as a strut rather than a clothed leg.
 */
export function workTunic(cloth: Ramp): SkyfowlGarmentLayer {
  return { name: 'workTunic', torso: torsoBand(cloth, CHEST_Y + 0.03, KNEE_Y + 0.02, 0.24) };
}

/**
 * A heavy leather forge apron, reaching lower and wider than the merchant's
 * — Varga's own silhouette tell, with a loop for a spare tool at the hip.
 */
export function smithApron(leather: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'smithApron',
    torso: torsoBand(leather, CHEST_Y + 0.02, KNEE_Y + 0.05, 0.3, false),
    front: (ctx, _pose, build) => {
      const w = 0.3 * build.bodyWidth;
      ctx.save();
      ctx.strokeStyle = leather.dark;
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(-w * 0.45, HIP_Y);
      ctx.lineTo(-w * 0.45, HIP_Y + 0.16);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * A long civilian coat over a modest under-layer, buttoned to the collar —
 * a guard post's off-duty coat rather than a cuirass, for Kessler's
 * undermanned lodge.
 */
export function lodgeCoat(cloth: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'lodgeCoat',
    torso: torsoBand(cloth, SHOULDER_Y, KNEE_Y, 0.3),
    front: (ctx) => {
      ctx.save();
      ctx.strokeStyle = cloth.dark;
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      ctx.moveTo(0, SHOULDER_Y + 0.04);
      ctx.lineTo(0, KNEE_Y - 0.05);
      ctx.stroke();
      // A row of collar-to-hem buttons — a coat, not a robe.
      ctx.fillStyle = cloth.light;
      for (let i = 0; i < 4; i++) {
        const y = SHOULDER_Y + 0.14 + i * 0.16;
        ctx.beginPath();
        ctx.arc(0, y, 0.012, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/**
 * A cuirass with a single diagonal rank stripe across the chest — Pell's
 * own cue, distinct at a glance from a plain guard's cuirass and from the
 * street-tough's ragged wrap.
 */
export function corporalTabard(metal: Ramp, stripe: string): SkyfowlGarmentLayer {
  const base = cuirass(metal);
  return {
    name: 'corporalTabard',
    torso: (ctx, pose, build, lateral, view) => base.torso?.(ctx, pose, build, lateral, view),
    front: (ctx, pose, build) => {
      base.front?.(ctx, pose, build);
      ctx.save();
      ctx.strokeStyle = stripe;
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      ctx.moveTo(-0.12 * build.bodyWidth, SHOULDER_Y + 0.08);
      ctx.lineTo(0.1 * build.bodyWidth, HIP_Y - 0.04);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * A plain vest with both sleeves rolled to the elbow and a scatter of dark
 * ink flecks down the forearm — Nim's own trade mark, since her hands are
 * never clean of it.
 */
export function inkSleeves(cloth: Ramp, ink: string): SkyfowlGarmentLayer {
  return {
    name: 'inkSleeves',
    torso: torsoBand(cloth, CHEST_Y + 0.04, HIP_Y + 0.08, 0.24),
    front: (ctx, _pose, build) => {
      const w = 0.22 * build.bodyWidth;
      ctx.save();
      ctx.fillStyle = ink;
      for (const [fx, fy] of [
        [w * 0.6, HIP_Y - 0.02],
        [w * 0.7, HIP_Y + 0.06],
        [w * 0.5, HIP_Y + 0.1],
      ] as const) {
        ctx.beginPath();
        ctx.arc(fx, fy, 0.01, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/** A small gold circlet — the one elder-status head marker in the outfit set, for Aviel over his stole. */
export function templeCirclet(gold: string): SkyfowlGarmentLayer {
  return {
    name: 'templeCirclet',
    head: (ctx, _pose, build) => {
      ctx.save();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 0.016;
      ctx.beginPath();
      ctx.ellipse(
        0,
        -1.78 - 0.18 * build.headScale,
        0.19 * build.headScale,
        0.04,
        0,
        0,
        Math.PI,
        true,
      );
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * A short, bright sash worn diagonally over one shoulder to the opposite hip —
 * club-floor finery rather than a trade's working layer, and short enough
 * (stopping above the knee) that the dance rows' leg motion stays clear of it.
 */
export function dancerSash(cloth: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'dancerSash',
    torso: torsoBand(cloth, CHEST_Y + 0.06, HIP_Y + 0.1, 0.2),
    front: (ctx, _pose, build) => {
      const w = 0.24 * build.bodyWidth;
      ctx.save();
      ctx.strokeStyle = cloth.light;
      ctx.lineWidth = 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w * 0.7, SHOULDER_Y + 0.06);
      ctx.lineTo(w * 0.5, HIP_Y);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** Unkempt wrap: patched, ragged-edged, the street-tough's signature layer. */
export function raggedWrap(cloth: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'raggedWrap',
    torso: (ctx, _pose, build, lateral) => {
      const w = 0.29 * build.bodyWidth * lateral;
      ctx.save();
      outlineCapsule(ctx, pt(-w * 0.4, SHOULDER_Y + 0.05), pt(w * 0.55, HIP_Y), 0.036, 0.024);
      fillCapsule(
        ctx,
        pt(-w * 0.4, SHOULDER_Y + 0.05),
        pt(w * 0.55, HIP_Y),
        0.036,
        0.024,
        cloth.mid,
      );
      outlineCapsule(ctx, pt(w * 0.5, SHOULDER_Y), pt(-w * 0.45, HIP_Y + 0.02), 0.03, 0.02);
      fillCapsule(
        ctx,
        pt(w * 0.5, SHOULDER_Y),
        pt(-w * 0.45, HIP_Y + 0.02),
        0.03,
        0.02,
        cloth.dark,
      );
      // Torn edges and a bare patch: unkempt, not tailored — the read a
      // civilian's clean-hemmed garments never carry.
      ctx.fillStyle = cloth.dark;
      for (const [nx, ny] of [
        [-w * 0.15, HIP_Y - 0.01],
        [w * 0.1, HIP_Y + 0.01],
        [w * 0.3, SHOULDER_Y + 0.15],
      ]) {
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + 0.025, ny + 0.03);
        ctx.lineTo(nx - 0.02, ny + 0.032);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

export function guardHelm(metal: Ramp): SkyfowlGarmentLayer {
  return {
    name: 'guardHelm',
    head: (ctx, _pose, build) => {
      ctx.save();
      ctx.globalAlpha = 0.94;
      ctx.beginPath();
      ctx.ellipse(
        0,
        -1.78 - 0.24 * build.headScale,
        0.22 * build.headScale,
        0.09,
        0,
        0,
        Math.PI,
        true,
      );
      ctx.fillStyle = metal.mid;
      ctx.fill();
      ctx.strokeStyle = metal.dark;
      ctx.lineWidth = 0.012;
      ctx.stroke();
      ctx.restore();
    },
  };
}

// ── Held props ───────────────────────────────────────────────────────────────

export function ledgerProp(): SkyfowlHeldProp {
  return {
    name: 'ledger',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.fillStyle = '#8a6a3c';
      ctx.fillRect(hand.x - 0.05, hand.y - 0.06, 0.1, 0.08);
      ctx.strokeStyle = '#3a2a14';
      ctx.lineWidth = 0.006;
      ctx.strokeRect(hand.x - 0.05, hand.y - 0.06, 0.1, 0.08);
      ctx.restore();
    },
  };
}

export function spearProp(): SkyfowlHeldProp {
  return {
    name: 'spear',
    draw: (ctx, hand, view) => {
      const tipY = view === 'up' ? hand.y - 0.5 : hand.y - 0.7;
      ctx.save();
      ctx.strokeStyle = '#6b4a2c';
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y + 0.2);
      ctx.lineTo(hand.x, tipY + 0.06);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hand.x - 0.025, tipY + 0.06);
      ctx.lineTo(hand.x, tipY);
      ctx.lineTo(hand.x + 0.025, tipY + 0.06);
      ctx.closePath();
      ctx.fillStyle = '#c8ccd4';
      ctx.fill();
      ctx.restore();
    },
  };
}

export function sackProp(): SkyfowlHeldProp {
  return {
    name: 'sack',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.fillStyle = '#a08858';
      ctx.beginPath();
      ctx.ellipse(hand.x, hand.y + 0.02, 0.06, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a4626';
      ctx.lineWidth = 0.006;
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** A ragged club: the street tough's only prop, unlike any citizen's tool. */
export function crudeClubProp(): SkyfowlHeldProp {
  return {
    name: 'crude_club',
    draw: (ctx, hand, view) => {
      const tipY = view === 'up' ? hand.y - 0.28 : hand.y - 0.34;
      ctx.save();
      ctx.strokeStyle = '#3a2c1c';
      ctx.lineWidth = 0.02;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y + 0.05);
      ctx.lineTo(hand.x, tipY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hand.x, tipY, 0.028, 0, Math.PI * 2);
      ctx.fillStyle = '#241a10';
      ctx.fill();
      ctx.restore();
    },
  };
}

/** A smith's tongs, gripped by the middle — Varga's own reading-metal-not-people prop. */
export function tongsProp(): SkyfowlHeldProp {
  return {
    name: 'tongs',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = 0.016;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hand.x - 0.03, hand.y - 0.12);
      ctx.lineTo(hand.x, hand.y + 0.02);
      ctx.lineTo(hand.x + 0.03, hand.y - 0.12);
      ctx.stroke();
      ctx.strokeStyle = '#8a8a8a';
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      ctx.moveTo(hand.x - 0.018, hand.y - 0.03);
      ctx.lineTo(hand.x + 0.018, hand.y - 0.03);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** A wheelwright's hand saw, blade down — Brann's own trade tell, distinct from the laborer's belted mallet. */
export function sawProp(): SkyfowlHeldProp {
  return {
    name: 'saw',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.strokeStyle = '#6b4a2c';
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y - 0.02);
      ctx.lineTo(hand.x, hand.y + 0.06);
      ctx.stroke();
      ctx.strokeStyle = '#b8bcc4';
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      ctx.moveTo(hand.x - 0.02, hand.y - 0.24);
      ctx.lineTo(hand.x, hand.y - 0.02);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** A tankard held loosely — the innkeeper's hospitality prop, distinct from a merchant's sack. */
export function tankardProp(): SkyfowlHeldProp {
  return {
    name: 'tankard',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.fillStyle = '#8a6a3c';
      ctx.fillRect(hand.x - 0.03, hand.y - 0.05, 0.06, 0.07);
      ctx.strokeStyle = '#c9a24a';
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(hand.x + 0.03, hand.y - 0.03);
      ctx.lineTo(hand.x + 0.05, hand.y - 0.01);
      ctx.lineTo(hand.x + 0.03, hand.y + 0.01);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** A fine needle, held between two fingers — Nim's own tool, tiny enough to read as precision work, not a weapon. */
export function needleProp(): SkyfowlHeldProp {
  return {
    name: 'needle',
    draw: (ctx, hand) => {
      ctx.save();
      ctx.strokeStyle = '#c8ccd4';
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      ctx.moveTo(hand.x - 0.01, hand.y + 0.03);
      ctx.lineTo(hand.x + 0.03, hand.y - 0.06);
      ctx.stroke();
      ctx.restore();
    },
  };
}

export { SKYFOWL_BUILDS };
