"use strict";
/* ============================================================
   TAB譜メーカー  —  静的サイト版（ビルド不要）
   データ構造:
   S = { version, title, artist, tempo, beats, tuning[6](1弦→6弦のMIDI番号),
         measures: [ [ {d:1|2|4|8|16, dot:bool, n:[6弦分のトークン]} ... ] ] }
   トークン例: "5", "12", "5h", "7b", "x"（空文字 = その弦は鳴らさない／全部空 = 休符）
   ============================================================ */
const $ = s => document.querySelector(s);
const STORAGE_KEY = 'tabMaker.song.v2';

const NOTE = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const nn = m => NOTE[((m % 12) + 12) % 12];
const nnOct = m => nn(m) + (Math.floor(m / 12) - 1);
const CIRC = '①②③④⑤⑥';
const PRESETS = [
  { id: 'std',    name: '標準（レギュラー）', t: [64,59,55,50,45,40] },
  { id: 'dropD',  name: 'ドロップD',         t: [64,59,55,50,45,38] },
  { id: 'half',   name: '半音下げ',          t: [63,58,54,49,44,39] },
  { id: 'whole',  name: '全音下げ',          t: [62,57,53,48,43,38] },
  { id: 'dropCs', name: 'ドロップC♯',        t: [63,58,54,49,44,37] },
  { id: 'dropC',  name: 'ドロップC',         t: [62,57,53,48,43,36] },
  { id: 'dadgad', name: 'DADGAD',           t: [62,57,55,50,45,38] },
  { id: 'openG',  name: 'オープンG',         t: [62,59,55,50,43,38] },
];
const STD = PRESETS[0].t;

const TK = { 1: 64, 2: 32, 4: 16, 8: 8, 16: 4 };          // 16分音符 = 4tick, 4分音符 = 16tick
const DURS = [1, 2, 4, 8, 16];
const DUR_NAME = { 1: '全音符', 2: '2分音符', 4: '4分音符', 8: '8分音符', 16: '16分音符' };
const evTicks = e => TK[e.d] * (e.dot ? 1.5 : 1);
const isRest = e => e.n.every(x => !x);
const mkEv = (d, dot) => ({ d, dot: !!dot, n: ['', '', '', '', '', ''] });
const cap = () => S.beats * 16;
const mTicks = m => m.reduce((a, e) => a + evTicks(e), 0);
const beatsText = t => { const b = t / 16; return Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0+$/, ''); };

let S;
let sel = { m: 0, e: 0, str: 5 };
let inDur = 8, inDot = false;
let clip = null, undo = [], redo = [];
let lay = null;

/* ---------- 曲データ ---------- */
function fillMeasure(d) {
  if (TK[d] > cap()) d = 4;
  const n = Math.max(1, Math.floor(cap() / TK[d]));
  return Array.from({ length: n }, () => mkEv(d));
}
function demoSong() {
  const ev = (d, notes, dot) => { const e = mkEv(d, dot); Object.entries(notes).forEach(([s, v]) => e.n[s - 1] = v); return e; };
  const pc = (d, f, dot) => ev(d, { 6: String(f), 5: String(f), 4: String(f) }, dot); // ドロップDのパワーコード
  return {
    version: 2, title: 'ドロップD リフ（サンプル）', artist: '', tempo: 100, beats: 4,
    tuning: PRESETS[1].t.slice(),
    measures: [
      [pc(8,0), ev(8,{6:'0'}), pc(8,0), ev(8,{6:'0'}), pc(4,3), pc(4,5)],
      [pc(8,0), ev(8,{6:'0'}), pc(8,0), ev(8,{6:'0'}), pc(8,7), pc(8,5), mkEv(4)],
      [ev(16,{4:'5h'}), ev(16,{4:'7'}), ev(8,{3:'5'}), ev(4,{3:'7b'},true), ev(8,{3:'5'}), ev(4,{4:'7~'})],
      [pc(1,0)],
    ],
  };
}
function validSong(o) {
  return o && Array.isArray(o.tuning) && o.tuning.length === 6 && Array.isArray(o.measures) && o.measures.length &&
    o.measures.every(m => Array.isArray(m) && m.every(e => e && TK[e.d] && Array.isArray(e.n) && e.n.length === 6));
}
function normalize(o) {
  o.version = 2; o.tempo = Math.max(30, Math.min(300, +o.tempo || 100));
  o.beats = Math.max(2, Math.min(6, +o.beats || 4)); o.title = o.title || ''; o.artist = o.artist || '';
  o.measures.forEach(m => m.forEach(e => { e.dot = !!e.dot; e.n = e.n.map(x => String(x || '').replace(/[^0-9hpb~x\/\\]/g, '').slice(0, 4)); }));
  return o;
}
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {} }
function loadSaved() {
  try { const j = localStorage.getItem(STORAGE_KEY); if (j) { const o = JSON.parse(j); if (validSong(o)) return normalize(o); } } catch (e) {}
  return null;
}

