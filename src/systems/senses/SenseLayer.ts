/**
 * What only some crawlers perceive: a scent left along a trail, a ward line
 * across a floor. Each sense is one entry in {@link SENSES}, saying who
 * perceives it and how it is painted; systems register sources into a
 * scene's layer and take them out again through the handle they get back.
 *
 * The steered crawler sees every sense it perceives at full strength, faded
 * in over a beat after a switch. A source that can hurt is never invisible to
 * the crawler it can hurt: a crawler who does not perceive it still sees a
 * faint, steady red warning over the same ground (`difficulty-fairness-rules.md`).
 */

import { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { CRAWLER_KINDS, type CrawlerKind } from '../../core/skills/SkillManager';
import { feetPointPx } from '../../map/collisionAnchors';
import { TILE_SIZE } from '../../core/constants';
import {
  measurePath,
  paintScentTrail,
  paintWardGlow,
  paintWardWarning,
  wardWarningFade,
  WARD_UNPERCEIVED_WARNING_FADE,
  type MeasuredPath,
  type SensePaintView,
  type SensePoint,
  type WardSegment,
} from '../../ui/world/worldSenses';

const SENSE_IDS = ['scent', 'ward'] as const;
export type SenseId = (typeof SENSE_IDS)[number];

/** A scent laid along the ground, in world pixels at foot level. */
export interface ScentTrail {
  readonly points: readonly SensePoint[];
  /** Where the scent is strongest; a perceiving cat stopping here puts her nose down. */
  readonly sniffAt: readonly SensePoint[];
  /** Called as a perceiving cat puts her nose down at one of {@link sniffAt}. */
  readonly sniffed: (at: SensePoint) => void;
}

/** A ward line across the floor, in world pixels at foot level. */
export interface WardLine {
  readonly segments: readonly WardSegment[];
  readonly hurts: boolean;
  /** The ward's strength this frame, 0 to 1, from the system that runs its rhythm. */
  readonly pulse: () => number;
}

/** The source each sense is registered with. */
export interface SenseSources {
  readonly scent: ScentTrail;
  readonly ward: WardLine;
}

/** A source as the layer keeps it, with whatever its painter measures once. */
interface SenseEntries {
  readonly scent: { readonly source: ScentTrail; readonly path: MeasuredPath };
  readonly ward: { readonly source: WardLine };
}

/** How a source looks to a crawler who does not perceive it. */
type UnperceivedLook<S extends SenseId> =
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'warning_when_harmful';
      readonly hurts: (entry: SenseEntries[S]) => boolean;
      /** Paints the warning at `share` (0 to 1) of its own strength. */
      readonly paintWarning: (
        ctx: CanvasRenderingContext2D,
        entry: SenseEntries[S],
        share: number,
        view: SensePaintView,
      ) => void;
    };

interface SenseDef<S extends SenseId> {
  readonly perceivedBy: ReadonlySet<CrawlerKind>;
  readonly entry: (source: SenseSources[S]) => SenseEntries[S];
  /** Paints a source for a crawler who perceives the sense, at `strength` of full. */
  readonly paint: (
    ctx: CanvasRenderingContext2D,
    entry: SenseEntries[S],
    strength: number,
    view: SensePaintView,
  ) => void;
  readonly unperceived: UnperceivedLook<S>;
}

const CAT_ONLY: ReadonlySet<CrawlerKind> = new Set<CrawlerKind>(['cat']);

