/**
 * Everything a bomber goblin's explosive does once it has left the hand: the
 * lob, the Dynamite Goblin's stick bouncing and burning on the floor, the
 * Black Powder Goblin's bomb bursting where it lands, and every blast.
 *
 * A system rather than state on the creature for the reason
 * `GoblinArrowSystem` gives: a mob stops updating and drawing the frame it
 * dies, and a bomb already in the air, or a stick already fizzing on the
 * floor, must not vanish with the goblin that threw it. Bombers queue their
 * throws through `Mob.bombThrower` and this drains them.
 *
 * Goblin blasts follow their own targeting rule, not the player's dynamite's:
 * the party takes the whole blast, and so does anything that hunts the other
 * monsters, while every other mob — the thrower, its pack, a boss — loses a
 * single point. Whatever survives is thrown clear unless it resists a blast's
 * shove, as bosses and anything rooted do. The bomb is aimed at the party; the
 * rest of the room is only in the way.
 */

import type { Player } from '../Player';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import { Mob, type MobDamageSource } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { drawLitDynamiteStick } from '../sprites/dynamiteSprite';
import { type FuseBurnOptions, paintFuseFloorGlow } from '../sprites/fuseEffects';
import {
  drawDynamiteExplosion,
  drawScorchMark,
  explosionLightRemaining,
  explosionTotalFrames,
  SCORCH_TOTAL_FRAMES,
  scorchMarkReachPx,
  type ExplosionPicture,
} from '../sprites/dynamiteExplosion';
import {
  drawBlackPowderBombFlight,
  drawBlackPowderExplosion,
  drawThrownBombShadow,
} from '../sprites/blackPowderBombSprite';
import { DANGER_CIRCLE_PALETTE, drawDangerCircle } from '../sprites/dangerTelegraph';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import { EXPLOSION_IGNITE_RING_TILES, type TreeSystem } from './TreeSystem';
import type { GameSystem, SystemContext } from './GameSystem';
import type { DynamicLightSink } from './lighting/dynamicLights';
import type { GroundHazardSource, HazardEscape } from './GroundHazardSource';
import { type CircleHazardZone, escapeFromCircleZones } from './circleHazardEscape';
import {
  BLACK_POWDER_ATTACK_TYPE,
  BLACK_POWDER_BLAST_RADIUS_PX,
  type BombPoint,
  GOBLIN_BOMB_ARC_HEIGHT_TILES,
  GOBLIN_BOMB_HAZARD_MARGIN_PX,
  GOBLIN_DYNAMITE_ATTACK_TYPE,
  GOBLIN_DYNAMITE_BLAST_RADIUS_PX,
  GOBLIN_DYNAMITE_BOUNCE_FRAMES,
  type StickFuse,
  GOBLIN_DYNAMITE_SETTLE_PX,
  goblinBlastDamage,
  type GoblinBombKind,
  type GoblinBombShot,
  goblinBombBlastRadiusPx,
  resolveGoblinBombLanding,
} from './goblinBombConstants';

/**
 * Something the scene should sound, at a world point; drained with
 * {@link GoblinBombSystem.takeCues}.
 */
export interface GoblinBombCue {
  readonly cue: 'stickLanded' | 'dynamiteBlast' | 'blackPowderBlast';
  readonly x: number;
  readonly y: number;
}

/** The siege's walls, trebuchets and snares, as a goblin blast reaches them. */
export interface GoblinBombStructures {
  blastInRadius(cx: number, cy: number, radiusPx: number, damage: number): void;
}

/** What the system reads from the scene it lives in. */
export interface GoblinBombSystemDeps {
  readonly gameMap: GameMap;
  /** Absent in a harness with no bus; the blast then reaches nothing that listens for one. */
  readonly bus: EventBus | null;
  /** The floor's breakable props, which a blast outside a siege flattens. */
  readonly destructibles: DestructiblePropSystem | null;
  /** The floor's trees, read at blast time; null off the overworld. */
  readonly trees: () => TreeSystem | null;
  /**
   * The village's defences while a siege is running, null otherwise. Read at
   * blast time: a siege starts and ends while sticks are on the floor.
   */
  readonly siegeStructures: () => GoblinBombStructures | null;
}

/** One goblin blast, as {@link applyGoblinBlastToBodies} resolves it. */
export interface GoblinBlast {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** The share of a struck body's own max HP the blast takes; see `goblinBlastDamage`. */
  readonly crawlerHpShare: number;
  /** The thrower, which every mob blow is credited to. May already be dead. */
  readonly thrower: Mob;
  /** The blow as the crawlers take it, stamped on the throw frame. */
  readonly source: MobDamageSource;
}

