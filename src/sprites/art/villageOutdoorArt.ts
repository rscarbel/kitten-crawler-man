/**
 * Briar Hollow's outdoor props: the square, the farm, the lumber yard, the quarry
 * and the clutter in the streets.
 *
 * Each painter receives the footprint's bottom-left tile as its origin; see
 * `VillagePropFrame` in `villageArt.ts` for the contract.
 *
 * Every painter below is written in **tiles**, not pixels: `x` rightward from
 * the footprint's left edge and `up` upward from its bottom edge — the same
 * space as the live overlay anchors (`BELL_PIVOT`, `SAWMILL_BLADE`,
 * `LAMP_POST_LANTERN`), so the baked half of a prop and the half drawn live are
 * placed by one ruler. A point on the ground at depth `d` sits at `up = d`; a
 * point `h` tiles above that ground sits at `up = d + h`, because the view is a
 * 3/4 oblique in which verticals rise straight up the screen.
 *
 * The seed only ever reaches tone, grain and wear. Every silhouette is fixed
 * geometry, so a floor's art seed can never move a prop off its footprint.
 */

import { range, type Rng } from '../person/rng';
import { fillSoftEllipse, withClip } from './softShade';
import {
  BELL_PIVOT,
  BRASS,
  CLOTH,
  INK,
  IRON,
  LAMP_POST_LANTERN,
  LOG,
  MOSS,
  SAWMILL_BLADE,
  SAWMILL_BLADE_RADIUS_TILES,
  STONE,
  WOOD,
  drawBriarKnot,
  drawContactShadow,
  drawFieldstones,
  drawLantern,
  drawLogEnd,
  drawPlanks,
  drawWattle,
  footprintBox,
  forkRng,
  jitter,
  type Ctx,
  type OutdoorPropId,
  type VillagePropArt,
  type VillagePropFrame,
  type VillagePropPainter,
} from './villageArt';

const TWO_PI = Math.PI * 2;

// ── Outdoor-only palette ──────────────────────────────────────────────────────

const STRAW = { dark: '#7a5c22', body: '#b8923e', light: '#dcc070', glint: '#efdc9a' } as const;
const BURLAP = { dark: '#5a4630', body: '#86704e', light: '#a68c64' } as const;
/** Clear, shallow water: the floor of the trough shows through a cool green-grey. */
const WATER = { deep: '#1e3438', body: '#3a6264', light: '#6a9892', glint: '#c4e0d8' } as const;
const PRODUCE = {
  apple: '#9a3226',
  appleLight: '#cc5a42',
  turnip: '#d8ccb0',
  turnipBlush: '#8a4a72',
  leaf: '#5a7a34',
} as const;
const MUSHROOM = { cap: '#a47a4c', capLight: '#d0ac7c', gill: '#e6d6b4' } as const;
const SAWDUST = { body: '#b89868', light: '#d6bc8e' } as const;
/** The dark behind an opening: the belfry's hollow, the gap under a trestle. */
const HOLLOW_SHADE = '#140c06';

// ── Frame geometry ────────────────────────────────────────────────────────────

/** The outline every silhouette carries, so a prop reads on dark planks and on grass. */
const OUTLINE_TILES = 0.028;
/** The lit and shaded strips down a timber, as fractions of its width. */
const TIMBER_LIT_SHARE = 0.3;
const TIMBER_SHADE_SHARE = 0.3;
/** How far a round log's cut end is foreshortened, as a fraction of its width. */
const LOG_CAP_SQUASH = 0.32;
/** Inner detail lines — seams, staves, grain, stitching — are thinner than a silhouette. */
const FINE_LINE_SHARE = 0.55;
/** Opacities for a soft highlight: a wet or polished glint, a lit shoulder, a faint bloom. */
const SHEEN = { strong: 0.85, medium: 0.7, soft: 0.55 } as const;
/** Below this length a strut has no direction to shade across. */
const DEGENERATE_LENGTH_PX = 0.5;

interface Grid {
  /** Pixels per tile. */
  readonly ts: number;
  /** Outline width in pixels. */
  readonly ink: number;
  readonly x: (tiles: number) => number;
  readonly y: (upTiles: number) => number;
  readonly s: (tiles: number) => number;
}

function gridOf(frame: VillagePropFrame): Grid {
  const box = footprintBox(frame);
  const ts = frame.tileScale;
  return {
    ts,
    ink: Math.max(1, ts * OUTLINE_TILES),
    x: (tiles) => box.left + tiles * ts,
    y: (upTiles) => box.bottom - upTiles * ts,
    s: (tiles) => tiles * ts,
  };
}

type OutdoorPainter = (ctx: Ctx, g: Grid, variant: number, rng: Rng) => void;

/** Wraps a tile-space painter so every prop restores the context even if it throws. */
function painter(paint: OutdoorPainter): VillagePropPainter {
  return (ctx, frame, variant, rng) => {
    ctx.save();
    try {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      paint(ctx, gridOf(frame), variant, rng);
    } finally {
      ctx.restore();
    }
  };
}

// ── Primitives ────────────────────────────────────────────────────────────────

type Point = readonly [number, number];

interface Tone {
  readonly lit: string;
  readonly body: string;
  readonly shade: string;
}

const WOOD_TONE: Tone = { lit: WOOD.light, body: WOOD.body, shade: WOOD.dark };
const DARK_WOOD_TONE: Tone = { lit: WOOD.mid, body: WOOD.dark, shade: WOOD.deep };
const BARK_TONE: Tone = { lit: LOG.barkLight, body: LOG.bark, shade: LOG.barkDark };
const IRON_TONE: Tone = { lit: IRON.light, body: IRON.body, shade: IRON.dark };
const BRASS_TONE: Tone = { lit: BRASS.light, body: BRASS.body, shade: BRASS.dark };
const STRAW_TONE: Tone = { lit: STRAW.light, body: STRAW.body, shade: STRAW.dark };
const BURLAP_TONE: Tone = { lit: BURLAP.light, body: BURLAP.body, shade: BURLAP.dark };

function polygon(ctx: Ctx, points: ReadonlyArray<Point>): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function outline(ctx: Ctx, g: Grid, width = g.ink): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Fills the path already traced on the context, then inks it. */
function fillInked(ctx: Ctx, g: Grid, color: string | CanvasGradient): void {
  ctx.fillStyle = color;
  ctx.fill();
  outline(ctx, g);
}

function ellipseT(ctx: Ctx, g: Grid, cx: number, up: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(g.x(cx), g.y(up), Math.max(1, g.s(rx)), Math.max(1, g.s(ry)), 0, 0, TWO_PI);
}

/** A tile-space rectangle traced as a path: `u0` is its bottom, `u1` its top. */
function rectT(ctx: Ctx, g: Grid, x0: number, u0: number, x1: number, u1: number): void {
  ctx.beginPath();
  ctx.rect(g.x(x0), g.y(u1), g.s(x1 - x0), g.s(u1 - u0));
}

/** A left-lit horizontal gradient across `x0..x1` (tiles), for round bodies. */
function roundShade(ctx: Ctx, g: Grid, x0: number, x1: number, tone: Tone): CanvasGradient {
  const gradient = ctx.createLinearGradient(g.x(x0), 0, g.x(x1), 0);
  gradient.addColorStop(0, tone.body);
  gradient.addColorStop(ROUND_LIT_STOP, tone.lit);
  gradient.addColorStop(ROUND_BODY_STOP, tone.body);
  gradient.addColorStop(1, tone.shade);
  return gradient;
}
const ROUND_LIT_STOP = 0.28;
const ROUND_BODY_STOP = 0.6;

/**
 * A straight timber from one point to another, `width` tiles across, with its
 * lit strip on whichever side faces the upper-left light. Posts, beams, braces,
 * shafts and handles are all this one shape.
 */
function strut(
  ctx: Ctx,
  g: Grid,
  x0: number,
  u0: number,
  x1: number,
  u1: number,
  width: number,
  tone: Tone = WOOD_TONE,
): void {
  const ax = g.x(x0);
  const ay = g.y(u0);
  const bx = g.x(x1);
  const by = g.y(u1);
  const length = Math.hypot(bx - ax, by - ay);
  if (length < DEGENERATE_LENGTH_PX) return;
  let nx = -(by - ay) / length;
  let ny = (bx - ax) / length;
  const normalFacesAwayFromLight = nx + ny > 0;
  if (normalFacesAwayFromLight) {
    nx = -nx;
    ny = -ny;
  }
  const half = g.s(width) / 2;
  const band = (from: number, to: number): Point[] => [
    [ax + nx * half * from, ay + ny * half * from],
    [bx + nx * half * from, by + ny * half * from],
    [bx + nx * half * to, by + ny * half * to],
    [ax + nx * half * to, ay + ny * half * to],
  ];
  polygon(ctx, band(1, -1));
  ctx.fillStyle = tone.body;
  ctx.fill();
  polygon(ctx, band(1, 1 - 2 * TIMBER_LIT_SHARE));
  ctx.fillStyle = tone.lit;
  ctx.fill();
  polygon(ctx, band(-1 + 2 * TIMBER_SHADE_SHARE, -1));
  ctx.fillStyle = tone.shade;
  ctx.fill();
  polygon(ctx, band(1, -1));
  outline(ctx, g);
}

/** The pale cut end on top of a round log post — the village's silhouette cue. */
function logCap(ctx: Ctx, g: Grid, cx: number, up: number, width: number): void {
  const rx = g.s(width / 2);
  const ry = rx * LOG_CAP_SQUASH * 2;
  drawLogEnd(ctx, g.x(cx), g.y(up), rx, ry);
  ctx.beginPath();
  ctx.ellipse(g.x(cx), g.y(up), rx, ry, 0, 0, TWO_PI);
  outline(ctx, g);
}

/** A log's cut end facing the viewer square-on, as a joist or a stacked log shows it. */
function logEndFacing(ctx: Ctx, g: Grid, cx: number, up: number, radius: number): void {
  drawLogEnd(ctx, g.x(cx), g.y(up), g.s(radius), g.s(radius));
  ellipseT(ctx, g, cx, up, radius, radius);
  outline(ctx, g);
}

/** A round barked post standing from `u0` to `u1`, capped with its cut end. */
function logPost(ctx: Ctx, g: Grid, cx: number, u0: number, u1: number, width: number): void {
  strut(ctx, g, cx, u0, cx, u1, width, BARK_TONE);
  logCap(ctx, g, cx, u1, width);
}

/** A thick rope or cord along a list of tile points, dark-edged so it reads over anything. */
function cord(
  ctx: Ctx,
  g: Grid,
  points: ReadonlyArray<Point>,
  width: number,
  color: string = ROPE.body,
): void {
  const trace = (): void => {
    ctx.beginPath();
    points.forEach(([px, pu], index) => {
      if (index === 0) ctx.moveTo(g.x(px), g.y(pu));
      else ctx.lineTo(g.x(px), g.y(pu));
    });
  };
  trace();
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.s(width) + g.ink * 2;
  ctx.stroke();
  trace();
  ctx.strokeStyle = color;
  ctx.lineWidth = g.s(width);
  ctx.stroke();
}
const ROPE = { body: '#b09a6a', dark: '#6e5a3a' } as const;
const ROPE_TONE: Tone = { lit: ROPE.body, body: ROPE.body, shade: ROPE.dark };

/** A contact shadow, in tiles. */
function shadow(ctx: Ctx, g: Grid, cx: number, up: number, rx: number, ry: number): void {
  drawContactShadow(ctx, g.x(cx), g.y(up), g.s(rx), g.s(ry));
}

/**
 * A 3/4-view box: its front face from `front` up `height`, its top face the
 * `depth` of ground behind that raised by `height`. Returns the two faces in
 * pixels so a caller can dress them.
 */
interface BoxSpec {
  readonly x0: number;
  readonly x1: number;
  readonly front: number;
  readonly depth: number;
  readonly height: number;
}
interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
function boxFaces(g: Grid, box: BoxSpec): { top: PxRect; front: PxRect } {
  const x = g.x(box.x0);
  const w = g.s(box.x1 - box.x0);
  return {
    top: { x, y: g.y(box.front + box.depth + box.height), w, h: g.s(box.depth) },
    front: { x, y: g.y(box.front + box.height), w, h: g.s(box.height) },
  };
}

/** A planked box: boards run along the front and across the top, one outline round both. */
function plankBox(
  ctx: Ctx,
  g: Grid,
  box: BoxSpec,
  rng: Rng,
  boardTiles: number,
  topBase: string = WOOD.mid,
  frontBase: string = WOOD.body,
): { top: PxRect; front: PxRect } {
  const faces = boxFaces(g, box);
  const board = g.s(boardTiles);
  drawPlanks(ctx, faces.front.x, faces.front.y, faces.front.w, faces.front.h, rng, {
    direction: 'horizontal',
    boardPx: board,
    base: frontBase,
  });
  drawPlanks(ctx, faces.top.x, faces.top.y, faces.top.w, faces.top.h, rng, {
    direction: 'horizontal',
    boardPx: board,
    base: topBase,
    nailChance: 0,
  });
  inkBox(ctx, g, faces);
  return faces;
}

function inkBox(ctx: Ctx, g: Grid, faces: { top: PxRect; front: PxRect }): void {
  ctx.beginPath();
  ctx.rect(faces.top.x, faces.top.y, faces.top.w, faces.top.h + faces.front.h);
  outline(ctx, g);
  ctx.beginPath();
  ctx.moveTo(faces.front.x, faces.front.y);
  ctx.lineTo(faces.front.x + faces.front.w, faces.front.y);
  outline(ctx, g, g.ink * EDGE_LINE_SHARE);
}
/** The fold between a box's top and front is a softer line than its silhouette. */
const EDGE_LINE_SHARE = 0.7;

/**
 * An upright cylinder: `baseUp` is the centre of its footprint on the ground,
 * `rx`/`ry` its ground ellipse, `height` how tall it stands. Returns the top
 * ellipse's centre so the caller can dress the top.
 */
function cylinder(
  ctx: Ctx,
  g: Grid,
  cx: number,
  baseUp: number,
  rx: number,
  ry: number,
  height: number,
  side: Tone,
  top: string,
): number {
  const topUp = baseUp + height;
  ctx.beginPath();
  ctx.moveTo(g.x(cx - rx), g.y(topUp));
  ctx.lineTo(g.x(cx - rx), g.y(baseUp));
  ctx.ellipse(g.x(cx), g.y(baseUp), g.s(rx), g.s(ry), 0, Math.PI, 0, true);
  ctx.lineTo(g.x(cx + rx), g.y(topUp));
  ctx.closePath();
  fillInked(ctx, g, roundShade(ctx, g, cx - rx, cx + rx, side));
  ellipseT(ctx, g, cx, topUp, rx, ry);
  fillInked(ctx, g, top);
  return topUp;
}

/** A front-facing arc of a hoop or band around a cylinder at `up`. */
function band(
  ctx: Ctx,
  g: Grid,
  cx: number,
  up: number,
  rx: number,
  ry: number,
  width: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.ellipse(g.x(cx), g.y(up), g.s(rx), g.s(ry), 0, 0, Math.PI);
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.s(width) + g.ink;
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = g.s(width);
  ctx.stroke();
  ctx.lineCap = 'round';
}

/** A soft highlight or sheen, in tiles. */
function sheen(
  ctx: Ctx,
  g: Grid,
  cx: number,
  up: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  fillSoftEllipse(ctx, g.x(cx), g.y(up), g.s(rx), g.s(ry), color, alpha);
}

/**
 * The soft highlight a rounded form catches on its upper-left shoulder, sized
 * and placed as a share of the form's own radii so every stone, cap and apple
 * is lit the same way.
 */
function litSpot(
  ctx: Ctx,
  g: Grid,
  cx: number,
  up: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  sheen(
    ctx,
    g,
    cx - rx * LIT_SPOT_OFFSET,
    up + ry * LIT_SPOT_OFFSET,
    rx * LIT_SPOT_SIZE,
    ry * LIT_SPOT_SIZE,
    color,
    alpha,
  );
}
const LIT_SPOT_OFFSET = 0.32;
const LIT_SPOT_SIZE = 0.4;

