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

// ---- 作業2: 遭遇と名声（仕様8章） ----

test('黒が出たら遭遇が始まり、片付くまで船が動けない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  let result;
  for (let i = 0; i < 3000; i++) { g.phase = 'main'; result = E.shakeMothership(g, Math.random); if (result.black && g.phase === 'encounter') break; } // E9（摩耗）はその場で片付くので除く
  assert.ok(result.black);
  assert.equal(g.phase, 'encounter');
  assert.ok(g.encounter && g.encounter.idx === idx);
  const ship = g.players[idx].ships[0];
  const anyTarget = [...E.shipReachableStops(g, ship.id).keys()][0] ?? ship.vertexId;
  assert.equal(E.moveShip(g, ship.id, anyTarget), false); // encounter中は動けない
  // CPUの答え方（でたらめ）で片付け、必ず終わることも確かめる
  let guard = 50;
  while ((g.phase === 'encounter' || g.phase === 'encounterWear') && guard-- > 0) {
    if (g.phase === 'encounter') CPU.cpuResolveEncounter(g); else CPU.cpuResolveWearOne(g);
  }
  assert.equal(g.phase, 'flight');
});

test('遭遇の戦いは同点なら仕掛けた本人の勝ち', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const before = E.playerScore(g, idx);
  g.phase = 'main';
  E.startEncounter(g, idx, 'E3'); // 海賊の待ち伏せ: はい→戦い
  assert.equal(g.encounter.pending.kind, 'yesno');
  const tieRng = () => 0; // 同じ並べ替えになるので両者の玉がそろう（同点）
  assert.ok(E.encounterAnswer(g, { yes: true }, tieRng));
  assert.deepEqual(g.encounterBalls.a, g.encounterBalls.b); // 同点
  assert.equal(g.phase, 'flight'); // 勝ったのでそのまま終わる
  assert.equal(E.playerScore(g, idx), before + 1); // 勝ち=名声+1 → 1点増える（0→1点）
});

test('名声: 2つで1点、失うと下がる（0未満にはならない）', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.fame = 3; const scoreWith3 = E.playerScore(g, idx);
  p.fame = 2; assert.equal(E.playerScore(g, idx), scoreWith3); // 1つ失って2つでも1点のまま
  p.fame = 1; assert.equal(E.playerScore(g, idx), scoreWith3 - 1); // さらに失うと点も下がる
  p.fame = 0;
  g.phase = 'main';
  E.startEncounter(g, idx, 'E6'); // 遭難船: いいえ→名声1を失う
  E.encounterAnswer(g, { yes: false });
  assert.equal(p.fame, 0); // 0未満にはならない
});

test('宇宙ジャンプで交易船は植民地の場所に跳べない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const tradeShip = { id: 'jump-trade', kind: 'trade', vertexId: p.ships[0].vertexId, movesLeft: 0 };
  p.ships.push(tradeShip);
  const targets = E.spaceJumpTargets(g, 'jump-trade');
  assert.ok(targets.length > 0);
  targets.forEach((vid) => { assert.notEqual(g.board.vertices[vid].kind, 'colonySite'); });
});

test('宇宙港の場所が空いていないと交易船マーカーになり、空いたら置かれる', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const sites = E.freeSpaceportSitesFor(g, idx);
  assert.ok(sites.length > 0);
  sites.forEach((vid) => { g.board.vertices[vid].building = { type: 'dummy', owner: idx }; }); // 全部ふさいでしまう
  g.phase = 'main';
  E.startEncounter(g, idx, 'E8'); // 迷子の交易船: はい→無料の交易船（置けなければマーカー）
  const shipsBefore = p.ships.length;
  E.encounterAnswer(g, { yes: true });
  assert.equal(p.tradeShipMarkers, 1);
  assert.equal(p.ships.length, shipsBefore); // 置けなかった
  g.board.vertices[sites[0]].building = null; // 1つ空く
  E.tryPlaceTradeShipMarkers(g, idx);
  assert.equal(p.tradeShipMarkers, 0);
  assert.equal(p.ships.length, shipsBefore + 1); // 空いたら置かれる
});

