'use strict';
// CPU（画面・音に触らない）。engine.js の公開関数だけを使って手を打つ。
// 「よわい」合法手からほぼでたらめ、「ふつう」産出・目的に合わせた手、「つよい」はふつうに加えて
// 友好マーカーの取り返し・残り点からの逆算・相手への交易の持ちかけ（仕様8章・作業4）。
import * as E from './engine.js';

export const LEVELS = [
  { id: 'weak', name: 'よわい' },
  { id: 'normal', name: 'ふつう' },
  { id: 'strong', name: 'つよい' },
];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => (arr.length ? arr[rnd(arr.length)] : undefined);

// ---- 盤の値打ち（惑星系の場所・前哨基地の場所）----
// ponytail: ディスクが伏せたままの場所は平均くらいの産出とみなす（実際の数は見えないので割り切り。めくれたら実数を使う）
const PIP_UNKNOWN = 2.2;
function pip(n) { return 6 - Math.abs(7 - n); }
function siteValue(game, vid) {
  const v = game.board.vertices[vid];
  if (!v) return 0;
  let score = 0;
  const resSet = new Set();
  (v.hexIds || []).forEach((hId) => {
    const hex = game.board.hexes[hId];
    if (!hex.resource) return;
    resSet.add(hex.resource);
    if (hex.disc && hex.disc.token) return; // 海賊・氷の惑星はまだ産出しない
    if (hex.disc && hex.disc.faceUp && hex.disc.numbers) score += hex.disc.numbers.reduce((a, n) => a + pip(n), 0);
    else score += PIP_UNKNOWN;
  });
  return score + resSet.size * 1.2;
}
function outpostValue(game, idx, sectorId, level) {
  const sector = game.board.sectors[sectorId];
  if (!sector) return 0;
  let score = 3 - sector.tradeStations.length * 0.4;
  if (sector.friendCardsLeft && sector.friendCardsLeft.length) score += 1;
  if (level === 'strong' && sector.friendshipMarker != null && sector.friendshipMarker !== idx) {
    const holderCount = sector.tradeStations.filter((t) => t.owner === sector.friendshipMarker).length;
    const mine = sector.tradeStations.filter((t) => t.owner === idx).length;
    if (mine + 1 > holderCount) score += 3; // 友好マーカーを取り返せる
  }
  return score;
}
function scoreStop(game, idx, shipKind, vid, steps, level) {
  const v = game.board.vertices[vid];
  let score;
  if (shipKind === 'colony') score = v.kind === 'colonySite' ? siteValue(game, vid) : 0.3;
  else score = v.kind === 'outpostCenter' ? outpostValue(game, idx, v.sectorId, level) : 0.3;
  return score - steps * 0.35;
}

// ---- アップグレードの優先順（貨物ポッドは前哨基地へ行く前、大砲は見えている海賊の前。仕様8章） ----
function upgradeOrder(game, idx) {
  const p = game.players[idx];
  const order = [];
  if (p.tradeStations.length >= p.pods && p.pods < E.MAX_PODS) order.push('pod');
  let pirateNeed = 0;
  game.board.hexes.forEach((h) => {
    if (h.disc && h.disc.faceUp && h.disc.token && h.disc.token.kind === 'pirate') pirateNeed = Math.max(pirateNeed, h.disc.token.strength);
  });
  if (pirateNeed > p.cannons + E.combatBonusFromCards(p) && p.cannons < E.MAX_CANNONS) order.push('cannon');
  ['booster', 'pod', 'cannon'].forEach((k) => { if (!order.includes(k)) order.push(k); });
  return order;
}

