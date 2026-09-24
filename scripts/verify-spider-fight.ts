#!/usr/bin/env tsx
/**
 * The Grotesque Spider fight's fairness contract, checked headless against the
 * real creature, the real egg and hatchling, and the real `SpiderQuestSystem`.
 *
 * The fight promises a player four things they can only take on trust: that the
 * damage lands on the tick the picture, the floor paint and the sound all say it
 * does; that every attack can be walked out of from wherever it caught you, even
 * straight after a root; that her brood behaves exactly as its countdown reads;
 * and that a player who reads the telegraphs perfectly can win without taking a
 * single hit. Each gate below drives the shipped code through the same update
 * order `DungeonScene` uses and measures the promise directly — margins in
 * pixels and frames wherever the rule is about dodging, never a count of hits.
 *
 * Every gate can be watched failing: `--break=<fault>` injects one deliberate
 * rule break at runtime (see `FAULTS`) without touching any source file, and
 * the gate guarding that rule must go red. A lookup the gates depend on — a
 * private field, an exported table, a row — failing to resolve is itself a
 * failure, never a skip: a gate that cannot find what it measures must not
 * report green.
 *
 * Run: npm run verify:spider-fight
 *      npm run verify:spider-fight -- --only=1,4 --break=early-strike
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { gameContext } from './nodeGameContext';
import { mulberry32 } from '../src/sprites/person/rng';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { AbilityManager } from '../src/core/AbilityManager';
import { referenceStats, type ReferenceAttack } from '../src/core/referenceCrawler';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Mob, type PlayerDamageType } from '../src/creatures/Mob';
import type { Player, DamageSource } from '../src/Player';
import { SmallSpider } from '../src/creatures/SmallSpider';
import {
  GrotesqueSpider,
  SPIT_SPEED_PX,
  LAY_COOLDOWN_FRAMES,
  MAX_LIVE_EGGS_AND_HATCHLINGS,
  SPIT_HIT_RADIUS_FRACTION,
  TRAP_HIT_RADIUS_FRACTION,
  type SpitPuddle,
  PUDDLE_EVAPORATE_FRAMES,
  REPOSITION_ARRIVAL_PX,
  FIRST_ATTACK_GAP_FRAMES,
  EGG_MIN_DISTANCE_TILES,
  DEATH_ANIM_FRAMES,
  REPOSITION_TIMEOUT_FRAMES,
  spiderRootFramesRemaining,
} from '../src/creatures/GrotesqueSpider';
import {
  SCREECH_RADIUS_PX,
  SLAM_CONE_HALF_ANGLE_RAD,
  SLAM_CONE_RADIUS_PX,
  SLAM_CONE_RADIUS_TILES,
  SPIDER_ATTACK_TIMELINES,
  SPIDER_FRAMES_PER_SECOND,
  MIN_IMPACT_HOLD_FRAMES,
  attackStageAt,
  audioSeekSeconds,
  audioStartFrame,
  isInsideSlamCone,
  recoveryStartFrame,
  strikeFrame,
  totalFrames,
  type SlamImpact,
  type SpiderAttack,
} from '../src/creatures/grotesqueSpiderTimeline';
import {
  spiderTelegraphGeometry,
  spiderTelegraphStateAt,
  type SpiderAreaAttack,
} from '../src/creatures/grotesqueSpiderTelegraphs';
import { EGG_HATCHLINGS_PER_EGG, EGG_HATCH_FRAMES, SpiderEgg } from '../src/creatures/SpiderEgg';
import { SpiderHatchling } from '../src/creatures/SpiderHatchling';
import {
  GROTESQUE_SPIDER_ATTACK_ROWS,
  grotesqueSpiderRowFrameAt,
} from '../src/sprites/grotesqueSpiderSprite';
import { GROTESQUE_SPIDER_ROW_POSES } from '../src/sprites/art/grotesqueSpiderFigure';
import {
  FRONT_LEG_INDICES,
  getSpiderLegTip,
  spiderGlobAtMouth,
  spiderMawOpen,
  type GrotesqueSpiderAttackRow,
  type GrotesqueSpiderPose,
} from '../src/sprites/art/grotesqueSpiderRig';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { SpellSystem } from '../src/systems/SpellSystem';
import { resolveKills, type CombatContext } from '../src/systems/CombatSystem';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../src/systems/mobCheckpoint';
import { pushPlayerWithCollision } from '../src/systems/playerDisplacement';
import { DIAGONAL_PENALTY } from '../src/systems/PlayerMovementSystem';
import { FairyCorpseLedger } from '../src/creatures/fairies/fairyCorpses';
import { clamp } from '../src/utils';
import { makeStuck } from '../src/core/StatusEffect';
import { SEPARATION_RADIUS } from '../src/systems/mobSeparation';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpiderQuestSystem, type SpiderQuestCheckpoint } from '../src/systems/SpiderQuestSystem';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { SFX_GROUPS, sfxGroupsForLevelId } from '../src/audio/sfxGroups';
import type { SoundId } from '../src/audio/sounds';

installCanvasGlobals();

// ─────────────────────────────────────────────────────────────── faults

/**
 * Each fault breaks exactly one promise at runtime, so the gate that guards it
 * can be watched going red. None of them edits a file.
 */
const FAULTS = {
  'double-strike': 'her strike runs twice on its tick (gate 1: exactly once)',
  'early-strike': 'her strike also runs one tick before the strike frame (gate 1: the tick)',
  'art-late': 'the art is sampled two frames behind the attack clock (gate 2)',
  'art-early': 'the art is sampled two frames ahead of the attack clock (gate 2)',
  'audio-early': 'the impact sound is cued two frames early (gate 3)',
  'telegraph-late': 'the telegraph reads an attack clock one frame behind (gate 4)',
  'hit-reach': 'the area hit tests reach 3 px past the drawn outline (gate 4)',
  'cone-wide': 'the slam hit test is 2 degrees wider each side than the drawn cone (gate 4)',
  'spit-tracks': 'the spit re-aims on its release tick (gate 5)',
  'short-lock': 'every lock runs at double speed (gate 6)',
  'cutscene-frozen': 'the cutscene spit freezes on its release while the glob flies (gate 1)',
  'cutscene-silent-spit': 'the cutscene spit leaves her mouth without its fire sound (gate 1)',
  'cutscene-exposed': 'the cutscene spit recovery counts as exposed (gate 1)',
  'banner-over-death': 'the quest-complete banner opens on the frame she dies (gate 10)',
  'eggs-underfoot': 'eggs land 1 to 3 tiles from her centre, under her body (gate 9)',
  'cutscene-no-reset':
    'the fight opens without resetting her attack state after the cutscene (gate 1)',
  'orphan-audio': 'an attack cut short before its strike leaves its impact sound playing (gate 3)',
  'silent-brood': 'eggs landing, smashing and hatching raise no sound (gate 3)',
  'double-splat': 'a smashed egg raises the brood splat on top of its kill splat (gate 3)',
  'level-scaled-area':
    'her slam and screech are level-scaled on top of their share of max HP (gate 7)',
  'screech-trap': 'she screeches whether or not a crawler could walk out in time (gate 6)',
  'probe-ignores-room':
    'her escape probe walks out through the lab doorway the room lock shuts (gate 6)',
  'probe-through-her': 'her escape probe walks a crawler straight through her body (gates 6, 8)',
  'no-reposition': 'she never backs off a stalemate to find a fair attack (gate 8)',
  'spit-creeps': 'she creeps all the way in during a spit tell, closing the sidestep off (gate 8)',
  'reposition-parks':
    'her reposition walk stops at the arrival slack itself and parks a hair outside it (gate 8)',
  'reposition-blind': 'her stalemate reposition accepts spots that cannot see the target (gate 8)',
  'retargets-mid-tell':
    'the aim of an attack follows whoever is nearest mid-tell, not its own target (gate 8)',
  harmless: 'her strike does nothing (gate 7)',
  'root-ignored': 'she ignores the root rule when starting and during a tell (gate 8)',
  'shoved-mid-build':
    'a shove moves her during a slam or screech build, and she locks anyway (gate 8)',
  'spit-root': 'a puddle roots the crawler a pending spit is aimed at (gate 8)',
  'egg-clock': 'an egg ages twice on every tenth tick (gate 9: hatch tick)',
  'egg-tough': 'a hit does not destroy an egg (gate 9: one hit)',
  'hatchling-senses': 'a hatchling acquires its prey by sight and aggro range (gate 9)',
  'no-crush': 'her slam impacts never reach the brood (gate 9: crush)',
  'egg-heavy': 'an egg shoves players like a boulder (gate 9: never blocks)',
  'brood-cap': 'she sees an empty brood whatever is alive (gate 9: cap)',
  'lay-cooldown': 'her lay cooldown is cleared every tick (gate 9: cooldown)',
  'brood-leak': 'the quest never clears the brood (gate 10)',
  'puddle-leak': 'an abort leaves her puddles and glob on the floor (gate 10)',
  'glob-outlives-her':
    'her death leaves her glob in the air and her puddles on the floor (gate 10)',
  'companion-ignores-eggs':
    'the human companion never goes for an egg that is not attacking anyone (gate 10)',
  'puddle-splash-freezes':
    'a puddle still splashing when she dies holds its splash through the fade (gate 10)',
  'puddle-ttl-pops': 'a puddle whose life runs out vanishes without drying (gate 10)',
  'raisable-boss': 'she does not count as a boss kill, so a necro fairy may raise her (gate 10)',
  'no-tell': 'area attacks skip straight to the end of their lock (gate 11)',
} as const;
type Fault = keyof typeof FAULTS;

function isFault(name: string): name is Fault {
  return Object.keys(FAULTS).includes(name);
}

const argValue = (name: string): string | null => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? null : arg.slice(prefix.length);
};

const requestedFault = argValue('break');
if (requestedFault !== null && !isFault(requestedFault)) {
  console.error(`Unknown fault "${requestedFault}". Known faults:`);
  for (const [name, what] of Object.entries(FAULTS)) console.error(`  ${name}: ${what}`);
  process.exit(1);
}
const fault: Fault | null =
  requestedFault !== null && isFault(requestedFault) ? requestedFault : null;
const onlyGates = new Set(
  (argValue('only') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
);
const gateSelected = (id: string): boolean => onlyGates.size === 0 || onlyGates.has(id);

// ─────────────────────────────────────────────────────────────── report

interface GateRow {
  readonly gate: string;
  readonly check: string;
  readonly pass: boolean;
  readonly measured: string;
}
const rows: GateRow[] = [];
const notes: string[] = [];

function record(gate: string, check: string, pass: boolean, measured: string): void {
  rows.push({ gate, check, pass, measured });
}

// ─────────────────────────────────────────────────────────────── constants

/** Master seed; every run derives its own from this so a failure replays exactly. */
const RUN_SEED = 0x5b1d3e;
/** The lab's generated footprint, in tiles, inside a one-tile wall ring. */
const LAB_TILES_WIDE = 40;
const LAB_TILES_TALL = 32;
const WALL_RING_TILES = 1;
const LAB_BOUNDS = {
  x: WALL_RING_TILES,
  y: WALL_RING_TILES,
  w: LAB_TILES_WIDE,
  h: LAB_TILES_TALL,
} as const;
/**
 * A solid block in the lab's north-east, standing in for a life machine: the
 * one thing in the room that blocks a line of sight, which the hatchling gate
 * needs and every other gate stays well clear of.
 */
const PILLAR: Readonly<{ x: number; y: number; w: number; h: number }> = {
  x: 34,
  y: 3,
  w: 2,
  h: 5,
};
const HALF_TILE = TILE_SIZE / 2;
const LAB_CENTRE_TILE = { x: 20, y: 16 } as const;
/**
 * The lab's doorway: a gap in the south wall under the centre column, with a
 * corridor behind it deep enough that walking out through it would clear any
 * of her shapes. The room lock clamps a crawler inside the lab, so it is no
 * way out during the fight, and the harness clamps its crawlers the same way.
 */
const DOORWAY_TILE_X = LAB_CENTRE_TILE.x;
const DOORWAY_CORRIDOR_TILES = 4;
/**
 * A one-tile-wide dead end cut into a solid block in the lab's north-west,
 * opening south. A crawler inside with her in its mouth has no way out except
 * up the dead end or through her, which the push between bodies forbids.
 */
interface Nook {
  readonly block: Readonly<{ x: number; y: number; w: number; h: number }>;
  readonly depthTiles: number;
}
const NOOK_BLOCK_SIZE_TILES = 3;
/** Two deep: backing up it can still beat a slam, never a screech. */
const DEEP_NOOK: Nook = {
  block: { x: 8, y: 3, w: NOOK_BLOCK_SIZE_TILES, h: NOOK_BLOCK_SIZE_TILES },
  depthTiles: 2,
};
/** One deep: nothing can be dodged from it, so she must start nothing there. */
const SHALLOW_NOOK: Nook = {
  block: { x: 12, y: 3, w: NOOK_BLOCK_SIZE_TILES, h: NOOK_BLOCK_SIZE_TILES },
  depthTiles: 1,
};
const NOOKS: readonly Nook[] = [DEEP_NOOK, SHALLOW_NOOK];
const nookColumn = (nook: Nook): number => nook.block.x + 1;
/** The dead end's far tile. */
const nookDeepTile = (nook: Nook): Vec => ({
  x: nookColumn(nook),
  y: nook.block.y + nook.block.h - nook.depthTiles,
});
/** The open tile just outside it, where she stands. */
const nookMouthTile = (nook: Nook): Vec => ({
  x: nookColumn(nook),
  y: nook.block.y + nook.block.h,
});

const SLAM_REACH_PX = SLAM_CONE_RADIUS_PX;
const SCREECH_REACH_PX = SCREECH_RADIUS_PX;
const SPIT_HIT_RADIUS_PX = TILE_SIZE * SPIT_HIT_RADIUS_FRACTION;
const PUDDLE_GRAB_RADIUS_PX = TILE_SIZE * TRAP_HIT_RADIUS_FRACTION;

/** Frames a scenario may wait for her to pick an attack before it is declared stuck. */
const SETUP_FRAME_CEILING = 600;
/** Frames a spit glob is followed after release: its whole flight and then some. */
const SPIT_FOLLOW_FRAMES = 150;
/**
 * How many directions the escape search tries from each start geometry: the
 * eight a keyboard can walk in, which is all a keyboard player gets.
 */
const ESCAPE_DIRECTIONS = 8;

/** How far past a boundary the hit-test probes sit, in pixels. */
const PROBE_EPSILON_PX = 0.5;
/** Tolerance on a unit vector compared component-wise. */
const VECTOR_TOLERANCE = 1e-9;
/** Two directions this close are the same one; `acos` near 1 cannot resolve finer. */
const ANGLE_TOLERANCE_RAD = 1e-6;
/** How far apart the lock-tick and release-tick aims must be for the spit gate to mean anything, in radians. */
const MIN_TRACKING_DIVERGENCE_RAD = 0.05;
/** A foot within this many tiles of the floor is touching it. */
const GROUND_CONTACT_TOLERANCE_TILES = 0.01;
/** A maw within this of its row maximum is at the maximum. */
const MAW_MAX_TOLERANCE = 1e-6;
/** Audio may land within this many frames of the strike. */
const AUDIO_TOLERANCE_FRAMES = 1;
/** The fill counts as having reached the outline at this progress. */
const FULL_FILL = 1;
/** Opacity a warning must keep on its strike tick. */
const FULL_OUTLINE_ALPHA = 1;

/** A tick of mid-tell the render probe samples, to see the fill growing. */
const MID_TELL_SAMPLE_FRAME = 20;

const DEGREES_PER_HALF_TURN = 180;
const radToDeg = (rad: number): number => (rad / Math.PI) * DEGREES_PER_HALF_TURN;

// ─────────────────────────────────────────────────────────────── private access

/**
 * Reads a private field of a live object. The harness is allowed to look where
 * the screen shows (the glob in flight) but has no public door to; a renamed
 * field makes the lookup throw rather than read as "nothing there".
 */
function readPrivate(owner: object, key: string): unknown {
  if (!Reflect.has(owner, key)) throw new Error(`lookup failed: no field "${key}" on the object`);
  const value: unknown = Reflect.get(owner, key);
  return value;
}

type Invoke = (...args: unknown[]) => unknown;

/** Replaces a (possibly private) method on one instance, handing the wrapper the original. */
function wrapMethod(
  owner: object,
  key: string,
  wrap: (original: Invoke, args: unknown[]) => unknown,
): void {
  const original: unknown = Reflect.get(owner, key);
  if (typeof original !== 'function') throw new Error(`lookup failed: no method "${key}"`);
  const callOriginal: Invoke = (...args) => {
    const result: unknown = Reflect.apply(original, owner, args);
    return result;
  };
  Reflect.set(owner, key, (...args: unknown[]): unknown => wrap(callOriginal, args));
}

function callPrivate(owner: object, key: string, args: unknown[]): unknown {
  const method: unknown = Reflect.get(owner, key);
  if (typeof method !== 'function') throw new Error(`lookup failed: no method "${key}"`);
  const result: unknown = Reflect.apply(method, owner, args);
  return result;
}

function numberField(owner: object, key: string): number {
  const value = readPrivate(owner, key);
  if (typeof value !== 'number') throw new Error(`lookup failed: "${key}" is not a number`);
  return value;
}

interface GlobView {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** The glob in flight, as drawn, or null when there is none. */
function spitGlob(spider: GrotesqueSpider): GlobView | null {
  const projectile = readPrivate(spider, 'activeProjectile');
  if (projectile === null) return null;
  if (typeof projectile !== 'object') throw new Error('lookup failed: activeProjectile shape');
  return {
    x: numberField(projectile, 'x'),
    y: numberField(projectile, 'y'),
    vx: numberField(projectile, 'vx'),
    vy: numberField(projectile, 'vy'),
  };
}

// ─────────────────────────────────────────────────────────────── geometry

interface Vec {
  readonly x: number;
  readonly y: number;
}

const centreOf = (entity: { readonly x: number; readonly y: number }): Vec => ({
  x: entity.x + HALF_TILE,
  y: entity.y + HALF_TILE,
});
/** The first item, or undefined for an empty list (the index type alone never says so). */
function firstOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[0] : undefined;
}

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v: Vec): Vec => {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length };
};
const angleBetween = (a: Vec, b: Vec): number => {
  const ua = unit(a);
  const ub = unit(b);
  return Math.acos(Math.min(1, Math.max(-1, ua.x * ub.x + ua.y * ub.y)));
};
const rotate = (v: Vec, rad: number): Vec => ({
  x: v.x * Math.cos(rad) - v.y * Math.sin(rad),
  y: v.x * Math.sin(rad) + v.y * Math.cos(rad),
});

function pointToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Signed pixels from a point to a slam cone's edge: positive outside, negative inside. */
function coneClearance(impact: SlamImpact, p: Vec): number {
  const origin = { x: impact.originX, y: impact.originY };
  const dir = { x: impact.dirX, y: impact.dirY };
  const edgeA = rotate(dir, impact.halfAngleRad);
  const edgeB = rotate(dir, -impact.halfAngleRad);
  const tipA = { x: origin.x + edgeA.x * impact.radiusPx, y: origin.y + edgeA.y * impact.radiusPx };
  const tipB = { x: origin.x + edgeB.x * impact.radiusPx, y: origin.y + edgeB.y * impact.radiusPx };
  const offset = { x: p.x - origin.x, y: p.y - origin.y };
  const withinAngle = angleBetween(offset, dir) <= impact.halfAngleRad;
  const toArc = withinAngle ? Math.abs(Math.hypot(offset.x, offset.y) - impact.radiusPx) : Infinity;
  const toBoundary = Math.min(
    toArc,
    pointToSegment(p, origin, tipA),
    pointToSegment(p, origin, tipB),
  );
  return isInsideSlamCone(impact, p.x, p.y) ? -toBoundary : toBoundary;
}

// ─────────────────────────────────────────────────────────────── the lab

type TileGrid = TileContent[][];

function buildLabGrid(): TileGrid {
  const width = LAB_TILES_WIDE + WALL_RING_TILES * 2;
  const height = LAB_TILES_TALL + WALL_RING_TILES * 2 + DOORWAY_CORRIDOR_TILES;
  const grid: TileGrid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.wall,
    })),
  );
  for (let y = LAB_BOUNDS.y; y < LAB_BOUNDS.y + LAB_BOUNDS.h; y++) {
    for (let x = LAB_BOUNDS.x; x < LAB_BOUNDS.x + LAB_BOUNDS.w; x++) {
      const inPillar =
        x >= PILLAR.x && x < PILLAR.x + PILLAR.w && y >= PILLAR.y && y < PILLAR.y + PILLAR.h;
      const solidNookBlock = NOOKS.some(
        (nook) =>
          x >= nook.block.x &&
          x < nook.block.x + nook.block.w &&
          y >= nook.block.y &&
          y < nook.block.y + nook.block.h &&
          !(x === nookColumn(nook) && y >= nookDeepTile(nook).y),
      );
      if (!inPillar && !solidNookBlock) {
        grid[y][x] = { tileId: `${x}#${y}`, type: FloorTypeValue.tile_floor };
      }
    }
  }
  for (let y = LAB_BOUNDS.y + LAB_BOUNDS.h; y < height; y++) {
    grid[y][DOORWAY_TILE_X] = { tileId: `${DOORWAY_TILE_X}#${y}`, type: FloorTypeValue.tile_floor };
  }
  return grid;
}

interface HitRecord {
  readonly frame: number;
  readonly victim: Player;
  readonly attackType: string | undefined;
  readonly mobType: string;
  /** Her attack and its frame when the blow was offered, whether or not it connected. */
  readonly attack: SpiderAttack | null;
  readonly attackFrame: number;
}

interface Lab {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly spider: GrotesqueSpider;
  readonly quest: SpiderQuestSystem | null;
  readonly combat: CombatContext;
  readonly hits: HitRecord[];
  frame: number;
  ctx(): SystemContext;
}

interface LabOptions {
  readonly seed: number;
  readonly spiderTile: Vec;
  readonly humanTile: Vec;
  readonly catTile: Vec | null;
  readonly withQuest: boolean;
}

/** Seeds `Math.random` too: dodge rolls and anything else unseeded must replay exactly. */
function seedEverything(seed: number): () => number {
  const globalRandom = mulberry32(seed);
  Math.random = globalRandom;
  return mulberry32(seed ^ RUN_SEED);
}

function buildLab(options: LabOptions): Lab {
  const spiderRng = seedEverything(options.seed);
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: buildLabGrid() });
  map.spiderLabRoom = {
    bounds: { ...LAB_BOUNDS },
    centre: { ...LAB_CENTRE_TILE },
    entranceTile: { x: LAB_CENTRE_TILE.x, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 1 },
    scientistTile: { x: LAB_CENTRE_TILE.x - 2, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 },
    computerTile: { x: LAB_CENTRE_TILE.x + 2, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 },
    spiderEggTile: { x: LAB_CENTRE_TILE.x, y: LAB_BOUNDS.y + 2 },
    lifeMachineTiles: [],
  };
  const human = new HumanPlayer(options.humanTile.x, options.humanTile.y, TILE_SIZE);
  const catTile = options.catTile ?? { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 };
  const cat = new CatPlayer(catTile.x, catTile.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  // A scenario with one crawler takes the other out of the fight entirely: a
  // dead crawler is no target, no body to push and no one to root.
  if (options.catTile === null) cat.hp = 0;

  const spells = new SpellSystem();
  const roster = new MobRoster(map, spells);
  const bus = new EventBus();
  const spider = new GrotesqueSpider(options.spiderTile.x, options.spiderTile.y, TILE_SIZE);
  spider.rng = spiderRng;
  roster.add(spider);

  let quest: SpiderQuestSystem | null = null;
  if (options.withQuest) {
    quest = new SpiderQuestSystem(map, bus, (mob) => {
      roster.add(mob);
    });
    const base = quest.captureCheckpoint();
    const fightCheckpoint: SpiderQuestCheckpoint = {
      ...base,
      phase: 'boss_fight',
      spiderEggOpened: true,
      roomLocked: false,
      fightAborted: false,
      grotesqueSpider: spider,
    };
    quest.restoreCheckpoint(fightCheckpoint);
  }

  const hits: HitRecord[] = [];
  const lab: Lab = {
    map,
    human,
    cat,
    roster,
    loop: new MobUpdateLoop(),
    spider,
    quest,
    combat: {
      human,
      cat,
      mobs: roster.mobs,
      mobGrid: roster.grid,
      gameMap: map,
      safeRoom: null,
      bus,
      abilityManager: new AbilityManager(),
      spells,
      hitLanded: false,
    },
    hits,
    frame: 0,
    ctx: () => ({
      human,
      cat,
      active: human,
      inactive: cat,
      activeIsMoving: false,
      roster,
      gameMap: map,
    }),
  };
  for (const player of [human, cat]) {
    const takeDamage = player.takeDamage.bind(player);
    player.takeDamage = (amount: number, source?: DamageSource): boolean => {
      if (source?.kind === 'mob') {
        hits.push({
          frame: lab.frame,
          victim: player,
          attackType: source.attackType,
          mobType: source.mobType,
          attack: spider.currentAttack,
          attackFrame: spider.attackFrame,
        });
      }
      return takeDamage(amount, source);
    };
  }
  applySpiderFaults(spider);
  return lab;
}

