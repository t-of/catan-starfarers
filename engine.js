'use strict';
// 宇宙を開拓するボードゲーム（試作）のルール・盤面・得点計算（画面・音・localStorage に触らない）。
// ブラウザ（main.js が import）からのみ使う。状態は 1 つのオブジェクト game に持たせ、
// 操作はすべて game を直接書き換える関数として export する（イミュータブルにはしない。1 台で交代するだけの試作のため）。
// 音を鳴らすべきことは game.events に積む。鳴らすかどうかは main.js が決める。
//
// 盤・発展カードの作り・交易の形などは ~/GitHub/tof/apps/catan/engine.js から書き方を写した（import はしない）。
// 遭遇（3.8、自前の20枚）は作業2で入れた。友好カード20枚（規7章の型、文面は自分の言葉）は作業3aで入れた
// （仕様 docs/private/specs/catan-starfarers.md の8章。3b・相手との交易は別作業）。

export const RESOURCES = ['ore', 'fuel', 'carbon', 'food', 'goods'];
export const RESOURCE_LABEL = { ore: '鉱石', fuel: '燃料', carbon: '炭素', food: '食料', goods: '商品' };

// ---- 0章: 絵にしかない仮の値。あとで差し替えるときはここだけ直す ----
export const COLONY_SYSTEMS = { // カタンの植民地4系（0.C、資料が小さく読み切れないため仮）
  alpha: { resources: ['ore', 'food', 'carbon'], discs: [[4], [8], [11]] },
  beta: { resources: ['ore', 'goods', 'carbon'], discs: [[8], [10], [3, 12]] },
  gamma: { resources: ['fuel', 'goods', 'ore'], discs: [[3], [6], [5]] },
  delta: { resources: ['food', 'carbon', 'fuel'], discs: [[2, 11], [6], [9]] },
};
// 8つの惑星系（0.B）。星1つ（組1）5系・星2つ（組2）3系。各系は惑星3つで資源が全部違う
const TIER1_SYSTEMS = [
  ['ore', 'fuel', 'carbon'],
  ['ore', 'fuel', 'food'],
  ['ore', 'carbon', 'food'],
  ['ore', 'food', 'goods'],
  ['fuel', 'carbon', 'goods'],
];
const TIER2_SYSTEMS = [
  ['fuel', 'food', 'goods'],
  ['carbon', 'food', 'goods'],
  ['ore', 'fuel', 'carbon'],
];
// 数字ディスクの組（0.D）。数値そのまま、海賊・氷はオブジェクトで表す
const DISC_POOLS = {
  tier1: [[3, 4, 4, 11, 12], [2, 5, 5, 6, 9], [10, 10, { pirate: 4 }, { pirate: 5 }, { ice: 3 }]],
  tier2: [[3, 4, 11], [5, 8, 9], [{ pirate: 6 }, 10, { ice: 4 }]],
};
const RESERVE_DISC_POOL = [3, 9, 10, 11, 11]; // 予備の数字ディスク（海賊・氷を片付けたあと置く）

export const COSTS = {
  colonyShip: { ore: 1, fuel: 1, carbon: 1, food: 1 },
  tradeShip: { ore: 1, fuel: 1, goods: 2 },
  spaceport: { carbon: 3, food: 2 },
  booster: { fuel: 2 },
  cannon: { carbon: 2 },
  pod: { ore: 2 },
};
export const MAX_BOOSTERS = 6, MAX_CANNONS = 6, MAX_PODS = 5;
export const MAX_COLONIES = 9, MAX_SPACEPORTS = 3, MAX_TRADE_STATIONS = 7, MAX_SHIPS_DEPLOYED = 3;
export const MAX_DOCKS_PER_OUTPOST = 5;
export const WIN_SCORE = 15;
const RESOURCE_TOTAL = 20; // 1種あたりの全体の枚数（資源カード100枚÷5種）
const RESERVE_START_PER = 8; // 予備の山、資源ごとの枚数

const BALLS = ['y', 'y', 'r', 'b', 'k'];
const BALL_VALUE = { y: 2, r: 3, b: 1, k: 0 };
const BASE_SPEED_ON_BLACK = 3; // 0.I・3.7: 黒が出たら基本の速さはいつも3

// ---- 3.8: 自前の遭遇20枚（文面は自分で書いた。公式の型だけを借りる） ----
// kind: 'yesno'（はい/いいえ）・'amount'（0〜maxの数を選ぶ）・'all'（全員が対象。選べない＝摩耗）
export const ENCOUNTERS = [
  { id: 'E1', name: '商人の船', count: 3, kind: 'amount', max: 3, prompt: '商人の船と出会った。資源を何枚贈る？' },
  { id: 'E2', name: '海賊の要求', count: 3, kind: 'yesno', prompt: '海賊が現れ、資源2枚を要求してきた。渡す？' },
  { id: 'E3', name: '海賊の待ち伏せ', count: 2, kind: 'yesno', prompt: '海賊に待ち伏せされた。戦う？' },
  { id: 'E4', name: '旅人', count: 2, kind: 'amount', max: 2, prompt: '旅人と出会った。資源を何枚贈る？' },
  { id: 'E5', name: 'ワームホール', count: 2, kind: 'yesno', prompt: 'ワームホールを見つけた。入る？' },
  { id: 'E6', name: '遭難船', count: 2, kind: 'yesno', prompt: '遭難した船を見つけた。助ける？' },
  { id: 'E7', name: '無人の補給基地', count: 2, kind: 'yesno', prompt: '無人の補給基地を見つけた。調べる？' },
  { id: 'E8', name: '迷子の交易船', count: 2, kind: 'yesno', prompt: '迷子の交易船を見つけた。引き取る？' },
  { id: 'E9', name: '摩耗', count: 2, kind: 'all', prompt: '母船のあちこちがすり減っている…' },
];

// ---- 3.9・規7章: 友好カード20枚（4種族×5枚。文面は自分の言葉で書いた。公式の型だけを借りる） ----
export const RACES = ['greenFolk', 'diplomat', 'merchant', 'scientist'];
export const RACE_LABEL = { greenFolk: '緑の民', diplomat: '外交官', merchant: '商人', scientist: '科学者' };
export const FRIEND_CARDS = [
  ...RESOURCES.map((r) => ({
    id: `green_${r}`, race: 'greenFolk', kind: 'bonusYield', res: r,
    name: `${RESOURCE_LABEL[r]}好きの民`, desc: `産出で${RESOURCE_LABEL[r]}を1枚以上もらえたら、さらに1枚`,
  })),
  { id: 'dip_tribute', race: 'diplomat', kind: 'reducedTribute', name: '顔の広い外交官', desc: '7のとき、手札13枚以上のときだけ半分捨てる（ふつうは8枚以上）' },
  { id: 'dip_fame_1', race: 'diplomat', kind: 'fameForSale', name: '名声の仲買人', desc: '自分の手番、商品1→名声1。手番に1回まで' },
  { id: 'dip_fame_2', race: 'diplomat', kind: 'fameForSale', name: '名声の仲買人', desc: '自分の手番、商品1→名声1。手番に1回まで' },
  { id: 'dip_help', race: 'diplomat', kind: 'helpingHand', name: '困ったときの仲介', desc: '自分より点の多い相手が2人以上いるとき、2人までの手札から1枚ずつランダムに取る。手番に1回まで' },
  { id: 'dip_relief', race: 'diplomat', kind: 'galacticFund', name: '非常用の蓄え', desc: '産出（7を除く）で1枚ももらえなかったとき、好きな資源1枚' },
  ...['ore', 'fuel', 'carbon', 'food'].map((r) => ({
    id: `merch_${r}`, race: 'merchant', kind: 'exchange21', res: r,
    name: `${RESOURCE_LABEL[r]}の仲買`, desc: `${RESOURCE_LABEL[r]}2→好きな資源1。何度でも`,
  })),
  { id: 'merch_goods', race: 'merchant', kind: 'exchange11goods', name: '商品の仲買', desc: '商品1→好きな資源1。手番に1回まで' },
  { id: 'sci_cannon', race: 'scientist', kind: 'cannonBoost', amount: 2, name: '砲術の研究', desc: '戦闘力+2（摩耗で減らない）' },
  { id: 'sci_booster', race: 'scientist', kind: 'boosterBoost', amount: 2, name: '推進の研究', desc: '速さ+2（摩耗で減らない）' },
  { id: 'sci_combo_1', race: 'scientist', kind: 'comboBoost', speed: 1, cannon: 1, name: '複合技術', desc: '速さ+1・戦闘力+1（摩耗で減らない）' },
  { id: 'sci_combo_2', race: 'scientist', kind: 'comboBoost', speed: 1, cannon: 1, name: '複合技術', desc: '速さ+1・戦闘力+1（摩耗で減らない）' },
  { id: 'sci_combo_3', race: 'scientist', kind: 'comboBoost', speed: 1, cannon: 1, name: '複合技術', desc: '速さ+1・戦闘力+1（摩耗で減らない）' },
];
function friendCardDefs(p) { return (p.friendCards || []).map((id) => FRIEND_CARDS.find((c) => c.id === id)).filter(Boolean); }
export function hasFriendCard(p, kind, res) { return friendCardDefs(p).some((c) => c.kind === kind && (res == null || c.res === res)); }
function speedBonusFromCards(p) { return friendCardDefs(p).reduce((a, c) => a + (c.kind === 'boosterBoost' ? c.amount : c.kind === 'comboBoost' ? c.speed : 0), 0); }
export function combatBonusFromCards(p) { return friendCardDefs(p).reduce((a, c) => a + (c.kind === 'cannonBoost' ? c.amount : c.kind === 'comboBoost' ? c.cannon : 0), 0); }

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function freshEncounterDeck(rng = Math.random) {
  return shuffle(ENCOUNTERS.flatMap((e) => Array(e.count).fill(e.id)), rng);
}
function round3(n) { return Math.round(n * 1000) / 1000; }
function emptyResources() { return { ore: 0, fuel: 0, carbon: 0, food: 0, goods: 0 }; }
function sumRes(o) { return RESOURCES.reduce((a, k) => a + (o[k] || 0), 0); }
function canAfford(res, cost) { return Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v); }
function payCost(res, cost) { Object.entries(cost).forEach(([k, v]) => { res[k] -= v; }); }
// 建てる・買うのに払った資源は銀行に戻す（catan の buildRoad などと同じ。でないと海賊退治や交易所にずっと使われる資源が市場から消えてしまう）
function payCostToBank(game, res, cost) { payCost(res, cost); RESOURCES.forEach((r) => { game.bank[r] += cost[r] || 0; }); }
function log(game, text) { game.log.push(text); if (game.log.length > 200) game.log.shift(); }
function fire(game, evt) { game.events.push(evt); }

