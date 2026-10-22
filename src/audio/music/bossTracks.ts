import type { EventBus } from '../../core/EventBus';
import type { MusicTrackId } from '../sounds';
import type { MusicClaims } from '../AudioScope';

/** Miss Quill's track in the tower finale. */
export const QUILL_TRACK = 'boss_music_3' as const satisfies MusicTrackId;
/** The Lich's track in the tower finale. */
export const LICH_TRACK = 'boss_music_2' as const satisfies MusicTrackId;

/** Every boss not named in {@link BOSS_TRACKS} fights to this. */
const DEFAULT_BOSS_TRACK = 'boss_music_3' as const satisfies MusicTrackId;

/**
 * The track each boss fights to. Null for a boss whose fight scores itself:
 * the tower finale runs Quill, a silence and the Lich as one claim.
 */
const BOSS_TRACKS: Readonly<Partial<Record<string, MusicTrackId | null>>> = {
  trash_gremlin: 'boss_music_1',
  big_rooster: 'boss_music_2',
  miss_quill: null,
  the_lich: null,
};

/** The track `bossType` fights to, or null when its own fight claims the music. */
export function bossTrack(bossType: string): MusicTrackId | null {
  const track = BOSS_TRACKS[bossType];
  return track === undefined ? DEFAULT_BOSS_TRACK : track;
}

/**
 * Claims the boss's track when a fight is joined — a boss room locking, a
 * bounty committing, the spider's lab sealing — and lets go when a boss
 * falls, so the floor's or zone's music comes back on its own.
 */
export function wireBossMusic(bus: EventBus, music: MusicClaims): void {
  bus.on('bossFightInitiated', (e) => {
    const track = bossTrack(e.bossType);
    if (track === null) return;
    music.claimMusic({ owner: 'boss', layer: 'boss', selection: { kind: 'loop', id: track } });
  });
  bus.on('bossDefeated', (e) => {
    if (bossTrack(e.bossType) === null) return;
    music.releaseMusic('boss');
  });
}
