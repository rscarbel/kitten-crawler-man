import type { AudioManager } from '../../audio/AudioManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, beginMenuFocus, endMenuFocus, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox, drawScrollbar, BOX_PRESETS } from '../Box';
import { platform } from '../../core/Platform';
import { settings, type QualityPreset } from '../../core/Settings';
import { renderQuality } from '../../core/RenderQuality';
import { DIFFICULTY_LABELS, type Difficulty } from '../../core/difficultyProfiles';

/** The on-screen span of the scrolling list, in canvas pixels. */
interface ScrollBand {
  top: number;
  bottom: number;
}

/**
 * Only a control wholly inside the band is live: a half-scrolled one would
 * otherwise still answer a click or the keyboard from under the title or footer.
 */
function isWhollyInBand(band: ScrollBand, y: number, height: number): boolean {
  return y >= band.top && y + height <= band.bottom;
}

const TRACK_HEIGHT = 20;
/** The drawn track is thin; the touch target around it is not. */
const TRACK_HIT_PAD = 10;
const LABEL_Y_OFFSET = 13;
const TRACK_Y_OFFSET = 22;
const PERCENTAGE_MULTIPLIER = 100;
const TRACK_FILL_X_OFFSET = 1;
const TRACK_FILL_Y_OFFSET = 1;
const TRACK_FILL_WIDTH_MARGIN = 2;
const TRACK_FILL_HEIGHT_MARGIN = 2;
const MIN_FILL_WIDTH = 2;

/** Top of the scrolling list and the footer that holds the always-reachable Back button. */
export const SETTINGS_SCROLL_TOP_Y = 46;
export const SETTINGS_FOOTER_H = 60;
const BACK_BUTTON_HEIGHT = 44;
const BACK_BUTTON_BOTTOM_PAD = 8;
const SCROLLBAR_X_OFFSET = 7;
const SCROLLBAR_WIDTH = 3;
const SETTINGS_TITLE_Y = 30;
const SETTINGS_TITLE_SIZE = 18;
const AUDIO_LABEL_X = 20;
const AUDIO_LABEL_Y = 8;
const AUDIO_LABEL_SIZE = 12;
const SLIDER_WIDTH_MARGIN = 40;
const SLIDER_X_OFFSET = 20;
const FIRST_SLIDER_Y_OFFSET = 20;
const SLIDER_SPACING = 58;
const LAST_SLIDER_SPACING = 52;

const GRAPHICS_LABEL_Y_OFFSET = 16;
const GRAPHICS_LABEL_SIZE = 12;
const GRAPHICS_ROW_Y_SPACING = 32;
const QUALITY_BUTTON_HEIGHT = 40;
const QUALITY_BUTTON_GAP = 6;
const QUALITY_HINT_Y_OFFSET = 6;
const QUALITY_HINT_SIZE = 10;
/** Enough for a hint that wraps to three lines on a narrow phone, plus the gap before the next section. */
const HINT_BLOCK_H = 48;
const QUALITY_SECTION_Y_SPACING = QUALITY_BUTTON_HEIGHT + QUALITY_HINT_Y_OFFSET + HINT_BLOCK_H;

/** Order the three presets are laid out in, left to right. */
const QUALITY_CHOICES: ReadonlyArray<{ preset: QualityPreset; label: string }> = [
  { preset: 'auto', label: 'Auto' },
  { preset: 'sharp', label: 'Sharp' },
  { preset: 'performance', label: 'Fast' },
];

const QUALITY_HINTS: Record<QualityPreset, string> = {
  auto: 'Picks the sharpest setting this device keeps up with.',
  sharp: 'Full detail on high-density displays.',
  performance: 'Lowest cost. Best for older or throttling devices.',
};