// ================================================================
// 盤の幾何（catan の hexCorner・hexCenter・buildGeometry の書き方を写した）
// ================================================================
function hexCorner(cx, cy, i) {
  const deg = 60 * i - 30; // pointy-top
  const rad = (Math.PI / 180) * deg;
  return [round3(cx + Math.cos(rad)), round3(cy + Math.sin(rad))];
}
// 丸めるのは hexCorner の戻り値だけ（ここで丸めると、大きい盤では隣どうしの誤差が丸めの境目をまたいで
// 同じ頂点なのに別キーになることがある。catan の盤は小さいのでこの罠を踏まない）
function hexCenter(q, r) { return [Math.sqrt(3) * (q + r / 2), 1.5 * r]; }

function buildGeometry(hexes) {
  const vKeyToId = new Map();
  const vertices = [];
  const eKeyToId = new Map();
  const edges = [];
  function vertexAt(cx, cy, i) {
    const [x, y] = hexCorner(cx, cy, i);
    const key = `${x},${y}`;
    let id = vKeyToId.get(key);
    if (id == null) {
      id = vertices.length;
      vKeyToId.set(key, id);
      vertices.push({
        id, x, y, hexIds: [], edgeIds: [], neighbors: [],
        kind: 'plain', sectorId: null, building: null, blocked: false, spaceportOwner: null, shipHere: null,
      });
    }
    return id;
  }
  function edgeBetween(va, vb, hexId) {
    const key = va < vb ? `${va}-${vb}` : `${vb}-${va}`;
    let id = eKeyToId.get(key);
    if (id == null) {
      id = edges.length;
      eKeyToId.set(key, id);
      edges.push({ id, v1: va, v2: vb, hexIds: [] });
      vertices[va].edgeIds.push(id);
      vertices[vb].edgeIds.push(id);
      vertices[va].neighbors.push(vb);
      vertices[vb].neighbors.push(va);
    }
    edges[id].hexIds.push(hexId);
    return id;
  }
  hexes.forEach((hex) => {
    const [cx, cy] = hexCenter(hex.q, hex.r);
    const corners = [0, 1, 2, 3, 4, 5].map((i) => vertexAt(cx, cy, i));
    corners.forEach((va, i) => {
      const vb = corners[(i + 1) % 6];
      const eId = edgeBetween(va, vb, hex.id);
      hex.edgeIds.push(eId);
    });
    corners.forEach((vid) => { if (!vertices[vid].hexIds.includes(hex.id)) vertices[vid].hexIds.push(hex.id); });
    hex.vertexIds = corners;
  });
  return { vertices, edges };
}

// ================================================================
// 盤の生成（3.1: 戦略ルール）
// セクター＝3ヘクスの三つ葉（互いに隣り合う3マス）。土台は広い長方形の格子（全部ふさいで一つながりにする）。
// 「手前」にカタンの植民地4系、真ん中に8か所（惑星系5・何もない宇宙3）、奥に7か所（惑星系3・前哨基地4）を
// 列ごとに分けて置き、間の列は無印の宇宙（背景）のままにする（セクターどうしの間に1列以上あく）。
// ================================================================
const ROW_COLONY = 0, ROW_FRONT = 3, ROW_BACK = 6; // 各セクターは anchor行とanchor+1行の2行を使う
const SLOT_GAP = 3; // セクター間のアンカー列の間隔（1列あける）

function anchorsFor(row, count) {
  return Array.from({ length: count }, (_, i) => ({ q: i * SLOT_GAP, r: row }));
}

function normalizeDisc(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { faceUp: false, numbers: [raw], token: null };
  if (Array.isArray(raw)) return { faceUp: false, numbers: raw, token: null };
  if (raw.pirate != null) return { faceUp: false, numbers: null, token: { kind: 'pirate', strength: raw.pirate } };
  if (raw.ice != null) return { faceUp: false, numbers: null, token: { kind: 'ice', strength: raw.ice } };
  return null;
}

function buildSectorContent(rng) {
  const tier1 = shuffle(TIER1_SYSTEMS, rng);
  const tier2 = shuffle(TIER2_SYSTEMS, rng);
  const pool1 = DISC_POOLS.tier1.map((p) => shuffle(p, rng));
  const pool2 = DISC_POOLS.tier2.map((p) => shuffle(p, rng));
  const frontSystems = tier1.map((resources, i) => ({ resources, discs: [pool1[0][i], pool1[1][i], pool1[2][i]] }));
  const backSystems = tier2.map((resources, i) => ({ resources, discs: [pool2[0][i], pool2[1][i], pool2[2][i]] }));
  return { frontSystems, backSystems };
}

