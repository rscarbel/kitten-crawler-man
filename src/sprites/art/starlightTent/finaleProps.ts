/**
 * The ring's own dressing: the dead audience in the tiered stands on the
 * chamber's rim, the rail of bulbs in front of them, the trapeze hanging
 * still from the king pole's rigging, and the rope ladder up the pole's south
 * face to a flap cut in the canvas roof.
 *
 * The stands are wall-hung dressing drawn live through `starlightTentPropCache`,
 * one tile of one tier at a time. The trapeze and the ladder are painted with
 * the king pole in the Y-sorted decoration pass, so they block nothing and
 * sort on the pole's foot: a crawler at the ladder's foot stands in front of
 * it.
 */

import { hashUnit } from '../../flameStamps';
import type { TilePoint, TileRect } from '../../../map/town/townPlan';
import type { RGB } from '../town/townPalette';
import { mix, shade } from '../town/townPalette';
import {
  drawStarlightTentProp,
  gridAlignedBox,
  type StarlightTentPropBox,
  type StarlightTentPropCatalogueEntry,
} from './starlightTentPropCache';
import {
  BACKSTAGE,
  BLOOD,
  BONE,
  BRASS,
  BRUISE,
  FULL_TURN,
  HALF_TURN,
  IRON,
  NAVY,
  ROT_TIMBER,
  STRAW,
  inkCurrentPath,
  loopFrame,
  outlineWidth,
  paintContactShadow,
  rgba,
} from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

// ── The stands ──────────────────────────────────────────────────────────────

/** Which rim of the ring a stand is on; its audience faces the other way, toward the pole. */
export type StandSide = 'west' | 'east';

/** How one seat of the ring's stands looks this frame. */
export interface RingBleacherArt {
  readonly side: StandSide;
  /** 0 on the front row at the ring's edge, rising and darkening with each row back. */
  readonly tier: number;
  readonly seed: number;
  readonly phase: number;
}

export const RING_BLEACHER_TIERS = 3;
const SPECTATOR_VARIANTS = 3;
const SWAY_FRAMES = 4;
/** One slow sway of the whole crowd, rocking upright like puppets. */
const SWAY_PERIOD_FRAMES = 120;
/** The sway is offset seat by seat so the crowd rolls rather than bobbing in lockstep. */
const SWAY_STAGGER_FRAMES = 23;

/** Each row back stands this much higher up the rake, in tiles. */
const TIER_RISE = 0.14;
/** Each row back is this much dimmer: the stage light falls off up the rake. */
const TIER_DIMMING = 0.22;

const BENCH_WIDTH = 0.34;
const BENCH_TOP = 0.18;
const BENCH_BOTTOM = 0.92;
const RISER_WIDTH = 0.08;

const TORSO_WIDTH = 0.3;
const TORSO_HEIGHT = 0.44;
const TORSO_BOTTOM = 0.72;
/** The shoulders sit this share of the torso's width in from each side. */
const TORSO_SHOULDER_LEFT = 0.12;
const TORSO_SHOULDER_RIGHT = 0.88;
/** The shoulders drop below the torso's top, and the collar bows above it, in tiles. */
const TORSO_SHOULDER_DROP = 0.04;
const TORSO_COLLAR_RISE = 0.05;
/** How far the lit side of a coat is washed toward bone. */
const TORSO_LIT_MIX = 0.35;
const HEAD_RADIUS = 0.12;
/** The head's centre sits this share of its radius above the torso's top, so the neck is hidden. */
const HEAD_NECK_SINK = 0.6;
/** The head's highlight sits this share of its radius up and left, toward the stage light. */
const HEAD_HIGHLIGHT_OFFSET = 0.4;
const HEAD_SHADOW_SHADE = 0.55;
/** A hat sits this share of the head's radius above the head's centre. */
const HAT_SEAT_HEIGHT = 0.55;
const HAT_BRIM_WIDTH = 0.17;
const HAT_BRIM_HEIGHT = 0.045;
const HAT_CROWN_RADIUS = 0.095;
/** The bowler's glint: a small square up and left on the crown, as shares of the crown's radius. */
const BOWLER_GLINT_X = 0.7;
const BOWLER_GLINT_Y = 0.8;
const BOWLER_GLINT_SIZE = 0.03;
const BOWLER_GLINT_ALPHA = 0.6;
/** The bonnet's brim: a wider arc than the crown, dropped down the head, swept a little past a half turn. */
const BONNET_DROP = 0.3;
const BONNET_SCALE = 1.25;
const BONNET_START_TURNS = 1.05;
const BONNET_END_TURNS = 0.98;
/** How far the sway rocks a head toward and away from the ring, in tiles. */
const SWAY_REACH = 0.05;
const BALLOON_STRING_HEIGHT = 0.5;
const BALLOON_RADIUS = 0.07;
/** The balloon's wrist sits this share of the torso's width toward the ring, and this share of its height up. */
const BALLOON_WRIST_REACH = 0.4;
const BALLOON_WRIST_HEIGHT = 0.4;
const BALLOON_STRING_ALPHA = 0.7;
const BALLOON_STRING_WIDTH = 0.015;
/** The string bows toward the ring and sags below the balloon, in tiles. */
const BALLOON_STRING_BOW = 0.06;
const BALLOON_STRING_SAG = 0.2;
/** The deflated balloon hangs this share of its radius above its knot, squashed flat to this share. */
const BALLOON_KNOT_OFFSET = 0.7;
const BALLOON_SQUASH = 0.75;

/** The bench sits this far back from the tile's middle, away from the ring, in tiles. */
const BENCH_SET_BACK = 0.12;
/** The front rail runs down the ring side of the tile, this far across it. */
const RAIL_EAST_EDGE_X = 0.9;
const RAIL_WEST_EDGE_X = 0.1;
const RAIL_WIDTH = 0.05;
const BULBS_PER_SEAT = 2;
const BULB_RADIUS = 0.045;
/** Each bulb sits at the middle of its share of the rail. */
const BULB_SLOT_MIDDLE = 0.5;

