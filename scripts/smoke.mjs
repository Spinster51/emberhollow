// Movement + combat smoke test: drives the game in headless Chromium through window.game.step().
// Usage: npm run build && node scripts/smoke.mjs [--shots dir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const PORT = 4179;

// Vite's CLI runs straight under node (no npx/shell), so this works on Windows too and kill() stops it.
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', () => reject(new Error('preview server exited')));
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
// The fallback checks below ask for model files that do not exist on purpose (a player body and an
// enemy body); Chromium logs those 404s. Only that exact message for those exact files is ignored.
const MISSING_MODEL = 'models/chars/missing-test.glb';
const MISSING_ENEMY = 'models/enemies/missing-test.glb';
const MISSING_ITEM = 'models/items/missing-test.glb';
const MISSING_FURNITURE = 'models/home/missing-test.glb';
const MISSING_NPC = 'models/npcs/missing-test.glb';
const MISSING_WORLD = 'models/world/missing-test.glb';
const MISSING = [MISSING_MODEL, MISSING_ENEMY, MISSING_ITEM, MISSING_FURNITURE, MISSING_NPC, MISSING_WORLD];
const expectedError = (m) =>
  m.text().startsWith('Failed to load resource') && MISSING.some((f) => (m.location().url ?? '').endsWith(`/${f}`));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !expectedError(m) && errors.push(m.text()));
// vite preview answers unknown paths with index.html (200); a real host (GitHub Pages) sends a 404.
for (const f of MISSING) await page.route(`**/${f}`, (r) => r.fulfill({ status: 404, body: 'not found' }));
await page.goto(`http://localhost:${PORT}/?test`);
await page.waitForFunction(() => window.game && window.art);

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
  // Movement checks run with every enemy frozen in its camp.
  for (const e of window.game.enemies.list) e.frozen = true;
  window.snap = () => {
    const p = window.game.player;
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, state: p.state, stamina: p.stamina, hp: p.hp, vy: p.vel.y };
  };
  // Models load asynchronously: draw a frame (it asks for the current class's files), wait until
  // every requested file has loaded or failed, then draw again (the rig is swapped in on a frame).
  window.settleModels = async () => {
    window.game.step(0, null, true);
    await window.art.modelsSettled();
    window.game.step(0, null, true);
  };
});

// Colliders, before anything moves (world models, milestone 8: the same boxes as before the art pass).
await run(() => {
  window.colliderHash = () => {
    const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    const key = (b) => [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join(',') + (b.noClimb ? 'n' : '') + (b.zone ?? '');
    const boxes = window.game.world.boxes.map(key).sort();
    return `${boxes.length}/${fnv(boxes.join('|'))}`;
  };
});
const testColliders = await run(() => window.colliderHash());

// 0. Art (milestone 8): the warrior shows its rigged KayKit body (barbarian) once the files load.
let art = await run(async () => {
  await window.settleModels();
  const m = window.game.model;
  return {
    rig: m.usingRig, cls: m.rigClass, body: !!m.rig?.node('Barbarian_Body'), blocky: m.blocky.visible,
    clips: m.rig?.has('Idle') && m.rig?.has('1H_Melee_Attack_Chop') && m.rig?.has('Dodge_Forward'),
    sword: !!m.sword.parent && m.sword.parent === m.rig?.node('handslot.r'), swordItem: m.sword.children.length, clip: m.rig?.clip,
    // The pack's own hand props (axes, mug, shield) are hidden; only our gear shows.
    packProps: ['1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Round_Shield'].filter((n) => m.rig?.node(n)?.visible).join(),
  };
});
check('warrior shows the rigged character, not the placeholder', art.rig === true && art.cls === 'warrior' && art.body && !art.blocky && art.clips, JSON.stringify(art));
check('the equipped sword sits in the rig\'s right hand slot; the pack\'s own props are hidden', art.sword && art.swordItem === 1 && art.packProps === '', JSON.stringify(art));

// World models on the test map (milestone 8): the tower, wall and block become dressed stone, the crates crates;
// the colliders are the boxes they always were (count and hash taken before the models loaded).
const wTest = await run(async () => {
  const g = window.game;
  await g.scenery.loaded;
  await window.art.modelsSettled();
  const w = g.world;
  return {
    ready: g.scenery.ready, blocks: g.scenery.stats.blocks, hidden: w.blocks.every((b) => !b.mesh.visible && (!b.cap || !b.cap.visible)),
    group: g.scenery.group.children.map((c) => c.name).filter((n) => n.startsWith('scenery:')).join(), colliders: window.colliderHash(),
    trees: w.treeMeshes.every((m) => !m.visible) && g.scenery.vegetation.meshes().some((m) => m.node.startsWith('TreeMeadow')),
  };
});
check('world models (test map): the tower, wall, block and crates are dressed stone and crates; colliders unchanged (19 boxes, same hash)',
  wTest.ready && wTest.blocks === 5 && wTest.hidden && wTest.group.includes('scenery:blocks') && wTest.trees && wTest.colliders === testColliders && testColliders === '19/33a51860', JSON.stringify({ ...wTest, testColliders }));

// A model file that fails to load keeps the blocky placeholder and throws nothing.
art = await run(async (miss) => {
  const A = window.art;
  const g = window.game;
  const m = new A.PlayerModel({ warrior: miss, tank: miss, mage: miss, assassin: miss }, A.HUMANOID.clips);
  let threw = '';
  try {
    m.update(g.player, 1 / 60);
    await A.modelsSettled();
    for (let i = 0; i < 3; i++) m.update(g.player, 1 / 60);
  } catch (e) {
    threw = String(e);
  }
  return { rig: m.usingRig, state: A.modelState(miss), blocky: m.blocky.visible, sword: m.sword.children.length, threw };
}, MISSING_MODEL);
check('a missing model file keeps the placeholder without throwing', art.rig === false && art.state === 'failed' && art.blocky && art.sword === 1 && !art.threw, JSON.stringify(art));

// Enemies (milestone 8): the test map's bandits show their rig; one whose body file 404s keeps the
// blocky model, and its procedural poses still move (wind-up raises the sword arm).
art = await run(async (miss) => {
  const A = window.art;
  const g = window.game;
  const e = g.enemies.list.find((x) => x.kind === 'bandit');
  const real = g.enemies.models.find((x) => x.enemy === e);
  const m = new A.EnemyModel(e, { ...A.ENEMY_ART.bandit, body: miss });
  // The goblin's art (recoloured texture, ears) and the new boar body, both missing, fall back the same way.
  const boarE = g.enemies.list.find((x) => x.kind === 'boar');
  const others = [new A.EnemyModel(e, { ...A.ENEMY_ART.goblin, body: miss }), new A.EnemyModel(boarE, { ...A.ENEMY_ART.boar, body: miss })];
  let threw = '';
  const out = {};
  try {
    for (const x of [m, ...others]) x.update(1 / 60);
    await A.modelsSettled();
    for (let i = 0; i < 3; i++) for (const x of [m, ...others]) x.update(1 / 60);
    const before = m.parts.armR.rotation.x;
    e.state = 'windup';
    e.stateTime = 0.3;
    for (let i = 0; i < 10; i++) m.update(1 / 60);
    out.armMoved = +(m.parts.armR.rotation.x - before).toFixed(2);
    out.others = others.map((x) => (x.usingRig ? 'rig' : x.body.visible ? 'blocky' : 'hidden')).join();
    out.boarLegs = !!others[1].parts.leg0;
    e.reset();
  } catch (err) {
    threw = String(err);
  }
  return { ...out, rig: m.usingRig, state: A.modelState(miss), blocky: m.body.visible, realRig: real.usingRig, threw };
}, MISSING_ENEMY);
check('enemies: the bandit shows its rig; a missing enemy model keeps the blocky one, still posed, without throwing', art.realRig && !art.rig && art.state === 'failed' && art.blocky && art.armMoved < -0.5 && !art.threw, JSON.stringify(art));
check('enemies: a missing goblin or boar model falls back to the blocky placeholder too', art.others === 'blocky,blocky' && art.boarLegs && !art.threw, JSON.stringify(art));

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
// The climb pose is hand-made on a frozen clip; redrawing the same moment must not move any bone
// (the mixer skips unchanged values, so un-reset hand turns used to pile up and spin the head).
art = await run(() => {
  const g = window.game;
  const r = g.model.rig;
  const bones = ['head', 'upperarm.l', 'lowerarm.r', 'upperleg.l'].map((n) => r.node(n));
  g.player.climbMove.set(0, 0); // holding still on the wall (moving plays the reach cycle)
  for (let i = 0; i < 15; i++) g.step(0, null, true); // let the 0.1 s cross-fade into the pose finish
  const before = bones.map((b) => b.quaternion.clone());
  for (let i = 0; i < 20; i++) g.step(0, null, true);
  const drift = Math.max(...bones.map((b, i) => b.quaternion.angleTo(before[i])));
  // Arms are raised: both hands above the head bone.
  const y = (n) => r.node(n).getWorldPosition(g.player.pos.clone()).y;
  return { drift, handsUp: y('hand.l') > y('head') && y('hand.r') > y('head'), clip: r.clip };
});
check('climb pose: arms up the wall, steady from frame to frame', art.drift < 1e-4 && art.handsUp, JSON.stringify(art));
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

// ================================================================ combat (milestone 2)
await run(() => {
  // Arena: player at the spawn facing north (-z); one enemy of `kind` `dist` m ahead.
  window.arena = (kind, dist = 1.8, frozen = true, dx = 0) => {
    const g = window.game;
    g.step(1); // release any held buttons so the next press is a fresh one
    g.lockOn.target = null;
    g.hitStop = 0;
    window.homes ??= new Map(g.enemies.list.map((e) => [e, e.home.clone()]));
    for (const e of g.enemies.list) {
      e.home.copy(window.homes.get(e)); // undo earlier arenas
      e.reset();
      e.frozen = true;
    }
    window.place(0, 12, 0);
    const p = g.player;
    p.facing = 0;
    const e = g.enemies.list.find((x) => x.kind === kind);
    e.pos.set(dx, 0, 12 - dist);
    e.home.copy(e.pos);
    e.reset();
    e.facing = Math.PI; // facing the player
    e.frozen = frozen;
    return e;
  };
  window.press = (action, extra = {}) => window.game.step(1, { held: [action], ...extra });
  window.esnap = (e) => ({ hp: e.hp, state: e.state, alive: e.alive, x: e.pos.x, z: e.pos.z });
});

// 9. Attack: a sword strike hurts a slime in front, with hit-stop.
s = await run(() => {
  const e = window.arena('slime');
  window.press('attack');
  const p = window.game.player;
  const r = { state: p.state, stamina: p.stamina };
  window.until({}, () => window.game.hitStop > 0, 30);
  return { ...r, hitStop: window.game.hitStop, e: window.esnap(e) };
});
check('attack starts a strike and costs stamina', s.state === 'attack' && Math.abs(s.stamina - 94) < 0.5, `state=${s.state} stamina=${s.stamina.toFixed(1)}`);
check('strike hits slime for 12, with hit-stop', s.e.hp === 18 && s.hitStop > 0, `hp=${s.e.hp} hitStop=${s.hitStop}`);
check('poise break staggers the slime', s.e.state === 'stagger', s.e.state);

// 10. Combo: pressing during each swing chains all 3 strikes, skipping recoveries.
s = await run(() => {
  window.arena('bandit', 10); // out of reach: no hit-stop
  const p = window.game.player;
  const seen = [];
  window.press('attack');
  let frames = 1;
  for (let i = 0; i < 200 && p.state === 'attack'; i++) {
    const swing = p.attackPhase() === 'swing';
    window.game.step(1, swing ? { held: ['attack'] } : {});
    window.game.step(0); // release so the next swing gives a fresh press
    frames++;
    if (!seen.includes(p.comboIndex)) seen.push(p.comboIndex);
  }
  return { seen, frames };
});
check('combo chains 3 strikes', s.seen.join() === '0,1,2', s.seen.join());
check('chained combo skips recoveries (~1.47 s)', s.frames > 80 && s.frames < 95, `${s.frames} frames`);

// 11. Without a second press the recovery plays and the combo resets.
s = await run(() => {
  window.arena('bandit', 10);
  const p = window.game.player;
  window.press('attack');
  const n = window.until({}, () => p.state !== 'attack', 120);
  window.press('attack');
  return { n, idx: p.comboIndex, state: p.state };
});
check('single strike: recovery then back to idle', s.n > 30 && s.n < 45, `${s.n} frames`);
check('next press after recovery restarts the combo', s.idx === 0 && s.state === 'attack', `idx=${s.idx}`);

// 12. Input buffer: a press slightly before the swing still chains.
s = await run(() => {
  window.arena('bandit', 10);
  const p = window.game.player;
  window.press('attack');
  window.game.step(4); // windup is 9 frames; press at frame ~5
  window.press('attack');
  window.until({}, () => p.comboIndex === 1 || p.state !== 'attack', 60);
  return { idx: p.comboIndex, state: p.state };
});
check('early press is buffered into the combo', s.idx === 1 && s.state === 'attack', `idx=${s.idx} state=${s.state}`);

// 13. Dodge rules: not during the swing; allowed in recovery for extra stamina.
s = await run(() => {
  window.arena('bandit', 10);
  const p = window.game.player;
  window.press('attack');
  window.until({}, () => p.attackPhase() === 'swing', 30);
  window.press('dodge', { moveY: -1 });
  const duringSwing = p.state;
  window.until({}, () => p.attackPhase() === 'recover', 30);
  const before = p.stamina;
  window.game.step(1);
  window.press('dodge', { moveY: -1 });
  return { duringSwing, after: p.state, cost: before - p.stamina };
});
check('cannot roll during the swing', s.duringSwing === 'attack', s.duringSwing);
check('roll out of recovery costs extra stamina', s.after === 'roll' && Math.abs(s.cost - 25) < 1, `state=${s.after} cost=${s.cost.toFixed(1)}`);

// 14. Kill an enemy: it dies and the lock-on drops.
s = await run(() => {
  const e = window.arena('slime');
  const g = window.game;
  g.lockOn.toggle(g.player, g.enemies.list, g.cam.yaw);
  const locked = g.lockOn.target === e;
  for (let i = 0; i < 12 && e.alive; i++) {
    window.press('attack');
    window.until({}, () => g.player.state !== 'attack', 120);
    window.game.step(5);
  }
  window.game.step(2);
  return { locked, e: window.esnap(e), target: g.lockOn.target ? g.lockOn.target.id : null };
});
check('lock-on picks the enemy in front', s.locked);
check('slime can be killed', !s.e.alive && s.e.hp === 0, `hp=${s.e.hp} state=${s.e.state}`);
check('lock-on releases a dead target', s.target === null, String(s.target));

// 15. Defence: roll i-frames, block, parry, stagger.
s = await run(() => {
  const g = window.game;
  const p = g.player;
  const from = (z) => ({ damage: 12, poise: 8, knockback: 3, from: p.pos.clone().setZ(p.pos.z + z) });
  const out = {};
  window.arena('bandit', 10);
  window.press('dodge', { moveY: 1 });
  window.game.step(3);
  out.roll = p.takeHit(from(-1.5));
  out.rollHp = p.hp;
  window.arena('bandit', 10);
  window.game.step(30, { held: ['block'] });
  out.block = p.takeHit(from(-1.5));
  out.blockHp = p.hp;
  window.arena('bandit', 10);
  window.game.step(30, { held: ['block'] });
  out.blockBehind = p.takeHit(from(1.5));
  out.blockBehindHp = p.hp;
  window.arena('bandit', 10);
  window.game.step(1, { held: ['block'] });
  window.game.step(5, { held: ['block'] });
  out.parry = p.takeHit(from(-1.5));
  out.parryHp = p.hp;
  window.arena('bandit', 10);
  p.takeHit({ damage: 5, poise: 30, knockback: 6, from: p.pos.clone().setZ(p.pos.z - 1) });
  out.stagger = p.state + '/' + p.staggerKind;
  window.game.step(100);
  out.recovered = p.state;
  return out;
});
check('roll i-frames dodge a hit', s.roll === 'dodged' && s.rollHp === 100, `${s.roll} hp=${s.rollHp}`);
check('block from the front cuts damage 12 -> 7', s.block === 'blocked' && s.blockHp === 93, `${s.block} hp=${s.blockHp}`);
check('block does not cover the back', s.blockBehind === 'hit' && s.blockBehindHp === 88, `${s.blockBehind} hp=${s.blockBehindHp}`);
check('early block parries (no damage)', s.parry === 'parried' && s.parryHp === 100, `${s.parry} hp=${s.parryHp}`);
check('poise break knocks the player down, then recovers', s.stagger === 'stagger/knockdown' && s.recovered === 'ground', `${s.stagger} -> ${s.recovered}`);

// 16. Enemy AI: each kind closes in and hurts the player.
for (const [kind, dist, secs] of [['slime', 7, 6], ['boar', 9, 6], ['bandit', 8, 6]]) {
  s = await run(([kind, dist, secs]) => {
    const e = window.arena(kind, dist, false);
    const p = window.game.player;
    const n = window.until({}, () => p.hp < 100, 60 * secs);
    return { n, hp: p.hp, e: window.esnap(e) };
  }, [kind, dist, secs]);
  check(`${kind} chases and hits the player`, s.n > 0, `after ${(s.n / 60).toFixed(1)} s, hp=${s.hp}`);
}

// 17. Lock-on camera and strafing.
s = await run(() => {
  const g = window.game;
  const p = g.player;
  const e = window.arena('bandit', 6, true, 0);
  e.pos.set(6, g.world.groundAt(6, 12, 1e9), 12); // to the east
  g.cam.yaw = 0;
  g.lockOn.target = e;
  window.game.step(60);
  const fwd = { x: -Math.sin(g.cam.yaw), z: -Math.cos(g.cam.yaw) };
  const camDot = fwd.x; // east = +x
  window.game.step(40, { moveX: 1 });
  const to = { x: e.pos.x - p.pos.x, z: e.pos.z - p.pos.z };
  const len = Math.hypot(to.x, to.z);
  const f = p.facingVector();
  return { camDot, faceDot: (f.x * to.x + f.z * to.z) / len, moved: Math.hypot(p.pos.x, p.pos.z - 12) };
});
check('locked camera turns to face the target', s.camDot > 0.95, s.camDot.toFixed(2));
check('locked player strafes while facing the target', s.faceDot > 0.9 && s.moved > 1, `dot=${s.faceDot.toFixed(2)} moved=${s.moved.toFixed(1)} m`);

s = await run(() => {
  const g = window.game;
  const a = window.arena('slime', 5, true, -2);
  const b = g.enemies.list.filter((x) => x.kind === 'slime')[1];
  b.pos.set(3, g.world.groundAt(3, 7, 1e9), 7);
  g.lockOn.target = a;
  g.lockOn.flick(200, g.player, g.enemies.list);
  const t = g.lockOn.target;
  return { ok: t === b, t: t && `${t.kind}#${t.id} (${t.pos.x.toFixed(1)}, ${t.pos.z.toFixed(1)}) alive=${t.alive}`, a: `${a.id} (${a.pos.x.toFixed(1)}, ${a.pos.z.toFixed(1)})`, b: `${b.id} (${b.pos.x.toFixed(1)}, ${b.pos.z.toFixed(1)})` };
});
check('flicking right switches to the target on the right', s.ok, `target=${s.t} a=${s.a} b=${s.b}`);

// 18. Player death and respawn.
s = await run(() => {
  const g = window.game;
  const p = g.player;
  window.arena('bandit', 10);
  p.pos.x += 3;
  p.hp = 5;
  p.takeHit({ damage: 10, poise: 0, knockback: 0, from: p.pos.clone() });
  const dead = p.state;
  window.game.step(170);
  return { dead, state: p.state, hp: p.hp, dx: p.pos.x - g.world.spawn.x, dz: p.pos.z - g.world.spawn.z, deaths: p.deaths };
});
check('player dies at 0 HP', s.dead === 'dead', s.dead);
check('player respawns at the campfire with full HP', s.state === 'ground' && s.hp === 100 && Math.hypot(s.dx, s.dz) < 0.5, `state=${s.state} hp=${s.hp}`);

// 19. Dead enemies respawn after a while once the player is far away.
s = await run(() => {
  const g = window.game;
  const e = window.arena('slime');
  e.takeHit({ damage: 999, poise: 0, knockback: 0, from: g.player.pos.clone() }, []);
  const dead = !e.alive;
  window.place(60, 60, 0);
  for (const x of g.enemies.list) x.frozen = true;
  window.game.step(60 * 61);
  return { dead, alive: e.alive, hp: e.hp };
});
check('enemy respawns at its camp after 60 s', s.dead && s.alive && s.hp === 30, `alive=${s.alive} hp=${s.hp}`);

// ================================================================ loot and home base (milestone 3)
await page.waitForFunction(() => window.items);
await run(() => {
  // Fresh character at the spawn with an empty bag; all enemies frozen at their camps.
  window.fresh = () => {
    const g = window.game;
    window.arena('bandit', 30);
    const inv = g.player.inv;
    inv.bag.fill(null);
    for (const k of Object.keys(inv.equipped)) inv.equipped[k] = null;
    inv.equipped.weapon = window.items.makeItem('rustySword');
    inv.gold = 0;
    inv.changed();
    for (const d of [...g.loot.drops]) g.loot.remove(d);
    g.ui.close();
    g.step(1);
    return g;
  };
});

// 20. Item generation: rarity odds, affix counts, legendary uniques.
s = await run(() => {
  const I = window.items;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  let affixOk = true;
  let uniqueOk = true;
  for (let i = 0; i < 4000; i++) {
    const it = I.rollItem(rand, 2);
    counts[it.rarity]++;
    if (it.affixes.length !== I.RARITY_INFO[it.rarity].affixes - (it.rarity === 'legendary' ? 1 : 0)) affixOk = false;
    if ((it.rarity === 'legendary') !== !!it.unique) uniqueOk = false;
  }
  return { counts, affixOk, uniqueOk };
});
check('rarity odds ~60/25/10/4/1 %', Math.abs(s.counts.common / 4000 - 0.6) < 0.04 && s.counts.legendary > 15 && s.counts.legendary < 80, JSON.stringify(s.counts));
check('affix count matches rarity; legendaries are uniques', s.affixOk && s.uniqueOk);

// 21. Kills drop loot: gold flies to you, gear shows a beam.
s = await run(() => {
  const g = window.fresh();
  const p = g.player;
  const e = window.arena('bandit', 1.5);
  let gear = 0;
  let beams = 0;
  for (let i = 0; i < 12; i++) {
    e.reset();
    e.pos.set(0, g.world.groundAt(0, 10.5, 1e9), 10.5);
    e.takeHit({ damage: 999, poise: 0, knockback: 0, from: p.pos.clone() }, []);
    g.step(2);
    gear += g.loot.drops.filter((d) => d.kind === 'item').length;
    beams += g.loot.drops.filter((d) => d.beam).length;
    for (const d of g.loot.drops.filter((d) => d.kind === 'item')) g.loot.remove(d);
    p.pos.set(0, g.world.groundAt(0, 10.5, 1e9), 10.5); // stand where it died
    g.step(90);
  }
  return { gold: p.inv.gold, gear, beams, mats: p.inv.materials.cloth ?? 0, left: g.loot.drops.length };
});
check('kills drop gold that is collected by walking over it', s.gold >= 12 * 6 && s.left === 0, `gold=${s.gold} left=${s.left}`);
check('bandits drop cloth and some gear (with beams)', s.mats > 3 && s.gear >= 2 && s.beams === s.gear, `cloth=${s.mats} gear=${s.gear} beams=${s.beams}`);

// 22. Pick up gear with E; a full bag refuses.
s = await run(() => {
  const g = window.fresh();
  const p = g.player;
  const sword = window.items.makeItem('ironSword', 'rare', 1, [{ stat: 'crit', value: 0.04 }]);
  g.loot.dropItem(sword, p.pos.clone().setZ(p.pos.z - 1));
  g.step(60);
  const label = g.focus?.label;
  window.press('interact');
  const picked = p.inv.bag.includes(sword) && g.loot.drops.length === 0;
  for (let i = 0; i < 40; i++) p.inv.bag[i] ??= window.items.makeItem('cap');
  const extra = window.items.makeItem('helm');
  g.loot.dropItem(extra, p.pos.clone());
  g.step(60);
  g.step(1);
  window.press('interact');
  return { label, picked, refused: g.loot.drops.length === 1 && !p.inv.bag.includes(extra) };
});
check('E picks up gear into the bag', s.picked && /Pick up Deadly Iron Sword/.test(s.label ?? ''), s.label);
check('a full bag leaves the item on the ground', s.refused);

// 23. Equipping changes stats: weapon damage, armour, level requirement, visible gear.
s = await run(() => {
  const g = window.fresh();
  const p = g.player;
  const I = window.items;
  p.inv.add(I.makeItem('ironSword'));
  p.inv.add(I.makeItem('mail'));
  p.inv.add(I.makeItem('helm'));
  p.inv.add(I.makeItem('ironShield'));
  const req = I.makeItem('greatsword');
  req.req = 5;
  p.inv.add(req);
  for (const base of ['ironSword', 'mail', 'helm', 'ironShield']) p.inv.equip(p.inv.bag.findIndex((x) => x?.base === base), p.level);
  const err = p.inv.equip(p.inv.bag.indexOf(req), p.level);
  g.step(1, null, true);
  const out = {
    err,
    dmg: p.stats.weaponDamage,
    armour: p.stats.armour,
    block: p.stats.blockStrength,
    move: p.stats.moveSpeed,
    helmet: g.model.headGear.children.length,
    shield: g.model.shield.children.length,
    hair: g.model.hair.visible,
  };
  // Strike a slime with the iron sword: 14 damage.
  const e = window.arena('slime');
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.hit = 30 - e.hp;
  // Armour: a 12-damage hit on 22 armour (mail 10 + helm 6 + shield 6) → 12 × (1 − 22/82) ≈ 9.
  out.taken = (() => { const before = p.hp; p.takeHit({ damage: 12, poise: 0, knockback: 0, from: p.pos.clone().setX(p.pos.x + 3) }); return before - p.hp; })();
  return out;
});
check('equipping a level-5 item at level 1 is refused', s.err === 'Requires level 5.', s.err);
check('iron sword: 14 damage per first strike', s.dmg === 14 && s.hit === 14, `stat=${s.dmg} hit=${s.hit}`);
check('armour and shield stats apply', s.armour === 22 && s.block === 0.6 && Math.abs(s.move - 0.97) < 1e-6 && s.taken === 9, `armour=${s.armour} block=${s.block} move=${s.move} taken=${s.taken}`);
check('helmet and shield show on the character', s.helmet === 1 && s.shield === 1 && !s.hair, `helmet=${s.helmet} shield=${s.shield} hair=${s.hair}`);

// 23b. On the rig, a helm wears the pack's own knight helmet on the head bone (one mesh with its
// outline, and its own material with the rarity glow, so the knight body's shared one stays
// untinted); a cap wears the game's leather cap model there (milestone 8, items); the class's own
// hat hides under either. Both sit in a holder group that shows the procedural box until loaded.
s = await run(async () => {
  const g = window.game;
  const m = g.model;
  const A = window.art;
  const inv = g.player.inv;
  await A.modelsSettled();
  const wear = (item) => { inv.equipped.helmet = item; inv.changed(); g.step(1, null, true); return m.headGear.children; };
  const out = { rig: m.usingRig };
  let kids = wear(window.items.makeItem('helm', 'rare'));
  const helm = kids[0]?.getObjectByName(A.HUMANOID.helm);
  const orig = A.cloneNode(A.HUMANOID.clips, A.HUMANOID.helm);
  out.helm = kids.length === 1 && kids[0].userData.model === true && helm?.isMesh === true && !!helm.getObjectByName(`${A.HUMANOID.helm}_outline`);
  out.onHead = m.headGear.parent === m.rig?.node('head');
  out.ownGlow = helm?.material !== orig?.material && !!helm?.material.map && helm.material.map === orig?.material.map
    && helm.material.emissive.getHex() !== 0 && orig?.material.emissive.getHex() === 0;
  out.hatHidden = m.rig?.node('Barbarian_Hat')?.visible === false;
  kids = wear(window.items.makeItem('cap'));
  let boxes = 0;
  m.headGear.traverse((o) => { if (o.geometry?.type === 'BoxGeometry') boxes++; });
  out.cap = kids.length === 1 && kids[0].userData.model === true && !!m.headGear.getObjectByName(A.HEAD_ART.cap.node)
    && !m.headGear.getObjectByName(A.HUMANOID.helm) && boxes === 0;
  kids = wear(null);
  out.bare = kids.length === 0 && m.rig?.node('Barbarian_Hat')?.visible === true;
  return out;
});
check('on the rig a helm wears the pack\'s knight helmet (own glowing material), a cap the leather cap model', Object.values(s).every(Boolean), JSON.stringify(s));

// 23c. The mage's staff sits in the rig's right hand slot and stands up beside the body in Idle,
// clear of the big head (a spare model with a mage stand-in, so the game's own class stays).
s = await run(async () => {
  const A = window.art;
  const g = window.game;
  const V = g.player.pos.constructor;
  const inv = { version: 1, equipped: { weapon: window.items.makeItem('oakStaff'), offhand: null, helmet: null, chest: null } };
  const p = Object.create(g.player, {
    cls: { value: 'mage' }, inv: { value: inv }, prog: { value: { version: 0 } },
    state: { value: 'ground' }, vel: { value: new V() }, blocking: { value: false }, stealthTime: { value: 0 },
  });
  const m = new A.PlayerModel();
  m.update(p, 1 / 60);
  await A.modelsSettled();
  for (let i = 0; i < 30; i++) m.update(p, 1 / 60);
  m.root.updateMatrixWorld(true);
  const staff = m.sword.children[0];
  const head = m.rig?.node('head');
  // Points along the staff (foot +0.4 m, gem -1.44 m along its -Z) against an ellipsoid round the head (head-bone space, rig units): > 1 = outside.
  let clear = 99;
  for (let z = 0.4; z >= -1.44; z -= 0.05) {
    const l = head.worldToLocal(new V(0, 0, z).applyMatrix4(staff.matrixWorld));
    clear = Math.min(clear, (l.x / 0.56) ** 2 + ((l.y - 0.45) / 0.58) ** 2 + ((l.z - 0.02) / 0.53) ** 2);
  }
  const up = new V(0, 0, -1).transformDirection(staff.matrixWorld).y;
  const out = { rig: m.usingRig, cls: m.rigClass, clip: m.rig?.clip, inHand: m.sword.parent === m.rig?.node('handslot.r'), up: +up.toFixed(2), clear: +clear.toFixed(2) };
  m.rig?.dispose();
  return out;
});
check('the mage\'s staff is in the rig\'s right hand, upright beside the body and clear of the head in Idle',
  s.rig && s.cls === 'mage' && s.clip === 'Idle' && s.inHand && s.up > 0.75 && s.clear > 1.5, JSON.stringify(s));

// 23d. Off-hand items rest their own way on the rig's left hand slot (spare models with stand-ins,
// as in 23c): the tome in the fist at its spine, front cover out, clear of the body and arm in Idle;
// the parrying dagger at the grip with its blade along the slot's +Y (as the second dagger); and a
// shield swapped for a tome while the guard is up leaves the tome at its own rest.
s = await run(async () => {
  const A = window.art;
  const g = window.game;
  const I = window.items;
  const V = g.player.pos.constructor;
  const stand = (cls, weapon, offhand) => Object.create(g.player, {
    cls: { value: cls }, prog: { value: { version: 0 } }, state: { value: 'ground' }, vel: { value: new V() }, stealthTime: { value: 0 },
    inv: { value: { version: 1, equipped: { weapon: I.makeItem(weapon), offhand: I.makeItem(offhand), helmet: null, chest: null } } },
    blocking: { value: false, writable: true }, blockTime: { value: 0, writable: true },
  });
  const settle = async (p) => {
    const m = new A.PlayerModel();
    m.update(p, 1 / 60);
    await A.modelsSettled();
    for (let i = 0; i < 30; i++) m.update(p, 1 / 60);
    m.root.updateMatrixWorld(true);
    return m;
  };
  const out = {};
  // Tome (the book shown, measured in its item frame: the pack's spellbook since milestone 8, spine at
  // its -X): body/leg/head vertices inside it, and arm vertices inside it past the spine's first 8 cm
  // (the part in the fist); the gap from the slot's grip point to the book; its front cover (-Z) in rig
  // space (+X = the model's left).
  let m = await settle(stand('mage', 'oakStaff', 'tome'));
  const book = m.shield.children[0];
  const toBook = book.matrixWorld.clone().invert();
  const v = new V();
  const lo = new V(1e9, 1e9, 1e9);
  const hi = new V(-1e9, -1e9, -1e9);
  book.traverse((o) => {
    if (!o.isMesh || o.name.endsWith('_outline')) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(toBook);
      lo.min(v);
      hi.max(v);
    }
  });
  let body = 0;
  let arm = 0;
  m.rig.root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.visible || o.name.endsWith('_outline')) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      o.getVertexPosition(i, v);
      v.applyMatrix4(o.matrixWorld).applyMatrix4(toBook);
      if (v.x <= lo.x || v.x >= hi.x || v.y <= lo.y || v.y >= hi.y || v.z <= lo.z || v.z >= hi.z) continue;
      if (/Arm/.test(o.name)) arm += v.x > lo.x + 0.08 ? 1 : 0;
      else body++;
    }
  });
  const fist = m.rig.node('handslot.l').getWorldPosition(new V());
  const near = book.worldToLocal(fist.clone()).clamp(lo, hi);
  const gap = book.localToWorld(near).distanceTo(fist);
  const rigQ = m.rig.root.getWorldQuaternion(m.root.quaternion.clone()).invert();
  const cover = new V(0, 0, -1).transformDirection(book.matrixWorld).applyQuaternion(rigQ);
  out.tome = {
    rig: m.usingRig, clip: m.rig?.clip, inHand: m.shield.parent === m.rig?.node('handslot.l'), model: book.userData.model,
    size: [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z].map((x) => +x.toFixed(2)), gap: +gap.toFixed(2), coverOut: +cover.x.toFixed(2), body, arm,
  };
  const tomeRest = { q: m.shield.quaternion.clone(), p: m.shield.position.clone() };
  m.rig?.dispose();
  // Parrying dagger: grip at the slot, blade (-Z) along the slot's +Y; no second dagger beside it.
  m = await settle(stand('assassin', 'rustyDaggers', 'parryDagger'));
  const slot = m.rig.node('handslot.l');
  const knife = m.shield.children[0];
  const along = new V(0, 0, -1).transformDirection(knife.matrixWorld).dot(new V(0, 1, 0).transformDirection(slot.matrixWorld));
  const grip = knife.getWorldPosition(new V()).distanceTo(slot.getWorldPosition(new V()));
  out.dagger = { inHand: m.shield.parent === slot, along: +along.toFixed(3), grip: +grip.toFixed(3), second: m.offDagger.children.length };
  m.rig?.dispose();
  // A tank blocking with a shield (guard fully up), then a tome in its place.
  const tank = stand('tank', 'rustyMace', 'ironShield');
  tank.blocking = true;
  tank.blockTime = 1;
  m = await settle(tank);
  const guardUp = m.guard === 1 && m.rig?.clip === 'Blocking';
  tank.inv.equipped.offhand = I.makeItem('tome');
  tank.inv.version++;
  m.update(tank, 1 / 60);
  out.swap = { guardUp, turn: +m.shield.quaternion.angleTo(tomeRest.q).toFixed(4), moved: +m.shield.position.distanceTo(tomeRest.p).toFixed(4) };
  m.rig?.dispose();
  return out;
});
check('on the rig the mage\'s tome is held in the left fist at its spine, cover out, clear of the body and arm in Idle',
  s.tome.rig && s.tome.model && s.tome.clip === 'Idle' && s.tome.inHand && s.tome.gap < 0.1 && s.tome.coverOut > 0.8 && s.tome.body === 0 && s.tome.arm === 0, JSON.stringify(s.tome));