/** Short strokes of straw or chaff over a region already filled, clipped to it. */
function strawStrokes(
  ctx: Ctx,
  rect: PxRect,
  rng: Rng,
  count: number,
  strokePx: number,
  colors: ReadonlyArray<string>,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.lineWidth = Math.max(1, strokePx * STRAW_STROKE_WIDTH_SHARE);
    for (let index = 0; index < count; index++) {
      const color = colors[index % colors.length] ?? STRAW.body;
      const sx = rect.x + rng() * rect.w;
      const sy = rect.y + rng() * rect.h;
      const angle = jitter(rng, STRAW_STROKE_TILT);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * strokePx, sy + Math.sin(angle) * strokePx);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
const STRAW_STROKE_WIDTH_SHARE = 0.22;
const STRAW_STROKE_TILT = 0.5;

/** A brass lantern hung from a hook, outlined so its glass reads on dark wood. */
function lanternAt(ctx: Ctx, g: Grid, hookX: number, hookUp: number, size: number): void {
  const px = g.s(size);
  const w = px * LANTERN_WIDTH_SHARE;
  ctx.beginPath();
  ctx.roundRect(
    g.x(hookX) - w / 2 - g.ink / 2,
    g.y(hookUp) + px * LANTERN_CAP_OFFSET_SHARE - g.ink / 2,
    w + g.ink,
    px * LANTERN_BODY_SHARE + g.ink,
    w * LANTERN_ROUNDING_SHARE,
  );
  ctx.fillStyle = INK;
  ctx.fill();
  drawLantern(ctx, g.x(hookX), g.y(hookUp), px);
}
/** `drawLantern`'s own proportions, so the ink behind it matches the body it draws. */
const LANTERN_WIDTH_SHARE = 0.62;
const LANTERN_CAP_OFFSET_SHARE = 0.12;
const LANTERN_BODY_SHARE = 0.91;
const LANTERN_ROUNDING_SHARE = 0.2;
/** Where the glass centre sits below the hook, as a fraction of the lantern's size. */
const LANTERN_GLASS_CENTRE_SHARE = 0.595;

/** A fieldstone's face tone: mostly mid grey-green, some dark, a few pale. */
function pickStoneFace(rng: Rng): string {
  const tone = rng();
  if (tone < STONE_DARK_SHARE) return STONE.dark;
  if (tone < STONE_DARK_SHARE + STONE_MID_SHARE) return STONE.body;
  return STONE.light;
}
const STONE_DARK_SHARE = 0.3;
const STONE_MID_SHARE = 0.48;

/** A tuft of moss, in tiles. */
function mossTuft(ctx: Ctx, g: Grid, cx: number, up: number, rx: number, ry: number): void {
  ellipseT(ctx, g, cx, up, rx, ry);
  ctx.fillStyle = MOSS.body;
  ctx.fill();
  ellipseT(
    ctx,
    g,
    cx - rx * MOSS_LIT_OFFSET,
    up + ry * MOSS_LIT_OFFSET,
    rx * MOSS_LIT_SIZE,
    ry * MOSS_LIT_SIZE,
  );
  ctx.fillStyle = MOSS.light;
  ctx.fill();
}
const MOSS_LIT_OFFSET = 0.3;
const MOSS_LIT_SIZE = 0.52;

// ── Bell tower ────────────────────────────────────────────────────────────────

/**
 * The square's landmark: a fieldstone plinth, a plank-clad lower stage with a
 * little round-topped door, an open braced middle stage, the belfry and a
 * shingled pyramid roof crowned by the brass briar knot. The belfry is painted
 * **empty** — the bell hangs from the headstock at `BELL_PIVOT` and is drawn
 * live so it can swing and ring.
 */
const BELL_TOWER = {
  centre: 1,
  shadowRx: 0.92,
  shadowRy: 0.86,
  plinth: { x0: 0.08, x1: 1.92, front: 0.1, depth: 1.78, height: 0.3 },
  flagstone: 0.28,
  /** Screen height where the front legs stand on the plinth. */
  legFoot: 0.62,
  legFootHalfWidth: 0.74,
  lowerStageTop: 1.86,
  stagePlank: 0.13,
  wattleBand: 0.2,
  /** The belfry floor; the stages below taper in to this width. */
  belfryFloor: 2.56,
  belfryHalfWidth: 0.55,
  legWidth: 0.15,
  backLegWidth: 0.1,
  backLegInset: 0.21,
  braceWidth: 0.09,
  floorBeam: 0.13,
  joistEnd: 0.075,
  joistSpread: 0.2,
  headstock: 0.12,
  hangerHalfWidth: 0.035,
  hangerDrop: 0.05,
  eave: 3.64,
  roofEaveHalfWidth: 0.88,
  roofEaveDrop: 0.16,
  roofApex: 4.5,
  /** How far the roof's front hip dips below the eave line: the corner nearest the viewer. */
  roofFrontHip: -0.06,
  shingleRow: 0.13,
  shingleJitter: 0.01,
  finialSink: 0.05,
  finialTop: 4.56,
  finialWidth: 0.06,
  knotUp: 4.7,
  knotRadius: 0.16,
  knotLine: 0.045,
  pennant: { up: 4.53, tip: 1.44, depth: 0.1, notchBack: 0.08 },
  door: {
    halfWidth: 0.19,
    height: 0.66,
    board: 0.12,
    strap: 0.045,
    strapUps: [0.2, 0.44],
    knobInset: 0.07,
    knobRadius: 0.03,
  },
  lantern: { bracketUp: 1.72, hookX: 0.2, size: 0.34, bracketWidth: 0.04 },
  rope: {
    x: 1.36,
    end: 1.02,
    width: 0.025,
    sway: 0.02,
    tuftTopHalf: 0.035,
    tuftBottomHalf: 0.05,
    tuftLength: 0.1,
    cleatUp: 1.1,
    cleatHalfLength: 0.07,
    cleatWidth: 0.05,
  },
  plinthMoss: [
    [0.24, 2.1, 0.12, 0.04],
    [1.66, 2.12, 0.1, 0.035],
    [0.3, 0.42, 0.09, 0.03],
    [1.78, 0.4, 0.08, 0.03],
    [0.16, 1.2, 0.06, 0.03],
  ],
  roofMoss: [
    [0.66, 3.82, 0.07, 0.03],
    [1.32, 3.96, 0.06, 0.025],
  ],
} as const;

/** Where on a door the strap hinges reach across it, as a share of its half width. */
const DOOR_STRAP_REACH = 1.5;
/** The lit top edge of a brass strap, as a share of its width. */
const STRAP_GLINT_SHARE = 1 / 3;
/** How high up a door its knob sits, as a share of the door's height. */
const DOOR_KNOB_HEIGHT_SHARE = 0.42;
/** The door's surround is thicker ink than a silhouette: it is a recess, not an edge. */
const DOOR_OUTLINE_SHARE = 1.4;
/** Where across a shingle course its lap line falls, and how far each shingle's joint runs down. */
const SHINGLE_LAP_SHARE = 0.3;
const SHINGLE_JOINT_SHARE = 0.6;
const SHINGLE_LINE_SHARE = 0.6;
const SHINGLES_PER_COURSE = 9;
/** A pennant's trailing corner falls a little below its tip, so it reads as cloth in the wind. */
const PENNANT_TIP_DROP_SHARE = 0.2;

/** The tower's half width at a screen height between the leg foot and the belfry floor. */
function towerHalfWidth(up: number): number {
  const t = BELL_TOWER;
  const along = (up - t.legFoot) / (t.belfryFloor - t.legFoot);
  const clamped = Math.min(1, Math.max(0, along));
  return t.legFootHalfWidth + (t.belfryHalfWidth - t.legFootHalfWidth) * clamped;
}

function paintBellTower(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const t = BELL_TOWER;
  const c = t.centre;
  shadow(ctx, g, c, t.plinth.front + t.plinth.depth / 2, t.shadowRx, t.shadowRy);

  const plinth = boxFaces(g, t.plinth);
  ctx.fillStyle = STONE.body;
  ctx.fillRect(plinth.top.x, plinth.top.y, plinth.top.w, plinth.top.h);
  paintFlagstones(ctx, plinth.top, g.s(t.flagstone), forkRng(rng));
  drawFieldstones(
    ctx,
    plinth.front.x,
    plinth.front.y,
    plinth.front.w,
    plinth.front.h,
    forkRng(rng),
    g.s(t.plinth.height / 2),
  );
  inkBox(ctx, g, plinth);
  for (const [mx, mu, rx, ry] of t.plinthMoss) mossTuft(ctx, g, mx, mu, rx, ry);

  const legLeftFoot = c - t.legFootHalfWidth;
  const legRightFoot = c + t.legFootHalfWidth;
  const legLeftTop = c - t.belfryHalfWidth;
  const legRightTop = c + t.belfryHalfWidth;
  const stageHalfWidth = towerHalfWidth(t.lowerStageTop);
  const midLeft = c - stageHalfWidth;
  const midRight = c + stageHalfWidth;

  // Above the plank-clad stage the tower is open, so its dark inside shows through.
  polygon(ctx, [
    [g.x(midLeft), g.y(t.lowerStageTop)],
    [g.x(legLeftTop), g.y(t.eave)],
    [g.x(legRightTop), g.y(t.eave)],
    [g.x(midRight), g.y(t.lowerStageTop)],
  ]);
  const hollow = ctx.createLinearGradient(0, g.y(t.eave), 0, g.y(t.lowerStageTop));
  hollow.addColorStop(0, HOLLOW_SHADE);
  hollow.addColorStop(1, WOOD.deep);
  ctx.fillStyle = hollow;
  ctx.fill();
  for (const side of [-1, 1]) {
    const backLegX = c + side * (t.belfryHalfWidth - t.backLegInset);
    strut(ctx, g, backLegX, t.lowerStageTop, backLegX, t.eave, t.backLegWidth, DARK_WOOD_TONE);
  }

  const stagePoints: Point[] = [
    [g.x(legLeftFoot), g.y(t.legFoot)],
    [g.x(midLeft), g.y(t.lowerStageTop)],
    [g.x(midRight), g.y(t.lowerStageTop)],
    [g.x(legRightFoot), g.y(t.legFoot)],
  ];
  const stageWidthPx = g.s(t.legFootHalfWidth * 2);
  withClip(
    ctx,
    () => polygon(ctx, stagePoints),
    () => {
      drawPlanks(
        ctx,
        g.x(legLeftFoot),
        g.y(t.lowerStageTop),
        stageWidthPx,
        g.s(t.lowerStageTop - t.legFoot),
        forkRng(rng),
        { direction: 'horizontal', boardPx: g.s(t.stagePlank), base: WOOD.body },
      );
      drawWattle(
        ctx,
        g.x(legLeftFoot),
        g.y(t.lowerStageTop),
        stageWidthPx,
        g.s(t.wattleBand),
        forkRng(rng),
      );
      ctx.fillStyle = INK;
      ctx.fillRect(g.x(legLeftFoot), g.y(t.lowerStageTop - t.wattleBand), stageWidthPx, g.ink);
    },
  );
  polygon(ctx, stagePoints);
  outline(ctx, g);

  paintTowerDoor(ctx, g, rng);

  strut(ctx, g, midLeft, t.lowerStageTop, legRightTop, t.belfryFloor, t.braceWidth);
  strut(ctx, g, midRight, t.lowerStageTop, legLeftTop, t.belfryFloor, t.braceWidth);
  strut(ctx, g, midLeft, t.lowerStageTop, midRight, t.lowerStageTop, t.floorBeam);

  strut(ctx, g, legLeftFoot, t.legFoot, legLeftTop, t.belfryFloor, t.legWidth, BARK_TONE);
  strut(ctx, g, legRightFoot, t.legFoot, legRightTop, t.belfryFloor, t.legWidth, BARK_TONE);
  strut(ctx, g, legLeftTop, t.belfryFloor, legLeftTop, t.eave, t.legWidth, BARK_TONE);
  strut(ctx, g, legRightTop, t.belfryFloor, legRightTop, t.eave, t.legWidth, BARK_TONE);

  const beamLeft = legLeftTop - t.legWidth / 2;
  const beamRight = legRightTop + t.legWidth / 2;
  strut(ctx, g, beamLeft, t.belfryFloor, beamRight, t.belfryFloor, t.floorBeam);
  // The bell hangs from the headstock's underside, so its bottom edge is the pivot.
  const headstockCentre = BELL_PIVOT.up + t.headstock / 2;
  strut(ctx, g, beamLeft, headstockCentre, beamRight, headstockCentre, t.headstock);
  ctx.fillStyle = IRON.dark;
  ctx.fillRect(
    g.x(BELL_PIVOT.x - t.hangerHalfWidth),
    g.y(BELL_PIVOT.up),
    g.s(t.hangerHalfWidth * 2),
    g.s(t.hangerDrop),
  );

  // The belfry's joists run front to back, so their round cut ends face the
  // viewer along the floor beam: the log-end cue every building here shares.
  for (const joistX of [beamLeft, c - t.joistSpread, c + t.joistSpread, beamRight]) {
    logEndFacing(ctx, g, joistX, t.belfryFloor, t.joistEnd);
  }

  paintTowerRoof(ctx, g, forkRng(rng));

  const rope = t.rope;
  const ropeTop = t.belfryFloor - t.floorBeam / 2;
  cord(
    ctx,
    g,
    [
      [rope.x, ropeTop],
      [rope.x + rope.sway, (ropeTop + rope.end) / 2],
      [rope.x, rope.end],
    ],
    rope.width,
    ROPE.dark,
  );
  polygon(ctx, [
    [g.x(rope.x - rope.tuftTopHalf), g.y(rope.end)],
    [g.x(rope.x + rope.tuftTopHalf), g.y(rope.end)],
    [g.x(rope.x + rope.tuftBottomHalf), g.y(rope.end - rope.tuftLength)],
    [g.x(rope.x - rope.tuftBottomHalf), g.y(rope.end - rope.tuftLength)],
  ]);
  fillInked(ctx, g, ROPE.dark);
  strut(
    ctx,
    g,
    rope.x - rope.cleatHalfLength,
    rope.cleatUp,
    rope.x + rope.cleatHalfLength,
    rope.cleatUp,
    rope.cleatWidth,
    BRASS_TONE,
  );

  const lantern = t.lantern;
  const bracketX = c - towerHalfWidth(lantern.bracketUp);
  strut(
    ctx,
    g,
    bracketX,
    lantern.bracketUp,
    lantern.hookX,
    lantern.bracketUp,
    lantern.bracketWidth,
    IRON_TONE,
  );
  lanternAt(ctx, g, lantern.hookX, lantern.bracketUp, lantern.size);
}

function paintTowerDoor(ctx: Ctx, g: Grid, rng: Rng): void {
  const t = BELL_TOWER;
  const door = t.door;
  const left = t.centre - door.halfWidth;
  const right = t.centre + door.halfWidth;
  const top = t.legFoot + door.height;
  const archCentre = top - door.halfWidth;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(left), g.y(t.legFoot));
    ctx.lineTo(g.x(left), g.y(archCentre));
    ctx.arc(g.x(t.centre), g.y(archCentre), g.s(door.halfWidth), Math.PI, 0);
    ctx.lineTo(g.x(right), g.y(t.legFoot));
    ctx.closePath();
  };
  withClip(ctx, trace, () => {
    drawPlanks(ctx, g.x(left), g.y(top), g.s(door.halfWidth * 2), g.s(door.height), rng, {
      direction: 'vertical',
      boardPx: g.s(door.board),
      base: WOOD.dark,
      nailChance: 0,
    });
    const strapLength = g.s(door.halfWidth * DOOR_STRAP_REACH);
    for (const strapUp of door.strapUps) {
      ctx.fillStyle = BRASS.dark;
      ctx.fillRect(g.x(left), g.y(t.legFoot + strapUp), strapLength, g.s(door.strap));
      ctx.fillStyle = BRASS.light;
      ctx.fillRect(
        g.x(left),
        g.y(t.legFoot + strapUp),
        strapLength,
        g.s(door.strap) * STRAP_GLINT_SHARE,
      );
    }
  });
  trace();
  outline(ctx, g, g.ink * DOOR_OUTLINE_SHARE);
  ellipseT(
    ctx,
    g,
    right - door.knobInset,
    t.legFoot + door.height * DOOR_KNOB_HEIGHT_SHARE,
    door.knobRadius,
    door.knobRadius,
  );
  fillInked(ctx, g, BRASS.light);
}

function paintTowerRoof(ctx: Ctx, g: Grid, rng: Rng): void {
  const t = BELL_TOWER;
  const c = t.centre;
  const half = t.roofEaveHalfWidth;
  const eaveLow = t.eave - t.roofEaveDrop;
  const roofHeight = t.roofApex - eaveLow;
  const roof: Point[] = [
    [g.x(c - half), g.y(eaveLow)],
    [g.x(c), g.y(t.roofApex)],
    [g.x(c + half), g.y(eaveLow)],
    [g.x(c), g.y(eaveLow + t.roofFrontHip)],
  ];
  withClip(
    ctx,
    () => polygon(ctx, roof),
    () => {
      ctx.fillStyle = WOOD.mid;
      ctx.fillRect(g.x(c - half), g.y(t.roofApex), g.s(half), g.s(roofHeight));
      ctx.fillStyle = WOOD.dark;
      ctx.fillRect(g.x(c), g.y(t.roofApex), g.s(half), g.s(roofHeight));
      ctx.strokeStyle = WOOD.deep;
      ctx.lineWidth = g.ink * SHINGLE_LINE_SHARE;
      const courses = Math.round(roofHeight / t.shingleRow);
      for (let course = 0; course < courses; course++) {
        const lapUp = eaveLow + course * t.shingleRow + t.shingleRow * SHINGLE_LAP_SHARE;
        ctx.beginPath();
        ctx.moveTo(g.x(c - half), g.y(lapUp));
        ctx.lineTo(g.x(c), g.y(lapUp + t.roofFrontHip));
        ctx.lineTo(g.x(c + half), g.y(lapUp));
        ctx.stroke();
        const stagger = course % 2 === 0 ? 0 : 1 / 2;
        for (let index = 0; index <= SHINGLES_PER_COURSE; index++) {
          const along = (index + stagger) / SHINGLES_PER_COURSE;
          const jointX = c - half + along * half * 2;
          const hip = t.roofFrontHip * (1 - Math.abs(jointX - c) / half);
          ctx.beginPath();
          ctx.moveTo(g.x(jointX), g.y(lapUp + hip));
          ctx.lineTo(
            g.x(jointX + jitter(rng, t.shingleJitter)),
            g.y(lapUp + hip - t.shingleRow * SHINGLE_JOINT_SHARE),
          );
          ctx.stroke();
        }
      }
      ctx.strokeStyle = WOOD.highlight;
      ctx.lineWidth = g.ink;
      ctx.beginPath();
      ctx.moveTo(g.x(c), g.y(t.roofApex));
      ctx.lineTo(g.x(c), g.y(eaveLow + t.roofFrontHip));
      ctx.stroke();
      for (const [mx, mu, rx, ry] of t.roofMoss) mossTuft(ctx, g, mx, mu, rx, ry);
    },
  );
  polygon(ctx, roof);
  outline(ctx, g);

  strut(
    ctx,
    g,
    c,
    t.roofApex - t.finialSink,
    c,
    t.finialTop + t.knotRadius,
    t.finialWidth,
    BRASS_TONE,
  );
  const pennant = t.pennant;
  const poleEdge = c + t.finialWidth / 2;
  polygon(ctx, [
    [g.x(poleEdge), g.y(pennant.up + pennant.depth / 2)],
    [g.x(pennant.tip), g.y(pennant.up - pennant.depth * PENNANT_TIP_DROP_SHARE)],
    [g.x(pennant.tip - pennant.notchBack), g.y(pennant.up - pennant.depth / 2)],
    [g.x(poleEdge), g.y(pennant.up - pennant.depth / 2)],
  ]);
  fillInked(ctx, g, CLOTH.madder.body);
  const knotX = g.x(c);
  const knotY = g.y(t.knotUp);
  drawBriarKnot(ctx, knotX, knotY, g.s(t.knotRadius), INK, g.s(t.knotLine) + g.ink * 2);
  drawBriarKnot(ctx, knotX, knotY, g.s(t.knotRadius), BRASS.light, g.s(t.knotLine));
}

/** Flat paving over a top face: irregular flags with dark joints. */
function paintFlagstones(ctx: Ctx, rect: PxRect, flagPx: number, rng: Rng): void {
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
    },
    () => {
      const rows = Math.max(1, Math.round(rect.h / flagPx));
      const rowH = rect.h / rows;
      for (let row = 0; row < rows; row++) {
        const stagger = row % 2 === 0 ? 0 : flagPx / 2;
        let cursor = rect.x - stagger;
        while (cursor < rect.x + rect.w) {
          const w = flagPx * range(rng, FLAG_MIN_SHARE, FLAG_MAX_SHARE);
          ctx.fillStyle = pickStoneFace(rng);
          ctx.fillRect(
            cursor + FLAG_JOINT_PX,
            rect.y + row * rowH + FLAG_JOINT_PX,
            w - FLAG_JOINT_PX * 2,
            rowH - FLAG_JOINT_PX * 2,
          );
          cursor += w;
        }
      }
    },
  );
}
const FLAG_MIN_SHARE = 0.8;
const FLAG_MAX_SHARE = 1.4;
/** Half a joint's width: a one-pixel gap either side of each flag. */
const FLAG_JOINT_PX = 1;

// ── Well ──────────────────────────────────────────────────────────────────────

/**
 * A fieldstone ring with a windlass between two posts. Variant 0 carries a
 * little plank roof, its bucket resting on the rim; variant 1 is open, its
 * bucket hanging from the windlass, a second bucket at its foot. Both have a
 * coil of rope against the ring's base.
 */
const WELL = {
  centre: 0.5,
  ground: 0.54,
  rx: 0.34,
  ry: 0.22,
  height: 0.3,
  shadowRx: 0.42,
  shadowRy: 0.28,
  stoneCourse: 0.12,
  mossChance: 0.35,
  rimInset: 0.07,
  waterDrop: 0.04,
  waterGlint: { dx: -0.06, du: -0.03, rx: 0.08, ry: 0.025 },
  postX: [0.19, 0.81],
  postWidth: 0.08,
  postSink: 0.02,
  postTop: 1.44,
  windlassUp: 1.22,
  windlassRadius: 0.055,
  ropeTurns: 5,
  ropeWrapHalf: 0.12,
  ropeTurnWidth: 0.035,
  ropeTurnLean: 0.015,
  crankGap: 0.03,
  crankArmTo: 1.08,
  crankArmWidth: 0.045,
  crankGripX: 0.92,
  crankGripWidth: 0.05,
  roof: {
    eave: 1.4,
    ridge: 1.8,
    halfWidth: 0.44,
    rake: 0.06,
    board: 0.1,
    ridgeBeam: 0.06,
    ridgeInset: 0.04,
    moss: [0.32, 1.72, 0.07, 0.03],
  },
  hangRopeWidth: 0.03,
  rimBucketX: 0.7,
  rimBucketSink: 0.02,
  hangingBucketUp: 0.9,
  footBucketX: 0.8,
  footBucketGround: 0.22,
  coilX: 0.2,
  coilGround: 0.22,
} as const;

/** The well ring's east flank falls into shade; its west catches only a little light. */
const RING_SHADE = {
  lit: 'rgba(0,0,0,0.05)',
  mid: 'rgba(0,0,0,0)',
  shade: 'rgba(0,0,0,0.45)',
} as const;
/** How much the ring's inner lip is foreshortened compared with its width inset. */
const RIM_INSET_SQUASH = 0.7;
/** The water far down the shaft shows as a narrower, flatter ellipse. */
const SHAFT_WATER_SQUASH = 0.6;

function paintWell(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  const w = WELL;
  shadow(ctx, g, w.centre, w.ground, w.shadowRx, w.shadowRy);
  const topUp = w.ground + w.height;
  const traceRing = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(w.centre - w.rx), g.y(topUp));
    ctx.lineTo(g.x(w.centre - w.rx), g.y(w.ground));
    ctx.ellipse(g.x(w.centre), g.y(w.ground), g.s(w.rx), g.s(w.ry), 0, Math.PI, 0, true);
    ctx.lineTo(g.x(w.centre + w.rx), g.y(topUp));
  };
  withClip(ctx, traceRing, () => {
    drawFieldstones(
      ctx,
      g.x(w.centre - w.rx),
      g.y(topUp),
      g.s(w.rx * 2),
      g.s(w.height + w.ry),
      forkRng(rng),
      g.s(w.stoneCourse),
      w.mossChance,
    );
    const flank = ctx.createLinearGradient(g.x(w.centre - w.rx), 0, g.x(w.centre + w.rx), 0);
    flank.addColorStop(0, RING_SHADE.lit);
    flank.addColorStop(ROUND_BODY_STOP, RING_SHADE.mid);
    flank.addColorStop(1, RING_SHADE.shade);
    ctx.fillStyle = flank;
    ctx.fillRect(g.x(w.centre - w.rx), g.y(topUp + w.ry), g.s(w.rx * 2), g.s(w.height + w.ry * 2));
  });
  traceRing();
  outline(ctx, g);

  ellipseT(ctx, g, w.centre, topUp, w.rx, w.ry);
  fillInked(ctx, g, STONE.light);
  ellipseT(ctx, g, w.centre, topUp, w.rx - w.rimInset, w.ry - w.rimInset * RIM_INSET_SQUASH);
  fillInked(ctx, g, HOLLOW_SHADE);
  ellipseT(
    ctx,
    g,
    w.centre,
    topUp - w.waterDrop,
    w.rx - w.rimInset * 2,
    (w.ry - w.rimInset) * SHAFT_WATER_SQUASH,
  );
  ctx.fillStyle = WATER.deep;
  ctx.fill();
  const glint = w.waterGlint;
  sheen(
    ctx,
    g,
    w.centre + glint.dx,
    topUp + glint.du,
    glint.rx,
    glint.ry,
    WATER.light,
    SHEEN.medium,
  );

  for (const postX of w.postX) logPost(ctx, g, postX, topUp - w.postSink, w.postTop, w.postWidth);
  const [westPost, eastPost] = w.postX;
  strut(ctx, g, westPost, w.windlassUp, eastPost, w.windlassUp, w.windlassRadius * 2);
  for (let turn = 0; turn < w.ropeTurns; turn++) {
    const along = turn / (w.ropeTurns - 1);
    const turnX = w.centre - w.ropeWrapHalf + along * w.ropeWrapHalf * 2;
    strut(
      ctx,
      g,
      turnX,
      w.windlassUp - w.windlassRadius,
      turnX + w.ropeTurnLean,
      w.windlassUp + w.windlassRadius,
      w.ropeTurnWidth,
      ROPE_TONE,
    );
  }
  const crankX = eastPost + w.postWidth / 2 + w.crankGap;
  strut(ctx, g, crankX, w.windlassUp, crankX, w.crankArmTo, w.crankArmWidth, IRON_TONE);
  strut(ctx, g, crankX, w.crankArmTo, w.crankGripX, w.crankArmTo, w.crankGripWidth, WOOD_TONE);

  if (variant === 0) {
    paintWellRoof(ctx, g, rng);
    cord(
      ctx,
      g,
      [
        [w.centre, w.windlassUp - w.windlassRadius],
        [w.centre, topUp],
      ],
      w.hangRopeWidth,
    );
    paintBucket(ctx, g, w.rimBucketX, topUp - w.rimBucketSink, BUCKET_SMALL, forkRng(rng), true);
    paintRopeCoil(ctx, g, w.coilX, w.coilGround);
    return;
  }
  paintBucket(ctx, g, w.centre, w.hangingBucketUp, BUCKET_SMALL, forkRng(rng), false);
  paintRopeCoil(ctx, g, w.coilX, w.coilGround);
  paintBucket(ctx, g, w.footBucketX, w.footBucketGround, BUCKET_SMALL, forkRng(rng), true);
}

/** A plank roof over the windlass, its slope toward the viewer. */
function paintWellRoof(ctx: Ctx, g: Grid, rng: Rng): void {
  const w = WELL;
  const roof = w.roof;
  const outline4: Point[] = [
    [g.x(w.centre - roof.halfWidth), g.y(roof.eave)],
    [g.x(w.centre - roof.halfWidth + roof.rake), g.y(roof.ridge)],
    [g.x(w.centre + roof.halfWidth - roof.rake), g.y(roof.ridge)],
    [g.x(w.centre + roof.halfWidth), g.y(roof.eave)],
  ];
  withClip(
    ctx,
    () => polygon(ctx, outline4),
    () =>
      drawPlanks(
        ctx,
        g.x(w.centre - roof.halfWidth),
        g.y(roof.ridge),
        g.s(roof.halfWidth * 2),
        g.s(roof.ridge - roof.eave),
        forkRng(rng),
        { direction: 'vertical', boardPx: g.s(roof.board), base: WOOD.body, nailChance: 0 },
      ),
  );
  polygon(ctx, outline4);
  outline(ctx, g);
  strut(
    ctx,
    g,
    w.centre - roof.halfWidth + roof.ridgeInset,
    roof.ridge,
    w.centre + roof.halfWidth - roof.ridgeInset,
    roof.ridge,
    roof.ridgeBeam,
    WOOD_TONE,
  );
  const [mossX, mossUp, mossRx, mossRy] = roof.moss;
  mossTuft(ctx, g, mossX, mossUp, mossRx, mossRy);
}

