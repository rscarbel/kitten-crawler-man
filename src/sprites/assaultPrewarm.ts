/**
 * Keeps the figures an undead assault wave on Briar Hollow is about to put on
 * screen warm through its lead-in: the raised ratkin, the Grave Bull and the
 * necromancer.
 *
 * None of them is seen anywhere else, so none is warm when a wave is
 * announced, and the cache they share is also holding the crawlers — Carl's
 * fight alone keeps nearly 40 MB of the cache's own ceiling drawn every frame. So
 * {@link AssaultWavePrewarm}:
 *
 * - **Warms a small set.** Only the rows a wave arrives playing, in the views
 *   its lanes show — about 16 MB for the third wave. Everything else is warmed
 *   in stages as each creature closes in (`prewarmRaisedRatkin`,
 *   `prewarmGraveBullAttack`, `prewarmNecromancerStanding`, …).
 * - **Asks for one row at a time.** Its next row is asked for once every row it
 *   has asked for is warm, so it never holds more than one row's place in the
 *   prewarm queue, however long the queue is.
 * - **Touches instead of re-queuing.** Rows warmed but not yet drawn are the
 *   stalest in the cache, so its idle sweep would take them first. Every update
 *   each warm row is touched (`touchFigureState`), which keeps it from the
 *   sweep without queuing anything. A touch does not outrank a draw: under
 *   pressure, a row only touched goes before any figure drawn since.
 * - **Never evicts for itself.** A row is asked for, or asked for again, only
 *   while it fits without evicting anything (`figureRowFitsWithoutEviction`).
 *   The prewarm queue drains at the start of a frame, before anything is drawn
 *   in it, so a bake allowed to evict could take a row that is on screen, whose
 *   rebake on the draw would then take the warmed row back: a row lost every
 *   frame.
 */

import type { FigureDef } from './figure/figureDef';
import {
  figureRowFitsWithoutEviction,
  prewarmFigureState,
  touchFigureState,
} from './figure/figureFrameCache';
import { RAISED_RATKIN_LOOKS } from './art/raisedRatkinArt';
import { raisedRatkinFigure, raisedStateName } from './art/raisedRatkinFigure';
import { GRAVE_BULL_FIGURE, graveBullStateName } from './art/graveBullFigure';
import { NECROMANCER_FIGURE, necromancerStateName } from './art/necromancerFigure';
import { GRAVE_BULL_ARRIVAL_ROWS } from './graveBullSprite';
import { NECROMANCER_ARRIVAL_ROWS } from './necromancerSprite';
import { RAISED_ARRIVAL_ROWS } from './raisedRatkinSprite';
import { GOBLIN_FIGURES } from './art/goblinFigure';
import { GOBLIN_BOMBER_FIGURES } from './art/goblinBomberFigure';
import { RAT_FIGURE } from './art/ratFigure';
import { COCKROACH_FIGURE } from './art/cockroachFigure';
import { SKYFOWL_TOUGH_LOOKS } from './art/skyfowl/cast';
import { skyfowlCastFigure } from './art/skyfowlCastFigure';
import { TROGLODYTE_FIGURE } from './art/troglodyteFigure';
import { LLAMA_FIGURE } from './art/llamaFigure';
import { CIRCUS_LEMUR_FIGURE } from './art/circusLemurFigure';
import { FAT_CLOWN_FIGURE, STILT_CLOWN_FIGURE } from './art/clownFigure';
import { TUSKLING_FIGURE } from './art/tusklingFigure';
import { MOLD_LION_FIGURE } from './art/moldLionFigure';
import { CITY_ELF_CULTIST_FIGURE } from './art/cityElfCultistFigure';
import { MANTIS_FIGURE } from './art/mantidFigure';
import { BUGABOO_FIGURE } from './art/bugabooFigure';
import { ROCK_GOLEM_FIGURE } from './art/rockGolemFigure';
import { SKELETON_ARCHER_FIGURE, SKELETON_SWORD_FIGURE } from './art/skeletonFigure';
import type { GoblinWeapon } from './goblinSprite';

/** Which assault wave: every one brings raised ratkin and him, the second on add a bull. */
export type AssaultWave = 1 | 2 | 3 | 4;

/** Every wave, in order. */
export const ASSAULT_WAVE_NUMBERS: readonly AssaultWave[] = [1, 2, 3, 4];

