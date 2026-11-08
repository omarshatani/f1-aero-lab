import { SceneManager } from './editor/SceneManager';
import { CarProjectStore } from './state/CarProjectStore';
import { HudController } from './ui/HudController';

function bootstrap(): void {
  const viewportEl = document.getElementById('viewport');
  const hudRootEl = document.getElementById('hud-root');

  if (!viewportEl || !hudRootEl) {
    throw new Error('Missing #viewport or #hud-root container in index.html');
  }

  const store = new CarProjectStore();
  const sceneManager = new SceneManager(viewportEl, store);
  new HudController(hudRootEl, store, sceneManager);
}

bootstrap();
