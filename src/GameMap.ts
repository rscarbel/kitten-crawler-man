const FLOOR_TYPES = ['grass', 'road', 'wall', 'water', 'concrete', 'tile_floor', 'carpet', 'wood'] as const;
type FloorTile = (typeof FLOOR_TYPES)[number];

const FloorTypeValue = {
  grass: 0,
  road: 1,
  wall: 2,
  water: 4,
  concrete: 5,
  tile_floor: 6,
  carpet: 7,
  wood: 8,
} as const satisfies Record<FloorTile, number>;

// Used only by legacy paintMap()
const floorTypeColors = {
  grass: '#6de89d',
  road: '#bc926b',
  wall: '#2c2420',
  water: '#2ac6ff',
  concrete: '#b0ada8',
  tile_floor: '#d5cdb8',
  carpet: '#6e2418',
  wood: '#9e6e3a',
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

type Room = { x: number; y: number; w: number; h: number; floor: number };

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;
  /** Tile coordinates where the player should spawn (centre of the first room). */
  startTile: { x: number; y: number } = { x: 15, y: 15 };
  /** Tile centres of all rooms except the start room — used for mob placement. */
  mobSpawnPoints: Array<{ x: number; y: number }> = [];

  constructor(mapSize = 100, tileHeight = 10) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(mapSize);
  }

  private generate(size: number): TileContent[][] {
    return this.generateDungeon(size);
  }

  private generateDungeon(size: number): TileContent[][] {
    const BORDER = 5;
    const DUNGEON_FLOORS = [
      FloorTypeValue.concrete,
      FloorTypeValue.tile_floor,
      FloorTypeValue.carpet,
      FloorTypeValue.wood,
    ];

    // 1. Fill everything with wall tiles
    const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: FloorTypeValue.wall,
      })),
    );

    // 2. Grass border around the outside
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (y < BORDER || y >= size - BORDER || x < BORDER || x >= size - BORDER) {
          grid[y][x].type = FloorTypeValue.grass;
        }
      }
    }

    // 3. Room carving helper
    const carveRoom = (r: Room) => {
      for (let ry = r.y; ry < r.y + r.h; ry++) {
        for (let rx = r.x; rx < r.x + r.w; rx++) {
          grid[ry][rx].type = r.floor;
        }
      }
    };

    // 4. L-shaped 3-tile-wide hallway carver
    const carveHallway = (x1: number, y1: number, x2: number, y2: number) => {
      // Horizontal leg first (y stays at y1)
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      for (let hx = minX; hx <= maxX; hx++) {
        for (let off = -1; off <= 1; off++) {
          const hy = y1 + off;
          if (hy >= BORDER && hy < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
            grid[hy][hx].type = FloorTypeValue.concrete;
          }
        }
      }
      // Vertical leg (x stays at x2)
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      for (let hy = minY; hy <= maxY; hy++) {
        for (let off = -1; off <= 1; off++) {
          const hx = x2 + off;
          if (hx >= BORDER && hx < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
            grid[hy][hx].type = FloorTypeValue.concrete;
          }
        }
      }
    };

    // 5. Place rooms
    const rooms: Room[] = [];
    const MIN_W = 8, MAX_W = 16;
    const MIN_H = 7, MAX_H = 14;
    const GAP = 3; // minimum tile gap between room edges

    for (let attempt = 0; attempt < 80 && rooms.length < 15; attempt++) {
      const w = MIN_W + Math.floor(Math.random() * (MAX_W - MIN_W + 1));
      const h = MIN_H + Math.floor(Math.random() * (MAX_H - MIN_H + 1));
      const x = BORDER + 1 + Math.floor(Math.random() * (size - BORDER * 2 - w - 2));
      const y = BORDER + 1 + Math.floor(Math.random() * (size - BORDER * 2 - h - 2));

      const overlaps = rooms.some(
        r =>
          x < r.x + r.w + GAP &&
          x + w + GAP > r.x &&
          y < r.y + r.h + GAP &&
          y + h + GAP > r.y,
      );

      if (!overlaps) {
        const floor = DUNGEON_FLOORS[Math.floor(Math.random() * DUNGEON_FLOORS.length)];
        const room: Room = { x, y, w, h, floor };
        rooms.push(room);
        carveRoom(room);

        // Connect to previous room with a hallway
        if (rooms.length > 1) {
          const prev = rooms[rooms.length - 2];
          carveHallway(
            Math.floor(prev.x + prev.w / 2),
            Math.floor(prev.y + prev.h / 2),
            Math.floor(x + w / 2),
            Math.floor(y + h / 2),
          );
        }
      }
    }

    // 6. Record spawn locations
    if (rooms.length > 0) {
      const r = rooms[0];
      this.startTile = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
    }

    this.mobSpawnPoints = rooms.slice(1).map(r => ({
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
    }));

    return grid;
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
        else if (tile_content.type === FloorTypeValue.water) floorType = 'water';
        else if (tile_content.type === FloorTypeValue.road) floorType = 'road';
        else if (tile_content.type === FloorTypeValue.concrete) floorType = 'concrete';
        else if (tile_content.type === FloorTypeValue.tile_floor) floorType = 'tile_floor';
        else if (tile_content.type === FloorTypeValue.carpet) floorType = 'carpet';
        else if (tile_content.type === FloorTypeValue.wood) floorType = 'wood';

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
        const sx = x * ts - cameraX;
        const sy = y * ts - cameraY;
        this.drawTile(ctx, tile.type, sx, sy, ts, x, y);
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    type: number,
    sx: number,
    sy: number,
    ts: number,
    tx: number,
    ty: number,
  ) {
    switch (type) {
      // ── Outdoors ─────────────────────────────────────────────────────────
      case FloorTypeValue.grass: {
        ctx.fillStyle = '#6de89d';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }
      case FloorTypeValue.road: {
        ctx.fillStyle = '#bc926b';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }
      case FloorTypeValue.water: {
        ctx.fillStyle = '#2ac6ff';
        ctx.fillRect(sx, sy, ts, ts);
        break;
      }

      // ── Dungeon wall ──────────────────────────────────────────────────────
      case FloorTypeValue.wall: {
        // Dark brick/concrete base
        ctx.fillStyle = '#2e2420';
        ctx.fillRect(sx, sy, ts, ts);
        // Lit top face — simulates overhead light catching the wall top
        ctx.fillStyle = '#4e3e34';
        ctx.fillRect(sx, sy, ts, 3);
        // Subtle left edge highlight
        ctx.fillStyle = '#3c3028';
        ctx.fillRect(sx, sy, 2, ts);
        // Horizontal mortar seam in the middle
        ctx.fillStyle = '#1c1814';
        ctx.fillRect(sx, sy + Math.floor(ts / 2), ts, 1);
        // Staggered vertical mortar (brick bond pattern)
        const brickOff = (ty % 2 === 0) ? 0 : Math.floor(ts / 2);
        const vx = sx + (brickOff % ts);
        if (vx >= sx && vx < sx + ts) {
          ctx.fillRect(vx, sy + 3, 1, Math.floor(ts / 2) - 3);
        }
        break;
      }

      // ── Dungeon floors ────────────────────────────────────────────────────

      // Poured concrete — hallways, utility rooms
      case FloorTypeValue.concrete: {
        const shade = (tx + ty) % 2 === 0 ? '#b4b0ab' : '#aaa7a2';
        ctx.fillStyle = shade;
        ctx.fillRect(sx, sy, ts, ts);
        // Expansion-joint seams every 2 tiles
        ctx.fillStyle = '#909088';
        if (tx % 2 === 0) ctx.fillRect(sx, sy, 1, ts);
        if (ty % 2 === 0) ctx.fillRect(sx, sy, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Ceramic tile — offices, bathrooms
      case FloorTypeValue.tile_floor: {
        const even = (tx + ty) % 2 === 0;
        ctx.fillStyle = even ? '#d8d0b8' : '#cac2aa';
        ctx.fillRect(sx, sy, ts, ts);
        // Grout lines
        ctx.fillStyle = '#9c9078';
        ctx.fillRect(sx + ts - 1, sy, 1, ts);
        ctx.fillRect(sx, sy + ts - 1, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Carpet — conference rooms, executive offices
      case FloorTypeValue.carpet: {
        const even = (tx + ty) % 2 === 0;
        ctx.fillStyle = even ? '#6e2418' : '#7a2c1e';
        ctx.fillRect(sx, sy, ts, ts);
        // Weave texture: thin cross-lines
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(sx, sy, 1, ts);
        ctx.fillRect(sx, sy, ts, 1);
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }

      // Hardwood — break rooms, reception
      case FloorTypeValue.wood: {
        const plankGroup = Math.floor(ty / 2) % 3;
        const plankColors = ['#9e6e3a', '#8e6030', '#aa7840'] as const;
        ctx.fillStyle = plankColors[plankGroup];
        ctx.fillRect(sx, sy, ts, ts);
        // Left plank seam
        ctx.fillStyle = '#5a3818';
        ctx.fillRect(sx, sy, 1, ts);
        // Horizontal wood grain
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let g = 6; g < ts; g += 7) {
          ctx.fillRect(sx + 1, sy + g, ts - 1, 1);
        }
        this.drawWallShadow(ctx, sx, sy, ts, tx, ty);
        break;
      }
    }
  }

  /** Draws a shadow strip on floor tiles directly below or right of a wall. */
  private drawWallShadow(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ts: number,
    tx: number,
    ty: number,
  ) {
    const above = this.structure[ty - 1]?.[tx];
    if (above && above.type === FloorTypeValue.wall) {
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fillRect(sx, sy, ts, 8);
    }
    const left = this.structure[ty]?.[tx - 1];
    if (left && left.type === FloorTypeValue.wall) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx, sy, 6, ts);
    }
  }
}
