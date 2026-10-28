/**
 * The character creation screen a new game opens before its first floor, in
 * three pages: the player's name, a body, then one of that body's two
 * figures. Back steps one page back on every page, and Back or Escape on the
 * first page closes the screen without starting anything. Continue never
 * opens it: a saved run already has its identity.
 */

import {
  PLAYER_NAME_RULE_MESSAGES,
  parsePlayerName,
  playerNameRejection,
  type PlayerName,
} from '../../../core/naming/playerName';
import { NAME_MAX_CODE_UNITS } from '../../../core/naming/nameRules';
import type { PlayerIdentity } from '../../../characters/playerIdentity';
import {
  COMPLEXIONS,
  CRAWLER_BODIES,
  lookIdOf,
  type Complexion,
  type CrawlerBody,
  type HumanCrawlerLookId,
} from '../../../characters/crawlerChoices';
import { activeInputMode } from '../../core/inputMode';
import { splitH, splitV, type Rect } from '../../core/geom';
import type { KeyModifiers, Surface, Ui } from '../../core/UiRoot';
import { TextEntrySink } from '../../input/textEntrySink';
import { button, buttonHeight } from '../../widgets/button';
import { card } from '../../widgets/card';
import { choiceModal, type ChoiceButton, type ChoiceModalConfig } from '../../widgets/choiceModal';
import { lineHeightOf, text } from '../../widgets/text';
import type { TextRole } from '../../theme/skins';
import { textField } from '../../widgets/textField';

/** Paints the screen's pictures of the human crawler's looks, and owns every cell they take. */
export interface CreationFigurePainter {
  /** Paints `look` standing head-on in its idle row, fitted into `rect`, as of `nowMs`. */
  paint(ctx: CanvasRenderingContext2D, rect: Rect, look: HumanCrawlerLookId, nowMs: number): void;
  /** Lets go of everything painted, so no look the player is not choosing between stays resident. */
  release(): void;
}

export interface CharacterCreationDeps {
  readonly figures: CreationFigurePainter;
  /**
   * The canvas the hidden text field is placed against. Null for a headless
   * harness, where the name is typed only through the keys the screen is offered.
   */
  readonly keyboardAnchor: HTMLCanvasElement | null;
}

export const CREATION_PAGES = ['name', 'body', 'figure'] as const;
export type CreationPage = (typeof CREATION_PAGES)[number];

type CreationStep =
  | { readonly page: 'name'; readonly sink: TextEntrySink }
  | { readonly page: 'body'; readonly name: PlayerName }
  | {
      readonly page: 'figure';
      readonly name: PlayerName;
      readonly body: CrawlerBody;
      readonly complexion: Complexion | null;
    };

interface OpenCreation {
  readonly onConfirm: (identity: PlayerIdentity) => void;
  step: CreationStep;
  /** What the field held when the player left the first page, given back on the way back to it. */
  typed: string;
  /** The body last chosen, shown selected when the player steps back to choose again. */
  chosenBody: CrawlerBody | null;
}

const MODAL_ID = 'creation';
const PANEL_WIDTH = 'md';
const BODY_BUTTON_SIZE = 'lg';
const NAME_PLACEHOLDER = 'Type a name';
const BACK_LABEL = 'Back';
const NEXT_LABEL = 'Next';
const BEGIN_LABEL = 'Begin';
const NO_FIGURE_REASON = 'Pick a figure';
const NEXT_BUTTON_INDEX = 1;
const RULE_ROLE = 'danger' satisfies TextRole;
const BEGIN_BUTTON_INDEX = 1;

const PAGE_TITLES = {
  name: 'What should the dungeon call you?',
  body: 'Choose a body',
  figure: 'Choose a figure',
} as const satisfies Record<CreationPage, string>;

const BODY_LABELS = {
  male: 'Male',
  female: 'Female',
} as const satisfies Record<CrawlerBody, string>;

/** How tall each figure's card stands, by whether the sheet is a phone's. */
const FIGURE_CARD_HEIGHT = 220;
const COMPACT_FIGURE_CARD_HEIGHT = 150;

/** Keys that move the focus ring or press the focused control, never typed. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function overlineOf(page: CreationPage): string {
  return `Step ${CREATION_PAGES.indexOf(page) + 1} of ${CREATION_PAGES.length}`;
}

/** The region id of the card that picks `complexion`, for harnesses and fixtures. */
export function figureCardId(complexion: Complexion): `figure/${Complexion}` {
  return `figure/${complexion}`;
}

