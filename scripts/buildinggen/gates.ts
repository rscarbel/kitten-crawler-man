/**
 * The floor every baked building has to clear.
 *
 * Numbers gate the floor; eyes gate the ceiling. Nothing here can tell whether a
 * facade is charming — that is what the contact sheets are for — but everything
 * here catches a class of failure that is invisible in a thumbnail and expensive
 * later: a frame size that bleeds one row's stripe into the next, a door the
 * player cannot walk through, a wall that has quietly become a flat fill.
 *
 * ## Two rules these gates are written under
 *
 * **A gate that cannot find what it measures is a failure, not a skip.** A check
 * that looks up a row or a key by string and returns early on a miss reports
 * green while measuring nothing. Every lookup here throws or records a failure.
 *
 * **A gate that has never failed is not yet a gate.** Each of these was landed
 * by breaking the property by hand — moving the door a tile, flattening a wall
 * to its ramp's mid colour, desyncing the loop — and watching it go red first.
 */

import type { Canvas } from 'canvas';
import { OVERLAY_FRAME_KEY_STRIDE } from '../../src/map/tiles/overlayAnimation.js';
import { readCanvas, isOpaque, pixelIndex, pixelLuminance, type PixelBuffer } from './pixels.js';
import { meanLuminanceInQuad } from './lighting.js';
import type { Projection } from './projection.js';
import { getRamp, sampleRamp } from './ramps.js';
import { BUILDING_TILE_SCALE, type BuildingSpec } from './spec.js';

export interface GateFailure {
  readonly key: string;
  readonly gate: string;
  readonly detail: string;
}

export interface GateReport {
  readonly key: string;
  readonly gate: string;
  readonly detail: string;
}

export class GateResults {
  readonly failures: GateFailure[] = [];
  readonly reports: GateReport[] = [];

  fail(key: string, gate: string, detail: string): void {
    this.failures.push({ key, gate, detail });
  }

  report(key: string, gate: string, detail: string): void {
    this.reports.push({ key, gate, detail });
  }
}

