/**
 * Taloncrest's cats as the world shows them: each a small ambient creature
 * with her own look, drawn at the `ambient` row tier. A town cat is never a
 * target and never fights; she sits, grooms, looks about, wanders a few
 * steps round where she lives, and bolts when she is let out of a cage.
 *
 * A cat is placed in one of three ways: caged (sat still in the cage her
 * placer stands her in until she is freed, when she bolts for the point she
 * is given and settles there), bound (sat rigid where a spell holds her, not
 * so much as a twitch of grooming, until she is freed the same way), or at
 * home (wandering a little round the point she is placed on). Which room
 * that is, and when, belongs to whoever places her. At home she can be petted.
 *
 * Moments, not state: nothing here is checkpointed; the placer decides
 * afresh where each cat is on every visit.
 */

import { TILE_SIZE } from '../../core/constants';
import type { BuildingId } from '../../map/buildingIds';
import { WALK_FRAME_SPEED } from '../../Player';
import {
  CatAnimator,
  CatAppearance,
  drawCatSprite,
  type CatOneShot,
  type CatSpriteState,
} from '../../sprites/catSprite';
import { FacingState } from '../../sprites/facingView';
import type { TownInteriorPropId } from '../../sprites/art/townInterior/townInteriorProps';
import type { CatLook } from '../../sprites/looks/catLook';
import { TOWN_CAT_LOOKS } from '../../sprites/looks/cats/townCatLooks';
import type { TownCatId } from '../../core/state/townCatIds';
import type { CritterFloor, WorldPoint } from './ScatterSwarm';

/**
 * Who a town cat is: what her owners call her, the building she lives in, how
 * she is painted, and the furniture in that building she keeps her spot by,
 * in order of preference.
 */
export interface TownCatDef {
  readonly displayName: string;
  readonly home: BuildingId;
  readonly look: CatLook;
  readonly restsBeside: readonly TownInteriorPropId[];
}

/** Every town cat. A cat cannot ship without a name, a home and a look. */
export const TOWN_CATS = {
  taloncrest_inn_cat: {
    displayName: 'Biscuit',
    home: 'taloncrest_inn',
    look: TOWN_CAT_LOOKS.taloncrest_inn_cat,
    restsBeside: ['cat_stool', 'inn_hearth', 'rag_rug'],
  },
  taloncrest_old_lady_cottage_cat: {
    displayName: 'Thimble',
    home: 'taloncrest_old_lady_cottage',
    look: TOWN_CAT_LOOKS.taloncrest_old_lady_cottage_cat,
    restsBeside: ['cat_armchair', 'witch_hearth', 'rug_medium'],
  },
  taloncrest_apothecary_cat: {
    displayName: 'Sage',
    home: 'taloncrest_apothecary',
    look: TOWN_CAT_LOOKS.taloncrest_apothecary_cat,
    restsBeside: ['rug_large', 'potting_bench'],
  },
  taloncrest_flagon_tavern_cat: {
    displayName: 'Barrel',
    home: 'taloncrest_flagon_tavern',
    look: TOWN_CAT_LOOKS.taloncrest_flagon_tavern_cat,
    restsBeside: ['flagon_hearth_rug', 'flagon_hearth'],
  },
  taloncrest_mill_farm_cat: {
    displayName: 'Chaff',
    home: 'taloncrest_mill_farm',
    look: TOWN_CAT_LOOKS.taloncrest_mill_farm_cat,
    restsBeside: ['farm_hearth', 'flour_sack_stack', 'rug_medium'],
  },
  taloncrest_smithy_cat: {
    displayName: 'Cinder',
    home: 'taloncrest_smithy',
    look: TOWN_CAT_LOOKS.taloncrest_smithy_cat,
    restsBeside: ['coal_heap', 'forge'],
  },
  taloncrest_general_store_cat: {
    displayName: 'Penny',
    home: 'taloncrest_general_store',
    look: TOWN_CAT_LOOKS.taloncrest_general_store_cat,
    restsBeside: ['rug_medium', 'store_counter'],
  },
} as const satisfies Record<TownCatId, TownCatDef>;

