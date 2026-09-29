/**
 * Bespoke furniture for Cartwright's Workshop, Brann's wheelwright shop. The
 * room is built around a few big composed pieces rather than a scatter of
 * one-tile clutter: the red circus wagon bed from Brann's own story, up on
 * cribbing with one wheel off and a dust sheet half over it; a wheel mid-build
 * on its stand; a long joiner's bench under a wall board of hung tools; a
 * spring-pole lathe; and a timber bay racked to the rafters. Smaller pieces —
 * finished wheels leaning on the wall, a shaving horse, a sawhorse, a
 * firewood stack, a spoke tub, the glue pot — cluster around those, and
 * shavings lie on the boards wherever the work happens.
 *
 * Every painter keeps its ink inside its own footprint's columns and only
 * rises above it, so a piece against the north wall climbs the wall face
 * rather than spilling sideways.
 */

import {
  footprintBox,
  withFootprintClip,
  forkRng,
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
  type RGB,
  type Ramp,
} from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

// ── Materials no shared ramp covers ─────────────────────────────────────────

/** Fresh-worked ash and oak — paler and warmer than the seasoned framing timber, so new work reads as new. */
const NEW_WOOD: Ramp = {
  shadow: [112, 76, 44],
  mid: [170, 126, 78],
  light: [214, 174, 118],
  accent: [238, 210, 160],
};
/** Elm for hubs and the bench top — darker and denser-looking than the spoke timber. */
const ELM: Ramp = {
  shadow: [58, 38, 26],
  mid: [104, 70, 46],
  light: [148, 106, 70],
  accent: [182, 140, 98],
};
/** The circus wagon's own paint: a lacquered showman's red. */
const WAGON_RED: Ramp = {
  shadow: [84, 22, 22],
  mid: [150, 40, 36],
  light: [198, 78, 64],
  accent: [226, 120, 96],
};
const WAGON_GOLD: RGB = [206, 168, 74];
const WAGON_GOLD_BRIGHT: RGB = [244, 214, 128];
const WAGON_GOLD_DIM: RGB = [138, 104, 40];
/** The midnight blue a showman's panel sets its gold star on. */
const WAGON_BLUE: RGB = [40, 52, 96];
/** Settled workshop dust — the "painted red under the dust" of Brann's own telling. */
const DUST: RGB = [200, 188, 166];
const SHEET: Ramp = {
  shadow: [132, 122, 104],
  mid: [184, 174, 152],
  light: [222, 214, 194],
  accent: [240, 234, 218],
};
const SHAVING_LIGHT: RGB = [232, 204, 150];
const SHAVING_MID: RGB = [198, 156, 98];
const SAWDUST: RGB = [214, 180, 124];
const STEEL: Ramp = {
  shadow: [70, 74, 80],
  mid: [128, 134, 142],
  light: [186, 192, 198],
  accent: [226, 230, 234],
};
const BARK: RGB = [70, 50, 34];
const CORD: RGB = [176, 150, 104];
const EMBER_CORE: RGB = [255, 214, 120];
const EMBER_MID: RGB = [220, 102, 40];
const GLUE: RGB = [120, 74, 30];
const GLUE_LIGHT: RGB = [176, 122, 56];
/** An ochre-painted farm-cart wheel, so the two finished wheels leaning together never read as one. */
const OCHRE: Ramp = {
  shadow: [110, 72, 26],
  mid: [170, 120, 46],
  light: [212, 166, 84],
  accent: [236, 200, 120],
};

function oldWood(): Ramp {
  return getTownRamp('oc_timber');
}
function iron(): Ramp {
  return getTownRamp('iron_black');
}

// ── Shared drawing helpers ──────────────────────────────────────────────────

function inkRect(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/** A long piece's shadow is a band along its foot, not one ellipse under its middle. */
function bandShadow(
  ctx: Ctx,
  left: number,
  right: number,
  y: number,
  ts: number,
  alpha = 0.3,
): void {
  const segments = Math.max(1, Math.round((right - left) / ts));
  const width = right - left;
  for (let i = 0; i < segments; i++) {
    const cx = left + (width * (i + 0.5)) / segments;
    drawTownContactShadow(ctx, cx, y, (width / segments) * 0.62, ts * 0.14, alpha);
  }
}

/**
 * A squared timber seen in three-quarter view: a lit top face, a mid-tone
 * front face and a shaded underside line, inked as one block.
 */
function paintBeam(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  frontH: number,
  topH: number,
  ramp: Ramp,
  ts: number,
  tone = 0.5,
): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, tone + 0.32)));
  ctx.fillRect(x, y, w, topH);
  ctx.fillStyle = rgb(sampleRamp(ramp, tone));
  ctx.fillRect(x, y + topH, w, frontH);
  ctx.fillStyle = rgba(TOWN_INK, 0.28);
  ctx.fillRect(x, y + topH + frontH * 0.7, w, frontH * 0.3);
  inkRect(ctx, x, y, w, topH + frontH, ts);
}

/** A thick stroked line with an ink edge and a lit edge — a spoke, a leg, a pole. */
function inkedStroke(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  body: RGB,
  lit: RGB,
): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(TOWN_INK, 0.85);
  ctx.lineWidth = width + 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = rgb(body);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = rgb(lit);
  ctx.lineWidth = Math.max(1, width * 0.3);
  ctx.beginPath();
  ctx.moveTo(x0 - width * 0.2, y0 - width * 0.2);
  ctx.lineTo(x1 - width * 0.2, y1 - width * 0.2);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

interface WheelSpec {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly spokes: number;
  /** How much of the felloe ring is fitted, 0–1, running clockwise from `rimStart`. */
  readonly rimFraction: number;
  readonly rimStart: number;
  readonly tyre: boolean;
  readonly felloe: Ramp;
  readonly spoke: Ramp;
  readonly hub: Ramp;
  /** Horizontal squash for a wheel seen at an angle (1 = face on). */
  readonly squash: number;
  readonly tilt: number;
  readonly hubGold?: boolean;
}

const FELLOE_SEGMENTS = 6;

/**
 * An upright wheel: iron tyre, felloe ring in segments, spokes, and a
 * banded hub. A wheel that is still being built fits only part of its
 * felloe, and the spokes past the fitted arc end in bare tenons.
 */
