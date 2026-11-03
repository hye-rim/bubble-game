'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 보글보글: 화면·입력·소리. 규칙(격자·쏘기·터뜨리기·천장·스테이지)은 logic.js (LOGIC_BUBBLE) 에 있고,
// 여기서는 규칙이 남긴 st.events 를 보고 소리·터지는 효과·글씨·안내창을 만든다.
const L = LOGIC_BUBBLE;
const { R, ROW_H, W, H, DEAD_Y, LX, LY, AUTO_FIRE, AUTO_WARN, cellX } = L;
const NEXT_X = 46, NEXT_Y = LY + 6;

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  boom: () => { tone(150, 0.4, 'sawtooth', 0.13, -90); tone(95, 0.45, 'square', 0.09, -50); },
  bolt: () => { tone(1400, 0.18, 'sawtooth', 0.09, -1100); setTimeout(() => tone(900, 0.15, 'square', 0.07, -600), 60); },
  rainbow: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.1), i * 70)),
  special: () => tone(660, 0.12, 'triangle', 0.08, 400),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.06), i * 110)),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 180)),
};

// ---------- Game state ----------
let state = 'title';   // title | play | clear | over | paused
const BEST_KEY = { classic: 'bubbleBest', items: 'bubbleItemBest' };   // 기본 모드 기록은 로비가 보여 주는 bubbleBest 그대로
let mode = 'classic', lastMode = 'classic';                       // classic | items (아이템 모드: 폭탄·무지개·번개 구슬)
let best = Number(store.get(BEST_KEY.classic)) || 0;
let G = L.newGame();   // 타이틀 화면 뒤에 깔아둘 판
let shake = 0;
let flashes = [];      // 번개·폭탄이 터질 때의 번쩍임
let clearTimer = 0;
let pops = [], falls = [], texts = [];
let keys = {};

function startGame(m) {
  mode = m === 'items' ? 'items' : 'classic';
  lastMode = mode;
  best = Number(store.get(BEST_KEY[mode])) || 0;
  G = L.newGame(Math.random, { items: mode === 'items' });
  enterStage();
}
function nextStage() {
  L.nextStage(G);
  enterStage();
}
function enterStage() {
  state = 'play';
  hideOverlay();
  updateHud();
}

function updateHud() {
  $('score').textContent = G.score.toLocaleString();
  $('stageNo').textContent = G.stage;
  if (G.score > best) { best = G.score; store.set(BEST_KEY[mode], String(best)); }
  $('best').textContent = best.toLocaleString();
}

function fire() { if (state === 'play') { L.fire(G); handleEvents(); } }
function swap() { if (state === 'play') { L.swap(G); handleEvents(); } }

// 규칙이 남긴 일들 → 소리·효과·글씨·안내창
function handleEvents() {
  if (!G.events.length) return;
  for (const e of G.events.splice(0)) {
    tutorialSignal(e.type);
    if (e.type === 'shoot') sfx.shoot();
    else if (e.type === 'swap') sfx.swap();
    else if (e.type === 'bounce') sfx.bounce();
    else if (e.type === 'stick') { sfx.stick(); if (e.special === L.RAINBOW) { sfx.rainbow(); texts.push({ x: cellX(e.r, e.c), y: L.cellY(G, e.r), text: '🌈', t: 0, big: true }); } }
    else if (e.type === 'special') {
      if (e.kind === L.BOMB) { shake = 0.35; sfx.boom(); flashes.push({ kind: 'bomb', x: e.x, y: e.y, t: 0 }); }
      else if (e.kind === L.BOLT) { shake = 0.25; sfx.bolt(); flashes.push({ kind: 'bolt', y: e.y, t: 0 }); }
      texts.push({ x: e.x, y: e.y - 26, text: e.count ? `${e.kind === L.BOMB ? '💣 펑!' : '⚡ 번쩍!'} ${e.count}개` : (e.kind === L.BOMB ? '💣 불발' : '⚡ 불발'), t: 0, big: true });
    } else if (e.type === 'pop') {
      e.cells.forEach((p, i) => {
        pops.push({ x: p.x, y: p.y, color: p.color, t: -i * 0.035 });
        setTimeout(() => sfx.pop(Math.min(i, 10)), i * 35);
      });
      texts.push({ x: e.x, y: e.y, text: `+${e.gain.toLocaleString()}`, t: 0 });
    } else if (e.type === 'drop') {
      for (const p of e.cells) falls.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 200, color: p.color, delay: 0 });
      texts.push({ x: e.x, y: e.y + 24, text: `${e.cells.length}개 낙하! +${e.bonus.toLocaleString()}`, t: 0, big: true });
      setTimeout(sfx.drop, 120);
    } else if (e.type === 'ceiling') { shake = 0.35; sfx.ceiling(); }
    else if (e.type === 'over') gameOver(e.cells);
    else if (e.type === 'clear') stageClear(e.bonus);
  }
  updateHud();
}

