'use strict';
// CPU（画面・音に触らない）。engine.js の公開関数だけを使って手を打つ。
// 「よわい」だけ作る（仕様8章・作業1）: 合法手からほぼでたらめ、植民地・交易所を建てられるなら建てる。
import * as E from './engine.js';

export const LEVELS = [{ id: 'weak', name: 'よわい' }];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => (arr.length ? arr[rnd(arr.length)] : undefined);

// 1人ぶんだけ進める小さな部品（main.js が人・CPU混在の手番を細かく進めるのに使う。playTurn はこれらを続けて呼ぶだけ）
export function randomDiscard(game, playerIdx, count) {
  const res = { ...game.players[playerIdx].resources };
  const out = { ore: 0, fuel: 0, carbon: 0, food: 0, goods: 0 };
  let left = count;
  const keys = E.RESOURCES.slice();
  while (left > 0) {
    const avail = keys.filter((k) => res[k] - out[k] > 0);
    if (!avail.length) break;
    const k = pick(avail);
    out[k]++; left--;
  }
  return out;
}

// セットアップ中（カタンの植民地に3周、4周目の宇宙港セット）を1手ぶん進める
function cpuSetupStep(game) {
  if (game.phase === 'setupColony') {
    const sites = E.availableSetupColonySites(game);
    const vid = pick(sites);
    if (vid != null) E.setupPlaceColony(game, vid);
    return true;
  }
  if (game.phase === 'setupPort') {
    const idx = E.currentPlayer(game);
    const p = game.players[idx];
    const colonyVertexId = pick(p.colonies);
    if (colonyVertexId == null) return false;
    const shipKind = Math.random() < 0.5 ? 'colony' : 'trade';
    const bonusKind = Object.entries(game.bonusPool).find(([, n]) => n > 0);
    E.setupDoPortRound(game, { colonyVertexId, shipKind, bonusKind: bonusKind ? bonusKind[0] : null });
    return true;
  }
  return false;
}

// 交易・建設フェイズの手を1つ、でたらめに選んで打つ（建てられるならなるべく建てる）
function cpuMainStep(game) {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];

  // 植民地・交易所を建てられる船があれば、まず建てる
  for (const ship of p.ships) {
    if (ship.kind === 'colony' && E.canBuildColonyAt(game, ship.id)) { E.buildColonyAt(game, ship.id); return true; }
    if (ship.kind === 'trade' && E.canBuildTradeStationAt(game, ship.id)) { E.buildTradeStationAt(game, ship.id); resolvePendingCardsCpu(game); return true; }
  }

  const actions = [];
  const afford = (cost) => Object.entries(cost).every(([k, v]) => (p.resources[k] || 0) >= v);

  // 船が1隻も無いと何も進まなくなるので、最優先でその材料をそろえる（でたらめな交易で尽きるのを防ぐ）
  if (p.ships.length === 0 && p.shipsAvailable > 0 && p.spaceports.length) {
    const missingFor = (cost) => Object.entries(cost).reduce((a, [k, v]) => a + Math.max(0, v - (p.resources[k] || 0)), 0);
    const want = missingFor(E.COSTS.colonyShip) <= missingFor(E.COSTS.tradeShip) ? E.COSTS.colonyShip : E.COSTS.tradeShip;
    Object.entries(want).forEach(([wantRes, need]) => {
      if ((p.resources[wantRes] || 0) >= need) return;
      E.RESOURCES.forEach((give) => {
        if (give === wantRes) return;
        if (want[give] && (p.resources[give] || 0) <= want[give]) return; // 船自体に要るものは手放さない
        if ((p.resources[give] || 0) >= (give === 'goods' ? 2 : 3)) actions.push(() => E.bankTrade(game, give, wantRes));
      });
    });
  }
  if (actions.length) { const action = pick(actions); return action(); }

  // 実際に打てる手だけを候補にする（足りない手を選んで手番を無駄にしないため）
  if (p.colonies.length && p.spaceportSupply > 0 && afford(E.COSTS.spaceport)) {
    p.colonies.forEach((v) => actions.push(() => E.buildSpaceport(game, v)));
  }
  if (p.shipsAvailable > 0 && p.ships.length < 3) {
    p.spaceports.forEach((v) => {
      E.spaceportSitesFor(game, v).forEach((site) => {
        if (afford(E.COSTS.colonyShip)) actions.push(() => E.buildColonyShip(game, site));
        if (afford(E.COSTS.tradeShip)) actions.push(() => E.buildTradeShip(game, site));
      });
    });
  }
  if (p.ships.length > 0) {
    if (p.boosters < E.MAX_BOOSTERS && afford(E.COSTS.booster)) actions.push(() => E.buyUpgrade(game, 'booster'));
    if (p.cannons < E.MAX_CANNONS && afford(E.COSTS.cannon)) actions.push(() => E.buyUpgrade(game, 'cannon'));
    if (p.pods < E.MAX_PODS && afford(E.COSTS.pod)) actions.push(() => E.buyUpgrade(game, 'pod'));
  }
  E.RESOURCES.forEach((give) => {
    if (p.resources[give] < (give === 'goods' ? 2 : 3)) return;
    E.RESOURCES.forEach((want) => { if (give !== want) actions.push(() => E.bankTrade(game, give, want)); });
  });
  const action = pick(actions);
  return action ? action() : null; // null: 今は打てる手が無い（手番を切り上げる）
}

