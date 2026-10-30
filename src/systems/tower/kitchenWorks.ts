/**
 * The kitchen, and the dumbwaiter traffic between it and the archive.
 *
 * - **The key ring.** Once the archive has sent it down, the archivist's key
 *   ring waits at the dumbwaiter's foot. The human takes it and opens the
 *   larder door with it, and it is gone. It is only ever carried on this
 *   storey: carried off it, it goes back to the dumbwaiter's foot, and it is
 *   put back there on any visit that finds it nowhere while the larder is
 *   still locked, so it can always be had again.
 * - **The portcullis chain** hangs in the larder, but the portcullis is held
 *   from above: hauling on it does nothing until the counterweight upstairs
 *   has fallen. When it falls the portcullis over the stair up rises here at
 *   once, so a party already in the tower sees it go up.
 * - **The bell and the note.** Ringing the dumbwaiter's bell from here, while
 *   the cellmate is still unfed, brings her answer down a moment later: a note
 *   with nothing on it but a fishy paw print. Sending a tin of tuna up feeds
 *   her, and the note has done its work.
 *
 * Each lasting step is written to the questline's progress (`keyRingSent`,
 * `larderOpened`, `tunaSent`, `portcullisRaised`) when it happens.
 */

import { TILE_SIZE } from '../../core/constants';
import type { ItemId } from '../../core/items/defs/ItemDefs';
import {
  itemsWaitingAt,
  leaveExchangeItem,
  type ExchangePointId,
} from '../../core/party/partySplit';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  BELL_COUNTERWEIGHT_SET_ID,
  KITCHEN_PORTCULLIS_ID,
  LARDER_DOOR_ID,
  LARDER_DOOR_TILE,
  PORTCULLIS_CHAIN_TILE,
  towerStoreyPlan,
  TOWER_DUMBWAITER,
  TOWER_KEY_RING_ITEM,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import {
  TOWER_DUMBWAITER_BELL_FLAG,
  TOWER_DUMBWAITER_CONVEYOR_ID,
} from '../../map/town/interiors/roomMechanisms';
import { LARDER_DOOR_VARIANT } from '../../sprites/art/townInterior/rooms/towerWorks';
import {
  drawTownInteriorProp,
  TOWN_INTERIOR_PROPS,
} from '../../sprites/art/townInterior/townInteriorProps';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import type { SystemContext } from '../GameSystem';
import { conveyorEndPoint } from '../roomMechanisms/conveyors';
import type { WorkChannelBuilder } from '../WorkChannel';
import { StoreyWorks, tileCentrePx, type StoreyWorksDeps } from './storeyWorks';

const CELLMATE_NOTE_ITEM: ItemId = 'quest_pumpkin_note';
export const TUNA_TIN_ITEM: ItemId = 'quest_tuna_tin';

/** From the crawler's centre to a fitting's tile centre, in tiles. */
const FITTING_REACH_TILES = 1.3;
/** Frames between the bell being rung and the cellmate's note coming down. */
const NOTE_DELAY_FRAMES = 150;

const LOCKED_TOAST = 'The larder is locked. Somebody in the tower has its key.';
const CHAIN_HELD_TOAST = "The chain won't give. Something holds the portcullis from above.";

type Party = Readonly<{ human: HumanPlayer; cat: CatPlayer }>;

const HIDES_PORTCULLIS: ReadonlySet<string> = new Set([KITCHEN_PORTCULLIS_ID]);
const HIDES_NOTHING: ReadonlySet<string> = new Set();

export class KitchenWorks extends StoreyWorks {
  private readonly footPoint: ExchangePointId = conveyorEndPoint(
    TOWER_DUMBWAITER_CONVEYOR_ID,
    'foot',
  );
  private readonly stopListening: ReadonlyArray<() => void>;
  private party: Party | null = null;
  private noteInFrames: number | null = null;
  private keyRingHeld = false;
  /** Raised while the party stood in the tower, so the map built shut is drawn and walked as raised. */
  private raisedLive = false;

  constructor(deps: StoreyWorksDeps) {
    super(deps);
    if (deps.conditions.larder === 'locked') {
      deps.map.blockTilePermanently(LARDER_DOOR_TILE.x, LARDER_DOOR_TILE.y);
    }
    this.stopListening = [
      deps.bus.on('conveyorSent', (sent) => {
        if (sent.conveyor === TOWER_DUMBWAITER_CONVEYOR_ID) this.onSent(sent.item);
      }),
      deps.bus.on('conveyorSignalled', (signal) => {
        if (signal.flag === TOWER_DUMBWAITER_BELL_FLAG) this.onBellRung();
      }),
      deps.bus.on('plateSetOpened', (opened) => {
        if (opened.set === BELL_COUNTERWEIGHT_SET_ID) this.onCounterweightFallen();
      }),
    ];
  }

  enter(ctx: SystemContext): void {
    this.party = { human: ctx.human, cat: ctx.cat };
    const { progress } = this.deps;
    if (progress.keyRingSent && !progress.larderOpened && !this.carried(TOWER_KEY_RING_ITEM)) {
      this.leaveAtFoot(TOWER_KEY_RING_ITEM);
    }
  }

