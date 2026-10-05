#!/usr/bin/env tsx
/**
 * The chat box on a desktop, headless.
 *
 * The box types through a hidden DOM `<input>` on every device, so the
 * browser's own text editing does the work: an IME's composed text, AltGr and
 * Option characters, caret moves and paste all arrive as the field's value.
 * The canvas key path is the fallback for a field that lost focus, and it
 * keeps the field in step. While the box is open no world key hook may take a
 * key the player meant to type.
 *
 * Run: npm run verify:chat-input
 */

import { gameContext } from './nodeGameContext.js';
import { PlayerChatSystem } from '../src/systems/PlayerChatSystem.js';
import { UiRoot } from '../src/ui/core/UiRoot.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

const SCREEN_W = 800;
const SCREEN_H = 600;
const FRAME_MS = 16;

interface FakeKeyEvent {
  readonly key: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  propagationStopped: boolean;
  defaultPrevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

function keyEvent(
  key: string,
  extra: { repeat?: boolean; isComposing?: boolean } = {},
): FakeKeyEvent {
  return {
    key,
    repeat: extra.repeat ?? false,
    isComposing: extra.isComposing ?? false,
    propagationStopped: false,
    defaultPrevented: false,
    stopPropagation() {
      this.propagationStopped = true;
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

/** A DOM text field: just the parts the chat box touches. */
class FakeInput {
  type = '';
  maxLength = -1;
  value = '';
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  readonly style: Record<string, string> = {};
  attached = false;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(private readonly doc: FakeDocument) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => entry !== listener),
    );
  }

  dispatch(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.doc.activeElement = this;
  }

  blur(): void {
    if (this.doc.activeElement === this) this.doc.activeElement = null;
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  remove(): void {
    this.attached = false;
    this.blur();
  }

  /** The browser types `typed` at the caret and fires `input`. */
  typeText(typed: string): void {
    const caret = this.selectionEnd ?? this.value.length;
    this.value = `${this.value.slice(0, caret)}${typed}${this.value.slice(caret)}`;
    this.setSelectionRange(caret + typed.length, caret + typed.length);
    this.dispatch('input');
  }
}

class FakeDocument {
  activeElement: unknown = null;
  readonly inputs: FakeInput[] = [];
  readonly body = {
    appendChild: (child: unknown) => {
      if (child instanceof FakeInput) child.attached = true;
    },
  };

  createElement(tag: string): unknown {
    if (tag === 'canvas') {
      return {
        getBoundingClientRect: () => ({ left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H }),
      };
    }
    const input = new FakeInput(this);
    this.inputs.push(input);
    return input;
  }
}

const fakeDocument = new FakeDocument();
Object.assign(globalThis, {
  document: fakeDocument,
  window: { innerWidth: SCREEN_W, innerHeight: SCREEN_H, devicePixelRatio: 1 },
});

const canvas = document.createElement('canvas');

function liveSink(): FakeInput | null {
  const attached = fakeDocument.inputs.filter((input) => input.attached);
  return attached.length === 1 ? attached[0] : null;
}

section('a desktop chat box types through a focused DOM field');
{
  const chat = new PlayerChatSystem();
  const sent: string[] = [];
  chat.open(canvas, (line) => sent.push(line));
  const sink = liveSink();
  check(sink !== null, 'opening the box on a pointer device adds one hidden text field');
  check(
    sink !== null && fakeDocument.activeElement === sink,
    'and focuses it, so keys go to the field',
  );
  if (sink !== null) {
    sink.dispatch('compositionstart');
    sink.value = 'にほ';
    sink.dispatch('input');
    const composingEnter = keyEvent('Enter', { isComposing: true });
    sink.dispatch('keydown', composingEnter);
    check(sent.length === 0 && chat.isOpen, 'Enter that commits an IME composition does not send');
    check(composingEnter.propagationStopped, 'and never reaches the world');
    sink.value = '日本';
    sink.setSelectionRange(2, 2);
    sink.dispatch('compositionend');
    sink.typeText('é');
    sink.setSelectionRange(0, 0);
    sink.typeText('«');
    const enter = keyEvent('Enter');
    sink.dispatch('keydown', enter);
    check(
      sent.join('|') === '«日本é',
      `Enter sends the field's text, caret edits included (sent: ${sent.join('|')})`,
    );
    check(enter.propagationStopped, 'the Enter is kept from the world');
    check(!chat.isOpen && !sink.attached, 'and the box closes, taking its field with it');
  }
}

section('Escape cancels, a held Enter does not send');
{
  const chat = new PlayerChatSystem();
  const sent: string[] = [];
  chat.open(canvas, (line) => sent.push(line));
  const sink = liveSink();
  if (sink !== null) {
    sink.typeText('hi');
    sink.dispatch('keydown', keyEvent('Enter', { repeat: true }));
    check(
      chat.isOpen && sent.length === 0,
      'an auto-repeat of the Enter that opened the box sends nothing',
    );
    sink.dispatch('keydown', keyEvent('Escape'));
  }
  check(!chat.isOpen && sent.length === 0, 'Escape closes the box without sending');
  check(liveSink() === null, 'and removes its field');
}

section('a field that lost focus: canvas keys still type, and the field keeps up');
{
  const chat = new PlayerChatSystem();
  const sent: string[] = [];
  chat.open(canvas, (line) => sent.push(line));
  const sink = liveSink();
  sink?.typeText('ab');
  sink?.blur();
  check(chat.handleKey('c', {}), 'a key the canvas routes to the box is spent on it');
  check(
    sink !== null && sink.value === 'abc',
    `the field holds what the box shows (${sink?.value ?? 'none'})`,
  );
  check(sink !== null && fakeDocument.activeElement === sink, 'and the field takes focus back');
  sink?.typeText('d');
  chat.handleKey('Enter', {});
  check(sent.join('|') === 'abcd', `the line sent is the whole of it (sent: ${sent.join('|')})`);
}

section('a world key hook never takes a key typed into the chat box');
{
  const chat = new PlayerChatSystem();
  const viewport = (): ViewportInput => ({
    cssWidth: SCREEN_W,
    cssHeight: SCREEN_H,
    density: 'pointer',
    uiSize: 'medium',
    safeArea: NO_INSETS,
  });
  let clock = 0;
  const root = new UiRoot({ audio: null, viewport, now: () => clock, warn: () => undefined });
  root.mount(chat.surface('chat'));
  const hooked: string[] = [];
  root.addKeyHook((key) => {
    hooked.push(key);
    return true;
  });
  const ctx = gameContext(SCREEN_W, SCREEN_H);
  chat.open(canvas, () => undefined);
  liveSink()?.blur();
  clock += FRAME_MS;
  root.frame(ctx);
  const outcome = root.key(' ');
  check(hooked.length === 0, `the hook is not offered the key (hook saw: ${hooked.length})`);
  check(outcome === 'consumed', `the box takes it (${outcome})`);
  chat.cancel();
  clock += FRAME_MS;
  root.frame(ctx);
  root.key(' ');
  check(hooked.length === 1, 'with the box closed the hook sees keys again');
}

if (failures > 0) {
  console.log(`\n${failures} chat input check(s) failed.`);
  process.exit(1);
}
console.log('\nAll chat input checks passed.');
