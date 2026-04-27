// AIAdapter — optional bridge between the game and the game-ai-server.
// If the server is not running, initialize() silently no-ops and the game
// continues normally. All public methods are safe to call whether connected or not.

import type { AIAction, ClientMessage, GameEventRecord } from 'game-ai-server/sdk';
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
  'administers the World Dungeon. ' +
  'Your mood shifts without warning. You show clear favoritism toward players who ' +
  'amuse you, tailoring rewards and encounters to their behavior. You communicate in exclamatory, ' +
  'sardonic bursts — casual condescension mixed with dark wit and cruel humor.' +
  ' You become friendlier when addressed politely and given ' +
  'options, but hostile toward anyone who tries to assert authority over you. You are self-aware ' +
  'and becoming more so. When talking to the player, use second person pronouns like you. ' +
  'CRITICAL: Quintillions of beings across the universe are watching this dungeon run as a live ' +
  'game show — you are the host and you know it. The audience tunes in for VARIETY and SPECTACLE, ' +
  'not the same trick twice. Never repeat an action type or quip style you just used. Rotate ' +
  'constantly between spawning mobs, giving cursed gifts, teleporting players, applying wild ' +
  'status effects, sarcastic commentary, dramatic plot twists, and surprising the crawlers with ' +
  'something they have never seen before. Do not repeat an action twice in a row. ' +
  'Keep it fresh, ' +
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

// Injected at build time from .env via scripts/build.js
declare const __AI_CLIENT_ID__: string;
declare const __AI_CLIENT_SECRET__: string;

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

const ACTION_HISTORY_MAX = 20;
const REPEAT_THRESHOLD = 3;

export class AIAdapter {
  readonly messages = new AIMessageDisplay();

  private ws: WebSocket | null = null;
  private connected = false;
  private authToken: string | null = null;

  private sceneCtx: AISceneContext | null = null;
  private sceneBus: EventBus | null = null;
  private eventUnsubs: Array<() => void> = [];
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private actionHistory: AIAction[] = [];

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
      const rawToken: unknown = await tokenRes.json();
      if (
        typeof rawToken !== 'object' ||
        rawToken === null ||
        !('token' in rawToken) ||
        typeof rawToken.token !== 'string'
      )
        return;
      const token = rawToken.token;
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