/** Blocked-region rectangle in source pixels, as the manifest declares it. */
export interface BlockedRegion {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

// ── 1. frame geometry ──────────────────────────────────────────────────────

/**
 * Frame size and derived footprint.
 *
 * First in the order on purpose: a sheet whose cells do not match the manifest's
 * frame size paints a stripe of the neighbouring cell into every frame, and no
 * other gate here would see it — every one of them would be measuring the wrong
 * rectangle and reporting confidently about it.
 */
export function gateFrameGeometry(
  results: GateResults,
  spec: BuildingSpec,
  sheet: Canvas,
  declared: DeclaredFrameGeometry,
  frozenWidth: number,
  frozenHeight: number,
): void {
  const GATE = 'frame-geometry';
  const columns = Math.max(1, declared.lifeFrameCount);
  const LIFE_ROW_COUNT = 2;

  // A cross-function consistency check, and no more than that: the entry and the
  // canvas are built by two different functions, but both from the same spec and
  // the same `tiles * BUILDING_TILE_SCALE` expression in the same process, so
  // this fires only if one of those two functions is edited without the other.
  // The real question — does the manifest *on disk* describe the PNG *on disk* —
  // cannot be answered before either exists, and is `gateWrittenSheetGeometry`.
  if (sheet.width !== columns * declared.frameWidth) {
    results.fail(
      spec.key,
      GATE,
      `the sheet is ${sheet.width}px wide but the manifest declares ${columns} columns of ` +
        `${declared.frameWidth}px, which is ${columns * declared.frameWidth}px`,
    );
  }
  if (sheet.height !== LIFE_ROW_COUNT * declared.frameHeight) {
    results.fail(
      spec.key,
      GATE,
      `the sheet is ${sheet.height}px tall but the manifest declares two rows of ` +
        `${declared.frameHeight}px, which is ${LIFE_ROW_COUNT * declared.frameHeight}px`,
    );
  }
  if (declared.tileScale !== BUILDING_TILE_SCALE) {
    results.fail(
      spec.key,
      GATE,
      `the manifest declares tileScale ${declared.tileScale}; the sheet was baked at ` +
        `${BUILDING_TILE_SCALE}, and the footprint every plot is spaced against derives from it`,
    );
  }
  if (spec.tilesWide !== frozenWidth || spec.tilesHigh !== frozenHeight) {
    results.fail(
      spec.key,
      GATE,
      `footprint is ${spec.tilesWide}x${spec.tilesHigh} tiles; the art it replaces derived ` +
        `${frozenWidth}x${frozenHeight}, and the town plan spaces its plots against that`,
    );
  }
  results.report(
    spec.key,
    GATE,
    `${declared.frameWidth}x${declared.frameHeight}px, ${spec.tilesWide}x${spec.tilesHigh} tiles`,
  );
}

/**
 * Frame-size drift, measured on the files rather than on the objects.
 *
 * Runs after the write, reading the manifest back as text and decoding the PNG,
 * so it covers what serialising and encoding do to the pair — which the checks
 * before the write cannot, since they hold both sides in memory.
 *
 * What it does **not** cover, and the reason `gateFrameGeometry` still exists:
 * both numbers still originate in this process, from `manifestEntryFor` and
 * `bake`. Drift introduced by hand-editing `manifest.json` between runs survives
 * until the next full bake rewrites that entry, and is invisible to every gate
 * here in the meantime. Catching that would mean gating the manifest against the
 * PNGs independently of a bake.
 */
export function gateWrittenSheetGeometry(
  results: GateResults,
  spec: BuildingSpec,
  written: {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly lifeFrameCount: number;
  },
  sheetWidth: number,
  sheetHeight: number,
): void {
  const GATE = 'written-geometry';
  const LIFE_ROW_COUNT = 2;
  const expectedWidth = written.frameWidth * Math.max(1, written.lifeFrameCount);
  const expectedHeight = written.frameHeight * LIFE_ROW_COUNT;
  if (sheetWidth !== expectedWidth || sheetHeight !== expectedHeight) {
    results.fail(
      spec.key,
      GATE,
      `the written PNG is ${sheetWidth}x${sheetHeight}, but the written manifest describes ` +
        `${written.lifeFrameCount} columns of ${written.frameWidth}px over two rows of ` +
        `${written.frameHeight}px, which is ${expectedWidth}x${expectedHeight}`,
    );
    return;
  }
  results.report(
    spec.key,
    GATE,
    `the written sheet matches the written manifest at ${written.frameWidth}x${written.frameHeight}`,
  );
}

/** What the manifest entry says about the sheet, for the gate to check the pixels against. */
export interface DeclaredFrameGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileScale: number;
  readonly lifeFrameCount: number;
}

// ── 2. the doorway ─────────────────────────────────────────────────────────

/**
 * The doorway, resolved through the game's own derivation rather than a copy of
 * it.
 *
 * `SpriteLoader` recovers a door from two independent readings of the same
 * regions — a pixel gap between the base-course rectangles, clamped into a
 * tile-space run at a half-coverage threshold — and throws at module load when
 * they disagree. A reimplementation here would freeze the reimplementation's
 * bugs; this asks for the real answer and checks it lands where the spec says.
 */
export function gateDoorway(
  results: GateResults,
  spec: BuildingSpec,
  doorway:
    | { readonly dx: number; readonly dy: number; readonly dx0: number; readonly width: number }
    | undefined,
): void {
  const GATE = 'doorway';
  if (doorway === undefined) {
    results.fail(
      spec.key,
      GATE,
      'no doorway derives from the emitted blocked regions; placeSpriteBuilding throws on this',
    );
    return;
  }
  if (doorway.dx0 !== spec.door.col || doorway.width !== spec.door.gapTiles) {
    results.fail(
      spec.key,
      GATE,
      `walkable opening is [${doorway.dx0}, ${doorway.dx0 + doorway.width}); the spec asks for ` +
        `[${spec.door.col}, ${spec.door.col + spec.door.gapTiles})`,
    );
  }
  if (doorway.dy !== spec.tilesHigh - 1) {
    results.fail(
      spec.key,
      GATE,
      `doorway sits on row ${doorway.dy}; the facade's front row is ${spec.tilesHigh - 1}`,
    );
  }
  if (doorway.dx < doorway.dx0 || doorway.dx >= doorway.dx0 + doorway.width) {
    results.fail(
      spec.key,
      GATE,
      `door tile ${doorway.dx} is outside its own opening [${doorway.dx0}, ${doorway.dx0 + doorway.width})`,
    );
  }
  results.report(
    spec.key,
    GATE,
    `door tile ${doorway.dx}, opening [${doorway.dx0}, ${doorway.dx0 + doorway.width}) on row ${doorway.dy}`,
  );
}

