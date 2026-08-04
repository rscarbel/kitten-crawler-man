/**
 * BountySystem — Shady's bounty loop on the floor-3 overworld.
 *
 * State lives in the {@link BountyProgress} record threaded through
 * `DungeonSceneOptions`, not in this object: the scene is rebuilt on every
 * building entry and exit, so anything held here alone would be re-rolled at
 * every door. What this system owns is only what a scene can afford to lose —
 * the live mobs of the current encounter — and it re-spawns those on
 * construction when the record says a bounty was already out.
 *
 * Three phases, driven from Shady's dialog (and the `!bounty` debug command):
 *
 *   available  → issueBounty()  → active
 *   active     → boss dies      → kill_pending
 *   kill_pending → collectBounty() → available
 */

import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Player } from '../Player';
import type { EventBus } from '../core/EventBus';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { QuestMarkerType } from './MiniMapSystem';
import type { BountyNoticeState } from './townNotices';
import { drawArrowAbovePlayer } from '../ui/WorldArrow';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawSpeechBubbleWithText } from '../sprites/speechBubble';
import { QuestDialog } from '../ui/QuestDialog';
import { Shady, type ShadyMarker } from '../creatures/Shady';
import {
  buildBountyActiveDialog,
  buildBountyOfferDialog,
  buildBountyPayoutDialog,
  SHADY_PROXIMITY_BUBBLE,
} from './shadyDialogs';
import { findBountyDef } from './bountyDefs';
import { prewarmGroups } from '../core/SpriteLoader';
import { SYSTEM_ASSET_REQUIREMENTS } from '../core/systemAssetRequirements';
import {
  advanceBountyType,
  peekNextBountyName,
  peekNextBountyType,
  takeNextBountyName,
  type BountyPhase,
  type BountyProgress,
} from '../core/BountyProgress';

/**
 * Hard ceiling on any mob's level, matching the spawner's own cap.
 *
 * Deliberately still the party's own level rather than a fraction of it. It was
 * briefly lowered on the theory that bounty packs were uniformly overtuned —
 * floor 3's ambient residents are level 5–9, so a level-20 escort hits at 4.8×
 * base against their 2.2× — but that theory was wrong: the Rock Golem falls on
 * the first attempt at these levels. What made the Knight and the Mantid
 * unbeatable was specific to them (a percentage-of-max-HP attack scaled a second
 * time by mob level; a walk speed with no ceiling), and both are fixed at the
 * source. Tune an individual mark, not this number.
 */
const MAX_BOUNTY_MOB_LEVEL = 20;
/** The mark itself outranks its escort by this much. */
const BOUNTY_BOSS_LEVEL_BONUS = 1;

/** Coins paid for a bounty at level 1... */
const BOUNTY_PAYOUT_BASE_COINS = 60;
/** ...plus this much for every level of the mark above the first. */
const BOUNTY_PAYOUT_PER_LEVEL_COINS = 45;

/** A site nearer than this to the player is a poor bounty — the point is a journey. */
const MIN_SITE_DISTANCE_TILES = 60;

/** Tiles inside which the guidance arrow is suppressed — the player can see the target. */
const ARROW_SUPPRESS_TILES = 4;
const ARROW_COLOR = '#f87171';
const COLLECT_ARROW_COLOR = '#facc15';

/** How far a bounty mob may wander from its site before it is aggroed. */
const SITE_LEASH_RADIUS_TILES = 8;

/** Reach of Shady's Space prompt. Matches the town props' own radius. */
const SHADY_INTERACT_RADIUS_TILES = 1.6;
/** Shady mutters at anyone who comes this close without talking to him. */
const SHADY_BUBBLE_RADIUS_TILES = 3.2;
/**
 * Where his speech bubble is anchored above his tile. Clear of the crown of his
 * hood, which itself stands well above the tile his feet are on.
 */
const SHADY_BUBBLE_LIFT_TILES = 0.85;

/** The glyph over Shady's head for each phase of the loop. */
const SHADY_MARKER_BY_PHASE: Record<BountyPhase, ShadyMarker> = {
  available: 'exclamation',
  active: 'none',
  kill_pending: 'question',
};

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTER_OFFSET = 0.5;

/**
 * Bounds-checked site lookup. The stored site index outlives the site list it
 * came from — a death restart regenerates the map — so an index past the end is
 * a real state, not a bug to be indexed past.
 */