function paintWheel(ctx: Ctx, s: WheelSpec, ts: number): void {
  ctx.save();
  ctx.translate(s.cx, s.cy);
  ctx.rotate(s.tilt);
  ctx.scale(s.squash, 1);
  const felloeOuter = s.r * (s.tyre ? 0.92 : 1);
  const felloeInner = s.r * 0.74;
  const felloeMid = (felloeOuter + felloeInner) / 2;
  const felloeWidth = felloeOuter - felloeInner;
  const rimEnd = s.rimStart + Math.PI * 2 * s.rimFraction;
  const angleFitted = (a: number): boolean => {
    if (s.rimFraction >= 1) return true;
    let t = a - s.rimStart;
    while (t < 0) t += Math.PI * 2;
    while (t >= Math.PI * 2) t -= Math.PI * 2;
    return t <= rimEnd - s.rimStart;
  };

  // Spokes first, so the felloe and hub sit over their ends.
  const spokeW = s.r * 0.1;
  const hubR = s.r * 0.22;
  for (let i = 0; i < s.spokes; i++) {
    const a = (Math.PI * 2 * i) / s.spokes + Math.PI / s.spokes;
    const fitted = angleFitted(a);
    const reach = fitted ? felloeMid : s.r * 0.9;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const lit = sin < 0 ? 0.72 : 0.5;
    inkedStroke(
      ctx,
      cos * hubR * 0.8,
      sin * hubR * 0.8,
      cos * reach,
      sin * reach,
      spokeW,
      sampleRamp(s.spoke, lit - 0.12),
      sampleRamp(s.spoke, lit + 0.2),
    );
    if (!fitted) {
      // The bare tenon a felloe will be driven onto.
      ctx.fillStyle = rgb(sampleRamp(s.spoke, 0.9));
      ctx.beginPath();
      ctx.arc(cos * reach, sin * reach, spokeW * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Felloe ring.
  const ringStart = s.rimFraction >= 1 ? 0 : s.rimStart;
  const ringEnd = s.rimFraction >= 1 ? Math.PI * 2 : rimEnd;
  ctx.strokeStyle = rgba(TOWN_INK, 0.9);
  ctx.lineWidth = felloeWidth + 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, felloeMid, ringStart, ringEnd);
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(s.felloe, 0.45));
  ctx.lineWidth = felloeWidth;
  ctx.beginPath();
  ctx.arc(0, 0, felloeMid, ringStart, ringEnd);
  ctx.stroke();
  // The ring's upper-left is lit, its lower-right in shade.
  ctx.strokeStyle = rgba(sampleRamp(s.felloe, 0.95), 0.8);
  ctx.lineWidth = felloeWidth * 0.35;
  ctx.beginPath();
  ctx.arc(
    0,
    0,
    felloeOuter - felloeWidth * 0.25,
    Math.max(ringStart, Math.PI * 0.95),
    Math.min(ringEnd, Math.PI * 1.75),
  );
  ctx.stroke();
  ctx.strokeStyle = rgba(TOWN_INK, 0.35);
  ctx.beginPath();
  ctx.arc(
    0,
    0,
    felloeInner + felloeWidth * 0.2,
    Math.max(ringStart, Math.PI * 0.05),
    Math.min(ringEnd, Math.PI * 0.8),
  );
  ctx.stroke();
  // Joints between felloe segments.
  ctx.strokeStyle = rgba(TOWN_INK, 0.7);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  for (let j = 0; j < FELLOE_SEGMENTS; j++) {
    const a = (Math.PI * 2 * j) / FELLOE_SEGMENTS + 0.2;
    if (!angleFitted(a)) continue;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * felloeInner, Math.sin(a) * felloeInner);
    ctx.lineTo(Math.cos(a) * felloeOuter, Math.sin(a) * felloeOuter);
    ctx.stroke();
  }

  if (s.tyre) {
    const tyreR = (s.r + felloeOuter) / 2;
    ctx.strokeStyle = rgba(TOWN_INK, 0.9);
    ctx.lineWidth = s.r - felloeOuter + 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, tyreR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(iron(), 0.55));
    ctx.lineWidth = s.r - felloeOuter;
    ctx.stroke();
    ctx.strokeStyle = rgba(sampleRamp(iron(), 1), 0.9);
    ctx.lineWidth = Math.max(1, (s.r - felloeOuter) * 0.4);
    ctx.beginPath();
    ctx.arc(0, 0, tyreR, Math.PI * 1.05, Math.PI * 1.6);
    ctx.stroke();
  }

  // Hub: a banded nave with the axle hole dark at its centre.
  ctx.fillStyle = rgb(sampleRamp(s.hub, 0.5));
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(sampleRamp(s.hub, 0.85));
  ctx.beginPath();
  ctx.arc(-hubR * 0.25, -hubR * 0.25, hubR * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = s.hubGold === true ? rgb(WAGON_GOLD) : rgb(sampleRamp(iron(), 0.5));
  ctx.lineWidth = hubR * 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, hubR * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgb(TOWN_INK);
  ctx.beginPath();
  ctx.arc(0, 0, hubR * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A curled wood shaving: a short open spiral, lit on its outer turn. */
function paintCurl(ctx: Ctx, x: number, y: number, size: number, rng: Rng, ts: number): void {
  const turn = rng() * Math.PI * 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(TOWN_INK, 0.45);
  ctx.lineWidth = Math.max(1.5, ts * 0.03);
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.62, turn, 0, Math.PI * 1.6);
  ctx.stroke();
  ctx.strokeStyle = rgb(rng() < 0.5 ? SHAVING_LIGHT : SHAVING_MID);
  ctx.lineWidth = Math.max(1, ts * 0.022);
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.62, turn, 0, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.5, size * 0.32, turn, Math.PI * 0.4, Math.PI * 1.9);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** A drift of shavings and sawdust over an area, kept `inset` inside it. */
function paintShavingDrift(
  ctx: Ctx,
  left: number,
  top: number,
  w: number,
  h: number,
  count: number,
  rng: Rng,
  ts: number,
): void {
  // Two or three tight heaps rather than an even sprinkle: shavings fall in
  // drifts where the tool was worked, and an even scatter reads as litter.
  const heaps = w > ts * 1.5 ? 3 : 2;
  const size = ts * 0.065;
  for (let i = 0; i < heaps; i++) {
    const rx = Math.min(w * 0.34, ts * (0.4 + rng() * 0.14));
    const ry = Math.min(h * 0.42, rx * 0.5);
    const cx = left + rx + ((i + 0.2 + rng() * 0.6) / heaps) * (w - rx * 2);
    const cy = top + ry + rng() ** 2 * (h - ry * 2);
    const dust = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    dust.addColorStop(0, rgba(SAWDUST, 0.75));
    dust.addColorStop(0.6, rgba(SAWDUST, 0.4));
    dust.addColorStop(1, rgba(SAWDUST, 0));
    ctx.fillStyle = dust;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    const perHeap = Math.ceil(count / heaps);
    for (let j = 0; j < perHeap; j++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.8;
      paintCurl(
        ctx,
        cx + Math.cos(a) * (rx - size) * d,
        cy + Math.sin(a) * (ry - size * 0.5) * d,
        size * (0.7 + rng() * 0.6),
        rng,
        ts,
      );
    }
  }
}

// ── The red circus wagon bed ────────────────────────────────────────────────

const WAGON_BODY_INSET_LEFT_TILES = 0.2;
const WAGON_BODY_INSET_RIGHT_TILES = 0.15;
const WAGON_BODY_FOOT_TILES = 0.55;
const WAGON_PANEL_TILES = 1.12;
const WAGON_INTERIOR_TILES = 0.26;
const WAGON_PANEL_COUNT = 3;

function paintWagonPanelOrnament(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  star: boolean,
  ts: number,
): void {
  const inset = ts * 0.07;
  // Recessed panel: a darker field inside a gold bead.
  ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.34));
  ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.strokeStyle = rgb(WAGON_GOLD);
  ctx.lineWidth = Math.max(1.5, ts * 0.03);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.strokeStyle = rgba(WAGON_GOLD_BRIGHT, 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + inset, y + h - inset);
  ctx.lineTo(x + inset, y + inset);
  ctx.lineTo(x + w - inset, y + inset);
  ctx.stroke();
  // Scroll curls in the four corners.
  const curl = ts * 0.09;
  ctx.strokeStyle = rgb(WAGON_GOLD);
  ctx.lineWidth = Math.max(1.5, ts * 0.028);
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [x + inset * 2.2, y + inset * 2.2, 0],
    [x + w - inset * 2.2, y + inset * 2.2, Math.PI * 0.5],
    [x + w - inset * 2.2, y + h - inset * 2.2, Math.PI],
    [x + inset * 2.2, y + h - inset * 2.2, Math.PI * 1.5],
  ];
  for (const [cx, cy, rot] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, curl * 0.5, rot, rot + Math.PI * 1.5);
    ctx.stroke();
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (star) {
    // A gold star on a blue roundel: the one device every showman's wagon carries.
    const discR = Math.min(w, h) * 0.34;
    ctx.fillStyle = rgb(WAGON_BLUE);
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(WAGON_GOLD);
    ctx.lineWidth = Math.max(1.5, ts * 0.03);
    ctx.stroke();
    const points = 5;
    const outer = discR * 0.82;
    const inner = outer * 0.42;
    ctx.fillStyle = rgb(WAGON_GOLD_BRIGHT);
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / points;
      const rr = i % 2 === 0 ? outer : inner;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(WAGON_GOLD_DIM, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // A gold lozenge with a scroll either side.
    const lw = w * 0.2;
    const lh = h * 0.28;
    ctx.fillStyle = rgb(WAGON_GOLD);
    ctx.beginPath();
    ctx.moveTo(cx, cy - lh);
    ctx.lineTo(cx + lw, cy);
    ctx.lineTo(cx, cy + lh);
    ctx.lineTo(cx - lw, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(WAGON_GOLD_DIM, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = rgb(WAGON_GOLD);
    ctx.lineWidth = Math.max(1.5, ts * 0.028);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * lw * 1.9, cy, lh * 0.55, 0, Math.PI * 1.6);
      ctx.stroke();
    }
  }
}

/**
 * The long red wagon bed Brann built for the circus and never burned:
 * a showman's-red body with gold-beaded panels, a star roundel and a
 * scalloped skirt, standing on timber cribbing with its near wheel still
 * on the axle and the far wheel off and leaning, a dust sheet thrown over
 * one end and the drawbar lying along the boards in front. Dust greys every
 * upward face, so the red reads as red under the dust.
 */
