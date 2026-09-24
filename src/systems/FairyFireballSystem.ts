/**
 * Owns everything a fire fairy's fire turns into once it has left the fairy:
 * the lobbed ball, the charge it leaves where it lands, that charge's
 * explosion, and the flame patch and mini-explosion a fire fairy leaves when
 * it dies.
 *
 * A system rather than state on the creature because every one of these
 * outlives the fairy that made it. A mob stops updating and drawing the frame
 * it dies, and a ball in the air, a charge on the floor or the flame of the
 * fairy's own death must not vanish with it. The fairies queue their throws
 * (`FireFairy.takePendingFireballs`) and this drains them, as `ClownGasSystem`
 * drains the Evil Clown's vials.
 *
 * Every radial burst here deals flat damage: a blast whose size is telegraphed
 * on the floor must hurt the same at every level, or the telegraph stops
 * telling the player what standing in it costs.
 */

import type { DamageSource, Player } from '../Player';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import { makeBurn } from '../core/StatusEffect';
import { FireFairy } from '../creatures/fairies/FireFairy';
import {
  DEATH_EXPLOSION_DAMAGE,
  DEATH_EXPLOSION_RADIUS_TILES,
  DEATH_FLAME_FRAMES,
  DEATH_FLAME_RADIUS_TILES,
  DEATH_FLAME_TICK_DAMAGE,
  DEATH_FLAME_TICK_FRAMES,
  FIREBALL_ARC_HEIGHT_TILES,
  FIREBALL_BLAST_RADIUS_TILES,
  FIREBALL_BURN_CHANCE,
  FIREBALL_FLIGHT_FRAMES,
  FIREBALL_FUSE_FRAMES,
  FIREBALL_HAZARD_MARGIN_TILES,
  FIREBALL_HIT_RADIUS_PX,
  FIREBALL_MAX_RANGE_TILES,
  FIREBALL_RETICLE_RADIUS_FRACTION,
} from '../creatures/fairies/fairyTuning';
import {
  drawChargeCore,
  drawExplosion,
  drawFillingDangerCircle,
  drawFireballFlight,
  drawFlamePatch,
  drawLandingReticle,
  type FireballTrailPoint,
} from '../sprites/art/fairyEffectsArt';
import { collectFairyPartyTargets } from './fairyPartyTargets';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource, HazardEscape } from './GroundHazardSource';

/** Attack types the death screen names; one per way this fire can hurt. */
export const FIREBALL_ATTACK_TYPE = 'fireball';
export const FIREBALL_BLAST_ATTACK_TYPE = 'fireball_blast';
export const DEATH_FLAME_ATTACK_TYPE = 'death_flame';
export const DEATH_EXPLOSION_ATTACK_TYPE = 'death_explosion';

/**
 * A sound this system asks the scene to play or end; drained with
 * {@link FairyFireballSystem.takeCues}. `deathFlamesOut` is raised when the
 * last death flame on the floor is gone — exploded or cleared by a checkpoint
 * restore — since the burning sample outlasts any one flame and has nothing
 * else to end it.
 */
export type FairyFireballCue =
  'fireballLand' | 'chargeExplode' | 'deathFlame' | 'deathExplosion' | 'deathFlamesOut';

/** What the system reads from the scene it lives in. */
export interface FairyFireballSystemDeps {
  readonly bus: EventBus;
  readonly gameMap: GameMap;
  readonly getMobs: () => readonly Mob[];
}

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;

/**
 * Scales the normalised parabola `t(1-t)`, whose own peak is 1/4, so the lob's
 * apex is exactly {@link FIREBALL_ARC_HEIGHT_TILES}.
 */
const PARABOLA_PEAK_NORMALISER = 4;

/** Past positions drawn behind a ball in flight, and the frames between them. */
const TRAIL_POINTS = 6;
const TRAIL_STEP_FRAMES = 4;

/** Compass directions tried when the summed push out of overlapping zones leads nowhere. */
const ESCAPE_SEARCH_DIRECTIONS = 16;
const FULL_TURN_RADIANS = Math.PI * 2;

