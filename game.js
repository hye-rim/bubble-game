'use strict';

// ---------- Board geometry ----------
// 육각 격자: 짝수 행 8칸, 홀수 행은 반 칸 밀려서 7칸.
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
const NEXT_X = 46, NEXT_Y = LY + 6;

const SPEED = 900;                 // px/s
const MIN_ANGLE = Math.PI * 0.06;
const MAX_ANGLE = Math.PI * 0.94;
const AUTO_FIRE = 10;              // 이 시간(초) 동안 안 쏘면 자동 발사
const AUTO_WARN = 5;               // 자동 발사 전 카운트다운 시작

const COLORS = [
  { base: '#ff4d6d', hi: '#ffc2cc', lo: '#a3122f' }, // red
  { base: '#ffd93d', hi: '#fff6c2', lo: '#b88a00' }, // yellow
  { base: '#3fa7ff', hi: '#c7e6ff', lo: '#0b5aa8' }, // blue
  { base: '#4cd964', hi: '#c9f7d2', lo: '#1c8a33' }, // green
  { base: '#b066ff', hi: '#e7ccff', lo: '#6420b0' }, // purple
  { base: '#ff9f1c', hi: '#ffdcae', lo: '#b35a00' }, // orange
  { base: '#e9ecf5', hi: '#ffffff', lo: '#8a90a8' }, // white
];

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 62;   // 위 알약 점수판 + 판 테두리·그림자
  const scale = Math.min((innerWidth - 28) / W, (innerHeight - 30 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- Sound ----------
let audio = null;
let muted = store.get('bubbleMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  shoot: () => tone(520, 0.08, 'square', 0.05, 300),
  bounce: () => tone(300, 0.04, 'triangle', 0.06),
  stick: () => tone(180, 0.06, 'triangle', 0.1),
  pop: (i) => tone(600 + i * 70, 0.09, 'sine', 0.1, 200),
  drop: () => tone(700, 0.35, 'sine', 0.08, -500),
  ceiling: () => tone(90, 0.3, 'sawtooth', 0.08, -30),
  swap: () => tone(440, 0.05, 'sine', 0.06, 200),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.06), i * 110)),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 180)),
};

// ---------- Grid helpers ----------
const colsIn = (r) => (r % 2 ? COLS - 1 : COLS);
const inBounds = (r, c) => r >= 0 && r < MAX_ROWS && c >= 0 && c < colsIn(r);
const cellX = (r, c) => R + c * D + (r % 2 ? R : 0);
const ceilY = () => TOP + drops * ROW_H;
const cellY = (r) => ceilY() + R + r * ROW_H;

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

function forEachBubble(fn) {
  for (let r = 0; r < MAX_ROWS; r++)
    for (let c = 0; c < colsIn(r); c++)
      if (grid[r][c] >= 0) fn(r, c, grid[r][c]);
}

function colorsOnBoard() {
  const set = new Set();
  forEachBubble((r, c, col) => set.add(col));
  return [...set];
}

