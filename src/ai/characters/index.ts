import { DAVE_CHARACTER } from './dave';
import { CAROLINE_CHARACTER } from './caroline';
import type { AICharacterDefinition } from './types';

export type {
  AICharacterDefinition,
  ActingConstraints,
  CharacterPersonality,
  CharacterVoice,
  KnowledgeScope,
} from './types';
export { CAROLINE_CHARACTER, CAROLINE_CHARACTER_NAME } from './caroline';
export { DAVE_CHARACTER, DAVE_CHARACTER_NAME } from './dave';

/** Every authored character, enabled or not, in the order they are synced to the server. */
export const AI_CHARACTERS: readonly AICharacterDefinition[] = [CAROLINE_CHARACTER, DAVE_CHARACTER];

/** The characters the game talks to this session. */
export function enabledCharacters(): AICharacterDefinition[] {
  return AI_CHARACTERS.filter((character) => character.enabled);
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * The character's fixed identity: its core, its role and the plain-language
 * rules it acts under. The AI server keeps only `personality.core` as
 * never-evolving identity and drops any other free-text field, so the role and
 * the acting rules have to ride inside it to reach the model at all.
 */
export function renderCharacterCore(character: AICharacterDefinition): string {
  const { personality, role, actingConstraints } = character;
  const sections = [personality.core, `Your role: ${role}.`];
  if (actingConstraints.notes.length > 0) {
    sections.push(`Rules you act under:\n${bulletList(actingConstraints.notes)}`);
  }
  return sections.join('\n\n');
}

/**
 * Flattens a character's structured identity into a single prompt, for servers
 * that take a character as one block of text rather than structured state.
 */
export function renderCharacterPrompt(character: AICharacterDefinition): string {
  const { personality } = character;
  const traitLines = Object.entries(personality.traits).map(
    ([trait, value]) => `${trait}: ${value.toFixed(2)}`,
  );
  const sections = [
    renderCharacterCore(character),
    `Voice:\n${bulletList(personality.voice.rules)}`,
    `Lines you may reach for (vary them, never repeat one twice running):\n${bulletList(personality.voice.catchphrases)}`,
    `Starting temperament (0 to 1):\n${bulletList(traitLines)}`,
    `What you want:\n${bulletList(personality.goals)}`,
  ];
  return sections.join('\n\n');
}
