/**
 * AnchorQuestSystem — "The Anchor is Broken", the town errand that earns the
 * Wayfinder's Anchor.
 *
 * Madame Voss names three shards; three neighbours part with them; she welds
 * them back together for a fee. The point of the errand is the walk: it takes
 * the player once around the plaza ring, so the trip the stone later abolishes
 * is a trip they have actually made.
 *
 * Two things are deliberately *not* stored here. Shard ownership is read from
 * the two crawlers' inventories, never mirrored — the party carries two bags and
 * a checkpoint restore can desync a copy. And the questline's own status lives
 * in `AnchorQuestProgress`, which outlives this system: the overworld scene is
 * rebuilt on death and the interiors are rebuilt on every entry, so the
 * `QuestManager` below is a registry of the definition, seeded from the record
 * rather than the other way round.
 */

import type { GameSystem } from './GameSystem';
import type { TrackerEntry, TrackerSource, TrackerTarget } from './questTracker';
import type { QuestMarkerType } from './MiniMapSystem';
import { QuestManager, type QuestStatus } from '../core/QuestManager';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { Player } from '../Player';
import type { GrantedReward } from '../core/GrantedReward';
import type { AnchorQuestProgress } from '../core/AnchorQuestProgress';
import { ANCHOR_SHARD_IDS, ITEM_DEF, QUEST_SLOT_IDX, type ItemId } from '../core/ItemDefs';
import { QuestDialog, type DialogPage } from '../ui/QuestDialog';
import { drawItemIcon } from '../ui/InventoryPanel';
import { drawQuestCompleteOverlay, QUEST_COMPLETE_OVERLAY_FRAMES } from '../ui/QuestBanners';
import type { VendorLineGate } from './market/vendorDefs';
import { HILDA_COTTAGE_NAME, SKY_TEMPLE_NAME } from './AnchorInteriorSystem';
import {
  buildAnchorReward,
  buildAssemblyDialog,
  buildCannotAffordDialog,
  buildOfferDialog,
  buildProgressDialog,
} from './anchorQuestDialogs';

const ANCHOR_QUEST_ID = 'anchor_shards';
const ANCHOR_QUEST_NAME = 'The Anchor is Broken';

/** Voss's cut for four seconds of work and thirty years of knowing which four. */
const ANCHOR_ASSEMBLY_FEE_COINS = 25;
/** A mini-quest's payout: a fraction of the story questlines on this floor. */
const ANCHOR_QUEST_XP = 600;
/** Handful of health potions, so the errand also restocks the walk home. */
const ANCHOR_REWARD_POTIONS_MIN = 2;
const ANCHOR_REWARD_POTIONS_MAX = 4;

const SHARDS_REQUIRED = ANCHOR_SHARD_IDS.length;

/** Where the shard each giver holds is described, for the Journal's objective line. */
const SHARD_OBJECTIVES: Record<(typeof ANCHOR_SHARD_IDS)[number], string> = {
  anchor_shard_tinker: "Buy the grey wedge from the tinker's stall",
  anchor_shard_hilda: "Get the shard from under Old Hilda's chair",
  anchor_shard_temple: "Ask Deacon Aviel for the altar's shard",
};

/** The same three, phrased as a list Voss reads back at you. */
const SHARD_REMINDERS: Record<(typeof ANCHOR_SHARD_IDS)[number], string> = {
  anchor_shard_tinker: 'The tinker, who thinks it is scrap.',
  anchor_shard_hilda: 'Old Hilda, who is using it as furniture.',
  anchor_shard_temple: 'The temple, and their rat problem.',
};

/** Which conversation is on screen, so its completion knows what it agreed to. */
type AnchorDialogKind = 'offer' | 'progress' | 'assembly' | 'cannot_afford';

export class AnchorQuestSystem implements GameSystem, TrackerSource {
  private readonly questManager: QuestManager;

