/**
 * MenusKit — the panels, overlays and hotbar every place with a player in it
 * needs: the inventory screen, the pause menu, the award stack, the toast
 * strip, and the one routine that decides what pressing a hotbar slot does.
 *
 * A scene constructs one of these and its player can spend a skill point, drag
 * an item, drink a potion and read a skill book. Every scene with a player
 * shares this one kit, so indoors and out offer the same menus and the same
 * hotbar on every platform.
 */

import type { SoundId } from '../../audio/sounds';
import type { AbilityManager } from '../../core/AbilityManager';
import { playDrinkGesture } from '../../creatures/humanGestures';
import { displayHp } from '../../core/crawlerFormulas';
import { ITEM_DEF, type InventoryItem, type ItemId } from '../../core/ItemDefs';
import { itemIsTradable } from '../../core/itemTrade';
import { CRAWLER_NAMES, type CrawlerKind } from '../../core/SkillManager';
import { POTION_EFFECT_SOUND_DELAY, TIMED_POTIONS } from '../../core/timedPotions';
import { eatFood, isFoodId } from '../../core/foods';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { partyCoins } from '../../core/partyCoins';
import { HudToasts, type ToastOptions } from '../../ui/hud/toasts';
import {
  InventoryActions,
  type PendingSlotRef,
  type SkillBookReadRequest,
} from '../../ui/screens/inventory/InventoryActions';
import { InventoryScreen } from '../../ui/screens/inventory/InventoryScreen';
import type {
  InventoryMember,
  InventoryRestrictions,
  InventoryTab,
  ItemCooldown,
} from '../../ui/screens/inventory/inventoryTypes';
import { LevelUpDialog } from '../../ui/LevelUpDialog';
import { CraftExplainers } from '../../ui/screens/dialogs/CraftExplainers';
import { RESOURCING_EXPLAINER } from '../../ui/screens/dialogs/resourcingExplainer';
import { CONSTRUCTION_EXPLAINER } from '../../ui/screens/dialogs/constructionExplainer';
import { PROCESSING_EXPLAINER } from '../../ui/screens/dialogs/processingExplainer';
import { mongoExplainerEntry } from '../../ui/screens/dialogs/mongoExplainer';
import { levelUpSurface } from '../../ui/screens/dialogs/levelUpDialog';
import { rewardGrantedSurface } from '../../ui/screens/dialogs/rewardGrantedDialog';
import { skillBookDialogSurface } from '../../ui/screens/dialogs/skillBookDialog';
import { questRewardSurface } from '../../ui/screens/dialogs/questRewardScreen';
import { ConstructionScreen } from '../../ui/screens/construction/ConstructionScreen';
import { QuantityDialog } from '../../ui/screens/dialogs/QuantityDialog';
import { potionEffectNotice, statBoostNotice } from '../../ui/potionNotices';
import { RewardGrantedDialog } from '../../ui/RewardGrantedDialog';
import { QuestRewardScreen } from '../../ui/questReward/QuestRewardScreen';
import { SkillBookPrompt } from '../../ui/SkillBookPrompt';
import {
  promptSkillBookRead,
  resolveSkillBookChoice,
  type SkillBookFlowHost,
} from '../skillBookUse';
import { UI_TAP_SOUND, type Surface } from '../../ui/core/UiRoot';
import {
  PauseScreen,
  type PauseFrame,
  type PauseRestriction,
} from '../../ui/screens/pause/PauseScreen';
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

/** What a hamburger refusal says: the one refusal with a reason worth reading. */
const ALREADY_FULL_NOTICE = "You're already full.";
const POTION_TOAST: ToastOptions = { tone: 'success', icon: 'flask' };
const TOME_TOAST: ToastOptions = { tone: 'accent', icon: 'book' };
const PACK_FULL_TOAST: ToastOptions = { tone: 'warning', icon: 'bag' };
const HOTBAR_REFUSED_TOAST: ToastOptions = { tone: 'warning', icon: 'bag' };

/** Every item gated by the potion cooldown, so each wears the same hotbar sweep. */
const POTION_COOLDOWN_ITEMS: readonly ItemId[] = ['health_potion', 'hollow_stew'];

/** A cue waiting out its beat behind the gulp that earned it. */
interface DelayedSound {
  readonly id: SoundId;
  framesLeft: number;
}

