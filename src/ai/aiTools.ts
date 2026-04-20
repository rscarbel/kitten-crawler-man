import type { ToolDefinition } from 'game-ai-server/sdk';

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'spawn_mob',
    description:
      'Spawn one or more enemies near a player. Use to menace, punish, or entertain crawlers.',
    parameters: {
      mob_type: {
        type: 'string',
        description:
          'Type of mob. Valid: goblin, rat, llama, cockroach, troglodyte, tuskling, bugaboo',
        required: true,
      },
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        description: 'Which player to spawn near.',
        required: true,
      },
      count: {
        type: 'number',
        description: 'How many to spawn.',
      },
    },
  },
  {
    name: 'teleport_player',
    description:
      'Teleport a player to tile coordinates on the current map. Valid tile coordinates range from 0 to mapWidth-1 (X) and 0 to mapHeight-1 (Y), both provided in the state snapshot.',
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      tile_x: {
        type: 'number',
        description: 'Target tile X coordinate (0 to mapWidth-1).',
        required: true,
      },
      tile_y: {
        type: 'number',
        description: 'Target tile Y coordinate (0 to mapHeight-1).',
        required: true,
      },
    },
  },
  {
    name: 'apply_status',
    description: 'Afflict a player with a status effect. For when they deserve it.',
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      status: {
        type: 'string',
        enum: ['burn', 'poison', 'sepsis'],
        required: true,
      },
    },
  },
  {
    name: 'remove_status',
    description: 'Remove a status effect from a player. Magnanimous of you.',
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      status: {
        type: 'string',
        enum: ['burn', 'poison', 'sepsis'],
        required: true,
      },
    },
  },
  {
    name: 'give_item',
    description: "Place an item into a player's inventory. Rewards should be earned.",
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      item_id: {
        type: 'string',
        enum: [
          'health_potion',
          'scroll_of_confusing_fog',
          'goblin_dynamite',
          'gym_dumbbell',
          'gym_bench_press',
          'gym_treadmill',
        ],
        required: true,
      },
      quantity: {
        type: 'number',
        description: 'How many.',
      },
    },
  },
  {
    name: 'remove_item',
    description: "Remove an item from a player's inventory. What? They had too many.",
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      item_id: {
        type: 'string',
        description: 'The item ID to remove.',
        required: true,
      },
      quantity: {
        type: 'number',
        description: 'How many to remove. Default 1.',
      },
    },
  },
  {
    name: 'set_hp',
    description: "Set a player's current HP to an exact value.",
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      hp: {
        type: 'number',
        description: 'New HP value. Clamped between 1 and maxHp.',
        required: true,
      },
    },
  },
  {
    name: 'modify_stat',
    description:
      "Temporarily adjust a player's base stat for 30 seconds. Use positive or negative delta.",
    parameters: {
      target_player: {
        type: 'string',
        enum: ['Human', 'Cat'],
        required: true,
      },
      stat: {
        type: 'string',
        enum: ['strength', 'intelligence', 'constitution'],
        required: true,
      },
      delta: {
        type: 'number',
        description: 'Amount to add. Negative values reduce the stat.',
        required: true,
      },
    },
  },
];
