/**
 * The Fury of Taranis's swing: the blade's cut, the slicing wave of lightning
 * it throws along the blow, and the chain lightning every cut enemy throws on.
 *
 * One swing strikes an enemy at most once, whether the blade, the wave or a
 * chain reaches it first: each swing carries the set of everything it has
 * struck from the blade's cut to the wave's last tick. Chains do not chain —
 * only an enemy cut by the blade or the wave throws one.
 *
 * Owned by `CombatKit`: `CombatSystem.resolvePlayerAttacks` hands the swing
 * here on the strike's peak tick, and the kit ticks the waves straight after,
 * so a wave's cuts are resolved in the same phase as every other blow and
 * paid out by the same kill resolution.
 */

import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import { TARANIS_LIGHTNING } from '../sprites/art/taranisPalette';
import {
  type CombatContext,
  crawlerMeleeStrikeDamage,
  landHumanGearProcs,
  MELEE_POINT_BLANK_RANGE,
} from './CombatSystem';
import type { DynamicLightSink } from './lighting/dynamicLights';

const HALF_TILE = TILE_SIZE / 2;

/** Every cut from the sword, blade or wave, lands this many times the blow a fist would. */
export const TARANIS_DAMAGE_MULTIPLIER = 2;
/** How far the wave runs from his centre before it spends itself. */
export const TARANIS_WAVE_REACH_TILES = 3;
/** How far either side of its line the wave catches a body, measured to the body's centre. */
const WAVE_HALF_WIDTH_TILES = 0.75;
const WAVE_HALF_WIDTH_PX = WAVE_HALF_WIDTH_TILES * TILE_SIZE;
/** Ticks the wave takes to cover its reach, and to fade out once it has. */
const WAVE_TRAVEL_TICKS = 10;
const WAVE_FADE_TICKS = 12;
/** How finely the wave's path is probed for the wall that stops it. */
const WALL_PROBES_PER_TILE = 4;
/** How far a cut enemy's chain lightning reaches, centre to centre. */
export const TARANIS_CHAIN_RADIUS_TILES = 3;
/** How many other enemies one cut enemy's chain lightning can reach. */
export const TARANIS_CHAIN_MAX_TARGETS = 4;

// ── The wave's picture ───────────────────────────────────────────────────────
/** Points along the crescent; each is jittered every frame, which is the flicker. */
const ARC_POINTS = 9;
/** How far the crescent's tips trail behind its middle, as a share of its half-width. */
const ARC_BOW = 0.45;
/** How far each point strays off the crescent, in world pixels. */
const ARC_JITTER_PX = 3;
const ARC_GLOW_WIDTH = 5;
const ARC_GLOW_ALPHA = 0.35;
const ARC_WIDTH = 2;
const ARC_ALPHA = 0.9;
const ARC_CORE_WIDTH = 1;
/** Lowest a frame's flicker can dim the arc to, and how much more it flickers as it fades. */
const FLICKER_FLOOR = 0.65;
const FADING_FLICKER_FLOOR = 0.25;
/** The crescent is drawn only once it has cleared his body, so it leaves the blade rather than his chest. */
const ARC_MIN_FRONT_PX = TILE_SIZE / 2;

interface Wave {
  readonly originX: number;
  readonly originY: number;
  readonly dirX: number;
  readonly dirY: number;
  /** How far it runs before the wall or its own reach stops it, in world pixels. */
  readonly reachPx: number;
  frontPx: number;
  age: number;
  /** Everything this swing has struck, shared with its blade cut and chains. */
  readonly struck: Set<Mob>;
}

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

function centreOf(entity: WorldPoint): WorldPoint {
  return { x: entity.x + HALF_TILE, y: entity.y + HALF_TILE };
}

export class TaranisStrikeSystem {
  private waves: Wave[] = [];
  private swungThisTick = false;
  private cutThisTick = false;
  private chainedThisTick = false;