type Hat = 'bowler' | 'bonnet' | 'bare';
const HATS: ReadonlyArray<Hat> = ['bowler', 'bonnet', 'bare'];
const COATS: ReadonlyArray<RGB> = [NAVY.shadow, BRUISE.shadow, BLOOD.shadow];
const SKIN_DEAD: RGB = [92, 94, 84];

function spectatorVariant(seed: number): number {
  return Math.floor(hashUnit(seed, SPECTATOR_VARIANTS) * SPECTATOR_VARIANTS) % SPECTATOR_VARIANTS;
}

interface SeatPose {
  /** Toward the ring, +1 east and -1 west. */
  readonly facing: number;
  readonly lean: number;
}

function paintSpectator(
  ctx: Ctx,
  benchX: number,
  originY: number,
  size: number,
  variant: number,
  pose: SeatPose,
  dim: number,
): void {
  const tone = (color: RGB): RGB => shade(color, dim);
  const coat = COATS[variant % COATS.length] ?? NAVY.shadow;
  const hat = HATS[variant % HATS.length] ?? 'bare';
  const torsoBottom = originY + TORSO_BOTTOM * size;
  const torsoTop = torsoBottom - TORSO_HEIGHT * size;
  const torsoLeft = benchX - (TORSO_WIDTH * size) / 2;
  const headX = benchX + pose.facing * pose.lean * SWAY_REACH * size;
  const headY = torsoTop - HEAD_RADIUS * size * HEAD_NECK_SINK;

  // A child's balloon, long deflated, still tied to one wrist.
  if (variant === SPECTATOR_VARIANTS - 1) {
    const stringX = benchX + pose.facing * TORSO_WIDTH * size * BALLOON_WRIST_REACH;
    const balloonY = torsoTop - BALLOON_STRING_HEIGHT * size;
    ctx.strokeStyle = rgba(tone(BONE.mid), BALLOON_STRING_ALPHA);
    ctx.lineWidth = Math.max(1, size * BALLOON_STRING_WIDTH);
    ctx.beginPath();
    ctx.moveTo(stringX, torsoBottom - TORSO_HEIGHT * size * BALLOON_WRIST_HEIGHT);
    ctx.quadraticCurveTo(
      stringX + pose.facing * size * BALLOON_STRING_BOW,
      balloonY + size * BALLOON_STRING_SAG,
      stringX,
      balloonY,
    );
    ctx.stroke();
    ctx.fillStyle = rgba(tone(BLOOD.mid), 1);
    ctx.beginPath();
    ctx.ellipse(
      stringX,
      balloonY - BALLOON_RADIUS * size * BALLOON_KNOT_OFFSET,
      BALLOON_RADIUS * size,
      BALLOON_RADIUS * size * BALLOON_SQUASH,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
    inkCurrentPath(ctx, size);
  }

  const torso = ctx.createLinearGradient(
    torsoLeft,
    torsoTop,
    torsoLeft + TORSO_WIDTH * size,
    torsoBottom,
  );
  torso.addColorStop(0, rgba(tone(mix(coat, BONE.shadow, TORSO_LIT_MIX)), 1));
  torso.addColorStop(1, rgba(tone(coat), 1));
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.moveTo(torsoLeft, torsoBottom);
  ctx.lineTo(
    torsoLeft + TORSO_WIDTH * size * TORSO_SHOULDER_LEFT,
    torsoTop + size * TORSO_SHOULDER_DROP,
  );
  ctx.quadraticCurveTo(
    benchX,
    torsoTop - size * TORSO_COLLAR_RISE,
    torsoLeft + TORSO_WIDTH * size * TORSO_SHOULDER_RIGHT,
    torsoTop + size * TORSO_SHOULDER_DROP,
  );
  ctx.lineTo(torsoLeft + TORSO_WIDTH * size, torsoBottom);
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);

  const head = ctx.createRadialGradient(
    headX - HEAD_RADIUS * size * HEAD_HIGHLIGHT_OFFSET,
    headY - HEAD_RADIUS * size * HEAD_HIGHLIGHT_OFFSET,
    0,
    headX,
    headY,
    HEAD_RADIUS * size,
  );
  head.addColorStop(0, rgba(tone(SKIN_DEAD), 1));
  head.addColorStop(1, rgba(tone(shade(SKIN_DEAD, HEAD_SHADOW_SHADE)), 1));
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(headX, headY, HEAD_RADIUS * size, 0, FULL_TURN);
  ctx.fill();
  inkCurrentPath(ctx, size);

  ctx.save();
  try {
    ctx.translate(headX, headY - HEAD_RADIUS * size * HAT_SEAT_HEIGHT);
    if (hat === 'bowler') {
      ctx.fillStyle = rgba(tone(BACKSTAGE.mid), 1);
      ctx.beginPath();
      ctx.ellipse(0, 0, HAT_BRIM_WIDTH * size, HAT_BRIM_HEIGHT * size, 0, 0, FULL_TURN);
      ctx.fill();
      inkCurrentPath(ctx, size);
      ctx.beginPath();
      ctx.arc(0, 0, HAT_CROWN_RADIUS * size, HALF_TURN, FULL_TURN);
      ctx.closePath();
      ctx.fill();
      inkCurrentPath(ctx, size);
      ctx.fillStyle = rgba(tone(BONE.shadow), BOWLER_GLINT_ALPHA);
      ctx.fillRect(
        -HAT_CROWN_RADIUS * size * BOWLER_GLINT_X,
        -HAT_CROWN_RADIUS * size * BOWLER_GLINT_Y,
        size * BOWLER_GLINT_SIZE,
        size * BOWLER_GLINT_SIZE,
      );
    } else if (hat === 'bonnet') {
      ctx.fillStyle = rgba(tone(STRAW.mid), 1);
      ctx.beginPath();
      ctx.arc(
        0,
        HAT_CROWN_RADIUS * size * BONNET_DROP,
        HAT_CROWN_RADIUS * size * BONNET_SCALE,
        HALF_TURN * BONNET_START_TURNS,
        FULL_TURN * BONNET_END_TURNS,
      );
      ctx.closePath();
      ctx.fill();
      inkCurrentPath(ctx, size);
    }
  } finally {
    ctx.restore();
  }
}

/** Everything a seat's baked picture depends on besides its sway frame. */
interface SeatLook {
  readonly side: StandSide;
  readonly tier: number;
  readonly variant: number;
}

