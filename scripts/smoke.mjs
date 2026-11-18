// Movement smoke test: drives the game in headless Chromium through window.game.step().
// Usage: npm run build && node scripts/smoke.mjs [--shots dir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const PORT = 4179;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', () => reject(new Error('preview server exited')));
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/?test`);
await page.waitForFunction(() => window.game);

let failed = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failed++;
};
const run = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  if (shotsDir) await page.evaluate(() => window.game.step(0, null, true)), await page.screenshot({ path: `${shotsDir}/${name}.png` });
};

// Helper installed in the page: teleport the player and reset state.
await run(() => {
  window.place = (x, z, yaw, extraY = 0) => {
    const g = window.game;
    const p = g.player;
    p.respawn();
    p.pos.set(x, g.world.groundAt(x, z, 1e9) + extraY, z);
    p.vel.set(0, 0, 0);
    p.state = extraY > 0 ? 'air' : 'ground';
    p.stateTime = 0;
    g.cam.yaw = yaw;
  };
  // Hold `input` until `done(player)` is true (max `limit` frames); returns frames used.
  window.until = (input, done, limit) => {
    const p = window.game.player;
    window.maxY = p.pos.y;
    for (let i = 0; i < limit; i++) {
      window.game.step(1, input);
      window.maxY = Math.max(window.maxY, p.pos.y);
      if (done(p)) return i + 1;
    }
    return -1;
  };
  window.snap = () => {
    const p = window.game.player;
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, state: p.state, stamina: p.stamina, hp: p.hp, vy: p.vel.y };
  };
});

// 1. Spawn and walk.
let s = await run(() => (window.game.step(10), window.snap()));
check('spawn on ground', s.state === 'ground', `y=${s.y.toFixed(2)}`);
await shot('01-spawn');
const before = s;
s = await run(() => (window.game.step(60, { moveY: 1 }), window.snap()));
const walked = Math.hypot(s.x - before.x, s.z - before.z);
check('walk ~4.5 m in 1 s', walked > 3.5 && walked < 5, `${walked.toFixed(2)} m`);

// 2. Jump.
s = await run(() => {
  window.game.step(1, { held: ['jump'] });
  window.game.step(14);
  return window.snap();
});
check('jump goes up', s.state === 'air' && s.y > before.y + 0.5, `y=${s.y.toFixed(2)} state=${s.state}`);
s = await run(() => (window.game.step(60), window.snap()));
check('jump lands', s.state === 'ground', s.state);

// 3. Dodge-roll.
s = await run(() => {
  window.game.step(30);
  window.game.step(1, { held: ['dodge'], moveY: 1 });
  return window.snap();
});
check('dodge starts roll and costs stamina', s.state === 'roll' && Math.abs(s.stamina - 85) < 1, `state=${s.state} stamina=${s.stamina.toFixed(1)}`);
s = await run(() => (window.game.step(40), window.snap()));
check('roll ends on ground', s.state === 'ground', s.state);

// 4. Climb the stone tower (box at x -22, z 28, 6x6): stand south of it, face north (-z).
await run(() => window.place(-22, 34, 0));
s = await run(() => (window.game.step(90, { moveY: 1 }), window.snap()));
check('walking into tower starts climbing', s.state === 'climb', `state=${s.state} z=${s.z.toFixed(2)}`);
await shot('02-climb-tower');
const towerTop = await run(() => window.game.world.boxes[0].maxY);
s = await run(() => {
  window.game.player.stamina = 100;
  window.until({ moveY: 1 }, (p) => p.state === 'mantle', 60 * 12);
  window.game.step(40);
  return window.snap();
});
check('climb 18 m tower on one stamina bar and mantle on top', s.state === 'ground' && Math.abs(s.y - towerTop) < 0.05, `y=${s.y.toFixed(1)} top=${towerTop.toFixed(1)} stamina=${s.stamina.toFixed(0)}`);

// Short climb with full stamina: tall crate (2.4 m) → mantle onto it.
await run(() => window.place(7, 6.5, 0));
s = await run(() => (window.until({ moveY: 1 }, (p) => p.state === 'mantle', 200), window.game.step(30), window.snap()));
const crateTop = await run(() => window.game.world.boxes[3].maxY);
check('climb + mantle onto 2.4 m crate', s.state === 'ground' && Math.abs(s.y - crateTop) < 0.05, `y=${s.y.toFixed(2)} top=${crateTop.toFixed(2)} state=${s.state}`);

// Vault: 1 m crate.
await run(() => window.place(4, 4.5, 0));
s = await run(() => (window.game.step(60, { moveY: 1 }), window.snap()));
const vaultTop = await run(() => window.game.world.boxes[2].maxY);
check('vault onto 1 m crate', Math.abs(s.y - vaultTop) < 0.05, `y=${s.y.toFixed(2)} top=${vaultTop.toFixed(2)} state=${s.state}`);

// 5. Terrain cliff: plateau centred at (45, -20), radius ~21.5. Approach from the south.
await run(() => window.place(45, 6, 0));
s = await run(() => (window.until({ moveY: 1 }, (p) => p.state === 'mantle', 60 * 10), window.game.step(30), window.snap()));
await shot('03-plateau');
check('climb terrain cliff onto plateau', s.state === 'ground' && s.y > 10, `y=${s.y.toFixed(1)} z=${s.z.toFixed(1)} state=${s.state}`);

// 6. Glide off the tower top.
await run(() => {
  const g = window.game;
  const b = g.world.boxes[0];
  const p = g.player;
  p.respawn();
  p.pos.set(-22, b.maxY, 28);
  p.state = 'ground';
  g.cam.yaw = Math.PI; // face +z (south)
});
s = await run(() => {
  window.until({ moveY: 1 }, (p) => p.state === 'air', 120); // run off the edge
  window.game.step(12, { moveY: 1 });
  window.game.step(1, { held: ['jump'], moveY: 1 });
  window.game.step(30, { moveY: 1 });
  return window.snap();
});
check('glider opens in the air', s.state === 'glide', `state=${s.state}`);
await shot('04-glide');
const g1 = s;
s = await run(() => (window.game.step(60, { moveY: 1 }), window.snap()));
const sink = g1.y - s.y;
const dist = Math.hypot(s.x - g1.x, s.z - g1.z);
check('glide sinks ~2 m/s', sink > 1.5 && sink < 2.6, `${sink.toFixed(2)} m/s`);
check('glide moves ~8 m/s', dist > 6.5 && dist < 9, `${dist.toFixed(2)} m/s`);
check('glide drains stamina', s.stamina < g1.stamina, `${g1.stamina.toFixed(1)} -> ${s.stamina.toFixed(1)}`);
s = await run(() => (window.game.step(60 * 15, { moveY: 1 }), window.snap()));
check('glide ends by landing or grabbing a wall', s.state === 'ground' || s.state === 'climb', s.state);

// 7. Fall damage: drop from 20 m without the glider (hurts, not lethal).
await run(() => window.place(0, 20, 0, 20));
s = await run(() => (window.game.step(200), window.snap()));
check('20 m fall hurts but is survivable', s.hp < 100 && s.hp > 0 && s.state === 'ground', `hp=${s.hp} state=${s.state}`);

// 8. Running out of stamina while climbing makes you let go.
await run(() => {
  window.place(-22, 34, 0);
  window.until({ moveY: 1 }, (p) => p.state === 'climb', 120);
  window.game.step(30, { moveY: 1 });
  window.game.player.stamina = 3;
});
s = await run(() => (window.game.step(60, { moveY: 1 }), window.snap()));
check('empty stamina = let go', s.state !== 'climb', `state=${s.state}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// Real-time look for a screenshot: free-running loop.
if (shotsDir) {
  await run(() => {
    window.place(0, 12, 0.6);
    window.game.cam.pitch = 0.35;
    window.game.step(5);
  });
  await shot('05-overview');
}

await browser.close();
server.kill();
spawn('pkill', ['-f', `vite preview --port ${PORT}`]);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