  /**
   * Lands the blade's cut on everything in his reach and facing, exactly as a
   * fist would find it, and sends the wave off along the facing the blow was
   * thrown with.
   */
  swing(ctx: CombatContext): void {
    const { human, mobGrid, gameMap } = ctx;
    const origin = centreOf(human);
    const facingLength = Math.hypot(human.strikeFacingX, human.strikeFacingY);
    const dirX = facingLength > 0 ? human.strikeFacingX / facingLength : 1;
    const dirY = facingLength > 0 ? human.strikeFacingY / facingLength : 0;
    const range = human.getMeleeRange();
    const wave: Wave = {
      originX: origin.x,
      originY: origin.y,
      dirX,
      dirY,
      reachPx: clearReach(gameMap, origin, dirX, dirY),
      frontPx: 0,
      age: 0,
      struck: new Set<Mob>(),
    };
    this.waves.push(wave);

    const inArc: Mob[] = [];
    // Widened by a tile because the grid keys a mob by its origin while the
    // test measures its centre.
    for (const mob of mobGrid.queryCircle(origin.x, origin.y, range + TILE_SIZE)) {
      if (!this.canStrike(mob, wave.struck)) continue;
      const centre = centreOf(mob);
      const dx = centre.x - origin.x;
      const dy = centre.y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      const ahead = (dx / dist) * dirX + (dy / dist) * dirY > 0;
      if (dist > MELEE_POINT_BLANK_RANGE && !ahead) continue;
      if (!gameMap.hasLineOfSight(origin.x, origin.y, centre.x, centre.y)) continue;
      inArc.push(mob);
    }
    this.landCuts(ctx, wave, inArc);
    let bladeHit = inArc.length > 0;

    if (!human.zeroDamage) {
      const propDamage = TARANIS_DAMAGE_MULTIPLIER * human.getBladeDamage();
      bladeHit = (ctx.destructibles?.tryMeleeHit(human, range, propDamage) ?? false) || bladeHit;
      bladeHit = (ctx.interiorProps?.tryMeleeHit(human, range, propDamage) ?? false) || bladeHit;
      bladeHit = (ctx.trees?.tryMeleeHit(human, range, propDamage) ?? false) || bladeHit;
      bladeHit = (ctx.structures?.tryMeleeHit(human, range) ?? false) || bladeHit;
    }
    if (bladeHit) {
      const contact = human.strikeContactWorldPosition();
      if (contact !== null) ctx.meleeFx?.spawn(contact.x, contact.y, dirX, dirY);
    }

    this.swungThisTick = true;
  }

  /**
   * Runs every wave on by a tick, cutting what its front passes through, and
   * sounds what the tick's swings did — once each, however many swings, cuts
   * or chains there were.
   */
  update(ctx: CombatContext): void {
    for (const wave of this.waves) {
      wave.age++;
      if (wave.frontPx < wave.reachPx) this.advance(ctx, wave);
    }
    this.waves = this.waves.filter((wave) => wave.age < WAVE_TRAVEL_TICKS + WAVE_FADE_TICKS);

    if (this.swungThisTick) ctx.bus.emit('taranisSwing', {});
    if (this.cutThisTick) ctx.bus.emit('taranisStrike', {});
    if (this.chainedThisTick) ctx.bus.emit('taranisChain', {});
    this.swungThisTick = false;
    this.cutThisTick = false;
    this.chainedThisTick = false;
  }

  /** Drops every wave in flight, for a floor left behind or a rewound world. */
  reset(): void {
    this.waves = [];
    this.swungThisTick = false;
    this.cutThisTick = false;
    this.chainedThisTick = false;
  }