/** A goblin stick on the floor, as gates and the fuse sound read it. */
export interface GoblinStickView {
  readonly x: number;
  readonly y: number;
  readonly fuseFramesLeft: number;
  /** Stable for the stick's life; tells two sticks apart. */
  readonly seed: number;
}

/** A bomb or stick still in the air, as gates read it. */
export interface GoblinBombFlightView {
  readonly kind: GoblinBombKind;
  readonly toX: number;
  readonly toY: number;
  readonly age: number;
  readonly flightFrames: number;
}

/** What an ordinary hostile — the thrower, its pack, a boss — loses to a goblin blast. */
export const GOBLIN_BLAST_DAMAGE_TO_BYSTANDER_MOBS = 1;

/** How far a body at the dead centre of a blast is thrown, in tiles; nothing at the edge. */
const BLAST_KNOCKBACK_TILES = 1.5;
const BLAST_KNOCKBACK_FRAMES = 12;
/** Mass below this pushes as far as a mass of exactly this. */
const MIN_MASS_FOR_KNOCKBACK = 1;
/** A shove shorter than this is not worth starting. */
const MIN_KNOCKBACK_PX = 1;

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;
const HALF_TILE = TILE_SIZE * TILE_CENTRE;

/** A parabola `4u(1 − u)` peaks at 1 when `u = ½`; this is the 4. */
const PARABOLA_PEAK_GAIN = 4;
/** How high the one bounce after landing hops, in tiles. */
const BOUNCE_HEIGHT_TILES = 0.3;
/** Full turns a stick tumbles end over end in the air before it comes to rest. */
const STICK_TUMBLE_TURNS = 2;
/** Full turns a black powder bomb spins over its flight: slow enough to read the fuse. */
const BOMB_SPIN_TURNS = 0.75;
const FULL_TURN = Math.PI * 2;

/** The circle's opacity swings between this and full while the fuse burns. */
const CIRCLE_PULSE_MIN_FADE = 0.6;
/** Frames per pulse of the circle, before and inside the fuse's final stretch. */
const CIRCLE_PULSE_FRAMES = 36;
const CIRCLE_PULSE_FINAL_FRAMES = 8;

/** A blast lights the room past its radius by this much, as the player's dynamite does. */
const BLAST_LIGHT_REACH_SCALE = 1.5;
const BLAST_LIGHT_MIN_REACH_TILES = 3;
/** The burning fuse's glow on the floor, and how much brighter it flares at the end. */
const FUSE_LIGHT_STRENGTH = 0.35;
const FUSE_LIGHT_FINAL_STRENGTH = 0.8;
const FUSE_LIGHT_REACH_TILES = 1.5;

/** Spreads consecutive seeds so no two blasts share a picture. */
const SEED_STRIDE = 7919;

interface FlightBase {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly flightFrames: number;
  readonly releaseHeightPx: number;
  readonly crawlerHpShare: number;
  readonly structureDamage: number;
  readonly thrower: Mob;
  readonly source: MobDamageSource;
  readonly seed: number;
  age: number;
}

/** A stick in the air, carrying the fuse it will burn once it lands, captured on the throw. */
interface DynamiteFlight extends FlightBase {
  readonly kind: 'dynamite';
  readonly fuse: StickFuse;
}

interface BlackPowderFlight extends FlightBase {
  readonly kind: 'black_powder';
}

type Flight = DynamiteFlight | BlackPowderFlight;

interface Stick {
  x: number;
  y: number;
  readonly landX: number;
  readonly landY: number;
  readonly settleX: number;
  readonly settleY: number;
  bounceAge: number;
  /** The fuse it was thrown with, so a difficulty changed while it burns never re-times it. */
  readonly fuse: StickFuse;
  fuseFramesLeft: number;
  /** Frames the fuse had already burnt in the air, so its sparks and smoke carry on through the landing. */
  readonly litAgeAtLanding: number;
  readonly crawlerHpShare: number;
  readonly structureDamage: number;
  readonly thrower: Mob;
  readonly source: MobDamageSource;
  readonly seed: number;
}

interface Explosion {
  readonly kind: GoblinBombKind;
  readonly picture: Omit<ExplosionPicture, 'ageFrames'>;
  ageFrames: number;
}

interface Scorch {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly seed: number;
  ageFrames: number;
}

/** A held telegraph is drawn at full strength: the fill, not the fade, says how long is left. */
const LOCKED_CIRCLE_FADE = 1;

