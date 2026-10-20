/**
 * The shape every AI character's authored identity takes. The server keeps a
 * per-player copy of `personality` that drifts with play; `core` and `voice`
 * are author-owned and never rewritten by the model.
 */

/** "omniscient" characters perceive every game event; "witnessed" ones only events tagged with their name. */
export type KnowledgeScope = 'omniscient' | 'witnessed';

export interface CharacterVoice {
  /** How the character speaks, as instructions the prompt assembler can list verbatim. */
  rules: readonly string[];
  /** Lines the character may reach for; the model is told to vary them, not repeat them. */
  catchphrases: readonly string[];
}

export interface CharacterPersonality {
  /** Author-written identity. Never modified by the AI. */
  core: string;
  voice: CharacterVoice;
  /** Starting trait values in 0..1; the server drifts them per player within bounded steps. */
  traits: Readonly<Record<string, number>>;
  goals: readonly string[];
}

/**
 * Context flags (the keys of `SessionFlags`) a character's actions are gated on.
 * The server enforces these per tool policy; the game enforces them again before
 * executing anything.
 */
export interface ActingConstraints {
  requiresContext: readonly string[];
  forbidsContext: readonly string[];
  /** Plain-language limits the prompt states and the action governor mirrors. */
  notes: readonly string[];
}

export interface AICharacterDefinition {
  /** The name the server and every protocol message use for this character. */
  name: string;
  role: string;
  knowledgeScope: KnowledgeScope;
  personality: CharacterPersonality;
  /** Tool names this character may call; the server rejects anything else. */
  allowedTools: readonly string[];
  actingConstraints: ActingConstraints;
  /** Whether the character receives the live event stream as it happens. */
  receiveLogStream: boolean;
  /** Characters that are authored but switched off are still synced, never connected. */
  enabled: boolean;
}
