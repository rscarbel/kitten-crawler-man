/**
 * The town's purely decorative street furniture — the props that make the Over
 * City read as somewhere people live rather than as a street plan with buildings
 * on it. Plan §3.5.
 *
 * Kept apart from `TownPropSystem`, which owns the fixtures the player *acts on*
 * (the notice board, the seer, the heal spots). Nothing here has a Space-key
 * behaviour, so nothing here belongs in that system's interaction chain; the two
 * only meet in `DungeonScene`, which concatenates both prop lists for the
 * Y-sorted render pass.
 *
 * **Placement is derived from the finished map, not restated.** Signs hang off
 * `buildingEntries` and lamps off the plan's own street rectangles, so a
 * building or a street that moves takes its furniture with it. That is the same
 * choice `?townmap` makes when it re-derives footprints from the grid instead of
 * having the generator export them: a second copy of a coordinate is a second
 * thing to keep in step.
 */

import { TILE_SIZE } from '../core/constants';
import { GOLDEN_ANGLE_RAD } from '../utils';
import { SIGN_SWAY_PHASE_STRIDE_RAD, drawShopSign, signWestShiftTiles } from '../sprites/shopSign';
import { drawStreetLamp } from '../sprites/streetLamp';
import { drawLaundryLine, drawTownClutter, type TownClutterKind } from '../sprites/townClutter';
import {
  drawBunting,
  drawGateArch,
  drawSignpost,
  type GateArchAxis,
  type SignpostArm,
} from '../sprites/townWayfinding';
import { tileKey } from './tileKey';
import type { GameMap } from '../map/GameMap';
import type { ShopSignEmblem, TileRect, TownOffset, TownPlan } from '../map/town/townPlan';
import type { GameSystem } from './GameSystem';
import type { TownPropRenderable } from './townPropRenderable';

/**
 * Streets the town lights, by the plan's own surface names. Market Street and
 * Low Street are §3.3's two lit thoroughfares; King's Road is the arrival
 * sightline from the south gate, and the two Low Quarter alleys are the reason
 * §3.5 asks for lamps at all — an unlit alley beside a nightclub is a corridor,
 * a lit one is a place.
 *
 * Names rather than tile types, because a tile type says what a street is paved
 * in and not which street it is: Market Street and the plaza's approaches are
 * both cobble.
 */
const LIT_STREET_NAMES: ReadonlySet<string> = new Set([
  'Market Street',
  'Low Street',
  "King's Road",
  'club service alley',
  'murder alley',
]);

/** Tiles between consecutive lamps along one street. */
const LAMP_STRIDE_TILES = 9;
/** How far in from a street's ends the first and last lamp stand. */
const LAMP_END_MARGIN_TILES = 3;
/**
 * Lamps must clear a doorway by more than a diagonal step, so one never stands
 * in the tile a player is pushed into on leaving a building, nor in the apron
 * the door hint draws over.
 */
const LAMP_DOOR_CLEARANCE_TILES = 2;

/**
 * The doorway width assumed for an entry that does not state one. Only the tower
 * and the Big Top lack it, and neither carries a sign, so this is a fallback that
 * nothing reaches rather than a guess about a real building.
 */
const DEFAULT_DOORWAY_WIDTH_TILES = 1;

/**
 * Spread the flicker so a street of lamps does not breathe in unison. The golden
 * angle, for the reason `GOLDEN_ANGLE_RAD` gives — a round stride puts some pair
 * of a dozen lamps in visual lockstep.
 */
const LAMP_FLICKER_PHASE_STRIDE_RAD = GOLDEN_ANGLE_RAD;

/**
 * Where a piece of clutter belongs, named the way the plan names things rather
 * than as a coordinate.
 *
 * `yard` puts it inside a block interior, offset from that yard's north-west
 * corner. `door` puts it on a building's own frontage, offset from its door
 * tile — which for every building in this town means the street row below it,
 * because the tiles either side of a door are the facade. Trade spilling onto
 * the pavement is what a market street looks like; a barrel tucked invisibly
 * behind a wall is not.
 */
