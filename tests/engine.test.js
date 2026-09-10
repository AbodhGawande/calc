// Run with: node --test tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const fmt = E.makeFormatter('en-US');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('precedence, brackets and implicit multiplication', () => {
  assert.equal(E.evaluate('2+3×4'), 14);
  assert.equal(E.evaluate('(2+3)×4'), 20);
  assert.equal(E.evaluate('2(3+4)'), 14);
  assert.equal(E.evaluate('(1+2)(3+4)'), 21);
  assert.equal(E.evaluate('10−6÷3'), 8);
  assert.equal(E.evaluate('2*3/4'), 1.5);
});

test('unclosed brackets close themselves', () => {
  assert.equal(E.evaluate('(50+25'), 75);
  assert.equal(E.evaluate('((1+2)×3'), 9);
});

test('percent behaves like iOS', () => {
  assert.equal(E.evaluate('100+10%'), 110);
  assert.equal(E.evaluate('200−25%'), 150);
  assert.equal(E.evaluate('50×10%'), 5);
  assert.equal(E.evaluate('10%'), 0.1);
});

test('signs, grouping and bad input', () => {
  assert.equal(E.evaluate('−5+2'), -3);
  assert.equal(E.evaluate('5×−3'), -15);
  assert.equal(E.evaluate('1,234.5+0.5'), 1235);
  assert.equal(E.evaluate('1/0'), Infinity);
  assert.equal(E.evaluate('2+'), null);
  assert.equal(E.evaluate('1.2.3'), null);
  assert.equal(E.evaluate(''), null);
});

test('lines: only lines ending in "=" have an answer, and words are labels', () => {
  const a = E.analyzeLine('Hotel 3 nights (120+95+110)×1.18 =');
  close(a.value, 383.5);
  assert.equal('Hotel 3 nights (120+95+110)×1.18 ='.slice(0, a.exprStart), 'Hotel 3 nights ');
  assert.equal(E.analyzeLine('Room3 50+25=').value, 75);
  assert.equal(E.analyzeLine('v1.2.3 5+5=').value, 10);
  assert.equal(E.analyzeLine('Total: −50+20 =').value, -30);
  assert.equal(E.analyzeLine('Flights 2×450 =').value, 900);
  assert.equal(E.analyzeLine('5+5'), null);
  assert.equal(E.analyzeLine('just words ='), null);
  assert.equal(E.analyzeLine('5/0=').value, Infinity);
  assert.equal(fmt.result(E.analyzeLine('0.1+0.2=').value), '0.3');
});

test('conversion lines', () => {
  const a = E.analyzeLine('1,283.5 $→₹=');
  assert.equal(a.conv, 'USD>INR');
  assert.equal(a.value, 1283.5);
  const b = E.analyzeLine('Rent 75+25 ₹→$ =');
  assert.equal(b.conv, 'INR>USD');
  assert.equal(b.value, 100);
});

test('an operator after an answer continues the line, with brackets only when needed', () => {
  assert.equal(E.continueLine('50+25+60=', '×'), '(50+25+60)×');
  assert.equal(E.continueLine('50+25=', '+'), '50+25+');
  assert.equal(E.continueLine('5×3=', '×'), '5×3×');
  assert.equal(E.continueLine('Hotel 120+95 =', '÷'), 'Hotel (120+95)÷');
  assert.equal(E.continueLine('(50+25=', '×'), '(50+25)×');
  assert.equal(E.continueLine('−5=', '×'), '−5×');
  assert.equal(E.continueLine('75 $→₹=', '×'), null);
  assert.equal(E.continueLine('words', '×'), null);
});

test('version 1 history becomes lines', () => {
  const history = [
    { id: 'b', ts: 2, type: 'fx', from: 'USD', to: 'INR', amount: 55, result: 5249.2, rate: 95.44 },
    { id: 'a', ts: 1, type: 'calc', stages: [
      { tokens: [{ t: 'num', s: '2' }, { t: 'op', v: '+' }, { t: 'num', s: '3' }, { t: 'op', v: '+' }, { t: 'num', s: '4' }], result: 9 },
      { tokens: [{ t: 'prev', v: 9 }, { t: 'op', v: '*' }, { t: 'num', s: '5' }], result: 45 },
      { tokens: [{ t: 'prev', v: 45 }, { t: 'op', v: '+' }, { t: 'num', s: '10' }], result: 55 },
    ] },
    { id: 'c', ts: 3, type: 'calc', stages: 'broken' },
  ];
  const lines = E.migrateV1(history);
  assert.deepEqual(lines, ['(2+3+4)×5+10=', '55 $→₹=']);
  assert.equal(E.analyzeLine(lines[0]).value, 55);
});

test('formatting', () => {
  assert.equal(fmt.result(1234567.891), '1,234,567.891');
  assert.equal(fmt.result(-5), '−5');
  assert.equal(fmt.result(1e20), '1e20');
  assert.equal(fmt.result(1.5e-12), '1.5e−12');
  assert.equal(E.makeFormatter('en-IN').result(1234567), '12,34,567');
  assert.equal(E.rawString(0.1 + 0.2), '0.3');
  assert.equal(E.rawString(1e-7), '0.0000001');
});