/** A black powder landing a bomber has locked, and how far through its lock it is. */
interface LockedLanding extends BombPoint {
  readonly progress: number;
}

export class GoblinBombSystem implements GameSystem, GroundHazardSource {
  private flights: Flight[] = [];
  private sticks: Stick[] = [];
  private explosions: Explosion[] = [];
  private scorches: Scorch[] = [];
  /** Black powder landings locked and not yet thrown, gathered from the bombers each frame. */
  private readonly lockedLandings: LockedLanding[] = [];
  /** Scratch for {@link noteLiveSticks}: each bomber's sticks in the air or on the floor. */
  private readonly liveStickCounts = new Map<Mob, number>();
  private cues: GoblinBombCue[] = [];
  private readonly zoneScratch: CircleHazardZone[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private nextSeed = 0;

  constructor(private readonly deps: GoblinBombSystemDeps) {
    if (deps.bus !== null) {
      this.unsubscribers.push(
        deps.bus.on('blastLanded', ({ x, y, radiusPx }) => this.setOffSticksNear(x, y, radiusPx)),
      );
    }
  }

  /** Sticks on the floor, for gates and for the fuse sound. */
  get liveSticks(): readonly GoblinStickView[] {
    return this.sticks;
  }

  /** Bombs and sticks in the air, for gates. */
  get liveFlights(): readonly GoblinBombFlightView[] {
    return this.flights;
  }

  /** The cues raised since the last call, for the scene to play. */
  takeCues(): readonly GoblinBombCue[] {
    if (this.cues.length === 0) return [];
    const taken = this.cues;
    this.cues = [];
    return taken;
  }

  update(ctx: SystemContext): void {
    this.collectThrows(ctx.roster.mobs);
    this.advanceFlights(ctx);
    this.advanceSticks();
    this.detonateBurntOut(ctx);
    this.noteLiveSticks(ctx.roster.mobs);
    for (const explosion of this.explosions) explosion.ageFrames++;
    dropFinishedExplosions(this.explosions);
    for (const scorch of this.scorches) scorch.ageFrames++;
    keepYoungerThan(this.scorches, SCORCH_TOTAL_FRAMES);
  }

  /**
   * Drains every bomber's released throws, the dead included, and reads the
   * landings the living have locked. Walks the whole list rather than an
   * activation query, so a goblin that throws and dies on one frame still
   * hands over its bomb.
   */
  private collectThrows(mobs: readonly Mob[]): void {
    this.lockedLandings.length = 0;
    for (const mob of mobs) {
      const thrower = mob.bombThrower;
      if (thrower === null) continue;
      for (const shot of thrower.takePendingBombs()) this.launch(shot);
      const locked = thrower.lockedBombLanding;
      if (locked !== null && mob.isAlive) {
        this.lockedLandings.push({
          x: locked.x,
          y: locked.y,
          progress: thrower.lockedBombProgress,
        });
      }
    }
  }

  /**
   * Puts a throw in the air. The landing is resolved again from the
   * thrower's feet: a bomber that walked during its lock must not throw past the range
   * cap, which is what bounds the bomb's ground speed, or through a wall that
   * now stands between it and the spot it locked.
   */
  private launch(shot: GoblinBombShot): void {
    const landing = resolveGoblinBombLanding(this.deps.gameMap, shot.start, shot.landing);
    const attackType =
      shot.kind === 'dynamite' ? GOBLIN_DYNAMITE_ATTACK_TYPE : BLACK_POWDER_ATTACK_TYPE;
    const flight: FlightBase = {
      fromX: shot.hand.x,
      fromY: shot.hand.y,
      toX: landing.x,
      toY: landing.y,
      flightFrames: shot.flightFrames,
      releaseHeightPx: shot.releaseHeightPx,
      crawlerHpShare: shot.crawlerHpShare,
      structureDamage: shot.structureDamage,
      thrower: shot.thrower,
      source: shot.thrower.stampHarmLimits({
        kind: 'mob',
        mobType: shot.thrower.mobType,
        attackType,
        from: landing,
        // There is no sidestepping a blast: the dodge is leaving the circle.
        undodgeable: true,
      }),
      seed: this.seed(),
      age: 0,
    };
    this.flights.push(
      shot.kind === 'dynamite'
        ? { ...flight, kind: 'dynamite', fuse: shot.fuse }
        : { ...flight, kind: 'black_powder' },
    );
  }

  private advanceFlights(ctx: SystemContext): void {
    let kept = 0;
    for (const flight of this.flights) {
      flight.age++;
      if (flight.age < flight.flightFrames) {
        this.flights[kept] = flight;
        kept++;
        continue;
      }
      if (flight.kind === 'black_powder') {
        this.detonate(ctx, {
          kind: 'black_powder',
          x: flight.toX,
          y: flight.toY,
          crawlerHpShare: flight.crawlerHpShare,
          structureDamage: flight.structureDamage,
          thrower: flight.thrower,
          source: flight.source,
          seed: flight.seed,
        });
      } else {
        this.land(flight);
      }
    }
    this.flights.length = kept;
  }

  /**
   * A stick comes down: it bounces once on along its flight, settling a short
   * way past the landing, and its fuse starts on this frame.
   */
  private land(flight: DynamiteFlight): void {
    const offsetX = flight.toX - flight.fromX;
    const offsetY = flight.toY - flight.fromY;
    const travelled = Math.hypot(offsetX, offsetY);
    const rollX = travelled > 0 ? (offsetX / travelled) * GOBLIN_DYNAMITE_SETTLE_PX : 0;
    const rollY = travelled > 0 ? (offsetY / travelled) * GOBLIN_DYNAMITE_SETTLE_PX : 0;
    const settleWalkable = this.deps.gameMap.isWalkable(
      Math.floor((flight.toX + rollX) / TILE_SIZE),
      Math.floor((flight.toY + rollY) / TILE_SIZE),
    );
    const settleX = settleWalkable ? flight.toX + rollX : flight.toX;
    const settleY = settleWalkable ? flight.toY + rollY : flight.toY;
    const fuse = flight.fuse;
    this.sticks.push({
      x: flight.toX,
      y: flight.toY,
      landX: flight.toX,
      landY: flight.toY,
      settleX,
      settleY,
      bounceAge: 0,
      fuse,
      fuseFramesLeft: fuse.frames,
      litAgeAtLanding: flight.age,
      crawlerHpShare: flight.crawlerHpShare,
      structureDamage: flight.structureDamage,
      thrower: flight.thrower,
      source: flight.source,
      seed: flight.seed,
    });
    this.cues.push({ cue: 'stickLanded', x: flight.toX, y: flight.toY });
  }

  private advanceSticks(): void {
    for (const stick of this.sticks) {
      stick.fuseFramesLeft--;
      if (stick.bounceAge >= GOBLIN_DYNAMITE_BOUNCE_FRAMES) continue;
      stick.bounceAge++;
      const progress = stick.bounceAge / GOBLIN_DYNAMITE_BOUNCE_FRAMES;
      stick.x = stick.landX + (stick.settleX - stick.landX) * progress;
      stick.y = stick.landY + (stick.settleY - stick.landY) * progress;
    }
  }

  /**
   * Sets off every stick whose fuse has burnt out, and every stick a blast
   * reached. Looked up afresh after each blast, because a blast sets off the
   * sticks around it through `blastLanded`.
   */
  private detonateBurntOut(ctx: SystemContext): void {
    for (let index = this.burntOutIndex(); index >= 0; index = this.burntOutIndex()) {
      const stick = this.sticks[index];
      this.sticks.splice(index, 1);
      this.detonate(ctx, {
        kind: 'dynamite',
        x: stick.x,
        y: stick.y,
        crawlerHpShare: stick.crawlerHpShare,
        structureDamage: stick.structureDamage,
        thrower: stick.thrower,
        source: stick.source,
        seed: stick.seed,
      });
    }
  }

  /** The first stick whose fuse has burnt out, or -1. */
  private burntOutIndex(): number {
    for (let index = 0; index < this.sticks.length; index++) {
      if (this.sticks[index].fuseFramesLeft <= 0) return index;
    }
    return -1;
  }

  /**
   * Any blast, from anyone, sets off every goblin stick it reaches. The stick
   * goes off on this system's next pass — this same frame when the blast was
   * one of this system's own.
   */
  private setOffSticksNear(x: number, y: number, radiusPx: number): void {
    for (const stick of this.sticks) {
      if (Math.hypot(stick.x - x, stick.y - y) <= radiusPx) stick.fuseFramesLeft = 0;
    }
  }

  /** Tells each bomber how many of its own sticks are in the air or on the floor. */
  private noteLiveSticks(mobs: readonly Mob[]): void {
    const counts = this.liveStickCounts;
    counts.clear();
    for (const flight of this.flights) {
      if (flight.kind === 'dynamite') {
        counts.set(flight.thrower, (counts.get(flight.thrower) ?? 0) + 1);
      }
    }
    for (const stick of this.sticks) {
      counts.set(stick.thrower, (counts.get(stick.thrower) ?? 0) + 1);
    }
    for (const mob of mobs) {
      mob.bombThrower?.noteLiveSticks(counts.get(mob) ?? 0);
    }
    // Held only for this pass, so a dead thrower is not pinned until the next frame.
    counts.clear();
  }

  private detonate(
    ctx: SystemContext,
    charge: {
      readonly kind: GoblinBombKind;
      readonly x: number;
      readonly y: number;
      readonly crawlerHpShare: number;
      readonly structureDamage: number;
      readonly thrower: Mob;
      readonly source: MobDamageSource;
      readonly seed: number;
    },
  ): void {
    const radiusPx = goblinBombBlastRadiusPx(charge.kind);
    const { x, y } = charge;
    const blast: GoblinBlast = {
      x,
      y,
      radiusPx,
      crawlerHpShare: charge.crawlerHpShare,
      thrower: charge.thrower,
      source: charge.source,
    };
    applyGoblinBlastToBodies(blast, [ctx.human, ctx.cat], this.mobsNear(ctx, x, y, radiusPx));

    const siege = this.deps.siegeStructures();
    if (siege !== null) {
      siege.blastInRadius(x, y, radiusPx, charge.structureDamage);
    } else {
      // Flattened rather than chipped and the ring of trees round it set
      // alight, exactly as the party's own dynamite does: a crate a goblin
      // stick leaves standing reads as a bug.
      this.deps.destructibles?.destroyInRadius(x, y, radiusPx, ctx.human);
      const trees = this.deps.trees();
      trees?.destroyInRadius(x, y, radiusPx);
      trees?.igniteRadius(x, y, radiusPx + EXPLOSION_IGNITE_RING_TILES * TILE_SIZE);
    }

    const seed = charge.seed * SEED_STRIDE;
    this.explosions.push({
      kind: charge.kind,
      picture: {
        x,
        y,
        radius: radiusPx,
        coreRadius: radiusPx,
        cores: [{ x, y, delayFrames: 0, seed }],
      },
      ageFrames: 0,
    });
    this.scorches.push({ x, y, radius: radiusPx, seed, ageFrames: 0 });
    this.cues.push({
      cue: charge.kind === 'dynamite' ? 'dynamiteBlast' : 'blackPowderBlast',
      x,
      y,
    });
    this.deps.bus?.emit('blastLanded', { x, y, radiusPx });
    this.deps.bus?.emit('explosiveDetonated', { x, y, kind: charge.kind });
  }

  /**
   * Every mob a blast at (x, y) could reach: the grid's, plus the allies the
   * scene hands its systems as extra targets, not all of whom live in the grid.
   * The grid is keyed on a mob's top-left, hence the extra tile of reach.
   */
  private mobsNear(ctx: SystemContext, x: number, y: number, radiusPx: number): Set<Mob> {
    const near = ctx.roster.grid.queryCircle(x, y, radiusPx + TILE_SIZE);
    for (const extra of ctx.extraTargets ?? []) {
      if (extra instanceof Mob) near.add(extra);
    }
    return near;
  }

  private seed(): number {
    this.nextSeed++;
    return this.nextSeed;
  }

  /** A blast flares and dies; a burning fuse glows on the floor, brighter at the end. */
  collectLights(sink: DynamicLightSink): void {
    for (const explosion of this.explosions) {
      const remaining = explosionLightRemaining(explosion.kind, explosion.ageFrames);
      const reachTiles = Math.max(
        BLAST_LIGHT_MIN_REACH_TILES,
        explosion.picture.radius / TILE_SIZE,
      );
      sink.add(
        explosion.picture.x,
        explosion.picture.y,
        'explosion',
        remaining,
        reachTiles * BLAST_LIGHT_REACH_SCALE,
      );
    }
    for (const stick of this.sticks) {
      const finalStretch = stick.fuseFramesLeft <= stick.fuse.finalStretchFrames;
      sink.add(
        stick.x,
        stick.y,
        'coals',
        finalStretch ? FUSE_LIGHT_FINAL_STRENGTH : FUSE_LIGHT_STRENGTH,
        FUSE_LIGHT_REACH_TILES,
      );
    }
  }

  /**
   * Every circle of ground about to go up: each stick in the air (from the
   * throw, at its landing, with room for its roll), each stick on the floor,
   * each black powder bomb in the air, and each black powder landing a bomber
   * has locked and not yet thrown. The last two are never drawn after the
   * throw, but allies still know where the bomb is coming down.
   */
  private hazardZones(): readonly CircleHazardZone[] {
    const zones = this.zoneScratch;
    zones.length = 0;
    const stickPx = GOBLIN_DYNAMITE_BLAST_RADIUS_PX + GOBLIN_BOMB_HAZARD_MARGIN_PX;
    const powderPx = BLACK_POWDER_BLAST_RADIUS_PX + GOBLIN_BOMB_HAZARD_MARGIN_PX;
    for (const flight of this.flights) {
      const radiusPx = flight.kind === 'dynamite' ? stickPx + GOBLIN_DYNAMITE_SETTLE_PX : powderPx;
      zones.push({ x: flight.toX, y: flight.toY, radiusPx });
    }
    for (const stick of this.sticks) {
      zones.push({ x: stick.settleX, y: stick.settleY, radiusPx: stickPx });
    }
    for (const locked of this.lockedLandings) {
      zones.push({ x: locked.x, y: locked.y, radiusPx: powderPx });
    }
    return zones;
  }

  /** `GroundHazardSource`: out of every circle containing (x, y) at once. */
  getHazardEscapeVector(x: number, y: number): HazardEscape | null {
    return escapeFromCircleZones(this.deps.gameMap, this.hazardZones(), x, y);
  }

  /** Whether {@link renderGroundWarnings} has anything to draw this frame. */
  get hasGroundWarnings(): boolean {
    return this.sticks.length > 0 || this.lockedLandings.length > 0;
  }

  /** Scorches, the shadows under everything in the air, and the sticks' circles. Under creatures. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // A siege leaves scorches across the whole village for twenty seconds at a
    // time, each a couple of dozen blits, so only those in view are drawn.
    const viewW = viewportWidth();
    const viewH = viewportHeight();
    for (const mark of this.scorches) {
      const screenX = mark.x - camX;
      const screenY = mark.y - camY;
      const reach = scorchMarkReachPx(mark.radius);
      const inView =
        screenX + reach >= 0 &&
        screenY + reach >= 0 &&
        screenX - reach <= viewW &&
        screenY - reach <= viewH;
      if (inView) drawScorchMark(ctx, screenX, screenY, mark.radius, mark.seed, mark.ageFrames);
    }
    for (const flight of this.flights) {
      const now = flightPoint(flight, flight.age);
      drawThrownBombShadow(ctx, now.x - camX, now.y - camY, now.heightPx, TILE_SIZE);
    }
    for (const stick of this.sticks) {
      paintFuseFloorGlow(ctx, stick.x - camX, stick.y - camY, TILE_SIZE, stickBurn(stick));
    }
    this.renderGroundWarnings(ctx, camX, camY);
  }

  /**
   * Each stick's red danger circle at its blast radius, filling as the fuse
   * burns and pulsing faster in its final stretch, and each locked black
   * powder landing's, filling as the lock runs and gone the frame the bomb
   * leaves the hand. Drawn here rather than by the bomber, whose own draw is
   * culled with its body while a landing several tiles off is still on
   * screen. Drawn again over a dark room's darkness so the warning is never
   * dimmed with the floor.
   */
  renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const locked of this.lockedLandings) {
      drawDangerCircle(
        ctx,
        locked.x - camX,
        locked.y - camY,
        BLACK_POWDER_BLAST_RADIUS_PX,
        LOCKED_CIRCLE_FADE,
        DANGER_CIRCLE_PALETTE,
        { fillProgress: locked.progress, locked: true },
      );
    }
    for (const stick of this.sticks) {
      const burnt = 1 - stick.fuseFramesLeft / stick.fuse.frames;
      const finalStretch = stick.fuseFramesLeft <= stick.fuse.finalStretchFrames;
      const pulseFrames = finalStretch ? CIRCLE_PULSE_FINAL_FRAMES : CIRCLE_PULSE_FRAMES;
      const burntFrames = stick.fuse.frames - stick.fuseFramesLeft;
      const wave = (Math.sin((burntFrames / pulseFrames) * FULL_TURN) + 1) / 2;
      const fade = CIRCLE_PULSE_MIN_FADE + (1 - CIRCLE_PULSE_MIN_FADE) * wave;
      drawDangerCircle(
        ctx,
        stick.x - camX,
        stick.y - camY,
        GOBLIN_DYNAMITE_BLAST_RADIUS_PX,
        fade,
        DANGER_CIRCLE_PALETTE,
        { fillProgress: burnt },
      );
    }
  }

  /** Everything in the air, sticks on the floor and blasts, over creatures so none hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const stick of this.sticks) {
      const progress = Math.min(1, stick.bounceAge / GOBLIN_DYNAMITE_BOUNCE_FRAMES);
      const hop = PARABOLA_PEAK_GAIN * progress * (1 - progress) * BOUNCE_HEIGHT_TILES * TILE_SIZE;
      drawLitDynamiteStick(ctx, stick.x - camX, stick.y - camY - hop, TILE_SIZE, {
        ...stickBurn(stick),
        angle: stickRestAngle(stick.seed),
        fuseLeft: stick.fuseFramesLeft / stick.fuse.frames,
      });
    }
    for (const flight of this.flights) this.renderFlight(ctx, flight, camX, camY);
    for (const explosion of this.explosions) {
      const picture = { ...explosion.picture, ageFrames: explosion.ageFrames };
      if (explosion.kind === 'black_powder') {
        drawBlackPowderExplosion(ctx, picture, camX, camY);
      } else {
        drawDynamiteExplosion(ctx, picture, camX, camY);
      }
    }
  }

  private renderFlight(
    ctx: CanvasRenderingContext2D,
    flight: Flight,
    camX: number,
    camY: number,
  ): void {
    const now = flightPoint(flight, flight.age);
    const before = flightPoint(flight, Math.max(0, flight.age - 1));
    const sx = now.x - camX;
    const sy = now.y - camY - now.heightPx;
    const burn = {
      ageFrames: flight.age,
      seed: flight.seed,
      velocityX: now.x - before.x,
      velocityY: now.y - now.heightPx - (before.y - before.heightPx),
      urgent: false,
    };
    const progress = Math.min(1, flight.age / flight.flightFrames);
    if (flight.kind === 'black_powder') {
      drawBlackPowderBombFlight(ctx, sx, sy, TILE_SIZE, {
        ...burn,
        spin: progress * BOMB_SPIN_TURNS * FULL_TURN,
      });
      return;
    }
    const turnsLeft = (1 - progress) * STICK_TUMBLE_TURNS;
    drawLitDynamiteStick(ctx, sx, sy, TILE_SIZE, {
      ...burn,
      angle: stickRestAngle(flight.seed) - turnsLeft * FULL_TURN,
      fuseLeft: 1,
    });
  }

  /** A checkpoint restore must not resume a bomb thrown in the run that died. */
  resetForCheckpoint(): void {
    this.flights = [];
    this.sticks = [];
    this.explosions = [];
    this.scorches = [];
    this.lockedLandings.length = 0;
    this.cues = [];
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}