type ClutterAnchor =
  | { readonly at: 'yard'; readonly name: string; readonly offset: TownOffset }
  | { readonly at: 'door'; readonly name: string; readonly offset: TownOffset };

interface ClutterPlacement {
  readonly kind: TownClutterKind;
  readonly anchor: ClutterAnchor;
}

/**
 * Every piece of clutter in the town.
 *
 * **The smithy's gear is on The Rusty Anvil's own frontage, not in the Market
 * Row east workyard.** §3.3 asks for a smithy yard, and the Phase 3 review
 * established that this block cannot give it one: the Anvil fills columns 9–16
 * and the East Lane separates it from the yard at 20–27, so an anvil dropped in
 * that yard would be an anvil in someone else's yard. The yard gets the carting
 * gear it actually serves.
 */
const CLUTTER_PLACEMENTS: ReadonlyArray<ClutterPlacement> = [
  // The smithy, spilling onto Market Street either side of its door.
  {
    kind: 'anvil_block',
    anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: -3, dy: 1 } },
  },
  { kind: 'coal_pile', anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: -4, dy: 1 } } },
  {
    kind: 'quench_barrel',
    anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: 3, dy: 1 } },
  },
  { kind: 'tool_rack', anchor: { at: 'door', name: 'The Rusty Anvil', offset: { dx: 4, dy: 1 } } },

  // Frontages: what each trade leaves outside its own door.
  {
    kind: 'water_trough',
    anchor: { at: 'door', name: 'The Sleeping Cat Inn', offset: { dx: -3, dy: 1 } },
  },
  {
    kind: 'hitching_post',
    anchor: { at: 'door', name: 'The Sleeping Cat Inn', offset: { dx: -4, dy: 1 } },
  },
  { kind: 'crate_stack', anchor: { at: 'door', name: 'General Store', offset: { dx: 3, dy: 1 } } },
  { kind: 'sacks', anchor: { at: 'door', name: 'General Store', offset: { dx: 4, dy: 1 } } },
  // +4, not +3: The Horned Flagon's doorway is four tiles wide, so `paintDoorApron`
  // reaches three tiles east of the door *centre* and a barrel at +3 stood on the
  // last tile of its own doorstep.
  {
    kind: 'barrel_stack',
    anchor: { at: 'door', name: 'The Horned Flagon', offset: { dx: 4, dy: 1 } },
  },
  { kind: 'planter', anchor: { at: 'door', name: 'Temple of the Sky', offset: { dx: 3, dy: 1 } } },
  {
    kind: 'barrel_stack',
    anchor: { at: 'door', name: 'The Desperado Club', offset: { dx: 4, dy: 1 } },
  },
  { kind: 'handcart', anchor: { at: 'door', name: "Miller's Farm", offset: { dx: -3, dy: 1 } } },
  { kind: 'hay_bale', anchor: { at: 'door', name: "Miller's Farm", offset: { dx: -4, dy: 1 } } },
  {
    kind: 'planter',
    anchor: { at: 'door', name: "Old Hilda's Cottage", offset: { dx: 3, dy: 1 } },
  },

  // The carting yard behind Market Row.
  {
    kind: 'crate_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 2, dy: 1 } },
  },
  {
    kind: 'barrel_stack',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 4, dy: 1 } },
  },
  {
    kind: 'hay_bale',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 6, dy: 2 } },
  },
  {
    kind: 'handcart',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 2, dy: 3 } },
  },
  {
    kind: 'wagon_wheel',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 5, dy: 4 } },
  },
  {
    kind: 'sacks',
    anchor: { at: 'yard', name: 'Market Row east workyard', offset: { dx: 6, dy: 4 } },
  },

  // The gardens.
  {
    kind: 'chicken_coop',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 1, dy: 1 } },
  },
  {
    kind: 'garden_pump',
    anchor: { at: 'yard', name: "Miller's kitchen garden", offset: { dx: 5, dy: 1 } },
  },
  {
    kind: 'garden_pump',
    anchor: { at: 'yard', name: "Signet's back garden", offset: { dx: 2, dy: 2 } },
  },
  {
    kind: 'planter',
    anchor: { at: 'yard', name: "Signet's back garden", offset: { dx: 9, dy: 6 } },
  },
  {
    kind: 'barrel_stack',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 1, dy: 1 } },
  },
  {
    kind: 'crate_stack',
    anchor: { at: 'yard', name: 'Sunken Stump back garden', offset: { dx: 4, dy: 2 } },
  },
  { kind: 'hay_bale', anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 1, dy: 1 } } },
  { kind: 'planter', anchor: { at: 'yard', name: 'Garrison Green', offset: { dx: 5, dy: 4 } } },
];

