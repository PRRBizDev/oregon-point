// Run with: node --test
// No dependencies. Exercises the pure functions exported by load-route-schedules.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const S = require('../load-route-schedules.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// ------------------------------------------------------------------
// parseCsv
// ------------------------------------------------------------------

test('parseCsv preserves empty fields (the v2.3.0 regex dropped them)', () => {
  assert.deepEqual(S.parseCsv('a,,b'), [['a', '', 'b']]);
  assert.deepEqual(S.parseCsv('a,b,,,c'), [['a', 'b', '', '', 'c']]);
  assert.deepEqual(S.parseCsv('Stop,,http://x,9:00,10:00'), [['Stop', '', 'http://x', '9:00', '10:00']]);
});

test('parseCsv handles quoted fields with embedded commas and escaped quotes', () => {
  const line = '"Klamath Falls - Amtrak Station","1600 Oak Ave., Klamath Falls, OR 97601","https://maps.example/?q=a,b","9:30 AM"';
  assert.deepEqual(S.parseCsv(line), [[
    'Klamath Falls - Amtrak Station',
    '1600 Oak Ave., Klamath Falls, OR 97601',
    'https://maps.example/?q=a,b',
    '9:30 AM'
  ]]);
  assert.deepEqual(S.parseCsv('"He said ""hi""",x'), [['He said "hi"', 'x']]);
});

test('parseCsv handles CRLF, LF, trailing newline, BOM, and newlines inside quotes', () => {
  assert.deepEqual(S.parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(S.parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(S.parseCsv('﻿a,b'), [['a', 'b']]);
  assert.deepEqual(S.parseCsv('"line1\nline2",x'), [['line1\nline2', 'x']]);
});

test('parseCsv trims whitespace around cells', () => {
  assert.deepEqual(S.parseCsv(' a , b '), [['a', 'b']]);
});

test('parseCsv treats a quote mid-field as a literal character', () => {
  assert.deepEqual(S.parseCsv('12" wide,x'), [['12" wide', 'x']]);
});

// ------------------------------------------------------------------
// normalizeRows
// ------------------------------------------------------------------

test('normalizeRows drops blank rows and pads short rows to header width', () => {
  const rows = S.parseCsv('Stop,Address,URL,T1,T2\n\nA,addr,http://a,9:00\n,,,,\nB,addr,http://b,10:00,11:00\n');
  const data = S.normalizeRows(rows);
  assert.equal(data.header.length, 5);
  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.rows[0], ['A', 'addr', 'http://a', '9:00', '']);
});

test('normalizeRows returns null for empty input', () => {
  assert.equal(S.normalizeRows([]), null);
  assert.equal(S.normalizeRows([['', '']]), null);
});

// ------------------------------------------------------------------
// validateRows
// ------------------------------------------------------------------

test('validateRows: clean sheet has no errors or warnings', () => {
  const data = S.normalizeRows(S.parseCsv(fixture('cascades-southbound.csv')));
  const r = S.validateRows(data);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validateRows: restroom break rows are not flagged', () => {
  const data = S.normalizeRows(S.parseCsv(fixture('eastern-westbound.csv')));
  const r = S.validateRows(data);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validateRows: an empty time cell is a warning that names the sheet row and column', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL,T1,T2\nA,addr,http://a,9:00,\n'));
  const r = S.validateRows(data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Row 2, column 5 is empty/);
});

test('validateRows: a non-time value is a warning', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL,T1\nA,addr,http://a,soon\n'));
  const r = S.validateRows(data);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /does not look like a time/);
});

test('validateRows: "--" and unicode dashes are accepted as no-stop', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL,T1,T2,T3\nA,addr,http://a,--,–,—\n'));
  assert.deepEqual(S.validateRows(data).warnings, []);
});

test('validateRows: too few columns is a blocking error', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL\nA,addr,http://a\n'));
  const r = S.validateRows(data);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /expected at least 4/);
});

test('validateRows: header only is a blocking error', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL,T1\n'));
  assert.match(S.validateRows(data).errors[0], /no stop rows/);
});

test('validateRows: non-http map URL is a warning', () => {
  const data = S.normalizeRows(S.parseCsv('Stop,Address,URL,T1\nA,addr,javascript:alert(1),9:00\n'));
  assert.match(S.validateRows(data).warnings[0], /map URL is not an http\(s\) link/);
});

// ------------------------------------------------------------------
// renderTableHtml
// ------------------------------------------------------------------

function render(name) {
  const data = S.normalizeRows(S.parseCsv(fixture(name)));
  return { data, html: S.renderTableHtml(data, 'Southbound schedule', 'https://www.oregon-point.com') };
}

