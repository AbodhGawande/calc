/* The help page: a stack of small example cards drawn in the page's own style, one caption each.
   app.js calls HelpSheet.init({ version }) and HelpSheet.open(). */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // Each card: lines as they'd appear on the page ([[word]] = a name in blue), with the answer that shows
  // on the right ('~' before it = still being typed, dimmer), then one line of caption.
  const CARDS = [
    { cap: 'Just type. The answer appears as you go.',
      lines: [['45 + 18 + 12', '~75']] },
    { cap: '= finishes the line. The next number starts a new one.',
      lines: [['45 + 18 + 12=', '75'], ['9|', '']] },
    { cap: 'A word after a number names it.',
      lines: [['45 [[pizza]] + 18 [[drinks]]', '~63']] },
    { cap: 'A word after = names the total.',
      lines: [['45 [[pizza]] + 18 [[drinks]] = [[bill]]', '63']] },
    { cap: 'Use names on any line below. Chips above the keypad insert them.',
      lines: [['[[bill]] + 18% = [[total]]', '74.34'], ['[[total]] ÷ 4', '~18.59']], chips: ['total', 'bill', 'drinks', 'pizza'] },
    { cap: 'Start a line with + − × ÷ to keep going. The total shows on the last line.',
      lines: [['320 [[flight]]', ''], ['+ 85 [[hotel]]', ''], ['+ 40 [[food]]', '~445']] },
    { cap: 'Convert by typing it. Or press ⇄ for a list.',
      lines: [['320 mi to km', '~514.99 km'], ['72 f to c', '~22.22 °C'], ['1500 $ to ₹', '~₹1,43,160.00'], ['5 pm cst to ist', '~3:30 AM IST +1']] },
    { cap: 'Tap an answer: Use puts it on your line, Copy sends it to other apps.',
      lines: [['45 + 18 + 12=', '75']], menu: true },
    { cap: 'Tap any number to change it. Everything below updates.',
      lines: [['4|5 + 18 + 12=', '75']] },
    { cap: 'Clear wipes the page (Undo brings it back). Share sends the page as text or a picture.',
      bar: true },
    { cap: 'Each new day gets a date line, so an old page stays readable.',
      lines: [['45 + 18 + 12=', '75'], ['', ''], ['— Fri, Sep 11, 2026', ''], ['320 mi to km', '~514.99 km']] },
  ];

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function lineEl(src) {
    const ln = el('div', 'hc-line');
    const txt = el('span', 'hc-text');
    // [[name]] → blue; | → the cursor
    const parts = src.split(/(\[\[[^\]]+\]\]|\|)/);
    for (const p of parts) {
      if (!p) continue;
      if (p === '|') txt.appendChild(el('span', 'hc-caret'));
      else if (p.startsWith('[[')) txt.appendChild(el('span', 'v', p.slice(2, -2)));
      else if (p.startsWith('— ')) txt.appendChild(el('span', 'divider', p));
      else txt.appendChild(document.createTextNode(p));
    }
    ln.appendChild(txt);
    return ln;
  }

  function card(c) {
    const box = el('div', 'hc');
    const page = el('div', 'hc-page');
    if (c.bar) {
      const bar = el('div', 'hc-bar');
      bar.append(el('span', 'hc-btn hc-btn-text', 'Clear'), el('span', 'hc-btn', '⤴'), el('span', 'hc-btn', '?'), el('span', 'hc-spacer'), el('span', 'hc-btn', '↶'));
      page.appendChild(bar);
    }
    for (const [src, ans] of c.lines || []) {
      const ln = lineEl(src);
      if (ans) {
        const live = ans.startsWith('~');
        ln.appendChild(el('span', 'hc-ans' + (live ? ' live' : ''), live ? ans.slice(1) : ans));
      }
      page.appendChild(ln);
    }
    if (c.menu) {
      const m = el('div', 'hc-menu');
      m.append(el('span', '', 'Use'), el('span', '', 'Name'), el('span', '', 'Copy'));
      page.appendChild(m);
    }
    if (c.chips) {
      const row = el('div', 'hc-chips');
      for (const n of c.chips) { const ch = el('span', 'hc-chip'); ch.appendChild(el('span', 'v', n)); row.appendChild(ch); }
      page.appendChild(row);
    }
    box.append(page, el('p', 'hc-cap', c.cap));
    return box;
  }

  let built = false, version = '';
  function build() {
    const body = $('helpBody');
    body.textContent = '';
    for (const c of CARDS) body.appendChild(card(c));
    body.appendChild(el('p', 'help-version', 'Tote · version ' + version));
  }
  function open() {
    if (!built) { build(); built = true; }
    const h = $('help');
    h.classList.add('open');
    h.inert = false;
    h.setAttribute('aria-hidden', 'false');
    $('helpBody').scrollTop = 0;
  }
  function close() {
    const h = $('help');
    h.classList.remove('open');
    h.inert = true;
    h.setAttribute('aria-hidden', 'true');
  }
  function init(o) {
    version = o.version;
    $('helpBtn').addEventListener('click', () => { if (o.onOpen) o.onOpen(); open(); });
    $('helpDone').addEventListener('click', close);
  }

  window.HelpSheet = { init, open, close };
})();
