const FLOOR_TYPES = ['grass', 'road', 'wall', 'water'] as const;
type FloorTile = (typeof FLOOR_TYPES)[number];

const FloorTypeValue = {
  grass: 0,
  road: 1,
  wall: 2,
  water: 4,
} as const satisfies Record<FloorTile, number>;

const floorTypeColors = {
  grass: '#6de89d',
  road: '#bc926b',
  wall: '#212121',
  water: '#2ac6ff',
} as const satisfies Record<FloorTile, `#${string}`>;

type Rarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'celestial';

type InventoryItem =
  | {
      item_id: string;
      name: string;
      type: 'consumable';
      action: 'heal' | 'Apply Buff' | 'Heal Debuff';
      description: string;
      rarity: Rarity;
      rechargeTime: number;
      quanity: number;
    }
  | {
      item_id: string;
      name: string;
      type: 'weapon';
      /** How many tiles this attack reaches */
      range: number;
      /** diameter of the area of effect. Minimum 1. */
      aoe: number;
      /** From where should the AOE be calculated */
      epicenter: 'self' | 'weapon-landing';
      rechargeTime: number;
      /** -1 for weapons that do not use ammo or have infinite */
      ammo: number;
      strengthModification: number;
      rarity: Rarity;
      description: string;
      quanity: number;
    }
  | {
      item_id: string;
      name: string;
      type: 'armor';
      slot:
        | 'head'
        | 'sholders'
        | 'ring'
        | 'helmet'
        | 'neck'
        | 'gloves'
        | 'pants'
        | 'feet'
        | 'back';
      special_effect: string;
      /** How long until the special effect can activate again */
      rechargeTime: number;
      /** Value from 0-1 that determines how much damage the item will mitigate */
      defense: number;
      strengthModification: number;
      speedModification: number;
      constitutionModifier: number;
      intelligenceModifer: number;
      rarity: Rarity;
      description: string;
      quanity: number;
    }
  | {
      item_id: string;
      name: string;
      type: 'quest';
      description: string;
      quanity: number;
    };

type CardinalDirection =
  | 'N'
  | 'NS'
  | 'NE'
  | 'NW'
  | 'SN'
  | 'S'
  | 'SE'
  | 'SW'
  | 'EN'
  | 'ES'
  | 'E'
  | 'EW'
  | 'WN'
  | 'WS'
  | 'WE'
  | 'W';

type Occupant = {
  entity_id: string;
  currentTileId: string;
  direction: CardinalDirection;
  isMoving: boolean;
  type: 'self' | 'ally' | 'enemy' | 'neutral' | 'Non-Combatant NPC';
  sprite: number;
  constitution: number;
  strength: number;
  intelligence: number;
  inventory: InventoryItem[];
};

type TileContent = {
  tileId: string;
  type: number;
};

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;

  constructor(mapSize = 100, tileHeight = 10) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(mapSize);
  }

  private generate(size: number): TileContent[][] {
    return Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: FloorTypeValue.grass,
      })),
    );
  }

  paintMap(parentNode: HTMLElement | null) {
    if (parentNode === null) return;

    const size = this.structure.length;
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${size}, ${this.tileHeight}px)`;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile_content = this.structure[y][x];
        let floorType: FloorTile = 'grass';
        if (tile_content.type === FloorTypeValue.wall) floorType = 'wall';
        else if (tile_content.type === FloorTypeValue.water)
          floorType = 'water';
        else if (tile_content.type === FloorTypeValue.road) floorType = 'road';

        const tile = document.createElement('div');
        tile.id = tile_content.tileId;
        tile.style.backgroundColor = floorTypeColors[floorType];
        tile.style.width = `${this.tileHeight}px`;
        tile.style.height = `${this.tileHeight}px`;
        container.appendChild(tile);
      }
    }

    parentNode.appendChild(container);
  }

  isWalkable(tileX: number, tileY: number): boolean {
    const row = this.structure[tileY];
    if (!row) return false;
    const tile = row[tileX];
    if (!tile) return false;
    return tile.type !== FloorTypeValue.wall && tile.type !== FloorTypeValue.water;
  }

  renderCanvas(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ) {
    const size = this.structure.length;
    const ts = this.tileHeight;
    const startX = Math.max(0, Math.floor(cameraX / ts));
    const startY = Math.max(0, Math.floor(cameraY / ts));
    const endX = Math.min(size - 1, Math.ceil((cameraX + viewW) / ts));
    const endY = Math.min(size - 1, Math.ceil((cameraY + viewH) / ts));

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const tile = this.structure[y][x];
        let floorType: FloorTile = 'grass';
        if (tile.type === FloorTypeValue.wall) floorType = 'wall';
        else if (tile.type === FloorTypeValue.water) floorType = 'water';
        else if (tile.type === FloorTypeValue.road) floorType = 'road';

        ctx.fillStyle = floorTypeColors[floorType];
        ctx.fillRect(x * ts - cameraX, y * ts - cameraY, ts, ts);
      }
    }
  }
}
