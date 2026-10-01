/**
 * The soundscape of dungeon floors 1 and 2: the floor's bed, a room's own bed,
 * a positional loop at every torch, tube, panel and valve, and now and then a
 * quiet one-shot from somewhere unseen — a drip, a pipe knock, stone settling,
 * a distant growl.
 *
 * Loops run through an {@link AmbientSoundSystem}, which takes the loudest
 * emitter of each sound and ramps one shared voice to it. The plan of
 * emitters ({@link planDungeonEmitters}) is rebuilt when something breaks
 * ({@link markDirty}), so a smashed brazier falls silent, and only the
 * emitters near the listener are handed to the loop system, so a floor of
 * seven hundred torches costs what the dozen in earshot cost.
 *
 * The whole soundscape ducks in a safe room (it is the reward, and quiet) and
 * under a boss fight (whose music carries it), and goes silent on the death,
 * level-complete and run-complete screens. The pause menu needs nothing here:
 * it mutes the ambience bus every loop plays through.
 */

import { TILE_SIZE } from '../../core/constants';
import type { AudioManager } from '../../audio/AudioManager';
import type { GameMap } from '../../map/GameMap';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import type { AmbientOneShotId } from '../../map/dungeon/roomCharacters';
import { AmbientSoundSystem, type AmbientEmitter } from '../AmbientSoundSystem';
import {
  AMBIENT_ONE_SHOT_CUES,
  dungeonLoopSound,
  playDungeonCue,
  type DungeonCue,
} from './dungeonSoundCues';
import {
  CAMERA_SERVO_VOICE,
  boneRemainsTiles,
  flySiteCandidates,
  planDungeonEmitters,
  type TilePoint,
  type PlannedEmitter,
  type StaticLightTile,
} from './dungeonEmitters';

const FRAMES_PER_SECOND = 60;
/** The gap between ambient one-shots, in seconds. */
const ONE_SHOT_GAP_MIN_S = 6;
const ONE_SHOT_GAP_MAX_S = 20;
/** A growl is rare: at most one in this many seconds, however often it is drawn. */
const GROWL_MIN_GAP_S = 45;
const ONE_SHOT_VOLUME_MIN = 0.2;
const ONE_SHOT_VOLUME_SPREAD = 0.15;
/** One-shots come from a random direction, never hard left or right. */
const ONE_SHOT_MAX_PAN = 0.8;
/** A drip plays from a puddle this close to the listener, when one is near. */
const DRIP_SYNC_RADIUS_TILES = 9;
/** A sound placed in the world is heard out to this many tiles. */
const PLACED_HEARING_TILES = 14;
/** A sound this many tiles to the side is panned as far as it goes. */
const PAN_SPREAD_TILES = 8;
/** Below this a placed one-shot is not worth a voice. */
const PLACED_AUDIBLE_GAIN = 0.02;
/** How much of the soundscape is left in a safe room. */
const SAFE_ROOM_DUCK = 0.3;
/** How much is left while a boss fight is on. */
const BOSS_FIGHT_DUCK = 0.5;
/** Share of the gap to the duck target closed each frame: about a second's fade. */
const DUCK_EASE = 0.05;
/** Emitters this much beyond their own reach are left out of the loop system. */
const CULL_MARGIN_TILES = 4;
/** The listener moves this many tiles and the nearby emitters are picked again. */
const CULL_REFRESH_TILES = 2;
/** A camera's bearing to the listener moves more than this a frame, and it is turning. */
const CAMERA_TURN_EPSILON_RAD = 0.004;
/** The servo keeps whirring this long after the last turn, so a stop-start walk is one sound. */
const CAMERA_SERVO_HOLD_FRAMES = 12;
/** One-shots each floor falls back on in a region whose character names none. */
const FLOOR_ONE_SHOTS: Readonly<Record<DungeonFloorThemeId, ReadonlyArray<AmbientOneShotId>>> = {
  cellars: ['water_drip', 'stone_settle', 'distant_growl'],
  service_level: ['water_drip', 'pipe_knock', 'fluorescent_flicker'],
};

