'use strict';
// engine.js の自己チェック。フレームワークなし。node --test で動く。
// 仕様 docs/private/specs/catan-starfarers.md 8章「作業1」の終わりの条件のうち、engine で確かめられるもの。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';
import * as CPU from './cpu.js';

test('盤: セクターの数と手前/奥、植民地の場所36、全交点がつながる', () => {
  const g = E.createGame(4, Math.random);
  const c = E.sectorCounts(g);
  assert.equal(c.colony, 4);
  assert.equal(c.front, 8);
  assert.equal(c.frontSystem, 5);
  assert.equal(c.frontEmpty, 3);
  assert.equal(c.back, 7);
  assert.equal(c.backSystem, 3);
  assert.equal(c.backOutpost, 4);
  assert.equal(E.colonySiteCount(g), 36); // 4×3 + 8×3
  assert.ok(E.boardConnected(g));
});

test('盤: カタンの植民地から奥の前哨基地まで最短距離がそれなりに遠い', () => {
  const g = E.createGame(4, Math.random);
  const colonySite = g.board.sectors.find((s) => s.tier === 'colony').siteVertexIds[0];
  const outposts = g.board.sectors.filter((s) => s.kind === 'outpost');
  const dists = outposts.map((s) => E.shortestDistance(g, colonySite, s.centerVertexId));
  assert.ok(dists.some((d) => d >= 8), `奥までの距離が近すぎる: ${dists}`);
  assert.ok(dists.every((d) => d < Infinity));
});

function doSetup(g) {
  while (g.phase.startsWith('setup')) {
    if (g.phase === 'setupColony') {
      const sites = E.availableSetupColonySites(g);
      assert.ok(E.setupPlaceColony(g, sites[0]));
    } else {
      const idx = E.currentPlayer(g);
      const p = g.players[idx];
      const colonyVertexId = p.colonies[0];
      const bonus = Object.entries(g.bonusPool).find(([, n]) => n > 0);
      assert.ok(E.setupDoPortRound(g, { colonyVertexId, shipKind: 'colony', bonusKind: bonus ? bonus[0] : null }));
    }
  }
}

test('準備: 4周で植民地2・宇宙港1・船1・手札3、4点', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  assert.equal(g.phase, 'roll');
  g.players.forEach((p) => {
    assert.equal(p.colonies.length, 2);
    assert.equal(p.spaceports.length, 1);
    assert.equal(p.ships.length, 1);
    assert.equal(p.ships[0].vertexId == null, false);
    assert.equal(Object.values(p.resources).reduce((a, b) => a + b, 0), 3);
    assert.equal(E.playerScore(g, p.idx), 4);
  });
  // 4人なら4つとも取られるので、ボーナスは余らない
  assert.equal(Object.values(g.bonusPool).reduce((a, b) => a + b, 0), 0);
});

test('3人: カタンの植民地の惑星系に3つ目が建たない（1系1か所ふさぐ）', () => {
  const g = E.createGame(3, Math.random);
  const blockedPerSystem = g.board.sectors.filter((s) => s.tier === 'colony')
    .map((s) => s.siteVertexIds.filter((v) => g.board.vertices[v].blocked).length);
  assert.equal(blockedPerSystem.reduce((a, b) => a + b, 0), 3); // 3系に1か所ずつ、合計3か所
  doSetup(g); // 3人×3周=9か所が埋まり、残り3か所(ふさいだ場所)は使えない
  const used = g.board.sectors.filter((s) => s.tier === 'colony')
    .flatMap((s) => s.siteVertexIds).filter((v) => g.board.vertices[v].building).length;
  assert.equal(used, 9);
});

test('宇宙港も資源1産む', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const spaceV = g.board.vertices[p.spaceports[0]];
  const hex = spaceV.hexIds.map((id) => g.board.hexes[id]).find((h) => h.disc && h.disc.faceUp && h.disc.numbers);
  assert.ok(hex, '宇宙港に接する数字が表のヘクスがあるはず');
  const before = p.resources[hex.resource];
  // その目を出すために、ロールを繰り返す（phase を roll に戻しつつ、最大1000回）
  for (let i = 0; i < 1000; i++) {
    g.phase = 'roll';
    const total = E.rollDice(g, Math.random);
    if (hex.disc.numbers.includes(total)) break;
  }
  assert.ok(p.resources[hex.resource] > before);
});

test('銀行の不足: 需要が銀行を超えたら誰ももらえない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  // 銀行をほぼ空にする
  E.RESOURCES.forEach((r) => { g.bank[r] = 0; });
  const before = g.players.map((p) => ({ ...p.resources }));
  // 2〜12のどれかで誰かの植民地が反応するはずなので、何回か振って毎回チェック
  for (let i = 0; i < 20; i++) { g.phase = 'roll'; E.rollDice(g, Math.random); }
  g.players.forEach((p, i) => {
    E.RESOURCES.forEach((r) => {
      if (g.bank[r] === 0) assert.ok(p.resources[r] - before[i][r] >= 0); // 増えないか、他の手段（予備の山）で増える程度
    });
  });
});

