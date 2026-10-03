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
export const PLAYER_COLORS = ['#ff6b6b', '#5ecbff', '#ffd35c', '#8cf59a'];
const RACE_SHORT = { greenFolk: '緑', diplomat: '外交', merchant: '商人', scientist: '科学' }; // 3.9: 前哨基地の種族を短く示す

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

export function viewBoxOf(board) {
  const xs = board.vertices.map((v) => v.x), ys = board.vertices.map((v) => v.y);
  const pad = 1.2;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  return [minX, minY, Math.max(...xs) - minX + pad * 2, Math.max(...ys) - minY + pad * 2];
}

// 盤全体を描く。onVertexTap(vertexId) はどの交点をタップしても呼ばれる。
// highlight: Set<vertexId>（光らせて押せることを示す）。shipKindOf(owner, shipId) は 'colony' / 'trade' を返す。
export function renderBoard(svg, board, { highlight = new Set(), selectedShipVertex = null, onVertexTap, shipKindOf = () => 'colony' } = {}) {
  svg.innerHTML = '';
  const [x, y, w, h] = viewBoxOf(board);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);

  // 背景（宇宙）
  el('rect', { x, y, width: w, height: h, fill: '#070a18' }, svg);

  // 惑星の放射グラデーション（資源ごと。盤のたびに作り直す）
  const defs = el('defs', {}, svg);
  Object.entries(RES_GRADIENT_STOPS).forEach(([res, [c0, c1, c2]]) => {
    const g = el('radialGradient', { id: `planet-${res}`, cx: '35%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0', 'stop-color': c0 }, g);
    el('stop', { offset: '0.45', 'stop-color': c1 }, g);
    el('stop', { offset: '1', 'stop-color': c2 }, g);
  });
  // 星屑（装飾。壊れても遊びに影響しない簡易なもの）
  const starsG = el('g', { opacity: 0.5 }, svg);
  for (let i = 0; i < 80; i++) {
    const sx = x + Math.random() * w, sy = y + Math.random() * h;
    el('circle', { cx: sx, cy: sy, r: Math.random() * 0.03 + 0.01, fill: '#fff' }, starsG);
  }

  // 空のレーン（全交点をつなぐ辺）をうっすら
  const laneG = el('g', { stroke: 'rgba(142,160,255,0.09)', 'stroke-width': 0.03 }, svg);
  board.edges.forEach((e) => {
    const a = board.vertices[e.v1], b = board.vertices[e.v2];
    if (a.kind === 'systemCenter' || b.kind === 'systemCenter') return;
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, laneG);
  });

  // 惑星（資源を持つヘクス）
  board.hexes.forEach((hex) => {
    if (!hex.resource) return;
    const poly = el('polygon', { points: hexPolyPoints(board, hex), fill: `url(#planet-${hex.resource})`, stroke: '#141a33', 'stroke-width': 0.04, opacity: hex.disc && hex.disc.faceUp ? 1 : 0.55 }, svg);
    const cx = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].x, 0) / 6;
    const cy = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].y, 0) / 6;
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
      el('circle', { cx, cy, r: 0.26, fill: discFill, stroke: '#0a0d1c', 'stroke-width': 0.03, opacity: 0.95 }, svg);
      const t = el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.26, 'font-weight': 700, fill: textFill }, svg);
      t.textContent = label;
    }
  });

  // 前哨基地・宇宙港の中心、植民地の場所、ドッキングポイントの印
  board.sectors.forEach((sector) => {
    if (sector.centerVertexId == null) return;
    const v = board.vertices[sector.centerVertexId];
    if (sector.kind === 'outpost') {
      el('circle', { cx: v.x, cy: v.y, r: 0.22, fill: 'none', stroke: '#b79cff', 'stroke-width': 0.05, 'stroke-dasharray': '0.04 0.06' }, svg);
      if (sector.race) {
        const rt = el('text', { x: v.x, y: v.y + 0.08, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.2, fill: '#b79cff' }, svg);
        rt.textContent = RACE_SHORT[sector.race] || '';
      }
      sector.tradeStations.forEach((ts, i) => {
        const ang = (i / 5) * Math.PI * 2;
        el('rect', { x: v.x + Math.cos(ang) * 0.42 - 0.07, y: v.y + Math.sin(ang) * 0.42 - 0.07, width: 0.14, height: 0.14, fill: PLAYER_COLORS[ts.owner] }, svg);
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
        if (v.building.type === 'colony') el('circle', { cx: v.x, cy: v.y, r: 0.14, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.025 }, svg);
        else { el('rect', { x: v.x - 0.16, y: v.y - 0.16, width: 0.32, height: 0.32, rx: 0.05, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.025 }, svg); }
      } else {
        el('circle', { cx: v.x, cy: v.y, r: 0.08, fill: 'none', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 0.025 }, svg);
      }
    } else if (v.kind === 'spaceportSite' && v.spaceportOwner != null && !v.building) {
      el('circle', { cx: v.x, cy: v.y, r: 0.1, fill: 'none', stroke: PLAYER_COLORS[v.spaceportOwner], 'stroke-width': 0.03, 'stroke-dasharray': '0.05,0.05' }, svg);
    }
  });

  // 船
  board.vertices.forEach((v) => {
    if (!v.shipHere) return;
    const col = PLAYER_COLORS[v.shipHere.owner];
    const selected = v.id === selectedShipVertex;
    if (selected) el('circle', { cx: v.x, cy: v.y, r: 0.3, fill: 'none', stroke: '#fff', 'stroke-width': 0.04, opacity: 0.8 }, svg);
    const g = el('g', {}, svg);
    // 植民船は丸に家、交易船はひし形に箱で見分ける
    const trade = shipKindOf(v.shipHere.owner, v.shipHere.shipId) === 'trade';
    const r = 0.22;
    if (trade) el('polygon', { points: `${v.x},${v.y - r} ${v.x + r},${v.y} ${v.x},${v.y + r} ${v.x - r},${v.y}`, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.03 }, g);
    else el('circle', { cx: v.x, cy: v.y, r: 0.2, fill: col, stroke: '#0a0d1c', 'stroke-width': 0.03 }, g);
    const s = 0.07;
    if (trade) el('rect', { x: v.x - s, y: v.y - s, width: s * 2, height: s * 2, fill: '#0a0d1c' }, g);
    else el('polygon', { points: `${v.x},${v.y - s * 1.4} ${v.x + s * 1.2},${v.y - s * 0.2} ${v.x + s * 1.2},${v.y + s * 1.2} ${v.x - s * 1.2},${v.y + s * 1.2} ${v.x - s * 1.2},${v.y - s * 0.2}`, fill: '#0a0d1c' }, g);
  });

  // 行ける場所・タップできる場所を光らせる
  highlight.forEach((vid) => {
    const v = board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 0.22, fill: 'rgba(255,207,90,0.35)', stroke: '#ffcf5a', 'stroke-width': 0.04, class: 'tap-glow' }, svg);
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
