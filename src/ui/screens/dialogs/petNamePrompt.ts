/**
 * Asks the player to name a pet: its portrait, a text field, a row of
 * suggestions a tap puts in the field, "Surprise me" and Confirm. A name is
 * required, so Escape does nothing and Confirm waits for a legal name. The
 * suggestions name the pet without the keyboard, which on a phone would
 * cover half the sheet.
 */

import {
  PET_NAME_RULE_MESSAGES,
  PET_NAME_SUGGESTIONS,
  parsePetName,
  petNameRejection,
  type PetKind,
  type PetName,
} from '../../../core/party/petNames';
import { NAME_MAX_CODE_UNITS } from '../../../core/naming/nameRules';
import { activeInputMode } from '../../core/inputMode';
import type { Rect } from '../../core/geom';
import type { KeyModifiers, Surface, Ui } from '../../core/UiRoot';
import { TextEntrySink } from '../../input/textEntrySink';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { choiceModal, type ChoiceModalConfig } from '../../widgets/choiceModal';
import { panelBodyWidth } from '../../widgets/panel';
import { scrollGutterWidth } from '../../widgets/scrollView';
import { textField } from '../../widgets/textField';

/** Paints the pet into the square the prompt shows it in. */
export type PetPortrait = (ctx: CanvasRenderingContext2D, rect: Rect) => void;

export interface PetNameRequest {
  readonly kind: PetKind;
  readonly portrait: PetPortrait;
  /**
   * The canvas the hidden text field is placed against. Null for a headless
   * harness, where the prompt types only through the keys it is offered.
   */
  readonly keyboardAnchor: HTMLCanvasElement | null;
  /** Runs once, with the name confirmed, after the prompt has closed. */
  readonly onNamed: (name: PetName) => void;
}

const PET_NAME_PROMPT_TITLES = {
  deinonychus: 'Name your Deinonychus',
  attackCow: 'Name your attack cow',
} as const satisfies Record<PetKind, string>;

