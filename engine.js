/* Calc engine — pure maths for the note page, no DOM.
   Loaded by the page as window.CalcEngine and by the Node tests via require().

   The rules, top to bottom:
   - Answers show as you type once a line (or a multi-line calculation) has two numbers and an operator.
     "=" finishes a line. A plain number on its own shows no answer.
   - Words are allowed. Words before the maths are a label ("Hotel (120+95)×2"); a word right after a number
     is left out of the maths ("700 rent + 500 food" = 1,200) and NAMES that number (rent = 700, food = 500),
     skipping small words ("500 for food" names food). A word after "=" names the result ("… = expense").
     Lines below can use the names; a name set again further down takes over from there.
   - A line that starts with + − × ÷ carries on from the line above; × and ÷ apply to that running total.
     A blank line, or a line that starts with a number or a word, begins a new calculation.
   - Conversions are typed as "50 km to mi", "5 ft 10 in to cm", "72 f to c", "100 $ to ₹", "3 pm cst to ist"
     (see units.js). The answer carries its unit and can be named or continued like any other.
     The old "$→₹" / "₹→$" token before "=" still converts. The older "→ name" form still works.
   - While a line is unfinished, a "-" or "/" typed between digits with no spaces (2024-25, 10/9, 555-1234)
     is not treated as maths; press "=" to calculate it anyway. The keypad's − and ÷ always count. */
