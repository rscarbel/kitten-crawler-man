/**
 * The Stormcaller's storm, the proc its swing carries: the slicing wave of
 * lightning the blade throws along the blow, and the chain lightning every cut
 * enemy throws on.
 *
 * The wave cuts every enemy whose body lies in its lane — up to its reach ahead
 * of him and its half-width either side — for the sword's full cut, however
 * far along the lane it stands. It passes through walls, props and bodies
 * alike, so nothing in the lane shields anything behind it. Who it cuts is
 * settled the moment it is thrown, measured from where he stood; each cut lands
 * as the drawn front reaches that body, so what is seen is what is hit.
 *
 * One swing strikes an enemy at most once, whether the blade, the wave or a
 * chain reaches it first: each swing carries the set of everything it has
 * struck. Chains do not chain — only an enemy cut by the blade or the wave
 * throws one.
 *
 * Owned by `CombatKit`, which registers it as the `stormcallerStorm` proc: the
 * generic weapon strike in `CombatSystem` lands the blade's cut and hands the
 * swing here on the strike's peak tick, and the kit ticks the waves straight
 * after, so a wave's cuts are resolved in the same phase as every other blow
 * and paid out by the same kill resolution.
 */

import { outgoingHitDamageOn } from '../core/combat/outgoingHit';
import { MAGIC_HIT, type DamageTags } from '../core/combat/damageTags';
import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import { STORMCALLER_LIGHTNING } from '../sprites/art/stormcallerPalette';
import {
  type CombatContext,
  crawlerMeleeStrikeDamage,
  cutWithWeapon,
  type WeaponProc,
  type WeaponSwing,
} from './CombatSystem';
import type { DynamicLightSink } from './lighting/dynamicLights';

const HALF_TILE = TILE_SIZE / 2;

/** How far ahead of his centre the wave reaches, to the near edge of a body it cuts. */
export const STORMCALLER_WAVE_REACH_TILES = 4;
const WAVE_REACH_PX = STORMCALLER_WAVE_REACH_TILES * TILE_SIZE;
/** How far either side of its line the drawn crescent spans; a body touching it is cut. */
const WAVE_HALF_WIDTH_TILES = 1;
const WAVE_HALF_WIDTH_PX = WAVE_HALF_WIDTH_TILES * TILE_SIZE;
/** Ticks the wave takes to cover its reach, and to fade out once it has. */
const WAVE_TRAVEL_TICKS = 10;
const WAVE_FADE_TICKS = 12;
const WAVE_STEP_PX = WAVE_REACH_PX / WAVE_TRAVEL_TICKS;
/**
 * How far a cut enemy's chain lightning jumps: centre to centre between two
 * one-tile bodies, and to the near side of anything wider than a tile.
 */
export const STORMCALLER_CHAIN_RADIUS_TILES = 4;
/** How many other enemies one cut enemy's chain lightning can reach. */
export const STORMCALLER_CHAIN_MAX_TARGETS = 4;

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

/** An enemy the wave was thrown at, cut once the front has run `alongPx` from his centre. */
interface PendingCut {
  readonly mob: Mob;
  readonly alongPx: number;
}

interface Wave {
  readonly originX: number;
  readonly originY: number;
  readonly dirX: number;
  readonly dirY: number;
  frontPx: number;
  age: number;
  /** Everything in the lane when it was thrown and not yet reached, nearest first. */
  pending: PendingCut[];
  /** Everything this swing has struck, shared with its blade cut and chains. */
  readonly struck: Set<Mob>;
  /** The sword's multiple of a blow, which every cut the wave makes lands. */
  readonly damageMultiplier: number;
}

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

function centreOf(entity: WorldPoint): WorldPoint {
  return { x: entity.x + HALF_TILE, y: entity.y + HALF_TILE };
}

/**
 * How far a mob's body reaches from its centre. Its collision radius is the
 * centre-to-centre distance it keeps a one-tile crawler at, so the crawler's
 * own half tile is not part of it.
 */
function bodyRadiusOf(mob: Mob): number {
  return Math.max(HALF_TILE, mob.collisionRadiusPx - HALF_TILE);
}

export class StormcallerStrikeSystem implements WeaponProc {
  private waves: Wave[] = [];
  private swungThisTick = false;
  private cutThisTick = false;
  private chainedThisTick = false;

  /**
   * The storm the blade's cut throws: the wave sent off along the facing the
   * blow was thrown with, sharing everything the cut struck, and the chain
   * lightning each enemy the cut earned on throws.
   */
  onStrike(ctx: CombatContext, swing: WeaponSwing): void {
    const wave: Wave = {
      originX: swing.originX,
      originY: swing.originY,
      dirX: swing.dirX,
      dirY: swing.dirY,
      frontPx: 0,
      age: 0,
      pending: [],
      struck: swing.struck,
      damageMultiplier: swing.weapon.damageMultiplier,
    };
    // Claimed before the blade's chains are thrown, so a chain never takes a
    // body the wave is coming for and trades its doubled cut for an ordinary blow.
    wave.pending = this.lane(ctx, wave);
    for (const { mob } of wave.pending) wave.struck.add(mob);
    this.waves.push(wave);
    if (swing.cut.length > 0) this.cutThisTick = true;
    for (const mob of swing.earned) this.throwChains(ctx, mob, wave);
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
      if (wave.frontPx < WAVE_REACH_PX) this.advance(ctx, wave);
    }
    this.waves = this.waves.filter((wave) => wave.age < WAVE_TRAVEL_TICKS + WAVE_FADE_TICKS);

