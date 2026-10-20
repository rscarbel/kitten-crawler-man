/**
 * Every action the AI may take, in one list. Each entry declares its
 * parameters, its policy and its executor together; the tool definitions the
 * server is given are generated from this list, and every call the server
 * sends back is validated against the same fields and then judged by the
 * {@link ActionGovernor} before it runs.
 *
 * A new action is a new {@link AIActionDef} added to one of the group lists
 * below (or a new group). An interactive action (one that waits on the
 * player's reply) still fits: its executor starts the exchange and reports
 * `ok`, and the reply travels back as an event.
 */
import { isCommentaryAction } from '../aiIntensity';
import type { SessionFlagName } from '../context/sessionContext';
import { aiCameraSpotlight } from './cameraSpotlight';
import { CHALLENGE_ACTIONS } from './challenge';
import { COMBAT_ACTIONS } from './combat';
import { ECONOMY_ACTIONS } from './economy';
import { ActionGovernor, hpShieldNote } from './governor';
import { defaultLedgerStore } from './ledgerStore';
import { NARRATION_ACTIONS } from './narration';
import { objectSchema, validateParams } from './schema';
import { SHOW_ACTIONS } from './show';
import { aiActionTimers } from './timers';
import type { AIActionDef, AIActionResult, AISceneContext, AIToolDefinition } from './types';
import { WORLD_ACTIONS } from './world';

/** The session flag Commentary intensity raises; see `AIIntensityPolicy.commentaryOnly`. */
const COMMENTARY_ONLY_FLAG: SessionFlagName = 'commentaryOnly';

export const AI_ACTIONS: readonly AIActionDef[] = [
  ...NARRATION_ACTIONS,
  ...SHOW_ACTIONS,
  ...CHALLENGE_ACTIONS,
  ...COMBAT_ACTIONS,
  ...ECONOMY_ACTIONS,
  ...WORLD_ACTIONS,
];

const ACTIONS_BY_NAME: ReadonlyMap<string, AIActionDef> = new Map(
  AI_ACTIONS.map((def) => [def.name, def]),
);

export function findAIAction(name: string): AIActionDef | undefined {
  return ACTIONS_BY_NAME.get(name);
}

/** The tool definition the server is given for one action. */
export function toolDefinitionFor(def: AIActionDef): AIToolDefinition {
  const ownForbids = def.policy.forbidsContext ?? [];
  const forbidsContext: readonly SessionFlagName[] = isCommentaryAction(def.name)
    ? ownForbids
    : [...ownForbids, COMMENTARY_ONLY_FLAG];
  return {
    name: def.name,
    description: [def.description, hpShieldNote(def)].filter((part) => part !== null).join(' '),
    parameters: objectSchema(def.params),
    policy: forbidsContext.length > 0 ? { ...def.policy, forbidsContext } : def.policy,
    ...(def.characters === undefined ? {} : { characters: def.characters }),
  };
}

/** Every action's tool definition, in registry order. */
export function generateAIToolDefinitions(): AIToolDefinition[] {
  return AI_ACTIONS.map(toolDefinitionFor);
}

/** The session's governor: cooldowns, counts and per-floor allowances live here. */
export const aiActionGovernor = new ActionGovernor(Date.now, defaultLedgerStore());

export interface AIActionRequest {
  readonly name: string;
  /** Raw arguments as the server sent them; validated here. */
  readonly params: unknown;
  readonly characterName: string;
}

export interface AIActionOutcome extends AIActionResult {
  /** The line for the "System intervened" indicator, or null when none should show. */
  readonly indicator: string | null;
}

function failed(detail: string): AIActionOutcome {
  return { ok: false, detail, indicator: null };
}

/**
 * Validates, governs and runs one action. Never throws: anything an executor
 * throws is reported as a failed result rather than reaching the game loop.
 */
export function executeAIAction(
  request: AIActionRequest,
  scene: AISceneContext,
  governor: ActionGovernor = aiActionGovernor,
): AIActionOutcome {
  const def = findAIAction(request.name);
  if (def === undefined) return failed(`unknown action ${request.name}`);

  const validated = validateParams(def.params, request.params);
  if (!validated.ok) return failed(`invalid parameters: ${validated.error}`);

  const call = { params: validated.value, scene, characterName: request.characterName };
  try {
    const verdict = governor.check(def, call);
    if (!verdict.ok) return failed(verdict.reason);
    const draw = def.budget?.(call) ?? null;
    const result = def.execute(call);
    if (!result.ok) return failed(result.detail);
    governor.record(def, call, draw);
    const indicator = def.showsIndicator === false ? null : result.detail;
    return { ok: true, detail: result.detail, indicator };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unexpected error';
    return failed(`${def.name} failed: ${message}`);
  }
}

/** Advances the AI's temporary effects one frame; call once per gameplay update. */
export function tickAIActions(): void {
  aiActionTimers.tick();
  aiCameraSpotlight.tick();
}

/** Ends every temporary effect at once, for a scene that is going away. */
export function endAIActionEffects(): void {
  aiActionTimers.flush();
  aiCameraSpotlight.clear();
}
