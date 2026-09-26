/**
 * DefenseStructures — every wall segment, trebuchet and snare the village has,
 * and the gate: their HP, spikes, breaches and gaps, and what the map looks
 * like because of them.
 *
 * The single source of truth is `BriarHollowState.structures`. This class is a
 * stateless façade over it: it owns no copy, and it re-applies the state to
 * the `GameMap` idempotently (palisade tiles, breach rubble, trebuchet
 * footprints) whenever it is built and whenever the state is swapped out
 * underneath it. That one path is what keeps a door visit, a death rewind and
 * a page reload all showing the same village.
 *
 * A palisade segment with no record is the fence the village was generated
 * with, at full health. Records exist only for segments someone has touched,
 * which keeps an untouched ring out of the save entirely.
 *
 * ## For siege code
 *
 * Everything that hurts a structure goes through {@link DefenseStructures.damage}
 * (or {@link DefenseStructures.blastInRadius}); nothing writes HP directly.
 * The model a siege plans against:
 *
 * - {@link DefenseStructures.at} names the structure on a tile. Hostiles attack
 *   what stands between them and their goal: a `segment` still at a tier, a
 *   `trebuchet`, a `snare`, or the `gate`.
 * - A wall at 0 HP becomes a **breach**: its tiles turn to walkable rubble at
 *   once (`HOLLOW_PALISADE_GAP`), hostile A* searches around it are dropped so
 *   they re-plan through the hole, and it stays open until repaired. A fence at
 *   0 HP becomes a plain **gap**. {@link DefenseStructures.isOpening} answers
 *   "can a body walk through this segment now".
 * - The gate never takes damage and never lets a hostile through. Striking it
 *   shakes it and records {@link DefenseStructures.gateStruckAtSeconds}.
 * - The `bell` is the Hollow Bell on its tower in the square: what the assault
 *   is fought to protect. Its health lives in the quest state, it takes no
 *   spikes, it can be repaired with boards, and it can never be dismantled.
 * - Spikes absorb damage before the structure, and a melee attacker takes its
 *   own blow back as thorns, credited to whoever added them.
 */

import type { GameMap } from '../../map/GameMap';
import {
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  type PalisadeTier,
  type TileContent,
} from '../../map/tileTypes';
import {
  SEGMENT_TILES,
  type BriarHollowSite,
  type PalisadeSegmentDef,
} from '../../map/overworld/briarHollowSite';
import type {
  BriarHollowState,
  SegmentStructureRecord,
  SnareStructureRecord,
  StructureRecord,
  TrebuchetStructureRecord,
} from '../../core/briarHollowState';
import type { CrawlerKind } from '../../core/SkillManager';
import type { EventBus } from '../../core/EventBus';
import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import type { Player } from '../../Player';
import type { Mob } from '../../creatures/Mob';
import type { MobRoster } from '../kits/SceneWorld';
import type { ResourceCost } from '../../core/partyResources';
import { constructionHpMultiplier } from '../../core/craftPerks';
import { TILE_SIZE } from '../../core/constants';
import { tileCoordKey, tileKeyX, tileKeyY } from '../../map/tileIndex';
import {
  DAMAGE_STAGE_INTACT,
  FENCE_HP,
  NEXT_WALL_TIER,
  REPAIR_CHUNKS_PER_FULL_REPAIR,
  SNARE_BASE_HP,
  SNARE_PERMANENT_BREAK_CHANCE,
  SNARE_REPAIR_COST,
  SPIKES_BASE_HP,
  SPIKES_COST,
  SPIKES_THORNS_MAX_SHARE,
  STRUCTURE_BLAST_DAMAGE,
  TREBUCHET_BASE_HP,
  TREBUCHET_HEIGHT_TILES,
  TREBUCHET_WIDTH_TILES,
  WALL_TIERS,
  damageStageFor,
  repairChunks,
  scaleCost,
  scaledMaxHp,
  trebuchetRepairCost,
  wallSegmentHp,
} from './structureRules';
import {
  HOLLOW_BELL_FOOTPRINT_TILES,
  HOLLOW_BELL_DAMAGE_TAKEN_SCALE,
  HOLLOW_BELL_MAX_BLOW_SHARE,
  HOLLOW_BELL_MAX_HP,
  HOLLOW_BELL_REPAIR_CHUNK_COST,
} from './hollowBell';

// ── Public types ────────────────────────────────────────────────────────────

/** Names one structure. Trebuchets and snares are keyed by their north-west tile. */
export type StructureRef =
  | { readonly kind: 'segment'; readonly id: string }
  | { readonly kind: 'trebuchet'; readonly key: string }
  | { readonly kind: 'snare'; readonly key: string }
  | { readonly kind: 'gate' }
  | { readonly kind: 'bell' };

/**
 * What delivered a blow. `melee` from a hostile is reflected by spikes;
 * `ranged` and `blast` only wear them down; `player` is a crawler's own melee,
 * which can only ever flatten a fence.
 */
export type StructureDamageSource = 'melee' | 'ranged' | 'blast' | 'player';

/** A tile rectangle, as structures occupy them. */
export interface TileFootprint {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DefenseStructuresDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly roster: MobRoster;
  /** The crawler's own Construction level (0 when unlearned). */
  readonly constructionLevel: (crawler: CrawlerKind) => number;
  /** The crawler a structure's thorns are credited to. */
  readonly crawler: (crawler: CrawlerKind) => Player;
  /** Told of every tile whose type changed, so the minimap can repaint it. */
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /** Seconds of village life, for {@link DefenseStructures.gateStruckAtSeconds}. */
  readonly clockSeconds: () => number;
  /** Uniform [0, 1); injectable so a gate can make the snare's permanent break deterministic. */
  readonly random?: () => number;
}

