/**
 * MenusKit — the panels, overlays and hotbar every place with a player in it
 * needs: the bag, the gear screen, the pause menu, the award stack, the toast
 * strip, and the one routine that decides what pressing a hotbar slot does.
 *
 * A scene constructs one of these and its player can spend a skill point, drag
 * an item, drink a potion and read a skill book. Building interiors had a
 * stripped copy of about a third of this, reachable only from mobile taps, which
 * is why a desktop player indoors had no working hotbar and no way at all to
 * spend the points they had just earned.
 */

import type { SoundId } from '../../audio/sounds';
import type { AbilityManager } from '../../core/AbilityManager';
import type { AchievementManager } from '../../core/AchievementManager';
import type { GameStats } from '../../core/GameStats';
import type { InventoryItem, ItemId } from '../../core/ItemDefs';
import { POTION_EFFECT_SOUND_DELAY, TIMED_POTIONS } from '../../core/timedPotions';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { GearPanel } from '../../ui/GearPanel';
import { HotbarToast } from '../../ui/HotbarToast';
import { InventoryPanel } from '../../ui/InventoryPanel';
import type { InventoryInteraction } from '../../ui/InventoryInteraction';
import { LevelUpDialog } from '../../ui/LevelUpDialog';
import { potionEffectNotice, statBoostNotice } from '../../ui/potionNotices';
import { PauseMenu } from '../../ui/PauseMenu';
import { RewardGrantedDialog } from '../../ui/RewardGrantedDialog';
import { SkillBookPrompt } from '../../ui/SkillBookPrompt';
import { promptSkillBookRead, type SkillBookFlowHost } from '../skillBookUse';
import type { SkillBookReadRequest } from '../../ui/InventoryInteraction';
import type { SceneWorld } from './SceneWorld';

/** Which bottle a drink came from: the container and the slot inside it. */
export interface PotionSlot {
  readonly source: 'inv' | 'hotbar';
  readonly slotIdx: number;
}

/** The item in one of a crawler's two containers, or null when the slot is empty. */
function slotContentsAt(
  holder: HumanPlayer | CatPlayer,
  source: 'inv' | 'hotbar' | null,
  slotIdx: number,
): InventoryItem | null {
  const container = source === 'hotbar' ? holder.inventory.actionBar : holder.inventory.bag;
  return container.slots[slotIdx];
}

/** Armour with both halves of an equip address — the only thing that can be worn. */
function isWearable(
  item: InventoryItem | null,
): item is InventoryItem & { equipSlot: string; equipSubSlot: string } {
  return item?.type === 'armor' && item.equipSlot !== undefined && item.equipSubSlot !== undefined;
}

/** A cue waiting out its beat behind the gulp that earned it. */
interface DelayedSound {
  readonly id: SoundId;
  framesLeft: number;
}

export interface MenusKitDeps {
  readonly world: SceneWorld;
  readonly abilityManager: AbilityManager;
  /**
   * The tutorial's restricted drag rules, when one is running. Absent everywhere
   * else, which is what leaves the bag fully draggable.
   */
  readonly inventoryInteraction?: InventoryInteraction;
  /**
   * Extra teardown a scene needs whenever a pausing overlay takes the screen —
   * the dungeon's mobile long-press timer, which would otherwise fire a context
   * menu underneath the overlay that just covered it.
   */
  readonly onOverlayRaised?: () => void;
  /**
   * Called after a bottle actually goes down, for the achievements a scene ties
   * to drinking one *where it was poured*.
   */
  readonly onPotionDrunk?: (id: ItemId, drinker: HumanPlayer | CatPlayer) => void;
}

/** Everything the pause menu needs in order to draw its full set of tabs. */
export interface PauseMenuRenderDeps {
  readonly humanAchievements: AchievementManager;
  readonly catAchievements: AchievementManager;
  readonly gameStats: GameStats;
  readonly onOpenHumanBoxes?: () => void;
  readonly onOpenCatBoxes?: () => void;
  readonly mouseX: number;
  readonly mouseY: number;
}

