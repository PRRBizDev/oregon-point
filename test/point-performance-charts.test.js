// Run: node --test test/point-performance-charts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../point-performance-charts.js');

const tabs = {};
for (const k of Object.keys(P.metrics)) {
  tabs[k] = fs.readFileSync(path.join(__dirname, '..', 'data', k + '.csv'), 'utf8');
}

test('reads all four tabs from the sheet snapshot with no errors or warnings', () => {
  const r = P.buildData(tabs);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(Object.keys(r.data).sort(), ['cascades', 'eastern', 'northwest', 'southwest']);
});

test('values match the spreadsheet exactly, at full precision', () => {
  const d = P.buildData(tabs).data;
  assert.deepEqual(d.cascades.ridership[0], { month: '2024-06', value: 5914 });
  assert.equal(d.cascades.ridership.at(-1).value, 9032);
  assert.equal(d.eastern['on-time-performance'].find((p) => p.month === '2025-06').value, 73.7);
  assert.equal(d.northwest['farebox-recovery'].find((p) => p.month === '2024-08').value, 99.9);
  assert.equal(d.southwest['cost-per-mile'][0].value, 2.48);
});

test('a real $0.00 stays zero, not a gap', () => {
  const nw = P.buildData(tabs).data.northwest['cost-per-mile'];
  assert.equal(nw.find((p) => p.month === '2024-08').value, 0);
});

test('routes that have not reported the latest month end a month earlier', () => {
  const d = P.buildData(tabs).data;
  assert.equal(d.cascades.ridership.at(-1).month, '2026-07');
  assert.equal(d.northwest.ridership.at(-1).month, '2026-06');
  assert.equal(d.southwest['farebox-recovery'].at(-1).month, '2026-06');
});

test('route columns are matched by name, not position', () => {
  const swapped = 'Date,SouthWest,Cascades\nJun 2024,684,5914\n';
  const r = P.normalizeMetricTable(P.parseCsv(swapped), 'ridership');
  assert.equal(r.series.southwest[0].value, 684);
  assert.equal(r.series.cascades[0].value, 5914);
});

test('a mid-series blank becomes a gap and is reported nowhere as zero', () => {
  const csv = 'Date,Cascades\nJan 2025,10\nFeb 2025,\nMar 2025,12\n';
  const s = P.normalizeMetricTable(P.parseCsv(csv), 'ridership').series.cascades;
  assert.deepEqual(s.map((p) => p.value), [10, null, 12]);
});

test('a missing month row is filled as a gap so spacing stays even', () => {
  const csv = 'Date,Cascades\nJan 2025,10\nMar 2025,12\n';
  const s = P.normalizeMetricTable(P.parseCsv(csv), 'ridership').series.cascades;
  assert.deepEqual(s.map((p) => p.month), ['2025-01', '2025-02', '2025-03']);
});

test('fraction-style percentages are scaled', () => {
  const csv = 'Date,Cascades\nJan 2025,0.78\nFeb 2025,0.8\n';
  const s = P.normalizeMetricTable(P.parseCsv(csv), 'on-time-performance').series.cascades;
  assert.deepEqual(s.map((p) => p.value), [78, 80]);
});

test('text in a number cell is a warning, not a crash', () => {
  const r = P.normalizeMetricTable(P.parseCsv('Date,Cascades\nJan 2025,TBD\n'), 'ridership');
  assert.equal(r.warnings.filter((w) => /not a number/.test(w)).length, 1);
  assert.equal(r.series.cascades, undefined);
});

test('a tab without a Date column fails that metric only', () => {
  const r = P.buildData(Object.assign({}, tabs, { ridership: 'Month X,Cascades\nJan 2025,1\n' }));
  assert.deepEqual(r.failed, ['ridership']);
  assert.ok(r.data.cascades['cost-per-mile'].length > 0);
});

test('parseMonth accepts the common date formats', () => {
  for (const v of ['Jun 2024', 'June 2024', '2024-06', '2024-06-01', '6/1/2024', '6/2024', '202406',
    'June 1, 2024', 'Jun 1, 2024', 'Saturday, June 1, 2024', '1 June 2024', '06/01/2024', '2024-06-01T12:00:00.000Z', '2024-06-01T07:00:00-07:00']) {
    assert.equal(P.parseMonth(v), '2024-06', v);
  }
  assert.equal(P.parseMonth('nonsense'), null);
});

test('linear trend matches a hand-computed least-squares fit', () => {
  const t = P.linearTrend([{ value: 1 }, { value: 3 }, { value: 2 }, { value: 5 }]);
  assert.equal(t.slope.toFixed(4), '1.1000');
  assert.equal(t.intercept.toFixed(4), '1.1000');
});

test('summary sentences use the right change wording per metric', () => {
  const d = P.buildData(tabs).data;
  assert.equal(
    P.summarize(d.cascades.ridership, 'ridership'),
    'Latest month, July 2026: 9,032, down 7.1% from June 2026 and up 4.1% from July 2025. The trend from June 2024 to July 2026 is upward.'
  );
  assert.match(P.summarize(d.eastern['on-time-performance'], 'on-time-performance'), /94\.0%, down 2\.9 percentage points from June 2026 and up 10\.3 percentage points from July 2025/);
  assert.match(P.summarize(d.northwest['cost-per-mile'], 'cost-per-mile'), /\$1\.44, down \$0\.53 from May 2026 and down \$0\.19 from June 2025/);
});

