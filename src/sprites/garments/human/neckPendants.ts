/**
 * What the human crawler hangs round his neck: the Stoneheart Amulet on its
 * leather thong, and the Sun and Moon Lockets on their chains. At the tile a
 * pendant is two or three pixels on his upper chest, so what reads is a bright
 * (or, for the stone, rough grey) blob ringed in a dark edge against any shirt,
 * with the line of the cord or chain running up to either side of his neck.
 *
 * Every pendant is painted on the torso's `collarRim`, the last torso piece,
 * so it lies over whatever torso garment he wears on any layer, hood and
 * collar included.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { pt } from '../../art/biped/geometry';
import { NECK_WIDTH } from '../../art/biped/proportions';
import type { ViewSpec } from '../../art/biped/rig';
import type { TorsoFrame } from '../../art/biped/torso';
import type { Pt } from '../../art/bipedArt';
import { withClip } from '../../art/softShade';
import { defineGarment, type GarmentMaterial, type WornGarmentDef } from '../garmentDef';
import { strokeLine, tracePolygon } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** A cord's colours: a dark line under it, so it shows as a line on light cloth and dark alike. */
interface CordLook {
  readonly colour: string;
  readonly under: string;
  readonly width: number;
}

/** How a pendant hangs from its cord and what hangs there, painted centred on `centre`. */
interface PendantLook {
  readonly cord: CordLook;
  /** How far above the pendant's centre the cord meets it. */
  readonly bailRise: number;
  /** Edge-on, how far the pendant stands from its centre toward his front. */
  readonly profileHalfDepth: number;
  readonly paintFacing: (ctx: Ctx, torso: TorsoFrame, centre: Pt) => void;
  /** Edge-on the pendant is seen side-on, hanging against the front of his chest. */
  readonly paintProfile: (ctx: Ctx, torso: TorsoFrame, centre: Pt) => void;
}

const TWO_PI = Math.PI * 2;
/** The torso frame's spine angle is measured from +x; an upright spine points down, a quarter turn. */
const SPINE_UPRIGHT = Math.PI / 2;
/** The dark under-line of a cord stands this much wider than the cord on it. */
const CORD_UNDER_SHARE = 1.7;

/** Head-on the cord leaves either side of his neck at its base. */
const NECK_SIDE_SHARE = 1.05;
const CORD_NECK_Y = -0.035;
/** The cord falls straight off the neck before it bends in to the pendant, as a weighted loop does. */
const CORD_BEND_SHARE = 0.55;
/** The pendant sits on his upper chest head-on, below the collar and above the pecs' fullest line. */
const FACING_PENDANT_Y = 0.125;

/** Edge-on the cord runs from the back of his neck forward over its side to the pendant. */
const PROFILE_NAPE = pt(-0.09, -0.055);
const PROFILE_CORD_CONTROL = pt(0.12, -0.015);
/**
 * Edge-on the pendant hangs where the pec swells out under the collarbone,
 * its front edge standing just off his chest. A heavy man's near arm reaches
 * almost to his chest front edge-on, so the pendant stands as far forward as
 * the torso envelope's margin allows, to keep it clear of the arm.
 */
const PROFILE_PENDANT_Y = 0.1;
/** The front of his chest at that height, on the rig's own depth (where `traceProfile` swells round the pec). */
const PROFILE_CHEST_FRONT_X = 0.288;
/** Inside the torso envelope's margin by a hair, so antialiasing at its edge stays inside it too. */
const PROFILE_PENDANT_STANDOUT = 0.042;

/** From behind the cord crosses his nape, sagging a touch at the middle. */
const BACK_CORD_Y = -0.045;
const BACK_CORD_SAG = 0.012;

const LOCKET_RADIUS = 0.07;
const LOCKET_RIM_WIDTH = 0.026;
/** Edge-on a locket is a thin oval: its depth against its face. */
const LOCKET_EDGE_SHARE = 0.6;
/** The light falls from above his right as drawn: where the lid's glint sits on it. */
const LOCKET_GLINT_OFFSET = pt(-0.28, -0.32);
const LOCKET_GLINT_SHARE = 0.3;
const LOCKET_CHAIN_WIDTH = 0.016;

/** The sunburst: a bright boss at the lid's centre and rays from it nearly to the rim. */
const SUN_BOSS_SHARE = 0.36;
const SUN_RAY_COUNT = 8;
const SUN_RAY_FROM_SHARE = 0.45;
const SUN_RAY_TO_SHARE = 0.82;
const SUN_RAY_WIDTH = 0.014;

