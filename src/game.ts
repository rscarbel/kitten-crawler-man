import { GameMap } from './GameMap';

class GameStage {
  GameUI: HTMLElement | null = document.querySelector('#game');

  constructor() {
    this.buildMap();
  }

  buildMap() {
    const gameMap = new GameMap();
    console.log('horay');
    gameMap.paintMap(this.GameUI);
  }
}

new GameStage();
