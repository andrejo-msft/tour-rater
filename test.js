// Headless tests for tour-rater. Run with: node test.js
// Tests rubric structure, slugify, rating object construction, base64 payload,
// and setup-URL parsing logic.

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

// --- load rubric.js in a fake-window context so it works in Node too ---
global.window = {};
require('./rubric.js');
var R = global.window;

var failures = 0;
var passes = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); passes++; }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message); failures++; }
}

console.log('rubric structure');
test('RUBRIC_VERSION is set', function () {
  assert.strictEqual(typeof R.RUBRIC_VERSION, 'string');
  assert.ok(R.RUBRIC_VERSION.length > 0);
});
test('APP_VERSION is set', function () {
  assert.strictEqual(typeof R.APP_VERSION, 'string');
});
test('6 categories', function () {
  assert.strictEqual(R.RUBRIC.length, 6);
});
test('24 criteria total', function () {
  var n = R.RUBRIC.reduce(function (a, c) { return a + c.criteria.length; }, 0);
  assert.strictEqual(n, 24);
});
test('every category has 4 criteria', function () {
  R.RUBRIC.forEach(function (cat) {
    assert.strictEqual(cat.criteria.length, 4, cat.id + ' has ' + cat.criteria.length);
  });
});
test('weights sum to 56 (so weightedMax = 168)', function () {
  var sum = 0;
  R.RUBRIC.forEach(function (c) { c.criteria.forEach(function (x) { sum += x.weight; }); });
  assert.strictEqual(sum, 56);
});
test('rawMax = 72 (24 criteria * max score 3)', function () {
  assert.strictEqual(R.THRESHOLDS.rawMax, 72);
});
test('weightedMax = 168', function () {
  assert.strictEqual(R.THRESHOLDS.weightedMax, 168);
});
test('purchase threshold = 57', function () {
  assert.strictEqual(R.THRESHOLDS.purchaseRawMin, 57);
});
test('SCORE_SCALE has 0,1,2,3', function () {
  assert.deepStrictEqual(R.SCORE_SCALE.map(function (s) { return s.value; }), [0,1,2,3]);
});
test('all criteria ids are unique', function () {
  var seen = {};
  R.RUBRIC.forEach(function (cat) {
    cat.criteria.forEach(function (c) {
      assert.ok(!seen[c.id], 'duplicate ' + c.id);
      seen[c.id] = true;
    });
  });
});
test('specific criterion: convenient-to-friends weight 2.5', function () {
  var found = R.RUBRIC[0].criteria.find(function (c) { return c.id === 'convenient-to-friends'; });
  assert.ok(found);
  assert.strictEqual(found.weight, 2.5);
});
test('specific criterion: central-air-heat-pump weight 1', function () {
  var sb = R.RUBRIC.find(function (c) { return c.id === 'systems-bath'; });
  var found = sb.criteria.find(function (c) { return c.id === 'central-air-heat-pump'; });
  assert.strictEqual(found.weight, 1);
});

console.log('\nslugify');
function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
test('basic address', function () {
  assert.strictEqual(slugify('1008 Grotto St N, St Paul'), '1008-grotto-st-n-st-paul');
});
test('strips diacritics', function () {
  assert.strictEqual(slugify('Caf\u00e9 Cr\u00e8me'), 'cafe-creme');
});
test('handles weird punctuation', function () {
  assert.strictEqual(slugify('990 Como Place!!  '), '990-como-place');
});
test('all-symbols becomes empty', function () {
  assert.strictEqual(slugify('!!!'), '');
});
test('does not produce double hyphens', function () {
  assert.ok(slugify('a -- b').indexOf('--') === -1);
});