/**
 * The blocked regions describe the ink.
 *
 * A building's whole footprint is blocked at runtime regardless of what these
 * rectangles say, so the risk is the other direction: the base course must
 * actually be painted where it claims to block, or the facade has a hole in it
 * that the player can see but not walk through.
 */
const BASE_COURSE_COVERAGE_FLOOR = 0.95;

/**
 * How much of the frame's width the building's own ink must span.
 *
 * The town plan reserves a plot as wide as the derived footprint whether the art
 * fills it or not, so a facade that quietly shrank inside its frame would leave
 * a strip of blocked, empty ground beside every building and nothing else would
 * notice. The floor is under 100% because the projection deliberately spends the
 * roof's overhang at the frame's left edge, where the wall does not reach.
 */
const FRAME_WIDTH_USE_FLOOR = 0.9;

export function gateSilhouette(
  results: GateResults,
  spec: BuildingSpec,
  idle: PixelBuffer,
  projection: Projection,
): void {
  const GATE = 'silhouette';
  const scale = BUILDING_TILE_SCALE;
  const baseRowTop = (spec.tilesHigh - 1) * scale;
  const gapStart = spec.door.col * scale;
  const gapEnd = (spec.door.col + spec.door.gapTiles) * scale;

  // Measured over the front wall only, between the ground line and the base
  // row's top. Neither of the two things this deliberately excludes is a hole:
  // the ground-contact inset is what seats the building in the dirt, and the
  // wedge under the side return is the ground behind a wall that recedes. A gate
  // spanning the whole frame counts both as missing facade and can only be
  // satisfied by removing the projection.
  const left = Math.max(0, Math.round(projection.facadeLeft));
  const right = Math.min(idle.width - 1, Math.round(projection.facadeRight) - 1);
  const base = Math.min(idle.height - 1, Math.round(projection.facadeBaseY) - 1);
  if (right < left || base < baseRowTop) {
    results.fail(spec.key, GATE, 'the front wall does not reach its own base row');
    return;
  }

  let covered = 0;
  let total = 0;
  for (let y = baseRowTop; y <= base; y++) {
    for (let x = left; x <= right; x++) {
      if (x >= gapStart && x < gapEnd) continue;
      total++;
      if (isOpaque(idle, pixelIndex(idle, x, y))) covered++;
    }
  }
  const coverage = total === 0 ? 0 : covered / total;
  if (!(coverage >= BASE_COURSE_COVERAGE_FLOOR)) {
    results.fail(
      spec.key,
      GATE,
      `base course is ${(coverage * 100).toFixed(1)}% opaque outside the door gap; ` +
        `${(BASE_COURSE_COVERAGE_FLOOR * 100).toFixed(0)}% is the floor, and the shortfall is a ` +
        'hole a player can see through into a tile they cannot enter',
    );
  }

  let inkLeft = idle.width;
  let inkRight = -1;
  for (let y = baseRowTop; y < idle.height; y++) {
    for (let x = 0; x < idle.width; x++) {
      if (!isOpaque(idle, pixelIndex(idle, x, y))) continue;
      if (x < inkLeft) inkLeft = x;
      if (x > inkRight) inkRight = x;
    }
  }
  const spanFraction = inkRight < inkLeft ? 0 : (inkRight - inkLeft + 1) / idle.width;
  if (!(spanFraction >= FRAME_WIDTH_USE_FLOOR)) {
    results.fail(
      spec.key,
      GATE,
      `the facade spans ${(spanFraction * 100).toFixed(1)}% of its frame's width; below ` +
        `${(FRAME_WIDTH_USE_FLOOR * 100).toFixed(0)}% the plot the town reserved is wider than the ` +
        'building standing on it',
    );
  }
  results.report(
    spec.key,
    GATE,
    `base course ${(coverage * 100).toFixed(1)}% opaque, spanning ${(spanFraction * 100).toFixed(1)}% of the frame`,
  );
}

// ── 3. texture richness ────────────────────────────────────────────────────

/**
 * Mean local contrast over the opaque region: the flat-fill detector.
 *
 * Measured in 8x8 windows because that is roughly the scale at which a viewer
 * reads "surface" rather than "shape". A circus-tent-tier hex fill scores near
 * zero here whatever its silhouette looks like.
 */
export const TEXTURE_WINDOW_PX = 8;

