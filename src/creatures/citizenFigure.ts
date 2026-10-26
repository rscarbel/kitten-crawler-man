/**
 * The one place a citizen's species picks which cast paints it.
 *
 * `Townsperson` never reads `TownCastLook` or `SkyfowlLook` directly — it asks
 * this module for a `CitizenFigure` at construction, and again only after a
 * purged canvas recovery, and draws through `drawCitizenSprite` every frame.
 * Adding a third species means adding a case here and nowhere else in
 * `Townsperson` itself, whose wander, facing hysteresis and cadence logic are
 * species-agnostic.
 */

import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { pinFigureState, unpinFigureState } from '../sprites/figure/figureFrameCache';
import { mulberry32, pick, subSeed } from '../sprites/person/rng';
import type { TownRole } from '../sprites/person/PersonAppearance';
import { pickTownCastLook, type TownCastLook } from '../sprites/person/townCastLooks';
import { drawTownCastSprite, type TownCastSpriteState } from '../sprites/townCastSprite';
import {
  SKYFOWL_CIVILIAN_LOOKS,
  type SkyfowlLook,
  type SkyfowlRole,
} from '../sprites/art/skyfowl/cast';
import {
  drawSkyfowlCastSprite,
  prewarmAndPinSkyfowlTalk,
  prewarmSkyfowlCastMember,
  skyfowlCastMemberRows,
} from '../sprites/skyfowlCastSprite';
import {
  prewarmAndPinTownCastTalk,
  prewarmTownCastLook,
  townCastLookRows,
} from '../sprites/townCastSprite';
import type { TownSpecies } from '../systems/townSpecies';
import { VARIETY_TIERS, varietyTier, type VarietyTier } from '../core/perf/varietyTier';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import {
  WALK_FRAMES as SKYFOWL_WALK_FRAMES,
  skyfowlWalkCyclePx,
} from '../sprites/art/skyfowlCastFigure';
import { WALK_FRAMES as HUMAN_WALK_FRAMES } from '../sprites/art/townCastFrameCounts';
import { HUMANOID_NPC_SCALE } from '../sprites/humanoidScale';

export type CitizenFigure =
  | { readonly species: 'human'; readonly look: TownCastLook }
  | { readonly species: 'skyfowl'; readonly look: SkyfowlLook };

/** What a citizen can be doing, as far as either cast's sprite wrapper is concerned. */
export type CitizenAction = 'idle' | 'walk' | 'talk' | 'work';

export interface CitizenSpriteState {
  readonly action: CitizenAction;
  /** Walk-cycle position in strides, wrapped to one cycle. */
  readonly walkPhase: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly loopOffsetSeconds?: number;
}

// ── Skyfowl role bucketing ───────────────────────────────────────────────────

/**
 * Buckets a citizen's job onto the skyfowl look set's own (narrower) role
 * vocabulary. `farmer`/`smith` read as outdoor hand-labour, `innkeeper` as a
 * trade with a counter, `drunk`/`beggar`/`commoner` as the plainest, most
 * numerous street look — the sparrow-fleck porter, the crowd's default face.
 */
const SKYFOWL_ROLE_FOR_TOWN_ROLE: Record<TownRole, SkyfowlRole> = {
  guard: 'guard',
  merchant: 'merchant',
  farmer: 'laborer',
  smith: 'laborer',
  innkeeper: 'merchant',
  priest: 'temple',
  child: 'fledgling',
  drunk: 'porter',
  noble: 'noble',
  beggar: 'porter',
  laborer: 'laborer',
  commoner: 'porter',
};

const STREET_SKYFOWL_ROLES: ReadonlySet<SkyfowlRole> = new Set(
  Object.values(SKYFOWL_ROLE_FOR_TOWN_ROLE),
);

/**
 * The civilian looks in the order a variety tier keeps them, a tier that keeps
 * N keeping the first N: the first look of each role a street citizen can
 * hold, in authored order, then every other look in authored order. A trimmed
 * set therefore keeps one look per street role for as long as it has room.
 */
const SKYFOWL_LOOK_KEEP_ORDER: readonly SkyfowlLook[] = (() => {
  const leads: SkyfowlLook[] = [];
  const ledRoles = new Set<SkyfowlRole>();
  for (const look of SKYFOWL_CIVILIAN_LOOKS) {
    if (!STREET_SKYFOWL_ROLES.has(look.role) || ledRoles.has(look.role)) continue;
    ledRoles.add(look.role);
    leads.push(look);
  }
  const rest = SKYFOWL_CIVILIAN_LOOKS.filter((look) => !leads.includes(look));
  return [...leads, ...rest];
})();