/**
 * What one goblin blast does to the bodies inside it. Shared by both
 * explosives.
 *
 * - Carl and Donut take the full blast, as the thrower's blow: the blast's
 *   share of each one's own max HP, which no dodge roll turns aside.
 * - A party-side mob (Mongo, a hireling, a soldier, a thrall, a converted mob,
 *   an attack cow) takes the full blast too, the same share of its own max HP.
 * - A hostile that hunts other mobs (`Mob.huntsOtherMobs`) takes the full
 *   damage: it is the goblins' enemy as much as the party's.
 * - Every other mob — the thrower and its pack included, bosses included —
 *   takes {@link GOBLIN_BLAST_DAMAGE_TO_BYSTANDER_MOBS}, through the normal
 *   damage door, so it can still finish a mob on its last point. That point is
 *   credited to nobody, so the kill is paid by whoever did the rest.
 *
 * Every mob still standing inside the radius is then thrown straight out from
 * the centre, hardest at the centre and not at all at the edge, unless it
 * resists a blast's shove (`Mob.resistsBlastKnockback`). The crawlers are
 * never shoved. A party-side mob that hostiles never target (Signet) still
 * takes the full blast like any other ally. The defend quest's NPC is not a
 * mob and is not handed in, so the blast passes her by.
 */