/** How far around a changed wall hostile mobs forget their route, so they re-plan through a breach or around a repair. */
export const REPATH_RADIUS_TILES = 20;

/** Seconds the gate shakes after a blow. */
export const GATE_SHAKE_SECONDS = 0.35;

const FENCE_BREAK_SOUND = 'fence_break';
const WOOD_WALL_BREAK_SOUND = 'wall_break_wood';
const STONE_WALL_BREAK_SOUND = 'wall_break_stone';
const WOOD_WALL_HIT_SOUND = 'wall_hit_wood';
const STONE_WALL_HIT_SOUND = 'wall_hit_stone';
const GATE_THUD_SOUND = 'gate_thud';
const SPIKES_IMPALE_SOUND = 'spikes_impale';
const TREBUCHET_BREAK_SOUND = 'trebuchet_break';
const SNARE_BREAK_SOUND = 'snare_break';
const DISMANTLE_SOUND = 'structure_dismantle';

const BELL_REF: StructureRef = { kind: 'bell' };

/** Key for a trebuchet or snare at its north-west tile. */
export function structureKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

/** The tiles a trebuchet whose north-west tile is (x, y) stands on. */
export function trebuchetFootprint(x: number, y: number): TileFootprint {
  return { x, y, w: TREBUCHET_WIDTH_TILES, h: TREBUCHET_HEIGHT_TILES };
}

/** Every tile in a footprint, row by row. */
export function footprintTiles(footprint: TileFootprint): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      tiles.push({ x: footprint.x + dx, y: footprint.y + dy });
    }
  }
  return tiles;
}

/** Distance from a point to the nearest point of a tile rectangle, in pixels. */
function distanceToFootprintPx(px: number, py: number, footprint: TileFootprint): number {
  const left = footprint.x * TILE_SIZE;
  const top = footprint.y * TILE_SIZE;
  const right = left + footprint.w * TILE_SIZE;
  const bottom = top + footprint.h * TILE_SIZE;
  const dx = Math.max(left - px, 0, px - right);
  const dy = Math.max(top - py, 0, py - bottom);
  return Math.hypot(dx, dy);
}

const HALF_TILE = TILE_SIZE / 2;

/** The tile at (x, y), or undefined off the grid. */
function contentAt(structure: TileContent[][], x: number, y: number): TileContent | undefined {
  if (y < 0 || y >= structure.length) return undefined;
  const row = structure[y];
  return x >= 0 && x < row.length ? row[x] : undefined;
}

export class DefenseStructures {
  private readonly deps: DefenseStructuresDeps;
  private readonly segmentById = new Map<string, PalisadeSegmentDef>();
  /** Palisade and gate tiles → the segment that owns them, keyed by `tileCoordKey`. */
  private readonly segmentByTile = new Map<number, PalisadeSegmentDef>();
  private readonly gateTileKeys = new Set<number>();
  private readonly bellFootprint: TileFootprint;
  /**
   * Footprints a construction job has reserved but not yet finished. Held here,
   * not in the saved state, because a job that never finishes never happened;
   * they are folded into the map's structure blocks alongside real trebuchets.
   */
  private readonly reservations = new Map<string, TileFootprint>();
  /** The `state.structures` array the map was last synced against; a restore swaps it. */
  private syncedStructures: readonly StructureRecord[] | null = null;
  private gateShakeSecondsLeft = 0;
  private _gateStruckAtSeconds: number | null = null;

