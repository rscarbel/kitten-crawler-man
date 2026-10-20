/**
 * The path from an `ai_action` the server sent to an executed action: parsing
 * either wire shape, holding calls while the game is paused, and handing every
 * outcome to one listener.
 */
import type { ActionGovernor } from './governor';
import {
  aiActionGovernor,
  executeAIAction,
  type AIActionOutcome,
  type AIActionRequest,
} from './registry';
import type { AISceneContext } from './types';

export interface ParsedServerAction {
  /** The server's id for the call, present in protocol 2; reported back with its result. */
  readonly actionId: string | null;
  readonly request: AIActionRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one action off the wire. Protocol 2 sends `{ actionId, characterName,
 * type, params }`; protocol 1 sends the arguments flat beside `type`.
 */
export function parseServerAction(
  raw: unknown,
  fallbackCharacter: string,
): ParsedServerAction | null {
  if (!isRecord(raw)) return null;
  const { type, params, actionId, characterName, ...flatArgs } = raw;
  if (typeof type !== 'string') return null;
  const character = typeof characterName === 'string' ? characterName : fallbackCharacter;
  const id = typeof actionId === 'string' ? actionId : null;
  const args = params === undefined ? flatArgs : params;
  return { actionId: id, request: { name: type, params: args, characterName: character } };
}

/** How long a call waits out a pause before it is dropped as stale. */
const HELD_ACTION_MAX_AGE_MS = 20_000;
/** The most calls held through one pause. */
const HELD_ACTION_LIMIT = 8;

interface HeldAction {
  readonly parsed: ParsedServerAction;
  readonly heldAtMs: number;
}

export type ActionOutcomeListener = (parsed: ParsedServerAction, outcome: AIActionOutcome) => void;

/** A player-side refusal judged at the moment a call runs (the AI intensity setting); null lets it run. */
export type ActionVeto = (parsed: ParsedServerAction) => string | null;

const NO_VETO: ActionVeto = () => null;

/**
 * Runs calls at once while the game is live and holds them while it is
 * paused or a menu is open, so the AI never acts on a player who cannot see
 * it. A call held longer than {@link HELD_ACTION_MAX_AGE_MS} is reported as
 * expired instead of being run late.
 */
export class AIActionDispatcher {
  private held: HeldAction[] = [];

  constructor(
    private readonly onOutcome: ActionOutcomeListener,
    private readonly now: () => number = Date.now,
    private readonly governor: ActionGovernor = aiActionGovernor,
    private readonly veto: ActionVeto = NO_VETO,
  ) {}

  submit(parsed: ParsedServerAction, scene: AISceneContext): void {
    if (scene.isPaused()) {
      this.held.push({ parsed, heldAtMs: this.now() });
      while (this.held.length > HELD_ACTION_LIMIT) {
        const dropped = this.held.shift();
        if (dropped !== undefined) this.expire(dropped);
      }
      return;
    }
    this.run(parsed, scene);
  }

  /** Runs whatever was held, once the game is live again; call every frame. */
  drain(scene: AISceneContext): void {
    if (this.held.length === 0 || scene.isPaused()) return;
    const due = this.held;
    this.held = [];
    for (const entry of due) {
      if (this.now() - entry.heldAtMs > HELD_ACTION_MAX_AGE_MS) {
        this.expire(entry);
      } else {
        this.run(entry.parsed, scene);
      }
    }
  }

  /** Drops every held call, for a scene that is going away. */
  clear(): void {
    const due = this.held;
    this.held = [];
    for (const entry of due) this.expire(entry);
  }

  /** The veto is asked here rather than on submit, so a setting changed during a pause applies to what was held. */
  private run(parsed: ParsedServerAction, scene: AISceneContext): void {
    const refusal = this.veto(parsed);
    if (refusal !== null) {
      this.onOutcome(parsed, { ok: false, detail: refusal, indicator: null });
      return;
    }
    this.onOutcome(parsed, executeAIAction(parsed.request, scene, this.governor));
  }

  private expire(entry: HeldAction): void {
    this.onOutcome(entry.parsed, {
      ok: false,
      detail: 'expired while the game was paused',
      indicator: null,
    });
  }
}