/** The crescent, engraved dark into the bright lid: a disc with a second, offset disc of the lid's metal biting into it. */
const CRESCENT_DISC_SHARE = 0.68;
const CRESCENT_DISC_OFFSET = pt(-0.1, 0);
const CRESCENT_BITE_SHARE = 0.6;
const CRESCENT_BITE_OFFSET = pt(0.32, -0.12);

interface MetalLook {
  readonly deep: string;
  readonly mid: string;
  readonly light: string;
  readonly glint: string;
}

const GOLD: MetalLook = { deep: '#4a300a', mid: '#c89128', light: '#f6d66c', glint: '#fff6cf' };
const SILVER: MetalLook = { deep: '#1b1f27', mid: '#cdd4dc', light: '#e8edf3', glint: '#ffffff' };

const STONE_DEEP = '#24221f';
const STONE_MID = '#86817a';
const STONE_LIGHT = '#dedad0';
const STONE_EMBER = '#b3301a';
const STONE_EMBER_CORE = '#ff8a4a';
const LEATHER_THONG: CordLook = { colour: '#b07a45', under: '#1c1008', width: 0.022 };

const STONE_WIDEST_X = 0.09;
/** A fist-sized lump: wider than the lockets, and rough, a handful of corners rather than a disc. */
const STONE_OUTLINE: readonly Pt[] = [
  pt(-0.06, -0.068),
  pt(0.02, -0.08),
  pt(0.075, -0.045),
  pt(0.088, 0.018),
  pt(0.05, 0.074),
  pt(-0.025, 0.082),
  pt(-0.08, 0.04),
  pt(-STONE_WIDEST_X, -0.02),
];
const STONE_RIM_WIDTH = 0.032;
/** The lit facet across the lump's upper corner, toward the light. */
const STONE_FACET: readonly Pt[] = [
  pt(-0.055, -0.058),
  pt(0.02, -0.068),
  pt(0.03, -0.01),
  pt(-0.06, 0.0),
];
/** The warm crack through it: a dull ember, so it reads as stone glowing, not a painted emblem. */
const STONE_CRACK: readonly Pt[] = [pt(0.03, -0.035), pt(0.005, 0.0), pt(0.02, 0.035)];
const STONE_CRACK_WIDTH = 0.012;
const STONE_CRACK_CORE_WIDTH = 0.007;
const STONE_BAIL_RISE = 0.072;
/** Edge-on the lump is a little shallower than it is wide, a flattened pebble. */
const STONE_EDGE_SHARE = 0.65;

/** A frame-space point a torso-local offset from `centre`, carried by the spine's tilt. */
function offsetFrom(torso: TorsoFrame, centre: Pt, offset: Pt): Pt {
  const origin = torso.at(0, 0);
  const moved = torso.at(offset.x, offset.y);
  return pt(centre.x + moved.x - origin.x, centre.y + moved.y - origin.y);
}

/** Traces an oval `across` wide and `along` tall, its height laid down the spine. */
function traceOval(ctx: Ctx, torso: TorsoFrame, centre: Pt, across: number, along: number): void {
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, across, along, torso.angle - SPINE_UPRIGHT, 0, TWO_PI);
}

function traceDisc(ctx: Ctx, torso: TorsoFrame, centre: Pt, radius: number): void {
  traceOval(ctx, torso, centre, radius, radius);
}

function fillDisc(ctx: Ctx, torso: TorsoFrame, centre: Pt, radius: number, colour: string): void {
  traceDisc(ctx, torso, centre, radius);
  ctx.fillStyle = colour;
  ctx.fill();
}

function strokeCord(ctx: Ctx, cord: CordLook, trace: () => void): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  trace();
  ctx.strokeStyle = cord.under;
  ctx.lineWidth = cord.width * CORD_UNDER_SHARE;
  ctx.stroke();
  trace();
  ctx.strokeStyle = cord.colour;
  ctx.lineWidth = cord.width;
  ctx.stroke();
}

function paintFacingCord(
  ctx: Ctx,
  torso: TorsoFrame,
  view: ViewSpec,
  cord: CordLook,
  bail: Pt,
): void {
  const neckHalf = NECK_WIDTH * view.girth * NECK_SIDE_SHARE;
  for (const side of [-1, 1]) {
    const neck = torso.at(side * neckHalf, CORD_NECK_Y);
    const bend = torso.at(side * neckHalf * CORD_BEND_SHARE, torso.downOf(bail));
    strokeCord(ctx, cord, () => {
      ctx.beginPath();
      ctx.moveTo(neck.x, neck.y);
      ctx.quadraticCurveTo(bend.x, bend.y, bail.x, bail.y);
    });
  }
}

