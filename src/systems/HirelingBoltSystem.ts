/**
 * Everything Splash Zone looses once it has left him: his crossbow bolts, the
 * travelling wave of his Wet Spot routine, and the splashes both break into.
 *
 * A system rather than state on the hireling for the reason every projectile
 * system here is one: a mob stops being updated and drawn the frame it dies, so
 * a bolt or a wave it owned would vanish in mid-air the instant the hireling
 * fell. Water already thrown does not care what happened to the otter.
 *
 * Both shots are an ally's, so neither can hurt the party. Their only victims
 * are living hostile mobs — never a crawler, Mongo, a quest ally or another
 * hireling — and every blow is credited to the crawler who paid through
 * `takeCreditedDamage`, with the hireling named as the body that struck.
 */

import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import {
  drawSplashZoneBolt,
  drawSplashZoneSplash,
  drawSplashZoneWave,
} from '../sprites/splashZoneSprite';
import { SPLASH_ZONE_SPLASH_TICKS } from '../sprites/splashZoneTiming';
import type { GameSystem, SystemContext } from './GameSystem';

/** The hireling behind a shot: a mob that wants to hear when its blow finishes something. */
export interface HirelingShooter extends Mob {
  noteBlowLanded(victim: Mob): void;
}

/** One crossbow bolt, as the kit hands it over. */
export interface HirelingBoltLaunch {
  /** Where the bolt's tip starts, in world pixels at body-centre height. */
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly damage: number;
  /** How far the bolt flies before it drops out of the air. */
  readonly rangePx: number;
  readonly shooter: HirelingShooter;
  /** The crawler credited with anything the bolt kills. */
  readonly owner: Player;
}

/** One wave, as the kit hands it over. */
export interface HirelingWaveLaunch {
  /** The caster's centre, which the wave rolls outward from. */
  readonly originX: number;
  readonly originY: number;
  /** Direction of travel, in radians. */
  readonly heading: number;
  /** Half the cone's opening, in radians. */
  readonly halfAngle: number;
  /** How far the crest rolls before it spends itself. */
  readonly reachPx: number;
  readonly damage: number;
  readonly caster: HirelingShooter;
  readonly owner: Player;
}

/** Anything besides a boulder that a hireling's kit launches. */
export type HirelingShot =
  | { readonly kind: 'bolt'; readonly bolt: HirelingBoltLaunch }
  | { readonly kind: 'wave'; readonly wave: HirelingWaveLaunch };

/**
 * Anything with shots to hand over. Structural, like `GolemRockThrower`, so the
 * system never has to name the hireling class it drains.
 */
export interface HirelingShotSource {
  takePendingShots(): readonly HirelingShot[];
}

function isShotSource(mob: Mob): mob is Mob & HirelingShotSource {
  return 'takePendingShots' in mob && typeof mob.takePendingShots === 'function';
}

const CENTER_OFFSET = 0.5;

/** A bolt outruns anything that walks, so a shot aimed at a mob reaches it. */
const BOLT_SPEED_TILES_PER_FRAME = 0.3;
/** How close the tip must pass a body's centre to strike it. */
const BOLT_HIT_RADIUS_TILES = 0.45;
/**
 * A bolt flies at crossbow height; its splash belongs on the floor under it.
 * The splash art is anchored on the ground point.
 */
const BOLT_HEIGHT_ABOVE_GROUND_TILES = 0.35;

/** Where the crest first shows, just off the caster's paws. */
const WAVE_START_OFFSET_TILES = 0.4;
/**
 * A wave slow enough to watch cross the room: about two-thirds of a second to
 * roll its whole reach, which is what lets the sweep read as a sweep.
 */
const WAVE_SPEED_TILES_PER_FRAME = 0.11;
/**
 * The crest is drawn as this many pieces, each following its own spoke of the
 * cone. One stretched sprite could not cover the cone's far edge: the art reads
 * as water only up to about twice its authored width.
 */
