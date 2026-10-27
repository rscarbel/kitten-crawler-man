/**
 * The repeatable scenes performance is measured in: each one a dev URL and a
 * scripted walk, so a recording taken before a change and one taken after it
 * saw the same floor, the same spawn and the same input.
 *
 * Every floor scene pins the world seed with `seed=`, because the map is the
 * largest thing a walk depends on, and boots under `!tough` with `tough`, so
 * no run is cut short by a death or thinned by kills. Mobs still roll their
 * own dice; only the crawler's input is held identical.
 *
 * Open a scene at `perfSceneUrl(scene)`. `perfwalk=<id>` starts the route once
 * its warm-up has passed; `globalThis.__perfWalk` says how far it has got.
 */

import { STARLIGHT_TENT_NAME } from '../map/overworld/circusGroundsLayout';
import { CLOAK_AND_DAGGER_NAME } from '../map/town/townPlan';
import { aiAdapter } from '../ai/AIAdapter';
import type { SceneManager } from '../core/Scene';
import {
  startPerfWalk,
  type PerfWalkAnchor,
  type PerfWalkRoute,
  type PerfWalkStep,
} from './perfWalk';

/** The world seed every floor scene is generated from. */
const PERF_WORLD_SEED = 7919;

/**
 * How long a walk waits before its first step, unless `perfwalkDelay=` says:
 * the warm-up a recording leaves for the JIT and the caches, so a recorder
 * started as `__perfWalk.state` turns to `walking` sees warm frames only.
 */
const DEFAULT_WALK_DELAY_SECONDS = 10;
/** How long a walk lasts, unless `perfwalkSeconds=` says: one recording's length. */
const DEFAULT_WALK_SECONDS = 30;
const MS_PER_SECOND = 1000;

/** Where `npm run serve` serves the dev build. */
const DEV_SERVER_ORIGIN = 'http://localhost:8080';

interface PerfScene {
  readonly id: string;
  readonly description: string;
  /** The dev boot query, without `perf` or `perfwalk`, which {@link perfSceneUrl} adds. */
  readonly query: string;
  /** Null for a scene with no crawler to walk: a preview harness measured idle. */
  readonly route: PerfWalkRoute | null;
}

/** How far each leg of a floor's lap reaches from where the party arrived, in tiles. */
const DUNGEON_LAP_REACH_TILES = 20;
const PLAZA_LAP_REACH_X_TILES = 14;
const PLAZA_LAP_REACH_Y_TILES = 9;
const VILLAGE_STREET_REACH_TILES = 10;
const VILLAGE_STREET_SIDE_TILES = 7;
const BOSS_ROOM_LAP_REACH_TILES = 4;
const CIRCUS_LAP_REACH_TILES = 10;
const INTERIOR_LAP_REACH_TILES = 6;

/** Steps walked once, then `lap` over and over. */
function leadInThenLap(
  leadIn: readonly PerfWalkStep[],
  lap: readonly PerfWalkStep[],
): PerfWalkRoute {
  return { steps: [...leadIn, ...lap], loopFrom: leadIn.length };
}

/** Out to each side of `anchor` and back through it, as a loop. */
function crossLap(anchor: PerfWalkAnchor, reachX: number, reachY: number): PerfWalkStep[] {
  return [
    { kind: 'walk', anchor, dx: reachX, dy: 0 },
    { kind: 'walk', anchor, dx: -reachX, dy: 0 },
    { kind: 'walk', anchor },
    { kind: 'walk', anchor, dx: 0, dy: reachY },
    { kind: 'walk', anchor, dx: 0, dy: -reachY },
    { kind: 'walk', anchor },
  ];
}

/** Onto a prompt tile, then the default answer, then the new map. */
function takePrompt(anchor: PerfWalkAnchor): PerfWalkStep[] {
  return [{ kind: 'walk', anchor, onto: true }, { kind: 'acceptUntilNewMap' }];
}

const ARRIVAL = { kind: 'arrival' } as const;

const DUNGEON_LAP = crossLap(ARRIVAL, DUNGEON_LAP_REACH_TILES, DUNGEON_LAP_REACH_TILES);

/** Interiors are entered from their south wall, so the lap's first north-south leg heads north, into the room. */
const INTERIOR_LAP = crossLap(ARRIVAL, INTERIOR_LAP_REACH_TILES, -INTERIOR_LAP_REACH_TILES);
const SPIDER_LAB = { kind: 'spiderLab' } as const;
const GYM = { kind: 'bossRoomPast', bossType: 'big_rooster' } as const;
const CIRCUS_CENTRE = { kind: 'circusCentre' } as const;

/** A floor boot pinned to the perf seed, the party under `!tough` so the walk outlives the floor. */
function pinnedFloor(query: string): string {
  return `${query}&seed=${PERF_WORLD_SEED}&tough`;
}

