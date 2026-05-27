import type { AudioManager } from '../../audio/AudioManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox, BOX_PRESETS } from '../Box';
import { platform } from '../../core/Platform';

// Volume slider constants
const TRACK_HEIGHT = 20;
const LABEL_Y_OFFSET = 13;
const TRACK_Y_OFFSET = 22;
const PERCENTAGE_MULTIPLIER = 100;
const TRACK_FILL_X_OFFSET = 1;
const TRACK_FILL_Y_OFFSET = 1;
const TRACK_FILL_WIDTH_MARGIN = 2;
const TRACK_FILL_HEIGHT_MARGIN = 2;
const MIN_FILL_WIDTH = 2;

// Settings tab layout
const SETTINGS_TITLE_Y = 30;
const SETTINGS_TITLE_SIZE = 18;
const AUDIO_LABEL_X = 20;
const AUDIO_LABEL_Y = 60;
const AUDIO_LABEL_SIZE = 12;
const SLIDER_WIDTH_MARGIN = 40;
const SLIDER_X_OFFSET = 20;
const FIRST_SLIDER_Y_OFFSET = 72;
const SLIDER_SPACING = 58;
const LAST_SLIDER_SPACING = 52;

// Mobile controls section
const MOBILE_SECTION_LABEL_Y_OFFSET = 16;
const MOBILE_SECTION_LABEL_SIZE = 12;
const MOBILE_SECTION_Y_SPACING = 32;
const CHAT_BUTTON_HEIGHT = 40;
const CHAT_BUTTON_Y_SPACING = 52;

// Reset Game button
const RESET_BUTTON_HEIGHT = 40;
const RESET_BUTTON_Y_SPACING = 52;
const SECTION_LABEL_Y_SPACING = 32;
const SECTION_LABEL_SIZE = 12;

// Confirmation dialog
const CONFIRM_DIALOG_H = 170;
const CONFIRM_DIALOG_H_MARGIN = 20;
const CONFIRM_TITLE_Y_OFFSET = 28;
const CONFIRM_TITLE_SIZE = 16;
const CONFIRM_BODY_Y_OFFSET = 58;
const CONFIRM_BODY_SIZE = 13;
const CONFIRM_BTN_Y_OFFSET = 116;
const CONFIRM_BTN_H = 38;
const CONFIRM_BTN_SIDE_MARGIN = 12;
const CONFIRM_BTN_GAP = 8;
const CONFIRM_OVERLAY_ALPHA = 0.65;

function renderVolumeSlider(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  label: string,
  value: number,
  setter: (v: number) => void,
): void {
  const labelY = by + LABEL_Y_OFFSET;
  const trackY = by + TRACK_Y_OFFSET;

  drawText(ctx, label, {
    x: bx,
    y: labelY,
    size: 11,
    color: '#94a3b8',
  });

  drawText(ctx, `${Math.round(value * PERCENTAGE_MULTIPLIER)}%`, {
    x: bx + bw,
    y: labelY,
    size: 11,
    color: '#e2e8f0',
    align: 'right',
  });

  drawBox(ctx, {
    x: bx,
    y: trackY,
    width: bw,
    height: TRACK_HEIGHT,
    fill: '#0f172a',
    border: '#334155',
    borderWidth: 1,
  });

  const fillW = Math.round(bw * value);
  if (fillW > MIN_FILL_WIDTH) {
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(
      bx + TRACK_FILL_X_OFFSET,
      trackY + TRACK_FILL_Y_OFFSET,
      fillW - TRACK_FILL_WIDTH_MARGIN,
      TRACK_HEIGHT - TRACK_FILL_HEIGHT_MARGIN,
    );
  }

  const sliderX = bx;
  buttons.push({
    x: sliderX,
    y: trackY,
    w: bw,
    h: TRACK_HEIGHT,
    positionedAction: (mx: number) => {
      setter(Math.max(0, Math.min(1, (mx - sliderX) / bw)));
    },
  });
}