function siteAt(
  sites: ReadonlyArray<{ x: number; y: number }>,
  index: number,
): { x: number; y: number } | null {
  if (index < 0 || index >= sites.length) return null;
  return sites[index];
}

/** Converts a tile coordinate to the world-pixel centre of that tile. */
function tileCentrePx(tile: number): number {
  return (tile + TILE_CENTER_OFFSET) * TILE_SIZE;
}

/**
 * The level a bounty encounter's escort spawns at: the stronger party member's
 * level, capped. The only place in the codebase where a mob's level derives from
 * the players' — keep the derivation here so tuning it is one edit.
 */
export function bountyMinionLevel(humanLevel: number, catLevel: number): number {
  return clamp(Math.max(humanLevel, catLevel), 1, MAX_BOUNTY_MOB_LEVEL);
}

/** The mark's own level: one step above its escort, still capped. */
export function bountyBossLevel(humanLevel: number, catLevel: number): number {
  return Math.min(
    bountyMinionLevel(humanLevel, catLevel) + BOUNTY_BOSS_LEVEL_BONUS,
    MAX_BOUNTY_MOB_LEVEL,
  );
}

/** Coins Shady hands over for a mark of the given level. */
export function bountyPayoutCoins(bossLevel: number): number {
  return BOUNTY_PAYOUT_BASE_COINS + BOUNTY_PAYOUT_PER_LEVEL_COINS * (bossLevel - 1);
}

/**
 * A point-in-time copy of the live half of the bounty loop, for the in-run
 * safe-room checkpoint. The durable half is snapshotted separately — see
 * {@link captureBountyProgress}.
 */
export interface BountyCheckpoint {
  /** Mobs are stored by reference: a snapshot names creatures, it does not clone them. */
  boss: Mob | null;
  encounter: Mob[];
  aggroReleased: boolean;
  respawnPending: boolean;
  markers: Array<{ x: number; y: number; type: QuestMarkerType }>;
  pendingPayoutCoins: number;
  collectPointWorld: { x: number; y: number } | null;
  shady: Shady | null;
}

export class BountySystem implements GameSystem {
  /** The mark, while it is alive. Null before a bounty is issued and after the kill. */
  private boss: Mob | null = null;
  /** Every mob of the current encounter, mark included. */
  private encounter: Mob[] = [];
  /** True once any encounter mob has picked up a target — leashes come off for good. */
  private aggroReleased = false;
  /** Set when the record says a bounty is out but the mobs were lost with the old scene. */
  private respawnPending = false;

  private readonly unsubscribeMobKilled: () => void;
  private readonly _markers: Array<{ x: number; y: number; type: QuestMarkerType }> = [];

  /** The quest-giver himself, once the scene has found him a tile beside the board. */
  private shady: Shady | null = null;
  private readonly dialog: QuestDialog;
  /**
   * The coins the open payout dialog promised. Captured when the dialog opens
   * and handed to `collectBounty` when it completes, so the number he says and
   * the number he pays cannot disagree — recomputing on completion would let a
   * level-up landing mid-conversation quietly change one of them.
   */
  private pendingPayoutCoins = 0;

  /**
   * Where the arrow points once the mark is dead — Shady's tile. Set by the
   * scene once he is placed; until then the arrow falls back to the site.
   */
  private collectPointWorld: { x: number; y: number } | null = null;

  constructor(
    private readonly gameMap: GameMap,
    private readonly bus: EventBus,
    private readonly progress: BountyProgress,
    private readonly addMob: (mob: Mob) => void,
    private readonly audio: AudioManager | null = null,
  ) {
    this.dialog = new QuestDialog(audio);
    this.unsubscribeMobKilled = this.bus.on('mobKilled', (e) => this.onMobKilled(e.mob));
    // The encounter's mobs died with the previous scene, but the record says a
    // bounty is out. Re-staged on the first update, when the players' levels
    // (and so the encounter's) are readable.
    this.respawnPending = this.progress.phase === 'active';
  }

  dispose(): void {
    this.unsubscribeMobKilled();
  }

  get phase(): BountyProgress['phase'] {
    return this.progress.phase;
  }

  /** The mark's name while a bounty is out, e.g. "Slice". */
  get currentName(): string | null {
    return this.progress.currentName;
  }

