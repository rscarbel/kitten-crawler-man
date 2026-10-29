import type { MusicBusId } from '../sounds';

/**
 * Sets of stems: recordings of one piece, the same length, cut from the same
 * mix with layers taken out, so any of them can take over from another at
 * the same point in the bar. The first stem of each set is the full mix; the
 * rest are levelled with its loudness trim rather than their own, so taking
 * a layer out sounds like a layer leaving, not like the others getting louder.
 *
 * A set loops from the top of its recordings, decoded, with no gap: its stems
 * must not be streamed, which `check:audio` holds them to.
 */
export const MUSIC_STEM_SETS = {
  /** The Kraken's flooded pump room, losing a layer for each pump shut off. */
  kraken_flooded: ['the_kraken_flooded', 'the_kraken_flooded_2pumps', 'the_kraken_flooded_1pump'],
  /** The tower split in two: the descent's light half, the ascent's low half, and both together. */
  tower_split: ['tower_split_full', 'tower_split_descent', 'tower_split_ascent'],
  /** The Warden's ritual, without the cat theme while the cats are still bound. */
  warden_ritual: ['warden_ritual_battle', 'warden_ritual_battle_bound'],
  /** The dusk stakeout, which becomes the rooftop chase when the thief swoops. */
  rooftop_chase: ['rooftop_chase', 'rooftop_chase_stakeout'],
} as const satisfies Record<string, readonly [MusicBusId, ...MusicBusId[]]>;

export type MusicStemSetId = keyof typeof MUSIC_STEM_SETS;

/** The stems of `S`. */
export type MusicStemOf<S extends MusicStemSetId> = (typeof MUSIC_STEM_SETS)[S][number];

const MUSIC_STEM_SET_IDS = Object.keys(MUSIC_STEM_SETS).filter(isStemSetId);

function isStemSetId(value: string): value is MusicStemSetId {
  return value in MUSIC_STEM_SETS;
}

/** The set `id` is a stem of, or null for a recording in no set. */
function stemSetOf(id: MusicBusId): MusicStemSetId | null {
  const stemsOf = (set: MusicStemSetId): readonly MusicBusId[] => MUSIC_STEM_SETS[set];
  return MUSIC_STEM_SET_IDS.find((set) => stemsOf(set).includes(id)) ?? null;
}

/**
 * The recording whose loudness trim `id` plays at: its set's full mix for a
 * stem, otherwise itself.
 */
export function musicTrimIdOf(id: MusicBusId): MusicBusId {
  const set = stemSetOf(id);
  return set === null ? id : MUSIC_STEM_SETS[set][0];
}