/** How far a piece of clutter may drift from its stated tile to find a free one. */
const CLUTTER_SEARCH_RADIUS = 2;

/**
 * Lines strung across the Low Quarter's two alleys, by the plan's surface names.
 * An alley is the narrowest thing in the town, which is what makes a line across
 * one read as spanning a gap rather than as a rope in a field.
 *
 * The ends land on the alley's flanking ground rather than on a wall — measured,
 * the nearest building is about three tiles from either end — so `drawLaundryLine`
 * stands its own poles instead of assuming there is something there to tie to.
 */
const LAUNDRY_ALLEY_NAMES: ReadonlyArray<string> = ['club service alley', 'murder alley'];
/**
 * How far down an alley from its north end each line hangs. Both alleys are ten
 * rows deep, so two lines at these depths sit clear of each end and of each
 * other; a line past the last row is dropped rather than clamped.
 */
const LAUNDRY_FIRST_ROW_OFFSET = 3;
const LAUNDRY_SECOND_ROW_OFFSET = 7;
const LAUNDRY_ROW_OFFSETS: ReadonlyArray<number> = [
  LAUNDRY_FIRST_ROW_OFFSET,
  LAUNDRY_SECOND_ROW_OFFSET,
];

/**
 * The signposts, by the plan's own names: one inside each gate, pointing back the
 * way you came and on down the street it opens onto.
 *
 * Anchored to a gate's `exit` rather than to its opening, then stepped *inward*
 * and sideways, so a post stands on the town's side of the wall where a traveller
 * reads it on arrival, beside the gate's road rather than in it.
 *
 * The arms point left and right because that is what a fingerpost's arms do; each
 * names what lies that way along the street the post stands on, so the labels are
 * read off the layout rather than invented.
 */
interface PlannedSignpost {
  readonly gateName: string;
  /** Tiles inward from the gate exit along the gate's own axis. */
  readonly inwardTiles: number;
  /** Tiles to the side of the gate's centre line, so the post is not in the road. */
  readonly sidewaysTiles: number;
  readonly arms: ReadonlyArray<SignpostArm>;
}

const SIGNPOST_INWARD_TILES = 4;
const SIGNPOST_SIDEWAYS_TILES = 3;

const PLANNED_SIGNPOSTS: ReadonlyArray<PlannedSignpost> = [
  {
    gateName: 'south gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: -SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Low Quarter', direction: -1 },
      { label: 'The Club', direction: 1 },
    ],
  },
  {
    gateName: 'west gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Market Plaza', direction: 1 },
      { label: 'West Gate', direction: -1 },
    ],
  },
  {
    gateName: 'east gate',
    inwardTiles: SIGNPOST_INWARD_TILES,
    sidewaysTiles: -SIGNPOST_SIDEWAYS_TILES,
    arms: [
      { label: 'Market Plaza', direction: -1 },
      { label: 'East Gate', direction: 1 },
    ],
  },
];

/**
 * A gateway is anchored **on** the wall, at the opening's west or north jamb.
 *
 * An earlier version inset the face-on form one row inward, on the reasoning that
 * a prop anchored on a wall tile "would sort behind the rampart's own art". That
 * is not how the wall is drawn: `TOWN_WALL` is a ground tile baked in the chunk
 * cache, so a prop drawn in the Y-sorted pass is always over it whatever its
 * anchor row. The inset bought nothing and cost the two south-gate torches, whose
 * tiles the arch's piers landed on and occluded almost completely.
 */