export interface MenusKitDeps {
  readonly world: SceneWorld;
  readonly abilityManager: AbilityManager;
  /**
   * The tutorial's narrowing of the bag while a step steers a drag. Absent
   * everywhere else, which is what leaves the bag fully usable.
   */
  readonly inventoryRestrictions?: () => InventoryRestrictions;
  /** A blocked item was dragged somewhere other than home: the tutorial's cue. */
  readonly onBlockedInventoryDrag?: () => void;
  /** The one crawler whose pack the inventory may show while a tutorial step asks for it, or null. */
  readonly inventoryCrawlerLock?: () => CrawlerKind | null;
  /**
   * Called after a bottle actually goes down, for the achievements a scene ties
   * to drinking one *where it was poured*.
   */
  readonly onPotionDrunk?: (id: ItemId, drinker: HumanPlayer | CatPlayer) => void;
}

/** What the kit's surfaces need from the scene that mounts them. */
export interface MenusSurfaceHooks {
  /** The scene's achievements, stats and loot-box openers the pause screen draws from. */
  readonly pauseFrame: () => PauseFrame;
  /** Closes the pause menu the way the scene's pause key does, with its side effects. */
  readonly togglePause: () => void;
  /**
   * Drains what a click on the picker or the bag's context menu queued (a
   * drink, a drop, a trade) with the scene's drop target. Omitted by a scene
   * that drains them every frame instead.
   */
  readonly resolveInventoryActions?: () => void;
  /** The tutorial step that allows only one crawler's inventory in the pause screen, or null. */
  readonly pauseRestriction?: () => PauseRestriction | null;
}

export class MenusKit {
  /** The item menu's entries and the `pending*` hand-off the scene resolves. */
  readonly inventoryActions = new InventoryActions();
  /** The bag and character screen: I opens its Bag tab, G its Character tab. */
  readonly inventoryScreen: InventoryScreen;
  /**
   * Cooldowns still running, keyed by ability id or, for a plain item with a
   * cooldown of its own (the Wayfinder's Anchor), by item id. The scene fills
   * it each frame; the HUD hotbar and the inventory's hotbar row both read it.
   */
  readonly itemCooldowns = new Map<string, ItemCooldown>();
  readonly pauseScreen: PauseScreen;
  readonly levelUpDialog = new LevelUpDialog();
  readonly rewardGrantedDialog = new RewardGrantedDialog();
  /**
   * The quest-complete screen every quest asks for through `questRewardShown`.
   * It waits for every other halt before going up, so anything raised after
   * it — an ability level-up, a granted reward card — lands while it is open.
   * Ranked above those in both scenes' claims and drawn over them, so the
   * screen the player is reading keeps the keyboard and the clicks until it
   * is dismissed, and the card underneath follows.
   */
  readonly questReward: QuestRewardScreen;
  readonly skillBookPrompt = new SkillBookPrompt();
  readonly toasts = new HudToasts();
  /**
   * The "how it works" explainers: the craft skills' and processing's, opened
   * from the Crafts tab and by the teachers, and Mongo's, opened when he joins
   * and from the pause menu.
   */
  readonly craftExplainers = new CraftExplainers();
  /**
   * The Construction menu. Held here rather than by the village because both
   * scenes open it — indoors the outdoor-only kinds are refused — and
   * whichever scene is live supplies what it lists.
   */
  readonly constructionMenu: ConstructionScreen;
  /**
   * "How many?" for the bag's Drop and Trade entries, shared with every other
   * quantity picker in the game rather than the bag rolling its own — a
   * digit typed into it edits the amount directly, the same as anywhere else
   * one of these opens.
   */
  readonly itemQuantityDialog: QuantityDialog;

  /**
   * What the bag menu's `menuUseLabel` entry does, set by the scene: exactly
   * what a hotbar press of the item does there, made by the active crawler even
   * when the bag on screen is the companion's. The use moves the party (the
   * anchor's trip), and a channel cast by the crawler the player is not
   * controlling is given up on its first tick as a crawler switch. Null where
   * no item has a use.
   */
  useSceneItem: ((item: InventoryItem) => void) | null = null;

  private readonly world: SceneWorld;
  private readonly abilityManager: AbilityManager;
  private readonly onPotionDrunk: ((id: ItemId, drinker: HumanPlayer | CatPlayer) => void) | null;
  /** Drains what an item action queued, set by the scene that mounts the surfaces. */
  private resolveInventoryActions: (() => void) | null = null;
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
    this.onPotionDrunk = deps.onPotionDrunk ?? null;
    this.inventoryScreen = this.buildInventoryScreen(deps);