export class MenusKit {
  readonly inventoryPanel: InventoryPanel;
  readonly gearPanel = new GearPanel();
  readonly pauseMenu = new PauseMenu();
  readonly levelUpDialog = new LevelUpDialog();
  readonly rewardGrantedDialog = new RewardGrantedDialog();
  readonly skillBookPrompt = new SkillBookPrompt();
  readonly hotbarToast = new HotbarToast();

  private readonly world: SceneWorld;
  private readonly abilityManager: AbilityManager;
  private readonly onOverlayRaised: (() => void) | null;
  private readonly onPotionDrunk: ((id: ItemId, drinker: HumanPlayer | CatPlayer) => void) | null;
  /**
   * When set, the bag shows this crawler's pack rather than the active one's —
   * how the pause menu offers the companion's inventory without switching to
   * them.
   */
  private inventoryOverridePlayer: HumanPlayer | CatPlayer | null = null;
  private delayedSounds: DelayedSound[] = [];
  /**
   * A skill book asked for, and who asked, held together in one field because
   * they have to agree: a hotbar key acts on the active crawler while a bag
   * click acts on whoever's bag is on screen, and those differ while the
   * companion's inventory is being managed. Two fields could half-update and
   * charge the read to the wrong pack.
   */
  private queuedRead: { request: SkillBookReadRequest; reader: HumanPlayer | CatPlayer } | null =
    null;
  /** The crawler an open prompt will charge, pinned when it opened. */
  private skillBookReader: HumanPlayer | CatPlayer | null = null;

  constructor(deps: MenusKitDeps) {
    this.world = deps.world;
    this.abilityManager = deps.abilityManager;
    this.onOverlayRaised = deps.onOverlayRaised ?? null;
    this.onPotionDrunk = deps.onPotionDrunk ?? null;
    this.inventoryPanel =
      deps.inventoryInteraction === undefined
        ? new InventoryPanel()
        : new InventoryPanel(deps.inventoryInteraction);

    const audio = deps.world.audio;
    this.pauseMenu.audio = audio;
    this.levelUpDialog.audio = audio;
    this.rewardGrantedDialog.audio = audio;
    this.skillBookPrompt.audio = audio;
  }

  /** True while a pausing overlay owns the screen and every raw pointer path must stop. */
  get isOverlayBlockingPointer(): boolean {
    return (
      this.skillBookPrompt.isOpen ||
      this.levelUpDialog.isShowing ||
      this.rewardGrantedDialog.isShowing
    );
  }

  update(): void {
    this.hotbarToast.update();
    this.levelUpDialog.update();
    this.rewardGrantedDialog.update();
    this.tickDelayedSounds();
  }

  dispose(): void {
    this.hotbarToast.clear();
  }

  /** Announces something in the toast strip above the hotbar. */
  announce(message: string): void {
    this.hotbarToast.show(message);
  }

  /**
   * Closes both panels, so an overlay that takes the screen replaces them rather
   * than stacking on top of their slots.
   */
  closePanels(): void {
    this.closeInventory();
    this.gearPanel.isOpen = false;
  }

  /**
   * Shuts the bag through the panel's own teardown, which is what drops the
   * `returnToMenuCallback` and the companion override with it. Setting `isOpen`
   * directly leaves both behind, and the next press of `i` then opens on the
   * companion's pack.
   */
  private closeInventory(): void {
    if (this.inventoryPanel.isOpen) this.inventoryPanel.toggle();
  }

  toggleInventory(): void {
    this.inventoryPanel.toggle();
    if (!this.inventoryPanel.isOpen) return;
    this.pauseMenu.close();
    this.gearPanel.isOpen = false;
  }

  toggleGear(): void {
    this.gearPanel.toggle();
    if (!this.gearPanel.isOpen) return;
    this.pauseMenu.close();
    this.closeInventory();
  }

  /**
   * Drops whatever the bag has in flight, for when a pausing overlay takes the
   * screen. The overlays' pointer guard blocks the mouse-up that would otherwise
   * resolve a drag, so without this the ghost item survives the overlay and the
   * *next* mouse-up drops it into whatever slot the cursor is over.
   */
  cancelInventoryDragForOverlay(): void {
    this.inventoryPanel.interaction.cancelDrag();
    this.onOverlayRaised?.();
  }

