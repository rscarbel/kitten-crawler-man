/** Settings: volumes, UI size, render quality, difficulty, the companion toggle and the way to the controls. */

import { DIFFICULTY_LABELS, type Difficulty } from '../../../core/difficultyProfiles';
import { renderQuality } from '../../../core/RenderQuality';
import { settings, type QualityPreset, type UiSize } from '../../../core/Settings';
import { choiceRow, wideButton, type Choice } from './parts';
import type { PauseContext, PauseSection, SectionLayout } from './section';
import { slider, sliderHeight, stepSlider } from './slider';

/**
 * Presets rather than a scale slider: fractional render scales leave hairline
 * seams between adjacent chunk blits.
 */
const QUALITY_CHOICES: readonly Choice<QualityPreset>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'sharp', label: 'Sharp' },
  { value: 'performance', label: 'Fast' },
];

const QUALITY_HINTS: Readonly<Record<QualityPreset, string>> = {
  auto: 'Picks the sharpest setting this device keeps up with.',
  sharp: 'Full detail on high-density displays.',
  performance: 'Lowest cost. Best for older or throttling devices.',
};

const UI_SIZE_CHOICES: readonly Choice<UiSize>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/**
 * One global selector rather than a per-bounty picker: a second control at
 * Shady's board would invite toggling for the reward right before a kill.
 */
const DIFFICULTY_CHOICES: readonly Choice<Difficulty>[] = DIFFICULTY_ORDER.map((value) => ({
  value,
  label: DIFFICULTY_LABELS[value],
}));

/** The timing contract: levels stamp at the next spawn, damage changes at once. */
const DIFFICULTY_HINTS: Readonly<Record<Difficulty, string>> = {
  easy: 'Take less damage now; weaker spawns from the next floor or bounty.',
  normal: 'The game as shipped — no scaling on either side.',
  hard: 'Take more damage now; tougher spawns and bigger rewards from the next floor or bounty.',
};

const MONGO_AUTO_SUMMON_HINT =
  'While you play the human, the cat sends Mongo in when enemies are near. Also in the follower menu.';

function volumeSlider(
  layout: SectionLayout,
  id: string,
  label: string,
  value: number,
  set: (value: number) => void,
): void {
  const rect = layout.row(sliderHeight(layout.ui), layout.ui.theme.space.md);
  const state = slider(layout.ui, rect, { id, label, value, onChange: set });
  layout.track(rect, state, { adjust: (direction) => set(stepSlider(value, direction)) });
}

function renderSettings(layout: SectionLayout, ctx: PauseContext): void {
  const { ui } = layout;
  const audio = ctx.audio;
  if (audio !== null) {
    layout.heading('Audio');
    volumeSlider(layout, 'volume-master', 'Master Volume', audio.masterVolume, (v) =>
      audio.setMasterVolumePreference(v),
    );
    volumeSlider(layout, 'volume-music', 'Music Volume', audio.musicVolume, (v) =>
      audio.setMusicVolumePreference(v),
    );
    volumeSlider(layout, 'volume-sfx', 'SFX Volume', audio.sfxVolume, (v) =>
      audio.setSfxVolumePreference(v),
    );
  }

  layout.heading('UI size');
  choiceRow(layout, {
    id: 'ui-size',
    choices: UI_SIZE_CHOICES,
    selected: settings.uiSize,
    onPick: (size) => settings.setUiSize(size),
  });

  layout.heading('Graphics');
  choiceRow(layout, {
    id: 'quality',
    choices: QUALITY_CHOICES,
    selected: settings.quality,
    onPick: (preset) => renderQuality.setPreset(preset),
  });
  layout.paragraph(QUALITY_HINTS[settings.quality], 'muted', ui.theme.space.md);

  layout.heading('Difficulty');
  choiceRow(layout, {
    id: 'difficulty',
    choices: DIFFICULTY_CHOICES,
    selected: settings.difficulty,
    onPick: (difficulty) => ctx.actions.requestDifficulty(difficulty),
  });
  layout.paragraph(DIFFICULTY_HINTS[settings.difficulty], 'muted', ui.theme.space.md);

  layout.heading('Companion');
  const autoSummon = settings.catAutoSummonsMongo;
  wideButton(layout, {
    id: 'mongo-auto-summon',
    label: `Cat summons Mongo: ${autoSummon ? 'On' : 'Off'}`,
    selected: autoSummon,
    onTap: () => settings.setCatAutoSummonsMongo(!autoSummon),
  });
  layout.paragraph(MONGO_AUTO_SUMMON_HINT, 'muted', ui.theme.space.md);

  layout.heading('Controls');
  wideButton(layout, {
    id: 'open-controls',
    label: 'Controls & Key Bindings',
    icon: 'keyboard',
    onTap: () => ctx.actions.show('controls'),
  });

  const openChat = ctx.openChat;
  if (ui.density === 'touch' && openChat !== null) {
    layout.heading('Mobile controls');
    wideButton(layout, { id: 'send-chat', label: 'Send Chat', onTap: openChat });
  }
}

export function settingsSection(): PauseSection {
  return {
    id: 'settings',
    label: 'Settings',
    glyph: 'settings',
    render: renderSettings,
  };
}
