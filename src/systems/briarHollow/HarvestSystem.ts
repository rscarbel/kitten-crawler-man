/**
 * Chopping and mining: the active crawler works the tree or rock in front of
 * them with the party's axe or pickaxe, and resources land in their own bag.
 *
 * One press starts a channel that carries on without the key held, the way a
 * lumberjack keeps swinging, until the crawler moves, fights, opens a menu,
 * gets hurt, fills their bag, or works the node out. Awards come on a fixed
 * interval counted in update ticks — never off the swing animation, so the
 * rate cannot depend on how the swing is drawn, and never off wall time, so a
 * frame that runs two updates cannot skip one.
 *
 * Works on any overworld tree or boulder: it needs no village, only a map.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { PlayOptions } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import { ITEM_DEF, type ItemId } from '../../core/ItemDefs';
import type { HarvestKind } from '../../core/craftPerks';
import type { PartyTools, PartyToolsState } from '../../core/PartyTools';
import type { ToolKind, ToolTier } from '../../core/toolTiers';
import {
  harvestAward,
  harvestIntervalTicks,
  harvestXp,
  resourceForHarvestKind,
  rollHarvestLuck,
  toolForHarvestKind,
} from '../../core/harvestYield';
import { addToSessionTally } from '../../core/resourceSessionTally';
import type { CrawlerKind } from '../../core/SkillManager';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameMap } from '../../map/GameMap';
import { CHOP_ROWS, humanRowOf, MINE_ROWS } from '../../sprites/art/humanFigure';
import { viewForFacing } from '../../sprites/humanSprite';
import { hostileWithinAttackRange } from '../interactionPromptGate';
import type { SystemContext } from '../GameSystem';
import type { HarvestEffects } from './HarvestEffects';
import type { NodeLedger } from './NodeLedger';
import { harvestKindAt } from './harvestNodes';

type Crawler = HumanPlayer | CatPlayer;

/** How far from a crawler's centre a node's centre may be and still be worked, in tiles. */
export const HARVEST_REACH_TILES = 1.3;
const HARVEST_REACH_PX = HARVEST_REACH_TILES * TILE_SIZE;
/**
 * How squarely a node must sit in front of the crawler to be picked over a
 * nearer one: within 60° of their facing.
 */
const FACING_PREFERENCE_DOT = 0.5;
/**
 * Movement past which the channel ends, in pixels from where it started —
 * measured position, because `isMoving` means "tried to walk", and a shove
 * that moves the body without a key press has to end it too.
 */
const CHANNEL_MOTION_TOLERANCE_PX = 0.5;
/** Donut has no tool row: her swipe plays on this cadence, and each one is a strike's feedback. */
const CAT_WORK_SWING_TICKS = 30;

/** A strike's pitch and loudness drift this far either side of the sample, so a long channel doesn't sound mechanical. */
const STRIKE_PITCH_JITTER = 0.05;
const STRIKE_VOLUME_JITTER = 0.1;
const STRIKE_BASE_VOLUME = 0.85;

const TILE_CENTER_OFFSET = 0.5;

/** The slice of `AudioManager` harvesting plays through; null in headless runs. */
export interface HarvestAudio {
  play(id: SoundId, opts?: PlayOptions): void;
  playRandom(ids: ReadonlyArray<SoundId>, opts?: PlayOptions): void;
}

export interface HarvestSystemDeps {
  readonly gameMap: GameMap;
  readonly ledger: NodeLedger;
  readonly tools: PartyToolsState;
  readonly partyTools: PartyTools;
  readonly effects: HarvestEffects;
  readonly bus: EventBus | null;
  readonly audio: HarvestAudio | null;
  /** A one-line notice to the player ("Your bag is full."). */
  readonly announce: (message: string) => void;
  /** The luck stream: seeded, and separate from every other roll, so a luck gate replays exactly. */
  readonly luckRng: () => number;
  /** Told on every award, build or strike that should keep the resource HUD up. */
  readonly noteActivity: () => void;
  /** Flashes a tree the axe has just bitten. */
  readonly onTreeStruck: (tileX: number, tileY: number) => void;
}