function gameOver(cells) {
  state = 'over';
  sfx.over();
  cells.forEach((p, i) => {
    falls.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 120, vy: -80, color: p.color, delay: (L.MAX_ROWS - p.r) * 0.06 + (i % 3) * 0.02, grey: true });
  });
  setTimeout(() => showOverlay(`
    <h2 class="inked">GAME OVER</h2>
    <p class="big inked">${G.score.toLocaleString()}점</p>
    <p>${mode === 'items' ? '🎁 아이템 모드 · ' : ''}STAGE ${G.stage}까지 도달${G.score >= best && G.score > 0 ? '<br>🏆 최고 기록!' : ''}</p>
    <button id="startBtn" data-mode="${mode}">다시 하기</button>
    <button id="otherBtn" class="sub" data-mode="${mode === 'items' ? 'classic' : 'items'}">${mode === 'items' ? '기본 모드로' : '🎁 아이템 모드로'}</button>`), 1400);
}

function stageClear(bonus) {
  state = 'clear';
  clearTimer = 0;
  sfx.clear();
  showOverlay(`
    <h2 class="inked">STAGE ${G.stage} CLEAR!</h2>
    <p class="big inked">보너스 +${bonus.toLocaleString()}</p>
    ${G.stage === 2 ? '<p>다음 스테이지부터 조준 가이드가<br><b>첫 번째 벽까지만</b> 보여요</p>' : ''}
    ${G.stage === 5 ? '<p>다음 스테이지부터 조준 가이드가<br><b>방향만</b> 보여요</p>' : ''}
    <button id="startBtn">다음 스테이지 ▶</button>`);
}