/**
 * A seat's frame, in tiles from its tile's top-left: the bench, riser and
 * rail fill the tile; above it rises only as far as the spectator does — a
 * row back stands higher up the rake, and only the child with the balloon
 * reaches far above its head. Fitting each look's frame to its own figure
 * keeps the stands' many sway frames small enough to stay resident together.
 */
const SPECTATOR_BOX_TOP = -0.125;
const BALLOON_BOX_TOP = -0.4375;

function seatBox(tier: number, variant: number): StarlightTentPropBox {
  const hasBalloon = variant === SPECTATOR_VARIANTS - 1;
  const top = (hasBalloon ? BALLOON_BOX_TOP : SPECTATOR_BOX_TOP) - TIER_RISE * clampedTier(tier);
  // On the bake grid, so the frame blits one to one and nothing in it is resampled.
  return gridAlignedBox({ left: 0, top, width: 1, height: 1 - top });
}

function seatEntry(look: SeatLook, swayFrame: number): StarlightTentPropCatalogueEntry {
  // The riser drops on the ring side and the bench runs down into the next
  // seat, so a stand's column of seats meets without a seam.
  const riserSide = look.side === 'west' ? 'right' : 'left';
  return {
    key: {
      prop: 'ringBleacher',
      state: `${look.side}-${look.tier}-${look.variant}`,
      frame: swayFrame,
    },
    box: seatBox(look.tier, look.variant),
    painter: (target, originX, originY, px) => {
      paintSeatBase(target, originX, originY, px, look.side, look.tier);
      paintSeatSpectator(target, originX, originY, px, look, swayFrame);
    },
    openEdges: ['bottom', riserSide],
  };
}

/** Every seat picture the stands can ask the prop cache for, for the art gate. */
export function finalePropCatalogue(): ReadonlyArray<StarlightTentPropCatalogueEntry> {
  const entries: StarlightTentPropCatalogueEntry[] = [];
  for (const side of ['west', 'east'] as const) {
    for (let tier = 0; tier < RING_BLEACHER_TIERS; tier++) {
      for (let variant = 0; variant < SPECTATOR_VARIANTS; variant++) {
        for (let swayFrame = 0; swayFrame < SWAY_FRAMES; swayFrame++) {
          entries.push(seatEntry({ side, tier, variant }, swayFrame));
        }
      }
    }
  }
  entries.push(ROOF_FLAP_ENTRY, ROPE_LADDER_ENTRY);
  return entries;
}

function seatFacing(side: StandSide): number {
  return side === 'west' ? 1 : -1;
}

function clampedTier(tier: number): number {
  return Math.max(0, Math.min(RING_BLEACHER_TIERS - 1, tier));
}

function tierDimming(tier: number): number {
  return 1 - TIER_DIMMING * clampedTier(tier);
}

/** The bench runs along the tile on the side away from the ring. */
function benchCentreX(originX: number, size: number, side: StandSide): number {
  return originX + size / 2 - seatFacing(side) * size * BENCH_SET_BACK;
}

function paintSeatBase(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  side: StandSide,
  tier: number,
): void {
  const dim = tierDimming(tier);
  const facing = seatFacing(side);
  // The riser drops at the ring side, down to the next row forward.
  const benchLeft = benchCentreX(originX, size, side) - (BENCH_WIDTH * size) / 2;
  const plank = ctx.createLinearGradient(benchLeft, 0, benchLeft + BENCH_WIDTH * size, 0);
  plank.addColorStop(0, rgba(shade(ROT_TIMBER.mid, dim), 1));
  plank.addColorStop(1, rgba(shade(ROT_TIMBER.shadow, dim), 1));
  ctx.fillStyle = plank;
  ctx.beginPath();
  ctx.rect(
    benchLeft,
    originY + BENCH_TOP * size,
    BENCH_WIDTH * size,
    (BENCH_BOTTOM - BENCH_TOP) * size,
  );
  ctx.fill();
  inkCurrentPath(ctx, size);
  const riserX = facing > 0 ? originX + size - RISER_WIDTH * size : originX;
  ctx.fillStyle = rgba(shade(BACKSTAGE.shadow, dim), 1);
  ctx.fillRect(riserX, originY, RISER_WIDTH * size, size);

  if (clampedTier(tier) !== 0) return;
  // The rail runs down the ring side, clear of the spectator, who never
  // leans that far, so it can be painted before them.
  const railX = facing > 0 ? originX + size * RAIL_EAST_EDGE_X : originX + size * RAIL_WEST_EDGE_X;
  ctx.fillStyle = rgba(shade(BRASS.shadow, dim), 1);
  ctx.fillRect(railX - (RAIL_WIDTH * size) / 2, originY, RAIL_WIDTH * size, size);
  for (let bulb = 0; bulb < BULBS_PER_SEAT; bulb++) {
    const bulbY = originY + ((bulb + BULB_SLOT_MIDDLE) / BULBS_PER_SEAT) * size;
    ctx.fillStyle = rgba(IRON.shadow, 1);
    ctx.beginPath();
    ctx.arc(railX, bulbY, BULB_RADIUS * size, 0, FULL_TURN);
    ctx.fill();
    ctx.lineWidth = outlineWidth(size);
    ctx.strokeStyle = rgba(BRASS.mid, 1);
    ctx.stroke();
  }
}

function paintSeatSpectator(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  art: SeatLook,
  swayFrame: number,
): void {
  const lift = TIER_RISE * clampedTier(art.tier) * size;
  const swayCycle = (swayFrame / SWAY_FRAMES) * FULL_TURN;
  const pose: SeatPose = {
    facing: seatFacing(art.side),
    lean: Math.sin(swayCycle),
  };
  paintSpectator(
    ctx,
    benchCentreX(originX, size, art.side),
    originY - lift,
    size,
    art.variant,
    pose,
    tierDimming(art.tier),
  );
}