interface Channel {
  readonly harvester: Crawler;
  readonly kind: HarvestKind;
  readonly tileX: number;
  readonly tileY: number;
  readonly startX: number;
  readonly startY: number;
  /** HP when the channel started or last checked; any drop is a hit. */
  hp: number;
  /** Ticks banked toward the next award. */
  ticks: number;
  /** Ticks since Donut's last work swing. */
  catSwingTicks: number;
  /** Whether Carl's swing row is currently playing for this channel. */
  animating: boolean;
}

/** Why a channel ended, for the feedback it owes the player. */
type ChannelEnd = 'moved' | 'interrupted' | 'depleted' | 'bagFull' | 'hostile';

export class HarvestSystem {
  private channel: Channel | null = null;
  /**
   * Fractional yield carried between ticks, per crawler and per node kind: a
   * 1.5× axe alternates 1 and 2 across trees rather than losing the half each
   * time a tree falls. Skills are never shared, so neither is the carry.
   */
  private readonly carry = new Map<CrawlerKind, Record<HarvestKind, number>>();

  constructor(private readonly deps: HarvestSystemDeps) {}

  /** The node being worked, for the progress arc and the HUD, or null. */
  get workedNode(): { readonly tileX: number; readonly tileY: number } | null {
    return this.channel;
  }

  /** Whether `crawler` is mid-channel. */
  isHarvesting(crawler: Crawler): boolean {
    return this.channel?.harvester === crawler;
  }

  /**
   * Whether a Space press from `active` would be claimed by {@link tryStart} —
   * the same conditions, without starting anything — so a prompt drawn for
   * something later in the chain can stand aside.
   */
  wouldStartHarvest(active: Crawler): boolean {
    return active.craftSkills.isLearned('resourcing') && this.nodeInReach(active) !== null;
  }

