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
