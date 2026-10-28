/**
 * The tutorial's physical gates: four iron portcullises, the low fence whose
 * double gate swings open, and the solid cellar door that shuts goblin B in.
 * Each is unlocked by a step of the tutorial, then opens by its own
 * {@link GateOpenRule}: at once, once no dialog box is open, once it is wholly
 * in view, or once the crawler it is for walks up to it. Either way the
 * player sees it open and never has to stop and wait at it.
 *
 * Every tile under a gate is plain floor so a Magic Missile can cross a shut
 * one. The gates block by clamping crawler positions instead, and the clamp
 * follows the gate's physical state: it lifts only once the grille is high
 * enough, or a fence's or door's leaves far enough round, to walk through.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  TUTORIAL_GATE_G1,
  TUTORIAL_GATE_G2,
  TUTORIAL_GATE_G3,
  TUTORIAL_GOBLIN_B_DOOR,
  TUTORIAL_GATE_SAFE_ENTRANCE,
  TUTORIAL_GATE_SEISMIC_STOMP,
} from '../map/TutorialMap';
import {
  GATE_DUST_FRAMES,
  TUTORIAL_FENCE_HEIGHT_TILES,
  TUTORIAL_PORTCULLIS_ABOVE_ROW_TILES,
  TUTORIAL_PORTCULLIS_OVERHANG_PX,
  TUTORIAL_PORTCULLIS_REACH_TILES,
  cellarDoorLeafFootTiles,
  cellarFenceLeafFootTiles,
  drawCellarDoorFrame,
  drawCellarDoorLeaf,
  TUTORIAL_DOOR_ABOVE_ROW_TILES,
  drawCellarFenceFrame,
  drawCellarFenceLeaf,
  type CellarFenceLeaf,
  drawGateDust,
  drawPortcullisFaceOnTile,
  drawPortcullisSideTile,
} from '../map/tiles/tutorialGateArt';
import type { TownPropRenderable } from './townPropRenderable';
import type { TutorialCue, TutorialCueAt } from './tutorialSoundCues';

export type TutorialGateId = 'safeEntrance' | 'g1' | 'seismic_stomp' | 'fence' | 'goblinB' | 'g3';

/** Which crawler walking up to a gate makes it open. */
type GateCrawler = 'human' | 'cat' | 'either';
type GateKind = 'faceOn' | 'side' | 'fence' | 'door';
/**
 * What it takes for an unlocked gate to start opening:
 * - `approach`: its crawler walking up to it, with the gate on screen;
 * - `noDialog`: nothing more than every dialog box being closed;
 * - `fullyInView`: the whole of its art being inside the view, so the
 *   player sees it rise well before they get there;
 * - `atOnce`: nothing; it opens the frame it unlocks.
 */
type GateOpenRule = 'approach' | 'noDialog' | 'fullyInView' | 'atOnce';

/** What a gate can see of the scene this frame. */
export interface TutorialGateView {
  /** The view's top-left in world pixels. */
  readonly camera: { readonly x: number; readonly y: number };
  /** Whether a dialog box or any other surface over the world is open. */
  readonly dialogOpen: boolean;
}
type GatePhase = 'closed' | 'opening' | 'open';
type Crawler = HumanPlayer | CatPlayer;

/**
 * One way a shut gate holds a crawler back: `limitPx` caps the crawler's
 * position along `axis` (`max` from the near side, `min` from the far side),
 * while the crawler is inside `band` across the other axis.
 */
interface GateClamp {
  readonly who: 'human' | 'cat';
  readonly axis: 'x' | 'y';
  readonly bound: 'max' | 'min';
  readonly limitPx: number;
  readonly bandFromPx: number;
  readonly bandToPx: number;
}

interface GateDef {
  readonly id: TutorialGateId;
  readonly kind: GateKind;
  readonly crawler: GateCrawler;
  readonly opens: GateOpenRule;
  /** The gate's tiles: a row for a face-on gate or the fence, a column for a side gate. */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly clamps: readonly GateClamp[];
}

