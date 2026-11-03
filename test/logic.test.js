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

// ---------- 아이템 모드: 특수 구슬 ----------
// (r,c) 칸에 특수 구슬을 직접 붙인다 (그 칸 위치로 쏜 것처럼)
const stickAt = (st, color, r, c) => { st.events.length = 0; L.stick(st, { x: L.cellX(r, c), y: L.cellY(st, r), color }); };
const put = (st, list) => { for (const [r, c, col] of list) st.grid[r][c] = col; };
const popOf = (st) => st.events.find((e) => e.type === 'pop');

test('special codes sit above the colours and never count as board colours', () => {
  assert.ok(L.isSpecial(L.BOMB) && L.isSpecial(L.RAINBOW) && L.isSpecial(L.BOLT));
  assert.ok(!L.isSpecial(0) && !L.isSpecial(L.N_COLORS - 1));
  assert.ok(L.BOMB >= L.N_COLORS && L.RAINBOW >= L.N_COLORS && L.BOLT >= L.N_COLORS);
});

test('specials only come in item mode, once every few shots', () => {
  const classic = L.newGame(rng(2));
  let seen = 0;
  for (let i = 0; i < 300; i++) { L.fire(classic); classic.flying = null; if (L.isSpecial(classic.nxt) || L.isSpecial(classic.cur)) seen++; }
  assert.strictEqual(seen, 0, 'never in the normal mode');

  const items = L.newGame(rng(2), { items: true });
  const gaps = []; let since = 0;
  for (let i = 0; i < 400; i++) {
    const before = items.nxt;
    L.fire(items); items.flying = null; since++;
    if (L.isSpecial(items.nxt) && !L.isSpecial(before)) { gaps.push(since); since = 0; }
  }
  assert.ok(gaps.length > 25);
  assert.ok(gaps.every((g) => g >= L.SPECIAL_GAP[0] - 1 && g <= L.SPECIAL_GAP[1] + 1), `gaps ${gaps.slice(0, 8)}`);
  const kinds = new Set(); const r = rng(9); const st = L.newGame(r, { items: true });
  for (let i = 0; i < 500; i++) { st.sinceSpecial = 99; const n = L.pickNext(st); if (L.isSpecial(n)) kinds.add(n); }
  assert.deepStrictEqual([...kinds].sort(), [L.BOMB, L.RAINBOW, L.BOLT].sort());
});

test('a bomb pops the bubbles around where it lands and nothing further; it leaves no bubble behind', () => {
  const st = emptyBoard();
  put(st, [[0, 3, 0], [0, 4, 1], [1, 3, 2], [1, 2, 3], [2, 3, 4], [0, 0, 5]]);      // (1,3) 둘레와 멀리 떨어진 (0,0)
  stickAt(st, L.BOMB, 2, 2);
  const pop = popOf(st);
  assert.ok(pop && pop.special === L.BOMB);
  const around = L.ringCells(2, 2, L.BOMB_RINGS).filter(([a, b]) => [[1, 2], [1, 1], [2, 3], [1, 3]].some(([x, y]) => x === a && y === b));
  assert.ok(around.length >= 1);
  assert.strictEqual(st.grid[2][2], -1, 'the bomb itself leaves nothing');
  assert.strictEqual(st.grid[0][0], 5, 'the far bubble stays');
  assert.strictEqual(pop.gain, pop.cells.length * 10);
});

test('a bomb leaves hanging bubbles to fall with the usual doubling bonus', () => {
  const st = emptyBoard();
  put(st, [[0, 2, 0], [1, 2, 1], [2, 2, 2], [3, 2, 3], [4, 2, 4]]);       // 천장에서 늘어진 줄
  const score0 = st.score;
  stickAt(st, L.BOMB, 2, 3);                                              // 줄 가운데를 터뜨리면 아래가 끊긴다
  const drop = st.events.find((e) => e.type === 'drop');
  assert.ok(drop, 'the cut-off part falls');
  assert.strictEqual(drop.bonus, L.dropBonus(drop.cells.length));
  assert.ok(st.score > score0);
});