// ---- 今いちばん要っている材料（銀行交易・交易の持ちかけの基準） ----
function pickTargetCost(game, idx) {
  const p = game.players[idx];
  if (p.ships.length === 0 && p.shipsAvailable > 0 && p.spaceports.length) {
    const colonyScore = p.colonies.length + p.spaceports.length;
    return colonyScore <= p.tradeStations.length ? E.COSTS.colonyShip : E.COSTS.tradeShip;
  }
  if (p.colonies.length && p.spaceportSupply > 0) return E.COSTS.spaceport;
  const order = upgradeOrder(game, idx);
  return E.COSTS[order[0]];
}
function resourceValue(game, idx, res) {
  const p = game.players[idx];
  let score = Math.max(0, 2 - (p.resources[res] || 0) * 0.5); // 余っているほど値打ちが低い
  const cost = pickTargetCost(game, idx);
  if (cost && cost[res]) score += 1.5; // 今の目標に要るなら値打ちが高い
  return score;
}
function helpfulBankTrade(game, idx, cost) {
  const p = game.players[idx];
  if (!cost) return false;
  const missing = Object.keys(cost).filter((r) => (p.resources[r] || 0) < cost[r]);
  if (!missing.length) return false;
  const want = missing[0];
  for (const give of E.RESOURCES) {
    if (give === want) continue;
    const rate = give === 'goods' ? 2 : 3;
    const spare = (p.resources[give] || 0) - (cost[give] || 0);
    if (spare >= rate && game.bank[want] > 0 && E.bankTrade(game, give, want)) return true;
  }
  return false;
}
// つよい: 相手に交易を持ちかける（相手がCPUのときだけ、損得で答えが決まる。opponentLevelFor が無ければ何もしない）
function tryProposeTrade(game, idx, opponentLevelFor) {
  if (!opponentLevelFor) return false;
  const p = game.players[idx];
  const cost = pickTargetCost(game, idx);
  const missing = cost && Object.keys(cost).filter((r) => (p.resources[r] || 0) < cost[r]);
  if (!missing || !missing.length) return false;
  const want = missing[0];
  const spare = E.RESOURCES.find((r) => r !== want && (p.resources[r] || 0) > 1);
  if (!spare) return false;
  for (let other = 0; other < game.playerCount; other++) {
    if (other === idx) continue;
    const otherLevel = opponentLevelFor(other);
    if (!otherLevel) continue; // 人には画面が無いので持ちかけない
    const give = { [spare]: 1 }, get = { [want]: 1 };
    if (acceptTrade(game, other, give, get, otherLevel) && E.playerTrade(game, other, give, get)) return true;
  }
  return false;
}

// ---- 1人ぶんだけ進める小さな部品（main.js が人・CPU混在の手番を細かく進めるのに使う） ----
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
// ふつう・つよい: 余計に持っている資源から捨てる（目標に要る分はなるべく残す）
function smartDiscard(game, playerIdx, count) {
  const p = game.players[playerIdx];
  const cost = pickTargetCost(game, playerIdx) || {};
  const out = { ore: 0, fuel: 0, carbon: 0, food: 0, goods: 0 };
  let left = count;
  while (left > 0) {
    const avail = E.RESOURCES.filter((r) => (p.resources[r] || 0) - out[r] > 0);
    if (!avail.length) break;
    avail.sort((a, b) => ((p.resources[b] || 0) - (cost[b] || 0) * 2) - ((p.resources[a] || 0) - (cost[a] || 0) * 2));
    out[avail[0]]++; left--;
  }
  return out;
}

// セットアップ中（カタンの植民地に3周、4周目の宇宙港セット）を1手ぶん進める
function cpuSetupStep(game, level) {
  if (game.phase === 'setupColony') {
    const sites = E.availableSetupColonySites(game);
    const vid = level === 'weak' ? pick(sites) : sites.slice().sort((a, b) => siteValue(game, b) - siteValue(game, a))[0];
    if (vid != null) E.setupPlaceColony(game, vid);
    return true;
  }
  if (game.phase === 'setupPort') {
    const idx = E.currentPlayer(game);
    const p = game.players[idx];
    if (!p.colonies.length) return false;
    let colonyVertexId, shipKind, bonusKind;
    if (level === 'weak') {
      colonyVertexId = pick(p.colonies);
      shipKind = Math.random() < 0.5 ? 'colony' : 'trade';
      const bk = Object.entries(game.bonusPool).find(([, n]) => n > 0);
      bonusKind = bk ? bk[0] : null;
    } else {
      colonyVertexId = p.colonies.slice().sort((a, b) => {
        const sa = Math.max(0, ...E.spaceportSitesFor(game, a).map((s) => siteValue(game, s)));
        const sb = Math.max(0, ...E.spaceportSitesFor(game, b).map((s) => siteValue(game, s)));
        return sb - sa;
      })[0];
      shipKind = 'colony'; // 最初の1隻は拡張を優先
      bonusKind = ['booster', 'pod', 'cannon'].find((k) => (game.bonusPool[k] || 0) > 0) || null;
    }
    if (colonyVertexId == null) return false;
    E.setupDoPortRound(game, { colonyVertexId, shipKind, bonusKind });
    return true;
  }
  return false;
}