/* ---------- 元に戻す ---------- */
function pushUndo() { undo.push(JSON.stringify(S)); if (undo.length > 200) undo.shift(); redo = []; }
function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(S)); S = JSON.parse(undo.pop()); commit(); }
function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(S)); S = JSON.parse(redo.pop()); commit(); }
function commit() { clampSel(); syncForm(); render(); save(); }
function clampSel() {
  sel.m = Math.max(0, Math.min(sel.m, S.measures.length - 1));
  sel.e = Math.max(0, Math.min(sel.e, S.measures[sel.m].length - 1));
  sel.str = Math.max(0, Math.min(sel.str, 5));
}
const curEv = () => S.measures[sel.m][sel.e];

/* ---------- チューニング表記 ---------- */
const presetOf = t => PRESETS.find(p => p.t.every((v, i) => v === t[i]));
function tuningText() {
  const p = presetOf(S.tuning);
  const diff = [];
  S.tuning.forEach((v, i) => { if (v !== STD[i]) diff.push(CIRC[i] + '=' + nn(v)); });
  return {
    name: p ? p.name.replace(/（.*）/, '') : 'カスタム',
    diff: diff.slice().reverse().join('　'),             // 6弦側から表記
    notes: S.tuning.slice().reverse().map(nn).join(' '), // 6弦→1弦
  };
}

/* ---------- フォーム ---------- */
function buildPresetSelect() {
  $('#inPreset').innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('') + '<option value="custom">カスタム</option>';
}
function buildTuneSel() {
  const box = $('#tuneSel'); box.innerHTML = '';
  for (let i = 5; i >= 0; i--) {                       // 6弦から並べる
    const s = document.createElement('select');
    let h = ''; for (let m = 28; m <= 69; m++) h += `<option value="${m}">${CIRC[i]} ${nnOct(m)}</option>`;
    s.innerHTML = h; s.value = S.tuning[i]; s.title = (i + 1) + '弦のチューニング';
    s.onchange = () => { pushUndo(); S.tuning[i] = +s.value; commit(); };
    box.appendChild(s);
  }
}
function syncForm() {
  $('#inTitle').value = S.title; $('#inArtist').value = S.artist;
  $('#inTempo').value = S.tempo; $('#inBeats').value = S.beats;
  const p = presetOf(S.tuning); $('#inPreset').value = p ? p.id : 'custom';
  buildTuneSel();
}

/* ---------- レイアウト ---------- */
const W = 760, L = 30, LS = 14, TOP = 26;
const YB = TOP + 5 * LS;              // 6弦の線のy
const H = YB + 52;                    // 1段の高さ
const STEM_T = YB + 9, STEM_B = YB + 36, STEM_H = YB + 23;
const evW = e => 22 + evTicks(e) * 0.75;

function layout() {
  const avail = W - L - 4, rows = [];
  let row = { ms: [], nat: 0 };
  S.measures.forEach((m, mi) => {
    const extra = mi === 0 ? 22 : 0;                  // 拍子記号ぶん
    const nat = 10 + extra + m.reduce((a, e) => a + evW(e), 0) + 8;
    if (row.ms.length && row.nat + nat > avail) { rows.push(row); row = { ms: [], nat: 0 }; }
    row.ms.push({ mi, nat, extra }); row.nat += nat;
  });
  rows.push(row);
  const where = {};
  rows.forEach((r, ri) => {
    let scale = avail / r.nat;
    if (ri === rows.length - 1 && r.nat < avail * 0.7) scale = Math.min(scale, 1.3);
    let x = L;
    r.ms.forEach(mm => {
      mm.x = x; mm.w = mm.nat * scale;
      let ex = x + (10 + mm.extra) * scale;
      mm.evs = S.measures[mm.mi].map(e => { const w = evW(e) * scale; const o = { x0: ex - 6, x1: ex + w - 6, nx: ex + 4 }; ex += w; return o; });
      x += mm.w; where[mm.mi] = { ri, mm };
    });
    r.end = x;
  });
  return { rows, where };
}