/** Moves a mob and re-buckets it, as every teleport must. */
function teleportMob(lab: Lab, mob: Mob, x: number, y: number): void {
  const oldX = mob.x;
  const oldY = mob.y;
  mob.x = x;
  mob.y = y;
  lab.roster.grid.move(mob, oldX, oldY);
}

/** Places a crawler so its centre sits on `centre`. */
function placeCentre(player: Player, centre: Vec): void {
  player.x = centre.x - HALF_TILE;
  player.y = centre.y - HALF_TILE;
}

/** Holds a body inside the lab, as the fight's room lock holds every crawler in it. */
function clampToLab(body: { x: number; y: number }): void {
  const b = LAB_BOUNDS;
  body.x = clamp(body.x, b.x * TILE_SIZE, (b.x + b.w - 1) * TILE_SIZE);
  body.y = clamp(body.y, b.y * TILE_SIZE, (b.y + b.h - 1) * TILE_SIZE);
}

type Moves = ReadonlyMap<Player, Vec | null>;
const NO_MOVES: Moves = new Map();

/**
 * One game tick, in `DungeonScene`'s order: the quest, the crawlers' own
 * movement, the room lock, every mob, the crawlers' timers, the kill sweep and
 * the strike feedback. A rooted crawler does not move, as the input path
 * refuses it.
 */
function step(lab: Lab, moves: Moves = NO_MOVES): void {
  const ctx = lab.ctx();
  lab.quest?.update(ctx);
  for (const player of [lab.human, lab.cat]) {
    const move = moves.get(player) ?? null;
    const canMove = player.isAlive && !player.hasStatus('stuck') && move !== null;
    if (canMove) pushPlayerWithCollision(player, move.x, move.y, lab.map);
    clampToLab(player);
    player.isMoving = canMove;
  }
  lab.quest?.applyRoomLock(lab.human, lab.cat);
  lab.loop.update(ctx);
  lab.human.tickTimers();
  lab.cat.tickTimers();
  lab.combat.mobGrid = lab.roster.grid;
  resolveKills(lab.combat);
  lab.quest?.updateImpactFeedback();
  lab.frame++;
}

// ─────────────────────────────────────────────────────────────── faults on the spider

function applySpiderFaults(spider: GrotesqueSpider): void {
  switch (fault) {
    case 'double-strike':
      wrapMethod(spider, 'strike', (original, args) => {
        original(...args);
        return original(...args);
      });
      break;
    case 'early-strike':
      wrapMethod(spider, 'runAttackFrame', (original, args) => {
        const attack = spider.currentAttack;
        if (attack !== null && spider.attackFrame === strikeFrame(attack) - 1) {
          callPrivate(spider, 'strike', [attack, args[2]]);
        }
        return original(...args);
      });
      break;
    case 'audio-early':
      wrapMethod(spider, 'runAttackFrame', (original, args) => {
        const result = original(...args);
        const attack = spider.currentAttack;
        const AUDIO_FAULT_LEAD_FRAMES = 2;
        const cue = attack === null ? null : audioStartFrame(attack);
        if (cue !== null && spider.attackFrame === cue - AUDIO_FAULT_LEAD_FRAMES) {
          if (attack === 'slam') spider.slamSoundPending = true;
          if (attack === 'screech') spider.screechSoundPending = true;
        }
        return result;
      });
      break;
    case 'hit-reach': {
      const REACH_FAULT_PX = 3;
      const reachFurther = (original: Invoke, args: unknown[]): unknown => {
        const targets = args[0];
        if (!Array.isArray(targets)) return original(...args);
        const origin = centreOf(spider);
        const moved: Array<{ player: Player; x: number; y: number }> = [];
        for (const target of targets) {
          if (!(target instanceof HumanPlayer) && !(target instanceof CatPlayer)) continue;
          const toward = unit({
            x: origin.x - centreOf(target).x,
            y: origin.y - centreOf(target).y,
          });
          moved.push({ player: target, x: target.x, y: target.y });
          target.x += toward.x * REACH_FAULT_PX;
          target.y += toward.y * REACH_FAULT_PX;
        }
        const result = original(...args);
        for (const entry of moved) {
          entry.player.x = entry.x;
          entry.player.y = entry.y;
        }
        return result;
      };
      wrapMethod(spider, 'dealScreechDamage', reachFurther);
      wrapMethod(spider, 'dealSlamDamage', reachFurther);
      break;
    }
    case 'cone-wide': {
      const WIDEN_FAULT_RAD = (2 / DEGREES_PER_HALF_TURN) * Math.PI;
      wrapMethod(spider, 'dealSlamDamage', (original, args) => {
        const targets = args[0];
        if (!Array.isArray(targets)) return original(...args);
        const origin = centreOf(spider);
        const aim = { x: spider.lockedAimX, y: spider.lockedAimY };
        const moved: Array<{ player: Player; x: number; y: number }> = [];
        for (const target of targets) {
          if (!(target instanceof HumanPlayer) && !(target instanceof CatPlayer)) continue;
          const offset = { x: centreOf(target).x - origin.x, y: centreOf(target).y - origin.y };
          const side = Math.sign(aim.x * offset.y - aim.y * offset.x);
          const turned = rotate(offset, -side * WIDEN_FAULT_RAD);
          moved.push({ player: target, x: target.x, y: target.y });
          placeCentre(target, { x: origin.x + turned.x, y: origin.y + turned.y });
        }
        const result = original(...args);
        for (const entry of moved) {
          entry.player.x = entry.x;
          entry.player.y = entry.y;
        }
        return result;
      });
      break;
    }
    case 'spit-tracks':
      wrapMethod(spider, 'strike', (original, args) => {
        const target = spider.currentTarget;
        if (args[0] === 'spit' && target !== null) callPrivate(spider, 'aimAt', [target]);
        return original(...args);
      });
      break;
    case 'short-lock':
      wrapMethod(spider, 'advanceAttack', (original, args) => {
        const attack = spider.currentAttack;
        if (attack !== null && attackStageAt(attack, spider.attackFrame).stage === 'lock') {
          const next = spider.attackFrame + 1;
          if (next < strikeFrame(attack)) Reflect.set(spider, '_attackFrame', next);
        }
        return original(...args);
      });
      break;
    case 'harmless':
      wrapMethod(spider, 'strike', () => undefined);
      break;
    case 'root-ignored':
      wrapMethod(spider, 'rootedTargetWouldBeCaught', () => false);
      wrapMethod(spider, 'wouldTrapInPendingAreaStrike', () => false);
      break;
    case 'puddle-splash-freezes':
      wrapMethod(spider, 'settleSplashingPuddles', () => undefined);
      break;
    case 'puddle-ttl-pops':
      wrapMethod(spider, 'beginDryingAtEndOfLife', () => undefined);
      break;
    case 'orphan-audio':
      wrapMethod(spider, 'cancelAttackAudioInFlight', () => undefined);
      break;
    case 'level-scaled-area':
      wrapMethod(spider, 'dealPreScaledRangedDamage', (_original, args) =>
        callPrivate(spider, 'dealRangedDamage', args),
      );
      break;
    case 'screech-trap':
      wrapMethod(spider, 'everyoneCaughtCanWalkClear', () => true);
      break;
    case 'probe-ignores-room':
      wrapMethod(spider, 'escapeProbeBounds', () => null);
      break;
    case 'probe-through-her':
      wrapMethod(spider, 'stepRunsIntoHerBody', () => false);
      break;
    case 'eggs-underfoot': {
      const UNDERFOOT_NEAREST_TILES = 1;
      const UNDERFOOT_FARTHEST_TILES = 3;
      wrapMethod(spider, 'eggBandTiles', () => ({
        nearestTiles: UNDERFOOT_NEAREST_TILES,
        farthestTiles: UNDERFOOT_FARTHEST_TILES,
      }));
      break;
    }
    case 'no-reposition':
      wrapMethod(spider, 'tryBeginReposition', () => null);
      break;
    case 'reposition-parks':
      Object.defineProperty(spider, 'repositionWalkStopPx', { get: () => REPOSITION_ARRIVAL_PX });
      break;
    case 'reposition-blind':
      wrapMethod(spider, 'spotSeesTarget', () => true);
      break;
    case 'retargets-mid-tell':
      wrapMethod(spider, 'trackedAttackTarget', () => spider.currentTarget);
      break;
    case 'spit-creeps':
      wrapMethod(spider, 'startAttack', (original, args) => {
        const result = original(...args);
        Reflect.set(spider, 'spitStartDistancePx', 0);
        return result;
      });
      break;
    case 'glob-outlives-her':
      spider.dispose = (): void => undefined;
      break;
    case 'raisable-boss':
      Object.defineProperty(spider, 'countsAsBossKill', { get: () => false });
      break;
    case 'shoved-mid-build':
      spider.applySeparation = (dx: number, dy: number): void => {
        Mob.prototype.applySeparation.call(spider, dx, dy);
      };
      spider.advanceKnockback = (): void => {
        Mob.prototype.advanceKnockback.call(spider);
      };
      wrapMethod(spider, 'abandonsLockOnRootedCrawler', () => false);
      break;
    case 'spit-root':
      wrapMethod(spider, 'wouldTrapUnderPendingSpit', () => false);
      break;
    case 'no-tell':
      wrapMethod(spider, 'advanceAttack', (original, args) => {
        const attack = spider.currentAttack;
        const NO_TELL_JUMP_TO_STRIKE_MINUS = 3;
        if ((attack === 'slam' || attack === 'screech') && spider.attackFrame === 0) {
          Reflect.set(spider, '_attackFrame', strikeFrame(attack) - NO_TELL_JUMP_TO_STRIKE_MINUS);
        }
        return original(...args);
      });
      break;
    case 'no-crush':
      spider.drainSlamImpacts = () => [];
      break;
    case 'puddle-leak':
      spider.clearAirborneAttacks = () => undefined;
      break;
    case 'lay-cooldown':
      wrapMethod(spider, 'canStartLay', (original, args) => {
        Reflect.set(spider, 'layCooldown', 0);
        return original(...args);
      });
      break;
    case 'brood-cap':
      wrapMethod(spider, 'canStartLay', (original, args) => {
        const context = readPrivate(spider, 'broodContext');
        if (context !== null && typeof context === 'object') {
          Reflect.set(context, 'liveBroodCount', () => 0);
        }
        return original(...args);
      });
      break;
    case 'art-late':
    case 'art-early':
    case 'telegraph-late':
    case 'egg-clock':
    case 'egg-tough':
    case 'hatchling-senses':
    case 'egg-heavy':
    case 'brood-leak':
    case 'companion-ignores-eggs':
    case 'cutscene-frozen':
    case 'cutscene-no-reset':
    case 'cutscene-silent-spit':
    case 'cutscene-exposed':
    case 'banner-over-death':
    case 'silent-brood':
    case 'double-splat':
    case null:
      // Not a fault on her: the gate it breaks injects it where it measures.
      break;
  }
}

// ─────────────────────────────────────────────────────────────── scenarios

type AreaAttack = SpiderAreaAttack;
type DamagingAttack = AreaAttack | 'spit';
const DAMAGING: readonly DamagingAttack[] = ['slam', 'screech', 'spit'];
type GeometryName =
  | 'point-blank'
  | 'mid-range'
  | 'edge of range'
  | 'against wall'
  | 'in corner'
  | 'beside the doorway'
  | 'in a nook'
  | 'in a shallow nook';
const GEOMETRIES: readonly GeometryName[] = [
  'point-blank',
  'mid-range',
  'edge of range',
  'against wall',
  'in corner',
  'beside the doorway',
  'in a nook',
  'in a shallow nook',
];

/** How far she can reach with each attack, for placing the start geometries. */
const SPIT_RANGE_TILES = 10;
const REACH_PX: Readonly<Record<DamagingAttack, number>> = {
  slam: SLAM_REACH_PX,
  screech: SCREECH_REACH_PX,
  spit: TILE_SIZE * SPIT_RANGE_TILES,
};
/** How far inside the reach "edge of range" stands. */
const EDGE_INSET_PX = 4;
/** Point-blank is one tile: as close as the push between bodies lets anyone stand. */
const POINT_BLANK_PX = TILE_SIZE;
const MID_RANGE_FRACTION = 0.5;
/**
 * Distances that make the sequencer pick each attack on its first decision:
 * inside the slam's start range, between it and the screech's, and past both
 * for a spit.
 */
const DECISION_DISTANCE_PX: Readonly<Record<DamagingAttack, number>> = {
  slam: 40,
  screech: 80,
  spit: 110,
};

interface Scenario {
  readonly attack: DamagingAttack;
  readonly geometry: GeometryName;
  /** Her centre while she is held for the decision. */
  readonly spiderCentre: Vec;
  /** Unit vector from her centre toward the player. */
  readonly towardPlayer: Vec;
  /** Player's distance from her centre on the first lock tick. */
  readonly lockDistance: number;
}

function tileCentre(tileX: number, tileY: number): Vec {
  return { x: tileX * TILE_SIZE + HALF_TILE, y: tileY * TILE_SIZE + HALF_TILE };
}

/** Geometries where the crawler's back is to a wall, a corner, the doorway or a dead end. */
function isBackedUp(geometry: GeometryName): boolean {
  return (
    geometry === 'against wall' ||
    geometry === 'in corner' ||
    geometry === 'beside the doorway' ||
    geometry === 'in a nook' ||
    geometry === 'in a shallow nook'
  );
}

