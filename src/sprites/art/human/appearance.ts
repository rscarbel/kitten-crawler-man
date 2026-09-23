/**
 * What Carl is seen wearing, and the figure each outfit is painted as.
 *
 * A cached cell is keyed by figure, state and frame and shared by every draw,
 * so gear cannot be a parameter of one draw: each combination of the closed
 * set of visible gear is a figure of its own, painted from the same rows. Only
 * one Carl exists, so only one of these is ever resident — the runtime swaps
 * the figure it draws when his equipment changes and releases the old one.
 */

import { type CarlGear, type GauntletForm } from '../carl/gear';
import { type CarlPose } from '../carl/rig';
import { type FigureDef } from '../../figure/figureDef';
import {
  firstImpactFrame,
  HUMAN_FIGURE,
  HUMAN_ROWS,
  type HumanRowName,
  paintDressedHumanFrame,
  type RowSpec,
} from '../humanFigure';

/** Every piece of gear that changes how he is painted. */
export const HUMAN_APPEARANCE_FLAGS = [
  'gauntlet',
  'cloak',
  'trollskinShirt',
  'toeRing',
  'pedicure',
] as const;

type HumanAppearanceFlag = (typeof HUMAN_APPEARANCE_FLAGS)[number];

/** Which visible gear he has on. */
export type HumanAppearance = Readonly<Record<HumanAppearanceFlag, boolean>>;

/**
 * The look every row was authored and reviewed in: the trollskin shirt and
 * nothing else. It is painted by `HUMAN_FIGURE` itself.
 */
export const DEFAULT_HUMAN_APPEARANCE: HumanAppearance = {
  gauntlet: false,
  cloak: false,
  trollskinShirt: true,
  toeRing: false,
  pedicure: false,
};

/** No visible gear at all: how a new game's Carl starts, before any loot. */
export const BARE_HUMAN_APPEARANCE: HumanAppearance = {
  gauntlet: false,
  cloak: false,
  trollskinShirt: false,
  toeRing: false,
  pedicure: false,
};

/** A stable name for an outfit: the flags it has on, in declaration order. */
export function humanAppearanceKey(appearance: HumanAppearance): string {
  const worn = HUMAN_APPEARANCE_FLAGS.filter((flag) => appearance[flag]);
  return worn.length === 0 ? 'bare' : worn.join('+');
}

export function sameHumanAppearance(a: HumanAppearance, b: HumanAppearance): boolean {
  return HUMAN_APPEARANCE_FLAGS.every((flag) => a[flag] === b[flag]);
}

// ── The gauntlet's fist ──────────────────────────────────────────────────────

/** The steel stands round the fist from the frame before the blow lands to the one after. */
const SPIKED_BEFORE_IMPACT = 1;
const SPIKED_AFTER_IMPACT = 1;
/** One frame after that it goes up in smoke, and the frame after that the smoke thins away. */
const SMOKE_AFTER_IMPACT = SPIKED_AFTER_IMPACT + 1;
const WISP_AFTER_IMPACT = SMOKE_AFTER_IMPACT + 1;

/**
 * Whether a row is a punch his right fist lands, as its strike metadata names
 * the limb. The art gates hold that name to the rig: the named fist is the one
 * driven furthest on the impact frame.
 */
function rightFistLandsBlow(row: RowSpec): boolean {
  const strike = row.strike;
  if (row.role !== 'strike' || strike === undefined) return false;
  return strike.tags.includes('punch') && strike.reachLimb === 'hand';
}

const RIGHT_PUNCH_ROWS: ReadonlySet<HumanRowName> = new Set(
  HUMAN_ROWS.filter(rightFistLandsBlow).map((row) => row.name),
);

/**
 * The rows on which the gauntlet turns to spiked steel round his right fist.
 * The art gates hold it to a non-empty set with the cross in it.
 */
export const HUMAN_RIGHT_PUNCH_ROWS: readonly HumanRowName[] = [...RIGHT_PUNCH_ROWS];

