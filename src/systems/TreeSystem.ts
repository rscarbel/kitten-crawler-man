import { TILE_SIZE } from '../core/constants';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import {
  TREE,
  TREE_STAGE_HEALTHY,
  TREE_STAGE_DAMAGED,
  TREE_STAGE_BURNING,
  TREE_STAGE_BURNING_LATE,
  TREE_STAGE_CHARRED,
  TREE_STAGE_FELLING,
  TREE_STAGE_FELLING_CHARRED,
  type TileContent,
} from '../map/tileTypes';
import { inferFloorType } from '../map/tiles/helpers';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { makeBurn } from '../core/StatusEffect';
import { randomInt } from '../utils';
import type { GameSystem, SystemContext } from './GameSystem';
import type { LootSystem } from './LootSystem';
import { MELEE_POINT_BLANK_RANGE } from './CombatSystem';
import { tileKey } from './tileKey';

/** Half of TILE_SIZE — used to find the centre of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Tile centre offset as a fraction of tile size. */
const TILE_CENTER_OFFSET = 0.5;
/** Full turn in radians. */
const TWO_PI = Math.PI * 2;

/**
 * A healthy tree's health. Roughly four and a half times a crate's 6, which is
 * what "significantly harder than a crate" costs in swings: felling one is a
 * deliberate act rather than something that happens while walking past.
 */
const TREE_HP = 28;
/** Below this fraction of its health a tree wears its `damaged` art. */
const TREE_DAMAGED_HP_FRACTION = 0.5;
/** A burnt-out husk is barely held together — under a crate's worth of health. */
const CHARRED_TREE_HP = 3;

/** Frames a tree spends alight before the fire eats into the crown. 7 s at 60 fps. */
const BURNING_FRAMES = 420;
/** Frames the late burn lasts before the tree is nothing but charcoal. 5 s. */
const BURNING_LATE_FRAMES = 300;

/** Tiles beyond a blast's own radius that catch fire from it. */
export const EXPLOSION_IGNITE_RING_TILES = 2;

/**
 * Centre-to-centre distance at which a player counts as touching a burning
 * tree. A shade over one tile: standing in the square next to the trunk counts,
 * standing a clear tile away does not.
 */
const TREE_CONTACT_RADIUS_TILES = 1.1;
const TREE_CONTACT_RADIUS = TILE_SIZE * TREE_CONTACT_RADIUS_TILES;
/** Frames between contact-damage ticks. 0.5 s at 60 fps. */
const TREE_CONTACT_DAMAGE_INTERVAL = 30;
const TREE_CONTACT_DAMAGE = 2;
/** Frames of unbroken contact before the fire sets the player alight. 1 s. */
const TREE_CONTACT_BURN_DELAY = 60;
const TREE_CONTACT_DAMAGE_FLASH_FRAMES = 8;

/**
 * No mob laid this fire, so there is nothing to sidestep — and `takeDamage`
 * only ever rolls a dodge against `kind: 'mob'`, which makes this undodgeable
 * without any further handling.
 */
const TREE_CONTACT_DAMAGE_SOURCE = { kind: 'environmental' } as const;

/** Playback rate of the burn and collapse loops. */
const TREE_ANIM_FPS = 10;
const FRAMES_PER_SECOND = 60;
const FRAMES_PER_ANIM_STEP = FRAMES_PER_SECOND / TREE_ANIM_FPS;
/** Frames in the `burning`, `burning_late` and `felling` rows of every tree sheet. */
const TREE_ANIM_FRAME_COUNT = 6;
/** How long a collapse takes, start to bare ground. */
const FELLING_TOTAL_FRAMES = TREE_ANIM_FRAME_COUNT * FRAMES_PER_ANIM_STEP;

/** Coins a felled tree drops: floor 3 → 3–5. */
const TREE_COIN_SPREAD = 2;

/** Frames a struck tree flashes. */
const HIT_FLASH_FRAMES = 6;
const HIT_FLASH_MAX_ALPHA = 0.45;
const HIT_FLASH_RADIUS_TILES = 0.7;
const HIT_FLASH_RADIUS_PX = TILE_SIZE * HIT_FLASH_RADIUS_TILES;
/** Where on a tree a swing lands, in tile heights above the tile centre. */
const HIT_FLASH_HEIGHT_TILES = 0.4;

/** 60 s at 60 fps, matching how long a smashed prop's wreckage lingers. */
const STUMP_LIFETIME_FRAMES = 3600;
const STUMP_FADE_FRAMES = 240;
/** Past this many stumps the closest to expiry is dropped, so a long session can't grow unbounded. */
const MAX_STUMPS = 60;

const EMBER_SPAWN_INTERVAL_FRAMES = 4;
const EMBER_LIFETIME_MIN = 30;
const EMBER_LIFETIME_MAX = 70;
const EMBER_RISE_SPEED_MIN = 0.35;
const EMBER_RISE_SPEED_MAX = 0.9;
const EMBER_DRIFT_MAX = 0.4;
const EMBER_SIZE_MIN = 1;
const EMBER_SIZE_MAX = 2.6;
/** Embers are born up in the crown, not at the trunk's foot. */
const EMBER_SPAWN_HEIGHT_TILES = 2.2;
const EMBER_SPAWN_SPREAD_TILES = 0.9;
const MAX_EMBERS = 220;

