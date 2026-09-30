/**
 * Bespoke furniture for Plumbline Farm: a room built by a man who knows
 * exactly how a room ought to be built, holding three lives at once.
 *
 * The architect's: a tall drafting table under the window with a real
 * elevation and plan pinned square, the T-square and set square hung on
 * their pegs, the framed elevation of a hall never built, a plan chest and a
 * bin of rolled drawings he has never thrown away. The builder's: a tool wall
 * over a joiner's bench with every tool over its own painted outline, a
 * panelled door for someone else's house waiting on trestles, a dovetailed
 * offcut box and shelves built as a flight of stairs. The farmer's he tried
 * to be: a scrubbed dairy wall under a window onto the empty pasture with a
 * slate of cows' names struck through, churns standing clean, pails stacked
 * dry, feed sacks still full, and a cowbell on the peg post by the door.
 * Between them, the hearth he dressed himself and his one good chair.
 *
 * The drawings are plainly drawings of buildings, but carry nothing a
 * player could read as a clue: what Wendell keeps, and whose it is, belongs
 * to his own story. The one exception is deliberate — Fenna's blueprints,
 * cyan in a room of cream paper, show in the plan chest for as long as they
 * are in his keeping.
 */

import {
  footprintBox,
  withFootprintClip,
  forkRng,
  jitter,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type Rng,
} from '../../town/townArt';
import {
  getTownRamp,
  sampleRamp,
  mix,
  TOWN_INK,
  type Ramp,
  type RGB,
} from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

/** The plan chest's two looks: Fenna's blueprints in its top drawer, or the drawer shut on nothing of hers. */
export const PLAN_CHEST_VARIANT = { withBlueprints: 0, empty: 1 } as const;
/** The churn stand's two looks: scoured and dry with no cow to milk, or in use again. */
export const CHURN_STAND_VARIANT = { idle: 0, inUse: 1 } as const;
/** The peg post by the door: the cowbell on its nail, or the nail bare once the bell is on a cow. */
export const DOOR_PEG_POST_VARIANT = { withCowbell: 0, bareNail: 1 } as const;
/** The boot tray by the door: his muddy boots, or the boots and a full pail of the morning's milk. */
export const BOOT_TRAY_VARIANT = { bootsOnly: 0, withMilkPail: 1 } as const;

// ── Colours no shared town ramp covers ─────────────────────────────────────

/** Drawing paper, warm and pale, and its shaded curl. */
const PAPER: RGB = [232, 222, 194];
const PAPER_SHADE: RGB = [192, 176, 140];
/** A draughtsman's blue-grey ink line. */
const DRAWING_LINE: RGB = [98, 116, 140];
/**
 * Fenna's blueprints: true cyan-print sheets with white lines, tied in a
 * green tape — the one drawing in the house that is not cream paper.
 */
const BLUEPRINT: RGB = [46, 96, 164];
const BLUEPRINT_LIGHT: RGB = [96, 150, 206];
const BLUEPRINT_LINE: RGB = [226, 238, 250];
const BLUEPRINT_TAPE: RGB = [84, 132, 64];
/** Tapes tying the rolled drawings. */
const TAPE_RED: RGB = [150, 58, 48];
const TAPE_BLUE: RGB = [58, 84, 128];
/** Polished brass: lamp shade, candlesticks, pulls, the plumb bob. */
const BRASS: RGB = [190, 150, 70];
const BRASS_DARK: RGB = [120, 90, 40];
const BRASS_LIGHT: RGB = [240, 212, 140];
/** Tool steel, kept oiled and bright. */
const STEEL: RGB = [150, 158, 166];
const STEEL_DARK: RGB = [84, 90, 98];
const STEEL_LIGHT: RGB = [222, 228, 232];
/** Scoured dairy tin — brighter and cooler than any hardware ramp, because it is meant to read as clean. */
const TIN: RGB = [178, 186, 192];
const TIN_DARK: RGB = [112, 120, 128];
const TIN_LIGHT: RGB = [236, 242, 246];
/** Planed pine and scrubbed deal: the pale fresh wood of new joinery and a dairy bench. */
const PINE: RGB = [206, 176, 128];
const PINE_DARK: RGB = [150, 118, 76];
const PINE_LIGHT: RGB = [232, 210, 166];
const SCRUBBED_DEAL: RGB = [222, 206, 170];
/** Beech bench top and tool handles: harder and warmer than the pine. */
const BEECH: RGB = [184, 136, 88];
const BEECH_DARK: RGB = [120, 82, 48];
/** Rosewood stocks and a mallet head's end grain. */
const ROSEWOOD: RGB = [104, 54, 40];
/**
 * The red-oxide shapes painted on the tool board, one behind each tool: a
 * joiner's shadow board, so a tool out of its place is missed at a glance.
 */
const TOOL_OUTLINE_PAINT: RGB = [138, 92, 66];
/** How far a painted outline stands proud of its tool, as a share of a tile. */
const TOOL_OUTLINE_REACH = 0.035;
/** A spirit level's vial. */
const LEVEL_VIAL: RGB = [166, 208, 120];
/** Translucent celluloid set squares. */
const SET_SQUARE_AMBER: RGB = [214, 168, 82];
const SET_SQUARE_CLEAR: RGB = [196, 214, 214];
/** Lamp and candle flame, and the fire. */
const FLAME_CORE: RGB = [255, 228, 150];
const FLAME_MID: RGB = [236, 132, 48];
const FLAME_DEEP: RGB = [150, 52, 24];
const EMBER_GLOW: RGB = [255, 170, 80];
const SOOT: RGB = [28, 22, 20];
/** A school slate's grey-green face and the chalk on it. */
const SLATE: RGB = [54, 64, 62];
const CHALK: RGB = [228, 230, 220];
/** New milk and the cream churned up from it. */
const MILK: RGB = [248, 246, 236];
const CREAM: RGB = [242, 228, 178];
/** Copper kettle on the crane. */
const COPPER: RGB = [172, 94, 58];
const COPPER_LIGHT: RGB = [226, 150, 104];
/** The view out of the windows: sky, the pasture's good grass, his fence. */
const SKY_HIGH: RGB = [150, 190, 222];
const SKY_LOW: RGB = [210, 226, 234];
const PASTURE: RGB = [110, 156, 74];
const PASTURE_FAR: RGB = [150, 184, 102];
const FENCE_RAIL: RGB = [226, 214, 186];
/** Hessian feed sacks and their stencil. */
const HESSIAN: RGB = [196, 170, 120];
const HESSIAN_DARK: RGB = [144, 118, 76];
const STENCIL: RGB = [96, 66, 44];
/** Bed linen and the grey-blue wool blanket, and the good chair's cushion. */
const LINEN: RGB = [236, 230, 214];
const LINEN_SHADE: RGB = [196, 188, 170];
const BLANKET: RGB = [84, 104, 124];
const BLANKET_LIGHT: RGB = [120, 142, 162];
const CUSHION: RGB = [150, 72, 54];
/** Split firewood: bark and the pale cut end. */
const LOG_BARK: RGB = [86, 62, 44];
const LOG_END: RGB = [214, 184, 132];

function timber(): Ramp {
  return getTownRamp('oc_timber');
}
/**
 * A warm pale freestone for the hearth. The town's own dressed-stone ramp is
 * cool and blue-grey, and a whole chimney breast of it reads as a grey slab
 * against timber walls; a builder choosing stone for his own fire would pick
 * the honey-coloured one.
 */
const HEARTH_FREESTONE: Ramp = {
  shadow: [96, 84, 70],
  mid: [170, 152, 124],
  light: [214, 198, 168],
  accent: [234, 222, 196],
};
function iron(): Ramp {
  return getTownRamp('iron_black');
}

// ── Small shared primitives ────────────────────────────────────────────────

/** A soft floor shadow under a prop's footprint; lengths are shares of a tile, `defaultSpread` of the footprint's width. */
const CONTACT_SHADOW = {
  defaultSpread: 0.44,
  radiusY: 0.16,
  /** How far the shadow's centre sits above the footprint's bottom edge, in shadow radii. */
  lift: 0.4,
  alpha: 0.32,
} as const;

function contactShadow(
  ctx: Ctx,
  frame: TownPropFrame,
  spread: number = CONTACT_SHADOW.defaultSpread,
): void {
  const s = CONTACT_SHADOW;
  const box = footprintBox(frame);
  const radiusY = frame.tileScale * s.radiusY;
  drawTownContactShadow(
    ctx,
    box.centreX,
    box.bottom - radiusY * s.lift,
    box.width * spread,
    radiusY,
    s.alpha,
  );
}

/** A filled, inked rectangle — the joinery in this room is all square. */
function block(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  ts: number,
  ink = 1,
): void {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  if (ink > 0) inkOutline(ctx, ts * ink);
}

const LIT_EDGE_ALPHA = 0.7;

/** A lit top edge along a board, the one highlight that makes a flat rectangle read as a planed surface. */
function litEdge(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  thickness: number,
  color: RGB,
  alpha: number = LIT_EDGE_ALPHA,
): void {
  ctx.fillStyle = rgba(color, alpha);
  ctx.fillRect(x, y, w, thickness);
}

function disc(ctx: Ctx, x: number, y: number, r: number, color: RGB): void {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

/** The bloom's inner gradient circle, in pixels: a point source, not a lit disc. */
const GLOW_INNER_RADIUS = 1;

function glow(ctx: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number): void {
  const bloom = ctx.createRadialGradient(x, y, GLOW_INNER_RADIUS, x, y, radius);
  bloom.addColorStop(0, rgba(color, alpha));
  bloom.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A two-tone teardrop flame; heights are shares of the flame's height, widths of its half-width. */
const FLAME_SHAPE = {
  /** How far below the tip the outer flame is widest. */
  outerBellyDrop: 0.35,
  coreHeight: 0.7,
  coreWidth: 0.5,
  coreBellyDrop: 0.25,
} as const;

function flame(ctx: Ctx, x: number, baseY: number, h: number, w: number): void {
  const s = FLAME_SHAPE;
  ctx.fillStyle = rgb(FLAME_MID);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.quadraticCurveTo(x + w, baseY - h * s.outerBellyDrop, x, baseY);
  ctx.quadraticCurveTo(x - w, baseY - h * s.outerBellyDrop, x, baseY - h);
  ctx.fill();
  ctx.fillStyle = rgb(FLAME_CORE);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h * s.coreHeight);
  ctx.quadraticCurveTo(x + w * s.coreWidth, baseY - h * s.coreBellyDrop, x, baseY);
  ctx.quadraticCurveTo(
    x - w * s.coreWidth,
    baseY - h * s.coreBellyDrop,
    x,
    baseY - h * s.coreHeight,
  );
  ctx.fill();
}

/** A rolled drawing's end; lengths are shares of the roll's radius, ink weights of a tile. */
const ROLL_END = {
  outlineInk: 0.5,
  spiral: {
    alpha: 0.9,
    lineWidth: 0.22,
    offsetX: 0.08,
    offsetY: 0.06,
    radius: 0.5,
    /** Canvas angles: the spiral's turn stops short of closing, which is what reads as rolled paper. */
    from: Math.PI * 0.2,
    to: Math.PI * 1.7,
  },
  eye: { offsetX: 0.1, offsetY: 0.08, radius: 0.18 },
  tape: { lineWidth: 0.3, radius: 0.98, from: Math.PI * 0.6, to: Math.PI * 0.95 },
} as const;

/** A drawing rolled and seen end-on: a pale disc with the spiral's dark eye. */
function rollEnd(ctx: Ctx, x: number, y: number, r: number, ts: number, tape: RGB | null): void {
  const s = ROLL_END;
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  ctx.strokeStyle = rgba(PAPER_SHADE, s.spiral.alpha);
  ctx.lineWidth = Math.max(1, r * s.spiral.lineWidth);
  ctx.beginPath();
  ctx.arc(
    x + r * s.spiral.offsetX,
    y + r * s.spiral.offsetY,
    r * s.spiral.radius,
    s.spiral.from,
    s.spiral.to,
  );
  ctx.stroke();
  disc(ctx, x + r * s.eye.offsetX, y + r * s.eye.offsetY, r * s.eye.radius, PAPER_SHADE);
  if (tape !== null) {
    ctx.strokeStyle = rgb(tape);
    ctx.lineWidth = Math.max(1, r * s.tape.lineWidth);
    ctx.beginPath();
    ctx.arc(x, y, r * s.tape.radius, s.tape.from, s.tape.to);
    ctx.stroke();
  }
}

/** A rolled drawing on its side; lengths are shares of the roll's radius unless noted, ink weights of a tile. */
const ROLL_SIDE = {
  outlineInk: 0.5,
  shadeAlpha: 0.7,
  shadeTop: 0.25,
  shadeHeight: 0.75,
  /** Where the tape ties round, as a share of the roll's length from `x0`. */
  tapeAlong: 0.38,
  tapeWidth: 0.45,
  endRadiusX: 0.42,
  endInk: 0.45,
  eyeOffsetX: 0.05,
  eyeRadius: 0.2,
} as const;

/** A rolled drawing lying on its side, from `x0` to `x1`, with its spiral end towards `x1`. */
function rollSide(
  ctx: Ctx,
  x0: number,
  x1: number,
  cy: number,
  r: number,
  ts: number,
  tape: RGB | null,
): void {
  const s = ROLL_SIDE;
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.rect(x0, cy - r, x1 - x0, r * 2);
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  ctx.fillStyle = rgba(PAPER_SHADE, s.shadeAlpha);
  ctx.fillRect(x0, cy + r * s.shadeTop, x1 - x0, r * s.shadeHeight);
  if (tape !== null) {
    ctx.fillStyle = rgb(tape);
    ctx.fillRect(x0 + (x1 - x0) * s.tapeAlong, cy - r, Math.max(1, r * s.tapeWidth), r * 2);
  }
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.ellipse(x1, cy, r * s.endRadiusX, r, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * s.endInk);
  disc(ctx, x1 + r * s.eyeOffsetX, cy, r * s.eyeRadius, PAPER_SHADE);
}

/** A rolled drawing stood on end; lengths are shares of the roll's radius unless noted, ink weights of a tile. */
const ROLL_UPRIGHT = {
  outlineInk: 0.45,
  shadeAlpha: 0.75,
  /** Where the shaded east side of the roll begins, from the roll's axis. */
  shadeFrom: 0.2,
  /** Where the tape ties round, as a share of the roll's height from its base. */
  tapeAlong: 0.45,
  /** The tape's height, as a share of a tile. */
  tapeHeight: 0.025,
  topLightening: 0.25,
  topRadiusY: 0.45,
  topInk: 0.4,
  eyeOffsetX: 0.1,
  eyeRadius: 0.22,
} as const;

/** A rolled drawing standing on end, leaning by `lean` pixels at the top. */
function rollUpright(
  ctx: Ctx,
  x: number,
  baseY: number,
  height: number,
  r: number,
  lean: number,
  ts: number,
  tape: RGB | null,
): void {
  const s = ROLL_UPRIGHT;
  const topX = x + lean;
  const topY = baseY - height;
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.moveTo(x - r, baseY);
  ctx.lineTo(topX - r, topY);
  ctx.lineTo(topX + r, topY);
  ctx.lineTo(x + r, baseY);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  ctx.fillStyle = rgba(PAPER_SHADE, s.shadeAlpha);
  ctx.beginPath();
  ctx.moveTo(x + r * s.shadeFrom, baseY);
  ctx.lineTo(topX + r * s.shadeFrom, topY);
  ctx.lineTo(topX + r, topY);
  ctx.lineTo(x + r, baseY);
  ctx.closePath();
  ctx.fill();
  if (tape !== null) {
    const bandT = s.tapeAlong;
    const bx = x + lean * bandT;
    const by = baseY - height * bandT;
    ctx.fillStyle = rgb(tape);
    ctx.fillRect(bx - r, by, r * 2, Math.max(1, ts * s.tapeHeight));
  }
  ctx.fillStyle = rgb(mix(PAPER, [255, 255, 255], s.topLightening));
  ctx.beginPath();
  ctx.ellipse(topX, topY, r, r * s.topRadiusY, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * s.topInk);
  disc(ctx, topX + r * s.eyeOffsetX, topY, r * s.eyeRadius, PAPER_SHADE);
}

/** Coursed ashlar; tones are ramp positions, the joint a share of the course height. */
const ASHLAR = {
  jointTone: 0.2,
  joint: 0.08,
  blockTone: 0.58,
  blockToneJitter: 0.08,
  arrisLightAlpha: 0.35,
  bedShadeAlpha: 0.25,
  /** How far above the course's foot the bed shadow starts, in joint widths. */
  bedShadeRise: 1.5,
} as const;

/**
 * Dressed ashlar in dead-level courses, every block squared and every joint
 * struck — the shared coursed-stone painter sizes its courses to the wall's
 * height, and a chimney breast wants many shallow courses, not two tall ones.
 */
function paintAshlar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  courseH: number,
  blockW: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const s = ASHLAR;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(ramp, s.jointTone));
  ctx.fillRect(x, y, w, h);
  const joint = Math.max(1, courseH * s.joint);
  const courses = Math.ceil(h / courseH);
  for (let c = 0; c < courses; c++) {
    const cy = y + c * courseH;
    let bx = x - (c % 2 === 0 ? 0 : blockW / 2);
    while (bx < x + w) {
      const tone = s.blockTone + jitter(rng, s.blockToneJitter);
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.fillRect(bx + joint / 2, cy + joint / 2, blockW - joint, courseH - joint);
      ctx.fillStyle = rgba(sampleRamp(ramp, 1), s.arrisLightAlpha);
      ctx.fillRect(bx + joint / 2, cy + joint / 2, blockW - joint, joint);
      ctx.fillStyle = rgba(sampleRamp(ramp, 0), s.bedShadeAlpha);
      ctx.fillRect(bx + joint / 2, cy + courseH - joint * s.bedShadeRise, blockW - joint, joint);
      bx += blockW;
    }
  }
  ctx.restore();
}

/**
 * A wall window. Timber sizes are shares of a tile, tones are ramp
 * positions; the view's heights are shares of the glass's height and the
 * shine's x positions shares of its width.
 */
const WALL_WINDOW = {
  casing: 0.07,
  casingTone: 0.62,
  skyLowStop: 0.55,
  horizon: 0.56,
  farPastureHeight: 0.12,
  nearPastureDrop: 0.1,
  fence: {
    railHeight: 0.045,
    upperRailDrop: 0.14,
    lowerRailDrop: 0.26,
    posts: 3,
    /** Post half-width and width, in rail heights. */
    postHalfWidth: 0.8,
    postWidth: 1.6,
    postTopDrop: 0.08,
    postHeight: 0.26,
  },
  shine: { alpha: 0.22, footLeft: 0.08, headLeft: 0.3, headRight: 0.4, footRight: 0.18 },
  glazingBar: 0.035,
  glazingBarTone: 0.72,
  glassInk: 0.8,
  sillOverhang: 0.1,
  /** How far below the glass the sill sits, in casing widths. */
  sillDrop: 0.4,
  sillHeight: 0.07,
  sillTone: 0.72,
  sillLitEdge: 0.018,
} as const;

/** A window cut into the wall face: a squared oak casing, a sill, four panes, and what is outside. */
function paintWindow(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  withFence: boolean,
): void {
  const s = WALL_WINDOW;
  const casing = ts * s.casing;
  block(
    ctx,
    x - casing,
    y - casing,
    w + casing * 2,
    h + casing * 2,
    sampleRamp(timber(), s.casingTone),
    ts,
  );
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, rgb(SKY_HIGH));
  sky.addColorStop(s.skyLowStop, rgb(SKY_LOW));
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  const horizon = y + h * s.horizon;
  ctx.fillStyle = rgb(PASTURE_FAR);
  ctx.fillRect(x, horizon, w, h * s.farPastureHeight);
  ctx.fillStyle = rgb(PASTURE);
  ctx.fillRect(x, horizon + h * s.nearPastureDrop, w, h - (horizon - y) - h * s.nearPastureDrop);
  if (withFence) {
    const f = s.fence;
    ctx.fillStyle = rgb(FENCE_RAIL);
    const railH = Math.max(1, h * f.railHeight);
    ctx.fillRect(x, horizon + h * f.upperRailDrop, w, railH);
    ctx.fillRect(x, horizon + h * f.lowerRailDrop, w, railH);
    const posts = f.posts;
    for (let i = 0; i < posts; i++) {
      const px = x + (w * (i + 0.5)) / posts;
      ctx.fillRect(
        px - railH * f.postHalfWidth,
        horizon + h * f.postTopDrop,
        railH * f.postWidth,
        h * f.postHeight,
      );
    }
  }
  // Daylight on the glass: one pale diagonal shine per pane pair.
  ctx.fillStyle = rgba([255, 255, 255], s.shine.alpha);
  ctx.beginPath();
  ctx.moveTo(x + w * s.shine.footLeft, y + h);
  ctx.lineTo(x + w * s.shine.headLeft, y);
  ctx.lineTo(x + w * s.shine.headRight, y);
  ctx.lineTo(x + w * s.shine.footRight, y + h);
  ctx.closePath();
  ctx.fill();
  const bar = Math.max(1, ts * s.glazingBar);
  ctx.fillStyle = rgb(sampleRamp(timber(), s.glazingBarTone));
  ctx.fillRect(x + w / 2 - bar / 2, y, bar, h);
  ctx.fillRect(x, y + h / 2 - bar / 2, w, bar);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts * s.glassInk);
  const sillOver = ts * s.sillOverhang;
  block(
    ctx,
    x - sillOver,
    y + h + casing * s.sillDrop,
    w + sillOver * 2,
    ts * s.sillHeight,
    sampleRamp(timber(), s.sillTone),
    ts,
  );
  litEdge(
    ctx,
    x - sillOver,
    y + h + casing * s.sillDrop,
    w + sillOver * 2,
    ts * s.sillLitEdge,
    sampleRamp(timber(), 1),
  );
}

/** Warm daylight, and how strongly its shaft reads where it leaves the window. */
const DAYLIGHT_SHAFT = { color: [255, 244, 214], alpha: 0.2 } as const;

/** A shaft of daylight falling from a window onto whatever stands under it. */
function daylight(ctx: Ctx, x: number, y: number, w: number, fall: number, drift: number): void {
  const shaft = ctx.createLinearGradient(0, y, 0, y + fall);
  shaft.addColorStop(0, rgba(DAYLIGHT_SHAFT.color, DAYLIGHT_SHAFT.alpha));
  shaft.addColorStop(1, rgba(DAYLIGHT_SHAFT.color, 0));
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + drift, y + fall);
  ctx.lineTo(x + drift, y + fall);
  ctx.closePath();
  ctx.fill();
}

/**
 * A milk churn. Heights are shares of the churn's height measured up from
 * its foot, widths shares of its width; ink and handle stroke are shares of
 * a tile.
 */
const CHURN = {
  shoulder: 0.66,
  neck: 0.84,
  neckWidth: 0.46,
  shoulderHalf: 0.46,
  neckCurveHalf: 0.44,
  neckCurveDrop: 0.04,
  rim: 0.94,
  outlineInk: 0.7,
  shade: { alpha: 0.55, left: 0.12, width: 0.34 },
  shine: { alpha: 0.95, left: 0.32, topDrop: 0.06, width: 0.1, trim: 0.12 },
  bands: { footRise: 0.07, height: 0.04, shoulderHalf: 0.47, shoulderWidth: 0.94 },
  /** The open neck's rim and milk; x radii are shares of the neck's width. */
  open: {
    rimRadiusX: 0.55,
    rimRadiusY: 0.05,
    rimInk: 0.5,
    milkLevel: 0.935,
    milkRadiusX: 0.42,
    milkRadiusY: 0.035,
  },
  /** The seated lid; x radius is a share of the neck's width. */
  lid: { radiusX: 0.62, radiusY: 0.06, ink: 0.55, knobHeight: 0.99, knobRadius: 0.07 },
  handles: { lineWidth: 0.018, reach: 0.44, rise: 0.02, radius: 0.1 },
} as const;

/** A scoured tin milk churn: a tapered body, a banded shoulder, a neck and a seated lid. */
function paintChurn(
  ctx: Ctx,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  ts: number,
  open = false,
): void {
  const s = CHURN;
  const shoulderY = bottom - h * s.shoulder;
  const neckY = bottom - h * s.neck;
  const neckW = w * s.neckWidth;
  ctx.fillStyle = rgb(TIN);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, bottom);
  ctx.lineTo(cx - w * s.shoulderHalf, shoulderY);
  ctx.quadraticCurveTo(
    cx - w * s.neckCurveHalf,
    neckY + h * s.neckCurveDrop,
    cx - neckW / 2,
    neckY,
  );
  ctx.lineTo(cx - neckW / 2, bottom - h * s.rim);
  ctx.lineTo(cx + neckW / 2, bottom - h * s.rim);
  ctx.lineTo(cx + neckW / 2, neckY);
  ctx.quadraticCurveTo(
    cx + w * s.neckCurveHalf,
    neckY + h * s.neckCurveDrop,
    cx + w * s.shoulderHalf,
    shoulderY,
  );
  ctx.lineTo(cx + w * 0.5, bottom);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  // The unlit east half, then a hard bright shine down the lit west side.
  ctx.fillStyle = rgba(TIN_DARK, s.shade.alpha);
  ctx.fillRect(cx + w * s.shade.left, shoulderY, w * s.shade.width, bottom - shoulderY - 1);
  ctx.fillStyle = rgba(TIN_LIGHT, s.shine.alpha);
  ctx.fillRect(
    cx - w * s.shine.left,
    shoulderY + h * s.shine.topDrop,
    Math.max(1, w * s.shine.width),
    bottom - shoulderY - h * s.shine.trim,
  );
  // Rolled bands at the foot and the shoulder.
  ctx.fillStyle = rgb(TIN_DARK);
  ctx.fillRect(cx - w * 0.5, bottom - h * s.bands.footRise, w, Math.max(1, h * s.bands.height));
  ctx.fillRect(
    cx - w * s.bands.shoulderHalf,
    shoulderY,
    w * s.bands.shoulderWidth,
    Math.max(1, h * s.bands.height),
  );
  if (open) {
    const o = s.open;
    // Lid off: the neck's dark rim, and the milk standing high in it.
    ctx.fillStyle = rgb(TIN_DARK);
    ctx.beginPath();
    ctx.ellipse(cx, bottom - h * s.rim, neckW * o.rimRadiusX, h * o.rimRadiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * o.rimInk);
    ctx.fillStyle = rgb(MILK);
    ctx.beginPath();
    ctx.ellipse(
      cx,
      bottom - h * o.milkLevel,
      neckW * o.milkRadiusX,
      h * o.milkRadiusY,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  } else {
    const lid = s.lid;
    // The lid: a domed cap with a knob.
    ctx.fillStyle = rgb(TIN_LIGHT);
    ctx.beginPath();
    ctx.ellipse(cx, bottom - h * s.rim, neckW * lid.radiusX, h * lid.radiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * lid.ink);
    disc(ctx, cx, bottom - h * lid.knobHeight, Math.max(1, w * lid.knobRadius), TIN_DARK);
  }
  // Two side handles.
  ctx.strokeStyle = rgb(TIN_DARK);
  ctx.lineWidth = Math.max(1, ts * s.handles.lineWidth);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      cx + side * w * s.handles.reach,
      shoulderY - h * s.handles.rise,
      w * s.handles.radius,
      0,
      TWO_PI,
    );
    ctx.stroke();
  }
}

/**
 * A staved pail. Half-widths and the shade are shares of the pail's width,
 * hoop and mouth sizes shares of its height, ink and bail stroke shares of a
 * tile, bail radii shares of the half-width it hangs from.
 */
const PAIL = {
  wideHalf: 0.5,
  narrowHalf: 0.4,
  outlineInk: 0.6,
  staveAlpha: 0.6,
  staves: 4,
  shade: { alpha: 0.45, left: 0.12, width: 0.4 },
  hoopTone: 0.6,
  hoopHeight: 0.09,
  upperHoopDrop: 0.16,
  lowerHoopRise: 0.26,
  mouthRadiusY: 0.12,
  mouthInk: 0.5,
  bailTone: 0.55,
  bailLineWidth: 0.016,
  upturnedBailRadius: 0.9,
  uprightBailRadius: 0.95,
} as const;

/** A staved wooden pail with two iron hoops, upright or hung upside down by its bail. */
function paintPail(
  ctx: Ctx,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  ts: number,
  upturned: boolean,
): void {
  const s = PAIL;
  const wide = w * s.wideHalf;
  const narrow = w * s.narrowHalf;
  const topHalf = upturned ? narrow : wide;
  const bottomHalf = upturned ? wide : narrow;
  const top = bottom - h;
  ctx.fillStyle = rgb(PINE);
  ctx.beginPath();
  ctx.moveTo(cx - topHalf, top);
  ctx.lineTo(cx + topHalf, top);
  ctx.lineTo(cx + bottomHalf, bottom);
  ctx.lineTo(cx - bottomHalf, bottom);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(PINE_DARK, s.staveAlpha);
  ctx.lineWidth = 1;
  const staves = s.staves;
  for (let i = 1; i < staves; i++) {
    const t = i / staves - 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + t * topHalf * 2, top);
    ctx.lineTo(cx + t * bottomHalf * 2, bottom);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(PINE_DARK, s.shade.alpha);
  ctx.fillRect(cx + w * s.shade.left, top, w * s.shade.width, h);
  ctx.fillStyle = rgb(sampleRamp(iron(), s.hoopTone));
  const hoop = Math.max(1, h * s.hoopHeight);
  ctx.fillRect(cx - wide, top + h * s.upperHoopDrop, wide * 2, hoop);
  ctx.fillRect(cx - wide, bottom - h * s.lowerHoopRise, wide * 2, hoop);
  ctx.restore();
  if (!upturned) {
    ctx.fillStyle = rgb(PINE_DARK);
    ctx.beginPath();
    ctx.ellipse(cx, top, topHalf, h * s.mouthRadiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * s.mouthInk);
  }
  ctx.strokeStyle = rgb(sampleRamp(iron(), s.bailTone));
  ctx.lineWidth = Math.max(1, ts * s.bailLineWidth);
  ctx.beginPath();
  if (upturned) ctx.arc(cx, bottom, bottomHalf * s.upturnedBailRadius, 0, Math.PI);
  else ctx.arc(cx, top, topHalf * s.uprightBailRadius, Math.PI, TWO_PI);
  ctx.stroke();
}