const PET_NAME_PLACEHOLDER = 'Type a name';
const SURPRISE_LABEL = 'Surprise me';
const CONFIRM_LABEL = 'Confirm';
const PANEL_WIDTH = 'md';
const CHIP_SIZE = 'sm';
const PORTRAIT_HEIGHT = 96;
/** A phone's sheet keeps its room for the suggestions, which name the pet without the keyboard. */
const COMPACT_PORTRAIT_HEIGHT = 56;
const CONFIRM_BUTTON_INDEX = 1;
/** Keys that move the focus ring or press the focused control, never typed. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

interface OpenPrompt {
  readonly request: PetNameRequest;
  readonly sink: TextEntrySink;
}

/** The suggestion chips split into rows that fit `width`, each chip with its width. */
function chipRows(
  ui: Ui,
  labels: readonly string[],
  width: number,
): Array<Array<{ label: string; w: number }>> {
  const gap = ui.theme.space.sm;
  const rows: Array<Array<{ label: string; w: number }>> = [];
  let row: Array<{ label: string; w: number }> = [];
  let used = 0;
  for (const label of labels) {
    const w = Math.min(width, measureButton(ui, { label, size: CHIP_SIZE }));
    const needed = row.length === 0 ? w : used + gap + w;
    if (row.length > 0 && needed > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used = row.length === 0 ? w : used + gap + w;
    row.push({ label, w });
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

function chipBlockHeight(ui: Ui, rowCount: number): number {
  const gap = ui.theme.space.sm;
  return rowCount * buttonHeight(ui, CHIP_SIZE) + Math.max(0, rowCount - 1) * gap;
}

/**
 * The pet-naming prompt. One per scene, held by `MenusKit`; a request made
 * while another pet is being named waits its turn. Two requests for the same
 * pet ask once, and the name answers both.
 */
export class PetNamePrompt {
  private current: OpenPrompt | null = null;
  private readonly waiting: PetNameRequest[] = [];

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(request: PetNameRequest): void {
    if (this.current !== null) {
      this.waiting.push(request);
      return;
    }
    const sink = new TextEntrySink({
      maxCodeUnits: NAME_MAX_CODE_UNITS,
      onEnter: () => this.confirm(),
    });
    this.current = { request, sink };
    if (request.keyboardAnchor === null) return;
    sink.attach(request.keyboardAnchor);
    // Raising a phone's keyboard unasked would hide the suggestions under it;
    // there a tap on the field raises it.
    if (activeInputMode() === 'pointer') sink.focus();
  }

  /** Puts `name` in the field, as a tap on its suggestion does. */
  fill(name: string): void {
    this.current?.sink.setValue(name);
  }

  /** Fills the field with a suggestion other than what it holds. */
  surprise(): void {
    const current = this.current;
    if (current === null) return;
    const typed = current.sink.value;
    const others = PET_NAME_SUGGESTIONS[current.request.kind].filter((name) => name !== typed);
    const pickIndex = Math.floor(Math.random() * others.length);
    const pick = others.find((_, index) => index === pickIndex);
    if (pick !== undefined) current.sink.setValue(pick);
  }

  /** Names the pet with what the field holds, when that is a legal name. */
  confirm(): void {
    const current = this.current;
    if (current === null) return;
    const name = parsePetName(current.sink.value);
    if (name === null) return;
    current.sink.dispose();
    this.current = null;
    const kind = current.request.kind;
    const alsoAnswered = this.waiting.filter((request) => request.kind === kind);
    const stillWaiting = this.waiting.filter((request) => request.kind !== kind);
    this.waiting.length = 0;
    this.waiting.push(...stillWaiting);
    current.request.onNamed(name);
    for (const request of alsoAnswered) request.onNamed(name);
    const next = this.waiting.shift();
    if (next !== undefined) this.open(next);
  }

  /**
   * Drops the prompt and every request waiting on it, taking the hidden text
   * field off the page. For the scene tearing down.
   */
  dispose(): void {
    this.current?.sink.dispose();
    this.current = null;
    this.waiting.length = 0;
  }

  /**
   * The prompt as a surface. It halts the world and takes every key while
   * open, Space included, so the field can type it; Escape is spent on it.
   */
  surface(id: string): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      takesText: true,
      blocksEscape: true,
      isOpen: () => this.isOpen,
      render: (ui) => {
        const current = this.current;
        if (current !== null) choiceModal(ui, this.content(ui, current));
      },
      onKey: (key, mods) => this.handleKey(key, mods),
    };
  }

  /**
   * A key that reached the canvas, which happens only while the hidden field
   * is unfocused or absent. It types into the field, except the keys that
   * move the focus ring and Enter, which presses the focused control or,
   * with none, Confirm.
   */
  private handleKey(key: string, mods: KeyModifiers): boolean {
    const current = this.current;
    if (current === null) return false;
    if (mods.predatesSurface === true) return true;
    if (NAVIGATION_KEYS.has(key) || key === 'Escape') return false;
    current.sink.typeKey(key);
    return true;
  }

  private content(ui: Ui, current: OpenPrompt): ChoiceModalConfig {
    const { request, sink } = current;
    const suggestions = PET_NAME_SUGGESTIONS[request.kind];
    const gap = ui.theme.space.sm;
    const fieldHeight = ui.theme.size.control;
    const narrowestBody = panelBodyWidth(ui, PANEL_WIDTH) - scrollGutterWidth(ui);
    const rowCount = chipRows(ui, suggestions, narrowestBody).length;
    const rejection = petNameRejection(sink.value);
    const confirmBlocked = rejection === null ? false : PET_NAME_RULE_MESSAGES[rejection];
    return {
      id: 'pet-name',
      title: PET_NAME_PROMPT_TITLES[request.kind],
      width: PANEL_WIDTH,
      hero: {
        height: ui.size === 'compact' ? COMPACT_PORTRAIT_HEIGHT : PORTRAIT_HEIGHT,
        paint: (ctx, rect) => request.portrait(ctx, rect),
      },
      extra: {
        height: fieldHeight + gap + chipBlockHeight(ui, rowCount),
        draw: (rect) => {
          const field: Rect = { ...rect, h: fieldHeight };
          textField(ui, field, {
            id: 'name',
            sink,
            placeholder: PET_NAME_PLACEHOLDER,
            active: sink.focused || ui.density === 'pointer',
          });
          this.drawSuggestions(ui, { ...rect, y: rect.y + fieldHeight + gap }, current);
        },
      },
      buttons: [
        {
          id: 'surprise',
          label: SURPRISE_LABEL,
          icon: 'sparkle',
          variant: 'secondary',
          onTap: () => this.surprise(),
        },
        {
          id: 'confirm',
          label: CONFIRM_LABEL,
          icon: 'check',
          disabled: confirmBlocked,
          onTap: () => this.confirm(),
        },
      ],
      defaultButton: CONFIRM_BUTTON_INDEX,
    };
  }

  private drawSuggestions(ui: Ui, area: Rect, current: OpenPrompt): void {
    const gap = ui.theme.space.sm;
    const chipHeight = buttonHeight(ui, CHIP_SIZE);
    const rows = chipRows(ui, PET_NAME_SUGGESTIONS[current.request.kind], area.w);
    const typed = current.sink.value;
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.reduce((sum, chip) => sum + chip.w, 0) + gap * (row.length - 1);
      let x = area.x + (area.w - rowWidth) / 2;
      const y = area.y + rowIndex * (chipHeight + gap);
      for (const chip of row) {
        button(
          ui,
          { x, y, w: chip.w, h: chipHeight },
          {
            id: `suggestion/${chip.label}`,
            label: chip.label,
            size: CHIP_SIZE,
            variant: 'secondary',
            selected: typed === chip.label,
            onTap: () => this.fill(chip.label),
          },
        );
        x += chip.w + gap;
      }
    });
  }
}
