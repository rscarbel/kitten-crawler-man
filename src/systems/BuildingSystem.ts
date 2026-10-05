import type { GameMap } from '../map/GameMap';
import type { BuildingKind } from '../map/town/townPlan';
import { TILE_SIZE } from '../core/constants';
import { tileCoordKey } from '../map/tileIndex';

/** Sentinel index meaning the player is not standing on any building's door. */
const NO_DOOR_HERE = -1;
import type { GameSystem, SystemContext } from './GameSystem';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import { viewportWidth, viewportHeight } from '../core/Viewport';

export type BuildingEntry = {
  doorTile: { x: number; y: number };
  name: string;
  type: BuildingKind;
  /** Whether this building's interior hosts the town's safe room. */
  readonly hasSafeRoom?: boolean;
  /** Westmost column of the opening; absent means the opening is `doorTile` alone. */
  doorwayX0?: number;
  /** Tiles wide the opening is; absent means one. */
  doorwayWidth?: number;
};

/** An entry with neither doorway field opens on its `doorTile` and nothing else. */
const SINGLE_TILE_DOORWAY_WIDTH = 1;

/**
 * A door the scene is holding shut, and what to say when the player tries it.
 *
 * Supplied by the scene rather than decided here so `BuildingSystem` never has
 * to know which questline is at which stage: it owns doorways, and the quest
 * that seals one owns the reason.
 */
export interface BuildingEntryGate {
  /** The refusal to show for this entry, or null when the door is open. */
  blockedMessage(entry: BuildingEntry): string | null;
  /** Runs once per doorway visit when a sealed door is stepped on. */
  onRefused(message: string): void;
}

/**
 * The refusal every doorway gives while the crawler the player is not
 * driving lies knocked out, or null while they are up.
 *
 * A body cannot be carried through a door, and a partner left bleeding out
 * on the step while the other shops inside is a run lost to a menu. So no
 * building opens until they are helped up, whichever building it is.
 */
export function downedPartnerEntryRefusal(
  partner: { readonly isKnockedOut: boolean },
  partnerName: string,
): string | null {
  return partner.isKnockedOut ? `${partnerName} is down. Help them up before going inside.` : null;
}

/**
 * The span of tiles an entrance opens on, as `[x0, x0 + width)` at `doorTile.y`.
 *
 * Both fields are read together and both default together: an entry carrying a
 * width but no start column would otherwise silently open a span beginning at
 * the map's west edge.
 */
export function doorwaySpan(entry: BuildingEntry): { readonly x0: number; readonly width: number } {
  if (entry.doorwayX0 === undefined || entry.doorwayWidth === undefined) {
    return { x0: entry.doorTile.x, width: SINGLE_TILE_DOORWAY_WIDTH };
  }
  return { x0: entry.doorwayX0, width: entry.doorwayWidth };
}

/** Tile center fraction for player position calculation. */
const TILE_CENTER_FRAC = 0.5;
/** Arrow size as fraction of tile size. */
const ARROW_SIZE_FRACTION = 0.55;
/** Alpha base for door hint pulse animation. */
const DOOR_HINT_PULSE_BASE = 0.6;
/** Alpha range for door hint pulse animation. */
const DOOR_HINT_PULSE_RANGE = 0.3;
/** Pulse period for door hints in ms. */
const DOOR_HINT_PULSE_PERIOD = 600;
/** Fraction of tile size used for building name label y offset. */
const BUILDING_NAME_Y_FRACTION = 0.6;
/** Multiplier for name label alpha. */
const BUILDING_NAME_ALPHA_MULT = 0.85;
const BUILDING_NAME_SIZE = 11;
/** Arrow y offset from door in pixels. */
const ARROW_Y_OFFSET = 4;

export class BuildingSystem implements GameSystem {
  private onDoor = false;
  private _menuOpen = false;
  private activeDoorIdx = NO_DOOR_HERE;
  /** The entry the player stood on last frame, so stepping between two is noticed. */
  private doorUnderfoot = NO_DOOR_HERE;
  /** Whether that door was sealed last frame, so a door opening under them is noticed. */
  private sealedHere = false;

  /** Doorway tile → index in `gameMap.buildingEntries`, so the per-frame on-door
   * test is one lookup rather than a scan of every entrance in town. Every tile
   * of an entrance's opening is a key, not just its `doorTile`. */
  private readonly entryIndexByDoorTile: ReadonlyMap<number, number>;

  constructor(
    private readonly gameMap: GameMap,
    private readonly onEnterBuilding: (entry: BuildingEntry) => void,
    private readonly entryGate: BuildingEntryGate | null = null,
  ) {
    const byDoorTile = new Map<number, number>();
    gameMap.buildingEntries.forEach((entry, index) => {
      const { x0, width } = doorwaySpan(entry);
      for (let x = x0; x < x0 + width; x++) {
        // First match wins — two entries sharing a door tile are guarded
        // against but not impossible.
        const key = tileCoordKey(x, entry.doorTile.y);
        if (!byDoorTile.has(key)) byDoorTile.set(key, index);
      }
    });
    this.entryIndexByDoorTile = byDoorTile;
  }

  get menuOpen(): boolean {
    return this._menuOpen;
  }

