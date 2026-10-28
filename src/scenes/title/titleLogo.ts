/**
 * Where the wordmark sits and when it lands, shared by the layer that paints it
 * and the layer that throws dust and sparks off it. Pure geometry and timing:
 * nothing here draws.
 */

import { allocCanvas, surfaceContext } from '../../core/rendering/canvasSurface';
import type { Rect } from '../../ui/core/geom';
import type { PaintTarget } from '../../ui/widgets/paint';
import { onUiFontLoaded } from '../../ui/theme/fonts';
import { skinsFor } from '../../ui/theme/skins';
import { resolveTheme, type Theme, type TypeStyle } from '../../ui/theme/tokens';
import { measureText } from '../../ui/widgets/text';
import type { TitleClock } from './titleClock';
import type { TitlePoint } from './titleLayer';
import type { TitleStage } from './titleStage';
import { IGNITION_DURATION_MS, LOGO_SLAM_AT_MS, type TitleCue } from './titleTimeline';

/** The title line as one run, for a stage wide enough to hold it at a striking size. */
const TITLE_ONE_LINE = ['Kitten Crawler'] as const;
/** The title broken in two, for a narrow stage where one run would be small. */
const TITLE_TWO_LINES = ['Kitten', 'Crawler'] as const;
const SUBTITLE = 'World';

/**
 * Inter's capitals are this tall, as a share of the font size. With a middle
 * baseline they sit centred on the line's middle, half of this either side.
 */
const CAP_HEIGHT_EM = 0.73;
const HALF = 0.5;
/** The subtitle is set at this share of the title's size. */
const SUBTITLE_SCALE = 0.46;
/** The gap between one title line's capitals and the next, as a share of the title size. */
const TITLE_LINE_GAP_EM = 0.12;
/** The gap between the title's capitals and the subtitle's, as a share of the title size. */
const SUBTITLE_GAP_EM = 0.2;
/** How deep the extrusion runs below the face, as a share of the title size. */
const EXTRUSION_DEPTH_EM = 0.13;
/** The room kept round the letters for the glow to fade out in, as a share of the title size. */
const GLOW_ROOM_EM = 0.55;
/** The share of the logo rect's width the widest line may fill, leaving the rest as margin. */
const WIDTH_FILL = 0.94;
/** A rule's thickness, as a share of the subtitle's size. */
const RULE_THICKNESS_EM = 0.12;
/** The gap between the subtitle and each rule, as a share of the subtitle's size. */
const RULE_GAP_EM = 0.45;
/** How much of the title's width the rules and the subtitle span together. */
const RULE_SPAN_SHARE = 0.86;

/** The scale every measurement is first taken at, then scaled linearly to fit. */
const MEASURE_CANVAS_PX = 1;

let fontGeneration = 0;
onUiFontLoaded(() => {
  fontGeneration += 1;
});

/** Bumped when the UI face arrives: a logo baked in the fallback face should bake again. */
export function logoFontGeneration(): number {
  return fontGeneration;
}

let measureTarget: PaintTarget | null = null;

function measuringTarget(): PaintTarget {
  if (measureTarget !== null) return measureTarget;
  const canvas = allocCanvas('title', MEASURE_CANVAS_PX, MEASURE_CANVAS_PX);
  measureTarget = { ctx: surfaceContext(canvas), theme: resolveTheme('pointer') };
  return measureTarget;
}

/** One line of the wordmark: the text, the rect `text()` centres it in, and its style. */
export interface TitleLogoLine {
  readonly text: string;
  readonly rect: Rect;
  readonly style: TypeStyle;
  readonly inkWidth: number;
}

export interface TitleLogoGeometry {
  readonly theme: Theme;
  readonly titleLines: readonly TitleLogoLine[];
  readonly subtitle: TitleLogoLine;
  /** The two rules either side of the subtitle, left then right; each tapers to a point at its outer end. */
  readonly rules: readonly [Rect, Rect];
  /** The title's size in CSS pixels. */
  readonly size: number;
  /** How far the extrusion runs below the face, in CSS pixels. */
  readonly depth: number;
  /** The bottom of the whole lettering, extrusion included: below the subtitle and its rules. */
  readonly footY: number;
  /** The left and right ends of the rules, the width of the lettering's foot. */
  readonly footLeft: number;
  readonly footRight: number;
  /** The middle of the lettering, the point the slam scales about. */
  readonly center: TitlePoint;
  /** Everything the logo paints, with room for the extrusion and the glow. */
  readonly bounds: Rect;
  readonly fontGeneration: number;
}