interface GateState {
  readonly def: GateDef;
  unlocked: boolean;
  phase: GatePhase;
  /** Frames since the gate began to open. */
  frame: number;
  /** Frames left before a shut gate may rattle again. */
  rattleCooldown: number;
}

const FRAMES_PER_SECOND = 60;
const HALF = 0.5;

/** A portcullis winds up over half a second, fast at first and easing into the headbox. */
const PORTCULLIS_RAISE_FRAMES = FRAMES_PER_SECOND * HALF;
/** The fence's leaves swing a touch slower: they are pushed, not winched. */
const FENCE_SWING_SECONDS = 0.6;
const FENCE_SWING_FRAMES = Math.round(FRAMES_PER_SECOND * FENCE_SWING_SECONDS);
/** After reaching the top, the grille drops a little and settles back. */
const SETTLE_FRAMES = 9;
const SETTLE_DIP = 0.06;
const EASE_OUT_POWER = 3;

/**
 * How far open a portcullis must be before the clamp lifts. By then the rest
 * of the rise takes longer than a crawler needs to cover the half tile from
 * the clamp line to the grille's slot, so the bars are wound up before
 * anyone reaches them.
 */
const PORTCULLIS_PASSABLE_FRACTION = 0.8;
/** How far round a fence's or a door's leaves must swing before the gap is wide enough to walk through. */
const SWING_PASSABLE_FRACTION = 0.6;
/** A heavy door swings open slower than the fence's light gate. */
const DOOR_SWING_SECONDS = 0.8;
const DOOR_SWING_FRAMES = Math.round(FRAMES_PER_SECOND * DOOR_SWING_SECONDS);
/** Slack on top of the distance covered while the gate opens, so it is clear a step early. */
const TRIGGER_MARGIN_TILES = 1;
const TRIGGER_MARGIN_PX = TRIGGER_MARGIN_TILES * TILE_SIZE;
/** A crawler pushing at a shut gate rattles it at most this often. */
const RATTLE_COOLDOWN_FRAMES = 75;
/** The least a clamp must move a crawler to count as walking into the gate. */
const BUMP_EPSILON_PX = 0.01;
/**
 * How far past a clamp line a crawler can be and still be pushed back to it.
 * One frame's step never comes near this, so nobody walks through; anyone
 * further on was never on the near side.
 */
const CLAMP_HOLD_REACH_TILES = 2;
const CLAMP_HOLD_REACH_PX = CLAMP_HOLD_REACH_TILES * TILE_SIZE;
/** Clamps reach a tile past the gate's ends, so nobody slips by against the hallway wall. */
const CLAMP_BAND_BUFFER_TILES = 1;
/** Slack on each gate piece's cull margin past the reach of its art. */
const CULL_MARGIN_PAD_TILES = 1;
/**
 * The fence is drawn ahead of anyone standing just north of it. Its rail is
 * too low to hide them, and the cat's missiles are painted with her body, so
 * only a fence drawn before her lets a missile be seen crossing over it.
 */
const FENCE_SORT_LEAD_TILES = 1;
const FENCE_SORT_LEAD_PX = FENCE_SORT_LEAD_TILES * TILE_SIZE + 1;
const FENCE_LEAVES: readonly CellarFenceLeaf[] = ['west', 'east'];
/**
 * A body sorts by its tile's top-left plus a tile, its feet; a piece of the
 * fence anchored this far above a floor point sorts as if standing there.
 */
const ENTITY_FOOT_BELOW_TOP_PX = TILE_SIZE;
/** Where a gate's foot stands down its tile, for the dust it kicks up. */
const GATE_GROUND_LINE = 0.55;

function bandX(x1: number, x2: number): { bandFromPx: number; bandToPx: number } {
  return {
    bandFromPx: (x1 - CLAMP_BAND_BUFFER_TILES) * TILE_SIZE,
    bandToPx: (x2 + CLAMP_BAND_BUFFER_TILES) * TILE_SIZE,
  };
}

function bandY(y1: number, y2: number): { bandFromPx: number; bandToPx: number } {
  return {
    bandFromPx: (y1 - CLAMP_BAND_BUFFER_TILES) * TILE_SIZE,
    bandToPx: (y2 + CLAMP_BAND_BUFFER_TILES) * TILE_SIZE,
  };
}

