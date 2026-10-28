/**
 * Free text typed into a canvas field goes through a focused DOM text field
 * kept off to the side, invisible: the browser then does the text editing
 * (an IME's composed text, AltGr and Option characters, caret moves, paste),
 * and a phone raises its on-screen keyboard for it.
 *
 * A phone raises that keyboard only for a `focus()` made inside the tap that
 * asked for it, so a field focuses the sink from its own tap handler.
 */

/** Sixteen pixels keeps iOS from zooming the page to the field. */
const KEYBOARD_SINK_FONT_PX = 16;
const KEYBOARD_SINK_Z_INDEX = 9999;
/**
 * The key code a browser reports for a key an IME is handling. Safari ends
 * the composition before the Enter that commits it arrives, so that Enter
 * shows `isComposing` false and only this code says the IME took it.
 */
const IME_PROCESS_KEY_CODE = 229;

/**
 * Whether an IME took `e`. `keyCode` is deprecated and typed so, but no
 * other field carries Safari's signal; it is read by name for that reason.
 */
function imeTookKey(e: KeyboardEvent): boolean {
  return e.isComposing || Reflect.get(e, 'keyCode') === IME_PROCESS_KEY_CODE;
}

export interface TextEntrySinkOptions {
  readonly maxLength: number;
  /** Enter, unless it commits an IME composition or is an auto-repeat. */
  readonly onEnter: () => void;
  /** Escape. Absent where Escape must not end the entry. */
  readonly onEscape?: () => void;
}

/**
 * The text being typed and the hidden field it is typed through. One per
 * entry: build it as the entry opens, {@link dispose} it as the entry ends
 * and when the scene holding it tears down, or the field left on the page
 * swallows every key the next scene needs.
 */
export class TextEntrySink {
  private text = '';
  private field: HTMLInputElement | null = null;

  constructor(private readonly options: TextEntrySinkOptions) {}

  get value(): string {
    return this.text;
  }

  /** Whether keys are going to the hidden field right now. */
  get focused(): boolean {
    return this.field !== null && document.activeElement === this.field;
  }

  /** Where the caret sits: the field's own caret, so arrow-key edits show. */
  caretIndex(): number {
    const caret = this.field?.selectionEnd ?? this.text.length;
    return Math.min(Math.max(caret, 0), this.text.length);
  }

  /**
   * Adds the hidden field at the bottom left of `anchor`, where a phone
   * scrolls to show it. Without a call to this the entry types only through
   * {@link typeKey}.
   */
  attach(anchor: HTMLCanvasElement): void {
    if (this.field !== null) return;
    const field = document.createElement('input');
    field.type = 'text';
    field.maxLength = this.options.maxLength;
    field.value = this.text;
    const rect = anchor.getBoundingClientRect();
    Object.assign(field.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      bottom: `${window.innerHeight - rect.bottom}px`,
      width: '1px',
      opacity: '0',
      fontSize: `${KEYBOARD_SINK_FONT_PX}px`,
      pointerEvents: 'none',
      zIndex: `${KEYBOARD_SINK_Z_INDEX}`,
    });
    const readField = () => {
      this.text = field.value.slice(0, this.options.maxLength);
    };
    field.addEventListener('input', readField);
    field.addEventListener('compositionend', readField);
    field.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      // The Enter that commits an IME's composition belongs to the IME.
      if (imeTookKey(e)) return;
      if (e.key === 'Enter') {
        if (!e.repeat) this.options.onEnter();
      } else if (e.key === 'Escape') {
        this.options.onEscape?.();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    });
    document.body.appendChild(field);
    this.field = field;
  }

  focus(): void {
    this.field?.focus();
  }

  /** Replaces the text, with the caret after it. */
  setValue(value: string): void {
    this.text = value.slice(0, this.options.maxLength);
    this.syncField();
  }

  /**
   * One key that reached the canvas instead of the field, which happens only
   * when the field has lost focus or was never attached: Backspace erases and
   * a printable key types. The field is kept in step and takes focus back.
   * Returns whether the key edited the text.
   */
  typeKey(key: string): boolean {
    let edited = false;
    if (key === 'Backspace') {
      this.text = this.text.slice(0, -1);
      edited = true;
    } else if (Array.from(key).length === 1 && this.text.length < this.options.maxLength) {
      this.text += key;
      edited = true;
    }
    this.syncField();
    this.focus();
    return edited;
  }

  /** Removes the hidden field from the page. */
  dispose(): void {
    const field = this.field;
    if (field === null) return;
    this.field = null;
    field.remove();
  }

  private syncField(): void {
    const field = this.field;
    if (field === null) return;
    field.value = this.text;
    field.setSelectionRange(this.text.length, this.text.length);
  }
}
