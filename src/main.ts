import { Game } from './Game';
import { MAIN_LAYOUT, TEST_LAYOUT } from './world/layouts';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
// The automated tests use the small test map unless they ask for `world=main`.
const params = new URLSearchParams(location.search);
const layout = params.has('test') && params.get('world') !== 'main' ? TEST_LAYOUT : MAIN_LAYOUT;
const game = new Game(canvas, hud, layout);

// `?test` puts the simulation under manual control for automated checks.
if (new URLSearchParams(location.search).has('test')) game.manual = true;
else void game.adventure.boot();
(window as unknown as { game: Game }).game = game;
// Test helpers: item factories and tooltip rendering.
if (new URLSearchParams(location.search).has('test')) {
  void Promise.all([import('./items/items'), import('./ui/InventoryUI'), import('./save/Save'), import('./items/crafting')]).then(([items, ui, save, crafting]) => {
    (window as unknown as { items: unknown }).items = { ...items, tooltipHtml: ui.tooltipHtml, validateAccount: save.validateAccount };
    (window as unknown as { crafting: unknown }).crafting = crafting;
  });
}

game.start();