function faceOnRow(
  id: TutorialGateId,
  kind: GateKind,
  crawler: GateCrawler,
  opens: GateOpenRule,
  gate: { readonly x1: number; readonly x2: number; readonly y: number },
  clamps: readonly GateClamp[],
): GateDef {
  return { id, kind, crawler, opens, x1: gate.x1, y1: gate.y, x2: gate.x2, y2: gate.y, clamps };
}

function northClamp(
  who: 'human' | 'cat',
  gate: { readonly x1: number; readonly x2: number; readonly clampPxY: number },
): GateClamp {
  return { who, axis: 'y', bound: 'max', limitPx: gate.clampPxY, ...bandX(gate.x1, gate.x2) };
}

const GATE_DEFS: readonly GateDef[] = [
  faceOnRow('safeEntrance', 'faceOn', 'human', 'fullyInView', TUTORIAL_GATE_SAFE_ENTRANCE, [
    northClamp('human', TUTORIAL_GATE_SAFE_ENTRANCE),
  ]),
  faceOnRow('g1', 'faceOn', 'cat', 'noDialog', TUTORIAL_GATE_G1, [
    northClamp('cat', TUTORIAL_GATE_G1),
  ]),
  {
    id: 'seismic_stomp',
    kind: 'side',
    crawler: 'human',
    opens: 'approach',
    x1: TUTORIAL_GATE_SEISMIC_STOMP.x,
    y1: TUTORIAL_GATE_SEISMIC_STOMP.y1,
    x2: TUTORIAL_GATE_SEISMIC_STOMP.x,
    y2: TUTORIAL_GATE_SEISMIC_STOMP.y2,
    clamps: [
      {
        who: 'human',
        axis: 'x',
        bound: 'min',
        limitPx: TUTORIAL_GATE_SEISMIC_STOMP.clampPxX,
        ...bandY(TUTORIAL_GATE_SEISMIC_STOMP.y1, TUTORIAL_GATE_SEISMIC_STOMP.y2),
      },
    ],
  },
  faceOnRow('fence', 'fence', 'cat', 'approach', TUTORIAL_GATE_G2, [
    northClamp('cat', TUTORIAL_GATE_G2),
    {
      who: 'human',
      axis: 'y',
      bound: 'min',
      limitPx: TUTORIAL_GATE_G2.southClampPxY,
      ...bandX(TUTORIAL_GATE_G2.x1, TUTORIAL_GATE_G2.x2),
    },
  ]),
  faceOnRow('goblinB', 'door', 'cat', 'atOnce', TUTORIAL_GOBLIN_B_DOOR, [
    northClamp('cat', TUTORIAL_GOBLIN_B_DOOR),
    {
      who: 'human',
      axis: 'y',
      bound: 'min',
      limitPx: TUTORIAL_GOBLIN_B_DOOR.southClampPxY,
      ...bandX(TUTORIAL_GOBLIN_B_DOOR.x1, TUTORIAL_GOBLIN_B_DOOR.x2),
    },
  ]),
  faceOnRow('g3', 'faceOn', 'either', 'atOnce', TUTORIAL_GATE_G3, [
    northClamp('cat', TUTORIAL_GATE_G3),
    northClamp('human', TUTORIAL_GATE_G3),
  ]),
];

function openingFrames(kind: GateKind): number {
  switch (kind) {
    case 'fence':
      return FENCE_SWING_FRAMES;
    case 'door':
      return DOOR_SWING_FRAMES;
    case 'faceOn':
    case 'side':
      return PORTCULLIS_RAISE_FRAMES;
  }
}

function passableFraction(kind: GateKind): number {
  switch (kind) {
    case 'fence':
    case 'door':
      return SWING_PASSABLE_FRACTION;
    case 'faceOn':
    case 'side':
      return PORTCULLIS_PASSABLE_FRACTION;
  }
}

function openingCue(kind: GateKind): TutorialCue {
  switch (kind) {
    case 'fence':
      return 'fenceGateSwing';
    case 'door':
      return 'doorOpen';
    case 'faceOn':
    case 'side':
      return 'gateRaise';
  }
}

