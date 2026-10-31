import type { AudioManager } from '../audio/AudioManager';
import { TILE_SIZE } from '../core/constants';
import type { Camera } from '../core/rendering/camera';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { Conversation } from '../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../dialog/line';
import type { ConversationHandle, ConversationRequest, PendingLine } from '../dialog/request';
import { DAVE_SPEAKER_REF } from '../dialog/scripts/dave';
import { sameSafeRoom, type SafeRoomId } from '../map/safeRoomId';
import type { TilePoint } from '../map/town/townPlan';
import {
  DAVE_TILES_PER_WALK_CYCLE,
  daveHeadTop,
  drawDaveSprite,
  prewarmDaveSprite,
} from '../sprites/daveSprite';
import {
  TELEPORT_IN_FRAMES,
  TELEPORT_OUT_FRAMES,
  TELEPORT_SOUNDS,
  type TeleportDraw,
} from '../sprites/teleportEffect';
import { figureRowInkTop } from '../sprites/figure/figureFrameCache';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { minimapMarkerFor, npcMarkerShows, type NpcMarker } from '../sprites/npcQuestMarker';
import {
  IconAnchor,
  drawOverheadIcon,
  drawOverheadIconBeacon,
  overheadIconTopY,
} from '../sprites/overheadIcon';
import type { QuestMarkerType } from './MiniMapSystem';
import {
  drawSpeechBubble,
  speechBubbleOriginAbove,
  speechBubbleTop,
} from '../sprites/speechBubble';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { pixelToTile } from '../utils';
import type { AdviceObjectiveId } from '../story/adviceObjectiveIds';
import { DaveWanderer } from './daveWander';
import type { GuidePlacement, SafeRoomInfo, SafeRoomSystem } from './SafeRoomSystem';

/**
 * How long after the party walks into a safe room Dave appears in it: long
 * enough that the party is through the door and turned to see him arrive.
 */
const DAVE_ARRIVAL_DELAY_FRAMES = 40;

/** Tiles either side of his tile in the patch he may stand in while waiting outside a room: a patch he cannot leave. */
const WAITING_BOUNDS_MARGIN_TILES = 1;
const WAITING_BOUNDS_SPAN_TILES = WAITING_BOUNDS_MARGIN_TILES * 2 + 1;

/** Clear air between the top of his hair and the tip of the "…" bubble's tail, as a share of a tile so it holds at every zoom. */
const DAVE_BUBBLE_GAP_TILES = 0.0625;

/** Tiles from where he stands within which a press talks to him. */
export const DAVE_NEAR_DISTANCE_TILES = 2.5;

/**
 * Where he is mid-visit. Talkable, markable and wandering only while
 * `present`; the two teleports hold him still on his arrival tile.
 */
type DavePhase =
  | { readonly kind: 'teleportingIn'; readonly elapsedFrames: number }
  | { readonly kind: 'present' }
  | { readonly kind: 'teleportingOut'; readonly elapsedFrames: number };

/** Where Dave is in this scene. There is one of him, never one per room. */
type DaveState =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'inRoom';
      readonly room: SafeRoomId;
      /** The tile he arrived on, which his minimap dot marks. */
      readonly tile: TilePoint;
      readonly phase: DavePhase;
    }
  | {
      /** Standing on a tile outside any safe room, waiting to talk: the start of a run that skipped the tutorial. */
      readonly kind: 'waiting';
      readonly tile: TilePoint;
      readonly phase: DavePhase;
    };

/**
 * The room Dave was last in, and what he has told the party on this floor,
 * shared by every scene of the floor so that a building visit or a walk back
 * out of one finds him where he was left, remembering what he has said.
 */
export class DaveWhereabouts {
  room: SafeRoomId | null = null;
  /** The objectives he has given his tactics for, so his `!` stands down once he has. */
  readonly tacticsGiven = new Set<AdviceObjectiveId>();
  /** Whether he has told a party with nothing left to do that the floor's key is whole. */
  toldKeyWhole = false;
}

/** Keeps boss kills and the players' bags out of this system. */
type DaveMarkerSource = (room: SafeRoomInfo) => NpcMarker;