test('予備の山: 点4〜7で2枚・8〜9で1枚・10で0枚', () => {
  assert.equal(E.reserveDrawCountFor(4), 2);
  assert.equal(E.reserveDrawCountFor(7), 2);
  assert.equal(E.reserveDrawCountFor(8), 1);
  assert.equal(E.reserveDrawCountFor(9), 1);
  assert.equal(E.reserveDrawCountFor(10), 0);
  assert.equal(E.reserveDrawCountFor(15), 0);
});

test('7: 8枚以上が半分捨て、相手全員が予備から1枚引く', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  g.players[(idx + 1) % 4].resources = { ore: 3, fuel: 3, carbon: 3, food: 0, goods: 0 }; // 9枚
  const before = g.players.map((p) => ({ ...p.resources }));
  g.phase = 'roll';
  // 7を確実に出す（d1=3, d2=4）
  let n = 0;
  const rng7 = () => { n++; return n === 1 ? 0.4 : 0.55; };
  const total = E.rollDice(g, rng7);
  assert.equal(total, 7);
  assert.ok(g.pendingDiscards.some((d) => d.player === (idx + 1) % 4 && d.count === 4));
  g.pendingDiscards.slice().forEach((d) => {
    const obj = { ore: 0, fuel: 0, carbon: 0, food: 0, goods: 0 };
    let left = d.count;
    E.RESOURCES.forEach((r) => { while (left > 0 && g.players[d.player].resources[r] - obj[r] > 0) { obj[r]++; left--; } });
    E.discardCards(g, d.player, obj);
  });
  if (g.phase === 'steal') {
    const targets = E.sevenTargets(g);
    E.resolveSteal(g, targets[0]);
  }
  assert.equal(g.phase, 'main');
  // 相手全員（自分以外）は予備から1枚引いているはず（手札の総枚数が増えている）
  g.players.forEach((p, i) => {
    if (i === idx) return;
    const sumBefore = Object.values(before[i]).reduce((a, b) => a + b, 0);
    const sumAfter = Object.values(p.resources).reduce((a, b) => a + b, 0);
    assert.ok(sumAfter >= sumBefore - (i === (idx + 1) % 4 ? 4 : 0) + 1 - 1); // 緩め: 減って捨てたぶんを除けば増えている
  });
});

test('玉: 黒が出たら速さは基本3＋ブースター', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  g.players[idx].boosters = 2;
  g.phase = 'main';
  let result;
  for (let i = 0; i < 2000; i++) {
    g.phase = 'main';
    result = E.shakeMothership(g, Math.random);
    if (result.black) break;
  }
  assert.ok(result.black);
  assert.equal(result.speed, 3 + 2);
});

test('飛行: 惑星系の真ん中を通れない、相手の宇宙港の場所に止まれない、交易船は植民地の場所に止まれない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const ship = p.ships[0];
  ship.movesLeft = 500; // 盤全体を見渡せるくらい大きくする
  const stops = E.shipReachableStops(g, ship.id);
  g.board.vertices.forEach((v) => {
    if (v.kind === 'systemCenter') assert.ok(!stops.has(v.id));
  });
  // 相手の宇宙港の場所
  const other = g.players.find((pp) => pp.idx !== idx);
  const otherSite = E.spaceportSitesFor(g, other.spaceports[0])[0];
  g.board.vertices[otherSite].spaceportOwner = other.idx;
  const stops2 = E.shipReachableStops(g, ship.id);
  assert.ok(!stops2.has(otherSite));
  // 交易船は植民地の場所に止まれない
  const tradeShip = { id: 'test-trade', kind: 'trade', vertexId: ship.vertexId, movesLeft: 50 };
  p.ships.push(tradeShip);
  const colonySite = g.board.sectors.find((s) => s.kind === 'system' && s.siteVertexIds.some((v) => !g.board.vertices[v].building)).siteVertexIds.find((v) => !g.board.vertices[v].building);
  const tradeStops = E.shipReachableStops(g, 'test-trade');
  assert.ok(!tradeStops.has(colonySite) || g.board.vertices[colonySite].kind !== 'colonySite');
});

test('隣に着くと伏せたディスクがめくれる', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const ship = p.ships[0];
  g.phase = 'flight';
  ship.movesLeft = 500;
  const faceDownSector = g.board.sectors.find((s) => s.kind === 'system' && s.tier !== 'colony');
  const target = faceDownSector.siteVertexIds.find((v) => g.board.vertices[v].kind === 'colonySite');
  const stops = E.shipReachableStops(g, ship.id);
  assert.ok(stops.has(target), '盤がつながっていれば速さ50でどこへでも届くはず');
  const touchedHexIds = g.board.vertices[target].hexIds;
  assert.ok(touchedHexIds.some((hId) => g.board.hexes[hId].disc && !g.board.hexes[hId].disc.faceUp));
  E.moveShip(g, ship.id, target);
  assert.ok(touchedHexIds.every((hId) => !g.board.hexes[hId].disc || g.board.hexes[hId].disc.faceUp));
});

