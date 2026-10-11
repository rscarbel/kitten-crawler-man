/**
 * The prison's prize and the visit around it: the key floating over its
 * pedestal in the vault, lifting it, the guidance that points the way to it
 * and back out, and the first-visit explainer.
 *
 * Whether the key is on the pedestal is never stored. It is there exactly
 * when neither crawler carries it and the gate outside is still shut, so a
 * key pushed out of the quest slot by another quest item is back on its
 * pedestal the same frame, and the puzzle's phase outside, which also follows
 * the inventories, agrees without being told.
 *
 * A party caught with the key keeps it and wakes in a cell far from the door,
 * so from then until it leaves the exit is framed and the world arrow points
 * at it.
 *
 * The only way out is the exit tiles beside the entrance. Recall and travel
 * are refused in every interior (`refuseAnchorIndoors`), so a party holding
 * the key cannot skip the walk back, and one without it cannot skip the walk in.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { ItemId } from '../../core/ItemDefs';
import { drawAreaHighlight } from '../../ui/AreaHighlight';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import type { PrisonPlan, PrisonTile } from '../../map/goblinPrisonPlan';
import { prisonSectionAt } from '../../map/goblinPrisonPlan';
import type { PrisonSectionId } from '../../map/goblinPrisonLayouts';
import type { Player } from '../../Player';
import {
  KEY_PEDESTAL_WIDTH_TILES,
  PRISON_KEY_CENTRE_ABOVE_BASE_TILES,
  drawKeyPedestal,
  drawPrisonKey,
  prisonKeyPulse,
} from '../../sprites/art/prisonKeyArt';
import { drawQuestBeacon, setQuestBeaconViewer } from '../../sprites/questBeacon';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { objectiveBandEntry } from '../../ui/hud/objectiveLine';
import type { ToastOptions } from '../../ui/hud/toasts';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import {
  prisonExplainerSurface,
  type PrisonExplainerModel,
} from '../../ui/screens/dialogs/prisonExplainer';
import { worldPalette } from '../../ui/theme/worldInk';
import { drawArrowAbovePlayer, ARROW_PRIORITY, type ArrowCandidate } from '../../ui/WorldArrow';
import { worldText } from '../../ui/world/worldText';
import type { TownPropRenderable } from '../townPropRenderable';
import { playPrisonCue } from './prisonSoundCues';
import {
  PRISON_KEY_ITEM,
  partyHoldsPrisonKey,
  type StealthKeySnatchVisit,
} from './stealthKeySnatchVisit';

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const TILE_CENTRE = 0.5;
/** Where in its tile the pedestal's base stands, so its shadow sits on the tile rather than the wall above. */
const PEDESTAL_BASE_IN_TILE = 0.85;
/** How far above the key's centre the "THE KEY" caption sits, in tiles. */
const LABEL_ABOVE_KEY_TILES = 1.35;
/** Chebyshev tiles from the pedestal within which Space lifts the key. */
const REACH_TILES = 1;
/** The key's pool of light while it is on the pedestal, in tiles, at the low and high of its pulse. */
const KEY_LIGHT_RADIUS_TILES = { min: 3.2, max: 4 } as const;
/** The empty pedestal's dim lamp, in tiles. */
const EMPTY_PEDESTAL_LIGHT_RADIUS_TILES = 1.2;
const KEY_LIGHT_STRENGTH = 1;
const EMPTY_PEDESTAL_LIGHT_STRENGTH = 0.35;
/** Closer than this the guidance arrow stands down: the key is right there. */
const ARROW_SUPPRESS_TILES = 5;
/** How far the pedestal figure's art reaches above its tile, for culling. */
const PEDESTAL_CULL_MARGIN_TILES = 4;

const PROMPT_LABEL = 'Take the key';
const OBJECTIVE_FIND = 'Find the key';
const OBJECTIVE_RETURN = 'Bring the key to the gate guard';
const TOAST_TAKE_OUT = 'Take the key to the gate guard.';
const TOAST_KEY_RETURNED = 'The key went back to its pedestal in the prison vault.';
const LABEL_TEXT = 'THE KEY';
const OBJECTIVE_BAND_ID = 'prison-objective';

/** A light the prison's darkness should cut a pool for, in world pixels. */
export interface PrisonLightPool {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** 0–1: how fully the pool clears the darkness at its centre. */
  readonly strength: number;
}

