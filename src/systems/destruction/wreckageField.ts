/**
 * Everything a floor's broken props leave lying about, and what it does
 * afterwards: the wreckage and its spill, coals glowing down to ash, and oil
 * that a flame can set burning.
 *
 * Wreckage stays for the whole floor, so the player walks back through their
 * own mess. A cap bounds it; when the cap bites, the oldest piece the player
 * cannot see goes first, so nothing vanishes in front of them.
 *
 * Every field of every entry is plain data and round-trips through a
 * checkpoint as it stands: a death puts back the spills, the fires still
 * burning and the coals still glowing exactly as they were at the save.
 */

import { TILE_SIZE } from '../../core/constants';
import type { DynamicLightSink } from '../lighting/dynamicLights';
import type { DestructiblePropKind } from '../DestructiblePropSystem';
import {
  SPILL_REACH_PX,
  drawCoalEmbers,
  drawSpill,
  spillVariant,
  type SpillKind,
} from './spillDecals';
import { drawLavaFlame } from '../../sprites/lavaBallSprite';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../../creatures/mobLevelScaling';

export interface Wreckage {
  readonly tileX: number;
  readonly tileY: number;
  /** The piece that broke here, or null for a spill with no piece of its own (coals out of a sconce). */
  readonly kind: DestructiblePropKind | null;
  readonly spill: SpillKind | null;
  /** When it was laid, as a running count: lower is older. */
  readonly order: number;
  /** Frames of fire left on a burning oil spill; 0 when it is not burning. */
  burnFrames: number;
  /** An oil spill that has burnt off: a charred stain that never burns again. */
  burnt: boolean;
  /** Frames of glow left in spilled coals; 0 once they are ash. */
  glowFrames: number;
}

/**
 * The most wreckage a floor keeps. Past it the oldest off-screen piece goes,
 * so a floor smashed from end to end cannot grow without bound.
 */
export const MAX_WRECKAGE = 60;

/** Spilled coals glow, dimming, for about eight seconds. */
export const COALS_GLOW_FRAMES = 480;
/** A burning oil spill burns for about four seconds. */
export const OIL_BURN_FRAMES = 240;
/**
 * Frames a spill's fire takes to rise before it hurts. The rising fire is the
 * telegraph, so it lasts at least as long as any locked telegraph must: no
 * one is burnt by a floor that gave them less warning than a mob's blow.
 */
export const OIL_FIRE_CATCH_FRAMES = LOCKED_TELEGRAPH_MIN_FRAMES;
/** Frames between a burning spill's ticks of damage, counted from its own catch. */
export const OIL_FIRE_DAMAGE_INTERVAL = 30;
/**
 * How often coals are checked against oil lying near them. A spill lit a
 * few frames late by coals is lit all the same, and the check is a scan.
 */
const COALS_IGNITE_CHECK_FRAMES = 10;
/** Frames a burning spill burns before it lights an oil spill touching it. */
const OIL_FIRE_SPREAD_FRAMES = 30;
/** Two spills this close, centre to centre, touch: fire crosses from one to the other. */
const OIL_FIRE_SPREAD_TILES = 1.6;
const OIL_FIRE_SPREAD_PX = TILE_SIZE * OIL_FIRE_SPREAD_TILES;
/** Glowing coals light an oil spill they lie this close to. */
const COALS_IGNITE_TILES = 1.4;
const COALS_IGNITE_PX = TILE_SIZE * COALS_IGNITE_TILES;
/** How far a burning spill's fire reaches from its centre: the hazard's edge. */
export const OIL_FIRE_RADIUS_PX = SPILL_REACH_PX;

/** The tongues of fire a burning spill is drawn as, round its centre. */
const FLAME_OFFSETS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0, y: 0 },
  { x: -0.32, y: 0.08 },
  { x: 0.3, y: -0.06 },
];
/** Fire fades out over its last frames instead of stopping dead. */
const FIRE_FADE_FRAMES = 40;
/** How far past the view a piece still counts as seen, so one at the screen's edge is not evicted. */
const VIEW_MARGIN_PX = TILE_SIZE * 2;
const HALF = 0.5;

/** A burning spill's light: as bright as a fireball while it burns, dying with its flames. */
const OIL_FIRE_LIGHT = 'fireball';

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

function centreX(entry: Wreckage): number {
  return (entry.tileX + HALF) * TILE_SIZE;
}

function centreY(entry: Wreckage): number {
  return (entry.tileY + HALF) * TILE_SIZE;
}

function isUnlitOil(entry: Wreckage): boolean {
  return entry.spill === 'oil' && !entry.burnt && entry.burnFrames === 0;
}

/** What a spill can be when no piece of its own lies with it: what a wall fixture drops. */
export type FixtureSpill = Extract<SpillKind, 'coals' | 'glass'>;

/** A spill that caught, and the piece whose break let it out. */
export interface Ignition {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: DestructiblePropKind;
}