  constructor(deps: DefenseStructuresDeps) {
    this.deps = deps;
    for (const segment of deps.site.segments) {
      this.segmentById.set(segment.id, segment);
      for (const tile of segment.tiles) {
        this.segmentByTile.set(tileCoordKey(tile.x, tile.y), segment);
      }
    }
    for (const gate of deps.site.gates) {
      for (const tile of gate.tiles) this.gateTileKeys.add(tileCoordKey(tile.x, tile.y));
    }
    const bellTile = deps.site.square.bellTile;
    this.bellFootprint = {
      x: bellTile.x,
      y: bellTile.y,
      w: HOLLOW_BELL_FOOTPRINT_TILES,
      h: HOLLOW_BELL_FOOTPRINT_TILES,
    };
    this.syncMap();
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  get segments(): readonly PalisadeSegmentDef[] {
    return this.deps.site.segments;
  }

  /** When the gate was last struck, on the village clock, or null if never this scene. */
  get gateStruckAtSeconds(): number | null {
    return this._gateStruckAtSeconds;
  }

  /** 0–1 remaining of the gate's shake after a blow. */
  get gateShake(): number {
    return this.gateShakeSecondsLeft / GATE_SHAKE_SECONDS;
  }

  isGateTile(tileX: number, tileY: number): boolean {
    return this.gateTileKeys.has(tileCoordKey(tileX, tileY));
  }

  /** The segment a palisade or gap tile belongs to, or null. */
  segmentAtTile(tileX: number, tileY: number): PalisadeSegmentDef | null {
    return this.segmentByTile.get(tileCoordKey(tileX, tileY)) ?? null;
  }

  /** Whether a tile is under the bell tower. */
  isBellTile(tileX: number, tileY: number): boolean {
    const bell = this.bellFootprint;
    return tileX >= bell.x && tileY >= bell.y && tileX < bell.x + bell.w && tileY < bell.y + bell.h;
  }

  /** The bell tower's tiles. */
  get bellTiles(): ReadonlyArray<{ x: number; y: number }> {
    return footprintTiles(this.bellFootprint);
  }

  /** The Hollow Bell's health now. */
  get bellHp(): number {
    return this.deps.state.quest.bellHp;
  }

  /** Whether the bell has been beaten down to nothing. */
  get bellCracked(): boolean {
    return this.deps.state.quest.bellHp <= 0;
  }

  /**
   * Stands the bell back up at full health: the villagers mend their own bell
   * however a siege ends, so a lost assault is never a spiral of ever-weaker
   * retries.
   */
  restoreBell(): void {
    this.deps.state.quest.bellHp = HOLLOW_BELL_MAX_HP;
  }

  /** The one construction on a tile: a segment, a trebuchet, a snare, the gate or the bell. */
  at(tileX: number, tileY: number): StructureRef | null {
    if (this.isGateTile(tileX, tileY)) return { kind: 'gate' };
    if (this.isBellTile(tileX, tileY)) return BELL_REF;
    const segment = this.segmentAtTile(tileX, tileY);
    if (segment !== null) return { kind: 'segment', id: segment.id };
    for (const record of this.deps.state.structures) {
      if (record.kind === 'trebuchet') {
        const footprint = trebuchetFootprint(record.x, record.y);
        if (
          tileX >= footprint.x &&
          tileY >= footprint.y &&
          tileX < footprint.x + footprint.w &&
          tileY < footprint.y + footprint.h
        ) {
          return { kind: 'trebuchet', key: structureKey(record.x, record.y) };
        }
      } else if (record.kind === 'snare' && record.x === tileX && record.y === tileY) {
        return { kind: 'snare', key: structureKey(record.x, record.y) };
      }
    }
    return null;
  }

  /** Whether a construction job has claimed this tile. */
  isReserved(tileX: number, tileY: number): boolean {
    for (const footprint of this.reservations.values()) {
      if (
        tileX >= footprint.x &&
        tileY >= footprint.y &&
        tileX < footprint.x + footprint.w &&
        tileY < footprint.y + footprint.h
      ) {
        return true;
      }
    }
    return false;
  }

  /** A segment's record, created at fence full health the first time anything touches it. */
  private segmentRecord(id: string): SegmentStructureRecord {
    const existing = this.findSegmentRecord(id);
    if (existing !== null) return existing;
    const created: SegmentStructureRecord = {
      kind: 'segment',
      id,
      tier: 'fence',
      hp: FENCE_HP,
      spikesHp: null,
      builtBy: 'human',
    };
    this.deps.state.structures.push(created);
    this.syncedStructures = this.deps.state.structures;
    return created;
  }

  private findSegmentRecord(id: string): SegmentStructureRecord | null {
    for (const record of this.deps.state.structures) {
      if (record.kind === 'segment' && record.id === id) return record;
    }
    return null;
  }

  /** The tier a segment stands at now, including the two fallen states. */
  segmentTier(id: string): SegmentStructureRecord['tier'] {
    return this.findSegmentRecord(id)?.tier ?? 'fence';
  }

  /** The tier a breached segment stood at before it fell, or null when it is not a breach. */
  breachedTier(id: string): PalisadeTier | null {
    const record = this.findSegmentRecord(id);
    if (record?.tier !== 'breach') return null;
    return record.formerTier ?? 'wood';
  }

  trebuchet(key: string): TrebuchetStructureRecord | null {
    for (const record of this.deps.state.structures) {
      if (record.kind === 'trebuchet' && structureKey(record.x, record.y) === key) return record;
    }
    return null;
  }

  snare(key: string): SnareStructureRecord | null {
    for (const record of this.deps.state.structures) {
      if (record.kind === 'snare' && structureKey(record.x, record.y) === key) return record;
    }
    return null;
  }

  get trebuchets(): TrebuchetStructureRecord[] {
    return this.deps.state.structures.filter(
      (record): record is TrebuchetStructureRecord => record.kind === 'trebuchet',
    );
  }

  get snares(): SnareStructureRecord[] {
    return this.deps.state.structures.filter(
      (record): record is SnareStructureRecord => record.kind === 'snare',
    );
  }

  /** The record behind a ref, or null for the gate, an untouched fence, or a ref that no longer exists. */
  record(ref: StructureRef): StructureRecord | null {
    switch (ref.kind) {
      case 'segment':
        return this.findSegmentRecord(ref.id);
      case 'trebuchet':
        return this.trebuchet(ref.key);
      case 'snare':
        return this.snare(ref.key);
      case 'gate':
      case 'bell':
        return null;
    }
  }

  /** Whether the ref still names something that exists. */
  exists(ref: StructureRef): boolean {
    switch (ref.kind) {
      case 'segment':
        return this.segmentById.has(ref.id);
      case 'gate':
      case 'bell':
        return true;
      case 'trebuchet':
      case 'snare':
        return this.record(ref) !== null;
    }
  }

  /** The tiles a structure stands on. */
  footprintOf(ref: StructureRef): ReadonlyArray<{ x: number; y: number }> {
    switch (ref.kind) {
      case 'segment':
        return this.segmentById.get(ref.id)?.tiles ?? [];
      case 'gate':
        return this.deps.site.gates.flatMap((gate) => gate.tiles);
      case 'bell':
        return this.bellTiles;
      case 'trebuchet': {
        const record = this.trebuchet(ref.key);
        return record === null ? [] : footprintTiles(trebuchetFootprint(record.x, record.y));
      }
      case 'snare': {
        const record = this.snare(ref.key);
        return record === null ? [] : [{ x: record.x, y: record.y }];
      }
    }
  }

  /** Whether a body can walk through this segment right now: a breach or a gap. */
  isOpening(id: string): boolean {
    const tier = this.segmentTier(id);
    return tier === 'breach' || tier === 'gap';
  }

  // ── HP ────────────────────────────────────────────────────────────────────

  private builderMultiplier(record: StructureRecord): number {
    return constructionHpMultiplier(this.deps.constructionLevel(record.builtBy));
  }

  /**
   * Max HP: the base for the structure's kind and tier, times the level-15
   * multiplier of the crawler recorded as its builder. A gap has none.
   */
  maxHp(ref: StructureRef): number {
    switch (ref.kind) {
      case 'gate':
        return 0;
      case 'bell':
        return HOLLOW_BELL_MAX_HP;
      case 'segment': {
        const record = this.findSegmentRecord(ref.id);
        if (record === null) return FENCE_HP;
        const tier = record.tier === 'breach' ? (record.formerTier ?? 'wood') : record.tier;
        if (tier === 'gap') return 0;
        if (tier === 'fence') return FENCE_HP;
        const tileCount = this.segmentById.get(ref.id)?.tiles.length ?? SEGMENT_TILES;
        return wallSegmentHp(tier, tileCount) * this.builderMultiplier(record);
      }
      case 'trebuchet': {
        const record = this.trebuchet(ref.key);
        return record === null ? 0 : TREBUCHET_BASE_HP * this.builderMultiplier(record);
      }
      case 'snare': {
        const record = this.snare(ref.key);
        return record === null ? 0 : SNARE_BASE_HP * this.builderMultiplier(record);
      }
    }
  }

  /** Current HP; an untouched fence has its one point. */
  hp(ref: StructureRef): number {
    if (ref.kind === 'gate') return 0;
    if (ref.kind === 'bell') return this.bellHp;
    if (ref.kind === 'segment' && this.findSegmentRecord(ref.id) === null) return FENCE_HP;
    return this.record(ref)?.hp ?? 0;
  }

  /** Spikes' max HP on this structure, which follows its builder's multiplier like the structure's own. */
  spikesMaxHp(ref: StructureRef): number {
    const record = this.record(ref);
    return record === null ? 0 : SPIKES_BASE_HP * this.builderMultiplier(record);
  }

  /**
   * Rescales every structure a crawler built when their HP multiplier moves,
   * so a half-health wall stays at half health. Called on every update, which
   * also catches a level gained while the village was not loaded.
   */
  onConstructionLevelChanged(): void {
    for (const record of this.deps.state.structures) {
      if (record.kind === 'segment' && (record.tier === 'fence' || record.tier === 'gap')) continue;
      const current = this.builderMultiplier(record);
      const stored = record.hpMultiplier ?? 1;
      if (current === stored) continue;
      const ratio = current / stored;
      record.hp *= ratio;
      if (record.spikesHp !== null) record.spikesHp *= ratio;
      record.hpMultiplier = current;
    }
  }

  // ── Damage ────────────────────────────────────────────────────────────────

  /**
   * Deals `amount` to a structure. Spikes take it first and only the
   * overflow reaches the structure; a hostile melee attacker takes its own
   * blow back as thorns. The gate takes nothing and shakes. A crawler's own
   * blow (`'player'`) only ever reaches a fence.
   */
  damage(
    ref: StructureRef,
    amount: number,
    attacker: Mob | null,
    source: StructureDamageSource,
  ): void {
    if (amount <= 0) return;
    if (ref.kind === 'gate') {
      this.strikeGate(attacker);
      return;
    }
    if (ref.kind === 'segment') {
      this.damageSegment(ref.id, amount, attacker, source);
      return;
    }
    if (source === 'player') return;
    if (ref.kind === 'bell') {
      this.damageBell(amount);
      return;
    }
    if (ref.kind === 'trebuchet') {
      const record = this.trebuchet(ref.key);
      if (record === null || record.broken) return;
      const overflow = this.absorbWithSpikes(record, amount, attacker, source);
      if (overflow <= 0) return;
      record.hp = Math.max(0, record.hp - overflow);
      this.emitDamaged('trebuchet', record.x, record.y);
      if (record.hp <= 0) {
        record.broken = true;
        this.deps.audio?.play(TREBUCHET_BREAK_SOUND);
        this.deps.bus.emit('structureDestroyed', { kind: 'trebuchet', permanent: false });
      }
      return;
    }
    const record = this.snare(ref.key);
    if (record === null || record.broken) return;
    record.hp = Math.max(0, record.hp - amount);
    this.emitDamaged('snare', record.x, record.y);
    if (record.hp <= 0) this.breakSnare(ref.key);
  }

  /**
   * Snaps a trebuchet's arm without touching its HP — the chance every throw
   * carries of wrecking the engine. It stays where it stands, keeps its ammo,
   * and owes a repair before it throws again. Returns whether it broke (a
   * trebuchet already broken, or gone, does not).
   */
  breakTrebuchet(key: string): boolean {
    const record = this.trebuchet(key);
    if (record === null || record.broken) return false;
    record.broken = true;
    this.deps.audio?.play(TREBUCHET_BREAK_SOUND);
    this.deps.bus.emit('structureDestroyed', { kind: 'trebuchet', permanent: false });
    return true;
  }

  /** Strikes the gate: it shakes and thuds, and takes no damage. */
  strikeGate(attacker: Mob | null): void {
    this.gateShakeSecondsLeft = GATE_SHAKE_SECONDS;
    this._gateStruckAtSeconds = this.deps.clockSeconds();
    this.playBlowSound(GATE_THUD_SOUND, attacker);
  }

  /**
   * Bell blows: no spikes to soak them, each damped and capped at a share of the bell,
   * and a bell at zero stays at zero until it is restored.
   */
  private damageBell(amount: number): void {
    const quest = this.deps.state.quest;
    if (quest.bellHp <= 0) return;
    const blow = Math.min(
      amount * HOLLOW_BELL_DAMAGE_TAKEN_SCALE,
      HOLLOW_BELL_MAX_HP * HOLLOW_BELL_MAX_BLOW_SHARE,
    );
    quest.bellHp = Math.max(0, quest.bellHp - blow);
    const bell = this.bellFootprint;
    this.deps.bus.emit('structureDamaged', {
      kind: 'bell',
      x: (bell.x + bell.w / 2) * TILE_SIZE,
      y: (bell.y + bell.h / 2) * TILE_SIZE,
    });
    if (quest.bellHp <= 0) {
      this.deps.bus.emit('structureDestroyed', { kind: 'bell', permanent: false });
    }
  }

  private damageSegment(
    id: string,
    amount: number,
    attacker: Mob | null,
    source: StructureDamageSource,
  ): void {
    const tier = this.segmentTier(id);
    if (tier === 'breach' || tier === 'gap') return;
    if (tier === 'fence') {
      const record = this.segmentRecord(id);
      record.hp = 0;
      record.tier = 'gap';
      record.spikesHp = null;
      this.deps.audio?.play(FENCE_BREAK_SOUND);
      this.deps.bus.emit('structureDestroyed', { kind: 'segment', permanent: false });
      this.syncMap();
      this.repathNear(id);
      return;
    }
    // A crawler's own blows never dent a real wall: the ring is not the
    // party's to open.
    if (source === 'player') return;
    const record = this.segmentRecord(id);
    const overflow = this.absorbWithSpikes(record, amount, attacker, source);
    if (overflow <= 0) {
      // Spikes worn through change the wall's look even when the wall itself is untouched.
      this.syncMap();
      return;
    }
    record.hp = Math.max(0, record.hp - overflow);
    const segment = this.segmentById.get(id);
    const anchor = segment?.tiles[0];
    if (anchor !== undefined) this.emitDamaged('segment', anchor.x, anchor.y);
    if (record.hp > 0) {
      this.playBlowSound(tier === 'wood' ? WOOD_WALL_HIT_SOUND : STONE_WALL_HIT_SOUND, attacker);
      this.syncMap();
      return;
    }
    record.formerTier = tier;
    record.tier = 'breach';
    record.spikesHp = null;
    this.deps.audio?.play(tier === 'wood' ? WOOD_WALL_BREAK_SOUND : STONE_WALL_BREAK_SOUND);
    this.deps.bus.emit('structureDestroyed', { kind: 'segment', permanent: false });
    this.syncMap();
    this.repathNear(id);
  }

  /**
   * Spikes take the blow first. Returns what is left over for the structure.
   * A hostile's melee blow comes back at it in full, credited to whoever
   * added the spikes; arrows and blasts only wear the spikes down.
   */
  private absorbWithSpikes(
    record: StructureRecord,
    amount: number,
    attacker: Mob | null,
    source: StructureDamageSource,
  ): number {
    const spikes = record.spikesHp;
    if (spikes === null || spikes <= 0) return amount;
    if (source === 'melee' && attacker !== null && attacker.isHostile && attacker.isAlive) {
      const credited = this.deps.crawler(record.spikesBy ?? 'human');
      const thorns = Math.min(amount, attacker.maxHp * SPIKES_THORNS_MAX_SHARE);
      attacker.takeCreditedDamage(thorns, credited, 'melee', null);
      this.playBlowSound(SPIKES_IMPALE_SOUND, attacker);
    }
    const absorbed = Math.min(spikes, amount);
    const remaining = spikes - absorbed;
    record.spikesHp = remaining > 0 ? remaining : null;
    if (record.spikesHp === null) record.spikesBy = undefined;
    return amount - absorbed;
  }

  /**
   * The sound of one blow landing, when the audio manager can hear the
   * creature that struck it: with a wave at the wall, every swing voiced
   * at once is a roar. What a blow breaks is voiced whoever struck it.
   */
  private playBlowSound(id: SoundId, attacker: Mob | null): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    if (attacker !== null && !audio.hearsCreature(attacker)) return;
    audio.play(id);
  }

