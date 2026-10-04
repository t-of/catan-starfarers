'use strict';
// 盤の絵（SVG 要素を直に作る小さな関数の集まり）。凝らず、見分けがつく最小限にする（仕様4章）。
// engine.js が作る board（hexes/vertices/edges/sectors）を読み、main.js が呼ぶ。

// 資源ごとの色（惑星のグラデーションの中間色。Parts.dc.html のトークンに合わせる）
export const RES_COLOR = { ore: '#9ea9bc', fuel: '#ff7a33', carbon: '#4f5d55', food: '#4fcf7c', goods: '#a77cff' };
// 惑星の放射グラデーション（内側→中間→外側）。resource ごとに <radialGradient> を作って塗る
const RES_GRADIENT_STOPS = {
  ore: ['#eef2f8', '#9ea9bc', '#363f52'],
  fuel: ['#ffd7a8', '#ff7a33', '#7a2408'],
  carbon: ['#a7b6ab', '#4f5d55', '#161d19'],
  food: ['#d0ffdc', '#4fcf7c', '#11502c'],
  goods: ['#f1e6ff', '#a77cff', '#3a2178'],
};
// 表面の模様の色（帯・クレーター・雲。資源ごとに少し違う見た目にする）
const RES_SURFACE = { ore: '#5a6478', fuel: '#ffb066', carbon: '#232a26', food: '#eafff0', goods: '#e3d2ff' };
export const PLAYER_COLORS = ['#ff6b6b', '#5ecbff', '#ffd35c', '#8cf59a'];
const RACE_SHORT = { greenFolk: '緑', diplomat: '外交', merchant: '商人', scientist: '科学' }; // 3.9: 前哨基地の種族を短く示す

