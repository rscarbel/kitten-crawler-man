/**
 * Music: what is playing, the player's choice of music, every song grouped by
 * where it is heard, and each song's credits.
 */

import {
  formatAttribution,
  MUSIC_AREA_IDS,
  MUSIC_AREA_LABELS,
  MUSIC_CATALOG,
  type MusicAreaId,
  type MusicTrackDef,
} from '../../../audio/music/catalog';
import type { MusicPlayerControls, MusicPlayerMode } from '../../../audio/music/MusicDirector';
import { rememberMusicPlayback } from '../../../audio/music/playerPreference';
import { MUSIC_TRACK_IDS, type MusicBusId, type MusicTrackId } from '../../../audio/sounds';
import type { MusicLibrary } from '../../../core/MusicLibrary';
import { splitH, type Rect } from '../../core/geom';
import { skinsFor } from '../../theme/skins';
import { badge, badgeSize } from '../../widgets/badge';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { listRow, listRowHeight, listRowTrailingMax } from '../../widgets/listRow';
import { measureTabs } from '../../widgets/tabs';
import { measureTextHeight, text } from '../../widgets/text';
import { choiceRow, wideButton, type Choice } from './parts';
import type { PauseContext, PauseSection, SectionLayout } from './section';

type ModeKind = MusicPlayerMode['kind'];

type MusicView =
  | { readonly kind: 'list' }
  | { readonly kind: 'song'; readonly id: MusicTrackId }
  | { readonly kind: 'credits' };

/** What the page needs once both halves of the music are present. */
interface MusicPage {
  readonly player: MusicPlayerControls;
  readonly library: MusicLibrary;
}

const PICK_A_SONG = 'Pick a song below';
const NOTHING_UNLOCKED = 'No songs unlocked yet';
const AREA_MUSIC_TITLE = 'Area music';
const NEW_BADGE = 'New';
const LOCKED_TITLE = '???';
const PIXABAY_LICENSE = 'Used under the Pixabay Content License';
const PIXABAY_CREDITS_NOTE = 'Songs from Pixabay are used under the Pixabay Content License.';
const ORIGINAL_COMPOSITION = 'Original composition';

const MODE_HINTS: Readonly<Record<ModeKind, string>> = {
  area: 'The music follows wherever you are.',
  shuffle: 'Every song you have found, in a shuffled order. New finds join in.',
  repeat: 'The chosen song, over and over, from the top each time.',
  once: 'The chosen song plays through once, then the area music returns.',
};

const MODE_GRID_COLUMNS = 2;

/** Wide enough for the longest field label ("Original title") at every UI size. */
const FIELD_LABEL_WIDTH = 120;

const ROW_ACTIONS = [
  { id: 'once', label: 'Play once' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'credits', label: 'Credits' },
] as const;

type RowActionId = (typeof ROW_ACTIONS)[number]['id'];

function musicTrackIdOf(id: MusicBusId | null): MusicTrackId | null {
  return MUSIC_TRACK_IDS.find((track) => track === id) ?? null;
}

function songsIn(area: MusicAreaId): MusicTrackId[] {
  return MUSIC_TRACK_IDS.filter((id) => MUSIC_CATALOG[id].area === area);
}

function trackDef(id: MusicTrackId): MusicTrackDef {
  return MUSIC_CATALOG[id];
}

function artistOf(def: MusicTrackDef): string {
  const { authorName, authorUsername } = def.attribution;
  return authorName ?? authorUsername ?? '';
}

function musicPage(ctx: PauseContext): MusicPage | null {
  const player = ctx.audio?.music;
  const library = ctx.musicLibrary;
  if (player === undefined || library === null) return null;
  return { player, library };
}

function applyMode(player: MusicPlayerControls, kind: ModeKind, song: MusicTrackId | null): void {
  switch (kind) {
    case 'area':
      player.areaMusic();
      break;
    case 'shuffle':
      player.shuffleUnlocked();
      break;
    case 'repeat':
      if (song !== null) player.repeat(song);
      break;
    case 'once':
      if (song !== null) player.playOnce(song);
      break;
  }
  rememberMusicPlayback(player.playerMode);
}

