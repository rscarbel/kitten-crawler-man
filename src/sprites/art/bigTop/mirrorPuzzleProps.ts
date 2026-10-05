/**
 * The hall of mirrors' puzzle pieces beyond the steerable glass: the fixed
 * splitters and windows, the owner-coloured stars, the marquee that mirrors
 * them, the two coloured lights and the teaching strip's footlight lamps.
 *
 * Every colour here has a shape or pattern twin, so the hall still reads in
 * greyscale: Carl's blue is solid with brass chevrons, Donut's red is dashed
 * and striped with bone, the twin star is split down the middle, and the
 * encore is spotted gold ringed with bulbs.
 *
 * Still parts are baked through `bigTopPropCache`; what moves every frame —
 * the dashes marching down a red beam, a glint on blue, a star's sparks, the
 * marquee chase — is drawn live over them.
 */

import type { BeamDirection } from '../../../map/bigTopMazeLayout';
import { worldText } from '../../../ui/world/worldText';
import { drawRadialGlow, type GlowStop } from '../../radialGlow';
import { hashUnit } from '../../flameStamps';
import { fillSoftEllipse } from '../softShade';
import { getCircusRamp, type RGB } from '../town/townPalette';
import {
  drawBigTopProp,
  gridAlignedBox,
  ONE_TILE_BOX,
  type BigTopPropBox,
  type BigTopPropCatalogueEntry,
  type BigTopPropPainter,
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
  QUARTER_TURN,
  ROT_TIMBER,
  inkCurrentPath,
  loopFrame,
  outlineWidth,
  paintContactShadow,
  rgba,
} from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

// ── Types the system hands the art ──────────────────────────────────────────

/** Whose light: Carl's limelight throws blue, Donut's throws red. */
export type LightColour = 'blue' | 'red';

/** Which floor diagonal a splitter's pane stands on, as the tile is seen from above: `/` or `\`. */
export type SplitterDiagonal = 'slash' | 'backslash';

/** Which light a star wants: one colour, both at once (`twin`), or either (`encore`, the optional gold star). */
export type PuzzleStarKind = 'blue' | 'red' | 'twin' | 'encore';

/**
 * How a star looks right now.
 * - `dark`: no light it wants is on it.
 * - `lit`: blazing; everything it wants is on it.
 * - `wrong`: only a light it does not want is on it — it sputters grey and
 *   throws sparks. Only a blue or red star can be wrong; a twin or an encore
 *   asked for it draws dark.
 * - `half_blue` / `half_red`: a twin star with only that one of its two
 *   lights; that half glows. Any other kind asked for it draws dark.
 */
export type PuzzleStarState = 'dark' | 'lit' | 'wrong' | 'half_blue' | 'half_red';

export interface PuzzleStarArt {
  readonly kind: PuzzleStarKind;
  readonly state: PuzzleStarState;
  /** The game frame counter; drives the blaze and the sputter. */
  readonly phase: number;
  /** The light causing a `wrong` sputter, which tints its sparks. */
  readonly wrongLight?: LightColour;
}

/**
 * What stands on the tile where a partial run ends or starts. The beams are
 * drawn over the props, so a run that went on to the tile's centre would
 * paint across the piece it is striking; naming the piece lets the run stop
 * at its face — at a star's plate, a lamp's lens, the glass of a mirror —
 * and pass behind a splitter's pane, seen through the glass.
 */
export type BeamStop = 'star' | 'mirror' | 'lamp' | 'splitter_slash' | 'splitter_backslash';

/** A tile's share of one coloured light's path. */
export interface LightBeamRun {
  readonly colour: LightColour;
  /** Which way the light is travelling across this tile. */
  readonly heading: BeamDirection;
  /**
   * `through` crosses the whole tile; `entering` runs from the edge it comes
   * in by toward the tile's centre (a mirror, splitter or star it ends on);
   * `leaving` runs from the centre out (a lamp, or the far side of a turn).
   */
  readonly span: 'through' | 'entering' | 'leaving';
  /** The piece on this tile a partial run meets; without it the run reaches the centre. */
  readonly stopAt?: BeamStop;
}

// ── Palette ─────────────────────────────────────────────────────────────────

const RINGMASTER = getCircusRamp('circus_ringmaster');
const STAGE_RED = getCircusRamp('circus_stage_red');
const GILT = getCircusRamp('circus_gilt');

/** A spent star: the owner's colour drained out of its body, never out of its pattern. */
const SPENT_GREY_LIGHT: RGB = [158, 158, 164];
const SPENT_GREY_DARK: RGB = [100, 100, 106];
const HOT_WHITE: RGB = [255, 255, 250];
const PEWTER_LIGHT: RGB = [200, 206, 214];
const PEWTER_MID: RGB = [138, 146, 158];
const PEWTER_DARK: RGB = [74, 80, 92];

interface LightLook {
  readonly core: RGB;
  readonly body: RGB;
  readonly edge: RGB;
  readonly glow: RGB;
}

const BLUE_LIGHT: LightLook = {
  core: [236, 246, 255],
  body: [104, 168, 255],
  edge: [36, 84, 214],
  glow: [120, 176, 255],
};
const RED_LIGHT: LightLook = {
  core: [255, 234, 226],
  body: [242, 72, 62],
  edge: [168, 22, 30],
  glow: [255, 104, 88],
};
const LIGHT_LOOK: Readonly<Record<LightColour, LightLook>> = { blue: BLUE_LIGHT, red: RED_LIGHT };

/** A coloured bloom: strong at the heart, fading to nothing, with a shoulder this far out at this strength. */
const GLOW_CORE_ALPHA = 0.8;
const GLOW_SHOULDER_AT = 0.35;
const GLOW_SHOULDER_ALPHA = 0.35;

function glowStops(color: RGB): ReadonlyArray<GlowStop> {
  return [
    { offset: 0, color: rgba(color, GLOW_CORE_ALPHA) },
    { offset: GLOW_SHOULDER_AT, color: rgba(color, GLOW_SHOULDER_ALPHA) },
    { offset: 1, color: rgba(color, 0) },
  ];
}

const LIGHT_GLOW_STOPS: Readonly<Record<LightColour, ReadonlyArray<GlowStop>>> = {
  blue: glowStops(BLUE_LIGHT.glow),
  red: glowStops(RED_LIGHT.glow),
};
const ENCORE_GLOW_STOPS = glowStops(GILT.accent);

function starGlowStops(kind: PuzzleStarKind): ReadonlyArray<GlowStop> {
  if (kind === 'blue' || kind === 'red') return LIGHT_GLOW_STOPS[kind];
  return ENCORE_GLOW_STOPS;
}

/** Builds each catalogue entry once, so a per-frame draw never allocates one. */
const entryMemo = new Map<string, BigTopPropCatalogueEntry>();

function memoEntry(
  prop: string,
  state: string,
  box: BigTopPropBox,
  painter: BigTopPropPainter,
): BigTopPropCatalogueEntry {
  const id = `${prop}|${state}`;
  const known = entryMemo.get(id);
  if (known !== undefined) return known;
  const entry: BigTopPropCatalogueEntry = { key: { prop, state, frame: 0 }, box, painter };
  entryMemo.set(id, entry);
  return entry;
}

function drawEntry(
  ctx: Ctx,
  entry: BigTopPropCatalogueEntry,
  x: number,
  y: number,
  size: number,
): void {
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
}

/** A sine wave lifted from -1..1 into 0..1, for a pulse that dips and recovers. */
function unitWave(angle: number): number {
  return (1 + Math.sin(angle)) / 2;
}

// ── Shared star geometry ────────────────────────────────────────────────────

const STAR_POINTS = 5;
/** A five-point star's inner radius as a share of its outer: fat enough to carry a pattern at 32 px. */
const STAR_INNER_SHARE = 0.46;