/** One seat of the ring's stands, with its dead spectator and, on the front row, the rail of bulbs. */
export function drawRingBleacher(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: RingBleacherArt,
): void {
  const variant = spectatorVariant(art.seed);
  const swayFrame = loopFrame(
    art.phase + art.seed * SWAY_STAGGER_FRAMES,
    SWAY_PERIOD_FRAMES,
    SWAY_FRAMES,
  );
  const entry = seatEntry({ side: art.side, tier: art.tier, variant }, swayFrame);
  drawStarlightTentProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
}

// ── The trapeze ─────────────────────────────────────────────────────────────

/** The trapeze hangs this far west of the king pole's west face, in tiles, over the ring. */
export const TRAPEZE_OFFSET_TILES = 2.6;
/** Where its bar hangs, in tiles above the top of the pole's tiles. */
const TRAPEZE_BAR_RISE = 1.2;
const TRAPEZE_BAR_WIDTH = 0.95;
const TRAPEZE_BAR_THICKNESS = 0.07;
const TRAPEZE_ROPE_WIDTH = 0.035;
/** The ropes are tied on this share of the way out along the bar from its middle. */
const TRAPEZE_ROPE_SPREAD = 0.9;
/** The ropes run up into the dark of the roof and fade there, this far above the bar. */
const TRAPEZE_ROPE_REACH = 6;
const TRAPEZE_ROPE_FADE_SHARE = 0.6;
const TRAPEZE_ROPE_ALPHA = 0.9;
const TRAPEZE_TAPE_BANDS = 4;
/** Each band of tape covers this share of its slot along the bar. */
const TRAPEZE_TAPE_SHARE = 0.6;
/** Slack past the end of the bar, in tiles. */
const TRAPEZE_REACH_MARGIN_TILES = 0.1;

/**
 * The trapeze, hanging still from the rigging: a taped bar on two ropes that
 * climb out of sight. Painted from the king pole's top-left tile corner.
 */
export function paintTrapeze(ctx: Ctx, poleOriginX: number, poleOriginY: number, ts: number): void {
  const barCentreX = poleOriginX - TRAPEZE_OFFSET_TILES * ts;
  const barY = poleOriginY - TRAPEZE_BAR_RISE * ts;
  const halfBar = (TRAPEZE_BAR_WIDTH * ts) / 2;
  const ropeTop = barY - TRAPEZE_ROPE_REACH * ts;
  ctx.save();
  try {
    for (const end of [-1, 1]) {
      const ropeX = barCentreX + end * halfBar * TRAPEZE_ROPE_SPREAD;
      const rope = ctx.createLinearGradient(0, ropeTop, 0, barY);
      rope.addColorStop(0, rgba(STRAW.shadow, 0));
      rope.addColorStop(TRAPEZE_ROPE_FADE_SHARE, rgba(STRAW.mid, TRAPEZE_ROPE_ALPHA));
      rope.addColorStop(1, rgba(STRAW.light, 1));
      ctx.strokeStyle = rope;
      ctx.lineWidth = TRAPEZE_ROPE_WIDTH * ts;
      ctx.beginPath();
      ctx.moveTo(ropeX, ropeTop);
      ctx.lineTo(ropeX, barY);
      ctx.stroke();
    }
    const thickness = TRAPEZE_BAR_THICKNESS * ts;
    ctx.beginPath();
    ctx.rect(barCentreX - halfBar, barY - thickness / 2, halfBar * 2, thickness);
    const bar = ctx.createLinearGradient(0, barY - thickness / 2, 0, barY + thickness / 2);
    bar.addColorStop(0, rgba(ROT_TIMBER.light, 1));
    bar.addColorStop(1, rgba(ROT_TIMBER.shadow, 1));
    ctx.fillStyle = bar;
    ctx.fill();
    ctx.save();
    try {
      ctx.clip();
      ctx.fillStyle = rgba(BONE.mid, 1);
      const band = (halfBar * 2) / (TRAPEZE_TAPE_BANDS * 2 + 1);
      for (let tape = 0; tape < TRAPEZE_TAPE_BANDS; tape++) {
        ctx.fillRect(
          barCentreX - halfBar + band * (tape * 2 + 1),
          barY - thickness,
          band * TRAPEZE_TAPE_SHARE,
          thickness * 2,
        );
      }
    } finally {
      ctx.restore();
    }
    ctx.beginPath();
    ctx.rect(barCentreX - halfBar, barY - thickness / 2, halfBar * 2, thickness);
    inkCurrentPath(ctx, ts);
  } finally {
    ctx.restore();
  }
}

/** How far the trapeze's art reaches west of the king pole's own tiles, in tiles. */
export const TRAPEZE_REACH_WEST_TILES =
  TRAPEZE_OFFSET_TILES + TRAPEZE_BAR_WIDTH / 2 + TRAPEZE_REACH_MARGIN_TILES;

// ── The rope ladder ─────────────────────────────────────────────────────────

/**
 * How far above the top of the pole's tiles the flap's peak is cut, in tiles:
 * high enough that the slit stands in the roof above the ring's north wall,
 * its foot just over the wall's top.
 */
const FLAP_RISE_TILES = 5;
/**
 * The slit is taller than it is wide, as a cut in canvas is, and a little
 * wider than the mast, so the night shows either side of the pole where it
 * passes up through it.
 */
const FLAP_HALF_WIDTH = 0.98;
const FLAP_HEIGHT = 1.9;
/** How far each folded-back lip of canvas reaches out past the opening. */
const FLAP_LIP_REACH = 0.24;
/** The lips curl back from this share of the way down the opening. */
const FLAP_LIP_HINGE_SHARE = 0.12;
/**
 * How much of a half-turn of sine the slit's width runs through from peak to
 * foot: under a whole half-turn, so the slit is widest low down and drawn in
 * again, but not shut, at its foot.
 */
const FLAP_SLIT_ARC = 0.9;
/** Straight runs each edge of the slit is drawn with. */
const FLAP_EDGE_SAMPLES = 18;
const FLAP_LACE_HOLES = 5;
/** Each lacing mark's length, in tiles. */
const FLAP_LACE_LENGTH = 0.07;
/**
 * The patch of roof canvas the slit is cut in, as half-sizes in tiles: the
 * rest of the roof is lost in the dark, and a slit with no canvas round it
 * reads as a pennant on the wall.
 */
