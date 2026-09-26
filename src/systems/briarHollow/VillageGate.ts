/**
 * The village gate's doors: they swing open when a friendly body comes near
 * and close a moment after the last one leaves.
 *
 * Purely a picture. Whether anybody can walk through is the map's business —
 * the gate tiles are walkable for friendlies and turned away for hostiles by a
 * `GameMap` block flag, open doors or not — so a hostile standing at a gate a
 * crawler has just opened still cannot pass, and a crawler never waits on the
 * animation.
 */

import type { TileContent } from '../../map/tileTypes';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import { setGateAnimation } from '../../map/tiles/hollowPalisadeTiles';

/** A friendly this close to the gate's middle opens it. */
export const GATE_OPEN_RADIUS_TILES = 2;
/** Seconds the doors take to swing fully open or shut. */
export const GATE_SWING_SECONDS = 0.4;
/** Seconds the doors wait after the last friendly leaves before swinging shut. */
export const GATE_CLOSE_DELAY_SECONDS = 1;
/** How far the doors rattle on their hinges when struck, in pixels at full shake. */
const GATE_SHAKE_PX = 2.5;
/** Rattles per second while shaking. */
const GATE_SHAKE_HZ = 18;

const GATE_OPEN_SOUND = 'village_gate_open';
const GATE_CLOSE_SOUND = 'village_gate_close';

const HALF_TILE = TILE_SIZE / 2;

export class VillageGate {
  private open = 0;
  private opening = false;
  private closeDelaySeconds = 0;
  private clockSeconds = 0;
  private readonly centreX: number;
  private readonly centreY: number;

  constructor(
    private readonly structure: TileContent[][],
    site: BriarHollowSite,
    private readonly audio: AudioManager | null,
  ) {
    const middle = site.gate.tiles[Math.floor(site.gate.tiles.length / 2)] ?? site.gate.inside;
    this.centreX = middle.x * TILE_SIZE + HALF_TILE;
    this.centreY = middle.y * TILE_SIZE + HALF_TILE;
  }

  /** 0 shut, 1 fully open. */
  get openFraction(): number {
    return this.open;
  }

  /**
   * @param friendlies Every friendly body this frame, by top-left world pixel.
   * @param shake 0–1 of the gate's shake after a blow.
   */
  update(
    friendlies: ReadonlyArray<{ readonly x: number; readonly y: number }>,
    shake: number,
    dtSeconds: number,
  ): void {
    this.clockSeconds += dtSeconds;
    const radiusPx = GATE_OPEN_RADIUS_TILES * TILE_SIZE;
    const someoneNear = friendlies.some(
      (body) =>
        Math.hypot(body.x + HALF_TILE - this.centreX, body.y + HALF_TILE - this.centreY) <=
        radiusPx,
    );
    if (someoneNear) {
      this.closeDelaySeconds = GATE_CLOSE_DELAY_SECONDS;
      if (!this.opening) {
        this.opening = true;
        this.audio?.play(GATE_OPEN_SOUND);
      }
    } else if (this.opening) {
      this.closeDelaySeconds -= dtSeconds;
      if (this.closeDelaySeconds <= 0) {
        this.opening = false;
        this.audio?.play(GATE_CLOSE_SOUND);
      }
    }
    const step = dtSeconds / GATE_SWING_SECONDS;
    this.open = this.opening ? Math.min(1, this.open + step) : Math.max(0, this.open - step);
    const shakePx =
      shake * GATE_SHAKE_PX * Math.sin(this.clockSeconds * Math.PI * 2 * GATE_SHAKE_HZ);
    setGateAnimation(this.structure, { open: easeInOut(this.open), shakePx });
  }
}

/** Smoothstep's cubic, 3t² − 2t³: the doors start and finish their swing gently. */
const SMOOTHSTEP_SQUARE = 3;
const SMOOTHSTEP_CUBE = 2;

function easeInOut(t: number): number {
  return t * t * (SMOOTHSTEP_SQUARE - SMOOTHSTEP_CUBE * t);
}