/**
 * A lying feed sack. X positions and widths are shares of the sack's
 * length, y positions, heights and corner radii shares of its height; ink
 * and stencil stroke are shares of a tile.
 */
const LYING_SACK = {
  tint: 0.15,
  tintJitter: 0.08,
  cornerRadius: 0.42,
  outlineInk: 0.7,
  belly: { alpha: 0.45, left: 0.04, top: 0.55, width: 0.9, height: 0.42, cornerRadius: 0.2 },
  sheen: { color: [255, 244, 214], alpha: 0.28, left: 0.12, top: 0.14, width: 0.6, height: 0.1 },
  stencil: {
    centreX: 0.42,
    radius: 0.2,
    /** The diamond is drawn wider than tall, in stencil radii. */
    halfWidth: 1.3,
    alpha: 0.75,
    lineWidth: 0.018,
  },
  neck: { root: 0.96, upperRoot: 0.3, upperTip: 0.18, lowerTip: 0.82, lowerRoot: 0.7 },
} as const;

/** A filled hessian sack lying on its side, stencilled, its tied neck to the east. */
function paintLyingSack(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  const s = LYING_SACK;
  ctx.fillStyle = rgb(mix(HESSIAN, HESSIAN_DARK, s.tint + jitter(rng, s.tintJitter)));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * s.cornerRadius);
  ctx.fill();
  inkOutline(ctx, ts * s.outlineInk);
  ctx.fillStyle = rgba(HESSIAN_DARK, s.belly.alpha);
  ctx.beginPath();
  ctx.roundRect(
    x + w * s.belly.left,
    y + h * s.belly.top,
    w * s.belly.width,
    h * s.belly.height,
    h * s.belly.cornerRadius,
  );
  ctx.fill();
  ctx.fillStyle = rgba(s.sheen.color, s.sheen.alpha);
  ctx.fillRect(
    x + w * s.sheen.left,
    y + h * s.sheen.top,
    w * s.sheen.width,
    Math.max(1, h * s.sheen.height),
  );
  // A stencilled diamond: the merchant's mark, which is all the lettering this room carries.
  const sx = x + w * s.stencil.centreX;
  const sy = y + h * 0.5;
  const sr = h * s.stencil.radius;
  ctx.strokeStyle = rgba(STENCIL, s.stencil.alpha);
  ctx.lineWidth = Math.max(1, ts * s.stencil.lineWidth);
  ctx.beginPath();
  ctx.moveTo(sx, sy - sr);
  ctx.lineTo(sx + sr * s.stencil.halfWidth, sy);
  ctx.lineTo(sx, sy + sr);
  ctx.lineTo(sx - sr * s.stencil.halfWidth, sy);
  ctx.closePath();
  ctx.stroke();
  // Tied neck.
  ctx.fillStyle = rgb(HESSIAN_DARK);
  ctx.beginPath();
  ctx.moveTo(x + w * s.neck.root, y + h * s.neck.upperRoot);
  ctx.lineTo(x + w * 1.0, y + h * s.neck.upperTip);
  ctx.lineTo(x + w * 1.0, y + h * s.neck.lowerTip);
  ctx.lineTo(x + w * s.neck.root, y + h * s.neck.lowerRoot);
  ctx.closePath();
  ctx.fill();
}

/** A rectangle in frame pixels: a sheet of paper, a frame's opening. */
interface SheetRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A set square; the hole's corners are shares of the leg they run along, ink a share of a tile. */
const SET_SQUARE = {
  alpha: 0.6,
  ink: 0.45,
  holePaperAlpha: 0.8,
  hole: { insetA: 0.2, insetB: 0.14, reachA: 0.52, reachB: 0.46 },
} as const;

/** A celluloid set square lying flat, its right angle at (`x`, `y`), with its hollow centre. */
function paintSetSquare(
  ctx: Ctx,
  x: number,
  y: number,
  legA: number,
  legB: number,
  color: RGB,
  ts: number,
): void {
  const s = SET_SQUARE;
  ctx.fillStyle = rgba(color, s.alpha);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + legA, y);
  ctx.lineTo(x, y - legB);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * s.ink);
  ctx.fillStyle = rgba(PAPER, s.holePaperAlpha);
  ctx.beginPath();
  ctx.moveTo(x + legA * s.hole.insetA, y - legB * s.hole.insetB);
  ctx.lineTo(x + legA * s.hole.reachA, y - legB * s.hole.insetB);
  ctx.lineTo(x + legA * s.hole.insetA, y - legB * s.hole.reachB);
  ctx.closePath();
  ctx.fill();
}

/** How strongly a finished line of the drawing reads against the paper; construction lines are fainter. */
const DRAWN_LINE_ALPHA = 0.9;
const CONSTRUCTION_LINE_ALPHA = 0.35;
/** The draughtsman's pen width, as a share of a tile. */
const DRAWING_PEN_WIDTH = 0.016;

function drawingPen(ctx: Ctx, ts: number, alpha: number): void {
  ctx.strokeStyle = rgba(DRAWING_LINE, alpha);
  ctx.lineWidth = Math.max(1, ts * DRAWING_PEN_WIDTH);
  ctx.lineJoin = 'miter';
}

/**
 * The elevation's proportions: positions are shares of the sheet (x of its
 * width, y of its height) unless noted; house parts are shares of the
 * house's width, or of its wall height (eave to ground) for heights.
 */
const HOUSE_ELEVATION = {
  ground: 0.86,
  houseLeft: 0.2,
  houseRight: 0.62,
  eave: 0.42,
  ridge: 0.16,
  groundLineFrom: 0.06,
  groundLineTo: 0.94,
  axisOverRidge: 0.06,
  axisUnderGround: 0.04,
  /** How far the gable's eaves overhang the walls, as a share of the house's width. */
  eaveOverhang: 0.06,
  chimney: { along: 0.72, drop: 0.02, width: 0.1, height: 0.12 },
  door: { width: 0.16, height: 0.44 },
  windows: { width: 0.16, height: 0.24, upperDrop: 0.12, inset: 0.12 },
  dimension: { y: 0.08, tick: 0.04 },
  /** The title block; rule positions are shares of the block's width. */
  titleBlock: {
    x: 0.7,
    y: 0.58,
    width: 0.24,
    height: 0.3,
    rows: 3,
    ruleInset: 0.12,
    firstRuleEnd: 0.88,
    ruleEnd: 0.6,
  },
} as const;

/**
 * A real front elevation on the big sheet: a two-storey house with a gable,
 * a chimney, a centred door and four sash windows, stood on a ground line
 * with a dimension line over it. Drawn in the draughtsman's blue at a scale
 * the tile resolves — a house, plainly, and a well-proportioned one.
 */
function paintHouseElevation(ctx: Ctx, sheet: SheetRect, ts: number): void {
  const s = HOUSE_ELEVATION;
  const groundY = sheet.y + sheet.h * s.ground;
  const houseLeft = sheet.x + sheet.w * s.houseLeft;
  const houseRight = sheet.x + sheet.w * s.houseRight;
  const houseW = houseRight - houseLeft;
  const eaveY = sheet.y + sheet.h * s.eave;
  const ridgeY = sheet.y + sheet.h * s.ridge;
  const midX = (houseLeft + houseRight) / 2;

  drawingPen(ctx, ts, CONSTRUCTION_LINE_ALPHA);
  ctx.beginPath();
  ctx.moveTo(sheet.x + sheet.w * s.groundLineFrom, groundY);
  ctx.lineTo(sheet.x + sheet.w * s.groundLineTo, groundY);
  ctx.moveTo(midX, ridgeY - sheet.h * s.axisOverRidge);
  ctx.lineTo(midX, groundY + sheet.h * s.axisUnderGround);
  ctx.stroke();

  drawingPen(ctx, ts, DRAWN_LINE_ALPHA);
  ctx.beginPath();
  ctx.rect(houseLeft, eaveY, houseW, groundY - eaveY);
  ctx.moveTo(houseLeft - houseW * s.eaveOverhang, eaveY);
  ctx.lineTo(midX, ridgeY);
  ctx.lineTo(houseRight + houseW * s.eaveOverhang, eaveY);
  ctx.stroke();
  const chimneyX = houseLeft + houseW * s.chimney.along;
  ctx.strokeRect(
    chimneyX,
    ridgeY + sheet.h * s.chimney.drop,
    houseW * s.chimney.width,
    sheet.h * s.chimney.height,
  );

  const doorW = houseW * s.door.width;
  const doorH = (groundY - eaveY) * s.door.height;
  ctx.strokeRect(midX - doorW / 2, groundY - doorH, doorW, doorH);
  const windowW = houseW * s.windows.width;
  const windowH = (groundY - eaveY) * s.windows.height;
  const upperY = eaveY + (groundY - eaveY) * s.windows.upperDrop;
  const lowerY = groundY - doorH;
  for (const wx of [
    houseLeft + houseW * s.windows.inset,
    houseRight - houseW * s.windows.inset - windowW,
  ]) {
    for (const wy of [upperY, lowerY]) {
      ctx.strokeRect(wx, wy, windowW, windowH);
      ctx.beginPath();
      ctx.moveTo(wx, wy + windowH / 2);
      ctx.lineTo(wx + windowW, wy + windowH / 2);
      ctx.stroke();
    }
  }

  // The dimension line over the ridge, ticked at both walls.
  const dimY = sheet.y + sheet.h * s.dimension.y;
  drawingPen(ctx, ts, CONSTRUCTION_LINE_ALPHA);
  ctx.beginPath();
  ctx.moveTo(houseLeft, dimY);
  ctx.lineTo(houseRight, dimY);
  for (const tx of [houseLeft, houseRight]) {
    ctx.moveTo(tx, dimY - sheet.h * s.dimension.tick);
    ctx.lineTo(tx, dimY + sheet.h * s.dimension.tick);
  }
  ctx.stroke();

  // The title block in the corner, ruled and filled with a hand too small to read.
  const tb = s.titleBlock;
  const titleX = sheet.x + sheet.w * tb.x;
  const titleY = sheet.y + sheet.h * tb.y;
  const titleW = sheet.w * tb.width;
  const titleH = sheet.h * tb.height;
  drawingPen(ctx, ts, DRAWN_LINE_ALPHA);
  ctx.strokeRect(titleX, titleY, titleW, titleH);
  drawingPen(ctx, ts, CONSTRUCTION_LINE_ALPHA);
  const titleRows = tb.rows;
  for (let row = 1; row <= titleRows; row++) {
    const ly = titleY + (titleH * row) / (titleRows + 1);
    ctx.beginPath();
    ctx.moveTo(titleX + titleW * tb.ruleInset, ly);
    ctx.lineTo(titleX + titleW * (row === 1 ? tb.firstRuleEnd : tb.ruleEnd), ly);
    ctx.stroke();
  }
}

/**
 * The plan's proportions: the outline is placed in shares of the sheet,
 * everything inside it in shares of the outline (x of its width, y of its
 * height); wall weights are shares of a tile.
 */
const FLOOR_PLAN = {
  left: 0.12,
  top: 0.14,
  width: 0.62,
  height: 0.66,
  outerWallWeight: 0.028,
  crossWallAlong: 0.55,
  crossWallLength: 0.62,
  doorAlong: 0.3,
  doorSwing: 0.3,
  treads: 4,
  stairGap: 0.08,
  stairWidth: 0.3,
  stairTop: 0.1,
  stairRun: 0.5,
} as const;

/**
 * The same house's ground-floor plan on the small sheet: thick outer walls,
 * one cross wall, a door's swing drawn as a quarter circle and the stair as
 * a run of treads.
 */
function paintFloorPlan(ctx: Ctx, sheet: SheetRect, ts: number): void {
  const s = FLOOR_PLAN;
  const left = sheet.x + sheet.w * s.left;
  const top = sheet.y + sheet.h * s.top;
  const w = sheet.w * s.width;
  const h = sheet.h * s.height;
  drawingPen(ctx, ts, DRAWN_LINE_ALPHA);
  ctx.lineWidth = Math.max(1, ts * s.outerWallWeight);
  ctx.strokeRect(left, top, w, h);
  ctx.lineWidth = Math.max(1, ts * DRAWING_PEN_WIDTH);
  const crossX = left + w * s.crossWallAlong;
  ctx.beginPath();
  ctx.moveTo(crossX, top);
  ctx.lineTo(crossX, top + h * s.crossWallLength);
  ctx.stroke();
  const swingR = h * s.doorSwing;
  ctx.beginPath();
  ctx.moveTo(left + w * s.doorAlong, top + h);
  ctx.lineTo(left + w * s.doorAlong, top + h - swingR);
  ctx.arc(left + w * s.doorAlong, top + h, swingR, -Math.PI / 2, 0);
  ctx.stroke();
  drawingPen(ctx, ts, CONSTRUCTION_LINE_ALPHA);
  const treads = s.treads;
  const stairLeft = crossX + w * s.stairGap;
  const stairW = w * s.stairWidth;
  for (let t = 0; t <= treads; t++) {
    const ty = top + h * s.stairTop + ((h * s.stairRun) / treads) * t;
    ctx.beginPath();
    ctx.moveTo(stairLeft, ty);
    ctx.lineTo(stairLeft + stairW, ty);
    ctx.stroke();
  }
}

/**
 * The framed elevation: frame sizes are shares of a tile (the frame never
 * thinner than `minFrame` pixels), the drawing's positions shares of the
 * opening (x of its width, y of its height), the spire's half-width a share
 * of the tower's width.
 */
const FRAMED_ELEVATION = {
  minFrame: 2,
  frameWidth: 0.06,
  frameTone: 0.62,
  frameInk: 0.8,
  /** The frame's lit top edge, as a share of the frame's width. */
  frameLitEdge: 0.4,
  paperInk: 0.4,
  skyWashAlpha: 0.55,
  skyWashDepth: 0.7,
  base: 0.9,
  hallWidth: 0.8,
  hallTop: 0.56,
  towerWidth: 0.26,
  towerTop: 0.18,
  massShadeAlpha: 0.8,
  spireHalfWidth: 0.6,
  spireTip: 0.04,
  columns: 5,
  entablatureDepth: 0.04,
  groundLineFrom: 0.04,
  groundLineTo: 0.96,
} as const;

/**
 * The framed elevation over the instrument cabinet: a hall with a tall
 * central tower, colonnade and steps, drawn in ink and washed, in a plain
 * oak frame. The one building on these walls he has drawn and never built.
 */
function paintFramedElevation(ctx: Ctx, opening: SheetRect, ts: number, wood: Ramp): void {
  const s = FRAMED_ELEVATION;
  const frameW = Math.max(s.minFrame, ts * s.frameWidth);
  block(
    ctx,
    opening.x - frameW,
    opening.y - frameW,
    opening.w + frameW * 2,
    opening.h + frameW * 2,
    sampleRamp(wood, s.frameTone),
    ts,
    s.frameInk,
  );
  litEdge(
    ctx,
    opening.x - frameW,
    opening.y - frameW,
    opening.w + frameW * 2,
    frameW * s.frameLitEdge,
    sampleRamp(wood, 1),
  );
  block(ctx, opening.x, opening.y, opening.w, opening.h, PAPER, ts, s.paperInk);
  ctx.fillStyle = rgba(SKY_LOW, s.skyWashAlpha);
  ctx.fillRect(opening.x, opening.y, opening.w, opening.h * s.skyWashDepth);

  const baseY = opening.y + opening.h * s.base;
  const midX = opening.x + opening.w / 2;
  const hallW = opening.w * s.hallWidth;
  const hallTop = opening.y + opening.h * s.hallTop;
  const towerW = opening.w * s.towerWidth;
  const towerTop = opening.y + opening.h * s.towerTop;
  ctx.fillStyle = rgba(PAPER_SHADE, s.massShadeAlpha);
  ctx.fillRect(midX - hallW / 2, hallTop, hallW, baseY - hallTop);
  ctx.fillRect(midX - towerW / 2, towerTop, towerW, hallTop - towerTop);
  drawingPen(ctx, ts, DRAWN_LINE_ALPHA);
  ctx.strokeRect(midX - hallW / 2, hallTop, hallW, baseY - hallTop);
  ctx.strokeRect(midX - towerW / 2, towerTop, towerW, hallTop - towerTop);
  ctx.beginPath();
  ctx.moveTo(midX - towerW * s.spireHalfWidth, towerTop);
  ctx.lineTo(midX, opening.y + opening.h * s.spireTip);
  ctx.lineTo(midX + towerW * s.spireHalfWidth, towerTop);
  ctx.stroke();
  const columns = s.columns;
  for (let c = 0; c < columns; c++) {
    const cx = midX - hallW / 2 + (hallW * (c + 0.5)) / columns;
    ctx.beginPath();
    ctx.moveTo(cx, hallTop + opening.h * s.entablatureDepth);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(opening.x + opening.w * s.groundLineFrom, baseY);
  ctx.lineTo(opening.x + opening.w * s.groundLineTo, baseY);
  ctx.stroke();
}
// ── The architect ──────────────────────────────────────────────────────────

/** Proportions of the drafting station, in tiles unless noted. */
const DRAFTING_STATION = {
  shadowSpread: 0.46,
  window: { w: 1.2, h: 0.62, x: 0.6, up: 1.9, daylightFall: 1.0, daylightDrift: 0.12 },
  board: {
    left: 0.1,
    right: 2.2,
    backUp: 1.42,
    frontUp: 0.6,
    edgeDrop: 0.02,
    edgeThickness: 0.1,
    edgeTone: 0.52,
  },
  leg: {
    tone: 0.4,
    width: 0.08,
    leftInset: 0.22,
    rightInset: 0.3,
    topAboveFront: 0.08,
    footOverrun: 0.02,
    floorClearance: 0.04,
    ink: 0.7,
  },
  foot: { overhang: 0.06, up: 0.08, extraWidth: 0.12, height: 0.05, tone: 0.3, ink: 0.6 },
  stretcher: { inset: 0.22, up: 0.3, trim: 0.44, height: 0.05, tone: 0.45, ink: 0.6 },
  storedRolls: {
    taped: { from: 0.42, to: 1.25, up: 0.37, radius: 0.06 },
    plain: { from: 0.55, to: 1.5, up: 0.45, radius: 0.055 },
  },
  sheetA: { x: 0.12, y: 0.08, w: 1.3, h: 0.62 },
  sheetB: { x: 1.28, y: 0.16, w: 0.66, h: 0.5 },
  sheet: { ink: 0.5, shadeAlpha: 0.3, shadeFrom: 0.7, shadeWidth: 0.3, pinRadius: 0.022 },
  boardSetSquare: { x: 0.08, aboveFront: 0.06, legA: 0.44, legB: 0.26 },
  pegs: { railDrop: 0.02, pegRadius: 0.028, pegTone: 0.3 },
  tSquare: {
    x: 0.22,
    head: { x: 0.16, drop: 0.02, w: 0.32, h: 0.07, ink: 0.6 },
    blade: { x: 0.025, drop: 0.09, w: 0.05, length: 0.52, ink: 0.5 },
    bladeLitWidth: 0.018,
    bladeLitAlpha: 0.8,
  },
  hungSetSquare: { pegX: 0.44, pegDrop: 0.1, x: 0.06, drop: 0.42, legA: 0.2, legB: 0.28 },
  compass: {
    lineWidth: 0.018,
    x: 0.55,
    y: 0.2,
    leftLegDx: 0.1,
    leftLegDy: 0.26,
    rightLegDx: 0.12,
    rightLegDy: 0.25,
    hingeRadius: 0.025,
  },
  pencilLedge: { inset: 0.1, aboveFront: 0.04, trim: 0.2, height: 0.04, tone: 0.7, ink: 0.4 },
  ledgePencils: {
    aboveFront: 0.06,
    thickness: 0.025,
    ochre: { x: 0.3, length: 0.3 },
    green: { x: 0.7, length: 0.26 },
  },
  elevation: { x: 2.4, up: 1.9, w: 0.48, h: 0.52 },
  lamp: {
    clampInset: 0.05,
    clampDrop: 0.08,
    elbowDx: 0.06,
    elbowRise: 0.5,
    shadeBack: 0.42,
    shadeRise: 0.38,
    armWidth: 0.03,
    elbowRadius: 0.028,
    clamp: { x: 0.04, y: 0.02, w: 0.1, h: 0.08, ink: 0.5 },
    glow: { back: 0.04, drop: 0.34, radius: 0.55, alpha: 0.22 },
    shade: {
      rearX: 0.04,
      rearY: 0.06,
      rimX: 0.06,
      rimY: 0.02,
      lipX: 0.02,
      lipY: 0.14,
      mouthX: 0.2,
      mouthY: 0.06,
      ink: 0.6,
    },
    highlight: { x: 0.02, y: 0.04, w: 0.04, h: 0.08 },
    bulb: { back: 0.08, drop: 0.11, radius: 0.035 },
  },
  cabinet: {
    left: 2.32,
    rightInset: 0.08,
    topUp: 0.92,
    bottomUp: 0.04,
    tone: 0.5,
    drawers: 4,
    drawerStackTrim: 0.1,
    firstDrawerDrop: 0.08,
    drawerInset: 0.05,
    drawerTrim: 0.1,
    drawerGap: 0.03,
    drawerTone: 0.6,
    drawerToneStep: 0.03,
    drawerInk: 0.5,
    knobDrop: 0.45,
    knobRadius: 0.028,
  },
  worktop: {
    overhang: 0.03,
    rise: 0.05,
    extraWidth: 0.06,
    height: 0.07,
    tone: 0.7,
    litHeight: 0.018,
  },
  jar: { x: 0.14, halfW: 0.07, rise: 0.2, w: 0.14, h: 0.15, ink: 0.5 },
  jarPencils: {
    lineWidth: 0.022,
    footBack: 0.03,
    footStep: 0.03,
    footRise: 0.18,
    tipBack: 0.07,
    tipStep: 0.06,
    tipRise: 0.34,
  },
  inkBottle: { x: 0.3, rise: 0.13, size: 0.08, ink: 0.4 },
  topRoll: { from: 0.02, toInset: 0.08, rise: 0.3, radius: 0.05 },
} as const;

/**
 * The drafting station under the window: a tall drafting table with its board
 * tilted to the light, a house's elevation and its plan pinned dead square, a
 * set square and compasses on them and a brass lamp clamped to the board's
 * edge. The T-square and the 45 hang on pegs west of the window; the framed
 * elevation hangs over a narrow instrument cabinet with pencils in a jar and
 * two drawings rolled on top. Three tiles wide, rising up the wall into the
 * window's daylight.
 */
export function paintDraftingStation(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  const s = DRAFTING_STATION;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);

    const windowW = ts * s.window.w;
    const windowH = ts * s.window.h;
    const windowX = box.left + ts * s.window.x;
    const windowY = box.bottom - ts * s.window.up;
    paintWindow(ctx, windowX, windowY, windowW, windowH, ts, false);
    daylight(
      ctx,
      windowX,
      windowY + windowH,
      windowW,
      ts * s.window.daylightFall,
      ts * s.window.daylightDrift,
    );

    // Trestle legs, then the tilted board they carry.
    const boardLeft = box.left + ts * s.board.left;
    const boardRight = box.left + ts * s.board.right;
    const boardBack = box.bottom - ts * s.board.backUp;
    const boardFront = box.bottom - ts * s.board.frontUp;
    const legColor = sampleRamp(wood, s.leg.tone);
    const legW = ts * s.leg.width;
    for (const lx of [boardLeft + ts * s.leg.leftInset, boardRight - ts * s.leg.rightInset]) {
      block(
        ctx,
        lx,
        boardFront - ts * s.leg.topAboveFront,
        legW,
        box.bottom - boardFront + ts * s.leg.footOverrun - ts * s.leg.floorClearance,
        legColor,
        ts,
        s.leg.ink,
      );
      block(
        ctx,
        lx - ts * s.foot.overhang,
        box.bottom - ts * s.foot.up,
        legW + ts * s.foot.extraWidth,
        ts * s.foot.height,
        sampleRamp(wood, s.foot.tone),
        ts,
        s.foot.ink,
      );
    }
    block(
      ctx,
      boardLeft + ts * s.stretcher.inset,
      box.bottom - ts * s.stretcher.up,
      boardRight - boardLeft - ts * s.stretcher.trim,
      ts * s.stretcher.height,
      sampleRamp(wood, s.stretcher.tone),
      ts,
      s.stretcher.ink,
    );
    // Rolled drawings stored on the stretcher.
    const tapedRoll = s.storedRolls.taped;
    rollSide(
      ctx,
      boardLeft + ts * tapedRoll.from,
      boardLeft + ts * tapedRoll.to,
      box.bottom - ts * tapedRoll.up,
      ts * tapedRoll.radius,
      ts,
      TAPE_RED,
    );
    const plainRoll = s.storedRolls.plain;
    rollSide(
      ctx,
      boardLeft + ts * plainRoll.from,
      boardLeft + ts * plainRoll.to,
      box.bottom - ts * plainRoll.up,
      ts * plainRoll.radius,
      ts,
      null,
    );

    // The board: a thick edge under a pale lime surface.
    block(
      ctx,
      boardLeft,
      boardFront - ts * s.board.edgeDrop,
      boardRight - boardLeft,
      ts * s.board.edgeThickness,
      sampleRamp(wood, s.board.edgeTone),
      ts,
    );
    ctx.fillStyle = rgb(PINE_LIGHT);
    ctx.beginPath();
    ctx.rect(boardLeft, boardBack, boardRight - boardLeft, boardFront - boardBack);
    ctx.fill();
    inkOutline(ctx, ts);
    // Pinned sheets, squared to the board's edges.
    const sheetA = {
      x: boardLeft + ts * s.sheetA.x,
      y: boardBack + ts * s.sheetA.y,
      w: ts * s.sheetA.w,
      h: ts * s.sheetA.h,
    };
    const sheetB = {
      x: boardLeft + ts * s.sheetB.x,
      y: boardBack + ts * s.sheetB.y,
      w: ts * s.sheetB.w,
      h: ts * s.sheetB.h,
    };
    for (const sheet of [sheetA, sheetB]) {
      block(ctx, sheet.x, sheet.y, sheet.w, sheet.h, PAPER, ts, s.sheet.ink);
      ctx.fillStyle = rgba(PAPER_SHADE, s.sheet.shadeAlpha);
      ctx.fillRect(
        sheet.x + sheet.w * s.sheet.shadeFrom,
        sheet.y,
        sheet.w * s.sheet.shadeWidth,
        sheet.h,
      );
      for (const [px, py] of [
        [sheet.x, sheet.y],
        [sheet.x + sheet.w, sheet.y],
        [sheet.x, sheet.y + sheet.h],
        [sheet.x + sheet.w, sheet.y + sheet.h],
      ]) {
        disc(ctx, px, py, Math.max(1, ts * s.sheet.pinRadius), BRASS);
      }
    }
    paintHouseElevation(ctx, sheetA, ts);
    paintFloorPlan(ctx, sheetB, ts);
    // The 30/60 set square left on the board, over the plan's corner.
    paintSetSquare(
      ctx,
      sheetB.x + sheetB.w * s.boardSetSquare.x,
      boardFront - ts * s.boardSetSquare.aboveFront,
      ts * s.boardSetSquare.legA,
      ts * s.boardSetSquare.legB,
      SET_SQUARE_CLEAR,
      ts,
    );
    // The T-square and the 45 hang on their own pegs west of the window,
    // squared to the wall, where he put them when the drawing was done.
    const pegRailY = windowY + ts * s.pegs.railDrop;
    const tSquare = s.tSquare;
    const tSquareX = box.left + ts * tSquare.x;
    disc(
      ctx,
      tSquareX,
      pegRailY,
      Math.max(1, ts * s.pegs.pegRadius),
      sampleRamp(wood, s.pegs.pegTone),
    );
    block(
      ctx,
      tSquareX - ts * tSquare.head.x,
      pegRailY + ts * tSquare.head.drop,
      ts * tSquare.head.w,
      ts * tSquare.head.h,
      ROSEWOOD,
      ts,
      tSquare.head.ink,
    );
    block(
      ctx,
      tSquareX - ts * tSquare.blade.x,
      pegRailY + ts * tSquare.blade.drop,
      ts * tSquare.blade.w,
      ts * tSquare.blade.length,
      BEECH,
      ts,
      tSquare.blade.ink,
    );
    litEdge(
      ctx,
      tSquareX - ts * tSquare.blade.x,
      pegRailY + ts * tSquare.blade.drop,
      ts * tSquare.bladeLitWidth,
      ts * tSquare.blade.length,
      PINE_LIGHT,
      tSquare.bladeLitAlpha,
    );
    const hung = s.hungSetSquare;
    const setSquarePegX = box.left + ts * hung.pegX;
    disc(
      ctx,
      setSquarePegX,
      pegRailY + ts * hung.pegDrop,
      Math.max(1, ts * s.pegs.pegRadius),
      sampleRamp(wood, s.pegs.pegTone),
    );
    paintSetSquare(
      ctx,
      setSquarePegX - ts * hung.x,
      pegRailY + ts * hung.drop,
      ts * hung.legA,
      ts * hung.legB,
      SET_SQUARE_AMBER,
      ts,
    );
    // Compasses, open, laid on the smaller sheet.
    const compass = s.compass;
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * compass.lineWidth);
    const compassX = sheetB.x + sheetB.w * compass.x;
    const compassY = sheetB.y + sheetB.h * compass.y;
    ctx.beginPath();
    ctx.moveTo(compassX - ts * compass.leftLegDx, compassY + ts * compass.leftLegDy);
    ctx.lineTo(compassX, compassY);
    ctx.lineTo(compassX + ts * compass.rightLegDx, compassY + ts * compass.rightLegDy);
    ctx.stroke();
    disc(ctx, compassX, compassY, Math.max(1, ts * compass.hingeRadius), BRASS_LIGHT);
    // Pencil ledge along the front edge, with two pencils.
    block(
      ctx,
      boardLeft + ts * s.pencilLedge.inset,
      boardFront - ts * s.pencilLedge.aboveFront,
      boardRight - boardLeft - ts * s.pencilLedge.trim,
      ts * s.pencilLedge.height,
      sampleRamp(wood, s.pencilLedge.tone),
      ts,
      s.pencilLedge.ink,
    );
    const pencils = s.ledgePencils;
    block(
      ctx,
      boardLeft + ts * pencils.ochre.x,
      boardFront - ts * pencils.aboveFront,
      ts * pencils.ochre.length,
      ts * pencils.thickness,
      [196, 150, 60],
      ts,
      0,
    );
    block(
      ctx,
      boardLeft + ts * pencils.green.x,
      boardFront - ts * pencils.aboveFront,
      ts * pencils.green.length,
      ts * pencils.thickness,
      [70, 96, 70],
      ts,
      0,
    );

    const elevationOpening: SheetRect = {
      x: box.left + ts * s.elevation.x,
      y: box.bottom - ts * s.elevation.up,
      w: ts * s.elevation.w,
      h: ts * s.elevation.h,
    };
    paintFramedElevation(ctx, elevationOpening, ts, wood);

    // The lamp: clamped to the board's right edge, its arm over the sheets.
    const lamp = s.lamp;
    const clampX = boardRight - ts * lamp.clampInset;
    const clampY = boardBack + ts * lamp.clampDrop;
    const elbowX = clampX + ts * lamp.elbowDx;
    const elbowY = clampY - ts * lamp.elbowRise;
    const shadeX = clampX - ts * lamp.shadeBack;
    const shadeY = clampY - ts * lamp.shadeRise;
    ctx.strokeStyle = rgb(BRASS_DARK);
    ctx.lineWidth = Math.max(1, ts * lamp.armWidth);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(clampX, clampY);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(shadeX, shadeY);
    ctx.stroke();
    ctx.lineCap = 'butt';
    disc(ctx, elbowX, elbowY, ts * lamp.elbowRadius, BRASS);
    block(
      ctx,
      clampX - ts * lamp.clamp.x,
      clampY - ts * lamp.clamp.y,
      ts * lamp.clamp.w,
      ts * lamp.clamp.h,
      BRASS_DARK,
      ts,
      lamp.clamp.ink,
    );
    glow(
      ctx,
      shadeX - ts * lamp.glow.back,
      shadeY + ts * lamp.glow.drop,
      ts * lamp.glow.radius,
      EMBER_GLOW,
      lamp.glow.alpha,
    );
    const shade = lamp.shade;
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.moveTo(shadeX - ts * shade.rearX, shadeY - ts * shade.rearY);
    ctx.lineTo(shadeX + ts * shade.rimX, shadeY - ts * shade.rimY);
    ctx.lineTo(shadeX + ts * shade.lipX, shadeY + ts * shade.lipY);
    ctx.lineTo(shadeX - ts * shade.mouthX, shadeY + ts * shade.mouthY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * shade.ink);
    ctx.fillStyle = rgb(BRASS_LIGHT);
    ctx.fillRect(
      shadeX - ts * lamp.highlight.x,
      shadeY - ts * lamp.highlight.y,
      ts * lamp.highlight.w,
      ts * lamp.highlight.h,
    );
    disc(
      ctx,
      shadeX - ts * lamp.bulb.back,
      shadeY + ts * lamp.bulb.drop,
      ts * lamp.bulb.radius,
      FLAME_CORE,
    );

    // The instrument cabinet at the east end: four drawers under a worktop.
    const cab = s.cabinet;
    const cabLeft = box.left + ts * cab.left;
    const cabRight = box.right - ts * cab.rightInset;
    const cabTop = box.bottom - ts * cab.topUp;
    const cabBottom = box.bottom - ts * cab.bottomUp;
    block(
      ctx,
      cabLeft,
      cabTop,
      cabRight - cabLeft,
      cabBottom - cabTop,
      sampleRamp(wood, cab.tone),
      ts,
    );
    const drawerH = (cabBottom - cabTop - ts * cab.drawerStackTrim) / cab.drawers;
    for (let i = 0; i < cab.drawers; i++) {
      const dy = cabTop + ts * cab.firstDrawerDrop + drawerH * i;
      block(
        ctx,
        cabLeft + ts * cab.drawerInset,
        dy,
        cabRight - cabLeft - ts * cab.drawerTrim,
        drawerH - ts * cab.drawerGap,
        sampleRamp(wood, cab.drawerTone - i * cab.drawerToneStep),
        ts,
        cab.drawerInk,
      );
      disc(
        ctx,
        (cabLeft + cabRight) / 2,
        dy + drawerH * cab.knobDrop,
        Math.max(1, ts * cab.knobRadius),
        BRASS,
      );
    }
    const top = s.worktop;
    block(
      ctx,
      cabLeft - ts * top.overhang,
      cabTop - ts * top.rise,
      cabRight - cabLeft + ts * top.extraWidth,
      ts * top.height,
      sampleRamp(wood, top.tone),
      ts,
    );
    litEdge(
      ctx,
      cabLeft - ts * top.overhang,
      cabTop - ts * top.rise,
      cabRight - cabLeft + ts * top.extraWidth,
      ts * top.litHeight,
      sampleRamp(wood, 1),
    );
    // On top: a jar of pencils, a bottle of ink, two drawings rolled and tied.
    const jar = s.jar;
    const jarX = cabLeft + ts * jar.x;
    block(
      ctx,
      jarX - ts * jar.halfW,
      cabTop - ts * jar.rise,
      ts * jar.w,
      ts * jar.h,
      [120, 150, 140],
      ts,
      jar.ink,
    );
    const pencilColors: readonly RGB[] = [
      [196, 150, 60],
      [70, 96, 70],
      [150, 58, 48],
    ];
    const jarPencils = s.jarPencils;
    pencilColors.forEach((color, i) => {
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = Math.max(1, ts * jarPencils.lineWidth);
      ctx.beginPath();
      ctx.moveTo(
        jarX - ts * jarPencils.footBack + i * ts * jarPencils.footStep,
        cabTop - ts * jarPencils.footRise,
      );
      ctx.lineTo(
        jarX - ts * jarPencils.tipBack + i * ts * jarPencils.tipStep,
        cabTop - ts * jarPencils.tipRise,
      );
      ctx.stroke();
    });
    block(
      ctx,
      cabLeft + ts * s.inkBottle.x,
      cabTop - ts * s.inkBottle.rise,
      ts * s.inkBottle.size,
      ts * s.inkBottle.size,
      SOOT,
      ts,
      s.inkBottle.ink,
    );
    rollSide(
      ctx,
      cabLeft + ts * s.topRoll.from,
      cabRight - ts * s.topRoll.toInset,
      cabTop - ts * s.topRoll.rise,
      ts * s.topRoll.radius,
      ts,
      TAPE_BLUE,
    );
  });
}

