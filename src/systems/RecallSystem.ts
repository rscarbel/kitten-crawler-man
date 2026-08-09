/**
 * RecallSystem — the Wayfinder's Anchor's two-way fast travel.
 *
 * One stone, two modes, chosen by where the party is standing rather than by a
 * menu: out in the Over City it channels and pulls the party home to the town
 * square, remembering the tile it left from; standing in the square it channels
 * and puts them back on that tile. That is what turns a town round trip — sell,
 * restock, touch the checkpoint, turn in — from two long walks into none.
 *
 * The system owns the channel, the cooldown and the trail anchor, and nothing
 * else. The position writes and the Mongo/mercenary dismissal stay with the
 * scene, which owns those objects; this asks for a destination tile and is told
 * whether the party got there.
 *
 * The trail anchor is deliberately per-scene: a floor change or a checkpoint
 * restore drops it, because an anchor pointing into a map that has since been
 * regenerated is a tile chosen at random. The cooldown does *not* drop, or dying
 * would be the cheapest way to reset it.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { LevelDef } from '../levels/types';
import { TILE_SIZE } from '../core/constants';
import { PROGRESS_PRESETS, drawProgressBar } from '../ui/Box';
import { drawText } from '../ui/TextBox';
import { drawArrowAbovePlayer, type ArrowAvoidRect } from '../ui/WorldArrow';

/**
 * Three seconds at 60 fps — long enough that a fight interrupts it.
 *
 * `charging_up_1`, played once at channel start, runs almost exactly this
 * long; retuning this constant meaningfully will leave the sound finishing
 * early or late against the channel bar.
 */
const RECALL_CHANNEL_FRAMES = 180;
/**
 * Sixty seconds at 60 fps, shared by both modes and both crawlers.
 *
 * Overworld playtime, not wall-clock: this system's `update` only runs while
 * `DungeonScene` is the active scene, so time spent inside a building does not
 * count down the cooldown. A shop trip that outlasts the timer comes back out
 * to a stone that is ready sooner than sixty real seconds would suggest — the
 * opposite of a trap, so left as playtime rather than built out to track it.
 */
export const RECALL_COOLDOWN_FRAMES = 3600;
/** Any live hostile this close refuses the channel outright. */
const RECALL_ENEMY_BLOCK_RADIUS_TILES = 7;
const RECALL_ENEMY_BLOCK_RADIUS_PX = RECALL_ENEMY_BLOCK_RADIUS_TILES * TILE_SIZE;

/** How long the "your trail is that way" arrow shows after walking into the square. */
const TRAIL_HINT_FRAMES = 240;

const TILE_CENTRE_FRACTION = 0.5;

const INERT_UNDERGROUND_TOAST = 'The stone is inert underground.';
const BOSS_FIGHT_TOAST = 'The stone will not answer mid-fight.';
const ENEMIES_NEARBY_TOAST = 'Too dangerous — enemies nearby.';
const NO_TRAIL_TOAST = 'The stone has no trail to follow.';
const NO_TOWN_TOAST = 'The stone cannot find the Over City.';
const NO_LANDING_TOAST = 'The stone can find no ground to set you on.';
const CANCELLED_TOAST = 'You let the stone go cold.';
const MOVED_TOAST = 'You moved — the stone lost its hold.';
const STRUCK_TOAST = 'The blow broke the stone’s hold.';
const ARRIVED_HOME_TOAST = 'The stone sets you down in the Over City.';
const ARRIVED_TRAIL_TOAST = 'The stone sets you back on your trail.';

const RECALL_CHANNEL_LABEL = 'Recalling to the Over City…';
const RETURN_CHANNEL_LABEL = 'Returning to your trail…';

// Channel bar, drawn over the channelling crawler's head
const CHANNEL_BAR_WIDTH_PX = 72;
const CHANNEL_BAR_HEIGHT_PX = 6;
/** How far above the crawler's tile origin the bar sits. */
const CHANNEL_BAR_Y_OFFSET_PX = 16;
const CHANNEL_LABEL_Y_GAP_PX = 14;
const CHANNEL_LABEL_SIZE = 10;
const CHANNEL_LABEL_COLOR = '#e0f2fe';