// ── Now playing ─────────────────────────────────────────────────────────────

function renderNowPlaying(layout: SectionLayout, page: MusicPage, song: MusicTrackId | null): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const { player, library } = page;
  layout.heading('Now playing');
  const audible = musicTrackIdOf(player.audibleTrack);
  if (audible === null) {
    layout.paragraph(AREA_MUSIC_TITLE, 'title', space.md);
  } else {
    const def = trackDef(audible);
    layout.paragraph(def.title, 'title', space.xxs);
    layout.paragraph(formatAttribution(def), 'caption', space.md);
  }

  const songMissing = song === null ? PICK_A_SONG : false;
  const choices: readonly Choice<ModeKind>[] = [
    { value: 'area', label: 'Area music' },
    {
      value: 'shuffle',
      label: 'Shuffle',
      disabled: library.unlocked.length === 0 ? NOTHING_UNLOCKED : false,
    },
    { value: 'repeat', label: 'Repeat', disabled: songMissing },
    { value: 'once', label: 'Play once', disabled: songMissing },
  ];
  const mode = player.playerMode.kind;
  const pick = (kind: ModeKind): void => applyMode(player, kind, song);
  // Segments share the row equally, so every one must be as wide as the widest label needs.
  const widestSegment = Math.max(
    ...choices.map((choice) => measureTabs(ui, [{ id: choice.value, label: choice.label }])),
  );
  const segmentedWidth = widestSegment * choices.length;
  if (segmentedWidth <= layout.width) {
    choiceRow(layout, { id: 'music-mode', choices, selected: mode, onPick: pick });
  } else {
    modeGrid(layout, choices, mode, pick);
  }
  const hint =
    song === null && mode === 'area'
      ? `${MODE_HINTS[mode]} ${PICK_A_SONG} to repeat it or play it once.`
      : MODE_HINTS[mode];
  layout.paragraph(hint, 'muted', space.md);
}

/** The modes two by two as toggle buttons, for a column too narrow to show every label in one row. */
function modeGrid(
  layout: SectionLayout,
  choices: readonly Choice<ModeKind>[],
  mode: ModeKind,
  pick: (kind: ModeKind) => void,
): void {
  const columns = layout.split(MODE_GRID_COLUMNS, layout.ui.theme.space.sm);
  choices.forEach((choice, index) => {
    const column = columns[index % MODE_GRID_COLUMNS];
    wideButton(column, {
      id: `music-mode/${choice.value}`,
      label: choice.label,
      selected: choice.value === mode,
      disabled: choice.disabled,
      onTap: () => pick(choice.value),
    });
  });
  layout.join(columns);
}

// ── Track list ──────────────────────────────────────────────────────────────

interface ListState {
  readonly selected: MusicTrackId | null;
  readonly fresh: ReadonlySet<MusicTrackId>;
  readonly select: (id: MusicTrackId) => void;
  readonly open: (view: MusicView) => void;
}

function rowActions(
  layout: SectionLayout,
  cell: Rect,
  page: MusicPage,
  id: MusicTrackId,
  open: (view: MusicView) => void,
): void {
  const { ui } = layout;
  const widths = ROW_ACTIONS.map((action) =>
    measureButton(ui, { label: action.label, size: 'sm' }),
  );
  const h = buttonHeight(ui, 'sm');
  const strip: Rect = { x: cell.x, y: cell.y + (cell.h - h) / 2, w: cell.w, h };
  const cells = splitH(strip, widths, ui.theme.space.xs);
  const run: Readonly<Record<RowActionId, () => void>> = {
    once: () => applyMode(page.player, 'once', id),
    repeat: () => applyMode(page.player, 'repeat', id),
    credits: () => open({ kind: 'song', id }),
  };
  ROW_ACTIONS.forEach((action, index) => {
    const rect = cells[index];
    layout.track(
      rect,
      button(ui, rect, {
        id: `song/${id}/${action.id}`,
        label: action.label,
        size: 'sm',
        variant: action.id === 'credits' ? 'ghost' : 'secondary',
        onTap: run[action.id],
      }),
    );
  });
}

