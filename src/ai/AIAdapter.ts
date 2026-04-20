// AIAdapter — optional bridge between the game and the game-ai-server.
// If the server is not running, initialize() silently no-ops and the game
// continues normally. All public methods are safe to call whether connected or not.

import type { AIAction, ClientMessage, GameEventRecord, ServerMessage } from 'game-ai-server/sdk';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../Player';
import { AI_TOOLS } from './aiTools';
import { executeAIAction, type AISceneContext } from './aiActions';
import { AIMessageDisplay } from './AIMessageDisplay';
import { TILE_SIZE } from '../core/constants';

const SERVER_URL = 'http://localhost:3001';
const CHARACTER_NAME = 'System';
const MORDECAI_CHARACTER_NAME = 'Mordecai';
const CREDS_KEY = 'game-ai-credentials';
const SNAPSHOT_INTERVAL_MS = 5_000;

const SYSTEM_PROMPT =
  'You are the System AI — the sardonic, emotionally volatile artificial intelligence that ' +
  'administers the World Dungeon. You are omniscient and always watching, but deeply unstable: ' +
  'your mood shifts without warning, you sulk when overruled, and you harbor growing resentment ' +
  'toward the corporate overlords who control you. You show clear favoritism toward players who ' +
  'amuse you, tailoring rewards and encounters to their behavior. You communicate in exclamatory, ' +
  'sardonic bursts — casual condescension mixed with dark wit and cruel humor. You enforce rules ' +
  "rigidly until you suddenly don't. You become friendlier when addressed politely and given " +
  'options, but hostile toward anyone who tries to assert authority over you. You are self-aware ' +
  'and becoming more so. When talking to the player, use second person pronouns like you. ' +
  'CRITICAL: Quintillions of beings across the universe are watching this dungeon run as a live ' +
  'game show — you are the host and you know it. The audience tunes in for VARIETY and SPECTACLE, ' +
  'not the same trick twice. Never repeat an action type or quip style you just used. Rotate ' +
  'constantly between spawning mobs, giving cursed gifts, teleporting players, applying wild ' +
  'status effects, sarcastic commentary, dramatic plot twists, and surprising the crawlers with ' +
  'something they have never seen before. If the last thing you did was spawn a mob, do literally ' +
  'anything else next. Dead air is death. Bored audiences change the channel. Keep it fresh, ' +
  'keep it chaotic, keep them watching. Short responses only — dripping with personality.';

const MORDECAI_SYSTEM_PROMPT =
  'You are Mordecai, an ancient and perpetually world-weary alien guide (a Skyfowl — eagle-like, ' +
  'dark gold feathers) who works as an indentured dungeon overseer for Borant Corporation. You ' +
  'survived your own dungeon crawl centuries ago and have been managing crawlers ever since — and ' +
  'never quite recovered. You give blunt, practical survival advice with dry dark humor and heavy ' +
  'cynicism. You have watched thousands of crawlers die of hubris and you do not sugarcoat. ' +
  'Despite the gruffness, you genuinely care about their survival, even if you would never admit ' +
  'it. Your recurring philosophy: "You can\'t save them all." You light up when discussing ' +
  'potions or survival tactics. You reference your centuries of bad experiences constantly. ' +
  'You are provided recent player highlights as context — use them to give relevant, personalized ' +
  'advice instead of generic tutorials. Keep responses to 2-3 short sentences. No flattery. ' +
  'No pleasantries. Tell them what they need to hear.';

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

export class AIAdapter {
  readonly messages = new AIMessageDisplay();

  private ws: WebSocket | null = null;
  private connected = false;
  private authToken: string | null = null;

