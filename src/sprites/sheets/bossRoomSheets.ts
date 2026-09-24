/**
 * Which painted sheets each boss room's asset group stands for.
 *
 * One family per room, each in its own file under `bossRooms/`, so the rooms
 * can be dressed independently. The boss figures themselves are not here: they
 * are painted and cached by their own renderers.
 */

import type { AssetGroup } from '../../core/assetGroups';
import type { PropSheetPlan } from './propSheetPlan';
import { hoarderRoomSheetPlans } from './bossRooms/hoarderSheets';
import { gymRoomSheetPlans } from './bossRooms/gymRoomSheets';
import { krakarenRoomSheetPlans } from './bossRooms/krakarenSheets';
import { spiderLabSheetPlans } from './bossRooms/spiderLabSheets';
import { colosseumSheetPlans } from './bossRooms/colosseumSheets';

const BOSS_ROOM_SHEET_FAMILIES = {
  boss_hoarder: hoarderRoomSheetPlans,
  boss_juicer: gymRoomSheetPlans,
  boss_krakaren: krakarenRoomSheetPlans,
  boss_grotesque_spider: spiderLabSheetPlans,
  boss_colosseum: colosseumSheetPlans,
} as const satisfies Partial<Record<AssetGroup, (artSeed: number) => PropSheetPlan[]>>;

export type BossRoomAssetGroup = keyof typeof BOSS_ROOM_SHEET_FAMILIES;

export const BOSS_ROOM_ASSET_GROUPS: readonly BossRoomAssetGroup[] = [
  'boss_hoarder',
  'boss_juicer',
  'boss_krakaren',
  'boss_grotesque_spider',
  'boss_colosseum',
];

/** The sheets one boss room's group stands for, at the given art seed. */
export function bossRoomSheetPlans(group: BossRoomAssetGroup, artSeed: number): PropSheetPlan[] {
  return BOSS_ROOM_SHEET_FAMILIES[group](artSeed);
}

/** Every boss room's sheets, for gates that check each family against the manifest. */
export function allBossRoomSheetPlans(artSeed: number): PropSheetPlan[] {
  return BOSS_ROOM_ASSET_GROUPS.flatMap((group) => bossRoomSheetPlans(group, artSeed));
}