/** Whether a burning spill bites this frame: on its catch, then every damage interval after. */
function isDamageFrame(entry: Wreckage): boolean {
  if (entry.burnFrames <= 0) return false;
  const sinceCatch = burnedFrames(entry) - OIL_FIRE_CATCH_FRAMES;
  return sinceCatch >= 0 && sinceCatch % OIL_FIRE_DAMAGE_INTERVAL === 0;
}

/** How far into its fire a burning spill is, in frames since it caught. */
function burnedFrames(entry: Wreckage): number {
  return OIL_BURN_FRAMES - entry.burnFrames;
}

export class WreckageField {
  private readonly entries: Wreckage[] = [];
  private nextOrder = 0;
  /**
   * The last view the field was drawn into, rewritten in place each frame
   * rather than replaced; meaningless until {@link hasView}.
   */
  private readonly view: View = { x: 0, y: 0, w: 0, h: 0 };
  private hasView = false;
  /** Spills that caught since the last drain, for the owner to give a cue. */
  private readonly ignitions: Ignition[] = [];
  private frame = 0;

  /** Every piece of wreckage, oldest first. */
  get all(): ReadonlyArray<Wreckage> {
    return this.entries;
  }

  /** Lays a broken piece and its spill, evicting the oldest unseen one past the cap. */
  add(tileX: number, tileY: number, kind: DestructiblePropKind, spill: SpillKind | null): void {
    this.lay(tileX, tileY, kind, spill);
  }

  /** Lays a spill with no piece of its own: what a broken wall fixture drops below it. */
  addFixtureSpill(tileX: number, tileY: number, spill: FixtureSpill): void {
    this.lay(tileX, tileY, null, spill);
  }

  private lay(
    tileX: number,
    tileY: number,
    kind: DestructiblePropKind | null,
    spill: SpillKind | null,
  ): void {
    const laid: Wreckage = {
      tileX,
      tileY,
      kind,
      spill,
      order: this.nextOrder++,
      burnFrames: 0,
      burnt: false,
      glowFrames: spill === 'coals' ? COALS_GLOW_FRAMES : 0,
    };
    this.entries.push(laid);
    while (this.entries.length > MAX_WRECKAGE) this.evictOne();
  }

  /** Remembers the view so eviction can tell what the player is looking at. */
  noteView(camX: number, camY: number, viewW: number, viewH: number): void {
    const view = this.view;
    view.x = camX;
    view.y = camY;
    view.w = viewW;
    view.h = viewH;
    this.hasView = true;
  }

  private isSeen(entry: Wreckage): boolean {
    if (!this.hasView) return false;
    const view = this.view;
    const x = centreX(entry);
    const y = centreY(entry);
    return (
      x >= view.x - VIEW_MARGIN_PX &&
      x <= view.x + view.w + VIEW_MARGIN_PX &&
      y >= view.y - VIEW_MARGIN_PX &&
      y <= view.y + view.h + VIEW_MARGIN_PX
    );
  }

  /** Drops the oldest piece out of sight, or the oldest of all when every piece is in sight. */
  private evictOne(): void {
    let oldestUnseen = -1;
    let oldest = -1;
    for (let i = 0; i < this.entries.length; i++) {
      const order = this.entries[i].order;
      if (oldest < 0 || order < this.entries[oldest].order) oldest = i;
      if (this.isSeen(this.entries[i])) continue;
      if (oldestUnseen < 0 || order < this.entries[oldestUnseen].order) oldestUnseen = i;
    }
    const victim = oldestUnseen >= 0 ? oldestUnseen : oldest;
    if (victim >= 0) this.entries.splice(victim, 1);
  }

  /** Whether any oil spill lies waiting for a flame, so callers can skip looking for one. */
  get hasUnlitOil(): boolean {
    return this.entries.some(isUnlitOil);
  }

  /** Whether any spill is on fire, which is floor that must be drawn over the dark. */
  get hasFire(): boolean {
    return this.entries.some((entry) => entry.burnFrames > 0);
  }

  /**
   * Sets alight every unlit oil spill whose centre is within `reachPx` of
   * world `(x, y)`. Returns how many caught.
   */
  igniteNear(x: number, y: number, reachPx: number): number {
    let caught = 0;
    for (const entry of this.entries) {
      // Oil only ever lies with the drum that held it: a fixture's spill
      // cannot be oil, so a spill with no piece never burns.
      if (!isUnlitOil(entry) || entry.kind === null) continue;
      if (Math.hypot(centreX(entry) - x, centreY(entry) - y) > reachPx) continue;
      entry.burnFrames = OIL_BURN_FRAMES;
      this.ignitions.push({ tileX: entry.tileX, tileY: entry.tileY, kind: entry.kind });
      caught++;
    }
    return caught;
  }

  /** Spills that caught fire since the last call. */
  drainIgnitions(): Ignition[] {
    return this.ignitions.splice(0, this.ignitions.length);
  }