const ROOF_CANVAS_HALF_WIDTH = 1.9;
const ROOF_CANVAS_HALF_HEIGHT = 1.5;
/** The canvas patch is lit hardest at the slit and fades into the dark this far out. */
const ROOF_CANVAS_ALPHA = 0.85;
/** Where the patch starts to fade, as a share of its radius. */
const ROOF_CANVAS_SOLID_SHARE = 0.45;
/** The roof's panels: this many seams run out from the slit to the patch's rim. */
const ROOF_SEAM_COUNT = 10;
const ROOF_SEAM_ALPHA = 0.55;
const ROOF_SEAM_WIDTH = 0.03;
/** The roof's stripes alternate panel by panel, bone and blood. */
const ROOF_STRIPE_EVERY = 2;
const FLAP_GLOW_RADIUS = 1.2;
const FLAP_GLOW_ALPHA = 0.3;
/** Where in the opening the sky is palest, as a share down from its peak. */
const FLAP_SKY_PALE_STOP = 0.8;
/** The bright rim the cut canvas edge catches, in tiles. */
const FLAP_RIM_WIDTH = 0.05;
/** Stars in the slit of night either side of the mast, in tiles from the opening's peak. */
const FLAP_STARS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: -0.72, dy: 1.25 },
  { dx: -0.58, dy: 0.8 },
  { dx: 0.62, dy: 0.95 },
  { dx: 0.76, dy: 1.5 },
  { dx: 0.55, dy: 0.55 },
];
const FLAP_STAR_RADIUS = 0.028;
const FLAP_STAR_ALPHA = 0.9;

/** The ropes stand this far either side of the ladder's middle. */
const LADDER_HALF_SPAN = 0.22;
const LADDER_ROPE_WIDTH = 0.08;
const LADDER_RUNG_PITCH = 0.42;
const LADDER_RUNG_THICKNESS = 0.055;
/** Rungs stand proud of the ropes by this much each side. */
const LADDER_RUNG_OVERHANG = 0.035;
/** How far a rope bellies out between two rungs, as a rope ladder hangs. */
const LADDER_ROPE_BELLY = 0.05;
const LADDER_KNOT_RADIUS = 0.04;
/** The twist laid into each rope: one dark strand mark this often, in tiles. */
const LADDER_TWIST_PITCH = 0.08;
/** A twist mark leans up the rope by this share of the rope's width. */
const LADDER_TWIST_LEAN = 0.7;
const LADDER_TWIST_ALPHA = 0.7;
/** The lowest rung's height above the floor, in tiles. */
const LADDER_FOOT_CLEARANCE = 0.18;
/** The ladder darkens toward the roof over this share of its length from the top. */
const LADDER_SHADE_SHARE = 0.55;
/** How much of its colour the rope keeps where it is darkest, up under the roof. */
const LADDER_TOP_SHADE = 0.8;
/**
 * The rungs hang crooked, up to this many radians at the foot: a ladder that
 * is only tied at the top swings there.
 */
const LADDER_SLACK_TILT = 0.14;
/** The whole ladder sways off the pole's line by up to this much, most at the foot, in tiles. */
const LADDER_SWAY = 0.08;
/** The shadow the ladder throws on the pole behind it, offset this far, in tiles. */
const LADDER_SHADOW_OFFSET = 0.07;
const LADDER_SHADOW_ALPHA = 0.4;
/** The night through the slit falls down the ladder this far below it, in tiles. */
const LADDER_SKYLIGHT_REACH = 2.4;
const LADDER_SKYLIGHT_ALPHA = 0.14;
/** The batten across the slit's foot the ladder is tied to, in tiles. */
const LADDER_BATTEN_HALF_WIDTH = 0.42;
const LADDER_BATTEN_THICKNESS = 0.09;
/** The two ropes are gathered in a bridle this far above the batten, in tiles. */
const LADDER_BRIDLE_RISE = 0.5;
const LADDER_BRIDLE_KNOT_RADIUS = 0.06;
/** The slack at the ladder's foot, coiled on the sawdust. */
const LADDER_COIL_RADIUS_X = 0.2;
const LADDER_COIL_RADIUS_Y = 0.07;
const LADDER_COIL_LIFT = 0.1;
const LADDER_COIL_SHADOW_ALPHA = 0.35;
const LADDER_COIL_SHADOW_REACH = 1.4;
/** Box margin, in tiles, so no part of a picture inks its own frame edge. */
const LADDER_BOX_MARGIN = 0.06;

/** The king pole's tiles each way: the ladder spans its rows, the flap is centred across its width. */
const KING_POLE_TILES = 2;
/** Half a tile: where a picture centred on its tile has its middle. */
const TILE_MIDDLE = 0.5;

/**
 * Both pictures are drawn at one tile of the pole's bottom row, centred on
 * the mast, and reach up past the pole's top to the flap.
 */
const FLAP_PEAK = -(KING_POLE_TILES - 1 + FLAP_RISE_TILES);
const FLAP_BASE = FLAP_PEAK + FLAP_HEIGHT;
const FLAP_HALF_REACH =
  Math.max(ROOF_CANVAS_HALF_WIDTH, FLAP_HALF_WIDTH + FLAP_LIP_REACH) + LADDER_BOX_MARGIN;
/** The roof patch is centred on the slit's middle. */
const ROOF_CANVAS_TOP = FLAP_PEAK + FLAP_HEIGHT / 2 - ROOF_CANVAS_HALF_HEIGHT;
const ROOF_CANVAS_BOTTOM = FLAP_PEAK + FLAP_HEIGHT / 2 + ROOF_CANVAS_HALF_HEIGHT;
/**
 * How far the flap's art reaches past either side face of the king pole's
 * tiles, in tiles, for the pole's draw extents.
 */