interface BucketSize {
  readonly rx: number;
  readonly ry: number;
  readonly height: number;
  /** How much wider the mouth is than the base. */
  readonly flare: number;
  readonly hoopWidth: number;
  readonly bailWidth: number;
}
const BUCKET_SMALL: BucketSize = {
  rx: 0.1,
  ry: 0.045,
  height: 0.15,
  flare: 0.02,
  hoopWidth: 0.025,
  bailWidth: 0.02,
};
const BUCKET_LARGE: BucketSize = {
  rx: 0.25,
  ry: 0.11,
  height: 0.36,
  flare: 0.04,
  hoopWidth: 0.04,
  bailWidth: 0.03,
};

/** Where the staves' joints fall across a bucket's face, as shares of its radius. */
const BUCKET_STAVES = [-0.5, 0, 0.5];
const BUCKET_STAVE_JITTER = 0.005;
/** The two brass hoops, as shares of the bucket's height. */
const BUCKET_HOOPS = [0.25, 0.75];
/** The bucket's inner mouth and its contents, as shares of the rim's radii. */
const BUCKET_MOUTH_SHARE = 0.78;
const BUCKET_CONTENT_SQUASH = 0.6;
const BUCKET_CONTENT_DROP_SHARE = 0.15;
/** The rope bail's arc: how wide and how high it stands over the mouth. */
const BUCKET_BAIL_WIDTH_SHARE = 0.95;
const BUCKET_BAIL_HEIGHT_SHARE = 0.7;
/** A bucket's shadow is a little wider than its base and offset away from the light. */
const BUCKET_SHADOW_SCALE = 1.2;
const BUCKET_SHADOW_OFFSET = 0.02;

/** A stave bucket with brass hoops and a rope bail; `full` shows water, else it is seen empty-dark. */
function paintBucket(
  ctx: Ctx,
  g: Grid,
  cx: number,
  baseUp: number,
  size: BucketSize,
  rng: Rng,
  full: boolean,
): void {
  const topUp = baseUp + size.height;
  const topRx = size.rx + size.flare;
  shadow(
    ctx,
    g,
    cx + BUCKET_SHADOW_OFFSET,
    baseUp,
    size.rx * BUCKET_SHADOW_SCALE,
    size.ry * BUCKET_SHADOW_SCALE,
  );
  ctx.beginPath();
  ctx.moveTo(g.x(cx - topRx), g.y(topUp));
  ctx.lineTo(g.x(cx - size.rx), g.y(baseUp));
  ctx.ellipse(g.x(cx), g.y(baseUp), g.s(size.rx), g.s(size.ry), 0, Math.PI, 0, true);
  ctx.lineTo(g.x(cx + topRx), g.y(topUp));
  ctx.closePath();
  fillInked(ctx, g, roundShade(ctx, g, cx - topRx, cx + topRx, WOOD_TONE));
  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  for (const stave of BUCKET_STAVES) {
    ctx.beginPath();
    ctx.moveTo(g.x(cx + stave * topRx + jitter(rng, BUCKET_STAVE_JITTER)), g.y(topUp));
    ctx.lineTo(g.x(cx + stave * size.rx), g.y(baseUp - size.ry));
    ctx.stroke();
  }
  for (const hoop of BUCKET_HOOPS) {
    const hoopRx = size.rx + size.flare * hoop;
    band(ctx, g, cx, baseUp + size.height * hoop, hoopRx, size.ry, size.hoopWidth, BRASS.body);
  }
  ellipseT(ctx, g, cx, topUp, topRx, size.ry);
  fillInked(ctx, g, WOOD.dark);
  ellipseT(
    ctx,
    g,
    cx,
    topUp - size.ry * BUCKET_CONTENT_DROP_SHARE,
    topRx * BUCKET_MOUTH_SHARE,
    size.ry * BUCKET_CONTENT_SQUASH,
  );
  ctx.fillStyle = full ? WATER.body : WOOD.deep;
  ctx.fill();
  if (full) {
    litSpot(ctx, g, cx, topUp, topRx * BUCKET_MOUTH_SHARE, size.ry, WATER.glint, SHEEN.strong);
  }
  ctx.beginPath();
  ctx.ellipse(
    g.x(cx),
    g.y(topUp),
    g.s(topRx * BUCKET_BAIL_WIDTH_SHARE),
    g.s(size.height * BUCKET_BAIL_HEIGHT_SHARE),
    0,
    Math.PI,
    0,
  );
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.s(size.bailWidth) + g.ink;
  ctx.stroke();
  ctx.strokeStyle = ROPE.body;
  ctx.lineWidth = g.s(size.bailWidth);
  ctx.stroke();
}

const ROPE_COIL = {
  rx: 0.11,
  ry: 0.055,
  lift: 0.02,
  strand: 0.035,
  /** The coil's turns, as shares of its outer radius. */
  turns: [1, 0.7, 0.42],
  tail: [
    [0.1, 0.01],
    [0.15, -0.06],
  ],
  shadowRx: 0.13,
  shadowRy: 0.07,
} as const;

/** A flat coil of rope lying on the ground, its loose end trailing east. */
function paintRopeCoil(ctx: Ctx, g: Grid, cx: number, groundUp: number): void {
  const coil = ROPE_COIL;
  shadow(ctx, g, cx, groundUp, coil.shadowRx, coil.shadowRy);
  for (const turn of coil.turns) {
    ellipseT(ctx, g, cx, groundUp + coil.lift, coil.rx * turn, coil.ry * turn);
    ctx.strokeStyle = INK;
    ctx.lineWidth = g.s(coil.strand) + g.ink;
    ctx.stroke();
    ctx.strokeStyle = ROPE.body;
    ctx.lineWidth = g.s(coil.strand);
    ctx.stroke();
  }
  cord(
    ctx,
    g,
    coil.tail.map(([dx, du]): Point => [cx + dx, groundUp + du]),
    coil.strand,
  );
}

// ── Notice board ──────────────────────────────────────────────────────────────

/**
 * Two log posts carrying a planked board under a little drip cap, pinned with
 * papers. The papers carry pictograms only — the village has no letters on
 * its walls, and a scribble of fake text reads as noise at 32 px anyway.
 */
const NOTICE_BOARD = {
  shadowUp: 0.44,
  shadowRx: 0.46,
  shadowRy: 0.14,
  postX: [0.13, 0.87],
  postWidth: 0.1,
  postFoot: 0.36,
  postTop: 1.9,
  boardX0: 0.08,
  boardX1: 0.92,
  boardBottom: 0.86,
  boardTop: 1.7,
  board: 0.14,
  cap: { x0: 0.05, x1: 0.95, front: 1.7, depth: 0.08, height: 0.06 },
  capBoard: 0.06,
} as const;

type Pictogram = 'bell' | 'paw' | 'wheat' | 'saw';

interface NoticePaper {
  readonly x: number;
  readonly up: number;
  readonly w: number;
  readonly h: number;
  readonly tilt: number;
  readonly paper: string;
  readonly picto: Pictogram;
}

const NOTICE_PAPERS: ReadonlyArray<NoticePaper> = [
  { x: 0.13, up: 1.2, w: 0.3, h: 0.38, tilt: -0.08, paper: CLOTH.linen.light, picto: 'bell' },
  { x: 0.5, up: 1.28, w: 0.34, h: 0.3, tilt: 0.06, paper: CLOTH.linen.body, picto: 'saw' },
  { x: 0.16, up: 0.92, w: 0.28, h: 0.24, tilt: 0.1, paper: CLOTH.weld.light, picto: 'wheat' },
  { x: 0.52, up: 0.93, w: 0.3, h: 0.27, tilt: -0.05, paper: CLOTH.linen.light, picto: 'paw' },
];

const PAPER = {
  tiltJitter: 0.03,
  /** The paper's drop shadow on the board, in pixels: down and to the right of the light. */
  shadowDx: 1.5,
  shadowDy: 2,
  shadowColor: 'rgba(0,0,0,0.35)',
  /** The torn bottom edge, as shares of the paper's width and height. */
  tearRightX: 0.2,
  tearRightLift: 0.06,
  tearLowX: -0.1,
  tearLeftLift: 0.05,
  pinInset: 0.035,
  pinRadius: 0.025,
  /** The pictogram's radius as a share of the paper's shorter side. */
  pictogramShare: 0.34,
  pictogramLineShare: 0.9,
} as const;

function paintNoticeBoard(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const n = NOTICE_BOARD;
  shadow(ctx, g, 1 / 2, n.shadowUp, n.shadowRx, n.shadowRy);
  for (const postX of n.postX) logPost(ctx, g, postX, n.postFoot, n.postTop, n.postWidth);
  drawPlanks(
    ctx,
    g.x(n.boardX0),
    g.y(n.boardTop),
    g.s(n.boardX1 - n.boardX0),
    g.s(n.boardTop - n.boardBottom),
    forkRng(rng),
    { direction: 'horizontal', boardPx: g.s(n.board), base: WOOD.body },
  );
  rectT(ctx, g, n.boardX0, n.boardBottom, n.boardX1, n.boardTop);
  outline(ctx, g);
  plankBox(ctx, g, n.cap, forkRng(rng), n.capBoard, WOOD.light, WOOD.dark);
  const paperRng = forkRng(rng);
  for (const paper of NOTICE_PAPERS) paintNoticePaper(ctx, g, paper, paperRng);
}

function paintNoticePaper(ctx: Ctx, g: Grid, paper: NoticePaper, rng: Rng): void {
  const p = PAPER;
  ctx.save();
  try {
    ctx.translate(g.x(paper.x + paper.w / 2), g.y(paper.up + paper.h / 2));
    ctx.rotate(paper.tilt + jitter(rng, p.tiltJitter));
    const w = g.s(paper.w);
    const h = g.s(paper.h);
    ctx.fillStyle = p.shadowColor;
    ctx.fillRect(-w / 2 + p.shadowDx, -h / 2 + p.shadowDy, w, h);
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(w * p.tearRightX, h / 2 - h * p.tearRightLift);
    ctx.lineTo(w * p.tearLowX, h / 2);
    ctx.lineTo(-w / 2, h / 2 - h * p.tearLeftLift);
    ctx.closePath();
    ctx.fillStyle = paper.paper;
    ctx.fill();
    ctx.strokeStyle = CLOTH.linen.dark;
    ctx.lineWidth = g.ink * FINE_LINE_SHARE;
    ctx.stroke();
    paintPictogram(
      ctx,
      paper.picto,
      Math.min(w, h) * p.pictogramShare,
      g.ink * p.pictogramLineShare,
    );
    ctx.fillStyle = BRASS.light;
    ctx.beginPath();
    ctx.arc(0, -h / 2 + g.s(p.pinInset), g.s(p.pinRadius), 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = g.ink * FINE_LINE_SHARE;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/**
 * The pictograms' shapes, every coordinate a share of the pictogram's radius
 * about its centre (y downward, as the canvas has it).
 */
const PICTO = {
  bell: { lipX: 0.8, lipY: 0.7, shoulderX: 0.6, crownY: -0.9, clapperY: 0.95, clapperR: 0.2 },
  paw: {
    padY: 0.35,
    padRx: 0.45,
    padRy: 0.38,
    toeR: 0.2,
    toes: [
      [-0.62, -0.25],
      [-0.22, -0.65],
      [0.22, -0.65],
      [0.62, -0.25],
    ],
  },
  wheat: { grainX: 0.28, grainRx: 0.16, grainRy: 0.28, grainTilt: 0.6, grainYs: [-0.7, -0.3, 0.1] },
  saw: {
    bladeLeft: -1,
    bladeRight: 0.6,
    backY: -0.25,
    edgeY: 0.2,
    toothY: 0.45,
    toothWidth: 0.16,
    teeth: 5,
    handleTop: -0.45,
    handleWidth: 0.4,
    handleHeight: 0.8,
  },
} as const;

/** A bold ink pictogram about the origin, `r` px in radius. */
function paintPictogram(ctx: Ctx, picto: Pictogram, r: number, line: number): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = line;
  switch (picto) {
    case 'bell': {
      const b = PICTO.bell;
      ctx.beginPath();
      ctx.moveTo(-r * b.lipX, r * b.lipY);
      ctx.quadraticCurveTo(-r * b.shoulderX, r * b.crownY, 0, r * b.crownY);
      ctx.quadraticCurveTo(r * b.shoulderX, r * b.crownY, r * b.lipX, r * b.lipY);
      ctx.closePath();
      ctx.fillStyle = CLOTH.madder.body;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(0, r * b.clapperY, r * b.clapperR, 0, TWO_PI);
      ctx.fill();
      return;
    }
    case 'paw': {
      const p = PICTO.paw;
      ctx.beginPath();
      ctx.ellipse(0, r * p.padY, r * p.padRx, r * p.padRy, 0, 0, TWO_PI);
      ctx.fill();
      for (const [toeX, toeY] of p.toes) {
        ctx.beginPath();
        ctx.arc(toeX * r, toeY * r, r * p.toeR, 0, TWO_PI);
        ctx.fill();
      }
      return;
    }
    case 'wheat': {
      const w = PICTO.wheat;
      ctx.beginPath();
      ctx.moveTo(0, r);
      ctx.lineTo(0, -r);
      ctx.stroke();
      for (const grainY of w.grainYs) {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(
            side * r * w.grainX,
            grainY * r,
            r * w.grainRx,
            r * w.grainRy,
            side * w.grainTilt,
            0,
            TWO_PI,
          );
          ctx.fill();
        }
      }
      return;
    }
    case 'saw': {
      const s = PICTO.saw;
      ctx.beginPath();
      ctx.moveTo(r * s.bladeLeft, r * s.backY);
      ctx.lineTo(r * s.bladeRight, r * s.backY);
      ctx.lineTo(r * s.bladeRight, r * s.edgeY);
      const bladeLength = s.bladeRight - s.bladeLeft;
      for (let tooth = 0; tooth <= s.teeth; tooth++) {
        const toothX = r * (s.bladeRight - (tooth / s.teeth) * bladeLength);
        ctx.lineTo(toothX + r * s.toothWidth, r * s.toothY);
        ctx.lineTo(toothX, r * s.edgeY);
      }
      ctx.closePath();
      ctx.fillStyle = IRON.light;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = WOOD.mid;
      ctx.fillRect(r * s.bladeRight, r * s.handleTop, r * s.handleWidth, r * s.handleHeight);
      ctx.strokeRect(r * s.bladeRight, r * s.handleTop, r * s.handleWidth, r * s.handleHeight);
      return;
    }
  }
}

// ── Lamp post ─────────────────────────────────────────────────────────────────

/**
 * A log post on a fieldstone footing, with an arm and a brace carrying a brass
 * lantern on a hook. The lantern's glass centre is exactly `LAMP_POST_LANTERN`,
 * where the live glow is drawn.
 */
const LAMP_POST = {
  postX: 0.27,
  postWidth: 0.12,
  foot: { x0: 0.12, x1: 0.42, front: 0.34, depth: 0.26, height: 0.18 },
  footMossChance: 0.4,
  shadowRx: 0.24,
  shadowRy: 0.12,
  postTop: 2.92,
  armUp: 2.66,
  armWidth: 0.07,
  armEnd: 0.64,
  braceFrom: 2.34,
  braceTo: 0.5,
  braceWidth: 0.05,
  lanternSize: 0.46,
  moss: [0.2, 0.06, 0.025],
} as const;

function paintLampPost(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const l = LAMP_POST;
  const foot = l.foot;
  const footCentre = foot.front + foot.depth / 2;
  shadow(ctx, g, l.postX, footCentre, l.shadowRx, l.shadowRy);
  const faces = boxFaces(g, foot);
  ctx.fillStyle = STONE.light;
  ctx.fillRect(faces.top.x, faces.top.y, faces.top.w, faces.top.h);
  drawFieldstones(
    ctx,
    faces.front.x,
    faces.front.y,
    faces.front.w,
    faces.front.h,
    forkRng(rng),
    g.s(foot.height / 2),
    l.footMossChance,
  );
  inkBox(ctx, g, faces);
  const postBase = footCentre + foot.height;
  logPost(ctx, g, l.postX, postBase, l.postTop, l.postWidth);
  strut(ctx, g, l.postX, l.armUp, l.armEnd, l.armUp, l.armWidth);
  strut(ctx, g, l.postX, l.braceFrom, l.braceTo, l.armUp - l.armWidth / 2, l.braceWidth);
  const hookUp = LAMP_POST_LANTERN.up + l.lanternSize * LANTERN_GLASS_CENTRE_SHARE;
  lanternAt(ctx, g, LAMP_POST_LANTERN.x, hookUp, l.lanternSize);
  const [mossX, mossRx, mossRy] = l.moss;
  mossTuft(ctx, g, mossX, postBase, mossRx, mossRy);
}

// ── Bench ─────────────────────────────────────────────────────────────────────

/**
 * A low slab bench on two log-round legs, open underneath so it can never be
 * mistaken for a chest. The pale oval on the seat is where ratkin haunches and
 * tails have polished the wood.
 */
const BENCH = {
  x0: 0.06,
  x1: 0.94,
  seatFront: 0.3,
  seatDepth: 0.36,
  seatHeight: 0.3,
  seatThickness: 0.09,
  seatBoard: 0.18,
  shadowRx: 0.46,
  shadowRy: 0.2,
  legX: [0.2, 0.8],
  legRadius: 0.1,
  legSquash: 0.45,
  worn: { x: 0.56, rx: 0.17, ry: 0.09 },
} as const;

/** The polished patch: a pale oval with a brighter core where the wear is deepest. */
const WORN_PATCH_ALPHA = 0.75;
const WORN_CORE_SHARE = 0.45;

function paintBench(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const b = BENCH;
  const seatMiddle = b.seatFront + b.seatDepth / 2;
  shadow(ctx, g, 1 / 2, seatMiddle, b.shadowRx, b.shadowRy);
  const legHeight = b.seatHeight - b.seatThickness;
  for (const legX of b.legX) {
    cylinder(
      ctx,
      g,
      legX,
      seatMiddle,
      b.legRadius,
      b.legRadius * b.legSquash,
      legHeight,
      BARK_TONE,
      LOG.cut,
    );
  }
  const seat = plankBox(
    ctx,
    g,
    {
      x0: b.x0,
      x1: b.x1,
      front: b.seatFront + legHeight,
      depth: b.seatDepth,
      height: b.seatThickness,
    },
    forkRng(rng),
    b.seatBoard,
    WOOD.mid,
    WOOD.dark,
  );
  const wornUp = b.seatFront + b.seatHeight + b.seatDepth / 2;
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(seat.top.x, seat.top.y, seat.top.w, seat.top.h);
    },
    () => {
      ellipseT(ctx, g, b.worn.x, wornUp, b.worn.rx, b.worn.ry);
      ctx.globalAlpha = WORN_PATCH_ALPHA;
      ctx.fillStyle = WOOD.worn;
      ctx.fill();
      ctx.globalAlpha = 1;
      litSpot(ctx, g, b.worn.x, wornUp, b.worn.rx, b.worn.ry, WOOD.highlight, SHEEN.strong);
      ellipseT(ctx, g, b.worn.x, wornUp, b.worn.rx * WORN_CORE_SHARE, b.worn.ry * WORN_CORE_SHARE);
      ctx.fillStyle = CLOTH.linen.light;
      ctx.globalAlpha = SHEEN.soft;
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  );
}

// ── Water trough ──────────────────────────────────────────────────────────────

/**
 * A long planked trough on two log sleepers, brimming with clear water. Seen
 * from above, so its rim shows on all four sides, the far inner wall is a dark
 * band under the back rim, and the water catches the sky in streaks.
 */
const TROUGH = {
  box: { x0: 0.08, x1: 1.92, front: 0.22, depth: 0.46, height: 0.32 },
  shadowRx: 0.94,
  shadowRy: 0.32,
  board: 0.11,
  rim: 0.07,
  farWall: 0.09,
  sleeperX: [0.3, 1.7],
  sleeper: { halfWidth: 0.12, overhang: 0.06, height: 0.06, board: 0.1 },
  bandX: [0.34, 1.66],
  bandHalfWidth: 0.04,
  glints: [
    [0.36, 0.26],
    [0.92, 0.14],
    [1.3, 0.3],
  ],
  glintThickness: 0.025,
  /** Where across the water, front to back, the sky's streaks lie. */
  glintDepthShare: 0.45,
  moss: [0.18, 0.3, 0.08, 0.035],
} as const;
/** The lit strip down a brass band, as a share of its width. */
const BAND_GLINT_SHARE = 0.3;
/** The streak must stay at least this many pixels thick at any scale. */
const GLINT_MIN_PX = 1.5;

function paintWaterTrough(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const t = TROUGH;
  const box = t.box;
  shadow(ctx, g, 1, box.front + box.depth / 2, t.shadowRx, t.shadowRy);
  const sleeper = t.sleeper;
  for (const sleeperX of t.sleeperX) {
    plankBox(
      ctx,
      g,
      {
        x0: sleeperX - sleeper.halfWidth,
        x1: sleeperX + sleeper.halfWidth,
        front: box.front - sleeper.overhang,
        depth: box.depth + sleeper.overhang * 2,
        height: sleeper.height,
      },
      forkRng(rng),
      sleeper.board,
      LOG.barkLight,
      LOG.bark,
    );
  }
  const faces = plankBox(ctx, g, box, forkRng(rng), t.board, WOOD.light, WOOD.body);
  const rim = g.s(t.rim);
  const inner: PxRect = {
    x: faces.top.x + rim,
    y: faces.top.y + rim,
    w: faces.top.w - rim * 2,
    h: faces.top.h - rim * 2,
  };
  ctx.fillStyle = WOOD.deep;
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  const farWall = g.s(t.farWall);
  const waterTop = inner.y + farWall;
  const water = ctx.createLinearGradient(0, waterTop, 0, inner.y + inner.h);
  water.addColorStop(0, WATER.deep);
  water.addColorStop(1, WATER.body);
  ctx.fillStyle = water;
  ctx.fillRect(inner.x, waterTop, inner.w, inner.h - farWall);
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.ink * FINE_LINE_SHARE;
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
  const glintY = waterTop + (inner.h - farWall) * t.glintDepthShare;
  ctx.fillStyle = WATER.glint;
  ctx.globalAlpha = SHEEN.medium;
  for (const [glintX, glintW] of t.glints) {
    ctx.fillRect(g.x(glintX), glintY, g.s(glintW), Math.max(GLINT_MIN_PX, g.s(t.glintThickness)));
  }
  ctx.globalAlpha = 1;
  const bandW = g.s(t.bandHalfWidth * 2);
  for (const bandX of t.bandX) {
    const left = g.x(bandX - t.bandHalfWidth);
    ctx.fillStyle = INK;
    ctx.fillRect(left - g.ink / 2, faces.front.y, bandW + g.ink, faces.front.h);
    ctx.fillStyle = BRASS.body;
    ctx.fillRect(left, faces.front.y, bandW, faces.front.h);
    ctx.fillStyle = BRASS.light;
    ctx.fillRect(left, faces.front.y, bandW * BAND_GLINT_SHARE, faces.front.h);
  }
  const [mossX, mossUp, mossRx, mossRy] = t.moss;
  mossTuft(ctx, g, mossX, mossUp, mossRx, mossRy);
}