  /** Each wave's front lights the room as it goes, and dims as it fades. */
  collectLights(sink: DynamicLightSink): void {
    for (const wave of this.waves) {
      if (wave.frontPx < ARC_MIN_FRONT_PX) continue;
      sink.add(
        wave.originX + wave.dirX * wave.frontPx,
        wave.originY + wave.dirY * wave.frontPx,
        'lightning',
        waveAlpha(wave),
      );
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.waves.length === 0) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const wave of this.waves) {
      if (wave.frontPx < ARC_MIN_FRONT_PX) continue;
      const fading = wave.age >= WAVE_TRAVEL_TICKS;
      const floor = fading ? FADING_FLICKER_FLOOR : FLICKER_FLOOR;
      const alpha = waveAlpha(wave) * (floor + Math.random() * (1 - floor));
      traceCrescent(ctx, wave, camX, camY);
      ctx.globalAlpha = alpha * ARC_GLOW_ALPHA;
      ctx.strokeStyle = TARANIS_LIGHTNING.glow;
      ctx.lineWidth = ARC_GLOW_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = alpha * ARC_ALPHA;
      ctx.strokeStyle = TARANIS_LIGHTNING.arc;
      ctx.lineWidth = ARC_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = TARANIS_LIGHTNING.core;
      ctx.lineWidth = ARC_CORE_WIDTH;
      ctx.stroke();
    }
    ctx.restore();
  }

  private advance(ctx: CombatContext, wave: Wave): void {
    const stepPx = (TARANIS_WAVE_REACH_TILES * TILE_SIZE) / WAVE_TRAVEL_TICKS;
    // The band reaches a step behind the old front as well, so a body that
    // stepped toward him as the front arrived is still caught; the struck set
    // keeps it from being cut twice.
    const behindPx = Math.max(0, wave.frontPx - stepPx);
    const frontPx = Math.min(wave.reachPx, wave.frontPx + stepPx);
    wave.frontPx = frontPx;
    const midAlong = (behindPx + frontPx) / 2;
    const midX = wave.originX + wave.dirX * midAlong;
    const midY = wave.originY + wave.dirY * midAlong;
    const searchRadius = (frontPx - behindPx) / 2 + WAVE_HALF_WIDTH_PX + TILE_SIZE;
    const inBand: Mob[] = [];
    for (const mob of ctx.mobGrid.queryCircle(midX, midY, searchRadius)) {
      if (!this.canStrike(mob, wave.struck)) continue;
      const centre = centreOf(mob);
      const dx = centre.x - wave.originX;
      const dy = centre.y - wave.originY;
      const along = dx * wave.dirX + dy * wave.dirY;
      const across = Math.abs(dx * wave.dirY - dy * wave.dirX);
      if (along <= behindPx || along > frontPx || across > WAVE_HALF_WIDTH_PX) continue;
      if (!ctx.gameMap.hasLineOfSight(wave.originX, wave.originY, centre.x, centre.y)) continue;
      inBand.push(mob);
    }
    this.landCuts(ctx, wave, inBand);
  }

  /**
   * Cuts every target one stroke found, then throws each cut's chains. All of
   * them are claimed before any chain is thrown, so which of them the grid
   * happens to list first never decides who takes the cut and who a chain.
   */
  private landCuts(ctx: CombatContext, wave: Wave, targets: readonly Mob[]): void {
    for (const mob of targets) wave.struck.add(mob);
    const chainSources = targets.filter((mob) => this.cut(ctx, mob));
    for (const mob of chainSources) this.throwChains(ctx, mob, wave);
  }

  private canStrike(mob: Mob, struck: ReadonlySet<Mob>): boolean {
    return mob.isAlive && !struck.has(mob) && mob.takesPlayerDamage('melee');
  }

  /**
   * The blade or the wave cutting one enemy, for double a blow. Reports
   * whether the cut earns chain lightning.
   */
  private cut(ctx: CombatContext, mob: Mob): boolean {
    const { human } = ctx;
    if (human.zeroDamage) return false;
    mob.takeDamageFrom(TARANIS_DAMAGE_MULTIPLIER * crawlerMeleeStrikeDamage(human), human, 'melee');
    this.cutThisTick = true;
    if (mob.blowsEarnNothing) return false;
    ctx.hitLanded = true;
    landHumanGearProcs(human, mob);
    return true;
  }

  /**
   * Chain lightning from a cut enemy to the nearest others in reach that this
   * swing has not struck, each for one ordinary blow.
   */
  private throwChains(ctx: CombatContext, from: Mob, wave: Wave): void {
    const { struck } = wave;
    const { human, gameMap } = ctx;
    const source = centreOf(from);
    const radiusPx = TARANIS_CHAIN_RADIUS_TILES * TILE_SIZE;
    const inReach: { readonly mob: Mob; readonly centre: WorldPoint; readonly dist: number }[] = [];
    for (const mob of ctx.mobGrid.queryCircle(source.x, source.y, radiusPx + TILE_SIZE)) {
      if (!this.canStrike(mob, struck)) continue;
      const centre = centreOf(mob);
      const dist = Math.hypot(centre.x - source.x, centre.y - source.y);
      if (dist > radiusPx) continue;
      // The wave is still coming for these; a chain taking them first would
      // trade its doubled cut for an ordinary blow.
      if (inWaveLane(gameMap, wave, centre)) continue;
      if (!gameMap.hasLineOfSight(source.x, source.y, centre.x, centre.y)) continue;
      inReach.push({ mob, centre, dist });
    }
    inReach.sort((a, b) => a.dist - b.dist);
    for (const { mob, centre } of inReach.slice(0, TARANIS_CHAIN_MAX_TARGETS)) {
      struck.add(mob);
      ctx.spells.addChainLightningBolt(source.x, source.y, centre.x, centre.y);
      this.chainedThisTick = true;
      mob.takeDamageFrom(crawlerMeleeStrikeDamage(human), human, 'melee');
      if (!mob.blowsEarnNothing) ctx.hitLanded = true;
    }
  }
}