/**
 * How far outside the viewport an effect is still drawn.
 *
 * Generous enough to cover the widest thing here — the fire glow reaches a
 * little over two tiles from the trunk it belongs to — so nothing pops in at
 * the screen edge, and tight enough that a forest burning off-screen costs
 * nothing to draw.
 */
const EFFECT_CULL_MARGIN_TILES = 4;
const EFFECT_CULL_MARGIN_PX = TILE_SIZE * EFFECT_CULL_MARGIN_TILES;

/** Warm pool of light a burning tree throws on the ground around itself. */
const FIRE_GLOW_RADIUS_TILES = 2.2;
const FIRE_GLOW_RADIUS_PX = TILE_SIZE * FIRE_GLOW_RADIUS_TILES;
const FIRE_GLOW_CENTER_COLOR = 'rgba(255,170,70,0.3)';
const FIRE_GLOW_EDGE_COLOR = 'rgba(255,170,70,0)';
/** Cycles a burning tree's glow so the light breathes rather than sits flat. */
const FIRE_GLOW_PULSE_PERIOD_FRAMES = 37;
const FIRE_GLOW_PULSE_DEPTH = 0.22;

/**
 * Damage large enough to flatten any tree in one application. Used by blasts,
 * which have no business merely bruising a tree.
 */
const INSTANT_DESTROY_DAMAGE = Number.MAX_SAFE_INTEGER;

/** Live state for one tree tile. Created lazily — see the class doc. */
export interface TreeHealth {
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  hitFlashFrames: number;
  stage: number;
  /** Frames spent in the current burn stage. */
  stageFrames: number;
  /** Frames spent in any animated stage, driving the sprite's frame cursor. */
  animFrames: number;
  /**
   * Who struck the felling blow, so the coins go to them when the collapse
   * finishes. Null for a tree that is not coming down.
   */
  feller: HumanPlayer | CatPlayer | null;
}

export interface Stump {
  tileX: number;
  tileY: number;
  life: number;
}

/**
 * The map-side half of one tree, which the tile owns rather than this system.
 *
 * A felled tree is felled *on the GameMap*: its tile stops being `TREE`
 * altogether. Rewinding `health` alone would leave the system believing in a
 * tree that the world has already turned into grass, so the checkpoint has to
 * carry the tile too.
 */
export interface TreeTileState {
  tileX: number;
  tileY: number;
  treeStage: number | undefined;
  treeAnimFrame: number | undefined;
  groundType: number | undefined;
}

/**
 * A healthy tree's tile has these fields *absent* rather than set to
 * `undefined`, and the renderers read absence — so a restore has to delete
 * them, not write undefined over them.
 */
function applyTreeTileState(tile: TileContent, state: TreeTileState): void {
  if (state.treeStage === undefined) delete tile.treeStage;
  else tile.treeStage = state.treeStage;

  if (state.treeAnimFrame === undefined) delete tile.treeAnimFrame;
  else tile.treeAnimFrame = state.treeAnimFrame;

  if (state.groundType === undefined) delete tile.groundType;
  else tile.groundType = state.groundType;
}

/** Everything a safe-room checkpoint has to rewind about the forest. */
export interface TreeCheckpoint {
  health: ReadonlyMap<string, TreeHealth>;
  stumps: ReadonlyArray<Stump>;
  burning: ReadonlySet<string>;
  felling: ReadonlySet<string>;
  flashing: ReadonlySet<string>;
  felledSinceDrain: number;
  treeTiles: ReadonlyArray<TreeTileState>;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

const EMBER_SHADES = ['#ffd24a', '#ff8a1e', '#e2450f'] as const;

/** A uniform random number in [-1, 1]. */
const bipolarRandom = () => Math.random() * 2 - 1;

const DAMAGED_REBUILD_HP = Math.max(1, Math.round(TREE_HP * TREE_DAMAGED_HP_FRACTION));

function startingHpFor(stage: number): number {
  if (stage === TREE_STAGE_CHARRED) return CHARRED_TREE_HP;
  // A tree already wearing its damaged art must not rebuild at full health:
  // `treeStage` lives on the GameMap, which outlives this system, so an
  // undamaged rebuild would leave a half-dead tree showing damaged art. A tree
  // rebuilt in its late burn is treated the same — the fire has been eating it
  // for seven seconds and it should not come back sound.
  if (stage === TREE_STAGE_DAMAGED || stage === TREE_STAGE_BURNING_LATE) {
    return DAMAGED_REBUILD_HP;
  }
  return TREE_HP;
}

function maxHpFor(stage: number): number {
  return stage === TREE_STAGE_CHARRED ? CHARRED_TREE_HP : TREE_HP;
}

/**
 * The Level 3 forest as a gameplay object: trees take damage and come down,
 * catch fire from magic missiles and explosives, burn themselves out into
 * charred husks, and scorch anyone who stands against one while it burns.
 *
 * Deliberately shaped like `DestructiblePropSystem` — same public verbs, same
 * tile-not-entity model, same lazy health map — so the call sites in
 * `CombatSystem` and `DynamiteSystem` read identically whichever of the two they
 * are talking to. It is a separate system rather than more tile types in that
 * one because the two never coexist: props are built only on dungeon floors,
 * trees only on the overworld.
 *
 * Health is created on the first hit or the first ignition, so a 280×280 map
 * carrying thirty forest blobs costs nothing until something touches one. The
 * per-frame work is likewise bounded by the number of trees that are *alight*,
 * never by the number of trees on the map.
 */
export class TreeSystem implements GameSystem {
  private readonly health = new Map<string, TreeHealth>();
  private readonly stumps: Stump[] = [];
  private readonly embers: Ember[] = [];
  /** Keys of the trees currently alight, so the burn tick never scans the grid. */
  private readonly burning = new Set<string>();
  /** Keys of the trees mid-collapse, for the same reason. */
  private readonly felling = new Set<string>();
  /**
   * Keys of the trees still flashing from a hit. Held separately so the flash
   * tick and the flash draw stay bounded by what is actually flashing: `health`
   * accumulates every tree the player has ever damaged or charred and is never
   * pruned, so iterating it each frame would grow without bound over a session.
   */
  private readonly flashing = new Set<string>();
  private felledSinceDrain = 0;
  private humanContactFrames = 0;
  private catContactFrames = 0;
  private emberSpawnCountdown = 0;
  private glowPulseFrames = 0;

