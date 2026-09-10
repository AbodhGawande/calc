// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const fmt = E.makeFormatter('en-US');
const KEYMAP = { n: 'neg', b: 'back', c: 'clear' };

// Types a key string like "2+3*4=" (n = ±, b = ⌫, c = AC) into a calculator.
function keys(str, s = E.blank()) {
  const events = [];
  for (const ch of str.replace(/\s/g, '')) {
    const ev = E.press(s, KEYMAP[ch] || ch);
    if (ev) events.push(ev);
  }
  return { s, events, v: E.view(s, fmt) };
}
const bigText = v => v.big.map(p => p.text).join('');

test('"=" locks in a stage and an operator continues on top of it', () => {
  const a = keys('2+3+4=');
  assert.equal(a.v.value, 9);
  assert.equal(bigText(a.v), '9');

  const b = keys('*5', a.s);
  assert.deepEqual(b.v.big.map(p => p.k), ['prev', 'op', 'num']);
  assert.equal(bigText(b.v), '9×5');
  assert.equal(b.v.value, 45);

  const c = keys('=+10=', b.s);
  assert.equal(c.v.value, 55);
  assert.equal(c.s.stages.length, 3);
  const tape = c.s.stages.map(st => E.renderTokens(st.tokens, fmt, true).map(p => p.text).join(''));
  assert.deepEqual(tape, ['2+3+4', '×5', '+10']);
});

test('all stages of a chain report the same chain id; a new number starts a new chain', () => {
  const a = keys('2+3=*5=');
  assert.equal(a.events.length, 2);
  assert.equal(a.events[0].chain.id, a.events[1].chain.id);
  assert.equal(a.events[1].chain.stages.length, 2);
  const b = keys('7', a.s);
  assert.equal(b.s.stages.length, 0);
  assert.equal(b.s.chainId, null);
  assert.equal(bigText(b.v), '7');
});

test('multiplication and division before addition', () => {
  assert.equal(keys('2+3*4=').v.value, 14);
  assert.equal(keys('10-6/3=').v.value, 8);
});

test('percent behaves like iOS', () => {
  assert.equal(keys('100+10%=').v.value, 110);
  assert.equal(keys('200-25%=').v.value, 150);
  assert.equal(keys('50*10%=').v.value, 5);
  assert.equal(keys('10%').v.value, 0.1);
});

test('floating point noise is hidden', () => {
  assert.equal(bigText(keys('0.1+0.2=').v), '0.3');
  assert.equal(bigText(keys('1.1*3=').v), '3.3');
});

test('division by zero shows Error and the next digit starts fresh', () => {
  const a = keys('1/0=');
  assert.equal(bigText(a.v), 'Error');
  assert.equal(a.v.value, null);
  assert.equal(a.v.acLabel, 'AC');
  assert.equal(bigText(keys('5', a.s).v), '5');
});

test('repeated "=" repeats the last operation', () => {
  const a = keys('2+3===');
  assert.equal(a.v.value, 11);
  assert.equal(a.s.stages.length, 3);
});

test('backspacing out of a continuation returns to the previous result', () => {
  const a = keys('2+3=*b');
  assert.equal(a.s.done, true);
  assert.equal(bigText(a.v), '5');
  assert.equal(a.v.acLabel, 'AC');
});

test('operator entry edge cases', () => {
  assert.equal(keys('2+*3=').v.value, 6);       // replaces operator
  assert.equal(keys('+5=').v.value, 5);         // leading operator uses 0
  const t = keys('2+=');                         // trailing operator dropped, nothing recorded
  assert.equal(t.s.stages.length, 0);
  assert.equal(bigText(t.v), '2');
});

test('± and backspace', () => {
  assert.equal(bigText(keys('n5').v), '−5');
  assert.equal(bigText(keys('5n').v), '−5');
  const r = keys('2+3=n');
  assert.equal(bigText(r.v), '−5');
  assert.equal(r.s.stages.length, 0);
  assert.equal(bigText(keys('123bb').v), '1');
  assert.equal(bigText(keys('12.b').v), '12');
  assert.equal(bigText(keys('b').v), '0');
  assert.equal(bigText(keys('..5').v), '0.5');
});

test('digit limit', () => {
  const a = keys('9'.repeat(20));
  assert.equal(a.s.tokens[0].s.length, 15);
});

test('inserting a number (history / pin / conversion)', () => {
  const a = keys('2+');
  E.insert(a.s, 9);
  assert.equal(E.view(a.s, fmt).value, 11);
  keys('7', a.s);                                // a digit replaces an inserted number
  assert.equal(E.view(a.s, fmt).value, 9);

  const b = keys('2+3=');
  E.insert(b.s, 0.1 + 0.2);                      // after "=" an insert starts fresh
  assert.equal(b.s.stages.length, 0);
  assert.equal(bigText(E.view(b.s, fmt)), '0.3');
});

test('formatting', () => {
  assert.equal(fmt.typed('1234.50'), '1,234.50');
  assert.equal(fmt.typed('-0'), '−0');
  assert.equal(fmt.typed('0.'), '0.');
  assert.equal(fmt.result(1234567.891), '1,234,567.891');
  assert.equal(fmt.result(-5), '−5');
  assert.equal(fmt.result(1e20), '1e20');
  assert.equal(fmt.result(1.5e-12), '1.5e−12');
  assert.equal(E.makeFormatter('en-IN').typed('1234567'), '12,34,567');
});

test('restore survives garbage and round-trips real state', () => {
  assert.deepEqual(E.restore(null), E.blank());
  assert.deepEqual(E.restore({ tokens: 'x', stages: [{}] }), E.blank());
  const a = keys('2+3=*4');
  const back = E.restore(JSON.parse(JSON.stringify(a.s)));
  assert.equal(E.view(back, fmt).value, 20);
  assert.equal(back.stages.length, 1);
});