// ---------- Update ----------
function update(dt) {
  if (state === 'play') {
    L.update(G, dt, { left: keys.ArrowLeft || keys.KeyA, right: keys.ArrowRight || keys.KeyD });
    handleEvents();
  }
  if (state === 'clear' && (clearTimer += dt) > 2.5) nextStage();

  shake = Math.max(0, shake - dt);
  for (const f of flashes) f.t += dt;
  flashes = flashes.filter((f) => f.t < 0.35);
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

// 특수 구슬 그림: 폭탄(까만 몸+도화선) · 무지개(여섯 빛깔 부채꼴) · 번개(노란 몸+번개 무늬)
function drawSpecialBubble(x, y, code, scale = 1, alpha = 1) {
  const r = R * scale - 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y + 1.5, r + 0.5, 0, Math.PI * 2); ctx.fill();
  if (code === L.RAINBOW) {
    const cols = ['#ff4d6d', '#ff9f1c', '#ffd93d', '#4cd964', '#3fa7ff', '#b066ff'];
    const spin = performance.now() / 1200;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r - 1, spin + (i / 6) * Math.PI * 2, spin + ((i + 1) / 6) * Math.PI * 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.26, 0, Math.PI * 2); ctx.fill();
  } else if (code === L.BOLT) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff6a8'); g.addColorStop(0.5, '#ffd93d'); g.addColorStop(1, '#d99a00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath();
    ctx.moveTo(x + r * 0.12, y - r * 0.68); ctx.lineTo(x - r * 0.42, y + r * 0.08); ctx.lineTo(x - r * 0.02, y + r * 0.08);
    ctx.lineTo(x - r * 0.16, y + r * 0.7); ctx.lineTo(x + r * 0.44, y - r * 0.12); ctx.lineTo(x + r * 0.04, y - r * 0.12);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#2a2a38'; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b08850'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + r * 0.2, y - r * 0.85); ctx.quadraticCurveTo(x + r * 0.5, y - r * 1.2, x + r * 0.8, y - r * 1.05); ctx.stroke();
    const f = 0.7 + 0.3 * Math.sin(performance.now() / 70);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x + r * 0.82, y - r * 1.07, 4.5 * f, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5a1a'; ctx.beginPath(); ctx.arc(x + r * 0.82, y - r * 1.07, 2.4 * f, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawBubble(x, y, color, scale = 1, alpha = 1, grey = false) {
  if (L.isSpecial(color)) { drawSpecialBubble(x, y, color, scale, alpha); return; }
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
  const y = L.ceilY(G);
  // 노란 천장 판 + 볼트, 아래 끝에 경고 줄무늬
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, 0, W, y);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(0, 0, W, Math.min(6, y));
  for (let row = 0; row <= G.drops; row++) {
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
  if (state === 'play' && !G.flying) {
    const pts = L.aimPath(G);
    pts.forEach(([x, y], i) => {
      ctx.globalAlpha = Math.max(0.2, 0.95 - i * 0.03);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = L.isSpecial(G.cur) ? '#ffffff' : COLORS[G.cur].base;
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
  ctx.rotate(-G.angle);
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
    if (!G.flying) drawBubble(LX, LY, G.cur);
    // NEXT: 흰 말풍선
    panel(NEXT_X - 26, NEXT_Y - 36, 52, 58, 16, '#ffffff', 3);
    label('NEXT', NEXT_X, NEXT_Y - 24, 11, INK, 'center', null);
    drawBubble(NEXT_X, NEXT_Y + 2, G.nxt, 0.8);

    // 천장이 내려오기까지 남은 발사 수
    const left = G.shotsPerDrop - G.shotsSinceDrop;
    panel(W - 72, NEXT_Y - 36, 52, 58, 16, left <= 2 ? '#ffd0da' : '#ffffff', 3);
    label('천장', W - 46, NEXT_Y - 24, 11, INK, 'center', null);
    label(`${left}`, W - 46, NEXT_Y + 4, 22, left <= 2 ? '#ff3b5c' : '#ffd23f');
  }
}

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 6 * shake / 0.35, 0);
  // 천장 내려오기 두 발 전부터 부들부들
  const warn = state === 'play' && G.shotsPerDrop - G.shotsSinceDrop <= 1;
  drawBackground();
  drawDeadline();

  ctx.save();
  if (warn) ctx.translate(Math.sin(performance.now() / 30) * 1.2, 0);
  drawCeiling();
  L.forEachBubble(G.grid, (r, c, col) => drawBubble(cellX(r, c), L.cellY(G, r), col));
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
  for (const f of flashes) {
    const k = f.t / 0.35, a = Math.max(0, 1 - k);
    ctx.save(); ctx.globalAlpha = a;
    if (f.kind === 'bolt') {
      ctx.fillStyle = '#fffbd0'; ctx.fillRect(0, f.y - R * (0.9 - k * 0.5), W, R * 1.8 * (1 - k * 0.5));
      ctx.strokeStyle = '#ffd93d'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let x = 0; x <= W; x += 20) { const yy = f.y + Math.sin(x * 0.7 + f.t * 40) * 9; x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = 7 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, R * (0.8 + k * 3.2), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,230,140,.6)'; ctx.beginPath(); ctx.arc(f.x, f.y, R * (0.6 + k * 2.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  for (const f of falls) drawBubble(f.x, f.y, f.color, 1, 1, f.grey);
  if (G.flying) drawBubble(G.flying.x, G.flying.y, G.flying.color);

  drawLauncher();

  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (1.1 - t.t) * 3);
    label(t.text, t.x, t.y, t.big ? 20 : 16, t.big ? '#ffd23f' : '#fff');
  }
  ctx.globalAlpha = 1;

  // 자동 발사 카운트다운
  if (state === 'play' && !G.flying && G.idle > AUTO_FIRE - AUTO_WARN) {
    label(`${Math.ceil(AUTO_FIRE - G.idle)}`, LX, LY - 74, 44, '#ffd23f');
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
  o.querySelectorAll('button').forEach((b) => { b.onclick = onOverlayButton; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function onOverlayButton(e) {
  if (state === 'clear') nextStage();
  else if (state === 'paused') resume();
  else startGame((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || lastMode);   // 단추에 적힌 모드로, 키보드로 누르면 마지막 모드로
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
  L.aim(G, y > LY ? (x < LX ? L.MAX_ANGLE : L.MIN_ANGLE) : a);
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
  G.idle = 0;
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
$('itemBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

updateHud();
fit();
requestAnimationFrame(frame);
