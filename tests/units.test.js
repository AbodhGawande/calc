// Run with: node --test tests/units.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../units.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const ctx = { rates: { USD: 1, INR: 95, EUR: 0.9 }, now: new Date('2026-09-11T15:00:00Z') };
const conv = (line, vars) => {
  const c = U.parseConversion(line, vars);
  if (!c) return null;
  return c.zone ? U.convertTime(c, ctx) : U.convert(c.parts, c.to, ctx);
};

test('parses "amount unit to unit"', () => {
  const c = U.parseConversion('50 km to miles');
  assert.deepEqual([c.parts, c.from, c.to, c.cat, c.start], [[[50, 'km']], 'km', 'mi', 'length', 0]);
  assert.equal(U.parseConversion('Trip 50km in miles').start, 5);
  assert.equal(U.parseConversion('Road trip 50 km to mi').start, 10);
  assert.equal(U.parseConversion('50 km → mi').to, 'mi');
  assert.equal(U.parseConversion('1,500 g to lb').parts[0][0], 1500);
  assert.equal(U.parseConversion('50 km'), null);           // no target: not a conversion
  assert.equal(U.parseConversion('50 to km'), null);
  assert.equal(U.parseConversion('hello to mi'), null);     // unknown amount
});

test('weight, length, speed, volume, area, fuel', () => {
  close(conv('10 lb to kg').value, 4.536);
  close(conv('1 kg to lb').value, 2.2046);
  close(conv('16 oz to g').value, 453.59);
  close(conv('50 km to mi').value, 31.07);
  close(conv('10 in to cm').value, 25.4);
  close(conv('6 ft to m').value, 1.8288);
  close(conv('60 mph to km/h').value, 96.56);
  close(conv('100 kmph to mph').value, 62.14);
  close(conv('1 gal to l').value, 3.785);
  close(conv('1 gallon to ml').value, 3785.4, 0.1);
  close(conv('8 fl oz to ml').value, 236.59);
  close(conv('1 cup to ml').value, 236.59);
  close(conv('1000 sq ft to sq m').value, 92.9);
  close(conv('1 acre to sqft').value, 43560, 1);
  close(conv('30 mpg to km/l').value, 12.75);
  assert.equal(conv('50 km to mi').unit, 'mi');
  assert.equal(conv('1 gal to l').unit, 'L');
});

test('compound amounts and unit symbols', () => {
  close(conv('5 ft 10 in to cm').value, 177.8);
  close(conv("5' 10\" to cm").value, 177.8);
  close(conv('1 kg 200 g to lb').value, 2.6455);
  assert.equal(conv('5 ft 10 kg to cm'), null);              // parts must be the same kind
  close(conv('5 ft in cm').value, 152.4);                    // "in" as the separator
  close(conv('5 in in cm').value, 12.7);
});

test('temperature', () => {
  close(conv('72 f to c').value, 22.22);
  close(conv('100 c to f').value, 212);
  close(conv('-40 °F to °C').value, -40, 0.001);
  assert.equal(conv('72 f to c').unit, '°C');
});

test('currency needs rates, and symbols work', () => {
  assert.equal(conv('100 usd to inr').value, 9500);
  assert.equal(conv('100 $ to ₹').value, 9500);
  assert.equal(conv('$100 to ₹').value, 9500);
  assert.equal(conv('9500 rs to $').value, 100);
  assert.equal(conv('100 usd to inr').kind, 'money');
  assert.equal(conv('100 usd to inr').unit, 'INR');
  close(conv('100 eur to inr').value, 10555.56);
  assert.equal(U.convert([[100, 'USD']], 'INR', { rates: null }), null);
  assert.equal(U.convert([[100, 'USD']], 'GBP', ctx), null);  // no rate for GBP in this ctx
});

test('mismatched units give nothing', () => {
  assert.equal(conv('5 km to kg'), null);
  assert.equal(conv('5 c to km'), null);
  assert.equal(conv('5 usd to km'), null);
});

test('a name can be the amount', () => {
  const vars = new Map([['trip', { name: 'trip', value: 50 }]]);
  close(conv('trip km to mi', vars).value, 31.07);
  assert.equal(U.parseConversion('trip km to mi', vars).isName, true);
  assert.equal(conv('trip km to mi'), null);
});

test('time zones', () => {
  // 2026-09-11: Chicago is on CDT (UTC−5), India is UTC+5:30.
  assert.equal(conv('3 pm cst to ist').text, '1:30 AM IST +1');
  assert.equal(conv('3:30pm ct to india').text, '2:00 AM IST +1');
  assert.equal(conv('9 am ist to cst').text, '10:30 PM CST −1');
  assert.equal(conv('15:30 cst to ist').text, '2:00 AM IST +1');
  assert.equal(conv('3 pm cst to est').text, '4:00 PM EST');
  assert.equal(conv('3 pm chicago to london').text, '9:00 PM UK');
  assert.equal(conv('now cst to ist').text, '8:30 PM IST');      // now = 15:00Z = 10:00 CDT → 20:30 IST
  assert.equal(conv('Call 3 pm cst to ist').text, '1:30 AM IST +1');
  assert.equal(conv('25 pm cst to ist'), null);
  assert.equal(conv('13 pm cst to ist'), null);
});

test('lookups', () => {
  assert.deepEqual(U.lookupUnit('miles'), { cat: 'length', unit: 'mi' });
  assert.deepEqual(U.lookupUnit('mi'), { cat: 'length', unit: 'mi' });
  assert.equal(U.lookupUnit('parsec'), null);
  assert.ok(U.isCurrency('INR'));
  assert.ok(!U.isCurrency('kg'));
});