/**
 * Push, in pixels of depth, across the line through two zone centres below
 * which a body counts as standing on that line.
 */
const ON_CENTRE_LINE_PUSH_PX = 0.5;

/** Share of the deepest zone's depth below which the summed push counts as cancelled out. */
const CANCELLED_PUSH_FRACTION = 0.05;

/** Spacing, as a share of a tile, of the wall checks along a searched way out. */
const ESCAPE_WALL_CHECK_STEP_TILES = 0.25;

/**
 * How much shorter a searched way out must be to beat an earlier direction;
 * mirror-image directions differ only by rounding, and the earlier one wins.
 */
const EXIT_TIE_TOLERANCE_PX = 1e-6;

/** Frames an explosion takes to play out on screen; its damage lands on the first. */
const EXPLOSION_FRAMES = 36;

/**
 * One circle of ground this system is about to hurt, as the companion and the
 * mobs' tactics see it. `radiusPx` is the hurt radius plus any clearance a
 * steering body should keep from it.
 */
export interface FireHazardZone {
  readonly kind: 'landing' | 'charge' | 'deathFlame';
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
}

/** A ball still in the air: where it will land, how long it has flown, and for how long it flies. */
export interface FireballInFlight {
  readonly toX: number;
  readonly toY: number;
  readonly age: number;
  readonly flightFrames: number;
}

interface Fireball {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly flightFrames: number;
  /** How high above `from` the ball left the thrower's hands. */
  readonly releaseHeightPx: number;
  readonly damage: number;
  readonly burstDamage: number;
  /**
   * The fairy that threw it. May well be dead by the time the ball lands; it is
   * read only to name the blow and to note blood while the fairy lives.
   */
  readonly owner: FireFairy;
  readonly seed: number;
  age: number;
}

interface Charge {
  readonly x: number;
  readonly y: number;
  readonly burstDamage: number;
  readonly owner: FireFairy;
  readonly seed: number;
  age: number;
}

interface DeathFlame {
  readonly x: number;
  readonly y: number;
  readonly owner: FireFairy;
  readonly seed: number;
  age: number;
}

interface Explosion {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  readonly seed: number;
  age: number;
}

export class FairyFireballSystem implements GameSystem, GroundHazardSource {
  private fireballs: Fireball[] = [];
  private charges: Charge[] = [];
  private flames: DeathFlame[] = [];
  private explosions: Explosion[] = [];
  /** Fire fairies that died since the last update; their flame needs the frame's context. */
  private pendingDeaths: FireFairy[] = [];

  private readonly cues = new Set<FairyFireballCue>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly partyScratch: Player[] = [];
  private readonly zoneScratch: FireHazardZone[] = [];
  private frame = 0;
  private nextSeed = 0;

  constructor(private readonly deps: FairyFireballSystemDeps) {
    this.unsubscribers.push(
      deps.bus.on('mobKilled', (event) => {
        const mob = event.mob;
        if (mob instanceof FireFairy && deps.getMobs().includes(mob)) {
          this.pendingDeaths.push(mob);
        }
      }),
    );
  }

  /** The cues raised since the last call, for the scene to play. */
  takeCues(): readonly FairyFireballCue[] {
    if (this.cues.size === 0) return [];
    const taken = [...this.cues];
    this.cues.clear();
    return taken;
  }

  /** Live charges, for gates and for anything that has to reason about the floor. */
  get liveCharges(): readonly { readonly x: number; readonly y: number; readonly age: number }[] {
    return this.charges;
  }

  /** Balls in the air, for gates and for anything that has to reason about the floor. */
  get liveFireballs(): readonly FireballInFlight[] {
    return this.fireballs;
  }

  /** Live death flames, as above. */
  get liveFlames(): readonly { readonly x: number; readonly y: number; readonly age: number }[] {
    return this.flames;
  }