export function createGame(playerCount, rng = Math.random, options = {}) {
  const { frontSystems, backSystems } = buildSectorContent(rng);
  const frontSlots = shuffle([
    ...frontSystems.map((s) => ({ kind: 'system', data: s })),
    { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' },
  ], rng);
  const backSlots = shuffle([
    ...backSystems.map((s) => ({ kind: 'system', data: s })),
    { kind: 'outpost' }, { kind: 'outpost' }, { kind: 'outpost' }, { kind: 'outpost' },
  ], rng);
  const colonyLetters = shuffle(['alpha', 'beta', 'gamma', 'delta'], rng);
  const colonySlots = colonyLetters.map((letter) => ({ kind: 'system', letter, data: COLONY_SYSTEMS[letter] }));

  const tiers = [
    { tier: 'colony', row: ROW_COLONY, slots: colonySlots },
    { tier: 'front', row: ROW_FRONT, slots: frontSlots },
    { tier: 'back', row: ROW_BACK, slots: backSlots },
  ];

  // 長方形の格子を全部ふさいで一つながりにする（余白をたっぷり取り、境界の頂点の次数が崩れないようにする）
  const MARGIN = 2;
  const maxAnchorQ = Math.max(...tiers.map((t) => (t.slots.length - 1) * SLOT_GAP));
  const qMin = -MARGIN, qMax = maxAnchorQ + 1 + MARGIN;
  const rMin = -MARGIN, rMax = ROW_BACK + 1 + MARGIN;
  const hexes = [];
  const byCoord = new Map();
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      const hex = { id: hexes.length, q, r, sectorId: null, resource: null, disc: null, edgeIds: [], vertexIds: [] };
      byCoord.set(`${q},${r}`, hex);
      hexes.push(hex);
    }
  }

  const sectors = [];
  tiers.forEach(({ tier, row, slots }) => {
    const anchors = anchorsFor(row, slots.length);
    slots.forEach((slot, i) => {
      const { q, r } = anchors[i];
      const hexA = byCoord.get(`${q},${r}`);
      const hexB = byCoord.get(`${q + 1},${r}`);
      const hexC = byCoord.get(`${q},${r + 1}`);
      const triad = [hexA, hexB, hexC];
      const sectorId = sectors.length;
      const sector = { id: sectorId, tier, kind: slot.kind, letter: slot.letter || null, hexIds: triad.map((h) => h.id), centerVertexId: null, siteVertexIds: null, tradeStations: [], friendshipMarker: null };
      triad.forEach((h) => { h.sectorId = sectorId; });
      if (slot.kind === 'system') {
        triad.forEach((h, idx) => {
          h.resource = slot.data.resources[idx];
          h.disc = normalizeDisc(slot.data.discs[idx]);
        });
        if (tier === 'colony') triad.forEach((h) => { h.disc.faceUp = true; }); // カタンの植民地は最初から表
      }
      sectors.push(sector);
    });
  });

  const { vertices, edges } = buildGeometry(hexes);

  // セクターごとの中心（真ん中の交点）と、系なら3つの植民地の場所を求める
  sectors.forEach((sector) => {
    const [ha, hb, hc] = sector.hexIds.map((id) => hexes[id]);
    const center = ha.vertexIds.find((v) => hb.vertexIds.includes(v) && hc.vertexIds.includes(v));
    sector.centerVertexId = center;
    const outerBetween = (h1, h2) => h1.vertexIds.find((v) => h2.vertexIds.includes(v) && v !== center);
    vertices[center].sectorId = sector.id;
    if (sector.kind === 'system') {
      vertices[center].kind = 'systemCenter';
      sector.siteVertexIds = [outerBetween(ha, hb), outerBetween(hb, hc), outerBetween(hc, ha)];
      sector.siteVertexIds.forEach((vid) => { vertices[vid].kind = 'colonySite'; vertices[vid].sectorId = sector.id; });
    } else if (sector.kind === 'outpost') {
      vertices[center].kind = 'outpostCenter';
    }
    // kind==='empty'（何もない宇宙）は真ん中も通れる。plainのままでよい
  });

  // 3.9・規7章: 前哨基地4つに種族を1つずつランダムに割り振り、友好カード5枚ずつを残り札として持たせる
  const racesShuffled = shuffle(RACES, rng);
  shuffle(sectors.filter((s) => s.kind === 'outpost'), rng).forEach((s, i) => {
    s.race = racesShuffled[i];
    s.friendCardsLeft = FRIEND_CARDS.filter((c) => c.race === s.race).map((c) => c.id);
  });

  // 3人のとき: カタンの植民地12か所のうち9か所(=3人×3周)が埋まるよう、3つの惑星系に1か所ずつふさぐ（13章・6番）
  if (playerCount === 3) {
    const colonySectors = shuffle(sectors.filter((s) => s.tier === 'colony'), rng).slice(0, 3);
    colonySectors.forEach((sector) => {
      const vid = sector.siteVertexIds[Math.floor(rng() * 3)];
      vertices[vid].blocked = true;
    });
  }

  const board = { hexes, vertices, edges, sectors };

  const names = options.names || [];
  const players = Array.from({ length: playerCount }, (_, i) => ({
    idx: i,
    name: names[i] || `プレイヤー${i + 1}`,
    resources: emptyResources(),
    colonies: [], spaceports: [],
    ships: [], shipsAvailable: 3,
    colonySupply: MAX_COLONIES, spaceportSupply: MAX_SPACEPORTS, tradeStationSupply: MAX_TRADE_STATIONS,
    tradeStations: [], // [{ sectorId }]
    boosters: 0, cannons: 0, pods: 0,
    fame: 0,
    tokens: [], // 片付けた海賊・氷 { kind, strength }
    tradeShipMarkers: 0, // 遭遇でもらったのに置けなかった交易船（3.8 E8。空いたら置く）
    friendCards: [], // 友好カードのid（3.9）
    oncePerTurn: { fameForSale: false, helpingHand: false, exchange11goods: false }, // 手番に1回までの友好カード（3.9・規7章）
  }));

  const firstPlayer = Math.floor(rng() * playerCount);
  const forward = Array.from({ length: playerCount }, (_, i) => (firstPlayer + i) % playerCount);
  const backward = forward.slice().reverse();
  const setupSequence = [...forward, ...backward, ...forward, ...backward];

  const reserve = shuffle(RESOURCES.flatMap((r) => Array(RESERVE_START_PER).fill(r)), rng);
  const bank = emptyResources();
  RESOURCES.forEach((r) => { bank[r] = RESOURCE_TOTAL - RESERVE_START_PER; });

  const game = {
    rulesVersion: 2,
    playerCount, players, board,
    bank, reserve, reserveDiscs: shuffle(RESERVE_DISC_POOL, rng),
    bonusPool: { booster: 2, cannon: 1, pod: 1 },
    // setupColony → setupPort → roll → discard → steal → main → flight → encounter → encounterWear → friendship → galacticFund → gameOver
    phase: 'setupColony',
    firstPlayer,
    setupSequence, setupPos: 0,
    turn: firstPlayer, turnNumber: 1,
    ballsShown: null, speed: 0,
    pendingDiscards: [], // [{ player, count }]
    encounterDeck: freshEncounterDeck(rng), encounterDiscard: [], encounter: null, encounterBalls: null,
    frozenShipId: null,
    pendingWear: [], pendingWearDiscards: [], // 摩耗（E9）: 同数で本人が選ぶ／8枚以上で1枚捨てる
    pendingFriendship: null, // { player, sectorId, returnPhase }（3.9: 交易所を建てたときのカード選び）
    pendingGalacticFund: [], // [{ player }]（3.9・銀河救援基金）
    nextShipSeq: 0,
    winner: null,
    events: [], log: [],
  };
  return game;
}

// ================================================================
// 手番・名前・得点
// ================================================================
export function currentPlayer(game) {
  if (game.phase.startsWith('setup')) return game.setupSequence[game.setupPos];
  if (game.phase === 'discard') return game.turn; // 捨てる人は discardCards の引数で指定する。手番自体は変わらない
  return game.turn;
}
export function actingPlayer(game) { return currentPlayer(game); }
export function playerName(game, idx) { return (game.players[idx] && game.players[idx].name) || `プレイヤー${idx + 1}`; }

export function friendshipMarkerCount(game, idx) {
  return game.board.sectors.filter((s) => s.kind === 'outpost' && s.friendshipMarker === idx).length;
}
export function playerScore(game, idx) {
  const p = game.players[idx];
  return p.colonies.length * 1 + p.spaceports.length * 2
    + friendshipMarkerCount(game, idx) * 2
    + p.tokens.length * 1
    + Math.floor(p.fame / 2);
}
function checkWin(game, idx) {
  if (game.winner != null) return;
  if (idx !== currentPlayer(game)) return; // 手番の人だけ判定する（3.10）
  if (playerScore(game, idx) >= WIN_SCORE) { game.winner = idx; game.phase = 'gameOver'; fire(game, 'win'); log(game, `${playerName(game, idx)} が勝ち！`); }
}

// ================================================================
// 盤のテスト・CPU 用のヘルパー
// ================================================================
export function sectorCounts(game) {
  const by = (tier) => game.board.sectors.filter((s) => s.tier === tier);
  return {
    colony: by('colony').length,
    front: by('front').length,
    frontSystem: by('front').filter((s) => s.kind === 'system').length,
    frontEmpty: by('front').filter((s) => s.kind === 'empty').length,
    back: by('back').length,
    backSystem: by('back').filter((s) => s.kind === 'system').length,
    backOutpost: by('back').filter((s) => s.kind === 'outpost').length,
  };
}
export function colonySiteCount(game) {
  return game.board.sectors.filter((s) => s.kind === 'system').reduce((a, s) => a + s.siteVertexIds.length, 0);
}
// 真ん中（惑星系）を除いて、全交点が1つながりかどうか
export function boardConnected(game) {
  const vs = game.board.vertices;
  const start = vs.findIndex((v) => v.kind !== 'systemCenter');
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    vs[cur].neighbors.forEach((n) => {
      if (vs[n].kind === 'systemCenter' || seen.has(n)) return;
      seen.add(n); stack.push(n);
    });
  }
  const total = vs.filter((v) => v.kind !== 'systemCenter').length;
  return seen.size === total;
}
// 2交点の最短手数（惑星系の真ん中を通れない）
export function shortestDistance(game, fromId, toId) {
  const vs = game.board.vertices;
  const seen = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) return seen.get(cur);
    vs[cur].neighbors.forEach((n) => {
      if (vs[n].kind === 'systemCenter' || seen.has(n)) return;
      seen.set(n, seen.get(cur) + 1); queue.push(n);
    });
  }
  return Infinity;
}