function sameColorGroup(r0, c0) {
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
function floatingBubbles() {
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
  forEachBubble((r, c) => { if (!seen.has(r * 16 + c)) out.push([r, c]); });
  return out;
}

// ---------- Stage generation ----------
const SHAPES = [
  () => true,                                                           // 꽉 찬 벽
  (r, c, x) => Math.abs(x - W / 2) <= W / 2 - r * R * 0.9 + 2,          // 역삼각형
  (r, c, x) => r < 2 || Math.floor(x / (D * 2)) % 2 === 0,              // 기둥
  (r, c, x, rows) => r < rows - 1 - Math.round(1.5 + 1.5 * Math.sin(x / 38)), // 물결
  (r, c) => !(r % 3 === 2 && c % 3 === 1),                              // 구멍 숭숭
  (r, c, x) => r < 2 || Math.abs(x - W / 2) > r * R * 0.7,              // V 자
];

function makeStage(n) {
  const nColors = Math.min(3 + Math.floor((n - 1) / 2), n >= 10 ? 7 : 6);
  const rows = Math.min(4 + Math.floor((n - 1) / 2), 8);
  const shape = SHAPES[(n - 1) % SHAPES.length];
  const palette = shuffle([...COLORS.keys()]).slice(0, nColors);
  grid = emptyGrid();
  drops = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < colsIn(r); c++) {
      if (!shape(r, c, cellX(r, c), rows)) continue;
      // 이웃 색을 이어받아 뭉치게 만든다 → 연쇄를 노릴 만한 판
      const near = neighbors(r, c).map(([a, b]) => grid[a][b]).filter((v) => v >= 0);
      grid[r][c] = near.length && Math.random() < 0.5
        ? near[Math.floor(Math.random() * near.length)]
        : palette[Math.floor(Math.random() * palette.length)];
    }
  }
  for (const [r, c] of floatingBubbles()) grid[r][c] = -1;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomColor() {
  const on = colorsOnBoard();
  return on.length ? on[Math.floor(Math.random() * on.length)] : Math.floor(Math.random() * 3);
}

// ---------- Game state ----------
let state = 'title';   // title | play | clear | over | paused
let grid = emptyGrid();
let drops = 0;
let stage = 1, score = 0, best = Number(store.get('bubbleBest')) || 0;
let shotsPerDrop = 8, shotsSinceDrop = 0;
let cur = 0, nxt = 0;
let angle = Math.PI / 2;
let flying = null;
let idle = 0;
let shake = 0;
let clearTimer = 0;
let pops = [], falls = [], texts = [], sparks = [];
let keys = {};

function startGame() {
  stage = 1;
  score = 0;
  loadStage();
}

function loadStage() {
  makeStage(stage);
  shotsPerDrop = Math.max(5, 9 - Math.floor((stage - 1) / 2));
  shotsSinceDrop = 0;
  flying = null;
  idle = 0;
  cur = randomColor();
  nxt = randomColor();
  angle = Math.PI / 2;
  state = 'play';
  hideOverlay();
  updateHud();
}

function updateHud() {
  $('score').textContent = score.toLocaleString();
  $('stageNo').textContent = stage;
  if (score > best) { best = score; store.set('bubbleBest', String(best)); }
  $('best').textContent = best.toLocaleString();
}

// ---------- Shooting ----------
function fire() {
  if (state !== 'play' || flying) return;
  flying = { x: LX, y: LY, vx: Math.cos(angle), vy: -Math.sin(angle), color: cur };
  cur = nxt;
  nxt = randomColor();
  idle = 0;
  sfx.shoot();
}

function swap() {
  if (state !== 'play' || flying || cur === nxt) return;
  [cur, nxt] = [nxt, cur];
  sfx.swap();
}

