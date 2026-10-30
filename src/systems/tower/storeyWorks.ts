/**
 * What one of the tower's storeys runs while the party stands on it: the
 * cattery's latches, the archive's wards, the kitchen's dumbwaiter foot, the
 * bell storey's bells. Each storey's works are one object the tower's
 * encounter ticks and draws only while that storey is on show; everything a
 * storey leaves behind for the other side is written to the questline's
 * progress, which the next build of any storey reads.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { PartySplitState } from '../../core/party/partySplit';
import type { MissingCatsProgress } from '../../core/quests/missingCatsProgress';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { Mob } from '../../creatures/Mob';
import type { GameMap } from '../../map/GameMap';
import type { TowerConditions, TowerTile } from '../../map/town/interiors/townCenterTower';
import type { Player } from '../../Player';
import type { SystemContext } from '../GameSystem';
import type { RoomMechanisms } from '../roomMechanisms/RoomMechanisms';
import type { SenseLayer } from '../senses/SenseLayer';
import type { WorkChannelBuilder } from '../WorkChannel';
import type { TowerMoment } from './towerMoments';
import { TOWER_CUES, type TowerCue } from '../../audio/towerSoundCues';

/** Everything a storey's works are handed: its own map and room works, and the party's shared records. */
export interface StoreyWorksDeps {
  readonly map: GameMap;
  readonly progress: MissingCatsProgress;
  readonly conditions: TowerConditions;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly senses: SenseLayer;
  readonly mechanisms: RoomMechanisms;
  readonly split: PartySplitState;
  /** Puts a creature into this storey's roster. */
  readonly addMob: (mob: Mob) => void;
  /** Takes a creature out of this storey's roster for good. */
  readonly removeMob: (mob: Mob) => void;
  /** The crawlers standing on the storey on show. */
  readonly presentCrawlers: () => readonly Player[];
  /**
   * The party's companions standing on the storey on show: never caught
   * themselves, but a watcher that sees one is put on its guard.
   */
  readonly presentCompanions: () => readonly Player[];
  /** Stands the party's own companions on the storey on show beside the crawler each follows, the crawlers left where they are. */
  readonly regroupCompanions: () => void;
  /** Sets both crawlers down together on `tile` of the storey on show, their companions beside them. */
  readonly setPartyDown: (tile: TowerTile) => void;
  readonly toast: (text: string) => void;
}

/** A storey's works. Every member but `update` is optional: a storey without it has nothing to do there. */
export abstract class StoreyWorks {
  constructor(protected readonly deps: StoreyWorksDeps) {}

  abstract update(ctx: SystemContext): void;

  /** An interact press on this storey; true when the works took it. */
  tryInteract?(ctx: SystemContext): boolean;

  /** The party has come onto this storey. */
  enter?(ctx: SystemContext): void;

  /** The party has left this storey; anything held only while it was on show is let go. */
  leave?(): void;

  /** Under the figures. */
  renderWorld?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;

  /** Over the figures. */
  renderEffects?(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;

  /** Prompts and progress bars over the works' fittings. */
  renderInteractionPrompts?(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void;

  /** Things the works draw in the room's depth-sorted pass. */
  roomFigures?(): InteriorFigure[];

  /** Placed props the works draw themselves, or that no longer stand where the layout put them. */
  hiddenProps?(): ReadonlySet<string>;

  /**
   * The Warden has fallen while this storey stood built: whatever it still
   * holds against the party (a ward, a watcher) goes, so the way down is
   * open. Called once, whichever storey the party is on.
   */
  standDown?(): void;

  dispose?(): void;

  protected moment(moment: TowerMoment): void {
    this.deps.bus.emit('towerMoment', { moment });
  }

  /** Plays a random take of `cue` at world pixel `at`, or heard storey-wide with no point. */
  protected play(cue: TowerCue, at: { readonly x: number; readonly y: number } | null): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    const takes: readonly SoundId[] = TOWER_CUES[cue];
    if (takes.length === 0) return;
    const id = takes[Math.floor(Math.random() * takes.length)];
    if (at === null) audio.play(id);
    else audio.playAt(id, at.x, at.y);
  }
}

const TILE_CENTRE = 0.5;

/** The centre of a tile, in world pixels. */
export function tileCentrePx(tile: TowerTile): { x: number; y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

/** The top-left of a tile, in world pixels: where a body standing on it is placed. */
export function tileOriginPx(tile: TowerTile): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/** The tile a body's centre stands over. */
export function tileOfBody(body: { readonly x: number; readonly y: number }): TowerTile {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
  };
}

export function sameTile(a: TowerTile, b: TowerTile): boolean {
  return a.x === b.x && a.y === b.y;
}
