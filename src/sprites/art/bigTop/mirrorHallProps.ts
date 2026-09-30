/**
 * The hall of mirrors: the steerable cheval mirrors, the panes set into the
 * hall's walls and the funhouse reflections in them, the two limelights, the
 * beams they throw and the star targets in the dividing wall.
 *
 * Every still part is baked once per `(prop, state, frame)` through
 * `bigTopPropCache`; only what moves every frame — a glint running across the
 * glass, dust in a beam, a crawler's reflection, a flare where the light
 * strikes — is drawn live over the cached frame.
 *
 * Ownership is the tent's two-colour language: Carl's pivot mirrors are
 * circus blue and brass on a timber turntable, Donut's swivel mirrors are
 * red-and-white stripes on a gold spring mount.
 */

import type { BeamDirection, MirrorFacing, MirrorKind } from '../../../map/bigTopMazeLayout';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { drawRadialGlow, type GlowStop } from '../../radialGlow';
import { hashUnit } from '../../flameStamps';
import { fillSoftEllipse } from '../softShade';
import type { RGB } from '../town/townPalette';
import {
  drawBigTopProp,
  ONE_TILE_BOX,
  type BigTopPropBox,
  type BigTopPropCatalogueEntry,
} from './bigTopPropCache';
import {
  BACKSTAGE,
  BLOOD,
  BONE,
  BRASS,
  BRUISE,
  FULL_TURN,
  GILT_GLINT,
  HALF_TURN,
  IRON,
  LIMELIGHT,
  QUARTER_TURN,
  ROT_TIMBER,
  inkCurrentPath,
  loopFrame,
  outlineWidth,
  paintContactShadow,
  paintImpact,
  paintPulseHalo,
  pulseStrength,
  rgba,
} from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// ── State the system hands the art ──────────────────────────────────────────

/** How one steerable mirror currently looks. */
export interface MazeMirrorArt {
  readonly kind: MirrorKind;
  /** The two tile edges the glass connects, once the swing has settled. */
  readonly facing: MirrorFacing;
  /** The facing it is swinging away from; the same as `facing` while it stands still. */
  readonly fromFacing: MirrorFacing;
  /** How far through its swing it is: 0 as the blow lands, 1 once it has settled. */
  readonly turn: number;
  readonly phase: number;
  readonly struck: boolean;
  readonly pulsing: boolean;
}

// ── The cheval mirrors ──────────────────────────────────────────────────────

/**
 * The direction out of the silvered face, in screen radians (y down). A
 * facing names the two tile edges the glass connects, and the face looks
 * into the corner between them.
 */
const FACE_ANGLE: Readonly<Record<MirrorFacing, number>> = {
  NE: -Math.PI / 4,
  SE: Math.PI / 4,
  SW: (3 * Math.PI) / 4,
  NW: (-3 * Math.PI) / 4,
};

/** The swing is baked at this many headings round the turntable; every settled facing lands on one. */
const MIRROR_ANGLE_STEPS = 16;
/** A heavy frame overshoots its stop and settles back — this much of the swing, past the mark. */
const SWING_OVERSHOOT = 1.6;

/** The face angle part-way through a swing, eased so the frame arrives with a little overshoot. */
function swingAngle(art: MazeMirrorArt): number {
  const from = FACE_ANGLE[art.fromFacing];
  const to = FACE_ANGLE[art.facing];
  let delta = to - from;
  if (delta > HALF_TURN) delta -= FULL_TURN;
  if (delta < -HALF_TURN) delta += FULL_TURN;
  const t = Math.min(1, Math.max(0, art.turn));
  const shifted = t - 1;
  const eased = 1 + (SWING_OVERSHOOT + 1) * shifted ** 3 + SWING_OVERSHOOT * shifted ** 2;
  return from + delta * eased;
}

function angleStep(angle: number): number {
  const turns = angle / FULL_TURN;
  const step = Math.round(turns * MIRROR_ANGLE_STEPS);
  return ((step % MIRROR_ANGLE_STEPS) + MIRROR_ANGLE_STEPS) % MIRROR_ANGLE_STEPS;
}

/**
 * The glass at its tallest, the gleam it throws and the contact shadow, at
 * every heading, with a margin — on the bake grid, so the sixteen headings
 * blit one to one and stay small enough to sit resident together.
 */
const MIRROR_BOX: BigTopPropBox = { left: -0.0625, top: -1.125, width: 1.125, height: 2.1875 };

/** Half the glass's width along the floor, in tiles. */
const PANEL_HALF_WIDTH = 0.4;
/** A full-length glass: taller than a crawler. */
const PANEL_HEIGHT = 0.98;
/** The glass hangs clear of the turntable on its yoke. */
const PANEL_LIFT = 0.1;
/** How far the arched top rises above the straight sides. */
const PANEL_ARCH_RISE = 0.16;
const FRAME_WIDTH = 0.075;
const POST_WIDTH = 0.075;
const POST_OUTSET = 0.06;
/** The yoke's pivots sit a little above the middle of the glass, as a cheval's do. */
const PIVOT_HEIGHT_SHARE = 0.58;
const PIVOT_KNOB_RADIUS = 0.05;
/** A domed face's highlight sits a third of its radius up and left, toward the stage light. */
const DOME_HIGHLIGHT_DIVISOR = 3;
/** A gilt frame's lit bead runs down its middle, a third of the frame's width. */
const FRAME_BEAD_DIVISOR = 3;
/** Below this the glass is side-on to the viewer and neither face shows. */
const EDGE_ON_THRESHOLD = 0.08;

const TURNTABLE_RADIUS_X = 0.36;
const TURNTABLE_RADIUS_Y = 0.15;
const TURNTABLE_DEPTH = 0.05;
const TURNTABLE_RIM_WIDTH = 0.03;
const SPRING_BASE_RADIUS_X = 0.22;
const SPRING_BASE_RADIUS_Y = 0.1;
const SPRING_COILS = 3;
const SPRING_COIL_PITCH = 0.035;
const SPRING_COIL_WIDTH = 0.025;
/** The coils are this share of the spring mount's footprint. */
const SPRING_COIL_SHARE = 0.45;
const CONTACT_RADIUS_X = 0.44;
const CONTACT_RADIUS_Y = 0.2;
const CONTACT_ALPHA = 0.55;
/** The contact shadow falls down and right of the mirror, away from the stage light, in tiles. */
const CONTACT_OFFSET_X = 0.05;
const CONTACT_OFFSET_Y = 0.04;

/** The pale light the silvered face throws back onto the sawdust in front of it. */
const GLEAM_REACH = 0.36;
const GLEAM_RADIUS_X = 0.34;
const GLEAM_RADIUS_Y = 0.15;
const GLEAM_ALPHA = 0.4;
const GLEAM_COLOR: RGB = [226, 228, 244];

const SILVER_LIGHT: RGB = [222, 226, 238];
const SILVER_MID: RGB = [150, 154, 178];
const SILVER_DARK: RGB = [62, 58, 86];
const SILVER_MID_STOP = 0.45;
/** The hall's violet drapes, caught in the lower glass. */
const REFLECTED_DRAPE_SHARE = 0.38;
const REFLECTED_DRAPE_ALPHA = 0.42;
const SHEEN_BANDS: ReadonlyArray<{ at: number; width: number; alpha: number }> = [
  { at: 0.28, width: 0.09, alpha: 0.4 },
  { at: 0.44, width: 0.035, alpha: 0.3 },
];
/** Each sheen band slants left by this share of the glass's width from top to bottom. */
const SHEEN_SLANT = 0.5;
const BACK_PLANKS = 4;
/** Darker than the rot-timber ramp's shadow: boarding turned away from the stage light. */
const BACK_TIMBER: RGB = [30, 24, 20];
const BACK_SHADE_ALPHA = 0.38;
/** The back's shade at its top, as a share of its shade at the floor. */
const BACK_SHADE_TOP_SHARE = 0.5;
/** The back's plank seams run this many arch-rises past the glass's straight sides, so the clip always has boarding to show. */
const BACK_SEAM_ARCH_REACH = 3;
/** The barber-pole twist up a swivel mirror's post, as shares of the post's width. */
const BARBER_STRIPE_WIDTH = 0.6;
const BARBER_STRIPE_PITCH = 2.2;
const BARBER_STRIPE_SLANT = 0.6;
const BRACE_WIDTH = 0.05;

interface PanelGeometry {
  readonly normal: Vec2;
  /** Along the glass, left end to right end as seen from the front. */
  readonly along: Vec2;
  readonly bottomLeft: Vec2;
  readonly bottomRight: Vec2;
  readonly topLeft: Vec2;
  readonly topRight: Vec2;
  readonly archPeak: Vec2;
}