/** `base` at `size`, its line height and tracking scaled with it. */
export function logoStyleAt(base: TypeStyle, size: number): TypeStyle {
  const factor = size / base.size;
  return {
    ...base,
    size,
    lineHeight: base.lineHeight * factor,
    letterSpacing: (base.letterSpacing ?? 0) * factor,
  };
}

interface Arrangement {
  readonly lines: readonly string[];
  readonly size: number;
}

/** The title size that fits `lines` into `rect`, from widths measured at the token's size. */
function fitArrangement(
  target: PaintTarget,
  base: TypeStyle,
  lines: readonly string[],
  rect: Rect,
): Arrangement {
  const widestAtBase = Math.max(...lines.map((line) => measureText(target, line, { style: base })));
  const sizeForWidth = (rect.w * WIDTH_FILL * base.size) / Math.max(1, widestAtBase);
  const titleEms = lines.length * CAP_HEIGHT_EM + (lines.length - 1) * TITLE_LINE_GAP_EM;
  const heightEms =
    titleEms + SUBTITLE_GAP_EM + SUBTITLE_SCALE * CAP_HEIGHT_EM + EXTRUSION_DEPTH_EM;
  const sizeForHeight = rect.h / heightEms;
  return { lines, size: Math.min(sizeForWidth, sizeForHeight) };
}

function lineAt(
  target: PaintTarget,
  text: string,
  style: TypeStyle,
  centerX: number,
  capTop: number,
): TitleLogoLine {
  const inkWidth = measureText(target, text, { style });
  const middle = capTop + style.size * CAP_HEIGHT_EM * HALF;
  const rect: Rect = {
    x: centerX - inkWidth,
    y: middle - style.lineHeight * HALF,
    w: inkWidth * 2,
    h: style.lineHeight,
  };
  return { text, rect, style, inkWidth };
}

/** Lays the wordmark into `stage.logoRect`, as large as it fits. */
export function titleLogoGeometry(stage: TitleStage): TitleLogoGeometry {
  const target = measuringTarget();
  const { theme } = target;
  const base = skinsFor(theme).titleLogo.style;
  const room = stage.logoRect;
  const arrangement = [TITLE_ONE_LINE, TITLE_TWO_LINES]
    .map((lines) => fitArrangement(target, base, lines, room))
    .reduce((best, next) => (next.size > best.size ? next : best));

  const { size } = arrangement;
  const titleStyle = logoStyleAt(base, size);
  const subtitleStyle = logoStyleAt(base, size * SUBTITLE_SCALE);
  const capHeight = size * CAP_HEIGHT_EM;
  const subtitleCapHeight = subtitleStyle.size * CAP_HEIGHT_EM;
  const depth = size * EXTRUSION_DEPTH_EM;
  const lineCount = arrangement.lines.length;
  const blockHeight =
    lineCount * capHeight +
    (lineCount - 1) * size * TITLE_LINE_GAP_EM +
    size * SUBTITLE_GAP_EM +
    subtitleCapHeight +
    depth;
  const centerX = room.x + room.w * HALF;
  const top = room.y + (room.h - blockHeight) * HALF;

  const titleLines = arrangement.lines.map((line, index) =>
    lineAt(target, line, titleStyle, centerX, top + index * (capHeight + size * TITLE_LINE_GAP_EM)),
  );
  const lastTitleCapTop = top + (lineCount - 1) * (capHeight + size * TITLE_LINE_GAP_EM);
  const baselineY = lastTitleCapTop + capHeight;
  const subtitleCapTop = baselineY + size * SUBTITLE_GAP_EM;
  const subtitle = lineAt(target, SUBTITLE, subtitleStyle, centerX, subtitleCapTop);

  const widestInk = Math.max(...titleLines.map((line) => line.inkWidth));
  const ruleThickness = subtitleStyle.size * RULE_THICKNESS_EM;
  const ruleGap = subtitleStyle.size * RULE_GAP_EM;
  const ruleLength = Math.max(
    0,
    (widestInk * RULE_SPAN_SHARE - subtitle.inkWidth) * HALF - ruleGap,
  );
  const ruleY = subtitleCapTop + subtitleCapHeight * HALF - ruleThickness * HALF;
  const subtitleLeft = centerX - subtitle.inkWidth * HALF;
  const subtitleRight = centerX + subtitle.inkWidth * HALF;
  const rules: readonly [Rect, Rect] = [
    { x: subtitleLeft - ruleGap - ruleLength, y: ruleY, w: ruleLength, h: ruleThickness },
    { x: subtitleRight + ruleGap, y: ruleY, w: ruleLength, h: ruleThickness },
  ];

  const inkLeft = centerX - widestInk * HALF;
  const glowRoom = size * GLOW_ROOM_EM;
  const bounds: Rect = {
    x: inkLeft - glowRoom,
    y: top - glowRoom,
    w: widestInk + glowRoom * 2,
    h: blockHeight + glowRoom * 2,
  };
  return {
    theme,
    titleLines,
    subtitle,
    rules,
    size,
    depth,
    footY: subtitleCapTop + subtitleCapHeight + depth,
    footLeft: rules[0].x,
    footRight: rules[1].x + rules[1].w,
    center: { x: centerX, y: top + (blockHeight - depth) * HALF },
    bounds,
    fontGeneration,
  };
}