// 既にある船のうち空いている宇宙港の場所（どちらの種類の船も置ける）
function validSpaceportSites(game, idx) {
  const seen = new Set();
  game.players[idx].spaceports.forEach((v) => E.spaceportSitesFor(game, v).forEach((s) => seen.add(s)));
  return [...seen].filter((s) => {
    const sv = game.board.vertices[s];
    return sv.spaceportOwner === idx && !sv.building && !sv.shipHere;
  });
}

// ---- よわい: 交易・建設フェイズの手を1つ、でたらめに選んで打つ ----
function weakMainStep(game) {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];

  for (const ship of p.ships) {
    if (ship.kind === 'colony' && E.canBuildColonyAt(game, ship.id)) { E.buildColonyAt(game, ship.id); return true; }
    if (ship.kind === 'trade' && E.canBuildTradeStationAt(game, ship.id)) { E.buildTradeStationAt(game, ship.id); resolvePendingCardsCpu(game, 'weak'); return true; }
  }

  const actions = [];
  const afford = (cost) => Object.entries(cost).every(([k, v]) => (p.resources[k] || 0) >= v);

  if (p.ships.length === 0 && p.shipsAvailable > 0 && p.spaceports.length) {
    const missingFor = (cost) => Object.entries(cost).reduce((a, [k, v]) => a + Math.max(0, v - (p.resources[k] || 0)), 0);
    const want = missingFor(E.COSTS.colonyShip) <= missingFor(E.COSTS.tradeShip) ? E.COSTS.colonyShip : E.COSTS.tradeShip;
    Object.entries(want).forEach(([wantRes, need]) => {
      if ((p.resources[wantRes] || 0) >= need) return;
      E.RESOURCES.forEach((give) => {
        if (give === wantRes) return;
        if (want[give] && (p.resources[give] || 0) <= want[give]) return;
        if ((p.resources[give] || 0) >= (give === 'goods' ? 2 : 3)) actions.push(() => E.bankTrade(game, give, wantRes));
      });
    });
  }
  if (actions.length) { const action = pick(actions); return action(); }

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

// ---- ふつう・つよい: 建てられるならまず建てる→船をバランスよくそろえる→宇宙港→目的に合うアップグレード→銀行交易 ----
function smartMainStep(game, level, opponentLevelFor) {
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  const afford = (cost) => cost && Object.entries(cost).every(([k, v]) => (p.resources[k] || 0) >= v);

  for (const ship of p.ships) {
    if (ship.kind === 'colony' && E.canBuildColonyAt(game, ship.id)) { E.buildColonyAt(game, ship.id); return true; }
    if (ship.kind === 'trade' && E.canBuildTradeStationAt(game, ship.id)) { E.buildTradeStationAt(game, ship.id); resolvePendingCardsCpu(game, level); return true; }
  }

  // つよい: 残り点が少ないときは、直接点になる宇宙港を最優先にする（15点までの逆算）
  const remaining = E.WIN_SCORE - E.playerScore(game, idx);
  if (level === 'strong' && remaining <= 4 && p.colonies.length && p.spaceportSupply > 0 && afford(E.COSTS.spaceport)) {
    const best = p.colonies.slice().sort((a, b) => siteValue(game, b) - siteValue(game, a))[0];
    E.buildSpaceport(game, best);
    return true;
  }

  const colonyScore = p.colonies.length + p.spaceports.length;
  const wantKind = colonyScore <= p.tradeStations.length ? 'colony' : 'trade';

  // 船が1隻も無ければ、最優先でその材料をそろえる
  if (p.ships.length === 0 && p.shipsAvailable > 0 && p.spaceports.length) {
    const want = wantKind === 'colony' ? E.COSTS.colonyShip : E.COSTS.tradeShip;
    if (afford(want)) {
      const site = validSpaceportSites(game, idx)[0];
      if (site != null) { (wantKind === 'colony' ? E.buildColonyShip : E.buildTradeShip)(game, site); return true; }
    }
    if (helpfulBankTrade(game, idx, want)) return true;
  }

  if (p.colonies.length && p.spaceportSupply > 0 && afford(E.COSTS.spaceport)) {
    const best = p.colonies.slice().sort((a, b) => siteValue(game, b) - siteValue(game, a))[0];
    E.buildSpaceport(game, best);
    return true;
  }

  if (p.shipsAvailable > 0 && p.ships.length < 3 && p.spaceports.length) {
    const sites = validSpaceportSites(game, idx);
    if (sites.length) {
      const order = [wantKind, wantKind === 'colony' ? 'trade' : 'colony'];
      const kind = order.find((k) => afford(k === 'colony' ? E.COSTS.colonyShip : E.COSTS.tradeShip));
      if (kind) { (kind === 'colony' ? E.buildColonyShip : E.buildTradeShip)(game, sites[0]); return true; }
    }
  }

  if (p.ships.length > 0) {
    const order = upgradeOrder(game, idx);
    const caps = { booster: E.MAX_BOOSTERS, cannon: E.MAX_CANNONS, pod: E.MAX_PODS };
    const key = (k) => (k === 'booster' ? 'boosters' : k === 'cannon' ? 'cannons' : 'pods');
    const kind = order.find((k) => p[key(k)] < caps[k] && afford(E.COSTS[k]));
    if (kind) { E.buyUpgrade(game, kind); return true; }
  }

  if (helpfulBankTrade(game, idx, pickTargetCost(game, idx))) return true;
  if (level === 'strong' && tryProposeTrade(game, idx, opponentLevelFor)) return true;

  return false; // 打てる手が無い（手番を切り上げる）
}

