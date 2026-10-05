/**
 * Rosemarie's Meat Shields desk: the hires down the left, the selected one's
 * portrait, stats and pitch on the right, and Rosemarie underneath saying
 * whatever she has to say about it. A row never spends coins; only the
 * pane's Hire does, and a Hire she refuses still answers a press so she can
 * say why. Dismiss asks through the desk's own confirm dialog, mounted above.
 */

import type { MercenaryTemplate } from '../../../core/mercenaryTemplates';
import { MERCENARY_TEMPLATES } from '../../../core/mercenaryTemplates';
import {
  MERCENARY_DESK_SUBTITLE,
  MERCENARY_DESK_TITLE,
  type MercenaryDeskEntry,
  type MercenaryDeskView,
  type MercenaryGuildSystem,
} from '../../../systems/MercenaryGuildSystem';
import { centerIn, inset, splitH, splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import { skinsFor, type MeterKind } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { card } from '../../widgets/card';
import { listRow, listRowHeight } from '../../widgets/listRow';
import { meter } from '../../widgets/meter';
import { panel, type FooterButton } from '../../widgets/panel';
import type { Theme } from '../../theme/tokens';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { coinPurse, measureCoinPurse, refusableButton } from './shopParts';
import type { ShopParty } from './shopSession';

const LEAVE_LABEL = 'Leave the desk';
const NOT_AVAILABLE = 'Not available';
const UNDER_CONTRACT = 'Under contract';
const HIRED_TAG = 'Hired';
const KEEP_NOTE = "Yours till the floor's done.";
const SPEAKER = 'Rosemarie';

/** The list takes this share of the body on a wide screen, the pane the rest. */
const LIST_FRACTION = 0.38;
/** Below this body width the list stacks above the pane rather than beside it. */
const SIDE_BY_SIDE_MIN_WIDTH = 520;
/** The portrait frame is this much taller than wide. */
const PORTRAIT_ASPECT = 1.25;
const PORTRAIT_WIDTH = 96;
/** On a phone the portrait shrinks so the pane fits above the fold. */
const COMPACT_PORTRAIT_WIDTH = 64;
/** The unknown hire's question mark fills this fraction of the frame's width. */
const UNKNOWN_GLYPH_SCALE = 0.4;
/** Rosemarie's line wraps to at most this many lines. */
const SPEECH_MAX_LINES = 2;
/** A hire's pitch may run to this many lines before it clips. */
const PITCH_MAX_LINES = 4;
const ROSEMARIE_FRAME_WIDTH = 52;
/** The pane's Hire and Dismiss buttons are this many controls wide. */
const HIRE_BUTTON_CONTROLS = 5;
const DISMISS_BUTTON_CONTROLS = 6;
/** Speeds are tenths apart; one decimal is all the difference there is. */
const SPEED_DECIMALS = 1;

const MAX_HP = Math.max(...MERCENARY_TEMPLATES.map((t) => t.hp));
const MAX_SPEED = Math.max(...MERCENARY_TEMPLATES.map((t) => t.speed));
const MAX_DAMAGE = Math.max(...MERCENARY_TEMPLATES.map((t) => t.damage));

interface StatLine {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly text: string;
  readonly kind: MeterKind;
}

function statLines(template: MercenaryTemplate): StatLine[] {
  return [
    { label: 'Health', value: template.hp, max: MAX_HP, text: `${template.hp}`, kind: 'hp' },
    {
      label: 'Speed',
      value: template.speed,
      max: MAX_SPEED,
      text: template.speed.toFixed(SPEED_DECIMALS),
      kind: 'stamina',
    },
    {
      label: 'Damage',
      value: template.damage,
      max: MAX_DAMAGE,
      text: `${template.damage}`,
      kind: 'boss',
    },
  ];
}

export interface MercenaryDeskScreenOptions {
  readonly id: string;
  readonly desk: MercenaryGuildSystem;
  readonly party: () => ShopParty;
}

/** The desk as a surface: halts the world and keeps the keyboard; Escape and Leave close it. */
export function mercenaryDeskSurface(opts: MercenaryDeskScreenOptions): Surface {
  const { desk } = opts;
  const close = (): void => desk.close();
  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => desk.open,
    close,
    render: (ui) => renderDesk(ui, opts, close),
  };
}

function entryName(entry: MercenaryDeskEntry): string {
  return entry.kind === 'hire' ? entry.template.name : entry.name;
}