/**
 * Proportions of the plan chest, in tiles unless noted. Roll placements are
 * fractions of a pigeonhole, one table for holes of three rolls and one for
 * holes of four.
 */
const PLAN_CHEST = {
  sideInset: 0.06,
  bottomUp: 0.04,
  chestHeight: 0.62,
  rackHeight: 0.94,
  rack: {
    inset: 0.04,
    trim: 0.08,
    tone: 0.45,
    cols: 5,
    rows: 3,
    gridTrim: 0.16,
    gridHeightTrim: 0.1,
    gridInset: 0.08,
    gridDrop: 0.06,
    cellGap: 0.03,
    cellTone: 0.12,
    cellInk: 0.4,
    fewestRolls: 3,
    rollRadius: 0.19,
    rollJitter: 0.1,
    threeAcross: [0.28, 0.66, 0.47],
    threeUp: [0.66, 0.66, 0.34],
    fourAcross: [0.26, 0.64, 0.3, 0.7],
    fourUp: [0.68, 0.66, 0.32, 0.34],
  },
  cap: { overhang: 0.02, rise: 0.06, extraWidth: 0.04, height: 0.08, tone: 0.66, litHeight: 0.018 },
  capRolls: {
    taped: { from: 0.1, toFraction: 0.72, rise: 0.12, radius: 0.06 },
    plain: { fromFraction: 0.3, toInset: 0.08, rise: 0.23, radius: 0.055 },
  },
  chest: { tone: 0.48 },
  chestTop: { overhang: 0.03, rise: 0.03, extraWidth: 0.06, height: 0.06, tone: 0.7 },
  drawers: {
    count: 5,
    stackTrim: 0.08,
    firstDrop: 0.05,
    inset: 0.05,
    trim: 0.1,
    gap: 0.02,
    tone: 0.58,
    toneStep: 0.02,
    ink: 0.4,
  },
  hardware: {
    at: [0.28, 0.72],
    cupDrop: 0.52,
    cupRadiusX: 0.06,
    cupRadiusY: 0.22,
    cardHalfW: 0.05,
    cardDrop: 0.14,
    cardW: 0.1,
    cardH: 0.28,
    cardInk: 0.3,
  },
} as const;

/**
 * The plan chest: five wide shallow drawers with brass cups and blank card
 * frames, carrying a pigeonhole rack where every hole is stuffed with rolled
 * drawings, a few tied, and more laid across the top because the rack ran out
 * of holes. A man who keeps every plan he is given.
 */
export function paintPlanChest(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  const s = PLAN_CHEST;
  const holdsBlueprints = variant === PLAN_CHEST_VARIANT.withBlueprints;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame);
    const left = box.left + ts * s.sideInset;
    const right = box.right - ts * s.sideInset;
    const width = right - left;
    const bottom = box.bottom - ts * s.bottomUp;
    const chestTop = bottom - ts * s.chestHeight;
    const rackTop = chestTop - ts * s.rackHeight;

    // Pigeonhole rack: a dark carcass, then a grid of holes full of rolls.
    const rack = s.rack;
    block(
      ctx,
      left + ts * rack.inset,
      rackTop,
      width - ts * rack.trim,
      chestTop - rackTop,
      sampleRamp(wood, rack.tone),
      ts,
    );
    const cols = rack.cols;
    const rows = rack.rows;
    const cellW = (width - ts * rack.gridTrim) / cols;
    const cellH = (chestTop - rackTop - ts * rack.gridHeightTrim) / rows;
    const tapes: readonly (RGB | null)[] = [TAPE_RED, null, null, TAPE_BLUE, null, null, null];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = left + ts * rack.gridInset + cellW * c;
        const cy = rackTop + ts * rack.gridDrop + cellH * r;
        block(
          ctx,
          cx,
          cy,
          cellW - ts * rack.cellGap,
          cellH - ts * rack.cellGap,
          sampleRamp(wood, rack.cellTone),
          ts,
          rack.cellInk,
        );
        const rolls = rack.fewestRolls + ((r + c) % 2);
        const rr = Math.min(cellW, cellH) * rack.rollRadius;
        const isThreeRollHole = rolls === rack.fewestRolls;
        for (let i = 0; i < rolls; i++) {
          const across = isThreeRollHole ? rack.threeAcross[i] : rack.fourAcross[i];
          const up = isThreeRollHole ? rack.threeUp[i] : rack.fourUp[i];
          const tape = tapes[(r * cols + c + i) % tapes.length];
          rollEnd(
            ctx,
            cx + cellW * across + jitter(rng, rr * rack.rollJitter),
            cy + cellH * up,
            rr,
            ts,
            tape,
          );
        }
      }
    }
    // The cap, and the rolls laid across it because the holes ran out.
    const cap = s.cap;
    block(
      ctx,
      left - ts * cap.overhang,
      rackTop - ts * cap.rise,
      width + ts * cap.extraWidth,
      ts * cap.height,
      sampleRamp(wood, cap.tone),
      ts,
    );
    litEdge(
      ctx,
      left - ts * cap.overhang,
      rackTop - ts * cap.rise,
      width + ts * cap.extraWidth,
      ts * cap.litHeight,
      sampleRamp(wood, 1),
    );
    const tapedRoll = s.capRolls.taped;
    rollSide(
      ctx,
      left + ts * tapedRoll.from,
      left + width * tapedRoll.toFraction,
      rackTop - ts * tapedRoll.rise,
      ts * tapedRoll.radius,
      ts,
      TAPE_RED,
    );
    const plainRoll = s.capRolls.plain;
    rollSide(
      ctx,
      left + width * plainRoll.fromFraction,
      right - ts * plainRoll.toInset,
      rackTop - ts * plainRoll.rise,
      ts * plainRoll.radius,
      ts,
      null,
    );

    // The chest: five shallow drawers, each with a brass cup and a card frame.
    block(ctx, left, chestTop, width, bottom - chestTop, sampleRamp(wood, s.chest.tone), ts);
    block(
      ctx,
      left - ts * s.chestTop.overhang,
      chestTop - ts * s.chestTop.rise,
      width + ts * s.chestTop.extraWidth,
      ts * s.chestTop.height,
      sampleRamp(wood, s.chestTop.tone),
      ts,
    );
    const drawers = s.drawers;
    const hardware = s.hardware;
    const drawerH = (bottom - chestTop - ts * drawers.stackTrim) / drawers.count;
    for (let i = 0; i < drawers.count; i++) {
      const dy = chestTop + ts * drawers.firstDrop + drawerH * i;
      block(
        ctx,
        left + ts * drawers.inset,
        dy,
        width - ts * drawers.trim,
        drawerH - ts * drawers.gap,
        sampleRamp(wood, drawers.tone - i * drawers.toneStep),
        ts,
        drawers.ink,
      );
      for (const at of hardware.at) {
        const px = left + width * at;
        ctx.fillStyle = rgb(BRASS);
        ctx.beginPath();
        ctx.ellipse(
          px,
          dy + drawerH * hardware.cupDrop,
          ts * hardware.cupRadiusX,
          drawerH * hardware.cupRadiusY,
          0,
          0,
          Math.PI,
        );
        ctx.fill();
        block(
          ctx,
          px - ts * hardware.cardHalfW,
          dy + drawerH * hardware.cardDrop,
          ts * hardware.cardW,
          drawerH * hardware.cardH,
          PAPER,
          ts,
          hardware.cardInk,
        );
      }
    }
    if (holdsBlueprints) paintBlueprintsInDrawer(ctx, left, width, chestTop, drawerH, ts);
  });
}

/** Proportions of the blueprint folio in the open drawer, in tiles unless noted. */
const BLUEPRINTS_IN_DRAWER = {
  gapDrop: 0.02,
  gap: { inset: 0.05, trim: 0.1, height: 0.06 },
  folioLeft: 0.16,
  folioWidth: 0.62,
  sheets: 3,
  sheetRise: 0.1,
  sheetRiseStep: 0.025,
  sheetStep: 0.05,
  sheetTrimStep: 0.08,
  sheetBelowGap: 0.05,
  sheetLightenStep: 0.3,
  sheetInk: 0.45,
  lineAlpha: 0.85,
  line: { inset: 0.06, rise: 0.05, reach: 0.7 },
  tape: { at: 0.34, width: 0.035, rise: 0.1, overhang: 0.14 },
  tag: { w: 0.14, h: 0.1, tapeOffset: 0.3, drop: 0.04, pointStart: 0.8, ink: 0.4 },
} as const;

/**
 * Fenna's blueprints in the plan chest's top drawer, which is left standing
 * a finger open because the folio is too fat for it: the cyan sheets show in
 * the gap, their tied green tape and its luggage tag hang over the drawer
 * front. Blue against a chest of cream paper is what finds them at a glance.
 */
function paintBlueprintsInDrawer(
  ctx: Ctx,
  left: number,
  width: number,
  chestTop: number,
  drawerH: number,
  ts: number,
): void {
  const s = BLUEPRINTS_IN_DRAWER;
  const gapTop = chestTop + ts * s.gapDrop;
  block(
    ctx,
    left + ts * s.gap.inset,
    gapTop,
    width - ts * s.gap.trim,
    ts * s.gap.height,
    SOOT,
    ts,
    0,
  );
  const folioLeft = left + width * s.folioLeft;
  const folioW = width * s.folioWidth;
  for (let i = 0; i < s.sheets; i++) {
    const rise = ts * (s.sheetRise - i * s.sheetRiseStep);
    block(
      ctx,
      folioLeft + i * ts * s.sheetStep,
      gapTop - rise,
      folioW - i * ts * s.sheetTrimStep,
      rise + ts * s.sheetBelowGap,
      mix(BLUEPRINT, BLUEPRINT_LIGHT, i * s.sheetLightenStep),
      ts,
      s.sheetInk,
    );
  }
  ctx.strokeStyle = rgba(BLUEPRINT_LINE, s.lineAlpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(folioLeft + ts * s.line.inset, gapTop - ts * s.line.rise);
  ctx.lineTo(folioLeft + folioW * s.line.reach, gapTop - ts * s.line.rise);
  ctx.stroke();
  const tapeX = folioLeft + folioW * s.tape.at;
  const tapeW = Math.max(1, ts * s.tape.width);
  block(
    ctx,
    tapeX,
    gapTop - ts * s.tape.rise,
    tapeW,
    drawerH + ts * s.tape.overhang,
    BLUEPRINT_TAPE,
    ts,
    0,
  );
  const tagW = ts * s.tag.w;
  const tagH = ts * s.tag.h;
  const tagX = tapeX - tagW * s.tag.tapeOffset;
  const tagY = chestTop + drawerH + ts * s.tag.drop;
  ctx.fillStyle = rgb(PAPER);
  ctx.beginPath();
  ctx.moveTo(tagX, tagY);
  ctx.lineTo(tagX + tagW * s.tag.pointStart, tagY);
  ctx.lineTo(tagX + tagW, tagY + tagH / 2);
  ctx.lineTo(tagX + tagW * s.tag.pointStart, tagY + tagH);
  ctx.lineTo(tagX, tagY + tagH);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * s.tag.ink);
}

/** Proportions of the roll bin, in tiles unless noted. */
const ROLL_BIN = {
  shadowSpread: 0.34,
  binWidth: 0.64,
  bottomUp: 0.06,
  binHeight: 0.5,
  rolls: 7,
  rollInset: 0.06,
  rollSpanTrim: 0.12,
  /** Base height plus a stepped pseudo-random spread so no two neighbours stand level. */
  rollHeight: 0.82,
  rollHeightScramble: 7,
  rollHeightSteps: 5,
  rollHeightStep: 0.07,
  rollHeightJitter: 0.03,
  rollLean: 0.26,
  rollBaseDrop: 0.1,
  rollBuried: 0.5,
  rollRadius: 0.045,
  wallTone: 0.5,
  wallBoards: 3,
  dovetail: {
    tone: 0.75,
    count: 3,
    depth: 0.08,
    rootTop: 0.2,
    flareTop: 0.1,
    flareBottom: 0.9,
    rootBottom: 0.8,
  },
  rimHeight: 0.02,
} as const;

/**
 * A squared oak bin with dovetailed corners, standing full of rolled drawings
 * on end — the overflow of the plan chest beside it.
 */
