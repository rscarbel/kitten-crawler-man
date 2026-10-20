/**
 * The viewers' favour on the HUD: a glass pill on the readout row beside the
 * coins, carrying the audience glyph, a small meter and the number. Each time
 * the AI moves it, a `+5` / `−3` flashes beside it. Where the readout row has
 * no room (a phone carrying the collapse clock's chip there), the same
 * reading rides in the top band instead.
 *
 * A readout: hovering shows what the current favour is worth, nothing more.
 */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';
import { meter } from '../widgets/meter';
import { measureText, tabularNumber, text } from '../widgets/text';
import { tooltip } from '../widgets/tooltip';
import type { TopBandEntry } from './topBand';
import { stackedBandEntry, TOP_BAND_WIDTH } from './topBandStack';

/** What the HUD shows of the viewers' favour. */
export interface ViewerFavorModel {
  readonly value: number;
  readonly max: number;
  /** The meter's word for the value ("Hyped"). */
  readonly tier: string;
  /** What the value is worth right now, one line. */
  readonly perk: string;
  /** The latest swing, numbered so a new one can be told from the last. */
  readonly swing: { readonly delta: number; readonly seq: number } | null;
}

/** The narrowest slot the pill is drawn into; below it the band carries the reading. */
export const FAVOR_PILL_MIN_W = 88;
/** The meter inside the pill, at its widest and at the narrowest it is squeezed to. */
const FAVOR_METER_MAX_W = 40;
const FAVOR_METER_MIN_W = 16;
/** How long a swing's `+5` stays beside the pill, fading over its second half. */
const SWING_FLASH_MS = 1800;
const SWING_FADE_FROM = 0.5;
const FAVOR_TOOLTIP_TEXT =
  'The galactic audience. Only the System moves it, and it only ever helps.';

const SWING_SEEN = new UiStateSlot<{ seq: number; at: number }>('viewer-favor-swing', () => ({
  seq: 0,
  at: -Infinity,
}));

function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

/** How visible the swing flash is now: 1 when fresh, fading to 0 over its end. */
function swingAlpha(ui: Ui, model: ViewerFavorModel): number {
  const swing = model.swing;
  if (swing === null || swing.delta === 0) return 0;
  const seen = ui.state(SWING_SEEN, 'flash');
  if (seen.seq !== swing.seq) {
    ui.setState(SWING_SEEN, 'flash', { seq: swing.seq, at: ui.now });
    return 1;
  }
  const progress = (ui.now - seen.at) / SWING_FLASH_MS;
  if (progress >= 1) return 0;
  if (progress <= SWING_FADE_FROM) return 1;
  return (1 - progress) / (1 - SWING_FADE_FROM);
}

/** Draws the pill from `slot`'s top-left corner, no wider than the slot. Returns the drawn pill. */
export function viewerFavorPill(ui: Ui, slot: Rect, model: ViewerFavorModel): Rect {
  const { ctx, theme } = ui;
  const { space, palette } = theme;
  const icon = theme.size.icon;
  const valueText = String(model.value);
  const valueW = measureText(ui, valueText, { role: 'label', tabular: true });
  const chromeW = space.sm + icon + space.xs + space.xs + valueW + space.md;
  const meterW = Math.max(FAVOR_METER_MIN_W, Math.min(FAVOR_METER_MAX_W, slot.w - chromeW));
  const pill: Rect = { x: slot.x, y: slot.y, w: Math.ceil(chromeW + meterW), h: slot.h };
  const state = ui.hit('viewer-favor', pill, { focusable: false });
  const skin = skinsFor(theme).panel.hud;
  drawGlass(ui, pill, { ...skin, radius: theme.radius.pill });
  const iconCell: Rect = { x: pill.x + space.sm, y: pill.y, w: icon, h: pill.h };
  drawGlyph(ctx, 'users', centerIn(iconCell, icon, icon), { color: palette.tier.celestial });
  const meterH = skinsFor(theme).meter.favor.height;
  const meterRect: Rect = {
    x: iconCell.x + icon + space.xs,
    y: pill.y + (pill.h - meterH) / 2,
    w: meterW,
    h: meterH,
  };
  meter(ui, meterRect, {
    id: 'viewer-favor/meter',
    value: model.value,
    max: model.max,
    kind: 'favor',
  });
  tabularNumber(
    ui,
    { x: meterRect.x + meterRect.w + space.xs, y: pill.y, w: valueW + space.xs, h: pill.h },
    { value: valueText, role: 'label' },
  );

  const flash = swingAlpha(ui, model);
  const swing = model.swing;
  if (flash > 0 && swing !== null) {
    const label = signed(swing.delta);
    const labelW = measureText(ui, label, { role: 'label', tabular: true });
    ctx.save();
    ctx.globalAlpha *= flash;
    text(
      ui,
      { x: pill.x + pill.w + space.xs, y: pill.y, w: labelW + space.xs, h: pill.h },
      {
        text: label,
        role: 'label',
        tabular: true,
        color: swing.delta > 0 ? palette.state.success : palette.state.danger,
        halo: palette.surface.sunken,
      },
    );
    ctx.restore();
  }

  tooltip(ui, pill, {
    id: 'viewer-favor/tip',
    title: `Viewers: ${model.tier}`,
    text: FAVOR_TOOLTIP_TEXT,
    lines: [{ text: model.perk, role: 'secondary' }],
    show: state.hovered,
  });
  return pill;
}

/** The same reading as a card in the top band, for a readout row with no room for the pill. */
export function viewerFavorBandEntry(model: ViewerFavorModel): TopBandEntry {
  return stackedBandEntry({
    id: 'viewer-favor',
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.narrow,
    rows: [
      {
        kind: 'meter',
        id: 'viewer-favor/band-meter',
        value: model.value,
        max: model.max,
        meterKind: 'favor',
        label: `Viewers: ${model.tier}`,
        valueText: String(model.value),
      },
    ],
  });
}
