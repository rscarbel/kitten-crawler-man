/**
 * Drawing engine for the Level 3 wilderness's goblin camp.
 *
 * Two props: a hide tent and a campfire. Both are painted from one palette of
 * scavenged materials — untanned hide, unbarked poles, scorched stone — because
 * the whole point of the camp is that it reads as *thrown together*, next to a
 * circus half a map away whose canvas is dyed, striped and pitched square.
 *
 * A tent is drawn skeleton-then-dress like the trees and the boulders: the poles
 * and the hide panels are derived from the seed once, then painted. That is what
 * lets four tents share a silhouette family without four hand-tuned drawings.
 *
 * The campfire has an animated flame row, driven the way a torch's is — the
 * renderer reads the shared `frameTime` and picks a frame, and the tile type is
 * deliberately kept out of `CACHEABLE_OVERLAY_TYPES` so it redraws each frame.
 *
 * Everything is expressed in multiples of `tileScale`, so the sheets can be
 * baked at any resolution without hand-tuned pixel constants drifting apart.
 * Light comes from the upper left, matching every other prop in the repo.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { mulberry32, range, subSeed, type Rng } from '../src/sprites/person/rng.js';

/** The cell a camp prop is painted into, in absolute sheet pixels. */
export interface CampFrame {
  /** Left edge of the anchor tile. */
  readonly originX: number;
  /** Top edge of the anchor tile. */
  readonly originY: number;
  readonly bottomY: number;
  readonly tileScale: number;
}

const TWO_PI = Math.PI * 2;

/**
 * Untanned hide and unbarked poles. Deliberately drab: the circus's tents are
 * the saturated ones, and a goblin camp that competed with them for the eye
 * would read as a second fairground.
 */
const HIDE_SHADOW = '#4a3a2a';
const HIDE_BODY = '#7a6446';
const HIDE_LIGHT = '#9a8460';
const HIDE_PATCH = '#6b533a';
const POLE_COLOR = '#5c4a30';
const POLE_LIGHT = '#7d6741';
const LASHING_COLOR = '#8c7a52';
const GROUND_SHADOW = 'rgba(0,0,0,0.34)';

/** Scorched stone, charred wood and ash. */
const HEARTH_STONE = '#6b665e';
const HEARTH_STONE_LIGHT = '#8b857a';
const HEARTH_STONE_DARK = '#453f39';
const ASH_COLOR = '#5a534b';
const LOG_COLOR = '#4a3527';
const LOG_CHARRED = '#2b2320';
const EMBER_COLOR = '#d4632a';

/** Flame gradient stops, hottest first. */
const FLAME_CORE = '#ffe9a8';
const FLAME_MID = '#ff9b32';
const FLAME_EDGE = '#d4451c';

/** Tent geometry, in tiles. A tent is squat and wide — a goblin is not tall. */
const TENT_HALF_WIDTH_TILES = 0.78;
/** Per-tent width variation. Without it four seeds differ only in height and
 *  lean, and a camp of them reads as one tent copied four times. */
const TENT_WIDTH_JITTER = 0.16;
const TENT_HEIGHT_TILES = 0.95;
const TENT_HEIGHT_JITTER = 0.2;
const TENT_LEAN_TILES = 0.16;
/** How far the ridge pole overshoots the apex, as a fraction of the height. */
const POLE_OVERSHOOT = 0.22;
const POLE_WIDTH_TILES = 0.05;
const TENT_PANELS = 4;
/** Sag in the hide between panels, as a fraction of the tent's height. */
const PANEL_SAG = 0.07;
const PATCH_COUNT = 4;
const PATCH_MIN_RADIUS_TILES = 0.07;
const PATCH_RADIUS_RANGE_TILES = 0.09;
const PATCH_ALPHA = 0.55;
/** The dark slot of the entrance, as fractions of the tent. */
const DOOR_HALF_WIDTH = 0.2;
const DOOR_HEIGHT = 0.62;
const DOOR_COLOR = '#241c14';
const LASHING_COUNT = 3;
const LASHING_WIDTH_TILES = 0.028;

/** Contact shadow under a tent's skirt. */
const TENT_SHADOW_HEIGHT_TILES = 0.1;

