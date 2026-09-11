/* Units — the conversion table and maths, no DOM. Used by engine.js (inline conversions typed on the page)
   and by convert.js (the ⇄ sheet). Loaded by the page as window.CalcUnits and by tests via require().

   convert(amount, from, to, ctx) → { value, kind: 'unit'|'money', unit } | { kind: 'time', text } | null
     null = the two units don't go together (km to kg), or a currency rate is missing.
   ctx = { rates: { USD: 1, INR: 95.4, … }, now: Date }                                                  */
(function (root) {
  'use strict';

  // Each category: the base unit and the factor that turns one of each unit into the base.
  // 'aliases' are what people type; the first alias is how the unit is shown.
  const CATEGORIES = {
    weight: { base: 'kg', units: {
      kg: { f: 1, aliases: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
      g: { f: 0.001, aliases: ['g', 'gm', 'gms', 'gram', 'grams'] },
      mg: { f: 1e-6, aliases: ['mg', 'milligram', 'milligrams'] },
      lb: { f: 0.45359237, aliases: ['lb', 'lbs', 'pound', 'pounds'] },
      oz: { f: 0.028349523125, aliases: ['oz', 'ounce', 'ounces'] },
      st: { f: 6.35029318, aliases: ['st', 'stone', 'stones'] },
    } },
    length: { base: 'm', units: {
      mm: { f: 0.001, aliases: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'] },
      cm: { f: 0.01, aliases: ['cm', 'cms', 'centimeter', 'centimeters', 'centimetre', 'centimetres'] },
      m: { f: 1, aliases: ['m', 'meter', 'meters', 'metre', 'metres'] },
      km: { f: 1000, aliases: ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'] },
      in: { f: 0.0254, aliases: ['in', 'inch', 'inches', '"', '″'] },
      ft: { f: 0.3048, aliases: ['ft', 'feet', 'foot', "'", '′'] },
      yd: { f: 0.9144, aliases: ['yd', 'yds', 'yard', 'yards'] },
      mi: { f: 1609.344, aliases: ['mi', 'mile', 'miles'] },
    } },
    speed: { base: 'km/h', units: {
      'km/h': { f: 1, aliases: ['km/h', 'kmh', 'kmph', 'kph'] },
      mph: { f: 1.609344, aliases: ['mph'] },
      'm/s': { f: 3.6, aliases: ['m/s', 'mps'] },
      kn: { f: 1.852, aliases: ['kn', 'knot', 'knots'] },
    } },
    volume: { base: 'L', units: {
      ml: { f: 0.001, aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
      L: { f: 1, aliases: ['l', 'ltr', 'liter', 'liters', 'litre', 'litres'] },
      gal: { f: 3.785411784, aliases: ['gal', 'gallon', 'gallons'] },
      'fl oz': { f: 0.0295735295625, aliases: ['fl oz', 'floz', 'fl. oz'] },
      cup: { f: 0.2365882365, aliases: ['cup', 'cups'] },
      tbsp: { f: 0.01478676478125, aliases: ['tbsp', 'tablespoon', 'tablespoons'] },
      tsp: { f: 0.00492892159375, aliases: ['tsp', 'teaspoon', 'teaspoons'] },
      qt: { f: 0.946352946, aliases: ['qt', 'quart', 'quarts'] },
      pt: { f: 0.473176473, aliases: ['pt', 'pint', 'pints'] },
    } },
    area: { base: 'sq m', units: {
      'sq m': { f: 1, aliases: ['sq m', 'sqm', 'm2', 'm²'] },
      'sq ft': { f: 0.09290304, aliases: ['sq ft', 'sqft', 'ft2', 'ft²'] },
      'sq km': { f: 1e6, aliases: ['sq km', 'sqkm', 'km2', 'km²'] },
      'sq mi': { f: 2589988.110336, aliases: ['sq mi', 'sqmi', 'mi2'] },
      acre: { f: 4046.8564224, aliases: ['acre', 'acres', 'ac'] },
      ha: { f: 10000, aliases: ['ha', 'hectare', 'hectares'] },
    } },
    fuel: { base: 'km/L', units: {
      'km/L': { f: 1, aliases: ['km/l', 'kml', 'kmpl'] },
      mpg: { f: 0.425143707, aliases: ['mpg'] },
    } },
    temperature: { base: '°C', units: {
      '°C': { aliases: ['c', '°c', 'celsius', 'centigrade', 'degc'] },
      '°F': { aliases: ['f', '°f', 'fahrenheit', 'degf'] },
    } },
    currency: { base: 'USD', units: {
      USD: { aliases: ['usd', '$', 'dollar', 'dollars', 'us$', 'bucks'] },
      INR: { aliases: ['inr', '₹', 'rs', 'rs.', 'rupee', 'rupees'] },
      EUR: { aliases: ['eur', '€', 'euro', 'euros'] },
      GBP: { aliases: ['gbp', '£', 'pound sterling', 'quid'] },
      JPY: { aliases: ['jpy', '¥', 'yen'] },
      CAD: { aliases: ['cad', 'c$'] },
      AUD: { aliases: ['aud', 'a$'] },
      SGD: { aliases: ['sgd', 's$'] },
      AED: { aliases: ['aed', 'dirham', 'dirhams'] },
      CHF: { aliases: ['chf', 'franc', 'francs'] },
      CNY: { aliases: ['cny', 'rmb', 'yuan'] },
    } },
  };

  // Time zones: what people type → IANA zone, and the label shown.
  const ZONES = [
    ['America/Chicago', 'CST', ['cst', 'cdt', 'ct', 'central', 'chicago', 'texas', 'dallas', 'houston', 'austin']],
    ['America/New_York', 'EST', ['est', 'edt', 'et', 'eastern', 'new york', 'nyc', 'ny', 'boston', 'miami', 'toronto']],
    ['America/Denver', 'MST', ['mst', 'mdt', 'mt', 'mountain', 'denver']],
    ['America/Phoenix', 'AZ', ['az', 'arizona', 'phoenix']],
    ['America/Los_Angeles', 'PST', ['pst', 'pdt', 'pt', 'pacific', 'la', 'los angeles', 'sf', 'seattle', 'california']],
    ['Pacific/Honolulu', 'HST', ['hst', 'hawaii', 'honolulu']],
    ['Asia/Kolkata', 'IST', ['ist', 'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'pune', 'chennai', 'hyderabad', 'kolkata']],
    ['UTC', 'UTC', ['utc', 'gmt', 'zulu']],
    ['Europe/London', 'UK', ['uk', 'london', 'bst', 'britain', 'england']],
    ['Europe/Paris', 'CET', ['cet', 'cest', 'paris', 'berlin', 'amsterdam', 'madrid', 'rome', 'europe']],
    ['Asia/Dubai', 'Dubai', ['dubai', 'uae', 'gst', 'abu dhabi']],
    ['Asia/Singapore', 'SGT', ['sgt', 'singapore', 'sg']],
    ['Asia/Hong_Kong', 'HKT', ['hkt', 'hong kong', 'hk']],
    ['Asia/Shanghai', 'China', ['china', 'beijing', 'shanghai']],
    ['Asia/Tokyo', 'JST', ['jst', 'japan', 'tokyo']],
    ['Australia/Sydney', 'AEST', ['aest', 'aedt', 'sydney', 'melbourne', 'australia']],
  ];

  // ---- lookup tables ----
  const UNIT_BY_ALIAS = new Map(); // alias → { cat, unit }
  for (const [cat, c] of Object.entries(CATEGORIES)) {
    for (const [unit, u] of Object.entries(c.units)) for (const a of u.aliases) UNIT_BY_ALIAS.set(a.toLowerCase(), { cat, unit });
  }
  const ZONE_BY_ALIAS = new Map();
  for (const [zone, label, aliases] of ZONES) for (const a of aliases) ZONE_BY_ALIAS.set(a, { zone, label });

  const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const alternation = names => [...names].sort((a, b) => b.length - a.length).map(esc).join('|');
  const UNIT_RE = alternation(UNIT_BY_ALIAS.keys());
  const ZONE_RE = alternation(ZONE_BY_ALIAS.keys());
  const NUM = '(?:\\d[\\d,]*\\.?\\d*|\\.\\d+)';
  const SEP = '(?:to|in|into|→|->|>)';
  // A unit must end at a word boundary so "in" doesn't match the start of "inr" and "m" the start of "mi".
  const unitGroup = name => `(?<${name}>${UNIT_RE})(?![\\p{L}\\p{N}])`;
  const CONV_RE = new RegExp(
    `^(?<label>.*?)(?:^|\\s)(?<sym>[$₹€£¥])?\\s*(?<neg>[-−])?(?<amt>${NUM}|[\\p{L}_][\\p{L}\\p{N}_]*)(?:\\s*${unitGroup('u1')})?` +
    `(?:\\s+(?<amt2>${NUM})\\s*${unitGroup('u2')})?\\s+${SEP}\\s+${unitGroup('u3')}\\s*$`, 'iu');
  const TIME_RE = new RegExp(
    `^(?<label>.*?)(?:^|\\s)(?<time>now|(?<h>\\d{1,2})(?::(?<mi>\\d{2}))?\\s*(?<ap>am|pm|a|p)?)\\s+(?<z1>${ZONE_RE})(?![\\p{L}])` +
    `\\s+${SEP}\\s+(?<z2>${ZONE_RE})(?![\\p{L}])\\s*$`, 'iu');
  const NOW_RE = new RegExp(`^(?<label>.*?)(?:^|\\s)now\\s+${SEP}\\s+(?<z2>${ZONE_RE})(?![\\p{L}])\\s*$`, 'iu');

  const isCurrency = unit => !!CATEGORIES.currency.units[unit];
  const num = s => parseFloat(s.replace(/,/g, ''));

  // Find a conversion in a line's text (already stripped of "=" and any name). vars = known names.
  // → null, or { label, amount (number) | name, parts: [[amount, unit], …], from, to, zone: bool, start }
  function parseConversion(body, vars, offset = 0) {
    const r = parseAt(body, vars);
    if (r === 'retry') {
      // The word before the number was taken as the amount ("Trip 50km in miles"): skip it and look again.
      const m = /^\s*\S+\s*/.exec(body);
      return m ? parseConversion(body.slice(m[0].length), vars, offset + m[0].length) : null;
    }
    if (r && offset) r.start += offset;
    return r;
  }

  function parseAt(body, vars) {
    let m = TIME_RE.exec(body);
    if (m) {
      const g = m.groups;
      const start = m.index + g.label.length + (body[g.label.length] === ' ' ? 1 : 0);
      const z1 = ZONE_BY_ALIAS.get(g.z1.toLowerCase()), z2 = ZONE_BY_ALIAS.get(g.z2.toLowerCase());
      if (g.time.toLowerCase() === 'now') return { zone: true, now: true, from: z1, to: z2, start };
      let h = +g.h, mi = g.mi ? +g.mi : 0;
      const ap = (g.ap || '').toLowerCase();
      if (h > 23 || mi > 59) return null;
      if (ap) { if (h > 12) return null; h = h % 12 + (ap[0] === 'p' ? 12 : 0); }
      return { zone: true, h, mi, from: z1, to: z2, start };
    }
    m = NOW_RE.exec(body);
    if (m) {
      const g = m.groups;
      const start = m.index + g.label.length + (body[g.label.length] === ' ' ? 1 : 0);
      return { zone: true, now: true, from: null, to: ZONE_BY_ALIAS.get(g.z2.toLowerCase()), start };
    }
    m = CONV_RE.exec(body);
    if (!m) return null;
    const g = m.groups;
    const isNum = /^[\d.,]/.test(g.amt);
    let amount;
    if (isNum) amount = g.neg ? -num(g.amt) : num(g.amt);
    else {
      const known = vars && vars.get(g.amt.toLowerCase());
      if (!known) return g.amt2 ? 'retry' : null;
      amount = known.value;
    }
    const to = UNIT_BY_ALIAS.get(g.u3.toLowerCase());
    let u1 = g.u1 ? UNIT_BY_ALIAS.get(g.u1.toLowerCase()) : g.sym ? UNIT_BY_ALIAS.get(g.sym) : null;
    if (!u1 || !to) return null;
    const parts = [[amount, u1.unit]];
    if (g.amt2) {
      const u2 = UNIT_BY_ALIAS.get(g.u2.toLowerCase());
      if (!u2 || u2.cat !== u1.cat) return null;
      parts.push([num(g.amt2), u2.unit]);
    }
    const start = m.index + g.label.length + (body[g.label.length] === ' ' ? 1 : 0);
    return { parts, from: u1.unit, to: to.unit, cat: u1.cat, toCat: to.cat, isName: !isNum, amtText: g.amt, start };
  }

  function toBase(amount, unit, cat) {
    if (cat === 'temperature') return unit === '°F' ? (amount - 32) * 5 / 9 : amount;
    return amount * CATEGORIES[cat].units[unit].f;
  }
  function fromBase(base, unit, cat) {
    if (cat === 'temperature') return unit === '°F' ? base * 9 / 5 + 32 : base;
    return base / CATEGORIES[cat].units[unit].f;
  }

  // Convert an amount (or a list of [amount, unit] parts that add up, like 5 ft 10 in).
  function convert(parts, to, ctx) {
    if (typeof parts === 'number') return null;
    const first = UNIT_BY_ALIAS.get(String(parts[0][1]).toLowerCase()) || lookupUnit(parts[0][1]);
    const target = lookupUnit(to);
    if (!first || !target || first.cat !== target.cat) return null;
    const cat = first.cat;
    if (cat === 'currency') {
      const rates = ctx && ctx.rates;
      const from = parts[0][1];
      if (!rates || !(rates[from] > 0) || !(rates[target.unit] > 0)) return null;
      const value = parts.reduce((s, [a]) => s + a, 0) * rates[target.unit] / rates[from];
      return { kind: 'money', value: Math.round(value * 100) / 100, unit: target.unit };
    }
    let base = 0;
    for (const [a, u] of parts) {
      const uu = lookupUnit(u);
      if (!uu || uu.cat !== cat) return null;
      base += toBase(a, uu.unit, cat);
    }
    return { kind: 'unit', value: fromBase(base, target.unit, cat), unit: target.unit };
  }

  function lookupUnit(name) {
    for (const [cat, c] of Object.entries(CATEGORIES)) if (c.units[name]) return { cat, unit: name };
    return UNIT_BY_ALIAS.get(String(name).toLowerCase()) || null;
  }

  // ---- time zones ----
  const dtfCache = {};
  function partsIn(zone, t) {
    const f = dtfCache[zone] || (dtfCache[zone] = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
    const p = {};
    for (const x of f.formatToParts(t)) p[x.type] = x.value;
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  // The instant at which a wall-clock time happens in a zone (today in that zone).
  function instantFor(zone, h, mi, now) {
    const today = partsIn(zone, now);
    let guess = Date.UTC(today.y, today.mo - 1, today.d, h, mi);
    for (let k = 0; k < 2; k++) {
      const p = partsIn(zone, guess);
      const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
      guess += Date.UTC(today.y, today.mo - 1, today.d, h, mi) - asUTC;
    }
    return guess;
  }
  function clock(zone, t) {
    const p = partsIn(zone, t);
    const h12 = p.h % 12 || 12;
    return `${h12}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
  }
  const dayNum = (zone, t) => { const p = partsIn(zone, t); return p.y * 10000 + p.mo * 100 + p.d; };

  // → { kind: 'time', text: '2:30 AM IST +1', h, mi, shift: -1|0|1 }
  function convertTime(c, ctx) {
    const now = (ctx && ctx.now) || new Date();
    let t, fromZone;
    if (c.now) { t = now.getTime(); fromZone = c.from ? c.from.zone : Intl.DateTimeFormat().resolvedOptions().timeZone; }
    else { fromZone = c.from.zone; t = instantFor(fromZone, c.h, c.mi, now); }
    const shift = Math.sign(dayNum(c.to.zone, t) - dayNum(fromZone, t));
    const p = partsIn(c.to.zone, t);
    const text = clock(c.to.zone, t) + ' ' + c.to.label + (shift > 0 ? ' +1' : shift < 0 ? ' −1' : '');
    return { kind: 'time', text, value: null, unit: c.to.label, h: p.h, mi: p.mi, shift };
  }
  const zoneByAlias = alias => ZONE_BY_ALIAS.get(String(alias).toLowerCase()) || null;

  const api = { CATEGORIES, ZONES, parseConversion, convert, convertTime, lookupUnit, zoneByAlias, isCurrency };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