const GATEWAY_INSET_TILES = 0;

/**
 * Slack added to a spanning prop's own span to get its cull margin.
 *
 * A span is measured between the two ends' tile *centres*, and each end's art —
 * a pennant, a hanging sheet, a pier — reaches a fraction of a tile past that.
 * One tile covers it with room over. Culling is on the anchor alone, so getting
 * this wrong makes a sixteen-tile string vanish in one frame with twelve tiles
 * still on screen, which is exactly what the default four-tile margin did.
 */
const SPANNING_PROP_CULL_SLACK_TILES = 1;
/** The gateway's piers stand proud of both ends, so it needs a little more. */
const GATEWAY_CULL_SLACK_TILES = 2;

/**
 * Bunting spans, as an offset from the plaza centre and a width in tiles.
 *
 * Two spans over the civic terrace and one across the plaza's Market Street
 * frontage — §3.5's two named sites, the terrace getting a pair because it is ten
 * rows deep and one string across it reads as a stray rope. Both terrace spans
 * sit on terrace rows: the terrace runs y −18…−9 from the plaza centre, and an
 * earlier pair at −9 and −4 put the second one five rows inside the plaza.
 *
 * Stated as offsets because none of them hangs off a building or a yard; they
 * cross open ground, and the thing they are measured against is the plaza.
 */
interface PlannedBunting {
  readonly offset: TownOffset;
  readonly spanTiles: number;
}

const BUNTING_SPANS: ReadonlyArray<PlannedBunting> = [
  { offset: { dx: -6, dy: -13 }, spanTiles: 11 },
  { offset: { dx: -6, dy: -9 }, spanTiles: 11 },
  { offset: { dx: -8, dy: 9 }, spanTiles: 16 },
];

interface TileXY {
  x: number;
  y: number;
}

export class TownDecorSystem implements GameSystem {
  private readonly renderables: TownPropRenderable[] = [];
  private readonly occupied = new Set<string>();
  /** See `reachableInterior`. Null until the first placement needs it. */
  private reachableCache: number | null = null;
  private frame = 0;

  /**
   * @param claimedElsewhere tiles the market stalls and `TownPropSystem`'s props
   *   already stand on. Needed for the same reason `TownPropSystem` needs the
   *   market's: placement tests `isWalkableIgnoringPermanent`, which by design
   *   does not see those systems' permanent blocks.
   */
  constructor(
    private readonly gameMap: GameMap,
    private readonly claimedElsewhere: ReadonlySet<string> = new Set(),
  ) {
    this.placeShopSigns();
    this.placeStreetLamps();
    this.placeClutter();
    this.placeLaundryLines();
    this.placeSignposts();
    this.placeGateArches();
    this.placeBunting();
  }

  update(): void {
    this.frame++;
  }