/**
 * A dive entered with the slam already delivered but never seen on a frame (a
 * frozen review moment) stands in this for how long ago the slam was: long
 * enough that every slam effect has finished.
 */
const LONG_AFTER_SLAM_MS = 60000;

function sinceSlamBeforeDive(clock: TitleClock): number | null {
  switch (clock.state) {
    case 'dormant':
    case 'dive':
      return null;
    case 'ignition': {
      const since = clock.stateElapsedMs - LOGO_SLAM_AT_MS;
      return since < 0 ? null : since;
    }
    case 'alive':
      return clock.stateElapsedMs + IGNITION_DURATION_MS - LOGO_SLAM_AT_MS;
  }
}

function runUpBeforeDive(clock: TitleClock): number {
  if (clock.state === 'dormant') return 0;
  if (clock.state !== 'ignition') return 1;
  return Math.min(1, clock.stateElapsedMs / Math.max(1, LOGO_SLAM_AT_MS));
}

/**
 * How long ago the logo slammed in, and how far the hall had warmed toward
 * it. Read from the clock rather than from the cue, so a moment entered
 * part-way shows the slam exactly as far along as a player watching would see
 * it. One per layer: it remembers where on the scene clock the slam fell and
 * how far the run-up had got, because a dive only ever dims the logo from
 * wherever it stood, and the dive's own clock no longer says how long the
 * reveal or the idle loop lasted.
 */
export class LogoSlamClock {
  private slamAtElapsedMs: number | null = null;
  private slamDelivered = false;
  private runUpAtDive = 0;

  /** Forward the layer's cues: a frozen moment hands over the slam without a frame between. */
  onCue(cue: TitleCue): void {
    if (cue === 'logoSlam') this.slamDelivered = true;
  }

  /** Milliseconds since the slam, or `null` while it has not happened. */
  since(clock: TitleClock): number | null {
    if (clock.state !== 'dive') {
      const since = sinceSlamBeforeDive(clock);
      this.slamAtElapsedMs = since === null ? null : clock.elapsedMs - since;
      this.runUpAtDive = runUpBeforeDive(clock);
      return since;
    }
    const slamAt = this.slamAtElapsedMs;
    if (slamAt !== null) return clock.elapsedMs - slamAt;
    return this.slamDelivered ? LONG_AFTER_SLAM_MS + clock.stateElapsedMs : null;
  }

  /** How far through the ignition's run-up to the slam, 0 to 1; 1 once it has landed. */
  runUp(clock: TitleClock): number {
    if (clock.state !== 'dive') return runUpBeforeDive(clock);
    return this.slamDelivered ? 1 : this.runUpAtDive;
  }
}