  leave(): void {
    this.noteInFrames = null;
    if (this.deps.progress.larderOpened || !this.carried(TOWER_KEY_RING_ITEM)) return;
    this.retire(TOWER_KEY_RING_ITEM);
    this.leaveAtFoot(TOWER_KEY_RING_ITEM);
  }

  update(ctx: SystemContext): void {
    this.party = { human: ctx.human, cat: ctx.cat };
    const held = this.carried(TOWER_KEY_RING_ITEM);
    if (held && !this.keyRingHeld) this.moment({ kind: 'key_ring_taken' });
    this.keyRingHeld = held;
    if (this.noteInFrames === null) return;
    this.noteInFrames--;
    if (this.noteInFrames > 0) return;
    this.noteInFrames = null;
    this.leaveAtFoot(CELLMATE_NOTE_ITEM);
    this.play('dumbwaiterArrives', tileCentrePx(TOWER_DUMBWAITER.foot.hatch));
    this.moment({ kind: 'note_arrived' });
  }

  tryInteract(ctx: SystemContext): boolean {
    if (ctx.active !== ctx.human) return false;
    if (this.deps.progress.larderOpened || this.deps.conditions.larder === 'open') {
      return this.tryChain(ctx.human);
    }
    if (!inReach(ctx.human, LARDER_DOOR_TILE)) return false;
    if (ctx.human.inventory.countOf(TOWER_KEY_RING_ITEM) <= 0) {
      this.deps.toast(LOCKED_TOAST);
      return true;
    }
    this.openLarder();
    return true;
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    if (!active.isActive || active.crawlerKind !== 'human') return;
    const larderOpen = this.deps.progress.larderOpened || this.deps.conditions.larder === 'open';
    if (!larderOpen && inReach(active, LARDER_DOOR_TILE)) {
      const deed =
        active.inventory.countOf(TOWER_KEY_RING_ITEM) > 0 ? 'unlock the larder' : 'try the door';
      promptAt(ctx, camX, camY, LARDER_DOOR_TILE, deed);
      return;
    }
    if (
      larderOpen &&
      !this.deps.progress.portcullisRaised &&
      inReach(active, PORTCULLIS_CHAIN_TILE)
    ) {
      promptAt(ctx, camX, camY, PORTCULLIS_CHAIN_TILE, 'haul on the chain');
    }
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

  private tryChain(human: HumanPlayer): boolean {
    if (this.deps.progress.portcullisRaised || !inReach(human, PORTCULLIS_CHAIN_TILE)) return false;
    this.play('chainHeld', tileCentrePx(PORTCULLIS_CHAIN_TILE));
    this.deps.toast(CHAIN_HELD_TOAST);
    this.moment({ kind: 'portcullis_chain_held' });
    return true;
  }

  private openLarder(): void {
    const { map, progress } = this.deps;
    progress.larderOpened = true;
    map.setPlacedInteriorPropVariant(LARDER_DOOR_ID, LARDER_DOOR_VARIANT.open);
    map.unblockTilePermanently(LARDER_DOOR_TILE.x, LARDER_DOOR_TILE.y);
    this.retire(TOWER_KEY_RING_ITEM);
    this.play('larderUnlock', tileCentrePx(LARDER_DOOR_TILE));
    this.moment({ kind: 'larder_opened' });
  }

  private onSent(item: ItemId): void {
    const { progress } = this.deps;
    if (item === TOWER_KEY_RING_ITEM && !progress.keyRingSent) {
      progress.keyRingSent = true;
      this.moment({ kind: 'key_ring_sent' });
      return;
    }
    if (item === TUNA_TIN_ITEM && !progress.tunaSent) {
      progress.tunaSent = true;
      this.retire(CELLMATE_NOTE_ITEM);
      this.play('tunaOpened', tileCentrePx(TOWER_DUMBWAITER.foot.hatch));
      this.moment({ kind: 'tuna_sent' });
    }
  }

  private onBellRung(): void {
    this.moment({ kind: 'dumbwaiter_bell_rung' });
    if (this.deps.progress.tunaSent || this.carried(CELLMATE_NOTE_ITEM)) return;
    if (
      itemsWaitingAt(this.deps.split, this.footPoint).some(
        (load) => load.item === CELLMATE_NOTE_ITEM,
      )
    )
      return;
    this.noteInFrames = NOTE_DELAY_FRAMES;
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

  private carried(item: ItemId): boolean {
    const party = this.party;
    if (party === null) return false;
    return party.human.inventory.countOf(item) > 0 || party.cat.inventory.countOf(item) > 0;
  }

  private retire(item: ItemId): void {
    const party = this.party;
    if (party === null) return;
    party.human.inventory.clearQuestItem(item);
    party.cat.inventory.clearQuestItem(item);
  }

  private leaveAtFoot(item: ItemId): void {
    const waiting = itemsWaitingAt(this.deps.split, this.footPoint);
    if (waiting.some((load) => load.item === item)) return;
    leaveExchangeItem(this.deps.split, { item, quantity: 1, to: this.footPoint });
  }
}

function inReach(crawler: { readonly x: number; readonly y: number }, tile: TowerTile): boolean {
  const centre = tileCentrePx(tile);
  const half = TILE_SIZE / 2;
  return (
    Math.hypot(crawler.x + half - centre.x, crawler.y + half - centre.y) <=
    FITTING_REACH_TILES * TILE_SIZE
  );
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