export function measureTextureRichness(buffer: PixelBuffer): number {
  let total = 0;
  let windows = 0;
  for (
    let windowY = 0;
    windowY + TEXTURE_WINDOW_PX <= buffer.height;
    windowY += TEXTURE_WINDOW_PX
  ) {
    for (
      let windowX = 0;
      windowX + TEXTURE_WINDOW_PX <= buffer.width;
      windowX += TEXTURE_WINDOW_PX
    ) {
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      let allOpaque = true;
      for (let y = windowY; y < windowY + TEXTURE_WINDOW_PX && allOpaque; y++) {
        for (let x = windowX; x < windowX + TEXTURE_WINDOW_PX; x++) {
          const index = pixelIndex(buffer, x, y);
          if (!isOpaque(buffer, index)) {
            allOpaque = false;
            break;
          }
          const value = pixelLuminance(buffer, index);
          sum += value;
          sumSquares += value * value;
          count++;
        }
      }
      if (!allOpaque || count === 0) continue;
      const mean = sum / count;
      total += Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
      windows++;
    }
  }
  return windows === 0 ? 0 : total / windows;
}

/**
 * The floor is a fraction of the *replaced* art's own number rather than one
 * global figure, because a fieldstone cottage and a dressed-stone club do not
 * carry comparable amounts of detail: one global threshold would either pass the
 * cottage trivially or fail the club unfairly.
 *
 * ## Why the fraction is 0.5 and not the 0.7 first written down
 *
 * The 0.7 was chosen before any procedurally built facade had been measured. Two
 * things came out of measuring one.
 *
 * The first is that this metric is not a marginal flat-fill detector at any
 * threshold in this range — it is an overwhelming one. `npm run verify:buildings`
 * measures both ends every run: a facade whose every plane is a single sample of
 * its own ramp scores about 0.6, the finished buildings score 15 to 23, and it
 * fails if the tightest floor ever stops being a comfortable multiple of the
 * flat score. So what this fraction actually governs is a softer question than
 * "is there texture": how close the redraw has to come to the *decoration
 * density* of the art it replaces.
 *
 * The second is that the reference art's own numbers are partly incidental to
 * that question. They are continuous-tone renders carrying brush noise inside
 * every flat area, and they are busier — the barracks alone had banners, gilt
 * columns and carved panels across its frontage. Chasing the last of their
 * figure with surface noise was tried and it visibly destroyed the masonry: the
 * courses dissolved into a cellular net. Detail that *reads* — string courses,
 * piers, props, openings — is worth adding and has been; noise past that is
 * worth less than the material it obscures.
 *
 * ## The building that set the number
 *
 * The Temple of the Sky. Its predecessor is the richest asset in the set at
 * 34.72 — more small decoration than anything else in town — and the temple was
 * the last building still failing. Pushed to meet a higher bar its elevation
 * filled with repeated plaques and scattered windows and stopped reading as a
 * temple at all; pulled back to a clean dome-on-drum over a plain ashlar front
 * it measures about 18.6, against a floor of 17.36. That is the honest ceiling
 * for this building.
 *
 * Old Hilda's Cottage is now the tightest, at 14.98 against 11.42 — the margins
 * moved when the palette was re-exposed, and any figure quoted here is only as
 * good as the bake it was taken from. `npm run gen:buildings` prints all fifteen
 * every run; trust that over this paragraph.
 */
export const TEXTURE_RICHNESS_FLOOR_FRACTION = 0.5;

export function gateTextureRichness(
  results: GateResults,
  spec: BuildingSpec,
  idle: PixelBuffer,
  replacedRichness: number,
): void {
  const GATE = 'texture-richness';
  const measured = measureTextureRichness(idle);
  const floor = replacedRichness * TEXTURE_RICHNESS_FLOOR_FRACTION;
  if (!(measured >= floor)) {
    results.fail(
      spec.key,
      GATE,
      `local contrast ${measured.toFixed(2)} is below ${floor.toFixed(2)}, which is ` +
        `${(TEXTURE_RICHNESS_FLOOR_FRACTION * 100).toFixed(0)}% of the ${replacedRichness.toFixed(2)} ` +
        `measured on '${spec.replaces}'`,
    );
  }
  results.report(
    spec.key,
    GATE,
    `local contrast ${measured.toFixed(2)} against a floor of ${floor.toFixed(2)}`,
  );
}