/** The region id of the button that picks `body`, for harnesses and fixtures. */
export function bodyButtonId(body: CrawlerBody): `body/${CrawlerBody}` {
  return `body/${body}`;
}

/**
 * The creation screen. One per title scene, mounted once through
 * {@link surface}; {@link open} starts it and {@link dispose} takes its hidden
 * text field off the page when the scene tears down.
 */
export class CharacterCreation {
  private current: OpenCreation | null = null;

  constructor(private readonly deps: CharacterCreationDeps) {}

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** The page showing, or null while closed. */
  get page(): CreationPage | null {
    return this.current?.step.page ?? null;
  }

  /** Opens on the first page; `onConfirm` runs once, after it closes, with what the player chose. */
  open(onConfirm: (identity: PlayerIdentity) => void): void {
    if (this.current !== null) return;
    this.current = { onConfirm, step: this.nameStep(''), typed: '', chosenBody: null };
  }

  /** Puts `name` in the field, as typing it would. */
  fill(name: string): void {
    const step = this.current?.step;
    if (step?.page === 'name') step.sink.setValue(name);
  }

  /** Leaves the first page for the body, when the field holds a legal name. */
  next(): void {
    const current = this.current;
    if (current?.step.page !== 'name') return;
    const { sink } = current.step;
    const name = parsePlayerName(sink.value);
    if (name === null) return;
    current.typed = sink.value;
    sink.dispose();
    current.step = { page: 'body', name };
  }

  chooseBody(body: CrawlerBody): void {
    const current = this.current;
    if (current?.step.page !== 'body') return;
    current.chosenBody = body;
    current.step = { page: 'figure', name: current.step.name, body, complexion: null };
  }

  chooseComplexion(complexion: Complexion): void {
    const current = this.current;
    if (current?.step.page !== 'figure') return;
    current.step = { ...current.step, complexion };
  }

  /** Confirms the figure picked and closes, handing the identity on. */
  begin(): void {
    const current = this.current;
    if (current?.step.page !== 'figure') return;
    const { name, body, complexion } = current.step;
    if (complexion === null) return;
    this.close();
    current.onConfirm({ name, body, complexion });
  }