export const ROOF_FLAP_OVERHANG_TILES = Math.max(0, FLAP_HALF_REACH - KING_POLE_TILES / 2);
const ROOF_FLAP_BOX: StarlightTentPropBox = gridAlignedBox({
  left: TILE_MIDDLE - FLAP_HALF_REACH,
  top: Math.min(FLAP_PEAK, ROOF_CANVAS_TOP) - LADDER_BOX_MARGIN,
  width: FLAP_HALF_REACH * 2,
  height:
    Math.max(FLAP_BASE, ROOF_CANVAS_BOTTOM) -
    Math.min(FLAP_PEAK, ROOF_CANVAS_TOP) +
    LADDER_BOX_MARGIN * 2,
});
const ROPE_LADDER_BOX: StarlightTentPropBox = gridAlignedBox({
  left: 0,
  top: FLAP_BASE - LADDER_BRIDLE_RISE - LADDER_BRIDLE_KNOT_RADIUS - LADDER_BOX_MARGIN,
  width: 1,
  height: 1 + LADDER_BOX_MARGIN * 2 + LADDER_BRIDLE_RISE + LADDER_BRIDLE_KNOT_RADIUS - FLAP_BASE,
});

/**
 * The patch of roof canvas round the slit: striped panels whose seams run in
 * to the pole, lit where the night comes through and lost in the dark at the
 * rim.
 */
function paintRoofCanvas(ctx: Ctx, centreX: number, centreY: number, size: number): void {
  const halfWidth = ROOF_CANVAS_HALF_WIDTH * size;
  const halfHeight = ROOF_CANVAS_HALF_HEIGHT * size;
  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(1, halfHeight / halfWidth);
  const panelTurn = FULL_TURN / ROOF_SEAM_COUNT;
  for (let panel = 0; panel < ROOF_SEAM_COUNT; panel++) {
    const tone = panel % ROOF_STRIPE_EVERY === 0 ? BONE.shadow : BLOOD.shadow;
    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, halfWidth);
    fade.addColorStop(0, rgba(tone, ROOF_CANVAS_ALPHA));
    fade.addColorStop(ROOF_CANVAS_SOLID_SHARE, rgba(tone, ROOF_CANVAS_ALPHA));
    fade.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, halfWidth, panel * panelTurn, (panel + 1) * panelTurn);
    ctx.closePath();
    ctx.fill();
  }
  for (let seam = 0; seam < ROOF_SEAM_COUNT; seam++) {
    const angle = seam * panelTurn;
    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, halfWidth);
    fade.addColorStop(0, rgba(BACKSTAGE.shadow, ROOF_SEAM_ALPHA));
    fade.addColorStop(1, rgba(BACKSTAGE.shadow, 0));
    ctx.strokeStyle = fade;
    ctx.lineWidth = ROOF_SEAM_WIDTH * size;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * halfWidth, Math.sin(angle) * halfWidth);
    ctx.stroke();
  }
  ctx.restore();
}

