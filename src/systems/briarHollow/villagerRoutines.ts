/**
 * Where each Briar Hollow civilian works, where they wander, and where they
 * hide. Data only; `VillagerSystem` walks it.
 *
 * The four militia are not here: they are soldiers, with orders instead of a
 * routine.
 */

import type { VillagerAnchorKind } from '../../map/overworld/briarHollowSite';
import type { RatkinCastId, RatkinSoldierId } from '../../sprites/art/ratkin/cast';

/** Every cast member who lives a routine rather than taking orders. */
export type CivilianCastId = Exclude<RatkinCastId, RatkinSoldierId>;

/** The ground a villager's routine keeps them on. */
export type VillagerBounds = 'village' | 'quarry';

export interface VillagerRoutine {
  /** Where they work. */
  readonly post: VillagerAnchorKind;
  /** Fraction of their decisions spent staying at the post. */
  readonly postShare: number;
  /** Places they walk to when they leave it. */
  readonly strolls: readonly VillagerAnchorKind[];
  /**
   * Where they hide while the village is under attack. A shop or service
   * shelters in its own building, so it is behind the counter again the
   * moment the siege ends.
   */
  readonly shelter: VillagerAnchorKind;
  /** Walking pace, tiles per second. */
  readonly speed: number;
  /** A shopkeeper or service the party must always be able to find at the counter. */
  readonly service: boolean;
  readonly bounds: VillagerBounds;
  /** A child who will trail after the cat for a few steps. */
  readonly followsCat: boolean;
}

/** Most adults' pace. */
const ADULT_SPEED = 1.7;
/** A working pace for the ones who are always hurrying somewhere. */
const BRISK_SPEED = 1.9;
const ELDER_SPEED = 1.15;
/** Children run. */
const CHILD_SPEED = 2.6;

/** How reliably a service stays behind its counter. */
const SERVICE_POST_SHARE = 0.85;
const WORKER_POST_SHARE = 0.75;
const TOWNSFOLK_POST_SHARE = 0.5;
const CHILD_POST_SHARE = 0.3;

function routine(
  post: VillagerAnchorKind,
  postShare: number,
  strolls: readonly VillagerAnchorKind[],
  shelter: VillagerAnchorKind,
  speed: number,
  extras: Partial<Pick<VillagerRoutine, 'service' | 'bounds' | 'followsCat'>> = {},
): VillagerRoutine {
  return {
    post,
    postShare,
    strolls,
    shelter,
    speed,
    service: extras.service ?? false,
    bounds: extras.bounds ?? 'village',
    followsCat: extras.followsCat ?? false,
  };
}

const SERVICE = { service: true } as const;
const CHILD = { followsCat: true } as const;

export const VILLAGER_ROUTINES: Readonly<Record<CivilianCastId, VillagerRoutine>> = {
  // Notice board and bell are themselves inside the square's own rect; the
  // cookhouse tables are not, and sent him the length of the village to sit
  // down — leashed to the square, he never leaves it once he steps out of the hall.
  bramblewick: routine(
    'hall',
    TOWNSFOLK_POST_SHARE,
    ['square', 'notice_board', 'bell'],
    'hall_shelter',
    ELDER_SPEED,
  ),
  merrit: routine(
    'crop_fields',
    WORKER_POST_SHARE,
    ['kitchen_garden', 'pasture_fence', 'farmhouse', 'well'],
    'farmhouse',
    ADULT_SPEED,
  ),
  pipkin: routine(
    'cookhouse',
    SERVICE_POST_SHARE,
    ['cookhouse_tables', 'well', 'square'],
    'cookhouse',
    ADULT_SPEED,
    SERVICE,
  ),
  sella: routine(
    'infirmary',
    SERVICE_POST_SHARE,
    ['bench', 'well', 'square'],
    'infirmary',
    ADULT_SPEED,
    SERVICE,
  ),
  vetch: routine(
    'store',
    SERVICE_POST_SHARE,
    ['square', 'notice_board', 'cookhouse_tables'],
    'store',
    BRISK_SPEED,
    SERVICE,
  ),
  oren: routine(
    'forge',
    SERVICE_POST_SHARE,
    ['well', 'cookhouse_tables', 'square'],
    'forge',
    ADULT_SPEED,
    SERVICE,
  ),
  tikka: routine(
    'workshop',
    WORKER_POST_SHARE,
    ['notice_board', 'bell', 'lumber_yard', 'square'],
    'workshop',
    BRISK_SPEED,
  ),
  fenna: routine(
    'sawmill',
    SERVICE_POST_SHARE,
    ['lumber_yard', 'well', 'cookhouse_tables'],
    'sawmill',
    ADULT_SPEED,
    SERVICE,
  ),
  // Garn's work is outside the palisade, and so is the rest of his day.
  garn: routine('quarry', WORKER_POST_SHARE, ['garn_hut', 'quarry'], 'garn_hut', ADULT_SPEED, {
    bounds: 'quarry',
  }),
  nella: routine(
    'home_nella',
    TOWNSFOLK_POST_SHARE,
    ['square', 'notice_board', 'well', 'cookhouse_tables', 'bench'],
    'home_nella',
    ADULT_SPEED,
  ),
  cricket: routine(
    'well',
    WORKER_POST_SHARE,
    ['well', 'crop_fields', 'square', 'home_cricket'],
    'home_cricket',
    ADULT_SPEED,
  ),
  wicker: routine(
    'home_wicker',
    WORKER_POST_SHARE,
    ['square', 'bench', 'gate'],
    'home_wicker',
    ADULT_SPEED,
  ),
  midge: routine(
    'bell',
    TOWNSFOLK_POST_SHARE,
    ['square', 'gate', 'notice_board', 'home_midge'],
    'home_midge',
    BRISK_SPEED,
  ),
  elder_bracken: routine(
    'bench',
    WORKER_POST_SHARE,
    ['square', 'well', 'bench'],
    'hall_shelter',
    ELDER_SPEED,
  ),
  elder_thistle: routine(
    'bench',
    TOWNSFOLK_POST_SHARE,
    ['cookhouse_tables', 'square', 'kitchen_garden'],
    'hall_shelter',
    ELDER_SPEED,
  ),
  child_nib: routine(
    'square',
    CHILD_POST_SHARE,
    ['square', 'pasture_fence', 'homes'],
    'hall_shelter',
    CHILD_SPEED,
    CHILD,
  ),
  child_burr: routine(
    'square',
    CHILD_POST_SHARE,
    ['pasture_fence', 'square', 'homes'],
    'hall_shelter',
    CHILD_SPEED,
    CHILD,
  ),
};

/** Every civilian, in a stable order: the named villagers, then the unnamed four. */
export const CIVILIAN_CAST_IDS: readonly CivilianCastId[] = [
  'bramblewick',
  'merrit',
  'pipkin',
  'sella',
  'vetch',
  'oren',
  'tikka',
  'fenna',
  'garn',
  'nella',
  'cricket',
  'wicker',
  'midge',
  'elder_bracken',
  'elder_thistle',
  'child_nib',
  'child_burr',
];
