/**
 * The touch player's way out, checked against a live `UiRoot` after a frame.
 * A phone has no Escape key, so every close button an open menu draws must be
 * one the player can actually tap:
 *
 *  - it lies wholly inside the safe-area viewport;
 *  - a ✕ is square, as every ✕ is drawn, so one an edge has cut to a sliver
 *    fails;
 *  - nothing on its own layer of its own surface, and no surface outside the
 *    menu bands (a toast, the HUD), covers its centre. A context menu opened
 *    over it, or a confirm stacked above its menu, may cover it: those are
 *    answered first and audited themselves; and
 *  - a surface that drew one on a roomy screen draws one here too, since a
 *    button pushed wholly off a phone registers nothing at all.
 *
 * Close buttons are found by widget id: the last segment is `close` (a ✕) or
 * `leave` (a labelled Leave or Close button).
 */

import { contains, type Rect } from '../src/ui/core/geom.js';
import type { Band, HitRegion, UiRoot } from '../src/ui/core/UiRoot.js';
import { mountedSurfaces } from './menuFocusAudit.js';

const MENU_BANDS: ReadonlySet<Band> = new Set(['panel', 'modal', 'system']);
const CROSS_WIDGET_ID = 'close';
const LEAVE_WIDGET_ID = 'leave';
/** Float rounding in layout may leave an edge a hair past the viewport, in UI units. */
const EDGE_TOLERANCE = 0.5;

function lastSegment(region: HitRegion): string {
  return region.id.split('/').pop() ?? '';
}

function isCloseRegion(region: HitRegion): boolean {
  const segment = lastSegment(region);
  const named = segment === CROSS_WIDGET_ID || segment === LEAVE_WIDGET_ID;
  return named && !region.hoverOnly && !region.disabled;
}

function insideViewport(rect: Rect, view: Rect): boolean {
  return (
    rect.x >= view.x - EDGE_TOLERANCE &&
    rect.y >= view.y - EDGE_TOLERANCE &&
    rect.x + rect.w <= view.x + view.w + EDGE_TOLERANCE &&
    rect.y + rect.h <= view.y + view.h + EDGE_TOLERANCE
  );
}

function topmostAt(regions: readonly HitRegion[], x: number, y: number): HitRegion | null {
  for (let index = regions.length - 1; index >= 0; index--) {
    const region = regions[index];
    if (region.hoverOnly) continue;
    if (contains(region.rect, x, y)) return region;
  }
  return null;
}

/** Whether `cover` sits over `closer` as something the player deals with before the menu beneath. */
function answeredFirst(
  cover: HitRegion,
  closer: HitRegion,
  surfaces: ReturnType<typeof mountedSurfaces>,
): boolean {
  if (cover.surfaceId === closer.surfaceId) return cover.layer > closer.layer;
  const coverSurface = surfaces.get(cover.surfaceId);
  return coverSurface !== undefined && MENU_BANDS.has(coverSurface.band);
}

function describeRect(rect: Rect): string {
  return `(${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.w)}×${Math.round(rect.h)})`;
}

/** The surfaces that drew a close button in the root's last frame. */
export function surfacesWithCloseButtons(root: UiRoot): ReadonlySet<string> {
  return new Set(
    root
      .regions()
      .filter(isCloseRegion)
      .map((region) => region.surfaceId),
  );
}

/** The panel, modal and system surfaces open in the root's last frame. */
export function openMenuSurfaceIds(root: UiRoot): string[] {
  const surfaces = mountedSurfaces(root);
  return root.openSurfaceIds().filter((id) => {
    const surface = surfaces.get(id);
    return surface !== undefined && MENU_BANDS.has(surface.band);
  });
}

/**
 * One message per surface that `expected` says must show a close button, that
 * is open here, and that drew none.
 */
export function missingCloseButtons(
  label: string,
  expected: ReadonlySet<string>,
  open: readonly string[],
  withClose: ReadonlySet<string>,
): string[] {
  return open
    .filter((id) => expected.has(id) && !withClose.has(id))
    .map((id) => `${label}: "${id}" draws no close button here, though a larger screen shows one`);
}

/**
 * Audits the root's last frame; returns one message per failure. `expected`
 * names the surfaces that must show a close button if they are open, usually
 * {@link surfacesWithCloseButtons} of the same state on a desktop screen.
 */
export function auditCloseButtons(
  root: UiRoot,
  label: string,
  expected: ReadonlySet<string> = new Set(),
): string[] {
  const surfaces = mountedSurfaces(root);
  const view = root.viewport.safe;
  const regions = root.regions();
  const open = openMenuSurfaceIds(root);
  const failures = missingCloseButtons(label, expected, open, surfacesWithCloseButtons(root));
  for (const id of open) {
    const closers = regions.filter((region) => region.surfaceId === id && isCloseRegion(region));
    for (const closer of closers) {
      if (!insideViewport(closer.rect, view)) {
        failures.push(
          `${label}: "${closer.id}" at ${describeRect(closer.rect)} leaves the viewport ${describeRect(view)}`,
        );
        continue;
      }
      const isCross = lastSegment(closer) === CROSS_WIDGET_ID;
      if (isCross && Math.abs(closer.rect.w - closer.rect.h) > EDGE_TOLERANCE) {
        failures.push(`${label}: "${closer.id}" is cut to ${describeRect(closer.rect)} by an edge`);
        continue;
      }
      const centreX = closer.rect.x + closer.rect.w / 2;
      const centreY = closer.rect.y + closer.rect.h / 2;
      const top = topmostAt(regions, centreX, centreY);
      if (top !== null && top !== closer && !answeredFirst(top, closer, surfaces)) {
        failures.push(`${label}: "${closer.id}" is covered by "${top.id}"`);
      }
    }
  }
  return failures;
}