function paintFlapOpening(ctx: Ctx, centreX: number, peakY: number, size: number): void {
  const halfWidth = FLAP_HALF_WIDTH * size;
  const height = FLAP_HEIGHT * size;
  const baseY = peakY + height;
  const middleY = peakY + height / 2;

  paintRoofCanvas(ctx, centreX, middleY, size);

  const glow = ctx.createRadialGradient(
    centreX,
    middleY,
    0,
    centreX,
    middleY,
    FLAP_GLOW_RADIUS * size,
  );
  glow.addColorStop(0, rgba(NAVY.light, FLAP_GLOW_ALPHA));
  glow.addColorStop(1, rgba(NAVY.light, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centreX, middleY, FLAP_GLOW_RADIUS * size, 0, FULL_TURN);
  ctx.fill();

  // A slit: pointed at the top where the cut starts, widest low down where
  // the canvas has been pulled back off the pole, and drawn in again at its
  // foot where the canvas is still laced.
  const slitHalfAt = (share: number): number =>
    halfWidth * Math.sin(HALF_TURN * share * FLAP_SLIT_ARC);
  const edgePoint = (side: number, share: number, reach: number): { x: number; y: number } => ({
    x: centreX + side * (slitHalfAt(share) + reach),
    y: peakY + height * share,
  });
  const traceOpening = (): void => {
    ctx.beginPath();
    ctx.moveTo(centreX, peakY);
    for (let sample = 1; sample <= FLAP_EDGE_SAMPLES; sample++) {
      const point = edgePoint(1, sample / FLAP_EDGE_SAMPLES, 0);
      ctx.lineTo(point.x, point.y);
    }
    for (let sample = FLAP_EDGE_SAMPLES; sample >= 1; sample--) {
      const point = edgePoint(-1, sample / FLAP_EDGE_SAMPLES, 0);
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  };
  traceOpening();
  const sky = ctx.createLinearGradient(0, peakY, 0, baseY);
  sky.addColorStop(0, rgba(NAVY.shadow, 1));
  sky.addColorStop(FLAP_SKY_PALE_STOP, rgba(NAVY.mid, 1));
  sky.addColorStop(1, rgba(NAVY.light, 1));
  ctx.fillStyle = sky;
  ctx.fill();
  ctx.fillStyle = rgba(BONE.light, FLAP_STAR_ALPHA);
  for (const star of FLAP_STARS) {
    ctx.beginPath();
    ctx.arc(
      centreX + star.dx * size,
      peakY + star.dy * size,
      FLAP_STAR_RADIUS * size,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }

  // The cut canvas curls back either side, its pale underside turned out,
  // most where the slit is pulled widest.
  const lipReach = FLAP_LIP_REACH * size;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    const inner: Array<{ x: number; y: number }> = [];
    const outer: Array<{ x: number; y: number }> = [];
    for (let sample = 0; sample <= FLAP_EDGE_SAMPLES; sample++) {
      const along = sample / FLAP_EDGE_SAMPLES;
      const share = FLAP_LIP_HINGE_SHARE + (1 - FLAP_LIP_HINGE_SHARE) * along;
      inner.push(edgePoint(side, share, 0));
      outer.push(edgePoint(side, share, lipReach * Math.sin(HALF_TURN * along * FLAP_SLIT_ARC)));
    }
    const hinge = edgePoint(side, FLAP_LIP_HINGE_SHARE, 0);
    ctx.moveTo(hinge.x, hinge.y);
    for (const point of inner) ctx.lineTo(point.x, point.y);
    for (const point of [...outer].reverse()) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    const underside = ctx.createLinearGradient(
      centreX + side * halfWidth,
      0,
      centreX + side * (halfWidth + lipReach),
      0,
    );
    underside.addColorStop(0, rgba(BONE.light, 1));
    underside.addColorStop(1, rgba(BONE.mid, 1));
    ctx.fillStyle = underside;
    ctx.fill();
    inkCurrentPath(ctx, size);

    // Lacing holes down each lip, where the slit is tied shut in bad weather.
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    ctx.lineWidth = outlineWidth(size);
    const lace = FLAP_LACE_LENGTH * size;
    for (let hole = 1; hole <= FLAP_LACE_HOLES; hole++) {
      const along = hole / (FLAP_LACE_HOLES + 1);
      const share = FLAP_LIP_HINGE_SHARE + (1 - FLAP_LIP_HINGE_SHARE) * along;
      const point = edgePoint(side, share, lace);
      ctx.beginPath();
      ctx.moveTo(point.x - side * lace, point.y);
      ctx.lineTo(point.x, point.y - lace / 2);
      ctx.stroke();
    }
  }
  traceOpening();
  ctx.strokeStyle = rgba(BONE.light, 1);
  ctx.lineWidth = FLAP_RIM_WIDTH * size;
  ctx.stroke();
  inkCurrentPath(ctx, size);
}

/** How far a rope bellied by `belly` between two ties stands out at `share` of the way along. */
function bellyOffset(belly: number, share: number): number {
  // A quadratic curve with its control point `belly` out lies at 2t(1-t) of it.
  return 2 * share * (1 - share) * belly;
}

function paintLadder(ctx: Ctx, centreX: number, topY: number, floorY: number, size: number): void {
  const length = floorY - topY;
  const shareDown = (y: number): number => Math.min(1, Math.max(0, (y - topY) / length));
  const shadeAt = (y: number): number => {
    const fromTop = (y - topY) / (length * LADDER_SHADE_SHARE);
    return LADDER_TOP_SHADE + (1 - LADDER_TOP_SHADE) * Math.min(1, Math.max(0, fromTop));
  };
  // A lazy S off the pole's line, still at the top where it is tied and
  // widest at the foot where it swings.
  const middleAt = (y: number): number => {
    const down = shareDown(y);
    return centreX + LADDER_SWAY * size * Math.sin(FULL_TURN * down) * down;
  };
  const span = LADDER_HALF_SPAN * size;
  const coilY = floorY - LADDER_COIL_LIFT * size;
  const pitch = LADDER_RUNG_PITCH * size;
  const lowestRung = floorY - LADDER_FOOT_CLEARANCE * size;
  const rungYs: number[] = [];
  for (let y = lowestRung; y > topY + pitch; y -= pitch) rungYs.push(y);
  const ropeWidth = LADDER_ROPE_WIDTH * size;
  const belly = LADDER_ROPE_BELLY * size;
  const ties = [coilY, ...rungYs, topY];

  const skylight = ctx.createLinearGradient(0, topY, 0, topY + LADDER_SKYLIGHT_REACH * size);
  skylight.addColorStop(0, rgba(NAVY.light, LADDER_SKYLIGHT_ALPHA));
  skylight.addColorStop(1, rgba(NAVY.light, 0));
  ctx.fillStyle = skylight;
  ctx.beginPath();
  ctx.moveTo(centreX - span, topY);
  ctx.lineTo(centreX + span, topY);
  ctx.lineTo(centreX + span * 2, topY + LADDER_SKYLIGHT_REACH * size);
  ctx.lineTo(centreX - span * 2, topY + LADDER_SKYLIGHT_REACH * size);
  ctx.closePath();
  ctx.fill();

  paintContactShadow(
    ctx,
    centreX,
    coilY,
    LADDER_COIL_RADIUS_X * size * LADDER_COIL_SHADOW_REACH,
    LADDER_COIL_RADIUS_Y * size * LADDER_COIL_SHADOW_REACH,
    LADDER_COIL_SHADOW_ALPHA,
  );

  // Each rope bellies out between its rungs, which is what makes it rope
  // rather than a rail.
  const traceRope = (side: number, offsetX: number): void => {
    const start = ties[0] ?? coilY;
    ctx.beginPath();
    ctx.moveTo(middleAt(start) + side * span + offsetX, start);
    for (let tie = 1; tie < ties.length; tie++) {
      const from = ties[tie - 1] ?? coilY;
      const to = ties[tie] ?? topY;
      const halfway = (from + to) / 2;
      ctx.quadraticCurveTo(
        middleAt(halfway) + side * (span + belly) + offsetX,
        halfway,
        middleAt(to) + side * span + offsetX,
        to,
      );
    }
  };

  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, LADDER_SHADOW_ALPHA);
  ctx.lineWidth = ropeWidth;
  for (const side of [-1, 1]) {
    traceRope(side, LADDER_SHADOW_OFFSET * size);
    ctx.stroke();
  }

  for (const side of [-1, 1]) {
    traceRope(side, 0);
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    ctx.lineWidth = ropeWidth + outlineWidth(size);
    ctx.stroke();
    const rope = ctx.createLinearGradient(0, topY, 0, floorY);
    rope.addColorStop(0, rgba(shade(STRAW.mid, LADDER_TOP_SHADE), 1));
    rope.addColorStop(LADDER_SHADE_SHARE, rgba(STRAW.mid, 1));
    rope.addColorStop(1, rgba(STRAW.light, 1));
    ctx.strokeStyle = rope;
    ctx.lineWidth = ropeWidth;
    ctx.stroke();

    // The lay of the rope: a dark strand mark leaning up it at every twist.
    ctx.strokeStyle = rgba(STRAW.shadow, LADDER_TWIST_ALPHA);
    ctx.lineWidth = outlineWidth(size);
    const twistPitch = LADDER_TWIST_PITCH * size;
    for (let tie = 1; tie < ties.length; tie++) {
      const from = ties[tie - 1] ?? coilY;
      const to = ties[tie] ?? topY;
      for (let y = from - twistPitch / 2; y > to; y -= twistPitch) {
        const share = (from - y) / (from - to);
        const x = middleAt(y) + side * (span + bellyOffset(belly, share));
        ctx.beginPath();
        ctx.moveTo(x - ropeWidth / 2, y);
        ctx.lineTo(x + ropeWidth / 2, y - ropeWidth * LADDER_TWIST_LEAN);
        ctx.stroke();
      }
    }
  }

  const rungHalf = span + LADDER_RUNG_OVERHANG * size;
  const thickness = LADDER_RUNG_THICKNESS * size;
  rungYs.forEach((y, index) => {
    const tone = shadeAt(y);
    const tilt = (index % 2 === 0 ? 1 : -1) * LADDER_SLACK_TILT * shareDown(y);
    ctx.save();
    ctx.translate(middleAt(y), y);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.rect(-rungHalf, -thickness / 2, rungHalf * 2, thickness);
    const rung = ctx.createLinearGradient(0, -thickness / 2, 0, thickness / 2);
    rung.addColorStop(0, rgba(shade(ROT_TIMBER.light, tone), 1));
    rung.addColorStop(1, rgba(shade(ROT_TIMBER.shadow, tone), 1));
    ctx.fillStyle = rung;
    ctx.fill();
    inkCurrentPath(ctx, size);
    ctx.fillStyle = rgba(shade(STRAW.light, tone), 1);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * span, 0, LADDER_KNOT_RADIUS * size, 0, FULL_TURN);
      ctx.fill();
      inkCurrentPath(ctx, size);
    }
    ctx.restore();
  });

  // The batten across the slit's foot the ladder hangs from, and the bridle
  // above it that gathers both ropes up into the slit.
  const battenHalf = LADDER_BATTEN_HALF_WIDTH * size;
  const battenThickness = LADDER_BATTEN_THICKNESS * size;
  const knotY = topY - LADDER_BRIDLE_RISE * size;
  for (const pass of ['ink', 'rope'] as const) {
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(centreX + side * span, topY);
      ctx.lineTo(centreX, knotY);
    }
    ctx.strokeStyle =
      pass === 'ink' ? rgba(BACKSTAGE.shadow, 1) : rgba(shade(STRAW.mid, LADDER_TOP_SHADE), 1);
    ctx.lineWidth = pass === 'ink' ? ropeWidth + outlineWidth(size) : ropeWidth;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(centreX, knotY, LADDER_BRIDLE_KNOT_RADIUS * size, 0, FULL_TURN);
  ctx.fillStyle = rgba(STRAW.mid, 1);
  ctx.fill();
  inkCurrentPath(ctx, size);
  ctx.beginPath();
  ctx.rect(centreX - battenHalf, topY - battenThickness / 2, battenHalf * 2, battenThickness);
  ctx.fillStyle = rgba(ROT_TIMBER.mid, 1);
  ctx.fill();
  inkCurrentPath(ctx, size);

  ctx.beginPath();
  ctx.ellipse(
    middleAt(coilY),
    coilY,
    LADDER_COIL_RADIUS_X * size,
    LADDER_COIL_RADIUS_Y * size,
    0,
    0,
    FULL_TURN,
  );
  ctx.strokeStyle = rgba(STRAW.mid, 1);
  ctx.lineWidth = ropeWidth;
  ctx.stroke();
}