// ── 4. plane separation ────────────────────────────────────────────────────

/**
 * The three planes read as three surfaces of one solid, lit from one direction.
 *
 * Both comparisons are **directional**: the roof faces the sky and must be the
 * brightest, the side return faces away from the sun and must be the darkest.
 * That is what catches a building which has lost its light — a facade brighter
 * than its own roof, or a return that stopped being a return.
 *
 * An earlier revision dropped the roof comparison to a symmetric
 * "must differ by 6% either way", on the grounds that the Temple of the Sky is
 * pale ashlar under a deep blue dome and its facade was genuinely the brighter
 * of the two. That was measured before the dome was rebuilt and before the dark
 * ramps were re-exposed, and it is no longer true of any building in the town.
 * A symmetric test would pass a building whose lighting had been inverted, which
 * is precisely the defect worth failing, so the direction is back.
 *
 * If a future building genuinely cannot satisfy it — a dark roof over a white
 * wall is a real thing to want — the honest move is to give that building a
 * declared exemption carrying its measured numbers, not to weaken the rule for
 * the other fourteen.
 *
 * ## What actually binds this number
 *
 * Not the temple, whose roof clears its facade by 30%. Old Hilda's Cottage does,
 * at 1.10, with the Shepherd's Cabin and the Miller's Farm just behind — all
 * three are pale walls under mid-value roofs, which is the pairing this gate is
 * hardest on. So 1.06 sits close to what the current art allows rather than at
 * some perceptual threshold, and a lighting change to any of those three turns
 * the bake red. That is the right way round — it fails a real regression instead
 * of waving one through — but it means anyone lowering the number would be
 * lowering it past three buildings, not one.
 */
export const PLANE_SEPARATION_MIN_RATIO = 1.06;

export function gatePlaneSeparation(
  results: GateResults,
  spec: BuildingSpec,
  idle: PixelBuffer,
  projection: Projection,
): void {
  const GATE = 'plane-separation';
  const roof = meanLuminanceInQuad(idle, projection.roofQuad);
  const facade = meanLuminanceInQuad(idle, projection.facadeQuad);
  const side = meanLuminanceInQuad(idle, projection.sideQuad);
  if (roof <= 0 || facade <= 0 || side <= 0) {
    results.fail(spec.key, GATE, 'a plane measured zero luminance, so it painted nothing');
    return;
  }

  if (!(facade >= side * PLANE_SEPARATION_MIN_RATIO)) {
    results.fail(
      spec.key,
      GATE,
      `the facade at ${facade.toFixed(1)} is not ${PLANE_SEPARATION_MIN_RATIO}x the side return's ` +
        `${side.toFixed(1)}; they carry the same material, so the building has lost its corner`,
    );
  }
  if (!(roof >= facade * PLANE_SEPARATION_MIN_RATIO)) {
    results.fail(
      spec.key,
      GATE,
      `the roof at ${roof.toFixed(1)} is not ${PLANE_SEPARATION_MIN_RATIO}x the facade's ` +
        `${facade.toFixed(1)}; the roof has stopped reading as the plane that faces the sky`,
    );
  }
  results.report(
    spec.key,
    GATE,
    `luminance roof ${roof.toFixed(1)} / facade ${facade.toFixed(1)} / side ${side.toFixed(1)}`,
  );
}

// ── 5. palette discipline ──────────────────────────────────────────────────

/**
 * Every opaque pixel is close to some colour the spec declared.
 *
 * Catches accidental neon out of alpha compositing — the failure where a glow at
 * an unclamped alpha over a saturated wall produces a hue that exists nowhere in
 * the building's own vocabulary and that no other gate can see.
 */
export const PALETTE_TOLERANCE = 78;
/**
 * Tightened once the art was measured: all fifteen buildings come in at 0.000%
 * stray, so the previous allowance was permitting roughly a thousand pixels of
 * arbitrary colour on an inn-sized frame while catching nothing.
 */
export const PALETTE_STRAY_FRACTION_LIMIT = 0.001;
const PALETTE_RAMP_SAMPLES = 9;