export function paintWagonBed(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const bodyL = box.left + ts * WAGON_BODY_INSET_LEFT_TILES;
    const bodyR = box.right - ts * WAGON_BODY_INSET_RIGHT_TILES;
    const bodyW = bodyR - bodyL;
    const bodyBottom = box.bottom - ts * WAGON_BODY_FOOT_TILES;
    const panelTop = bodyBottom - ts * WAGON_PANEL_TILES;
    const interiorTop = panelTop - ts * WAGON_INTERIOR_TILES;

    bandShadow(ctx, bodyL, bodyR, box.bottom - ts * 0.34, ts, 0.42);

    // Cribbing: short timbers stacked crosswise under each end of the body.
    const cribW = ts * 0.62;
    const cribLayerH = ts * 0.14;
    const cribXs = [bodyL + ts * 1.55, bodyR - ts * 1.25];
    for (const cx of cribXs) {
      for (let layer = 0; layer < 3; layer++) {
        const ly = bodyBottom + ts * 0.1 + layer * cribLayerH;
        const endOn = layer % 2 === 1;
        const lw = endOn ? cribW * 0.8 : cribW;
        paintBeam(
          ctx,
          cx - lw / 2,
          ly,
          lw,
          cribLayerH * 0.62,
          cribLayerH * 0.38,
          oldWood(),
          ts,
          0.42,
        );
        if (endOn) {
          for (const ex of [cx - lw * 0.32, cx + lw * 0.18]) {
            ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.8));
            ctx.fillRect(ex, ly + cribLayerH * 0.1, lw * 0.14, cribLayerH * 0.7);
          }
        }
      }
    }

    // Chassis beam under the body.
    paintBeam(
      ctx,
      bodyL + ts * 0.3,
      bodyBottom - ts * 0.02,
      bodyW - ts * 0.6,
      ts * 0.1,
      ts * 0.04,
      iron(),
      ts,
      0.45,
    );

    // Interior: the far side's inner face and the bed floor, in shade.
    const interior = ctx.createLinearGradient(0, interiorTop, 0, panelTop);
    interior.addColorStop(0, rgb(sampleRamp(WAGON_RED, 0.3)));
    interior.addColorStop(1, rgb(sampleRamp(WAGON_RED, 0.08)));
    ctx.fillStyle = interior;
    ctx.fillRect(bodyL + ts * 0.06, interiorTop, bodyW - ts * 0.12, panelTop - interiorTop);
    // Far rail along the top of the interior.
    ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.55));
    ctx.fillRect(bodyL + ts * 0.06, interiorTop, bodyW - ts * 0.12, ts * 0.07);
    ctx.fillStyle = rgb(WAGON_GOLD);
    ctx.fillRect(
      bodyL + ts * 0.06,
      interiorTop + ts * 0.07,
      bodyW - ts * 0.12,
      Math.max(1.5, ts * 0.02),
    );
    inkRect(ctx, bodyL + ts * 0.06, interiorTop, bodyW - ts * 0.12, panelTop - interiorTop, ts);
    // A coil of rope and a crate lid left in the bed, just showing over the near side.
    ctx.fillStyle = rgb(CORD);
    ctx.beginPath();
    ctx.ellipse(bodyL + bodyW * 0.3, panelTop - ts * 0.08, ts * 0.22, ts * 0.08, 0, Math.PI, 0);
    ctx.fill();
    inkOutline(ctx, ts);

    // The near side panel.
    const side = ctx.createLinearGradient(0, panelTop, 0, bodyBottom);
    side.addColorStop(0, rgb(sampleRamp(WAGON_RED, 0.78)));
    side.addColorStop(0.55, rgb(sampleRamp(WAGON_RED, 0.52)));
    side.addColorStop(1, rgb(sampleRamp(WAGON_RED, 0.3)));
    ctx.fillStyle = side;
    ctx.fillRect(bodyL, panelTop, bodyW, bodyBottom - panelTop);

    // Panels, divided by turned posts.
    const postW = ts * 0.12;
    const panelW = (bodyW - postW * (WAGON_PANEL_COUNT + 1)) / WAGON_PANEL_COUNT;
    const middlePanel = Math.floor(WAGON_PANEL_COUNT / 2);
    for (let p = 0; p < WAGON_PANEL_COUNT; p++) {
      const px = bodyL + postW + p * (panelW + postW);
      paintWagonPanelOrnament(
        ctx,
        px,
        panelTop + ts * 0.1,
        panelW,
        bodyBottom - panelTop - ts * 0.26,
        p === middlePanel,
        ts,
      );
    }
    for (let p = 0; p <= WAGON_PANEL_COUNT; p++) {
      const px = bodyL + p * (panelW + postW);
      ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.6));
      ctx.fillRect(px, panelTop, postW, bodyBottom - panelTop);
      ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.92));
      ctx.fillRect(px + postW * 0.15, panelTop, postW * 0.25, bodyBottom - panelTop);
      for (const by of [panelTop + ts * 0.12, bodyBottom - ts * 0.16]) {
        ctx.fillStyle = rgb(WAGON_GOLD);
        ctx.fillRect(px, by, postW, ts * 0.04);
      }
      inkRect(ctx, px, panelTop, postW, bodyBottom - panelTop, ts);
    }

    // Scalloped skirt along the foot of the body.
    const scallops = Math.round(bodyW / (ts * 0.32));
    const scW = bodyW / scallops;
    ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.4));
    ctx.beginPath();
    ctx.moveTo(bodyL, bodyBottom - ts * 0.1);
    for (let i = 0; i < scallops; i++) {
      ctx.arc(bodyL + scW * (i + 0.5), bodyBottom - ts * 0.1, scW / 2, Math.PI, 0, true);
    }
    ctx.lineTo(bodyR, bodyBottom - ts * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgb(WAGON_GOLD);
    ctx.lineWidth = Math.max(1.5, ts * 0.025);
    ctx.beginPath();
    for (let i = 0; i < scallops; i++) {
      ctx.moveTo(bodyL + scW * i, bodyBottom - ts * 0.1);
      ctx.arc(bodyL + scW * (i + 0.5), bodyBottom - ts * 0.1, scW / 2, Math.PI, 0, true);
    }
    ctx.stroke();

    // Top cap rail, gold-edged.
    const railH = ts * 0.13;
    ctx.fillStyle = rgb(sampleRamp(WAGON_RED, 0.62));
    ctx.fillRect(bodyL - ts * 0.03, panelTop - railH * 0.5, bodyW + ts * 0.06, railH);
    ctx.fillStyle = rgb(WAGON_GOLD_BRIGHT);
    ctx.fillRect(
      bodyL - ts * 0.03,
      panelTop - railH * 0.5,
      bodyW + ts * 0.06,
      Math.max(1.5, railH * 0.24),
    );
    ctx.fillStyle = rgb(WAGON_GOLD_DIM);
    ctx.fillRect(
      bodyL - ts * 0.03,
      panelTop + railH * 0.36,
      bodyW + ts * 0.06,
      Math.max(1, railH * 0.14),
    );
    inkRect(ctx, bodyL - ts * 0.03, panelTop - railH * 0.5, bodyW + ts * 0.06, railH, ts);
    inkRect(ctx, bodyL, panelTop, bodyW, bodyBottom - panelTop, ts);

    // Dust on every upward face, and a haze over the whole body.
    ctx.fillStyle = rgba(DUST, 0.14);
    ctx.fillRect(bodyL, interiorTop, bodyW, bodyBottom - interiorTop);
    ctx.fillStyle = rgba(DUST, 0.42);
    ctx.fillRect(bodyL - ts * 0.03, panelTop - railH * 0.5, bodyW + ts * 0.06, railH * 0.4);
    const dustRng = forkRng(rng);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rgba(DUST, 0.2 + dustRng() * 0.2);
      ctx.fillRect(
        bodyL + dustRng() * bodyW,
        panelTop + dustRng() * (bodyBottom - panelTop),
        ts * 0.03,
        ts * 0.015,
      );
    }

    // The dust sheet, thrown over the east end and hanging in folds.
    const sheetL = bodyR - ts * 1.3;
    const sheetR = bodyR + ts * 0.08;
    const hemY = bodyBottom + ts * 0.02;
    ctx.fillStyle = rgb(sampleRamp(SHEET, 0.55));
    ctx.beginPath();
    ctx.moveTo(sheetL + ts * 0.25, interiorTop - ts * 0.04);
    ctx.quadraticCurveTo(
      sheetL + ts * 0.7,
      interiorTop - ts * 0.14,
      sheetR,
      interiorTop + ts * 0.02,
    );
    ctx.lineTo(sheetR, hemY - ts * 0.12);
    ctx.lineTo(sheetR - ts * 0.18, hemY);
    ctx.lineTo(sheetR - ts * 0.45, hemY - ts * 0.08);
    ctx.lineTo(sheetR - ts * 0.72, hemY + ts * 0.02);
    ctx.lineTo(sheetL + ts * 0.28, hemY - ts * 0.18);
    ctx.quadraticCurveTo(
      sheetL - ts * 0.04,
      panelTop + ts * 0.3,
      sheetL + ts * 0.05,
      panelTop - ts * 0.04,
    );
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Folds: the cloth hangs from the rail corner, so each fold fans out and
    // down from it — a shaded trough with a lit ridge on its west side.
    const pivotX = sheetR - ts * 0.15;
    const pivotY = interiorTop;
    const folds: ReadonlyArray<readonly [number, number]> = [
      [0.12, 0.26],
      [0.42, 0.52],
      [0.74, 0.8],
      [1.02, 1.06],
    ];
    ctx.lineCap = 'round';
    for (const [topFrac, hemFrac] of folds) {
      const tx = pivotX - ts * topFrac * 0.6;
      const hx = sheetR - ts * hemFrac;
      ctx.strokeStyle = rgba(sampleRamp(SHEET, 0), 0.55);
      ctx.lineWidth = ts * 0.07;
      ctx.beginPath();
      ctx.moveTo(tx, pivotY + ts * 0.05);
      ctx.quadraticCurveTo(hx + ts * 0.08, (pivotY + hemY) / 2, hx, hemY);
      ctx.stroke();
      ctx.strokeStyle = rgba(sampleRamp(SHEET, 1), 0.8);
      ctx.lineWidth = ts * 0.03;
      ctx.beginPath();
      ctx.moveTo(tx - ts * 0.06, pivotY + ts * 0.05);
      ctx.quadraticCurveTo(hx + ts * 0.01, (pivotY + hemY) / 2, hx - ts * 0.07, hemY);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // The hem in shade, where the cloth turns under.
    ctx.fillStyle = rgba(sampleRamp(SHEET, 0), 0.35);
    ctx.fillRect(sheetL, hemY - ts * 0.14, sheetR - sheetL, ts * 0.14);
    ctx.fillStyle = rgba(sampleRamp(SHEET, 1), 0.7);
    ctx.fillRect(sheetL, interiorTop - ts * 0.2, sheetR - sheetL, ts * 0.22);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(sheetL + ts * 0.25, interiorTop - ts * 0.04);
    ctx.quadraticCurveTo(
      sheetL + ts * 0.7,
      interiorTop - ts * 0.14,
      sheetR,
      interiorTop + ts * 0.02,
    );
    ctx.lineTo(sheetR, hemY - ts * 0.12);
    ctx.lineTo(sheetR - ts * 0.18, hemY);
    ctx.lineTo(sheetR - ts * 0.45, hemY - ts * 0.08);
    ctx.lineTo(sheetR - ts * 0.72, hemY + ts * 0.02);
    ctx.lineTo(sheetL + ts * 0.28, hemY - ts * 0.18);
    ctx.quadraticCurveTo(
      sheetL - ts * 0.04,
      panelTop + ts * 0.3,
      sheetL + ts * 0.05,
      panelTop - ts * 0.04,
    );
    ctx.closePath();
    inkOutline(ctx, ts);

    // The near wheel, still on its axle.
    const wheelR = ts * 0.64;
    paintWheel(
      ctx,
      {
        cx: bodyL + ts * 0.72,
        cy: box.bottom - wheelR - ts * 0.04,
        r: wheelR,
        spokes: 10,
        rimFraction: 1,
        rimStart: 0,
        tyre: true,
        felloe: WAGON_RED,
        spoke: WAGON_RED,
        hub: WAGON_RED,
        squash: 1,
        tilt: 0,
        hubGold: true,
      },
      ts,
    );
    // The far wheel, off its axle and leaning against the cribbing.
    paintWheel(
      ctx,
      {
        cx: bodyR - ts * 0.55,
        cy: box.bottom - ts * 0.6,
        r: ts * 0.56,
        spokes: 10,
        rimFraction: 1,
        rimStart: 0,
        tyre: true,
        felloe: WAGON_RED,
        spoke: WAGON_RED,
        hub: WAGON_RED,
        squash: 0.5,
        tilt: -0.22,
        hubGold: true,
      },
      ts,
    );

    // The drawbar, lying along the boards in front.
    const barY = box.bottom - ts * 0.12;
    inkedStroke(
      ctx,
      bodyL + ts * 1.55,
      barY,
      bodyL + ts * 3.25,
      barY - ts * 0.08,
      ts * 0.09,
      sampleRamp(WAGON_RED, 0.45),
      sampleRamp(WAGON_RED, 0.85),
    );
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.6));
    ctx.beginPath();
    ctx.arc(bodyL + ts * 3.25, barY - ts * 0.08, ts * 0.06, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
  });
}

// ── The wheel mid-build ─────────────────────────────────────────────────────

/**
 * A wheel being built on its stand: two stout posts and an axle bar holding
 * it upright, every spoke driven into the hub, the felloe fitted round the
 * top half and the lower spokes still bare tenons. A mallet leans on the
 * post, the unfitted felloes lie stacked at its foot, and there are shavings
 * where the spokes were dressed.
 */