  /** Whose pack the bag is showing: an override picked from the pause menu, or the active crawler. */
  inventoryPlayer(): HumanPlayer | CatPlayer {
    return this.inventoryOverridePlayer ?? this.world.pm.active();
  }

  /**
   * Opens the bag on `player`'s pack, with a way back to the pause menu it was
   * opened from.
   */
  openInventoryFor(player: HumanPlayer | CatPlayer, returnToMenu: () => void): void {
    this.pauseMenu.close();
    this.inventoryOverridePlayer = player;
    this.inventoryPanel.isOpen = true;
    this.inventoryPanel.returnToMenuCallback = () => {
      this.clearInventoryOverride();
      this.inventoryPanel.isOpen = false;
      returnToMenu();
    };
    this.inventoryPanel.onClose = () => this.clearInventoryOverride();
  }

  private clearInventoryOverride(): void {
    this.inventoryOverridePlayer = null;
  }

  skillBookFlowHost(): SkillBookFlowHost {
    return {
      audio: this.world.audio,
      announce: (message) => this.announce(message),
      prompt: this.skillBookPrompt,
      // The drag is dropped alongside: the overlays' pointer guard blocks the
      // mouse-up that would otherwise resolve one still in flight.
      showReward: (reward) => {
        this.cancelInventoryDragForOverlay();
        this.rewardGrantedDialog.enqueue(reward);
      },
      showLevelUp: (entry) => {
        this.cancelInventoryDragForOverlay();
        this.levelUpDialog.enqueue(entry);
      },
      closeInventory: () => this.closeInventory(),
    };
  }

  /**
   * Queues a read rather than performing one: a skill book is spent for good, so
   * every route to one — hotbar key, hotbar tap, bag click — asks first.
   */
  queueSkillBookRead(request: SkillBookReadRequest, reader: HumanPlayer | CatPlayer): void {
    this.queuedRead = { request, reader };
  }

  /**
   * Raises whatever read the bag or the hotbar queued. Drained from `update`
   * rather than at the click, because the prompt it opens is itself one of the
   * gates that stops the frame.
   */
  openPendingSkillBookPrompt(fallbackReader: HumanPlayer | CatPlayer): void {
    // The bag's own queue carries no reader — a click there is by definition
    // aimed at whichever pack is on screen — so it is paired here rather than
    // inheriting whoever a previous hotbar press happened to pin.
    const interaction = this.inventoryPanel.interaction;
    const fromPanel = interaction.pendingSkillBookRead;
    if (fromPanel !== null) {
      interaction.pendingSkillBookRead = null;
      this.queuedRead = { request: fromPanel, reader: fallbackReader };
    }

    const queued = this.queuedRead;
    if (queued === null) return;
    this.queuedRead = null;
    // The click that queued this also left a drag half-started on the slot
    // underneath the prompt about to cover it.
    interaction.cancelDrag();
    this.onOverlayRaised?.();
    promptSkillBookRead(this.skillBookFlowHost(), queued.reader, queued.request);
    // A refused read never opens the prompt, so there is nothing to pin.
    this.skillBookReader = this.skillBookPrompt.isOpen ? queued.reader : null;
  }

  /** The crawler an open read prompt belongs to, or `fallback` when none was pinned. */
  pendingSkillBookReader(fallback: HumanPlayer | CatPlayer): HumanPlayer | CatPlayer {
    return this.skillBookReader ?? fallback;
  }

  releaseSkillBookReader(): void {
    this.skillBookReader = null;
  }

  /**
   * Drinks one `id` from `drinker`'s pack.
   *
   * The single place a potion goes down, so the hotbar, the potion key and the
   * bag's Drink entry cannot drift on cooldowns, refusals, sounds, or what the
   * effect announces — in either scene.
   *
   * @param bottle Which stack to spend, or null for the first one anywhere. A
   *   click names one because the same potion often sits in both containers, and
   *   it should be the stack the player pointed at that goes down.
   * @returns whether the potion was actually swallowed. A refusal has already
   *   been sounded by the time this returns false.
   */
  drinkPotion(drinker: HumanPlayer | CatPlayer, id: ItemId, bottle: PotionSlot | null): boolean {
    const swallowed = this.pourPotion(drinker, id, bottle);
    if (swallowed) this.onPotionDrunk?.(id, drinker);
    return swallowed;
  }