  /** Renderable props for the scene's Y-sorted entity pass. */
  get props(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /**
   * One hanging sign over every shop front. Entries with no `sign` — the main
   * tower and the circus's Big Top — are skipped rather than given a default:
   * neither is a trade, and a fallback emblem would put a mug over the Big Top.
   *
   * Signs block nothing, and nothing needs them to: the board hangs over the
   * facade tile *west* of the doorway, which is already solid, and its lowest ink
   * sits 9 px above the anchor tile's top edge — measured over every emblem and a
   * full sway cycle. Nobody can stand under one.
   */
  private placeShopSigns(): void {
    let signIndex = 0;
    for (const entry of this.gameMap.buildingEntries) {
      const emblem = entry.sign;
      if (emblem === undefined) continue;
      this.renderables.push(
        new ShopSignProp(
          entry.doorTile,
          emblem,
          signWestShiftTiles(entry.doorwayWidth ?? DEFAULT_DOORWAY_WIDTH_TILES),
          signIndex * SIGN_SWAY_PHASE_STRIDE_RAD,
          () => this.frame,
        ),
      );
      signIndex++;
    }
  }

  /**
   * Lamps down the kerbs of the lit streets, staggered so opposite sides
   * alternate rather than facing each other in pairs.
   *
   * A lamp is a post, so it blocks its tile — and a prop system's block happens
   * *after* generation, where none of the generator's seven standing assertions
   * can see it. `assertTownIsFullyReachable` proved that a single well-meant
   * fence post can strand fourteen walkable tiles with nothing about the map
   * looking wrong, so every lamp here is checked against the same property
   * before it is placed rather than after someone notices.
   */
  private placeStreetLamps(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    const doorClearance = this.gatherDoorClearance();
    let lampIndex = 0;
    for (const surface of plan.surfaces) {
      if (!LIT_STREET_NAMES.has(surface.name)) continue;
      for (const tile of kerbSites(surface.bounds)) {
        if (doorClearance.has(tileKey(tile.x, tile.y))) continue;
        if (!this.canStandOn(tile)) continue;
        if (!this.leavesTownConnected(plan, tile)) continue;
        this.reserve(tile);
        this.renderables.push(
          new StreetLampProp(tile, lampIndex * LAMP_FLICKER_PHASE_STRIDE_RAD, () => this.frame),
        );
        lampIndex++;
      }
    }
  }

  /**
   * The carts, crates, troughs and yard gear of §3.5's tier 2.
   *
   * Every piece blocks its tile — a barrel you can walk through is worse than no
   * barrel — so each goes through the same connectivity check the lamps do. A
   * piece whose stated tile is taken drifts a short way to find a free one and is
   * dropped if it cannot; the alternative is a barrel inside a wall, and clutter
   * is the one thing in the town that can be missing without anything looking
   * wrong.
   */
  private placeClutter(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const placement of CLUTTER_PLACEMENTS) {
      const preferred = this.resolveClutterAnchor(plan, placement.anchor);
      if (preferred === null) continue;
      const tile = this.findFreeTile(plan, preferred);
      if (tile === null) continue;
      this.reserve(tile);
      this.renderables.push(new ClutterProp(tile, placement.kind));
    }
  }

  private resolveClutterAnchor(plan: TownPlan, anchor: ClutterAnchor): TileXY | null {
    if (anchor.at === 'door') {
      const entry = this.gameMap.buildingEntries.find((e) => e.name === anchor.name);
      if (entry === undefined) return null;
      return { x: entry.doorTile.x + anchor.offset.dx, y: entry.doorTile.y + anchor.offset.dy };
    }
    const yard = plan.yards.find((y) => y.name === anchor.name);
    if (yard === undefined) return null;
    return { x: yard.bounds.x + anchor.offset.dx, y: yard.bounds.y + anchor.offset.dy };
  }