const WAVE_SEGMENTS = 3;
/** Neighbouring pieces overlap by this much, so the crest never shows a seam. */
const WAVE_SEGMENT_OVERLAP = 1.3;
/** The narrowest and widest a piece is stretched to, in tiles. */
const WAVE_SEGMENT_MIN_WIDTH_TILES = 0.6;
const WAVE_SEGMENT_MAX_WIDTH_TILES = 2.2;
/** The last stretch of travel over which the crest fades as it spends itself. */
const WAVE_FADE_FRAMES = 12;
/** How far past a body's centre the crest reaches to catch it: about half a body. */
const WAVE_BODY_REACH_TILES = 0.45;
/**
 * How far a swept mob is carried. Longer than the wave's own lead over it, so
 * the mob is visibly thrown ahead of the crest and caught by it again.
 */
const WAVE_KNOCKBACK_TILES = 2.5;
const WAVE_KNOCKBACK_FRAMES = 22;
/** The push is divided by mass, floored here so a body lighter than a goblin is not flung further than the full push. */
const MIN_MASS_FOR_KNOCKBACK = 1;

/** Oldest splashes go first past this, so a long fight cannot grow the list without bound. */
const MAX_SPLASHES = 32;

interface Bolt {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly heading: number;
  travelledPx: number;
  age: number;
  readonly launch: HirelingBoltLaunch;
}

interface WaveSegment {
  /** Offset of this piece's spoke from the wave's heading, in radians. */
  readonly spoke: number;
  /** Whether this piece is still rolling; a piece that meets a wall breaks there. */
  rolling: boolean;
}

interface Wave {
  readonly launch: HirelingWaveLaunch;
  /** Distance of the crest from the origin, in pixels. */
  frontPx: number;
  age: number;
  readonly segments: WaveSegment[];
  /** Everyone already swept, so no one is hit twice by the same water. */
  readonly swept: Mob[];
}

interface Splash {
  readonly x: number;
  readonly y: number;
  age: number;
}

export class HirelingBoltSystem implements GameSystem {
  private bolts: Bolt[] = [];
  private waves: Wave[] = [];
  private splashes: Splash[] = [];
  /** Scratch set for grid queries, reused every frame. */
  private readonly nearby = new Set<Mob>();

  /** Set when a bolt lands or snaps on a wall; the scene plays the cue and clears it. */
  impactSoundPending = false;
  /** Set when a wave leaves the paws or breaks over someone; the scene plays the cue and clears it. */
  waveSoundPending = false;

  /**
   * @param isInSafeRoom The test that keeps the party's own attacks out of a
   *   safe room. A wave rolling in through the doorway stops at the threshold,
   *   and nothing standing inside is hit.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly isInSafeRoom: (point: { readonly x: number; readonly y: number }) => boolean,
  ) {}

  /** Bolts and waves in the air, for gates and dev readouts. */
  get inFlight(): { readonly bolts: number; readonly waves: number } {
    return { bolts: this.bolts.length, waves: this.waves.length };
  }

  update(ctx: SystemContext): void {
    this.collectShots(ctx.roster.mobs);
    this.advanceBolts(ctx);
    this.advanceWaves(ctx);
    this.advanceSplashes();
  }

