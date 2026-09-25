/**
 * Thralls: ghostly ratkin laborers a crawler at Resourcing 10 or better can
 * summon from their axe or pickaxe, to work the trees or rocks nearby on
 * their behalf for a while.
 *
 * A thrall is not a `Mob`. It has no health, deals no damage, is in no roster
 * and no target list, and walks through walls — it is a ghost — so nothing in
 * a fight can see it and it can never block a corridor. It works on the same
 * interval and the same award function as its summoner, with its summoner's
 * perks, but it never rolls luck; what it gathers goes into the summoner's
 * bag, and the summoner earns a quarter of the XP.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { ITEM_DEF } from '../../core/ItemDefs';
import { type HarvestKind, thrallCount } from '../../core/craftPerks';
import type { PartyTools } from '../../core/PartyTools';
import type { ToolKind, ToolTier } from '../../core/toolTiers';
import {
  harvestAward,
  harvestIntervalTicks,
  harvestKindForTool,
  resourceForHarvestKind,
  thrallHarvestXp,
} from '../../core/harvestYield';
import {
  startThrallCooldown,
  thrallCooldownTicksLeft,
  tickThrallCooldowns,
} from '../../core/thrallCooldowns';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GameMap } from '../../map/GameMap';
import { drawThrall, type ThrallLook } from '../../sprites/thrallSprite';
import { THRALL_WORK_FRAMES, thrallFigure } from '../../sprites/art/thrallFigure';
import { figureFrameCount } from '../../sprites/figure/figureDef';
import { HAMMER_STRIKE_PHASE } from '../../sprites/art/ratkin/castRows';
import { tileKey } from '../tileKey';
import { drawText, TEXT_PRESETS } from '../../ui/TextBox';
import { HARVEST_BUFF_COLOR, type HarvestEffects } from './HarvestEffects';
import type { HarvestAudio } from './HarvestSystem';
import { grantResource } from './HarvestSystem';
import type { NodeLedger } from './NodeLedger';
import { harvestKindAt } from './harvestNodes';

type Crawler = HumanPlayer | CatPlayer;

const TICKS_PER_SECOND = 60;
/** How long a thrall works before it fades away. */
export const THRALL_LIFETIME_SECONDS = 45;
const THRALL_LIFETIME_TICKS = THRALL_LIFETIME_SECONDS * TICKS_PER_SECOND;
/** How far from where they were summoned thralls look for work, in tiles. */
export const THRALL_SEARCH_RADIUS_TILES = 12;
/** How fast a thrall glides to its node, px per tick: a little under a walking crawler. */
export const THRALL_GLIDE_SPEED = 1.6;
/** Fade-in on summon and fade-out on expiry. */
const THRALL_FADE_IN_TICKS = 30;
const THRALL_FADE_OUT_TICKS = 60;
/**
 * Where a thrall stands to work: this far from its node's centre, on the side
 * it arrived from — beside the trunk, not inside it.
 */
const WORK_STAND_OFF_TILES = 0.8;
/** Close enough to its stand point to count as arrived, px. */
const ARRIVAL_TOLERANCE_PX = 1;
/** The float: a slow vertical bob, px and ticks per cycle. */
const BOB_AMPLITUDE_PX = 2;
const BOB_PERIOD_TICKS = 90;
/**
 * The thrall's work loop: the figure's own overhead swing, one frame every
 * few ticks, with the strike's feedback on the frame the blade comes down.
 */
const WORK_TICKS_PER_FRAME = 6;
const SWING_PERIOD_TICKS = THRALL_WORK_FRAMES * WORK_TICKS_PER_FRAME;
const SWING_IMPACT_TICK =
  Math.round(HAMMER_STRIKE_PHASE * THRALL_WORK_FRAMES) * WORK_TICKS_PER_FRAME;
/** A thrall's strike is quieter than a crawler's: it is a helper at the edge of hearing. */
const THRALL_STRIKE_VOLUME = 0.45;
/** How fast the idle and walk rows play while it floats to its work. */
const DRIFT_TICKS_PER_FRAME = 6;
/** The "…" over a thrall with nowhere to put what it gathers. */
const BAG_FULL_BUBBLE = '…';
const BUBBLE_RAISE_TILES = 1.05;
const BUBBLE_COLOR = '#e2e8f0';