test('renderTableHtml: structure and WCAG table semantics', () => {
  const { data, html } = render('cascades-southbound.csv');
  assert.match(html, /^<table class="tablepress"><caption class="schedule-visually-hidden">Southbound schedule<\/caption>/);
  assert.match(html, /<th scope="col">Click address for map<\/th>/);
  const colHeaders = (html.match(/<th scope="col">/g) || []).length;
  assert.equal(colHeaders, 1 + (data.header.length - 3), 'one stop header plus one per trip');
  const rowHeaders = (html.match(/<th scope="row"/g) || []).length;
  assert.equal(rowHeaders, data.rows.length, 'every stop row has a row header');
  assert.ok(!html.includes('restroom-cell'));
});

test('renderTableHtml: every stop row has exactly the trip-column count of cells', () => {
  const { data, html } = render('cascades-southbound.csv');
  const trips = data.header.length - 3;
  const rows = html.split('<tr class="table_row').slice(1);
  for (const row of rows) {
    const tds = (row.match(/<td class="table_cell">/g) || []).length;
    assert.equal(tds, trips);
  }
});

test('renderTableHtml: restroom break rows span the full rendered width', () => {
  const { data, html } = render('eastern-westbound.csv');
  const expectedColspan = data.header.length - 2;
  assert.match(html, new RegExp('<td class="table_cell restroom-cell" colspan="' + expectedColspan + '">'));
  assert.match(html, /<div class="restroom-note"><strong>Restroom Break<\/strong><\/div>/);
});

test('renderTableHtml: "--" cells get a visually hidden "no stop" for screen readers', () => {
  const { html } = render('northwest-westbound.csv');
  assert.match(html, /<td class="table_cell"><span aria-hidden="true">--<\/span><span class="schedule-visually-hidden">no stop<\/span><\/td>/);
});

test('renderTableHtml: an empty time cell renders as an empty cell, not shifted data', () => {
  // This is the exact scenario that corrupted tables under the old parser.
  const csv = 'Stop,Address,URL,T1,T2,T3\nBend,123 Main St,https://maps.example/bend,,10:00 AM,11:00 AM\n';
  const data = S.normalizeRows(S.parseCsv(csv));
  const html = S.renderTableHtml(data, 'x', 'https://www.oregon-point.com');
  assert.match(html, /<a href="https:\/\/maps.example\/bend"[^>]*>123 Main St<\/a>/, 'address link intact');
  assert.match(html, /<\/th><td class="table_cell"><\/td><td class="table_cell">10:00 AM<\/td><td class="table_cell">11:00 AM<\/td>/, 'times stay in their own columns');
});

test('renderTableHtml: escapes sheet content and drops unsafe URLs', () => {
  const csv = 'Stop,Address,URL,T1\n<img src=x onerror=alert(1)>,"<b>addr</b>",javascript:alert(1),9:00\n';
  const data = S.normalizeRows(S.parseCsv(csv));
  const html = S.renderTableHtml(data, 'x', 'https://www.oregon-point.com');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<a '), 'no link when URL is unsafe');
  assert.ok(html.includes('&lt;b&gt;addr&lt;/b&gt;'));
});

test('renderTableHtml: address without URL renders as plain text', () => {
  const csv = 'Stop,Address,URL,T1\nA,Some Address,,9:00\n';
  const data = S.normalizeRows(S.parseCsv(csv));
  const html = S.renderTableHtml(data, 'x', 'https://www.oregon-point.com');
  assert.match(html, /<\/strong><\/div>Some Address<\/th>/);
});

test('renderTableHtml: alternating row classes', () => {
  const { html } = render('cascades-southbound.csv');
  assert.match(html, /<tr class="table_row even">/);
  assert.match(html, /<tr class="table_row odd">/);
});

// ------------------------------------------------------------------
// Regression: old parser vs new parser on the same input
// ------------------------------------------------------------------

test('regression: the v2.3.0 regex shifts columns on blank cells; v2.4.0 does not', () => {
  const legacy = (row) => row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
  const line = 'Bend,,https://maps.example/bend,9:00 AM,10:00 AM';
  assert.deepEqual(legacy(line), ['Bend', 'https://maps.example/bend', '9:00 AM', '10:00 AM'], 'documents the old bug');
  assert.deepEqual(S.parseCsv(line)[0], ['Bend', '', 'https://maps.example/bend', '9:00 AM', '10:00 AM']);
});

// ------------------------------------------------------------------
// Misc
// ------------------------------------------------------------------

test('sheetUrlFor builds the published CSV URL', () => {
  assert.equal(S.sheetUrlFor('61645532'), 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSFxEWKQ2-xBzt3yUZR3N2iCroPtJfmrMcLVXacEVAEaxhUZckJCOOvIshUEuJVi5v7CtlcNq_HjoyC/pub?gid=61645532&output=csv');
});

test('routeToGidMap covers all four routes with two directions each', () => {
  const m = S.routeToGidMap;
  assert.deepEqual(Object.keys(m).sort(), ['cascades', 'eastern', 'northwest', 'southwest']);
  for (const route of Object.keys(m)) assert.equal(Object.keys(m[route]).length, 2);
});

test('version', () => {
  assert.equal(S.version, '2.4.0');
});
