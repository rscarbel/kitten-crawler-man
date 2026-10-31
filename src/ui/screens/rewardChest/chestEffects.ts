/**
 * The light and particles round the reward chest: the rarity glow behind it,
 * god rays and the column of light once it opens, the shockwave, the coins
 * and gems fountaining out, confetti, sparkle bursts where rewards land,
 * motes drifting over the open chest, the Divine chest's falling feathers and
 * the full-screen flashes.
 *
 * Every particle is a closed-form function of the frame and its own index,
 * so a skipped reveal and a gallery fixture show the same sky the live screen
 * would, and nothing here keeps state. Counts grow with `rarityRank`.
 */

import { rarityAtLeast, rarityRank, type Rarity } from '../../../core/items/defs/rarity';
import type { Rect } from '../../core/geom';
import type { Theme } from '../../theme/tokens';
import {
  SCATTER_STREAM as STREAM,
  paintLightColumn,
  paintMoteDrift,
  paintRayFan,
  paintScreenFlash,
  paintShockRing,
  paintSparkleBurst as paintSparkles,
} from '../celebration/celebrationLight';
import { FULL_TURN, paintSoftPool, scatter } from '../../../sprites/lightMaps';
import { rarityColor } from '../dialogs/canvasChrome';
import { progress, type ChestTimeline } from './chestTimeline';

export interface EffectScene {
  readonly ctx: CanvasRenderingContext2D;
  readonly theme: Theme;
  readonly timeline: ChestTimeline;
  readonly frame: number;
  readonly mouth: { readonly x: number; readonly y: number; readonly w: number };
  readonly chestWidth: number;
  readonly screen: Rect;
}

const HALF = 0.5;

function rank(scene: EffectScene): number {
  return rarityRank(scene.timeline.rarity);
}

function color(scene: EffectScene, shade: 'base' | 'light' | 'deep' | 'glow'): string {
  return rarityColor(scene.theme, scene.timeline.rarity, shade);
}

const BACKDROP_REACH = 1.6;
const BACKDROP_ALPHA = 0.32;
const BACKDROP_OPEN_ALPHA = 0.5;

/** A soft pool of the rarity's light behind the chest, brightening as it opens. */
export function paintBackdrop(scene: EffectScene): void {
  const { ctx, mouth, chestWidth, timeline, frame } = scene;
  const open = progress(frame, timeline.anticipationEnd, timeline.lidEnd);
  const reach = chestWidth * BACKDROP_REACH;
  const alpha = BACKDROP_ALPHA + (BACKDROP_OPEN_ALPHA - BACKDROP_ALPHA) * open;
  paintSoftPool(ctx, mouth.x, mouth.y, reach, reach, color(scene, 'glow'), alpha, 'linear');
  paintRays(scene);
}

const RAY_COUNT = 12;
const RAY_HALF_ANGLE = 0.11;
const RAY_REACH = 2.4;
const RAY_ALPHA = 0.32;
const RAY_TURN_PER_FRAME = 0.005;
const COUNTER_RAY_TURN_PER_FRAME = -0.008;
const COUNTER_RAY_ALPHA_SHARE = 0.6;
const RAY_FADE_IN_FRAMES = 12;
const COUNTER_RAYS_FROM: Rarity = 'Epic';

function paintRays(scene: EffectScene): void {
  const { frame, timeline } = scene;
  const fade = progress(
    frame,
    timeline.anticipationEnd,
    timeline.anticipationEnd + RAY_FADE_IN_FRAMES,
  );
  if (fade <= 0) return;
  rays(scene, color(scene, 'glow'), frame * RAY_TURN_PER_FRAME, RAY_ALPHA * fade);
  if (rarityAtLeast(timeline.rarity, COUNTER_RAYS_FROM)) {
    rays(
      scene,
      color(scene, 'light'),
      frame * COUNTER_RAY_TURN_PER_FRAME,
      RAY_ALPHA * COUNTER_RAY_ALPHA_SHARE * fade,
    );
  }
}

function rays(scene: EffectScene, tint: string, turn: number, alpha: number): void {
  const { ctx, mouth, chestWidth } = scene;
  const fan = {
    count: RAY_COUNT,
    halfAngle: RAY_HALF_ANGLE,
    reach: chestWidth * RAY_REACH,
    turn,
  };
  paintRayFan(ctx, mouth, fan, tint, alpha);
}

