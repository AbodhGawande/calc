/* Calc engine — pure maths for the note page, no DOM.
   Loaded by the page as window.CalcEngine and by the Node tests via require().

   The rules, top to bottom:
   - Answers show as you type once a line (or a multi-line calculation) has two numbers and an operator.
     "=" finishes a line. A plain number on its own shows no answer.
   - Words are allowed. Words before the maths are a label ("Hotel (120+95)×2"); a word right after a number
     is a note about that number ("700 rent + 500 food" = 1,200). A word where a number is expected is a name.
   - A line that starts with + − × ÷ carries on from the line above; × and ÷ apply to that running total.
     A blank line, or a line that starts with a number or a word, begins a new calculation.
   - "$→₹" / "₹→$" just before the end converts the value. "→ name" at the end names it ("500+200 → rent");
     lines below can use the name. The older "500+200=rent" form still works.
   - While a line is unfinished, a "-" or "/" typed between digits with no spaces (2024-25, 10/9, 555-1234)
     is not treated as maths; press "=" to calculate it anyway. The keypad's − and ÷ always count. */
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
  const CONT_START = /^\s*[+\-−–×÷*/]/;
  const DATE_LIKE = /\d[-/]\d/;

  // Plain-digit string for a computed value, e.g. 0.30000000000000004 -> "0.3".
  function rawString(v) {
    const r = Number(v.toPrecision(14));
    let str = String(r);
    if (/e-/.test(str)) str = r.toFixed(20).replace(/\.?0+$/, '');
    return str;
  }

  const isValidName = s => NAME_ONLY.test(s);

  // Tokens carry their position in the line (pos, end) and whether whitespace came before them (sp).
  // A word that is a known name becomes a number (isVar); any other word is 'bad' (a label or a note).
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
        out.push(known ? { t: 'num', v: known.value, isVar: true, pos, end: base + j, sp } : { t: 'bad', word: true, pos, sp });
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

  // Words that follow a number are notes about it ("700 rent + 500 food"): leave them out of the maths.
  // A known name glued to a number still multiplies ("2rent").
  function dropNotes(tokens) {
    const out = [];
    let afterOperand = false;
    for (const t of tokens) {
      if ((t.word || t.isVar) && afterOperand && (t.sp || !t.isVar)) continue;
      out.push(t);
      afterOperand = t.t === 'num' || t.t === ')' || t.t === '%';
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
  const endsOperand = t => t.t === 'num' || t.t === ')' || t.t === '%';

  // True when the maths actually does something (an operator, a percent, or "2(3)"), not just a lone number.
  function isOperation(used) {
    for (let i = 1; i < used.length; i++) {
      const t = used[i];
      if (t.t === '%') return true;
      if (endsOperand(used[i - 1]) && (t.t === 'op' || t.t === '(' || t.isVar)) return true;
    }
    return false;
  }

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

  const isFinished = line => !!defOf(line) || /=\s*$/.test(line);

  // Work out one line. running = the total carried from the line above when this line continues it (cont).
  // → null, or { value, used, exprStart, exprEnd, eqIndex, conv, def, finished, simple, operation }
  function lineCalc(line, vars, running, cont) {
    const def = defOf(line);
    const finished = isFinished(line);
    let body = def ? line.slice(0, def.eq) : line.replace(/=\s*$/, '');
    let conv = null;
    const c = CONV_AT_END.exec(body);
    if (c) {
      conv = c[1] === '$→₹' ? 'USD>INR' : 'INR>USD';
      body = body.slice(0, c.index);
    }
    if (!finished && DATE_LIKE.test(body)) return null; // a date or phone number, until "=" says otherwise
    let tokens = dropNotes(tokenize(body, 0, vars));
    if (!finished) {
      // Still being typed: ignore a trailing operator or "(" so the answer doesn't blink out mid-sum.
      while (tokens.length && (tokens[tokens.length - 1].t === 'op' || tokens[tokens.length - 1].t === '(')) tokens.pop();
    }
    const base = { conv, def, finished, exprEnd: body.length, eqIndex: def ? def.eq : finished ? line.search(/=\s*$/) : -1 };

    if (cont) {
      const carried = running !== null && isFinite(running);
      if (!tokens.length) {
        // Just the operator so far ("+"): keep showing the total from above.
        return carried ? Object.assign(base, { value: running, used: [], exprStart: 0, simple: false, operation: true }) : null;
      }
      const used = carried ? [{ t: 'num', v: running, pos: 0, sp: false }].concat(tokens) : tokens;
      const value = parse(used);
      if (value === null) return null;
      return Object.assign(base, { value, used, exprStart: tokens[0].pos, simple: false, operation: true });
    }

    for (let i = 0; i < tokens.length; i++) {
      if (!canStart(tokens[i])) continue;
      // Never start part-way through a calculation: "Hotel×12=" has no answer rather than a wrong 12.
      // Nor right up against an unknown word: "rent+5=" (no rent yet) has no answer rather than 5.
      // Nor at a "+"/"−" that follows a number: that sign is part of the calculation, not a fresh start.
      const prev = tokens[i - 1], cur = tokens[i];
      if (prev && (prev.t === 'op' || prev.t === '(' || (prev.word && !cur.sp))) continue;
      if (prev && cur.t === 'op' && endsOperand(prev)) continue;
      const used = tokens.slice(i);
      const value = parse(used);
      if (value !== null) {
        const simple = !conv && used.length === 1 && used[0].t === 'num' && !used[0].isVar;
        return Object.assign(base, { value, used, exprStart: tokens[i].pos, simple, operation: !!conv || isOperation(used) });
      }
    }
    return null;
  }

  // A finished line on its own ("…=" or "… → name"); null for unfinished lines.
  function analyzeLine(line, vars) {
    return isFinished(line) ? lineCalc(line, vars, null, false) : null;
  }

  // The value a line has, finished or not — lets "200" or "50+25" be named without typing "=".
  function openValue(line, vars) {
    return lineCalc(line, vars, null, false);
  }

  // Does this line carry on from the one above? It starts with an operator and has a number or name after it
  // (or nothing yet). "- buy milk" is a list item, not a subtraction.
  function isContinuation(line, vars) {
    if (!CONT_START.test(line)) return false;
    const rest = line.replace(CONT_START, '');
    if (/\d/.test(rest)) return true;
    for (const m of rest.matchAll(NAME_G)) if (vars.has(m[0].toLowerCase())) return true;
    return !rest.replace(/[=\s]/g, '');
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

  // Works down the page. Each line gets:
  //   value   the line's value (the running total for multi-line calculations), converted if it converts
  //   status  what the answers column shows: 'answer' (finished), 'live' (still being typed — shown slightly dimmed),
  //           'unknown' (finished but can't be worked out), 'error' (e.g. ÷0), 'norate' (no exchange rate), or null
  //   names   [start, end] of the names used in its maths; def = the name it sets (if it worked)
  // convert(value, conv) turns an amount into the other currency (null if no rate).
  function evaluatePage(lines, convert) {
    const vars = new Map();
    const out = [];
    let running = null, blockOp = false;
    lines.forEach((line, i) => {
      const blank = !line.trim();
      const cont = !blank && i > 0 && !!lines[i - 1].trim() && isContinuation(line, vars);
      if (!cont) { running = null; blockOp = false; }
      const a = blank ? null : lineCalc(line, vars, running, cont);
      let value = a ? a.value : null;
      if (a && a.conv && value !== null && isFinite(value)) value = convert ? convert(value, a.conv) : null;
      if (a && a.operation) blockOp = true;
      running = value;
      const defSyntax = defOf(line);
      const names = a ? a.used.filter(t => t.isVar).map(t => [t.pos, t.end]) : [];
      const finished = !blank && isFinished(line);
      const defined = a && defSyntax && value !== null && isFinite(value) ? defSyntax : null;
      if (defined) vars.set(defSyntax.name.toLowerCase(), { name: defSyntax.name, value });
      out.push({ a, value, conv: a ? a.conv : null, def: defined, defSyntax, names, finished, wantsAnswer: finished, cont, blockOp });
    });
    out.forEach((o, i) => {
      o.last = !out[i + 1] || !out[i + 1].cont; // the last line of its calculation
      const a = o.a;
      if (o.finished) {
        if (!a) o.status = 'unknown';
        else if (!isFinite(a.value)) o.status = 'error';
        else if (a.conv && o.value == null) o.status = 'norate';
        else if (a.simple) o.status = null; // "200 → var" — the number is already there
        else o.status = 'answer';
      } else {
        o.status = o.last && o.blockOp && a && !a.simple && o.value != null && isFinite(o.value) ? 'live' : null;
      }
    });
    return { lines: out, vars };
  }

  // Used to turn version 1 history into lines: continue a line with brackets only when needed,
  // "50+25+60=" then × → "(50+25+60)×". Returns null for lines that can't continue.
  function continueLine(line, sym, vars) {
    const a = analyzeLine(line, vars);
    if (!a || a.conv || a.def) return null;
    let expr = line.slice(a.exprStart, a.exprEnd).replace(/\s+$/, '');
    let depth = 0, topAddSub = false, prev = null;
    for (const t of tokenize(expr, 0, vars)) {
      if (t.t === '(') depth++;
      else if (t.t === ')') depth = Math.max(0, depth - 1);
      else if (t.t === 'op' && (t.v === '+' || t.v === '-') && depth === 0 && prev && endsOperand(prev)) topAddSub = true;
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