function buildScenario(attack: DamagingAttack, geometry: GeometryName): Scenario {
  const reach = REACH_PX[attack];
  const mid = reach * MID_RANGE_FRACTION;
  const south = { x: 0, y: 1 };
  const labCentre = tileCentre(LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
  switch (geometry) {
    case 'point-blank':
      return {
        attack,
        geometry,
        spiderCentre: labCentre,
        towardPlayer: south,
        lockDistance: POINT_BLANK_PX,
      };
    case 'mid-range':
      return { attack, geometry, spiderCentre: labCentre, towardPlayer: south, lockDistance: mid };
    case 'edge of range':
      return {
        attack,
        geometry,
        spiderCentre: labCentre,
        towardPlayer: south,
        lockDistance: reach - EDGE_INSET_PX,
      };
    case 'against wall': {
      const playerCentre = tileCentre(LAB_BOUNDS.x, LAB_CENTRE_TILE.y);
      return {
        attack,
        geometry,
        spiderCentre: { x: playerCentre.x + mid, y: playerCentre.y },
        towardPlayer: { x: -1, y: 0 },
        lockDistance: mid,
      };
    }
    case 'in corner': {
      const playerCentre = tileCentre(LAB_BOUNDS.x, LAB_BOUNDS.y + LAB_BOUNDS.h - 1);
      const diagonal = unit({ x: -1, y: 1 });
      return {
        attack,
        geometry,
        spiderCentre: {
          x: playerCentre.x - diagonal.x * mid,
          y: playerCentre.y - diagonal.y * mid,
        },
        towardPlayer: diagonal,
        lockDistance: mid,
      };
    }
    case 'beside the doorway': {
      const playerCentre = tileCentre(DOORWAY_TILE_X, LAB_BOUNDS.y + LAB_BOUNDS.h - 1);
      return {
        attack,
        geometry,
        spiderCentre: { x: playerCentre.x, y: playerCentre.y - mid },
        towardPlayer: south,
        lockDistance: mid,
      };
    }
    case 'in a nook':
    case 'in a shallow nook': {
      const nook = geometry === 'in a nook' ? DEEP_NOOK : SHALLOW_NOOK;
      const mouth = nookMouthTile(nook);
      return {
        attack,
        geometry,
        spiderCentre: tileCentre(mouth.x, mouth.y),
        towardPlayer: { x: 0, y: -1 },
        lockDistance: TILE_SIZE * nook.depthTiles,
      };
    }
  }
}

interface ScenarioRun {
  readonly startedAttack: SpiderAttack | null;
  /** Signed clearance at the strike (area) or the closest pass of the glob (spit). */
  readonly clearance: number;
  /** Blows of this attack offered to the player: attack frame of each. */
  readonly hitFrames: readonly number[];
  /** Attack frames her strike feedback fired on. */
  readonly impactFrames: readonly number[];
  /** Attack frame the impact sound was cued on, or null. */
  readonly soundCueFrame: number | null;
  /** Attack frame the glob first existed on, or null. */
  readonly releaseFrame: number | null;
  /** The glob's velocity when first seen, and the aims on the lock and release ticks. */
  readonly releaseVelocity: Vec | null;
  readonly aimAtLockTick: Vec | null;
  readonly aimAtReleaseTick: Vec | null;
  /** Whether the creature's own hit test agreed with the measured clearance. */
  readonly measurementAgrees: boolean;
}

const SCENARIO_SEED_STRIDE = 7919;

/**
 * Plays one attack from one start geometry. She is held in place until she
 * commits (the decision distance picks which attack), the player is held at the
 * geometry through the tell, and from the first lock tick on the player walks
 * `escape` pixels per tick, or stands still when it is null.
 */
function runScenario(
  scenario: Scenario,
  escape: Vec | null,
  seedOffset: number,
  hold: (lab: Lab) => void = () => undefined,
): ScenarioRun {
  const spiderTile = {
    x: Math.floor(scenario.spiderCentre.x / TILE_SIZE),
    y: Math.floor(scenario.spiderCentre.y / TILE_SIZE),
  };
  const lab = buildLab({
    seed: RUN_SEED + seedOffset * SCENARIO_SEED_STRIDE,
    spiderTile,
    humanTile: spiderTile,
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  const anchor = { x: scenario.spiderCentre.x - HALF_TILE, y: scenario.spiderCentre.y - HALF_TILE };
  const decision = DECISION_DISTANCE_PX[scenario.attack];
  // Beside a wall the decision spot is taken on her open side, since the far
  // side of a crawler backed against the wall is inside it.
  const backedUp = isBackedUp(scenario.geometry);
  const decisionSide = backedUp ? -1 : 1;
  const decisionCentre = {
    x: scenario.spiderCentre.x + scenario.towardPlayer.x * decision * decisionSide,
    y: scenario.spiderCentre.y + scenario.towardPlayer.y * decision * decisionSide,
  };

  let setupFrames = 0;
  while (spider.currentAttack === null && setupFrames < SETUP_FRAME_CEILING) {
    teleportMob(lab, spider, anchor.x, anchor.y);
    placeCentre(human, decisionCentre);
    step(lab);
    setupFrames++;
  }
  const startedAttack = spider.currentAttack;
  const empty: ScenarioRun = {
    startedAttack,
    clearance: -Infinity,
    hitFrames: [],
    impactFrames: [],
    soundCueFrame: null,
    releaseFrame: null,
    releaseVelocity: null,
    aimAtLockTick: null,
    aimAtReleaseTick: null,
    measurementAgrees: false,
  };
  if (startedAttack !== scenario.attack) return empty;

  const attack = scenario.attack;
  const timeline = SPIDER_ATTACK_TIMELINES[attack];
  const strike = strikeFrame(attack);
  const impactFrames: number[] = [];
  let soundCueFrame: number | null = null;
  let releaseFrame: number | null = null;
  let releaseVelocity: Vec | null = null;
  let aimAtLockTick: Vec | null = null;
  let aimAtReleaseTick: Vec | null = null;
  let clearance = Infinity;
  let spitHitSeen = false;
  const hitsBefore = lab.hits.length;

  const observe = (): void => {
    for (const event of spider.drainImpactFeedback()) {
      if (event.attack === attack) impactFrames.push(spider.attackFrame);
    }
    if (soundCueFrame === null && (spider.slamSoundPending || spider.screechSoundPending)) {
      soundCueFrame = spider.attackFrame;
    }
    spider.slamSoundPending = false;
    spider.screechSoundPending = false;
  };

  // Tell: the player is held at the start geometry, so the geometry is exactly
  // where they stand when the lock begins.
  // She is held too: a spit's tell lets her creep, which would otherwise walk
  // the geometry into the wall behind a backed-up crawler.
  const lockCentre = {
    x: scenario.spiderCentre.x + scenario.towardPlayer.x * scenario.lockDistance,
    y: scenario.spiderCentre.y + scenario.towardPlayer.y * scenario.lockDistance,
  };
  while (spider.currentAttack === attack && spider.attackFrame < timeline.tellFrames) {
    teleportMob(lab, spider, anchor.x, anchor.y);
    placeCentre(human, lockCentre);
    hold(lab);
    step(lab);
    observe();
  }
  aimAtLockTick = unit({
    x: centreOf(human).x - centreOf(spider).x,
    y: centreOf(human).y - centreOf(spider).y,
  });

  const moves = new Map<Player, Vec | null>([[human, escape]]);
  const followFrames = attack === 'spit' ? SPIT_FOLLOW_FRAMES : 0;
  let framesAfterStrike = -1;
  let strikeSeen = false;
  while (framesAfterStrike < followFrames) {
    const globBefore = attack === 'spit' ? spitGlob(spider) : null;
    const releaseTickNext = attack === 'spit' && spider.attackFrame === strike - 1;
    if (releaseTickNext && spider.currentTarget !== null) {
      aimAtReleaseTick = unit({
        x: centreOf(spider.currentTarget).x - centreOf(spider).x,
        y: centreOf(spider.currentTarget).y - centreOf(spider).y,
      });
    }
    hold(lab);
    const hitsBeforeTick = lab.hits.length;
    step(lab, moves);
    observe();
    const attackStillRunning = spider.currentAttack === attack;
    if (attackStillRunning && spider.attackFrame === strike) strikeSeen = true;

    if (attack === 'spit') {
      const glob = spitGlob(spider);
      if (glob !== null && releaseFrame === null) {
        releaseFrame = spider.attackFrame;
        releaseVelocity = unit({ x: glob.vx, y: glob.vy });
      }
      const spitHitThisTick = lab.hits
        .slice(hitsBeforeTick)
        .some((hit) => hit.attackType === 'spit' && hit.victim === human);
      if (glob !== null) {
        clearance = Math.min(clearance, distance(glob, centreOf(human)) - SPIT_HIT_RADIUS_PX);
      } else if (globBefore !== null && spitHitThisTick) {
        const landed = { x: globBefore.x + globBefore.vx, y: globBefore.y + globBefore.vy };
        clearance = Math.min(clearance, distance(landed, centreOf(human)) - SPIT_HIT_RADIUS_PX);
      }
      if (spitHitThisTick) spitHitSeen = true;
    } else if (attackStillRunning && spider.attackFrame === strike) {
      const origin = centreOf(spider);
      const playerCentre = centreOf(human);
      clearance =
        attack === 'screech'
          ? distance(origin, playerCentre) - SCREECH_RADIUS_PX
          : coneClearance(
              {
                originX: origin.x,
                originY: origin.y,
                dirX: spider.lockedAimX,
                dirY: spider.lockedAimY,
                radiusPx: SLAM_CONE_RADIUS_PX,
                halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
              },
              playerCentre,
            );
    }
    if (strikeSeen) framesAfterStrike++;
    const attackOver = !attackStillRunning && !strikeSeen;
    if (attackOver) break;
  }
  // The rest of the attack, so a second blow on any later tick is caught too.
  while (spider.currentAttack === attack) {
    step(lab, moves);
    observe();
  }

  const hitFrames = lab.hits
    .slice(hitsBefore)
    .filter((hit) => hit.attackType === attack && hit.victim === human)
    .map((hit) => (hit.attack === attack ? hit.attackFrame : -1));
  const hitByTheCreature = attack === 'spit' ? spitHitSeen : hitFrames.length > 0;
  return {
    startedAttack,
    clearance,
    hitFrames,
    impactFrames,
    soundCueFrame,
    releaseFrame,
    releaseVelocity,
    aimAtLockTick,
    aimAtReleaseTick,
    measurementAgrees: hitByTheCreature === clearance < 0,
  };
}

/** One keyboard walk step, scaled on a diagonal exactly as `applyMovement` scales it. */
function escapeDirection(index: number): Vec {
  const angle = (index / ESCAPE_DIRECTIONS) * Math.PI * 2;
  const keyX = Math.round(Math.cos(angle));
  const keyY = Math.round(Math.sin(angle));
  const scale = keyX !== 0 && keyY !== 0 ? DIAGONAL_PENALTY : 1;
  return { x: keyX * scale * PLAYER_SPEED, y: keyY * scale * PLAYER_SPEED };
}

/** Decimal places for a measurement that is read to the pixel, a fraction, or a hair of a degree. */
const FINE_DIGITS = 3;
const ANGLE_DIGITS = 6;
const fmt = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : String(value);

// ─────────────────────────────────────────────────────────────── gates 1, 3, 6, 7

interface DodgeResult {
  readonly scenario: Scenario;
  readonly best: ScenarioRun;
  readonly bestDirection: number;
  readonly still: ScenarioRun;
}

function runDodgeMatrix(): DodgeResult[] {
  const results: DodgeResult[] = [];
  let seedOffset = 0;
  for (const attack of DAMAGING) {
    for (const geometry of GEOMETRIES) {
      const scenario = buildScenario(attack, geometry);
      seedOffset++;
      const still = runScenario(scenario, null, seedOffset);
      let best: ScenarioRun | null = null;
      let bestDirection = -1;
      for (let direction = 0; direction < ESCAPE_DIRECTIONS; direction++) {
        const run = runScenario(scenario, escapeDirection(direction), seedOffset);
        if (best === null || run.clearance > best.clearance) {
          best = run;
          bestDirection = direction;
        }
      }
      results.push({ scenario, best: best ?? still, bestDirection, still });
    }
  }
  return results;
}

function gateDamageTick(matrix: readonly DodgeResult[]): void {
  for (const attack of DAMAGING) {
    const runs = matrix.filter((result) => result.scenario.attack === attack).map((r) => r.still);
    const strike = strikeFrame(attack);
    const started = runs.filter((run) => run.startedAttack === attack);
    record(
      '1',
      `${attack}: every scenario reached the attack`,
      started.length === runs.length && runs.length > 0,
      `${started.length}/${runs.length}`,
    );
    const impactOk = started.every(
      (run) => run.impactFrames.length === 1 && run.impactFrames[0] === strike,
    );
    const impactSeen = started.map((run) => `[${run.impactFrames.join(',')}]`).join(' ');
    record('1', `${attack}: strike fires exactly once, on frame ${strike}`, impactOk, impactSeen);
    if (attack === 'spit') {
      const releaseOk = started.every((run) => run.releaseFrame === strike);
      record(
        '1',
        `spit: the glob leaves on frame ${strike}`,
        releaseOk,
        started.map((run) => String(run.releaseFrame)).join(' '),
      );
      continue;
    }
    const hitOk = started.every((run) => run.hitFrames.length === 1 && run.hitFrames[0] === strike);
    record(
      '1',
      `${attack}: a player standing in it is struck exactly once, on frame ${strike}`,
      hitOk,
      started.map((run) => `[${run.hitFrames.join(',')}]`).join(' '),
    );
  }
}

function gateAudio(matrix: readonly DodgeResult[]): void {
  for (const attack of ['slam', 'screech'] as const) {
    const timeline = SPIDER_ATTACK_TIMELINES[attack];
    const impactSeconds = timeline.audioImpactSeconds;
    const cue = audioStartFrame(attack);
    if (impactSeconds === null || cue === null) {
      record('3', `${attack}: has a timed impact sound`, false, 'no audioImpactSeconds');
      continue;
    }
    const landing = cue + (impactSeconds - audioSeekSeconds(attack)) * SPIDER_FRAMES_PER_SECOND;
    const offBy = Math.abs(landing - strikeFrame(attack));
    record(
      '3',
      `${attack}: the audible hit lands within ${AUDIO_TOLERANCE_FRAMES} frame of the strike`,
      offBy <= AUDIO_TOLERANCE_FRAMES,
      `lands on ${fmt(landing, 2)}, strike ${strikeFrame(attack)}`,
    );
    const cues = matrix
      .filter((result) => result.scenario.attack === attack)
      .map((result) => result.still.soundCueFrame);
    const creatureCuesOnTime = cues.length > 0 && cues.every((frame) => frame === cue);
    const audibleLeadFrames = (impactSeconds - audioSeekSeconds(attack)) * SPIDER_FRAMES_PER_SECOND;
    const creatureLanding = Math.max(
      cues.length === 0 ? Infinity : 0,
      ...cues.map((frame) =>
        frame === null ? Infinity : Math.abs(frame + audibleLeadFrames - strikeFrame(attack)),
      ),
    );
    record(
      '3',
      `${attack}: the creature cues the sound on frame ${cue}`,
      creatureCuesOnTime && creatureLanding <= AUDIO_TOLERANCE_FRAMES,
      `cued on [${cues.join(',')}], worst landing ${fmt(creatureLanding, 2)} frames off`,
    );
  }
}

/** Frames the whole lab cutscene may take before the probe calls it stuck. */
const CUTSCENE_CEILING_FRAMES = 3000;

/**
 * The lab cutscene's spit: once her glob is in the air her own spit must keep
 * playing (release, then recoil), not hold on its release frame with a second
 * glob drawn in her mouth; and the fight must open with her in no attack at
 * all, never mid-recovery and exposed before she has done anything to read.
 */
function cutsceneSpitPlaysThrough(): void {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + 1 },
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 },
    catTile: null,
    withQuest: false,
  });
  lab.spider.hp = 0;
  const quest = new SpiderQuestSystem(lab.map, new EventBus(), (mob) => {
    lab.roster.add(mob);
  });
  Reflect.set(quest, 'phase', 'cutscene');
  let spider: GrotesqueSpider | null = null;
  const framesInFlight: number[] = [];
  let openedClean = false;
  let openingGap = NaN;
  let openingCycleIndex = NaN;
  let opened = false;
  let fireCues = 0;
  let exposedCutsceneTicks = 0;
  for (let frame = 0; frame < CUTSCENE_CEILING_FRAMES && !opened; frame++) {
    quest.update(lab.ctx());
    if (fault === 'cutscene-silent-spit') quest.cutsceneSpitFireSoundPending = false;
    if (quest.cutsceneSpitFireSoundPending) fireCues++;
    quest.cutsceneSpitFireSoundPending = false;
    const current = readPrivate(quest, '_grotesqueSpider');
    if (spider === null && current instanceof GrotesqueSpider) {
      spider = current;
      if (fault === 'cutscene-frozen') {
        wrapMethod(current, 'tickCutsceneSpit', (original, args) => {
          const globOut = readPrivate(quest, '_cutsceneProjectile') !== null;
          const holding = numberField(quest, '_cutsceneFightStartTimer') > 0;
          return globOut || holding ? false : original(...args);
        });
      }
      if (fault === 'cutscene-no-reset') wrapMethod(current, 'resetAttackState', () => undefined);
      if (fault === 'cutscene-exposed') {
        const staged = current;
        Object.defineProperty(staged, 'isExposed', {
          get: () => {
            const attack = staged.currentAttack;
            return attack !== null && staged.attackFrame >= recoveryStartFrame(attack);
          },
        });
      }
    }
    if (spider?.isExposed === true && readPrivate(quest, 'phase') === 'cutscene') {
      exposedCutsceneTicks++;
    }
    if (spider !== null && readPrivate(quest, '_cutsceneProjectile') !== null) {
      framesInFlight.push(spider.attackFrame);
    }
    if (readPrivate(quest, 'phase') === 'boss_fight') {
      opened = true;
      openedClean = spider !== null && spider.currentAttack === null && !spider.isExposed;
      if (spider !== null) {
        openingGap = numberField(spider, 'gapTimer');
        openingCycleIndex = numberField(spider, 'cycleIndex');
      }
    }
  }
  const first = firstOf(framesInFlight);
  const distinctFrames = new Set(framesInFlight).size;
  const playedOn = first !== undefined && distinctFrames > 1;
  record(
    '1',
    'cutscene: her spit plays on while its glob flies',
    playedOn,
    first === undefined
      ? 'no glob seen'
      : `${distinctFrames} distinct attack frames over ${framesInFlight.length} ticks of flight, from ${first}`,
  );
  record(
    '1',
    'cutscene: the fight opens with her in no attack and not exposed',
    opened && openedClean,
    !opened
      ? 'the fight never opened'
      : `${spider?.currentAttack ?? 'no attack'}, ${spider?.isExposed === true ? 'exposed' : 'not exposed'}`,
  );
  record(
    '1',
    'cutscene: her spit plays its fire sound once, as it leaves her mouth',
    fireCues === 1,
    `${fireCues} fire cues`,
  );
  record(
    '1',
    'cutscene: she is never exposed before the fight exists',
    spider !== null && exposedCutsceneTicks === 0,
    `${exposedCutsceneTicks} exposed cutscene ticks`,
  );
  // What the reset at the fight's opening guarantees beyond "no attack": her
  // cutscene spit has long finished by then, but its finish rolled a gap and
  // left her rotation wherever it stood. The fight opens on the first gap and
  // at the start of her cycle, the same as any fresh fight.
  const openedFresh = openingGap === FIRST_ATTACK_GAP_FRAMES && openingCycleIndex === 0;
  record(
    '1',
    'cutscene: the fight opens on her first-attack gap at the start of her cycle',
    opened && openedFresh,
    `gap ${fmt(openingGap, 0)} (first gap ${FIRST_ATTACK_GAP_FRAMES}), cycle index ${fmt(openingCycleIndex, 0)}`,
  );
}

/** Attack frames past the cue at which an in-flight attack is cut short in the audio probes. */
const CUT_SHORT_AFTER_CUE_FRAMES = 2;
/** Frames the root lasts in the abandoned-lock audio probe: longer than any lock. */
const PROBE_ROOT_FRAMES = 200;

type CutShort = 'called off' | 'her death' | 'given up at the lock' | 'none: it strikes';

/**
 * One screech on a crawler a tile south of her, cut short the way named, or
 * run to its strike. Returns whether she reported an impact sound to stop.
 */
function screechAudioCancelled(how: CutShort): boolean {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + 1 },
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  callPrivate(spider, 'startAttack', ['screech', human, [human, lab.cat]]);
  const cue = audioStartFrame('screech') ?? 0;
  const lockBegins = SPIDER_ATTACK_TIMELINES.screech.tellFrames;
  const heard = { cancelled: false };
  const stepOnce = (): void => {
    step(lab);
    human.hp = human.maxHp;
    if (spider.drainCancelledAttackAudio() !== null) heard.cancelled = true;
  };
  if (how === 'given up at the lock') {
    while (attackOf(spider) === 'screech' && spider.attackFrame < lockBegins - 1) stepOnce();
    human.applyStatus(makeStuck(PROBE_ROOT_FRAMES));
    stepOnce();
    return heard.cancelled && attackOf(spider) !== 'screech';
  }
  if (how === 'none: it strikes') {
    while (attackOf(spider) === 'screech') stepOnce();
    return heard.cancelled;
  }
  while (attackOf(spider) === 'screech' && spider.attackFrame < cue + CUT_SHORT_AFTER_CUE_FRAMES) {
    stepOnce();
  }
  if (how === 'called off') spider.resetAttackState();
  else spider.takeDamageFrom(spider.hp, human, 'melee');
  stepOnce();
  return heard.cancelled;
}

/**
 * The slam and screech sounds start well before the strike. An attack cut
 * short after its cue must report the sound for the scene to stop; one that
 * strikes must not.
 */
function cancelledAttackAudio(): void {
  const cases: readonly CutShort[] = ['called off', 'her death', 'given up at the lock'];
  for (const how of cases) {
    const cancelled = screechAudioCancelled(how);
    record(
      '3',
      `a screech ${how} after its cue has its sound stopped`,
      cancelled,
      cancelled ? 'stopped' : 'left playing',
    );
  }
  const struck = screechAudioCancelled('none: it strikes');
  record('3', 'a screech that strikes keeps its sound', !struck, struck ? 'stopped' : 'kept');
}

/** Frames past the hatch countdown the brood audio probe waits for an egg to hatch. */
const HATCH_WAIT_SLACK_FRAMES = 120;

/**
 * An egg dropping, being smashed and hatching each raise their sound flag, and
 * every sound the brood and the hatchlings use is in a group the lab floor
 * loads: an id in no loaded group is a cue that never sounds, silently.
 */
function broodAudio(): void {
  const lab = broodLab(RUN_SEED);
  const quest = questOf(lab);
  if (fault === 'double-splat') {
    wrapMethod(quest, '_updateBrood', (original, args) => {
      const smashedBefore = quest.broodEggs.some(
        (egg) => !egg.isAlive && egg.ending === 'destroyed',
      );
      const result = original(...args);
      if (smashedBefore) quest.eggBurstSoundPending = true;
      return result;
    });
  }
  if (fault === 'silent-brood') {
    for (const key of ['_spawnEgg', '_hatchDueEggs', '_updateBrood']) {
      wrapMethod(quest, key, (original, args) => {
        const result = original(...args);
        quest.eggLandSoundPending = false;
        quest.eggBurstSoundPending = false;
        quest.eggHatchSoundPending = false;
        return result;
      });
    }
  }
  // Read through a call: each flag is cleared just above, and a direct read
  // would be narrowed to that literal false.
  const heard = (flag: 'eggLandSoundPending' | 'eggBurstSoundPending' | 'eggHatchSoundPending') =>
    quest[flag];
  const eggTile = { tileX: LAB_CENTRE_TILE.x - STAND_OFF_TILES, tileY: LAB_CENTRE_TILE.y };
  quest.eggLandSoundPending = false;
  callPrivate(quest, '_spawnEgg', [eggTile]);
  const landed = heard('eggLandSoundPending');

  // Every egg ending must sound exactly once. A crawler's smash is a kill, and
  // the kill event plays its splat; her crush and a hatch raise the quest's
  // own flags. One ending voiced both ways plays two splats over each other.
  const killCues = { count: 0 };
  lab.combat.bus.on('mobKilled', (event) => {
    if (event.mob instanceof SpiderEgg) killCues.count++;
  });
  const cuesFor = (end: () => void, flag: 'eggBurstSoundPending' | 'eggHatchSoundPending') => {
    killCues.count = 0;
    quest.eggBurstSoundPending = false;
    quest.eggHatchSoundPending = false;
    end();
    return killCues.count + (heard(flag) ? 1 : 0);
  };

  const smashedCues = cuesFor(() => {
    firstOf(eggsOf(lab))?.takeDamageFrom(1, lab.human, 'melee');
    step(lab, standOff(lab));
  }, 'eggBurstSoundPending');

  callPrivate(quest, '_spawnEgg', [eggTile]);
  const crushedCues = cuesFor(() => {
    const egg = firstOf(eggsOf(lab));
    if (egg === undefined) return;
    const eggCentre = centreOf(egg);
    const impact: SlamImpact = {
      originX: eggCentre.x,
      originY: eggCentre.y - TILE_SIZE,
      dirX: 0,
      dirY: 1,
      radiusPx: SLAM_CONE_RADIUS_PX,
      halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
    };
    callPrivate(quest, '_crushEggsUnder', [impact]);
    step(lab, standOff(lab));
  }, 'eggBurstSoundPending');

  callPrivate(quest, '_spawnEgg', [eggTile]);
  const hatchedCues = cuesFor(() => {
    for (let frame = 0; frame < EGG_HATCH_FRAMES + HATCH_WAIT_SLACK_FRAMES; frame++) {
      step(lab, standOff(lab));
      if (heard('eggHatchSoundPending')) return;
    }
  }, 'eggHatchSoundPending');

  record(
    '3',
    'an egg dropping, smashed, crushed by her and hatching each sound exactly once',
    landed && smashedCues === 1 && crushedCues === 1 && hatchedCues === 1,
    `drop ${landed ? 'heard' : 'silent'}; cues per end: smashed ${smashedCues}, crushed ${crushedCues}, hatched ${hatchedCues}`,
  );

  const loaded = new Set<SoundId>([...SFX_GROUPS.universal, ...sfxGroupsForLevelId('level2')]);
  const cues: readonly SoundId[] = ['splat_1', 'splat_2', 'splat_3', 'bite_1', 'bite_2', 'bite_3'];
  const unloaded = cues.filter((id) => !loaded.has(id));
  const hatchlingHasVoice = new SpiderHatchling(0, 0, TILE_SIZE, LAB_BOUNDS).audioTag !== '';
  record(
    '3',
    'brood and hatchling sounds are loaded on the lab floor, and hatchlings have a voice',
    unloaded.length === 0 && hatchlingHasVoice,
    `${unloaded.length === 0 ? 'all loaded' : `not loaded: ${unloaded.join(', ')}`}; hatchling audioTag ${hatchlingHasVoice ? 'set' : 'missing'}`,
  );
}

/** A level well up the curve, where a level-scaled blow would be several times its base. */
const LEVELLED_SPIDER_LEVEL = 8;

/**
 * Her slam and screech are priced as a share of the victim's own max HP,
 * which already scales with the party. A levelled spider must take the same
 * share as an unlevelled one; scaling it again would multiply it in twice.
 */
function areaDamageIgnoresLevel(): void {
  for (const attack of ['slam', 'screech'] as const) {
    const shares = [1, LEVELLED_SPIDER_LEVEL].map((level) => {
      const lab = buildLab({
        seed: RUN_SEED,
        spiderTile: LAB_CENTRE_TILE,
        humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + 1 },
        catTile: null,
        withQuest: false,
      });
      lab.spider.applyMobLevel(level);
      callPrivate(lab.spider, 'aimAt', [lab.human]);
      const before = lab.human.hp;
      const deal = attack === 'slam' ? 'dealSlamDamage' : 'dealScreechDamage';
      callPrivate(lab.spider, deal, [[lab.human, lab.cat]]);
      return (before - lab.human.hp) / lab.human.maxHp;
    });
    const unlevelled = firstOf(shares) ?? NaN;
    const levelled = shares[shares.length - 1] ?? NaN;
    record(
      '7',
      `${attack}: a level-${LEVELLED_SPIDER_LEVEL} spider takes the same share of max HP as a level-1`,
      unlevelled > 0 && unlevelled === levelled,
      `level 1 ${fmt(unlevelled, FINE_DIGITS)}, level ${LEVELLED_SPIDER_LEVEL} ${fmt(levelled, FINE_DIGITS)} of max HP`,
    );
  }
}

let minDodgeMargin = Infinity;
let minDodgeLabel = '';

/**
 * For an area attack that could not be dodged: the fewest ticks of walking at
 * `PLAYER_SPEED`, in the best keyboard direction, that clear its shape from
 * the scenario's lock geometry, held inside the lab and stopped by her body.
 * What the lock would have to last for the gate to pass, for whoever tunes it;
 * Infinity when no walk gets out at all.
 */
function freeFramesToEscape(scenario: Scenario): number {
  const FRAME_SEARCH_CEILING = 600;
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: buildLabGrid() });
  const her = scenario.spiderCentre;
  const shapeClearance = (p: Vec): number =>
    scenario.attack === 'screech'
      ? distance(p, her) - SCREECH_RADIUS_PX
      : coneClearance(
          {
            originX: her.x,
            originY: her.y,
            dirX: scenario.towardPlayer.x,
            dirY: scenario.towardPlayer.y,
            radiusPx: SLAM_CONE_RADIUS_PX,
            halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
          },
          p,
        );
  let fewest = Infinity;
  for (let direction = 0; direction < ESCAPE_DIRECTIONS; direction++) {
    const walk = escapeDirection(direction);
    const body = {
      x: her.x + scenario.towardPlayer.x * scenario.lockDistance - HALF_TILE,
      y: her.y + scenario.towardPlayer.y * scenario.lockDistance - HALF_TILE,
    };
    for (let frame = 1; frame <= FRAME_SEARCH_CEILING && frame < fewest; frame++) {
      const gapBefore = distance(centreOf(body), her);
      pushPlayerWithCollision(body, walk.x, walk.y, map);
      clampToLab(body);
      const gapAfter = distance(centreOf(body), her);
      const pressesIntoHer = gapAfter < SEPARATION_RADIUS && gapAfter < gapBefore;
      if (pressesIntoHer) break;
      if (shapeClearance(centreOf(body)) > 0) {
        fewest = frame;
        break;
      }
    }
  }
  return fewest;
}

/**
 * Whether she refuses to start this attack with the crawler already
 * standing at the scenario's lock geometry. Her escape rule turns one down
 * when a crawler inside it could not walk clear within the lock, so a crawler
 * backed against a wall or into a corner must find the attack either refused
 * or dodgeable. The matrix itself decides with the crawler out on her open
 * side and only then backs them up, which is the one order that rule cannot
 * see; asked here, it is the rule's answer at the lock geometry itself.
 */
function attackDeclinedAt(scenario: Scenario): boolean {
  const anchor = { x: scenario.spiderCentre.x - HALF_TILE, y: scenario.spiderCentre.y - HALF_TILE };
  const spiderTile = {
    x: Math.floor(scenario.spiderCentre.x / TILE_SIZE),
    y: Math.floor(scenario.spiderCentre.y / TILE_SIZE),
  };
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile,
    humanTile: spiderTile,
    catTile: null,
    withQuest: false,
  });
  teleportMob(lab, lab.spider, anchor.x, anchor.y);
  placeCentre(lab.human, {
    x: scenario.spiderCentre.x + scenario.towardPlayer.x * scenario.lockDistance,
    y: scenario.spiderCentre.y + scenario.towardPlayer.y * scenario.lockDistance,
  });
  const allowed =
    scenario.attack === 'spit'
      ? callPrivate(lab.spider, 'canStartSpit', [lab.human, scenario.lockDistance])
      : callPrivate(lab.spider, 'canStartAreaAttack', [
          scenario.attack,
          lab.human,
          scenario.lockDistance,
          [lab.human, lab.cat],
        ]);
  if (typeof allowed !== 'boolean') throw new Error('lookup failed: the start check answer');
  return !allowed;
}

