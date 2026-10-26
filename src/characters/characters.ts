/**
 * The game's named characters: who each one is, what species they are, and
 * whether the player controls them. This registry is the one source of every
 * crawler's display name; UI, dialog headers and the AI context read names
 * from here rather than spelling them out.
 */

import type { CrawlerKind } from '../core/skills/SkillManager';
import type { SpeakerId } from '../dialog/speakers';
import type { CatLook } from '../sprites/looks/catLook';
import { BELLE_LOOK } from '../sprites/looks/cats/belle';
import { PUMPKIN_LOOK } from '../sprites/looks/cats/pumpkin';
import type { HumanLook } from '../sprites/looks/humanLook';
import { DAVE_LOOK } from '../sprites/looks/humans/dave';
import { RYAN_LOOK } from '../sprites/looks/humans/ryan';

export type CharacterId = 'dave' | 'ryan' | 'pumpkin' | 'belle';

interface CharacterDefBase<Species extends CrawlerKind> {
  readonly species: Species;
  /** The short name every label, hint and AI payload uses. */
  readonly displayName: string;
  /** The name in full, where the character is announced rather than referred to: dialog headers, prize cards. */
  readonly formalName: string;
  /** The character's entry in `SPEAKERS`, for lines they speak. */
  readonly speakerId: SpeakerId;
  /** Whether the player controls this character as one of the two crawlers. */
  readonly plays: boolean;
}

export interface HumanCharacterDef extends CharacterDefBase<'human'> {
  /** How he is painted. */
  readonly look: HumanLook;
}
export interface CatCharacterDef extends CharacterDefBase<'cat'> {
  /** How she is painted. */
  readonly look: CatLook;
}
export type CharacterDef = HumanCharacterDef | CatCharacterDef;

/** Whether a character is a cat: narrows any registry entry to its cat definition. */
export function isCatCharacter<C extends CharacterDef>(
  character: C,
): character is Extract<C, CatCharacterDef> {
  return character.species === 'cat';
}

/** Whether a character is a human: narrows any registry entry to its human definition. */
export function isHumanCharacter<C extends CharacterDef>(
  character: C,
): character is Extract<C, HumanCharacterDef> {
  return character.species === 'human';
}

export const CHARACTERS = {
  dave: {
    species: 'human',
    displayName: 'Dave',
    formalName: 'Dave',
    speakerId: 'ryan',
    plays: false,
    look: DAVE_LOOK,
  },
  ryan: {
    species: 'human',
    displayName: 'Ryan',
    formalName: 'Ryan',
    speakerId: 'ryan',
    plays: true,
    look: RYAN_LOOK,
  },
  pumpkin: {
    species: 'cat',
    displayName: 'Pumpkin',
    formalName: 'Pumpkin',
    speakerId: 'belle',
    plays: false,
    look: PUMPKIN_LOOK,
  },
  belle: {
    species: 'cat',
    displayName: 'Belle',
    formalName: 'Belle',
    speakerId: 'belle',
    plays: true,
    look: BELLE_LOOK,
  },
} as const satisfies Record<CharacterId, CharacterDef>;

/** The characters of `Species` the player may control; a character with `plays: false` never fills a crawler slot. */
type PlayableCharacterIdOfSpecies<Species extends CrawlerKind> = {
  [Id in CharacterId]: (typeof CHARACTERS)[Id] extends {
    readonly species: Species;
    readonly plays: true;
  }
    ? Id
    : never;
}[CharacterId];

/** Which character the player controls as each crawler; a crawler is always played by a playable character of its own species. */
export const PLAYER_CHARACTERS = {
  human: 'ryan',
  cat: 'belle',
} as const satisfies { [Kind in CrawlerKind]: PlayableCharacterIdOfSpecies<Kind> };

type PlayerCharacters = typeof PLAYER_CHARACTERS;

/** The display name of the character playing crawler `Kind`, as a literal type. */
export type CrawlerNameOf<Kind extends CrawlerKind> =
  (typeof CHARACTERS)[PlayerCharacters[Kind]]['displayName'];

/** Either crawler's display name. */
export type PlayerCharacterName = CrawlerNameOf<CrawlerKind>;

/** The `SPEAKERS` entry of whichever character plays either crawler: the voices a crawler's lines can take. */
export type PlayerSpeakerId = (typeof CHARACTERS)[PlayerCharacters[CrawlerKind]]['speakerId'];

/** The character the player controls as crawler `kind`. */
export function playerCharacter<Kind extends CrawlerKind>(
  kind: Kind,
): (typeof CHARACTERS)[PlayerCharacters[Kind]] {
  return CHARACTERS[PLAYER_CHARACTERS[kind]];
}

/** The display name of the character playing crawler `kind`, for any UI that must name one of them. */
export function crawlerName<Kind extends CrawlerKind>(kind: Kind): CrawlerNameOf<Kind> {
  return playerCharacter(kind).displayName;
}

/** The full name of the character playing crawler `kind`, as their dialog header announces them. */
export function crawlerFormalName(kind: CrawlerKind): string {
  return characterFormalName(PLAYER_CHARACTERS[kind]);
}

/**
 * A character's full name. Its return type is spelled out rather than read off
 * `CHARACTERS` because `SPEAKERS` heads its lines with it, and `SPEAKERS` is
 * what `CharacterDef.speakerId` is typed against: an inferred type here would
 * make the two definitions depend on each other.
 */
function characterFormalName(id: CharacterId): string {
  return CHARACTERS[id].formalName;
}