/** The tiles of standing water on a floor, for placing a drip. */
export interface PuddleTiles {
  readonly tiles: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface DungeonAmbienceDeps {
  readonly gameMap: GameMap;
  /** Null when the scene runs without audio; the scheduler still places drips. */
  readonly audio: AudioManager | null;
  readonly floor: DungeonFloorThemeId;
  /** The lighting pass's static lights, or null on a floor it does not light. */
  readonly lights: (() => ReadonlyArray<StaticLightTile>) | null;
  readonly puddles: PuddleTiles;
  /**
   * Hands a drip to a puddle: the drop falls there and its one-shot plays,
   * at `volume`, as it lands. Returns false when the drop could not fall, and
   * the drip is then played at once from a random direction.
   */
  readonly onDrip: (tileX: number, tileY: number, volume: number) => boolean;
  readonly random?: () => number;
  /** What broken props left on the floor, so smashed bones keep their flies; absent for none. */
  readonly wreckage?: () => ReadonlyArray<{
    readonly tileX: number;
    readonly tileY: number;
    readonly kind: string | null;
  }>;
}

/** What the soundscape needs to know about the frame. */
export interface AmbienceFrame {
  /** The active crawler's centre, in world pixels. */
  readonly listenerX: number;
  readonly listenerY: number;
  readonly inSafeRoom: boolean;
  readonly bossFight: boolean;
}

interface CameraServo {
  readonly emitter: AmbientEmitter;
  readonly planned: PlannedEmitter;
  bearing: number | null;
  holdFrames: number;
}

export class DungeonAmbienceSystem {
  private readonly loops: AmbientSoundSystem | null;
  private readonly random: () => number;
  private planned: PlannedEmitter[] = [];
  private dirty = true;
  /** The emitters handed to the loop system, rebuilt when the listener moves or a rescan lands. */
  private readonly nearby: AmbientEmitter[] = [];
  private readonly cameras: CameraServo[] = [];
  private cullTileX = Number.NaN;
  private cullTileY = Number.NaN;
  private framesToOneShot: number;
  private framesSinceGrowl = Number.POSITIVE_INFINITY;
  private duck = 1;
  private readonly cueTakes = new Map<DungeonCue, number>();
  private listenerX = 0;
  private listenerY = 0;
  /** Every tile that held bones when the floor was built. */
  private readonly flyCandidates: ReadonlyArray<TilePoint>;

  constructor(private readonly deps: DungeonAmbienceDeps) {
    this.random = deps.random ?? Math.random;
    this.loops = deps.audio === null ? null : new AmbientSoundSystem(deps.audio, []);
    this.framesToOneShot = this.nextOneShotGap();
    this.flyCandidates = flySiteCandidates(deps.gameMap.structure);
  }

  /** Something broke or was put back: the emitters are re-planned on the next update. */
  markDirty(): void {
    this.dirty = true;
  }

  /** The current plan, silent cues included; for the gates. */
  plannedEmitters(): ReadonlyArray<PlannedEmitter> {
    if (this.dirty) this.rescan();
    return this.planned;
  }

  update(frame: AmbienceFrame): void {
    this.listenerX = frame.listenerX;
    this.listenerY = frame.listenerY;
    if (this.dirty) this.rescan();
    const listenerTileX = frame.listenerX / TILE_SIZE;
    const listenerTileY = frame.listenerY / TILE_SIZE;
    const neverCulled = Number.isNaN(this.cullTileX) || Number.isNaN(this.cullTileY);
    const movedFar =
      neverCulled ||
      Math.abs(listenerTileX - this.cullTileX) >= CULL_REFRESH_TILES ||
      Math.abs(listenerTileY - this.cullTileY) >= CULL_REFRESH_TILES;
    if (movedFar) this.cull(listenerTileX, listenerTileY);
    this.turnCameras(listenerTileX, listenerTileY);

    const duckTarget = frame.inSafeRoom ? SAFE_ROOM_DUCK : frame.bossFight ? BOSS_FIGHT_DUCK : 1;
    this.duck += (duckTarget - this.duck) * DUCK_EASE;
    this.loops?.setGainScale(this.duck);
    this.loops?.updateListener(frame.listenerX, frame.listenerY);

    this.framesSinceGrowl++;
    this.framesToOneShot--;
    if (this.framesToOneShot > 0) return;
    this.framesToOneShot = this.nextOneShotGap();
    if (frame.inSafeRoom || frame.bossFight) return;
    this.playOneShot(listenerTileX, listenerTileY);
  }

  /**
   * Plays a cue from a point in the world: quieter with distance from the
   * listener and panned toward its side. Silent past
   * {@link PLACED_HEARING_TILES} and for a cue with no sound yet.
   */
  playAt(cue: DungeonCue, worldX: number, worldY: number, volume = 1): void {
    const dxTiles = (worldX - this.listenerX) / TILE_SIZE;
    const dyTiles = (worldY - this.listenerY) / TILE_SIZE;
    const falloff = 1 - Math.hypot(dxTiles, dyTiles) / PLACED_HEARING_TILES;
    const gain = volume * falloff * this.duck;
    if (gain < PLACED_AUDIBLE_GAIN) return;
    const pan = Math.max(-1, Math.min(1, dxTiles / PAN_SPREAD_TILES)) * ONE_SHOT_MAX_PAN;
    playDungeonCue(this.deps.audio, cue, this.cueTakes, { volume: gain, pan });
  }

  /** An end screen: every loop down to nothing at once, without waiting for an update. */
  silence(): void {
    this.duck = 0;
    this.loops?.setGainScale(0);
    this.loops?.updateListener(this.listenerX, this.listenerY);
  }

  dispose(): void {
    this.loops?.dispose();
  }