// Difficulty section — same layout constants as Graphics, cloned rather than
// shared: the two sections happen to look alike today, but that is not a
// reason to couple their spacing.
const DIFFICULTY_LABEL_Y_OFFSET = 16;
const DIFFICULTY_LABEL_SIZE = 12;
const DIFFICULTY_ROW_Y_SPACING = 32;
const DIFFICULTY_BUTTON_HEIGHT = 40;
const DIFFICULTY_BUTTON_GAP = 6;
const DIFFICULTY_HINT_Y_OFFSET = 6;
const DIFFICULTY_HINT_SIZE = 10;
const DIFFICULTY_SECTION_Y_SPACING =
  DIFFICULTY_BUTTON_HEIGHT + DIFFICULTY_HINT_Y_OFFSET + HINT_BLOCK_H;

/** Order the three tiers are laid out in, left to right. */
const DIFFICULTY_ORDER: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];

/** States the timing contract: levels stamp at the next spawn, damage changes immediately. */
const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: 'Take less damage now; weaker spawns from the next floor or bounty.',
  normal: 'The game as shipped — no scaling on either side.',
  hard: 'Take more damage now; tougher spawns and bigger rewards from the next floor or bounty.',
};

const COMPANION_LABEL_Y_OFFSET = 16;
const COMPANION_ROW_Y_SPACING = 32;
const COMPANION_BUTTON_HEIGHT = 40;
const COMPANION_HINT_Y_OFFSET = 6;
const COMPANION_HINT_SIZE = 10;
const COMPANION_SECTION_Y_SPACING =
  COMPANION_BUTTON_HEIGHT + COMPANION_HINT_Y_OFFSET + HINT_BLOCK_H;

const MONGO_AUTO_SUMMON_HINT =
  'While you play the human, the cat sends Mongo in when enemies are near. Also in the follower menu.';

const CONTROLS_SECTION_LABEL_Y_OFFSET = 16;
const CONTROLS_SECTION_Y_SPACING = 32;
const CONTROLS_BUTTON_HEIGHT = 44;
const CONTROLS_BUTTON_Y_SPACING = 56;

const MOBILE_SECTION_LABEL_Y_OFFSET = 16;
const MOBILE_SECTION_LABEL_SIZE = 12;
const MOBILE_SECTION_Y_SPACING = 32;
const CHAT_BUTTON_HEIGHT = 44;
const CHAT_BUTTON_Y_SPACING = 56;

const RESET_BUTTON_HEIGHT = 44;
/** Breathing room under the last button when the section is bottom-anchored. */
const GAME_SECTION_BOTTOM_PAD = 12;
const SECTION_LABEL_Y_SPACING = 32;
const SECTION_LABEL_SIZE = 12;

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
    y: trackY - TRACK_HIT_PAD,
    w: bw,
    h: TRACK_HEIGHT + TRACK_HIT_PAD * 2,
    positionedAction: (mx: number) => {
      setter(Math.max(0, Math.min(1, (mx - sliderX) / bw)));
    },
  });
}

/**
 * Three-way quality choice. Presets rather than a scale slider: fractional
 * scales leave hairline seams between adjacent chunk blits.
 */