export function paintWheelBuildStand(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, box.bottom - ts * 0.3, ts, 0.36);
    paintShavingDrift(
      ctx,
      box.left + ts * 0.1,
      box.bottom - ts * 0.62,
      box.width - ts * 0.2,
      ts * 0.5,
      9,
      forkRng(rng),
      ts,
    );

    const postW = ts * 0.2;
    const postTop = box.bottom - ts * 1.7;
    const postBottom = box.bottom - ts * 0.34;
    const wheelCy = box.bottom - ts * 1.12;
    const postXs = [box.left + ts * 0.1, box.right - ts * 0.1 - postW];
    // Sole beam the posts are mortised into.
    paintBeam(
      ctx,
      box.left + ts * 0.04,
      postBottom - ts * 0.04,
      box.width - ts * 0.08,
      ts * 0.14,
      ts * 0.08,
      oldWood(),
      ts,
      0.4,
    );
    for (const px of postXs) {
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.48));
      ctx.fillRect(px, postTop, postW, postBottom - postTop);
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.8));
      ctx.fillRect(px + postW * 0.12, postTop, postW * 0.24, postBottom - postTop);
      ctx.fillStyle = rgba(TOWN_INK, 0.25);
      ctx.fillRect(px + postW * 0.72, postTop, postW * 0.28, postBottom - postTop);
      inkRect(ctx, px, postTop, postW, postBottom - postTop, ts);
      paintBeam(
        ctx,
        px - ts * 0.04,
        postTop - ts * 0.06,
        postW + ts * 0.08,
        ts * 0.05,
        ts * 0.04,
        oldWood(),
        ts,
        0.55,
      );
    }
    // Axle bar through the hub.
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.55));
    ctx.fillRect(postXs[0], wheelCy - ts * 0.04, postXs[1] + postW - postXs[0], ts * 0.08);
    inkRect(ctx, postXs[0], wheelCy - ts * 0.04, postXs[1] + postW - postXs[0], ts * 0.08, ts);

    paintWheel(
      ctx,
      {
        cx: box.centreX,
        cy: wheelCy,
        r: ts * 0.76,
        spokes: 12,
        rimFraction: 0.55,
        rimStart: Math.PI * 0.95,
        tyre: false,
        felloe: NEW_WOOD,
        spoke: NEW_WOOD,
        hub: ELM,
        squash: 1,
        tilt: 0,
      },
      ts,
    );

    // Unfitted felloes stacked at the stand's foot.
    for (let i = 0; i < 3; i++) {
      const fy = box.bottom - ts * 0.12 - i * ts * 0.1;
      const fx = box.right - ts * 0.5;
      ctx.strokeStyle = rgba(TOWN_INK, 0.85);
      ctx.lineWidth = ts * 0.12 + 2;
      ctx.beginPath();
      ctx.arc(fx, fy + ts * 0.5, ts * 0.46, Math.PI * 1.3, Math.PI * 1.7);
      ctx.stroke();
      ctx.strokeStyle = rgb(sampleRamp(NEW_WOOD, 0.55 + i * 0.1));
      ctx.lineWidth = ts * 0.12;
      ctx.stroke();
    }
    // The mallet, leaning on the west post.
    const malletX = box.left + ts * 0.42;
    inkedStroke(
      ctx,
      malletX,
      box.bottom - ts * 0.08,
      malletX - ts * 0.12,
      box.bottom - ts * 0.62,
      ts * 0.05,
      sampleRamp(oldWood(), 0.5),
      sampleRamp(oldWood(), 0.85),
    );
    ctx.save();
    ctx.translate(malletX - ts * 0.13, box.bottom - ts * 0.66);
    ctx.rotate(-0.2);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.55));
    ctx.fillRect(-ts * 0.14, -ts * 0.08, ts * 0.28, ts * 0.16);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.85));
    ctx.fillRect(-ts * 0.14, -ts * 0.08, ts * 0.28, ts * 0.05);
    inkRect(ctx, -ts * 0.14, -ts * 0.08, ts * 0.28, ts * 0.16, ts);
    ctx.restore();
  });
}

// ── Finished wheels leaning on the wall ─────────────────────────────────────

/** Two finished, iron-tyred wheels leaning on the wall — one oiled bare, one painted ochre for a farm cart. */
export function paintFinishedWheels(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, box.bottom - ts * 0.18, ts, 0.36);
    const r = ts * 0.62;
    paintWheel(
      ctx,
      {
        cx: box.left + r + ts * 0.04,
        cy: box.bottom - r - ts * 0.1,
        r,
        spokes: 12,
        rimFraction: 1,
        rimStart: 0,
        tyre: true,
        felloe: NEW_WOOD,
        spoke: NEW_WOOD,
        hub: ELM,
        squash: 0.86,
        tilt: 0.08,
      },
      ts,
    );
    paintWheel(
      ctx,
      {
        cx: box.right - r - ts * 0.02,
        cy: box.bottom - r - ts * 0.04,
        r,
        spokes: 12,
        rimFraction: 1,
        rimStart: 0,
        tyre: true,
        felloe: OCHRE,
        spoke: OCHRE,
        hub: ELM,
        squash: 0.86,
        tilt: -0.06,
      },
      ts,
    );
    // A paper tag tied to the ochre wheel's spoke: somebody's order.
    const tagX = box.right - r - ts * 0.3;
    const tagY = box.bottom - r - ts * 0.34;
    ctx.fillStyle = rgb([226, 214, 184]);
    ctx.fillRect(tagX, tagY, ts * 0.13, ts * 0.17);
    ctx.fillStyle = rgba(TOWN_INK, 0.6);
    ctx.fillRect(tagX + ts * 0.025, tagY + ts * 0.05, ts * 0.08, 1.5);
    ctx.fillRect(tagX + ts * 0.025, tagY + ts * 0.1, ts * 0.06, 1.5);
    inkRect(ctx, tagX, tagY, ts * 0.13, ts * 0.17, ts);
  });
}

// ── The joiner's bench and its tool board ───────────────────────────────────

function paintHandSaw(ctx: Ctx, x: number, y: number, len: number, ts: number): void {
  // Blade tapering from the handle down to the toe, teeth along its lower edge.
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.62));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len * 0.28, y);
  ctx.lineTo(x + len * 0.14, y + len);
  ctx.lineTo(x + len * 0.02, y + len);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(sampleRamp(STEEL, 1), 0.8);
  ctx.fillRect(x + len * 0.03, y + len * 0.05, len * 0.04, len * 0.85);
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.6));
  ctx.beginPath();
  ctx.ellipse(x + len * 0.14, y - len * 0.08, len * 0.18, len * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(TOWN_INK);
  ctx.beginPath();
  ctx.ellipse(x + len * 0.14, y - len * 0.08, len * 0.08, len * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paintBowSaw(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const wood = sampleRamp(NEW_WOOD, 0.5);
  const lit = sampleRamp(NEW_WOOD, 0.85);
  inkedStroke(ctx, x, y, x, y + h, ts * 0.04, wood, lit);
  inkedStroke(ctx, x + w, y, x + w, y + h, ts * 0.04, wood, lit);
  inkedStroke(ctx, x, y + h * 0.5, x + w, y + h * 0.5, ts * 0.035, wood, lit);
  // Twisted cord across the top, the blade across the bottom.
  ctx.strokeStyle = rgb(CORD);
  ctx.lineWidth = Math.max(1.5, ts * 0.025);
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.05);
  ctx.lineTo(x + w, y + h * 0.05);
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.7));
  ctx.fillRect(x, y + h * 0.88, w, h * 0.1);
  inkRect(ctx, x, y + h * 0.88, w, h * 0.1, ts);
}

function paintChiselRack(ctx: Ctx, x: number, y: number, w: number, ts: number, rng: Rng): void {
  paintBeam(ctx, x, y, w, ts * 0.06, ts * 0.03, oldWood(), ts, 0.4);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const cx = x + (w * (i + 0.5)) / count;
    const handleH = ts * (0.16 + rng() * 0.04);
    ctx.fillStyle = rgb(sampleRamp(i % 2 === 0 ? ELM : NEW_WOOD, 0.6));
    ctx.fillRect(cx - ts * 0.03, y - handleH, ts * 0.06, handleH);
    inkRect(ctx, cx - ts * 0.03, y - handleH, ts * 0.06, handleH, ts);
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.6));
    ctx.fillRect(cx - ts * 0.015, y + ts * 0.09, ts * 0.03, ts * 0.12);
  }
}

function paintBrace(ctx: Ctx, x: number, y: number, s: number, ts: number): void {
  ctx.strokeStyle = rgba(TOWN_INK, 0.85);
  ctx.lineWidth = s * 0.14 + 2;
  ctx.lineJoin = 'round';
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + s * 0.25);
    ctx.lineTo(x + s * 0.4, y + s * 0.25);
    ctx.lineTo(x + s * 0.4, y + s * 0.7);
    ctx.lineTo(x, y + s * 0.7);
    ctx.lineTo(x, y + s);
  };
  path();
  ctx.stroke();
  ctx.strokeStyle = rgb(sampleRamp(STEEL, 0.55));
  ctx.lineWidth = s * 0.14;
  path();
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.6));
  ctx.beginPath();
  ctx.arc(x, y, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
}

function paintTrySquare(ctx: Ctx, x: number, y: number, s: number, ts: number): void {
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.55));
  ctx.fillRect(x, y, s * 0.18, s);
  inkRect(ctx, x, y, s * 0.18, s, ts);
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.75));
  ctx.fillRect(x + s * 0.18, y + s * 0.82, s * 0.7, s * 0.12);
  inkRect(ctx, x + s * 0.18, y + s * 0.82, s * 0.7, s * 0.12, ts);
}

function paintHungMallet(ctx: Ctx, x: number, y: number, s: number, ts: number): void {
  inkedStroke(
    ctx,
    x,
    y,
    x,
    y + s,
    s * 0.12,
    sampleRamp(NEW_WOOD, 0.55),
    sampleRamp(NEW_WOOD, 0.85),
  );
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.55));
  ctx.fillRect(x - s * 0.24, y + s * 0.62, s * 0.48, s * 0.36);
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.85));
  ctx.fillRect(x - s * 0.24, y + s * 0.62, s * 0.48, s * 0.1);
  inkRect(ctx, x - s * 0.24, y + s * 0.62, s * 0.48, s * 0.36, ts);
}

function paintJackPlane(ctx: Ctx, x: number, y: number, len: number, ts: number): void {
  const h = len * 0.26;
  ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.6));
  ctx.fillRect(x, y - h, len, h);
  ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.9));
  ctx.fillRect(x, y - h, len, h * 0.3);
  inkRect(ctx, x, y - h, len, h, ts);
  // The iron wedged up through the stock and the tote behind it.
  ctx.fillStyle = rgb(sampleRamp(STEEL, 0.6));
  ctx.fillRect(x + len * 0.42, y - h * 1.7, len * 0.08, h * 0.9);
  inkRect(ctx, x + len * 0.42, y - h * 1.7, len * 0.08, h * 0.9, ts);
  ctx.fillStyle = rgb(sampleRamp(ELM, 0.6));
  ctx.beginPath();
  ctx.ellipse(x + len * 0.72, y - h * 1.3, len * 0.1, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
}

const BENCH_TOP_TILES = 0.96;
const BENCH_APRON_TILES = 0.72;
const BENCH_BOARD_BOTTOM_TILES = 1.08;
const BENCH_BOARD_TOP_TILES = 2.02;

/**
 * The joiner's bench along the north wall: a thick elm top on heavy legs
 * with a leg vice at one end, a spoke clamped in its jaws, a plane and a
 * spokeshave on the top among curled shavings, offcuts on the shelf below —
 * and behind it on the wall a tool board: bow saw, hand saws, a brace, a
 * rack of chisels, mallets and a try square, each on its own peg.
 */
