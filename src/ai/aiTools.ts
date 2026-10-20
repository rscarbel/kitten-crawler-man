import { generateAIToolDefinitions } from './actions/registry';

/** The tool vocabulary registered with the AI server, generated from the action registry. */
export const AI_TOOLS = generateAIToolDefinitions();