export interface PrisonKeyDeps {
  readonly plan: PrisonPlan;
  readonly human: Player;
  readonly cat: Player;
  readonly link: StealthKeySnatchVisit;
  readonly audio: Pick<AudioManager, 'play'> | null;
  readonly toast: (text: string, opts?: ToastOptions) => void;
  /** Flies one item from a world position to the HUD. */
  readonly flyItem: (id: ItemId, worldX: number, worldY: number) => void;
}

function tileOf(body: { readonly x: number; readonly y: number }): PrisonTile {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
  };
}

export class PrisonKeySystem implements PrisonExplainerModel {
  private ticks = 0;
  private explainerOpen = false;
  private lastLeaderSection: PrisonSectionId | null = null;
  private toldToTakeItOut = false;
  /**
   * Whether a crawler stood on the pedestal's front tile last tick. The key is
   * lifted by stepping on, not by standing there: a key that went back to the
   * pedestal under a crawler's feet stays put until they step off and on again.
   */
  private frontOccupied = false;
  /**
   * Whether the party held the key last tick. A quest item cannot be dropped
   * or sold, so the key leaving both inventories in here can only be another
   * quest item taking its slot.
   */
  private heldLastTick: boolean;
  /** Whether a capture has thrown the party in a cell with the key in hand on this visit. */
  private caughtWithKey = false;
  readonly pedestal: PrisonTile;
  readonly pedestalFront: PrisonTile;
  private readonly exitRect: Rect;

  constructor(private readonly deps: PrisonKeyDeps) {
    this.pedestal = deps.plan.parsed.pedestal;
    this.pedestalFront = deps.plan.parsed.pedestalFront;
    this.exitRect = PrisonKeySystem.exitWorldRect(deps.plan);
    this.heldLastTick = partyHoldsPrisonKey(deps);
  }

  /** Whether either crawler carries the key. */
  get partyHoldsKey(): boolean {
    return partyHoldsPrisonKey(this.deps);
  }

  /** Whether the key floats over its pedestal, waiting to be taken. */
  get keyOnPedestal(): boolean {
    return !this.gateOpened && !this.partyHoldsKey;
  }

  /** Whether the key was already handed over: the gate outside stands open. */
  private get gateOpened(): boolean {
    return this.deps.link.phase === 'opened';
  }

  /** Where the pedestal's base stands, in world pixels. */
  private pedestalBase(): { x: number; y: number } {
    return {
      x: (this.pedestal.x + TILE_CENTRE) * TILE_SIZE,
      y: (this.pedestal.y + PEDESTAL_BASE_IN_TILE) * TILE_SIZE,
    };
  }

  /** Where the floating key's centre is, in world pixels, at the middle of its bob. */
  keyCentre(): { x: number; y: number } {
    const base = this.pedestalBase();
    return { x: base.x, y: base.y - PRISON_KEY_CENTRE_ABOVE_BASE_TILES * TILE_SIZE };
  }

  private get seconds(): number {
    return this.ticks / FRAMES_PER_SECOND;
  }

  /** The section the tile lies in, or null between sections. */
  private sectionOf(body: { readonly x: number; readonly y: number }): PrisonSectionId | null {
    const tile = tileOf(body);
    return prisonSectionAt(this.deps.plan.parsed.layout, tile.x, tile.y);
  }

  /**
   * One tick of the visit: a crawler walking onto the pedestal's front tile
   * lifts the key, and the leader carrying it out of the vault is told where
   * it goes. `active` is the crawler the player drives.
   */
  update(active: Player): void {
    this.ticks++;
    const held = this.partyHoldsKey;
    if (this.heldLastTick && !held && !this.gateOpened) this.keyReturned();
    this.heldLastTick = held;
    const front = this.pedestalFront;
    const onFront = [active, this.otherOf(active)].find((crawler) => {
      const tile = tileOf(crawler);
      return tile.x === front.x && tile.y === front.y;
    });
    const steppedOn = onFront !== undefined && !this.frontOccupied;
    this.frontOccupied = onFront !== undefined;
    if (steppedOn && this.keyOnPedestal) this.lift(onFront);
    const section = this.sectionOf(active);
    if (section === null) return;
    const leftVault = this.lastLeaderSection === 'vault' && section !== 'vault';
    this.lastLeaderSection = section;
    if (leftVault && this.partyHoldsKey && !this.toldToTakeItOut) {
      this.toldToTakeItOut = true;
      this.deps.toast(TOAST_TAKE_OUT, { tone: 'info', icon: 'compass' });
    }
  }