export function paintJoinerBench(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;

    // Tool board on the wall.
    const boardL = box.left + ts * 0.08;
    const boardW = box.width - ts * 0.16;
    const boardTop = b - ts * BENCH_BOARD_TOP_TILES;
    const boardBottom = b - ts * BENCH_BOARD_BOTTOM_TILES;
    paintPlankBoard(ctx, boardL, boardTop, boardW, boardBottom - boardTop, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.24,
      ramp: oldWood(),
    });
    ctx.fillStyle = rgba(TOWN_INK, 0.18);
    ctx.fillRect(boardL, boardTop, boardW, boardBottom - boardTop);
    inkRect(ctx, boardL, boardTop, boardW, boardBottom - boardTop, ts);
    const pegRng = forkRng(rng);
    const u = ts;
    const hangY = boardTop + ts * 0.12;
    paintBowSaw(ctx, boardL + u * 0.12, hangY, u * 0.62, u * 0.5, ts);
    paintHandSaw(ctx, boardL + u * 0.92, hangY + u * 0.1, u * 0.62, ts);
    paintHandSaw(ctx, boardL + u * 1.28, hangY + u * 0.14, u * 0.52, ts);
    paintBrace(ctx, boardL + u * 1.8, hangY + u * 0.04, u * 0.62, ts);
    paintChiselRack(ctx, boardL + u * 2.3, hangY + u * 0.36, u * 0.9, ts, pegRng);
    paintHungMallet(ctx, boardL + u * 3.42, hangY, u * 0.52, ts);
    paintHungMallet(ctx, boardL + u * 3.78, hangY + u * 0.06, u * 0.44, ts);
    paintTrySquare(ctx, boardL + u * 4.1, hangY + u * 0.02, u * 0.5, ts);
    // A shelf along the board's top: glue pots and a jar of pegs.
    paintBeam(ctx, boardL, boardTop - ts * 0.02, boardW, ts * 0.05, ts * 0.04, oldWood(), ts, 0.5);
    for (const px of [0.4, 2.55, 4.4]) {
      ctx.fillStyle = rgb(sampleRamp(getTownRamp('oc_timber'), 0.25));
      ctx.fillRect(boardL + u * px, boardTop - ts * 0.2, ts * 0.14, ts * 0.18);
      ctx.fillStyle = rgb(SHAVING_MID);
      ctx.fillRect(boardL + u * px, boardTop - ts * 0.2, ts * 0.14, ts * 0.04);
      inkRect(ctx, boardL + u * px, boardTop - ts * 0.2, ts * 0.14, ts * 0.18, ts);
    }

    // Bench: legs and a low shelf of offcuts.
    const topY = b - ts * BENCH_TOP_TILES;
    const apronY = b - ts * BENCH_APRON_TILES;
    const apronH = ts * 0.14;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.1, ts, 0.34);
    const legW = ts * 0.14;
    const legXs = [
      box.left + ts * 0.14,
      box.left + ts * 1.7,
      box.right - ts * 1.84,
      box.right - ts * 0.28,
    ];
    for (const lx of legXs) {
      ctx.fillStyle = rgb(sampleRamp(ELM, 0.38));
      ctx.fillRect(lx, apronY + apronH, legW, b - apronY - apronH - ts * 0.04);
      ctx.fillStyle = rgb(sampleRamp(ELM, 0.62));
      ctx.fillRect(lx, apronY + apronH, legW * 0.3, b - apronY - apronH - ts * 0.04);
      inkRect(ctx, lx, apronY + apronH, legW, b - apronY - apronH - ts * 0.04, ts);
    }
    const shelfY = b - ts * 0.24;
    paintBeam(
      ctx,
      box.left + ts * 0.14,
      shelfY,
      box.width - ts * 0.28,
      ts * 0.06,
      ts * 0.04,
      ELM,
      ts,
      0.35,
    );
    const offcutRng = forkRng(rng);
    for (let i = 0; i < 7; i++) {
      const ox = box.left + ts * (0.4 + i * 0.62 + offcutRng() * 0.2);
      if (ox > box.right - ts * 0.6) break;
      const ow = ts * (0.3 + offcutRng() * 0.2);
      const oh = ts * (0.08 + offcutRng() * 0.06);
      paintBeam(
        ctx,
        ox,
        shelfY - oh,
        ow,
        oh * 0.6,
        oh * 0.4,
        NEW_WOOD,
        ts,
        0.45 + offcutRng() * 0.2,
      );
    }

    // Top and apron.
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.78));
    ctx.fillRect(box.left + ts * 0.04, topY, box.width - ts * 0.08, apronY - topY);
    ctx.fillStyle = rgba(sampleRamp(ELM, 1), 0.5);
    ctx.fillRect(box.left + ts * 0.04, apronY - ts * 0.05, box.width - ts * 0.08, ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.46));
    ctx.fillRect(box.left + ts * 0.04, apronY, box.width - ts * 0.08, apronH);
    inkRect(ctx, box.left + ts * 0.04, topY, box.width - ts * 0.08, apronY - topY + apronH, ts);
    // Bench dogs and old saw scars on the top.
    ctx.fillStyle = rgba(TOWN_INK, 0.35);
    for (let i = 0; i < 9; i++) {
      ctx.fillRect(
        box.left + ts * (0.5 + i * 0.5),
        topY + ts * 0.05 + (i % 2) * ts * 0.07,
        ts * 0.2,
        1.5,
      );
    }

    // Leg vice at the west end, a spoke clamped in its jaws.
    const viceX = box.left + ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.55));
    ctx.fillRect(viceX, topY - ts * 0.08, ts * 0.2, b - topY - ts * 0.04);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.85));
    ctx.fillRect(viceX, topY - ts * 0.08, ts * 0.06, b - topY - ts * 0.04);
    inkRect(ctx, viceX, topY - ts * 0.08, ts * 0.2, b - topY - ts * 0.04, ts);
    inkedStroke(
      ctx,
      viceX - ts * 0.02,
      apronY + ts * 0.1,
      viceX + ts * 0.3,
      apronY + ts * 0.18,
      ts * 0.04,
      sampleRamp(NEW_WOOD, 0.5),
      sampleRamp(NEW_WOOD, 0.9),
    );
    inkedStroke(
      ctx,
      viceX + ts * 0.14,
      topY - ts * 0.34,
      viceX + ts * 0.14,
      topY + ts * 0.02,
      ts * 0.07,
      sampleRamp(NEW_WOOD, 0.6),
      sampleRamp(NEW_WOOD, 0.95),
    );

    // Work on the top: a plane, a spokeshave, a mallet, shavings everywhere.
    paintJackPlane(ctx, box.left + ts * 0.7, apronY - ts * 0.08, ts * 0.62, ts);
    const shaveX = box.left + ts * 2.1;
    const shaveY = topY + ts * 0.1;
    inkedStroke(
      ctx,
      shaveX,
      shaveY,
      shaveX + ts * 0.55,
      shaveY,
      ts * 0.05,
      sampleRamp(ELM, 0.55),
      sampleRamp(ELM, 0.85),
    );
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.6));
    ctx.fillRect(shaveX + ts * 0.18, shaveY - ts * 0.05, ts * 0.18, ts * 0.08);
    inkRect(ctx, shaveX + ts * 0.18, shaveY - ts * 0.05, ts * 0.18, ts * 0.08, ts);
    // A hub blank waiting its turn on the lathe.
    const hubX = box.right - ts * 1.3;
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.6));
    ctx.fillRect(hubX, topY - ts * 0.18, ts * 0.42, ts * 0.3);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.9));
    ctx.beginPath();
    ctx.ellipse(hubX + ts * 0.42, topY - ts * 0.03, ts * 0.07, ts * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    inkRect(ctx, hubX, topY - ts * 0.18, ts * 0.42, ts * 0.3, ts);
    const curlRng = forkRng(rng);
    for (let i = 0; i < 14; i++) {
      paintCurl(
        ctx,
        box.left + ts * (1.4 + curlRng() * 3.1),
        topY + ts * (0.04 + curlRng() * 0.14),
        ts * (0.05 + curlRng() * 0.04),
        curlRng,
        ts,
      );
    }
    // Shavings fallen off the front edge onto the boards.
    for (let i = 0; i < 8; i++) {
      paintCurl(
        ctx,
        box.left + ts * (1 + curlRng() * 3),
        b - ts * (0.08 + curlRng() * 0.1),
        ts * 0.06,
        curlRng,
        ts,
      );
    }
  });
}

// ── The spring-pole lathe ───────────────────────────────────────────────────

/**
 * A pole lathe against the wall: a timber bed on two trestle legs, head and
 * tail poppets holding a hub blank half turned, a tool rest in front, and a
 * cord running from the treadle round the work and up to a springy ash pole
 * bracketed to the wall above.
 */