  /**
   * Leave: shut the menu and leave it shut.
   *
   * Nothing else is needed to keep it that way — `detect` only acts when the
   * door under the player changes or changes its mind, and standing still on a
   * door the player just refused is neither.
   */
  closeMenu(): void {
    this._menuOpen = false;
  }

  /** The building whose entry prompt is up, or null while it is down. */
  get menuEntry(): BuildingEntry | null {
    if (!this._menuOpen) return null;
    return this.gameMap.buildingEntries[this.activeDoorIdx] ?? null;
  }

  /** The prompt's Enter. */
  enterActiveBuilding(): void {
    const entry = this.menuEntry;
    if (entry !== null) this.onEnterBuilding(entry);
  }

  update(ctx: SystemContext): void {
    this.detect(ctx.active);
  }

  /** Called each gameplay frame. Detects when the active player is on a door tile. */
  detect(active: { x: number; y: number }): void {
    const entries = this.gameMap.buildingEntries;
    if (entries.length === 0) return;

    const tx = Math.floor((active.x + TILE_SIZE * TILE_CENTER_FRAC) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * TILE_CENTER_FRAC) / TILE_SIZE);

    const idx = this.entryIndexByDoorTile.get(tileCoordKey(tx, ty)) ?? NO_DOOR_HERE;
    const wasOn = this.onDoor;
    this.onDoor = idx !== NO_DOOR_HERE;

    if (!this.onDoor) {
      this._menuOpen = false;
      this.activeDoorIdx = NO_DOOR_HERE;
      this.doorUnderfoot = NO_DOOR_HERE;
      this.sealedHere = false;
      return;
    }

    const refusal = this.blockedMessageFor(entries[idx]);
    const sealed = refusal !== null;
    // Two doorways can share an edge, and stepping straight from one onto the
    // next never lifts the player off door ground — so "did I just arrive" has
    // to be about *which* door, not merely about being on one.
    const arrived = !wasOn || idx !== this.doorUnderfoot;
    // A quest can unseal a door under the player's own feet: the wave that opens
    // the Big Top can die while they are standing on its mat. That is worth
    // asking again about, and it is the only thing besides arriving that is.
    const answerChanged = !arrived && sealed !== this.sealedHere;
    this.doorUnderfoot = idx;
    this.sealedHere = sealed;

    // Past here the player has either walked onto a door or had one change its
    // mind under them. Nothing else re-opens a menu they already answered.
    if (!arrived && !answerChanged) return;

    if (sealed) {
      // One refusal per arrival, for the same reason the menu opens once: the
      // gate above only lets a genuine change through. And a door that seals
      // while its own menu is up takes the menu with it.
      this._menuOpen = false;
      this.activeDoorIdx = NO_DOOR_HERE;
      this.entryGate?.onRefused(refusal);
      return;
    }
    this.activeDoorIdx = idx;
    this._menuOpen = true;
  }

  private blockedMessageFor(entry: BuildingEntry | undefined): string | null {
    if (entry === undefined) return null;
    return this.entryGate?.blockedMessage(entry) ?? null;
  }

  /** Renders a pulsing ▶ door indicator above each building entrance. */
  renderDoorHints(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const ts = TILE_SIZE;
    const pulse =
      DOOR_HINT_PULSE_BASE + Math.sin(Date.now() / DOOR_HINT_PULSE_PERIOD) * DOOR_HINT_PULSE_RANGE;
    for (const entry of this.gameMap.buildingEntries) {
      // A sealed door does not advertise itself: the arrow and the name are an
      // invitation, and pointing the player at a door that refuses them is worse
      // than saying nothing.
      if (this.blockedMessageFor(entry) !== null) continue;
      const { x0, width } = doorwaySpan(entry);
      // Centred on the whole opening rather than on `doorTile`: on a four-tile
      // front those are two tiles apart, and an arrow that does not sit over the
      // painted door is the game pointing at the wrong place to stand.
      const sx = Math.round((x0 + width / 2) * ts) - camX;
      const sy = entry.doorTile.y * ts - camY;
      const CULLING_HEIGHT_TILES = 3;
      if (
        sx < -ts ||
        sx > viewportWidth() + ts ||
        sy < -ts * CULLING_HEIGHT_TILES ||
        sy > viewportHeight() + ts
      )
        continue;

      const arrowSize = Math.floor(ts * ARROW_SIZE_FRACTION);
      const ARROW_TEXT_ADJUST_FRACTION = 0.8;
      worldText(ctx, '▶', {
        x: sx,
        y: sy - ARROW_Y_OFFSET - Math.round(arrowSize * ARROW_TEXT_ADJUST_FRACTION),
        size: arrowSize,
        bold: true,
        color: worldPalette.waymark.doorArrow,
        alpha: pulse,
        align: 'center',
      });

      const BUILDING_NAME_TEXT_ADJUST = 9;
      const BUILDING_NAME_Y_EXTRA = 2;
      worldText(ctx, entry.name, {
        x: sx,
        y: sy - ts * BUILDING_NAME_Y_FRACTION - BUILDING_NAME_Y_EXTRA - BUILDING_NAME_TEXT_ADJUST,
        size: BUILDING_NAME_SIZE,
        color: worldPalette.waymark.doorName,
        alpha: pulse * BUILDING_NAME_ALPHA_MULT,
        align: 'center',
      });
    }
  }
}
