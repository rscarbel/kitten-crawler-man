import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import type { SystemContext } from '../GameSystem';
import type { GroundHazardSource } from '../GroundHazardSource';
import { JuicerRoomSystem } from '../JuicerRoomSystem';
import type {
  BossRoomDressing,
  BossRoomFightListener,
  DressingRenderable,
} from './BossRoomDressing';
import type { BossRoomDressingCheckpoint } from './bossRoomDressingCheckpoint';
import { ColosseumDressingSystem } from './ColosseumDressingSystem';
import { HoarderRoomSystem } from './HoarderRoomSystem';
import { KrakarenRoomSystem } from './KrakarenRoomSystem';
import type { SpiderLabDressing } from './SpiderLabDressing';

/** The boss-type ids from `levelDef.bossRooms[].type` that own a rectangular boss room. */
export const HOARDER_BOSS_TYPE = 'the_hoarder';
export const JUICER_BOSS_TYPE = 'juicer';
export const KRAKAREN_BOSS_TYPE = 'krakaren_clone';

/**
 * Every room dressing on a floor, each null where the floor has no such room.
 *
 * Named fields rather than one list because each room's checkpoint has its own
 * type: a list could only snapshot them as `unknown`.
 */
export interface BossRoomDressingParts {
  hoarder: HoarderRoomSystem | null;
  juicer: JuicerRoomSystem | null;
  krakaren: KrakarenRoomSystem | null;
  spiderLab: SpiderLabDressing | null;
  colosseum: ColosseumDressingSystem | null;
}

/** Which bosses are already dead, for {@link BossRoomDressings.replayDefeats}. */
export interface BossRoomDefeats {
  /** Gauntlet boss types whose rooms are won, as `BossRoomSystem.defeatedBossTypes` reports them. */
  gauntletBossTypes: ReadonlySet<string>;
  spiderLab: boolean;
  colosseum: boolean;
}

/**
 * Builds the dressing for every gauntlet boss room on the map, found by boss
 * type. Never by position in the list: which index a boss lands on is the
 * level definition's order, and a hard-coded index hands one boss's room to
 * another's system the moment that order changes.
 */
export function buildGauntletRoomDressings(
  gameMap: GameMap,
  bossTypes: readonly string[],
): Pick<BossRoomDressingParts, 'hoarder' | 'krakaren'> & { juicer: JuicerRoomSystem } {
  const boundsOf = (bossType: string): GameMap['bossRooms'][number]['bounds'] | undefined => {
    const index = bossTypes.indexOf(bossType);
    const roomExists = index >= 0 && index < gameMap.bossRooms.length;
    return roomExists ? gameMap.bossRooms[index].bounds : undefined;
  };
  const hoarderBounds = boundsOf(HOARDER_BOSS_TYPE);
  const juicerIndex = bossTypes.indexOf(JUICER_BOSS_TYPE);
  const juicerRoomExists = juicerIndex >= 0 && juicerIndex < gameMap.bossRooms.length;
  const krakarenBounds = boundsOf(KRAKAREN_BOSS_TYPE);
  return {
    hoarder: hoarderBounds === undefined ? null : new HoarderRoomSystem(gameMap, hoarderBounds),
    // Built even on a floor with no gym: it stands inert without bounds, and the
    // scene reads its camera shake every frame.
    juicer: new JuicerRoomSystem(juicerRoomExists ? gameMap : null, juicerIndex),
    krakaren: krakarenBounds === undefined ? null : new KrakarenRoomSystem(gameMap, krakarenBounds),
  };
}

/**
 * The colosseum's dressing, or null on a floor with no arena. The first arena
 * only, matching `ArenaSystem`, which runs the fight in no other.
 */
export function buildColosseumDressing(gameMap: GameMap): ColosseumDressingSystem | null {
  if (gameMap.arenaExteriors.length === 0) return null;
  return new ColosseumDressingSystem(gameMap, gameMap.arenaExteriors[0]);
}

/**
 * Every boss room's dressing on the floor, driven as one: the scene updates,
 * draws, checkpoints and offers Space presses to this, and each room's fight
 * owner announces its turns to the room's own dressing.
 *
 * One hazard source for all of them, registered once with each registry, so a
 * room added later is seen by companions and mob tactics without new wiring.
 */
