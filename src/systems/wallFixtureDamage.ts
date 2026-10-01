/**
 * Blows landing on wall fixtures: the half of `DestructiblePropSystem` that
 * deals with things hung on a face rather than standing on a tile.
 *
 * A fixture is a target at its face tile, struck from the floor in front of
 * it: the attack has to come from south of the face, and the same facing cone
 * and line of sight that guard a prop guard a fixture, so nothing is broken
 * through a wall. A struck fixture answers by its kind — a sconce breaks, a
 * chain swings, a banner tears, a valve hisses — and a broken light goes out
 * on its own: the lighting pass watches the fixture's state, so breaking it
 * here and rewinding it from a checkpoint both need nothing more.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import {
  BANNER_TEAR_STAGES,
  FIXTURE_HISS_FRAMES,
  FIXTURE_HIT_FLASH_FRAMES,
  FIXTURE_SWING_FRAMES,
  WALL_FIXTURE_SPECS,
  type WallFixture,
  type WallFixtureKind,
} from '../map/dungeon/wallFixtures';
import { MELEE_POINT_BLANK_RANGE } from './CombatSystem';
import type { BreakMaterial } from './destruction/breakMaterials';

/** The part of one fixture a checkpoint rewinds; swings and flashes are moments, not state. */
export interface WallFixtureSnapshot {
  readonly hp: number;
  readonly broken: boolean;
  readonly tearStage: number;
}

interface Fleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colour: string;
}

const HALF = 0.5;
/** A fixture is struck at the middle of its face tile. */
const TARGET_OFFSET = 0.5;

/** What flies off a fixture as it breaks or tears, by what it is made of. */
const FLECK_COLOURS: Readonly<Record<BreakMaterial, ReadonlyArray<string>>> = {
  wood: ['#5a3a1e', '#9a6a38'],
  clay: ['#8a4b2c', '#b86a42'],
  glass: ['#d8eef8', '#a9cfe0', '#ffffff'],
  metal: ['#4a5058', '#8a949e', '#ffb347'],
  cloth: ['#5e1b1b', '#3a1010'],
  paper: ['#e8e2d0', '#c9c1a8'],
  stone: ['#6e6458', '#8f8577'],
  bone: ['#c8bc9c', '#a89c7c'],
  wax: ['#e8d9a8', '#c9b67e'],
  electrical: ['#fff4a0', '#ffffff', '#7ad0ff'],
  gas: ['#c8d0d4', '#e8eef0'],
  plastic: ['#bf9d2c', '#d8b843'],
};
const BREAK_FLECKS = 14;
const TEAR_FLECKS = 5;
const FLECK_SPEED_MIN = 0.8;
const FLECK_SPEED_MAX = 2.6;
const FLECK_LIFE_MIN = 20;
const FLECK_LIFE_MAX = 40;
const FLECK_GRAVITY = 0.08;
const FLECK_DRAG = 0.95;
const FLECK_SIZE_PX = 2;
/** The upward kick every fleck leaves with, before gravity takes it, in pixels a frame. */
const FLECK_UPWARD_KICK = 0.8;
/** A blown breaker throws a shower of sparks besides its own debris. */
const SPARK_SHOWER_FLECKS = 24;
const SPARK_SPEED_SCALE = 1.6;
/** Flecks leave a fixture upward and outward, never back into the wall. */
const FLECK_SPREAD = Math.PI;
/** Where on the face flecks come off, in tiles above the face tile's centre. */
const FLECK_ORIGIN_RISE_TILES = 0.6;

/** Which break cue a fixture's material plays, among the cues the props already have. */
export type FixtureBreakCue = 'iron' | 'trash';

/**
 * Something that happened to a fixture this frame, for the scene to give a
 * sound. Named by what happened and to what, so each pair can carry its own
 * cue: a sconce snuffed, a tube popped, a breaker blown and its room's tubes
 * powering down are four different noises.
 *
 * - `struck`: a breakable fixture took a blow and held.
 * - `broken`: it gave way.
 * - `swung`, `torn`, `hissed`: chains, a banner, a valve answered a blow.
 * - `power_down`: a blown breaker's tubes start to fade; at the breaker.
 */
