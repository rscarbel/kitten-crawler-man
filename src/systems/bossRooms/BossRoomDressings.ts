import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GauntletBossType } from '../../map/bossRoomSizes';
import type { GameMap } from '../../map/GameMap';
import type { SystemContext } from '../GameSystem';
import type { GroundHazardSource } from '../GroundHazardSource';
import { GymRoomSystem } from '../GymRoomSystem';
import {
  SEAL_ON_ENTRY,
  type BossRoomDressing,
  type BossRoomFightListener,
  type BossRoomSealRule,
  type DressingRenderable,
} from './BossRoomDressing';
import type { BossRoomDressingCheckpoint } from './bossRoomDressingCheckpoint';
import { TrashGremlinRoomSystem } from './TrashGremlinRoomSystem';
import { PowerLabRoomSystem } from './PowerLabRoomSystem';
import { buildPowerLabLayout } from './powerLabLayout';
import { gymLayoutOf } from '../../map/tiles/bossRooms/gymLayout';
import {
  gymStripLights,
  trashGremlinBulb,
  powerLabMoodLights,
  floodedPumpRoomMoodLights,
  type BossRoomMoodLight,
  type MoodLightSink,
} from './bossRoomMoodLights';
import type { SpiderLabDressing } from './SpiderLabDressing';
import {
  BIG_ROOSTER_BOSS_TYPE,
  ELECTRIC_GOBLIN_BOSS_TYPE,
  KRAKEN_BOSS_TYPE,
  TRASH_GREMLIN_BOSS_TYPE,
} from '../../core/mobs/bossTypes';
import { FloodedPumpRoomSystem, type FloodedPumpRoomStage } from './FloodedPumpRoomSystem';

/**
 * Every room dressing on a floor, each null where the floor has no such room.
 *
 * Named fields rather than one list because each room's checkpoint has its own
 * type: a list could only snapshot them as `unknown`.
 */
export interface BossRoomDressingParts {
  trashGremlin: TrashGremlinRoomSystem | null;
  gym: GymRoomSystem | null;
  powerLab: PowerLabRoomSystem | null;
  floodedPumpRoom: FloodedPumpRoomSystem | null;
  spiderLab: SpiderLabDressing | null;
}

/** Which bosses are already dead, for {@link BossRoomDressings.replayDefeats}. */
export interface BossRoomDefeats {
  /** Gauntlet boss types whose rooms are won, as `BossRoomSystem.defeatedBossTypes` reports them. */
  gauntletBossTypes: ReadonlySet<GauntletBossType>;
  spiderLab: boolean;
}

/**
 * Builds the dressing for every gauntlet boss room on the map, found by boss
 * type. Never by position in the list: which index a boss lands on is the
 * level definition's order, and a hard-coded index hands one boss's room to
 * another's system the moment that order changes.
 */
export function buildGauntletRoomDressings(
  gameMap: GameMap,
  bossTypes: readonly GauntletBossType[],
  floodedRoomStage: FloodedPumpRoomStage | null = null,
): Pick<BossRoomDressingParts, 'trashGremlin' | 'powerLab' | 'floodedPumpRoom'> & {
  gym: GymRoomSystem;
} {
  const boundsOf = (
    bossType: GauntletBossType,
  ): GameMap['bossRooms'][number]['bounds'] | undefined => {
    const index = bossTypes.indexOf(bossType);
    const roomExists = index >= 0 && index < gameMap.bossRooms.length;
    return roomExists ? gameMap.bossRooms[index].bounds : undefined;
  };
  const trashGremlinBounds = boundsOf(TRASH_GREMLIN_BOSS_TYPE);
  const gymIndex = bossTypes.indexOf(BIG_ROOSTER_BOSS_TYPE);
  const gymRoomExists = gymIndex >= 0 && gymIndex < gameMap.bossRooms.length;
  const powerLabBounds = boundsOf(ELECTRIC_GOBLIN_BOSS_TYPE);
  const floodedPumpRoomBounds = boundsOf(KRAKEN_BOSS_TYPE);
  return {
    trashGremlin:
      trashGremlinBounds === undefined
        ? null
        : new TrashGremlinRoomSystem(gameMap, trashGremlinBounds),
    // Built even on a floor with no gym: it stands inert without bounds, and the
    // scene reads its camera shake every frame.
    gym: new GymRoomSystem(gymRoomExists ? gameMap : null, gymIndex),
    powerLab: powerLabBounds === undefined ? null : new PowerLabRoomSystem(gameMap, powerLabBounds),
    floodedPumpRoom:
      floodedPumpRoomBounds === undefined
        ? null
        : new FloodedPumpRoomSystem(gameMap, floodedPumpRoomBounds, floodedRoomStage),
  };
}

