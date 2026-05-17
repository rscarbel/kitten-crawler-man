import type { AudioManager } from '../../audio/AudioManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox } from '../Box';
import { platform } from '../../core/Platform';

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
  const TRACK_H = 20;
  const labelY = by + 13;
  const trackY = by + 22;

  drawText(ctx, label, {
    x: bx,
    y: labelY,
    size: 11,
    color: '#94a3b8',
  });

  drawText(ctx, `${Math.round(value * 100)}%`, {
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
    height: TRACK_H,
    fill: '#0f172a',
    border: '#334155',
    borderWidth: 1,
  });

  const fillW = Math.round(bw * value);
  if (fillW > 2) {
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(bx + 1, trackY + 1, fillW - 2, TRACK_H - 2);
  }

  const sliderX = bx;
  buttons.push({
    x: sliderX,
    y: trackY,
    w: bw,
    h: TRACK_H,
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
    y: by + 30,
    bold: true,
    size: 18,
    color: '#f1f5f9',
    align: 'center',
  });

  drawText(ctx, 'Audio', {
    x: bx + 20,
    y: by + 60,
    bold: true,
    size: 12,
    color: '#64748b',
  });

  const sliderW = bw - 40;
  const sliderX = bx + 20;
  let y = by + 72;

  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'Master Volume', audio.masterVolume, (v) =>
    audio.setMasterVolume(v),
  );
  y += 58;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'Music Volume', audio.musicVolume, (v) =>
    audio.setMusicVolume(v),
  );
  y += 58;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'SFX Volume', audio.sfxVolume, (v) =>
    audio.setSfxVolume(v),
  );
  y += 52;

  if (platform.isMobile) {
    drawText(ctx, 'Mobile Controls', {
      x: bx + 20,
      y: y + 16,
      bold: true,
      size: 12,
      color: '#64748b',
    });
    y += 32;

    drawText(ctx, 'Cat Tap', {
      x: bx + 20,
      y: y + 13,
      size: 11,
      color: '#94a3b8',
    });
    y += 26;

    const halfW = Math.floor((sliderW - 8) / 2);

    addButton(ctx, buttons, {
      x: sliderX,
      y,
      width: halfW,
      height: 36,
      label: 'Scratch',
      ...(!catMissileDefault ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => setCatMissileDefault(false),
    });
    addButton(ctx, buttons, {
      x: sliderX + halfW + 8,
      y,
      width: halfW,
      height: 36,
      label: 'Magic Missile',
      ...(catMissileDefault ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => setCatMissileDefault(true),
    });
    y += 48;

    if (onOpenChat !== null) {
      addButton(ctx, buttons, {
        x: sliderX,
        y,
        width: sliderW,
        height: 40,
        label: 'Send Chat',
        ...BUTTON_PRESETS.primary,
        action: onOpenChat,
      });
      y += 52;
    }
  }

  addButton(ctx, buttons, {
    x: sliderX,
    y,
    width: sliderW,
    height: 40,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('main'),
  });
}
