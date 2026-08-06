/**
 * Owns every boulder a rock golem has thrown, from the moment it leaves the
 * fists to the rubble burst where it lands.
 *
 * It is a system rather than state on the creature for one reason. A mob stops
 * being updated and stops being drawn the frame it dies — `MobUpdateLoop` skips
 * the dead, and kill resolution drops them out of the spatial grid the renderer
 * queries. A rock owned by the golem therefore vanished in mid-air the instant
 * the player landed the killing blow, which reads as the game eating the shot.
 * A boulder already in the air does not care what happened to the thing that
 * threw it, and neither does this.
 *
 * The golems queue their throws and this drains them, so nothing has to be
 * injected into a mob at spawn time.
 */

import type { DamageSource, Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import { Mob } from '../creatures/Mob';
import { ROCK_THROW_ATTACK_TYPE } from '../creatures/rockGolemAttackTypes';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawGolemRock, drawGolemRockBurst } from '../sprites/golemRockSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/**
 * Anything that throws boulders. Structural rather than `instanceof RockGolem`
 * because the hired bruiser mercenary shares the golem's attack kit without
 * sharing its class — the requirement is that a hired meat shield fights the
 * same way, and a nominal check would silently strand its rocks in its queue.
 */
export interface GolemRockThrower {
  takePendingThrows(): readonly GolemRockThrow[];
}

function isRockThrower(mob: Mob): mob is Mob & GolemRockThrower {
  return 'takePendingThrows' in mob && typeof mob.takePendingThrows === 'function';
}

/** One boulder, as the golem hands it over. */
export interface GolemRockThrow {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** Damage on a direct hit, already scaled for the thrower's level. */
  readonly damage: number;
  /** Class name of the golem that threw it, so the death screen can name it. */
  readonly mobType: string;
  /**
   * Whoever the golem was aiming at, when that is not one of the two players.
   * Mobs can be made hostile to each other, and a golem will happily lock onto
   * such a target; without carrying it here the rock flies straight through the
   * thing it was aimed at.
   */
  readonly aimedAt: Player | null;
  /**
   * Whoever threw it, excluded from its own shot.
   *
   * A hired bruiser is itself in the scene's extra-target list, and the boulder
   * spawns about half a tile from its own centre — well inside the direct-hit
   * radius. Without this the merc's ranged attack was a self-damage button that
   * detonated on the frame it was fired.
   */
  readonly thrower: Player | null;
  /**
   * Who gets the kill if the rock finishes something off, and whose side the
   * thrower is on. Null for a wild golem, the hiring player for a bruiser.
   *
   * A hired golem throws from four to nine tiles while leashed two to three
   * tiles from the person who paid for it, so its boulder crosses them on the
   * way out — an ally's shot must not be able to hit the party.
   */
  readonly owner: Player | null;
}

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  spin: number;
  damage: number;
  source: DamageSource;
  /** Source used for the impact rubble, which is not the same injury. */
  burstSource: DamageSource;
  aimedAt: Player | null;
  thrower: Player | null;
  owner: Player | null;
  /**
   * The mob that threw it, so a hit can be recorded against it. Named apart from
   * `thrower` and `owner`, which are the *player-like* views of the same throw —
   * the self-hit exclusion and the kill-credit holder respectively.
   *
   * The whole point of this system is that a boulder outlives its golem, so this
   * may well reference a dead mob — which is fine, it is only ever read to note
   * blood. Held here rather than on the golem precisely because a projectile
   * stored on a mob is deleted in mid-air when that mob dies.
   */
  attacker: Mob;
}

interface Burst {
  readonly x: number;
  readonly y: number;
  tick: number;
}

/**
 * Faster than a player walks (`PLAYER_SPEED` is 2.5), which is what makes the
 * shot land at all. At 1.3 it travelled at half a walking pace across five to
 * nine tiles — two to three seconds of flight against a hit radius a moving
 * player clears in nine frames — so it could not hit anything that was not
 * standing still.
 *
 * The dodge window is the fifty-six frame pick-up, not the flight: the golem
 * hauls a boulder off the ground in front of you and you move before it throws.
 */