function rowActionsWidth(layout: SectionLayout): number {
  const { ui } = layout;
  const gaps = ui.theme.space.xs * (ROW_ACTIONS.length - 1);
  return ROW_ACTIONS.reduce(
    (sum, action) => sum + measureButton(ui, { label: action.label, size: 'sm' }),
    gaps,
  );
}

function songRow(layout: SectionLayout, page: MusicPage, id: MusicTrackId, state: ListState): void {
  const { ui } = layout;
  const { palette } = ui.theme;
  const roles = skinsFor(ui.theme).text;
  const def = trackDef(id);
  const rect = layout.row(listRowHeight(ui, true), ui.theme.space.xxs);
  if (!page.library.isUnlocked(id)) {
    const reason = `Found in: ${MUSIC_AREA_LABELS[def.area]}`;
    layout.track(
      rect,
      listRow(ui, rect, {
        id: `song/${id}`,
        title: def.title,
        titleColor: roles.danger.color,
        subtitle: reason,
        leading: { kind: 'glyph', glyph: 'lock' },
        disabled: reason,
      }),
      { focusable: false },
    );
    return;
  }

  const audible = page.player.audibleTrack === id;
  const selected = state.selected === id;
  const actionsFit = rowActionsWidth(layout) <= listRowTrailingMax(ui, rect, true);
  const drillsIn = ui.size === 'compact' || !actionsFit;
  const inlineActions = selected && !drillsIn;
  const isNew = state.fresh.has(id);
  const newBadge = isNew && !inlineActions ? badgeSize(ui, { label: NEW_BADGE }) : null;
  const trailingWidth = inlineActions ? rowActionsWidth(layout) : newBadge?.w;
  layout.track(
    rect,
    listRow(ui, rect, {
      id: `song/${id}`,
      title: def.title,
      titleColor: roles.success.color,
      subtitle: artistOf(def),
      leading: audible
        ? { kind: 'glyph', glyph: 'play', color: palette.accent.base }
        : { kind: 'glyph', glyph: 'musicNote' },
      selected,
      trailingWidth,
      trailingContent: inlineActions
        ? (cell) => rowActions(layout, cell, page, id, state.open)
        : newBadge === null
          ? undefined
          : (cell) => badge(ui, cell, { label: NEW_BADGE, tone: 'accent' }),
      onTap: () => {
        state.select(id);
        if (drillsIn) state.open({ kind: 'song', id });
      },
    }),
  );
}

function renderList(layout: SectionLayout, page: MusicPage, state: ListState): void {
  renderNowPlaying(layout, page, state.selected);
  for (const area of MUSIC_AREA_IDS) {
    const songs = songsIn(area);
    if (songs.length === 0) continue;
    layout.heading(MUSIC_AREA_LABELS[area]);
    for (const id of songs) songRow(layout, page, id, state);
  }
  layout.space(layout.ui.theme.space.md);
  wideButton(layout, {
    id: 'all-credits',
    label: 'Credits for all music',
    icon: 'musicNote',
    variant: 'ghost',
    onTap: () => state.open({ kind: 'credits' }),
  });
}

// ── Credits ─────────────────────────────────────────────────────────────────

function field(layout: SectionLayout, label: string, value: string): void {
  const { ui } = layout;
  const valueW = Math.max(0, layout.width - FIELD_LABEL_WIDTH - ui.theme.space.md);
  const h = measureTextHeight(ui, valueW, { text: value, role: 'body' });
  const rect = layout.row(h, ui.theme.space.sm);
  const [labelCell, valueCell] = splitH(rect, [FIELD_LABEL_WIDTH, 'fill'], ui.theme.space.md);
  text(ui, labelCell, { text: label, role: 'labelMuted', valign: 'top' });
  text(ui, valueCell, { text: value, role: 'body', wrap: true, valign: 'top' });
}