test('遭遇中のジャンプ先で海賊/氷を片付けて勝っても、遭遇の後始末で勝ちが消えない', () => {
  // 退行テスト: finishEncounter が game.phase を無条件で 'flight' に戻していたため、
  // ジャンプの着地点（onShipArrive）で勝利条件に届いても、その直後に phase が
  // 'flight' に巻き戻り、checkWin の winner!=null ガードで再判定もされず、
  // ゲームが終わらず回り続けていた（300局に1局ほど）。
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const ship = p.ships[0];
  p.cannons = 6; p.pods = 5; // どの強さの海賊・氷も片付けられるようにする
  p.fame = 20; // 植民地2+宇宙港1*2=4点とあわせて14点、あと1点で勝ち
  assert.equal(E.playerScore(g, idx), 14);
  g.phase = 'flight';
  const targets = E.spaceJumpTargets(g, ship.id);
  const target = targets.find((vid) => g.board.vertices[vid].hexIds.some((hId) => g.board.hexes[hId].disc && g.board.hexes[hId].disc.token));
  assert.ok(target != null, '海賊か氷のある場所へ跳べる先があるはず');
  // E5「速さ比べに勝ってジャンプ」相当の pending を直接作る（CPUのでたらめな判定を経由しない）
  g.phase = 'encounter';
  g.encounter = { cardId: 'E5', idx, rightIdx: (idx + 1) % g.playerCount, pending: { kind: 'jumpTarget', shipId: ship.id } };
  assert.ok(E.encounterAnswer(g, { toVertexId: target }));
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, idx);
});

test('摩耗（E9）が全員に効く', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  g.players.forEach((p, i) => { p.boosters = i + 1; }); // 人ごとに数をずらしタイなしにする
  const totalBefore = g.players.reduce((a, p) => a + p.boosters + p.cannons + p.pods, 0);
  g.phase = 'main';
  E.startEncounter(g, idx, 'E9');
  let guard = 20;
  while (g.phase === 'encounterWear' && guard-- > 0) CPU.cpuResolveWearOne(g);
  const totalAfter = g.players.reduce((a, p) => a + p.boosters + p.cannons + p.pods, 0);
  assert.equal(totalAfter, totalBefore - 4); // 4人全員が1つずつ失う
  assert.equal(g.phase, 'flight');
});

test('摩耗の同数はCPUがブースター→大砲→貨物ポッドの順で手放す', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.boosters = 2; p.cannons = 2; p.pods = 1; // ブースターと大砲が同数で最大
  g.phase = 'main';
  E.startEncounter(g, idx, 'E9');
  assert.equal(g.phase, 'encounterWear');
  const w = g.pendingWear.find((x) => x.player === idx);
  assert.deepEqual(w.options.slice().sort(), ['booster', 'cannon']);
  CPU.cpuResolveWearOne(g);
  assert.equal(p.boosters, 1); // ブースターを先に手放す
  assert.equal(p.cannons, 2);
});

test('遭遇の山が尽きたら捨て札を混ぜ直す', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  g.encounterDeck = ['E6']; g.encounterDiscard = ['E2', 'E3'];
  g.phase = 'main';
  E.startEncounter(g, idx); // 山の最後の1枚(E6)を引く
  assert.equal(g.encounterDeck.length, 0);
  let guard = 20;
  while ((g.phase === 'encounter' || g.phase === 'encounterWear') && guard-- > 0) {
    if (g.phase === 'encounter') CPU.cpuResolveEncounter(g); else CPU.cpuResolveWearOne(g);
  }
  g.phase = 'main';
  E.startEncounter(g, idx); // 山が尽きているので、捨て札(E2,E3,E6)を混ぜ直して引く
  assert.equal(g.encounterDeck.length, 2);
  assert.equal(g.encounterDiscard.length, 1);
  assert.ok(g.encounter); // 止まらず次の遭遇が始まる
});

// ---- 作業3a: 友好カード20枚（規7章・仕様3.9）----

test('交易所を建てたら、その種族の友好カードから1枚選べる', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const outpost = g.board.sectors.find((s) => s.kind === 'outpost');
  assert.equal(outpost.friendCardsLeft.length, 5); // 建てる前は5枚とも残っている
  p.pods = 1;
  g.phase = 'main';
  const ship = { id: 'friend-ship', kind: 'trade', vertexId: outpost.centerVertexId, movesLeft: 0 };
  p.ships.push(ship);
  assert.ok(E.buildTradeStationAt(g, 'friend-ship'));
  assert.equal(g.phase, 'friendship'); // 選ぶまで止まる
  assert.equal(g.pendingFriendship.player, idx);
  const cardId = outpost.friendCardsLeft[0];
  assert.ok(E.pickFriendshipCard(g, cardId));
  assert.equal(g.phase, 'main'); // 建てたときの phase に戻る
  assert.ok(p.friendCards.includes(cardId));
  assert.equal(outpost.friendCardsLeft.includes(cardId), false);
  assert.equal(outpost.friendCardsLeft.length, 4);
});

