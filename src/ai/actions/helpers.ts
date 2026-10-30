import { crawlerAIName, crawlerDisplayName } from '../../characters/characters';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../core/constants';
import { ITEM_DEF, itemAIName } from '../../core/items/defs/ItemDefs';
import type { Rarity } from '../../core/items/defs/rarity';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { getLevelDef, type LevelDef } from '../../levels';
import type { ToastOptions } from '../../ui/hud/toasts';
import { CAROLINE_CHARACTER_NAME, DAVE_CHARACTER_NAME } from '../characters';
import { optionalEnumParam } from './schema';
import type { AISceneContext, AITargetCrawler, ResultNamer } from './types';

export type Crawler = HumanPlayer | CatPlayer;

/** The character names the governor knows specific rules for. */
export const AI_CHARACTER_CAROLINE = CAROLINE_CHARACTER_NAME;
export const AI_CHARACTER_DAVE = DAVE_CHARACTER_NAME;

/** The reward chest rarities the AI may hand out; the rarer ones are not its to give. */
export const AI_CHEST_RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
] as const satisfies readonly Rarity[];
export type AIChestRarity = (typeof AI_CHEST_RARITIES)[number];
/** Allowance points each rarity draws from the floor's reward-chest pool. */
export const CHEST_RARITY_POINTS: Readonly<Record<AIChestRarity, number>> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
};

/** A tool picks a crawler by kind, never by name: the player names the human, and may give it the cat's name. */
const TARGET_CRAWLERS = ['active', 'human', 'cat'] as const satisfies readonly (
  'active' | AITargetCrawler
)[];
type AITargetChoice = (typeof TARGET_CRAWLERS)[number];

export const TARGET_PARAM = optionalEnumParam(
  'target_player',
  TARGET_CRAWLERS,
  'Which crawler: the one the player is driving (active), the human crawler (human) or the cat crawler (cat).',
  'active',
);

export function activeCrawler(scene: AISceneContext): Crawler {
  const human = scene.getHuman();
  return human.isActive ? human : scene.getCat();
}

export function resolveTarget(scene: AISceneContext, target: AITargetChoice): Crawler {
  switch (target) {
    case 'human':
      return scene.getHuman();
    case 'cat':
      return scene.getCat();
    case 'active':
      return activeCrawler(scene);
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
}

export function crawlerKind(scene: AISceneContext, crawler: Crawler): AITargetCrawler {
  return crawler === scene.getHuman() ? 'human' : 'cat';
}

/** A crawler as the AI is told of them; for refusals and anything else only the AI reads. */
export function crawlerNameForAI(scene: AISceneContext, crawler: Crawler): string {
  return crawlerAIName(crawlerKind(scene, crawler));
}

/** Names for text sent to the AI: never the player's typed name. */
export function aiNamer(scene: AISceneContext): ResultNamer {
  return {
    crawler: (crawler) => crawlerNameForAI(scene, crawler),
    item: itemAIName,
  };
}

/** Names for text shown on screen: the typed name, isolated for display, and never sent to the AI. */
export function displayNamer(scene: AISceneContext): ResultNamer {
  return {
    crawler: (crawler) => crawlerDisplayName(crawlerKind(scene, crawler)),
    item: (id) => ITEM_DEF[id].name,
  };
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

/** The current floor's definition. */
export function levelDefOf(scene: AISceneContext): LevelDef {
  return getLevelDef(scene.getLevelId());
}

export function floorNumberOf(scene: AISceneContext): number {
  return levelDefOf(scene).floorNumber;
}

/**
 * Shows a line to the player: a toast when the scene offers one, otherwise
 * the active crawler's notice queue, which every scene drains.
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
export const MS_PER_SECOND = 1000;

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * WORLD_TICKS_PER_SECOND);
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
