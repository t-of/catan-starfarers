'use strict';

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

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----