const ROCK_SPEED = 3;
const ROCK_RADIUS_PX = 9;
/** How close a target's centre must be for a direct hit, as a fraction of a tile. */
const TARGET_CENTER_RADIUS_RATIO = 0.4;
const CENTER_OFFSET = 0.5;
/** Radians the boulder tumbles per frame in flight. */
const ROCK_SPIN_RATE = 0.16;

/**
 * Frames a rock may fly before it is dropped, so a throw that somehow never
 * meets a wall cannot live forever. It is *dropped*, not detonated — a burst
 * out in the open would put shrapnel damage on ground nothing ever hit.
 */
const ROCK_MAX_AGE = 260;

const BURST_FRAMES = 22;
/** Radius the shatter itself damages within, in tiles. */
const BURST_RADIUS_TILES = 1;
const BURST_DAMAGE = 1;

/** Live bursts beyond this are dropped; a wall of golems missing is the case bounded. */
const MAX_BURSTS = 16;

export class RockThrowSystem implements GameSystem {
  private rocks: Rock[] = [];
  private bursts: Burst[] = [];

  /** Set when a rock lands; `DungeonScene` reads and clears it to play the crack. */
  burstSoundPending = false;

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectThrows(ctx.mobs);
    this.advanceRocks(ctx);
    this.advanceBursts();
  }

  /**
   * Drains every golem's pending throws.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: a golem that throws and is killed in the same frame is skipped by
   * every activation-radius query from the next frame on, and its rock would be
   * stranded in a queue forever.
   */
  private collectThrows(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!isRockThrower(mob)) continue;
      for (const thrown of mob.takePendingThrows()) {
        const heading = normalize(thrown.dirX, thrown.dirY);
        this.rocks.push({
          x: thrown.x,
          y: thrown.y,
          vx: heading.x * ROCK_SPEED,
          vy: heading.y * ROCK_SPEED,
          age: 0,
          spin: 0,
          damage: thrown.damage,
          source: { kind: 'mob', mobType: thrown.mobType, attackType: ROCK_THROW_ATTACK_TYPE },
          burstSource: {
            kind: 'mob',
            mobType: thrown.mobType,
            attackType: ROCK_THROW_ATTACK_TYPE,
            undodgeable: true,
          },
          aimedAt: thrown.aimedAt,
          thrower: thrown.thrower,
          owner: thrown.owner,
          attacker: mob,
        });
      }
    }
  }

  private advanceRocks(ctx: SystemContext): void {
    const survivors: Rock[] = [];
    for (const rock of this.rocks) {
      rock.age++;
      rock.spin += ROCK_SPIN_RATE;
      if (rock.age > ROCK_MAX_AGE) continue;

      // The wall test runs before the move so the burst sits on open floor
      // rather than inside the tile it would have entered.
      const nextX = rock.x + rock.vx;
      const nextY = rock.y + rock.vy;
      if (!this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE))) {
        this.land(rock, this.targetsFor(ctx, rock));
        continue;
      }
      rock.x = nextX;
      rock.y = nextY;

      const hit = this.directHit(rock, this.targetsFor(ctx, rock));
      if (hit !== null) {
        this.strike(rock, hit, rock.damage, rock.source);
        this.land(rock, this.targetsFor(ctx, rock), hit);
        continue;
      }
      survivors.push(rock);
    }
    this.rocks = survivors;
  }

  private directHit(rock: Rock, targets: readonly Player[]): Player | null {
    const radius = ROCK_RADIUS_PX + TILE_SIZE * TARGET_CENTER_RADIUS_RATIO;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(rock.x - cx, rock.y - cy) <= radius) return target;
    }
    return null;
  }

  private land(rock: Rock, targets: readonly Player[], directHit?: Player): void {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({ x: rock.x, y: rock.y, tick: BURST_FRAMES });
    this.burstSoundPending = true;

    const radius = TILE_SIZE * BURST_RADIUS_TILES;
    for (const target of targets) {
      // Whoever the rock actually hit has already taken the full throw damage;
      // charging them the shrapnel as well means a direct hit quietly costs
      // more than the tuned number says it does.
      if (!target.isAlive || target === directHit) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(rock.x - cx, rock.y - cy) > radius) continue;
      this.strike(rock, target, BURST_DAMAGE, rock.burstSource);
    }
  }

  /**
   * Lands damage on one victim.
   *
   * A `Mob` goes through `takeDamageFrom`, not `takeDamage`. The plain call does
   * register the death now, but it credits nobody: it is the route for a burn or
   * a poison tick, which have no owner by the time they land. A thrown rock has
   * one, and `takeDamageFrom` is what puts the thrower in the ledger the XP split
   * reads. That is the *normal* case for a hired bruiser, whose whole job is
   * throwing rocks at mobs.
   */
  private strike(rock: Rock, target: Player, damage: number, source: DamageSource): void {
    if (target instanceof Mob) {
      // Falls back to the thrower when there is no owner. A wild golem's rock
      // passed `null` here, which leaves `damageTakenBy` empty: the kill lands
      // in nobody's ledger — no XP share and no loot recipient — and the victim
      // registers no attacker to retaliate against.
      //
      // Typed `melee` rather than `missile` on purpose: `missile` kills credited
      // to the cat grant Magic Missile ability XP and, past level 15, fire a
      // free magic shockwave — from a spell nobody cast. A hired bruiser's owner
      // is reassigned to whichever crawler is active every frame, so that was
      // reachable simply by playing as the cat. Blunt impact is also the truer
      // description of a boulder.
      target.takeDamageFrom(damage, rock.owner ?? rock.thrower, 'melee');
      return;
    }
    const connected = target.takeDamage(damage, source);
    if (connected) rock.attacker.noteStruckPlayer(target);
  }

  /**
   * Everything this rock can hit: the two players, the scene's extra
   * player-like targets (Mongo, hired mercenaries) and whatever the golem was
   * actually aiming at. Restricted to the players alone, a golem fighting a
   * mercenary throws straight through them into the far wall forever.
   */
  private targetsFor(ctx: SystemContext, rock: Rock): readonly Player[] {
    const targets: Player[] = [];
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for the same reason, and a stray burst
     * would lose a quest the player was winning.
     */
    const consider = (candidate: Player): void => {
      if (candidate.isDefendTarget === true) return;
      if (candidate === rock.thrower) return;
      if (!targets.includes(candidate)) targets.push(candidate);
    };
    // A rock thrown by an ally only ever hits what it was aimed at. The party
    // and its other hirelings are never candidates — a bruiser standing three
    // tiles from its employer would otherwise put every boulder through them.
    if (rock.owner === null) {
      consider(ctx.human);
      consider(ctx.cat);
      if (ctx.extraTargets) {
        for (const extra of ctx.extraTargets) consider(extra);
      }
    }
    if (rock.aimedAt !== null) consider(rock.aimedAt);
    return targets;
  }

  private advanceBursts(): void {
    for (const burst of this.bursts) burst.tick--;
    this.bursts = this.bursts.filter((burst) => burst.tick > 0);
  }

  /** Rocks and bursts draw over creatures so a shot never hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const burst of this.bursts) {
      drawGolemRockBurst(
        ctx,
        burst.x - camX,
        burst.y - camY,
        TILE_SIZE,
        1 - burst.tick / BURST_FRAMES,
      );
    }
    for (const rock of this.rocks) {
      drawGolemRock(ctx, rock.x - camX, rock.y - camY, TILE_SIZE, rock.spin);
    }
  }

  /** A checkpoint restore must not resume a rock thrown in the run that died. */
  resetForCheckpoint(): void {
    this.rocks = [];
    this.bursts = [];
    this.burstSoundPending = false;
  }
}