/** How far open a gate is `frame` frames after it began to open: eased out, then a small settle. */
function openFractionAt(kind: GateKind, frame: number): number {
  const total = openingFrames(kind);
  if (frame < total) {
    const remaining = 1 - frame / total;
    return 1 - remaining ** EASE_OUT_POWER;
  }
  const settle = (frame - total) / SETTLE_FRAMES;
  if (settle >= 1) return 1;
  return 1 - SETTLE_DIP * Math.sin(Math.PI * settle);
}

/** Frames from the start of the opening until the clamp lifts: the inverse of the ease-out. */
function framesUntilPassable(kind: GateKind): number {
  const remaining = (1 - passableFraction(kind)) ** (1 / EASE_OUT_POWER);
  return Math.ceil((1 - remaining) * openingFrames(kind));
}

function crawlerMatches(want: GateCrawler, crawler: Crawler, human: HumanPlayer): boolean {
  if (want === 'either') return true;
  return (crawler === human) === (want === 'human');
}

/**
 * Where a clamp would put a crawler, or null when the clamp does not hold it:
 * outside the clamp's band, or already well past its line on the far side —
 * a crawler beyond a gate (G2's hall runs straight on from G1's) must never
 * be dragged back to it.
 */
function clampedPosition(clamp: GateClamp, crawler: Crawler): number | null {
  const across = clamp.axis === 'y' ? crawler.x : crawler.y;
  if (across < clamp.bandFromPx || across > clamp.bandToPx) return null;
  const along = clamp.axis === 'y' ? crawler.y : crawler.x;
  const overshoot = clamp.bound === 'max' ? along - clamp.limitPx : clamp.limitPx - along;
  if (overshoot > CLAMP_HOLD_REACH_PX) return null;
  return clamp.bound === 'max' ? Math.min(along, clamp.limitPx) : Math.max(along, clamp.limitPx);
}

/** How far a crawler still has to walk to reach a clamp line, or null when it is not on that approach. */
function distanceToClamp(clamp: GateClamp, crawler: Crawler): number | null {
  const across = clamp.axis === 'y' ? crawler.x : crawler.y;
  if (across < clamp.bandFromPx || across > clamp.bandToPx) return null;
  const along = clamp.axis === 'y' ? crawler.y : crawler.x;
  const gap = clamp.bound === 'max' ? clamp.limitPx - along : along - clamp.limitPx;
  return Math.max(0, gap);
}

/** Owns the six tutorial gates' state, their clamps, their art and their sounds. */
export class TutorialGates {
  private readonly gates: GateState[] = GATE_DEFS.map((def) => ({
    def,
    unlocked: false,
    phase: 'closed',
    frame: 0,
    rattleCooldown: 0,
  }));
  private readonly cues: TutorialCueAt[] = [];
  private readonly lastPosition = new Map<Crawler, { x: number; y: number }>();
  private readonly renderList: TownPropRenderable[] = this.buildRenderables();

  /**
   * Advances every gate one frame. `isUnlocked` says which tutorial steps are
   * done.
   */
  update(
    isUnlocked: (id: TutorialGateId) => boolean,
    human: HumanPlayer,
    cat: CatPlayer,
    view: TutorialGateView,
  ): void {
    for (const gate of this.gates) {
      if (gate.rattleCooldown > 0) gate.rattleCooldown--;
      if (!gate.unlocked && isUnlocked(gate.def.id)) {
        gate.unlocked = true;
        this.raise(gate, 'gateUnlock');
      }
      if (gate.phase === 'closed' && gate.unlocked && this.shouldOpen(gate, human, cat, view)) {
        gate.phase = 'opening';
        gate.frame = 0;
        this.raise(gate, openingCue(gate.def.kind));
      } else if (gate.phase === 'opening') {
        gate.frame++;
        if (gate.frame >= openingFrames(gate.def.kind) + SETTLE_FRAMES) gate.phase = 'open';
      }
    }
    for (const crawler of [human, cat]) {
      this.lastPosition.set(crawler, { x: crawler.x, y: crawler.y });
    }
  }