function gateDodgeAndDanger(matrix: readonly DodgeResult[]): void {
  let declinedCount = 0;
  for (const result of matrix) {
    const { scenario, best, still } = result;
    const label = `${scenario.attack} ${scenario.geometry}`;
    const reached = best.startedAttack === scenario.attack;
    const backedUp = isBackedUp(scenario.geometry);
    const declined = backedUp && attackDeclinedAt(scenario);
    if (declined) {
      declinedCount++;
      const escapeNote =
        scenario.attack === 'spit'
          ? ''
          : `: a crawler here needs ${fmt(freeFramesToEscape(scenario), 0)} free frames, lock gives ${SPIDER_ATTACK_TIMELINES[scenario.attack].lockFrames}`;
      record(
        '6',
        `${label}: she declines it here, or it is dodged from the first lock tick`,
        true,
        `declined${escapeNote}`,
      );
    } else if (backedUp) {
      record(
        '6',
        `${label}: she declines it here, or it is dodged from the first lock tick`,
        reached && best.clearance > 0 && best.measurementAgrees,
        `allowed; ${fmt(best.clearance)} px clear (dir ${result.bestDirection}/${ESCAPE_DIRECTIONS})${
          best.measurementAgrees ? '' : ', creature disagrees with the measurement'
        }`,
      );
    }
    if (backedUp) {
      if (!declined && reached && best.clearance < minDodgeMargin) {
        minDodgeMargin = best.clearance;
        minDodgeLabel = label;
      }
      recordDanger(label, scenario, still);
      continue;
    }
    record(
      '6',
      `${label}: dodged from the first lock tick`,
      reached && best.clearance > 0 && best.measurementAgrees,
      `${fmt(best.clearance)} px clear (dir ${result.bestDirection}/${ESCAPE_DIRECTIONS})${
        best.measurementAgrees ? '' : ', creature disagrees with the measurement'
      }${
        best.clearance > 0 || scenario.attack === 'spit'
          ? ''
          : `; needs ${fmt(freeFramesToEscape(scenario), 0)} free frames, lock gives ${SPIDER_ATTACK_TIMELINES[scenario.attack].lockFrames}`
      }`,
    );
    if (reached && best.clearance < minDodgeMargin) {
      minDodgeMargin = best.clearance;
      minDodgeLabel = label;
    }
    recordDanger(label, scenario, still);
  }
  // The escape rule must be a judgement, not a blanket refusal: the open
  // geometries above all had to be screeched and dodged, and at least one
  // backed-up geometry has to be one she refuses, or the rule was never asked.
  record(
    '6',
    'the escape rule refuses at least one backed-up area attack',
    declinedCount > 0,
    `${declinedCount} refused`,
  );
}

function recordDanger(label: string, scenario: Scenario, still: ScenarioRun): void {
  const struck = still.startedAttack === scenario.attack && still.clearance < 0;
  const hitOffered =
    scenario.attack === 'spit'
      ? still.clearance < 0 && still.measurementAgrees
      : still.hitFrames.length > 0;
  record(
    '7',
    `${label}: standing still is struck`,
    struck && hitOffered,
    `${fmt(still.clearance)} px (${still.hitFrames.length} blow${still.hitFrames.length === 1 ? '' : 's'})`,
  );
}

// ─────────────────────────────────────────────────────────────── gate 2: art

/** The row frame the wrapper shows on an attack frame. */
function shownRowFrame(attack: DamagingAttack, attackFrame: number): number {
  const ART_FAULT_SHIFT_FRAMES = 2;
  const shift =
    fault === 'art-late'
      ? -ART_FAULT_SHIFT_FRAMES
      : fault === 'art-early'
        ? ART_FAULT_SHIFT_FRAMES
        : 0;
  return grotesqueSpiderRowFrameAt(attack, Math.max(0, attackFrame + shift));
}

function poseOf(row: GrotesqueSpiderAttackRow, frame: number): GrotesqueSpiderPose | null {
  const poseFor = GROTESQUE_SPIDER_ROW_POSES.get(row);
  return poseFor === undefined ? null : poseFor(frame);
}

/** Both front leg tips on the floor, inside the cone she faces (+Y in the painted frame). */
function frontLegsStrike(pose: GrotesqueSpiderPose): {
  readonly ok: boolean;
  readonly detail: string;
} {
  const cone: SlamImpact = {
    originX: 0,
    originY: 0,
    dirX: 0,
    dirY: 1,
    radiusPx: SLAM_CONE_RADIUS_TILES,
    halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
  };
  const parts: string[] = [];
  let ok = FRONT_LEG_INDICES.length > 0;
  for (const leg of FRONT_LEG_INDICES) {
    const tip = getSpiderLegTip(pose, leg);
    const grounded = tip.height <= GROUND_CONTACT_TOLERANCE_TILES;
    const inside = isInsideSlamCone(cone, tip.x, tip.y);
    ok = ok && grounded && inside;
    parts.push(`h${fmt(tip.height, FINE_DIGITS)}${inside ? '' : ' outside'}`);
  }
  return { ok, detail: parts.join('/') };
}

function gateArt(): void {
  const ATTACK_ROW_TICKS = (attack: DamagingAttack): number[] =>
    Array.from({ length: totalFrames(attack) }, (_, frame) => frame);

  // Slam: the legs meet the floor inside the cone on the strike tick, not before, and stay there.
  {
    const row = GROTESQUE_SPIDER_ATTACK_ROWS.slam;
    const strike = strikeFrame('slam');
    const hold = SPIDER_ATTACK_TIMELINES.slam.impactHoldFrames;
    const at = (frame: number): { ok: boolean; detail: string } => {
      const pose = poseOf(row, shownRowFrame('slam', frame));
      return pose === null ? { ok: false, detail: 'row has no poses' } : frontLegsStrike(pose);
    };
    const onStrike = at(strike);
    const before = at(strike - 1);
    record(
      '2',
      'slam: front leg tips on the floor inside the cone on the strike tick',
      onStrike.ok,
      onStrike.detail,
    );
    record('2', 'slam: and not on the tick before', !before.ok, before.detail);
    const heldTicks = Array.from({ length: hold }, (_, i) => strike + i).filter(
      (frame) => at(frame).ok,
    );
    record(
      '2',
      `slam: contact held for the ${hold}-frame impact hold`,
      heldTicks.length === hold,
      `${heldTicks.length}/${hold} ticks`,
    );
  }

  // Screech: the maw is at its widest on the burst tick and holds it.
  {
    const row = GROTESQUE_SPIDER_ATTACK_ROWS.screech;
    const strike = strikeFrame('screech');
    const hold = SPIDER_ATTACK_TIMELINES.screech.impactHoldFrames;
    const mawAt = (frame: number): number => {
      const pose = poseOf(row, shownRowFrame('screech', frame));
      return pose === null ? -1 : spiderMawOpen(pose);
    };
    const widest = Math.max(...ATTACK_ROW_TICKS('screech').map(mawAt));
    const onStrike = mawAt(strike);
    record(
      '2',
      'screech: the maw is at its widest on the burst tick',
      widest > 0 && onStrike >= widest - MAW_MAX_TOLERANCE,
      `${fmt(onStrike, FINE_DIGITS)} of ${fmt(widest, FINE_DIGITS)}`,
    );
    const before = mawAt(strike - 1);
    record(
      '2',
      'screech: and narrower on the tick before',
      before < widest - MAW_MAX_TOLERANCE,
      fmt(before, FINE_DIGITS),
    );
    const held = Array.from({ length: hold }, (_, i) => strike + i).filter(
      (frame) => mawAt(frame) >= widest - MAW_MAX_TOLERANCE,
    ).length;
    record(
      '2',
      `screech: widest maw held for the ${hold}-frame impact hold`,
      held === hold,
      `${held}/${hold} ticks`,
    );
  }

  // Spit: the glob sits on the mouth's edge on the release tick.
  {
    const row = GROTESQUE_SPIDER_ATTACK_ROWS.spit;
    const strike = strikeFrame('spit');
    const pose = poseOf(row, shownRowFrame('spit', strike));
    const glob = pose === null ? null : spiderGlobAtMouth(pose);
    const gap = glob === null ? Infinity : distance(glob.glob, glob.mouthEdge) - glob.radius;
    record(
      '2',
      'spit: the glob sits on the mouth edge on the release tick',
      glob !== null && gap <= 0,
      `${fmt(gap, FINE_DIGITS)} tiles past touching`,
    );
  }

  // Every contact frame is on screen long enough that a doubled update still draws it.
  for (const attack of DAMAGING) {
    const strike = strikeFrame(attack);
    const contact = shownRowFrame(attack, strike);
    let run = 0;
    while (shownRowFrame(attack, strike + run) === contact && run < totalFrames(attack)) run++;
    record(
      '2',
      `${attack}: contact frame shown for at least ${MIN_IMPACT_HOLD_FRAMES} ticks`,
      run >= MIN_IMPACT_HOLD_FRAMES,
      `${run} ticks`,
    );
  }
}

/**
 * What the creature hands its sprite on each attack tick must be the attack
 * clock itself. A clamped progress would freeze the row on its contact frame
 * and never show the recovery poses the frame table paints.
 */
function gateArtWiring(): void {
  for (const attack of DAMAGING) {
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: LAB_CENTRE_TILE,
      humanTile: LAB_CENTRE_TILE,
      catTile: null,
      withQuest: false,
    });
    const scenario = buildScenario(attack, 'mid-range');
    const decision = DECISION_DISTANCE_PX[attack];
    const anchor = { x: lab.spider.x, y: lab.spider.y };
    let frames = 0;
    while (lab.spider.currentAttack === null && frames < SETUP_FRAME_CEILING) {
      teleportMob(lab, lab.spider, anchor.x, anchor.y);
      placeCentre(lab.human, {
        x: centreOf(lab.spider).x + scenario.towardPlayer.x * decision,
        y: centreOf(lab.spider).y + scenario.towardPlayer.y * decision,
      });
      step(lab);
      frames++;
    }
    const mismatches: number[] = [];
    let ticks = 0;
    let facingError = Infinity;
    while (lab.spider.currentAttack === attack) {
      if (lab.spider.attackFrame === strikeFrame(attack))
        facingError = drawnFacingError(lab.spider);
      const shown = spriteClockOf(lab.spider);
      if (shown === null || Math.abs(shown - lab.spider.attackFrame) > VECTOR_TOLERANCE) {
        mismatches.push(lab.spider.attackFrame);
      }
      ticks++;
      step(lab);
    }
    record(
      '2',
      `${attack}: the creature hands the sprite its attack clock on every tick`,
      ticks > 0 && mismatches.length === 0,
      ticks === 0
        ? 'attack never started'
        : mismatches.length === 0
          ? `${ticks} ticks`
          : `${mismatches.length}/${ticks} ticks differ, first at frame ${mismatches[0]}`,
    );
    record(
      '2',
      `${attack}: her body is drawn facing her locked aim on the strike tick`,
      facingError <= ANGLE_TOLERANCE_RAD,
      `${fmt(radToDeg(facingError), 2)}° off`,
    );
  }
}

/**
 * How far the direction her painted +Y is rotated to differs from her locked
 * aim: the contact frame puts her legs in the cone only if she is drawn facing
 * it.
 */
function drawnFacingError(spider: GrotesqueSpider): number {
  const probe = recordingContext();
  try {
    spider.render(probe.ctx, 0, 0, TILE_SIZE);
  } catch (error) {
    notes.push(`gate 2 body render threw: ${String(error)}`);
    return Infinity;
  }
  const aim = { x: spider.lockedAimX, y: spider.lockedAimY };
  let best = Infinity;
  for (const angle of probe.rotations) {
    const paintedForward = { x: -Math.sin(angle), y: Math.cos(angle) };
    best = Math.min(best, angleBetween(paintedForward, aim));
  }
  return best;
}

/** The attack frame the creature's sprite pose resolves to, or null if it cannot be read. */
function spriteClockOf(spider: GrotesqueSpider): number | null {
  const pose = readPrivate(spider, 'spritePose');
  if (typeof pose !== 'object' || pose === null) return null;
  const frame: unknown = Reflect.get(pose, 'attackFrame');
  return typeof frame === 'number' ? frame : null;
}

// ─────────────────────────────────────────────────────────────── gate 4: telegraphs

interface ArcStroke {
  readonly radius: number;
  readonly alpha: number;
}

/** Everything a render draws as an arc, and the opacity of every stroke along one. */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  arcs: number[];
  strokes: ArcStroke[];
  rotations: number[];
} {
  const PROBE_CANVAS_PX = 2048;
  const base = gameContext(PROBE_CANVAS_PX, PROBE_CANVAS_PX);
  const arcs: number[] = [];
  const strokes: ArcStroke[] = [];
  const rotations: number[] = [];
  let pathArcs: number[] = [];
  const ctx = new Proxy(base, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        if (property === 'beginPath') pathArcs = [];
        if (property === 'rotate' && typeof args[0] === 'number') rotations.push(args[0]);
        if (property === 'arc' && typeof args[2] === 'number') {
          arcs.push(args[2]);
          pathArcs.push(args[2]);
        }
        if (property === 'stroke') {
          for (const radius of pathArcs) strokes.push({ radius, alpha: target.globalAlpha });
        }
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
    set(target, property, value) {
      return Reflect.set(target, property, value);
    },
  });
  return { ctx, arcs, strokes, rotations };
}

const ARC_TOLERANCE_PX = 0.01;

function gateTelegraphs(): void {
  for (const attack of ['slam', 'screech'] as const) {
    const strike = strikeFrame(attack);
    const clock = (frame: number): number => (fault === 'telegraph-late' ? frame - 1 : frame);
    const onStrike = spiderTelegraphStateAt(attack, clock(strike));
    const before = spiderTelegraphStateAt(attack, clock(strike - 1));
    record(
      '4',
      `${attack}: the fill reaches the outline on the strike tick, not before`,
      onStrike !== null &&
        onStrike.fillProgress >= FULL_FILL &&
        before !== null &&
        before.fillProgress < FULL_FILL,
      `strike ${fmt(onStrike?.fillProgress ?? NaN, FINE_DIGITS)}, before ${fmt(before?.fillProgress ?? NaN, FINE_DIGITS)}`,
    );
    record(
      '4',
      `${attack}: the warning is at full strength on the strike tick`,
      onStrike !== null && onStrike.outlineAlpha >= FULL_OUTLINE_ALPHA && onStrike.locked,
      `alpha ${fmt(onStrike?.outlineAlpha ?? NaN, FINE_DIGITS)}, locked ${String(onStrike?.locked)}`,
    );

    const geometry = spiderTelegraphGeometry(attack);
    const hitRadius = attack === 'slam' ? SLAM_CONE_RADIUS_PX : SCREECH_RADIUS_PX;
    record(
      '4',
      `${attack}: drawn reach equals the hit test's`,
      geometry.radiusPx === hitRadius &&
        (attack === 'screech'
          ? geometry.halfAngleRad === null
          : geometry.halfAngleRad === SLAM_CONE_HALF_ANGLE_RAD),
      `${fmt(geometry.radiusPx, 2)} px${geometry.halfAngleRad === null ? '' : `, ±${fmt(radToDeg(geometry.halfAngleRad), 2)}°`}`,
    );
  }
  telegraphRenderProbe();
  hitGeometryProbe();
}

/**
 * Renders the real creature on a mid-tell tick and on its strike tick, through
 * a context that records every arc: the outline is drawn at the hit reach on
 * both, the fill is still short of it mid-tell, and the outline's opacity on
 * the strike tick is no weaker than it was while the attack was building.
 */
function telegraphRenderProbe(): void {
  for (const attack of ['slam', 'screech'] as const) {
    const reach = attack === 'slam' ? SLAM_CONE_RADIUS_PX : SCREECH_RADIUS_PX;
    const scenario = buildScenario(attack, 'mid-range');
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: LAB_CENTRE_TILE,
      humanTile: LAB_CENTRE_TILE,
      catTile: null,
      withQuest: false,
    });
    const { spider, human } = lab;
    if (fault === 'telegraph-late') {
      Object.defineProperty(spider, 'attackFrame', {
        get: (): number => numberField(spider, '_attackFrame') - 1,
      });
    }
    const anchor = { x: spider.x, y: spider.y };
    const decision = DECISION_DISTANCE_PX[attack];
    let frames = 0;
    while (spider.currentAttack === null && frames < SETUP_FRAME_CEILING) {
      teleportMob(lab, spider, anchor.x, anchor.y);
      placeCentre(human, {
        x: centreOf(spider).x + scenario.towardPlayer.x * decision,
        y: centreOf(spider).y + scenario.towardPlayer.y * decision,
      });
      step(lab);
      frames++;
    }
    const realFrame = (): number => numberField(spider, '_attackFrame');
    type Probe = ReturnType<typeof recordingContext>;
    // Both passes the game draws her telegraph in: the floor under the
    // entities, and the edge again above them where her body cannot cover it.
    // `overlay` records the second pass on its own as well.
    const overlays = new Map<number, Probe>();
    const renderAt = (target: number): Probe | null => {
      while (spider.currentAttack === attack && realFrame() < target) step(lab);
      if (spider.currentAttack !== attack || realFrame() !== target) return null;
      const probe = recordingContext();
      const overlay = recordingContext();
      try {
        spider.renderGroundTelegraphs(probe.ctx, 0, 0);
        spider.renderTelegraphOutlines(probe.ctx, 0, 0);
        spider.renderTelegraphOutlines(overlay.ctx, 0, 0);
      } catch (error) {
        notes.push(`gate 4 render probe (${attack}) threw: ${String(error)}`);
        return null;
      }
      overlays.set(target, overlay);
      return probe;
    };
    const midTell = renderAt(MID_TELL_SAMPLE_FRAME);
    const MID_LOCK_OFFSET = Math.floor(SPIDER_ATTACK_TIMELINES[attack].lockFrames / 2);
    const midLock = renderAt(SPIDER_ATTACK_TIMELINES[attack].tellFrames + MID_LOCK_OFFSET);
    const onStrike = renderAt(strikeFrame(attack));
    const atReach = (radius: number): boolean => Math.abs(radius - reach) <= ARC_TOLERANCE_PX;
    const growingFill =
      midTell?.arcs.some(
        (radius) => radius > ARC_TOLERANCE_PX && radius < reach - ARC_TOLERANCE_PX,
      ) ?? false;
    record(
      '4',
      `${attack} (rendered): outline at the hit reach while the fill is still growing mid-tell`,
      midTell !== null && midTell.arcs.some(atReach) && growingFill,
      midTell === null
        ? 'no render'
        : `arcs ${[...new Set(midTell.arcs.map((r) => fmt(r)))].join(',')}`,
    );
    const shortOnStrike =
      onStrike?.arcs.filter((radius) => radius > ARC_TOLERANCE_PX && !atReach(radius)) ?? [];
    record(
      '4',
      `${attack} (rendered): on the strike tick every arc is at the hit reach`,
      onStrike !== null && onStrike.arcs.some(atReach) && shortOnStrike.length === 0,
      onStrike === null
        ? 'no render'
        : `arcs ${[...new Set(onStrike.arcs.map((r) => fmt(r)))].join(',')}`,
    );
    const strongest = (probe: ReturnType<typeof recordingContext> | null): number =>
      Math.max(
        -1,
        ...(probe?.strokes
          .filter((stroke) => atReach(stroke.radius))
          .map((stroke) => stroke.alpha) ?? []),
      );
    const strikeAlpha = strongest(onStrike);
    const lockAlpha = strongest(midLock);
    record(
      '4',
      `${attack} (rendered): the outline is no fainter on the strike tick than mid-lock`,
      strikeAlpha > 0 && strikeAlpha >= lockAlpha - ARC_TOLERANCE_PX,
      `strike ${fmt(strikeAlpha, FINE_DIGITS)}, mid-lock ${fmt(lockAlpha, FINE_DIGITS)}`,
    );
    const overlayMidTell = overlays.get(MID_TELL_SAMPLE_FRAME) ?? null;
    const overlayStrike = overlays.get(strikeFrame(attack)) ?? null;
    const overlayShortOnStrike =
      overlayStrike?.arcs.filter((radius) => radius > ARC_TOLERANCE_PX && !atReach(radius)) ?? [];
    record(
      '4',
      `${attack} (rendered, above entities): the edge is stroked at the hit reach mid-tell and on the strike tick, and nothing short of it on the strike tick`,
      strongest(overlayMidTell) > 0 &&
        strongest(overlayStrike) > 0 &&
        overlayShortOnStrike.length === 0,
      `mid-tell ${fmt(strongest(overlayMidTell), FINE_DIGITS)}, strike ${fmt(strongest(overlayStrike), FINE_DIGITS)}`,
    );
  }
}

/**
 * Finds the hit test's edge by standing real crawlers just inside and just
 * outside the drawn outline and letting the real creature strike.
 */