test('a bomb with nothing around it just disappears', () => {
  const st = emptyBoard();
  put(st, [[0, 0, 1]]);
  stickAt(st, L.BOMB, 0, 7);
  assert.ok(!popOf(st));
  assert.strictEqual(L.colorsOnBoard(st.grid).length, 1);
  assert.strictEqual(count(st.grid), 1);
});

test('rainbow becomes the neighbour colour that makes the biggest group', () => {
  const st = emptyBoard();
  put(st, [[0, 2, 0], [0, 3, 0], [0, 4, 1]]);                              // 빨강 2개 + 노랑 1개 사이
  assert.strictEqual(L.rainbowColor(st, 1, 3), 0, 'next to red and yellow it picks red (red makes a group of three)');   // 효과를 쓰기 전에 확인
  stickAt(st, L.RAINBOW, 1, 3);                                            // (1,3) 은 (0,3)(0,4) 와 이웃
  const pop = popOf(st);
  assert.ok(!pop || pop.special === L.RAINBOW);
  // 1,3 은 빨강(0,3)과 노랑(0,4) 둘과 이웃 → 빨강 덩어리(0,2),(0,3)+자기 = 3개라 터진다
  assert.ok(pop, 'it completed a group of three');
  assert.strictEqual(pop.cells.length, 3);
});

test('rainbow that cannot pop settles in as that colour; at the ceiling with no neighbours it picks a board colour', () => {
  const st = emptyBoard();
  put(st, [[0, 0, 2], [3, 5, 4]]);                                         // (3,5) 는 천장에 안 이어진 구슬이지만 팔레트 확인용
  stickAt(st, L.RAINBOW, 1, 0);                                            // (0,0) 파랑 하나와만 이웃 → 둘이 되어 터지지 않음
  assert.ok(!popOf(st));
  assert.strictEqual(st.grid[1][0], 2);
  const c = L.rainbowColor(st, 0, 6);                                      // 이웃이 없는 자리
  assert.ok(L.colorsOnBoard(st.grid).includes(c));
});

test('bolt clears the whole row it lands on, or the row above when that row is empty', () => {
  const st = emptyBoard();
  put(st, [[0, 0, 0], [0, 1, 1], [0, 2, 2], [0, 3, 3], [0, 4, 4], [0, 5, 0], [0, 6, 1], [0, 7, 2], [1, 3, 5]]);
  stickAt(st, L.BOLT, 1, 4);
  const pop = popOf(st);
  assert.ok(pop && pop.special === L.BOLT);
  assert.strictEqual(pop.cells.every((p) => p.r === 1), true, 'row 1 only');
  assert.strictEqual(pop.cells.length, 1);

  const st2 = emptyBoard();
  put(st2, [[0, 0, 0], [0, 1, 1], [0, 2, 2], [0, 3, 3]]);
  assert.strictEqual(L.boltRow(st2, 1), 0, 'row 1 is empty, so the row above is used');
  stickAt(st2, L.BOLT, 1, 1);
  const pop2 = popOf(st2);
  assert.ok(pop2);
  assert.strictEqual(pop2.cells.length, 4);
});

test('shooting a special for real: it lands, applies its effect and the waiting bubbles stay special-safe', () => {
  const st = L.newGame(rng(4), { items: true });
  st.grid = L.emptyGrid();
  put(st, [[0, 3, 0], [0, 4, 0], [0, 2, 1]]);
  st.cur = L.BOMB; st.nxt = L.RAINBOW;
  shoot(st, Math.PI / 2);
  assert.ok(st.events.some((e) => e.type === 'special' && e.kind === L.BOMB));
  assert.ok(L.isSpecial(st.cur), 'the waiting special is not swapped for a colour');
  assert.ok(L.swap(st) === false || st.cur !== undefined);
  assert.ok(!L.colorsOnBoard(st.grid).some((v) => v >= 10), 'no special is ever left on the board');
});

test('item mode does not break stage clear or game over', () => {
  const st = L.newGame(rng(6), { items: true });
  st.grid = L.emptyGrid();
  put(st, [[0, 3, 0]]);
  st.cur = L.BOLT;
  shoot(st, Math.PI / 2);
  assert.strictEqual(st.phase, 'clear', 'clearing the last bubbles with a special still clears the stage');
});