export type WallFixtureEventName = 'struck' | 'broken' | 'swung' | 'torn' | 'hissed' | 'power_down';

export interface WallFixtureEvent {
  readonly name: WallFixtureEventName;
  readonly kind: WallFixtureKind;
  /** World pixels, at the fixture. */
  readonly x: number;
  readonly y: number;
}

function cueFor(material: BreakMaterial): FixtureBreakCue {
  return material === 'cloth' || material === 'paper' ? 'trash' : 'iron';
}

export class WallFixtureDamage {
  private readonly flecks: Fleck[] = [];
  private readonly events: WallFixtureEvent[] = [];

  constructor(
    private readonly gameMap: GameMap,
    /** Told each time a fixture breaks or tears, so the scene can play its cue. */
    private readonly onBreak: (cue: FixtureBreakCue) => void,
    /** Told when a fixture breaks for good, for whatever it drops on the floor below it. */
    private readonly onBroken: ((fixture: WallFixture) => void) | null = null,
  ) {}

  /**
   * Lands a blow on every fixture in reach of `(originX, originY)`. `facing`
   * is the swing's direction, or null for a blast or a stomp that strikes all
   * round. Returns whether anything solid was struck: chains swinging and a
   * banner tearing let a missile fly on through them.
   */
  strike(
    originX: number,
    originY: number,
    range: number,
    damage: number,
    facing: { readonly x: number; readonly y: number } | null,
  ): boolean {
    const originTileY = Math.floor(originY / TILE_SIZE);
    let struck = false;
    for (const fixture of this.gameMap.wallFixtures) {
      if (originTileY <= fixture.tileY) continue;
      const targetX = (fixture.tileX + TARGET_OFFSET) * TILE_SIZE;
      const targetY = (fixture.tileY + TARGET_OFFSET) * TILE_SIZE;
      const dx = targetX - originX;
      const dy = targetY - originY;
      if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
      const dist = Math.hypot(dx, dy);
      if (dist === 0 || dist > range) continue;
      if (facing !== null && dist > MELEE_POINT_BLANK_RANGE) {
        const dot = (dx / dist) * facing.x + (dy / dist) * facing.y;
        if (dot <= 0) continue;
      }
      const inSight = this.gameMap.hasLineOfSight(originX, originY, targetX, targetY, {
        tileX: fixture.tileX,
        tileY: fixture.tileY,
      });
      if (!inSight) continue;
      if (this.hit(fixture, damage)) struck = true;
    }
    return struck;
  }

  /**
   * Applies one blow. Returns whether it landed on something solid: a whole
   * breakable fixture. Chains, banners and valves answer the blow but stop
   * nothing.
   */
  private hit(fixture: WallFixture, damage: number): boolean {
    const spec = WALL_FIXTURE_SPECS[fixture.kind];
    const { state } = fixture;
    switch (spec.onHit) {
      case 'break':
        if (state.broken) return false;
        state.hp -= damage;
        state.hitFlashFrames = FIXTURE_HIT_FLASH_FRAMES;
        if (state.hp > 0) {
          this.raise('struck', fixture);
          return true;
        }
        state.hp = 0;
        state.broken = true;
        this.onBroken?.(fixture);
        this.spawnFlecks(fixture, FLECK_COLOURS[spec.material], BREAK_FLECKS, 1);
        this.onBreak(cueFor(spec.material));
        this.raise('broken', fixture);
        if (fixture.kind === 'fuse_box') {
          this.spawnFlecks(
            fixture,
            FLECK_COLOURS.electrical,
            SPARK_SHOWER_FLECKS,
            SPARK_SPEED_SCALE,
          );
          if (this.gameMap.wallFixtures.some((other) => other.circuit === fixture.id)) {
            this.raise('power_down', fixture);
          }
        }
        return true;
      case 'swing':
        state.swingFrames = FIXTURE_SWING_FRAMES;
        state.hitFlashFrames = FIXTURE_HIT_FLASH_FRAMES;
        this.raise('swung', fixture);
        return false;
      case 'tear':
        if (state.tearStage >= BANNER_TEAR_STAGES) return false;
        state.tearStage++;
        state.hitFlashFrames = FIXTURE_HIT_FLASH_FRAMES;
        this.spawnFlecks(fixture, FLECK_COLOURS[spec.material], TEAR_FLECKS, 1);
        this.onBreak(cueFor(spec.material));
        this.raise('torn', fixture);
        return false;
      case 'hiss':
        state.hissFrames = FIXTURE_HISS_FRAMES;
        state.hitFlashFrames = FIXTURE_HIT_FLASH_FRAMES;
        this.raise('hissed', fixture);
        return false;
    }
  }