  /** Spirals out from `preferred` for a tile that is free and safe to block. */
  private findFreeTile(plan: TownPlan, preferred: TileXY): TileXY | null {
    for (let ring = 0; ring <= CLUTTER_SEARCH_RADIUS; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const tile = { x: preferred.x + dx, y: preferred.y + dy };
          if (!this.canStandOn(tile)) continue;
          if (!this.leavesTownConnected(plan, tile)) continue;
          return tile;
        }
      }
    }
    return null;
  }

  /**
   * Washing strung across the Low Quarter's alleys.
   *
   * Lines block nothing — they hang a tile above head height, like the shop
   * signs — so they skip the connectivity check, and unlike everything else here
   * their anchor is one *end* of the prop rather than the thing itself.
   */
  private placeLaundryLines(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const alleyName of LAUNDRY_ALLEY_NAMES) {
      const alley = plan.surfaces.find((surface) => surface.name === alleyName);
      if (alley === undefined) continue;
      for (const rowOffset of LAUNDRY_ROW_OFFSETS) {
        const y = alley.bounds.y + rowOffset;
        if (y >= alley.bounds.y + alley.bounds.h) continue;
        this.renderables.push(
          new LaundryLineProp({ x: alley.bounds.x - 1, y }, alley.bounds.w + 1, () => this.frame),
        );
      }
    }
  }

  /**
   * Fingerposts inside each gate. They block their tile, so they go through the
   * same connectivity check everything else that blocks does.
   */
  private placeSignposts(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const planned of PLANNED_SIGNPOSTS) {
      const gate = plan.gates.find((g) => g.name === planned.gateName);
      if (gate === undefined) continue;
      // Inward is the reverse of the gate's outward axis; sideways is the axis it
      // does not run along, which for an axis-aligned gate is the other one.
      const inward = { dx: -gate.outward.dx, dy: -gate.outward.dy };
      const preferred = {
        x: gate.exit.x + inward.dx * planned.inwardTiles + inward.dy * planned.sidewaysTiles,
        y: gate.exit.y + inward.dy * planned.inwardTiles + inward.dx * planned.sidewaysTiles,
      };
      const tile = this.findFreeTile(plan, preferred);
      if (tile === null) continue;
      this.reserve(tile);
      this.renderables.push(new SignpostProp(tile, planned.arms));
    }
  }

  /**
   * A gateway over each gate. Blocks nothing — its piers stand beyond the ends of
   * the opening and its stonework is above head height — so it needs no
   * connectivity check.
   *
   * **The three gates are not the same shape and must not be drawn the same way.**
   * The south gate is a four-tile opening in an east–west wall: you look through
   * it, and it takes the face-on arch. The side gates are four-tile openings in
   * north–south walls, which the wall renderer itself draws top-down, so they take
   * the gatehouse form. Drawing all three face-on spanned the side gates *along
   * Market Street* instead of across their own throats and planted a stone pier in
   * the carriageway five tiles inside the wall.
   */
  private placeGateArches(): void {
    const plan = this.gameMap.townPlan;
    if (plan === undefined) return;
    for (const gate of plan.gates) {
      const axis: GateArchAxis = gate.bounds.w >= gate.bounds.h ? 'across' : 'along';
      const spanTiles = Math.max(gate.bounds.w, gate.bounds.h);
      const anchor = {
        x: gate.bounds.x - gate.outward.dx * GATEWAY_INSET_TILES,
        y: gate.bounds.y - gate.outward.dy * GATEWAY_INSET_TILES,
      };
      this.renderables.push(new GateArchProp(anchor, spanTiles, axis));
    }
  }

  /** Bunting across the civic terrace and the plaza's Market Street frontage. */
  private placeBunting(): void {
    const centre = this.gameMap.townSquareCentre;
    if (centre === undefined) return;
    BUNTING_SPANS.forEach((span, index) => {
      this.renderables.push(
        new BuntingProp(
          { x: centre.x + span.offset.dx, y: centre.y + span.offset.dy },
          span.spanTiles,
          index,
        ),
      );
    });
  }

  /**
   * Every tile within `LAMP_DOOR_CLEARANCE_TILES` of a door, as a Chebyshev
   * square rather than a circle: the concern is the apron in front of a door,
   * which is square.
   */
  private gatherDoorClearance(): ReadonlySet<string> {
    const clearance = new Set<string>();
    for (const entry of this.gameMap.buildingEntries) {
      for (let dy = -LAMP_DOOR_CLEARANCE_TILES; dy <= LAMP_DOOR_CLEARANCE_TILES; dy++) {
        for (let dx = -LAMP_DOOR_CLEARANCE_TILES; dx <= LAMP_DOOR_CLEARANCE_TILES; dx++) {
          clearance.add(tileKey(entry.doorTile.x + dx, entry.doorTile.y + dy));
        }
      }
    }
    return clearance;
  }

  private canStandOn(tile: TileXY): boolean {
    const key = tileKey(tile.x, tile.y);
    if (this.occupied.has(key) || this.claimedElsewhere.has(key)) return false;
    // `IgnoringPermanent` for the reason `TownPropSystem.findFreeTile` gives: the
    // overworld map instance outlives a trip into a building, so a prop's own
    // block would make re-placement pick a different tile every trip.
    return this.gameMap.isWalkableIgnoringPermanent(tile.x, tile.y);
  }

  private reserve(tile: TileXY): void {
    this.gameMap.blockTilePermanently(tile.x, tile.y);
    this.occupied.add(tileKey(tile.x, tile.y));
    if (this.reachableCache !== null) this.reachableCache--;
  }

  /**
   * True when blocking `candidate` leaves every other walkable tile inside the
   * walls reachable from the plaza.
   *
   * The fill is confined to the wall's interior, which is both far cheaper than
   * flooding the wilderness and a *stricter* property — getting from one part of
   * the town to another must not require walking out of a gate and round the
   * outside.
   */
  private leavesTownConnected(plan: TownPlan, candidate: TileXY): boolean {
    const reachableWithout = this.countReachableInterior(plan, candidate);
    // The candidate itself is the one tile that stops being reachable. Anything
    // more than that is a piece of town this prop would have sealed off.
    return reachableWithout === this.reachableInterior(plan) - 1;
  }

  /**
   * How much of the interior the plaza can reach with everything placed **so
   * far** blocked — memoised, and decremented by one on each successful
   * placement, which `leavesTownConnected` has just proved is the exact effect of
   * blocking that tile.
   *
   * Recomputing it per candidate was half the cost of the whole system and bought
   * nothing: it only changes when a tile is reserved.
   */
  private reachableInterior(plan: TownPlan): number {
    this.reachableCache ??= this.countReachableInterior(plan, null);
    return this.reachableCache;
  }

  /**
   * Tiles the plaza can reach, treating as blocked: the map's own solids, every
   * tile any town system has claimed, and optionally one candidate.
   *
   * **`isWalkableIgnoringPermanent`, not `isWalkable`** — the same choice, and the
   * same reason, as `canStandOn`. `GameMap` outlives a trip into a building
   * (`DungeonScene` hands the existing map back on exit), and `permanentBlockedTiles`
   * only ever grows, so a fill that honoured it would see this system's *previous*
   * run's props as walls. The candidate would then already be unreachable, the
   * count would come out equal rather than one less, and every lamp would be
   * rejected: measured on a reused map, **12 street lamps on the first visit to the
   * town and 0 on every visit after it**, with their tiles left blocked as
   * invisible walls and construction climbing 68 ms → 307 ms by the fifth trip.
   *
   * Reconstructing the claimed set from `occupied` and `claimedElsewhere` instead
   * makes the whole placement idempotent: the same map yields the same props on
   * every trip, which is what the `IgnoringPermanent` comment on `canStandOn`
   * always promised and only half delivered.
   */
  private countReachableInterior(plan: TownPlan, blocked: TileXY | null): number {
    const { interior } = plan;
    const centre = this.gameMap.townSquareCentre;
    if (centre === undefined) return 0;
    const seen = new Set<string>();
    const queue: TileXY[] = [centre];
    seen.add(tileKey(centre.x, centre.y));
    let count = 0;
    while (queue.length > 0) {
      // `pop` rather than `shift`: this is a connectivity count, so the traversal
      // order is irrelevant and `shift` is quadratic on an array queue.
      const tile = queue.pop();
      if (tile === undefined) break;
      count++;
      for (const [dx, dy] of CARDINALS) {
        const nx = tile.x + dx;
        const ny = tile.y + dy;
        if (nx < interior.x || ny < interior.y) continue;
        if (nx >= interior.x + interior.w || ny >= interior.y + interior.h) continue;
        if (blocked !== null && nx === blocked.x && ny === blocked.y) continue;
        const key = tileKey(nx, ny);
        if (seen.has(key)) continue;
        if (this.occupied.has(key) || this.claimedElsewhere.has(key)) continue;
        if (!this.gameMap.isWalkableIgnoringPermanent(nx, ny)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    return count;
  }
}

const CARDINALS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Lamp positions along a street's two kerbs, alternating sides so the street is
 * lit down its length rather than in facing pairs.
 *
 * A street rectangle is longer than it is wide, and which axis that is decides
 * which two edges are kerbs. A square one would be a plaza, not a street, and
 * the plan has none.
 */
function kerbSites(bounds: TileRect): TileXY[] {
  const sites: TileXY[] = [];
  const horizontal = bounds.w >= bounds.h;
  const length = horizontal ? bounds.w : bounds.h;
  const nearEdge = horizontal ? bounds.y : bounds.x;
  const farEdge = horizontal ? bounds.y + bounds.h - 1 : bounds.x + bounds.w - 1;
  let step = 0;
  for (
    let along = LAMP_END_MARGIN_TILES;
    along <= length - 1 - LAMP_END_MARGIN_TILES;
    along += LAMP_STRIDE_TILES
  ) {
    const edge = step % 2 === 0 ? nearEdge : farEdge;
    const start = horizontal ? bounds.x : bounds.y;
    sites.push(horizontal ? { x: start + along, y: edge } : { x: edge, y: start + along });
    step++;
  }
  return sites;
}

/**
 * A sign board bolted to the facade beside a building's door.
 *
 * Its anchor is the **door tile**, which is the building's own front row, so the
 * scene's Y-sort places it against the facade's visual foot — behind a player
 * standing on the street below and in front of the wall it is bolted to.
 * Measured at a 32 px tile, the art reaches 1.47 tiles above the anchor and
 * 1.03 tiles west of it — 2.03 for the two wide doorways, which shift the whole
 * sign a tile further —
 * comfortably inside `RenderPipeline`'s 4-tile prop cull margin.
 *
 * The frame counter is read through a callback rather than copied in, because a
 * prop is constructed once and the system that animates it ticks every frame.
 */
class ShopSignProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly emblem: ShopSignEmblem,
    private readonly westShiftTiles: number,
    private readonly swayPhase: number,
    private readonly currentFrame: () => number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawShopSign(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.emblem,
      this.currentFrame(),
      this.swayPhase,
      this.westShiftTiles,
    );
  }
}