/**
 * Every boss room's mood lights on the floor, handed
 * to the lighting pass. Reads the floor alone, the same placements each
 * room's dressing paints its fixtures at, so a gate can light a floor without
 * building its rooms. Returns how many lights were taken.
 */
export function registerBossRoomMoodLights(
  sink: MoodLightSink,
  gameMap: GameMap,
  bossTypes: readonly GauntletBossType[],
): number {
  const lights: BossRoomMoodLight[] = [];
  bossTypes.forEach((bossType, index) => {
    if (index >= gameMap.bossRooms.length) return;
    const room = gameMap.bossRooms[index];
    if (bossType === TRASH_GREMLIN_BOSS_TYPE) lights.push(trashGremlinBulb(room.bounds).light);
    if (bossType === ELECTRIC_GOBLIN_BOSS_TYPE) {
      const lab = buildPowerLabLayout(gameMap.structure, room.bounds, room.centre);
      lights.push(...powerLabMoodLights(lab));
    }
    if (bossType === KRAKEN_BOSS_TYPE)
      lights.push(...floodedPumpRoomMoodLights(room.bounds, gameMap));
  });
  const gym = bossTypes.includes(BIG_ROOSTER_BOSS_TYPE) ? gymLayoutOf(gameMap.structure) : null;
  if (gym !== null) lights.push(...gymStripLights(gym).map((strip) => strip.light));
  let taken = 0;
  for (const light of lights) if (sink.registerMoodLight(light)) taken++;
  return taken;
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
    private readonly bossTypes: readonly GauntletBossType[],
  ) {
    this.all = [
      parts.trashGremlin,
      parts.gym,
      parts.powerLab,
      parts.floodedPumpRoom,
      parts.spiderLab,
    ].filter((dressing): dressing is NonNullable<typeof dressing> => dressing !== null);
    const dressingByBossType: Readonly<Record<GauntletBossType, BossRoomDressing | null>> = {
      [TRASH_GREMLIN_BOSS_TYPE]: parts.trashGremlin,
      [BIG_ROOSTER_BOSS_TYPE]: parts.gym,
      [ELECTRIC_GOBLIN_BOSS_TYPE]: parts.powerLab,
      [KRAKEN_BOSS_TYPE]: parts.floodedPumpRoom,
    };
    this.byBossRoomIndex = bossTypes.map((bossType) => dressingByBossType[bossType]);
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

  sealRule(roomIndex: number): BossRoomSealRule {
    return this.byBossRoomIndex[roomIndex]?.sealRule ?? SEAL_ON_ENTRY;
  }

  /**
   * Tells every room whose boss is already dead that it was won. A room built
   * after its kill — a dev preset that skips the boss, a floor rebuilt from a
   * save — never heard the kill itself.
   * Safe to repeat: `onBossDefeated` is idempotent by contract.
   */
  replayDefeats(dead: BossRoomDefeats): void {
    this.bossTypes.forEach((bossType, roomIndex) => {
      if (dead.gauntletBossTypes.has(bossType)) this.onBossDefeated(roomIndex);
    });
    if (dead.spiderLab) this.parts.spiderLab?.onBossDefeated();
  }

  update(ctx: SystemContext): void {
    for (const dressing of this.all) dressing.update(ctx);
  }

  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    for (const dressing of this.all) dressing.renderGround(ctx, camX, camY, promptFor);
  }

  renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dressing of this.all) dressing.renderGroundWarnings(ctx, camX, camY);
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

  /** Whether any room would claim a press right now, without acting. */
  wouldInteract(player: HumanPlayer | CatPlayer): boolean {
    return this.all.some((dressing) => dressing.wouldInteract(player));
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
    const { trashGremlin, gym, floodedPumpRoom, spiderLab } = this.parts;
    return {
      trashGremlin: trashGremlin?.captureCheckpoint() ?? null,
      gym: gym?.captureCheckpoint() ?? null,
      floodedPumpRoom: floodedPumpRoom?.captureCheckpoint() ?? null,
      spiderLab: spiderLab?.captureCheckpoint() ?? null,
    };
  }

  restoreCheckpoint(snapshot: BossRoomDressingCheckpoint): void {
    const { trashGremlin, gym, floodedPumpRoom, spiderLab } = this.parts;
    if (snapshot.trashGremlin !== null) trashGremlin?.restoreCheckpoint(snapshot.trashGremlin);
    if (snapshot.gym !== null) gym?.restoreCheckpoint(snapshot.gym);
    if (snapshot.floodedPumpRoom !== null) {
      floodedPumpRoom?.restoreCheckpoint(snapshot.floodedPumpRoom);
    }
    if (snapshot.spiderLab !== null) spiderLab?.restoreCheckpoint(snapshot.spiderLab);
  }
}