check('on the rig the parrying dagger is held like the second dagger (grip at the left slot, blade along its +Y)',
  s.dagger.inHand && s.dagger.along > 0.99 && s.dagger.grip < 0.01 && s.dagger.second === 0, JSON.stringify(s.dagger));
check('a shield swapped for a tome mid-guard leaves the tome at its own rest on the left slot',
  s.swap.guardUp && s.swap.turn < 1e-3 && s.swap.moved < 1e-4, JSON.stringify(s.swap));

// 23e. Item models (milestone 8): every base and legendary shows its glTF model once the files load,
// copies share geometry and materials, a missing file keeps the procedural mesh, the rarity glow
// is on the model, the procedural tome's pages sit inside its cover.
s = await run(async (miss) => {
  const A = window.art;
  const I = window.items;
  await A.modelsSettled();
  const out = { wrong: [], looks: [] };
  const items = [...I.BASES.map((b) => I.makeItem(b.id)), ...I.UNIQUES.map((u) => I.makeItem(u.base, 'legendary', 1, [], u.id))];
  const looks = new Set();
  for (const it of items) {
    const art = A.itemArt(it);
    const g = A.buildItemMesh(it);
    const shown = g.children[0];
    if (!(g.userData.model === true && shown?.name === `item:${art.node}` && shown.getObjectByName(art.node))) out.wrong.push(it.base + (it.unique ? `/${it.unique}` : ''));
    else looks.add(I.BASE_BY_ID[it.base].look);
  }
  out.looks = looks.size;
  // Two copies (loot on the ground, a rack) share the file's geometry; same rarity, same material.
  const mesh = (g) => { let m = null; g.traverse((o) => { if (!m && o.isMesh && !o.name.endsWith('_outline')) m = o; }); return m; };
  const r1 = mesh(A.buildItemMesh(I.makeItem('ironSword', 'rare')));
  const r2 = mesh(A.buildItemMesh(I.makeItem('ironSword', 'rare')));
  const c1 = mesh(A.buildItemMesh(I.makeItem('ironSword')));
  const file = mesh(A.cloneNode(A.ITEM_FILE, 'Sword_Iron'));
  out.shared = r1.geometry === r2.geometry && r1.geometry === c1.geometry && r1.material === r2.material && c1.material === file.material;
  // Rarity glow: rare glows blue, common does not; a unique with its own glow uses it.
  out.glow = { rare: r1.material.emissive.getHexString(), rareI: +r1.material.emissiveIntensity.toFixed(3), common: c1.material.emissive.getHex() };
  const ember = mesh(A.buildItemMesh(I.makeItem('ironMace', 'legendary', 1, [], 'emberMaul')));
  out.glow.unique = ember.material.emissive.getHexString();
  out.glow.map = r1.material.map === file.material.map;
  // A missing file: the procedural mesh stays, nothing throws.
  let threw = '';
  let missing = null;
  try {
    const it = I.makeItem('ironSword', 'epic');
    missing = A.buildItemMesh(it, { ...A.itemArt(it), file: miss });
    await A.modelsSettled();
  } catch (e) {
    threw = String(e);
  }
  out.missing = { model: missing?.userData.model, shown: missing?.children[0]?.name, state: A.modelState(miss), threw };
  // Procedural tome (shown while loading): the pages block lies inside the covers on every axis and
  // is no thicker than the gap between them, so no cream shows through either cover.
  const tome = A.buildProceduralItem(I.makeItem('tome'));
  tome.updateMatrixWorld(true);
  const box = (o) => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); };
  const covers = tome.children.filter((o) => o.name === 'tome_cover').map(box);
  const pages = box(tome.children.find((o) => o.name === 'tome_pages'));
  const all = covers.reduce((a, b) => a.union(b), covers[0].clone());
  const plates = covers.filter((b) => b.max.x - b.min.x > 0.2).sort((a, b) => a.min.z - b.min.z);
  out.tome = {
    inside: all.containsBox(pages),
    between: pages.min.z >= plates[0].max.z - 1e-6 && pages.max.z <= plates[1].min.z + 1e-6,
    pages: +(pages.max.z - pages.min.z).toFixed(3), gap: +(plates[1].min.z - plates[0].max.z).toFixed(3),
  };
  return out;
}, MISSING_ITEM);
check('items: every base and legendary shows its own model (all 19 looks), copies share geometry and materials',
  s.wrong.length === 0 && s.looks === 19 && s.shared, JSON.stringify({ wrong: s.wrong, looks: s.looks, shared: s.shared }));
check('items: a missing model file keeps the procedural mesh without throwing',
  s.missing.model === false && s.missing.shown === 'item:procedural' && s.missing.state === 'failed' && !s.missing.threw, JSON.stringify(s.missing));
check('items: the rarity glow is on the model (rare blue, common none, a legendary unique its own colour)',
  s.glow.rare === '4f9dff' && s.glow.rareI > 0 && s.glow.common === 0 && s.glow.unique !== '000000' && s.glow.unique !== 'ff9a2e' && s.glow.map, JSON.stringify(s.glow));
check('items: the procedural tome\'s pages sit inside its cover', s.tome.inside && s.tome.between && s.tome.pages <= s.tome.gap, JSON.stringify(s.tome));

// 23f. Held items on each class's rig: weapons in the right hand slot, off-hands (and the assassin's second
// dagger) in the left, each showing its model with its grip at the slot; a cap shows the leather cap model
// on the head bone (refitted over the rogue's hood like the helm).
s = await run(async () => {
  const A = window.art;
  const g = window.game;
  const I = window.items;
  const V = g.player.pos.constructor;
  const stand = (cls, weapon, offhand) => Object.create(g.player, {
    cls: { value: cls }, prog: { value: { version: 0 } }, state: { value: 'ground' }, vel: { value: new V() }, stealthTime: { value: 0 },
    inv: { value: { version: 1, equipped: { weapon: I.makeItem(weapon), offhand: offhand ? I.makeItem(offhand) : null, helmet: I.makeItem('cap'), chest: null } } },
    blocking: { value: false, writable: true }, blockTime: { value: 0, writable: true },
  });
  const out = {};
  for (const [cls, weapon, offhand] of [['warrior', 'ironSword', 'woodShield'], ['tank', 'rustyMace', 'ironShield'], ['mage', 'oakStaff', 'tome'], ['assassin', 'steelDaggers', 'parryDagger'], ['assassin', 'rustyDaggers', null]]) {
    const m = new A.PlayerModel();
    const p = stand(cls, weapon, offhand);
    m.update(p, 1 / 60);
    await A.modelsSettled();
    for (let i = 0; i < 5; i++) m.update(p, 1 / 60);
    m.root.updateMatrixWorld(true);
    const R = m.rig?.node('handslot.r');
    const L = m.rig?.node('handslot.l');
    const held = (holder, slot) => holder.parent === slot && holder.children.length === 1 && holder.children[0].userData.model === true;
    const at = (holder, slot) => +holder.children[0].getWorldPosition(new V()).distanceTo(slot.getWorldPosition(new V())).toFixed(3);
    const key = `${cls}:${weapon}`;
    const cap = m.headGear.children[0];
    const capNode = cap?.getObjectByName(A.HEAD_ART.cap.node);
    out[key] = {
      rig: m.usingRig, weapon: held(m.sword, R), weaponAt: at(m.sword, R),
      off: offhand ? held(m.shield, L) : held(m.offDagger, L), offAt: offhand ? null : at(m.offDagger, L),
      cap: m.headGear.parent === m.rig?.node('head') && cap?.userData.model === true && !!capNode, capScale: +(capNode?.scale.x ?? 0).toFixed(2),
    };
    m.rig?.dispose();
  }
  return out;
});
check('items: each class holds its weapon in the right hand slot and its off-hand (or second dagger) in the left, as models',
  Object.values(s).every((v) => v.rig && v.weapon && v.weaponAt < 0.01 && v.off && (v.offAt === null || v.offAt < 0.01)), JSON.stringify(s));
check('items: a cap shows the leather cap model on the head bone of every class (larger over the rogue\'s hood)',
  Object.values(s).every((v) => v.cap) && s['assassin:steelDaggers'].capScale > s['warrior:ironSword'].capScale, JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [v.cap, v.capScale]]))));

// 24. Legendary effects.
s = await run(() => {
  const g = window.fresh();
  const p = g.player;
  const I = window.items;
  const out = {};
  p.inv.equipped.boots = I.makeItem('boots', 'legendary', 1, [], 'driftstep');
  p.inv.changed();
  g.step(1);
  window.press('dodge', { moveY: 1 });
  out.rollCost = 100 - p.stamina;
  window.fresh();
  p.inv.equipped.ring = I.makeItem('copperRing', 'legendary', 1, [], 'thirstBand');
  p.inv.equipped.weapon = I.makeItem('ironSword', 'legendary', 1, [], 'emberfang');
  p.inv.changed();
  g.step(1);
  p.hp = 50;
  const e = window.arena('bandit', 1.8);
  p.hp = 50;
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.healed = p.hp - 50;
  const afterHit = e.hp;
  g.hitStop = 0;
  g.step(130);
  out.burned = afterHit - e.hp;
  window.fresh();
  p.inv.equipped.amulet = I.makeItem('boneCharm', 'legendary', 1, [], 'heartstone');
  p.inv.changed();
  g.step(1);
  p.hp = 50;
  g.step(60);
  out.regen = p.hp - 50;
  return out;
});
check('Driftstep Boots: free dodge-rolls', s.rollCost === 0, `cost=${s.rollCost}`);
check('Band of Thirst heals 8% of damage dealt', s.healed > 0.9 && s.healed < 1.5, `healed=${s.healed.toFixed(2)}`);
check('Emberfang burns for 4/s', s.burned === 8, `burn=${s.burned}`);
check('Heartstone regenerates 2 HP/s', Math.abs(s.regen - 2) < 0.05, `regen=${s.regen.toFixed(2)}`);

// 25. Inventory screen and tooltips.
s = await run(() => {
  const g = window.fresh();
  const I = window.items;
  const it = I.makeItem('ironSword', 'epic', 2, [{ stat: 'str', value: 3 }, { stat: 'hp', value: 12 }, { stat: 'crit', value: 0.03 }]);
  g.player.inv.add(it);
  g.ui.open({ kind: 'bag' });
  g.step(1, null, true);
  const cells = document.querySelectorAll('.inv .inv-cell').length;
  const menu = g.menuOpen;
  const tip = window.items.tooltipHtml(it, g.player.inv.equipped.weapon, 1);
  g.ui.close();
  return { cells, menu, tip, closed: !g.menuOpen };
});
check('inventory screen shows 8 equipment + 40 bag slots', s.cells === 48 && s.menu && s.closed, `cells=${s.cells}`);
check('tooltip compares with the equipped item', /↑ 3 damage/.test(s.tip) && /↑ 3 Strength/.test(s.tip) && /Compared with Rusty Sword/.test(s.tip), s.tip.replace(/<[^>]+>/g, ' ').slice(0, 160));

// 26. Home base: walk in through the door, use the chest and the display racks.
s = await run(() => {
  const g = window.fresh();
  const p = g.player;
  const h = g.home;
  const out = {};
  // Walk in from outside the door (door faces +z).
  p.pos.copy(h.door).setY(g.world.groundAt(h.door.x, h.door.z, 1e9));
  p.state = 'ground';
  g.cam.yaw = 0;
  window.until({ moveY: 1 }, () => p.pos.z < g.world.homeSite.z, 240);
  out.inside = p.pos.z < g.world.homeSite.z && Math.abs(p.pos.y - h.floorY) < 0.05 && p.state === 'ground';
  // Chest.
  p.pos.set(h.chestPos.x, h.floorY, h.chestPos.z + 1.1);
  g.step(1);
  out.chestLabel = g.focus?.label;
  window.press('interact');
  out.mode = g.ui.modeKind;
  const it = window.items.makeItem('gauntlets', 'uncommon', 1, [{ stat: 'vit', value: 2 }]);
  p.inv.add(it);
  const slot = p.inv.bag.indexOf(it);
  out.stored = g.ui.storeInChest(h.chest, slot) && h.chest.includes(it) && !p.inv.bag.includes(it);
  out.back = g.ui.takeFromChest(h.chest, h.chest.indexOf(it)) && p.inv.bag.includes(it);
  g.ui.close();
  // Display the iron sword on a weapon mount, and gauntlets on an armour stand.
  const sword = window.items.makeItem('ironSword', 'rare');
  p.inv.add(sword);
  const mount = h.spots.find((x) => x.kind === 'mount');
  const stand = h.spots.find((x) => x.kind === 'stand');
  p.pos.set(mount.pos.x, h.floorY, mount.pos.z + 0.9);
  g.step(1);
  out.mountLabel = g.focus?.label;
  out.wrongSlot = g.ui.display(mount, p.inv.bag.indexOf(it)); // gauntlets do not go on a weapon mount
  out.shown = g.ui.display(mount, p.inv.bag.indexOf(sword)) && mount.item === sword && mount.holder.children.length === 1 && !p.inv.bag.includes(sword);
  out.stand = g.ui.display(stand, p.inv.bag.indexOf(it)) && stand.holder.children.length === 1;
  out.taken = g.ui.takeFromDisplay(mount) && p.inv.bag.includes(sword) && mount.holder.children.length === 0;
  return out;
});
check('walk into the house through the door', s.inside);
check('E at the chest opens the storage chest', s.chestLabel === 'Open storage chest' && s.mode === 'chest', `${s.chestLabel} / ${s.mode}`);
check('items move between bag and chest', s.stored && s.back);
check('weapon mount shows a weapon; refuses gauntlets', s.shown && s.wrongSlot === false && /Weapon mount/.test(s.mountLabel ?? ''), s.mountLabel);
check('armour stand shows armour; items can be taken back', s.stand && s.taken);