  private pourPotion(
    drinker: HumanPlayer | CatPlayer,
    id: ItemId,
    bottle: PotionSlot | null,
  ): boolean {
    const audio = this.world.audio;
    const consume = (): boolean =>
      bottle === null
        ? drinker.inventory.removeOne(id)
        : drinker.inventory.removeOneFromSlot(bottle.source, bottle.slotIdx, id);

    if (id === 'health_potion') {
      if (drinker.potionCooldownFrames > 0) {
        audio?.play('error_taking_action');
        return false;
      }
      const hpBefore = drinker.hp;
      if (!drinker.usePotion(consume)) {
        // Almost always the full-HP refusal, which is otherwise indistinguishable
        // from the click having missed the menu entirely.
        audio?.play('error_taking_action');
        return false;
      }
      this.world.bus.emit('healingPotionUsed', {
        player: drinker === this.world.pm.human ? 'Human' : 'Cat',
        hpRestored: drinker.hp - hpBefore,
      });
      this.showPotionEffectNotice(id);
      return true;
    }

    if (id === 'dirty_shirley') {
      // A bottle that would change nothing is refused before it is opened: it
      // comes out of the bag rather than off a bar, so spending one for no
      // effect costs the player twice.
      if (!drinker.dirtyShirleyWouldHelp) {
        audio?.play('error_taking_action');
        return false;
      }
      if (!consume()) return false;
      drinker.drinkDirtyShirley();
      this.playDrinkSounds('healing_potion');
      this.showPotionEffectNotice(id);
      return true;
    }

    if (id === 'stat_boost_potion') {
      if (!consume()) return false;
      const { stat, amount } = drinker.applyStatBoost();
      this.playDrinkSounds('stat_boost');
      this.announce(statBoostNotice(stat, amount));
      return true;
    }

    // Silent, not a buzz: a drinkable with no timed effect is a content gap
    // rather than the player having asked for something impossible.
    const timed = TIMED_POTIONS[id];
    if (timed === undefined) return false;
    // Refusing rather than refreshing: a second bottle poured over a running one
    // is coins for nothing.
    if (drinker.hasStatus(id)) {
      audio?.play('error_taking_action');
      return false;
    }
    if (!consume()) return false;
    timed.activate(drinker);
    this.playDrinkSounds(timed.effectSound);
    this.showPotionEffectNotice(id);
    return true;
  }

  /** The gulp, then the effect landing a beat later. */
  private playDrinkSounds(effectSound: SoundId): void {
    this.world.audio?.play('potion_drink');
    this.delayedSounds.push({ id: effectSound, framesLeft: POTION_EFFECT_SOUND_DELAY });
  }

  private showPotionEffectNotice(id: ItemId): void {
    const notice = potionEffectNotice(id);
    if (notice !== null) this.announce(notice);
  }

  private tickDelayedSounds(): void {
    this.delayedSounds = this.delayedSounds.filter((pending) => {
      pending.framesLeft--;
      if (pending.framesLeft > 0) return true;
      this.world.audio?.play(pending.id);
      return false;
    });
  }