  /**
   * Walks the whole mob list rather than only the active ones: a hireling that
   * shoots and dies in the same frame would otherwise strand its bolt.
   */
  private collectShots(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!isShotSource(mob)) continue;
      for (const shot of mob.takePendingShots()) {
        if (shot.kind === 'bolt') this.launchBolt(shot.bolt);
        else this.launchWave(shot.wave);
      }
    }
  }

  private launchBolt(launch: HirelingBoltLaunch): void {
    const heading = normalize(launch.dirX, launch.dirY);
    // A zero direction normalises to (0, 0): a bolt that never moves and never lands.
    const degenerate = heading.x === 0 && heading.y === 0;
    const dirX = degenerate ? 1 : heading.x;
    const dirY = degenerate ? 0 : heading.y;
    const speed = TILE_SIZE * BOLT_SPEED_TILES_PER_FRAME;
    this.bolts.push({
      x: launch.x,
      y: launch.y,
      vx: dirX * speed,
      vy: dirY * speed,
      heading: Math.atan2(dirY, dirX),
      travelledPx: 0,
      age: 0,
      launch,
    });
  }

  private launchWave(launch: HirelingWaveLaunch): void {
    const segments: WaveSegment[] = [];
    const spokeSpan = (launch.halfAngle * 2) / WAVE_SEGMENTS;
    for (let i = 0; i < WAVE_SEGMENTS; i++) {
      const spoke = -launch.halfAngle + spokeSpan * (i + CENTER_OFFSET);
      segments.push({ spoke, rolling: true });
    }
    this.waves.push({
      launch,
      frontPx: TILE_SIZE * WAVE_START_OFFSET_TILES,
      age: 0,
      segments,
      swept: [],
    });
    this.waveSoundPending = true;
  }

  // ── Bolts ────────────────────────────────────────────────────────────────

  private advanceBolts(ctx: SystemContext): void {
    const survivors: Bolt[] = [];
    for (const bolt of this.bolts) {
      bolt.age++;
      const nextX = bolt.x + bolt.vx;
      const nextY = bolt.y + bolt.vy;
      const blocked =
        !this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE)) ||
        this.isInSafeRoom({
          x: nextX - TILE_SIZE * CENTER_OFFSET,
          y: nextY - TILE_SIZE * CENTER_OFFSET,
        });
      if (blocked) {
        this.splashUnderBolt(bolt);
        this.impactSoundPending = true;
        continue;
      }
      bolt.x = nextX;
      bolt.y = nextY;
      bolt.travelledPx += Math.hypot(bolt.vx, bolt.vy);

      const victim = this.boltVictim(ctx, bolt);
      if (victim !== null) {
        const { launch } = bolt;
        victim.takeCreditedDamage(launch.damage, launch.owner, 'melee', launch.shooter);
        launch.shooter.noteBlowLanded(victim);
        this.splashUnderBolt(bolt);
        this.impactSoundPending = true;
        continue;
      }
      if (bolt.travelledPx >= bolt.launch.rangePx) {
        this.splashUnderBolt(bolt);
        continue;
      }
      survivors.push(bolt);
    }
    this.bolts = survivors;
  }

  private boltVictim(ctx: SystemContext, bolt: Bolt): Mob | null {
    const radius = TILE_SIZE * BOLT_HIT_RADIUS_TILES;
    this.nearby.clear();
    ctx.roster.grid.queryCircle(bolt.x, bolt.y, radius + TILE_SIZE, this.nearby);
    let best: Mob | null = null;
    let bestDistance = Infinity;
    for (const mob of this.nearby) {
      if (!this.canBeHit(mob, bolt.launch.shooter)) continue;
      const distance = Math.hypot(
        bolt.x - (mob.x + TILE_SIZE * CENTER_OFFSET),
        bolt.y - (mob.y + TILE_SIZE * CENTER_OFFSET),
      );
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = mob;
      }
    }
    return best;
  }

  private splashUnderBolt(bolt: Bolt): void {
    this.addSplash(bolt.x, bolt.y + TILE_SIZE * BOLT_HEIGHT_ABOVE_GROUND_TILES);
  }

  // ── Waves ────────────────────────────────────────────────────────────────

  private advanceWaves(ctx: SystemContext): void {
    const survivors: Wave[] = [];
    for (const wave of this.waves) {
      wave.age++;
      wave.frontPx += TILE_SIZE * WAVE_SPEED_TILES_PER_FRAME;
      this.breakSegmentsOnWalls(wave);
      this.sweep(ctx, wave);
      const spent = wave.frontPx >= wave.launch.reachPx;
      const stillRolling = wave.segments.some((segment) => segment.rolling);
      if (!spent && stillRolling) survivors.push(wave);
    }
    this.waves = survivors;
  }

  /** The point on a piece's spoke where the crest is now. */
  private crestPoint(wave: Wave, segment: WaveSegment): { x: number; y: number } {
    const angle = wave.launch.heading + segment.spoke;
    return {
      x: wave.launch.originX + Math.cos(angle) * wave.frontPx,
      y: wave.launch.originY + Math.sin(angle) * wave.frontPx,
    };
  }

  /**
   * A piece whose crest has reached masonry, or the threshold of a safe room,
   * breaks there in a splash and rolls no further — so the water visibly stops
   * at the wall instead of washing through it into the next room.
   */
  private breakSegmentsOnWalls(wave: Wave): void {
    const { originX, originY } = wave.launch;
    for (const segment of wave.segments) {
      if (!segment.rolling) continue;
      const crest = this.crestPoint(wave, segment);
      const onFloor = this.gameMap.isWalkable(
        Math.floor(crest.x / TILE_SIZE),
        Math.floor(crest.y / TILE_SIZE),
      );
      const reached = onFloor && this.gameMap.hasLineOfSight(originX, originY, crest.x, crest.y);
      const intoSafeRoom = this.isInSafeRoom({
        x: crest.x - TILE_SIZE * CENTER_OFFSET,
        y: crest.y - TILE_SIZE * CENTER_OFFSET,
      });
      if (reached && !intoSafeRoom) continue;
      segment.rolling = false;
      this.addSplash(crest.x, crest.y);
    }
  }

  /** Which piece's spoke a bearing from the origin falls on, or null outside the cone. */
  private segmentAt(wave: Wave, bearing: number): WaveSegment | null {
    const offset = angleBetween(bearing, wave.launch.heading);
    if (Math.abs(offset) > wave.launch.halfAngle) return null;
    const spokeSpan = (wave.launch.halfAngle * 2) / WAVE_SEGMENTS;
    const index = Math.min(
      WAVE_SEGMENTS - 1,
      Math.floor((offset + wave.launch.halfAngle) / spokeSpan),
    );
    return wave.segments[index] ?? null;
  }

  /**
   * Catches every hostile the crest has reached: water damage, a splash where
   * it breaks over them, and a shove straight out along the wave's spoke so
   * the whole group is carried back the way the water is going.
   */
  private sweep(ctx: SystemContext, wave: Wave): void {
    const { launch } = wave;
    const reachPx = wave.frontPx + TILE_SIZE * WAVE_BODY_REACH_TILES;
    this.nearby.clear();
    ctx.roster.grid.queryCircle(launch.originX, launch.originY, reachPx + TILE_SIZE, this.nearby);
    for (const mob of this.nearby) {
      if (!this.canBeHit(mob, launch.caster) || wave.swept.includes(mob)) continue;
      const cx = mob.x + TILE_SIZE * CENTER_OFFSET;
      const cy = mob.y + TILE_SIZE * CENTER_OFFSET;
      const dx = cx - launch.originX;
      const dy = cy - launch.originY;
      const distance = Math.hypot(dx, dy);
      if (distance > reachPx) continue;
      const segment = this.segmentAt(wave, Math.atan2(dy, dx));
      if (segment?.rolling !== true) continue;
      if (!this.gameMap.hasLineOfSight(launch.originX, launch.originY, cx, cy)) continue;

      wave.swept.push(mob);
      mob.takeCreditedDamage(launch.damage, launch.owner, 'melee', launch.caster);
      launch.caster.noteBlowLanded(mob);
      this.addSplash(cx, cy);
      this.waveSoundPending = true;
      if (!mob.isAlive || !canBeShoved(mob)) continue;
      // Straight out from the caster; a body standing on his own tile goes the way the wave does.
      const away =
        distance > 0
          ? { x: dx, y: dy }
          : { x: Math.cos(launch.heading), y: Math.sin(launch.heading) };
      const pushPx =
        (TILE_SIZE * WAVE_KNOCKBACK_TILES) / Math.max(MIN_MASS_FOR_KNOCKBACK, mob.mass);
      mob.applyKnockback(away.x, away.y, pushPx, WAVE_KNOCKBACK_FRAMES);
    }
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  /**
   * Only a living hostile mob outside a safe room. Crawlers are not mobs, and
   * Mongo, quest allies and hirelings are never hostile, so the party cannot be
   * struck whichever way a shot happens to be crossing.
   */
  private canBeHit(mob: Mob, shooter: Mob): boolean {
    if (mob === shooter || !mob.isAlive || !mob.isHostile) return false;
    return !this.isInSafeRoom(mob);
  }

  private addSplash(x: number, y: number): void {
    if (this.splashes.length >= MAX_SPLASHES) this.splashes.shift();
    this.splashes.push({ x, y, age: 0 });
  }

  private advanceSplashes(): void {
    for (const splash of this.splashes) splash.age++;
    this.splashes = this.splashes.filter((splash) => splash.age < SPLASH_ZONE_SPLASH_TICKS);
  }

  /** Drawn over the creatures, so water crossing a fight never hides behind it. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const wave of this.waves) this.renderWave(ctx, camX, camY, wave);
    for (const bolt of this.bolts) {
      drawSplashZoneBolt(ctx, bolt.x - camX, bolt.y - camY, TILE_SIZE, bolt.heading, bolt.age);
    }
    for (const splash of this.splashes) {
      drawSplashZoneSplash(
        ctx,
        splash.x - camX,
        splash.y - camY,
        TILE_SIZE,
        splash.age / SPLASH_ZONE_SPLASH_TICKS,
      );
    }
  }

  private renderWave(ctx: CanvasRenderingContext2D, camX: number, camY: number, wave: Wave): void {
    const { launch } = wave;
    const framesLeft = (launch.reachPx - wave.frontPx) / (TILE_SIZE * WAVE_SPEED_TILES_PER_FRAME);
    const alpha = Math.max(0, Math.min(1, framesLeft / WAVE_FADE_FRAMES));
    const spokeSpan = (launch.halfAngle * 2) / WAVE_SEGMENTS;
    const arcTiles = (wave.frontPx * spokeSpan * WAVE_SEGMENT_OVERLAP) / TILE_SIZE;
    const widthTiles = Math.max(
      WAVE_SEGMENT_MIN_WIDTH_TILES,
      Math.min(WAVE_SEGMENT_MAX_WIDTH_TILES, arcTiles),
    );
    for (const segment of wave.segments) {
      if (!segment.rolling) continue;
      const crest = this.crestPoint(wave, segment);
      drawSplashZoneWave(
        ctx,
        crest.x - camX,
        crest.y - camY,
        TILE_SIZE,
        launch.heading + segment.spoke,
        widthTiles,
        wave.age,
        alpha,
      );
    }
  }

  /** A checkpoint restore must not resume water thrown in the run that died. */
  resetForCheckpoint(): void {
    this.bolts = [];
    this.waves = [];
    this.splashes = [];
    this.impactSoundPending = false;
    this.waveSoundPending = false;
  }
}

/**
 * Bosses hold their ground against water, and so does anything rooted: a
 * rooted mob carried off its post is a turret walking the room, and a boss
 * carried out of its arena breaks the fight it is scripted for.
 */
function canBeShoved(mob: Mob): boolean {
  return !mob.isBoss && mob.moveSpeed > 0;
}

/** Signed difference `a - b`, wrapped to (-π, π]. */
function angleBetween(a: number, b: number): number {
  const full = Math.PI * 2;
  let delta = (a - b) % full;
  if (delta > Math.PI) delta -= full;
  if (delta <= -Math.PI) delta += full;
  return delta;
}