const TRAIL_ARROW_COLOR = '#38bdf8';

/** Which direction the stone is pulling: out to the town square, or back out of it. */
export type RecallMode = 'recall' | 'return';

interface RecallChannel {
  mode: RecallMode;
  caster: HumanPlayer | CatPlayer;
  framesElapsed: number;
  /**
   * Each crawler's `framesSinceLastDamage` as observed last tick, so a hit is
   * caught by that counter *dropping* rather than by comparing it to how long
   * the channel has run. `framesSinceLastDamage` saturates at
   * `REGEN_SUPPRESS_FRAMES`, so a channel longer than that would otherwise never
   * see a strike register at all.
   */
  lastHumanDamageFrames: number;
  lastCatDamageFrames: number;
}

/**
 * What survives a checkpoint restore. The live channel and the trail anchor are
 * absent on purpose — see the class doc.
 */
export interface RecallCheckpoint {
  cooldownFrames: number;
}

/**
 * What survives a `DungeonScene` rebuilt on the *same* map — a building exit,
 * not a death or a floor change. Unlike `RecallCheckpoint`, the trail anchor
 * rides along here: the map instance is unchanged, so a tile recorded on the
 * way in still names real ground on the way out, and dropping it would erase
 * the return leg for every errand that involves a doorway.
 */
export interface RecallSceneRebuildState {
  cooldownFrames: number;
  trailAnchorTile: { x: number; y: number } | null;
}

export class RecallSystem implements GameSystem {
  private channel: RecallChannel | null = null;
  private cooldownRemaining = 0;
  private trailAnchorTile: { x: number; y: number } | null = null;
  private trailHintFramesLeft = 0;
  /** Previous frame's answer, so the hint fires on the *entry* into the square. */
  private wasInTownSafeZone = false;

  /**
   * @param teleportParty Moves both crawlers to (or as near as it can get to)
   *   the given tile, reporting whether it found somewhere to put them. The
   *   scene owns this because it owns the crawlers, Mongo and the mercenaries.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly levelDef: LevelDef,
    private readonly bus: EventBus,
    private readonly isBossFightActive: () => boolean,
    private readonly hasNearbyEnemy: (player: HumanPlayer | CatPlayer, rangePx: number) => boolean,
    private readonly teleportParty: (tile: { x: number; y: number }) => boolean,
    private readonly showToast: (message: string) => void,
    private readonly audio: AudioManager | null,
  ) {}

  /** Frames left before the stone will answer again; zero when it is ready. */
  get cooldownRemainingFrames(): number {
    return this.cooldownRemaining;
  }

  captureCheckpoint(): RecallCheckpoint {
    return { cooldownFrames: this.cooldownRemaining };
  }

  restoreCheckpoint(snapshot: RecallCheckpoint): void {
    this.channel = null;
    this.trailAnchorTile = null;
    this.trailHintFramesLeft = 0;
    this.cooldownRemaining = snapshot.cooldownFrames;
  }

  /** Read on the way out of a building-exit scene rebuild. */
  captureForSceneRebuild(): RecallSceneRebuildState {
    return { cooldownFrames: this.cooldownRemaining, trailAnchorTile: this.trailAnchorTile };
  }

  /**
   * Applied on the way in, once the rebuilt scene's own `RecallSystem` exists.
   * Any channel in progress does not survive a scene rebuild regardless — the
   * caster reference it holds belongs to the `Player` instance being replaced.
   */
  restoreFromSceneRebuild(state: RecallSceneRebuildState): void {
    this.cooldownRemaining = state.cooldownFrames;
    this.trailAnchorTile = state.trailAnchorTile;
  }

  /** The hotbar press: one key both starts the channel and gives it up. */
  toggle(caster: HumanPlayer | CatPlayer): void {
    if (this.channel !== null) {
      this.audio?.play('menu_click');
      this.endChannel(CANCELLED_TOAST);
      return;
    }
    this.beginChannel(caster);
  }