export function paintRollBin(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = ROLL_BIN;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const binW = ts * s.binWidth;
    const binLeft = box.centreX - binW / 2;
    const binBottom = box.bottom - ts * s.bottomUp;
    const binTop = binBottom - ts * s.binHeight;
    // The rolls first, so the bin's front wall stands in front of their feet.
    const rolls = s.rolls;
    const tapes: readonly (RGB | null)[] = [null, TAPE_RED, null, null, TAPE_BLUE, null, TAPE_RED];
    for (let i = 0; i < rolls; i++) {
      const t = (i + 0.5) / rolls;
      const x = binLeft + ts * s.rollInset + (binW - ts * s.rollSpanTrim) * t;
      const height =
        ts *
        (s.rollHeight +
          ((i * s.rollHeightScramble) % s.rollHeightSteps) * s.rollHeightStep +
          jitter(rng, s.rollHeightJitter));
      const lean = (t - 0.5) * ts * s.rollLean;
      rollUpright(
        ctx,
        x,
        binTop + ts * s.rollBaseDrop,
        height - ts * s.rollBuried,
        ts * s.rollRadius,
        lean,
        ts,
        tapes[i],
      );
    }
    block(ctx, binLeft, binTop, binW, binBottom - binTop, sampleRamp(wood, s.wallTone), ts);
    paintPlankBoard(ctx, binLeft, binTop, binW, binBottom - binTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: (binBottom - binTop) / s.wallBoards,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(binLeft, binTop, binW, binBottom - binTop);
    inkOutline(ctx, ts);
    // Dovetails at both corners: the joint a carpenter shows off.
    const tail = s.dovetail;
    ctx.fillStyle = rgb(sampleRamp(wood, tail.tone));
    const tailH = (binBottom - binTop) / tail.count;
    for (let i = 0; i < tail.count; i++) {
      for (const [edge, dir] of [
        [binLeft, 1],
        [binLeft + binW, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(edge, binTop + tailH * i + tailH * tail.rootTop);
        ctx.lineTo(edge + dir * ts * tail.depth, binTop + tailH * i + tailH * tail.flareTop);
        ctx.lineTo(edge + dir * ts * tail.depth, binTop + tailH * i + tailH * tail.flareBottom);
        ctx.lineTo(edge, binTop + tailH * i + tailH * tail.rootBottom);
        ctx.closePath();
        ctx.fill();
      }
    }
    litEdge(ctx, binLeft, binTop, binW, ts * s.rimHeight, sampleRamp(wood, 1));
  });
}

// ── The builder ────────────────────────────────────────────────────────────

/** Proportions of the tool wall, in tiles unless a key says it is a ratio, tone, alpha or ink weight. */
const TOOL_WALL = {
  shadowSpread: 0.46,
  sideInset: 0.06,
  board: {
    topUp: 2.02,
    bottomUp: 0.9,
    plankPx: 0.28,
    frameWidth: 0.06,
    frameTone: 0.55,
  },
  peg: { radius: 0.025, tone: 0.3 },
  sawRowDrop: 0.12,
  handSaw: {
    bladeDrop: 0.08,
    /** An unbacked panel saw tapers: its toe is this fraction of the heel's depth. */
    toeDepthRatio: 0.55,
    handleBackX: 0.18,
    handleWidth: 0.2,
    handleHeight: 0.24,
    handleRadius: 0.05,
    bladeInk: 0.6,
    glintAlpha: 0.7,
    glintInset: 0.03,
    glintDrop: 0.1,
    glintLengthRatio: 0.8,
    glintThickness: 0.018,
    backDrop: 0.06,
    backHeight: 0.05,
    backInk: 0.4,
    handleInk: 0.55,
    gripX: 0.08,
    gripY: 0.12,
    gripRadiusX: 0.04,
    gripRadiusY: 0.06,
    pegX: 0.08,
    pegDrop: 0.02,
  },
  panelSaw: { x: 0.3, bladeWidth: 0.7, bladeHeight: 0.26 },
  tenonSaw: { x: 1.26, bladeWidth: 0.46, bladeHeight: 0.18 },
  bowSaw: {
    left: 1.95,
    right: 2.72,
    frameWidth: 0.05,
    cheekLength: 0.4,
    stretcherDrop: 0.2,
    bladeWidth: 0.025,
    bladeDrop: 0.36,
    cordWidth: 0.018,
    cordDrop: 0.03,
    pegDrop: 0.02,
  },
  middleRowDrop: 0.56,
  chisels: {
    rackX: 0.12,
    count: 6,
    pitch: 0.1,
    railOverhang: 0.04,
    railHeight: 0.05,
    railTone: 0.5,
    railInk: 0.5,
    /** Where in its pitch each chisel's slot sits. */
    slotPhase: 0.3,
    bladeWidthBase: 0.018,
    bladeWidthStep: 0.008,
    bladeDrop: 0.05,
    bladeLength: 0.18,
    handleHalfWidth: 0.022,
    handleRise: 0.13,
    handleWidth: 0.044,
    handleLength: 0.13,
    ink: 0.4,
  },
  mallet: {
    x: 0.86,
    handleHalfWidth: 0.02,
    handleRise: 0.02,
    handleWidth: 0.04,
    handleLength: 0.3,
    headHalfWidth: 0.1,
    headRise: 0.12,
    headWidth: 0.2,
    headHeight: 0.12,
    handleInk: 0.4,
    headInk: 0.6,
    litThickness: 0.02,
    litAlpha: 0.8,
    pegDrop: 0.02,
  },
  trySquare: {
    x: 1.06,
    stockRise: 0.1,
    stockWidth: 0.06,
    stockLength: 0.26,
    bladeRise: 0.08,
    bladeLength: 0.22,
    bladeWidth: 0.04,
    stockInk: 0.5,
    bladeInk: 0.4,
    rivetDrops: [0, 0.08, 0.16],
    rivetX: 0.03,
    rivetRise: 0.06,
    rivetRadius: 0.012,
  },
  framingSquare: {
    x: 1.42,
    tongueRise: 0.14,
    stockWidth: 0.05,
    heelDrop: 0.18,
    bladeReach: 0.36,
    footDrop: 0.23,
    ink: 0.45,
    tickAlpha: 0.7,
    /** Loop bound: ticks run 1..tickEnd-1, leaving the heel unmarked. */
    tickEnd: 6,
    tickPitch: 0.05,
    tickTopDrop: 0.18,
    tickBottomDrop: 0.2,
  },
  dividers: {
    x: 1.95,
    lineWidth: 0.02,
    legSpread: 0.06,
    pointDrop: 0.2,
    hingeRise: 0.08,
    hingeRadius: 0.026,
  },
  plumbBob: {
    x: 2.2,
    pegRise: 0.12,
    bobTopDrop: 0.08,
    capHalfWidth: 0.03,
    shoulderHalfWidth: 0.06,
    shoulderDrop: 0.14,
    tipDrop: 0.26,
    ink: 0.45,
    glintAlpha: 0.9,
    glintX: 0.035,
    glintDrop: 0.11,
    glintWidth: 0.02,
    glintHeight: 0.06,
  },
  brace: {
    x: 2.52,
    lineWidth: 0.022,
    headRise: 0.12,
    crankTopRise: 0.02,
    crankThrow: 0.12,
    crankBottomDrop: 0.12,
    bitTipDrop: 0.22,
    padRise: 0.13,
    padRadius: 0.04,
    gripX: 0.1,
    gripDrop: 0.02,
    gripWidth: 0.05,
    gripHeight: 0.08,
    gripInk: 0.4,
  },
  level: {
    riseFromBoardBottom: 0.34,
    x: 0.2,
    length: 1.3,
    height: 0.08,
    pegInset: 0.15,
    pegDrop: 0.1,
    bodyInk: 0.6,
    capLength: 0.08,
    capInk: 0.4,
    windowHalfWidth: 0.1,
    windowDrop: 0.015,
    windowWidth: 0.2,
    windowHeight: 0.05,
    windowInk: 0.3,
    vialHalfWidth: 0.075,
    vialDrop: 0.025,
    vialWidth: 0.15,
    vialHeight: 0.03,
    bubbleDrop: 0.04,
    bubbleRadius: 0.012,
  },
  ruleOutline: { gap: 0.36, drop: 0.04, width: 0.2, height: 0.05, pegX: 0.1, pegDrop: 0.025 },
  plane: {
    shelfRise: 0.08,
    ink: 0.5,
    litThickness: 0.015,
    litAlpha: 0.8,
    toteRatio: 0.62,
    toteRise: 0.1,
    toteWidth: 0.1,
    toteHeight: 0.12,
    toteRadius: 0.03,
    toteInk: 0.4,
    knobRatio: 0.2,
    knobRise: 0.03,
    knobRadius: 0.035,
    wedgeRatio: 0.42,
    wedgeRise: 0.04,
    wedgeWidth: 0.04,
    wedgeHeight: 0.05,
  },
  /** The shelf of planes, west to east: jack, smoothing, block, then two wooden moulding planes. */
  planes: [
    { x: 0.14, length: 0.72, height: 0.08, wooden: false },
    { x: 1.0, length: 0.46, height: 0.08, wooden: false },
    { x: 1.6, length: 0.26, height: 0.07, wooden: false },
    { x: 2.0, length: 0.36, height: 0.1, wooden: true },
    { x: 2.44, length: 0.36, height: 0.1, wooden: true },
  ],
  planeShelf: {
    inset: 0.04,
    trim: 0.08,
    height: 0.05,
    tone: 0.62,
    ink: 0.6,
    litThickness: 0.015,
  },
  bench: {
    topUp: 0.64,
    topHeight: 0.13,
    legWidth: 0.12,
    underShelfUp: 0.24,
    legInset: 0.08,
    footLift: 0.04,
    legTone: 0.42,
    legInk: 0.7,
    underShelfTrim: 0.16,
    underShelfHeight: 0.05,
    underShelfTone: 0.5,
    underShelfInk: 0.6,
    topLitThickness: 0.03,
    topLitAlpha: 0.85,
    frontShadeAlpha: 0.5,
    frontShadeFrom: 0.6,
    frontShadeDepth: 0.4,
  },
  offcuts: {
    count: 5,
    longestRatio: 0.7,
    shortenRatio: 0.1,
    x: 0.22,
    step: 0.045,
    height: 0.04,
    alternateShade: 0.3,
    ink: 0.35,
  },
  vice: {
    chopOverhang: 0.02,
    chopWidth: 0.26,
    chopHeight: 0.2,
    chopInk: 0.6,
    screwX: 0.11,
    screwDrop: 0.1,
    screwRadius: 0.04,
    barWidth: 0.02,
    barStartDrop: 0.1,
    barEndX: 0.24,
    barEndDrop: 0.14,
  },
  benchPlane: {
    x: 0.7,
    rise: 0.08,
    length: 0.42,
    height: 0.08,
    ink: 0.5,
    litThickness: 0.015,
    litAlpha: 0.8,
  },
  markingGauge: {
    stockX: 1.4,
    stockRise: 0.05,
    stockLength: 0.22,
    stockHeight: 0.05,
    fenceX: 1.48,
    fenceRise: 0.1,
    fenceWidth: 0.05,
    fenceHeight: 0.1,
    ink: 0.4,
  },
  foldingRule: { x: 1.84, rise: 0.035, length: 0.46, height: 0.035, ink: 0.35 },
  pencil: { x: 2.4, rise: 0.03, length: 0.22, height: 0.025 },
} as const;

/**
 * The tool wall over the joiner's bench. A planed pine board with an oak
 * frame carries every tool in order, each hung over its own painted outline,
 * and one outline stands empty — the folding rule's, because it is on his
 * belt. Three saws by size across the top; a
 * rack of six chisels graded narrow to wide, the mallet, try square, framing
 * square, dividers, and a plumb bob hanging dead still on its line; the spirit
 * level on its own two pegs; a shelf of planes. Beneath, a thick beech bench
 * with its vice, a plane laid on its side the way a joiner leaves one, and
 * offcuts sorted by length on the shelf underneath.
 */
export function paintToolWall(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = TOOL_WALL;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.sideInset;
    const right = box.right - ts * s.sideInset;
    const width = right - left;

    const boardTop = box.bottom - ts * s.board.topUp;
    const boardBottom = box.bottom - ts * s.board.bottomUp;
    paintPlankBoard(ctx, left, boardTop, width, boardBottom - boardTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * s.board.plankPx,
      ramp: { shadow: PINE_DARK, mid: PINE, light: PINE_LIGHT, accent: PINE_LIGHT },
    });
    ctx.beginPath();
    ctx.rect(left, boardTop, width, boardBottom - boardTop);
    inkOutline(ctx, ts);
    const frameW = ts * s.board.frameWidth;
    ctx.fillStyle = rgb(sampleRamp(wood, s.board.frameTone));
    ctx.fillRect(left, boardTop, width, frameW);
    ctx.fillRect(left, boardTop, frameW, boardBottom - boardTop);
    ctx.fillRect(right - frameW, boardTop, frameW, boardBottom - boardTop);

    // Each tool's outline is painted on the board behind it, a hand's width
    // bigger than the tool, so an empty place says what belongs there.
    const outlineReach = ts * TOOL_OUTLINE_REACH;
    const paintedOutline = (trace: () => void): void => {
      ctx.save();
      ctx.fillStyle = rgb(TOOL_OUTLINE_PAINT);
      ctx.strokeStyle = rgb(TOOL_OUTLINE_PAINT);
      ctx.lineWidth = outlineReach;
      ctx.lineJoin = 'round';
      trace();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    const outlineRect = (x: number, y: number, w: number, h: number): void =>
      paintedOutline(() => {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
      });
    const peg = (x: number, y: number): void =>
      disc(ctx, x, y, Math.max(1, ts * s.peg.radius), sampleRamp(wood, s.peg.tone));

    // Top row: panel saw, tenon saw, bow saw — hung by their handles, teeth down.
    const sawTop = boardTop + ts * s.sawRowDrop;
    const hs = s.handSaw;
    const paintHandSaw = (x: number, bladeW: number, bladeH: number, backed: boolean): void => {
      const bladePath = (): void => {
        ctx.beginPath();
        ctx.moveTo(x, sawTop + ts * hs.bladeDrop);
        ctx.lineTo(x + bladeW, sawTop + ts * hs.bladeDrop);
        ctx.lineTo(
          x + bladeW,
          sawTop + ts * hs.bladeDrop + (backed ? bladeH : bladeH * hs.toeDepthRatio),
        );
        ctx.lineTo(x, sawTop + ts * hs.bladeDrop + bladeH);
        ctx.closePath();
      };
      paintedOutline(() => {
        bladePath();
        ctx.roundRect(
          x - ts * hs.handleBackX,
          sawTop,
          ts * hs.handleWidth,
          ts * hs.handleHeight,
          ts * hs.handleRadius,
        );
      });
      ctx.fillStyle = rgb(STEEL);
      bladePath();
      ctx.fill();
      inkOutline(ctx, ts * hs.bladeInk);
      ctx.fillStyle = rgba(STEEL_LIGHT, hs.glintAlpha);
      ctx.fillRect(
        x + ts * hs.glintInset,
        sawTop + ts * hs.glintDrop,
        bladeW * hs.glintLengthRatio,
        Math.max(1, ts * hs.glintThickness),
      );
      // Teeth: a fine dark line along the cutting edge.
      ctx.strokeStyle = rgb(STEEL_DARK);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, sawTop + ts * hs.bladeDrop + bladeH - 1);
      ctx.lineTo(
        x + bladeW,
        sawTop + ts * hs.bladeDrop + (backed ? bladeH : bladeH * hs.toeDepthRatio) - 1,
      );
      ctx.stroke();
      if (backed)
        block(ctx, x, sawTop + ts * hs.backDrop, bladeW, ts * hs.backHeight, BRASS, ts, hs.backInk);
      // The open handle, pegged.
      ctx.fillStyle = rgb(BEECH);
      ctx.beginPath();
      ctx.roundRect(
        x - ts * hs.handleBackX,
        sawTop,
        ts * hs.handleWidth,
        ts * hs.handleHeight,
        ts * hs.handleRadius,
      );
      ctx.fill();
      inkOutline(ctx, ts * hs.handleInk);
      ctx.fillStyle = rgb(PINE_DARK);
      ctx.beginPath();
      ctx.ellipse(
        x - ts * hs.gripX,
        sawTop + ts * hs.gripY,
        ts * hs.gripRadiusX,
        ts * hs.gripRadiusY,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      peg(x - ts * hs.pegX, sawTop + ts * hs.pegDrop);
    };
    paintHandSaw(
      left + ts * s.panelSaw.x,
      ts * s.panelSaw.bladeWidth,
      ts * s.panelSaw.bladeHeight,
      false,
    );
    paintHandSaw(
      left + ts * s.tenonSaw.x,
      ts * s.tenonSaw.bladeWidth,
      ts * s.tenonSaw.bladeHeight,
      true,
    );
    // Bow saw: two cheeks, a stretcher, a thin blade below and the twisted cord above.
    const bow = s.bowSaw;
    const bowLeft = left + ts * bow.left;
    const bowRight = left + ts * bow.right;
    ctx.strokeStyle = rgb(BEECH);
    ctx.lineWidth = Math.max(1, ts * bow.frameWidth);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop);
    ctx.lineTo(bowLeft, sawTop + ts * bow.cheekLength);
    ctx.moveTo(bowRight, sawTop);
    ctx.lineTo(bowRight, sawTop + ts * bow.cheekLength);
    ctx.moveTo(bowLeft, sawTop + ts * bow.stretcherDrop);
    ctx.lineTo(bowRight, sawTop + ts * bow.stretcherDrop);
    ctx.stroke();
    ctx.strokeStyle = rgb(STEEL);
    ctx.lineWidth = Math.max(1, ts * bow.bladeWidth);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop + ts * bow.bladeDrop);
    ctx.lineTo(bowRight, sawTop + ts * bow.bladeDrop);
    ctx.stroke();
    ctx.strokeStyle = rgb([200, 186, 150]);
    ctx.lineWidth = Math.max(1, ts * bow.cordWidth);
    ctx.beginPath();
    ctx.moveTo(bowLeft, sawTop + ts * bow.cordDrop);
    ctx.lineTo(bowRight, sawTop + ts * bow.cordDrop);
    ctx.stroke();
    peg((bowLeft + bowRight) / 2, sawTop + ts * bow.pegDrop);

    const rowTop = boardTop + ts * s.middleRowDrop;
    // Chisel rack: a slotted rail, six chisels graded narrow to wide.
    const ch = s.chisels;
    const rackLeft = left + ts * ch.rackX;
    const chisels = ch.count;
    const chiselPitch = ts * ch.pitch;
    block(
      ctx,
      rackLeft - ts * ch.railOverhang,
      rowTop,
      chiselPitch * chisels + ts * ch.railOverhang,
      ts * ch.railHeight,
      sampleRamp(wood, ch.railTone),
      ts,
      ch.railInk,
    );
    for (let i = 0; i < chisels; i++) {
      const cx = rackLeft + chiselPitch * (i + ch.slotPhase);
      const bladeW = ts * (ch.bladeWidthBase + i * ch.bladeWidthStep);
      outlineRect(cx - bladeW / 2, rowTop + ts * ch.bladeDrop, bladeW, ts * ch.bladeLength);
    }
    for (let i = 0; i < chisels; i++) {
      const cx = rackLeft + chiselPitch * (i + ch.slotPhase);
      const bladeW = ts * (ch.bladeWidthBase + i * ch.bladeWidthStep);
      block(
        ctx,
        cx - ts * ch.handleHalfWidth,
        rowTop - ts * ch.handleRise,
        ts * ch.handleWidth,
        ts * ch.handleLength,
        BEECH,
        ts,
        ch.ink,
      );
      block(
        ctx,
        cx - bladeW / 2,
        rowTop + ts * ch.bladeDrop,
        bladeW,
        ts * ch.bladeLength,
        STEEL,
        ts,
        ch.ink,
      );
    }
    // Mallet, head up.
    const m = s.mallet;
    const malletX = left + ts * m.x;
    outlineRect(
      malletX - ts * m.handleHalfWidth,
      rowTop - ts * m.handleRise,
      ts * m.handleWidth,
      ts * m.handleLength,
    );
    outlineRect(
      malletX - ts * m.headHalfWidth,
      rowTop - ts * m.headRise,
      ts * m.headWidth,
      ts * m.headHeight,
    );
    block(
      ctx,
      malletX - ts * m.handleHalfWidth,
      rowTop - ts * m.handleRise,
      ts * m.handleWidth,
      ts * m.handleLength,
      BEECH_DARK,
      ts,
      m.handleInk,
    );
    block(
      ctx,
      malletX - ts * m.headHalfWidth,
      rowTop - ts * m.headRise,
      ts * m.headWidth,
      ts * m.headHeight,
      BEECH,
      ts,
      m.headInk,
    );
    litEdge(
      ctx,
      malletX - ts * m.headHalfWidth,
      rowTop - ts * m.headRise,
      ts * m.headWidth,
      Math.max(1, ts * m.litThickness),
      PINE_LIGHT,
      m.litAlpha,
    );
    peg(malletX, rowTop + ts * m.pegDrop);
    // Try square: a rosewood stock with brass rivets, a steel blade.
    const sq = s.trySquare;
    const trySquareX = left + ts * sq.x;
    outlineRect(trySquareX, rowTop - ts * sq.stockRise, ts * sq.stockWidth, ts * sq.stockLength);
    outlineRect(
      trySquareX + ts * sq.stockWidth,
      rowTop - ts * sq.bladeRise,
      ts * sq.bladeLength,
      ts * sq.bladeWidth,
    );
    block(
      ctx,
      trySquareX,
      rowTop - ts * sq.stockRise,
      ts * sq.stockWidth,
      ts * sq.stockLength,
      ROSEWOOD,
      ts,
      sq.stockInk,
    );
    block(
      ctx,
      trySquareX + ts * sq.stockWidth,
      rowTop - ts * sq.bladeRise,
      ts * sq.bladeLength,
      ts * sq.bladeWidth,
      STEEL,
      ts,
      sq.bladeInk,
    );
    for (const ry of sq.rivetDrops)
      disc(
        ctx,
        trySquareX + ts * sq.rivetX,
        rowTop - ts * sq.rivetRise + ts * ry,
        Math.max(1, ts * sq.rivetRadius),
        BRASS_LIGHT,
      );
    // Framing square: the big steel L.
    const fs = s.framingSquare;
    const framingX = left + ts * fs.x;
    const traceFramingSquare = (): void => {
      ctx.beginPath();
      ctx.moveTo(framingX, rowTop - ts * fs.tongueRise);
      ctx.lineTo(framingX + ts * fs.stockWidth, rowTop - ts * fs.tongueRise);
      ctx.lineTo(framingX + ts * fs.stockWidth, rowTop + ts * fs.heelDrop);
      ctx.lineTo(framingX + ts * fs.bladeReach, rowTop + ts * fs.heelDrop);
      ctx.lineTo(framingX + ts * fs.bladeReach, rowTop + ts * fs.footDrop);
      ctx.lineTo(framingX, rowTop + ts * fs.footDrop);
      ctx.closePath();
    };
    paintedOutline(traceFramingSquare);
    ctx.fillStyle = rgb(STEEL_DARK);
    traceFramingSquare();
    ctx.fill();
    inkOutline(ctx, ts * fs.ink);
    ctx.strokeStyle = rgba(STEEL_LIGHT, fs.tickAlpha);
    ctx.lineWidth = 1;
    for (let i = 1; i < fs.tickEnd; i++) {
      ctx.beginPath();
      ctx.moveTo(
        framingX + ts * fs.stockWidth + i * ts * fs.tickPitch,
        rowTop + ts * fs.tickTopDrop,
      );
      ctx.lineTo(
        framingX + ts * fs.stockWidth + i * ts * fs.tickPitch,
        rowTop + ts * fs.tickBottomDrop,
      );
      ctx.stroke();
    }
    const dv = s.dividers;
    const dividerX = left + ts * dv.x;
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * dv.lineWidth);
    ctx.beginPath();
    ctx.moveTo(dividerX - ts * dv.legSpread, rowTop + ts * dv.pointDrop);
    ctx.lineTo(dividerX, rowTop - ts * dv.hingeRise);
    ctx.lineTo(dividerX + ts * dv.legSpread, rowTop + ts * dv.pointDrop);
    ctx.stroke();
    disc(ctx, dividerX, rowTop - ts * dv.hingeRise, Math.max(1, ts * dv.hingeRadius), BRASS);
    // The plumb bob, hanging true from its peg.
    const pb = s.plumbBob;
    const plumbX = left + ts * pb.x;
    peg(plumbX, rowTop - ts * pb.pegRise);
    ctx.strokeStyle = rgb([220, 208, 176]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plumbX, rowTop - ts * pb.pegRise);
    ctx.lineTo(plumbX, rowTop + ts * pb.bobTopDrop);
    ctx.stroke();
    ctx.fillStyle = rgb(BRASS);
    ctx.beginPath();
    ctx.moveTo(plumbX - ts * pb.capHalfWidth, rowTop + ts * pb.bobTopDrop);
    ctx.lineTo(plumbX + ts * pb.capHalfWidth, rowTop + ts * pb.bobTopDrop);
    ctx.lineTo(plumbX + ts * pb.shoulderHalfWidth, rowTop + ts * pb.shoulderDrop);
    ctx.lineTo(plumbX, rowTop + ts * pb.tipDrop);
    ctx.lineTo(plumbX - ts * pb.shoulderHalfWidth, rowTop + ts * pb.shoulderDrop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * pb.ink);
    ctx.fillStyle = rgba(BRASS_LIGHT, pb.glintAlpha);
    ctx.fillRect(
      plumbX - ts * pb.glintX,
      rowTop + ts * pb.glintDrop,
      ts * pb.glintWidth,
      ts * pb.glintHeight,
    );
    // Bit brace.
    const br = s.brace;
    const braceX = left + ts * br.x;
    ctx.strokeStyle = rgb(STEEL_DARK);
    ctx.lineWidth = Math.max(1, ts * br.lineWidth);
    ctx.beginPath();
    ctx.moveTo(braceX, rowTop - ts * br.headRise);
    ctx.lineTo(braceX, rowTop - ts * br.crankTopRise);
    ctx.lineTo(braceX + ts * br.crankThrow, rowTop - ts * br.crankTopRise);
    ctx.lineTo(braceX + ts * br.crankThrow, rowTop + ts * br.crankBottomDrop);
    ctx.lineTo(braceX, rowTop + ts * br.crankBottomDrop);
    ctx.lineTo(braceX, rowTop + ts * br.bitTipDrop);
    ctx.stroke();
    disc(ctx, braceX, rowTop - ts * br.padRise, ts * br.padRadius, BEECH);
    block(
      ctx,
      braceX + ts * br.gripX,
      rowTop + ts * br.gripDrop,
      ts * br.gripWidth,
      ts * br.gripHeight,
      BEECH,
      ts,
      br.gripInk,
    );

    // The spirit level on two pegs, then the plane shelf beneath it.
    const lv = s.level;
    const levelY = boardBottom - ts * lv.riseFromBoardBottom;
    const levelLeft = left + ts * lv.x;
    const levelW = ts * lv.length;
    outlineRect(levelLeft, levelY, levelW, ts * lv.height);
    peg(levelLeft + ts * lv.pegInset, levelY + ts * lv.pegDrop);
    peg(levelLeft + levelW - ts * lv.pegInset, levelY + ts * lv.pegDrop);
    // The folding rule's place, painted and pegged and empty: it is on his belt.
    const ro = s.ruleOutline;
    const ruleOutlineX = levelLeft + levelW + ts * ro.gap;
    const ruleOutlineY = levelY + ts * ro.drop;
    paintedOutline(() => {
      ctx.beginPath();
      ctx.rect(ruleOutlineX, ruleOutlineY, ts * ro.width, ts * ro.height);
    });
    peg(ruleOutlineX + ts * ro.pegX, ruleOutlineY + ts * ro.pegDrop);
    block(ctx, levelLeft, levelY, levelW, ts * lv.height, ROSEWOOD, ts, lv.bodyInk);
    block(ctx, levelLeft, levelY, ts * lv.capLength, ts * lv.capLength, BRASS, ts, lv.capInk);
    block(
      ctx,
      levelLeft + levelW - ts * lv.capLength,
      levelY,
      ts * lv.capLength,
      ts * lv.capLength,
      BRASS,
      ts,
      lv.capInk,
    );
    block(
      ctx,
      levelLeft + levelW / 2 - ts * lv.windowHalfWidth,
      levelY + ts * lv.windowDrop,
      ts * lv.windowWidth,
      ts * lv.windowHeight,
      BRASS_DARK,
      ts,
      lv.windowInk,
    );
    ctx.fillStyle = rgb(LEVEL_VIAL);
    ctx.fillRect(
      levelLeft + levelW / 2 - ts * lv.vialHalfWidth,
      levelY + ts * lv.vialDrop,
      ts * lv.vialWidth,
      ts * lv.vialHeight,
    );
    disc(
      ctx,
      levelLeft + levelW / 2,
      levelY + ts * lv.bubbleDrop,
      Math.max(1, ts * lv.bubbleRadius),
      [240, 250, 230],
    );

    const pl = s.plane;
    const shelfY = boardBottom - ts * pl.shelfRise;
    const paintPlane = (x: number, length: number, height: number, wooden: boolean): void => {
      const body = wooden ? BEECH : STEEL_DARK;
      block(ctx, x, shelfY - height, length, height, body, ts, pl.ink);
      litEdge(
        ctx,
        x,
        shelfY - height,
        length,
        Math.max(1, ts * pl.litThickness),
        wooden ? PINE_LIGHT : STEEL_LIGHT,
        pl.litAlpha,
      );
      if (!wooden) {
        // The tote behind and the knob in front.
        ctx.fillStyle = rgb(ROSEWOOD);
        ctx.beginPath();
        ctx.roundRect(
          x + length * pl.toteRatio,
          shelfY - height - ts * pl.toteRise,
          ts * pl.toteWidth,
          ts * pl.toteHeight,
          ts * pl.toteRadius,
        );
        ctx.fill();
        inkOutline(ctx, ts * pl.toteInk);
        disc(
          ctx,
          x + length * pl.knobRatio,
          shelfY - height - ts * pl.knobRise,
          ts * pl.knobRadius,
          ROSEWOOD,
        );
      } else {
        ctx.fillStyle = rgb(STEEL);
        ctx.fillRect(
          x + length * pl.wedgeRatio,
          shelfY - height - ts * pl.wedgeRise,
          ts * pl.wedgeWidth,
          ts * pl.wedgeHeight,
        );
      }
    };
    for (const plane of s.planes) {
      paintPlane(left + ts * plane.x, ts * plane.length, ts * plane.height, plane.wooden);
    }
    const ps = s.planeShelf;
    block(
      ctx,
      left + ts * ps.inset,
      shelfY,
      width - ts * ps.trim,
      ts * ps.height,
      sampleRamp(wood, ps.tone),
      ts,
      ps.ink,
    );
    litEdge(
      ctx,
      left + ts * ps.inset,
      shelfY,
      width - ts * ps.trim,
      Math.max(1, ts * ps.litThickness),
      sampleRamp(wood, 1),
    );

    // The bench: four square legs, a lower shelf of sorted offcuts, a thick beech top.
    const bn = s.bench;
    const benchTop = box.bottom - ts * bn.topUp;
    const topH = ts * bn.topHeight;
    const legW = ts * bn.legWidth;
    const underY = box.bottom - ts * bn.underShelfUp;
    for (const lx of [left + ts * bn.legInset, right - ts * bn.legInset - legW]) {
      block(
        ctx,
        lx,
        benchTop + topH,
        legW,
        box.bottom - ts * bn.footLift - benchTop - topH,
        sampleRamp(wood, bn.legTone),
        ts,
        bn.legInk,
      );
    }
    block(
      ctx,
      left + ts * bn.legInset,
      underY,
      width - ts * bn.underShelfTrim,
      ts * bn.underShelfHeight,
      sampleRamp(wood, bn.underShelfTone),
      ts,
      bn.underShelfInk,
    );
    const oc = s.offcuts;
    const offcuts = oc.count;
    for (let i = 0; i < offcuts; i++) {
      const len = width * (oc.longestRatio - i * oc.shortenRatio);
      block(
        ctx,
        left + ts * oc.x,
        underY - ts * oc.step * (i + 1),
        len,
        ts * oc.height,
        mix(PINE, PINE_DARK, (i % 2) * oc.alternateShade),
        ts,
        oc.ink,
      );
    }
    block(ctx, left, benchTop, width, topH, BEECH, ts);
    litEdge(
      ctx,
      left,
      benchTop,
      width,
      Math.max(1, ts * bn.topLitThickness),
      PINE_LIGHT,
      bn.topLitAlpha,
    );
    ctx.fillStyle = rgba(BEECH_DARK, bn.frontShadeAlpha);
    ctx.fillRect(left, benchTop + topH * bn.frontShadeFrom, width, topH * bn.frontShadeDepth);
    // The face vice at the west end: a wooden chop and its screw with a tommy bar.
    const vc = s.vice;
    block(
      ctx,
      left - ts * vc.chopOverhang,
      benchTop + topH,
      ts * vc.chopWidth,
      ts * vc.chopHeight,
      BEECH,
      ts,
      vc.chopInk,
    );
    disc(
      ctx,
      left + ts * vc.screwX,
      benchTop + topH + ts * vc.screwDrop,
      ts * vc.screwRadius,
      BEECH_DARK,
    );
    ctx.strokeStyle = rgb(BEECH_DARK);
    ctx.lineWidth = Math.max(1, ts * vc.barWidth);
    ctx.beginPath();
    ctx.moveTo(left, benchTop + topH + ts * vc.barStartDrop);
    ctx.lineTo(left + ts * vc.barEndX, benchTop + topH + ts * vc.barEndDrop);
    ctx.stroke();
    // On the bench: a plane laid on its side, a marking gauge, a folding rule and a pencil.
    const bp = s.benchPlane;
    block(
      ctx,
      left + ts * bp.x,
      benchTop - ts * bp.rise,
      ts * bp.length,
      ts * bp.height,
      STEEL_DARK,
      ts,
      bp.ink,
    );
    litEdge(
      ctx,
      left + ts * bp.x,
      benchTop - ts * bp.rise,
      ts * bp.length,
      Math.max(1, ts * bp.litThickness),
      STEEL_LIGHT,
      bp.litAlpha,
    );
    const mg = s.markingGauge;
    block(
      ctx,
      left + ts * mg.stockX,
      benchTop - ts * mg.stockRise,
      ts * mg.stockLength,
      ts * mg.stockHeight,
      ROSEWOOD,
      ts,
      mg.ink,
    );
    block(
      ctx,
      left + ts * mg.fenceX,
      benchTop - ts * mg.fenceRise,
      ts * mg.fenceWidth,
      ts * mg.fenceHeight,
      ROSEWOOD,
      ts,
      mg.ink,
    );
    const fr = s.foldingRule;
    block(
      ctx,
      left + ts * fr.x,
      benchTop - ts * fr.rise,
      ts * fr.length,
      ts * fr.height,
      [224, 204, 150],
      ts,
      fr.ink,
    );
    const pn = s.pencil;
    block(
      ctx,
      left + ts * pn.x,
      benchTop - ts * pn.rise,
      ts * pn.length,
      ts * pn.height,
      [196, 150, 60],
      ts,
      0,
    );
  });
}

/** Proportions of the door on its trestles, in tiles unless a key says it is a ratio, tone, alpha or ink weight. */
const DOOR_ON_TRESTLES = {
  shadowSpread: 0.46,
  trestleTone: 0.45,
  doorTopUp: 0.9,
  doorDepth: 0.56,
  doorInset: 0.3,
  trestle: {
    inset: 0.4,
    footSpread: 0.3,
    footLift: 0.06,
    shoulderSpread: 0.1,
    shoulderRise: 0.04,
    inkAlpha: 0.85,
    inkWidth: 0.1,
    legWidth: 0.07,
    beamHalfLength: 0.3,
    beamRise: 0.02,
    beamLength: 0.6,
    beamHeight: 0.1,
    beamTone: 0.35,
  },
  edgeThickness: 0.12,
  field: {
    stileWidth: 0.1,
    /** Stiles crossing the door's length, and rails crossing its depth: three of each around two fields. */
    stilesAcross: 3,
    railsDown: 3,
    rows: 2,
    lengthRatios: [0.58, 0.42],
    bevel: 0.035,
    tone: 0.3,
    litAlpha: 0.9,
    shadeAlpha: 0.8,
    flatInset: 1.6,
    flatTrim: 3.2,
    edgeAlpha: 0.95,
    edgeWidth: 0.018,
  },
  plane: {
    x: 0.8,
    drop: 0.1,
    length: 0.32,
    height: 0.1,
    ink: 0.5,
    litThickness: 0.015,
    litAlpha: 0.8,
    knobX: 0.26,
    knobDrop: 0.08,
    knobRadius: 0.035,
  },
  shaving: {
    width: 0.025,
    x: 0.5,
    drop: 0.15,
    radius: 0.06,
    /** Arc ends as fractions of π, leaving the curl open on the right. */
    fromTurn: 0.2,
    toTurn: 1.8,
  },
  hinge: {
    depthRatio: 0.55,
    xs: [1.55, 1.85],
    halfHeight: 0.05,
    length: 0.22,
    height: 0.1,
    ink: 0.45,
    knuckleX: 0.1,
    knuckleWidth: 0.02,
    litAlpha: 0.9,
  },
  screwTin: { x: 2.18, radiusX: 0.08, radiusY: 0.05, ink: 0.45 },
  lock: {
    stileRatio: 1.5,
    halfStile: 0.5,
    plateHalfWidth: 0.04,
    plateRise: 0.08,
    plateWidth: 0.08,
    plateHeight: 0.16,
    plateTone: 0.55,
    plateInk: 0.4,
    knobRise: 0.02,
    knobRadius: 0.035,
    glintX: 0.01,
    glintRise: 0.03,
    glintRadius: 0.012,
  },
  foldingRule: { x: 0.18, rise: 0.1, length: 0.5, height: 0.04, ink: 0.35 },
  pencil: { x: 0.3, drop: 0.16, length: 0.2, height: 0.025 },
} as const;

/**
 * A new four-panel door laid flat across two trestles, planed true and
 * waiting to be hung — in someone else's house. Its hinges are laid out
 * beside it in the order they will go on, with the screws counted into a tin.
 */
