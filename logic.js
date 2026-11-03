'use strict';

// 보글보글(버블 슈터): 규칙만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 육각 격자: 짝수 행 8칸, 홀수 행은 반 칸 밀려서 7칸. 구슬을 쏘아 붙이고, 같은 색 3개 이상이 이어지면 터진다
// - 천장에 이어지지 않게 된 구슬은 떨어지고, 떨어뜨린 개수만큼 두 배씩 불어나는 보너스
// - 몇 번 쏠 때마다 천장이 한 줄 내려온다. 구슬이 맨 아래 줄을 넘으면 끝, 다 없애면 스테이지 클리어
// - 10초 동안 안 쏘면 자동 발사
// - 아이템 모드의 특수 구슬(번호 10 이상, 판에 남지 않고 붙는 즉시 효과를 내고 사라진다): 폭탄(주변 구슬 제거) · 무지개(이웃 중 가장 크게 터뜨릴 색이 된다) · 번개(그 줄 제거)
// 소리·터지는 효과·글씨는 game.js 가 st.events 를 보고 만든다.
const LOGIC_BUBBLE = (() => {
// ---------- 판 ----------
const R = 20;                      // 구슬 반지름
const D = R * 2;
const COLS = 8;
const ROW_H = R * Math.sqrt(3);    // 육각 격자 행 간격
const W = COLS * D;                // 320
const TOP = 20;                    // 천장 판 두께 (처음)
const DEAD_ROWS = 12;              // 이 줄을 넘으면 게임 오버
const MAX_ROWS = DEAD_ROWS + 1;
const DEAD_Y = TOP + R + (DEAD_ROWS - 1) * ROW_H + R + 2;
const LX = W / 2;                  // 발사대 위치
const LY = DEAD_Y + 34;
const H = Math.round(LY + 30);

const SPEED = 900;                 // px/s
const MIN_ANGLE = Math.PI * 0.06;
const MAX_ANGLE = Math.PI * 0.94;
const TURN_SPEED = 1.9;            // 키보드로 돌리는 속도 (rad/s)
const AUTO_FIRE = 10;              // 이 시간(초) 동안 안 쏘면 자동 발사
const AUTO_WARN = 5;               // 자동 발사 전 카운트다운 시작
const N_COLORS = 7;

// ---------- 특수 구슬 (아이템 모드) ----------
const BOMB = 10, RAINBOW = 11, BOLT = 12;
const isSpecial = (code) => code >= 10;
const BOMB_RINGS = 1;              // 폭탄이 터지는 범위: 붙은 자리에서 이만큼 바깥 겹까지 (1 = 바로 둘러싼 6칸)
const SPECIAL_GAP = [7, 11];       // 이만큼 쏠 때마다 한 번 특수 구슬이 NEXT 로 나온다 (최소, 최대)
const SPECIAL_WEIGHTS = [[BOMB, 0.35], [RAINBOW, 0.4], [BOLT, 0.25]];

// ---------- 격자 ----------
const colsIn = (r) => (r % 2 ? COLS - 1 : COLS);
const inBounds = (r, c) => r >= 0 && r < MAX_ROWS && c >= 0 && c < colsIn(r);
const cellX = (r, c) => R + c * D + (r % 2 ? R : 0);
const ceilY = (st) => TOP + st.drops * ROW_H;
const cellY = (st, r) => ceilY(st) + R + r * ROW_H;

function neighbors(r, c) {
  const odd = r % 2;
  const list = odd
    ? [[r - 1, c], [r - 1, c + 1], [r, c - 1], [r, c + 1], [r + 1, c], [r + 1, c + 1]]
    : [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c + 1], [r + 1, c - 1], [r + 1, c]];
  return list.filter(([a, b]) => inBounds(a, b));
}

function emptyGrid() {
  return Array.from({ length: MAX_ROWS }, (_, r) => new Array(colsIn(r)).fill(-1));
}

function forEachBubble(grid, fn) {
  for (let r = 0; r < MAX_ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] >= 0) fn(r, c, grid[r][c]);
}

