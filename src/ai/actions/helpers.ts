import { playerCharacter } from '../../characters/characters';
import type { BoxTier } from '../../core/AchievementManager';
import { TILE_SIZE } from '../../core/constants';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { getLevelDef, type LevelDef } from '../../levels';
import type { ToastOptions } from '../../ui/hud/toasts';
import { optionalEnumParam } from './schema';
import type { AISceneContext, AITargetCrawler } from './types';

export type Crawler = HumanPlayer | CatPlayer;

/** The character names the governor knows specific rules for. */
export const AI_CHARACTER_SYSTEM = 'System';
export const AI_CHARACTER_MORDECAI = 'Mordecai';
export const AI_CHARACTER_VIEWERS = 'Viewers';

/** The box tiers the AI may hand out; the rarer ones are not its to give. */
export const AI_BOX_TIERS = ['Bronze', 'Silver', 'Gold'] as const satisfies readonly BoxTier[];
export type AIBoxTier = (typeof AI_BOX_TIERS)[number];
/** Allowance points each tier draws from the floor's loot-box pool. */
export const BOX_TIER_POINTS: Readonly<Record<AIBoxTier, number>> = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
};

export const TARGET_PARAM = optionalEnumParam(
  'target_player',
  ['active', 'Human', 'Cat'],
  `Which crawler: the one the player is driving (active), ${playerCharacter('human').displayName} (Human) or ${playerCharacter('cat').displayName} (Cat).`,
  'active',
);

export function activeCrawler(scene: AISceneContext): Crawler {
  const human = scene.getHuman();
  return human.isActive ? human : scene.getCat();
}

export function resolveTarget(scene: AISceneContext, target: 'active' | 'Human' | 'Cat'): Crawler {
  if (target === 'Human') return scene.getHuman();
  if (target === 'Cat') return scene.getCat();
  return activeCrawler(scene);
}

export function crawlerKind(scene: AISceneContext, crawler: Crawler): AITargetCrawler {
  return crawler === scene.getHuman() ? 'human' : 'cat';
}

export function crawlerName(scene: AISceneContext, crawler: Crawler): string {
  return playerCharacter(crawlerKind(scene, crawler)).displayName;
}

export function bothCrawlers(scene: AISceneContext): readonly Crawler[] {
  return [scene.getHuman(), scene.getCat()];
}

export function tileOf(point: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
}

/** The current floor's definition, or null for a scene whose id names no floor. */
export function levelDefOf(scene: AISceneContext): LevelDef | null {
  try {
    return getLevelDef(scene.getLevelId());
  } catch {
    return null;
  }
}

/** Floor depth, 1-based; a scene with no floor counts as the first. */
export function floorNumberOf(scene: AISceneContext): number {
  return Math.max(1, levelDefOf(scene)?.floorNumber ?? 1);
}

/**
 * Shows a line to the player: a toast when the scene offers one, otherwise
 * the active crawler's System notice queue, which every scene drains.
 */
export function notifyPlayer(scene: AISceneContext, text: string, opts?: ToastOptions): void {
  if (scene.postToast !== undefined) {
    scene.postToast(text, opts);
    return;
  }
  activeCrawler(scene).queueSystemNotice(text);
}

export function snakeToWords(id: string): string {
  return id.replace(/_/g, ' ');
}

const SECONDS_PER_MINUTE = 60;
export const FRAMES_PER_SECOND = 60;
export const MS_PER_SECOND = 1000;

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FRAMES_PER_SECOND);
}

export function formatSeconds(seconds: number): string {
  const whole = Math.round(Math.abs(seconds));
  if (whole < SECONDS_PER_MINUTE) return `${whole}s`;
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Eight compass words for a direction in screen space (y grows downward). */
const COMPASS = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const;
const COMPASS_SECTORS = COMPASS.length;
const FULL_TURN = Math.PI * 2;

export function compassDirection(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) + FULL_TURN) % FULL_TURN;
  const sector = Math.round(angle / (FULL_TURN / COMPASS_SECTORS)) % COMPASS_SECTORS;
  return COMPASS[sector];
}