export function gatePalette(
  results: GateResults,
  spec: BuildingSpec,
  idle: PixelBuffer,
  declaredRampIds: ReadonlySet<string>,
): void {
  const GATE = 'palette';
  const allowed: Array<readonly [number, number, number]> = [];
  for (const id of declaredRampIds) {
    const ramp = getRamp(id);
    for (let sample = 0; sample < PALETTE_RAMP_SAMPLES; sample++) {
      allowed.push(sampleRamp(ramp, sample / (PALETTE_RAMP_SAMPLES - 1)));
    }
    allowed.push(ramp.accent);
  }
  if (allowed.length === 0) {
    results.fail(
      spec.key,
      GATE,
      'the spec declares no ramps, so there is nothing to measure against',
    );
    return;
  }

  let stray = 0;
  let opaque = 0;
  for (let i = 0; i < idle.data.length; i += 4) {
    if (!isOpaque(idle, i)) continue;
    opaque++;
    const red = idle.data[i];
    const green = idle.data[i + 1];
    const blue = idle.data[i + 2];
    let nearest = Infinity;
    for (const color of allowed) {
      const distance = Math.hypot(red - color[0], green - color[1], blue - color[2]);
      if (distance < nearest) nearest = distance;
      if (nearest <= PALETTE_TOLERANCE) break;
    }
    if (nearest > PALETTE_TOLERANCE) stray++;
  }
  const fraction = opaque === 0 ? 1 : stray / opaque;
  if (!(fraction <= PALETTE_STRAY_FRACTION_LIMIT)) {
    results.fail(
      spec.key,
      GATE,
      `${(fraction * 100).toFixed(2)}% of opaque pixels are further than ${PALETTE_TOLERANCE} from ` +
        'every declared ramp colour; something is compositing a hue this building does not own',
    );
  }
  results.report(spec.key, GATE, `${(fraction * 100).toFixed(2)}% of pixels off-palette`);
}

// ── 6. the life overlay ────────────────────────────────────────────────────

/**
 * Overlay cells are mostly empty.
 *
 * The floor exists to catch a `life` row that has accidentally become a copy of
 * `idle` — which would double the sheet's visual weight, hide every `idle` bug
 * behind a second draw of the same pixels, and cost the overlay cache a full
 * building-sized composite per frame.
 */
export const LIFE_TRANSPARENCY_FLOOR = 0.95;

/**
 * Alpha below which an overlay pixel counts as carrying no ink.
 *
 * Not zero. Every glow in the overlay is a radial falloff that reaches alpha
 * zero only at its own rim, so a strict test counts the entire faint outer skirt
 * of a brazier as painted and reports a building with one candle as 93% covered.
 *
 * Twelve of 255 shifts a mid-value wall by about one luminance level — under
 * what a viewer can see and under what the PNG's own quantisation preserves. The
 * failure this gate exists to catch, a `life` row that has become a copy of
 * `idle`, is opaque everywhere at 255, so no threshold anywhere near this range
 * can hide it: the two populations are twenty times apart.
 */
const LIFE_INK_ALPHA_FLOOR = 12;

/**
 * The least ink an overlay cell may carry and still be an animation.
 *
 * The transparency gate below is a *ceiling* on ink; this is the floor, and
 * without it a `life` row that painted nothing at all passed every check in this
 * file — 100% transparent satisfies "must be at least 95% transparent"
 * perfectly.
 *
 * Set against the quietest overlay in the town, which is Cartwright's chimney
 * smoke at about 0.14% of its frame (Old Hilda's, the Shepherd's and the
 * Miller's follow between 0.2% and 0.45%). At under a third of that it passes
 * every real building comfortably, while failing an overlay that has lost most
 * of its ink rather than only one that has lost all of it. The bake prints the
 * current figure for every building, which is the number to trust.
 */
export const LIFE_MIN_INK_FRACTION = 0.0005;

export function gateLifeTransparency(
  results: GateResults,
  spec: BuildingSpec,
  lifeFrames: ReadonlyArray<PixelBuffer>,
): void {
  const GATE = 'life-transparency';
  let mostInk = 0;
  for (const [index, frame] of lifeFrames.entries()) {
    let clear = 0;
    let total = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
      total++;
      if (frame.data[i + 3] <= LIFE_INK_ALPHA_FLOOR) clear++;
    }
    const fraction = total === 0 ? 0 : clear / total;
    mostInk = Math.max(mostInk, 1 - fraction);
    if (!(fraction >= LIFE_TRANSPARENCY_FLOOR)) {
      results.fail(
        spec.key,
        GATE,
        `life frame ${index} is only ${(fraction * 100).toFixed(1)}% transparent; ` +
          `${(LIFE_TRANSPARENCY_FLOOR * 100).toFixed(0)}% is the floor`,
      );
    }
  }
  if (!(mostInk >= LIFE_MIN_INK_FRACTION)) {
    results.fail(
      spec.key,
      GATE,
      `no life frame carries as much as ${(LIFE_MIN_INK_FRACTION * 100).toFixed(3)}% ink ` +
        `(the fullest has ${(mostInk * 100).toFixed(4)}%); this building's overlay paints nothing`,
    );
  }
  results.report(
    spec.key,
    GATE,
    `${lifeFrames.length} cells, fullest carries ${(mostInk * 100).toFixed(2)}% ink`,
  );
}

