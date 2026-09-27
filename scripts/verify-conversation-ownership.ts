#!/usr/bin/env tsx
/**
 * Checks the mechanism every quest system leans on to know "is the open
 * conversation mine": `Conversation.open()` returns a handle unique to that
 * open, and `Conversation.isActive(handle)` says whether that beat — or
 * anything it chained onto the box with `play()` — is still what's on
 * screen. Two behaviours ride on this:
 *
 *   - A request that supersedes another running one dismisses the one it
 *     replaces first, so an `allowed`-dismiss owner (a citizen or sign chat)
 *     always gets its `onDismissed` and releases whatever it was holding,
 *     even when something else opened over it without the player closing it
 *     first.
 *   - An auto-opener that waits for `conversation.isOpen` to go false before
 *     opening never wedges its own "have I opened yet" latch: it only
 *     flips once the box is actually free and the open actually happens.
 *
 * Run: npx tsx scripts/verify-conversation-ownership.ts
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { Conversation } from '../src/dialog/Conversation';
import { speakerLines } from '../src/dialog/line';
import type { ConversationHandle, ConversationRequest } from '../src/dialog/request';

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

const say = speakerLines('narrator');

function requestSaying(
  text: string,
  dismiss: ConversationRequest['dismiss'],
  onClosed: () => void,
): ConversationRequest {
  return {
    lines: [say.line(text)],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed },
    dismiss,
    haltsWorld: false,
    anchor: null,
    locksKeyboard: true,
  };
}

/**
 * Mimics the guard every auto-opener in the game uses (Circus's
 * `autoOpenResolution`, Murder's phase auto-opens): don't stomp whatever is
 * on the shared box, and only latch "I've opened" once the open actually
 * happens.
 */
class WaitingAutoOpener {
  private opened = false;
  handle: ConversationHandle | null = null;

  constructor(
    private readonly conversation: Conversation,
    private readonly buildRequest: () => ConversationRequest,
  ) {}

  tryOpen(): void {
    if (this.opened) return;
    if (this.conversation.isOpen) return;
    this.opened = true;
    this.handle = this.conversation.open(this.buildRequest());
  }

  get hasOpened(): boolean {
    return this.opened;
  }
}

function verifyAutoOpenerWaitsForFreeBox(): void {
  const conversation = new Conversation(null);
  let citizenReleased = false;
  const citizenHandle = conversation.open(
    requestSaying(
      'A passing remark.',
      { kind: 'allowed', onDismissed: () => (citizenReleased = true) },
      () => undefined,
    ),
  );

  const questOpener = new WaitingAutoOpener(conversation, () =>
    requestSaying('The quest interjects.', { kind: 'blocked' }, () => undefined),
  );

  questOpener.tryOpen();
  check(
    !questOpener.hasOpened,
    'an auto-opener does not open while a citizen chat is already showing',
  );
  check(
    conversation.isActive(citizenHandle),
    'the citizen chat is still the one on screen after the auto-opener declined',
  );
  check(!citizenReleased, "the citizen chat's own latch is untouched by the declined auto-open");

  // The player walks away from the citizen chat — the box goes free on its own.
  conversation.dismiss();
  check(citizenReleased, 'walking away from the citizen chat releases its latch');
  check(!conversation.isOpen, 'the box is free once the citizen chat is dismissed');

  questOpener.tryOpen();
  check(questOpener.hasOpened, 'the auto-opener opens once the box is free');
  check(
    questOpener.handle !== null && conversation.isActive(questOpener.handle),
    "the auto-opener's own beat is now the one on screen",
  );
  check(
    !conversation.isActive(citizenHandle),
    "the citizen chat's old handle is not mistaken for the current beat",
  );
}

function verifyOpenSupersedesAndDismissesWhatItReplaces(): void {
  const conversation = new Conversation(null);
  let citizenReleased = false;
  const citizenHandle = conversation.open(
    requestSaying(
      'A passing remark.',
      { kind: 'allowed', onDismissed: () => (citizenReleased = true) },
      () => undefined,
    ),
  );

  // A caller that opens straight over an `allowed`-dismiss request without
  // waiting for it to close first — the failure mode the critical bug came
  // from, now handled inside `open()` itself rather than by every caller.
  const questHandle = conversation.open(
    requestSaying('The quest interjects.', { kind: 'blocked' }, () => undefined),
  );

  check(
    citizenReleased,
    'opening over an allowed-dismiss request runs its onDismissed automatically',
  );
  check(conversation.isActive(questHandle), 'the superseding request is now on screen');
  check(!conversation.isActive(citizenHandle), 'the superseded request is no longer active');
}

function verifyCheckpointRestoreClosesABlockedBeat(): void {
  const conversation = new Conversation(null);
  let closedNormally = false;
  const beatHandle = conversation.open(
    requestSaying('A load-bearing beat.', { kind: 'blocked' }, () => (closedNormally = true)),
  );

  check(conversation.isOpen, 'the load-bearing beat opened');
  check(conversation.isActive(beatHandle), 'its handle is active while it is on screen');

  // What every restoreCheckpoint path now does: close the shared box outright
  // rather than leave a `blocked` request that neither Esc nor walk-away can
  // touch sitting over a world that is about to be rewound.
  conversation.close();

  check(!conversation.isOpen, 'the checkpoint restore leaves the box closed');
  check(!conversation.isActive(beatHandle), "the rewound beat's handle is no longer active");
  check(!closedNormally, "a bare close skips the beat's own onClosed side effect");

  const reopenedHandle = conversation.open(
    requestSaying('The beat, replayed after the rewind.', { kind: 'blocked' }, () => undefined),
  );
  check(
    conversation.isActive(reopenedHandle) && !conversation.isActive(beatHandle),
    'the system can re-open cleanly after the rewind, and the stale handle stays stale',
  );
}

installCanvasGlobals();

verifyAutoOpenerWaitsForFreeBox();
verifyOpenSupersedesAndDismissesWhatItReplaces();
verifyCheckpointRestoreClosesABlockedBeat();

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll conversation ownership checks passed.\n');