  /** One page back; from the first page, closes the screen. */
  back(): void {
    const current = this.current;
    if (current === null) return;
    const { step } = current;
    switch (step.page) {
      case 'name':
        this.close();
        return;
      case 'body':
        current.step = this.nameStep(current.typed);
        return;
      case 'figure':
        this.deps.figures.release();
        current.step = { page: 'body', name: step.name };
        return;
      default: {
        const unhandled: never = step;
        throw new Error(`unknown creation page: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Closes without confirming and lets go of the field and the figures. For the scene tearing down. */
  dispose(): void {
    this.close();
  }

  /**
   * The screen as a surface. It halts the title and takes every key while
   * open; on the first page it types them into the field.
   */
  surface(id: string): Surface {
    const isNamePage = (): boolean => this.current?.step.page === 'name';
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      get takesText() {
        return isNamePage();
      },
      isOpen: () => this.isOpen,
      close: () => this.back(),
      render: (ui) => {
        const current = this.current;
        if (current !== null) choiceModal(ui, this.content(ui, current));
      },
      onKey: (key, mods) => this.handleKey(key, mods),
    };
  }

  private close(): void {
    const step = this.current?.step;
    if (step?.page === 'name') step.sink.dispose();
    this.deps.figures.release();
    this.current = null;
  }

  private nameStep(typed: string): CreationStep {
    const sink = new TextEntrySink({
      maxCodeUnits: NAME_MAX_CODE_UNITS,
      onEnter: () => this.next(),
      onEscape: () => this.back(),
    });
    sink.setValue(typed);
    const anchor = this.deps.keyboardAnchor;
    if (anchor !== null) {
      sink.attach(anchor);
      // Raising a phone's keyboard unasked would cover half the sheet; there a tap on the field raises it.
      if (activeInputMode() === 'pointer') sink.focus();
    }
    return { page: 'name', sink };
  }

  /**
   * A key that reached the canvas, which on the first page happens only while
   * the hidden field is unfocused or absent: it types, except the keys that
   * move the focus ring, Enter and Escape.
   */
  private handleKey(key: string, mods: KeyModifiers): boolean {
    const step = this.current?.step;
    if (step?.page !== 'name') return false;
    if (mods.predatesSurface === true) return true;
    if (NAVIGATION_KEYS.has(key) || key === 'Escape') return false;
    step.sink.typeKey(key);
    return true;
  }

  private content(ui: Ui, current: OpenCreation): ChoiceModalConfig {
    const { step } = current;
    const back: ChoiceButton = {
      id: 'back',
      label: BACK_LABEL,
      icon: 'back',
      variant: 'secondary',
      onTap: () => this.back(),
    };
    const shared = {
      id: MODAL_ID,
      width: PANEL_WIDTH,
      overline: overlineOf(step.page),
      title: PAGE_TITLES[step.page],
    } as const;
    switch (step.page) {
      case 'name':
        return {
          ...shared,
          ...this.namePage(ui, step.sink),
          buttons: this.nameButtons(back, step.sink),
        };
      case 'body':
        return { ...shared, extra: this.bodyChoice(ui, current.chosenBody), buttons: [back] };
      case 'figure':
        return {
          ...shared,
          extra: this.figureChoice(ui, step.body, step.complexion),
          buttons: [
            back,
            {
              id: 'begin',
              label: BEGIN_LABEL,
              icon: 'check',
              disabled: step.complexion === null ? NO_FIGURE_REASON : false,
              onTap: () => this.begin(),
            },
          ],
          defaultButton: BEGIN_BUTTON_INDEX,
        };
      default: {
        const unhandled: never = step;
        throw new Error(`unknown creation page: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private nameButtons(back: ChoiceButton, sink: TextEntrySink): readonly ChoiceButton[] {
    const rejection = playerNameRejection(sink.value);
    return [
      back,
      {
        id: 'next',
        label: NEXT_LABEL,
        icon: 'chevronRight',
        disabled: rejection === null ? false : PLAYER_NAME_RULE_MESSAGES[rejection],
        onTap: () => this.next(),
      },
    ];
  }

  private namePage(
    ui: Ui,
    sink: TextEntrySink,
  ): Pick<ChoiceModalConfig, 'extra' | 'defaultButton'> {
    const fieldHeight = ui.theme.size.control;
    const gap = ui.theme.space.sm;
    const ruleHeight = lineHeightOf(ui, RULE_ROLE);
    const rejection = playerNameRejection(sink.value);
    const typedSomething = sink.value.trim() !== '';
    const rule = rejection !== null && typedSomething ? PLAYER_NAME_RULE_MESSAGES[rejection] : '';
    return {
      extra: {
        height: fieldHeight + gap + ruleHeight,
        draw: (rect) => {
          const [field, ruleLine] = splitV(rect, [fieldHeight, ruleHeight], gap);
          textField(ui, field, {
            id: 'name',
            sink,
            placeholder: NAME_PLACEHOLDER,
            active: sink.focused || ui.density === 'pointer',
          });
          if (rule !== '') text(ui, ruleLine, { text: rule, role: RULE_ROLE });
        },
      },
      defaultButton: NEXT_BUTTON_INDEX,
    };
  }

  private bodyChoice(ui: Ui, chosen: CrawlerBody | null): ChoiceModalConfig['extra'] {
    return {
      height: buttonHeight(ui, BODY_BUTTON_SIZE),
      draw: (rect) => {
        const columns = splitH(
          rect,
          CRAWLER_BODIES.map(() => 'fill' as const),
          ui.theme.space.md,
        );
        CRAWLER_BODIES.forEach((body, index) => {
          button(ui, columns[index], {
            id: bodyButtonId(body),
            label: BODY_LABELS[body],
            size: BODY_BUTTON_SIZE,
            variant: 'secondary',
            selected: chosen === body,
            onTap: () => this.chooseBody(body),
          });
        });
      },
    };
  }

  /** The body's two figures side by side, light on the left and dark on the right, with no words. */
  private figureChoice(
    ui: Ui,
    body: CrawlerBody,
    picked: Complexion | null,
  ): ChoiceModalConfig['extra'] {
    const height = ui.size === 'compact' ? COMPACT_FIGURE_CARD_HEIGHT : FIGURE_CARD_HEIGHT;
    return {
      height,
      draw: (rect) => {
        const columns = splitH(
          rect,
          COMPLEXIONS.map(() => 'fill' as const),
          ui.theme.space.md,
        );
        COMPLEXIONS.forEach((complexion, index) => {
          const look = lookIdOf({ body, complexion });
          card(ui, columns[index], {
            id: figureCardId(complexion),
            selected: picked === complexion,
            onTap: () => this.chooseComplexion(complexion),
            content: (figureRect) => this.deps.figures.paint(ui.ctx, figureRect, look, ui.now),
          });
        });
      },
    };
  }
}
