/**
 * The two indoor halves of "The Anchor is Broken": Old Hilda's repairs and the
 * Temple of the Sky's vermin.
 *
 * `AnchorQuestSystem` owns the questline out on the plaza, where Madame Voss
 * offers it and later welds it together. It cannot own these two steps, because
 * a `BuildingInteriorScene` is constructed fresh on every entry and torn down
 * again on every exit — so this system is built with the room, does its room's
 * work, and writes every durable answer back into `AnchorQuestProgress`, which
 * outlives both scenes.
 *
 * Two things it deliberately does not do. It never touches
 * `TownMemory.clearedRooms`: the vermin are questline progress rather than a
 * room feature, and marking the nave "cleared" would also silence the stair
 * guards a different questline puts in other buildings. And it owns no combat
 * at all — the vermin join the room's existing `MobRoster`, so the `CombatKit`
 * and `DestructionKit` the scene already built fight and gore them, exactly as
 * `interiorHostiles.ts` states the arrangement.
 */

import type { AnchorQuestProgress } from '../core/AnchorQuestProgress';
import type { AudioManager } from '../audio/AudioManager';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { ResidentId } from './townResidents';
import type { NPCMarkerType } from '../creatures/QuestNPC';
import { TILE_SIZE } from '../core/constants';
import { QUEST_SLOT_IDX } from '../core/ItemDefs';
import {
  BOOKSHELF,
  BROKEN_BOOKSHELF,
  BROKEN_CHAIR,
  BROKEN_TABLE,
  CHAIR,
  RUG,
  TABLE,
} from '../map/tileTypes';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { distinctSpawnTiles } from './interiorHostiles';
import { ShrineVermin } from '../creatures/ShrineVermin';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import { QuestDialog, type DialogPage } from '../ui/QuestDialog';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawWoodPileSprite } from '../sprites/questNPCSprite';
import { platform } from '../core/Platform';
import {
  buildAvielProgressDialog,
  buildAvielRequestDialog,
  buildAvielRewardDialog,
  buildHildaProgressDialog,
  buildHildaRequestDialog,
  buildHildaRewardDialog,
} from './anchorQuestDialogs';

export const HILDA_COTTAGE_NAME = "Old Hilda's Cottage";
export const SKY_TEMPLE_NAME = 'Temple of the Sky';

/** Her worktable, its chair and one wall shelf. */
const HILDA_REPAIRS_REQUIRED = 3;
/** What one mend costs, out of whichever bag is carrying the wood. */
const BOARDS_PER_REPAIR = 2;
/**
 * Boards per trip to the pile: two mends' worth, so a player who walks over it
 * once is not immediately walking back.
 */
const BOARDS_PER_PICKUP = BOARDS_PER_REPAIR * 2;
/**
 * How long the pile takes to restock, in frames at 60 fps.
 *
 * The pile exists at all so that boards cannot be wasted into a soft-lock, which
 * is the same reason the defend quest's pile respawns; six seconds is that
 * quest's cadence and there is no reason for Hilda's to differ.
 */
const WOOD_PILE_RESPAWN_SECONDS = 6;
const FRAMES_PER_SECOND = 60;
const WOOD_PILE_RESPAWN_FRAMES = WOOD_PILE_RESPAWN_SECONDS * FRAMES_PER_SECOND;
/** How close a crawler must walk to the pile to pick it up, in tiles. */
const WOOD_PILE_PICKUP_TILES = 1.2;
/** Manhattan tiles between crawler and wreck for a repair to be offered. */
const REPAIR_REACH_TILES = 2;
/** Where the pile is dropped, measured from the tile the party walks in on. */
const WOOD_PILE_OFFSET_FROM_DOOR = { dx: 3, dy: -1 };
/** How far the pile may be nudged to find floor it fits on. */
const WOOD_PILE_SEARCH_RADIUS_TILES = 4;

const TEMPLE_VERMIN_COUNT = 5;
/** How far off the aisle a vermin starts, in tiles — into the pews, not on the rug. */
const VERMIN_AISLE_OFFSET_TILES = 2;
/** How far a vermin spawn may be nudged to find open floor between the pews. */
const VERMIN_SEARCH_RADIUS_TILES = 3;

