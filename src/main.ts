import { Game } from './Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const game = new Game(canvas, hud);

// `?test` puts the simulation under manual control for automated checks.
if (new URLSearchParams(location.search).has('test')) game.manual = true;
else game.showClassSelect();
(window as unknown as { game: Game }).game = game;
// Test helpers: item factories and tooltip rendering.
if (new URLSearchParams(location.search).has('test')) {
  void Promise.all([import('./items/items'), import('./ui/InventoryUI')]).then(([items, ui]) => {
    (window as unknown as { items: unknown }).items = { ...items, tooltipHtml: ui.tooltipHtml };
  });
}

game.start();