export function paintDoorOnTrestles(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  const s = DOOR_ON_TRESTLES;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const trestleColor = sampleRamp(wood, s.trestleTone);
    const doorTop = box.bottom - ts * s.doorTopUp;
    const doorDepth = ts * s.doorDepth;
    const doorLeft = box.left + ts * s.doorInset;
    const doorRight = box.right - ts * s.doorInset;
    // Trestles: a beam on two splayed legs each, seen end-on in front of the door's shadow.
    const t = s.trestle;
    for (const tx of [box.left + ts * t.inset, box.right - ts * t.inset]) {
      const legs = (): void => {
        ctx.beginPath();
        ctx.moveTo(tx - ts * t.footSpread, box.bottom - ts * t.footLift);
        ctx.lineTo(tx - ts * t.shoulderSpread, doorTop + doorDepth - ts * t.shoulderRise);
        ctx.moveTo(tx + ts * t.footSpread, box.bottom - ts * t.footLift);
        ctx.lineTo(tx + ts * t.shoulderSpread, doorTop + doorDepth - ts * t.shoulderRise);
      };
      ctx.strokeStyle = rgba(TOWN_INK, t.inkAlpha);
      ctx.lineWidth = ts * t.inkWidth;
      legs();
      ctx.stroke();
      ctx.strokeStyle = rgb(trestleColor);
      ctx.lineWidth = ts * t.legWidth;
      legs();
      ctx.stroke();
      // The trestle's beam, proud of the door at each end.
      block(
        ctx,
        tx - ts * t.beamHalfLength,
        doorTop + doorDepth - ts * t.beamRise,
        ts * t.beamLength,
        ts * t.beamHeight,
        sampleRamp(wood, t.beamTone),
        ts,
      );
    }
    // The door's thick edge, then its face with four raised fields.
    block(
      ctx,
      doorLeft,
      doorTop + doorDepth,
      doorRight - doorLeft,
      ts * s.edgeThickness,
      PINE_DARK,
      ts,
    );
    ctx.fillStyle = rgb(PINE);
    ctx.beginPath();
    ctx.rect(doorLeft, doorTop, doorRight - doorLeft, doorDepth);
    ctx.fill();
    inkOutline(ctx, ts);
    paintPlankBoard(ctx, doorLeft, doorTop, doorRight - doorLeft, doorDepth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: doorDepth / 2,
      ramp: { shadow: PINE_DARK, mid: PINE, light: PINE_LIGHT, accent: PINE_LIGHT },
    });
    // Four raised fields, two along and two across: the door's long top
    // panels to the west, its short bottom panels to the east.
    const f = s.field;
    const stile = ts * f.stileWidth;
    const inner = doorRight - doorLeft - stile * f.stilesAcross;
    const fieldLengths = [inner * f.lengthRatios[0], inner * f.lengthRatios[1]];
    const fieldDepth = (doorDepth - stile * f.railsDown) / f.rows;
    let fx = doorLeft + stile;
    for (const length of fieldLengths) {
      for (let row = 0; row < f.rows; row++) {
        const fy = doorTop + stile + (fieldDepth + stile) * row;
        // A raised field: a mid-tone panel, lit along its north and west
        // bevels and shaded along its south and east ones.
        const bevel = ts * f.bevel;
        ctx.fillStyle = rgb(mix(PINE, PINE_DARK, f.tone));
        ctx.fillRect(fx, fy, length, fieldDepth);
        ctx.fillStyle = rgba(PINE_LIGHT, f.litAlpha);
        ctx.fillRect(fx, fy, length, bevel);
        ctx.fillRect(fx, fy, bevel, fieldDepth);
        ctx.fillStyle = rgba(PINE_DARK, f.shadeAlpha);
        ctx.fillRect(fx, fy + fieldDepth - bevel, length, bevel);
        ctx.fillRect(fx + length - bevel, fy, bevel, fieldDepth);
        ctx.fillStyle = rgb(PINE);
        ctx.fillRect(
          fx + bevel * f.flatInset,
          fy + bevel * f.flatInset,
          length - bevel * f.flatTrim,
          fieldDepth - bevel * f.flatTrim,
        );
        ctx.strokeStyle = rgba(PINE_DARK, f.edgeAlpha);
        ctx.lineWidth = Math.max(1, ts * f.edgeWidth);
        ctx.strokeRect(fx, fy, length, fieldDepth);
      }
      fx += length + stile;
    }
    ctx.beginPath();
    ctx.rect(doorLeft, doorTop, doorRight - doorLeft, doorDepth);
    inkOutline(ctx, ts);
    // A smoothing plane resting on the face and one clean curl of shaving.
    const p = s.plane;
    const planeX = doorLeft + ts * p.x;
    block(ctx, planeX, doorTop + ts * p.drop, ts * p.length, ts * p.height, STEEL_DARK, ts, p.ink);
    litEdge(
      ctx,
      planeX,
      doorTop + ts * p.drop,
      ts * p.length,
      Math.max(1, ts * p.litThickness),
      STEEL_LIGHT,
      p.litAlpha,
    );
    disc(ctx, planeX + ts * p.knobX, doorTop + ts * p.knobDrop, ts * p.knobRadius, ROSEWOOD);
    const sh = s.shaving;
    ctx.strokeStyle = rgb(PINE_LIGHT);
    ctx.lineWidth = Math.max(1, ts * sh.width);
    ctx.beginPath();
    ctx.arc(
      planeX + ts * sh.x,
      doorTop + ts * sh.drop,
      ts * sh.radius,
      Math.PI * sh.fromTurn,
      Math.PI * sh.toTurn,
    );
    ctx.stroke();
    // Two hinges and a screw tin, laid out in the order they will go on.
    const h = s.hinge;
    const hingeY = doorTop + doorDepth * h.depthRatio;
    for (const hx of [doorLeft + ts * h.xs[0], doorLeft + ts * h.xs[1]]) {
      block(ctx, hx, hingeY - ts * h.halfHeight, ts * h.length, ts * h.height, BRASS, ts, h.ink);
      ctx.fillStyle = rgb(BRASS_DARK);
      ctx.fillRect(
        hx + ts * h.knuckleX,
        hingeY - ts * h.halfHeight,
        Math.max(1, ts * h.knuckleWidth),
        ts * h.height,
      );
      litEdge(ctx, hx, hingeY - ts * h.halfHeight, ts * h.length, 1, BRASS_LIGHT, h.litAlpha);
    }
    const tin = s.screwTin;
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.ellipse(doorLeft + ts * tin.x, hingeY, ts * tin.radiusX, ts * tin.radiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * tin.ink);
    // The lock plate and knob, already fitted on the closing stile.
    const lk = s.lock;
    const lockX = doorLeft + stile * lk.stileRatio + fieldLengths[0];
    const lockY = doorTop + doorDepth - stile * lk.halfStile;
    block(
      ctx,
      lockX - ts * lk.plateHalfWidth,
      lockY - ts * lk.plateRise,
      ts * lk.plateWidth,
      ts * lk.plateHeight,
      sampleRamp(iron(), lk.plateTone),
      ts,
      lk.plateInk,
    );
    disc(ctx, lockX, lockY - ts * lk.knobRise, ts * lk.knobRadius, BRASS);
    disc(
      ctx,
      lockX - ts * lk.glintX,
      lockY - ts * lk.glintRise,
      Math.max(1, ts * lk.glintRadius),
      BRASS_LIGHT,
    );
    // A folding rule and a pencil at the near edge.
    const fr = s.foldingRule;
    block(
      ctx,
      doorLeft + ts * fr.x,
      doorTop + doorDepth - ts * fr.rise,
      ts * fr.length,
      ts * fr.height,
      [224, 204, 150],
      ts,
      fr.ink,
    );
    const pn = s.pencil;
    block(
      ctx,
      doorLeft + ts * pn.x,
      doorTop + ts * pn.drop,
      ts * pn.length,
      ts * pn.height,
      [196, 150, 60],
      ts,
      0,
    );
  });
}

/** Proportions of the timber stack, in tiles unless a key says it is a tone or ink weight. */
const TIMBER_STACK = {
  shadowSpread: 0.46,
  sideInset: 0.1,
  bearerHeight: 0.1,
  footLift: 0.06,
  bearer: {
    leftX: 0.2,
    midBackX: 0.08,
    rightBackX: 0.36,
    width: 0.16,
    tone: 0.35,
    ink: 0.6,
  },
  courses: 5,
  boardHeight: 0.085,
  stickHeight: 0.035,
  /** Each course is stepped in from both ends by this much more than the one below. */
  courseStep: 0.08,
  tone: { base: 0.12, jitter: 0.08, alternate: 0.12 },
  boardInk: 0.5,
  litThickness: 0.015,
  litAlpha: 0.8,
  endGrainWidth: 0.06,
  endGrainInk: 0.3,
  stick: {
    leftX: 0.24,
    midBackX: 0.04,
    rightBackX: 0.32,
    width: 0.08,
    tone: 0.3,
    ink: 0.3,
  },
} as const;

/**
 * Planed boards stacked on bearers with a stick between every course so the
 * air gets through — sorted by length, ends squared flush, the way a joiner
 * keeps the stock he is saving for a job.
 */
export function paintTimberStack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = TIMBER_STACK;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.sideInset;
    const right = box.right - ts * s.sideInset;
    const bearerH = ts * s.bearerHeight;
    const bottom = box.bottom - ts * s.footLift;
    const b = s.bearer;
    for (const bx of [
      left + ts * b.leftX,
      (left + right) / 2 - ts * b.midBackX,
      right - ts * b.rightBackX,
    ]) {
      block(ctx, bx, bottom - bearerH, ts * b.width, bearerH, sampleRamp(wood, b.tone), ts, b.ink);
    }
    const courses = s.courses;
    const boardH = ts * s.boardHeight;
    const stickH = ts * s.stickHeight;
    let y = bottom - bearerH;
    for (let c = 0; c < courses; c++) {
      const inset = c * ts * s.courseStep;
      const tone = mix(
        PINE,
        PINE_DARK,
        s.tone.base + jitter(rng, s.tone.jitter) + (c % 2) * s.tone.alternate,
      );
      y -= boardH;
      block(ctx, left + inset, y, right - left - inset * 2, boardH, tone, ts, s.boardInk);
      litEdge(
        ctx,
        left + inset,
        y,
        right - left - inset * 2,
        Math.max(1, ts * s.litThickness),
        PINE_LIGHT,
        s.litAlpha,
      );
      // The end grain, square to the face.
      block(
        ctx,
        right - inset - ts * s.endGrainWidth,
        y,
        ts * s.endGrainWidth,
        boardH,
        LOG_END,
        ts,
        s.endGrainInk,
      );
      if (c < courses - 1) {
        const st = s.stick;
        for (const sx of [
          left + ts * st.leftX,
          (left + right) / 2 - ts * st.midBackX,
          right - ts * st.rightBackX,
        ]) {
          block(ctx, sx, y - stickH, ts * st.width, stickH, sampleRamp(wood, st.tone), ts, st.ink);
        }
        y -= stickH;
      }
    }
  });
}

/** Proportions of the tool chest, in tiles unless a key says it is a ratio, tone or ink weight. */
const TOOL_CHEST = {
  shadowSpread: 0.44,
  sideInset: 0.14,
  footLift: 0.06,
  bodyHeight: 0.46,
  lidDepth: 0.22,
  lidTone: 0.62,
  lidLitThickness: 0.02,
  lip: { overhang: 0.02, rise: 0.02, widthGrowth: 0.04, height: 0.08, tone: 0.5 },
  /** The front's boards start below the lid's lip. */
  frontDrop: 0.06,
  frontBoards: 3,
  saw: {
    x: 0.3,
    depthRatio: 0.72,
    widthRatio: 0.62,
    height: 0.08,
    ink: 0.45,
    handleX: 0.14,
    handleDepthRatio: 0.8,
    handleWidth: 0.18,
    handleHeight: 0.12,
  },
  strap: { xRatios: [0.4, 0.75], width: 0.05, ink: 0.3 },
  corner: { size: 0.09, ink: 0.35 },
  escutcheon: {
    halfWidth: 0.05,
    drop: 0.08,
    width: 0.1,
    height: 0.12,
    ink: 0.4,
    keyholeDrop: 0.13,
    keyholeRadius: 0.018,
  },
  handle: {
    tone: 0.6,
    width: 0.025,
    topDrop: 0.14,
    reach: 0.06,
    gripTopDrop: 0.16,
    gripBottomDrop: 0.26,
    bottomDrop: 0.28,
  },
} as const;

/**
 * His tool chest: a dovetailed oak chest with brass corners and a brass
 * escutcheon, iron lifting handles at each end, and a panel saw strapped
 * along the lid — the kit that goes with him to a job.
 */
export function paintToolChest(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = TOOL_CHEST;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.sideInset;
    const right = box.right - ts * s.sideInset;
    const width = right - left;
    const bottom = box.bottom - ts * s.footLift;
    const bodyTop = bottom - ts * s.bodyHeight;
    const lidDepth = ts * s.lidDepth;
    // The lid's top face, then the front.
    ctx.fillStyle = rgb(sampleRamp(wood, s.lidTone));
    ctx.beginPath();
    ctx.rect(left, bodyTop - lidDepth, width, lidDepth);
    ctx.fill();
    inkOutline(ctx, ts);
    litEdge(
      ctx,
      left,
      bodyTop - lidDepth,
      width,
      Math.max(1, ts * s.lidLitThickness),
      sampleRamp(wood, 1),
    );
    block(
      ctx,
      left - ts * s.lip.overhang,
      bodyTop - ts * s.lip.rise,
      width + ts * s.lip.widthGrowth,
      ts * s.lip.height,
      sampleRamp(wood, s.lip.tone),
      ts,
    );
    paintPlankBoard(
      ctx,
      left,
      bodyTop + ts * s.frontDrop,
      width,
      bottom - bodyTop - ts * s.frontDrop,
      forkRng(rng),
      {
        direction: 'horizontal',
        boardPx: (bottom - bodyTop) / s.frontBoards,
        ramp: wood,
      },
    );
    ctx.beginPath();
    ctx.rect(left, bodyTop + ts * s.frontDrop, width, bottom - bodyTop - ts * s.frontDrop);
    inkOutline(ctx, ts);
    // The saw strapped along the lid.
    const sw = s.saw;
    block(
      ctx,
      left + ts * sw.x,
      bodyTop - lidDepth * sw.depthRatio,
      width * sw.widthRatio,
      ts * sw.height,
      STEEL,
      ts,
      sw.ink,
    );
    block(
      ctx,
      left + ts * sw.handleX,
      bodyTop - lidDepth * sw.handleDepthRatio,
      ts * sw.handleWidth,
      ts * sw.handleHeight,
      BEECH,
      ts,
      sw.ink,
    );
    const st = s.strap;
    for (const sx of [left + width * st.xRatios[0], left + width * st.xRatios[1]]) {
      block(ctx, sx, bodyTop - lidDepth, ts * st.width, lidDepth, [98, 70, 44], ts, st.ink);
    }
    // Brass corners and escutcheon, iron handles at the ends.
    const corner = ts * s.corner.size;
    for (const cx of [left, right - corner]) {
      block(ctx, cx, bodyTop + ts * s.frontDrop, corner, corner, BRASS, ts, s.corner.ink);
      block(ctx, cx, bottom - corner, corner, corner, BRASS, ts, s.corner.ink);
    }
    const es = s.escutcheon;
    block(
      ctx,
      left + width / 2 - ts * es.halfWidth,
      bodyTop + ts * es.drop,
      ts * es.width,
      ts * es.height,
      BRASS,
      ts,
      es.ink,
    );
    disc(
      ctx,
      left + width / 2,
      bodyTop + ts * es.keyholeDrop,
      Math.max(1, ts * es.keyholeRadius),
      SOOT,
    );
    const hd = s.handle;
    ctx.strokeStyle = rgb(sampleRamp(iron(), hd.tone));
    ctx.lineWidth = Math.max(1, ts * hd.width);
    for (const [hx, dir] of [
      [left, -1],
      [right, 1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(hx, bodyTop + ts * hd.topDrop);
      ctx.lineTo(hx + dir * ts * hd.reach, bodyTop + ts * hd.gripTopDrop);
      ctx.lineTo(hx + dir * ts * hd.reach, bodyTop + ts * hd.gripBottomDrop);
      ctx.lineTo(hx, bodyTop + ts * hd.bottomDrop);
      ctx.stroke();
    }
  });
}

// ── The hearth and the good chair ──────────────────────────────────────────

/** Proportions of the builder's hearth, in tiles unless named as an alpha, ramp stop or ink weight. */
const BUILDERS_HEARTH = {
  shadowSpread: 0.48,
  hearthstone: {
    top: 1.02,
    sideInset: 0.06,
    height: 0.9,
    courseH: 0.3,
    blockW: 0.6,
    kerbUp: 0.16,
    kerbH: 0.1,
    kerbTone: 0.35,
    kerbLitMin: 0.02,
    kerbLitTone: 1,
  },
  breast: {
    sideInset: 0.26,
    bottomOverlap: 0.06,
    mantelLevel: 2.1,
    stackInset: 0.34,
    stackTop: 3.0,
    stackOverlap: 0.1,
    courseH: 0.2,
    blockW: 0.42,
    stackShadeW: 0.1,
    stackShadeAlpha: 0.35,
    returnShadeW: 0.12,
    returnShadeAlpha: 0.3,
  },
  firebox: {
    halfWidth: 0.56,
    top: 1.78,
    bottomOverlap: 0.06,
    /** As shares of the firebox half-width: where the jambs stop and how high the arch crown pulls. */
    springing: 0.5,
    crownPull: 0.35,
    backGlowInnerUp: 0.1,
    backGlowInnerR: 2,
    backGlowOuterUp: 0.2,
    backGlowOuterSpan: 1.2,
    emberAlpha: 0.85,
    midStop: 0.5,
    flameDeepAlpha: 0.55,
  },
  arch: {
    voussoirs: 7,
    radiusGap: 0.06,
    /** As shares of the firebox half-width: the arch centre's drop and its vertical radius. */
    centreDrop: 0.42,
    radiusY: 0.75,
    keyW: 0.16,
    keyH: 0.2,
    stoneW: 0.12,
    stoneH: 0.13,
    keyTone: 0.85,
    stoneTone: 0.7,
    ink: 0.5,
  },
  dogs: {
    lift: 0.06,
    spread: 0.34,
    halfWidth: 0.03,
    up: 0.16,
    width: 0.06,
    height: 0.18,
    tone: 0.5,
    ink: 0.5,
    knobUp: 0.17,
    knobR: 0.04,
    knobTone: 0.8,
  },
  logs: [
    { left: 0.34, up: 0.1, len: 0.68 },
    { left: 0.26, up: 0.18, len: 0.52 },
  ],
  logThickness: 0.09,
  logEndDrop: 0.045,
  logEndR: 0.045,
  logInk: 0.5,
  fire: {
    glowUp: 0.2,
    glowR: 0.7,
    glowAlpha: 0.35,
    flames: [
      { dx: -0.14, up: 0.12, height: 0.36, width: 0.1 },
      { dx: 0.06, up: 0.14, height: 0.46, width: 0.12 },
      { dx: 0.22, up: 0.1, height: 0.28, width: 0.08 },
    ],
  },
  crane: {
    postInset: 0.06,
    tone: 0.45,
    lineMin: 0.03,
    footUp: 0.1,
    armDrop: 0.2,
    armReach: 0.08,
    hookDx: 0.18,
    hookDrop: 0.36,
  },
  kettle: {
    dx: 0.18,
    drop: 0.5,
    rx: 0.16,
    ry: 0.13,
    ink: 0.6,
    shineDx: 0.24,
    shineDrop: 0.46,
    shineRx: 0.05,
    shineRy: 0.06,
    spoutLineMin: 0.03,
    spoutRootDx: 0.04,
    spoutRootDrop: 0.48,
    spoutTipDx: 0.06,
    spoutTipDrop: 0.4,
  },
  mantel: {
    rise: 0.04,
    overhang: 0.1,
    overhangBoth: 0.2,
    thickness: 0.14,
    tone: 0.55,
    litMin: 0.025,
    litTone: 1,
    litAlpha: 0.8,
    undersideShadeTone: 0,
    undersideShadeAlpha: 0.4,
    undersideShadeH: 0.04,
  },
  candlesticks: {
    spread: 0.95,
    ink: 0.4,
    foot: { halfWidth: 0.04, up: 0.04, width: 0.08, height: 0.04 },
    stem: { halfWidth: 0.02, up: 0.2, width: 0.04, height: 0.16 },
    candle: { halfWidth: 0.025, up: 0.34, width: 0.05, height: 0.14 },
    glowUp: 0.4,
    glowR: 0.22,
    glowAlpha: 0.3,
    flameUp: 0.34,
    flameH: 0.1,
    flameW: 0.03,
  },
  level: {
    width: 0.9,
    up: 0.06,
    height: 0.06,
    ink: 0.5,
    vialHalfWidth: 0.06,
    vialUp: 0.05,
    vialWidth: 0.12,
    vialHeight: 0.03,
    bubbleUp: 0.035,
    bubbleMinR: 0.01,
    bubble: [240, 250, 230],
  },
  logBox: {
    inset: 0.06,
    width: 0.56,
    top: 0.62,
    logR: 0.075,
    rows: 2,
    perRow: 3,
    /** In log radii: the first log's inset, the pitch along a row, the upper row's stagger and each row's rise. */
    firstInset: 1.3,
    pitch: 2.2,
    stagger: 0.9,
    sink: 0.4,
    rowRise: 1.7,
    endGrain: 0.72,
    height: 0.4,
    tone: 0.5,
    litMin: 0.02,
    litTone: 1,
  },
  fireIrons: {
    inset: 0.3,
    baseHalfWidth: 0.12,
    baseUp: 0.24,
    baseWidth: 0.24,
    baseHeight: 0.05,
    baseTone: 0.5,
    baseInk: 0.5,
    tone: 0.55,
    lineMin: 0.025,
    shaftFoot: 0.22,
    shaftTop: 0.9,
    crossbarHalf: 0.1,
    crossbarUp: 0.84,
    irons: [
      { dx: -0.08, len: 0.56 },
      { dx: 0.0, len: 0.62 },
      { dx: 0.08, len: 0.52 },
    ],
    finialUp: 0.92,
    finialR: 0.035,
  },
} as const;

/**
 * The hearth he laid himself: a chimney breast of dressed ashlar in dead-level
 * courses, a keyed arch over the firebox, a squared oak mantel with a pair of
 * brass candlesticks set exactly equidistant and a level lying along it; a
 * fire on iron dogs with a copper kettle on the crane; out on the hearthstone,
 * a squared log box stacked end-on and a stand of fire irons. Three tiles
 * wide and two deep.
 */
export function paintBuildersHearth(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  const s = BUILDERS_HEARTH;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = HEARTH_FREESTONE;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);

    // Hearthstone: squared flags across the front row, with a raised kerb.
    const hs = s.hearthstone;
    const hearthTop = box.bottom - ts * hs.top;
    const hearthLeft = box.left + ts * hs.sideInset;
    const hearthRight = box.right - ts * hs.sideInset;
    paintAshlar(
      ctx,
      hearthLeft,
      hearthTop,
      hearthRight - hearthLeft,
      ts * hs.height,
      ts * hs.courseH,
      ts * hs.blockW,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(hearthLeft, hearthTop, hearthRight - hearthLeft, ts * hs.height);
    inkOutline(ctx, ts);
    block(
      ctx,
      hearthLeft,
      box.bottom - ts * hs.kerbUp,
      hearthRight - hearthLeft,
      ts * hs.kerbH,
      sampleRamp(stone, hs.kerbTone),
      ts,
    );
    litEdge(
      ctx,
      hearthLeft,
      box.bottom - ts * hs.kerbUp,
      hearthRight - hearthLeft,
      Math.max(1, ts * hs.kerbLitMin),
      sampleRamp(stone, hs.kerbLitTone),
    );

    // The chimney breast up to the mantel, then the narrower stack rising
    // into the wall above it.
    const br = s.breast;
    const breastLeft = box.left + ts * br.sideInset;
    const breastRight = box.right - ts * br.sideInset;
    const breastBottom = hearthTop + ts * br.bottomOverlap;
    const mantelLevel = box.bottom - ts * br.mantelLevel;
    const stackInset = ts * br.stackInset;
    const stackTop = box.bottom - ts * br.stackTop;
    paintAshlar(
      ctx,
      breastLeft + stackInset,
      stackTop,
      breastRight - breastLeft - stackInset * 2,
      mantelLevel - stackTop + ts * br.stackOverlap,
      ts * br.courseH,
      ts * br.blockW,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(
      breastLeft + stackInset,
      stackTop,
      breastRight - breastLeft - stackInset * 2,
      mantelLevel - stackTop + ts * br.stackOverlap,
    );
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(stone.shadow, br.stackShadeAlpha);
    ctx.fillRect(
      breastRight - stackInset - ts * br.stackShadeW,
      stackTop,
      ts * br.stackShadeW,
      mantelLevel - stackTop,
    );
    paintAshlar(
      ctx,
      breastLeft,
      mantelLevel,
      breastRight - breastLeft,
      breastBottom - mantelLevel,
      ts * br.courseH,
      ts * br.blockW,
      stone,
      forkRng(rng),
    );
    ctx.beginPath();
    ctx.rect(breastLeft, mantelLevel, breastRight - breastLeft, breastBottom - mantelLevel);
    inkOutline(ctx, ts);
    // Shade the breast's east return so it stands proud of the wall.
    ctx.fillStyle = rgba(stone.shadow, br.returnShadeAlpha);
    ctx.fillRect(
      breastRight - ts * br.returnShadeW,
      mantelLevel,
      ts * br.returnShadeW,
      breastBottom - mantelLevel,
    );

    // Firebox under a keyed arch.
    const fb = s.firebox;
    const fireCx = box.centreX;
    const fireHalf = ts * fb.halfWidth;
    const fireTop = box.bottom - ts * fb.top;
    const fireBottom = hearthTop + ts * fb.bottomOverlap;
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(fireCx - fireHalf, fireBottom);
    ctx.lineTo(fireCx - fireHalf, fireTop + fireHalf * fb.springing);
    ctx.quadraticCurveTo(
      fireCx,
      fireTop - fireHalf * fb.crownPull,
      fireCx + fireHalf,
      fireTop + fireHalf * fb.springing,
    );
    ctx.lineTo(fireCx + fireHalf, fireBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const back = ctx.createRadialGradient(
      fireCx,
      fireBottom - ts * fb.backGlowInnerUp,
      fb.backGlowInnerR,
      fireCx,
      fireBottom - ts * fb.backGlowOuterUp,
      fireHalf * fb.backGlowOuterSpan,
    );
    back.addColorStop(0, rgba(EMBER_GLOW, fb.emberAlpha));
    back.addColorStop(fb.midStop, rgba(FLAME_DEEP, fb.flameDeepAlpha));
    back.addColorStop(1, rgba(SOOT, 0));
    ctx.fillStyle = back;
    ctx.fill();
    // Voussoirs and the keystone.
    const ar = s.arch;
    const voussoirs = ar.voussoirs;
    for (let i = 0; i < voussoirs; i++) {
      const t = i / (voussoirs - 1);
      const ang = Math.PI + t * Math.PI;
      const rx = fireHalf + ts * ar.radiusGap;
      const vx = fireCx + Math.cos(ang) * rx;
      const vy = fireTop + fireHalf * ar.centreDrop + Math.sin(ang) * fireHalf * ar.radiusY;
      const key = i === Math.floor(voussoirs / 2);
      const vw = key ? ts * ar.keyW : ts * ar.stoneW;
      const vh = key ? ts * ar.keyH : ts * ar.stoneH;
      block(
        ctx,
        vx - vw / 2,
        vy - vh / 2,
        vw,
        vh,
        sampleRamp(stone, key ? ar.keyTone : ar.stoneTone),
        ts,
        ar.ink,
      );
    }
    // Iron dogs, logs and the fire.
    const dg = s.dogs;
    const dogY = fireBottom - ts * dg.lift;
    for (const side of [-1, 1]) {
      block(
        ctx,
        fireCx + side * ts * dg.spread - ts * dg.halfWidth,
        dogY - ts * dg.up,
        ts * dg.width,
        ts * dg.height,
        sampleRamp(iron(), dg.tone),
        ts,
        dg.ink,
      );
      disc(
        ctx,
        fireCx + side * ts * dg.spread,
        dogY - ts * dg.knobUp,
        ts * dg.knobR,
        sampleRamp(iron(), dg.knobTone),
      );
    }
    for (const log of s.logs) {
      const lx = fireCx - ts * log.left;
      const ly = dogY - ts * log.up;
      const len = ts * log.len;
      block(ctx, lx, ly, len, ts * s.logThickness, LOG_BARK, ts, s.logInk);
      disc(ctx, lx + len, ly + ts * s.logEndDrop, ts * s.logEndR, LOG_END);
    }
    const fi = s.fire;
    glow(ctx, fireCx, dogY - ts * fi.glowUp, ts * fi.glowR, EMBER_GLOW, fi.glowAlpha);
    for (const f of fi.flames) {
      flame(ctx, fireCx + ts * f.dx, dogY - ts * f.up, ts * f.height, ts * f.width);
    }
    // The crane and the kettle, swung in over the fire.
    const cr = s.crane;
    const craneX = fireCx - fireHalf + ts * cr.postInset;
    ctx.strokeStyle = rgb(sampleRamp(iron(), cr.tone));
    ctx.lineWidth = Math.max(1, ts * cr.lineMin);
    ctx.beginPath();
    ctx.moveTo(craneX, fireBottom - ts * cr.footUp);
    ctx.lineTo(craneX, fireTop + ts * cr.armDrop);
    ctx.lineTo(fireCx + ts * cr.armReach, fireTop + ts * cr.armDrop);
    ctx.moveTo(fireCx - ts * cr.hookDx, fireTop + ts * cr.armDrop);
    ctx.lineTo(fireCx - ts * cr.hookDx, fireTop + ts * cr.hookDrop);
    ctx.stroke();
    const kt = s.kettle;
    ctx.fillStyle = rgb(COPPER);
    ctx.beginPath();
    ctx.ellipse(fireCx - ts * kt.dx, fireTop + ts * kt.drop, ts * kt.rx, ts * kt.ry, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * kt.ink);
    ctx.fillStyle = rgb(COPPER_LIGHT);
    ctx.beginPath();
    ctx.ellipse(
      fireCx - ts * kt.shineDx,
      fireTop + ts * kt.shineDrop,
      ts * kt.shineRx,
      ts * kt.shineRy,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = rgb(COPPER);
    ctx.lineWidth = Math.max(1, ts * kt.spoutLineMin);
    ctx.beginPath();
    ctx.moveTo(fireCx - ts * kt.spoutRootDx, fireTop + ts * kt.spoutRootDrop);
    ctx.lineTo(fireCx + ts * kt.spoutTipDx, fireTop + ts * kt.spoutTipDrop);
    ctx.stroke();

    // The mantel: a squared oak beam, and on it everything set exactly.
    const mn = s.mantel;
    const mantelY = mantelLevel - ts * mn.rise;
    const mantelLeft = breastLeft - ts * mn.overhang;
    const mantelW = breastRight - breastLeft + ts * mn.overhangBoth;
    block(ctx, mantelLeft, mantelY, mantelW, ts * mn.thickness, sampleRamp(wood, mn.tone), ts);
    litEdge(
      ctx,
      mantelLeft,
      mantelY,
      mantelW,
      Math.max(1, ts * mn.litMin),
      sampleRamp(wood, mn.litTone),
      mn.litAlpha,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, mn.undersideShadeTone), mn.undersideShadeAlpha);
    ctx.fillRect(mantelLeft, mantelY + ts * mn.thickness, mantelW, ts * mn.undersideShadeH);
    const cs = s.candlesticks;
    for (const side of [-1, 1]) {
      const sx = box.centreX + side * ts * cs.spread;
      for (const [part, color] of [
        [cs.foot, BRASS_DARK],
        [cs.stem, BRASS],
        [cs.candle, LINEN],
      ] as const) {
        block(
          ctx,
          sx - ts * part.halfWidth,
          mantelY - ts * part.up,
          ts * part.width,
          ts * part.height,
          color,
          ts,
          cs.ink,
        );
      }
      glow(ctx, sx, mantelY - ts * cs.glowUp, ts * cs.glowR, EMBER_GLOW, cs.glowAlpha);
      flame(ctx, sx, mantelY - ts * cs.flameUp, ts * cs.flameH, ts * cs.flameW);
    }
    // A level lying along the mantel, bubble centred.
    const lv = s.level;
    const levelW = ts * lv.width;
    block(
      ctx,
      box.centreX - levelW / 2,
      mantelY - ts * lv.up,
      levelW,
      ts * lv.height,
      ROSEWOOD,
      ts,
      lv.ink,
    );
    ctx.fillStyle = rgb(LEVEL_VIAL);
    ctx.fillRect(
      box.centreX - ts * lv.vialHalfWidth,
      mantelY - ts * lv.vialUp,
      ts * lv.vialWidth,
      ts * lv.vialHeight,
    );
    disc(ctx, box.centreX, mantelY - ts * lv.bubbleUp, Math.max(1, ts * lv.bubbleMinR), lv.bubble);

    // The log box, west on the hearthstone: squared oak, logs stacked end-on.
    const lb = s.logBox;
    const logBoxLeft = hearthLeft + ts * lb.inset;
    const logBoxW = ts * lb.width;
    const logBoxTop = box.bottom - ts * lb.top;
    const logR = ts * lb.logR;
    const lastRow = lb.rows - 1;
    const lastInRow = lb.perRow - 1;
    for (let row = 0; row < lb.rows; row++) {
      for (let i = 0; i < lb.perRow; i++) {
        const lx =
          logBoxLeft + logR * lb.firstInset + i * logR * lb.pitch + (row % 2) * logR * lb.stagger;
        const ly = logBoxTop - logR * lb.sink - row * logR * lb.rowRise;
        if (row === lastRow && i === lastInRow) continue;
        disc(ctx, lx, ly, logR, LOG_BARK);
        disc(ctx, lx, ly, logR * lb.endGrain, LOG_END);
      }
    }
    block(ctx, logBoxLeft, logBoxTop, logBoxW, ts * lb.height, sampleRamp(wood, lb.tone), ts);
    litEdge(
      ctx,
      logBoxLeft,
      logBoxTop,
      logBoxW,
      Math.max(1, ts * lb.litMin),
      sampleRamp(wood, lb.litTone),
    );
    // The fire irons on their stand, east.
    const ir = s.fireIrons;
    const standX = hearthRight - ts * ir.inset;
    block(
      ctx,
      standX - ts * ir.baseHalfWidth,
      box.bottom - ts * ir.baseUp,
      ts * ir.baseWidth,
      ts * ir.baseHeight,
      sampleRamp(iron(), ir.baseTone),
      ts,
      ir.baseInk,
    );
    ctx.strokeStyle = rgb(sampleRamp(iron(), ir.tone));
    ctx.lineWidth = Math.max(1, ts * ir.lineMin);
    ctx.beginPath();
    ctx.moveTo(standX, box.bottom - ts * ir.shaftFoot);
    ctx.lineTo(standX, box.bottom - ts * ir.shaftTop);
    ctx.moveTo(standX - ts * ir.crossbarHalf, box.bottom - ts * ir.crossbarUp);
    ctx.lineTo(standX + ts * ir.crossbarHalf, box.bottom - ts * ir.crossbarUp);
    ctx.stroke();
    for (const { dx, len } of ir.irons) {
      ctx.beginPath();
      ctx.moveTo(standX + ts * dx, box.bottom - ts * ir.crossbarUp);
      ctx.lineTo(standX + ts * dx, box.bottom - ts * (ir.crossbarUp - len));
      ctx.stroke();
    }
    disc(ctx, standX, box.bottom - ts * ir.finialUp, ts * ir.finialR, BRASS);
  });
}