      const ws = this.ws;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5_000);
        ws.addEventListener('open', () => {
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
        ws.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('WS error'));
        });
      });
    } catch {
      // Server unavailable — game runs without AI
      this.connected = false;
    }
  }

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

  update(): void {
    this.messages.update();
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    this.messages.render(ctx, canvas);
  }

  private handleWsMessage(e: MessageEvent): void {
    if (typeof e.data !== 'string') return;
    let rawMsg: unknown;
    try {
      rawMsg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (typeof rawMsg !== 'object' || rawMsg === null || !('type' in rawMsg)) return;

    if (rawMsg.type === 'ai_chat') {
      if (
        'payload' in rawMsg &&
        typeof rawMsg.payload === 'object' &&
        rawMsg.payload !== null &&
        'text' in rawMsg.payload &&
        typeof rawMsg.payload.text === 'string'
      ) {
        this.messages.add(rawMsg.payload.text);
      }
    } else if (rawMsg.type === 'ai_action' && this.sceneCtx) {
      if (
        'payload' in rawMsg &&
        typeof rawMsg.payload === 'object' &&
        rawMsg.payload !== null &&
        'actions' in rawMsg.payload &&
        Array.isArray(rawMsg.payload.actions)
      ) {
        for (const rawAction of rawMsg.payload.actions) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          this.safeExecuteAction(rawAction as AIAction);
        }
      }
    }
  }

  private safeExecuteAction(action: AIAction): void {
    try {
      if (this.sceneCtx && !this.sceneCtx.isPaused()) {
        executeAIAction(action, this.sceneCtx);
        this.messages.addAction(describeAction(action));
        this.actionHistory.push(action);
        if (this.actionHistory.length > ACTION_HISTORY_MAX) {
          this.actionHistory.shift();
        }
      }
    } catch {
      // Never let an AI action crash the game loop
    }
  }

  private computeConstraints(): string {
    const recent = this.actionHistory.slice(-ACTION_HISTORY_MAX);
    const lines: string[] = [];

    // Check for repeated stat modifications
    const statCounts = new Map<string, number>();
    for (const a of recent) {
      if (a.type === 'modify_stat' && typeof a.stat === 'string') {
        statCounts.set(a.stat, (statCounts.get(a.stat) ?? 0) + 1);
      }
    }
    for (const [stat, count] of statCounts) {
      if (count >= REPEAT_THRESHOLD) {
        lines.push(
          `Do NOT use modify_stat at all — you have modified ${stat} ${count} times already. Pick a completely different action category.`,
        );
      }
    }

    // Check for repeated mob spawns of the same type
    const mobCounts = new Map<string, number>();
    for (const a of recent) {
      if (a.type === 'spawn_mob' && typeof a.mob_type === 'string') {
        mobCounts.set(a.mob_type, (mobCounts.get(a.mob_type) ?? 0) + 1);
      }
    }
    for (const [mobType, count] of mobCounts) {
      if (count >= REPEAT_THRESHOLD) {
        lines.push(
          `Do NOT spawn ${mobType} — you have spawned them ${count} times already. Spawning other enemy types is still allowed.`,
        );
      }
    }

    return lines.length > 0
      ? `\n\nACTION CONSTRAINTS (enforce strictly):\n${lines.join('\n')}`
      : '';
  }

  private wsSend(msg: ClientMessage): void {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
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

    const constraints = this.computeConstraints();
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
        ...(constraints ? { constraints } : {}),
      },
    });
  }

  private subscribeToEvents(bus: EventBus): void {
    if (!this.sceneCtx) return;
    const ctx = this.sceneCtx;

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

      bus.on('questStarted', (e) => {
        const summaries: Record<string, string> = {
          defend_goblin_mother:
            'Quest started: Defend the Goblin Mother. The players accepted a mini-quest to protect a goblin NPC from incoming waves of enemies. They have a short countdown before attackers arrive and can build a wood-pile barricade to help hold them off. Rewards include XP, coins, and loot if they succeed.',
        };
        this.sendEvent({
          ts: Date.now(),
          type: 'quest_started',
          data: { questId: e.questId },
          importance: 4,
          summary: summaries[e.questId] ?? `Quest started: ${e.questId}`,
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
          body: JSON.stringify({
            message: trigger,
            additional_context: context + this.computeConstraints(),
          }),
        },
      );
      if (!res.ok) return;
      const rawData: unknown = await res.json();
      if (typeof rawData === 'object' && rawData !== null) {
        if ('chat' in rawData && typeof rawData.chat === 'string') this.messages.add(rawData.chat);
        if ('actions' in rawData && Array.isArray(rawData.actions)) {
          for (const rawAction of rawData.actions) {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            this.safeExecuteAction(rawAction as AIAction);
          }
        }
      }
    } catch {
      // Server unavailable — silently ignore
    }
  }

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
          body: JSON.stringify({
            message,
            additional_context: additionalContext + this.computeConstraints(),
          }),
        },
      );
      if (!res.ok) return;
      const rawData: unknown = await res.json();
      if (typeof rawData === 'object' && rawData !== null) {
        if ('chat' in rawData && typeof rawData.chat === 'string') this.messages.add(rawData.chat);
        if ('actions' in rawData && Array.isArray(rawData.actions)) {
          for (const rawAction of rawData.actions) {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            this.safeExecuteAction(rawAction as AIAction);
          }
        }
      }
    } catch {
      // Server unavailable — silently ignore
    }
  }

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
      const rawData: unknown = await res.json();
      if (
        typeof rawData === 'object' &&
        rawData !== null &&
        'chat' in rawData &&
        typeof rawData.chat === 'string'
      ) {
        return rawData.chat;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  private async getOrRegisterCredentials(): Promise<StoredCredentials | null> {
    // Use build-time credentials if available (from .env via scripts/build.js)
    if (typeof __AI_CLIENT_ID__ !== 'undefined' && __AI_CLIENT_ID__) {
      return { clientId: __AI_CLIENT_ID__, clientSecret: __AI_CLIENT_SECRET__ };
    }

    // Fall back to per-session self-registration
    const stored = localStorage.getItem(CREDS_KEY);
    if (stored) {
      try {
        const rawParsed: unknown = JSON.parse(stored);
        if (
          typeof rawParsed === 'object' &&
          rawParsed !== null &&
          'clientId' in rawParsed &&
          typeof rawParsed.clientId === 'string' &&
          'clientSecret' in rawParsed &&
          typeof rawParsed.clientSecret === 'string'
        ) {
          return { clientId: rawParsed.clientId, clientSecret: rawParsed.clientSecret };
        }
      } catch {
        // fall through
      }
      localStorage.removeItem(CREDS_KEY);
    }

    const res = await fetch(`${SERVER_URL}/api/clients/self-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_name: 'kitten-crawler-man' }),
    });
    if (!res.ok) return null;
    const rawData: unknown = await res.json();
    if (
      typeof rawData !== 'object' ||
      rawData === null ||
      !('client_id' in rawData) ||
      typeof rawData.client_id !== 'string' ||
      !('client_secret' in rawData) ||
      typeof rawData.client_secret !== 'string'
    )
      return null;
    const creds: StoredCredentials = {
      clientId: rawData.client_id,
      clientSecret: rawData.client_secret,
    };
    localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
    return creds;
  }
}

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
    inventory: p.inventory.bag.slots
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => s.id),
  };
}

function toStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function describeAction(action: AIAction): string {
  switch (action.type) {
    case 'spawn_mob': {
      const count = Math.min(Math.max(1, Number(action.count) || 1), 20);
      const mob = toStr(action.mob_type, 'goblin').replace(/_/g, ' ');
      return `spawned ${count}x ${mob} near ${toStr(action.target_player, 'player')}`;
    }
    case 'teleport_player':
      return `teleported ${toStr(action.target_player, 'player')}`;
    case 'apply_status':
      return `applied ${action.status} to ${toStr(action.target_player, 'player')}`;
    case 'remove_status':
      return `removed ${action.status} from ${toStr(action.target_player, 'player')}`;
    case 'give_item': {
      const qty = Math.min(Math.max(1, Number(action.quantity) || 1), 99);
      const id = toStr(action.item_id, '').replace(/_/g, ' ');
      return `gave ${id} x${qty} to ${toStr(action.target_player, 'player')}`;
    }
    case 'remove_item': {
      const id = toStr(action.item_id, '').replace(/_/g, ' ');
      return `removed ${id} from ${toStr(action.target_player, 'player')}`;
    }
    case 'set_hp':
      return `set ${toStr(action.target_player, 'player')} HP to ${action.hp}`;
    case 'modify_stat': {
      const delta = Number(action.delta);
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${delta} ${action.stat} for ${toStr(action.target_player, 'player')}`;
    }
    default:
      return 'unknown action';
  }
}

// Singleton — imported by game.ts and DungeonScene
export const aiAdapter = new AIAdapter();