function entrySpecies(entry: MercenaryDeskEntry): string {
  return entry.kind === 'hire' ? entry.template.species : entry.species;
}

function entryTrailing(entry: MercenaryDeskEntry): string {
  if (entry.kind === 'refusal') return NOT_AVAILABLE;
  if (entry.underContract) return HIRED_TAG;
  return entry.template.price.toLocaleString('en-US');
}

function portraitWidth(ui: Ui): number {
  return ui.size === 'compact' ? COMPACT_PORTRAIT_WIDTH : PORTRAIT_WIDTH;
}

/** On a phone the pane's actions move to the panel footer, so they never fall below the fold. */
function actionsInFooter(ui: Ui): boolean {
  return ui.size === 'compact';
}

function paneHeight(ui: Ui): number {
  const { space } = ui.theme;
  const compact = actionsInFooter(ui);
  const portraitH = portraitWidth(ui) * PORTRAIT_ASPECT;
  const pitchLines = compact ? SPEECH_MAX_LINES : PITCH_MAX_LINES;
  const pitchH = lineHeightOf(ui, 'secondary') * pitchLines;
  const actionH = compact ? 0 : space.xs + buttonHeight(ui, 'md');
  const cardPadding = skinsFor(ui.theme).panel.inset.padding * 2;
  return (
    portraitH + space.md + pitchH + space.md + lineHeightOf(ui, 'caption') + actionH + cardPadding
  );
}

function speechHeight(ui: Ui): number {
  return Math.max(
    ui.theme.size.slot,
    lineHeightOf(ui, 'label') +
      lineHeightOf(ui, 'secondary') * SPEECH_MAX_LINES +
      ui.theme.space.sm * 2,
  );
}

function renderDesk(ui: Ui, opts: MercenaryDeskScreenOptions, close: () => void): void {
  const { desk } = opts;
  const party = opts.party();
  const view = desk.deskView(party.active, party.companion);
  const { space } = ui.theme;
  const rowH = listRowHeight(ui, true);
  const listH = view.entries.length * rowH;
  const paneH = paneHeight(ui);
  const speechH = speechHeight(ui);

  const sideBySide = (body: Rect): boolean => body.w >= SIDE_BY_SIDE_MIN_WIDTH;
  const columnH = paneH + space.md + speechH;
  const bodyHeight = (body: Rect): number =>
    sideBySide(body) ? Math.max(listH, columnH) : listH + space.md + columnH;
  const naturalBody = { x: 0, y: 0, w: ui.theme.panelWidth.lg, h: 0 };
  const contentHeight = bodyHeight(naturalBody);

  const compact = actionsInFooter(ui);
  panel(ui, {
    id: opts.id,
    title: MERCENARY_DESK_TITLE,
    subtitle: compact ? undefined : MERCENARY_DESK_SUBTITLE,
    width: 'lg',
    height: 'content',
    contentHeight,
    scrollBody: true,
    onClose: close,
    footer: compact
      ? paneActions(opts, view)
      : [{ id: 'leave', label: LEAVE_LABEL, variant: 'secondary', primary: true, onTap: close }],
    footerSize: compact ? 'sm' : 'md',
    content: (body) => {
      const laidOut = { ...body, h: bodyHeight(body) };
      const [listRect, column] = sideBySide(body)
        ? splitH(laidOut, [laidOut.w * LIST_FRACTION, 'fill'], space.md)
        : splitV(laidOut, [listH, columnH], space.md);
      const [paneRect, speech] = compact
        ? splitV(column, [speechH, 'fill'], space.md).reverse()
        : splitV(column, ['fill', speechH], space.md);
      renderList(ui, listRect, opts, view, rowH);
      renderPane(ui, paneRect, opts, view);
      renderSpeech(ui, speech, opts, view);
    },
  });
}

