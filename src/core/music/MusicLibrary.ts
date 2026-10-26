import { MUSIC_TRACK_IDS, type MusicBusId, type MusicTrackId } from '../../audio/sounds';
import type { GameProgressInput } from '../../auth/AuthClient';
import { isRecord } from '../util/guards';
import { musicUnlocksFromProgress } from './musicBackfill';
import type { PersistedWorldState } from '../save/PersistedWorldState';

/** The music library as a save stores it. */
export interface SerializedMusicLibrary {
  readonly unlocked: readonly MusicTrackId[];
  readonly heard: readonly MusicTrackId[];
  /** Unlocked songs the music page has not shown since they unlocked: its badge. */
  readonly menuUnseen: readonly MusicTrackId[];
  /**
   * Set only on a library a load has just built from the save's progress,
   * because the save predates the library. Building a {@link MusicLibrary} from
   * it raises one summary notice in place of an unlock notice per song;
   * `serialize` never writes it, so the summary is announced once.
   */
  readonly backfilled?: boolean;
}

/**
 * Something the library has to tell the player, held until the live scene's
 * HUD drains it:
 * - `unlocked`: a song unlocked the first time its place or activity asked for it.
 * - `attribution`: a song was heard for the first time, so its author is credited.
 * - `backfilled`: a save older than the library unlocked `count` songs from its progress.
 */
export type MusicLibraryNotice =
  | { readonly kind: 'unlocked'; readonly id: MusicTrackId }
  | { readonly kind: 'attribution'; readonly id: MusicTrackId }
  | { readonly kind: 'backfilled'; readonly count: number };

type UnlockListener = (id: MusicTrackId) => void;

/**
 * Songs every library starts with, new game or loaded save. Every player has
 * heard them before any library exists (the title screen plays with none
 * bound), so they start unlocked and heard but never announced: no unlock
 * notice, no credit and no music-page badge. A standing rule rather than
 * converted save data, so older saves pick them up on load.
 */
export const ALWAYS_UNLOCKED_TRACK_IDS = [
  'welcome_to_the_dungeon',
] as const satisfies readonly MusicTrackId[];

function musicTrackIdOf(value: unknown): MusicTrackId | undefined {
  return MUSIC_TRACK_IDS.find((id) => id === value);
}

function trackIdsIn(value: unknown): MusicTrackId[] {
  if (!Array.isArray(value)) return [];
  return value.map(musicTrackIdOf).filter((id) => id !== undefined);
}

/**
 * Which songs the player has unlocked and heard, for one run. Per save: a
 * load builds it from the save, a new game starts it with only
 * {@link ALWAYS_UNLOCKED_TRACK_IDS}, and Reset Game reloads the page, which
 * takes it with everything else.
 *
 * A song unlocks when something asks for it ({@link markRequested}), audible
 * or not, and is heard when it actually starts playing ({@link markAudible}).
 * Each first time queues a {@link MusicLibraryNotice}; the library never posts
 * anything itself, because a notice raised during a scene handover or under an
 * arrival screen has no HUD to land on yet.
 */
export class MusicLibrary {
  private readonly unlockedIds = new Set<MusicTrackId>();
  private readonly heardIds = new Set<MusicTrackId>();
  private readonly menuUnseenIds = new Set<MusicTrackId>();
  private readonly notices: MusicLibraryNotice[] = [];
  private readonly unlockListeners = new Set<UnlockListener>();

  constructor() {
    for (const id of ALWAYS_UNLOCKED_TRACK_IDS) {
      this.unlockedIds.add(id);
      this.heardIds.add(id);
    }
  }

  /**
   * Unlocks every catalogued song among `ids`. Takes anything the music bus
   * can play so a claim can hand over its whole selection: jingles are sound
   * effects and are skipped.
   */
  markRequested(ids: Iterable<MusicBusId>): void {
    for (const busId of ids) {
      const id = musicTrackIdOf(busId);
      if (id === undefined || this.unlockedIds.has(id)) continue;
      this.unlockedIds.add(id);
      this.menuUnseenIds.add(id);
      this.notices.push({ kind: 'unlocked', id });
      for (const listener of this.unlockListeners) listener(id);
    }
  }

  /**
   * Records that `id` is really playing. The first time, its author is
   * credited. A song can only be heard once something asked for it, so an
   * audible song still locked is unlocked here as well.
   */
  markAudible(id: MusicBusId): void {
    const trackId = musicTrackIdOf(id);
    if (trackId === undefined || this.heardIds.has(trackId)) return;
    this.markRequested([trackId]);
    this.heardIds.add(trackId);
    this.notices.push({ kind: 'attribution', id: trackId });
  }

  /**
   * Unlocks `ids` the way a backfilled save does: silently, unheard and
   * unbadged, so each still credits its author the first time it plays, with
   * one summary notice for the songs that were not already unlocked.
   */
  absorbBackfill(ids: Iterable<MusicTrackId>): void {
    let newlyUnlocked = 0;
    for (const id of ids) {
      if (this.unlockedIds.has(id)) continue;
      this.unlockedIds.add(id);
      newlyUnlocked += 1;
      for (const listener of this.unlockListeners) listener(id);
    }
    if (newlyUnlocked > 0) this.notices.push({ kind: 'backfilled', count: newlyUnlocked });
  }

