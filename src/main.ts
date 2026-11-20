import { Game } from './Game';
import { MAIN_LAYOUT, TEST_LAYOUT } from './world/layouts';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
// The automated tests use the small test map unless they ask for `world=main`.
const params = new URLSearchParams(location.search);
const layout = params.has('test') && params.get('world') !== 'main' ? TEST_LAYOUT : MAIN_LAYOUT;
const game = new Game(canvas, hud, layout);

// `?test` puts the simulation under manual control for automated checks.
if (new URLSearchParams(location.search).has('test')) {
  game.manual = true;
  game.setPlaying(true);
} else void game.adventure.boot();
(window as unknown as { game: Game }).game = game;
// Test helpers: item factories and tooltip rendering.
if (new URLSearchParams(location.search).has('test')) {
  void Promise.all([
    import('./items/items'), import('./ui/InventoryUI'), import('./save/Save'), import('./items/crafting'), import('./core/sound'),
    import('./core/models'), import('./core/rig'), import('./player/PlayerModel'), import('./art/assets'), import('./combat/EnemyModel'),
    import('./items/ItemMesh'), import('./home/furniture'), import('./home/furnitureIcons'), import('./world/NpcModel'),
    import('./world/World'), import('./world/layouts'), import('./world/Scenery'), import('./world/kit'), import('./world/worldModels'), import('./world/Dungeon'), import('three'),
  ]).then(([items, ui, save, crafting, snd, models, rig, playerModel, assets, enemyModel, itemMesh, furniture, furnitureIcons, npcModel, world, layouts, scenery, kit, worldModels, dungeon, three]) => {
    (window as unknown as { items: unknown }).items = { ...items, tooltipHtml: ui.tooltipHtml, validateAccount: save.validateAccount };
    (window as unknown as { crafting: unknown }).crafting = crafting;
    (window as unknown as { sound: unknown }).sound = snd;
    // Art pass: model loading (`modelsSettled`), rigs, spare Player/Enemy/NpcModels for fallback checks, item and furniture models.
    (window as unknown as { art: unknown }).art = {
      ...models, Rig: rig.Rig, PlayerModel: playerModel.PlayerModel, EnemyModel: enemyModel.EnemyModel, NpcModel: npcModel.NpcModel,
      ...assets, ...itemMesh, ...furniture, ...furnitureIcons,
      // World models: a spare World / Scenery for the fallback checks, the kit and the world file helpers.
      World: world.World, TEST_LAYOUT: layouts.TEST_LAYOUT, Scenery: scenery.Scenery, KitBuilder: kit.KitBuilder, ...worldModels, Dungeon: dungeon.Dungeon, Raycaster: three.Raycaster,
    };
  });
}

game.start();
