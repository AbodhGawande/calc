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
  assert.deepEqual([a.conv.from, a.conv.to, a.conv.currency], ['USD', 'INR', true]);
  assert.equal(a.value, 1283.5);
  const b = E.analyzeLine('Rent 75+25 ₹→$ =');
  assert.deepEqual([b.conv.from, b.conv.to], ['INR', 'USD']);
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

test('a calculation never starts part-way through, so unknown words give no answer', () => {
  assert.equal(E.analyzeLine('Hotel×12='), null);
  assert.equal(E.analyzeLine('rent+5='), null);
  assert.equal(E.analyzeLine('62+3+4)×5+10='), null); // a stray ")" gives no answer, not a wrong 10
  assert.equal(E.analyzeLine('Room 3 50+25=').value, 75);
  assert.equal(E.analyzeLine('5 −3=').value, 2);
});

const values = page => page.lines.map(l => l.value);
const RATES = { rates: { USD: 1, INR: 95, EUR: 0.9 }, now: new Date('2026-09-11T15:00:00Z') };

test('naming answers and using the names below', () => {
  const p = E.evaluatePage(['50+50=rent', 'rent×12= yearly', 'yearly÷4=', 'Hotel×12=', '2rent=', 'rent(3)=', '200= Rent2']);
  assert.deepEqual(values(p), [100, 1200, 300, null, 200, 300, 200]);
  assert.equal(p.lines[0].def.name, 'rent');
  assert.deepEqual(p.lines[1].names, [[0, 4]]);
  assert.deepEqual([...p.vars.values()].map(v => [v.name, v.value]), [['rent', 100], ['yearly', 1200], ['Rent2', 200]]);
});

test('names: order, redefinition, capitals, highlighting', () => {
  assert.deepEqual(values(E.evaluatePage(['b×2=', '3=b'])), [null, 3]);          // only lines below can use a name
  assert.deepEqual(values(E.evaluatePage(['5=a', 'a+1=a', 'a='])), [5, 6, 6]);   // setting it again takes over
  assert.deepEqual(values(E.evaluatePage(['10=Rent', 'rent+1='])), [10, 11]);    // capitals don't matter
  // only the name used in the maths is highlighted; "share rent" after it is a note
  const shared = E.evaluatePage(['10=rent', 'rent share rent÷2=']).lines[1];
  assert.deepEqual(shared.names, [[0, 4]]);
  assert.equal(shared.value, 5);
  assert.equal(E.evaluatePage(['hello=world']).lines[0].def, null);             // nothing to name
  assert.equal(E.evaluatePage(['5/0=x', 'x=']).lines[1].value, null);           // errors aren't stored
});

test('naming a conversion stores the converted amount', () => {
  const p = E.evaluatePage(['100 $→₹=inr', 'inr÷2='], RATES);
  assert.deepEqual(values(p), [9500, 4750]);
  assert.equal(E.evaluatePage(['100 $→₹=inr'], { rates: null }).lines[0].def, null);  // no rate yet
});

test('continuing a line that uses names', () => {
  const vars = new Map([['rent', { name: 'rent', value: 100 }]]);
  assert.equal(E.continueLine('rent+5=', '×', vars), '(rent+5)×');
  assert.equal(E.continueLine('5=x', '×'), null);
});

test('arrow names', () => {
  assert.deepEqual(E.defOf('500+200 → rent'), { name: 'rent', start: 10, end: 14, eq: 8 });
  assert.equal(E.defOf('100 $→₹='), null); // the currency token is not a name
  const p = E.evaluatePage(['500+200 → rent', 'rent×2=', '200 → var', 'var+1=']);
  assert.deepEqual(values(p), [700, 1400, 200, 201]);
  assert.equal(p.lines[2].a.simple, true);   // a plain number needs no answer shown
  assert.equal(p.lines[0].a.simple, false);
  assert.equal(E.evaluatePage(['100 $→₹ → inr'], RATES).lines[0].value, 9500);
});

test('naming a line from the name box', () => {
  assert.equal(E.nameLine('500+200=', 'rent'), '500+200 = rent');
  assert.equal(E.nameLine('200', 'var'), '200 var');
  assert.equal(E.nameLine('500+200 → rent', 'house'), '500+200 = house');
  assert.equal(E.nameLine('500+200 = rent', ''), '500+200=');
  assert.equal(E.nameLine('200 → var', ''), '200');
  assert.equal(E.nameLine('200=var', 'x'), '200 x');
  assert.equal(E.nameLine('100 $→₹=', 'inr'), '100 $→₹ = inr');
  assert.equal(E.modernizeNames('200=var\n5+5=\nTea 5+5=ok\n500+200 → rent\n200 → var\n500+200 = rent'),
    '200 var\n5+5=\nTea 5+5 = ok\n500+200 = rent\n200 var\n500+200 = rent');
  assert.equal(E.openValue('200').value, 200);
  assert.equal(E.openValue('50+25').value, 75);
  assert.equal(E.openValue('words'), null);
  assert.ok(E.isValidName('rent2'));
  assert.ok(E.isValidName('house_rent'));
  assert.ok(!E.isValidName('2rent'));
  assert.ok(!E.isValidName('house rent'));
});