function renderSong(layout: SectionLayout, page: MusicPage, id: MusicTrackId): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const def = trackDef(id);
  const { attribution } = def;

  const columns = layout.split(2, space.sm);
  const playOnce = columns[0];
  const repeat = columns[1];
  wideButton(playOnce, {
    id: `song/${id}/once`,
    label: 'Play once',
    icon: 'play',
    selected: page.player.playerMode.kind === 'once' && page.player.audibleTrack === id,
    onTap: () => applyMode(page.player, 'once', id),
  });
  wideButton(repeat, {
    id: `song/${id}/repeat`,
    label: 'Repeat',
    icon: 'musicNote',
    selected: page.player.playerMode.kind === 'repeat' && page.player.audibleTrack === id,
    onTap: () => applyMode(page.player, 'repeat', id),
  });
  layout.join(columns, space.md);

  layout.heading('Credits');
  field(layout, 'Title', def.title);
  field(layout, 'Original title', attribution.originalTitle);
  if (attribution.authorName !== undefined) field(layout, 'Artist', attribution.authorName);
  if (attribution.authorUsername !== undefined) {
    field(layout, 'Uploader', attribution.authorUsername);
  }
  field(layout, 'Source', attribution.source ?? ORIGINAL_COMPOSITION);
  if (attribution.source === 'Pixabay') layout.paragraph(PIXABAY_LICENSE, 'muted', space.md);
}

function renderAllCredits(layout: SectionLayout, page: MusicPage): void {
  const { space } = layout.ui.theme;
  layout.paragraph('Songs you have not found yet stay hidden until you do.', 'muted', space.md);
  for (const area of MUSIC_AREA_IDS) {
    const songs = songsIn(area);
    if (songs.length === 0) continue;
    layout.heading(MUSIC_AREA_LABELS[area]);
    for (const id of songs) {
      if (!page.library.isUnlocked(id)) {
        layout.paragraph(LOCKED_TITLE, 'muted', space.sm);
        continue;
      }
      const def = trackDef(id);
      layout.paragraph(def.title, 'label', space.xxs);
      layout.paragraph(formatAttribution(def), 'caption', space.sm);
    }
  }
  layout.space(space.md);
  layout.paragraph(PIXABAY_CREDITS_NOTE, 'muted');
}

// ── Section ─────────────────────────────────────────────────────────────────

export function musicSection(): PauseSection {
  let view: MusicView = { kind: 'list' };
  let selected: MusicTrackId | null = null;
  /** Songs that were new when the page opened: opening it clears the badge, the rows keep the tag. */
  let fresh: ReadonlySet<MusicTrackId> | null = null;

  const chosenSong = (player: MusicPlayerControls): MusicTrackId | null => {
    if (selected !== null) return selected;
    const mode = player.playerMode;
    return mode.kind === 'repeat' || mode.kind === 'once' ? mode.id : null;
  };

  return {
    id: 'music',
    label: 'Music',
    glyph: 'music',
    releasesMusic: true,
    available: (ctx) => musicPage(ctx) !== null,
    badge: (ctx) => {
      const count = ctx.musicLibrary?.menuUnseenCount ?? 0;
      return count > 0 ? String(count) : null;
    },
    title: () => {
      if (view.kind === 'song') return trackDef(view.id).title;
      if (view.kind === 'credits') return 'Music credits';
      return 'Music';
    },
    subtitle: (ctx) => {
      if (view.kind !== 'list') return undefined;
      const found = ctx.musicLibrary?.unlocked.length ?? 0;
      return `${found} of ${MUSIC_TRACK_IDS.length} songs found`;
    },
    render: (layout, ctx) => {
      const page = musicPage(ctx);
      if (page === null) return;
      if (fresh === null) {
        fresh = new Set(page.library.serialize().menuUnseen);
        page.library.clearMenuUnseen();
      }
      if (view.kind === 'song' && page.library.isUnlocked(view.id)) {
        renderSong(layout, page, view.id);
        return;
      }
      if (view.kind === 'credits') {
        renderAllCredits(layout, page);
        return;
      }
      view = { kind: 'list' };
      renderList(layout, page, {
        selected: chosenSong(page.player),
        fresh,
        select: (id) => {
          selected = id;
        },
        open: (next) => {
          view = next;
        },
      });
    },
    subView: {
      active: () => view.kind !== 'list',
      key: () => (view.kind === 'song' ? `song-${view.id}` : view.kind),
      exit: () => {
        view = { kind: 'list' };
      },
    },
    reset: () => {
      view = { kind: 'list' };
      selected = null;
      fresh = null;
    },
  };
}
