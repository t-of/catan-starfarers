'use strict';
import * as E from './engine.js';
import * as CPU from './cpu.js';
import * as I from './illust.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'catan-starfarers.' で始める。
const STORE = 'catan-starfarers.';
function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'catan-starfarers', text: '母船を振って速さを決め、植民船と交易船で星々へ。植民地を広げ15点を目指す3〜4人のボードゲームの試作。CPUと遊べます。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- 音（RULES.md §5）----
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
let audioCtx = null;
let soundOn = load('soundOn', true);
function beep(freq, dur) {
  if (!soundOn) return;
  try {
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); setAudioSession(true); }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch { /* 音が出せなくても遊べる */ }
}
const SOUND = {
  dice: () => beep(340, 0.12),
  build: () => beep(520, 0.1),
  trade: () => beep(460, 0.1),
  rob: () => beep(220, 0.2),
  shake: () => beep(300, 0.08),
  reveal: () => beep(500, 0.06),
  clear: () => { beep(600, 0.08); setTimeout(() => beep(760, 0.1), 90); setTimeout(() => beep(920, 0.12), 180); },
  move: () => beep(700, 0.03),
  shortage: () => beep(180, 0.08),
  win: () => { beep(660, 0.15); setTimeout(() => beep(880, 0.25), 140); },
  encounter: () => { beep(200, 0.12); setTimeout(() => beep(160, 0.16), 120); },
  encWin: () => { beep(500, 0.09); setTimeout(() => beep(700, 0.12), 90); },
  encLose: () => { beep(400, 0.09); setTimeout(() => beep(260, 0.14), 90); },
  jump: () => { beep(500, 0.05); setTimeout(() => beep(900, 0.1), 60); },
  friend: () => { beep(440, 0.3); beep(554, 0.3); beep(659, 0.3); },
};
function playEvents() {
  if (!game) return;
  game.events.forEach((e) => { if (SOUND[e]) SOUND[e](); });
  game.events = [];
}
const soundBtn = document.getElementById('soundBtn');
function syncSoundBtn() { soundBtn.textContent = soundOn ? '音 オン' : '音 オフ'; soundBtn.setAttribute('aria-pressed', String(soundOn)); }
soundBtn.addEventListener('click', () => { soundOn = !soundOn; save('soundOn', soundOn); setAudioSession(soundOn); syncSoundBtn(); });
syncSoundBtn();

// ---- 要素 ----
const els = {
  homeBtn: document.getElementById('homeBtn'),
  setupPanel: document.getElementById('setupPanel'),
  gamePanel: document.getElementById('gamePanel'),
  playerCountPicker: document.getElementById('playerCountPicker'),
  seatsPanel: document.getElementById('seatsPanel'),
  startBtn: document.getElementById('startBtn'),
  continueBtn: document.getElementById('continueBtn'),
  turnNum: document.getElementById('turnNum'),
  playersBar: document.getElementById('playersBar'),
  bankPanel: document.getElementById('bankPanel'),
  logPanel: document.getElementById('logPanel'),
  board: document.getElementById('board'),
  hint: document.getElementById('hint'),
  banner: document.getElementById('banner'),
  handCount: document.getElementById('handCount'),
  handBar: document.getElementById('handBar'),
  upgradeBar: document.getElementById('upgradeBar'),
  friendBar: document.getElementById('friendBar'),
  buildGrid: document.getElementById('buildGrid'),
  actionBar: document.getElementById('actionBar'),
  diceBtn: document.getElementById('diceBtn'),
  tradeBtn: document.getElementById('tradeBtn'),
  flyBtn: document.getElementById('flyBtn'),
  endTurnBtn: document.getElementById('endTurnBtn'),
  panelOverlay: document.getElementById('panelOverlay'),
  panel: document.getElementById('panel'),
};

// ---- 席の設定 ----
function defaultSeat(i) { return { type: i === 0 ? 'human' : 'cpu', name: '' }; }
function sanitizeName(s) { return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 10); }
const SEAT_SLOTS = [0, 1, 2, 3];
let playerCount = load('playerCount', 3);
let uiSeats = load('seats', null) || SEAT_SLOTS.map(defaultSeat);
let seats = uiSeats.slice(0, playerCount).map((s) => ({ ...s }));

function isCpuSeat(i) { return !!(seats[i] && seats[i].type === 'cpu'); }
function isHumanSeat(i) { return !isCpuSeat(i); }

function syncCountPicker() {
  [...els.playerCountPicker.children].forEach((b) => b.classList.toggle('is-selected', Number(b.dataset.count) === playerCount));
}
els.playerCountPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-count]');
  if (!btn) return;
  playerCount = Number(btn.dataset.count);
  save('playerCount', playerCount);
  seats = uiSeats.slice(0, playerCount).map((s) => ({ ...s }));
  syncCountPicker();
  renderSeatsPanel();
});
syncCountPicker();

function renderSeatsPanel() {
  els.seatsPanel.innerHTML = '';
  seats.forEach((seat, i) => {
    const row = document.createElement('div');
    row.className = 'seat-row';
    const dot = document.createElement('span');
    dot.className = 'seat-row__dot';
    dot.style.background = I.PLAYER_COLORS[i];
    row.appendChild(dot);
    const name = document.createElement('input');
    name.className = 'seat-row__name';
    name.placeholder = `プレイヤー${i + 1}`;
    name.value = seat.name || '';
    name.maxLength = 10;
    name.addEventListener('input', () => { seat.name = sanitizeName(name.value); uiSeats[i] = { ...seat }; save('seats', uiSeats); });
    row.appendChild(name);
    const type = document.createElement('div');
    type.className = 'seat-row__type';
    ['human', 'cpu'].forEach((t) => {
      const b = document.createElement('button');
      b.className = `btn${seat.type === t ? ' is-selected' : ''}`;
      b.textContent = t === 'human' ? '人' : 'CPU';
      b.addEventListener('click', () => { seat.type = t; uiSeats[i] = { ...seat }; save('seats', uiSeats); renderSeatsPanel(); });
      type.appendChild(b);
    });
    row.appendChild(type);
    els.seatsPanel.appendChild(row);
  });
}
renderSeatsPanel();