  constructor(
    private readonly gameMap: GameMap,
    private readonly loot: LootSystem,
    private readonly floorNumber: number,
    /**
     * Told whenever a tree tile's appearance changes, so the minimap can
     * repaint it. The minimap caches a tile the first time fog lifts off it and
     * never again, and every tree stage change happens well inside the reveal
     * radius — so without this a felled tree stays forest green on the map and
     * a burnt one is indistinguishable from a living one.
     */
    private readonly onTileChanged: (tileX: number, tileY: number) => void = () => undefined,
  ) {
    this.adoptTreesInProgress();
  }

  /**
   * Picks up trees the previous scene left mid-burn or mid-collapse.
   *
   * The overworld `GameMap` outlives the scene — walking into a town building
   * and back out rebuilds `DungeonScene` around the *same* map (`existingMap`),
   * which is a thing players do constantly. `treeStage` is on the tile and
   * survives that; the health map and the burning set are not and do not. Left
   * alone, a tree that was alight when the player stepped through a doorway
   * would render its `burning` row frozen on one frame for the rest of the
   * session: never reaching `charred`, never hurting anyone, never going out.
   * That would break §5.7's one hard guarantee — that a fire always terminates
   * at `charred` — from outside the state machine's reach.
   *
   * Scanning the whole map is O(map) exactly once per scene, which is the same
   * order the decoration index already pays, and only on the overworld.
   *
   * A burn picked up here restarts its stage timer rather than resuming mid-way.
   * The elapsed time is not recorded anywhere, and a fresh timer is both simpler
   * and kinder than the alternative of guessing.
   */
  private adoptTreesInProgress(): void {
    const structure = this.gameMap.structure;
    for (let ty = 0; ty < structure.length; ty++) {
      const row = structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const tile = row[tx];
        if (tile.type !== TREE) continue;
        const stage = tile.treeStage;
        if (stage === undefined) continue;

        if (isFellingStage(stage)) {
          // Finished on the spot rather than resumed. Whoever swung the axe
          // belongs to a scene that no longer exists, so there is nobody to pay
          // and no reason to hold the tile blocked for another half second.
          this.finishFelling(this.healthFor(tx, ty));
          continue;
        }
        if (stage === TREE_STAGE_BURNING || stage === TREE_STAGE_BURNING_LATE) {
          this.healthFor(tx, ty);
          this.burning.add(tileKey(tx, ty));
        }
      }
    }
    // Trees the player never saw fall must not fire the break cue the moment
    // they walk back out of a shop.
    this.felledSinceDrain = 0;
  }

