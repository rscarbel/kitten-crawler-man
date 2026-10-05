import { setViewportSize } from '../../../core/Viewport';
import { Conversation } from '../../../dialog/Conversation';
import {
  speakerLines,
  transientSpeaker,
  type DialogLine,
  type NonEmpty,
} from '../../../dialog/line';
import type { Choice, ConversationRequest, DialogReward, Ending } from '../../../dialog/request';
import type { Surface, Ui } from '../../../ui/core/UiRoot';
import type { DialogFixture } from './fixture';

const noop = (): void => undefined;

/**
 * Points the game's CSS-pixel viewport at the gallery canvas, so a
 * `render(ctx)` that lays itself out from `viewportWidth()` sees the screen it
 * is drawn on.
 */
export function syncViewport(ui: Ui): void {
  setViewportSize(ui.screen.w * ui.uiScale, ui.screen.h * ui.uiScale);
}

/**
 * `surface`, open only while its fixture is shown, with the viewport synced
 * and `beforeRender` run before it draws.
 */
export function galleryGated(
  surface: Surface,
  shown: () => boolean,
  beforeRender: () => void = noop,
  /** Count the surface as open while shown even before `beforeRender` has opened its model. */
  openWhenShown = false,
): Surface {
  const gated: Surface = {
    id: surface.id,
    get band() {
      return surface.band;
    },
    get haltsWorld() {
      return surface.haltsWorld;
    },
    get locksKeyboard() {
      return surface.locksKeyboard;
    },
    get blocksEscape() {
      return surface.blocksEscape;
    },
    isOpen: () => shown() && (openWhenShown || surface.isOpen()),
    render: (ui) => {
      syncViewport(ui);
      beforeRender();
      surface.render(ui);
    },
    onKey: (key, mods) => surface.onKey?.(key, mods) ?? false,
  };
  if (surface.close !== undefined) gated.close = () => surface.close?.();
  return gated;
}

function choice(label: string, tone: Choice['tone']): Choice {
  return { label, tone, run: noop };
}

function request(
  lines: NonEmpty<DialogLine>,
  opts: { ending?: Ending; reward?: DialogReward; haltsWorld?: boolean } = {},
): ConversationRequest {
  return {
    lines,
    reward: opts.reward ?? null,
    questRelated: false,
    ending: opts.ending ?? { kind: 'close', onClosed: noop },
    dismiss: { kind: 'allowed', onDismissed: noop },
    haltsWorld: opts.haltsWorld ?? true,
    anchor: null,
    locksKeyboard: opts.haltsWorld ?? true,
  };
}

/** How many presses at most it takes to read a fixture to its last page. */
const MAX_FIXTURE_PRESSES = 20;

/**
 * A conversation opened on `req`. With `readToEnd`, every page is revealed
 * and turned until its choice row is up; otherwise it shows as it opens,
 * which for a one-sentence line is the whole line.
 */
function conversationFixture(
  name: string,
  req: ConversationRequest,
  readToEnd: boolean,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const conversation = new Conversation(null);
      const surface = conversation.surface({ id: `conversation-${name}` });
      let opened = false;
      const open = (): void => {
        if (opened) return;
        opened = true;
        conversation.open(req);
        conversation.update(null);
        if (!readToEnd) return;
        for (let press = 0; press < MAX_FIXTURE_PRESSES; press++) {
          if (conversation.isShowingChoices) break;
          conversation.advance();
          conversation.advance();
          conversation.update(null);
        }
      };
      return [galleryGated(surface, shown, open, true)];
    },
  };
}

const mordecai = speakerLines('mordecai');
const donut = speakerLines('donut');
const systemAi = transientSpeaker('System AI', 'system');

const LONG_TEXT =
  'Listen carefully, because I am only going to say this once. The stairwell down is sealed until the floor boss falls, and the boss is not going to fall on its own. You will want potions, you will want armor, and you will want to stop poking every goblin you meet with a stick. The safe rooms are marked on your map. Use them. Sleep. Eat something that is not a mushroom you found on the floor.';

export const FIXTURES: readonly DialogFixture[] = [
  conversationFixture(
    'conversation-line',
    request([
      mordecai.line(
        'Welcome to the dungeon, crawlers. Try not to die before lunch — the paperwork is murder.',
      ),
    ]),
    false,
  ),
  conversationFixture(
    'conversation-multipage',
    request([mordecai.line(LONG_TEXT), donut.line('WE KNOW, MORDECAI.')]),
    false,
  ),
  conversationFixture(
    'conversation-choices',
    request([mordecai.line('So. Are you going to help the ratkin or not?')], {
      ending: {
        kind: 'choices',
        choices: [
          choice('Take the job', 'quest'),
          choice('Ask about the pay', 'normal'),
          choice('Goodbye', 'exit'),
        ],
      },
    }),
    true,
  ),
  conversationFixture(
    'conversation-choices-floating',
    request([donut.line('Carl, we should buy the hat. The hat is important.')], {
      haltsWorld: false,
      ending: {
        kind: 'choices',
        choices: [
          choice('Buy the hat', 'normal'),
          choice('About the quest', 'quest'),
          choice('Not now', 'exit'),
        ],
      },
    }),
    true,
  ),
  conversationFixture(
    'conversation-reward',
    request([mordecai.line('You actually did it, so take this before I change my mind.')], {
      reward: {
        itemId: 'health_potion',
        displayName: 'Health Potion ×3',
        lines: ['Restores health when drunk.', 'Mordecai insists you keep the bottles.'],
        xp: 150,
      },
    }),
    false,
  ),
  conversationFixture(
    'conversation-reward-button',
    request([mordecai.button('Take it', 'Here is your cut, and do not spend it all on hats.')], {
      reward: {
        itemId: 'goblin_dynamite',
        displayName: 'Goblin Dynamite ×2',
        lines: ['Throw it. Then run.'],
        xp: 80,
      },
    }),
    false,
  ),
  conversationFixture(
    'conversation-custom-advance',
    request([mordecai.button('Show me the map', 'Before you go, let me show you where it is.')]),
    false,
  ),
  conversationFixture(
    'conversation-system-ai',
    request([
      systemAi.line(
        'New achievement! You have been awarded a Bronze Adventurer Box. Try not to cry about it.',
      ),
    ]),
    false,
  ),
];