// 26b. Furniture and home fixtures (milestone 8): every catalogue piece and fixture shows its model once the
// file loads (copies share geometry and materials), a missing file keeps the procedural piece, racks and mounts
// hold items at the same anchors, the chest collider and the prompts stay put, and an old save with placed
// furniture loads with the models.
s = await run(async (miss) => {
  const A = window.art;
  const g = window.game;
  const h = g.home;
  await A.modelsSettled();
  const out = { wrong: [] };
  const shows = (m, node) => m.userData.model === true && m.children[0]?.name === `furniture:${node}` && !!m.children[0].getObjectByName(node);
  for (const t of Object.keys(A.FURNITURE)) if (!shows(A.buildFurniture(t), A.FURNITURE_ART[t])) out.wrong.push(t);
  for (const k of Object.keys(A.FIXTURE_ART)) if (!shows(A.buildFixture(k), A.FIXTURE_ART[k])) out.wrong.push(k);
  out.pieces = Object.keys(A.FURNITURE).length + Object.keys(A.FIXTURE_ART).length;
  // The home's own 16 fixtures (8 kinds) show their models.
  out.home = h.fixtures.filter((f) => shows(f.group, A.FIXTURE_ART[f.kind])).length;
  out.homeN = h.fixtures.length;
  out.kinds = new Set(h.fixtures.map((f) => f.kind)).size;
  // Two copies share the file's geometry and material.
  const mesh = (g) => { let m = null; g.traverse((o) => { if (!m && o.isMesh && !o.name.endsWith('_outline')) m = o; }); return m; };
  const t1 = mesh(A.buildFurniture('table'));
  const t2 = mesh(A.buildFurniture('table'));
  const bed = mesh(A.buildFixture('bed'));
  out.shared = t1.geometry === t2.geometry && t1.material === t2.material && t1.material === bed.material;
  // The placement ghost shows the model, with its ring.
  g.adventure.startPlacing('lantern');
  const ghost = g.adventure.placing?.ghost;
  out.ghost = !!ghost && shows(ghost.children[0], 'Lantern') && ghost.children[1] === g.adventure.placing.ring;
  g.adventure.stopPlacing();
  // A missing file: the procedural piece stays, nothing throws.
  let threw = '';
  let mf = null;
  let mx = null;
  try {
    mf = A.buildFurniture('bookshelf', miss);
    mx = A.buildFixture('chest', miss);
    await A.modelsSettled();
  } catch (e) {
    threw = String(e);
  }
  out.missing = { piece: mf?.userData.model, fixture: mx?.userData.model, shown: [mf?.children[0]?.name, mx?.children[0]?.name].join(), state: A.modelState(miss), threw };
  // Anchors relative to the house centre on the floor: as the procedural home had them.
  const c = g.world.homeSite;
  const V = g.player.pos.constructor;
  const rel = (o) => { const w = o.getWorldPosition(new V()); return [w.x - c.x, w.y - h.floorY, w.z - c.z].map((v) => +v.toFixed(3)); };
  out.holders = h.spots.map((sp) => rel(sp.holder));
  out.spotPos = h.spots.map((sp) => [sp.pos.x - c.x, sp.pos.y - h.floorY, sp.pos.z - c.z].map((v) => +v.toFixed(3)));
  // Each mount and stand fixture stands where its spot is.
  out.racksAt = h.fixtures.filter((f) => f.kind === 'mount' || f.kind === 'stand').every((f) => h.spots.some((sp) => {
    const a = f.group.getWorldPosition(new V());
    return Math.hypot(a.x - sp.pos.x, a.z - sp.pos.z) < 0.06 && Math.abs(a.y - h.floorY) < 1e-6;
  }));
  // A displayed sword hangs at the same spot as before (holder + the mount's own hang offset).
  const mount = h.spots[0];
  const keep = mount.item;
  mount.item = window.items.makeItem('ironSword', 'rare');
  mount.onChange();
  out.sword = rel(mount.holder.children[0]);
  mount.item = keep;
  mount.onChange();
  // Prompts and the chest's collider.
  const fixedAt = (p) => [p.x - c.x, p.y - h.floorY, p.z - c.z].map((v) => +v.toFixed(3));
  out.prompts = [h.chestPos, h.bookPos, h.bedPos, h.cratePos, h.benchPos].map(fixedAt);
  const b = h.chestBox;
  out.chestBox = [b.minX - c.x, b.maxX - c.x, b.minY - h.floorY, b.maxY - h.floorY, b.minZ - c.z, b.maxZ - c.z].map((v) => +v.toFixed(3));
  out.chestSolid = g.world.hasCollider(b);
  // An old save (same format as before the models) with every piece placed loads with the models.
  const before = h.save();
  const types = Object.keys(A.FURNITURE);
  const old = { owned: h.owned, expanded: h.expanded, chest: [], displays: [], stock: { chair: 2 }, placed: types.map((type, i) => ({ type, x: c.x - 3.5 + i, z: c.z + (i % 2 ? 1.5 : -1.5), rot: (i * Math.PI) / 2 })) };
  h.load(JSON.parse(JSON.stringify(old)));
  await A.modelsSettled();
  out.loaded = h.placed.map((p) => shows(p.mesh, A.FURNITURE_ART[p.type]) && Math.abs(p.mesh.position.x - p.x) < 1e-6 && Math.abs(p.mesh.position.z - p.z) < 1e-6 && Math.abs(p.mesh.rotation.y - p.rot) < 1e-6).filter(Boolean).length;
  out.resaved = JSON.stringify(h.save().placed) === JSON.stringify(old.placed) && h.stock.chair === 2;
  h.load(before);
  return out;
}, MISSING_FURNITURE);
const near = (a, b) => a.length === b.length && a.every((v, i) => (Array.isArray(v) ? near(v, b[i]) : Math.abs(v - b[i]) < 1e-3));
check('furniture: every catalogue piece and home fixture shows its model (16), the home\'s 16 fixtures and the placement ghost too, copies share geometry and material',
  s.wrong.length === 0 && s.pieces === 16 && s.home === 16 && s.homeN === 16 && s.kinds === 8 && s.shared && s.ghost, JSON.stringify({ wrong: s.wrong, home: s.home, kinds: s.kinds, shared: s.shared, ghost: s.ghost }));
check('furniture: a missing model file keeps the procedural piece without throwing',
  s.missing.piece === false && s.missing.fixture === false && s.missing.shown === 'furniture:procedural,furniture:procedural' && s.missing.state === 'failed' && !s.missing.threw, JSON.stringify(s.missing));
check('furniture: rack, mount and table anchors are where they were, so displayed items sit at the same spots',
  near(s.holders, [[-3.6, 1.9, -4.5], [-2, 1.9, -4.5], [2.4, 1.9, -4.5], [5, 0, -2], [5, 0, 1], [-4.7, 1.05, 3.6], [-3.8, 1.9, -11.5], [0, 1.9, -11.5], [3.8, 1.9, -11.5], [-4.8, 0, -8.5], [4.8, 0, -8.5]])
    && near(s.spotPos.slice(0, 3), [[-3.6, 0, -4.65], [-2, 0, -4.65], [2.4, 0, -4.65]]) && s.racksAt && near(s.sword, [-3.6, 1.35, -4.5]),
  JSON.stringify({ holders: s.holders, sword: s.sword, racksAt: s.racksAt }));
check('furniture: the chest collider and the chest, book, bed, crate and workbench prompts are unchanged',
  near(s.prompts, [[-4.6, 0, -4.1], [-5, 0, 0.5], [4.7, 0, 3.4], [1.6, 0, 4], [-2.2, 0, 3.8]]) && near(s.chestBox, [-5.15, -4.05, 0, 0.7, -4.45, -3.75]) && s.chestSolid,
  JSON.stringify({ prompts: s.prompts, chestBox: s.chestBox }));
check('furniture: an old save with placed furniture loads every piece with its model, in place, and saves back the same',
  s.loaded === 8 && s.resaved, JSON.stringify({ loaded: s.loaded, resaved: s.resaved }));

// ================================================================ crafting (milestone 7)
const cr = await run(() => {
  const g = window.game;
  const p = g.player;
  const h = g.home;
  const inv = p.inv;
  const C = window.crafting;
  const I = window.items;
  g.ui.close();
  for (const k of Object.keys(inv.materials)) delete inv.materials[k];
  inv.gold = 5000;
  const out = {};
  // Workbench: walk up to it and press E.
  p.pos.set(h.benchPos.x + 1.0, h.floorY, h.benchPos.z);
  g.step(1);
  out.label = g.focus?.label;
  window.press('interact');
  out.mode = g.ui.modeKind;
  g.ui.close();
  // Salvage a rare weapon: 3 Golem Cores, the item is gone.
  const gear = I.makeItem('ironSword', 'rare', 5, [{ stat: 'damagePct', value: 0.1 }]);
  gear.affixes = [{ stat: 'damagePct', value: 0.1 }, { stat: 'str', value: 2 }];
  inv.add(gear);
  const sal = C.salvage(inv, inv.bag.indexOf(gear));
  out.salvage = sal.gained === '3 Golem Core' && inv.materials.core === 3 && !inv.bag.includes(gear);
  // Upgrade: +1 costs 10 gold and 1 core; the damage goes up.
  const sword = I.makeItem('ironSword', 'rare', 5, [{ stat: 'damagePct', value: 0.1 }, { stat: 'str', value: 2 }]);
  inv.add(sword);
  const before = I.itemStats(sword).damage;
  const goldBefore = inv.gold;
  out.upErr = C.upgrade(inv, sword);
  out.plus1 = sword.plus === 1 && sword.name.endsWith('+1') && goldBefore - inv.gold === 10 && inv.materials.core === 2;
  out.more = I.itemStats(sword).damage > before;
  // Missing material: +2 needs 1 core (ceil(2/2)) and 40 gold; drain the cores to show the message.
  delete inv.materials.core;
  out.missMat = C.upgrade(inv, sword) === 'Needs 1 Golem Core.' && sword.plus === 1;
  inv.addMaterial('core', 5);
  out.up2 = C.upgrade(inv, sword) === null && sword.plus === 2 && inv.materials.core === 4;
  // Upgrades to +8 need a Warden Ember; +10 is the cap.
  sword.plus = 7;
  out.needEmber = C.upgrade(inv, sword) === 'Needs 1 Warden Ember.' && sword.plus === 7;
  inv.addMaterial('ember', 3);
  out.plus8 = C.upgrade(inv, sword) === null && sword.plus === 8 && inv.materials.ember === 2;
  sword.plus = 10;
  out.capped = C.upgradeCost(sword) === null && /maximum/.test(C.upgrade(inv, sword));
  sword.plus = 0;
  I.refreshName(sword);
  // Re-roll one affix: costs 2 Cult Ash, changes an affix, keeps no duplicates.
  const before2 = JSON.stringify(sword.affixes);
  out.noAsh = /Cult Ash/.test(C.reroll(inv, sword, Math.random) ?? '');
  inv.addMaterial('ash', 2);
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  out.reroll = C.reroll(inv, sword, rng) === null && inv.materials.ash === undefined && JSON.stringify(sword.affixes) !== before2;
  const stats = sword.affixes.map((a) => a.stat);
  out.noDupes = new Set(stats).size === stats.length && sword.affixes.length === 2;
  // Old saves have no plus field: stats still work.
  const old = { ...I.makeItem('rustySword') };
  delete old.plus;
  out.oldSave = I.itemStats(old).damage === I.itemStats(I.makeItem('rustySword')).damage;
  // The UI: select, upgrade and re-roll through InventoryUI.
  g.ui.openCraft();
  g.ui.select(sword);
  out.uiSelected = g.ui.selection === sword && g.ui.modeKind === 'craft';
  inv.addMaterial('core', 1);
  out.uiUp = g.ui.upgradeSelected() === true && sword.plus === 1;
  g.ui.close();
  return out;
});
check('workbench is an E prompt in the house, and it opens the craft panel', cr.label === 'Workbench (salvage, upgrade, re-roll)' && cr.mode === 'craft', `${cr.label} / ${cr.mode}`);
check('salvage turns gear into its slot material', cr.salvage, JSON.stringify(cr));
check('upgrade to +1 costs gold and material and raises stats', cr.plus1 && cr.more, cr.upErr ?? '');
check('a missing material blocks the upgrade with a message', cr.missMat);
check('upgrades to +2 succeed; +8 needs a Warden Ember; +10 is the cap', cr.up2 && cr.needEmber && cr.plus8 && cr.capped);
check('re-roll costs Cult Ash, changes one affix and never duplicates a stat', cr.noAsh && cr.reroll && cr.noDupes);
check('items saved before upgrades (no plus field) still work', cr.oldSave);
check('the workbench panel selects and upgrades items', cr.uiSelected && cr.uiUp);

// ================================================================ sound and settings (milestone 7)
const snd = await run(() => {
  const g = window.game;
  const out = {};
  const names = ['swing', 'hit', 'crit', 'block', 'parry', 'roll', 'hurt', 'death', 'pickup', 'levelUp', 'chest', 'craft', 'ui', 'error'];
  try {
    for (const n of names) window.sound.sound.play(n);
    out.played = true;
  } catch (e) {
    out.played = String(e);
  }
  const read = () => JSON.parse(localStorage.getItem('emberhollow.settings') ?? '{}');
  g.setSound(0.3, true);
  out.muted = read().muted === true && read().volume === 0.3;
  g.setSound(0.6, false);
  out.unmuted = read().muted === false;
  g.setPixelScale(0.75);
  out.pixel = read().pixelScale === 0.75;
  g.setPixelScale(0.5);
  return out;
});
check('every sound effect plays without errors', snd.played === true, String(snd.played));
check('sound volume and mute are saved between visits', snd.muted && snd.unmuted, JSON.stringify(snd));
check('pixel scale is saved in the same settings', snd.pixel);

// Settings panel: O opens it, presets switch shadows, sliders save, Esc closes.
const set = await run(() => {
  const g = window.game;
  const out = {};
  const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const read = () => JSON.parse(localStorage.getItem('emberhollow.settings') ?? '{}');
  const btn = (t) => [...document.querySelectorAll('.settings-panel .craft-btn')].find((b) => b.textContent === t);
  key('KeyO');
  out.open = g.settingsUI.isOpen && g.menuOpen;
  out.labels = [...document.querySelectorAll('.settings-panel .craft-btn')].map((b) => b.textContent).join(',');
  btn('Low').click();
  out.low = g.renderer.shadowMap.enabled === false && g.sun.castShadow === false && read().quality === 'low';
  btn('Medium').click();
  out.medium = g.renderer.shadowMap.enabled === true && g.sun.shadow.mapSize.x === 1024 && read().quality === 'medium';
  btn('High').click();
  out.high = g.sun.shadow.mapSize.x === 2048 && read().quality === 'high';
  const ranges = () => [...document.querySelectorAll('.settings-panel input[type=range]')];
  ranges()[0].value = '3';
  ranges()[0].dispatchEvent(new Event('input'));
  out.pixel = Math.abs(g.pixelScale - 0.34) < 1e-6 && Math.abs(read().pixelScale - 0.34) < 1e-6;
  ranges()[0].value = '2';
  ranges()[0].dispatchEvent(new Event('input'));
  ranges()[1].value = '30';
  ranges()[1].dispatchEvent(new Event('input'));
  out.volume = read().volume === 0.3;
  key('Escape');
  out.closed = !g.settingsUI.isOpen && !g.menuOpen;
  return out;
});
check('O opens the settings panel and pauses the game', set.open, set.labels);
check('graphics presets switch shadows and their resolution, and are saved', set.low && set.medium && set.high, JSON.stringify(set));
check('pixel size and volume sliders apply and save', set.pixel && set.volume);
check('Esc closes the settings panel', set.closed);

// ================================================================ classes (milestone 4)
await run(() => {
  // New character of a class at the spawn; one enemy `dist` m ahead (frozen unless asked).
  window.asClass = (cls, kind = 'bandit', dist = 30, frozen = true, dx = 0) => {
    const g = window.game;
    g.chooseClass(cls);
    const e = window.arena(kind, dist, frozen, dx);
    g.player.rand = () => 0.99; // no random crits
    g.player.mana = g.player.stats.maxMana;
    return e;
  };
  window.levelTo = (n) => {
    const p = window.game.player;
    while (p.level < n) p.gainXp(window.xpToNext(p.level));
    p.mana = p.stats.maxMana;
  };
  window.cast = (slot) => window.game.skills.cast(slot, window.game.skillContext());
});
await run(() => {
  window.xpToNext = (l) => Math.round(60 * Math.pow(l, 1.6));
});

// 27. Each class starts with its own weapon, HP and mana.
s = await run(() => {
  const out = {};
  for (const c of ['warrior', 'tank', 'mage', 'assassin']) {
    window.asClass(c);
    const p = window.game.player;
    out[c] = `${p.inv.equipped.weapon?.base}/${p.inv.equipped.offhand?.base ?? '-'}/${p.stats.maxHp}/${p.stats.maxMana}`;
  }
  return out;
});
check('classes start with their own gear and stats',
  s.warrior === 'rustySword/-/100/50' && s.tank === 'rustyMace/woodShield/130/40' && s.mage === 'oakStaff/-/80/130' && s.assassin === 'rustyDaggers/-/85/60',
  JSON.stringify(s));

// 27b. Art: switching class shows that class's own rigged body once its file has loaded.
s = await run(async () => {
  const bodies = { tank: 'Knight_Body', mage: 'Mage_Body', assassin: 'Rogue_Body', warrior: 'Barbarian_Body' };
  const out = {};
  for (const [c, mesh] of Object.entries(bodies)) {
    window.asClass(c);
    await window.settleModels();
    const m = window.game.model;
    out[c] = m.usingRig && m.rigClass === c && !!m.rig.node(mesh) && !m.blocky.visible;
  }
  return out;
});
check('each class shows its own rigged body (knight, mage, rogue, barbarian)', Object.values(s).every(Boolean), JSON.stringify(s));

// 27c. Art: blocking with a shield on the rig raises it in front of the body, face (the boss side,
// item -Z) ahead; released, the holder gets its mounted rotation [0, π, 0] back. No shield: untouched.
s = await run(async () => {
  const g = window.game;
  const out = {};
  for (const c of ['tank', 'warrior']) {
    window.asClass(c);
    await window.settleModels();
    const p = g.player;
    const m = g.model;
    g.step(20, { held: ['block'] });
    g.step(0, null, true);
    const V = p.pos.constructor;
    const fwd = new V(-Math.sin(p.facing), 0, -Math.cos(p.facing));
    const face = new V(0, 0, -1).applyQuaternion(m.shield.getWorldQuaternion(new m.root.quaternion.constructor()));
    const rel = m.shield.getWorldPosition(new V()).sub(p.pos);
    const raised = { rig: m.usingRig, items: m.shield.children.length, blocking: p.blocking, dot: +face.dot(fwd).toFixed(3), ahead: +rel.dot(fwd).toFixed(2), h: +rel.y.toFixed(2) };
    const held = m.shield.rotation.toArray().slice(0, 3);
    for (let i = 0; i < 15; i++) g.step(1, null, true);
    const rest = m.shield.rotation.toArray().slice(0, 3);
    const atRest = (r) => r[0] === 0 && Math.abs(r[1] - Math.PI) < 1e-6 && r[2] === 0;
    out[c] = { ...raised, heldAtRest: atRest(held), restAfter: atRest(rest) };
  }
  return out;
});
check('blocking with a shield holds it up in front at chest height, facing ahead; released, it turns back',
  s.tank.rig && s.tank.items === 1 && s.tank.blocking && s.tank.dot > 0.9 && s.tank.ahead > 0.35 && s.tank.h > 0.5 && s.tank.h < 1.0 &&
    !s.tank.heldAtRest && s.tank.restAfter && s.warrior.rig && s.warrior.items === 0 && s.warrior.heldAtRest && s.warrior.restAfter,
  JSON.stringify(s));

// 27d. Art: clips frozen at speed 0 (scrubbed attacks, the roll's held crouch) fade out like any
// other when the next clip starts: after a full attack and a roll, 30 drawn idle frames leave only
// the idle clip with weight, nothing left mixed in under it.
s = await run(async () => {
  const g = window.game;
  const out = {};
  for (const c of ['warrior', 'tank']) {
    window.asClass(c);
    await window.settleModels();
    const p = g.player;
    const m = g.model;
    const drawn = (n, v = null) => {
      for (let i = 0; i < n; i++) g.step(1, v, true);
    };
    const through = (state) => {
      for (let i = 0; i < 240 && p.state === state; i++) drawn(1);
    };
    drawn(30);
    drawn(1, { held: ['attack'] });
    const attacked = p.state === 'attack';
    through('attack');
    drawn(5);
    drawn(1, { held: ['dodge'] });
    const rolled = p.state === 'roll';
    through('roll');
    drawn(30);
    const mixed = m.rig.mixer._actions
      .filter((a) => a.isScheduled() && a.getEffectiveWeight() > 0.01)
      .map((a) => `${a.getClip().name}:${a.getEffectiveWeight().toFixed(2)}${a.timeScale === 0 ? '(frozen)' : ''}`);
    out[c] = { attacked, rolled, state: p.state, clip: m.rig.clip, mixed };
  }
  return out;
});
const onlyIdle = (r) =>
  r.attacked && r.rolled && r.state === 'ground' && /Idle/.test(r.clip) && r.mixed.length === 1 && r.mixed[0].startsWith(`${r.clip}:`);
check('after an attack and a roll, only the idle clip is still mixed in (frozen clips fade out too)',
  onlyIdle(s.warrior) && onlyIdle(s.tank), JSON.stringify(s));

// 28. Gear restrictions and class-aware drops.
s = await run(() => {
  window.asClass('warrior');
  const p = window.game.player;
  const I = window.items;
  p.inv.add(I.makeItem('oakStaff'));
  const err = p.inv.equip(p.inv.bag.findIndex((x) => x?.base === 'oakStaff'), p.level);
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bad = [];
  for (let i = 0; i < 400; i++) {
    const it = I.rollItem(rand, 2, undefined, 'mage');
    if (!I.usableBy(it.base, 'mage')) bad.push(it.base);
  }
  return { err, bad: bad.slice(0, 3) };
});
check('a warrior cannot equip a staff', s.err === 'Only Mage can use this.', s.err);
check('drops rolled for a class are usable by it', s.bad.length === 0, s.bad.join());

// 29. XP, levels, attributes, skill tree, respec.
s = await run(() => {
  const e = window.asClass('warrior', 'bandit', 1.8);
  const g = window.game;
  const p = g.player;
  e.takeHit({ damage: 999, poise: 0, knockback: 0, from: p.pos.clone() }, []);
  g.step(1);
  const xp = p.prog.xp;
  p.hp = 10;
  p.gainXp(window.xpToNext(1));
  const out = { xp, level: p.level, ap: p.prog.attrPoints, sp: p.prog.skillPoints, healed: p.hp === p.stats.maxHp, maxHp: p.stats.maxHp };
  const dm0 = p.stats.damageMult;
  for (let i = 0; i < 5; i++) p.prog.allocate('str');
  p.refreshStats();
  out.dmgUp = p.stats.damageMult - dm0;
  out.lockedErr = p.prog.rankUp('earthsplitter');
  out.rankErr = p.prog.rankUp('wToughness');
  p.refreshStats();
  out.hpAfterRank = p.stats.maxHp;
  window.levelTo(3);
  p.inv.gold = 100;
  g.charUI.show(true);
  const respecErr = g.charUI.respec();
  out.respec = `${respecErr}/${p.prog.attrPoints}/${p.prog.skillPoints}/${p.inv.gold}`;
  out.nodes = document.querySelectorAll('.inv .node').length;
  g.charUI.close();
  return out;
});
check('a bandit kill gives 35 XP', s.xp === 35, `xp=${s.xp}`);
check('level-up: +5 attribute points, +1 skill point, full heal, +4 HP', s.level === 2 && s.ap === 5 && s.sp === 1 && s.healed && s.maxHp === 104, JSON.stringify(s));
check('5 Strength = +10% damage', Math.abs(s.dmgUp - 0.1) < 1e-9, s.dmgUp);
check('skill tree: locked skills refuse points, passives apply', s.lockedErr === 'Unlocks at level 6.' && s.rankErr === null && s.hpAfterRank === 114, `${s.lockedErr} / ${s.rankErr} / hp ${s.hpAfterRank}`);
check('respec at the book (level 3) refunds all points for 60 gold', s.respec === 'null/10/2/40', s.respec);
check('skill tree shows 4 skills + 4 passives', s.nodes === 8, s.nodes);

// 30. Warrior skills.
s = await run(() => {
  const g = window.game;
  const out = {};
  let e = window.asClass('warrior', 'bandit', 5);
  const p = g.player;
  const z0 = p.pos.z;
  out.chargeErr = window.cast(0);
  out.manaAfter = p.mana;
  g.step(30);
  out.charged = z0 - p.pos.z;
  out.chargeHit = 70 - e.hp;
  out.again = window.cast(0);
  // Whirlwind: two enemies around you.
  e = window.asClass('warrior', 'slime', 1.5);
  window.levelTo(6);
  const s2 = g.enemies.list.filter((x) => x.kind === 'slime')[1];
  s2.pos.set(p.pos.x, p.pos.y, p.pos.z + 1.6);
  s2.hp = 30;
  e.hp = 30;
  window.cast(1);
  g.step(50);
  out.whirl = [30 - e.hp, 30 - s2.hp];
  // War Cry: +25% on the next strike.
  e = window.asClass('warrior', 'bandit', 1.8);
  window.levelTo(6);
  window.cast(2);
  g.step(30);
  out.buff = p.damageBuffTime > 7;
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.cryHit = 70 - e.hp;
  // Earthsplitter knocks down in a line.
  e = window.asClass('warrior', 'bandit', 4);
  window.levelTo(6);
  window.cast(3);
  g.step(40);
  out.split = `${70 - e.hp}/${e.staggerKind}`;
  return out;
});
check('Charge dashes ~8 m through an enemy (150%)', s.chargeErr === null && s.charged > 7 && s.charged < 9.5 && s.chargeHit === 18 && s.manaAfter === 35, `moved=${s.charged?.toFixed(1)} hit=${s.chargeHit} mana=${s.manaAfter}`);
check('skills go on cooldown', /not ready/.test(s.again ?? ''), s.again);
check('Whirlwind hits everyone around you 3 times', s.whirl[0] >= 24 && s.whirl[1] >= 24, s.whirl.join());
check('War Cry: +25% damage', s.buff && s.cryHit === 15, `hit=${s.cryHit}`);
check('Earthsplitter knocks down for 300%', s.split.startsWith('36/') && s.split.endsWith('knockdown'), s.split);