  /**
   * Resolve a melee swing against every tree in range. Returns true if at least
   * one was struck, which is what lets a swing that connects only with bark
   * still play the solid hit cue.
   */
  tryMeleeHit(attacker: HumanPlayer | CatPlayer, range: number, damage: number): boolean {
    return this.damageTreesInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      range,
      damage,
      attacker,
      { x: attacker.facingX, y: attacker.facingY },
    );
  }

  /**
   * Resolve an area attack against every tree inside its radius. No facing cone:
   * a stomp comes down on everything around the player, behind them included.
   */
  tryAreaHit(attacker: HumanPlayer | CatPlayer, radius: number, damage: number): boolean {
    return this.damageTreesInRange(
      attacker.x + HALF_TILE,
      attacker.y + HALF_TILE,
      radius,
      damage,
      attacker,
      null,
    );
  }

  /**
   * Resolve a projectile impact at a world point. Returns true if it struck a
   * tree, which the caller uses both to detonate the projectile and to roll for
   * ignition.
   */
  tryProjectileHit(
    x: number,
    y: number,
    radius: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
  ): boolean {
    return this.damageTreesInRange(x, y, radius, damage, owner, null);
  }

  /**
   * Flatten every tree inside a blast, whatever health it had left.
   *
   * Deliberately not line-of-sight gated, unlike a swing or a missile. `TREE` is
   * non-walkable and `paintForests` fills its blobs solid, so a sight test from
   * the blast's centre is blocked by the front rank of trees and spares almost
   * everything behind them — measured on a real forest, 4 of 28 trees inside the
   * radius came down and the other 24 were merely set alight by the ignite ring
   * that follows. §1.7 is explicit that dynamite *always* destroys every tree in
   * its radius, and a blast has no line of sight to respect anyway.
   */
  destroyInRadius(x: number, y: number, radius: number, owner: HumanPlayer | CatPlayer): boolean {
    return this.damageTreesInRange(x, y, radius, INSTANT_DESTROY_DAMAGE, owner, null, false);
  }

  /**
   * Set one tree alight. A no-op on anything that is not a standing, unlit tree
   * — igniting a fire that is already burning, a husk with nothing left to burn,
   * or a tree already on its way down all mean the same thing here.
   */
  igniteAt(tileX: number, tileY: number): void {
    const structure = this.gameMap.structure;
    if (tileY < 0 || tileY >= structure.length) return;
    const row = structure[tileY];
    if (tileX < 0 || tileX >= row.length) return;
    const tile = row[tileX];
    if (tile.type !== TREE) return;
    const stage = tile.treeStage ?? TREE_STAGE_HEALTHY;
    if (stage !== TREE_STAGE_HEALTHY && stage !== TREE_STAGE_DAMAGED) return;

    const health = this.healthFor(tileX, tileY);
    health.stage = TREE_STAGE_BURNING;
    health.stageFrames = 0;
    health.animFrames = 0;
    tile.treeStage = TREE_STAGE_BURNING;
    tile.treeAnimFrame = 0;
    this.burning.add(tileKey(tileX, tileY));
    this.onTileChanged(tileX, tileY);
  }

  /**
   * Set alight every tree whose centre falls inside a radius.
   *
   * Used for the ring of trees just outside a blast. It is also the seam a
   * future ambient fire-spread would call from — deliberately *not* called from
   * the burn tick today, because a forest that spreads fire on its own is a
   * different feature with a different set of balance questions.
   */
  igniteRadius(centerX: number, centerY: number, radius: number): void {
    this.forEachTreeInRange(centerX, centerY, radius, (tileX, tileY) => {
      this.igniteAt(tileX, tileY);
    });
  }

  /**
   * Snapshots the forest so a death rewinds every tree the player damaged, lit
   * or felled since they entered the safe room.
   *
   * Every container is copied on the way out and again on the way back in
   * (`restoreCheckpoint`), including the `TreeHealth` *values* — one snapshot is
   * restored once per death, and handing the stored objects to the live map
   * would let the first restore's gameplay mutate the snapshot itself.
   *
   * The tile sweep is O(map) and runs once per safe-room entry, the same order
   * and the same rarity as the constructor's `adoptTreesInProgress`. Only tiles
   * that *are* trees at capture time are recorded: nothing in the game plants
   * one, so a tile that is not a tree now can never become one to be rewound.
   */
  captureCheckpoint(): TreeCheckpoint {
    const health = new Map<string, TreeHealth>();
    for (const [key, tree] of this.health) health.set(key, { ...tree });
    return {
      health,
      stumps: this.stumps.map((stump) => ({ ...stump })),
      burning: new Set(this.burning),
      felling: new Set(this.felling),
      flashing: new Set(this.flashing),
      felledSinceDrain: this.felledSinceDrain,
      treeTiles: this.captureTreeTiles(),
    };
  }

  private captureTreeTiles(): TreeTileState[] {
    const tiles: TreeTileState[] = [];
    const structure = this.gameMap.structure;
    for (let ty = 0; ty < structure.length; ty++) {
      const row = structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const tile = row[tx];
        if (tile.type !== TREE) continue;
        tiles.push({
          tileX: tx,
          tileY: ty,
          treeStage: tile.treeStage,
          treeAnimFrame: tile.treeAnimFrame,
          groundType: tile.groundType,
        });
      }
    }
    return tiles;
  }

  restoreCheckpoint(snapshot: TreeCheckpoint): void {
    this.health.clear();
    for (const [key, tree] of snapshot.health) this.health.set(key, { ...tree });

    this.stumps.length = 0;
    for (const stump of snapshot.stumps) this.stumps.push({ ...stump });

    restoreKeySet(this.burning, snapshot.burning);
    restoreKeySet(this.felling, snapshot.felling);
    restoreKeySet(this.flashing, snapshot.flashing);
    this.felledSinceDrain = snapshot.felledSinceDrain;

    this.restoreTreeTiles(snapshot.treeTiles);
  }

  /**
   * Puts the map back under the rewound system: a tree felled after the
   * checkpoint has to stand again, and one burnt after it has to go back to
   * whatever stage it was at.
   */
  private restoreTreeTiles(treeTiles: ReadonlyArray<TreeTileState>): void {
    for (const state of treeTiles) {
      const tile = this.gameMap.structure[state.tileY][state.tileX];
      const isUnchanged =
        tile.type === TREE &&
        tile.treeStage === state.treeStage &&
        tile.treeAnimFrame === state.treeAnimFrame &&
        tile.groundType === state.groundType;
      if (isUnchanged) continue;

      tile.type = TREE;
      applyTreeTileState(tile, state);
      this.gameMap.markTileDirty(state.tileX, state.tileY);
      this.onTileChanged(state.tileX, state.tileY);
    }
  }

  /** Trees felled since the scene last drained them, for the break cue. */
  drainFelled(): number {
    const felled = this.felledSinceDrain;
    this.felledSinceDrain = 0;
    return felled;
  }

  /**
   * Walks every `TREE` tile whose centre lies within `range` of a world point.
   *
   * Brute-scans a square tile window the way the prop system does. That is fine
   * here for the same reason: the window is a handful of tiles across, and the
   * alternative — an index of every tree on a 280×280 map — would cost far more
   * to keep current than the scan costs to run.
   */
  private forEachTreeInRange(
    originX: number,
    originY: number,
    range: number,
    visit: (tileX: number, tileY: number, distance: number) => void,
  ): void {
    const originTileX = Math.floor(originX / TILE_SIZE);
    const originTileY = Math.floor(originY / TILE_SIZE);
    const searchRadiusTiles = Math.ceil(range / TILE_SIZE) + 1;

    const structure = this.gameMap.structure;
    const firstTileY = Math.max(0, originTileY - searchRadiusTiles);
    const lastTileY = Math.min(structure.length - 1, originTileY + searchRadiusTiles);

    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      const row = structure[ty];
      const firstTileX = Math.max(0, originTileX - searchRadiusTiles);
      const lastTileX = Math.min(row.length - 1, originTileX + searchRadiusTiles);
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        if (row[tx].type !== TREE) continue;
        const centerX = (tx + TILE_CENTER_OFFSET) * TILE_SIZE;
        const centerY = (ty + TILE_CENTER_OFFSET) * TILE_SIZE;
        const distance = Math.hypot(centerX - originX, centerY - originY);
        if (distance > range) continue;
        visit(tx, ty, distance);
      }
    }
  }

  private healthFor(tileX: number, tileY: number): TreeHealth {
    const key = tileKey(tileX, tileY);
    const existing = this.health.get(key);
    if (existing !== undefined) return existing;
    const stage = this.gameMap.structure[tileY][tileX].treeStage ?? TREE_STAGE_HEALTHY;
    const created: TreeHealth = {
      tileX,
      tileY,
      hp: startingHpFor(stage),
      maxHp: maxHpFor(stage),
      hitFlashFrames: 0,
      stage,
      stageFrames: 0,
      animFrames: 0,
      feller: null,
    };
    this.health.set(key, created);
    return created;
  }

  private damageTreesInRange(
    originX: number,
    originY: number,
    range: number,
    damage: number,
    owner: HumanPlayer | CatPlayer,
    facing: { x: number; y: number } | null,
    requiresLineOfSight = true,
  ): boolean {
    let hitAnything = false;
    this.forEachTreeInRange(originX, originY, range, (tx, ty, distance) => {
      const centerX = (tx + TILE_CENTER_OFFSET) * TILE_SIZE;
      const centerY = (ty + TILE_CENTER_OFFSET) * TILE_SIZE;
      // Same forward hemisphere the mob filter uses, so trees and mobs answer to
      // the same swing. A tree at zero distance never reaches the dot product —
      // it is inside point-blank range by definition — so there is nothing to
      // guard against dividing by, and skipping it outright would leave a blast
      // dropped dead on a tree's own centre sparing that one tree.
      if (facing !== null && distance > MELEE_POINT_BLANK_RANGE) {
        const dot =
          ((centerX - originX) / distance) * facing.x + ((centerY - originY) / distance) * facing.y;
        if (dot <= 0) return;
      }
      // Melee reaches nearly two tiles, far enough to clip a tree through a
      // wall. The tree's own tile is named as exempt so the test stays correct
      // however the ray decides to treat its end tile.
      if (
        requiresLineOfSight &&
        !this.gameMap.hasLineOfSight(originX, originY, centerX, centerY, { tileX: tx, tileY: ty })
      ) {
        return;
      }

      const health = this.healthFor(tx, ty);
      // A tree already coming down cannot be hit again: it is no longer an
      // obstacle so much as an animation, and a second felling would pay the
      // loot out twice.
      if (isFellingStage(health.stage)) return;

      hitAnything = true;
      health.hp -= damage;
      health.hitFlashFrames = HIT_FLASH_FRAMES;
      this.flashing.add(tileKey(tx, ty));

      if (health.hp <= 0) {
        this.beginFelling(health, owner);
        return;
      }
      // Only a healthy tree visibly cracks. A burning or charred one already has
      // art of its own, and overwriting it with `damaged` would put the fire out
      // on the strength of a punch.
      if (
        health.stage === TREE_STAGE_HEALTHY &&
        health.hp <= health.maxHp * TREE_DAMAGED_HP_FRACTION
      ) {
        health.stage = TREE_STAGE_DAMAGED;
        this.gameMap.structure[ty][tx].treeStage = TREE_STAGE_DAMAGED;
        this.onTileChanged(tx, ty);
      }
    });
    return hitAnything;
  }

  private beginFelling(health: TreeHealth, feller: HumanPlayer | CatPlayer): void {
    // A tree with nothing green left comes down as a husk. `burning_late` counts
    // as burnt out for this: its crown is already consumed, so dropping it as a
    // leafy tree would be the same inversion.
    const wasBurntOut =
      health.stage === TREE_STAGE_CHARRED || health.stage === TREE_STAGE_BURNING_LATE;
    health.stage = wasBurntOut ? TREE_STAGE_FELLING_CHARRED : TREE_STAGE_FELLING;
    health.feller = feller;
    health.stageFrames = 0;
    health.animFrames = 0;
    const key = tileKey(health.tileX, health.tileY);
    // A tree that is coming down has stopped burning, whatever lit it: the
    // `felling` row carries no flames, and leaving the key in `burning` would
    // keep scorching a player standing beside a tree that is already timber.
    this.burning.delete(key);
    this.felling.add(key);
    const tile = this.gameMap.structure[health.tileY][health.tileX];
    tile.treeStage = health.stage;
    tile.treeAnimFrame = 0;
  }

  private finishFelling(health: TreeHealth): void {
    const { tileX, tileY, feller } = health;
    const tile = this.gameMap.structure[tileY][tileX];
    tile.type = tile.groundType ?? inferFloorType(this.gameMap.structure, tileX, tileY);
    delete tile.treeStage;
    delete tile.treeAnimFrame;
    delete tile.groundType;
    this.gameMap.markTileDirty(tileX, tileY);
    this.onTileChanged(tileX, tileY);
    this.health.delete(tileKey(tileX, tileY));
    this.flashing.delete(tileKey(tileX, tileY));

    this.stumps.push({ tileX, tileY, life: STUMP_LIFETIME_FRAMES });
    while (this.stumps.length > MAX_STUMPS) this.dropOldestStump();

    this.felledSinceDrain++;

    if (feller === null) return;
    this.loot.addLoot(
      (tileX + TILE_CENTER_OFFSET) * TILE_SIZE,
      (tileY + TILE_CENTER_OFFSET) * TILE_SIZE,
      { coins: randomInt(this.floorNumber, this.floorNumber + TREE_COIN_SPREAD), items: [] },
      feller,
      false,
      // Both crawlers are paid in full rather than splitting the drop, matching
      // how a smashed prop pays out.
      true,
    );
  }

  /**
   * Drop the stump closest to expiry. Cannot just shift the head off: `update`
   * retires expired entries by swapping the last one into their slot, so the
   * array is not in age order.
   */
  private dropOldestStump(): void {
    let oldestIndex = 0;
    for (let i = 1; i < this.stumps.length; i++) {
      if (this.stumps[i].life < this.stumps[oldestIndex].life) oldestIndex = i;
    }
    this.stumps.splice(oldestIndex, 1);
  }

  update(ctx: SystemContext): void {
    this.glowPulseFrames++;
    for (const key of this.flashing) {
      const health = this.health.get(key);
      if (health === undefined) {
        this.flashing.delete(key);
        continue;
      }
      health.hitFlashFrames--;
      if (health.hitFlashFrames <= 0) this.flashing.delete(key);
    }

    this.tickBurning();
    this.tickFelling();
    this.tickContactDamage(ctx.human, ctx.cat);
    this.tickEmbers();
  }

  /**
   * Advances the burn state machine. Iterates the burning set rather than the
   * map, so a forest of ten thousand trees with two alight costs two visits.
   *
   * The machine always terminates at `charred`: fire never destroys a tree by
   * itself, it leaves a husk for something else to knock over.
   */
  private tickBurning(): void {
    // Iterated directly rather than over a copy: the loop only ever *removes*
    // from the set, and a JS Set iterator tolerates deletion of an entry it has
    // already reached. Adding during iteration would not be safe, and nothing
    // here adds.
    for (const key of this.burning) {
      const health = this.health.get(key);
      if (health === undefined) {
        this.burning.delete(key);
        continue;
      }
      const tile = this.gameMap.structure[health.tileY][health.tileX];
      if (tile.type !== TREE) {
        this.burning.delete(key);
        continue;
      }

      health.stageFrames++;
      health.animFrames++;
      tile.treeAnimFrame = animFrameIndex(health.animFrames);

      if (health.stage === TREE_STAGE_BURNING && health.stageFrames >= BURNING_FRAMES) {
        health.stage = TREE_STAGE_BURNING_LATE;
        health.stageFrames = 0;
        tile.treeStage = TREE_STAGE_BURNING_LATE;
        continue;
      }
      if (health.stage === TREE_STAGE_BURNING_LATE && health.stageFrames >= BURNING_LATE_FRAMES) {
        health.stage = TREE_STAGE_CHARRED;
        health.stageFrames = 0;
        health.maxHp = CHARRED_TREE_HP;
        health.hp = Math.min(health.hp, CHARRED_TREE_HP);
        tile.treeStage = TREE_STAGE_CHARRED;
        tile.treeAnimFrame = 0;
        this.burning.delete(key);
        this.onTileChanged(health.tileX, health.tileY);
      }
    }
  }

  private tickFelling(): void {
    // The felling set, not the whole health map: the map holds every tree the
    // player has ever damaged or burnt, and only a handful are ever falling.
    // Safe to iterate directly for the reason `tickBurning` gives.
    for (const key of this.felling) {
      const health = this.health.get(key);
      if (health === undefined) {
        this.felling.delete(key);
        continue;
      }
      health.stageFrames++;
      health.animFrames++;
      const tile = this.gameMap.structure[health.tileY][health.tileX];
      tile.treeAnimFrame = animFrameIndex(health.animFrames);
      if (health.stageFrames >= FELLING_TOTAL_FRAMES) {
        this.felling.delete(key);
        this.finishFelling(health);
      }
    }
  }

  /**
   * Damage for standing against a burning tree.
   *
   * The accumulator resets the moment contact breaks, which is what makes the
   * one-second burn delay mean "a second of unbroken contact" rather than "a
   * second of total exposure across the whole fight".
   */
  private tickContactDamage(human: HumanPlayer, cat: CatPlayer): void {
    this.humanContactFrames = this.tickContactFor(human, this.humanContactFrames);
    this.catContactFrames = this.tickContactFor(cat, this.catContactFrames);
  }

  private tickContactFor(player: Player, contactFrames: number): number {
    if (!player.isAlive || !this.isTouchingFire(player)) return 0;

    const frames = contactFrames + 1;
    // Damage lands on the very first frame of contact — `frames` starts at 1,
    // and 1 % 30 is not 0, so the modulus alone would delay the first hit by
    // half a second. Touching fire hurts immediately.
    if (frames === 1 || frames % TREE_CONTACT_DAMAGE_INTERVAL === 0) {
      player.takeDamage(TREE_CONTACT_DAMAGE, TREE_CONTACT_DAMAGE_SOURCE);
      player.damageFlash = TREE_CONTACT_DAMAGE_FLASH_FRAMES;
    }
    if (frames === TREE_CONTACT_BURN_DELAY) player.applyStatus(makeBurn());
    return frames;
  }

  private isTouchingFire(player: Player): boolean {
    const centerX = player.x + HALF_TILE;
    const centerY = player.y + HALF_TILE;
    for (const key of this.burning) {
      const health = this.health.get(key);
      if (health === undefined) continue;
      const treeX = (health.tileX + TILE_CENTER_OFFSET) * TILE_SIZE;
      const treeY = (health.tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
      if (Math.hypot(treeX - centerX, treeY - centerY) <= TREE_CONTACT_RADIUS) return true;
    }
    return false;
  }

  private tickEmbers(): void {
    this.emberSpawnCountdown--;
    if (this.emberSpawnCountdown <= 0) {
      this.emberSpawnCountdown = EMBER_SPAWN_INTERVAL_FRAMES;
      for (const key of this.burning) {
        if (this.embers.length >= MAX_EMBERS) break;
        const health = this.health.get(key);
        if (health === undefined) continue;
        this.spawnEmber(health);
      }
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const ember = this.embers[i];
      ember.x += ember.vx;
      ember.y += ember.vy;
      ember.life--;
      if (ember.life <= 0) {
        this.embers[i] = this.embers[this.embers.length - 1];
        this.embers.pop();
      }
    }

    for (let i = this.stumps.length - 1; i >= 0; i--) {
      this.stumps[i].life--;
      if (this.stumps[i].life <= 0) {
        this.stumps[i] = this.stumps[this.stumps.length - 1];
        this.stumps.pop();
      }
    }
  }

  private spawnEmber(health: TreeHealth): void {
    const life = randomInt(EMBER_LIFETIME_MIN, EMBER_LIFETIME_MAX);
    this.embers.push({
      x:
        (health.tileX + TILE_CENTER_OFFSET) * TILE_SIZE +
        bipolarRandom() * EMBER_SPAWN_SPREAD_TILES * TILE_SIZE,
      y: (health.tileY + TILE_CENTER_OFFSET) * TILE_SIZE - EMBER_SPAWN_HEIGHT_TILES * TILE_SIZE,
      vx: bipolarRandom() * EMBER_DRIFT_MAX,
      vy: -(EMBER_RISE_SPEED_MIN + Math.random() * (EMBER_RISE_SPEED_MAX - EMBER_RISE_SPEED_MIN)),
      size: EMBER_SIZE_MIN + Math.random() * (EMBER_SIZE_MAX - EMBER_SIZE_MIN),
      life,
      maxLife: life,
    });
  }

  /**
   * The pool of light a burning tree throws on the ground, plus the stumps
   * felled ones leave behind. Both belong under the entities rather than over
   * them: firelight lies on the ground the player is standing on, and drawn in
   * the effects pass it washed flat orange over their sprite instead.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderFireGlow(ctx, camX, camY);
    this.renderStumps(ctx, camX, camY);
  }

  private renderFireGlow(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // Culled per tree. The update path is bounded to the trees that are actually
    // alight, but a stick of dynamite lights a whole ring of them and each one
    // would otherwise cost a fresh radial gradient every frame for the full
    // twelve seconds of its burn — including long after the player has walked
    // away from it.
    const onScreen = viewportBounds(camX, camY);
    const pulse =
      1 +
      Math.sin((this.glowPulseFrames / FIRE_GLOW_PULSE_PERIOD_FRAMES) * TWO_PI) *
        FIRE_GLOW_PULSE_DEPTH;
    for (const key of this.burning) {
      const health = this.health.get(key);
      if (health === undefined) continue;
      if (!onScreen(health.tileX * TILE_SIZE, health.tileY * TILE_SIZE)) continue;
      const sx = (health.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
      const sy = (health.tileY + TILE_CENTER_OFFSET) * TILE_SIZE - camY;
      const radius = FIRE_GLOW_RADIUS_PX * pulse;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      glow.addColorStop(0, FIRE_GLOW_CENTER_COLOR);
      glow.addColorStop(1, FIRE_GLOW_EDGE_COLOR);
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderStumps(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const onScreen = viewportBounds(camX, camY);
    for (const stump of this.stumps) {
      if (!onScreen(stump.tileX * TILE_SIZE, stump.tileY * TILE_SIZE)) continue;
      const alpha = stump.life < STUMP_FADE_FRAMES ? stump.life / STUMP_FADE_FRAMES : 1;
      drawSpriteKey(
        ctx,
        'tree_remains',
        'idle',
        0,
        stump.tileX * TILE_SIZE - camX,
        stump.tileY * TILE_SIZE - camY,
        TILE_SIZE,
        { alpha },
      );
    }
  }

  /**
   * Fire effects drawn over the world: the sparks coming off a burning tree and
   * the flash on one that has just been struck. The ground-level glow is in
   * `renderGround` instead, under the entities.
   */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const onScreen = viewportBounds(camX, camY);
    for (const key of this.flashing) {
      const health = this.health.get(key);
      if (health === undefined) continue;
      if (!onScreen(health.tileX * TILE_SIZE, health.tileY * TILE_SIZE)) continue;
      const flash = (health.hitFlashFrames / HIT_FLASH_FRAMES) * HIT_FLASH_MAX_ALPHA;
      const sx = (health.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
      // Struck up the trunk rather than in the middle of the tile it stands on.
      const sy = (health.tileY + TILE_CENTER_OFFSET - HIT_FLASH_HEIGHT_TILES) * TILE_SIZE - camY;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, HIT_FLASH_RADIUS_PX);
      glow.addColorStop(0, `rgba(255,240,210,${flash})`);
      glow.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.save();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, HIT_FLASH_RADIUS_PX, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    for (const ember of this.embers) {
      if (!onScreen(ember.x, ember.y)) continue;
      const fade = ember.life / ember.maxLife;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle =
        EMBER_SHADES[
          Math.min(EMBER_SHADES.length - 1, Math.floor((1 - fade) * EMBER_SHADES.length))
        ];
      ctx.fillRect(ember.x - camX, ember.y - camY, ember.size, ember.size);
      ctx.restore();
    }
  }
}