/** Each variety tier keeps this share of the tier above's skyfowl street looks. */
const SKYFOWL_LOOKS_KEPT_PER_TIER_STEP = 0.5;
const AT_LEAST_ONE_LOOK = 1;

/** How many skyfowl civilian looks the street wears at `tier`. */
export function skyfowlStreetLookAllowance(tier: VarietyTier): number {
  const kept = Math.ceil(SKYFOWL_CIVILIAN_LOOKS.length * SKYFOWL_LOOKS_KEPT_PER_TIER_STEP ** tier);
  return Math.max(AT_LEAST_ONE_LOOK, kept);
}

/**
 * A uniform says what its wearer does, so a citizen whose own role has no look
 * left at a tier borrows a plain one rather than a guard's armour.
 */
const UNIFORMED_SKYFOWL_ROLES: ReadonlySet<SkyfowlRole> = new Set<SkyfowlRole>(['guard']);

interface SkyfowlTierPools {
  readonly byRole: ReadonlyMap<SkyfowlRole, readonly SkyfowlLook[]>;
  /** What a role with no look of its own at this tier wears. */
  readonly borrowed: readonly SkyfowlLook[];
}

function skyfowlTierPools(tier: VarietyTier): SkyfowlTierPools {
  const kept = SKYFOWL_LOOK_KEEP_ORDER.slice(0, skyfowlStreetLookAllowance(tier));
  const byRole = new Map<SkyfowlRole, readonly SkyfowlLook[]>();
  for (const look of kept) byRole.set(look.role, [...(byRole.get(look.role) ?? []), look]);
  const plain = kept.filter((look) => !UNIFORMED_SKYFOWL_ROLES.has(look.role));
  return { byRole, borrowed: plain.length > 0 ? plain : kept };
}

const SKYFOWL_POOLS_BY_TIER: ReadonlyMap<VarietyTier, SkyfowlTierPools> = new Map(
  VARIETY_TIERS.map((tier) => [tier, skyfowlTierPools(tier)]),
);

/** Salt for the skyfowl picker's own stream — kept distinct from the human cast's. */
const SKYFOWL_LOOK_PICK_SALT = 0x5c1fa7;