// ── Scarecrow ─────────────────────────────────────────────────────────────────

/**
 * A pole-and-crossbar scarecrow in a patched sack smock, straw poking from its
 * cuffs and hem, a rope tail — and a ratkin's hat: a floppy felt crown with
 * two holes cut for the stuffed ears poking through.
 */
const SCARECROW = {
  poleX: 0.5,
  poleWidth: 0.08,
  poleGround: 0.4,
  poleTop: 2.24,
  shadowRx: 0.3,
  shadowRy: 0.12,
  strawHeap: { lift: 0.02, rx: 0.2, ry: 0.07, strokes: 18, stroke: 0.1, height: 0.14 },
  armUp: 1.78,
  armX0: 0.06,
  armX1: 0.94,
  armWidth: 0.07,
  cuff: { inset: 0.02, reach: 0.06, back: 0.02, drop: 0.07, spread: 0.18, width: 0.025 },
  smockBottom: 1.12,
  hem: { x0: 0.34, x1: 0.66, rise: 0.05, drop: 0.06, width: 0.024, jitter: 0.02 },
  patches: [
    { x: 0.36, up: 1.46, w: 0.12, h: 0.12, colour: CLOTH.madder.body },
    { x: 0.56, up: 1.26, w: 0.1, h: 0.11, colour: CLOTH.woad.body },
  ],
  stitch: 0.02,
  belt: { x0: 0.29, x1: 0.71, up: 1.42, sag: 0.02, width: 0.04 },
  /** The tail's cubic curve from under the smock down to a curl on the ground. */
  tail: {
    start: [0.58, 1.14],
    control1: [0.7, 0.72],
    control2: [0.9, 0.62],
    end: [0.84, 0.5],
    width: 0.03,
    tuftLength: 0.07,
  },
  headUp: 2.06,
  headRx: 0.18,
  headRy: 0.18,
  eyeSpread: 0.07,
  eyeLift: 0.02,
  eyeRadius: 0.035,
  mouth: { halfWidth: 0.08, drop: 0.08, sag: 0.03 },
  nose: { drop: 0.025, rx: 0.03, ry: 0.022 },
  brimUp: 2.2,
  brimRx: 0.27,
  brimRy: 0.06,
  crownTop: 2.46,
  crownRx: 0.15,
  crownLean: 0.02,
  bandLift: 0.04,
  bandWidth: 0.045,
  bandInset: 0.01,
  earX: [0.3, 0.7],
  earUp: 2.44,
  earR: 0.09,
  earInnerShare: 0.55,
  earInnerDrop: 0.01,
  earClipMargin: 0.02,
  holeRimDrop: 0.75,
  holeRimWidthShare: 1.05,
  holeRimRy: 0.03,
} as const;

/** The smock's outline, in tiles: shoulders, sleeves along the crossbar, a ragged hem. */
const SMOCK_OUTLINE: ReadonlyArray<Point> = [
  [0.24, 1.86],
  [0.76, 1.86],
  [0.87, 1.83],
  [0.87, 1.66],
  [0.71, 1.64],
  [0.7, 1.12],
  [0.54, 1.2],
  [0.44, 1.1],
  [0.3, 1.17],
  [0.29, 1.64],
  [0.13, 1.66],
  [0.13, 1.83],
];
const CUFF_STRAWS = 4;
const HEM_STRAWS = 6;
const TAIL_SAMPLES = 16;
const CUBIC_DEGREE = 3;
const NOSE_PINK = '#c07a78';
/** The frayed rim round each ear hole is drawn a touch heavier than a silhouette. */
const HOLE_RIM_LINE_SHARE = 1.2;

function paintScarecrow(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const s = SCARECROW;
  shadow(ctx, g, s.poleX, s.poleGround, s.shadowRx, s.shadowRy);
  const heap = s.strawHeap;
  ellipseT(ctx, g, s.poleX, s.poleGround + heap.lift, heap.rx, heap.ry);
  fillInked(ctx, g, STRAW.dark);
  strawStrokes(
    ctx,
    {
      x: g.x(s.poleX - heap.rx),
      y: g.y(s.poleGround + heap.height - heap.ry),
      w: g.s(heap.rx * 2),
      h: g.s(heap.height),
    },
    forkRng(rng),
    heap.strokes,
    g.s(heap.stroke),
    [STRAW.body, STRAW.light],
  );
  strut(ctx, g, s.poleX, s.poleGround, s.poleX, s.poleTop, s.poleWidth, BARK_TONE);
  paintScarecrowTail(ctx, g);

  strut(ctx, g, s.armX0, s.armUp, s.armX1, s.armUp, s.armWidth, BARK_TONE);
  const cuff = s.cuff;
  for (const [end, inward] of [
    [s.armX0 + cuff.inset, 1],
    [s.armX1 - cuff.inset, -1],
  ] as const) {
    for (let straw = 0; straw < CUFF_STRAWS; straw++) {
      const fan = (straw / (CUFF_STRAWS - 1) - 1 / 2) * cuff.spread;
      strut(
        ctx,
        g,
        end + inward * cuff.reach,
        s.armUp,
        end - inward * cuff.back,
        s.armUp - cuff.drop + fan,
        cuff.width,
        STRAW_TONE,
      );
    }
  }
  polygon(
    ctx,
    SMOCK_OUTLINE.map(([x, up]): Point => [g.x(x), g.y(up)]),
  );
  fillInked(ctx, g, roundShade(ctx, g, s.armX0, s.armX1, BURLAP_TONE));
  for (const patch of s.patches) {
    rectT(ctx, g, patch.x, patch.up, patch.x + patch.w, patch.up + patch.h);
    ctx.fillStyle = patch.colour;
    ctx.fill();
    ctx.setLineDash([g.s(s.stitch), g.s(s.stitch)]);
    outline(ctx, g, g.ink * FINE_LINE_SHARE);
    ctx.setLineDash([]);
  }
  const belt = s.belt;
  strut(ctx, g, belt.x0, belt.up, belt.x1, belt.up - belt.sag, belt.width, ROPE_TONE);
  const hem = s.hem;
  const hemRng = forkRng(rng);
  for (let straw = 0; straw < HEM_STRAWS; straw++) {
    const hemX = hem.x0 + (straw / (HEM_STRAWS - 1)) * (hem.x1 - hem.x0);
    strut(
      ctx,
      g,
      hemX,
      s.smockBottom + hem.rise,
      hemX + jitter(hemRng, hem.jitter),
      s.smockBottom - hem.drop,
      hem.width,
      STRAW_TONE,
    );
  }
  paintScarecrowHead(ctx, g);
}

function paintScarecrowTail(ctx: Ctx, g: Grid): void {
  const tail = SCARECROW.tail;
  const [x0, u0] = tail.start;
  const [x1, u1] = tail.control1;
  const [x2, u2] = tail.control2;
  const [x3, u3] = tail.end;
  const points: Point[] = [];
  for (let sample = 0; sample <= TAIL_SAMPLES; sample++) {
    const t = sample / TAIL_SAMPLES;
    const rest = 1 - t;
    const startWeight = rest ** CUBIC_DEGREE;
    const firstControlWeight = CUBIC_DEGREE * rest ** 2 * t;
    const secondControlWeight = CUBIC_DEGREE * rest * t ** 2;
    const endWeight = t ** CUBIC_DEGREE;
    points.push([
      startWeight * x0 + firstControlWeight * x1 + secondControlWeight * x2 + endWeight * x3,
      startWeight * u0 + firstControlWeight * u1 + secondControlWeight * u2 + endWeight * u3,
    ]);
  }
  cord(ctx, g, points, tail.width, ROPE.body);
  // A frayed tuft at the tip, so the curl ends like rope rather than a limb.
  strut(ctx, g, x3, u3, x3 - tail.tuftLength, u3 + tail.tuftLength / 2, tail.width, STRAW_TONE);
}