function panelGeometry(
  centreX: number,
  centreY: number,
  size: number,
  angle: number,
): PanelGeometry {
  const normal = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = { x: -normal.y, y: normal.x };
  const halfWidth = PANEL_HALF_WIDTH * size;
  const lift = PANEL_LIFT * size;
  const height = PANEL_HEIGHT * size;
  const bottomLeft = { x: centreX - along.x * halfWidth, y: centreY - along.y * halfWidth - lift };
  const bottomRight = { x: centreX + along.x * halfWidth, y: centreY + along.y * halfWidth - lift };
  const topLeft = { x: bottomLeft.x, y: bottomLeft.y - height };
  const topRight = { x: bottomRight.x, y: bottomRight.y - height };
  const archPeak = {
    x: (topLeft.x + topRight.x) / 2,
    y: (topLeft.y + topRight.y) / 2 - PANEL_ARCH_RISE * size * 2,
  };
  return { normal, along, bottomLeft, bottomRight, topLeft, topRight, archPeak };
}

function tracePanel(ctx: Ctx, panel: PanelGeometry): void {
  ctx.beginPath();
  ctx.moveTo(panel.bottomLeft.x, panel.bottomLeft.y);
  ctx.lineTo(panel.bottomRight.x, panel.bottomRight.y);
  ctx.lineTo(panel.topRight.x, panel.topRight.y);
  ctx.quadraticCurveTo(panel.archPeak.x, panel.archPeak.y, panel.topLeft.x, panel.topLeft.y);
  ctx.closePath();
}

function traceArch(ctx: Ctx, panel: PanelGeometry): void {
  ctx.beginPath();
  ctx.moveTo(panel.topRight.x, panel.topRight.y);
  ctx.quadraticCurveTo(panel.archPeak.x, panel.archPeak.y, panel.topLeft.x, panel.topLeft.y);
}

interface MirrorLook {
  readonly frame: RGB;
  readonly frameLight: RGB;
  readonly post: RGB;
  readonly postLight: RGB;
}

const PIVOT_LOOK: MirrorLook = {
  frame: BRASS.mid,
  frameLight: BRASS.accent,
  post: ROT_TIMBER.mid,
  postLight: ROT_TIMBER.light,
};
const SWIVEL_LOOK: MirrorLook = {
  frame: BRASS.light,
  frameLight: GILT_GLINT,
  post: BONE.light,
  postLight: BONE.accent,
};