function cpuMainStep(game, level, opponentLevelFor) {
  return level === 'weak' ? weakMainStep(game) : smartMainStep(game, level, opponentLevelFor);
}

// setup フェイズを1手ぶん進める（人・CPU混在の画面からも、自分の番のときだけ呼ぶ）
export function cpuSetupTurn(game, level = 'normal') { return cpuSetupStep(game, level); }

// 他人の分も含めて、CPU席の捨て札だけを1人ぶん自動で片付ける（人の捨て札はここでは触らない）
export function cpuDiscardOne(game, playerIdx, level = 'normal') {
  const pending = game.pendingDiscards.find((d) => d.player === playerIdx);
  if (!pending) return false;
  const obj = level === 'weak' ? randomDiscard(game, playerIdx, pending.count) : smartDiscard(game, playerIdx, pending.count);
  return E.discardCards(game, playerIdx, obj);
}
// 7を出した本人（CPU）が盗む相手を選ぶ（ふつう・つよいは点の多い相手から）
export function cpuResolveSteal(game, level = 'normal') {
  const targets = E.sevenTargets(game);
  if (!targets.length) return false;
  const target = level === 'weak' ? pick(targets) : targets.slice().sort((a, b) => E.playerScore(game, b) - E.playerScore(game, a))[0];
  return E.resolveSteal(game, target);
}

