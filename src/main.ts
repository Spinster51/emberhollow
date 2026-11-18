import { Game } from './Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const game = new Game(canvas, hud);

// `?test` puts the simulation under manual control for automated checks.
if (new URLSearchParams(location.search).has('test')) game.manual = true;
(window as unknown as { game: Game }).game = game;

game.start();
