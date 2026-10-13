/**
 * ChatKit — the chat box, its bubble, and the command table behind it.
 *
 * The universal cheats (`!god`, `!tough`, `!lucky`, `!payday`, `!levelup`, `!give`, `!vomit`) live here, so
 * they work wherever the player can open chat rather than only in the dungeon.
 * Commands a scene cannot honour are simply absent from its table — a scene
 * contributes the ones its own systems can answer, and there are no stubs that
 * accept a command and then do nothing.
 */

import {
  applyGodModeToPlayer,
  applyLuckToPlayer,
  GOD_MODE_ABILITY_LEVEL,
  removeGodModeFromPlayer,
  removeLuckFromPlayer,
  type GodModeState,
} from '../../core/GodMode';
import type { AbilityManager } from '../../core/AbilityManager';
import { aiAdapter } from '../../ai/AIAdapter';
import { ITEM_DEF, isItemId } from '../../core/ItemDefs';
import { makeBloodVomit } from '../../core/StatusEffect';
import { BLOOD_VOMIT_INTERVAL_FRAMES } from '../../core/statusTuning';
import { PlayerChatSystem } from '../PlayerChatSystem';
import type { SceneWorld } from './SceneWorld';
import type { Surface } from '../../ui/core/UiRoot';

/** What `!payday` is worth. */
const CHEAT_PAYDAY_COINS = 10000;

/** How soon `!vomit` brings up its first bout, so a test need not wait out the interval. */
const CHEAT_VOMIT_FIRST_BOUT_FRAMES = 60;

const DEFAULT_GIVE_QUANTITY = 1;

/** `!give` takes an item id and an optional quantity. */
const MAX_GIVE_WORDS = 2;
/**
 * The most copies of a non-stacking item one `!give` hands over. Each copy is
 * a bag slot, so an unbounded count would build a bag too deep to page
 * through and too big to save.
 */
const MAX_GIVE_COPIES = 300;

