// Movement + combat smoke test: drives the game in headless Chromium through window.game.step().
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
  // Movement checks run with every enemy frozen in its camp.
  for (const e of window.game.enemies.list) e.frozen = true;
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
page2.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page2.goto(`http://localhost:${PORT}/?test&world=main`);
await page2.waitForFunction(() => window.game && window.items);
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
check('main map: 600 m, chunked, 4 regions with rising levels',
  s.size === 600 && s.chunks === 144 && s.town === 'town' && s.meadow.startsWith('meadow/') && s.forest.startsWith('forest/') && s.ruins.startsWith('ruins/') &&
  Number(s.forest.split('/')[1]) >= 5 && Number(s.ruins.split('/')[1]) >= 10,
  JSON.stringify(s));
check('7 campfires and 6 villagers', s.campfires === 7 && s.npcs === 6, `${s.campfires} / ${s.npcs}`);

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
spawn('pkill', ['-f', `vite preview --port ${PORT}`]);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