// 31. Tank: block meter, parry → Riposte, Taunt, Shield Bash, Bulwark.
s = await run(() => {
  const g = window.game;
  const out = {};
  let e = window.asClass('tank', 'bandit', 2);
  const p = g.player;
  const hit = (dmg = 12, poise = 8) => p.takeHit({ damage: dmg, poise, knockback: 2, from: p.pos.clone().setZ(p.pos.z - 1.5) });
  out.noParry = window.cast(0);
  g.step(30, { held: ['block'] });
  hit();
  out.afterBlock = p.counter;
  g.step(1);
  g.step(3, { held: ['block'] });
  out.parry = hit();
  out.afterParry = p.counter;
  g.step(1);
  out.riposte = window.cast(0);
  g.step(40);
  out.ripHit = 70 - e.hp; // (2 + 3 × 0.45) × 13 = 43.55
  out.meter = p.counter;
  // Taunt pulls and slows a distant idle enemy.
  e = window.asClass('tank', 'bandit', 8, false);
  window.levelTo(6);
  window.cast(1);
  g.step(30);
  out.taunt = `${e.tauntTime > 3}/${e.slowFactor}/${e.state}`;
  // Shield Bash staggers.
  e = window.asClass('tank', 'bandit', 1.8);
  window.levelTo(6);
  window.cast(2);
  g.step(20);
  out.bash = `${70 - e.hp}/${e.state}`;
  // Bulwark halves damage and stops staggers.
  window.asClass('tank');
  window.levelTo(6);
  window.cast(3);
  g.step(20);
  const before = p.hp;
  hit(40, 100);
  out.bulwark = `${before - p.hp}/${p.state}`;
  return out;
});
check('Riposte needs a parry first', /needs a parry/.test(s.noParry ?? ''), s.noParry);
check('blocking fills the counter meter (+10), parrying more (+35)', s.afterBlock === 10 && s.parry === 'parried' && s.afterParry === 45, `${s.afterBlock} / ${s.parry} / ${s.afterParry}`);
check('Riposte after a parry hits hard and spends the meter', s.riposte === null && s.ripHit === 44 && s.meter === 0, `hit=${s.ripHit} meter=${s.meter}`);
check('Taunt pulls and slows enemies', s.taunt === 'true/0.6/chase', s.taunt);
check('Shield Bash staggers', s.bash === '16/stagger', s.bash);
check('Bulwark: half damage, no stagger', s.bulwark.endsWith('/ground') && Number(s.bulwark.split('/')[0]) < 18, s.bulwark);

// 32. Mage: bolts, Fireball, Frost Nova, Blink, Meteor, aiming.
s = await run(() => {
  const g = window.game;
  const out = {};
  let e = window.asClass('mage', 'bandit', 8);
  const p = g.player;
  window.press('attack');
  g.step(40);
  out.bolt = 70 - e.hp;
  // Fireball: two slimes close together, 8 m away.
  e = window.asClass('mage', 'slime', 8);
  const s2 = g.enemies.list.filter((x) => x.kind === 'slime')[1];
  s2.pos.set(e.pos.x + 1.2, e.pos.y, e.pos.z);
  s2.hp = 30;
  window.cast(0);
  g.step(60);
  out.fireball = [30 - e.hp, 30 - s2.hp, e.burnTime > 0 || e.hp < 30 - 28];
  // Frost Nova freezes nearby enemies.
  e = window.asClass('mage', 'bandit', 3, false);
  window.levelTo(6);
  window.cast(1);
  g.step(15);
  out.nova = `${e.state}/${e.slowTime > 0}`;
  // Blink: 8 m in the move direction (forward).
  window.asClass('mage');
  window.levelTo(6);
  const z0 = p.pos.z;
  g.skills.cast(2, { ...g.skillContext(), wish: new p.pos.constructor(0, 0, -1) });
  g.step(15);
  out.blink = z0 - p.pos.z;
  // Meteor on a locked target.
  e = window.asClass('mage', 'bandit', 10);
  window.levelTo(6);
  g.lockOn.target = e;
  g.step(1);
  window.cast(3);
  g.step(110);
  out.meteor = 70 - e.hp;
  // Right click = aim (not block).
  window.asClass('mage');
  g.step(10, { held: ['block'] });
  out.aim = `${p.aiming}/${p.blocking}`;
  return out;
});
check('mage bolt flies to the enemy (11 damage)', s.bolt === 11, `hit=${s.bolt}`);
check('Fireball explodes on both slimes and burns', s.fireball[0] >= 28 && s.fireball[1] >= 28, JSON.stringify(s.fireball));
check('Frost Nova freezes and slows', s.nova === 'stagger/true', s.nova);
check('Blink teleports ~8 m', s.blink > 7.5 && s.blink < 8.5, s.blink?.toFixed(2));
check('Meteor crashes on the target', s.meteor >= 66, `hit=${s.meteor}`);
check('mage right click aims instead of blocking', s.aim === 'true/false', s.aim);

// 33. Assassin: 4-hit combo, backstab, Shadowstep, Fan of Knives, Vanish, Eviscerate.
s = await run(() => {
  const g = window.game;
  const out = {};
  let e = window.asClass('assassin', 'bandit', 10);
  const p = g.player;
  out.combo = p.combo().length;
  // Front vs back: same strike, enemy facing the player vs facing away.
  e = window.asClass('assassin', 'bandit', 1.5);
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.front = 70 - e.hp;
  e = window.asClass('assassin', 'bandit', 1.5);
  e.facing = 0; // facing away (north)
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.back = 70 - e.hp;
  // Shadowstep behind a target 8 m away; next hit crits.
  e = window.asClass('assassin', 'bandit', 8);
  window.cast(0);
  g.step(15);
  out.behind = g.enemies.isBehind(e, p.pos) && p.nextCrit;
  window.press('attack');
  window.until({}, () => g.hitStop > 0, 30);
  out.critHit = 70 - e.hp;
  // Fan of Knives.
  e = window.asClass('assassin', 'bandit', 6);
  window.levelTo(6);
  window.cast(1);
  g.step(30);
  out.fan = 70 - e.hp;
  // Vanish: a chasing bandit loses track.
  e = window.asClass('assassin', 'bandit', 6, false);
  window.levelTo(6);
  g.step(30);
  const chasing = e.state;
  window.cast(2);
  g.step(30);
  out.vanish = `${chasing}->${e.state}/${p.stealthTime > 0}`;
  // Eviscerate: 400%, doubled under 30% HP.
  e = window.asClass('assassin', 'bandit', 1.8);
  window.levelTo(6);
  window.cast(3);
  g.step(30);
  out.evis = 70 - e.hp;
  e = window.asClass('assassin', 'bandit', 1.8);
  window.levelTo(6);
  e.hp = 20;
  window.cast(3);
  g.step(30);
  out.evisLow = e.alive;
  return out;
});
check('assassin has a 4-hit dagger combo', s.combo === 4);
check('backstab: +50% damage from behind', s.front === 8 && s.back === 12, `front=${s.front} back=${s.back}`);
check('Shadowstep: appear behind the target, next hit crits', s.behind && s.critHit === 20, `behind=${s.behind} hit=${s.critHit}`);
check('Fan of Knives hits ahead', s.fan >= 9, `hit=${s.fan}`);
check('Vanish: enemies lose track of you', /^(chase|windup|active|recover)->(return|idle)\/true$/.test(s.vanish), s.vanish);
check('Eviscerate 400%, double on a weak enemy', s.evis === 44 && s.evisLow === false, `hit=${s.evis} lowSurvived=${s.evisLow}`);

// 34. Class pick screen and HUD.
s = await run(() => {
  const g = window.game;
  g.showClassSelect();
  const cards = document.querySelectorAll('.classcard').length;
  const menu = g.menuOpen;
  document.querySelectorAll('.classcard')[2].click();
  g.step(1, null, true);
  return { cards, menu, cls: g.player.cls, closed: !g.menuOpen, slots: document.querySelectorAll('.skillbar .skill').length, cross: document.querySelector('.crosshair').style.display };
});
check('class pick screen: 4 classes, picking one starts that class', s.cards === 4 && s.menu && s.cls === 'mage' && s.closed, JSON.stringify(s));
check('skill bar shows 4 skills; mage gets a crosshair', s.slots === 4 && s.cross === '', JSON.stringify(s));

if (shotsDir) {
  await run(() => window.game.chooseClass('warrior'));
  await run(() => {
    const g = window.game;
    for (const e of g.enemies.list) {
      e.home.copy(window.homes.get(e));
      e.reset();
      e.frozen = true;
    }
    // Bandit camp: lock on to a bandit and land a hit.
    window.place(-18, 6, 0.5);
    const p = g.player;
    const b = g.enemies.list.find((e) => e.kind === 'bandit');
    b.pos.set(-18, g.world.groundAt(-18, 3.8, 1e9), 3.8);
    b.facing = Math.PI;
    g.lockOn.target = b;
    g.step(30);
    g.cam.pitch = 0.25;
    window.press('attack');
    g.step(16);
  });
  await shot('06-combat');
  await run(() => {
    const g = window.game;
    for (const e of g.enemies.list) e.frozen = false;
    g.lockOn.target = null;
    window.place(16, 34, 0.0);
    g.cam.pitch = 0.3;
    g.step(50);
  });
  await shot('07-boars');

  // Loot beams of every rarity, wearing a full set.
  await run(() => {
    const g = window.fresh();
    for (const e of g.enemies.list) e.frozen = true;
    const I = window.items;
    const p = g.player;
    const inv = p.inv;
    inv.equipped.weapon = I.makeItem('ironSword', 'epic', 2, [{ stat: 'str', value: 3 }]);
    inv.equipped.offhand = I.makeItem('ironShield', 'rare');
    inv.equipped.helmet = I.makeItem('helm', 'uncommon');
    inv.equipped.chest = I.makeItem('mail', 'rare');
    inv.changed();
    window.place(0, 12, 0.5);
    g.cam.pitch = 0.3;
    const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    rar.forEach((r, i) => g.loot.dropItem(I.rollItem(Math.random, 2, r), p.pos.clone().set(-4 + i * 2, p.pos.y, 6)));
    g.step(80);
  });
  await shot('08-loot');

  // Inventory with a tooltip.
  await run(() => {
    const g = window.game;
    const I = window.items;
    const inv = g.player.inv;
    inv.add(I.makeItem('greatsword', 'legendary', 3, [{ stat: 'str', value: 3 }, { stat: 'crit', value: 0.04 }]));
    inv.add(I.makeItem('ironSword', 'legendary', 3, [{ stat: 'dex', value: 2 }, { stat: 'hp', value: 14 }, { stat: 'attackSpeed', value: 0.06 }], 'emberfang'));
    for (let i = 0; i < 9; i++) inv.add(I.rollItem(Math.random, 2));
    inv.gold = 137;
    inv.materials.gel = 4;
    inv.materials.cloth = 2;
    g.ui.open({ kind: 'bag' });
    g.step(1);
  });
  await page.hover('.inv-grid.bag .inv-cell:nth-child(2)');
  await shot('09-inventory');
  await run(() => window.game.ui.close());

  // Home base: outside, then inside with gear on display.
  await run(() => {
    const g = window.game;
    const h = g.home;
    const I = window.items;
    const [m1, m2, m3] = h.spots.filter((s) => s.kind === 'mount');
    const [s1, s2] = h.spots.filter((s) => s.kind === 'stand');
    const put = (spot, item) => { spot.item = item; spot.onChange(); };
    put(m1, I.makeItem('greatsword', 'epic'));
    put(m2, I.makeItem('ironShield', 'rare'));
    put(m3, I.makeItem('ironSword', 'legendary', 3, [], 'emberfang'));
    put(s1, I.makeItem('mail', 'rare'));
    put(s2, I.makeItem('helm', 'uncommon'));
    put(h.spots.find((s) => s.kind === 'table'), I.makeItem('copperRing', 'legendary', 1, [], 'thirstBand'));
    const p = g.player;
    p.pos.set(h.door.x - 3, 0, h.door.z + 7);
    p.pos.y = g.world.groundAt(p.pos.x, p.pos.z, 1e9);
    g.cam.yaw = 0.35;
    g.cam.pitch = 0.25;
    g.step(5);
  });
  await shot('10-house');
  await run(() => {
    const g = window.game;
    const h = g.home;
    const p = g.player;
    p.pos.set(g.world.homeSite.x - 0.5, h.floorY, g.world.homeSite.z + 0.5);
    p.facing = 0.3;
    g.cam.yaw = 0.3;
    g.cam.pitch = 0.3;
    g.cam.distance = 5;
    for (let i = 0; i < 30; i++) g.step(1, null, true);
  });
  await shot('11-house-inside');

  // Class pick screen.
  await run(() => window.game.showClassSelect());
  await shot('12-class-select');
  await run(() => document.querySelectorAll('.classcard')[2].click());

  // Each class in action near the bandit camp.
  const action = async (cls, name, fn) => {
    await run(([cls, fnSrc]) => {
      const g = window.game;
      g.chooseClass(cls);
      window.levelTo(6);
      for (const e of g.enemies.list) {
        e.home.copy(window.homes.get(e));
        e.reset();
        e.frozen = true;
      }
      window.place(-18, 8, 0);
      const p = g.player;
      g.cam.pitch = 0.25;
      g.cam.distance = 6;
      const b = g.enemies.list.find((e) => e.kind === 'bandit');
      b.pos.set(-18, g.world.groundAt(-18, 3.5, 1e9), 3.5);
      b.facing = Math.PI;
      p.mana = p.stats.maxMana;
      new Function('g', 'p', 'b', fnSrc)(g, p, b);
      for (let i = 0; i < 3; i++) g.step(1, null, true);
    }, [cls, fn]);
    await shot(name);
  };
  await action('mage', '13-mage', "window.cast(0); g.step(22);");
  await action('tank', '14-tank', "g.step(20, { held: ['block'] }); b.pos.z = 6.6;");
  await action('assassin', '15-assassin', "g.lockOn.target = b; g.step(20); window.cast(0); g.step(6); window.press('attack'); g.step(5);");
  await action('warrior', '16-warrior', "window.cast(1); g.step(16);");

  // Character menu.
  await run(() => {
    const g = window.game;
    g.player.prog.allocate('str', 3);
    g.player.prog.rankUp('charge');
    g.player.prog.rankUp('wToughness');
    g.charUI.show(false);
    g.step(1);
  });
  await shot('17-skills-menu');
  await run(() => window.game.charUI.close());
}


// Real-time look for a screenshot: free-running loop.
if (shotsDir) {
  await run(() => {
    window.place(0, 12, 0.6);
    window.game.cam.pitch = 0.35;
    window.game.step(5);
  });
  await shot('05-overview');
}