/** Pixels a frame. A cat about the house ambles; one let out of a cage runs flat out. */
const AMBLE_SPEED = 0.7;
const BOLT_SPEED = 3.6;
/** Her stride turns over faster than her walk's at a bolt, so her paws keep up with the ground. */
const BOLT_STRIDE_SHARE = 2.4;
/** Let out, she stands a beat before she runs: long enough for her bolt's rows to bake. */
const STARTLE_FRAMES = 24;
/** Closer than this to where she is going, she has arrived. */
const ARRIVAL_PX = 2;
/** How far from her home point she wanders, by default. */
const DEFAULT_ROAM_TILES = 2;
/** At home she rests this long, plus up to the random share, between wanders. */
const REST_MIN_FRAMES = 300;
const REST_RANDOM_FRAMES = 600;
/** The share of her rests she spends sat down rather than stood. */
const SIT_SHARE = 0.6;
/** Frames between two pets that each set her washing again. */
const PET_COOLDOWN_FRAMES = 90;
/** How far down her tile her head sits, as a share of a tile: where the hearts rise from. */
const HEAD_HEIGHT_SHARE = 0.45;
/** What she does with a pet: washes the flank she was stroked on. */
const PETTED_ONE_SHOT = 'groom_flank' as const satisfies CatOneShot;

/** Where she is in her life on the map. */
type TownCatMode =
  | { readonly kind: 'caged' }
  | { readonly kind: 'bound' }
  | { readonly kind: 'startled'; readonly to: WorldPoint; framesLeft: number }
  | { readonly kind: 'bolting'; readonly to: WorldPoint }
  | {
      readonly kind: 'home';
      readonly anchor: WorldPoint;
      readonly roamPx: number;
      target: WorldPoint | null;
      restFramesLeft: number;
      sitting: boolean;
    };

/** One town cat on the map. Positions are her tile's top-left, as every creature's are. */
export class TownCat {
  readonly appearance: CatAppearance<'ambient'>;
  x: number;
  y: number;
  private facingX = 0;
  private facingY = 1;
  private isMoving = false;
  private walkFrame = 0;
  private mode: TownCatMode;
  private petCooldownFrames = 0;
  private readonly animator: CatAnimator;
  private readonly facing = new FacingState(this.facingX, this.facingY);

  constructor(
    readonly id: TownCatId,
    at: WorldPoint,
    mode: TownCatMode,
  ) {
    this.x = at.x;
    this.y = at.y;
    this.mode = mode;
    this.appearance = new CatAppearance('ambient', TOWN_CATS[id].look);
    this.animator = new CatAnimator(this.appearance);
    this.appearance.prewarm();
  }

  get displayName(): string {
    return TOWN_CATS[this.id].displayName;
  }

  get isCaged(): boolean {
    return this.mode.kind === 'caged';
  }

  /** Whether she is still bound where she sits, not yet freed. */
  get isBound(): boolean {
    return this.mode.kind === 'bound';
  }

  /** Whether she has been let out and has not yet settled where she was running to. */
  get isRunning(): boolean {
    return this.mode.kind === 'startled' || this.mode.kind === 'bolting';
  }

  /** Whether she is settled about her home, where a crawler may pet her. */
  get isAtHome(): boolean {
    return this.mode.kind === 'home';
  }

  /** World pixel her head is at, for the hearts a pet floats up off her. */
  headAnchor(): WorldPoint {
    return { x: this.x + TILE_SIZE / 2, y: this.y + TILE_SIZE * HEAD_HEIGHT_SHARE };
  }