  private emitDamaged(kind: 'segment' | 'trebuchet' | 'snare', tileX: number, tileY: number): void {
    this.deps.bus.emit('structureDamaged', {
      kind,
      x: tileX * TILE_SIZE + HALF_TILE,
      y: tileY * TILE_SIZE + HALF_TILE,
    });
  }

  /**
   * Breaks a snare, whether it sprang and snapped or was beaten to 0 HP. A
   * snare that has already been repaired once may be wrecked for good: its
   * record is removed and the materials are lost.
   */
  breakSnare(key: string): void {
    const record = this.snare(key);
    if (record === null) return;
    record.broken = true;
    record.hp = 0;
    this.deps.audio?.play(SNARE_BREAK_SOUND);
    const random = this.deps.random ?? Math.random;
    const permanent = record.repairedOnce && random() < SNARE_PERMANENT_BREAK_CHANCE;
    if (permanent) this.removeRecord(record);
    this.deps.bus.emit('structureDestroyed', { kind: 'snare', permanent });
  }

  /**
   * One dynamite blast: `damage` to every segment with any tile inside the
   * radius (once per segment, however many of its tiles are caught), every
   * trebuchet whose footprint the radius overlaps, and every snare inside it.
   * A blast has no attacker, so spikes soak it but reflect nothing.
   */
  blastInRadius(cx: number, cy: number, radiusPx: number, damage = STRUCTURE_BLAST_DAMAGE): void {
    for (const segment of this.deps.site.segments) {
      const caught = segment.tiles.some(
        (tile) => distanceToFootprintPx(cx, cy, { x: tile.x, y: tile.y, w: 1, h: 1 }) <= radiusPx,
      );
      if (caught) this.damage({ kind: 'segment', id: segment.id }, damage, null, 'blast');
    }
    for (const record of [...this.trebuchets]) {
      const footprint = trebuchetFootprint(record.x, record.y);
      if (distanceToFootprintPx(cx, cy, footprint) <= radiusPx) {
        this.damage(
          { kind: 'trebuchet', key: structureKey(record.x, record.y) },
          damage,
          null,
          'blast',
        );
      }
    }
    for (const record of [...this.snares]) {
      const centreX = record.x * TILE_SIZE + HALF_TILE;
      const centreY = record.y * TILE_SIZE + HALF_TILE;
      if (Math.hypot(centreX - cx, centreY - cy) <= radiusPx) {
        this.damage(
          { kind: 'snare', key: structureKey(record.x, record.y) },
          damage,
          null,
          'blast',
        );
      }
    }
  }