// ================================================================ world (milestone 5): main map
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page2.on('pageerror', (e) => errors.push(String(e)));
page2.on('console', (m) => m.type() === 'error' && !expectedError(m) && errors.push(m.text()));
// The villager fallback checks ask for a missing model file on this page too (a real host answers 404).
await page2.route(`**/${MISSING_NPC}`, (r) => r.fulfill({ status: 404, body: 'not found' }));
await page2.route(`**/${MISSING_WORLD}`, (r) => r.fulfill({ status: 404, body: 'not found' }));
await page2.goto(`http://localhost:${PORT}/?test&world=main`);
await page2.waitForFunction(() => window.game && window.items);
// Colliders before anything moves (compared after the world models are in, section 35b).
const mainColliders = await page2.evaluate(() => {
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const key = (b) => [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map((v) => v.toFixed(3)).join(',') + (b.noClimb ? 'n' : '') + (b.zone ?? '');
  window.colliderHash = () => {
    const boxes = window.game.world.boxes.map(key).sort();
    return `${boxes.length}/${fnv(boxes.join('|'))}`;
  };
  return window.colliderHash();
});
const run2 = (fn, arg) => page2.evaluate(fn, arg);
const shot2 = async (name) => {
  if (shotsDir) await page2.evaluate(() => window.game.step(0, null, true)), await page2.screenshot({ path: `${shotsDir}/${name}.png` });
};
await run2(() => {
  const g = window.game;
  window.homes = new Map(g.enemies.list.map((e) => [e, e.home.clone()]));
  for (const e of g.enemies.list) e.frozen = true;
  // Teleport onto the highest surface, or onto the floor below `y` (indoors).
  window.tp = (x, z, y = 1e9) => {
    const p = g.player;
    p.pos.set(x, g.world.groundAt(x, z, y), z);
    p.vel.set(0, 0, 0);
    p.state = 'ground';
    p.stateTime = 0;
  };
  // An enemy of `kind` placed `dist` m north of the player standing at (0, 32) in town.
  window.arena2 = (kind, dist, frozen = true) => {
    for (const e of g.enemies.list) {
      e.home.copy(window.homes.get(e));
      e.reset();
      e.frozen = true;
    }
    g.lockOn.target = null;
    g.player.respawn();
    window.tp(0, 32);
    g.cam.yaw = 0;
    g.player.facing = 0;
    const e = g.enemies.list.find((x) => x.kind === kind);
    e.home.set(0, 0, 32 - dist);
    e.reset();
    e.facing = Math.PI;
    e.frozen = frozen;
    return e;
  };
  window.talk = (npc) => g.adventure.town.talk(npc);
  window.pick = (label) => g.adventure.dialog.chooseLabel(label);
  window.levelTo = (n) => {
    const p = g.player;
    while (p.level < n) p.gainXp(Math.round(60 * Math.pow(p.level, 1.6)));
  };
  window.killAll = (kind, n) => {
    let k = 0;
    for (const e of g.enemies.list) {
      if (k >= n) break;
      if (e.kind !== kind || !e.alive) continue;
      e.takeHit({ damage: 99999, poise: 0, knockback: 0, from: e.pos.clone() }, []);
      k++;
    }
    g.step(1);
    return k;
  };
});

// 34a. Art (milestone 8): every enemy kind shows its rigged model, sized to its collider, feet on the ground.
s = await run2(async () => {
  const g = window.game;
  const A = window.art;
  const V = g.player.pos.constructor;
  // Every model asks for its files on its first update (far ones too), then swaps its rig in.
  for (const m of g.enemies.models) m.update(1 / 60);
  await A.modelsSettled();
  for (const m of g.enemies.models) m.update(1 / 60);
  // Skinned vertices in the pose shown: height, and the lowest point against the enemy's feet.
  const measure = (m) => {
    m.root.updateMatrixWorld(true);
    let lo = 1e9;
    let hi = -1e9;
    m.rig.root.traverse((o) => {
      if (!o.isSkinnedMesh || o.name.endsWith('_outline')) return;
      for (let i = 0; i < o.geometry.attributes.position.count; i += 3) {
        const y = o.getVertexPosition(i, new V()).applyMatrix4(o.matrixWorld).y;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    });
    return { ratio: +((hi - lo) / m.enemy.stats.topY).toFixed(2), feet: +(lo - m.enemy.pos.y).toFixed(2) };
  };
  const out = {};
  for (const kind of Object.keys(A.ENEMY_ART).filter((k) => k !== 'add')) {
    const e = window.arena2(kind, 6); // on the flat town square
    const m = g.enemies.models.find((x) => x.enemy === e);
    for (let i = 0; i < 3; i++) m.update(1 / 60);
    out[kind] = m.usingRig && !m.body.visible ? measure(m) : 'placeholder';
  }
  // A summoned add: the minion body with a blade, rising out of the ground.
  const boss = g.adventure.dungeon.boss;
  const add = g.enemies.spawn('skeleton', boss.pos.x + 4, boss.pos.z, 14);
  add.summoner = boss;
  add.frozen = true;
  const am = g.enemies.models.find((x) => x.enemy === add);
  am.update(1 / 60);
  const held = (m, slot, name) => !!m.rig?.node(slot)?.getObjectByName(name);
  out.add = { rig: am.usingRig, minion: !!am.rig?.node('Skeleton_Minion_Body'), clip: am.rig?.clip, blade: held(am, 'handslot.r', 'Skeleton_Blade') };
  g.enemies.resetAll();
  const mk = (kind) => g.enemies.models.find((x) => x.enemy.kind === kind && !x.enemy.summoner);
  const shown = (m, n) => !!m.rig?.node(n)?.visible;
  out.props = {
    skeleton: held(mk('skeleton'), 'handslot.r', 'Skeleton_Blade') && held(mk('skeleton'), 'handslot.l', 'Skeleton_Shield_Small_A'),
    cultist: held(mk('cultist'), 'handslot.r', 'Skeleton_Staff'),
    warden: held(mk('warden'), 'handslot.r', 'Skeleton_Axe'),
    bandit: shown(mk('bandit'), 'Knife') && shown(mk('bandit'), 'Knife_Offhand') && !shown(mk('bandit'), '1H_Crossbow'),
    goblin: shown(mk('goblin'), '1H_Crossbow') && !shown(mk('goblin'), 'Knife'),
  };
  return out;
});
{
  const kinds = Object.entries(s).filter(([k]) => k !== 'add' && k !== 'props');
  const fit = kinds.every(([, v]) => v !== 'placeholder' && v.ratio > 0.75 && v.ratio < 1.2 && Math.abs(v.feet) < 0.1);
  check('enemies: every kind shows its rigged model, height near its collider top, feet on the ground', kinds.length === 10 && fit, JSON.stringify(Object.fromEntries(kinds)));
  check('enemies: a summoned add is the minion body with a blade and rises with Spawn_Ground_Skeletons', s.add.rig && s.add.minion && s.add.blade && s.add.clip === 'Spawn_Ground_Skeletons', JSON.stringify(s.add));
  check('enemies: weapons and props in hand (skeleton blade + shield, cultist staff, boss axe, bandit knives, goblin crossbow)', Object.values(s.props).every(Boolean), JSON.stringify(s.props));
}

// 34b. Art: an attack clip follows the game's timings: its measured swing fills the active window.
s = await run2(() => {
  const g = window.game;
  const A = window.art;
  const p = g.player;
  const V = p.pos.constructor;
  const out = {};
  for (const kind of ['skeleton', 'bandit']) {
    const e = window.arena2(kind, 1.6, false);
    const m = g.enemies.models.find((x) => x.enemy === e);
    const atk = A.ENEMY_ART[kind].attacks[0];
    const d = m.rig.duration(atk.clip);
    const [a, b] = [atk.swing[0] * d, atk.swing[1] * d];
    const hand = m.rig.node('handslot.r');
    const rec = [];
    let prev = null;
    for (let i = 0; i < 150; i++) {
      p.hp = p.stats.maxHp;
      g.step(1);
      g.enemies.updateModels(1 / 60, p.pos);
      const busy = ['windup', 'active', 'recover'].includes(e.state) && e.comboStep === 0;
      if (!busy) {
        if (rec.length) break;
        continue;
      }
      m.root.updateMatrixWorld(true);
      const w = m.root.worldToLocal(hand.getWorldPosition(new V()));
      rec.push({ s: e.state, st: e.stateTime, t: m.rig.actions.get(atk.clip).time, clip: m.rig.clip, sp: prev ? w.distanceTo(prev) * 60 : 0 });
      prev = w;
    }
    const of = (st) => rec.filter((r) => r.s === st);
    const avg = (l) => l.reduce((x, r) => x + r.sp, 0) / Math.max(1, l.length);
    const ok = (l, lo, hi) => l.every((r) => r.clip === atk.clip && r.t >= lo - 0.01 && r.t <= hi + 0.01);
    const act = of('active');
    out[kind] = {
      frames: `${of('windup').length}/${act.length}/${of('recover').length}`,
      inWindow: ok(of('windup'), 0, a) && ok(act, a, b) && ok(of('recover'), b, d),
      // The hand moves fastest in the active window (wind-up measured after its 0.1 s blend in).
      fast: +(avg(act) / avg(of('windup').filter((r) => r.st > 0.1))).toFixed(1),
    };
    e.frozen = true;
  }
  return out;
});
check('enemies: the attack clip\'s swing lands inside the game\'s active window (skeleton, bandit)', Object.values(s).every((v) => v.inWindow && v.fast > 1.5 && !v.frames.includes('/0/')), JSON.stringify(s));

// 34c. Art: deaths play the death clip once and hold it; the boss's eyes glow ember, phase 2 still
// smoulders; far sleeping enemies do not advance their mixers.
s = await run2(() => {
  const g = window.game;
  const A = window.art;
  const p = g.player;
  const out = {};
  const model = (e) => g.enemies.models.find((x) => x.enemy === e);
  for (const kind of ['wolf', 'skeleton', 'spider']) {
    const e = window.arena2(kind, 4);
    e.takeHit({ damage: 1e6, poise: 0, knockback: 0, from: e.pos.clone() }, []);
    e.lootPending = false; // no XP or loot from a test kill
    const m = model(e);
    for (let i = 0; i < 5; i++) m.update(1 / 60);
    const act = m.rig.actions.get(m.rig.clip);
    out[kind] = { state: e.state, clip: m.rig.clip, want: A.ENEMY_ART[kind].death, once: act.loop === 2200 && act.clampWhenFinished };
    e.reset();
  }
  // The boss: ember eyes, no glow on the body in phase 1, a pulsing ember glow in phase 2.
  const b = g.adventure.dungeon.boss;
  b.reset();
  const bm = model(b);
  bm.update(1 / 60);
  const eye = bm.glowMats[0]?.emissive;
  const body = bm.rigMats[0];
  const p1 = body.emissiveIntensity;
  b.phase = 2;
  bm.update(1 / 60);
  out.boss = {
    eye: eye && [eye.r, eye.g, eye.b].map((v) => +v.toFixed(2)),
    ember: eye && eye.r > 0.8 && eye.g < 0.5 * eye.r && eye.b < 0.1,
    phase1: +p1.toFixed(2),
    phase2: +body.emissiveIntensity.toFixed(2),
    smoulder: [body.emissive.r, body.emissive.g, body.emissive.b].map((v) => +v.toFixed(2)),
  };
  b.reset();
  bm.update(1 / 60);
  // Mixers: a sleeping enemy 60–160 m away holds its pose; one nearby animates; the far one wakes when it is busy.
  const slime = window.arena2('slime', 5);
  const near = model(slime);
  const dist = (m) => Math.hypot(m.enemy.pos.x - p.pos.x, m.enemy.pos.z - p.pos.z);
  const far = g.enemies.models.find((m) => m.usingRig && m.enemy.state === 'idle' && Math.abs(m.enemy.pos.y - p.pos.y) < 40 && dist(m) > 70 && dist(m) < 150);
  const run = (n) => { for (let i = 0; i < n; i++) g.enemies.updateModels(1 / 60, p.pos); };
  run(3);
  const [f0, n0] = [far.rig.mixer.time, near.rig.mixer.time];
  run(10);
  const [f1, n1] = [far.rig.mixer.time, near.rig.mixer.time];
  far.enemy.state = 'return';
  run(5);
  const f2 = far.rig.mixer.time;
  far.enemy.reset();
  out.mixers = { far: +dist(far).toFixed(0), farHeld: f1 === f0, nearRan: n1 > n0, wakes: f2 > f1 };
  // Everyone back to their camps, frozen, for the checks that follow.
  for (const e of g.enemies.list) {
    e.home.copy(window.homes.get(e));
    e.reset();
    e.frozen = true;
  }
  p.respawn();
  return out;
});
{
  const deaths = ['wolf', 'skeleton', 'spider'].map((k) => s[k]);
  check('enemies: dead enemies play their death clip once and hold it', deaths.every((d) => d.state === 'dead' && d.clip === d.want && d.once), JSON.stringify(deaths));
  check('enemies: the Cinder Warden\'s eyes glow ember; phase 2 still smoulders', s.boss.ember && s.boss.phase1 === 0 && s.boss.phase2 > 0.1 && s.boss.smoulder[0] > s.boss.smoulder[1], JSON.stringify(s.boss));
  check('enemies: far sleeping enemies do not advance their mixers (near ones and busy far ones do)', s.mixers.farHeld && s.mixers.nearRan && s.mixers.wakes, JSON.stringify(s.mixers));
}

// 34d. Art fixes: the goblin's own colours, the boar's body, and locomotion clips whose feet stay planted
// (stride-matched speeds inside the limits; strafes while circling; the boss jogging near 1×).
s = await run2(() => {
  const g = window.game;
  const A = window.art;
  const p = g.player;
  const out = {};
  const model = (e) => g.enemies.models.find((x) => x.enemy === e);
  const mk = (kind) => g.enemies.models.find((x) => x.enemy.kind === kind && !x.enemy.summoner);
  // A texture's pixel in palette cell (column, row) of the KayKit 8 × 4 atlas, times the material colour.
  const cell = (mat, cx, cy) => {
    const img = mat.map.image;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0);
    const d = c.getImageData(Math.round(((cx + 0.4) * img.width) / 8), Math.round(((cy + 0.5) * img.height) / 4), 1, 1).data;
    return [d[0] * mat.color.r, d[1] * mat.color.g, d[2] * mat.color.b].map(Math.round);
  };
  const gob = mk('goblin');
  const ban = mk('bandit');
  const gm = gob.rig.node('Rogue_Head').material;
  const bm = ban.rig.node('Rogue_Head').material;
  const src = A.cloneModel('models/enemies/bandit.glb').getObjectByName('Rogue_Head').material;
  const [skin, tunic, bskin, btunic] = [cell(gm, 0, 0), cell(gm, 0, 1), cell(bm, 0, 0), cell(bm, 0, 1)];
  out.goblin = {
    skin, tunic,
    green: skin[1] > skin[0] * 1.15 && skin[1] > skin[2] * 1.3,
    clothesNotGreen: tunic[0] >= tunic[1] && cell(gm, 1, 1)[0] >= cell(gm, 1, 1)[1],
    ears: gob.rig.node('head').children.filter((o) => o.name.startsWith('Ear_')).length,
    crossbow: !!gob.rig.node('1H_Crossbow')?.visible,
  };
  // The bandit: the file's own texture and a white material, so it looks as it did.
  out.bandit = { skin: bskin, tunic: btunic, sameMap: bm.map === src.map, white: bm.color.getHex() === 0xffffff, ears: ban.rig.node('head').children.some((o) => o.name.startsWith('Ear_')) };
  // The boar: its own body (tusks, bristle ridge), nothing left of the bull's horns.
  const boar = mk('boar');
  const mats = new Set();
  const meshes = [];
  boar.rig.root.traverse((o) => {
    if (!o.isMesh || o.name.endsWith('_outline')) return;
    meshes.push(o.name);
    mats.add(o.material.name);
  });
  out.boar = { body: boar.art.body, meshes: meshes.join(), mats: [...mats].join(), horns: meshes.some((n) => /horn|cow|bull/i.test(n)) || [...mats].some((n) => /horn/i.test(n)) };
  // Locomotion at the AI's speeds (wander = 0.35 × speed, chase, return): the stride-matched clip speed
  // is inside the limits, so the played speed is the matched one (no cap reached).
  const drive = (e, m, v, frames = 20) => {
    const f = e.facingVector();
    e.state = 'chase';
    e.vel.copy(f).multiplyScalar(v);
    for (let i = 0; i < frames; i++) m.update(1 / 60);
    return { clip: m.loco.clip, want: +m.loco.want.toFixed(2), rate: +m.loco.rate.toFixed(2) };
  };
  for (const kind of ['slime', 'spider']) {
    const e = window.arena2(kind, 6);
    const m = model(e);
    const max = A.ENEMY_ART[kind].clipMax ?? 2.5;
    const chase = drive(e, m, e.stats.speed);
    const wander = drive(e, m, e.stats.speed * 0.35);
    out[kind] = { chase, wander, max, ok: [chase, wander].every((r) => r.want === r.rate && r.want <= max && r.want >= 0.4) };
    if (kind === 'slime') {
      // The hop's base stays put while down: the model leads and lags the collider by a few cm only.
      let lead = 0;
      drive(e, m, e.stats.speed, 1);
      for (let i = 0; i < 60; i++) {
        m.update(1 / 60);
        lead = Math.max(lead, m.rigBody.position.length());
      }
      out.slime.lead = +lead.toFixed(3);
      out.slime.ok &&= chase.clip === 'Jump' && wander.clip === 'Walk' && lead > 0.02 && lead < 0.2;
    }
    e.vel.set(0, 0, 0);
    e.reset();
  }
  // The boar's charge (12 m/s) gallops without sliding too (its own limit, 5.5).
  {
    const e = window.arena2('boar', 6);
    const m = model(e);
    e.state = 'active';
    e.stateTime = 0.2;
    e.vel.copy(e.facingVector()).multiplyScalar(e.stats.lunge);
    for (let i = 0; i < 10; i++) m.update(1 / 60);
    const ts = m.rig.actions.get('Gallop').timeScale;
    out.boarCharge = { clip: m.rig.clip, rate: +ts.toFixed(2), want: +(e.stats.lunge / (8.32 * A.ENEMY_ART.boar.scale)).toFixed(2) };
    e.reset();
  }
  // A bandit circling the player (its real AI, between attacks) plays a strafe and leans into it; it
  // turns back to face the player over its wind-up.
  {
    const e = window.arena2('bandit', 2.2, false);
    const m = model(e);
    e.state = 'chase';
    e.cooldown = 5;
    const clips = new Set();
    for (let i = 0; i < 45; i++) {
      p.hp = p.stats.maxHp;
      g.step(1);
      m.update(1 / 60);
      if (i > 20) clips.add(m.rig.clip);
    }
    out.circle = { clips: [...clips].join(), mode: m.loco.mode, rate: +m.loco.rate.toFixed(2), yaw: +m.yaw.toFixed(2), speed: +Math.hypot(e.vel.x, e.vel.z).toFixed(2) };
    e.frozen = true;
    e.state = 'windup';
    e.stateTime = 0;
    for (let i = 0; i < 20; i++) m.update(1 / 60);
    out.circle.windupYaw = +m.yaw.toFixed(3);
    e.reset();
  }
  // The Cinder Warden: the chase jogs near 1× (phase 1 and the faster phase 2); the charge runs.
  {
    const b = g.adventure.dungeon.boss;
    b.reset();
    b.frozen = true;
    const m = model(b);
    const p1 = drive(b, m, b.stats.speed, 30);
    b.phase = 2;
    const p2 = drive(b, m, b.stats.speed * b.rage(), 30);
    b.move = 'charge';
    b.state = 'active';
    b.stateTime = 0.2;
    b.vel.copy(b.facingVector()).multiplyScalar(b.stats.lunge);
    for (let i = 0; i < 10; i++) m.update(1 / 60);
    out.warden = { p1, p2, charge: { clip: m.rig.clip, rate: +m.rig.actions.get('Running_C').timeScale.toFixed(2) } };
    b.move = null;
    b.vel.set(0, 0, 0);
    b.reset();
    m.update(1 / 60);
  }
  for (const e of g.enemies.list) {
    e.home.copy(window.homes.get(e));
    e.reset();
    e.frozen = true;
  }
  p.respawn();
  return out;
});
check('enemies: the goblin has green skin, brown clothes and pointed ears (and its crossbow); the bandit keeps its own texture',
  s.goblin.green && s.goblin.clothesNotGreen && s.goblin.ears === 2 && s.goblin.crossbow && s.bandit.sameMap && s.bandit.white && !s.bandit.ears && s.bandit.tunic[1] > s.bandit.tunic[0],
  JSON.stringify({ goblin: s.goblin, bandit: s.bandit }));
check('enemies: the boar is its own model (tusks, bristle ridge), no bull horns left', s.boar.body === 'models/enemies/boar.glb' && !s.boar.horns && /Tusk/.test(s.boar.mats) && /Bristle/.test(s.boar.mats), JSON.stringify(s.boar));
check('enemies: slime and spider locomotion clips play at their stride-matched speed at chase and wander speeds (no cap reached); the slime hops with its base planted',
  s.slime.ok && s.spider.ok && s.boarCharge.clip === 'Gallop' && Math.abs(s.boarCharge.rate - s.boarCharge.want) < 0.01,
  JSON.stringify({ slime: s.slime, spider: s.spider, boarCharge: s.boarCharge }));
check('enemies: a circling bandit plays a strafe clip and leans into it; it faces the player again over its wind-up',
  /Running_Strafe_(Left|Right)/.test(s.circle.clips) && !/Walking_A|Running_A/.test(s.circle.clips) && ['left', 'right'].includes(s.circle.mode) && Math.abs(s.circle.yaw) > 0.2 && Math.abs(s.circle.yaw) < 0.9 && Math.abs(s.circle.windupYaw) < 0.05,
  JSON.stringify(s.circle));
check('enemies: the Cinder Warden\'s chase jogs near 1× in both phases; only its charge runs',
  [s.warden.p1, s.warden.p2].every((r) => r.clip === 'Running_B' && r.rate > 0.75 && r.rate < 1.3 && r.rate === r.want) && s.warden.charge.clip === 'Running_C' && s.warden.charge.rate < 2.5,
  JSON.stringify(s.warden));

// 34e. Art: town villagers (milestone 8). Every villager shows its rigged KayKit body, repainted, hatless, its
// parts joined into one mesh, feet on the ground, playing its role idle with its props; the files it shares with
// the player and the bandits keep their own look. A missing file keeps the placeholder. In a conversation the
// villager turns to the player and greets, gestures, then turns back to its idle; positions and prompts are as before.
s = await run2(async (miss) => {
  const g = window.game;
  const A = window.art;
  const a = g.adventure;
  const town = a.town;
  const p = g.player;
  const V = p.pos.constructor;
  const out = { npcs: {} };
  window.tp(0, 32);
  for (const n of town.npcs) n.model.update(1 / 60, p.pos, false, true);
  await A.modelsSettled();
  for (let i = 0; i < 30; i++) town.animate(i / 60, 1 / 60, p.pos);
  const mapName = (m) => m?.material?.map?.name ?? '';
  // Repainted maps are canvas copies of the file's texture (the file's own are images).
  const painted = (m) => !!m?.material?.map?.isCanvasTexture;
  for (const n of town.npcs) {
    const m = n.model;
    const art = A.NPC_ART[n.def.id];
    const meshes = [];
    m.rig?.root.traverse((o) => o.isMesh && !o.name.endsWith('_outline') && o.visible && meshes.push(o));
    const skinned = meshes.filter((o) => o.isSkinnedMesh);
    m.root.updateMatrixWorld(true);
    let lo = 1e9, hi = -1e9;
    for (const o of skinned) {
      for (let i = 0; i < o.geometry.attributes.position.count; i += 3) {
        const y = o.getVertexPosition(i, new V()).applyMatrix4(o.matrixWorld).y;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    out.npcs[n.def.id] = {
      rig: m.usingRig, blocky: m.blocky.visible, clip: m.rig?.clip, idle: art.idle,
      // One joined body mesh (the hats and other pack props gone), repainted.
      skinned: skinned.length, joined: skinned[0]?.name ?? '', painted: painted(skinned[0]),
      hats: ['Mage_Hat', 'Barbarian_Hat', 'Knight_Helmet', 'Knight_Cape', '1H_Axe', 'Knife', '2H_Staff', '1H_Sword'].filter((x) => m.rig?.node(x)).join(),
      props: meshes.filter((o) => !o.isSkinnedMesh).map((o) => o.name).join(','),
      held: (art.held ?? []).every((h) => !!m.rig?.root.getObjectByName(`held:${h.node}`)),
      kept: (art.props ?? []).every((x) => !!m.rig?.node(x)),
      station: m.station.children.length,
      height: +(hi - lo).toFixed(2), feet: +(lo - n.pos.y).toFixed(3),
    };
  }
  // The files shared with the player (barbarian) and the bandits keep their own texture.
  const playerBody = g.model.rig?.node('Barbarian_Body') ?? null;
  const playerMap = mapName(playerBody);
  const bandit = g.enemies.models.find((x) => x.enemy.kind === 'bandit');
  let banditBody = null;
  bandit.rig?.root.traverse((o) => o.isSkinnedMesh && !o.name.endsWith('_outline') && !banditBody && (banditBody = o));
  out.shared = { playerMap, banditMap: mapName(banditBody), player: !!playerBody && !painted(playerBody), bandit: !!banditBody && !painted(banditBody) };

  // A missing body or clips file keeps the placeholder, without throwing; so does a whole town of them.
  let threw = '';
  try {
    const def = town.npcs[0].def;
    const lone = [new A.NpcModel(def, { ...A.NPC_ART.elder, body: miss }, new V(0, 0, 0), 0), new A.NpcModel(def, { ...A.NPC_ART.hunter, clips: [miss] }, new V(0, 0, 0), 0)];
    const missingArt = Object.fromEntries(Object.entries(A.NPC_ART).map(([k, v]) => [k, { ...v, body: miss }]));
    const town2 = new town.constructor(g.world, town.ctx, missingArt);
    for (const x of lone) x.update(1 / 60, p.pos, false, true);
    town2.animate(0, 1 / 60, p.pos);
    await A.modelsSettled();
    for (let i = 0; i < 5; i++) {
      for (const x of lone) x.update(1 / 60, p.pos, false, true);
      town2.animate(i / 60, 1 / 60, p.pos);
    }
    out.missing = {
      state: A.modelState(miss), lone: lone.map((x) => `${x.usingRig ? 'rig' : 'blocky'}/${x.blocky.visible}`).join(),
      town: town2.npcs.map((n) => (n.model.usingRig ? 'rig' : n.model.blocky.visible ? 'blocky' : 'hidden')).join(),
      prompts: town2.npcs.map((n) => town2.interactables(n.pos).map((it) => it.label).join()).join('|'),
    };
  } catch (e) {
    threw = String(e);
  }
  out.missing = { ...out.missing, threw };

  // Positions and prompts: where they always stood, the same label, radius and colour, from 3 m in.
  const OLD = { elder: [6, -12], steward: [-14, 14], tinker: [16, 10], hunter: [-18, -6], scholar: [-2, -19], carpenter: [8, 16] };
  out.places = town.npcs.map((n) => {
    const [x, z] = OLD[n.def.id];
    const near = town.interactables(new V(n.pos.x + 2.5, n.pos.y, n.pos.z));
    const far = town.interactables(new V(n.pos.x + 3.1, n.pos.y, n.pos.z));
    const it = near[0];
    return n.pos.x === x && n.pos.z === z && Math.abs(n.pos.y - g.world.groundAt(x, z, 1e9)) < 1e-6 && n.root.position.equals(n.pos) &&
      near.length === 1 && it.pos === n.pos && it.radius === 2.6 && it.label === `Talk to ${n.def.name}` && it.color === '#ffd27a' && far.length === 0;
  }).join();

  // Conversation: the carpenter rests facing the square, hammering; the player comes up at his front-left.
  const n = town.npcs.find((x) => x.def.id === 'carpenter');
  const m = n.model;
  const off = m.homeYaw + 0.9;
  window.tp(n.pos.x - Math.sin(off) * 2.2, n.pos.z - Math.cos(off) * 2.2);
  const toPlayer = Math.atan2(-(p.pos.x - n.pos.x), -(p.pos.z - n.pos.z));
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) town.animate(i / 60, 1 / 60, p.pos); };
  const ang = (x) => +Math.abs(Math.atan2(Math.sin(x), Math.cos(x))).toFixed(3);
  run(1.5);
  out.talk = { before: { facing: ang(m.facing - m.homeYaw), clip: m.rig.clip, glance: +m.headYaw.toFixed(2), prompt: a.interactables().some((it) => it.label === 'Talk to Carpenter Bram') } };
  town.talk('carpenter');
  run(0.6);
  out.talk.greet = { talking: town.talkingTo, off: ang(m.facing - toPlayer), clip: m.rig.clip, phase: m.phase };
  run(2.7);
  out.talk.gesture = { off: ang(m.facing - toPlayer), clip: m.rig.clip, phase: m.phase };
  // The shop is part of the same conversation.
  window.pick('Buy furniture');
  run(0.3);
  out.talk.shop = { talking: town.talkingTo, off: ang(m.facing - toPlayer) };
  a.dialog.close();
  run(2);
  out.talk.after = { talking: town.talkingTo, facing: ang(m.facing - m.homeYaw), clip: m.rig.clip, phase: m.phase, pos: n.root.position.equals(n.pos) };
  // Another dialog (a campfire's) is not a conversation with a villager.
  a.campfireMenu(a.campfires.get('town'));
  run(0.5);
  out.talk.campfire = { talking: town.talkingTo, facing: ang(m.facing - m.homeYaw) };
  a.dialog.close();
  // Near the player a villager runs its mixer every frame with its outline and sun shadow on; past NPC_DETAIL_RANGE
  // it drops both and runs at half rate (same clip time); past NPC_ANIM_RANGE its mixer holds still.
  const mixT = () => m.rig.mixer.time;
  const look = () => {
    let outlines = 0, shown = 0, casters = 0;
    m.rig.root.traverse((o) => { if (!o.isMesh) return; if (o.name.endsWith('_outline')) { outlines++; if (o.visible) shown++; } else if (o.castShadow) casters++; });
    m.station.traverse((o) => { if (o.isMesh && !o.name.endsWith('_outline') && o.castShadow) casters++; });
    return `${m.detail}/${shown}of${outlines}/${casters}`;
  };
  let t0 = mixT();
  let updates = 0;
  const count = (sec) => { const f = m.rig.update.bind(m.rig); m.rig.update = (dt) => (updates++, f(dt)); run(sec); m.rig.update = f; };
  count(0.5);
  out.anim = { near: +(mixT() - t0).toFixed(2), nearUpdates: updates, nearLook: look() };
  window.tp(n.pos.x, n.pos.z + A.NPC_DETAIL_RANGE + 5);
  t0 = mixT();
  updates = 0;
  count(0.5);
  out.anim.mid = +(mixT() - t0).toFixed(2);
  out.anim.midUpdates = updates;
  out.anim.midLook = look();
  window.tp(n.pos.x, n.pos.z + A.NPC_ANIM_RANGE + 10);
  t0 = mixT();
  run(0.5);
  out.anim.far = +(mixT() - t0).toFixed(2);
  window.tp(n.pos.x, n.pos.z + 3);
  run(0.1);
  out.anim.backLook = look();
  window.tp(0, 32);
  return out;
}, MISSING_NPC);
{
  const v = Object.entries(s.npcs);
  check('villagers: all six show their rigged KayKit body (no placeholder), one joined mesh each, repainted, in their role idle',
    v.length === 6 && v.every(([, x]) => x.rig && !x.blocky && x.skinned === 1 && /^joined:/.test(x.joined) && x.painted && x.clip === x.idle),
    JSON.stringify(Object.fromEntries(v.map(([k, x]) => [k, `${x.rig}/${x.blocky}/${x.skinned}/${x.joined}/${x.painted}/${x.clip}`]))));
  check('villagers: hats and the packs\' weapons are gone; their own props are in hand (ledger, wrench, bow, book and glass, mallet and the crate)',
    v.every(([, x]) => x.hats === '' && x.held && x.kept) && s.npcs.carpenter.station === 1 && /Bow/.test(s.npcs.hunter.props) && /Spellbook_open/.test(s.npcs.scholar.props),
    JSON.stringify(Object.fromEntries(v.map(([k, x]) => [k, `${x.hats}|${x.props}|${x.held}/${x.kept}/${x.station}`]))));
  check('villagers: 1.5 to 1.9 m tall with their feet on the ground', v.every(([, x]) => x.height > 1.4 && x.height < 1.95 && Math.abs(x.feet) < 0.08),
    JSON.stringify(Object.fromEntries(v.map(([k, x]) => [k, `${x.height} m, feet ${x.feet}`]))));
  check('villagers: the player\'s and the bandits\' textures stay their own (the repaint is the villagers\' copy)', s.shared.player && s.shared.bandit && s.shared.playerMap !== '', JSON.stringify(s.shared));
  check('villagers: a missing body or clips file keeps the placeholder without throwing; a town of missing files keeps every placeholder and prompt',
    !s.missing.threw && s.missing.state === 'failed' && s.missing.lone === 'blocky/true,blocky/true' && s.missing.town === 'blocky,blocky,blocky,blocky,blocky,blocky' &&
    s.missing.prompts.split('|').every((l, i) => l === `Talk to ${['Elder Maren', 'Steward Ilsa', 'Tinker Oswin', 'Hunter Kael', 'Scholar Vey', 'Carpenter Bram'][i]}`),
    JSON.stringify(s.missing));
  check('villagers: positions and talk prompts are unchanged (same spots, label, radius, colour, 3 m reach)', s.places === 'true,true,true,true,true,true', s.places);
  const t = s.talk;
  check('villagers: at rest they face the square in their idle and glance at a player nearby; talking, they turn to the player and greet, then gesture',
    t.before.facing < 0.01 && t.before.clip === 'Hammering' && t.before.glance > 0.3 && t.before.prompt &&
    t.greet.talking === 'carpenter' && t.greet.clip === 'Waving' && t.greet.phase === 'greet' && t.greet.off < 0.35 &&
    t.gesture.off < 0.01 && t.gesture.clip === 'Interact' && t.gesture.phase === 'gesture' && t.shop.talking === 'carpenter' && t.shop.off < 0.01,
    JSON.stringify({ before: t.before, greet: t.greet, gesture: t.gesture, shop: t.shop }));
  check('villagers: after the conversation they turn back to their idle (and stay put); another dialog is not a conversation',
    t.after.talking === null && t.after.facing < 0.01 && t.after.clip === 'Hammering' && t.after.phase === 'none' && t.after.pos && t.campfire.talking === null && t.campfire.facing < 0.01,
    JSON.stringify({ after: t.after, campfire: t.campfire }));
  const lk = (x) => x.split('/');
  check('villagers: near the player they animate every frame with outline and shadow; past NPC_DETAIL_RANGE at half rate without either; past NPC_ANIM_RANGE not at all',
    s.anim.near > 0.45 && s.anim.nearUpdates === 30 && lk(s.anim.nearLook)[0] === 'true' && /^(\d+)of\1$/.test(lk(s.anim.nearLook)[1]) && Number(lk(s.anim.nearLook)[2]) > 0 &&
    Math.abs(s.anim.mid - s.anim.near) < 0.04 && s.anim.midUpdates === 15 && /^false\/0of\d+\/0$/.test(s.anim.midLook) && s.anim.far === 0 && s.anim.backLook === s.anim.nearLook,
    JSON.stringify(s.anim));
}

// 35. Regions and the map.
s = await run2(() => {
  const w = window.game.world;
  const r = (x, z) => w.regionAt(x, z);
  return {
    size: w.size,
    town: r(0, 0).id,
    meadow: `${r(60, 130).id}/${r(60, 130).level}`,
    forest: `${r(-150, -20).id}/${r(-150, -20).level}`,
    ruins: `${r(80, -170).id}/${r(80, -170).level}`,
    chunks: w.group.children.filter((c) => c.name === 'terrain').length,
    campfires: window.game.adventure.campfires.list.length,
    npcs: window.game.adventure.town.npcs.length,
  };
});
check('main map: 600 m, chunked (100 m terrain chunks), 4 regions with rising levels',
  s.size === 600 && s.chunks === 36 && s.town === 'town' && s.meadow.startsWith('meadow/') && s.forest.startsWith('forest/') && s.ruins.startsWith('ruins/') &&
  Number(s.forest.split('/')[1]) >= 5 && Number(s.ruins.split('/')[1]) >= 10,
  JSON.stringify(s));
check('7 campfires and 6 villagers', s.campfires === 7 && s.npcs === 6, `${s.campfires} / ${s.npcs}`);

// 35b. World models (milestone 8): every prop kind shows its model once the world file loads; the boxes they
// replace are hidden, never removed; vegetation is instanced (near pools + far LOD); a missing file keeps the
// old look; colliders, climbs, chests, campfires and the gate work as before.
s = await run2(async () => {
  const g = window.game;
  const A = window.art;
  const a = g.adventure;
  const w = g.world;
  const sc = g.scenery;
  await sc.loaded;
  await A.modelsSettled();
  g.step(0, null, true);
  const out = { ready: sc.ready, stats: sc.stats, colliders: window.colliderHash() };
  const tagged = w.blocks.filter((b) => b.spec.art);
  out.boxesHidden = `${tagged.filter((b) => !b.mesh.visible).length}/${tagged.length}`;
  out.groups = [...new Set(sc.group.children.map((c) => c.name.split(':').slice(0, 2).join(':')))].sort().join();
  out.treesHidden = w.treeMeshes.every((m) => !m.visible);
  // Every node the art tables name has its instanced kind.
  const want = new Set(['BoulderC']);
  for (const list of Object.values(A.TREE_ART)) for (const p of list) want.add(p.node);
  for (const layer of A.SCATTER_ART) for (const list of Object.values(layer.pieces)) for (const p of list) want.add(p.node);
  const kinds = sc.vegetation.meshes();
  out.vegMissing = [...want].filter((n) => !kinds.some((k) => k.node === n)).join();
  out.vegInstanced = kinds.every((k) => k.instanced);
  out.counts = sc.vegetation.counts;
  out.campfires = a.campfires.list.map((c) => `${c.pit.userData.model}:${c.pit.children[0]?.name}`).filter((x) => x !== 'true:Campfire').join();
  out.chests = a.chests.list.map((c) => `${c.tier}:${c.look.userData.model}:${c.look.children[0]?.name}`).filter((x) => x !== '0:true:chest:ChestBody' && x !== '1:true:chest:ChestGoldBody').join();
  const hm = g.home.shellModel;
  out.home = `${!!hm.body}/${!!hm.roof}/${!!hm.doorFront}/${!!hm.doorBack}/${g.home.shell.every((p) => !p.mesh.visible)}`;
  out.glider = `${g.model.gliderLook.userData.model}:${g.model.gliderLook.children[0]?.name}`;
  // The town's walls sit on their colliders: rays from 1 m out hit the model within 0.17 m of the box face
  // (posts, beams, sills and shingles stand proud by up to 0.16; nothing sinks in more than 5 cm).
  const town = sc.group.children.find((c) => c.name === 'scenery:town');
  const ruins = sc.group.children.find((c) => c.name === 'scenery:ruins');
  const gate = sc.group.children.find((c) => c.name === 'scenery:gate');
  const V = g.player.pos.constructor;
  const fit = (group, boxes, heights, skip = () => false) => {
    let worst = 0;
    let n = 0;
    let miss = 0;
    const rc = new A.Raycaster();
    const meshes = [];
    group.traverse((o) => o.isMesh && !o.name.endsWith('_outline') && meshes.push(o));
    for (const b of boxes) {
      const faces = [[b.maxX, 0, 1, 0, b.minZ, b.maxZ], [b.minX, 0, -1, 0, b.minZ, b.maxZ], [b.maxZ, 1, 0, 1, b.minX, b.maxX], [b.minZ, 1, 0, -1, b.minX, b.maxX]];
      for (const [plane, axisZ, sx, sz, lo, hi] of faces) {
        for (const ft of [0.2, 0.37, 0.63, 0.8]) {
          for (const y of heights(b)) {
            const t = lo + (hi - lo) * ft;
            const x = axisZ ? t : plane;
            const z = axisZ ? plane : t;
            const nx = axisZ ? 0 : sx;
            const nz = axisZ ? sz : 0;
            if (skip(x, y, z)) continue;
            rc.set(new V(x + nx, y, z + nz), new V(-nx, 0, -nz));
            rc.far = 1.4;
            const hit = rc.intersectObjects(meshes, false)[0];
            n++;
            if (!hit) {
              miss++;
              continue;
            }
            worst = Math.max(worst, Math.abs(1 - hit.distance));
          }
        }
      }
    }
    return `${n}/${miss}/${worst.toFixed(3)}`;
  };
  const houses = w.blocks.filter((b) => b.spec.art === 'house').map((b) => b.box);
  // Skip the door bay (door, step and lamp): the middle of the side that faces the square.
  const doors = houses.map((b) => {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const c = [[cx, b.maxZ, 0, 1], [b.maxX, cz, 1, 0], [cx, b.minZ, 0, -1], [b.minX, cz, -1, 0]];
    return c.sort((u, v) => (v[2] * -cx + v[3] * -cz) - (u[2] * -cx + u[3] * -cz))[0];
  });
  const door = (x, y, z) => doors.some(([dx, dz]) => Math.hypot(x - dx, z - dz) < 2.3);
  out.fitHouses = fit(town, houses, (b) => [b.minY + 1.4, b.minY + 2.2, b.minY + 3.6], door);
  out.fitColumns = fit(ruins, w.blocks.filter((b) => b.spec.art === 'column').map((b) => b.box).slice(0, 12), (b) => [b.maxY - 1.5, (b.maxY + b.minY) / 2 + 0.6]);
  // Ruin walls use KayKit's notched dungeon wall segments: sample the solid lower-mid body (not the broken parapet top).
  out.fitWalls = fit(ruins, w.blocks.filter((b) => b.spec.art === 'ruinWall').map((b) => b.box).slice(0, 12), (b) => [b.minY + (b.maxY - b.minY) * 0.45]);
  out.fitGate = fit(gate, w.blocks.filter((b) => b.spec.art === 'gatePillar').map((b) => b.box), (b) => [b.minY + 2.6, b.minY + 6.3]);
  // Trees stay clear of campfires, chests and enemy camp centres.
  const clearOf = (pts, r) => w.trees.every((t) => pts.every(([x, z]) => Math.hypot(t.x - x, t.z - z) >= r - 0.01));
  out.clearFires = clearOf(w.layout.campfires.map((c) => [c.x, c.z]), 6.5);
  out.clearChests = clearOf(w.layout.chests.map((c) => [c.x, c.z]), 6.5);
  out.clearCamps = clearOf(w.campCentres, 13.5);
  return out;
});
check('world models: town houses, the well, ruins, the gate, camp and town dressing replace the boxes (all tagged boxes hidden, none removed)',
  s.ready && s.stats.houses === 6 && s.stats.columns > 20 && s.stats.ruinWalls > 20 && s.stats.gate === 4 && s.stats.camps >= 19 && s.stats.campProps > 120 && s.stats.townProps > 10 &&
  s.boxesHidden.split('/')[0] === s.boxesHidden.split('/')[1] && s.groups.includes('scenery:town') && s.groups.includes('scenery:ruins') && s.groups.includes('scenery:gate') && s.groups.includes('scenery:camp'),
  JSON.stringify({ stats: s.stats, boxesHidden: s.boxesHidden, groups: s.groups }));
check('world models: every tree, bush, grass, pebble and rock kind is an instanced mesh; the cone trees are hidden; trees stay clear of campfires, chests and camps',
  s.treesHidden && s.vegMissing === '' && s.vegInstanced && s.counts.trees === 2700 && s.counts.grass > 3000 && s.counts.bush > 600 && s.counts.boulder > 200 && s.counts.crags === 36 && s.clearFires && s.clearChests && s.clearCamps,
  JSON.stringify({ vegMissing: s.vegMissing, counts: s.counts, clearFires: s.clearFires, clearChests: s.clearChests, clearCamps: s.clearCamps }));
check('world models: campfires, chests (gilded on tier 1), the home shell (with its locked door) and the glider show their models',
  s.campfires === '' && s.chests === '' && s.home === 'true/true/true/true/true' && s.glider === 'true:Glider', JSON.stringify({ campfires: s.campfires, chests: s.chests, home: s.home, glider: s.glider }));
check('world models: colliders unchanged (159 boxes, same hash as before the art pass)', s.colliders === mainColliders && mainColliders === '159/882569a5', `${s.colliders} / ${mainColliders}`);
const fitOk = (f, maxMiss = 0, maxDist = 0.17) => Number(f.split('/')[1]) <= maxMiss && Number(f.split('/')[2]) <= maxDist;
check('world models: climbable faces sit within 0.17 m of their colliders (houses, ruin columns and walls, gate pillars; raycast)',
  fitOk(s.fitHouses) && fitOk(s.fitColumns) && fitOk(s.fitWalls) && fitOk(s.fitGate), `houses ${s.fitHouses} columns ${s.fitColumns} walls ${s.fitWalls} gate ${s.fitGate} (rays/misses/worst m)`);

// Climbing a town house and a spire: same start, same top as before the art pass.
s = await run2(() => {
  const g = window.game;
  const p = g.player;
  const until = (input, done, limit) => {
    for (let i = 0; i < limit; i++) {
      g.step(1, input);
      if (done(p)) return i + 1;
    }
    return -1;
  };
  const place = (x, z) => {
    p.respawn();
    window.tp(x, z);
    g.cam.yaw = 0;
    p.facing = 0;
  };
  place(20, -11);
  const climb = until({ moveY: 1 }, (q) => q.state === 'climb', 120);
  const climbZ = p.pos.z;
  p.stamina = 100;
  const mantle = until({ moveY: 1 }, (q) => q.state === 'mantle', 600);
  g.step(40);
  const house = { climb, climbZ: +climbZ.toFixed(2), mantle, state: p.state, y: +p.pos.y.toFixed(2) };
  place(95, 97);
  const sClimb = until({ moveY: 1 }, (q) => q.state === 'climb', 300);
  p.stamina = 100;
  until({ moveY: 1 }, (q) => q.state === 'mantle' || q.state === 'air' || q.state === 'ground', 1200);
  g.step(40);
  const spire = { climb: sClimb, state: p.state, y: +p.pos.y.toFixed(2), top: +g.world.heightAt(95, 85).toFixed(2) };
  p.respawn();
  window.tp(0, 32);
  return { house, spire };
});
check('world models: climbing a town house wall still works (grabs the wall at z -13.65, mantles onto the eave at 10.5 m)',
  s.house.climb > 0 && Math.abs(s.house.climbZ + 13.65) < 0.05 && s.house.mantle > 0 && s.house.state === 'ground' && Math.abs(s.house.y - 10.5) < 0.05, JSON.stringify(s.house));
check('world models: climbing a rock spire still works (up to its top)', s.spire.climb > 0 && s.spire.state === 'ground' && s.spire.y > s.spire.top - 0.3, JSON.stringify(s.spire));

// Chests open (the model's lid swings up), campfires rest, the gate's prompt, the glider in flight, the vegetation near and far.
s = await run2(() => {
  const g = window.game;
  const A = window.art;
  const a = g.adventure;
  const p = g.player;
  const out = {};
  const chest = a.chests.list.find((c) => c.id === 'meadowRock');
  window.tp(chest.x, chest.z + 1.2);
  g.step(1);
  out.chestLabel = g.focus?.label;
  const drops = g.loot.drops.length;
  g.step(1, { held: ['interact'] });
  g.step(1);
  out.opened = a.chests.opened.has('meadowRock');
  out.loot = g.loot.drops.length > drops;
  out.lid = +chest.look.children[0].userData.lid.rotation.x.toFixed(2);
  const fire = a.campfires.get('mill');
  window.tp(fire.x, fire.z + 2);
  g.step(1);
  out.fireLabel = g.focus?.label;
  const gate = a.gatePos();
  window.tp(gate.x, gate.z);
  g.step(1);
  out.gateLabel = g.focus?.label;
  // Glider in flight.
  p.gliderUnlocked = true;
  window.tp(0, 32);
  p.pos.y += 30;
  p.state = 'air';
  p.vel.set(0, -2, 0);
  g.step(1, { held: ['jump'] });
  for (let i = 0; i < 20; i++) g.step(1, { moveY: 1 }, true);
  out.glide = `${p.state}/${g.model.gliderLook.userData.model}/${g.model.gliderLook.parent?.visible}`;
  p.respawn();
  window.tp(0, 32);
  // Vegetation at a dense spot in Gloamwood: full-detail pines near, the LOD for every tree far.
  window.tp(-160, -40);
  g.scenery.vegetation.update(p.pos, undefined, true);
  const k = g.scenery.vegetation.meshes();
  const near = (n) => k.find((x) => x.node === n)?.near ?? 0;
  out.nearPines = near('TreeForestA') + near('TreeForestB') + near('TreeForestD');
  out.nearRocks = near('BoulderB') + near('CragA') + near('PebbleA');
  out.nearTrees = k.filter((x) => x.node.startsWith('Tree')).reduce((t, x) => t + x.near, 0);
  out.farTrees = k.reduce((t, x) => t + x.far, 0);
  // Every tree within the far range shows exactly once: near (full detail) or far (LOD).
  out.inRange = g.world.trees.filter((t) => Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < A.TREE_FAR).length;
  out.nearInstanced = g.scenery.vegetation.group.children.filter((m) => m.visible).every((m) => m.isInstancedMesh);
  out.vegMeshes = g.scenery.vegetation.group.children.filter((m) => m.visible && m.layers.test(g.camera.layers)).length;
  // With the camera: the far pools keep only what is in view (and the shadow proxies only the shadow camera sees).
  g.cam.yaw = Math.PI / 2;
  g.step(1, null, true);
  out.farInView = g.scenery.vegetation.meshes().reduce((t, x) => t + x.far, 0);
  out.proxies = g.scenery.vegetation.group.children.filter((m) => m.name.endsWith(':shadow')).every((m) => m.castShadow && !m.layers.test(g.camera.layers));
  window.tp(0, 32);
  g.scenery.vegetation.update(p.pos, undefined, true);
  return out;
});
check('world models: a chest still opens with E (loot drops, the model\'s lid swings up); campfire rest and the dungeon gate prompts are unchanged',
  s.chestLabel === 'Open chest' && s.opened && s.loot && Math.abs(s.lid + 1.75) < 0.01 && s.fireLabel === 'Rest at Old Mill' && s.gateLabel === 'Examine the sealed door', JSON.stringify(s));
check('world models: the glider shows its model in flight', s.glide === 'glide/true/true', s.glide);
check('world models: trees and rocks are instanced (full detail near, LOD far: every tree in range exactly once; far pools trimmed to the view; LOD shadow proxies)',
  s.nearPines > 15 && s.nearRocks > 2 && s.nearTrees + s.farTrees === s.inRange && s.farTrees > 500 && s.farInView > 100 && s.farInView < s.farTrees && s.proxies && s.nearInstanced && s.vegMeshes <= 20,
  JSON.stringify({ nearPines: s.nearPines, nearRocks: s.nearRocks, nearTrees: s.nearTrees, farTrees: s.farTrees, inRange: s.inRange, farInView: s.farInView, proxies: s.proxies, vegMeshes: s.vegMeshes }));

// A missing world file keeps the old look (boxes, cone trees, procedural campfires, chests, glider and home shell), without throwing.
s = await run2(async (miss) => {
  const g = window.game;
  const A = window.art;
  const a = g.adventure;
  let threw = '';
  const out = {};
  try {
    const w2 = new A.World(A.TEST_LAYOUT);
    const sc2 = new A.Scenery(w2, miss);
    const fires = new a.campfires.constructor(g.world, miss);
    const chests = new a.chests.constructor(g.world, miss);
    const pm = new A.PlayerModel(A.HUMANOID.bodies, A.HUMANOID.clips, miss);
    const home2 = new g.home.constructor(w2, g.ui, { book() {}, sleep() {}, furnish() {}, bench() {}, message() {} }, miss);
    await sc2.loaded;
    await A.modelsSettled();
    fires.animate(1);
    chests.opened.add(chests.list[0].id);
    chests.sync();
    sc2.update(g.player.pos);
    Object.assign(out, {
      state: A.modelState(miss), ready: sc2.ready, boxes: w2.blocks.every((b) => b.mesh.visible), trees: w2.treeMeshes.every((m) => m.visible),
      scenery: sc2.group.children.length === 1 && sc2.vegetation.group.children.length === 0,
      fires: fires.list.every((c) => c.pit.userData.model === false && c.pit.children[0].name === 'campfire:procedural'),
      chests: chests.list.every((c) => c.look.children[0].name === 'chest:procedural') && chests.list[0].look.children[0].userData.lid.rotation.x < -1,
      glider: pm.gliderLook.children[0].name === 'glider:procedural',
      home: home2.shellModel.body === null && home2.shell.every((p) => p.mesh.visible),
    });
  } catch (e) {
    threw = String(e);
  }
  return { ...out, threw };
}, MISSING_WORLD);
check('world models: a missing world file keeps the boxes, cone trees, procedural campfires, chests, glider and home shell, without throwing',
  !s.threw && s.state === 'failed' && !s.ready && s.boxes && s.trees && s.scenery && s.fires && s.chests && s.glider && s.home, JSON.stringify(s));

// 36. Region enemies: levels and attack styles.
s = await run2(() => {
  const g = window.game;
  const L = g.enemies.list;
  const lv = (k) => L.filter((e) => e.kind === k).map((e) => e.level);
  const out = { wolf: Math.min(...lv('wolf')), skeleton: Math.min(...lv('skeleton')), golem: Math.min(...lv('golem')), total: L.length };
  const sk = L.find((e) => e.kind === 'skeleton');
  out.scaled = sk.maxHp > 90 || sk.level === 10;
  // Goblin archer shoots from range.
  let e = window.arena2('goblin', 12, false);
  const p = g.player;
  let arrows = 0;
  for (let i = 0; i < 300 && p.hp === p.stats.maxHp; i++) {
    g.step(1);
    arrows = Math.max(arrows, g.projectiles.list.filter((x) => x.kind === 'arrow').length);
  }
  out.arrow = `${arrows}/${p.stats.maxHp - p.hp}/${Math.round(e.pos.distanceTo(p.pos))}`;
  // Spider poisons.
  e = window.arena2('spider', 5, false);
  for (let i = 0; i < 300 && p.poisonTime <= 0; i++) g.step(1);
  out.poison = p.poisonTime > 0;
  // Golem slam hits all around it.
  e = window.arena2('golem', 4, false);
  p.respawn();
  window.tp(0, 32);
  for (let i = 0; i < 400 && p.hp === p.stats.maxHp; i++) g.step(1);
  out.slam = `${p.stats.maxHp - p.hp}/${p.state}`;
  // Cultist orbs.
  e = window.arena2('cultist', 12, false);
  let orbs = 0;
  for (let i = 0; i < 400 && p.hp === p.stats.maxHp; i++) {
    g.step(1);
    orbs = Math.max(orbs, g.projectiles.list.filter((x) => x.kind === 'orb').length);
  }
  out.orb = `${orbs}/${p.stats.maxHp - p.hp}`;
  return out;
});
check('enemy levels follow the regions', s.wolf >= 5 && s.skeleton >= 10 && s.golem >= 12 && s.total > 50, JSON.stringify(s));
check('goblin archers shoot arrows from range', Number(s.arrow.split('/')[0]) > 0 && Number(s.arrow.split('/')[1]) > 0, s.arrow);
check('spiders poison', s.poison);
check('golem slam hits hard', Number(s.slam.split('/')[0]) >= 30, s.slam);
check('cultists throw magic orbs', Number(s.orb.split('/')[0]) > 0 && Number(s.orb.split('/')[1]) > 0, s.orb);

// 37. Campfires: discover, rest (heal, respawn point, world reset), fast travel; death drops gold.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const p = g.player;
  window.arena2('slime', 40);
  const fields = a.campfires.get('fields');
  window.tp(fields.x + 4, fields.z);
  g.step(2);
  const found = a.campfires.discovered.has('fields');
  const slime = g.enemies.list.find((e) => e.kind === 'slime');
  slime.takeHit({ damage: 999, poise: 0, knockback: 0, from: slime.pos.clone() }, []);
  p.hp = 10;
  window.tp(fields.x, fields.z + 2);
  g.step(1);
  const label = g.focus?.label;
  a.campfireMenu(fields);
  window.pick('Rest');
  const rested = { hp: p.hp === p.stats.maxHp, respawn: p.respawnPoint.distanceTo(fields.pos) < 3, slime: slime.alive };
  a.campfireMenu(fields);
  const travelled = window.pick('Travel to Town Square');
  const atTown = Math.hypot(p.pos.x, p.pos.z - 5) < 4;
  // Death: lose a fifth of your gold where you fell, respawn at the campfire.
  window.tp(30, 60);
  p.inv.gold = 100;
  p.hp = 1;
  p.takeHit({ damage: 50, poise: 0, knockback: 0, from: p.pos.clone() });
  g.step(1);
  const pile = g.loot.drops.find((d) => d.kind === 'gold' && d.persistent);
  const gold = p.inv.gold;
  g.step(170);
  return { found, label, rested, travelled, atTown, gold, pile: pile?.amount, back: p.pos.distanceTo(fields.pos) < 4 };
});
check('walking near a campfire discovers it', s.found && s.label === 'Rest at Sunny Fields', s.label);
check('resting heals, sets respawn and resets the world', s.rested.hp && s.rested.respawn && s.rested.slime, JSON.stringify(s.rested));
check('fast travel between discovered campfires', s.travelled && s.atTown);
check('dying drops 20% of your gold where you fell', s.gold === 80 && s.pile === 20, `gold=${s.gold} pile=${s.pile}`);
check('you respawn at your last campfire', s.back);