function hitsBubble(x, y) {
  const top = ceilY() + R;
  const rMin = Math.max(0, Math.floor((y - top) / ROW_H) - 1);
  const rMax = Math.min(MAX_ROWS - 1, rMin + 3);
  for (let r = rMin; r <= rMax; r++) {
    const cy = top + r * ROW_H;
    for (let c = 0; c < colsIn(r); c++) {
      if (grid[r][c] < 0) continue;
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

const landed = (b) => b.y - R <= ceilY() || hitsBubble(b.x, b.y);

function updateFlying(dt) {
  let dist = SPEED * dt;
  while (dist > 0) {
    const s = Math.min(4, dist);
    dist -= s;
    if (advance(flying, s)) sfx.bounce();
    if (landed(flying)) { stick(flying); flying = null; return; }
  }
}

// 부딪힌 자리에서 가장 가까운 빈 칸(천장이나 다른 구슬에 붙어 있는)을 고른다.
function snapCell(x, y) {
  const r0 = Math.min(MAX_ROWS - 1, Math.max(0, Math.round((y - ceilY() - R) / ROW_H)));
  const c0 = Math.min(colsIn(r0) - 1, Math.max(0, Math.round((x - R - (r0 % 2 ? R : 0)) / D)));
  const cands = [[r0, c0], ...neighbors(r0, c0)];
  for (const [a, b] of neighbors(r0, c0)) cands.push(...neighbors(a, b));
  const attached = (r, c) => r === 0 || neighbors(r, c).some(([a, b]) => grid[a][b] >= 0);
  let bestCell = null, bestD = Infinity;
  for (const pass of [true, false]) {
    for (const [r, c] of cands) {
      if (grid[r][c] >= 0 || (pass && !attached(r, c))) continue;
      const d = (x - cellX(r, c)) ** 2 + (y - cellY(r)) ** 2;
      if (d < bestD) { bestD = d; bestCell = [r, c]; }
    }
    if (bestCell) return bestCell;
  }
  return [r0, c0];
}

function stick(b) {
  const [r, c] = snapCell(b.x, b.y);
  grid[r][c] = b.color;
  sfx.stick();

  const group = sameColorGroup(r, c);
  if (group.length >= 3) {
    group.forEach(([a, bb], i) => {
      pops.push({ x: cellX(a, bb), y: cellY(a), color: grid[a][bb], t: -i * 0.035 });
      setTimeout(() => sfx.pop(Math.min(i, 10)), i * 35);
      grid[a][bb] = -1;
    });
    let gained = group.length * 10;
    const floating = floatingBubbles();
    if (floating.length) {
      floating.forEach(([a, bb]) => {
        falls.push({ x: cellX(a, bb), y: cellY(a), vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 200, color: grid[a][bb], delay: 0 });
        grid[a][bb] = -1;
      });
      // 떨어뜨린 개수만큼 두 배씩 불어나는 보너스 (원작 규칙). 원작의 17개 상한은 점수가 너무 튀어서 12개로 낮췄다.
      const bonus = 10 * 2 ** Math.min(floating.length, 12);
      gained += bonus;
      texts.push({ x: cellX(r, c), y: cellY(r) + 24, text: `${floating.length}개 낙하! +${bonus.toLocaleString()}`, t: 0, big: true });
      setTimeout(sfx.drop, 120);
    }
    texts.push({ x: cellX(r, c), y: cellY(r), text: `+${(group.length * 10).toLocaleString()}`, t: 0 });
    score += gained;
  }

  // 팔레트에서 사라진 색은 대기 구슬에서도 뺀다
  const on = colorsOnBoard();
  if (!on.length) { stageClear(); return; }
  if (!on.includes(cur)) cur = randomColor();
  if (!on.includes(nxt)) nxt = randomColor();

  shotsSinceDrop++;
  if (shotsSinceDrop >= shotsPerDrop) {
    shotsSinceDrop = 0;
    drops++;
    shake = 0.35;
    sfx.ceiling();
  }
  updateHud();
  checkGameOver();
}

function checkGameOver() {
  let dead = false;
  forEachBubble((r) => { if (r + drops >= DEAD_ROWS) dead = true; });
  if (!dead) return;
  state = 'over';
  sfx.over();
  let i = 0;
  forEachBubble((r, c, col) => {
    falls.push({ x: cellX(r, c), y: cellY(r), vx: (Math.random() - 0.5) * 120, vy: -80, color: col, delay: (MAX_ROWS - r) * 0.06 + (i++ % 3) * 0.02, grey: true });
    grid[r][c] = -1;
  });
  updateHud();
  setTimeout(() => showOverlay(`
    <h2 class="inked">GAME OVER</h2>
    <p class="big inked">${score.toLocaleString()}점</p>
    <p>STAGE ${stage}까지 도달${score >= best && score > 0 ? '<br>🏆 최고 기록!' : ''}</p>
    <button id="startBtn">다시 하기</button>`), 1400);
}

function stageClear() {
  const bonus = 1000 * stage;
  score += bonus;
  updateHud();
  state = 'clear';
  clearTimer = 0;
  sfx.clear();
  showOverlay(`
    <h2 class="inked">STAGE ${stage} CLEAR!</h2>
    <p class="big inked">보너스 +${bonus.toLocaleString()}</p>
    ${stage === 2 ? '<p>다음 스테이지부터 조준 가이드가<br><b>첫 번째 벽까지만</b> 보여요</p>' : ''}
    ${stage === 5 ? '<p>다음 스테이지부터 조준 가이드가<br><b>방향만</b> 보여요</p>' : ''}
    <button id="startBtn">다음 스테이지 ▶</button>`);
}

// ---------- Update ----------
function update(dt) {
  if (state === 'play') {
    const turn = 1.9 * dt;
    if (keys.ArrowLeft || keys.KeyA) angle += turn;
    if (keys.ArrowRight || keys.KeyD) angle -= turn;
    angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, angle));
    if (flying) updateFlying(dt);
    else if ((idle += dt) >= AUTO_FIRE) fire();
  }
  if (state === 'clear' && (clearTimer += dt) > 2.5) { stage++; loadStage(); }

  shake = Math.max(0, shake - dt);
  for (const p of pops) p.t += dt;
  pops = pops.filter((p) => p.t < 0.3);
  for (const f of falls) {
    if ((f.delay -= dt) > 0) continue;
    f.vy += 1600 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.x < R || f.x > W - R) f.vx = -f.vx;
  }
  falls = falls.filter((f) => f.y < H + R * 2);
  for (const t of texts) { t.t += dt; t.y -= 30 * dt; }
  texts = texts.filter((t) => t.t < 1.1);
}