export function applyGoblinBlastToBodies(
  blast: GoblinBlast,
  crawlers: readonly Player[],
  mobs: Iterable<Mob>,
): void {
  for (const crawler of crawlers) {
    if (centreDistance(crawler, blast.x, blast.y) > blast.radiusPx) continue;
    crawler.takeDamage(goblinBlastDamage(blast.crawlerHpShare, crawler.maxHp), blast.source);
  }
  for (const mob of mobs) {
    if (!mob.isAlive) continue;
    const distance = centreDistance(mob, blast.x, blast.y);
    if (distance > blast.radiusPx) continue;
    const takesFullBlast = !mob.isHostile || mob.huntsOtherMobs;
    if (takesFullBlast) {
      mob.takeDamageFrom(
        goblinBlastDamage(blast.crawlerHpShare, mob.maxHp),
        blast.thrower,
        'explosion',
      );
    } else {
      // Struck by nobody: naming the thrower would turn its own pack on it,
      // and a mob the party wore down still pays the party for the finish.
      mob.takeDamageFrom(GOBLIN_BLAST_DAMAGE_TO_BYSTANDER_MOBS, null, 'explosion');
    }
    // Read off the health rather than `isAlive`: the blow above may have just killed it.
    const survived = mob.hp > 0;
    if (survived && !mob.resistsBlastKnockback) shoveFromBlast(mob, blast, distance);
  }
}

