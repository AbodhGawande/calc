/* Exchange rates: fetched from a keyless source, saved for offline use, shown on the rate line.
   app.js calls Rates.init({ onChange, toast }); everything else reads Rates.rates() / Rates.money(). */
(function () {
  'use strict';

  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const KEY = 'calc.fx';
  // Primary: ECB reference rates via Frankfurter. Fallback: ExchangeRate-API's open endpoint. Both keyless.
  const SOURCES = [
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

  let fx = null, busy = false, deps = {};
  try { fx = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { fx = null; }

  const rates = () => (fx ? fx.rates : null);
  const age = () => (fx ? Date.now() - fx.fetchedAt : null);
  function rate(from, to) {
    if (!fx || !fx.rates) return null;
    const a = fx.rates[from], b = fx.rates[to];
    return a > 0 && b > 0 ? b / a : null;
  }
  const moneyFmts = {};
  function money(v, cur) {
    const f = moneyFmts[cur] || (moneyFmts[cur] = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }));
    return f.format(v).replace('-', '−');
  }

  function freshness(ms) {
    const m = Math.floor(ms / MIN), h = Math.floor(ms / HOUR), d = Math.floor(ms / DAY);
    if (ms >= DAY) return `⚠ rate is ${d} day${d > 1 ? 's' : ''} old`;
    if (h >= 1) return `updated ${h} h ago`;
    if (m >= 1) return `updated ${m} min ago`;
    return 'updated just now';
  }

  // The small rate line above the keypad, shown while a currency line is on the page.
  function renderBar(el, show) {
    el.hidden = !show;
    if (!show) return;
    const r = rate('USD', 'INR');
    let txt, stale = false;
    if (r == null) {
      txt = busy ? 'Fetching the exchange rate…' : 'No exchange rate yet — go online once';
      stale = !busy;
    } else {
      const ms = age();
      stale = ms >= DAY;
      txt = `1 USD = ${money(r, 'INR')} · ${busy ? 'updating…' : freshness(ms)}`;
    }
    el.textContent = txt;
    el.classList.toggle('stale', stale);
  }

  async function refresh({ force = false, quiet = true } = {}) {
    if (busy) return;
    if (!force && fx && Date.now() - fx.fetchedAt < HOUR) return;
    busy = true;
    deps.onChange();
    let ok = false;
    for (const src of SOURCES) {
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
        try { localStorage.setItem(KEY, JSON.stringify(fx)); } catch (e) { /* keep it in memory */ }
        ok = true;
        break;
      } catch (e) {
        // offline or this source is down — try the next one
      }
    }
    busy = false;
    deps.onChange();
    if (!quiet) deps.toast(ok ? 'Rate updated' : 'Couldn’t reach the rate service — using the saved rate');
  }

  function init(d) {
    deps = d;
    window.addEventListener('online', () => refresh());
  }

  window.Rates = { init, rates, age, rate, money, renderBar, refresh, busy: () => busy };
})();