  /**
   * Hears a capture once the party is in its cell. A capture without the key
   * leaves the walk to the pedestal as it was; one with it turns the guidance
   * round to the exit.
   */
  noteCapture(): void {
    if (this.partyHoldsKey && !this.gateOpened) this.caughtWithKey = true;
  }

  /** Whether the exit is framed and pointed at: caught with the key, and still holding it. */
  get guidesToExit(): boolean {
    return this.caughtWithKey && this.partyHoldsKey && !this.gateOpened;
  }

  /** The exit tiles' bounds, in world pixels. */
  private static exitWorldRect(plan: PrisonPlan): Rect {
    const { exits } = plan.parsed;
    const xs = exits.map((tile) => tile.x);
    const ys = exits.map((tile) => tile.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      x: left * TILE_SIZE,
      y: top * TILE_SIZE,
      w: (Math.max(...xs) - left + 1) * TILE_SIZE,
      h: (Math.max(...ys) - top + 1) * TILE_SIZE,
    };
  }

  private otherOf(crawler: Player): Player {
    return crawler === this.deps.human ? this.deps.cat : this.deps.human;
  }

  /** Whether a Space press from `crawler` would lift the key. */
  wouldInteract(crawler: Player): boolean {
    if (!this.keyOnPedestal) return false;
    const tile = tileOf(crawler);
    return (
      Math.abs(tile.x - this.pedestal.x) <= REACH_TILES &&
      Math.abs(tile.y - this.pedestal.y) <= REACH_TILES
    );
  }

  /** Lifts the key for a Space press beside the pedestal. Returns whether the press was taken. */
  tryInteract(crawler: Player): boolean {
    if (!this.wouldInteract(crawler)) return false;
    this.lift(crawler);
    return true;
  }

  private keyReturned(): void {
    this.toldToTakeItOut = false;
    this.deps.link.syncWithInventories(this.deps);
    this.deps.toast(TOAST_KEY_RETURNED, { tone: 'warning', icon: 'lock' });
  }

  private lift(crawler: Player): void {
    crawler.inventory.addItem(PRISON_KEY_ITEM, 1);
    this.deps.link.syncWithInventories(this.deps);
    this.heldLastTick = true;
    playPrisonCue(this.deps.audio, 'keyPickup');
    const centre = this.keyCentre();
    this.deps.flyItem(PRISON_KEY_ITEM, centre.x, centre.y);
  }

  /** The pedestal and the key over it, for the room's Y-sorted pass. */
  sortedFigure(): TownPropRenderable {
    return {
      x: this.pedestal.x * TILE_SIZE,
      y: this.pedestal.y * TILE_SIZE,
      cullMarginTiles: PEDESTAL_CULL_MARGIN_TILES,
      render: (ctx, camX, camY, tileSize) => this.renderPedestal(ctx, camX, camY, tileSize),
    };
  }

  private renderPedestal(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const lit = this.keyOnPedestal;
    if (lit) {
      drawQuestBeacon(
        ctx,
        this.pedestal.x * tileSize - camX,
        this.pedestal.y * tileSize - camY,
        tileSize,
        camX,
        camY,
        this.seconds * MS_PER_SECOND,
        worldPalette.objective.ready,
      );
    }
    const base = this.pedestalBase();
    drawKeyPedestal(ctx, base.x - camX, base.y - camY, lit, tileSize);
    if (!lit) return;
    const centre = this.keyCentre();
    drawPrisonKey(ctx, centre.x - camX, centre.y - camY, this.seconds, tileSize);
  }

  /**
   * What draws over the prison's darkness: the "THE KEY" caption and the
   * prompt beside the pedestal. `active` sets the beacon's nearness fade.
   */
  renderOverDarkness(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
  ): void {
    setQuestBeaconViewer(active.x, active.y);
    if (this.guidesToExit) {
      const exit = this.exitRect;
      drawAreaHighlight(
        ctx,
        { x: exit.x - camX, y: exit.y - camY, w: exit.w, h: exit.h },
        { color: worldPalette.objective.ready, nowMs: this.seconds * MS_PER_SECOND },
      );
    }
    if (!this.keyOnPedestal) return;
    const centre = this.keyCentre();
    worldText(ctx, LABEL_TEXT, {
      x: centre.x - camX,
      y: centre.y - camY - LABEL_ABOVE_KEY_TILES * TILE_SIZE,
      style: 'prizeLabel',
      align: 'center',
      baseline: 'middle',
    });
    if (this.wouldInteract(active)) {
      drawInteractionPrompt(
        ctx,
        this.pedestal.x * TILE_SIZE - camX,
        centre.y - camY - LABEL_ABOVE_KEY_TILES * TILE_SIZE,
        KEY_PEDESTAL_WIDTH_TILES * TILE_SIZE,
        PROMPT_LABEL,
      );
    }
  }

