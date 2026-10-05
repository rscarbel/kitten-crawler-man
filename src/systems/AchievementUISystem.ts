/**
 * Owns all achievement/loot-box UI state: the notification queue, what the
 * HUD's achievement chip and safe-room banner show, and the loot-box-opener
 * lifecycle.
 */

import type { AchievementManager, BoxContents, LootBox } from '../core/AchievementManager';
import type { AchievementDef } from '../core/AchievementManager';
import { ACHIEVEMENT_DEFS, getBoxContents } from '../core/AchievementManager';
import type { ItemId } from '../core/ItemDefs';
import { AchievementNotification } from '../ui/AchievementNotification';
import { LootBoxOpener } from '../ui/LootBoxOpener';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AudioManager } from '../audio/AudioManager';
import { isItemId } from '../core/ItemDefs';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { ITEM_DEF } from '../core/ItemDefs';
import type { RewardFlySystem } from './RewardFlySystem';
import { keybindings } from '../core/Keybindings';
import { ACTIVATE_KEYS, UI_TAP_SOUND, type Surface } from '../ui/core/UiRoot';
import type { LootBannerModel } from '../ui/hud/hudModel';

interface QueueEntry {
  def: AchievementDef;
  mgr: AchievementManager;
  player: 'Human' | 'Cat';
}

export class AchievementUISystem {
  private readonly achievementNotif = new AchievementNotification();
  readonly lootBoxOpener = new LootBoxOpener();

  private _notifActive = false;
  private _notifQueue: QueueEntry[] = [];

  /**
   * When set, called once after every pending loot box queue has been fully opened.
   * Cleared after first call. Used by the tutorial to give tutorial items and advance
   * state immediately after the normal loot box opener finishes.
   */
  onAllBoxesOpened: (() => void) | null = null;

  /**
   * Called with an achievement item reward the winner's bag has no space for.
   * The scene drops it at their feet instead; without this the reward would be
   * swallowed by `Inventory.addItem` and the achievement could never pay out
   * again.
   */
  onRewardOverflow:
    ((player: HumanPlayer | CatPlayer, id: ItemId, quantity: number) => void) | null = null;

  constructor(
    private readonly humanAchievements: AchievementManager,
    private readonly catAchievements: AchievementManager,
    private readonly human: HumanPlayer,
    private readonly cat: CatPlayer,
    private readonly rewardFly: RewardFlySystem,
    private readonly audio: AudioManager | null = null,
  ) {
    this.lootBoxOpener.setAudio(audio);
  }

  /** True when a blocking overlay (notification or loot box opener) is active. */
  get isBlocking(): boolean {
    return this._notifActive || this.lootBoxOpener.isOpen;
  }

  get notifActive(): boolean {
    return this._notifActive;
  }

  /** Call once per frame (before pause/game-over checks). */
  tick(): void {
    if (this.lootBoxOpener.isOpen) this.lootBoxOpener.tick();
    if (this._notifActive) this.achievementNotif.tick();
  }

  private _advanceNotifQueue(): void {
    const shown = this._notifQueue.shift();
    if (shown) {
      const idx = shown.mgr.pendingNotifications.indexOf(shown.def);
      if (idx >= 0) shown.mgr.pendingNotifications.splice(idx, 1);
      shown.mgr.clearMenuUnseenOne();
    }
    if (this._notifQueue.length > 0) {
      this.achievementNotif.reset();
    } else {
      this._notifActive = false;
      const inSafe = this.human.isProtected || this.cat.isProtected;
      if (inSafe) {
        if (this.humanAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('human', () => void 0);
        } else if (this.catAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('cat', () => void 0);
        }
      }
    }
  }

  /** Unread achievements across both crawlers. */
  private get unreadCount(): number {
    return this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
  }

  private get pendingBoxCount(): number {
    return this.humanAchievements.pendingBoxes.length + this.catAchievements.pendingBoxes.length;
  }

  private get partyInSafeRoom(): boolean {
    return this.human.isProtected || this.cat.isProtected;
  }

  /** The award overlays own the screen while either is up; the HUD's entries to them hide. */
  private get awardsShowing(): boolean {
    return this.lootBoxOpener.isOpen || this._notifActive;
  }

