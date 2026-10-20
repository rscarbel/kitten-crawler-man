/**
 * The player's AI Intensity setting and what it means to the AI server: the
 * `policyMultiplier`, `allowedSeverities` and `commentaryOnly` session flag
 * carried by every `context_set`. The game applies the same limits to
 * whatever actions still arrive, so a server that ignores them cannot act
 * past the player's choice.
 */
import type { ActionSeverity } from './actions/types';

export const AI_INTENSITIES = ['off', 'commentary', 'classic', 'chaotic'] as const;
export type AIIntensity = (typeof AI_INTENSITIES)[number];

export const DEFAULT_AI_INTENSITY: AIIntensity = 'classic';

export const AI_INTENSITY_LABELS: Readonly<Record<AIIntensity, string>> = {
  off: 'Off',
  commentary: 'Commentary',
  classic: 'Classic',
  chaotic: 'Chaotic',
};

/**
 * What Commentary lets the AI do: talk about the run and nothing else. Every
 * entry is pure presentation or the character's own memory; anything that
 * pays out, cures, moves, asks, discounts or interrupts is left off, however
 * benign its severity, because Commentary promises the System never touches
 * the run.
 */
export const COMMENTARY_ACTIONS: readonly string[] = [
  'announce',
  'play_sound',
  'music_sting',
  'remember',
  'viewer_reaction',
];

export function isCommentaryAction(actionName: string): boolean {
  return COMMENTARY_ACTIONS.includes(actionName);
}

export interface AIIntensityPolicy {
  /** 0 stops AI-initiated activity; above 1 makes every tool cheaper, so the AI acts more often. */
  readonly policyMultiplier: number;
  /** Undefined allows every severity. */
  readonly allowedSeverities: readonly ActionSeverity[] | undefined;
  /**
   * Only {@link COMMENTARY_ACTIONS} may run. Severity alone cannot say this
   * (a heal is benign), so the server hears it as the `commentaryOnly`
   * session flag, which every other tool's definition forbids.
   */
  readonly commentaryOnly: boolean;
}

const OFF_MULTIPLIER = 0;
const CLASSIC_MULTIPLIER = 1;
const CHAOTIC_MULTIPLIER = 2;
const COMMENTARY_SEVERITIES: readonly ActionSeverity[] = ['benign'];

const POLICIES: Readonly<Record<AIIntensity, AIIntensityPolicy>> = {
  off: { policyMultiplier: OFF_MULTIPLIER, allowedSeverities: undefined, commentaryOnly: false },
  commentary: {
    policyMultiplier: CLASSIC_MULTIPLIER,
    allowedSeverities: COMMENTARY_SEVERITIES,
    commentaryOnly: true,
  },
  classic: {
    policyMultiplier: CLASSIC_MULTIPLIER,
    allowedSeverities: undefined,
    commentaryOnly: false,
  },
  chaotic: {
    policyMultiplier: CHAOTIC_MULTIPLIER,
    allowedSeverities: undefined,
    commentaryOnly: false,
  },
};

export function intensityPolicy(intensity: AIIntensity): AIIntensityPolicy {
  return POLICIES[intensity];
}

export function isAIIntensity(value: unknown): value is AIIntensity {
  return AI_INTENSITIES.some((intensity) => intensity === value);
}

/**
 * Why the game refuses `action` at `intensity`, or null when it may run. Off
 * refuses everything; Commentary refuses anything outside
 * {@link COMMENTARY_ACTIONS} and anything not benign.
 */
export function intensityRefusal(
  intensity: AIIntensity,
  action: { readonly name: string; readonly severity: ActionSeverity },
): string | null {
  const policy = intensityPolicy(intensity);
  if (policy.policyMultiplier <= OFF_MULTIPLIER) return 'the player turned AI intensity off';
  const allowed = policy.allowedSeverities;
  if (allowed !== undefined && !allowed.includes(action.severity)) {
    return `the player's AI intensity allows only ${allowed.join(', ')} actions`;
  }
  if (policy.commentaryOnly && !isCommentaryAction(action.name)) {
    return `the player's AI intensity is commentary only, and ${action.name} would touch the run`;
  }
  return null;
}