/** Proportions of the good chair, in tiles or as shares of the seat half-width; tones are timber ramp stops. */
const GOOD_CHAIR = {
  shadowSpread: 0.38,
  seatUp: 0.4,
  seatHalf: 0.34,
  oiledTone: 0.62,
  oiledDarkTone: 0.42,
  turnedInkAlpha: 0.85,
  turnedInkMinPx: 2,
  turnedInkWidth: 0.03,
  legWidth: 0.06,
  legTop: 0.66,
  legFoot: 0.92,
  legFootUp: 0.05,
  stretcherWidth: 0.035,
  stretcherHalf: 0.8,
  stretcherUp: 0.2,
  bowRise: 0.86,
  spindles: 5,
  spindleWidth: 0.035,
  spindleSpanStart: 0.78,
  spindleSpan: 1.56,
  spindleBaseRise: 0.3,
  spindleArchRise: 0.4,
  bowWidth: 0.07,
  bowFoot: 0.86,
  bowFootUp: 0.04,
  bowControl: 0.98,
  armWidth: 0.06,
  armTone: 0.7,
  armRoot: 0.55,
  armRootUp: 0.32,
  armReach: 1.04,
  armReachUp: 0.28,
  armPost: 1.0,
  armPostUp: 0.02,
  seatTone: 0.72,
  seatRy: 0.13,
  saddleDrop: 0.05,
  saddleSpan: 0.96,
  saddleRy: 0.07,
  cushion: {
    half: 0.7,
    up: 0.12,
    span: 1.4,
    height: 0.14,
    radius: 0.05,
    ink: 0.7,
    sheen: [255, 220, 190],
    sheenAlpha: 0.4,
    sheenInset: 0.55,
    sheenUp: 0.1,
    sheenSpan: 0.8,
    sheenMin: 0.025,
  },
} as const;

/**
 * The one good chair: a Windsor armchair, bow back and five spindles, a
 * saddled elm seat oiled to a shine, with a madder wool cushion.
 */
export function paintGoodChair(ctx: Ctx, frame: TownPropFrame): void {
  const s = GOOD_CHAIR;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const cx = box.centreX;
    const seatY = box.bottom - ts * s.seatUp;
    const seatHalf = ts * s.seatHalf;
    const oiled = sampleRamp(wood, s.oiledTone);
    const oiledDark = sampleRamp(wood, s.oiledDarkTone);
    // Every turned part is stroked twice, ink under wood, so a spindle two
    // pixels wide still has an edge at 32 px.
    const turned = (width: number, color: RGB, path: () => void): void => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(TOWN_INK, s.turnedInkAlpha);
      ctx.lineWidth = width + Math.max(s.turnedInkMinPx, ts * s.turnedInkWidth);
      path();
      ctx.stroke();
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = width;
      path();
      ctx.stroke();
      ctx.lineCap = 'butt';
    };
    const legWidth = ts * s.legWidth;
    for (const side of [-1, 1]) {
      turned(legWidth, oiledDark, () => {
        ctx.beginPath();
        ctx.moveTo(cx + side * seatHalf * s.legTop, seatY);
        ctx.lineTo(cx + side * seatHalf * s.legFoot, box.bottom - ts * s.legFootUp);
      });
    }
    turned(ts * s.stretcherWidth, oiledDark, () => {
      ctx.beginPath();
      ctx.moveTo(cx - seatHalf * s.stretcherHalf, box.bottom - ts * s.stretcherUp);
      ctx.lineTo(cx + seatHalf * s.stretcherHalf, box.bottom - ts * s.stretcherUp);
    });
    const bowTop = seatY - ts * s.bowRise;
    const spindles = s.spindles;
    for (let i = 1; i <= spindles; i++) {
      const t = i / (spindles + 1);
      const sx = cx - seatHalf * s.spindleSpanStart + seatHalf * s.spindleSpan * t;
      const arch = Math.sin(t * Math.PI);
      turned(ts * s.spindleWidth, oiled, () => {
        ctx.beginPath();
        ctx.moveTo(sx, seatY);
        ctx.lineTo(sx, seatY - ts * (s.spindleBaseRise + arch * s.spindleArchRise));
      });
    }
    turned(ts * s.bowWidth, oiled, () => {
      ctx.beginPath();
      ctx.moveTo(cx - seatHalf * s.bowFoot, seatY - ts * s.bowFootUp);
      ctx.bezierCurveTo(
        cx - seatHalf * s.bowControl,
        bowTop,
        cx + seatHalf * s.bowControl,
        bowTop,
        cx + seatHalf * s.bowFoot,
        seatY - ts * s.bowFootUp,
      );
    });
    for (const side of [-1, 1]) {
      turned(ts * s.armWidth, sampleRamp(wood, s.armTone), () => {
        ctx.beginPath();
        ctx.moveTo(cx + side * seatHalf * s.armRoot, seatY - ts * s.armRootUp);
        ctx.lineTo(cx + side * seatHalf * s.armReach, seatY - ts * s.armReachUp);
        ctx.lineTo(cx + side * seatHalf * s.armPost, seatY - ts * s.armPostUp);
      });
    }
    // The saddled seat, and the cushion on it.
    ctx.fillStyle = rgb(sampleRamp(wood, s.seatTone));
    ctx.beginPath();
    ctx.ellipse(cx, seatY, seatHalf, ts * s.seatRy, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(oiledDark);
    ctx.beginPath();
    ctx.ellipse(
      cx,
      seatY + ts * s.saddleDrop,
      seatHalf * s.saddleSpan,
      ts * s.saddleRy,
      0,
      0,
      Math.PI,
    );
    ctx.fill();
    const cu = s.cushion;
    ctx.fillStyle = rgb(CUSHION);
    ctx.beginPath();
    ctx.roundRect(
      cx - seatHalf * cu.half,
      seatY - ts * cu.up,
      seatHalf * cu.span,
      ts * cu.height,
      ts * cu.radius,
    );
    ctx.fill();
    inkOutline(ctx, ts * cu.ink);
    ctx.fillStyle = rgba(cu.sheen, cu.sheenAlpha);
    ctx.fillRect(
      cx - seatHalf * cu.sheenInset,
      seatY - ts * cu.sheenUp,
      seatHalf * cu.sheenSpan,
      Math.max(1, ts * cu.sheenMin),
    );
  });
}

// ── The farmer ─────────────────────────────────────────────────────────────

/** Proportions of the milking stool, in tiles; tones are timber ramp stops. */
const STOOL_UNDER_BENCH = {
  seatHeight: 0.26,
  legTone: 0.4,
  legLineMin: 0.045,
  /** Each leg's splay at the floor; at the seat each sits at `legSeatPinch` of that. */
  legSpreads: [-0.16, 0, 0.16],
  legSeatPinch: 0.55,
  /** The middle leg stands at the back, so its foot lands higher on the page. */
  backLegLift: 0.05,
  seatTone: 0.66,
  seatRx: 0.2,
  seatRy: 0.07,
  seatInk: 0.7,
  sheenAlpha: 0.5,
  sheenDx: 0.05,
  sheenUp: 0.02,
  sheenRx: 0.08,
  sheenRy: 0.02,
} as const;

/** A three-legged milking stool seen low and square-on, its seat at knee height. */
function paintStoolUnderBench(ctx: Ctx, cx: number, floorY: number, ts: number, wood: Ramp): void {
  const s = STOOL_UNDER_BENCH;
  const seatY = floorY - ts * s.seatHeight;
  ctx.strokeStyle = rgb(sampleRamp(wood, s.legTone));
  ctx.lineWidth = Math.max(1, ts * s.legLineMin);
  for (const spread of s.legSpreads) {
    ctx.beginPath();
    ctx.moveTo(cx + ts * spread * s.legSeatPinch, seatY);
    ctx.lineTo(cx + ts * spread, floorY - (spread === 0 ? ts * s.backLegLift : 0));
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(wood, s.seatTone));
  ctx.beginPath();
  ctx.ellipse(cx, seatY, ts * s.seatRx, ts * s.seatRy, 0, 0, TWO_PI);
  ctx.fill();
  inkOutline(ctx, ts * s.seatInk);
  ctx.fillStyle = rgba(PINE_LIGHT, s.sheenAlpha);
  ctx.beginPath();
  ctx.ellipse(
    cx - ts * s.sheenDx,
    seatY - ts * s.sheenUp,
    ts * s.sheenRx,
    ts * s.sheenRy,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/**
 * Proportions of the herd slate: cord and nail in tiles, text as shares of the
 * written width, rows as shares of the slate's height.
 */
const HERD_SLATE = {
  cordLineMin: 0.014,
  /** Where the cord meets the frame, as shares of the slate's width. */
  cordLeft: 0.2,
  cordRight: 0.8,
  nailDrop: 0.02,
  nailMinR: 0.022,
  nailTone: 0.6,
  frameMinPx: 2,
  frameWidth: 0.05,
  frameInk: 0.8,
  slateInk: 0.3,
  bloomAlpha: 0.12,
  bloomDepth: 0.3,
  headingDrop: 0.12,
  headingAlpha: 0.9,
  headingLineMin: 0.018,
  headingInset: 0.15,
  headingSpan: 0.7,
  underlineDrop: 0.07,
  underlineStart: 0.1,
  underlineEnd: 0.9,
  namesDepth: 0.62,
  strikeSpan: 0.8,
  firstNameDrop: 0.16,
  nameAlpha: 0.75,
  nameLineMin: 0.014,
  nameInset: 0.1,
  strikeAlpha: 0.95,
  strikeLineMin: 0.016,
  strikeInset: 0.06,
} as const;

/**
 * The herd slate: a framed school slate hung by a cord from the peg rail, a
 * heading chalked across the top and five names under it, each struck
 * through with one straight, level line of equal length. At the tile the
 * names are chalk scribble; the strikes are what read.
 */
function paintHerdSlate(ctx: Ctx, slate: SheetRect, railY: number, ts: number, rng: Rng): void {
  const s = HERD_SLATE;
  const nailX = slate.x + slate.w / 2;
  ctx.strokeStyle = rgb(HESSIAN_DARK);
  ctx.lineWidth = Math.max(1, ts * s.cordLineMin);
  ctx.beginPath();
  ctx.moveTo(slate.x + slate.w * s.cordLeft, slate.y);
  ctx.lineTo(nailX, railY + ts * s.nailDrop);
  ctx.lineTo(slate.x + slate.w * s.cordRight, slate.y);
  ctx.stroke();
  disc(
    ctx,
    nailX,
    railY + ts * s.nailDrop,
    Math.max(1, ts * s.nailMinR),
    sampleRamp(iron(), s.nailTone),
  );
  const frameW = Math.max(s.frameMinPx, ts * s.frameWidth);
  block(ctx, slate.x, slate.y, slate.w, slate.h, BEECH, ts, s.frameInk);
  block(
    ctx,
    slate.x + frameW,
    slate.y + frameW,
    slate.w - frameW * 2,
    slate.h - frameW * 2,
    SLATE,
    ts,
    s.slateInk,
  );
  ctx.fillStyle = rgba(CHALK, s.bloomAlpha);
  ctx.fillRect(
    slate.x + frameW,
    slate.y + frameW,
    slate.w - frameW * 2,
    (slate.h - frameW * 2) * s.bloomDepth,
  );
  const textLeft = slate.x + frameW * 2;
  const textW = slate.w - frameW * 4;
  const headingY = slate.y + frameW + slate.h * s.headingDrop;
  ctx.strokeStyle = rgba(CHALK, s.headingAlpha);
  ctx.lineWidth = Math.max(1, ts * s.headingLineMin);
  chalkScribble(ctx, textLeft + textW * s.headingInset, headingY, textW * s.headingSpan, ts, rng);
  ctx.beginPath();
  ctx.moveTo(textLeft + textW * s.underlineStart, headingY + slate.h * s.underlineDrop);
  ctx.lineTo(textLeft + textW * s.underlineEnd, headingY + slate.h * s.underlineDrop);
  ctx.stroke();
  const names = HERD_SLATE_NAME_LENGTHS.length;
  const rowPitch = (slate.h * s.namesDepth) / names;
  const strikeW = textW * s.strikeSpan;
  HERD_SLATE_NAME_LENGTHS.forEach((length, row) => {
    const rowY = headingY + slate.h * s.firstNameDrop + rowPitch * row;
    ctx.strokeStyle = rgba(CHALK, s.nameAlpha);
    ctx.lineWidth = Math.max(1, ts * s.nameLineMin);
    chalkScribble(ctx, textLeft + textW * s.nameInset, rowY, textW * length, ts, rng);
    ctx.strokeStyle = rgba(CHALK, s.strikeAlpha);
    ctx.lineWidth = Math.max(1, ts * s.strikeLineMin);
    ctx.beginPath();
    ctx.moveTo(textLeft + textW * s.strikeInset, rowY);
    ctx.lineTo(textLeft + textW * s.strikeInset + strikeW, rowY);
    ctx.stroke();
  });
}

/** Each name's written length as a share of the slate's width. The strikes through them are all one length. */
const HERD_SLATE_NAME_LENGTHS: readonly number[] = [0.55, 0.7, 0.42, 0.62, 0.5];

/** Loop size in tiles; rises and control points as shares of one loop. */
const CHALK_SCRIBBLE = {
  loopW: 0.035,
  loopH: 0.03,
  riseBase: 0.6,
  riseJitter: 0.4,
  upStroke: 0.25,
  downStroke: 0.75,
  /** The return stroke dips below the baseline by this share of the rise. */
  dip: 0.4,
} as const;

/** Handwriting too small to read: a run of loops along a baseline. */
function chalkScribble(ctx: Ctx, x: number, y: number, w: number, ts: number, rng: Rng): void {
  const s = CHALK_SCRIBBLE;
  const loopW = ts * s.loopW;
  const loopH = ts * s.loopH;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let lx = x; lx < x + w; lx += loopW) {
    const rise = loopH * (s.riseBase + jitter(rng, s.riseJitter));
    ctx.quadraticCurveTo(lx + loopW * s.upStroke, y - rise, lx + loopW * 0.5, y);
    ctx.quadraticCurveTo(lx + loopW * s.downStroke, y + rise * s.dip, lx + loopW, y);
  }
  ctx.stroke();
}

/** Proportions of the dairy wall, in tiles unless named as an alpha, mix share or ink weight. */
const DAIRY_WALL = {
  shadowSpread: 0.46,
  sideInset: 0.06,
  window: { width: 0.96, height: 0.62, up: 1.9, lightFall: 0.9, lightDrift: 0.1 },
  rail: { up: 1.86, gap: 0.14, height: 0.07, tone: 0.6, ink: 0.6, litMin: 0.015, litTone: 1 },
  pails: {
    xs: [0.2, 0.56],
    drop: 0.46,
    width: 0.3,
    height: 0.3,
  },
  skimmer: {
    x: 0.86,
    lineMin: 0.02,
    handleTop: 0.04,
    handleBottom: 0.3,
    bowlDrop: 0.38,
    bowlRx: 0.07,
    bowlRy: 0.09,
    ink: 0.5,
  },
  slate: { gap: 0.2, drop: 0.1, rightTrim: 0.3, height: 0.62 },
  bench: {
    top: 0.62,
    legW: 0.08,
    legInset: 0.06,
    footUp: 0.04,
    legShade: 0.35,
    legInk: 0.6,
    stretcherInset: 0.1,
    stretcherTrim: 0.2,
    stretcherUp: 0.22,
    stretcherH: 0.05,
    stretcherShade: 0.25,
    stretcherInk: 0.5,
    boardRise: 0.08,
    boardH: 0.1,
    litMin: 0.025,
    lit: [248, 240, 222],
    litAlpha: 0.9,
  },
  stool: { x: 0.8, floorUp: 0.06 },
  brush: { rightInset: 0.72, up: 0.33, width: 0.22, height: 0.07, ink: 0.4 },
  pans: {
    count: 3,
    x: 0.22,
    pitch: 0.14,
    tinStep: 0.2,
    rise: 0.2,
    rx: 0.05,
    ry: 0.2,
    ink: 0.5,
  },
  nest: {
    rightInset: 0.42,
    count: 3,
    width: 0.34,
    widthStep: 0.02,
    rise: 0.08,
    tinBase: 0.2,
    tinStep: 0.15,
    /** Half-widths of each pail's upturned base and its mouth, as shares of its width. */
    baseHalf: 0.4,
    mouthHalf: 0.5,
    height: 0.1,
    ink: 0.5,
    glintAlpha: 0.95,
    glintDx: 0.12,
    glintUp: 0.28,
    glintW: 0.04,
    glintH: 0.2,
  },
  cloth: {
    x: 1.5,
    up: 0.08,
    width: 0.4,
    height: 0.08,
    ink: 0.5,
    foldAlpha: 0.8,
    foldUp: 0.04,
    foldH: 0.02,
  },
  toneBreak: { alpha: 0.18, jitter: 0.03, up: 0.01, height: 0.03 },
} as const;

/**
 * The dairy wall: a window onto the pasture with its good fence and no cow,
 * a peg rail either side — two pails hung upturned and a skimmer on one side,
 * the herd slate of struck-through names on the other — over a scrubbed deal
 * bench with the milking stool pushed in under it, carrying
 * setting pans, a stack of nested tin pails and a folded straining cloth.
 */
export function paintDairyWall(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = DAIRY_WALL;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.sideInset;
    const right = box.right - ts * s.sideInset;
    const width = right - left;

    const wn = s.window;
    const windowW = ts * wn.width;
    const windowH = ts * wn.height;
    const windowX = box.centreX - windowW / 2;
    const windowY = box.bottom - ts * wn.up;
    paintWindow(ctx, windowX, windowY, windowW, windowH, ts, true);
    daylight(ctx, windowX, windowY + windowH, windowW, ts * wn.lightFall, -ts * wn.lightDrift);

    // Peg rails either side of the window.
    const rl = s.rail;
    const railY = box.bottom - ts * rl.up;
    for (const [rx, rw] of [
      [left, windowX - left - ts * rl.gap],
      [windowX + windowW + ts * rl.gap, right - windowX - windowW - ts * rl.gap],
    ] as const) {
      block(ctx, rx, railY, rw, ts * rl.height, sampleRamp(wood, rl.tone), ts, rl.ink);
      litEdge(ctx, rx, railY, rw, Math.max(1, ts * rl.litMin), sampleRamp(wood, rl.litTone));
    }
    // West: two pails hung upturned by their bails, and a skimmer.
    const pl = s.pails;
    for (const px of pl.xs) {
      paintPail(ctx, left + ts * px, railY + ts * pl.drop, ts * pl.width, ts * pl.height, ts, true);
    }
    const sk = s.skimmer;
    ctx.strokeStyle = rgb(TIN_DARK);
    ctx.lineWidth = Math.max(1, ts * sk.lineMin);
    ctx.beginPath();
    ctx.moveTo(left + ts * sk.x, railY + ts * sk.handleTop);
    ctx.lineTo(left + ts * sk.x, railY + ts * sk.handleBottom);
    ctx.stroke();
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.ellipse(
      left + ts * sk.x,
      railY + ts * sk.bowlDrop,
      ts * sk.bowlRx,
      ts * sk.bowlRy,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    inkOutline(ctx, ts * sk.ink);
    // East: the herd slate on its nail — every cow's name chalked in his
    // hand, and every one struck through with the same level line.
    const sl = s.slate;
    paintHerdSlate(
      ctx,
      {
        x: windowX + windowW + ts * sl.gap,
        y: railY + ts * sl.drop,
        w: right - windowX - windowW - ts * sl.rightTrim,
        h: ts * sl.height,
      },
      railY,
      ts,
      rng,
    );

    // The scrubbed bench.
    const bn = s.bench;
    const benchTop = box.bottom - ts * bn.top;
    const legW = ts * bn.legW;
    for (const lx of [left + ts * bn.legInset, right - ts * bn.legInset - legW]) {
      block(
        ctx,
        lx,
        benchTop,
        legW,
        box.bottom - ts * bn.footUp - benchTop,
        mix(SCRUBBED_DEAL, PINE_DARK, bn.legShade),
        ts,
        bn.legInk,
      );
    }
    block(
      ctx,
      left + ts * bn.stretcherInset,
      box.bottom - ts * bn.stretcherUp,
      width - ts * bn.stretcherTrim,
      ts * bn.stretcherH,
      mix(SCRUBBED_DEAL, PINE_DARK, bn.stretcherShade),
      ts,
      bn.stretcherInk,
    );
    // Under the bench: the milking stool pushed right in, and a scrubbing brush.
    paintStoolUnderBench(ctx, left + ts * s.stool.x, box.bottom - ts * s.stool.floorUp, ts, wood);
    const bh = s.brush;
    block(
      ctx,
      right - ts * bh.rightInset,
      box.bottom - ts * bh.up,
      ts * bh.width,
      ts * bh.height,
      BEECH,
      ts,
      bh.ink,
    );
    block(ctx, left, benchTop - ts * bn.boardRise, width, ts * bn.boardH, SCRUBBED_DEAL, ts);
    litEdge(
      ctx,
      left,
      benchTop - ts * bn.boardRise,
      width,
      Math.max(1, ts * bn.litMin),
      bn.lit,
      bn.litAlpha,
    );
    // On it: three setting pans on edge, a nest of tin pails, a folded straining cloth.
    const pn = s.pans;
    const panY = benchTop - ts * bn.boardRise;
    for (let i = 0; i < pn.count; i++) {
      const px = left + ts * pn.x + i * ts * pn.pitch;
      ctx.fillStyle = rgb(mix(TIN, TIN_LIGHT, i * pn.tinStep));
      ctx.beginPath();
      ctx.ellipse(px, panY - ts * pn.rise, ts * pn.rx, ts * pn.ry, 0, 0, TWO_PI);
      ctx.fill();
      inkOutline(ctx, ts * pn.ink);
    }
    const ns = s.nest;
    const nestX = right - ts * ns.rightInset;
    for (let i = 0; i < ns.count; i++) {
      const pw = ts * (ns.width - i * ns.widthStep);
      const py = panY - i * ts * ns.rise;
      ctx.fillStyle = rgb(mix(TIN, TIN_LIGHT, ns.tinBase + i * ns.tinStep));
      ctx.beginPath();
      ctx.moveTo(nestX - pw * ns.baseHalf, py);
      ctx.lineTo(nestX + pw * ns.baseHalf, py);
      ctx.lineTo(nestX + pw * ns.mouthHalf, py - ts * ns.height);
      ctx.lineTo(nestX - pw * ns.mouthHalf, py - ts * ns.height);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * ns.ink);
    }
    ctx.fillStyle = rgba(TIN_LIGHT, ns.glintAlpha);
    ctx.fillRect(nestX - ts * ns.glintDx, panY - ts * ns.glintUp, ts * ns.glintW, ts * ns.glintH);
    const cl = s.cloth;
    block(
      ctx,
      left + ts * cl.x,
      panY - ts * cl.up,
      ts * cl.width,
      ts * cl.height,
      LINEN,
      ts,
      cl.ink,
    );
    ctx.fillStyle = rgba(LINEN_SHADE, cl.foldAlpha);
    ctx.fillRect(left + ts * cl.x, panY - ts * cl.foldUp, ts * cl.width, ts * cl.foldH);
    // Tone breaks on the bench's own face so it is not one flat slab.
    const tb = s.toneBreak;
    ctx.fillStyle = rgba(PINE_DARK, tb.alpha + jitter(rng, tb.jitter));
    ctx.fillRect(left, benchTop - ts * tb.up, width, ts * tb.height);
  });
}

/**
 * Proportions for {@link paintChurnStand}. Lengths are fractions of the tile
 * scale unless the key says it is a fraction of something else; tones are
 * positions on a ramp.
 */