function colorsOnBoard(grid) {
  const set = new Set();
  forEachBubble(grid, (r, c, col) => set.add(col));
  return [...set];
}

function sameColorGroup(grid, r0, c0) {
  const color = grid[r0][c0];
  const seen = new Set([r0 * 16 + c0]);
  const stack = [[r0, c0]], out = [];
  while (stack.length) {
    const [r, c] = stack.pop();
    out.push([r, c]);
    for (const [a, b] of neighbors(r, c)) {
      const k = a * 16 + b;
      if (!seen.has(k) && grid[a][b] === color) { seen.add(k); stack.push([a, b]); }
    }
  }
  return out;
}

// 천장(0행)에 이어지지 않은 구슬들
function floatingBubbles(grid) {
  const seen = new Set();
  const stack = [];
  for (let c = 0; c < colsIn(0); c++) if (grid[0][c] >= 0) { seen.add(c); stack.push([0, c]); }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [a, b] of neighbors(r, c)) {
      const k = a * 16 + b;
      if (!seen.has(k) && grid[a][b] >= 0) { seen.add(k); stack.push([a, b]); }
    }
  }
  const out = [];
  forEachBubble(grid, (r, c) => { if (!seen.has(r * 16 + c)) out.push([r, c]); });
  return out;
}

// ---------- 스테이지 ----------
const SHAPES = [
  () => true,                                                           // 꽉 찬 벽
  (r, c, x) => Math.abs(x - W / 2) <= W / 2 - r * R * 0.9 + 2,          // 역삼각형
  (r, c, x) => r < 2 || Math.floor(x / (D * 2)) % 2 === 0,              // 기둥
  (r, c, x, rows) => r < rows - 1 - Math.round(1.5 + 1.5 * Math.sin(x / 38)), // 물결
  (r, c) => !(r % 3 === 2 && c % 3 === 1),                              // 구멍 숭숭
  (r, c, x) => r < 2 || Math.abs(x - W / 2) > r * R * 0.7,              // V 자
];

const stageColors = (n) => Math.min(3 + Math.floor((n - 1) / 2), n >= 10 ? 7 : 6);
const stageRows = (n) => Math.min(4 + Math.floor((n - 1) / 2), 8);
const shotsPerDropFor = (n) => Math.max(5, 9 - Math.floor((n - 1) / 2));

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeStage(n, rand = Math.random) {
  const nColors = stageColors(n);
  const rows = stageRows(n);
  const shape = SHAPES[(n - 1) % SHAPES.length];
  const palette = shuffle([...Array(N_COLORS).keys()], rand).slice(0, nColors);
  const grid = emptyGrid();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < colsIn(r); c++) {
      if (!shape(r, c, cellX(r, c), rows)) continue;
      // 이웃 색을 이어받아 뭉치게 만든다 → 연쇄를 노릴 만한 판
      const near = neighbors(r, c).map(([a, b]) => grid[a][b]).filter((v) => v >= 0);
      grid[r][c] = near.length && rand() < 0.5
        ? near[Math.floor(rand() * near.length)]
        : palette[Math.floor(rand() * palette.length)];
    }
  }
  for (const [r, c] of floatingBubbles(grid)) grid[r][c] = -1;
  return grid;
}

// 판에 남은 색 중 하나 (판이 비었으면 처음 세 색 중 하나)
function randomColor(st) {
  const on = colorsOnBoard(st.grid);
  return on.length ? on[Math.floor(st.rand() * on.length)] : Math.floor(st.rand() * 3);
}

// ---------- 게임 ----------
function newGame(rand = Math.random, opts = {}) {
  const st = { rand, items: !!opts.items, sinceSpecial: 0, specialGap: 0, stage: 1, score: 0, grid: emptyGrid(), drops: 0, shotsPerDrop: 8, shotsSinceDrop: 0, cur: 0, nxt: 0, angle: Math.PI / 2, flying: null, idle: 0, phase: 'play', events: [] };
  st.specialGap = nextGap(st);
  loadStage(st);
  return st;
}
const nextGap = (st) => SPECIAL_GAP[0] + Math.floor(st.rand() * (SPECIAL_GAP[1] - SPECIAL_GAP[0] + 1));
// 다음 구슬: 아이템 모드에서는 일정 발사 수마다 특수 구슬
function pickNext(st) {
  if (st.items && st.sinceSpecial >= st.specialGap) {
    st.sinceSpecial = 0; st.specialGap = nextGap(st);
    let x = st.rand();
    for (const [code, w] of SPECIAL_WEIGHTS) { if ((x -= w) < 0) return code; }
    return RAINBOW;
  }
  return randomColor(st);
}