/**
 * A repairable wreck: every tile it stands on and what it turns back into.
 *
 * More than one tile because the worktable is laid out two tiles wide — a
 * furnishing repaired by half would leave a splintered heap welded to a
 * still-standing tabletop.
 */
interface RepairableFurnishing {
  readonly tiles: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly intactType: number;
  readonly brokenType: number;
}

const BROKEN_TYPE_FOR_INTACT: ReadonlyMap<number, number> = new Map([
  [TABLE, BROKEN_TABLE],
  [CHAIR, BROKEN_CHAIR],
  [BOOKSHELF, BROKEN_BOOKSHELF],
]);

/** Pulse geometry for the ring that marks a wreck the party can afford to mend. */
const HIGHLIGHT_RADIUS_FRACTION = 0.62;
const HIGHLIGHT_LINE_WIDTH = 2;
const HIGHLIGHT_COLOR = '#fbbf24';
const HIGHLIGHT_ALPHA_BASE = 0.45;
const HIGHLIGHT_ALPHA_AMPLITUDE = 0.3;
const HIGHLIGHT_PULSE_HZ = 2.2;
const MS_PER_SECOND = 1000;

/** Which conversation is on screen, so its completion knows what it agreed to. */
type InteriorDialogKind = 'hilda_request' | 'hilda_reward' | 'aviel_request' | 'aviel_reward';

export class AnchorInteriorSystem {
  private readonly dialog: QuestDialog;
  private dialogKind: InteriorDialogKind | null = null;
  private dialogTaker: Player | null = null;

  /** Wrecks still standing broken in this visit, front of the list first. */
  private readonly wrecks: RepairableFurnishing[] = [];
  private woodPileTile: { x: number; y: number } | null = null;
  private woodPileAvailable = false;
  private woodPileRespawnTimer = 0;

  /** Vermin this visit put in the nave, pruned as they die. */
  private vermin: ShrineVermin[] = [];

  private constructor(
    private readonly buildingName: string,
    private readonly progress: AnchorQuestProgress,
    private readonly map: GameMap,
    private readonly crawlers: () => ReadonlyArray<Player>,
    private readonly addMob: (mob: Mob) => void,
    private readonly toast: (message: string) => void,
    private readonly audio: AudioManager | null,
  ) {
    this.dialog = new QuestDialog(audio);
    if (this.buildingName === HILDA_COTTAGE_NAME) {
      this.breakHildasFurniture();
      // The pile is placed on the step starting, but the room is torn down and
      // rebuilt on every door open — so a re-entry mid-step must put it back, or
      // a player who spent every board before leaving can never earn another.
      if (this.progress.hilda === 'in_progress') this.placeWoodPile();
    }
    if (this.buildingName === SKY_TEMPLE_NAME) this.restockNave();
  }

  /**
   * The system for this room, or null where the questline has no business.
   *
   * Ground floor only, in name if not yet in effect: both rooms are single-storey
   * today, so no caller currently passes any other floor. Guarded anyway because
   * the rest of this class assumes ground-floor coordinates throughout — a wood
   * pile or a wreck ring would otherwise draw at the wrong height the day either
   * building gains a storey.
   */
  static forBuilding(
    buildingName: string,
    floor: number,
    progress: AnchorQuestProgress,
    map: GameMap,
    crawlers: () => ReadonlyArray<Player>,
    addMob: (mob: Mob) => void,
    toast: (message: string) => void,
    audio: AudioManager | null,
  ): AnchorInteriorSystem | null {
    if (floor !== 0) return null;
    if (buildingName !== HILDA_COTTAGE_NAME && buildingName !== SKY_TEMPLE_NAME) return null;
    return new AnchorInteriorSystem(buildingName, progress, map, crawlers, addMob, toast, audio);
  }

  // ── Hilda's room, on entry ────────────────────────────────────────────────