  /** The mark's type label while a bounty is out, e.g. "the Mantid". */
  get currentTypeLabel(): string | null {
    const id = this.progress.currentTypeId;
    if (id === null) return null;
    return findBountyDef(id)?.typeLabel ?? null;
  }

  /** The type label of the bounty Shady would issue next, for his pitch. */
  get nextTypeLabel(): string | null {
    const id = peekNextBountyType(this.progress);
    if (id === null) return null;
    return findBountyDef(id)?.typeLabel ?? null;
  }

  /** Board copy for `buildTownNotices`. */
  get noticeState(): BountyNoticeState {
    return {
      phase: this.progress.phase,
      name: this.progress.currentName,
      typeLabel: this.currentTypeLabel,
    };
  }

  /**
   * Syncs what Shady is doing with what the loop is doing.
   *
   * Deliberately **not** part of `update()`: the scene treats an open bounty
   * dialog as halted gameplay and returns before `updateGameplay` ever runs, so
   * a per-frame write in there could only ever observe the dialog *closed* — his
   * lean-in pose and his mid-conversation tic suppression were both unreachable
   * outside the preview harness. The scene calls this above that early return.
   */
  syncShady(): void {
    const shady = this.shady;
    if (shady === null) return;
    shady.markerType = SHADY_MARKER_BY_PHASE[this.progress.phase];
    const talking = this.dialog.isOpen;
    // Cancelled rather than merely overridden: the tic is frozen while a dialog
    // is open (nothing advances it), so a scratch left running would resume from
    // wherever it stopped the moment the conversation ends.
    if (talking && !shady.isTalking) shady.cancelScratch();
    shady.isTalking = talking;
  }

  /** Tells the arrow where to send the player to collect. World pixels. */
  setCollectPoint(worldX: number, worldY: number): void {
    this.collectPointWorld = { x: worldX, y: worldY };
  }

  // ── Shady ───────────────────────────────────────────────────────────────────

  /**
   * Stands the quest-giver on `tile` and takes ownership of him. Called once by
   * the scene, which is what knows where the notice board ended up. Idempotent
   * across scene rebuilds because the tile it is handed is.
   */
  placeShady(tile: { x: number; y: number }): void {
    const shady = new Shady(tile.x, tile.y, TILE_SIZE);
    shady.setMap(this.gameMap);
    this.shady = shady;
    this.addMob(shady);
    this.setCollectPoint(tileCentrePx(tile.x), tileCentrePx(tile.y));
  }

  get isDialogOpen(): boolean {
    return this.dialog.isOpen;
  }

  /** Esc closes an open dialog without issuing or paying anything. */
  dismissDialog(): boolean {
    return this.dialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    return this.dialog.handleClick(mx, my);
  }

  renderDialog(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
  }

  /**
   * Space-key handler for the scene's interaction chain. Opens whichever of
   * Shady's three conversations his current phase calls for.
   *
   * Nothing is committed here: `issueBounty` and `collectBounty` hang off the
   * dialog's completion callback, so backing out with Esc on any page leaves
   * the board exactly as it was.
   */
  tryInteract(active: HumanPlayer | CatPlayer, human: HumanPlayer, cat: CatPlayer): boolean {
    if (this.dialog.isOpen) return false;
    if (!this.isWithinShadyReach(active)) return false;
    const shady = this.shady;
    if (shady === null) return false;

    if (this.progress.phase === 'active') {
      this.dialog.open(
        buildBountyActiveDialog(this.progress.currentName ?? 'the mark'),
        () => undefined,
      );
      return true;
    }
    if (this.progress.phase === 'kill_pending') {
      this.pendingPayoutCoins = bountyPayoutCoins(bountyBossLevel(human.level, cat.level));
      this.dialog.open(
        buildBountyPayoutDialog(this.progress.currentName ?? 'It', this.pendingPayoutCoins),
        () => this.collectBounty(active, human, cat, this.pendingPayoutCoins),
      );
      return true;
    }

    const typeId = peekNextBountyType(this.progress);
    const def = typeId === null ? null : findBountyDef(typeId);
    if (def === null) return false;
    // Peeked, not consumed: the name is spoken on page two but only actually
    // spent when the last page is pressed through, so an abandoned conversation
    // does not burn a name out of the pool.
    const name = peekNextBountyName(this.progress, def.id);
    this.dialog.open(buildBountyOfferDialog(name, def.typeLabel), () =>
      this.issueBounty(human, cat),
    );
    return true;
  }

