import type { MusicLibrary } from '../../core/MusicLibrary';
import { settings, type MusicPlaybackPreference } from '../../core/Settings';
import type { MusicPlayerControls, MusicPlayerMode } from './MusicDirector';

/** What a player mode leaves behind for the next load; play-once and area music leave nothing. */
export function playbackPreferenceOf(mode: MusicPlayerMode): MusicPlaybackPreference | undefined {
  switch (mode.kind) {
    case 'shuffle':
      return { mode: 'shuffle' };
    case 'repeat':
      return { mode: 'repeat', track: mode.id };
    case 'once':
    case 'area':
      return undefined;
  }
}

/** Stores the mode the player just picked so a reload comes back to it. */
export function rememberMusicPlayback(mode: MusicPlayerMode): void {
  settings.setMusicPlayback(playbackPreferenceOf(mode));
}

/**
 * Puts the remembered mode back once a run's library is bound. Only a player
 * still on area music is touched, so entering another floor never restarts a
 * song already on repeat. A remembered song this save has not unlocked is
 * forgotten, and the music stays with the area.
 */
export function restoreMusicPlayback(
  player: Pick<MusicPlayerControls, 'playerMode' | 'repeat' | 'shuffleUnlocked'>,
  library: MusicLibrary,
): void {
  const preference = settings.musicPlayback;
  if (preference === undefined || player.playerMode.kind !== 'area') return;
  switch (preference.mode) {
    case 'shuffle':
      player.shuffleUnlocked();
      return;
    case 'repeat':
      if (library.isUnlocked(preference.track)) player.repeat(preference.track);
      else settings.setMusicPlayback(undefined);
      return;
  }
}