function paintScarecrowHead(ctx: Ctx, g: Grid): void {
  const s = SCARECROW;
  ellipseT(ctx, g, s.poleX, s.headUp, s.headRx, s.headRy);
  fillInked(ctx, g, roundShade(ctx, g, s.poleX - s.headRx, s.poleX + s.headRx, BURLAP_TONE));
  // Button eyes: a stitched X vanishes at game size, a dark disc does not.
  for (const side of [-1, 1]) {
    ellipseT(ctx, g, s.poleX + side * s.eyeSpread, s.headUp + s.eyeLift, s.eyeRadius, s.eyeRadius);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  const mouth = s.mouth;
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.ink * FINE_LINE_SHARE;
  ctx.setLineDash([g.s(s.stitch), g.s(s.stitch)]);
  ctx.beginPath();
  ctx.moveTo(g.x(s.poleX - mouth.halfWidth), g.y(s.headUp - mouth.drop));
  ctx.quadraticCurveTo(
    g.x(s.poleX),
    g.y(s.headUp - mouth.drop - mouth.sag),
    g.x(s.poleX + mouth.halfWidth),
    g.y(s.headUp - mouth.drop),
  );
  ctx.stroke();
  ctx.setLineDash([]);
  ellipseT(ctx, g, s.poleX, s.headUp - s.nose.drop, s.nose.rx, s.nose.ry);
  fillInked(ctx, g, NOSE_PINK);

  const paintEar = (earX: number): void => {
    ellipseT(ctx, g, earX, s.earUp, s.earR, s.earR);
    fillInked(ctx, g, BURLAP.body);
    const inner = s.earR * s.earInnerShare;
    ellipseT(ctx, g, earX, s.earUp - s.earInnerDrop, inner, inner);
    ctx.fillStyle = NOSE_PINK;
    ctx.fill();
  };
  // Ears first, so the crown can sit over their roots...
  for (const earX of s.earX) paintEar(earX);
  ellipseT(ctx, g, s.poleX, s.brimUp, s.brimRx, s.brimRy);
  fillInked(ctx, g, CLOTH.weld.dark);
  ctx.beginPath();
  ctx.moveTo(g.x(s.poleX - s.crownRx), g.y(s.brimUp));
  ctx.quadraticCurveTo(
    g.x(s.poleX - s.crownRx),
    g.y(s.crownTop),
    g.x(s.poleX + s.crownLean),
    g.y(s.crownTop),
  );
  ctx.quadraticCurveTo(
    g.x(s.poleX + s.crownRx),
    g.y(s.crownTop - s.crownLean),
    g.x(s.poleX + s.crownRx),
    g.y(s.brimUp),
  );
  ctx.closePath();
  const weld: Tone = { lit: CLOTH.weld.light, body: CLOTH.weld.body, shade: CLOTH.weld.dark };
  fillInked(ctx, g, roundShade(ctx, g, s.poleX - s.crownRx, s.poleX + s.crownRx, weld));
  const madder: Tone = {
    lit: CLOTH.madder.light,
    body: CLOTH.madder.body,
    shade: CLOTH.madder.dark,
  };
  strut(
    ctx,
    g,
    s.poleX - s.crownRx + s.bandInset,
    s.brimUp + s.bandLift,
    s.poleX + s.crownRx - s.bandInset,
    s.brimUp + s.bandLift,
    s.bandWidth,
    madder,
  );
  // ...then their lower halves again in front of the crown, where they come
  // through the holes, each ringed by the hole's frayed edge.
  for (const earX of s.earX) {
    withClip(
      ctx,
      () =>
        rectT(
          ctx,
          g,
          earX - s.earR - s.earClipMargin,
          s.earUp - s.earR - s.earClipMargin,
          earX + s.earR + s.earClipMargin,
          s.earUp,
        ),
      () => paintEar(earX),
    );
    ctx.beginPath();
    ctx.ellipse(
      g.x(earX),
      g.y(s.earUp - s.earR * s.holeRimDrop),
      g.s(s.earR * s.holeRimWidthShare),
      g.s(s.holeRimRy),
      0,
      0,
      TWO_PI,
    );
    ctx.strokeStyle = CLOTH.weld.dark;
    ctx.lineWidth = g.ink * HOLE_RIM_LINE_SHARE;
    ctx.stroke();
  }
}

// ── Mushroom log bed ──────────────────────────────────────────────────────────

/**
 * A low wattle-edged bed of dark soil with two inoculated logs lying along it,
 * sprouting a few broad brown shelf caps and one cluster of madder-red ones.
 * Few and large, because a scatter of small caps is noise at game size.
 */
const MUSHROOM_BED = {
  box: { x0: 0.06, x1: 1.94, front: 0.14, depth: 0.72, height: 0.14 },
  shadowRx: 0.96,
  shadowRy: 0.44,
  soilStrokes: 40,
  soilStroke: 0.06,
  stakeX: [0.09, 1, 1.91],
  stakeWidth: 0.07,
  stakeOverBed: 0.06,
  logs: [
    { x: 0.16, up: 0.82, length: 1.62, radius: 0.13 },
    { x: 0.24, up: 0.52, length: 1.6, radius: 0.14 },
  ],
  /** Where along each log its moss patch sits, and how high on its flank. */
  mossAlong: 0.3,
  mossLift: 0.6,
  mossRx: 0.12,
  mossRy: 0.035,
} as const;

interface MushroomCap {
  readonly x: number;
  readonly up: number;
  readonly r: number;
  readonly red: boolean;
}
const MUSHROOM_CAPS: ReadonlyArray<MushroomCap> = [
  { x: 0.48, up: 1.0, r: 0.14, red: false },
  { x: 0.7, up: 1.0, r: 0.1, red: false },
  { x: 1.52, up: 1.0, r: 0.13, red: true },
  { x: 0.98, up: 0.72, r: 0.15, red: false },
  { x: 1.3, up: 0.71, r: 0.1, red: false },
];
/** A shelf cap's parts, as shares of its radius: the pale gill underside and the dome above it. */
const CAP = {
  gillDrop: 0.25,
  gillSquash: 0.35,
  domeDrop: 0.2,
  domeHeight: 0.8,
  spotRx: 0.14,
  spotRy: 0.12,
  spots: [
    [-0.3, 0.25],
    [0.25, 0.35],
  ],
} as const;
const SOIL = '#2c2016';
const SOIL_LIGHT = '#4a3826';

function paintMushroomLogBed(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const m = MUSHROOM_BED;
  const box = m.box;
  shadow(ctx, g, 1, box.front + box.depth / 2, m.shadowRx, m.shadowRy);
  const bed = boxFaces(g, box);
  ctx.fillStyle = SOIL;
  ctx.fillRect(bed.top.x, bed.top.y, bed.top.w, bed.top.h);
  strawStrokes(ctx, bed.top, forkRng(rng), m.soilStrokes, g.s(m.soilStroke), [
    SOIL_LIGHT,
    WOOD.deep,
  ]);
  drawWattle(ctx, bed.front.x, bed.front.y, bed.front.w, bed.front.h, forkRng(rng));
  inkBox(ctx, g, bed);
  for (const stakeX of m.stakeX) {
    logPost(ctx, g, stakeX, box.front, box.front + box.height + m.stakeOverBed, m.stakeWidth);
  }
  for (const log of m.logs) {
    drawLogSide(ctx, g, log.x, log.up, log.length, log.radius, forkRng(rng));
    mossTuft(
      ctx,
      g,
      log.x + log.length * m.mossAlong,
      log.up + log.radius * m.mossLift,
      m.mossRx,
      m.mossRy,
    );
  }
  for (const cap of MUSHROOM_CAPS) paintShelfCap(ctx, g, cap);
}

/** A log's bark, as shares of its diameter: the furrows run from near its top to near its foot. */
const BARK_FURROW_SPACING = 0.16;
const BARK_FURROW_TOP = 0.2;
const BARK_FURROW_BOTTOM = 0.85;
const BARK_FURROW_JITTER = 0.03;
const BARK_FURROW_SLANT = 0.04;
/** The cut end on a lying log's east end: a narrow ellipse, since it is seen nearly edge-on. */
const LYING_END_INSET = 0.4;
const LYING_END_RX = 0.5;
const LYING_END_RY = 0.95;

/** A log lying along the ground, seen side-on, its cut end to the east. */
function drawLogSide(
  ctx: Ctx,
  g: Grid,
  x: number,
  up: number,
  length: number,
  radius: number,
  rng: Rng,
): void {
  const top = g.y(up + radius);
  const px = g.x(x);
  const w = g.s(length);
  const h = g.s(radius * 2);
  ctx.beginPath();
  ctx.roundRect(px, top, w, h, h / 2);
  ctx.fillStyle = roundShadeVertical(ctx, top, top + h);
  ctx.fill();
  ctx.strokeStyle = LOG.barkDark;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  const furrows = Math.round(length / BARK_FURROW_SPACING);
  for (let furrow = 0; furrow < furrows; furrow++) {
    const furrowX = px + ((furrow + 1 / 2) / furrows) * w + jitter(rng, g.s(BARK_FURROW_JITTER));
    ctx.beginPath();
    ctx.moveTo(furrowX, top + h * BARK_FURROW_TOP);
    ctx.lineTo(furrowX + jitter(rng, g.s(BARK_FURROW_SLANT)), top + h * BARK_FURROW_BOTTOM);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.roundRect(px, top, w, h, h / 2);
  outline(ctx, g);
  const endX = px + w - g.s(radius * LYING_END_INSET);
  const endRx = g.s(radius * LYING_END_RX);
  const endRy = g.s(radius * LYING_END_RY);
  drawLogEnd(ctx, endX, top + h / 2, endRx, endRy);
  ctx.beginPath();
  ctx.ellipse(endX, top + h / 2, endRx, endRy, 0, 0, TWO_PI);
  outline(ctx, g);
}

function roundShadeVertical(ctx: Ctx, top: number, bottom: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, LOG.bark);
  gradient.addColorStop(ROUND_LIT_STOP, LOG.barkLight);
  gradient.addColorStop(ROUND_BODY_STOP, LOG.bark);
  gradient.addColorStop(1, LOG.barkDark);
  return gradient;
}

function paintShelfCap(ctx: Ctx, g: Grid, cap: MushroomCap): void {
  const body = cap.red ? CLOTH.madder.body : MUSHROOM.cap;
  const light = cap.red ? CLOTH.madder.light : MUSHROOM.capLight;
  ellipseT(ctx, g, cap.x, cap.up - cap.r * CAP.gillDrop, cap.r, cap.r * CAP.gillSquash);
  fillInked(ctx, g, MUSHROOM.gill);
  ctx.beginPath();
  ctx.ellipse(
    g.x(cap.x),
    g.y(cap.up - cap.r * CAP.domeDrop),
    g.s(cap.r),
    g.s(cap.r * CAP.domeHeight),
    0,
    Math.PI,
    0,
  );
  ctx.closePath();
  fillInked(ctx, g, body);
  litSpot(ctx, g, cap.x, cap.up, cap.r, cap.r * CAP.domeHeight, light, SHEEN.strong);
  if (!cap.red) return;
  for (const [dx, du] of CAP.spots) {
    ellipseT(
      ctx,
      g,
      cap.x + dx * cap.r,
      cap.up + du * cap.r,
      cap.r * CAP.spotRx,
      cap.r * CAP.spotRy,
    );
    ctx.fillStyle = CLOTH.linen.light;
    ctx.fill();
  }
}

// ── Hay bale ──────────────────────────────────────────────────────────────────

/**
 * Variant 0 is a square-cut bale bound with two madder twine bands, its sunlit
 * top a clear step paler than its face; variant 1 a round bale lying on its
 * side, its rolled end facing the viewer.
 */
const HAY_BALE = {
  square: { x0: 0.1, x1: 0.9, front: 0.18, depth: 0.5, height: 0.42 },
  squareShadowRx: 0.46,
  squareShadowRy: 0.3,
  strawStrokes: 70,
  topStroke: 0.1,
  faceStroke: 0.08,
  twineX: [0.32, 0.68],
  twineWidth: 0.035,
  round: { cx: 0.5, ground: 0.24, rx: 0.36, ry: 0.36, length: 0.42 },
  roundShadowLift: 0.08,
  roundShadowRx: 0.44,
  roundShadowRy: 0.2,
  rollStrokes: 50,
  rollStroke: 0.1,
  spiralTurns: 3.2,
  spiralSteps: 80,
  spiralOuterShare: 0.92,
  spiralLineShare: 1.1,
  loose: { x0: 0.08, x1: 0.92, top: 0.14, height: 0.1, strokes: 14, stroke: 0.1 },
} as const;
/** The bottom of a bale's face falls into its own shadow. */
const BALE_FOOT_SHADE = 'rgba(40,24,6,0.45)';
const CLEAR = 'rgba(0,0,0,0)';

function paintHayBale(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  if (variant === 0) {
    paintSquareBale(ctx, g, rng);
    return;
  }
  const h = HAY_BALE;
  const r = h.round;
  const centreUp = r.ground + r.ry;
  shadow(ctx, g, r.cx, r.ground + h.roundShadowLift, h.roundShadowRx, h.roundShadowRy);
  const traceBody = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(r.cx - r.rx), g.y(centreUp));
    ctx.lineTo(g.x(r.cx - r.rx), g.y(centreUp + r.length));
    ctx.ellipse(g.x(r.cx), g.y(centreUp + r.length), g.s(r.rx), g.s(r.ry), 0, Math.PI, 0);
    ctx.lineTo(g.x(r.cx + r.rx), g.y(centreUp));
    ctx.closePath();
  };
  traceBody();
  fillInked(ctx, g, roundShade(ctx, g, r.cx - r.rx, r.cx + r.rx, STRAW_TONE));
  withClip(ctx, traceBody, () =>
    strawStrokes(
      ctx,
      {
        x: g.x(r.cx - r.rx),
        y: g.y(centreUp + r.length + r.ry),
        w: g.s(r.rx * 2),
        h: g.s(r.length + r.ry),
      },
      forkRng(rng),
      h.rollStrokes,
      g.s(h.rollStroke),
      [STRAW.dark, STRAW.light],
    ),
  );
  ellipseT(ctx, g, r.cx, centreUp, r.rx, r.ry);
  fillInked(ctx, g, STRAW.body);
  ctx.strokeStyle = STRAW.dark;
  ctx.lineWidth = g.ink * h.spiralLineShare;
  ctx.beginPath();
  for (let step = 0; step <= h.spiralSteps; step++) {
    const along = step / h.spiralSteps;
    const angle = along * h.spiralTurns * TWO_PI;
    const reach = (1 - along) * h.spiralOuterShare;
    const px = g.x(r.cx + Math.cos(angle) * r.rx * reach);
    const py = g.y(centreUp + Math.sin(angle) * r.ry * reach);
    if (step === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  litSpot(ctx, g, r.cx, centreUp, r.rx, r.ry, STRAW.glint, SHEEN.soft);
  const loose = h.loose;
  strawStrokes(
    ctx,
    {
      x: g.x(loose.x0),
      y: g.y(loose.top),
      w: g.s(loose.x1 - loose.x0),
      h: g.s(loose.height),
    },
    forkRng(rng),
    loose.strokes,
    g.s(loose.stroke),
    [STRAW.body, STRAW.light],
  );
}

function paintSquareBale(ctx: Ctx, g: Grid, rng: Rng): void {
  const h = HAY_BALE;
  const b = h.square;
  shadow(ctx, g, 1 / 2, b.front + b.depth / 2, h.squareShadowRx, h.squareShadowRy);
  const faces = boxFaces(g, b);
  ctx.fillStyle = STRAW.glint;
  ctx.fillRect(faces.top.x, faces.top.y, faces.top.w, faces.top.h);
  ctx.fillStyle = STRAW.body;
  ctx.fillRect(faces.front.x, faces.front.y, faces.front.w, faces.front.h);
  strawStrokes(ctx, faces.top, forkRng(rng), h.strawStrokes, g.s(h.topStroke), [
    STRAW.light,
    STRAW.body,
  ]);
  strawStrokes(ctx, faces.front, forkRng(rng), h.strawStrokes, g.s(h.faceStroke), [
    STRAW.dark,
    STRAW.light,
    STRAW.dark,
  ]);
  const fade = ctx.createLinearGradient(0, faces.front.y, 0, faces.front.y + faces.front.h);
  fade.addColorStop(0, CLEAR);
  fade.addColorStop(1, BALE_FOOT_SHADE);
  ctx.fillStyle = fade;
  ctx.fillRect(faces.front.x, faces.front.y, faces.front.w, faces.front.h);
  inkBox(ctx, g, faces);
  for (const twineX of h.twineX) {
    ctx.beginPath();
    ctx.moveTo(g.x(twineX), faces.top.y);
    ctx.lineTo(g.x(twineX), faces.front.y + faces.front.h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = g.s(h.twineWidth) + g.ink;
    ctx.stroke();
    ctx.strokeStyle = CLOTH.madder.body;
    ctx.lineWidth = g.s(h.twineWidth);
    ctx.stroke();
  }
}

// ── Feed bin ──────────────────────────────────────────────────────────────────

/**
 * A planked grain bin, its lid tipped back on brass hinges and held open by a
 * prop stick, grain heaped inside with a wooden scoop in it.
 */
const FEED_BIN = {
  box: { x0: 0.1, x1: 0.9, front: 0.16, depth: 0.46, height: 0.44 },
  shadowRx: 0.46,
  shadowRy: 0.28,
  board: 0.11,
  lidHeight: 0.3,
  lidLean: 0.06,
  lidBoard: 0.16,
  lidBatten: { at: 0.55, height: 0.06 },
  wall: 0.05,
  grainStrokes: 60,
  grainStroke: 0.03,
  prop: { x: 0.8, width: 0.035 },
  scoop: {
    handleFrom: [0.62, -0.16],
    handleTo: [0.8, 0.02],
    handleWidth: 0.05,
    bowlX: 0.56,
    bowlDrop: 0.22,
    bowlRx: 0.1,
    bowlRy: 0.06,
    grainRx: 0.07,
    grainRy: 0.035,
    grainLift: 0.01,
  },
  hingeX: [0.24, 0.76],
  hingeHalfWidth: 0.04,
  hingeBelow: 0.02,
  hingeAbove: 0.06,
} as const;

function paintFeedBin(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const f = FEED_BIN;
  const b = f.box;
  shadow(ctx, g, 1 / 2, b.front + b.depth / 2, f.shadowRx, f.shadowRy);
  const backUp = b.front + b.depth + b.height;
  const lidTop = backUp + f.lidHeight;
  const lid: Point[] = [
    [g.x(b.x0), g.y(backUp)],
    [g.x(b.x0 + f.lidLean), g.y(lidTop)],
    [g.x(b.x1 - f.lidLean), g.y(lidTop)],
    [g.x(b.x1), g.y(backUp)],
  ];
  withClip(
    ctx,
    () => polygon(ctx, lid),
    () => {
      drawPlanks(ctx, g.x(b.x0), g.y(lidTop), g.s(b.x1 - b.x0), g.s(f.lidHeight), forkRng(rng), {
        direction: 'vertical',
        boardPx: g.s(f.lidBoard),
        base: WOOD.dark,
      });
      ctx.fillStyle = WOOD.body;
      ctx.fillRect(
        g.x(b.x0),
        g.y(backUp + f.lidHeight * f.lidBatten.at),
        g.s(b.x1 - b.x0),
        g.s(f.lidBatten.height),
      );
    },
  );
  polygon(ctx, lid);
  outline(ctx, g);
  const faces = plankBox(ctx, g, b, forkRng(rng), f.board, WOOD.mid, WOOD.body);
  const wall = g.s(f.wall);
  const inner: PxRect = {
    x: faces.top.x + wall,
    y: faces.top.y + wall,
    w: faces.top.w - wall * 2,
    h: faces.top.h - wall * 2,
  };
  ctx.fillStyle = CLOTH.weld.body;
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  strawStrokes(ctx, inner, forkRng(rng), f.grainStrokes, g.s(f.grainStroke), [
    CLOTH.weld.light,
    CLOTH.weld.dark,
  ]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = g.ink * FINE_LINE_SHARE;
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
  strut(ctx, g, f.prop.x, backUp, f.prop.x, lidTop - f.lidBatten.height, f.prop.width, WOOD_TONE);
  const scoop = f.scoop;
  const [fromX, fromDu] = scoop.handleFrom;
  const [toX, toDu] = scoop.handleTo;
  strut(ctx, g, fromX, backUp + fromDu, toX, backUp + toDu, scoop.handleWidth, WOOD_TONE);
  ellipseT(ctx, g, scoop.bowlX, backUp - scoop.bowlDrop, scoop.bowlRx, scoop.bowlRy);
  fillInked(ctx, g, WOOD.light);
  ellipseT(
    ctx,
    g,
    scoop.bowlX,
    backUp - scoop.bowlDrop + scoop.grainLift,
    scoop.grainRx,
    scoop.grainRy,
  );
  ctx.fillStyle = CLOTH.weld.light;
  ctx.fill();
  for (const hingeX of f.hingeX) {
    rectT(
      ctx,
      g,
      hingeX - f.hingeHalfWidth,
      backUp - f.hingeBelow,
      hingeX + f.hingeHalfWidth,
      backUp + f.hingeAbove,
    );
    fillInked(ctx, g, BRASS.body);
  }
}

// ── Log pile ──────────────────────────────────────────────────────────────────

/**
 * Firewood stacked between two stakes, cut ends toward the viewer. The three
 * variants are the pile's fill — low, half and stacked to the stakes' tops —
 * which the layout chooses by position so a lumber yard looks worked.
 *
 * Each course's bark shows above it as one pale plane rather than a row of
 * separate tubes: drawn as tubes, a course reads as a plank fence behind the
 * pile.
 */
const LOG_PILE = {
  stakeX: [0.08, 1.92],
  stakeWidth: 0.09,
  stakeGap: 0.01,
  stakeSink: 0.02,
  stakeTopOver: 0.14,
  front: 0.22,
  logLength: 0.34,
  logRadius: 0.105,
  rows: [2, 4, 6],
  firstLogX: 0.23,
  logSpacing: 0.2,
  /** The span between the stakes left clear of logs, so the end logs never touch the stakes. */
  stakeClearance: 0.1,
  shadowRx: 0.96,
  shadowRy: 0.3,
  heartShare: 0.12,
  heartJitter: 0.1,
  chips: { x0: 0.3, x1: 1.7, top: 0.2, height: 0.12, count: 10, stroke: 0.05 },
} as const;
/** Stacked round logs nest: each row sits this many radii above the one below. */
const ROW_PACKING = 1.7;
const LOG_END_SQUASH = 0.92;
/** Every few logs one is older and greyer at its cut end, so the pile is not a grid of copies. */
const WEATHERED_EVERY = 3;

interface PiledLog {
  readonly x: number;
  readonly up: number;
  readonly weathered: boolean;
}

function paintLogPile(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  const p = LOG_PILE;
  const rows = p.rows[Math.min(variant, p.rows.length - 1)] ?? 1;
  const rowStep = p.logRadius * ROW_PACKING;
  const [westStake, eastStake] = p.stakeX;
  const perRow = Math.floor(
    (eastStake - westStake - p.stakeWidth - p.stakeClearance) / p.logSpacing,
  );
  shadow(ctx, g, 1, p.front + p.logLength / 2, p.shadowRx, p.shadowRy);
  const courses: PiledLog[][] = [];
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : p.logSpacing / 2;
    const count = row % 2 === 0 ? perRow : perRow - 1;
    const course: PiledLog[] = [];
    for (let index = 0; index < count; index++) {
      course.push({
        x: p.firstLogX + stagger + index * p.logSpacing,
        up: p.front + p.logRadius + row * rowStep,
        weathered: (index + row) % WEATHERED_EVERY === 0,
      });
    }
    courses.push(course);
  }
  // Each course's bark top, lowest first, so every course above covers the one below.
  for (const course of courses) {
    if (course.length === 0) continue;
    const first = course[0];
    const last = course[course.length - 1];
    const x0 = first.x - p.logRadius;
    const x1 = last.x + p.logRadius;
    rectT(ctx, g, x0, first.up, x1, first.up + p.logLength);
    const bark = ctx.createLinearGradient(0, g.y(first.up + p.logLength), 0, g.y(first.up));
    bark.addColorStop(0, LOG.barkLight);
    bark.addColorStop(1, LOG.bark);
    fillInked(ctx, g, bark);
    ctx.strokeStyle = LOG.barkDark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const log of course.slice(1)) {
      const seamX = g.x(log.x - p.logSpacing / 2);
      ctx.beginPath();
      ctx.moveTo(seamX, g.y(log.up + p.logLength));
      ctx.lineTo(seamX, g.y(log.up));
      ctx.stroke();
    }
  }
  const topUp = p.front + p.logRadius + (rows - 1) * rowStep;
  for (const stakeX of p.stakeX) {
    const inward = (stakeX < 1 ? 1 : -1) * (p.stakeWidth / 2 + p.stakeGap);
    logPost(
      ctx,
      g,
      stakeX + inward,
      p.front - p.stakeSink,
      topUp + p.logRadius + p.stakeTopOver,
      p.stakeWidth,
    );
  }
  const heartRng = forkRng(rng);
  for (const log of courses.flat()) {
    const cx = g.x(log.x);
    const cy = g.y(log.up);
    const rx = g.s(p.logRadius);
    const ry = g.s(p.logRadius * LOG_END_SQUASH);
    drawLogEnd(ctx, cx, cy, rx, ry);
    if (log.weathered) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
      ctx.fillStyle = WEATHERED_END;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
    outline(ctx, g);
    ctx.fillStyle = LOG.cutDark;
    ctx.beginPath();
    ctx.arc(
      cx + jitter(heartRng, rx * p.heartJitter),
      cy + jitter(heartRng, ry * p.heartJitter),
      Math.max(1, rx * p.heartShare),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  if (variant === 0) {
    // A low pile leaves room on the ground for the chips of the last splitting.
    const chips = p.chips;
    strawStrokes(
      ctx,
      { x: g.x(chips.x0), y: g.y(chips.top), w: g.s(chips.x1 - chips.x0), h: g.s(chips.height) },
      forkRng(rng),
      chips.count,
      g.s(chips.stroke),
      [LOG.cut, LOG.cutDark],
    );
  }
}
/** A grey wash over an old log's cut end. */
const WEATHERED_END = 'rgba(90,86,76,0.45)';

// ── Board stack ───────────────────────────────────────────────────────────────

/** Sawn boards stacked on two sleepers, a course at a time, edges to the viewer. */
const BOARD_STACK = {
  x0: 0.08,
  x1: 0.92,
  front: 0.2,
  depth: 0.54,
  course: 0.075,
  courses: 6,
  courseShift: [0, 0.03, -0.02, 0.04, 0.01, -0.03],
  topBoard: 0.135,
  shadowRx: 0.46,
  shadowRy: 0.3,
  sleeperX: [0.22, 0.78],
  sleeper: { halfWidth: 0.07, overhang: 0.02, height: 0.06, board: 0.08 },
  /** A board edge's shaded lower lip, as a share of the course's height. */
  edgeLip: 0.35,
  seams: [0.3, 0.62],
  seamJitter: 0.04,
  twineX: 0.62,
  twineWidth: 0.035,
} as const;
/** The lines between stacked courses are softer than the stack's own silhouette. */
const COURSE_LINE_SHARE = 0.8;

function paintBoardStack(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const s = BOARD_STACK;
  shadow(ctx, g, 1 / 2, s.front + s.depth / 2, s.shadowRx, s.shadowRy);
  const sleeper = s.sleeper;
  for (const sleeperX of s.sleeperX) {
    plankBox(
      ctx,
      g,
      {
        x0: sleeperX - sleeper.halfWidth,
        x1: sleeperX + sleeper.halfWidth,
        front: s.front - sleeper.overhang,
        depth: s.depth + sleeper.overhang * 2,
        height: sleeper.height,
      },
      forkRng(rng),
      sleeper.board,
      LOG.barkLight,
      LOG.bark,
    );
  }
  for (let course = 0; course < s.courses; course++) {
    const shift = s.courseShift[course] ?? 0;
    const faces = boxFaces(g, {
      x0: s.x0 + Math.max(0, shift),
      x1: s.x1 + Math.min(0, shift),
      front: s.front + sleeper.height + course * s.course,
      depth: s.depth,
      height: s.course,
    });
    const front = faces.front;
    ctx.fillStyle = course % 2 === 0 ? WOOD.light : WOOD.highlight;
    ctx.fillRect(front.x, front.y, front.w, front.h);
    ctx.fillStyle = WOOD.mid;
    ctx.fillRect(front.x, front.y + front.h * (1 - s.edgeLip), front.w, front.h * s.edgeLip);
    ctx.strokeStyle = WOOD.dark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const seam of s.seams) {
      const seamX = front.x + front.w * (seam + jitter(rng, s.seamJitter));
      ctx.beginPath();
      ctx.moveTo(seamX, front.y);
      ctx.lineTo(seamX, front.y + front.h);
      ctx.stroke();
    }
    const topCourse = course === s.courses - 1;
    if (topCourse) {
      drawPlanks(ctx, faces.top.x, faces.top.y, faces.top.w, faces.top.h, forkRng(rng), {
        direction: 'horizontal',
        boardPx: g.s(s.topBoard),
        base: WOOD.highlight,
        nailChance: 0,
      });
      inkBox(ctx, g, faces);
    } else {
      ctx.beginPath();
      ctx.rect(front.x, front.y, front.w, front.h);
      outline(ctx, g, g.ink * COURSE_LINE_SHARE);
    }
  }
  const stackTop = s.front + sleeper.height + s.courses * s.course + s.depth;
  strut(ctx, g, s.twineX, stackTop, s.twineX, s.front + sleeper.height, s.twineWidth, ROPE_TONE);
}

// ── Stone pile ────────────────────────────────────────────────────────────────

interface PiledStone {
  readonly x: number;
  readonly up: number;
  readonly rx: number;
  readonly ry: number;
  readonly block: boolean;
}

/** Quarried fieldstone heaped in a mound, back to front: a few squared blocks among rounded stones. */
const STONE_PILE: ReadonlyArray<PiledStone> = [
  { x: 0.34, up: 0.74, rx: 0.14, ry: 0.11, block: false },
  { x: 0.64, up: 0.78, rx: 0.15, ry: 0.11, block: true },
  { x: 0.5, up: 0.98, rx: 0.14, ry: 0.11, block: false },
  { x: 0.2, up: 0.46, rx: 0.13, ry: 0.11, block: false },
  { x: 0.46, up: 0.56, rx: 0.16, ry: 0.13, block: true },
  { x: 0.78, up: 0.5, rx: 0.14, ry: 0.12, block: false },
  { x: 0.3, up: 0.28, rx: 0.15, ry: 0.12, block: false },
  { x: 0.62, up: 0.26, rx: 0.16, ry: 0.12, block: false },
  { x: 0.86, up: 0.22, rx: 0.08, ry: 0.07, block: false },
];
const STONE_PILE_SHADOW = { up: 0.36, rx: 0.46, ry: 0.3 } as const;
const STONE_PILE_MOSS = [0.5, 1.06, 0.07, 0.03] as const;
/** A dressed block stands a little taller than it is deep. */
const BLOCK_HEIGHT_SHARE = 1.2;
/** Chisel marks across a block's dressed face, as shares of its width and height. */
const CHISEL_MARKS = [0.3, 0.6];
const CHISEL_SLANT = 0.08;
const CHISEL_TOP = 0.25;
const CHISEL_BOTTOM = 0.75;
/** The shaded underside of a rounded stone, as shares of its radii. */
const STONE_BELLY = { dx: 0.2, drop: 0.4, rx: 0.7, ry: 0.4, colour: 'rgba(0,0,0,0.22)' } as const;

function paintStonePile(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const sh = STONE_PILE_SHADOW;
  shadow(ctx, g, 1 / 2, sh.up, sh.rx, sh.ry);
  for (const stone of STONE_PILE) {
    const face = pickStoneFace(rng);
    if (stone.block) {
      paintStoneBlock(ctx, g, stone, face);
      continue;
    }
    ellipseT(ctx, g, stone.x, stone.up, stone.rx, stone.ry);
    fillInked(ctx, g, face);
    litSpot(ctx, g, stone.x, stone.up, stone.rx, stone.ry, STONE.highlight, SHEEN.medium);
    ellipseT(
      ctx,
      g,
      stone.x + stone.rx * STONE_BELLY.dx,
      stone.up - stone.ry * STONE_BELLY.drop,
      stone.rx * STONE_BELLY.rx,
      stone.ry * STONE_BELLY.ry,
    );
    ctx.fillStyle = STONE_BELLY.colour;
    ctx.fill();
  }
  const [mossX, mossUp, mossRx, mossRy] = STONE_PILE_MOSS;
  mossTuft(ctx, g, mossX, mossUp, mossRx, mossRy);
}

function paintStoneBlock(ctx: Ctx, g: Grid, stone: PiledStone, face: string): void {
  const faces = boxFaces(g, {
    x0: stone.x - stone.rx,
    x1: stone.x + stone.rx,
    front: stone.up - stone.ry,
    depth: stone.ry,
    height: stone.ry * BLOCK_HEIGHT_SHARE,
  });
  ctx.fillStyle = STONE.light;
  ctx.fillRect(faces.top.x, faces.top.y, faces.top.w, faces.top.h);
  ctx.fillStyle = face;
  ctx.fillRect(faces.front.x, faces.front.y, faces.front.w, faces.front.h);
  inkBox(ctx, g, faces);
  const front = faces.front;
  ctx.strokeStyle = STONE.deep;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  for (const mark of CHISEL_MARKS) {
    ctx.beginPath();
    ctx.moveTo(front.x + front.w * mark, front.y + front.h * CHISEL_TOP);
    ctx.lineTo(front.x + front.w * (mark + CHISEL_SLANT), front.y + front.h * CHISEL_BOTTOM);
    ctx.stroke();
  }
}

// ── Chopping block ────────────────────────────────────────────────────────────

/** A broad stump with a ringed top, an axe bitten into it, and chips round its foot. */
const CHOPPING_BLOCK = {
  cx: 0.46,
  ground: 0.44,
  rx: 0.3,
  ry: 0.18,
  height: 0.34,
  shadowRx: 0.4,
  shadowRy: 0.24,
  /** Bark furrows down the stump's side, as shares of its radius from its axis. */
  furrows: [-0.7, -0.35, 0.05, 0.4, 0.75],
  furrowJitter: 0.01,
  furrowSlantPx: 2,
  furrowFootShare: 0.9,
  rings: [0.72, 0.45, 0.2],
  /** Old axe cuts across the top: start and end, offset from the top's centre. */
  cuts: [
    [-0.15, 0.06, 0.12, -0.08],
    [0.02, 0.1, 0.2, 0],
  ],
  chip: { halfLength: 0.035, halfWidth: 0.015, spin: 1 },
  chips: [
    [0.12, 0.2],
    [0.24, 0.1],
    [0.62, 0.12],
    [0.78, 0.36],
    [0.1, 0.52],
  ],
  axe: {
    biteDx: 0.02,
    haftLift: 0.04,
    haftEndX: 0.9,
    haftEndUp: 1.36,
    haftWidth: 0.055,
    /** The iron head's outline, offset from the bite point. */
    head: [
      [-0.14, -0.02],
      [-0.12, 0.16],
      [0.06, 0.14],
      [0.08, 0.02],
    ],
    edgeFrom: [-0.13, 0.01],
    edgeTo: [-0.11, 0.15],
    edgeWidth: 0.03,
    slitDx: -0.03,
    slitDu: -0.01,
    slitRx: 0.14,
    slitRy: 0.02,
  },
  leaningSplit: {
    foot: [0.84, 0.22],
    top: [0.78, 0.64],
    width: 0.12,
    faceFoot: [0.8, 0.22],
    faceTop: [0.745, 0.62],
    faceWidth: 0.05,
  },
} as const;
const EDGE_TONE: Tone = { lit: IRON.glint, body: IRON.light, shade: IRON.body };
const CUT_FACE_TONE: Tone = { lit: LOG.cut, body: LOG.cut, shade: LOG.cutDark };

function paintChoppingBlock(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const c = CHOPPING_BLOCK;
  shadow(ctx, g, c.cx, c.ground, c.shadowRx, c.shadowRy);
  const chipRng = forkRng(rng);
  const chipW = g.s(c.chip.halfLength * 2);
  const chipH = g.s(c.chip.halfWidth * 2);
  for (const [chipX, chipUp] of c.chips) {
    ctx.save();
    try {
      ctx.translate(g.x(chipX), g.y(chipUp));
      ctx.rotate(jitter(chipRng, c.chip.spin));
      ctx.fillStyle = LOG.cut;
      ctx.fillRect(-chipW / 2, -chipH / 2, chipW, chipH);
      ctx.strokeStyle = INK;
      ctx.lineWidth = g.ink * FINE_LINE_SHARE;
      ctx.strokeRect(-chipW / 2, -chipH / 2, chipW, chipH);
    } finally {
      ctx.restore();
    }
  }
  const topUp = cylinder(ctx, g, c.cx, c.ground, c.rx, c.ry, c.height, BARK_TONE, LOG.cut);
  ctx.strokeStyle = LOG.barkDark;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  for (const furrow of c.furrows) {
    const furrowX = g.x(c.cx + furrow * c.rx + jitter(rng, c.furrowJitter));
    const rimDrop = c.ry * Math.sqrt(1 - furrow * furrow);
    ctx.beginPath();
    ctx.moveTo(furrowX, g.y(topUp - rimDrop));
    ctx.lineTo(furrowX + jitter(rng, c.furrowSlantPx), g.y(c.ground - rimDrop * c.furrowFootShare));
    ctx.stroke();
  }
  ctx.strokeStyle = LOG.ring;
  for (const ring of c.rings) {
    ctx.beginPath();
    ctx.ellipse(g.x(c.cx), g.y(topUp), g.s(c.rx * ring), g.s(c.ry * ring), 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.strokeStyle = LOG.cutDark;
  for (const [x0, u0, x1, u1] of c.cuts) {
    ctx.beginPath();
    ctx.moveTo(g.x(c.cx + x0), g.y(topUp + u0));
    ctx.lineTo(g.x(c.cx + x1), g.y(topUp + u1));
    ctx.stroke();
  }
  const axe = c.axe;
  const biteX = c.cx + axe.biteDx;
  strut(ctx, g, biteX, topUp + axe.haftLift, axe.haftEndX, axe.haftEndUp, axe.haftWidth, WOOD_TONE);
  polygon(
    ctx,
    axe.head.map(([dx, du]): Point => [g.x(biteX + dx), g.y(topUp + du)]),
  );
  fillInked(ctx, g, IRON.body);
  const [edgeFromX, edgeFromU] = axe.edgeFrom;
  const [edgeToX, edgeToU] = axe.edgeTo;
  strut(
    ctx,
    g,
    biteX + edgeFromX,
    topUp + edgeFromU,
    biteX + edgeToX,
    topUp + edgeToU,
    axe.edgeWidth,
    EDGE_TONE,
  );
  ellipseT(ctx, g, biteX + axe.slitDx, topUp + axe.slitDu, axe.slitRx, axe.slitRy);
  ctx.fillStyle = HOLLOW_SHADE;
  ctx.fill();
  const split = c.leaningSplit;
  const [footX, footUp] = split.foot;
  const [splitTopX, splitTopUp] = split.top;
  strut(ctx, g, footX, footUp, splitTopX, splitTopUp, split.width, BARK_TONE);
  const [faceFootX, faceFootUp] = split.faceFoot;
  const [faceTopX, faceTopUp] = split.faceTop;
  strut(ctx, g, faceFootX, faceFootUp, faceTopX, faceTopUp, split.faceWidth, CUT_FACE_TONE);
}

// ── Crate ─────────────────────────────────────────────────────────────────────

/**
 * Variant 0: a closed plank crate, a brace across its face, battens across
 * its lid and brass corners. Variant 1: an open slatted crate heaped with
 * apples and turnips. Variant 2: a crate with a woad cloth thrown over its lid
 * and hanging down its face.
 */
const CRATE = {
  shadowUp: 0.46,
  shadowRx: 0.46,
  shadowRy: 0.3,
  closed: { x0: 0.1, x1: 0.9, front: 0.16, depth: 0.5, height: 0.52 },
  draped: { x0: 0.08, x1: 0.92, front: 0.16, depth: 0.5, height: 0.46 },
  produce: { x0: 0.1, x1: 0.9, front: 0.16, depth: 0.5, height: 0.4 },
  batten: 0.07,
  lidBattenShares: [0.18, 0.82],
  corner: 0.06,
  slats: 3,
  producePost: 0.07,
  produceRim: 0.06,
} as const;
/** Boards across a crate's face: three to its height. */
const CRATE_BOARDS = 3;
/** The brace is a touch wider than an edge batten, and carries a thin lit edge. */
const CRATE_BRACE_SHARE = 1.1;
const BRACE_GLINT_SHARE = 0.25;
const BRACE_GLINT_DROP = 0.4;
const CORNER_GLINT_SHARE = 0.35;

/**
 * The cloth over variant 2's lid, as offsets in tiles from the lid's back-left
 * corner (x right, up upward): across the lid, over the front edge and down
 * the face in two folds.
 */
const DRAPE = {
  lid: [
    [0.08, 0],
    [0.62, 0],
    [0.7, -0.5],
  ],
  flap: [
    [0.74, -0.5],
    [0.72, -0.74],
    [0.6, -0.8],
    [0.5, -0.7],
    [0.38, -0.82],
    [0.26, -0.72],
    [0.14, -0.62],
    [0.1, -0.5],
  ],
  folds: [
    [0.5, -0.52, 0.5, -0.7],
    [0.28, -0.52, 0.26, -0.7],
  ],
  foldWidth: 0.03,
} as const;
const WOAD_TONE: Tone = { lit: CLOTH.woad.light, body: CLOTH.woad.body, shade: CLOTH.woad.dark };

function paintCrate(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  const c = CRATE;
  shadow(ctx, g, 1 / 2, c.shadowUp, c.shadowRx, c.shadowRy);
  if (variant === 1) {
    paintProduceCrate(ctx, g, rng);
    return;
  }
  if (variant === 2) {
    paintClosedCrate(ctx, g, c.draped, rng);
    paintDrape(ctx, g, c.draped);
    return;
  }
  paintClosedCrate(ctx, g, c.closed, rng);
}

function paintClosedCrate(ctx: Ctx, g: Grid, box: BoxSpec, rng: Rng): void {
  const c = CRATE;
  const faces = plankBox(ctx, g, box, forkRng(rng), box.height / CRATE_BOARDS, WOOD.mid, WOOD.body);
  const front = faces.front;
  const batten = g.s(c.batten);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(front.x, front.y, front.w, front.h);
    },
    () => {
      ctx.fillStyle = WOOD.dark;
      ctx.strokeStyle = WOOD.dark;
      for (const edge of [front.x, front.x + front.w - batten]) {
        ctx.fillRect(edge, front.y, batten, front.h);
      }
      ctx.lineWidth = batten * CRATE_BRACE_SHARE;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(front.x + batten, front.y + front.h);
      ctx.lineTo(front.x + front.w - batten, front.y);
      ctx.stroke();
      ctx.strokeStyle = WOOD.light;
      ctx.lineWidth = Math.max(1, batten * BRACE_GLINT_SHARE);
      ctx.beginPath();
      ctx.moveTo(front.x + batten, front.y + front.h - batten * BRACE_GLINT_DROP);
      ctx.lineTo(front.x + front.w - batten * (1 + BRACE_GLINT_DROP), front.y);
      ctx.stroke();
    },
  );
  // Two battens across the lid, so the top reads as a lid rather than a slab.
  for (const share of c.lidBattenShares) {
    const battenX = faces.top.x + faces.top.w * share - batten / 2;
    ctx.fillStyle = WOOD.dark;
    ctx.fillRect(battenX, faces.top.y, batten, faces.top.h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = g.ink * FINE_LINE_SHARE;
    ctx.strokeRect(battenX, faces.top.y, batten, faces.top.h);
  }
  const cap = g.s(c.corner);
  for (const [capX, capY] of [
    [front.x, front.y],
    [front.x + front.w - cap, front.y],
    [front.x, front.y + front.h - cap],
    [front.x + front.w - cap, front.y + front.h - cap],
  ] as const) {
    ctx.fillStyle = BRASS.body;
    ctx.fillRect(capX, capY, cap, cap);
    ctx.fillStyle = BRASS.light;
    ctx.fillRect(capX, capY, cap, cap * CORNER_GLINT_SHARE);
  }
  inkBox(ctx, g, faces);
}

function paintDrape(ctx: Ctx, g: Grid, box: BoxSpec): void {
  const backUp = box.front + box.height + box.depth;
  const at = ([dx, du]: readonly [number, number]): Point => [g.x(box.x0 + dx), g.y(backUp + du)];
  polygon(ctx, [...DRAPE.lid.map(at), ...DRAPE.flap.map(at)]);
  fillInked(ctx, g, roundShade(ctx, g, box.x0, box.x1, WOAD_TONE));
  for (const [x0, u0, x1, u1] of DRAPE.folds) {
    strut(ctx, g, box.x0 + x0, backUp + u0, box.x0 + x1, backUp + u1, DRAPE.foldWidth, {
      lit: CLOTH.woad.dark,
      body: CLOTH.woad.dark,
      shade: CLOTH.woad.dark,
    });
  }
}

interface Produce {
  readonly x: number;
  readonly up: number;
  readonly r: number;
  readonly kind: 'apple' | 'turnip';
}
/** The heap, back to front. */
const PRODUCE_HEAP: ReadonlyArray<Produce> = [
  { x: 0.24, up: 0.94, r: 0.09, kind: 'apple' },
  { x: 0.4, up: 0.98, r: 0.1, kind: 'turnip' },
  { x: 0.58, up: 0.99, r: 0.09, kind: 'apple' },
  { x: 0.74, up: 0.95, r: 0.09, kind: 'apple' },
  { x: 0.3, up: 0.78, r: 0.1, kind: 'apple' },
  { x: 0.5, up: 0.8, r: 0.11, kind: 'turnip' },
  { x: 0.7, up: 0.78, r: 0.1, kind: 'apple' },
  { x: 0.2, up: 0.64, r: 0.09, kind: 'apple' },
  { x: 0.8, up: 0.64, r: 0.09, kind: 'turnip' },
];
/** A turnip's parts, as shares of its radius. */
const TURNIP = {
  squash: 0.9,
  blushLift: 0.35,
  blushRx: 0.75,
  blushRy: 0.45,
  leafFrom: 0.8,
  leafTo: 1.7,
  leafJitter: 0.03,
  leafWidth: 0.035,
} as const;
const LEAF_TONE: Tone = { lit: MOSS.light, body: PRODUCE.leaf, shade: MOSS.dark };

function paintProduceCrate(ctx: Ctx, g: Grid, rng: Rng): void {
  const c = CRATE;
  const box = c.produce;
  const faces = boxFaces(g, box);
  // Back to front, so the slats hide the lower half of the heap.
  ctx.fillStyle = WOOD.deep;
  ctx.fillRect(faces.top.x, faces.top.y, faces.top.w, faces.top.h);
  const produceRng = forkRng(rng);
  for (const item of PRODUCE_HEAP) {
    const r = item.r;
    ellipseT(ctx, g, item.x, item.up, r, r * TURNIP.squash);
    if (item.kind === 'apple') {
      fillInked(ctx, g, PRODUCE.apple);
      litSpot(ctx, g, item.x, item.up, r, r, PRODUCE.appleLight, SHEEN.strong);
      continue;
    }
    fillInked(ctx, g, PRODUCE.turnip);
    ellipseT(
      ctx,
      g,
      item.x,
      item.up + r * TURNIP.blushLift,
      r * TURNIP.blushRx,
      r * TURNIP.blushRy,
    );
    ctx.fillStyle = PRODUCE.turnipBlush;
    ctx.fill();
    strut(
      ctx,
      g,
      item.x,
      item.up + r * TURNIP.leafFrom,
      item.x + jitter(produceRng, TURNIP.leafJitter),
      item.up + r * TURNIP.leafTo,
      TURNIP.leafWidth,
      LEAF_TONE,
    );
  }
  const slatH = box.height / (c.slats * 2 - 1);
  for (let slat = 0; slat < c.slats; slat++) {
    const u0 = box.front + slat * slatH * 2;
    rectT(ctx, g, box.x0, u0, box.x1, u0 + slatH);
    ctx.fillStyle = slat % 2 === 0 ? WOOD.body : WOOD.mid;
    ctx.fill();
    outline(ctx, g, g.ink * FINE_LINE_SHARE);
  }
  const rimUp = box.front + box.height + box.depth;
  for (const postX of [box.x0 + c.producePost / 2, box.x1 - c.producePost / 2]) {
    strut(ctx, g, postX, box.front, postX, rimUp, c.producePost);
  }
  strut(ctx, g, box.x0, rimUp - c.produceRim / 2, box.x1, rimUp - c.produceRim / 2, c.produceRim);
  rectT(ctx, g, box.x0, box.front, box.x1, rimUp);
  outline(ctx, g);
}

// ── Barrel ────────────────────────────────────────────────────────────────────

/**
 * Variant 0: an upright lidded barrel with brass hoops. Variant 1: an open
 * rain barrel full of water, a dipper over its rim. Variant 2: a barrel lying
 * on its side on two chocks, its brass-ringed head and tap facing east.
 */
const BARREL = {
  cx: 0.5,
  ground: 0.42,
  rx: 0.28,
  ry: 0.13,
  height: 0.6,
  bulge: 0.05,
  shadowRx: 0.4,
  shadowRy: 0.2,
  /** Hoops, as shares of the barrel's height (upright) or length (lying). */
  hoops: [0.12, 0.34, 0.86],
  hoopWidth: 0.04,
  staveJitter: 0.005,
  lid: { inset: 0.03, insetDepth: 0.02, seams: [-0.09, 0.09], seamReach: 0.85 },
  bung: { dx: 0.06, du: 0.01, rx: 0.035, ry: 0.02 },
  water: { drop: 0.02, inset: 0.035, insetDepth: 0.025 },
  dipper: { from: [0.12, 0.01], to: [0.3, 0.24], width: 0.04 },
  lying: {
    x0: 0.12,
    x1: 0.84,
    axisUp: 0.5,
    radius: 0.27,
    endRx: 0.1,
    /** How far the staves curl in at each end of the lying barrel. */
    endTaper: 0.04,
    hoopOverhang: 0.1,
    headInset: 0.04,
    headRing: 0.7,
    tapDrop: 0.06,
    tapReach: 0.1,
    spoutX: 0.08,
    spoutDrop: 0.07,
    tapWidth: 0.05,
    spoutWidth: 0.04,
    shadowUp: 0.3,
    shadowRx: 0.44,
    shadowRy: 0.18,
  },
  chocks: { x: [0.26, 0.7], halfWidth: 0.08, foot: 0.2, peak: 0.34 },
} as const;
/** Where the staves' joints fall across a barrel's face, as shares of its radius. */
const STAVE_POSITIONS = [-0.62, -0.22, 0.2, 0.6];
/** Hoops ride the barrel's swell; this maps the swell at a height to the hoop's reach. */
const BULGE_TO_EDGE = 0.5;

function paintBarrel(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  const b = BARREL;
  if (variant === 2) {
    paintLyingBarrel(ctx, g, rng);
    return;
  }
  shadow(ctx, g, b.cx, b.ground, b.shadowRx, b.shadowRy);
  const topUp = b.ground + b.height;
  const middleUp = b.ground + b.height / 2;
  const swell = b.bulge * 2;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(b.cx - b.rx), g.y(topUp));
    ctx.quadraticCurveTo(g.x(b.cx - b.rx - swell), g.y(middleUp), g.x(b.cx - b.rx), g.y(b.ground));
    ctx.ellipse(g.x(b.cx), g.y(b.ground), g.s(b.rx), g.s(b.ry), 0, Math.PI, 0, true);
    ctx.quadraticCurveTo(g.x(b.cx + b.rx + swell), g.y(middleUp), g.x(b.cx + b.rx), g.y(topUp));
    ctx.closePath();
  };
  trace();
  fillInked(ctx, g, roundShade(ctx, g, b.cx - b.rx - b.bulge, b.cx + b.rx + b.bulge, WOOD_TONE));
  withClip(ctx, trace, () => {
    ctx.strokeStyle = WOOD.dark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const stave of STAVE_POSITIONS) {
      const staveX = b.cx + stave * b.rx;
      ctx.beginPath();
      ctx.moveTo(g.x(staveX), g.y(topUp));
      ctx.quadraticCurveTo(
        g.x(staveX + stave * swell + jitter(rng, b.staveJitter)),
        g.y(middleUp),
        g.x(staveX),
        g.y(b.ground - b.ry),
      );
      ctx.stroke();
    }
    for (const hoop of b.hoops) {
      const hoopSwell = swell * Math.sin(Math.PI * hoop) * BULGE_TO_EDGE;
      band(
        ctx,
        g,
        b.cx,
        b.ground + hoop * b.height,
        b.rx + hoopSwell,
        b.ry,
        b.hoopWidth,
        BRASS.body,
      );
    }
  });
  ellipseT(ctx, g, b.cx, topUp, b.rx, b.ry);
  fillInked(ctx, g, WOOD.dark);
  if (variant === 0) {
    const lid = b.lid;
    ellipseT(ctx, g, b.cx, topUp, b.rx - lid.inset, b.ry - lid.insetDepth);
    ctx.fillStyle = WOOD.mid;
    ctx.fill();
    ctx.strokeStyle = WOOD.dark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const seam of lid.seams) {
      ctx.beginPath();
      ctx.moveTo(g.x(b.cx + seam), g.y(topUp + b.ry * lid.seamReach));
      ctx.lineTo(g.x(b.cx + seam), g.y(topUp - b.ry * lid.seamReach));
      ctx.stroke();
    }
    ellipseT(ctx, g, b.cx + b.bung.dx, topUp + b.bung.du, b.bung.rx, b.bung.ry);
    fillInked(ctx, g, BRASS.light);
    return;
  }
  const water = b.water;
  const waterRx = b.rx - water.inset;
  const waterRy = b.ry - water.insetDepth;
  ellipseT(ctx, g, b.cx, topUp - water.drop, waterRx, waterRy);
  ctx.fillStyle = WATER.body;
  ctx.fill();
  litSpot(ctx, g, b.cx, topUp - water.drop, waterRx, waterRy, WATER.glint, SHEEN.strong);
  const [fromDx, fromDu] = b.dipper.from;
  const [toDx, toDu] = b.dipper.to;
  strut(
    ctx,
    g,
    b.cx + fromDx,
    topUp + fromDu,
    b.cx + toDx,
    topUp + toDu,
    b.dipper.width,
    WOOD_TONE,
  );
}