  update(ctx: SystemContext): void {
    this.frame++;
    this.collectThrows(ctx.roster.mobs);
    const deaths = this.pendingDeaths;
    this.pendingDeaths = [];
    for (const fairy of deaths) this.igniteDeathFlame(fairy);

    collectFairyPartyTargets(ctx, this.partyScratch);
    const party = this.partyScratch;
    // Charges before the balls that land this frame, so a fresh charge's fuse
    // starts on its landing frame rather than one frame in.
    this.advanceCharges(party);
    this.advanceFlames(party);
    this.advanceFireballs(party);
    this.partyScratch.length = 0;
    for (const explosion of this.explosions) explosion.age++;
    this.explosions = this.explosions.filter((explosion) => explosion.age < EXPLOSION_FRAMES);
  }

  /**
   * Drains every fire fairy's released throws, the dead included: a fairy
   * killed on the frame it let go still threw the ball.
   */
  private collectThrows(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof FireFairy)) continue;
      for (const thrown of mob.takePendingFireballs()) {
        const landing = this.clampThrow(thrown.fromX, thrown.fromY, thrown.toX, thrown.toY);
        this.fireballs.push({
          fromX: thrown.fromX,
          fromY: thrown.fromY,
          toX: landing.x,
          toY: landing.y,
          flightFrames: this.flightFrames,
          releaseHeightPx: mob.hoverLiftPx,
          damage: thrown.damage,
          burstDamage: thrown.burstDamage,
          owner: mob,
          seed: this.seed(),
          age: 0,
        });
      }
    }
  }

  /** Frames every ball spends in the air, from the throw frame to its landing. */
  protected get flightFrames(): number {
    return FIREBALL_FLIGHT_FRAMES;
  }

  /**
   * Pulls a landing point in to {@link FIREBALL_MAX_RANGE_TILES}. The flight
   * takes a fixed time, so the range cap is what caps the ball's ground speed
   * against the crawler's.
   */
  private clampThrow(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): { x: number; y: number } {
    const maxPx = TILE_SIZE * FIREBALL_MAX_RANGE_TILES;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance <= maxPx) return { x: toX, y: toY };
    const scale = maxPx / distance;
    return { x: fromX + (toX - fromX) * scale, y: fromY + (toY - fromY) * scale };
  }

  private advanceFireballs(party: readonly Player[]): void {
    const flying: Fireball[] = [];
    for (const ball of this.fireballs) {
      ball.age++;
      if (ball.age < ball.flightFrames) flying.push(ball);
      else this.land(ball, party);
    }
    this.fireballs = flying;
  }

  /**
   * The ball comes down: anyone under it takes the direct hit, and it becomes a
   * charge on the floor whether it hit anyone or not. A ball that would come
   * down inside a wall lands at the fairy's feet instead, so its charge never
   * sits somewhere nobody can reach or leave.
   */
  private land(ball: Fireball, party: readonly Player[]): void {
    const walkable = this.gameMap.isWalkable(
      Math.floor(ball.toX / TILE_SIZE),
      Math.floor(ball.toY / TILE_SIZE),
    );
    const x = walkable ? ball.toX : ball.fromX;
    const y = walkable ? ball.toY : ball.fromY;
    const source = this.sourceFor(ball.owner, FIREBALL_ATTACK_TYPE, x, y, false);
    for (const target of party) {
      if (!target.isAlive || distanceToCentre(target, x, y) > FIREBALL_HIT_RADIUS_PX) continue;
      const connected = target.takeDamage(ball.damage, source);
      if (connected) this.noteBlood(ball.owner, target);
    }
    this.charges.push({
      x,
      y,
      burstDamage: ball.burstDamage,
      owner: ball.owner,
      seed: ball.seed,
      age: 0,
    });
    this.cues.add('fireballLand');
  }

  private advanceCharges(party: readonly Player[]): void {
    const fused: Charge[] = [];
    for (const charge of this.charges) {
      charge.age++;
      if (charge.age < FIREBALL_FUSE_FRAMES) {
        fused.push(charge);
        continue;
      }
      const radiusPx = TILE_SIZE * FIREBALL_BLAST_RADIUS_TILES;
      const source = this.sourceFor(
        charge.owner,
        FIREBALL_BLAST_ATTACK_TYPE,
        charge.x,
        charge.y,
        false,
      );
      for (const target of party) {
        if (!target.isAlive || distanceToCentre(target, charge.x, charge.y) > radiusPx) continue;
        const connected = target.takeDamage(charge.burstDamage, source);
        if (!connected) continue;
        this.noteBlood(charge.owner, target);
        if (Math.random() < FIREBALL_BURN_CHANCE) target.applyStatus(makeBurn());
      }
      this.explosions.push({ x: charge.x, y: charge.y, radiusPx, seed: charge.seed, age: 0 });
      this.cues.add('chargeExplode');
    }
    this.charges = fused;
  }

  private igniteDeathFlame(fairy: FireFairy): void {
    const { x, y } = fairy.groundCentre;
    this.flames.push({ x, y, owner: fairy, seed: this.seed(), age: 0 });
    this.cues.add('deathFlame');
  }

  /**
   * The death flame burns whoever stands in it on a fixed beat and never sets
   * them alight — the flame is the warning, and a burn that followed the
   * crawler out of it would punish the step that answered it. When it has
   * burned its full time it goes off.
   */
  private advanceFlames(party: readonly Player[]): void {
    const burning: DeathFlame[] = [];
    const flamePx = TILE_SIZE * DEATH_FLAME_RADIUS_TILES;
    for (const flame of this.flames) {
      flame.age++;
      if (flame.age % DEATH_FLAME_TICK_FRAMES === 0 && flame.age < DEATH_FLAME_FRAMES) {
        const source = this.sourceFor(flame.owner, DEATH_FLAME_ATTACK_TYPE, flame.x, flame.y, true);
        for (const target of party) {
          if (!target.isAlive || distanceToCentre(target, flame.x, flame.y) > flamePx) continue;
          target.takeDamage(DEATH_FLAME_TICK_DAMAGE, source);
        }
      }
      if (flame.age < DEATH_FLAME_FRAMES) {
        burning.push(flame);
        continue;
      }
      const blastPx = TILE_SIZE * DEATH_EXPLOSION_RADIUS_TILES;
      const source = this.sourceFor(
        flame.owner,
        DEATH_EXPLOSION_ATTACK_TYPE,
        flame.x,
        flame.y,
        false,
      );
      for (const target of party) {
        if (!target.isAlive || distanceToCentre(target, flame.x, flame.y) > blastPx) continue;
        target.takeDamage(DEATH_EXPLOSION_DAMAGE, source);
      }
      this.explosions.push({
        x: flame.x,
        y: flame.y,
        radiusPx: blastPx,
        seed: flame.seed,
        age: 0,
      });
      this.cues.add('deathExplosion');
    }
    const lastFlameWentOut = this.flames.length > 0 && burning.length === 0;
    this.flames = burning;
    if (lastFlameWentOut) this.cues.add('deathFlamesOut');
  }

  /**
   * Names the blow for the death screen. `undodgeable` is for standing fire:
   * there is no sidestepping a floor you are already standing on, and a dodge
   * roll against it would let a player farm dodge-trained skills by parking in
   * it.
   */
  private sourceFor(
    owner: FireFairy,
    attackType: string,
    x: number,
    y: number,
    undodgeable: boolean,
  ): DamageSource {
    return owner.stampBlowCap({
      kind: 'mob',
      mobType: owner.mobType,
      attackType,
      undodgeable,
      from: { x, y },
    });
  }

  /** A hit counts as the fairy's blow only while it lives: a corpse is nobody's target. */
  private noteBlood(owner: FireFairy, target: Player): void {
    if (owner.isAlive) owner.noteStruckPlayer(target);
  }

  private get gameMap(): GameMap {
    return this.deps.gameMap;
  }

  private seed(): number {
    this.nextSeed++;
    return this.nextSeed;
  }

  /**
   * Every circle of ground this system is about to hurt: each ball's landing
   * from the throw on, each landed charge's blast, and each death flame's
   * coming explosion. A landing counts from the throw, not from the landing —
   * a follower that waits for the ball to come down is already standing under
   * it — and a charge from its landing, not from when it goes off.
   */
  protected hazardZones(): readonly FireHazardZone[] {
    const zones = this.zoneScratch;
    zones.length = 0;
    const clearancePx = TILE_SIZE * FIREBALL_HAZARD_MARGIN_TILES;
    const fireballPx = TILE_SIZE * FIREBALL_BLAST_RADIUS_TILES + clearancePx;
    const explosionPx = TILE_SIZE * DEATH_EXPLOSION_RADIUS_TILES;
    for (const ball of this.fireballs) {
      zones.push({ kind: 'landing', x: ball.toX, y: ball.toY, radiusPx: fireballPx });
    }
    for (const charge of this.charges) {
      zones.push({ kind: 'charge', x: charge.x, y: charge.y, radiusPx: fireballPx });
    }
    for (const flame of this.flames) {
      zones.push({ kind: 'deathFlame', x: flame.x, y: flame.y, radiusPx: explosionPx });
    }
    return zones;
  }

  /**
   * `GroundHazardSource`: out of every zone containing (x, y) at once. Each
   * zone pushes outward from its own centre, harder the deeper the point sits
   * in it, so a body standing where two landings overlap — a twin lob at a
   * crawler and the companion at their heels — is sent out of both, never out
   * of one and into the other. On the line through two zones' centres that
   * sum has no way out in it, so there the shortest walkable way out of every
   * zone is searched for instead — which also covers a corridor whose walls
   * rule out stepping sideways off that line.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const zones = this.hazardZones();
    if (zones.length === 0) return null;
    const cx = x + TILE_SIZE * TILE_CENTRE;
    const cy = y + TILE_SIZE * TILE_CENTRE;
    let containing = 0;
    let deepest: FireHazardZone | null = null;
    let deepestDepth = 0;
    let secondDeepest: FireHazardZone | null = null;
    let secondDeepestDepth = 0;
    let pushX = 0;
    let pushY = 0;
    for (const zone of zones) {
      const offsetX = cx - zone.x;
      const offsetY = cy - zone.y;
      const distance = Math.hypot(offsetX, offsetY);
      const depth = zone.radiusPx - distance;
      if (depth <= 0) continue;
      containing++;
      if (depth > deepestDepth) {
        secondDeepest = deepest;
        secondDeepestDepth = deepestDepth;
        deepest = zone;
        deepestDepth = depth;
      } else if (depth > secondDeepestDepth) {
        secondDeepest = zone;
        secondDeepestDepth = depth;
      }
      // Dead centre has no outward direction of its own; the other zones, or
      // the fallback below, choose one.
      if (distance === 0) continue;
      pushX += (offsetX / distance) * depth;
      pushY += (offsetY / distance) * depth;
    }
    if (containing === 0) return null;
    const length = Math.hypot(pushX, pushY);
    const overlapPushIsNoWayOut =
      deepest !== null &&
      secondDeepest !== null &&
      (length < deepestDepth * CANCELLED_PUSH_FRACTION ||
        pushAcrossCentreLine(pushX, pushY, deepest, secondDeepest) < ON_CENTRE_LINE_PUSH_PX);
    if (overlapPushIsNoWayOut) {
      const searched = this.shortestWalkableExit(cx, cy, zones);
      if (searched !== null) return searched;
    }
    if (length === 0) return { dx: 1, dy: 0 };
    return { dx: pushX / length, dy: pushY / length };
  }

  /**
   * The compass direction from (cx, cy) that leaves every zone soonest without
   * crossing a wall, or null when every one of them is walled. Lowest index
   * wins a tie, so a body standing exactly between two equal zones is sent the
   * same way every frame rather than whichever way rounding favours.
   */
  private shortestWalkableExit(
    cx: number,
    cy: number,
    zones: readonly FireHazardZone[],
  ): HazardEscape | null {
    let best: HazardEscape | null = null;
    let bestDistance = Infinity;
    for (let index = 0; index < ESCAPE_SEARCH_DIRECTIONS; index++) {
      const angle = (index / ESCAPE_SEARCH_DIRECTIONS) * FULL_TURN_RADIANS;
      const direction = { dx: Math.cos(angle), dy: Math.sin(angle) };
      const exitDistance = distanceOutOfZones(cx, cy, direction, zones);
      const isShorter = exitDistance < bestDistance - EXIT_TIE_TOLERANCE_PX;
      if (!isShorter || !this.rayIsWalkable(cx, cy, direction, exitDistance)) continue;
      best = direction;
      bestDistance = exitDistance;
    }
    return best;
  }

  /** Whether every tile under the ray from (cx, cy) out to `distance` can be walked. */
  private rayIsWalkable(
    cx: number,
    cy: number,
    direction: HazardEscape,
    distance: number,
  ): boolean {
    const stepPx = TILE_SIZE * ESCAPE_WALL_CHECK_STEP_TILES;
    for (
      let travelled = Math.min(stepPx, distance);
      ;
      travelled = Math.min(distance, travelled + stepPx)
    ) {
      const tileX = Math.floor((cx + direction.dx * travelled) / TILE_SIZE);
      const tileY = Math.floor((cy + direction.dy * travelled) / TILE_SIZE);
      if (!this.gameMap.isWalkable(tileX, tileY)) return false;
      if (travelled >= distance) return true;
    }
  }

  /** Floor-level fire: landing warnings, charges and their warnings, the death flames. Under creatures. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const blastPx = TILE_SIZE * FIREBALL_BLAST_RADIUS_TILES;
    for (const ball of this.fireballs) {
      this.drawLandingWarning(ctx, ball.toX - camX, ball.toY - camY, ball.age / ball.flightFrames);
    }
    for (const flame of this.flames) {
      const progress = flame.age / DEATH_FLAME_FRAMES;
      const sx = flame.x - camX;
      const sy = flame.y - camY;
      drawFillingDangerCircle(ctx, sx, sy, TILE_SIZE * DEATH_EXPLOSION_RADIUS_TILES, progress);
      drawFlamePatch(
        ctx,
        sx,
        sy,
        TILE_SIZE * DEATH_FLAME_RADIUS_TILES,
        progress,
        this.frame,
        flame.seed,
      );
    }
    for (const charge of this.charges) {
      const progress = charge.age / FIREBALL_FUSE_FRAMES;
      const sx = charge.x - camX;
      const sy = charge.y - camY;
      drawFillingDangerCircle(ctx, sx, sy, blastPx, progress);
      drawChargeCore(ctx, sx, sy, TILE_SIZE, progress, this.frame, charge.seed);
    }
  }

  /**
   * The mark on a ball's landing for its whole flight: the blast's full red
   * danger circle, filling as the ball comes down, so the ground the crawler
   * has to leave is shown from the throw rather than only once the ball has
   * landed and the fuse is burning. The reticle inside it says the ball is
   * still in the air.
   */
  protected drawLandingWarning(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    flightProgress: number,
  ): void {
    const blastPx = TILE_SIZE * FIREBALL_BLAST_RADIUS_TILES;
    drawFillingDangerCircle(ctx, sx, sy, blastPx, flightProgress);
    drawLandingReticle(
      ctx,
      sx,
      sy,
      blastPx * FIREBALL_RETICLE_RADIUS_FRACTION,
      flightProgress,
      this.frame,
    );
  }

  /** Balls in the air and explosions, over creatures so neither hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const ball of this.fireballs) {
      const trail: FireballTrailPoint[] = [];
      for (let step = TRAIL_POINTS; step >= 0; step--) {
        const age = Math.max(0, ball.age - step * TRAIL_STEP_FRAMES);
        const point = flightPoint(ball, age);
        trail.push({ x: point.x - camX, y: point.y - point.heightPx - camY });
      }
      const now = flightPoint(ball, ball.age);
      drawFireballFlight(
        ctx,
        trail,
        now.x - camX,
        now.y - camY,
        now.heightPx,
        TILE_SIZE,
        this.frame,
        ball.seed,
      );
    }
    for (const explosion of this.explosions) {
      drawExplosion(
        ctx,
        explosion.x - camX,
        explosion.y - camY,
        explosion.radiusPx,
        explosion.age / EXPLOSION_FRAMES,
        explosion.seed,
      );
    }
  }

  /** A checkpoint restore must not resume fire from the run that died. */
  resetForCheckpoint(): void {
    this.fireballs = [];
    this.charges = [];
    this.flames = [];
    this.explosions = [];
    this.pendingDeaths = [];
    this.cues.clear();
    this.cues.add('deathFlamesOut');
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}