// setup フェイズを1手ぶん進める（人・CPU混在の画面からも、自分の番のときだけ呼ぶ）
export function cpuSetupTurn(game) { return cpuSetupStep(game); }

// 他人の分も含めて、CPU席の捨て札だけを1人ぶん自動で片付ける（人の捨て札はここでは触らない）
export function cpuDiscardOne(game, playerIdx) {
  const pending = game.pendingDiscards.find((d) => d.player === playerIdx);
  if (!pending) return false;
  return E.discardCards(game, playerIdx, randomDiscard(game, playerIdx, pending.count));
}
// 7を出した本人（CPU）が盗む相手をでたらめに選ぶ
export function cpuResolveSteal(game) { return E.resolveSteal(game, pick(E.sevenTargets(game))); }

// 遭遇（CPUよわい）: でたらめに答えるだけ。止まらないことだけ守る
export function cpuResolveEncounter(game) {
  const enc = game.encounter;
  if (game.phase !== 'encounter' || !enc || !enc.pending) return false;
  const pending = enc.pending;
  if (pending.kind === 'yesno') return E.encounterAnswer(game, { yes: Math.random() < 0.5 });
  if (pending.kind === 'amount') return E.encounterAnswer(game, { amount: rnd(pending.max + 1) });
  if (pending.kind === 'pickShip') { const s = pick(game.players[enc.idx].ships); return s ? E.encounterAnswer(game, { shipId: s.id }) : false; }
  if (pending.kind === 'jumpTarget') { const t = pick(E.spaceJumpTargets(game, pending.shipId)); return t != null ? E.encounterAnswer(game, { toVertexId: t }) : false; }
  if (pending.kind === 'pickResource') return E.encounterAnswer(game, { res: pick(E.RESOURCES) });
  if (pending.kind === 'pickUpgrade') return E.encounterAnswer(game, { kind: pick(['booster', 'cannon', 'pod']) });
  return false;
}
// 友好カード選び（3.9）: 残りカードからでたらめに1枚
export function cpuPickFriendshipCard(game) {
  if (game.phase !== 'friendship' || !game.pendingFriendship) return false;
  const sector = game.board.sectors[game.pendingFriendship.sectorId];
  const cardId = pick(sector.friendCardsLeft);
  return cardId != null ? E.pickFriendshipCard(game, cardId) : false;
}
// 銀河救援基金（3.9）: でたらめな資源を1枚
export function cpuResolveGalacticFundOne(game) {
  if (game.phase !== 'galacticFund') return false;
  const d = game.pendingGalacticFund[0];
  if (!d) return false;
  return E.resolveGalacticFund(game, d.player, pick(E.RESOURCES));
}
// 友好カード選び・銀河救援基金が残っている間、自動で片付ける（誰の分でも）
export function resolvePendingCardsCpu(game) {
  let guard = 20;
  while ((game.phase === 'friendship' || game.phase === 'galacticFund') && guard-- > 0) {
    if (game.phase === 'friendship') { if (!cpuPickFriendshipCard(game)) break; }
    else if (!cpuResolveGalacticFundOne(game)) break;
  }
}
// 摩耗（E9）の同数選択・8枚以上の捨て札を、相手がCPUの分だけ自動で片付ける
// （貨物ポッド→大砲→ブースターの順で残す＝ブースターから手放す。仕様3.8 E9）
export function cpuResolveWearOne(game) {
  if (game.phase !== 'encounterWear') return false;
  const w = game.pendingWear[0];
  if (w) {
    const order = ['booster', 'cannon', 'pod'];
    return E.resolveWearChoice(game, w.player, order.find((o) => w.options.includes(o)) || w.options[0]);
  }
  const d = game.pendingWearDiscards[0];
  if (d) return E.resolveWearDiscard(game, d.player, pick(E.RESOURCES.filter((r) => game.players[d.player].resources[r] > 0)));
  return false;
}