/** The `!give` quantity word as a positive whole number, or null when it is not one. */
function parseGiveQuantity(word: string | undefined): number | null {
  if (word === undefined) return DEFAULT_GIVE_QUANTITY;
  if (!/^\d+$/.test(word)) return null;
  const quantity = Number(word);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

/**
 * One chat command: the text that triggers it and what it does. `run` receives
 * whatever followed the command word, trimmed — empty for commands that take no
 * argument.
 *
 * @returns the bubble to show, or null to show nothing.
 */
export interface ChatCommand {
  readonly name: string;
  readonly run: (argument: string) => string | null;
}

export interface ChatKitDeps {
  readonly world: SceneWorld;
  readonly abilityManager: AbilityManager;
  readonly godModeState: GodModeState;
  /**
   * A one-line description of where the party is and how they are doing, handed
   * to the AI when the text is not a command. Read at open time, not at
   * construction, because every number in it moves.
   */
  readonly describeSituation: () => string;
  /** Commands only this scene can answer — bounty warps, floor reveals. */
  readonly sceneCommands?: ReadonlyArray<ChatCommand>;
}

export class ChatKit {
  readonly chat = new PlayerChatSystem();

  private readonly world: SceneWorld;
  private readonly abilityManager: AbilityManager;
  private readonly godModeState: GodModeState;
  private readonly describeSituation: () => string;
  private readonly commands: ReadonlyArray<ChatCommand>;

  /**
   * The speed multipliers god mode overwrote. God mode is an overlay on top of
   * base stats rather than a change to them, so turning it off means putting
   * back what was there rather than recomputing a default.
   */
  private godModeSnapshot: { human: number; cat: number } | null = null;
  private toughModeActive = false;

  constructor(deps: ChatKitDeps) {
    this.world = deps.world;
    this.abilityManager = deps.abilityManager;
    this.godModeState = deps.godModeState;
    this.describeSituation = deps.describeSituation;
    this.commands = [...this.universalCommands(), ...(deps.sceneCommands ?? [])];
  }

  get isOpen(): boolean {
    return this.chat.isOpen;
  }

  update(): void {
    this.chat.update();
  }

  cancel(): void {
    this.chat.cancel();
  }

  /**
   * Closes the chat box. It keeps a hidden DOM `<input>` on the page to type
   * through, so a scene that tore down with it open would leave a field that
   * swallows every key the next scene needs.
   */
  dispose(): void {
    this.cancel();
  }

  /** The chat box as a surface; see `PlayerChatSystem.surface`. */
  surface(id = 'chat'): Surface {
    return this.chat.surface(id);
  }

  showBubble(text: string): void {
    this.chat.showBubble(text);
  }

  renderBubble(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.chat.renderBubble(ctx, camX, camY, this.world.pm.active());
  }

  open(canvas: HTMLCanvasElement): void {
    const situation = this.describeSituation();
    this.chat.open(canvas, (text) => {
      const typed = text.trim();
      const command = this.commands.find(
        (candidate) => typed === candidate.name || typed.startsWith(`${candidate.name} `),
      );
      if (command !== undefined) {
        const bubble = command.run(typed.slice(command.name.length).trim());
        if (bubble !== null) this.chat.showBubble(bubble);
        return;
      }
      this.chat.showBubble(typed);
      void aiAdapter.chatWithSystem(typed, situation);
    });
  }

  /**
   * Re-applies whatever cheat the shared state says is running. Snapshots are
   * stripped of god-mode boosts on every scene transition, so an active cheat
   * has to be rebuilt rather than surviving in the stats.
   */
  applyCarriedCheat(): void {
    if (this.godModeState.active) this.enableGodMode();
    else if (this.godModeState.toughActive) this.enableToughMode();
    if (this.godModeState.luckyActive) this.setLucky(true);
  }

  private universalCommands(): ReadonlyArray<ChatCommand> {
    return [
      {
        name: '!god',
        run: () => {
          if (this.godModeSnapshot !== null) {
            this.disableGodMode();
            return '⚡ GOD MODE OFF';
          }
          if (this.toughModeActive) {
            this.disableToughMode();
            this.enableGodMode();
            return '⚡ GOD MODE ON (disabled Tough Mode first)';
          }
          this.enableGodMode();
          return '⚡ GOD MODE ON';
        },
      },
      {
        name: '!tough',
        run: () => {
          if (this.toughModeActive) {
            this.disableToughMode();
            return '🛡️ TOUGH MODE OFF';
          }
          this.enableToughMode();
          return '🛡️ TOUGH MODE ON';
        },
      },
      {
        name: '!lucky',
        run: () => {
          const lucky = !this.godModeState.luckyActive;
          this.setLucky(lucky);
          return lucky ? '🍀 LUCKY ON' : '🍀 LUCKY OFF';
        },
      },
      {
        name: '!payday',
        run: () => {
          this.world.pm.active().coins += CHEAT_PAYDAY_COINS;
          return `💰 +${CHEAT_PAYDAY_COINS} COINS`;
        },
      },
      {
        name: '!give',
        run: (argument) => this.giveItem(argument),
      },
      {
        name: '!vomit',
        run: () => {
          const bloodVomit = makeBloodVomit();
          bloodVomit.ticksRemaining -= BLOOD_VOMIT_INTERVAL_FRAMES - CHEAT_VOMIT_FIRST_BOUT_FRAMES;
          this.world.pm.active().applyStatus(bloodVomit);
          return '🩸 BLOOD VOMIT';
        },
      },
      {
        name: '!levelup',
        run: () => {
          for (const player of this.world.pm.players()) {
            player.advanceLevel();
            this.world.bus.emit('playerLevelUp', { player, newLevel: player.level });
          }
          return '⭐ LEVEL UP';
        },
      },
    ];
  }

  /**
   * `!give <item_id> [quantity]`: `quantity` (default 1) of the item, to the
   * crawler who can wear it when only one can, otherwise to whoever is in
   * control. A non-stackable item takes one bag slot per copy, so at most
   * {@link MAX_GIVE_COPIES} of them are given and the toast says so.
   */
  private giveItem(argument: string): string {
    const words: ReadonlyArray<string | undefined> = argument.split(/\s+/);
    if (words.length > MAX_GIVE_WORDS) return `❓ USAGE: !give <item_id> [quantity]`;
    const [firstWord, quantityArgument] = words;
    const itemArgument = firstWord ?? '';
    if (itemArgument === '') return `❓ USAGE: !give <item_id> [quantity]`;
    if (!isItemId(itemArgument)) return `❓ NO ITEM "${itemArgument}"`;
    const quantity = parseGiveQuantity(quantityArgument);
    if (quantity === null) return `❓ BAD QUANTITY "${String(quantityArgument)}"`;
    const def = ITEM_DEF[itemArgument];
    const { pm } = this.world;
    const goesToActive = def.wearer === undefined || def.wearer === 'both';
    const recipient = goesToActive ? pm.active() : def.wearer === 'cat' ? pm.cat : pm.human;
    const { inventory } = recipient;
    const takesOneSlotPerCopy = !def.stackable && def.isQuestItem !== true;
    const isSingleQuestItem = !def.stackable && def.isQuestItem === true;
    const given = isSingleQuestItem
      ? 1
      : takesOneSlotPerCopy
        ? Math.min(quantity, MAX_GIVE_COPIES)
        : quantity;
    if (takesOneSlotPerCopy) inventory.addCopies(itemArgument, given);
    else inventory.addItem(itemArgument, given);
    recipient.onInventoryChanged();
    const label = given > 1 ? `${given}× ${def.name}` : def.name;
    const clamped = takesOneSlotPerCopy && quantity > given;
    return clamped ? `🎁 ${label} (capped at ${MAX_GIVE_COPIES})` : `🎁 ${label}`;
  }

  /** `!god`: the stat/speed/ability overlay, plus the shared flag that carries it. */
  private enableGodMode(): void {
    const { human, cat } = this.world.pm;
    this.godModeSnapshot = {
      human: human.baseSpeedMultiplier,
      cat: cat.baseSpeedMultiplier,
    };
    applyGodModeToPlayer(human);
    applyGodModeToPlayer(cat);
    this.abilityManager.setGodModeMinLevel(GOD_MODE_ABILITY_LEVEL);
    this.godModeState.active = true;
  }

  private disableGodMode(): void {
    if (this.godModeSnapshot === null) return;
    const { human, cat } = this.world.pm;
    removeGodModeFromPlayer(human, this.godModeSnapshot.human);
    removeGodModeFromPlayer(cat, this.godModeSnapshot.cat);
    this.abilityManager.setGodModeMinLevel(0);
    this.godModeSnapshot = null;
    this.godModeState.active = false;
  }

  /** `!lucky`: the hidden dodge boost on both crawlers, plus the flag the casino games read. */
  private setLucky(lucky: boolean): void {
    for (const player of this.world.pm.players()) {
      if (lucky) applyLuckToPlayer(player);
      else removeLuckFromPlayer(player);
    }
    this.godModeState.luckyActive = lucky;
  }

  /** `!tough`: damage immunity plus zero outgoing damage. Exclusive with god mode. */
  private enableToughMode(): void {
    this.disableGodMode();
    for (const player of this.world.pm.players()) {
      player.godMode = true;
      player.zeroDamage = true;
    }
    this.toughModeActive = true;
    this.godModeState.toughActive = true;
  }

  private disableToughMode(): void {
    for (const player of this.world.pm.players()) {
      player.godMode = false;
      player.zeroDamage = false;
    }
    this.toughModeActive = false;
    this.godModeState.toughActive = false;
  }
}