/** A piece of yard or street clutter, standing on and blocking its own tile. */
class ClutterProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly kind: TownClutterKind,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownClutter(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.kind,
    );
  }
}

/**
 * A washing line spanning an alley.
 *
 * Its anchor is the tile at the line's **west end**, and it reaches `spanTiles`
 * east of that and about a tile above it — so it declares its own cull margin
 * rather than relying on the default, which is measured against the anchor and
 * knows nothing about how far a prop spans.
 */
class LaundryLineProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly currentFrame: () => number,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + SPANNING_PROP_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawLaundryLine(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.spanTiles,
      this.currentFrame(),
    );
  }
}

/** A fingerpost standing on and blocking its own tile. */
class SignpostProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly arms: ReadonlyArray<SignpostArm>,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawSignpost(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.arms,
    );
  }
}

/**
 * A stone gateway, anchored at its west (face-on) or north (top-down) jamb.
 *
 * Measured ink at a 32 px tile, anchor-relative: the face-on arch reaches 2.84
 * tiles north and 4.72 east; the top-down gatehouse reaches 4.81 south. Both are
 * outside `RenderPipeline`'s 4-tile default, which is why this class declares its
 * own margin rather than relying on it.
 */
class GateArchProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly axis: GateArchAxis,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + GATEWAY_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawGateArch(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.spanTiles,
      this.axis,
    );
  }
}

/** A string of pennants across a street, anchored at its west end. */
class BuntingProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly spanTiles: number,
    private readonly colorPhase: number,
  ) {}

  get cullMarginTiles(): number {
    return this.spanTiles + SPANNING_PROP_CULL_SLACK_TILES;
  }

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawBunting(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.spanTiles,
      this.colorPhase,
    );
  }
}

/**
 * A lit lamp standing on its own tile.
 *
 * Measured ink, at a 32 px tile: 2.63 tiles above the anchor — more than the
 * 2.3 the geometry constants alone give, because the flame's halo is a
 * `shadowBlur` and blur is not in the geometry — a quarter of a tile past each
 * side, and 3 px below, which is the ground shadow. All inside the 4-tile cull
 * margin, with room to spare.
 */
class StreetLampProp implements TownPropRenderable {
  constructor(
    private readonly tile: TileXY,
    private readonly flickerPhase: number,
    private readonly currentFrame: () => number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawStreetLamp(
      ctx,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
      this.currentFrame(),
      this.flickerPhase,
    );
  }
}