const TILE_CENTER_OFFSET = 0.5;
const FULL_TURN = Math.PI * 2;

interface NodeRef {
  readonly tileX: number;
  readonly tileY: number;
}

interface Thrall {
  readonly summoner: Crawler;
  readonly tool: ToolKind;
  readonly kind: HarvestKind;
  /** Centre of where it was summoned, px; later nodes are searched for from here. */
  readonly homeX: number;
  readonly homeY: number;
  /** Tile top-left, px, like a crawler's position. */
  x: number;
  y: number;
  node: NodeRef | null;
  ageTicks: number;
  /** Ticks into its fade-out, or null while it is still working. */
  fadeTicks: number | null;
  harvestTicks: number;
  carry: number;
  bagFull: boolean;
  swingTicks: number;
  /** The way it last moved, for the wisp trail and which way it faces. */
  moveX: number;
  moveY: number;
  facingX: number;
  facingY: number;
}

/** One thrall as the outside world may see it. */
export interface ThrallView {
  /** Tile top-left, px. */
  readonly x: number;
  readonly y: number;
  readonly node: NodeRef | null;
  readonly fading: boolean;
  readonly bagFull: boolean;
}

/** How a summon went, for the menu that asked for it. */
export type SummonResult = 'summoned' | 'nothingNearby' | 'coolingDown' | 'notUnlocked';

export interface ThrallSystemDeps {
  readonly gameMap: GameMap;
  readonly ledger: NodeLedger;
  readonly partyTools: PartyTools;
  readonly tierOf: (tool: ToolKind) => ToolTier | null;
  readonly effects: HarvestEffects;
  readonly bus: EventBus | null;
  readonly audio: HarvestAudio | null;
  readonly announce: (message: string) => void;
  readonly noteActivity: () => void;
  readonly onTreeStruck: (tileX: number, tileY: number) => void;
}

export class ThrallSystem {
  private readonly thralls: Thrall[] = [];

  constructor(private readonly deps: ThrallSystemDeps) {}

  /**
   * Whether any thrall is still working, for the HUD's timer pill. A thrall
   * in its fade-out has no time left to show, and counting it would put up a
   * pill reading "0s" for the length of the fade.
   */
  get anyWorking(): boolean {
    return this.thralls.some((thrall) => thrall.fadeTicks === null);
  }

  /** Seconds the longest-lived working thrall has left, for the HUD's timer pill. */
  get secondsLeft(): number {
    let most = 0;
    for (const thrall of this.thralls) {
      if (thrall.fadeTicks !== null) continue;
      most = Math.max(most, THRALL_LIFETIME_TICKS - thrall.ageTicks);
    }
    return Math.ceil(most / TICKS_PER_SECOND);
  }

  /** Where each thrall is and what it is doing, for headless verification. */
  get snapshot(): ReadonlyArray<ThrallView> {
    return this.thralls.map((thrall) => ({
      x: thrall.x,
      y: thrall.y,
      node: thrall.node,
      fading: thrall.fadeTicks !== null,
      bagFull: thrall.bagFull,
    }));
  }

  /** Whether `crawler` may be offered the summon at all: the unlock is theirs alone. */
  canSummon(crawler: Crawler): boolean {
    return thrallCount(crawler.craftSkills.getLevel('resourcing')) > 0;
  }

  /**
   * Summons `thrallCount` thralls for `summoner` to work the `tool`'s kind of
   * node nearby. Nothing in reach costs nothing: no thrall and no cooldown.
   */
  trySummon(summoner: Crawler, tool: ToolKind): SummonResult {
    const count = thrallCount(summoner.craftSkills.getLevel('resourcing'));
    if (count === 0) return 'notUnlocked';
    if (thrallCooldownTicksLeft(summoner.crawlerKind) > 0) return 'coolingDown';
    if (this.deps.tierOf(tool) === null) return 'notUnlocked';

    const kind = harvestKindForTool(tool);
    const homeX = summoner.x + TILE_SIZE / 2;
    const homeY = summoner.y + TILE_SIZE / 2;
    const nodes = this.nodesNear(
      kind,
      homeX,
      homeY,
      true,
      summoner.craftSkills.getLevel('resourcing'),
    );
    if (nodes.length === 0) {
      this.deps.announce("There's nothing here to collect.");
      return 'nothingNearby';
    }

    for (let i = 0; i < count; i++) {
      const unclaimed = nodes.find((node) => !this.isClaimed(node));
      const node = unclaimed ?? nodes[i % nodes.length];
      this.thralls.push({
        summoner,
        tool,
        kind,
        homeX,
        homeY,
        x: summoner.x,
        y: summoner.y,
        node,
        ageTicks: 0,
        fadeTicks: null,
        harvestTicks: 0,
        carry: 0,
        bagFull: false,
        swingTicks: 0,
        moveX: 0,
        moveY: 0,
        facingX: summoner.facingX,
        facingY: summoner.facingY,
      });
    }
    startThrallCooldown(summoner.crawlerKind);
    this.deps.audio?.play('thrall_summoned');
    return 'summoned';
  }