interface DaveMinimapMarker {
  readonly x: number;
  readonly y: number;
  readonly type: QuestMarkerType;
}

interface DaveGuideDeps {
  readonly safeRooms: SafeRoomSystem;
  readonly conversation: Conversation;
  readonly whereabouts: DaveWhereabouts;
  /** The scene's camera, for whether a departure is worth showing. */
  readonly camera: () => Camera;
  readonly audio: Pick<AudioManager, 'playAt'> | null;
  /** Called the frame he has finished teleporting into a room the party entered. */
  readonly onArrived?: (room: SafeRoomInfo) => void;
}

/** Where he stands for one visit: a safe room's placement, or a tile outside any room. */
type StandPlacement = Omit<GuidePlacement, 'id'>;

interface Visit {
  /** The safe room he is in, or null while he waits on a tile outside one. */
  readonly room: SafeRoomId | null;
  readonly placement: StandPlacement;
  /** Owns his position outright, which is what keeps him in his room. */
  readonly wanderer: DaveWanderer;
  phase: DavePhase;
}

/**
 * Dave: the one guide in a scene, who teleports into whichever safe room the
 * party last walked into and stays there until they walk into another. He
 * wanders his room, is drawn in the scene's sorted pass, and is talked to
 * through the scene's one conversation.
 */
export class DaveGuideSystem {
  private visit: Visit | null = null;
  private pendingArrival: { readonly room: SafeRoomId; framesLeft: number } | null = null;
  /** The row his last paint drew, so his prompt hangs over what is on screen. */
  private drawnRow: DrawnFigureRow | undefined = undefined;
  private handle: ConversationHandle | null = null;
  /**
   * Whether the player has been genuinely inside his room at any point during
   * the open conversation.
   *
   * The room test is a tile-in-bounds check that excludes the wall ring and the
   * doorway, while talk range is measured from where he stands — so a player
   * who opens the dialog from the doorway is already "outside" the room and
   * the box would close on the frame it opened, having eaten the interact key.
   * Arming the test only once they are actually in the room keeps the
   * walk-out rule without that.
   */
  private hasBeenInRoom = false;
  private marker: NpcMarker = 'none';
  private markerSource: DaveMarkerSource | null = null;
  private held: () => boolean = () => false;
  private readonly sortedFigures: InteriorFigure[] = [];

  /**
   * @param startIn The room he is already standing in when the scene opens,
   *   with no teleport: where the run last left him, or the room a reload
   *   resumes in. Null, or a room not on this map, starts him absent.
   */
  constructor(
    private readonly deps: DaveGuideDeps,
    startIn: SafeRoomId | null,
  ) {
    this.resumeIn(startIn);
  }

  /**
   * Puts him straight into `room`, already standing there with no teleport,
   * or takes him off the map when it is null or not on this map: what a
   * reload of a save finds, so a death rewound to that save agrees with it.
   */
  resumeIn(room: SafeRoomId | null): void {
    this.closeDialog();
    this.pendingArrival = null;
    this.visit = null;
    const placement = room === null ? null : this.deps.safeRooms.guidePlacement(room);
    if (placement === null) {
      this.deps.whereabouts.room = null;
      return;
    }
    // Warmed now rather than on his first draw: he is standing there on the
    // first frame.
    prewarmDaveSprite();
    this.standIn(placement.id, placement, { kind: 'present' });
  }

  /**
   * Stands him on `tile` outside any safe room, already there with no
   * teleport and holding still: where he waits for a party that skipped the
   * tutorial. He leaves by {@link teleportOut}, or for the next safe room the
   * party walks into, and no room remembers him meanwhile.
   */
  waitAt(tile: TilePoint): void {
    this.closeDialog();
    this.pendingArrival = null;
    this.visit = null;
    prewarmDaveSprite();
    const onlyHisTile = (tileX: number, tileY: number): boolean =>
      tileX === tile.x && tileY === tile.y;
    const bounds = {
      x: tile.x - WAITING_BOUNDS_MARGIN_TILES,
      y: tile.y - WAITING_BOUNDS_MARGIN_TILES,
      w: WAITING_BOUNDS_SPAN_TILES,
      h: WAITING_BOUNDS_SPAN_TILES,
    };
    this.standIn(null, { bounds, home: tile, canStand: onlyHisTile }, { kind: 'present' });
  }

