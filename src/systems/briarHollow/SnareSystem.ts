/**
 * SnareSystem — what a set snare does when a hostile steps on it.
 *
 * Every hostile whose feet are on the snare's tile at that moment is caught
 * and rooted for {@link SNARE_HOLD_FRAMES}: held where it stands, still
 * swinging at whatever it can reach, still shoved by a boulder. A spiked
 * snare cuts each one as the builder's own blow would, on the spring and
 * again halfway through the hold. Friends — crawlers, companions, soldiers,
 * cows, villagers — walk over it freely.
 *
 * Each spring has a {@link SNARE_BREAK_CHANCE} of snapping the snare. The
 * hold it has already caught still runs its course, and then the snare is
 * broken (and, once it has been repaired before, may be ruined for good —
 * `DefenseStructures.breakSnare` rolls that). A snare that held without
 * breaking re-arms after {@link SNARE_REARM_FRAMES}.
 *
 * At the builder's Construction 15 each non-boss caught has a chance to be
 * turned instead of held (`ConvertedAllyController`); a turn is still the
 * snare's use, so it is rolled for a break all the same.
 *
 * Holds are moments, not saved state: a door visit starts every snare set.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Mob } from '../../creatures/Mob';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { isConvertible } from '../../creatures/convertibleMobs';
import type { MobRoster } from '../kits/SceneWorld';
import type { AudioManager } from '../../audio/AudioManager';
import type { CrawlerKind } from '../../core/SkillManager';
import type { SnareStructureRecord } from '../../core/briarHollowState';
import { snareConvertChance } from '../../core/craftPerks';
import type { SnareLook } from '../../sprites/art/snareArt';
import { drawSnareBinding } from '../../sprites/art/snareArt';
import { crawlerMeleeStrikeDamage } from '../CombatSystem';
import { type DefenseStructures, structureKey } from './DefenseStructures';
import type { ConvertedAllyController } from './ConvertedAllyController';
import type { StructureCallouts } from './structureCallouts';
import { SNARE_HOLD_SECONDS, UPDATES_PER_SECOND } from './structureRules';

/** How long a snare holds what it catches. */
export const SNARE_HOLD_FRAMES = SNARE_HOLD_SECONDS * UPDATES_PER_SECOND;
/** How long it holds a boss: the same today, kept apart so bosses can be tuned alone. */
export const SNARE_BOSS_HOLD_FRAMES = SNARE_HOLD_SECONDS * UPDATES_PER_SECOND;
/** Chance each spring has of snapping the snare once its hold is done. */
export const SNARE_BREAK_CHANCE = 0.25;
/** Updates a snare that held without breaking takes to set itself again. */
export const SNARE_REARM_FRAMES = UPDATES_PER_SECOND;
/** A spiked snare cuts its catch on the spring and again this far through the hold. */
const SPIKE_SECOND_STRIKE_FRACTION = 0.5;

const SNARE_TRIGGER_SOUND = 'slash_strike_1';
const HALF_TILE = TILE_SIZE / 2;
/** A body's feet sit this far down its tile, where the noose is drawn round them. */
const FEET_DEPTH_TILES = 0.85;

interface SnareHold {
  phase: 'holding' | 'rearming';
  /** Updates since the spring (holding) or left until set again (rearming). */
  frames: number;
  readonly holdFrames: number;
  /** What rooted this hold's catch, so it can let exactly them go. */
  readonly token: object;
  readonly caught: Mob[];
  readonly breaks: boolean;
  readonly builtBy: CrawlerKind;
  readonly spiked: boolean;
  readonly tileX: number;
  readonly tileY: number;
}

/** A spring, as a gate reads it. */
export interface SnareSpring {
  readonly key: string;
  readonly caught: readonly Mob[];
  readonly converted: readonly Mob[];
  readonly breaks: boolean;
}