const COLUMN_HEIGHT = 3.2;
/** The column is faint over a plain chest, so its wooden lid still reads as wood, and grows with rarity. */
const COLUMN_ALPHA_BASE = 0.16;
const COLUMN_ALPHA_PER_RANK = 0.05;
const COLUMN_WIDEN = 1.35;
const SHOCKWAVE_FRAMES = 24;
const SHOCKWAVE_REACH = 2;
const SHOCKWAVE_WIDTH = 0.04;
const SHOCKWAVE_ALPHA = 0.7;

/** The column of light out of the open chest, and the ring thrown off as the lid goes back. */
export function paintColumn(scene: EffectScene): void {
  const { ctx, mouth, chestWidth, frame, timeline } = scene;
  const open = progress(frame, timeline.anticipationEnd, timeline.lidEnd);
  if (open <= 0) return;
  const column = {
    base: mouth,
    halfBase: mouth.w * HALF * open,
    widen: COLUMN_WIDEN,
    height: chestWidth * COLUMN_HEIGHT,
  };
  const columnAlpha = (COLUMN_ALPHA_BASE + rank(scene) * COLUMN_ALPHA_PER_RANK) * open;
  paintLightColumn(ctx, column, color(scene, 'glow'), columnAlpha);
  const ring = progress(
    frame,
    timeline.anticipationEnd,
    timeline.anticipationEnd + SHOCKWAVE_FRAMES,
  );
  if (ring > 0 && ring < 1) {
    const shock = {
      at: mouth,
      radius: chestWidth * SHOCKWAVE_REACH * ring,
      squash: HALF,
      lineWidth: chestWidth * SHOCKWAVE_WIDTH * (1 - ring),
    };
    paintShockRing(ctx, shock, color(scene, 'light'), SHOCKWAVE_ALPHA * (1 - ring));
  }
}

const FOUNTAIN_BASE = 14;
const FOUNTAIN_PER_RANK = 10;
const FOUNTAIN_SPREAD_FRAMES = 26;
const FOUNTAIN_LIFE = 70;
const FOUNTAIN_SPEED = 0.075;
const FOUNTAIN_SPEED_RANGE = 0.05;
/** Radians either side of straight up the fountain fans across. */
const FOUNTAIN_FAN = 0.9;
const GRAVITY = 0.0028;
const COIN_SIZE = 0.035;
const GEM_SHARE = 0.3;
const CONFETTI_BASE = 20;
const CONFETTI_PER_RANK = 16;
const CONFETTI_LIFE = 90;
const CONFETTI_SPEED = 0.06;
const CONFETTI_SPEED_RANGE = 0.07;
const CONFETTI_GRAVITY = 0.0012;
const CONFETTI_SIZE = 0.02;
const CONFETTI_ASPECT = 2.2;
const CONFETTI_SPIN = 0.25;
const SEED_FOUNTAIN = 100;
const SEED_CONFETTI = 500;