// ================================================================
// セットアップ（3.2）
// ================================================================
export function availableSetupColonySites(game) {
  if (!game.phase.startsWith('setupColony')) return [];
  return game.board.sectors.filter((s) => s.tier === 'colony')
    .flatMap((s) => s.siteVertexIds)
    .filter((vid) => !game.board.vertices[vid].blocked && !game.board.vertices[vid].building);
}
export function setupPlaceColony(game, vertexId) {
  if (game.phase !== 'setupColony' && !(game.phase.startsWith('setup') && Math.floor(game.setupPos / game.playerCount) < 3)) return false;
  const idx = currentPlayer(game);
  const v = game.board.vertices[vertexId];
  if (!v || v.kind !== 'colonySite' || v.blocked || v.building) return false;
  if (!game.board.sectors.find((s) => s.tier === 'colony' && s.siteVertexIds && s.siteVertexIds.includes(vertexId))) return false;
  const p = game.players[idx];
  v.building = { type: 'colony', owner: idx };
  p.colonies.push(vertexId); p.colonySupply--;
  log(game, `${playerName(game, idx)} が植民地を建てた`);
  fire(game, 'build');
  advanceSetup(game);
  return true;
}
function advanceSetup(game) {
  game.setupPos++;
  if (game.setupPos >= game.playerCount * 4) { finishSetup(game); return; }
  game.phase = Math.floor(game.setupPos / game.playerCount) < 3 ? 'setupColony' : 'setupPort';
}
function finishSetup(game) {
  game.players.forEach((p) => {
    drawReserve(game, p.idx, 3);
    p.fame = 1;
  });
  game.phase = 'roll';
  game.turn = game.firstPlayer;
  game.turnNumber = 1;
  log(game, '準備が終わった。最初の手番を始める');
}
// 4周目: 自分の植民地1つを宇宙港にし、隣の宇宙港の場所に船1隻、ボーナスから1つ（あれば）
export function spaceportSitesFor(game, colonyVertexId) {
  const v = game.board.vertices[colonyVertexId];
  if (!v) return [];
  return v.neighbors.filter((n) => game.board.vertices[n].kind !== 'systemCenter');
}
// 自分の宇宙港のまわりで、今すぐ船を置ける（空いている）場所（main.js・遭遇の無料交易船・交易船マーカーで使う）
export function freeSpaceportSitesFor(game, idx) {
  const p = game.players[idx];
  const seen = new Set();
  p.spaceports.forEach((v) => spaceportSitesFor(game, v).forEach((s) => seen.add(s)));
  return [...seen].filter((vid) => {
    const v = game.board.vertices[vid];
    return v.kind === 'spaceportSite' && v.spaceportOwner === idx && !v.building && !v.shipHere;
  });
}
// 交易船マーカー（3.8 E8）を、宇宙港の場所が空き次第、無料の交易船として置く
export function tryPlaceTradeShipMarkers(game, idx) {
  const p = game.players[idx];
  while ((p.tradeShipMarkers || 0) > 0 && p.shipsAvailable > 0 && p.ships.length < MAX_SHIPS_DEPLOYED) {
    const site = freeSpaceportSitesFor(game, idx)[0];
    if (site == null) break;
    const shipId = `${idx}-${game.nextShipSeq++}`;
    p.ships.push({ id: shipId, kind: 'trade', vertexId: site, movesLeft: 0 });
    p.shipsAvailable--; p.tradeShipMarkers--;
    game.board.vertices[site].shipHere = { owner: idx, shipId };
    log(game, `${playerName(game, idx)} の交易船マーカーが宇宙港の場所に置かれた`);
    fire(game, 'build');
  }
}
export function setupDoPortRound(game, { colonyVertexId, siteVertexId, shipKind, bonusKind }) {
  if (game.phase !== 'setupPort') return false;
  const idx = currentPlayer(game);
  const p = game.players[idx];
  if (!p.colonies.includes(colonyVertexId)) return false;
  const sites = spaceportSitesFor(game, colonyVertexId);
  const site = siteVertexId != null && sites.includes(siteVertexId) ? siteVertexId
    : sites.find((s) => !game.board.vertices[s].building && !game.board.vertices[s].shipHere);
  if (site == null) return false;
  const siteV = game.board.vertices[site];
  if (siteV.building || siteV.shipHere) return false;
  if (shipKind !== 'colony' && shipKind !== 'trade') return false;

  const colonyV = game.board.vertices[colonyVertexId];
  p.colonies = p.colonies.filter((v) => v !== colonyVertexId);
  p.spaceports.push(colonyVertexId);
  colonyV.building.type = 'spaceport';
  p.spaceportSupply--;
  sites.forEach((s) => { const sv = game.board.vertices[s]; if (sv.spaceportOwner == null) { sv.spaceportOwner = idx; if (sv.kind === 'plain') sv.kind = 'spaceportSite'; } });

  const shipId = `${idx}-${game.nextShipSeq++}`;
  p.ships.push({ id: shipId, kind: shipKind, vertexId: site, movesLeft: 0 });
  p.shipsAvailable--;
  siteV.shipHere = { owner: idx, shipId };

  if (bonusKind && game.bonusPool[bonusKind] > 0) {
    game.bonusPool[bonusKind]--;
    if (bonusKind === 'booster') p.boosters++;
    else if (bonusKind === 'cannon') p.cannons++;
    else if (bonusKind === 'pod') p.pods++;
  }
  log(game, `${playerName(game, idx)} が宇宙港を作った`);
  fire(game, 'build');
  advanceSetup(game);
  return true;
}

// ================================================================
// 予備の山（3.5・AL）
// ================================================================
function rebuildReserve(game) {
  RESOURCES.forEach((r) => {
    const n = Math.min(RESERVE_START_PER, game.bank[r]);
    game.bank[r] -= n;
    for (let i = 0; i < n; i++) game.reserve.push(r);
  });
  game.reserve = shuffle(game.reserve, Math.random);
}
function drawReserve(game, idx, count) {
  for (let i = 0; i < count; i++) {
    if (!game.reserve.length) rebuildReserve(game);
    if (!game.reserve.length) break;
    const r = game.reserve.pop();
    game.players[idx].resources[r]++;
  }
}
export function reserveDrawCountFor(score) {
  if (score >= 10) return 0;
  if (score >= 8) return 1;
  return 2;
}

// ================================================================
// 産出・7（3.5・3.6）
// ================================================================
function distributeResources(game, total) {
  const demand = emptyResources();
  const contributions = []; // { player, res }
  game.board.hexes.forEach((hex) => {
    if (!hex.disc || !hex.disc.faceUp || hex.disc.token || !hex.disc.numbers || !hex.disc.numbers.includes(total)) return;
    hex.vertexIds.forEach((vid) => {
      const v = game.board.vertices[vid];
      if (!v.building) return;
      contributions.push({ player: v.building.owner, res: hex.resource });
      demand[hex.resource] += 1;
    });
  });
  const got = new Set(); // 3.9: このロールで何か1枚でももらえた人（緑の民・銀河救援基金の判定に使う）
  RESOURCES.forEach((res) => {
    if (demand[res] === 0) return;
    if (demand[res] > game.bank[res]) { fire(game, 'shortage'); return; } // 誰ももらえない
    const recipients = new Set();
    contributions.filter((c) => c.res === res).forEach((c) => {
      game.players[c.player].resources[res]++;
      game.bank[res]--;
      recipients.add(c.player);
    });
    recipients.forEach((pi) => {
      got.add(pi);
      const p = game.players[pi];
      if (hasFriendCard(p, 'bonusYield', res) && game.bank[res] > 0) { p.resources[res]++; game.bank[res]--; } // 緑の民: その資源を1枚以上もらったら+1
    });
  });
  return got;
}
function discardThresholdFor(p) { return hasFriendCard(p, 'reducedTribute') ? 13 : 8; } // 外交官「減らされた貢ぎ物」
export function rollDice(game, rng = Math.random) {
  if (game.phase !== 'roll') return null;
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  game.diceLast = [d1, d2];
  fire(game, 'dice');
  log(game, `サイコロ: ${d1} + ${d2} = ${total}`);
  if (total === 7) {
    game.pendingDiscards = game.players
      .filter((p) => sumRes(p.resources) >= discardThresholdFor(p))
      .map((p) => ({ player: p.idx, count: Math.floor(sumRes(p.resources) / 2) }));
    game.phase = game.pendingDiscards.length ? 'discard' : resolveAfterSeven(game);
  } else {
    const got = distributeResources(game, total);
    const idx = currentPlayer(game);
    drawReserve(game, idx, reserveDrawCountFor(playerScore(game, idx)));
    // 外交官「銀河救援基金」: 7以外でこのロールで1枚ももらえなかった人が、好きな資源1枚
    game.pendingGalacticFund = game.players.filter((p) => !got.has(p.idx) && hasFriendCard(p, 'galacticFund')).map((p) => ({ player: p.idx }));
    game.phase = game.pendingGalacticFund.length ? 'galacticFund' : 'main';
  }
  return total;
}
export function resolveGalacticFund(game, playerIdx, res) {
  if (game.phase !== 'galacticFund') return false;
  if (!game.pendingGalacticFund.find((d) => d.player === playerIdx)) return false;
  if (!RESOURCES.includes(res)) return false;
  if (game.bank[res] > 0) { game.bank[res]--; game.players[playerIdx].resources[res]++; }
  game.pendingGalacticFund = game.pendingGalacticFund.filter((d) => d.player !== playerIdx);
  if (!game.pendingGalacticFund.length) game.phase = 'main';
  return true;
}
export function discardCards(game, playerIdx, discardObj) {
  const pending = game.pendingDiscards.find((d) => d.player === playerIdx);
  if (!pending) return false;
  const total = sumRes(discardObj);
  if (total !== pending.count) return false;
  const p = game.players[playerIdx];
  if (!canAfford(p.resources, discardObj)) return false;
  payCost(p.resources, discardObj);
  RESOURCES.forEach((r) => { game.bank[r] += discardObj[r] || 0; });
  game.pendingDiscards = game.pendingDiscards.filter((d) => d.player !== playerIdx);
  if (game.pendingDiscards.length === 0) game.phase = resolveAfterSeven(game);
  return true;
}
export function sevenTargets(game) {
  const idx = currentPlayer(game);
  return game.players.map((p) => p.idx).filter((i) => i !== idx && sumRes(game.players[i].resources) > 0);
}
function resolveAfterSeven(game) {
  if (sevenTargets(game).length) return 'steal';
  finishSevenAftermath(game);
  return 'main';
}
function finishSevenAftermath(game) {
  const idx = currentPlayer(game);
  game.players.forEach((p) => { if (p.idx !== idx) drawReserve(game, p.idx, 1); });
  drawReserve(game, idx, reserveDrawCountFor(playerScore(game, idx)));
}
export function resolveSteal(game, targetIdx) {
  if (game.phase !== 'steal') return false;
  const idx = currentPlayer(game);
  const targets = sevenTargets(game);
  if (!targets.includes(targetIdx)) return false;
  const res = game.players[targetIdx].resources;
  const pool = RESOURCES.flatMap((r) => Array(res[r]).fill(r));
  if (pool.length) {
    const picked = pool[Math.floor(Math.random() * pool.length)];
    res[picked]--; game.players[idx].resources[picked]++;
  }
  finishSevenAftermath(game);
  game.phase = 'main';
  fire(game, 'rob');
  return true;
}

