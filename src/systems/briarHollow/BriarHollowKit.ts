/**
 * BriarHollowKit — the one field `DungeonScene` gets for the whole Ratkin
 * village, the way `CombatKit` and `DestructionKit` are the one field each of
 * their domains gets.
 *
 * Follows the scene-kit pattern: concrete typed members, not a `GameSystem[]`,
 * because the village's own systems (harvesting, construction, the siege) will
 * have update signatures as varied as combat's do. Every hook below is an
 * empty, typed stub — the village has no behaviour yet — so the call sites that
 * wire it into `DungeonScene` never have to change shape once the systems
 * behind them are filled in.
 *
 * Constructed only when `gameMap.briarHollow` is non-null, which today it never
 * is: the site generator that fills it does not exist yet. Until then this kit
 * is never built, and every call site that reaches it is a no-op through
 * optional chaining.
 *
 * Durable village state — the quest phase, the structures, the soldier orders,
 * the talk counts — lives in `deps.state` (a `BriarHollowState`), threaded by
 * reference from `DungeonScene` and already captured and restored with the
 * rest of the world checkpoint. Nothing in this kit may hold its own copy of
 * any of that. `captureCheckpoint` / `restoreCheckpoint` here exist only for
 * state that is *not* durable — transient per-system bookkeeping (an open
 * menu's scroll position, a timer mid-countdown) that a death rewind on the
 * same scene instance should still put back, but that a save file has no
 * business remembering.
 */

import type { Player } from '../../Player';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AudioManager } from '../../audio/AudioManager';
import type { PartyTools } from '../../core/PartyTools';
import type { PartyCraftsState } from '../../core/partyCrafts';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { keybindings } from '../../core/Keybindings';
import type { SceneWorld } from '../kits/SceneWorld';
import type { MenusKit } from '../kits/MenusKit';
import type { OverlayInputClaim } from '../kits/OverlayClaims';
import type { SystemContext } from '../GameSystem';
import type { TownPropRenderable } from '../townPropRenderable';
import type { QuestMarkerType } from '../MiniMapSystem';
import type { TrackerEntry } from '../questTracker';

/** The live `Keybindings` singleton's own type, which the class itself does not export. */
type KeybindingsHost = typeof keybindings;

/** A tile-anchored point, matching what every other `humanTalkSpeaker` in this codebase returns. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Transient, non-durable kit state a death rewind on the same scene instance
 * should restore. Empty today: no system inside the kit holds anything yet.
 */
export type BriarHollowKitCheckpoint = Record<string, never>;

export interface BriarHollowKitDeps {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Wraps `deps.partyCrafts.tools` — the party-wide axe/pickaxe tier state. */
  readonly partyTools: PartyTools;
  readonly partyCrafts: PartyCraftsState;
  /** The village's durable state, threaded by reference from `DungeonScene`. */
  readonly state: BriarHollowState;
  readonly menus: MenusKit;
  readonly audio: AudioManager | null;
  readonly keybindings: KeybindingsHost;
}

export class BriarHollowKit {
  private readonly world: SceneWorld;
  private readonly deps: BriarHollowKitDeps;

  constructor(sceneWorld: SceneWorld, deps: BriarHollowKitDeps) {
    this.world = sceneWorld;
    this.deps = deps;
  }

  /** The scene's shared map, event bus, audio and population — read by whichever system built inside this kit needs it. */
  protected get sceneWorld(): SceneWorld {
    return this.world;
  }

  /** What this kit was constructed with. Read by every stub above once it has behaviour to fill in. */
  protected get kitDeps(): BriarHollowKitDeps {
    return this.deps;
  }

  /**
   * Runs once per gameplay frame, in the phase `TownLifeSystem` runs in — the
   * "the village keeps living" block that ticks even while a street
   * conversation or another non-halting overlay is open, and stops only for a
   * hard halt (game over, the pause menu, a level- or run-complete screen).
   */
  update(_ctx: SystemContext): void {
    // No village systems exist yet.
  }

  /**
   * Ground-layer painting — anything that must sit under every body, drawn
   * immediately after `RenderPipeline.renderWorld` and before the Y-sorted
   * entity pass.
   */
  renderGround(_ctx: CanvasRenderingContext2D, _camX: number, _camY: number): void {
    // No village ground layer exists yet.
  }

