/**
 * One map's works, run together: its pressure plates and the sets that read
 * them, its knockable props, and the ends of any conveyors standing on it.
 * What is there is data (`interiorMechanisms.ts`, the storey's layout and
 * `roomMechanisms.ts`); this is the one object a scene ticks, draws and hands
 * an interact press to. A map with none of them costs nothing.
 */

import type { SoundId } from '../../audio/sounds';
import type { EventBus } from '../../core/EventBus';
import type { PartySplitState } from '../../core/party/partySplit';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { CatAlly } from '../../creatures/CatAlly';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap, PlacedTownInteriorProp } from '../../map/GameMap';
import type { ConveyorPlacement, PlateSetDef } from '../../map/interiorMechanisms';
import type { MechanismPlace } from '../../map/town/interiors/roomMechanisms';
import type { TilePoint } from '../../map/town/townPlan';
import type { SystemContext } from '../GameSystem';
import { standingCompanions } from '../partyCompanions';
import { ConveyorSystem } from './conveyors';
import { KnockOffSystem } from './knockOff';
import { bodyWeight, PressurePlateSystem, type PlateWeight } from './pressurePlates';

type Crawler = HumanPlayer | CatPlayer;

export interface RoomMechanismsOptions {
  readonly map: GameMap;
  readonly place: MechanismPlace;
  readonly plateSets: readonly PlateSetDef[];
  readonly conveyors: readonly ConveyorPlacement[];
  readonly split: PartySplitState;
  readonly bus: EventBus;
  /**
   * Breaks a placed prop where it lies, through the room's breakables; false
   * when the map has none to break it with, and it lies there whole instead.
   */
  readonly shatter: (placed: PlacedTownInteriorProp, at: TilePoint) => boolean;
  readonly playSound: (cue: SoundId, at: { readonly x: number; readonly y: number }) => void;
}

export class RoomMechanisms {
  readonly plates: PressurePlateSystem;
  readonly knockOffs: KnockOffSystem;
  readonly conveyors: ConveyorSystem;

  constructor(options: RoomMechanismsOptions) {
    this.plates = new PressurePlateSystem({
      map: options.map,
      plateSets: options.plateSets,
      playSound: options.playSound,
      onSetOpened: (id) => options.bus.emit('plateSetOpened', { set: id }),
    });
    this.conveyors = new ConveyorSystem({
      place: options.place,
      placements: options.conveyors,
      split: options.split,
      bus: options.bus,
      playSound: options.playSound,
    });
    this.knockOffs = new KnockOffSystem({
      map: options.map,
      shatter: options.shatter,
      conveyors: this.conveyors,
      playSound: options.playSound,
    });
  }

  get isEmpty(): boolean {
    return this.plates.isEmpty && this.knockOffs.isEmpty && this.conveyors.isEmpty;
  }

  /** Once a world tick. */
  update(ctx: SystemContext): void {
    if (this.isEmpty) return;
    this.knockOffs.update();
    this.knockOffs.cue(ctx.active);
    this.plates.update(this.weights(ctx));
  }

  /** Everything on this map with a body: the crawlers here, the party's companions, and things knocked down. */
  private weights(ctx: SystemContext): PlateWeight[] {
    const weights: PlateWeight[] = [];
    for (const crawler of [ctx.human, ctx.cat]) {
      if (!crawler.isAway && crawler.isAlive) weights.push(bodyWeight(crawler));
    }
    for (const companion of standingCompanions(ctx.extraTargets))
      weights.push(bodyWeight(companion));
    for (const target of ctx.extraTargets ?? []) {
      if (target instanceof CatAlly && target.isAlive) weights.push(bodyWeight(target));
    }
    weights.push(...this.knockOffs.weights());
    return weights;
  }

  /** An interact press from the crawler being steered. Returns whether anything here took it. */
  tryInteract(crawler: Crawler): boolean {
    if (this.isEmpty) return false;
    return this.knockOffs.tryInteract(crawler) || this.conveyors.tryInteract(crawler);
  }

  /** Placed props no longer standing where the layout put them. */
  hiddenProps(): ReadonlySet<string> {
    return this.knockOffs.hiddenIds();
  }

  /** Under every body: things knocked flat across the floor. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.knockOffs.renderGround(ctx, camX, camY);
  }

  /** The room's sorted pass: plate-set targets and things knocked down. */
  sortedFigures(): InteriorFigure[] {
    if (this.isEmpty) return [];
    return [...this.plates.sortedFigures(), ...this.knockOffs.sortedFigures()];
  }

  /** Over the bodies: a conveyor end's waiting load or raised signal. */
  renderMarkers(ctx: CanvasRenderingContext2D, camX: number, camY: number, nowMs: number): void {
    this.conveyors.renderMarkers(ctx, camX, camY, nowMs);
  }

  /** The prompt for whatever here a press would work. Returns whether one claimed the slot. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    crawler: Crawler,
  ): boolean {
    if (this.isEmpty) return false;
    return (
      this.knockOffs.renderPrompt(ctx, camX, camY, crawler) ||
      this.conveyors.renderPrompt(ctx, camX, camY, crawler)
    );
  }
}