const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const svgNS = 'http://www.w3.org/2000/svg';
export function el(tag, attrs, parent) {
  const n = document.createElementNS(svgNS, tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (parent) parent.appendChild(n);
  return n;
}

// セクター（惑星系）の3ヘクス分の多角形を1枚のパスにまとめた d 文字列
function hexPolyPoints(board, hex) {
  return hex.vertexIds.map((vid) => { const v = board.vertices[vid]; return `${v.x},${v.y}`; }).join(' ');
}

// 盤の外枠には何もない宇宙の余白ヘクス（engine.js の MARGIN）がたっぷりあるので、
// それを含めて viewBox を取ると盤が小さく描かれてしまう。実際にセクター（惑星系・前哨基地・植民地）が
// あるヘクスの頂点だけで範囲を取り、盤がいっぱいに大きく見えるようにする
function usedVertices(board) {
  const vids = new Set();
  board.hexes.forEach((hex) => { if (hex.sectorId != null) hex.vertexIds.forEach((vid) => vids.add(vid)); });
  return [...vids].map((vid) => board.vertices[vid]);
}

// 盤の 1 単位（六角形の半径）の最小の大きさ（px）。これより小さくなる画面では、盤を横にスクロールして見る
const MIN_PX_PER_UNIT = 30;

export function viewBoxOf(board) {
  const used = usedVertices(board);
  const xs = used.map((v) => v.x), ys = used.map((v) => v.y);
  const pad = 0.5;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  return [minX, minY, Math.max(...xs) - minX + pad * 2, Math.max(...ys) - minY + pad * 2];
}

// ---- 奥の宇宙背景（.stage-bg に 1 回だけ描く。盤を描き直すたびに作り直すとチラつくので main.js の起動時に 1 度だけ呼ぶ）----
// 決まった種の疑似乱数（同じ見た目を再現し、呼ぶたびに変わらないようにする）
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function renderSpaceBackground(container) {
  if (!container || container.dataset.built) return; // 1 回だけ
  container.dataset.built = '1';
  const svg = el('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', width: '100%', height: '100%' }, container);
  const rnd = mulberry32(20261004);
  // 星雲（大きくぼかした楕円。色違いを2〜3枚重ねる）
  const defs = el('defs', {}, svg);
  const neb = el('filter', { id: 'nebulaBlur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: 9 }, neb);
  const nebG = el('g', { filter: 'url(#nebulaBlur)', opacity: 0.35 }, svg);
  [['#3a2a7a', 20, 25, 34, 20], ['#1f4a6b', 78, 62, 30, 22], ['#5a1f4a', 55, 85, 26, 16]].forEach(([c, cx, cy, rx, ry]) => {
    el('ellipse', { cx, cy, rx, ry, fill: c }, nebG);
  });
  // 星: 奥(小・暗)→中→手前(大・明るい) の3層
  const layers = [
    { n: 70, r: [0.15, 0.3], op: [0.25, 0.5] },
    { n: 40, r: [0.3, 0.55], op: [0.4, 0.7] },
    { n: 18, r: [0.55, 0.9], op: [0.6, 1] },
  ];
  const twinkleCandidates = [];
  layers.forEach((layer, li) => {
    for (let i = 0; i < layer.n; i++) {
      const cx = rnd() * 100, cy = rnd() * 100;
      const r = layer.r[0] + rnd() * (layer.r[1] - layer.r[0]);
      const op = layer.op[0] + rnd() * (layer.op[1] - layer.op[0]);
      const star = el('circle', { cx, cy, r, fill: '#fff', opacity: op }, svg);
      if (li === 2 && rnd() < 0.35) twinkleCandidates.push(star);
    }
  });
  // ゆっくりまたたく星（手前の層のごく一部だけ）
  if (!reduceMotion()) {
    twinkleCandidates.forEach((star) => {
      const dur = 2.5 + rnd() * 3.5, begin = rnd() * 4;
      const baseOp = star.getAttribute('opacity');
      el('animate', { attributeName: 'opacity', values: `${baseOp};${(baseOp * 0.25).toFixed(2)};${baseOp}`, dur: `${dur.toFixed(1)}s`, begin: `${begin.toFixed(1)}s`, repeatCount: 'indefinite' }, star);
    });
  }
}

// 1 枚のヘクスに付く固有 id（惑星の模様・クリップを他のヘクスと混ざらないようにする）
const hexDefId = (hex, name) => `${name}-${hex.id}`;

// 資源ごとの表面パターンを defs に作る（解像度は低めの単純な形にして、惑星が増えても軽いままにする）
function buildSurfacePatterns(defs) {
  const mk = (res, build) => {
    const p = el('pattern', { id: `surf-${res}`, patternUnits: 'objectBoundingBox', width: 1, height: 1, patternContentUnits: 'objectBoundingBox' }, defs);
    build(p);
    return p;
  };
  const stripes = (p, color, rows, h, angle) => {
    for (let i = 0; i < rows; i++) el('rect', { x: 0, y: i / rows, width: 1, height: h, fill: color, opacity: 0.22, transform: `rotate(${angle} 0.5 0.5)` }, p);
  };
  mk('ore', (p) => { // クレーター
    [[0.3, 0.3, 0.1], [0.65, 0.5, 0.07], [0.45, 0.72, 0.09], [0.78, 0.22, 0.06]].forEach(([cx, cy, r]) => {
      el('circle', { cx, cy, r, fill: RES_SURFACE.ore, opacity: 0.35 }, p);
      el('circle', { cx: cx - r * 0.25, cy: cy - r * 0.25, r: r * 0.7, fill: '#fff', opacity: 0.12 }, p);
    });
  });
  mk('fuel', (p) => stripes(p, RES_SURFACE.fuel, 6, 0.09, -14)); // ガス惑星の斜めの帯
  mk('carbon', (p) => stripes(p, RES_SURFACE.carbon, 7, 0.08, 4)); // 暗い横縞
  mk('food', (p) => { // 雲
    [[0.25, 0.3], [0.6, 0.22], [0.4, 0.6], [0.75, 0.68], [0.2, 0.78]].forEach(([cx, cy]) => {
      el('ellipse', { cx, cy, rx: 0.16, ry: 0.06, fill: RES_SURFACE.food, opacity: 0.4, transform: `rotate(${-10 + cx * 20} ${cx} ${cy})` }, p);
    });
  });
  mk('goods', (p) => stripes(p, RES_SURFACE.goods, 5, 0.1, -22)); // 渦模様
  // ゆっくり自転（模様が横に流れる）。reduced-motion では付けない
  if (!reduceMotion()) {
    ['ore', 'fuel', 'carbon', 'food', 'goods'].forEach((res) => {
      const p = defs.querySelector(`#surf-${res}`);
      el('animateTransform', { attributeName: 'patternTransform', type: 'translate', from: '0 0', to: '1 0', dur: `${38 + RES_COLOR[res].length}s`, repeatCount: 'indefinite' }, p);
    });
  }
}

// 盤全体を描く。onVertexTap(vertexId) はどの交点をタップしても呼ばれる。
// highlight: Set<vertexId>（光らせて押せることを示す）。shipKindOf(owner, shipId) は 'colony' / 'trade' を返す。
export function renderBoard(svg, board, { highlight = new Set(), selectedShipVertex = null, onVertexTap, shipKindOf = () => 'colony' } = {}) {
  svg.innerHTML = '';
  const [x, y, w, h] = viewBoxOf(board);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.style.minWidth = `${w * MIN_PX_PER_UNIT}px`;
  svg.style.minHeight = `${h * MIN_PX_PER_UNIT}px`;

  // 盤の地（星はうしろの .stage-bg が担当。ここは縁をうっすら暗くして奥行きを出す程度）
  el('rect', { x, y, width: w, height: h, fill: 'rgba(7,10,24,0.45)' }, svg);

  const defs = el('defs', {}, svg);
  // 惑星の放射グラデーション（内側→中間→外側。資源ごと）
  Object.entries(RES_GRADIENT_STOPS).forEach(([res, [c0, c1, c2]]) => {
    const g = el('radialGradient', { id: `planet-${res}`, cx: '35%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0', 'stop-color': c0 }, g);
    el('stop', { offset: '0.45', 'stop-color': c1 }, g);
    el('stop', { offset: '1', 'stop-color': c2 }, g);
  });
  // 昼と夜の陰影（光源は左上。全惑星で向きをそろえる、1枚を使い回す）
  const shade = el('radialGradient', { id: 'planet-shade', cx: '72%', cy: '76%', r: '78%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': 0 }, shade);
  el('stop', { offset: '0.55', 'stop-color': '#000', 'stop-opacity': 0 }, shade);
  el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': 0.72 }, shade);
  // 縁の大気の光（ぼかし。使い回す1つの filter）
  const atmBlur = el('filter', { id: 'atmBlur', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: 0.05 }, atmBlur);
  // ヘクスのふちの光（ガラスのような面。使い回す1つの filter）
  const hexGlow = el('filter', { id: 'hexGlow', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
  el('feGaussianBlur', { stdDeviation: 0.05 }, hexGlow);
  // 推進のほのかな光（船の後方。使い回す1つの filter）
  const shipGlow = el('filter', { id: 'shipGlow', x: '-80%', y: '-80%', width: '260%', height: '260%' }, defs);
  el('feGaussianBlur', { stdDeviation: 0.05 }, shipGlow);
  buildSurfacePatterns(defs);

  // 空のレーン（全交点をつなぐ辺）をうっすら
  const laneG = el('g', { stroke: 'rgba(142,160,255,0.09)', 'stroke-width': 0.03 }, svg);
  board.edges.forEach((e) => {
    const a = board.vertices[e.v1], b = board.vertices[e.v2];
    if (a.kind === 'systemCenter' || b.kind === 'systemCenter') return;
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, laneG);
  });

  // セクターのヘクス: ガラスのような半透明の面＋ふちの光（前哨基地は紫、母星の植民地は少し明るい紺）。資源のあるヘクスは中央に球体の惑星
  board.hexes.forEach((hex) => {
    if (hex.sectorId == null) return;
    const sector = board.sectors[hex.sectorId];
    const [fill, stroke] = sector.kind === 'outpost' ? ['rgba(60,42,112,0.42)', '#9f7eea'] : sector.tier === 'colony' ? ['rgba(40,56,122,0.34)', '#5567c2'] : ['rgba(28,38,80,0.3)', '#3a4a85'];
    const pts = hexPolyPoints(board, hex);
    el('polygon', { points: pts, fill: 'none', stroke, 'stroke-width': 0.05, opacity: 0.55, filter: 'url(#hexGlow)' }, svg);
    el('polygon', { points: pts, fill, stroke, 'stroke-width': 0.022 }, svg);
    if (!hex.resource) return;
    const cx = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].x, 0) / 6;
    const cy = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].y, 0) / 6;
    const r = 0.58;
    const clipId = hexDefId(hex, 'planetClip');
    el('clipPath', { id: clipId }, defs).appendChild(el('circle', { cx, cy, r }));
    // 交易品（goods）は輪を球の後ろ半分に先に描く
    if (hex.resource === 'goods') {
      const halfId = hexDefId(hex, 'ringBack');
      el('clipPath', { id: halfId }, defs).appendChild(el('rect', { x: cx - r * 1.6, y: cy - r * 1.6, width: r * 3.2, height: r * 1.6 }));
      el('ellipse', { cx, cy, rx: r * 1.43, ry: r * 0.36, fill: 'none', stroke: '#e3d2ff', 'stroke-width': 0.055, opacity: 0.75, 'clip-path': `url(#${halfId})` }, svg);
    }
    const planetG = el('g', {}, svg);
    el('circle', { cx, cy, r, fill: `url(#planet-${hex.resource})` }, planetG);
    el('circle', { cx, cy, r, fill: `url(#surf-${hex.resource})`, 'clip-path': `url(#${clipId})` }, planetG);
    el('circle', { cx, cy, r, fill: 'url(#planet-shade)' }, planetG);
    // 縁の大気（資源の色でうっすら光る輪）
    el('circle', { cx, cy, r: r + 0.03, fill: 'none', stroke: RES_COLOR[hex.resource], 'stroke-width': 0.05, opacity: 0.55, filter: 'url(#atmBlur)' }, svg);
    if (hex.resource === 'goods') {
      const frontId = hexDefId(hex, 'ringFront');
      el('clipPath', { id: frontId }, defs).appendChild(el('rect', { x: cx - r * 1.6, y: cy, width: r * 3.2, height: r * 1.6 }));
      el('ellipse', { cx, cy, rx: r * 1.43, ry: r * 0.36, fill: 'none', stroke: '#e3d2ff', 'stroke-width': 0.055, opacity: 0.95, 'clip-path': `url(#${frontId})` }, svg);
    }
    if (hex.disc) {
      // 数字ディスク: 伏せは暗い円に「？」、めくれたら生成りの円に数字（6・8だけ赤）。海賊・氷の印は暗い円に赤/水色
      let label = '？', discFill = '#2a3158', textFill = '#9aa6d6';
      if (hex.disc.token) {
        const isPirate = hex.disc.token.kind === 'pirate';
        label = isPirate ? `☠${hex.disc.token.strength}` : `❄${hex.disc.token.strength}`;
        discFill = isPirate ? '#1a0d12' : '#0e1f2b';
        textFill = isPirate ? '#ff5a6e' : '#8fe3ff';
      } else if (hex.disc.faceUp) {
        const n = hex.disc.numbers[0];
        label = String(n);
        discFill = '#f4ecd8';
        textFill = (n === 6 || n === 8) ? '#c8322f' : '#1b1f33';
      }
      // 札は惑星の右下（デザイン案の位置）
      const dx = cx + 0.375, dy = cy + 0.375;
      el('circle', { cx: dx, cy: dy, r: 0.31, fill: discFill, stroke: '#0a0d1c', 'stroke-width': 0.05 }, svg);
      const t = el('text', { x: dx, y: dy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': hex.disc.token ? 0.26 : 0.38, 'font-weight': 700, fill: textFill }, svg);
      t.textContent = label;
    }
  });

  // 前哨基地・宇宙港の中心、植民地の場所、ドッキングポイントの印
  board.sectors.forEach((sector) => {
    if (sector.centerVertexId == null) return;
    const v = board.vertices[sector.centerVertexId];
    if (sector.kind === 'outpost') {
      // 基地らしい小さな八角のベース
      const n = 8, r0 = 0.17;
      const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + Math.PI / 8; return `${v.x + Math.cos(a) * r0},${v.y + Math.sin(a) * r0}`; }).join(' ');
      el('polygon', { points: pts, fill: '#241a3e', stroke: '#9f7eea', 'stroke-width': 0.03 }, svg);
      el('circle', { cx: v.x, cy: v.y, r: 0.22, fill: 'none', stroke: '#b79cff', 'stroke-width': 0.05, 'stroke-dasharray': '0.04 0.06' }, svg);
      if (sector.race) {
        const rt = el('text', { x: v.x, y: v.y + 0.08, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.2, fill: '#b79cff' }, svg);
        rt.textContent = RACE_SHORT[sector.race] || '';
      }
      sector.tradeStations.forEach((ts, i) => {
        const ang = (i / 5) * Math.PI * 2;
        el('rect', { x: v.x + Math.cos(ang) * 0.42 - 0.07, y: v.y + Math.sin(ang) * 0.42 - 0.07, width: 0.14, height: 0.14, rx: 0.03, fill: PLAYER_COLORS[ts.owner], stroke: '#0a0d1c', 'stroke-width': 0.015 }, svg);
      });
      if (sector.friendshipMarker != null) {
        const t = el('text', { x: v.x, y: v.y - 0.5, 'text-anchor': 'middle', 'font-size': 0.3, fill: PLAYER_COLORS[sector.friendshipMarker] }, svg);
        t.textContent = '🚩';
      }
    }
  });
  board.vertices.forEach((v) => {
    if (v.kind === 'colonySite') {
      if (v.blocked) { el('circle', { cx: v.x, cy: v.y, r: 0.08, fill: '#444' }, svg); return; }
      if (v.building) {
        const col = PLAYER_COLORS[v.building.owner];
        if (v.building.type === 'colony') {
          // 小さな建物: 台座＋ドーム
          el('rect', { x: v.x - 0.15, y: v.y - 0.02, width: 0.3, height: 0.14, rx: 0.02, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.02 }, svg);
          el('path', { d: `M ${v.x - 0.13} ${v.y - 0.02} A 0.13 0.15 0 0 1 ${v.x + 0.13} ${v.y - 0.02} Z`, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.02 }, svg);
          el('circle', { cx: v.x, cy: v.y - 0.1, r: 0.025, fill: '#fff', opacity: 0.8 }, svg);
        } else {
          // 宇宙港: 中心のモジュール＋十字のアンテナ
          el('rect', { x: v.x - 0.15, y: v.y - 0.15, width: 0.3, height: 0.3, rx: 0.06, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.025 }, svg);
          el('line', { x1: v.x - 0.22, y1: v.y, x2: v.x + 0.22, y2: v.y, stroke: col, 'stroke-width': 0.03 }, svg);
          el('line', { x1: v.x, y1: v.y - 0.22, x2: v.x, y2: v.y + 0.22, stroke: col, 'stroke-width': 0.03 }, svg);
          el('circle', { cx: v.x, cy: v.y, r: 0.05, fill: '#fff', opacity: 0.8 }, svg);
        }
      } else {
        el('circle', { cx: v.x, cy: v.y, r: 0.08, fill: 'none', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 0.025 }, svg);
      }
    } else if (v.kind === 'spaceportSite' && v.spaceportOwner != null && !v.building) {
      el('circle', { cx: v.x, cy: v.y, r: 0.1, fill: 'none', stroke: PLAYER_COLORS[v.spaceportOwner], 'stroke-width': 0.03, 'stroke-dasharray': '0.05,0.05' }, svg);
    }
  });

  // 船: 上から見た小さな宇宙船（機首＋船体＋エンジンの光）
  board.vertices.forEach((v) => {
    if (!v.shipHere) return;
    const col = PLAYER_COLORS[v.shipHere.owner];
    const selected = v.id === selectedShipVertex;
    if (selected) el('circle', { cx: v.x, cy: v.y, r: 0.3, fill: 'none', stroke: '#fff', 'stroke-width': 0.04, opacity: 0.8 }, svg);
    const trade = shipKindOf(v.shipHere.owner, v.shipHere.shipId) === 'trade';
    const g = el('g', {}, svg);
    // エンジンの光（船尾側にうっすら）
    el('circle', { cx: v.x, cy: v.y + 0.2, r: 0.1, fill: col, opacity: 0.6, filter: 'url(#shipGlow)' }, g);
    if (trade) {
      // 交易船: ひし形の貨物船体＋中央の箱
      el('polygon', { points: `${v.x},${v.y - 0.22} ${v.x + 0.22},${v.y} ${v.x},${v.y + 0.22} ${v.x - 0.22},${v.y}`, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.03 }, g);
      el('rect', { x: v.x - 0.07, y: v.y - 0.07, width: 0.14, height: 0.14, fill: '#0a0d1c' }, g);
    } else {
      // 植民船: 流線形の船体＋船窓
      el('path', { d: `M ${v.x} ${v.y - 0.22} L ${v.x + 0.15} ${v.y + 0.04} L ${v.x + 0.15} ${v.y + 0.16} L ${v.x - 0.15} ${v.y + 0.16} L ${v.x - 0.15} ${v.y + 0.04} Z`, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.03 }, g);
      el('circle', { cx: v.x, cy: v.y - 0.02, r: 0.055, fill: '#0a0d1c' }, g);
    }
  });

  // 行ける場所・タップできる場所を光らせる
  highlight.forEach((vid) => {
    const v = board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 0.24, fill: 'rgba(255,207,90,0.4)', stroke: '#ffcf5a', 'stroke-width': 0.05, class: 'tap-glow' }, svg);
  });

  // タップ判定（見た目に関係なく交点ぜんぶに大きめの透明な丸を重ねる）
  board.vertices.forEach((v) => {
    el('circle', { cx: v.x, cy: v.y, r: 0.28, fill: 'transparent', 'data-vid': v.id, class: 'vertex-hit' }, svg);
  });
  if (onVertexTap) {
    svg.onclick = (e) => {
      const t = e.target.closest('[data-vid]');
      if (t) onVertexTap(Number(t.dataset.vid));
    };
  }
}

