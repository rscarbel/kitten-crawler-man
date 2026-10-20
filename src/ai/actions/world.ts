/** World and navigation actions: moving the party, pointing the way, pointing the camera. */
import { TILE_SIZE } from '../../core/constants';
import { findPartyArrivalTiles } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import {
  AI_CHARACTER_MORDECAI,
  AI_CHARACTER_SYSTEM,
  activeCrawler,
  compassDirection,
  notifyPlayer,
  secondsToFrames,
  snakeToWords,
  tileOf,
} from './helpers';
import { anyVulnerable } from './governor';
import { enumParam, intParam, optionalIntParam, optionalTextParam } from './schema';
import { ok, refused, type AIActionDef, type AISceneContext } from './types';

const TELEPORT_COOLDOWN_MS = 120_000;
const HINT_COOLDOWN_MS = 90_000;
const SPOTLIGHT_COOLDOWN_MS = 60_000;
const TELEPORTS_PER_FLOOR = 2;
const HINTS_PER_FLOOR = 3;
/** Larger than any floor's side; the map's real bounds are checked at run time. */
const MAP_TILE_COORD_MAX = 1023;
const NEAREST_WALKABLE_SEARCH_RADIUS = 15;
/** No hostile may stand this close to where the party lands. */
export const TELEPORT_HOSTILE_CLEARANCE_TILES = 8;
const SPOTLIGHT_MIN_SECONDS = 2;
const SPOTLIGHT_MAX_SECONDS = 5;
const SPOTLIGHT_DEFAULT_SECONDS = 3;
const CAPTION_MAX_CHARS = 120;

type TilePoint = { x: number; y: number };

function mapSize(map: GameMap): { cols: number; rows: number } {
  const rows = map.structure.length;
  return { cols: map.structure[0]?.length ?? rows, rows };
}

function insideBossRoom(map: GameMap, tile: TilePoint): boolean {
  return map.bossRooms.some(
    ({ bounds }) =>
      tile.x >= bounds.x &&
      tile.x < bounds.x + bounds.w &&
      tile.y >= bounds.y &&
      tile.y < bounds.y + bounds.h,
  );
}

function nearestWalkableTile(map: GameMap, tile: TilePoint): TilePoint | null {
  if (map.isWalkable(tile.x, tile.y)) return tile;
  for (let radius = 1; radius <= NEAREST_WALKABLE_SEARCH_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const onRing = Math.abs(dx) === radius || Math.abs(dy) === radius;
        if (onRing && map.isWalkable(tile.x + dx, tile.y + dy)) {
          return { x: tile.x + dx, y: tile.y + dy };
        }
      }
    }
  }
  return null;
}

const TILE_X = intParam('tile_x', {
  min: 0,
  max: MAP_TILE_COORD_MAX,
  description: 'Destination tile column (0 to mapWidth-1 from the state snapshot).',
});
const TILE_Y = intParam('tile_y', {
  min: 0,
  max: MAP_TILE_COORD_MAX,
  description: 'Destination tile row (0 to mapHeight-1 from the state snapshot).',
});

