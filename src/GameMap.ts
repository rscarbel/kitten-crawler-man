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

export class GameMap {
  structure: number[][];
  tileHeight: number;

  constructor(mapSize = 100, tileHeight = 10) {
    this.tileHeight = tileHeight;
    this.structure = this.generate(mapSize);
  }

  private generate(size: number): number[][] {
    // Step 1: Generate wall regions via cellular automata.
    // Start at 45% random walls — CA smoothing will cluster them into
    // organic cave-like shapes and open up the remaining area as grass.
    let map: number[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () =>
        Math.random() < 0.45 ? FloorTypeValue.wall : FloorTypeValue.grass,
      ),
    );

    for (let pass = 0; pass < 5; pass++) {
      map = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => {
          const walls = this.countNeighbors(
            map,
            x,
            y,
            size,
            FloorTypeValue.wall,
          );
          return walls >= 5 ? FloorTypeValue.wall : FloorTypeValue.grass;
        }),
      );
    }

    // Step 2: Scatter water bodies in open (non-wall) areas via a second CA pass.
    // Seed 20% of open tiles as water, then smooth into lakes/rivers.
    let finalMap: number[][] = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => {
        if (map[y][x] === FloorTypeValue.wall) return FloorTypeValue.wall;
        return Math.random() < 0.8
          ? FloorTypeValue.water
          : FloorTypeValue.grass;
      }),
    );

    for (let pass = 0; pass < 3; pass++) {
      finalMap = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => {
          if (finalMap[y][x] === FloorTypeValue.wall)
            return FloorTypeValue.wall;
          const water = this.countNeighbors(
            finalMap,
            x,
            y,
            size,
            FloorTypeValue.water,
          );
          return water >= 4 ? FloorTypeValue.water : FloorTypeValue.grass;
        }),
      );
    }

    // Step 3: Enforce a solid wall border around the entire map.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x === 0 || x === size - 1 || y === 0 || y === size - 1) {
          finalMap[y][x] = FloorTypeValue.wall;
        }
      }
    }

    // Step 4: Guarantee traversability — keep only the largest connected
    // grass/road region and wall off any isolated pockets.
    this.ensureConnectivity(finalMap, size);

    return finalMap;
  }

  // Count 8-directional neighbors of a given tile type.
  // Out-of-bounds cells count as walls (they seal the map edge).
  private countNeighbors(
    map: number[][],
    x: number,
    y: number,
    size: number,
    tileType: number,
  ): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
          if (tileType === FloorTypeValue.wall) count++;
        } else if (map[ny][nx] === tileType) {
          count++;
        }
      }
    }
    return count;
  }

  // Flood-fill to find all connected walkable regions, then wall off
  // everything except the largest one so no player can get stranded.
  private ensureConnectivity(map: number[][], size: number): void {
    const isWalkable = (v: number) =>
      v === FloorTypeValue.grass || v === FloorTypeValue.road;

    const visited: boolean[][] = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
    const components: [number, number][][] = [];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (visited[y][x] || !isWalkable(map[y][x])) continue;

        const component: [number, number][] = [];
        const queue: [number, number][] = [[x, y]];
        visited[y][x] = true;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          component.push([cx, cy]);
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ] as [number, number][]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (
              nx >= 0 &&
              nx < size &&
              ny >= 0 &&
              ny < size &&
              !visited[ny][nx] &&
              isWalkable(map[ny][nx])
            ) {
              visited[ny][nx] = true;
              queue.push([nx, ny]);
            }
          }
        }

        components.push(component);
      }
    }

    if (components.length === 0) return;

    const largest = components.reduce((a, b) => (a.length > b.length ? a : b));

    for (const component of components) {
      if (component === largest) continue;
      for (const [x, y] of component) {
        map[y][x] = FloorTypeValue.wall;
      }
    }
  }

  paintMap(parentNode: HTMLElement | null) {
    if (parentNode === null) return;

    const size = this.structure.length;
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${size}, ${this.tileHeight}px)`;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = this.structure[y][x];
        let floorType: FloorTile = 'grass';
        if (value === FloorTypeValue.wall) floorType = 'wall';
        else if (value === FloorTypeValue.water) floorType = 'water';
        else if (value === FloorTypeValue.road) floorType = 'road';

        const tile = document.createElement('div');
        tile.style.backgroundColor = floorTypeColors[floorType];
        tile.style.width = `${this.tileHeight}px`;
        tile.style.height = `${this.tileHeight}px`;
        container.appendChild(tile);
      }
    }

    parentNode.appendChild(container);
  }
}