// 38. Quests: accept, progress, hand in; the house; the glider.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const p = g.player;
  const out = {};
  window.arena2('slime', 40);
  g.chooseClass('warrior');
  a.startFresh();
  for (const e of g.enemies.list) e.frozen = true;
  window.talk('elder');
  out.offer = a.dialog.current.options.map((o) => o.label).join('|');
  window.pick('Quest: Slime Trouble');
  window.pick('Accept');
  out.active = a.quests.status('slimes');
  window.killAll('slime', 6);
  out.tracker = a.quests.tracker(a.owner()).join(' ');
  const gold0 = p.inv.gold;
  window.talk('elder');
  out.handin = window.pick('Hand in: Slime Trouble');
  out.reward = p.inv.gold - gold0;
  out.done = a.quests.status('slimes');
  a.dialog.close();
  // The house: locked until bought from the steward.
  const h = g.home;
  window.tp(h.door.x, h.door.z);
  g.step(1);
  out.locked = g.focus?.label;
  p.inv.gold = 200;
  window.talk('steward');
  window.pick('Quest: A Roof of Your Own');
  window.pick('Accept');
  window.talk('steward');
  window.pick('Hand in');
  a.dialog.close();
  out.owned = h.owned;
  out.goldLeft = p.inv.gold;
  window.tp(h.door.x, h.door.z);
  g.cam.yaw = 0;
  window.until = (input, done, limit) => {
    for (let i = 0; i < limit; i++) {
      g.step(1, input);
      if (done()) return i + 1;
    }
    return -1;
  };
  out.walkIn = window.until({ moveY: 1 }, () => p.pos.z < g.world.homeSite.z + 2, 240) > 0;
  // The glider: needs the slime quest, cloth and hide.
  out.gliderBefore = p.gliderUnlocked;
  p.inv.materials.cloth = 4;
  p.inv.materials.hide = 3;
  window.talk('tinker');
  window.pick('Quest: Wings of Cloth');
  window.pick('Accept');
  window.talk('tinker');
  window.pick('Hand in');
  a.dialog.close();
  out.gliderAfter = p.gliderUnlocked;
  out.matsLeft = `${p.inv.materials.cloth}/${p.inv.materials.hide}`;
  // Level-gated quest hint.
  window.talk('scholar');
  out.hint = a.dialog.current.text.includes('Come back at level 10');
  a.dialog.close();
  return out;
});
check('the elder offers a quest', s.offer.includes('Quest: Slime Trouble'), s.offer);
check('kill quest tracks progress and pays out', s.active === 'active' && /6\/6/.test(s.tracker) && s.handin && s.reward === 50 && s.done === 'done', JSON.stringify(s));
check('the house is locked until bought (150 gold)', /Locked house/.test(s.locked ?? '') && s.owned && s.goldLeft === 50 && s.walkIn, `${s.locked} owned=${s.owned} gold=${s.goldLeft} in=${s.walkIn}`);
check('the glider quest unlocks the glider', !s.gliderBefore && s.gliderAfter && s.matsLeft === '0/0', `${s.gliderBefore}->${s.gliderAfter} mats=${s.matsLeft}`);
check('villagers hint at later quests', s.hint);

