/* Calc engine — pure maths for the note page, no DOM.
   Loaded by the page as window.CalcEngine and by the Node tests via require().

   A line is calculated when it ends with "=". Words are allowed: the calculation is the
   longest run of maths at the end of the line, so "Hotel 3 nights (120+95)×2 =" works out (120+95)×2.
   A currency token just before "=" ("$→₹" or "₹→$") makes the line a conversion. */
(function (root) {
  'use strict';

  const SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const MATH_CHAR = /[0-9.,\s+\-−–*×/÷%()$₹]/;
  const CONV_AT_END = /(\$→₹|₹→\$)\s*$/;

  // Plain-digit string for a computed value, e.g. 0.30000000000000004 -> "0.3".
  function rawString(v) {
    const r = Number(v.toPrecision(14));
    let str = String(r);
    if (/e-/.test(str)) str = r.toFixed(20).replace(/\.?0+$/, '');
    return str;
  }

  // Tokens carry their position in the line (pos) and whether whitespace came before them (sp).
  function tokenize(str, base) {
    const out = [];
    let sp = false;
    for (let i = 0; i < str.length;) {
      const ch = str[i];
      if (/\s/.test(ch) || ch === '$' || ch === '₹') { sp = true; i++; continue; }
      const pos = base + i;
      if (/[0-9.,]/.test(ch)) {
        let j = i;
        while (j < str.length && /[0-9.,]/.test(str[j])) j++;
        const digits = str.slice(i, j).replace(/,/g, '');
        out.push(/^(\d+\.?\d*|\.\d+)$/.test(digits) ? { t: 'num', v: parseFloat(digits), pos, sp } : { t: 'bad', pos, sp });
        i = j;
      } else {
        if (ch === '+') out.push({ t: 'op', v: '+', pos, sp });
        else if (ch === '-' || ch === '−' || ch === '–') out.push({ t: 'op', v: '-', pos, sp });
        else if (ch === '*' || ch === '×') out.push({ t: 'op', v: '*', pos, sp });
        else if (ch === '/' || ch === '÷') out.push({ t: 'op', v: '/', pos, sp });
        else if (ch === '%' || ch === '(' || ch === ')') out.push({ t: ch, pos, sp });
        else out.push({ t: 'bad', pos, sp });
        i++;
      }
      sp = false;
    }
    return out;
  }

  // × and ÷ before + and −; a missing ")" at the end is fine; "2(3+4)" multiplies.
  // Percent follows iOS: "a + b%" = a + a×b/100, "a × b%" = a × b/100.
  function parse(tokens) {
    let p = 0;
    const isOp = (t, ...ops) => t && t.t === 'op' && ops.includes(t.v);

    function primary() {
      const t = tokens[p];
      if (!t) throw 0;
      if (t.t === 'num') { p++; return t.v; }
      if (t.t === '(') {
        p++;
        const v = add();
        if (tokens[p] && tokens[p].t === ')') p++;
        else if (p < tokens.length) throw 0;
        return v;
      }
      throw 0;
    }
    function postfix() {
      let v = primary(), pct = false;
      while (tokens[p] && tokens[p].t === '%') { p++; v /= 100; pct = true; }
      return { v, pct };
    }
    function unary() {
      const t = tokens[p];
      if (isOp(t, '+', '-')) {
        p++;
        const r = unary();
        return { v: t.v === '-' ? -r.v : r.v, pct: r.pct };
      }
      return postfix();
    }
    function mul() {
      const first = unary();
      let v = first.v, n = 1;
      for (;;) {
        const t = tokens[p];
        if (isOp(t, '*', '/')) { p++; const r = unary(); v = t.v === '*' ? v * r.v : v / r.v; n++; }
        else if (t && t.t === '(' && !t.sp) { v *= unary().v; n++; }
        else break;
      }
      return { v, pctOnly: n === 1 && first.pct };
    }
    function add() {
      let v = mul().v;
      while (isOp(tokens[p], '+', '-')) {
        const op = tokens[p++].v;
        const r = mul();
        const rv = r.pctOnly ? v * r.v : r.v;
        v = op === '+' ? v + rv : v - rv;
      }
      return v;
    }

    try {
      const v = add();
      return p === tokens.length ? v : null;
    } catch (e) {
      return null;
    }
  }

  const canStart = t => t.t === 'num' || t.t === '(' || (t.t === 'op' && (t.v === '+' || t.v === '-'));

  function evaluate(str) {
    return parse(tokenize(str, 0));
  }

  // → null, or { value, exprStart, exprEnd, eqIndex, conv: null | 'USD>INR' | 'INR>USD' }
  function analyzeLine(line) {
    const eq = /=\s*$/.exec(line);
    if (!eq) return null;
    let body = line.slice(0, eq.index);
    let conv = null;
    const c = CONV_AT_END.exec(body);
    if (c) {
      conv = c[1] === '$→₹' ? 'USD>INR' : 'INR>USD';
      body = body.slice(0, c.index);
    }
    let s = body.length;
    while (s > 0 && MATH_CHAR.test(body[s - 1])) s--;
    const tokens = tokenize(body.slice(s), s);
    for (let i = 0; i < tokens.length; i++) {
      if (!canStart(tokens[i])) continue;
      const value = parse(tokens.slice(i));
      if (value !== null) return { value, exprStart: tokens[i].pos, exprEnd: body.length, eqIndex: eq.index, conv };
    }
    return null;
  }

  // An operator pressed right after an answer continues the same line, adding brackets only when
  // needed: "50+25+60=" then × → "(50+25+60)×". Returns null for lines that can't continue.
  function continueLine(line, sym) {
    const a = analyzeLine(line);
    if (!a || a.conv) return null;
    let expr = line.slice(a.exprStart, a.exprEnd).replace(/\s+$/, '');
    let depth = 0, topAddSub = false, prev = null;
    for (const t of tokenize(expr, 0)) {
      if (t.t === '(') depth++;
      else if (t.t === ')') depth = Math.max(0, depth - 1);
      else if (t.t === 'op' && (t.v === '+' || t.v === '-') && depth === 0 && prev && (prev.t === 'num' || prev.t === ')' || prev.t === '%')) topAddSub = true;
      prev = t;
    }
    expr += ')'.repeat(depth);
    const wrap = topAddSub && (sym === '×' || sym === '÷');
    return line.slice(0, a.exprStart) + (wrap ? '(' + expr + ')' : expr) + sym;
  }

  // Version 1 kept a history of chained calculations; turn each into one line of the page.
  function migrateV1(history) {
    const tokText = t => (t.t === 'num' ? t.s.replace(/^-/, '−') + (t.pct ? '%' : '') : t.t === 'op' ? SYMBOL[t.v] : '');
    const out = [];
    for (const e of history.slice().sort((a, b) => a.ts - b.ts)) {
      try {
        if (e.type === 'fx' && typeof e.amount === 'number') {
          out.push(rawString(e.amount) + ' ' + (e.from === 'INR' ? '₹→$' : '$→₹') + '=');
          continue;
        }
        if (!Array.isArray(e.stages) || !e.stages.length) continue;
        let expr = e.stages[0].tokens.map(tokText).join('');
        for (const st of e.stages.slice(1)) {
          const op = st.tokens[1];
          if (!op || op.t !== 'op') continue;
          const cont = continueLine(expr + '=', SYMBOL[op.v]);
          expr = (cont != null ? cont : expr + SYMBOL[op.v]) + st.tokens.slice(2).map(tokText).join('');
        }
        out.push(expr + '=');
      } catch (err) {
        // skip anything malformed
      }
    }
    return out;
  }

  // Answers in the device's locale (grouping, decimal mark), with a true minus sign.
  function makeFormatter(locale) {
    const resFmt = new Intl.NumberFormat(locale, { maximumSignificantDigits: 14 });
    const decPart = new Intl.NumberFormat(locale).formatToParts(1.5).find(p => p.type === 'decimal');
    const dec = decPart ? decPart.value : '.';
    function result(n) {
      if (n == null || !isFinite(n)) return 'Error';
      const r = Number(n.toPrecision(14));
      if (r === 0) return '0';
      const a = Math.abs(r);
      if (a >= 1e15 || a < 1e-9) {
        const [m, e] = r.toExponential(8).split('e');
        return m.replace(/\.?0+$/, '').replace('.', dec).replace('-', '−') + 'e' + e.replace('+', '').replace('-', '−');
      }
      return resFmt.format(r).replace('-', '−');
    }
    return { result, decimal: dec };
  }

  const api = { SYMBOL, tokenize, parse, evaluate, analyzeLine, continueLine, migrateV1, makeFormatter, rawString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
