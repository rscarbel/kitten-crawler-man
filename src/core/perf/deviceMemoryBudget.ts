import { shouldDownscaleForLowEndDevice } from '../spriteAssets/SpriteLoader';

/**
 * `navigator.deviceMemory` reports in steps (0.25, 0.5, 1, 2, 4, 8) and caps at
 * 8, so a desktop reports 8 or reports nothing at all.
 */
const DESKTOP_MIN_GIGABYTES = 8;
const SMALL_DEVICE_MAX_GIGABYTES = 2;

export const FULL_SCALE = 1;
/**
 * A half-density device's figure and sheet caches hold a quarter of the bytes
 * for the same picture. The town at that density peaks at 35 MB of sheets
 * against a full budget of 160, and level 3's arrival, the figure cache's
 * tightest moment at 53.1 MB of ink crops at full density, needs about 13 MB
 * of figure cells against a full 80: half of each still leaves the town's
 * whole working set resident with room over.
 */
export const HALF_DENSITY_SCALE = 0.5;
/**
 * For a phone that reports 2 GB or less: a third of each budget still clears
 * the half-density town's peak (27 MB of figure cells against about 13, 53 of
 * sheets against 35).
 */
const SMALL_DEVICE_BUDGET_DIVISOR = 3;
const SMALL_HALF_DENSITY_SCALE = 1 / SMALL_DEVICE_BUDGET_DIVISOR;

/**
 * What every cache budget is multiplied by once canvases have been lost at the
 * least variety the game can show. Fewer looks cannot shrink the working set any
 * further by then, so smaller caches are the only demand left to give up.
 */
const SESSION_BUDGET_CUT = 0.5;

let gigabytesOverride: number | null = null;
let budgetsCutForSession = false;

/**
 * Stands in for `navigator.deviceMemory`, or restores the browser's own report
 * given null, so a phone's budgets can be measured on a desktop.
 */
export function setDeviceMemoryOverride(gigabytes: number | null): void {
  gigabytesOverride = gigabytes;
}

function reportedDeviceMemoryGigabytes(): number | null {
  if (gigabytesOverride !== null) return gigabytesOverride;
  if (typeof navigator === 'undefined' || !('deviceMemory' in navigator)) return null;
  const reported = navigator.deviceMemory;
  return typeof reported === 'number' && reported > 0 ? reported : null;
}

/**
 * The share of its full byte budget a density-scaled cache holds on this
 * device. Read live, because the low-end flag follows the display's pixel
 * ratio, which zoom or a move to another monitor changes.
 *
 * Only a device that already bakes at half density gets less. At full density
 * the town's crowd and the two crawlers need the whole figure budget and the town's
 * sheets need all but a few megabytes of theirs, and every smaller budget
 * measured there traded memory for stand-in frames and repaints, so a phone
 * with a dense display keeps the full budgets however little memory it reports.
 *
 * The device's own share, before any cut for the session: what says how much
 * this device can carry. Caches read {@link memoryBudgetScale}.
 */
export function deviceMemoryBudgetScale(): number {
  const gigabytes = reportedDeviceMemoryGigabytes();
  if (gigabytes !== null && gigabytes >= DESKTOP_MIN_GIGABYTES) return FULL_SCALE;
  if (!shouldDownscaleForLowEndDevice()) return FULL_SCALE;
  if (gigabytes !== null && gigabytes <= SMALL_DEVICE_MAX_GIGABYTES) {
    return SMALL_HALF_DENSITY_SCALE;
  }
  return HALF_DENSITY_SCALE;
}

/**
 * The share of its full byte budget a density-scaled cache holds now: this
 * device's own share, cut once for the rest of the session by
 * {@link cutMemoryBudgetsForSession}. What the caches read.
 */
export function memoryBudgetScale(): number {
  const deviceScale = deviceMemoryBudgetScale();
  return budgetsCutForSession ? deviceScale * SESSION_BUDGET_CUT : deviceScale;
}

/**
 * Lowers every cache budget for the rest of the session. Idempotent: the cut
 * applies once however often it is asked for. The only path that lowers a
 * budget below the device's own share.
 */
export function cutMemoryBudgetsForSession(): void {
  budgetsCutForSession = true;
}
