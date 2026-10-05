/**
 * The keyboard's promise, checked against a live `UiRoot` after a frame: any
 * open panel, modal or system surface that halts the world or locks the
 * keyboard has taken the keys away from play, so a player without a mouse
 * must be able to act on it from the keyboard alone.
 *
 * A surface that claims the keyboard passes when either
 *
 *  - it registered at least one focusable region, and, while it owns focus,
 *    the ring `UiRoot` walks with Tab is not empty; or
 *  - it has no ring by design, which is decided by what the keyboard and the
 *    mouse can do with it, never by its name:
 *      * it registers no control a press can act on (a loading screen, a
 *        reveal still playing) — a mouse player is waiting too. A region that
 *        covers the whole screen is not a control: it is "tap anywhere" to
 *        hurry a screen that finishes on its own, and the keyboard reaches
 *        the same place by waiting;
 *      * its key handler takes Enter or Space (a page-through dialog, the
 *        Keyboard Hero board), so the keyboard answers it without a ring.
 *        The probe cannot tell a handler that acts on the surface from one
 *        that only leaves it, so a row of mouse-only controls behind a
 *        Space-to-leave handler passes here; or
 *      * it is covered by another claimant and has a key handler: its keys
 *        reach it once what covers it closes, and it is audited alone then.
 *
 * And the scope `UiRoot` gives the keyboard to is the topmost claimant, or a
 * surface above it that answers keys itself (an achievement card Space
 * dismisses): a floating surface with neither a ring nor a key handler must
 * not take focus away from the menu that holds the keys, or that menu's ring
 * goes dead under it.
 */

import type { Rect } from '../src/ui/core/geom.js';
import type { Band, HitRegion, Surface, UiRoot } from '../src/ui/core/UiRoot.js';

/** The bands whose topmost open surface owns keyboard focus. */
const FOCUS_SCOPE_BANDS: ReadonlySet<Band> = new Set(['panel', 'modal', 'system']);

/** The keys a ringless surface's own handler must take for the keyboard to answer it. */
const ACTIVATION_PROBE_KEYS = ['Enter', ' '] as const;

export interface FocusAuditOutcome {
  /** Each surface that claimed the keyboard this frame, and how it passed or failed. */
  readonly claimants: readonly FocusClaimant[];
  readonly failures: readonly string[];
}

export interface FocusClaimant {
  readonly id: string;
  readonly ringSize: number;
  /** Why a ringless claimant passes, or null when it has a ring or failed. */
  readonly ringlessReason: RinglessReason | null;
}

export type RinglessReason = 'nothing-to-press' | 'answers-activation-keys' | 'waits-its-turn';

/** Whether this open surface is one the audit holds to the promise. */
export function claimsKeyboard(surface: Surface): boolean {
  return (
    FOCUS_SCOPE_BANDS.has(surface.band) && (surface.haltsWorld || surface.locksKeyboard === true)
  );
}

/** Whether the surface can never claim the keyboard: both claims are fixed data, and false. */
export function neverClaimsKeyboard(surface: Surface): boolean {
  if (!FOCUS_SCOPE_BANDS.has(surface.band)) return true;
  const fixedFalse = (key: 'haltsWorld' | 'locksKeyboard'): boolean => {
    const own = Object.getOwnPropertyDescriptor(surface, key);
    if (own === undefined) return !(key in surface);
    return own.get === undefined && own.value !== true;
  };
  return fixedFalse('haltsWorld') && fixedFalse('locksKeyboard');
}

function coversScreen(region: HitRegion, screen: Rect): boolean {
  const { rect } = region;
  return (
    rect.x <= screen.x &&
    rect.y <= screen.y &&
    rect.x + rect.w >= screen.x + screen.w &&
    rect.y + rect.h >= screen.y + screen.h
  );
}

function isControl(region: HitRegion, screen: Rect): boolean {
  return (
    !region.disabled &&
    !coversScreen(region, screen) &&
    (region.onTap !== undefined ||
      region.onPress !== undefined ||
      region.onRelease !== undefined ||
      region.onSecondaryTap !== undefined ||
      region.onDrag !== undefined)
  );
}

/** The surfaces a root has mounted, by id. */
export function mountedSurfaces(root: UiRoot): ReadonlyMap<string, Surface> {
  return new Map(root['mounted'].map((entry) => [entry.surface.id, entry.surface]));
}

/**
 * Audits the root's last frame. Probing a ringless scope's key handler may
 * act on it (turn a page), so call this last for any one open state.
 */
export function auditFocus(root: UiRoot, label: string): FocusAuditOutcome {
  const surfaces = mountedSurfaces(root);
  const openClaimants = root
    .openSurfaceIds()
    .map((id) => surfaces.get(id))
    .filter((surface): surface is Surface => surface !== undefined && claimsKeyboard(surface));
  const failures: string[] = [];
  const claimants: FocusClaimant[] = [];
  const scopeId = root.focusSurfaceId();
  const topClaimant = openClaimants.length > 0 ? openClaimants[openClaimants.length - 1] : null;
  const scopeRingSize: number = root['focusRing']().length;
  const scopeSurface = scopeId === null ? undefined : surfaces.get(scopeId);
  const scopeAnswersKeys = scopeRingSize > 0 || scopeSurface?.onKey !== undefined;
  if (topClaimant !== null && topClaimant.id !== scopeId && !scopeAnswersKeys) {
    failures.push(
      `${label}: "${topClaimant.id}" holds the keyboard, but focus belongs to "${scopeId ?? 'nothing'}", which answers no key`,
    );
  }
  for (const surface of openClaimants) {
    const own = root.regions().filter((region) => region.surfaceId === surface.id);
    const focusable = own.filter((region) => region.focusable).length;
    const isScope = surface.id === scopeId;
    const ringSize = isScope ? scopeRingSize : focusable;
    if (ringSize > 0) {
      claimants.push({ id: surface.id, ringSize, ringlessReason: null });
      continue;
    }
    const reason = ringlessReason(surface, own, isScope, root.viewport.screen);
    claimants.push({ id: surface.id, ringSize, ringlessReason: reason });
    if (reason !== null) continue;
    const controls = own.filter((region) => isControl(region, root.viewport.screen)).length;
    const detail =
      focusable > 0
        ? `its ${focusable} focusable region(s) sit below its top layer`
        : `it registered ${controls} control(s), none focusable`;
    failures.push(
      `${label}: "${surface.id}" halts the world or locks the keyboard, but a keyboard cannot reach it — ${detail}`,
    );
  }
  return { claimants, failures };
}

function ringlessReason(
  surface: Surface,
  own: readonly HitRegion[],
  isScope: boolean,
  screen: Rect,
): RinglessReason | null {
  if (!own.some((region) => isControl(region, screen))) return 'nothing-to-press';
  if (surface.onKey === undefined) return null;
  if (!isScope) return 'waits-its-turn';
  const answers = ACTIVATION_PROBE_KEYS.some((key) => surface.onKey?.(key, {}) === true);
  return answers ? 'answers-activation-keys' : null;
}