function hitGeometryProbe(): void {
  interface Probe {
    readonly label: string;
    readonly attack: AreaAttack;
    /** Offset from her centre, in the frame where she aims along +Y. */
    readonly at: Vec;
    readonly shouldHit: boolean;
  }
  const slamEdge = SLAM_CONE_RADIUS_PX;
  const screechEdge = SCREECH_RADIUS_PX;
  const HALF_REACH = 0.5;
  const angleProbe = (inside: boolean): Vec => {
    const angle =
      SLAM_CONE_HALF_ANGLE_RAD + (inside ? -1 : 1) * (PROBE_EPSILON_PX / (slamEdge * HALF_REACH));
    return rotate({ x: 0, y: slamEdge * HALF_REACH }, angle);
  };
  const probes: readonly Probe[] = [
    {
      label: 'slam reach, just inside',
      attack: 'slam',
      at: { x: 0, y: slamEdge - PROBE_EPSILON_PX },
      shouldHit: true,
    },
    {
      label: 'slam reach, just outside',
      attack: 'slam',
      at: { x: 0, y: slamEdge + PROBE_EPSILON_PX },
      shouldHit: false,
    },
    { label: 'slam cone edge, just inside', attack: 'slam', at: angleProbe(true), shouldHit: true },
    {
      label: 'slam cone edge, just outside',
      attack: 'slam',
      at: angleProbe(false),
      shouldHit: false,
    },
    {
      label: 'screech reach, just inside',
      attack: 'screech',
      at: { x: 0, y: screechEdge - PROBE_EPSILON_PX },
      shouldHit: true,
    },
    {
      label: 'screech reach, just outside',
      attack: 'screech',
      at: { x: 0, y: screechEdge + PROBE_EPSILON_PX },
      shouldHit: false,
    },
  ];
  for (const probe of probes) {
    const labCentre = tileCentre(LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: LAB_CENTRE_TILE,
      humanTile: LAB_CENTRE_TILE,
      catTile: { x: LAB_CENTRE_TILE.x + 2, y: LAB_CENTRE_TILE.y },
      withQuest: false,
    });
    const { spider, human, cat } = lab;
    // The human is the target and fixes her aim straight south; the cat is the probe.
    const aimHolder = { x: labCentre.x, y: labCentre.y + DECISION_DISTANCE_PX[probe.attack] };
    const probeAt = { x: labCentre.x + probe.at.x, y: labCentre.y + probe.at.y };
    const anchor = { x: spider.x, y: spider.y };
    let frames = 0;
    const hold = (): void => {
      teleportMob(lab, spider, anchor.x, anchor.y);
      placeCentre(human, aimHolder);
      placeCentre(cat, probeAt);
    };
    while (spider.currentAttack === null && frames < SETUP_FRAME_CEILING) {
      hold();
      step(lab);
      frames++;
    }
    const started = spider.currentAttack === probe.attack;
    while (
      spider.currentAttack === probe.attack &&
      spider.attackFrame < strikeFrame(probe.attack)
    ) {
      hold();
      step(lab);
    }
    const catStruck = lab.hits.some((hit) => hit.victim === cat && hit.attackType === probe.attack);
    record(
      '4',
      `${probe.label} (${fmt(distance(labCentre, probeAt), 2)} px) is ${probe.shouldHit ? 'struck' : 'spared'}`,
      started && catStruck === probe.shouldHit,
      started ? (catStruck ? 'struck' : 'spared') : `she started ${String(spider.currentAttack)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── gate 5: spit lock

function gateSpitLock(): void {
  const labCentre = tileCentre(LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: LAB_CENTRE_TILE,
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  const ORBIT_RADIUS_TILES = 5;
  const orbitRadius = TILE_SIZE * ORBIT_RADIUS_TILES;
  placeCentre(human, { x: labCentre.x, y: labCentre.y + orbitRadius });
  const tangentialStep = (): Vec => {
    const offset = {
      x: centreOf(human).x - centreOf(spider).x,
      y: centreOf(human).y - centreOf(spider).y,
    };
    const tangent = unit({ x: -offset.y, y: offset.x });
    return { x: tangent.x * PLAYER_SPEED, y: tangent.y * PLAYER_SPEED };
  };
  let aimAtLock: Vec | null = null;
  let aimAtRelease: Vec | null = null;
  let released: Vec | null = null;
  const tell = SPIDER_ATTACK_TIMELINES.spit.tellFrames;
  const strike = strikeFrame('spit');
  let frames = 0;
  const SPIT_LOCK_FRAME_CEILING = 1200;
  const anchor = { x: spider.x, y: spider.y };
  while (released === null && frames < SPIT_LOCK_FRAME_CEILING) {
    // Held until she commits, so the orbit stays out of her area attacks' reach.
    if (spider.currentAttack === null) teleportMob(lab, spider, anchor.x, anchor.y);
    step(lab, new Map([[human, tangentialStep()]]));
    frames++;
    if (spider.currentAttack !== 'spit') continue;
    const toPlayer = unit({
      x: centreOf(human).x - centreOf(spider).x,
      y: centreOf(human).y - centreOf(spider).y,
    });
    if (spider.attackFrame === tell) aimAtLock = toPlayer;
    if (spider.attackFrame === strike) {
      aimAtRelease = toPlayer;
      const glob = spitGlob(spider);
      released = glob === null ? null : unit({ x: glob.vx, y: glob.vy });
    }
  }
  const lockError =
    released !== null && aimAtLock !== null ? angleBetween(released, aimAtLock) : Infinity;
  const trackingGap =
    aimAtLock !== null && aimAtRelease !== null ? angleBetween(aimAtLock, aimAtRelease) : 0;
  record(
    '5',
    'spit: the glob flies along the aim of the first lock tick',
    lockError <= ANGLE_TOLERANCE_RAD,
    `${fmt(radToDeg(lockError), ANGLE_DIGITS)}° off the lock-tick aim`,
  );
  record(
    '5',
    'spit: the target had moved off that aim by the release (not vacuous)',
    trackingGap >= MIN_TRACKING_DIVERGENCE_RAD,
    `${fmt(radToDeg(trackingGap), 2)}° between lock and release aims`,
  );
}

// ─────────────────────────────────────────────────────────────── gate 8: roots

interface RootRunStats {
  areaStrikes: number;
  rootedInReachAtStrike: number;
  areaLocks: number;
  rootedInReachAtLock: number;
  minFramesRootEndToLock: number;
  spitRoots: number;
  puddleCrossingsDuringTell: number;
  puddleRootsDuringTell: number;
  rootedNearHerFrames: number;
  chainSlams: number;
  /** Ticks of a slam or screech build that began with a crawler close enough to shove her. */
  buildTicksInContact: number;
  /** Build ticks on which she ended somewhere other than where she began. */
  buildTicksDisplaced: number;
  /** The longest run of ticks any crawler spent with its centre inside her body. */
  longestTicksInsideHer: number;
  /** How each violation came about, for whoever has to fix it. */
  violations: string[];
}

const ROOT_SEEDS = 6;
const ROOT_RUN_FRAMES = 18000;
/** Her HP is chipped to walk her through every phase; this is where the chipping stops. */
const ROOT_RUN_HP_FLOOR_FRACTION = 0.1;
const ROOT_RUN_CHIP_DAMAGE = 3;
const ROOT_RUN_CHIP_INTERVAL = 20;
/**
 * How close a careless crawler loiters: inside every attack's reach, at spit
 * range, and further out, re-picked every so often so the run sees all three.
 */
const LOITER_INSIDE_REACH_PX = 40;
const LOITER_SPIT_RANGE_PX = 120;
const LOITER_FAR_PX = 200;
const LOITER_DISTANCES_PX: readonly number[] = [
  LOITER_INSIDE_REACH_PX,
  LOITER_SPIT_RANGE_PX,
  LOITER_FAR_PX,
];
const LOITER_REPICK_FRAMES = 600;
/** How far a careless crawler will detour to run across a puddle when she starts an area attack. */
const PUDDLE_DETOUR_TILES = 5;
const PUDDLE_DETOUR_PX = TILE_SIZE * PUDDLE_DETOUR_TILES;

/**
 * A crawler who fights her carelessly: loiters inside her reach, walks into her
 * spit, and — the case the root rule exists for — flees every area attack
 * straight across the nearest puddle.
 */
function carelessMove(
  lab: Lab,
  player: Player,
  fleeFrom: Map<Player, Vec | null>,
  rng: () => number,
  loiterPx: number,
): Vec | null {
  const spider = lab.spider;
  const herCentre = centreOf(spider);
  const me = centreOf(player);
  const attack = spider.currentAttack;
  const building =
    (attack === 'slam' || attack === 'screech') && spider.attackFrame < strikeFrame(attack);
  if (building) {
    let waypoint = fleeFrom.get(player) ?? null;
    if (waypoint === null) {
      const puddle = firstOf(
        spider.spitPuddles
          .filter((p) => p.evaporateFramesLeft === null && distance(p, me) < PUDDLE_DETOUR_PX)
          .sort((a, b) => distance(a, me) - distance(b, me)),
      );
      waypoint = puddle === undefined ? null : { x: puddle.x, y: puddle.y };
      fleeFrom.set(player, waypoint);
    }
    if (waypoint !== null && distance(waypoint, me) > PLAYER_SPEED) {
      const toward = unit({ x: waypoint.x - me.x, y: waypoint.y - me.y });
      return { x: toward.x * PLAYER_SPEED, y: toward.y * PLAYER_SPEED };
    }
    const away = unit({ x: me.x - herCentre.x, y: me.y - herCentre.y });
    return { x: away.x * PLAYER_SPEED, y: away.y * PLAYER_SPEED };
  }
  fleeFrom.set(player, null);
  const CARELESS_PAUSE_CHANCE = 0.3;
  if (rng() < CARELESS_PAUSE_CHANCE) return null;
  // A spit is walked into rather than dodged: its root is what the rule is about.
  if (attack === 'spit') return null;
  if (Math.abs(distance(me, herCentre) - loiterPx) <= PLAYER_SPEED) return null;
  if (distance(me, herCentre) < loiterPx) {
    const away = unit({ x: me.x - herCentre.x, y: me.y - herCentre.y });
    return { x: away.x * PLAYER_SPEED, y: away.y * PLAYER_SPEED };
  }
  const toward = unit({ x: herCentre.x - me.x, y: herCentre.y - me.y });
  return { x: toward.x * PLAYER_SPEED, y: toward.y * PLAYER_SPEED };
}

/** A step that would bring a crawler this close to her body shoves her, so a crawler told not to shove refuses it. */
const SHOVE_DISTANCE_PX = TILE_SIZE + PLAYER_SPEED;

/** Drops a step that walks into her body, for a crawler who does not shove her. */
function withoutShoving(lab: Lab, player: Player, move: Vec | null): Vec | null {
  if (move === null) return null;
  const her = centreOf(lab.spider);
  const me = centreOf(player);
  const next = { x: me.x + move.x, y: me.y + move.y };
  const closing = distance(next, her) < distance(me, her);
  return closing && distance(next, her) < SHOVE_DISTANCE_PX ? null : move;
}

/**
 * Ticks a crawler's centre may spend inside half a tile of hers before it
 * counts as pinned in her body. A dash or a lunge can carry her over a crawler
 * for a few ticks while the push sorts them apart; a crawler she could hold
 * there, planted through a build, would stay for most of a tell.
 */
const STUCK_INSIDE_HER_TICKS = 30;

/** Where the careless crawlers start, in tiles from her. */
const ROOT_RUN_START_OFFSET_TILES = 4;

function runRootSeed(seed: number, stats: RootRunStats, shoves: boolean): void {
  const lab = buildLab({
    seed,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + ROOT_RUN_START_OFFSET_TILES },
    catTile: { x: LAB_CENTRE_TILE.x + ROOT_RUN_START_OFFSET_TILES, y: LAB_CENTRE_TILE.y },
    withQuest: false,
  });
  const { spider, human, cat } = lab;
  const players = [human, cat];
  const rng = mulberry32(seed);
  const fleeFrom = new Map<Player, Vec | null>();
  const rootEndedAt = new Map<Player, number>();
  const wasRooted = new Map<Player, boolean>();
  const loiter = new Map<Player, number>();
  const rootedHow = new Map<Player, string>();
  const insideStreak = new Map<Player, number>();
  let attackStartCentre: Vec = centreOf(spider);
  let attackStartDistances = new Map<Player, number>();
  let lastSpitStart = -Infinity;
  for (let frame = 0; frame < ROOT_RUN_FRAMES; frame++) {
    const chipFloor = spider.maxHp * ROOT_RUN_HP_FLOOR_FRACTION;
    if (frame % ROOT_RUN_CHIP_INTERVAL === 0 && spider.hp - ROOT_RUN_CHIP_DAMAGE > chipFloor) {
      spider.takeDamageFrom(ROOT_RUN_CHIP_DAMAGE, human, 'melee');
    }
    if (frame % LOITER_REPICK_FRAMES === 0) {
      for (const player of players) {
        loiter.set(
          player,
          LOITER_DISTANCES_PX[Math.floor(rng() * LOITER_DISTANCES_PX.length)] ?? 0,
        );
      }
    }
    const moves = new Map<Player, Vec | null>(
      players.map((p) => {
        const move = carelessMove(lab, p, fleeFrom, rng, loiter.get(p) ?? 0);
        return [p, shoves ? move : withoutShoving(lab, p, move)];
      }),
    );
    const herCentreBefore = centreOf(spider);
    const attackBefore = spider.currentAttack;
    const attackFrameBefore = spider.attackFrame;
    const contactBefore = players.some(
      (p) => p.isAlive && distance(centreOf(p), herCentreBefore) < SHOVE_DISTANCE_PX,
    );
    const puddlesBefore = spider.spitPuddles.filter(
      (p) => p.phase === 'idle' && p.evaporateFramesLeft === null,
    );
    const rootedBefore = new Map(players.map((p) => [p, p.hasStatus('stuck')]));
    step(lab, moves);
    for (const player of players) {
      player.hp = player.maxHp;
      const rooted = player.hasStatus('stuck');
      if ((wasRooted.get(player) ?? false) && !rooted) rootEndedAt.set(player, lab.frame);
      if (!(wasRooted.get(player) ?? false) && rooted) {
        rootedHow.set(
          player,
          `rooted on frame ${lab.frame} during ${String(spider.currentAttack)}@${spider.attackFrame} ` +
            `${fmt(distance(centreOf(player), centreOf(spider)))} px from her ` +
            `(glob ${spitGlob(spider) === null ? 'none' : 'in flight'} before: ${String(attackBefore)})`,
        );
      }
      wasRooted.set(player, rooted);
    }
    const attack = spider.currentAttack;
    const herCentre = centreOf(spider);
    const areaBefore = attackBefore === 'slam' || attackBefore === 'screech';
    const builtThroughTick =
      areaBefore &&
      attack === attackBefore &&
      spider.attackFrame === attackFrameBefore + 1 &&
      spider.attackFrame < strikeFrame(attackBefore);
    if (builtThroughTick && contactBefore) {
      stats.buildTicksInContact++;
      if (distance(herCentre, herCentreBefore) > 0) stats.buildTicksDisplaced++;
    }
    for (const player of players) {
      const inside = player.isAlive && distance(centreOf(player), herCentre) < HALF_TILE;
      const streak = inside ? (insideStreak.get(player) ?? 0) + 1 : 0;
      insideStreak.set(player, streak);
      stats.longestTicksInsideHer = Math.max(stats.longestTicksInsideHer, streak);
    }
    if (attack === 'spit' && spider.attackFrame === 0) lastSpitStart = lab.frame;
    if (attack !== null && spider.attackFrame === 0) {
      attackStartCentre = herCentre;
      attackStartDistances = new Map(players.map((p) => [p, distance(centreOf(p), herCentre)]));
    }
    if (
      attack === 'slam' &&
      spider.attackFrame === 0 &&
      lab.frame - lastSpitStart < totalFrames('spit') + ROOT_CHAIN_WINDOW_FRAMES
    ) {
      stats.chainSlams++;
    }

    const isArea = attack === 'slam' || attack === 'screech';
    const building = isArea && spider.attackFrame < strikeFrame(attack);
    for (const player of players) {
      const reach = attack === 'slam' ? SLAM_REACH_PX : SCREECH_REACH_PX;
      const inReach = distance(centreOf(player), herCentre) <= reach;
      const rootedNow = player.hasStatus('stuck');
      if (building && inReach) {
        const onPuddle = puddlesBefore.some(
          (p) => distance(p, centreOf(player)) < PUDDLE_GRAB_RADIUS_PX,
        );
        if (onPuddle) stats.puddleCrossingsDuringTell++;
        if (onPuddle && rootedNow && !(rootedBefore.get(player) ?? false))
          stats.puddleRootsDuringTell++;
      }
      if (!isArea && rootedNow && distance(centreOf(player), herCentreBefore) <= SCREECH_REACH_PX) {
        stats.rootedNearHerFrames++;
      }
      if (!(rootedBefore.get(player) ?? false) && rootedNow && attackBefore === 'spit')
        stats.spitRoots++;
      if (isArea && spider.attackFrame === SPIDER_ATTACK_TIMELINES[attack].tellFrames) {
        if (player === human) stats.areaLocks++;
        if (inReach) {
          if (spiderRootFramesRemaining(player) > 0 || rootedNow) {
            stats.rootedInReachAtLock++;
            stats.violations.push(
              `seed ${seed} frame ${lab.frame}: ${attack} lock began with ${player === human ? 'human' : 'cat'} ` +
                `${fmt(distance(centreOf(player), herCentre))} px away, ${spiderRootFramesRemaining(player)} root frames left; ` +
                (rootedHow.get(player) ?? 'root origin unknown') +
                `; she moved ${fmt(distance(herCentre, attackStartCentre))} px since the attack began, ` +
                `when this crawler was ${fmt(attackStartDistances.get(player) ?? NaN)} px away`,
            );
          }
          const ended = rootEndedAt.get(player);
          if (ended !== undefined) {
            stats.minFramesRootEndToLock = Math.min(
              stats.minFramesRootEndToLock,
              lab.frame - ended,
            );
          }
        }
      }
      if (isArea && spider.attackFrame === strikeFrame(attack)) {
        if (player === human) stats.areaStrikes++;
        // Her strike resolves in her AI, before this tick's shoves: measured
        // from where she stood then, not from where a push left her after.
        const struckFrom = herCentreBefore;
        const inReachOfStrike = distance(centreOf(player), struckFrom) <= reach;
        if (inReachOfStrike && rootedNow) {
          stats.rootedInReachAtStrike++;
          stats.violations.push(
            `seed ${seed} frame ${lab.frame}: ${attack} struck ${player === human ? 'human' : 'cat'} rooted ` +
              `${fmt(distance(centreOf(player), struckFrom))} px away; ${rootedHow.get(player) ?? 'root origin unknown'}`,
          );
        }
      }
    }
  }
}

/** A slam that starts within this many frames of a spit ending counts as that spit's chain. */
const ROOT_CHAIN_WINDOW_FRAMES = 150;

function gateRoots(): void {
  const variants = [
    { shoves: false, label: 'crawlers who never shove her' },
    { shoves: true, label: 'crawlers who shove her mid-tell' },
  ] as const;
  for (const variant of variants) {
    const stats: RootRunStats = {
      areaStrikes: 0,
      rootedInReachAtStrike: 0,
      areaLocks: 0,
      rootedInReachAtLock: 0,
      minFramesRootEndToLock: Infinity,
      spitRoots: 0,
      puddleCrossingsDuringTell: 0,
      puddleRootsDuringTell: 0,
      rootedNearHerFrames: 0,
      chainSlams: 0,
      buildTicksInContact: 0,
      buildTicksDisplaced: 0,
      longestTicksInsideHer: 0,
      violations: [],
    };
    for (let seed = 0; seed < ROOT_SEEDS; seed++)
      runRootSeed(RUN_SEED + seed, stats, variant.shoves);
    const MAX_VIOLATIONS_SHOWN = 3;
    for (const violation of stats.violations.slice(0, MAX_VIOLATIONS_SHOWN)) {
      notes.push(`gate 8 (${variant.label}): ${violation}`);
    }
    record(
      '8',
      `${variant.label}: no slam or screech strikes a rooted crawler in reach`,
      stats.areaStrikes > 0 && stats.rootedInReachAtStrike === 0,
      `${stats.rootedInReachAtStrike} of ${stats.areaStrikes} strikes`,
    );
    record(
      '8',
      `${variant.label}: every lock begins with each crawler in reach unrooted`,
      stats.areaLocks > 0 && stats.rootedInReachAtLock === 0,
      `${stats.rootedInReachAtLock} rooted at ${stats.areaLocks} locks; min root-end→lock ${fmt(stats.minFramesRootEndToLock, 0)} frames`,
    );
    record(
      '8',
      `${variant.label}: fleeing across a puddle during a tell never roots`,
      stats.puddleCrossingsDuringTell > 0 && stats.puddleRootsDuringTell === 0,
      `${stats.puddleRootsDuringTell} roots over ${stats.puddleCrossingsDuringTell} puddle-crossing frames`,
    );
    record(
      '8',
      `${variant.label}: the run exercised the rule`,
      stats.spitRoots > 0 && stats.rootedNearHerFrames > 0,
      `${stats.spitRoots} spit roots, ${stats.rootedNearHerFrames} rooted frames in reach, ${stats.chainSlams} slams after a spit`,
    );
    if (variant.shoves) {
      record(
        '8',
        `${variant.label}: she stands planted through every slam and screech build`,
        stats.buildTicksInContact > 0 && stats.buildTicksDisplaced === 0,
        `${stats.buildTicksDisplaced} of ${stats.buildTicksInContact} build ticks in contact moved her`,
      );
    }
    record(
      '8',
      `${variant.label}: no crawler is ever held inside her body`,
      stats.longestTicksInsideHer < STUCK_INSIDE_HER_TICKS,
      `longest ${stats.longestTicksInsideHer} ticks with a crawler's centre inside half a tile of hers (stuck at ${STUCK_INSIDE_HER_TICKS})`,
    );
  }
  spitTellPuddleProbe();
  for (const nook of NOOKS) {
    const mouth = nookMouthTile(nook);
    const atMouthEnd = { x: mouth.x, y: mouth.y - 1 };
    nookHideRun(nook, atMouthEnd, `a crawler up a dead end ${nook.depthTiles} deep, at her face`);
    const deep = nookDeepTile(nook);
    if (deep.y !== atMouthEnd.y) {
      nookHideRun(nook, deep, `a crawler up a dead end ${nook.depthTiles} deep, at its far end`);
    }
  }
  repositionSightProbe();
  diagonalRepositionProbe();
  retargetSpitProbe();
}

/** How long a crawler hides in the nook while she hunts it. */
const NOOK_HIDE_FRAMES = 6000;

/**
 * Signed clearance of a crawler's centre from her locked attack as it stands:
 * the screech disk and slam cone on her centre, the spit's line from her
 * centre along the locked aim. Negative is inside.
 */
function lockedShapeClearance(spider: GrotesqueSpider, attack: DamagingAttack, p: Vec): number {
  const origin = centreOf(spider);
  const aim = { x: spider.lockedAimX, y: spider.lockedAimY };
  switch (attack) {
    case 'screech':
      return distance(p, origin) - SCREECH_RADIUS_PX;
    case 'slam':
      return coneClearance(
        {
          originX: origin.x,
          originY: origin.y,
          dirX: aim.x,
          dirY: aim.y,
          radiusPx: SLAM_CONE_RADIUS_PX,
          halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
        },
        p,
      );
    case 'spit': {
      const offset = { x: p.x - origin.x, y: p.y - origin.y };
      const along = Math.max(0, offset.x * aim.x + offset.y * aim.y);
      const fromLine = Math.hypot(offset.x - aim.x * along, offset.y - aim.y * along);
      return fromLine - SPIT_HIT_RADIUS_PX;
    }
  }
}

/**
 * Whether a crawler caught by an attack on its first lock tick can walk clear
 * of it before the strike, in some keyboard direction, held inside the lab and
 * stopped by her body as the push between bodies stops it. The harness's own
 * answer to the question her escape rule asks, from the shape she locked.
 */
function lockCanBeWalkedOutOf(lab: Lab, attack: DamagingAttack, victim: Player): boolean {
  const her = centreOf(lab.spider);
  if (lockedShapeClearance(lab.spider, attack, centreOf(victim)) > 0) return true;
  const lockFrames = SPIDER_ATTACK_TIMELINES[attack].lockFrames;
  for (let direction = 0; direction < ESCAPE_DIRECTIONS; direction++) {
    const walk = escapeDirection(direction);
    const body = { x: victim.x, y: victim.y };
    for (let frame = 0; frame < lockFrames; frame++) {
      const gapBefore = distance(centreOf(body), her);
      pushPlayerWithCollision(body, walk.x, walk.y, lab.map);
      clampToLab(body);
      const gapAfter = distance(centreOf(body), her);
      if (gapAfter < SEPARATION_RADIUS && gapAfter < gapBefore) break;
      if (lockedShapeClearance(lab.spider, attack, centreOf(body)) > 0) return true;
    }
  }
  return false;
}

/** The attacks that deal her damage, as a hit record names them. */
const HER_BLOWS: ReadonlySet<string> = new Set<string>(DAMAGING);
/** How many of a hider run's locks are replayed once per keyboard direction. */
const REPLAYED_LOCKS_PER_RUN = 8;

interface HiderOverride {
  /** Which lock of the run the crawler stops hiding at and walks instead. */
  readonly lockIndex: number;
  readonly walk: Vec;
}

interface HiderRun {
  locks: number;
  strikes: number;
  harnessUnfairLocks: number;
  blows: number;
  started: Record<SpiderAttack, number>;
  /** Stalemate repositions she committed to, and how many of those walks timed out. */
  repositions: number;
  repositionTimeouts: number;
  /** Whether the overridden lock's attack landed on the crawler, or null when no override ran. */
  overrideHit: boolean | null;
}

/**
 * A crawler hiding at `homeTile` in a one-wide dead end while she hunts it.
 * It heads home when it can and, once an attack locks, backs up the dead end
 * as far as it goes. With an override, from the chosen lock on it walks one
 * fixed keyboard direction instead, and the run ends when that attack (and
 * any glob of it) is over, reporting whether it landed.
 */
function runHider(nook: Nook, homeTile: Vec, override: HiderOverride | null): HiderRun {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: nookMouthTile(nook),
    humanTile: homeTile,
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  const home = tileCentre(homeTile.x, homeTile.y);
  const run: HiderRun = {
    locks: 0,
    strikes: 0,
    harnessUnfairLocks: 0,
    blows: 0,
    started: { slam: 0, screech: 0, spit: 0, lay: 0 },
    repositions: 0,
    repositionTimeouts: 0,
    overrideHit: null,
  };
  let spotBefore: unknown = null;
  let unreachedBefore: unknown = null;
  const blowsSoFar = (): number =>
    lab.hits.filter(
      (hit) =>
        hit.victim === human && hit.attackType !== undefined && HER_BLOWS.has(hit.attackType),
    ).length;
  let walking = false;
  let walkedAttack: SpiderAttack | null = null;
  let blowsBeforeWalk = 0;
  for (let frame = 0; frame < NOOK_HIDE_FRAMES; frame++) {
    const attack = spider.currentAttack;
    const locked =
      attack !== null &&
      attack !== 'lay' &&
      spider.attackFrame >= SPIDER_ATTACK_TIMELINES[attack].tellFrames;
    const toHome = { x: home.x - centreOf(human).x, y: home.y - centreOf(human).y };
    const homeward = unit(toHome);
    let move: Vec | null = null;
    if (walking && override !== null) move = override.walk;
    else if (locked) move = { x: 0, y: -PLAYER_SPEED };
    else if (Math.hypot(toHome.x, toHome.y) > PLAYER_SPEED) {
      move = { x: homeward.x * PLAYER_SPEED, y: homeward.y * PLAYER_SPEED };
    }
    step(lab, new Map<Player, Vec | null>([[human, move]]));
    human.hp = human.maxHp;
    const spotNow = readPrivate(spider, 'repositionSpot');
    if (spotNow !== null && spotNow !== spotBefore) run.repositions++;
    spotBefore = spotNow;
    const unreachedNow = readPrivate(spider, 'unreachedRepositionSpot');
    if (unreachedNow !== null && unreachedNow !== unreachedBefore) run.repositionTimeouts++;
    unreachedBefore = unreachedNow;
    if (walking) {
      const over = attackOf(spider) !== walkedAttack && spitGlob(spider) === null;
      if (over) {
        run.overrideHit = blowsSoFar() > blowsBeforeWalk;
        return run;
      }
    }
    const now = spider.currentAttack;
    if (now === null || now === 'lay') continue;
    if (spider.attackFrame === 0) run.started[now]++;
    if (spider.attackFrame === SPIDER_ATTACK_TIMELINES[now].tellFrames) {
      if (!lockCanBeWalkedOutOf(lab, now, human)) run.harnessUnfairLocks++;
      if (override !== null && run.locks === override.lockIndex) {
        walking = true;
        walkedAttack = now;
        blowsBeforeWalk = blowsSoFar();
      }
      run.locks++;
    }
    if (spider.attackFrame === strikeFrame(now)) run.strikes++;
  }
  run.blows = blowsSoFar();
  return run;
}