function paintLyingBarrel(ctx: Ctx, g: Grid, rng: Rng): void {
  const l = BARREL.lying;
  const chocks = BARREL.chocks;
  const middleX = (l.x0 + l.x1) / 2;
  shadow(ctx, g, middleX, l.shadowUp, l.shadowRx, l.shadowRy);
  for (const chockX of chocks.x) {
    polygon(ctx, [
      [g.x(chockX - chocks.halfWidth), g.y(chocks.foot)],
      [g.x(chockX), g.y(chocks.peak)],
      [g.x(chockX + chocks.halfWidth), g.y(chocks.foot)],
    ]);
    fillInked(ctx, g, WOOD.dark);
  }
  const top = l.axisUp + l.radius;
  const bottom = l.axisUp - l.radius;
  const swell = BARREL.bulge * 2;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(l.x0), g.y(top - l.endTaper));
    ctx.quadraticCurveTo(g.x(middleX), g.y(top + swell), g.x(l.x1), g.y(top - l.endTaper));
    ctx.lineTo(g.x(l.x1), g.y(bottom + l.endTaper));
    ctx.quadraticCurveTo(g.x(middleX), g.y(bottom - swell), g.x(l.x0), g.y(bottom + l.endTaper));
    ctx.closePath();
  };
  trace();
  const gradient = ctx.createLinearGradient(0, g.y(top), 0, g.y(bottom));
  gradient.addColorStop(0, WOOD.body);
  gradient.addColorStop(ROUND_LIT_STOP, WOOD.light);
  gradient.addColorStop(ROUND_BODY_STOP, WOOD.body);
  gradient.addColorStop(1, WOOD.dark);
  fillInked(ctx, g, gradient);
  withClip(ctx, trace, () => {
    ctx.strokeStyle = WOOD.dark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const stave of STAVE_POSITIONS) {
      const staveUp = l.axisUp + stave * l.radius;
      ctx.beginPath();
      ctx.moveTo(g.x(l.x0), g.y(staveUp));
      ctx.quadraticCurveTo(
        g.x(middleX),
        g.y(staveUp + stave * swell + jitter(rng, BARREL.staveJitter)),
        g.x(l.x1),
        g.y(staveUp),
      );
      ctx.stroke();
    }
    for (const hoop of BARREL.hoops) {
      const hoopX = l.x0 + hoop * (l.x1 - l.x0);
      rectT(
        ctx,
        g,
        hoopX - BARREL.hoopWidth / 2,
        bottom - l.hoopOverhang,
        hoopX + BARREL.hoopWidth / 2,
        top + l.hoopOverhang,
      );
      ctx.fillStyle = BRASS.body;
      ctx.fill();
      outline(ctx, g, g.ink * FINE_LINE_SHARE);
    }
  });
  const headRy = l.radius - l.headInset;
  ellipseT(ctx, g, l.x1, l.axisUp, l.endRx, headRy);
  fillInked(ctx, g, WOOD.mid);
  ctx.strokeStyle = BRASS.body;
  ctx.lineWidth = Math.max(1, g.ink);
  ctx.beginPath();
  ctx.ellipse(
    g.x(l.x1),
    g.y(l.axisUp),
    g.s(l.endRx * l.headRing),
    g.s(headRy * l.headRing),
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
  const tapUp = l.axisUp - l.tapDrop;
  strut(ctx, g, l.x1, tapUp, l.x1 + l.tapReach, tapUp, l.tapWidth, BRASS_TONE);
  strut(
    ctx,
    g,
    l.x1 + l.spoutX,
    tapUp,
    l.x1 + l.spoutX,
    tapUp - l.spoutDrop,
    l.spoutWidth,
    BRASS_TONE,
  );
}

// ── Sack ──────────────────────────────────────────────────────────────────────

/**
 * Variant 0: one tied burlap sack. Variant 1: a pair, one slumped against the
 * other. Variant 2: an open sack with its mouth rolled down, grain spilled
 * round its foot.
 */
interface SackSpec {
  readonly cx: number;
  readonly ground: number;
  readonly halfWidth: number;
  readonly height: number;
  readonly tied: boolean;
  readonly lean: number;
}