// ---------- Aim guide ----------
// 스테이지가 오를수록 가이드가 짧아진다.
// 1~2: 반사 포함 착지점까지 / 3~5: 첫 벽까지만 / 6~: 발사대 앞 방향만
function aimPath() {
  const maxBounces = stage <= 2 ? 2 : 0;
  const maxTravel = stage <= 5 ? Infinity : 130;
  const b = { x: LX, y: LY, vx: Math.cos(angle), vy: -Math.sin(angle) };
  const pts = [];
  let bounces = 0, travelled = 0;
  for (let i = 0; i < 400; i++) {
    if (advance(b, 5) && ++bounces > maxBounces) break;
    if ((travelled += 5) > maxTravel) break;
    if (landed(b)) break;
    if (travelled % 20 === 0 && travelled > 30) pts.push([b.x, b.y]);
  }
  return pts;
}

// ---------- Drawing (작은 오락실 공통 스티커 스타일: 진한 테두리 + 아래 그림자 + Jua) ----------
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function panel(x, y, w, h, r, fill, lift = 4) {
  ctx.fillStyle = INK; roundRect(x, y + lift, w, h, r); ctx.fill();
  ctx.fillStyle = fill; roundRect(x, y, w, h, r); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK; roundRect(x, y, w, h, r); ctx.stroke();
}
function label(text, x, y, size, fill = '#fff', align = 'center', stroke = INK) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (stroke) { ctx.lineWidth = Math.max(3, size * 0.22); ctx.strokeStyle = stroke; ctx.strokeText(text, x, y); }
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawBubble(x, y, color, scale = 1, alpha = 1, grey = false) {
  const col = grey ? { base: '#8d88a8', hi: '#d3cfe6', lo: '#57527a' } : COLORS[color];
  const r = R * scale - 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 아래로 살짝 떨어진 진한 그림자 + 테두리 → 스티커 구슬
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(x, y + 1.5, r + 0.5, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, col.hi);
  g.addColorStop(0.45, col.base);
  g.addColorStop(1, col.lo);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.28, y + r * 0.34, r * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBackground() {
  // 밝은 연보라 바닥 + 물방울 무늬 (알록달록한 구슬이 잘 보이게)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f6f3ff');
  g.addColorStop(1, '#ddd3ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(107,92,255,.07)';
  for (let y = 0; y < H; y += 26)
    for (let x = (y / 26) % 2 ? 13 : 0; x < W; x += 26) { ctx.beginPath(); ctx.arc(x + 6, y + 6, 3.5, 0, Math.PI * 2); ctx.fill(); }
}

function drawCeiling() {
  const y = ceilY();
  // 노란 천장 판 + 볼트, 아래 끝에 경고 줄무늬
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, 0, W, y);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(0, 0, W, Math.min(6, y));
  for (let row = 0; row <= drops; row++) {
    const by = 9 + row * ROW_H;
    if (by > y - 12) break;
    for (let x = 16; x < W; x += 40) {
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, by, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(x - 0.8, by - 0.8, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y - 8, W, 8); ctx.clip();
  for (let x = -16; x < W + 16; x += 16) {
    ctx.fillStyle = (x / 16) % 2 ? '#ffd23f' : INK;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y - 8); ctx.lineTo(x + 16, y - 8); ctx.lineTo(x + 8, y); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.fillRect(0, y - 1, W, 3);
}

function drawDeadline() {
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(6, DEAD_Y); ctx.lineTo(W - 6, DEAD_Y); ctx.stroke();
  ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(6, DEAD_Y); ctx.lineTo(W - 6, DEAD_Y); ctx.stroke();
  ctx.restore();
}

function drawLauncher() {
  // 조준 가이드: 테두리 두른 점
  if (state === 'play' && !flying) {
    const pts = aimPath();
    pts.forEach(([x, y], i) => {
      ctx.globalAlpha = Math.max(0.2, 0.95 - i * 0.03);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS[cur].base;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // 받침: 흰 반원 스티커
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(LX, LY + 10, 36, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(LX, LY + 6, 34, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();

  // 화살표
  ctx.save();
  ctx.translate(LX, LY);
  ctx.rotate(-angle);
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(44, -11);
  ctx.lineTo(44, -4.5);
  ctx.lineTo(0, -4.5);
  ctx.lineTo(0, 4.5);
  ctx.lineTo(44, 4.5);
  ctx.lineTo(44, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (state === 'play' || state === 'paused') {
    if (!flying) drawBubble(LX, LY, cur);
    // NEXT: 흰 말풍선
    panel(NEXT_X - 26, NEXT_Y - 36, 52, 58, 16, '#ffffff', 3);
    label('NEXT', NEXT_X, NEXT_Y - 24, 11, INK, 'center', null);
    drawBubble(NEXT_X, NEXT_Y + 2, nxt, 0.8);

    // 천장이 내려오기까지 남은 발사 수
    const left = shotsPerDrop - shotsSinceDrop;
    panel(W - 72, NEXT_Y - 36, 52, 58, 16, left <= 2 ? '#ffd0da' : '#ffffff', 3);
    label('천장', W - 46, NEXT_Y - 24, 11, INK, 'center', null);
    label(`${left}`, W - 46, NEXT_Y + 4, 22, left <= 2 ? '#ff3b5c' : '#ffd23f');
  }
}

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 6 * shake / 0.35, 0);
  // 천장 내려오기 두 발 전부터 부들부들
  const warn = state === 'play' && shotsPerDrop - shotsSinceDrop <= 1;
  drawBackground();
  drawDeadline();

  ctx.save();
  if (warn) ctx.translate(Math.sin(performance.now() / 30) * 1.2, 0);
  drawCeiling();
  forEachBubble((r, c, col) => drawBubble(cellX(r, c), cellY(r), col));
  ctx.restore();

  for (const p of pops) {
    if (p.t < 0) { drawBubble(p.x, p.y, p.color); continue; }
    const k = p.t / 0.3;
    drawBubble(p.x, p.y, p.color, 1 + k * 0.5, 1 - k);
    ctx.globalAlpha = 1 - k;
    ctx.lineCap = 'round';
    for (const [lw, col] of [[5, INK], [2.5, COLORS[p.color].base]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * R * (0.9 + k), p.y + Math.sin(a) * R * (0.9 + k));
        ctx.lineTo(p.x + Math.cos(a) * R * (1.2 + k * 1.2), p.y + Math.sin(a) * R * (1.2 + k * 1.2));
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }
  for (const f of falls) drawBubble(f.x, f.y, f.color, 1, 1, f.grey);
  if (flying) drawBubble(flying.x, flying.y, flying.color);

  drawLauncher();

  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (1.1 - t.t) * 3);
    label(t.text, t.x, t.y, t.big ? 20 : 16, t.big ? '#ffd23f' : '#fff');
  }
  ctx.globalAlpha = 1;

  // 자동 발사 카운트다운
  if (state === 'play' && !flying && idle > AUTO_FIRE - AUTO_WARN) {
    label(`${Math.ceil(AUTO_FIRE - idle)}`, LX, LY - 74, 44, '#ffd23f');
  }
  ctx.restore();
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (state !== 'paused') update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- Overlay ----------
function showOverlay(html) {
  const o = $('overlay');
  o.innerHTML = html;
  o.classList.remove('hidden');
  const btn = $('startBtn');
  if (btn) btn.onclick = onOverlayButton;
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function onOverlayButton() {
  if (state === 'clear') { stage++; loadStage(); }
  else if (state === 'paused') resume();
  else startGame();
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2 class="inked">일시정지</h2><button id="startBtn">계속하기</button>`);
}
function resume() {
  if (state !== 'paused') return;
  state = 'play';
  hideOverlay();
}

// ---------- Input ----------
function toLocal(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height)];
}
function aimAt(x, y) {
  const a = Math.atan2(LY - y, x - LX);
  angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, y > LY ? (x < LX ? MAX_ANGLE : MIN_ANGLE) : a));
}
const onNext = (x, y) => Math.hypot(x - NEXT_X, y - NEXT_Y) < R + 8;

let pointerAiming = false;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  const [x, y] = toLocal(e);
  if (onNext(x, y)) { swap(); return; }
  pointerAiming = true;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  aimAt(x, y);
  idle = 0;
});
canvas.addEventListener('pointermove', (e) => {
  if (state !== 'play') return;
  // 마우스는 항상 따라가고, 터치는 누르고 있을 때만 조준
  if (e.pointerType !== 'mouse' && !pointerAiming) return;
  const [x, y] = toLocal(e);
  aimAt(x, y);
});
// 아이폰 등에서는 브라우저가 터치를 스크롤·제스처로 가져가면 pointerup 대신 pointercancel 을 보낸다.
// 예전엔 취소되면 그냥 버려서, 손을 뗐는데도 발사가 안 돼 '탭이 안 먹는' 것처럼 느껴졌다.
// → 취소돼도 뗀 것으로 치고, 혹시 포인터 이벤트가 빠져도 touchend 로 한 번 더 처리한다 (두 번 불려도 한 번만 발사).
// 캔버스 위 터치는 스크롤·확대로 쓰지 말라고 브라우저에 알린다.
function releaseAim() {
  if (!pointerAiming) return;
  pointerAiming = false;
  fire();
}
canvas.addEventListener('pointerup', releaseAim);
canvas.addEventListener('pointercancel', releaseAim);
canvas.addEventListener('touchend', releaseAim, { passive: true });
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    if (state === 'play') fire();
    else if (state !== 'over' || !$('overlay').classList.contains('hidden')) onOverlayButton();
  }
  if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'KeyC') swap();
  if (e.code === 'KeyP' || e.code === 'Escape') state === 'paused' ? resume() : pause();
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { keys = {}; pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('bubbleMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// 타이틀 화면 뒤에 깔아둘 판
makeStage(1);
updateHud();
fit();
requestAnimationFrame(frame);
