/**
 * Owns everything a Lava Llama's spit turns into once it has left the animal:
 * the ball in flight, the burst where it lands, and the fire patch that keeps
 * burning there afterwards.
 *
 * It is a system rather than state on the creature for one reason. A mob stops
 * being updated and stops being drawn the frame it dies — `MobUpdateLoop` skips
 * the dead, and kill resolution drops them out of the spatial grid the renderer
 * queries. A projectile owned by the llama therefore vanished in mid-air the
 * instant the player landed the killing blow, which read as the game eating the
 * shot. Rock already in the air does not care what happened to the animal that
 * spat it, and now neither does the code.
 *
 * The llamas queue their shots and this drains them, so nothing has to be
 * injected into a mob at spawn time.
 */

import type { Player } from '../Player';
import type { DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { Llama } from '../creatures/Llama';
import { makeBurn } from '../core/StatusEffect';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawLavaBolt, drawLavaBurst, drawLavaFlame } from '../sprites/lavaBallSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** One shot, as the llama hands it over. */
export interface LavaSpit {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** Damage the ball deals on a direct hit, already scaled for the mob's level. */
  readonly damage: number;
  /** Class name of the llama that fired it, so the death screen can name it. */
  readonly mobType: string;
  /**
   * Whoever the llama was aiming at, when that is not one of the two players.
   *
   * Mobs can be made hostile to each other (Brindled Vespa acid makes a mob
   * retaliate), and a llama will happily lock onto and wind up at such a
   * target. Without carrying it here the system has no way to know it exists,
   * and the bolt flies straight through the thing it was aimed at.
   */
  readonly aimedAt: Player | null;
}

interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  damage: number;
  source: DamageSource;
  /** Source used for this bolt's impact blast, which is not the same injury. */
  burstSource: DamageSource;
  aimedAt: Player | null;
}

interface Burst {
  readonly x: number;
  readonly y: number;
  tick: number;
}

interface FlamePatch {
  readonly x: number;
  readonly y: number;
  /** Staggers the loop so patches burning together do not animate in lockstep. */
  readonly seed: number;
  tick: number;
}

const BOLT_SPEED = 1.9;
const BOLT_RADIUS_PX = 7;
/** How close a target's centre must be for a direct hit, as a fraction of a tile. */
const TARGET_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;
const BURN_CHANCE = 0.15;
/**
 * Frames a bolt may fly before it is dropped, so a shot that somehow never
 * meets a wall cannot live forever. It is *dropped*, not detonated: a ball that
 * exploded here would go off in mid-air over open floor and leave a fire patch
 * denying ground nothing ever hit.
 */
const BOLT_MAX_AGE = 300;

const BURST_FRAMES = 26;
/** Radius the burst itself damages within, in tiles. Small — it is a *mini* blast. */
const BURST_RADIUS_TILES = 0.8;
const BURST_DAMAGE = 1;

/** Frames a fire patch burns for. Long enough to deny ground, short enough to wait out. */
const FLAME_FRAMES = 330;
/** Frames the patch spends fading in as it catches, and out as it dies. */
const FLAME_RISE_FRAMES = 20;
const FLAME_FADE_FRAMES = 60;
const FLAME_RADIUS_TILES = 0.55;
const FLAME_CONTACT_DAMAGE = 1;
/** Frames between ticks of contact damage while standing in a patch. */
const FLAME_DAMAGE_INTERVAL = 30;
/** Frames of unbroken contact before the patch sets the player alight. */
const FLAME_BURN_DELAY = 60;
const FLAME_DAMAGE_FLASH_FRAMES = 8;

/**
 * No mob is standing in the patch when it burns you — the llama may well be
 * dead — so it is environmental rather than attributed, and `takeDamage` only
 * rolls a dodge against `kind: 'mob'`, which makes it undodgeable for free.
 */
const FLAME_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'lavaFlames' };

/**
 * Live patches beyond this are dropped rather than drawn. A room of llamas all
 * missing into the same corner is the case this bounds.
 */
const MAX_FLAME_PATCHES = 24;

export class LavaBallSystem implements GameSystem {
  private bolts: Bolt[] = [];
  private bursts: Burst[] = [];
  private flames: FlamePatch[] = [];
  private humanContactFrames = 0;
  private catContactFrames = 0;
  /** Incremented per patch so each gets a distinct animation offset. */
  private nextFlameSeed = 0;

