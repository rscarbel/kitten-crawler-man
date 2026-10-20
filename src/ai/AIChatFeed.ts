/**
 * What the AI panel shows, as plain state the adapter feeds and the panel
 * surface reads: the latest message as it streams in and types out, who is
 * typing, the reply choices, mood and opinion flashes, the "intervened"
 * indicators and the connection status. No drawing happens here, so the
 * headless gates can drive it frame by frame.
 */
import type { ChatChoice, ChatStreamUpdate, ServerPayloads } from '@rscarbel/game-server-llm-sdk';
import { SYSTEM_CHARACTER_NAME, VIEWERS_CHARACTER_NAME } from './characters';

/**
 * - `disabled`: no AI this session (turned off in the build, or no one signed in).
 * - `connecting`: before the first handshake.
 * - `online`: connected and answering.
 * - `degraded`: connected, but the server says it is throttled, resting or on a fallback model.
 * - `offline`: the server cannot be reached; scripted lines stand in.
 */
export type AIConnectionStatus = 'disabled' | 'connecting' | 'online' | 'degraded' | 'offline';

/** Characters typed out per frame: about ninety a second at 60 fps, a brisk machine pace. */
export const TYPEWRITER_CHARS_PER_TICK = 1.5;
/** A finished message stays at least this long… */
const MIN_HOLD_TICKS = 360;
/** …or this long per word, whichever is longer: about four words a second at 60 fps… */
const HOLD_TICKS_PER_WORD = 15;
/** …but never longer than this, so a rambling reply cannot sit on screen for minutes. */
export const MAX_HOLD_TICKS = 1200;
/** Longer replies are cut here with an ellipsis; the panel is a glance, not a transcript. */
export const MAX_DISPLAY_CHARS = 600;
const ELLIPSIS = '…';
/** A message that asks something waits this long for an answer. */
export const CHOICE_HOLD_TICKS = 1800;
/** After a choice is picked the question lingers this long. */
const ANSWERED_HOLD_TICKS = 90;
/** A typing indicator whose "stopped" never arrived clears itself after this long. */
export const TYPING_TIMEOUT_TICKS = 1200;
export const FLASH_TICKS = 240;
export const INTERVENTION_TICKS = 210;
const MAX_INTERVENTIONS = 3;

export interface FeedMessage {
  readonly key: string;
  readonly characterName: string;
  /** Everything received so far; the typewriter reveals up to `revealed` of it. */
  readonly text: string;
  readonly revealed: number;
  /** The final `ai_chat` has arrived. */
  readonly done: boolean;
  readonly choices: readonly ChatChoice[];
  /** Frames left once fully shown, counted only after `done`. */
  readonly holdTicks: number;
}

export interface FeedFlash {
  readonly text: string;
  readonly ticks: number;
}

export interface FeedIntervention {
  readonly actor: string;
  readonly text: string;
  readonly ticks: number;
}

/** What a reply button sends back: the label is what the player said, the id ties it to the question. */
export interface ChoiceReply {
  readonly characterName: string;
  readonly text: string;
  readonly replyTo: string;
}

export type OpinionDirection = 'up' | 'down' | 'same';

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [SYSTEM_CHARACTER_NAME]: 'The System',
  [VIEWERS_CHARACTER_NAME]: 'The Viewers',
};

/** How a character is named on screen: "The System", "Mordecai". */
export function displayNameOf(characterName: string): string {
  return DISPLAY_NAMES[characterName] ?? characterName;
}

function holdTicksFor(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(MAX_HOLD_TICKS, Math.max(MIN_HOLD_TICKS, words * HOLD_TICKS_PER_WORD));
}

function displayable(text: string): string {
  return text.length <= MAX_DISPLAY_CHARS
    ? text
    : `${text.slice(0, MAX_DISPLAY_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

function capitalized(label: string): string {
  return label.length === 0 ? label : label[0].toUpperCase() + label.slice(1);
}

/** Relationship dimensions where more means the character thinks less of the player. */
const NEGATIVE_RELATIONSHIP_KEYS: ReadonlySet<string> = new Set([
  'irritation',
  'annoyance',
  'hostility',
  'contempt',
  'disgust',
  'resentment',
]);

/** How warmly the character regards the player overall: warm dimensions add, cold ones subtract. */
function relationshipTotal(relationship: Record<string, number>): number {
  return Object.entries(relationship).reduce(
    (sum, [key, value]) => sum + (NEGATIVE_RELATIONSHIP_KEYS.has(key) ? -value : value),
    0,
  );
}

const OPINION_ARROWS: Readonly<Record<OpinionDirection, string>> = {
  up: '▲ ',
  down: '▼ ',
  same: '',
};

/** "The System's opinion of you: ▲ Amused". */
export function opinionLine(name: string, direction: OpinionDirection, mood: string): string {
  return `${name}'s opinion of you: ${OPINION_ARROWS[direction]}${mood}`;
}