// 39. Home: bed, furniture, expansion; exploration chests.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const p = g.player;
  const h = g.home;
  const out = {};
  window.tp(h.bedPos.x - 1.2, h.bedPos.z, h.floorY + 0.3);
  p.hp = 5;
  g.step(1);
  out.bedLabel = g.focus?.label;
  a.sleep();
  out.slept = p.hp === p.stats.maxHp && p.respawnPoint.distanceTo(h.bedPos) < 2;
  // Furniture: buy a table from the carpenter, place it inside.
  p.inv.gold = 100;
  window.talk('carpenter');
  window.pick('Buy furniture');
  window.pick('Oak Table');
  a.dialog.close();
  out.stock = h.stock.table;
  window.tp(g.world.homeSite.x, g.world.homeSite.z + 1, h.floorY + 0.3);
  p.facing = 0;
  a.startPlacing('table');
  g.step(1);
  window.game.step(1, { held: ['attack'] });
  out.placed = h.placed.length;
  out.placing = !!a.placing;
  // Expansion opens the back room.
  out.backBefore = h.inside(g.world.homeSite.x, g.world.homeSite.z - 8);
  h.expand();
  out.backAfter = h.inside(g.world.homeSite.x, g.world.homeSite.z - 8);
  // A spire chest: rare-or-better loot, once.
  const c = a.chests.list.find((x) => x.tier === 1);
  window.tp(c.x + 1, c.z);
  p.pos.y = c.pos.y;
  g.step(1);
  out.chestLabel = g.focus?.label;
  const before = g.loot.drops.length;
  a.openChest(c);
  const items = g.loot.drops.slice(before).filter((d) => d.kind === 'item');
  out.loot = items.map((d) => d.item.rarity).join(',');
  g.step(1);
  out.again = g.focus?.label === 'Open chest';
  return out;
});
check('sleeping in your bed heals and sets respawn', s.slept && /Sleep/.test(s.bedLabel ?? ''), s.bedLabel);
check('buy furniture and place it in your home', s.stock === 1 && s.placed === 1 && !s.placing, JSON.stringify(s));

check('the expansion opens the back room', !s.backBefore && s.backAfter);
check('spire chests hold rare+ loot and open once', s.chestLabel === 'Open chest' && /^(rare|epic|legendary),/.test(s.loot) && !s.again, `${s.chestLabel} ${s.loot}`);

// 39b. The carpenter's shop and the furniture crate show a picture of each piece drawn from its model (milestone 8).
s = await run2(async () => {
  const g = window.game;
  const a = g.adventure;
  const A = window.art;
  await A.modelsSettled();
  const types = Object.keys(A.FURNITURE);
  const pics = () => [...document.querySelectorAll('.dialog-options img.dialog-icon')].map((i) => i.getAttribute('src'));
  const want = types.map((t) => A.furnitureIcon(g.renderer, t));
  g.player.inv.gold = 1000;
  a.town.shop();
  const shop = pics();
  for (const t of types) g.home.buy(t);
  a.furnish();
  const crate = pics();
  a.dialog.close();
  for (const t of types) g.home.stock[t]--;
  return {
    models: want.filter((w) => w.model && w.src.startsWith('data:image/png')).length,
    shop: shop.length === types.length && shop.every((src, i) => src === want[i].src),
    crate: crate.length === types.length && want.every((w) => crate.includes(w.src)),
    // The picture is not empty: some pixels are drawn (alpha) — checked on one decoded image.
    drawn: await new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const cx = cv.getContext('2d');
        cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, im.width, im.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        res(n / (im.width * im.height));
      };
      im.src = want[0].src;
    }),
  };
});
check('the furniture shop and the crate show a picture of every piece drawn from its model',
  s.models === 8 && s.shop && s.crate && s.drawn > 0.1, JSON.stringify(s));

// 40. Saving: 4 slots in IndexedDB, load restores everything, export format validates.
s = await run2(async () => {
  const g = window.game;
  const a = g.adventure;
  const p = g.player;
  a.slot = 0;
  p.inv.gold = 321;
  p.inv.add(window.items.makeItem('ironSword', 'epic', 3));
  const display = window.items.makeItem('greatsword', 'rare');
  g.home.spots[0].item = display;
  await a.saveNow();
  const saved = await a.store.load();
  const slot = saved.slots[0];
  // Change things, then load the slot back.
  p.inv.gold = 1;
  p.inv.bag.fill(null);
  a.quests.load({});
  a.play(0);
  let bad = '';
  try {
    window.items.validateAccount({});
  } catch (e) {
    bad = 'threw';
  }
  return {
    slots: saved.slots.length,
    cls: slot?.cls,
    gold: p.inv.gold,
    sword: p.inv.bag.some((x) => x?.base === 'ironSword' && x.rarity === 'epic'),
    quests: a.quests.status('slimes') + '/' + a.quests.status('house'),
    home: `${saved.home.owned}/${saved.home.displays[0]?.base}/${saved.home.placed.length}`,
    glider: p.gliderUnlocked,
    bad,
  };
});
check('save: 4 slots in IndexedDB with the shared home', s.slots === 4 && s.cls === 'warrior' && s.home === 'true/greatsword/1', JSON.stringify(s));
check('load restores gold, items, quests and the glider', s.gold === 321 && s.sword && s.quests === 'done/done' && s.glider, JSON.stringify(s));
check('a broken save file is rejected', s.bad === 'threw');

// 41. Title screen: slots, new character, region banner, map.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  a.slotSelect.show(a.account);
  const cards = document.querySelectorAll('.slots .classcard').length;
  a.create(1);
  const picking = g.classSelect.visible;
  document.querySelectorAll('.classpick:not(.slots) .classcard')[3].click();
  const out = { cards, picking, slot: a.slot, cls: g.player.cls, menu: g.menuOpen };
  // Region banner when walking out of town.
  window.tp(0, 30);
  g.step(1);
  window.tp(60, 130);
  g.step(1, null, true);
  out.banner = document.querySelector('#banner b').textContent;
  g.map.toggle(true);
  out.map = g.menuOpen && document.querySelector('.bigmap').style.display === '';
  g.map.toggle(false);
  out.mini = document.querySelector('.minimap').style.display !== 'none';
  return out;
});
check('title screen shows 4 slots; new character goes through class pick', s.cards === 4 && s.picking && s.slot === 1 && s.cls === 'assassin' && !s.menu, JSON.stringify(s));
check('entering a region shows its name', s.banner === 'Sunmeadow', s.banner);
check('minimap and M map', s.map && s.mini);

// ================================================================ dungeon (milestone 6)
// 4x. The sealed gate opens after "The Sealed Door"; inside it is dark and the walls can't be climbed.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const d = a.dungeon;
  for (const e of g.enemies.list) {
    e.home.copy(window.homes.get(e));
    e.reset();
    e.frozen = true;
  }
  g.chooseClass('warrior');
  a.startFresh();
  const out = { enemies: d.enemies.length, boss: d.boss.kind };
  const gate = a.gatePos();
  window.tp(gate.x, gate.z);
  g.step(1);
  out.sealed = g.focus?.label;
  g.step(1, { held: ['interact'] });
  out.stillOutside = !d.contains(g.player.pos);
  a.quests.states.sealed = { status: 'done', progress: [1] };
  g.step(1);
  out.open = g.focus?.label;
  g.focus.act();
  g.step(2, null, true);
  out.inside = d.contains(g.player.pos);
  out.region = a.region.name;
  out.banner = document.querySelector('#banner b').textContent;
  out.dark = g.interior && g.scene.fog.far < 100;
  // Push into the west wall of the entry hall for a second: no climbing.
  const p = g.player;
  const e = d.entryPoint();
  window.tp(e.x - 6.5, e.z, e.y + 1);
  g.cam.yaw = Math.PI / 2; // facing -x (west)
  let climbed = false;
  for (let i = 0; i < 60; i++) {
    g.step(1, { moveY: 1 });
    if (p.state === 'climb' || p.state === 'mantle') climbed = true;
  }
  out.climbed = climbed;
  out.wallX = Math.round((p.pos.x - e.x) * 10) / 10;
  g.map.toggle(true);
  g.step(3, null, true);
  out.vaultMap = document.querySelector('.bigmap canvas').height > document.querySelector('.bigmap canvas').width;
  g.map.toggle(false);
  return out;
});
check('dungeon: 6 enemies + the Cinder Warden spawn inside', s.enemies === 7 && s.boss === 'warden', JSON.stringify(s));
check('dungeon: the gate stays sealed until "The Sealed Door" is done', s.sealed === 'Examine the sealed door' && s.stillOutside && s.open === 'Enter the Ember Vault', JSON.stringify(s));
check('dungeon: entering takes you inside (banner, dark lighting)', s.inside && s.region === 'The Ember Vault' && s.banner === 'The Ember Vault' && s.dark, JSON.stringify(s));
check('dungeon walls cannot be climbed', !s.climbed && s.wallX <= -7.4, JSON.stringify(s));
check('dungeon floor plan on the M map', s.vaultMap, JSON.stringify(s));

// 4x. Pressure plate + push block.
s = await run2(() => {
  const g = window.game;
  const d = g.adventure.dungeon;
  const w = g.world;
  const door = d.doors.get('plateDoor');
  const out = { shut: w.hasCollider(door.box) };
  const plate = d.spot('plate');
  window.tp(plate.x, plate.z, plate.y + 1);
  g.step(2);
  out.standing = !w.hasCollider(door.box);
  window.tp(plate.x - 4, plate.z + 5, plate.y + 1);
  g.step(2);
  out.stepOff = w.hasCollider(door.box);
  // Push from the west side, three times.
  const pushes = [];
  for (let i = 0; i < 3; i++) {
    const c = d.blockCentre();
    window.tp(c.x - 1.4, c.z, c.y + 1);
    g.step(1);
    pushes.push(g.focus?.label);
    g.focus.act();
    g.step(30);
  }
  out.pushes = pushes.join(',');
  out.onPlate = d.blockOnPlate();
  out.solved = d.solved.has('plate');
  window.tp(plate.x - 4, plate.z + 5, plate.y + 1);
  g.step(2);
  out.open = !w.hasCollider(door.box);
  // The block can't be pushed out of the room.
  return out;
});
check('pressure plate opens its door only while pressed', s.shut && s.standing && s.stepOff, JSON.stringify(s));
check('push block slides onto the plate and keeps the door open', s.pushes === 'Push block,Push block,Push block' && s.onPlate && s.solved && s.open, JSON.stringify(s));

// 4x. Hit-switch crystal: melee swing over the railing, or a projectile.
s = await run2(() => {
  const g = window.game;
  const d = g.adventure.dungeon;
  const w = g.world;
  const p = g.player;
  const c = d.crystalPos();
  const door = d.doors.get('crystalDoor');
  const out = { shut: w.hasCollider(door.box) };
  window.tp(c.x + 1.95, c.z, c.y - 1);
  p.facing = Math.atan2(1, 0); // face -x
  g.cam.yaw = p.facing;
  g.step(1, { held: ['attack'] });
  g.step(40);
  out.melee = d.solved.has('crystal');
  out.open = !w.hasCollider(door.box);
  // Projectile: reset and shoot a bolt at it from across the room.
  d.solved.delete('crystal');
  d.sync();
  const from = c.clone().add(new THREE_V(8, 0, 0));
  g.projectiles.spawn({ kind: 'bolt', from, vel: new THREE_V(-30, 0, 0), damage: 5, crit: false, poise: 0, knockback: 0, life: 1 });
  g.step(30);
  out.bolt = d.solved.has('crystal');
  return out;
  function THREE_V(x, y, z) {
    return p.pos.clone().set(x, y, z);
  }
});
check('hit-switch: striking the crystal over the railing opens the east door', s.shut && s.melee && s.open, JSON.stringify(s));
check('hit-switch: a projectile also triggers it', s.bolt, JSON.stringify(s));

// 4x. Small key and the locked door.
s = await run2(() => {
  const g = window.game;
  const d = g.adventure.dungeon;
  const w = g.world;
  const p = g.player;
  const door = d.doors.get('lockDoor');
  const lock = d.spot('lockDoor');
  window.tp(lock.x, lock.z + 1.5, lock.y + 1);
  g.step(1);
  const out = { label: g.focus?.label };
  g.focus.act();
  out.stillShut = w.hasCollider(door.box);
  const kc = d.spot('keyChest');
  window.tp(kc.x, kc.z + 1.2, kc.y + 1);
  g.step(1);
  out.chest = g.focus?.label;
  g.focus.act();
  out.keys = d.keys;
  window.tp(lock.x, lock.z + 1.5, lock.y + 1);
  g.step(1);
  out.label2 = g.focus?.label;
  g.focus.act();
  out.open = !w.hasCollider(door.box);
  out.keysAfter = d.keys;
  return out;
});
check('locked door needs the small key from the side room', s.label === 'Locked door' && s.stillShut && s.chest === 'Open chest' && s.keys === 1, JSON.stringify(s));
check('the key opens the door and is used up', s.label2 === 'Unlock door (Small Key)' && s.open && s.keysAfter === 0, JSON.stringify(s));

// 4x. Timed lever: walking is too slow, sprinting makes it.
s = await run2(() => {
  const g = window.game;
  const d = g.adventure.dungeon;
  const w = g.world;
  const p = g.player;
  const door = d.doors.get('timedDoor');
  const lever = d.spot('lever');
  const run = (held) => {
    p.respawn();
    window.tp(lever.x - 1.5, lever.z, lever.y + 1);
    g.cam.yaw = 0;
    p.facing = 0;
    g.step(1);
    const label = g.focus?.label;
    g.focus.act();
    g.step(1);
    const opened = !w.hasCollider(door.box);
    window.tp(0 + lever.x - 2, lever.z - 1, lever.y + 1);
    for (let i = 0; i < 60 * 9 && !d.solved.has('timed'); i++) g.step(1, { moveY: 1, held });
    g.step(60 * 3);
    return { label, opened, solved: d.solved.has('timed'), shut: w.hasCollider(door.box), z: Math.round(p.pos.z - lever.z) };
  };
  const walk = run([]);
  const sprint = run(['dodge']);
  return { walk, sprint, timer: d.timer };
});
check('timed lever opens the far gate, which shuts again if you walk', s.walk.label === 'Pull lever' && s.walk.opened && !s.walk.solved && s.walk.shut, JSON.stringify(s));
check('sprinting through in time keeps the gate open', s.sprint.solved && !s.sprint.shut, JSON.stringify(s));

// 4x. Brazier, saving dungeon progress, and a fresh character starting over.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const d = a.dungeon;
  const p = g.player;
  const br = d.spot('brazier');
  window.tp(br.x, br.z + 1.5, br.y + 1);
  g.step(1);
  const out = { label: g.focus?.label };
  p.hp = 10;
  g.focus.act();
  out.healed = p.hp === p.stats.maxHp;
  out.respawnInside = d.contains(p.respawnPoint);
  p.takeHit({ damage: 99999, poise: 0, knockback: 0, from: p.pos.clone() });
  g.step(60 * 4);
  out.wokeAtBrazier = d.contains(p.pos) && p.pos.distanceTo(br) < 4;
  const save = a.serialize();
  out.saved = [...save.dungeon.solved].sort().join(',');
  out.brazier = save.dungeon.brazier;
  a.startFresh();
  out.fresh = d.solved.size === 0 && g.world.hasCollider(d.doors.get('lockDoor').box) && !d.blockOnPlate();
  a.apply(save);
  out.restored = d.solved.size === save.dungeon.solved.length && d.blockOnPlate() && !g.world.hasCollider(d.doors.get('timedDoor').box);
  out.valid = !!window.items.validateAccount({ version: 1, home: null, slots: [save] }).slots[0].dungeon;
  return out;
});
check('brazier heals and becomes the respawn point', s.label === 'Light the brazier' && s.healed && s.respawnInside && s.wokeAtBrazier, JSON.stringify(s));
check('dungeon progress is saved per character', s.saved === 'crystal,keychest,lock,plate,timed' && s.brazier && s.fresh && s.restored && s.valid, JSON.stringify(s));

// 4x. The Cinder Warden: two phases, adds, its own loot, the quest.
s = await run2(() => {
  const g = window.game;
  const a = g.adventure;
  const d = a.dungeon;
  const p = g.player;
  const b = d.boss;
  window.levelTo(15);
  p.respawn();
  a.quests.accept('warden');
  for (const e of g.enemies.list) e.frozen = true;
  b.reset();
  b.frozen = false;
  const home = b.pos.clone();
  window.tp(home.x, home.z + 9, home.y + 1);
  g.cam.yaw = 0;
  const out = {};
  let hurt = false;
  const moves = new Set();
  for (let i = 0; i < 60 * 12; i++) {
    p.hp = p.stats.maxHp;
    p.stamina = p.stats.maxStamina;
    const before = p.hp;
    g.step(1);
    if (p.hp < before) hurt = true;
    if (b.move) moves.add(b.move);
  }
  // The camera eases after a teleport; snap it so the bar's 50 m camera range does not depend on
  // how many background frames happened to run.
  g.cam.initialised = false;
  g.step(0, null, true);
  out.hurt = hurt;
  out.moves1 = [...moves].sort().join(',');
  out.bar = document.querySelector('#bossbar').style.display === '' && document.querySelector('#bossbar b').textContent;
  // Knock it below half: it roars (untouchable) and calls two skeletons.
  b.takeHit({ damage: Math.ceil(b.hp - b.maxHp * 0.49), poise: 0, knockback: 0, from: p.pos.clone() }, []);
  out.phase = `${b.phase}/${b.state}`;
  const hp = b.hp;
  b.takeHit({ damage: 100, poise: 0, knockback: 0, from: p.pos.clone() }, []);
  out.roarImmune = b.hp === hp;
  g.step(Math.ceil(1.7 * 60));
  out.adds = g.enemies.list.filter((e) => e.summoner === b).length;
  for (const e of g.enemies.list) if (e.summoner === b) e.frozen = true;
  moves.clear();
  for (let i = 0; i < 60 * 25; i++) {
    p.hp = p.stats.maxHp;
    g.step(1);
    if (b.move) moves.add(b.move);
  }
  out.moves2 = [...moves].sort().join(',');
  g.cam.initialised = false;
  g.step(0, null, true);
  out.bar2 = document.querySelector('#bossbar b').textContent;
  // Kill it.
  b.takeHit({ damage: 1e6, poise: 0, knockback: 0, from: p.pos.clone() }, []);
  g.step(2);
  const drops = g.loot.drops;
  out.rare = drops.filter((x) => x.kind === 'item' && ['epic', 'legendary'].includes(x.item.rarity)).length;
  out.ember = drops.some((x) => x.kind === 'material' && x.material === 'ember') || (p.inv.materials.ember ?? 0) > 0;
  out.quest = a.quests.ready(a.quests.active().find((q) => q.id === 'warden'), a.owner());
  for (const e of g.enemies.list) if (e.summoner === b) e.takeHit({ damage: 1e6, poise: 0, knockback: 0, from: p.pos.clone() }, []);
  g.step(60 * 4);
  out.addsGone = g.enemies.list.filter((e) => e.summoner === b).length;
  const ex = d.spot('exitG');
  window.tp(ex.x, ex.z, ex.y + 1);
  g.step(1);
  out.exit = g.focus?.label;
  g.focus.act();
  g.step(2);
  out.outside = !d.contains(p.pos) && !g.interior;
  return out;
});
check('Cinder Warden attacks (sweep / slam / charge) and hurts', s.hurt && s.moves1.length > 0 && !s.moves1.includes('volley') && !s.moves1.includes('nova'), JSON.stringify(s));
check('boss health bar at the top', s.bar === 'The Cinder Warden', JSON.stringify(s));
check('phase 2 at half health: untouchable roar, two skeleton adds', s.phase === '2/phase' && s.roarImmune && s.adds === 2, JSON.stringify(s));
check('phase 2 adds orb volleys or the fire nova', /volley|nova/.test(s.moves2) && s.bar2.includes('enraged'), JSON.stringify(s));
check('boss loot: epic/legendary gear and a Warden Ember; quest done', s.rare >= 1 && s.ember && s.quest, JSON.stringify(s));
check('adds vanish after death; the exit opens behind the boss', s.addsGone === 0 && s.exit === 'Leave the vault' && s.outside, JSON.stringify(s));