  get state(): DaveState {
    const visit = this.visit;
    if (visit === null) return { kind: 'absent' };
    if (visit.room === null) {
      return { kind: 'waiting', tile: visit.placement.home, phase: visit.phase };
    }
    return { kind: 'inRoom', room: visit.room, tile: visit.placement.home, phase: visit.phase };
  }

  /** Whether he is standing in a room, done arriving and not leaving: the only time he can be spoken to. */
  get isPresent(): boolean {
    return this.visit?.phase.kind === 'present';
  }

  /** Holds him where he stands while `held` is true: a scripted walk-up aims at a tile beside him. */
  holdWhile(held: () => boolean): void {
    this.held = held;
  }

  setMarkerSource(source: DaveMarkerSource): void {
    this.markerSource = source;
  }

  /**
   * The party walked into `room`. He leaves the room he is in for it, unless
   * it is the one he is already in or on his way to.
   */
  onSafeRoomEntered(room: SafeRoomId): void {
    const visit = this.visit;
    const visitRoom = visit?.room ?? null;
    const alreadyThere = visitRoom !== null && sameSafeRoom(visitRoom, room);
    if (alreadyThere && visit?.phase.kind !== 'teleportingOut') return;
    if (this.pendingArrival !== null && sameSafeRoom(this.pendingArrival.room, room)) return;
    if (this.deps.safeRooms.guidePlacement(room) === null) return;
    this.leave();
    // Again, not only at scene load: a picture left undrawn for long is let
    // go, and his arrival may come long after the scene was built.
    prewarmDaveSprite();
    this.pendingArrival = { room, framesLeft: DAVE_ARRIVAL_DELAY_FRAMES };
    // Where he is bound, so a scene change before he lands still finds him there.
    this.deps.whereabouts.room = room;
  }

  /** He leaves the room he is in, along with anything he was saying, and goes nowhere until the party enters a safe room. */
  teleportOut(): void {
    this.pendingArrival = null;
    this.leave();
    this.deps.whereabouts.room = null;
  }

  update(active: { x: number; y: number }): void {
    this.closeDialogIfLeftRoom(active);
    this.advanceVisit();
    this.advanceArrival();
    this.refreshMarker();
  }

  /**
   * The conversation half of {@link update}, for a scene ticked through its own
   * dialog: the walk-away check runs while the world is halted, his visit does not.
   */
  tickWalkAway(active: { x: number; y: number }): void {
    this.closeDialogIfLeftRoom(active);
  }

