/**
 * Chopping and mining: a crawler works the tree or rock in front of them with
 * the party's axe or pickaxe, and resources land in their own bag.
 *
 * One press starts a channel that carries on without the key held, the way a
 * lumberjack keeps swinging, until the crawler moves, fights, gets hurt, fills
 * their bag, or works the node out. Awards come on a fixed interval counted in
 * update ticks — never off the swing animation, so the rate cannot depend on
 * how the swing is drawn, and never off wall time, so a frame that runs two
 * updates cannot skip one.
 *
 * A modal that halts the world — a level-up ceremony, a reward dialog —
 * freezes the channel rather than ending it: no ticks, no swing, and the
 * picture is already frozen because the halted world never advances the
 * crawler's own animation. It resumes exactly where it left off once the
 * modal closes, unless the node it was working ran out from under it in the
 * meantime (a thrall on the same node still ticks through the modal). Only
 * the pause menu and a real interruption — moving, fighting, taking a hit —
 * end a channel outright.
 *
 * A channel outlives a character switch: the harvester keeps swinging as the
 * companion, and `CompanionSystem` is what cuts it short — when the leash
 * needs the companion's feet back, or a target hands its combat reaction the
 * wheel — rather than this system reacting to who is currently controlled.
 *
 * Both crawlers can run a channel at once, on the same node or different
 * ones — one channel per harvester, keyed by the crawler themselves, so
 * starting or ending one never touches the other's. Two channels on the same
 * node each spend it independently through the shared `NodeLedger`, so it
 * empties at their combined rate without either one double-counting a swing.
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
  /** One channel per harvester — starting or ending a crawler's own never reaches the other's. */
  private readonly channels = new Map<Crawler, Channel>();
  /**
   * Fractional yield carried between ticks, per crawler and per node kind: a
   * 1.5× axe alternates 1 and 2 across trees rather than losing the half each
   * time a tree falls. Skills are never shared, so neither is the carry.
   */
  private readonly carry = new Map<CrawlerKind, Record<HarvestKind, number>>();

  constructor(private readonly deps: HarvestSystemDeps) {}

  /**
   * Every node currently being worked, for the progress arc and the HUD —
   * de-duplicated by tile, so two crawlers on the same node draw one ring
   * rather than two stacked on top of each other.
   */
  get workedNodes(): ReadonlyArray<{ readonly tileX: number; readonly tileY: number }> {
    const seen = new Set<string>();
    const nodes: Array<{ tileX: number; tileY: number }> = [];
    for (const channel of this.channels.values()) {
      const key = `${channel.tileX},${channel.tileY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ tileX: channel.tileX, tileY: channel.tileY });
    }
    return nodes;
  }

  /** Whether `crawler` is mid-channel. */
  isHarvesting(crawler: Crawler): boolean {
    return this.channels.has(crawler);
  }

  /** The node `crawler` is currently working, or null when they aren't harvesting — a thrall's fallback target. */
  nodeFor(crawler: Crawler): { readonly tileX: number; readonly tileY: number } | null {
    const channel = this.channels.get(crawler);
    return channel === undefined ? null : { tileX: channel.tileX, tileY: channel.tileY };
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

    const running = this.channels.get(active);
    if (running?.tileX === node.tileX && running.tileY === node.tileY) {
      return true;
    }
    // Only this crawler's own channel, if any — never the other one's, so a
    // crawler starting a fresh harvest can never cancel a companion working
    // elsewhere.
    this.stop(active);
    const level = active.craftSkills.getLevel('resourcing');
    if (this.deps.ledger.stateAt(node.tileX, node.tileY, level) === null) return false;

    const faceX = (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - (active.x + TILE_SIZE / 2);
    const faceY = (node.tileY + TILE_CENTER_OFFSET) * TILE_SIZE - (active.y + TILE_SIZE / 2);
    const faceLength = Math.hypot(faceX, faceY);
    if (faceLength > 0) {
      active.facingX = faceX / faceLength;
      active.facingY = faceY / faceLength;
    }

    const channel: Channel = {
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
    this.channels.set(active, channel);
    this.deps.ledger.claim(node.tileX, node.tileY, channel);
    this.showWorking(channel);
    this.deps.noteActivity();
    return true;
  }

  /**
   * Advances every running channel one fixed tick. `menuOpen` is whether any
   * overlay owns the screen: a channel behind it pauses — no ticks, no swing
   * — rather than ending, so dismissing the modal picks the swing straight
   * back up. It still has to notice a node depleted out from under it while
   * paused (a thrall on the same node keeps ticking through the modal), so
   * that check runs even while frozen.
   */
  update(ctx: SystemContext, menuOpen: boolean): void {
    if (this.channels.size === 0) return;
    // Copied first: ending a channel mid-loop (depletion, a hit, ...) must
    // not skip or re-visit another crawler's entry in the live map.
    for (const channel of [...this.channels.values()]) {
      if (menuOpen) {
        if (harvestKindAt(this.deps.gameMap, channel.tileX, channel.tileY) !== channel.kind) {
          this.end(channel, 'depleted');
        }
        continue;
      }
      const ended = this.interruption(channel, ctx);
      if (ended !== null) {
        this.end(channel, ended);
        continue;
      }
      this.deps.noteActivity();
      this.keepSwinging(channel);

      const level = channel.harvester.craftSkills.getLevel('resourcing');
      channel.ticks += 1;
      const interval = harvestIntervalTicks(channel.kind, level);
      if (channel.ticks < interval) continue;
      channel.ticks -= interval;
      this.award(channel, level);
    }
  }

  /** Ends `crawler`'s channel quietly, if it has one, leaving any other harvester's untouched. */
  stop(crawler: Crawler): void {
    const channel = this.channels.get(crawler);
    if (channel === undefined) return;
    this.channels.delete(crawler);
    this.deps.ledger.releaseClaim(channel);
    this.hideWorking(channel);
  }

  /** Ends every channel at once, for a scene teardown, the pause menu or a checkpoint restore. */
  stopAll(): void {
    for (const harvester of [...this.channels.keys()]) this.stop(harvester);
  }

  private end(channel: Channel, reason: ChannelEnd): void {
    if (reason === 'bagFull') {
      this.deps.announce('Your bag is full.');
      this.deps.audio?.play('error');
    }
    this.stop(channel.harvester);
  }

  private interruption(channel: Channel, ctx: SystemContext): ChannelEnd | null {
    const harvester = channel.harvester;
    // Deliberately not gated on `ctx.active === harvester`: a channel started
    // by the controlled crawler must survive a switch to the other one, so
    // the harvester who becomes the companion keeps working the same node.
    // `CompanionSystem` is what ends it early when the leash or a fight needs
    // that crawler's feet back.
    if (!harvester.isAlive) return 'interrupted';
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
      this.end(channel, 'bagFull');
      return;
    }
    const toolKind = toolForHarvestKind(channel.kind);
    const efficiency = this.deps.partyTools.efficiency(toolKind);
    const carries = this.carryOf(harvester.crawlerKind);
    const { amount, carry } = harvestAward(efficiency, carries[channel.kind], level);
    carries[channel.kind] = carry;

    const spent = this.deps.ledger.spend(channel.tileX, channel.tileY, level);
    if (!spent) {
      this.end(channel, 'depleted');
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
      this.end(channel, 'depleted');
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
          if (this.channels.get(channel.harvester) === channel) this.strikeFeedback(channel);
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
