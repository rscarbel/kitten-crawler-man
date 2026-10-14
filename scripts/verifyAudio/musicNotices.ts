/**
 * The music library's notices across a scene change, for `verify-audio.ts`:
 * what a HUD drained from the library but had not shown in full when its
 * scene ended goes back to the library for the next scene to post.
 */

import type { MusicTrackId } from '../../src/audio/sounds.js';
import { MusicLibrary, type MusicLibraryNotice } from '../../src/core/MusicLibrary.js';
import {
  NowPlayingCard,
  postMusicLibraryNotices,
  returnUnreadMusicNotices,
} from '../../src/ui/hud/nowPlaying.js';
import { HudToasts, MAX_VISIBLE_TOASTS } from '../../src/ui/hud/toasts.js';

type Check = (ok: boolean, message: string) => void;

/** More unlocks than the toast stack has rows, so some wait for one. */
const BURST = [
  'desperado_club_1',
  'desperado_club_2',
  'desperado_club_3',
  'desperado_club_4',
  'casino_background_jazz_1',
  'casino_background_jazz_2',
] as const satisfies readonly MusicTrackId[];
const HEARD: MusicTrackId = 'desperado_club_1';
/** Long enough that the toasts on screen have been read, short of any expiring. */
const TICKS_BEFORE_THE_DOOR = 90;

function describe(notice: MusicLibraryNotice): string {
  return notice.kind === 'backfilled'
    ? `backfilled:${notice.count}`
    : `${notice.kind}:${notice.id}`;
}

export function checkNoticesSurviveSceneChange(check: Check): void {
  const library = new MusicLibrary();
  library.markRequested(BURST);
  library.markAudible(HEARD);
  const hud = { toasts: new HudToasts(), nowPlaying: new NowPlayingCard() };
  postMusicLibraryNotices(library.drainNotices(), hud);
  for (let tick = 0; tick < TICKS_BEFORE_THE_DOOR; tick++) {
    hud.toasts.update();
    hud.nowPlaying.update();
  }
  returnUnreadMusicNotices(hud, library);
  hud.toasts.clear();
  hud.nowPlaying.clear();

  const returnedNotices = library.drainNotices();
  const returned = returnedNotices.map(describe);
  const waited = BURST.slice(MAX_VISIBLE_TOASTS).map((id) => `unlocked:${id}`);
  const expected = [...waited, `attribution:${HEARD}`];
  check(
    returned.join(',') === expected.join(','),
    `a scene change returns the unread notices, oldest first (got ${returned.join(', ') || 'none'})`,
  );

  const next = { toasts: new HudToasts(), nowPlaying: new NowPlayingCard() };
  postMusicLibraryNotices(returnedNotices, next);
  check(library.drainNotices().length === 0, 'a returned notice is given out once');
  returnUnreadMusicNotices(next, library);
  const reposted = library.drainNotices().map(describe);
  check(
    reposted.join(',') === expected.join(','),
    `notices posted in the next scene and never shown go back again (got ${reposted.join(', ') || 'none'})`,
  );
}
