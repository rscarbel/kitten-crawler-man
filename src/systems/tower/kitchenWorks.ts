/**
 * The kitchen, and the dumbwaiter traffic between it and the archive.
 *
 * The human's chapter here is {@link KitchenStage}: take the key ring Belle
 * sent down, unlock the larder with it, ring the dumbwaiter's bell, take the
 * note that comes down, and send a tin of tuna up, which the cellmate
 * waiting at the top eats as it arrives. The works claim the
 * dumbwaiter's foot and its bell pull from the room's conveyors and offer a
 * deed at a fitting only while it is the step in hand, moving the stage on by
 * exactly one step per deed; a press anywhere else in the sequence says what
 * comes first and changes nothing. Where the key ring and the note are follows
 * the stage, never the other way round: on every arrival and every step the
 * dumbwaiter's foot and the human's bag are made to hold what the stage says,
 * so neither can be lost, doubled or carried out of turn.
 *
 * The larder is locked until the key ring turns in it, and never locks again.
 * The portcullis chain hangs in it, but the portcullis is held from above:
 * hauling on it does nothing until the counterweight upstairs has fallen.
 * When it falls the portcullis over the stair up rises here at once, so a
 * party already in the tower sees it go up.
 */

import { TILE_SIZE } from '../../core/constants';
import type { ItemId } from '../../core/items/defs/ItemDefs';
import {
  larderUnlocked,
  nextKitchenStage,
  type KitchenStage,
} from '../../core/quests/missingCatsProgress';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { Player } from '../../Player';
import { kitchenNotYetNotice, LARDER_LOCKED_NOTICE } from '../../dialog/scripts/scenes/missingCats';
import {
  BELL_COUNTERWEIGHT_SET_ID,
  KITCHEN_PORTCULLIS_ID,
  LARDER_DOOR_ID,
  LARDER_DOOR_TILE,
  PORTCULLIS_CHAIN_TILE,
  towerStoreyPlan,
  TOWER_KEY_RING_ITEM,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import {
  TOWER_DUMBWAITER_BELL_ID,
  TOWER_DUMBWAITER_CONVEYOR_ID,
} from '../../map/town/interiors/roomMechanisms';
import { LARDER_DOOR_VARIANT } from '../../sprites/art/townInterior/rooms/towerWorks';
import {
  drawTownInteriorProp,
  TOWN_INTERIOR_PROPS,
} from '../../sprites/art/townInterior/townInteriorProps';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { presentCrawlers, type SystemContext } from '../GameSystem';
import type { ClaimedItemEnd, ClaimedSignalEnd } from '../roomMechanisms/conveyors';
import type { WorkChannelBuilder } from '../WorkChannel';
import { KITCHEN_FITTING_TILES, kitchenStep, type KitchenFitting } from './kitchenSequence';
import { StoreyWorks, tileCentrePx, type StoreyWorksDeps } from './storeyWorks';

export const CELLMATE_NOTE_ITEM = 'quest_pumpkin_note' as const satisfies ItemId;
export const TUNA_TIN_ITEM = 'quest_tuna_tin' as const satisfies ItemId;

/** From the crawler's centre to a fitting's tile centre, in tiles. */
const FITTING_REACH_TILES = 1.3;
/** Frames between the bell being rung and the cellmate's note coming down. */
const NOTE_DELAY_FRAMES = 150;
const ONE_ITEM = 1;

const CHAIN_HELD_TOAST = "The chain won't give. Something holds the portcullis from above.";

/** The fittings a press works the kitchen's sequence at; the stair is only ever walked to. */
type KitchenSequenceFitting = Exclude<KitchenFitting, 'stair_up'>;
const SEQUENCE_FITTINGS = [
  'hatch',
  'bell',
  'larder_door',
] as const satisfies readonly KitchenSequenceFitting[];

type Party = Readonly<{ human: HumanPlayer; cat: CatPlayer }>;

type TunaCarrier = Pick<Player, 'isAway' | 'inventory'>;

/**
 * The crawler on this map whose tin of tuna the human's press at the hatch
 * sends up, or null when no one here carries one. A shop puts a purchase in
 * whichever crawler is steered, so the tin may be in either bag; one away
 * with the other side of a split cannot be reached from the hatch. The
 * Journal reads this same answer, so it never asks for a send the hatch
 * would refuse.
 */
export function tunaHolder<Human extends TunaCarrier, Cat extends TunaCarrier>(party: {
  readonly human: Human;
  readonly cat: Cat;
}): Human | Cat | null {
  return (
    presentCrawlers(party).find((crawler) => crawler.inventory.countOf(TUNA_TIN_ITEM) > 0) ?? null
  );
}

const HIDES_PORTCULLIS: ReadonlySet<string> = new Set([KITCHEN_PORTCULLIS_ID]);
const HIDES_NOTHING: ReadonlySet<string> = new Set();

export class KitchenWorks extends StoreyWorks {
  private readonly hatch: ClaimedItemEnd;
  private readonly bell: ClaimedSignalEnd;
  private readonly stopListening: ReadonlyArray<() => void>;
  private party: Party | null = null;
  private noteInFrames: number | null = null;
  /** Whether the human has been told what the kitchen's first step is since this tower was built. */
  private firstStepTold = false;
  /** Raised while the party stood in the tower, so the map built shut is drawn and walked as raised. */
  private raisedLive = false;

  constructor(deps: StoreyWorksDeps) {
    super(deps);
    const conveyors = deps.mechanisms.conveyors;
    const hatch = conveyors.claimItemEnd(TOWER_DUMBWAITER_CONVEYOR_ID, 'foot');
    const bell = conveyors.claimSignalEnd(TOWER_DUMBWAITER_BELL_ID, 'foot');
    if (hatch === null || bell === null) {
      throw new Error("the kitchen's map has no dumbwaiter foot to claim");
    }
    this.hatch = hatch;
    this.bell = bell;
    if (deps.conditions.larder === 'locked') {
      deps.map.blockTilePermanently(LARDER_DOOR_TILE.x, LARDER_DOOR_TILE.y);
    }
    this.stopListening = [
      deps.bus.on('conveyorSent', (sent) => {
        if (sent.conveyor === TOWER_DUMBWAITER_CONVEYOR_ID) this.onSent(sent.item);
      }),
      deps.bus.on('plateSetOpened', (opened) => {
        if (opened.set === BELL_COUNTERWEIGHT_SET_ID) this.onCounterweightFallen();
      }),
    ];
  }

  private get stage(): KitchenStage {
    return this.deps.progress.kitchen;
  }

  /** Whether the kitchen's sequence is the human's to play now. */
  private get sequenceLive(): boolean {
    return this.deps.progress.phase === 'gatehouse';
  }

  enter(ctx: SystemContext): void {
    this.party = { human: ctx.human, cat: ctx.cat };
    this.settle();
    if (this.stage === 'bell_rung') this.noteInFrames = NOTE_DELAY_FRAMES;
    if (this.sequenceLive && this.stage === 'key_ring_in_dumbwaiter' && !this.firstStepTold) {
      this.firstStepTold = true;
      this.announce();
    }
  }

  leave(): void {
    this.noteInFrames = null;
  }

  update(ctx: SystemContext): void {
    this.party = { human: ctx.human, cat: ctx.cat };
    if (this.noteInFrames === null) return;
    this.noteInFrames--;
    if (this.noteInFrames > 0) return;
    this.noteInFrames = null;
    if (this.stage !== 'bell_rung') return;
    this.play('dumbwaiterArrives', tileCentrePx(this.hatch.tile));
    this.advance();
  }

  tryInteract(ctx: SystemContext): boolean {
    if (ctx.active !== ctx.human) return false;
    const human = ctx.human;
    if (larderUnlocked(this.deps.progress) || this.deps.conditions.larder === 'open') {
      if (this.tryChain(human)) return true;
    }
    if (!this.sequenceLive) return false;
    const fitting = this.fittingInReach(human);
    if (fitting === null) return false;
    const tinFrom = tunaHolder(ctx);
    const step = kitchenStep(this.stage, tinFrom !== null);
    const offered = step.place.kind === 'fitting' && step.place.fitting === fitting;
    if (!offered || step.deed === null) {
      this.deps.toast(this.notYet(fitting, step.objective));
      return true;
    }
    this.perform(human, tinFrom);
    return true;
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    if (!active.isActive || active.crawlerKind !== 'human') return;
    const larderOpen = larderUnlocked(this.deps.progress) || this.deps.conditions.larder === 'open';
    if (
      larderOpen &&
      !this.deps.progress.portcullisRaised &&
      inReach(active, PORTCULLIS_CHAIN_TILE)
    ) {
      promptAt(ctx, camX, camY, PORTCULLIS_CHAIN_TILE, 'haul on the chain');
      return;
    }
    if (!this.sequenceLive) return;
    const tunaHere = this.party !== null && tunaHolder(this.party) !== null;
    const step = kitchenStep(this.stage, tunaHere);
    if (step.place.kind !== 'fitting' || step.deed === null) return;
    const tile = KITCHEN_FITTING_TILES[step.place.fitting];
    if (inReach(active, tile)) promptAt(ctx, camX, camY, tile, step.deed);
  }

  hiddenProps(): ReadonlySet<string> {
    return this.raisedLive ? HIDES_PORTCULLIS : HIDES_NOTHING;
  }

  roomFigures(): InteriorFigure[] {
    if (!this.raisedLive) return [];
    const stair = towerStoreyPlan('kitchen').stairUp;
    if (stair === null) return [];
    const { footprint } = TOWN_INTERIOR_PROPS.stair_portcullis_raised;
    return [
      {
        y: (stair.y + footprint.h - 1) * TILE_SIZE,
        render: (ctx, camX, camY, tileSize) =>
          drawTownInteriorProp(
            ctx,
            'stair_portcullis_raised',
            0,
            stair.x,
            stair.y,
            camX,
            camY,
            tileSize,
          ),
      },
    ];
  }

  dispose(): void {
    for (const stop of this.stopListening) stop();
  }

  /** The step in hand's deed, done by the human at its fitting, sending up the tin `tinFrom` carries. */
  private perform(human: HumanPlayer, tinFrom: HumanPlayer | CatPlayer | null): void {
    const stage = this.stage;
    switch (stage) {
      case 'key_ring_in_dumbwaiter':
        if (this.hatch.take(TOWER_KEY_RING_ITEM, human)) this.advance();
        return;
      case 'key_ring_in_hand':
        this.openLarder();
        this.advance();
        return;
      case 'larder_open':
        this.bell.signal();
        this.noteInFrames = NOTE_DELAY_FRAMES;
        this.advance();
        return;
      case 'note_in_dumbwaiter':
        if (this.hatch.take(CELLMATE_NOTE_ITEM, human)) this.advance();
        return;
      case 'note_in_hand':
        if (tinFrom === null || !this.hatch.sendTaken(TUNA_TIN_ITEM, tinFrom)) return;
        this.play('tunaOpened', tileCentrePx(this.hatch.tile));
        this.advance();
        return;
      case 'bell_rung':
      case 'tuna_sent':
        return;
      default: {
        const unhandled: never = stage;
        throw new Error(`no kitchen deed for ${String(unhandled)}`);
      }
    }
  }

  /** Moves the kitchen on by one step, puts the key ring and note where it says, and tells the chapter. */
  private advance(): void {
    const next = nextKitchenStage(this.stage);
    if (next === null) return;
    this.deps.progress.kitchen = next;
    this.settle();
    this.announce();
  }

  private announce(): void {
    const party = this.party;
    this.moment({
      kind: 'kitchen_stage_reached',
      stage: this.stage,
      tunaInHand: party !== null && tunaHolder(party) !== null,
    });
  }

  /**
   * Makes the dumbwaiter's foot and the bags hold the key ring and the note
   * exactly where the stage says they are: in the hatch, in the human's hand,
   * or, once spent, nowhere.
   */
  private settle(): void {
    const stage = this.stage;
    const keyRingDown = this.deps.progress.keyRingSent;
    this.hatchHolds(TOWER_KEY_RING_ITEM, keyRingDown && stage === 'key_ring_in_dumbwaiter');
    this.hatchHolds(CELLMATE_NOTE_ITEM, stage === 'note_in_dumbwaiter');
    this.humanHolds(TOWER_KEY_RING_ITEM, stage === 'key_ring_in_hand');
    this.humanHolds(CELLMATE_NOTE_ITEM, stage === 'note_in_hand');
  }

  private hatchHolds(item: ItemId, held: boolean): void {
    if (held) this.hatch.stock(item);
    else this.hatch.clear(item);
  }

  private humanHolds(item: ItemId, held: boolean): void {
    const party = this.party;
    if (party === null) return;
    const carried = party.human.inventory.countOf(item) + party.cat.inventory.countOf(item);
    if (!held) {
      party.human.inventory.clearQuestItem(item);
      party.cat.inventory.clearQuestItem(item);
      return;
    }
    if (carried === 0) party.human.inventory.addItem(item, ONE_ITEM);
  }

  /** The kitchen fitting of the sequence nearest the human, within reach; the larder door only while it is locked. */
  private fittingInReach(human: HumanPlayer): KitchenSequenceFitting | null {
    let nearest: KitchenSequenceFitting | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const fitting of SEQUENCE_FITTINGS) {
      if (fitting === 'larder_door' && larderUnlocked(this.deps.progress)) continue;
      const distance = distanceTo(human, KITCHEN_FITTING_TILES[fitting]);
      if (distance > FITTING_REACH_TILES * TILE_SIZE || distance >= nearestDistance) continue;
      nearest = fitting;
      nearestDistance = distance;
    }
    return nearest;
  }

  /** Why a press at `fitting` does nothing yet, with what the human does first. */
  private notYet(fitting: KitchenSequenceFitting, objective: string): string {
    const larderStillLocked = fitting === 'larder_door' && this.stage === 'key_ring_in_dumbwaiter';
    return larderStillLocked ? LARDER_LOCKED_NOTICE : kitchenNotYetNotice(objective);
  }

  private tryChain(human: HumanPlayer): boolean {
    if (this.deps.progress.portcullisRaised || !inReach(human, PORTCULLIS_CHAIN_TILE)) return false;
    this.play('chainHeld', tileCentrePx(PORTCULLIS_CHAIN_TILE));
    this.deps.toast(CHAIN_HELD_TOAST);
    this.moment({ kind: 'portcullis_chain_held' });
    return true;
  }

  private openLarder(): void {
    const { map } = this.deps;
    map.setPlacedInteriorPropVariant(LARDER_DOOR_ID, LARDER_DOOR_VARIANT.open);
    map.unblockTilePermanently(LARDER_DOOR_TILE.x, LARDER_DOOR_TILE.y);
    this.play('larderUnlock', tileCentrePx(LARDER_DOOR_TILE));
  }

  /** The key ring Belle batted into the archive's hatch has come down to the foot. */
  private onSent(item: ItemId): void {
    const { progress } = this.deps;
    if (item !== TOWER_KEY_RING_ITEM || progress.keyRingSent) return;
    progress.keyRingSent = true;
    this.moment({ kind: 'key_ring_sent' });
  }

  private onCounterweightFallen(): void {
    const { map, progress } = this.deps;
    progress.portcullisRaised = true;
    this.moment({ kind: 'portcullis_raised' });
    if (this.deps.conditions.portcullis === 'raised') return;
    this.raisedLive = true;
    const stair = towerStoreyPlan('kitchen').stairUp;
    if (stair === null) return;
    const { footprint } = TOWN_INTERIOR_PROPS.stair_portcullis;
    for (let dy = 0; dy < footprint.h; dy++)
      for (let dx = 0; dx < footprint.w; dx++)
        map.unblockTilePermanently(stair.x + dx, stair.y + dy);
  }
}

function distanceTo(crawler: { readonly x: number; readonly y: number }, tile: TowerTile): number {
  const centre = tileCentrePx(tile);
  const half = TILE_SIZE / 2;
  return Math.hypot(crawler.x + half - centre.x, crawler.y + half - centre.y);
}

function inReach(crawler: { readonly x: number; readonly y: number }, tile: TowerTile): boolean {
  return distanceTo(crawler, tile) <= FITTING_REACH_TILES * TILE_SIZE;
}

function promptAt(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  tile: TowerTile,
  deed: string,
): void {
  const left = tile.x * TILE_SIZE - camX;
  const top = tile.y * TILE_SIZE - camY;
  drawInteractionPrompt(ctx, left, top, TILE_SIZE, top + TILE_SIZE, `to ${deed}`);
}
