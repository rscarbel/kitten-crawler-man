import type { AIAction } from 'game-ai-server/sdk';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import { makeBurn, makePoison, makeSepsis } from '../core/StatusEffect';
import { createMob } from '../levels/spawner';
import { TILE_SIZE } from '../core/constants';
import type { ItemId } from '../core/ItemDefs';

export interface AISceneContext {
  getHuman(): HumanPlayer;
  getCat(): CatPlayer;
  getMobs(): Mob[];
  getGameMap(): GameMap;
  getLevelId(): string;
  spawnMob(mob: Mob): void;
  isBossFightActive(): boolean;
  isPaused(): boolean;
}

const SPAWNABLE_MOBS = new Set([
  'goblin',
  'rat',
  'llama',
  'cockroach',
  'troglodyte',
  'tuskling',
  'brindle_grub',
  'sky_fowl',
  'bugaboo',
  'juicer',
]);

const VALID_ITEM_IDS = new Set<string>([
  'health_potion',
  'enchanted_bigboi_boxers',
  'trollskin_shirt',
  'enchanted_crown_sepsis_whore',
  'scroll_of_confusing_fog',
  'goblin_dynamite',
  'gym_dumbbell',
  'gym_bench_press',
  'gym_treadmill',
]);

function resolvePlayer(ctx: AISceneContext, target: unknown): HumanPlayer | CatPlayer {
  return target === 'Cat' ? ctx.getCat() : ctx.getHuman();
}

function nearestWalkableTile(
  map: GameMap,
  tileX: number,
  tileY: number,
): { x: number; y: number } | null {
  if (map.isWalkable(tileX, tileY)) return { x: tileX, y: tileY };
  for (let r = 1; r <= 15; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (map.isWalkable(tileX + dx, tileY + dy)) return { x: tileX + dx, y: tileY + dy };
      }
    }
  }
  return null;
}

export function executeAIAction(action: AIAction, ctx: AISceneContext): void {
  switch (action.type) {
    case 'spawn_mob': {
      const mobType =
        typeof action.mob_type === 'string' && SPAWNABLE_MOBS.has(action.mob_type)
          ? action.mob_type
          : 'goblin';
      const target = resolvePlayer(ctx, action.target_player);
      const count = Math.min(Math.max(1, Number(action.count) || 1), 5);
      const map = ctx.getGameMap();
      const tileX = Math.floor(target.x / TILE_SIZE);
      const tileY = Math.floor(target.y / TILE_SIZE);
      let spawned = 0;
      for (let attempt = 0; attempt < 30 && spawned < count; attempt++) {
        const ox = Math.round((Math.random() - 0.5) * 8);
        const oy = Math.round((Math.random() - 0.5) * 8);
        const tx = tileX + ox;
        const ty = tileY + oy;
        if (!map.isWalkable(tx, ty)) continue;
        ctx.spawnMob(createMob(mobType, tx, ty, map));
        spawned++;
      }
      break;
    }

    case 'teleport_player': {
      if (ctx.isBossFightActive()) break;
      const player = resolvePlayer(ctx, action.target_player);
      const companion = action.target_player === 'Cat' ? ctx.getHuman() : ctx.getCat();
      const tileX = Number(action.tile_x);
      const tileY = Number(action.tile_y);
      if (isNaN(tileX) || isNaN(tileY)) break;
      const map = ctx.getGameMap();
      const dest = nearestWalkableTile(map, tileX, tileY);
      if (!dest) break;
      player.x = dest.x * TILE_SIZE;
      player.y = dest.y * TILE_SIZE;
      const companionDest = nearestWalkableTile(map, dest.x + 1, dest.y);
      if (companionDest) {
        companion.x = companionDest.x * TILE_SIZE;
        companion.y = companionDest.y * TILE_SIZE;
      }
      break;
    }

    case 'apply_status': {
      const player = resolvePlayer(ctx, action.target_player);
      if (action.status === 'burn') player.applyStatus(makeBurn());
      else if (action.status === 'poison') player.applyStatus(makePoison());
      else if (action.status === 'sepsis') player.applyStatus(makeSepsis());
      break;
    }

    case 'remove_status': {
      const player = resolvePlayer(ctx, action.target_player);
      const status = String(action.status);
      player.statusEffects = player.statusEffects.filter((e) => e.type !== status);
      break;
    }

    case 'give_item': {
      const player = resolvePlayer(ctx, action.target_player);
      const itemId = String(action.item_id);
      if (!VALID_ITEM_IDS.has(itemId)) break;
      const qty = Math.min(Math.max(1, Number(action.quantity) || 1), 99);
      player.inventory.addItem(itemId as ItemId, qty);
      break;
    }

    case 'remove_item': {
      const player = resolvePlayer(ctx, action.target_player);
      const itemId = String(action.item_id);
      if (!VALID_ITEM_IDS.has(itemId)) break;
      const qty = Math.max(1, Number(action.quantity) || 1);
      player.inventory.removeItems(itemId as ItemId, qty);
      break;
    }

    case 'set_hp': {
      const player = resolvePlayer(ctx, action.target_player);
      const hp = Number(action.hp);
      if (isNaN(hp)) break;
      player.hp = Math.min(Math.max(1, Math.round(hp)), player.maxHp);
      break;
    }

    case 'modify_stat': {
      const player = resolvePlayer(ctx, action.target_player);
      const delta = Number(action.delta);
      if (isNaN(delta)) break;
      const stat = action.stat as 'strength' | 'intelligence' | 'constitution';
      if (stat === 'strength') {
        player.strength = Math.max(1, player.strength + delta);
      } else if (stat === 'intelligence') {
        player.intelligence = Math.max(1, player.intelligence + delta);
      } else if (stat === 'constitution') {
        const d = Math.round(delta);
        player.constitution = Math.max(1, player.constitution + d);
        player.maxHp = Math.max(1, player.maxHp + d * 2);
        player.hp = Math.min(player.hp, player.maxHp);
      } else {
        break;
      }
      // Revert after 30 seconds (1800 ticks at 60fps)
      player.tempStatMods.push({ ticksRemaining: 1800, stat, delta });
      break;
    }
  }
}