export interface SnareSystemDeps {
  readonly defense: DefenseStructures;
  readonly roster: MobRoster;
  readonly audio: AudioManager | null;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly constructionLevel: (crawler: CrawlerKind) => number;
  readonly allies: ConvertedAllyController;
  readonly callouts: StructureCallouts;
  /** Uniform [0, 1) for the break roll; injectable so a gate can seed it. */
  readonly random?: () => number;
  /** Uniform [0, 1) for the conversion roll, on its own stream so it never shifts the break roll. */
  readonly convertRandom?: () => number;
}

/** The tile a body's feet are on: the same point the ground's footing speed is read at. */
export function feetTile(body: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.floor((body.x + HALF_TILE) / TILE_SIZE),
    y: Math.floor((body.y + HALF_TILE) / TILE_SIZE),
  };
}

export class SnareSystem {
  private readonly deps: SnareSystemDeps;
  private readonly holds = new Map<string, SnareHold>();
  private timeSeconds = 0;
  /** Every spring since the system was built, newest last; a gate drains it. */
  readonly springLog: SnareSpring[] = [];
  private static readonly SPRING_LOG_LIMIT = 256;

  constructor(deps: SnareSystemDeps) {
    this.deps = deps;
  }

  private crawler(kind: CrawlerKind): HumanPlayer | CatPlayer {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  /** How a snare should look this frame. */
  lookFor(record: SnareStructureRecord): SnareLook {
    if (record.broken) return 'broken';
    return this.holds.has(structureKey(record.x, record.y)) ? 'sprung' : 'set';
  }

  /** Whether a snare is set and would spring on the next hostile. */
  isSet(record: SnareStructureRecord): boolean {
    return !record.broken && !this.holds.has(structureKey(record.x, record.y));
  }

  update(): void {
    this.timeSeconds += 1 / UPDATES_PER_SECOND;
    const live = new Set<string>();
    for (const record of this.deps.defense.snares) {
      const key = structureKey(record.x, record.y);
      live.add(key);
      const hold = this.holds.get(key);
      if (hold !== undefined) {
        this.advanceHold(key, record, hold);
        continue;
      }
      if (record.broken) continue;
      const caught = this.hostilesOn(record.x, record.y);
      if (caught.length > 0) this.spring(key, record, caught);
    }
    // A snare dismantled or ruined mid-hold lets go of whatever it held.
    for (const [key, hold] of [...this.holds]) {
      if (live.has(key)) continue;
      this.release(hold);
      this.holds.delete(key);
    }
  }

  /** Every hostile whose feet are on the tile. Only hostiles: friends step over a snare freely. */
  private hostilesOn(tileX: number, tileY: number): Mob[] {
    const caught: Mob[] = [];
    const centreX = tileX * TILE_SIZE + HALF_TILE;
    const centreY = tileY * TILE_SIZE + HALF_TILE;
    // The grid holds top-left corners; half a tile up and left of the centre
    // finds every body whose feet could be on the tile.
    for (const mob of this.deps.roster.grid.queryCircle(
      centreX - HALF_TILE,
      centreY - HALF_TILE,
      TILE_SIZE,
    )) {
      if (!mob.isAlive || !mob.isHostile || mob.isFlying) continue;
      const feet = feetTile(mob);
      if (feet.x === tileX && feet.y === tileY) caught.push(mob);
    }
    return caught;
  }

  private spring(key: string, record: SnareStructureRecord, caught: Mob[]): void {
    const random = this.deps.random ?? Math.random;
    const convertRandom = this.deps.convertRandom ?? Math.random;
    const breaks = random() < SNARE_BREAK_CHANCE;
    const builder = this.crawler(record.builtBy);
    const convertChance = snareConvertChance(this.deps.constructionLevel(record.builtBy));
    const spiked = record.spikesHp !== null && record.spikesHp > 0;
    const token = {};
    const held: Mob[] = [];
    const converted: Mob[] = [];
    let holdFrames = 0;
    for (const mob of caught) {
      const turns = convertChance > 0 && isConvertible(mob) && convertRandom() < convertChance;
      if (turns && this.deps.allies.convert(mob, builder)) {
        converted.push(mob);
        continue;
      }
      const frames = mob.isBoss ? SNARE_BOSS_HOLD_FRAMES : SNARE_HOLD_FRAMES;
      mob.root(frames, token);
      holdFrames = Math.max(holdFrames, frames);
      held.push(mob);
    }
    this.deps.audio?.play(SNARE_TRIGGER_SOUND);
    const hold: SnareHold = {
      phase: 'holding',
      frames: 0,
      holdFrames,
      token,
      caught: held,
      breaks,
      builtBy: record.builtBy,
      spiked,
      tileX: record.x,
      tileY: record.y,
    };
    this.holds.set(key, hold);
    this.springLog.push({ key, caught: [...held], converted, breaks });
    if (this.springLog.length > SnareSystem.SPRING_LOG_LIMIT) this.springLog.shift();
    if (spiked) this.strike(hold);
    // Everything it caught was turned: nothing to hold, so it is spent at once.
    if (held.length === 0) this.endHold(key, hold);
  }

  private advanceHold(key: string, record: SnareStructureRecord, hold: SnareHold): void {
    if (hold.phase === 'rearming') {
      hold.frames--;
      if (hold.frames <= 0) this.holds.delete(key);
      return;
    }
    // Wrecked under its catch — a blast, or an undead's claws: the rope is gone.
    if (record.broken) {
      this.release(hold);
      this.holds.delete(key);
      return;
    }
    // Everything it held is dead: nothing left to hold, so it is spent now
    // rather than standing sprung over a corpse.
    if (!hold.caught.some((mob) => mob.isAlive && mob.rootedBy === hold.token)) {
      this.endHold(key, hold);
      return;
    }
    hold.frames++;
    const secondStrikeAt = Math.round(hold.holdFrames * SPIKE_SECOND_STRIKE_FRACTION);
    if (hold.spiked && hold.frames === secondStrikeAt) this.strike(hold);
    if (hold.frames >= hold.holdFrames) this.endHold(key, hold);
  }

  /** The hold is over: let the catch go, then break or re-arm. */
  private endHold(key: string, hold: SnareHold): void {
    this.release(hold);
    if (!hold.breaks) {
      hold.phase = 'rearming';
      hold.frames = SNARE_REARM_FRAMES;
      return;
    }
    this.holds.delete(key);
    this.deps.defense.breakSnare(key);
    if (this.deps.defense.snare(key) === null) {
      this.deps.callouts.add(
        'The snare is ruined',
        hold.tileX * TILE_SIZE + HALF_TILE,
        hold.tileY * TILE_SIZE,
      );
    }
  }

  private release(hold: SnareHold): void {
    for (const mob of hold.caught) mob.releaseRoot(hold.token);
  }

  /** The spikes cut everything still held, as the builder's own blow would. */
  private strike(hold: SnareHold): void {
    const builder = this.crawler(hold.builtBy);
    if (builder.zeroDamage) return;
    for (const mob of hold.caught) {
      if (!mob.isAlive || mob.rootedBy !== hold.token) continue;
      // Struck by nothing that swung: it cannot be guarded, and a kill trains no weapon skill.
      mob.takeCreditedDamage(crawlerMeleeStrikeDamage(builder), builder, null, null);
    }
  }

  /** The noose round every caught body's feet, drawn over the body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const hold of this.holds.values()) {
      if (hold.phase !== 'holding') continue;
      for (const mob of hold.caught) {
        if (!mob.isAlive || mob.rootedBy !== hold.token) continue;
        drawSnareBinding(
          ctx,
          mob.x + HALF_TILE - camX,
          mob.y + FEET_DEPTH_TILES * TILE_SIZE - camY,
          hold.tileX * TILE_SIZE - camX,
          hold.tileY * TILE_SIZE - camY,
          TILE_SIZE,
          this.timeSeconds,
        );
      }
    }
  }

  /** A door visit or a rewind: every hold is let go and every snare starts set. */
  reset(): void {
    for (const hold of this.holds.values()) this.release(hold);
    this.holds.clear();
  }
}