function shoveFromBlast(mob: Mob, blast: GoblinBlast, distance: number): void {
  const nearness = 1 - distance / blast.radiusPx;
  const pushPx =
    (TILE_SIZE * BLAST_KNOCKBACK_TILES * nearness) / Math.max(MIN_MASS_FOR_KNOCKBACK, mob.mass);
  if (pushPx < MIN_KNOCKBACK_PX) return;
  const awayX = mob.x + HALF_TILE - blast.x;
  const awayY = mob.y + HALF_TILE - blast.y;
  // A body dead on the centre has no "away"; it is thrown back the way it faces from.
  const atCentre = awayX === 0 && awayY === 0;
  const dirX = atCentre ? -mob.facingX : awayX;
  const dirY = atCentre ? -mob.facingY : awayY;
  if (dirX === 0 && dirY === 0) return;
  mob.applyKnockback(dirX, dirY, pushPx, BLAST_KNOCKBACK_FRAMES);
}

function centreDistance(body: Player, x: number, y: number): number {
  return Math.hypot(body.x + HALF_TILE - x, body.y + HALF_TILE - y);
}

/**
 * Where a lob is `age` frames into its flight: its ground point, on the
 * straight line to the landing so where it lands never depends on the arc,
 * and its height above that point — the lob's parabola plus the hand's
 * height, falling away to nothing at the landing.
 */