/**
 * How far the tent's foot sits above the anchor tile's bottom edge.
 *
 * The frame's bottom edge *is* the anchor tile's bottom edge, so a foot placed
 * exactly on it has no room for the round line caps on the poles, the stroke
 * around the hide panels, or the contact shadow — all of which then reach past
 * the cell and are sheared off by `renderSheet`'s clip. The border verifier
 * rejected the first bake for precisely that.
 */
const TENT_BASE_LIFT_TILES = 0.14;

/** Campfire geometry, in tiles. */
const HEARTH_STONES = 7;
const HEARTH_RADIUS_TILES = 0.34;
const HEARTH_STONE_RADIUS_TILES = 0.075;
const ASH_RADIUS_TILES = 0.24;
const LOG_COUNT = 3;
const LOG_LENGTH_TILES = 0.42;
const LOG_WIDTH_TILES = 0.07;
const EMBER_COUNT = 5;
const EMBER_RADIUS_TILES = 0.022;

/** Flame: how tall it climbs and how much it breathes across the loop. */
const FLAME_HEIGHT_TILES = 0.62;
const FLAME_WIDTH_TILES = 0.2;
const FLAME_BREATH = 0.22;
const FLAME_TONGUES = 3;
const FLAME_GLOW_RADIUS_TILES = 0.7;
const FLAME_GLOW_ALPHA = 0.3;

interface TentPanel {
  readonly footX: number;
  readonly sag: number;
}

interface TentSkeleton {
  readonly apexX: number;
  readonly apexY: number;
  readonly baseY: number;
  readonly halfWidth: number;
  readonly panels: ReadonlyArray<TentPanel>;
}

function buildTent(seed: number, frame: CampFrame): TentSkeleton {
  const ts = frame.tileScale;
  const rng: Rng = mulberry32(subSeed(seed, 1));
  const centreX = frame.originX + ts / 2;
  const baseY = frame.originY + ts - ts * TENT_BASE_LIFT_TILES;
  const halfWidth =
    ts * (TENT_HALF_WIDTH_TILES + range(rng, -TENT_WIDTH_JITTER, TENT_WIDTH_JITTER));
  const height = ts * (TENT_HEIGHT_TILES + range(rng, -TENT_HEIGHT_JITTER, TENT_HEIGHT_JITTER));
  const lean = ts * range(rng, -TENT_LEAN_TILES, TENT_LEAN_TILES);

  const panels: TentPanel[] = [];
  for (let panel = 0; panel <= TENT_PANELS; panel++) {
    const across = panel / TENT_PANELS;
    panels.push({
      footX: centreX - halfWidth + across * halfWidth * 2,
      sag: panel === 0 || panel === TENT_PANELS ? 0 : rng() * PANEL_SAG,
    });
  }

  return { apexX: centreX + lean, apexY: baseY - height, baseY, halfWidth, panels };
}

/**
 * A hide tent: two lashed poles, sagging panels stretched between them, patches,
 * and a dark slot for a door.
 */
