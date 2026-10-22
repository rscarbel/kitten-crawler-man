/**
 * Small worn accessories layered over the human rig after Carl's own painter
 * has finished (a head accessory over the solved head, in the rig's `over`
 * slab), so a townsfolk look reads its role at a glance without a
 * bespoke garment system of its own: an apron, a satchel, a tabard, a
 * brimmed hat, a stole, a patched hood. Each is drawn in the same figure-unit
 * space Carl's own rig paints in (`carl/proportions.ts`'s constants), so it
 * sits on him wherever the pose puts his shoulders, waist and head — it is
 * not baked into a fixed screen position.
 *
 * These are deliberately simple flat/two-tone shapes, not full anatomy-grade
 * paint: the point is a silhouette and colour cue that survives at 32px, laid
 * over a body already fully shaded by Carl's own painter.
 */

import { mix, rgba } from '../carlArt';
import type { CarlPose } from '../carl/rig';
import { type CardinalView } from '../../facingView';
import {
  HEAD_CENTRE_Y,
  HEAD_RX,
  HEAD_RY,
  HIP_Y,
  SHOULDER_HALF,
  SHOULDER_Y,
  WAIST_Y,
} from '../carl/proportions';

type Ctx = CanvasRenderingContext2D;

export type AccessoryKind =
  | 'none'
  | 'apron'
  | 'satchel'
  | 'tabard'
  | 'brimmedHat'
  | 'stole'
  | 'patchedHood'
  | 'ledgerPencil'
  | 'shawlCharms'
  | 'flourApron'
  | 'vialCase'
  | 'builderRule';

export interface AccessorySpec {
  readonly kind: AccessoryKind;
  readonly color: string;
  readonly accentColor?: string;
}

/** How much darker/lighter the shaded and lit edge of a flat accessory shape are. */
const SHADE_MIX = 0.35;
const LIGHT_MIX = 0.25;
const SHADOW_TOWARD = '#100c14';
const LIGHT_TOWARD = '#ffffff';

function shaded(color: string): string {
  return mix(color, SHADOW_TOWARD, SHADE_MIX);
}
function lit(color: string): string {
  return mix(color, LIGHT_TOWARD, LIGHT_MIX);
}

/** A pencil-graphite colour shared by every resident who carries a writing tool. */
const PENCIL_COLOR = '#c9a24a';
/** A hairline outline weight shared by the small flat props below (ledger corners, tongs, etc). */
const FINE_OUTLINE_WIDTH = 0.006;
/** A slightly heavier stroke weight for a prop's own most visible line. */
const PROP_STROKE_WIDTH = 0.01;

// ── Shoes ────────────────────────────────────────────────────────────────────
//
// Carl's own look is barefoot — a trait of his own character, not of
// the rig. A flat shoe laid over each foot target of a finished figure, for a
// figure that dresses after its paint rather than through the cast's
// `townsfolk_shoes` garment.

const SHOE_HALF_WIDTH = 0.09;
const SHOE_HALF_LENGTH = 0.065;
/** The shoe sits centred slightly above the foot's own ground point, so its sole reads as flat on the floor rather than floating. */
const SHOE_RISE = 0.025;
const SHOE_OUTLINE_WIDTH = 0.01;
/** A lit seam across the toe, the one shoe-specific mark that survives at 32px. */
const SHOE_SEAM_ALPHA = 0.55;
const SHOE_SEAM_WIDTH = 0.008;