/** What the gauntlet is on one frame of one row. */
export function gauntletFormAt(row: RowSpec, frame: number): GauntletForm {
  const impact = firstImpactFrame(row);
  if (impact === undefined || !RIGHT_PUNCH_ROWS.has(row.name)) return 'bracer';
  const fromImpact = frame - impact;
  if (fromImpact >= -SPIKED_BEFORE_IMPACT && fromImpact <= SPIKED_AFTER_IMPACT) return 'spiked';
  if (fromImpact === SMOKE_AFTER_IMPACT) return 'smoke';
  if (fromImpact === WISP_AFTER_IMPACT) return 'wisp';
  return 'bracer';
}

// ── The cloak's drag ─────────────────────────────────────────────────────────

/** A walk drags the cloak back less than a run. */
const WALK_STREAM = 0.35;
const RUN_STREAM = 1;

/** How hard his travel pushes the cloak back on a row: by its gait, and not at all standing. */
function cloakStreamOf(row: RowSpec): number {
  if (row.locomotion !== 'travelling') return 0;
  const gait = row.gait ?? row.bridges;
  return gait === 'walk' ? WALK_STREAM : RUN_STREAM;
}

// ── Figures ──────────────────────────────────────────────────────────────────

function gearFor(appearance: HumanAppearance, row: RowSpec, frame: number): CarlGear {
  return {
    gauntlet: appearance.gauntlet ? gauntletFormAt(row, frame) : undefined,
    cloak: appearance.cloak,
    trollskinShirt: appearance.trollskinShirt,
    toeRing: appearance.toeRing,
    pedicure: appearance.pedicure,
    cloakStream: appearance.cloak ? cloakStreamOf(row) : 0,
  };
}

/**
 * A row's pose as it is painted in `appearance`: the gear that outfit wears on
 * that frame laid onto it. For gates that pose a cell themselves.
 */
export function dressedPose(
  appearance: HumanAppearance,
  pose: CarlPose,
  row: RowSpec,
  frame: number,
): CarlPose {
  return { ...pose, gear: gearFor(appearance, row, frame) };
}

const DEFAULT_KEY = humanAppearanceKey(DEFAULT_HUMAN_APPEARANCE);

/**
 * Built on first use rather than all up front: a `FigureDef` costs nothing
 * resident, but most outfits are never worn in a session.
 */
const figuresByKey = new Map<string, FigureDef>();

/**
 * The figure Carl is painted as in `appearance`. The default outfit is
 * `HUMAN_FIGURE` itself; every other shares its rows, cell and budget and
 * differs only in its id and in the gear laid on each pose.
 */
export function humanFigureWearing(appearance: HumanAppearance): FigureDef {
  const key = humanAppearanceKey(appearance);
  if (key === DEFAULT_KEY) return HUMAN_FIGURE;
  const known = figuresByKey.get(key);
  if (known !== undefined) return known;
  const dress = (pose: CarlPose, row: RowSpec, frame: number): CarlPose =>
    dressedPose(appearance, pose, row, frame);
  const figure: FigureDef = {
    ...HUMAN_FIGURE,
    id: `${HUMAN_FIGURE.id}:${key}`,
    paintFrame: (ctx, state, frame) => paintDressedHumanFrame(ctx, state, frame, dress),
  };
  figuresByKey.set(key, figure);
  return figure;
}

/** Parses a `+`-joined list of flags, as {@link humanAppearanceKey} writes it, for harnesses. */
export function parseHumanAppearance(spec: string): HumanAppearance | null {
  const names = spec === 'bare' ? [] : spec.split('+');
  const flags = new Set<string>(names);
  if (![...flags].every((name) => HUMAN_APPEARANCE_FLAGS.some((flag) => flag === name))) {
    return null;
  }
  return {
    gauntlet: flags.has('gauntlet'),
    cloak: flags.has('cloak'),
    trollskinShirt: flags.has('trollskinShirt'),
    toeRing: flags.has('toeRing'),
    pedicure: flags.has('pedicure'),
  };
}