  /** Advances every thrall and every cooldown one fixed tick. */
  update(): void {
    tickThrallCooldowns();
    for (let i = this.thralls.length - 1; i >= 0; i--) {
      const thrall = this.thralls[i];
      if (this.tick(thrall)) this.thralls.splice(i, 1);
    }
    if (this.thralls.length > 0) this.deps.noteActivity();
  }

  /** Every thrall gone at once, for a scene teardown: they belong to the place they were summoned. */
  dismissAll(): void {
    this.thralls.length = 0;
  }

  /** @returns true once the thrall has faded out and should be dropped. */
  private tick(thrall: Thrall): boolean {
    thrall.ageTicks += 1;
    if (thrall.fadeTicks !== null) {
      thrall.fadeTicks += 1;
      return thrall.fadeTicks >= THRALL_FADE_OUT_TICKS;
    }
    if (thrall.ageTicks >= THRALL_LIFETIME_TICKS) {
      this.beginFade(thrall);
      return false;
    }
    if (thrall.node === null || !this.stillWorkable(thrall, thrall.node)) {
      thrall.node = this.nextNode(thrall);
      if (thrall.node === null) {
        this.beginFade(thrall);
        return false;
      }
    }
    const node = thrall.node;
    if (!this.glideToward(thrall, node)) return false;
    this.work(thrall, node);
    return false;
  }

  private beginFade(thrall: Thrall): void {
    thrall.fadeTicks = 0;
    thrall.node = null;
    this.deps.audio?.play('thrall_fade_out');
  }

  private stillWorkable(thrall: Thrall, node: NodeRef): boolean {
    return harvestKindAt(this.deps.gameMap, node.tileX, node.tileY) === thrall.kind;
  }

  private nextNode(thrall: Thrall): NodeRef | null {
    const nodes = this.nodesNear(
      thrall.kind,
      thrall.homeX,
      thrall.homeY,
      false,
      thrall.summoner.craftSkills.getLevel('resourcing'),
    );
    const centreX = thrall.x + TILE_SIZE / 2;
    const centreY = thrall.y + TILE_SIZE / 2;
    const byDistanceFromThrall = [...nodes].sort(
      (a, b) => nodeDistance(a, centreX, centreY) - nodeDistance(b, centreX, centreY),
    );
    return byDistanceFromThrall.find((node) => !this.isClaimed(node, thrall)) ?? null;
  }

