/**
 * The ring's own dressing: the dead audience in the tiered stands on the
 * chamber's rim, the rail of bulbs in front of them, and the trapeze hanging
 * still from the king pole's rigging.
 *
 * The stands are wall-hung dressing drawn live through `bigTopPropCache`,
 * one tile of one tier at a time. The trapeze is painted with the king pole
 * in the Y-sorted decoration pass, so it blocks nothing and a crawler walking
 * under it is drawn beneath it.
 */

import { drawRadialGlow, type GlowStop } from '../../radialGlow';
import { hashUnit } from '../../flameStamps';
import type { RGB } from '../town/townPalette';
import { mix, shade } from '../town/townPalette';
import {
  drawBigTopProp,
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
  HALF_TURN,
  IRON,
  LIMELIGHT,
  NAVY,
  ROT_TIMBER,
  STRAW,
  inkCurrentPath,
  loopFrame,
  outlineWidth,
  quantise,
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
  /**
   * How far the cure has let the dead go: 0 while the vine still holds them
   * upright, swaying as one; 1 once they have slumped still in their seats.
   */
  readonly slump: number;
  /** Every bulb in the tent is up: the front rail's bulbs are lit. */
  readonly bulbsLit: boolean;
}

export const RING_BLEACHER_TIERS = 3;
const SPECTATOR_VARIANTS = 3;
const SWAY_FRAMES = 4;
/** One slow sway of the whole crowd, held up by the vine like puppets. */
const SWAY_PERIOD_FRAMES = 120;
/** The sway is offset seat by seat so the crowd rolls rather than bobbing in lockstep. */
const SWAY_STAGGER_FRAMES = 23;
const SLUMP_LEVELS = 4;

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
/** How far, in radians, a slumped head tips its hat toward the ring. */
const SLUMP_HAT_TILT = 0.4;
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
/** A slumped body sags this far down its seat and its head drops forward onto its chest. */
const SLUMP_DROP = 0.14;
const SLUMP_HEAD_FORWARD = 0.1;
const SLUMP_HEAD_DROP = 0.16;
const BALLOON_STRING_HEIGHT = 0.5;
const BALLOON_RADIUS = 0.07;
/** The balloon's wrist sits this share of the torso's width toward the ring, and this share of its height up. */
const BALLOON_WRIST_REACH = 0.4;
const BALLOON_WRIST_HEIGHT = 0.4;
/** A slumped body pulls its balloon down by this share of its own sag. */
const BALLOON_SLUMP_FOLLOW = 0.5;
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
  readonly slump: number;
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
  const drop = SLUMP_DROP * pose.slump * size;
  const torsoBottom = originY + TORSO_BOTTOM * size;
  const torsoTop = torsoBottom - TORSO_HEIGHT * size + drop;
  const torsoLeft = benchX - (TORSO_WIDTH * size) / 2;
  const headX =
    benchX + pose.facing * (pose.lean * SWAY_REACH + pose.slump * SLUMP_HEAD_FORWARD) * size;
  const headY =
    torsoTop - HEAD_RADIUS * size * HEAD_NECK_SINK + pose.slump * SLUMP_HEAD_DROP * size;

  // A child's balloon, long deflated, still tied to one wrist.
  if (variant === SPECTATOR_VARIANTS - 1) {
    const stringX = benchX + pose.facing * TORSO_WIDTH * size * BALLOON_WRIST_REACH;
    const balloonY = torsoTop - BALLOON_STRING_HEIGHT * size + drop * BALLOON_SLUMP_FOLLOW;
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

  const tilt = pose.facing * pose.slump * SLUMP_HAT_TILT;
  ctx.save();
  try {
    ctx.translate(headX, headY - HEAD_RADIUS * size * HAT_SEAT_HEIGHT);
    ctx.rotate(tilt);
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
  readonly bulbsLit: boolean;
  readonly slumpLevel: number;
}

/** A seat's balloon string and a raised row's heads rise above the seat's own tile. */
const SEAT_BOX: BigTopPropBox = { left: 0, top: -0.75, width: 1, height: 1.75 };

function seatEntry(look: SeatLook, swayFrame: number): BigTopPropCatalogueEntry {
  // The riser drops on the ring side and the bench runs down into the next
  // seat, so a stand's column of seats meets without a seam.
  const riserSide = look.side === 'west' ? 'right' : 'left';
  return {
    key: {
      prop: 'ringBleacher',
      state: `${look.side}-${look.tier}-${look.variant}-${look.bulbsLit ? 'lit' : 'dark'}-${look.slumpLevel}`,
      frame: swayFrame,
    },
    box: SEAT_BOX,
    painter: (target, originX, originY, px) =>
      paintBleacherSeat(target, originX, originY, px, look, swayFrame),
    openEdges: ['bottom', riserSide],
  };
}

/** Every seat picture the stands can ask the prop cache for, for the art gate. */
export function finalePropCatalogue(): ReadonlyArray<BigTopPropCatalogueEntry> {
  const entries: BigTopPropCatalogueEntry[] = [];
  for (const side of ['west', 'east'] as const) {
    for (let tier = 0; tier < RING_BLEACHER_TIERS; tier++) {
      for (let variant = 0; variant < SPECTATOR_VARIANTS; variant++) {
        for (const bulbsLit of tier === 0 ? [false, true] : [false]) {
          for (let swayFrame = 0; swayFrame < SWAY_FRAMES; swayFrame++) {
            entries.push(seatEntry({ side, tier, variant, bulbsLit, slumpLevel: 0 }, swayFrame));
          }
          for (let slumpLevel = 1; slumpLevel <= SLUMP_LEVELS; slumpLevel++) {
            entries.push(seatEntry({ side, tier, variant, bulbsLit, slumpLevel }, 0));
          }
        }
      }
    }
  }
  return entries;
}

function paintBleacherSeat(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  art: SeatLook,
  swayFrame: number,
): void {
  const variant = art.variant;
  const slumpLevel = art.slumpLevel;
  const tier = Math.max(0, Math.min(RING_BLEACHER_TIERS - 1, art.tier));
  const dim = 1 - TIER_DIMMING * tier;
  const facing = art.side === 'west' ? 1 : -1;
  const lift = TIER_RISE * tier * size;
  const top = originY - lift;
  // The bench runs along the tile on the side away from the ring; the riser
  // drops at the ring side, down to the next row forward.
  const benchCentre = originX + size / 2 - facing * size * BENCH_SET_BACK;
  const benchLeft = benchCentre - (BENCH_WIDTH * size) / 2;
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

  const swayCycle = (swayFrame / SWAY_FRAMES) * FULL_TURN;
  const slump = slumpLevel / SLUMP_LEVELS;
  const pose: SeatPose = {
    facing,
    lean: slumpLevel === 0 ? Math.sin(swayCycle) : 0,
    slump,
  };
  paintSpectator(ctx, benchCentre, top, size, variant, pose, dim);

  if (tier === 0) {
    const railX =
      facing > 0 ? originX + size * RAIL_EAST_EDGE_X : originX + size * RAIL_WEST_EDGE_X;
    ctx.fillStyle = rgba(shade(BRASS.shadow, dim), 1);
    ctx.fillRect(railX - (RAIL_WIDTH * size) / 2, originY, RAIL_WIDTH * size, size);
    for (let bulb = 0; bulb < BULBS_PER_SEAT; bulb++) {
      const bulbY = originY + ((bulb + 0.5) / BULBS_PER_SEAT) * size;
      ctx.fillStyle = art.bulbsLit ? rgba(LIMELIGHT.accent, 1) : rgba(IRON.shadow, 1);
      ctx.beginPath();
      ctx.arc(railX, bulbY, BULB_RADIUS * size, 0, FULL_TURN);
      ctx.fill();
      ctx.lineWidth = outlineWidth(size);
      ctx.strokeStyle = rgba(BRASS.mid, 1);
      ctx.stroke();
    }
  }
}

const BULB_GLOW_RADIUS = 0.45;
const BULB_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(252,236,190,0.55)' },
  { offset: 0.4, color: 'rgba(248,210,150,0.2)' },
  { offset: 1, color: 'rgba(248,200,140,0)' },
];

/** One seat of the ring's stands, with its dead spectator and, on the front row, the rail of bulbs. */
export function drawRingBleacher(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: RingBleacherArt,
): void {
  const variant = spectatorVariant(art.seed);
  const slumpLevel = quantise(art.slump, SLUMP_LEVELS);
  const swayFrame =
    slumpLevel === 0
      ? loopFrame(art.phase + art.seed * SWAY_STAGGER_FRAMES, SWAY_PERIOD_FRAMES, SWAY_FRAMES)
      : 0;
  const bulbsLit = art.tier === 0 && art.bulbsLit;
  const entry = seatEntry(
    { side: art.side, tier: art.tier, variant, bulbsLit, slumpLevel },
    swayFrame,
  );
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
  if (bulbsLit) {
    const railX = art.side === 'west' ? x + size * RAIL_EAST_EDGE_X : x + size * RAIL_WEST_EDGE_X;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      drawRadialGlow(ctx, railX, y + size / 2, BULB_GLOW_RADIUS * size, BULB_GLOW_STOPS);
    } finally {
      ctx.restore();
    }
  }
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