export function paintLathe(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.1, ts, 0.32);
    paintShavingDrift(
      ctx,
      box.left + ts * 0.5,
      b - ts * 0.42,
      ts * 1.9,
      ts * 0.36,
      8,
      forkRng(rng),
      ts,
    );

    // Spring pole: bracketed to the wall at the west end, bowed down at the east.
    const poleRootX = box.left + ts * 0.14;
    const poleRootY = b - ts * 1.86;
    const poleTipX = box.right - ts * 0.6;
    const poleTipY = b - ts * 1.58;
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.5));
    ctx.fillRect(poleRootX - ts * 0.06, poleRootY - ts * 0.08, ts * 0.12, ts * 0.22);
    inkRect(ctx, poleRootX - ts * 0.06, poleRootY - ts * 0.08, ts * 0.12, ts * 0.22, ts);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(TOWN_INK, 0.85);
    ctx.lineWidth = ts * 0.07 + 2;
    ctx.beginPath();
    ctx.moveTo(poleRootX, poleRootY);
    ctx.quadraticCurveTo(box.centreX, poleRootY - ts * 0.22, poleTipX, poleTipY);
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(NEW_WOOD, 0.62));
    ctx.lineWidth = ts * 0.07;
    ctx.stroke();
    ctx.strokeStyle = rgb(sampleRamp(NEW_WOOD, 0.95));
    ctx.lineWidth = ts * 0.02;
    ctx.stroke();
    ctx.lineCap = 'butt';
    // A mid bracket the pole rides over.
    ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.45));
    ctx.fillRect(box.left + ts * 1.2, poleRootY - ts * 0.18, ts * 0.12, ts * 0.5);
    inkRect(ctx, box.left + ts * 1.2, poleRootY - ts * 0.18, ts * 0.12, ts * 0.5, ts);

    // Bed on two trestle legs.
    const bedY = b - ts * 0.9;
    const bedL = box.left + ts * 0.18;
    const bedR = box.right - ts * 0.18;
    for (const lx of [bedL + ts * 0.12, bedR - ts * 0.3]) {
      inkedStroke(
        ctx,
        lx,
        bedY + ts * 0.1,
        lx - ts * 0.1,
        b - ts * 0.06,
        ts * 0.09,
        sampleRamp(oldWood(), 0.4),
        sampleRamp(oldWood(), 0.7),
      );
      inkedStroke(
        ctx,
        lx + ts * 0.18,
        bedY + ts * 0.1,
        lx + ts * 0.28,
        b - ts * 0.06,
        ts * 0.09,
        sampleRamp(oldWood(), 0.4),
        sampleRamp(oldWood(), 0.7),
      );
    }
    paintBeam(ctx, bedL, bedY, bedR - bedL, ts * 0.14, ts * 0.1, oldWood(), ts, 0.45);

    // Poppets and the work between them.
    const poppetW = ts * 0.2;
    const poppetTop = bedY - ts * 0.48;
    const workY = bedY - ts * 0.3;
    const headX = bedL + ts * 0.34;
    const tailX = bedR - ts * 0.72;
    for (const px of [headX, tailX]) {
      ctx.fillStyle = rgb(sampleRamp(ELM, 0.5));
      ctx.fillRect(px, poppetTop, poppetW, bedY - poppetTop);
      ctx.fillStyle = rgb(sampleRamp(ELM, 0.82));
      ctx.fillRect(px, poppetTop, poppetW * 0.3, bedY - poppetTop);
      inkRect(ctx, px, poppetTop, poppetW, bedY - poppetTop, ts);
      ctx.fillStyle = rgb(sampleRamp(iron(), 0.7));
      ctx.beginPath();
      ctx.arc(px + poppetW / 2, workY, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    // The hub blank, turned smooth at one end and still rough at the other.
    const workL = headX + poppetW;
    const workR = tailX;
    const workR2 = ts * 0.17;
    const body = ctx.createLinearGradient(0, workY - workR2, 0, workY + workR2);
    body.addColorStop(0, rgb(sampleRamp(ELM, 0.95)));
    body.addColorStop(0.45, rgb(sampleRamp(ELM, 0.62)));
    body.addColorStop(1, rgb(sampleRamp(ELM, 0.3)));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(workL, workY - workR2 * 0.7);
    ctx.quadraticCurveTo((workL + workR) / 2, workY - workR2 * 1.3, workR, workY - workR2 * 0.7);
    ctx.lineTo(workR, workY + workR2 * 0.7);
    ctx.quadraticCurveTo((workL + workR) / 2, workY + workR2 * 1.3, workL, workY + workR2 * 0.7);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(TOWN_INK, 0.45);
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 5; i++) {
      const x = workL + ((workR - workL) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, workY - workR2 * 1.05);
      ctx.lineTo(x, workY + workR2 * 1.05);
      ctx.stroke();
    }
    // Cord: from the pole tip, twice round the work, down to the treadle.
    const cordX = (workL + workR) / 2 + ts * 0.1;
    const treadleX = cordX + ts * 0.05;
    ctx.strokeStyle = rgb(CORD);
    ctx.lineWidth = Math.max(1.5, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(poleTipX, poleTipY);
    ctx.lineTo(cordX, workY - workR2);
    ctx.moveTo(cordX + ts * 0.04, workY + workR2);
    ctx.lineTo(treadleX, b - ts * 0.2);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, ts * 0.035);
    ctx.beginPath();
    ctx.moveTo(cordX - ts * 0.03, workY - workR2 * 1.1);
    ctx.lineTo(cordX + ts * 0.06, workY + workR2 * 1.1);
    ctx.stroke();
    // Tool rest in front of the work, and a gouge lying on it.
    paintBeam(
      ctx,
      workL - ts * 0.04,
      workY + workR2 * 1.4,
      workR - workL + ts * 0.08,
      ts * 0.05,
      ts * 0.03,
      iron(),
      ts,
      0.5,
    );
    inkedStroke(
      ctx,
      workL + ts * 0.1,
      workY + workR2 * 1.3,
      workL + ts * 0.46,
      workY + workR2 * 1.3,
      ts * 0.035,
      sampleRamp(STEEL, 0.6),
      sampleRamp(STEEL, 0.95),
    );
    // Treadle board on the floor.
    paintBeam(
      ctx,
      bedL + ts * 0.5,
      b - ts * 0.24,
      ts * 1.3,
      ts * 0.06,
      ts * 0.08,
      oldWood(),
      ts,
      0.5,
    );
  });
}

// ── The timber bay rack ─────────────────────────────────────────────────────

function paintPlankStack(
  ctx: Ctx,
  left: number,
  right: number,
  baseY: number,
  count: number,
  ts: number,
  rng: Rng,
): void {
  const plankStep = ts * 0.1;
  for (let i = 0; i < count; i++) {
    const y = baseY - (i + 1) * plankStep;
    const x0 = left + rng() * ts * 0.25;
    const x1 = right - rng() * ts * 0.35;
    const tone = 0.5 + rng() * 0.3;
    const ramp = rng() < 0.3 ? oldWood() : NEW_WOOD;
    ctx.fillStyle = rgb(sampleRamp(ramp, tone));
    ctx.fillRect(x0, y, x1 - x0, plankStep);
    ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, tone + 0.28)));
    ctx.fillRect(x0, y, x1 - x0, Math.max(1.5, plankStep * 0.28));
    // The seam under each plank is soft, not inked: a stack reads as one mass.
    ctx.fillStyle = rgba(TOWN_INK, 0.3);
    ctx.fillRect(x0, y + plankStep - 1.5, x1 - x0, 1.5);
    ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.92));
    ctx.fillRect(x1 - ts * 0.05, y, ts * 0.05, plankStep - 1.5);
    ctx.strokeStyle = rgba(TOWN_INK, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0, y + plankStep);
    ctx.moveTo(x1, y);
    ctx.lineTo(x1, y + plankStep);
    ctx.stroke();
  }
}

/**
 * The stock bay's rack: three wall uprights with cantilever arms, planks
 * and poles laid on every arm up to the rafters, and on the floor in front a
 * stack of felloe blanks, a pyramid of spoke billets and an elm hub log.
 */
export function paintTimberRack(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    const backY = b - ts * 1.05;
    const rackTop = b - ts * 2.95;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.12, ts, 0.34);

    const uprightW = ts * 0.14;
    const uprightXs = [
      box.left + ts * 0.1,
      box.centreX - uprightW / 2,
      box.right - ts * 0.1 - uprightW,
    ];
    for (const ux of uprightXs) {
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.38));
      ctx.fillRect(ux, rackTop, uprightW, backY - rackTop);
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.66));
      ctx.fillRect(ux, rackTop, uprightW * 0.3, backY - rackTop);
      inkRect(ctx, ux, rackTop, uprightW, backY - rackTop, ts);
    }
    const plankRng = forkRng(rng);
    const armYs = [backY - ts * 0.1, backY - ts * 0.85, backY - ts * 1.55];
    const armCounts = [5, 4, 3];
    armYs.forEach((ay, level) => {
      paintBeam(
        ctx,
        box.left + ts * 0.04,
        ay,
        box.width - ts * 0.08,
        ts * 0.04,
        ts * 0.03,
        oldWood(),
        ts,
        0.3,
      );
      paintPlankStack(
        ctx,
        box.left + ts * 0.06,
        box.right - ts * 0.06,
        ay,
        armCounts[level],
        ts,
        plankRng,
      );
    });
    // Round poles on the top arm.
    const topArm = rackTop + ts * 0.15;
    paintBeam(
      ctx,
      box.left + ts * 0.04,
      topArm,
      box.width - ts * 0.08,
      ts * 0.04,
      ts * 0.03,
      oldWood(),
      ts,
      0.3,
    );
    for (let i = 0; i < 4; i++) {
      const py = topArm - ts * 0.07 - (i % 2) * ts * 0.1;
      const px0 = box.left + ts * (0.1 + (i % 2) * 0.3 + plankRng() * 0.2);
      const px1 = box.right - ts * (0.1 + plankRng() * 0.4);
      inkedStroke(
        ctx,
        px0,
        py,
        px1,
        py,
        ts * 0.08,
        sampleRamp(NEW_WOOD, 0.45),
        sampleRamp(NEW_WOOD, 0.85),
      );
    }

    // Floor stock in front: felloe blanks (west), spoke billets (middle), a hub log (east).
    const floorY = b - ts * 0.08;
    for (let i = 0; i < 4; i++) {
      const fx = box.left + ts * 0.7;
      const fy = floorY - i * ts * 0.12;
      ctx.strokeStyle = rgba(TOWN_INK, 0.85);
      ctx.lineWidth = ts * 0.12 + 2;
      ctx.beginPath();
      ctx.arc(fx, fy + ts * 0.62, ts * 0.62, Math.PI * 1.25, Math.PI * 1.75);
      ctx.stroke();
      ctx.strokeStyle = rgb(sampleRamp(NEW_WOOD, 0.5 + (i % 2) * 0.2));
      ctx.lineWidth = ts * 0.12;
      ctx.stroke();
      ctx.strokeStyle = rgb(sampleRamp(NEW_WOOD, 0.92));
      ctx.lineWidth = Math.max(1, ts * 0.025);
      ctx.beginPath();
      ctx.arc(fx, fy + ts * 0.62, ts * 0.67, Math.PI * 1.27, Math.PI * 1.73);
      ctx.stroke();
    }
    const billetSize = ts * 0.13;
    const billetRows = [5, 4, 3, 2];
    const billetL = box.left + ts * 1.5;
    billetRows.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        const bx = billetL + (i + row * 0.5) * billetSize;
        const by = floorY - (row + 1) * billetSize;
        ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.72 + ((i + row) % 2) * 0.12));
        ctx.fillRect(bx, by, billetSize, billetSize);
        ctx.strokeStyle = rgba(sampleRamp(NEW_WOOD, 0.3), 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx + billetSize * 0.2, by + billetSize * 0.8, billetSize * 0.4, -Math.PI / 2, 0);
        ctx.stroke();
        inkRect(ctx, bx, by, billetSize, billetSize, ts);
      }
    });
    const logR = ts * 0.34;
    const logX = box.right - ts * 0.55;
    const logY = floorY - logR;
    ctx.fillStyle = rgb(BARK);
    ctx.beginPath();
    ctx.ellipse(logX - ts * 0.08, logY, logR * 0.7, logR, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.82));
    ctx.beginPath();
    ctx.ellipse(logX, logY, logR * 0.64, logR * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(sampleRamp(ELM, 0.3), 0.7);
    ctx.lineWidth = 1.5;
    for (const k of [0.3, 0.55, 0.8]) {
      ctx.beginPath();
      ctx.ellipse(logX, logY, logR * 0.64 * k, logR * 0.92 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Chalked mark on the log: the hub it is promised to.
    ctx.strokeStyle = rgba([236, 232, 220], 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(logX - logR * 0.25, logY - logR * 0.2);
    ctx.lineTo(logX + logR * 0.25, logY + logR * 0.2);
    ctx.moveTo(logX + logR * 0.25, logY - logR * 0.2);
    ctx.lineTo(logX - logR * 0.25, logY + logR * 0.2);
    ctx.stroke();
  });
}

// ── Sawhorse, shaving horse ─────────────────────────────────────────────────

function paintTrestle(ctx: Ctx, cx: number, topY: number, footY: number, ts: number): void {
  const spread = ts * 0.22;
  const body = sampleRamp(oldWood(), 0.42);
  const lit = sampleRamp(oldWood(), 0.72);
  inkedStroke(ctx, cx - ts * 0.04, topY, cx - spread, footY, ts * 0.07, body, lit);
  inkedStroke(ctx, cx + ts * 0.04, topY, cx + spread, footY, ts * 0.07, body, lit);
  inkedStroke(
    ctx,
    cx - spread * 0.55,
    (topY + footY) / 2 + ts * 0.06,
    cx + spread * 0.55,
    (topY + footY) / 2 + ts * 0.06,
    ts * 0.04,
    body,
    lit,
  );
}

/** Two trestles with a long plank across them, a bow saw left standing in a half-finished cut above a heap of sawdust. */
export function paintSawhorse(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.14, ts, 0.3);
    const cutX = box.left + ts * 1.25;
    const dust = ctx.createRadialGradient(cutX, b - ts * 0.18, 0, cutX, b - ts * 0.18, ts * 0.34);
    dust.addColorStop(0, rgba(SAWDUST, 0.9));
    dust.addColorStop(1, rgba(SAWDUST, 0));
    ctx.fillStyle = dust;
    ctx.beginPath();
    ctx.ellipse(cutX, b - ts * 0.18, ts * 0.34, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    const topY = b - ts * 0.58;
    const footY = b - ts * 0.08;
    paintTrestle(ctx, box.left + ts * 0.4, topY, footY, ts);
    paintTrestle(ctx, box.right - ts * 0.4, topY, footY, ts);
    const plankTop = topY - ts * 0.16;
    ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.82));
    ctx.fillRect(box.left + ts * 0.04, plankTop, box.width - ts * 0.08, ts * 0.1);
    ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.52));
    ctx.fillRect(box.left + ts * 0.04, plankTop + ts * 0.1, box.width - ts * 0.08, ts * 0.08);
    inkRect(ctx, box.left + ts * 0.04, plankTop, box.width - ts * 0.08, ts * 0.18, ts);
    // The kerf, and the saw standing in it.
    ctx.fillStyle = rgb(TOWN_INK);
    ctx.fillRect(cutX - 1, plankTop, 2.5, ts * 0.12);
    paintBowSaw(ctx, cutX - ts * 0.3, plankTop - ts * 0.5, ts * 0.6, ts * 0.52, ts);
    const curlRng = forkRng(rng);
    for (let i = 0; i < 3; i++)
      paintCurl(ctx, box.left + ts * (0.3 + curlRng() * 1.4), b - ts * 0.1, ts * 0.05, curlRng, ts);
  });
}