  /** Holds each crawler back from every gate that is still in its way. Call after movement. */
  applyConstraints(human: HumanPlayer, cat: CatPlayer): void {
    for (const gate of this.gates) {
      if (!this.isBlocking(gate.def.id)) continue;
      for (const clamp of gate.def.clamps) {
        const crawler = clamp.who === 'human' ? human : cat;
        const clamped = clampedPosition(clamp, crawler);
        if (clamped === null) continue;
        const before = clamp.axis === 'y' ? crawler.y : crawler.x;
        if (Math.abs(before - clamped) <= BUMP_EPSILON_PX) continue;
        if (clamp.axis === 'y') crawler.y = clamped;
        else crawler.x = clamped;
        if (gate.rattleCooldown === 0) {
          gate.rattleCooldown = RATTLE_COOLDOWN_FRAMES;
          this.raise(gate, 'gateLocked');
        }
      }
    }
  }

  /** Whether the gate still stops crawlers: shut, or not yet open far enough to pass. */
  isBlocking(id: TutorialGateId): boolean {
    const gate = this.gate(id);
    if (gate.phase === 'open') return false;
    if (gate.phase === 'closed') return true;
    return gate.frame < framesUntilPassable(gate.def.kind);
  }

  /** How far open the gate is drawn, 0 (shut) to 1 (fully open). */
  openFraction(id: TutorialGateId): number {
    const gate = this.gate(id);
    if (gate.phase === 'closed') return 0;
    if (gate.phase === 'open') return 1;
    return openFractionAt(gate.def.kind, gate.frame);
  }

  /** The gates' art, to be depth-sorted with the bodies. */
  renderables(): readonly TownPropRenderable[] {
    return this.renderList;
  }

  /** Every cue raised since the last call, each at the gate it came from. */
  drainCues(): TutorialCueAt[] {
    return this.cues.splice(0, this.cues.length);
  }

  private gate(id: TutorialGateId): GateState {
    const found = this.gates.find((gate) => gate.def.id === id);
    if (found === undefined) throw new Error(`no tutorial gate ${id}`);
    return found;
  }

  private raise(gate: GateState, cue: TutorialCue): void {
    const { x1, y1, x2, y2 } = gate.def;
    this.cues.push({
      cue,
      x: ((x1 + x2 + 1) * TILE_SIZE) / 2,
      y: ((y1 + y2 + 1) * TILE_SIZE) / 2,
    });
  }

  /** Whether an unlocked, shut gate starts opening this frame, by its {@link GateOpenRule}. */
  private shouldOpen(
    gate: GateState,
    human: HumanPlayer,
    cat: CatPlayer,
    view: TutorialGateView,
  ): boolean {
    switch (gate.def.opens) {
      case 'atOnce':
        return true;
      case 'noDialog':
        return !view.dialogOpen;
      case 'fullyInView':
        return this.isFullyInView(gate.def, view.camera);
      case 'approach':
        return this.isApproached(gate, human, cat, view.camera);
    }
  }

  /**
   * Whether the gate's crawler is close enough that, opening now, the gate
   * is passable before the crawler reaches it — and the player can see it
   * happen. A crawler the player is not steering is let through off screen
   * too, or a companion walking to a far-off leader would wait behind it.
   */
  private isApproached(
    gate: GateState,
    human: HumanPlayer,
    cat: CatPlayer,
    camera: { readonly x: number; readonly y: number },
  ): boolean {
    const onScreen = this.isOnScreen(gate.def, camera);
    for (const crawler of [human, cat]) {
      if (!crawlerMatches(gate.def.crawler, crawler, human)) continue;
      if (!onScreen && crawler.isActive) continue;
      const reach = this.speedOf(crawler) * framesUntilPassable(gate.def.kind) + TRIGGER_MARGIN_PX;
      for (const clamp of gate.def.clamps) {
        if (clamp.who !== (crawler === human ? 'human' : 'cat')) continue;
        const distance = distanceToClamp(clamp, crawler);
        if (distance !== null && distance <= reach) return true;
      }
    }
    return false;
  }

