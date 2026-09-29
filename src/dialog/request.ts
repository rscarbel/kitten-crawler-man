/**
 * A `ConversationRequest` is everything one beat of a conversation needs: the
 * lines to show, what to preview alongside them, and what happens once the
 * last one has been *read* — not queued. Side effects live in `ending` and
 * `dismiss`, which the `Conversation` UI runs after the pages are done, so
 * "what happens next" is data on the request instead of a callback threaded
 * through `onShown`/`endAfterPages`/`afterClose`.
 */

import type { ItemId } from '../core/ItemDefs';
import type { DialogLine, NonEmpty } from './line';

/**
 * What a page is offering, previewed on the page that asks the player to
 * agree to the work — plain language, not the item's flavour name, because a
 * first-time player can't judge whether an errand is worth it from a name
 * alone.
 */
export interface DialogReward {
  readonly itemId: ItemId;
  readonly displayName: string;
  readonly lines: NonEmpty<string>;
  readonly xp: number;
}

/**
 * How a bare press of the confirm key (Space, or Enter on a focus ring) treats
 * one choice on a `choices` row.
 *   'default' → Space picks this one, ahead of whatever the row would pick for itself.
 *   'never'   → Space never picks this one: an option that spends, wagers or
 *               burns something a stray press would regret. The player aims at it.
 * Omitted, the row picks for itself — see `defaultChoiceIndex` in `Conversation`.
 */
export type ChoiceKeyboardRole = 'default' | 'never';

/** One option on a conversation's choice row. */
export interface Choice {
  readonly label: string;
  /**
   * `exit` marks a way out — Goodbye, Back, Leave, Not now. An exit is never
   * what a bare Space picks while anything else is on offer: the player who
   * holds Space to get through a conversation is saying "go on", not "go away".
   */
  readonly tone: 'normal' | 'quest' | 'exit';
  readonly keyboard?: ChoiceKeyboardRole;
  run(convo: ConversationHandle): void;
}

/**
 * What a bare press of the confirm key (Space) does on a `confirm` row.
 *   'accept' → Space takes the accept side.
 *   'none'   → Space does nothing; the player has to aim at a button or a number key.
 * There is no 'decline': a decline is a way out, and Space is never the way out.
 */
export type ConfirmKeyboardDefault = 'accept' | 'none';

/**
 * What happens once a request's last line has been read.
 *   'close'   → the conversation ends; `onClosed` runs the side effect.
 *   'choices' → the choice row comes up.
 *   'confirm' → the two-button accept/decline pair comes up.
 */
export type Ending =
  | { readonly kind: 'close'; readonly onClosed: () => void }
  | { readonly kind: 'choices'; readonly choices: NonEmpty<Choice> }
  | {
      readonly kind: 'confirm';
      readonly accept: Choice;
      readonly decline: Choice;
      readonly keyboardDefault: ConfirmKeyboardDefault;
    };

/**
 * What Esc, and walking away from the speaker, do.
 *   'blocked' → neither does anything; the scene is load-bearing.
 *   'allowed' → both close the conversation and run `onDismissed`.
 */
export type DismissPolicy =
  { readonly kind: 'blocked' } | { readonly kind: 'allowed'; readonly onDismissed: () => void };

/**
 * Where the speaker is standing, for a `dismiss: 'allowed'` request.
 * `position` is read every frame rather than captured once, so a speaker who
 * walks while talking is followed rather than measured from where they stood
 * when the conversation opened. `null` when the request has no speaker fixed
 * in the world to walk away from (a cutscene, a system message).
 *
 * The anchor names only the range the speaker can be talked to from; how far
 * past it the player may go is `walkAwayRangeTiles`, the same for everyone.
 * Stepping outside the talk range also frees the interact press for whoever
 * else is in reach — see `Conversation.handOff`.
 */
export interface ConversationAnchor {
  readonly position: () => { readonly x: number; readonly y: number };
  /**
   * The distance, in tiles from `position()` to the player's own position,
   * within which the owner's interact check opens this conversation.
   */
  readonly talkRangeTiles: number;
}

/**
 * A line still being fetched — the box shows "…" and a non-advancing footer
 * until it resolves. A rejection is handled the same way a resolution is: the
 * box shows a fallback line and the player can advance past it. `text` must
 * never be left to reject unhandled, or the box would show "…" forever.
 */
export interface PendingLine {
  readonly speaker: DialogLine['speaker'];
  readonly text: Promise<string>;
}

export interface ConversationRequest {
  readonly lines: NonEmpty<DialogLine | PendingLine>;
  /** Drawn under the box on the final page. `null` when this beat offers nothing. */
  readonly reward: DialogReward | null;
  readonly questRelated: boolean;
  readonly ending: Ending;
  readonly dismiss: DismissPolicy;
  /**
   * Whether the rest of the world keeps ticking behind this conversation.
   * Required rather than derived from `dismiss`, so a request that needs the
   * uncommon pairing — a haltable scene the player can still walk away from,
   * say — has to say so explicitly instead of falling out of a default.
   */
  readonly haltsWorld: boolean;
  readonly anchor: ConversationAnchor | null;
  /**
   * Whether this conversation locks the hotbar, Tab and F keys while it is
   * open. Required rather than defaulted, so a surface the player pages
   * through while the floor keeps running underneath it — where those keys
   * still need to work — has to say so explicitly.
   */
  readonly locksKeyboard: boolean;
}

/**
 * What a running conversation exposes back to a `Choice.run` or an
 * `Ending.onClosed`: chain into the next beat in the same open box, or end it.
 */
export interface ConversationHandle {
  play(request: ConversationRequest): void;
  close(): void;
}

/** One entry of a villager's Q&A menu. */
export interface ConversationTopic {
  readonly key: string;
  readonly label: string;
  readonly tone: 'normal' | 'quest' | 'exit';
  /** How a bare Space treats this topic's row; see {@link ChoiceKeyboardRole}. */
  readonly keyboard?: ChoiceKeyboardRole;
  /** Whether picking this topic again is allowed once it's been answered. */
  readonly repeatable: boolean;
  /** Whether this topic sits on the root menu or inside a submenu it opens. */
  readonly grouping: 'root' | 'question';
  run(convo: ConversationHandle): void;
}