  /** @returns true once it stands at its work. */
  private glideToward(thrall: Thrall, node: NodeRef): boolean {
    const nodeX = (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE;
    const nodeY = (node.tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
    const fromX = thrall.x + TILE_SIZE / 2 - nodeX;
    const fromY = thrall.y + TILE_SIZE / 2 - nodeY;
    const fromLength = Math.hypot(fromX, fromY);
    const sideX = fromLength > 0 ? fromX / fromLength : 0;
    const sideY = fromLength > 0 ? fromY / fromLength : 1;
    const standX = nodeX + sideX * WORK_STAND_OFF_TILES * TILE_SIZE - TILE_SIZE / 2;
    const standY = nodeY + sideY * WORK_STAND_OFF_TILES * TILE_SIZE - TILE_SIZE / 2;
    const dx = standX - thrall.x;
    const dy = standY - thrall.y;
    const distance = Math.hypot(dx, dy);
    thrall.facingX = -sideX;
    thrall.facingY = -sideY;
    if (distance <= ARRIVAL_TOLERANCE_PX) {
      thrall.moveX = 0;
      thrall.moveY = 0;
      return true;
    }
    const step = Math.min(THRALL_GLIDE_SPEED, distance);
    thrall.moveX = (dx / distance) * step;
    thrall.moveY = (dy / distance) * step;
    thrall.x += thrall.moveX;
    thrall.y += thrall.moveY;
    thrall.facingX = dx / distance;
    thrall.facingY = dy / distance;
    return false;
  }

  private work(thrall: Thrall, node: NodeRef): void {
    thrall.swingTicks = (thrall.swingTicks + 1) % SWING_PERIOD_TICKS;
    if (thrall.swingTicks === SWING_IMPACT_TICK) {
      this.strike(thrall, node);
    }

    const summoner = thrall.summoner;
    const level = summoner.craftSkills.getLevel('resourcing');
    const resource = resourceForHarvestKind(thrall.kind);
    thrall.bagFull = !summoner.inventory.hasRoomFor(resource);
    if (thrall.bagFull) return;

    thrall.harvestTicks += 1;
    const interval = harvestIntervalTicks(thrall.kind, level);
    if (thrall.harvestTicks < interval) return;
    thrall.harvestTicks -= interval;

    const efficiency = this.deps.partyTools.efficiency(thrall.tool);
    const { amount, carry } = harvestAward(efficiency, thrall.carry, level);
    thrall.carry = carry;
    if (!this.deps.ledger.spend(node.tileX, node.tileY, level)) {
      thrall.node = null;
      return;
    }
    grantResource(summoner, resource, amount);
    summoner.craftSkills.addXp('resourcing', thrallHarvestXp(efficiency));
    this.deps.bus?.emit('resourceHarvested', {
      id: resource,
      amount,
      byThrall: true,
      x: node.tileX,
      y: node.tileY,
    });
    this.deps.effects.pop(
      `+${amount} ${ITEM_DEF[resource].name}`,
      HARVEST_BUFF_COLOR,
      thrall.x + TILE_SIZE / 2,
      thrall.y,
    );
  }

  private strike(thrall: Thrall, node: NodeRef): void {
    this.deps.effects.strike(thrall.kind, node.tileX, node.tileY);
    this.deps.audio?.play(thrall.kind === 'wood' ? 'axe_striking_wood' : 'pickaxe_strike_stone', {
      volume: THRALL_STRIKE_VOLUME,
    });
    if (thrall.kind === 'wood') this.deps.onTreeStruck(node.tileX, node.tileY);
  }

  /**
   * Nodes of `kind` within the search radius of a point, nearest first.
   * `needsSight` is for the summon itself: a crawler summons onto what they
   * can see. Later searches from the summon point are not held to it, since
   * the thrall is already out and walks through walls.
   */
  private nodesNear(
    kind: HarvestKind,
    originX: number,
    originY: number,
    needsSight: boolean,
    harvesterLevel: number,
  ): NodeRef[] {
    const radiusPx = THRALL_SEARCH_RADIUS_TILES * TILE_SIZE;
    const originTileX = Math.floor(originX / TILE_SIZE);
    const originTileY = Math.floor(originY / TILE_SIZE);
    const found: NodeRef[] = [];
    for (let dy = -THRALL_SEARCH_RADIUS_TILES; dy <= THRALL_SEARCH_RADIUS_TILES; dy++) {
      for (let dx = -THRALL_SEARCH_RADIUS_TILES; dx <= THRALL_SEARCH_RADIUS_TILES; dx++) {
        const tileX = originTileX + dx;
        const tileY = originTileY + dy;
        if (harvestKindAt(this.deps.gameMap, tileX, tileY) !== kind) continue;
        const node = { tileX, tileY };
        if (nodeDistance(node, originX, originY) > radiusPx) continue;
        if (needsSight && !this.canSee(originX, originY, node)) continue;
        if (this.deps.ledger.stateAt(tileX, tileY, harvesterLevel) === null) continue;
        found.push(node);
      }
    }
    return found.sort(
      (a, b) => nodeDistance(a, originX, originY) - nodeDistance(b, originX, originY),
    );
  }

  private canSee(originX: number, originY: number, node: NodeRef): boolean {
    const centreX = (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE;
    const centreY = (node.tileY + TILE_CENTER_OFFSET) * TILE_SIZE;
    return this.deps.gameMap.hasLineOfSight(originX, originY, centreX, centreY, node);
  }

  private isClaimed(node: NodeRef, except?: Thrall): boolean {
    const key = tileKey(node.tileX, node.tileY);
    return this.thralls.some(
      (thrall) =>
        thrall !== except &&
        thrall.node !== null &&
        tileKey(thrall.node.tileX, thrall.node.tileY) === key,
    );
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** Every thrall, Y-sorted with the scene's bodies. */
  renderables(): ReadonlyArray<{
    x: number;
    y: number;
    render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
  }> {
    return this.thralls.map((thrall) => ({
      x: thrall.x,
      y: thrall.y,
      render: (ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) =>
        this.renderThrall(ctx, thrall, camX, camY, tileSize),
    }));
  }

  private renderThrall(
    ctx: CanvasRenderingContext2D,
    thrall: Thrall,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const bob = Math.sin((thrall.ageTicks / BOB_PERIOD_TICKS) * FULL_TURN) * BOB_AMPLITUDE_PX;
    const sx = thrall.x - camX;
    const sy = thrall.y - camY - BOB_AMPLITUDE_PX + bob;
    const presence = presenceOf(thrall);
    drawThrall(ctx, thrallLook(thrall, presence), sx, sy, tileSize);

    if (thrall.bagFull && thrall.fadeTicks === null) {
      drawText(ctx, BAG_FULL_BUBBLE, {
        x: sx + tileSize / 2,
        y: sy - (BUBBLE_RAISE_TILES - 1) * tileSize,
        ...TEXT_PRESETS.label,
        color: BUBBLE_COLOR,
        bold: true,
        align: 'center',
        alpha: presence,
      });
    }
  }
}

function nodeDistance(node: NodeRef, x: number, y: number): number {
  return Math.hypot(
    (node.tileX + TILE_CENTER_OFFSET) * TILE_SIZE - x,
    (node.tileY + TILE_CENTER_OFFSET) * TILE_SIZE - y,
  );
}

function presenceOf(thrall: Thrall): number {
  const fadeIn = Math.min(1, thrall.ageTicks / THRALL_FADE_IN_TICKS);
  const fadeOut = thrall.fadeTicks === null ? 1 : 1 - thrall.fadeTicks / THRALL_FADE_OUT_TICKS;
  return Math.max(0, fadeIn * fadeOut);
}

/** Whether it stands at its node swinging, rather than floating to one or fading. */
function isWorking(thrall: Thrall): boolean {
  const moving = thrall.moveX !== 0 || thrall.moveY !== 0;
  return thrall.node !== null && !moving && thrall.fadeTicks === null && !thrall.bagFull;
}

function thrallLook(thrall: Thrall, presence: number): ThrallLook {
  const moving = thrall.moveX !== 0 || thrall.moveY !== 0;
  const sideways = Math.abs(thrall.facingX) >= Math.abs(thrall.facingY);
  const facesAway = !sideways && thrall.facingY < 0;
  const common = { tool: thrall.tool, presence, trailX: thrall.moveX, trailY: thrall.moveY };
  if (isWorking(thrall)) {
    // The work loop exists head-on and in profile only; work up the screen is
    // shown in profile, the blade still swinging toward the node's side.
    const profile = sideways || facesAway;
    return {
      ...common,
      state: profile ? 'work_side' : 'work',
      frame: Math.floor(thrall.swingTicks / WORK_TICKS_PER_FRAME),
      flipX: profile && thrall.facingX < 0,
    };
  }
  const drift = Math.floor(thrall.ageTicks / DRIFT_TICKS_PER_FRAME);
  let state: ThrallLook['state'];
  if (sideways) state = moving ? 'walk_side' : 'idle_side';
  else if (facesAway) state = moving ? 'walk_away' : 'idle_away';
  else state = moving ? 'walk' : 'idle';
  const rowFrames = Math.max(1, figureFrameCount(thrallFigure(thrall.tool), state));
  return {
    ...common,
    state,
    frame: drift % rowFrames,
    flipX: sideways && thrall.facingX < 0,
  };
}