function paintSilverFace(ctx: Ctx, panel: PanelGeometry, size: number): void {
  const left = Math.min(panel.topLeft.x, panel.topRight.x);
  const right = Math.max(panel.bottomLeft.x, panel.bottomRight.x);
  const top = panel.archPeak.y;
  const bottom = Math.max(panel.bottomLeft.y, panel.bottomRight.y);
  const silver = ctx.createLinearGradient(left, top, right, bottom);
  silver.addColorStop(0, rgba(SILVER_LIGHT, 1));
  silver.addColorStop(SILVER_MID_STOP, rgba(SILVER_MID, 1));
  silver.addColorStop(1, rgba(SILVER_DARK, 1));
  ctx.fillStyle = silver;
  tracePanel(ctx, panel);
  ctx.fill();
  ctx.save();
  try {
    tracePanel(ctx, panel);
    ctx.clip();
    const drapeTop = bottom - (bottom - top) * REFLECTED_DRAPE_SHARE;
    const drape = ctx.createLinearGradient(0, drapeTop, 0, bottom);
    drape.addColorStop(0, rgba(BRUISE.mid, 0));
    drape.addColorStop(1, rgba(BRUISE.shadow, REFLECTED_DRAPE_ALPHA));
    ctx.fillStyle = drape;
    ctx.fillRect(left, drapeTop, right - left, bottom - drapeTop);
    // Diagonal sheen bands, falling from upper left like the stage light.
    const span = right - left;
    for (const band of SHEEN_BANDS) {
      const x = left + span * band.at;
      const width = size * band.width;
      ctx.fillStyle = rgba(GILT_GLINT, band.alpha);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + width, top);
      ctx.lineTo(x + width - span * SHEEN_SLANT, bottom);
      ctx.lineTo(x - span * SHEEN_SLANT, bottom);
      ctx.closePath();
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * The back of either kind of mirror is dark timber boarding, never anything
 * that could pass for glass: light that lands on it stops, and the player has
 * to be able to see that before the beam proves it. Ownership survives on the
 * bracing — Carl's is iron, Donut's a red-painted batten.
 */
function paintDullBack(ctx: Ctx, panel: PanelGeometry, size: number, kind: MirrorKind): void {
  ctx.save();
  try {
    tracePanel(ctx, panel);
    ctx.clip();
    ctx.fillStyle = rgba(BACK_TIMBER, 1);
    tracePanel(ctx, panel);
    ctx.fill();
    const reach = PANEL_HEIGHT * size + PANEL_ARCH_RISE * size * BACK_SEAM_ARCH_REACH;
    const alongBottom = (t: number): Vec2 => ({
      x: panel.bottomLeft.x + (panel.bottomRight.x - panel.bottomLeft.x) * t,
      y: panel.bottomLeft.y + (panel.bottomRight.y - panel.bottomLeft.y) * t,
    });
    ctx.strokeStyle = rgba(BACKSTAGE.mid, 1);
    ctx.lineWidth = outlineWidth(size);
    for (let seam = 1; seam < BACK_PLANKS; seam++) {
      const foot = alongBottom(seam / BACK_PLANKS);
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(foot.x, foot.y - reach);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(kind === 'swivel_mirror' ? BLOOD.mid : IRON.light, 1);
    ctx.lineWidth = BRACE_WIDTH * size;
    ctx.beginPath();
    ctx.moveTo(panel.bottomLeft.x, panel.bottomLeft.y);
    ctx.lineTo(panel.topRight.x, panel.topRight.y);
    if (kind === 'pivot_mirror') {
      ctx.moveTo(panel.bottomRight.x, panel.bottomRight.y);
      ctx.lineTo(panel.topLeft.x, panel.topLeft.y);
    }
    ctx.stroke();
    // Matte and turned away from the stage light: darker toward the floor.
    const top = panel.archPeak.y;
    const bottom = Math.max(panel.bottomLeft.y, panel.bottomRight.y);
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, rgba(BACKSTAGE.shadow, BACK_SHADE_ALPHA * BACK_SHADE_TOP_SHARE));
    shade.addColorStop(1, rgba(BACKSTAGE.shadow, BACK_SHADE_ALPHA));
    ctx.fillStyle = shade;
    ctx.fillRect(
      Math.min(panel.topLeft.x, panel.topRight.x),
      top,
      Math.abs(panel.topRight.x - panel.topLeft.x),
      bottom - top,
    );
  } finally {
    ctx.restore();
  }
}

function paintPost(
  ctx: Ctx,
  foot: Vec2,
  pivotY: number,
  size: number,
  look: MirrorLook,
  kind: MirrorKind,
): void {
  const width = POST_WIDTH * size;
  const post = ctx.createLinearGradient(foot.x - width / 2, 0, foot.x + width / 2, 0);
  post.addColorStop(0, rgba(look.postLight, 1));
  post.addColorStop(1, rgba(look.post, 1));
  ctx.fillStyle = post;
  ctx.beginPath();
  ctx.rect(foot.x - width / 2, pivotY, width, foot.y - pivotY);
  ctx.fill();
  if (kind === 'swivel_mirror') {
    // A barber-pole twist of red up Donut's gold-capped posts.
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(foot.x - width / 2, pivotY, width, foot.y - pivotY);
      ctx.clip();
      ctx.strokeStyle = rgba(BLOOD.mid, 1);
      ctx.lineWidth = width * BARBER_STRIPE_WIDTH;
      const pitch = width * BARBER_STRIPE_PITCH;
      for (let y = foot.y; y > pivotY - pitch; y -= pitch) {
        ctx.beginPath();
        ctx.moveTo(foot.x - width, y);
        ctx.lineTo(foot.x + width, y - pitch * BARBER_STRIPE_SLANT);
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.rect(foot.x - width / 2, pivotY, width, foot.y - pivotY);
  inkCurrentPath(ctx, size);
}

function paintPivotKnob(ctx: Ctx, at: Vec2, size: number, look: MirrorLook): void {
  const radius = PIVOT_KNOB_RADIUS * size;
  const knob = ctx.createRadialGradient(
    at.x - radius / DOME_HIGHLIGHT_DIVISOR,
    at.y - radius / DOME_HIGHLIGHT_DIVISOR,
    0,
    at.x,
    at.y,
    radius,
  );
  knob.addColorStop(0, rgba(GILT_GLINT, 1));
  knob.addColorStop(1, rgba(look.frame, 1));
  ctx.fillStyle = knob;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_TURN);
  ctx.fill();
  inkCurrentPath(ctx, size);
}

function paintMirrorBase(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  kind: MirrorKind,
): void {
  if (kind === 'pivot_mirror') {
    const radiusX = TURNTABLE_RADIUS_X * size;
    const radiusY = TURNTABLE_RADIUS_Y * size;
    const depth = TURNTABLE_DEPTH * size;
    ctx.fillStyle = rgba(ROT_TIMBER.shadow, 1);
    ctx.beginPath();
    ctx.ellipse(centreX, centreY + depth, radiusX, radiusY, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.fillRect(centreX - radiusX, centreY, radiusX * 2, depth);
    const top = ctx.createLinearGradient(
      centreX - radiusX,
      centreY - radiusY,
      centreX + radiusX,
      centreY + radiusY,
    );
    top.addColorStop(0, rgba(ROT_TIMBER.light, 1));
    top.addColorStop(1, rgba(ROT_TIMBER.mid, 1));
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(centreX, centreY, radiusX, radiusY, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.strokeStyle = rgba(BRASS.mid, 1);
    ctx.lineWidth = Math.max(1, size * TURNTABLE_RIM_WIDTH);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(centreX, centreY + depth / 2, radiusX, radiusY + depth / 2, 0, 0, FULL_TURN);
    inkCurrentPath(ctx, size);
    return;
  }
  const radiusX = SPRING_BASE_RADIUS_X * size;
  const radiusY = SPRING_BASE_RADIUS_Y * size;
  ctx.fillStyle = rgba(BRASS.light, 1);
  ctx.beginPath();
  ctx.ellipse(centreX, centreY, radiusX, radiusY, 0, 0, FULL_TURN);
  ctx.fill();
  inkCurrentPath(ctx, size);
  ctx.strokeStyle = rgba(GILT_GLINT, 1);
  ctx.lineWidth = Math.max(1, size * SPRING_COIL_WIDTH);
  for (let coil = 0; coil < SPRING_COILS; coil++) {
    ctx.beginPath();
    ctx.ellipse(
      centreX,
      centreY - (coil + 1) * SPRING_COIL_PITCH * size,
      radiusX * SPRING_COIL_SHARE,
      radiusY * SPRING_COIL_SHARE,
      0,
      0,
      FULL_TURN,
    );
    ctx.stroke();
  }
}

function paintChevalMirror(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  kind: MirrorKind,
  angle: number,
): void {
  const centreX = originX + size / 2;
  const centreY = originY + size / 2;
  const look = kind === 'pivot_mirror' ? PIVOT_LOOK : SWIVEL_LOOK;
  const panel = panelGeometry(centreX, centreY, size, angle);

  paintContactShadow(
    ctx,
    centreX + size * CONTACT_OFFSET_X,
    centreY + size * CONTACT_OFFSET_Y,
    CONTACT_RADIUS_X * size,
    CONTACT_RADIUS_Y * size,
    CONTACT_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    centreX + panel.normal.x * GLEAM_REACH * size,
    centreY + panel.normal.y * GLEAM_REACH * size,
    GLEAM_RADIUS_X * size,
    GLEAM_RADIUS_Y * size,
    rgba(GLEAM_COLOR, 1),
    GLEAM_ALPHA,
    Math.atan2(panel.along.y, panel.along.x),
  );
  paintMirrorBase(ctx, centreX, centreY, size, kind);

  const outset = (PANEL_HALF_WIDTH + POST_OUTSET) * size;
  const feet = [
    { x: centreX - panel.along.x * outset, y: centreY - panel.along.y * outset },
    { x: centreX + panel.along.x * outset, y: centreY + panel.along.y * outset },
  ];
  const pivotLift = (PANEL_LIFT + PANEL_HEIGHT * PIVOT_HEIGHT_SHARE) * size;
  const [farFoot, nearFoot] = feet[0].y <= feet[1].y ? [feet[0], feet[1]] : [feet[1], feet[0]];
  paintPost(ctx, farFoot, farFoot.y - pivotLift, size, look, kind);

  const facing = panel.normal.y;
  if (facing > EDGE_ON_THRESHOLD) paintSilverFace(ctx, panel, size);
  else if (facing < -EDGE_ON_THRESHOLD) paintDullBack(ctx, panel, size, kind);

  ctx.strokeStyle = rgba(look.frame, 1);
  ctx.lineWidth = FRAME_WIDTH * size;
  ctx.lineJoin = 'round';
  tracePanel(ctx, panel);
  ctx.stroke();
  ctx.strokeStyle = rgba(look.frameLight, 1);
  ctx.lineWidth = (FRAME_WIDTH * size) / FRAME_BEAD_DIVISOR;
  traceArch(ctx, panel);
  ctx.stroke();
  ctx.save();
  try {
    ctx.lineWidth = FRAME_WIDTH * size + outlineWidth(size) * 2;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    tracePanel(ctx, panel);
    ctx.stroke();
  } finally {
    ctx.restore();
  }

  paintPost(ctx, nearFoot, nearFoot.y - pivotLift, size, look, kind);
  paintPivotKnob(ctx, { x: farFoot.x, y: farFoot.y - pivotLift }, size, look);
  paintPivotKnob(ctx, { x: nearFoot.x, y: nearFoot.y - pivotLift }, size, look);
}

function mirrorEntry(kind: MirrorKind, step: number): BigTopPropCatalogueEntry {
  const angle = (step / MIRROR_ANGLE_STEPS) * FULL_TURN;
  return {
    key: { prop: 'chevalMirror', state: kind, frame: step },
    box: MIRROR_BOX,
    painter: (target, originX, originY, px) =>
      paintChevalMirror(target, originX, originY, px, kind, angle),
  };
}

const MIRROR_GLINT_PERIOD_FRAMES = 150;
const MIRROR_GLINT_WIDTH = 0.1;
const MIRROR_GLINT_ALPHA = 0.55;
/** The glint slants left by this share of the glass's width, and starts that far off the glass so it slides on cleanly. */
const MIRROR_GLINT_SLANT = 0.6;
/** A landed blow flashes this share of the glass's height up the mirror. */
const IMPACT_HEIGHT_SHARE = 0.4;

/** A steerable mirror: a full-length gilded glass swung on a yoke, its silvered face and dull back told apart at a glance. */
export function drawMazeMirror(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: MazeMirrorArt,
): void {
  const angle = swingAngle(art);
  const step = angleStep(angle);
  const bakedAngle = (step / MIRROR_ANGLE_STEPS) * FULL_TURN;
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const look = art.kind === 'pivot_mirror' ? PIVOT_LOOK : SWIVEL_LOOK;

  paintPulseHalo(
    ctx,
    centreX,
    centreY,
    size,
    pulseStrength(art.phase, art.pulsing),
    look.frameLight,
  );
  const entry = mirrorEntry(art.kind, step);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);

  const panel = panelGeometry(centreX, centreY, size, bakedAngle);
  if (panel.normal.y > EDGE_ON_THRESHOLD) {
    const travel = (art.phase % MIRROR_GLINT_PERIOD_FRAMES) / MIRROR_GLINT_PERIOD_FRAMES;
    const left = Math.min(panel.topLeft.x, panel.topRight.x);
    const right = Math.max(panel.topLeft.x, panel.topRight.x);
    const top = panel.archPeak.y;
    const bottom = Math.max(panel.bottomLeft.y, panel.bottomRight.y);
    const span = right - left;
    const glintX = left - span * MIRROR_GLINT_SLANT + span * 2 * travel;
    ctx.save();
    try {
      tracePanel(ctx, panel);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(GILT_GLINT, MIRROR_GLINT_ALPHA);
      ctx.beginPath();
      ctx.moveTo(glintX, top);
      ctx.lineTo(glintX + size * MIRROR_GLINT_WIDTH, top);
      ctx.lineTo(glintX + size * MIRROR_GLINT_WIDTH - span * MIRROR_GLINT_SLANT, bottom);
      ctx.lineTo(glintX - span * MIRROR_GLINT_SLANT, bottom);
      ctx.closePath();
      ctx.fill();
    } finally {
      ctx.restore();
    }
  }
  if (art.struck)
    paintImpact(ctx, centreX, centreY - size * PANEL_HEIGHT * IMPACT_HEIGHT_SHARE, size);
}

// ── A swivel's other setting ────────────────────────────────────────────────

/** How far out from the mount's centre the facing wedges sit on the floor, in tiles. */
const FACING_WEDGE_REACH = 0.36;
/** The floor is seen at a slant: a wedge's distance down-screen is squashed to this share. */
const FACING_WEDGE_FLOOR_SQUASH = 0.55;
const FACING_WEDGE_LENGTH = 0.2;
const FACING_WEDGE_HALF_WIDTH = 0.13;
/** The other setting's wedge is hollow: a light line this many outlines thick on a dark one twice that. */
const GHOST_WEDGE_LINE_OUTLINES = 2;
const GHOST_OUTLINE_ALPHA = 0.9;
const GHOST_GLASS_ALPHA = 0.22;
/** Dash and gap of the ghost's outline, as shares of the tile. */
const GHOST_DASH = 0.07;
const GHOST_GAP = 0.05;
/**
 * Two facings are back to back when their faces point opposite ways: the
 * cosine of the angle between them is within this of -1. Their glass lies on
 * one line, so a ghost of the other would sit exactly on the real one.
 */
const BACK_TO_BACK_TOLERANCE = 0.08;
const GHOST_GLASS_STYLE = rgba(SILVER_LIGHT, GHOST_GLASS_ALPHA);
const GHOST_DARK_STYLE = rgba(BACKSTAGE.shadow, GHOST_OUTLINE_ALPHA);
const GHOST_LIGHT_STYLE = rgba(BONE.accent, GHOST_OUTLINE_ALPHA);
const CURRENT_WEDGE_STYLE = rgba(GILT_GLINT, 1);
/** The marks' own frame, on the bake grid: the ghost glass rises as high as a mirror's, the wedges reach to the tile's edges. */
const SWIVEL_GHOST_BOX: BigTopPropBox = { left: -0.0625, top: -1, width: 1.125, height: 1.9375 };

function traceFacingWedge(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  angle: number,
): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle) * FACING_WEDGE_FLOOR_SQUASH;
  const length = Math.hypot(dirX, dirY);
  const unitX = dirX / length;
  const unitY = dirY / length;
  const baseX = centreX + dirX * FACING_WEDGE_REACH * size;
  const baseY = centreY + dirY * FACING_WEDGE_REACH * size;
  const halfWidth = FACING_WEDGE_HALF_WIDTH * size;
  ctx.beginPath();
  ctx.moveTo(
    baseX + unitX * FACING_WEDGE_LENGTH * size,
    baseY + unitY * FACING_WEDGE_LENGTH * size,
  );
  ctx.lineTo(baseX - unitY * halfWidth, baseY + unitX * halfWidth);
  ctx.lineTo(baseX + unitY * halfWidth, baseY - unitX * halfWidth);
  ctx.closePath();
}

/**
 * A swivel only ever snaps between two facings, and which two differs per
 * mirror, so both are marked round it: a solid gilt wedge where the glass
 * faces now, a hollow one where the next blow will turn it. When the two
 * facings are not back to back, the other setting's glass also stands as a
 * translucent dashed ghost. It is drawn over the mirror, so neither the
 * glass nor the turntable can hide a mark.
 */
function paintSwivelGhost(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  current: MirrorFacing,
  other: MirrorFacing,
): void {
  const centreX = originX + size / 2;
  const centreY = originY + size / 2;
  const currentAngle = FACE_ANGLE[current];
  const otherAngle = FACE_ANGLE[other];
  const backToBack = Math.abs(Math.cos(currentAngle - otherAngle) + 1) < BACK_TO_BACK_TOLERANCE;
  const line = outlineWidth(size) * GHOST_WEDGE_LINE_OUTLINES;
  ctx.save();
  try {
    ctx.lineJoin = 'round';
    if (!backToBack) {
      const ghost = panelGeometry(centreX, centreY, size, otherAngle);
      tracePanel(ctx, ghost);
      ctx.fillStyle = GHOST_GLASS_STYLE;
      ctx.fill();
      ctx.setLineDash([GHOST_DASH * size, GHOST_GAP * size]);
      ctx.lineWidth = line * 2;
      ctx.strokeStyle = GHOST_DARK_STYLE;
      ctx.stroke();
      ctx.lineWidth = line;
      ctx.strokeStyle = GHOST_LIGHT_STYLE;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    traceFacingWedge(ctx, centreX, centreY, size, otherAngle);
    ctx.lineWidth = line * 2;
    ctx.strokeStyle = GHOST_DARK_STYLE;
    ctx.stroke();
    ctx.lineWidth = line;
    ctx.strokeStyle = GHOST_LIGHT_STYLE;
    ctx.stroke();
    traceFacingWedge(ctx, centreX, centreY, size, currentAngle);
    ctx.fillStyle = CURRENT_WEDGE_STYLE;
    ctx.fill();
    ctx.lineWidth = line;
    ctx.strokeStyle = GHOST_DARK_STYLE;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

const swivelGhostEntries = new Map<string, BigTopPropCatalogueEntry>();

function swivelGhostEntry(current: MirrorFacing, other: MirrorFacing): BigTopPropCatalogueEntry {
  const state = `${current}-${other}`;
  const known = swivelGhostEntries.get(state);
  if (known !== undefined) return known;
  const entry: BigTopPropCatalogueEntry = {
    key: { prop: 'swivelGhost', state, frame: 0 },
    box: SWIVEL_GHOST_BOX,
    painter: (target, originX, originY, px) =>
      paintSwivelGhost(target, originX, originY, px, current, other),
  };
  swivelGhostEntries.set(state, entry);
  return entry;
}

/**
 * The marks of a swivel's two settings, baked per pair of facings. Draw it
 * after `drawMazeMirror` on the same tile.
 */
export function drawSwivelFacingGhost(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  current: MirrorFacing,
  other: MirrorFacing,
): void {
  if (current === other) return;
  const entry = swivelGhostEntry(current, other);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
}

/** A swivel mirror with both its settings shown: the glass, then the marks of both facings over it. */
export function drawSwivelMirrorWithGhost(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: MazeMirrorArt,
  otherFacing: MirrorFacing,
): void {
  drawMazeMirror(ctx, x, y, size, art);
  drawSwivelFacingGhost(ctx, x, y, size, art.facing, otherFacing);
}

// ── The panes in the hall's walls, and what they reflect ────────────────────

const PANE_VARIANTS = 3;
const PANE_INSET = 0.1;
const PANE_FRAME_WIDTH = 0.085;
const PANE_CREST_RADIUS = 0.09;
const PANE_GLASS_TOP: RGB = [118, 112, 150];
const PANE_GLASS_BOTTOM: RGB = [30, 24, 44];
const PANE_LAMP_REFLECTION_ALPHA = 0.35;
const PANE_SHADOW_OFFSET = 0.05;
const PANE_SHADOW_ALPHA = 0.55;
/** The frame's drop shadow is thicker than the frame itself, so it shows past the frame's lower edge. */
const PANE_SHADOW_WIDTH_SCALE = 1.4;
/** A crest pane's arch is this fraction of its width deep: flatter than an arch pane's. */
const PANE_CREST_ARCH_DIVISOR = 4;
/** The crest sits this share of its radius below the glass's top. */
const PANE_CREST_DROP = 0.3;
/** The far lamp reflected in a pane, as shares of the glass. */
const PANE_LAMP_X = 0.3;
const PANE_LAMP_Y = 0.28;
const PANE_LAMP_RADIUS_X = 0.28;
const PANE_LAMP_RADIUS_Y = 0.2;

type PaneShape = 'arch' | 'oval' | 'crest';
const PANE_SHAPES: ReadonlyArray<PaneShape> = ['arch', 'oval', 'crest'];

function paneVariant(seed: number): number {
  return Math.floor(hashUnit(seed, PANE_VARIANTS) * PANE_VARIANTS) % PANE_VARIANTS;
}

/** The glass of a pane, in pixels: where the reflection is clipped to. */
export interface PaneGlass {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function paneGlassRect(x: number, y: number, size: number): PaneGlass {
  const inset = size * (PANE_INSET + PANE_FRAME_WIDTH / 2);
  return { left: x + inset, top: y + inset, width: size - inset * 2, height: size - inset * 2 };
}

function tracePaneGlass(ctx: Ctx, glass: PaneGlass, shape: PaneShape): void {
  ctx.beginPath();
  if (shape === 'oval') {
    ctx.ellipse(
      glass.left + glass.width / 2,
      glass.top + glass.height / 2,
      glass.width / 2,
      glass.height / 2,
      0,
      0,
      FULL_TURN,
    );
    return;
  }
  const archDepth = shape === 'arch' ? glass.width / 2 : glass.width / PANE_CREST_ARCH_DIVISOR;
  ctx.moveTo(glass.left, glass.top + glass.height);
  ctx.lineTo(glass.left, glass.top + archDepth);
  ctx.quadraticCurveTo(
    glass.left + glass.width / 2,
    glass.top - archDepth / 2,
    glass.left + glass.width,
    glass.top + archDepth,
  );
  ctx.lineTo(glass.left + glass.width, glass.top + glass.height);
  ctx.closePath();
}

function paintPane(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  shape: PaneShape,
): void {
  const glass = paneGlassRect(originX, originY, size);
  const offset = PANE_SHADOW_OFFSET * size;
  ctx.save();
  try {
    ctx.translate(offset, offset);
    tracePaneGlass(ctx, glass, shape);
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, PANE_SHADOW_ALPHA);
    ctx.lineWidth = PANE_FRAME_WIDTH * size * PANE_SHADOW_WIDTH_SCALE;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
  const fill = ctx.createLinearGradient(0, glass.top, 0, glass.top + glass.height);
  fill.addColorStop(0, rgba(PANE_GLASS_TOP, 1));
  fill.addColorStop(1, rgba(PANE_GLASS_BOTTOM, 1));
  ctx.fillStyle = fill;
  tracePaneGlass(ctx, glass, shape);
  ctx.fill();
  ctx.save();
  try {
    tracePaneGlass(ctx, glass, shape);
    ctx.clip();
    // A far lamp caught high in the glass, up and left where the stage light is.
    fillSoftEllipse(
      ctx,
      glass.left + glass.width * PANE_LAMP_X,
      glass.top + glass.height * PANE_LAMP_Y,
      glass.width * PANE_LAMP_RADIUS_X,
      glass.height * PANE_LAMP_RADIUS_Y,
      rgba(LIMELIGHT.light, 1),
      PANE_LAMP_REFLECTION_ALPHA,
    );
  } finally {
    ctx.restore();
  }
  ctx.strokeStyle = rgba(BRASS.mid, 1);
  ctx.lineWidth = PANE_FRAME_WIDTH * size;
  tracePaneGlass(ctx, glass, shape);
  ctx.stroke();
  ctx.strokeStyle = rgba(BRASS.accent, 1);
  ctx.lineWidth = (PANE_FRAME_WIDTH * size) / FRAME_BEAD_DIVISOR;
  ctx.stroke();
  if (shape === 'crest') {
    const crestX = glass.left + glass.width / 2;
    const crestY = glass.top + PANE_CREST_RADIUS * size * PANE_CREST_DROP;
    ctx.fillStyle = rgba(BRASS.light, 1);
    ctx.beginPath();
    ctx.arc(crestX, crestY, PANE_CREST_RADIUS * size, HALF_TURN, FULL_TURN);
    ctx.closePath();
    ctx.fill();
    inkCurrentPath(ctx, size);
  }
  ctx.save();
  try {
    ctx.lineWidth = PANE_FRAME_WIDTH * size + outlineWidth(size) * 2;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    tracePaneGlass(ctx, glass, shape);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function paneEntry(shape: PaneShape): BigTopPropCatalogueEntry {
  return {
    key: { prop: 'hallPane', state: shape, frame: 0 },
    box: ONE_TILE_BOX,
    painter: (target, originX, originY, px) => paintPane(target, originX, originY, px, shape),
  };
}

const PANE_GLINT_PERIOD_FRAMES = 480;
const PANE_GLINT_WIDTH = 0.12;
const PANE_GLINT_ALPHA = 0.3;
/** The glint slants left by this share of the glass's width, and starts that far off the glass. */
const PANE_GLINT_SLANT = 0.5;

/** A pane set into the hall's wall: dark silvered glass in a gilt frame, a glint running across it. */
export function drawMirrorHallPane(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  seed: number,
  phase: number,
): void {
  const shape = PANE_SHAPES[paneVariant(seed)] ?? 'arch';
  const entry = paneEntry(shape);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
  const glass = paneGlassRect(x, y, size);
  const travel =
    ((phase + hashUnit(seed, seed) * PANE_GLINT_PERIOD_FRAMES) % PANE_GLINT_PERIOD_FRAMES) /
    PANE_GLINT_PERIOD_FRAMES;
  ctx.save();
  try {
    tracePaneGlass(ctx, glass, shape);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(GILT_GLINT, PANE_GLINT_ALPHA);
    const glintX = glass.left - glass.width * PANE_GLINT_SLANT + glass.width * 2 * travel;
    ctx.beginPath();
    ctx.moveTo(glintX, glass.top);
    ctx.lineTo(glintX + size * PANE_GLINT_WIDTH, glass.top);
    ctx.lineTo(
      glintX + size * PANE_GLINT_WIDTH - glass.width * PANE_GLINT_SLANT,
      glass.top + glass.height,
    );
    ctx.lineTo(glintX - glass.width * PANE_GLINT_SLANT, glass.top + glass.height);
    ctx.closePath();
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/**
 * A crawler's current frame, painted once into a scratch surface so it can be
 * blitted into several panes. The figure is painted opaque and the panes blit
 * it translucent: a crawler's own render sets absolute alpha for its hit
 * flash and status coats, so painting it straight into the glass at a reduced
 * alpha would pop to full strength whenever it flashed.
 */
export interface ReflectionSource {
  readonly surface: CanvasSurface;
  /** Device pixels per tile the figure was painted at. */
  readonly pxPerTile: number;
}

/** The figure's tile sits this far into the scratch surface, in tiles: room for a head above and a tail either side. */
const REFLECTION_SOURCE_PAD_X = 0.5;
const REFLECTION_SOURCE_PAD_TOP = 1;
const REFLECTION_SOURCE_TILES_WIDE = 2;
const REFLECTION_SOURCE_TILES_HIGH = 2;

const reflectionScratch = new Map<number, CanvasSurface>();

/** Drops the reflection scratch surfaces, e.g. when the party leaves the tent. */
export function clearReflectionScratch(): void {
  reflectionScratch.clear();
}

/**
 * Paints `paintFigure` (the crawler's body at its current frame, top-left of
 * its tile at the given point) into scratch surface `slot`. One surface per
 * crawler, reused every frame.
 */
export function paintReflectionSource(
  ctx: Ctx,
  slot: number,
  size: number,
  paintFigure: (target: Ctx, x: number, y: number, tileSize: number) => void,
): ReflectionSource {
  const transform = ctx.getTransform();
  const deviceScale = Math.hypot(transform.a, transform.b);
  const pxPerTile = Math.max(1, Math.round(size * (deviceScale > 0 ? deviceScale : 1)));
  const width = pxPerTile * REFLECTION_SOURCE_TILES_WIDE;
  const height = pxPerTile * REFLECTION_SOURCE_TILES_HIGH;
  let surface = reflectionScratch.get(slot);
  if (surface?.width !== width || surface.height !== height) {
    surface = allocCanvas(width, height);
    reflectionScratch.set(slot, surface);
  }
  const target = surfaceContext(surface);
  target.save();
  try {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.scale(pxPerTile / size, pxPerTile / size);
    paintFigure(target, REFLECTION_SOURCE_PAD_X * size, REFLECTION_SOURCE_PAD_TOP * size, size);
  } finally {
    target.restore();
  }
  return { surface, pxPerTile };
}

/** How each pane shape bends what it shows: the hall's whole joke. */
const PANE_DISTORTION: Readonly<Record<PaneShape, { readonly x: number; readonly y: number }>> = {
  arch: { x: 0.6, y: 1.3 },
  oval: { x: 1.5, y: 0.62 },
  crest: { x: 1.15, y: 0.9 },
};
/** The glass is smaller than the crawler; before its bend, a reflection is drawn at this share of life size. */
const REFLECTION_SCALE = 0.85;
/** Where the crawler's body sits down the scratch surface: this point is centred in the glass, so a stretched reflection keeps its middle. */
const REFLECTION_BODY_MIDDLE = 0.72;
const REFLECTION_WOBBLE = 0.07;
const REFLECTION_WOBBLE_SPEED = 0.045;
const REFLECTION_ALPHA = 0.72;
/** How far a crawler's sideways offset from the pane slides its reflection, as a share of the tile. */
const REFLECTION_SLIDE = 0.18;
const REFLECTION_TINT_ALPHA = 0.22;

/**
 * Blits a crawler's reflection into a pane, mirrored, stretched or squashed
 * by the pane's shape, clipped to the glass and fading with distance. One
 * `drawImage`.
 */
export function drawPaneReflection(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  seed: number,
  phase: number,
  source: ReflectionSource,
  offsetTiles: number,
  strength: number,
): void {
  if (strength <= 0) return;
  const shape = PANE_SHAPES[paneVariant(seed)] ?? 'arch';
  const glass = paneGlassRect(x, y, size);
  const bend = PANE_DISTORTION[shape];
  const wobble = 1 + REFLECTION_WOBBLE * Math.sin(phase * REFLECTION_WOBBLE_SPEED + seed);
  const scaleX = bend.x * wobble;
  const scaleY = bend.y / wobble;
  const drawnWidth = REFLECTION_SOURCE_TILES_WIDE * size * scaleX * REFLECTION_SCALE;
  const drawnHeight = REFLECTION_SOURCE_TILES_HIGH * size * scaleY * REFLECTION_SCALE;
  const slide = Math.max(-1, Math.min(1, offsetTiles)) * REFLECTION_SLIDE * size;
  const centreX = glass.left + glass.width / 2 - slide;
  const bodyTop = glass.top + glass.height / 2 - drawnHeight * REFLECTION_BODY_MIDDLE;
  ctx.save();
  try {
    tracePaneGlass(ctx, glass, shape);
    ctx.clip();
    ctx.globalAlpha = REFLECTION_ALPHA * Math.min(1, strength);
    ctx.translate(centreX, bodyTop);
    ctx.scale(-1, 1);
    ctx.drawImage(
      source.surface,
      0,
      0,
      source.surface.width,
      source.surface.height,
      -drawnWidth / 2,
      0,
      drawnWidth,
      drawnHeight,
    );
    ctx.globalAlpha = REFLECTION_TINT_ALPHA * Math.min(1, strength);
    ctx.fillStyle = rgba(BRUISE.mid, 1);
    ctx.fillRect(-drawnWidth / 2, 0, drawnWidth, drawnHeight);
  } finally {
    ctx.restore();
  }
}

// ── Limelights ──────────────────────────────────────────────────────────────

const LIMELIGHT_BOX: BigTopPropBox = { left: -0.1, top: -0.75, width: 1.2, height: 1.85 };
const LIMELIGHT_FLAME_FRAMES = 4;
const LIMELIGHT_FLAME_PERIOD_FRAMES = 16;

const TRIPOD_HUB_Y = 0.2;
const TRIPOD_FOOT_Y = 0.92;
const TRIPOD_SPREAD = 0.34;
const TRIPOD_LEG_WIDTH = 0.045;
const LAMP_CENTRE_Y = -0.08;
const LAMP_BARREL_LENGTH = 0.62;
const LAMP_BARREL_RADIUS = 0.17;
const LAMP_LENS_RADIUS = 0.15;
const LAMP_CHIMNEY_WIDTH = 0.1;
const LAMP_CHIMNEY_HEIGHT = 0.18;
const LAMP_HOOD_LENGTH = 0.12;
const FLAME_WINDOW_RADIUS = 0.055;
const HEAT_WISP_HEIGHT = 0.22;
const HEAT_WISPS = 2;
const HEAT_WISP_WIDTH = 0.025;
const HEAT_WISP_ALPHA_BASE = 0.22;
const HEAT_WISP_ALPHA_FLICKER = 0.12;
/** How fast the heat wisps sway per flame frame, and how far out of step each wisp is, in radians. */
const HEAT_WISP_SWAY_SPEED = 1.7;
const HEAT_WISP_STAGGER = 2;
const HEAT_WISP_SWAY = 0.04;
/** The wisps leave the chimney this far apart and spread to twice that by mid-rise, in tiles. */
const HEAT_WISP_BASE_SPREAD = 0.04;
const HEAT_WISP_MID_SPREAD = 0.08;
/** The flame's brightness never dips below this share of full, and swings through the rest. */
const FLAME_FLICKER_FLOOR = 0.75;
const FLAME_FLICKER_RANGE = 0.25;
/** The gas jet's alpha: a floor plus a share that follows the flicker, written to this many decimals. */
const GAS_FLAME_ALPHA_BASE = 0.6;
const GAS_FLAME_ALPHA_FLICKER = 0.4;
const GAS_FLAME_ALPHA_DIGITS = 3;

/** The gas jet's blue-white, at its flickering alpha. */
function gasFlameFill(flicker: number): string {
  const alpha = GAS_FLAME_ALPHA_BASE + GAS_FLAME_ALPHA_FLICKER * flicker;
  return `rgba(150,200,255,${alpha.toFixed(GAS_FLAME_ALPHA_DIGITS)})`;
}

/** The chimney stands this share of the half-barrel back from the lamp's middle. */
const CHIMNEY_SET_BACK = 0.35;
const BARREL_HIGHLIGHT_STOP = 0.35;
/** The rear cap, seen a little end-on: its width as a share of the barrel's radius. */
const REAR_CAP_FORESHORTEN = 0.3;
/** The hood over the lens, as shares of the barrel's radius above its axis: back edge, then front. */
const HOOD_BACK_TOP = 1.15;
const HOOD_FRONT_TOP = 1.25;
const HOOD_FRONT_BOTTOM = 0.7;
const HOOD_BACK_BOTTOM = 0.6;
/** The lens seen side-on is squashed to this share of its width. */
const LENS_FORESHORTEN = 0.45;
const LENS_RIM_WIDTH = 0.04;
/** The mica window sits this share of the half-barrel back from the middle, and this share of the radius below the axis. */
const FLAME_WINDOW_SET_BACK = 0.2;
const FLAME_WINDOW_DROP = 0.2;
/** The gas jet inside the window, as shares of the barrel's radius and the window's. */
const GAS_FLAME_DROP = 0.25;
const GAS_FLAME_WIDTH_SHARE = 0.45;
const GAS_FLAME_HEIGHT_SHARE = 0.8;
/** Seen end-on, the barrel's round face is raised this share of its radius, the barrel dropping this deep below it. */
const END_ON_FACE_LIFT = 0.2;
const END_ON_BARREL_DEPTH = 1.2;
/** The rear leg stands this far up the floor from the front two, in tiles. */
const TRIPOD_REAR_FOOT_RISE = 0.08;
const TRIPOD_FOOT_SHADOW_OFFSET = 0.02;
const TRIPOD_FOOT_SHADOW_RADIUS_X = 0.08;
const TRIPOD_FOOT_SHADOW_RADIUS_Y = 0.035;
const TRIPOD_FOOT_SHADOW_ALPHA = 0.6;
const TRIPOD_COLUMN_HALF_WIDTH = 0.035;
const TRIPOD_COLUMN_WIDTH = 0.07;

/** The quicklime's white heat in the lens, warm at its rim. */
const LENS_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,252,240,1)' },
  { offset: 0.45, color: 'rgba(255,236,190,0.95)' },
  { offset: 1, color: 'rgba(248,190,110,0.9)' },
];

function paintTripod(ctx: Ctx, centreX: number, originY: number, size: number): void {
  const hubY = originY + TRIPOD_HUB_Y * size;
  const footY = originY + TRIPOD_FOOT_Y * size;
  ctx.lineCap = 'round';
  const legs = [-1, 0, 1];
  for (const leg of legs) {
    const footX = centreX + leg * TRIPOD_SPREAD * size;
    const legFootY = leg === 0 ? footY - size * TRIPOD_REAR_FOOT_RISE : footY;
    paintContactShadow(
      ctx,
      footX + size * TRIPOD_FOOT_SHADOW_OFFSET,
      legFootY,
      size * TRIPOD_FOOT_SHADOW_RADIUS_X,
      size * TRIPOD_FOOT_SHADOW_RADIUS_Y,
      TRIPOD_FOOT_SHADOW_ALPHA,
    );
    ctx.strokeStyle = rgba(leg === 0 ? IRON.shadow : IRON.mid, 1);
    ctx.lineWidth = TRIPOD_LEG_WIDTH * size + outlineWidth(size) * 2;
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    ctx.beginPath();
    ctx.moveTo(centreX, hubY);
    ctx.lineTo(footX, legFootY);
    ctx.stroke();
    ctx.lineWidth = TRIPOD_LEG_WIDTH * size;
    ctx.strokeStyle = rgba(leg < 0 ? IRON.light : IRON.mid, 1);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(BRASS.mid, 1);
  ctx.fillRect(
    centreX - size * TRIPOD_COLUMN_HALF_WIDTH,
    originY + LAMP_CENTRE_Y * size,
    size * TRIPOD_COLUMN_WIDTH,
    hubY - (originY + LAMP_CENTRE_Y * size),
  );
}

/**
 * A limelight on its tripod: a brass barrel aimed down the lane, the
 * quicklime glowing white in the lens, the gas jet burning blue through a
 * mica window, heat rising from the chimney.
 */
function paintLimelight(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  direction: BeamDirection,
  flameFrame: number,
): void {
  const centreX = originX + size / 2;
  paintTripod(ctx, centreX, originY, size);
  const lampY = originY + LAMP_CENTRE_Y * size;
  const radius = LAMP_BARREL_RADIUS * size;
  const halfLength = (LAMP_BARREL_LENGTH * size) / 2;
  const sideways = direction === 'east' || direction === 'west';
  const aim = direction === 'west' ? -1 : 1;
  const flicker =
    FLAME_FLICKER_FLOOR +
    FLAME_FLICKER_RANGE * Math.sin((flameFrame / LIMELIGHT_FLAME_FRAMES) * FULL_TURN);

  // Chimney first: it stands behind the barrel's top.
  const chimneyX = sideways ? centreX - aim * halfLength * CHIMNEY_SET_BACK : centreX;
  const chimneyTop = lampY - radius - LAMP_CHIMNEY_HEIGHT * size;
  ctx.fillStyle = rgba(IRON.mid, 1);
  ctx.beginPath();
  ctx.rect(
    chimneyX - (LAMP_CHIMNEY_WIDTH * size) / 2,
    chimneyTop,
    LAMP_CHIMNEY_WIDTH * size,
    LAMP_CHIMNEY_HEIGHT * size + radius,
  );
  ctx.fill();
  inkCurrentPath(ctx, size);
  ctx.strokeStyle = rgba(LIMELIGHT.light, HEAT_WISP_ALPHA_BASE + HEAT_WISP_ALPHA_FLICKER * flicker);
  ctx.lineWidth = Math.max(1, size * HEAT_WISP_WIDTH);
  for (let wisp = 0; wisp < HEAT_WISPS; wisp++) {
    const sway =
      Math.sin(flameFrame * HEAT_WISP_SWAY_SPEED + wisp * HEAT_WISP_STAGGER) *
      size *
      HEAT_WISP_SWAY;
    ctx.beginPath();
    ctx.moveTo(chimneyX + (wisp - 0.5) * size * HEAT_WISP_BASE_SPREAD, chimneyTop);
    ctx.quadraticCurveTo(
      chimneyX + sway + (wisp - 0.5) * size * HEAT_WISP_MID_SPREAD,
      chimneyTop - HEAT_WISP_HEIGHT * size * 0.5,
      chimneyX - sway,
      chimneyTop - HEAT_WISP_HEIGHT * size,
    );
    ctx.stroke();
  }

  if (sideways) {
    const rearX = centreX - aim * halfLength;
    const frontX = centreX + aim * halfLength;
    const body = ctx.createLinearGradient(0, lampY - radius, 0, lampY + radius);
    body.addColorStop(0, rgba(BRASS.accent, 1));
    body.addColorStop(BARREL_HIGHLIGHT_STOP, rgba(BRASS.light, 1));
    body.addColorStop(1, rgba(BRASS.shadow, 1));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.rect(Math.min(rearX, frontX), lampY - radius, halfLength * 2, radius * 2);
    ctx.fill();
    inkCurrentPath(ctx, size);
    // The rear cap, seen a little end-on.
    ctx.fillStyle = rgba(BRASS.mid, 1);
    ctx.beginPath();
    ctx.ellipse(rearX, lampY, radius * REAR_CAP_FORESHORTEN, radius, 0, 0, FULL_TURN);
    ctx.fill();
    inkCurrentPath(ctx, size);
    // The hood over the lens.
    ctx.fillStyle = rgba(IRON.shadow, 1);
    ctx.beginPath();
    ctx.moveTo(frontX, lampY - radius * HOOD_BACK_TOP);
    ctx.lineTo(frontX + aim * LAMP_HOOD_LENGTH * size, lampY - radius * HOOD_FRONT_TOP);
    ctx.lineTo(frontX + aim * LAMP_HOOD_LENGTH * size, lampY - radius * HOOD_FRONT_BOTTOM);
    ctx.lineTo(frontX, lampY - radius * HOOD_BACK_BOTTOM);
    ctx.closePath();
    ctx.fill();
    inkCurrentPath(ctx, size);
    // The lens, end-on as an ellipse, white with quicklime.
    ctx.save();
    try {
      ctx.translate(frontX, lampY);
      ctx.scale(LENS_FORESHORTEN, 1);
      drawRadialGlow(ctx, 0, 0, LAMP_LENS_RADIUS * size, LENS_STOPS);
      ctx.beginPath();
      ctx.arc(0, 0, LAMP_LENS_RADIUS * size, 0, FULL_TURN);
      ctx.strokeStyle = rgba(BRASS.accent, 1);
      ctx.lineWidth = Math.max(1, size * LENS_RIM_WIDTH);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
    // The gas jet, blue-white through its mica window.
    const windowX = centreX - aim * halfLength * FLAME_WINDOW_SET_BACK;
    ctx.fillStyle = rgba(BACKSTAGE.shadow, 1);
    ctx.beginPath();
    ctx.arc(windowX, lampY + radius * FLAME_WINDOW_DROP, FLAME_WINDOW_RADIUS * size, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = gasFlameFill(flicker);
    ctx.beginPath();
    ctx.ellipse(
      windowX,
      lampY + radius * GAS_FLAME_DROP,
      FLAME_WINDOW_RADIUS * size * GAS_FLAME_WIDTH_SHARE,
      FLAME_WINDOW_RADIUS * size * GAS_FLAME_HEIGHT_SHARE * flicker,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
    return;
  }

  // Aimed up or down the hall: the barrel seen end-on, lens toward the viewer
  // when it points south, the rear cap and burner when it points north.
  const lensFacing = direction === 'south';
  ctx.fillStyle = rgba(BRASS.shadow, 1);
  ctx.beginPath();
  ctx.rect(
    centreX - radius,
    lampY - radius * END_ON_FACE_LIFT,
    radius * 2,
    radius * END_ON_BARREL_DEPTH,
  );
  ctx.fill();
  const face = ctx.createRadialGradient(
    centreX - radius / DOME_HIGHLIGHT_DIVISOR,
    lampY - radius / DOME_HIGHLIGHT_DIVISOR,
    0,
    centreX,
    lampY,
    radius,
  );
  face.addColorStop(0, rgba(BRASS.accent, 1));
  face.addColorStop(1, rgba(BRASS.mid, 1));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(centreX, lampY - radius * END_ON_FACE_LIFT, radius, 0, FULL_TURN);
  ctx.fill();
  inkCurrentPath(ctx, size);
  if (lensFacing) {
    drawRadialGlow(
      ctx,
      centreX,
      lampY - radius * END_ON_FACE_LIFT,
      LAMP_LENS_RADIUS * size,
      LENS_STOPS,
    );
  } else {
    ctx.fillStyle = gasFlameFill(flicker);
    ctx.beginPath();
    ctx.arc(
      centreX,
      lampY - radius * END_ON_FACE_LIFT,
      FLAME_WINDOW_RADIUS * size * flicker,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
}

function limelightEntry(direction: BeamDirection, flameFrame: number): BigTopPropCatalogueEntry {
  return {
    key: { prop: 'limelight', state: direction, frame: flameFrame },
    box: LIMELIGHT_BOX,
    painter: (target, originX, originY, px) =>
      paintLimelight(target, originX, originY, px, direction, flameFrame),
  };
}

const LENS_BLOOM_RADIUS = 0.7;
const LENS_BLOOM_FLICKER_SPEED = 0.11;
const LENS_BLOOM_FLICKER_DEPTH = 0.18;
const LENS_BLOOM_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,244,214,0.55)' },
  { offset: 0.35, color: 'rgba(255,214,150,0.22)' },
  { offset: 1, color: 'rgba(255,190,110,0)' },
];

/** Where a limelight's lens sits on its tile, in tiles from the tile's top-left. */
export function limelightLensOffset(direction: BeamDirection): Vec2 {
  const halfLength = LAMP_BARREL_LENGTH / 2;
  if (direction === 'east') return { x: 0.5 + halfLength, y: LAMP_CENTRE_Y };
  if (direction === 'west') return { x: 0.5 - halfLength, y: LAMP_CENTRE_Y };
  return { x: 0.5, y: LAMP_CENTRE_Y - LAMP_BARREL_RADIUS * END_ON_FACE_LIFT };
}

/** A limelight projector on its tripod, lens aimed down the lane, with its warm bloom. */
export function drawMazeLimelight(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  direction: BeamDirection,
  phase: number,
): void {
  const flameFrame = loopFrame(phase, LIMELIGHT_FLAME_PERIOD_FRAMES, LIMELIGHT_FLAME_FRAMES);
  const entry = limelightEntry(direction, flameFrame);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
  const lens = limelightLensOffset(direction);
  const flicker =
    1 - LENS_BLOOM_FLICKER_DEPTH * (1 - Math.sin(phase * LENS_BLOOM_FLICKER_SPEED)) * 0.5;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flicker;
    drawRadialGlow(
      ctx,
      x + lens.x * size,
      y + lens.y * size,
      LENS_BLOOM_RADIUS * size,
      LENS_BLOOM_STOPS,
    );
  } finally {
    ctx.restore();
  }
}

// ── Beams ───────────────────────────────────────────────────────────────────

/**
 * The white-hot span and the cold gilded span, as bands across the beam from
 * its axis outward: the hot one is white at the core with a red-hot edge and
 * an ember bloom, the cold one gold through and through. Colour, width and
 * the speed of the dust in it all differ, so the two read apart at a glance.
 */
interface BeamBand {
  readonly halfWidth: number;
  readonly stops: ReadonlyArray<{
    readonly at: number;
    readonly color: RGB;
    readonly alpha: number;
  }>;
}

const HOT_BEAM: BeamBand = {
  halfWidth: 0.42,
  stops: [
    { at: 0, color: [255, 254, 246], alpha: 1 },
    { at: 0.26, color: [255, 246, 222], alpha: 0.98 },
    { at: 0.42, color: [255, 150, 70], alpha: 0.95 },
    { at: 0.56, color: [214, 40, 24], alpha: 0.8 },
    { at: 0.78, color: [255, 96, 40], alpha: 0.28 },
    { at: 1, color: [255, 96, 40], alpha: 0 },
  ],
};
const COLD_BEAM: BeamBand = {
  halfWidth: 0.3,
  stops: [
    { at: 0, color: [255, 250, 216], alpha: 1 },
    { at: 0.3, color: [255, 222, 116], alpha: 1 },
    { at: 0.62, color: [232, 172, 56], alpha: 0.95 },
    { at: 0.8, color: [196, 132, 40], alpha: 0.6 },
    { at: 1, color: [196, 132, 40], alpha: 0 },
  ],
};

function paintBeamBody(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  band: BeamBand,
  vertical: boolean,
): void {
  const centreX = originX + size / 2;
  const centreY = originY + size / 2;
  const half = band.halfWidth * size;
  const gradient = vertical
    ? ctx.createLinearGradient(centreX - half, 0, centreX + half, 0)
    : ctx.createLinearGradient(0, centreY - half, 0, centreY + half);
  // Mirrored about the axis: the stops run outward from the core both ways.
  const ordered = [...band.stops].reverse().map((stop) => ({ ...stop, at: 0.5 - stop.at / 2 }));
  const outward = band.stops.map((stop) => ({ ...stop, at: 0.5 + stop.at / 2 }));
  for (const stop of [...ordered, ...outward.slice(1)]) {
    gradient.addColorStop(stop.at, rgba(stop.color, stop.alpha));
  }
  ctx.fillStyle = gradient;
  if (vertical) ctx.fillRect(centreX - half, originY, half * 2, size);
  else ctx.fillRect(originX, centreY - half, size, half * 2);
}

/** A beam tile runs on into the next along its own axis, and must fade to nothing across it. */
function beamEntry(hot: boolean, vertical: boolean): BigTopPropCatalogueEntry {
  const band = hot ? HOT_BEAM : COLD_BEAM;
  return {
    key: {
      prop: 'limelightBeam',
      state: `${hot ? 'hot' : 'cold'}-${vertical ? 'v' : 'h'}`,
      frame: 0,
    },
    box: ONE_TILE_BOX,
    painter: (target, originX, originY, px) =>
      paintBeamBody(target, originX, originY, px, band, vertical),
    openEdges: vertical ? ['top', 'bottom'] : ['left', 'right'],
  };
}

const BEAM_MOTES = 3;
const HOT_MOTE_SPEED = 0.03;
const COLD_MOTE_SPEED = 0.011;
const MOTE_SIZE = 0.045;
const MOTE_ALPHA = 0.7;
const MOTE_DRIFT = 0.18;
const MOTE_DRIFT_SPEED = 0.05;
/** Only this share of the drift reaches across the beam, so the dust stays inside it. */
const MOTE_DRIFT_SHARE = 0.3;
const MOTE_TWINKLE_SPEED = 0.2;
/** Each mote twinkles this far out of step with the one before, in radians. */
const MOTE_TWINKLE_STAGGER = 2.1;

/** One tile of a limelight's ray: the baked beam body added onto the floor, dust drifting through it. */
export function drawMazeBeamTile(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: {
    readonly hot: boolean;
    readonly heading: BeamDirection;
    readonly phase: number;
    readonly seed: number;
  },
): void {
  const vertical = state.heading === 'north' || state.heading === 'south';
  const band = state.hot ? HOT_BEAM : COLD_BEAM;
  ctx.save();
  try {
    // The body is laid on, not added: a warning keeps the same look over a
    // lit floor and a dark one. The bloom round it is the stage lights' own
    // additive beam glow; only the dust in it adds light here.
    const entry = beamEntry(state.hot, vertical);
    drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
    ctx.globalCompositeOperation = 'lighter';
    const forward = state.heading === 'south' || state.heading === 'east' ? 1 : -1;
    const speed = state.hot ? HOT_MOTE_SPEED : COLD_MOTE_SPEED;
    ctx.fillStyle = rgba(state.hot ? GILT_GLINT : BONE.accent, MOTE_ALPHA);
    const mote = Math.max(1, MOTE_SIZE * size);
    for (let index = 0; index < BEAM_MOTES; index++) {
      const lane = hashUnit(state.seed, index) - 0.5;
      const along = (((state.phase * speed * forward + hashUnit(index, state.seed)) % 1) + 1) % 1;
      const across =
        lane * band.halfWidth * size +
        Math.sin(state.phase * MOTE_DRIFT_SPEED + index) * MOTE_DRIFT * size * MOTE_DRIFT_SHARE;
      const twinkle =
        0.5 +
        0.5 *
          Math.sin(state.phase * MOTE_TWINKLE_SPEED + index * MOTE_TWINKLE_STAGGER + state.seed);
      ctx.globalAlpha = twinkle;
      const mx = vertical ? x + size / 2 + across : x + along * size;
      const my = vertical ? y + along * size : y + size / 2 + across;
      ctx.fillRect(mx - mote / 2, my - mote / 2, mote, mote);
    }
  } finally {
    ctx.restore();
  }
}

const FLARE_RADIUS = 0.85;
const ABSORB_RADIUS = 0.45;
const FLARE_RAY_LENGTH = 0.75;
const FLARE_RAY_WIDTH = 0.06;
const FLARE_SPIN = 0.012;
const FLARE_PULSE_SPEED = 0.2;
const FLARE_PULSE_DEPTH = 0.2;
const FLARE_RAYS = 4;
/** Every other ray is shorter, by this share, so the starburst reads as a sparkle rather than a cross. */
const FLARE_SHORT_RAY_SHARE = 0.6;
const FLARE_RAY_ALPHA = 0.85;
const HOT_RAY_COLOR: RGB = [255, 250, 236];
const COLD_RAY_COLOR: RGB = [255, 232, 160];
const HOT_FLARE_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,255,250,1)' },
  { offset: 0.18, color: 'rgba(255,240,210,0.85)' },
  { offset: 0.5, color: 'rgba(255,140,70,0.3)' },
  { offset: 1, color: 'rgba(255,110,40,0)' },
];
const COLD_FLARE_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,252,230,0.95)' },
  { offset: 0.2, color: 'rgba(255,226,140,0.7)' },
  { offset: 0.55, color: 'rgba(240,180,70,0.22)' },
  { offset: 1, color: 'rgba(240,180,70,0)' },
];
/** Light that lands on a mirror's back goes nowhere: a dull smoulder, not a flare. */
const ABSORB_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(200,90,50,0.55)' },
  { offset: 0.5, color: 'rgba(140,50,30,0.2)' },
  { offset: 1, color: 'rgba(120,40,20,0)' },
];

/** How high up the glass the beam strikes, in tiles above the tile's centre. */
const STRIKE_LIFT = 0.12;

/**
 * Where a beam meets a mirror: a bright starburst off the silvered face, or a
 * dull smoulder where it is swallowed by the back. `(x, y)` is the mirror's tile.
 */
export function drawBeamMirrorFlare(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: { readonly hot: boolean; readonly absorbed: boolean; readonly phase: number },
): void {
  const centreX = x + size / 2;
  const centreY = y + size / 2 - STRIKE_LIFT * size;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    if (state.absorbed) {
      drawRadialGlow(ctx, centreX, centreY, ABSORB_RADIUS * size, ABSORB_STOPS);
      return;
    }
    const pulse = 1 - FLARE_PULSE_DEPTH * (0.5 + 0.5 * Math.sin(state.phase * FLARE_PULSE_SPEED));
    drawRadialGlow(
      ctx,
      centreX,
      centreY,
      FLARE_RADIUS * size * pulse,
      state.hot ? HOT_FLARE_STOPS : COLD_FLARE_STOPS,
    );
    const spin = state.phase * FLARE_SPIN;
    const rayColor = state.hot ? HOT_RAY_COLOR : COLD_RAY_COLOR;
    const rayLength = FLARE_RAY_LENGTH * size * pulse;
    const rayWidth = FLARE_RAY_WIDTH * size;
    for (let ray = 0; ray < FLARE_RAYS; ray++) {
      const angle = spin + ray * QUARTER_TURN;
      const reach = ray % 2 === 0 ? rayLength : rayLength * FLARE_SHORT_RAY_SHARE;
      const rays = ctx.createLinearGradient(
        centreX - Math.cos(angle) * reach,
        centreY - Math.sin(angle) * reach,
        centreX + Math.cos(angle) * reach,
        centreY + Math.sin(angle) * reach,
      );
      rays.addColorStop(0, rgba(rayColor, 0));
      rays.addColorStop(0.5, rgba(rayColor, FLARE_RAY_ALPHA));
      rays.addColorStop(1, rgba(rayColor, 0));
      ctx.strokeStyle = rays;
      ctx.lineWidth = rayWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(centreX - Math.cos(angle) * reach, centreY - Math.sin(angle) * reach);
      ctx.lineTo(centreX + Math.cos(angle) * reach, centreY + Math.sin(angle) * reach);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/** Every picture the hall of mirrors asks the prop cache for, for the art gate. */
export function mirrorHallPropCatalogue(): ReadonlyArray<BigTopPropCatalogueEntry> {
  const entries: BigTopPropCatalogueEntry[] = [];
  for (const kind of ['pivot_mirror', 'swivel_mirror'] as const) {
    for (let step = 0; step < MIRROR_ANGLE_STEPS; step++) entries.push(mirrorEntry(kind, step));
  }
  const facings: ReadonlyArray<MirrorFacing> = ['NE', 'SE', 'SW', 'NW'];
  for (const current of facings) {
    for (const other of facings) {
      if (other !== current) entries.push(swivelGhostEntry(current, other));
    }
  }
  for (const shape of PANE_SHAPES) entries.push(paneEntry(shape));
  for (const direction of ['north', 'south', 'east', 'west'] as const) {
    for (let frame = 0; frame < LIMELIGHT_FLAME_FRAMES; frame++) {
      entries.push(limelightEntry(direction, frame));
    }
  }
  for (const hot of [true, false]) {
    for (const vertical of [true, false]) entries.push(beamEntry(hot, vertical));
  }
  return entries;
}
