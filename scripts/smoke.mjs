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

if (shotsDir) {
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
}

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