export class BossRoomDressings implements GroundHazardSource, BossRoomFightListener {
  private readonly all: BossRoomDressing[];
  /** Indexed like `gameMap.bossRooms`; null where a room has no dressing. */
  private readonly byBossRoomIndex: Array<BossRoomDressing | null>;
  private readonly entityScratch: DressingRenderable[] = [];

  constructor(
    readonly parts: BossRoomDressingParts,
    private readonly bossTypes: readonly string[],
  ) {
    this.all = [
      parts.hoarder,
      parts.juicer,
      parts.krakaren,
      parts.spiderLab,
      parts.colosseum,
    ].filter((dressing): dressing is NonNullable<typeof dressing> => dressing !== null);
    this.byBossRoomIndex = bossTypes.map((bossType) => {
      if (bossType === HOARDER_BOSS_TYPE) return parts.hoarder;
      if (bossType === JUICER_BOSS_TYPE) return parts.juicer;
      if (bossType === KRAKAREN_BOSS_TYPE) return parts.krakaren;
      return null;
    });
  }

  onSeal(roomIndex: number): void {
    this.byBossRoomIndex[roomIndex]?.onSeal();
  }

  onBossDefeated(roomIndex: number): void {
    this.byBossRoomIndex[roomIndex]?.onBossDefeated();
  }

  onFightAborted(roomIndex: number): void {
    this.byBossRoomIndex[roomIndex]?.onFightAborted();
  }

  /**
   * Tells every room whose boss is already dead that it was won. A room built
   * after its kill — a dev preset that skips the boss, a floor rebuilt from a
   * save, a save older than the dressings — never heard the kill itself.
   * Safe to repeat: `onBossDefeated` is idempotent by contract.
   */
  replayDefeats(dead: BossRoomDefeats): void {
    this.bossTypes.forEach((bossType, roomIndex) => {
      if (dead.gauntletBossTypes.has(bossType)) this.onBossDefeated(roomIndex);
    });
    if (dead.spiderLab) this.parts.spiderLab?.onBossDefeated();
    if (dead.colosseum) this.parts.colosseum?.onBossDefeated();
  }

  update(ctx: SystemContext): void {
    for (const dressing of this.all) dressing.update(ctx);
  }

  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    for (const dressing of this.all) dressing.renderGround(ctx, camX, camY, active);
  }

  /** Every room's Y-sorted objects this frame, in one reused list. */
  renderEntities(): ReadonlyArray<DressingRenderable> {
    this.entityScratch.length = 0;
    for (const dressing of this.all) {
      for (const renderable of dressing.renderEntities()) this.entityScratch.push(renderable);
    }
    return this.entityScratch;
  }

  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dressing of this.all) dressing.renderAbove(ctx, camX, camY);
  }

  tryInteract(player: HumanPlayer | CatPlayer): boolean {
    return this.all.some((dressing) => dressing.tryInteract(player));
  }

  resetForCheckpoint(): void {
    for (const dressing of this.all) dressing.resetForCheckpoint();
  }

  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    for (const dressing of this.all) {
      const escape = dressing.getHazardEscapeVector(x, y);
      if (escape !== null) return escape;
    }
    return null;
  }

  captureCheckpoint(): BossRoomDressingCheckpoint {
    const { hoarder, juicer, krakaren, spiderLab, colosseum } = this.parts;
    return {
      hoarder: hoarder?.captureCheckpoint() ?? null,
      juicer: juicer?.captureCheckpoint() ?? null,
      krakaren: krakaren?.captureCheckpoint() ?? null,
      spiderLab: spiderLab?.captureCheckpoint() ?? null,
      colosseum: colosseum?.captureCheckpoint() ?? null,
    };
  }

  restoreCheckpoint(snapshot: BossRoomDressingCheckpoint): void {
    const { hoarder, juicer, krakaren, spiderLab, colosseum } = this.parts;
    if (snapshot.hoarder !== null) hoarder?.restoreCheckpoint(snapshot.hoarder);
    if (snapshot.juicer !== null) juicer?.restoreCheckpoint(snapshot.juicer);
    if (snapshot.krakaren !== null) krakaren?.restoreCheckpoint(snapshot.krakaren);
    if (snapshot.spiderLab !== null) spiderLab?.restoreCheckpoint(snapshot.spiderLab);
    if (snapshot.colosseum !== null) colosseum?.restoreCheckpoint(snapshot.colosseum);
  }
}