  /**
   * The crawler's walking speed in pixels a frame: the larger of the pace its
   * speed multiplier gives (god mode included) and how far it actually moved
   * last frame, which covers a companion following at its own pace.
   */
  private speedOf(crawler: Crawler): number {
    const nominal = PLAYER_SPEED * crawler.speedMultiplier;
    const last = this.lastPosition.get(crawler);
    const moved = last === undefined ? 0 : Math.hypot(crawler.x - last.x, crawler.y - last.y);
    return Math.max(nominal, moved);
  }

  /** Whether every pixel a face-on gate's art can reach is inside the view. */
  private isFullyInView(def: GateDef, camera: { readonly x: number; readonly y: number }): boolean {
    const left = def.x1 * TILE_SIZE - TUTORIAL_PORTCULLIS_OVERHANG_PX;
    const right = (def.x2 + 1) * TILE_SIZE + TUTORIAL_PORTCULLIS_OVERHANG_PX;
    const top = (def.y1 - TUTORIAL_PORTCULLIS_ABOVE_ROW_TILES) * TILE_SIZE;
    const bottom = (def.y2 + 1) * TILE_SIZE;
    return (
      left >= camera.x &&
      right <= camera.x + viewportWidth() &&
      top >= camera.y &&
      bottom <= camera.y + viewportHeight()
    );
  }

  private isOnScreen(def: GateDef, camera: { readonly x: number; readonly y: number }): boolean {
    const reach = TUTORIAL_PORTCULLIS_REACH_TILES * TILE_SIZE;
    const left = def.x1 * TILE_SIZE - reach;
    const right = (def.x2 + 1) * TILE_SIZE;
    const top = def.y1 * TILE_SIZE - reach;
    const bottom = (def.y2 + 1) * TILE_SIZE;
    return (
      right > camera.x &&
      left < camera.x + viewportWidth() &&
      bottom > camera.y &&
      top < camera.y + viewportHeight()
    );
  }

  private buildRenderables(): TownPropRenderable[] {
    const list: TownPropRenderable[] = [];
    for (const def of GATE_DEFS) {
      if (def.kind === 'door') {
        list.push(this.doorFrameRenderable(def));
        for (const leaf of FENCE_LEAVES) list.push(this.doorLeafRenderable(def, leaf));
        continue;
      }
      if (def.kind === 'fence') {
        list.push(this.fenceFrameRenderable(def));
        for (const leaf of FENCE_LEAVES) list.push(this.fenceLeafRenderable(def, leaf));
        continue;
      }
      if (def.kind === 'faceOn') {
        for (let tx = def.x1; tx <= def.x2; tx++) {
          list.push(this.faceOnRenderable(def, tx));
        }
        continue;
      }
      for (let ty = def.y1; ty <= def.y2; ty++) {
        list.push(this.sideRenderable(def, ty));
      }
    }
    return list;
  }