  /**
   * A crawler's melee swing: flattens a fence segment inside the swing's
   * reach and facing, and does nothing to any real wall. Returns whether it
   * struck one, so the swing plays its connecting cue.
   */
  tryMeleeHit(attacker: Player, rangePx: number): boolean {
    const originX = attacker.x + HALF_TILE;
    const originY = attacker.y + HALF_TILE;
    let struck: string | null = null;
    let nearest = Infinity;
    for (const segment of this.deps.site.segments) {
      if (this.segmentTier(segment.id) !== 'fence') continue;
      for (const tile of segment.tiles) {
        const toX = tile.x * TILE_SIZE + HALF_TILE - originX;
        const toY = tile.y * TILE_SIZE + HALF_TILE - originY;
        const distance = Math.hypot(toX, toY);
        if (distance > rangePx + HALF_TILE || distance >= nearest) continue;
        const facing =
          distance === 0 ? 1 : (toX * attacker.facingX + toY * attacker.facingY) / distance;
        if (facing <= 0) continue;
        nearest = distance;
        struck = segment.id;
      }
    }
    if (struck === null) return false;
    // The one section the swing lands on: a blow flattens one hurdle, not the run.
    this.damage({ kind: 'segment', id: struck }, FENCE_HP, null, 'player');
    return true;
  }