function loadStage(st) {
  st.grid = makeStage(st.stage, st.rand);
  st.drops = 0;
  st.shotsPerDrop = shotsPerDropFor(st.stage);
  st.shotsSinceDrop = 0;
  st.flying = null;
  st.idle = 0;
  st.cur = randomColor(st);
  st.nxt = randomColor(st);
  st.sinceSpecial = 0;
  st.angle = Math.PI / 2;
  st.phase = 'play';
}
function nextStage(st) { st.stage++; loadStage(st); }

function aim(st, angle) { st.angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, angle)); }

// ---------- 쏘기 ----------
function fire(st) {
  if (st.phase !== 'play' || st.flying) return false;
  st.flying = { x: LX, y: LY, vx: Math.cos(st.angle), vy: -Math.sin(st.angle), color: st.cur };
  st.cur = st.nxt;
  st.sinceSpecial++;
  st.nxt = pickNext(st);
  st.idle = 0;
  st.events.push({ type: 'shoot' });
  return true;
}

function swap(st) {
  if (st.phase !== 'play' || st.flying || st.cur === st.nxt) return false;
  [st.cur, st.nxt] = [st.nxt, st.cur];
  st.events.push({ type: 'swap' });
  return true;
}

function hitsBubble(st, x, y) {
  const top = ceilY(st) + R;
  const rMin = Math.max(0, Math.floor((y - top) / ROW_H) - 1);
  const rMax = Math.min(MAX_ROWS - 1, rMin + 3);
  for (let r = rMin; r <= rMax; r++) {
    const cy = top + r * ROW_H;
    for (let c = 0; c < colsIn(r); c++) {
      if (st.grid[r][c] < 0) continue;
      const dx = x - cellX(r, c), dy = y - cy;
      if (dx * dx + dy * dy < (D * 0.86) ** 2) return true;
    }
  }
  return false;
}

// 한 걸음 이동. 벽에 튕기면 true 를 돌려준다.
function advance(b, s) {
  b.x += b.vx * s;
  b.y += b.vy * s;
  if (b.x < R) { b.x = 2 * R - b.x; b.vx = -b.vx; return true; }
  if (b.x > W - R) { b.x = 2 * (W - R) - b.x; b.vx = -b.vx; return true; }
  return false;
}

const landed = (st, b) => b.y - R <= ceilY(st) || hitsBubble(st, b.x, b.y);

function updateFlying(st, dt) {
  let dist = SPEED * dt;
  while (dist > 0) {
    const s = Math.min(4, dist);
    dist -= s;
    if (advance(st.flying, s)) st.events.push({ type: 'bounce' });
    if (landed(st, st.flying)) { const b = st.flying; st.flying = null; stick(st, b); return; }
  }
}

// 부딪힌 자리에서 가장 가까운 빈 칸(천장이나 다른 구슬에 붙어 있는)을 고른다.
function snapCell(st, x, y) {
  const grid = st.grid;
  const r0 = Math.min(MAX_ROWS - 1, Math.max(0, Math.round((y - ceilY(st) - R) / ROW_H)));
  const c0 = Math.min(colsIn(r0) - 1, Math.max(0, Math.round((x - R - (r0 % 2 ? R : 0)) / D)));
  const cands = [[r0, c0], ...neighbors(r0, c0)];
  for (const [a, b] of neighbors(r0, c0)) cands.push(...neighbors(a, b));
  const attached = (r, c) => r === 0 || neighbors(r, c).some(([a, b]) => grid[a][b] >= 0);
  let bestCell = null, bestD = Infinity;
  for (const pass of [true, false]) {
    for (const [r, c] of cands) {
      if (grid[r][c] >= 0 || (pass && !attached(r, c))) continue;
      const d = (x - cellX(r, c)) ** 2 + (y - cellY(st, r)) ** 2;
      if (d < bestD) { bestD = d; bestCell = [r, c]; }
    }
    if (bestCell) return bestCell;
  }
  return [r0, c0];
}