export class AIChatFeed {
  status: AIConnectionStatus = 'disabled';
  private current: FeedMessage | null = null;
  private readonly typing = new Map<string, number>();
  private flashState: FeedFlash | null = null;
  private interventionList: FeedIntervention[] = [];
  private readonly lastRelationship = new Map<string, number>();
  private scriptedCount = 0;

  get message(): FeedMessage | null {
    return this.current;
  }

  get flash(): FeedFlash | null {
    return this.flashState;
  }

  get interventions(): readonly FeedIntervention[] {
    return this.interventionList;
  }

  /** The character shown as typing, or null. A message already streaming from them says enough. */
  get typingCharacter(): string | null {
    for (const characterName of this.typing.keys()) {
      const streaming =
        this.current !== null && this.current.characterName === characterName && !this.current.done;
      if (!streaming) return characterName;
    }
    return null;
  }

  /** Whether the panel has anything to show. */
  get hasContent(): boolean {
    return (
      this.current !== null ||
      this.typing.size > 0 ||
      this.flashState !== null ||
      this.interventionList.length > 0
    );
  }

  /** A streamed piece or the final message, as the SDK assembles them. */
  onChat(update: ChatStreamUpdate): void {
    const previous = this.current;
    const continuing = previous !== null && previous.key === update.messageId;
    const text = displayable(update.text);
    const revealed = continuing ? Math.min(previous.revealed, text.length) : 0;
    const choices = update.choices ?? [];
    this.current = {
      key: update.messageId,
      characterName: update.characterName,
      text,
      revealed,
      done: update.done,
      choices,
      holdTicks: choices.length > 0 ? CHOICE_HOLD_TICKS : holdTicksFor(text),
    };
    if (update.done) this.typing.delete(update.characterName);
  }

  /** A line the game wrote itself, in the character's voice: offline fallbacks, the wipe notice. */
  addScripted(characterName: string, text: string): void {
    this.scriptedCount += 1;
    this.onChat({
      messageId: `scripted-${this.scriptedCount.toString()}`,
      characterName,
      text,
      done: true,
    });
  }

  onTyping(payload: ServerPayloads['ai_typing']): void {
    if (payload.typing) this.typing.set(payload.characterName, TYPING_TIMEOUT_TICKS);
    else this.typing.delete(payload.characterName);
  }

  /** Mood and opinion changes, flashed as one line. */
  onState(payload: ServerPayloads['ai_state']): void {
    const name = displayNameOf(payload.characterName);
    let direction: OpinionDirection = 'same';
    if (payload.relationship !== undefined) {
      const total = relationshipTotal(payload.relationship);
      const before = this.lastRelationship.get(payload.characterName);
      this.lastRelationship.set(payload.characterName, total);
      if (before !== undefined && total > before) direction = 'up';
      if (before !== undefined && total < before) direction = 'down';
    }
    const mood = payload.mood?.label;
    let text: string | null = null;
    if (mood !== undefined) text = opinionLine(name, direction, capitalized(mood));
    else if (payload.change !== undefined) text = `${name}: ${payload.change}`;
    if (text !== null) this.flashState = { text, ticks: FLASH_TICKS };
  }

  addIntervention(actor: string, text: string): void {
    this.interventionList.push({ actor: displayNameOf(actor), text, ticks: INTERVENTION_TICKS });
    while (this.interventionList.length > MAX_INTERVENTIONS) this.interventionList.shift();
  }

  /**
   * The player picked a reply button. Returns what to send, or null when
   * the message no longer offers that choice.
   */
  pickChoice(choiceId: string): ChoiceReply | null {
    const message = this.current;
    if (message === null) return null;
    const choice = message.choices.find((candidate) => candidate.id === choiceId);
    if (choice === undefined) return null;
    this.current = { ...message, choices: [], holdTicks: ANSWERED_HOLD_TICKS };
    return { characterName: message.characterName, text: choice.label, replyTo: choice.id };
  }

  /** Drops what is on screen, for a connection that went away mid-stream. */
  clearStreaming(): void {
    this.typing.clear();
    if (this.current !== null && !this.current.done) this.current = null;
  }

  /** One frame: types the message out, counts down what is held. */
  update(): void {
    const message = this.current;
    if (message !== null) {
      const fullyShown = message.revealed >= message.text.length;
      if (!fullyShown) {
        this.current = {
          ...message,
          revealed: Math.min(message.text.length, message.revealed + TYPEWRITER_CHARS_PER_TICK),
        };
      } else if (message.done) {
        this.current =
          message.holdTicks <= 1 ? null : { ...message, holdTicks: message.holdTicks - 1 };
      }
    }
    for (const [characterName, ticks] of this.typing) {
      if (ticks <= 1) this.typing.delete(characterName);
      else this.typing.set(characterName, ticks - 1);
    }
    if (this.flashState !== null) {
      this.flashState =
        this.flashState.ticks <= 1
          ? null
          : { ...this.flashState, ticks: this.flashState.ticks - 1 };
    }
    this.interventionList = this.interventionList
      .map((entry) => ({ ...entry, ticks: entry.ticks - 1 }))
      .filter((entry) => entry.ticks > 0);
  }
}