const CPU_SPEEDS = [['ふつう', 500], ['はやい', 120], ['最速', 0]];
let cpuSpeed = load('cpuSpeed', 0);
const cpuSpeedBtn = document.getElementById('cpuSpeedBtn');
function showCpuSpeed() { cpuSpeedBtn.textContent = 'CPU ' + CPU_SPEEDS[cpuSpeed][0]; }
cpuSpeedBtn.addEventListener('click', () => { cpuSpeed = (cpuSpeed + 1) % CPU_SPEEDS.length; save('cpuSpeed', cpuSpeed); showCpuSpeed(); });
showCpuSpeed();

// 遊び方ダイアログ(30秒でわかる短い説明)
const helpDialog = document.getElementById('helpDialog');
document.getElementById('helpBtn').addEventListener('click', () => helpDialog.showModal());
document.getElementById('helpCloseBtn').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (e) => { if (e.target === helpDialog) helpDialog.close(); });

// ---- ゲームの状態 ----
let game = null;
let ui = { mode: 'idle', selectedShip: null, data: {} };
let turnPassAckKey = null; // 最後に「はじめる」を押した合図（これと違えば渡す画面を出す）

function migrateGame(g) {
  if (!g || g.rulesVersion !== 2) return null; // 試作のあいだは形が大きく違えば消す（9章）。作業3aでrulesVersionを2に上げた
  // 保険: 作業3a以降に足したフィールドが欠けていたら補う
  if (g.pendingFriendship === undefined) g.pendingFriendship = null;
  if (!g.pendingGalacticFund) g.pendingGalacticFund = [];
  g.players.forEach((p) => {
    if (p.tradeShipMarkers == null) p.tradeShipMarkers = 0;
    if (!p.friendCards) p.friendCards = [];
    if (!p.oncePerTurn) p.oncePerTurn = { fameForSale: false, helpingHand: false, exchange11goods: false };
  });
  return g;
}

function showGame() { els.setupPanel.hidden = true; els.gamePanel.hidden = false; els.homeBtn.hidden = false; }
function showSetup() { els.setupPanel.hidden = false; els.gamePanel.hidden = true; els.homeBtn.hidden = true; }

els.startBtn.addEventListener('click', () => {
  const names = seats.map((s) => s.name || '');
  game = E.createGame(playerCount, Math.random, { names });
  save('gameSeats', seats);
  ui = { mode: 'idle', selectedShip: null, data: {} };
  turnPassAckKey = null;
  showGame();
  persistAndRender();
});
els.continueBtn.addEventListener('click', () => {
  const saved = migrateGame(load('game', null));
  if (!saved) { els.continueBtn.hidden = true; return; }
  game = saved;
  seats = load('gameSeats', seats);
  turnPassAckKey = null;
  showGame();
  renderAll();
  scheduleCpu();
});
(function checkContinue() {
  const saved = migrateGame(load('game', null));
  els.continueBtn.hidden = !saved || saved.winner != null;
})();
els.homeBtn.addEventListener('click', () => {
  clearCpuTimer();
  game = null;
  showSetup();
});

function persistAndRender() {
  if (game) save('game', game);
  playEvents();
  renderAll();
  scheduleCpu();
}

// ---- CPU の自動進行 ----
let cpuTimer = null;
function clearCpuTimer() { if (cpuTimer) { clearTimeout(cpuTimer); cpuTimer = null; } }
function scheduleCpu() {
  clearCpuTimer();
  if (!game || game.phase === 'gameOver') return;
  const delay = CPU_SPEEDS[cpuSpeed][1];
  if (game.phase === 'discard') {
    const pending = game.pendingDiscards.find((d) => isCpuSeat(d.player));
    if (pending) cpuTimer = setTimeout(() => { CPU.cpuDiscardOne(game, pending.player); persistAndRender(); }, delay);
    return;
  }
  if (game.phase === 'encounter') {
    const enc = game.encounter;
    if (enc && enc.pending && isCpuSeat(enc.idx)) {
      cpuTimer = setTimeout(() => { CPU.cpuResolveEncounter(game); persistAndRender(); }, delay);
    }
    return;
  }
  if (game.phase === 'encounterWear') {
    const w = game.pendingWear[0];
    const d = !w ? game.pendingWearDiscards[0] : null;
    const targetPlayer = w ? w.player : (d ? d.player : null);
    if (targetPlayer != null && isCpuSeat(targetPlayer)) {
      cpuTimer = setTimeout(() => { CPU.cpuResolveWearOne(game); persistAndRender(); }, delay);
    }
    return;
  }
  if (game.phase === 'galacticFund') {
    const pending = game.pendingGalacticFund.find((d) => isCpuSeat(d.player));
    if (pending) cpuTimer = setTimeout(() => { E.resolveGalacticFund(game, pending.player, E.RESOURCES[Math.floor(Math.random() * E.RESOURCES.length)]); persistAndRender(); }, delay);
    return;
  }
  const idx = E.currentPlayer(game);
  if (isHumanSeat(idx)) return; // 人の番・人の選ぶ場面は画面の操作を待つ
  if (game.phase.startsWith('setup')) { cpuTimer = setTimeout(() => { CPU.cpuSetupTurn(game); persistAndRender(); }, delay); return; }
  if (game.phase === 'steal') { cpuTimer = setTimeout(() => { CPU.cpuResolveSteal(game); persistAndRender(); }, delay); return; }
  if (game.phase === 'roll') { cpuTimer = setTimeout(() => { E.rollDice(game); persistAndRender(); }, delay); return; }
  if (game.phase === 'main' || game.phase === 'flight') {
    cpuTimer = setTimeout(() => {
      CPU.cpuPlayMainPhase(game);
      if (game.phase !== 'gameOver') CPU.cpuPlayFlight(game);
      if (game.phase !== 'gameOver') E.endTurn(game);
      persistAndRender();
    }, delay);
  }
}