/**
 * The loop closes.
 *
 * Frame `N-1` is compared against frame `0`, which is the only pair a centred
 * sample would never see and the only pair where a discontinuity is visible
 * every single loop. The tolerance is measured against the loop's own largest
 * step, not against an absolute number: a slow banner and a fast spark shower
 * have wildly different per-frame deltas, and one fixed threshold would either
 * wave the banner through or fail the sparks for animating.
 */
export const LOOP_SEAM_TOLERANCE_FACTOR = 1.4;

/**
 * Below this, consecutive frames are the same picture. Small, because the
 * comparison is a mean over the whole frame and the moving part of a building is
 * a fraction of a per cent of it — the quietest overlay in town (a cat
 * breathing) still clears this by an order of magnitude.
 */
export const LOOP_MIN_INTERIOR_STEP = 0.0005;

export function gateLifeLoop(
  results: GateResults,
  spec: BuildingSpec,
  lifeFrames: ReadonlyArray<PixelBuffer>,
): void {
  const GATE = 'life-loop';
  if (lifeFrames.length < 2) {
    results.fail(
      spec.key,
      GATE,
      `only ${lifeFrames.length} life frame(s); a loop needs at least two`,
    );
    return;
  }
  const interiorSteps: number[] = [];
  for (let index = 0; index + 1 < lifeFrames.length; index++) {
    interiorSteps.push(meanAbsoluteDifference(lifeFrames[index], lifeFrames[index + 1]));
  }
  interiorSteps.sort((a, b) => b - a);
  const worstInteriorStep = interiorSteps[0];
  // Compared against the *second*-worst interior step, not the worst. An
  // animation with one big move per loop makes its own largest step the yardstick
  // and then measures the seam against it, which is how a seam that is the
  // discontinuity gets waved through for being no worse than the jump the
  // author meant.
  const yardstick = interiorSteps.length > 1 ? interiorSteps[1] : worstInteriorStep;
  const seamStep = meanAbsoluteDifference(lifeFrames[lifeFrames.length - 1], lifeFrames[0]);
  // A row of identical cells has a worst interior step of zero, and zero also
  // satisfies "the seam is no worse than the interior" — so without this a frozen
  // overlay passed the loop gate by being perfectly, uselessly continuous.
  if (!(worstInteriorStep > LOOP_MIN_INTERIOR_STEP)) {
    results.fail(
      spec.key,
      GATE,
      `the largest change between consecutive life frames is ${worstInteriorStep.toFixed(4)}; ` +
        'this overlay does not move, so it is a still image being stored as an animation',
    );
    return;
  }
  const limit = yardstick * LOOP_SEAM_TOLERANCE_FACTOR;
  if (!(seamStep <= limit)) {
    results.fail(
      spec.key,
      GATE,
      `the step from the last frame back to the first is ${seamStep.toFixed(3)}, more than ` +
        `${LOOP_SEAM_TOLERANCE_FACTOR}x the loop's second-largest interior step ` +
        `(${yardstick.toFixed(3)}); ` +
        'the animation jumps once per loop',
    );
  }
  results.report(
    spec.key,
    GATE,
    `seam step ${seamStep.toFixed(3)} against a yardstick of ${yardstick.toFixed(3)}`,
  );
}

/** Mean absolute per-channel difference, premultiplied so alpha changes count. */
function meanAbsoluteDifference(a: PixelBuffer, b: PixelBuffer): number {
  if (a.data.length !== b.data.length) return Infinity;
  let total = 0;
  let samples = 0;
  const ALPHA_MAX = 255;
  for (let i = 0; i < a.data.length; i += 4) {
    const alphaA = a.data[i + 3] / ALPHA_MAX;
    const alphaB = b.data[i + 3] / ALPHA_MAX;
    for (let channel = 0; channel < 3; channel++) {
      total += Math.abs(a.data[i + channel] * alphaA - b.data[i + channel] * alphaB);
      samples++;
    }
  }
  return samples === 0 ? 0 : total / samples;
}