  /**
   * Everything the bag's context menu queued: a drink, an equip, an unequip, a
   * drop. Drained from the scene's frame rather than from the menu's own click
   * handler, because acting on a slot can raise an overlay over the very panel
   * that click landed in.
   *
   * @param dropLoot Where a dropped item goes. Omitted by a scene with nowhere
   *   to drop to, which simply does not offer Drop.
   */
  resolvePendingInventoryActions(
    holder: HumanPlayer | CatPlayer,
    dropLoot?: (id: ItemId, quantity: number) => void,
  ): void {
    const interaction = this.inventoryPanel.interaction;

    const bottle = interaction.pendingDrinkSlot;
    if (bottle !== null) {
      interaction.pendingDrinkSlot = null;
      this.cancelInventoryDragForOverlay();
      // Only a drink that landed sends the player back to the fight. A refusal
      // has sounded and changed nothing, so the bag stays up to be acted on
      // again. Closed through toggle() rather than the flag so the panel's own
      // teardown runs.
      if (this.drinkPotion(holder, bottle.id, bottle) && this.inventoryPanel.isOpen) {
        this.inventoryPanel.toggle();
      }
    }

    const equipSlot = interaction.pendingEquipSlot;
    if (equipSlot !== null) {
      const source = interaction.pendingEquipSource;
      interaction.pendingEquipSlot = null;
      interaction.pendingEquipSource = null;
      if (isWearable(slotContentsAt(holder, source, equipSlot))) {
        if (source === 'hotbar') holder.inventory.equipHotbarSlot(equipSlot);
        else holder.inventory.equip(equipSlot);
        holder.onEquipmentChanged();
      }
    }

    const unequipSlot = interaction.pendingUnequipSlot;
    if (unequipSlot !== null) {
      const source = interaction.pendingUnequipSource;
      interaction.pendingUnequipSlot = null;
      interaction.pendingUnequipSource = null;
      const item = slotContentsAt(holder, source, unequipSlot);
      if (isWearable(item)) {
        holder.inventory.unequip(`${item.equipSlot}:${item.equipSubSlot}`);
        holder.onEquipmentChanged();
      }
    }

    const dropped = interaction.pendingDropItem;
    if (dropped !== null) {
      interaction.pendingDropItem = null;
      this.dropItem(holder, dropped.id, dropped.quantity, dropLoot);
    }
  }

  /**
   * Takes `quantity` of `id` off `holder` and hands it to `dropLoot`. Worn gear
   * comes off first: an item dropped while equipped would otherwise keep giving
   * its bonus from the floor.
   */
  private dropItem(
    holder: HumanPlayer | CatPlayer,
    id: ItemId,
    quantity: number,
    dropLoot?: (id: ItemId, quantity: number) => void,
  ): void {
    if (dropLoot === undefined) return;
    if (holder.inventory.hasEquipped(id)) {
      const worn =
        holder.inventory.bag.slots.find((slot) => slot?.id === id) ??
        holder.inventory.actionBar.slots.find((slot) => slot?.id === id) ??
        null;
      if (isWearable(worn)) {
        holder.inventory.unequip(`${worn.equipSlot}:${worn.equipSubSlot}`);
        holder.onEquipmentChanged();
      }
    }
    holder.inventory.removeItems(id, quantity);
    dropLoot(id, quantity);
    this.world.audio?.play('menu_drop_item');
  }

  /**
   * The unspent-points banner: a click on it opens the pause menu straight to
   * the Spend screen. Reported rather than silently swallowed so the caller can
   * stop routing the click.
   */
  tryOpenSpendScreen(
    mx: number,
    my: number,
    bannerRect: { x: number; y: number; w: number; h: number },
  ): boolean {
    const { human, cat } = this.world.pm;
    if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) return false;
    if (mx < bannerRect.x || mx > bannerRect.x + bannerRect.w) return false;
    if (my < bannerRect.y || my > bannerRect.y + bannerRect.h) return false;
    this.pauseMenu.openToSpend();
    this.world.audio?.play('menu_open');
    return true;
  }

  /**
   * The pause menu with every tab it can offer — achievements, stats and the
   * ability screen included. A scene that renders it with fewer arguments gets a
   * stripped shell, which is what interiors used to show.
   */
  renderPauseMenu(ctx: CanvasRenderingContext2D, deps: PauseMenuRenderDeps): void {
    const { human, cat } = this.world.pm;
    this.pauseMenu.render(
      ctx,
      human,
      cat,
      deps.humanAchievements,
      deps.catAchievements,
      deps.onOpenHumanBoxes,
      deps.onOpenCatBoxes,
      deps.gameStats,
      this.abilityManager,
      deps.mouseX,
      deps.mouseY,
    );
  }

  /** The award stack, drawn lowest-priority first so draw order matches claim order. */
  renderOverlays(ctx: CanvasRenderingContext2D): void {
    this.skillBookPrompt.render(ctx);
    this.rewardGrantedDialog.render(ctx);
    this.levelUpDialog.render(ctx);
  }
}