/**
 * The hiders' promises, measured two independent ways. The harness's own
 * escape formula judges each lock from the shape she locked; and each of the
 * first locks is replayed through the real simulation once per keyboard
 * direction, walking that way from the lock on, which must leave at least one
 * direction the blow misses. A mistake shared by her probe and the harness's
 * formula cannot hide from the replay. She must also still land attacks: a
 * dead end she cannot fairly strike into from its mouth is where she has to
 * back off to open floor to find one.
 */
function nookHideRun(nook: Nook, homeTile: Vec, label: string): void {
  const base = runHider(nook, homeTile, null);
  const replayed = Math.min(base.locks, REPLAYED_LOCKS_PER_RUN);
  const undodged: number[] = [];
  for (let lockIndex = 0; lockIndex < replayed; lockIndex++) {
    let dodged = false;
    for (let direction = 0; direction < ESCAPE_DIRECTIONS && !dodged; direction++) {
      const replay = runHider(nook, homeTile, { lockIndex, walk: escapeDirection(direction) });
      dodged = replay.overrideHit === false;
    }
    if (!dodged) undodged.push(lockIndex);
  }
  record(
    '8',
    `${label}: every lock she begins could be walked out of`,
    base.harnessUnfairLocks === 0,
    `${base.harnessUnfairLocks} of ${base.locks} locks inescapable; ${base.blows} blows taken hiding`,
  );
  record(
    '8',
    `${label}: replayed, some keyboard direction dodges each lock`,
    replayed > 0 && undodged.length === 0,
    `${replayed - undodged.length} of ${replayed} replayed locks dodged${
      undodged.length > 0 ? `; undodged locks ${undodged.join(', ')}` : ''
    }`,
  );
  record(
    '8',
    `${label}: she still lands attacks`,
    base.strikes > 0,
    `${base.strikes} strikes in ${NOOK_HIDE_FRAMES} frames; attacks started ${JSON.stringify(base.started)}`,
  );
  record(
    '8',
    `${label}: every stalemate reposition arrives`,
    base.repositionTimeouts === 0,
    `${base.repositions} repositions, ${base.repositionTimeouts} timed out`,
  );
}

/** Diagonal offsets, in tiles, of the spots the diagonal reposition probe sends her to. */
const DIAGONAL_REPOSITION_OFFSETS: readonly Vec[] = [
  { x: 3, y: 3 },
  { x: -3, y: 3 },
  { x: 3, y: -3 },
  { x: -3, y: -3 },
  { x: 2, y: 1 },
  { x: -1, y: 2 },
];
/** Tiles south of her the crawler stands, in sight and out of every reach. */
const DIAGONAL_PROBE_CRAWLER_OFFSET_TILES = 8;
/** Gap frames she is given so no attack interrupts the walk being measured. */
const DIAGONAL_PROBE_GAP_FRAMES = 10000;

/**
 * She is committed to spots diagonal from her and walks there. Every walk
 * must end by arriving, well inside the timeout, never by standing a hair
 * outside the arrival slack until the walk gives up and writes her own spot
 * off as unreachable.
 */
function diagonalRepositionProbe(): void {
  const timeout = REPOSITION_TIMEOUT_FRAMES;
  const outcomes: string[] = [];
  let allArrived = true;
  for (const offset of DIAGONAL_REPOSITION_OFFSETS) {
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: LAB_CENTRE_TILE,
      humanTile: {
        x: LAB_CENTRE_TILE.x,
        y: LAB_CENTRE_TILE.y + DIAGONAL_PROBE_CRAWLER_OFFSET_TILES,
      },
      catTile: null,
      withQuest: false,
    });
    const { spider } = lab;
    const spot = {
      x: (LAB_CENTRE_TILE.x + offset.x) * TILE_SIZE,
      y: (LAB_CENTRE_TILE.y + offset.y) * TILE_SIZE,
    };
    Reflect.set(spider, 'gapTimer', DIAGONAL_PROBE_GAP_FRAMES);
    Reflect.set(spider, 'mode', 'pursuing');
    Reflect.set(spider, 'repositionSpot', spot);
    Reflect.set(spider, 'repositionFramesLeft', timeout);
    let frames = 0;
    while (readPrivate(spider, 'repositionSpot') !== null && frames <= timeout) {
      step(lab);
      frames++;
    }
    const miss = Math.hypot(spider.x - spot.x, spider.y - spot.y);
    const unreached = readPrivate(spider, 'unreachedRepositionSpot');
    const arrived = unreached === null && miss <= REPOSITION_ARRIVAL_PX && frames < timeout;
    if (!arrived) allArrived = false;
    outcomes.push(`${offset.x},${offset.y}: ${frames}f ${fmt(miss, FINE_DIGITS)} px`);
  }
  record(
    '8',
    'every diagonal reposition ends by arriving, not by timing out',
    allArrived,
    outcomes.join('; '),
  );
}

/** Tiles west of the deep nook's block she stands on for the sight probe: beside it, blind to its far end. */
const SIGHT_PROBE_WEST_OF_BLOCK_TILES = 2;

/**
 * She stands just west of the deep nook's block, the crawler at the nook's
 * far end. The nearest spots she could back off to lie beside the block, on
 * the far side of its wall from the crawler; one of those would lose her the
 * crawler on arrival and start the stalemate over. The spot she picks must
 * see the crawler.
 */
function repositionSightProbe(): void {
  const deep = nookDeepTile(DEEP_NOOK);
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: { x: DEEP_NOOK.block.x - SIGHT_PROBE_WEST_OF_BLOCK_TILES, y: deep.y },
    humanTile: deep,
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  const spot = callPrivate(spider, 'tryBeginReposition', [human, [human, lab.cat]]);
  const chosen =
    spot !== null && typeof spot === 'object'
      ? { x: numberField(spot, 'x'), y: numberField(spot, 'y') }
      : null;
  const sees =
    chosen !== null &&
    lab.map.hasLineOfSight(
      chosen.x + HALF_TILE,
      chosen.y + HALF_TILE,
      centreOf(human).x,
      centreOf(human).y,
    );
  record(
    '8',
    'the spot she backs off a stalemate to can see the crawler',
    sees,
    chosen === null
      ? 'no spot chosen'
      : `tile ${chosen.x / TILE_SIZE},${chosen.y / TILE_SIZE}: ${sees ? 'in sight' : 'out of sight'}`,
  );
}

/** Where the retarget probe starts: her west of the pillar, the human south-east of her, the cat west. */
const RETARGET_SPIDER_TILE = { x: 29, y: 5 } as const;
const RETARGET_HUMAN_TILE = { x: 33, y: 10 } as const;
const RETARGET_CAT_TILE = { x: 25, y: 5 } as const;
/** Behind the pillar from her, out of her sight. */
const RETARGET_HIDE_TILE = { x: PILLAR.x + PILLAR.w + 1, y: 5 } as const;
/** The index of the spit step in the first phase's cycle. */
const FIRST_PHASE_SPIT_STEP = 1;
/** Attack frames into the spit's tell the human starts for cover, and the cat is rooted. */
const RETARGET_HIDE_FROM_FRAME = 5;
const RETARGET_ROOT_ON_FRAME = 10;
/** Long enough for the cat to stay rooted through the whole spit. */
const RETARGET_ROOT_FRAMES = 200;
const RETARGET_PROBE_FRAMES = 300;

/**
 * A spit started on the human, who then ducks behind the pillar mid-tell,
 * while the cat in plain sight is rooted. Only the human was ever judged fair
 * to spit at; a rooted cat cannot sidestep. The aim must hold where the human
 * was last seen rather than swing onto the cat, and the glob must not land on
 * the cat.
 */
function retargetSpitProbe(): void {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: RETARGET_SPIDER_TILE,
    humanTile: RETARGET_HUMAN_TILE,
    catTile: RETARGET_CAT_TILE,
    withQuest: false,
  });
  const { spider, human, cat } = lab;
  Reflect.set(spider, 'gapTimer', 0);
  Reflect.set(spider, 'cycleIndex', FIRST_PHASE_SPIT_STEP);
  const hideAt = tileCentre(RETARGET_HIDE_TILE.x, RETARGET_HIDE_TILE.y);
  let spitOnHuman = false;
  let spitStarted = false;
  let catRooted = false;
  for (let frame = 0; frame < RETARGET_PROBE_FRAMES; frame++) {
    const spitting = spider.currentAttack === 'spit';
    let humanMove: Vec | null = null;
    if (spitting && spider.attackFrame >= RETARGET_HIDE_FROM_FRAME) {
      const toCover = { x: hideAt.x - centreOf(human).x, y: hideAt.y - centreOf(human).y };
      if (Math.hypot(toCover.x, toCover.y) > PLAYER_SPEED) {
        const heading = unit(toCover);
        humanMove = { x: heading.x * PLAYER_SPEED, y: heading.y * PLAYER_SPEED };
      }
    }
    if (spitting && spider.attackFrame === RETARGET_ROOT_ON_FRAME && !cat.hasStatus('stuck')) {
      cat.applyStatus(makeStuck(RETARGET_ROOT_FRAMES));
      catRooted = true;
    }
    step(lab, new Map<Player, Vec | null>([[human, humanMove]]));
    human.hp = human.maxHp;
    cat.hp = cat.maxHp;
    if (attackOf(spider) === 'spit' && spider.attackFrame === 0 && !spitStarted) {
      spitStarted = true;
      spitOnHuman = readPrivate(spider, 'spitTarget') === human;
    }
  }
  const spitsOnCat = lab.hits.filter((hit) => hit.victim === cat && hit.attackType === 'spit');
  record(
    '8',
    'a spit started on a crawler who ducks out of sight never lands on a rooted one',
    spitStarted && spitOnHuman && catRooted && spitsOnCat.length === 0,
    `spit ${spitStarted ? (spitOnHuman ? 'started on the human' : 'started on the cat') : 'never started'}; ` +
      `cat ${catRooted ? 'rooted' : 'never rooted'}; ${spitsOnCat.length} spit hits on the cat`,
  );
}

/**
 * Attack frames at which the crawler a spit is aimed at steps onto a live
 * puddle: the first tell tick after the start, mid-tell, the first lock tick
 * and mid-lock.
 */
function spitPuddleStepFrames(): number[] {
  const { tellFrames, lockFrames } = SPIDER_ATTACK_TIMELINES.spit;
  const HALF = 0.5;
  return [1, Math.floor(tellFrames * HALF), tellFrames, tellFrames + Math.floor(lockFrames * HALF)];
}
/** Ticks the control stands on the puddle after the spit is over, to show it still roots. */
const PUDDLE_CONTROL_TICKS = 3;
/** Her current attack, read fresh rather than through a narrowed field access. */
const attackOf = (spider: GrotesqueSpider): SpiderAttack | null => spider.currentAttack;
/** Ticks the probe waits for her glob to land before calling the run stuck. */
const SPIT_PROBE_CEILING = 400;

/**
 * A spit only starts on a crawler who is free to move, and is dodged by
 * walking off the locked line. The crawler it is aimed at steps onto a live
 * puddle at several points in the tell and lock, stays there until the lock,
 * then walks across the line. The puddle must not root them while the spit is
 * pending, and the glob must miss. Afterwards the same crawler stands on the
 * same puddle with nothing pending and must be rooted, so the puddle was live
 * and the pass is not the puddle simply failing to catch anyone.
 */
function spitTellPuddleProbe(): void {
  const decision = DECISION_DISTANCE_PX.spit;
  const labCentre = tileCentre(LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
  const standCentre = { x: labCentre.x, y: labCentre.y + decision };
  const puddleOffsetTiles = 1;
  const { tellFrames } = SPIDER_ATTACK_TIMELINES.spit;
  for (const stepFrame of spitPuddleStepFrames()) {
    const lab = buildLab({
      seed: RUN_SEED + stepFrame,
      spiderTile: LAB_CENTRE_TILE,
      humanTile: LAB_CENTRE_TILE,
      catTile: null,
      withQuest: false,
    });
    const { spider, human } = lab;
    const anchor = { x: spider.x, y: spider.y };
    callPrivate(spider, 'spawnGroundTrap', [
      standCentre.x + TILE_SIZE * puddleOffsetTiles,
      standCentre.y,
    ]);
    const puddle = firstOf(spider.spitPuddles);
    if (puddle === undefined) throw new Error('lookup failed: the probe puddle did not land');

    let setupFrames = 0;
    while (spider.currentAttack === null && setupFrames < SETUP_FRAME_CEILING) {
      teleportMob(lab, spider, anchor.x, anchor.y);
      placeCentre(human, standCentre);
      step(lab);
      setupFrames++;
    }
    const label = `spit probe, onto a puddle on attack frame ${stepFrame}`;
    if (spider.currentAttack !== 'spit' || puddle.phase !== 'idle') {
      record(
        '8',
        `${label}: the spit starts beside a live puddle`,
        false,
        `started ${String(spider.currentAttack)}, puddle ${puddle.phase}`,
      );
      continue;
    }

    const walkAcross = new Map<Player, Vec | null>([[human, { x: PLAYER_SPEED, y: 0 }]]);
    let rootedWhilePending = false;
    let spitHit = false;
    let ticks = 0;
    const hitsBefore = lab.hits.length;
    const pending = (): boolean => spider.currentAttack === 'spit' || spitGlob(spider) !== null;
    while (pending() && ticks < SPIT_PROBE_CEILING) {
      // Read through a call: the setup's check above narrowed the field to
      // 'spit', but each step can end the attack.
      const frame = attackOf(spider) === 'spit' ? spider.attackFrame : Infinity;
      const onPuddleNow = frame >= stepFrame && frame < Math.max(stepFrame + 1, tellFrames);
      if (frame < tellFrames) teleportMob(lab, spider, anchor.x, anchor.y);
      if (frame < stepFrame) placeCentre(human, standCentre);
      else if (onPuddleNow) placeCentre(human, puddle);
      const walking = !onPuddleNow && frame >= stepFrame;
      step(lab, walking ? walkAcross : NO_MOVES);
      if (pending() && human.hasStatus('stuck')) rootedWhilePending = true;
      ticks++;
    }
    spitHit = lab.hits.slice(hitsBefore).some((hit) => hit.attackType === 'spit');
    record(
      '8',
      `${label}: not rooted while the spit is pending, and the glob misses`,
      !pending() && !rootedWhilePending && !spitHit,
      `${rootedWhilePending ? 'rooted' : 'free'}, ${spitHit ? 'hit' : 'missed'}${pending() ? ', still pending' : ''}`,
    );

    human.statusEffects.length = 0;
    let rootedAfter = false;
    for (let tick = 0; tick < PUDDLE_CONTROL_TICKS && !rootedAfter; tick++) {
      teleportMob(lab, spider, anchor.x, anchor.y);
      placeCentre(human, puddle);
      step(lab);
      rootedAfter = human.hasStatus('stuck');
    }
    record(
      '8',
      `${label}: the same puddle roots them once nothing is pending`,
      rootedAfter,
      rootedAfter ? 'rooted' : 'not rooted',
    );
  }
}

// ─────────────────────────────────────────────────────────────── gates 9, 10: eggs

function questOf(lab: Lab): SpiderQuestSystem {
  if (lab.quest === null) throw new Error('lookup failed: the lab was built without its quest');
  return lab.quest;
}

function isBrood(mob: Mob): mob is SpiderEgg | SpiderHatchling {
  return mob instanceof SpiderEgg || mob instanceof SpiderHatchling;
}

function eggsOf(lab: Lab): SpiderEgg[] {
  return lab.roster.mobs.filter((mob): mob is SpiderEgg => mob instanceof SpiderEgg && mob.isAlive);
}

function hatchlingsOf(lab: Lab): SpiderHatchling[] {
  return lab.roster.mobs.filter(
    (mob): mob is SpiderHatchling => mob instanceof SpiderHatchling && mob.isAlive,
  );
}

function broodInGrid(lab: Lab): number {
  const everywhere = Math.hypot(lab.map.structure.length, lab.map.structure[0].length) * TILE_SIZE;
  let count = 0;
  // A body still playing out its death is scenery; a live one, or one whose
  // corpse has expired and was never swept out, is a leak.
  for (const mob of lab.roster.grid.queryCircle(0, 0, everywhere)) {
    if (isBrood(mob) && (mob.isAlive || mob.corpseExpired)) count++;
  }
  return count;
}

function applyEggFaults(lab: Lab): void {
  if (fault === 'egg-clock' || fault === 'egg-tough' || fault === 'egg-heavy') {
    const EGG_CLOCK_FAULT_PERIOD = 10;
    for (const egg of eggsOf(lab)) {
      if (Reflect.has(egg, '__faulted')) continue;
      Reflect.set(egg, '__faulted', true);
      if (fault === 'egg-clock') {
        wrapMethod(egg, 'tickTimers', (original, args) => {
          original(...args);
          if (lab.frame % EGG_CLOCK_FAULT_PERIOD === 0) original(...args);
          return undefined;
        });
      }
      if (fault === 'egg-tough') wrapMethod(egg, 'takeDamageFrom', () => undefined);
      if (fault === 'egg-heavy') {
        const HEAVY_EGG_MASS = 1000;
        egg.mass = HEAVY_EGG_MASS;
        Object.defineProperty(egg, 'displacesPlayers', { get: () => true });
      }
    }
  }
  if (fault === 'hatchling-senses') {
    for (const hatchling of hatchlingsOf(lab)) {
      if (Reflect.has(hatchling, '__faulted')) continue;
      Reflect.set(hatchling, '__faulted', true);
      wrapMethod(hatchling, 'acquireTarget', (_original, args) =>
        callPrivate(hatchling, '_findTarget', args),
      );
    }
  }
}

/** Her HP share at the start of a brood run: inside her second phase, or her third. */
const PHASE_TWO_START_FRACTION = 0.5;
const PHASE_THREE_START_FRACTION = 0.3;

/** Where the crawlers start a brood run, in tiles south of her: outside every reach. */
const BROOD_RUN_START_OFFSET_TILES = 8;
/** How far the crawlers keep from her in a brood run, in tiles. */
const STAND_OFF_TILES = 6;

/** A fight lab with her already in a laying HP phase. */
function broodLab(seed: number, hpFraction = PHASE_TWO_START_FRACTION): Lab {
  const lab = buildLab({
    seed,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + BROOD_RUN_START_OFFSET_TILES },
    catTile: { x: LAB_CENTRE_TILE.x + 1, y: LAB_CENTRE_TILE.y + BROOD_RUN_START_OFFSET_TILES },
    withQuest: true,
  });
  lab.spider.hp = Math.floor(lab.spider.maxHp * hpFraction);
  return lab;
}

/** Keeps both crawlers alive and well out of her reach, so the brood is all that happens. */
function standOff(lab: Lab): Moves {
  const moves = new Map<Player, Vec | null>();
  for (const player of [lab.human, lab.cat]) {
    player.hp = player.maxHp;
    player.statusEffects = player.statusEffects.filter((effect) => effect.type !== 'stuck');
    const away = unit({
      x: centreOf(player).x - centreOf(lab.spider).x,
      y: centreOf(player).y - centreOf(lab.spider).y,
    });
    const STAND_OFF_PX = TILE_SIZE * STAND_OFF_TILES;
    moves.set(
      player,
      distance(centreOf(player), centreOf(lab.spider)) < STAND_OFF_PX
        ? { x: away.x * PLAYER_SPEED, y: away.y * PLAYER_SPEED }
        : null,
    );
  }
  return moves;
}

const BROOD_WAIT_CEILING = 4000;

/** Frames the egg placement probe watches her lay for. */
const EGG_PLACEMENT_FRAMES = 6000;

/**
 * Every egg she lays lands past where her body is drawn, so none starts half
 * hidden under her abdomen: measured from her centre to the egg's, on the tick
 * it lands, against the nearest the placement band allows.
 */
function eggsLandClearOfHer(): void {
  const lab = broodLab(RUN_SEED);
  const seen = new Set<SpiderEgg>();
  let nearestPx = Infinity;
  for (let frame = 0; frame < EGG_PLACEMENT_FRAMES; frame++) {
    step(lab, standOff(lab));
    for (const egg of eggsOf(lab)) {
      if (seen.has(egg)) continue;
      seen.add(egg);
      nearestPx = Math.min(nearestPx, distance(centreOf(egg), centreOf(lab.spider)));
    }
  }
  const floorPx = EGG_MIN_DISTANCE_TILES * TILE_SIZE;
  record(
    '9',
    `every egg lands at least ${EGG_MIN_DISTANCE_TILES} tiles from her centre, clear of her body`,
    seen.size > 0 && nearestPx >= floorPx - PROBE_EPSILON_PX,
    `${seen.size} eggs; nearest ${fmt(nearestPx / TILE_SIZE, 2)} tiles`,
  );
}

function gateEggs(): void {
  eggsLandClearOfHer();
  // Hatch timing, hatch count, and the hatchlings' first update.
  {
    const lab = broodLab(RUN_SEED);
    const landedAt = new Map<SpiderEgg, number>();
    const hatchedAt = new Map<SpiderEgg, number>();
    const firstUpdateTargets: boolean[] = [];
    const seenHatchlings = new Set<SpiderHatchling>();
    for (let frame = 0; frame < BROOD_WAIT_CEILING && hatchedAt.size < 2; frame++) {
      step(lab, standOff(lab));
      applyEggFaults(lab);
      for (const egg of lab.roster.mobs) {
        if (!(egg instanceof SpiderEgg)) continue;
        if (!landedAt.has(egg)) landedAt.set(egg, lab.frame);
        if (!egg.isAlive && egg.ending === 'hatched' && !hatchedAt.has(egg))
          hatchedAt.set(egg, lab.frame);
      }
      for (const hatchling of hatchlingsOf(lab)) {
        if (seenHatchlings.has(hatchling)) continue;
        seenHatchlings.add(hatchling);
        firstUpdateTargets.push(hatchling.currentTarget !== null);
      }
    }
    const lifetimes = [...hatchedAt.entries()].map(([egg, at]) => at - (landedAt.get(egg) ?? at));
    record(
      '9',
      `an untouched egg hatches exactly ${EGG_HATCH_FRAMES} ticks after landing`,
      lifetimes.length > 0 && lifetimes.every((ticks) => ticks === EGG_HATCH_FRAMES),
      lifetimes.length === 0 ? 'no egg hatched' : `[${lifetimes.join(',')}] ticks`,
    );
    record(
      '9',
      `each hatch releases ${EGG_HATCHLINGS_PER_EGG} hatchling(s)`,
      hatchedAt.size > 0 && seenHatchlings.size === hatchedAt.size * EGG_HATCHLINGS_PER_EGG,
      `${seenHatchlings.size} from ${hatchedAt.size} eggs`,
    );
    record(
      '9',
      'a hatched hatchling has a target after its first update',
      firstUpdateTargets.length > 0 && firstUpdateTargets.every(Boolean),
      `${firstUpdateTargets.filter(Boolean).length}/${firstUpdateTargets.length}`,
    );
  }

  hatchlingTargetingProbe();
  eggDamageTypes();
  slamCrush();
  eggNeverBlocks();
  broodCapAndCooldown();
}