// 4x2. Option C reach re-tune, slash trails, ground telegraphs, and shield bash fix.
s = await run2(async () => {
  const g = window.game;
  const A = window.art;
  const d = g.adventure.dungeon;
  const p = g.player;
  const out = {};
  const V = p.pos.constructor;

  // 1. Bandit hits at 1.6 m and no longer at 2.0 m.
  const testBandit = (dist) => {
    const e = window.arena2('bandit', dist, false);
    p.hp = p.stats.maxHp;
    e.state = 'windup';
    e.stateTime = 0;
    e.vel.set(0, 0, 0);
    for (let i = 0; i < 60 && e.state !== 'recover'; i++) g.step(1);
    const hit = p.hp < p.stats.maxHp;
    e.frozen = true;
    return hit;
  };
  out.bandit16 = testBandit(1.6);
  out.bandit20 = testBandit(2.0);

  // 2. Warden sweep reaches 3.5 m and no further.
  const b = d.boss;
  const testSweep = (dist) => {
    window.arena2('bandit', 30);
    d.load(null);
    b.reset();
    b.frozen = false;
    b.facing = Math.PI;
    b.move = 'sweep';
    b.state = 'windup';
    b.stateTime = 0;
    p.pos.set(b.pos.x, b.pos.y, b.pos.z + dist);
    p.vel.set(0, 0, 0);
    p.hp = p.stats.maxHp;
    for (let i = 0; i < 80 && b.state !== 'recover'; i++) g.step(1);
    const hit = p.hp < p.stats.maxHp;
    b.reset();
    b.frozen = true;
    return hit;
  };
  out.sweep34 = testSweep(3.4);
  out.sweep36 = testSweep(3.6);
  g.adventure.leaveDungeon();

  // 3. Spider collider is 0.90 m (stats + physical separation).
  const sp = window.arena2('spider', 0.95, true);
  g.step(1);
  out.spider = { radius: sp.stats.radius, sep: +sp.pos.distanceTo(p.pos).toFixed(3) };

  // 4. Goblin arrows spawn at 0.65 m above feet.
  const gob = window.arena2('goblin', 10, false);
  let arrowY = null;
  for (let i = 0; i < 120; i++) {
    p.hp = p.stats.maxHp;
    const before = g.projectiles.list.length;
    g.step(1);
    if (g.projectiles.list.length > before) {
      const pr = g.projectiles.list[g.projectiles.list.length - 1];
      if (pr.kind === 'arrow') { arrowY = +(pr.pos.y - gob.pos.y).toFixed(3); break; }
    }
  }
  out.goblinY = arrowY;

  // 5. Warrior hits at 2.1 m (surface gap; 2.5 m centre) and no longer at 2.3 m (2.7 m centre).
  const testWarrior = (gap) => {
    const e = window.arena2('bandit', gap + 0.4, true);
    g.chooseClass('warrior');
    p.pos.set(0, g.world.groundAt(0, 32, 1e9), 32);
    p.facing = 0;
    p.stamina = 999;
    const hp0 = e.hp;
    g.step(1, { held: ['attack'] });
    for (let i = 0; i < 30 && p.state === 'attack'; i++) {
      // Keep exact surface gap right up to the strike frame so lunge doesn't skew the boundary test.
      e.pos.set(p.pos.x, e.pos.y, p.pos.z - (gap + e.stats.radius));
      g.step(1);
      if (e.hp < hp0) break;
    }
    return e.hp < hp0;
  };
  out.warrior21 = testWarrior(2.1);
  out.warrior23 = testWarrior(2.3);

  // 6. Slash trail appears during a swing and is gone afterwards.
  window.arena2('bandit', 30);
  g.chooseClass('warrior');
  g.trails.reset();
  g.step(0, null, true);
  await A.modelsSettled();
  for (let i = 0; i < 5; i++) g.step(1, null, true);
  g.step(1, { held: ['attack'] }, true);
  let trailDuring = 0;
  let trailVerts = 0;
  let trailArc = 0;
  for (let i = 0; i < 30 && p.state === 'attack'; i++) {
    g.step(1, null, true);
    if (p.attackPhase() === 'swing' && g.trails.activeCount > 0) {
      trailDuring = Math.max(trailDuring, g.trails.activeCount);
      const sl = g.trails.slots.find((x) => x.mesh.visible);
      if (sl) {
        trailVerts = Math.max(trailVerts, sl.count);
        let arc = 0;
        for (let k = 1; k < sl.count; k++) arc += sl.tips[k].distanceTo(sl.tips[k - 1]);
        trailArc = Math.max(trailArc, arc);
      }
    }
  }
  for (let i = 0; i < 20; i++) g.step(1, null, true);
  out.trail = { during: trailDuring, verts: trailVerts, arc: +trailArc.toFixed(2), after: g.trails.activeCount };

  // 7. Each telegraph appears during its windup with the right size and is gone after the hit.
  out.tele = {};
  const snapTele = () => {
    const sl = g.telegraphs.slots.find((x) => x.visible);
    return sl ? { kind: sl.kind, r: sl.radius, arc: sl.arcDeg, progress: +sl.progress.toFixed(2) } : null;
  };
  {
    const go = window.arena2('golem', 6, false);
    go.state = 'windup';
    go.stateTime = 0.5;
    g.step(0, null, true);
    const s50 = snapTele();
    go.stateTime = 0.95;
    g.step(0, null, true);
    const s95 = snapTele();
    go.state = 'active';
    go.stateTime = 0.05;
    go.update(1 / 60, p);
    g.step(0, null, true);
    out.tele.golem = {
      kind: s50?.kind, r: s50?.r, arc: s50?.arc,
      p50: s50?.progress ?? 0, p95: s95?.progress ?? 0,
      after: g.telegraphs.activeCount,
    };
    go.frozen = true;
  }
  d.load(null);
  b.reset();
  b.frozen = true;
  p.pos.set(b.pos.x, b.pos.y, b.pos.z + 6);
  for (const [mv, wantR, wantArc] of [['sweep', 3.5, 140], ['slam', 4.8, 360], ['nova', 9.0, 360]]) {
    b.phase = mv === 'nova' ? 2 : 1;
    b.move = mv;
    b.state = 'windup';
    b.stateTime = 0.45;
    g.step(0, null, true);
    const s = snapTele();
    b.state = 'active';
    b.hitDone = true;
    g.step(0, null, true);
    out.tele[mv] = { kind: s?.kind, r: s?.r, wantR, arc: s?.arc, wantArc, after: g.telegraphs.activeCount };
  }
  b.reset();
  g.adventure.leaveDungeon();

  // 8. Shield bash moves the shield at least 0.5 m forward at the hit moment.
  window.arena2('bandit', 30);
  g.chooseClass('tank');
  window.levelTo(6);
  p.mana = p.stats.maxMana;
  g.step(0, null, true);
  await A.modelsSettled();
  for (let i = 0; i < 15; i++) g.step(1, null, true);
  const fVec = p.facingVector();
  const shieldFwd = () => {
    g.scene.updateMatrixWorld(true);
    let maxFwd = -1e9;
    const v = new V();
    g.model.shield.traverse((o) => {
      if (!o.isMesh || o.name.endsWith('_outline') || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        maxFwd = Math.max(maxFwd, (v.x - p.pos.x) * fVec.x + (v.z - p.pos.z) * fVec.z);
      }
    });
    return maxFwd;
  };
  const restFwd = shieldFwd();
  g.skills.cast(2, g.skillContext());
  for (let i = 0; i < 30 && p.state === 'skill'; i++) {
    if (p.stateTime >= 0.2 - 1e-6) break;
    g.step(1, null, true);
  }
  g.step(0, null, true);
  const hitFwd = shieldFwd();
  out.bash = { rest: +restFwd.toFixed(3), hit: +hitFwd.toFixed(3), delta: +(hitFwd - restFwd).toFixed(3) };

  // Clean up back to town.
  for (const e of g.enemies.list) { e.home.copy(window.homes.get(e)); e.reset(); e.frozen = true; }
  g.chooseClass('warrior');
  p.respawn();
  window.tp(0, 32);
  return out;
});
check('reach: bandit hits at 1.6 m and no longer at 2.0 m', s.bandit16 === true && s.bandit20 === false, JSON.stringify({ b16: s.bandit16, b20: s.bandit20 }));
check('reach: Warden sweep reaches 3.5 m and no further', s.sweep34 === true && s.sweep36 === false, JSON.stringify({ s34: s.sweep34, s36: s.sweep36 }));
check('reach: spider collider radius is 0.90 m', s.spider.radius === 0.9 && s.spider.sep >= 1.24, JSON.stringify(s.spider));
check('reach: goblin arrows spawn at 0.65 m', Math.abs((s.goblinY ?? 0) - 0.65) < 0.05, `y=${s.goblinY}`);
check('reach: Warrior hits at 2.1 m and no longer at 2.3 m', s.warrior21 === true && s.warrior23 === false, JSON.stringify({ w21: s.warrior21, w23: s.warrior23 }));
check('vfx: slash trail appears during a swing with a visible arc and is gone afterwards', s.trail.during >= 1 && s.trail.verts >= 6 && s.trail.arc >= 1.0 && s.trail.after === 0, JSON.stringify(s.trail));
check('vfx: each telegraph appears during windup with exact TUNING size and is gone after the hit',
  s.tele.golem.kind === 'golem:slam' && s.tele.golem.r === 3.2 && s.tele.golem.arc === 360 && s.tele.golem.p95 > s.tele.golem.p50 && s.tele.golem.after === 0 &&
  ['sweep', 'slam', 'nova'].every((k) => s.tele[k].kind === `warden:${k}` && s.tele[k].r === s.tele[k].wantR && s.tele[k].arc === s.tele[k].wantArc && s.tele[k].after === 0),
  JSON.stringify(s.tele));
check('shield bash: moves the shield at least 0.5 m forward at the hit moment', s.bash.hit >= 0.8 && s.bash.delta >= 0.5, JSON.stringify(s.bash));

// 4y. Ember Vault 3D art pass: models, fallback on missing file, colliders, mechanism model states, boss portal.
s = await run2(async () => {
  const g = window.game;
  const A = window.art;
  const a = g.adventure;
  const d = a.dungeon;
  await d.loaded;
  await A.modelsSettled();

  const hasChild = (obj, sub) => {
    let found = false;
    obj.traverse((o) => { if (o.name === sub || o.name.startsWith(sub)) found = true; });
    return found;
  };
  const zoneHash = () => {
    const z = g.world.boxes.filter((b) => b.zone === 'dungeon')
      .map((b) => `${b.minX},${b.maxX},${b.minZ},${b.maxZ},${b.minY},${b.maxY},${!!b.noClimb}`)
      .sort().join('|');
    let h = 2166136261;
    for (let i = 0; i < z.length; i++) h = Math.imul(h ^ z.charCodeAt(i), 16777619);
    return `${g.world.boxes.filter((b) => b.zone === 'dungeon').length}/${(h >>> 0).toString(16)}`;
  };

  // Reset dungeon to clean closed state and stand at room A.
  d.solved.clear();
  d.keys = 0;
  d.brazierLit = false;
  d.timer = 0;
  d.resetBlock();
  d.sync();
  d.boss.reset();
  d.boss.frozen = true;
  g.player.respawn();
  a.enterDungeon();
  g.step(2, null, true);

  const hashClosed = zoneHash();
  const doorsOk = ['plateDoor', 'crystalDoor', 'lockDoor', 'timedDoor'].every((id) => hasChild(d.doors.get(id).mesh, 'Door'));
  const roomsOk = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].every((id) => hasChild(d.group, `dungeon:floor:${id}`) && hasChild(d.group, `dungeon:arch:${id}`) && hasChild(d.group, `dungeon:ceil:${id}`));
  const mechsPresent = hasChild(d.block.mesh, 'PushBlock') && hasChild(d.group, 'PlateFrame') && hasChild(d.group, 'PlatePad')
    && hasChild(d.group, 'ResetRune') && hasChild(d.group, 'CrystalPedestal') && hasChild(d.group, 'CrystalGem')
    && hasChild(d.group, 'ChestGoldBody') && hasChild(d.group, 'LeverArm') && hasChild(d.group, 'BrazierBowl')
    && hasChild(d.group, 'ExitStairsA') && hasChild(d.group, 'ExitPortal');
  const dressOk = hasChild(d.group, 'dungeon:dress:TorchWall') && hasChild(d.group, 'dungeon:dress:ChainHang') && hasChild(d.group, 'dungeon:dress:Barrel');
  const fallbacksHidden = d.group.getObjectByName('dungeon:fallbackTorches')?.visible === false;
  const outsideTest = (() => {
    window.tp(0, 32);
    g.step(1, null, true);
    const out = !d.group.visible && !g.interior;
    a.enterDungeon();
    g.step(1, null, true);
    return out && d.group.visible && g.interior && !g.scenery.group.visible;
  })();

  // Open plate door via pushing block onto plate, verify model state + collider removal/restore.
  d.block.box.minX = d.spot('plate').x - 1; d.block.box.maxX = d.spot('plate').x + 1;
  d.block.box.minZ = d.spot('plate').z - 1; d.block.box.maxZ = d.spot('plate').z + 1;
  g.step(2, null, true);
  for (let i = 0; i < 60; i++) d.animate(i * 0.02, 0.05);
  const plateDownY = +(d.group.getObjectByName('PlatePad')?.position.y ?? 99).toFixed(2);
  const plateDoorGone = !g.world.hasCollider(d.doors.get('plateDoor').box);
  const plateDoorAnim = d.doors.get('plateDoor').anim;
  d.solved.delete('plate');
  d.resetBlock();
  d.sync();
  g.step(2, null, true);
  const plateUpY = +(d.group.getObjectByName('PlatePad')?.position.y ?? 0).toFixed(2);
  const hashRestored = zoneHash();

  // Hit crystal -> model crystal turns green; open keyChest -> lid opens & unlock lockDoor; pull lever -> arm rotates; light brazier -> flame on.
  const cSpot = d.spot('crystal');
  g.player.pos.set(cSpot.x + 1.5, cSpot.y, cSpot.z);
  d.strike(g.player.pos, g.player.pos.clone().set(-1, 0, 0), 3, 2);
  let crystalGreen = false;
  d.group.getObjectByName('CrystalGem')?.traverse((o) => {
    if (o.isMesh && o.material?.name === 'DungeonCrystal') crystalGreen = o.material.color.g > o.material.color.r;
  });
  d.openKeyChest();
  d.unlock();
  const lockDoorGone = !g.world.hasCollider(d.doors.get('lockDoor').box);
  const chestLidRot = +(d.group.getObjectByName('ChestGoldLid')?.parent?.rotation?.x ?? 0).toFixed(2);
  d.solved.add('timed');
  d.sync();
  const leverRot = +(d.group.getObjectByName('LeverArm')?.rotation?.x ?? 99).toFixed(2);
  d.rest();
  const brazierLitVis = !!d.group.getObjectByName('BrazierFlame')?.visible;

  // Boss room loads, boss fight starts, exit portal stays dormant while alive then lights when killed.
  const gp = d.spot('exitG');
  window.tp(gp.x, gp.z + 10, gp.y);
  g.step(2, null, true);
  const roomGVis = !!d.group.getObjectByName('dungeon:room:G')?.visible && d.group.getObjectByName('dungeon:room:A')?.visible === false;
  d.boss.frozen = false;
  for (let i = 0; i < 30; i++) { g.player.hp = g.player.stats.maxHp; g.step(1, null, true); }
  const bossEngaged = d.boss.alive && d.boss.state !== 'idle';
  const portalColor = (on) => {
    let col = 0;
    d.group.getObjectByName('ExitPortal')?.traverse((o) => { if (o.isMesh && o.material?.name === 'ExitPortalCore') col = o.material.color.getHex(); });
    return on ? col > 0x208020 : col < 0x303030;
  };
  const portalDormant = portalColor(false);
  d.boss.takeHit({ damage: 1e6, poise: 0, knockback: 0, from: g.player.pos.clone() }, []);
  g.step(2, null, true);
  const portalLit = portalColor(true);
  d.boss.reset();
  d.boss.frozen = true;

  // Missing dungeon file fallback without polluting main world.
  let threw = '';
  let missOk = false;
  try {
    const w2 = new A.World(A.TEST_LAYOUT);
    const dummy = { list: [], spawn: () => d.boss };
    const hud = document.createElement('div');
    const dMiss = new A.Dungeon(w2, dummy, hud, { message() {}, heal() {}, setRespawn() {}, leave() {}, gold() {} }, 'models/dungeon/missing-dungeon.glb', A.WORLD_FILE);
    const loadedOk = await dMiss.loaded;
    missOk = loadedOk === false && !dMiss.modelsReady && dMiss.group.getObjectByName('dungeon:fallbackTorches')?.visible === true && !hasChild(dMiss.group, 'PushBlock');
  } catch (e) { threw = String(e); }

  // Restore player outside cleanly.
  d.solved.clear();
  d.keys = 0;
  d.brazierLit = false;
  d.timer = 0;
  d.resetBlock();
  d.sync();
  a.leaveDungeon();
  g.step(2, null, true);
  return {
    ready: d.modelsReady, doorsOk, roomsOk, mechsPresent, dressOk, fallbacksHidden, outsideTest,
    hashClosed, hashRestored, plateDownY, plateUpY, plateDoorGone, plateDoorAnim, crystalGreen, lockDoorGone, chestLidRot, leverRot, brazierLitVis,
    roomGVis, bossEngaged, portalDormant, portalLit, threw, missOk,
  };
});
check('dungeon art: all room kits, doors, mechanisms, exits and instanced dressing load and cull cleanly',
  s.ready && s.doorsOk && s.roomsOk && s.mechsPresent && s.dressOk && s.fallbacksHidden && s.outsideTest, JSON.stringify(s));
check('dungeon art: colliders match before and after door opens/closes; missing file keeps fallback boxes without throwing',
  s.hashClosed.startsWith('49/') && s.hashClosed === s.hashRestored && s.plateDoorGone && s.lockDoorGone && !s.threw && s.missOk, JSON.stringify(s));
check('dungeon art: mechanisms animate and update model states (plate, crystal, key chest, timed lever, brazier, boss portal)',
  s.plateDownY < s.plateUpY && s.plateDoorAnim > 0.5 && s.crystalGreen && Math.abs(s.chestLidRot + 1.75) < 0.05 && Math.abs(s.leverRot + 0.6) < 0.05 && s.brazierLitVis && s.roomGVis && s.bossEngaged && s.portalDormant && s.portalLit, JSON.stringify(s));

if (shotsDir) {
  await run2(() => {
    const g = window.game;
    for (const e of g.enemies.list) {
      e.home.copy(window.homes.get(e));
      e.reset();
      e.frozen = true;
    }
    g.chooseClass('warrior');
    window.tp(4, 2);
    g.cam.yaw = 0.5;
    g.cam.pitch = 0.3;
    g.cam.distance = 8;
    for (let i = 0; i < 4; i++) g.step(1, null, true);
  });
  await shot2('18-town');
  await run2(() => {
    const g = window.game;
    window.tp(6, -8);
    g.cam.yaw = 0;
    g.step(1);
    window.talk('elder');
    g.step(1, null, true);
  });
  await shot2('19-dialog');
  await run2(() => {
    const g = window.game;
    g.adventure.dialog.close();
    g.map.toggle(true);
    g.step(3, null, true);
  });
  await shot2('20-map');
  await run2(() => {
    const g = window.game;
    g.map.toggle(false);
    const e = g.enemies.list.find((x) => x.kind === 'golem');
    window.tp(e.pos.x + 7, e.pos.z + 5);
    g.cam.yaw = Math.atan2(7, 5);
    g.cam.pitch = 0.25;
    for (let i = 0; i < 4; i++) g.step(1, null, true);
  });
  await shot2('21-ruins-golem');
  await run2(() => {
    const g = window.game;
    const e = g.enemies.list.find((x) => x.kind === 'wolf');
    window.tp(e.pos.x + 6, e.pos.z + 4);
    g.cam.yaw = Math.atan2(6, 4);
    g.cam.pitch = 0.25;
    for (let i = 0; i < 4; i++) g.step(1, null, true);
  });
  await shot2('22-forest-wolves');
  // The dungeon: plate room, crystal, the boss.
  const vault = (spot, dx, dz, yaw, pitch = 0.35, dist = 8) =>
    run2(([spot, dx, dz, yaw, pitch, dist]) => {
      const g = window.game;
      const d = g.adventure.dungeon;
      d.load(null);
      const at = d.spot(spot);
      window.tp(at.x + dx, at.z + dz, at.y + 1);
      g.player.facing = yaw;
      g.cam.yaw = yaw;
      g.cam.pitch = pitch;
      g.cam.distance = dist;
      for (let i = 0; i < 6; i++) g.step(1, null, true);
    }, [spot, dx, dz, yaw, pitch, dist]);
  await vault('plate', -2, 7, 0);
  await shot2('23-vault-plate-room');
  await vault('crystal', 3, 0, Math.PI / 2, 0.2, 6);
  await shot2('24-vault-crystal');
  await vault('lever', -1, 0, 0, 0.15, 6);
  await shot2('25-vault-timed-hall');
  await run2(() => {
    const g = window.game;
    const b = g.adventure.dungeon.boss;
    b.reset();
    b.frozen = true;
    window.tp(b.pos.x + 2, b.pos.z + 9, b.pos.y + 1);
    g.cam.yaw = 0.2;
    g.cam.pitch = 0.3;
    g.cam.distance = 8;
    b.state = 'chase';
    for (let i = 0; i < 6; i++) g.step(1, null, true);
  });
  await shot2('26-vault-boss');
  await run2(() => {
    const g = window.game;
    g.map.toggle(true);
    g.step(3, null, true);
  });
  await shot2('27-vault-map');
}

// ================================================================ title: start page and HUD (milestone 8 prelude)
// The real game (no ?test) boots to the start page. Every boot() below is a fresh page load on the same saves.
const page3 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page3.on('pageerror', (e) => errors.push(String(e)));
page3.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const run3 = (fn, arg) => page3.evaluate(fn, arg);
const boot = async () => {
  await page3.goto(`http://localhost:${PORT}/`);
  await page3.waitForFunction(() => window.game?.adventure?.startPage?.visible);
};
const hudState = () =>
  run3(() => {
    const d = (sel) => getComputedStyle(document.querySelector(sel)).display;
    return { mini: d('.minimap'), tracker: d('.tracker'), skills: d('.skillbar'), hp: d('.panel.hp'), start: d('.start'), menu: window.game.menuOpen };
  });
const playing = () => page3.waitForFunction(() => !window.game.menuOpen);

await boot();
if (shotsDir) await page3.screenshot({ path: `${shotsDir}/28-start-page.png` });
let h = await hudState();
check('title: HUD, minimap and quest tracker hidden; start page shown', h.mini === 'none' && h.tracker === 'none' && h.skills === 'none' && h.hp === 'none' && h.start !== 'none' && h.menu, JSON.stringify(h));
const labels = await run3(() => [...document.querySelectorAll('.start-menu button')].map((b) => b.querySelector('b').textContent).join(','));
check('start page buttons: New game, Continue, Load, Settings, Import', labels === 'New game,Continue,Load,Settings,Import save file', labels);
const noSave = await page3.locator('.start-menu button', { hasText: 'Continue' }).isDisabled();
check('Continue is disabled with a hint when there is no save', noSave && (await run3(() => document.querySelector('.start-menu button:nth-child(2)').textContent.includes('No saved game yet'))));
await page3.setViewportSize({ width: 390, height: 844 });
const phone = await run3(() => {
  const s = document.querySelector('.start');
  const m = document.querySelector('.start-menu').getBoundingClientRect();
  return { noScroll: s.scrollWidth <= s.clientWidth, gutter: m.left >= 16 && m.right <= window.innerWidth - 16 };
});
check('start page fits a 390 px phone (no horizontal scroll, 16 px gutter)', phone.noScroll && phone.gutter, JSON.stringify(phone));
await page3.setViewportSize({ width: 1280, height: 720 });

// New game: first empty slot, class pick, then play with the HUD back.
await page3.locator('.start-menu button', { hasText: 'New game' }).click();
await page3.locator('.classpick:not(.slots):not(.start) .classcard').nth(3).click();
await playing();
await run3(() => window.game.adventure.lastSave);
const created = await run3(async () => {
  const a = window.game.adventure;
  const saved = await a.store.load();
  return { slot: a.slot, cls: window.game.player.cls, stored: !!saved.slots[0], last: saved.lastSlot };
});
h = await hudState();
check('New game creates a character in slot 1 and hides the start page', created.slot === 0 && created.cls === 'assassin' && created.stored && created.last === 0 && h.start === 'none', JSON.stringify({ created, start: h.start }));
check('in play: HUD, skill bar and minimap are visible', h.mini !== 'none' && h.skills !== 'none' && h.hp !== 'none' && !h.menu, JSON.stringify(h));

// Continue loads the last-played slot, not the first one: make slot 2 the last played.
await boot();
await page3.locator('.start-menu button', { hasText: 'New game' }).click();
await page3.locator('.classpick:not(.slots):not(.start) .classcard').nth(2).click();
await playing();
await run3(() => window.game.adventure.lastSave);
await boot();
const contHint = await run3(() => document.querySelector('.start-menu button:nth-child(2) small').textContent);
check('Continue is enabled and names the last-played slot', !(await page3.locator('.start-menu button', { hasText: 'Continue' }).isDisabled()) && /^Slot 2 · Mage/.test(contHint), contHint);
await page3.locator('.start-menu button', { hasText: 'Continue' }).click();
await playing();
const cont = await run3(() => ({ slot: window.game.adventure.slot, cls: window.game.player.cls, start: document.querySelector('.start').style.display }));
check('Continue loads the last-played slot and hides the start page', cont.slot === 1 && cont.cls === 'mage' && cont.start === 'none', JSON.stringify(cont));

// Load opens the four slots; Back returns to the start page.
await boot();
await page3.locator('.start-menu button', { hasText: 'Load' }).click();
const slotView = await run3(() => ({ cards: document.querySelectorAll('.slots .classcard').length, shown: window.game.adventure.slotSelect.visible, start: document.querySelector('.start').style.display }));
check('Load shows the four character slots', slotView.cards === 4 && slotView.shown && slotView.start === 'none', JSON.stringify(slotView));
await page3.locator('.slots > button.back').click();
check('Back returns to the start page', await run3(() => window.game.adventure.startPage.visible && !window.game.adventure.slotSelect.visible));

// Settings opens the O panel from the start page, above it, with no character loaded.
await page3.locator('.start-menu button', { hasText: 'Settings' }).click();
const settingsOpen = await run3(() => {
  const panel = document.querySelector('.settings-panel');
  const r = panel.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
  return { open: window.game.settingsUI.isOpen && window.game.menuOpen, shown: getComputedStyle(panel).display !== 'none', onTop: panel.contains(top), start: window.game.adventure.startPage.visible };
});
check("Settings opens the settings panel from the start page, on top", settingsOpen.open && settingsOpen.shown && settingsOpen.onTop && settingsOpen.start, JSON.stringify(settingsOpen));
await page3.keyboard.press('Escape');
check('Esc closes the settings panel and the start page stays', await run3(() => !window.game.settingsUI.isOpen && window.game.adventure.startPage.visible));

// Import from the start page: the file chooser, then the slot list with the result.
const json = await run3(() => JSON.stringify(window.game.adventure.account));
const [chooser] = await Promise.all([page3.waitForEvent('filechooser'), page3.locator('.start-menu button', { hasText: 'Import save file' }).click()]);
await chooser.setFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(json) });
await page3.waitForFunction(() => window.game.adventure.slotSelect.visible);
const imported = await run3(() => document.querySelector('.slots .note')?.textContent);
check('Import from the start page reads a save file and lists the slots', imported === 'Save file imported.', imported);

// Full slots: New game offers overwrite, which asks first and keeps the old character when cancelled.
await run3(async () => {
  const a = window.game.adventure;
  for (let i = 0; i < 4; i++) a.account.slots[i] = a.account.slots[i] ?? a.serialize();
  await a.store.save(a.account);
});
await boot();
const hint = await run3(() => document.querySelector('.start-menu button small').textContent);
check('New game says the slots are full when all four are used', /full/.test(hint), hint);
await page3.locator('.start-menu button', { hasText: 'New game' }).click();
const full = await run3(() => ({
  shown: window.game.adventure.slotSelect.visible,
  overwrite: [...document.querySelectorAll('.slots button')].filter((b) => b.textContent.startsWith('Overwrite')).length,
}));
check('a full New game opens the slot list with overwrite options', full.shown && full.overwrite === 4, JSON.stringify(full));
page3.once('dialog', (d) => d.dismiss());
await page3.locator('.slots .classcard').nth(1).locator('button', { hasText: 'Overwrite' }).click();
const declined = await run3(() => ({ pick: window.game.classSelect.visible, kept: window.game.adventure.account.slots[1]?.cls }));
check('cancelling the overwrite keeps the old character', !declined.pick && declined.kept === 'mage', JSON.stringify(declined));
page3.once('dialog', (d) => d.accept());
await page3.locator('.slots .classcard').nth(1).locator('button', { hasText: 'Overwrite' }).click();
await page3.waitForFunction(() => window.game.classSelect.visible);
await page3.locator('.classpick:not(.slots):not(.start) .classcard').nth(0).click();
await playing();
await run3(() => window.game.adventure.lastSave);
const over = await run3(() => ({ slot: window.game.adventure.slot, cls: window.game.adventure.account.slots[1]?.cls }));
check('a confirmed overwrite replaces that slot with the new character', over.slot === 1 && over.cls === 'warrior', JSON.stringify(over));
await page3.close();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