  /** The pool the key's glow cuts out of the darkness: strong and pulsing with the key there, a dim lamp without. */
  lightPool(): PrisonLightPool {
    if (!this.keyOnPedestal) {
      const base = this.pedestalBase();
      return {
        x: base.x,
        y: base.y - TILE_SIZE * TILE_CENTRE,
        radiusPx: EMPTY_PEDESTAL_LIGHT_RADIUS_TILES * TILE_SIZE,
        strength: EMPTY_PEDESTAL_LIGHT_STRENGTH,
      };
    }
    const centre = this.keyCentre();
    const pulse = prisonKeyPulse(this.seconds);
    const radiusTiles =
      KEY_LIGHT_RADIUS_TILES.min +
      (KEY_LIGHT_RADIUS_TILES.max - KEY_LIGHT_RADIUS_TILES.min) * pulse;
    return {
      x: centre.x,
      y: centre.y,
      radiusPx: radiusTiles * TILE_SIZE,
      strength: KEY_LIGHT_STRENGTH,
    };
  }

  /**
   * The world arrow: to the exit, all the way out, once the party has been
   * caught with the key; otherwise to the key while the driven crawler is in
   * the vault and the key is still there, until it is in view and near.
   */
  arrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
  ): ArrowCandidate | null {
    if (this.guidesToExit) {
      const exit = this.exitRect;
      return this.arrowTo(ctx, camX, camY, active, {
        x: exit.x + exit.w * TILE_CENTRE,
        y: exit.y + exit.h * TILE_CENTRE,
      });
    }
    if (!this.keyOnPedestal || this.sectionOf(active) !== 'vault') return null;
    const centre = this.keyCentre();
    const distanceTiles =
      Math.hypot(
        centre.x - (active.x + TILE_SIZE * TILE_CENTRE),
        centre.y - (active.y + TILE_SIZE * TILE_CENTRE),
      ) / TILE_SIZE;
    if (distanceTiles < ARROW_SUPPRESS_TILES) return null;
    return this.arrowTo(ctx, camX, camY, active, centre);
  }

  private arrowTo(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
    target: { readonly x: number; readonly y: number },
  ): ArrowCandidate {
    return {
      priority: ARROW_PRIORITY.PINNED_OBJECTIVE,
      draw: () =>
        drawArrowAbovePlayer(
          ctx,
          active.x,
          active.y,
          target.x,
          target.y,
          camX,
          camY,
          worldPalette.objective.ready,
        ),
    };
  }

  /** The objective line in the top band for the whole visit. */
  topBandEntry(): TopBandEntry | null {
    if (this.gateOpened) return null;
    return this.partyHoldsKey
      ? objectiveBandEntry(OBJECTIVE_BAND_ID, { text: OBJECTIVE_RETURN, tone: 'success' })
      : objectiveBandEntry(OBJECTIVE_BAND_ID, { text: OBJECTIVE_FIND, tone: 'warning' });
  }

  /** The key's tile for the minimap, while it is on the pedestal. */
  get minimapKeyTile(): PrisonTile | null {
    return this.keyOnPedestal ? this.pedestal : null;
  }

  /** Opens the explainer on a first visit. Call once the arrival loader has closed. */
  openExplainerIfFirstVisit(): void {
    if (!this.deps.link.explainerSeen) this.explainerOpen = true;
  }

  get isPrisonExplainerOpen(): boolean {
    return this.explainerOpen;
  }

  finishPrisonExplainer(): void {
    this.closeExplainer();
  }

  dismissPrisonExplainer(): void {
    this.closeExplainer();
  }

  private closeExplainer(): void {
    this.explainerOpen = false;
    this.deps.link.markExplainerSeen();
  }

  /** The explainer, for the scene to mount once. */
  surfaces(): readonly Surface[] {
    return [prisonExplainerSurface(this)];
  }
}
