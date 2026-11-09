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
const isRest = e => !e.ps && e.n.every(x => !x);
const mkEv = (d, dot) => ({ d, dot: !!dot, n: ['', '', '', '', '', ''] });
const cap = () => S.beats * 16;
const mTicks = m => m.reduce((a, e) => a + evTicks(e), 0);
/* トークン書式: [(] [/] フレット [)] フラグ
   ( ) = タイ, 先頭の / = スライドイン, フラグ: b=全音チョーキング u=半音チョーキング r=戻し
   ~=ビブラート w=アームダウン a=ピッキングハーモニクス, 末尾の h p / \ = ハンマリング・プリング・スライド */
function parseTok(tok) {
  if (!tok) return null;
  if (tok === 'x') return { x: true };
  const m = tok.match(/^(\()?(\/)?(\d+)\)?([bur~wa]*[hp\/\\]?)$/);
  return m ? { tie: !!m[1], sin: !!m[2], fs: m[3], f: +m[3], fl: m[4] } : null;
}
const fmtTok = p => (p.tie ? '(' : '') + (p.sin ? '/' : '') + p.fs + (p.tie ? ')' : '') + p.fl;
const dispTok = p => p.x ? 'x' : (p.tie ? '(' : '') + (p.sin ? '/' : '') + p.fs + (p.tie ? ')' : '') + p.fl.replace(/[^hp\/\\]/g, '');
function toggleFlag(fl, k) {
  const s = new Set(fl.split(''));
  if (s.has(k)) s.delete(k);
  else {
    if ('bu'.includes(k)) { s.delete('b'); s.delete('u'); }
    if ('hp/\\'.includes(k)) ['h', 'p', '/', '\\'].forEach(c => s.delete(c));
    s.add(k);
  }
  return [...'bur~wa'].filter(c => s.has(c)).join('') + [...'hp/\\'].filter(c => s.has(c)).join('');
}
const prevPos = (mi, ei) => ei > 0 ? [mi, ei - 1] : mi > 0 ? [mi - 1, S.measures[mi - 1].length - 1] : null;
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
  o.tone = o.tone === 'dist' ? 'dist' : 'clean';
  o.view = o.view === 'staff' ? 'staff' : 'tab';
  o.measures.forEach(m => m.forEach(e => {
    e.dot = !!e.dot; if (e.ps) e.ps = true; else delete e.ps;
    e.n = e.n.map(x => { const p = parseTok(String(x || '')); return p ? (p.x ? 'x' : fmtTok(p)) : ''; });
  }));
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
  $('#inTempo').value = S.tempo; $('#inBeats').value = S.beats; $('#inTone').value = S.tone === 'dist' ? 'dist' : 'clean'; $('#inView').value = S.view === 'staff' ? 'staff' : 'tab';
  const p = presetOf(S.tuning); $('#inPreset').value = p ? p.id : 'custom';
  buildTuneSel();
}

/* ---------- レイアウト ---------- */
const W = 760, L = 30, LS = 14, TOP = 50;   // TOPより上は小節番号・奏法記号（P.H. / w/bar / 波線 / チョーキング矢印）の欄
const ANN_Y = TOP - 30, VIB_Y = TOP - 19, BEND_Y = TOP - 9;
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
  const view = S.view || 'tab', showStaff = view !== 'tab', showTab = view !== 'staff';
  lay.rows.forEach((r, ri) => {
    const off = showStaff ? SH : 0, totalH = off + (showTab ? H : 0);
    let g = `<svg class="sys" data-row="${ri}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg">`;
    g += `<rect class="pc" id="pc-${ri}" x="0" y="14" width="1" height="${totalH - 26}" style="display:none"/>`;
    g += `<rect class="selc ed" id="sc-${ri}" x="0" y="14" width="1" height="${totalH - 26}" style="display:none"/>`;
    // 小節の過不足（編集画面のみ）
    r.ms.forEach(mm => {
      const diff = cap() - mTicks(S.measures[mm.mi]);
      if (diff !== 0) g += `<text class="fill ed" x="${mm.x + mm.w / 2}" y="${totalH - 3}" fill="${diff > 0 ? '#b45309' : '#dc2626'}">${diff > 0 ? 'あと' + beatsText(diff) + '拍' : beatsText(-diff) + '拍オーバー'}</text>`;
    });
    if (showStaff) g += staffBlock(r, ri, !showTab);
    if (showTab) g += `<g transform="translate(0 ${off})">` + tabBlock(r, ri, !showStaff) + '</g>';
    html += g + '</svg>';
  });
  $('#paper').innerHTML = html;
  updateSel(false);
}

