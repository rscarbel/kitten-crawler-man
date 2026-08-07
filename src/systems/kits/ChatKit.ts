/**
 * ChatKit — the chat box, its bubble, and the command table behind it.
 *
 * The universal cheats (`!god`, `!tough`, `!payday`, `!levelup`) live here, so
 * they work wherever the player can open chat rather than only in the dungeon.
 * Commands a scene cannot honour are simply absent from its table — a scene
 * contributes the ones its own systems can answer, and there are no stubs that
 * accept a command and then do nothing.
 */

import {
  applyGodModeToPlayer,
  GOD_MODE_ABILITY_LEVEL,
  removeGodModeFromPlayer,
  type GodModeState,
} from '../../core/GodMode';
import type { AbilityManager } from '../../core/AbilityManager';
import { aiAdapter } from '../../ai/AIAdapter';
import { PlayerChatSystem } from '../PlayerChatSystem';
import type { SceneWorld } from './SceneWorld';

/** What `!payday` is worth. Enough to matter, not enough to be the whole economy. */
const CHEAT_PAYDAY_COINS = 2500;

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
   * Takes the chat box off the page. It is a real DOM `<input>` appended to the
   * body, so a scene that tore down with it open leaves an invisible field that
   * swallows every key the next scene needs.
   */
  dispose(): void {
    this.cancel();
  }

  showBubble(text: string): void {
    this.chat.showBubble(text);
  }

  renderBubble(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.chat.renderBubble(ctx, camX, camY, this.world.pm.active());
  }

  renderHint(ctx: CanvasRenderingContext2D): void {
    this.chat.renderChatHint(ctx);
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
        name: '!payday',
        run: () => {
          this.world.pm.active().coins += CHEAT_PAYDAY_COINS;
          return `💰 +${CHEAT_PAYDAY_COINS} COINS`;
        },
      },
      {
        name: '!levelup',
        run: () => {
          for (const player of this.world.pm.players()) {
            if (player.gainXp(player.xpRemainingToNextLevel)) {
              this.world.bus.emit('playerLevelUp', { player, newLevel: player.level });
            }
          }
          return '⭐ LEVEL UP';
        },
      },
    ];
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