/** The overlay row has exactly the cells the spec asked for. */
export function gateLifeFrameCount(
  results: GateResults,
  spec: BuildingSpec,
  lifeFrames: ReadonlyArray<PixelBuffer>,
): void {
  const GATE = 'life-frame-count';
  const MIN_FRAMES = 6;
  /**
   * One below the radix `decorationAnimationFrame` folds overlay frame indices
   * with. That fold is the actual hazard: at 16 two distinct combinations of
   * frame indices collide on one cache key and a tile draws a frame belonging
   * to another animation. The bound used to sit at 10 on the grounds that a
   * longer loop "drags", which is taste rather than a defect — and the pub's
   * walkers need the length, because the pause between two passes cannot last
   * longer than the loop that repeats them.
   */
  const MAX_FRAMES = OVERLAY_FRAME_KEY_STRIDE - 1;
  // No check that `lifeFrames.length === spec.life.frames`: the only caller
  // builds that array with `Array.from({ length: spec.life.frames })`, so the
  // comparison was against the expression it came from and could not fail —
  // exactly the shape `gateNoCellBleed` replaced one function away.
  if (spec.life.frames < MIN_FRAMES || spec.life.frames > MAX_FRAMES) {
    results.fail(
      spec.key,
      GATE,
      `${spec.life.frames} frames is outside ${MIN_FRAMES}..${MAX_FRAMES}; at the shared 8 fps clock ` +
        'that either strobes or drags',
    );
  }
  for (const effect of spec.life.effects) {
    if (!Number.isInteger(effect.cycles) || effect.cycles < 1) {
      results.fail(
        spec.key,
        GATE,
        `effect '${effect.kind}' asks for ${effect.cycles} cycles; a fractional count leaves the ` +
          'last frame mid-stride from the first',
      );
    }
  }
}

/**
 * Nothing was drawn into the idle row beyond its single frame.
 *
 * `idle` is one frame, so every column of the top row after the first must be
 * empty. Ink there means a painter or a placement reached outside its own cell —
 * invisible on the frame that caused it, and a stripe of someone else's art on
 * the next one.
 *
 * Scoped to the idle row on purpose: the life cells are drawn from
 * frame-sized canvases *and* clipped to their own rects, so a life painter that
 * overreached would be cropped rather than caught. This gate is therefore about
 * placement, which is the failure that remains possible.
 *
 * It replaced a check that compared the idle cell's width against the expression
 * its own width had been computed from, and so could not fail.
 */
export function gateNoCellBleed(results: GateResults, spec: BuildingSpec, sheet: Canvas): void {
  const GATE = 'cell-bleed';
  const frameWidth = spec.tilesWide * BUILDING_TILE_SCALE;
  const frameHeight = spec.tilesHigh * BUILDING_TILE_SCALE;
  const spare = sheet.width - frameWidth;
  if (spare <= 0) {
    results.fail(
      spec.key,
      GATE,
      `the sheet is ${sheet.width}px wide, no wider than its own ${frameWidth}px frame, so there ` +
        'is no spare idle-row space to scan and this gate would otherwise report green having ' +
        'measured nothing',
    );
    return;
  }

  const strip = sheet.getContext('2d').getImageData(frameWidth, 0, spare, frameHeight);
  let painted = 0;
  for (let i = ALPHA_CHANNEL_OFFSET; i < strip.data.length; i += CHANNELS_PER_PIXEL) {
    if (strip.data[i] !== 0) painted++;
  }
  if (painted > 0) {
    results.fail(
      spec.key,
      GATE,
      `${painted} pixel(s) are painted in the idle row beyond its single frame; a painter has ` +
        "reached past its own cell and will show up as a stripe in the next frame's art",
    );
  }
}

const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;

export function readSheetCell(
  sheet: Canvas,
  column: number,
  row: number,
  frameWidth: number,
  frameHeight: number,
): PixelBuffer {
  const image = sheet
    .getContext('2d')
    .getImageData(column * frameWidth, row * frameHeight, frameWidth, frameHeight);
  return { data: image.data, width: frameWidth, height: frameHeight };
}

export { readCanvas };