export function drawGoblinTent(ctx: Ctx, seed: number, frame: CampFrame): void {
  const ts = frame.tileScale;
  const tent = buildTent(seed, frame);
  const { apexX, apexY, baseY, halfWidth, panels } = tent;
  const height = baseY - apexY;

  // Ground shadow first, so the tent sits on it. Clamped to the room below the
  // ground line — the cell's bottom edge is the anchor tile's bottom edge, and a
  // shadow sized purely by taste bakes as a hard horizontal cut.
  const shadowHeight = Math.min(ts * TENT_SHADOW_HEIGHT_TILES, frame.bottomY - baseY);
  if (shadowHeight > 0) {
    ctx.save();
    ctx.translate(apexX, baseY);
    ctx.scale(1, shadowHeight / halfWidth);
    // Built after the transform and centred on the local origin: a canvas
    // gradient resolves its coordinates in the user space in effect when it is
    // *painted*, so one built at (apexX, baseY) and painted under a translate to
    // the same point lands at twice the offset and fills nothing at all.
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, halfWidth);
    shadow.addColorStop(0, GROUND_SHADOW);
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, halfWidth, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  // Poles, drawn behind the hide so only their overshoot shows above the apex.
  const overshoot = height * POLE_OVERSHOOT;
  ctx.lineWidth = ts * POLE_WIDTH_TILES;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.strokeStyle = side < 0 ? POLE_LIGHT : POLE_COLOR;
    ctx.beginPath();
    ctx.moveTo(apexX - side * halfWidth, baseY);
    ctx.lineTo(apexX + side * (overshoot * POLE_OVERSHOOT), apexY - overshoot);
    ctx.stroke();
  }

  // The hide, one panel at a time so each can sag independently — a taut cone
  // reads as a manufactured tent, which is the one thing this must not be.
  panels.forEach((panel, index) => {
    if (index === panels.length - 1) return;
    const next = panels[index + 1];
    const lit = panel.footX < apexX;
    ctx.fillStyle = lit ? HIDE_LIGHT : HIDE_BODY;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(panel.footX, baseY - panel.sag * height);
    ctx.lineTo(next.footX, baseY - next.sag * height);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = HIDE_SHADOW;
    ctx.lineWidth = ts * LASHING_WIDTH_TILES;
    ctx.stroke();
  });

  // Patches: the hide is stitched together from whatever was to hand.
  const patchRng: Rng = mulberry32(subSeed(seed, 2));
  ctx.fillStyle = HIDE_PATCH;
  ctx.globalAlpha = PATCH_ALPHA;
  for (let patch = 0; patch < PATCH_COUNT; patch++) {
    const across = range(patchRng, -1, 1);
    const up = patchRng();
    ctx.beginPath();
    ctx.arc(
      apexX + across * halfWidth * (1 - up),
      baseY - up * height,
      ts * (PATCH_MIN_RADIUS_TILES + patchRng() * PATCH_RADIUS_RANGE_TILES),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Lashings across the hide, and the door slot.
  ctx.strokeStyle = LASHING_COLOR;
  ctx.lineWidth = ts * LASHING_WIDTH_TILES;
  for (let lashing = 1; lashing <= LASHING_COUNT; lashing++) {
    const up = lashing / (LASHING_COUNT + 1);
    const spread = halfWidth * (1 - up);
    ctx.beginPath();
    ctx.moveTo(apexX - spread, baseY - up * height);
    ctx.lineTo(apexX + spread, baseY - up * height);
    ctx.stroke();
  }

  ctx.fillStyle = DOOR_COLOR;
  ctx.beginPath();
  ctx.moveTo(apexX, baseY - DOOR_HEIGHT * height);
  ctx.lineTo(apexX - DOOR_HALF_WIDTH * halfWidth, baseY);
  ctx.lineTo(apexX + DOOR_HALF_WIDTH * halfWidth, baseY);
  ctx.closePath();
  ctx.fill();
}

/**
 * A campfire: a ring of scorched stones, ash, charred logs, embers, and a flame
 * that breathes across the loop.
 *
 * `frame` and `frameCount` drive the flame only — the hearth is identical in
 * every frame, so a fire never appears to shuffle its own stones.
 */
export function drawCampfire(
  ctx: Ctx,
  seed: number,
  animFrame: number,
  frameCount: number,
  frame: CampFrame,
): void {
  const ts = frame.tileScale;
  const centreX = frame.originX + ts / 2;
  const centreY = frame.originY + ts / 2;
  const rng: Rng = mulberry32(subSeed(seed, 1));

  // Ash bed.
  ctx.fillStyle = ASH_COLOR;
  ctx.beginPath();
  ctx.arc(centreX, centreY, ts * ASH_RADIUS_TILES, 0, TWO_PI);
  ctx.fill();

  // Hearth ring.
  for (let stone = 0; stone < HEARTH_STONES; stone++) {
    const angle = (stone / HEARTH_STONES) * TWO_PI + rng() * (TWO_PI / HEARTH_STONES);
    const stoneX = centreX + Math.cos(angle) * ts * HEARTH_RADIUS_TILES;
    const stoneY = centreY + Math.sin(angle) * ts * HEARTH_RADIUS_TILES;
    const radius = ts * HEARTH_STONE_RADIUS_TILES * (1 + rng() * PANEL_SAG * 2);
    ctx.fillStyle = HEARTH_STONE_DARK;
    ctx.beginPath();
    ctx.arc(stoneX, stoneY + radius / 2, radius, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = HEARTH_STONE;
    ctx.beginPath();
    ctx.arc(stoneX, stoneY, radius, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = HEARTH_STONE_LIGHT;
    ctx.beginPath();
    ctx.arc(stoneX - radius / 3, stoneY - radius / 3, radius / 2, 0, TWO_PI);
    ctx.fill();
  }

  // Logs, leaning into the middle.
  ctx.lineCap = 'round';
  for (let log = 0; log < LOG_COUNT; log++) {
    const angle = (log / LOG_COUNT) * TWO_PI + rng();
    const length = ts * LOG_LENGTH_TILES;
    ctx.strokeStyle = log % 2 === 0 ? LOG_COLOR : LOG_CHARRED;
    ctx.lineWidth = ts * LOG_WIDTH_TILES;
    ctx.beginPath();
    ctx.moveTo(centreX + Math.cos(angle) * length, centreY + (Math.sin(angle) * length) / 2);
    ctx.lineTo(centreX - Math.cos(angle) * length * 0.2, centreY);
    ctx.stroke();
  }

  // Embers.
  ctx.fillStyle = EMBER_COLOR;
  for (let ember = 0; ember < EMBER_COUNT; ember++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * ts * ASH_RADIUS_TILES;
    ctx.beginPath();
    ctx.arc(
      centreX + Math.cos(angle) * reach,
      centreY + (Math.sin(angle) * reach) / 2,
      ts * EMBER_RADIUS_TILES,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // Flame. `breath` runs a full cycle over the loop so the last frame meets the
  // first without a jump.
  const breath = 1 + Math.sin((animFrame / frameCount) * TWO_PI) * FLAME_BREATH;
  const flameHeight = ts * FLAME_HEIGHT_TILES * breath;
  const flameWidth = ts * FLAME_WIDTH_TILES;

  // Squashed to an ellipse, not a disc. Two reasons, and they agree: the frame's
  // bottom edge is the anchor tile's bottom edge and a full-radius glow reaches
  // well past it — the border verifier rejected the bake for exactly that — and
  // firelight pooling on the ground seen from above *is* an ellipse. The
  // vertical radius is whatever room is left below the hearth.
  const glowRadius = ts * FLAME_GLOW_RADIUS_TILES * breath;
  const glowVerticalRadius = Math.min(glowRadius, frame.bottomY - centreY);
  if (glowVerticalRadius > 0) {
    ctx.save();
    ctx.translate(centreX, centreY);
    ctx.scale(1, glowVerticalRadius / glowRadius);
    // Built after the transform and centred on the local origin — a canvas
    // gradient resolves its coordinates in the user space in effect when it is
    // painted, not when it is created.
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    glow.addColorStop(0, `rgba(255,150,60,${FLAME_GLOW_ALPHA})`);
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  const flameRng: Rng = mulberry32(subSeed(seed, 2));
  for (let tongue = 0; tongue < FLAME_TONGUES; tongue++) {
    const lean = range(flameRng, -1, 1);
    const scale = 1 - tongue / (FLAME_TONGUES + 1);
    const sway = Math.sin((animFrame / frameCount) * TWO_PI + tongue) * flameWidth * 0.5;
    const tipY = centreY - flameHeight * scale;
    ctx.fillStyle = tongue === 0 ? FLAME_EDGE : tongue === 1 ? FLAME_MID : FLAME_CORE;
    ctx.beginPath();
    ctx.moveTo(centreX - flameWidth * scale, centreY);
    ctx.quadraticCurveTo(
      centreX + lean * flameWidth + sway,
      centreY - flameHeight * scale * 0.6,
      centreX + sway,
      tipY,
    );
    ctx.quadraticCurveTo(
      centreX + lean * flameWidth + sway,
      centreY - flameHeight * scale * 0.4,
      centreX + flameWidth * scale,
      centreY,
    );
    ctx.closePath();
    ctx.fill();
  }
}
