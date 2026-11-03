/*!
 * POINT Performance Charts v0.4.0
 * Accessible, dependency-free line charts for oregon-point.com/performance.
 *
 * Replaces the Looker Studio iframes. Data comes from the "Performance Data"
 * CMS collection, rendered into the page by a hidden Collection List, so the
 * page makes no runtime request for data. Each chart gets a data table and a
 * screen-reader summary (the WCAG 1.1.1 text alternative).
 *
 * Chart markup (one per chart):
 *   <div data-point-chart data-route="cascades" data-metric="ridership"></div>
 *   Optional: data-heading-level="3" (2 to 6), data-title="..."
 *
 * Data markup (one per Performance Data item, inside a hidden list):
 *   <div data-perf-item data-month="{Month}" data-name="{Name}"
 *        data-cascades-ridership="{Cascades Ridership}" ... ></div>
 *   Attribute names are data- plus the CMS field slug. Empty = no data.
 *
 * Local prototype only: window.POINT_PERFORMANCE_TABS ({ metricKey: csvText }).
 *
 * Loaded as a classic script (Webflow hosted scripts), so it stays an IIFE
 * rather than an ES module. Syntax is ES2015+, which every browser that
 * supports the CSS variables and ResizeObserver used here also supports.
 */
((global) => {
  'use strict';

  const VERSION = '0.4.0';

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  const ROUTES = {
    cascades: 'Cascades (Portland-Eugene)',
    eastern: 'Eastern (Bend-Ontario)',
    northwest: 'NorthWest (Portland-Astoria)',
    southwest: 'SouthWest (Klamath Falls-Brookings)',
  };

  // `field` is the CMS field slug suffix ({route}-{field}). `sheet` is the
  // Google Sheet tab name (local prototype only). `kind` drives number
  // formatting, the change wording in the summary and the y-axis range.
  const METRICS = {
    ridership: { label: 'Monthly Ridership', field: 'ridership', sheet: 'Ridership', kind: 'count' },
    'on-time-performance': { label: 'On-time Performance', field: 'on-time', sheet: 'On-Time Performance', kind: 'percent', decimals: 1 },
    'farebox-recovery': { label: 'Farebox Recovery', field: 'farebox', sheet: 'Farebox Recovery', kind: 'percent', decimals: 1 },
    'cost-per-mile': { label: 'Cost per Mile', field: 'cost-per-mile', sheet: 'Cost Per Mile', kind: 'currency', decimals: 2 },
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // The charts always cover the latest 24 months in the data. The window is
  // shared: it ends at the newest month any route has reported, so every chart
  // on a page covers the same period. A route that hasn't reported that month
  // yet ends one month earlier.
  const MONTHS_SHOWN = 24;

  // ------------------------------------------------------------------
  // Pure helpers (exported for tests)
  // ------------------------------------------------------------------

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /** RFC 4180-style CSV parser (same behavior as load-route-schedules.js). */
  function parseCsv(text) {
    if (typeof text !== 'string') return [];
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field.trim());
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) {
      row.push(field.trim());
      rows.push(row);
    }
    return rows;
  }

  function monthFromName(name) {
    const n = String(name).slice(0, 3).toLowerCase();
    const i = MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === n);
    return i + 1;
  }

  /** Normalizes a month or date value to "YYYY-MM", or returns null. */
  function parseMonth(value) {
    if (!value) return null;
    // Drop a leading weekday ("Wednesday, July 1, 2026").
    const s = String(value).trim().replace(/^[A-Za-z]+day,?\s+/i, '');
    let m;
    let year;
    let month;
    if ((m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s))) {
      [year, month] = [+m[1], +m[2]];
    } else if ((m = /^(\d{4})(\d{2})$/.exec(s))) {
      [year, month] = [+m[1], +m[2]];
    } else if ((m = /^(\d{1,2})\/(?:(\d{1,2})\/)?(\d{2}|\d{4})$/.exec(s))) {
      [month, year] = [+m[1], +m[3]];
      if (year < 100) year += 2000;
    } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s))) {
      [month, year] = [+m[1], +m[3]];
    } else if ((m = /^([A-Za-z]{3,9})\.?,?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})$/.exec(s))) {
      // "Jul 2026", "July 1, 2026", "Jul 1 2026"
      [month, year] = [monthFromName(m[1]), +m[3]];
    } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
      // "1 July 2026"
      [month, year] = [monthFromName(m[2]), +m[3]];
    } else {
      return null;
    }
    if (!(month >= 1 && month <= 12) || year < 2000 || year > 2100) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  function monthLabel(key, style) {
    const [year, mo] = key.split('-');
    const name = MONTHS[+mo - 1];
    return `${style === 'short' ? name.slice(0, 3) : name} ${year}`;
  }

  function monthsBetween(a, b) {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }

  function shiftMonth(key, delta) {
    const [y, mo] = key.split('-').map(Number);
    const total = y * 12 + (mo - 1) + delta;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  function parseNumber(value) {
    if (value == null) return { value: null, percentSign: false };
    const s = String(value).trim();
    if (!s || s === '-' || /^n\/?a$/i.test(s)) return { value: null, percentSign: false };
    const percentSign = s.includes('%');
    const negative = /^\(.*\)$/.test(s);
    const n = Number(s.replace(/[$,%\s()]/g, ''));
    if (!Number.isFinite(n)) return { value: NaN, percentSign };
    return { value: negative ? -n : n, percentSign };
  }

  function routeKeyFor(value) {
    const s = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return null;
    if (s.startsWith('cascade')) return 'cascades';
    for (const key of ['eastern', 'northwest', 'southwest']) if (s.startsWith(key)) return key;
    return null;
  }

  /** Fills missing months between the first and last key with null, then trims null ends. */
  function fillMonths(byMonth) {
    const months = Object.keys(byMonth).sort();
    const filled = [];
    for (let mo = months[0]; mo <= months[months.length - 1]; mo = shiftMonth(mo, 1)) {
      filled.push({ month: mo, value: byMonth[mo] ?? null });
    }
    return trimNulls(filled);
  }

  function trimNulls(points) {
    while (points.length && points[0].value === null) points.shift();
    while (points.length && points[points.length - 1].value === null) points.pop();
    return points;
  }

  /**
   * Reads one metric tab: a Date column plus one column per route.
   *   Date | Cascades | NorthWest | Eastern | SouthWest
   * Returns { series: { route: [{month, value}] }, errors, warnings }.
   * Months with no value become null (a gap). Trailing empty months are
   * trimmed per route, so a route that hasn't reported yet ends earlier.
   */
  function normalizeMetricTable(rows, metricKey) {
    const m = METRICS[metricKey];
    const errors = [];
    const warnings = [];
    const series = {};
    const body = (rows ?? []).filter((r) => r.some((c) => c !== ''));
    if (!body.length) {
      errors.push(`${m.sheet}: the tab is empty.`);
      return { series, errors, warnings };
    }
    const header = body.shift();
    let dateCol = -1;
    const routeCols = {};
    header.forEach((h, i) => {
      if (dateCol < 0 && /^(date|month|period)$/i.test(h)) dateCol = i;
      const key = routeKeyFor(h);
      if (key && routeCols[key] === undefined) routeCols[key] = i;
    });
    if (dateCol < 0) errors.push(`${m.sheet}: no "Date" column in the header row.`);
    for (const key of Object.keys(ROUTES)) {
      if (routeCols[key] === undefined) warnings.push(`${m.sheet}: no column for ${ROUTES[key]}.`);
    }
    if (errors.length) return { series, errors, warnings };

    // Percent tabs: if no cell has a % sign and every value is <= 1, the
    // sheet stores fractions (0.78). Scale those to 78.
    let scale = 1;
    if (m.kind === 'percent') {
      let sawSign = false;
      let max = -Infinity;
      for (const r of body) {
        for (const col of Object.values(routeCols)) {
          const p = parseNumber(r[col]);
          if (p.percentSign) sawSign = true;
          if (p.value != null && Number.isFinite(p.value)) max = Math.max(max, Math.abs(p.value));
        }
      }
      if (!sawSign && max <= 1) scale = 100;
    }

    const byRoute = Object.fromEntries(Object.keys(routeCols).map((key) => [key, {}]));
    body.forEach((r, i) => {
      const sheetRow = i + 2;
      const month = parseMonth(r[dateCol]);
      if (!month) {
        warnings.push(`${m.sheet} row ${sheetRow}: could not read the date "${r[dateCol]}". Row skipped.`);
        return;
      }
      for (const [key, col] of Object.entries(routeCols)) {
        const raw = r[col];
        const p = parseNumber(raw);
        if (p.value !== null && !Number.isFinite(p.value)) {
          warnings.push(`${m.sheet} row ${sheetRow}: "${raw}" is not a number (${ROUTES[key]}).`);
          p.value = null;
        }
        if (byRoute[key][month] !== undefined) {
          warnings.push(`${m.sheet}: two rows for ${monthLabel(month)}. Using the later one.`);
        }
        byRoute[key][month] = p.value === null ? null : p.value * scale;
      }
    });

    for (const [key, byMonth] of Object.entries(byRoute)) {
      if (!Object.keys(byMonth).length) continue;
      const filled = fillMonths(byMonth);
      if (filled.length) series[key] = filled;
    }
    return { series, errors, warnings };
  }

  /**
   * Combines tab CSVs into { data: { route: { metric: points } }, errors, warnings, failed }.
   * `tabs` is { metricKey: csvText }. A tab that can't be read is listed in
   * `failed` so its charts can show an error while the rest still render.
   */
  function buildData(tabs) {
    const data = {};
    let errors = [];
    let warnings = [];
    const failed = [];
    for (const metricKey of Object.keys(METRICS)) {
      if (typeof tabs[metricKey] !== 'string') {
        failed.push(metricKey);
        continue;
      }
      const result = normalizeMetricTable(parseCsv(tabs[metricKey]), metricKey);
      errors = errors.concat(result.errors);
      warnings = warnings.concat(result.warnings);
      if (result.errors.length) {
        failed.push(metricKey);
        continue;
      }
      for (const [route, points] of Object.entries(result.series)) {
        (data[route] ??= {})[metricKey] = points;
      }
    }
    return { data, errors, warnings, failed };
  }

  /** Least-squares line over the points that have values. Returns {slope, intercept} in index units, or null. */
  function linearTrend(points) {
    const xs = [];
    const ys = [];
    points.forEach((p, i) => {
      if (p.value !== null && Number.isFinite(p.value)) {
        xs.push(i);
        ys.push(p.value);
      }
    });
    const n = xs.length;
    if (n < 2) return null;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sx += xs[i];
      sy += ys[i];
      sxy += xs[i] * ys[i];
      sxx += xs[i] * xs[i];
    }
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    const slope = (n * sxy - sx * sy) / denom;
    return { slope, intercept: (sy - slope * sx) / n, firstIndex: xs[0], lastIndex: xs[n - 1] };
  }

  /** "Nice" axis ticks from min to a rounded max, about `count` intervals. */
  function niceTicks(min, max, count = 5) {
    if (!(max > min)) max = min + 1;
    const rough = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const norm = rough / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  function axisDecimals(step, m) {
    // Always show cents on dollar axes so every Cost per Mile chart matches.
    if (m.kind === 'currency') return 2;
    if (!step || step >= 1) return 0;
    return Math.min(2, Math.ceil(-Math.log10(step)));
  }

  function formatValue(value, metric, opts = {}) {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'No data';
    const m = typeof metric === 'string' ? METRICS[metric] : metric;
    const d = opts.axis ? axisDecimals(opts.step, m) : m.decimals ?? 0;
    const n = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sign = value < 0 ? '-' : '';
    const out = m.kind === 'currency' ? `${sign}$${n}` : m.kind === 'percent' ? `${sign}${n}%` : `${sign}${n}`;
    return opts.withUnit && m.unit ? `${out} ${m.unit}` : out;
  }

  function lastWithValue(points, beforeIndex = points.length) {
    for (let i = beforeIndex - 1; i >= 0; i--) {
      if (points[i].value !== null) return i;
    }
    return -1;
  }

  function describeChange(current, previous, metric) {
    const m = METRICS[metric];
    const diff = current - previous;
    const dir = diff > 0 ? 'up' : 'down';
    if (m.kind === 'percent') {
      const pts = Math.abs(diff).toFixed(m.decimals ?? 0);
      if (Number(pts) === 0) return 'unchanged';
      return `${dir} ${pts} percentage point${Number(pts) === 1 ? '' : 's'}`;
    }
    if (m.kind === 'currency') {
      const dollars = Math.abs(diff).toFixed(2);
      if (dollars === '0.00') return 'unchanged';
      return `${dir} $${dollars}`;
    }
    if (!previous) return diff ? `${dir} ${Math.abs(diff).toLocaleString('en-US')}` : 'unchanged';
    const pct = (Math.abs(diff) / Math.abs(previous)) * 100;
    if (pct < 0.05) return 'unchanged';
    return `${dir} ${pct.toFixed(1)}%`;
  }

  /** One- to three-sentence plain-language summary of a series. */
  function summarize(points, metric) {
    const li = lastWithValue(points);
    if (li < 0) return 'No data is available yet.';
    const latest = points[li];
    let text = `Latest month, ${monthLabel(latest.month)}: ${formatValue(latest.value, metric)}`;

    const clauses = [];
    const pi = lastWithValue(points, li);
    if (pi >= 0 && monthsBetween(points[pi].month, latest.month) === 1) {
      clauses.push(`${describeChange(latest.value, points[pi].value, metric)} from ${monthLabel(points[pi].month)}`);
    }
    const yoyKey = shiftMonth(latest.month, -12);
    const yoy = points.find((p) => p.month === yoyKey && p.value !== null);
    if (yoy) clauses.push(`${describeChange(latest.value, yoy.value, metric)} from ${monthLabel(yoyKey)}`);
    text += clauses.length ? `, ${clauses.join(' and ')}.` : '.';

    const t = linearTrend(points);
    const values = points.filter((p) => p.value !== null);
    if (t && values.length >= 3) {
      const mean = values.reduce((s, p) => s + p.value, 0) / values.length;
      const span = t.slope * (t.lastIndex - t.firstIndex);
      const relative = mean ? Math.abs(span / mean) : 0;
      const direction = relative < 0.03 ? 'roughly flat' : span > 0 ? 'upward' : 'downward';
      text += ` The trend from ${monthLabel(points[t.firstIndex].month)} to ${monthLabel(points[t.lastIndex].month)} is ${direction}.`;
    }
    return text;
  }

  /**
   * Builds { data, errors, warnings } from CMS records, one per month:
   *   [{ month: "July 1, 2026", name: "July 2026", values: { "cascades-ridership": "9032", ... } }]
   * The Month date is the source of truth; the item Name is the fallback.
   */
  function buildDataFromRecords(records) {
    const warnings = [];
    const byKey = {};
    const seen = new Set();
    (records ?? []).forEach((rec, i) => {
      const month = parseMonth(rec.month) || parseMonth(rec.name);
      const label = rec.name || `item ${i + 1}`;
      if (!month) {
        warnings.push(`${label}: could not read the Month "${rec.month ?? ''}". Item skipped.`);
        return;
      }
      if (seen.has(month)) warnings.push(`${monthLabel(month)} appears twice. Using ${label}.`);
      seen.add(month);
      for (const route of Object.keys(ROUTES)) {
        for (const [metric, def] of Object.entries(METRICS)) {
          const raw = rec.values?.[`${route}-${def.field}`];
          const p = parseNumber(raw);
          if (p.value !== null && !Number.isFinite(p.value)) {
            warnings.push(`${label}: "${raw}" is not a number (${ROUTES[route]}, ${def.label}).`);
            p.value = null;
          }
          (byKey[`${route}|${metric}`] ??= {})[month] = p.value;
        }
      }
    });
    const data = {};
    for (const [k, byMonth] of Object.entries(byKey)) {
      const [route, metric] = k.split('|');
      const filled = fillMonths(byMonth);
      if (filled.length) (data[route] ??= {})[metric] = filled;
    }
    return { data, errors: [], warnings };
  }

  /** Trims every series to the latest `months` months (default 24) across all routes and metrics. */
  function recentMonths(data, months = MONTHS_SHOWN) {
    let latest = '';
    for (const metrics of Object.values(data)) {
      for (const s of Object.values(metrics)) {
        if (s.length && s[s.length - 1].month > latest) latest = s[s.length - 1].month;
      }
    }
    if (!latest) return data;
    const start = shiftMonth(latest, -(months - 1));
    const out = {};
    for (const [route, metrics] of Object.entries(data)) {
      for (const [metric, points] of Object.entries(metrics)) {
        const s = trimNulls(points.filter((p) => p.month >= start && p.month <= latest));
        if (s.length) (out[route] ??= {})[metric] = s;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Exports for Node tests
  // ------------------------------------------------------------------

  const api = {
    version: VERSION,
    routes: ROUTES,
    metrics: METRICS,
    parseCsv,
    parseMonth,
    parseNumber,
    normalizeMetricTable,
    buildData,
    linearTrend,
    niceTicks,
    formatValue,
    summarize,
    monthLabel,
    shiftMonth,
    escapeHtml,
    buildDataFromRecords,
    recentMonths,
    monthsShown: MONTHS_SHOWN,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.PointPerformance = api;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // ------------------------------------------------------------------
  // Browser only from here down
  // ------------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const CSS = `
.pc{--pc-line:var(--base-color-brand--blue,#006595);--pc-trend:var(--base-color-brand--dark-gold,#806d44);--pc-ink:var(--base-color-brand--black,#212121);--pc-muted:var(--base-color-neutral--neutral-dark,#444);--pc-grid:var(--base-color-neutral--neutral-light,#e0e0e0);--pc-focus:var(--base-color-brand--dark-blue,#00293e);--pc-tip-bg:var(--base-color-brand--dark-blue,#00293e);--pc-surface:#fff;margin:0 0 2.5rem;padding:1.25rem 1.25rem 1rem;background:var(--pc-surface);border:1px solid var(--pc-grid);border-radius:.5rem;color:var(--pc-ink);font:inherit}
.pc__head{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;align-items:baseline;justify-content:space-between;margin:0 0 1rem}
.pc__title{margin:0;font-size:1.25rem;line-height:1.4;font-weight:700;color:var(--pc-ink)}
.pc__legend{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;margin:0;padding:0;list-style:none;font-size:.875rem;color:var(--pc-muted)}
.pc__legend li{display:flex;align-items:center;gap:.5rem;margin:0}
.pc__key{display:inline-block;width:1.75rem;height:0;border-top:3px solid var(--pc-line)}
.pc__key--trend{border-top:2px dashed var(--pc-trend)}
.pc__plot{position:relative;border-radius:.25rem;outline:none;touch-action:pan-y}
.pc__plot:focus-visible{outline:3px solid var(--pc-focus);outline-offset:4px}
.pc__plot svg{display:block;width:100%;overflow:visible}
.pc__axis{fill:var(--pc-muted);font-size:13px;font-family:inherit}
.pc__grid{stroke:var(--pc-grid);stroke-width:1;shape-rendering:crispEdges}
.pc__baseline{stroke:#767676;stroke-width:1;shape-rendering:crispEdges}
.pc__tick{stroke:#767676;stroke-width:1;shape-rendering:crispEdges}
.pc__line{fill:none;stroke:var(--pc-line);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.pc__trend{fill:none;stroke:var(--pc-trend);stroke-width:2;stroke-dasharray:7 5}
.pc__marker{fill:var(--pc-line);stroke:#fff;stroke-width:1.5}
.pc__cursor{stroke:var(--pc-muted);stroke-width:1;shape-rendering:crispEdges}
.pc__active{fill:var(--pc-line);stroke:#fff;stroke-width:2.5}
.pc__hint{position:absolute;right:0;top:0;margin:0;padding:0 .25rem;background:var(--pc-surface);font-size:.8125rem;line-height:1.5;color:var(--pc-muted);opacity:0;pointer-events:none}
.pc__stop{stop-color:var(--pc-line)}
.pc__plot:focus-visible .pc__hint{opacity:1}
.pc__tip{position:absolute;z-index:2;left:0;top:0;min-width:9rem;padding:.625rem .75rem;border-radius:.375rem;background:var(--pc-tip-bg);color:#fff;font-size:.875rem;line-height:1.4;pointer-events:none;white-space:nowrap;opacity:0;transform:translate(-50%,calc(-100% - 12px));border:1px solid transparent}
.pc__tip[data-open="true"]{opacity:1}
.pc__tip-month{display:block;font-weight:600}
.pc__tip-value{display:block}
@media (prefers-reduced-motion:no-preference){.pc__tip{transition:opacity .15s ease}.pc__tip[data-moving="true"]{transition:opacity .15s ease,left .2s ease,top .2s ease}.pc__caret{transition:transform .2s ease}}
.pc__details{margin-top:1rem;border-top:1px solid var(--pc-grid);padding-top:.75rem}
.pc__details summary{display:flex;align-items:center;gap:.375rem;list-style:none;cursor:pointer;color:var(--link-color--link-primary,#006595);font-weight:600;text-decoration:underline;text-underline-offset:.15em;width:max-content;max-width:100%}
.pc__details summary::-webkit-details-marker{display:none}
.pc__details summary::marker{content:""}
.pc__caret{flex:none;width:1rem;height:1rem}
.pc__details[open] .pc__caret{transform:rotate(180deg)}
.pc__details summary:focus-visible{outline:3px solid var(--pc-focus);outline-offset:3px;border-radius:2px}
.pc__table-wrap{margin-top:.75rem;max-height:24rem;overflow:auto;border:1px solid var(--pc-grid);border-radius:.25rem}
.pc__table-wrap:focus-visible{outline:3px solid var(--pc-focus);outline-offset:2px}
.pc__table{width:100%;border-collapse:collapse;font-size:.9375rem}
.pc__table caption{text-align:left;font-weight:600;padding:.5rem .75rem}
.pc__table th,.pc__table td{padding:.375rem .75rem;border-top:1px solid var(--pc-grid);text-align:left}
.pc__table thead th{position:sticky;top:0;background:#f6f7f9;border-top:0}
.pc__table td{text-align:right;font-variant-numeric:tabular-nums}
.pc__table thead th:last-child{text-align:right}
.pc__status{margin:0;padding:2rem 0;color:var(--pc-muted)}
.pc__status--error{color:var(--base-color-system--error-red,#9d3d4d);font-weight:600}
@media (forced-colors:active){.pc__line,.pc__trend,.pc__cursor,.pc__baseline,.pc__tick{stroke:CanvasText}.pc__marker,.pc__active{fill:CanvasText;stroke:Canvas}.pc__axis{fill:CanvasText}.pc__stop{stop-color:Canvas}.pc__key{border-top-color:CanvasText}}
@media (max-width:480px){.pc{padding:1rem .75rem .75rem}.pc__title{font-size:1.125rem}}
.pc__sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

  function injectStyles() {
    if (document.getElementById('point-performance-styles')) return;
    const style = document.createElement('style');
    style.id = 'point-performance-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function headingTag(el) {
    const level = parseInt(el.getAttribute('data-heading-level'), 10);
    return `h${level >= 2 && level <= 6 ? level : 3}`;
  }

  const CARET_SVG =
    '<svg class="pc__caret" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2.56 6.3a.25.25 0 0 1 0-.36l.88-.88a.25.25 0 0 1 .36 0L8 9.26l4.2-4.2a.25.25 0 0 1 .36 0l.88.88a.25.25 0 0 1 0 .36l-5.26 5.26a.25.25 0 0 1-.36 0z"/></svg>';

  // Only one tooltip is open at a time, so Escape can always close it (WCAG 1.4.13).
  let openChart = null;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openChart) openChart.hide();
  });

  class Chart {
    constructor(el, routeKey, metricKey, points) {
      this.el = el;
      this.route = routeKey;
      this.metric = metricKey;
      this.m = METRICS[metricKey];
      this.points = points;
      this.trend = linearTrend(points);
      this.active = -1;
      this.id = `pc${++uid}`;
      this.build();
    }

    build() {
      const { m, points, id } = this;
      const routeName = ROUTES[this.route];
      const title = this.el.getAttribute('data-title') || m.label;
      const h = headingTag(this.el);
      const range = `${monthLabel(points[0].month)} to ${monthLabel(points[points.length - 1].month)}`;

      const rows = points.map((p) => `<tr><th scope="row">${monthLabel(p.month)}</th><td>${escapeHtml(formatValue(p.value, m))}</td></tr>`).join('');
      const trendKey = this.trend ? '<li><span class="pc__key pc__key--trend" aria-hidden="true"></span>Trend</li>' : '';

      this.el.innerHTML =
        `<figure class="pc" aria-labelledby="${id}-t">` +
        `<div class="pc__head"><${h} class="pc__title" id="${id}-t">${escapeHtml(title)}<span class="pc__sr">, ${escapeHtml(routeName)}</span></${h}>` +
        `<ul class="pc__legend" aria-label="Legend"><li><span class="pc__key" aria-hidden="true"></span>${escapeHtml(m.label)}</li>${trendKey}</ul></div>` +
        `<p class="pc__sr" id="${id}-s">${escapeHtml(summarize(points, this.metric))}</p>` +
        `<div class="pc__plot" tabindex="0" role="group" aria-roledescription="chart" aria-label="${escapeHtml(`${title} chart, ${routeName}, ${range}. Use the left and right arrow keys to read each month.`)}">` +
        '<p class="pc__hint" aria-hidden="true">Arrow keys: move · Esc: close</p>' +
        '<div class="pc__tip" aria-hidden="true"><span class="pc__tip-month"></span><span class="pc__tip-value"></span></div></div>' +
        '<p class="pc__sr" aria-live="polite" aria-atomic="true"></p>' +
        `<details class="pc__details"><summary><span>Show data table<span class="pc__sr"> for ${escapeHtml(`${title}, ${routeName}`)}</span></span>${CARET_SVG}</summary>` +
        `<div class="pc__table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(`${title} data, ${routeName}`)}">` +
        `<table class="pc__table"><caption>${escapeHtml(`${title}, ${routeName}, ${range}`)}</caption>` +
        `<thead><tr><th scope="col">Month</th><th scope="col">${escapeHtml(m.label)}</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div></details></figure>`;

      this.plot = this.el.querySelector('.pc__plot');
      this.tip = this.el.querySelector('.pc__tip');
      this.tipMonth = this.el.querySelector('.pc__tip-month');
      this.tipValue = this.el.querySelector('.pc__tip-value');
      this.live = this.el.querySelector('[aria-live]');

      this.plot.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') this.showAt(e.clientX);
      });
      this.plot.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') this.showAt(e.clientX);
      });
      this.plot.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && document.activeElement !== this.plot) this.hide();
      });
      this.plot.addEventListener('keydown', (e) => this.onKey(e));
      this.plot.addEventListener('blur', () => this.hide());
      document.addEventListener('pointerdown', (e) => {
        if (this.active >= 0 && !this.plot.contains(e.target)) this.hide();
      });

      this.draw();
      if (typeof ResizeObserver !== 'undefined') {
        let raf = null;
        let lastWidth = this.plot.clientWidth;
        new ResizeObserver(() => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = null;
            if (this.plot.clientWidth !== lastWidth) {
              lastWidth = this.plot.clientWidth;
              this.draw();
            }
          });
        }).observe(this.plot);
      }
    }

    draw() {
      const { m, points: pts } = this;
      const n = pts.length;
      const width = Math.max(280, this.plot.clientWidth);
      const height = Math.round(Math.max(220, Math.min(380, width * 0.45)));

      // Y range: start at zero so line charts don't exaggerate change.
      const values = pts.map((p) => p.value).filter((v) => v !== null);
      if (this.trend) {
        const { intercept, slope, firstIndex, lastIndex } = this.trend;
        values.push(intercept + slope * firstIndex, intercept + slope * lastIndex);
      }
      const dataMax = Math.max(0, ...values);
      const dataMin = Math.min(0, ...values);
      const tickCount = width < 480 ? 4 : 5;
      let ticks = niceTicks(dataMin, dataMax * 1.08, tickCount);
      if (m.kind === 'percent' && dataMax <= 100 && ticks[ticks.length - 1] > 100) {
        ticks = niceTicks(dataMin, 100, tickCount);
      }
      const yMin = ticks[0];
      const yMax = ticks[ticks.length - 1];
      const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;

      const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
      const old = this.plot.querySelector('svg');
      if (old) this.plot.replaceChild(svg, old);
      else this.plot.insertBefore(svg, this.tip);

      // Measure y labels to size the left margin.
      const yLabels = ticks.map((t) => formatValue(t, m, { axis: true, step }));
      const probe = svgEl('text', { class: 'pc__axis' });
      svg.appendChild(probe);
      const measure = (text) => {
        probe.textContent = text;
        return probe.getComputedTextLength ? probe.getComputedTextLength() : text.length * 7;
      };
      const maxLabel = Math.max(0, ...yLabels.map(measure));
      const xLabelWidth = measure('Sep 2026');
      svg.removeChild(probe);

      // Left padding also fits half a month label, so the first month's label
      // is never dropped when the y-axis labels are short (e.g. "$0").
      const halfLabel = Math.ceil(xLabelWidth / 2) + 4;
      const pad = { top: 28, right: halfLabel, bottom: 34, left: Math.max(Math.ceil(maxLabel) + 12, halfLabel) };
      const pw = width - pad.left - pad.right;
      const ph = height - pad.top - pad.bottom;
      const x = (i) => pad.left + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = (v) => pad.top + ((yMax - v) / (yMax - yMin)) * ph;
      this.geom = { x, y, pad, pw, width };

      // Grid and y-axis labels.
      const grid = svgEl('g');
      ticks.forEach((t, i) => {
        const yy = Math.round(y(t)) + 0.5;
        grid.appendChild(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, class: t === 0 || i === 0 ? 'pc__baseline' : 'pc__grid' }));
        const label = svgEl('text', { x: pad.left - 10, y: yy, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'pc__axis' });
        label.textContent = yLabels[i];
        grid.appendChild(label);
      });
      svg.appendChild(grid);

      // X-axis: a tick for every month, and a label every 1, 2, 3, 4, 6, 8 or 12
      // months (the smallest step that fits), counted forward from the first
      // month. Gaps are always even, every chart starts with a label, and charts
      // that start in the same month label the same months. The latest month
      // gets a label only when it falls on the step.
      const xAxis = svgEl('g');
      const baseY = Math.round(y(yMin)) + 0.5;
      const spacingPerMonth = n > 1 ? pw / (n - 1) : pw;
      const steps = [1, 2, 3, 4, 6, 8, 12, 24];
      const monthStep = steps.find((s) => spacingPerMonth * s >= xLabelWidth + 14) ?? steps[steps.length - 1];
      pts.forEach((p, i) => {
        const tx = x(i);
        xAxis.appendChild(svgEl('line', { x1: tx, x2: tx, y1: baseY, y2: baseY + 4, class: 'pc__tick' }));
        // The right padding fits the last label; drop a first label that
        // would run off the left edge.
        if (i % monthStep !== 0 || tx - xLabelWidth / 2 < 0) return;
        const xl = svgEl('text', { x: tx, y: height - 6, 'text-anchor': 'middle', class: 'pc__axis' });
        xl.textContent = monthLabel(p.month, 'short');
        xAxis.appendChild(xl);
      });
      svg.appendChild(xAxis);

      // Area, line and markers, split into segments at missing months.
      const segments = [];
      let seg = [];
      pts.forEach((p, idx) => {
        if (p.value === null) {
          if (seg.length) segments.push(seg);
          seg = [];
        } else {
          seg.push(idx);
        }
      });
      if (seg.length) segments.push(seg);

      const gid = `${this.id}-g`;
      const defs = svgEl('defs');
      const grad = svgEl('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
      grad.appendChild(svgEl('stop', { offset: '0%', class: 'pc__stop', 'stop-opacity': '0.22' }));
      grad.appendChild(svgEl('stop', { offset: '100%', class: 'pc__stop', 'stop-opacity': '0.02' }));
      defs.appendChild(grad);
      svg.appendChild(defs);

      const series = svgEl('g');
      const base = y(Math.max(yMin, 0));
      for (const s of segments) {
        const d = s.map((idx, k) => `${k ? 'L' : 'M'}${x(idx).toFixed(1)} ${y(pts[idx].value).toFixed(1)}`).join(' ');
        if (s.length > 1) {
          series.appendChild(svgEl('path', { d: `${d} L${x(s[s.length - 1]).toFixed(1)} ${base} L${x(s[0]).toFixed(1)} ${base} Z`, fill: `url(#${gid})` }));
        }
        series.appendChild(svgEl('path', { d, class: 'pc__line' }));
      }
      svg.appendChild(series);

      if (this.trend) {
        const { intercept, slope, firstIndex, lastIndex } = this.trend;
        svg.appendChild(svgEl('line', { x1: x(firstIndex), y1: y(intercept + slope * firstIndex), x2: x(lastIndex), y2: y(intercept + slope * lastIndex), class: 'pc__trend' }));
      }

      const markers = svgEl('g');
      const r = pw / n < 14 ? 2.5 : 3.5;
      pts.forEach((p, idx) => {
        if (p.value !== null) markers.appendChild(svgEl('circle', { cx: x(idx), cy: y(p.value), r, class: 'pc__marker' }));
      });
      svg.appendChild(markers);

      // Hover cursor and active point.
      this.cursor = svgEl('line', { y1: pad.top, y2: pad.top + ph, class: 'pc__cursor', visibility: 'hidden' });
      this.dot = svgEl('circle', { r: 6, class: 'pc__active', visibility: 'hidden' });
      svg.appendChild(this.cursor);
      svg.appendChild(this.dot);

      if (this.active >= 0) {
        const keep = this.active;
        this.active = -1;
        this.show(keep, false, false);
      }
    }

    indexFromClientX(clientX) {
      const rect = this.plot.getBoundingClientRect();
      const { pad, pw } = this.geom;
      const n = this.points.length;
      const rel = (clientX - rect.left - pad.left) / pw;
      const idx = Math.round(Math.max(0, Math.min(1, rel)) * (n - 1));
      // Snap to the nearest month that has data.
      if (this.points[idx].value === null) {
        for (let d = 1; d < n; d++) {
          if (idx - d >= 0 && this.points[idx - d].value !== null) return idx - d;
          if (idx + d < n && this.points[idx + d].value !== null) return idx + d;
        }
      }
      return idx;
    }

    showAt(clientX) {
      this.show(this.indexFromClientX(clientX), true, false);
    }

    show(idx, animate, announce) {
      if (idx === this.active) return;
      const p = this.points[idx];
      const g = this.geom;
      const moving = animate && this.active >= 0;
      this.active = idx;
      if (openChart && openChart !== this) openChart.hide();
      openChart = this;

      const cx = g.x(idx);
      this.cursor.setAttribute('x1', cx);
      this.cursor.setAttribute('x2', cx);
      this.cursor.setAttribute('visibility', 'visible');

      const valueText = `${this.m.label}: ${formatValue(p.value, this.m)}`;
      this.tipMonth.textContent = monthLabel(p.month);
      this.tipValue.textContent = valueText;

      const cy = p.value === null ? g.pad.top + 20 : g.y(p.value);
      if (p.value === null) {
        this.dot.setAttribute('visibility', 'hidden');
      } else {
        this.dot.setAttribute('cx', cx);
        this.dot.setAttribute('cy', cy);
        this.dot.setAttribute('visibility', 'visible');
      }

      this.tip.setAttribute('data-moving', String(moving && !reduceMotion));
      this.tip.setAttribute('data-open', 'true');
      const half = this.tip.offsetWidth / 2;
      this.tip.style.left = `${Math.max(half, Math.min(g.width - half, cx))}px`;
      this.tip.style.top = `${Math.max(this.tip.offsetHeight + 12, cy)}px`;

      if (announce) this.live.textContent = `${monthLabel(p.month)}, ${valueText}`;
    }

    hide() {
      if (this.active < 0) return;
      this.active = -1;
      this.tip.setAttribute('data-open', 'false');
      this.tip.setAttribute('data-moving', 'false');
      this.cursor.setAttribute('visibility', 'hidden');
      this.dot.setAttribute('visibility', 'hidden');
      if (openChart === this) openChart = null;
    }

    onKey(e) {
      const n = this.points.length;
      let idx = this.active;
      switch (e.key) {
        case 'Escape':
          this.hide();
          return;
        case 'ArrowRight':
        case 'ArrowUp':
          idx = idx < 0 ? 0 : Math.min(n - 1, idx + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          idx = idx < 0 ? n - 1 : Math.max(0, idx - 1);
          break;
        case 'Home':
          idx = 0;
          break;
        case 'End':
          idx = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      this.show(idx, true, true);
    }
  }

  // ------------------------------------------------------------------
  // Data loading and page orchestration
  // ------------------------------------------------------------------

  function setStatus(el, message, isError) {
    el.innerHTML = `<p class="pc__status${isError ? ' pc__status--error' : ''}" role="${isError ? 'alert' : 'status'}">${escapeHtml(message)}</p>`;
  }

  const chartElements = (root = document) => [...root.querySelectorAll('[data-point-chart]')];

  const keysOf = (el) => ({
    route: (el.getAttribute('data-route') ?? '').toLowerCase(),
    metric: (el.getAttribute('data-metric') ?? '').toLowerCase(),
  });

  /** Renders every [data-point-chart] under root. `failed` lists metrics whose tab couldn't be loaded. */
  function renderAll(root, data, failed = []) {
    injectStyles();
    data = recentMonths(data);
    let count = 0;
    for (const el of chartElements(root)) {
      const { route, metric } = keysOf(el);
      if (!ROUTES[route] || !METRICS[metric]) {
        setStatus(el, 'Chart configuration error: unknown route or metric.', true);
        console.error(`[performance] unknown data-route "${route}" or data-metric "${metric}"`, el);
        continue;
      }
      if (failed.includes(metric)) {
        setStatus(el, `${METRICS[metric].label} data could not be loaded. Please refresh the page to try again.`, true);
        continue;
      }
      const points = data[route]?.[metric];
      if (!points?.length) {
        setStatus(el, `No ${METRICS[metric].label.toLowerCase()} data is available for ${ROUTES[route]} yet.`, false);
        continue;
      }
      el._pointChart = new Chart(el, route, metric, points);
      count++;
    }
    return count;
  }

  const logIssues = (result) => {
    if (result.warnings.length) console.warn(`[performance] data warnings:\n${result.warnings.join('\n')}`);
    if (result.errors.length) console.error(`[performance] data errors:\n${result.errors.join('\n')}`);
  };

  /** Parses tab CSVs ({ metricKey: csvText }) and renders. Metrics missing from `tabs` show an error. */
  function loadFromTabs(tabs, root, only) {
    const result = buildData(tabs);
    logIssues(result);
    const failed = result.failed.filter((k) => !only || only.includes(k));
    renderAll(root, result.data, failed);
    return result;
  }

  /** Reads the hidden Collection List: every [data-perf-item] element. */
  function readRecords(root = document) {
    const fields = Object.keys(ROUTES).flatMap((route) => Object.values(METRICS).map((m) => `${route}-${m.field}`));
    return [...root.querySelectorAll('[data-perf-item]')].map((el) => ({
      month: el.getAttribute('data-month'),
      name: el.getAttribute('data-name'),
      values: Object.fromEntries(fields.map((f) => [f, el.getAttribute(`data-${f}`)])),
    }));
  }

  function loadFromPage(root) {
    const result = buildDataFromRecords(readRecords(document));
    logIssues(result);
    renderAll(root, result.data, []);
    return result;
  }

  function init() {
    // The local review page drives rendering itself.
    if (window.POINT_PERFORMANCE_MANUAL) return;
    const els = chartElements();
    if (!els.length) return;
    injectStyles();
    if (document.querySelector('[data-perf-item]')) {
      loadFromPage(document);
    } else if (window.POINT_PERFORMANCE_TABS) {
      loadFromTabs(window.POINT_PERFORMANCE_TABS, document);
    } else {
      console.error('[performance] no data on the page. Add the Performance Data list ([data-perf-item] elements).');
      for (const el of els) setStatus(el, 'Performance data could not be loaded.', true);
    }
  }

  Object.assign(api, { renderAll, loadFromTabs, loadFromPage, readRecords });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
