/* The ⇄ sheet: a list of two-way conversions you can type into from either side, for when the keypad is up
   and you don't want to type "km to mi". Each row's + writes the conversion onto the page as a line.
   Maths comes from units.js. app.js calls ConvertSheet.init(deps) then ConvertSheet.open(). */
(function () {
  'use strict';

  const U = window.CalcUnits;
  const $ = id => document.getElementById(id);
  let deps = null;

  // Rows: [unitA, unitB] pairs; 'ftin' = feet + inches on the left; 'money' and 'time' have pickers.
  const SECTIONS = [
    ['Weight', [['lb', 'kg'], ['oz', 'g'], ['st', 'kg']]],
    ['Length', [['ftin', 'cm'], ['ftin', 'm'], ['in', 'cm'], ['yd', 'm'], ['mi', 'km']]],
    ['Speed', [['mph', 'km/h']]],
    ['Volume', [['gal', 'L'], ['fl oz', 'ml'], ['cup', 'ml'], ['tbsp', 'ml'], ['tsp', 'ml']]],
    ['Temperature', [['°F', '°C']]],
    ['Area', [['sq ft', 'sq m'], ['acre', 'ha'], ['acre', 'sq ft']]],
    ['Fuel', [['mpg', 'km/L']]],
    ['Currency', [['money']]],
    ['Time zones', [['time']]],
  ];
  const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'SGD', 'AED', 'CHF', 'CNY'];
  const SYMBOL = { USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥' };

  const K = 'calc.convsheet';
  let prefs = { cur: ['USD', 'INR'], zone: ['America/Chicago', 'Asia/Kolkata'] };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(K) || '{}')); } catch (e) { /* defaults */ }
  const savePrefs = () => { try { localStorage.setItem(K, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const numInput = (cls = '') => {
    const i = el('input', 'c-in ' + cls);
    i.type = 'text'; i.inputMode = 'decimal'; i.placeholder = '0'; i.autocomplete = 'off';
    return i;
  };
  const parseNum = s => { const v = parseFloat(String(s).replace(/,/g, '').replace('−', '-')); return isFinite(v) ? v : null; };
  const show = v => (v == null ? '' : deps.short(v));
  const label = u => (U.CATEGORIES.currency.units[u] ? u : u);

  // Build one line of page text for a row, from the side that was typed in.
  const lineFor = (amt, from, to) => `${deps.short(amt).replace(/,/g, '')} ${from} to ${to}`;

  function pairRow(a, b) {
    const row = el('div', 'c-row');
    const ia = numInput(), ib = numInput();
    const sideA = el('div', 'c-side'), sideB = el('div', 'c-side');
    sideA.append(ia, el('span', 'c-unit', a));
    sideB.append(ib, el('span', 'c-unit', b));
    const add = el('button', 'c-add', '+');
    row.append(sideA, el('span', 'c-arrow', '⇄'), sideB, add);
    let last = 'a';
    ia.addEventListener('input', () => { last = 'a'; const v = parseNum(ia.value); const r = v == null ? null : U.convert([[v, a]], b); ib.value = r ? show(r.value) : ''; });
    ib.addEventListener('input', () => { last = 'b'; const v = parseNum(ib.value); const r = v == null ? null : U.convert([[v, b]], a); ia.value = r ? show(r.value) : ''; });
    add.addEventListener('click', () => {
      const src = last === 'a' ? [ia, a, b] : [ib, b, a];
      const v = parseNum(src[0].value);
      if (v == null) { deps.toast('Type a number first'); return; }
      deps.insertLine(lineFor(v, src[1], src[2]));
      close();
    });
    return row;
  }

  function ftinRow(b) {
    const row = el('div', 'c-row');
    const ift = numInput('narrow'), iin = numInput('narrow'), icm = numInput();
    const sideA = el('div', 'c-side'), sideB = el('div', 'c-side');
    sideA.append(ift, el('span', 'c-unit', 'ft'), iin, el('span', 'c-unit', 'in'));
    sideB.append(icm, el('span', 'c-unit', b));
    const add = el('button', 'c-add', '+');
    row.append(sideA, el('span', 'c-arrow', '⇄'), sideB, add);
    let last = 'a';
    const fromFtIn = () => {
      last = 'a';
      const f = parseNum(ift.value) || 0, i = parseNum(iin.value) || 0;
      if (!ift.value && !iin.value) { icm.value = ''; return; }
      const r = U.convert([[f, 'ft'], [i, 'in']], b);
      icm.value = r ? show(r.value) : '';
    };
    ift.addEventListener('input', fromFtIn);
    iin.addEventListener('input', fromFtIn);
    icm.addEventListener('input', () => {
      last = 'b';
      const v = parseNum(icm.value);
      if (v == null) { ift.value = iin.value = ''; return; }
      const totalIn = U.convert([[v, b]], 'in').value;
      const f = Math.floor(totalIn / 12), i = totalIn - f * 12;
      ift.value = String(f);
      iin.value = show(Math.round(i * 100) / 100);
    });
    add.addEventListener('click', () => {
      if (last === 'a') {
        const f = parseNum(ift.value) || 0, i = parseNum(iin.value) || 0;
        if (!ift.value && !iin.value) { deps.toast('Type a number first'); return; }
        deps.insertLine(`${f} ft ${i} in to ${b}`);
      } else {
        const v = parseNum(icm.value);
        if (v == null) { deps.toast('Type a number first'); return; }
        deps.insertLine(lineFor(v, b, 'ft'));
      }
      close();
    });
    return row;
  }

  function select(options, value, cls = 'c-sel') {
    const s = el('select', cls);
    for (const [v, text] of options) { const o = el('option', '', text); o.value = v; s.appendChild(o); }
    s.value = value;
    return s;
  }

  let rateNote = null;
  function moneyRow() {
    const row = el('div', 'c-row');
    const ia = numInput(), ib = numInput();
    const sa = select(CURRENCIES.map(c => [c, c]), prefs.cur[0]), sb = select(CURRENCIES.map(c => [c, c]), prefs.cur[1]);
    const sideA = el('div', 'c-side'), sideB = el('div', 'c-side');
    sideA.append(ia, sa);
    sideB.append(ib, sb);
    const add = el('button', 'c-add', '+');
    row.append(sideA, el('span', 'c-arrow', '⇄'), sideB, add);
    let last = 'a';
    const ctx = () => ({ rates: deps.rates() });
    const recalc = () => {
      const [from, to, src, dst] = last === 'a' ? [sa.value, sb.value, ia, ib] : [sb.value, sa.value, ib, ia];
      const v = parseNum(src.value);
      const r = v == null ? null : U.convert([[v, from]], to, ctx());
      dst.value = r ? show(r.value) : '';
      updateRateNote();
    };
    ia.addEventListener('input', () => { last = 'a'; recalc(); });
    ib.addEventListener('input', () => { last = 'b'; recalc(); });
    const onSel = () => { prefs.cur = [sa.value, sb.value]; savePrefs(); recalc(); };
    sa.addEventListener('change', onSel);
    sb.addEventListener('change', onSel);
    add.addEventListener('click', () => {
      const [from, to, src] = last === 'a' ? [sa.value, sb.value, ia] : [sb.value, sa.value, ib];
      const v = parseNum(src.value);
      if (v == null) { deps.toast('Type a number first'); return; }
      deps.insertLine(`${deps.short(v).replace(/,/g, '')} ${SYMBOL[from] || from} to ${SYMBOL[to] || to}`);
      close();
    });
    rateNote = el('button', 'c-note');
    rateNote.addEventListener('click', () => deps.refreshRates());
    const wrap = el('div');
    wrap.append(row, rateNote);
    updateRateNote(sa, sb);
    row._sel = [sa, sb];
    return wrap;
  }
  function updateRateNote() {
    if (!rateNote) return;
    const rates = deps.rates(), [a, b] = prefs.cur;
    if (!rates || !(rates[a] > 0) || !(rates[b] > 0)) { rateNote.textContent = 'No exchange rate yet — go online once, then tap to refresh'; rateNote.classList.add('stale'); return; }
    const age = deps.rateAge() || 0, d = Math.floor(age / 86400000), h = Math.floor(age / 3600000);
    const when = d >= 1 ? `${d} day${d > 1 ? 's' : ''} old` : h >= 1 ? `${h} h ago` : 'just now';
    rateNote.textContent = `1 ${a} = ${deps.money(rates[b] / rates[a], b)} · ${when} · tap to refresh`;
    rateNote.classList.toggle('stale', d >= 1);
  }

  function timeRow() {
    const row = el('div', 'c-row');
    const zones = U.ZONES.map(([zone, lbl]) => [zone, lbl]);
    const ta = el('input', 'c-in'), tb = el('input', 'c-in');
    ta.type = tb.type = 'time';
    const sa = select(zones, prefs.zone[0]), sb = select(zones, prefs.zone[1]);
    const shiftA = el('span', 'c-shift'), shiftB = el('span', 'c-shift');
    const sideA = el('div', 'c-side'), sideB = el('div', 'c-side');
    sideA.append(ta, sa, shiftA);
    sideB.append(tb, sb, shiftB);
    const add = el('button', 'c-add', '+');
    row.append(sideA, el('span', 'c-arrow', '⇄'), sideB, add);
    let last = 'a';
    const zoneOf = s => { const z = U.ZONES.find(x => x[0] === s.value); return { zone: z[0], label: z[1] }; };
    const recalc = () => {
      const [src, dst, zs, zd, shift] = last === 'a' ? [ta, tb, sa, sb, shiftB] : [tb, ta, sb, sa, shiftA];
      (last === 'a' ? shiftA : shiftB).textContent = '';
      const m = /^(\d{2}):(\d{2})/.exec(src.value);
      if (!m) { dst.value = ''; shift.textContent = ''; return; }
      const r = U.convertTime({ h: +m[1], mi: +m[2], from: zoneOf(zs), to: zoneOf(zd) }, { now: new Date() });
      dst.value = `${String(r.h).padStart(2, '0')}:${String(r.mi).padStart(2, '0')}`;
      shift.textContent = r.shift > 0 ? '+1' : r.shift < 0 ? '−1' : '';
    };
    ta.addEventListener('input', () => { last = 'a'; recalc(); });
    tb.addEventListener('input', () => { last = 'b'; recalc(); });
    const onSel = () => { prefs.zone = [sa.value, sb.value]; savePrefs(); recalc(); };
    sa.addEventListener('change', onSel);
    sb.addEventListener('change', onSel);
    add.addEventListener('click', () => {
      const [src, zs, zd] = last === 'a' ? [ta, sa, sb] : [tb, sb, sa];
      const m = /^(\d{2}):(\d{2})/.exec(src.value);
      if (!m) { deps.toast('Pick a time first'); return; }
      const h = +m[1], h12 = h % 12 || 12;
      deps.insertLine(`${h12}:${m[2]} ${h < 12 ? 'am' : 'pm'} ${zoneOf(zs).label} to ${zoneOf(zd).label}`);
      close();
    });
    return row;
  }

  function build() {
    const body = $('convBody');
    body.textContent = '';
    for (const [title, rows] of SECTIONS) {
      body.appendChild(el('div', 'c-title', title));
      for (const r of rows) {
        if (r[0] === 'ftin') body.appendChild(ftinRow(r[1]));
        else if (r[0] === 'money') body.appendChild(moneyRow());
        else if (r[0] === 'time') body.appendChild(timeRow());
        else body.appendChild(pairRow(r[0], r[1]));
      }
    }
    body.appendChild(el('p', 'c-note', 'Or just type on the page: 50 km to mi · 5 ft 10 in to cm · 72 f to c · 100 $ to ₹ · 3 pm cst to ist'));
  }

  let built = false;
  function open() {
    if (!built) { build(); built = true; }
    updateRateNote();
    const s = $('convSheet');
    s.classList.add('open');
    s.inert = false;
    s.setAttribute('aria-hidden', 'false');
  }
  function close() {
    const s = $('convSheet');
    if (!s.classList.contains('open')) return;
    if (document.activeElement && s.contains(document.activeElement)) document.activeElement.blur();
    s.classList.remove('open');
    s.inert = true;
    s.setAttribute('aria-hidden', 'true');
    if (deps.onClose) setTimeout(deps.onClose, 50);
  }

  function init(d) {
    deps = d;
    $('convDone').addEventListener('click', close);
  }

  window.ConvertSheet = { init, open, close, updateRateNote };
})();