// ================================================================
// 盤
// ================================================================
function freeSpaceportSites(idx) { return E.freeSpaceportSitesFor(game, idx); }
function highlightSet() {
  if (!game) return new Set();
  const idx = E.currentPlayer(game);
  if (!isHumanSeat(idx)) return new Set();
  if (game.phase === 'setupColony') return new Set(E.availableSetupColonySites(game));
  if (ui.mode === 'pickColonyShipSite' || ui.mode === 'pickTradeShipSite') return new Set(freeSpaceportSites(idx));
  if (ui.mode === 'pickSpaceportColony') return new Set(game.players[idx].colonies);
  if (game.phase === 'encounter' && game.encounter && game.encounter.pending && game.encounter.pending.kind === 'jumpTarget') {
    return new Set(E.spaceJumpTargets(game, game.encounter.pending.shipId));
  }
  if (game.phase === 'flight' && ui.selectedShip) return new Set(E.shipReachableStops(game, ui.selectedShip).keys());
  return new Set();
}
function selectedShipVertex() {
  if (!game || !ui.selectedShip) return null;
  const idx = E.currentPlayer(game);
  const ship = game.players[idx].ships.find((s) => s.id === ui.selectedShip);
  return ship ? ship.vertexId : null;
}
function onVertexTap(vid) {
  if (!game) return;
  const idx = E.currentPlayer(game);
  if (!isHumanSeat(idx)) return;
  if (game.phase === 'setupColony') { if (E.setupPlaceColony(game, vid)) persistAndRender(); return; }
  if (ui.mode === 'pickColonyShipSite') { if (E.buildColonyShip(game, vid)) { ui.mode = 'idle'; persistAndRender(); } return; }
  if (ui.mode === 'pickTradeShipSite') { if (E.buildTradeShip(game, vid)) { ui.mode = 'idle'; persistAndRender(); } return; }
  if (ui.mode === 'pickSpaceportColony') { if (E.buildSpaceport(game, vid)) { ui.mode = 'idle'; persistAndRender(); } return; }
  if (game.phase === 'encounter' && game.encounter && game.encounter.pending && game.encounter.pending.kind === 'jumpTarget') {
    if (E.encounterAnswer(game, { toVertexId: vid })) persistAndRender();
    return;
  }
  if (game.phase === 'flight') {
    const v = game.board.vertices[vid];
    if (ui.selectedShip) {
      const stops = E.shipReachableStops(game, ui.selectedShip);
      if (stops.has(vid)) {
        E.moveShip(game, ui.selectedShip, vid);
        const ship = game.players[idx].ships.find((s) => s.id === ui.selectedShip);
        if (!ship || ship.movesLeft <= 0) ui.selectedShip = null;
        persistAndRender();
        return;
      }
    }
    if (v.shipHere && v.shipHere.owner === idx) {
      const ship = game.players[idx].ships.find((s) => s.id === v.shipHere.shipId);
      if (ship && ship.movesLeft > 0) { ui.selectedShip = ship.id; renderAll(); }
    }
  }
}
function renderBoard() {
  I.renderBoard(els.board, game.board, { highlight: highlightSet(), selectedShipVertex: selectedShipVertex(), onVertexTap });
}

// ================================================================
// 画面まわりの描画
// ================================================================
function renderPlayers() {
  const idx = E.currentPlayer(game);
  els.playersBar.innerHTML = '';
  game.players.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = `player-card${i === idx ? ' is-turn' : ''}`;
    const dot = document.createElement('span'); dot.className = 'player-card__dot'; dot.style.background = I.PLAYER_COLORS[i];
    const body = document.createElement('div'); body.className = 'player-card__body';
    const name = document.createElement('div'); name.className = 'player-card__name'; name.textContent = E.playerName(game, i) + (isCpuSeat(i) ? '（CPU）' : '');
    const sub = document.createElement('div'); sub.className = 'player-card__sub';
    sub.textContent = `植民地${p.colonies.length}・宇宙港${p.spaceports.length}・交易所${p.tradeStations.length}・名声${p.fame}`;
    body.append(name, sub);
    const vp = document.createElement('div'); vp.className = 'player-card__vp'; vp.textContent = E.playerScore(game, i);
    card.append(dot, body, vp);
    els.playersBar.appendChild(card);
  });
}
function renderBank() {
  els.bankPanel.innerHTML = `<div class="panel__head"><span>銀行</span><span>予備の山 残り${game.reserve.length}</span></div>
    <div class="bank__grid">${E.RESOURCES.map((r) => `<div class="bank__res"><b>${game.bank[r]}</b>${E.RESOURCE_LABEL[r]}</div>`).join('')}</div>`;
}
function renderLog() {
  els.logPanel.innerHTML = game.log.slice(-40).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
}
function escapeHtml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderHand() {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  els.handCount.textContent = E.RESOURCES.reduce((a, r) => a + p.resources[r], 0) + '枚';
  els.handBar.innerHTML = E.RESOURCES.map((r) => `<div class="hand__res"><b>${p.resources[r]}</b>${E.RESOURCE_LABEL[r]}</div>`).join('');
  els.upgradeBar.innerHTML = `
    <span><b>${p.boosters}</b>ブースター（速さ+${p.boosters}）</span>
    <span><b>${p.cannons}</b>大砲（戦闘力+${p.cannons}）</span>
    <span><b>${p.pods}</b>貨物ポッド</span>`;
  renderFriendCards(p);
}
// 3.9: もっている友好カードと効き目を小さな札で見せる
function renderFriendCards(p) {
  if (!p.friendCards.length) { els.friendBar.innerHTML = ''; return; }
  els.friendBar.innerHTML = p.friendCards.map((id) => {
    const c = E.FRIEND_CARDS.find((x) => x.id === id);
    if (!c) return '';
    return `<div class="friend-chip"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.desc)}</small></div>`;
  }).join('');
}

