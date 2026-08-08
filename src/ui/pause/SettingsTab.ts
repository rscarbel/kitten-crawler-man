import type { AudioManager } from '../../audio/AudioManager';
import { type ButtonRect, type PauseTab } from './types';
import { addButton, beginMenuFocus, endMenuFocus, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox, BOX_PRESETS } from '../Box';
import { platform } from '../../core/Platform';
import { settings, type QualityPreset } from '../../core/Settings';
import { renderQuality } from '../../core/RenderQuality';
import { DIFFICULTY_LABELS, type Difficulty } from '../../core/difficultyProfiles';

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

// Graphics section
const GRAPHICS_LABEL_Y_OFFSET = 16;
const GRAPHICS_LABEL_SIZE = 12;
const GRAPHICS_ROW_Y_SPACING = 32;
const QUALITY_BUTTON_HEIGHT = 36;
const QUALITY_BUTTON_GAP = 6;
const QUALITY_HINT_Y_OFFSET = 16;
const QUALITY_HINT_SIZE = 10;
/**
 * Height the section claims below the button row. The pause box's height is
 * fixed, and the mobile one is already tight in landscape, so the explanatory
 * line is a desktop luxury and the section is shorter without it.
 */
const QUALITY_SECTION_Y_SPACING_WITH_HINT = 60;
const QUALITY_SECTION_Y_SPACING_BARE = 44;

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
const DIFFICULTY_BUTTON_HEIGHT = 36;
const DIFFICULTY_BUTTON_GAP = 6;
const DIFFICULTY_HINT_Y_OFFSET = 16;
const DIFFICULTY_HINT_SIZE = 10;
const DIFFICULTY_SECTION_Y_SPACING_WITH_HINT = 60;
const DIFFICULTY_SECTION_Y_SPACING_BARE = 44;

/** Order the three tiers are laid out in, left to right. */
const DIFFICULTY_ORDER: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];

/** States the timing contract: levels stamp at the next spawn, damage changes immediately. */
const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: 'Take less damage now; weaker spawns from the next floor or bounty.',
  normal: 'The game as shipped — no scaling on either side.',
  hard: 'Take more damage now; tougher spawns and bigger rewards from the next floor or bounty.',
};

// Controls section
const CONTROLS_SECTION_LABEL_Y_OFFSET = 16;
const CONTROLS_SECTION_Y_SPACING = 32;
const CONTROLS_BUTTON_HEIGHT = 40;
const CONTROLS_BUTTON_Y_SPACING = 52;

// Mobile controls section
const MOBILE_SECTION_LABEL_Y_OFFSET = 16;
const MOBILE_SECTION_LABEL_SIZE = 12;
const MOBILE_SECTION_Y_SPACING = 32;
const CHAT_BUTTON_HEIGHT = 40;
const CHAT_BUTTON_Y_SPACING = 52;

// Reset Game button
const RESET_BUTTON_HEIGHT = 40;
const RESET_BUTTON_Y_SPACING = 52;
/** Breathing room under the last button when the section is bottom-anchored. */
const GAME_SECTION_BOTTOM_PAD = 12;
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
      label,
      ...(isSelected ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => {
        renderQuality.setPreset(preset);
      },
    });
  });

  if (!platform.isMobile) {
    drawText(ctx, QUALITY_HINTS[selected], {
      x: bx,
      y: by + QUALITY_BUTTON_HEIGHT + QUALITY_HINT_Y_OFFSET,
      size: QUALITY_HINT_SIZE,
      color: '#64748b',
      width: bw,
    });
  }
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
      label: DIFFICULTY_LABELS[difficulty],
      ...(isSelected ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => {
        settings.setDifficulty(difficulty);
      },
    });
  });

  if (!platform.isMobile) {
    drawText(ctx, DIFFICULTY_HINTS[selected], {
      x: bx,
      y: by + DIFFICULTY_BUTTON_HEIGHT + DIFFICULTY_HINT_Y_OFFSET,
      size: DIFFICULTY_HINT_SIZE,
      color: '#64748b',
      width: bw,
    });
  }
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
    audio.setMasterVolumePreference(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'Music Volume', audio.musicVolume, (v) =>
    audio.setMusicVolumePreference(v),
  );
  y += SLIDER_SPACING;
  renderVolumeSlider(ctx, buttons, sliderX, y, sliderW, 'SFX Volume', audio.sfxVolume, (v) =>
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
  renderQualityChoice(ctx, buttons, sliderX, y, sliderW);
  y += platform.isMobile ? QUALITY_SECTION_Y_SPACING_BARE : QUALITY_SECTION_Y_SPACING_WITH_HINT;

  drawText(ctx, 'Difficulty', {
    x: bx + AUDIO_LABEL_X,
    y: y + DIFFICULTY_LABEL_Y_OFFSET,
    bold: true,
    size: DIFFICULTY_LABEL_SIZE,
    color: '#64748b',
  });
  y += DIFFICULTY_ROW_Y_SPACING;
  renderDifficultyChoice(ctx, buttons, sliderX, y, sliderW);
  y += platform.isMobile
    ? DIFFICULTY_SECTION_Y_SPACING_BARE
    : DIFFICULTY_SECTION_Y_SPACING_WITH_HINT;

  drawText(ctx, 'Controls', {
    x: bx + AUDIO_LABEL_X,
    y: y + CONTROLS_SECTION_LABEL_Y_OFFSET,
    bold: true,
    size: SECTION_LABEL_SIZE,
    color: '#64748b',
  });
  y += CONTROLS_SECTION_Y_SPACING;

  addButton(ctx, buttons, {
    x: sliderX,
    y,
    width: sliderW,
    height: CONTROLS_BUTTON_HEIGHT,
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

  // Anchored to the bottom of the box rather than flowed after the sections
  // above. The box height is clamped to the viewport, so on a short screen the
  // flowed content runs past its lower edge — and Reset Game and Back are the
  // two controls that must never become unreachable. Anchoring can crowd the
  // section above it on such a screen, which is the better failure: the tab
  // does not scroll, so anything below the box edge cannot be reached at all.
  const gameSectionHeight =
    SECTION_LABEL_Y_SPACING + RESET_BUTTON_Y_SPACING + CHAT_BUTTON_HEIGHT + GAME_SECTION_BOTTOM_PAD;
  y = by + bh - gameSectionHeight;

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
}