  /**
   * The Space chain's entry: starts working the node in front of `active`.
   * Returns whether the press was claimed — true when a channel starts or is
   * already running on that node, and when the player is told they lack the
   * tool; false when the crawler has not learned Resourcing or no node is in
   * reach, so the press falls through to a swing.
   */
  tryStart(active: Crawler): boolean {
    if (!active.craftSkills.isLearned('resourcing')) return false;
    const node = this.nodeInReach(active);
    if (node === null) return false;

    const toolKind = toolForHarvestKind(node.kind);
    if (this.tierOf(toolKind) === null) {
      this.deps.announce(
        toolKind === 'axe' ? 'You need an axe for that.' : 'You need a pickaxe for that.',
      );
      this.deps.audio?.play('error');
      return true;
    }

    const running = this.channel;
    if (
      running !== null &&
      running.harvester === active &&
      running.tileX === node.tileX &&
      running.tileY === node.tileY
    ) {
      return true;
    }
    this.stop();
    const level = active.craftSkills.getLevel('resourcing');
    if (this.deps.ledger.stateAt(node.tileX, node.tileY, level) === null) return false;

    const faceX = (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - (active.x + TILE_SIZE / 2);
    const faceY = (node.tileY + TILE_CENTER_OFFSET) * TILE_SIZE - (active.y + TILE_SIZE / 2);
    const faceLength = Math.hypot(faceX, faceY);
    if (faceLength > 0) {
      active.facingX = faceX / faceLength;
      active.facingY = faceY / faceLength;
    }

    this.channel = {
      harvester: active,
      kind: node.kind,
      tileX: node.tileX,
      tileY: node.tileY,
      startX: active.x,
      startY: active.y,
      hp: active.hp,
      ticks: 0,
      catSwingTicks: 0,
      animating: false,
    };
    this.showWorking(this.channel);
    this.deps.noteActivity();
    return true;
  }

  /**
   * Advances the channel one fixed tick. `menuOpen` is whether any overlay
   * owns the screen: a menu ends the work rather than leaving it running
   * behind the panel.
   */
  update(ctx: SystemContext, menuOpen: boolean): void {
    const channel = this.channel;
    if (channel === null) return;
    const ended = this.interruption(channel, ctx, menuOpen);
    if (ended !== null) {
      this.end(ended);
      return;
    }
    this.deps.noteActivity();
    this.keepSwinging(channel);

    const level = channel.harvester.craftSkills.getLevel('resourcing');
    channel.ticks += 1;
    const interval = harvestIntervalTicks(channel.kind, level);
    if (channel.ticks < interval) return;
    channel.ticks -= interval;
    this.award(channel, level);
  }

  /** Ends any channel quietly, for a scene teardown or a system that takes the crawler over. */
  stop(): void {
    const channel = this.channel;
    if (channel === null) return;
    this.channel = null;
    this.hideWorking(channel);
  }

  private end(reason: ChannelEnd): void {
    if (reason === 'bagFull') {
      this.deps.announce('Your bag is full.');
      this.deps.audio?.play('error');
    }
    this.stop();
  }

  private interruption(channel: Channel, ctx: SystemContext, menuOpen: boolean): ChannelEnd | null {
    const harvester = channel.harvester;
    if (ctx.active !== harvester || !harvester.isAlive || menuOpen) return 'interrupted';
    const moved = Math.hypot(harvester.x - channel.startX, harvester.y - channel.startY);
    if (moved > CHANNEL_MOTION_TOLERANCE_PX) return 'moved';
    if (harvester.isSwinging) return 'interrupted';
    if (harvester.hp < channel.hp) return 'interrupted';
    channel.hp = harvester.hp;
    if (harvestKindAt(this.deps.gameMap, channel.tileX, channel.tileY) !== channel.kind) {
      return 'depleted';
    }
    if (hostileWithinAttackRange(harvester, ctx.roster.grid)) return 'hostile';
    return null;
  }

  private award(channel: Channel, level: number): void {
    const harvester = channel.harvester;
    const resource = resourceForHarvestKind(channel.kind);
    if (!harvester.inventory.hasRoomFor(resource)) {
      this.end('bagFull');
      return;
    }
    const toolKind = toolForHarvestKind(channel.kind);
    const efficiency = this.deps.partyTools.efficiency(toolKind);
    const carries = this.carryOf(harvester.crawlerKind);
    const { amount, carry } = harvestAward(efficiency, carries[channel.kind], level);
    carries[channel.kind] = carry;

    const spent = this.deps.ledger.spend(channel.tileX, channel.tileY, level);
    if (!spent) {
      this.end('depleted');
      return;
    }
    grantResource(harvester, resource, amount);
    harvester.queueFloatingText(`+${amount} ${ITEM_DEF[resource].name}`, 'buff');
    this.deps.bus?.emit('resourceHarvested', {
      id: resource,
      amount,
      byThrall: false,
      x: channel.tileX,
      y: channel.tileY,
    });
    harvester.craftSkills.addXp('resourcing', harvestXp(efficiency));
    this.rollLuck(harvester, channel.kind, level);

    if (harvestKindAt(this.deps.gameMap, channel.tileX, channel.tileY) !== channel.kind) {
      this.end('depleted');
    }
  }

  private rollLuck(harvester: Crawler, kind: HarvestKind, level: number): void {
    const drop = rollHarvestLuck(level, kind, this.deps.luckRng);
    if (drop === null || !harvester.inventory.hasRoomFor(drop)) return;
    grantResource(harvester, drop, 1);
    harvester.queueFloatingText(`+1 ${ITEM_DEF[drop].name}`, 'trigger');
    const isKit = drop === 'trebuchet_kit' || drop === 'snare_kit';
    this.deps.audio?.play(isKit ? 'found_trap_woodchopping' : 'lucky_refined');
  }

  private carryOf(crawler: CrawlerKind): Record<HarvestKind, number> {
    const known = this.carry.get(crawler);
    if (known !== undefined) return known;
    const fresh: Record<HarvestKind, number> = { wood: 0, stone: 0 };
    this.carry.set(crawler, fresh);
    return fresh;
  }

  private tierOf(kind: ToolKind): ToolTier | null {
    return kind === 'axe' ? this.deps.tools.axeTier : this.deps.tools.pickaxeTier;
  }

  /**
   * The node in reach the crawler faces most squarely, or the nearest when
   * none is squarely ahead.
   */
  private nodeInReach(
    crawler: Crawler,
  ): { readonly kind: HarvestKind; readonly tileX: number; readonly tileY: number } | null {
    const centreX = crawler.x + TILE_SIZE / 2;
    const centreY = crawler.y + TILE_SIZE / 2;
    const originTileX = Math.floor(centreX / TILE_SIZE);
    const originTileY = Math.floor(centreY / TILE_SIZE);
    const searchTiles = Math.ceil(HARVEST_REACH_TILES);

    let faced: { kind: HarvestKind; tileX: number; tileY: number; dot: number } | null = null;
    let nearest: { kind: HarvestKind; tileX: number; tileY: number; distance: number } | null =
      null;
    for (let tileY = originTileY - searchTiles; tileY <= originTileY + searchTiles; tileY++) {
      for (let tileX = originTileX - searchTiles; tileX <= originTileX + searchTiles; tileX++) {
        const kind = harvestKindAt(this.deps.gameMap, tileX, tileY);
        if (kind === null) continue;
        const dx = (tileX + TILE_CENTER_OFFSET) * TILE_SIZE - centreX;
        const dy = (tileY + TILE_CENTER_OFFSET) * TILE_SIZE - centreY;
        const distance = Math.hypot(dx, dy);
        if (distance > HARVEST_REACH_PX) continue;
        if (nearest === null || distance < nearest.distance) {
          nearest = { kind, tileX, tileY, distance };
        }
        if (distance === 0) continue;
        const dot = (dx / distance) * crawler.facingX + (dy / distance) * crawler.facingY;
        if (dot >= FACING_PREFERENCE_DOT && (faced === null || dot > faced.dot)) {
          faced = { kind, tileX, tileY, dot };
        }
      }
    }
    return faced ?? nearest;
  }

  // ── The picture ──────────────────────────────────────────────────────────

  private showWorking(channel: Channel): void {
    const tool = { kind: toolForHarvestKind(channel.kind), tier: this.tierOrBasic(channel.kind) };
    channel.harvester.setWorkingTool(tool);
    if (channel.harvester instanceof HumanPlayer) this.playSwingRow(channel, channel.harvester);
  }

  private hideWorking(channel: Channel): void {
    channel.harvester.setWorkingTool(null);
    if (channel.animating && channel.harvester instanceof HumanPlayer) {
      channel.animating = false;
      channel.harvester.stopAction();
    }
  }

  private tierOrBasic(kind: HarvestKind): ToolTier {
    return this.tierOf(toolForHarvestKind(kind)) ?? 0;
  }

  /**
   * Carl's swing loops until the channel ends. A swing the animator refuses —
   * he is mid-flinch — is asked for again next tick rather than dropped, so
   * the picture catches back up with the work.
   */
  private keepSwinging(channel: Channel): void {
    const harvester = channel.harvester;
    if (harvester instanceof HumanPlayer) {
      if (!channel.animating) this.playSwingRow(channel, harvester);
      return;
    }
    channel.catSwingTicks += 1;
    if (channel.catSwingTicks < CAT_WORK_SWING_TICKS) return;
    channel.catSwingTicks = 0;
    harvester.playWorkSwing();
    this.strikeFeedback(channel);
  }

  private playSwingRow(channel: Channel, human: HumanPlayer): void {
    const rows = channel.kind === 'wood' ? CHOP_ROWS : MINE_ROWS;
    const row = rows[viewForFacing(human.facingX, human.facingY)];
    const impacts = humanRowOf(row)?.eventFrames?.impact ?? [];
    channel.animating = human.playAction(row, {
      loop: true,
      faceX: human.facingX,
      faceY: human.facingY,
      onFrame: impacts.map((frame) => ({
        frame,
        run: (): void => {
          if (this.channel === channel) this.strikeFeedback(channel);
        },
      })),
      onEnd: () => {
        channel.animating = false;
      },
    });
  }

  private strikeFeedback(channel: Channel): void {
    this.deps.effects.strike(channel.kind, channel.tileX, channel.tileY);
    const jitter = (spread: number): number => 1 + (Math.random() * 2 - 1) * spread;
    this.deps.audio?.play(channel.kind === 'wood' ? 'axe_striking_wood' : 'pickaxe_strike_stone', {
      playbackRate: jitter(STRIKE_PITCH_JITTER),
      volume: STRIKE_BASE_VOLUME * jitter(STRIKE_VOLUME_JITTER),
    });
    if (channel.kind === 'wood') this.deps.onTreeStruck(channel.tileX, channel.tileY);
  }
}

/** Puts `amount` of `id` in the crawler's own bag and counts it toward this session's tally. */
export function grantResource(recipient: Crawler, id: ItemId, amount: number): void {
  recipient.inventory.addItem(id, amount);
  addToSessionTally(id, amount);
}