function costText(cost) { return Object.entries(cost).map(([r, n]) => `${E.RESOURCE_LABEL[r]}${n}`).join(' '); }
function canAfford(res, cost) { return Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v); }

function renderBuildGrid() {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  const humanTurn = isHumanSeat(idx);
  const canMain = humanTurn && game.phase === 'main';
  const canAnytime = humanTurn && (game.phase === 'main' || game.phase === 'flight');
  const defs = [
    { key: 'colonyShip', label: '植民船', cost: E.COSTS.colonyShip, ok: canMain && p.shipsAvailable > 0 && p.ships.length < E.MAX_SHIPS_DEPLOYED && canAfford(p.resources, E.COSTS.colonyShip) && freeSpaceportSites(idx).length > 0 },
    { key: 'tradeShip', label: '交易船', cost: E.COSTS.tradeShip, ok: canMain && p.shipsAvailable > 0 && p.ships.length < E.MAX_SHIPS_DEPLOYED && canAfford(p.resources, E.COSTS.tradeShip) && freeSpaceportSites(idx).length > 0 },
    { key: 'spaceport', label: '宇宙港にする', cost: E.COSTS.spaceport, ok: canMain && p.colonies.length > 0 && p.spaceportSupply > 0 && canAfford(p.resources, E.COSTS.spaceport) },
    { key: 'booster', label: 'ブースター', cost: E.COSTS.booster, ok: canMain && p.boosters < E.MAX_BOOSTERS && canAfford(p.resources, E.COSTS.booster) },
    { key: 'cannon', label: '大砲', cost: E.COSTS.cannon, ok: canMain && p.cannons < E.MAX_CANNONS && canAfford(p.resources, E.COSTS.cannon) },
    { key: 'pod', label: '貨物ポッド', cost: E.COSTS.pod, ok: canMain && p.pods < E.MAX_PODS && canAfford(p.resources, E.COSTS.pod) },
    { key: 'buildColony', label: '植民地を建てる（着いた船で）', cost: {}, ok: canAnytime && p.ships.some((s) => E.canBuildColonyAt(game, s.id)) },
    { key: 'buildTradeStation', label: '交易所を建てる（着いた船で）', cost: {}, ok: canAnytime && p.ships.some((s) => E.canBuildTradeStationAt(game, s.id)) },
    { key: 'fameForSale', label: '商品→名声（友好カード）', cost: { goods: 1 }, ok: canMain && E.hasFriendCard(p, 'fameForSale') && !p.oncePerTurn.fameForSale && p.resources.goods >= 1 },
    { key: 'goodsExchange', label: '商品→好きな資源（友好カード）', cost: { goods: 1 }, ok: canMain && E.hasFriendCard(p, 'exchange11goods') && !p.oncePerTurn.exchange11goods && p.resources.goods >= 1 },
    { key: 'helpingHand', label: '助けの手（友好カード）', cost: {}, ok: canMain && E.helpingHandTargets(game).length >= 2 },
  ];
  els.buildGrid.innerHTML = '';
  defs.forEach((d) => {
    const btn = document.createElement('button');
    const active = ui.mode === `pick${d.key[0].toUpperCase()}${d.key.slice(1)}Site`;
    btn.className = `build-btn${active ? ' is-selected' : ''}`;
    btn.disabled = !d.ok;
    btn.innerHTML = `<span>${d.label}</span>${Object.keys(d.cost).length ? `<small>${costText(d.cost)}</small>` : ''}`;
    btn.addEventListener('click', () => {
      if (d.key === 'colonyShip') { ui.mode = 'pickColonyShipSite'; renderAll(); return; }
      if (d.key === 'tradeShip') { ui.mode = 'pickTradeShipSite'; renderAll(); return; }
      if (d.key === 'spaceport') { ui.mode = 'pickSpaceportColony'; renderAll(); return; }
      if (d.key === 'booster' || d.key === 'cannon' || d.key === 'pod') { E.buyUpgrade(game, d.key); persistAndRender(); return; }
      if (d.key === 'buildColony') { const s = p.ships.find((x) => E.canBuildColonyAt(game, x.id)); if (s) { E.buildColonyAt(game, s.id); ui.selectedShip = null; persistAndRender(); } return; }
      if (d.key === 'buildTradeStation') { const s = p.ships.find((x) => E.canBuildTradeStationAt(game, x.id)); if (s) { E.buildTradeStationAt(game, s.id); ui.selectedShip = null; persistAndRender(); } return; }
      if (d.key === 'fameForSale') { E.buyFameWithGoods(game); persistAndRender(); return; }
      if (d.key === 'goodsExchange') { ui.mode = 'pickGoodsExchange'; renderAll(); return; }
      if (d.key === 'helpingHand') { ui.mode = 'pickHelpingHand'; ui.data = { picked: [] }; renderAll(); return; }
    });
    els.buildGrid.appendChild(btn);
  });
}