/**
 * A shaving horse: a low bench the wheelwright sits astride, a sloped
 * bridge in front of him and a foot-worked clamp head pinning a spoke blank
 * to it, with the drawknife laid across the blank and its shavings below.
 */
export function paintShavingHorse(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.14, ts, 0.3);
    paintShavingDrift(
      ctx,
      box.left + ts * 0.8,
      b - ts * 0.34,
      ts * 1.1,
      ts * 0.3,
      7,
      forkRng(rng),
      ts,
    );
    const benchY = b - ts * 0.5;
    const body = sampleRamp(oldWood(), 0.4);
    const lit = sampleRamp(oldWood(), 0.72);
    for (const lx of [
      box.left + ts * 0.2,
      box.left + ts * 0.5,
      box.right - ts * 0.5,
      box.right - ts * 0.2,
    ]) {
      inkedStroke(
        ctx,
        lx,
        benchY + ts * 0.08,
        lx + (lx < box.centreX ? -ts * 0.08 : ts * 0.08),
        b - ts * 0.06,
        ts * 0.06,
        body,
        lit,
      );
    }
    paintBeam(
      ctx,
      box.left + ts * 0.08,
      benchY,
      box.width - ts * 0.16,
      ts * 0.1,
      ts * 0.08,
      oldWood(),
      ts,
      0.48,
    );
    // Sloped bridge, raised at its east end.
    ctx.fillStyle = rgb(sampleRamp(NEW_WOOD, 0.6));
    ctx.beginPath();
    ctx.moveTo(box.left + ts * 0.8, benchY);
    ctx.lineTo(box.right - ts * 0.12, benchY - ts * 0.26);
    ctx.lineTo(box.right - ts * 0.12, benchY - ts * 0.16);
    ctx.lineTo(box.left + ts * 0.8, benchY + ts * 0.06);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    // The spoke blank pinned on the bridge.
    inkedStroke(
      ctx,
      box.left + ts * 0.95,
      benchY - ts * 0.06,
      box.right - ts * 0.3,
      benchY - ts * 0.3,
      ts * 0.07,
      sampleRamp(NEW_WOOD, 0.75),
      sampleRamp(NEW_WOOD, 1),
    );
    // The clamp: an upright frame through the bench with a head across the blank.
    const clampX = box.right - ts * 0.62;
    const clampTop = benchY - ts * 0.55;
    ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.5));
    ctx.fillRect(clampX - ts * 0.04, clampTop, ts * 0.08, b - clampTop - ts * 0.1);
    inkRect(ctx, clampX - ts * 0.04, clampTop, ts * 0.08, b - clampTop - ts * 0.1, ts);
    paintBeam(ctx, clampX - ts * 0.18, clampTop, ts * 0.36, ts * 0.08, ts * 0.05, ELM, ts, 0.5);
    paintBeam(
      ctx,
      clampX - ts * 0.2,
      b - ts * 0.22,
      ts * 0.4,
      ts * 0.05,
      ts * 0.04,
      oldWood(),
      ts,
      0.5,
    );
    // The drawknife across the blank: a blade with a handle at each end.
    const knifeY = benchY - ts * 0.34;
    const knifeL = box.left + ts * 0.9;
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.7));
    ctx.fillRect(knifeL, knifeY, ts * 0.5, ts * 0.06);
    inkRect(ctx, knifeL, knifeY, ts * 0.5, ts * 0.06, ts);
    for (const hx of [knifeL - ts * 0.05, knifeL + ts * 0.5]) {
      ctx.fillStyle = rgb(sampleRamp(ELM, 0.6));
      ctx.fillRect(hx, knifeY - ts * 0.1, ts * 0.06, ts * 0.18);
      inkRect(ctx, hx, knifeY - ts * 0.1, ts * 0.06, ts * 0.18, ts);
    }
  });
}

// ── Firewood, the spoke tub, the glue pot, the shavings floor ───────────────

function paintSplitLog(ctx: Ctx, x: number, y: number, r: number, rng: Rng, ts: number): void {
  // A log end: a bark ring round a pale sawn face, growth rings, and the
  // split check a log opens along as it dries.
  const rr = r * (0.88 + rng() * 0.18);
  ctx.fillStyle = rgb(BARK);
  ctx.beginPath();
  ctx.ellipse(x, y, rr, rr * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgb(mix(SHAVING_MID, SHAVING_LIGHT, rng()));
  ctx.beginPath();
  ctx.ellipse(x, y, rr * 0.8, rr * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(sampleRamp(NEW_WOOD, 1), 0.5);
  ctx.beginPath();
  ctx.ellipse(x - rr * 0.2, y - rr * 0.2, rr * 0.35, rr * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(sampleRamp(NEW_WOOD, 0.25), 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, rr * 0.45, rr * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  const check = rng() * Math.PI * 2;
  ctx.strokeStyle = rgba(TOWN_INK, 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(check) * rr * 0.78, y + Math.sin(check) * rr * 0.72);
  ctx.stroke();
}

/** Offcuts split and stacked for sale between two end posts, a chopping block with the axe left in it beside the stack. */
export function paintFirewoodStack(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.12, ts, 0.36);
    const stackL = box.left + ts * 0.14;
    const stackR = box.right - ts * 0.86;
    const stackTop = b - ts * 1.25;
    // The dark gaps between logs, so the stack reads as a solid mass of ends.
    ctx.fillStyle = rgb([52, 36, 26]);
    ctx.fillRect(stackL, stackTop, stackR - stackL, b - ts * 0.08 - stackTop);
    const logRng = forkRng(rng);
    const r = ts * 0.17;
    for (let row = 0; row < 4; row++) {
      const y = b - ts * 0.24 - row * r * 1.72;
      const offset = (row % 2) * r;
      for (let x = stackL + r + offset; x < stackR - r * 0.5; x += r * 1.95) {
        paintSplitLog(ctx, x, y, r, logRng, ts);
      }
    }
    for (const px of [stackL - ts * 0.06, stackR - ts * 0.04]) {
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.45));
      ctx.fillRect(px, stackTop - ts * 0.1, ts * 0.1, b - stackTop + ts * 0.04);
      ctx.fillStyle = rgb(sampleRamp(oldWood(), 0.75));
      ctx.fillRect(px, stackTop - ts * 0.1, ts * 0.03, b - stackTop + ts * 0.04);
      inkRect(ctx, px, stackTop - ts * 0.1, ts * 0.1, b - stackTop + ts * 0.02, ts);
    }
    // Chopping block and axe.
    const blockX = box.right - ts * 0.72;
    const blockW = ts * 0.56;
    const blockTop = b - ts * 0.5;
    ctx.fillStyle = rgb(BARK);
    ctx.fillRect(blockX, blockTop, blockW, b - ts * 0.06 - blockTop);
    inkRect(ctx, blockX, blockTop, blockW, b - ts * 0.06 - blockTop, ts);
    ctx.fillStyle = rgb(sampleRamp(ELM, 0.85));
    ctx.beginPath();
    ctx.ellipse(blockX + blockW / 2, blockTop, blockW / 2, ts * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    inkedStroke(
      ctx,
      blockX + blockW * 0.45,
      blockTop - ts * 0.02,
      blockX + blockW * 0.95,
      blockTop - ts * 0.5,
      ts * 0.05,
      sampleRamp(NEW_WOOD, 0.55),
      sampleRamp(NEW_WOOD, 0.9),
    );
    ctx.fillStyle = rgb(sampleRamp(STEEL, 0.55));
    ctx.beginPath();
    ctx.moveTo(blockX + blockW * 0.3, blockTop - ts * 0.02);
    ctx.lineTo(blockX + blockW * 0.6, blockTop - ts * 0.02);
    ctx.lineTo(blockX + blockW * 0.58, blockTop - ts * 0.16);
    ctx.lineTo(blockX + blockW * 0.36, blockTop - ts * 0.14);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
  });
}