test('niceTicks starts at zero and covers the max', () => {
  const t = P.niceTicks(0, 10455 * 1.08, 5);
  assert.equal(t[0], 0);
  assert.ok(t.at(-1) >= 10455);
});

// ------------------------------------------------------------------
// Webflow CMS records (the hidden Collection List)
// ------------------------------------------------------------------

function cmsRecords() {
  // Mirrors the Performance Data collection: one record per month, values
  // as Webflow prints them, empty string for an empty field.
  const months = {};
  for (const [metric, m] of Object.entries(P.metrics)) {
    const rows = P.parseCsv(tabs[metric]);
    const hdr = rows[0];
    for (const r of rows.slice(1)) {
      if (!r[0]) continue;
      const key = P.parseMonth(r[0]);
      const rec = (months[key] = months[key] || { month: key + '-01T12:00:00.000Z', name: P.monthLabel(key), values: {} });
      hdr.forEach((h, i) => {
        const route = h.toLowerCase();
        if (P.routes[route]) rec.values[route + '-' + m.field] = String(r[i]).replace(/[$%]/g, '');
      });
    }
  }
  return Object.values(months);
}

test('CMS records produce the same data as the spreadsheet', () => {
  const fromCms = P.buildDataFromRecords(cmsRecords());
  assert.deepEqual(fromCms.warnings, []);
  assert.deepEqual(fromCms.data, P.buildData(tabs).data);
});

test('CMS records: order does not matter, Month wins over Name', () => {
  const recs = cmsRecords().reverse();
  recs[0].name = 'Typo Name';
  const r = P.buildDataFromRecords(recs);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.data.cascades.ridership.at(-1).month, '2026-07');
});

test('CMS records: Name is the fallback when Month is unreadable', () => {
  const r = P.buildDataFromRecords([{ month: '', name: 'August 2026', values: { 'cascades-ridership': '9100' } }]);
  assert.deepEqual(r.data.cascades.ridership, [{ month: '2026-08', value: 9100 }]);
});

test('CMS records: a month with no usable date is skipped with a warning', () => {
  const r = P.buildDataFromRecords([{ month: '', name: 'New item', values: { 'cascades-ridership': '1' } }]);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.data, {});
});

test('CMS records: thousands separators and a duplicate month', () => {
  const r = P.buildDataFromRecords([
    { month: 'July 1, 2026', name: 'July 2026', values: { 'cascades-ridership': '9,032' } },
    { month: 'July 1, 2026', name: 'July 2026 (copy)', values: { 'cascades-ridership': '9,033' } }
  ]);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.data.cascades.ridership[0].value, 9033);
});

test('dollar axes always show cents, whatever the tick step', () => {
  assert.equal(P.formatValue(0.5, 'cost-per-mile', { axis: true, step: 0.5 }), '$0.50');
  assert.equal(P.formatValue(2, 'cost-per-mile', { axis: true, step: 1 }), '$2.00');
  assert.equal(P.formatValue(0, 'cost-per-mile', { axis: true, step: 1 }), '$0.00');
});

test('each chart shows the latest 24 months of its own route', () => {
  const d = P.recentMonths(P.buildData(tabs).data);
  assert.equal(P.monthsShown, 24);
  assert.equal(d.cascades.ridership.length, 24);
  assert.equal(d.cascades.ridership[0].month, '2024-08');
  assert.equal(d.cascades.ridership.at(-1).month, '2026-07');
  // NorthWest hasn't reported July 2026, so its window ends and starts a month earlier and still holds 24 months.
  assert.equal(d.northwest['cost-per-mile'].length, 24);
  assert.equal(d.northwest['cost-per-mile'][0].month, '2024-07');
  assert.equal(d.northwest['cost-per-mile'].at(-1).month, '2026-06');
});

test('the 24-month window moves forward when a new month is added', () => {
  const recs = cmsRecords();
  recs.push({ month: 'August 1, 2026', name: 'August 2026', values: { 'cascades-ridership': '9100' } });
  const d = P.recentMonths(P.buildDataFromRecords(recs).data);
  assert.equal(d.cascades.ridership[0].month, '2024-09');
  assert.equal(d.cascades.ridership.at(-1).month, '2026-08');
  assert.equal(d.cascades.ridership.length, 24);
  // Other routes didn't report August, so their windows don't move.
  assert.equal(d.eastern.ridership[0].month, '2024-08');
  assert.equal(d.eastern.ridership.at(-1).month, '2026-07');
});

test('a window that starts on a gap trims the leading blank month', () => {
  const data = { cascades: { ridership: [
    { month: '2024-01', value: 1 }, { month: '2024-02', value: null }, { month: '2024-03', value: 3 }, { month: '2024-04', value: 4 }
  ] } };
  assert.deepEqual(P.recentMonths(data, 3).cascades.ridership.map((p) => p.month), ['2024-03', '2024-04']);
});
