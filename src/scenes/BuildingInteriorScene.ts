import { Scene, SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { LevelDef } from '../levels/types';
import type { BuildingEntry } from '../systems/BuildingSystem';
import {
  snapPlayer,
  restorePlayer,
  type PlayerSnapshot,
} from '../core/PlayerSnapshot';
import { drawHUD } from '../ui/HUD';

export class BuildingInteriorScene extends Scene {
  private readonly map: GameMap;
  private readonly human: HumanPlayer;
  private readonly cat: CatPlayer;
  private readonly mapW: number;
  private readonly mapH: number;

  // Exit menu state
  private onExitTile = false;
  private exitMenuOpen = false;
  private exitDismissed = false;

  // Key handler cleanup
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  // Notif pulse (unused but needed for HUD signature)
  private readonly notifPulse = { value: 0 };

  constructor(
    private readonly entry: BuildingEntry,
    private readonly returnLevelDef: LevelDef,
    private readonly returnTile: { x: number; y: number },
    humanSnap: PlayerSnapshot,
    catSnap: PlayerSnapshot,
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
    private readonly overworldMap: GameMap,
  ) {
    super();

    // Build tiny interior map
    this.map = new GameMap(0, TILE_SIZE, 0, 0);
    this.map.generateInterior(entry.type);

    this.mapW = this.map.structure[0]?.length ?? 18;
    this.mapH = this.map.structure.length;

    const { x: sx, y: sy } = this.map.startTile;
    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.cat.setMap(this.map);
    this.human.isActive = true;

    restorePlayer(this.human, humanSnap);
    restorePlayer(this.cat, catSnap);

    // Re-position after restore (restore overwrites x/y via base class... actually no
    // — restore doesn't set x/y since we snap stat fields only). Spawn is already set.
    this.human.x = sx * TILE_SIZE;
    this.human.y = sy * TILE_SIZE;
    this.cat.x = (sx + 1) * TILE_SIZE;
    this.cat.y = sy * TILE_SIZE;
  }

  onEnter(): void {
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (this.exitMenuOpen) {
        this.exitMenuOpen = false;
        this.exitDismissed = true;
      }
    };
    window.addEventListener('keydown', this.escHandler);
  }

  onExit(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
  }

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }
  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }

  update(): void {
    if (this.exitMenuOpen) return;

    const player = this.active();
    const mapPxW = this.mapW * TILE_SIZE;
    const mapPxH = this.mapH * TILE_SIZE;

    // Movement
    let dx = 0;
    let dy = 0;
    if (this.input.has('ArrowUp') || this.input.has('w')) dy -= 1;
    if (this.input.has('ArrowDown') || this.input.has('s')) dy += 1;
    if (this.input.has('ArrowLeft') || this.input.has('a')) dx -= 1;
    if (this.input.has('ArrowRight') || this.input.has('d')) dx += 1;

    player.isMoving = dx !== 0 || dy !== 0;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }
    dx *= PLAYER_SPEED;
    dy *= PLAYER_SPEED;

    const nextX = Math.max(0, Math.min(mapPxW - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE * 0.5) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
    if (this.map.isWalkable(tileXnext, tileYcur)) player.x = nextX;

    const nextY = Math.max(0, Math.min(mapPxH - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE * 0.5) / TILE_SIZE);
    if (this.map.isWalkable(tileXcur, tileYnext)) player.y = nextY;

    // Companion follow (simple — just nudge toward active player)
    const follower = this.inactive();
    const fdx = player.x - follower.x;
    const fdy = player.y - follower.y;
    const fdist = Math.hypot(fdx, fdy);
    if (fdist > TILE_SIZE * 1.5) {
      const spd = 3.5;
      const fmx = (fdx / fdist) * spd;
      const fmy = (fdy / fdist) * spd;
      const fnx = Math.max(0, Math.min(mapPxW - TILE_SIZE, follower.x + fmx));
      const ftxn = Math.floor((fnx + TILE_SIZE * 0.5) / TILE_SIZE);
      if (
        this.map.isWalkable(
          ftxn,
          Math.floor((follower.y + TILE_SIZE * 0.5) / TILE_SIZE),
        )
      )
        follower.x = fnx;
      const fny = Math.max(0, Math.min(mapPxH - TILE_SIZE, follower.y + fmy));
      const ftyn = Math.floor((fny + TILE_SIZE * 0.5) / TILE_SIZE);
      if (
        this.map.isWalkable(
          Math.floor((follower.x + TILE_SIZE * 0.5) / TILE_SIZE),
          ftyn,
        )
      )
        follower.y = fny;
    }
    follower.isMoving = fdist > TILE_SIZE * 1.5;

    // Tab: switch active player
    if (this.input.has('Tab')) {
      this.input.clear();
      this.human.isActive = !this.human.isActive;
      this.cat.isActive = !this.cat.isActive;
    }

    // Update walk animation
    this.human.tickTimers();
    this.cat.tickTimers();

    // Exit tile detection
    const ptx = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const pty = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
    const wasOnExit = this.onExitTile;
    this.onExitTile = this.map._interiorExitTiles.some(
      (t) => t.x === ptx && t.y === pty,
    );
    if (!this.onExitTile) {
      this.exitDismissed = false;
    } else if (!wasOnExit && !this.exitDismissed) {
      this.exitMenuOpen = true;
    }
  }

  handleClick(mx: number, my: number): void {
    if (!this.exitMenuOpen) return;
    const canvas = this.sceneManager.canvas;
    const rects = this.menuRects(canvas);
    if (
      mx >= rects.exit.x &&
      mx <= rects.exit.x + rects.exit.w &&
      my >= rects.exit.y &&
      my <= rects.exit.y + rects.exit.h
    ) {
      this.doExit();
    } else if (
      mx >= rects.stay.x &&
      mx <= rects.stay.x + rects.stay.w &&
      my >= rects.stay.y &&
      my <= rects.stay.y + rects.stay.h
    ) {
      this.exitMenuOpen = false;
      this.exitDismissed = true;
    }
  }

  private doExit(): void {
    const humanSnap = snapPlayer(this.human);
    const catSnap = snapPlayer(this.cat);
    // Lazy import to avoid circular dependency — DungeonScene imports BuildingInteriorScene
    import('../scenes/DungeonScene').then(({ DungeonScene }) => {
      this.sceneManager.replace(
        new DungeonScene(this.returnLevelDef, this.input, this.sceneManager, {
          spawnAt: this.returnTile,
          humanSnap,
          catSnap,
          existingMap: this.overworldMap,
        }),
      );
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const canvas = this.sceneManager.canvas;
    const { x: camX, y: camY } = this.camera(canvas);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.map.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);

    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    // Exit hint above door
    this.renderExitHint(ctx, camX, camY);

    drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse, false);

    // Interior label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, 28);
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Inside: ${this.entry.name}`, canvas.width / 2, 18);
    ctx.textAlign = 'left';

    if (this.exitMenuOpen) this.renderExitMenu(ctx, canvas);
  }

  private camera(canvas: HTMLCanvasElement): { x: number; y: number } {
    const player = this.active();
    const mapPxW = this.mapW * TILE_SIZE;
    const mapPxH = this.mapH * TILE_SIZE;
    const cx = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const cy = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x:
        mapPxW <= canvas.width
          ? (mapPxW - canvas.width) / 2
          : Math.max(0, Math.min(mapPxW - canvas.width, cx)),
      y:
        mapPxH <= canvas.height
          ? (mapPxH - canvas.height) / 2
          : Math.max(0, Math.min(mapPxH - canvas.height, cy)),
    };
  }

  private renderExitHint(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    const pulse = 0.6 + Math.sin(Date.now() / 500) * 0.3;
    for (const t of this.map._interiorExitTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      ctx.fillStyle = `rgba(250,220,80,${pulse})`;
      ctx.font = `bold ${Math.floor(TILE_SIZE * 0.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx, sy - 2);
      ctx.textAlign = 'left';
    }
  }

  private renderExitMenu(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#0d1a09';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('▼  Exit Building  ▼', cw / 2, panelY + 36);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`Leave ${this.entry.name}?`, cw / 2, panelY + 68);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.fillText('(Esc or Stay to remain inside)', cw / 2, panelY + 88);

    const rects = this.menuRects(canvas);

    ctx.fillStyle = '#1a4d0d';
    ctx.fillRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.exit.x, rects.exit.y, rects.exit.w, rects.exit.h);
    ctx.fillStyle = '#d4edaa';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Exit', rects.exit.x + rects.exit.w / 2, rects.exit.y + 27);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Stay', rects.stay.x + rects.stay.w / 2, rects.stay.y + 27);

    ctx.textAlign = 'left';
  }

  private menuRects(canvas: HTMLCanvasElement) {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
    const btnY = panelY + 110;
    return {
      exit: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
    };
  }
}
