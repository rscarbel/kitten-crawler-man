/**
 * The declarative answer to "a menu is up".
 *
 * A scene lists every overlay that can own the screen, in the order a press
 * should reach them. The keyboard gate, the Space chain and the mobile tap path
 * all read that one list, so none of them can drift apart — drift is what let a
 * press aimed at a building menu also reach the citizen standing on the
 * doorstep, stacking two dialogs that then fought over the same clicks.
 *
 * The alternative each scene grew on its own was a hand-maintained chain of
 * booleans per consumer, which is three lists that have to agree and no way to
 * notice when they stop.
 */

/**
 * What Space does while a given overlay owns the screen.
 *
 * `passThrough` exists for the chat box alone: its DOM input needs the space
 * character itself, so that press must not be preventDefault-ed.
 */
export type OverlaySpaceHandling =
  | { readonly kind: 'advance'; readonly advance: () => void }
  | { readonly kind: 'swallow' }
  | { readonly kind: 'passThrough' };

/** One overlay's claim on the keyboard while it is on screen. */
export interface OverlayInputClaim {
  readonly isOpen: boolean;
  readonly space: OverlaySpaceHandling;
  /**
   * The id this overlay passes to `beginMenuFocus` (or `suppressMenuFocus`) while
   * it is drawn — the promise that a keyboard alone can reach its buttons.
   *
   * Required, and required *here*, because this list is where a new overlay is
   * registered: an author who has to name the ring cannot ship a menu that only
   * a mouse can answer, which is exactly how the exit-building menu spent its
   * life. `null` is the deliberate escape hatch for a surface with nothing to
   * focus — an advance-anywhere dialog, a reveal, an award — and for the chat
   * box, whose DOM input owns the keys outright.
   *
   * Ids are namespaced with `-`, and a menu may declare any id under the one it
   * promises here: the pause menu promises `pause` and declares `pause-journal`
   * or `pause-reset-confirm` as the player moves between tabs and confirms. That
   * is what lets a menu re-key its ring — which is how focus is reset when the
   * content underneath it changes — without breaking the promise.
   *
   * {@link auditOverlayFocus} checks the promise against what the frame actually
   * declared, so a menu that forgets the call, or one that draws in an order
   * that hands the ring to somebody else, says so instead of going quiet. Only
   * keyboard-locking overlays are held to it; a surface that floats over live
   * play declares nothing by design and passes `null`.
   */
  readonly focusContext: string | null;
  /**
   * Whether the rest of the keyboard — hotbar, inventory, chat, Tab — is locked
   * out too. Overlays that merely float over live play leave it unlocked.
   */
  readonly locksKeyboard: boolean;
  /**
   * Whether the world stops while this is up.
   *
   * Almost always true, and false for exactly the overlays the player has to be
   * able to walk during — street and shop-floor conversations, which end
   * *because* the player walked off. A tap or a click that reaches a
   * world-halting overlay belongs to that overlay and must not also move
   * anybody.
   */
  readonly haltsWorld: boolean;
}

/** The overlay that currently owns input, or null when play has the floor. */
export function focusedOverlay(claims: ReadonlyArray<OverlayInputClaim>): OverlayInputClaim | null {
  return claims.find((claim) => claim.isOpen) ?? null;
}

/** Whether an overlay owns the frame, so movement and interaction must not run. */
export function worldHalted(claims: ReadonlyArray<OverlayInputClaim>): boolean {
  return claims.some((claim) => claim.isOpen && claim.haltsWorld);
}

/** Whether the ordinary keyboard should be ignored this frame. */
export function keyboardSuppressed(claims: ReadonlyArray<OverlayInputClaim>): boolean {
  return claims.some((claim) => claim.isOpen && claim.locksKeyboard);
}

/** Mismatches already reported, so a per-frame audit does not flood the console. */
const _reportedFocusMismatches = new Set<string>();

/**
 * Check that the overlay owning the screen is the one the focus ring belongs to.
 *
 * Call at the very end of a scene's `render`, once every surface has drawn.
 * Draw order, this claim list and the click router are three separate lists that
 * have to agree, and when they disagree the symptom is silent: the topmost menu
 * is visible, the mouse drives it, and the keyboard drives something underneath
 * it — or nothing at all.
 *
 * Reports rather than throws. A mismatch is a menu that is awkward, not a game
 * that cannot run, and a `render` that throws takes the frame with it.
 *
 * @param declaredContextId - what the frame actually declared, from
 *   `menuFocusContextId()` in `ui/Button`. Passed in rather than imported so
 *   this module stays free of UI dependencies.
 * @returns the mismatch description, or null when the two agree.
 */
export function auditOverlayFocus(
  claims: ReadonlyArray<OverlayInputClaim>,
  declaredContextId: string | null,
): string | null {
  // Only the overlays that lock the keyboard, not simply the first one open. A
  // surface that floats over live play leaves the keys to gameplay and declares
  // no ring by design, so ranking one above a real menu — the tutorial's callout
  // sits near the top of the dungeon's list — must not read as a mismatch.
  const overlay = claims.find((claim) => claim.isOpen && claim.locksKeyboard) ?? null;
  const expected = overlay === null ? null : overlay.focusContext;
  if (expected === null) return null;
  if (declaredContextId === expected) return null;
  if (declaredContextId?.startsWith(`${expected}-`) === true) return null;
  const mismatch = `menu focus mismatch: the open overlay promises "${expected}", the frame declared "${declaredContextId}"`;
  if (_reportedFocusMismatches.has(mismatch)) return mismatch;
  _reportedFocusMismatches.add(mismatch);
  console.error(`[OverlayClaims] ${mismatch}`);
  return mismatch;
}

/** What {@link advanceFocusedOverlay} did with the press. */
export type OverlayAdvance = 'advanced' | 'swallowed' | 'ignored';

/**
 * Hands Space to whatever owns the screen, reporting what became of it.
 *
 * Consuming is also what keeps the press off the world: whatever owns the
 * screen eats Space even when it has nothing to do with it, so a click-only
 * menu can never leak the press to an NPC standing behind it.
 *
 * `ignored` is distinguished from the other two because a scene that also
 * *polls* the key has to know whether the press was spent: the page turn that
 * closes the last page of a dialog leaves the claim shut, so by the time that
 * scene's own interaction chain runs there is no overlay left to hold the press
 * back, and it has to be marked spent at the moment it is taken. `advanced` and
 * `swallowed` are both spent; they are reported apart only so a scene can tell
 * whether anything actually happened.
 */
export function advanceFocusedOverlay(claims: ReadonlyArray<OverlayInputClaim>): OverlayAdvance {
  const overlay = focusedOverlay(claims);
  if (overlay === null || overlay.space.kind === 'passThrough') return 'ignored';
  if (overlay.space.kind === 'swallow') return 'swallowed';
  overlay.space.advance();
  return 'advanced';
}