function renderList(
  ui: Ui,
  rect: Rect,
  opts: MercenaryDeskScreenOptions,
  view: MercenaryDeskView,
  rowH: number,
): void {
  const { palette } = ui.theme;
  const party = opts.party();
  const cells = splitV(
    { ...rect, h: view.entries.length * rowH },
    view.entries.map(() => rowH),
    0,
  );
  view.entries.forEach((entry, index) => {
    const cell = cells[index];
    const muted = entry.kind === 'refusal';
    const hired = entry.kind === 'hire' && entry.underContract;
    listRow(ui, cell, {
      id: `${opts.id}/row-${index}`,
      title: entryName(entry),
      subtitle: entrySpecies(entry),
      leading:
        entry.kind === 'hire'
          ? {
              kind: 'paint',
              paint: (_ctx, art) => opts.desk.drawHirePortrait(ui.ctx, entry.template.id, art),
            }
          : { kind: 'glyph', glyph: 'lock' },
      trailing: entryTrailing(entry),
      trailingColor: muted
        ? palette.text.muted
        : hired
          ? palette.state.success
          : palette.accent.base,
      selected: index === view.selected,
      onTap: () => opts.desk.pressRow(index, party.active, party.companion),
    });
  });
}

function renderPane(
  ui: Ui,
  rect: Rect,
  opts: MercenaryDeskScreenOptions,
  view: MercenaryDeskView,
): void {
  const { space, size } = ui.theme;
  const entry = view.entries[view.selected];
  const result = card(ui, rect, { id: `${opts.id}/pane`, kind: 'inset' });
  const body = result.body;
  const portraitW = portraitWidth(ui);
  const portraitH = portraitW * PORTRAIT_ASPECT;
  const noteH = lineHeightOf(ui, 'caption');
  const footerActions = actionsInFooter(ui);
  const actionH = footerActions ? 0 : buttonHeight(ui, 'md');
  // Under contract, Dismiss swaps rows with the note so it never stands where
  // Hire just was: a double click on Hire must not land on Dismiss.
  const dismissShown = entry.kind === 'hire' && entry.underContract;
  const [head, pitchRect, upperRow, lowerRow] = splitV(
    body,
    dismissShown ? [portraitH, 'fill', actionH, noteH] : [portraitH, 'fill', noteH, actionH],
    space.sm,
  );
  const noteRect = dismissShown ? lowerRow : upperRow;
  const actionRow = dismissShown ? upperRow : lowerRow;
  const [portrait, info] = splitH(head, [portraitW, 'fill'], space.md);

  card(ui, portrait, { id: `${opts.id}/portrait`, kind: 'raised' });
  if (entry.kind === 'hire') {
    opts.desk.drawHirePortrait(ui.ctx, entry.template.id, portrait);
  } else {
    const side = portrait.w * UNKNOWN_GLYPH_SCALE;
    drawGlyph(ui.ctx, 'lock', centerIn(portrait, side, side), {
      color: ui.theme.palette.text.muted,
    });
  }

  const titleH = lineHeightOf(ui, 'title');
  const captionH = lineHeightOf(ui, 'caption');
  const labelH = lineHeightOf(ui, 'label');
  const [nameRow, kindRow, priceRow, stats] = splitV(
    info,
    [titleH, captionH, labelH, 'fill'],
    space.xxs,
  );
  text(ui, nameRow, { text: entryName(entry), role: 'title' });
  const role = entry.kind === 'hire' ? entry.template.role : entry.role;
  text(ui, kindRow, { text: `${entrySpecies(entry)} · ${role}`, role: 'caption' });

  if (entry.kind === 'refusal') {
    text(ui, priceRow, { text: NOT_AVAILABLE, role: 'muted' });
    text(ui, pitchRect, { text: entry.pitch, role: 'secondary', wrap: true });
    return;
  }

  const template = entry.template;
  text(ui, priceRow, {
    text: entry.underContract ? UNDER_CONTRACT : `${template.price.toLocaleString('en-US')} coins`,
    role: entry.underContract ? 'success' : 'accent',
  });
  renderStats(ui, inset(stats, { t: space.xs }), opts.id, template);
  const pitchH = Math.min(
    pitchRect.h,
    measureTextHeight(ui, pitchRect.w, { text: template.pitch, role: 'secondary' }),
  );
  text(ui, { ...pitchRect, h: pitchH }, { text: template.pitch, role: 'secondary', wrap: true });

  const party = opts.party();
  if (footerActions) {
    const note = entry.underContract ? KEEP_NOTE : entry.hireNote;
    if (note !== null) text(ui, noteRect, { text: note, role: 'muted' });
    return;
  }
  if (!entry.underContract) {
    if (entry.hireNote !== null) text(ui, noteRect, { text: entry.hireNote, role: 'muted' });
    const label = `Hire: ${template.price.toLocaleString('en-US')}`;
    refusableButton(
      ui,
      { ...actionRow, w: Math.min(actionRow.w, size.control * HIRE_BUTTON_CONTROLS) },
      {
        id: `${opts.id}/hire`,
        label,
        size: 'md',
        variant: 'primary',
        refusal: entry.hireRefusal,
        sound: null,
        onTap: () => opts.desk.pressHire(template.id, party.active, party.companion),
      },
    );
    return;
  }

  text(ui, noteRect, { text: KEEP_NOTE, role: 'muted' });
  button(
    ui,
    { ...actionRow, w: Math.min(actionRow.w, size.control * DISMISS_BUTTON_CONTROLS) },
    {
      id: `${opts.id}/dismiss`,
      label: 'Dismiss Contract',
      variant: 'danger',
      onTap: () => opts.desk.askDismiss(),
    },
  );
}