function flightPoint(flight: Flight, age: number): { x: number; y: number; heightPx: number } {
  const t = Math.min(1, age / flight.flightFrames);
  const arcPx = TILE_SIZE * GOBLIN_BOMB_ARC_HEIGHT_TILES * PARABOLA_PEAK_GAIN * t * (1 - t);
  return {
    x: flight.fromX + (flight.toX - flight.fromX) * t,
    y: flight.fromY + (flight.toY - flight.fromY) * t,
    heightPx: arcPx + flight.releaseHeightPx * (1 - t),
  };
}

/** Drops every blast whose picture has played out; a powder blast's plume outlasts dynamite's. */
function dropFinishedExplosions(list: Explosion[]): void {
  let kept = 0;
  for (const entry of list) {
    if (entry.ageFrames >= explosionTotalFrames(entry.kind)) continue;
    list[kept] = entry;
    kept++;
  }
  list.length = kept;
}

/** A burning stick's fuse as the fuse painters read it: its age, and whether it is in its last stretch. */
function stickBurn(stick: Stick): FuseBurnOptions {
  return {
    ageFrames: stick.litAgeAtLanding + stick.fuse.frames - stick.fuseFramesLeft,
    seed: stick.seed,
    velocityX: 0,
    velocityY: 0,
    urgent: stick.fuseFramesLeft <= stick.fuse.finalStretchFrames,
  };
}

/** A landed stick lies on its side, tipped a little differently each throw. */
const STICK_REST_TURN = Math.PI / 2;
const STICK_REST_TILT_SPREAD = 0.6;
/** Golden-ratio stride, so consecutive seeds tip their sticks far apart. */
const STICK_TILT_STRIDE = 0.618034;

/** The angle a stick comes to rest at; its tumble in the air ends on it, so it lands without a snap. */
function stickRestAngle(seed: number): number {
  const scatter = (seed * STICK_TILT_STRIDE) % 1;
  return STICK_REST_TURN + (scatter - 1 / 2) * STICK_REST_TILT_SPREAD;
}

/** Drops, in place, every entry `maxAgeFrames` old or older. */
function keepYoungerThan(list: { ageFrames: number }[], maxAgeFrames: number): void {
  let kept = 0;
  for (const entry of list) {
    if (entry.ageFrames >= maxAgeFrames) continue;
    list[kept] = entry;
    kept++;
  }
  list.length = kept;
}