console.log('\nrating object construction');
function buildRating(prop, rater, scores) {
  var rating = {
    submissionId: 'test-uuid-1234',
    rubricVersion: R.RUBRIC_VERSION,
    appVersion: R.APP_VERSION,
    property: prop.address,
    propertySlug: prop.slug,
    rater: rater,
    date: '2026-04-25T14:30:00-05:00',
    categories: {},
    overallNotes: '',
    rawTotal: 0,
    rawMax: 72,
    weightedTotal: 0,
    weightedMax: 168
  };
  R.RUBRIC.forEach(function (cat) {
    rating.categories[cat.id] = { criteria: {}, categoryNote: '' };
    cat.criteria.forEach(function (c) {
      var s = scores[c.id] != null ? scores[c.id] : 0;
      rating.categories[cat.id].criteria[c.id] =
        { name: c.name, weight: c.weight, score: s, note: '' };
      rating.rawTotal += s;
      rating.weightedTotal += s * c.weight;
    });
  });
  rating.weightedTotal = Math.round(rating.weightedTotal * 10) / 10;
  return rating;
}
test('all-zeros rating: raw=0, weighted=0', function () {
  var r = buildRating({ address: 'X', slug: 'x' }, 'drew', {});
  assert.strictEqual(r.rawTotal, 0);
  assert.strictEqual(r.weightedTotal, 0);
});
test('all-3s rating: raw=72, weighted=168', function () {
  var scores = {};
  R.RUBRIC.forEach(function (c) { c.criteria.forEach(function (x) { scores[x.id] = 3; }); });
  var r = buildRating({ address: 'X', slug: 'x' }, 'drew', scores);
  assert.strictEqual(r.rawTotal, 72);
  assert.strictEqual(r.weightedTotal, 168);
});
test('mixed rating: a single 2 on convenient-to-friends weighted = 5.0', function () {
  var r = buildRating({ address: '1008 Grotto', slug: '1008-grotto' }, 'sherry',
    { 'convenient-to-friends': 2 });
  assert.strictEqual(r.rawTotal, 2);
  assert.strictEqual(r.weightedTotal, 5);
});
test('rating JSON is parseable and round-trips', function () {
  var r = buildRating({ address: 'X', slug: 'x' }, 'drew', { 'cooking-station': 3 });
  var s = JSON.stringify(r, null, 2);
  var back = JSON.parse(s);
  assert.strictEqual(back.rater, 'drew');
  assert.strictEqual(back.categories.kitchen.criteria['cooking-station'].score, 3);
  assert.strictEqual(back.rubricVersion, R.RUBRIC_VERSION);
  assert.ok(back.submissionId);
});

console.log('\nGitHub API payload');
function b64encode(s) { return Buffer.from(s, 'utf8').toString('base64'); }
test('base64 encoding round-trips', function () {
  var content = JSON.stringify({ hello: 'world' });
  var encoded = b64encode(content);
  var decoded = Buffer.from(encoded, 'base64').toString('utf8');
  assert.strictEqual(decoded, content);
});
test('rating payload path is correct shape', function () {
  var r = buildRating({ address: '1008 Grotto St N, St Paul', slug: '1008-grotto-st-n-st-paul' },
    'drew', {});
  r.date = '2026-04-25T14:30:00-05:00';
  var safeStamp = r.date.replace(/[:+]/g, '-');
  var p = 'ratings/' + r.propertySlug + '/' + r.rater + '-' + safeStamp + '.json';
  assert.strictEqual(p, 'ratings/1008-grotto-st-n-st-paul/drew-2026-04-25T14-30-00-05-00.json');
});
test('commit message format', function () {
  var r = buildRating({ address: '1008 Grotto St N, St Paul', slug: '1008-grotto-st-n-st-paul' },
    'drew', {});
  var msg = 'rating: ' + r.rater + ' scores ' + r.property;
  assert.strictEqual(msg, 'rating: drew scores 1008 Grotto St N, St Paul');
});

console.log('\nsetup-URL parsing');
function parseSetupHash(hash) {
  if (hash.indexOf('#setup=') !== 0) return null;
  var raw = hash.slice('#setup='.length);
  var parts = raw.split('&');
  var pat = decodeURIComponent(parts[0] || '');
  var repo = '', ph = '';
  parts.slice(1).forEach(function (p) {
    var eq = p.indexOf('=');
    if (eq < 0) return;
    var key = p.slice(0, eq);
    var val = decodeURIComponent(p.slice(eq + 1));
    if (key === 'repo') repo = val;
    else if (key === 'ph') ph = val;
  });
  return { pat: pat, repo: repo, ph: ph };
}
test('parses #setup=PAT&repo=...&ph=...', function () {
  var h = '#setup=ghp_abc123&repo=andrejo-msft%2Ftour-rater&ph=deadbeef';
  var r = parseSetupHash(h);
  assert.strictEqual(r.pat, 'ghp_abc123');
  assert.strictEqual(r.repo, 'andrejo-msft/tour-rater');
  assert.strictEqual(r.ph, 'deadbeef');
});
test('returns null for non-setup hash', function () {
  assert.strictEqual(parseSetupHash('#other'), null);
  assert.strictEqual(parseSetupHash(''), null);
});
test('handles empty params gracefully', function () {
  var r = parseSetupHash('#setup=');
  assert.strictEqual(r.pat, '');
});

console.log('\nproperties.json');
test('default property list parses', function () {
  var raw = fs.readFileSync(path.join(__dirname, 'properties.json'), 'utf8');
  var arr = JSON.parse(raw);
  assert.ok(Array.isArray(arr));
  assert.strictEqual(arr.length, 5);
  arr.forEach(function (p) {
    assert.ok(p.address); assert.ok(p.slug);
    assert.strictEqual(p.slug, slugify(p.address), 'slug mismatch for ' + p.address);
  });
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures === 0 ? 0 : 1);
