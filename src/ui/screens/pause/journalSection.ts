/**
 * The Quest Journal: every thread the run has going, with where each one is.
 * Tapping a quest pins it, and the world arrow follows the pin.
 *
 * Holds no quest state: entries arrive freshly built from the scene's tracker
 * sources, and the pin lives on the run-scoped `JournalProgress`.
 */

import type { JournalProgress } from '../../../core/JournalProgress';
import {
  isOutstanding,
  pinMatchesEntry,
  type TrackerEntry,
  type TrackerStatus,
} from '../../../systems/questTracker';
import { inset, splitH, splitV } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import { skinsFor, type TextRole } from '../../theme/skins';
import { badge, badgeSize, type BadgeTone } from '../../widgets/badge';
import { card } from '../../widgets/card';
import { lineHeightOf, measureText, text } from '../../widgets/text';
import type { JournalContext, PauseContext, PauseSection, SectionLayout } from './section';

const STATUS_ROLE: Readonly<Record<TrackerStatus, TextRole>> = {
  active: 'label',
  available: 'info',
  completed: 'muted',
  failed: 'danger',
};

const STATUS_TAG: Readonly<Record<TrackerStatus, string>> = {
  active: 'Active',
  available: 'New',
  completed: 'Done',
  failed: 'Failed',
};

const STATUS_TONE: Readonly<Record<TrackerStatus, BadgeTone>> = {
  active: 'accent',
  available: 'info',
  completed: 'neutral',
  failed: 'danger',
};

/** A row's lines are name, objective, then the optional hint. */
const HINT_ROW = 2;

/** The eight compass arrows, clockwise from due east. */
const COMPASS_ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const;
const RADIANS_PER_TURN = Math.PI * 2;
/** The bearing column is wide enough for "999m". */
const BEARING_SAMPLE = '999m';

/**
 * The arrow from the player toward a tile. Screen y grows downward, so the
 * sector is read off `atan2(dy, dx)` in screen terms and the table runs
 * clockwise from east: "↓" means south on the map.
 */
function compassArrow(fromX: number, fromY: number, to: { x: number; y: number }): string {
  const angle = Math.atan2(to.y - fromY, to.x - fromX);
  const turns = (angle + RADIANS_PER_TURN) % RADIANS_PER_TURN;
  const sectors = COMPASS_ARROWS.length;
  const sector = Math.round((turns / RADIANS_PER_TURN) * sectors) % sectors;
  return COMPASS_ARROWS[sector];
}

/** Straight-line tiles: what "how far is it" means to somebody reading a map. */
function tileDistance(fromX: number, fromY: number, to: { x: number; y: number }): number {
  return Math.round(Math.hypot(to.x - fromX, to.y - fromY));
}

/**
 * Whether pinning would point at anything: the same two conditions the pin
 * resolver accepts, so a pin can never land on a row with no arrow behind it.
 */
function canPin(entry: TrackerEntry): boolean {
  return entry.target !== undefined && isOutstanding(entry.status);
}

/**
 * Not straight equality: a pin set when a quest started names the quest, and
 * the anchor questline re-keys its row per shard.
 */
function isPinnedRow(progress: JournalProgress, entry: TrackerEntry): boolean {
  const pinnedId = progress.pinnedTrackerId;
  return pinnedId !== null && pinMatchesEntry(pinnedId, entry);
}

/**
 * Un-pinning is tested first: a quest can stop being pinnable while pinned
 * (the murder mystery drops its tower tile when the boss dies), and refusing
 * the tap would strand the pin on it.
 */
function togglePin(progress: JournalProgress, entry: TrackerEntry): void {
  if (isPinnedRow(progress, entry)) {
    progress.pinnedTrackerId = null;
    progress.pinSource = null;
    return;
  }
  if (!canPin(entry)) return;
  progress.pinnedTrackerId = entry.id;
  progress.pinSource = 'player';
}

/** How many entries still want doing: the Journal's badge. */
export function outstandingCount(entries: ReadonlyArray<TrackerEntry>): number {
  return entries.filter((entry) => isOutstanding(entry.status)).length;
}

function rowHeight(ui: Ui, entry: TrackerEntry): number {
  const { space } = ui.theme;
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const lines =
    lineHeightOf(ui, 'label') +
    lineHeightOf(ui, 'secondary') +
    (entry.hint === undefined ? 0 : lineHeightOf(ui, 'muted'));
  return padding * 2 + lines + space.xxs * 2;
}