function renderResetConfirmDialog(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  onCancel: () => void,
  onConfirm: (() => void) | null,
): void {
  // Dim the settings content behind the dialog
  ctx.save();
  ctx.globalAlpha = CONFIRM_OVERLAY_ALPHA;
  ctx.fillStyle = '#000000';
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  const dialogW = bw - CONFIRM_DIALOG_H_MARGIN * 2;
  const dialogX = bx + CONFIRM_DIALOG_H_MARGIN;
  const dialogY = by + Math.floor((bh - CONFIRM_DIALOG_H) / 2);

  drawBox(ctx, {
    x: dialogX,
    y: dialogY,
    width: dialogW,
    height: CONFIRM_DIALOG_H,
    ...BOX_PRESETS.danger,
    radius: 6,
  });

  drawText(ctx, 'Reset Game?', {
    x: dialogX + dialogW / 2,
    y: dialogY + CONFIRM_TITLE_Y_OFFSET,
    size: CONFIRM_TITLE_SIZE,
    bold: true,
    color: '#fca5a5',
    align: 'center',
  });

  drawText(ctx, 'All your progress will be erased. Are you sure?', {
    x: dialogX + CONFIRM_BTN_SIDE_MARGIN,
    y: dialogY + CONFIRM_BODY_Y_OFFSET,
    size: CONFIRM_BODY_SIZE,
    color: '#e2e8f0',
    align: 'center',
    width: dialogW - CONFIRM_BTN_SIDE_MARGIN * 2,
  });

  const btnY = dialogY + CONFIRM_BTN_Y_OFFSET;
  const btnW = Math.floor((dialogW - CONFIRM_BTN_SIDE_MARGIN * 2 - CONFIRM_BTN_GAP) / 2);
  const yesBtnX = dialogX + CONFIRM_BTN_SIDE_MARGIN;
  const cancelBtnX = yesBtnX + btnW + CONFIRM_BTN_GAP;

  if (onConfirm !== null) {
    addButton(ctx, buttons, {
      x: yesBtnX,
      y: btnY,
      width: btnW,
      height: CONFIRM_BTN_H,
      label: 'Yes, Reset',
      ...BUTTON_PRESETS.danger,
      action: onConfirm,
    });
  }

  addButton(ctx, buttons, {
    x: cancelBtnX,
    y: btnY,
    width: btnW,
    height: CONFIRM_BTN_H,
    label: 'Cancel',
    ...BUTTON_PRESETS.primary,
    action: onCancel,
  });
}

export function renderSettingsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  audio: AudioManager,
  setTab: (tab: PauseTab) => void,
  onOpenChat: (() => void) | null,
  showResetConfirm: boolean,
  onRequestReset: () => void,
  onCancelReset: () => void,
  onConfirmReset: (() => void) | null,
): void {
  drawText(ctx, 'SETTINGS', {
    x: bx + bw / 2,
    y: by + SETTINGS_TITLE_Y,
    bold: true,
    size: SETTINGS_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  drawText(ctx, 'Audio', {
    x: bx + AUDIO_LABEL_X,
    y: by + AUDIO_LABEL_Y,
    bold: true,
    size: AUDIO_LABEL_SIZE,
    color: '#64748b',
  });

  const sliderW = bw - SLIDER_WIDTH_MARGIN;
  const sliderX = bx + SLIDER_X_OFFSET;
  let y = by + FIRST_SLIDER_Y_OFFSET;

  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'Master Volume', audio.masterVolume, (v) =>
    audio.setMasterVolume(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'Music Volume', audio.musicVolume, (v) =>
    audio.setMusicVolume(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'SFX Volume', audio.sfxVolume, (v) =>
    audio.setSfxVolume(v),
  );
  y += LAST_SLIDER_SPACING;

  if (platform.isMobile) {
    drawText(ctx, 'Mobile Controls', {
      x: bx + AUDIO_LABEL_X,
      y: y + MOBILE_SECTION_LABEL_Y_OFFSET,
      bold: true,
      size: MOBILE_SECTION_LABEL_SIZE,
      color: '#64748b',
    });
    y += MOBILE_SECTION_Y_SPACING;

    if (onOpenChat !== null) {
      addButton(ctx, buttons, {
        x: sliderX,
        y,
        width: sliderW,
        height: CHAT_BUTTON_HEIGHT,
        label: 'Send Chat',
        ...BUTTON_PRESETS.primary,
        action: onOpenChat,
      });
      y += CHAT_BUTTON_Y_SPACING;
    }
  }

  drawText(ctx, 'Game', {
    x: bx + AUDIO_LABEL_X,
    y: y + MOBILE_SECTION_LABEL_Y_OFFSET,
    bold: true,
    size: SECTION_LABEL_SIZE,
    color: '#64748b',
  });
  y += SECTION_LABEL_Y_SPACING;

  addButton(ctx, buttons, {
    x: sliderX,
    y,
    width: sliderW,
    height: RESET_BUTTON_HEIGHT,
    label: 'Reset Game',
    ...BUTTON_PRESETS.danger,
    action: onRequestReset,
  });
  y += RESET_BUTTON_Y_SPACING;

  addButton(ctx, buttons, {
    x: sliderX,
    y,
    width: sliderW,
    height: CHAT_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });

  if (showResetConfirm) {
    renderResetConfirmDialog(ctx, buttons, bx, by, bw, bh, onCancelReset, onConfirmReset);
  }
}