// 母船の玉（y/r/b/k）の色と名前
export const BALL_STYLE = { y: ['#ffd35c', '黄'], r: ['#ff6b6b', '赤'], b: ['#5ecbff', '青'], k: ['#1a1c22', '黒'] };
export function renderBalls(container, picks) {
  container.innerHTML = '';
  (picks || []).forEach((p) => {
    const [color, name] = BALL_STYLE[p];
    const b = document.createElement('span');
    b.className = 'ball';
    b.style.background = color;
    b.title = name;
    container.appendChild(b);
  });
}

// 母船の小さなアイコン（デザイン案 Encounter.dc.html の円盤を簡略化。banner の玉の結果に添える）
export const MOTHERSHIP_ICON_SVG = `<svg width="56" height="34" viewBox="0 0 140 86" aria-hidden="true">
  <ellipse cx="70" cy="40" rx="62" ry="16" fill="#2a3158" stroke="#8ea0ff" stroke-opacity="0.5"/>
  <path d="M30 36 C34 16 106 16 110 36 Z" fill="#3a4580" stroke="#8ea0ff" stroke-opacity="0.5"/>
  <ellipse cx="70" cy="30" rx="16" ry="6" fill="#8fe3ff" opacity="0.35"/>
  <circle cx="18" cy="42" r="2.5" fill="#ffcf5a"/><circle cx="44" cy="50" r="2.5" fill="#ffcf5a"/><circle cx="96" cy="50" r="2.5" fill="#ffcf5a"/><circle cx="122" cy="42" r="2.5" fill="#ffcf5a"/>
</svg>`;