function drawShoe(ctx: Ctx, foot: { x: number; y: number }, color: string): void {
  const cy = foot.y - SHOE_RISE;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(foot.x, cy, SHOE_HALF_WIDTH, SHOE_HALF_LENGTH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shaded(color);
  ctx.lineWidth = SHOE_OUTLINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = rgba(lit(color), SHOE_SEAM_ALPHA);
  ctx.lineWidth = SHOE_SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(foot.x - SHOE_HALF_WIDTH * 0.6, cy - SHOE_HALF_LENGTH * 0.2);
  ctx.lineTo(foot.x + SHOE_HALF_WIDTH * 0.6, cy - SHOE_HALF_LENGTH * 0.2);
  ctx.stroke();
}

/** Draws a flat shoe over each of `pose`'s own feet — the far one a shade darker, matching every other worn accessory here. */
export function drawShoes(ctx: Ctx, _view: CardinalView, pose: CarlPose, color: string): void {
  drawShoe(ctx, pose.leftFoot, shaded(color));
  drawShoe(ctx, pose.rightFoot, color);
}

const APRON_TOP = WAIST_Y - 0.08;
const APRON_BOTTOM = HIP_Y + 0.42;
const APRON_HALF_WIDTH = 0.16;
const APRON_TIE_WIDTH = 0.014;
const APRON_PROFILE_HALF_WIDTH = 0.07;
/** The hem tapers in from the bib's own width, so the apron reads as cloth rather than a rigid board. */
const APRON_HEM_TAPER = 0.85;
/** The waist tie's knot reaches slightly past the bib's own edge on each side. */
const APRON_TIE_OVERHANG = 1.1;

function drawApron(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  if (view === 'back') return;
  const half = view === 'side' ? APRON_PROFILE_HALF_WIDTH : APRON_HALF_WIDTH;
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  ctx.moveTo(-half, APRON_TOP);
  ctx.lineTo(half, APRON_TOP);
  ctx.lineTo(half * APRON_HEM_TAPER, APRON_BOTTOM);
  ctx.lineTo(-half * APRON_HEM_TAPER, APRON_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shaded(spec.color);
  ctx.lineWidth = APRON_TIE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-half, APRON_TOP);
  ctx.lineTo(half, APRON_TOP);
  ctx.stroke();
  // A waist tie: two short bands knotted at the sides.
  ctx.strokeStyle = spec.accentColor ?? shaded(spec.color);
  ctx.beginPath();
  ctx.moveTo(-half * APRON_TIE_OVERHANG, WAIST_Y);
  ctx.lineTo(half * APRON_TIE_OVERHANG, WAIST_Y);
  ctx.stroke();
}

const SATCHEL_STRAP_WIDTH = 0.02;
const SATCHEL_POUCH_HALF = 0.075;
const SATCHEL_POUCH_Y = HIP_Y + 0.1;
/** How far below the shoulder line the strap starts. */
const SATCHEL_STRAP_TOP_DROP = 0.05;
/** The strap's near-centreline anchor points in profile. */
const SATCHEL_PROFILE_SHOULDER_X = 0.04;
const SATCHEL_PROFILE_HIP_X = -0.02;
/** The strap's anchor points as a fraction of shoulder half-width, front-on. */
const SATCHEL_FRONT_SHOULDER_FRAC = 0.7;
const SATCHEL_FRONT_HIP_FRAC = 0.5;
/** The pouch reads slightly flattened top-to-bottom, not a perfect circle. */
const SATCHEL_POUCH_VERTICAL_FRAC = 0.8;

function drawSatchel(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  const shoulderX =
    view === 'side' ? SATCHEL_PROFILE_SHOULDER_X : -SHOULDER_HALF * SATCHEL_FRONT_SHOULDER_FRAC;
  const hipX = view === 'side' ? SATCHEL_PROFILE_HIP_X : SHOULDER_HALF * SATCHEL_FRONT_HIP_FRAC;
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = SATCHEL_STRAP_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, SHOULDER_Y + SATCHEL_STRAP_TOP_DROP);
  ctx.lineTo(hipX, SATCHEL_POUCH_Y);
  ctx.stroke();
  ctx.fillStyle = spec.accentColor ?? shaded(spec.color);
  ctx.beginPath();
  ctx.ellipse(
    hipX,
    SATCHEL_POUCH_Y,
    SATCHEL_POUCH_HALF,
    SATCHEL_POUCH_HALF * SATCHEL_POUCH_VERTICAL_FRAC,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

const TABARD_TOP = SHOULDER_Y + 0.04;
const TABARD_BOTTOM = WAIST_Y + 0.05;
const TABARD_HALF_WIDTH = 0.1;
const TABARD_OUTLINE_WIDTH = 0.012;

function drawTabard(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  if (view === 'side') return;
  ctx.fillStyle = spec.color;
  ctx.fillRect(-TABARD_HALF_WIDTH, TABARD_TOP, TABARD_HALF_WIDTH * 2, TABARD_BOTTOM - TABARD_TOP);
  ctx.strokeStyle = spec.accentColor ?? lit(spec.color);
  ctx.lineWidth = TABARD_OUTLINE_WIDTH;
  ctx.strokeRect(-TABARD_HALF_WIDTH, TABARD_TOP, TABARD_HALF_WIDTH * 2, TABARD_BOTTOM - TABARD_TOP);
}

const HAT_CROWN_RY = HEAD_RY * 0.55;
const HAT_CROWN_RX = HEAD_RX * 0.85;
const HAT_CROWN_RISE = HEAD_RY * 1.15;
const HAT_BRIM_RY = HEAD_RY * 0.22;
const HAT_BRIM_RX = HEAD_RX * 1.7;
const HAT_BRIM_RISE = HEAD_RY * 0.78;
const HAT_PROFILE_BRIM_LEAD = HEAD_RX * 1.4;
/** The profile brim's own centre sits slightly ahead of the lead point, not on top of it. */
const HAT_PROFILE_BRIM_OFFSET_FRAC = 0.15;

function drawBrimmedHat(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  const crownY = HEAD_CENTRE_Y - HAT_CROWN_RISE;
  const brimY = HEAD_CENTRE_Y - HAT_BRIM_RISE;
  ctx.fillStyle = shaded(spec.color);
  ctx.beginPath();
  ctx.ellipse(0, crownY, HAT_CROWN_RX, HAT_CROWN_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = spec.color;
  if (view === 'side') {
    ctx.beginPath();
    ctx.ellipse(
      HAT_PROFILE_BRIM_LEAD * HAT_PROFILE_BRIM_OFFSET_FRAC,
      brimY,
      HAT_PROFILE_BRIM_LEAD,
      HAT_BRIM_RY,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.beginPath();
    ctx.ellipse(0, brimY, HAT_BRIM_RX, HAT_BRIM_RY, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = lit(spec.color);
  ctx.lineWidth = PROP_STROKE_WIDTH;
  ctx.stroke();
}

const STOLE_HALF_WIDTH = 0.03;
const STOLE_TOP = SHOULDER_Y + 0.06;
const STOLE_BOTTOM = HIP_Y + 0.2;
const STOLE_BAND_HEIGHT = 0.02;

function drawStole(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  if (view === 'side') return;
  ctx.fillStyle = spec.color;
  ctx.fillRect(-STOLE_HALF_WIDTH, STOLE_TOP, STOLE_HALF_WIDTH * 2, STOLE_BOTTOM - STOLE_TOP);
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  ctx.fillRect(
    -STOLE_HALF_WIDTH,
    STOLE_BOTTOM - STOLE_BAND_HEIGHT,
    STOLE_HALF_WIDTH * 2,
    STOLE_BAND_HEIGHT,
  );
}

const HOOD_RX = HEAD_RX * 1.15;
const HOOD_RY = HEAD_RY * 1.2;
const HOOD_RISE = HEAD_RY * 0.5;
const HOOD_FILL_ALPHA = 0.92;
/** The patch's own square size. */
const HOOD_PATCH_SIZE = 0.05;
/** How far below the shoulder line the patch sits. */
const HOOD_PATCH_Y_DROP = 0.1;
const HOOD_PATCH_PROFILE_X = 0.05;
const HOOD_PATCH_FRONT_FRAC = 0.4;

function drawPatchedHood(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  ctx.fillStyle = rgba(spec.color, HOOD_FILL_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTRE_Y - HOOD_RISE, HOOD_RX, HOOD_RY, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // One visible patch, always on the shoulder — cheap and reads at any view.
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  const patchX = view === 'side' ? HOOD_PATCH_PROFILE_X : SHOULDER_HALF * HOOD_PATCH_FRONT_FRAC;
  ctx.fillRect(patchX, SHOULDER_Y + HOOD_PATCH_Y_DROP, HOOD_PATCH_SIZE, HOOD_PATCH_SIZE);
}

// ── Named-resident accessories ──────────────────────────────────────────────
//
// One-off cues for individual residents (`residentLooks.ts`), never worn by
// the random street crowd. Each pairs with a base garment the resident's own
// look picks, the same way an apron or tabard layers over one above.

const LEDGER_WIDTH = 0.06;
const LEDGER_HEIGHT = 0.08;
/** How far below the hip the ledger's own centre sits. */
const LEDGER_Y_DROP = 0.05;
const LEDGER_PROFILE_X = 0.03;
const LEDGER_FRONT_X_FRAC = 0.55;
const LEDGER_PENCIL_WIDTH = 0.01;
/** The pencil crosses the cover diagonally, corner to corner, scaled in from the true corners. */
const LEDGER_PENCIL_START_FRAC = 0.4;
const LEDGER_PENCIL_END_X_FRAC = 0.5;
const LEDGER_PENCIL_END_Y_FRAC = 0.35;

/** Wick's ledger and pencil, held at the hip. */
function drawLedgerPencil(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  if (view === 'back') return;
  const x = view === 'side' ? LEDGER_PROFILE_X : SHOULDER_HALF * LEDGER_FRONT_X_FRAC;
  const y = HIP_Y + LEDGER_Y_DROP;
  ctx.fillStyle = spec.color;
  ctx.fillRect(x - LEDGER_WIDTH / 2, y - LEDGER_HEIGHT / 2, LEDGER_WIDTH, LEDGER_HEIGHT);
  ctx.strokeStyle = spec.accentColor ?? shaded(spec.color);
  ctx.lineWidth = FINE_OUTLINE_WIDTH;
  ctx.strokeRect(x - LEDGER_WIDTH / 2, y - LEDGER_HEIGHT / 2, LEDGER_WIDTH, LEDGER_HEIGHT);
  ctx.strokeStyle = PENCIL_COLOR;
  ctx.lineWidth = LEDGER_PENCIL_WIDTH;
  ctx.beginPath();
  ctx.moveTo(
    x - LEDGER_WIDTH * LEDGER_PENCIL_START_FRAC,
    y - LEDGER_HEIGHT * LEDGER_PENCIL_START_FRAC,
  );
  ctx.lineTo(
    x + LEDGER_WIDTH * LEDGER_PENCIL_END_X_FRAC,
    y + LEDGER_HEIGHT * LEDGER_PENCIL_END_Y_FRAC,
  );
  ctx.stroke();
}

const SHAWL_TOP = SHOULDER_Y - 0.02;
const SHAWL_BOTTOM = HIP_Y + 0.05;
const SHAWL_PROFILE_HALF_WIDTH = 0.08;
/** Front-on the shawl reaches past the shoulders themselves, draping over them. */
const SHAWL_FRONT_WIDTH_SCALE = 1.15;
/** The hem gathers in from the shoulder line's own width. */
const SHAWL_HEM_TAPER = 0.7;
const SHAWL_CHARM_RADIUS = 0.014;
/** How far below the hem a charm hangs. */
const SHAWL_CHARM_DROP = 0.03;
const SHAWL_CHARM_PROFILE_X = 0.02;
const SHAWL_CHARM_FRONT_FRAC = 0.4;

/** Old Hilda's shawl, draped over both shoulders, with two hanging charm trinkets. */
function drawShawlCharms(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  const half = view === 'side' ? SHAWL_PROFILE_HALF_WIDTH : SHOULDER_HALF * SHAWL_FRONT_WIDTH_SCALE;
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  ctx.moveTo(-half, SHAWL_TOP);
  ctx.lineTo(half, SHAWL_TOP);
  ctx.lineTo(half * SHAWL_HEM_TAPER, SHAWL_BOTTOM);
  ctx.lineTo(-half * SHAWL_HEM_TAPER, SHAWL_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shaded(spec.color);
  ctx.lineWidth = PROP_STROKE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  const charmXs =
    view === 'side'
      ? [SHAWL_CHARM_PROFILE_X]
      : [-half * SHAWL_CHARM_FRONT_FRAC, half * SHAWL_CHARM_FRONT_FRAC];
  for (const cx of charmXs) {
    ctx.beginPath();
    ctx.arc(cx, SHAWL_BOTTOM + SHAWL_CHARM_DROP, SHAWL_CHARM_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

const FLOUR_FLECK_COLOR = 'rgba(255,255,255,0.55)';
const FLOUR_FLECK_RADIUS = 0.008;
/** Three fleck positions, each a fraction of the apron's own half-width/vertical span. */
const FLOUR_FLECKS: ReadonlyArray<readonly [xFrac: number, yOffset: number]> = [
  [-0.4, 0.06],
  [0.3, 0.14],
  [-0.15, -0.08],
];

/** Marta's apron, dusted white with flour flecks. */
function drawFlourApron(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  drawApron(ctx, view, spec);
  if (view === 'back') return;
  const half = view === 'side' ? APRON_PROFILE_HALF_WIDTH : APRON_HALF_WIDTH;
  ctx.fillStyle = FLOUR_FLECK_COLOR;
  for (const [xFrac, yOffset] of FLOUR_FLECKS) {
    const fy = yOffset >= 0 ? APRON_TOP + yOffset : APRON_BOTTOM + yOffset;
    ctx.beginPath();
    ctx.arc(half * xFrac, fy, FLOUR_FLECK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Two stoppered vials, side by side, riding just above the satchel's own pouch. */
const VIAL_SPACING_X = 0.02;
const VIAL_WIDTH = 0.012;
const VIAL_HEIGHT = 0.03;
/** How far above the pouch's own centre the vials sit. */
const VIAL_RISE_ABOVE_POUCH = 0.03;

/** Fen's satchel, with a rack of stoppered vials showing over the lip. */
function drawVialCase(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  drawSatchel(ctx, view, spec);
  if (view === 'side') return;
  const hipX = SHOULDER_HALF * SATCHEL_FRONT_HIP_FRAC;
  ctx.fillStyle = spec.accentColor ?? lit(spec.color);
  for (const dx of [-VIAL_SPACING_X, VIAL_SPACING_X]) {
    ctx.fillRect(
      hipX + dx - VIAL_WIDTH / 2,
      SATCHEL_POUCH_Y - VIAL_RISE_ABOVE_POUCH,
      VIAL_WIDTH,
      VIAL_HEIGHT,
    );
  }
}

/** How far below the hip the rule's own top end sits. */
const RULE_TOP_DROP = 0.02;
const RULE_ZIGZAG_WIDTH = 0.03;
/** The rule's three folding segments, each this tall. */
const RULE_SEGMENT_HEIGHT = 0.05;
const RULE_LINE_WIDTH = 0.014;
const RULE_FRONT_X_FRAC = 0.6;
const RULE_PROFILE_X = 0.04;
/** Wendell's folding rule at the belt — a builder's tool, not a farmer's. */
function drawBuilderRule(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  const x = view === 'side' ? RULE_PROFILE_X : SHOULDER_HALF * RULE_FRONT_X_FRAC;
  const topY = HIP_Y - RULE_TOP_DROP;
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = RULE_LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - RULE_ZIGZAG_WIDTH, topY);
  ctx.lineTo(x, topY + RULE_SEGMENT_HEIGHT);
  ctx.lineTo(x - RULE_ZIGZAG_WIDTH, topY + RULE_SEGMENT_HEIGHT * 2);
  ctx.lineTo(x, topY + RULE_SEGMENT_HEIGHT * 3);
  ctx.stroke();
}

type WornAccessoryKind = Exclude<AccessoryKind, 'none'>;

const ACCESSORY_PAINTERS: Readonly<
  Record<WornAccessoryKind, (ctx: Ctx, view: CardinalView, spec: AccessorySpec) => void>
> = {
  apron: drawApron,
  satchel: drawSatchel,
  tabard: drawTabard,
  brimmedHat: drawBrimmedHat,
  stole: drawStole,
  patchedHood: drawPatchedHood,
  ledgerPencil: drawLedgerPencil,
  shawlCharms: drawShawlCharms,
  flourApron: drawFlourApron,
  vialCase: drawVialCase,
  builderRule: drawBuilderRule,
};

/** Worn on the head, so painted where the solved head is rather than where it rests. */
const HEAD_ACCESSORIES: ReadonlySet<AccessoryKind> = new Set<AccessoryKind>([
  'brimmedHat',
  'patchedHood',
]);

/** Paints `spec`'s accessory, in figure-unit space, over an already-drawn body; head accessories are left to {@link drawHeadAccessory}. */
export function drawAccessory(ctx: Ctx, view: CardinalView, spec: AccessorySpec): void {
  if (spec.kind === 'none' || HEAD_ACCESSORIES.has(spec.kind)) return;
  ACCESSORY_PAINTERS[spec.kind](ctx, view, spec);
}

/**
 * Paints `spec`'s accessory if it is worn on the head, on a head whose centre
 * is `headCentre` in figure units: the painters place it on the resting head,
 * and a walk or a talk moves the head off that rest.
 */
export function drawHeadAccessory(
  ctx: Ctx,
  view: CardinalView,
  spec: AccessorySpec,
  headCentre: { readonly x: number; readonly y: number },
): void {
  if (spec.kind === 'none' || !HEAD_ACCESSORIES.has(spec.kind)) return;
  ctx.save();
  ctx.translate(headCentre.x, headCentre.y - HEAD_CENTRE_Y);
  ACCESSORY_PAINTERS[spec.kind](ctx, view, spec);
  ctx.restore();
}