  // ── Repair, upgrade, spikes, placement, removal ──────────────────────────

  /**
   * What a full repair costs before the builder's discount, or null when
   * there is nothing to repair. A breach costs the full five chunks of the
   * tier it fell from.
   */
  repairCost(ref: StructureRef): ResourceCost | null {
    switch (ref.kind) {
      case 'gate':
        return null;
      case 'bell': {
        const chunks = repairChunks(HOLLOW_BELL_MAX_HP - this.bellHp, HOLLOW_BELL_MAX_HP);
        return chunks === 0 ? null : scaleCost(HOLLOW_BELL_REPAIR_CHUNK_COST, chunks);
      }
      case 'segment': {
        const record = this.findSegmentRecord(ref.id);
        if (record === null) return null;
        if (record.tier === 'breach') {
          const chunk = WALL_TIERS[record.formerTier ?? 'wood'].repairChunkCost;
          return chunk === null ? null : scaleCost(chunk, REPAIR_CHUNKS_PER_FULL_REPAIR);
        }
        if (record.tier === 'fence' || record.tier === 'gap') return null;
        const chunk = WALL_TIERS[record.tier].repairChunkCost;
        const chunks = repairChunks(this.maxHp(ref) - record.hp, this.maxHp(ref));
        return chunk === null || chunks === 0 ? null : scaleCost(chunk, chunks);
      }
      case 'trebuchet': {
        const record = this.trebuchet(ref.key);
        if (record === null) return null;
        const max = this.maxHp(ref);
        if (!record.broken && record.hp >= max) return null;
        return trebuchetRepairCost(record.hp, max, record.broken);
      }
      case 'snare': {
        const record = this.snare(ref.key);
        if (record === null) return null;
        if (!record.broken && record.hp >= this.maxHp(ref)) return null;
        return { ...SNARE_REPAIR_COST };
      }
    }
  }

  /** The tier a segment upgrades to next, or null (fortified, a breach awaiting repair, a non-segment). */
  upgradeTarget(ref: StructureRef): PalisadeTier | null {
    if (ref.kind !== 'segment') return null;
    const tier = this.segmentTier(ref.id);
    if (tier === 'breach') return null;
    if (tier === 'gap') return 'wood';
    return NEXT_WALL_TIER[tier];
  }

  /** What the next upgrade costs before the builder's discount, or null when there is none. */
  upgradeCost(ref: StructureRef): ResourceCost | null {
    const target = this.upgradeTarget(ref);
    if (target === null) return null;
    const cost = WALL_TIERS[target].upgradeCost;
    return cost === null ? null : { ...cost };
  }

  /** Spikes' cost before discount. The same whether adding or replacing them. */
  spikesCost(): ResourceCost {
    return { ...SPIKES_COST };
  }

  /**
   * Whether "Add Spikes" applies to this structure at all: any standing wall
   * above a fence, and every trebuchet and snare.
   */
  canTakeSpikes(ref: StructureRef): boolean {
    if (ref.kind === 'gate' || ref.kind === 'bell') return false;
    if (ref.kind === 'segment') {
      const tier = this.segmentTier(ref.id);
      return tier === 'wood' || tier === 'stone' || tier === 'fortified';
    }
    return this.record(ref) !== null;
  }

  /** Whether a structure's spikes are missing or worn and can be (re)placed. */
  spikesNeedWork(ref: StructureRef): boolean {
    if (!this.canTakeSpikes(ref)) return false;
    const record = this.record(ref);
    if (record === null) return false;
    return record.spikesHp === null || record.spikesHp < this.spikesMaxHp(ref);
  }

  /** Restores a structure to full health; a breach stands back up at the tier it fell from. */
  applyRepair(ref: StructureRef): void {
    if (ref.kind === 'bell') {
      this.restoreBell();
      this.deps.bus.emit('structureRepaired', { kind: 'bell' });
      return;
    }
    const record = this.record(ref);
    if (record === null) return;
    if (record.kind === 'segment') {
      if (record.tier === 'breach') {
        record.tier = record.formerTier ?? 'wood';
        record.formerTier = undefined;
      }
      if (record.tier === 'fence' || record.tier === 'gap') return;
    }
    record.hpMultiplier = this.builderMultiplier(record);
    record.hp = this.maxHp(ref);
    if (record.kind === 'trebuchet') record.broken = false;
    if (record.kind === 'snare') {
      record.broken = false;
      record.repairedOnce = true;
    }
    this.deps.bus.emit('structureRepaired', { kind: ref.kind });
    this.syncMap();
    if (ref.kind === 'segment') this.repathNear(ref.id);
  }