// 遭遇カードのイラスト枠（共通の1枚。暗い宇宙に望遠鏡のシルエット。遭遇ごとには作らない）
export const ENCOUNTER_ART_SVG = `<svg width="358" height="150" viewBox="0 0 358 150" aria-hidden="true" style="width:100%;height:100%">
  <g fill="#ffffff"><circle cx="30" cy="24" r="1.2" opacity="0.7"/><circle cx="120" cy="16" r="0.9" opacity="0.5"/><circle cx="300" cy="36" r="1.3" opacity="0.6"/><circle cx="250" cy="122" r="1" opacity="0.5"/><circle cx="60" cy="114" r="0.8" opacity="0.6"/><circle cx="330" cy="96" r="0.9" opacity="0.5"/></g>
  <circle cx="179" cy="75" r="42" fill="none" stroke="#ffcf5a" stroke-opacity="0.15" stroke-width="10"/>
  <circle cx="179" cy="75" r="25" fill="none" stroke="#ffcf5a" stroke-opacity="0.25" stroke-width="4"/>
  <g transform="translate(179 75) rotate(-20)">
    <rect x="-24" y="-11" width="48" height="22" rx="11" fill="#c9d1f5" stroke="#0a0d1c" stroke-width="2"/>
    <rect x="-7" y="-11" width="6" height="22" fill="#8f9bc8"/>
    <circle cx="11" cy="0" r="4.5" fill="#0d1230" stroke="#0a0d1c" stroke-width="1.5"/>
    <path d="M-24 0 L-37 0 M-37 -7 L-37 7" stroke="#c9d1f5" stroke-width="2.5" stroke-linecap="round"/>
    <circle cy="-15" r="3" fill="#ff5a6e"/>
  </g>
</svg>`;