function phaseHint(idx) {
  const name = E.playerName(game, idx);
  switch (game.phase) {
    case 'setupColony': return `${name}の番。植民地を置く場所をタップ`;
    case 'setupPort': return `${name}の番。宇宙港にする植民地を選ぶ`;
    case 'roll': return `${name}の番。サイコロをどうぞ`;
    case 'discard': return '捨て札を選んでいます…';
    case 'steal': return `${name}が盗む相手を選んでいます…`;
    case 'main': return `${name}の番。交易・建設のあと、母船を振って飛行へ`;
    case 'flight': return `${name}の番。船をタップ→行き先をタップ（速さ ${game.speed}）`;
    case 'encounter': {
      const enc = game.encounter;
      if (enc && enc.pending && enc.pending.kind === 'jumpTarget') return `${name}の番。宇宙ジャンプ！光っている交点をタップ`;
      return `${name}が遭遇中…`;
    }
    case 'encounterWear': return '摩耗：みんなの母船がすり減る…';
    case 'friendship': return `${E.playerName(game, game.pendingFriendship.player)}が友好カードを選んでいます…`;
    case 'galacticFund': return '銀河救援基金：もらえなかった人が資源を選んでいます…';
    case 'gameOver': return `${E.playerName(game, game.winner)} の勝ち！`;
    default: return '';
  }
}
function renderBanner() {
  const idx = E.currentPlayer(game);
  let extra = '';
  if (game.ballsShown) {
    const wrap = document.createElement('span');
    I.renderBalls(wrap, game.ballsShown);
    extra = wrap.innerHTML;
  }
  els.banner.innerHTML = `<div>${phaseHint(idx)}</div>${extra ? `<div>${extra}</div>` : ''}${renderEncounterBallsHtml()}<div class="message__log">${escapeHtml(game.log[game.log.length - 1] || '')}</div>`;
}
// 遭遇の戦い・速さ比べで両者が振った玉（3.8: 両方の玉を見せる）。片付いたあとも次の遭遇まで残して見せる
function renderEncounterBallsHtml() {
  const b = game.encounterBalls;
  if (!b) return '';
  const wrapA = document.createElement('span'); I.renderBalls(wrapA, b.a);
  let sideB = '';
  if (b.b) {
    const wrapB = document.createElement('span'); I.renderBalls(wrapB, b.b);
    sideB = `<div class="enc-vs__side"><span>${escapeHtml(E.playerName(game, b.bIdx))}</span>${wrapB.innerHTML}</div>`;
  }
  return `<div class="enc-vs"><div class="enc-vs__side"><span>${escapeHtml(E.playerName(game, b.aIdx))}</span>${wrapA.innerHTML}</div>${sideB}</div>`;
}

function updateActionBar() {
  const idx = E.currentPlayer(game);
  const humanTurn = isHumanSeat(idx);
  const show = humanTurn && (game.phase === 'main' || game.phase === 'flight');
  els.actionBar.style.display = show ? '' : 'none';
  els.diceBtn.hidden = !(humanTurn && game.phase === 'roll');
  els.tradeBtn.hidden = !(humanTurn && game.phase === 'main');
  els.flyBtn.hidden = !(humanTurn && game.phase === 'main' && E.canFly(game));
  els.endTurnBtn.hidden = !(humanTurn && (game.phase === 'main' || game.phase === 'flight'));
}
els.diceBtn.addEventListener('click', () => { if (E.rollDice(game) != null) persistAndRender(); });
els.flyBtn.addEventListener('click', () => { if (E.shakeMothership(game)) persistAndRender(); });
els.endTurnBtn.addEventListener('click', () => { ui.selectedShip = null; ui.mode = 'idle'; if (E.endTurn(game)) persistAndRender(); });
els.tradeBtn.addEventListener('click', () => { ui.mode = 'bankTrade'; ui.data = { give: null, want: null }; renderAll(); });

// ================================================================
// 操作パネル（捨て札・盗む相手・宇宙港セット・銀行交易・結果・端末の受け渡し）
// ================================================================
function openPanel() { els.panelOverlay.hidden = false; }
function closePanel() { els.panelOverlay.hidden = true; els.panel.innerHTML = ''; }
function bindPanel(actions) {
  els.panel.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const fn = actions[btn.dataset.act];
    if (fn) fn(btn);
  };
}