// 遭遇: よわいはでたらめ、ふつう・つよいは手札（資源・大砲・速さ）と型に合わせて答える
export function cpuResolveEncounter(game, level = 'normal') {
  const enc = game.encounter;
  if (game.phase !== 'encounter' || !enc || !enc.pending) return false;
  const pending = enc.pending;
  const idx = enc.idx;
  const p = game.players[idx];
  if (level === 'weak') {
    if (pending.kind === 'yesno') return E.encounterAnswer(game, { yes: Math.random() < 0.5 });
    if (pending.kind === 'amount') return E.encounterAnswer(game, { amount: rnd(pending.max + 1) });
    if (pending.kind === 'pickShip') { const s = pick(p.ships); return s ? E.encounterAnswer(game, { shipId: s.id }) : false; }
    if (pending.kind === 'jumpTarget') { const t = pick(E.spaceJumpTargets(game, pending.shipId)); return t != null ? E.encounterAnswer(game, { toVertexId: t }) : false; }
    if (pending.kind === 'pickResource') return E.encounterAnswer(game, { res: pick(E.RESOURCES) });
    if (pending.kind === 'pickUpgrade') return E.encounterAnswer(game, { kind: pick(['booster', 'cannon', 'pod']) });
    return false;
  }
  const combat = p.cannons + E.combatBonusFromCards(p);
  if (pending.kind === 'yesno') {
    let yes;
    switch (enc.cardId) {
      case 'E2': yes = combat < 3; break; // 戦闘力が低いなら素直に渡す、強いなら戦う
      case 'E3': yes = combat >= 4; break;
      case 'E5': yes = p.boosters >= 2; break; // 速さに自信があるときだけワームホールへ
      case 'E6': yes = true; break; // 助けたほうが期待値が良い
      case 'E7': yes = p.cannons >= 2; break;
      case 'E8': yes = p.shipsAvailable > 0 && p.ships.length < 3; break;
      default: yes = Math.random() < 0.5;
    }
    return E.encounterAnswer(game, { yes });
  }
  if (pending.kind === 'amount') {
    const amount = enc.cardId === 'E4' ? pending.max : Math.min(2, pending.max); // どちらも途中の枚数がいちばん得
    return E.encounterAnswer(game, { amount });
  }
  if (pending.kind === 'pickShip') {
    if (p.ships.length <= 1) { const s = pick(p.ships); return s ? E.encounterAnswer(game, { shipId: s.id }) : false; }
    const choice = p.ships.slice().sort((a, b) => a.movesLeft - b.movesLeft)[0]; // いちばん動いていない船を止める
    return E.encounterAnswer(game, { shipId: choice.id });
  }
  if (pending.kind === 'jumpTarget') {
    const targets = E.spaceJumpTargets(game, pending.shipId);
    if (!targets.length) return false;
    const ship = p.ships.find((s) => s.id === pending.shipId);
    const best = targets.map((t) => ({ t, s: scoreStop(game, idx, ship ? ship.kind : 'colony', t, 0, level) })).sort((a, b) => b.s - a.s)[0].t;
    return E.encounterAnswer(game, { toVertexId: best });
  }
  if (pending.kind === 'pickResource') {
    const scarce = E.RESOURCES.slice().sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0))[0];
    return E.encounterAnswer(game, { res: scarce });
  }
  if (pending.kind === 'pickUpgrade') return E.encounterAnswer(game, { kind: upgradeOrder(game, idx)[0] });
  return false;
}
// 友好カード選び（3.9）: ふつう・つよいは今いちばん役に立ちそうな1枚
export function cpuPickFriendshipCard(game, level = 'normal') {
  if (game.phase !== 'friendship' || !game.pendingFriendship) return false;
  const sector = game.board.sectors[game.pendingFriendship.sectorId];
  const options = sector.friendCardsLeft;
  if (!options.length) return false;
  if (level === 'weak') { const cardId = pick(options); return cardId != null ? E.pickFriendshipCard(game, cardId) : false; }
  const scoreKind = { bonusYield: 2, cannonBoost: 2.5, boosterBoost: 2.5, comboBoost: 2.5, exchange21: 1.6, exchange11goods: 1.4, fameForSale: 1.2, helpingHand: 1, galacticFund: 1, reducedTribute: 1 };
  const best = options.map((id) => ({ id, s: scoreKind[E.FRIEND_CARDS.find((c) => c.id === id).kind] || 1 })).sort((a, b) => b.s - a.s)[0].id;
  return E.pickFriendshipCard(game, best);
}
// 銀河救援基金（3.9）: ふつう・つよいは今いちばん少ない資源
export function galacticFundResourceFor(game, playerIdx, level = 'normal') {
  const p = game.players[playerIdx];
  return level === 'weak' ? pick(E.RESOURCES) : E.RESOURCES.slice().sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0))[0];
}
export function cpuResolveGalacticFundOne(game, level = 'normal') {
  if (game.phase !== 'galacticFund') return false;
  const d = game.pendingGalacticFund[0];
  if (!d) return false;
  return E.resolveGalacticFund(game, d.player, galacticFundResourceFor(game, d.player, level));
}
// 友好カード選び・銀河救援基金が残っている間、自動で片付ける（誰の分でも）
export function resolvePendingCardsCpu(game, level = 'normal') {
  let guard = 20;
  while ((game.phase === 'friendship' || game.phase === 'galacticFund') && guard-- > 0) {
    if (game.phase === 'friendship') { if (!cpuPickFriendshipCard(game, level)) break; }
    else if (!cpuResolveGalacticFundOne(game, level)) break;
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

// 相手との交易（3b）に答える: 持っていない資源は出せない。よわいはでたらめ、ふつう・つよいは損得で決める
export function acceptTrade(game, cpuIdx, give, get, level = 'normal') {
  const p = game.players[cpuIdx];
  if (!E.RESOURCES.every((r) => (p.resources[r] || 0) >= (get[r] || 0))) return false;
  if (level === 'weak') return Math.random() < 0.5;
  const gain = E.RESOURCES.reduce((a, r) => a + resourceValue(game, cpuIdx, r) * (give[r] || 0), 0);
  const cost = E.RESOURCES.reduce((a, r) => a + resourceValue(game, cpuIdx, r) * (get[r] || 0), 0);
  let margin = 0.3;
  if (level === 'strong') {
    const proposer = E.currentPlayer(game);
    const leaderScore = Math.max(...game.players.map((_, i) => E.playerScore(game, i)));
    if (E.playerScore(game, proposer) >= leaderScore) margin = 1.2; // 首位（タイ含む）には厳しめ
  }
  return gain - cost > margin;
}

// 交易・建設フェイズをなるべく打てるだけ打つ（打てる手が無くなったら切り上げる）
// opponentLevelFor: (idx) => level|null。つよいが相手に交易を持ちかけるとき、相手がCPUなら渡す（人には持ちかけない）
export function cpuPlayMainPhase(game, level = 'normal', opponentLevelFor = null) {
  let guard = 60;
  while (game.phase === 'main' && guard-- > 0) {
    if (cpuMainStep(game, level, opponentLevelFor) == null) break;
    if (game.phase === 'gameOver') return;
  }
}
// 遭遇・摩耗が片付くまで自動で進める（誰の分でも。止まらないことを守るためのガード付き）
export function resolveEncountersCpu(game, level = 'normal') {
  let guard = 50;
  while ((game.phase === 'encounter' || game.phase === 'encounterWear') && guard-- > 0) {
    if (game.phase === 'encounter') { if (!cpuResolveEncounter(game, level)) break; }
    else if (!cpuResolveWearOne(game)) break;
  }
}
// 母船を振り、出た速さぶん船を飛ばす（止まれた場所で建てられるならその場で建てる）
export function cpuPlayFlight(game, level = 'normal', rng = Math.random) {
  if (!E.canFly(game)) return;
  E.shakeMothership(game, rng);
  resolveEncountersCpu(game, level);
  if (game.phase === 'gameOver') return;
  const idx = E.currentPlayer(game);
  const p = game.players[idx];
  let moveGuard = 20;
  while (moveGuard-- > 0) {
    const ship = p.ships.find((s) => s.movesLeft > 0);
    if (!ship) break;
    const stops = E.shipReachableStops(game, ship.id);
    const keys = [...stops.keys()];
    const target = level === 'weak' ? pick(keys)
      : (keys.length ? keys.map((k) => ({ k, s: scoreStop(game, idx, ship.kind, k, stops.get(k), level) })).sort((a, b) => b.s - a.s)[0].k : undefined);
    if (target == null) { ship.movesLeft = 0; continue; }
    E.moveShip(game, ship.id, target);
    if (game.phase === 'gameOver') return;
    if (ship.kind === 'colony' && E.canBuildColonyAt(game, ship.id)) E.buildColonyAt(game, ship.id);
    else if (ship.kind === 'trade' && E.canBuildTradeStationAt(game, ship.id)) { E.buildTradeStationAt(game, ship.id); resolvePendingCardsCpu(game, level); }
    if (game.phase === 'gameOver') return;
  }
}

// 1人ぶんの手番をまるごと進める（ロール〜手番終了まで）。discard/steal は他人の分も含めて自動で片付ける
// (test.mjs・全員CPUの通し稽古で使う。人の画面（main.js）は上の部品を手番の途中で1つずつ呼ぶ)
export function playTurn(game, rng = Math.random, level = 'weak', opponentLevelFor = null) {
  while (game.phase.startsWith('setup')) { if (!cpuSetupStep(game, level)) break; }
  if (game.phase === 'gameOver') return;
  resolveEncountersCpu(game, level); // 前の呼び出しで遭遇が片付かず残っていたら、まずそれを片付ける（止まり続けるのを防ぐ）
  if (game.phase === 'gameOver') return;
  if (game.phase === 'roll') E.rollDice(game, rng);
  resolvePendingCardsCpu(game, level); // 銀河救援基金（産出直後に起きる）
  while (game.phase === 'discard') {
    const pending = game.pendingDiscards[0];
    if (!pending) break;
    cpuDiscardOne(game, pending.player, level);
  }
  if (game.phase === 'steal') cpuResolveSteal(game, level);
  if (game.phase === 'gameOver') return;
  cpuPlayMainPhase(game, level, opponentLevelFor);
  if (game.phase === 'gameOver') return;
  cpuPlayFlight(game, level, rng);
  if (game.phase === 'gameOver') return;
  E.endTurn(game);
}