  /** Every notice queued since the last drain, oldest first. */
  drainNotices(): MusicLibraryNotice[] {
    return this.notices.splice(0, this.notices.length);
  }

  /**
   * Puts back drained notices the player never got to read, ahead of any
   * raised since, for the next scene's HUD to post.
   */
  requeueNotices(notices: readonly MusicLibraryNotice[]): void {
    this.notices.unshift(...notices);
  }

  /** Called when the music page has been opened, which shows every new song. */
  clearMenuUnseen(): void {
    this.menuUnseenIds.clear();
  }

  /**
   * Calls `listener` with each song as it unlocks, for a shuffle of unlocked
   * songs to grow. Returns the unsubscribe.
   */
  onUnlock(listener: UnlockListener): () => void {
    this.unlockListeners.add(listener);
    return () => this.unlockListeners.delete(listener);
  }

  isUnlocked(id: MusicTrackId): boolean {
    return this.unlockedIds.has(id);
  }

  isHeard(id: MusicTrackId): boolean {
    return this.heardIds.has(id);
  }

  /** Unlocked songs in catalogue order. */
  get unlocked(): readonly MusicTrackId[] {
    return MUSIC_TRACK_IDS.filter((id) => this.unlockedIds.has(id));
  }

  get menuUnseenCount(): number {
    return this.menuUnseenIds.size;
  }

  serialize(): SerializedMusicLibrary {
    return {
      unlocked: this.unlocked,
      heard: MUSIC_TRACK_IDS.filter((id) => this.heardIds.has(id)),
      menuUnseen: MUSIC_TRACK_IDS.filter((id) => this.menuUnseenIds.has(id)),
    };
  }

  /**
   * A library from a save's untrusted JSON. Ids no longer in the catalogue are
   * dropped, and a heard or unseen song is only kept if it is unlocked.
   */
  static fromSerialized(value: unknown): MusicLibrary {
    const library = new MusicLibrary();
    if (!isRecord(value)) return library;
    const unlockedBeforeSave = library.unlockedIds.size;
    for (const id of trackIdsIn(value.unlocked)) library.unlockedIds.add(id);
    for (const id of trackIdsIn(value.heard)) {
      if (library.unlockedIds.has(id)) library.heardIds.add(id);
    }
    for (const id of trackIdsIn(value.menuUnseen)) {
      if (library.unlockedIds.has(id)) library.menuUnseenIds.add(id);
    }
    const unlockedBySave = library.unlockedIds.size - unlockedBeforeSave;
    const backfilledCount = value.backfilled === true ? unlockedBySave : 0;
    if (backfilledCount > 0) library.notices.push({ kind: 'backfilled', count: backfilledCount });
    return library;
  }

  /**
   * The library a save older than the library had earned, for a save loaded
   * with none: see {@link musicUnlocksFromProgress}. Its songs unlock silently
   * and none is heard, so each one still credits its author the first time it
   * plays; one summary notice stands in for all their unlock notices.
   */
  static backfillFromProgress(
    progress: GameProgressInput,
    persisted: PersistedWorldState | undefined,
  ): MusicLibrary {
    return MusicLibrary.fromSerialized(backfilledMusicLibrary(progress, persisted));
  }

  /** The library a save carries, or the one its progress earned when it carries none. */
  static forSave(progress: GameProgressInput): MusicLibrary {
    return progress.musicLibrary === undefined
      ? MusicLibrary.backfillFromProgress(progress, progress.world?.persisted)
      : MusicLibrary.fromSerialized(progress.musicLibrary);
  }
}

/**
 * {@link MusicLibrary.backfillFromProgress} in its stored form, for a load to
 * hand on before any scene exists to build the library.
 */
export function backfilledMusicLibrary(
  progress: GameProgressInput,
  persisted: PersistedWorldState | undefined,
): SerializedMusicLibrary {
  const unlockedIds = musicUnlocksFromProgress(progress, persisted);
  return {
    unlocked: MUSIC_TRACK_IDS.filter((id) => unlockedIds.has(id)),
    heard: [],
    menuUnseen: [],
    backfilled: true,
  };
}

/**
 * The library of the run being played.
 *
 * A module-level binding rather than a field passed around, because the music
 * director lives on the `AudioManager`, which outlives every scene and every
 * run. Each floor scene binds its run's library as it is entered; every scene
 * of one run holds the same object, so a building interior, which binds
 * nothing, still records into the run's library. Harnesses that never bind
 * simply record nothing.
 */
let boundMusicLibrary: MusicLibrary | null = null;

const boundListeners = new Set<() => void>();

export function bindMusicLibrary(library: MusicLibrary | null): void {
  if (library === boundMusicLibrary) return;
  boundMusicLibrary = library;
  for (const listener of boundListeners) listener();
}

/**
 * Calls `listener` each time another library is bound, for the music player
 * to follow the run being played. Returns the unsubscribe.
 */
export function onMusicLibraryBound(listener: () => void): () => void {
  boundListeners.add(listener);
  return () => boundListeners.delete(listener);
}

export function activeMusicLibrary(): MusicLibrary | null {
  return boundMusicLibrary;
}