/* TAB譜の1段ぶん（standalone=true なら小節番号とリズムも描く） */
function tabBlock(r, ri, standalone) {
    let g = '';
    for (let i = 0; i < 6; i++) {
      const y = TOP + i * LS;
      g += `<line class="sl" x1="${L}" y1="${y}" x2="${r.end}" y2="${y}"/><text class="lb" x="${L - 12}" y="${y}">${nn(S.tuning[i])}</text>`;
    }
    g += `<line class="bl" x1="${L}" y1="${TOP}" x2="${L}" y2="${YB}"/>`;
    r.ms.forEach(mm => {
      const m = S.measures[mm.mi], xe = mm.x + mm.w, last = mm.mi === S.measures.length - 1;
      if (standalone) g += `<text class="nb" x="${mm.x + 3}" y="10">${mm.mi + 1}</text>`;
      if (last) g += `<line class="bl" x1="${xe - 5}" y1="${TOP}" x2="${xe - 5}" y2="${YB}"/><line x1="${xe - 1.5}" y1="${TOP}" x2="${xe - 1.5}" y2="${YB}" stroke="#111" stroke-width="3"/>`;
      else g += `<line class="bl" x1="${xe}" y1="${TOP}" x2="${xe}" y2="${YB}"/>`;
      if (mm.extra) {
        const cx = mm.x + 15;
        g += `<rect x="${cx - 9}" y="${TOP}" width="18" height="${YB - TOP}" fill="#fff"/><text class="ts" x="${cx}" y="${TOP + LS * 1.3}">${S.beats}</text><text class="ts" x="${cx}" y="${TOP + LS * 3.7}">4</text>`;
      }
      m.forEach((e, ei) => {
        const p = mm.evs[ei];
        let ov = '';                                    // 数字の上に重ねる記号
        const ann = [], fx = { bend: null, vib: false };
        if (e.ps) ann.push('P.S.');
        for (let i = 0; i < 6; i++) {
          const y = TOP + i * LS;
          g += `<rect class="cell" data-m="${mm.mi}" data-e="${ei}" data-str="${i}" x="${p.x0}" y="${y - LS / 2}" width="${p.x1 - p.x0}" height="${LS}"/>`;
          const tk = parseTok(e.n[i]);
          if (!tk) continue;
          const txt = dispTok(tk);
          const tw = txt.length * 7.2 + 3;
          g += `<rect x="${p.nx - tw / 2}" y="${y - 6.5}" width="${tw}" height="13" fill="#fff"/><text class="fr" x="${p.nx}" y="${y}">${esc(txt)}</text>`;
          if (tk.x) continue;
          if (tk.fl.includes('a') && !ann.includes('P.H.')) ann.push('P.H.');
          if (tk.fl.includes('w') && !ann.includes('w/bar')) ann.push('w/bar');
          if (tk.fl.includes('~')) fx.vib = true;
          const bu = tk.fl.match(/[bu]/), rl = tk.fl.includes('r');
          if ((bu || rl) && !fx.bend) {                 // チョーキングの矢印（一番上の弦の音に1つだけ）
            fx.bend = 1;
            const sx = p.nx + tw / 2 - 1, tx = p.nx + tw / 2 + 7;
            if (bu) ov += `<path class="rh" d="M${sx} ${y - 2} Q${tx} ${y - 3} ${tx} ${BEND_Y + 3}"/><path class="rhf" d="M${tx - 3} ${BEND_Y + 5} L${tx} ${BEND_Y - 1} L${tx + 3} ${BEND_Y + 5}Z"/>`;
            else ov += `<line class="rh" x1="${tx}" y1="${y - 7}" x2="${tx}" y2="${BEND_Y + 3}" stroke-dasharray="2 2"/>`;
            ov += `<text class="bd" x="${tx}" y="${BEND_Y - 5}">${bu && bu[0] === 'u' ? '½' : 'full'}</text>`;
            if (rl) { const rx = tx + 9; ov += `<path class="rh" d="M${tx + 1} ${BEND_Y + 1} Q${rx} ${BEND_Y + 1} ${rx} ${y - 5}"/><path class="rhf" d="M${rx - 3} ${y - 9} L${rx} ${y - 3} L${rx + 3} ${y - 9}Z"/>`; }
            fx.bend = tx + (rl ? 14 : 12);               // 波線は「full」の右から
          }
          if (tk.tie) {                                  // タイの弧（前の音から／段の頭なら左端から）
            const pp = prevPos(mm.mi, ei), pw = pp && lay.where[pp[0]];
            const x0 = pw && pw.ri === ri ? pw.mm.evs[pp[1]].nx + 5 : mm.x - 2, x1 = p.nx - 9;
            if (x1 > x0) g += `<path d="M${x0} ${y + 4} Q${(x0 + x1) / 2} ${y + 10} ${x1} ${y + 4}" stroke="#111" stroke-width="1" fill="none"/>`;
          }
        }
        if (fx.vib) {                                   // ビブラートの波線
          const vx0 = typeof fx.bend === 'number' ? fx.bend : p.nx - 4, vx1 = Math.max(vx0 + 14, p.x1 - 2);
          let d = `M${vx0} ${VIB_Y}`; for (let x = vx0; x + 4 <= vx1; x += 4) d += ` q1 -3 2 0 q1 3 2 0`;
          g += `<path class="rh" stroke-width="1.2" d="${d}"/>`;
        }
        if (ann.length) g += `<text class="an" x="${p.nx - 4}" y="${ANN_Y}">${ann.join(' ')}</text>`;
        g += ov;
        g += `<rect class="cell" data-m="${mm.mi}" data-e="${ei}" data-str="-1" x="${p.x0}" y="${YB + LS / 2}" width="${p.x1 - p.x0}" height="${H - YB - LS / 2}"/>`;
      });
      if (standalone) g += rhythm(m, mm.evs);
    });
    g += `<rect class="selr ed" id="sr-${ri}" x="0" y="0" width="1" height="${LS}" style="display:none"/>`;
    return g;
}