function renderDiscardPanel(d) {
  const p = game.players[d.player];
  const picked = ui.data.discardPicked || (ui.data.discardPicked = E.RESOURCES.reduce((o, r) => ({ ...o, [r]: 0 }), {}));
  const total = Object.values(picked).reduce((a, b) => a + b, 0);
  els.panel.innerHTML = `<h2>${E.playerName(game, d.player)}: ${d.count}枚捨てる（あと${d.count - total}枚）</h2>`
    + E.RESOURCES.map((r) => `<div class="sheet__row"><span>${E.RESOURCE_LABEL[r]}（持ち${p.resources[r]}）</span>
        <span class="stepper"><button data-act="dec" data-res="${r}">−</button><b>${picked[r]}</b><button data-act="inc" data-res="${r}">＋</button></span></div>`).join('')
    + `<button class="btn btn--accent" data-act="confirm" ${total === d.count ? '' : 'disabled'}>捨てる</button>`;
  bindPanel({
    inc: (b) => { const r = b.dataset.res; if (picked[r] < p.resources[r] && total < d.count) { picked[r]++; renderAll(); } },
    dec: (b) => { const r = b.dataset.res; if (picked[r] > 0) { picked[r]--; renderAll(); } },
    confirm: () => { E.discardCards(game, d.player, picked); ui.data.discardPicked = null; persistAndRender(); },
  });
}
function renderStealPanel() {
  const targets = E.sevenTargets(game);
  els.panel.innerHTML = `<h2>盗む相手を選ぶ</h2>` + targets.map((t) => `<button class="card-btn" data-act="pick" data-t="${t}">${E.playerName(game, t)}</button>`).join('');
  bindPanel({ pick: (b) => { E.resolveSteal(game, Number(b.dataset.t)); persistAndRender(); } });
}
function renderSetupPortPanel() {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  const d = ui.data.port || (ui.data.port = { colonyVertexId: p.colonies[0], shipKind: 'colony', bonusKind: Object.entries(game.bonusPool).find(([, n]) => n > 0)?.[0] || null });
  els.panel.innerHTML = `<h2>${E.playerName(game, idx)}: 宇宙港にする植民地</h2>
    <div class="sheet__row">${p.colonies.map((v) => `<button class="card-btn${d.colonyVertexId === v ? ' is-selected' : ''}" data-act="colony" data-v="${v}">植民地 #${v}</button>`).join('')}</div>
    <h2>置く船</h2>
    <div class="sheet__row"><button class="card-btn${d.shipKind === 'colony' ? ' is-selected' : ''}" data-act="kind" data-k="colony">植民船</button>
      <button class="card-btn${d.shipKind === 'trade' ? ' is-selected' : ''}" data-act="kind" data-k="trade">交易船</button></div>
    <h2>ボーナス</h2>
    <div class="sheet__row">${Object.entries(game.bonusPool).map(([k, n]) => `<button class="card-btn${d.bonusKind === k ? ' is-selected' : ''}" data-act="bonus" data-k="${k}" ${n <= 0 ? 'disabled' : ''}>${{ booster: 'ブースター', cannon: '大砲', pod: '貨物ポッド' }[k]}（残り${n}）</button>`).join('')}</div>
    <button class="btn btn--accent" data-act="confirm">決める</button>`;
  bindPanel({
    colony: (b) => { d.colonyVertexId = Number(b.dataset.v); renderAll(); },
    kind: (b) => { d.shipKind = b.dataset.k; renderAll(); },
    bonus: (b) => { d.bonusKind = d.bonusKind === b.dataset.k ? null : b.dataset.k; renderAll(); },
    confirm: () => { if (E.setupDoPortRound(game, d)) { ui.data.port = null; persistAndRender(); } },
  });
}
function renderEncounterPanel() {
  const enc = game.encounter;
  const def = E.ENCOUNTERS.find((d) => d.id === enc.cardId);
  const idx = enc.idx;
  const pending = enc.pending;
  let body = '';
  if (pending.kind === 'yesno') {
    body = `<div class="sheet__row"><button class="card-btn" data-act="yes">はい</button><button class="card-btn" data-act="no">いいえ</button></div>`;
  } else if (pending.kind === 'amount') {
    body = `<div class="res-pick">${Array.from({ length: pending.max + 1 }, (_, n) => `<button data-act="amount" data-n="${n}">${n}枚</button>`).join('')}</div>`;
  } else if (pending.kind === 'pickShip') {
    body = `<div class="sheet__row">${game.players[idx].ships.map((s) => `<button class="card-btn" data-act="ship" data-id="${s.id}">${s.kind === 'colony' ? '植民船' : '交易船'}</button>`).join('')}</div>`;
  } else if (pending.kind === 'pickResource') {
    body = `<div class="res-pick">${E.RESOURCES.map((r) => `<button data-act="res" data-r="${r}">${E.RESOURCE_LABEL[r]}</button>`).join('')}</div>`;
  } else if (pending.kind === 'pickUpgrade') {
    body = `<div class="sheet__row">
      <button class="card-btn" data-act="upg" data-k="booster">ブースター</button>
      <button class="card-btn" data-act="upg" data-k="cannon">大砲</button>
      <button class="card-btn" data-act="upg" data-k="pod">貨物ポッド</button></div>`;
  }
  els.panel.innerHTML = `<h2>遭遇: ${def.name}</h2><p>${escapeHtml(def.prompt)}</p>${body}`;
  bindPanel({
    yes: () => { E.encounterAnswer(game, { yes: true }); persistAndRender(); },
    no: () => { E.encounterAnswer(game, { yes: false }); persistAndRender(); },
    amount: (b) => { E.encounterAnswer(game, { amount: Number(b.dataset.n) }); persistAndRender(); },
    ship: (b) => { E.encounterAnswer(game, { shipId: b.dataset.id }); persistAndRender(); },
    res: (b) => { E.encounterAnswer(game, { res: b.dataset.r }); persistAndRender(); },
    upg: (b) => { E.encounterAnswer(game, { kind: b.dataset.k }); persistAndRender(); },
  });
}
function renderWearChoicePanel(w) {
  const names = { booster: 'ブースター', cannon: '大砲', pod: '貨物ポッド' };
  els.panel.innerHTML = `<h2>${E.playerName(game, w.player)}: 摩耗でどれを手放す？（同数）</h2>
    <div class="sheet__row">${w.options.map((k) => `<button class="card-btn" data-act="pick" data-k="${k}">${names[k]}</button>`).join('')}</div>`;
  bindPanel({ pick: (b) => { E.resolveWearChoice(game, w.player, b.dataset.k); persistAndRender(); } });
}
function renderWearDiscardPanel(d) {
  const p = game.players[d.player];
  els.panel.innerHTML = `<h2>${E.playerName(game, d.player)}: 手札が8枚以上。1枚捨てる</h2>
    <div class="res-pick">${E.RESOURCES.map((r) => `<button data-act="res" data-r="${r}" ${p.resources[r] <= 0 ? 'disabled' : ''}>${E.RESOURCE_LABEL[r]}</button>`).join('')}</div>`;
  bindPanel({ res: (b) => { E.resolveWearDiscard(game, d.player, b.dataset.r); persistAndRender(); } });
}
function renderBankTradePanel() {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  const d = ui.data;
  const rate = (r) => (r === 'goods' ? 2 : 3);
  const others = game.players.map((_, i) => i).filter((i) => i !== idx);
  if (d.other == null) d.other = others[0];
  const other = game.players[d.other];
  const pGive = d.pGive || (d.pGive = E.RESOURCES.reduce((o, r) => ({ ...o, [r]: 0 }), {}));
  const pGet = d.pGet || (d.pGet = E.RESOURCES.reduce((o, r) => ({ ...o, [r]: 0 }), {}));
  els.panel.innerHTML = `<h2>銀行と交易</h2>
    <p>渡す（レートどおりの枚数）</p>
    <div class="res-pick">${E.RESOURCES.map((r) => `<button data-act="give" data-r="${r}" class="${d.give === r ? 'is-selected' : ''}" ${p.resources[r] < rate(r) ? 'disabled' : ''}>${E.RESOURCE_LABEL[r]} ×${rate(r)}</button>`).join('')}</div>
    <p>もらう</p>
    <div class="res-pick">${E.RESOURCES.map((r) => `<button data-act="want" data-r="${r}" class="${d.want === r ? 'is-selected' : ''}" ${game.bank[r] <= 0 || r === d.give ? 'disabled' : ''}>${E.RESOURCE_LABEL[r]}</button>`).join('')}</div>
    <button class="btn btn--accent" data-act="confirm" ${d.give && d.want ? '' : 'disabled'}>交易する</button>
    <hr style="border-color:rgba(255,255,255,0.15)">
    <h2>相手と交易</h2>
    <div class="sheet__row"><span>相手</span><div class="res-pick">${others.map((i) => `<button data-act="other" data-i="${i}" class="${d.other === i ? 'is-selected' : ''}">${escapeHtml(E.playerName(game, i))}</button>`).join('')}</div></div>
    <p>渡す</p>
    ${E.RESOURCES.map((r) => `<div class="sheet__row"><span>${E.RESOURCE_LABEL[r]}（持ち${p.resources[r]}）</span>
        <span class="stepper"><button data-act="pgdec" data-r="${r}">−</button><b>${pGive[r]}</b><button data-act="pginc" data-r="${r}">＋</button></span></div>`).join('')}
    <p>もらう（相手の手持ちまで）</p>
    ${E.RESOURCES.map((r) => `<div class="sheet__row"><span>${E.RESOURCE_LABEL[r]}（相手${other.resources[r]}）</span>
        <span class="stepper"><button data-act="pwdec" data-r="${r}">−</button><b>${pGet[r]}</b><button data-act="pwinc" data-r="${r}">＋</button></span></div>`).join('')}
    <button class="btn btn--accent" data-act="playerTrade" ${E.RESOURCES.some((r) => pGive[r] > 0 || pGet[r] > 0) ? '' : 'disabled'}>この内容で成立させる</button>
    <button class="ghost-btn" data-act="cancel">やめる</button>`;
  bindPanel({
    give: (b) => { d.give = b.dataset.r; if (d.want === d.give) d.want = null; renderAll(); },
    want: (b) => { d.want = b.dataset.r; renderAll(); },
    confirm: () => { E.bankTrade(game, d.give, d.want); ui.mode = 'bankTrade'; ui.data = { give: null, want: null }; persistAndRender(); },
    other: (b) => { d.other = Number(b.dataset.i); renderAll(); },
    pginc: (b) => { const r = b.dataset.r; if (pGive[r] < p.resources[r]) { pGive[r]++; renderAll(); } },
    pgdec: (b) => { const r = b.dataset.r; if (pGive[r] > 0) { pGive[r]--; renderAll(); } },
    pwinc: (b) => { const r = b.dataset.r; if (pGet[r] < other.resources[r]) { pGet[r]++; renderAll(); } },
    pwdec: (b) => { const r = b.dataset.r; if (pGet[r] > 0) { pGet[r]--; renderAll(); } },
    playerTrade: () => {
      const otherIdx = d.other;
      if (isCpuSeat(otherIdx)) {
        // CPUが相手のときは、成立させる前に受けるか断るかを決める（人の手札は見ず、今回の内容だけで判断）
        if (CPU.acceptTrade(game, otherIdx, pGive, pGet)) {
          E.playerTrade(game, otherIdx, pGive, pGet);
          game.log.push(`${E.playerName(game, otherIdx)}が交易を受けました`);
        } else {
          game.log.push(`${E.playerName(game, otherIdx)}は交易を断りました`);
        }
      } else {
        E.playerTrade(game, otherIdx, pGive, pGet);
      }
      d.pGive = null; d.pGet = null;
      persistAndRender();
    },
    cancel: () => { ui.mode = 'idle'; ui.data = {}; renderAll(); },
  });
}
// 3.9: 交易所を建てたときの友好カード選び
function renderFriendshipPanel() {
  const { player: idx, sectorId } = game.pendingFriendship;
  const sector = game.board.sectors[sectorId];
  els.panel.innerHTML = `<h2>${E.playerName(game, idx)}: 友好カードを1枚選ぶ（${E.RACE_LABEL[sector.race]}）</h2>`
    + sector.friendCardsLeft.map((id) => {
      const c = E.FRIEND_CARDS.find((x) => x.id === id);
      return `<button class="card-btn" data-act="pick" data-id="${id}"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.desc)}</small></button>`;
    }).join('');
  bindPanel({ pick: (b) => { E.pickFriendshipCard(game, b.dataset.id); persistAndRender(); } });
}
// 外交官「銀河救援基金」: 産出で1枚ももらえなかった人が、好きな資源1枚
function renderGalacticFundPanel(d) {
  els.panel.innerHTML = `<h2>${E.playerName(game, d.player)}: 銀河救援基金（好きな資源1枚）</h2>
    <div class="res-pick">${E.RESOURCES.map((r) => `<button data-act="res" data-r="${r}" ${game.bank[r] <= 0 ? 'disabled' : ''}>${E.RESOURCE_LABEL[r]}</button>`).join('')}</div>`;
  bindPanel({ res: (b) => { E.resolveGalacticFund(game, d.player, b.dataset.r); persistAndRender(); } });
}
// 商人「商品1:1」の交換先を選ぶ
function renderGoodsExchangePanel() {
  els.panel.innerHTML = `<h2>商品1→好きな資源1（友好カード・手番に1回）</h2>
    <div class="res-pick">${E.RESOURCES.filter((r) => r !== 'goods').map((r) => `<button data-act="res" data-r="${r}" ${game.bank[r] <= 0 ? 'disabled' : ''}>${E.RESOURCE_LABEL[r]}</button>`).join('')}</div>
    <button class="ghost-btn" data-act="cancel">やめる</button>`;
  bindPanel({
    res: (b) => { E.merchantGoodsExchange(game, b.dataset.r); ui.mode = 'idle'; persistAndRender(); },
    cancel: () => { ui.mode = 'idle'; renderAll(); },
  });
}
// 外交官「助けの手」: 自分より点の多い相手から2人まで選ぶ
function renderHelpingHandPanel() {
  const targets = E.helpingHandTargets(game);
  const picked = ui.data.picked || (ui.data.picked = []);
  els.panel.innerHTML = `<h2>助けの手: 2人まで選ぶ（友好カード）</h2>`
    + targets.map((t) => `<button class="card-btn${picked.includes(t) ? ' is-selected' : ''}" data-act="toggle" data-t="${t}">${escapeHtml(E.playerName(game, t))}</button>`).join('')
    + `<button class="btn btn--accent" data-act="confirm" ${picked.length ? '' : 'disabled'}>取る</button>
       <button class="ghost-btn" data-act="cancel">やめる</button>`;
  bindPanel({
    toggle: (b) => {
      const t = Number(b.dataset.t);
      ui.data.picked = picked.includes(t) ? picked.filter((x) => x !== t) : (picked.length < 2 ? [...picked, t] : picked);
      renderAll();
    },
    confirm: () => { E.helpingHandSteal(game, ui.data.picked); ui.mode = 'idle'; ui.data = {}; persistAndRender(); },
    cancel: () => { ui.mode = 'idle'; ui.data = {}; renderAll(); },
  });
}
function renderResultPanel() {
  const idx = game.winner;
  const p = game.players[idx];
  els.panel.innerHTML = `<h2>${E.playerName(game, idx)} の勝ち！</h2>
    <p>植民地${p.colonies.length}・宇宙港${p.spaceports.length}・友好${E.friendshipMarkerCount(game, idx)}・名声${p.fame}（${E.playerScore(game, idx)}点）</p>
    <button class="btn btn--accent" data-act="share">共有する</button>
    <button class="btn" data-act="again">もう一度</button>`;
  bindPanel({
    share: () => { try { WebAppKit.share({ text: `宇宙を開拓するボードゲーム（試作）で ${E.playerName(game, idx)} が${E.playerScore(game, idx)}点で勝ち！ 植民地${p.colonies.length}・宇宙港${p.spaceports.length}・友好${E.friendshipMarkerCount(game, idx)}` }); } catch { /* 共有できなくてもよい */ } },
    again: () => { game = null; closePanel(); showSetup(); },
  });
}
function renderTurnPassPanel(key, idx) {
  els.panel.innerHTML = `<h2>${E.playerName(game, idx)}さんの番です</h2><p>端末を渡してください。</p><button class="btn btn--accent" data-act="ok">はじめる</button>`;
  bindPanel({ ok: () => { turnPassAckKey = key; renderAll(); } });
}

function renderOverlay() {
  if (game.phase === 'gameOver') { openPanel(); renderResultPanel(); return; }
  const idx = E.currentPlayer(game);
  const passKey = game.phase.startsWith('setup') ? `setup-${game.setupPos}` : game.phase === 'roll' ? `turn-${game.turnNumber}` : null;
  if (passKey && passKey !== turnPassAckKey && isHumanSeat(idx)) { openPanel(); renderTurnPassPanel(passKey, idx); return; }
  if (game.phase === 'discard') {
    const d = game.pendingDiscards.find((x) => isHumanSeat(x.player));
    if (d) { openPanel(); renderDiscardPanel(d); return; }
    closePanel(); return;
  }
  if (game.phase === 'steal' && isHumanSeat(idx)) { openPanel(); renderStealPanel(); return; }
  if (game.phase === 'setupPort' && isHumanSeat(idx)) { openPanel(); renderSetupPortPanel(); return; }
  if (game.phase === 'encounter') {
    const enc = game.encounter;
    if (enc && enc.pending && enc.pending.kind !== 'jumpTarget' && isHumanSeat(enc.idx)) { openPanel(); renderEncounterPanel(); return; }
    closePanel(); return;
  }
  if (game.phase === 'encounterWear') {
    const w = game.pendingWear[0];
    if (w) { if (isHumanSeat(w.player)) { openPanel(); renderWearChoicePanel(w); return; } closePanel(); return; }
    const d = game.pendingWearDiscards[0];
    if (d) { if (isHumanSeat(d.player)) { openPanel(); renderWearDiscardPanel(d); return; } closePanel(); return; }
    closePanel(); return;
  }
  if (game.phase === 'friendship') {
    if (isHumanSeat(game.pendingFriendship.player)) { openPanel(); renderFriendshipPanel(); return; }
    closePanel(); return;
  }
  if (game.phase === 'galacticFund') {
    const d = game.pendingGalacticFund.find((x) => isHumanSeat(x.player));
    if (d) { openPanel(); renderGalacticFundPanel(d); return; }
    closePanel(); return;
  }
  if (ui.mode === 'bankTrade') { openPanel(); renderBankTradePanel(); return; }
  if (ui.mode === 'pickGoodsExchange') { openPanel(); renderGoodsExchangePanel(); return; }
  if (ui.mode === 'pickHelpingHand') { openPanel(); renderHelpingHandPanel(); return; }
  closePanel();
}

// ================================================================
function renderAll() {
  if (!game) return;
  els.turnNum.textContent = game.turnNumber;
  renderPlayers();
  renderBank();
  renderLog();
  renderBoard();
  renderHand();
  renderBuildGrid();
  renderBanner();
  updateActionBar();
  renderOverlay();
}