const FIRST_BULL_WAVE = 2;

/** One row of one figure. */
export interface AssaultRow {
  readonly def: FigureDef;
  readonly state: string;
}

/** Every row a wave arrives playing. */
export function assaultWaveRows(wave: AssaultWave): AssaultRow[] {
  const rows: AssaultRow[] = [];
  for (const look of RAISED_RATKIN_LOOKS) {
    const def = raisedRatkinFigure(look);
    for (const row of RAISED_ARRIVAL_ROWS)
      rows.push({ def, state: raisedStateName(row.action, row.view) });
  }
  if (wave >= FIRST_BULL_WAVE) {
    for (const row of GRAVE_BULL_ARRIVAL_ROWS) {
      rows.push({ def: GRAVE_BULL_FIGURE, state: graveBullStateName(row.action, row.view) });
    }
  }
  for (const row of NECROMANCER_ARRIVAL_ROWS) {
    rows.push({ def: NECROMANCER_FIGURE, state: necromancerStateName(row.action, row.view) });
  }
  return rows;
}

// ── The rest of a wave's roster ─────────────────────────────────────────────

/** Which way a wave's bodies face as they come up their lane toward the village. */
export type AssaultApproachView = 'front' | 'side' | 'away';

/**
 * The assault's other figure-drawn kinds, by spawn-registry key: the
 * skeletons, raised without the rise their own floors warm them in, and every
 * hostile the necromancer drives before him. The ruins ghoul and the Krasue
 * are painted without the figure cache and have nothing here to warm.
 */
export type AssaultRosterKind =
  | 'skeleton_warrior'
  | 'skeleton_archer'
  | 'goblin'
  | 'goblin_archer'
  | 'goblin_dynamiter'
  | 'goblin_bombardier'
  | 'rat'
  | 'cockroach'
  | 'sky_fowl'
  | 'troglodyte'
  | 'llama'
  | 'circus_lemur'
  | 'fat_clown'
  | 'stilt_clown'
  | 'tuskling'
  | 'mold_lion'
  | 'city_elf_cultist'
  | 'mantis'
  | 'bugaboo'
  | 'rock_golem';

/** How a kind's row names carry their view: one mirrored side row, or a suffix per view. */
type RowViews = 'single' | Readonly<Record<AssaultApproachView, string>>;

const THREE_VIEWS = { front: '', side: '_side', away: '_away' } as const satisfies RowViews;
const COCKROACH_VIEWS = { front: '', side: '_side', away: '_back' } as const satisfies RowViews;

/** The rows a kind walks in and opens its fight with, in every figure it may be drawn as. */
interface RosterKindRows {
  /** Every figure one body of the kind may be: a goblin's weapon, a fowl's look. */
  readonly figures: readonly FigureDef[];
  readonly walk: string;
  readonly attacks: readonly string[];
  readonly views: RowViews;
}

/** Every weapon a common goblin may be spawned carrying. */
const GOBLIN_WEAPONS: readonly GoblinWeapon[] = ['sword', 'axe', 'mace', 'warhammer'];

