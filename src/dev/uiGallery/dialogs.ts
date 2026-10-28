/**
 * The gallery's dialogs sheet: every dialog, end screen, explainer and
 * one-off themed dialog with fixture data, one at a time. The render script
 * captures each fixture by name; the live `?ui` route steps through them
 * with the fixture picker.
 */

import { FIXTURES as AI_INTERACTIONS } from './dialogs/aiInteractions';
import { FIXTURES as BESPOKE } from './dialogs/bespoke';
import { FIXTURES as CAROLINE } from './dialogs/caroline';
import { FIXTURES as CASINO } from './dialogs/casino';
import { FIXTURES as CHOICE } from './dialogs/choice';
import { FIXTURES as CONVERSATION } from './dialogs/conversation';
import { FIXTURES as END_SCREENS } from './dialogs/endScreens';
import { FIXTURES as EXPLAINERS } from './dialogs/explainers';
import type { DialogFixture } from './dialogs/fixture';
import { FIXTURES as PET_NAME } from './dialogs/petName';
import { FIXTURES as PIPE_BOARD } from './dialogs/pipeBoard';
import { FIXTURES as POKER } from './dialogs/poker';
import { FIXTURES as SLOTS } from './dialogs/slots';
import { FIXTURES as WHEEL } from './dialogs/wheel';

export const DIALOG_FIXTURES: readonly DialogFixture[] = [
  ...CHOICE,
  ...PET_NAME,
  ...END_SCREENS,
  ...EXPLAINERS,
  ...CONVERSATION,
  ...BESPOKE,
  ...CASINO,
  ...POKER,
  ...SLOTS,
  ...WHEEL,
  ...PIPE_BOARD,
  ...AI_INTERACTIONS,
  ...CAROLINE,
];
