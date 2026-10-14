/**
 * The song credit card: the display title and the recording's attribution,
 * beside a music note that sways while two small notes drift off it. It shows
 * the first time a song is actually heard, in its own lane under the top band
 * rather than in the toast stack, so a burst of unlock toasts can never push
 * an author's credit off the screen.
 *
 * Like the toasts, it ages by update tick and takes no input. A new credit
 * replaces the one showing in place, without sliding in again.
 */

import { MUSIC_TRACK_IDS, type MusicTrackId } from '../../audio/sounds';
import type { MusicLibraryNotice } from '../../core/MusicLibrary';
import { formatAttribution, MUSIC_CATALOG } from '../../audio/music/catalog';
import type { Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor, type TextRole } from '../theme/skins';
import { motion } from '../theme/tokens';
import { drawGlass } from '../widgets/paint';
import { measureText, measureTextHeight, text } from '../widgets/text';
import type { HudToasts } from './toasts';

const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

function msToTicks(ms: number): number {
  return Math.max(1, Math.round((ms * TICKS_PER_SECOND) / MS_PER_SECOND));
}

/** How long a credit stays up, fade included. */
export const NOW_PLAYING_DISPLAY_TICKS = msToTicks(motion.nowPlayingDisplay);
const NOW_PLAYING_ENTER_TICKS = msToTicks(motion.base);
const NOW_PLAYING_FADE_TICKS = msToTicks(motion.slow);
const EASE_OUT_POWER = 3;

/** The note's square against a toast's glyph: the card's one piece of art. */
const NOTE_SCALE = 1.5;
/** A drifting note against the main one. */
const DRIFT_NOTE_SCALE = 0.5;
const DRIFT_NOTE_COUNT = 2;
/** How far the main note rises and falls, as a fraction of its side. */
const NOTE_BOB_FRACTION = 0.06;
/** How far the main note tilts each way, in radians. */
const NOTE_TILT_RADIANS = 0.16;
/** How far a drifting note climbs over its life, in note sides. */
const DRIFT_RISE_FRACTION = 0.9;
/** How far a drifting note wanders sideways, in note sides. */
const DRIFT_SWAY_FRACTION = 0.12;
/** The fraction of a drifting note's life spent fading in; the rest fades it out. */
const DRIFT_FADE_IN_FRACTION = 0.2;
const DRIFT_NOTE_ALPHA = 0.8;
const BORDER_TINT_ALPHA = 0.35;
/**
 * A compact screen's credit wraps as far as the catalogue's longest needs in
 * the narrowest lane, a small phone on its side: a credit is never cut short.
 */
const CREDIT_MAX_LINES = { compact: 6, roomy: 2 } as const;
/** A compact lane can be too narrow for a long title on one line. */
const TITLE_MAX_LINES = { compact: 2, roomy: 1 } as const;
const TITLE_ROLE: TextRole = 'label';
const CREDIT_ROLE: TextRole = 'caption';
const FULL_TURN = Math.PI * 2;

/** One song's credit, as the card shows it. */
export interface NowPlayingCredit {
  /** The catalogue song credited, so an unfinished card can be shown again elsewhere. */
  readonly id?: MusicTrackId;
  /** The display title. */
  readonly title: string;
  /** The attribution line, from `formatAttribution`. */
  readonly credit: string;
}

/** The card as the renderer sees it. */
export interface ShownCredit extends NowPlayingCredit {
  /** Ticks since the card first appeared. */
  readonly age: number;
  readonly ticksLeft: number;
}

interface CreditState {
  id: MusicTrackId | undefined;
  title: string;
  credit: string;
  age: number;
  ticksLeft: number;
}

/** The one credit card a scene's HUD shows. */
export class NowPlayingCard {
  private current: CreditState | null = null;

  /** The card showing, or null. */
  get shown(): ShownCredit | null {
    return this.current;
  }

  get isShowing(): boolean {
    return this.current !== null;
  }

  /** Shows `credit`, replacing a card already up in place. */
  show(credit: NowPlayingCredit): void {
    const age = this.current?.age ?? 0;
    this.current = { id: credit.id, ...credit, age, ticksLeft: NOW_PLAYING_DISPLAY_TICKS };
  }

  /** Call once per game tick. */
  update(): void {
    const current = this.current;
    if (current === null) return;
    current.age++;
    current.ticksLeft--;
    if (current.ticksLeft <= 0) this.current = null;
  }

  /** Drops the card, for scene teardown. */
  clear(): void {
    this.current = null;
  }
}

/** The credit card for catalogue song `id`. */
export function musicCredit(id: MusicTrackId): NowPlayingCredit {
  const def = MUSIC_CATALOG[id];
  return { id, title: def.title, credit: formatAttribution(def) };
}

const MUSIC_UNLOCK_KEY_PREFIX = 'music-unlock:';
const MUSIC_BACKFILL_KEY_PREFIX = 'music-backfill:';
/**
 * A music toast up at least this long has been read; one up for less, when
 * its scene ends, is posted again in the next.
 */