const PERF_SCENES: readonly PerfScene[] = [
  {
    id: 'floor1',
    description: 'Floor 1 from its start, a lap of the rooms and corridors around it',
    query: pinnedFloor('playtest=level1'),
    route: leadInThenLap([], DUNGEON_LAP),
  },
  {
    id: 'floor2',
    description: 'Floor 2 from its start: the second tileset and its darker lighting',
    query: pinnedFloor('playtest=level2'),
    route: leadInThenLap([], DUNGEON_LAP),
  },
  {
    id: 'town',
    description: 'Across the town plaza east to west and north to south, through the crowd',
    query: pinnedFloor('playtest=level3'),
    route: leadInThenLap([], crossLap(ARRIVAL, PLAZA_LAP_REACH_X_TILES, PLAZA_LAP_REACH_Y_TILES)),
  },
  {
    id: 'siege',
    description:
      'Briar Hollow with the bell rung on arrival: up the street as the first wave comes',
    query: pinnedFloor('playtest=briar-hollow-assault&assaultNow'),
    route: leadInThenLap(
      [],
      [
        { kind: 'walk', anchor: ARRIVAL, dx: 0, dy: -VILLAGE_STREET_REACH_TILES },
        {
          kind: 'walk',
          anchor: ARRIVAL,
          dx: VILLAGE_STREET_SIDE_TILES,
          dy: -VILLAGE_STREET_REACH_TILES,
        },
        {
          kind: 'walk',
          anchor: ARRIVAL,
          dx: -VILLAGE_STREET_SIDE_TILES,
          dy: -VILLAGE_STREET_REACH_TILES,
        },
        { kind: 'walk', anchor: ARRIVAL },
      ],
    ),
  },
  {
    id: 'spider',
    description: "From the spider lab's station into the lab, then back and forth across it",
    query: pinnedFloor('playtest=spider'),
    route: leadInThenLap(
      [{ kind: 'walk', anchor: SPIDER_LAB }],
      crossLap(SPIDER_LAB, BOSS_ROOM_LAP_REACH_TILES, BOSS_ROOM_LAP_REACH_TILES),
    ),
  },
  {
    id: 'big_rooster',
    description: "From the safe room into Big Rooster's gym, then laps of it",
    query: pinnedFloor('playtest=big_rooster'),
    route: leadInThenLap(
      [{ kind: 'walk', anchor: GYM }],
      crossLap(GYM, BOSS_ROOM_LAP_REACH_TILES, BOSS_ROOM_LAP_REACH_TILES),
    ),
  },
  {
    id: 'starlight-tent',
    description: 'Up the circus grounds and in through the Starlight Tent, then laps of the tent',
    query: pinnedFloor('playtest=starlight-tent'),
    route: leadInThenLap(
      [
        { kind: 'walk', anchor: CIRCUS_CENTRE, dx: CIRCUS_LAP_REACH_TILES },
        { kind: 'walk', anchor: CIRCUS_CENTRE, dx: -CIRCUS_LAP_REACH_TILES },
        ...takePrompt({ kind: 'buildingDoor', name: STARLIGHT_TENT_NAME }),
      ],
      INTERIOR_LAP,
    ),
  },
  {
    id: 'casino',
    description: 'In through the Cloak & Dagger door, then laps of the casino floor',
    query: pinnedFloor('playtest=casino-floor'),
    route: leadInThenLap(
      takePrompt({ kind: 'buildingDoor', name: CLOAK_AND_DAGGER_NAME }),
      INTERIOR_LAP,
    ),
  },
  {
    id: 'casino-table',
    description: 'The blackjack preview harness, idle: its panel and card bitmaps alone',
    query: 'casino',
    route: null,
  },
  {
    id: 'descent',
    description:
      "Onto floor 1's stairwell and down to floor 2's arrival. It ends there: the next floor draws its own seed, so a lap of it would cross a different map every run",
    query: pinnedFloor('playtest=stairwell'),
    route: { steps: takePrompt({ kind: 'stairwell' }) },
  },
];

function getPerfScene(id: string): PerfScene | null {
  return PERF_SCENES.find((scene) => scene.id === id) ?? null;
}

/** The URL a scene is recorded at, with the perf overlay on and its walk armed. */
function perfSceneUrl(scene: PerfScene, origin = DEV_SERVER_ORIGIN): string {
  const walk = scene.route === null ? '' : `&perfwalk=${scene.id}`;
  return `${origin}/?${scene.query}&perf${walk}`;
}

function secondsParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number.parseFloat(params.get(name) ?? '');
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Starts the walk `perfwalk=<scene id>` names, if any. `perfwalkDelay=` and
 * `perfwalkSeconds=` override the warm-up and the walk's length.
 */
export function startPerfWalkFromParams(params: URLSearchParams, sceneManager: SceneManager): void {
  const routeId = params.get('perfwalk');
  if (routeId === null) return;
  const route = getPerfScene(routeId)?.route ?? null;
  if (route === null) {
    const known = PERF_SCENES.filter((scene) => scene.route !== null)
      .map((scene) => `  ${scene.id}: ${perfSceneUrl(scene)}`)
      .join('\n');
    console.error(`[perfwalk] no walk named "${routeId}". Scenes with a walk:\n${known}`);
    return;
  }
  startPerfWalk({
    routeId,
    route,
    delayMs: secondsParam(params, 'perfwalkDelay', DEFAULT_WALK_DELAY_SECONDS) * MS_PER_SECOND,
    durationMs: secondsParam(params, 'perfwalkSeconds', DEFAULT_WALK_SECONDS) * MS_PER_SECOND,
    scene: () => aiAdapter.boundScene,
    worldHalted: () => sceneManager.worldHalted,
  });
}
