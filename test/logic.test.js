'use strict';
// 보글보글 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DT = 1 / 60;
const count = (grid) => { let n = 0; L.forEachBubble(grid, () => n++); return n; };
// 쏘고 붙을 때까지 진행한다
function shoot(st, angle) {
  L.aim(st, angle);
  assert.ok(L.fire(st));
  for (let k = 0; k < 600 && st.flying; k++) L.update(st, DT);
  assert.strictEqual(st.flying, null, 'the shot always lands');
}
function emptyBoard(seed = 1) {
  const st = L.newGame(rng(seed));
  st.grid = L.emptyGrid();
  return st;
}

test('hex grid: rows alternate 8 and 7 cells and neighbours are mutual', () => {
  for (let r = 0; r < L.MAX_ROWS; r++) {
    assert.strictEqual(L.colsIn(r), r % 2 ? 7 : 8);
    for (let c = 0; c < L.colsIn(r); c++) {
      const n = L.neighbors(r, c);
      assert.ok(n.length >= 2 && n.length <= 6);
      for (const [a, b] of n) {
        assert.ok(L.neighbors(a, b).some(([x, y]) => x === r && y === c), `${r},${c} ↔ ${a},${b}`);
        assert.ok(Math.abs(Math.hypot(L.cellX(r, c) - L.cellX(a, b), (r - a) * L.ROW_H) - L.D) < 1e-9, 'neighbours touch');
      }
    }
  }
});

test('stages: hanging from the ceiling, colours and rows grow with the stage', () => {
  for (let n = 1; n <= 14; n++) {
    for (let s = 1; s <= 10; s++) {
      const g = L.makeStage(n, rng(n * 100 + s));
      assert.strictEqual(L.floatingBubbles(g).length, 0, 'nothing floats');
      assert.ok(count(g) > 0);
      assert.ok(L.colorsOnBoard(g).length <= L.stageColors(n));
      L.forEachBubble(g, (r) => assert.ok(r < L.stageRows(n)));
    }
  }
  assert.strictEqual(L.stageColors(1), 3);
  assert.strictEqual(L.stageColors(20), 7);
  assert.strictEqual(L.shotsPerDropFor(1), 9);
  assert.strictEqual(L.shotsPerDropFor(30), 5);
});

test('a straight shot into an empty board sticks to the ceiling right above the launcher', () => {
  const st = emptyBoard();
  st.grid[0][7] = 1;                                    // 판이 비면 클리어되니 구석에 하나 둔다
  st.cur = 2;
  shoot(st, Math.PI / 2);
  assert.ok(st.grid[0][3] === 2 || st.grid[0][4] === 2);
});

test('bank shots bounce off the walls and stay inside', () => {
  const st = emptyBoard();
  st.grid[0][0] = 1;
  L.aim(st, L.MIN_ANGLE);
  L.fire(st);
  let bounced = false;
  for (let k = 0; k < 600 && st.flying; k++) {
    L.update(st, DT);
    if (st.events.some((e) => e.type === 'bounce')) bounced = true;
    if (st.flying) assert.ok(st.flying.x >= L.R - 1e-9 && st.flying.x <= L.W - L.R + 1e-9);
  }
  assert.ok(bounced);
  assert.strictEqual(st.flying, null);
});

test('three of a colour pop; bubbles cut off from the ceiling fall with a doubling bonus', () => {
  const st = emptyBoard();
  // 0행: 빨강 빨강 . . . . . 파랑 / 1행: 빨강(0,0 과 0,1 아래) 에 초록 둘이 매달림
  st.grid[0][0] = 0; st.grid[0][1] = 0; st.grid[0][7] = 2;
  st.grid[1][0] = 3; st.grid[2][0] = 3;
  st.cur = 0;
  const b = { x: L.cellX(0, 2), y: L.cellY(st, 0) + 2, vx: 0, vy: -1, color: 0 };
  L.stick(st, b);
  const pop = st.events.find((e) => e.type === 'pop');
  assert.strictEqual(pop.cells.length, 3);
  const drop = st.events.find((e) => e.type === 'drop');
  assert.strictEqual(drop.cells.length, 2);
  assert.strictEqual(drop.bonus, L.dropBonus(2));
  assert.strictEqual(st.score, 30 + 40);
  assert.strictEqual(count(st.grid), 1);
  assert.strictEqual(L.dropBonus(50), 10 * 2 ** 12, 'bonus is capped');
});

