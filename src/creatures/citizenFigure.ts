/**
 * The one place a citizen's species picks which cast paints it.
 *
 * `Townsperson` never reads `TownCastLook` or `SkyfowlLook` directly — it asks
 * this module for a `CitizenFigure` once at construction and draws through
 * `drawCitizenSprite` every frame. Adding a third species means adding a case
 * here and nowhere else in `Townsperson` itself (its wander, facing hysteresis
 * and cadence logic stay species-agnostic, same as before this axis existed).
 */

import type { DrawnFigureRow } from '../sprites/figure/figureDef';
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
  pinSkyfowlCastMember,
  prewarmAndPinSkyfowlTalk,
  prewarmSkyfowlCastMember,
} from '../sprites/skyfowlCastSprite';
import {
  pinTownCastLook,
  prewarmAndPinTownCastTalk,
  prewarmTownCastLook,
} from '../sprites/townCastSprite';
import type { TownSpecies } from '../systems/townSpecies';
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

const SKYFOWL_LOOKS_BY_ROLE = new Map<SkyfowlRole, readonly SkyfowlLook[]>();
for (const look of SKYFOWL_CIVILIAN_LOOKS) {
  const existing = SKYFOWL_LOOKS_BY_ROLE.get(look.role) ?? [];
  SKYFOWL_LOOKS_BY_ROLE.set(look.role, [...existing, look]);
}

/** Salt for the skyfowl picker's own stream — kept distinct from the human cast's. */
const SKYFOWL_LOOK_PICK_SALT = 0x5c1fa7;

function pickSkyfowlLook(seed: number, role: TownRole): SkyfowlLook {
  const wanted = SKYFOWL_ROLE_FOR_TOWN_ROLE[role];
  const pool = SKYFOWL_LOOKS_BY_ROLE.get(wanted) ?? SKYFOWL_CIVILIAN_LOOKS;
  const rng = mulberry32(subSeed(seed, SKYFOWL_LOOK_PICK_SALT));
  return pick(rng, pool);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Deterministically picks the figure a citizen paints with, from its own
 * appearance seed, job and species. The only draw from randomness here is the
 * citizen's own seed (already spent on it before this axis existed) — no
 * extra draw against the world's own RNG stream.
 */
export function pickCitizenFigure(
  seed: number,
  role: TownRole,
  species: TownSpecies,
): CitizenFigure {
  if (species === 'skyfowl') return { species: 'skyfowl', look: pickSkyfowlLook(seed, role) };
  return { species: 'human', look: pickTownCastLook(seed, role) };
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

/**
 * Warms a citizen's figure ahead of its first draw, whichever cast it belongs
 * to — the one dispatch point every constructor that hands out a
 * `CitizenFigure` calls, so a look's cells are queued on the cache's own
 * time-sliced prewarm budget instead of paid for in the frame that first
 * draws it.
 */
export function prewarmCitizenFigure(figure: CitizenFigure): void {
  if (figure.species === 'skyfowl') {
    prewarmSkyfowlCastMember(figure.look.id);
    return;
  }
  prewarmTownCastLook(figure.look);
}

/**
 * Exempts a citizen's figure from the cache's idle-release sweep — the other
 * half of keeping a strolling crowd's own working set resident for as long as
 * the scene that spawned it stays active. Pinning ahead of the row actually
 * baking is fine; it grants no admission of its own.
 */
export function pinCitizenFigure(figure: CitizenFigure): void {
  if (figure.species === 'skyfowl') {
    pinSkyfowlCastMember(figure.look.id);
    return;
  }
  pinTownCastLook(figure.look);
}

/**
 * Warms and pins a citizen's `talk` row in the facing it is about to be drawn
 * in. Call this the moment a citizen is frozen into a conversation (dialog
 * opening sites in `DungeonScene`/`BuildingInteriorScene`, right after
 * `faceToward` fixes the facing this row bakes for) — never as part of
 * {@link pinCitizenFigure} itself, which only ever warms `idle`/`walk`. Without
 * this call a frozen citizen's `talk` state is never baked at all, so the one
 * person a player is looking straight at forever shows an approximate
 * idle/walk stand-in instead of ever actually talking.
 */
export function prewarmAndPinCitizenTalk(
  figure: CitizenFigure,
  facingX: number,
  facingY: number,
): void {
  if (figure.species === 'skyfowl') {
    prewarmAndPinSkyfowlTalk(figure.look.id, facingX, facingY);
    return;
  }
  prewarmAndPinTownCastTalk(figure.look, facingX, facingY);
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
