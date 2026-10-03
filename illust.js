'use strict';
// 盤の絵（SVG 要素を直に作る小さな関数の集まり）。凝らず、見分けがつく最小限にする（仕様4章）。
// engine.js が作る board（hexes/vertices/edges/sectors）を読み、main.js が呼ぶ。

export const RES_COLOR = { ore: '#9aa3b0', fuel: '#ff8a52', carbon: '#6d7d74', food: '#5fd58a', goods: '#c99bff' };
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
// highlight: Set<vertexId>（光らせて押せることを示す）。ships は {vertexId,ownerIdx,kind,selected} の配列。
export function renderBoard(svg, board, { highlight = new Set(), selectedShipVertex = null, onVertexTap } = {}) {
  svg.innerHTML = '';
  const [x, y, w, h] = viewBoxOf(board);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);

  // 背景（宇宙）
  el('rect', { x, y, width: w, height: h, fill: '#060810' }, svg);
  // 星屑（装飾。壊れても遊びに影響しない簡易なもの）
  const starsG = el('g', { opacity: 0.5 }, svg);
  for (let i = 0; i < 80; i++) {
    const sx = x + Math.random() * w, sy = y + Math.random() * h;
    el('circle', { cx: sx, cy: sy, r: Math.random() * 0.03 + 0.01, fill: '#fff' }, starsG);
  }

  // 空のレーン（全交点をつなぐ辺）をうっすら
  const laneG = el('g', { stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 0.03 }, svg);
  board.edges.forEach((e) => {
    const a = board.vertices[e.v1], b = board.vertices[e.v2];
    if (a.kind === 'systemCenter' || b.kind === 'systemCenter') return;
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, laneG);
  });

  // 惑星（資源を持つヘクス）
  board.hexes.forEach((hex) => {
    if (!hex.resource) return;
    const poly = el('polygon', { points: hexPolyPoints(board, hex), fill: RES_COLOR[hex.resource], stroke: '#0b0c10', 'stroke-width': 0.04, opacity: hex.disc && hex.disc.faceUp ? 1 : 0.55 }, svg);
    const cx = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].x, 0) / 6;
    const cy = hex.vertexIds.reduce((a, vid) => a + board.vertices[vid].y, 0) / 6;
    if (hex.disc) {
      let label = '？';
      if (hex.disc.token) label = hex.disc.token.kind === 'pirate' ? `☠${hex.disc.token.strength}` : `❄${hex.disc.token.strength}`;
      else if (hex.disc.faceUp) label = String(hex.disc.numbers[0]);
      el('circle', { cx, cy, r: 0.26, fill: hex.disc.token ? '#2a1620' : '#11131a', stroke: '#fff', 'stroke-width': 0.02, opacity: 0.9 }, svg);
      const t = el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.26, fill: '#fff' }, svg);
      t.textContent = label;
    }
  });

  // 前哨基地・宇宙港の中心、植民地の場所、ドッキングポイントの印
  board.sectors.forEach((sector) => {
    if (sector.centerVertexId == null) return;
    const v = board.vertices[sector.centerVertexId];
    if (sector.kind === 'outpost') {
      el('circle', { cx: v.x, cy: v.y, r: 0.22, fill: 'none', stroke: '#8fb8ff', 'stroke-width': 0.05 }, svg);
      if (sector.race) {
        const rt = el('text', { x: v.x, y: v.y + 0.08, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.2, fill: '#8fb8ff' }, svg);
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
        if (v.building.type === 'colony') el('circle', { cx: v.x, cy: v.y, r: 0.14, fill: col, stroke: '#0b0c10', 'stroke-width': 0.02 }, svg);
        else { el('rect', { x: v.x - 0.16, y: v.y - 0.16, width: 0.32, height: 0.32, fill: col, stroke: '#fff', 'stroke-width': 0.02 }, svg); }
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
    el('circle', { cx: v.x, cy: v.y, r: 0.2, fill: col, stroke: '#0b0c10', 'stroke-width': 0.03 }, g);
    const label = el('text', { x: v.x, y: v.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 0.2, fill: '#0b0c10' }, g);
    label.textContent = '◆'; // kind(colony/trade)は選んだ時の説明文で示す。アイコンは共通の船印でよい
  });

  // 行ける場所・タップできる場所を光らせる
  highlight.forEach((vid) => {
    const v = board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 0.22, fill: 'rgba(255,211,92,0.35)', stroke: '#ffd35c', 'stroke-width': 0.04, class: 'tap-glow' }, svg);
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