  /**
   * Splinters as many of her three furnishings as the record says are still
   * unmended — including before the questline exists, because a room that
   * becomes broken the moment a quest says so reads as a stage flat.
   */
  private breakHildasFurniture(): void {
    const furnishings = this.pickRepairableFurnishings();
    for (const furnishing of furnishings) {
      if (this.progress.hildaRepairedTypes.includes(furnishing.intactType)) continue;
      for (const tile of furnishing.tiles) {
        this.map.structure[tile.y][tile.x].type = furnishing.brokenType;
        this.map.markTileDirty(tile.x, tile.y);
      }
      this.wrecks.push(furnishing);
    }
  }

  /**
   * Her worktable, the chair beside it and the nearest wall shelf.
   *
   * Found by scanning rather than by repeating the coordinates
   * `GameMap.generateInterior` lays them out at: two copies of a layout drift,
   * and the copy that drifts silently is the one holding the quest.
   */
  private pickRepairableFurnishings(): RepairableFurnishing[] {
    // Every tile, not just the first: the worktable is laid out two tiles wide,
    // and mending one half of it while the other stays standing reads as the
    // room contradicting the player's own work.
    const tableTiles = this.allTilesOfType(TABLE);
    const chairTile = this.firstTileOfType(CHAIR);
    if (tableTiles.length === 0 || chairTile === null) return [];
    const shelfTile = this.nearestTileOfType(BOOKSHELF, tableTiles[0]);
    if (shelfTile === null) return [];
    const groups: ReadonlyArray<{
      readonly tiles: ReadonlyArray<{ readonly x: number; readonly y: number }>;
      readonly type: number;
    }> = [
      { tiles: tableTiles, type: TABLE },
      { tiles: [chairTile], type: CHAIR },
      { tiles: [shelfTile], type: BOOKSHELF },
    ];
    return groups.map((group) => ({
      tiles: group.tiles,
      intactType: group.type,
      // A furnishing type with no wreck to turn into cannot reach this list —
      // the three lookups above are the only types asked for.
      brokenType: BROKEN_TYPE_FOR_INTACT.get(group.type) ?? group.type,
    }));
  }