  /**
   * Ages the field one frame: coals dim, fires burn down to char and spread
   * to oil they touch, glowing coals light oil beside them, and wreckage
   * under a prop that stands again is cleared away.
   */
  update(propStandsAt: (tileX: number, tileY: number) => boolean): void {
    this.frame++;
    const checkCoals = this.frame % COALS_IGNITE_CHECK_FRAMES === 0 && this.hasUnlitOil;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.kind !== null && propStandsAt(entry.tileX, entry.tileY)) {
        this.entries.splice(i, 1);
        continue;
      }
      if (entry.glowFrames > 0) {
        entry.glowFrames--;
        if (checkCoals) this.igniteNear(centreX(entry), centreY(entry), COALS_IGNITE_PX);
      }
      if (entry.burnFrames <= 0) continue;
      if (burnedFrames(entry) === OIL_FIRE_SPREAD_FRAMES) {
        this.igniteNear(centreX(entry), centreY(entry), OIL_FIRE_SPREAD_PX);
      }
      entry.burnFrames--;
      if (entry.burnFrames === 0) entry.burnt = true;
    }
  }

  /** Whether any burning spill bites this frame, so callers gather bodies only then. */
  get bitesThisFrame(): boolean {
    return this.entries.some(isDamageFrame);
  }

  /**
   * Whether a fire that bites this frame covers world `(x, y)`. Each spill
   * keeps its own phase from its own catch, so a fire lit while another burns
   * still waits out its whole rise.
   */
  bitesAt(x: number, y: number): boolean {
    for (const entry of this.entries) {
      if (!isDamageFrame(entry)) continue;
      if (Math.hypot(centreX(entry) - x, centreY(entry) - y) < OIL_FIRE_RADIUS_PX) return true;
    }
    return false;
  }

  /**
   * Which way out of the nearest fire covering world `(x, y)`, or null. Counts
   * fire still rising: a route planned onto it is a route into fire.
   */
  fireEscape(x: number, y: number): { dx: number; dy: number } | null {
    let nearest: Wreckage | null = null;
    let nearestDistance = OIL_FIRE_RADIUS_PX;
    for (const entry of this.entries) {
      if (entry.burnFrames <= 0) continue;
      const distance = Math.hypot(centreX(entry) - x, centreY(entry) - y);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    if (nearest === null) return null;
    if (nearestDistance === 0) return { dx: 1, dy: 0 };
    return {
      dx: (x - centreX(nearest)) / nearestDistance,
      dy: (y - centreY(nearest)) / nearestDistance,
    };
  }

  /** Coals glow and spills burn: both light the room round them. */
  collectLights(sink: DynamicLightSink): void {
    for (const entry of this.entries) {
      if (entry.glowFrames > 0) {
        sink.add(centreX(entry), centreY(entry), 'coals', entry.glowFrames / COALS_GLOW_FRAMES);
      }
      if (entry.burnFrames > 0) {
        sink.add(centreX(entry), centreY(entry), OIL_FIRE_LIGHT, fireStrength(entry));
      }
    }
  }

  /** The spills, flat on the floor, drawn before the wreckage that lies on them. */
  renderSpills(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const entry of this.entries) {
      if (entry.spill === null) continue;
      drawSpill(
        ctx,
        entry.spill,
        entry.burnt ? 'burnt' : 'fresh',
        spillVariant(entry.tileX, entry.tileY),
        centreX(entry) - camX,
        centreY(entry) - camY,
      );
    }
  }

  /** What is alive on the floor: coals' embers and the fire on a burning spill. */
  renderLive(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const entry of this.entries) {
      if (entry.glowFrames > 0) {
        drawCoalEmbers(
          ctx,
          spillVariant(entry.tileX, entry.tileY),
          centreX(entry) - camX,
          centreY(entry) - camY,
          entry.glowFrames / COALS_GLOW_FRAMES,
          this.frame,
        );
      }
    }
    this.renderFires(ctx, camX, camY);
  }

  /**
   * Just the fires, for drawing a second time over the darkness: a burning
   * spill is a hazard, and a hazard in a dark room must never be dimmed.
   */
  renderFires(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const entry of this.entries) {
      if (entry.burnFrames <= 0) continue;
      const strength = fireStrength(entry);
      for (let index = 0; index < FLAME_OFFSETS.length; index++) {
        const offset = FLAME_OFFSETS[index];
        drawLavaFlame(
          ctx,
          centreX(entry) + offset.x * TILE_SIZE - camX,
          centreY(entry) + offset.y * TILE_SIZE - camY,
          TILE_SIZE,
          burnedFrames(entry),
          entry.order + index,
          strength,
        );
      }
    }
  }

  /** Every entry, copied, for a checkpoint. */
  capture(): Wreckage[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  restore(saved: ReadonlyArray<Wreckage>): void {
    this.entries.length = 0;
    for (const entry of saved) this.entries.push({ ...entry });
    this.nextOrder = this.entries.reduce((next, entry) => Math.max(next, entry.order + 1), 0);
    this.ignitions.length = 0;
  }
}

/** A fire rises over its catch and dies over its last frames. */
function fireStrength(entry: Wreckage): number {
  const rising = Math.min(1, burnedFrames(entry) / OIL_FIRE_CATCH_FRAMES);
  const dying = Math.min(1, entry.burnFrames / FIRE_FADE_FRAMES);
  return Math.max(0, Math.min(rising, dying));
}