/** A cut-down cask holding a bundle of dressed spokes, tied at the waist, their tenons standing up. */
export function paintSpokeTub(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    drawTownContactShadow(ctx, box.centreX, b - ts * 0.1, ts * 0.36, ts * 0.1, 0.36);
    const tubTop = b - ts * 0.42;
    const tubL = box.left + ts * 0.16;
    const tubW = box.width - ts * 0.32;
    // Spokes behind the tub's near rim.
    const spokeRng = forkRng(rng);
    const count = 9;
    for (let i = 0; i < count; i++) {
      const sx = tubL + tubW * (0.12 + (0.76 * i) / (count - 1));
      const lean = (i - (count - 1) / 2) * ts * 0.025;
      const top = tubTop - ts * (0.62 + spokeRng() * 0.12);
      inkedStroke(
        ctx,
        sx,
        tubTop + ts * 0.05,
        sx + lean,
        top,
        ts * 0.06,
        sampleRamp(NEW_WOOD, 0.6),
        sampleRamp(NEW_WOOD, 0.95),
      );
    }
    // The twine at the waist of the bundle.
    ctx.strokeStyle = rgb(CORD);
    ctx.lineWidth = Math.max(2, ts * 0.035);
    ctx.beginPath();
    ctx.moveTo(tubL + tubW * 0.08, tubTop - ts * 0.3);
    ctx.lineTo(tubL + tubW * 0.92, tubTop - ts * 0.3);
    ctx.stroke();
    // The tub.
    const tub = ctx.createLinearGradient(tubL, 0, tubL + tubW, 0);
    tub.addColorStop(0, rgb(sampleRamp(oldWood(), 0.72)));
    tub.addColorStop(0.5, rgb(sampleRamp(oldWood(), 0.5)));
    tub.addColorStop(1, rgb(sampleRamp(oldWood(), 0.28)));
    ctx.fillStyle = tub;
    ctx.fillRect(tubL, tubTop, tubW, b - ts * 0.06 - tubTop);
    for (const hy of [tubTop + ts * 0.06, b - ts * 0.16]) {
      ctx.fillStyle = rgb(sampleRamp(iron(), 0.5));
      ctx.fillRect(tubL, hy, tubW, ts * 0.05);
    }
    inkRect(ctx, tubL, tubTop, tubW, b - ts * 0.06 - tubTop, ts);
  });
}

/** An iron pot of hide glue on a small tripod brazier, coals glowing under it and the brush left standing in the glue. */
export function paintGluePot(ctx: Ctx, frame: TownPropFrame, _variant: number, _rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    drawTownContactShadow(ctx, box.centreX, b - ts * 0.1, ts * 0.32, ts * 0.1, 0.36);
    const glow = ctx.createRadialGradient(
      box.centreX,
      b - ts * 0.22,
      0,
      box.centreX,
      b - ts * 0.22,
      ts * 0.42,
    );
    glow.addColorStop(0, rgba(EMBER_MID, 0.35));
    glow.addColorStop(1, rgba(EMBER_MID, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(box.left, b - ts * 0.7, box.width, ts * 0.7);
    const legBody = sampleRamp(iron(), 0.45);
    const legLit = sampleRamp(iron(), 0.8);
    inkedStroke(
      ctx,
      box.centreX - ts * 0.18,
      b - ts * 0.4,
      box.centreX - ts * 0.3,
      b - ts * 0.06,
      ts * 0.04,
      legBody,
      legLit,
    );
    inkedStroke(
      ctx,
      box.centreX + ts * 0.18,
      b - ts * 0.4,
      box.centreX + ts * 0.3,
      b - ts * 0.06,
      ts * 0.04,
      legBody,
      legLit,
    );
    // The fire bowl with its coals.
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.4));
    ctx.beginPath();
    ctx.ellipse(box.centreX, b - ts * 0.38, ts * 0.26, ts * 0.1, 0, 0, Math.PI);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(EMBER_CORE);
    ctx.beginPath();
    ctx.ellipse(box.centreX, b - ts * 0.38, ts * 0.2, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // The pot.
    const potTop = b - ts * 0.78;
    const potW = ts * 0.4;
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.5));
    ctx.beginPath();
    ctx.moveTo(box.centreX - potW / 2, potTop);
    ctx.lineTo(box.centreX + potW / 2, potTop);
    ctx.quadraticCurveTo(box.centreX + potW * 0.55, b - ts * 0.4, box.centreX, b - ts * 0.42);
    ctx.quadraticCurveTo(box.centreX - potW * 0.55, b - ts * 0.4, box.centreX - potW / 2, potTop);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.85));
    ctx.fillRect(box.centreX - potW * 0.36, potTop + ts * 0.05, ts * 0.04, ts * 0.18);
    ctx.fillStyle = rgb(GLUE);
    ctx.beginPath();
    ctx.ellipse(box.centreX, potTop, potW / 2, ts * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(GLUE_LIGHT);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX - ts * 0.06,
      potTop - ts * 0.015,
      potW * 0.2,
      ts * 0.025,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // The brush.
    inkedStroke(
      ctx,
      box.centreX + ts * 0.06,
      potTop,
      box.centreX + ts * 0.2,
      potTop - ts * 0.34,
      ts * 0.04,
      sampleRamp(NEW_WOOD, 0.55),
      sampleRamp(NEW_WOOD, 0.9),
    );
    // Steam.
    ctx.strokeStyle = rgba([236, 232, 224], 0.45);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.08, potTop - ts * 0.08);
    ctx.bezierCurveTo(
      box.centreX - ts * 0.2,
      potTop - ts * 0.24,
      box.centreX + ts * 0.02,
      potTop - ts * 0.34,
      box.centreX - ts * 0.1,
      potTop - ts * 0.5,
    );
    ctx.stroke();
  });
}

/**
 * Shavings and sawdust lying on the boards where the work happens — flat,
 * walkable, drawn with the floor. Low contrast on purpose: a dirty floor is
 * a tonal wash with a scatter of curls, not a pattern to read.
 */
export function paintShavingsFloor(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const inset = ts * 0.12;
    paintShavingDrift(
      ctx,
      box.left + inset,
      box.top + inset,
      box.width - inset * 2,
      box.height - inset * 2,
      Math.round((box.width * box.height) / (ts * ts)) * 5,
      forkRng(rng),
      ts,
    );
  });
}

// ── A new axle, wheels hung on it ───────────────────────────────────────────

/**
 * A cart's axle set up on trestles to be trued: a squared oak axletree with
 * its iron arms, a finished wheel hung on each end (seen near edge-on, the
 * way an axle's wheels are from beside the cart), and the bolster block
 * waiting to go on top.
 */
export function paintAxleSet(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.14, ts, 0.34);
    const axleY = b - ts * 0.66;
    const wheelR = ts * 0.58;
    const wheelXs = [box.left + ts * 0.3, box.right - ts * 0.3];
    // The far wheel sits behind the axletree, the near one in front of it.
    const wheel = (cx: number): void =>
      paintWheel(
        ctx,
        {
          cx,
          cy: axleY,
          r: wheelR,
          spokes: 12,
          rimFraction: 1,
          rimStart: 0,
          tyre: true,
          felloe: NEW_WOOD,
          spoke: NEW_WOOD,
          hub: ELM,
          squash: 0.36,
          tilt: 0,
        },
        ts,
      );
    wheel(wheelXs[0]);
    for (const tx of [box.left + ts * 0.95, box.right - ts * 0.95]) {
      paintTrestle(ctx, tx, axleY + ts * 0.1, b - ts * 0.06, ts);
    }
    // Iron arms through both hubs.
    ctx.fillStyle = rgb(sampleRamp(iron(), 0.55));
    ctx.fillRect(wheelXs[0], axleY - ts * 0.04, wheelXs[1] - wheelXs[0], ts * 0.08);
    inkRect(ctx, wheelXs[0], axleY - ts * 0.04, wheelXs[1] - wheelXs[0], ts * 0.08, ts);
    const treeL = box.left + ts * 0.5;
    const treeR = box.right - ts * 0.5;
    paintBeam(ctx, treeL, axleY - ts * 0.12, treeR - treeL, ts * 0.14, ts * 0.1, ELM, ts, 0.5);
    // Bolster block and a clip bolt either end of it.
    const bolsterW = ts * 0.6;
    paintBeam(
      ctx,
      box.centreX - bolsterW / 2,
      axleY - ts * 0.3,
      bolsterW,
      ts * 0.1,
      ts * 0.08,
      NEW_WOOD,
      ts,
      0.5,
    );
    for (const side of [-1, 1]) {
      ctx.fillStyle = rgb(sampleRamp(iron(), 0.6));
      ctx.fillRect(
        box.centreX + side * bolsterW * 0.38 - ts * 0.02,
        axleY - ts * 0.32,
        ts * 0.04,
        ts * 0.36,
      );
    }
    // Chalked centre mark on the axletree.
    ctx.fillStyle = rgba([236, 232, 220], 0.85);
    ctx.fillRect(box.centreX - 1, axleY - ts * 0.02, 2.5, ts * 0.12);
    wheel(wheelXs[1]);
    const curlRng = forkRng(rng);
    for (let i = 0; i < 4; i++) {
      paintCurl(
        ctx,
        box.left + ts * (0.7 + curlRng() * 1.6),
        b - ts * (0.08 + curlRng() * 0.1),
        ts * 0.06,
        curlRng,
        ts,
      );
    }
  });
}

/** Sawn boards stacked on bearers to season, a couple of offcuts leaning on the end of the pile. */
export function paintPlankPile(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const b = box.bottom;
    bandShadow(ctx, box.left + ts * 0.1, box.right - ts * 0.1, b - ts * 0.14, ts, 0.36);
    for (const bx of [box.left + ts * 0.3, box.right - ts * 0.5]) {
      paintBeam(ctx, bx, b - ts * 0.22, ts * 0.2, ts * 0.1, ts * 0.06, oldWood(), ts, 0.35);
    }
    paintPlankStack(
      ctx,
      box.left + ts * 0.08,
      box.right - ts * 0.26,
      b - ts * 0.2,
      7,
      ts,
      forkRng(rng),
    );
    const body = sampleRamp(NEW_WOOD, 0.55);
    const lit = sampleRamp(NEW_WOOD, 0.9);
    inkedStroke(
      ctx,
      box.right - ts * 0.2,
      b - ts * 0.08,
      box.right - ts * 0.12,
      b - ts * 0.95,
      ts * 0.08,
      body,
      lit,
    );
    inkedStroke(
      ctx,
      box.right - ts * 0.1,
      b - ts * 0.08,
      box.right - ts * 0.06,
      b - ts * 0.78,
      ts * 0.06,
      body,
      lit,
    );
  });
}