function traceStarShape(ctx: Ctx, centreX: number, centreY: number, outer: number): void {
  const inner = outer * STAR_INNER_SHARE;
  ctx.beginPath();
  for (let point = 0; point < STAR_POINTS * 2; point++) {
    const radius = point % 2 === 0 ? outer : inner;
    // Started at the top so the star reads upright rather than as a cog.
    const angle = -QUARTER_TURN + (FULL_TURN / (STAR_POINTS * 2)) * point;
    const px = centreX + Math.cos(angle) * radius;
    const py = centreY + Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function armAngle(arm: number): number {
  return -QUARTER_TURN + (FULL_TURN / STAR_POINTS) * arm;
}

/** One brass chevron per arm, its point toward the tip, as shares of the star's outer radius. */
const CHEVRON_APEX = 0.8;
const CHEVRON_FOOT = 0.45;
/** How far round from the arm's axis each chevron foot sits, in radians. */
const CHEVRON_SPREAD = 0.34;
const CHEVRON_WIDTH_SHARE = 0.15;

function paintChevrons(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  outer: number,
  color: RGB,
  minLineWidth: number,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = Math.max(minLineWidth, outer * CHEVRON_WIDTH_SHARE);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    for (let arm = 0; arm < STAR_POINTS; arm++) {
      const angle = armAngle(arm);
      ctx.beginPath();
      ctx.moveTo(
        centreX + Math.cos(angle - CHEVRON_SPREAD) * outer * CHEVRON_FOOT,
        centreY + Math.sin(angle - CHEVRON_SPREAD) * outer * CHEVRON_FOOT,
      );
      ctx.lineTo(
        centreX + Math.cos(angle) * outer * CHEVRON_APEX,
        centreY + Math.sin(angle) * outer * CHEVRON_APEX,
      );
      ctx.lineTo(
        centreX + Math.cos(angle + CHEVRON_SPREAD) * outer * CHEVRON_FOOT,
        centreY + Math.sin(angle + CHEVRON_SPREAD) * outer * CHEVRON_FOOT,
      );
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/** Bone stripes across Donut's star: bands this share of the outer radius, stripe and gap alike. */
const STRIPE_BAND_SHARE = 0.3;
/** The stripes start this share of a band below the top point, so a stripe crosses the star's waist. */
const STRIPE_OFFSET_SHARE = 0.5;

function paintStripes(ctx: Ctx, centreX: number, centreY: number, outer: number, color: RGB): void {
  const band = outer * STRIPE_BAND_SHARE;
  ctx.fillStyle = rgba(color, 1);
  for (
    let top = centreY - outer + band * STRIPE_OFFSET_SHARE;
    top < centreY + outer;
    top += band * 2
  ) {
    ctx.fillRect(centreX - outer, top, outer * 2, band);
  }
}

/** Gold spots on the encore star, on this grid pitch and radius as shares of the outer radius. */
const SPOT_PITCH_SHARE = 0.42;
const SPOT_RADIUS_SHARE = 0.13;

function paintSpots(ctx: Ctx, centreX: number, centreY: number, outer: number, color: RGB): void {
  const pitch = outer * SPOT_PITCH_SHARE;
  const radius = Math.max(1, outer * SPOT_RADIUS_SHARE);
  ctx.fillStyle = rgba(color, 1);
  for (let row = -outer; row <= outer; row += pitch) {
    const rowIndex = Math.round(row / pitch);
    const shift = rowIndex % 2 === 0 ? 0 : pitch / 2;
    for (let column = -outer; column <= outer; column += pitch) {
      ctx.beginPath();
      ctx.arc(centreX + column + shift, centreY + row, radius, 0, FULL_TURN);
      ctx.fill();
    }
  }
}

/**
 * The look of one colour part of a star: `unlit` is a marquee bulb that is
 * off — dark glass with its pattern and rim still showing.
 */
type PartLook = 'dark' | 'lit' | 'wrong' | 'unlit';

interface StarHalves {
  /** The look of the whole star, or of its blue (left) half on a twin. */
  readonly first: PartLook;
  /** The look of a twin's red (right) half; the same as `first` otherwise. */
  readonly second: PartLook;
}

function halvesOf(state: PuzzleStarState): StarHalves {
  if (state === 'half_blue') return { first: 'lit', second: 'dark' };
  if (state === 'half_red') return { first: 'dark', second: 'lit' };
  return { first: state, second: state };
}

interface StarColours {
  readonly bodyLight: RGB;
  readonly bodyDark: RGB;
  readonly pattern: RGB;
}

type PartKind = 'blue' | 'red' | 'encore';

/**
 * The body and pattern of each star part in each look. Every pair keeps a
 * wide gap in value between body and pattern, so the pattern — the kind's
 * shape cue — survives a greyscale view: a lit or dark body carries a light
 * pattern, a spent grey body a dark pattern in the owner's colour.
 */
const STAR_COLOURS: Readonly<Record<PartKind, Readonly<Record<PartLook, StarColours>>>> = {
  blue: {
    lit: { bodyLight: RINGMASTER.accent, bodyDark: RINGMASTER.light, pattern: GILT_GLINT },
    dark: { bodyLight: RINGMASTER.mid, bodyDark: RINGMASTER.shadow, pattern: GILT.light },
    wrong: { bodyLight: SPENT_GREY_LIGHT, bodyDark: SPENT_GREY_DARK, pattern: RINGMASTER.mid },
    unlit: { bodyLight: BACKSTAGE.accent, bodyDark: BACKSTAGE.light, pattern: RINGMASTER.light },
  },
  red: {
    lit: { bodyLight: STAGE_RED.accent, bodyDark: STAGE_RED.light, pattern: BONE.accent },
    dark: { bodyLight: STAGE_RED.mid, bodyDark: STAGE_RED.shadow, pattern: BONE.mid },
    wrong: { bodyLight: SPENT_GREY_LIGHT, bodyDark: SPENT_GREY_DARK, pattern: STAGE_RED.mid },
    unlit: { bodyLight: BACKSTAGE.accent, bodyDark: BACKSTAGE.light, pattern: STAGE_RED.light },
  },
  encore: {
    lit: { bodyLight: GILT_GLINT, bodyDark: GILT.light, pattern: GILT.shadow },
    dark: { bodyLight: GILT.mid, bodyDark: GILT.shadow, pattern: GILT_GLINT },
    wrong: { bodyLight: SPENT_GREY_LIGHT, bodyDark: SPENT_GREY_DARK, pattern: GILT.shadow },
    unlit: { bodyLight: BACKSTAGE.accent, bodyDark: BACKSTAGE.light, pattern: GILT.mid },
  },
};

/** The rim an unlit marquee bulb keeps, in its kind's colour, so its silhouette reads with the light off. */
const UNLIT_RIM: Readonly<Record<PartKind, RGB>> = {
  blue: RINGMASTER.light,
  red: STAGE_RED.light,
  encore: GILT.mid,
};

/** A lit star's white-hot heart, as a share of its outer radius and at this strength. */
const LIT_CORE_SHARE = 0.4;
const LIT_CORE_ALPHA = 0.6;

function paintStarPart(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  outer: number,
  kind: PartKind,
  look: PartLook,
  minPatternWidth: number,
): void {
  const colours = STAR_COLOURS[kind][look];
  const body = ctx.createLinearGradient(
    centreX - outer,
    centreY - outer,
    centreX + outer,
    centreY + outer,
  );
  body.addColorStop(0, rgba(colours.bodyLight, 1));
  body.addColorStop(1, rgba(colours.bodyDark, 1));
  ctx.fillStyle = body;
  traceStarShape(ctx, centreX, centreY, outer);
  ctx.fill();
  ctx.save();
  try {
    traceStarShape(ctx, centreX, centreY, outer);
    ctx.clip();
    if (kind === 'blue') {
      paintChevrons(ctx, centreX, centreY, outer, colours.pattern, minPatternWidth);
    } else if (kind === 'red') {
      paintStripes(ctx, centreX, centreY, outer, colours.pattern);
    } else {
      paintSpots(ctx, centreX, centreY, outer, colours.pattern);
    }
    if (look === 'lit') {
      const core = ctx.createRadialGradient(
        centreX,
        centreY,
        0,
        centreX,
        centreY,
        outer * LIT_CORE_SHARE,
      );
      core.addColorStop(0, rgba(HOT_WHITE, LIT_CORE_ALPHA));
      core.addColorStop(1, rgba(HOT_WHITE, 0));
      ctx.fillStyle = core;
      ctx.fillRect(centreX - outer, centreY - outer, outer * 2, outer * 2);
    }
  } finally {
    ctx.restore();
  }
}

/** The seam down a twin star, as a share of its outer radius. */
const TWIN_SEAM_SHARE = 0.1;
/** An unlit bulb's rim is this many outline widths thick. */
const UNLIT_RIM_OUTLINES = 1;
/** A twin's half-clip reaches this many star radii out, so the rim's stroke is never shaved at the points. */
const UNLIT_RIM_CLIP_REACH = 2;

/** A star of any kind at `outer` pixels radius, inked: the shared picture of the wall star and the marquee bulb. */
function paintKindStar(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  outer: number,
  kind: PuzzleStarKind,
  halves: StarHalves,
  size: number,
  minPatternWidth: number,
): void {
  if (kind !== 'twin') {
    paintStarPart(ctx, centreX, centreY, outer, kind, halves.first, minPatternWidth);
  } else {
    for (const side of ['blue', 'red'] as const) {
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(side === 'blue' ? centreX - outer : centreX, centreY - outer, outer, outer * 2);
        ctx.clip();
        const look = side === 'blue' ? halves.first : halves.second;
        paintStarPart(ctx, centreX, centreY, outer, side, look, minPatternWidth);
      } finally {
        ctx.restore();
      }
    }
    ctx.save();
    try {
      traceStarShape(ctx, centreX, centreY, outer);
      ctx.clip();
      ctx.fillStyle = rgba(BONE.accent, 1);
      const seam = Math.max(1, outer * TWIN_SEAM_SHARE);
      ctx.fillRect(centreX - seam / 2, centreY - outer, seam, outer * 2);
    } finally {
      ctx.restore();
    }
  }
  traceStarShape(ctx, centreX, centreY, outer);
  inkCurrentPath(ctx, size);
  if (halves.first !== 'unlit') return;
  ctx.save();
  try {
    ctx.lineWidth = outlineWidth(size) * UNLIT_RIM_OUTLINES;
    ctx.lineJoin = 'round';
    if (kind === 'twin') {
      for (const side of ['blue', 'red'] as const) {
        ctx.save();
        try {
          ctx.beginPath();
          const halfReach = outer * UNLIT_RIM_CLIP_REACH;
          ctx.rect(
            side === 'blue' ? centreX - halfReach : centreX,
            centreY - halfReach,
            halfReach,
            halfReach * 2,
          );
          ctx.clip();
          ctx.strokeStyle = rgba(UNLIT_RIM[side], 1);
          traceStarShape(ctx, centreX, centreY, outer);
          ctx.stroke();
        } finally {
          ctx.restore();
        }
      }
    } else {
      ctx.strokeStyle = rgba(UNLIT_RIM[kind], 1);
      traceStarShape(ctx, centreX, centreY, outer);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

// ── Stars in the wall ───────────────────────────────────────────────────────

const WALL_STAR_OUTER = 0.36;
const WALL_STAR_PLATE_RADIUS = 0.42;
const WALL_STAR_PLATE_RIM = 0.05;
/** The plate's shadow falls down and right, away from the stage light, in tiles. */
const WALL_STAR_SHADOW_OFFSET = 0.03;
const WALL_STAR_SHADOW_ALPHA = 0.6;
/** The encore's plate is ringed with little bulbs: this many, this big, as shares of the tile. */
const ENCORE_RING_BULBS = 10;
const ENCORE_RING_BULB_RADIUS = 0.03;
/** A domed face's highlight sits a third of its radius up and left, toward the stage light. */
const DOME_HIGHLIGHT_DIVISOR = 3;

function paintWallStar(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  kind: PuzzleStarKind,
  state: PuzzleStarState,
): void {
  const centreX = originX + size / 2;
  const centreY = originY + size / 2;
  const plate = WALL_STAR_PLATE_RADIUS * size;
  ctx.fillStyle = rgba(BACKSTAGE.shadow, WALL_STAR_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.arc(
    centreX + size * WALL_STAR_SHADOW_OFFSET,
    centreY + size * WALL_STAR_SHADOW_OFFSET,
    plate,
    0,
    FULL_TURN,
  );
  ctx.fill();
  const velvet = ctx.createRadialGradient(
    centreX - plate / DOME_HIGHLIGHT_DIVISOR,
    centreY - plate / DOME_HIGHLIGHT_DIVISOR,
    0,
    centreX,
    centreY,
    plate,
  );
  velvet.addColorStop(0, rgba(BRUISE.mid, 1));
  velvet.addColorStop(1, rgba(BRUISE.shadow, 1));
  ctx.fillStyle = velvet;
  ctx.beginPath();
  ctx.arc(centreX, centreY, plate, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = rgba(BRASS.mid, 1);
  ctx.lineWidth = Math.max(1, size * WALL_STAR_PLATE_RIM);
  ctx.stroke();
  inkCurrentPath(ctx, size);
  if (kind === 'encore') {
    const bulbRadius = Math.max(1, ENCORE_RING_BULB_RADIUS * size);
    ctx.fillStyle = rgba(state === 'lit' ? HOT_WHITE : BONE.mid, 1);
    for (let bulb = 0; bulb < ENCORE_RING_BULBS; bulb++) {
      const angle = (FULL_TURN / ENCORE_RING_BULBS) * bulb;
      ctx.beginPath();
      ctx.arc(
        centreX + Math.cos(angle) * plate,
        centreY + Math.sin(angle) * plate,
        bulbRadius,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  }
  paintKindStar(
    ctx,
    centreX,
    centreY,
    WALL_STAR_OUTER * size,
    kind,
    halvesOf(state),
    size,
    outlineWidth(size),
  );
}

/** The picture a kind is actually drawn with in a state: halves are a twin's alone, and only a single-colour star can be wrong. */
function bakedStarState(kind: PuzzleStarKind, state: PuzzleStarState): PuzzleStarState {
  const halfState = state === 'half_blue' || state === 'half_red';
  if (halfState && kind !== 'twin') return 'dark';
  if (state === 'wrong' && (kind === 'twin' || kind === 'encore')) return 'dark';
  return state;
}

function puzzleStarEntry(kind: PuzzleStarKind, state: PuzzleStarState): BigTopPropCatalogueEntry {
  return memoEntry('puzzleStar', `${kind}-${state}`, ONE_TILE_BOX, (target, originX, originY, px) =>
    paintWallStar(target, originX, originY, px, kind, state),
  );
}

const PUZZLE_STAR_KINDS: ReadonlyArray<PuzzleStarKind> = ['blue', 'red', 'twin', 'encore'];
const PUZZLE_STAR_STATES: ReadonlyArray<PuzzleStarState> = [
  'dark',
  'lit',
  'wrong',
  'half_blue',
  'half_red',
];

/** The blaze: rays round a lit star, alternately long and short, turning slowly. */
const BLAZE_RAYS = 10;
const BLAZE_RAY_INNER = 0.3;
const BLAZE_RAY_LONG = 0.78;
const BLAZE_RAY_SHORT = 0.58;
const BLAZE_RAY_WIDTH = 0.07;
const BLAZE_SPIN_PER_FRAME = 0.01;
const BLAZE_GLOW_RADIUS = 1.1;
const BLAZE_PULSE_SPEED = 0.12;
const BLAZE_PULSE_DEPTH = 0.15;
/** A twin's two glows sit this far toward their own halves, in tiles. */
const HALF_GLOW_SHIFT = 0.18;
const HALF_GLOW_RADIUS = 0.6;
const HALF_GLOW_ALPHA = 0.8;
const HOT_WHITE_STYLE = rgba(HOT_WHITE, 1);
const BLUE_CORE_STYLE = rgba(BLUE_LIGHT.core, 1);
const RED_CORE_STYLE = rgba(RED_LIGHT.core, 1);

function paintBlaze(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  art: PuzzleStarArt,
): void {
  const pulse = 1 - BLAZE_PULSE_DEPTH * unitWave(art.phase * BLAZE_PULSE_SPEED);
  const glowRadius = BLAZE_GLOW_RADIUS * size * pulse;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    if (art.kind === 'twin') {
      const shift = HALF_GLOW_SHIFT * size;
      drawRadialGlow(ctx, centreX - shift, centreY, glowRadius, LIGHT_GLOW_STOPS.blue);
      drawRadialGlow(ctx, centreX + shift, centreY, glowRadius, LIGHT_GLOW_STOPS.red);
    } else {
      drawRadialGlow(ctx, centreX, centreY, glowRadius, starGlowStops(art.kind));
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, BLAZE_RAY_WIDTH * size);
    const spin = art.phase * BLAZE_SPIN_PER_FRAME;
    const inner = BLAZE_RAY_INNER * size;
    for (let ray = 0; ray < BLAZE_RAYS; ray++) {
      const angle = spin + (FULL_TURN / BLAZE_RAYS) * ray;
      const reach = (ray % 2 === 0 ? BLAZE_RAY_LONG : BLAZE_RAY_SHORT) * size * pulse;
      const onRight = Math.cos(angle) >= 0;
      const twinTint = onRight ? RED_CORE_STYLE : BLUE_CORE_STYLE;
      ctx.strokeStyle = art.kind === 'twin' ? twinTint : HOT_WHITE_STYLE;
      ctx.beginPath();
      ctx.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
      ctx.lineTo(centreX + Math.cos(angle) * reach, centreY + Math.sin(angle) * reach);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

function paintHalfGlow(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  half: LightColour,
): void {
  const shift = half === 'blue' ? -HALF_GLOW_SHIFT : HALF_GLOW_SHIFT;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = HALF_GLOW_ALPHA;
    drawRadialGlow(
      ctx,
      centreX + shift * size,
      centreY,
      HALF_GLOW_RADIUS * size,
      LIGHT_GLOW_STOPS[half],
    );
  } finally {
    ctx.restore();
  }
}

/** A spark is struck every this many frames; each one lives that long. */
const SPARK_PERIOD_FRAMES = 5;
const SPARK_SEGMENTS = 3;
const SPARK_SEGMENT_LENGTH = 0.13;
/** Each zigzag leg swings this far off the spark's line, in radians. */
const SPARK_ZIG = 0.9;
const SPARK_WIDTH = 0.045;
const SPARK_EMBERS = 3;
const SPARK_EMBER_REACH = 0.3;
const SPARK_EMBER_SIZE = 0.05;
/** The sputter: a grey haze over the star whose strength jumps between these every spark. */
const SPUTTER_HAZE_MIN = 0.1;
const SPUTTER_HAZE_RANGE = 0.25;
const SPUTTER_HAZE_RADIUS = 0.5;
/** Salts for the hash that places each spark, so arm, lean and haze are independent draws. */
const SPARK_ARM_SALT = 11;
const SPARK_LEAN_SALT = 23;
const SPARK_HAZE_SALT = 37;
const SPARK_EMBER_SALT = 53;
const SMOKE_RADIUS = 0.2;
const SMOKE_RISE = 0.35;
const SMOKE_ALPHA = 0.45;
const SMOKE_STYLE = rgba([120, 118, 124], 1);
/** A wrong light's spark: white-hot at its root, tinted with the light at its tips. */
const SPARK_ROOT: RGB = [255, 250, 220];

function paintSputter(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  art: PuzzleStarArt,
): void {
  const strike = Math.floor(art.phase / SPARK_PERIOD_FRAMES);
  const life = (art.phase % SPARK_PERIOD_FRAMES) / SPARK_PERIOD_FRAMES;
  const tipColour = art.wrongLight === undefined ? SPARK_ROOT : LIGHT_LOOK[art.wrongLight].body;
  ctx.save();
  try {
    const haze = SPUTTER_HAZE_MIN + SPUTTER_HAZE_RANGE * hashUnit(strike, SPARK_HAZE_SALT);
    fillSoftEllipse(
      ctx,
      centreX,
      centreY,
      SPUTTER_HAZE_RADIUS * size,
      SPUTTER_HAZE_RADIUS * size,
      SMOKE_STYLE,
      haze,
    );
    fillSoftEllipse(
      ctx,
      centreX,
      centreY - WALL_STAR_OUTER * size - SMOKE_RISE * size * life,
      SMOKE_RADIUS * size,
      SMOKE_RADIUS * size,
      SMOKE_STYLE,
      SMOKE_ALPHA * (1 - life),
    );
    ctx.globalCompositeOperation = 'lighter';
    const arm = Math.floor(hashUnit(strike, SPARK_ARM_SALT) * STAR_POINTS);
    const angle = armAngle(arm);
    const lean = (hashUnit(strike, SPARK_LEAN_SALT) - 0.5) * SPARK_ZIG;
    let px = centreX + Math.cos(angle) * WALL_STAR_OUTER * size;
    let py = centreY + Math.sin(angle) * WALL_STAR_OUTER * size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = Math.max(1, SPARK_WIDTH * size);
    const bolt = ctx.createLinearGradient(
      px,
      py,
      px + Math.cos(angle) * SPARK_SEGMENT_LENGTH * SPARK_SEGMENTS * size,
      py + Math.sin(angle) * SPARK_SEGMENT_LENGTH * SPARK_SEGMENTS * size,
    );
    bolt.addColorStop(0, rgba(SPARK_ROOT, 1));
    bolt.addColorStop(1, rgba(tipColour, 1));
    ctx.strokeStyle = bolt;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let segment = 0; segment < SPARK_SEGMENTS; segment++) {
      const zig = segment % 2 === 0 ? SPARK_ZIG : -SPARK_ZIG;
      const legAngle = angle + lean + zig / 2;
      px += Math.cos(legAngle) * SPARK_SEGMENT_LENGTH * size;
      py += Math.sin(legAngle) * SPARK_SEGMENT_LENGTH * size;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = rgba(tipColour, 1 - life);
    const ember = Math.max(1, SPARK_EMBER_SIZE * size);
    const reach = (WALL_STAR_OUTER + SPARK_EMBER_REACH * life) * size;
    for (let index = 0; index < SPARK_EMBERS; index++) {
      const emberAngle = angle + (hashUnit(strike + index, SPARK_EMBER_SALT) - 0.5) * HALF_TURN;
      ctx.fillRect(
        centreX + Math.cos(emberAngle) * reach - ember / 2,
        centreY + Math.sin(emberAngle) * reach - ember / 2,
        ember,
        ember,
      );
    }
  } finally {
    ctx.restore();
  }
}

/**
 * A star set in a wall tile. Blue with brass chevrons wants Carl's light, red
 * with bone stripes wants Donut's, the twin (split down the middle, one half
 * of each) wants both at once, and the spotted gold encore wants either. Lit,
 * it blazes with rays; under the wrong light its body goes grey — its
 * pattern keeps the kind — and it smokes and throws sparks, so light it
 * cannot use is never silently eaten.
 */
export function drawPuzzleStar(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: PuzzleStarArt,
): void {
  const centreX = x + size / 2;
  const centreY = y + size / 2;
  const state = bakedStarState(art.kind, art.state);
  if (state === 'lit') paintBlaze(ctx, centreX, centreY, size, art);
  if (state === 'half_blue') paintHalfGlow(ctx, centreX, centreY, size, 'blue');
  if (state === 'half_red') paintHalfGlow(ctx, centreX, centreY, size, 'red');
  drawEntry(ctx, puzzleStarEntry(art.kind, state), x, y, size);
  if (state === 'wrong') paintSputter(ctx, centreX, centreY, size, art);
}

// ── The marquee ─────────────────────────────────────────────────────────────

/** One bulb on the marquee: the star it stands for, and whether that star is lit right now. */
export interface StarMarqueeBulb {
  readonly kind: PuzzleStarKind;
  readonly lit: boolean;
  /** A twin with only one of its lights: that half of its bulb glows. Ignored when `lit`, or for any other kind. */
  readonly half?: LightColour;
}

export interface StarMarqueeArt {
  /** One bulb per star on the board, left to right; one to four. */
  readonly bulbs: ReadonlyArray<StarMarqueeBulb>;
  /** Frames since the board was solved, or `null` while it is unsolved. */
  readonly framesSinceSolved: number | null;
  readonly phase: number;
}

/** Each star bulb gets a slot this wide, in tiles, and the board a margin either side. */
const MARQUEE_SLOT_TILES = 0.72;
/** A bulb or a letter sits at the middle of its slot. */
const SLOT_MIDDLE = 0.5;
const MARQUEE_MARGIN_TILES = 0.26;
/** Never narrower than this: BRAVO has to fit across even a two-bulb board. */
const MARQUEE_MIN_WIDTH_TILES = 1.9;

/** How many tiles wide the marquee for this many stars is; it is drawn from the left edge of its first tile. */
export function starMarqueeWidthTiles(bulbCount: number): number {
  return Math.max(
    MARQUEE_MIN_WIDTH_TILES,
    bulbCount * MARQUEE_SLOT_TILES + MARQUEE_MARGIN_TILES * 2,
  );
}

const MARQUEE_TOP = 0.1;
const MARQUEE_HEIGHT = 0.8;
const MARQUEE_CORNER = 0.08;
/** The baked board's frame reaches this far past the board either side, so its outline never touches the frame's edge. */
const MARQUEE_BOX_PAD = 0.05;
const MARQUEE_BULB_OUTER = 0.29;
/** Chase bulbs along the top and bottom rails, one per this many tiles of board. */
const MARQUEE_RIM_PITCH_TILES = 0.16;
const MARQUEE_RIM_BULB_RADIUS = 0.035;
const MARQUEE_RIM_INSET = 0.07;
const MARQUEE_CHASE_STRIDE = 3;
const MARQUEE_CHASE_PERIOD_FRAMES = 6;
const MARQUEE_DEAD_RIM_ALPHA = 0.4;
const MARQUEE_OFF_BEAT_ALPHA = 0.3;
const MARQUEE_BULB_GLOW_RADIUS = 0.42;
/** The encore's bulb is ringed with a sunburst, its own silhouette whatever the colour: this many ticks, from and to these shares of the bulb. */
const ENCORE_BURST_TICKS = 10;
const ENCORE_BURST_INNER = 1.15;
const ENCORE_BURST_OUTER = 1.42;
/** Pattern lines on a bulb are never thinner than this many outline widths, or they vanish at 32 px. */
const BULB_PATTERN_MIN_OUTLINES = 2;
/** BRAVO is spelt out one letter per this many frames, then the lit letter chases along it. */
const BRAVO_LETTER_FRAMES = 10;
const BRAVO_TEXT = 'BRAVO';
const BRAVO_LETTER_SIZE = 0.36;
const BRAVO_LETTER_TOP = 0.2;
/** A letter's glow, as a share of the tile, so it keeps its look at every zoom. */
const BRAVO_GLOW_BLUR_SHARE = 0.1;
const BRAVO_CHASE_FRAMES = 8;
/**
 * BRAVO holds the board this long after the solve — spelt out, then chased —
 * and then the board settles back to its bulbs under the still-chasing rim,
 * so a star lit after the solve (the encore, above all) shows on it.
 */
const BRAVO_SHOW_FRAMES = 90;
const BRAVO_DIM_LETTER_ALPHA = 0.75;
/** A baked letter's own frame: this wide and tall, with this much room round it for the glow, in tiles. */
const BRAVO_LETTER_BOX_WIDTH = 0.4;
const BRAVO_LETTER_BOX_HEIGHT = 0.5;
const BRAVO_LETTER_BOX_PAD = 0.2;

/** The chase needs a lit and an unlit bulb to read as motion at all. */
const MARQUEE_RIM_BULBS_MIN = 2;

function marqueeRimCount(width: number, size: number): number {
  return Math.max(MARQUEE_RIM_BULBS_MIN, Math.round(width / (MARQUEE_RIM_PITCH_TILES * size)));
}

/** The marquee board with its rim bulbs dead: the still part every frame is drawn over. */
function paintMarqueeBoard(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  widthTiles: number,
): void {
  const width = widthTiles * size;
  const top = originY + MARQUEE_TOP * size;
  const height = MARQUEE_HEIGHT * size;
  ctx.beginPath();
  ctx.roundRect(originX, top, width, height, MARQUEE_CORNER * size);
  ctx.fillStyle = rgba(BLOOD.shadow, 1);
  ctx.fill();
  inkCurrentPath(ctx, size);
  ctx.strokeStyle = rgba(BRASS.mid, 1);
  ctx.lineWidth = outlineWidth(size);
  const inset = outlineWidth(size);
  ctx.beginPath();
  ctx.roundRect(
    originX + inset,
    top + inset,
    width - inset * 2,
    height - inset * 2,
    MARQUEE_CORNER * size,
  );
  ctx.stroke();
  const rimInset = MARQUEE_RIM_INSET * size;
  const rimCount = marqueeRimCount(width, size);
  const rimRadius = Math.max(1, MARQUEE_RIM_BULB_RADIUS * size);
  ctx.fillStyle = rgba(BONE.shadow, MARQUEE_DEAD_RIM_ALPHA);
  ctx.beginPath();
  for (const railY of [top + rimInset, top + height - rimInset]) {
    for (let bulb = 0; bulb < rimCount; bulb++) {
      const bulbX = originX + rimInset + ((width - rimInset * 2) * bulb) / (rimCount - 1);
      ctx.moveTo(bulbX + rimRadius, railY);
      ctx.arc(bulbX, railY, rimRadius, 0, FULL_TURN);
    }
  }
  ctx.fill();
}

function marqueeBoardEntry(bulbCount: number): BigTopPropCatalogueEntry {
  const widthTiles = starMarqueeWidthTiles(bulbCount);
  return memoEntry(
    'marqueeBoard',
    `${bulbCount}`,
    gridAlignedBox({
      left: -MARQUEE_BOX_PAD,
      top: 0,
      width: widthTiles + MARQUEE_BOX_PAD * 2,
      height: 1,
    }),
    (target, originX, originY, px) => paintMarqueeBoard(target, originX, originY, px, widthTiles),
  );
}

type BulbLook = 'lit' | 'unlit' | 'half_blue' | 'half_red';

function bulbLookOf(bulb: StarMarqueeBulb): BulbLook {
  if (bulb.lit) return 'lit';
  if (bulb.kind === 'twin' && bulb.half === 'blue') return 'half_blue';
  if (bulb.kind === 'twin' && bulb.half === 'red') return 'half_red';
  return 'unlit';
}

function bulbHalves(look: BulbLook): StarHalves {
  if (look === 'half_blue') return { first: 'lit', second: 'unlit' };
  if (look === 'half_red') return { first: 'unlit', second: 'lit' };
  return { first: look, second: look };
}

/** One star bulb, centred in its own tile-sized frame. */
function paintMarqueeBulb(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  kind: PuzzleStarKind,
  look: BulbLook,
): void {
  const centreX = originX + size / 2;
  const centreY = originY + size / 2;
  const outer = MARQUEE_BULB_OUTER * size;
  const glowRadius = MARQUEE_BULB_GLOW_RADIUS * size;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    if (look === 'lit' && kind === 'twin') {
      drawRadialGlow(ctx, centreX, centreY, glowRadius, LIGHT_GLOW_STOPS.blue);
      drawRadialGlow(ctx, centreX, centreY, glowRadius, LIGHT_GLOW_STOPS.red);
    } else if (look === 'lit') {
      drawRadialGlow(ctx, centreX, centreY, glowRadius, starGlowStops(kind));
    } else if (look === 'half_blue' || look === 'half_red') {
      const half = look === 'half_blue' ? 'blue' : 'red';
      const shift = (half === 'blue' ? -1 : 1) * outer * HALF_GLOW_SHIFT;
      drawRadialGlow(ctx, centreX + shift, centreY, glowRadius, LIGHT_GLOW_STOPS[half]);
    }
  } finally {
    ctx.restore();
  }
  if (kind === 'encore') {
    ctx.save();
    try {
      ctx.strokeStyle = rgba(look === 'lit' ? GILT_GLINT : GILT.shadow, 1);
      ctx.lineWidth = outlineWidth(size) * BULB_PATTERN_MIN_OUTLINES;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let tick = 0; tick < ENCORE_BURST_TICKS; tick++) {
        const angle = (FULL_TURN / ENCORE_BURST_TICKS) * tick;
        ctx.moveTo(
          centreX + Math.cos(angle) * outer * ENCORE_BURST_INNER,
          centreY + Math.sin(angle) * outer * ENCORE_BURST_INNER,
        );
        ctx.lineTo(
          centreX + Math.cos(angle) * outer * ENCORE_BURST_OUTER,
          centreY + Math.sin(angle) * outer * ENCORE_BURST_OUTER,
        );
      }
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }
  paintKindStar(
    ctx,
    centreX,
    centreY,
    outer,
    kind,
    bulbHalves(look),
    size,
    outlineWidth(size) * BULB_PATTERN_MIN_OUTLINES,
  );
}

function marqueeBulbEntry(kind: PuzzleStarKind, look: BulbLook): BigTopPropCatalogueEntry {
  return memoEntry('marqueeBulb', `${kind}-${look}`, ONE_TILE_BOX, (target, originX, originY, px) =>
    paintMarqueeBulb(target, originX, originY, px, kind, look),
  );
}

function paintBravoLetter(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  letter: string,
  bright: boolean,
): void {
  worldText(ctx, letter, {
    x: originX,
    y: originY,
    width: BRAVO_LETTER_BOX_WIDTH * size,
    align: 'center',
    size: Math.max(1, Math.round(BRAVO_LETTER_SIZE * size)),
    bold: true,
    color: rgba(bright ? GILT_GLINT : BRASS.accent, 1),
    alpha: bright ? 1 : BRAVO_DIM_LETTER_ALPHA,
    glow: bright ? rgba(BRASS.accent, 1) : false,
    glowBlur: BRAVO_GLOW_BLUR_SHARE * size,
  });
}

const BRAVO_LETTER_BOX: BigTopPropBox = gridAlignedBox({
  left: -BRAVO_LETTER_BOX_PAD,
  top: -BRAVO_LETTER_BOX_PAD,
  width: BRAVO_LETTER_BOX_WIDTH + BRAVO_LETTER_BOX_PAD * 2,
  height: BRAVO_LETTER_BOX_HEIGHT + BRAVO_LETTER_BOX_PAD * 2,
});

function bravoLetterEntry(letter: string, bright: boolean): BigTopPropCatalogueEntry {
  return memoEntry(
    'bravoLetter',
    `${letter}-${bright ? 'bright' : 'dim'}`,
    BRAVO_LETTER_BOX,
    (target, originX, originY, px) =>
      paintBravoLetter(target, originX, originY, px, letter, bright),
  );
}

const CHASE_ON_STYLE = rgba(GILT_GLINT, 1);
/** The board has a rail of chase bulbs along its top and its bottom. */
const MARQUEE_RAILS = 2;
/** The chase is filled in two passes, on-beat bulbs then off-beat, one path each. */
const CHASE_PASSES = 2;
const ON_BEAT_PASS = 0;
const CHASE_OFF_STYLE = rgba(GILT_GLINT, MARQUEE_OFF_BEAT_ALPHA);

/** The solved board's chasing rim: every lit bulb in one path per brightness. */
function paintRimChase(
  ctx: Ctx,
  x: number,
  top: number,
  width: number,
  size: number,
  phase: number,
): void {
  const chaseStep = Math.floor(phase / MARQUEE_CHASE_PERIOD_FRAMES);
  const rimInset = MARQUEE_RIM_INSET * size;
  const rimCount = marqueeRimCount(width, size);
  const rimRadius = Math.max(1, MARQUEE_RIM_BULB_RADIUS * size);
  const height = MARQUEE_HEIGHT * size;
  const lastPositionRoundBoard = rimCount * MARQUEE_RAILS - 1;
  ctx.save();
  try {
    for (let pass = 0; pass < CHASE_PASSES; pass++) {
      const onBeatPass = pass === ON_BEAT_PASS;
      ctx.beginPath();
      for (let rail = 0; rail < MARQUEE_RAILS; rail++) {
        const topRail = rail === 0;
        const railY = topRail ? top + rimInset : top + height - rimInset;
        for (let bulb = 0; bulb < rimCount; bulb++) {
          // The bottom rail runs the other way, so the chase goes round the board.
          const position = topRail ? bulb : lastPositionRoundBoard - bulb;
          const onBeat = (position + chaseStep) % MARQUEE_CHASE_STRIDE === 0;
          if (onBeat !== onBeatPass) continue;
          const bulbX = x + rimInset + ((width - rimInset * 2) * bulb) / (rimCount - 1);
          ctx.moveTo(bulbX + rimRadius, railY);
          ctx.arc(bulbX, railY, rimRadius, 0, FULL_TURN);
        }
      }
      ctx.fillStyle = onBeatPass ? CHASE_ON_STYLE : CHASE_OFF_STYLE;
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * The marquee over the exits: one star-shaped bulb per star on the board, in
 * that star's colour and pattern, each lit exactly while its star is — an
 * unlit bulb is dark glass with its pattern and rim still showing, and the
 * encore's bulb wears a sunburst. When the whole board lights, the rim
 * chases and the board spells BRAVO, then settles back to its bulbs under
 * the chasing rim. `x` is the left edge of the first wall
 * tile it spans; it is `starMarqueeWidthTiles(bulbs.length)` tiles wide. The
 * board, each bulb look and each letter are baked; only the chase is live.
 */
export function drawStarMarquee(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: StarMarqueeArt,
): void {
  const widthTiles = starMarqueeWidthTiles(art.bulbs.length);
  const width = widthTiles * size;
  const top = y + MARQUEE_TOP * size;
  drawEntry(ctx, marqueeBoardEntry(art.bulbs.length), x, y, size);

  const sinceSolved = art.framesSinceSolved;
  // The chase keeps running for as long as the board stays solved.
  if (sinceSolved !== null) paintRimChase(ctx, x, top, width, size, art.phase);
  if (sinceSolved === null || sinceSolved >= BRAVO_SHOW_FRAMES) {
    const slotsWidth = art.bulbs.length * MARQUEE_SLOT_TILES * size;
    const firstSlotLeft = x + (width - slotsWidth) / 2;
    const centreY = top + (MARQUEE_HEIGHT * size) / 2;
    let slot = 0;
    for (const bulb of art.bulbs) {
      const centreX = firstSlotLeft + (slot + SLOT_MIDDLE) * MARQUEE_SLOT_TILES * size;
      slot++;
      drawEntry(
        ctx,
        marqueeBulbEntry(bulb.kind, bulbLookOf(bulb)),
        centreX - size / 2,
        centreY - size / 2,
        size,
      );
    }
    return;
  }

  const lettersShown = Math.min(
    BRAVO_TEXT.length,
    Math.floor(sinceSolved / BRAVO_LETTER_FRAMES) + 1,
  );
  const spelt = lettersShown === BRAVO_TEXT.length;
  const chasedLetter = Math.floor(art.phase / BRAVO_CHASE_FRAMES) % BRAVO_TEXT.length;
  const letterSlot = (width - MARQUEE_MARGIN_TILES * size) / BRAVO_TEXT.length;
  const lettersLeft = x + (MARQUEE_MARGIN_TILES * size) / 2;
  for (let index = 0; index < lettersShown; index++) {
    const bright = !spelt || index === chasedLetter;
    const slotCentre = lettersLeft + (index + SLOT_MIDDLE) * letterSlot;
    drawEntry(
      ctx,
      bravoLetterEntry(BRAVO_TEXT.charAt(index), bright),
      slotCentre - (BRAVO_LETTER_BOX_WIDTH * size) / 2,
      top + BRAVO_LETTER_TOP * size,
      size,
    );
  }
}

// ── Splitters ───────────────────────────────────────────────────────────────

/** The pane stands on the floor diagonal, this far in from the tile's corners, and this tall. */
const SPLITTER_CORNER_INSET = 0.14;
const SPLITTER_HEIGHT = 0.52;
const SPLITTER_BOX: BigTopPropBox = { left: 0, top: -0.625, width: 1, height: 1.625 };
const SPLITTER_GLASS_TOP: RGB = [206, 226, 240];
const SPLITTER_GLASS_BOTTOM: RGB = [120, 150, 176];
/** The glass is see-through: the floor shows through it at this share. */
const SPLITTER_GLASS_ALPHA = 0.42;
/** The half-silvering, laid as fine horizontal bands: this pitch and this band, as shares of the tile. */
const SILVERING_PITCH = 0.09;
const SILVERING_BAND = 0.04;
const SILVERING_ALPHA = 0.7;
const SPLITTER_FRAME_WIDTH = 0.05;
const SPLITTER_RAIL_WIDTH = 0.07;
const SPLITTER_POST_WIDTH = 0.06;
const SPLITTER_FINIAL_RADIUS = 0.045;
const SPLITTER_SHADOW_RADIUS_X = 0.5;
const SPLITTER_SHADOW_RADIUS_Y = 0.14;
const SPLITTER_SHADOW_ALPHA = 0.5;
/** The diamond on the pane's middle says "this glass does two things", as a share of the tile. */
const SPLITTER_BADGE_RADIUS = 0.07;

interface SplitterGeometry {
  readonly footA: { x: number; y: number };
  readonly footB: { x: number; y: number };
  readonly lift: number;
}

function splitterGeometry(
  originX: number,
  originY: number,
  size: number,
  diagonal: SplitterDiagonal,
): SplitterGeometry {
  const near = SPLITTER_CORNER_INSET * size;
  const far = size - near;
  const footA =
    diagonal === 'slash'
      ? { x: originX + near, y: originY + far }
      : { x: originX + near, y: originY + near };
  const footB =
    diagonal === 'slash'
      ? { x: originX + far, y: originY + near }
      : { x: originX + far, y: originY + far };
  return { footA, footB, lift: SPLITTER_HEIGHT * size };
}

function traceSplitterPane(ctx: Ctx, pane: SplitterGeometry): void {
  ctx.beginPath();
  ctx.moveTo(pane.footA.x, pane.footA.y);
  ctx.lineTo(pane.footB.x, pane.footB.y);
  ctx.lineTo(pane.footB.x, pane.footB.y - pane.lift);
  ctx.lineTo(pane.footA.x, pane.footA.y - pane.lift);
  ctx.closePath();
}

/**
 * A splitter: a sheet of half-silvered glass standing on the tile's diagonal
 * in a plain pewter frame. Nobody owns it, so it wears neither crawler's
 * colours; it has no back, no turntable and no arch, so it never reads as a
 * mirror. The glass is see-through and banded with silvering, the look of
 * something that both lets light through and throws it aside.
 */
function paintSplitter(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  diagonal: SplitterDiagonal,
): void {
  const pane = splitterGeometry(originX, originY, size, diagonal);
  const midX = (pane.footA.x + pane.footB.x) / 2;
  const midY = (pane.footA.y + pane.footB.y) / 2;
  paintContactShadow(
    ctx,
    midX,
    midY,
    SPLITTER_SHADOW_RADIUS_X * size,
    SPLITTER_SHADOW_RADIUS_Y * size,
    SPLITTER_SHADOW_ALPHA,
  );
  const top = Math.min(pane.footA.y, pane.footB.y) - pane.lift;
  const bottom = Math.max(pane.footA.y, pane.footB.y);
  const glass = ctx.createLinearGradient(0, top, 0, bottom);
  glass.addColorStop(0, rgba(SPLITTER_GLASS_TOP, SPLITTER_GLASS_ALPHA));
  glass.addColorStop(1, rgba(SPLITTER_GLASS_BOTTOM, SPLITTER_GLASS_ALPHA));
  ctx.fillStyle = glass;
  traceSplitterPane(ctx, pane);
  ctx.fill();
  ctx.save();
  try {
    traceSplitterPane(ctx, pane);
    ctx.clip();
    ctx.fillStyle = rgba(PEWTER_LIGHT, SILVERING_ALPHA);
    const pitch = SILVERING_PITCH * size;
    for (let bandTop = top; bandTop < bottom; bandTop += pitch) {
      ctx.fillRect(originX, bandTop, size, SILVERING_BAND * size);
    }
  } finally {
    ctx.restore();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(PEWTER_MID, 1);
  ctx.lineWidth = SPLITTER_FRAME_WIDTH * size;
  traceSplitterPane(ctx, pane);
  ctx.stroke();
  traceSplitterPane(ctx, pane);
  inkCurrentPath(ctx, size);
  // The floor rail it stands in, heavier than the frame so the pane is plainly planted.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(PEWTER_DARK, 1);
  ctx.lineWidth = SPLITTER_RAIL_WIDTH * size;
  ctx.beginPath();
  ctx.moveTo(pane.footA.x, pane.footA.y);
  ctx.lineTo(pane.footB.x, pane.footB.y);
  ctx.stroke();
  for (const foot of [pane.footA, pane.footB]) {
    ctx.fillStyle = rgba(PEWTER_LIGHT, 1);
    ctx.beginPath();
    ctx.rect(
      foot.x - (SPLITTER_POST_WIDTH * size) / 2,
      foot.y - pane.lift,
      SPLITTER_POST_WIDTH * size,
      pane.lift,
    );
    ctx.fill();
    inkCurrentPath(ctx, size);
    ctx.beginPath();
    ctx.arc(foot.x, foot.y - pane.lift, SPLITTER_FINIAL_RADIUS * size, 0, FULL_TURN);
    ctx.fill();
    inkCurrentPath(ctx, size);
  }
  const badgeX = midX;
  const badgeY = midY - pane.lift / 2;
  const badge = SPLITTER_BADGE_RADIUS * size;
  ctx.fillStyle = rgba(PEWTER_LIGHT, 1);
  ctx.beginPath();
  ctx.moveTo(badgeX, badgeY - badge);
  ctx.lineTo(badgeX + badge, badgeY);
  ctx.lineTo(badgeX, badgeY + badge);
  ctx.lineTo(badgeX - badge, badgeY);
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);
}

function splitterEntry(diagonal: SplitterDiagonal): BigTopPropCatalogueEntry {
  return memoEntry('splitter', diagonal, SPLITTER_BOX, (target, originX, originY, px) =>
    paintSplitter(target, originX, originY, px, diagonal),
  );
}

/** The glint sliding across a splitter's or a window's glass: one pass per this many frames. */
const GLASS_GLINT_PERIOD_FRAMES = 200;
const GLASS_GLINT_WIDTH = 0.08;
const GLASS_GLINT_ALPHA = 0.5;
const GLASS_GLINT_STYLE = rgba(GILT_GLINT, GLASS_GLINT_ALPHA);

function glassGlintTravel(phase: number): number {
  const wrapped =
    ((phase % GLASS_GLINT_PERIOD_FRAMES) + GLASS_GLINT_PERIOD_FRAMES) % GLASS_GLINT_PERIOD_FRAMES;
  return wrapped / GLASS_GLINT_PERIOD_FRAMES;
}

/** A fixed splitter on its diagonal, a glint sliding across the glass. */
export function drawMazeSplitter(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  diagonal: SplitterDiagonal,
  phase: number,
): void {
  drawEntry(ctx, splitterEntry(diagonal), x, y, size);
  const lift = SPLITTER_HEIGHT * size;
  const near = SPLITTER_CORNER_INSET * size;
  const far = size - near;
  const leftFootY = y + (diagonal === 'slash' ? far : near);
  const rightFootY = y + (diagonal === 'slash' ? near : far);
  const glintX = x + size * glassGlintTravel(phase);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(x + near, leftFootY);
    ctx.lineTo(x + far, rightFootY);
    ctx.lineTo(x + far, rightFootY - lift);
    ctx.lineTo(x + near, leftFootY - lift);
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = GLASS_GLINT_STYLE;
    ctx.fillRect(glintX, y - lift, GLASS_GLINT_WIDTH * size, size + lift);
  } finally {
    ctx.restore();
  }
}

// ── Windows in the dividing wall ────────────────────────────────────────────

const WINDOW_FRAME_LEFT = 0.12;
const WINDOW_FRAME_TOP = 0.08;
const WINDOW_FRAME_BOTTOM = 0.8;
const WINDOW_GLASS_INSET = 0.09;
const WINDOW_MULLION_WIDTH = 0.045;
const WINDOW_SILL_TOP = 0.76;
const WINDOW_SILL_HEIGHT = 0.1;
const WINDOW_SILL_OVERHANG = 0.06;
/** Through the glass: the lit sawdust beyond, warm at the bottom. */
const WINDOW_GLASS_TOP: RGB = [170, 198, 214];
const WINDOW_GLASS_BOTTOM: RGB = [150, 128, 90];
const WINDOW_STREAK_ALPHA = 0.55;
/** Two reflection streaks across the glass, as shares of its width: where each starts and how wide. */
const WINDOW_STREAKS: ReadonlyArray<{ readonly at: number; readonly width: number }> = [
  { at: 0.15, width: 0.16 },
  { at: 0.45, width: 0.07 },
];
/** Each streak slants left by this share of the glass's width from top to bottom. */
const WINDOW_STREAK_SLANT = 0.45;
const WINDOW_FRAME: RGB = [60, 46, 36];

/** The glass inside the frame, as shares of the tile. */
const WINDOW_GLASS_LEFT = WINDOW_FRAME_LEFT + WINDOW_GLASS_INSET;
const WINDOW_GLASS_TOP_EDGE = WINDOW_FRAME_TOP + WINDOW_GLASS_INSET;
const WINDOW_GLASS_WIDTH = 1 - WINDOW_GLASS_LEFT * 2;
const WINDOW_GLASS_HEIGHT = WINDOW_SILL_TOP - WINDOW_GLASS_TOP_EDGE;

interface WindowGlass {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function windowGlass(originX: number, originY: number, size: number): WindowGlass {
  return {
    left: originX + WINDOW_GLASS_LEFT * size,
    top: originY + WINDOW_GLASS_TOP_EDGE * size,
    width: WINDOW_GLASS_WIDTH * size,
    height: WINDOW_GLASS_HEIGHT * size,
  };
}

/**
 * A window through the dividing wall: glass in a heavy timber frame with a
 * leaded cross, sitting on a sill with wall above and below it. It lets light
 * through and crawlers not — the sill, the frame all round and the streaked
 * glass say "wall with glass in it", never an open doorway.
 */
function paintWallWindow(ctx: Ctx, originX: number, originY: number, size: number): void {
  const frameLeft = originX + WINDOW_FRAME_LEFT * size;
  const frameRight = originX + size - WINDOW_FRAME_LEFT * size;
  const frameTop = originY + WINDOW_FRAME_TOP * size;
  const frameBottom = originY + WINDOW_FRAME_BOTTOM * size;
  ctx.fillStyle = rgba(WINDOW_FRAME, 1);
  ctx.beginPath();
  ctx.rect(frameLeft, frameTop, frameRight - frameLeft, frameBottom - frameTop);
  ctx.fill();
  inkCurrentPath(ctx, size);
  const glass = windowGlass(originX, originY, size);
  const fill = ctx.createLinearGradient(0, glass.top, 0, glass.top + glass.height);
  fill.addColorStop(0, rgba(WINDOW_GLASS_TOP, 1));
  fill.addColorStop(1, rgba(WINDOW_GLASS_BOTTOM, 1));
  ctx.fillStyle = fill;
  ctx.fillRect(glass.left, glass.top, glass.width, glass.height);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(glass.left, glass.top, glass.width, glass.height);
    ctx.clip();
    ctx.fillStyle = rgba(HOT_WHITE, WINDOW_STREAK_ALPHA);
    const slant = glass.width * WINDOW_STREAK_SLANT;
    for (const streak of WINDOW_STREAKS) {
      const left = glass.left + glass.width * streak.at;
      const width = glass.width * streak.width;
      ctx.beginPath();
      ctx.moveTo(left + slant, glass.top);
      ctx.lineTo(left + slant + width, glass.top);
      ctx.lineTo(left + width, glass.top + glass.height);
      ctx.lineTo(left, glass.top + glass.height);
      ctx.closePath();
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
  const mullion = Math.max(1, WINDOW_MULLION_WIDTH * size);
  ctx.fillStyle = rgba(IRON.shadow, 1);
  ctx.fillRect(glass.left + glass.width / 2 - mullion / 2, glass.top, mullion, glass.height);
  ctx.fillRect(glass.left, glass.top + glass.height / 2 - mullion / 2, glass.width, mullion);
  ctx.beginPath();
  ctx.rect(glass.left, glass.top, glass.width, glass.height);
  inkCurrentPath(ctx, size);
  const sillTop = originY + WINDOW_SILL_TOP * size;
  const sill = ctx.createLinearGradient(0, sillTop, 0, sillTop + WINDOW_SILL_HEIGHT * size);
  sill.addColorStop(0, rgba(ROT_TIMBER.accent, 1));
  sill.addColorStop(1, rgba(ROT_TIMBER.mid, 1));
  ctx.fillStyle = sill;
  ctx.beginPath();
  ctx.rect(
    frameLeft - WINDOW_SILL_OVERHANG * size,
    sillTop,
    frameRight - frameLeft + WINDOW_SILL_OVERHANG * size * 2,
    WINDOW_SILL_HEIGHT * size,
  );
  ctx.fill();
  inkCurrentPath(ctx, size);
}

function wallWindowEntry(): BigTopPropCatalogueEntry {
  return memoEntry('wallWindow', 'glass', ONE_TILE_BOX, (target, originX, originY, px) =>
    paintWallWindow(target, originX, originY, px),
  );
}

/** A glass window set in the dividing wall: light passes, crawlers do not. */
export function drawMazeWallWindow(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  drawEntry(ctx, wallWindowEntry(), x, y, size);
  const glassLeft = x + WINDOW_GLASS_LEFT * size;
  const glassTop = y + WINDOW_GLASS_TOP_EDGE * size;
  const glassWidth = WINDOW_GLASS_WIDTH * size;
  const glassHeight = WINDOW_GLASS_HEIGHT * size;
  const glintWidth = GLASS_GLINT_WIDTH * size;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(glassLeft, glassTop, glassWidth, glassHeight);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = GLASS_GLINT_STYLE;
    ctx.fillRect(
      glassLeft - glintWidth + (glassWidth + glintWidth) * glassGlintTravel(phase),
      glassTop,
      glintWidth,
      glassHeight,
    );
  } finally {
    ctx.restore();
  }
}

// ── The teaching strip's footlight lamps ────────────────────────────────────

const LAMP_BODY_HALF_WIDTH = 0.2;
/** The lamp's body is centred on the tile's middle row, so its lens sits on the light's line. */
const LAMP_BODY_TOP = 0.34;
const LAMP_BODY_BOTTOM = 0.66;
const LAMP_CORNER = 0.06;
const LAMP_FOOT_WIDTH = 0.06;
const LAMP_FOOT_DROP = 0.08;
const LAMP_FOOT_SPREAD = 0.13;
const LAMP_LENS_RADIUS = 0.1;
/** A lens seen side-on is squashed to this share of its width; aimed away, it is a sliver on the top edge. */
const LAMP_LENS_FORESHORTEN = 0.5;
const LAMP_REAR_LENS_SQUASH = 0.4;
const LAMP_BAND_WIDTH = 0.05;
const LAMP_SHADOW_RADIUS_X = 0.3;
const LAMP_SHADOW_RADIUS_Y = 0.09;
const LAMP_SHADOW_ALPHA = 0.55;
/** The lamp's hood stripes (Donut's) and chevron (Carl's), as shares of the tile. */
const LAMP_STRIPE_PITCH = 0.08;
const LAMP_CHEVRON_WIDTH = 0.04;
/** Carl's chevron on the hood: its arms' tops and point, as shares down the body, and its reach as a share of the half-width. */
const LAMP_CHEVRON_TOP = 0.25;
const LAMP_CHEVRON_POINT = 0.7;
const LAMP_CHEVRON_REACH = 0.7;

function lampLensCentre(
  originX: number,
  originY: number,
  size: number,
  direction: BeamDirection,
): { x: number; y: number } {
  const centreX = originX + size / 2;
  const middleY = originY + ((LAMP_BODY_TOP + LAMP_BODY_BOTTOM) / 2) * size;
  if (direction === 'east') return { x: centreX + LAMP_BODY_HALF_WIDTH * size, y: middleY };
  if (direction === 'west') return { x: centreX - LAMP_BODY_HALF_WIDTH * size, y: middleY };
  if (direction === 'north') return { x: centreX, y: originY + LAMP_BODY_TOP * size };
  return { x: centreX, y: middleY };
}

/**
 * A footlight lamp: a squat hooded lamp on two feet, painted in its owner's
 * colours with that owner's pattern — Carl's blue with a brass chevron,
 * Donut's red with bone stripes — and its lens aimed down the strip. Aimed
 * north, away from the viewer, the lens shows as a lit sliver on its top.
 */
function paintFootlightLamp(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  direction: BeamDirection,
  colour: LightColour,
): void {
  const centreX = originX + size / 2;
  const bodyTop = originY + LAMP_BODY_TOP * size;
  const bodyBottom = originY + LAMP_BODY_BOTTOM * size;
  const halfWidth = LAMP_BODY_HALF_WIDTH * size;
  paintContactShadow(
    ctx,
    centreX,
    bodyBottom + LAMP_FOOT_DROP * size,
    LAMP_SHADOW_RADIUS_X * size,
    LAMP_SHADOW_RADIUS_Y * size,
    LAMP_SHADOW_ALPHA,
  );
  ctx.fillStyle = rgba(IRON.mid, 1);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(
      centreX + side * LAMP_FOOT_SPREAD * size - (LAMP_FOOT_WIDTH * size) / 2,
      bodyBottom - LAMP_FOOT_WIDTH * size,
      LAMP_FOOT_WIDTH * size,
      LAMP_FOOT_DROP * size + LAMP_FOOT_WIDTH * size,
    );
    ctx.fill();
    inkCurrentPath(ctx, size);
  }
  const ramp = colour === 'blue' ? RINGMASTER : STAGE_RED;
  const traceBody = (): void => {
    ctx.beginPath();
    ctx.roundRect(
      centreX - halfWidth,
      bodyTop,
      halfWidth * 2,
      bodyBottom - bodyTop,
      LAMP_CORNER * size,
    );
  };
  const body = ctx.createLinearGradient(0, bodyTop, 0, bodyBottom);
  body.addColorStop(0, rgba(ramp.light, 1));
  body.addColorStop(1, rgba(ramp.shadow, 1));
  ctx.fillStyle = body;
  traceBody();
  ctx.fill();
  ctx.save();
  try {
    traceBody();
    ctx.clip();
    if (colour === 'red') {
      ctx.fillStyle = rgba(BONE.light, 1);
      const pitch = LAMP_STRIPE_PITCH * size;
      for (
        let stripeX = centreX - halfWidth + pitch / 2;
        stripeX < centreX + halfWidth;
        stripeX += pitch * 2
      ) {
        ctx.fillRect(stripeX, bodyTop, pitch, bodyBottom - bodyTop);
      }
    } else {
      ctx.strokeStyle = rgba(BRASS.accent, 1);
      ctx.lineWidth = Math.max(1, LAMP_CHEVRON_WIDTH * size);
      const chevronTop = bodyTop + (bodyBottom - bodyTop) * LAMP_CHEVRON_TOP;
      const chevronPoint = bodyTop + (bodyBottom - bodyTop) * LAMP_CHEVRON_POINT;
      ctx.beginPath();
      ctx.moveTo(centreX - halfWidth * LAMP_CHEVRON_REACH, chevronTop);
      ctx.lineTo(centreX, chevronPoint);
      ctx.lineTo(centreX + halfWidth * LAMP_CHEVRON_REACH, chevronTop);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
  ctx.fillStyle = rgba(BRASS.mid, 1);
  ctx.fillRect(centreX - halfWidth, bodyTop, halfWidth * 2, Math.max(1, LAMP_BAND_WIDTH * size));
  traceBody();
  inkCurrentPath(ctx, size);
  const lens = lampLensCentre(originX, originY, size, direction);
  const look = LIGHT_LOOK[colour];
  const sideways = direction === 'east' || direction === 'west';
  const radiusX = LAMP_LENS_RADIUS * size * (sideways ? LAMP_LENS_FORESHORTEN : 1);
  const radiusY = LAMP_LENS_RADIUS * size * (direction === 'north' ? LAMP_REAR_LENS_SQUASH : 1);
  const lensFill = ctx.createRadialGradient(lens.x, lens.y, 0, lens.x, lens.y, radiusX);
  lensFill.addColorStop(0, rgba(look.core, 1));
  lensFill.addColorStop(1, rgba(look.body, 1));
  ctx.fillStyle = lensFill;
  ctx.beginPath();
  ctx.ellipse(lens.x, lens.y, radiusX, radiusY, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = rgba(BRASS.accent, 1);
  ctx.lineWidth = outlineWidth(size);
  ctx.stroke();
}

function footlightLampEntry(
  direction: BeamDirection,
  colour: LightColour,
): BigTopPropCatalogueEntry {
  return memoEntry(
    'footlightLamp',
    `${colour}-${direction}`,
    ONE_TILE_BOX,
    (target, originX, originY, px) =>
      paintFootlightLamp(target, originX, originY, px, direction, colour),
  );
}

/** Where a footlight lamp's lens sits on its tile, in tiles from the tile's top-left: where its light starts. */
export function footlightLampLensOffset(direction: BeamDirection): {
  readonly x: number;
  readonly y: number;
} {
  return LAMP_LENS_OFFSETS[direction];
}

const LAMP_LENS_OFFSETS: Readonly<
  Record<BeamDirection, { readonly x: number; readonly y: number }>
> = {
  north: lampLensCentre(0, 0, 1, 'north'),
  south: lampLensCentre(0, 0, 1, 'south'),
  east: lampLensCentre(0, 0, 1, 'east'),
  west: lampLensCentre(0, 0, 1, 'west'),
};

const LAMP_BLOOM_RADIUS = 0.45;
const LAMP_BLOOM_FLICKER_DEPTH = 0.15;
/** The bloom's flicker is quantised to this many steps, so a slow lamp does not shimmer every frame. */
const LAMP_BLOOM_FRAMES = 6;
const LAMP_BLOOM_PERIOD_FRAMES = 48;

/**
 * The teaching strip's small light: a footlight lamp in its owner's colours,
 * its lens throwing that owner's light the way it is aimed.
 */
export function drawFootlightLamp(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  direction: BeamDirection,
  colour: LightColour,
  phase: number,
): void {
  drawEntry(ctx, footlightLampEntry(direction, colour), x, y, size);
  const lens = footlightLampLensOffset(direction);
  const step = loopFrame(phase, LAMP_BLOOM_PERIOD_FRAMES, LAMP_BLOOM_FRAMES);
  const cycle = (step / LAMP_BLOOM_FRAMES) * FULL_TURN;
  const flicker = 1 - LAMP_BLOOM_FLICKER_DEPTH * unitWave(cycle);
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flicker;
    drawRadialGlow(
      ctx,
      x + lens.x * size,
      y + lens.y * size,
      LAMP_BLOOM_RADIUS * size,
      LIGHT_GLOW_STOPS[colour],
    );
  } finally {
    ctx.restore();
  }
}

// ── The coloured lights ─────────────────────────────────────────────────────

type BeamAxis = 'horizontal' | 'vertical';
/** Where across its axis a run is laid: on the centre line, or to one side when both lights share the axis. */
type BeamLane = 'centre' | 'before' | 'after';

const BEAM_HALF_WIDTH = 0.2;
/** When both lights run the same way through a tile they sit side by side, this far off the centre line. */
const BEAM_LANE_OFFSET = 0.13;
/** Lanes that share a tile are drawn narrower so they stay apart. */
const SHARED_LANE_WIDTH_SHARE = 0.65;

function axisOf(heading: BeamDirection): BeamAxis {
  return heading === 'north' || heading === 'south' ? 'vertical' : 'horizontal';
}

function laneShift(lane: BeamLane): number {
  if (lane === 'before') return -BEAM_LANE_OFFSET;
  if (lane === 'after') return BEAM_LANE_OFFSET;
  return 0;
}

function laneHalfWidth(lane: BeamLane): number {
  return lane === 'centre' ? BEAM_HALF_WIDTH : BEAM_HALF_WIDTH * SHARED_LANE_WIDTH_SHARE;
}

/** The side of a tile a partial run lies on: where an entering run came in, or where a leaving run goes out. */
function runSide(run: LightBeamRun): BeamDirection {
  if (run.span === 'leaving') return run.heading;
  if (run.heading === 'north') return 'south';
  if (run.heading === 'south') return 'north';
  if (run.heading === 'east') return 'west';
  return 'east';
}

/** How a partial run meets the piece on its tile: how far short of the centre it stops, and how strongly it shows. */
interface StopShape {
  /** Distance from the tile's centre to where the run ends, in tiles. */
  readonly inset: number;
  readonly alpha: number;
}

const HALF_TILE = 0.5;
const OPEN_STOP: StopShape = { inset: 0, alpha: 1 };
/** A stop that hides its whole half of the tile. */
const HIDDEN_INSET = HALF_TILE;
/** A star's plate is what the light strikes. */
const STAR_STOP: StopShape = { inset: WALL_STAR_PLATE_RADIUS, alpha: 1 };
/**
 * A mirror's upright glass stands over the middle of its tile: light from
 * the side meets the glass's edge, light from the south meets the front of
 * the turntable, and light from the north runs in behind the glass, hidden.
 */
const MIRROR_SIDE_STOP: StopShape = { inset: 0.3, alpha: 1 };
const MIRROR_FRONT_STOP: StopShape = { inset: 0.2, alpha: 1 };
const MIRROR_BEHIND_STOP: StopShape = { inset: HIDDEN_INSET, alpha: 1 };
/** Light seen through a splitter's glass: the pane stands in front of the floor on its far side. */
const SPLITTER_SEEN_THROUGH_ALPHA = 0.45;
const SPLITTER_BEHIND_STOP: StopShape = { inset: 0, alpha: SPLITTER_SEEN_THROUGH_ALPHA };
/** A lamp's light starts at its lens: its side, its front face (below the feet), or the sliver on its top. */
const LAMP_SIDE_STOP: StopShape = { inset: LAMP_BODY_HALF_WIDTH, alpha: 1 };
const LAMP_FRONT_STOP: StopShape = {
  inset: LAMP_BODY_BOTTOM + LAMP_FOOT_DROP - HALF_TILE,
  alpha: 1,
};
const LAMP_REAR_STOP: StopShape = { inset: HALF_TILE - LAMP_BODY_TOP, alpha: 1 };

/**
 * Which sides of a splitter's tile lie behind its pane. The pane stands up
 * from its floor diagonal, so floor further up the screen than the diagonal
 * is behind the glass: north always, and west for `/` (whose foot drops
 * below the centre on that side) or east for `\`.
 */
function behindSplitter(diagonal: SplitterDiagonal, side: BeamDirection): boolean {
  if (side === 'north') return true;
  if (side === 'south') return false;
  return diagonal === 'slash' ? side === 'west' : side === 'east';
}

function stopShape(stop: BeamStop, side: BeamDirection): StopShape {
  const sideways = side === 'east' || side === 'west';
  if (stop === 'star') return STAR_STOP;
  if (stop === 'mirror') {
    if (sideways) return MIRROR_SIDE_STOP;
    return side === 'south' ? MIRROR_FRONT_STOP : MIRROR_BEHIND_STOP;
  }
  if (stop === 'lamp') {
    if (sideways) return LAMP_SIDE_STOP;
    return side === 'south' ? LAMP_FRONT_STOP : LAMP_REAR_STOP;
  }
  const diagonal = stop === 'splitter_slash' ? 'slash' : 'backslash';
  return behindSplitter(diagonal, side) ? SPLITTER_BEHIND_STOP : OPEN_STOP;
}

/** The stretch of the tile a run covers along its axis, as shares of the tile, and how strongly it shows. */
interface RunExtent {
  readonly from: number;
  readonly to: number;
  readonly alpha: number;
}

const FULL_EXTENT: RunExtent = { from: 0, to: 1, alpha: 1 };

function runExtent(run: LightBeamRun): RunExtent {
  if (run.span === 'through') return FULL_EXTENT;
  const side = runSide(run);
  const shape = run.stopAt === undefined ? OPEN_STOP : stopShape(run.stopAt, side);
  const lowSide = side === 'west' || side === 'north';
  return lowSide
    ? { from: 0, to: HALF_TILE - shape.inset, alpha: shape.alpha }
    : { from: HALF_TILE + shape.inset, to: 1, alpha: shape.alpha };
}

/** The body of a coloured beam, from the axis outward: core, body, edge, then nothing. */
const BEAM_BODY_STOPS: ReadonlyArray<{
  readonly at: number;
  readonly part: keyof LightLook;
  readonly alpha: number;
}> = [
  { at: 0, part: 'core', alpha: 1 },
  { at: 0.3, part: 'core', alpha: 1 },
  { at: 0.5, part: 'body', alpha: 1 },
  { at: 0.78, part: 'edge', alpha: 0.75 },
  { at: 1, part: 'edge', alpha: 0 },
];
/** Donut's red is laid as a dim underglow, the dashes carrying the colour. */
const RED_UNDERGLOW_ALPHA = 0.35;

function paintBeamBody(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  colour: LightColour,
  axis: BeamAxis,
  lane: BeamLane,
): void {
  const look = LIGHT_LOOK[colour];
  const half = laneHalfWidth(lane) * size;
  const vertical = axis === 'vertical';
  const centre = (vertical ? originX : originY) + size / 2 + laneShift(lane) * size;
  const gradient = vertical
    ? ctx.createLinearGradient(centre - half, 0, centre + half, 0)
    : ctx.createLinearGradient(0, centre - half, 0, centre + half);
  const strength = colour === 'blue' ? 1 : RED_UNDERGLOW_ALPHA;
  // Mirrored about the axis: the same stops run outward from the core both ways.
  for (const stop of BEAM_BODY_STOPS) {
    const style = rgba(look[stop.part], stop.alpha * strength);
    gradient.addColorStop(0.5 - stop.at / 2, style);
    gradient.addColorStop(0.5 + stop.at / 2, style);
  }
  ctx.fillStyle = gradient;
  if (vertical) ctx.fillRect(centre - half, originY, half * 2, size);
  else ctx.fillRect(originX, centre - half, size, half * 2);
}

/** Carl's light only ever shares a tile from the `before` side, Donut's from the `after` side. */
const LANES_BY_COLOUR: Readonly<Record<LightColour, ReadonlyArray<BeamLane>>> = {
  blue: ['centre', 'before'],
  red: ['centre', 'after'],
};

function lightBeamEntry(
  colour: LightColour,
  axis: BeamAxis,
  lane: BeamLane,
): BigTopPropCatalogueEntry {
  const id = `${colour}-${axis}-${lane}`;
  const known = entryMemo.get(`lightBeam|${id}`);
  if (known !== undefined) return known;
  const entry: BigTopPropCatalogueEntry = {
    key: { prop: 'lightBeam', state: id, frame: 0 },
    box: ONE_TILE_BOX,
    painter: (target, originX, originY, px) =>
      paintBeamBody(target, originX, originY, px, colour, axis, lane),
    openEdges: axis === 'vertical' ? ['top', 'bottom'] : ['left', 'right'],
  };
  entryMemo.set(`lightBeam|${id}`, entry);
  return entry;
}

/** Red dashes: one dash and one gap per this share of a tile, so they run on unbroken into the next tile. */
const DASH_PERIOD = 1 / 3;
const DASH_LENGTH = 0.2;
/** A dash is three nested bands, edge to core: each one's half-width as a share of the tile, and its colour. */
const RED_DASH_LAYERS: ReadonlyArray<{ readonly halfWidth: number; readonly style: string }> = [
  { halfWidth: 0.075, style: rgba(RED_LIGHT.edge, 1) },
  { halfWidth: 0.05, style: rgba(RED_LIGHT.body, 1) },
  { halfWidth: 0.03, style: rgba(RED_LIGHT.core, 1) },
];
/** How far the dashes and glints march along the light each frame, in tiles. */
const BEAM_MARCH_PER_FRAME = 0.015;
/** Blue's brass glints: one per this share of a tile, each a diamond this long and this wide. */
const BLUE_GLINT_PITCH = 0.5;
const BLUE_GLINT_LENGTH = 0.12;
const BLUE_GLINT_HALF_WIDTH = 0.05;
const BLUE_SPINE_HALF_WIDTH = 0.018;
const BLUE_SPINE_STYLE = rgba(GILT_GLINT, 1);
const BLUE_GLINT_STYLE = rgba(BRASS.accent, 1);

function runLane(run: LightBeamRun, runs: ReadonlyArray<LightBeamRun>): BeamLane {
  const axis = axisOf(run.heading);
  for (const other of runs) {
    if (other.colour !== run.colour && axisOf(other.heading) === axis) {
      return run.colour === 'blue' ? 'before' : 'after';
    }
  }
  return 'centre';
}

/** Where along the axis a marching mark sits, wrapped into one period: the same on every tile, so marks run on across seams. */
function marchOffset(heading: BeamDirection, phase: number, period: number): number {
  const forward = heading === 'south' || heading === 'east' ? 1 : -1;
  const travelled = phase * BEAM_MARCH_PER_FRAME * forward;
  return ((travelled % period) + period) % period;
}

function paintBlueMarks(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  run: LightBeamRun,
  lane: BeamLane,
  extent: RunExtent,
  phase: number,
): void {
  const vertical = axisOf(run.heading) === 'vertical';
  const centre = (vertical ? x : y) + size / 2 + laneShift(lane) * size;
  const origin = vertical ? y : x;
  const start = origin + extent.from * size;
  const length = (extent.to - extent.from) * size;
  const spine = Math.max(1, BLUE_SPINE_HALF_WIDTH * size);
  ctx.fillStyle = BLUE_SPINE_STYLE;
  if (vertical) ctx.fillRect(centre - spine / 2, start, spine, length);
  else ctx.fillRect(start, centre - spine / 2, length, spine);
  const offset = marchOffset(run.heading, phase, BLUE_GLINT_PITCH);
  const halfLength = (BLUE_GLINT_LENGTH * size) / 2;
  const halfWidth = BLUE_GLINT_HALF_WIDTH * size;
  ctx.fillStyle = BLUE_GLINT_STYLE;
  ctx.beginPath();
  for (let at = offset - BLUE_GLINT_PITCH; at < 1; at += BLUE_GLINT_PITCH) {
    const along = origin + at * size;
    if (along - halfLength < start || along + halfLength > start + length) continue;
    if (vertical) {
      ctx.moveTo(centre, along - halfLength);
      ctx.lineTo(centre + halfWidth, along);
      ctx.lineTo(centre, along + halfLength);
      ctx.lineTo(centre - halfWidth, along);
    } else {
      ctx.moveTo(along - halfLength, centre);
      ctx.lineTo(along, centre - halfWidth);
      ctx.lineTo(along + halfLength, centre);
      ctx.lineTo(along, centre + halfWidth);
    }
    ctx.closePath();
  }
  ctx.fill();
}

function paintRedDashes(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  run: LightBeamRun,
  lane: BeamLane,
  extent: RunExtent,
  phase: number,
): void {
  const vertical = axisOf(run.heading) === 'vertical';
  const centre = (vertical ? x : y) + size / 2 + laneShift(lane) * size;
  const origin = vertical ? y : x;
  const start = origin + extent.from * size;
  const end = origin + extent.to * size;
  const offset = marchOffset(run.heading, phase, DASH_PERIOD);
  const minHalfWidth = outlineWidth(size) / 2;
  for (const layer of RED_DASH_LAYERS) {
    const halfWidth = Math.max(minHalfWidth, layer.halfWidth * size);
    ctx.fillStyle = layer.style;
    for (let at = offset - DASH_PERIOD; at < 1; at += DASH_PERIOD) {
      const from = Math.max(start, origin + at * size);
      const to = Math.min(end, origin + (at + DASH_LENGTH) * size);
      if (to <= from) continue;
      if (vertical) ctx.fillRect(centre - halfWidth, from, halfWidth * 2, to - from);
      else ctx.fillRect(from, centre - halfWidth, to - from, halfWidth * 2);
    }
  }
}

function paintRun(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  run: LightBeamRun,
  runs: ReadonlyArray<LightBeamRun>,
  phase: number,
): void {
  const extent = runExtent(run);
  if (extent.to <= extent.from) return;
  const axis = axisOf(run.heading);
  const lane = runLane(run, runs);
  ctx.save();
  try {
    ctx.globalAlpha = extent.alpha;
    if (extent !== FULL_EXTENT) {
      ctx.beginPath();
      if (axis === 'vertical')
        ctx.rect(x, y + extent.from * size, size, (extent.to - extent.from) * size);
      else ctx.rect(x + extent.from * size, y, (extent.to - extent.from) * size, size);
      ctx.clip();
    }
    drawEntry(ctx, lightBeamEntry(run.colour, axis, lane), x, y, size);
    if (run.colour === 'blue') paintBlueMarks(ctx, x, y, size, run, lane, extent, phase);
    else paintRedDashes(ctx, x, y, size, run, lane, extent, phase);
  } finally {
    ctx.restore();
  }
}

/**
 * One tile of coloured light: every run of light across it, blue and red.
 * Carl's blue is a solid band with a gilt spine and brass glints sliding
 * along it; Donut's red is a row of dashes marching the way the light goes.
 * Where both run the same way through a tile they lie side by side, and where
 * they cross each is drawn whole, red over blue. A splitter's branches are
 * ordinary runs, drawn at full strength. A partial run stops at the face of
 * the piece named by its `stopAt`. Meant for `renderTelegraphs`, above the
 * lighting mask: the light is what the player is aiming, so it is never dimmed.
 */
export function drawLightBeamTile(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  runs: ReadonlyArray<LightBeamRun>,
  phase: number,
): void {
  for (const run of runs) {
    if (run.colour === 'blue') paintRun(ctx, x, y, size, run, runs, phase);
  }
  for (const run of runs) {
    if (run.colour === 'red') paintRun(ctx, x, y, size, run, runs, phase);
  }
}

// ── Catalogue ───────────────────────────────────────────────────────────────

const HEADINGS: ReadonlyArray<BeamDirection> = ['north', 'south', 'east', 'west'];
const LIGHT_COLOURS: ReadonlyArray<LightColour> = ['blue', 'red'];
const BULB_LOOKS: ReadonlyArray<BulbLook> = ['lit', 'unlit', 'half_blue', 'half_red'];
/** The marquee has one bulb per star, and a board has at most this many stars. */
const MAX_MARQUEE_BULBS = 4;

/** Every picture the hall's puzzle pieces ask the prop cache for, for the art gate. */
export function mirrorPuzzlePropCatalogue(): ReadonlyArray<BigTopPropCatalogueEntry> {
  const entries: BigTopPropCatalogueEntry[] = [];
  for (const diagonal of ['slash', 'backslash'] as const) entries.push(splitterEntry(diagonal));
  entries.push(wallWindowEntry());
  for (const kind of PUZZLE_STAR_KINDS) {
    for (const state of PUZZLE_STAR_STATES) {
      if (bakedStarState(kind, state) === state) entries.push(puzzleStarEntry(kind, state));
    }
    for (const look of BULB_LOOKS) {
      const halfLook = look === 'half_blue' || look === 'half_red';
      if (!halfLook || kind === 'twin') entries.push(marqueeBulbEntry(kind, look));
    }
  }
  for (let bulbs = 1; bulbs <= MAX_MARQUEE_BULBS; bulbs++) entries.push(marqueeBoardEntry(bulbs));
  for (const letter of new Set(BRAVO_TEXT)) {
    for (const bright of [true, false]) entries.push(bravoLetterEntry(letter, bright));
  }
  for (const colour of LIGHT_COLOURS) {
    for (const axis of ['horizontal', 'vertical'] as const) {
      for (const lane of LANES_BY_COLOUR[colour]) entries.push(lightBeamEntry(colour, axis, lane));
    }
    for (const direction of HEADINGS) entries.push(footlightLampEntry(direction, colour));
  }
  return entries;
}
