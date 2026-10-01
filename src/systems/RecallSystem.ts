/**
 * RecallSystem — the Wayfinder's Anchor's fast travel.
 *
 * A press opens the travel menu (through the scene, which owns it); a row
 * chosen there starts a channel to that destination, and a finished channel
 * warps the party there. That is what turns a town round trip — sell,
 * restock, touch the checkpoint, turn in — from long walks into none.
 *
 * The system owns the channel and the cooldown, and nothing else. The position
 * writes and the Mongo/mercenary dismissal stay with the scene, which owns
 * those objects; this asks for a destination tile and is told whether the
 * party got there. The destinations themselves are data in
 * `travel/travelDestinations.ts`.
 *
 * The cooldown survives a checkpoint restore, or dying would be the cheapest
 * way to reset it. A channel in progress does not.
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
import {
  NOT_ON_THIS_MAP_REASON,
  travelDestination,
  travelRefusal,
  type TravelDestination,
  type TravelDestinationId,
  type TravelUnlockState,
} from './travel/travelDestinations';

/**
 * Three seconds at 60 fps — long enough that a fight interrupts it.
 *
 * `charging_up_1`, played once at channel start, runs almost exactly this
 * long; retuning this constant meaningfully will leave the sound finishing
 * early or late against the channel bar.
 */
const RECALL_CHANNEL_FRAMES = 180;
/**
 * Sixty seconds at 60 fps, shared by every destination and both crawlers.
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

const TILE_CENTRE_FRACTION = 0.5;

const INERT_UNDERGROUND_TOAST = 'The stone is inert underground.';
const BOSS_FIGHT_TOAST = 'The stone will not answer mid-fight.';
const ENEMIES_NEARBY_TOAST = 'Too dangerous — enemies nearby.';
const NO_LANDING_TOAST = 'The stone can find no ground to set you on.';
const CANCELLED_TOAST = 'You let the stone go cold.';
const MOVED_TOAST = 'You moved — the stone lost its hold.';
const STRUCK_TOAST = 'The blow broke the stone’s hold.';

// Channel bar, drawn over the channelling crawler's head
const CHANNEL_BAR_WIDTH_PX = 72;
const CHANNEL_BAR_HEIGHT_PX = 6;
/** How far above the crawler's tile origin the bar sits. */
const CHANNEL_BAR_Y_OFFSET_PX = 16;
const CHANNEL_LABEL_Y_GAP_PX = 14;
const CHANNEL_LABEL_SIZE = 10;
const CHANNEL_LABEL_COLOR = '#e0f2fe';

interface RecallChannel {
  destination: TravelDestination;
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
 * What survives a checkpoint restore and a building-exit scene rebuild. The
 * live channel is absent on purpose — see the class doc.
 */
export interface RecallCheckpoint {
  cooldownFrames: number;
}

export class RecallSystem implements GameSystem {
  private channel: RecallChannel | null = null;
  private cooldownRemaining = 0;

  /**
   * @param teleportParty Moves both crawlers to (or as near as it can get to)
   *   the given tile, reporting whether it found somewhere to put them. The
   *   scene owns this because it owns the crawlers, Mongo and the mercenaries.
   * @param travelState The questlines' live progress, read for every unlock.
   * @param openTravelMenu Shows the destination list for `caster`; a row
   *   chosen there comes back through `beginChannelTo`.
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
    private readonly travelState: TravelUnlockState,
    private readonly openTravelMenu: (caster: HumanPlayer | CatPlayer) => void,
  ) {}

  /** Frames left before the stone will answer again; zero when it is ready. */
  get cooldownRemainingFrames(): number {
    return this.cooldownRemaining;
  }

  /** Whether a channel is running, so the party is about to be moved unless it is given up. */
  get isChannelling(): boolean {
    return this.channel !== null;
  }

  captureCheckpoint(): RecallCheckpoint {
    return { cooldownFrames: this.cooldownRemaining };
  }

  /**
   * Also how a building-exit rebuild carries the cooldown across: any channel
   * in progress does not survive a scene rebuild regardless — the caster
   * reference it holds belongs to the `Player` instance being replaced.
   */
  restoreCheckpoint(snapshot: RecallCheckpoint): void {
    this.channel = null;
    this.cooldownRemaining = snapshot.cooldownFrames;
  }

