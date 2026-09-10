/* Calc engine — pure maths for the note page, no DOM.
   Loaded by the page as window.CalcEngine and by the Node tests via require().

   A line is calculated when it ends with "=". Words are allowed: the calculation is the
   longest run of maths at the end of the line, so "Hotel 3 nights (120+95)×2 =" works out (120+95)×2.
   A currency token just before "=" ("$→₹" or "₹→$") makes the line a conversion.
   "→ name" at the end names the line's value ("500+200 → rent", "200 → var"); lines below can use the name.
   The older "500+200=rent" form still works. */
(function (root) {
  'use strict';

  const SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const CONV_AT_END = /(\$→₹|₹→\$)\s*$/;
  const WORD_START = /[\p{L}_]/u;
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  const NAME_G = /[\p{L}_][\p{L}\p{N}_]*/gu;
  const NAME_ONLY = /^[\p{L}_][\p{L}\p{N}_]*$/u;
  const DEF_RE = /(?:=|→)\s*([\p{L}_][\p{L}\p{N}_]*)\s*$/u;
  const OLD_DEF = /\s*=\s*([\p{L}_][\p{L}\p{N}_]*)\s*$/u;

  // Plain-digit string for a computed value, e.g. 0.30000000000000004 -> "0.3".
  function rawString(v) {
    const r = Number(v.toPrecision(14));
    let str = String(r);
    if (/e-/.test(str)) str = r.toFixed(20).replace(/\.?0+$/, '');
    return str;
  }

  const isValidName = s => NAME_ONLY.test(s);

  // Tokens carry their position in the line (pos) and whether whitespace came before them (sp).
  // A word that is a known name becomes a number; any other word is a label ('bad').
  function tokenize(str, base, vars) {
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
      } else if (WORD_START.test(ch)) {
        let j = i + 1;
        while (j < str.length && WORD_CHAR.test(str[j])) j++;
        const known = vars && vars.get(str.slice(i, j).toLowerCase());
        out.push(known ? { t: 'num', v: known.value, isVar: true, pos, sp } : { t: 'bad', word: true, pos, sp });
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

  // × and ÷ before + and −; a missing ")" at the end is fine; "2(3+4)" and "2rent" multiply.
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
        else if (t && !t.sp && (t.t === '(' || t.isVar)) { v *= unary().v; n++; }
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

  function evaluate(str, vars) {
    return parse(tokenize(str, 0, vars));
  }

  // "… → name" (or the older "…=name") at the end of a line → { name, start, end, eq } (eq = index of → or =)
  function defOf(line) {
    const m = DEF_RE.exec(line);
    if (!m) return null;
    const start = m.index + m[0].indexOf(m[1], 1);
    return { name: m[1], start, end: start + m[1].length, eq: m.index };
  }

  // → null, or { value, exprStart, exprEnd, eqIndex, conv: null | 'USD>INR' | 'INR>USD', def, simple }
  // simple = the calculation is just one plain number (it needs no answer shown).
  function analyzeLine(line, vars) {
    const def = defOf(line);
    let eqIndex;
    if (def) eqIndex = def.eq;
    else {
      const eq = /=\s*$/.exec(line);
      if (!eq) return null;
      eqIndex = eq.index;
    }
    let body = line.slice(0, eqIndex);
    let conv = null;
    const c = CONV_AT_END.exec(body);
    if (c) {
      conv = c[1] === '$→₹' ? 'USD>INR' : 'INR>USD';
      body = body.slice(0, c.index);
    }
    const tokens = tokenize(body, 0, vars);
    for (let i = 0; i < tokens.length; i++) {
      if (!canStart(tokens[i])) continue;
      // Never start part-way through a calculation: "Hotel×12=" has no answer rather than a wrong 12.
      // Nor right up against an unknown word: "rent+5=" (no rent yet) has no answer rather than 5.
      // Nor at a "+"/"−" that follows a number: that sign is part of the calculation, not a fresh start.
      const prev = tokens[i - 1], cur = tokens[i];
      if (prev && (prev.t === 'op' || prev.t === '(' || (prev.word && !cur.sp))) continue;
      if (prev && cur.t === 'op' && (prev.t === 'num' || prev.t === ')' || prev.t === '%')) continue;
      const used = tokens.slice(i);
      const value = parse(used);
      if (value !== null) {
        const simple = !conv && used.length === 1 && used[0].t === 'num' && !used[0].isVar;
        return { value, exprStart: tokens[i].pos, exprEnd: body.length, eqIndex, conv, def, simple };
      }
    }
    return null;
  }

  // The value a line would have if it were finished — lets "200" or "50+25" be named without typing "=".
  function openValue(line, vars) {
    if (/=\s*$/.test(line) || defOf(line)) return analyzeLine(line, vars);
    return analyzeLine(line.replace(/\s+$/, '') + '=', vars);
  }

  // Give a line a name (or take it away with name = ''): "500+200=" + rent → "500+200 → rent".
  function nameLine(line, name) {
    const def = defOf(line);
    const head = (def ? line.slice(0, def.eq) : line.replace(/\s*=\s*$/, '')).replace(/\s+$/, '');
    if (name) return head + ' → ' + name;
    return /^[\d.,]+$/.test(head.trim()) ? head : head + '='; // a plain number goes back to just the number
  }

  // Version 3 wrote names as "200=var"; show them the new way ("200 → var").
  function modernizeNames(text) {
    return text.split('\n').map(l => l.replace(OLD_DEF, ' → $1')).join('\n');
  }

  // Works down the page: each line can use names set on lines above it; setting a name again takes over below.
  // convert(value, conv) turns a conversion line's amount into the other currency (null if no rate).
  function evaluatePage(lines, convert) {
    const vars = new Map();
    const out = [];
    for (const line of lines) {
      const a = analyzeLine(line, vars);
      let value = a ? a.value : null;
      if (a && a.conv && value !== null && isFinite(value)) value = convert ? convert(value, a.conv) : null;
      const defSyntax = defOf(line);
      const names = []; // [start, end] of known names used on this line
      for (const m of line.matchAll(NAME_G)) {
        if (defSyntax && m.index === defSyntax.start) continue;
        if (vars.has(m[0].toLowerCase())) names.push([m.index, m.index + m[0].length]);
      }
      const defined = a && defSyntax && value !== null && isFinite(value) ? defSyntax : null;
      if (defined) vars.set(defSyntax.name.toLowerCase(), { name: defSyntax.name, value });
      const wantsAnswer = /=\s*$/.test(line) || !!defSyntax;
      out.push({ a, value, def: defined, defSyntax, names, wantsAnswer });
    }
    return { lines: out, vars };
  }

  // An operator pressed right after an answer continues the same line, adding brackets only when
  // needed: "50+25+60=" then × → "(50+25+60)×". Returns null for lines that can't continue.
  function continueLine(line, sym, vars) {
    const a = analyzeLine(line, vars);
    if (!a || a.conv || a.def) return null;
    let expr = line.slice(a.exprStart, a.exprEnd).replace(/\s+$/, '');
    let depth = 0, topAddSub = false, prev = null;
    for (const t of tokenize(expr, 0, vars)) {
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

  const api = {
    SYMBOL, tokenize, parse, evaluate, defOf, analyzeLine, openValue, nameLine, modernizeNames, isValidName,
    evaluatePage, continueLine, migrateV1, makeFormatter, rawString,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