// ================================================================
// 交易・建設（3.9・4章・11章）
// ================================================================
function rateFor(p, res) { return hasFriendCard(p, 'exchange21', res) ? 2 : (res === 'goods' ? 2 : 3); } // 商人の交換カードで率が良くなる
export function bankTrade(game, giveRes, wantRes) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game);
  const p = game.players[idx];
  const rate = rateFor(p, giveRes);
  if ((p.resources[giveRes] || 0) < rate) return false;
  if (game.bank[wantRes] <= 0) return false;
  p.resources[giveRes] -= rate; game.bank[giveRes] += rate;
  p.resources[wantRes]++; game.bank[wantRes]--;
  fire(game, 'trade');
  return true;
}
// 外交官「名声の売り物」: 商品1→名声1。手番に1回（2枚持っていても1回）
export function buyFameWithGoods(game) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  if (!hasFriendCard(p, 'fameForSale') || p.oncePerTurn.fameForSale) return false;
  if ((p.resources.goods || 0) < 1) return false;
  p.resources.goods--; game.bank.goods++;
  gainFame(p, 1);
  p.oncePerTurn.fameForSale = true;
  fire(game, 'trade');
  checkWin(game, idx);
  return true;
}
// 商人「商品1:1」: 商品1→好きな資源1。手番に1回
export function merchantGoodsExchange(game, wantRes) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  if (!hasFriendCard(p, 'exchange11goods') || p.oncePerTurn.exchange11goods) return false;
  if ((p.resources.goods || 0) < 1 || wantRes === 'goods') return false;
  if (game.bank[wantRes] <= 0) return false;
  p.resources.goods--; game.bank.goods++;
  p.resources[wantRes]++; game.bank[wantRes]--;
  p.oncePerTurn.exchange11goods = true;
  fire(game, 'trade');
  return true;
}
// 外交官「助けの手」: 自分より点の多い相手が2人以上いるときだけ使える。手番に1回
export function helpingHandTargets(game) {
  if (game.phase !== 'main') return [];
  const idx = currentPlayer(game); const p = game.players[idx];
  if (!hasFriendCard(p, 'helpingHand') || p.oncePerTurn.helpingHand) return [];
  const myScore = playerScore(game, idx);
  const richer = game.players.filter((o) => o.idx !== idx && playerScore(game, o.idx) > myScore).map((o) => o.idx);
  return richer.length >= 2 ? richer : [];
}
export function helpingHandSteal(game, targets, rng = Math.random) {
  const idx = currentPlayer(game); const p = game.players[idx];
  const avail = helpingHandTargets(game);
  if (!avail.length) return false;
  const chosen = targets.filter((t) => avail.includes(t)).slice(0, 2);
  if (!chosen.length) return false;
  chosen.forEach((t) => {
    const op = game.players[t];
    const pool = RESOURCES.flatMap((r) => Array(op.resources[r]).fill(r));
    if (!pool.length) return;
    const picked = pool[Math.floor(rng() * pool.length)];
    op.resources[picked]--; p.resources[picked]++;
  });
  p.oncePerTurn.helpingHand = true;
  fire(game, 'trade');
  return true;
}
// 相手との交易（5章: 逆提案なし。手番の人が出し、相手が受けるか断るかだけ）
export function playerTrade(game, otherIdx, give, get) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game);
  if (idx === otherIdx || otherIdx < 0 || otherIdx >= game.playerCount) return false; // 手番でない人どうしは交易できない
  const a = game.players[idx], b = game.players[otherIdx];
  if (!canAfford(a.resources, give) || !canAfford(b.resources, get)) return false;
  payCost(a.resources, give); payCost(b.resources, get);
  Object.entries(give).forEach(([r, n]) => { b.resources[r] += n; });
  Object.entries(get).forEach(([r, n]) => { a.resources[r] += n; });
  fire(game, 'trade');
  return true;
}
export function buildColonyShip(game, siteVertexId) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  const v = game.board.vertices[siteVertexId];
  if (!v || v.kind !== 'spaceportSite' || v.spaceportOwner !== idx || v.building || v.shipHere) return false;
  if (p.shipsAvailable <= 0 || p.ships.length >= MAX_SHIPS_DEPLOYED) return false;
  if (!canAfford(p.resources, COSTS.colonyShip)) return false;
  payCostToBank(game, p.resources, COSTS.colonyShip); p.shipsAvailable--;
  const shipId = `${idx}-${game.nextShipSeq++}`;
  p.ships.push({ id: shipId, kind: 'colony', vertexId: siteVertexId, movesLeft: 0 });
  v.shipHere = { owner: idx, shipId };
  fire(game, 'build');
  return true;
}
export function buildTradeShip(game, siteVertexId) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  const v = game.board.vertices[siteVertexId];
  if (!v || v.kind !== 'spaceportSite' || v.spaceportOwner !== idx || v.building || v.shipHere) return false;
  if (p.shipsAvailable <= 0 || p.ships.length >= MAX_SHIPS_DEPLOYED) return false;
  if (!canAfford(p.resources, COSTS.tradeShip)) return false;
  payCostToBank(game, p.resources, COSTS.tradeShip); p.shipsAvailable--;
  const shipId = `${idx}-${game.nextShipSeq++}`;
  p.ships.push({ id: shipId, kind: 'trade', vertexId: siteVertexId, movesLeft: 0 });
  v.shipHere = { owner: idx, shipId };
  fire(game, 'build');
  return true;
}
export function buildSpaceport(game, colonyVertexId) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  if (!p.colonies.includes(colonyVertexId)) return false;
  if (p.spaceportSupply <= 0) return false;
  if (!canAfford(p.resources, COSTS.spaceport)) return false;
  payCostToBank(game, p.resources, COSTS.spaceport);
  const v = game.board.vertices[colonyVertexId];
  p.colonies = p.colonies.filter((x) => x !== colonyVertexId);
  p.spaceports.push(colonyVertexId);
  v.building.type = 'spaceport';
  p.spaceportSupply--;
  spaceportSitesFor(game, colonyVertexId).forEach((s) => {
    const sv = game.board.vertices[s];
    if (sv.spaceportOwner == null) { sv.spaceportOwner = idx; if (sv.kind === 'plain') sv.kind = 'spaceportSite'; }
  });
  fire(game, 'build');
  tryPlaceTradeShipMarkers(game, idx);
  checkWin(game, idx);
  return true;
}
export function buyUpgrade(game, kind) {
  if (game.phase !== 'main') return false;
  const idx = currentPlayer(game); const p = game.players[idx];
  const cost = COSTS[kind];
  if (!cost) return false;
  const caps = { booster: MAX_BOOSTERS, cannon: MAX_CANNONS, pod: MAX_PODS };
  const key = kind === 'booster' ? 'boosters' : kind === 'cannon' ? 'cannons' : 'pods';
  if (p[key] >= caps[kind]) return false;
  if (!canAfford(p.resources, cost)) return false;
  payCostToBank(game, p.resources, cost); p[key]++;
  fire(game, 'build');
  return true;
}