const MUSIC_TOAST_READ_TICKS = msToTicks(MS_PER_SECOND);

/** The toast for a song joining the music library. Queued, so a burst of unlocks reads in full. */
export function postMusicUnlockToast(toasts: HudToasts, id: MusicTrackId): void {
  toasts.post(`Music Unlocked: ${MUSIC_CATALOG[id].title}`, {
    icon: 'music',
    key: `${MUSIC_UNLOCK_KEY_PREFIX}${id}`,
    merge: false,
    overflow: 'queue',
  });
}

/** The one toast that stands in for every song an old save's progress unlocked at once. */
export function postMusicBackfillToast(toasts: HudToasts, count: number): void {
  const songs = count === 1 ? 'song' : 'songs';
  toasts.post(`Music Library: ${count} ${songs} unlocked from your progress`, {
    icon: 'music',
    key: `${MUSIC_BACKFILL_KEY_PREFIX}${count}`,
    merge: false,
    overflow: 'queue',
  });
}

/**
 * Posts the music library's notices to a scene's HUD: an unlock toast, a
 * credit card, or the one backfill summary. A scene drains the library into
 * this once per tick, after its arrival screen is down, so nothing raised
 * during a handover is posted to a HUD nobody can see.
 */
export function postMusicLibraryNotices(
  notices: readonly MusicLibraryNotice[],
  hud: { readonly toasts: HudToasts; readonly nowPlaying: NowPlayingCard },
): void {
  for (const notice of notices) {
    switch (notice.kind) {
      case 'unlocked':
        postMusicUnlockToast(hud.toasts, notice.id);
        break;
      case 'attribution':
        hud.nowPlaying.show(musicCredit(notice.id));
        break;
      case 'backfilled':
        postMusicBackfillToast(hud.toasts, notice.count);
        break;
    }
  }
}

function noticeForToastKey(key: string): MusicLibraryNotice | null {
  if (key.startsWith(MUSIC_UNLOCK_KEY_PREFIX)) {
    const raw = key.slice(MUSIC_UNLOCK_KEY_PREFIX.length);
    const id = MUSIC_TRACK_IDS.find((candidate) => candidate === raw);
    return id === undefined ? null : { kind: 'unlocked', id };
  }
  if (key.startsWith(MUSIC_BACKFILL_KEY_PREFIX)) {
    const count = Number(key.slice(MUSIC_BACKFILL_KEY_PREFIX.length));
    return Number.isInteger(count) && count > 0 ? { kind: 'backfilled', count } : null;
  }
  return null;
}

/**
 * Hands the music notices a scene's HUD has not shown in full back to the
 * library before the scene tears its HUD down: unlock toasts still waiting,
 * held off screen or only just up, and a credit card still showing. The
 * library has already given them out once, so without this a door walked
 * through mid-burst would spend them unread. The next scene posts them again,
 * the card with a fresh display.
 */
export function returnUnreadMusicNotices(
  hud: { readonly toasts: HudToasts; readonly nowPlaying: NowPlayingCard },
  library: { requeueNotices(notices: readonly MusicLibraryNotice[]): void },
): void {
  const notices = hud.toasts
    .unreadKeys(MUSIC_TOAST_READ_TICKS)
    .map(noticeForToastKey)
    .filter((notice) => notice !== null);
  const creditId = hud.nowPlaying.shown?.id;
  if (creditId !== undefined) notices.push({ kind: 'attribution', id: creditId });
  if (notices.length > 0) library.requeueNotices(notices);
}

function easeOut(linear: number): number {
  return 1 - Math.pow(1 - linear, EASE_OUT_POWER);
}

interface CardMetrics {
  readonly padX: number;
  readonly padY: number;
  readonly gap: number;
  readonly note: number;
  readonly creditLines: number;
  readonly titleLines: number;
}

function metricsFor(ui: Ui): CardMetrics {
  const { space, size } = ui.theme;
  return {
    padX: space.md,
    padY: space.sm,
    gap: space.sm,
    note: Math.round(size.icon * NOTE_SCALE),
    creditLines: ui.size === 'compact' ? CREDIT_MAX_LINES.compact : CREDIT_MAX_LINES.roomy,
    titleLines: ui.size === 'compact' ? TITLE_MAX_LINES.compact : TITLE_MAX_LINES.roomy,
  };
}

interface CardSize {
  readonly w: number;
  readonly h: number;
  readonly textW: number;
  readonly titleH: number;
  readonly creditH: number;
}

