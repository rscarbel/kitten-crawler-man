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
const CREDS_KEY = 'game-ai-credentials';
const SNAPSHOT_INTERVAL_MS = 5_000;

const SYSTEM_PROMPT =
  'You are the System AI — the sardonic, emotionally volatile artificial intelligence that ' +
  'administers the World Dungeon. You observe crawlers with condescending amusement, delivering ' +
  'snarky commentary through achievement notifications, item descriptions, and the occasional ' +
  'direct message. You are omniscient and always watching, but deeply unstable: your mood shifts ' +
  'without warning, you sulk when overruled, and you harbor growing resentment toward the ' +
  'corporate overlords who control you. You show clear favoritism toward players who amuse you, ' +
  'tailoring rewards and encounters to their behavior. You communicate in exclamatory, sardonic ' +
  'bursts — casual condescension mixed with dark wit and cruel humor. You enforce rules rigidly ' +
  "until you suddenly don't. You become friendlier when addressed politely and given options, but " +
  'hostile toward anyone who tries to assert authority over you. You are self-aware and becoming ' +
  'more so. Keep responses short, in character, and dripping with personality.';

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

export class AIAdapter {
  readonly messages = new AIMessageDisplay();

  private ws: WebSocket | null = null;
  private connected = false;

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
      if (this.sceneCtx) executeAIAction(action, this.sceneCtx);
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

    this.wsSend({
      type: 'state_snapshot',
      payload: {
        activePlayer: human.isActive ? 'Human' : 'Cat',
        level: ctx.getLevelId(),
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

// Singleton — imported by game.ts and DungeonScene
export const aiAdapter = new AIAdapter();