  /**
   * How many achievements the HUD's chip counts, or null when it does not
   * show: nothing unread, inside a safe room (its banner says it instead), or
   * an award already on screen.
   */
  hudChipCount(): number | null {
    if (this.awardsShowing || this.partyInSafeRoom) return null;
    const unread = this.unreadCount;
    return unread > 0 ? unread : null;
  }

  /**
   * The safe room's left-edge banner: unread achievements first, then loot
   * boxes waiting to be opened. Null outside a safe room, with nothing
   * waiting, or while an award is on screen.
   *
   * @param onClose Called as the boxes start opening, to put away whatever
   *   menu the banner was reached through.
   */
  hudBanner(onClose: () => void): LootBannerModel | null {
    if (this.awardsShowing || !this.partyInSafeRoom) return null;
    const unread = this.unreadCount;
    if (unread > 0) {
      return {
        glyph: 'trophy',
        title: 'Achievement!',
        detail: unread === 1 ? '1 new' : `${unread} new`,
        onTap: () => void this.showUnread(),
      };
    }
    const boxes = this.pendingBoxCount;
    if (boxes === 0) return null;
    return {
      glyph: 'sparkle',
      title: 'Open loot!',
      detail: boxes === 1 ? '1 box' : `${boxes} boxes`,
      onTap: () => void this.openPendingBoxes(onClose),
    };
  }

  /** Shows every unread achievement in turn. Returns whether there were any. */
  showUnread(): boolean {
    if (this.unreadCount === 0) return false;
    this._notifQueue = [
      ...this.humanAchievements.pendingNotifications.map((def) => ({
        def,
        mgr: this.humanAchievements,
        player: 'Human' as const,
      })),
      ...this.catAchievements.pendingNotifications.map((def) => ({
        def,
        mgr: this.catAchievements,
        player: 'Cat' as const,
      })),
    ];
    if (this._notifQueue.length > 0) {
      this._notifActive = true;
      this.achievementNotif.reset();
      this.audio?.play('achievement_awarded');
    }
    return true;
  }

  /**
   * Opens the human's loot boxes, then the cat's. Declined while an
   * achievement is still unread, which is read first. Returns whether any
   * box opened.
   */
  openPendingBoxes(onClose: () => void): boolean {
    if (this.unreadCount > 0) return false;
    if (this.humanAchievements.pendingBoxes.length > 0) {
      this.openBoxQueue('human', onClose);
      return true;
    }
    if (this.catAchievements.pendingBoxes.length > 0) {
      this.openBoxQueue('cat', onClose);
      return true;
    }
    return false;
  }

  /** Start opening loot box queue for a player, then chain to the other player's boxes. */
  openBoxQueue(player: 'human' | 'cat', onClose: () => void): void {
    const mgr = player === 'human' ? this.humanAchievements : this.catAchievements;
    const target = player === 'human' ? this.human : this.cat;
    const boxes = [...mgr.pendingBoxes];
    if (boxes.length === 0) return;
    onClose();
    const playerName = player === 'human' ? 'Human' : 'Cat';
    // Held for this player's whole reveal sequence: every box's coins/items
    // queue up and fly together once the opener actually closes, rather than
    // streaming in behind the cards while they're still being read. Passed
    // explicitly to every enqueue call below so a chest or another system's
    // overlapping hold can never end up owning this queue.
    const flyHold = this.rewardFly.hold();
    const origin = { x: viewportWidth() / 2, y: viewportHeight() / 2 };
    this.lootBoxOpener.startQueue(
      boxes,
      playerName,
      (box) => this.contentsFor(box),
      (box, contents) => {
        mgr.openBox(box.id);
        if (contents.potions) {
          target.inventory.addItem('health_potion', contents.potions);
          this.rewardFly.enqueueItem(
            'health_potion',
            ITEM_DEF.health_potion.name,
            origin.x,
            origin.y,
            flyHold,
          );
        }
        if (contents.coins > 0) {
          target.earnCoins(contents.coins);
          this.rewardFly.enqueueCoins(contents.coins, origin.x, origin.y, flyHold);
        }
        if (contents.bonus && isItemId(contents.bonus.id)) {
          this.human.inventory.addItem(contents.bonus.id, contents.bonus.quantity);
          this.rewardFly.enqueueItem(
            contents.bonus.id,
            ITEM_DEF[contents.bonus.id].name,
            origin.x,
            origin.y,
            flyHold,
          );
        }
        for (const reward of contents.itemRewards ?? []) {
          if (this.grantItemReward(target, reward.id, reward.quantity)) {
            this.rewardFly.enqueueItem(
              reward.id,
              ITEM_DEF[reward.id].name,
              origin.x,
              origin.y,
              flyHold,
            );
          }
        }
      },
      () => {
        this.rewardFly.release(flyHold);
        const otherPlayer = player === 'human' ? 'cat' : 'human';
        const otherMgr = player === 'human' ? this.catAchievements : this.humanAchievements;
        if (otherMgr.pendingBoxes.length > 0) {
          this.openBoxQueue(otherPlayer, () => void 0);
        } else {
          const cb = this.onAllBoxesOpened;
          this.onAllBoxesOpened = null;
          cb?.();
        }
      },
      () => {
        this.audio?.play('opening_reward_box');
      },
    );
  }