test('lines that ask for an answer but have none are flagged', () => {
  const p = E.evaluatePage(['varr=', 'words', '5+5=', 'oops → x']);
  assert.deepEqual(p.lines.map(l => l.wantsAnswer), [true, false, true, true]);
  assert.equal(p.lines[0].a, null);
  assert.equal(p.lines[3].def, null);
});

const statuses = page => page.lines.map(l => l.status);

test('words right after a number are notes', () => {
  assert.equal(E.analyzeLine('700 rent + 500 food =').value, 1200);
  assert.equal(E.analyzeLine('500 food items + 20 tip=').value, 520);
  assert.equal(E.analyzeLine('700rs+300rs=').value, 1000);
  const p = E.evaluatePage(['700 → rent', '700 rent + 500 food =', '2rent=', 'rent×2=']);
  assert.deepEqual(values(p), [700, 1200, 1400, 1400]);
  assert.deepEqual(p.lines[1].names, []);        // "rent" after a number is a note, not the name
  assert.deepEqual(p.lines[3].names, [[0, 4]]);  // "rent" where a number is expected is the name
});

test('multi-line calculations', () => {
  let p = E.evaluatePage(['700 rent', '+500 food', '+20 tip = sum', 'sum×2=']);
  assert.deepEqual(values(p), [700, 1200, 1220, 2440]);
  assert.deepEqual(statuses(p), [null, null, 'answer', 'answer']);
  assert.equal(p.lines[2].def.name, 'sum');
  assert.deepEqual(values(E.evaluatePage(['700', '+500', '×2='])), [700, 1200, 2400]); // × applies to the total
  assert.deepEqual(values(E.evaluatePage(['200', '−10%='])), [200, 180]);
  p = E.evaluatePage(['700', '+500 =', '+20 =']);                                       // subtotals
  assert.deepEqual(values(p), [700, 1200, 1220]);
  assert.deepEqual(statuses(p), [null, 'answer', 'answer']);
  assert.deepEqual(values(E.evaluatePage(['5', '', '+3='])), [5, null, 3]);            // a blank line ends it
  assert.deepEqual(values(E.evaluatePage(['Groceries', '+500', '+20 ='])), [null, 500, 520]);
  p = E.evaluatePage(['700', '- buy milk']);                                            // a list item, not maths
  assert.equal(p.lines[1].cont, false);
  assert.equal(p.lines[1].value, null);
});

test('a line that ends with an operator joins with the line below', () => {
  let p = E.evaluatePage(['500 rent+', '200 food']);
  assert.deepEqual(values(p), [500, 700]);
  assert.deepEqual(statuses(p), [null, 'live']);
  assert.deepEqual(varList(p), [['rent', 500], ['food', 200]]);
  p = E.evaluatePage(['500 ×', '3 =']);
  assert.deepEqual(values(p), [500, 1500]);
  assert.deepEqual(statuses(p), [null, 'answer']);
  assert.deepEqual(values(E.evaluatePage(['500+', '+200'])), [500, 700]);       // both sides: not doubled
  assert.deepEqual(values(E.evaluatePage(['500+', 'hello'])), [500, null]);     // a word doesn't join
  assert.deepEqual(values(E.evaluatePage(['500+', '', '200'])), [500, null, 200]); // a blank line ends it
  assert.deepEqual(values(E.evaluatePage(['500+200=', '300'])), [700, 300]);   // finished lines don't join
});

test('short formatting keeps 2 decimals', () => {
  assert.equal(fmt.short(1283.3333333), '1,283.33');
  assert.equal(fmt.short(700), '700');
  assert.equal(fmt.short(0.1 + 0.2), '0.3');
  assert.equal(fmt.short(-2.005), '−2.01');
  assert.equal(fmt.short(0.0004), '0.0004');
});

test('live answers while typing', () => {
  assert.deepEqual(statuses(E.evaluatePage(['500+200'])), ['live']);
  assert.deepEqual(statuses(E.evaluatePage(['700 rent'])), [null]);                     // nothing to add up yet
  assert.deepEqual(statuses(E.evaluatePage(['700', '+500'])), [null, 'live']);          // total on the last line
  assert.deepEqual(statuses(E.evaluatePage(['700', '+'])), [null, 'live']);             // just typed "+"
  assert.deepEqual(values(E.evaluatePage(['700', '+'])), [700, 700]);
  assert.deepEqual(statuses(E.evaluatePage(['500+'])), [null]);                         // trailing operator ignored
  assert.deepEqual(statuses(E.evaluatePage(['2024-25 budget', '555-1234', '10/9'])), [null, null, null]);
  assert.deepEqual(values(E.evaluatePage(['2024−25'])), [1999]);                        // the keypad's − counts
  assert.equal(E.evaluatePage(['2024-25=']).lines[0].value, 1999);                      // "=" calculates anyway
  assert.deepEqual(statuses(E.evaluatePage(['5/0'])), [null]);                          // no live errors
  const named = E.evaluatePage(['9 → rent', 'rent×']);
  assert.deepEqual(named.lines[1].names, [[0, 4]]);                                     // still highlighted mid-typing
  assert.deepEqual(statuses(E.evaluatePage(['100 $→₹'], RATES)), ['live']);
});

