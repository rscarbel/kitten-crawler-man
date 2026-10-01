/**
 * What the dead of the cellars are, as data: the bone pile and the slumped
 * skeleton. Both are bone, both rattle apart into a low spread of bones and
 * dust, and a skeleton that was once a crawler may still have something on it.
 *
 * `DestructiblePropSystem` reads this table for every remains kind, so a new
 * piece is one row here plus its art.
 */

import type { BreakMaterial, SmashCue } from './breakMaterials';
import { BONE_PILE, SLUMPED_SKELETON } from '../../map/tileTypes';
import type { RemainsKind } from '../../sprites/art/remainsArt';
import type { PropContentsTable } from './serviceLevelPropKinds';

export interface RemainsPropKindDef {
  readonly tileType: number;
  readonly hp: number;
  readonly materials: readonly [BreakMaterial, ...BreakMaterial[]];
  readonly smashCue: SmashCue;
  readonly contents: PropContentsTable;
  /** The decal its break leaves round the wreckage. */
  readonly spill: 'bone_dust';
  /** Where its splinters come off, in tile heights from the tile centre; negative is up. */
  readonly splinterOffsetTiles: number;
  /** How tall a span its splinters come off over, in tile heights. */
  readonly splinterSpanTiles: number;
  readonly splinterShades: readonly [string, ...string[]];
}

const BONE_SHADES = ['#b2a787', '#918766', '#685f47', '#463f30'] as const;

/** Old bone is brittle: a heap comes apart under a few blows. */
const BONE_PILE_HP = 3;
/** A skeleton is held together by nothing but habit. */
const SKELETON_HP = 2;

/** A heap of the long dead, picked over long ago — the odd coin among the bones. */
const PILE_CONTENTS: PropContentsTable = { coinChance: 0.15, itemChance: 0, items: [] };

/**
 * A crawler who sat down and never got up: their purse is often still on
 * them, and now and then the potion they never drank.
 */
const SKELETON_CONTENTS: PropContentsTable = {
  coinChance: 0.6,
  itemChance: 0.08,
  items: [{ id: 'health_potion', weight: 1 }],
};

const LOW_SPLINTER_OFFSET = 0.05;
const LOW_SPLINTER_SPAN = 0.3;
/** A sitting skeleton's mass is its chest, a little above the tile's middle. */
const SKELETON_SPLINTER_OFFSET = -0.15;
const SKELETON_SPLINTER_SPAN = 0.6;

/** The smash cue closest to bone breaking: brittle and dry, like splitting wood. */
const BONE_SMASH_CUE: SmashCue = 'wood';

export const REMAINS_PROP_KINDS: Readonly<Record<RemainsKind, RemainsPropKindDef>> = {
  bone_pile: {
    tileType: BONE_PILE,
    hp: BONE_PILE_HP,
    materials: ['bone'],
    smashCue: BONE_SMASH_CUE,
    contents: PILE_CONTENTS,
    spill: 'bone_dust',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: BONE_SHADES,
  },
  slumped_skeleton: {
    tileType: SLUMPED_SKELETON,
    hp: SKELETON_HP,
    materials: ['bone', 'cloth'],
    smashCue: BONE_SMASH_CUE,
    contents: SKELETON_CONTENTS,
    spill: 'bone_dust',
    splinterOffsetTiles: SKELETON_SPLINTER_OFFSET,
    splinterSpanTiles: SKELETON_SPLINTER_SPAN,
    splinterShades: BONE_SHADES,
  },
};

export const REMAINS_PROP_KIND_LIST: ReadonlyArray<RemainsKind> = ['bone_pile', 'slumped_skeleton'];

export function isRemainsPropKind(kind: string): kind is RemainsKind {
  return kind === 'bone_pile' || kind === 'slumped_skeleton';
}

export function remainsPropKindForTileType(type: number): RemainsKind | null {
  if (type === BONE_PILE) return 'bone_pile';
  if (type === SLUMPED_SKELETON) return 'slumped_skeleton';
  return null;
}

export function perRemainsKind<T>(value: (def: RemainsPropKindDef) => T): Record<RemainsKind, T> {
  return {
    bone_pile: value(REMAINS_PROP_KINDS.bone_pile),
    slumped_skeleton: value(REMAINS_PROP_KINDS.slumped_skeleton),
  };
}