/** The coins and gems arcing out of the chest, and the confetti thrown as it bursts open. */
export function paintFountain(scene: EffectScene): void {
  const { ctx, mouth, chestWidth, frame, timeline, theme } = scene;
  const start = timeline.anticipationEnd;
  if (frame < start) return;
  const count = FOUNTAIN_BASE + rank(scene) * FOUNTAIN_PER_RANK;
  const gold = theme.palette.accent.celebrate;
  const goldLight = theme.palette.material.brassLight;
  const gemColors = [
    color(scene, 'base'),
    color(scene, 'light'),
    theme.palette.accent.celebrateCool,
  ];
  ctx.save();
  for (let i = 0; i < count; i++) {
    const born = start + scatter(SEED_FOUNTAIN + i) * FOUNTAIN_SPREAD_FRAMES;
    const age = frame - born;
    if (age < 0 || age > FOUNTAIN_LIFE) continue;
    const angle =
      -Math.PI * HALF + (scatter(SEED_FOUNTAIN + i * STREAM.angle) * 2 - 1) * FOUNTAIN_FAN;
    const speed = FOUNTAIN_SPEED + scatter(SEED_FOUNTAIN + i * STREAM.speed) * FOUNTAIN_SPEED_RANGE;
    const x = mouth.x + Math.cos(angle) * speed * age * chestWidth;
    const y = mouth.y + (Math.sin(angle) * speed * age + HALF * GRAVITY * age * age) * chestWidth;
    const life = 1 - age / FOUNTAIN_LIFE;
    const size = COIN_SIZE * chestWidth;
    ctx.globalAlpha = Math.min(1, life * 2);
    if (scatter(SEED_FOUNTAIN + i * STREAM.kind) < GEM_SHARE) {
      ctx.fillStyle = gemColors[i % gemColors.length] ?? gold;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * HALF, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size * HALF, y);
      ctx.closePath();
      ctx.fill();
    } else {
      const flip = Math.abs(Math.cos(age * CONFETTI_SPIN + i));
      ctx.fillStyle = i % 2 === 0 ? gold : goldLight;
      ctx.beginPath();
      ctx.ellipse(x, y, size * HALF * Math.max(flip, CONFETTI_SPIN), size * HALF, 0, 0, FULL_TURN);
      ctx.fill();
    }
  }
  const confetti = CONFETTI_BASE + rank(scene) * CONFETTI_PER_RANK;
  const palette = [
    color(scene, 'base'),
    color(scene, 'light'),
    theme.palette.accent.base,
    theme.palette.accent.celebrateCool,
    theme.palette.text.primary,
  ];
  for (let i = 0; i < confetti; i++) {
    const age = frame - start;
    if (age > CONFETTI_LIFE) break;
    const angle = scatter(SEED_CONFETTI + i) * FULL_TURN;
    const speed = CONFETTI_SPEED + scatter(SEED_CONFETTI + i * STREAM.speed) * CONFETTI_SPEED_RANGE;
    const drag = 1 - age / (CONFETTI_LIFE * 2);
    const x = mouth.x + Math.cos(angle) * speed * age * drag * chestWidth;
    const y =
      mouth.y +
      (Math.sin(angle) * speed * age * drag + HALF * CONFETTI_GRAVITY * age * age) * chestWidth;
    const size = CONFETTI_SIZE * chestWidth;
    ctx.globalAlpha = 1 - age / CONFETTI_LIFE;
    ctx.fillStyle = palette[i % palette.length] ?? gold;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(age * CONFETTI_SPIN * (scatter(SEED_CONFETTI + i * STREAM.spin) * 2 - 1));
    ctx.fillRect(-size * HALF, -size * HALF, size, size * CONFETTI_ASPECT);
    ctx.restore();
  }
  ctx.restore();
}

const SPARKLE_BASE = 8;
const SPARKLE_PER_RANK = 3;
const SPARKLE_FRAMES = 26;
const SPARKLE_REACH = 0.32;
const SPARKLE_SIZE = 0.03;

/** A burst of four-pointed sparkles at `at`, `landAt` being the frame the reward landed there. */
export function paintSparkleBurst(
  scene: EffectScene,
  at: { readonly x: number; readonly y: number },
  landAt: number,
  tint: string,
  seed: number,
): void {
  const { ctx, frame, chestWidth, theme } = scene;
  const burst = {
    at,
    progress: (frame - landAt) / SPARKLE_FRAMES,
    count: SPARKLE_BASE + rank(scene) * SPARKLE_PER_RANK,
    reach: chestWidth * SPARKLE_REACH,
    size: chestWidth * SPARKLE_SIZE,
    seed,
  };
  paintSparkles(ctx, burst, tint, theme.palette.text.primary);
}

const MOTE_BASE = 6;
const MOTE_PER_RANK = 3;
const MOTE_PERIOD = 150;
const MOTE_RISE = 1.4;
const MOTE_SWAY = 0.08;
const MOTE_SIZE = 0.018;
const FEATHER_COUNT = 14;
const FEATHER_PERIOD = 220;
const FEATHER_SWAY = 0.35;
const FEATHER_SWAY_PER_FRAME = 0.04;
const FEATHER_LENGTH = 0.09;
const FEATHERS_FROM: Rarity = 'Divine';
const SEED_MOTE = 1300;
const SEED_FEATHER = 1700;