/* ---------- 描画 ---------- */
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  const tt = tuningText();
  let html = `<div class="hd"><h1>${esc(S.title) || '無題'}</h1><div class="artist">${esc(S.artist)}</div>
    <div class="meta"><span><b>Tuning:</b> ${tt.name}（${tt.notes}）${tt.diff ? '　' + tt.diff : ''}</span><span>♩ = ${S.tempo}</span></div></div>`;
  lay = layout();
  lay.rows.forEach((r, ri) => {
    let g = `<svg class="sys" data-row="${ri}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    g += `<rect class="pc" id="pc-${ri}" x="0" y="${TOP - LS / 2}" width="1" height="${H - TOP - 8}" style="display:none"/>`;
    g += `<rect class="selc ed" id="sc-${ri}" x="0" y="${TOP - LS / 2}" width="1" height="${H - TOP - 8}" style="display:none"/>`;
    for (let i = 0; i < 6; i++) {
      const y = TOP + i * LS;
      g += `<line class="sl" x1="${L}" y1="${y}" x2="${r.end}" y2="${y}"/><text class="lb" x="${L - 12}" y="${y}">${nn(S.tuning[i])}</text>`;
    }
    g += `<line class="bl" x1="${L}" y1="${TOP}" x2="${L}" y2="${YB}"/>`;
    r.ms.forEach(mm => {
      const m = S.measures[mm.mi], xe = mm.x + mm.w, last = mm.mi === S.measures.length - 1;
      g += `<text class="nb" x="${mm.x + 3}" y="${TOP - 11}">${mm.mi + 1}</text>`;
      if (last) g += `<line class="bl" x1="${xe - 5}" y1="${TOP}" x2="${xe - 5}" y2="${YB}"/><line x1="${xe - 1.5}" y1="${TOP}" x2="${xe - 1.5}" y2="${YB}" stroke="#111" stroke-width="3"/>`;
      else g += `<line class="bl" x1="${xe}" y1="${TOP}" x2="${xe}" y2="${YB}"/>`;
      if (mm.extra) {
        const cx = mm.x + 15;
        g += `<rect x="${cx - 9}" y="${TOP}" width="18" height="${YB - TOP}" fill="#fff"/><text class="ts" x="${cx}" y="${TOP + LS * 1.3}">${S.beats}</text><text class="ts" x="${cx}" y="${TOP + LS * 3.7}">4</text>`;
      }
      // 小節の過不足（編集画面のみ）
      const diff = cap() - mTicks(m);
      if (diff !== 0) g += `<text class="fill ed" x="${mm.x + mm.w / 2}" y="${H - 3}" fill="${diff > 0 ? '#b45309' : '#dc2626'}">${diff > 0 ? 'あと' + beatsText(diff) + '拍' : beatsText(-diff) + '拍オーバー'}</text>`;
      m.forEach((e, ei) => {
        const p = mm.evs[ei];
        for (let i = 0; i < 6; i++) {
          const y = TOP + i * LS;
          g += `<rect class="cell" data-m="${mm.mi}" data-e="${ei}" data-str="${i}" x="${p.x0}" y="${y - LS / 2}" width="${p.x1 - p.x0}" height="${LS}"/>`;
          const tok = e.n[i];
          if (tok) { const tw = tok.length * 7.2 + 3; g += `<rect x="${p.nx - tw / 2}" y="${y - 6.5}" width="${tw}" height="13" fill="#fff"/><text class="fr" x="${p.nx}" y="${y}">${esc(tok)}</text>`; }
        }
        g += `<rect class="cell" data-m="${mm.mi}" data-e="${ei}" data-str="-1" x="${p.x0}" y="${YB + LS / 2}" width="${p.x1 - p.x0}" height="${H - YB - LS / 2}"/>`;
      });
      g += rhythm(m, mm.evs);
    });
    g += `<rect class="selr ed" id="sr-${ri}" x="0" y="0" width="1" height="${LS}" style="display:none"/>`;
    html += g + '</svg>';
  });
  $('#paper').innerHTML = html;
  updateSel(false);
}

/* リズム（TAB譜の下の符尾・連桁・休符） */
function rhythm(m, evs) {
  let g = '', t = 0;
  const items = m.map((e, i) => { const it = { e, x: evs[i].nx, st: t, rest: isRest(e) }; t += evTicks(e); return it; });
  // 連桁グループ（拍ごとに8分・16分をまとめる）
  const groups = []; let cur = null;
  items.forEach(it => {
    const beamable = !it.rest && it.e.d >= 8, beat = Math.floor(it.st / 16);
    if (beamable && cur && cur.beat === beat) cur.list.push(it);
    else { if (cur) groups.push(cur); cur = beamable ? { beat, list: [it] } : null; }
  });
  if (cur) groups.push(cur);

  items.forEach(it => {
    const { e, x } = it;
    if (it.rest) { g += restGlyph(e.d, x, YB + 22); if (e.dot) g += `<circle class="rhf" cx="${x + 8}" cy="${YB + 18}" r="1.8"/>`; return; }
    if (e.d === 1) g += `<ellipse class="rh" cx="${x}" cy="${YB + 16}" rx="4.5" ry="3"/>`;
    else g += `<line class="rh" x1="${x}" y1="${STEM_T}" x2="${x}" y2="${e.d === 2 ? STEM_H : STEM_B}"/>`;
    if (e.dot) g += `<circle class="rhf" cx="${x + 5}" cy="${e.d <= 2 ? YB + 17 : YB + 26}" r="1.8"/>`;
  });
  groups.forEach(gr => {
    const L0 = gr.list;
    if (L0.length === 1) {               // 旗
      const it = L0[0], n = it.e.d === 16 ? 2 : 1;
      for (let k = 0; k < n; k++) { const y = STEM_B - k * 5; g += `<path class="rh" stroke-width="1.6" d="M${it.x} ${y} q5 -2 7 -10"/>`; }
      return;
    }
    const a = L0[0].x, b = L0[L0.length - 1].x;
    g += `<rect class="rhf" x="${a}" y="${STEM_B - 3}" width="${b - a + 1}" height="3.2"/>`;
    // 2本目の連桁（16分）
    for (let i = 0; i < L0.length;) {
      if (L0[i].e.d !== 16) { i++; continue; }
      let j = i; while (j + 1 < L0.length && L0[j + 1].e.d === 16) j++;
      const y = STEM_B - 8.5;
      if (j > i) g += `<rect class="rhf" x="${L0[i].x}" y="${y}" width="${L0[j].x - L0[i].x + 1}" height="3.2"/>`;
      else { const left = i === L0.length - 1; g += `<rect class="rhf" x="${left ? L0[i].x - 7 : L0[i].x}" y="${y}" width="8" height="3.2"/>`; }
      i = j + 1;
    }
  });
  return g;
}
function restGlyph(d, x, y) {
  switch (d) {
    case 1: return `<line class="rh" x1="${x - 7}" y1="${y - 5}" x2="${x + 7}" y2="${y - 5}"/><rect class="rhf" x="${x - 4.5}" y="${y - 5}" width="9" height="4.5"/>`;
    case 2: return `<line class="rh" x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/><rect class="rhf" x="${x - 4.5}" y="${y - 4.5}" width="9" height="4.5"/>`;
    case 4: return `<path class="rh" stroke-width="2" stroke-linejoin="round" d="M${x - 1} ${y - 11} L${x + 3} ${y - 6} L${x - 2} ${y - 1} L${x + 3} ${y + 4} Q${x - 4} ${y + 2} ${x} ${y + 9}"/>`;
    case 8: return `<line class="rh" stroke-width="1.5" x1="${x + 3}" y1="${y - 7}" x2="${x - 1}" y2="${y + 8}"/><circle class="rhf" cx="${x - 2}" cy="${y - 7}" r="2.3"/><path class="rh" d="M${x - 2} ${y - 5} Q${x + 1} ${y - 4} ${x + 3} ${y - 7}"/>`;
    default: return `<line class="rh" stroke-width="1.5" x1="${x + 4}" y1="${y - 9}" x2="${x - 1}" y2="${y + 9}"/><circle class="rhf" cx="${x - 1}" cy="${y - 9}" r="2.2"/><path class="rh" d="M${x - 1} ${y - 7} Q${x + 2} ${y - 6} ${x + 4} ${y - 9}"/><circle class="rhf" cx="${x - 2.5}" cy="${y - 3}" r="2.2"/><path class="rh" d="M${x - 2.5} ${y - 1} Q${x + .5} ${y} ${x + 2.5} ${y - 3}"/>`;
  }
}

/* ---------- 選択表示 ---------- */
let lastSelRow = -1;
function updateSel(scroll = true) {
  if (lastSelRow >= 0) ['sr-', 'sc-'].forEach(p => { const el = document.getElementById(p + lastSelRow); if (el) el.style.display = 'none'; });
  const w = lay.where[sel.m]; if (!w) return;
  const p = w.mm.evs[sel.e]; if (!p) return;
  const a = document.getElementById('sr-' + w.ri), b = document.getElementById('sc-' + w.ri);
  a.setAttribute('x', p.x0); a.setAttribute('width', p.x1 - p.x0); a.setAttribute('y', TOP + sel.str * LS - LS / 2); a.style.display = '';
  b.setAttribute('x', p.x0); b.setAttribute('width', p.x1 - p.x0); b.style.display = '';
  lastSelRow = w.ri;
  if (scroll) scrollIntoViewIfNeeded(a.ownerSVGElement);
  // パレットの状態とステータス
  const e = curEv(); inDur = e.d; inDot = e.dot;
  document.querySelectorAll('.dur').forEach(btn => btn.classList.toggle('on', +btn.dataset.d === inDur));
  $('#btnDot').classList.toggle('on', inDot);
  $('#btnRest').classList.toggle('on', isRest(e));
  const diff = cap() - mTicks(S.measures[sel.m]);
  $('#status').innerHTML = `選択中：<b>${sel.m + 1}小節目</b> の <b>${sel.e + 1}番目</b>（${isRest(e) ? '休符' : '音符'}・${e.dot ? '付点' : ''}${DUR_NAME[e.d]}）／ <b>${CIRC[sel.str]}弦</b>（${nn(S.tuning[sel.str])}）`
    + (diff ? `　<span class="warn">この小節は${diff > 0 ? 'あと' + beatsText(diff) + '拍' : beatsText(-diff) + '拍オーバー'}</span>` : '');
}
function scrollIntoViewIfNeeded(el) {
  const rc = el.getBoundingClientRect(), top = $('.ui').getBoundingClientRect().bottom;
  if (rc.top < top) window.scrollBy({ top: rc.top - top - 16 });
  else if (rc.bottom > innerHeight) window.scrollBy({ top: rc.bottom - innerHeight + 16 });
}
let lastPc = -1;
function showCursor(m, e) {
  if (lastPc >= 0) { const el = document.getElementById('pc-' + lastPc); if (el) el.style.display = 'none'; }
  lastPc = -1; if (m < 0) return;
  const w = lay.where[m]; if (!w) return; const p = w.mm.evs[e]; if (!p) return;
  const el = document.getElementById('pc-' + w.ri);
  el.setAttribute('x', p.x0); el.setAttribute('width', p.x1 - p.x0); el.style.display = '';
  const rc = el.ownerSVGElement.getBoundingClientRect(), top = $('.ui').getBoundingClientRect().bottom;
  if (rc.top < top || rc.bottom > innerHeight) window.scrollBy({ top: rc.top - top - 30, behavior: 'smooth' });
  lastPc = w.ri;
}

/* ---------- 編集操作 ---------- */
let digitState = null;
function inputDigit(d) {
  const key = sel.m + ',' + sel.e + ',' + sel.str, now = Date.now();
  const e = curEv(), cur = e.n[sel.str], suf = (cur.match(/^\d+(.*)$/) || [, ''])[1];
  let f = d;
  if (digitState && digitState.key === key && now - digitState.t < 1000 && digitState.v.length === 1 && +(digitState.v + d) <= 24) f = digitState.v + d;
  pushUndo(); e.n[sel.str] = f + suf; digitState = { key, t: now, v: f };
  render(); save(); previewNote(sel.str, f);
}
function inputTech(k) {
  const e = curEv(), cur = e.n[sel.str];
  if (k === 'x') { pushUndo(); e.n[sel.str] = cur === 'x' ? '' : 'x'; }
  else {
    const m = cur.match(/^(\d+)(.*)$/); if (!m) return;
    pushUndo(); e.n[sel.str] = m[1] + (m[2] === k ? '' : k);
  }
  render(); save();
}
function clearString() { pushUndo(); curEv().n[sel.str] = ''; digitState = null; render(); save(); }
function makeRest() { pushUndo(); curEv().n = ['', '', '', '', '', '']; render(); save(); }
function setDur(d) { inDur = d; pushUndo(); curEv().d = d; render(); save(); }
function stepDur(dir) { const i = DURS.indexOf(curEv().d) + dir; if (i >= 0 && i < DURS.length) setDur(DURS[i]); }
function toggleDot() { pushUndo(); curEv().dot = !curEv().dot; render(); save(); }
function addEvent(after) {
  pushUndo(); const m = S.measures[sel.m];
  m.splice(after ? sel.e + 1 : sel.e, 0, mkEv(inDur, inDot));
  if (after) sel.e++;
  render(); save();
}
function deleteEvent() {
  pushUndo(); const m = S.measures[sel.m];
  if (m.length > 1) m.splice(sel.e, 1);
  else m[0] = mkEv(m[0].d, m[0].dot);
  clampSel(); render(); save();
}
function move(de, dstr) {
  digitState = null;
  if (dstr) sel.str = Math.max(0, Math.min(5, sel.str + dstr));
  if (de < 0) {
    if (sel.e > 0) sel.e--; else if (sel.m > 0) { sel.m--; sel.e = S.measures[sel.m].length - 1; }
  } else if (de > 0) {
    const m = S.measures[sel.m];
    if (sel.e < m.length - 1) sel.e++;
    else if (mTicks(m) < cap()) {                    // 小節が埋まるまで自動で追加
      pushUndo(); let d = inDur;
      const rest = cap() - mTicks(m); while (TK[d] > rest && d < 16) d *= 2;
      m.push(mkEv(d)); sel.e++; render(); save(); return;
    } else if (sel.m < S.measures.length - 1) { sel.m++; sel.e = 0; }
    else { pushUndo(); S.measures.push(fillMeasure(inDur)); sel.m++; sel.e = 0; render(); save(); return; }
  }
  updateSel();
}

document.addEventListener('keydown', ev => {
  if (ev.target.matches('input,select,textarea')) return;
  const k = ev.key;
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
    const lk = k.toLowerCase();
    if (lk === 'z' && !ev.shiftKey) { ev.preventDefault(); doUndo(); }
    else if (lk === 'y' || (lk === 'z' && ev.shiftKey)) { ev.preventDefault(); doRedo(); }
    else if (lk === 'p') { ev.preventDefault(); printPdf(); }
    else if (lk === 's') { ev.preventDefault(); saveFile(); }
    return;
  }
  let handled = true;
  if (/^[0-9]$/.test(k)) inputDigit(k);
  else if (['h', 'p', 'b', '/', '\\', '~', 'x'].includes(k)) inputTech(k);
  else if ((k === 'Delete' || k === 'Backspace') && ev.shiftKey) deleteEvent();
  else if (k === 'Delete' || k === 'Backspace') clearString();
  else if (k === 'Insert') addEvent(false);
  else if (k === 'r' || k === 'R') makeRest();
  else if (k === '.') toggleDot();
  else if (k === '+' || k === ';') stepDur(-1);
  else if (k === '-') stepDur(1);
  else if (k === 'ArrowLeft') move(-1, 0);
  else if (k === 'ArrowRight') move(1, 0);
  else if (k === 'ArrowUp') move(0, -1);
  else if (k === 'ArrowDown') move(0, 1);
  else if (k === ' ') togglePlay(sel.m);
  else handled = false;
  if (handled) ev.preventDefault();
});
$('#paper').addEventListener('mousedown', ev => {
  const c = ev.target.closest('.cell'); if (!c) return;
  ev.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const str = +c.dataset.str;
  sel = { m: +c.dataset.m, e: +c.dataset.e, str: str < 0 ? sel.str : str };
  digitState = null; updateSel(false);
});
const btn = (id, fn) => { $(id).addEventListener('click', ev => { ev.currentTarget.blur(); fn(); }); };
document.querySelectorAll('.dur').forEach(b => b.addEventListener('click', () => { b.blur(); setDur(+b.dataset.d); }));
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => { b.blur(); inputTech(b.dataset.k); }));
btn('#btnDot', toggleDot); btn('#btnRest', makeRest);
btn('#eAdd', () => addEvent(true)); btn('#eIns', () => addEvent(false)); btn('#eDel', deleteEvent);
btn('#mAdd', () => { pushUndo(); S.measures.splice(sel.m + 1, 0, fillMeasure(inDur)); sel.m++; sel.e = 0; commit(); });
btn('#mDel', () => { pushUndo(); S.measures.splice(sel.m, 1); if (!S.measures.length) S.measures.push(fillMeasure(4)); commit(); });
btn('#mCopy', () => { clip = JSON.stringify(S.measures[sel.m]); $('#status').innerHTML += '　<b>小節をコピーしました</b>'; });
btn('#mPaste', () => { if (!clip) return; pushUndo(); S.measures[sel.m] = JSON.parse(clip); sel.e = 0; commit(); });
btn('#btnUndo', doUndo); btn('#btnRedo', doRedo);

/* ---------- 曲の設定 ---------- */
$('#inTitle').addEventListener('focus', pushUndo);
$('#inArtist').addEventListener('focus', pushUndo);
$('#inTitle').addEventListener('input', ev => { S.title = ev.target.value; render(); save(); });
$('#inArtist').addEventListener('input', ev => { S.artist = ev.target.value; render(); save(); });
$('#inTempo').addEventListener('change', ev => { pushUndo(); S.tempo = Math.max(30, Math.min(300, +ev.target.value || 100)); commit(); });
$('#inBeats').addEventListener('change', ev => { pushUndo(); S.beats = +ev.target.value; commit(); });
$('#inPreset').addEventListener('change', ev => {
  const p = PRESETS.find(x => x.id === ev.target.value); if (!p) { syncForm(); return; }
  pushUndo(); S.tuning = p.t.slice(); commit();
});

/* ---------- ファイル ---------- */
btn('#btnNew', () => {
  if (!confirm('新しい譜面を作りますか？\n（今の内容は「元に戻す」で戻せます）')) return;
  pushUndo();
  S = { version: 2, title: '', artist: '', tempo: 100, beats: 4, tuning: S.tuning.slice(), measures: [] };
  for (let i = 0; i < 4; i++) S.measures.push(fillMeasure(4));
  sel = { m: 0, e: 0, str: 5 }; commit(); $('#inTitle').focus();
});
function saveFile() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (S.title || 'tab').replace(/[\\/:*?"<>|]/g, '_') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
btn('#btnSave', saveFile);
btn('#btnOpen', () => $('#file').click());
$('#file').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try { const o = JSON.parse(await f.text()); if (!validSong(o)) throw 0; pushUndo(); S = normalize(o); sel = { m: 0, e: 0, str: 5 }; commit(); }
  catch (_) { alert('このファイルは読み込めませんでした（TAB譜メーカーのJSONを選んでください）'); }
  ev.target.value = '';
});
function printPdf() {
  stop();
  const t = document.title; document.title = S.title || 'TAB譜';
  window.print();
  setTimeout(() => { document.title = t; }, 500);
}
btn('#btnPdf', printPdf);

/* ---------- 音源：Karplus-Strong 方式の撥弦合成 ---------- */
let ctx = null, master = null; const bufCache = {};
function ensureAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.5;
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 200; body.gain.value = 4;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
  const comp = ctx.createDynamicsCompressor();
  master.connect(body).connect(lp).connect(comp).connect(ctx.destination);
}
function pluckBuf(midi) {
  if (bufCache[midi]) return bufCache[midi];
  const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
  const N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 3.5);
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
  let prev = 0; for (let i = 0; i < N; i++) { prev = prev * 0.4 + (Math.random() * 2 - 1) * 0.6; ring[i] = prev; }
  const damp = midi < 45 ? 0.9988 : 0.997;
  for (let i = 0, idx = 0; i < len; i++) { const nx = (idx + 1) % N; d[i] = ring[idx]; ring[idx] = (ring[idx] + ring[nx]) * 0.5 * damp; idx = nx; }
  for (let i = 0; i < 2000; i++) d[len - 1 - i] *= i / 2000;
  return (bufCache[midi] = { buf, rate: f * (N + 0.5) / sr });   // 遅延の端数を再生速度で補正して正確な音程に
}
let nodes = [];
function pluck(midi, t, vel) {
  const p = pluckBuf(midi), src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = p.buf; src.playbackRate.setValueAtTime(p.rate, t);
  g.gain.setValueAtTime(vel, t); src.connect(g).connect(master); src.start(t);
  const n = { src, g, midi, rate: p.rate, cur: p.rate, t, suf: '' }; nodes.push(n); return n;
}
function release(n, t) { if (!n) return; try { n.g.gain.setTargetAtTime(0, t, 0.03); n.src.stop(t + 0.4); } catch (e) {} }
function deadNote(t) {
  const len = Math.floor(ctx.sampleRate * 0.05), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.frequency.value = 1200; g.gain.value = 0.8;
  s.buffer = b; s.connect(bp).connect(g).connect(master); s.start(t); nodes.push({ src: s, g });
}
function click(t, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.25, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.05); nodes.push({ src: o, g });
}
const LEGATO = /[hp\/\\]$/;
function playEvent(e, t, dur, active) {
  for (let i = 0; i < 6; i++) {
    const tok = e.n[i], prev = active[i];
    if (!tok) { release(prev, t); active[i] = null; continue; }
    if (tok === 'x') { release(prev, t); active[i] = null; deadNote(t); continue; }
    const m = tok.match(/^(\d+)(.*)$/); if (!m) continue;
    const midi = S.tuning[i] + +m[1], suf = m[2];
    let n;
    if (prev && LEGATO.test(prev.suf)) {        // ハンマリング・プリング・スライド：弾き直さず音程だけ変える
      n = prev; const target = n.rate * Math.pow(2, (midi - n.midi) / 12);
      if (prev.suf === '/' || prev.suf === '\\') {
        const ts = Math.max(prev.t + 0.01, t - Math.min(0.12, dur * 0.7));
        n.src.playbackRate.setValueAtTime(n.cur, ts); n.src.playbackRate.linearRampToValueAtTime(target, t);
      } else n.src.playbackRate.setValueAtTime(target, t);
      n.cur = target; n.t = t;
    } else { release(prev, t); n = pluck(midi, t, 0.45); }
    n.suf = suf;
    if (suf === 'b') { const up = n.cur * Math.pow(2, 2 / 12); n.src.playbackRate.setValueAtTime(n.cur, t + 0.02); n.src.playbackRate.linearRampToValueAtTime(up, t + Math.min(0.25, dur * 0.8)); n.cur = up; }
    if (suf === '~') {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = n.cur * 0.012; lfo.connect(lg).connect(n.src.playbackRate);
      lfo.start(t + 0.08); lfo.stop(t + Math.max(0.2, dur)); nodes.push({ src: lfo, g: lg });
    }
    active[i] = n;
  }
}
function previewNote(str, fret) {
  if (playing) return;
  ensureAudio(); ctx.resume();
  const n = pluck(S.tuning[str] + +fret, ctx.currentTime + 0.01, 0.4);
  release(n, ctx.currentTime + 0.8);
}

/* ---------- 再生 ---------- */
let playing = false, pb = null;
function schedulePass(t0) {
  const tick = 60 / S.tempo / 16, metro = $('#chkMetro').checked, tl = [];
  let t = t0;
  for (let mi = pb.from; mi < S.measures.length; mi++) {
    const m = S.measures[mi], mStart = t, len = mTicks(m);
    if (metro) for (let b = 0; b * 16 < len; b++) click(mStart + b * 16 * tick, b === 0);
    m.forEach((e, ei) => { const d = evTicks(e) * tick; playEvent(e, t, d, pb.active); tl.push({ m: mi, e: ei, t }); t += d; });
  }
  return { start: t0, end: t, tl, i: 0 };
}
function play(from) {
  stop(); ensureAudio(); ctx.resume();
  playing = true; pb = { from, active: new Array(6).fill(null) };
  pb.cur = schedulePass(ctx.currentTime + 0.15); pb.next = null;
  $('#btnPlay').textContent = '■ 停止';
  requestAnimationFrame(tick);
}
function tick() {
  if (!playing) return;
  const now = ctx.currentTime;
  if ($('#chkLoop').checked && !pb.next && now > pb.cur.end - 0.5) pb.next = schedulePass(pb.cur.end);
  if (now >= pb.cur.end) {
    if (pb.next) { pb.cur = pb.next; pb.next = null; }
    else { pb.active.forEach(n => release(n, now + 0.6)); playing = false; showCursor(-1); $('#btnPlay').textContent = '▶ 再生'; return; }
  }
  const c = pb.cur; while (c.i + 1 < c.tl.length && c.tl[c.i + 1].t <= now) c.i++;
  if (now >= c.start) showCursor(c.tl[c.i].m, c.tl[c.i].e);
  requestAnimationFrame(tick);
}
function stop() {
  playing = false; showCursor(-1); $('#btnPlay').textContent = '▶ 再生';
  if (ctx) {
    const now = ctx.currentTime;
    nodes.forEach(n => { try { n.g.gain.cancelScheduledValues(now); n.g.gain.setTargetAtTime(0, now, 0.01); n.src.stop(now + 0.08); } catch (e) {} });
  }
  nodes = [];
}
function togglePlay(from) { if (playing) stop(); else play(from); }
btn('#btnPlay', () => togglePlay(0));
btn('#btnPlaySel', () => play(sel.m));

/* ---------- 起動 ---------- */
buildPresetSelect();
S = loadSaved() || demoSong();
syncForm();
render();
