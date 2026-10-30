/**
 * The game's named characters: who each one is, what species they are, and
 * whether the player controls them. With the player's own identity
 * (`playerIdentity.ts`), this registry is the one source of every crawler's
 * name; UI, dialog headers and the AI context read names through
 * `crawlerName` rather than spelling them out.
 */

import { isolateForDisplay } from '../core/text/isolateName';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { SpeakerId } from '../dialog/speakers';
import { playerIdentity } from './playerIdentity';

/** The registry's characters. The player's human is not one: their name and look are the player's own choice. */
export const CHARACTER_IDS = ['dave', 'pumpkin', 'belle'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

interface CharacterDefBase<Species extends CrawlerKind> {
  readonly species: Species;
  /** The name every label, hint, dialog header and AI payload uses. */
  readonly displayName: string;
  /** The character's entry in `SPEAKERS`, for lines they speak. */
  readonly speakerId: SpeakerId;
  /** Whether the player controls this character as one of the two crawlers. */
  readonly plays: boolean;
}

/** A registry character; how each is painted is `CHARACTER_LOOKS` (`characterLooks.ts`), kept apart so names load without art. */
export type CharacterDef = CharacterDefBase<'human'> | CharacterDefBase<'cat'>;

/** The registry characters of `Species`. */
export type CharacterIdOfSpecies<Species extends CrawlerKind> = {
  [Id in CharacterId]: (typeof CHARACTERS)[Id]['species'] extends Species ? Id : never;
}[CharacterId];

/** Whether registry character `id` is a cat. */
export function isCatCharacterId(id: CharacterId): id is CharacterIdOfSpecies<'cat'> {
  return CHARACTERS[id].species === 'cat';
}

export const CHARACTERS = {
  dave: {
    species: 'human',
    displayName: 'Dave',
    speakerId: 'dave',
    plays: false,
  },
  pumpkin: {
    species: 'cat',
    displayName: 'Pumpkin',
    speakerId: 'pumpkin',
    plays: false,
  },
  belle: {
    species: 'cat',
    displayName: 'Belle',
    speakerId: 'belle',
    plays: true,
  },
} as const satisfies Record<CharacterId, CharacterDef>;

/** The registry's characters the player may control as the cat; a character with `plays: false` never fills the slot. */
type PlayableCatId = {
  [Id in CharacterId]: (typeof CHARACTERS)[Id] extends {
    readonly species: 'cat';
    readonly plays: true;
  }
    ? Id
    : never;
}[CharacterId];

/** Which registry character the player controls as the cat. The human is the player's own, so has no entry. */
export const PLAYER_CHARACTERS = {
  cat: 'belle',
} as const satisfies { readonly cat: PlayableCatId };

/** The registry character the player controls as the cat. */
export function playerCharacter(kind: 'cat') {
  return CHARACTERS[PLAYER_CHARACTERS[kind]];
}

/** The `SPEAKERS` entry each crawler's lines are spoken through. */
export const CRAWLER_SPEAKERS = {
  human: 'human_crawler',
  cat: CHARACTERS[PLAYER_CHARACTERS.cat].speakerId,
} as const satisfies Record<CrawlerKind, SpeakerId>;

/** The voices a crawler's lines can take. */
export type CrawlerSpeakerId = (typeof CRAWLER_SPEAKERS)[CrawlerKind];

/**
 * Crawler `kind`'s name, bare. Text shown on screen takes
 * {@link crawlerDisplayName} and text for the AI takes {@link crawlerAIName}
 * instead. Read when the text is built, never captured at load: the human's
 * name is the player's and is not known until a run has one.
 */
export function crawlerName(kind: CrawlerKind): string {
  return kind === 'human' ? playerIdentity().name : playerCharacter(kind).displayName;
}

/** Crawler `kind`'s name, ready to set into a line of on-screen text. Never stored and never sent to the AI. */
export function crawlerDisplayName(kind: CrawlerKind): string {
  return isolateForDisplay(crawlerName(kind));
}

/** How every summary, quest, item and action result sent to the AI names the human crawler. */
export const HUMAN_CRAWLER_AI_NAME = 'the human crawler';

/**
 * Crawler `kind` as the AI is told of them. The human's typed name is player
 * text the AI server fences as untrusted, so it travels only as
 * `humanCrawler.name` in the session context and never inside other text.
 */
export function crawlerAIName(kind: CrawlerKind): string {
  return kind === 'human' ? HUMAN_CRAWLER_AI_NAME : playerCharacter(kind).displayName;
}