const ROSTER_KIND_ROWS: Readonly<Record<AssaultRosterKind, RosterKindRows>> = {
  skeleton_warrior: {
    figures: [SKELETON_SWORD_FIGURE],
    walk: 'walk',
    attacks: ['slash'],
    views: THREE_VIEWS,
  },
  skeleton_archer: {
    figures: [SKELETON_ARCHER_FIGURE],
    walk: 'walk',
    attacks: ['draw_loose'],
    views: THREE_VIEWS,
  },
  goblin: {
    figures: GOBLIN_WEAPONS.map((weapon) => GOBLIN_FIGURES[weapon]),
    walk: 'walk',
    attacks: ['attack_light', 'attack_heavy'],
    views: 'single',
  },
  goblin_archer: {
    figures: [GOBLIN_FIGURES.bow],
    walk: 'walk',
    attacks: ['attack_heavy', 'attack_light'],
    views: 'single',
  },
  goblin_dynamiter: {
    figures: [GOBLIN_BOMBER_FIGURES.dynamite],
    walk: 'walk',
    attacks: ['light', 'throw'],
    views: 'single',
  },
  goblin_bombardier: {
    figures: [GOBLIN_BOMBER_FIGURES.black_powder],
    walk: 'walk',
    attacks: ['light', 'aim', 'throw'],
    views: 'single',
  },
  rat: { figures: [RAT_FIGURE], walk: 'walk', attacks: ['bite'], views: THREE_VIEWS },
  cockroach: {
    figures: [COCKROACH_FIGURE],
    walk: 'skitter',
    attacks: ['bite'],
    views: COCKROACH_VIEWS,
  },
  sky_fowl: {
    figures: SKYFOWL_TOUGH_LOOKS.map((look) => skyfowlCastFigure(look.id)),
    walk: 'walk',
    attacks: ['strike'],
    views: THREE_VIEWS,
  },
  troglodyte: {
    figures: [TROGLODYTE_FIGURE],
    walk: 'walk',
    attacks: ['gape', 'lash'],
    views: THREE_VIEWS,
  },
  llama: { figures: [LLAMA_FIGURE], walk: 'walk', attacks: ['spit'], views: THREE_VIEWS },
  circus_lemur: {
    figures: [CIRCUS_LEMUR_FIGURE],
    walk: 'walk',
    attacks: ['throw', 'attack'],
    views: 'single',
  },
  fat_clown: { figures: [FAT_CLOWN_FIGURE], walk: 'walk', attacks: ['slam'], views: 'single' },
  stilt_clown: {
    figures: [STILT_CLOWN_FIGURE],
    walk: 'walk',
    attacks: ['windup', 'lunge'],
    views: 'single',
  },
  tuskling: { figures: [TUSKLING_FIGURE], walk: 'walk', attacks: ['hook'], views: THREE_VIEWS },
  mold_lion: { figures: [MOLD_LION_FIGURE], walk: 'walk', attacks: ['attack'], views: 'single' },
  city_elf_cultist: {
    figures: [CITY_ELF_CULTIST_FIGURE],
    walk: 'walk',
    attacks: ['cast'],
    views: THREE_VIEWS,
  },
  mantis: { figures: [MANTIS_FIGURE], walk: 'walk', attacks: ['slash'], views: THREE_VIEWS },
  bugaboo: { figures: [BUGABOO_FIGURE], walk: 'walk', attacks: ['swipe'], views: THREE_VIEWS },
  rock_golem: {
    figures: [ROCK_GOLEM_FIGURE],
    walk: 'walk',
    attacks: ['slam', 'stomp'],
    views: THREE_VIEWS,
  },
};

const ROSTER_KINDS: ReadonlySet<string> = new Set(Object.keys(ROSTER_KIND_ROWS));

/** Whether a spawn kind is one the roster ticker has rows for. */
export function isAssaultRosterKind(kind: string): kind is AssaultRosterKind {
  return ROSTER_KINDS.has(kind);
}

function rowName(base: string, views: RowViews, view: AssaultApproachView): string {
  return views === 'single' ? base : `${base}${views[view]}`;
}

/**
 * Every row `kind` walks up its lane in, then every row it opens its fight
 * with, facing `view`, whether or not each exists in its figure; see
 * {@link assaultRosterRows} for the list the ticker warms.
 */
export function assaultKindRows(
  kind: AssaultRosterKind,
  view: AssaultApproachView,
): { readonly walk: AssaultRow[]; readonly attack: AssaultRow[] } {
  const spec = ROSTER_KIND_ROWS[kind];
  const walk = spec.figures.map((def) => ({ def, state: rowName(spec.walk, spec.views, view) }));
  const attack = spec.figures.flatMap((def) =>
    spec.attacks.map((base) => ({ def, state: rowName(base, spec.views, view) })),
  );
  return { walk, attack };
}

/** One kind in a wave's roster and how many of it come. */
export interface AssaultRosterEntry {
  readonly kind: AssaultRosterKind;
  readonly count: number;
}

/**
 * The rows the rest of a wave's roster arrives playing, in the order they are
 * worth warming. Every kind's walk comes before any attack, since a body is
 * seen walking up the lane far longer than it is seen swinging; within each,
 * the most numerous kind first, and kinds equally many in the order they come
 * up the lane. `roster` is in that order. A cache too full for all of it then
 * warms what is on screen most.
 */