  private allTilesOfType(type: number): Array<{ x: number; y: number }> {
    const found: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < this.map.structure.length; y++) {
      const row = this.map.structure[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x].type === type) found.push({ x, y });
      }
    }
    return found;
  }

  private firstTileOfType(type: number): { x: number; y: number } | null {
    for (let y = 0; y < this.map.structure.length; y++) {
      const row = this.map.structure[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x].type === type) return { x, y };
      }
    }
    return null;
  }

  private nearestTileOfType(
    type: number,
    to: { x: number; y: number },
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let y = 0; y < this.map.structure.length; y++) {
      const row = this.map.structure[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x].type !== type) continue;
        const distance = Math.abs(x - to.x) + Math.abs(y - to.y);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = { x, y };
      }
    }
    return best;
  }

  /** Drops the pile inside the door, once Hilda has actually asked for the work. */
  private placeWoodPile(): void {
    if (this.woodPileTile !== null) return;
    const door = this.map.startTile;
    this.woodPileTile = findNearbyWalkableTile(
      this.map,
      door.x + WOOD_PILE_OFFSET_FROM_DOOR.dx,
      door.y + WOOD_PILE_OFFSET_FROM_DOOR.dy,
      WOOD_PILE_SEARCH_RADIUS_TILES,
    );
    this.woodPileAvailable = this.woodPileTile !== null;
  }

  // ── The temple, on entry ──────────────────────────────────────────────────

  /**
   * Puts back however many vermin were still loose when the party last left.
   *
   * The room is rebuilt on every entry, so this runs on a re-entry as well as on
   * the step starting; the count is the record's, never a fresh
   * `TEMPLE_VERMIN_COUNT`, or walking out and back in would restock the nave.
   */
  private restockNave(): void {
    if (this.progress.temple !== 'in_progress') return;
    this.spawnVermin(this.progress.templeVerminRemaining);
    // Read back what actually found floor to stand on rather than trusting the
    // record: a nave with no room left for any of them must not leave the step
    // stuck "in progress" with nothing left to hunt.
    this.progress.templeVerminRemaining = this.vermin.length;
    if (this.vermin.length === 0) this.progress.temple = 'shard_owed';
  }

  private spawnVermin(count: number): void {
    if (count <= 0) return;
    const wanted = this.naveSpawnAnchors(count);
    for (const tile of distinctSpawnTiles(this.map, wanted, VERMIN_SEARCH_RADIUS_TILES)) {
      const rat = new ShrineVermin(tile.x, tile.y, TILE_SIZE);
      applyActiveDifficultyRewards(rat);
      this.vermin.push(rat);
      this.addMob(rat);
    }
  }

  /**
   * Where in the nave to try putting each vermin: spread down the aisle and
   * stepped sideways off it into the pews, alternating sides.
   *
   * The aisle is found as the room's run of `RUG` tiles rather than by repeating
   * the temple's generated column numbers, for the same reason Hilda's
   * furnishings are scanned for.
   */
  private naveSpawnAnchors(count: number): Array<{ x: number; y: number }> {
    const aisle: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < this.map.structure.length; y++) {
      const row = this.map.structure[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x].type === RUG) aisle.push({ x, y });
      }
    }
    if (aisle.length === 0) return [{ x: this.map.startTile.x, y: this.map.startTile.y }];
    aisle.sort((a, b) => a.y - b.y || a.x - b.x);

    const anchors: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < count; index++) {
      // Spread over the aisle's length rather than clustered at one end, so the
      // party sweeps the nave instead of cornering all three at the altar.
      const alongAisle = Math.floor(((index + 1) * aisle.length) / (count + 1));
      const seat = aisle[Math.min(alongAisle, aisle.length - 1)];
      const sideways = index % 2 === 0 ? VERMIN_AISLE_OFFSET_TILES : -VERMIN_AISLE_OFFSET_TILES;
      anchors.push({ x: seat.x + sideways, y: seat.y });
    }
    return anchors;
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  update(): void {
    this.tickWoodPile();
    this.tickVermin();
  }

  private tickWoodPile(): void {
    const tile = this.woodPileTile;
    if (tile === null) return;
    // Nothing left to build once the last piece is mended — a pile that kept
    // restocking after the room was whole would just be a free item farm.
    if (this.progress.hilda !== 'in_progress') return;
    if (!this.woodPileAvailable) {
      this.woodPileRespawnTimer--;
      if (this.woodPileRespawnTimer > 0) return;
      this.woodPileAvailable = true;
    }
    const pileX = tile.x * TILE_SIZE;
    const pileY = tile.y * TILE_SIZE;
    const reach = TILE_SIZE * WOOD_PILE_PICKUP_TILES;
    for (const crawler of this.crawlers()) {
      if (!crawler.isAlive) continue;
      if (Math.hypot(crawler.x - pileX, crawler.y - pileY) >= reach) continue;
      // `Inventory.addItem` routes every quest item into the one reserved quest
      // slot and overwrites whatever id is already sitting there with no check —
      // a crawler mid-`doomsday_scenario` who walks over this pile must not lose
      // it. Left for the other crawler, or the pile itself, to try instead.
      if (this.questSlotBlocksBoards(crawler)) continue;
      crawler.inventory.addItem('quest_wood_board', BOARDS_PER_PICKUP);
      this.woodPileAvailable = false;
      this.woodPileRespawnTimer = WOOD_PILE_RESPAWN_FRAMES;
      this.audio?.play('pickup_1');
      return;
    }
  }

  /** Whether this crawler's reserved quest slot holds a different quest item already. */
  private questSlotBlocksBoards(crawler: Player): boolean {
    const slot = crawler.inventory.actionBar.slots[QUEST_SLOT_IDX];
    return slot !== null && slot.id !== 'quest_wood_board';
  }

  /**
   * Counts the nave's dead off the vermin themselves rather than off a
   * player-kill event: a rat swatted by the cat, finished by a mercenary or
   * burned down by a status effect is still a rat off the nave floor.
   */
  private tickVermin(): void {
    if (this.vermin.length === 0) return;
    const living = this.vermin.filter((rat) => rat.isAlive);
    if (living.length === this.vermin.length) return;
    this.vermin = living;
    this.progress.templeVerminRemaining = living.length;
    if (living.length > 0) return;
    if (this.progress.temple === 'in_progress') this.progress.temple = 'shard_owed';
  }

  // ── The repair ────────────────────────────────────────────────────────────

  /** How much wood the party is carrying between them. */
  private get boardsHeld(): number {
    return this.crawlers().reduce(
      (total, crawler) => total + crawler.inventory.countOf('quest_wood_board'),
      0,
    );
  }

  /**
   * The nearest wreck within reach, or null.
   *
   * Nearest rather than first-in-list: the worktable and its chair sit one tile
   * apart, so a player standing at the chair with the table also in range must
   * not have the prompt and the mend land on the table two tiles away.
   */
  private wreckWithinReach(crawler: Player): RepairableFurnishing | null {
    const tileX = Math.floor((crawler.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileY = Math.floor((crawler.y + TILE_SIZE / 2) / TILE_SIZE);
    let nearest: RepairableFurnishing | null = null;
    let nearestDistance = Infinity;
    for (const wreck of this.wrecks) {
      const distance = this.nearestTileDistance(wreck, tileX, tileY);
      if (distance > REPAIR_REACH_TILES || distance >= nearestDistance) continue;
      nearest = wreck;
      nearestDistance = distance;
    }
    return nearest;
  }

  /** Manhattan distance from a map tile to the closest tile this furnishing occupies. */
  private nearestTileDistance(
    furnishing: RepairableFurnishing,
    tileX: number,
    tileY: number,
  ): number {
    return this.nearestTileOf(furnishing, tileX, tileY).distance;
  }

  /** Which of a furnishing's tiles sits closest to a given map tile, and how far. */
  private nearestTileOf(
    furnishing: RepairableFurnishing,
    tileX: number,
    tileY: number,
  ): { x: number; y: number; distance: number } {
    let best = { x: furnishing.tiles[0].x, y: furnishing.tiles[0].y, distance: Infinity };
    for (const tile of furnishing.tiles) {
      const distance = Math.abs(tileX - tile.x) + Math.abs(tileY - tile.y);
      if (distance < best.distance) best = { x: tile.x, y: tile.y, distance };
    }
    return best;
  }

  /** Whether the party could mend the wreck this crawler is standing at. */
  private canRepairAt(crawler: Player): RepairableFurnishing | null {
    if (this.progress.hilda !== 'in_progress') return null;
    if (this.boardsHeld < BOARDS_PER_REPAIR) return null;
    return this.wreckWithinReach(crawler);
  }

  /** The `R` press. Returns true when a mend actually happened. */
  tryRepair(crawler: Player): boolean {
    const wreck = this.canRepairAt(crawler);
    if (wreck === null) return false;

    for (const tile of wreck.tiles) {
      this.map.structure[tile.y][tile.x].type = wreck.intactType;
      this.map.markTileDirty(tile.x, tile.y);
    }
    this.wrecks.splice(this.wrecks.indexOf(wreck), 1);
    this.spendBoards();

    this.progress.hildaRepairedTypes.push(wreck.intactType);
    this.audio?.play('hammer_strike');
    const done = this.progress.hildaRepairedTypes.length;
    if (done >= HILDA_REPAIRS_REQUIRED) {
      this.progress.hilda = 'shard_owed';
      // The room is finished: the pile has nothing left to build, and any spare
      // boards a player over-collected are quest clutter now, not inventory.
      this.woodPileTile = null;
      this.woodPileAvailable = false;
      for (const crawler of this.crawlers()) {
        crawler.inventory.removeItems(
          'quest_wood_board',
          crawler.inventory.countOf('quest_wood_board'),
        );
      }
      this.toast('The room is whole. Old Hilda owes you a stone.');
      return true;
    }
    const left = HILDA_REPAIRS_REQUIRED - done;
    this.toast(left === 1 ? 'One thing left to mend.' : `${left} things left to mend.`);
    // More mending is still owed: the pile is guaranteed ready the moment this
    // one is finished, rather than making the player wait out its respawn timer
    // with no wood on them and nothing obvious to do next.
    this.woodPileAvailable = true;
    this.woodPileRespawnTimer = 0;
    return true;
  }

  /**
   * Takes the boards out of whichever bags hold them.
   *
   * The party is one party, and which crawler happened to walk over the pile is
   * not something the player should have to keep track of.
   */
  private spendBoards(): void {
    let owed = BOARDS_PER_REPAIR;
    for (const crawler of this.crawlers()) {
      if (owed === 0) break;
      const available = Math.min(owed, crawler.inventory.countOf('quest_wood_board'));
      if (available === 0) continue;
      crawler.inventory.removeItems('quest_wood_board', available);
      owed -= available;
    }
  }

  // ── The conversations ─────────────────────────────────────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen;
  }

  advanceDialog(): boolean {
    return this.dialog.advance();
  }

  dismissDialog(): boolean {
    return this.dialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    return this.dialog.handleClick(mx, my);
  }

  /**
   * The service prompt's first refusal. True when the questline had something to
   * say and took the press — Hilda's reading and Aviel's blessing are what the
   * player gets when this returns false.
   */
  tryOpenDialog(residentId: ResidentId, talker: Player): boolean {
    if (this.dialog.isOpen) return false;
    if (this.progress.status !== 'active') return false;
    const pages = this.pagesFor(residentId);
    if (pages === null) return false;
    this.dialogTaker = talker;
    this.dialog.open(pages, () => this.onDialogComplete());
    return true;
  }

  private pagesFor(residentId: ResidentId): DialogPage[] | null {
    if (residentId === 'old_hilda' && this.buildingName === HILDA_COTTAGE_NAME) {
      return this.hildaPages();
    }
    if (residentId === 'deacon_aviel' && this.buildingName === SKY_TEMPLE_NAME) {
      return this.avielPages();
    }
    return null;
  }

  private hildaPages(): DialogPage[] | null {
    if (this.progress.hilda === 'offered') {
      this.dialogKind = 'hilda_request';
      return buildHildaRequestDialog(HILDA_REPAIRS_REQUIRED, BOARDS_PER_REPAIR);
    }
    if (this.progress.hilda === 'in_progress') {
      this.dialogKind = null;
      return buildHildaProgressDialog(
        this.progress.hildaRepairedTypes.length,
        HILDA_REPAIRS_REQUIRED,
        this.boardsHeld >= BOARDS_PER_REPAIR,
      );
    }
    if (this.progress.hilda === 'shard_owed') {
      this.dialogKind = 'hilda_reward';
      return buildHildaRewardDialog();
    }
    return null;
  }

  private avielPages(): DialogPage[] | null {
    if (this.progress.temple === 'offered') {
      this.dialogKind = 'aviel_request';
      return buildAvielRequestDialog();
    }
    if (this.progress.temple === 'in_progress') {
      this.dialogKind = null;
      return buildAvielProgressDialog(this.progress.templeVerminRemaining);
    }
    if (this.progress.temple === 'shard_owed') {
      this.dialogKind = 'aviel_reward';
      return buildAvielRewardDialog();
    }
    return null;
  }

  private onDialogComplete(): void {
    const kind = this.dialogKind;
    const taker = this.dialogTaker;
    this.dialogKind = null;
    this.dialogTaker = null;
    if (kind === 'hilda_request') {
      this.progress.hilda = 'in_progress';
      this.placeWoodPile();
      return;
    }
    if (kind === 'aviel_request') {
      this.progress.temple = 'in_progress';
      this.spawnVermin(TEMPLE_VERMIN_COUNT);
      // Read back how many actually found floor to stand on rather than trusting
      // the count asked for — a nave with no room for any of them must not leave
      // the step stuck at "in progress" with nothing left to hunt.
      this.progress.templeVerminRemaining = this.vermin.length;
      if (this.vermin.length === 0) this.progress.temple = 'shard_owed';
      return;
    }
    if (taker === null) return;
    if (kind === 'hilda_reward') {
      if (this.grantShard(taker, 'anchor_shard_hilda')) this.progress.hilda = 'done';
      return;
    }
    if (kind === 'aviel_reward') {
      if (this.grantShard(taker, 'anchor_shard_temple')) this.progress.temple = 'done';
    }
  }

  /**
   * Hands over a shard, or says why not.
   *
   * The step stays owed on a full bag rather than the shard evaporating: it is
   * one of three the questline cannot be finished without, and it cannot be
   * dropped or bought back.
   */
  private grantShard(
    taker: Player,
    shardId: 'anchor_shard_hilda' | 'anchor_shard_temple',
  ): boolean {
    if (!taker.inventory.hasRoomFor(shardId)) {
      this.audio?.play('error_taking_action');
      this.toast('No room for the shard — clear a slot and ask again.');
      return false;
    }
    taker.inventory.addItem(shardId, 1);
    this.audio?.play('pickup_1');
    return true;
  }

  // ── Signposting ───────────────────────────────────────────────────────────

  /**
   * The glyph this resident should be wearing, or null when the questline has no
   * opinion about them (not on the errand, or not one of its two indoor givers).
   */
  markerFor(residentId: ResidentId): NPCMarkerType | null {
    if (this.progress.status !== 'active') return null;
    if (residentId === 'old_hilda' && this.buildingName === HILDA_COTTAGE_NAME) {
      return markerForStep(this.progress.hilda);
    }
    if (residentId === 'deacon_aviel' && this.buildingName === SKY_TEMPLE_NAME) {
      return markerForStep(this.progress.temple);
    }
    return null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** World-space: the pile, the wreck highlights and the repair prompt. */
  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activeCrawler: Player,
  ): void {
    const pile = this.woodPileTile;
    if (pile !== null && this.woodPileAvailable) {
      drawWoodPileSprite(ctx, pile.x * TILE_SIZE - camX, pile.y * TILE_SIZE - camY, TILE_SIZE);
    }

    // No boards, no glow: the highlight's whole job is to answer "what can I do
    // *now*", and with an empty bag the answer is the pile, which has a pointer
    // of its own.
    if (this.progress.hilda !== 'in_progress') return;
    if (this.boardsHeld < BOARDS_PER_REPAIR) return;

    const pulse =
      HIGHLIGHT_ALPHA_BASE +
      HIGHLIGHT_ALPHA_AMPLITUDE *
        Math.sin((performance.now() / MS_PER_SECOND) * HIGHLIGHT_PULSE_HZ);
    for (const wreck of this.wrecks) {
      for (const tile of wreck.tiles) {
        const sx = tile.x * TILE_SIZE - camX;
        const sy = tile.y * TILE_SIZE - camY;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = HIGHLIGHT_LINE_WIDTH;
        ctx.beginPath();
        ctx.arc(
          sx + TILE_SIZE / 2,
          sy + TILE_SIZE / 2,
          TILE_SIZE * HIGHLIGHT_RADIUS_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    const reachable = this.wreckWithinReach(activeCrawler);
    if (reachable === null) return;
    const activeTileX = Math.floor((activeCrawler.x + TILE_SIZE / 2) / TILE_SIZE);
    const activeTileY = Math.floor((activeCrawler.y + TILE_SIZE / 2) / TILE_SIZE);
    const promptTile = this.nearestTileOf(reachable, activeTileX, activeTileY);
    drawInteractionPrompt(
      ctx,
      promptTile.x * TILE_SIZE - camX,
      promptTile.y * TILE_SIZE - camY,
      TILE_SIZE,
      platform.isMobile ? 'Tap to repair' : 'Repair',
      platform.isMobile ? undefined : 'R',
    );
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
  }
}

/** The shipped convention: `'exclamation'` offers, `'question'` turns in. */
function markerForStep(step: AnchorQuestProgress['hilda']): NPCMarkerType {
  if (step === 'offered') return 'exclamation';
  if (step === 'shard_owed') return 'question';
  return 'none';
}
