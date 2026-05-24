import type { AudioManager } from '../../audio/AudioManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox } from '../Box';
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
const CAT_TAP_LABEL_Y_OFFSET = 13;
const CAT_TAP_LABEL_SIZE = 11;
const CAT_TAP_Y_SPACING = 26;
const BUTTON_SPACING_GAP = 8;
const BUTTON_HALF_DIVISOR = 2;
const BUTTON_HALF_WIDTH_MARGIN = 8;
const BUTTON_HEIGHT = 36;
const CAT_TAP_BUTTON_Y_SPACING = 48;
const CHAT_BUTTON_HEIGHT = 40;
const CHAT_BUTTON_Y_SPACING = 52;

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

export function renderSettingsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  audio: AudioManager,
  setTab: (tab: PauseTab) => void,
  catMissileDefault: boolean,
  setCatMissileDefault: (v: boolean) => void,
  onOpenChat: (() => void) | null,
): void {
  void bh;

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

    drawText(ctx, 'Cat Tap', {
      x: bx + AUDIO_LABEL_X,
      y: y + CAT_TAP_LABEL_Y_OFFSET,
      size: CAT_TAP_LABEL_SIZE,
      color: '#94a3b8',
    });
    y += CAT_TAP_Y_SPACING;

    const halfW = Math.floor((sliderW - BUTTON_HALF_WIDTH_MARGIN) / BUTTON_HALF_DIVISOR);

    addButton(ctx, buttons, {
      x: sliderX,
      y,
      width: halfW,
      height: BUTTON_HEIGHT,
      label: 'Scratch',
      ...(!catMissileDefault ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => setCatMissileDefault(false),
    });
    addButton(ctx, buttons, {
      x: sliderX + halfW + BUTTON_SPACING_GAP,
      y,
      width: halfW,
      height: BUTTON_HEIGHT,
      label: 'Magic Missile',
      ...(catMissileDefault ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => setCatMissileDefault(true),
    });
    y += CAT_TAP_BUTTON_Y_SPACING;

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

  addButton(ctx, buttons, {
    x: sliderX,
    y,
    width: sliderW,
    height: CHAT_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });
}
