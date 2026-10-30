import type { EventBus } from '../../core/EventBus';
import type { MusicTrackId } from '../sounds';
import type { MusicClaims } from '../AudioScope';
import { MUSIC_STEM_SETS } from './stemSets';
import type { GauntletBossType } from '../../map/bossRoomSizes';
import type { BountyTypeId } from '../../core/mobs/bossTypes';

/** The Kraken's track once her room has drained and she fights. */
export const KRAKEN_BATTLE_TRACK = 'the_kraken_battle' as const satisfies MusicTrackId;

/** The track a boss with no song of its own fights to. */
const SHARED_BOSS_TRACK = 'boss_music_3' as const satisfies MusicTrackId;

/** Every boss whose fight is announced with `bossFightInitiated`. */
type BossMusicType = GauntletBossType | BountyTypeId | 'grotesque_spider' | 'the_lich';

/**
 * How a boss's fight is scored:
 *
 * - `track`: the boss layer loops this track from the fight joined to the boss's fall.
 * - `scoredByFight`: the fight claims its own music as it goes (the tower
 *   finale's Lich; the Kraken's room following its pumps).
 *   `tracks` are the catalogued songs it can play, which a run's progress
 *   unlocks as it would a `track`.
 */
type BossMusic =
  | { readonly kind: 'track'; readonly track: MusicTrackId }
  | { readonly kind: 'scoredByFight'; readonly tracks: readonly MusicTrackId[] };

const SHARED_BOSS_MUSIC: BossMusic = { kind: 'track', track: SHARED_BOSS_TRACK };

const BOSS_MUSIC: Readonly<Record<BossMusicType, BossMusic>> = {
  trash_gremlin: { kind: 'track', track: 'king_of_the_heap' },
  big_rooster: { kind: 'track', track: 'boss_music_2' },
  electric_goblin: SHARED_BOSS_MUSIC,
  grotesque_spider: SHARED_BOSS_MUSIC,
  evil_clown: SHARED_BOSS_MUSIC,
  mantid: SHARED_BOSS_MUSIC,
  skeleton_lord: SHARED_BOSS_MUSIC,
  dark_knight: SHARED_BOSS_MUSIC,
  rock_golem: SHARED_BOSS_MUSIC,
  kraken: {
    kind: 'scoredByFight',
    tracks: [MUSIC_STEM_SETS.kraken_flooded[0], KRAKEN_BATTLE_TRACK],
  },
  the_lich: { kind: 'scoredByFight', tracks: [MUSIC_STEM_SETS.warden_ritual[0]] },
};

/** Boss events carry their boss as a plain string, so a listener checks it against the table. */
function isBossMusicType(bossType: string): bossType is BossMusicType {
  return Object.prototype.hasOwnProperty.call(BOSS_MUSIC, bossType);
}

/** The track the boss layer loops for `bossType`, or null when its own fight claims the music. */
export function bossTrack(bossType: BossMusicType): MusicTrackId | null {
  const music = BOSS_MUSIC[bossType];
  switch (music.kind) {
    case 'track':
      return music.track;
    case 'scoredByFight':
      return null;
    default: {
      const unhandled: never = music;
      return unhandled;
    }
  }
}

/** Every catalogued song `bossType`'s fight can play, for unlocking from a run's progress. */
export function bossFightTracks(bossType: BossMusicType): readonly MusicTrackId[] {
  const music = BOSS_MUSIC[bossType];
  switch (music.kind) {
    case 'track':
      return [music.track];
    case 'scoredByFight':
      return music.tracks;
    default: {
      const unhandled: never = music;
      return unhandled;
    }
  }
}

/**
 * Claims the boss's track when a fight is joined — a boss room locking, a
 * bounty committing, the spider's lab sealing — and lets go when a boss
 * falls, so the floor's or zone's music comes back on its own.
 */
export function wireBossMusic(bus: EventBus, music: MusicClaims): void {
  bus.on('bossFightInitiated', (e) => {
    if (!isBossMusicType(e.bossType)) {
      console.warn(`[bossTracks] No music listed for boss "${e.bossType}"`);
      return;
    }
    const track = bossTrack(e.bossType);
    if (track === null) return;
    music.claimMusic({ owner: 'boss', layer: 'boss', selection: { kind: 'loop', id: track } });
  });
  // Any fallen boss lets the boss layer go, listed or not: releasing a claim
  // nothing holds is harmless, and a held one must never outlive its fight.
  bus.on('bossDefeated', (e) => {
    const scoresItsOwnFight = isBossMusicType(e.bossType) && bossTrack(e.bossType) === null;
    if (scoresItsOwnFight) return;
    music.releaseMusic('boss');
  });
}