  private raise(name: WallFixtureEventName, fixture: WallFixture): void {
    this.events.push({
      name,
      kind: fixture.kind,
      x: (fixture.tileX + HALF) * TILE_SIZE,
      y: (fixture.tileY + HALF) * TILE_SIZE,
    });
  }

  /** Everything that happened to a fixture since the last drain, oldest first. */
  drainEvents(): WallFixtureEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private spawnFlecks(
    fixture: WallFixture,
    colours: ReadonlyArray<string>,
    count: number,
    speedScale: number,
  ): void {
    const x = (fixture.tileX + HALF) * TILE_SIZE;
    const y = (fixture.tileY + HALF - FLECK_ORIGIN_RISE_TILES) * TILE_SIZE;
    for (let index = 0; index < count; index++) {
      // Straight down the screen is away from the wall, towards the player.
      const angle = Math.PI * HALF + (Math.random() - HALF) * FLECK_SPREAD;
      const speed =
        (FLECK_SPEED_MIN + Math.random() * (FLECK_SPEED_MAX - FLECK_SPEED_MIN)) * speedScale;
      const life = FLECK_LIFE_MIN + Math.floor(Math.random() * (FLECK_LIFE_MAX - FLECK_LIFE_MIN));
      this.flecks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - FLECK_UPWARD_KICK,
        life,
        maxLife: life,
        colour: colours[Math.floor(Math.random() * colours.length)] ?? '#ffffff',
      });
    }
  }

  update(): void {
    for (const { state } of this.gameMap.wallFixtures) {
      if (state.hitFlashFrames > 0) state.hitFlashFrames--;
      if (state.swingFrames > 0) state.swingFrames--;
      if (state.hissFrames > 0) state.hissFrames--;
    }
    for (let index = this.flecks.length - 1; index >= 0; index--) {
      const fleck = this.flecks[index];
      fleck.x += fleck.vx;
      fleck.y += fleck.vy;
      fleck.vy = (fleck.vy + FLECK_GRAVITY) * FLECK_DRAG;
      fleck.vx *= FLECK_DRAG;
      fleck.life--;
      if (fleck.life <= 0) {
        this.flecks[index] = this.flecks[this.flecks.length - 1];
        this.flecks.pop();
      }
    }
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const fleck of this.flecks) {
      ctx.globalAlpha = fleck.life / fleck.maxLife;
      ctx.fillStyle = fleck.colour;
      ctx.fillRect(fleck.x - camX, fleck.y - camY, FLECK_SIZE_PX, FLECK_SIZE_PX);
    }
    ctx.globalAlpha = 1;
  }

  captureCheckpoint(): WallFixtureSnapshot[] {
    return this.gameMap.wallFixtures.map(({ state }) => ({
      hp: state.hp,
      broken: state.broken,
      tearStage: state.tearStage,
    }));
  }

  /**
   * Puts every fixture back as it was. A light whose fixture comes back whole
   * relights on the lighting pass's next update, because that pass reads this
   * same state.
   */
  restoreCheckpoint(snapshot: ReadonlyArray<WallFixtureSnapshot>): void {
    this.gameMap.wallFixtures.forEach(({ state }, index) => {
      if (index >= snapshot.length) return;
      const saved = snapshot[index];
      state.hp = saved.hp;
      state.broken = saved.broken;
      state.tearStage = saved.tearStage;
      state.hitFlashFrames = 0;
      state.swingFrames = 0;
      state.hissFrames = 0;
    });
    this.flecks.length = 0;
    this.events.length = 0;
  }
}