const SACK = {
  shadowUp: 0.38,
  shadowRx: 0.44,
  shadowRy: 0.24,
  single: { cx: 0.5, ground: 0.3, halfWidth: 0.3, height: 0.66, tied: true, lean: 0.03 },
  pairBack: { cx: 0.36, ground: 0.46, halfWidth: 0.24, height: 0.6, tied: true, lean: -0.02 },
  pairFront: { cx: 0.64, ground: 0.2, halfWidth: 0.28, height: 0.44, tied: true, lean: 0.1 },
  open: { cx: 0.44, ground: 0.32, halfWidth: 0.3, height: 0.5, tied: false, lean: 0 },
  spill: { x: 0.64, up: 0.22, rx: 0.24, ry: 0.09, strokes: 20, stroke: 0.025 },
} as const;

/** A sack's outline, as shares of its half width and height. */
const SACK_SHAPE = {
  shoulder: 0.72,
  neckHalf: 0.4,
  bellyReach: 1.05,
  /** How far the sack's foot sits above its lowest point, which bulges down. */
  footLift: 0.06,
  bellyDrop: 0.08,
  creases: [0.35, 0.62],
  creaseReachWest: 0.6,
  creaseReachEast: 0.5,
  creaseJitter: 0.02,
  creaseSag: 0.05,
  creaseRise: 0.02,
  stripeAt: 0.5,
  stripeWidth: 0.05,
  stripeAlpha: 0.8,
} as const;
/** The gathered, tied neck: offsets in tiles from the neck's centre. */
const SACK_NECK = {
  outline: [
    [-0.06, 0],
    [-0.1, 0.12],
    [0.12, 0.1],
    [0.06, 0],
  ],
  cordHalf: 0.08,
  cordLift: 0.01,
  cordWidth: 0.04,
} as const;
/** An open sack's rolled rim and the grain heaped in its mouth, as shares of its half width. */
const SACK_MOUTH = {
  rimShare: 0.62,
  rimRy: 0.08,
  grainShare: 0.5,
  grainRy: 0.055,
  grainLift: 0.01,
};
const MADDER_TONE: Tone = {
  lit: CLOTH.madder.light,
  body: CLOTH.madder.body,
  shade: CLOTH.madder.dark,
};

function paintSack(ctx: Ctx, g: Grid, variant: number, rng: Rng): void {
  const s = SACK;
  shadow(ctx, g, 1 / 2, s.shadowUp, s.shadowRx, s.shadowRy);
  if (variant === 0) {
    paintOneSack(ctx, g, s.single, rng);
    return;
  }
  if (variant === 1) {
    paintOneSack(ctx, g, s.pairBack, rng);
    paintOneSack(ctx, g, s.pairFront, rng);
    return;
  }
  const spill = s.spill;
  ellipseT(ctx, g, spill.x, spill.up, spill.rx, spill.ry);
  fillInked(ctx, g, CLOTH.weld.body);
  strawStrokes(
    ctx,
    {
      x: g.x(spill.x - spill.rx),
      y: g.y(spill.up + spill.ry),
      w: g.s(spill.rx * 2),
      h: g.s(spill.ry * 2),
    },
    forkRng(rng),
    spill.strokes,
    g.s(spill.stroke),
    [CLOTH.weld.light, CLOTH.weld.dark],
  );
  paintOneSack(ctx, g, s.open, rng);
}

function paintOneSack(ctx: Ctx, g: Grid, sack: SackSpec, rng: Rng): void {
  const k = SACK_SHAPE;
  const { cx, ground, halfWidth, height, lean } = sack;
  const shoulder = ground + height * k.shoulder;
  const neckUp = ground + height;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(g.x(cx - halfWidth * k.neckHalf + lean), g.y(neckUp));
    ctx.quadraticCurveTo(
      g.x(cx - halfWidth * k.bellyReach + lean / 2),
      g.y(shoulder),
      g.x(cx - halfWidth),
      g.y(ground + k.footLift),
    );
    ctx.quadraticCurveTo(
      g.x(cx),
      g.y(ground - k.bellyDrop),
      g.x(cx + halfWidth),
      g.y(ground + k.footLift),
    );
    ctx.quadraticCurveTo(
      g.x(cx + halfWidth * k.bellyReach + lean / 2),
      g.y(shoulder),
      g.x(cx + halfWidth * k.neckHalf + lean),
      g.y(neckUp),
    );
    ctx.closePath();
  };
  trace();
  fillInked(ctx, g, roundShade(ctx, g, cx - halfWidth, cx + halfWidth, BURLAP_TONE));
  withClip(ctx, trace, () => {
    ctx.strokeStyle = BURLAP.dark;
    ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
    for (const crease of k.creases) {
      const creaseUp = ground + height * crease;
      ctx.beginPath();
      ctx.moveTo(
        g.x(cx - halfWidth * k.creaseReachWest),
        g.y(creaseUp + jitter(rng, k.creaseJitter)),
      );
      ctx.quadraticCurveTo(
        g.x(cx),
        g.y(creaseUp - k.creaseSag),
        g.x(cx + halfWidth * k.creaseReachEast),
        g.y(creaseUp + k.creaseRise),
      );
      ctx.stroke();
    }
    // A woad stripe woven round the sack: the household's mark.
    ctx.fillStyle = CLOTH.woad.body;
    ctx.globalAlpha = k.stripeAlpha;
    // The stripe is clipped to the sack, so it only has to be wide enough to cross it.
    const stripeHalf = halfWidth * k.bellyReach + Math.abs(lean);
    ctx.fillRect(
      g.x(cx - stripeHalf),
      g.y(ground + height * k.stripeAt),
      g.s(stripeHalf * 2),
      g.s(k.stripeWidth),
    );
    ctx.globalAlpha = 1;
  });
  if (sack.tied) {
    polygon(
      ctx,
      SACK_NECK.outline.map(([dx, du]): Point => [g.x(cx + lean + dx), g.y(neckUp + du)]),
    );
    fillInked(ctx, g, BURLAP.light);
    const cordUp = neckUp + SACK_NECK.cordLift;
    strut(
      ctx,
      g,
      cx + lean - SACK_NECK.cordHalf,
      cordUp,
      cx + lean + SACK_NECK.cordHalf,
      cordUp,
      SACK_NECK.cordWidth,
      MADDER_TONE,
    );
    return;
  }
  const mouth = SACK_MOUTH;
  ellipseT(ctx, g, cx, neckUp, halfWidth * mouth.rimShare, mouth.rimRy);
  fillInked(ctx, g, BURLAP.light);
  const grainRx = halfWidth * mouth.grainShare;
  ellipseT(ctx, g, cx, neckUp + mouth.grainLift, grainRx, mouth.grainRy);
  ctx.fillStyle = CLOTH.weld.body;
  ctx.fill();
  litSpot(
    ctx,
    g,
    cx,
    neckUp + mouth.grainLift,
    grainRx,
    mouth.grainRy,
    CLOTH.weld.light,
    SHEEN.strong,
  );
}

// ── Bucket ────────────────────────────────────────────────────────────────────

/** A big stave bucket of water with a dipper leaning against it. */
const BUCKET_PROP = {
  cx: 0.42,
  ground: 0.4,
  dipper: {
    handleFrom: [0.62, 0.26],
    handleTo: [0.9, 0.44],
    handleWidth: 0.04,
    bowlX: 0.62,
    bowlUp: 0.22,
    bowlRx: 0.08,
    bowlRy: 0.045,
  },
} as const;

function paintBucketProp(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const b = BUCKET_PROP;
  paintBucket(ctx, g, b.cx, b.ground, BUCKET_LARGE, forkRng(rng), true);
  const d = b.dipper;
  const [fromX, fromUp] = d.handleFrom;
  const [toX, toUp] = d.handleTo;
  strut(ctx, g, fromX, fromUp, toX, toUp, d.handleWidth, WOOD_TONE);
  ellipseT(ctx, g, d.bowlX, d.bowlUp, d.bowlRx, d.bowlRy);
  fillInked(ctx, g, WOOD.mid);
}

// ── Carts ─────────────────────────────────────────────────────────────────────

/** A spoked cart wheel in the screen plane: rim, hub, eight spokes, some possibly missing. */
function paintWheel(
  ctx: Ctx,
  g: Grid,
  cx: number,
  up: number,
  radius: number,
  missingSpokes: ReadonlyArray<number>,
  tone: Tone = WOOD_TONE,
  squash = 1,
): void {
  const px = g.x(cx);
  const py = g.y(up);
  const r = g.s(radius);
  const rim = r * WHEEL_RIM_SHARE;
  const inner = r - rim;
  ctx.beginPath();
  ctx.ellipse(px, py, r * squash, r, 0, 0, TWO_PI);
  ctx.ellipse(px, py, inner * squash, inner, 0, 0, TWO_PI, true);
  ctx.fillStyle = tone.body;
  ctx.fill('evenodd');
  outline(ctx, g);
  ctx.beginPath();
  ctx.ellipse(px, py, inner * squash, inner, 0, 0, TWO_PI);
  outline(ctx, g, g.ink * FINE_LINE_SHARE);
  const tyre = r - rim * WHEEL_TYRE_INSET;
  ctx.beginPath();
  ctx.ellipse(px, py, tyre * squash, tyre, 0, WHEEL_LIT_ARC_FROM, WHEEL_LIT_ARC_TO);
  ctx.strokeStyle = tone.lit;
  ctx.lineWidth = Math.max(1, rim * WHEEL_TYRE_INSET);
  ctx.stroke();
  const hub = r * WHEEL_HUB_SHARE;
  for (let spoke = 0; spoke < WHEEL_SPOKES; spoke++) {
    if (missingSpokes.includes(spoke)) continue;
    const angle = (spoke / WHEEL_SPOKES) * TWO_PI + WHEEL_SPOKE_PHASE;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(angle) * hub * squash, py + Math.sin(angle) * hub);
    ctx.lineTo(px + Math.cos(angle) * inner * squash, py + Math.sin(angle) * inner);
    ctx.strokeStyle = INK;
    ctx.lineWidth = rim * WHEEL_SPOKE_SHARE + g.ink;
    ctx.stroke();
    ctx.strokeStyle = tone.body;
    ctx.lineWidth = rim * WHEEL_SPOKE_SHARE;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(px, py, hub * squash, hub, 0, 0, TWO_PI);
  fillInked(ctx, g, tone.lit);
  ctx.beginPath();
  ctx.ellipse(px, py, hub * WHEEL_CAP_SHARE * squash, hub * WHEEL_CAP_SHARE, 0, 0, TWO_PI);
  ctx.fillStyle = BRASS.body;
  ctx.fill();
}
const WHEEL_RIM_SHARE = 0.16;
const WHEEL_HUB_SHARE = 0.24;
/** The brass cap on the hub, as a share of the hub. */
const WHEEL_CAP_SHARE = 0.4;
const WHEEL_SPOKES = 8;
const WHEEL_SPOKE_PHASE = 0.2;
const WHEEL_SPOKE_SHARE = 0.55;
/** The tyre's lit arc: its inset into the rim, and the angles it spans (upper left). */
const WHEEL_TYRE_INSET = 0.3;
const WHEEL_LIT_ARC_FROM = Math.PI * 1.05;
const WHEEL_LIT_ARC_TO = Math.PI * 1.55;

/**
 * A cart's bed in 3/4 view. Its end boards are edge-on in this projection, so
 * the bed is three faces: the far side's inner face, the floor, and the near
 * side's outer face. `nearSide` says how much of the near side is boarded.
 */
interface CartBed {
  readonly x0: number;
  readonly x1: number;
  /** Ground depth of the near side. */
  readonly front: number;
  readonly depth: number;
  readonly floorHeight: number;
  readonly sideHeight: number;
}

type NearSide = 'boarded' | 'bottom_plank';

const CART_BOARD_TILES = 0.08;
/** Floor boards run front to back and are cut wider than the side boards. */
const CART_FLOOR_BOARD_TILES = 0.12;
const CART_POST_TILES = 0.05;
const CART_POST_OVERHANG_TILES = 0.03;

function paintCartBed(
  ctx: Ctx,
  g: Grid,
  bed: CartBed,
  rng: Rng,
  nearSide: NearSide,
  paintLoad: (() => void) | null,
): void {
  const width = bed.x1 - bed.x0;
  const floorFront = bed.front + bed.floorHeight;
  const floorBack = floorFront + bed.depth;
  const farTop = floorBack + bed.sideHeight;
  const nearTop = floorFront + bed.sideHeight;
  drawPlanks(ctx, g.x(bed.x0), g.y(farTop), g.s(width), g.s(bed.sideHeight), forkRng(rng), {
    direction: 'horizontal',
    boardPx: g.s(CART_BOARD_TILES),
    base: WOOD.dark,
    nailChance: 0,
  });
  drawPlanks(ctx, g.x(bed.x0), g.y(floorBack), g.s(width), g.s(bed.depth), forkRng(rng), {
    direction: 'vertical',
    boardPx: g.s(CART_FLOOR_BOARD_TILES),
    base: WOOD.mid,
  });
  rectT(ctx, g, bed.x0, floorFront, bed.x1, farTop);
  outline(ctx, g);
  paintLoad?.();
  const plankTop = nearSide === 'boarded' ? nearTop : floorFront + CART_BOARD_TILES;
  drawPlanks(
    ctx,
    g.x(bed.x0),
    g.y(plankTop),
    g.s(width),
    g.s(plankTop - floorFront),
    forkRng(rng),
    { direction: 'horizontal', boardPx: g.s(CART_BOARD_TILES), base: WOOD.body },
  );
  rectT(ctx, g, bed.x0, floorFront, bed.x1, plankTop);
  outline(ctx, g);
  const posts = [bed.x0 + CART_POST_TILES / 2, (bed.x0 + bed.x1) / 2, bed.x1 - CART_POST_TILES / 2];
  for (const postX of posts) {
    strut(
      ctx,
      g,
      postX,
      floorFront - CART_POST_OVERHANG_TILES,
      postX,
      nearTop + CART_POST_OVERHANG_TILES,
      CART_POST_TILES,
    );
  }
  if (nearSide === 'boarded') {
    strut(ctx, g, bed.x0, nearTop, bed.x1, nearTop, CART_POST_TILES, WOOD_TONE);
  }
}

/**
 * Wicker's cart: the bed propped on a trestle where its near wheel should be,
 * its near side still unboarded above the first plank, the wheel leaning on
 * its east end, and fresh boards leaning against its west end with a mallet at
 * their foot.
 */
const HALF_BUILT_CART = {
  bed: { x0: 0.4, x1: 1.5, front: 0.36, depth: 0.42, floorHeight: 0.34, sideHeight: 0.22 },
  shadowRx: 0.94,
  shadowRy: 0.34,
  axleX: 0.95,
  wheelRadius: 0.4,
  leaningWheelX: 1.7,
  leaningWheelRadius: 0.3,
  leaningWheelGround: 0.3,
  trestleHalfFoot: 0.16,
  trestleHalfTop: 0.08,
  trestleBeamShare: 1.4,
  /** Boards leaning on the bed's west end: foot and top, in tiles. */
  leaningBoards: [
    { foot: [0.12, 0.2], top: [0.4, 0.86], width: 0.1 },
    { foot: [0.2, 0.16], top: [0.44, 0.8], width: 0.1 },
  ],
  malletHead: { x0: 0.26, x1: 0.4, front: 0.04, depth: 0.08, height: 0.08 },
  malletHandleTo: [0.62, 0.14],
  malletHandleShare: 0.7,
} as const;
const FRESH_BOARD_TONE: Tone = { lit: WOOD.worn, body: WOOD.highlight, shade: WOOD.light };

function paintHalfBuiltCart(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const c = HALF_BUILT_CART;
  const bed = c.bed;
  const floorFront = bed.front + bed.floorHeight;
  const farGround = bed.front + bed.depth;
  shadow(ctx, g, 1, bed.front + bed.depth / 2, c.shadowRx, c.shadowRy);
  paintWheel(ctx, g, c.axleX, farGround + c.wheelRadius, c.wheelRadius, [], DARK_WOOD_TONE);
  paintCartBed(ctx, g, bed, rng, 'bottom_plank', null);
  const trestleFoot = bed.front - CART_POST_OVERHANG_TILES;
  polygon(ctx, [
    [g.x(c.axleX - c.trestleHalfFoot), g.y(trestleFoot)],
    [g.x(c.axleX - c.trestleHalfTop), g.y(floorFront)],
    [g.x(c.axleX + c.trestleHalfTop), g.y(floorFront)],
    [g.x(c.axleX + c.trestleHalfFoot), g.y(trestleFoot)],
  ]);
  fillInked(ctx, g, WOOD.dark);
  strut(
    ctx,
    g,
    c.axleX - c.trestleHalfFoot,
    floorFront,
    c.axleX + c.trestleHalfFoot,
    floorFront,
    CART_POST_TILES * c.trestleBeamShare,
  );
  ellipseT(ctx, g, c.axleX, floorFront - CART_BOARD_TILES, CART_POST_TILES, CART_POST_TILES);
  fillInked(ctx, g, IRON.light);
  paintWheel(
    ctx,
    g,
    c.leaningWheelX,
    c.leaningWheelGround + c.leaningWheelRadius,
    c.leaningWheelRadius,
    [],
    WOOD_TONE,
    WHEEL_LEAN_SQUASH,
  );
  for (const board of c.leaningBoards) {
    const [footX, footUp] = board.foot;
    const [topX, topUp] = board.top;
    strut(ctx, g, footX, footUp, topX, topUp, board.width, FRESH_BOARD_TONE);
  }
  const head = c.malletHead;
  const [handleX, handleUp] = c.malletHandleTo;
  strut(
    ctx,
    g,
    head.x1,
    head.front + head.height / 2,
    handleX,
    handleUp,
    CART_POST_TILES * c.malletHandleShare,
  );
  plankBox(ctx, g, head, forkRng(rng), head.height, WOOD.mid, WOOD.body);
}
const WHEEL_LEAN_SQUASH = 0.55;

/**
 * The quarry's wrecked cart: tipped onto its west end where the near wheel
 * broke away, half its load of stone spilled on the ground, the broken wheel
 * lying flat in front with its spokes gone.
 */
const BROKEN_CART = {
  bed: { x0: 0.22, x1: 1.4, front: 0.34, depth: 0.42, floorHeight: 0.3, sideHeight: 0.24 },
  tilt: -0.2,
  shadowX: 0.9,
  shadowUp: 0.5,
  shadowRx: 0.9,
  shadowRy: 0.34,
  /** A board split away from the near side and hanging, in the tipped bed's own tiles. */
  splitBoard: [
    [1.0, 0.86],
    [1.14, 0.86],
    [1.2, 0.52],
    [1.1, 0.58],
  ],
  farWheelX: 1.12,
  farWheelRadius: 0.32,
  lyingWheelX: 1.6,
  lyingWheelUp: 0.2,
  lyingWheelRadius: 0.16,
  lyingWheelSquash: 1.8,
  brokenSpokes: [1, 2, 5],
  shaftFrom: [0.1, 0.2],
  shaftTo: [0.66, 0.1],
  shaftWidth: 0.06,
} as const;

/** Stones heaped on the bed's floor, then spilled on the ground at its low end: x, up, radius. */
const CART_LOAD_STONES: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.92, 0.09],
  [0.7, 0.96, 0.08],
  [0.9, 0.98, 0.09],
  [0.62, 0.84, 0.08],
];
const SPILLED_STONES: ReadonlyArray<readonly [number, number, number]> = [
  [0.16, 0.36, 0.09],
  [0.15, 0.16, 0.08],
  [0.28, 0.12, 0.07],
  [0.9, 0.12, 0.06],
];

function paintBrokenCart(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const c = BROKEN_CART;
  const bed = c.bed;
  shadow(ctx, g, c.shadowX, c.shadowUp, c.shadowRx, c.shadowRy);
  const farGround = bed.front + bed.depth;
  paintWheel(
    ctx,
    g,
    c.farWheelX,
    farGround + c.farWheelRadius,
    c.farWheelRadius,
    [],
    DARK_WOOD_TONE,
  );
  const stoneRng = forkRng(rng);
  const paintStone = ([sx, su, r]: readonly [number, number, number]): void => {
    ellipseT(ctx, g, sx, su, r, r * STONE_SQUASH);
    fillInked(ctx, g, stoneRng() < STONE_LIGHT_CHANCE ? STONE.light : STONE.body);
    litSpot(ctx, g, sx, su, r, r * STONE_SQUASH, STONE.highlight, SHEEN.soft);
  };
  const pivotX = g.x(bed.x0);
  const pivotY = g.y(bed.front + bed.floorHeight);
  ctx.save();
  try {
    ctx.translate(pivotX, pivotY);
    ctx.rotate(c.tilt);
    ctx.translate(-pivotX, -pivotY);
    paintCartBed(ctx, g, bed, rng, 'boarded', () => {
      for (const stone of CART_LOAD_STONES) paintStone(stone);
    });
    polygon(
      ctx,
      c.splitBoard.map(([x, up]): Point => [g.x(x), g.y(up)]),
    );
    fillInked(ctx, g, WOOD.light);
  } finally {
    ctx.restore();
  }
  for (const stone of SPILLED_STONES) paintStone(stone);
  const [fromX, fromUp] = c.shaftFrom;
  const [toX, toUp] = c.shaftTo;
  strut(ctx, g, fromX, fromUp, toX, toUp, c.shaftWidth);
  paintWheel(
    ctx,
    g,
    c.lyingWheelX,
    c.lyingWheelUp,
    c.lyingWheelRadius,
    c.brokenSpokes,
    WOOD_TONE,
    c.lyingWheelSquash,
  );
}
const STONE_SQUASH = 0.75;
const STONE_LIGHT_CHANCE = 0.5;

// ── Sawmill ───────────────────────────────────────────────────────────────────

/**
 * The lumber yard's hero piece, three tiles deep. It stands indoors, so it is
 * driven by foot rather than water: at the back a heavy flywheel turns in a
 * braced log frame, cranked by a pitman rod from a foot treadle on the floor,
 * and a belt runs from its hub down to the saw arbor. In front a heavy plank
 * saw bench carries a log on a railed carriage into a circular blade, painted
 * still and centred on `SAWMILL_BLADE` — the working blur is drawn over it
 * live.
 */
