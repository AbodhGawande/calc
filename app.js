/* Tote — the note page: editor, keypad, answers, names. Maths: engine.js + units.js. Rates: rates.js.
   Share: share.js. The ⇄ sheet: convert.js. Help: help.js.

   The page is plain text (lines joined by "\n"). The editor shows one <div class="ln"> per line, split into
   plain text and styled pieces (names in blue, the → of a named line). Answers are NOT in the editor: they are
   tags in a separate layer, lined up on the right of each line, so the cursor can never sit beside one.
   Answers appear live as you type (slightly dimmed); "=" finishes a line. The page text starts large and
   shrinks as the page fills up. */
(function () {
  'use strict';

  const E = window.CalcEngine;
  const fmt = E.makeFormatter();
  const MIN = 60000;
  const OPS = '+−×÷-*/';
  const OPMAP = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const APP_VERSION = 21; // shown at the bottom of the help page; bump together with VERSION in sw.js
  const FS_MIN = 22, FS_MAX = 36; // page text size: starts at FS_MAX, never smaller than FS_MIN

  // ---------- storage ----------
  // localStorage is the only store. iOS may wipe it; sharing the page to Notes is the safety net.
  const K = { note: 'calc.note', settings: 'calc.settings', v1: 'calc.history' };
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Storage full — share the page as text and clear it'); }
  }

  const EXAMPLE_PAGE = [
    'Dinner with friends',
    '45 pizza + 18 drinks + 12 dessert = bill',
    'bill + 18% = total',
    'total ÷ 4 = each',
    '',
    'Road trip',
    '320 mi to km',
    '9 gal to L',
    '',
    'Rent in rupees',
    '1500 $ to ₹',
    '',
    'Workout this week',
    '3 × 45 min = gym',
    'gym min to hr',
    '',
    'Call with Mumbai',
    '5 pm cst to ist',
  ].join('\n');

  const $ = id => document.getElementById(id);
  const els = {
    app: $('app'), scroller: $('scroller'), note: $('note'), answers: $('answers'),
    keypad: $('keypad'), fxBar: $('fxBar'), vars: $('vars'), varChips: $('varChips'), menu: $('menu'), menuFull: $('menuFull'),
    nameBox: $('nameBox'), nbValue: $('nbValue'), nbInput: $('nbInput'), nbError: $('nbError'), nbRemove: $('nbRemove'),
    undo: $('undoBtn'), toast: $('toast'),
  };

  // ---------- state ----------
  const saved = load(K.note, null);
  let text = saved && typeof saved.text === 'string' ? saved.text : '';
  let updatedAt = (saved && saved.updatedAt) || 0;
  let notice = '';
  if (!saved) {
    // First launch after the update from version 1: move the old history onto the page.
    const v1 = load(K.v1, null);
    if (Array.isArray(v1) && v1.length) {
      text = E.migrateV1(v1).join('\n');
      updatedAt = Date.now();
      if (text) notice = 'Your earlier calculations are on the page';
    } else {
      // The very first launch: a worked example instead of an empty page.
      text = EXAMPLE_PAGE;
    }
  }
  const modern = E.modernizeNames(text); // older "→ name" / "=name" lines → "… = name" (or "200 var")
  if (modern !== text) { text = modern; updatedAt = Date.now(); notice = notice || 'Named lines now read “= name”'; }
  let sel = saved && Array.isArray(saved.sel) ? saved.sel.map(n => Math.max(0, Math.min(text.length, n | 0))) : [text.length, text.length];
  const settings = Object.assign({}, load(K.settings, {}));
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

  // Split a line into plain text and styled pieces: 'v' = a name in use, 'arrow' = the → of a named line,
  // 'def' = the name this line sets.
  function segmentsFor(line, info) {
    if (info.divider) return [{ text: line, cls: 'divider' }];
    const marks = info.names.map(([s, e]) => [s, e, 'v']);
    for (const [s, e] of info.notes || []) marks.push([s, e, 'def']); // "500 food": food becomes a name
    const d = info.defSyntax;
    if (d && line[d.eq] === '→') marks.push([d.eq, d.eq + 1, 'arrow']);
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
    page = E.evaluatePage(lines, { rates: window.Rates.rates(), now: new Date() });
    const note = els.note;
    let rebuilt = false, anyConv = false;
    if (![...note.childNodes].every(n => n.nodeName === 'DIV')) { note.textContent = ''; rebuilt = true; }
    while (note.childNodes.length > lines.length) { note.lastChild.remove(); rebuilt = true; }
    lines.forEach((line, i) => {
      let div = note.childNodes[i];
      if (!div) { div = document.createElement('div'); note.appendChild(div); }
      if (div.className !== 'ln') div.className = 'ln';
      const segs = segmentsFor(line, page.lines[i]);
      if (!lineMatches(div, segs)) { buildLine(div, segs); rebuilt = true; }
      if (page.lines[i].conv && page.lines[i].conv.currency) anyConv = true;
    });
    relayout();
    renderChips();
    window.Rates.renderBar(els.fxBar, anyConv);
    return rebuilt;
  }
  function refresh() { if (render()) applySel(); }
  function relayout() { fitFont(); layoutAnswers(); }

  // Page text starts large and steps down as lines get longer or more numerous, never below FS_MIN.
  // Widths scale with the font, so one measurement at FS_MAX tells us how far to shrink.
  let fontSize = 0, measurer = null;
  function fitFont() {
    const lines = text.split('\n');
    if (!measurer) measurer = document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(els.note).fontFamily;
    const regular = `${FS_MAX}px ${family}`, bold = `600 ${FS_MAX}px ${family}`;
    const measure = (s, font) => { measurer.font = font; return measurer.measureText(s).width; };
    const width = els.note.clientWidth - 40 - 24; // the page's side margins, and the gap + padding of an answer tag
    let k = 1;
    lines.forEach((line, i) => {
      if (!line) return;
      const info = page.lines[i];
      let w = measure(line, regular);
      if (info) {
        // Names are drawn bold, so they take more room.
        const strong = info.names.concat(info.notes || [], info.def ? [[info.def.start, info.def.end]] : []);
        for (const [s, e] of strong) w += measure(line.slice(s, e), bold) - measure(line.slice(s, e), regular);
        const ans = answerFor(info);
        if (ans) w += measure(ans.text, regular);
      }
      k = Math.min(k, width / (w * 1.02));
    });
    const height = els.scroller.clientHeight - 32; // the page's top and bottom margins
    k = Math.min(k, height / (Math.max(lines.length, 1) * FS_MAX * 1.5));
    const fs = Math.max(FS_MIN, Math.min(FS_MAX, Math.floor(FS_MAX * k)));
    if (fs !== fontSize) {
      fontSize = fs;
      els.scroller.style.setProperty('--fs', fs + 'px');
    }
  }

  // ---------- answers column ----------
  // How a line's value reads: "700", "31.07 mi", "₹9,500.00", "1:30 AM IST +1".
  function resultText(info) {
    const r = info.result;
    if (!r) return fmt.short(info.value);
    if (r.text) return r.text; // times, and feet as "5 ft 10.9 in"
    if (r.kind === 'money') return money(r.value, r.unit);
    return fmt.short(r.value) + ' ' + r.unit;
  }
  function answerFor(info) {
    switch (info.status) {
      case 'answer':
      case 'live':
        return { text: resultText(info), value: info.value, live: info.status === 'live' };
      case 'unknown':
        if (info.conv) return { text: '?', dim: true, why: 'Those two units don’t go together. Try km to mi, lb to kg, f to c…' };
        return { text: '?', dim: true, why: 'This line can’t be worked out. Check the brackets, and that its names are set on a line above.' };
      case 'error': return { text: 'Error', dim: true, why: 'Can’t divide by zero.' };
      case 'norate': return { text: '—', dim: true, why: 'No exchange rate yet. Go online once to download it.' };
      default: return null;
    }
  }

  function layoutAnswers() {
    const divs = els.note.childNodes, layer = els.answers;
    const placed = [];
    let n = 0;
    page.lines.forEach((info, i) => {
      const div = divs[i];
      if (!div || div.nodeType !== 1) return;
      const ans = answerFor(info);
      if (!ans) { if (div.style.paddingRight) div.style.paddingRight = ''; return; }
      let pill = layer.children[n++];
      if (!pill) { pill = document.createElement('button'); pill.type = 'button'; layer.appendChild(pill); }
      pill.className = 'ans' + (ans.dim ? ' dim' : '') + (ans.live ? ' live' : '') + (i === menuLine ? ' active' : '');
      if (pill.textContent !== ans.text) pill.textContent = ans.text;
      pill.dataset.line = i;
      placed.push({ div, pill });
    });
    while (layer.children.length > n) layer.lastChild.remove();
    // Measure the answers, make room for them on their lines, then line each up with its line's last row.
    const widths = placed.map(p => p.pill.offsetWidth);
    placed.forEach((p, k) => {
      const pr = widths[k] + 8 + 'px';
      if (p.div.style.paddingRight !== pr) p.div.style.paddingRight = pr;
    });
    placed.forEach(p => { p.pill.style.top = p.div.offsetTop + p.div.offsetHeight - p.pill.offsetHeight + 'px'; });
  }

  // Tap an answer: a small menu (Use / Name / Copy). A stray tap changes nothing.
  let menuLine = -1, menuValue = null;
  function openMenu(pill) {
    const i = +pill.dataset.line;
    const ans = answerFor(page.lines[i]);
    if (!ans || ans.dim || ans.value == null) return; // a time can't be used or named
    closeMenu();
    menuLine = i;
    menuValue = ans.value;
    pill.classList.add('active');
    const m = els.menu;
    // Answers show 2 decimals; the menu shows the full number when there's more to it.
    const full = fmt.result(ans.value);
    els.menuFull.textContent = full;
    els.menuFull.hidden = full === ans.text;
    m.hidden = false;
    const r = pill.getBoundingClientRect(), mr = m.getBoundingClientRect();
    let top = r.top - mr.height - 8;
    if (top < els.scroller.getBoundingClientRect().top + 4) top = r.bottom + 8;
    const left = Math.max(10, Math.min(r.right - mr.width, window.innerWidth - mr.width - 10));
    m.style.top = top + 'px';
    m.style.left = left + 'px';
  }
  function closeMenu() {
    if (els.menu.hidden) return;
    els.menu.hidden = true;
    const p = els.answers.querySelector('.ans.active');
    if (p) p.classList.remove('active');
    menuLine = -1;
  }
  els.answers.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest('.ans')) e.preventDefault(); });
  els.answers.addEventListener('click', e => {
    const pill = e.target.closest('.ans');
    if (!pill) return;
    if (pill.classList.contains('dim')) {
      const ans = answerFor(page.lines[+pill.dataset.line]);
      if (ans) toast(ans.why);
      return;
    }
    if (menuLine === +pill.dataset.line) { closeMenu(); return; }
    openMenu(pill);
  });
  els.menu.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') e.preventDefault(); });
  els.menu.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = menuLine, v = menuValue;
    closeMenu();
    if (b.dataset.act === 'use') insertToken(E.rawString(v));
    else if (b.dataset.act === 'name') openNameBox(i);
    else if (b.dataset.act === 'copy') copyValue(v);
  });
  document.addEventListener('pointerdown', e => {
    if (els.menu.hidden || els.menu.contains(e.target) || (e.target.closest && e.target.closest('.ans'))) return;
    closeMenu();
  }, true);
  els.scroller.addEventListener('scroll', closeMenu, { passive: true });

  function copyValue(v) {
    const done = () => toast('Copied ' + fmt.short(v));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(E.rawString(v)).then(done, () => toast('Couldn’t copy'));
    else toast('Couldn’t copy');
  }

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
    const box = els.scroller.getBoundingClientRect();
    if (rect.bottom > box.bottom - 12) els.scroller.scrollTop += rect.bottom - box.bottom + 24;
    else if (rect.top < box.top + 4) els.scroller.scrollTop -= box.top - rect.top + 8;
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
  // Caret sits at the end of a finished line ("…=" or "… → name").
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
  function operator(sym) {
    // After a finished line, + − × ÷ starts a new line that carries on from its answer ("×2" under "50+25=").
    if (afterAnswer()) { newLine(); insert(sym); return; }
    if (sel[0] === sel[1]) {
      const prev = text[sel[0] - 1];
      // Pressing another operator replaces the last one — except "−" after × or ÷ (a negative number).
      if (prev && OPS.includes(prev) && !(sym === '−' && (prev === '×' || prev === '÷'))) sel = [sel[0] - 1, sel[0]];
    }
    insert(sym);
  }

  function equals() {
    const { s, e, line } = lineAt(sel[1]);
    if (/=\s*$/.test(line) || E.defOf(line)) { sel = [e, e]; return; } // already finished: just finish editing
    const body = line.replace(/[\s+\-−×÷*/]+$/, '');
    // "500+200=" stays tight like a calculator; after a word, space it out: "500 food + 500 rent =".
    if (/[\d\p{L}]/u.test(body)) setLine(s, e, body + (/\p{L}$/u.test(body) ? ' =' : '='));
  }

  function backspace() {
    let [a, b] = sel;
    if (a === b) {
      if (a === 0) return;
      // The currency token and the " → " of a name each go in one step.
      const tail = text.slice(Math.max(0, a - 4), a);
      const m = /\s?(\$→₹|₹→\$)$/.exec(tail) || /\s?→\s?$/.exec(tail);
      a -= m ? m[0].length : 1;
    }
    sel = [a, b];
    insert('');
  }

  // The first edit of a new day, at the end of the page, gets a date line first ("— Fri, Sep 11, 2026"),
  // so an old page stays readable. Edits in the middle of the page don't.
  function dayDivider() {
    if (!text.trim() || sel[0] !== sel[1] || sel[1] < text.replace(/\s+$/, '').length) return;
    const today = new Date();
    if (updatedAt && new Date(updatedAt).toDateString() === today.toDateString()) return;
    const div = E.dividerFor(today);
    const lines = text.split('\n');
    if (lines.some(l => l === div)) return;
    text = text.replace(/\s+$/, '') + '\n\n' + div + '\n';
    sel = [text.length, text.length];
  }

  // The ⇄ sheet writes a finished conversion line ("10 lb to kg") on its own line at the cursor.
  function insertLine(str) {
    syncSel();
    dayDivider();
    const before = { text, sel: sel.slice() };
    const { s, e, line } = lineAt(sel[1]);
    if (line.trim()) { sel = [e, e]; insert('\n'); }
    else sel = [s, e];
    insert(str);
    pushUndo(before, 'key');
    changed();
    ensureFocus();
  }

  function press(k) {
    if (k === 'conv') { closeMenu(); syncSel(); window.ConvertSheet.open(); return; }
    closeMenu();
    syncSel();
    const before = { text, sel: sel.slice() };
    let kind = 'key';
    if (k !== 'back') dayDivider();
    if (/^[0-9]$/.test(k) || k === '00' || k === '.' || k === '(') {
      if (k !== '(') kind = 'type';
      if (afterAnswer()) newLine(); // a new number after an answer starts a new line, as on a calculator
      insert(k);
    } else if (k === ')' || k === '%') insert(k);
    else if (OPMAP[k]) operator(OPMAP[k]);
    else if (k === '=') equals();
    else if (k === 'back') { kind = 'back'; backspace(); }
    else if (k === 'enter') insert('\n');
    else return;
    const textChanged = text !== before.text;
    if (textChanged) pushUndo(before, kind);
    if (textChanged || sel[0] !== before.sel[0] || sel[1] !== before.sel[1]) changed(textChanged);
  }

  // Put a name or number at the cursor ("12" then rent → "12×rent"); on a finished line, start a new one.
  function insertToken(str) {
    syncSel();
    const before = { text, sel: sel.slice() };
    dayDivider();
    if (afterAnswer()) newLine();
    const prev = sel[0] === sel[1] ? text[sel[0] - 1] : '';
    if (prev && /[\p{L}\p{N}_)%.]/u.test(prev)) insert('×');
    insert(str);
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
  }

  // ---------- naming ----------
  let nameTarget = null;
  function openNameBox(idx) {
    const line = text.split('\n')[idx], info = page.lines[idx];
    if (line == null || !info) return;
    const value = info.value != null && isFinite(info.value) ? info.value : null; // the running total on multi-line sums
    if (value == null) { toast('Nothing to name on this line — type a number or a calculation first'); return; }
    const shown = resultText(info);
    const def = E.defOf(line);
    nameTarget = { idx, line };
    els.nbValue.textContent = shown;
    els.nbInput.value = def ? def.name : '';
    els.nbError.hidden = true;
    els.nbRemove.hidden = !def;
    els.nameBox.hidden = false;
    els.nbInput.focus(); // inside the tap, so the iPhone keyboard comes up for the name
    if (els.nbInput.value) els.nbInput.select();
  }
  function closeNameBox() {
    els.nameBox.hidden = true;
    els.nbInput.blur();
    nameTarget = null;
  }
  function saveName(name) {
    const t = nameTarget;
    if (!t) return;
    const lines = text.split('\n');
    if (lines[t.idx] !== t.line) { closeNameBox(); toast('That line changed — try again'); return; }
    const before = { text, sel: sel.slice() };
    lines[t.idx] = E.nameLine(t.line, name);
    text = lines.join('\n');
    const end = lines.slice(0, t.idx + 1).join('\n').length;
    sel = [end, end];
    pushUndo(before, 'key');
    closeNameBox();
    changed();
    ensureFocus();
    toast(name ? 'Named ' + name : 'Name removed');
  }
  function nameCaretLine() {
    closeMenu();
    syncSel();
    const lines = text.split('\n');
    let idx = lineIndexAt(sel[1]);
    while (idx > 0 && !lines[idx].trim()) idx--; // on a blank line, name the line above
    if (!lines[idx] || !lines[idx].trim()) { toast('Type a number or a calculation first'); return; }
    openNameBox(idx);
  }
  $('nbSave').addEventListener('click', () => {
    const name = els.nbInput.value.trim();
    if (!E.isValidName(name)) { els.nbError.hidden = false; return; }
    saveName(name);
  });
  els.nbInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('nbSave').click(); }
    else if (e.key === 'Escape') closeNameBox();
  });
  els.nbInput.addEventListener('input', () => { els.nbError.hidden = true; });
  els.nbRemove.addEventListener('click', () => saveName(''));
  $('nbCancel').addEventListener('click', () => { closeNameBox(); ensureFocus(); });
  els.nameBox.addEventListener('click', e => { if (e.target === els.nameBox) { closeNameBox(); ensureFocus(); } });

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
    closeMenu();
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
    closeMenu();
    const old = text;
    text = serialize(els.note);
    const s = readSel();
    if (s) sel = s;
    // A letter typed straight after a number or "=" gets a space before it: "700r" → "700 r", "=e" → "= e".
    const c = sel[0];
    if (sel[0] === sel[1] && text.length === old.length + 1 &&
        /\p{L}/u.test(text[c - 1] || '') && /[\d%)=]/.test(text[c - 2] || '')) {
      text = text.slice(0, c - 1) + ' ' + text.slice(c - 1);
      sel = [c + 1, c + 1];
      render();
      applySel();
    } else refresh();
    if (nativeBefore && nativeBefore.text !== text) pushUndo(nativeBefore, 'native');
    nativeBefore = null;
    updatedAt = Date.now();
    scheduleSave();
  }
  els.note.addEventListener('input', e => { if (!e.isComposing) afterNativeInput(); });
  els.note.addEventListener('compositionend', afterNativeInput);
  els.note.addEventListener('paste', e => {
    e.preventDefault();
    const t = E.stripAnswers((e.clipboardData && e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
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

  // ---------- chips above the keypad: → Name, then one chip per name ----------
  let chipSig = '';
  function renderChips() {
    const list = [...page.vars.values()].reverse(); // most recently set first
    const sig = JSON.stringify(list.map(v => [v.name, v.value]));
    if (sig === chipSig) return;
    chipSig = sig;
    els.varChips.textContent = '';
    for (const v of list) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.name = v.name;
      const n = document.createElement('span');
      n.className = 'chip-name';
      n.textContent = v.name;
      const val = document.createElement('span');
      val.className = 'chip-val';
      val.textContent = fmt.short(v.value);
      b.append(n, val);
      els.varChips.appendChild(b);
    }
  }
  els.vars.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest('.chip')) e.preventDefault(); });
  els.vars.addEventListener('click', e => {
    if (e.target.closest('#nameChip')) { nameCaretLine(); return; }
    const c = e.target.closest('.chip[data-name]');
    if (c) insertToken(c.dataset.name);
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

  // ---------- ABC: the iPhone keyboard for typing words ----------
  let switching = false;
  function setTextMode(on) {
    closeMenu();
    syncSel();
    if (on) {
      const before = { text, sel: sel.slice() };
      dayDivider();
      if (text !== before.text) { pushUndo(before, 'key'); changed(); }
    }
    textMode = on;
    els.app.classList.toggle('textmode', on);
    els.note.setAttribute('inputmode', on ? 'text' : 'none');
    switching = true;
    els.note.blur();
    els.note.focus({ preventScroll: true });
    applySel();
    switching = false;
    sizeApp();
    setTimeout(() => { sizeApp(); relayout(); revealCaret(); }, 350);
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
      relayout();
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
  window.addEventListener('resize', () => { sizeApp(); relayout(); closeMenu(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sizeApp);
    window.visualViewport.addEventListener('scroll', sizeApp);
  }

  // ---------- clear ----------
  // One tap clears the page, no confirmation: the toast undoes it, and so does ↶ until the app is closed.
  $('clearBtn').addEventListener('click', () => {
    if (!text) return;
    closeMenu();
    pushUndo({ text, sel: sel.slice() }, 'clear');
    text = '';
    sel = [0, 0];
    changed();
    toast('Page cleared', { label: 'Undo', run: undo });
  });

  // ---------- help ----------
  window.HelpSheet.init({ version: APP_VERSION, onOpen: closeMenu });

  // ---------- currency rates (rates.js) and share (share.js) ----------
  window.Rates.init({ onChange: refresh, toast });
  window.Share.init({
    text: () => text, page: () => page, segmentsFor, answerFor, resultText, toast, onOpen: closeMenu,
  });
  const money = window.Rates.money;

  window.ConvertSheet.init({
    rates: window.Rates.rates,
    rateAge: window.Rates.age,
    refreshRates: () => window.Rates.refresh({ force: true, quiet: false }),
    money, short: v => fmt.short(v), insertLine, toast,
    onClose: () => { sizeApp(); relayout(); ensureFocus(); },
  });
  els.fxBar.addEventListener('click', () => window.Rates.refresh({ force: true, quiet: false }));

  // ---------- toast ----------
  let toastTimer, toastAction = null;
  // action = { label, run }: adds a tappable word to the toast ("Page cleared  Undo").
  function toast(msg, action) {
    const t = els.toast;
    t.textContent = msg;
    toastAction = action || null;
    if (action) {
      const b = document.createElement('span');
      b.className = 'toast-act';
      b.textContent = action.label;
      t.appendChild(b);
    }
    t.classList.toggle('tappable', !!action);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 5000 : msg.length > 40 ? 3500 : 2000);
  }
  function hideToast() { els.toast.classList.remove('show'); toastAction = null; }
  els.toast.addEventListener('click', () => { if (toastAction) { const a = toastAction; hideToast(); a.run(); } });

  // ---------- start ----------
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow();
    else { window.Rates.refresh(); refresh(); if (!textMode) ensureFocus(); }
  });
  window.addEventListener('pagehide', saveNow);
  setInterval(() => { if (!document.hidden) refresh(); }, MIN); // keeps "updated N min ago" current

  sizeApp();
  render();
  ensureFocus(); // the cursor shows where typing will land, before the first key
  window.Rates.refresh(); // keep the saved rate fresh even when no line converts, so conversion works offline later
  if (notice) { saveNow(); toast(notice); }
  if (!saved) saveNow();

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
