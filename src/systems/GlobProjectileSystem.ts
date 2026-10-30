/**
 * Owns everything a thrown glob turns into once it has left the creature that
 * threw it: the glob in flight, the burst where it lands, and the puddle it
 * leaves on the floor. Two kinds share the one system — the fireball, which
 * lands as a fire patch, and the acid glob, which lands as a toxic puddle —
 * and everything that differs between them is one row of {@link GLOB_KINDS}.
 *
 * It is a system rather than state on the creature for one reason. A mob stops
 * being updated and stops being drawn the frame it dies — `MobUpdateLoop` skips
 * the dead, and kill resolution drops them out of the spatial grid the renderer
 * queries. A projectile owned by the thrower would vanish in mid-air the
 * instant the player landed the killing blow, which reads as the game eating
 * the shot.
 *
 * Throwers queue their shots behind `Mob.globShooter` and this drains them, so
 * nothing has to be injected into a mob at spawn time.
 */

import { crawlerTurnsShot } from '../gear/incomingBlows';
import type { WorldPoint } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { Player } from '../Player';
import type { DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { projectileSpeedScaleForLevel } from '../creatures/mobLevelScaling';
import {
  FULL_SHARE,
  BURN_TICKS,
  makeBurn,
  makePoison,
  type StatusEffect,
} from '../core/combat/StatusEffect';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { drawFireballBolt, drawFireballBurst, drawFireballFlame } from '../sprites/fireballSprite';
import { drawAcidBolt, drawAcidBurst, drawAcidPuddle } from '../sprites/acidGlobSprite';
import { type GameSystem, type SystemContext, presentCrawlers } from './GameSystem';
import type { DynamicLightSink } from './lighting/dynamicLights';
import type { DynamicLightKind } from './lighting/lightKinds';
import type { GroundHazardSource } from './GroundHazardSource';
import type { GlobKind } from './globShot';

type EnvironmentalHazard = NonNullable<Extract<DamageSource, { kind: 'environmental' }>['hazard']>;

/**
 * How long acid poison lasts, in frames.
 *
 * Sized to match the burn the fireball's patch applies rather than poison's
 * own thirty-second default: an acid glob is the same projectile in a
 * different material, and a status that outlasted the burn it stands in for
 * by nearly four times would make the acid the far deadlier shot.
 */
const ACID_POISON_TICKS = BURN_TICKS;

/** Everything about a glob that depends on what it is made of. */
interface GlobKindDef {
  /** The status a direct hit may apply, rolled at {@link directHitStatusChance}. */
  readonly directHitStatus: () => StatusEffect;
  readonly directHitStatusChance: number;
  /** The status the puddle applies after unbroken contact. */
  readonly puddleStatus: () => StatusEffect;
  /** The hazard the puddle's contact damage is reported as, for the death screen. */
  readonly puddleHazard: Extract<EnvironmentalHazard, 'fireballFlames' | 'acidPuddle'>;
  readonly drawBolt: typeof drawFireballBolt;
  readonly drawBurst: typeof drawFireballBurst;
  readonly drawPuddle: typeof drawFireballFlame;
  readonly boltLight: DynamicLightKind;
  readonly burstLight: DynamicLightKind;
  readonly puddleLight: DynamicLightKind;
  /** How strongly the puddle lights the floor around it, 0–1. */
  readonly puddleLightStrength: number;
  /** The takes a landing picks between; empty where no recording exists yet. */
  readonly burstSounds: readonly SoundId[];
}

/** The share of direct hits that set a status, for every kind. */
const DIRECT_HIT_STATUS_CHANCE = 0.15;
const FULL_LIGHT = 1;
/** A pool of acid glows faintly; it is not a fire and must not light a room like one. */
const ACID_PUDDLE_LIGHT_STRENGTH = 0.45;

const GLOB_KINDS = {
  fireball: {
    directHitStatus: () => makeBurn(FULL_SHARE),
    directHitStatusChance: DIRECT_HIT_STATUS_CHANCE,
    puddleStatus: () => makeBurn(FULL_SHARE),
    puddleHazard: 'fireballFlames',
    drawBolt: drawFireballBolt,
    drawBurst: drawFireballBurst,
    drawPuddle: drawFireballFlame,
    boltLight: 'fireball_bolt',
    burstLight: 'fireball',
    puddleLight: 'coals',
    puddleLightStrength: FULL_LIGHT,
    burstSounds: ['fireball_burst'],
  },
  acid: {
    directHitStatus: () => makePoison(null, ACID_POISON_TICKS),
    directHitStatusChance: DIRECT_HIT_STATUS_CHANCE,
    puddleStatus: () => ({ ...makePoison(null, ACID_POISON_TICKS), groundHazard: 'acid' }),
    puddleHazard: 'acidPuddle',
    drawBolt: drawAcidBolt,
    drawBurst: drawAcidBurst,
    drawPuddle: drawAcidPuddle,
    boltLight: 'acid_spit',
    burstLight: 'acid_spit',
    puddleLight: 'acid_spit',
    puddleLightStrength: ACID_PUDDLE_LIGHT_STRENGTH,
    burstSounds: ['acid_glob_splash_1', 'acid_glob_splash_2', 'acid_glob_splash_3'],
  },
} as const satisfies Record<GlobKind, GlobKindDef>;

/** Where a glob just landed and what it was, so the scene can play its burst there. */
export interface GlobBurstCue extends WorldPoint {
  readonly kind: GlobKind;
}

/** The takes a landing glob of this kind picks between; empty where none is recorded yet. */
export function globBurstSounds(kind: GlobKind): readonly SoundId[] {
  const def: GlobKindDef = GLOB_KINDS[kind];
  return def.burstSounds;
}

interface Bolt {
  readonly kind: GlobKind;
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
  /**
   * The creature that threw it, so a hit can be recorded against it.
   *
   * The whole point of this system is that a shot outlives its thrower, so
   * this may well reference a dead mob — which is fine, it is only ever read to
   * note blood.
   */
  owner: Mob;
}

interface Burst {
  readonly kind: GlobKind;
  readonly x: number;
  readonly y: number;
  tick: number;
}

interface Puddle {
  readonly kind: GlobKind;
  readonly x: number;
  readonly y: number;
  /** Staggers the loop so puddles side by side do not animate in lockstep. */
  readonly seed: number;
  tick: number;
  /**
   * The creature whose glob laid this puddle. A puddle routinely outlives it,
   * which is why standing in one only counts as that creature striking you
   * while it is still alive — see `tickContactFor`.
   */
  readonly owner: Mob;
}

const BOLT_SPEED = 1.9;
/**
 * The cap, as a share of the player's own run speed.
 *
 * Expressed as a fraction rather than as a literal so the fairness rule is the
 * thing written down: a glob must stay outrunnable, so retreating in a straight
 * line has to remain a real answer to one at every level. A hard number here
 * would quietly become wrong the day `PLAYER_SPEED` was retuned.
 */
const BOLT_SPEED_CAP_PLAYER_FRACTION = 0.9;
/** Hard ceiling on a levelled glob's speed, in pixels per frame. */
export const BOLT_SPEED_CAP = PLAYER_SPEED * BOLT_SPEED_CAP_PLAYER_FRACTION;

/**
 * How fast a glob thrown by a creature of this level travels, in pixels per
 * frame.
 *
 * Exported so `scripts/verify-difficulty.ts` asserts the cap against the real
 * function rather than against a copy of it.
 */
export function globSpeedForLevel(level: number): number {
  return Math.min(BOLT_SPEED_CAP, BOLT_SPEED * projectileSpeedScaleForLevel(level));
}

const BOLT_RADIUS_PX = 7;
/** How close a target's centre must be for a direct hit, as a fraction of a tile. */
const TARGET_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;
/**
 * Frames a glob may fly before it is dropped, so a shot that somehow never
 * meets a wall cannot live forever. It is *dropped*, not landed: a glob that
 * burst here would go off in mid-air over open floor and leave a puddle
 * denying ground nothing ever hit.
 */
const BOLT_MAX_AGE = 300;

const BURST_FRAMES = 26;
/**
 * Radius the burst itself damages within, in tiles. Small — it is a *mini*
 * blast. Exported because the burst art is drawn against it: a burst painted
 * well inside this hides damage it deals, and one painted far outside it
 * promises damage it does not. `scripts/gates-globs.ts` measures the painted
 * reach of every kind against this number.
 */
export const BURST_RADIUS_TILES = 0.8;
const BURST_DAMAGE = 1;

/** Frames a puddle lasts. Long enough to deny ground, short enough to wait out. */
const PUDDLE_FRAMES = 330;
/** Frames the puddle spends fading in as it spreads, and out as it dies. */
const PUDDLE_RISE_FRAMES = 20;
const PUDDLE_FADE_FRAMES = 60;
/**
 * Radius a puddle hurts anything standing in, in tiles. Exported for the same
 * reason as the burst's: the puddle's painted footprint is what tells the
 * player where the floor is dangerous.
 */
export const PUDDLE_RADIUS_TILES = 0.55;
const PUDDLE_CONTACT_DAMAGE = 1;
/** Frames between ticks of contact damage while standing in a puddle. */
const PUDDLE_DAMAGE_INTERVAL = 30;
/** Frames of unbroken contact before the puddle applies its kind's status. */
const PUDDLE_STATUS_DELAY = 60;
const PUDDLE_DAMAGE_FLASH_FRAMES = 8;

/**
 * Live puddles beyond this are dropped rather than drawn. A room of throwers
 * all missing into the same corner is the case this bounds.
 */
const MAX_PUDDLES = 24;

export class GlobProjectileSystem implements GameSystem, GroundHazardSource {
  private bolts: Bolt[] = [];
  private bursts: Burst[] = [];
  private puddles: Puddle[] = [];
  private humanContactFrames = 0;
  private catContactFrames = 0;
  /** Incremented per puddle so each gets a distinct animation offset. */
  private nextPuddleSeed = 0;

  /** Where a glob just landed; `DungeonScene` reads and clears it to play the burst there. */
  burstSoundAt: GlobBurstCue | null = null;

  constructor(private readonly gameMap: GameMap) {}

  /** Globs light their way across the room; bursts flare and puddles glow low. */
  collectLights(sink: DynamicLightSink): void {
    for (const bolt of this.bolts) sink.add(bolt.x, bolt.y, GLOB_KINDS[bolt.kind].boltLight);
    for (const burst of this.bursts) {
      sink.add(burst.x, burst.y, GLOB_KINDS[burst.kind].burstLight, burst.tick / BURST_FRAMES);
    }
    for (const puddle of this.puddles) {
      const def: GlobKindDef = GLOB_KINDS[puddle.kind];
      sink.add(puddle.x, puddle.y, def.puddleLight, def.puddleLightStrength);
    }
  }

  update(ctx: SystemContext): void {
    this.collectShots(ctx.roster.mobs);
    this.advanceBolts(ctx);
    this.advanceBursts();
    this.advancePuddles();
    this.humanContactFrames = this.tickContactFor(ctx.human, this.humanContactFrames);
    this.catContactFrames = this.tickContactFor(ctx.cat, this.catContactFrames);
  }

  /**
   * Drains every thrower's pending shots.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: a thrower that fires and is killed in the same frame is skipped by
   * every activation-radius query from the next frame on, and its shot would be
   * stranded in a queue forever.
   */
  private collectShots(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      const shooter = mob.globShooter;
      if (shooter === null) continue;
      for (const shot of shooter.takePendingGlobs()) {
        const heading = normalize(shot.dirX, shot.dirY);
        const speed = globSpeedForLevel(shot.mobLevel);
        const launch = this.gameMap.clearLaunchPoint(
          mob.x + TILE_SIZE * CENTER_OFFSET,
          mob.y + TILE_SIZE * CENTER_OFFSET,
          shot.x,
          shot.y,
        );
        this.bolts.push({
          kind: shot.kind,
          x: launch.x,
          y: launch.y,
          vx: heading.x * speed,
          vy: heading.y * speed,
          age: 0,
          damage: shot.damage,
          // A glob crossing a room is exactly what dodge is for, so it stays
          // dodgeable. The burst it makes on landing is not — there is no
          // sidestepping a splash you are already standing in.
          source: { kind: 'mob', mobType: shot.mobType },
          burstSource: { kind: 'mob', mobType: shot.mobType, undodgeable: true },
          aimedAt: shot.aimedAt,
          owner: mob,
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
      if (!this.gameMap.isWalkable(tileX, tileY, 'walker')) {
        // Landed at the last clear position rather than inside the wall, so the
        // burst and its puddle sit on floor the player can actually stand on.
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
        const connected =
          !crawlerTurnsShot(target, bolt.owner, bolt.vx, bolt.vy) &&
          target.takeDamage(bolt.damage, bolt.source);
        if (connected) {
          bolt.owner.noteStruckPlayer(target);
          const def: GlobKindDef = GLOB_KINDS[bolt.kind];
          if (Math.random() < def.directHitStatusChance) target.applyStatus(def.directHitStatus());
        }
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
   * Turns a glob into a burst plus the puddle it leaves behind, and applies the
   * burst's splash damage.
   *
   * The splash lands here, on the single frame of impact, rather than over the
   * burst animation: a burst that keeps dealing damage for the length of its
   * own animation punishes a player who was already clear of it by the time
   * they could have reacted.
   *
   * `directHit` is whoever the glob struck, if anyone, and is excluded from the
   * splash.
   */
  private land(bolt: Bolt, targets: readonly Player[], directHit?: Player): void {
    const { x, y, kind } = bolt;
    this.bursts.push({ kind, x, y, tick: BURST_FRAMES });
    if (this.puddles.length >= MAX_PUDDLES) this.puddles.shift();
    this.puddles.push({
      kind,
      x,
      y,
      seed: this.nextPuddleSeed++,
      tick: PUDDLE_FRAMES,
      owner: bolt.owner,
    });
    this.burstSoundAt = { x, y, kind };

    const radius = TILE_SIZE * BURST_RADIUS_TILES;
    for (const target of targets) {
      // Whoever the glob actually hit has already taken the full projectile
      // damage; charging them the splash as well means a direct hit quietly
      // costs more than the tuned number says it does.
      if (!target.isAlive || target === directHit) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      // Attributed to the thrower, not to the puddle: a player killed by the
      // splash never stood in anything, and the puddle's death line would tell
      // them they died standing in it.
      const connected = target.takeDamage(BURST_DAMAGE, bolt.burstSource);
      if (connected) bolt.owner.noteStruckPlayer(target);
    }
  }

  /**
   * Everything this glob can hit.
   *
   * The two players plus the scene's extra player-like targets (Deinonychus,
   * hired mercenaries) plus whatever the thrower was actually aiming at.
   * Restricted to the players alone, a thrower fighting a mercenary winds up,
   * fires, and puts the glob straight through them into the far wall — forever,
   * because it keeps its cooldown and never lands a hit.
   */
  private targetsFor(ctx: SystemContext, bolt: Bolt): readonly Player[] {
    const targets: Player[] = presentCrawlers(ctx);
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for exactly this reason, and
     * `DefendQuestSystem` fails the quest the instant the NPC dies — so a burst
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

  private advancePuddles(): void {
    for (const puddle of this.puddles) puddle.tick--;
    this.puddles = this.puddles.filter((puddle) => puddle.tick > 0);
  }

  /**
   * Which way out of the nearest puddle covering (x, y), for anything steering
   * a body clear of dangerous ground.
   *
   * Includes puddles still spreading, which `puddleUnder` excludes: damage must
   * not land before the puddle is drawn, but a route planned onto a puddle that
   * is about to hurt is a route into it. A body on a puddle's exact centre gets
   * a fixed direction rather than a zero vector.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * CENTER_OFFSET;
    const cy = y + TILE_SIZE * CENTER_OFFSET;
    const radius = TILE_SIZE * PUDDLE_RADIUS_TILES;
    let nearest: Puddle | null = null;
    let nearestDistance = radius;
    for (const puddle of this.puddles) {
      const distance = Math.hypot(puddle.x - cx, puddle.y - cy);
      if (distance < nearestDistance) {
        nearest = puddle;
        nearestDistance = distance;
      }
    }
    if (nearest === null) return null;
    if (nearestDistance === 0) return { dx: 1, dy: 0 };
    return {
      dx: (cx - nearest.x) / nearestDistance,
      dy: (cy - nearest.y) / nearestDistance,
    };
  }

  /** The live puddle this player is standing in, if any. */
  private puddleUnder(player: Player): Puddle | null {
    const cx = player.x + TILE_SIZE * CENTER_OFFSET;
    const cy = player.y + TILE_SIZE * CENTER_OFFSET;
    const radius = TILE_SIZE * PUDDLE_RADIUS_TILES;
    for (const puddle of this.puddles) {
      // A puddle that is still spreading does not hurt yet; without this the
      // damage lands a full second before there is anything drawn to explain it.
      if (puddle.tick > PUDDLE_FRAMES - PUDDLE_RISE_FRAMES) continue;
      if (Math.hypot(puddle.x - cx, puddle.y - cy) < radius) return puddle;
    }
    return null;
  }

  /**
   * One player's contact damage. Returns the new contact-frame count, which the
   * caller stores — contact has to be tracked per player, and it resets the
   * moment they step out so the status delay measures *unbroken* contact.
   */
  private tickContactFor(player: Player, contactFrames: number): number {
    const puddle = player.isAlive ? this.puddleUnder(player) : null;
    if (puddle === null) return 0;

    const def: GlobKindDef = GLOB_KINDS[puddle.kind];
    const frames = contactFrames + 1;
    if (frames === 1 || frames % PUDDLE_DAMAGE_INTERVAL === 0) {
      // No mob is standing in the puddle when it hurts you — the thrower may
      // well be dead — so it is environmental rather than attributed, and
      // `takeDamage` only rolls a dodge against `kind: 'mob'`, which makes it
      // undodgeable for free.
      const source: DamageSource = { kind: 'environmental', hazard: def.puddleHazard };
      const connected = player.takeDamage(PUDDLE_CONTACT_DAMAGE, source);
      player.damageFlash = PUDDLE_DAMAGE_FLASH_FRAMES;
      // Standing in a live thrower's puddle is being in a fight with it, so the
      // contact counts as its blow. Only while it lives: a puddle outlasts its
      // thrower, and reviving the flag for a dead one would keep pointing the
      // companion at a corpse.
      if (connected && puddle.owner.isAlive) puddle.owner.noteStruckPlayer(player);
    }
    if (frames === PUDDLE_STATUS_DELAY) player.applyStatus(def.puddleStatus());
    return frames;
  }

  /** Whether {@link renderGround} has anything to draw this frame. */
  get hasGroundArt(): boolean {
    return this.puddles.length > 0 || this.bursts.length > 0 || this.bolts.length > 0;
  }

  /** The puddles, drawn under creatures so the party walks in front of them. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const puddle of this.puddles) {
      const elapsed = PUDDLE_FRAMES - puddle.tick;
      const rising = Math.min(1, elapsed / PUDDLE_RISE_FRAMES);
      const dying = Math.min(1, puddle.tick / PUDDLE_FADE_FRAMES);
      const intensity = Math.min(rising, dying);
      if (intensity <= 0) continue;
      GLOB_KINDS[puddle.kind].drawPuddle(
        ctx,
        puddle.x - camX,
        puddle.y - camY,
        TILE_SIZE,
        elapsed,
        puddle.seed,
        intensity,
      );
    }
  }

  /** The globs and bursts, drawn over creatures so a shot never hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const burst of this.bursts) {
      const progress = 1 - burst.tick / BURST_FRAMES;
      GLOB_KINDS[burst.kind].drawBurst(ctx, burst.x - camX, burst.y - camY, TILE_SIZE, progress);
    }
    for (const bolt of this.bolts) {
      const heading = Math.atan2(bolt.vy, bolt.vx);
      GLOB_KINDS[bolt.kind].drawBolt(
        ctx,
        bolt.x - camX,
        bolt.y - camY,
        TILE_SIZE,
        heading,
        bolt.age,
      );
    }
  }

  /** A checkpoint restore must not resume a shot fired in the run that died. */
  resetForCheckpoint(): void {
    this.bolts = [];
    this.bursts = [];
    this.puddles = [];
    this.humanContactFrames = 0;
    this.catContactFrames = 0;
    this.nextPuddleSeed = 0;
    this.burstSoundAt = null;
  }
}