const SAWMILL = {
  shadowUp: 1.5,
  shadowRx: 0.96,
  shadowRy: 1.4,
  bench: { x0: 0.06, x1: 1.94, front: 0.3, depth: 1.3, height: 0.5 },
  benchBoard: 0.16,
  legInset: 0.1,
  legWidth: 0.12,
  legSink: 0.02,
  /** The skirt under the bench top and the dark recess behind it. */
  skirtInset: 0.2,
  skirtDepth: 0.16,
  apronDrop: 0.08,
  apronWidth: 0.14,
  stretcherUp: 0.12,
  stretcherWidth: 0.06,
  /** The blade's plane sits this deep in the bench, which fixes its slot line. */
  bladeDepth: 1.0,
  slotOverhang: 0.04,
  slotHalfWidth: 0.025,
  arbor: { depthBehindSlot: 0.52, top: 2.52, width: 0.14, capHalf: 0.1, capHeight: 0.12 },
  drive: {
    ground: 2.4,
    postX: [0.34, 1.66],
    postTop: 3.5,
    postWidth: 0.12,
    legFootX: [0.14, 1.86],
    legFootDrop: 0.1,
    legTopDrop: 0.2,
    legWidth: 0.08,
    axleBeam: 0.07,
  },
  flywheel: { x: 1, up: 3.12, radius: 0.52, tyreWidth: 0.04 },
  crankPin: [1.2, 2.98],
  crankWidth: 0.045,
  pinRadius: 0.035,
  rodWidth: 0.05,
  treadle: {
    hinge: { x0: 0.36, x1: 0.5, front: 2.36, depth: 0.12, height: 0.06, board: 0.06 },
    from: [0.44, 2.44],
    to: [1.36, 2.52],
    width: 0.13,
    worn: { x: 1.2, up: 2.51, rx: 0.12, ry: 0.04 },
  },
  beltHalfGap: 0.06,
  beltTaper: 0.6,
  beltWidth: 0.035,
  rails: { ups: [1.56, 1.9], inset: 0.04, width: 0.04 },
  carriage: { x0: 0.1, x1: 0.6, drop: 0.04, height: 0.06, board: 0.08 },
  log: { x0: 0.1, x1: 0.96, up: 1.72, radius: 0.2 },
  dogs: { x: [0.2, 0.48], below: 0.02, riseShare: 0.5, lean: 0.03, width: 0.035 },
  sawnBoard: { x0: 1.46, x1: 1.9, front: 0.94, depth: 0.2, height: 0.05, board: 0.1 },
  stack: { x0: 1.5, x1: 1.9, front: 1.3, depth: 0.3, board: 0.05, boards: 3, stagger: 0.04 },
  lever: { footX: 1.78, footUp: 0.9, topX: 1.86, topUp: 1.34, width: 0.05, knob: 0.05 },
  lantern: { hookX: 0.16, hookUp: 3.44, size: 0.3, bracketLift: 0.02, bracketReach: 0.03 },
  bracketWidth: 0.035,
  sawdust: [
    [1.0, 1.02, 0.22, 0.06],
    [1.28, 0.9, 0.12, 0.04],
    [0.96, 0.15, 0.3, 0.09],
    [1.3, 0.1, 0.14, 0.05],
    [0.7, 0.1, 0.1, 0.04],
  ],
} as const;
const BELT = { body: '#3a2a1c', light: '#5a4430' } as const;
const BELT_TONE: Tone = { lit: BELT.light, body: BELT.body, shade: BELT.body };
const TREADLE_TONE: Tone = { lit: WOOD.highlight, body: WOOD.light, shade: WOOD.mid };

function paintSawmill(ctx: Ctx, g: Grid, _variant: number, rng: Rng): void {
  const s = SAWMILL;
  shadow(ctx, g, 1, s.shadowUp, s.shadowRx, s.shadowRy);
  paintTreadleDrive(ctx, g, rng);

  const bladeX = SAWMILL_BLADE.x;
  for (const offset of [-s.beltHalfGap, s.beltHalfGap]) {
    strut(
      ctx,
      g,
      bladeX + offset,
      s.flywheel.up,
      bladeX + offset * s.beltTaper,
      SAWMILL_BLADE.up,
      s.beltWidth,
      BELT_TONE,
    );
  }

  paintSawBench(ctx, g, rng);
  paintCarriage(ctx, g, rng);

  const slotUp = s.bladeDepth + s.bench.height;
  const bladeR = SAWMILL_BLADE_RADIUS_TILES;
  rectT(
    ctx,
    g,
    bladeX - bladeR - s.slotOverhang,
    slotUp - s.slotHalfWidth,
    bladeX + bladeR + s.slotOverhang,
    slotUp + s.slotHalfWidth,
  );
  ctx.fillStyle = HOLLOW_SHADE;
  ctx.fill();
  paintSawBlade(ctx, g, bladeX, SAWMILL_BLADE.up, bladeR);

  const sawn = s.sawnBoard;
  plankBox(ctx, g, sawn, forkRng(rng), sawn.board, WOOD.worn, WOOD.light);
  for (const [driftX, driftUp, rx, ry] of s.sawdust) {
    ellipseT(ctx, g, driftX, driftUp, rx, ry);
    ctx.fillStyle = SAWDUST.body;
    ctx.fill();
    litSpot(ctx, g, driftX, driftUp, rx, ry, SAWDUST.light, SHEEN.strong);
  }
  const stack = s.stack;
  for (let board = 0; board < stack.boards; board++) {
    const shift = board % 2 === 0 ? 0 : stack.stagger;
    plankBox(
      ctx,
      g,
      {
        x0: stack.x0 + shift,
        x1: stack.x1 - stack.stagger + shift,
        front: stack.front + board * stack.board,
        depth: stack.depth,
        height: stack.board,
      },
      forkRng(rng),
      stack.depth / 2,
      WOOD.highlight,
      WOOD.light,
    );
  }
  const lever = s.lever;
  strut(ctx, g, lever.footX, lever.footUp, lever.topX, lever.topUp, lever.width, IRON_TONE);
  ellipseT(ctx, g, lever.topX, lever.topUp, lever.knob, lever.knob);
  fillInked(ctx, g, BRASS.light);

  const lantern = s.lantern;
  lanternAt(ctx, g, lantern.hookX, lantern.hookUp, lantern.size);
  strut(
    ctx,
    g,
    s.drive.postX[0],
    lantern.hookUp + lantern.bracketLift,
    lantern.hookX + lantern.bracketReach,
    lantern.hookUp + lantern.bracketLift,
    s.bracketWidth,
    IRON_TONE,
  );
}

/**
 * The drive behind the bench: a braced log frame carrying the flywheel, the
 * crank and pitman rod down to the foot treadle, whose far end is worn pale
 * where the sawyer's foot works it.
 */
function paintTreadleDrive(ctx: Ctx, g: Grid, rng: Rng): void {
  const s = SAWMILL;
  const d = s.drive;
  const wheel = s.flywheel;
  const [westPost, eastPost] = d.postX;
  const [westFoot, eastFoot] = d.legFootX;
  strut(ctx, g, westFoot, d.ground - d.legFootDrop, westPost, d.postTop - d.legTopDrop, d.legWidth);
  strut(ctx, g, eastFoot, d.ground - d.legFootDrop, eastPost, d.postTop - d.legTopDrop, d.legWidth);
  for (const postX of d.postX) logPost(ctx, g, postX, d.ground, d.postTop, d.postWidth);
  strut(ctx, g, westPost, wheel.up, eastPost, wheel.up, d.axleBeam, DARK_WOOD_TONE);

  const treadle = s.treadle;
  plankBox(ctx, g, treadle.hinge, forkRng(rng), treadle.hinge.board, WOOD.mid, WOOD.dark);
  const [fromX, fromUp] = treadle.from;
  const [toX, toUp] = treadle.to;
  strut(ctx, g, fromX, fromUp, toX, toUp, treadle.width, TREADLE_TONE);
  const worn = treadle.worn;
  sheen(ctx, g, worn.x, worn.up, worn.rx, worn.ry, WOOD.worn, SHEEN.strong);

  paintWheel(ctx, g, wheel.x, wheel.up, wheel.radius, [], WOOD_TONE);
  // An iron tyre: the flywheel's weight is what keeps the blade turning between strokes.
  ctx.beginPath();
  ctx.arc(g.x(wheel.x), g.y(wheel.up), g.s(wheel.radius), 0, TWO_PI);
  ctx.strokeStyle = IRON.body;
  ctx.lineWidth = g.s(wheel.tyreWidth);
  ctx.stroke();
  outline(ctx, g, g.ink * FINE_LINE_SHARE);

  const [pinX, pinUp] = s.crankPin;
  strut(ctx, g, wheel.x, wheel.up, pinX, pinUp, s.crankWidth, IRON_TONE);
  strut(ctx, g, pinX, pinUp, toX, toUp, s.rodWidth, WOOD_TONE);
  ellipseT(ctx, g, pinX, pinUp, s.pinRadius, s.pinRadius);
  fillInked(ctx, g, BRASS.light);
}

function paintSawBench(ctx: Ctx, g: Grid, rng: Rng): void {
  const s = SAWMILL;
  const bench = s.bench;
  const topUp = bench.front + bench.height;
  const legXs = [bench.x0 + s.legInset, bench.x1 - s.legInset] as const;
  for (const legX of legXs) {
    strut(
      ctx,
      g,
      legX,
      bench.front + bench.depth,
      legX,
      bench.front + bench.depth + bench.height,
      s.legWidth,
      DARK_WOOD_TONE,
    );
  }
  const faces = plankBox(ctx, g, bench, forkRng(rng), s.benchBoard, WOOD.body, WOOD.dark);
  // The front is only a skirt under the top: between the legs it opens into shade.
  const skirt = g.s(s.skirtDepth);
  const inset = g.s(s.skirtInset);
  ctx.fillStyle = HOLLOW_SHADE;
  ctx.fillRect(
    faces.front.x + inset,
    faces.front.y + skirt,
    faces.front.w - inset * 2,
    faces.front.h - skirt,
  );
  for (const legX of legXs) {
    strut(ctx, g, legX, bench.front - s.legSink, legX, topUp - s.legSink * 2, s.legWidth);
  }
  strut(
    ctx,
    g,
    bench.x0 + s.legSink,
    topUp - s.apronDrop,
    bench.x1 - s.legSink,
    topUp - s.apronDrop,
    s.apronWidth,
  );
  const [westLeg, eastLeg] = legXs;
  const stretcherUp = bench.front + s.stretcherUp;
  strut(ctx, g, westLeg, stretcherUp, eastLeg, stretcherUp, s.stretcherWidth, DARK_WOOD_TONE);
  const arbor = s.arbor;
  const bladeX = SAWMILL_BLADE.x;
  const slotUp = s.bladeDepth + bench.height;
  strut(ctx, g, bladeX, slotUp + arbor.depthBehindSlot, bladeX, arbor.top, arbor.width);
  rectT(
    ctx,
    g,
    bladeX - arbor.capHalf,
    arbor.top - arbor.capHeight,
    bladeX + arbor.capHalf,
    arbor.top,
  );
  fillInked(ctx, g, BRASS.body);
}

/** The rails, the carriage riding them and the log clamped to it, its end at the blade. */
function paintCarriage(ctx: Ctx, g: Grid, rng: Rng): void {
  const s = SAWMILL;
  const rails = s.rails;
  for (const railUp of rails.ups) {
    strut(
      ctx,
      g,
      s.bench.x0 + rails.inset,
      railUp,
      s.bench.x1 - rails.inset,
      railUp,
      rails.width,
      IRON_TONE,
    );
  }
  const [nearRail, farRail] = rails.ups;
  const carriage = s.carriage;
  plankBox(
    ctx,
    g,
    {
      x0: carriage.x0,
      x1: carriage.x1,
      front: nearRail - carriage.drop,
      depth: farRail - nearRail,
      height: carriage.height,
    },
    forkRng(rng),
    carriage.board,
    WOOD.light,
    WOOD.dark,
  );
  const log = s.log;
  drawLogSide(ctx, g, log.x0, log.up, log.x1 - log.x0, log.radius, forkRng(rng));
  const dogs = s.dogs;
  for (const dogX of dogs.x) {
    strut(
      ctx,
      g,
      dogX,
      log.up - log.radius - dogs.below,
      dogX + dogs.lean,
      log.up + log.radius * dogs.riseShare,
      dogs.width,
      IRON_TONE,
    );
  }
}

/**
 * A still circular blade: a plate darker than polished steel so it does not
 * outshine the whole yard, hooked teeth, a ring where the plate is set, one
 * soft glint, and the brass arbor nut.
 */
const SAW_BLADE = {
  teeth: 22,
  toothDepth: 0.12,
  /** How far round its slot each tooth's point sits. */
  toothPoint: 0.7,
  setRing: 1.6,
  collar: 0.26,
  nut: 0.55,
  glintWidth: 0.05,
  glintColour: 'rgba(255,255,255,0.28)',
  /** The disc's lit centre, offset toward the light as a share of the radius. */
  litOffset: 0.35,
  litCore: 0.1,
  midStop: 0.5,
  /** The glint's line across the plate, as shares of the radius from the centre. */
  glintFrom: [-1, 0.2],
  glintTo: [0.2, -1],
} as const;

function paintSawBlade(ctx: Ctx, g: Grid, cx: number, up: number, radius: number): void {
  const b = SAW_BLADE;
  const px = g.x(cx);
  const py = g.y(up);
  const r = g.s(radius);
  const toothDepth = r * b.toothDepth;
  const inner = r - toothDepth;
  ctx.beginPath();
  for (let tooth = 0; tooth < b.teeth; tooth++) {
    const gullet = (tooth / b.teeth) * TWO_PI;
    const point = ((tooth + b.toothPoint) / b.teeth) * TWO_PI;
    const nextGullet = ((tooth + 1) / b.teeth) * TWO_PI;
    if (tooth === 0) ctx.moveTo(px + Math.cos(gullet) * inner, py + Math.sin(gullet) * inner);
    ctx.lineTo(px + Math.cos(point) * r, py + Math.sin(point) * r);
    ctx.lineTo(px + Math.cos(nextGullet) * inner, py + Math.sin(nextGullet) * inner);
  }
  ctx.closePath();
  const disc = ctx.createRadialGradient(
    px - r * b.litOffset,
    py - r * b.litOffset,
    r * b.litCore,
    px,
    py,
    r,
  );
  disc.addColorStop(0, IRON.light);
  disc.addColorStop(b.midStop, IRON.light);
  disc.addColorStop(1, IRON.body);
  fillInked(ctx, g, disc);
  ctx.beginPath();
  ctx.arc(px, py, r - toothDepth * b.setRing, 0, TWO_PI);
  ctx.strokeStyle = IRON.dark;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  ctx.stroke();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(px, py, inner, 0, TWO_PI);
    },
    () => {
      const [fromX, fromY] = b.glintFrom;
      const [toX, toY] = b.glintTo;
      ctx.strokeStyle = b.glintColour;
      ctx.lineWidth = g.s(b.glintWidth);
      ctx.beginPath();
      ctx.moveTo(px + r * fromX, py + r * fromY);
      ctx.lineTo(px + r * toX, py + r * toY);
      ctx.stroke();
    },
  );
  ctx.beginPath();
  ctx.arc(px, py, r * b.collar, 0, TWO_PI);
  fillInked(ctx, g, IRON.dark);
  ctx.beginPath();
  ctx.arc(px, py, r * b.collar * b.nut, 0, TWO_PI);
  fillInked(ctx, g, BRASS.light);
}

// ── Rope frame ────────────────────────────────────────────────────────────────

/**
 * A hand-crank rope walk: at the west a crank wheel on a braced post turns
 * three hooks, at the east a braced post holds the finished end; three thick
 * hemp strands run from the hooks into the grooved wooden top that lays them,
 * and the laid rope runs on to the east post. Coils of finished rope sit at
 * the frame's feet.
 */
const ROPE_FRAME = {
  shadowUp: 0.4,
  shadowRx: 0.94,
  shadowRy: 0.2,
  headX: 0.16,
  tailX: 1.86,
  postWidth: 0.1,
  postFoot: 0.34,
  headTop: 1.14,
  tailTop: 1.06,
  brace: { spread: 0.18, footLift: 0.02, topDrop: 0.21, width: 0.07 },
  hookUps: [0.7, 0.84, 0.98],
  hookReach: 0.13,
  hookWidth: 0.03,
  crankX: 0.25,
  crankUp: 0.84,
  crankRadius: 0.18,
  crankMissingSpokes: [1, 3, 5, 7],
  handle: { x: 0.09, up: 1.1, length: 0.12, armWidth: 0.04, gripWidth: 0.05 },
  strandWidth: 0.055,
  /** Where the strands gather into the laying top, as a share of their spread. */
  gatherShare: 0.3,
  layTopX: 1.3,
  layTopRx: 0.09,
  layTopMouth: 0.16,
  layTopTip: 0.07,
  /** The top's grooves, as offsets from its axis at the mouth. */
  grooves: [-0.05, 0.05],
  grooveSpread: 1.6,
  grooveTip: 0.6,
  ropeWidth: 0.08,
  ropeRise: 0.02,
  ropeTailGap: 0.06,
  twists: 7,
  twistInset: 0.06,
  twistSlant: 0.04,
  twistHalfHeight: 0.03,
  tailHook: { reach: 0.08, width: 0.035 },
  coils: [
    [0.34, 0.24],
    [1.62, 0.24],
  ],
} as const;
const HEMP_TONES = [ROPE.body, STRAW.light, ROPE.body];

function paintRopeFrame(ctx: Ctx, g: Grid): void {
  const r = ROPE_FRAME;
  shadow(ctx, g, 1, r.shadowUp, r.shadowRx, r.shadowRy);
  const brace = r.brace;
  strut(
    ctx,
    g,
    r.tailX - brace.spread,
    r.postFoot + brace.footLift,
    r.tailX,
    r.tailTop - brace.topDrop,
    brace.width,
  );
  logPost(ctx, g, r.tailX, r.postFoot, r.tailTop, r.postWidth);
  logPost(ctx, g, r.headX, r.postFoot, r.headTop, r.postWidth);
  strut(
    ctx,
    g,
    r.headX + brace.spread,
    r.postFoot + brace.footLift,
    r.headX,
    r.headTop - brace.topDrop,
    brace.width,
  );
  r.hookUps.forEach((hookUp, index) => {
    const gatherUp = r.crankUp + (hookUp - r.crankUp) * r.gatherShare;
    cord(
      ctx,
      g,
      [
        [r.crankX + r.hookReach, hookUp],
        [r.layTopX, gatherUp],
      ],
      r.strandWidth,
      HEMP_TONES[index] ?? ROPE.body,
    );
  });
  const ropeEndX = r.tailX - r.ropeTailGap;
  cord(
    ctx,
    g,
    [
      [r.layTopX, r.crankUp],
      [ropeEndX, r.crankUp + r.ropeRise],
    ],
    r.ropeWidth,
    ROPE.body,
  );
  ctx.strokeStyle = ROPE.dark;
  ctx.lineWidth = Math.max(1, g.ink * FINE_LINE_SHARE);
  const twistSpan = ropeEndX - r.layTopX - r.twistInset * 2;
  for (let twist = 0; twist < r.twists; twist++) {
    const twistX = r.layTopX + r.twistInset + (twist / r.twists) * twistSpan;
    const along = (twistX - r.layTopX) / (ropeEndX - r.layTopX);
    const twistUp = r.crankUp + r.ropeRise * along;
    ctx.beginPath();
    ctx.moveTo(g.x(twistX), g.y(twistUp + r.twistHalfHeight));
    ctx.lineTo(g.x(twistX + r.twistSlant), g.y(twistUp - r.twistHalfHeight));
    ctx.stroke();
  }
  const mouthX = r.layTopX - r.layTopRx;
  const tipX = r.layTopX + r.layTopRx;
  polygon(ctx, [
    [g.x(mouthX), g.y(r.crankUp + r.layTopMouth)],
    [g.x(tipX), g.y(r.crankUp + r.layTopTip)],
    [g.x(tipX), g.y(r.crankUp - r.layTopTip)],
    [g.x(mouthX), g.y(r.crankUp - r.layTopMouth)],
  ]);
  fillInked(ctx, g, roundShade(ctx, g, mouthX, tipX, WOOD_TONE));
  ctx.strokeStyle = WOOD.deep;
  for (const groove of r.grooves) {
    ctx.beginPath();
    ctx.moveTo(g.x(mouthX), g.y(r.crankUp + groove * r.grooveSpread));
    ctx.lineTo(g.x(tipX), g.y(r.crankUp + groove * r.grooveTip));
    ctx.stroke();
  }
  const hook = r.tailHook;
  strut(
    ctx,
    g,
    r.tailX - hook.reach,
    r.crankUp + r.ropeRise,
    r.tailX,
    r.crankUp + r.ropeRise,
    hook.width,
    IRON_TONE,
  );
  paintWheel(ctx, g, r.crankX, r.crankUp, r.crankRadius, r.crankMissingSpokes, WOOD_TONE);
  for (const hookUp of r.hookUps) {
    strut(ctx, g, r.crankX, hookUp, r.crankX + r.hookReach, hookUp, r.hookWidth, IRON_TONE);
  }
  const handle = r.handle;
  strut(ctx, g, r.crankX, r.crankUp, handle.x, handle.up, handle.armWidth, IRON_TONE);
  strut(
    ctx,
    g,
    handle.x,
    handle.up,
    handle.x,
    handle.up + handle.length,
    handle.gripWidth,
    WOOD_TONE,
  );
  for (const [coilX, coilGround] of r.coils) paintRopeCoil(ctx, g, coilX, coilGround);
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const OUTDOOR_PROP_ART: Record<OutdoorPropId, VillagePropArt> = {
  bell_tower: { variants: 1, paint: painter(paintBellTower) },
  well: { variants: 2, paint: painter(paintWell) },
  notice_board: { variants: 1, paint: painter(paintNoticeBoard) },
  lamp_post: { variants: 1, paint: painter(paintLampPost) },
  bench: { variants: 1, paint: painter(paintBench) },
  water_trough: { variants: 1, paint: painter(paintWaterTrough) },
  scarecrow: { variants: 1, paint: painter(paintScarecrow) },
  mushroom_log_bed: { variants: 1, paint: painter(paintMushroomLogBed) },
  hay_bale: { variants: 2, paint: painter(paintHayBale) },
  feed_bin: { variants: 1, paint: painter(paintFeedBin) },
  log_pile: { variants: 3, paint: painter(paintLogPile) },
  board_stack: { variants: 1, paint: painter(paintBoardStack) },
  stone_pile: { variants: 1, paint: painter(paintStonePile) },
  chopping_block: { variants: 1, paint: painter(paintChoppingBlock) },
  crate: { variants: 3, paint: painter(paintCrate) },
  barrel: { variants: 3, paint: painter(paintBarrel) },
  sack: { variants: 3, paint: painter(paintSack) },
  half_built_cart: { variants: 1, paint: painter(paintHalfBuiltCart) },
  broken_cart: { variants: 1, paint: painter(paintBrokenCart) },
  bucket: { variants: 1, paint: painter(paintBucketProp) },
  sawmill_machine: { variants: 1, paint: painter(paintSawmill) },
  rope_frame: { variants: 1, paint: painter(paintRopeFrame) },
};