function hostileNear(scene: AISceneContext, tile: TilePoint): boolean {
  const radiusPx = TELEPORT_HOSTILE_CLEARANCE_TILES * TILE_SIZE;
  const centre = { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  return scene
    .getMobs()
    .some(
      (mob) =>
        mob.isAlive && mob.isHostile && Math.hypot(mob.x - centre.x, mob.y - centre.y) <= radiusPx,
    );
}

interface PartyLanding {
  readonly leader: TilePoint;
  readonly follower: TilePoint;
}

/**
 * Where the party would actually stand: the arrival search can set either
 * crawler down several tiles from the asked-for tile, so the boss-room and
 * hostile checks run on the two tiles they would really land on.
 */
function teleportLanding(scene: AISceneContext, tile: TilePoint): PartyLanding | string {
  const map = scene.getGameMap();
  const { cols, rows } = mapSize(map);
  if (tile.x >= cols || tile.y >= rows) return 'that tile is off the map';
  const nearest = nearestWalkableTile(map, tile);
  if (nearest === null) return 'no walkable ground near that tile';
  const landing = findPartyArrivalTiles(map, nearest);
  for (const spot of [landing.leader, landing.follower]) {
    if (insideBossRoom(map, spot)) return 'the party cannot be dropped into a boss room';
    if (hostileNear(scene, spot)) return 'the party cannot be dropped beside hostiles';
  }
  return landing;
}

const teleportPlayer: AIActionDef = {
  name: 'teleport_player',
  description:
    'Move the whole party to a tile on the current map. Never into a boss room or during a boss fight.',
  params: [TILE_X, TILE_Y],
  policy: {
    cost: 4,
    cooldownMs: TELEPORT_COOLDOWN_MS,
    severity: 'disruptive',
    forbidsContext: ['isPaused', 'inBossFight'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  maxPerFloor: TELEPORTS_PER_FLOOR,
  // Moving a downed or nearly dead crawler away from help is the harm the low-HP shield is for.
  isHarmful: ({ scene }) => anyVulnerable(scene),
  refusal: ({ params, scene }) => {
    const landing = teleportLanding(scene, { x: params.get(TILE_X), y: params.get(TILE_Y) });
    return typeof landing === 'string' ? landing : null;
  },
  execute({ params, scene }) {
    const tiles = teleportLanding(scene, { x: params.get(TILE_X), y: params.get(TILE_Y) });
    if (typeof tiles === 'string') return refused(tiles);
    const leader = activeCrawler(scene);
    const follower = leader === scene.getHuman() ? scene.getCat() : scene.getHuman();
    leader.x = tiles.leader.x * TILE_SIZE;
    leader.y = tiles.leader.y * TILE_SIZE;
    follower.x = tiles.follower.x * TILE_SIZE;
    follower.y = tiles.follower.y * TILE_SIZE;
    return ok(`teleported the party to ${tiles.leader.x},${tiles.leader.y}`);
  },
};

const LANDMARKS = ['stairwell', 'treasure_room', 'safe_room', 'boss_room'] as const;
type Landmark = (typeof LANDMARKS)[number];

/** Tile centres of every landmark of a kind on the map. */
function landmarkTiles(map: GameMap, kind: Landmark): readonly TilePoint[] {
  if (kind === 'stairwell') return map.stairwellTiles;
  if (kind === 'treasure_room') return map.treasureRooms.map((room) => room.centre);
  if (kind === 'safe_room') return map.safeRooms.map((room) => room.centre);
  return map.bossRooms.map((room) => room.centre);
}

function nearestLandmark(scene: AISceneContext, kind: Landmark): TilePoint | null {
  const from = tileOf(activeCrawler(scene));
  let best: TilePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of landmarkTiles(scene.getGameMap(), kind)) {
    const distance = Math.hypot(tile.x - from.x, tile.y - from.y);
    if (distance < bestDistance) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

const HINT_KIND = enumParam(
  'kind',
  ['stairwell', 'treasure_room'],
  'What to point the crawler toward.',
);

const revealHint: AIActionDef = {
  name: 'reveal_hint',
  description:
    'Tell the crawler which way (and roughly how far) the nearest stairwell or treasure room is.',
  params: [HINT_KIND],
  policy: { cost: 1, cooldownMs: HINT_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_SYSTEM, AI_CHARACTER_MORDECAI],
  maxPerFloor: HINTS_PER_FLOOR,
  refusal: ({ params, scene }) =>
    nearestLandmark(scene, params.get(HINT_KIND)) === null
      ? `there is no ${snakeToWords(params.get(HINT_KIND))} on this map`
      : null,
  execute({ params, scene }) {
    const kind = params.get(HINT_KIND);
    const target = nearestLandmark(scene, kind);
    if (target === null) return refused(`there is no ${snakeToWords(kind)} on this map`);
    const from = tileOf(activeCrawler(scene));
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const tiles = Math.round(Math.hypot(dx, dy));
    const hint = `The nearest ${snakeToWords(kind)} is ${tiles} tiles to the ${compassDirection(dx, dy)}.`;
    notifyPlayer(scene, hint, { tone: 'info', icon: 'info' });
    return ok(hint);
  },
};

const SPOTLIGHT_SUBJECT = enumParam(
  'subject',
  [...LANDMARKS, 'nearest_enemy'],
  'What the camera pans to.',
);
const SPOTLIGHT_SECONDS = optionalIntParam('duration_seconds', {
  min: SPOTLIGHT_MIN_SECONDS,
  max: SPOTLIGHT_MAX_SECONDS,
  fallback: SPOTLIGHT_DEFAULT_SECONDS,
  description: 'How long the camera holds there before returning.',
});
const SPOTLIGHT_CAPTION = optionalTextParam('caption', {
  minLength: 1,
  maxLength: CAPTION_MAX_CHARS,
  description: 'Optional line shown while the camera is away.',
});

function spotlightPoint(scene: AISceneContext, subject: Landmark | 'nearest_enemy') {
  if (subject !== 'nearest_enemy') {
    const tile = nearestLandmark(scene, subject);
    return tile === null ? null : { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  }
  const focus = activeCrawler(scene);
  let best: { x: number; y: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const mob of scene.getMobs()) {
    if (!mob.isAlive || !mob.isHostile) continue;
    const distance = Math.hypot(mob.x - focus.x, mob.y - focus.y);
    if (distance < bestDistance) {
      best = { x: mob.x, y: mob.y };
      bestDistance = distance;
    }
  }
  return best;
}

const spotlight: AIActionDef = {
  name: 'spotlight',
  description:
    'Pan the camera to something for a few seconds so the crawler sees it. Never during a fight.',
  params: [SPOTLIGHT_SUBJECT, SPOTLIGHT_SECONDS, SPOTLIGHT_CAPTION],
  policy: {
    cost: 1,
    cooldownMs: SPOTLIGHT_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused', 'inCombat', 'inBossFight'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  refusal: ({ params, scene }) => {
    if (scene.spotlight === undefined) return 'the camera cannot be moved here';
    return spotlightPoint(scene, params.get(SPOTLIGHT_SUBJECT)) === null
      ? `there is no ${snakeToWords(params.get(SPOTLIGHT_SUBJECT))} to show`
      : null;
  },
  execute({ params, scene }) {
    const subject = params.get(SPOTLIGHT_SUBJECT);
    const point = spotlightPoint(scene, subject);
    if (scene.spotlight === undefined || point === null) {
      return refused(`cannot show ${snakeToWords(subject)}`);
    }
    scene.spotlight(point, secondsToFrames(params.get(SPOTLIGHT_SECONDS)));
    const caption = params.get(SPOTLIGHT_CAPTION);
    if (caption !== '') notifyPlayer(scene, caption, { tone: 'accent' });
    return ok(`spotlight on ${snakeToWords(subject)}`);
  },
};

export const WORLD_ACTIONS: readonly AIActionDef[] = [teleportPlayer, revealHint, spotlight];