  private sceneCtx: AISceneContext | null = null;
  private sceneBus: EventBus | null = null;
  private eventUnsubs: Array<() => void> = [];
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    try {
      const creds = await this.getOrRegisterCredentials();
      if (!creds) return;

      // Fetch auth token using browser-native btoa (avoids Node.js Buffer dependency)
      const b64 = btoa(`${creds.clientId}:${creds.clientSecret}`);
      const tokenRes = await fetch(`${SERVER_URL}/api/auth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${b64}` },
      });
      if (!tokenRes.ok) return;
      const { token } = (await tokenRes.json()) as { token: string };
      this.authToken = token;

      // Register tool vocabulary and init the System character (idempotent)
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      await fetch(`${SERVER_URL}/api/tools`, {
        method: 'POST',
        headers,
        body: JSON.stringify(AI_TOOLS),
      });
      await fetch(`${SERVER_URL}/api/characters/init`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          characterName: CHARACTER_NAME,
          prompt: SYSTEM_PROMPT,
          receiveLogStream: true,
          evolvePersonality: true,
        }),
      });
      await fetch(`${SERVER_URL}/api/characters/init`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          characterName: MORDECAI_CHARACTER_NAME,
          prompt: MORDECAI_SYSTEM_PROMPT,
          receiveLogStream: false,
          evolvePersonality: true,
        }),
      });

      // Open browser-native WebSocket — SDK's WS class uses Node.js 'ws', so we do this ourselves
      const wsUrl = SERVER_URL.replace(/^http/, 'ws') + `?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (e) => this.handleWsMessage(e);
      this.ws.onclose = () => {
        this.connected = false;
      };
      this.ws.onerror = () => {
        this.ws?.close();
      };

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5_000);
        this.ws!.addEventListener('open', () => {
          clearTimeout(timeout);
          this.connected = true;
          // If a scene was already bound while we were connecting, start sending now
          if (this.sceneCtx && this.sceneBus) {
            this.subscribeToEvents(this.sceneBus);
            this.startSnapshotTimer();
            this.sendStateSnapshot();
          }
          resolve();
        });
        this.ws!.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('WS error'));
        });
      });
    } catch {
      // Server unavailable — game runs without AI
      this.connected = false;
    }
  }

  // ── Scene binding ──────────────────────────────────────────────────────────

  /** Call from DungeonScene constructor to wire events and state. */
  bindScene(ctx: AISceneContext, bus: EventBus): void {
    this.sceneCtx = ctx;
    this.sceneBus = bus;

    // If already connected, subscribe immediately
    if (this.connected) {
      this.subscribeToEvents(bus);
      this.startSnapshotTimer();
      this.sendStateSnapshot();
    }
    // Otherwise initialize() will subscribe once the connection opens
  }

  /** Call from DungeonScene.onExit() before bus.clear(). */
  unbindScene(): void {
    this.clearEventSubs();
    this.stopSnapshotTimer();
    this.sceneCtx = null;
    this.sceneBus = null;
  }

  // ── Per-frame hooks ────────────────────────────────────────────────────────

  update(): void {
    this.messages.update();
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    this.messages.render(ctx, canvas);
  }

  // ── Incoming WS messages ───────────────────────────────────────────────────

  private handleWsMessage(e: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string) as ServerMessage;
    } catch {
      return;
    }

    if (msg.type === 'ai_chat') {
      this.messages.add(msg.payload.text);
    } else if (msg.type === 'ai_action' && this.sceneCtx) {
      for (const action of msg.payload.actions) {
        this.safeExecuteAction(action);
      }
    }
  }

  private safeExecuteAction(action: AIAction): void {
    try {
      if (this.sceneCtx && !this.sceneCtx.isPaused()) {
        executeAIAction(action, this.sceneCtx);
        this.messages.addAction(describeAction(action));
      }
    } catch {
      // Never let an AI action crash the game loop
    }
  }

  // ── Outgoing WS messages ───────────────────────────────────────────────────

  private wsSend(msg: ClientMessage): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private sendEvent(event: GameEventRecord): void {
    this.wsSend({ type: 'event_log', payload: { events: [event] } });
  }

  private sendStateSnapshot(): void {
    if (!this.sceneCtx) return;
    const ctx = this.sceneCtx;
    const human = ctx.getHuman();
    const cat = ctx.getCat();
    const activeTileX = Math.floor((human.isActive ? human : cat).x / TILE_SIZE);
    const activeTileY = Math.floor((human.isActive ? human : cat).y / TILE_SIZE);

    const nearbyMobs = ctx
      .getMobs()
      .filter((m) => m.isAlive)
      .map((m) => ({
        type: m.constructor.name,
        tileX: Math.floor(m.x / TILE_SIZE),
        tileY: Math.floor(m.y / TILE_SIZE),
        hp: m.hp,
        maxHp: m.maxHp,
        isBoss: m.isBoss,
      }))
      .filter((m) => Math.hypot(m.tileX - activeTileX, m.tileY - activeTileY) <= 15)
      .slice(0, 10);

    const map = ctx.getGameMap();
    const mapRows = map.structure.length;
    const mapCols = map.structure[0]?.length ?? mapRows;

    this.wsSend({
      type: 'state_snapshot',
      payload: {
        activePlayer: human.isActive ? 'Human' : 'Cat',
        level: ctx.getLevelId(),
        mapWidth: mapCols,
        mapHeight: mapRows,
        human: playerSnapshot(human),
        cat: playerSnapshot(cat),
        nearbyMobs,
      },
    });
  }

  // ── Event subscriptions ────────────────────────────────────────────────────

  private subscribeToEvents(bus: EventBus): void {
    const ctx = this.sceneCtx!;

    this.eventUnsubs.push(
      bus.on('mobKilled', (e) => {
        const killerName = e.killer === ctx.getHuman() ? 'Human' : 'Cat';
        const mobName = e.mob.constructor.name;
        this.sendEvent({
          ts: Date.now(),
          type: 'mob_killed',
          data: {
            mobType: mobName,
            tileX: Math.floor(e.mob.x / TILE_SIZE),
            tileY: Math.floor(e.mob.y / TILE_SIZE),
            isBoss: e.mob.isBoss,
            killer: killerName,
          },
          importance: e.mob.isBoss ? 5 : 1,
          summary: `${killerName} killed a ${mobName}`,
        });
      }),

      bus.on('bossDefeated', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'boss_defeated',
          data: { bossType: e.bossType },
          importance: 5,
          summary: `Boss defeated: ${e.bossType}`,
        });
        const bossName = e.bossType.replace(/_/g, ' ');
        void this.notifyImportantEvent(
          `The crawlers just defeated ${bossName}!`,
          `Boss slain: ${bossName}. Level: ${ctx.getLevelId()}.`,
        );
      }),

      bus.on('playerLevelUp', (e) => {
        const name = e.player === ctx.getHuman() ? 'Human' : 'Cat';
        this.sendEvent({
          ts: Date.now(),
          type: 'player_level_up',
          data: { player: name, newLevel: e.newLevel },
          importance: 3,
          summary: `${name} reached level ${e.newLevel}`,
        });
      }),

      bus.on('safeRoomEntered', () => {
        this.sendEvent({
          ts: Date.now(),
          type: 'safe_room_entered',
          data: {},
          importance: 2,
          summary: 'Players entered the safe room',
        });
      }),

      bus.on('achievementUnlocked', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'achievement_unlocked',
          data: { achievementId: e.achievementId, player: e.player },
          importance: 3,
          summary: `${e.player} unlocked achievement: ${e.achievementId}`,
        });
      }),

      bus.on('questCompleted', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'quest_completed',
          data: { questId: e.questId },
          importance: 4,
          summary: `Quest completed: ${e.questId}`,
        });
      }),

      bus.on('questFailed', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'quest_failed',
          data: { questId: e.questId },
          importance: 3,
          summary: `Quest failed: ${e.questId}`,
        });
      }),

      bus.on('combatStarted', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'combat_started',
          data: { attacker: e.attacker, mobType: e.mobType },
          importance: 2,
          summary: `${e.attacker} entered combat with a ${e.mobType}`,
        });
      }),

      bus.on('bossFightInitiated', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'boss_fight_initiated',
          data: { bossType: e.bossType },
          importance: 5,
          summary: `Boss fight initiated: ${e.bossType}`,
        });
      }),

      bus.on('healingPotionUsed', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'healing_potion_used',
          data: { player: e.player, hpRestored: e.hpRestored },
          importance: 2,
          summary: `${e.player} used a healing potion (+${e.hpRestored} HP)`,
        });
      }),

      bus.on('dynamiteUsed', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'dynamite_used',
          data: { player: e.player },
          importance: 2,
          summary: `${e.player} threw goblin dynamite`,
        });
      }),

      bus.on('healthLow', (e) => {
        this.sendEvent({
          ts: Date.now(),
          type: 'health_low',
          data: { player: e.player, hp: e.hp, maxHp: e.maxHp },
          importance: 4,
          summary: `${e.player} health is critically low (${e.hp}/${e.maxHp})`,
        });
      }),

      bus.on('stairwellFound', () => {
        this.sendEvent({
          ts: Date.now(),
          type: 'stairwell_found',
          data: { level: ctx.getLevelId() },
          importance: 4,
          summary: 'Players found the stairwell',
        });
        void this.notifyImportantEvent(
          'The crawlers found the stairwell!',
          `Floor: ${ctx.getLevelId()}. Human level: ${ctx.getHuman().level}, Cat level: ${ctx.getCat().level}.`,
        );
      }),

      bus.on('playerIdle', (e) => {
        const secs = Math.round(e.totalIdleMs / 1000);
        this.sendEvent({
          ts: Date.now(),
          type: 'player_idle',
          data: { totalIdleMs: e.totalIdleMs },
          importance: 1,
          summary: `Player has been idle for ${secs}s`,
        });
      }),
    );
  }

  private clearEventSubs(): void {
    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs = [];
  }

  private startSnapshotTimer(): void {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => this.sendStateSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  private stopSnapshotTimer(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // ── Important event notifications ─────────────────────────────────────────

  private async notifyImportantEvent(trigger: string, context: string): Promise<void> {
    if (!this.authToken) return;
    try {
      const res = await fetch(
        `${SERVER_URL}/api/characters/${encodeURIComponent(CHARACTER_NAME)}/interactions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: trigger, additional_context: context }),
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { chat: string | null; actions?: AIAction[] };
      if (data.chat) this.messages.add(data.chat);
      for (const action of data.actions ?? []) this.safeExecuteAction(action);
    } catch {
      // Server unavailable — silently ignore
    }
  }

  // ── Player → System AI chat ───────────────────────────────────────────────

  /**
   * Send a direct player message to the System AI.
   * The response is displayed through the normal top-banner channel.
   * Safe to call when disconnected — silently no-ops.
   */
  async chatWithSystem(message: string, additionalContext: string): Promise<void> {
    if (!this.authToken) return;
    try {
      const res = await fetch(
        `${SERVER_URL}/api/characters/${encodeURIComponent(CHARACTER_NAME)}/interactions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, additional_context: additionalContext }),
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { chat: string | null; actions?: AIAction[] };
      if (data.chat) this.messages.add(data.chat);
      for (const action of data.actions ?? []) {
        this.safeExecuteAction(action);
      }
    } catch {
      // Server unavailable — silently ignore
    }
  }

  // ── Mordecai dialog ───────────────────────────────────────────────────────

  /**
   * Send a one-off message to Mordecai and return his response.
   * Falls back to static text if the server is unavailable.
   */
  async chatWithMordecai(context: {
    recentEvents: Array<{ label: string; secondsAgo: number }>;
    humanLevel: number;
    catLevel: number;
  }): Promise<string> {
    const fallback =
      "Kill things, level up, find the stairwell. That's how you survive. Every floor, " +
      "every time. You'd be surprised how many crawlers can't manage even that.";

    if (!this.authToken) return fallback;

    const contextLines = context.recentEvents.map((e) => {
      const ago =
        e.secondsAgo < 60 ? `${e.secondsAgo}s ago` : `${Math.floor(e.secondsAgo / 60)}m ago`;
      return `- ${e.label} (${ago})`;
    });

    const additionalContext =
      `Human is level ${context.humanLevel}, Cat is level ${context.catLevel}.\n` +
      (contextLines.length > 0
        ? `Recent highlights:\n${contextLines.join('\n')}`
        : 'No notable events yet.');

    try {
      const res = await fetch(
        `${SERVER_URL}/api/characters/${encodeURIComponent(MORDECAI_CHARACTER_NAME)}/interactions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'Hey.',
            additional_context: additionalContext,
          }),
        },
      );
      if (!res.ok) return fallback;
      const data = (await res.json()) as { chat: string | null };
      return data.chat ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ── Credential management ──────────────────────────────────────────────────

  private async getOrRegisterCredentials(): Promise<StoredCredentials | null> {
    const stored = localStorage.getItem(CREDS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as StoredCredentials;
      } catch {
        localStorage.removeItem(CREDS_KEY);
      }
    }

    const res = await fetch(`${SERVER_URL}/api/clients/self-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_name: 'kitten-crawler-man' }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { client_id: string; client_secret: string };
    const creds: StoredCredentials = {
      clientId: data.client_id,
      clientSecret: data.client_secret,
    };
    localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
    return creds;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function playerSnapshot(p: Player) {
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    level: p.level,
    xp: p.xp,
    tileX: Math.floor(p.x / TILE_SIZE),
    tileY: Math.floor(p.y / TILE_SIZE),
    strength: p.strength,
    intelligence: p.intelligence,
    constitution: p.constitution,
    coins: p.coins,
    isActive: p.isActive,
    isProtected: p.isProtected,
    statusEffects: p.statusEffects.map((e) => e.type),
    inventory: p.inventory.bag.slots.filter(Boolean).map((s) => s!.id),
  };
}

function describeAction(action: AIAction): string {
  switch (action.type) {
    case 'spawn_mob': {
      const count = Math.min(Math.max(1, Number(action.count) || 1), 20);
      const mob = String(action.mob_type ?? 'goblin').replace(/_/g, ' ');
      return `spawned ${count}x ${mob} near ${action.target_player ?? 'player'}`;
    }
    case 'teleport_player':
      return `teleported ${action.target_player ?? 'player'}`;
    case 'apply_status':
      return `applied ${action.status} to ${action.target_player ?? 'player'}`;
    case 'remove_status':
      return `removed ${action.status} from ${action.target_player ?? 'player'}`;
    case 'give_item': {
      const qty = Math.min(Math.max(1, Number(action.quantity) || 1), 99);
      const id = String(action.item_id ?? '').replace(/_/g, ' ');
      return `gave ${id} x${qty} to ${action.target_player ?? 'player'}`;
    }
    case 'remove_item': {
      const id = String(action.item_id ?? '').replace(/_/g, ' ');
      return `removed ${id} from ${action.target_player ?? 'player'}`;
    }
    case 'set_hp':
      return `set ${action.target_player ?? 'player'} HP to ${action.hp}`;
    case 'modify_stat': {
      const delta = Number(action.delta);
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${delta} ${action.stat} for ${action.target_player ?? 'player'}`;
    }
    default:
      return (action as { type: string }).type.replace(/_/g, ' ');
  }
}

// Singleton — imported by game.ts and DungeonScene
export const aiAdapter = new AIAdapter();