  update(ctx: SystemContext): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining--;
    this.trackSafeZoneEntry(ctx.active);
    this.tickChannel(ctx);
  }

  private beginChannel(caster: HumanPlayer | CatPlayer): void {
    // The overlay on the hotbar slot already counts this one down, so a toast
    // saying the same thing would be the third time the game has said it.
    if (this.cooldownRemaining > 0) {
      this.audio?.play('error_taking_action');
      return;
    }

    const mode: RecallMode = this.isInTownSafeZone(caster) ? 'return' : 'recall';
    const refusal = this.startRefusal(caster, mode);
    if (refusal !== null) {
      this.audio?.play('error_taking_action');
      this.showToast(refusal);
      return;
    }

    // -1 is below any real `framesSinceLastDamage`, so the first tick's
    // struck-check can never fire on a stale reading — it only ever seeds the
    // comparison for the tick after.
    this.channel = {
      mode,
      caster,
      framesElapsed: 0,
      lastHumanDamageFrames: -1,
      lastCatDamageFrames: -1,
    };
    this.audio?.play('charging_up_1');
  }

  /** The one reason this press cannot start a channel, or null if it can. */
  private startRefusal(caster: HumanPlayer | CatPlayer, mode: RecallMode): string | null {
    if (this.levelDef.isOverworld !== true) return INERT_UNDERGROUND_TOAST;
    if (this.isBossFightActive()) return BOSS_FIGHT_TOAST;
    if (this.hasNearbyEnemy(caster, RECALL_ENEMY_BLOCK_RADIUS_PX)) return ENEMIES_NEARBY_TOAST;
    if (mode === 'return' && this.trailAnchorTile === null) return NO_TRAIL_TOAST;
    if (mode === 'recall' && this.gameMap.townSquareCentre === undefined) return NO_TOWN_TOAST;
    return null;
  }

  private tickChannel(ctx: SystemContext): void {
    const channel = this.channel;
    if (channel === null) return;

    // Switching crawlers mid-channel hands the stone to someone who never
    // pressed it; the party has changed shape, so the hold is gone.
    if (ctx.active !== channel.caster) {
      this.endChannel(CANCELLED_TOAST);
      return;
    }
    if (ctx.activeIsMoving) {
      this.endChannel(MOVED_TOAST);
      return;
    }
    if (this.partyStruckDuringChannel(ctx, channel)) {
      this.endChannel(STRUCK_TOAST);
      return;
    }

    channel.framesElapsed++;
    if (channel.framesElapsed < RECALL_CHANNEL_FRAMES) return;
    this.completeChannel(channel);
  }

  /**
   * A fresh hit is read off `framesSinceLastDamage` *dropping* since the
   * previous tick, not off comparing it to the channel's own age: that counter
   * saturates at `REGEN_SUPPRESS_FRAMES`, so a channel any longer than that
   * would otherwise never see a strike land at all.
   */
  private partyStruckDuringChannel(ctx: SystemContext, channel: RecallChannel): boolean {
    const humanFrames = ctx.human.framesSinceLastDamage;
    const catFrames = ctx.cat.framesSinceLastDamage;
    const struck =
      humanFrames < channel.lastHumanDamageFrames || catFrames < channel.lastCatDamageFrames;
    channel.lastHumanDamageFrames = humanFrames;
    channel.lastCatDamageFrames = catFrames;
    return struck;
  }

  private completeChannel(channel: RecallChannel): void {
    const departureTile = this.tileOf(channel.caster);
    const destination =
      channel.mode === 'recall' ? (this.gameMap.townSquareCentre ?? null) : this.trailAnchorTile;
    if (destination === null) {
      this.audio?.play('error_taking_action');
      this.endChannel(channel.mode === 'recall' ? NO_TOWN_TOAST : NO_TRAIL_TOAST);
      return;
    }

    if (!this.teleportParty(destination)) {
      this.audio?.play('error_taking_action');
      this.endChannel(NO_LANDING_TOAST);
      return;
    }

    this.channel = null;
    this.cooldownRemaining = RECALL_COOLDOWN_FRAMES;
    this.trailAnchorTile = channel.mode === 'recall' ? departureTile : null;
    // The arrival re-crosses the safe-zone boundary; letting the next update's
    // edge test raise the hint is what points the stone back at the trail it
    // has just laid.
    this.trailHintFramesLeft = 0;
    this.audio?.play('teleport');
    this.showToast(channel.mode === 'recall' ? ARRIVED_HOME_TOAST : ARRIVED_TRAIL_TOAST);
    this.bus.emit('fastTravelUsed', {
      mode: channel.mode,
      tileX: destination.x,
      tileY: destination.y,
    });
  }

  /** Drops the channel with a reason. A given-up channel costs nothing. */
  private endChannel(message: string): void {
    this.channel = null;
    this.showToast(message);
  }

  private trackSafeZoneEntry(active: HumanPlayer | CatPlayer): void {
    const inZone = this.isInTownSafeZone(active);
    if (inZone && !this.wasInTownSafeZone && this.trailAnchorTile !== null) {
      this.trailHintFramesLeft = TRAIL_HINT_FRAMES;
    } else if (!inZone) {
      this.trailHintFramesLeft = 0;
    } else if (this.trailHintFramesLeft > 0) {
      this.trailHintFramesLeft--;
    }
    this.wasInTownSafeZone = inZone;
  }

  private isInTownSafeZone(player: HumanPlayer | CatPlayer): boolean {
    return this.gameMap.isInTownSafeZone(
      player.x + TILE_SIZE * TILE_CENTRE_FRACTION,
      player.y + TILE_SIZE * TILE_CENTRE_FRACTION,
    );
  }

  private tileOf(player: HumanPlayer | CatPlayer): { x: number; y: number } {
    return {
      x: Math.floor((player.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
      y: Math.floor((player.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE),
    };
  }

  render(
    ctx: CanvasRenderingContext2D,
    active: HumanPlayer | CatPlayer,
    camX: number,
    camY: number,
    avoidRect: ArrowAvoidRect,
  ): void {
    this.renderChannelBar(ctx, camX, camY);
    this.renderTrailArrow(ctx, active, camX, camY, avoidRect);
  }

  private renderChannelBar(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const channel = this.channel;
    if (channel === null) return;

    const centreX = channel.caster.x - camX + TILE_SIZE * TILE_CENTRE_FRACTION;
    const barY = channel.caster.y - camY - CHANNEL_BAR_Y_OFFSET_PX;
    drawProgressBar(ctx, {
      x: centreX - CHANNEL_BAR_WIDTH_PX / 2,
      y: barY,
      width: CHANNEL_BAR_WIDTH_PX,
      height: CHANNEL_BAR_HEIGHT_PX,
      value: channel.framesElapsed / RECALL_CHANNEL_FRAMES,
      ...PROGRESS_PRESETS.recall,
    });
    drawText(ctx, channel.mode === 'recall' ? RECALL_CHANNEL_LABEL : RETURN_CHANNEL_LABEL, {
      x: centreX,
      y: barY - CHANNEL_LABEL_Y_GAP_PX,
      size: CHANNEL_LABEL_SIZE,
      bold: true,
      color: CHANNEL_LABEL_COLOR,
      align: 'center',
      outline: true,
    });
  }

  private renderTrailArrow(
    ctx: CanvasRenderingContext2D,
    active: HumanPlayer | CatPlayer,
    camX: number,
    camY: number,
    avoidRect: ArrowAvoidRect,
  ): void {
    const anchor = this.trailAnchorTile;
    if (anchor === null || this.trailHintFramesLeft <= 0) return;
    drawArrowAbovePlayer(
      ctx,
      active.x,
      active.y,
      (anchor.x + TILE_CENTRE_FRACTION) * TILE_SIZE,
      (anchor.y + TILE_CENTRE_FRACTION) * TILE_SIZE,
      camX,
      camY,
      TRAIL_ARROW_COLOR,
      { avoidRect },
    );
  }
}
