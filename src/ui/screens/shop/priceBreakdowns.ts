/**
 * Whether shop screens show the pricing engine's working under the selected
 * row. Off unless a dev entry point turns it on (`?prices`); a release build
 * has no import edge to the code that sets it, so what ships is a flag that
 * stays false.
 */

let shown = false;

export function showPriceBreakdowns(): void {
  shown = true;
}

export function priceBreakdownsShown(): boolean {
  return shown;
}