  /**
   * The village's Y-sorted bodies and props, in the same shape `TownPropSystem`
   * and `MarketSystem` hand `DungeonScene` — merged into the scene's one
   * Y-sorted renderable list rather than drawn through a separate pass, so a
   * villager standing in a doorway sorts against the door the same way a
   * townsperson does.
   */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return [];
  }

  /**
   * Drawn over every body, in the effects pass — telegraphs, floating text,
   * anything that must never be occluded by a mob or a crawler standing in
   * front of it.
   */
  renderAbove(_ctx: CanvasRenderingContext2D, _camX: number, _camY: number): void {
    // No above-body effects exist yet.
  }

  /** Screen-space chrome, drawn after the HUD panel. */
  renderHud(_ctx: CanvasRenderingContext2D): void {
    // No village HUD exists yet.
  }

  /**
   * Floats a SPACE prompt over the nearest interactive village fixture, the
   * same way `renderPropPrompt` asks the market and the town props systems.
   * Returns whether it drew one, so the scene's prompt chain can stop asking
   * further consumers once somebody has answered.
   */
  renderPrompt(
    _ctx: CanvasRenderingContext2D,
    _camX: number,
    _camY: number,
    _active: HumanPlayer | CatPlayer,
  ): boolean {
    return false;
  }

  /**
   * The Space chain's entry into the village: called after the market and
   * bounty consumers have had first refusal, and before the citizen-talk
   * fallback, so a press near a villager or a village fixture never falls
   * through to "talk to the nearest townsperson" instead. Returns whether the
   * press was claimed.
   */
  tryInteract(_active: Player): boolean {
    return false;
  }

  /** Opens the Structure menu (`E`). Returns whether it opened. */
  tryStructureMenu(): boolean {
    return false;
  }

  /**
   * Opens the Construction menu (`U`). `readOnly` is set indoors, where every
   * build row is disabled with "Build outdoors" rather than acting — the menu
   * itself does not exist yet, so this is a stub for that behaviour to land in.
   */
  openConstruction(_readOnly: boolean): void {
    // The Construction menu does not exist yet.
  }

  /** Deposits as much stone as fits into the nearest trebuchet in reach (`X`). */
  quickLoad(): void {
    // No trebuchets exist yet.
  }

  /** Long-tap's mobile equivalent of the Structure menu key. Returns whether it was consumed. */
  handleLongPress(
    _screenX: number,
    _screenY: number,
    _camX: number,
    _camY: number,
    _active: HumanPlayer | CatPlayer,
  ): boolean {
    return false;
  }

  /** Double-tap's mobile equivalent of Quick Load. Returns whether it was consumed. */
  handleDoubleTap(
    _screenX: number,
    _screenY: number,
    _camX: number,
    _camY: number,
    _active: HumanPlayer | CatPlayer,
  ): boolean {
    return false;
  }

  /** A single world tap's mobile equivalent of `tryInteract`. Returns whether it was consumed. */
  handleTap(
    _screenX: number,
    _screenY: number,
    _camX: number,
    _camY: number,
    _active: HumanPlayer | CatPlayer,
  ): boolean {
    return false;
  }

  /**
   * Every overlay the village can raise, in the shape `DungeonScene.overlayClaims`
   * spreads straight into its own list. Empty until a village menu exists.
   */
  overlayClaims(): OverlayInputClaim[] {
    return [];
  }

  /** Minimap pips for anything the village quest wants pointed at. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    return [];
  }

  /** Quest Journal rows for the village's own questline. */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    return [];
  }

  /**
   * Transient kit state only — never the durable `BriarHollowState`, which
   * `DungeonScene` already captures by reference. See the module doc.
   */
  captureCheckpoint(): BriarHollowKitCheckpoint {
    return {};
  }

  /** @param _checkpoint The value a prior `captureCheckpoint` returned. */
  restoreCheckpoint(_checkpoint: BriarHollowKitCheckpoint): void {
    // No transient state to restore yet.
  }

  /**
   * Where the human is in conversation with a villager, for `HumanPlayer`'s
   * talk-facing pose — `null` whenever no village conversation is open.
   */
  humanTalkSpeaker(): WorldPoint | null {
    return null;
  }

  /** Torn down when the scene exits. Safe to call even though nothing is held yet. */
  dispose(): void {
    // Nothing to release yet.
  }
}