const SENSES: { readonly [S in SenseId]: SenseDef<S> } = {
  scent: {
    perceivedBy: CAT_ONLY,
    entry: (source) => ({ source, path: measurePath(source.points) }),
    paint: (ctx, entry, strength, view) => paintScentTrail(ctx, entry.path, strength, view),
    unperceived: { kind: 'hidden' },
  },
  ward: {
    perceivedBy: CAT_ONLY,
    entry: (source) => ({ source }),
    paint: (ctx, entry, strength, view) => {
      const { segments, hurts, pulse } = entry.source;
      if (hurts) paintWardWarning(ctx, segments, wardWarningFade(pulse(), strength), view);
      else paintWardGlow(ctx, segments, pulse(), strength, view);
    },
    unperceived: {
      kind: 'warning_when_harmful',
      hurts: (entry) => entry.source.hurts,
      paintWarning: (ctx, entry, share, view) =>
        paintWardWarning(ctx, entry.source.segments, WARD_UNPERCEIVED_WARNING_FADE * share, view),
    },
  },
};

/** How long a sense takes to come up to full strength after a switch to a crawler who perceives it. */
const FADE_IN_MS = 450;
/** How close to a sniff point a cat's feet must come for her to put her nose down. */
const SNIFF_REACH_TILES = 0.6;
const SNIFF_REACH_PX = TILE_SIZE * SNIFF_REACH_TILES;
/** How far she must stray from a sniff point before she will sniff it again. */
const SNIFF_REARM_TILES = 1.5;
const SNIFF_REARM_PX = TILE_SIZE * SNIFF_REARM_TILES;
const MAX_FRAME_STEP_MS = 100;

/** A registered source; removing it takes it off the layer. */
export interface SenseSourceHandle {
  remove(): void;
}

type EntrySets = { [S in SenseId]: Set<SenseEntries[S]> };

function emptyEntrySets(): EntrySets {
  return { scent: new Set(), ward: new Set() };
}

function emptyStrengths(): Record<SenseId, number> {
  return { scent: 0, ward: 0 };
}

export function perceives(sense: SenseId, crawler: HumanPlayer | CatPlayer): boolean {
  return SENSES[sense].perceivedBy.has(crawler.crawlerKind);
}

/** Whether `kind` perceives `sense` and some other crawler does not. */
function perceivedOnlyBySome(sense: SenseId, kind: CrawlerKind): boolean {
  const perceivedBy = SENSES[sense].perceivedBy;
  return perceivedBy.has(kind) && CRAWLER_KINDS.some((other) => !perceivedBy.has(other));
}

function distanceToSegment(point: SensePoint, from: SensePoint, to: SensePoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + dx * along), point.y - (from.y + dy * along));
}

function polylineWithin(
  points: readonly SensePoint[],
  point: SensePoint,
  reachPx: number,
): boolean {
  if (points.length === 0) return false;
  const first = points[0];
  if (points.length === 1) return Math.hypot(point.x - first.x, point.y - first.y) <= reachPx;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1] ?? first;
    const to = points[index] ?? first;
    if (distanceToSegment(point, from, to) <= reachPx) return true;
  }
  return false;
}

function paintEntries<S extends SenseId>(
  ctx: CanvasRenderingContext2D,
  def: SenseDef<S>,
  entries: ReadonlySet<SenseEntries[S]>,
  strength: number,
  view: SensePaintView,
): void {
  const unperceived = def.unperceived;
  for (const entry of entries) {
    const showsWarning =
      unperceived.kind === 'warning_when_harmful' && strength < 1 && unperceived.hurts(entry);
    if (showsWarning) unperceived.paintWarning(ctx, entry, 1 - strength, view);
    def.paint(ctx, entry, strength, view);
  }
}

/** One map's sense sources and how strongly each sense shows to the crawler being steered. */
export class SenseLayer {
  private readonly entries = emptyEntrySets();
  private readonly strength = emptyStrengths();
  private lastUpdateMs: number | null = null;
  private steered: CrawlerKind | null = null;
  /** Sniff points she is already standing at, so she sniffs each once per arrival. */
  private readonly sniffedPoints = new Set<SensePoint>();
  /** Sniff points whose row has been warmed for this approach. */
  private readonly cuedPoints = new Set<SensePoint>();