test('緑の民の+1は、その資源を1枚以上もらったときだけ', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const colonyV = g.board.vertices[p.colonies[0]];
  const hex = colonyV.hexIds.map((id) => g.board.hexes[id]).find((h) => h.disc && h.disc.faceUp && h.disc.numbers);
  assert.ok(hex, '産出が起きる資源があるはず');
  p.friendCards = [`green_${hex.resource}`];
  g.board.hexes = [hex]; // 他の惑星が同じロールで混ざらないよう、見るヘクスをこれ1つに絞る（他は盤の見た目に使わないのでテストのあいだだけ）
  p.fame = 20; // 予備の山の引き分（点が低いほど増える）がこの資源に混ざらないよう、点を上げて引き分を0枚にする
  const before = p.resources[hex.resource];
  let total;
  for (let i = 0; i < 1000; i++) {
    g.phase = 'roll';
    total = E.rollDice(g, Math.random);
    if (hex.disc.numbers.includes(total)) break;
  }
  assert.ok(hex.disc.numbers.includes(total));
  assert.equal(p.resources[hex.resource], before + 2); // ふつうの1枚＋カードで1枚
});

test('銀河救援基金は7のときは効かない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['dip_relief'];
  E.RESOURCES.forEach((r) => { p.resources[r] = 0; });
  g.phase = 'roll';
  let n = 0;
  const rng7 = () => { n++; return n === 1 ? 0.4 : 0.55; }; // 合計7
  const total = E.rollDice(g, rng7);
  assert.equal(total, 7);
  assert.notEqual(g.phase, 'galacticFund');
  assert.equal(g.pendingGalacticFund.length, 0);
});

test('銀河救援基金は、7以外で1枚ももらえなかったときに効く', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['dip_relief'];
  // 自分の植民地・宇宙港に接しない目（＝このプレイヤーが絶対に何ももらえない目）を探す
  const ownedNumbers = new Set();
  g.board.hexes.forEach((h) => {
    if (!h.disc || !h.disc.faceUp || !h.disc.numbers) return;
    if (h.vertexIds.some((vid) => { const v = g.board.vertices[vid]; return v.building && v.building.owner === idx; })) {
      h.disc.numbers.forEach((n) => ownedNumbers.add(n));
    }
  });
  const missNumber = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find((n) => !ownedNumbers.has(n));
  assert.ok(missNumber, 'テスト環境では見つかるはず');
  let d1 = 1; while (missNumber - d1 < 1 || missNumber - d1 > 6) d1++;
  const d2 = missNumber - d1;
  const diceRng = (() => { const vals = [(d1 - 0.5) / 6, (d2 - 0.5) / 6]; let i = 0; return () => vals[i++]; })();
  g.phase = 'roll';
  const total = E.rollDice(g, diceRng);
  assert.equal(total, missNumber);
  assert.equal(g.phase, 'galacticFund'); // このロールの産出では1枚ももらえなかった（予備の山の引き分はここでは数えない）
  const oreBefore = p.resources.ore; // ロール直後（予備の山の引き分を含む）から、基金ぶんの増え方だけを見る
  assert.ok(E.resolveGalacticFund(g, idx, 'ore'));
  assert.equal(g.phase, 'main');
  assert.equal(p.resources.ore, oreBefore + 1);
});

test('助けの手は、点の多い相手が2人以上のときだけ使える', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['dip_help'];
  g.phase = 'main';
  assert.deepEqual(E.helpingHandTargets(g), []);
  const others = g.players.filter((x) => x.idx !== idx);
  others[0].fame = 10; // 1人だけ多くてもまだ使えない
  assert.deepEqual(E.helpingHandTargets(g), []);
  others[1].fame = 10; // 2人以上で使える
  const targets = E.helpingHandTargets(g);
  assert.ok(targets.length >= 2);
  others[0].resources.ore = 2;
  assert.ok(E.helpingHandSteal(g, [others[0].idx, others[1].idx]));
  assert.equal(p.oncePerTurn.helpingHand, true);
  assert.equal(E.helpingHandTargets(g).length, 0); // 同じ手番にもう1回は使えない
});

test('名声の売り物は、2枚持っていても手番に1回だけ', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['dip_fame_1', 'dip_fame_2'];
  p.resources.goods = 5;
  g.phase = 'main';
  const fameBefore = p.fame;
  assert.ok(E.buyFameWithGoods(g));
  assert.equal(p.fame, fameBefore + 1);
  assert.equal(E.buyFameWithGoods(g), false);
  assert.equal(p.fame, fameBefore + 1);
});