/**
 * A hatchling behind a pillar, further than a spiderling's aggro range, still
 * commits to the crawler on its first update; a plain spiderling in the same
 * spot does not, which is what makes the first half mean anything.
 */
function hatchlingTargetingProbe(): void {
  const hatchTile = { x: PILLAR.x + PILLAR.w + 1, y: PILLAR.y + 2 };
  const HIDDEN_DISTANCE_TILES = 12;
  const humanTile = { x: hatchTile.x - HIDDEN_DISTANCE_TILES, y: hatchTile.y };
  const probe = (makeSpider: () => SmallSpider): boolean => {
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 },
      humanTile,
      catTile: null,
      withQuest: false,
    });
    // The boss is not part of this probe; she only needs to stand somewhere.
    lab.spider.hp = 0;
    const spiderling = makeSpider();
    lab.roster.add(spiderling);
    applyEggFaults(lab);
    step(lab);
    return spiderling.currentTarget === lab.human;
  };
  const hatchling = probe(
    () => new SpiderHatchling(hatchTile.x, hatchTile.y, TILE_SIZE, { ...LAB_BOUNDS }),
  );
  const plain = probe(() => new SmallSpider(hatchTile.x, hatchTile.y, TILE_SIZE));
  record(
    '9',
    `a hatchling ${HIDDEN_DISTANCE_TILES} tiles away behind a pillar commits on its first update`,
    hatchling && !plain,
    `hatchling ${hatchling ? 'targets' : 'idle'}, plain spiderling ${plain ? 'targets' : 'idle'}`,
  );
}

const ATTACK_KEY_DAMAGE_TYPES: readonly PlayerDamageType[] = [
  'melee',
  'slingshot',
  'missile',
  'smush',
];
/** A deliberately tiny blow: an egg must break to any hit, not to a big one. */
const TOKEN_HIT_DAMAGE = 1;

function waitForEggs(lab: Lab, count: number): SpiderEgg[] {
  for (let frame = 0; frame < BROOD_WAIT_CEILING; frame++) {
    if (eggsOf(lab).length >= count) break;
    step(lab, standOff(lab));
    applyEggFaults(lab);
  }
  return eggsOf(lab);
}

function eggDamageTypes(): void {
  const lab = broodLab(RUN_SEED + 1);
  const results: string[] = [];
  let allDestroyed = true;
  let remaining = [...ATTACK_KEY_DAMAGE_TYPES];
  let guard = 0;
  const MAX_LAYS = 6;
  while (remaining.length > 0 && guard < MAX_LAYS) {
    guard++;
    const eggs = waitForEggs(lab, 1);
    if (eggs.length === 0) break;
    for (const egg of eggs) {
      const damageType = firstOf(remaining);
      if (damageType === undefined) break;
      remaining = remaining.slice(1);
      const accepts = egg.takesPlayerDamage(damageType);
      if (accepts) egg.takeDamageFrom(TOKEN_HIT_DAMAGE, lab.human, damageType);
      const destroyed = !egg.isAlive && egg.ending === 'destroyed';
      allDestroyed = allDestroyed && accepts && destroyed;
      results.push(`${damageType}:${destroyed ? 'smashed' : accepts ? 'survived' : 'refused'}`);
    }
  }
  const hatchlingsBefore = hatchlingsOf(lab).length;
  const eggsAlive = eggsOf(lab).length;
  const SETTLE = EGG_HATCH_FRAMES + MIN_IMPACT_HOLD_FRAMES;
  // Nothing new may hatch from a smashed egg; any egg laid since is smashed too.
  for (let frame = 0; frame < SETTLE; frame++) {
    for (const egg of eggsOf(lab)) egg.takeDamageFrom(TOKEN_HIT_DAMAGE, lab.human, 'melee');
    step(lab, standOff(lab));
    applyEggFaults(lab);
  }
  const spawned = hatchlingsOf(lab).length - hatchlingsBefore;
  record(
    '9',
    'one hit of each attack-key damage type destroys an egg',
    remaining.length === 0 && allDestroyed,
    results.join(' ') + (remaining.length > 0 ? ` (untested: ${remaining.join(',')})` : ''),
  );
  record(
    '9',
    'a smashed egg spawns nothing',
    spawned === 0 && results.length > 0,
    `${spawned} hatchlings after ${SETTLE} ticks (${eggsAlive} eggs alive at the smash)`,
  );
}

/** Eggs placed in front of her and behind her; she slams at a crawler in front. */
function slamCrush(): void {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + 2 },
    catTile: null,
    withQuest: true,
  });
  const quest = questOf(lab);
  const inFront = { tileX: LAB_CENTRE_TILE.x, tileY: LAB_CENTRE_TILE.y + 1 };
  const flank = { tileX: LAB_CENTRE_TILE.x - 2, tileY: LAB_CENTRE_TILE.y };
  const behind = { tileX: LAB_CENTRE_TILE.x, tileY: LAB_CENTRE_TILE.y - 2 };
  for (const tile of [inFront, flank, behind]) callPrivate(quest, '_spawnEgg', [tile]);
  const eggAt = (tile: { tileX: number; tileY: number }): SpiderEgg | undefined =>
    lab.roster.mobs.find(
      (mob): mob is SpiderEgg =>
        mob instanceof SpiderEgg && mob.tileX === tile.tileX && mob.tileY === tile.tileY,
    );
  const anchor = { x: lab.spider.x, y: lab.spider.y };
  const aimHolder = {
    x: centreOf(lab.spider).x,
    y: centreOf(lab.spider).y + DECISION_DISTANCE_PX.slam,
  };
  let struck = false;
  const SLAM_WAIT_CEILING = 1200;
  for (let frame = 0; frame < SLAM_WAIT_CEILING && !struck; frame++) {
    teleportMob(lab, lab.spider, anchor.x, anchor.y);
    placeCentre(lab.human, aimHolder);
    lab.human.hp = lab.human.maxHp;
    step(lab);
    applyEggFaults(lab);
    if (lab.spider.currentAttack === 'slam' && lab.spider.attackFrame === strikeFrame('slam')) {
      step(lab);
      struck = true;
    }
  }
  const front = eggAt(inFront);
  const side = eggAt(flank);
  const back = eggAt(behind);
  const impact: SlamImpact = {
    originX: centreOf(lab.spider).x,
    originY: centreOf(lab.spider).y,
    dirX: lab.spider.lockedAimX,
    dirY: lab.spider.lockedAimY,
    radiusPx: SLAM_CONE_RADIUS_PX,
    halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
  };
  const describe = (egg: SpiderEgg | undefined): string =>
    egg === undefined
      ? 'missing'
      : `${egg.isAlive ? 'intact' : (egg.ending ?? 'dead')} (${fmt(coneClearance(impact, centreOf(egg)))} px)`;
  record(
    '9',
    'her slam crushes the egg inside its cone',
    struck && front !== undefined && !front.isAlive,
    `front ${describe(front)}`,
  );
  record(
    '9',
    'and spares the eggs outside it',
    struck && side?.isAlive === true && back?.isAlive === true,
    `flank ${describe(side)}, behind ${describe(back)}`,
  );
}

/** A crawler walks straight across an egg's tile at full speed and is never slowed. */
function eggNeverBlocks(): void {
  const EGG_ROW_OFFSET_TILES = 6;
  const WALK_IN_TILES = 3;
  const row = LAB_CENTRE_TILE.y + EGG_ROW_OFFSET_TILES;
  const eggTile = { tileX: LAB_CENTRE_TILE.x, tileY: row };
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + 1 },
    humanTile: { x: LAB_CENTRE_TILE.x - WALK_IN_TILES, y: row },
    catTile: null,
    withQuest: true,
  });
  // She sits this one out, held in her corner; killing her would end the fight and burst the egg.
  lab.spider.aiHeld = true;
  callPrivate(questOf(lab), '_spawnEgg', [eggTile]);
  applyEggFaults(lab);
  const egg = firstOf(eggsOf(lab));
  const startX = lab.human.x;
  const CROSS_TILES = 6;
  const crossFrames = Math.ceil((TILE_SIZE * CROSS_TILES) / PLAYER_SPEED);
  let slowestStep = Infinity;
  for (let frame = 0; frame < crossFrames; frame++) {
    const before = lab.human.x;
    step(lab, new Map([[lab.human, { x: PLAYER_SPEED, y: 0 }]]));
    slowestStep = Math.min(slowestStep, lab.human.x - before);
  }
  const travelled = lab.human.x - startX;
  const expected = crossFrames * PLAYER_SPEED;
  record(
    '9',
    "a crawler walks across an egg's tile without being slowed",
    egg !== undefined && egg.isAlive && Math.abs(travelled - expected) < PROBE_EPSILON_PX,
    `${fmt(travelled)} of ${fmt(expected)} px, slowest tick ${fmt(slowestStep, 2)} px`,
  );
}

const BROOD_RUN_SEEDS = 3;
const BROOD_RUN_FRAMES = 14400;
/**
 * Crawlers let a hatchling live this long before swatting it: long enough for
 * the brood to pile up against the cap, short enough that lays keep coming.
 */
const HATCHLING_LIFETIME_FRAMES = 1500;

function broodCapAndCooldown(): void {
  let peak = 0;
  let lays = 0;
  let minLayGap = Infinity;
  for (let seed = 0; seed < BROOD_RUN_SEEDS; seed++) {
    const lab = broodLab(RUN_SEED + seed, PHASE_THREE_START_FRACTION);
    const bornAt = new Map<SpiderHatchling, number>();
    let lastLay = -Infinity;
    for (let frame = 0; frame < BROOD_RUN_FRAMES; frame++) {
      step(lab, standOff(lab));
      applyEggFaults(lab);
      lab.spider.hp = Math.max(lab.spider.hp, 1);
      if (lab.spider.currentAttack === 'lay' && lab.spider.attackFrame === 0) {
        lays++;
        minLayGap = Math.min(minLayGap, lab.frame - lastLay);
        lastLay = lab.frame;
      }
      for (const hatchling of hatchlingsOf(lab)) {
        const born = bornAt.get(hatchling) ?? lab.frame;
        bornAt.set(hatchling, born);
        if (lab.frame - born >= HATCHLING_LIFETIME_FRAMES) {
          hatchling.takeDamageFrom(hatchling.hp, lab.human, 'melee');
        }
      }
      peak = Math.max(peak, eggsOf(lab).length + hatchlingsOf(lab).length);
    }
  }
  record(
    '9',
    `eggs plus hatchlings never exceed ${MAX_LIVE_EGGS_AND_HATCHLINGS}`,
    peak <= MAX_LIVE_EGGS_AND_HATCHLINGS && lays > 0,
    `peak ${peak} over ${lays} lays`,
  );
  record(
    '9',
    'the brood run pressed against the cap (not vacuous)',
    peak >= MAX_LIVE_EGGS_AND_HATCHLINGS,
    `peak ${peak}`,
  );
  record(
    '9',
    `lays are at least ${LAY_COOLDOWN_FRAMES} frames apart`,
    lays > 1 && minLayGap >= LAY_COOLDOWN_FRAMES,
    `closest ${fmt(minLayGap, 0)} frames`,
  );
}

// ─────────────────────────────────────────────────────────────── gate 10: cleanup

const CLEANUP_SETTLE_FRAMES = 400;
/** Each exit gets its own seed, so they do not all test the same moment of the same fight. */
const CLEANUP_SEED_OFFSETS = { abort: 2, bossDeath: 3, dispose: 4, checkpoint: 5 } as const;

/** A fight with eggs and hatchlings both out, a puddle down and a glob in flight if one can be caught. */
function labWithBrood(seed: number): Lab {
  const lab = broodLab(seed);
  if (fault === 'brood-leak') wrapMethod(questOf(lab), '_clearBrood', () => undefined);
  for (let frame = 0; frame < BROOD_WAIT_CEILING; frame++) {
    step(lab, standOff(lab));
    applyEggFaults(lab);
    const broodOut = eggsOf(lab).length > 0 && hatchlingsOf(lab).length > 0;
    if (broodOut && lab.spider.spitPuddles.length > 0) break;
  }
  return lab;
}

/**
 * Her glob and puddles are only advanced by her own AI, which stops when she
 * dies. On her death the glob must leave the air at once and the puddles dry
 * up (a fade, not a pop) and are gone within their evaporation; and her corpse
 * must never be one a necro fairy can raise into a fight whose room is open.
 */
interface PuddleEnds {
  ended: number;
  popped: number;
  how: string;
}

/**
 * Steps the lab and watches every puddle to its end. A puddle has dried when
 * its last frame on the floor was the last frame of its evaporation, settled
 * (not mid-splash, which the renderer would draw instead of the fade); one
 * that leaves any other way has popped.
 */
function watchPuddlesEnd(lab: Lab, frames: number): PuddleEnds {
  const lastSeen = new Map<
    Readonly<SpitPuddle>,
    { evaporate: number | null; splashing: boolean }
  >();
  const seenSplashingWhileDrying = new Set<Readonly<SpitPuddle>>();
  const result: PuddleEnds = { ended: 0, popped: 0, how: 'none popped' };
  const note = (): void => {
    for (const puddle of lab.spider.spitPuddles) {
      const splashing = puddle.phase === 'splat';
      if (splashing && puddle.evaporateFramesLeft !== null) seenSplashingWhileDrying.add(puddle);
      lastSeen.set(puddle, { evaporate: puddle.evaporateFramesLeft, splashing });
    }
  };
  note();
  for (let frame = 0; frame < frames; frame++) {
    step(lab);
    const present = new Set(lab.spider.spitPuddles);
    for (const [puddle, last] of lastSeen) {
      if (present.has(puddle)) continue;
      lastSeen.delete(puddle);
      result.ended++;
      const driedOut = last.evaporate === 1 && !seenSplashingWhileDrying.has(puddle);
      if (driedOut) continue;
      result.popped++;
      result.how = seenSplashingWhileDrying.has(puddle)
        ? 'held its splash while drying'
        : `left with ${String(last.evaporate)} drying frames to go`;
    }
    note();
  }
  return result;
}

/** Frames the banner probe waits for the quest-complete banner before calling it stuck. */
const BANNER_WAIT_CEILING_FRAMES = 600;

/**
 * The quest completes on the tick she dies, but its banner and full-screen dim
 * hold off until her death has played, so the collapse is seen.
 */
function bannerWaitsForHerDeath(): void {
  const lab = broodLab(RUN_SEED);
  const quest = questOf(lab);
  if (fault === 'banner-over-death') {
    wrapMethod(quest, 'onBossKilled', (original, args) => {
      const result = original(...args);
      quest.completeOverlayDelay = 0;
      quest.completeOverlayTimer = 1;
      return result;
    });
  }
  const completions = { count: 0 };
  lab.combat.bus.on('questCompleted', () => {
    completions.count++;
  });
  lab.spider.takeDamageFrom(lab.spider.hp, lab.human, 'melee');
  let framesToBanner = 0;
  let completedBeforeBanner = false;
  let corpseClockAtBanner = NaN;
  while (framesToBanner < BANNER_WAIT_CEILING_FRAMES) {
    step(lab, standOff(lab));
    framesToBanner++;
    if (quest.completeOverlayTimer > 0) {
      corpseClockAtBanner = numberField(lab.spider, 'corpseFrames');
      break;
    }
    if (completions.count === 1) completedBeforeBanner = true;
  }
  const deathPlayed = corpseClockAtBanner >= DEATH_ANIM_FRAMES;
  record(
    '10',
    'her death plays out before the quest-complete banner covers it',
    completedBeforeBanner && deathPlayed,
    `quest ${completedBeforeBanner ? 'completed before the banner' : 'not completed before the banner'}; ` +
      `banner ${framesToBanner} frames after her death, corpse clock ${fmt(corpseClockAtBanner, 0)} of ${DEATH_ANIM_FRAMES}`,
  );
}

/** Frames of life a puddle is given in the timeout probe: just past the length of a fade. */
const TTL_PROBE_EXTRA_FRAMES = 2;

/**
 * A puddle that lives out its whole life dries up over its last frames, the
 * same fade an overflowing puddle uses, rather than vanishing on the frame
 * its life runs out.
 */
function puddleOutlivesItsLife(): void {
  const lab = buildLab({
    seed: RUN_SEED,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + LAB_BOUNDS.h - 2 },
    catTile: null,
    withQuest: false,
  });
  const { spider } = lab;
  const puddleOffsetTiles = 3;
  callPrivate(spider, 'spawnGroundTrap', [
    centreOf(spider).x + TILE_SIZE * puddleOffsetTiles,
    centreOf(spider).y,
  ]);
  const puddle = firstOf(spider.spitPuddles);
  // Settled and nearly out of life, so the run reaches the end of it in a
  // fraction of the minute a puddle really lasts.
  if (puddle !== undefined) {
    Reflect.set(puddle, 'phase', 'idle');
    Reflect.set(puddle, 'ttl', PUDDLE_EVAPORATE_FRAMES + TTL_PROBE_EXTRA_FRAMES);
  }
  const ends = watchPuddlesEnd(lab, PUDDLE_EVAPORATE_FRAMES + TTL_PROBE_EXTRA_FRAMES + 1);
  record(
    '10',
    'a puddle whose life runs out dries up rather than popping',
    puddle !== undefined && ends.ended === 1 && ends.popped === 0,
    `${ends.ended} ended, ${ends.popped} popped (${ends.how})`,
  );
}

function deathClearsHerAttacks(): void {
  const lab = buildLab({
    seed: RUN_SEED + CLEANUP_SEED_OFFSETS.bossDeath,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x, y: LAB_CENTRE_TILE.y + ROOT_RUN_START_OFFSET_TILES },
    catTile: null,
    withQuest: false,
  });
  const { spider, human } = lab;
  const puddleOffsetTiles = 3;
  callPrivate(spider, 'spawnGroundTrap', [
    centreOf(spider).x + TILE_SIZE * puddleOffsetTiles,
    centreOf(spider).y,
  ]);
  callPrivate(spider, 'fireSpitProjectile', []);
  const puddlesBefore = spider.spitPuddles.length;
  const globBefore = spitGlob(spider) !== null;
  spider.takeDamageFrom(spider.hp, human, 'melee');
  step(lab);
  const globAfterDeath = spitGlob(spider) !== null;
  const dryingOnDeath =
    spider.spitPuddles.length > 0 &&
    spider.spitPuddles.every((p) => p.evaporateFramesLeft !== null);
  const deathDrying = watchPuddlesEnd(lab, PUDDLE_EVAPORATE_FRAMES);
  const puddlesLeft = spider.spitPuddles.length;
  record(
    '10',
    'her death: the glob leaves the air and the puddles dry up',
    !spider.isAlive &&
      globBefore &&
      puddlesBefore > 0 &&
      !globAfterDeath &&
      dryingOnDeath &&
      puddlesLeft === 0,
    `glob ${globBefore ? 'in flight' : 'missing'} → ${globAfterDeath ? 'still in the air' : 'gone'}; ` +
      `${puddlesBefore} puddles → ${dryingOnDeath ? 'drying' : 'not drying'} → ${puddlesLeft} left after ${PUDDLE_EVAPORATE_FRAMES} frames`,
  );
  record(
    '10',
    'her death: a puddle still splashing down dries up rather than freezing and popping',
    deathDrying.ended > 0 && deathDrying.popped === 0,
    `${deathDrying.ended} puddles ended, ${deathDrying.popped} popped (${deathDrying.how})`,
  );
  const ledger = new FairyCorpseLedger();
  ledger.record(spider);
  record(
    '10',
    'her death: a necro fairy has no corpse of hers to raise',
    !spider.isAlive && ledger.entries.length === 0,
    `${ledger.entries.length} raisable corpse(s)`,
  );
}

/** Tiles from the party the egg lies for the companion check: past the human's own engage range, inside the companion's reach. */
const COMPANION_EGG_OFFSET_TILES = 6;
/** Frames the companion is given to pick the egg up as its target. */
const COMPANION_EGG_FRAMES = 30;

/**
 * An AI companion on the aggressive stance goes for a nearby egg on sight,
 * whichever crawler is the companion: an egg never targets anybody, so a
 * companion that waits to be attacked leaves it to tick down to a hatch.
 */