function findShip(game, shipId) {
  for (const p of game.players) {
    const ship = p.ships.find((s) => s.id === shipId);
    if (ship) return { player: p, ship };
  }
  return null;
}
export function canBuildColonyAt(game, shipId) {
  const found = findShip(game, shipId);
  if (!found) return false;
  const { player, ship } = found;
  if (ship.kind !== 'colony') return false;
  const v = game.board.vertices[ship.vertexId];
  if (v.kind !== 'colonySite' || v.building || v.blocked) return false;
  if (v.hexIds.some((hId) => { const h = game.board.hexes[hId]; return h.disc && h.disc.token; })) return false;
  if (player.colonySupply <= 0) return false;
  return true;
}
export function buildColonyAt(game, shipId) {
  if (!canBuildColonyAt(game, shipId)) return false;
  const { player, ship } = findShip(game, shipId);
  const v = game.board.vertices[ship.vertexId];
  v.building = { type: 'colony', owner: player.idx };
  v.shipHere = null;
  player.colonies.push(ship.vertexId); player.colonySupply--;
  player.ships = player.ships.filter((s) => s.id !== shipId);
  player.shipsAvailable++;
  log(game, `${playerName(game, player.idx)} が植民地を建てた`);
  fire(game, 'build');
  checkWin(game, player.idx);
  return true;
}
export function canBuildTradeStationAt(game, shipId) {
  const found = findShip(game, shipId);
  if (!found) return false;
  const { player, ship } = found;
  if (ship.kind !== 'trade') return false;
  const v = game.board.vertices[ship.vertexId];
  if (v.kind !== 'outpostCenter') return false;
  const sector = game.board.sectors[v.sectorId];
  if (sector.tradeStations.length >= MAX_DOCKS_PER_OUTPOST) return false;
  if (!(player.pods > sector.tradeStations.length)) return false;
  if (player.tradeStationSupply <= 0) return false;
  return true;
}
export function buildTradeStationAt(game, shipId) {
  if (!canBuildTradeStationAt(game, shipId)) return false;
  const { player, ship } = findShip(game, shipId);
  const v = game.board.vertices[ship.vertexId];
  const sector = game.board.sectors[v.sectorId];
  sector.tradeStations.push({ owner: player.idx });
  v.shipHere = null;
  player.tradeStations.push({ sectorId: sector.id });
  player.tradeStationSupply--;
  player.ships = player.ships.filter((s) => s.id !== shipId);
  player.shipsAvailable++;
  const myCount = sector.tradeStations.filter((t) => t.owner === player.idx).length;
  if (sector.friendshipMarker == null) {
    sector.friendshipMarker = player.idx;
  } else if (sector.friendshipMarker !== player.idx) {
    const holderCount = sector.tradeStations.filter((t) => t.owner === sector.friendshipMarker).length;
    if (myCount > holderCount) sector.friendshipMarker = player.idx;
  }
  log(game, `${playerName(game, player.idx)} が交易所を建てた`);
  fire(game, 'build');
  offerFriendshipCard(game, player.idx, sector);
  checkWin(game, player.idx);
  return true;
}
// 3.9: 交易所を建てたら、その前哨基地の種族の残りカードから1枚選ぶ（人は画面、CPUは自動）。
// 選ぶ間は game.phase='friendship' で止まる。ponytail: 同時に2つ目の選びが重ならない前提（UIがcanAnytimeで二重建築を防ぐ）。
function offerFriendshipCard(game, idx, sector) {
  if (!sector.friendCardsLeft || !sector.friendCardsLeft.length || game.pendingFriendship) return;
  game.pendingFriendship = { player: idx, sectorId: sector.id, returnPhase: game.phase };
  game.phase = 'friendship';
}
export function pickFriendshipCard(game, cardId) {
  if (game.phase !== 'friendship' || !game.pendingFriendship) return false;
  const { player: idx, sectorId, returnPhase } = game.pendingFriendship;
  const sector = game.board.sectors[sectorId];
  if (!sector.friendCardsLeft.includes(cardId)) return false;
  sector.friendCardsLeft = sector.friendCardsLeft.filter((id) => id !== cardId);
  game.players[idx].friendCards.push(cardId);
  game.pendingFriendship = null;
  game.phase = returnPhase;
  log(game, `${playerName(game, idx)} が友好カード「${FRIEND_CARDS.find((c) => c.id === cardId).name}」を得た`);
  fire(game, 'friend');
  checkWin(game, idx);
  return true;
}

// ================================================================
// 母船・速さ・飛行（3.1・3.4・3.7・6章）
// ================================================================
export function canFly(game) {
  if (game.phase !== 'main') return false;
  return game.players[currentPlayer(game)].ships.length > 0;
}
// boosters/cannons は player オブジェクトを渡す（科学者の友好カードの+分も足す。3.9）
export function speedFromPicks(picks, player) {
  const black = picks.includes('k');
  const base = black ? BASE_SPEED_ON_BLACK : (BALL_VALUE[picks[0]] + BALL_VALUE[picks[1]]);
  return base + player.boosters + speedBonusFromCards(player);
}
export function combatFromPicks(picks, player) {
  const base = picks.includes('k') ? 0 : (BALL_VALUE[picks[0]] + BALL_VALUE[picks[1]]);
  return base + player.cannons + combatBonusFromCards(player);
}
// 速さの内訳（表示用。玉の分・ブースターの分・友好カードの分）
export function speedBreakdown(picks, player) {
  const black = picks.includes('k');
  const ball = black ? BASE_SPEED_ON_BLACK : (BALL_VALUE[picks[0]] + BALL_VALUE[picks[1]]);
  const cardBonus = speedBonusFromCards(player);
  return { ball, booster: player.boosters, cardBonus, black, total: ball + player.boosters + cardBonus };
}
export function shakeMothership(game, rng = Math.random) {
  if (game.phase !== 'main') return null;
  const idx = currentPlayer(game); const p = game.players[idx];
  if (p.ships.length === 0) return null;
  const picks = shuffle(BALLS, rng).slice(0, 2);
  const black = picks.includes('k');
  const speed = speedFromPicks(picks, p);
  game.ballsShown = picks; game.speed = speed;
  p.ships.forEach((s) => { s.movesLeft = speed; });
  fire(game, 'shake');
  log(game, `母船: ${picks.join(',')} → 速さ ${speed}${black ? '（黒。遭遇が起きる）' : ''}`);
  if (black) startEncounter(game, idx);
  else game.phase = 'flight';
  return { picks, speed, black };
}
function onShipArrive(game, idx, vertexId) {
  const v = game.board.vertices[vertexId];
  const player = game.players[idx];
  v.hexIds.forEach((hId) => {
    const hex = game.board.hexes[hId];
    if (!hex.disc || hex.disc.faceUp) return;
    hex.disc.faceUp = true;
    fire(game, 'reveal');
    log(game, '探検: ディスクがめくれた');
  });
  v.hexIds.forEach((hId) => {
    const hex = game.board.hexes[hId];
    if (!hex.disc || !hex.disc.token) return;
    const { kind, strength } = hex.disc.token;
    const have = kind === 'pirate' ? player.cannons + combatBonusFromCards(player) : player.pods; // 科学者の大砲も海賊の条件に入る（3.9）
    if (have < strength) return;
    player.tokens.push({ kind, strength });
    hex.disc.token = null;
    hex.disc.numbers = [game.reserveDiscs.length ? game.reserveDiscs.pop() : 6];
    fire(game, 'clear');
    log(game, `${playerName(game, idx)} が${kind === 'pirate' ? '海賊基地' : '氷の惑星'}を片付けた`);
    checkWin(game, idx);
  });
}
function canStopAt(game, idx, shipKind, vertexId) {
  const v = game.board.vertices[vertexId];
  if (v.kind === 'systemCenter') return false;
  if (v.building || v.shipHere) return false;
  if (v.kind === 'spaceportSite' && v.spaceportOwner != null && v.spaceportOwner !== idx) return false;
  if (shipKind === 'trade' && v.kind === 'colonySite') return false;
  if (shipKind === 'colony' && v.kind === 'outpostCenter') return false;
  return true;
}
// 速さ以内で止まれる交点（キー=交点id、値=使う歩数）。通り抜け自体は惑星系の真ん中以外どこでも可
export function shipReachableStops(game, shipId) {
  const found = findShip(game, shipId);
  if (!found) return new Map();
  const { player, ship } = found;
  const vs = game.board.vertices;
  const dist = new Map([[ship.vertexId, 0]]);
  const queue = [ship.vertexId];
  const stops = new Map();
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    if (d > 0 && canStopAt(game, player.idx, ship.kind, cur)) stops.set(cur, d);
    if (d >= ship.movesLeft) continue;
    vs[cur].neighbors.forEach((n) => {
      if (vs[n].kind === 'systemCenter' || dist.has(n)) return;
      dist.set(n, d + 1); queue.push(n);
    });
  }
  return stops;
}
export function moveShip(game, shipId, toVertexId) {
  if (game.phase !== 'flight') return false;
  const found = findShip(game, shipId);
  if (!found) return false;
  const { player, ship } = found;
  if (player.idx !== currentPlayer(game)) return false;
  const stops = shipReachableStops(game, shipId);
  if (!stops.has(toVertexId)) return false;
  // 経路を再構成（通った交点でも探検・海賊/氷の判定が起きる、3.4）
  const vs = game.board.vertices;
  const parent = new Map([[ship.vertexId, null]]);
  const queue = [ship.vertexId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toVertexId) break;
    vs[cur].neighbors.forEach((n) => {
      if (vs[n].kind === 'systemCenter' || parent.has(n)) return;
      parent.set(n, cur); queue.push(n);
    });
  }
  const path = [];
  let cur = toVertexId;
  while (cur != null) { path.unshift(cur); cur = parent.get(cur); }
  const steps = path.length - 1;

  vs[ship.vertexId].shipHere = null;
  path.slice(1).forEach((vid) => { onShipArrive(game, player.idx, vid); });
  ship.vertexId = toVertexId;
  ship.movesLeft -= steps;
  vs[toVertexId].shipHere = { owner: player.idx, shipId };
  fire(game, 'move');
  tryPlaceTradeShipMarkers(game, player.idx); // 出発した場所が空いた分、マーカーを置けるかもしれない
  return true;
}