const CHURN_STAND = {
  shadowSpread: 0.46,
  stand: {
    height: 0.18,
    slats: 4,
    inset: 0.06,
    slatPitch: 0.035,
    /** Fraction of the footprint width. */
    widthFraction: 0.7,
    slatThickness: 0.03,
    tone: 0.55,
    toneJitter: 0.04,
    toneStepPerSlat: 0.04,
    ink: 0.35,
  },
  churns: {
    count: 3,
    width: 0.4,
    firstX: 0.3,
    pitch: 0.46,
    seatDrop: 0.02,
    height: 0.86,
  },
  cloth: {
    x: 0.76,
    rise: 0.62,
    shoulderLeftX: 0.2,
    shoulderRightX: 0.16,
    shoulderRightLift: 0.03,
    hemRightX: 0.18,
    hemRightDrop: 0.3,
    foldX: 0.06,
    foldDrop: 0.24,
    hemLeftX: 0.12,
    hemLeftDrop: 0.34,
    ink: 0.5,
    creaseAlpha: 0.8,
    creaseX: 0.02,
    creaseDrop: 0.02,
    creaseWidth: 0.06,
    creaseLength: 0.26,
  },
  wetStand: {
    alpha: 0.22,
    inset: 0.1,
    /** Fraction of the footprint width. */
    widthFraction: 0.4,
    height: 0.12,
  },
  butterChurn: {
    insetFromRight: 0.34,
    floorLift: 0.04,
    height: 0.9,
    halfBottom: 0.2,
    halfTop: 0.14,
    ink: 0.8,
    staves: 5,
    staveSeamAlpha: 0.55,
    shadeAlpha: 0.4,
    shadeX: 0.04,
    shadeWidth: 0.2,
    hoopTone: 0.6,
    /** Hoop positions as fractions of the churn's height, top down. */
    hoopAt: [0.12, 0.5, 0.86],
    hoopThickness: 0.035,
    /** Lid radius as a multiple of the churn's top half-width. */
    lidOverhang: 1.05,
    lidRadiusY: 0.05,
    lidInk: 0.55,
  },
  dasher: {
    riseInUse: 0.16,
    riseIdle: 0.34,
    shaftHalf: 0.02,
    shaftWidth: 0.04,
    ink: 0.45,
    handleHalf: 0.07,
    handleLift: 0.02,
    handleWidth: 0.14,
    handleHeight: 0.04,
  },
  cream: {
    /** Each run of cream down the staves: x offset from the churn's axis, then length. */
    runs: [
      [-0.08, 0.2],
      [0.02, 0.12],
      [0.09, 0.28],
    ],
    runTop: 0.01,
    runWidth: 0.035,
    runRadius: 0.015,
    westSplashX: 0.12,
    westSplashRise: 0.04,
    westSplashRadius: 0.025,
    eastSplashX: 0.14,
    eastSplashRise: 0.06,
    eastSplashRadius: 0.02,
  },
} as const;

/**
 * Three tall milk churns standing on a slatted stand and a plunger butter
 * churn beside them. Idle, all of them are scoured and dry with their lids
 * seated, exactly where a full one would stand. In use, the first churn is
 * open on new milk, a straining cloth is thrown over the next, the stand is
 * wet and the butter churn's dasher is down in cream.
 */
export function paintChurnStand(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  const inUse = variant === CHURN_STAND_VARIANT.inUse;
  const s = CHURN_STAND;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    // The slatted stand that keeps the tin off a wet floor.
    const standTop = box.bottom - ts * s.stand.height;
    const slats = s.stand.slats;
    for (let i = 0; i < slats; i++) {
      block(
        ctx,
        box.left + ts * s.stand.inset,
        standTop + i * ts * s.stand.slatPitch,
        box.width * s.stand.widthFraction,
        ts * s.stand.slatThickness,
        sampleRamp(
          wood,
          s.stand.tone + jitter(rng, s.stand.toneJitter) - i * s.stand.toneStepPerSlat,
        ),
        ts,
        s.stand.ink,
      );
    }
    const churns = s.churns.count;
    const churnW = ts * s.churns.width;
    for (let i = 0; i < churns; i++) {
      const cx = box.left + ts * s.churns.firstX + i * ts * s.churns.pitch;
      paintChurn(
        ctx,
        cx,
        standTop + ts * s.churns.seatDrop,
        churnW,
        ts * s.churns.height,
        ts,
        inUse && i === 0,
      );
    }
    if (inUse) {
      // The straining cloth thrown over the middle churn's shoulder, and the
      // stand dark where the milk was poured.
      const cloth = s.cloth;
      const clothX = box.left + ts * cloth.x;
      const clothY = standTop - ts * cloth.rise;
      ctx.fillStyle = rgb(LINEN);
      ctx.beginPath();
      ctx.moveTo(clothX - ts * cloth.shoulderLeftX, clothY);
      ctx.lineTo(clothX + ts * cloth.shoulderRightX, clothY - ts * cloth.shoulderRightLift);
      ctx.lineTo(clothX + ts * cloth.hemRightX, clothY + ts * cloth.hemRightDrop);
      ctx.lineTo(clothX + ts * cloth.foldX, clothY + ts * cloth.foldDrop);
      ctx.lineTo(clothX - ts * cloth.hemLeftX, clothY + ts * cloth.hemLeftDrop);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * cloth.ink);
      ctx.fillStyle = rgba(LINEN_SHADE, cloth.creaseAlpha);
      ctx.fillRect(
        clothX - ts * cloth.creaseX,
        clothY + ts * cloth.creaseDrop,
        ts * cloth.creaseWidth,
        ts * cloth.creaseLength,
      );
      ctx.fillStyle = rgba(SOOT, s.wetStand.alpha);
      ctx.fillRect(
        box.left + ts * s.wetStand.inset,
        standTop,
        box.width * s.wetStand.widthFraction,
        ts * s.wetStand.height,
      );
    }
    // The butter churn: tall staves, three hoops, a lid and its dasher.
    const churn = s.butterChurn;
    const bx = box.right - ts * churn.insetFromRight;
    const bottom = box.bottom - ts * churn.floorLift;
    const top = bottom - ts * churn.height;
    const halfBottom = ts * churn.halfBottom;
    const halfTop = ts * churn.halfTop;
    ctx.fillStyle = rgb(PINE);
    ctx.beginPath();
    ctx.moveTo(bx - halfTop, top);
    ctx.lineTo(bx + halfTop, top);
    ctx.lineTo(bx + halfBottom, bottom);
    ctx.lineTo(bx - halfBottom, bottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * churn.ink);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba(PINE_DARK, churn.staveSeamAlpha);
    ctx.lineWidth = 1;
    for (let i = 1; i < churn.staves; i++) {
      const t = i / churn.staves - 0.5;
      ctx.beginPath();
      ctx.moveTo(bx + t * halfTop * 2, top);
      ctx.lineTo(bx + t * halfBottom * 2, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(PINE_DARK, churn.shadeAlpha);
    ctx.fillRect(bx + ts * churn.shadeX, top, ts * churn.shadeWidth, bottom - top);
    ctx.fillStyle = rgb(sampleRamp(iron(), churn.hoopTone));
    for (const t of churn.hoopAt)
      ctx.fillRect(
        bx - halfBottom,
        top + (bottom - top) * t,
        halfBottom * 2,
        Math.max(1, ts * churn.hoopThickness),
      );
    ctx.restore();
    ctx.fillStyle = rgb(PINE_LIGHT);
    ctx.beginPath();
    ctx.ellipse(bx, top, halfTop * churn.lidOverhang, ts * churn.lidRadiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * churn.lidInk);
    // Idle, the dasher stands drawn right up; in use it is pushed half down,
    // with cream thrown up round the lid and run down the staves.
    const dasher = s.dasher;
    const dasherRise = ts * (inUse ? dasher.riseInUse : dasher.riseIdle);
    block(
      ctx,
      bx - ts * dasher.shaftHalf,
      top - dasherRise,
      ts * dasher.shaftWidth,
      dasherRise,
      BEECH,
      ts,
      dasher.ink,
    );
    block(
      ctx,
      bx - ts * dasher.handleHalf,
      top - dasherRise - ts * dasher.handleLift,
      ts * dasher.handleWidth,
      ts * dasher.handleHeight,
      BEECH,
      ts,
      dasher.ink,
    );
    if (inUse) {
      const cream = s.cream;
      ctx.fillStyle = rgb(CREAM);
      for (const [dx, runLength] of cream.runs) {
        ctx.beginPath();
        ctx.roundRect(
          bx + ts * dx,
          top - ts * cream.runTop,
          ts * cream.runWidth,
          ts * runLength,
          ts * cream.runRadius,
        );
        ctx.fill();
      }
      disc(
        ctx,
        bx - ts * cream.westSplashX,
        top - ts * cream.westSplashRise,
        ts * cream.westSplashRadius,
        CREAM,
      );
      disc(
        ctx,
        bx + ts * cream.eastSplashX,
        top - ts * cream.eastSplashRise,
        ts * cream.eastSplashRadius,
        CREAM,
      );
    }
  });
}

/** Proportions for {@link paintMilkingStool}, as fractions of the tile scale. */
const MILKING_STOOL = {
  shadowSpread: 0.38,
  stool: {
    x: 0.36,
    seatHeight: 0.3,
    legTone: 0.45,
    legWidth: 0.045,
    /** Each leg's foot, as an x offset from the seat's centre. */
    legSplay: [-0.14, 0, 0.14],
    /** How far in toward the centre each leg meets the seat, as a fraction of its splay. */
    legTopTaper: 0.6,
    /** The back leg stands higher, being further off. */
    backLegLift: 0.1,
    frontLegLift: 0.04,
    seatTone: 0.7,
    seatRadiusX: 0.2,
    seatRadiusY: 0.075,
    ink: 0.8,
    sheenAlpha: 0.35,
    sheenX: 0.05,
    sheenRise: 0.02,
    sheenRadiusX: 0.08,
    sheenRadiusY: 0.02,
  },
  pail: {
    insetFromRight: 0.26,
    floorLift: 0.06,
    width: 0.34,
    height: 0.32,
  },
} as const;

/**
 * A three-legged milking stool with a clean pail standing beside it,
 * upright and dry.
 */
export function paintMilkingStool(ctx: Ctx, frame: TownPropFrame): void {
  const s = MILKING_STOOL;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    const stool = s.stool;
    contactShadow(ctx, frame, s.shadowSpread);
    const stoolX = box.left + ts * stool.x;
    const seatY = box.bottom - ts * stool.seatHeight;
    ctx.strokeStyle = rgb(sampleRamp(wood, stool.legTone));
    ctx.lineWidth = Math.max(1, ts * stool.legWidth);
    for (const dx of stool.legSplay) {
      ctx.beginPath();
      ctx.moveTo(stoolX + ts * dx * stool.legTopTaper, seatY);
      ctx.lineTo(
        stoolX + ts * dx,
        box.bottom - ts * (dx === 0 ? stool.backLegLift : stool.frontLegLift),
      );
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(wood, stool.seatTone));
    ctx.beginPath();
    ctx.ellipse(stoolX, seatY, ts * stool.seatRadiusX, ts * stool.seatRadiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * stool.ink);
    ctx.fillStyle = rgba([255, 240, 210], stool.sheenAlpha);
    ctx.beginPath();
    ctx.ellipse(
      stoolX - ts * stool.sheenX,
      seatY - ts * stool.sheenRise,
      ts * stool.sheenRadiusX,
      ts * stool.sheenRadiusY,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    paintPail(
      ctx,
      box.right - ts * s.pail.insetFromRight,
      box.bottom - ts * s.pail.floorLift,
      ts * s.pail.width,
      ts * s.pail.height,
      ts,
      false,
    );
  });
}

/** Proportions for {@link paintFeedStack}, as fractions of the tile scale. */
const FEED_STACK = {
  shadowSpread: 0.46,
  inset: 0.08,
  widthTrim: 0.16,
  sackHeight: 0.3,
  lowerSacks: 3,
  upperSacks: 2,
  /** The upper row's sacks are a little wider than a third of the stack. */
  upperWidthDivisor: 2.6,
  floorLift: 0.04,
  sackGap: 0.02,
  /** Upper-row rise, in sack heights: less than two, as they settle into the row below. */
  upperRise: 1.86,
  scoop: {
    /** Fraction of the stack's width. */
    xFraction: 0.44,
    /** Rise in sack heights. */
    rise: 1.9,
    lipX: 0.22,
    lipLift: 0.02,
    backX: 0.2,
    backLift: 0.1,
    heelX: 0.02,
    heelLift: 0.08,
    ink: 0.5,
    handleX: 0.12,
    handleLift: 0.06,
    handleLength: 0.13,
    handleThickness: 0.03,
    handleInk: 0.35,
  },
} as const;

/**
 * Feed sacks stacked square — three below, two above, stencils all facing
 * out — with a tin scoop laid on top. Bought in for cows he does not have.
 */
export function paintFeedStack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = FEED_STACK;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.inset;
    const width = box.width - ts * s.widthTrim;
    const sackH = ts * s.sackHeight;
    const lowerW = width / s.lowerSacks;
    for (let i = 0; i < s.lowerSacks; i++) {
      paintLyingSack(
        ctx,
        left + lowerW * i,
        box.bottom - ts * s.floorLift - sackH,
        lowerW - ts * s.sackGap,
        sackH,
        ts,
        forkRng(rng),
      );
    }
    const upperW = width / s.upperWidthDivisor;
    for (let i = 0; i < s.upperSacks; i++) {
      paintLyingSack(
        ctx,
        left + lowerW * 0.5 + upperW * i,
        box.bottom - ts * s.floorLift - sackH * s.upperRise,
        upperW - ts * s.sackGap,
        sackH,
        ts,
        forkRng(rng),
      );
    }
    const scoop = s.scoop;
    const scoopX = left + width * scoop.xFraction;
    const scoopY = box.bottom - ts * s.floorLift - sackH * scoop.rise;
    ctx.fillStyle = rgb(TIN);
    ctx.beginPath();
    ctx.moveTo(scoopX, scoopY);
    ctx.lineTo(scoopX + ts * scoop.lipX, scoopY - ts * scoop.lipLift);
    ctx.lineTo(scoopX + ts * scoop.backX, scoopY - ts * scoop.backLift);
    ctx.lineTo(scoopX + ts * scoop.heelX, scoopY - ts * scoop.heelLift);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * scoop.ink);
    block(
      ctx,
      scoopX - ts * scoop.handleX,
      scoopY - ts * scoop.handleLift,
      ts * scoop.handleLength,
      ts * scoop.handleThickness,
      BEECH,
      ts,
      scoop.handleInk,
    );
  });
}

/**
 * Proportions for {@link paintSupperTable}. Lengths are fractions of the tile
 * scale unless the key says otherwise; place-setting offsets are from the
 * plate's centre.
 */
const SUPPER_TABLE = {
  shadowSpread: 0.44,
  inset: 0.1,
  topHeight: 0.72,
  topDepth: 0.34,
  apronHeight: 0.1,
  legWidth: 0.09,
  legInset: 0.04,
  floorLift: 0.04,
  legTone: 0.4,
  ink: 0.7,
  apronInset: 0.02,
  apronTrim: 0.04,
  apronTone: 0.45,
  boardsAcrossTop: 3,
  edgeThickness: 0.03,
  edgeTone: 0.9,
  edgeAlpha: 0.6,
  plate: {
    /** Fraction of the table's width. */
    xFraction: 0.36,
    /** Fraction of the top's depth. */
    yFraction: 0.52,
    radiusX: 0.17,
    radiusY: 0.09,
    ink: 0.5,
    wellRadiusX: 0.11,
    wellRadiusY: 0.055,
  },
  bread: {
    dx: 0.02,
    rise: 0.01,
    radiusX: 0.06,
    radiusY: 0.035,
    /** Radians. */
    tilt: 0.3,
    ink: 0.4,
  },
  cutlery: {
    spacing: 0.24,
    halfWidth: 0.012,
    rise: 0.08,
    width: 0.024,
    length: 0.16,
  },
  napkin: {
    offset: 0.4,
    rise: 0.05,
    size: 0.1,
    ink: 0.4,
  },
  cup: {
    offset: 0.36,
    rise: 0.14,
    width: 0.08,
    height: 0.1,
    ink: 0.45,
  },
  jug: {
    /** Fraction of the table's width. */
    xFraction: 0.72,
    footHalf: 0.07,
    footDrop: 0.02,
    bellyHalf: 0.11,
    bellyRise: 0.12,
    rimWest: 0.05,
    rimEast: 0.06,
    rimRise: 0.2,
    ink: 0.5,
    sheenAlpha: 0.4,
    sheenX: 0.06,
    sheenRise: 0.14,
    sheenWidth: 0.02,
    sheenLength: 0.12,
  },
  candle: {
    insetFromRight: 0.18,
    dishHalf: 0.05,
    dishRise: 0.02,
    dishWidth: 0.1,
    dishHeight: 0.03,
    ink: 0.35,
    half: 0.02,
    rise: 0.18,
    width: 0.04,
    height: 0.16,
    glowRise: 0.24,
    glowRadius: 0.24,
    glowAlpha: 0.3,
    flameHeight: 0.09,
    flameWidth: 0.03,
  },
} as const;

/**
 * His supper table: square oak legs, a lit top, and one place laid on it —
 * a pewter plate with a heel of bread, a cup, the knife and fork set exactly
 * parallel either side, a folded napkin, a jug of water and a candle. He eats
 * alone, but he lays the table.
 */
export function paintSupperTable(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = SUPPER_TABLE;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.inset;
    const right = box.right - ts * s.inset;
    const width = right - left;
    const topY = box.bottom - ts * s.topHeight;
    const topDepth = ts * s.topDepth;
    const apronH = ts * s.apronHeight;
    const legW = ts * s.legWidth;
    for (const lx of [left + ts * s.legInset, right - ts * s.legInset - legW]) {
      block(
        ctx,
        lx,
        topY + topDepth,
        legW,
        box.bottom - ts * s.floorLift - topY - topDepth,
        sampleRamp(wood, s.legTone),
        ts,
        s.ink,
      );
    }
    block(
      ctx,
      left + ts * s.apronInset,
      topY + topDepth,
      width - ts * s.apronTrim,
      apronH,
      sampleRamp(wood, s.apronTone),
      ts,
      s.ink,
    );
    paintPlankBoard(ctx, left, topY, width, topDepth, forkRng(rng), {
      direction: 'horizontal',
      boardPx: topDepth / s.boardsAcrossTop,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(left, topY, width, topDepth);
    inkOutline(ctx, ts);
    litEdge(
      ctx,
      left,
      topY + topDepth - ts * s.edgeThickness,
      width,
      ts * s.edgeThickness,
      sampleRamp(wood, s.edgeTone),
      s.edgeAlpha,
    );
    // One place, laid square to the table's edge.
    const plate = s.plate;
    const plateX = left + width * plate.xFraction;
    const plateY = topY + topDepth * plate.yFraction;
    ctx.fillStyle = rgb(STEEL);
    ctx.beginPath();
    ctx.ellipse(plateX, plateY, ts * plate.radiusX, ts * plate.radiusY, 0, 0, TWO_PI);
    ctx.fill();
    inkOutline(ctx, ts * plate.ink);
    ctx.fillStyle = rgb(STEEL_LIGHT);
    ctx.beginPath();
    ctx.ellipse(plateX, plateY, ts * plate.wellRadiusX, ts * plate.wellRadiusY, 0, 0, TWO_PI);
    ctx.fill();
    const bread = s.bread;
    ctx.fillStyle = rgb(LOG_END);
    ctx.beginPath();
    ctx.ellipse(
      plateX + ts * bread.dx,
      plateY - ts * bread.rise,
      ts * bread.radiusX,
      ts * bread.radiusY,
      bread.tilt,
      0,
      TWO_PI,
    );
    ctx.fill();
    inkOutline(ctx, ts * bread.ink);
    const cutlery = s.cutlery;
    for (const side of [-1, 1]) {
      block(
        ctx,
        plateX + side * ts * cutlery.spacing - ts * cutlery.halfWidth,
        plateY - ts * cutlery.rise,
        ts * cutlery.width,
        ts * cutlery.length,
        STEEL_DARK,
        ts,
        0,
      );
    }
    block(
      ctx,
      plateX - ts * s.napkin.offset,
      plateY - ts * s.napkin.rise,
      ts * s.napkin.size,
      ts * s.napkin.size,
      LINEN,
      ts,
      s.napkin.ink,
    );
    // A cup, a jug of water, and a candle at the far end.
    block(
      ctx,
      plateX + ts * s.cup.offset,
      plateY - ts * s.cup.rise,
      ts * s.cup.width,
      ts * s.cup.height,
      STEEL,
      ts,
      s.cup.ink,
    );
    const jug = s.jug;
    const jugX = left + width * jug.xFraction;
    ctx.fillStyle = rgb([176, 108, 76]);
    ctx.beginPath();
    ctx.moveTo(jugX - ts * jug.footHalf, plateY + ts * jug.footDrop);
    ctx.quadraticCurveTo(
      jugX - ts * jug.bellyHalf,
      plateY - ts * jug.bellyRise,
      jugX - ts * jug.rimWest,
      plateY - ts * jug.rimRise,
    );
    ctx.lineTo(jugX + ts * jug.rimEast, plateY - ts * jug.rimRise);
    ctx.quadraticCurveTo(
      jugX + ts * jug.bellyHalf,
      plateY - ts * jug.bellyRise,
      jugX + ts * jug.footHalf,
      plateY + ts * jug.footDrop,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * jug.ink);
    ctx.fillStyle = rgba([255, 230, 200], jug.sheenAlpha);
    ctx.fillRect(
      jugX - ts * jug.sheenX,
      plateY - ts * jug.sheenRise,
      ts * jug.sheenWidth,
      ts * jug.sheenLength,
    );
    const candle = s.candle;
    const candleX = right - ts * candle.insetFromRight;
    block(
      ctx,
      candleX - ts * candle.dishHalf,
      plateY - ts * candle.dishRise,
      ts * candle.dishWidth,
      ts * candle.dishHeight,
      BRASS,
      ts,
      candle.ink,
    );
    block(
      ctx,
      candleX - ts * candle.half,
      plateY - ts * candle.rise,
      ts * candle.width,
      ts * candle.height,
      LINEN,
      ts,
      candle.ink,
    );
    glow(
      ctx,
      candleX,
      plateY - ts * candle.glowRise,
      ts * candle.glowRadius,
      EMBER_GLOW,
      candle.glowAlpha,
    );
    flame(ctx, candleX, plateY - ts * candle.rise, ts * candle.flameHeight, ts * candle.flameWidth);
  });
}

// ── Where he sleeps ────────────────────────────────────────────────────────

/** Proportions for {@link paintMadeCot}, as fractions of the tile scale; tones are ramp positions. */
const MADE_COT = {
  shadowSpread: 0.46,
  inset: 0.06,
  floorLift: 0.06,
  railHeight: 0.22,
  mattressHeight: 0.44,
  postWidth: 0.1,
  headboard: {
    rise: 0.3,
    tone: 0.5,
    capRise: 0.34,
  },
  footboard: {
    rise: 0.12,
    tone: 0.45,
    capRise: 0.16,
  },
  cap: {
    overhang: 0.02,
    widthExtra: 0.04,
    height: 0.05,
    tone: 0.7,
    ink: 0.5,
  },
  mattressInk: 0.8,
  pillow: {
    width: 0.34,
    whiten: 0.3,
    inset: 0.06,
    heightTrim: 0.12,
    radius: 0.04,
    ink: 0.6,
  },
  turnDown: {
    gap: 0.14,
    width: 0.1,
    lift: 0.02,
    drop: 0.06,
    ink: 0.6,
  },
  blanket: {
    ink: 0.8,
    edgeThickness: 0.025,
    edgeAlpha: 0.9,
    stripeAlpha: 0.55,
    /** Fraction of the mattress's depth. */
    stripeAt: 0.45,
    stripeThickness: 0.02,
  },
  spare: {
    width: 0.34,
    inset: 0.04,
    rise: 0.08,
    height: 0.18,
    ink: 0.6,
    foldAlpha: 0.8,
    foldThickness: 0.03,
  },
  rail: {
    tone: 0.52,
    edgeThickness: 0.025,
    pegDrops: [0.06, 0.15],
    pegRadius: 0.018,
    pegTone: 0.25,
  },
} as const;

/**
 * His cot: a joined oak box bed with pegged corners, the blanket drawn tight
 * with square corners and the sheet turned down to a ruled line, a pillow
 * squared to the headboard and a spare blanket folded at the foot.
 */
export function paintMadeCot(ctx: Ctx, frame: TownPropFrame): void {
  const s = MADE_COT;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.inset;
    const right = box.right - ts * s.inset;
    const frameBottom = box.bottom - ts * s.floorLift;
    const railTop = frameBottom - ts * s.railHeight;
    const mattressTop = railTop - ts * s.mattressHeight;
    const headW = ts * s.postWidth;
    // Headboard and footboard posts.
    block(
      ctx,
      left,
      mattressTop - ts * s.headboard.rise,
      headW,
      frameBottom - mattressTop + ts * s.headboard.rise,
      sampleRamp(wood, s.headboard.tone),
      ts,
    );
    block(
      ctx,
      right - headW,
      mattressTop - ts * s.footboard.rise,
      headW,
      frameBottom - mattressTop + ts * s.footboard.rise,
      sampleRamp(wood, s.footboard.tone),
      ts,
    );
    block(
      ctx,
      left - ts * s.cap.overhang,
      mattressTop - ts * s.headboard.capRise,
      headW + ts * s.cap.widthExtra,
      ts * s.cap.height,
      sampleRamp(wood, s.cap.tone),
      ts,
      s.cap.ink,
    );
    block(
      ctx,
      right - headW - ts * s.cap.overhang,
      mattressTop - ts * s.footboard.capRise,
      headW + ts * s.cap.widthExtra,
      ts * s.cap.height,
      sampleRamp(wood, s.cap.tone),
      ts,
      s.cap.ink,
    );
    const bedLeft = left + headW;
    const bedRight = right - headW;
    // Mattress in linen, the blanket over most of it, the sheet turned down.
    block(
      ctx,
      bedLeft,
      mattressTop,
      bedRight - bedLeft,
      railTop - mattressTop,
      LINEN,
      ts,
      s.mattressInk,
    );
    const pillow = s.pillow;
    const pillowW = ts * pillow.width;
    ctx.fillStyle = rgb(mix(LINEN, [255, 255, 255], pillow.whiten));
    ctx.beginPath();
    ctx.roundRect(
      bedLeft + ts * pillow.inset,
      mattressTop + ts * pillow.inset,
      pillowW,
      railTop - mattressTop - ts * pillow.heightTrim,
      ts * pillow.radius,
    );
    ctx.fill();
    inkOutline(ctx, ts * pillow.ink);
    const turn = s.turnDown;
    const turnX = bedLeft + pillowW + ts * turn.gap;
    block(
      ctx,
      turnX,
      mattressTop - ts * turn.lift,
      ts * turn.width,
      railTop - mattressTop + ts * turn.drop,
      LINEN,
      ts,
      turn.ink,
    );
    const blanket = s.blanket;
    block(
      ctx,
      turnX + ts * turn.width,
      mattressTop - ts * turn.lift,
      bedRight - turnX - ts * turn.width,
      railTop - mattressTop + ts * turn.drop,
      BLANKET,
      ts,
      blanket.ink,
    );
    litEdge(
      ctx,
      turnX + ts * turn.width,
      mattressTop - ts * turn.lift,
      bedRight - turnX - ts * turn.width,
      Math.max(1, ts * blanket.edgeThickness),
      BLANKET_LIGHT,
      blanket.edgeAlpha,
    );
    // A single ruled stripe across the blanket: even the bedding is square.
    ctx.fillStyle = rgba(LINEN, blanket.stripeAlpha);
    ctx.fillRect(
      turnX + ts * turn.width,
      mattressTop + (railTop - mattressTop) * blanket.stripeAt,
      bedRight - turnX - ts * turn.width,
      Math.max(1, ts * blanket.stripeThickness),
    );
    // The spare blanket, folded square at the foot.
    const spare = s.spare;
    const foldW = ts * spare.width;
    block(
      ctx,
      bedRight - foldW - ts * spare.inset,
      mattressTop - ts * spare.rise,
      foldW,
      ts * spare.height,
      BLANKET_LIGHT,
      ts,
      spare.ink,
    );
    ctx.fillStyle = rgba(BLANKET, spare.foldAlpha);
    ctx.fillRect(bedRight - foldW - ts * spare.inset, mattressTop, foldW, ts * spare.foldThickness);
    // The side rail with its pegged tenons.
    const rail = s.rail;
    block(ctx, left, railTop, right - left, frameBottom - railTop, sampleRamp(wood, rail.tone), ts);
    litEdge(
      ctx,
      left,
      railTop,
      right - left,
      Math.max(1, ts * rail.edgeThickness),
      sampleRamp(wood, 1),
    );
    for (const px of [left + headW * 0.5, right - headW * 0.5]) {
      for (const pegDrop of rail.pegDrops)
        disc(
          ctx,
          px,
          railTop + ts * pegDrop,
          Math.max(1, ts * rail.pegRadius),
          sampleRamp(wood, rail.pegTone),
        );
    }
  });
}

// ── The builder's joinery and the dairy's odd pieces ───────────────────────

/** Proportions for {@link paintPailStack}, as fractions of the tile scale. */
const PAIL_STACK = {
  shadowSpread: 0.42,
  pailWidth: 0.4,
  pailHeight: 0.3,
  floorLift: 0.06,
  /** Each bottom pail's offset from the footprint's centre. */
  spread: 0.21,
  /** How far the top pail sinks into the two below it. */
  topSeat: 0.02,
} as const;

/**
 * Three milk pails stacked upturned, two on the boards and one across them,
 * scoured and dry: the day's pails, kept ready for a milking nobody has done.
 */
export function paintPailStack(ctx: Ctx, frame: TownPropFrame): void {
  const s = PAIL_STACK;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, s.shadowSpread);
    const pailW = ts * s.pailWidth;
    const pailH = ts * s.pailHeight;
    const floorY = box.bottom - ts * s.floorLift;
    const spread = ts * s.spread;
    paintPail(ctx, box.centreX - spread, floorY, pailW, pailH, ts, true);
    paintPail(ctx, box.centreX + spread, floorY, pailW, pailH, ts, true);
    paintPail(ctx, box.centreX, floorY - pailH + ts * s.topSeat, pailW, pailH, ts, true);
  });
}

/** His good wool coat and the cowbell's brass. */
const COAT_WOOL: RGB = [70, 60, 50];
const BELL_BRASS: RGB = [176, 136, 62];
const BELL_BRASS_DARK: RGB = [108, 80, 36];
const BELL_STRAP: RGB = [96, 60, 36];