function renderQualityChoice(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  band: ScrollBand,
): void {
  const selected = settings.quality;
  const totalGap = QUALITY_BUTTON_GAP * (QUALITY_CHOICES.length - 1);
  const buttonWidth = Math.floor((bw - totalGap) / QUALITY_CHOICES.length);

  QUALITY_CHOICES.forEach(({ preset, label }, index) => {
    const isSelected = preset === selected;
    addButton(ctx, buttons, {
      x: bx + index * (buttonWidth + QUALITY_BUTTON_GAP),
      y: by,
      width: buttonWidth,
      height: QUALITY_BUTTON_HEIGHT,
      disabled: !isWhollyInBand(band, by, QUALITY_BUTTON_HEIGHT),
      label,
      ...(isSelected ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => {
        renderQuality.setPreset(preset);
      },
    });
  });

  drawText(ctx, QUALITY_HINTS[selected], {
    x: bx,
    y: by + QUALITY_BUTTON_HEIGHT + QUALITY_HINT_Y_OFFSET,
    size: QUALITY_HINT_SIZE,
    color: '#64748b',
    width: bw,
  });
}

/**
 * Three-way difficulty choice, cloned from {@link renderQualityChoice}'s
 * preset-button pattern. One global selector rather than a per-bounty picker:
 * a second control surface at Shady's board would invite reward-arbitrage
 * toggling right before a kill.
 */
function renderDifficultyChoice(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  band: ScrollBand,
): void {
  const selected = settings.difficulty;
  const totalGap = DIFFICULTY_BUTTON_GAP * (DIFFICULTY_ORDER.length - 1);
  const buttonWidth = Math.floor((bw - totalGap) / DIFFICULTY_ORDER.length);

  DIFFICULTY_ORDER.forEach((difficulty, index) => {
    const isSelected = difficulty === selected;
    addButton(ctx, buttons, {
      x: bx + index * (buttonWidth + DIFFICULTY_BUTTON_GAP),
      y: by,
      width: buttonWidth,
      height: DIFFICULTY_BUTTON_HEIGHT,
      disabled: !isWhollyInBand(band, by, DIFFICULTY_BUTTON_HEIGHT),
      label: DIFFICULTY_LABELS[difficulty],
      ...(isSelected ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => {
        settings.setDifficulty(difficulty);
      },
    });
  });

  drawText(ctx, DIFFICULTY_HINTS[selected], {
    x: bx,
    y: by + DIFFICULTY_BUTTON_HEIGHT + DIFFICULTY_HINT_Y_OFFSET,
    size: DIFFICULTY_HINT_SIZE,
    color: '#64748b',
    width: bw,
  });
}

function renderMongoAutoSummonToggle(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  band: ScrollBand,
): void {
  const enabled = settings.catAutoSummonsMongo;
  addButton(ctx, buttons, {
    x: bx,
    y: by,
    width: bw,
    height: COMPANION_BUTTON_HEIGHT,
    disabled: !isWhollyInBand(band, by, COMPANION_BUTTON_HEIGHT),
    label: `Cat summons Mongo: ${enabled ? 'On' : 'Off'}`,
    ...(enabled ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
    action: () => {
      settings.setCatAutoSummonsMongo(!enabled);
    },
  });

  drawText(ctx, MONGO_AUTO_SUMMON_HINT, {
    x: bx,
    y: by + COMPANION_BUTTON_HEIGHT + COMPANION_HINT_Y_OFFSET,
    size: COMPANION_HINT_SIZE,
    color: '#64748b',
    width: bw,
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
    primaryAction: true,
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
  scrollY: number,
): number {
  drawText(ctx, 'SETTINGS', {
    x: bx + bw / 2,
    y: by + SETTINGS_TITLE_Y,
    bold: true,
    size: SETTINGS_TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const scrollTop = by + SETTINGS_SCROLL_TOP_Y;
  const scrollHeight = Math.max(0, bh - SETTINGS_SCROLL_TOP_Y - SETTINGS_FOOTER_H);
  const scrollBottom = scrollTop + scrollHeight;
  const band: ScrollBand = { top: scrollTop, bottom: scrollBottom };
  const contentTop = scrollTop - scrollY;
  const scrolled: ButtonRect[] = [];

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollHeight);
  ctx.clip();

  drawText(ctx, 'Audio', {
    x: bx + AUDIO_LABEL_X,
    y: contentTop + AUDIO_LABEL_Y,
    bold: true,
    size: AUDIO_LABEL_SIZE,
    color: '#64748b',
  });

  const sliderW = bw - SLIDER_WIDTH_MARGIN;
  const sliderX = bx + SLIDER_X_OFFSET;
  let y = contentTop + FIRST_SLIDER_Y_OFFSET;

  renderVolumeSlider(ctx, scrolled, sliderX, y, sliderW, 'Master Volume', audio.masterVolume, (v) =>
    audio.setMasterVolumePreference(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, scrolled, sliderX, y, sliderW, 'Music Volume', audio.musicVolume, (v) =>
    audio.setMusicVolumePreference(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, scrolled, sliderX, y, sliderW, 'SFX Volume', audio.sfxVolume, (v) =>
    audio.setSfxVolumePreference(v),
  );
  y += LAST_SLIDER_SPACING;

  drawText(ctx, 'Graphics', {
    x: bx + AUDIO_LABEL_X,
    y: y + GRAPHICS_LABEL_Y_OFFSET,
    bold: true,
    size: GRAPHICS_LABEL_SIZE,
    color: '#64748b',
  });
  y += GRAPHICS_ROW_Y_SPACING;
  renderQualityChoice(ctx, scrolled, sliderX, y, sliderW, band);
  y += QUALITY_SECTION_Y_SPACING;

  drawText(ctx, 'Difficulty', {
    x: bx + AUDIO_LABEL_X,
    y: y + DIFFICULTY_LABEL_Y_OFFSET,
    bold: true,
    size: DIFFICULTY_LABEL_SIZE,
    color: '#64748b',
  });
  y += DIFFICULTY_ROW_Y_SPACING;
  renderDifficultyChoice(ctx, scrolled, sliderX, y, sliderW, band);
  y += DIFFICULTY_SECTION_Y_SPACING;

  drawText(ctx, 'Companion', {
    x: bx + AUDIO_LABEL_X,
    y: y + COMPANION_LABEL_Y_OFFSET,
    bold: true,
    size: SECTION_LABEL_SIZE,
    color: '#64748b',
  });
  y += COMPANION_ROW_Y_SPACING;
  renderMongoAutoSummonToggle(ctx, scrolled, sliderX, y, sliderW, band);
  y += COMPANION_SECTION_Y_SPACING;

  drawText(ctx, 'Controls', {
    x: bx + AUDIO_LABEL_X,
    y: y + CONTROLS_SECTION_LABEL_Y_OFFSET,
    bold: true,
    size: SECTION_LABEL_SIZE,
    color: '#64748b',
  });
  y += CONTROLS_SECTION_Y_SPACING;

  addButton(ctx, scrolled, {
    x: sliderX,
    y,
    width: sliderW,
    height: CONTROLS_BUTTON_HEIGHT,
    disabled: !isWhollyInBand(band, y, CONTROLS_BUTTON_HEIGHT),
    label: 'Controls & Key Bindings',
    ...BUTTON_PRESETS.primary,
    action: () => setTab('controls'),
  });
  y += CONTROLS_BUTTON_Y_SPACING;

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
      addButton(ctx, scrolled, {
        x: sliderX,
        y,
        width: sliderW,
        height: CHAT_BUTTON_HEIGHT,
        disabled: !isWhollyInBand(band, y, CHAT_BUTTON_HEIGHT),
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

  addButton(ctx, scrolled, {
    x: sliderX,
    y,
    width: sliderW,
    height: RESET_BUTTON_HEIGHT,
    disabled: !isWhollyInBand(band, y, RESET_BUTTON_HEIGHT),
    label: 'Reset Game',
    ...BUTTON_PRESETS.danger,
    action: onRequestReset,
  });
  y += RESET_BUTTON_HEIGHT + GAME_SECTION_BOTTOM_PAD;

  const contentHeight = y - contentTop;
  ctx.restore();

  // Only controls wholly inside the band keep a hit-rect: a half-scrolled one
  // would otherwise still answer a click out under the title or the footer.
  for (const rect of scrolled) {
    if (isWhollyInBand(band, rect.y, rect.h)) buttons.push(rect);
  }

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_OFFSET,
    trackY: scrollTop,
    trackH: scrollHeight,
    contentH: contentHeight,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  addButton(ctx, buttons, {
    x: sliderX,
    y: by + bh - BACK_BUTTON_HEIGHT - BACK_BUTTON_BOTTOM_PAD,
    width: sliderW,
    height: BACK_BUTTON_HEIGHT,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('main'),
  });

  if (showResetConfirm) {
    buttons.length = 0;
    // Narrows both the click routing and the focus ring to the dialog's own two
    // buttons, so nothing behind the dim can be reached by pointer or keyboard.
    beginMenuFocus('pause-reset-confirm');
    renderResetConfirmDialog(ctx, buttons, bx, by, bw, bh, onCancelReset, onConfirmReset);
    endMenuFocus();
  }

  return contentHeight;
}