function paintProfileCord(ctx: Ctx, torso: TorsoFrame, cord: CordLook, bail: Pt): void {
  const depth = torso.cut.profileDepth;
  const nape = torso.at(PROFILE_NAPE.x * depth, PROFILE_NAPE.y);
  const control = torso.at(PROFILE_CORD_CONTROL.x * depth, PROFILE_CORD_CONTROL.y);
  strokeCord(ctx, cord, () => {
    ctx.beginPath();
    ctx.moveTo(nape.x, nape.y);
    ctx.quadraticCurveTo(control.x, control.y, bail.x, bail.y);
  });
}

function paintBackCord(ctx: Ctx, torso: TorsoFrame, view: ViewSpec, cord: CordLook): void {
  const neckHalf = NECK_WIDTH * view.girth * NECK_SIDE_SHARE;
  const left = torso.at(-neckHalf, BACK_CORD_Y);
  const right = torso.at(neckHalf, BACK_CORD_Y);
  const sag = torso.at(0, BACK_CORD_Y + BACK_CORD_SAG * 2);
  strokeCord(ctx, cord, () => {
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(sag.x, sag.y, right.x, right.y);
  });
}

function paintPendant(ctx: Ctx, frame: BipedTorsoFrame, look: PendantLook): void {
  const { torso, view } = frame;
  if (view.showsBack && !view.profile) {
    paintBackCord(ctx, torso, view, look.cord);
    return;
  }
  if (view.profile) {
    const depth = torso.cut.profileDepth;
    const front = PROFILE_CHEST_FRONT_X * depth + PROFILE_PENDANT_STANDOUT;
    const centreX = front - look.profileHalfDepth;
    const centre = torso.at(centreX, PROFILE_PENDANT_Y);
    const bail = torso.at(centreX, PROFILE_PENDANT_Y - look.bailRise);
    paintProfileCord(ctx, torso, look.cord, bail);
    look.paintProfile(ctx, torso, centre);
    return;
  }
  const centre = torso.at(0, FACING_PENDANT_Y);
  const bail = torso.at(0, FACING_PENDANT_Y - look.bailRise);
  paintFacingCord(ctx, torso, view, look.cord, bail);
  look.paintFacing(ctx, torso, centre);
}

// ── Lockets ──────────────────────────────────────────────────────────────────

type LocketEmblem = (ctx: Ctx, torso: TorsoFrame, centre: Pt, metal: MetalLook) => void;

function paintSunburst(ctx: Ctx, torso: TorsoFrame, centre: Pt, metal: MetalLook): void {
  const { x: cx, y: cy } = centre;
  for (let ray = 0; ray < SUN_RAY_COUNT; ray++) {
    const angle = (ray / SUN_RAY_COUNT) * TWO_PI;
    const from = pt(
      cx + Math.cos(angle) * LOCKET_RADIUS * SUN_RAY_FROM_SHARE,
      cy + Math.sin(angle) * LOCKET_RADIUS * SUN_RAY_FROM_SHARE,
    );
    const to = pt(
      cx + Math.cos(angle) * LOCKET_RADIUS * SUN_RAY_TO_SHARE,
      cy + Math.sin(angle) * LOCKET_RADIUS * SUN_RAY_TO_SHARE,
    );
    strokeLine(ctx, [from, to], metal.light, SUN_RAY_WIDTH);
  }
  fillDisc(ctx, torso, centre, LOCKET_RADIUS * SUN_BOSS_SHARE, metal.glint);
}

function paintCrescent(ctx: Ctx, torso: TorsoFrame, centre: Pt, metal: MetalLook): void {
  const disc = offsetFrom(torso, centre, scaled(CRESCENT_DISC_OFFSET, LOCKET_RADIUS));
  const bite = offsetFrom(torso, centre, scaled(CRESCENT_BITE_OFFSET, LOCKET_RADIUS));
  withClip(
    ctx,
    () => traceDisc(ctx, torso, disc, LOCKET_RADIUS * CRESCENT_DISC_SHARE),
    () => {
      fillDisc(ctx, torso, disc, LOCKET_RADIUS * CRESCENT_DISC_SHARE, metal.deep);
      fillDisc(ctx, torso, bite, LOCKET_RADIUS * CRESCENT_BITE_SHARE, metal.mid);
    },
  );
}

function scaled(share: Pt, by: number): Pt {
  return pt(share.x * by, share.y * by);
}