    if (this.swungThisTick) ctx.bus.emit('stormcallerSwing', {});
    if (this.cutThisTick) ctx.bus.emit('stormcallerStrike', {});
    if (this.chainedThisTick) ctx.bus.emit('stormcallerChain', {});
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
      ctx.strokeStyle = STORMCALLER_LIGHTNING.glow;
      ctx.lineWidth = ARC_GLOW_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = alpha * ARC_ALPHA;
      ctx.strokeStyle = STORMCALLER_LIGHTNING.arc;
      ctx.lineWidth = ARC_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = STORMCALLER_LIGHTNING.core;
      ctx.lineWidth = ARC_CORE_WIDTH;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Every enemy whose body lies in the wave's lane when it is thrown, nearest
   * first. Read from the whole mob list rather than the grid, so no body is
   * missed for being wider than a query's margin allowed for.
   */
  private lane(ctx: CombatContext, wave: Wave): PendingCut[] {
    const inLane: PendingCut[] = [];
    for (const mob of ctx.mobs) {
      if (!this.canStrike(mob, wave.struck)) continue;
      const centre = centreOf(mob);
      const dx = centre.x - wave.originX;
      const dy = centre.y - wave.originY;
      const along = dx * wave.dirX + dy * wave.dirY;
      const across = Math.abs(dx * wave.dirY - dy * wave.dirX);
      const bodyRadius = bodyRadiusOf(mob);
      const nearEdgeAlong = along - bodyRadius;
      const isAhead = along > 0;
      const withinReach = nearEdgeAlong <= WAVE_REACH_PX;
      const withinWidth = across <= WAVE_HALF_WIDTH_PX + bodyRadius;
      if (!isAhead || !withinReach || !withinWidth) continue;
      inLane.push({ mob, alongPx: Math.max(0, nearEdgeAlong) });
    }
    return inLane.sort((a, b) => a.alongPx - b.alongPx);
  }

  private advance(ctx: CombatContext, wave: Wave): void {
    wave.frontPx = Math.min(WAVE_REACH_PX, wave.frontPx + WAVE_STEP_PX);
    const reached = wave.pending.filter((target) => target.alongPx <= wave.frontPx);
    if (reached.length === 0) return;
    wave.pending = wave.pending.filter((target) => target.alongPx > wave.frontPx);
    const stillStanding = reached
      .map(({ mob }) => mob)
      .filter((mob) => mob.isAlive && mob.takesPlayerDamage('melee'));
    this.landCuts(ctx, wave, stillStanding);
  }

  /** Cuts every target the front reached this tick, then throws each cut's chains. */
  private landCuts(ctx: CombatContext, wave: Wave, targets: readonly Mob[]): void {
    const chainSources = targets.filter((mob) => this.cut(ctx, wave, mob));
    for (const mob of chainSources) this.throwChains(ctx, mob, wave);
  }

  private canStrike(mob: Mob, struck: ReadonlySet<Mob>): boolean {
    return mob.isAlive && !struck.has(mob) && mob.takesPlayerDamage('melee');
  }

  /** The wave cutting one enemy. Reports whether the cut earns chain lightning. */
  private cut(ctx: CombatContext, wave: Wave, mob: Mob): boolean {
    if (ctx.human.zeroDamage) return false;
    this.cutThisTick = true;
    return cutWithWeapon(ctx, mob, wave.damageMultiplier);
  }

  /**
   * Chain lightning from a cut enemy to the nearest others in reach that this
   * swing has not struck, each for one ordinary blow.
   */
  private throwChains(ctx: CombatContext, from: Mob, wave: Wave): void {
    const { struck } = wave;
    const { human, gameMap } = ctx;
    const source = centreOf(from);
    const radiusPx = STORMCALLER_CHAIN_RADIUS_TILES * TILE_SIZE;
    const inReach: { readonly mob: Mob; readonly centre: WorldPoint; readonly dist: number }[] = [];
    // Read from the whole mob list rather than the grid, so a body wider than a
    // query's margin is still found by its near side.
    for (const mob of ctx.mobs) {
      if (mob === from || !this.canStrike(mob, struck)) continue;
      const centre = centreOf(mob);
      const centreDist = Math.hypot(centre.x - source.x, centre.y - source.y);
      const bodyBeyondOneTile = bodyRadiusOf(mob) - HALF_TILE;
      const dist = centreDist - bodyBeyondOneTile;
      if (dist > radiusPx) continue;
      if (!gameMap.hasLineOfSight(source.x, source.y, centre.x, centre.y)) continue;
      inReach.push({ mob, centre, dist });
    }
    inReach.sort((a, b) => a.dist - b.dist);
    for (const { mob, centre } of inReach.slice(0, STORMCALLER_CHAIN_MAX_TARGETS)) {
      struck.add(mob);
      ctx.spells.addChainLightningBolt(source.x, source.y, centre.x, centre.y);
      this.chainedThisTick = true;
      const bolt = crawlerMeleeStrikeDamage(human);
      const tags: DamageTags = [...human.meleeHitTags(), ...MAGIC_HIT];
      mob.takeDamageFrom(outgoingHitDamageOn(human, mob, bolt, tags), human, 'melee');
      if (!mob.blowsEarnNothing) ctx.hitLanded = true;
    }
  }
}

/** How strongly a wave shows: whole while it travels, falling to nothing as it fades at the end of its reach. */
function waveAlpha(wave: Wave): number {
  if (wave.age < WAVE_TRAVEL_TICKS) return 1;
  return Math.max(0, 1 - (wave.age - WAVE_TRAVEL_TICKS) / WAVE_FADE_TICKS);
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