/** Motes drifting up off the open chest, and the Divine chest's feathers falling past it. */
export function paintAmbient(scene: EffectScene): void {
  const { ctx, mouth, chestWidth, frame, timeline, screen, theme } = scene;
  if (frame < timeline.lidEnd) return;
  const age = frame - timeline.lidEnd;
  const drift = {
    origin: mouth,
    spread: mouth.w,
    rise: MOTE_RISE * chestWidth,
    sway: MOTE_SWAY * chestWidth,
    count: MOTE_BASE + rank(scene) * MOTE_PER_RANK,
    size: MOTE_SIZE * chestWidth,
    age,
    period: MOTE_PERIOD,
    swayPerFrame: FEATHER_SWAY_PER_FRAME,
    seed: SEED_MOTE,
  };
  paintMoteDrift(ctx, drift, [color(scene, 'glow'), color(scene, 'light')]);
  const held = timeline.beats.find((b) => b.held);
  if (!rarityAtLeast(timeline.rarity, FEATHERS_FROM) || held === undefined) return;
  if (frame < held.riseAt) return;
  const since = frame - held.riseAt;
  ctx.save();
  for (let i = 0; i < FEATHER_COUNT; i++) {
    const fall =
      ((since + scatter(SEED_FEATHER + i) * FEATHER_PERIOD) % FEATHER_PERIOD) / FEATHER_PERIOD;
    const x =
      screen.x +
      scatter(SEED_FEATHER + i * STREAM.swing) * screen.w +
      Math.sin(since * FEATHER_SWAY_PER_FRAME + i) * FEATHER_SWAY * chestWidth;
    const y = screen.y + fall * screen.h;
    const length = FEATHER_LENGTH * chestWidth;
    ctx.globalAlpha = Math.sin(fall * Math.PI);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(since * FEATHER_SWAY_PER_FRAME + i * 2) * FEATHER_SWAY);
    ctx.fillStyle = theme.palette.accent.celebrate;
    ctx.beginPath();
    ctx.moveTo(0, -length);
    ctx.quadraticCurveTo(length * HALF, 0, 0, length);
    ctx.quadraticCurveTo(-length * HALF, 0, 0, -length);
    ctx.fill();
    ctx.strokeStyle = theme.palette.material.brassLight;
    ctx.lineWidth = Math.max(1, length * SPARKLE_SIZE);
    ctx.beginPath();
    ctx.moveTo(0, -length);
    ctx.lineTo(0, length);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

const FLASH_FRAMES = 14;
const FLASH_ALPHA_BASE = 0.35;
const FLASH_ALPHA_PER_RANK = 0.1;
const HOLD_FLASH_ALPHA = 0.85;

/** The screen-wide flash as the lid bursts back, and again as a held reward rises. */
export function paintFlash(scene: EffectScene): void {
  const { ctx, frame, timeline, screen } = scene;
  const flashes: { at: number; alpha: number }[] = [
    { at: timeline.anticipationEnd, alpha: FLASH_ALPHA_BASE + rank(scene) * FLASH_ALPHA_PER_RANK },
  ];
  const held = timeline.beats.find((b) => b.held);
  if (held !== undefined) flashes.push({ at: held.riseAt, alpha: HOLD_FLASH_ALPHA });
  for (const flash of flashes) {
    const p = progress(frame, flash.at, flash.at + FLASH_FRAMES);
    if (p <= 0 || p >= 1) continue;
    paintScreenFlash(ctx, screen, color(scene, 'glow'), flash.alpha * (1 - p));
  }
}

const DUST_PUFFS = 10;
const DUST_FRAMES = 22;
const DUST_REACH = 0.7;
const DUST_SIZE = 0.09;
const DUST_ALPHA = 0.35;

/** A puff of dust either side of the chest as it lands. */
export function paintDust(
  scene: EffectScene,
  base: { readonly x: number; readonly y: number },
): void {
  const { ctx, frame, timeline, chestWidth, theme } = scene;
  const p = progress(frame, timeline.dropEnd, timeline.dropEnd + DUST_FRAMES);
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.fillStyle = theme.palette.text.secondary;
  for (let i = 0; i < DUST_PUFFS; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const spread = (HALF + HALF * scatter(i + 2)) * DUST_REACH * p;
    const x = base.x + side * chestWidth * (HALF + spread);
    const y = base.y - chestWidth * DUST_SIZE * scatter(i * STREAM.rise) * p * 2;
    ctx.globalAlpha = DUST_ALPHA * (1 - p);
    ctx.beginPath();
    ctx.arc(x, y, chestWidth * DUST_SIZE * (HALF + p), 0, FULL_TURN);
    ctx.fill();
  }
  ctx.restore();
}