function locketLook(metal: MetalLook, emblem: LocketEmblem): PendantLook {
  return {
    cord: { colour: metal.light, under: metal.deep, width: LOCKET_CHAIN_WIDTH },
    bailRise: LOCKET_RADIUS,
    profileHalfDepth: LOCKET_RADIUS * LOCKET_EDGE_SHARE + LOCKET_RIM_WIDTH,
    paintFacing: (ctx, torso, centre) => {
      fillDisc(ctx, torso, centre, LOCKET_RADIUS + LOCKET_RIM_WIDTH, metal.deep);
      fillDisc(ctx, torso, centre, LOCKET_RADIUS, metal.mid);
      emblem(ctx, torso, centre, metal);
    },
    paintProfile: (ctx, torso, centre) => {
      const edgeHalf = LOCKET_RADIUS * LOCKET_EDGE_SHARE;
      traceOval(ctx, torso, centre, edgeHalf + LOCKET_RIM_WIDTH, LOCKET_RADIUS + LOCKET_RIM_WIDTH);
      ctx.fillStyle = metal.deep;
      ctx.fill();
      traceOval(ctx, torso, centre, edgeHalf, LOCKET_RADIUS);
      ctx.fillStyle = metal.mid;
      ctx.fill();
      const glint = offsetFrom(torso, centre, scaled(LOCKET_GLINT_OFFSET, LOCKET_RADIUS));
      fillDisc(ctx, torso, glint, LOCKET_RADIUS * LOCKET_GLINT_SHARE, metal.glint);
    },
  };
}

// ── The stone ────────────────────────────────────────────────────────────────

function stonePoints(torso: TorsoFrame, centre: Pt, points: readonly Pt[], squeeze = 1): Pt[] {
  return points.map((q) => offsetFrom(torso, centre, pt(q.x * squeeze, q.y)));
}

function paintStone(ctx: Ctx, torso: TorsoFrame, centre: Pt, squeeze: number): void {
  const outline = stonePoints(torso, centre, STONE_OUTLINE, squeeze);
  tracePolygon(ctx, outline);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = STONE_DEEP;
  ctx.lineWidth = STONE_RIM_WIDTH;
  ctx.stroke();
  ctx.fillStyle = STONE_MID;
  ctx.fill();
  withClip(
    ctx,
    () => tracePolygon(ctx, outline),
    () => {
      tracePolygon(ctx, stonePoints(torso, centre, STONE_FACET, squeeze));
      ctx.fillStyle = STONE_LIGHT;
      ctx.fill();
      const crack = stonePoints(torso, centre, STONE_CRACK, squeeze);
      strokeLine(ctx, crack, STONE_EMBER, STONE_CRACK_WIDTH);
      strokeLine(ctx, crack, STONE_EMBER_CORE, STONE_CRACK_CORE_WIDTH);
    },
  );
}

const STONE_LOOK: PendantLook = {
  cord: LEATHER_THONG,
  bailRise: STONE_BAIL_RISE,
  profileHalfDepth: STONE_WIDEST_X * STONE_EDGE_SHARE + STONE_RIM_WIDTH / 2,
  paintFacing: (ctx, torso, centre) => paintStone(ctx, torso, centre, 1),
  paintProfile: (ctx, torso, centre) => paintStone(ctx, torso, centre, STONE_EDGE_SHARE),
};

// ── The garments ─────────────────────────────────────────────────────────────

function definePendant(
  id: 'human_stoneheart_amulet' | 'human_sun_locket' | 'human_moon_locket',
  name: string,
  material: GarmentMaterial,
  look: PendantLook,
): WornGarmentDef<'human'> {
  return defineGarment({
    id,
    name,
    wearer: 'human',
    material,
    layer: 'outer',
    region: ['torso'],
    paint: {
      torso: humanEveryView((ctx: Ctx, frame: BipedTorsoFrame) => {
        if (frame.piece === 'collarRim') paintPendant(ctx, frame, look);
      }),
    },
  });
}

export const HUMAN_STONEHEART_AMULET = definePendant(
  'human_stoneheart_amulet',
  'Stoneheart Amulet',
  'jewelry',
  STONE_LOOK,
);

export const HUMAN_SUN_LOCKET = definePendant(
  'human_sun_locket',
  'Sun Locket',
  'jewelry',
  locketLook(GOLD, paintSunburst),
);

export const HUMAN_MOON_LOCKET = definePendant(
  'human_moon_locket',
  'Moon Locket',
  'jewelry',
  locketLook(SILVER, paintCrescent),
);