  /**
   * A crawler at world pixel `from` stroked her. At home she stops where she
   * is, sits, and washes; true when she took it, false away from home or
   * inside the pause after the last pet.
   */
  pet(from: WorldPoint): boolean {
    const mode = this.mode;
    if (mode.kind !== 'home' || this.petCooldownFrames > 0) return false;
    this.petCooldownFrames = PET_COOLDOWN_FRAMES;
    mode.target = null;
    mode.sitting = true;
    mode.restFramesLeft = REST_MIN_FRAMES;
    this.isMoving = false;
    const dx = from.x - this.x;
    const dy = from.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      this.facingX = dx / distance;
      this.facingY = dy / distance;
    }
    this.appearance.prewarmRow(PETTED_ONE_SHOT, true);
    this.animator.play(PETTED_ONE_SHOT);
    return true;
  }

  /** Whether she is held where she sits, in a cage or bound: nothing she does moves her until she is freed. */
  private get held(): boolean {
    return this.mode.kind === 'caged' || this.mode.kind === 'bound';
  }

  /** Lets her out: she starts, then bolts for `to` and settles there, wandering a little round it. */
  free(to: WorldPoint): void {
    if (!this.held) return;
    this.appearance.prewarmCued();
    this.mode = { kind: 'startled', to, framesLeft: STARTLE_FRAMES };
  }

  /** Sends a cat already out of her cage running for `to`, to settle there; nothing while she is held. */
  runTo(to: WorldPoint): void {
    if (this.held) return;
    this.mode = { kind: 'bolting', to };
  }

  update(isFloor: CritterFloor, random: () => number): void {
    this.facing.update(this.facingX, this.facingY);
    if (this.petCooldownFrames > 0) this.petCooldownFrames--;
    const mode = this.mode;
    switch (mode.kind) {
      case 'caged':
        this.isMoving = false;
        break;
      case 'bound':
        // Her animator is left unticked, so no idle break (a groom, a look
        // about) ever starts: a bound cat does not move at all.
        this.isMoving = false;
        return;
      case 'startled':
        this.isMoving = false;
        mode.framesLeft--;
        if (mode.framesLeft <= 0) this.mode = { kind: 'bolting', to: mode.to };
        break;
      case 'bolting':
        if (this.stepToward(mode.to, BOLT_SPEED, isFloor)) {
          this.mode = homeMode(mode.to, DEFAULT_ROAM_TILES * TILE_SIZE);
        }
        break;
      case 'home':
        this.tickHome(mode, isFloor, random);
        break;
      default: {
        const unhandled: never = mode;
        throw new Error(`unhandled town cat mode ${String(unhandled)}`);
      }
    }
    const stride =
      this.mode.kind === 'bolting' ? WALK_FRAME_SPEED * BOLT_STRIDE_SHARE : WALK_FRAME_SPEED;
    if (this.isMoving) this.walkFrame = (this.walkFrame + stride) % (Math.PI * 2);
    this.animator.tick(this.isMoving, false);
  }

  private tickHome(
    mode: Extract<TownCatMode, { kind: 'home' }>,
    isFloor: CritterFloor,
    random: () => number,
  ): void {
    if (this.animator.current?.action === PETTED_ONE_SHOT) {
      this.isMoving = false;
      return;
    }
    if (mode.target !== null) {
      if (this.stepToward(mode.target, AMBLE_SPEED, isFloor)) {
        mode.target = null;
        mode.restFramesLeft = REST_MIN_FRAMES + Math.floor(random() * REST_RANDOM_FRAMES);
        mode.sitting = random() < SIT_SHARE;
      }
      return;
    }
    this.isMoving = false;
    mode.restFramesLeft--;
    if (mode.restFramesLeft > 0) return;
    const angle = random() * Math.PI * 2;
    const reach = random() * mode.roamPx;
    mode.sitting = false;
    mode.target = {
      x: mode.anchor.x + Math.cos(angle) * reach,
      y: mode.anchor.y + Math.sin(angle) * reach,
    };
  }

  /**
   * Moves her up to `speed` toward `to`; true once she is there. A step onto
   * ground that is not floor ends the walk where she stands, which is as far
   * as a cat goes looking for a way round.
   */
  private stepToward(to: WorldPoint, speed: number, isFloor: CritterFloor): boolean {
    const dx = to.x - this.x;
    const dy = to.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVAL_PX) {
      this.isMoving = false;
      return true;
    }
    const step = Math.min(speed, distance);
    const nextX = this.x + (dx / distance) * step;
    const nextY = this.y + (dy / distance) * step;
    const tileCentre = TILE_SIZE / 2;
    const nextTileX = Math.floor((nextX + tileCentre) / TILE_SIZE);
    const nextTileY = Math.floor((nextY + tileCentre) / TILE_SIZE);
    this.facingX = dx / distance;
    this.facingY = dy / distance;
    if (!isFloor(nextTileX, nextTileY)) {
      this.isMoving = false;
      return true;
    }
    this.x = nextX;
    this.y = nextY;
    this.isMoving = true;
    return false;
  }

  private spriteState(): CatSpriteState {
    const mode = this.mode;
    return {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facing: this.facing.peek(this.facingX, this.facingY),
      oneShot: this.animator.current,
      sitting: this.held || (mode.kind === 'home' && mode.sitting),
      scampering: mode.kind === 'bolting',
    };
  }

  /**
   * Paints her; positions are world pixels. A caged cat is drawn sitting
   * still, and the cage round her is the placed prop her placer stands her in.
   */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const state = this.spriteState();
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawCatSprite(ctx, this.appearance, sx, sy, tileSize, this.appearance.cellFor(state), state);
  }

  /** Drops her cells from the cache, for a cat leaving the scene. */
  release(): void {
    this.appearance.release();
  }
}