/**
 * The pane's actions as footer buttons, for a phone. Leave is the primary, so
 * Space or Enter with nothing focused never spends coins. A refused Hire stays
 * pressable so Rosemarie can say why. Dismiss stands left of Leave while Hire
 * stands right of it, so a double tap on Hire cannot land on Dismiss.
 */
function paneActions(opts: MercenaryDeskScreenOptions, view: MercenaryDeskView): FooterButton[] {
  const entry = view.entries[view.selected];
  const party = opts.party();
  const leave: FooterButton = {
    id: 'leave',
    label: LEAVE_LABEL,
    variant: 'secondary',
    primary: true,
    onTap: () => opts.desk.close(),
  };
  if (entry.kind !== 'hire') return [leave];
  const template = entry.template;
  if (!entry.underContract) {
    return [
      leave,
      {
        id: 'hire',
        label: `Hire: ${template.price.toLocaleString('en-US')}`,
        variant: entry.hireRefusal === null ? 'primary' : 'secondary',
        sound: entry.hireRefusal === null ? undefined : null,
        onTap: () => opts.desk.pressHire(template.id, party.active, party.companion),
      },
    ];
  }
  return [
    {
      id: 'dismiss',
      label: 'Dismiss Contract',
      variant: 'danger',
      onTap: () => opts.desk.askDismiss(),
    },
    leave,
  ];
}

/** A stat's label column is this many of the widest spacing steps. */
const STAT_LABEL_WIDTH_STEPS = 2;

/** A stat bar's thickness: thin enough to read as a gauge, not a control. */
function statBarHeight(space: Theme['space']): number {
  return space.xs + space.xxs;
}

function renderStats(ui: Ui, rect: Rect, surfaceId: string, template: MercenaryTemplate): void {
  const { space } = ui.theme;
  const lines = statLines(template);
  const rowH = lineHeightOf(ui, 'caption');
  const rows = splitV(
    rect,
    lines.map(() => rowH),
    space.xxs,
  );
  const labelW = space.xxl * STAT_LABEL_WIDTH_STEPS;
  const valueW = space.xxl;
  lines.forEach((line, index) => {
    const row = rows[index];
    const [labelCell, bar, valueCell] = splitH(row, [labelW, 'fill', valueW], space.sm);
    text(ui, labelCell, { text: line.label, role: 'caption' });
    const barH = statBarHeight(space);
    meter(ui, centerIn(bar, bar.w, barH), {
      id: `${surfaceId}/stat-${line.label}`,
      value: line.value,
      max: line.max,
      kind: line.kind,
      ghost: false,
    });
    text(ui, valueCell, { text: line.text, role: 'caption', align: 'right', tabular: true });
  });
}

function renderSpeech(
  ui: Ui,
  rect: Rect,
  opts: MercenaryDeskScreenOptions,
  view: MercenaryDeskView,
): void {
  const { space } = ui.theme;
  card(ui, rect, { id: `${opts.id}/speech`, kind: 'raised' });
  const body = inset(rect, space.sm);
  const purseW = measureCoinPurse(ui, view.coins);
  const [face, words, purse] = splitH(body, [ROSEMARIE_FRAME_WIDTH, 'fill', purseW], space.md);
  opts.desk.drawRosemarie(ui.ctx, { ...face, y: rect.y, h: rect.h });
  const labelH = lineHeightOf(ui, 'label');
  const [nameRow, lineRow] = splitV(words, [labelH, 'fill'], 0);
  text(ui, nameRow, { text: SPEAKER, role: 'accent' });
  text(ui, lineRow, {
    text: view.line,
    role: 'secondary',
    wrap: true,
    maxLines: SPEECH_MAX_LINES,
  });
  coinPurse(ui, purse, view.coins);
}
