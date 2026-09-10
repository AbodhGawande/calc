/* Calc — UI layer: rendering, gestures, history, pin, currency, backup.
   All maths lives in engine.js. */
(function () {
  'use strict';

  const E = window.CalcEngine;
  const fmt = E.makeFormatter();
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const MAX_HISTORY = 5000;

  // ---------- storage ----------
  // localStorage is the only store. iOS may wipe it, so History ▸ Export is the safety net.
  const K = { state: 'calc.state', history: 'calc.history', pin: 'calc.pin', settings: 'calc.settings', fx: 'calc.fx', backup: 'calc.backup' };
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Storage full — export and clear history'); }
  }

  let state = E.restore(load(K.state, null));
  let history = load(K.history, []);
  if (!Array.isArray(history)) history = [];
  let pin = load(K.pin, null);
  if (!pin || typeof pin.value !== 'number') pin = null;
  const settings = Object.assign({ fxOn: false, from: 'USD', to: 'INR' }, load(K.settings, {}));
  let fx = load(K.fx, null);
  let backup = load(K.backup, null);
  let fxBusy = false;

  // ---------- dom ----------
  const $ = id => document.getElementById(id);
  const els = {
    screen: $('screen'), tape: $('tape'), big: $('big'), ac: $('acKey'), keypad: $('keypad'),
    fx: $('fx'), fxPair: $('fxPair'), fxAmount: $('fxAmount'), fxStatus: $('fxStatus'), fxKey: $('fxKey'),
    pin: $('pinChip'), histBtn: $('historyBtn'), dot: $('backupDot'),
    sheet: $('sheet'), hlist: $('hlist'), backupLine: $('backupLine'), file: $('importFile'), toast: $('toast'),
  };
  els.dotKey = $('dotKey');
  els.dotKey.textContent = fmt.decimal;

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function partsInto(el, parts) {
    for (const p of parts) el.appendChild(h('span', 'p-' + p.k, p.text));
  }

  // One tape/history line: "2 + 3 + 4 = 9". The result carries data-value so it can be tapped or pinned.
  function stageLine(tokens, result) {
    const row = h('div', 'line');
    const expr = h('span', 'expr');
    partsInto(expr, E.renderTokens(tokens, fmt, true));
    row.appendChild(expr);
    row.appendChild(h('span', 'eq', '='));
    const val = h('span', 'val', fmt.result(result));
    val.dataset.value = result;
    row.appendChild(val);
    return row;
  }

  // ---------- main render ----------
  function render() {
    const v = E.view(state, fmt);

    els.tape.textContent = '';
    for (const st of v.tape) els.tape.appendChild(stageLine(st.tokens, st.result));
    els.tape.scrollTop = els.tape.scrollHeight;

    els.big.textContent = '';
    partsInto(els.big, v.big);
    if (v.value != null) els.big.dataset.value = v.value;
    else delete els.big.dataset.value;
    fitBig();

    const back = v.acLabel !== 'AC';
    els.ac.classList.toggle('is-back', back);
    els.ac.setAttribute('aria-label', back ? 'Delete' : 'All clear');

    renderFx(v.value);
    renderPin();
    save(K.state, state);
  }

  // Shrink the big line to fit, like iOS; very long expressions keep their tail visible.
  function fitBig() {
    const el = els.big;
    const max = Math.min(88, Math.round(window.innerWidth * 0.21));
    el.style.fontSize = max + 'px';
    const avail = el.clientWidth, need = el.scrollWidth;
    if (need > avail) el.style.fontSize = Math.max(34, Math.floor((max * avail) / need)) + 'px';
    el.scrollLeft = el.scrollWidth;
  }

  // ---------- keypad ----------
  function press(k) {
    if (k === 'fx') { toggleFx(); return; }
    if (k === 'ac') k = els.ac.classList.contains('is-back') ? 'back' : 'clear';
    const ev = E.press(state, k);
    if (ev && ev.type === 'stage') saveChain(ev.chain);
    render();
  }

  const downKeys = new Map();
  els.keypad.addEventListener('pointerdown', e => {
    const b = e.target.closest('.key');
    if (!b) return;
    e.preventDefault();
    b.classList.add('down');
    downKeys.set(e.pointerId, b);
    press(b.dataset.key);
  });
  function release(e) {
    const b = downKeys.get(e.pointerId);
    if (b) { b.classList.remove('down'); downKeys.delete(e.pointerId); }
  }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  // Hardware keyboard (handy on iPad / desktop).
  const KEYBOARD = { Enter: '=', '=': '=', Backspace: 'back', Escape: 'clear', x: '*', X: '*', '*': '*', '/': '/', '+': '+', '-': '-', '%': '%', '.': '.', ',': '.' };
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (els.sheet.classList.contains('open')) { if (e.key === 'Escape') closeHistory(); return; }
    const k = /^[0-9]$/.test(e.key) ? e.key : KEYBOARD[e.key];
    if (!k) return;
    e.preventDefault();
    const b = els.keypad.querySelector(`[data-key="${k === 'back' || k === 'clear' ? 'ac' : k}"]`);
    if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 90); }
    const ev = E.press(state, k);
    if (ev && ev.type === 'stage') saveChain(ev.chain);
    render();
  });

  // ---------- gestures: tap, long-press (hold) and horizontal swipe ----------
  function gestures(container, handlers) {
    let g = null;
    container.addEventListener('pointerdown', e => {
      if (g) clearTimeout(g.timer);
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target, fired: false };
      const mine = g;
      if (handlers.hold) {
        g.timer = setTimeout(() => {
          if (g === mine && handlers.hold(mine.target) !== false) mine.fired = true;
        }, 500);
      }
    });
    container.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(g.timer);
      if (handlers.swipe && !g.fired && Math.abs(dx) > 40 && Math.abs(dy) < 30) { g.fired = true; handlers.swipe(); }
    });
    container.addEventListener('pointerup', e => {
      if (!g || e.pointerId !== g.id) return;
      clearTimeout(g.timer);
      const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10;
      if (!g.fired && !moved && handlers.tap) handlers.tap(g.target);
      g = null;
    });
    container.addEventListener('pointercancel', () => { if (g) clearTimeout(g.timer); g = null; });
  }

  const valueAt = t => {
    const el = t.closest && t.closest('[data-value]');
    return el ? { el, value: +el.dataset.value } : null;
  };

  // Display: tap a tape result to reuse it, hold any number to pin it, swipe to delete a digit (as on iOS).
  gestures(els.screen, {
    tap: t => { const hit = valueAt(t); if (hit && hit.el !== els.big) insertValue(hit.value); },
    hold: t => { const hit = valueAt(t); if (!hit) return false; setPin(hit.value); },
    swipe: () => press('back'),
  });

  function insertValue(v) {
    E.insert(state, v);
    render();
  }

  // ---------- pin ----------
  function setPin(v) {
    pin = { value: v };
    save(K.pin, pin);
    toast('Pinned ' + fmt.result(v));
    render();
  }
  function renderPin() {
    els.pin.hidden = !pin;
    if (pin) els.pin.querySelector('.pin-val').textContent = fmt.result(pin.value);
  }
  gestures(els.pin, {
    tap: () => { if (pin) insertValue(pin.value); },
    hold: () => { pin = null; save(K.pin, null); toast('Unpinned'); render(); },
  });

  // ---------- currency ----------
  // Primary: ECB reference rates via Frankfurter. Fallback: ExchangeRate-API open endpoint. Both keyless.
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

  function rate(from = settings.from, to = settings.to) {
    if (!fx || !fx.rates) return null;
    const a = fx.rates[from], b = fx.rates[to];
    return a > 0 && b > 0 ? b / a : null;
  }

  const moneyFmts = {};
  function money(v, cur) {
    const f = moneyFmts[cur] || (moneyFmts[cur] = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }));
    return f.format(v).replace('-', '−');
  }
  const round2 = v => Math.round(v * 100) / 100;

  // "1 USD = ₹95.44" — always quoted from the stronger currency so it never reads "$0.01".
  function rateText(from, to, r) {
    return r >= 1 ? `1 ${from} = ${money(r, to)}` : `1 ${to} = ${money(1 / r, from)}`;
  }

  function freshness(age) {
    const m = Math.floor(age / MIN), hr = Math.floor(age / HOUR), d = Math.floor(age / DAY);
    if (age >= DAY) return `⚠ rate is ${d} day${d > 1 ? 's' : ''} old`;
    if (hr >= 1) return `updated ${hr} h ago`;
    if (m >= 1) return `updated ${m} min ago`;
    return 'updated just now';
  }

  function renderFx(value) {
    els.fxKey.classList.toggle('on', settings.fxOn);
    els.fx.hidden = !settings.fxOn;
    if (!settings.fxOn) return;

    els.fxPair.innerHTML = `${settings.from} → ${settings.to} <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10l-3-3M13 11H3l3 3"/></svg>`;
    const r = rate();
    els.fxAmount.textContent = r != null && value != null ? '≈ ' + money(round2(value * r), settings.to) : '—';

    let text, stale = false;
    if (!fx || r == null) {
      text = fxBusy ? 'Fetching rate…' : 'No rate yet — go online once to download it';
      stale = !fxBusy;
    } else {
      const age = Date.now() - fx.fetchedAt;
      stale = age >= DAY;
      text = rateText(settings.from, settings.to, r) + ' · ' + (fxBusy ? 'updating…' : freshness(age));
    }
    els.fxStatus.textContent = text;
    els.fxStatus.classList.toggle('stale', stale);
  }

  async function refreshFx({ force = false, quiet = true } = {}) {
    if (fxBusy) return;
    if (!force && fx && Date.now() - fx.fetchedAt < HOUR) return;
    fxBusy = true;
    render();
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
        if (![settings.from, settings.to].every(c => got.rates[c] > 0)) continue;
        fx = { rates: got.rates, date: got.date, fetchedAt: Date.now(), source: src.name };
        save(K.fx, fx);
        ok = true;
        break;
      } catch (e) {
        // offline or this source is down — try the next one
      }
    }
    fxBusy = false;
    render();
    if (!quiet) toast(ok ? 'Rate updated' : 'Couldn’t reach the rate service — using saved rate');
  }

  function toggleFx() {
    settings.fxOn = !settings.fxOn;
    save(K.settings, settings);
    if (settings.fxOn) refreshFx();
    render();
  }

  function swapFx() {
    [settings.from, settings.to] = [settings.to, settings.from];
    save(K.settings, settings);
    render();
  }

  // Tap the converted amount: it becomes the main number, and the direction flips so the line converts back.
  function useConverted() {
    const value = E.view(state, fmt).value, r = rate();
    if (value == null || r == null) return;
    const result = round2(value * r);
    addEntry({ id: E.newId(), ts: Date.now(), type: 'fx', from: settings.from, to: settings.to, amount: value, result, rate: r });
    E.press(state, 'clear');
    E.insert(state, result);
    const now = settings.to;
    swapFx();
    toast('Now in ' + now);
  }

  els.fxPair.addEventListener('click', swapFx);
  els.fxAmount.addEventListener('click', useConverted);
  els.fxStatus.addEventListener('click', () => refreshFx({ force: true, quiet: false }));

  // ---------- history ----------
  function persistHistory() {
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    save(K.history, history);
    updateDot();
  }

  function saveChain(chain) {
    let i = history.length - 1;
    while (i >= 0 && history[i].id !== chain.id) i--;
    const entry = { id: chain.id, ts: i >= 0 ? history[i].ts : Date.now(), type: 'calc', stages: chain.stages };
    if (i >= 0) history[i] = entry;
    else history.push(entry);
    persistHistory();
  }

  function addEntry(entry) {
    history.push(entry);
    persistHistory();
  }

  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const dayFmtYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, new Date(now.getTime() - DAY))) return 'Yesterday';
    return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayFmtYear.format(d);
  }

  function entryEl(e) {
    const el = h('div', 'entry');
    el.dataset.id = e.id;
    if (e.type === 'fx') {
      const row = h('div', 'line final');
      row.appendChild(h('span', 'expr', money(e.amount, e.from)));
      row.appendChild(h('span', 'eq', '→'));
      const val = h('span', 'val', money(e.result, e.to));
      val.dataset.value = e.result;
      row.appendChild(val);
      el.appendChild(row);
      el.appendChild(h('div', 'meta', `${timeFmt.format(e.ts)} · ${rateText(e.from, e.to, e.rate)}`));
    } else {
      e.stages.forEach((st, i) => {
        const line = stageLine(st.tokens, st.result);
        if (i === e.stages.length - 1) line.classList.add('final');
        el.appendChild(line);
      });
      el.appendChild(h('div', 'meta', timeFmt.format(e.ts)));
    }
    return el;
  }

  let histLimit = 150;
  function renderHistory() {
    renderBackupLine();
    const list = els.hlist;
    list.textContent = '';
    if (!history.length) {
      list.appendChild(h('p', 'empty', 'No history yet.\nFinished calculations and conversions show up here.'));
      return;
    }
    let lastDay = '';
    for (const e of history.slice(-histLimit).reverse()) {
      const day = dayLabel(e.ts);
      if (day !== lastDay) { list.appendChild(h('h3', 'day', day)); lastDay = day; }
      list.appendChild(entryEl(e));
    }
    if (history.length > histLimit) {
      const more = h('button', 'more', `Show older (${history.length - histLimit} more)`);
      more.addEventListener('click', () => { histLimit += 300; renderHistory(); });
      list.appendChild(more);
    }
  }

  function openHistory() {
    histLimit = 150;
    renderHistory();
    els.hlist.scrollTop = 0;
    els.sheet.classList.add('open');
    els.sheet.inert = false;
    els.sheet.setAttribute('aria-hidden', 'false');
  }
  function closeHistory() {
    els.sheet.classList.remove('open');
    els.sheet.inert = true;
    els.sheet.setAttribute('aria-hidden', 'true');
  }

  gestures(els.hlist, {
    tap: t => { const hit = valueAt(t); if (hit) { insertValue(hit.value); closeHistory(); } },
    hold: t => {
      const hit = valueAt(t);
      if (hit) { setPin(hit.value); return; }
      const entry = t.closest && t.closest('.entry');
      if (!entry) return false;
      if (confirm('Delete this entry?')) {
        history = history.filter(e => e.id !== entry.dataset.id);
        persistHistory();
        renderHistory();
      }
    },
  });

  els.histBtn.addEventListener('click', openHistory);
  $('sheetDone').addEventListener('click', closeHistory);
  $('clearBtn').addEventListener('click', () => {
    if (!history.length) return;
    if (!confirm('Delete all history?\n\nIf you want to keep it, tap Cancel and Export a backup first.')) return;
    history = [];
    persistHistory();
    renderHistory();
  });

  // ---------- backup (export / import) ----------
  const newSinceBackup = () => history.filter(e => !backup || e.ts > backup.at).length;

  function updateDot() {
    const overdue = !backup || Date.now() - backup.at > 14 * DAY;
    els.dot.hidden = !(overdue && newSinceBackup() >= 10);
  }

  function renderBackupLine() {
    const n = newSinceBackup();
    const el = els.backupLine;
    if (!backup) {
      el.textContent = history.length ? `Never backed up · ${n} entr${n === 1 ? 'y' : 'ies'} only on this phone` : 'Export saves a backup copy to Files.';
    } else {
      const d = Math.floor((Date.now() - backup.at) / DAY);
      el.textContent = `Last backup ${d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'} · ${n} new since`;
    }
    el.classList.toggle('warn', !els.dot.hidden);
  }

  async function exportHistory() {
    const stamp = new Date().toISOString().slice(0, 10);
    const body = JSON.stringify({ app: 'calc', version: 1, exportedAt: new Date().toISOString(), history, pin, settings, fx });
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

  async function importHistory(file) {
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data && data.history;
      if (!Array.isArray(incoming)) throw new Error('not a backup');
      const have = new Set(history.map(e => e.id));
      const valid = e => e && typeof e.id === 'string' && typeof e.ts === 'number' && (
        (e.type === 'fx' && typeof e.amount === 'number' && typeof e.result === 'number' && typeof e.rate === 'number' && typeof e.from === 'string' && typeof e.to === 'string') ||
        (e.type === 'calc' && Array.isArray(e.stages) && e.stages.length && e.stages.every(E.validStage))
      );
      const add = incoming.filter(e => valid(e) && !have.has(e.id));
      history = history.concat(add).sort((a, b) => a.ts - b.ts);
      if (!pin && data.pin && typeof data.pin.value === 'number') { pin = data.pin; save(K.pin, pin); }
      persistHistory();
      renderHistory();
      render();
      toast(add.length ? `Imported ${add.length} entr${add.length === 1 ? 'y' : 'ies'}` : 'Nothing new to import');
    } catch (e) {
      toast('That file isn’t a Calc backup');
    }
  }

  $('exportBtn').addEventListener('click', exportHistory);
  $('importBtn').addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    if (f) importHistory(f);
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  // ---------- start ----------
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());
  window.addEventListener('resize', fitBig);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refreshFx(); render(); }
  });
  window.addEventListener('online', () => refreshFx());
  setInterval(() => { if (!document.hidden && settings.fxOn) renderFx(E.view(state, fmt).value); }, MIN);

  render();
  updateDot();
  refreshFx(); // keep the cached rate warm even while conversion is off, so it works offline later

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