function companionsSmashEggs(): void {
  for (const companionIs of ['cat', 'human'] as const) {
    const lab = buildLab({
      seed: RUN_SEED,
      spiderTile: { x: LAB_BOUNDS.x + 1, y: LAB_BOUNDS.y + 1 },
      humanTile: LAB_CENTRE_TILE,
      catTile: { x: LAB_CENTRE_TILE.x + 1, y: LAB_CENTRE_TILE.y },
      withQuest: false,
    });
    const { human, cat, spider } = lab;
    spider.hp = 0;
    const humanIsActive = companionIs === 'cat';
    human.isActive = humanIsActive;
    cat.isActive = !humanIsActive;
    const egg = new SpiderEgg(
      LAB_CENTRE_TILE.x,
      LAB_CENTRE_TILE.y + COMPANION_EGG_OFFSET_TILES,
      TILE_SIZE,
    );
    lab.roster.add(egg);
    const companionSystem = new CompanionSystem(lab.map, LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
    if (fault === 'companion-ignores-eggs' && companionIs === 'human') {
      wrapMethod(companionSystem, 'findAggroDrawingMobNear', () => null);
    }
    const companion = humanIsActive ? cat : human;
    const ctx: SystemContext = {
      ...lab.ctx(),
      active: humanIsActive ? human : cat,
      inactive: companion,
    };
    let targeted = false;
    for (let frame = 0; frame < COMPANION_EGG_FRAMES && !targeted; frame++) {
      companionSystem.update(ctx);
      targeted = companion.autoTarget === egg;
    }
    record(
      '10',
      `the ${companionIs} as AI companion goes for a nearby egg`,
      targeted,
      targeted ? 'targeted the egg' : `target: ${companion.autoTarget?.mobType ?? 'none'}`,
    );
  }
}

function settle(lab: Lab): void {
  for (let frame = 0; frame < CLEANUP_SETTLE_FRAMES; frame++) {
    for (const player of [lab.human, lab.cat]) player.hp = Math.max(player.hp, 0);
    step(lab);
  }
}

function broodLeft(lab: Lab): string {
  return `${eggsOf(lab).length} eggs, ${hatchlingsOf(lab).length} hatchlings alive; ${broodInGrid(lab)} in grid`;
}

function broodGone(lab: Lab): boolean {
  return eggsOf(lab).length === 0 && hatchlingsOf(lab).length === 0 && broodInGrid(lab) === 0;
}

function gateCleanup(): void {
  // Abort: nobody conscious left in the room.
  {
    const lab = labWithBrood(RUN_SEED + CLEANUP_SEED_OFFSETS.abort);
    const hadBrood = eggsOf(lab).length + hatchlingsOf(lab).length;
    const hadPuddles = lab.spider.spitPuddles.length;
    lab.human.hp = 0;
    lab.cat.hp = 0;
    step(lab);
    const puddlesAfter = lab.spider.spitPuddles.length;
    const globAfter = spitGlob(lab.spider);
    const attackAfter = lab.spider.currentAttack;
    settle(lab);
    record(
      '10',
      'abort: the brood is gone',
      hadBrood > 0 && broodGone(lab),
      `had ${hadBrood}; ${broodLeft(lab)}`,
    );
    record(
      '10',
      'abort: no puddle, glob or attack survives',
      hadPuddles > 0 && puddlesAfter === 0 && globAfter === null && attackAfter === null,
      `had ${hadPuddles} puddles; after ${puddlesAfter} puddles, glob ${globAfter === null ? 'none' : 'in flight'}, attack ${String(attackAfter)}`,
    );
  }
  // Her death.
  {
    const lab = labWithBrood(RUN_SEED + CLEANUP_SEED_OFFSETS.bossDeath);
    const hadBrood = eggsOf(lab).length + hatchlingsOf(lab).length;
    lab.spider.takeDamageFrom(lab.spider.hp, lab.human, 'melee');
    settle(lab);
    record(
      '10',
      'boss death: the brood is gone',
      hadBrood > 0 && broodGone(lab),
      `had ${hadBrood}; ${broodLeft(lab)}`,
    );
  }
  deathClearsHerAttacks();
  bannerWaitsForHerDeath();
  puddleOutlivesItsLife();
  companionsSmashEggs();
  // Disposal.
  {
    const lab = labWithBrood(RUN_SEED + CLEANUP_SEED_OFFSETS.dispose);
    const hadBrood = eggsOf(lab).length + hatchlingsOf(lab).length;
    questOf(lab).dispose();
    for (let frame = 0; frame < CLEANUP_SETTLE_FRAMES; frame++) {
      lab.loop.update(lab.ctx());
      resolveKills(lab.combat);
    }
    record(
      '10',
      'dispose: the brood is gone',
      hadBrood > 0 && broodGone(lab),
      `had ${hadBrood}; ${broodLeft(lab)}`,
    );
  }
  // Checkpoint restore: the checkpoint is taken as the fight opens, before any brood.
  {
    const lab = broodLab(RUN_SEED + CLEANUP_SEED_OFFSETS.checkpoint);
    const quest = questOf(lab);
    step(lab);
    markMobsAtCheckpoint(lab.roster);
    const checkpoint = quest.captureCheckpoint();
    if (fault === 'brood-leak') wrapMethod(quest, '_clearBrood', () => undefined);
    for (let frame = 0; frame < BROOD_WAIT_CEILING; frame++) {
      step(lab, standOff(lab));
      applyEggFaults(lab);
      if (eggsOf(lab).length > 0 && hatchlingsOf(lab).length > 0) break;
    }
    const hadBrood = eggsOf(lab).length + hatchlingsOf(lab).length;
    if (fault !== 'brood-leak') rewindMobsToCheckpoint(lab.roster);
    quest.restoreCheckpoint(checkpoint);
    lab.combat.mobGrid = lab.roster.grid;
    for (let frame = 0; frame < CLEANUP_SETTLE_FRAMES; frame++) step(lab, standOff(lab));
    const layRequestsPending = lab.spider.drainEggLayRequests().length;
    record(
      '10',
      'checkpoint restore: the brood is gone and does not come back',
      hadBrood > 0 && broodGone(lab) && layRequestsPending === 0,
      `had ${hadBrood}; ${broodLeft(lab)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── gate 11: the perfect run

/**
 * The crawler party the time-to-kill is measured with: both crawlers at a party
 * level a player reaching the lab on schedule would hold, on the balanced build,
 * with no gear, skills or consumables.
 */
const REFERENCE_PARTY_LEVEL = 8;
const TTK_PARTY_LEVEL_STEP = 2;
const TTK_PARTY_LEVELS: readonly number[] = [-1, 0, 1, 2].map(
  (offset) => REFERENCE_PARTY_LEVEL + offset * TTK_PARTY_LEVEL_STEP,
);
const TTK_TARGET_MIN_SECONDS = 90;
const TTK_TARGET_MAX_SECONDS = 150;
const FIGHT_BUDGET_SECONDS = 600;
const FIGHT_FRAME_BUDGET = FIGHT_BUDGET_SECONDS * SPIDER_FRAMES_PER_SECOND;
/** Pixels of slack the reader keeps between itself and any drawn danger. */
const READER_MARGIN_PX = 10;
/** The cat's missile reach, as the reader uses it. */
const MISSILE_REACH_TILES = 6;
/** Directions the reader weighs when a step is not simply "toward the goal". */
const READER_DIRECTIONS = 24;
/** Steps the reader looks ahead along each direction. */
const READER_LOOKAHEAD_STEPS = 14;
/**
 * How far from her the reader waits between attacks. It alternates, one attack
 * to the next, between close in, punishing every recovery (she answers with a
 * slam or a screech), and out at range (she answers with a spit), so a run sees
 * her whole kit.
 */
const CLOSE_HOVER_TILES = 2.5;
const RANGE_HOVER_TILES = 5;
const HOVER_DISTANCES_TILES: readonly number[] = [CLOSE_HOVER_TILES, RANGE_HOVER_TILES];
/** How deep inside its own reach the reader steps to punish a recovery. */
const PUNISH_REACH_FRACTION = 0.8;

/**
 * A piece of dangerous floor as the reader sees it. `atStrike` is set for an
 * area attack's shape: only where the reader stands on its strike tick matters,
 * and that is this many ticks away. Everything else (a puddle, a glob in
 * flight, a locked aim line) is dangerous along the whole path.
 */
type Threat = (
  | { readonly kind: 'disk'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: 'cone'; readonly impact: SlamImpact }
  | {
      readonly kind: 'ray';
      readonly x: number;
      readonly y: number;
      readonly dx: number;
      readonly dy: number;
      readonly halfWidth: number;
    }
) & { readonly atStrike: number | null };

/**
 * Everything the screen shows as dangerous floor right now, as seen by a
 * reader standing at `reader`: the area telegraph
 * (a disk while a slam's cone can still turn, its cone once locked), the spit
 * aim line once it has frozen, the glob, and every live puddle. A tracking aim
 * line is not a threat yet: it follows whoever it is pointed at. A glob bites
 * when it reaches the reader's point along its line.
 */
function visibleThreats(spider: GrotesqueSpider, reader: Vec): Threat[] {
  const threats: Threat[] = [];
  const her = centreOf(spider);
  const attack = spider.currentAttack;
  const reachingAlong = (from: Vec, dir: Vec, lead: number): number => {
    const along = (reader.x - from.x) * dir.x + (reader.y - from.y) * dir.y;
    return lead + Math.max(1, Math.ceil(Math.max(0, along) / SPIT_SPEED_PX));
  };
  if (spider.isAlive && spider.roarFrame === null && attack !== null) {
    const frame = spider.attackFrame;
    const isArea = attack === 'slam' || attack === 'screech';
    if (isArea && frame <= strikeFrame(attack)) {
      const atStrike = strikeFrame(attack) - frame;
      const locked = frame >= SPIDER_ATTACK_TIMELINES[attack].tellFrames;
      if (attack === 'slam' && locked) {
        threats.push({
          kind: 'cone',
          impact: {
            originX: her.x,
            originY: her.y,
            dirX: spider.lockedAimX,
            dirY: spider.lockedAimY,
            radiusPx: SLAM_CONE_RADIUS_PX,
            halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
          },
          atStrike,
        });
      } else {
        const r = attack === 'slam' ? SLAM_REACH_PX : SCREECH_REACH_PX;
        threats.push({ kind: 'disk', x: her.x, y: her.y, r, atStrike });
      }
    }
    const spitLocked = attack === 'spit' && frame >= SPIDER_ATTACK_TIMELINES.spit.tellFrames;
    if (spitLocked && frame < strikeFrame('spit')) {
      const aim = { x: spider.lockedAimX, y: spider.lockedAimY };
      threats.push({
        kind: 'ray',
        x: her.x,
        y: her.y,
        dx: aim.x,
        dy: aim.y,
        halfWidth: SPIT_HIT_RADIUS_PX,
        atStrike: reachingAlong(her, aim, strikeFrame('spit') - frame),
      });
    }
  }
  const glob = spitGlob(spider);
  if (glob !== null) {
    const dir = unit({ x: glob.vx, y: glob.vy });
    threats.push({
      kind: 'ray',
      x: glob.x,
      y: glob.y,
      dx: dir.x,
      dy: dir.y,
      halfWidth: SPIT_HIT_RADIUS_PX,
      atStrike: reachingAlong(glob, dir, 0),
    });
  }
  for (const puddle of spider.spitPuddles) {
    if (puddle.evaporateFramesLeft !== null) continue;
    threats.push({
      kind: 'disk',
      x: puddle.x,
      y: puddle.y,
      r: PUDDLE_GRAB_RADIUS_PX,
      atStrike: null,
    });
  }
  return threats;
}

function threatClearance(threat: Threat, p: Vec): number {
  switch (threat.kind) {
    case 'disk':
      return distance(p, threat) - threat.r;
    case 'cone':
      return coneClearance(threat.impact, p);
    case 'ray': {
      const along = (p.x - threat.x) * threat.dx + (p.y - threat.y) * threat.dy;
      if (along < 0) return distance(p, threat) - threat.halfWidth;
      const across = Math.abs((p.x - threat.x) * threat.dy - (p.y - threat.y) * threat.dx);
      return across - threat.halfWidth;
    }
  }
}

/** The longest the reader plans ahead: long enough to see a whole lock through. */
const READER_MAX_LOOKAHEAD_STEPS = 45;

/**
 * How unsafe a straight walk along `dir` is: the summed shortfall below the
 * margin of every threat, each judged where it bites — an area shape at its
 * strike tick, anything else anywhere along the way.
 */
function walkShortfall(lab: Lab, player: Player, dir: Vec, threats: readonly Threat[]): number {
  const horizon = Math.min(
    READER_MAX_LOOKAHEAD_STEPS,
    Math.max(READER_LOOKAHEAD_STEPS, ...threats.map((t) => t.atStrike ?? 0)),
  );
  const probe = { x: player.x, y: player.y };
  const worst = threats.map(() => Infinity);
  for (let stepIndex = 1; stepIndex <= horizon; stepIndex++) {
    pushPlayerWithCollision(probe, dir.x, dir.y, lab.map);
    const here = centreOf(probe);
    threats.forEach((threat, index) => {
      const bitesNow = threat.atStrike === null || threat.atStrike === stepIndex;
      const bitesAfterHorizon =
        threat.atStrike !== null && threat.atStrike > horizon && stepIndex === horizon;
      if (bitesNow || bitesAfterHorizon) {
        worst[index] = Math.min(worst[index] ?? Infinity, threatClearance(threat, here));
      }
    });
  }
  return worst.reduce((sum, clearance) => sum + Math.min(0, clearance - READER_MARGIN_PX), 0);
}

/** One step for a reader: out of any danger first, then toward its goal without entering any. */
function readerStep(
  lab: Lab,
  player: Player,
  goal: Vec | null,
  threats: readonly Threat[],
): Vec | null {
  const me = centreOf(player);
  const standing = walkShortfall(lab, player, { x: 0, y: 0 }, threats);
  const reachedGoal = goal === null || distance(me, goal) <= PLAYER_SPEED;
  if (standing >= 0 && reachedGoal) return null;
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (let index = 0; index < READER_DIRECTIONS; index++) {
    const angle = (index / READER_DIRECTIONS) * Math.PI * 2;
    const dir = { x: Math.cos(angle) * PLAYER_SPEED, y: Math.sin(angle) * PLAYER_SPEED };
    const firstStep = { x: player.x, y: player.y };
    pushPlayerWithCollision(firstStep, dir.x, dir.y, lab.map);
    const afterOne = centreOf(firstStep);
    const progress =
      goal === null ? distance(afterOne, me) : distance(me, goal) - distance(afterOne, goal);
    const score =
      walkShortfall(lab, player, dir, threats) * READER_DIRECTIONS * READER_MAX_LOOKAHEAD_STEPS +
      progress;
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  const standingScore = standing * READER_DIRECTIONS * READER_MAX_LOOKAHEAD_STEPS;
  return standingScore >= bestScore ? null : best;
}

interface Swing {
  cycleIndex: number;
  cooldown: number;
}

interface FightResult {
  readonly ttkSeconds: number;
  readonly killed: boolean;
  readonly bossDamageTaken: number;
  readonly otherDamageTaken: number;
  readonly minClearance: number;
  readonly eggsSmashed: number;
  readonly hatches: number;
  readonly attacksSeen: Readonly<Record<SpiderAttack, number>>;
}

/**
 * How the reader plays: `punisher` waits close and punishes every recovery,
 * which is the fastest safe kill and what the time-to-kill is measured with;
 * `whole-kit` alternates that with waiting out at range, so she also spits.
 */
type ReaderStyle = 'punisher' | 'whole-kit';

/** Where the party walks in, in tiles south of her. */
const FIGHT_START_OFFSET_TILES = 7;

function fightAtLevel(partyLevel: number, seed: number, style: ReaderStyle): FightResult {
  const lab = buildLab({
    seed,
    spiderTile: LAB_CENTRE_TILE,
    humanTile: { x: LAB_CENTRE_TILE.x - 2, y: LAB_CENTRE_TILE.y + FIGHT_START_OFFSET_TILES },
    catTile: { x: LAB_CENTRE_TILE.x + 2, y: LAB_CENTRE_TILE.y + FIGHT_START_OFFSET_TILES },
    withQuest: true,
  });
  const { spider, human, cat } = lab;
  const party: Array<{
    player: HumanPlayer | CatPlayer;
    cycle: readonly ReferenceAttack[];
    swing: Swing;
  }> = [
    {
      player: human,
      cycle: referenceStats('human', 'balanced', partyLevel).attackCycle,
      swing: { cycleIndex: 0, cooldown: 0 },
    },
    {
      player: cat,
      cycle: referenceStats('cat', 'balanced', partyLevel).attackCycle,
      swing: { cycleIndex: 0, cooldown: 0 },
    },
  ];
  const attacksSeen: Record<SpiderAttack, number> = { slam: 0, screech: 0, spit: 0, lay: 0 };
  let minClearance = Infinity;
  let eggsSmashed = 0;
  const hatchedEggs = new Set<SpiderEgg>();
  const hitContext = new Map<number, string>();
  const threatsSeen = new Map<Player, Threat[]>();
  let attacksStarted = 0;
  let frame = 0;
  for (; frame < FIGHT_FRAME_BUDGET && spider.isAlive; frame++) {
    const eggs = eggsOf(lab);
    const hatchlings = hatchlingsOf(lab);
    const moves = new Map<Player, Vec | null>();
    for (const member of party) {
      const { player } = member;
      const me = centreOf(player);
      const reachFor = (attack: ReferenceAttack): number =>
        attack.damageType === 'missile' ? TILE_SIZE * MISSILE_REACH_TILES : player.getMeleeRange();
      const nextAttack = member.cycle[member.swing.cycleIndex % member.cycle.length];
      const meleeReach = player.getMeleeRange();
      const broodTarget =
        firstOf(
          [...eggs, ...hatchlings].sort(
            (a, b) => distance(centreOf(a), me) - distance(centreOf(b), me),
          ),
        ) ?? null;
      let goal: Vec | null;
      if (broodTarget !== null) {
        goal = centreOf(broodTarget);
      } else {
        // Between her and the middle of the room, so the way out of her next
        // attack is open floor rather than a wall.
        const her = centreOf(spider);
        const roomMiddle = tileCentre(LAB_CENTRE_TILE.x, LAB_CENTRE_TILE.y);
        const offset = unit({ x: roomMiddle.x - her.x, y: roomMiddle.y - her.y });
        // Out at range it lets the recovery go rather than walk in: she moves as
        // fast as it does, so range is only ever opened while she cannot follow.
        const closeIn = style === 'punisher' || attacksStarted % HOVER_DISTANCES_TILES.length === 0;
        const waitAt = closeIn ? CLOSE_HOVER_TILES : RANGE_HOVER_TILES;
        const hover =
          spider.isExposed && closeIn ? meleeReach * PUNISH_REACH_FRACTION : TILE_SIZE * waitAt;
        goal = { x: her.x + offset.x * hover, y: her.y + offset.y * hover };
      }
      const threats = visibleThreats(spider, me);
      threatsSeen.set(player, threats);
      moves.set(player, readerStep(lab, player, goal, threats));

      if (member.swing.cooldown > 0) {
        member.swing.cooldown--;
        continue;
      }
      const reach = reachFor(nextAttack);
      const victim: Mob | null =
        broodTarget !== null && distance(centreOf(broodTarget), me) <= reach
          ? broodTarget
          : spider.isExposed && distance(centreOf(spider), me) <= reach
            ? spider
            : null;
      if (victim === null) continue;
      if (victim instanceof SpiderEgg) eggsSmashed++;
      victim.takeDamageFrom(nextAttack.damage, player, nextAttack.damageType);
      member.swing.cooldown = nextAttack.frames;
      member.swing.cycleIndex++;
    }

    const hitsBefore = lab.hits.length;
    step(lab, moves);
    if (lab.hits.length > hitsBefore) {
      const described = party
        .map(
          (member) =>
            `${member.player === human ? 'human' : 'cat'} at (${fmt(centreOf(member.player).x)},${fmt(centreOf(member.player).y)}) ` +
            `${fmt(distance(centreOf(member.player), centreOf(spider)))} px from her, rooted ${String(member.player.hasStatus('stuck'))}`,
        )
        .join('; ');
      hitContext.set(
        lab.frame - 1,
        ` — ${described}; her at (${fmt(centreOf(spider).x)},${fmt(centreOf(spider).y)})`,
      );
    }
    applyEggFaults(lab);
    if (spider.currentAttack !== null && spider.attackFrame === 0) {
      attacksSeen[spider.currentAttack]++;
      attacksStarted++;
    }
    for (const egg of lab.roster.mobs) {
      if (egg instanceof SpiderEgg && egg.ending === 'hatched') hatchedEggs.add(egg);
    }

    const attack = spider.currentAttack;
    if ((attack === 'slam' || attack === 'screech') && spider.attackFrame === strikeFrame(attack)) {
      const her = centreOf(spider);
      for (const member of party) {
        const p = centreOf(member.player);
        const clearance =
          attack === 'screech'
            ? distance(p, her) - SCREECH_RADIUS_PX
            : coneClearance(
                {
                  originX: her.x,
                  originY: her.y,
                  dirX: spider.lockedAimX,
                  dirY: spider.lockedAimY,
                  radiusPx: SLAM_CONE_RADIUS_PX,
                  halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
                },
                p,
              );
        minClearance = Math.min(minClearance, clearance);
      }
    }
    const glob = spitGlob(spider);
    if (glob !== null) {
      for (const member of party) {
        minClearance = Math.min(
          minClearance,
          distance(glob, centreOf(member.player)) - SPIT_HIT_RADIUS_PX,
        );
      }
    }
  }
  for (const hit of lab.hits) {
    const MAX_HIT_NOTES = 4;
    if (notes.length > MAX_HIT_NOTES * PERFECT_RUN_SEEDS) break;
    notes.push(
      `gate 11 level ${partyLevel} seed ${seed}: ${hit.attackType ?? hit.mobType} hit ${hit.victim === human ? 'human' : 'cat'} on frame ${hit.frame} (${String(hit.attack)}@${hit.attackFrame})` +
        (hitContext.get(hit.frame) ?? ''),
    );
  }
  const bossTypes = new Set(['slam', 'screech', 'spit']);
  const bossHits = lab.hits.filter(
    (hit) => hit.attackType !== undefined && bossTypes.has(hit.attackType),
  );
  const otherHits = lab.hits.length - bossHits.length;
  return {
    ttkSeconds: frame / SPIDER_FRAMES_PER_SECOND,
    killed: !spider.isAlive,
    bossDamageTaken: bossHits.length,
    otherDamageTaken: otherHits,
    minClearance,
    eggsSmashed,
    hatches: hatchedEggs.size,
    attacksSeen,
  };
}

const PERFECT_RUN_SEEDS = 3;

function gatePerfectRun(): void {
  const describe = (run: FightResult): string =>
    `${run.killed ? 'killed' : 'NOT killed'} in ${fmt(run.ttkSeconds)} s; ${run.bossDamageTaken} boss blows, ` +
    `${run.otherDamageTaken} other; min clearance ${fmt(run.minClearance)} px; ` +
    `attacks ${JSON.stringify(run.attacksSeen)}; eggs smashed ${run.eggsSmashed}, hatched ${run.hatches}`;
  const punisherRuns: FightResult[] = [];
  const wholeKitRuns: FightResult[] = [];
  for (let seed = 0; seed < PERFECT_RUN_SEEDS; seed++) {
    const punisher = fightAtLevel(REFERENCE_PARTY_LEVEL, RUN_SEED + seed, 'punisher');
    punisherRuns.push(punisher);
    record(
      '11',
      `punisher seed ${seed}: kills her taking no slam, screech or spit`,
      punisher.killed && punisher.bossDamageTaken === 0,
      describe(punisher),
    );
    const wholeKit = fightAtLevel(REFERENCE_PARTY_LEVEL, RUN_SEED + seed, 'whole-kit');
    wholeKitRuns.push(wholeKit);
    record(
      '11',
      `whole-kit seed ${seed}: sees every attack, kills her, takes no slam, screech or spit`,
      wholeKit.killed &&
        wholeKit.bossDamageTaken === 0 &&
        Object.values(wholeKit.attacksSeen).every((count) => count > 0),
      describe(wholeKit),
    );
  }
  const meanTtk = (runs: readonly FightResult[]): number => {
    const kills = runs.filter((run) => run.killed).map((run) => run.ttkSeconds);
    return kills.length === 0 ? Infinity : kills.reduce((a, b) => a + b, 0) / kills.length;
  };
  const ttk = meanTtk(punisherRuns);
  const inBand = ttk >= TTK_TARGET_MIN_SECONDS && ttk <= TTK_TARGET_MAX_SECONDS;
  notes.push(
    `time-to-kill, punisher at party level ${REFERENCE_PARTY_LEVEL} (mean of ${PERFECT_RUN_SEEDS}): ${fmt(ttk)} s — target ${TTK_TARGET_MIN_SECONDS}–${TTK_TARGET_MAX_SECONDS} s${inBand ? '' : ' (OUTSIDE the target band; reported, not gated)'}`,
  );
  notes.push(
    `time-to-kill, whole-kit reader (skips every other punish): ${fmt(meanTtk(wholeKitRuns))} s`,
  );
  notes.push(
    `min reader clearance across the reference fights: ${fmt(Math.min(...[...punisherRuns, ...wholeKitRuns].map((run) => run.minClearance)))} px`,
  );
  for (const level of TTK_PARTY_LEVELS) {
    if (level === REFERENCE_PARTY_LEVEL) continue;
    const run = fightAtLevel(level, RUN_SEED, 'punisher');
    notes.push(
      `  punisher at party level ${level}: ${run.killed ? `${fmt(run.ttkSeconds)} s` : 'not killed in budget'}, ${run.bossDamageTaken} boss blows`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── main

const startedAt = Date.now();
if (fault !== null) console.log(`Fault injected: ${fault} — ${FAULTS[fault]}\n`);

const needsMatrix = ['1', '3', '6', '7'].some(gateSelected);
const matrix = needsMatrix ? runDodgeMatrix() : [];
if (gateSelected('1')) {
  gateDamageTick(matrix);
  cutsceneSpitPlaysThrough();
}
if (gateSelected('2')) {
  gateArt();
  gateArtWiring();
}
if (gateSelected('3')) {
  gateAudio(matrix);
  cancelledAttackAudio();
  broodAudio();
}
if (gateSelected('4')) gateTelegraphs();
if (gateSelected('5')) gateSpitLock();
if (gateSelected('6') || gateSelected('7')) gateDodgeAndDanger(matrix);
if (gateSelected('7')) areaDamageIgnoresLevel();
if (gateSelected('8')) gateRoots();
if (gateSelected('9')) gateEggs();
if (gateSelected('10')) gateCleanup();
if (gateSelected('11')) gatePerfectRun();

const GATE_COLUMN = 5;
const CHECK_COLUMN = 78;
for (const row of rows) {
  const status = row.pass ? 'PASS' : 'FAIL';
  console.log(
    `${status}  ${row.gate.padEnd(GATE_COLUMN)}${row.check.padEnd(CHECK_COLUMN)} ${row.measured}`,
  );
}
if (Number.isFinite(minDodgeMargin)) {
  notes.push(
    `min dodge clearance from the first lock tick: ${fmt(minDodgeMargin)} px (${minDodgeLabel})`,
  );
}
if (notes.length > 0) {
  console.log('');
  for (const note of notes) console.log(note);
}
const failed = rows.filter((row) => !row.pass);
const MS_PER_SECOND = 1000;
console.log(
  `\n${rows.length - failed.length}/${rows.length} checks passed in ${fmt((Date.now() - startedAt) / MS_PER_SECOND)} s`,
);
if (failed.length > 0 || rows.length === 0) process.exit(1);