  private rescan(): void {
    this.dirty = false;
    this.planned = planDungeonEmitters({
      gameMap: this.deps.gameMap,
      floor: this.deps.floor,
      lights: this.deps.lights?.() ?? null,
      flySiteCandidates: this.flyCandidates,
      boneRemains: boneRemainsTiles(this.deps.wreckage?.() ?? []),
    });
    this.cullTileX = Number.NaN;
    this.cullTileY = Number.NaN;
  }

  /** Hands the loop system only the emitters in earshot, and the floor's beds. */
  private cull(listenerTileX: number, listenerTileY: number): void {
    this.cullTileX = listenerTileX;
    this.cullTileY = listenerTileY;
    this.nearby.length = 0;
    this.cameras.length = 0;
    for (const planned of this.planned) {
      const soundId = dungeonLoopSound(planned.cue);
      if (soundId === null) continue;
      const reach = planned.radiusTiles + CULL_MARGIN_TILES;
      const near =
        planned.constant ||
        Math.hypot(planned.x - listenerTileX, planned.y - listenerTileY) <= reach;
      if (!near) continue;
      const emitter: AmbientEmitter = {
        soundId,
        x: planned.x,
        y: planned.y,
        radiusTiles: planned.radiusTiles,
        maxVolume: planned.source === 'camera' ? 0 : planned.maxVolume,
        constant: planned.constant,
      };
      this.nearby.push(emitter);
      if (planned.source === 'camera') {
        this.cameras.push({ emitter, planned, bearing: null, holdFrames: 0 });
      }
    }
    this.loops?.setEmitters(this.nearby);
  }

  /** A camera dome tracks the listener; its servo whirs only while the bearing moves. */
  private turnCameras(listenerTileX: number, listenerTileY: number): void {
    for (const camera of this.cameras) {
      const bearing = Math.atan2(
        listenerTileY - camera.planned.y,
        listenerTileX - camera.planned.x,
      );
      const turned =
        camera.bearing !== null &&
        Math.abs(angleBetween(bearing, camera.bearing)) > CAMERA_TURN_EPSILON_RAD;
      camera.bearing = bearing;
      camera.holdFrames = turned ? CAMERA_SERVO_HOLD_FRAMES : Math.max(0, camera.holdFrames - 1);
      camera.emitter.maxVolume = camera.holdFrames > 0 ? CAMERA_SERVO_VOICE.maxVolume : 0;
    }
  }

  private nextOneShotGap(): number {
    const seconds = ONE_SHOT_GAP_MIN_S + this.random() * (ONE_SHOT_GAP_MAX_S - ONE_SHOT_GAP_MIN_S);
    return Math.round(seconds * FRAMES_PER_SECOND);
  }

  private playOneShot(listenerTileX: number, listenerTileY: number): void {
    const character = this.deps.gameMap.regionCharacters.characterAt(
      Math.floor(listenerTileX),
      Math.floor(listenerTileY),
    );
    const named = character?.ambience.oneShots ?? [];
    const choices = named.length > 0 ? named : FLOOR_ONE_SHOTS[this.deps.floor];
    const growlTooSoon = this.framesSinceGrowl < GROWL_MIN_GAP_S * FRAMES_PER_SECOND;
    const allowed = choices.filter((id) => id !== 'distant_growl' || !growlTooSoon);
    if (allowed.length === 0) return;
    const id = allowed[Math.floor(this.random() * allowed.length)];
    if (id === 'distant_growl') this.framesSinceGrowl = 0;
    const baseVolume = ONE_SHOT_VOLUME_MIN + this.random() * ONE_SHOT_VOLUME_SPREAD;
    const cue = AMBIENT_ONE_SHOT_CUES[id];

    if (id === 'water_drip') {
      const puddle = this.randomPuddleNear(listenerTileX, listenerTileY);
      // The landing plays through playAt, which places and ducks it, so the
      // drop is handed the volume before ducking.
      if (puddle !== null && this.deps.onDrip(puddle.x, puddle.y, baseVolume)) return;
    }
    const volume = baseVolume * this.duck;
    const pan = (this.random() * 2 - 1) * ONE_SHOT_MAX_PAN;
    playDungeonCue(this.deps.audio, cue, this.cueTakes, { volume, pan });
  }

  /**
   * One puddle picked at random from those within
   * {@link DRIP_SYNC_RADIUS_TILES} of the listener, or null when none is that
   * close. One pass, nothing collected.
   */
  private randomPuddleNear(
    listenerTileX: number,
    listenerTileY: number,
  ): { readonly x: number; readonly y: number } | null {
    let picked: { readonly x: number; readonly y: number } | null = null;
    let seen = 0;
    for (const tile of this.deps.puddles.tiles) {
      const distance = Math.hypot(tile.x - listenerTileX, tile.y - listenerTileY);
      if (distance > DRIP_SYNC_RADIUS_TILES) continue;
      seen++;
      if (this.random() * seen < 1) picked = tile;
    }
    return picked;
  }
}

/**
 * The signed turn from `from` to `to`, in (-π, π], so a bearing crossing ±π is
 * a small turn.
 */
function angleBetween(to: number, from: number): number {
  const turn = to - from;
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}