const ROOF_FLAP_ENTRY: StarlightTentPropCatalogueEntry = {
  key: { prop: 'roofFlap', state: 'open', frame: 0 },
  box: ROOF_FLAP_BOX,
  painter: (target, originX, originY, size) => {
    paintFlapOpening(target, originX + size * TILE_MIDDLE, originY + FLAP_PEAK * size, size);
  },
};

const ROPE_LADDER_ENTRY: StarlightTentPropCatalogueEntry = {
  key: { prop: 'ropeLadder', state: 'hung', frame: 0 },
  box: ROPE_LADDER_BOX,
  painter: (target, originX, originY, size) => {
    paintLadder(
      target,
      originX + size * TILE_MIDDLE,
      originY + FLAP_BASE * size,
      originY + size,
      size,
    );
  },
};

/**
 * Where the rope ladder's foot meets the floor, in tiles: on the mast's
 * centre line, at the pole's south face. The ladder is painted from here and
 * the prompt to climb it stands here, so the two cannot drift apart.
 */
export function ropeLadderFoot(pole: TileRect): TilePoint {
  return { x: pole.x + pole.w / 2, y: pole.y + pole.h };
}

/** The pictures' tile is the one directly above the ladder's foot: the pole's bottom row. */
const LADDER_TILE_ROWS_ABOVE_FOOT = 1;

/** The tile both pictures are drawn at: the pole's bottom row, centred on the mast. */
function ladderTile(
  poleOriginX: number,
  poleOriginY: number,
  ts: number,
  blockWidth: number,
  blockHeight: number,
): { x: number; y: number } {
  const foot = ropeLadderFoot({ x: 0, y: 0, w: blockWidth, h: blockHeight });
  return {
    x: poleOriginX + (foot.x - TILE_MIDDLE) * ts,
    y: poleOriginY + (foot.y - LADDER_TILE_ROWS_ABOVE_FOOT) * ts,
  };
}

/**
 * The flap cut in the canvas where the king pole passes up through the roof.
 * Painted from the pole's top-left tile corner before the mast, so the mast
 * rises through the opening with the night showing either side of it.
 */
export function paintRoofFlap(
  ctx: Ctx,
  poleOriginX: number,
  poleOriginY: number,
  ts: number,
  blockWidth: number,
  blockHeight: number,
): void {
  const tile = ladderTile(poleOriginX, poleOriginY, ts, blockWidth, blockHeight);
  const { key, box, painter } = ROOF_FLAP_ENTRY;
  drawStarlightTentProp(ctx, key, box, painter, tile.x, tile.y, ts);
}

/**
 * The rope ladder hung down the king pole's south face from the flap, its
 * foot on the ring tile below the pole. Painted from the pole's top-left tile
 * corner after the mast, so it hangs in front of it.
 */
export function paintRopeLadder(
  ctx: Ctx,
  poleOriginX: number,
  poleOriginY: number,
  ts: number,
  blockWidth: number,
  blockHeight: number,
): void {
  const tile = ladderTile(poleOriginX, poleOriginY, ts, blockWidth, blockHeight);
  const { key, box, painter } = ROPE_LADDER_ENTRY;
  drawStarlightTentProp(ctx, key, box, painter, tile.x, tile.y, ts);
}