export function assaultRosterRows(
  roster: readonly AssaultRosterEntry[],
  view: AssaultApproachView,
): AssaultRow[] {
  const byCount = roster
    .map((entry, arrivalIndex) => ({ entry, arrivalIndex }))
    .filter(({ entry }) => entry.count > 0)
    .sort((a, b) => b.entry.count - a.entry.count || a.arrivalIndex - b.arrivalIndex);
  const kinds = byCount.map(({ entry }) => assaultKindRows(entry.kind, view));
  return [...kinds.flatMap((rows) => rows.walk), ...kinds.flatMap((rows) => rows.attack)].filter(
    (row) => row.def.states.has(row.state),
  );
}

function requestRow(row: AssaultRow): void {
  prewarmFigureState(row.def, row.state);
}

function touchRow(row: AssaultRow): boolean {
  return touchFigureState(row.def, row.state);
}

function rowFits(row: AssaultRow): boolean {
  return figureRowFitsWithoutEviction(row.def, row.state);
}

/** How the ticker reaches the cache and the roster; each defaults to the real thing. */
export interface AssaultPrewarmHooks {
  /** How one row is queued: the figure cache's paced prewarm. */
  readonly request: (row: AssaultRow) => void;
  /** How one row is kept warm; returns whether it still is. */
  readonly touch: (row: AssaultRow) => boolean;
  /** Whether a row can be baked without evicting anything. */
  readonly fits: (row: AssaultRow) => boolean;
  /**
   * The rest of a wave's roster, after its undead arrival rows: every other
   * figure-drawn kind it brings, facing up its lane. None by default.
   */
  readonly rosterRows: (wave: AssaultWave, view: AssaultApproachView) => readonly AssaultRow[];
}

const NO_ROSTER_ROWS: readonly AssaultRow[] = [];

/**
 * Tick once per gameplay update with the number of the wave coming next, from
 * the start of its lead-in until its spawns have emerged, and `null` otherwise:
 *
 * - wave 1 from the start of the imminent countdown;
 * - waves 2 to 4 from the moment the wave before triggers the advance, through
 *   the lull before them;
 * - `null` once the wave's first spawns are out on every lane it uses. From
 *   then on the rows are drawn by the creatures playing them, which keeps them
 *   warm, and touching the rows nobody draws only competes with the fight.
 *
 * Its undead arrival rows come first, then the rest of the roster's rows
 * (`rosterRows`) facing `view`, all under the same one-row-at-a-time rule.
 */
export class AssaultWavePrewarm {
  private wave: AssaultWave | null = null;
  private view: AssaultApproachView | null = null;
  private rows: readonly AssaultRow[] = [];
  /** How many of the wave's rows have been asked for so far. */
  private next = 0;
  private readonly request: AssaultPrewarmHooks['request'];
  private readonly touch: AssaultPrewarmHooks['touch'];
  private readonly fits: AssaultPrewarmHooks['fits'];
  private readonly rosterRows: AssaultPrewarmHooks['rosterRows'];

  constructor(hooks: Partial<AssaultPrewarmHooks> = {}) {
    this.request = hooks.request ?? requestRow;
    this.touch = hooks.touch ?? touchRow;
    this.fits = hooks.fits ?? rowFits;
    this.rosterRows = hooks.rosterRows ?? (() => NO_ROSTER_ROWS);
  }

  update(wave: AssaultWave | null, view: AssaultApproachView = 'side'): void {
    if (wave === null) {
      this.wave = null;
      return;
    }
    if (wave !== this.wave || view !== this.view) {
      this.wave = wave;
      this.view = view;
      this.rows = [...assaultWaveRows(wave), ...this.rosterRows(wave, view)];
      this.next = 0;
    }
    let firstCold: AssaultRow | null = null;
    for (let i = 0; i < this.next; i++) {
      const held = this.rows[i];
      if (!this.touch(held) && firstCold === null) firstCold = held;
    }
    if (firstCold !== null) {
      // Still queued, or let go by the cache: only this one is asked for
      // again, so a burst of evictions never puts more than one row of the
      // ticker's ahead of the creatures' own staged rows. A request for a row
      // already queued merges with it.
      if (this.fits(firstCold)) this.request(firstCold);
      return;
    }
    if (this.next >= this.rows.length) return;
    const upcoming = this.rows[this.next];
    if (!this.fits(upcoming)) return;
    this.request(upcoming);
    this.next++;
  }
}