    const audio = deps.world.audio;
    this.craftExplainers.register('resourcing', RESOURCING_EXPLAINER);
    this.craftExplainers.register('construction', CONSTRUCTION_EXPLAINER);
    this.craftExplainers.register('processing', PROCESSING_EXPLAINER);
    this.craftExplainers.register(
      'mongo',
      mongoExplainerEntry(() => this.abilityManager.getLevel('mongo')),
    );
    this.constructionMenu = new ConstructionScreen(audio, {
      notify: (message) => this.announce(message),
    });
    this.pauseScreen = new PauseScreen({
      party: () => this.world.pm,
      abilities: this.abilityManager,
      audio,
      guides: {
        mongo: () => void this.craftExplainers.open('mongo'),
        craft: (id) => void this.craftExplainers.open(id),
        processing: () => void this.craftExplainers.open('processing'),
      },
    });
    this.levelUpDialog.audio = audio;
    this.rewardGrantedDialog.audio = audio;
    this.skillBookPrompt.audio = audio;
    this.questReward = new QuestRewardScreen(audio);
    deps.world.bus.on('questRewardShown', (spec) => this.questReward.enqueue(spec));

    this.itemQuantityDialog = new QuantityDialog(audio);
    this.inventoryActions.canTradeItem = (item) => this.itemIsTradableNow(item);
  }

  private buildInventoryScreen(deps: MenusKitDeps): InventoryScreen {
    const { pm } = this.world;
    const member = (kind: CrawlerKind): InventoryMember =>
      kind === 'human'
        ? {
            id: 'human',
            name: CRAWLER_NAMES.human,
            owner: pm.human,
            wieldedWeaponId: pm.human.wieldedWeaponId,
          }
        : { id: 'cat', name: CRAWLER_NAMES.cat, owner: pm.cat };
    const restrictions = deps.inventoryRestrictions;
    return new InventoryScreen({
      actions: this.inventoryActions,
      party: () => {
        const locked = deps.inventoryCrawlerLock?.() ?? null;
        if (locked !== null) return [member(locked)];
        const active: CrawlerKind = pm.active() === pm.human ? 'human' : 'cat';
        return [member(active), member(active === 'human' ? 'cat' : 'human')];
      },
      coins: () => partyCoins(pm.human, pm.cat),
      coinSplit: () =>
        `${CRAWLER_NAMES.human} ${pm.human.coins} · ${CRAWLER_NAMES.cat} ${pm.cat.coins}`,
      cooldownFor: (item) => this.itemCooldowns.get(item.abilityId ?? item.id) ?? null,
      restrictions: restrictions === undefined ? undefined : () => restrictions(),
      onBlockedDrag: () => deps.onBlockedInventoryDrag?.(),
      onHotbarRefused: (_item, reason) => this.announce(reason, HOTBAR_REFUSED_TOAST),
      onActionQueued: () => this.resolveInventoryActions?.(),
      // "How many?" is opened from an item action, not drawn by the screen, so
      // it has to close alongside it rather than survive underneath.
      onClosed: () => this.itemQuantityDialog.close(),
    });
  }

  /**
   * True while a reward or level-up announcement is up. Both draw over the
   * explainers, so Escape pressed under one of them is not aimed at one.
   */
  get isAwardStackShowing(): boolean {
    return (
      this.questReward.isOpen || this.levelUpDialog.isShowing || this.rewardGrantedDialog.isShowing
    );
  }

  update(): void {
    this.toasts.update();
    this.levelUpDialog.update();
    this.rewardGrantedDialog.update();
    this.updateQuestReward();
    this.syncItemQuantityPrompt();
    this.tickDelayedSounds();
  }

  /** Raises the next queued quest-complete screen when it is clear to go up. */
  private updateQuestReward(): void {
    this.questReward.update();
  }

  /**
   * Raises the shared quantity picker when the bag queued a Drop or Trade
   * against a stack bigger than one, so both actions ask "how many?" through
   * the same widget instead of each owning a bespoke one.
   */
  private syncItemQuantityPrompt(): void {
    if (this.itemQuantityDialog.isOpen) return;
    const actions = this.inventoryActions;
    const prompt = actions.pendingQuantityPrompt;
    if (prompt === null) return;
    actions.pendingQuantityPrompt = null;
    this.itemQuantityDialog.open({
      title: prompt.kind === 'drop' ? `Drop ${prompt.itemName}` : `Trade ${prompt.itemName}`,
      max: prompt.maxQty,
      initial: 1,
      unitLabel: prompt.itemName,
      confirmLabel: prompt.kind === 'drop' ? 'Drop' : 'Trade',
      onConfirm: (qty) => {
        if (prompt.kind === 'drop') {
          actions.pendingDropItem = { id: prompt.id, quantity: qty };
        } else {
          actions.pendingTradeItem = { id: prompt.id, quantity: qty };
        }
      },
      onCancel: () => undefined,
    });
  }

  dispose(): void {
    this.toasts.clear();
    // An armed key chip would otherwise eat the first key of the next scene.
    this.pauseScreen.rebind.reset();
  }

  /** Announces something in the toast strip above the hotbar. */
  announce(message: string, opts?: ToastOptions): void {
    this.toasts.post(message, opts);
  }

  /** Closes the inventory, so an overlay that takes the screen replaces it rather than stacking on it. */
  closePanels(): void {
    this.inventoryScreen.close();
  }

  /** I: shows the Bag tab, or closes the screen when it is already showing. */
  toggleInventory(): void {
    this.toggleInventoryTab('bag');
  }

  /** G: shows the Character tab, or closes the screen when it is already showing. */
  toggleGear(): void {
    this.toggleInventoryTab('character');
  }

  private toggleInventoryTab(tab: InventoryTab): void {
    this.inventoryScreen.toggle(tab);
    if (this.inventoryScreen.isOpen) this.pauseScreen.close();
  }

  /** Whose pack the inventory is showing: the crawler picked in its header, or the active one. */
  inventoryPlayer(): HumanPlayer | CatPlayer {
    const { pm } = this.world;
    const shown = this.inventoryScreen.isOpen ? this.inventoryScreen.member() : null;
    if (shown === null) return pm.active();
    return shown.id === 'human' ? pm.human : pm.cat;
  }

  /** The weapon the bag's owner is holding, for the hotbar's in-hand badge. */
  inventoryWieldedWeaponId(): ItemId | null {
    const holder = this.inventoryPlayer();
    return holder instanceof HumanPlayer ? holder.wieldedWeaponId : null;
  }

  skillBookFlowHost(): SkillBookFlowHost {
    return {
      audio: this.world.audio,
      announce: (message) => this.announce(message),
      prompt: this.skillBookPrompt,
      showReward: (reward) => this.rewardGrantedDialog.enqueue(reward),
      showLevelUp: (entry) => this.levelUpDialog.enqueue(entry),
      closeInventory: () => this.inventoryScreen.close(),
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
    const actions = this.inventoryActions;
    const fromPanel = actions.pendingSkillBookRead;
    if (fromPanel !== null) {
      actions.pendingSkillBookRead = null;
      this.queuedRead = { request: fromPanel, reader: fallbackReader };
    }

    const queued = this.queuedRead;
    if (queued === null) return;
    this.queuedRead = null;
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
    if (swallowed) {
      this.onPotionDrunk?.(id, drinker);
      playDrinkGesture(drinker);
    }
    return swallowed;
  }

  private pourPotion(
    drinker: HumanPlayer | CatPlayer,
    id: ItemId,
    bottle: PotionSlot | null,
  ): boolean {
    const audio = this.world.audio;
    if (!drinker.canAct) {
      audio?.play('error_taking_action');
      return false;
    }
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
        hpRestored: displayHp(drinker.hp) - displayHp(hpBefore),
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
      this.announce(statBoostNotice(stat, amount), POTION_TOAST);
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

  /**
   * Eats one `id` from `eater`'s pack — the single place food goes down, so the
   * bag's Eat entry, a long-press menu and a hotbar key cannot drift on
   * refusals, sounds or what the meal announces.
   *
   * Hollow Stew is a potion in everything but its sound: it answers to the same
   * cooldown and raises the same `healingPotionUsed`, so every listener that
   * counts potions counts the stew too.
   *
   * @param dish Which stack to spend, or null for the first one anywhere.
   * @returns whether the food was actually eaten. A refusal has already been
   *   sounded by the time this returns false.
   */
  eatFood(eater: HumanPlayer | CatPlayer, id: ItemId, dish: PotionSlot | null): boolean {
    const audio = this.world.audio;
    if (!isFoodId(id)) return false;
    const consume = (): boolean =>
      dish === null
        ? eater.inventory.removeOne(id)
        : eater.inventory.removeOneFromSlot(dish.source, dish.slotIdx, id);
    const hpBefore = eater.hp;
    const outcome = eatFood(eater, id, consume);

    if (outcome !== 'eaten') {
      audio?.play('error_taking_action');
      if (outcome === 'full' && id === 'hamburger') this.announce(ALREADY_FULL_NOTICE);
      if (outcome === 'cooldown' && id === 'hollow_stew') {
        this.world.bus.emit('stewRefusedOnCooldown', { eater });
      }
      return false;
    }

    if (id === 'hamburger') {
      audio?.play('bopca_eating');
    } else {
      audio?.play('slurping_soup');
      this.world.bus.emit('healingPotionUsed', {
        player: eater === this.world.pm.human ? 'Human' : 'Cat',
        hpRestored: displayHp(eater.hp) - displayHp(hpBefore),
      });
      // A bowl tipped to the mouth: the closest gesture Carl has to a spoon.
      playDrinkGesture(eater);
    }
    this.showPotionEffectNotice(id);
    return true;
  }

  /**
   * Feeds the hotbar's cooldown sweep for every item that answers to the
   * potion cooldown, read off `holder` — the crawler whose hotbar is on screen.
   * Stew and potions share one timer, so they wear the same sweep.
   */
  syncPotionCooldownOverlay(holder: HumanPlayer | CatPlayer): void {
    const overlay = {
      current: holder.potionCooldownFrames,
      max: Math.max(1, holder.computePotionCooldown()),
    };
    for (const id of POTION_COOLDOWN_ITEMS) {
      this.itemCooldowns.set(id, overlay);
    }
  }

  /**
   * Studies one tome from `reader`'s pack, spending it for the Explosives
   * Handling it teaches. Only the human can study one; the cat is refused and
   * keeps nothing, since the tome can never reach her pack in the first place.
   */
  private studyTome(reader: HumanPlayer | CatPlayer, tome: PotionSlot & { id: ItemId }): void {
    const audio = this.world.audio;
    const levels = ITEM_DEF[tome.id].explosivesHandlingLevels;
    if (levels === undefined || !(reader instanceof HumanPlayer)) {
      audio?.play('error_taking_action');
      return;
    }
    if (!reader.inventory.removeOneFromSlot(tome.source, tome.slotIdx, tome.id)) return;
    reader.explosivesHandling += levels;
    audio?.play('menu_skillpoint_spent');
    this.announce(`Explosives Handling is now level ${reader.explosivesHandling}.`, TOME_TOAST);
  }

  /** The gulp, then the effect landing a beat later. */
  private playDrinkSounds(effectSound: SoundId): void {
    this.world.audio?.play('potion_drink');
    this.delayedSounds.push({ id: effectSound, framesLeft: POTION_EFFECT_SOUND_DELAY });
  }

  private showPotionEffectNotice(id: ItemId): void {
    const notice = potionEffectNotice(id);
    if (notice !== null) this.announce(notice, POTION_TOAST);
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
   * Everything an item action in the inventory screen queued: a drink, a meal,
   * an equip, an unequip, a drop, a trade. Two routes drain it: the dungeon
   * resolves it as soon as the screen queues an action (`onActionQueued`, and
   * the quantity dialog's `afterChoice`), and the interior resolves it once a
   * frame from its update. Neither acts inside the screen's own tap, because
   * acting on a slot can raise an overlay over the very panel that tap landed in.
   *
   * @param dropLoot Where a dropped item goes. Omitted by a scene with nowhere
   *   to drop to, which simply does not offer Drop.
   */
  resolvePendingInventoryActions(
    holder: HumanPlayer | CatPlayer,
    dropLoot?: (id: ItemId, quantity: number) => void,
  ): void {
    const actions = this.inventoryActions;

    const bottle = actions.pendingDrinkSlot;
    if (bottle !== null) {
      actions.pendingDrinkSlot = null;
      // Only a drink that landed sends the player back to the fight. A refusal
      // has sounded and changed nothing, so the bag stays up to be acted on again.
      if (this.drinkPotion(holder, bottle.id, bottle)) this.inventoryScreen.close();
    }

    const dish = actions.pendingEatSlot;
    if (dish !== null) {
      actions.pendingEatSlot = null;
      // Same rule as a drink: only a meal that went down closes the bag.
      if (this.eatFood(holder, dish.id, dish)) this.inventoryScreen.close();
    }

    const tome = actions.pendingStudySlot;
    if (tome !== null) {
      actions.pendingStudySlot = null;
      this.studyTome(holder, tome);
    }

    const used = actions.pendingUseSlot;
    if (used !== null) {
      actions.pendingUseSlot = null;
      this.useFromMenu(holder, used);
    }

    const equipSlot = actions.pendingEquipSlot;
    if (equipSlot !== null) {
      const source = actions.pendingEquipSource;
      actions.pendingEquipSlot = null;
      actions.pendingEquipSource = null;
      // A refusal — wrong wearer, or the same id already worn elsewhere — must
      // not announce a change that never happened.
      if (source === 'hotbar') {
        if (holder.inventory.canEquipHotbarSlot(equipSlot)) {
          holder.inventory.equipHotbarSlot(equipSlot);
          holder.onEquipmentChanged();
        }
      } else if (holder.inventory.canEquipSlot(equipSlot)) {
        holder.inventory.equip(equipSlot);
        holder.onEquipmentChanged();
      }
    }

    const unequipSlot = actions.pendingUnequipSlot;
    if (unequipSlot !== null) {
      const source = actions.pendingUnequipSource;
      actions.pendingUnequipSlot = null;
      actions.pendingUnequipSource = null;
      const item = slotContentsAt(holder, source, unequipSlot);
      if (item !== null && holder.inventory.unequipById(item.id) !== null) {
        holder.onEquipmentChanged();
      }
    }

    const dropped = actions.pendingDropItem;
    if (dropped !== null) {
      actions.pendingDropItem = null;
      this.dropItem(holder, dropped.id, dropped.quantity, dropLoot);
    }

    const traded = actions.pendingTradeItem;
    if (traded !== null) {
      actions.pendingTradeItem = null;
      this.tradeItem(holder, traded.id, traded.quantity);
    }
  }

  /**
   * Runs the scene's use of the item the menu was opened on, held to the same
   * gate a hotbar press is: when the active crawler cannot act, it buzzes
   * instead. The slot is re-read because the menu is resolved a frame later
   * indoors, and an item moved off it in between is no longer the one the
   * player pointed at.
   */
  private useFromMenu(holder: HumanPlayer | CatPlayer, used: PendingSlotRef): void {
    const item = slotContentsAt(holder, used.source, used.slotIdx);
    if (item?.id !== used.id) return;
    if (!this.world.pm.active().canAct) {
      this.world.audio?.play('error_taking_action');
      return;
    }
    this.useSceneItem?.(item);
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
    // Clamped to what is still held: the quantity dialog confirms on a later
    // frame than the tap that opened it, and the stack may have shrunk since.
    const drop = Math.min(quantity, holder.inventory.countOf(id));
    if (drop <= 0) return;
    if (holder.inventory.unequipById(id) !== null) holder.onEquipmentChanged();
    holder.inventory.removeItems(id, drop);
    // A weapon thrown on the floor is out of hand, for the same reason worn gear
    // is taken off: it would otherwise keep firing from where it landed.
    holder.onInventoryChanged();
    dropLoot(id, drop);
    this.world.audio?.play('menu_drop_item');
  }

  /** `holder`'s partner: whichever of the two crawlers isn't `holder`. */
  private partnerOf(holder: HumanPlayer | CatPlayer): HumanPlayer | CatPlayer {
    return holder === this.world.pm.human ? this.world.pm.cat : this.world.pm.human;
  }

  /**
   * Whether the bag's current owner could hand `item` to their partner right
   * now — the context menu's Trade eligibility test, wired once here rather
   * than at each place the menu is opened.
   */
  private itemIsTradableNow(item: InventoryItem): boolean {
    const partner = this.partnerOf(this.inventoryPlayer());
    return itemIsTradable(item, partner instanceof HumanPlayer ? 'human' : 'cat');
  }

  /**
   * Hands up to `quantity` of `id` from `holder`'s pack to their partner's.
   * Worn gear comes off first, the same rule {@link dropItem} follows, so a
   * traded piece can't keep paying out its bonus from a slot it just left.
   * Refused whole — nothing is removed — when the partner's pack has no room
   * for it, so a full bag never costs the sender the item.
   *
   * Clamped to what `holder` still actually holds: the picker's confirm fires
   * on a later frame than the click that opened it, and something else
   * (a potion drunk, a tool spent) can have eaten into the stack in between.
   * Handing the partner the picker's stale, higher number would mint items
   * out of nothing.
   */
  private tradeItem(holder: HumanPlayer | CatPlayer, id: ItemId, quantity: number): void {
    const heldQuantity = holder.inventory.countOf(id);
    const trade = Math.min(quantity, heldQuantity);
    if (trade <= 0) return;
    const partner = this.partnerOf(holder);
    if (!partner.inventory.hasRoomFor(id)) {
      const partnerName = partner === this.world.pm.human ? CRAWLER_NAMES.human : CRAWLER_NAMES.cat;
      this.announce(`${partnerName}'s pack is full.`, PACK_FULL_TOAST);
      this.world.audio?.play('error_taking_action');
      return;
    }
    if (holder.inventory.unequipById(id) !== null) holder.onEquipmentChanged();
    holder.inventory.removeItems(id, trade);
    holder.onInventoryChanged();
    partner.inventory.addItem(id, trade);
    partner.onInventoryChanged();
    this.world.audio?.play(UI_TAP_SOUND);
  }

  /**
   * Opens the Spend section, where unspent skill points go. Does nothing while
   * neither crawler has any. Returns whether it opened.
   */
  openSpendScreen(): boolean {
    const { human, cat } = this.world.pm;
    if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) return false;
    this.pauseScreen.open('character');
    this.world.audio?.play('menu_open');
    return true;
  }

  /**
   * The kit's overlays as surfaces: the inventory screen, the award stack,
   * the explainers, the skill-book prompt, the item picker and the pause
   * menu. The hotbar is drawn with the scene's HUD, and the construction menu
   * with whoever lists its options, so the scene mounts those itself.
   *
   * The quest-complete screen stays above any level-up or reward card raised
   * while it is open, and a level-up above any reward card: a card counts as
   * open only once nothing it queues behind is showing. The skill-book prompt
   * is mounted ahead of the explainers, so an explainer raised on the same
   * frame stacks over it.
   */
  surfaces(hooks: MenusSurfaceHooks): Surface[] {
    const explainerWantsEscape = (): boolean => !this.isAwardStackShowing;
    this.resolveInventoryActions = hooks.resolveInventoryActions ?? null;
    return [
      this.inventoryScreen.surface,
      questRewardSurface(this.questReward, { id: 'quest-reward' }),
      levelUpSurface('level-up', this.levelUpDialog, {
        shownWhen: () => !this.questReward.isOpen,
      }),
      rewardGrantedSurface('reward-granted', this.rewardGrantedDialog, {
        shownWhen: () => !this.levelUpDialog.isShowing && !this.questReward.isOpen,
      }),
      skillBookDialogSurface('skill-book-prompt', this.skillBookPrompt, {
        resolve: (choice) => {
          const reader = this.pendingSkillBookReader(this.inventoryPlayer());
          resolveSkillBookChoice(this.skillBookFlowHost(), reader, choice);
          this.releaseSkillBookReader();
        },
        dismiss: () => {
          this.skillBookPrompt.close();
          this.releaseSkillBookReader();
        },
      }),
      this.craftExplainers.surface({ id: 'craft-explainers', wantsEscape: explainerWantsEscape }),
      this.itemQuantityDialog.surface('item-picker', hooks.resolveInventoryActions),
      this.pauseScreen.surface({
        frame: hooks.pauseFrame,
        onEscape: hooks.togglePause,
        openInventory: (crawler) => this.openInventoryFromPause(crawler),
        restriction: hooks.pauseRestriction,
      }),
      ...this.pauseScreen.confirmSurfaces(),
    ];
  }

  /**
   * Opens the inventory on `crawler`'s pack (the active crawler's when null),
   * with a way back to the pause screen it was opened from.
   */
  private openInventoryFromPause(crawler: CrawlerKind | null): void {
    this.pauseScreen.close();
    this.inventoryScreen.open({
      tab: 'bag',
      member: crawler ?? undefined,
      onBack: () => this.pauseScreen.open(),
    });
  }
}