  /**
   * The hotbar press. A press during a channel gives it up, so the same key
   * both starts and abandons a trip; otherwise the press either is refused
   * outright or opens the travel menu.
   */
  requestTravel(caster: HumanPlayer | CatPlayer): void {
    if (this.channel !== null) {
      this.audio?.play('menu_click');
      this.endChannel(CANCELLED_TOAST);
      return;
    }
    if (!this.passesPressRefusals(caster)) return;
    this.openTravelMenu(caster);
  }

  /**
   * Starts the channel to a destination chosen from the travel menu. Every
   * refusal is asked again here, the destination's own included, so a caller
   * that skips the menu is held to the same rules as one that used it.
   *
   * @returns whether the channel started.
   */
  beginChannelTo(caster: HumanPlayer | CatPlayer, destinationId: TravelDestinationId): boolean {
    if (this.channel !== null) return false;
    if (!this.passesPressRefusals(caster)) return false;
    const destination = travelDestination(destinationId);
    const refusal = travelRefusal(destination, this.travelState, this.gameMap, caster);
    if (refusal !== null) {
      this.audio?.play('error_taking_action');
      this.showToast(refusal);
      return false;
    }

    // -1 is below any real `framesSinceLastDamage`, so the first tick's
    // struck-check can never fire on a stale reading — it only ever seeds the
    // comparison for the tick after.
    this.channel = {
      destination,
      caster,
      framesElapsed: 0,
      lastHumanDamageFrames: -1,
      lastCatDamageFrames: -1,
    };
    this.audio?.play('charging_up_1');
    return true;
  }

  update(ctx: SystemContext): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining--;
    this.tickChannel(ctx);
  }

  /**
   * The refusals that hold whatever the destination, answered with their
   * sound and toast. False when one applied.
   */
  private passesPressRefusals(caster: HumanPlayer | CatPlayer): boolean {
    // The overlay on the hotbar slot already counts this one down, so a toast
    // saying the same thing would be the third time the game has said it.
    if (this.cooldownRemaining > 0) {
      this.audio?.play('error_taking_action');
      return false;
    }
    const refusal = this.pressRefusal(caster);
    if (refusal === null) return true;
    this.audio?.play('error_taking_action');
    this.showToast(refusal);
    return false;
  }

  /** The one reason this press cannot use the stone at all, or null if it can. */
  private pressRefusal(caster: HumanPlayer | CatPlayer): string | null {
    if (this.levelDef.isOverworld !== true) return INERT_UNDERGROUND_TOAST;
    if (this.isBossFightActive()) return BOSS_FIGHT_TOAST;
    if (this.hasNearbyEnemy(caster, RECALL_ENEMY_BLOCK_RADIUS_PX)) return ENEMIES_NEARBY_TOAST;
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
    const landingTile = channel.destination.landingTile(this.gameMap);
    if (landingTile === null) {
      this.audio?.play('error_taking_action');
      this.endChannel(NOT_ON_THIS_MAP_REASON);
      return;
    }

    if (!this.teleportParty(landingTile)) {
      this.audio?.play('error_taking_action');
      this.endChannel(NO_LANDING_TOAST);
      return;
    }

    this.channel = null;
    this.cooldownRemaining = RECALL_COOLDOWN_FRAMES;
    this.audio?.play('teleport');
    this.showToast(channel.destination.arrivalToast);
    this.bus.emit('fastTravelUsed', {
      destination: channel.destination.id,
      tileX: landingTile.x,
      tileY: landingTile.y,
    });
  }

  /** Drops the channel with a reason. A given-up channel costs nothing. */
  private endChannel(message: string): void {
    this.channel = null;
    this.showToast(message);
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderChannelBar(ctx, camX, camY);
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
    drawText(ctx, channel.destination.channelLabel, {
      x: centreX,
      y: barY - CHANNEL_LABEL_Y_GAP_PX,
      size: CHANNEL_LABEL_SIZE,
      bold: true,
      color: CHANNEL_LABEL_COLOR,
      align: 'center',
      outline: true,
    });
  }
}