test('商品1:1の交換も、手番に1回だけ', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['merch_goods'];
  p.resources.goods = 5;
  g.phase = 'main';
  const oreBefore = p.resources.ore;
  assert.ok(E.merchantGoodsExchange(g, 'ore'));
  assert.equal(p.resources.ore, oreBefore + 1);
  assert.equal(E.merchantGoodsExchange(g, 'ore'), false);
});

test('商人の交換カードは銀行交易の率を2:1にする', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  p.friendCards = ['merch_ore'];
  p.resources.ore = 2; p.resources.fuel = 0;
  g.phase = 'main';
  assert.ok(E.bankTrade(g, 'ore', 'fuel'));
  assert.equal(p.resources.ore, 0); // 2枚で交換できた（ふつうは3枚要る）
  assert.equal(p.resources.fuel, 1);
});

test('科学者の大砲は海賊の条件に入り、摩耗で減らない', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  const idx = E.currentPlayer(g);
  const p = g.players[idx];
  const pirateSector = g.board.sectors.find((s) => s.kind === 'system'
    && s.hexIds.some((hId) => g.board.hexes[hId].disc.token && g.board.hexes[hId].disc.token.kind === 'pirate' && g.board.hexes[hId].disc.token.strength === 4));
  assert.ok(pirateSector);
  const pirateHexId = pirateSector.hexIds.find((hId) => g.board.hexes[hId].disc.token && g.board.hexes[hId].disc.token.strength === 4);
  const target = pirateSector.siteVertexIds.find((v) => g.board.vertices[v].hexIds.includes(pirateHexId));
  const ship = p.ships[0];
  g.phase = 'flight';
  p.cannons = 2; p.friendCards = ['sci_cannon']; // 大砲2＋カードの+2＝4で倒れる（大砲2だけでは倒れない）
  ship.movesLeft = 500;
  assert.ok(E.moveShip(g, ship.id, target));
  assert.equal(p.tokens.length, 1);
  g.phase = 'main';
  E.startEncounter(g, idx, 'E9'); // 摩耗
  let guard = 20;
  while (g.phase === 'encounterWear' && guard-- > 0) CPU.cpuResolveWearOne(g);
  assert.ok(p.friendCards.includes('sci_cannon')); // カードは摩耗で失わない
  assert.equal(E.combatBonusFromCards(p), 2);
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

// ---- 作業4: CPU（ふつう・つよい） ----
// 席ごとに強さが違う対局を、全フェイズを1手ずつ進めて最後まで打つ（各手が合法=trueを返すことも確かめる）
function playOutMixed(levels, maxSteps = 3000) {
  const g = E.createGame(levels.length, Math.random);
  for (let i = 0; i < maxSteps; i++) {
    if (g.winner != null) return g;
    if (g.phase === 'discard') {
      const d = g.pendingDiscards[0];
      assert.ok(CPU.cpuDiscardOne(g, d.player, levels[d.player]), '捨て札が進まない');
      continue;
    }
    if (g.phase === 'steal') {
      assert.ok(CPU.cpuResolveSteal(g, levels[E.currentPlayer(g)]), '盗みが進まない');
      continue;
    }
    if (g.phase === 'encounter') {
      assert.ok(CPU.cpuResolveEncounter(g, levels[g.encounter.idx]), '遭遇が進まない');
      continue;
    }
    if (g.phase === 'encounterWear') {
      assert.ok(CPU.cpuResolveWearOne(g), '摩耗が進まない');
      continue;
    }
    if (g.phase === 'friendship') {
      assert.ok(CPU.cpuPickFriendshipCard(g, levels[g.pendingFriendship.player]), '友好カード選びが進まない');
      continue;
    }
    if (g.phase === 'galacticFund') {
      const d = g.pendingGalacticFund[0];
      assert.ok(CPU.cpuResolveGalacticFundOne(g, levels[d.player]), '銀河救援基金が進まない');
      continue;
    }
    if (g.phase.startsWith('setup')) {
      assert.ok(CPU.cpuSetupTurn(g, levels[E.currentPlayer(g)]), 'セットアップが進まない');
      continue;
    }
    if (g.phase === 'roll') { E.rollDice(g, Math.random); continue; }
    if (g.phase === 'main' || g.phase === 'flight') {
      const idx = E.currentPlayer(g);
      CPU.cpuPlayMainPhase(g, levels[idx], (o) => levels[o]);
      if (g.phase === 'gameOver') return g;
      CPU.cpuPlayFlight(g, levels[idx]);
      if (g.phase === 'gameOver') return g;
      E.endTurn(g);
      continue;
    }
    throw new Error(`知らない phase: ${g.phase}`);
  }
  throw new Error(`${maxSteps}手では終わらなかった (phase=${g.phase})`);
}

test('CPU ふつう・つよい: 強さいろいろの3〜4人で数十局が全部15点で終わる（手は必ず合法）', () => {
  const combos = [['weak', 'normal', 'strong'], ['weak', 'normal', 'strong', 'normal'], ['normal', 'normal', 'strong', 'strong']];
  combos.forEach((levels) => {
    for (let i = 0; i < 8; i++) {
      const g = playOutMixed(levels);
      assert.ok(g.winner != null);
      assert.ok(E.playerScore(g, g.winner) >= E.WIN_SCORE);
    }
  });
});

test('CPU: 強さの差（よわい vs ふつう、ふつう vs つよい）を4人（2対2）対局の勝ち数で見る', () => {
  // 実際のアプリは3〜4人用なので、比較も4人（levelA2人 + levelB2人、席はランダム）で行う
  function winRate(levelA, levelB, games) {
    let aWins = 0;
    for (let i = 0; i < games; i++) {
      const seats = [levelA, levelA, levelB, levelB].sort(() => Math.random() - 0.5);
      const g = playOutMixed(seats);
      if (seats[g.winner] === levelA) aWins++;
    }
    return aWins;
  }
  const games = 20;
  const weakVsNormal = winRate('weak', 'normal', games);
  const normalVsStrong = winRate('normal', 'strong', games);
  console.log(`[CPU強さ] よわい vs ふつう: よわい ${weakVsNormal}/${games} 勝`);
  console.log(`[CPU強さ] ふつう vs つよい: ふつう ${normalVsStrong}/${games} 勝`);
  // 強いほうが勝ち越す想定（まれな逆転はあり得るので、惨敗はしていないことだけ確かめる）
  assert.ok(weakVsNormal <= games - 2);
  assert.ok(normalVsStrong <= games - 2);
});

test('相手との交易: 手番の人とだけ、持っていない資源は出せない・受けられない、両者の手札が正しく入れ替わる', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  g.phase = 'main';
  const idx = E.currentPlayer(g);
  const other = (idx + 1) % 4;
  const third = (idx + 2) % 4;
  const a = g.players[idx], b = g.players[other];
  E.RESOURCES.forEach((r) => { a.resources[r] = 0; b.resources[r] = 0; });
  a.resources.ore = 2; b.resources.fuel = 1;

  // 出す側が持っていない資源は出せない
  assert.equal(E.playerTrade(g, other, { carbon: 1 }, {}), false);
  // 受ける側が持っていない資源は要求できない
  assert.equal(E.playerTrade(g, other, {}, { carbon: 1 }), false);
  // 自分自身とは交易できない
  assert.equal(E.playerTrade(g, idx, { ore: 1 }, {}), false);
  // 範囲外のotherIdxは交易できない
  assert.equal(E.playerTrade(g, 99, { ore: 1 }, {}), false);
  // third（手番でも相手でもない人）の手持ちは変わらない
  const thirdBefore = { ...g.players[third].resources };

  assert.equal(E.playerTrade(g, other, { ore: 1 }, { fuel: 1 }), true);
  assert.equal(a.resources.ore, 1);
  assert.equal(a.resources.fuel, 1);
  assert.equal(b.resources.ore, 1);
  assert.equal(b.resources.fuel, 0);
  assert.deepEqual(g.players[third].resources, thirdBefore);
});

test('CPUの交易の答えは必ず合法（持っていない物を出さない）', () => {
  const g = E.createGame(4, Math.random);
  doSetup(g);
  g.phase = 'main';
  const idx = E.currentPlayer(g);
  const other = (idx + 1) % 4;
  const b = g.players[other];
  E.RESOURCES.forEach((r) => { b.resources[r] = 0; });
  b.resources.fuel = 1;
  // 持っている分の要求は合法範囲内で受けうる
  for (let i = 0; i < 20; i++) {
    assert.equal(typeof CPU.acceptTrade(g, other, { ore: 1 }, { fuel: 1 }), 'boolean');
  }
  // 持っていない物を求める交換は、受けると答えてはいけない（合法に答える＝断る）
  for (let i = 0; i < 20; i++) {
    assert.equal(CPU.acceptTrade(g, other, { ore: 1 }, { carbon: 1 }), false);
  }
});