function homeMode(anchor: WorldPoint, roamPx: number): TownCatMode {
  return {
    kind: 'home',
    anchor,
    roamPx,
    target: null,
    restFramesLeft: REST_MIN_FRAMES,
    sitting: true,
  };
}

/**
 * Every town cat in one scene: the placer's handle on them. A scene ticks
 * {@link update} once a frame and draws each cat from {@link cats} in its
 * depth order, as it draws its other creatures.
 */
export class TownCats {
  private readonly byId = new Map<TownCatId, TownCat>();

  constructor(
    private readonly isFloor: CritterFloor,
    private readonly random: () => number,
  ) {}

  /** Sits `id` in a cage whose tile's top-left is `at`. Replaces her if she is already placed. */
  placeCaged(id: TownCatId, at: WorldPoint): TownCat {
    return this.place(new TownCat(id, at, { kind: 'caged' }));
  }

  /** Sits `id` bound at `at`, a tile's top-left, rigid until she is freed. Replaces her if she is already placed. */
  placeBound(id: TownCatId, at: WorldPoint): TownCat {
    return this.place(new TownCat(id, at, { kind: 'bound' }));
  }

  /** Puts `id` at `at`, wandering up to `roamTiles` round it. Replaces her if she is already placed. */
  placeAtHome(id: TownCatId, at: WorldPoint, roamTiles = DEFAULT_ROAM_TILES): TownCat {
    return this.place(new TownCat(id, at, homeMode(at, roamTiles * TILE_SIZE)));
  }

  /** Lets `id` out of her cage, to bolt for `to`; nothing if she is not caged here. */
  free(id: TownCatId, to: WorldPoint): void {
    this.byId.get(id)?.free(to);
  }

  cat(id: TownCatId): TownCat | null {
    return this.byId.get(id) ?? null;
  }

  get cats(): readonly TownCat[] {
    return [...this.byId.values()];
  }

  remove(id: TownCatId): void {
    this.byId.get(id)?.release();
    this.byId.delete(id);
  }

  update(): void {
    for (const cat of this.byId.values()) cat.update(this.isFloor, this.random);
  }

  clear(): void {
    for (const cat of this.byId.values()) cat.release();
    this.byId.clear();
  }

  private place(cat: TownCat): TownCat {
    this.remove(cat.id);
    this.byId.set(cat.id, cat);
    return cat;
  }
}