function journalRow(
  layout: SectionLayout,
  ui: Ui,
  entry: TrackerEntry,
  journal: JournalContext,
): void {
  const { space, size } = ui.theme;
  const isSubstep = entry.parentId !== undefined;
  const indent = isSubstep ? space.xl : 0;
  const rowRect = layout.row(rowHeight(ui, entry), space.sm);
  const rect = inset(rowRect, { l: indent });
  const pinned = isPinnedRow(journal.progress, entry);
  const pinnable = pinned || canPin(entry);
  const result = card(ui, rect, {
    id: `quest/${entry.id}`,
    selected: pinned,
    onTap: pinnable ? () => togglePin(journal.progress, entry) : undefined,
    content: (body) => {
      const bearingW = measureText(ui, BEARING_SAMPLE, { role: 'label', tabular: true });
      const [textCol, bearingCol] = splitH(body, ['fill', bearingW], space.md);
      const tracks = [lineHeightOf(ui, 'label'), lineHeightOf(ui, 'secondary')];
      if (entry.hint !== undefined) tracks.push(lineHeightOf(ui, 'muted'));
      const rows = splitV(textCol, tracks, space.xxs);
      const [nameRow, objectiveRow] = rows;

      let nameRect = nameRow;
      if (isSubstep) {
        const glyphSide = size.icon;
        drawGlyph(
          ui.ctx,
          'chevronRight',
          { x: nameRow.x, y: nameRow.y + (nameRow.h - glyphSide) / 2, w: glyphSide, h: glyphSide },
          { color: ui.theme.palette.text.muted },
        );
        nameRect = inset(nameRow, { l: glyphSide + space.xs });
      }
      const tags = [{ label: STATUS_TAG[entry.status], tone: STATUS_TONE[entry.status] }];
      if (pinned) tags.unshift({ label: 'Pinned', tone: 'accent' });
      for (const tag of [...tags].reverse()) {
        const pill = badgeSize(ui, { label: tag.label, kind: 'tag' });
        badge(
          ui,
          { x: nameRect.x + nameRect.w - pill.w, y: nameRect.y, w: pill.w, h: nameRect.h },
          { label: tag.label, kind: 'tag', tone: tag.tone },
        );
        nameRect = inset(nameRect, { r: pill.w + space.xs });
      }
      text(ui, nameRect, {
        text: entry.name,
        role: isSubstep ? 'label' : STATUS_ROLE[entry.status],
      });
      text(ui, objectiveRow, { text: entry.objective, role: 'secondary' });
      if (rows.length > HINT_ROW && entry.hint !== undefined) {
        text(ui, rows[HINT_ROW], { text: entry.hint, role: 'muted' });
      }

      if (entry.target === undefined) return;
      const [arrowRow, distanceRow] = splitV(
        bearingCol,
        [lineHeightOf(ui, 'title'), lineHeightOf(ui, 'caption')],
        space.xxs,
      );
      text(ui, arrowRow, {
        text: compassArrow(journal.playerTileX, journal.playerTileY, entry.target),
        role: 'title',
        align: 'right',
      });
      text(ui, distanceRow, {
        text: `${tileDistance(journal.playerTileX, journal.playerTileY, entry.target)}m`,
        role: 'caption',
        align: 'right',
        tabular: true,
      });
    },
  });
  layout.track(rect, result.state, { focusable: pinnable });
}

function renderJournal(layout: SectionLayout, ctx: PauseContext): void {
  const journal = ctx.journal;
  if (journal === null || journal.entries.length === 0) {
    layout.paragraph('Nothing on the go.', 'muted');
    return;
  }
  for (const entry of journal.entries) journalRow(layout, layout.ui, entry, journal);
}

export function journalSection(): PauseSection {
  return {
    id: 'journal',
    label: 'Journal',
    glyph: 'compass',
    available: (ctx) => ctx.journal !== null,
    badge: (ctx) => {
      const count = ctx.journal === null ? 0 : outstandingCount(ctx.journal.entries);
      return count > 0 ? String(count) : null;
    },
    title: () => 'Quest Journal',
    subtitle: () => 'Tap a quest to pin it — an arrow will point the way',
    render: renderJournal,
  };
}