/**
 * Whether a body centred at `centre` lies in the stretch of lane the wave has
 * still to run: past its front, within its reach and half-width, and in sight
 * of where it was thrown from.
 */
function inWaveLane(map: GameMap, wave: Wave, centre: WorldPoint): boolean {
  const dx = centre.x - wave.originX;
  const dy = centre.y - wave.originY;
  const along = dx * wave.dirX + dy * wave.dirY;
  const across = Math.abs(dx * wave.dirY - dy * wave.dirX);
  if (along <= wave.frontPx || along > wave.reachPx || across > WAVE_HALF_WIDTH_PX) return false;
  return map.hasLineOfSight(wave.originX, wave.originY, centre.x, centre.y);
}

/** How strongly a wave shows: whole while it travels, falling to nothing as it fades at the end of its reach. */
function waveAlpha(wave: Wave): number {
  if (wave.age < WAVE_TRAVEL_TICKS) return 1;
  return Math.max(0, 1 - (wave.age - WAVE_TRAVEL_TICKS) / WAVE_FADE_TICKS);
}

/**
 * How far the wave can run from `origin` along the direction before a wall
 * stops it, by the same sight test the blade's own cut uses. Each probe looks
 * one step past the point it is asking about, because the sight test never
 * tests its endpoint's own tile: a front standing inside a wall would
 * otherwise count as clear.
 */
function clearReach(map: GameMap, origin: WorldPoint, dirX: number, dirY: number): number {
  const maxPx = TARANIS_WAVE_REACH_TILES * TILE_SIZE;
  const stepPx = TILE_SIZE / WALL_PROBES_PER_TILE;
  let reachPx = 0;
  for (let along = stepPx; along <= maxPx; along += stepPx) {
    const probe = along + stepPx;
    const clear = map.hasLineOfSight(
      origin.x,
      origin.y,
      origin.x + dirX * probe,
      origin.y + dirY * probe,
    );
    if (!clear) break;
    reachPx = along;
  }
  return reachPx;
}

/** The wave's crescent at its front: bowed back toward him at its tips, jittered per frame. */
function traceCrescent(
  ctx: CanvasRenderingContext2D,
  wave: Wave,
  camX: number,
  camY: number,
): void {
  const perpX = -wave.dirY;
  const perpY = wave.dirX;
  ctx.beginPath();
  for (let point = 0; point < ARC_POINTS; point++) {
    const t = (point / (ARC_POINTS - 1)) * 2 - 1;
    const jitter =
      point === 0 || point === ARC_POINTS - 1 ? 0 : (Math.random() * 2 - 1) * ARC_JITTER_PX;
    const along = wave.frontPx - ARC_BOW * WAVE_HALF_WIDTH_PX * t * t + jitter;
    const across = WAVE_HALF_WIDTH_PX * t;
    const x = wave.originX + wave.dirX * along + perpX * across - camX;
    const y = wave.originY + wave.dirY * along + perpY * across - camY;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}