  /** Set when a bolt lands; `DungeonScene` reads and clears it to play the boom. */
  burstSoundPending = false;

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectSpits(ctx.mobs);
    this.advanceBolts(ctx);
    this.advanceBursts();
    this.advanceFlames();
    this.humanContactFrames = this.tickContactFor(ctx.human, this.humanContactFrames);
    this.catContactFrames = this.tickContactFor(ctx.cat, this.catContactFrames);
  }

  /**
   * Drains every llama's pending shots.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: a llama that fires and is killed in the same frame is skipped by
   * every activation-radius query from the next frame on, and its shot would be
   * stranded in a queue forever.
   */
  private collectSpits(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof Llama)) continue;
      for (const spit of mob.takePendingSpits()) {
        const heading = normalize(spit.dirX, spit.dirY);
        this.bolts.push({
          x: spit.x,
          y: spit.y,
          vx: heading.x * BOLT_SPEED,
          vy: heading.y * BOLT_SPEED,
          age: 0,
          damage: spit.damage,
          // A ball crossing a room is exactly what dodge is for, so it stays
          // dodgeable. The blast it makes on landing is not — there is no
          // sidestepping an explosion you are already standing in.
          source: { kind: 'mob', mobType: spit.mobType },
          burstSource: { kind: 'mob', mobType: spit.mobType, undodgeable: true },
          aimedAt: spit.aimedAt,
        });
      }
    }
  }

  private advanceBolts(ctx: SystemContext): void {
    const hitRadius = BOLT_RADIUS_PX + TILE_SIZE * TARGET_CENTER_RADIUS_RATIO;
    const survivors: Bolt[] = [];

    for (const bolt of this.bolts) {
      bolt.age++;
      if (bolt.age > BOLT_MAX_AGE) continue;

      const targets = this.targetsFor(ctx, bolt);
      const nextX = bolt.x + bolt.vx;
      const nextY = bolt.y + bolt.vy;
      const tileX = Math.floor(nextX / TILE_SIZE);
      const tileY = Math.floor(nextY / TILE_SIZE);
      if (!this.gameMap.isWalkable(tileX, tileY)) {
        // Landed at the last clear position rather than inside the wall, so the
        // burst and its fire patch sit on floor the player can actually stand on.
        this.land(bolt, targets);
        continue;
      }
      bolt.x = nextX;
      bolt.y = nextY;

      let struck: Player | null = null;
      for (const target of targets) {
        if (!target.isAlive) continue;
        const cx = target.x + TILE_SIZE * CENTER_OFFSET;
        const cy = target.y + TILE_SIZE * CENTER_OFFSET;
        if (Math.hypot(bolt.x - cx, bolt.y - cy) >= hitRadius) continue;
        const connected = target.takeDamage(bolt.damage, bolt.source);
        if (connected && Math.random() < BURN_CHANCE) target.applyStatus(makeBurn());
        struck = target;
        break;
      }
      if (struck !== null) {
        this.land(bolt, targets, struck);
        continue;
      }
      survivors.push(bolt);
    }

    this.bolts = survivors;
  }

  /**
   * Turns a bolt into a burst plus the patch it leaves behind, and applies the
   * blast's splash damage.
   *
   * The splash lands here, on the single frame of impact, rather than over the
   * burst animation: an explosion that keeps dealing damage for the length of
   * its own fireball punishes a player who was already clear of it by the time
   * they could have reacted.
   *
   * `directHit` is whoever the ball struck, if anyone, and is excluded from the
   * splash.
   */
  private land(bolt: Bolt, targets: readonly Player[], directHit?: Player): void {
    const { x, y } = bolt;
    this.bursts.push({ x, y, tick: BURST_FRAMES });
    if (this.flames.length >= MAX_FLAME_PATCHES) this.flames.shift();
    this.flames.push({ x, y, seed: this.nextFlameSeed++, tick: FLAME_FRAMES });
    this.burstSoundPending = true;

    const radius = TILE_SIZE * BURST_RADIUS_TILES;
    for (const target of targets) {
      // Whoever the ball actually hit has already taken the full projectile
      // damage; charging them the splash as well means a direct hit quietly
      // costs more than the tuned number says it does.
      if (!target.isAlive || target === directHit) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      // Attributed to the llama, not to the fire patch: a player killed by the
      // explosion never stood in anything, and the flame source's death line
      // would tell them they burned to death in a puddle.
      target.takeDamage(BURST_DAMAGE, bolt.burstSource);
    }
  }

  /**
   * Everything this bolt can hit.
   *
   * The two players plus the scene's extra player-like targets (Mongo, hired
   * mercenaries) plus whatever the llama was actually aiming at. Restricted to
   * the players alone, a llama fighting a mercenary winds up, fires, and puts
   * the ball straight through them into the far wall — forever, because it
   * keeps its cooldown and never lands a hit.
   */
  private targetsFor(ctx: SystemContext, bolt: Bolt): readonly Player[] {
    const targets: Player[] = [ctx.human, ctx.cat];
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for exactly this reason, and
     * `DefendQuestSystem` fails the quest the instant the NPC dies — so a blast
     * that merely landed near the Goblin Mother would lose a quest the player
     * was winning, from a shot never aimed at her.
     *
     * Applied at the one point anything joins the list, rather than only to the
     * `extraTargets` loop, so no future source of targets can route around it.
     */
    const consider = (candidate: Player): void => {
      if (candidate.isDefendTarget === true) return;
      if (!targets.includes(candidate)) targets.push(candidate);
    };
    if (ctx.extraTargets) {
      for (const extra of ctx.extraTargets) consider(extra);
    }
    if (bolt.aimedAt !== null) consider(bolt.aimedAt);
    return targets;
  }

  private advanceBursts(): void {
    for (const burst of this.bursts) burst.tick--;
    this.bursts = this.bursts.filter((burst) => burst.tick > 0);
  }

  private advanceFlames(): void {
    for (const flame of this.flames) flame.tick--;
    this.flames = this.flames.filter((flame) => flame.tick > 0);
  }

  private isTouchingFlame(player: Player): boolean {
    const cx = player.x + TILE_SIZE * CENTER_OFFSET;
    const cy = player.y + TILE_SIZE * CENTER_OFFSET;
    const radius = TILE_SIZE * FLAME_RADIUS_TILES;
    for (const flame of this.flames) {
      // A patch that is still catching does not burn yet; without this the
      // damage lands a full second before there is any fire drawn to explain it.
      if (flame.tick > FLAME_FRAMES - FLAME_RISE_FRAMES) continue;
      if (Math.hypot(flame.x - cx, flame.y - cy) < radius) return true;
    }
    return false;
  }

  /**
   * One player's contact damage. Returns the new contact-frame count, which the
   * caller stores — contact has to be tracked per player, and it resets the
   * moment they step out so the burn delay measures *unbroken* contact.
   */
  private tickContactFor(player: Player, contactFrames: number): number {
    if (!player.isAlive || !this.isTouchingFlame(player)) return 0;

    const frames = contactFrames + 1;
    if (frames === 1 || frames % FLAME_DAMAGE_INTERVAL === 0) {
      player.takeDamage(FLAME_CONTACT_DAMAGE, FLAME_DAMAGE_SOURCE);
      player.damageFlash = FLAME_DAMAGE_FLASH_FRAMES;
    }
    if (frames === FLAME_BURN_DELAY) player.applyStatus(makeBurn());
    return frames;
  }

  /** The fire patches, drawn under creatures so the party walks in front of them. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const flame of this.flames) {
      const elapsed = FLAME_FRAMES - flame.tick;
      const rising = Math.min(1, elapsed / FLAME_RISE_FRAMES);
      const dying = Math.min(1, flame.tick / FLAME_FADE_FRAMES);
      const intensity = Math.min(rising, dying);
      if (intensity <= 0) continue;
      drawLavaFlame(ctx, flame.x - camX, flame.y - camY, TILE_SIZE, elapsed, flame.seed, intensity);
    }
  }

  /** The bolts and bursts, drawn over creatures so a shot never hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const burst of this.bursts) {
      const progress = 1 - burst.tick / BURST_FRAMES;
      drawLavaBurst(ctx, burst.x - camX, burst.y - camY, TILE_SIZE, progress);
    }
    for (const bolt of this.bolts) {
      const heading = Math.atan2(bolt.vy, bolt.vx);
      drawLavaBolt(ctx, bolt.x - camX, bolt.y - camY, TILE_SIZE, heading, bolt.age);
    }
  }

  /** A checkpoint restore must not resume a shot fired in the run that died. */
  resetForCheckpoint(): void {
    this.bolts = [];
    this.bursts = [];
    this.flames = [];
    this.humanContactFrames = 0;
    this.catContactFrames = 0;
    this.nextFlameSeed = 0;
    this.burstSoundPending = false;
  }
}