  /** Raises a segment one tier; the builder becomes the crawler its HP perk follows. */
  applyUpgrade(ref: StructureRef, builder: CrawlerKind): void {
    const target = this.upgradeTarget(ref);
    if (target === null || ref.kind !== 'segment') return;
    const record = this.segmentRecord(ref.id);
    record.tier = target;
    record.formerTier = undefined;
    record.builtBy = builder;
    const multiplier = this.builderMultiplier(record);
    if (record.spikesHp !== null) record.spikesHp *= multiplier / (record.hpMultiplier ?? 1);
    record.hpMultiplier = multiplier;
    // Goes through `maxHp` rather than the tier's flat number, so a segment
    // longer or shorter than the reference length stands up at the right HP.
    record.hp = this.maxHp(ref);
    this.deps.bus.emit('structureBuilt', { kind: 'segment', tier: target });
    this.syncMap();
    this.repathNear(ref.id);
  }

  /** Adds (or renews) spikes at full HP, credited to `builder`. */
  applySpikes(ref: StructureRef, builder: CrawlerKind): void {
    if (!this.canTakeSpikes(ref)) return;
    const record = this.record(ref);
    if (record === null) return;
    record.hpMultiplier = this.builderMultiplier(record);
    record.spikesHp = this.spikesMaxHp(ref);
    record.spikesBy = builder;
    this.deps.bus.emit('structureBuilt', { kind: 'spikes' });
    this.syncMap();
  }

  /** Records a new trebuchet whose north-west tile is (x, y). */
  placeTrebuchet(x: number, y: number, builder: CrawlerKind): StructureRef {
    this.releaseReservation(structureKey(x, y));
    const level = this.deps.constructionLevel(builder);
    const record: TrebuchetStructureRecord = {
      kind: 'trebuchet',
      x,
      y,
      hp: scaledMaxHp(TREBUCHET_BASE_HP, level),
      broken: false,
      ammo: 0,
      spikesHp: null,
      builtBy: builder,
      hpMultiplier: constructionHpMultiplier(level),
    };
    this.deps.state.structures.push(record);
    this.deps.bus.emit('structureBuilt', { kind: 'trebuchet' });
    this.syncMap();
    return { kind: 'trebuchet', key: structureKey(x, y) };
  }

  /** Records a new snare on (x, y). */
  placeSnare(x: number, y: number, builder: CrawlerKind): StructureRef {
    this.releaseReservation(structureKey(x, y));
    const level = this.deps.constructionLevel(builder);
    const record: SnareStructureRecord = {
      kind: 'snare',
      x,
      y,
      hp: scaledMaxHp(SNARE_BASE_HP, level),
      broken: false,
      repairedOnce: false,
      spikesHp: null,
      builtBy: builder,
      hpMultiplier: constructionHpMultiplier(level),
    };
    this.deps.state.structures.push(record);
    this.deps.bus.emit('structureBuilt', { kind: 'snare' });
    this.syncMap();
    return { kind: 'snare', key: structureKey(x, y) };
  }

  /**
   * Dismantles a trebuchet or snare for good: the record goes and its tiles
   * are released. Walls cannot be destroyed — the ring is never opened on
   * purpose — so a segment or the gate is refused.
   */
  destroy(ref: StructureRef): boolean {
    if (ref.kind === 'segment' || ref.kind === 'gate' || ref.kind === 'bell') return false;
    const record = this.record(ref);
    if (record === null) return false;
    this.removeRecord(record);
    this.deps.audio?.play(DISMANTLE_SOUND);
    this.deps.bus.emit('structureDestroyed', { kind: ref.kind, permanent: true });
    return true;
  }

  private removeRecord(record: StructureRecord): void {
    const index = this.deps.state.structures.indexOf(record);
    if (index === -1) return;
    this.deps.state.structures.splice(index, 1);
    this.syncMap();
  }

  /** Claims a footprint for a job in progress, blocking it on the map until released. */
  reserve(key: string, footprint: TileFootprint): void {
    this.reservations.set(key, footprint);
    this.syncStructureBlocks();
  }

  releaseReservation(key: string): void {
    if (!this.reservations.delete(key)) return;
    this.syncStructureBlocks();
  }

  // ── Reach ─────────────────────────────────────────────────────────────────