/* ---------- 五線譜（ギター譜の慣習どおり、ト音記号＋8＝実音より1オクターブ高く記譜） ---------- */
const SP = 8, ST = 46, SB = ST + 4 * SP, SH = SB + 50;   // 線の間隔・第5線・第1線・五線ブロックの高さ
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
function staffPos(midi) {                              // 記譜上の音 → 五線の段（E4 = 第1線 = 30）
  const w = midi + 12, pc = ((w % 12) + 12) % 12;
  const d = (Math.floor(w / 12) - 1) * 7 + LETTER[pc];
  return { d, y: SB - (d - 30) * SP / 2, sharp: SHARP[pc] };
}
function evNotes(e) {                                  // 1つの音符に含まれる音（同じ高さはまとめる）
  const out = [];
  e.n.forEach((tok, i) => {
    const p = parseTok(tok); if (!p) return;
    const s = staffPos(S.tuning[i] + (p.x ? 0 : p.f));
    const ex = out.find(o => o.d === s.d && o.sharp === s.sharp);
    if (ex) { ex.tie = ex.tie && p.tie; return; }
    out.push({ ...s, x: !!p.x, tie: !!p.tie, str: i, fl: p.x ? '' : p.fl });
  });
  return out.sort((a, b) => a.d - b.d);
}
const CLEF = (x, g) => `<path class="rh" stroke-width="1.7" d="M${x + 9} ${g + 3} C${x + 3} ${g + 4} ${x + 3} ${g - 5} ${x + 9} ${g - 5} C${x + 16} ${g - 5} ${x + 16} ${g + 6} ${x + 9} ${g + 7} C${x} ${g + 8} ${x - 1} ${g - 4} ${x + 5} ${g - 10} C${x + 10} ${g - 15} ${x + 14} ${g - 22} ${x + 11} ${g - 28} C${x + 8} ${g - 33} ${x + 4} ${g - 26} ${x + 7} ${g - 18} L${x + 11} ${g + 15} C${x + 12} ${g + 21} ${x + 6} ${g + 22} ${x + 5} ${g + 17}"/><circle class="rhf" cx="${x + 6.5}" cy="${g + 16}" r="2.2"/><text class="oc" x="${x + 9}" y="${g + 30}">8</text>`;