  private faceOnRenderable(def: GateDef, tx: number): TownPropRenderable {
    const ty = def.y1;
    return {
      x: tx * TILE_SIZE,
      y: ty * TILE_SIZE,
      cullMarginTiles: TUTORIAL_PORTCULLIS_REACH_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        const sx = tx * tileSize - camX;
        const sy = ty * tileSize - camY;
        drawPortcullisFaceOnTile(
          ctx,
          sx,
          sy,
          tileSize,
          this.openFraction(def.id),
          tx === def.x1,
          tx === def.x2,
        );
        const groundY = sy + tileSize * GATE_GROUND_LINE;
        drawGateDust(ctx, sx, groundY, sx + tileSize, groundY, tileSize, this.dustAge(def.id));
      },
    };
  }

  private sideRenderable(def: GateDef, ty: number): TownPropRenderable {
    const tx = def.x1;
    return {
      x: tx * TILE_SIZE,
      y: ty * TILE_SIZE,
      cullMarginTiles: TUTORIAL_PORTCULLIS_REACH_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        const sx = tx * tileSize - camX;
        const sy = ty * tileSize - camY;
        drawPortcullisSideTile(
          ctx,
          sx,
          sy,
          tileSize,
          this.openFraction(def.id),
          ty === def.y1,
          ty === def.y2,
        );
        const slotX = sx + tileSize * HALF;
        drawGateDust(ctx, slotX, sy, slotX, sy + tileSize, tileSize, this.dustAge(def.id));
      },
    };
  }

  private fenceFrameRenderable(def: GateDef): TownPropRenderable {
    const spanTiles = def.x2 - def.x1 + 1;
    return {
      x: def.x1 * TILE_SIZE,
      y: def.y1 * TILE_SIZE - FENCE_SORT_LEAD_PX,
      cullMarginTiles: spanTiles + TUTORIAL_FENCE_HEIGHT_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        drawCellarFenceFrame(
          ctx,
          def.x1 * tileSize - camX,
          def.y1 * tileSize - camY,
          tileSize,
          spanTiles,
          this.openFraction(def.id),
        );
      },
    };
  }

  /**
   * A leaf of the fence's gate. Shut, it sorts with the rest of the fence;
   * swung open it lies back along the wall well south of the fence's row, so
   * it sorts at its free end's foot, in front of anyone north of that.
   */
  private fenceLeafRenderable(def: GateDef, leaf: CellarFenceLeaf): TownPropRenderable {
    const spanTiles = def.x2 - def.x1 + 1;
    const shutY = def.y1 * TILE_SIZE - FENCE_SORT_LEAD_PX;
    const openFraction = (): number => this.openFraction(def.id);
    return {
      x: def.x1 * TILE_SIZE,
      get y(): number {
        const swing = openFraction();
        if (swing <= 0) return shutY;
        const footY = (def.y1 + cellarFenceLeafFootTiles(spanTiles, swing)) * TILE_SIZE;
        return Math.max(shutY, footY - ENTITY_FOOT_BELOW_TOP_PX);
      },
      cullMarginTiles: spanTiles + TUTORIAL_FENCE_HEIGHT_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        drawCellarFenceLeaf(
          ctx,
          def.x1 * tileSize - camX,
          def.y1 * tileSize - camY,
          tileSize,
          spanTiles,
          openFraction(),
          leaf,
        );
      },
    };
  }

  private doorFrameRenderable(def: GateDef): TownPropRenderable {
    const spanTiles = def.x2 - def.x1 + 1;
    return {
      x: def.x1 * TILE_SIZE,
      y: def.y1 * TILE_SIZE,
      cullMarginTiles: spanTiles + TUTORIAL_DOOR_ABOVE_ROW_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        drawCellarDoorFrame(
          ctx,
          def.x1 * tileSize - camX,
          def.y1 * tileSize - camY,
          tileSize,
          spanTiles,
          this.openFraction(def.id),
        );
      },
    };
  }

  /**
   * A leaf of the cellar door. Shut, it stands in the door's row, in front of
   * anyone north of it; swung open it lies back along the wall, so it sorts
   * at its free edge's foot.
   */
  private doorLeafRenderable(def: GateDef, leaf: CellarFenceLeaf): TownPropRenderable {
    const spanTiles = def.x2 - def.x1 + 1;
    const shutY = def.y1 * TILE_SIZE;
    const openFraction = (): number => this.openFraction(def.id);
    return {
      x: def.x1 * TILE_SIZE,
      get y(): number {
        const swing = openFraction();
        if (swing <= 0) return shutY;
        const footY = (def.y1 + cellarDoorLeafFootTiles(spanTiles, swing)) * TILE_SIZE;
        return Math.max(shutY, footY - ENTITY_FOOT_BELOW_TOP_PX);
      },
      cullMarginTiles: spanTiles + TUTORIAL_DOOR_ABOVE_ROW_TILES + CULL_MARGIN_PAD_TILES,
      render: (ctx, camX, camY, tileSize) => {
        drawCellarDoorLeaf(
          ctx,
          def.x1 * tileSize - camX,
          def.y1 * tileSize - camY,
          tileSize,
          spanTiles,
          openFraction(),
          leaf,
        );
      },
    };
  }

  /** Frames since the grille's foot left the floor, or -1 while it has not. */
  private dustAge(id: TutorialGateId): number {
    const gate = this.gate(id);
    if (gate.phase !== 'opening') return -1;
    return gate.frame < GATE_DUST_FRAMES ? gate.frame : -1;
  }
}