  private advanceVisit(): void {
    const visit = this.visit;
    if (visit === null) return;
    switch (visit.phase.kind) {
      case 'teleportingIn': {
        const elapsedFrames = visit.phase.elapsedFrames + 1;
        if (elapsedFrames < TELEPORT_IN_FRAMES) {
          visit.phase = { kind: 'teleportingIn', elapsedFrames };
          return;
        }
        visit.phase = { kind: 'present' };
        const info = visit.room === null ? null : this.deps.safeRooms.safeRoomInfo(visit.room);
        if (info !== null) this.deps.onArrived?.(info);
        return;
      }
      case 'present':
        // He holds still while he is talking to you: a 2.5-tile talk radius and an
        // NPC who keeps ambling is an NPC who walks out of his own conversation.
        // `hold` *instead of* `update`, not as well as it — stepping the wanderer
        // in the same frame runs the hold's own pause straight back down to zero,
        // which leaves him reading as walking and re-picking a target every frame.
        if (this.dialogOpen || this.held()) visit.wanderer.hold();
        else visit.wanderer.update();
        return;
      case 'teleportingOut': {
        const elapsedFrames = visit.phase.elapsedFrames + 1;
        if (elapsedFrames < TELEPORT_OUT_FRAMES) {
          visit.phase = { kind: 'teleportingOut', elapsedFrames };
          return;
        }
        this.visit = null;
        return;
      }
      default: {
        const unhandled: never = visit.phase;
        throw new Error(`unhandled Dave phase ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** One Dave: he cannot arrive anywhere until he has finished leaving. */
  private advanceArrival(): void {
    const pending = this.pendingArrival;
    if (pending === null) return;
    if (pending.framesLeft > 0) pending.framesLeft -= 1;
    if (pending.framesLeft > 0 || this.visit !== null) return;
    this.pendingArrival = null;
    const placement = this.deps.safeRooms.guidePlacement(pending.room);
    if (placement === null) return;
    this.standIn(placement.id, placement, { kind: 'teleportingIn', elapsedFrames: 0 });
    const at = this.worldCentre(placement.home);
    this.deps.audio?.playAt(TELEPORT_SOUNDS.in, at.x, at.y);
  }

  private standIn(room: SafeRoomId | null, placement: StandPlacement, phase: DavePhase): void {
    this.visit = {
      room,
      placement,
      wanderer: new DaveWanderer(
        placement.bounds,
        placement.home,
        // The walk's stance foot is planted, so the cycle has to advance
        // with the distance he travels or he skates along his own path.
        DAVE_TILES_PER_WALK_CYCLE * TILE_SIZE,
        placement.canStand,
      ),
      phase,
    };
    this.drawnRow = undefined;
    this.deps.whereabouts.room = room;
  }

  /** Starts his departure, shown only where someone could see it; off screen he is simply gone. */
  private leave(): void {
    const visit = this.visit;
    if (visit === null || visit.phase.kind === 'teleportingOut') return;
    this.closeDialog();
    const { x, y } = visit.wanderer.state;
    if (!this.isOnScreen(x, y)) {
      this.visit = null;
      return;
    }
    visit.phase = { kind: 'teleportingOut', elapsedFrames: 0 };
    this.deps.audio?.playAt(TELEPORT_SOUNDS.out, x + TILE_SIZE / 2, y + TILE_SIZE / 2);
  }

  private isOnScreen(worldX: number, worldY: number): boolean {
    const camera = this.deps.camera();
    const margin = TILE_SIZE;
    return (
      worldX + margin >= camera.x &&
      worldX - margin <= camera.x + camera.viewWidth &&
      worldY + margin >= camera.y &&
      worldY - margin <= camera.y + camera.viewHeight
    );
  }

  private worldCentre(tile: TilePoint): { x: number; y: number } {
    return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
  }

  /** Once per update, not per draw: the answer walks both crawlers' bags. */
  private refreshMarker(): void {
    const visit = this.visit;
    const source = this.markerSource;
    const room = visit?.room ?? null;
    if (visit === null || room === null || source === null || visit.phase.kind !== 'present') {
      this.marker = 'none';
      return;
    }
    const info = this.deps.safeRooms.safeRoomInfo(room);
    this.marker = info === null ? 'none' : source(info);
  }

  // Conversation

  get dialogOpen(): boolean {
    return this.handle !== null && this.deps.conversation.isActive(this.handle);
  }

  /** Ends his conversation outright, with no side effect. Esc and a forced switch both use this. */
  closeDialog(): void {
    if (!this.dialogOpen) return;
    this.deps.conversation.close();
    this.forgetConversation();
  }

  private forgetConversation(): void {
    this.handle = null;
    this.hasBeenInRoom = false;
  }

  /** Open the dialog and populate it with the async AI response. */
  openChat(active: { x: number; y: number }, responsePromise: Promise<string>): void {
    this.openOrContinue(active, [{ speaker: DAVE_SPEAKER_REF, text: responsePromise }]);
  }

  /**
   * Open the dialog on a line he already knows — the floor advice or the
   * post-boss debrief, which needs no server and so has nothing to wait for.
   */
  openLine(active: { x: number; y: number }, line: DialogLine): void {
    this.openOrContinue(active, [line]);
  }

  /**
   * Talking to him again while his conversation is already the one on screen
   * chains onto it with `play` rather than calling `open` again:
   * `Conversation.open` dismisses whatever request it supersedes, and that
   * would run this system's own `onDismissed` a moment after the turn about
   * to show was set up.
   */
  private openOrContinue(
    active: { x: number; y: number },
    lines: NonEmpty<DialogLine | PendingLine>,
  ): void {
    const visit = this.visit;
    if (visit === null || !this.isNear(active)) return;
    const request = this.request(lines, visit);
    if (this.dialogOpen && this.handle !== null) {
      this.handle.play(request);
      return;
    }
    this.hasBeenInRoom = false;
    this.handle = this.deps.conversation.open(request);
  }

  private request(lines: NonEmpty<DialogLine | PendingLine>, visit: Visit): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => this.forgetConversation() },
      dismiss: { kind: 'allowed', onDismissed: () => this.forgetConversation() },
      haltsWorld: false,
      anchor: {
        position: () => visit.wanderer.state,
        talkRangeTiles: DAVE_NEAR_DISTANCE_TILES,
      },
      // A dialog the player pages through, over a floor that keeps running.
      locksKeyboard: false,
    };
  }

  /**
   * Ends the conversation the instant the player leaves his room, having
   * genuinely been inside it. The conversation's anchor covers walking away
   * from him inside the room, since that is a plain distance check any
   * conversation can make; leaving the room outright is a boundary only this
   * system knows, and can come first when he stands by the door.
   */
  private closeDialogIfLeftRoom(active: { x: number; y: number }): void {
    const room = this.visit?.room ?? null;
    if (!this.dialogOpen || room === null) return;
    const standingIn = this.deps.safeRooms.safeRoomAt(active);
    if (standingIn !== null && sameSafeRoom(standingIn, room)) {
      this.hasBeenInRoom = true;
      return;
    }
    if (this.hasBeenInRoom) this.closeDialog();
  }

  // Queries

  /** Where he stands this frame, as world-pixel top-left; null while he is in no room. */
  get standingPosition(): { x: number; y: number } | null {
    const visit = this.visit;
    if (visit === null) return null;
    const { x, y } = visit.wanderer.state;
    return { x, y };
  }

  /** The tile he is standing on, while he can be spoken to. */
  get standingTile(): TilePoint | null {
    if (!this.isPresent) return null;
    const at = this.standingPosition;
    return at === null ? null : { x: pixelToTile(at.x), y: pixelToTile(at.y) };
  }

  /** Where he is standing while his conversation is open, so the crawler can be turned to face him. */
  get speakingPosition(): { x: number; y: number } | null {
    return this.dialogOpen ? this.standingPosition : null;
  }

  /** Whether `entity` is in talk range of him. */
  isNear(entity: { x: number; y: number }): boolean {
    return this.talkDistanceTiles(entity) !== null;
  }

  /**
   * How far `entity` stands from him in tiles while in talk range, or null —
   * for choosing between him and the doctor when both could hear a press. Talk
   * range is measured from where he stands, not from his arrival tile.
   */
  talkDistanceTiles(entity: { x: number; y: number }): number | null {
    const at = this.isPresent ? this.standingPosition : null;
    if (at === null) return null;
    const tiles = Math.hypot(entity.x - at.x, entity.y - at.y) / TILE_SIZE;
    return tiles < DAVE_NEAR_DISTANCE_TILES ? tiles : null;
  }

  /**
   * His arrival tile, for the minimap.
   *
   * Not where he is standing: the minimap dot is a landmark the player
   * navigates by, and one that drifts around its room every few seconds is
   * harder to steer toward than one that stays put.
   */
  get minimapTile(): TilePoint | null {
    const visit = this.visit;
    if (visit === null || visit.phase.kind === 'teleportingOut') return null;
    return visit.placement.home;
  }

  get minimapMarker(): DaveMinimapMarker | null {
    const tile = this.minimapTile;
    const marker = this.marker;
    if (tile === null || !npcMarkerShows(marker)) return null;
    return { x: tile.x, y: tile.y, type: minimapMarkerFor(marker) };
  }

  // Drawing

  /** The top of the row he last drew, or his head height before his first paint. */
  private artTop(sy: number, ts: number): number {
    const drawnRow = this.drawnRow;
    if (drawnRow === undefined) return daveHeadTop(sy, ts);
    return figureRowInkTop(drawnRow, sy, ts);
  }

  /** The `sy` that hangs the "…" bubble's tail just clear of the top of his art. */
  private bubbleOrigin(sy: number, ts: number): number {
    const bubbleBottom = this.artTop(sy, ts) - DAVE_BUBBLE_GAP_TILES * ts;
    return speechBubbleOriginAbove(bubbleBottom, ts);
  }

  private teleportDraw(phase: DavePhase): TeleportDraw | null {
    switch (phase.kind) {
      case 'teleportingIn':
        return { direction: 'in', elapsedFrames: phase.elapsedFrames };
      case 'present':
        return null;
      case 'teleportingOut':
        return { direction: 'out', elapsedFrames: phase.elapsedFrames };
      default: {
        const unhandled: never = phase;
        throw new Error(`unhandled Dave phase ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Dave, as a figure for the scene's Y-sorted pass.
   *
   * He is *not* drawn with the room's fixtures: he walks among the table, the
   * stove, the braziers and the doctor's cabinet, and the sorted pass gives him
   * the same depth against them as the players — against the cabinet too,
   * whichever row of the corner it was stamped on.
   */
  sortedRenderables(
    active: { x: number; y: number },
    speechBubblePulse: number,
  ): ReadonlyArray<InteriorFigure> {
    this.sortedFigures.length = 0;
    const visit = this.visit;
    if (visit === null) return this.sortedFigures;
    const wander = visit.wanderer.state;
    const present = visit.phase.kind === 'present';
    const dialogOpen = this.dialogOpen;
    const marker: NpcMarker = present && !dialogOpen ? this.marker : 'none';
    const marked = npcMarkerShows(marker);
    // Unlike the bubble, the marker shows at any distance to pull the player over.
    const showBubble = !marked && present && !dialogOpen && this.isNear(active);
    const teleport = this.teleportDraw(visit.phase);
    this.sortedFigures.push({
      y: wander.y,
      render: (ctx, camX, camY, ts) => {
        const sx = wander.x - camX;
        const sy = wander.y - camY;
        // Before the body so the column stands behind him, and from the
        // glyph's own marker so the beam and the glyph never disagree.
        drawOverheadIconBeacon(ctx, sx, sy, ts, camX, camY, marker);
        this.drawnRow = drawDaveSprite(ctx, sx, sy, ts, {
          walkPhase: wander.walkPhase,
          isWalking: wander.isWalking,
          isTalking: dialogOpen,
          facingX: wander.facingX,
          facingY: wander.facingY,
          lastHorizontalFacing: wander.lastHorizontalFacing,
          idleOffsetSeconds: wander.idleOffsetSeconds,
          teleport,
        });
        if (marked) {
          drawOverheadIcon(ctx, sx, IconAnchor.ofRow(this.drawnRow, sy, ts), ts, marker);
        } else if (showBubble) {
          drawSpeechBubble(ctx, sx, this.bubbleOrigin(sy, ts), ts, speechBubblePulse);
        }
      },
    });
    return this.sortedFigures;
  }

  /**
   * His `Talk` world prompt.
   *
   * `suppressWorldPrompt` exists because a safe room holds two things worth
   * pressing Space at — Dave and the doctor — and in a small room both can be
   * in range at once. The scene silences this prompt when the doctor has the
   * press; without it the player saw two `Talk` prompts and
   * only one of them did anything.
   */
  renderUI(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    suppressWorldPrompt: boolean,
  ): void {
    if (suppressWorldPrompt || this.dialogOpen) return;
    const at = this.standingPosition;
    if (at === null || !this.isNear(active)) return;
    if (this.deps.safeRooms.safeRoomAt(active) === null) return;
    const sx = at.x - camX;
    const sy = at.y - camY;
    const headTop = this.artTop(sy, TILE_SIZE);
    const promptY = npcMarkerShows(this.marker)
      ? overheadIconTopY(ctx, headTop, TILE_SIZE, this.marker)
      : speechBubbleTop(this.bubbleOrigin(sy, TILE_SIZE), TILE_SIZE);
    drawInteractionPrompt(ctx, sx, promptY, TILE_SIZE, sy + TILE_SIZE, 'Talk');
  }
}