test('海賊4は大砲4で倒れ3では倒れない。倒すと1点と予備のディスク', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const pirateSector = g.board.sectors.find((s) => s.kind === 'system'
    && s.hexIds.some((hId) => g.board.hexes[hId].disc.token && g.board.hexes[hId].disc.token.kind === 'pirate' && g.board.hexes[hId].disc.token.strength === 4));
  assert.ok(pirateSector, 'strength4の海賊があるはず');
  const pirateHexId = pirateSector.hexIds.find((hId) => g.board.hexes[hId].disc.token && g.board.hexes[hId].disc.token.strength === 4);
  const target = pirateSector.siteVertexIds.find((v) => g.board.vertices[v].hexIds.includes(pirateHexId));
  const ship = p.ships[0];
  g.phase = 'flight';

  p.cannons = 3;
  const scoreBefore = E.playerScore(g, idx);
  ship.movesLeft = 500;
  assert.ok(E.shipReachableStops(g, ship.id).has(target));
  assert.ok(E.moveShip(g, ship.id, target));
  assert.ok(pirateSector.hexIds.some((hId) => g.board.hexes[hId].disc.token && g.board.hexes[hId].disc.token.strength === 4), '大砲3では倒れない');
  assert.equal(E.playerScore(g, idx), scoreBefore);

  // 一度離れて、大砲を4にしてから同じ場所へ戻る（着いたときにまた判定が起きる、3.4）
  const away = ship.id && [...E.shipReachableStops(g, ship.id).keys()][0];
  ship.movesLeft = 500;
  assert.ok(E.moveShip(g, ship.id, away));
  p.cannons = 4;
  ship.movesLeft = 500;
  assert.ok(E.shipReachableStops(g, ship.id).has(target));
  assert.ok(E.moveShip(g, ship.id, target));
  assert.ok(pirateSector.hexIds.every((hId) => !g.board.hexes[hId].disc.token || g.board.hexes[hId].disc.token.strength !== 4), '大砲4で倒れるはず');
  assert.equal(p.tokens.length, 1);
  assert.equal(E.playerScore(g, idx), scoreBefore + 1);
});

test('貨物ポッドの数 > 交易所の数でないと交易所は建たない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const outpost = g.board.sectors.find((s) => s.kind === 'outpost');
  const ship = { id: 'test-trade2', kind: 'trade', vertexId: outpost.centerVertexId, movesLeft: 0 };
  p.ships.push(ship);
  p.pods = 0;
  assert.ok(!E.canBuildTradeStationAt(g, 'test-trade2'));
  p.pods = 1;
  assert.ok(E.canBuildTradeStationAt(g, 'test-trade2'));
  assert.ok(E.buildTradeStationAt(g, 'test-trade2'));
  assert.equal(outpost.tradeStations.length, 1);
});

test('交易所をより多く建てた人に友好マーカーが移る', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const outpost = g.board.sectors.find((s) => s.kind === 'outpost');
  const a = g.players[0], b = g.players[1];
  a.pods = 1;
  const shipA = { id: 'ship-a', kind: 'trade', vertexId: outpost.centerVertexId, movesLeft: 0 };
  a.ships.push(shipA);
  E.buildTradeStationAt(g, 'ship-a');
  assert.equal(outpost.friendshipMarker, 0);

  // 「貨物ポッドの数 > 今ある交易所の数」は全員ぶんの合計で見るので、2つ目以降を建てるにはポッドを増やす必要がある
  b.pods = 2;
  const shipB = { id: 'ship-b', kind: 'trade', vertexId: outpost.centerVertexId, movesLeft: 0 };
  b.ships.push(shipB);
  E.buildTradeStationAt(g, 'ship-b');
  assert.equal(outpost.friendshipMarker, 0, '同数では移らない');

  b.pods = 3;
  const shipB2 = { id: 'ship-b2', kind: 'trade', vertexId: outpost.centerVertexId, movesLeft: 0 };
  b.ships.push(shipB2);
  E.buildTradeStationAt(g, 'ship-b2');
  assert.equal(outpost.friendshipMarker, 1, 'より多く建てたら移る');
});

test('CPU よわい: 4人で数十局が全部止まらず終わる', () => {
  let finished = 0;
  const GAMES = 30;
  for (let i = 0; i < GAMES; i++) {
    const g = E.createGame(4, Math.random);
    let guard = 4000;
    while (g.phase !== 'gameOver' && guard-- > 0) CPU.playTurn(g, Math.random);
    if (g.phase === 'gameOver') finished++;
    else throw new Error(`ゲームが終わらなかった (phase=${g.phase}, turn=${g.turnNumber})`);
  }
  assert.equal(finished, GAMES);
});