  add<S extends SenseId>(sense: S, source: SenseSources[S]): SenseSourceHandle {
    const entry = SENSES[sense].entry(source);
    const set: Set<SenseEntries[S]> = this.entries[sense];
    set.add(entry);
    return {
      remove: () => {
        set.delete(entry);
      },
    };
  }

  /** Whether anything is registered, so a scene can skip the layer's paint. */
  get isEmpty(): boolean {
    return SENSE_IDS.every((sense) => this.entries[sense].size === 0);
  }

  /**
   * Whether a source of a sense that `kind` perceives and the other crawler
   * does not lies within `reachPx` of `point` (world pixels at foot level):
   * the one question every cue that a crawler should be switched to asks.
   */
  exclusiveSenseWithin(kind: CrawlerKind, point: SensePoint, reachPx: number): boolean {
    for (const sense of SENSE_IDS) {
      if (!perceivedOnlyBySome(sense, kind)) continue;
      switch (sense) {
        case 'scent':
          for (const entry of this.entries.scent) {
            if (polylineWithin(entry.source.points, point, reachPx)) return true;
          }
          break;
        case 'ward':
          for (const entry of this.entries.ward) {
            for (const segment of entry.source.segments) {
              if (distanceToSegment(point, segment.from, segment.to) <= reachPx) return true;
            }
          }
          break;
        default: {
          const unreachable: never = sense;
          return unreachable;
        }
      }
    }
    return false;
  }

  /**
   * Once a frame, with the crawler being steered: eases each sense toward
   * full or none, and puts a perceiving cat's nose down at a sniff point she
   * has just reached.
   */
  update(steered: HumanPlayer | CatPlayer, nowMs: number): void {
    const last = this.lastUpdateMs;
    const stepMs = last === null ? 0 : Math.max(0, Math.min(MAX_FRAME_STEP_MS, nowMs - last));
    this.lastUpdateMs = nowMs;
    if (this.steered !== steered.crawlerKind) {
      this.steered = steered.crawlerKind;
      for (const sense of SENSE_IDS) this.strength[sense] = 0;
      this.sniffedPoints.clear();
      this.cuedPoints.clear();
    }
    for (const sense of SENSE_IDS) {
      const target = perceives(sense, steered) ? 1 : 0;
      const step = stepMs / FADE_IN_MS;
      const current = this.strength[sense];
      this.strength[sense] =
        target > current ? Math.min(target, current + step) : Math.max(target, current - step);
    }
    if (steered instanceof CatPlayer && perceives('scent', steered)) this.sniff(steered);
  }

  /** Paints every source, under the bodies. */
  paint(ctx: CanvasRenderingContext2D, view: SensePaintView): void {
    for (const sense of SENSE_IDS) {
      const strength = this.strength[sense];
      switch (sense) {
        case 'scent':
          paintEntries(ctx, SENSES.scent, this.entries.scent, strength, view);
          break;
        case 'ward':
          paintEntries(ctx, SENSES.ward, this.entries.ward, strength, view);
          break;
        default: {
          const unreachable: never = sense;
          return unreachable;
        }
      }
    }
  }

  private sniff(cat: CatPlayer): void {
    const feet = feetPointPx(cat, TILE_SIZE);
    for (const entry of this.entries.scent) {
      for (const point of entry.source.sniffAt) {
        const distance = Math.hypot(point.x - feet.x, point.y - feet.y);
        if (distance > SNIFF_REARM_PX) {
          this.sniffedPoints.delete(point);
          this.cuedPoints.delete(point);
          continue;
        }
        if (this.sniffedPoints.has(point)) continue;
        if (!this.cuedPoints.has(point)) {
          this.cuedPoints.add(point);
          cat.cueVerb('sniff');
        }
        if (distance > SNIFF_REACH_PX || cat.isMoving) continue;
        this.sniffedPoints.add(point);
        cat.playVerb('sniff');
        entry.source.sniffed(point);
      }
    }
  }
}