  /**
   * The nearest structure (gate included) whose tiles come within `reachTiles`
   * of the crawler, of those `accept` lets through.
   */
  nearestInReach(
    active: { x: number; y: number },
    reachTiles: number,
    accept: (ref: StructureRef) => boolean = () => true,
  ): StructureRef | null {
    const originX = active.x + HALF_TILE;
    const originY = active.y + HALF_TILE;
    const reachPx = reachTiles * TILE_SIZE;
    let best: StructureRef | null = null;
    let bestDistance = Infinity;
    const consider = (ref: StructureRef, footprint: TileFootprint): void => {
      const distance = distanceToFootprintPx(originX, originY, footprint);
      if (distance > reachPx || distance >= bestDistance || !accept(ref)) return;
      best = ref;
      bestDistance = distance;
    };
    for (const segment of this.deps.site.segments) {
      for (const tile of segment.tiles) {
        consider({ kind: 'segment', id: segment.id }, { x: tile.x, y: tile.y, w: 1, h: 1 });
      }
    }
    for (const gate of this.deps.site.gates) {
      for (const tile of gate.tiles) {
        consider({ kind: 'gate' }, { x: tile.x, y: tile.y, w: 1, h: 1 });
      }
    }
    for (const record of this.trebuchets) {
      consider(
        { kind: 'trebuchet', key: structureKey(record.x, record.y) },
        trebuchetFootprint(record.x, record.y),
      );
    }
    for (const record of this.snares) {
      consider(
        { kind: 'snare', key: structureKey(record.x, record.y) },
        { x: record.x, y: record.y, w: 1, h: 1 },
      );
    }
    // Only a hurt bell is something to work on; a whole one would stand in
    // front of whatever else the crawler meant at the square.
    if (this.bellHp < HOLLOW_BELL_MAX_HP) consider(BELL_REF, this.bellFootprint);
    return best;
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  update(dtSeconds: number): void {
    if (this.syncedStructures !== this.deps.state.structures) this.syncMap();
    this.onConstructionLevelChanged();
    this.gateShakeSecondsLeft = Math.max(0, this.gateShakeSecondsLeft - dtSeconds);
  }

  // ── Map sync ──────────────────────────────────────────────────────────────

  /**
   * Writes the saved state onto the map: every palisade tile's type, tier and
   * damage look, and every structure block. Only tiles that actually change
   * are rewritten and re-baked, so this is safe to call after every mutation.
   */
  syncMap(): void {
    this.syncedStructures = this.deps.state.structures;
    const structure = this.deps.gameMap.structure;
    for (const segment of this.deps.site.segments) {
      const look = this.segmentLook(segment.id);
      for (const tile of segment.tiles) {
        const content = contentAt(structure, tile.x, tile.y);
        if (content === undefined) continue;
        const unchanged =
          content.type === look.type &&
          content.wallTier === look.wallTier &&
          (content.damageStage ?? DAMAGE_STAGE_INTACT) === look.damageStage &&
          (content.wallSpiked === true) === look.spiked;
        if (unchanged) continue;
        content.type = look.type;
        content.wallTier = look.wallTier;
        content.damageStage =
          look.damageStage === DAMAGE_STAGE_INTACT ? undefined : look.damageStage;
        content.wallSpiked = look.spiked ? true : undefined;
        this.markTileAndNeighboursDirty(tile.x, tile.y);
        this.deps.onTileChanged(tile.x, tile.y);
      }
    }
    for (const gate of this.deps.site.gates) {
      for (const tile of gate.tiles) {
        const content = contentAt(structure, tile.x, tile.y);
        if (content !== undefined && content.type !== HOLLOW_GATE) {
          content.type = HOLLOW_GATE;
          this.markTileAndNeighboursDirty(tile.x, tile.y);
        }
      }
    }
    this.syncStructureBlocks();
  }

  private segmentLook(id: string): {
    type: number;
    wallTier: PalisadeTier | undefined;
    damageStage: number;
    spiked: boolean;
  } {
    const record = this.findSegmentRecord(id);
    if (record === null) {
      return {
        type: HOLLOW_PALISADE,
        wallTier: 'fence',
        damageStage: DAMAGE_STAGE_INTACT,
        spiked: false,
      };
    }
    if (record.tier === 'gap') {
      return {
        type: HOLLOW_PALISADE_GAP,
        wallTier: undefined,
        damageStage: DAMAGE_STAGE_INTACT,
        spiked: false,
      };
    }
    if (record.tier === 'breach') {
      return {
        type: HOLLOW_PALISADE_GAP,
        wallTier: record.formerTier ?? 'wood',
        damageStage: DAMAGE_STAGE_INTACT,
        spiked: false,
      };
    }
    const stage =
      record.tier === 'fence'
        ? DAMAGE_STAGE_INTACT
        : damageStageFor(record.hp, this.maxHp({ kind: 'segment', id }));
    const spiked = record.spikesHp !== null && record.spikesHp > 0;
    return { type: HOLLOW_PALISADE, wallTier: record.tier, damageStage: stage, spiked };
  }

  /** A painter that reads its neighbours needs them re-baked too, or a chunk border keeps a stale seam. */
  private markTileAndNeighboursDirty(tileX: number, tileY: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) this.deps.gameMap.markTileDirty(tileX + dx, tileY + dy);
    }
  }

  private syncStructureBlocks(): void {
    const gameMap = this.deps.gameMap;
    const wanted = new Set<number>();
    const addFootprint = (footprint: TileFootprint): void => {
      for (const tile of footprintTiles(footprint)) wanted.add(tileCoordKey(tile.x, tile.y));
    };
    for (const record of this.trebuchets) addFootprint(trebuchetFootprint(record.x, record.y));
    for (const footprint of this.reservations.values()) addFootprint(footprint);
    for (const key of [...gameMap.structureTileKeys()]) {
      if (!wanted.has(key)) gameMap.unblockStructureTile(tileKeyX(key), tileKeyY(key));
    }
    for (const key of wanted) {
      if (!gameMap.isStructureTile(tileKeyX(key), tileKeyY(key))) {
        gameMap.blockStructureTile(tileKeyX(key), tileKeyY(key));
      }
    }
  }

  /**
   * A cached A* route is only thrown away when a mob asks for a new one, so a
   * route planned before a breach opened (or closed) would otherwise be walked
   * into the wall.
   */
  private repathNear(id: string): void {
    const anchor = this.segmentById.get(id)?.tiles[0];
    if (anchor === undefined) return;
    const centreX = anchor.x * TILE_SIZE + HALF_TILE;
    const centreY = anchor.y * TILE_SIZE + HALF_TILE;
    const nearby = this.deps.roster.grid.queryCircle(
      centreX,
      centreY,
      REPATH_RADIUS_TILES * TILE_SIZE,
    );
    for (const mob of nearby) {
      if (mob.isHostile && mob.isAlive) mob.forceRepath();
    }
  }
}