// 交易・建設フェイズをでたらめに打てるだけ打つ（打てる手が無くなったら切り上げる）
export function cpuPlayMainPhase(game) {
  let guard = 60;
  while (game.phase === 'main' && guard-- > 0) {
    if (cpuMainStep(game) == null) break;
    if (game.phase === 'gameOver') return;
  }
}
// 遭遇・摩耗が片付くまで自動で進める（誰の分でも。止まらないことを守るためのガード付き）
export function resolveEncountersCpu(game) {
  let guard = 50;
  while ((game.phase === 'encounter' || game.phase === 'encounterWear') && guard-- > 0) {
    if (game.phase === 'encounter') { if (!cpuResolveEncounter(game)) break; }
    else if (!cpuResolveWearOne(game)) break;
  }
}
// 母船を振り、出た速さぶん船を飛ばす（止まれた場所で建てられるならその場で建てる）
export function cpuPlayFlight(game, rng = Math.random) {
  if (!E.canFly(game)) return;
  E.shakeMothership(game, rng);
  resolveEncountersCpu(game);
  if (game.phase === 'gameOver') return;
  const p = game.players[E.currentPlayer(game)];
  let moveGuard = 20;
  while (moveGuard-- > 0) {
    const ship = p.ships.find((s) => s.movesLeft > 0);
    if (!ship) break;
    const stops = E.shipReachableStops(game, ship.id);
    const target = pick([...stops.keys()]);
    if (target == null) { ship.movesLeft = 0; continue; }
    E.moveShip(game, ship.id, target);
    if (game.phase === 'gameOver') return;
    if (ship.kind === 'colony' && E.canBuildColonyAt(game, ship.id)) E.buildColonyAt(game, ship.id);
    else if (ship.kind === 'trade' && E.canBuildTradeStationAt(game, ship.id)) { E.buildTradeStationAt(game, ship.id); resolvePendingCardsCpu(game); }
    if (game.phase === 'gameOver') return;
  }
}

// 1人ぶんの手番をまるごと進める（ロール〜手番終了まで）。discard/steal は他人の分も含めて自動で片付ける
// (test.mjs・全員CPUの通し稽古で使う。人の画面（main.js）は上の部品を手番の途中で1つずつ呼ぶ)
export function playTurn(game, rng = Math.random) {
  while (game.phase.startsWith('setup')) { if (!cpuSetupStep(game)) break; }
  if (game.phase === 'gameOver') return;
  if (game.phase === 'roll') E.rollDice(game, rng);
  resolvePendingCardsCpu(game); // 銀河救援基金（産出直後に起きる）
  while (game.phase === 'discard') {
    const pending = game.pendingDiscards[0];
    if (!pending) break;
    cpuDiscardOne(game, pending.player);
  }
  if (game.phase === 'steal') cpuResolveSteal(game);
  if (game.phase === 'gameOver') return;
  cpuPlayMainPhase(game);
  if (game.phase === 'gameOver') return;
  cpuPlayFlight(game, rng);
  if (game.phase === 'gameOver') return;
  E.endTurn(game);
}