const varList = page => [...page.vars.values()].map(v => [v.name, v.value]);

test('a word after a number names it; a word after "=" names the total', () => {
  let p = E.evaluatePage(['500 food + 500 rent', 'food+rent=']);
  assert.deepEqual(values(p), [1000, 1000]);
  assert.deepEqual(varList(p), [['food', 500], ['rent', 500]]);
  assert.deepEqual(p.lines[0].notes, [[4, 8], [15, 19]]);
  p = E.evaluatePage(['500 rent + 500 food = expense', 'expense×2=']);
  assert.deepEqual(values(p), [1000, 2000]);
  assert.deepEqual(varList(p), [['rent', 500], ['food', 500], ['expense', 1000]]);
  assert.deepEqual(varList(E.evaluatePage(['500 for food'])), [['food', 500]]);        // small words skipped
  assert.deepEqual(varList(E.evaluatePage(['500 food items'])), [['food', 500]]);      // one name per number
  p = E.evaluatePage(['500 food', '200 food', 'food=']);                                // latest wins
  assert.deepEqual(values(p), [500, 200, 200]);
  assert.deepEqual(varList(E.evaluatePage(['500 food', '9 rent', '200 food'])), [['rent', 9], ['food', 200]]);
  assert.equal(E.evaluatePage(['500 food + food']).lines[0].value, null);              // only lines below
  assert.equal(E.evaluatePage(['2024-25 budget', 'budget=']).lines[1].value, null);    // dates don't name
  assert.equal(E.evaluatePage(['10% gst']).vars.size, 0);                              // only plain numbers
  p = E.evaluatePage(['700', '+500 food', '+20 tip = sum', 'food+tip=']);               // works in multi-line sums
  assert.deepEqual(values(p), [700, 1200, 1220, 520]);
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

test('typed conversions on the page', () => {
  const p = E.evaluatePage(['50 km to mi', 'Trip 50km in miles = trip', 'trip+10=', '72 f to c', '100 $ to ₹', '3 pm cst to ist', '5 km to kg=', '100 usd to gbp=', 'trip km to mi'], RATES);
  const r = p.lines.map(l => l.result && (l.result.text || Math.round(l.result.value * 100) / 100 + ' ' + l.result.unit));
  assert.deepEqual(r, ['31.07 mi', '31.07 mi', null, '22.22 °C', '9500 INR', '1:30 AM IST +1', null, null, '19.31 mi']);
  assert.deepEqual(statuses(p), ['live', 'answer', 'answer', 'live', 'live', 'live', 'unknown', 'norate', 'live']);
  assert.deepEqual(values(p).slice(0, 3).map(v => Math.round(v * 100) / 100), [31.07, 31.07, 41.07]);
  assert.deepEqual(varList(p), [['trip', p.lines[1].value]]);           // "km" and "mi" never become names
  assert.deepEqual(p.lines[8].names, [[0, 4]]);                         // the name used as the amount is blue
  assert.equal(p.lines[4].conv.currency, true);
  assert.equal(p.lines[0].conv.currency, false);
  assert.equal(p.lines[5].value, null);                                 // a time isn't a number
  assert.deepEqual(values(E.evaluatePage(['50 km to mi', '+10'], RATES)).map(v => Math.round(v * 100) / 100), [31.07, 41.07]);
});

test('pasting shared text strips the answers back off', () => {
  const shared = [
    '45 pizza + 18 drinks = bill (63)',
    'bill + 18% = total (74.34)',
    '45 + 18 + 12 = 75',
    '320 mi to km = 514.99 km',
    '1500 $ to ₹ = ₹1,43,160.00',
    '5 pm cst to ist = 3:30 AM IST +1',
    '180 cm to ft = 5 ft 10.9 in',
    '200 var',
    'Dinner with friends',
    '10 − 2 = −8',
  ].join('\n');
  assert.equal(E.stripAnswers(shared), [
    '45 pizza + 18 drinks = bill',
    'bill + 18% = total',
    '45 + 18 + 12=',
    '320 mi to km=',
    '1500 $ to ₹=',
    '5 pm cst to ist=',
    '180 cm to ft=',
    '200 var',
    'Dinner with friends',
    '10 − 2=',
  ].join('\n'));
  assert.equal(E.stripAnswers('plain words'), 'plain words');
});