test('two of a colour stay; the waiting bubbles only use colours still on the board', () => {
  const st = emptyBoard();
  st.grid[0][0] = 0; st.grid[0][7] = 2;
  st.cur = 5; st.nxt = 5;
  L.stick(st, { x: L.cellX(0, 1), y: L.cellY(st, 0), color: 0 });
  assert.strictEqual(count(st.grid), 3);
  assert.ok([0, 2].includes(st.cur) && [0, 2].includes(st.nxt));
});

test('the ceiling comes down after enough shots; crossing the line ends the game', () => {
  const st = emptyBoard();
  st.grid[0][0] = 1; st.grid[0][7] = 2;
  st.shotsPerDrop = 2;
  L.stick(st, { x: L.cellX(1, 3), y: L.cellY(st, 1), color: 3 });
  assert.strictEqual(st.drops, 0);
  L.stick(st, { x: L.cellX(1, 5), y: L.cellY(st, 1), color: 4 });
  assert.strictEqual(st.drops, 1);
  assert.ok(st.events.some((e) => e.type === 'ceiling'));
  L.forEachBubble(st.grid, (r) => assert.strictEqual(r, 0, 'shots with nothing to hold on to snap up to the ceiling'));
  st.grid[1][0] = 5;                                    // 0행에 매달린 1행 구슬
  st.drops = L.DEAD_ROWS - 2;
  L.checkGameOver(st);
  assert.strictEqual(st.phase, 'play', 'row 1 + 10 drops is still above the line');
  st.drops = L.DEAD_ROWS - 1;
  L.checkGameOver(st);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(count(st.grid), 0);
  assert.ok(st.events.find((e) => e.type === 'over').cells.length >= 4);
});

test('popping the last bubbles clears the stage with a bonus', () => {
  const st = emptyBoard();
  st.stage = 3;
  st.grid[0][0] = 1; st.grid[0][1] = 1;
  L.stick(st, { x: L.cellX(0, 2), y: L.cellY(st, 0), color: 1 });
  assert.strictEqual(st.phase, 'clear');
  assert.strictEqual(st.score, 30 + 3000);
  L.nextStage(st);
  assert.strictEqual(st.stage, 4);
  assert.strictEqual(st.phase, 'play');
});

test('waiting ten seconds fires automatically; swapping trades the two bubbles', () => {
  const st = L.newGame(rng(2));
  st.cur = 0; st.nxt = 1;
  assert.ok(L.swap(st));
  assert.deepStrictEqual([st.cur, st.nxt], [1, 0]);
  for (let t = 0; t < L.AUTO_FIRE - 0.1; t += DT) L.update(st, DT);
  assert.strictEqual(st.flying, null);
  for (let t = 0; t < 0.2; t += DT) L.update(st, DT);
  assert.ok(st.flying || st.events.some((e) => e.type === 'shoot'));
});

test('the aim guide shortens on later stages', () => {
  const st = L.newGame(rng(3));
  L.aim(st, L.MIN_ANGLE + 0.1);
  const len = (stage) => { st.stage = stage; return L.aimPath(st).length; };
  assert.ok(len(1) > len(3));
  assert.ok(len(3) >= len(6));
  assert.ok(len(6) <= 6);
});

// 여러 각도를 미리 쏴 보고 가장 많이 터뜨리는(없으면 같은 색 옆에 붙는) 각도로 쏘는 봇
function bestAngle(st) {
  let best = null, bestScore = -Infinity;
  for (let i = 0; i <= 60; i++) {
    const a = L.MIN_ANGLE + (L.MAX_ANGLE - L.MIN_ANGLE) * (i / 60);
    const s = { ...st, rand: () => 0.5, grid: st.grid.map((r) => r.slice()), events: [], flying: null };
    L.aim(s, a); L.fire(s);
    for (let k = 0; k < 600 && s.flying; k++) L.updateFlying(s, DT);
    const stuck = s.events.find((e) => e.type === 'stick');
    let score = (s.score - st.score) * 10 + (s.phase === 'clear' ? 1e6 : 0) - (s.phase === 'over' ? 1e6 : 0);
    if (stuck) score += L.neighbors(stuck.r, stuck.c).filter(([r, c]) => s.grid[r][c] === st.cur).length - stuck.r * 0.01;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

test('an aiming bot clears the first three stages', () => {
  for (const seed of [1, 2]) {
    const st = L.newGame(rng(seed));
    for (let stage = 1; stage <= 3; stage++) {
      for (let shot = 0; shot < 120 && st.phase === 'play'; shot++) shoot(st, bestAngle(st));
      assert.strictEqual(st.phase, 'clear', `seed ${seed} stage ${stage}`);
      L.nextStage(st);
    }
  }
});
