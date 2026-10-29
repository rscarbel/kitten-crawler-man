/**
 * Which painted sheets each boss room's asset group stands for.
 *
 * One family per room, each in its own file under `bossRooms/`, so the rooms
 * can be dressed independently. The boss figures themselves are not here: they
 * are painted and cached by their own renderers.
 */

import type { AssetGroup } from '../../core/spriteAssets/assetGroups';
import type { PropSheetPlan } from './propSheetPlan';
import { trashGremlinRoomSheetPlans } from './bossRooms/trashGremlinSheets';
import { gymRoomSheetPlans } from './bossRooms/gymRoomSheets';
import { powerLabSheetPlans } from './bossRooms/powerLabSheets';
import { floodedPumpRoomSheetPlans } from './bossRooms/floodedPumpRoomSheets';
import { spiderLabSheetPlans } from './bossRooms/spiderLabSheets';

const BOSS_ROOM_SHEET_FAMILIES = {
  boss_trash_gremlin: trashGremlinRoomSheetPlans,
  boss_big_rooster: gymRoomSheetPlans,
  boss_power_lab: powerLabSheetPlans,
  boss_flooded_pump_room: floodedPumpRoomSheetPlans,
  boss_grotesque_spider: spiderLabSheetPlans,
} as const satisfies Partial<Record<AssetGroup, (artSeed: number) => PropSheetPlan[]>>;

export type BossRoomAssetGroup = keyof typeof BOSS_ROOM_SHEET_FAMILIES;

export const BOSS_ROOM_ASSET_GROUPS: readonly BossRoomAssetGroup[] = [
  'boss_trash_gremlin',
  'boss_big_rooster',
  'boss_power_lab',
  'boss_flooded_pump_room',
  'boss_grotesque_spider',
];

/** The sheets one boss room's group stands for, at the given art seed. */
export function bossRoomSheetPlans(group: BossRoomAssetGroup, artSeed: number): PropSheetPlan[] {
  return BOSS_ROOM_SHEET_FAMILIES[group](artSeed);
}

/** Every boss room's sheets, for gates that check each family against the manifest. */
export function allBossRoomSheetPlans(artSeed: number): PropSheetPlan[] {
  return BOSS_ROOM_ASSET_GROUPS.flatMap((group) => bossRoomSheetPlans(group, artSeed));
}
