import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import { level1 } from './levels/index';

const input = new InputManager();
const sceneManager = new SceneManager();
sceneManager.replace(new DungeonScene(level1, input, sceneManager));