function pickSkyfowlLook(seed: number, role: TownRole, tier: VarietyTier): SkyfowlLook {
  const pools = SKYFOWL_POOLS_BY_TIER.get(tier) ?? skyfowlTierPools(tier);
  const pool = pools.byRole.get(SKYFOWL_ROLE_FOR_TOWN_ROLE[role]) ?? pools.borrowed;
  const rng = mulberry32(subSeed(seed, SKYFOWL_LOOK_PICK_SALT));
  return pick(rng, pool);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Deterministically picks the figure a citizen paints with, from its own
 * appearance seed, job and species, out of the looks the street wears at
 * variety `tier`. The only draw from randomness here is the citizen's own
 * seed — no extra draw against the world's own RNG stream.
 */
export function pickCitizenFigure(
  seed: number,
  role: TownRole,
  species: TownSpecies,
  tier: VarietyTier = varietyTier(),
): CitizenFigure {
  if (species === 'skyfowl') {
    return { species: 'skyfowl', look: pickSkyfowlLook(seed, role, tier) };
  }
  return { species: 'human', look: pickTownCastLook(seed, role, tier) };
}

/**
 * World pixels one walk cycle covers for a citizen drawn at `tileSize` — the
 * ground its planted foot sweeps, carried through the size the figure is
 * actually drawn at. The skyfowl cast derives it from its own gait's foot
 * placement; the human cast carries it on the look as a share of the
 * humanoid-scaled draw box it paints into.
 */
export function citizenWalkCyclePx(figure: CitizenFigure, tileSize: number): number {
  if (figure.species === 'skyfowl') return skyfowlWalkCyclePx(figure.look.id, tileSize);
  return figure.look.strideFraction * tileSize * HUMANOID_NPC_SCALE;
}

/** Frames in a citizen's walk row: the most one tick may advance it is one of them. */
export function citizenWalkFrames(figure: CitizenFigure): number {
  return figure.species === 'skyfowl' ? SKYFOWL_WALK_FRAMES : HUMAN_WALK_FRAMES;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A tiny string hash — just enough to derive a stable id from a look's own name. */
function fnv1a(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A stable, look-scoped seed for dialog line rotation — shared by every
 * citizen wearing this look, the same way its cells are. The human cast
 * already carries one (`TownCastLook.dialogSeed`); the skyfowl cast has no
 * such field, so one is derived from its look id instead of adding a field
 * that only this caller would read.
 */
export function citizenDialogSeed(figure: CitizenFigure): number {
  return figure.species === 'skyfowl' ? fnv1a(figure.look.id) : figure.look.dialogSeed;
}

const SKYFOWL_ELDER_ROLES: ReadonlySet<SkyfowlRole> = new Set<SkyfowlRole>(['temple', 'clerk']);

function skyfowlSpeechStyle(role: SkyfowlRole): CitizenSpeechStyle {
  if (role === 'fledgling') return 'townsfolkSkyfowlFledgling';
  if (SKYFOWL_ELDER_ROLES.has(role)) return 'townsfolkSkyfowlElder';
  return 'townsfolkSkyfowl';
}

/** The dialog style a citizen speaks in: their species' voice, and for a human the one their look is painted for. */
export function citizenSpeechStyle(figure: CitizenFigure): CitizenSpeechStyle {
  if (figure.species === 'skyfowl') return skyfowlSpeechStyle(figure.look.role);
  return figure.look.feminine ? 'townsfolkFeminine' : 'townsfolkMasculine';
}

/**
 * Warms a citizen's figure ahead of its first draw, whichever cast it belongs
 * to, for an owner that does not hold its citizens by distance: a look's
 * cells are queued on the cache's own time-sliced prewarm budget instead of
 * paid for in the frame that first draws it.
 */
export function prewarmCitizenFigure(figure: CitizenFigure): void {
  if (figure.species === 'skyfowl') {
    prewarmSkyfowlCastMember(figure.look.id);
    return;
  }
  prewarmTownCastLook(figure.look);
}

/**
 * The idle and walk rows of a citizen's look in every facing, which every
 * citizen wearing it shares: what a crowd holds of each look.
 */
export function citizenFigureRows(figure: CitizenFigure): DrawnFigureRow[] {
  if (figure.species === 'skyfowl') return skyfowlCastMemberRows(figure.look.id);
  return townCastLookRows(figure.look);
}

/**
 * Exempts a look's {@link citizenFigureRows} from the cache's idle sweep and
 * eviction, for as long as a citizen wearing it may walk into view. Pinning
 * ahead of the rows baking is fine; it grants no admission of its own.
 */
export function pinCitizenFigure(figure: CitizenFigure): void {
  for (const row of citizenFigureRows(figure)) pinFigureState(row.def, row.state);
}

/** Undoes {@link pinCitizenFigure}, so the idle sweep returns the look's rows once undrawn. */
export function unpinCitizenFigure(figure: CitizenFigure): void {
  for (const row of citizenFigureRows(figure)) unpinFigureState(row.def, row.state);
}

/** Names a citizen's look: citizens wearing the same one share every row. */
export function citizenLookKey(figure: CitizenFigure): string {
  return `${figure.species}:${figure.look.id}`;
}

/**
 * Warms and pins a citizen's `talk` row in the facing it is about to be drawn
 * in, returning the row for {@link unpinCitizenTalk} once the conversation
 * ends. Call this the moment a citizen is frozen into a conversation, after
 * `faceToward` fixes the facing this row bakes for. A crowd holds only a
 * look's idle and walk rows, so without this a frozen citizen's `talk` state
 * is never baked at all, and the one person a player is looking straight at
 * shows an approximate idle/walk stand-in instead of talking.
 */
export function prewarmAndPinCitizenTalk(
  figure: CitizenFigure,
  facingX: number,
  facingY: number,
): DrawnFigureRow {
  if (figure.species === 'skyfowl') {
    return prewarmAndPinSkyfowlTalk(figure.look.id, facingX, facingY);
  }
  return prewarmAndPinTownCastTalk(figure.look, facingX, facingY);
}

/** Undoes {@link prewarmAndPinCitizenTalk}, so the idle sweep returns the row once undrawn. */
export function unpinCitizenTalk(row: DrawnFigureRow): void {
  unpinFigureState(row.def, row.state);
}

/** Draws one citizen through whichever cast its figure belongs to, returning the row drawn. */
export function drawCitizenSprite(
  ctx: CanvasRenderingContext2D,
  figure: CitizenFigure,
  sx: number,
  sy: number,
  tileSize: number,
  state: CitizenSpriteState,
): DrawnFigureRow | undefined {
  if (figure.species === 'skyfowl') {
    return drawSkyfowlCastSprite(ctx, figure.look.id, sx, sy, tileSize, state);
  }
  const humanState: TownCastSpriteState = state;
  return drawTownCastSprite(ctx, figure.look, sx, sy, tileSize, humanState, true);
}
