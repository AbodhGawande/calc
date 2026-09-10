/* Calc engine — pure calculator logic, no DOM.
   Loaded by the page as window.CalcEngine and by the Node tests via require().

   Model: a "chain" is one calculation made of stages. Every "=" finishes a stage
   (shown on the tape as "2 + 3 + 4 = 9"). Pressing an operator right after "="
   starts the next stage on top of that result ("× 5 = 45"), so "=" works as
   "lock in what I have so far" — the bracket behaviour, without a bracket key. */
(function (root) {
  'use strict';

  const SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const MAX_DIGITS = 15;

  function blank() {
    // tokens: the stage being typed. stages: finished stages of the current chain.
    return { tokens: [], stages: [], done: false, error: false, chainId: null, lastOp: null };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const last = s => s.tokens[s.tokens.length - 1];
  const lastResult = s => (s.stages.length ? s.stages[s.stages.length - 1].result : 0);
  const hasOp = tokens => tokens.some(t => t.t === 'op');

  function startFresh(s) {
    Object.assign(s, blank());
  }

  // Plain-digit string for a computed value, e.g. 0.30000000000000004 -> "0.3".
  function rawString(v) {
    const r = Number(v.toPrecision(14));
    let str = String(r);
    if (/e-/.test(str)) str = r.toFixed(20).replace(/\.?0+$/, '');
    return str;
  }

  function trimOps(tokens) {
    let end = tokens.length;
    while (end && tokens[end - 1].t === 'op') end--;
    return tokens.slice(0, end);
  }

  // × and ÷ before + and −. Percent follows iOS: "a + b%" = a + a×b/100, "a × b%" = a × b/100.
  function evaluate(tokens) {
    const toks = trimOps(tokens);
    if (!toks.length) return null;
    let total = 0, sign = 1, term = null, mul = null, afterAdd = false;
    for (const tok of toks) {
      if (tok.t === 'op') {
        if (tok.v === '+' || tok.v === '-') {
          total += sign * term;
          sign = tok.v === '+' ? 1 : -1;
          term = null; mul = null; afterAdd = true;
        } else {
          mul = tok.v;
        }
        continue;
      }
      let v = tok.t === 'prev' ? tok.v : parseFloat(tok.s);
      if (tok.pct) v = term === null && afterAdd ? (total * v) / 100 : v / 100;
      if (term === null) term = v;
      else if (mul === '*') term *= v;
      else term /= v;
    }
    return total + sign * term;
  }

  function digit(s, d) {
    if (s.done || s.error) startFresh(s);
    const l = last(s);
    if (l && l.t === 'num') {
      if (l.ins) { s.tokens[s.tokens.length - 1] = { t: 'num', s: d }; return null; }
      if (l.pct || l.s.replace(/\D/g, '').length >= MAX_DIGITS) return null;
      if (l.s === '0') l.s = d;
      else if (l.s === '-0') l.s = '-' + d;
      else l.s += d;
    } else {
      s.tokens.push({ t: 'num', s: d });
    }
    return null;
  }

  function dot(s) {
    if (s.done || s.error) startFresh(s);
    const l = last(s);
    if (l && l.t === 'num') {
      if (l.ins) { s.tokens[s.tokens.length - 1] = { t: 'num', s: '0.' }; return null; }
      if (l.pct || l.s.includes('.')) return null;
      l.s += '.';
    } else {
      s.tokens.push({ t: 'num', s: '0.' });
    }
    return null;
  }

  function operator(s, o) {
    if (s.error) return null;
    if (s.done) {
      // Continue the chain on top of the last result.
      s.tokens = [{ t: 'prev', v: lastResult(s) }, { t: 'op', v: o }];
      s.done = false;
      return null;
    }
    const l = last(s);
    if (!l) {
      s.tokens.push({ t: 'num', s: '0' }, { t: 'op', v: o });
    } else if (l.t === 'op') {
      l.v = o;
    } else {
      if (l.t === 'num') { l.s = l.s.replace(/\.$/, ''); delete l.ins; }
      s.tokens.push({ t: 'op', v: o });
    }
    return null;
  }

  function equals(s) {
    if (s.error) return null;
    if (s.done) {
      // Repeated "=" repeats the last operation, like iOS (2 + 3 = = → 8).
      if (!s.lastOp) return null;
      s.tokens = [{ t: 'prev', v: lastResult(s) }, { t: 'op', v: s.lastOp.op }, { t: 'num', s: s.lastOp.s }];
      s.done = false;
    }
    const toks = trimOps(s.tokens);
    if (!hasOp(toks)) {
      if (toks.length === 1 && toks[0].t === 'prev') { s.tokens = []; s.done = true; }
      else s.tokens = toks;
      return null;
    }
    const result = evaluate(toks);
    if (!isFinite(result)) {
      s.error = true; s.tokens = [];
      return { type: 'error' };
    }
    const clean = toks.map(t => {
      if (t.t !== 'num') return Object.assign({}, t);
      const n = { t: 'num', s: t.s.replace(/\.$/, '') };
      if (t.pct) n.pct = true;
      return n;
    });
    s.stages.push({ tokens: clean, result });
    s.tokens = [];
    s.done = true;
    let i = clean.length - 1;
    while (i >= 0 && clean[i].t !== 'op') i--;
    const operand = clean[i + 1];
    s.lastOp = operand && operand.t === 'num' && !operand.pct ? { op: clean[i].v, s: operand.s } : null;
    if (!s.chainId) s.chainId = newId();
    return { type: 'stage', chain: { id: s.chainId, stages: JSON.parse(JSON.stringify(s.stages)) } };
  }

  function percent(s) {
    if (s.error) return null;
    if (s.done) {
      const r = lastResult(s) / 100;
      startFresh(s);
      s.tokens = [{ t: 'num', s: rawString(r), ins: true }];
      return null;
    }
    const l = last(s);
    if (l && l.t === 'num' && !l.pct) { l.s = l.s.replace(/\.$/, ''); l.pct = true; delete l.ins; }
    return null;
  }

  function negate(s) {
    if (s.error) return null;
    if (s.done) {
      const r = -lastResult(s);
      startFresh(s);
      s.tokens = [{ t: 'num', s: rawString(r), ins: true }];
      return null;
    }
    const l = last(s);
    if (l && l.t === 'num') l.s = l.s[0] === '-' ? l.s.slice(1) : '-' + l.s;
    else s.tokens.push({ t: 'num', s: '-0' });
    return null;
  }

  function back(s) {
    if (s.error) { startFresh(s); return null; }
    if (s.done) return null;
    const l = last(s);
    if (!l) return null;
    if (l.t === 'op' || l.ins) s.tokens.pop();
    else if (l.pct) delete l.pct;
    else {
      const t = l.s.slice(0, -1);
      if (t === '' || t === '-') s.tokens.pop();
      else l.s = t;
    }
    // Backed out of a continuation ("9 ×" → "9"): show the previous result again.
    if (s.tokens.length === 1 && s.tokens[0].t === 'prev') { s.tokens = []; s.done = true; }
    return null;
  }

  // Returns an event ({type:'stage', chain} when "=" finished a stage) or null.
  function press(s, key) {
    if (/^[0-9]$/.test(key)) return digit(s, key);
    switch (key) {
      case '.': return dot(s);
      case '+': case '-': case '*': case '/': return operator(s, key);
      case '=': return equals(s);
      case '%': return percent(s);
      case 'neg': return negate(s);
      case 'back': return back(s);
      case 'clear': startFresh(s); return null;
    }
    return null;
  }

  // Put a number (from history, the tape, the pin or a conversion) into the calculation.
  function insert(s, v) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    const tok = { t: 'num', s: rawString(v), ins: true };
    const l = last(s);
    if (s.done || s.error || !l) { startFresh(s); s.tokens = [tok]; }
    else if (l.t === 'op') s.tokens.push(tok);
    else s.tokens[s.tokens.length - 1] = tok;
  }

  function renderTokens(tokens, fmt, skipPrev) {
    const out = [];
    for (const t of tokens) {
      if (t.t === 'prev') { if (!skipPrev) out.push({ k: 'prev', text: fmt.result(t.v) }); }
      else if (t.t === 'op') out.push({ k: 'op', text: SYMBOL[t.v] });
      else out.push({ k: 'num', text: fmt.typed(t.s) + (t.pct ? '%' : '') });
    }
    return out;
  }

  function view(s, fmt) {
    let big, value, isResult = false;
    if (s.error) { big = [{ k: 'error', text: 'Error' }]; value = null; }
    else if (s.done) { value = lastResult(s); big = [{ k: 'result', text: fmt.result(value) }]; isResult = true; }
    else if (!s.tokens.length) { big = [{ k: 'num', text: '0' }]; value = 0; }
    else {
      big = renderTokens(s.tokens, fmt, false);
      value = evaluate(s.tokens);
      if (value === null || !isFinite(value)) value = null;
    }
    return {
      tape: s.stages,
      big,
      value,
      isResult,
      acLabel: !s.tokens.length || s.done || s.error ? 'AC' : 'back',
    };
  }

  function validToken(t) {
    if (!t || typeof t !== 'object') return false;
    if (t.t === 'num') return typeof t.s === 'string' && !isNaN(parseFloat(t.s));
    if (t.t === 'op') return t.v in SYMBOL;
    if (t.t === 'prev') return typeof t.v === 'number';
    return false;
  }

  const validStage = st => st && Array.isArray(st.tokens) && st.tokens.every(validToken) && typeof st.result === 'number';

  // Rebuild saved state defensively — anything malformed falls back to a blank calculator.
  function restore(o) {
    const s = blank();
    if (!o || typeof o !== 'object') return s;
    if (Array.isArray(o.stages) && o.stages.every(validStage)) s.stages = o.stages;
    if (Array.isArray(o.tokens) && o.tokens.every(validToken)) s.tokens = o.tokens;
    if (s.tokens.length && s.tokens[0].t === 'prev' && !s.stages.length) s.tokens = [];
    s.done = !!o.done && s.stages.length > 0;
    if (s.done) s.tokens = [];
    s.error = !!o.error;
    s.chainId = typeof o.chainId === 'string' ? o.chainId : null;
    if (o.lastOp && o.lastOp.op in SYMBOL && typeof o.lastOp.s === 'string') s.lastOp = o.lastOp;
    return s;
  }

  // Number formatting in the device's locale (grouping, decimal mark). Minus is the true "−".
  function makeFormatter(locale) {
    const intFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
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

    function typed(str) {
      if (/e/i.test(str)) return result(parseFloat(str));
      const neg = str[0] === '-';
      const body = neg ? str.slice(1) : str;
      const [i, f] = body.split('.');
      let out = intFmt.format(BigInt(i || '0'));
      if (body.includes('.')) out += dec + (f || '');
      return (neg ? '−' : '') + out;
    }

    return { result, typed, decimal: dec };
  }

  const api = { blank, press, insert, view, evaluate, renderTokens, restore, validStage, makeFormatter, rawString, newId, SYMBOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