(function (root) {
  'use strict';

  const U = typeof module !== 'undefined' && module.exports ? require('./units.js') : root.CalcUnits;
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
  // Small words that never become names: in "500 for food" the name is food.
  const SMALL_WORDS = new Set(['a', 'an', 'the', 'for', 'on', 'in', 'at', 'of', 'to', 'per', 'each', 'and', 'or',
    'from', 'with', 'by', 'as', 'is', 'x', 'my', 'our', 'into']);

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
        const text = str.slice(i, j);
        const known = vars && vars.get(text.toLowerCase());
        out.push(known ? { t: 'num', v: known.value, isVar: true, text, pos, end: base + j, sp } : { t: 'bad', word: true, text, pos, end: base + j, sp });
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

  // The names a line sets through its notes: the first real word after each plain number ("500 food" → food = 500).
  function noteNames(tokens) {
    const out = [];
    tokens.forEach((t, i) => {
      if (t.t !== 'num' || t.isVar) return;
      for (let j = i + 1; j < tokens.length && (tokens[j].word || tokens[j].isVar); j++) {
        const w = tokens[j];
        if (w.isVar && !w.sp) break; // "2rent" glued on is a multiplication, not a name
        if (SMALL_WORDS.has(w.text.toLowerCase())) continue;
        out.push({ name: w.text, value: t.v, pos: w.pos, end: w.end });
        break;
      }
    });
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

  // The operator a line ends with ("500 rent+" → '+'), or null. Only for unfinished lines.
  function trailingOp(line) {
    if (isFinished(line)) return null;
    const m = /([+\-−–×÷*/])\s*$/.exec(line);
    if (!m) return null;
    return { '+': '+', '-': '-', '−': '-', '–': '-', '×': '*', '*': '*', '÷': '/', '/': '/' }[m[1]];
  }

  // Work out one line. running = the total carried from the line above when this line continues it (cont);
  // leadOp = the operator the line above ended with, when that is what joins them ("500 rent+" / "200 food").
  // → null, or { value, used, exprStart, exprEnd, eqIndex, conv, def, finished, simple, operation }
  function lineCalc(line, vars, running, cont, leadOp) {
    const def = defOf(line);
    const finished = isFinished(line);
    let body = def ? line.slice(0, def.eq) : line.replace(/=\s*$/, '');
    let conv = null;
    const c = CONV_AT_END.exec(body);
    if (c) {
      // The old "$→₹" token: the maths before it is the amount (parts are filled in once it's worked out).
      conv = c[1] === '$→₹' ? { legacy: true, from: 'USD', to: 'INR', currency: true } : { legacy: true, from: 'INR', to: 'USD', currency: true };
      body = body.slice(0, c.index);
    }
    const base = { conv, def, finished, exprEnd: body.length, eqIndex: def ? def.eq : finished ? line.search(/=\s*$/) : -1 };

    // "50 km to mi", "3 pm cst to ist": a typed conversion is a line of its own.
    const tc = !conv && !cont ? U.parseConversion(body, vars) : null;
    if (tc) {
      const convInfo = Object.assign(tc, { currency: !tc.zone && U.isCurrency(tc.from) });
      const used = tc.isName ? [{ t: 'num', v: tc.parts[0][0], isVar: true, pos: tc.start, end: tc.start + tc.amtText.length, sp: false }] : [];
      return Object.assign(base, { conv: convInfo, value: tc.zone ? null : tc.parts[0][0], used, exprStart: tc.start, simple: false, operation: true });
    }
    if (!finished && DATE_LIKE.test(body)) return null; // a date or phone number, until "=" says otherwise
    let tokens = dropNotes(tokenize(body, 0, vars));
    if (!finished) {
      // Still being typed: ignore a trailing operator or "(" so the answer doesn't blink out mid-sum.
      while (tokens.length && (tokens[tokens.length - 1].t === 'op' || tokens[tokens.length - 1].t === '(')) tokens.pop();
    }
    if (cont) {
      const carried = running !== null && isFinite(running);
      if (leadOp && tokens.length && tokens[0].t !== 'op') tokens.unshift({ t: 'op', v: leadOp, pos: 0, sp: false });
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

  // Does this line carry on from the one above? Either it starts with an operator, or the line above ended
  // with one — and it has a number or name in it (or nothing yet). "- buy milk" is a list item, not a subtraction.
  function isContinuation(line, vars, prevEndsWithOp) {
    if (!CONT_START.test(line) && !prevEndsWithOp) return false;
    const rest = line.replace(CONT_START, '');
    if (/\d/.test(rest)) return true;
    for (const m of rest.matchAll(NAME_G)) if (vars.has(m[0].toLowerCase())) return true;
    return !rest.replace(/[=\s]/g, '');
  }

  // Give a line a name (or take it away with name = ''): "500+200=" + rent → "500+200 = rent";
  // a plain number just gets the word after it: "200" + var → "200 var".
  function nameLine(line, name) {
    const def = defOf(line);
    const head = (def ? line.slice(0, def.eq) : line.replace(/\s*=\s*$/, '')).replace(/\s+$/, '');
    const plain = /^[\d.,]+$/.test(head.trim());
    if (name) return head + (plain ? ' ' : ' = ') + name;
    return plain ? head : head + '=';
  }

  // Earlier versions wrote names as "200=var" (v3) or "500+200 → rent" (v4–5); write them the current way:
  // "500+200 = rent", and for a plain number "200 var".
  function modernizeNames(text) {
    return text.split('\n').map(line => {
      const d = defOf(line);
      if (!d) return line;
      const head = line.slice(0, d.eq).replace(/\s+$/, '');
      if (/^[\d.,]+$/.test(head.trim())) return head + ' ' + d.name;
      return head + ' = ' + d.name;
    }).join('\n');
  }

  // Works down the page. Each line gets:
  //   value   the line's value (the running total for multi-line calculations), converted if it converts
  //   result  for conversions: { kind: 'unit'|'money'|'time', value, unit, text } from units.js, or null
  //   status  what the answers column shows: 'answer' (finished), 'live' (still being typed — shown slightly dimmed),
  //           'unknown' (finished but can't be worked out), 'error' (e.g. ÷0), 'norate' (no exchange rate), or null
  //   names   [start, end] of the names used in its maths; def = the name it sets after "=" (if it worked)
  //   notes   [start, end] of the words that name a number on this line ("500 food")
  // ctx = { rates: { USD: 1, INR: 95, … } | null, now: Date } for currency and time-zone conversions.
  function evaluatePage(lines, ctx) {
    ctx = ctx || {};
    const vars = new Map();
    // Setting a name moves it to the end, so the most recently set names come last.
    const setVar = (name, value) => { const k = name.toLowerCase(); vars.delete(k); vars.set(k, { name, value }); };
    const out = [];
    let running = null, blockOp = false, pendingOp = null;
    lines.forEach((line, i) => {
      const blank = !line.trim();
      const cont = !blank && i > 0 && !!lines[i - 1].trim() && isContinuation(line, vars, !!pendingOp);
      if (!cont) { running = null; blockOp = false; }
      const leadOp = cont && !CONT_START.test(line) ? pendingOp : null;
      const a = blank ? null : lineCalc(line, vars, running, cont, leadOp);
      pendingOp = blank ? null : trailingOp(line);
      let value = a ? a.value : null;
      let result = null;
      if (a && a.conv) {
        const cv = a.conv;
        if (cv.zone) result = U.convertTime(cv, ctx);
        else if (cv.legacy) result = value !== null && isFinite(value) ? U.convert([[value, cv.from]], cv.to, ctx) : null;
        else result = U.convert(cv.parts, cv.to, ctx);
        value = result ? result.value : null;
      }
      if (a && a.operation) blockOp = true;
      running = value;
      const defSyntax = defOf(line);
      const names = a ? a.used.filter(t => t.isVar).map(t => [t.pos, t.end]) : [];
      const finished = !blank && isFinished(line);
      // Words after numbers name them — except on a conversion ("50 km to mi") or a date/phone-number line.
      const body = defSyntax ? line.slice(0, defSyntax.eq) : line.replace(/=\s*$/, '');
      const notes = blank || (a && a.conv) || (!finished && DATE_LIKE.test(body)) ? [] : noteNames(tokenize(body, 0, vars));
      const defined = a && defSyntax && value !== null && isFinite(value) ? defSyntax : null;
      for (const n of notes) setVar(n.name, n.value);
      if (defined) setVar(defSyntax.name, value);
      out.push({
        a, value, result, conv: a ? a.conv : null, def: defined, defSyntax, names, notes: notes.map(n => [n.pos, n.end]),
        finished, wantsAnswer: finished, cont, blockOp,
      });
    });
    out.forEach((o, i) => {
      o.last = !out[i + 1] || !out[i + 1].cont; // the last line of its calculation
      const a = o.a;
      const has = o.result ? (o.result.kind === 'time' || (o.result.value != null && isFinite(o.result.value)))
        : o.value != null && isFinite(o.value);
      if (o.finished) {
        if (!a) o.status = 'unknown';
        else if (a.conv && !o.result) o.status = a.conv.currency ? 'norate' : 'unknown';
        else if (!a.conv && !isFinite(a.value)) o.status = 'error';
        else if (a.simple) o.status = null; // "200 var" — the number is already there
        else o.status = 'answer';
      } else {
        o.status = o.last && o.blockOp && a && !a.simple && has ? 'live' : null;
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
    // The everyday form: at most 2 decimals (1,283.33). Tiny numbers keep enough digits to be seen.
    const shortFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    function short(n) {
      if (n == null || !isFinite(n)) return 'Error';
      const a = Math.abs(n);
      if (a !== 0 && a < 0.01) return result(n);
      if (a >= 1e15) return result(n);
      return shortFmt.format(Number(n.toPrecision(14))).replace('-', '−');
    }
    return { result, short, decimal: dec };
  }

  const api = {
    SYMBOL, tokenize, parse, evaluate, defOf, analyzeLine, openValue, nameLine, modernizeNames, isValidName,
    evaluatePage, continueLine, migrateV1, makeFormatter, rawString,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