  /** Floats the Space prompt over Shady when he is in reach. */
  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): boolean {
    const shady = this.shady;
    if (shady === null || this.dialog.isOpen) return false;
    if (!this.isWithinShadyReach(active)) return false;
    drawInteractionPrompt(ctx, shady.x - camX, shady.y - camY, TILE_SIZE, 'Talk');
    return true;
  }

  /**
   * Draws Shady's marker and his "…psst" bubble. Called from the scene's
   * overlay pass rather than the Y-sorted entity pass: a market stall drawn
   * after him would otherwise cover the very glyph that says he has work.
   */
  renderShadyOverlay(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
  ): void {
    const shady = this.shady;
    if (shady?.isAlive !== true) return;
    shady.renderMarker(ctx, camX, camY, TILE_SIZE);
    if (this.dialog.isOpen) return;
    if (!this.isWithinShadyBubbleRange(active)) return;
    drawSpeechBubbleWithText(
      ctx,
      shady.x - camX + TILE_SIZE * TILE_CENTER_OFFSET,
      shady.y - camY - TILE_SIZE * SHADY_BUBBLE_LIFT_TILES,
      TILE_SIZE,
      SHADY_PROXIMITY_BUBBLE,
    );
  }

  private isWithinShadyReach(active: Player): boolean {
    return this.distanceToShady(active) <= TILE_SIZE * SHADY_INTERACT_RADIUS_TILES;
  }

  private isWithinShadyBubbleRange(active: Player): boolean {
    return this.distanceToShady(active) <= TILE_SIZE * SHADY_BUBBLE_RADIUS_TILES;
  }

  private distanceToShady(active: Player): number {
    const shady = this.shady;
    if (shady === null) return Infinity;
    return Math.hypot(active.x - shady.x, active.y - shady.y);
  }

  /**
   * Issues the next bounty: picks the type, the name and a site far from the
   * party, stages the encounter and flips the record to `active`. Returns false
   * when a bounty is already out or nothing is registered to hunt.
   */
  /**
   * @param forcedTypeId a {@link BOUNTY_DEFS} id to issue instead of whatever
   *   the cycle has queued. For the `!bounty <type>` cheat only; collecting it
   *   still advances the cycle, so a forced bounty consumes a slot in the
   *   rotation without being the type that slot would have produced.
   */
  issueBounty(human: HumanPlayer, cat: CatPlayer, forcedTypeId?: string): boolean {
    if (this.progress.phase !== 'available') return false;
    const typeId = forcedTypeId ?? peekNextBountyType(this.progress);
    if (typeId === null) return false;
    const def = findBountyDef(typeId);
    if (def === null) return false;
    const siteIndex = this.pickSiteIndex(human, cat);
    if (siteIndex === null) return false;

    const name = takeNextBountyName(this.progress, typeId);
    this.progress.phase = 'active';
    this.progress.currentTypeId = typeId;
    this.progress.currentName = name;
    this.progress.currentSiteIndex = siteIndex;
    this.stageEncounter(def.id, name, siteIndex, human, cat);
    return true;
  }

  /**
   * Pays the bounty out and re-arms the loop. Returns the coins awarded, or 0
   * when there is nothing to collect.
   */
  collectBounty(
    recipient: HumanPlayer | CatPlayer,
    human: HumanPlayer,
    cat: CatPlayer,
    promised?: number,
  ): number {
    if (this.progress.phase !== 'kill_pending') return 0;
    // Shady's dialog passes the figure it already quoted. Recomputing it here
    // would let a level-up landing mid-conversation pay a different number from
    // the one on screen; the debug command omits it and computes its own.
    const coins = promised ?? bountyPayoutCoins(bountyBossLevel(human.level, cat.level));
    recipient.coins += coins;
    this.audio?.play('coin_pouch');
    this.progress.phase = 'available';
    this.progress.currentTypeId = null;
    this.progress.currentName = null;
    // Remembered past the payout so the next bounty can avoid this clearing —
    // `currentSiteIndex` is null by the time the next one is picked.
    this.progress.lastSiteIndex = this.progress.currentSiteIndex;
    this.progress.currentSiteIndex = null;
    this.progress.bountiesCompleted++;
    advanceBountyType(this.progress);
    this.encounter = [];
    this.boss = null;
    this.aggroReleased = false;
    return coins;
  }

  /**
   * Voids the contract and clears the mark off the map. Called when the party
   * dies.
   *
   * Dying has to end the bounty rather than merely interrupt it. The record
   * outlives the scene by design, so without this a death left the contract
   * open with its encounter either standing where the party fell (a checkpoint
   * restore keeps the world) or gone entirely (a floor-entry restart rebuilds
   * it) — and a re-issue would then stage a *second* copy of a mark that was
   * already out there.
   *
   * Also correct as a rule: the payout is for a job finished, and the party did
   * not finish it. Shady offers a fresh one, which `advanceBountyType` makes a
   * different type — the failed one is not repeated straight back at them.
   */
  abandonBounty(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (this.progress.phase === 'available') return;
    for (const mob of this.encounter) {
      mobGrid.remove(mob);
      const index = mobs.indexOf(mob);
      if (index >= 0) mobs.splice(index, 1);
    }
    this.encounter = [];
    this.boss = null;
    this.aggroReleased = false;
    this.respawnPending = false;
    this.progress.phase = 'available';
    this.progress.currentTypeId = null;
    this.progress.currentName = null;
    this.progress.lastSiteIndex = this.progress.currentSiteIndex;
    this.progress.currentSiteIndex = null;
    advanceBountyType(this.progress);
  }

  /**
   * Snapshots the live half of the loop so a death rewinds to the contract the
   * party held when they entered the safe room.
   *
   * The encounter list is copied but its mobs are not — a snapshot names
   * creatures rather than cloning them — and it is copied again on the way back
   * in, because one checkpoint is restored once per death.
   */
  captureCheckpoint(): BountyCheckpoint {
    return {
      boss: this.boss,
      encounter: [...this.encounter],
      aggroReleased: this.aggroReleased,
      respawnPending: this.respawnPending,
      markers: this._markers.map((marker) => ({ ...marker })),
      pendingPayoutCoins: this.pendingPayoutCoins,
      collectPointWorld: this.collectPointWorld === null ? null : { ...this.collectPointWorld },
      shady: this.shady,
    };
  }

  /**
   * Rewinds the loop. Must run *after* {@link abandonBounty}, which the death
   * path already calls: nothing is re-referenced here, it is re-staged, and
   * staging on top of an encounter still standing would put two copies of one
   * mark on the map.
   *
   * The mark is re-staged rather than restored because abandoning splices its
   * mobs out of the scene's mob array and grid — those references are creatures
   * nothing can see or hit any more. `respawnPending` sends the next `update`
   * through the same `restageFromRecord` path a scene rebuild uses, which reads
   * the (separately restored) durable record for the type, name and site.
   *
   * Gated on the snapshot's *boss* rather than on a non-empty encounter: a mark
   * already dead at checkpoint time leaves the loop in `kill_pending` with its
   * minions still listed, and re-staging there would resurrect a mark the player
   * is on their way to collect payment for.
   */
  restoreCheckpoint(snapshot: BountyCheckpoint): void {
    const markWasStillAtLarge = snapshot.boss !== null || snapshot.respawnPending;
    this.boss = null;
    this.encounter = [];
    this.aggroReleased = false;
    this.respawnPending = markWasStillAtLarge;
    this._markers.length = 0;
    for (const marker of snapshot.markers) this._markers.push({ ...marker });
    this.pendingPayoutCoins = snapshot.pendingPayoutCoins;
    this.collectPointWorld =
      snapshot.collectPointWorld === null ? null : { ...snapshot.collectPointWorld };
    this.shady = snapshot.shady;
  }

  update(ctx: SystemContext): void {
    if (this.respawnPending) {
      this.respawnPending = false;
      this.restageFromRecord(ctx.human, ctx.cat);
    }
    if (this.encounter.length === 0) return;
    this.releaseLeashesOnAggro();
    if (this.aggroReleased) this.holdAggro();
  }

  /**
   * Draws the guidance arrow over the active player. Called from the scene's
   * render pass in the same guarded slot as the stairwell reveal arrow.
   */
  renderArrow(
    ctx: CanvasRenderingContext2D,
    activePlayer: HumanPlayer | CatPlayer,
    camX: number,
    camY: number,
  ): void {
    const target = this.arrowTargetWorld();
    if (target === null) return;
    const playerCx = activePlayer.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const playerCy = activePlayer.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const suppressPx = TILE_SIZE * ARROW_SUPPRESS_TILES;
    if (Math.hypot(target.x - playerCx, target.y - playerCy) <= suppressPx) return;
    const color = this.progress.phase === 'active' ? ARROW_COLOR : COLLECT_ARROW_COLOR;
    drawArrowAbovePlayer(
      ctx,
      activePlayer.x,
      activePlayer.y,
      target.x,
      target.y,
      camX,
      camY,
      color,
    );
  }

  /** Minimap markers: the mark's site while hunting, Shady otherwise. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const markers = this._markers;
    markers.length = 0;
    if (this.progress.phase === 'active') {
      // Tracks the live mark, falling back to its site, so the minimap and the
      // guidance arrow never disagree — and they always would otherwise, since
      // the mark leaves its site the moment the fight starts.
      const boss = this.boss;
      const target =
        boss?.isAlive === true
          ? { x: Math.floor(boss.x / TILE_SIZE), y: Math.floor(boss.y / TILE_SIZE) }
          : this.currentSite();
      if (target !== null) markers.push({ x: target.x, y: target.y, type: 'red_x' });
      return markers;
    }
    const collect = this.collectPointWorld;
    if (collect === null) return markers;
    markers.push({
      x: Math.floor(collect.x / TILE_SIZE),
      y: Math.floor(collect.y / TILE_SIZE),
      type: this.progress.phase === 'available' ? 'exclamation' : 'question',
    });
    return markers;
  }

  /**
   * Where the staged mark is standing, in world pixels, or null with no bounty
   * out. Exposed for the `!bounty go` cheat: a site is at least
   * {@link MIN_SITE_DISTANCE_TILES} tiles from the party by construction, so
   * without a warp every test of a bounty *fight* costs a minute of walking.
   */
  get markPointWorld(): { x: number; y: number } | null {
    const boss = this.boss;
    if (boss?.isAlive !== true) return null;
    return { x: boss.x, y: boss.y };
  }

  private currentSite(): { x: number; y: number } | null {
    const index = this.progress.currentSiteIndex;
    if (index === null) return null;
    return siteAt(this.gameMap.bountySites, index);
  }

  private arrowTargetWorld(): { x: number; y: number } | null {
    if (this.progress.phase === 'active') {
      const boss = this.boss;
      if (boss?.isAlive === true) {
        return {
          x: boss.x + TILE_SIZE * TILE_CENTER_OFFSET,
          y: boss.y + TILE_SIZE * TILE_CENTER_OFFSET,
        };
      }
      const site = this.currentSite();
      if (site === null) return null;
      return { x: tileCentrePx(site.x), y: tileCentrePx(site.y) };
    }
    if (this.progress.phase === 'kill_pending') return this.collectPointWorld;
    return null;
  }

  /**
   * Picks a site well away from the party, and never the one the last bounty
   * used. Falls back to the farthest available one — last site included — so a
   * small or crowded map still issues a bounty rather than refusing.
   */
  private pickSiteIndex(human: HumanPlayer, cat: CatPlayer): number | null {
    const sites = this.gameMap.bountySites;
    if (sites.length === 0) return null;
    const px = (human.isActive ? human : cat).x;
    const py = (human.isActive ? human : cat).y;
    const minDistPx = TILE_SIZE * MIN_SITE_DISTANCE_TILES;
    const farEnough: number[] = [];
    let farthestIndex = 0;
    let farthestDist = -1;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const dist = Math.hypot(tileCentrePx(site.x) - px, tileCentrePx(site.y) - py);
      if (dist >= minDistPx && i !== this.progress.lastSiteIndex) farEnough.push(i);
      if (dist > farthestDist) {
        farthestDist = dist;
        farthestIndex = i;
      }
    }
    if (farEnough.length === 0) return farthestIndex;
    return farEnough[Math.floor(Math.random() * farEnough.length)];
  }

  /** Re-stages the encounter the record says is out, after a scene rebuild. */
  private restageFromRecord(human: HumanPlayer, cat: CatPlayer): void {
    const typeId = this.progress.currentTypeId;
    const name = this.progress.currentName;
    if (typeId === null || name === null) return;
    // A death restart regenerates the map, so the stored index can now point
    // past the end of a shorter site list.
    const sites = this.gameMap.bountySites;
    if (sites.length === 0) return;
    let siteIndex = this.progress.currentSiteIndex;
    if (siteIndex === null || siteIndex >= sites.length) {
      siteIndex = this.pickSiteIndex(human, cat);
      if (siteIndex === null) return;
      this.progress.currentSiteIndex = siteIndex;
    }
    this.stageEncounter(typeId, name, siteIndex, human, cat);
  }

  /**
   * Builds an encounter through its def and inserts it. Everything the bounty
   * rules demand of a mob — its level, its name, its immunity to fog, its
   * willingness to chase into town — is applied here rather than in the defs, so
   * a new bounty creature cannot forget any of it.
   */
  private stageEncounter(
    typeId: string,
    name: string,
    siteIndex: number,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    const def = findBountyDef(typeId);
    const site = siteAt(this.gameMap.bountySites, siteIndex);
    if (def === null || site === null) return;

    // Phase 7 of docs/asset-management-plan.md: the player is still 60+
    // tiles from `site` at this point (both callers stage before any warp),
    // so pre-warming here — rather than waiting for the boss's first draw —
    // gets its sheets GPU-resident well ahead of the fight.
    //
    // `typeof Image` guards this because `scripts/verify-bounty.ts` exercises
    // `BountySystem` directly under plain Node, with no `Image`/`document` —
    // the only place in the codebase `stageEncounter` runs outside a browser.
    const assetReq = SYSTEM_ASSET_REQUIREMENTS.find((req) => req.id === `bounty:${typeId}`);
    if (assetReq !== undefined && typeof Image !== 'undefined') {
      void prewarmGroups(assetReq.requiredGroups);
    }

    const minionLevel = bountyMinionLevel(human.level, cat.level);
    const bossLevel = bountyBossLevel(human.level, cat.level);
    const { boss, minions } = def.spawn(site.x, site.y, this.gameMap, minionLevel);

    boss.applyMobLevel(bossLevel);
    boss.displayName = name;
    boss.isBoss = true;
    boss.immuneToConfusion = true;
    for (const minion of minions) minion.applyMobLevel(minionLevel);

    this.encounter = [boss, ...minions];
    this.boss = boss;
    this.aggroReleased = false;
    const homePoint = { x: site.x * TILE_SIZE, y: site.y * TILE_SIZE };
    for (const mob of this.encounter) {
      mob.ignoresTownSafeZone = true;
      // Pre-aggro only: cleared the moment the fight starts, so a mark lured back
      // to town is never yanked home mid-chase.
      mob.homePoint = homePoint;
      mob.leashRadiusTiles = SITE_LEASH_RADIUS_TILES;
      this.addMob(mob);
    }
  }

  /**
   * Once anything in the encounter has a target, the whole group commits: the
   * leashes come off and they will follow the party anywhere, town included.
   */
  private releaseLeashesOnAggro(): void {
    if (this.aggroReleased) return;
    if (!this.encounter.some((mob) => mob.isAlive && mob.currentTarget !== null)) return;
    this.aggroReleased = true;
    // Held until here rather than fired at spawn: the music is the fight
    // starting, and a mark staged across the map has not started anything.
    const typeId = this.progress.currentTypeId;
    if (typeId !== null) this.bus.emit('bossFightInitiated', { bossType: typeId });
    for (const mob of this.encounter) {
      mob.homePoint = undefined;
      mob.leashRadiusTiles = undefined;
      mob.forceAggro = true;
    }
  }

  /**
   * Re-asserts the commitment every frame rather than once at aggro.
   *
   * A safe-room checkpoint restore runs `resetToSpawn()` on every hostile mob,
   * which clears `forceAggro` — and out here there is no boss room to put it
   * back, so a one-shot set silently returns the whole encounter to ordinary
   * aggro-range AI for the rest of the run. `CircusQuestSystem` learned the
   * same lesson about its wave mobs.
   */
  private holdAggro(): void {
    for (const mob of this.encounter) {
      if (!mob.isAlive) continue;
      mob.forceAggro = true;
      // Cleared here too: `resetToSpawn` does not touch them, but a def that
      // re-homed a mob would otherwise leash it back mid-chase.
      mob.homePoint = undefined;
      mob.leashRadiusTiles = undefined;
    }
  }

  private onMobKilled(mob: Mob): void {
    if (mob !== this.boss) return;
    if (this.progress.phase !== 'active') return;
    this.progress.phase = 'kill_pending';
    this.boss = null;
  }
}