/**
 * Refill a live key set from a snapshot's. Refilled rather than reassigned
 * because the live sets are `readonly` fields, and copied rather than adopted so
 * a later restore of the same snapshot still sees the keys it captured.
 */
function restoreKeySet(live: Set<string>, snapshot: ReadonlySet<string>): void {
  live.clear();
  for (const key of snapshot) live.add(key);
}

/** A predicate for "this world point is near enough the camera to be worth drawing". */
function viewportBounds(camX: number, camY: number): (x: number, y: number) => boolean {
  const left = camX - EFFECT_CULL_MARGIN_PX;
  const top = camY - EFFECT_CULL_MARGIN_PX;
  const right = camX + viewportWidth() + EFFECT_CULL_MARGIN_PX;
  const bottom = camY + viewportHeight() + EFFECT_CULL_MARGIN_PX;
  return (x, y) => x >= left && x <= right && y >= top && y <= bottom;
}

/** True for either of the two collapse stages. */
function isFellingStage(stage: number): boolean {
  return stage === TREE_STAGE_FELLING || stage === TREE_STAGE_FELLING_CHARRED;
}

/** The frame a looping tree animation is on, given how long it has been running. */
function animFrameIndex(animFrames: number): number {
  return Math.floor(animFrames / FRAMES_PER_ANIM_STEP) % TREE_ANIM_FRAME_COUNT;
}