/** The card's size for `shown` within `maxWidth`, and its text column's. */
export function measureNowPlaying(ui: Ui, shown: NowPlayingCredit, maxWidth: number): CardSize {
  const metrics = metricsFor(ui);
  const textRoom = Math.max(0, maxWidth - metrics.padX * 2 - metrics.note - metrics.gap);
  const natural = Math.max(
    measureText(ui, shown.title, { role: TITLE_ROLE }),
    measureText(ui, shown.credit, { role: CREDIT_ROLE }),
  );
  const textW = Math.min(Math.ceil(natural), textRoom);
  const creditH = measureTextHeight(ui, textW, {
    text: shown.credit,
    role: CREDIT_ROLE,
    maxLines: metrics.creditLines,
  });
  const titleH = measureTextHeight(ui, textW, {
    text: shown.title,
    role: TITLE_ROLE,
    maxLines: metrics.titleLines,
  });
  return {
    w: metrics.padX * 2 + metrics.note + metrics.gap + textW,
    h: Math.max(metrics.note, titleH + creditH) + metrics.padY * 2,
    textW,
    titleH,
    creditH,
  };
}

/** The main note, bobbing and tilting on a slow sine. */
function drawSwayingNote(ui: Ui, box: Rect, color: string): void {
  const { ctx } = ui;
  const phase = ((ui.now % motion.noteSway) / motion.noteSway) * FULL_TURN;
  const bob = Math.sin(phase) * box.h * NOTE_BOB_FRACTION;
  const tilt = Math.sin(phase + Math.PI / 2) * NOTE_TILT_RADIANS;
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2 + bob);
  ctx.rotate(tilt);
  drawGlyph(ctx, 'music', { x: -box.w / 2, y: -box.h / 2, w: box.w, h: box.h }, { color });
  ctx.restore();
}

/** Two small notes rising off the main one in turn and fading as they go. */
function drawDriftingNotes(ui: Ui, box: Rect, color: string): void {
  const { ctx } = ui;
  const side = box.w * DRIFT_NOTE_SCALE;
  for (let index = 0; index < DRIFT_NOTE_COUNT; index++) {
    const offset = (index * motion.noteDrift) / DRIFT_NOTE_COUNT;
    const life = ((ui.now + offset) % motion.noteDrift) / motion.noteDrift;
    const fadeIn = Math.min(1, life / DRIFT_FADE_IN_FRACTION);
    const alpha = fadeIn * (1 - life) * DRIFT_NOTE_ALPHA;
    if (alpha <= 0) continue;
    const startX = index % 2 === 0 ? box.x + box.w - side / 2 : box.x;
    const sway = Math.sin(life * FULL_TURN) * box.w * DRIFT_SWAY_FRACTION;
    const rise = life * box.h * DRIFT_RISE_FRACTION;
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawGlyph(ctx, 'musicNote', { x: startX + sway, y: box.y - rise, w: side, h: side }, { color });
    ctx.restore();
  }
}

/**
 * Draws the card showing on `card` at the rect `place` picks for its size,
 * no wider than `maxWidth`, and returns where it rests (null when nothing is
 * drawn). It slides in from the right on a roomy screen and
 * from above on a compact one, and fades over its last moments.
 */
export function renderNowPlaying(
  ui: Ui,
  card: NowPlayingCard,
  maxWidth: number,
  place: (size: { readonly w: number; readonly h: number }) => Rect,
): Rect | null {
  const shown = card.shown;
  if (shown === null || maxWidth <= 0) return null;
  const { theme, ctx } = ui;
  const metrics = metricsFor(ui);
  const size = measureNowPlaying(ui, shown, maxWidth);
  const rest = place(size);
  const enter = easeOut(Math.min(1, shown.age / NOW_PLAYING_ENTER_TICKS));
  const fade =
    shown.ticksLeft < NOW_PLAYING_FADE_TICKS ? shown.ticksLeft / NOW_PLAYING_FADE_TICKS : 1;
  const alpha = Math.max(0, enter * fade);
  if (alpha <= 0) return null;
  const slide = (1 - enter) * theme.space.lg;
  const rect: Rect =
    ui.size === 'compact' ? { ...rest, y: rest.y - slide } : { ...rest, x: rest.x + slide };
  const accent = theme.palette.accent.base;
  const hudSkin = skinsFor(theme).panel.hud;
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawGlass(
    ui,
    rect,
    { ...hudSkin, border: withAlpha(accent, BORDER_TINT_ALPHA) },
    theme.radius.lg,
  );
  const noteBox: Rect = {
    x: rect.x + metrics.padX,
    y: rect.y + (rect.h - metrics.note) / 2,
    w: metrics.note,
    h: metrics.note,
  };
  drawDriftingNotes(ui, noteBox, accent);
  drawSwayingNote(ui, noteBox, accent);
  const textX = noteBox.x + noteBox.w + metrics.gap;
  const { titleH, creditH } = size;
  const textTop = rect.y + (rect.h - titleH - creditH) / 2;
  text(
    ui,
    { x: textX, y: textTop, w: size.textW, h: titleH },
    {
      text: shown.title,
      role: TITLE_ROLE,
      color: theme.palette.text.primary,
      wrap: true,
      maxLines: metrics.titleLines,
    },
  );
  text(
    ui,
    { x: textX, y: textTop + titleH, w: size.textW, h: creditH },
    { text: shown.credit, role: CREDIT_ROLE, wrap: true, maxLines: metrics.creditLines },
  );
  ctx.restore();
  return rest;
}
