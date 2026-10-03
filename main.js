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
let audioCtx = null;
function beep(freq, dur) {
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
// engine.js の game.events に積まれる名前と合わせる（10章）。画面本体は次の作業（1b）で作る
const SOUND = {
  dice: () => beep(340, 0.12),
  build: () => beep(520, 0.1),
  trade: () => beep(460, 0.1),
  rob: () => beep(220, 0.2),
  shake: () => beep(300, 0.08),
  reveal: () => beep(500, 0.06),
  clear: () => { beep(600, 0.08); setTimeout(() => beep(760, 0.1), 90); },
  move: () => beep(700, 0.03),
  shortage: () => beep(180, 0.08),
  win: () => { beep(660, 0.15); setTimeout(() => beep(880, 0.25), 140); },
};

// ---- ここからアプリ本体（画面は次の作業 1b で作る） ----