// 떨어뜨린 개수만큼 두 배씩 불어나는 보너스 (원작 규칙). 원작의 17개 상한은 점수가 너무 튀어서 12개로 낮췄다.
const dropBonus = (n) => 10 * 2 ** Math.min(n, 12);
const at = (st, r, c) => ({ r, c, x: cellX(r, c), y: cellY(st, r), color: st.grid[r][c] });

// 구슬들을 터뜨리고 점수를 준다. 이어서 천장에서 끊긴 구슬은 떨어지고 낙하 보너스. cells 는 [[r,c],…], (r,c) 는 효과가 난 자리
function clearCells(st, cells, r, c, extra = {}) {
  const grid = st.grid;
  const popped = cells.map(([a, bb]) => at(st, a, bb));
  for (const [a, bb] of cells) grid[a][bb] = -1;
  let gained = cells.length * 10;
  st.events.push({ type: 'pop', cells: popped, gain: gained, x: cellX(r, c), y: cellY(st, r), ...extra });
  const floating = floatingBubbles(grid);
  if (floating.length) {
    const fell = floating.map(([a, bb]) => at(st, a, bb));
    for (const [a, bb] of floating) grid[a][bb] = -1;
    const bonus = dropBonus(floating.length);
    gained += bonus;
    st.events.push({ type: 'drop', cells: fell, bonus, x: cellX(r, c), y: cellY(st, r) });
  }
  st.score += gained;
}

// 무지개: 이웃한 색들 중 여기에 놓았을 때 가장 큰 덩어리가 되는 색으로 바뀐다. 이웃이 없으면(천장) 판에 남은 색 아무거나
function rainbowColor(st, r, c) {
  const grid = st.grid;
  const cols = [...new Set(neighbors(r, c).map(([a, b]) => grid[a][b]).filter((v) => v >= 0))];
  if (!cols.length) return randomColor(st);
  let best = cols[0], bs = -1;
  for (const col of cols) {
    grid[r][c] = col;
    const n = sameColorGroup(grid, r, c).length;
    if (n > bs) { bs = n; best = col; }
  }
  grid[r][c] = -1;
  return best;
}

// (r,c) 둘레 rings 겹 안의 칸들
function ringCells(r, c, rings) {
  const seen = new Set([r * 16 + c]);
  let frontier = [[r, c]];
  const out = [];
  for (let k = 0; k < rings; k++) {
    const nf = [];
    for (const [a, b] of frontier) for (const [x, y] of neighbors(a, b)) {
      const key = x * 16 + y;
      if (seen.has(key)) continue;
      seen.add(key); out.push([x, y]); nf.push([x, y]);
    }
    frontier = nf;
  }
  return out;
}

// 번개가 지우는 줄: 붙은 줄, 거기에 구슬이 없으면 바로 위 줄
function boltRow(st, r) {
  const has = (row) => row >= 0 && st.grid[row].some((v) => v >= 0);
  return has(r) ? r : has(r - 1) ? r - 1 : r;
}