/**
 * Proportions for {@link paintDoorPegPost}. Lengths are fractions of the tile
 * scale; coat x offsets are from the footprint's centre; tones are ramp positions.
 */
const DOOR_PEG_POST = {
  shadowSpread: 0.36,
  postWidth: 0.14,
  postHeight: 1.62,
  footLift: 0.1,
  postTone: 0.55,
  postInk: 0.8,
  foot: {
    inset: 0.14,
    rise: 0.04,
    widthTrim: 0.28,
    height: 0.1,
    tone: 0.45,
    ink: 0.7,
  },
  wedges: {
    westX: 0.2,
    eastInset: 0.26,
    rise: 0.08,
    width: 0.06,
    height: 0.05,
    tone: 0.7,
    ink: 0.4,
  },
  chamfer: {
    litAlpha: 0.6,
    darkTone: 0.2,
    darkAlpha: 0.5,
    westInset: 0.015,
    eastInset: 0.04,
    top: 0.04,
    width: 0.025,
    lengthTrim: 0.1,
  },
  cap: {
    overhang: 0.04,
    rise: 0.05,
    widthExtra: 0.08,
    height: 0.07,
    tone: 0.7,
    ink: 0.7,
  },
  peg: {
    drop: 0.14,
    x: 0.1,
    radius: 0.03,
  },
  coat: {
    loopDrop: 0.02,
    hemHeight: 0.62,
    loopWestX: 0.02,
    loopEastX: 0.18,
    backControlX: 0.34,
    sideControlDrop: 0.3,
    backHemX: 0.32,
    frontHemX: 0.06,
    frontHemDrop: 0.02,
    frontControlX: 0.1,
    ink: 0.8,
    shadeAlpha: 0.3,
    shadeX: 0.16,
    shadeTop: 0.1,
    shadeWidth: 0.12,
    shadeTrim: 0.12,
    seamTone: 0.2,
    seamAlpha: 0.8,
    seamWidth: 0.016,
    seamTopX: 0.1,
    seamTop: 0.06,
    seamBottomX: 0.12,
    seamBottomRise: 0.02,
  },
  nail: {
    westOffset: 0.02,
    height: 0.78,
    ghostAlpha: 0.35,
    ghostDrop: 0.02,
    /** Fraction of the post's width. */
    ghostWidthFraction: 0.6,
    ghostHeight: 0.26,
    radius: 0.022,
    tone: 0.6,
  },
  bell: {
    drop: 0.1,
    height: 0.24,
    swingX: 0.08,
    strapWidth: 0.03,
    crownHalf: 0.06,
    mouthHalf: 0.1,
    ink: 0.6,
    shadeX: 0.02,
    shadeTop: 0.02,
    shadeWidth: 0.06,
    shadeTrim: 0.03,
    glintAlpha: 0.9,
    glintX: 0.05,
    glintTop: 0.04,
    glintWidth: 0.025,
    /** Fraction of the bell's height. */
    glintLengthFraction: 0.6,
    clapperDrop: 0.02,
    clapperRadius: 0.025,
  },
} as const;

/**
 * The peg post by the door: a squared oak post, chamfered on every arris,
 * standing in a cross-halved foot with its wedged tenons showing — far more
 * post than a coat needs. His coat hangs on the top peg. Below it, on a
 * nail, hangs a cowbell on its strap; once the bell is on a cow the nail is
 * bare and the post behind it paler where it hung.
 */
export function paintDoorPegPost(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  const bellHangs = variant === DOOR_PEG_POST_VARIANT.withCowbell;
  const s = DOOR_PEG_POST;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const postW = ts * s.postWidth;
    const postX = box.centreX - postW / 2;
    const postTop = box.bottom - ts * s.postHeight;
    const footY = box.bottom - ts * s.footLift;

    // The cross-halved foot, and the tenon wedges standing proud of it.
    block(
      ctx,
      box.left + ts * s.foot.inset,
      footY - ts * s.foot.rise,
      box.width - ts * s.foot.widthTrim,
      ts * s.foot.height,
      sampleRamp(wood, s.foot.tone),
      ts,
      s.foot.ink,
    );
    const wedges = s.wedges;
    for (const wx of [box.left + ts * wedges.westX, box.right - ts * wedges.eastInset]) {
      block(
        ctx,
        wx,
        footY - ts * wedges.rise,
        ts * wedges.width,
        ts * wedges.height,
        sampleRamp(wood, wedges.tone),
        ts,
        wedges.ink,
      );
    }
    block(ctx, postX, postTop, postW, footY - postTop, sampleRamp(wood, s.postTone), ts, s.postInk);
    // The chamfers: a lit strip down the west arris, a dark one down the east.
    const chamfer = s.chamfer;
    ctx.fillStyle = rgba(sampleRamp(wood, 1), chamfer.litAlpha);
    ctx.fillRect(
      postX + ts * chamfer.westInset,
      postTop + ts * chamfer.top,
      ts * chamfer.width,
      footY - postTop - ts * chamfer.lengthTrim,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, chamfer.darkTone), chamfer.darkAlpha);
    ctx.fillRect(
      postX + postW - ts * chamfer.eastInset,
      postTop + ts * chamfer.top,
      ts * chamfer.width,
      footY - postTop - ts * chamfer.lengthTrim,
    );
    block(
      ctx,
      postX - ts * s.cap.overhang,
      postTop - ts * s.cap.rise,
      postW + ts * s.cap.widthExtra,
      ts * s.cap.height,
      sampleRamp(wood, s.cap.tone),
      ts,
      s.cap.ink,
    );

    // The coat, hung by its loop from the top peg, falling to below the knee.
    const coat = s.coat;
    const pegY = postTop + ts * s.peg.drop;
    disc(ctx, box.centreX + ts * s.peg.x, pegY, ts * s.peg.radius, BEECH_DARK);
    const coatTop = pegY + ts * coat.loopDrop;
    const coatBottom = box.bottom - ts * coat.hemHeight;
    ctx.fillStyle = rgb(COAT_WOOL);
    ctx.beginPath();
    ctx.moveTo(box.centreX + ts * coat.loopWestX, coatTop);
    ctx.lineTo(box.centreX + ts * coat.loopEastX, coatTop);
    ctx.quadraticCurveTo(
      box.centreX + ts * coat.backControlX,
      coatTop + ts * coat.sideControlDrop,
      box.centreX + ts * coat.backHemX,
      coatBottom,
    );
    ctx.lineTo(box.centreX - ts * coat.frontHemX, coatBottom + ts * coat.frontHemDrop);
    ctx.quadraticCurveTo(
      box.centreX - ts * coat.frontControlX,
      coatTop + ts * coat.sideControlDrop,
      box.centreX + ts * coat.loopWestX,
      coatTop,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * coat.ink);
    ctx.fillStyle = rgba(SOOT, coat.shadeAlpha);
    ctx.fillRect(
      box.centreX + ts * coat.shadeX,
      coatTop + ts * coat.shadeTop,
      ts * coat.shadeWidth,
      coatBottom - coatTop - ts * coat.shadeTrim,
    );
    ctx.strokeStyle = rgba(sampleRamp(wood, coat.seamTone), coat.seamAlpha);
    ctx.lineWidth = Math.max(1, ts * coat.seamWidth);
    ctx.beginPath();
    ctx.moveTo(box.centreX + ts * coat.seamTopX, coatTop + ts * coat.seamTop);
    ctx.lineTo(box.centreX + ts * coat.seamBottomX, coatBottom - ts * coat.seamBottomRise);
    ctx.stroke();

    // The cowbell's nail, on the post's west face at hand height.
    const nail = s.nail;
    const nailX = postX - ts * nail.westOffset;
    const nailY = box.bottom - ts * nail.height;
    if (!bellHangs) {
      ctx.fillStyle = rgba(sampleRamp(wood, 1), nail.ghostAlpha);
      ctx.fillRect(
        postX,
        nailY + ts * nail.ghostDrop,
        postW * nail.ghostWidthFraction,
        ts * nail.ghostHeight,
      );
    }
    disc(ctx, nailX, nailY, Math.max(1, ts * nail.radius), sampleRamp(iron(), nail.tone));
    if (!bellHangs) return;
    const bell = s.bell;
    const bellTop = nailY + ts * bell.drop;
    const bellH = ts * bell.height;
    const bellX = nailX - ts * bell.swingX;
    ctx.strokeStyle = rgb(BELL_STRAP);
    ctx.lineWidth = Math.max(1, ts * bell.strapWidth);
    ctx.beginPath();
    ctx.moveTo(nailX, nailY);
    ctx.lineTo(bellX, bellTop);
    ctx.stroke();
    ctx.fillStyle = rgb(BELL_BRASS);
    ctx.beginPath();
    ctx.moveTo(bellX - ts * bell.crownHalf, bellTop);
    ctx.lineTo(bellX + ts * bell.crownHalf, bellTop);
    ctx.lineTo(bellX + ts * bell.mouthHalf, bellTop + bellH);
    ctx.lineTo(bellX - ts * bell.mouthHalf, bellTop + bellH);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * bell.ink);
    ctx.fillStyle = rgb(BELL_BRASS_DARK);
    ctx.fillRect(
      bellX + ts * bell.shadeX,
      bellTop + ts * bell.shadeTop,
      ts * bell.shadeWidth,
      bellH - ts * bell.shadeTrim,
    );
    ctx.fillStyle = rgba(BRASS_LIGHT, bell.glintAlpha);
    ctx.fillRect(
      bellX - ts * bell.glintX,
      bellTop + ts * bell.glintTop,
      Math.max(1, ts * bell.glintWidth),
      bellH * bell.glintLengthFraction,
    );
    disc(
      ctx,
      bellX,
      bellTop + bellH + ts * bell.clapperDrop,
      ts * bell.clapperRadius,
      BELL_BRASS_DARK,
    );
  });
}

/** Wet field mud and the dried crust of it, and the boots' leather. */
const MUD: RGB = [104, 80, 54];
const MUD_DRY: RGB = [150, 126, 92];
const BOOT_LEATHER: RGB = [60, 42, 32];

/** Proportions for {@link paintMuddyBoot}, as fractions of the tile scale. */
const MUDDY_BOOT = {
  shaftWidth: 0.17,
  shaftHeight: 0.5,
  shaftLift: 0.06,
  shaftInk: 0.7,
  sole: {
    rise: 0.05,
    radiusX: 0.13,
    radiusY: 0.07,
    ink: 0.6,
  },
  sheen: {
    alpha: 0.3,
    inset: 0.02,
    top: 0.03,
    width: 0.025,
    length: 0.22,
  },
  mud: {
    rise: 0.07,
    radiusX: 0.12,
    radiusY: 0.07,
    cakeTop: 0.2,
    cakeHeight: 0.12,
  },
  /** Dried clods on the cake: x offset from the boot's axis, then height above the sole. */
  clods: [
    [-0.04, 0.16],
    [0.03, 0.12],
    [-0.01, 0.24],
  ],
  clodRadius: 0.018,
} as const;

/** One tall work boot standing on its sole, seen from the front, caked to the ankle. */
function paintMuddyBoot(ctx: Ctx, cx: number, bottom: number, ts: number): void {
  const s = MUDDY_BOOT;
  const shaftW = ts * s.shaftWidth;
  const shaftTop = bottom - ts * s.shaftHeight;
  block(
    ctx,
    cx - shaftW / 2,
    shaftTop,
    shaftW,
    bottom - shaftTop - ts * s.shaftLift,
    BOOT_LEATHER,
    ts,
    s.shaftInk,
  );
  ctx.fillStyle = rgb(BOOT_LEATHER);
  ctx.beginPath();
  ctx.ellipse(
    cx,
    bottom - ts * s.sole.rise,
    ts * s.sole.radiusX,
    ts * s.sole.radiusY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  inkOutline(ctx, ts * s.sole.ink);
  ctx.fillStyle = rgba(sampleRamp(timber(), 1), s.sheen.alpha);
  ctx.fillRect(
    cx - shaftW / 2 + ts * s.sheen.inset,
    shaftTop + ts * s.sheen.top,
    ts * s.sheen.width,
    ts * s.sheen.length,
  );
  ctx.fillStyle = rgb(MUD);
  ctx.beginPath();
  ctx.ellipse(cx, bottom - ts * s.mud.rise, ts * s.mud.radiusX, ts * s.mud.radiusY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillRect(cx - shaftW / 2, bottom - ts * s.mud.cakeTop, shaftW, ts * s.mud.cakeHeight);
  ctx.fillStyle = rgb(MUD_DRY);
  for (const [dx, dy] of s.clods) {
    disc(ctx, cx + ts * dx, bottom - ts * dy, ts * s.clodRadius, MUD_DRY);
  }
}

/**
 * Proportions for {@link paintBootTray}. Lengths are fractions of the tile
 * scale; the muslin's offsets are from the pail's rim.
 */
const BOOT_TRAY = {
  shadowSpread: 0.42,
  tray: {
    height: 0.2,
    inset: 0.06,
    widthTrim: 0.12,
    depth: 0.14,
    tone: 0.35,
    ink: 0.7,
    edgeThickness: 0.02,
  },
  trayMud: {
    alpha: 0.7,
    inset: 0.1,
    drop: 0.02,
    widthTrim: 0.2,
    depth: 0.05,
  },
  jack: {
    inset: 0.1,
    rise: 0.06,
    length: 0.26,
    height: 0.06,
    tone: 0.6,
    ink: 0.5,
  },
  boots: {
    /** Where the pair stands when the milk pail takes the east end. */
    besidePailX: 0.3,
    westOffset: 0.1,
    westLift: 0.08,
    eastOffset: 0.11,
    eastLift: 0.06,
  },
  pail: {
    insetFromRight: 0.26,
    floorLift: 0.08,
    height: 0.34,
    width: 0.38,
  },
  milk: {
    drop: 0.01,
    radiusX: 0.15,
    /** Fraction of the pail's height. */
    radiusYFraction: 0.1,
  },
  muslin: {
    alpha: 0.95,
    westX: 0.02,
    westRise: 0.03,
    eastX: 0.2,
    tipX: 0.19,
    tipDrop: 0.18,
    foldX: 0.1,
    foldDrop: 0.1,
    backX: 0.04,
    backDrop: 0.04,
    ink: 0.45,
  },
} as const;

/**
 * The boot tray inside the door: a shallow boarded tray with a lip, a boot
 * jack, and his boots stood in it with the field still on them. When there
 * is a cow again, the morning's milk waits beside them in a full pail under
 * a muslin cloth, on its way to the churn.
 */
export function paintBootTray(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  const milkWaiting = variant === BOOT_TRAY_VARIANT.withMilkPail;
  const s = BOOT_TRAY;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const tray = s.tray;
    const trayTop = box.bottom - ts * tray.height;
    block(
      ctx,
      box.left + ts * tray.inset,
      trayTop,
      box.width - ts * tray.widthTrim,
      ts * tray.depth,
      sampleRamp(wood, tray.tone),
      ts,
      tray.ink,
    );
    ctx.fillStyle = rgba(MUD, s.trayMud.alpha);
    ctx.fillRect(
      box.left + ts * s.trayMud.inset,
      trayTop + ts * s.trayMud.drop,
      box.width - ts * s.trayMud.widthTrim,
      ts * s.trayMud.depth,
    );
    litEdge(
      ctx,
      box.left + ts * tray.inset,
      trayTop,
      box.width - ts * tray.widthTrim,
      Math.max(1, ts * tray.edgeThickness),
      sampleRamp(wood, 1),
    );
    // The boot jack: a notched board on a heel block.
    block(
      ctx,
      box.left + ts * s.jack.inset,
      trayTop - ts * s.jack.rise,
      ts * s.jack.length,
      ts * s.jack.height,
      sampleRamp(wood, s.jack.tone),
      ts,
      s.jack.ink,
    );
    const boots = s.boots;
    const bootsX = milkWaiting ? box.left + ts * boots.besidePailX : box.centreX;
    paintMuddyBoot(ctx, bootsX - ts * boots.westOffset, box.bottom - ts * boots.westLift, ts);
    paintMuddyBoot(ctx, bootsX + ts * boots.eastOffset, box.bottom - ts * boots.eastLift, ts);
    if (!milkWaiting) return;
    const pailX = box.right - ts * s.pail.insetFromRight;
    const pailBottom = box.bottom - ts * s.pail.floorLift;
    const pailH = ts * s.pail.height;
    paintPail(ctx, pailX, pailBottom, ts * s.pail.width, pailH, ts, false);
    ctx.fillStyle = rgb(MILK);
    ctx.beginPath();
    ctx.ellipse(
      pailX,
      pailBottom - pailH + ts * s.milk.drop,
      ts * s.milk.radiusX,
      pailH * s.milk.radiusYFraction,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    // The muslin laid half over the top, hanging down one side.
    const muslin = s.muslin;
    ctx.fillStyle = rgba(LINEN, muslin.alpha);
    ctx.beginPath();
    ctx.moveTo(pailX - ts * muslin.westX, pailBottom - pailH - ts * muslin.westRise);
    ctx.lineTo(pailX + ts * muslin.eastX, pailBottom - pailH);
    ctx.lineTo(pailX + ts * muslin.tipX, pailBottom - pailH + ts * muslin.tipDrop);
    ctx.lineTo(pailX + ts * muslin.foldX, pailBottom - pailH + ts * muslin.foldDrop);
    ctx.lineTo(pailX - ts * muslin.backX, pailBottom - pailH + ts * muslin.backDrop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * muslin.ink);
  });
}

/** Proportions for {@link paintOffcutBox}, as fractions of the tile scale; tones are ramp positions. */
const OFFCUT_BOX = {
  shadowSpread: 0.4,
  inset: 0.1,
  boxHeight: 0.46,
  floorLift: 0.06,
  box: {
    tone: 0.6,
    ink: 0.8,
    edgeThickness: 0.025,
  },
  offcuts: {
    count: 6,
    /** Offcut heights cycle back to front through this many ranks, tallest first. */
    ranks: 3,
    tallestRise: 0.42,
    riseStepPerRank: 0.1,
    riseJitter: 0.03,
    packingInset: 0.04,
    packingTrim: 0.08,
    gap: 0.02,
    /** How far each offcut stands down inside the box, below its rim. */
    sink: 0.1,
    beechMix: 0.5,
    ink: 0.45,
    endGrainThickness: 0.03,
  },
  dovetails: {
    count: 3,
    width: 0.08,
    tone: 0.35,
    /** Each tail starts this many tail-heights into its pin-and-tail pair. */
    start: 0.5,
    /** The tail's flare past its pin, top and bottom, in tail heights. */
    flareTop: 0.2,
    flareBottom: 1.2,
  },
} as const;

/**
 * The offcut box by the timber stack: dovetailed at every corner — a box a
 * joiner makes to show he can — full of offcuts stood on end and sorted
 * tallest at the back, because an offcut is a piece of wood he has not
 * found the use for yet.
 */
export function paintOffcutBox(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = OFFCUT_BOX;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.inset;
    const right = box.right - ts * s.inset;
    const boxTop = box.bottom - ts * s.boxHeight;
    const bottom = box.bottom - ts * s.floorLift;
    const cuts = s.offcuts;
    const offcuts = cuts.count;
    const pitch = (right - left - ts * cuts.packingTrim) / offcuts;
    for (let i = 0; i < offcuts; i++) {
      const rise =
        ts *
        (cuts.tallestRise - (i % cuts.ranks) * cuts.riseStepPerRank + jitter(rng, cuts.riseJitter));
      const ox = left + ts * cuts.packingInset + i * pitch;
      const color = i % 2 === 0 ? PINE : mix(PINE, BEECH, cuts.beechMix);
      block(
        ctx,
        ox,
        boxTop - rise,
        pitch - ts * cuts.gap,
        rise + ts * cuts.sink,
        color,
        ts,
        cuts.ink,
      );
      ctx.fillStyle = rgb(LOG_END);
      ctx.fillRect(
        ox,
        boxTop - rise,
        pitch - ts * cuts.gap,
        Math.max(1, ts * cuts.endGrainThickness),
      );
    }
    block(
      ctx,
      left,
      boxTop,
      right - left,
      bottom - boxTop,
      sampleRamp(wood, s.box.tone),
      ts,
      s.box.ink,
    );
    litEdge(
      ctx,
      left,
      boxTop,
      right - left,
      Math.max(1, ts * s.box.edgeThickness),
      sampleRamp(wood, 1),
    );
    // The dovetails: pins and tails alternating down each corner.
    const dovetails = s.dovetails;
    const tails = dovetails.count;
    const tailH = (bottom - boxTop) / (tails * 2);
    for (const cornerX of [left, right - ts * dovetails.width]) {
      for (let t = 0; t < tails; t++) {
        ctx.fillStyle = rgb(sampleRamp(wood, dovetails.tone));
        ctx.beginPath();
        const ty = boxTop + tailH * (t * 2 + dovetails.start);
        ctx.moveTo(cornerX, ty);
        ctx.lineTo(cornerX + ts * dovetails.width, ty - tailH * dovetails.flareTop);
        ctx.lineTo(cornerX + ts * dovetails.width, ty + tailH * dovetails.flareBottom);
        ctx.lineTo(cornerX, ty + tailH);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
}

/**
 * Proportions for {@link paintStairShelf}. Lengths are fractions of the tile
 * scale; tones are ramp positions.
 */
const STAIR_SHELF = {
  shadowSpread: 0.46,
  westInset: 0.2,
  eastInset: 0.08,
  floorLift: 0.06,
  treads: 3,
  riserHeight: 0.3,
  stringer: {
    tone: 0.35,
    rise: 0.06,
    ink: 0.7,
  },
  tread: {
    tone: 0.5,
    toneStepPerTread: 0.04,
    ink: 0.6,
    nosingRise: 0.05,
    nosingHeight: 0.06,
    nosingTone: 0.72,
    edgeThickness: 0.018,
  },
  books: {
    height: 0.26,
    alternateExtra: 0.05,
    inset: 0.06,
    pitch: 0.08,
    width: 0.07,
    ink: 0.4,
  },
  jars: {
    count: 3,
    tread: 1,
    inset: 0.1,
    pitch: 0.14,
    width: 0.11,
    height: 0.2,
    glassMix: 0.2,
    glassMixJitter: 0.2,
    ink: 0.4,
    lidRise: 0.03,
    lidHeight: 0.04,
    lidInk: 0.3,
  },
  model: {
    inset: 0.08,
    width: 0.24,
    height: 0.2,
    ink: 0.5,
    windowAlpha: 0.8,
    windowWestX: 0.04,
    windowEastX: 0.14,
    windowRise: 0.15,
    windowSize: 0.05,
    roofWestX: 0.3,
    roofPeakX: 0.42,
    roofPeakRise: 0.12,
    roofEastX: 0.54,
    roofInk: 0.4,
  },
  newel: {
    inset: 0.08,
    rise: 0.42,
    width: 0.12,
    tone: 0.6,
    ink: 0.7,
    knobX: 0.06,
    knobRise: 0.03,
    knobRadius: 0.075,
    knobTone: 0.75,
    knobInk: 0.5,
  },
  rail: {
    lowDrop: 0.04,
    highRise: 0.42,
    balusterHalf: 0.02,
    balusterWidth: 0.04,
    balusterTone: 0.55,
    balusterInk: 0.4,
    tone: 0.7,
    minWidthPx: 2,
    width: 0.06,
    endTrim: 0.04,
  },
} as const;

/**
 * A set of shelves built as a flight of stairs: two housed stringers, three
 * treads rising west to east, a turned newel at the foot and a handrail on
 * square balusters all the way up. On the treads, his books, a row of
 * jars, and at the top a card model of a house with its roof lifted off.
 */
export function paintStairShelf(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  const s = STAIR_SHELF;
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = timber();
    contactShadow(ctx, frame, s.shadowSpread);
    const left = box.left + ts * s.westInset;
    const right = box.right - ts * s.eastInset;
    const floorY = box.bottom - ts * s.floorLift;
    const treads = s.treads;
    const topTread = treads - 1;
    const treadRun = (right - left) / treads;
    const riserH = ts * s.riserHeight;
    const treadY = (step: number): number => floorY - riserH * (step + 1);
    const tread = s.tread;

    // The far stringer behind, then each tread and its riser.
    ctx.fillStyle = rgb(sampleRamp(wood, s.stringer.tone));
    ctx.beginPath();
    ctx.moveTo(left, floorY);
    ctx.lineTo(right, floorY);
    ctx.lineTo(right, treadY(topTread) - ts * s.stringer.rise);
    ctx.lineTo(left, floorY - riserH - ts * s.stringer.rise);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * s.stringer.ink);
    for (let step = 0; step < treads; step++) {
      const x0 = left + step * treadRun;
      const y = treadY(step);
      block(
        ctx,
        x0,
        y,
        right - x0,
        floorY - y,
        sampleRamp(wood, tread.tone + step * tread.toneStepPerTread),
        ts,
        tread.ink,
      );
      block(
        ctx,
        x0,
        y - ts * tread.nosingRise,
        right - x0,
        ts * tread.nosingHeight,
        sampleRamp(wood, tread.nosingTone),
        ts,
        tread.ink,
      );
      litEdge(
        ctx,
        x0,
        y - ts * tread.nosingRise,
        right - x0,
        Math.max(1, ts * tread.edgeThickness),
        sampleRamp(wood, 1),
      );
    }
    // What stands on each tread.
    const books = s.books;
    const bookColors: readonly RGB[] = [ROSEWOOD, [70, 96, 70], [120, 88, 52], TAPE_BLUE];
    bookColors.forEach((color, i) => {
      const bookH = ts * (books.height + (i % 2) * books.alternateExtra);
      block(
        ctx,
        left + ts * books.inset + i * ts * books.pitch,
        treadY(0) - ts * tread.nosingRise - bookH,
        ts * books.width,
        bookH,
        color,
        ts,
        books.ink,
      );
    });
    const jars = s.jars;
    for (let j = 0; j < jars.count; j++) {
      const jx = left + treadRun * jars.tread + ts * jars.inset + j * ts * jars.pitch;
      const jarTop = treadY(jars.tread) - ts * tread.nosingRise - ts * jars.height;
      block(
        ctx,
        jx,
        jarTop,
        ts * jars.width,
        ts * jars.height,
        mix([150, 170, 150], PAPER, jitter(rng, jars.glassMixJitter) + jars.glassMix),
        ts,
        jars.ink,
      );
      block(
        ctx,
        jx,
        jarTop - ts * jars.lidRise,
        ts * jars.width,
        ts * jars.lidHeight,
        BEECH_DARK,
        ts,
        jars.lidInk,
      );
    }
    // The card model: walls, window holes, and its roof set down beside it.
    const model = s.model;
    const modelX = left + treadRun * topTread + ts * model.inset;
    const modelBase = treadY(topTread) - ts * tread.nosingRise;
    block(
      ctx,
      modelX,
      modelBase - ts * model.height,
      ts * model.width,
      ts * model.height,
      PAPER,
      ts,
      model.ink,
    );
    ctx.fillStyle = rgba(DRAWING_LINE, model.windowAlpha);
    ctx.fillRect(
      modelX + ts * model.windowWestX,
      modelBase - ts * model.windowRise,
      ts * model.windowSize,
      ts * model.windowSize,
    );
    ctx.fillRect(
      modelX + ts * model.windowEastX,
      modelBase - ts * model.windowRise,
      ts * model.windowSize,
      ts * model.windowSize,
    );
    ctx.fillStyle = rgb(PAPER_SHADE);
    ctx.beginPath();
    ctx.moveTo(modelX + ts * model.roofWestX, modelBase);
    ctx.lineTo(modelX + ts * model.roofPeakX, modelBase - ts * model.roofPeakRise);
    ctx.lineTo(modelX + ts * model.roofEastX, modelBase);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * model.roofInk);

    // The near stringer's handrail: a turned newel at the foot, square
    // balusters on every tread, the rail pitched with the flight.
    const newel = s.newel;
    const rail = s.rail;
    const newelX = box.left + ts * newel.inset;
    const newelTop = floorY - riserH - ts * newel.rise;
    block(
      ctx,
      newelX,
      newelTop,
      ts * newel.width,
      floorY - newelTop,
      sampleRamp(wood, newel.tone),
      ts,
      newel.ink,
    );
    disc(
      ctx,
      newelX + ts * newel.knobX,
      newelTop - ts * newel.knobRise,
      ts * newel.knobRadius,
      sampleRamp(wood, newel.knobTone),
    );
    ctx.beginPath();
    ctx.arc(
      newelX + ts * newel.knobX,
      newelTop - ts * newel.knobRise,
      ts * newel.knobRadius,
      0,
      TWO_PI,
    );
    inkOutline(ctx, ts * newel.knobInk);
    const railLow = { x: newelX + ts * newel.width, y: newelTop + ts * rail.lowDrop };
    const railHigh = { x: right, y: treadY(topTread) - ts * rail.highRise };
    for (let step = 0; step < treads; step++) {
      const bx = left + (step + 0.5) * treadRun;
      const t = (bx - railLow.x) / (railHigh.x - railLow.x);
      const railY = railLow.y + (railHigh.y - railLow.y) * t;
      block(
        ctx,
        bx - ts * rail.balusterHalf,
        railY,
        ts * rail.balusterWidth,
        treadY(step) - ts * tread.nosingRise - railY,
        sampleRamp(wood, rail.balusterTone),
        ts,
        rail.balusterInk,
      );
    }
    ctx.strokeStyle = rgb(sampleRamp(wood, rail.tone));
    ctx.lineWidth = Math.max(rail.minWidthPx, ts * rail.width);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(railLow.x, railLow.y);
    ctx.lineTo(railHigh.x - ts * rail.endTrim, railHigh.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  });
}