// ================================================================
// 遭遇（3.8）。黒が出たら始まり、片付くまで game.phase は 'encounter'（摩耗だけ 'encounterWear'）のままで、
// その間 moveShip は phase チェックで弾かれる（動けない）。
// game.encounter = { cardId, idx(手番の人), rightIdx(右隣), pending } を main.js が見て画面を出す。
// pending.kind: 'yesno' | 'amount'（max） | 'pickShip'（purpose:'freeze'|'jump'） | 'jumpTarget'（shipId）
//             | 'pickResource'（count） | 'pickUpgrade'
// ================================================================
function drawEncounterCard(game) {
  if (!game.encounterDeck.length) {
    game.encounterDeck = shuffle(game.encounterDiscard, Math.random);
    game.encounterDiscard = [];
  }
  return game.encounterDeck.pop();
}
function gainFame(p, n) { p.fame += n; }
function loseFame(p, n) { p.fame = Math.max(0, p.fame - n); }
function loseRandomUpgrade(p, rng = Math.random) {
  const types = ['boosters', 'cannons', 'pods'].filter((k) => p[k] > 0);
  if (!types.length) return;
  p[types[Math.floor(rng() * types.length)]]--;
}
function takeResourcesToBank(game, p, n) {
  let left = n;
  RESOURCES.slice().sort((a, b) => p.resources[b] - p.resources[a]).forEach((r) => {
    while (left > 0 && p.resources[r] > 0) { p.resources[r]--; game.bank[r]++; left--; }
  });
}
function stealOneFromEachOpponent(game, idx, rng = Math.random) {
  game.players.forEach((op) => {
    if (op.idx === idx) return;
    const pool = RESOURCES.flatMap((r) => Array(op.resources[r]).fill(r));
    if (!pool.length) return;
    const picked = pool[Math.floor(rng() * pool.length)];
    op.resources[picked]--; game.players[idx].resources[picked]++;
  });
}
function grantFreeTradeShip(game, idx) {
  const p = game.players[idx];
  const site = freeSpaceportSitesFor(game, idx)[0];
  if (site != null && p.shipsAvailable > 0 && p.ships.length < MAX_SHIPS_DEPLOYED) {
    const shipId = `${idx}-${game.nextShipSeq++}`;
    p.ships.push({ id: shipId, kind: 'trade', vertexId: site, movesLeft: 0 });
    p.shipsAvailable--;
    game.board.vertices[site].shipHere = { owner: idx, shipId };
    fire(game, 'build');
  } else {
    p.tradeShipMarkers = (p.tradeShipMarkers || 0) + 1;
  }
}
function freezeShip(game, shipId) {
  const found = findShip(game, shipId);
  if (!found) return;
  found.ship.movesLeft = 0;
  game.frozenShipId = shipId;
  log(game, `${playerName(game, found.player.idx)} の船が動けなくなった`);
  fire(game, 'freeze');
}
function shipPickOrAuto(game, enc) {
  const p = game.players[enc.idx];
  if (p.ships.length <= 1) {
    if (p.ships[0]) freezeShip(game, p.ships[0].id);
    finishEncounter(game);
  } else {
    enc.pending = { kind: 'pickShip', purpose: 'freeze' };
  }
}
function jumpPickOrAuto(game, enc) {
  const p = game.players[enc.idx];
  if (p.ships.length <= 1) {
    const ship = p.ships[0];
    // 船が無い/跳べる先が無ければ答えようがないので、何も起きず終わる（止まり続けるのを防ぐ）
    if (ship && spaceJumpTargets(game, ship.id).length) enc.pending = { kind: 'jumpTarget', shipId: ship.id };
    else finishEncounter(game);
  } else {
    enc.pending = { kind: 'pickShip', purpose: 'jump' };
  }
}
function doFight(game, enc, rng = Math.random) {
  const a = game.players[enc.idx], b = game.players[enc.rightIdx];
  const pa = shuffle(BALLS, rng).slice(0, 2), pb = shuffle(BALLS, rng).slice(0, 2);
  const ca = combatFromPicks(pa, a), cb = combatFromPicks(pb, b);
  game.encounterBalls = { a: pa, b: pb, aIdx: enc.idx, bIdx: enc.rightIdx };
  const win = ca >= cb; // 公式どおり同点は仕掛けた本人の勝ち
  log(game, `戦い: ${playerName(game, enc.idx)}(${ca}) 対 ${playerName(game, enc.rightIdx)}(${cb}) → ${win ? '勝ち' : '負け'}`);
  fire(game, win ? 'encWin' : 'encLose');
  return { win };
}
function doSpeedCompare(game, enc, rng = Math.random) {
  const a = game.players[enc.idx], b = game.players[enc.rightIdx];
  const pa = shuffle(BALLS, rng).slice(0, 2), pb = shuffle(BALLS, rng).slice(0, 2);
  const sa = speedFromPicks(pa, a), sb = speedFromPicks(pb, b);
  game.encounterBalls = { a: pa, b: pb, aIdx: enc.idx, bIdx: enc.rightIdx };
  const win = sa >= sb; // 相手が大きければ負け（同じなら負けない）
  log(game, `速さ比べ: ${playerName(game, enc.idx)}(${sa}) 対 ${playerName(game, enc.rightIdx)}(${sb}) → ${win ? '勝ち' : '負け'}`);
  fire(game, win ? 'encWin' : 'encLose');
  return { win };
}
function finishEncounter(game) {
  // 道中（onShipArriveの海賊/氷の片付けなど）で既に勝っていたら、ここで phase を 'flight' に
  // 戻してゲーム終了を上書きしない（戻すと checkWin の winner!=null ガードで再判定されず、
  // 勝ったはずの試合が止まらず続く原因になっていた）
  if (game.winner != null) return;
  const idx = game.encounter ? game.encounter.idx : game.turn;
  game.encounter = null;
  game.phase = 'flight';
  checkWin(game, idx); // 名声やアップグレードが結果に絡む（3.10: 手番の人の操作のあと）
}
export function startEncounter(game, idx, cardIdOverride) {
  const cardId = cardIdOverride || drawEncounterCard(game);
  if (!cardIdOverride) game.encounterDiscard.push(cardId);
  const def = ENCOUNTERS.find((e) => e.id === cardId);
  const rightIdx = (idx - 1 + game.playerCount) % game.playerCount; // 3.8: 右隣に統一
  game.phase = 'encounter';
  game.encounter = { cardId, idx, rightIdx, pending: null };
  log(game, `遭遇: ${def.name}`);
  fire(game, 'encounter');
  if (cardId === 'E9') { applyWearToAll(game); return; }
  game.encounter.pending = def.kind === 'amount' ? { kind: 'amount', max: def.max } : { kind: 'yesno' };
}
function loseUpgrade(p, kind) { p[kind === 'booster' ? 'boosters' : kind === 'cannon' ? 'cannons' : 'pods']--; }
function applyWearToAll(game) {
  game.pendingWear = [];
  game.players.forEach((p) => {
    const counts = { booster: p.boosters, cannon: p.cannons, pod: p.pods };
    const maxN = Math.max(...Object.values(counts));
    if (maxN === 0) return;
    const tied = Object.entries(counts).filter(([, n]) => n === maxN).map(([k]) => k);
    if (tied.length === 1) loseUpgrade(p, tied[0]);
    else game.pendingWear.push({ player: p.idx, options: tied });
  });
  log(game, '摩耗: アップグレードが1つずつ減った');
  if (game.pendingWear.length) game.phase = 'encounterWear';
  else finishWearDiscards(game);
}
function finishWearDiscards(game) {
  game.pendingWearDiscards = game.players.filter((p) => sumRes(p.resources) >= 8).map((p) => ({ player: p.idx }));
  if (game.pendingWearDiscards.length) game.phase = 'encounterWear';
  else finishEncounter(game);
}
export function resolveWearChoice(game, playerIdx, kind) {
  if (game.phase !== 'encounterWear') return false;
  const entry = game.pendingWear.find((w) => w.player === playerIdx);
  if (!entry || !entry.options.includes(kind)) return false;
  loseUpgrade(game.players[playerIdx], kind);
  game.pendingWear = game.pendingWear.filter((w) => w.player !== playerIdx);
  if (!game.pendingWear.length) finishWearDiscards(game);
  return true;
}
export function resolveWearDiscard(game, playerIdx, res) {
  if (game.phase !== 'encounterWear') return false;
  const entry = game.pendingWearDiscards.find((d) => d.player === playerIdx);
  if (!entry || !(game.players[playerIdx].resources[res] > 0)) return false;
  game.players[playerIdx].resources[res]--; game.bank[res]++;
  game.pendingWearDiscards = game.pendingWearDiscards.filter((d) => d.player !== playerIdx);
  if (!game.pendingWearDiscards.length) finishEncounter(game);
  return true;
}
export function spaceJumpTargets(game, shipId) {
  const found = findShip(game, shipId);
  if (!found) return [];
  const { player, ship } = found;
  return game.board.vertices.filter((v) => canStopAt(game, player.idx, ship.kind, v.id)).map((v) => v.id);
}
function answerYesNo(game, enc, yes, rng) {
  const p = game.players[enc.idx];
  switch (enc.cardId) {
    case 'E2':
      if (yes) { takeResourcesToBank(game, p, 2); finishEncounter(game); }
      else {
        const r = doFight(game, enc, rng);
        if (r.win) { gainFame(p, 1); finishEncounter(game); }
        else { loseRandomUpgrade(p, rng); shipPickOrAuto(game, enc); }
      }
      return true;
    case 'E3':
      if (yes) {
        const r = doFight(game, enc, rng);
        if (r.win) { stealOneFromEachOpponent(game, enc.idx, rng); gainFame(p, 1); finishEncounter(game); }
        else { loseFame(p, 1); loseRandomUpgrade(p, rng); finishEncounter(game); }
      } else {
        const r = doSpeedCompare(game, enc, rng);
        if (r.win) finishEncounter(game);
        else shipPickOrAuto(game, enc);
      }
      return true;
    case 'E5':
      if (yes) {
        const r = doSpeedCompare(game, enc, rng);
        if (r.win) jumpPickOrAuto(game, enc);
        else shipPickOrAuto(game, enc);
      } else finishEncounter(game);
      return true;
    case 'E6':
      if (yes) {
        if (sumRes(p.resources) > 0) { takeResourcesToBank(game, p, 1); gainFame(p, 2); }
        else gainFame(p, 1);
      } else loseFame(p, 1);
      finishEncounter(game);
      return true;
    case 'E7':
      if (yes) {
        const picks = shuffle(BALLS, rng).slice(0, 2);
        game.encounterBalls = { a: picks, b: null, aIdx: enc.idx, bIdx: null };
        const combat = combatFromPicks(picks, p);
        if (combat >= 4) enc.pending = { kind: 'pickUpgrade' };
        else shipPickOrAuto(game, enc);
      } else finishEncounter(game);
      return true;
    case 'E8':
      if (yes) grantFreeTradeShip(game, enc.idx); else gainFame(p, 1);
      finishEncounter(game);
      return true;
    default: return false;
  }
}
function answerAmount(game, enc, amount, rng) {
  const p = game.players[enc.idx];
  const def = ENCOUNTERS.find((e) => e.id === enc.cardId);
  if (!(amount >= 0 && amount <= def.max)) return false;
  if (enc.cardId === 'E1') {
    if (amount === 0) { shipPickOrAuto(game, enc); return true; }
    takeResourcesToBank(game, p, amount);
    if (amount === 2) gainFame(p, 1);
    enc.pending = { kind: 'pickResource', count: amount === 1 ? 1 : amount === 2 ? 3 : 2 };
    return true;
  }
  if (enc.cardId === 'E4') {
    if (amount > 0) takeResourcesToBank(game, p, amount);
    if (amount === 0) { finishEncounter(game); return true; }
    if (amount === 2) gainFame(p, 1);
    jumpPickOrAuto(game, enc);
    return true;
  }
  return false;
}
function answerPickShip(game, enc, shipId) {
  if (!game.players[enc.idx].ships.some((s) => s.id === shipId)) return false;
  if (enc.pending.purpose === 'freeze') { freezeShip(game, shipId); finishEncounter(game); }
  // 選んだ船に跳べる先が無ければ答えようがないので、何も起きず終わる（止まり続けるのを防ぐ）
  else if (spaceJumpTargets(game, shipId).length) { enc.pending = { kind: 'jumpTarget', shipId }; }
  else finishEncounter(game);
  return true;
}
function answerJumpTarget(game, enc, toVertexId) {
  const shipId = enc.pending.shipId;
  const found = findShip(game, shipId);
  if (!found) { finishEncounter(game); return true; }
  const { player, ship } = found;
  if (!canStopAt(game, player.idx, ship.kind, toVertexId)) return false;
  game.board.vertices[ship.vertexId].shipHere = null;
  ship.vertexId = toVertexId;
  onShipArrive(game, player.idx, toVertexId);
  game.board.vertices[toVertexId].shipHere = { owner: player.idx, shipId };
  fire(game, 'jump');
  finishEncounter(game);
  return true;
}
function answerPickResource(game, enc, res) {
  if (!RESOURCES.includes(res)) return false;
  const p = game.players[enc.idx];
  const count = enc.pending.count;
  const n = Math.min(count, game.bank[res]);
  p.resources[res] += n; game.bank[res] -= n;
  finishEncounter(game);
  return true;
}
function answerPickUpgrade(game, enc, kind) {
  const p = game.players[enc.idx];
  const caps = { booster: MAX_BOOSTERS, cannon: MAX_CANNONS, pod: MAX_PODS };
  const key = kind === 'booster' ? 'boosters' : kind === 'cannon' ? 'cannons' : kind === 'pod' ? 'pods' : null;
  if (!key) return false;
  if (p[key] < caps[kind]) p[key]++;
  fire(game, 'build');
  finishEncounter(game);
  return true;
}
export function encounterAnswer(game, payload, rng = Math.random) {
  if (game.phase !== 'encounter' || !game.encounter || !game.encounter.pending) return false;
  const enc = game.encounter;
  switch (enc.pending.kind) {
    case 'yesno': return answerYesNo(game, enc, !!payload.yes, rng);
    case 'amount': return answerAmount(game, enc, Number(payload.amount), rng);
    case 'pickShip': return answerPickShip(game, enc, payload.shipId);
    case 'jumpTarget': return answerJumpTarget(game, enc, payload.toVertexId);
    case 'pickResource': return answerPickResource(game, enc, payload.res);
    case 'pickUpgrade': return answerPickUpgrade(game, enc, payload.kind);
    default: return false;
  }
}

export function endTurn(game) {
  if (game.phase !== 'main' && game.phase !== 'flight') return false;
  game.ballsShown = null; game.speed = 0;
  game.encounterBalls = null; game.frozenShipId = null;
  game.turn = (game.turn + 1) % game.playerCount;
  game.turnNumber++;
  game.phase = 'roll';
  game.players[game.turn].oncePerTurn = { fameForSale: false, helpingHand: false, exchange11goods: false }; // 3.9: 手番1回系をリセット
  return true;
}