  private readonly dialog: QuestDialog;
  private dialogKind: AnchorDialogKind | null = null;
  /**
   * Who opened the conversation. Assembly charges and is thanked through this
   * crawler; the stone itself goes to both.
   */
  private dialogOpener: Player | null = null;
  private completeOverlayTimer = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly progress: AnchorQuestProgress,
    /** Both crawlers. Every shard question is a sum over the pair, never one bag. */
    private readonly crawlers: () => ReadonlyArray<Player>,
    /** Madame Voss's plaza tile; null where the plaza had no room for her. */
    private readonly fortuneTile: () => TrackerTarget | null,
    /** The tinker's counter, for the Journal's chevron on that step. */
    private readonly tinkerStallTile: () => TrackerTarget | null,
    /**
     * A named building's door on the overworld map.
     *
     * Hilda's shard and the temple's are earned indoors, where this system does
     * not run, so the furthest the Journal can point is the door the player has
     * to walk through — which is exactly the answer they need from the plaza.
     *
     * The caller states the doorway's own span, because only the map knows it:
     * an opening can be wider than the single walkable tile recorded as the door.
     */
    private readonly doorTileOf: (buildingName: string) => TrackerTarget | null,
    private readonly toast: (message: string) => void,
    private readonly audio: AudioManager | null = null,
  ) {
    this.questManager = new QuestManager();
    this.questManager.register({
      id: ANCHOR_QUEST_ID,
      name: ANCHOR_QUEST_NAME,
      type: 'mini',
      // The health potions promised by the offer's reward strip are granted
      // directly in `assemble()`, not through `lootBoxItems` — no payout path
      // in this codebase reads that field.
      rewards: { xp: ANCHOR_QUEST_XP },
    });
    // The record outlives this object, so it seeds the manager rather than the
    // manager being restored into it.
    if (this.progress.status === 'active') this.questManager.startQuest(ANCHOR_QUEST_ID);
    if (this.progress.status === 'completed') {
      this.questManager.startQuest(ANCHOR_QUEST_ID);
      this.questManager.completeQuest(ANCHOR_QUEST_ID);
    }
    this.dialog = new QuestDialog(audio);
  }

  // ── Party-wide questions ──────────────────────────────────────────────────

  private get status(): QuestStatus {
    return this.progress.status;
  }

  /** How many of the item the party holds, across both bags. */
  private partyCountOf(id: ItemId): number {
    return this.crawlers().reduce((total, crawler) => total + crawler.inventory.countOf(id), 0);
  }

  private holdsShard(id: (typeof ANCHOR_SHARD_IDS)[number]): boolean {
    return this.partyCountOf(id) > 0;
  }

  private get shardsHeld(): number {
    return ANCHOR_SHARD_IDS.filter((id) => this.holdsShard(id)).length;
  }

  private get outstandingShards(): ReadonlyArray<(typeof ANCHOR_SHARD_IDS)[number]> {
    return ANCHOR_SHARD_IDS.filter((id) => !this.holdsShard(id));
  }

  /**
   * Whether the tinker's gated row is on his counter: only while the errand is
   * live and the party does not already have that shard. Buying it therefore
   * removes the row, since `PricedMenuPanel` rebuilds its rows after every sale.
   */
  isVendorLineOffered(gate: VendorLineGate): boolean {
    return this.gateChecks[gate]();
  }

  /**
   * One check per gate. A `Record` rather than a comparison chain so that adding
   * a gate to `VendorLineGate` fails to compile until it is answered here.
   */
  private readonly gateChecks: Record<VendorLineGate, () => boolean> = {
    anchor_shard: () => this.status === 'active' && !this.holdsShard('anchor_shard_tinker'),
  };

  // ── Frame ─────────────────────────────────────────────────────────────────

  update(): void {
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    this.syncStepStates();
  }

  /**
   * Brings the per-giver step states in line with what the bags actually say.
   *
   * Only the tinker's step is derived here: his shard is bought, so ownership is
   * the whole of his state machine. Hilda's and the temple's steps are advanced
   * by the systems that own those rooms, which have work to track that inventory
   * cannot see (repairs made, vermin left).
   */
  private syncStepStates(): void {
    if (this.holdsShard('anchor_shard_tinker') || this.status === 'completed') {
      this.progress.tinker = 'done';
    } else if (this.status === 'active') {
      this.progress.tinker = 'in_progress';
    } else {
      this.progress.tinker = 'offered';
    }
  }

  // ── The conversation at the fortune teller ────────────────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen;
  }

  /**
   * The completion banner, which a press dismisses early. It rides over live
   * play rather than pausing it, so it is not part of `isDialogOpen`.
   */
  get isOutcomeOverlayShowing(): boolean {
    return this.completeOverlayTimer > 0;
  }

  /** Space/tap on the banner: dismiss early rather than wait out the timer. */
  advanceOutcomeOverlay(): boolean {
    if (this.completeOverlayTimer <= 0) return false;
    this.completeOverlayTimer = 0;
    return true;
  }

  /**
   * The Consult prompt's first refusal. Returns true when the questline had
   * something to say and took the press — the card reading is what the player
   * gets when this returns false.
   */
  tryOpenDialog(active: Player): boolean {
    if (this.dialog.isOpen) return false;
    const pages = this.pagesFor(active);
    if (pages === null) return false;
    this.dialogOpener = active;
    this.dialog.open(pages, () => this.onDialogComplete());
    return true;
  }

  /** What Voss says right now, or null when she has nothing left but the cards. */
  private pagesFor(active: Player): DialogPage[] | null {
    const reward = buildAnchorReward(ANCHOR_QUEST_XP);
    if (this.status === 'available') {
      this.dialogKind = 'offer';
      return buildOfferDialog(reward);
    }
    if (this.status !== 'active') return null;
    if (this.shardsHeld < SHARDS_REQUIRED) {
      this.dialogKind = 'progress';
      return buildProgressDialog(
        this.shardsHeld,
        SHARDS_REQUIRED,
        this.outstandingShards.map((id) => SHARD_REMINDERS[id]),
      );
    }
    if (active.coins < ANCHOR_ASSEMBLY_FEE_COINS) {
      this.dialogKind = 'cannot_afford';
      return buildCannotAffordDialog(ANCHOR_ASSEMBLY_FEE_COINS);
    }
    this.dialogKind = 'assembly';
    return buildAssemblyDialog(ANCHOR_ASSEMBLY_FEE_COINS, reward);
  }

  private onDialogComplete(): void {
    const kind = this.dialogKind;
    const opener = this.dialogOpener;
    this.dialogKind = null;
    this.dialogOpener = null;
    if (kind === 'offer') {
      this.acceptQuest();
      return;
    }
    if (kind === 'assembly' && opener !== null) this.assemble(opener);
  }

  private acceptQuest(): void {
    this.progress.status = 'active';
    this.questManager.startQuest(ANCHOR_QUEST_ID);
    this.syncStepStates();
    this.bus.emit('questStarted', { questId: ANCHOR_QUEST_ID });
  }

  /**
   * Esc. Declining an offer leaves the quest `available` and Voss keeps it.
   *
   * A refused conversation leaves `dialogKind` behind, which is harmless: only
   * the dialog's own completion callback reads it, and `tryOpenDialog` rewrites
   * it before any dialog can be completed.
   */
  dismissDialog(): boolean {
    return this.dialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    if (this.advanceOutcomeOverlay()) return true;
    return this.dialog.handleClick(mx, my);
  }

  // ── The assembly ──────────────────────────────────────────────────────────

  private assemble(payer: Player): void {
    if (payer.coins < ANCHOR_ASSEMBLY_FEE_COINS) {
      this.audio?.play('error_taking_action');
      this.toast(`Madame Voss wants ${ANCHOR_ASSEMBLY_FEE_COINS} coins.`);
      return;
    }
    if (this.shardsHeld < SHARDS_REQUIRED) return;

    const crawlers = this.crawlers();
    // Checked before anything is spent: the stone cannot be dropped or bought
    // back, so a party that can't actually hold two of them must keep its
    // shards, its coins and its unfinished quest rather than lose one forever.
    if (!crawlers.every((crawler) => this.canGrantAnchor(crawler))) {
      this.audio?.play('error_taking_action');
      this.toast("No room for the Wayfinder's Anchor — clear a slot on both bags and ask again.");
      return;
    }

    // Each shard comes out of whichever bag happens to hold it — the party is one
    // party, and which crawler picked a shard up is not the player's problem.
    for (const shardId of ANCHOR_SHARD_IDS) {
      for (const crawler of crawlers) {
        if (crawler.inventory.removeOne(shardId)) break;
      }
    }
    payer.coins -= ANCHOR_ASSEMBLY_FEE_COINS;

    for (const crawler of crawlers) this.grantAnchor(crawler);

    this.progress.status = 'completed';
    this.questManager.completeQuest(ANCHOR_QUEST_ID);

    // Granted once, to the payer: `gainXp` is a per-player ledger, and the
    // errand was one trip for the party, not one trip each.
    const xp = this.questManager.getDef(ANCHOR_QUEST_ID)?.rewards.xp ?? ANCHOR_QUEST_XP;
    if (payer.gainXp(xp)) {
      this.bus.emit('playerLevelUp', { player: payer, newLevel: payer.level });
    }
    // `QuestManager`'s generic `lootBoxItems` field is never read by any payout
    // path in this codebase — granted directly here instead, so the errand
    // actually restocks the walk home rather than only promising to in a
    // comment on a dead declaration. `addItem` drops silently when there is no
    // room, same as every other grant here checks for first.
    if (payer.inventory.hasRoomFor('health_potion')) {
      const potionCount =
        ANCHOR_REWARD_POTIONS_MIN +
        Math.floor(Math.random() * (ANCHOR_REWARD_POTIONS_MAX - ANCHOR_REWARD_POTIONS_MIN + 1));
      payer.inventory.addItem('health_potion', potionCount);
    }

    // Presented, not merely deposited: a permanent item that appears silently on
    // a full hotbar is an item the player never learns they have.
    this.bus.emit('rewardGranted', { rewards: [this.anchorReward()] });
    this.bus.emit('questCompleted', { questId: ANCHOR_QUEST_ID });
    this.toast("Wayfinder's Anchor assembled — both crawlers carry one.");
    this.completeOverlayTimer = QUEST_COMPLETE_OVERLAY_FRAMES;
  }

  /** Whether this crawler has a free hotbar slot or bag room for the stone. */
  private canGrantAnchor(crawler: Player): boolean {
    const bar = crawler.inventory.actionBar;
    for (let slot = 0; slot < QUEST_SLOT_IDX; slot++) {
      if (bar.slots[slot] === null) return true;
    }
    return crawler.inventory.hasRoomFor('wayfinders_anchor');
  }

  /**
   * Puts the stone on a free hotbar slot, falling back to the bag.
   *
   * The reserved quest slot is skipped deliberately: the next quest item picked
   * up would overwrite whatever is sitting in it, and the stone cannot be
   * dropped or re-acquired. Only called once `canGrantAnchor` has confirmed
   * there is somewhere for it to go.
   */
  private grantAnchor(crawler: Player): void {
    const bar = crawler.inventory.actionBar;
    for (let slot = 0; slot < QUEST_SLOT_IDX; slot++) {
      if (bar.slots[slot] === null) {
        bar.slots[slot] = { ...ITEM_DEF.wayfinders_anchor, quantity: 1 };
        return;
      }
    }
    crawler.inventory.addItem('wayfinders_anchor', 1);
  }

  private anchorReward(): GrantedReward {
    const def = ITEM_DEF.wayfinders_anchor;
    return {
      kind: 'item',
      name: def.name,
      description: def.description ?? '',
      renderIcon: (ctx, x, y, size) => drawItemIcon(ctx, { ...def, quantity: 1 }, x, y, size),
    };
  }

  // ── Signposting ───────────────────────────────────────────────────────────

  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const tile = this.fortuneTile();
    if (tile === null) return [];
    if (this.status === 'available') return [{ x: tile.x, y: tile.y, type: 'exclamation' }];
    if (this.status === 'active' && this.shardsHeld === SHARDS_REQUIRED) {
      return [{ x: tile.x, y: tile.y, type: 'question' }];
    }
    return [];
  }

  /**
   * One Journal row per live step.
   *
   * Hilda's and the temple's rows point at their front doors rather than at the
   * work: the work is indoors, where this system does not run and the chevron
   * would have nothing to aim at anyway.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const name = this.questManager.getDef(ANCHOR_QUEST_ID)?.name ?? ANCHOR_QUEST_NAME;
    const fortune = this.fortuneTile() ?? undefined;

    if (this.status === 'available') {
      return [
        {
          id: ANCHOR_QUEST_ID,
          name,
          status: 'available',
          objective: 'Consult the fortune teller in the plaza',
          hint: 'Madame Voss keeps her table on the square.',
          target: fortune,
        },
      ];
    }
    if (this.status !== 'active') return [];

    const outstanding = this.outstandingShards;
    if (outstanding.length === 0) {
      return [
        {
          id: ANCHOR_QUEST_ID,
          name,
          status: 'active',
          objective: `Take all three shards back to Madame Voss (${ANCHOR_ASSEMBLY_FEE_COINS}c)`,
          target: fortune,
        },
      ];
    }
    const held = SHARDS_REQUIRED - outstanding.length;
    return outstanding.map((shardId, index) => ({
      id: `${ANCHOR_QUEST_ID}:${shardId}`,
      name,
      status: 'active' as const,
      objective: SHARD_OBJECTIVES[shardId],
      hint: `Shard ${held + index + 1} of ${SHARDS_REQUIRED} — Voss joins them once you have all three.`,
      target: this.stepTarget(shardId),
    }));
  }

  /** Where a given shard's step sends the player. */
  private stepTarget(shardId: (typeof ANCHOR_SHARD_IDS)[number]): TrackerTarget | undefined {
    if (shardId === 'anchor_shard_tinker') return this.tinkerStallTile() ?? undefined;
    if (shardId === 'anchor_shard_hilda') return this.doorTileOf(HILDA_COTTAGE_NAME) ?? undefined;
    return this.doorTileOf(SKY_TEMPLE_NAME) ?? undefined;
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    if (this.completeOverlayTimer > 0) {
      drawQuestCompleteOverlay(ctx, `${ANCHOR_QUEST_NAME} — COMPLETE`, this.completeOverlayTimer);
    }
    this.dialog.render(ctx);
  }
}