function stick(st, b) {
  const grid = st.grid;
  const [r, c] = snapCell(st, b.x, b.y);
  let color = b.color;
  if (color === RAINBOW) color = rainbowColor(st, r, c);
  st.events.push({ type: 'stick', r, c, special: isSpecial(b.color) ? b.color : undefined, as: color });

  if (color === BOMB || color === BOLT) {
    // 폭탄·번개는 판에 남지 않는다. 걸린 구슬이 하나도 없으면 그냥 사라진다
    let cells;
    if (color === BOMB) cells = ringCells(r, c, BOMB_RINGS).filter(([a, bb]) => grid[a][bb] >= 0);
    else { const row = boltRow(st, r); cells = grid[row].map((v, cc) => [row, cc]).filter(([a, bb]) => grid[a][bb] >= 0); }
    st.events.push({ type: 'special', kind: color, r, c, x: cellX(r, c), y: cellY(st, r), count: cells.length });
    if (cells.length) clearCells(st, cells, r, c, { special: color });
  } else {
    grid[r][c] = color;
    const group = sameColorGroup(grid, r, c);
    if (group.length >= 3) clearCells(st, group, r, c, b.color === RAINBOW ? { special: RAINBOW } : {});
  }

  // 팔레트에서 사라진 색은 대기 구슬에서도 뺀다 (특수 구슬은 그대로 둔다)
  const on = colorsOnBoard(grid);
  if (!on.length) { stageClear(st); return; }
  if (!isSpecial(st.cur) && !on.includes(st.cur)) st.cur = randomColor(st);
  if (!isSpecial(st.nxt) && !on.includes(st.nxt)) st.nxt = randomColor(st);

  st.shotsSinceDrop++;
  if (st.shotsSinceDrop >= st.shotsPerDrop) {
    st.shotsSinceDrop = 0;
    st.drops++;
    st.events.push({ type: 'ceiling' });
  }
  checkGameOver(st);
}

function checkGameOver(st) {
  let dead = false;
  forEachBubble(st.grid, (r) => { if (r + st.drops >= DEAD_ROWS) dead = true; });
  if (!dead) return;
  st.phase = 'over';
  const cells = [];
  forEachBubble(st.grid, (r, c) => { cells.push(at(st, r, c)); st.grid[r][c] = -1; });
  st.events.push({ type: 'over', cells });
}

function stageClear(st) {
  const bonus = 1000 * st.stage;
  st.score += bonus;
  st.phase = 'clear';
  st.events.push({ type: 'clear', bonus });
}

// ---------- 한 프레임 ----------
// input: { left, right } 키보드로 조준 돌리기
function update(st, dt, input = {}) {
  if (st.phase !== 'play') return;
  const turn = TURN_SPEED * dt;
  if (input.left) aim(st, st.angle + turn);
  if (input.right) aim(st, st.angle - turn);
  if (st.flying) updateFlying(st, dt);
  else if ((st.idle += dt) >= AUTO_FIRE) fire(st);
}

// ---------- 조준선 ----------
// 스테이지가 오를수록 가이드가 짧아진다.
// 1~2: 반사 포함 착지점까지 / 3~5: 첫 벽까지만 / 6~: 발사대 앞 방향만
function aimPath(st) {
  const maxBounces = st.stage <= 2 ? 2 : 0;
  const maxTravel = st.stage <= 5 ? Infinity : 130;
  const b = { x: LX, y: LY, vx: Math.cos(st.angle), vy: -Math.sin(st.angle) };
  const pts = [];
  let bounces = 0, travelled = 0;
  for (let i = 0; i < 400; i++) {
    if (advance(b, 5) && ++bounces > maxBounces) break;
    if ((travelled += 5) > maxTravel) break;
    if (landed(st, b)) break;
    if (travelled % 20 === 0 && travelled > 30) pts.push([b.x, b.y]);
  }
  return pts;
}

return {
  R, D, COLS, ROW_H, W, H, TOP, DEAD_ROWS, MAX_ROWS, DEAD_Y, LX, LY, SPEED, MIN_ANGLE, MAX_ANGLE, TURN_SPEED, AUTO_FIRE, AUTO_WARN, N_COLORS, SHAPES,
  colsIn, inBounds, cellX, ceilY, cellY, neighbors, emptyGrid, forEachBubble, colorsOnBoard, sameColorGroup, floatingBubbles,
  stageColors, stageRows, shotsPerDropFor, makeStage, randomColor, newGame, loadStage, nextStage, aim, fire, swap,
  BOMB, RAINBOW, BOLT, isSpecial, BOMB_RINGS, SPECIAL_GAP, ringCells, rainbowColor, boltRow, pickNext, clearCells,
  hitsBubble, advance, landed, updateFlying, snapCell, dropBonus, stick, checkGameOver, stageClear, update, aimPath,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_BUBBLE;
