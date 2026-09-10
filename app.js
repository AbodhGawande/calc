/* Calc — the note page: editor, keypad, names, currency, backup. All maths lives in engine.js.

   The page is plain text (lines joined by "\n"). The editor shows one <div class="ln"> per line, split into
   plain text and styled pieces: names (blue), the "=" whose answer CSS draws after it (::after from data-r),
   and a name being set. Answers are never part of the text. */
(function () {
  'use strict';

  const E = window.CalcEngine;
  const fmt = E.makeFormatter();
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const OPS = '+−×÷-*/';
  const OPMAP = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const CONV = /\$→₹|₹→\$/;

  // ---------- storage ----------
  // localStorage is the only store. iOS may wipe it, so Backup ▸ Export is the safety net.
  const K = { note: 'calc.note', settings: 'calc.settings', fx: 'calc.fx', backup: 'calc.backup', v1: 'calc.history' };
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Storage full — export a backup'); }
  }

  const $ = id => document.getElementById(id);
  const els = {
    app: $('app'), note: $('note'), placeholder: $('placeholder'), keypad: $('keypad'), fxBar: $('fxBar'), vars: $('vars'),
    undo: $('undoBtn'), dot: $('backupDot'), sheet: $('sheet'), backupLine: $('backupLine'), diag: $('diag'),
    file: $('importFile'), toast: $('toast'),
  };

  // ---------- state ----------
  const saved = load(K.note, null);
  let text = saved && typeof saved.text === 'string' ? saved.text : '';
  let updatedAt = (saved && saved.updatedAt) || 0;
  let migrated = false;
  if (!saved) {
    // First launch after the update from version 1: move the old history onto the page.
    const v1 = load(K.v1, null);
    if (Array.isArray(v1) && v1.length) {
      text = E.migrateV1(v1).join('\n');
      updatedAt = Date.now();
      migrated = !!text;
    }
  }
  let sel = saved && Array.isArray(saved.sel) ? saved.sel.map(n => Math.max(0, Math.min(text.length, n | 0))) : [text.length, text.length];
  const settings = Object.assign({ conv: '$→₹' }, load(K.settings, {}));
  let fx = load(K.fx, null);
  let backup = load(K.backup, null);
  let fxBusy = false;
  let textMode = false;
  let page = { lines: [], vars: new Map() }; // the latest E.evaluatePage result

  let saveTimer;
  function saveNow() { clearTimeout(saveTimer); save(K.note, { text, sel, updatedAt }); }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }

  // ---------- editor DOM ----------
  const BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|UL|OL|SECTION|ARTICLE)$/;

  // DOM → text. Copes with whatever the browser produced (divs, spans, <br>s, stray text nodes).
  function serialize(root) {
    const lines = [''];
    let needBreak = false, count = 0;
    const ensure = () => { if (needBreak) { lines.push(''); needBreak = false; } count++; };
    const visit = n => {
      if (n.nodeType === 3) {
        ensure();
        const parts = n.nodeValue.split('\n');
        lines[lines.length - 1] += parts[0];
        for (let i = 1; i < parts.length; i++) lines.push(parts[i]);
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.nodeName === 'BR') {
        ensure();
        const p = n.parentNode;
        const placeholder = p && p !== root && BLOCK.test(p.nodeName) && n === p.lastChild;
        if (!placeholder) needBreak = true;
        return;
      }
      if (!BLOCK.test(n.nodeName)) { n.childNodes.forEach(visit); return; }
      if (count) needBreak = true;
      const before = count;
      n.childNodes.forEach(visit);
      if (count === before) ensure(); // an empty block is an empty line
      needBreak = true;
    };
    root.childNodes.forEach(visit);
    return lines.join('\n');
  }

  function answerText(info) {
    const a = info.a;
    if (!a) return null;
    if (!isFinite(a.value)) return 'Error';
    if (a.conv) return info.value == null ? '—' : money(info.value, a.conv.split('>')[1]);
    return fmt.result(info.value);
  }

  // Split a line into plain text and styled pieces: 'v' = a name in use, 'eq' = the "=" that shows the answer,
  // 'def' = the name this line sets.
  function segmentsFor(line, info, ans) {
    const marks = info.names.map(([s, e]) => [s, e, 'v']);
    if (ans != null) marks.push([info.a.eqIndex, info.a.eqIndex + 1, 'eq']);
    if (info.def) marks.push([info.def.start, info.def.end, 'def']);
    marks.sort((x, y) => x[0] - y[0]);
    const segs = [];
    let p = 0;
    for (const [s, e, cls] of marks) {
      if (s > p) segs.push({ text: line.slice(p, s), cls: '' });
      segs.push({ text: line.slice(s, e), cls });
      p = e;
    }
    if (p < line.length) segs.push({ text: line.slice(p), cls: '' });
    return segs;
  }

  function lineMatches(div, segs) {
    const kids = div.childNodes;
    if (!segs.length) return kids.length === 1 && kids[0].nodeName === 'BR';
    if (kids.length !== segs.length) return false;
    return segs.every((sg, i) => {
      const n = kids[i];
      if (!sg.cls) return n.nodeType === 3 && n.nodeValue === sg.text;
      return n.nodeName === 'SPAN' && n.className === sg.cls && n.childNodes.length === 1 &&
        n.firstChild.nodeType === 3 && n.firstChild.nodeValue === sg.text;
    });
  }

  function buildLine(div, segs) {
    div.textContent = '';
    if (!segs.length) { div.appendChild(document.createElement('br')); return; }
    for (const sg of segs) {
      if (!sg.cls) { div.appendChild(document.createTextNode(sg.text)); continue; }
      const span = document.createElement('span');
      span.className = sg.cls;
      span.textContent = sg.text;
      div.appendChild(span);
    }
  }

  // text → DOM, touching only lines whose pieces changed. Returns true if any line was rebuilt.
  function render() {
    const lines = text.split('\n');
    page = E.evaluatePage(lines, convertAmount);
    const note = els.note;
    let rebuilt = false, anyConv = false;
    if (![...note.childNodes].every(n => n.nodeName === 'DIV')) { note.textContent = ''; rebuilt = true; }
    while (note.childNodes.length > lines.length) { note.lastChild.remove(); rebuilt = true; }
    lines.forEach((line, i) => {
      let div = note.childNodes[i];
      if (!div) { div = document.createElement('div'); note.appendChild(div); }
      if (div.className !== 'ln') div.className = 'ln';
      const info = page.lines[i], ans = answerText(info);
      const segs = segmentsFor(line, info, ans);
      if (!lineMatches(div, segs)) { buildLine(div, segs); rebuilt = true; }
      const eq = div.querySelector('.eq');
      if (eq && eq.getAttribute('data-r') !== ans) eq.setAttribute('data-r', ans);
      if (CONV.test(line)) anyConv = true;
    });
    els.placeholder.hidden = text !== '';
    renderChips();
    renderFx(anyConv);
    return rebuilt;
  }
  function refresh() { if (render()) applySel(); }

  // ---------- selection (as absolute offsets into text) ----------
  function absOffset(node, offset) {
    if (node === els.note) {
      const lines = text.split('\n');
      let p = 0;
      for (let i = 0; i < Math.min(offset, lines.length); i++) p += lines[i].length + 1;
      return Math.min(p, text.length);
    }
    const pre = document.createRange();
    pre.selectNodeContents(els.note);
    pre.setEnd(node, offset);
    return serialize(pre.cloneContents()).length;
  }
  function readSel() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!els.note.contains(r.startContainer) || !els.note.contains(r.endContainer)) return null;
    const a = absOffset(r.startContainer, r.startOffset);
    const b = r.collapsed ? a : absOffset(r.endContainer, r.endOffset);
    return [Math.min(a, text.length), Math.min(b, text.length)];
  }
  function syncSel() {
    if (document.activeElement !== els.note) return;
    const s = readSel();
    if (s) sel = s;
  }
  function domPos(abs) {
    const lines = text.split('\n');
    let i = 0, rem = abs;
    while (i < lines.length - 1 && rem > lines[i].length) { rem -= lines[i].length + 1; i++; }
    const div = els.note.childNodes[i];
    if (!div) return [els.note, els.note.childNodes.length];
    const parts = [];
    div.childNodes.forEach(n => {
      if (n.nodeType === 3) parts.push({ node: n, plain: true });
      else if (n.firstChild && n.firstChild.nodeType === 3) parts.push({ node: n.firstChild, plain: false });
    });
    if (!parts.length) return [div, 0];
    for (let k = 0; k < parts.length; k++) {
      const len = parts[k].node.nodeValue.length;
      if (rem < len) return [parts[k].node, rem];
      // On a boundary, stay in plain text; after a styled piece, move to the start of the next one.
      if (rem === len && (parts[k].plain || k === parts.length - 1)) return [parts[k].node, len];
      rem -= len;
      if (rem === 0) return [parts[k + 1].node, 0];
    }
    const last = parts[parts.length - 1].node;
    return [last, last.nodeValue.length];
  }
  function applySel() {
    if (document.activeElement !== els.note) return;
    const a = domPos(sel[0]), b = domPos(sel[1]);
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], b[1]);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function ensureFocus() {
    if (document.activeElement === els.note) return;
    els.note.focus({ preventScroll: true });
    applySel();
    revealCaret();
  }
  function revealCaret() {
    const div = els.note.childNodes[lineIndexAt(sel[1])];
    if (!div) return;
    let rect = null;
    const s = window.getSelection();
    if (document.activeElement === els.note && s.rangeCount) {
      const rects = s.getRangeAt(0).getClientRects();
      if (rects.length) rect = rects[rects.length - 1];
    }
    if (!rect) rect = div.getBoundingClientRect();
    const box = els.note.getBoundingClientRect();
    if (rect.bottom > box.bottom - 12) els.note.scrollTop += rect.bottom - box.bottom + 24;
    else if (rect.top < box.top + 4) els.note.scrollTop -= box.top - rect.top + 8;
  }

  // ---------- editing ----------
  const lineIndexAt = pos => text.slice(0, pos).split('\n').length - 1;
  function lineAt(pos) {
    const s = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
    let e = text.indexOf('\n', pos);
    if (e < 0) e = text.length;
    return { s, e, line: text.slice(s, e) };
  }
  function insert(str) {
    const [a, b] = sel;
    text = text.slice(0, a) + str + text.slice(b);
    sel = [a + str.length, a + str.length];
  }
  function setLine(s, e, line) {
    text = text.slice(0, s) + line + text.slice(e);
    sel = [s + line.length, s + line.length];
  }
  // Caret sits at the end of a line that already has its answer ("…=" or "…=name").
  function afterAnswer() {
    if (sel[0] !== sel[1]) return false;
    const { e, line } = lineAt(sel[1]);
    return text.slice(sel[1], e).trim() === '' && (/=\s*$/.test(line) || !!E.defOf(line));
  }
  function newLine() {
    const { e } = lineAt(sel[1]);
    sel = [e, e];
    insert('\n');
  }
  // Names set above a given line.
  const varsBefore = idx => E.evaluatePage(text.split('\n').slice(0, idx), convertAmount).vars;

  function operator(sym) {
    if (afterAnswer()) {
      const { s, e, line } = lineAt(sel[1]);
      const idx = lineIndexAt(sel[1]);
      const info = page.lines[idx];
      // A named answer: carry on from the name on a new line ("rent×").
      if (info && info.def) { newLine(); insert(info.def.name + sym); return; }
      const cont = E.continueLine(line, sym, varsBefore(idx));
      if (cont != null) { setLine(s, e, cont); return; }
      // A conversion: carry on from the converted amount on a new line.
      if (info && info.value != null && isFinite(info.value)) { newLine(); insert(E.rawString(info.value) + sym); return; }
    }
    if (sel[0] === sel[1]) {
      const prev = text[sel[0] - 1];
      // Pressing another operator replaces the last one — except "−" after × or ÷ (a negative number).
      if (prev && OPS.includes(prev) && !(sym === '−' && (prev === '×' || prev === '÷'))) sel = [sel[0] - 1, sel[0]];
    }
    insert(sym);
  }

  function equals() {
    const { s, e, line } = lineAt(sel[1]);
    if (/=\s*$/.test(line) || E.defOf(line)) { sel = [e, e]; return; } // already has its answer: finish editing
    const body = line.replace(/[\s+\-−×÷*/]+$/, '');
    if (/[\d\p{L}]/u.test(body)) setLine(s, e, body + '=');
  }

  function backspace() {
    let [a, b] = sel;
    if (a === b) {
      if (a === 0) return;
      const m = /\s?(\$→₹|₹→\$)$/.exec(text.slice(Math.max(0, a - 4), a)); // the currency token goes in one step
      a -= m ? m[0].length : 1;
    }
    sel = [a, b];
    insert('');
  }

  // $₹ key: make the caret's line a conversion, or flip the direction of one that already is.
  function convert() {
    const { s, e, line } = lineAt(sel[1]);
    const all = [...line.matchAll(/\$→₹|₹→\$/g)];
    const def = E.defOf(line);
    let next;
    if (all.length) {
      const m = all[all.length - 1];
      const flipped = m[0] === '$→₹' ? '₹→$' : '$→₹';
      next = line.slice(0, m.index) + flipped + line.slice(m.index + m[0].length);
      settings.conv = flipped;
    } else {
      const head = (def ? line.slice(0, def.eq) : line.replace(/\s*=\s*$/, '')).replace(/\s+$/, '');
      if (!/[\d\p{L}]/u.test(head)) { toast('Type an amount first'); return; }
      next = head + ' ' + settings.conv + (def ? line.slice(def.eq) : '=');
    }
    save(K.settings, settings);
    setLine(s, e, next);
    if (!fx) refreshFx();
  }

  function press(k) {
    syncSel();
    const before = { text, sel: sel.slice() };
    let kind = 'key';
    if (/^[0-9]$/.test(k) || k === '00' || k === '.' || k === '(') {
      if (k !== '(') kind = 'type';
      if (afterAnswer()) newLine(); // a new number after an answer starts a new line, as on a calculator
      insert(k);
    } else if (k === ')' || k === '%') insert(k);
    else if (OPMAP[k]) operator(OPMAP[k]);
    else if (k === '=') equals();
    else if (k === 'back') { kind = 'back'; backspace(); }
    else if (k === 'enter') insert('\n');
    else if (k === 'fx') convert();
    else return;
    const textChanged = text !== before.text;
    if (textChanged) pushUndo(before, kind);
    if (textChanged || sel[0] !== before.sel[0] || sel[1] !== before.sel[1]) changed(textChanged);
  }

  // Name chips: tapping one puts the name at the cursor ("12" then rent → "12×rent").
  function insertName(name) {
    syncSel();
    const before = { text, sel: sel.slice() };
    if (afterAnswer()) newLine();
    const prev = sel[0] === sel[1] ? text[sel[0] - 1] : '';
    if (prev && /[\p{L}\p{N}_)%.]/u.test(prev)) insert('×');
    insert(name);
    pushUndo(before, 'key');
    changed();
    ensureFocus();
  }

  function changed(textChanged = true) {
    if (textChanged) updatedAt = Date.now();
    render();
    applySel();
    revealCaret();
    scheduleSave();
    updateDot();
  }

  // ---------- undo ----------
  const undoStack = [];
  let lastKind = '', lastAt = 0;
  function pushUndo(state, kind) {
    const now = Date.now();
    const burst = kind === lastKind && (kind === 'type' || kind === 'back' || kind === 'native') && now - lastAt < 1500;
    lastKind = kind;
    lastAt = now;
    if (burst) return; // a run of typing undoes in one step
    undoStack.push(state);
    if (undoStack.length > 200) undoStack.shift();
    els.undo.classList.remove('off');
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return;
    text = s.text;
    sel = s.sel;
    lastKind = '';
    changed();
    els.undo.classList.toggle('off', !undoStack.length);
  }
  els.undo.addEventListener('click', undo);

  // ---------- typing with the iPhone keyboard (ABC), paste ----------
  let nativeBefore = null;
  els.note.addEventListener('beforeinput', e => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); return; }
    if (!nativeBefore) { syncSel(); nativeBefore = { text, sel: sel.slice() }; }
  });
  function afterNativeInput() {
    text = serialize(els.note);
    const s = readSel();
    if (s) sel = s;
    refresh();
    if (nativeBefore && nativeBefore.text !== text) pushUndo(nativeBefore, 'native');
    nativeBefore = null;
    updatedAt = Date.now();
    scheduleSave();
    updateDot();
  }
  els.note.addEventListener('input', e => { if (!e.isComposing) afterNativeInput(); });
  els.note.addEventListener('compositionend', afterNativeInput);
  els.note.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!t) return;
    syncSel();
    pushUndo({ text, sel: sel.slice() }, 'paste');
    insert(t);
    changed();
  });
  els.note.addEventListener('drop', e => e.preventDefault());
  document.addEventListener('selectionchange', () => {
    if (document.activeElement !== els.note) return;
    const s = readSel();
    if (s) { sel = s; scheduleSave(); }
  });

  // ---------- name chips ----------
  let chipSig = '';
  function renderChips() {
    const list = [...page.vars.values()];
    const sig = JSON.stringify(list.map(v => [v.name, v.value]));
    if (sig === chipSig) return;
    chipSig = sig;
    els.vars.hidden = !list.length;
    els.vars.textContent = '';
    for (const v of list) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.name = v.name;
      const n = document.createElement('span');
      n.className = 'chip-name';
      n.textContent = v.name;
      const val = document.createElement('span');
      val.className = 'chip-val';
      val.textContent = fmt.result(v.value);
      b.append(n, val);
      els.vars.appendChild(b);
    }
  }
  els.vars.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest('.chip')) e.preventDefault(); });
  els.vars.addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (c) insertName(c.dataset.name);
  });

  // ---------- keypad ----------
  const downKeys = new Map();
  let repeatTimer = null;
  function stopRepeat() { clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatTimer = null; }

  els.keypad.addEventListener('pointerdown', e => {
    const b = e.target.closest('.key');
    if (!b) return;
    e.preventDefault();
    b.classList.add('down');
    downKeys.set(e.pointerId, b);
    const k = b.dataset.key;
    if (k === 'abc') return;
    press(k);
    if (k === 'back') {
      stopRepeat();
      repeatTimer = setTimeout(() => { repeatTimer = setInterval(() => press('back'), 70); }, 450);
    }
  });
  function release(e) {
    const b = downKeys.get(e.pointerId);
    if (b) { b.classList.remove('down'); downKeys.delete(e.pointerId); }
    stopRepeat();
  }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  // Keep the cursor in the page while tapping keys. Focus changes need a completed tap on iPhone.
  els.keypad.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  els.keypad.addEventListener('touchend', e => afterKeyTap(e.target.closest && e.target.closest('.key')));
  els.keypad.addEventListener('click', e => afterKeyTap(e.target.closest('.key')));
  function afterKeyTap(b) {
    if (!b) return;
    if (b.dataset.key === 'abc') setTextMode(true);
    else ensureFocus();
  }

  // ---------- ABC: the iPhone keyboard for typing words and names ----------
  let switching = false;
  function setTextMode(on) {
    syncSel();
    textMode = on;
    els.app.classList.toggle('textmode', on);
    els.note.setAttribute('inputmode', on ? 'text' : 'none');
    switching = true;
    els.note.blur();
    els.note.focus({ preventScroll: true });
    applySel();
    switching = false;
    sizeApp();
    setTimeout(() => { sizeApp(); revealCaret(); }, 350);
  }
  els.note.addEventListener('blur', () => {
    if (!textMode || switching) return;
    // Keyboard dismissed: bring the keypad back.
    setTimeout(() => {
      if (!textMode || document.activeElement === els.note) return;
      textMode = false;
      els.app.classList.remove('textmode');
      els.note.setAttribute('inputmode', 'none');
      sizeApp();
    }, 50);
  });
  $('keypadBtn').addEventListener('click', () => setTextMode(false));

  // Fill the whole screen. On the iPhone Home Screen the page can report less than the full height,
  // which left a band under the keypad; while the keyboard is up, fit the space above it instead.
  function sizeApp() {
    let h = window.innerHeight, shift = 0;
    const vv = window.visualViewport;
    if (textMode && vv) {
      h = vv.height;
      shift = vv.offsetTop;
    } else if (navigator.standalone === true) {
      const portrait = window.innerHeight >= window.innerWidth;
      const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
      if (full > h) h = full;
    }
    document.documentElement.style.setProperty('--app-h', h + 'px');
    els.app.style.transform = shift ? `translateY(${shift}px)` : '';
  }
  window.addEventListener('resize', sizeApp);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sizeApp);
    window.visualViewport.addEventListener('scroll', sizeApp);
  }

  // ---------- clear ----------
  $('clearBtn').addEventListener('click', () => {
    if (!text) return;
    if (!confirm('Clear the whole page?\n\nYou can bring it back with Undo (↶) until you close the app.')) return;
    pushUndo({ text, sel: sel.slice() }, 'clear');
    text = '';
    sel = [0, 0];
    changed();
    toast('Page cleared');
  });

  // ---------- currency ----------
  // Primary: ECB reference rates via Frankfurter. Fallback: ExchangeRate-API's open endpoint. Both keyless.
  const FX_SOURCES = [
    {
      name: 'ECB (Frankfurter)',
      url: 'https://api.frankfurter.dev/v1/latest?base=USD',
      parse: j => (j && j.rates ? { rates: Object.assign({}, j.rates), date: j.date } : null),
    },
    {
      name: 'ExchangeRate-API',
      url: 'https://open.er-api.com/v6/latest/USD',
      parse: j => (j && j.result === 'success' && j.rates
        ? { rates: Object.assign({}, j.rates), date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) }
        : null),
    },
  ];

  function rate(from, to) {
    if (!fx || !fx.rates) return null;
    const a = fx.rates[from], b = fx.rates[to];
    return a > 0 && b > 0 ? b / a : null;
  }
  const round2 = v => Math.round(v * 100) / 100;
  function convertAmount(v, conv) {
    const [from, to] = conv.split('>');
    const r = rate(from, to);
    return r == null ? null : round2(v * r);
  }
  const moneyFmts = {};
  function money(v, cur) {
    const f = moneyFmts[cur] || (moneyFmts[cur] = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }));
    return f.format(v).replace('-', '−');
  }

  function freshness(age) {
    const m = Math.floor(age / MIN), h = Math.floor(age / HOUR), d = Math.floor(age / DAY);
    if (age >= DAY) return `⚠ rate is ${d} day${d > 1 ? 's' : ''} old`;
    if (h >= 1) return `updated ${h} h ago`;
    if (m >= 1) return `updated ${m} min ago`;
    return 'updated just now';
  }

  function renderFx(show) {
    els.fxBar.hidden = !show;
    if (!show) return;
    const r = rate('USD', 'INR');
    let txt, stale = false;
    if (r == null) {
      txt = fxBusy ? 'Fetching the exchange rate…' : 'No exchange rate yet — go online once';
      stale = !fxBusy;
    } else {
      const age = Date.now() - fx.fetchedAt;
      stale = age >= DAY;
      txt = `1 USD = ${money(r, 'INR')} · ${fxBusy ? 'updating…' : freshness(age)}`;
    }
    els.fxBar.textContent = txt;
    els.fxBar.classList.toggle('stale', stale);
  }

  async function refreshFx({ force = false, quiet = true } = {}) {
    if (fxBusy) return;
    if (!force && fx && Date.now() - fx.fetchedAt < HOUR) return;
    fxBusy = true;
    refresh();
    let ok = false;
    for (const src of FX_SOURCES) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(src.url, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) continue;
        const got = src.parse(await res.json());
        if (!got) continue;
        got.rates.USD = 1;
        if (!(got.rates.INR > 0)) continue;
        fx = { rates: got.rates, date: got.date, fetchedAt: Date.now(), source: src.name };
        save(K.fx, fx);
        ok = true;
        break;
      } catch (e) {
        // offline or this source is down — try the next one
      }
    }
    fxBusy = false;
    refresh();
    if (!quiet) toast(ok ? 'Rate updated' : 'Couldn’t reach the rate service — using the saved rate');
  }
  els.fxBar.addEventListener('click', () => refreshFx({ force: true, quiet: false }));

  // ---------- backup ----------
  function updateDot() {
    const overdue = !backup || Date.now() - backup.at > 14 * DAY;
    const unsaved = updatedAt > (backup ? backup.at : 0);
    els.dot.hidden = !(overdue && unsaved && text.split('\n').length >= 5);
  }
  function renderBackupLine() {
    const el = els.backupLine;
    if (!backup) el.textContent = text ? 'Never backed up' : 'Nothing to back up yet';
    else {
      const d = Math.floor((Date.now() - backup.at) / DAY);
      const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
      el.textContent = `Last backup ${when}` + (updatedAt > backup.at ? ' · page changed since' : '');
    }
    el.classList.toggle('warn', !els.dot.hidden);
    els.diag.textContent = `Screen ${screen.width}×${screen.height} · view ${window.innerWidth}×${window.innerHeight} · ` +
      `${navigator.standalone ? 'Home Screen app' : 'browser'} · version 3`;
  }
  function openSheet() {
    renderBackupLine();
    els.sheet.classList.add('open');
    els.sheet.inert = false;
    els.sheet.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    els.sheet.classList.remove('open');
    els.sheet.inert = true;
    els.sheet.setAttribute('aria-hidden', 'true');
  }
  $('backupBtn').addEventListener('click', openSheet);
  $('sheetDone').addEventListener('click', closeSheet);
  els.sheet.addEventListener('click', e => { if (e.target === els.sheet) closeSheet(); });

  async function exportPage() {
    const stamp = new Date().toISOString().slice(0, 10);
    const body = JSON.stringify({ app: 'calc', version: 2, exportedAt: new Date().toISOString(), text, settings, fx });
    // iOS share sheet ("Save to Files"). Some browsers won't share .json, so fall back to .txt, then to a download.
    const candidates = [
      new File([body], `calc-backup-${stamp}.json`, { type: 'application/json' }),
      new File([body], `calc-backup-${stamp}.txt`, { type: 'text/plain' }),
    ];
    try {
      const file = navigator.canShare && candidates.find(f => navigator.canShare({ files: [f] }));
      if (file) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(candidates[0]);
        a.download = candidates[0].name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      backup = { at: Date.now() };
      save(K.backup, backup);
      updateDot();
      renderBackupLine();
      toast('Backup exported');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Export failed');
    }
  }

  async function importPage(file) {
    try {
      const data = JSON.parse(await file.text());
      let incoming = '';
      if (data && typeof data.text === 'string') incoming = data.text;
      else if (data && Array.isArray(data.history)) incoming = E.migrateV1(data.history).join('\n'); // version 1 backup
      incoming = incoming.replace(/\s+$/, '');
      if (!incoming) { toast('That backup is empty'); return; }
      if (text.includes(incoming)) { toast('That backup is already on the page'); return; }
      pushUndo({ text, sel: sel.slice() }, 'import');
      text = text ? text.replace(/\n+$/, '') + '\n' + incoming : incoming;
      sel = [text.length, text.length];
      changed();
      closeSheet();
      toast('Backup added to the end of the page');
    } catch (e) {
      toast('That file isn’t a Calc backup');
    }
  }
  $('exportBtn').addEventListener('click', exportPage);
  $('importBtn').addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    if (f) importPage(f);
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2000);
  }

  // ---------- start ----------
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow();
    else { refreshFx(); refresh(); }
  });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('online', () => refreshFx());
  setInterval(() => { if (!document.hidden) refresh(); }, MIN); // keeps "updated N min ago" current

  sizeApp();
  render();
  updateDot();
  refreshFx(); // keep the saved rate fresh even when no line converts, so conversion works offline later
  if (migrated) { saveNow(); toast('Your earlier calculations are on the page'); }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    // When an update takes over, reload once so the new version shows straight away.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      saveNow();
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  window.__calc = { get text() { return text; }, get sel() { return sel; } }; // for debugging from the console
})();