function staffBlock(r, ri, standalone) {
  let g = '';
  for (let k = 0; k < 5; k++) { const y = ST + k * SP; g += `<line class="sl" x1="${L}" y1="${y}" x2="${r.end}" y2="${y}"/>`; }
  g += CLEF(L - 26, SB - SP);
  g += `<line class="bl" x1="${L}" y1="${ST}" x2="${L}" y2="${SB}"/>`;
  r.ms.forEach(mm => {
    const m = S.measures[mm.mi], xe = mm.x + mm.w, last = mm.mi === S.measures.length - 1;
    g += `<text class="nb" x="${mm.x + 3}" y="10">${mm.mi + 1}</text>`;
    if (last) g += `<line class="bl" x1="${xe - 5}" y1="${ST}" x2="${xe - 5}" y2="${SB}"/><line x1="${xe - 1.5}" y1="${ST}" x2="${xe - 1.5}" y2="${SB}" stroke="#111" stroke-width="3"/>`;
    else g += `<line class="bl" x1="${xe}" y1="${ST}" x2="${xe}" y2="${SB}"/>`;
    if (mm.extra) { const cx = mm.x + 15; g += `<text class="tss" x="${cx}" y="${ST + SP}">${S.beats}</text><text class="tss" x="${cx}" y="${ST + 3 * SP}">4</text>`; }

    const acc = {};                                      // 小節内の臨時記号の状態
    let t = 0;
    const items = m.map((e, ei) => { const it = { e, ei, x: mm.evs[ei].nx, st: t, notes: evNotes(e) }; t += evTicks(e); return it; });
    // 符尾の向き（連桁グループごと）
    const groups = []; let cur = null;
    items.forEach(it => {
      const beamable = it.notes.length && it.e.d >= 8, beat = Math.floor(it.st / 16);
      if (beamable && cur && cur.beat === beat) cur.list.push(it);
      else { if (cur) groups.push(cur); cur = beamable ? { beat, list: [it] } : null; }
      if (!beamable && it.notes.length) groups.push({ list: [it] });
    });
    if (cur) groups.push(cur);
    groups.forEach(gr => {
      const all = gr.list.flatMap(it => it.notes), avg = all.reduce((a, n) => a + n.d, 0) / all.length;
      const up = avg < 34;
      gr.list.forEach(it => { it.up = up; it.top = it.notes[it.notes.length - 1].y; it.bot = it.notes[0].y; });
      const end = up ? Math.min(...gr.list.map(it => it.top - 3.5 * SP)) : Math.max(...gr.list.map(it => it.bot + 3.5 * SP));
      gr.list.forEach(it => { it.end = gr.list.length > 1 ? end : (up ? it.top - 3.5 * SP : it.bot + 3.5 * SP); });
      gr.up = up; gr.end = end;
    });

    items.forEach(it => {
      const { e, x, ei } = it, p = mm.evs[ei];
      g += `<rect class="cell" data-m="${mm.mi}" data-e="${ei}" data-str="-1" x="${p.x0}" y="${ST - 12}" width="${p.x1 - p.x0}" height="${SH - ST + 4}"/>`;
      if (!it.notes.length) {                           // 休符
        g += restGlyph(e.d, x, e.d === 1 ? ST + SP + 5 : ST + 2 * SP);
        if (e.dot) g += `<circle class="rhf" cx="${x + 8}" cy="${ST + SP * 1.5}" r="1.7"/>`;
        return;
      }
      const ann = [];
      it.notes.forEach(n => {
        // 加線
        for (let k = 28; k >= n.d; k -= 2) { const y = SB - (k - 30) * SP / 2; g += `<line class="lg" x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/>`; }
        for (let k = 40; k <= n.d; k += 2) { const y = SB - (k - 30) * SP / 2; g += `<line class="lg" x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/>`; }
        // 臨時記号（タイの続きには付けない）
        const st = acc[n.d] || 0;
        if (n.sharp !== st && !n.tie) g += `<text class="acc" x="${x - 9}" y="${n.y}">${n.sharp ? '♯' : '♮'}</text>`;
        acc[n.d] = n.sharp;
        // 符頭
        if (n.x) g += `<path class="rh" stroke-width="1.5" d="M${x - 3.5} ${n.y - 3.5} l7 7 M${x - 3.5} ${n.y + 3.5} l7 -7"/>`;
        else if (e.d <= 2) g += `<ellipse cx="${x}" cy="${n.y}" rx="4.6" ry="3.3" transform="rotate(-20 ${x} ${n.y})" fill="#fff" stroke="#111" stroke-width="1.4"/>`;
        else g += `<ellipse class="rhf" cx="${x}" cy="${n.y}" rx="4.6" ry="3.3" transform="rotate(-20 ${x} ${n.y})"/>`;
        if (e.dot) g += `<circle class="rhf" cx="${x + 8}" cy="${n.d % 2 === 0 ? n.y - SP / 2 : n.y}" r="1.7"/>`;
        // タイ（前の音から）
        if (n.tie) {
          const pp = prevPos(mm.mi, ei), pw = pp && lay.where[pp[0]];
          const x0 = pw && pw.ri === ri ? pw.mm.evs[pp[1]].nx + 5 : mm.x - 2, x1 = x - 6, dy = it.up ? 6 : -6;
          if (x1 > x0) g += `<path d="M${x0} ${n.y + dy * .6} Q${(x0 + x1) / 2} ${n.y + dy * 1.8} ${x1} ${n.y + dy * .6}" stroke="#111" stroke-width="1.1" fill="none"/>`;
        }
        if (standalone && n.fl) {                       // 五線譜だけのときは奏法を文字で
          if (/a/.test(n.fl) && !ann.includes('P.H.')) ann.push('P.H.');
          if (/w/.test(n.fl) && !ann.includes('w/bar')) ann.push('w/bar');
          if (/b/.test(n.fl) && !ann.includes('full')) ann.push('full');
          if (/u/.test(n.fl) && !ann.includes('½')) ann.push('½');
          if (/~/.test(n.fl) && !ann.includes('~')) ann.push('~');
        }
      });
      if (standalone && e.ps) ann.unshift('P.S.');
      if (ann.length) g += `<text class="an" x="${x - 4}" y="${ST - 16}">${ann.join(' ')}</text>`;
      // 符尾と旗
      if (e.d >= 2) {
        const sx = it.up ? x + 4.2 : x - 4.2, from = it.up ? it.bot : it.top;
        g += `<line class="rh" x1="${sx}" y1="${from}" x2="${sx}" y2="${it.end}"/>`;
      }
    });
    groups.forEach(gr => {
      const Lg = gr.list; if (!Lg.length || Lg[0].e.d < 8) return;
      const sx = it => it.up ? it.x + 4.2 : it.x - 4.2, dir = gr.up ? 1 : -1;
      if (Lg.length === 1) {
        const it = Lg[0], n = it.e.d === 16 ? 2 : 1;
        for (let k = 0; k < n; k++) { const y = it.end + dir * k * 6; g += `<path class="rh" stroke-width="1.6" d="M${sx(it)} ${y} c1 ${4 * dir} 8 ${6 * dir} 6 ${13 * dir}"/>`; }
        return;
      }
      const a = sx(Lg[0]), b = sx(Lg[Lg.length - 1]), y0 = gr.up ? gr.end : gr.end - 3.5;
      g += `<rect class="rhf" x="${a - .6}" y="${y0}" width="${b - a + 1.2}" height="3.5"/>`;
      for (let i = 0; i < Lg.length;) {                 // 16分の2本目
        if (Lg[i].e.d !== 16) { i++; continue; }
        let j = i; while (j + 1 < Lg.length && Lg[j + 1].e.d === 16) j++;
        const y = y0 + dir * 6;
        if (j > i) g += `<rect class="rhf" x="${sx(Lg[i]) - .6}" y="${y}" width="${sx(Lg[j]) - sx(Lg[i]) + 1.2}" height="3.5"/>`;
        else { const left = i === Lg.length - 1; g += `<rect class="rhf" x="${left ? sx(Lg[i]) - 7 : sx(Lg[i])}" y="${y}" width="7" height="3.5"/>`; }
        i = j + 1;
      }
    });
  });
  return g;
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
  if (a) { a.setAttribute('x', p.x0); a.setAttribute('width', p.x1 - p.x0); a.setAttribute('y', TOP + sel.str * LS - LS / 2); a.style.display = ''; }  // 五線譜表示ではTABの枠はない
  b.setAttribute('x', p.x0); b.setAttribute('width', p.x1 - p.x0); b.style.display = '';
  lastSelRow = w.ri;
  if (scroll) scrollIntoViewIfNeeded(b.ownerSVGElement);
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
  const e = curEv(), cur = parseTok(e.n[sel.str]);
  let f = d;
  if (digitState && digitState.key === key && now - digitState.t < 1000 && digitState.v.length === 1 && +(digitState.v + d) <= 24) f = digitState.v + d;
  const keep = cur && !cur.x ? cur : { sin: false, fl: '' };   // 奏法は残してフレットだけ変える
  pushUndo(); e.n[sel.str] = fmtTok({ tie: false, sin: keep.sin, fs: f, fl: keep.fl }); digitState = { key, t: now, v: f };
  render(); save(); previewNote(sel.str, f);
}
function inputTech(k) {
  const e = curEv(), cur = e.n[sel.str], p = parseTok(cur);
  if (k === 'ps') { pushUndo(); if (e.ps) delete e.ps; else e.ps = true; }
  else if (k === 't') {
    if (p && !p.x) { pushUndo(); p.tie = !p.tie; e.n[sel.str] = fmtTok(p); }
    else {                                              // 空欄なら前の音と同じフレットでタイを作る
      const pp = prevPos(sel.m, sel.e), pv = pp && parseTok(S.measures[pp[0]][pp[1]].n[sel.str]);
      if (!pv || pv.x) return; pushUndo(); e.n[sel.str] = '(' + pv.fs + ')';
    }
  }
  else if (k === 'x') { pushUndo(); e.n[sel.str] = cur === 'x' ? '' : 'x'; }
  else {
    if (!p || p.x) { flash('先にフレット番号を入れてから奏法を付けてください'); return; }
    pushUndo();
    if (k === 'si') p.sin = !p.sin; else p.fl = toggleFlag(p.fl, k);
    e.n[sel.str] = fmtTok(p);
  }
  render(); save();
}
function flash(msg) { $('#status').innerHTML += `　<span class="warn">${msg}</span>`; }
function clearString() { pushUndo(); curEv().n[sel.str] = ''; digitState = null; render(); save(); }
function makeRest() { pushUndo(); const e = curEv(); e.n = ['', '', '', '', '', '']; delete e.ps; render(); save(); }
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
  else if (['h', 'p', 'b', 'u', '/', '\\', '~', 'x', 't', 'w', 'a'].includes(k)) inputTech(k);
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
$('#inView').addEventListener('change', ev => { S.view = ev.target.value; render(); save(); ev.target.blur(); });
function setTools(open) {                              // 入力ツールの開閉（開閉状態はこのブラウザだけに記憶）
  $('#tools').hidden = !open;
  $('#btnTools').setAttribute('aria-expanded', open);
  $('#btnTools').textContent = open ? '入力ツール ▲' : '入力ツール ▼';
  try { localStorage.setItem('tabMaker.toolsOpen', open ? '1' : '0'); } catch (e) {}
}
btn('#btnTools', () => setTools($('#tools').hidden));
try { setTools(localStorage.getItem('tabMaker.toolsOpen') === '1'); } catch (e) { setTools(false); }
$('#inTone').addEventListener('change', ev => { pushUndo(); S.tone = ev.target.value; save(); if (ctx) ensureAudio(); ev.target.blur(); });
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
let ctx = null, master = null, cleanG = null, distG = null; const bufCache = {};
function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
    // クリーン
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 200; body.gain.value = 4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
    cleanG = ctx.createGain(); master.connect(body).connect(lp).connect(cleanG).connect(comp);
    // ディストーション（歪み → アンプのキャビネット風フィルター）
    const pre = ctx.createGain(); pre.gain.value = 6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const sh = ctx.createWaveShaper(), k = 30, curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    sh.curve = curve; sh.oversample = '4x';
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 800; mid.gain.value = -5;
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3800; cab.Q.value = 0.8;
    distG = ctx.createGain(); master.connect(hp).connect(pre).connect(sh).connect(mid).connect(cab).connect(distG).connect(comp);
  }
  const dist = S.tone === 'dist';
  cleanG.gain.value = dist ? 0 : 1; distG.gain.value = dist ? 0.22 : 0;
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
  const n = { src, g, midi, rate: p.rate, cur: p.rate, fret: p.rate, t, fl: '', harm: 0 }; nodes.push(n); return n;
}
function pickScrape(t, dur) {                          // ピックスクラッチ：こすれるノイズが高→低へ
  const len = Math.min(1.5, Math.max(0.3, dur)), sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, Math.floor(sr * len), sr), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / sr * 2 * Math.PI * 38));
  const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = 'bandpass'; bp.Q.value = 6;
  bp.frequency.setValueAtTime(3500, t); bp.frequency.exponentialRampToValueAtTime(500, t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.2, t + 0.04); g.gain.setTargetAtTime(0, t + len * 0.8, 0.06);
  s.buffer = b; s.connect(bp).connect(g).connect(master); s.start(t); s.stop(t + len + 0.3); nodes.push({ src: s, g });
}
function endNote(n, t) {                               // 末尾が / \ で次に音がなければスライドアウト
  if (!n) return;
  if (/[\/\\]$/.test(n.fl)) {
    const ts = Math.max(n.t + 0.03, t - 0.18), pr = n.src.playbackRate;
    pr.setValueAtTime(n.cur, ts); pr.linearRampToValueAtTime(n.cur * Math.pow(2, (n.fl.endsWith('/') ? 7 : -7) / 12), t);
  }
  release(n, t);
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
const semi = s => Math.pow(2, s / 12);
function playEvent(e, t, dur, active) {
  if (e.ps) pickScrape(t, dur);
  for (let i = 0; i < 6; i++) {
    const p = parseTok(e.n[i]), prev = active[i];
    if (!p) { endNote(prev, t); active[i] = null; continue; }
    if (p.x) { endNote(prev, t); active[i] = null; deadNote(t); continue; }
    let n;
    if (p.tie && prev) { n = prev; }                    // タイ：弾き直さずにのばす（音程はそのまま）
    else if (prev && LEGATO.test(prev.fl)) {            // ハンマリング・プリング・スライド：弾き直さず音程だけ変える
      n = prev; const target = n.rate * semi(S.tuning[i] + p.f + n.harm - n.midi);
      if (/[\/\\]$/.test(prev.fl)) {
        const ts = Math.max(prev.t + 0.01, t - Math.min(0.12, dur * 0.7));
        n.src.playbackRate.setValueAtTime(n.cur, ts); n.src.playbackRate.linearRampToValueAtTime(target, t);
      } else n.src.playbackRate.setValueAtTime(target, t);
      n.cur = n.fret = target;
    } else {
      endNote(prev, t);
      const harm = p.fl.includes('a') ? 19 : 0;         // ピッキングハーモニクス：1オクターブ＋5度上で鳴く
      n = pluck(S.tuning[i] + p.f + harm, t, harm ? 0.6 : 0.45); n.harm = harm;
      if (p.sin) {                                      // スライドイン：5半音下から滑り込む
        n.src.playbackRate.setValueAtTime(n.rate * semi(-5), t); n.src.playbackRate.linearRampToValueAtTime(n.rate, t + Math.min(0.12, dur * 0.5));
      }
    }
    n.t = t; n.fl = p.fl;
    const pr = n.src.playbackRate, fl = p.fl;
    let cur = n.cur, vibStart = t + 0.08;
    const bendUp = fl.includes('b') ? 2 : fl.includes('u') ? 1 : 0;
    if (bendUp) {                                       // チョーキング
      const te = t + Math.min(0.25, dur * 0.6), up = n.fret * semi(bendUp);
      pr.setValueAtTime(cur, t + 0.02); pr.linearRampToValueAtTime(up, te); cur = up; vibStart = te;
    }
    if (fl.includes('r')) {                             // 戻し（チョーキングなしならプリベンドから戻す）
      if (!bendUp && Math.abs(cur - n.fret) < 1e-6) { cur = n.fret * semi(2); pr.setValueAtTime(cur, t); }
      pr.setValueAtTime(cur, t + dur * 0.5); pr.linearRampToValueAtTime(n.fret, t + dur * 0.9); cur = n.fret;
    }
    if (fl.includes('w')) {                             // アームダウン：1オクターブ以上ぐーっと下げる
      pr.setValueAtTime(cur, t + dur * 0.12); pr.exponentialRampToValueAtTime(cur * semi(-15), t + dur * 0.95); cur *= semi(-15);
    }
    if (fl.includes('~')) {                             // ビブラート（チョーキング後は上がりきってから揺らす）
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 6; lg.gain.value = cur * (bendUp ? 0.02 : 0.015); lfo.connect(lg).connect(pr);
      lfo.start(vibStart); lfo.stop(t + Math.max(0.2, dur)); nodes.push({ src: lfo, g: lg });
    }
    n.cur = cur; active[i] = n;
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
