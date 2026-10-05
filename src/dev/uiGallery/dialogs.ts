/**
 * The gallery's dialogs sheet: every dialog, end screen, explainer and
 * one-off themed dialog with fixture data, one at a time. The render script
 * captures each fixture by name; the live `?ui` route steps through them
 * with the fixture picker.
 */

import type { Surface } from '../../ui/core/UiRoot';
import { FIXTURES as BESPOKE } from './dialogs/bespoke';
import { FIXTURES as CASINO } from './dialogs/casino';
import { FIXTURES as CHOICE } from './dialogs/choice';
import { FIXTURES as CONVERSATION } from './dialogs/conversation';
import { FIXTURES as END_SCREENS } from './dialogs/endScreens';
import { FIXTURES as EXPLAINERS } from './dialogs/explainers';
import type { DialogFixture } from './dialogs/fixture';
import { fixtureSheetSurfaces } from './fixturePicker';
import type { GalleryModel } from './model';

export const DIALOG_FIXTURES: readonly DialogFixture[] = [
  ...CHOICE,
  ...END_SCREENS,
  ...EXPLAINERS,
  ...CONVERSATION,
  ...BESPOKE,
  ...CASINO,
];

/** Every dialog fixture's surfaces; with `picker`, the live route's fixture strip too. */
export function dialogGallerySurfaces(model: GalleryModel, picker: boolean): Surface[] {
  return fixtureSheetSurfaces(model, 'dialogs', DIALOG_FIXTURES, picker);
}