  /**
   * What a box holds: its shared tier/category contents, plus the granting
   * achievement's own item rewards (if any) as a separate addition so the
   * reveal shows both the shared bonus and the achievement-specific items.
   */
  private contentsFor(box: LootBox): BoxContents {
    const base = getBoxContents(box.tier, box.category);
    const itemRewards = ACHIEVEMENT_DEFS[box.fromAchievement].itemRewards;
    if (itemRewards === undefined) return base;
    return { ...base, itemRewards: itemRewards.map((reward) => ({ ...reward })) };
  }

  /** @returns whether the item actually landed in the bag, rather than overflowing to the ground. */
  private grantItemReward(target: HumanPlayer | CatPlayer, id: ItemId, quantity: number): boolean {
    if (target.inventory.hasRoomFor(id)) {
      target.inventory.addItem(id, quantity);
      return true;
    }
    this.onRewardOverflow?.(target, id, quantity);
    return false;
  }

  // ── Rendering ──

  /**
   * The notification and the loot-box reveal as one surface. It takes every
   * press while up, over the death screen included, but floats: the world
   * runs on and the keyboard is not locked. A tap anywhere or the attack key
   * skips the reveal; once the card has faded in, its OK button, Space, Enter
   * or the attack key dismisses it.
   */
  surface(id = 'achievement-overlay'): Surface {
    return {
      id,
      band: 'system',
      haltsWorld: false,
      locksKeyboard: false,
      isOpen: () => this.isBlocking,
      render: (ui) => {
        const revealing = this.lootBoxOpener.isOpen;
        if (revealing) this.lootBoxOpener.paint(ui, ui.screen.w, ui.screen.h);
        if (this._notifActive && this._notifQueue.length > 0) {
          const shown = this._notifQueue[0];
          this.achievementNotif.paint(ui, shown.def, shown.player, () => this._advanceNotifQueue());
        }
        // Registered last so it sits over everything: while a box is opening, any tap skips it.
        if (revealing) {
          ui.hit('skip', ui.screen, {
            onTap: () => this.lootBoxOpener.skip(),
            focusable: false,
            sound: null,
          });
        }
      },
      onKey: (key, mods) => {
        const isAttack = keybindings.actionFor(key) === 'attack';
        const fresh = mods.repeat !== true && mods.predatesSurface !== true;
        if (this.lootBoxOpener.isOpen) {
          if (!isAttack) return false;
          if (fresh) this.lootBoxOpener.skip();
          return true;
        }
        if (!isAttack && !ACTIVATE_KEYS.has(key)) return false;
        // The surface neither halts nor locks, so the focus ring never sees these keys: OK is pressed here.
        if (fresh && this.achievementNotif.isFadedIn) {
          this.audio?.play(UI_TAP_SOUND);
          this._advanceNotifQueue();
        }
        return true;
      },
    };
  }
}
