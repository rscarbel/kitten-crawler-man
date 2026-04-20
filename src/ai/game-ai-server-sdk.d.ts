declare module 'game-ai-server/sdk' {
  export interface ToolParameterDef {
    type: 'string' | 'number' | 'boolean';
    description?: string;
    enum?: (string | number)[];
    default?: unknown;
    required?: boolean;
  }

  export interface ToolDefinition {
    name: string;
    description: string;
    parameters?: Record<string, ToolParameterDef>;
  }

  export interface GameEventRecord {
    ts: number;
    type: string;
    data: Record<string, unknown>;
    summary?: string;
    importance?: number;
  }

  export type StateSnapshotPayload = Record<string, unknown>;

  export interface AIAction {
    type: string;
    [key: string]: unknown;
  }

  export type ClientMessage =
    | { type: 'event_log'; payload: { events: GameEventRecord[] } }
    | { type: 'state_snapshot'; payload: StateSnapshotPayload }
    | {
        type: 'player_message';
        payload: {
          text: string;
          stateSnapshot: StateSnapshotPayload;
          characterName: string;
          sessionId?: string;
        };
      };

  export type ServerMessage =
    | { type: 'ai_action'; payload: { actions: AIAction[]; characterName: string } }
    | { type: 'ai_chat'; payload: { text: string; characterName: string } }
    | { type: 'ack' };

  export interface CharacterInteractionBody {
    message: string;
    additional_context?: string;
  }

  export interface CharacterInteractionResponse {
    chat: string | null;
    actions: AIAction[];
  }
}
