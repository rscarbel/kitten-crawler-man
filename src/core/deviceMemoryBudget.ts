import { shouldDownscaleForLowEndDevice } from './SpriteLoader';

/**
 * `navigator.deviceMemory` reports in steps (0.25, 0.5, 1, 2, 4, 8) and caps at
 * 8, so a desktop reports 8 or reports nothing at all.
 */
const DESKTOP_MIN_GIGABYTES = 8;
const SMALL_DEVICE_MAX_GIGABYTES = 2;

const FULL_SCALE = 1;
/**
 * A half-density device's figure and sheet caches hold a quarter of the bytes
 * for the same picture, and the town at that density peaks at 51 MB of figure
 * cells and 35 MB of sheets against full budgets of 188 and 160: half of each
 * still leaves the town's whole working set resident with room over.
 */
const HALF_DENSITY_SCALE = 0.5;
/**
 * For a phone that reports 2 GB or less: a third of each budget still clears
 * the half-density town's peak (63 MB against 51, 53 against 35).
 */
const SMALL_DEVICE_BUDGET_DIVISOR = 3;
const SMALL_HALF_DENSITY_SCALE = 1 / SMALL_DEVICE_BUDGET_DIVISOR;

let gigabytesOverride: number | null = null;

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
 * the town's crowd, Carl and Donut need the whole figure budget and the town's
 * sheets need all but a few megabytes of theirs, and every smaller budget
 * measured there traded memory for stand-in frames and repaints, so a phone
 * with a dense display keeps the full budgets however little memory it reports.
 */
export function memoryBudgetScale(): number {
  const gigabytes = reportedDeviceMemoryGigabytes();
  if (gigabytes !== null && gigabytes >= DESKTOP_MIN_GIGABYTES) return FULL_SCALE;
  if (!shouldDownscaleForLowEndDevice()) return FULL_SCALE;
  if (gigabytes !== null && gigabytes <= SMALL_DEVICE_MAX_GIGABYTES) {
    return SMALL_HALF_DENSITY_SCALE;
  }
  return HALF_DENSITY_SCALE;
}