/**
 * How hard the summed push out of two zones points across the line through
 * their centres. On that line both zones push along it, so their sum points
 * at the balance point between them rather than out: a body following it
 * slides there and shakes in place until both have gone off. Two zones on the
 * same spot have no line, and their shared outward push is a real way out.
 */
function pushAcrossCentreLine(
  pushX: number,
  pushY: number,
  first: FireHazardZone,
  second: FireHazardZone,
): number {
  const lineX = second.x - first.x;
  const lineY = second.y - first.y;
  const lineLength = Math.hypot(lineX, lineY);
  if (lineLength === 0) return Infinity;
  return Math.abs(pushX * lineY - pushY * lineX) / lineLength;
}

/**
 * How far from (cx, cy) along `direction` the ray leaves every zone. A ray
 * that has left a circle never re-enters it, so each zone can move the exit at
 * most once and the walk ends within one pass per zone.
 */
function distanceOutOfZones(
  cx: number,
  cy: number,
  direction: HazardEscape,
  zones: readonly FireHazardZone[],
): number {
  let travelled = 0;
  for (let passesLeft = zones.length; passesLeft > 0; passesLeft--) {
    const x = cx + direction.dx * travelled;
    const y = cy + direction.dy * travelled;
    let furthest = travelled;
    for (const zone of zones) {
      const offsetX = x - zone.x;
      const offsetY = y - zone.y;
      if (Math.hypot(offsetX, offsetY) >= zone.radiusPx) continue;
      const along = offsetX * direction.dx + offsetY * direction.dy;
      const squaredMiss = offsetX * offsetX + offsetY * offsetY - along * along;
      const halfChord = Math.sqrt(Math.max(0, zone.radiusPx * zone.radiusPx - squaredMiss));
      furthest = Math.max(furthest, travelled - along + halfChord);
    }
    if (furthest === travelled) return travelled;
    travelled = furthest;
  }
  return travelled;
}

function distanceToCentre(target: Player, x: number, y: number): number {
  return Math.hypot(target.x + TILE_SIZE * TILE_CENTRE - x, target.y + TILE_SIZE * TILE_CENTRE - y);
}

/**
 * Where a ball is `age` frames into its flight: its point on the ground and its
 * height above it. The ground point is a straight line, so where it lands never
 * depends on the arc; the height is the lob's parabola plus the height it left
 * the fairy's hands at, decaying to nothing at the landing.
 */
function flightPoint(ball: Fireball, age: number): { x: number; y: number; heightPx: number } {
  const t = Math.min(1, age / ball.flightFrames);
  const arcPx = TILE_SIZE * FIREBALL_ARC_HEIGHT_TILES * PARABOLA_PEAK_NORMALISER * t * (1 - t);
  const releasePx = ball.releaseHeightPx * (1 - t);
  return {
    x: ball.fromX + (ball.toX - ball.fromX) * t,
    y: ball.fromY + (ball.toY - ball.fromY) * t,
    heightPx: arcPx + releasePx,
  };
}
