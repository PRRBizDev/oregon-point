/*!
 * load-route-schedules.js v2.4.0
 * Oregon POINT route schedule tables.
 *
 * Renders schedule tables from a published Google Sheet CSV.
 *
 * v2.4.0 hardening (no architecture change):
 *   - Real CSV parser (quoted fields, embedded commas, "" escapes, CRLF, BOM).
 *     The previous regex silently dropped empty cells, which shifted every
 *     departure time one column left whenever an editor cleared a cell.
 *   - Validation: structural problems are reported instead of rendered wrong.
 *   - Last-known-good cache in localStorage: the page renders instantly from
 *     the last successful fetch and revalidates in the background. If Google
 *     is unreachable, riders still see a schedule.
 *   - Fetch retry with backoff and a per-attempt timeout. HTML interstitials
 *     served with a 200 are treated as failures.
 *   - Loading / loaded / error states announced through a live region
 *     (WCAG 2.1 SC 4.1.3 Status Messages).
 *   - Telemetry: pushes events to window.dataLayer (GTM) and window.gtag when
 *     present, and to an optional beacon URL, so failures are measurable.
 *   - Only the directions that exist for the current route are loaded.
 *
 * The pure functions (parseCsv, normalizeRows, validateRows, renderTableHtml)
 * are exposed as window.PointSchedules and as a CommonJS export so they can be
 * unit-tested in Node (`node --test`) and reused by tooling.
 */
(function (global) {
  'use strict';

  var VERSION = '2.4.0';

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  var SHEET_BASE =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vSFxEWKQ2-xBzt3yUZR3N2iCroPtJfmrMcLVXacEVAEaxhUZckJCOOvIshUEuJVi5v7CtlcNq_HjoyC/pub';

  var ROUTE_TO_GID = {
    northwest: { westbound: '936462530', eastbound: '1006324273' },
    cascades: { southbound: '61645532', northbound: '623966074' },
    eastern: { westbound: '192720227', eastbound: '994232038' },
    southwest: { westbound: '1727388931', eastbound: '1800641249' }
  };

  var FETCH_ATTEMPTS = 3;
  var FETCH_RETRY_DELAYS_MS = [0, 800, 2400];
  var FETCH_TIMEOUT_MS = 8000;
  var CACHE_PREFIX = 'pointSchedule:v1:';
  var MIN_COLUMNS = 4; // stop, address, url, at least one trip

  var NO_STOP_TOKENS = { '--': true, '–': true, '—': true };

  // ------------------------------------------------------------------
  // Pure helpers (no DOM)
  // ------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only http(s) links are allowed through. Anything else becomes ''.
  function safeUrl(url, base) {
    if (!url) return '';
    try {
      var parsed = base ? new URL(url, base) : new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * RFC 4180-style CSV parser. Preserves empty fields, handles quoted fields
   * with embedded commas/newlines, doubled-quote escapes, CRLF, and a BOM.
   * Returns an array of rows; each row is an array of trimmed strings.
   */
  function parseCsv(text) {
    if (typeof text !== 'string') return [];
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
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

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) if (row[i] !== '') return false;
    return true;
  }

  /**
   * Drops fully blank rows and pads every row to the header width so
   * column indexes are stable for the renderer.
   * Returns { header, rows } or null if there is no usable header.
   */
  function normalizeRows(rawRows) {
    var rows = [];
    for (var i = 0; i < rawRows.length; i++) {
      if (!isBlankRow(rawRows[i])) rows.push(rawRows[i].slice());
    }
    if (!rows.length) return null;
    var header = rows[0];
    var width = header.length;
    var body = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      while (row.length < width) row.push('');
      body.push(row);
    }
    return { header: header, rows: body };
  }

  function isBreakRow(row) {
    if (!row[0]) return false;
    for (var i = 1; i < row.length; i++) if (row[i] !== '') return false;
    return true;
  }

  function looksLikeTime(value) {
    return /\d{1,2}:\d{2}/.test(value);
  }

  /**
   * Structural validation. `errors` block rendering; `warnings` are reported
   * but the table still renders. Row numbers are 1-based sheet rows
   * (header = row 1) so they match what an editor sees in Google Sheets.
   */
  function validateRows(data) {
    var errors = [];
    var warnings = [];
    if (!data || !data.header) {
      errors.push('Sheet is empty.');
      return { errors: errors, warnings: warnings };
    }
    var width = data.header.length;
    if (width < MIN_COLUMNS) {
      errors.push('Header has ' + width + ' columns; expected at least ' + MIN_COLUMNS + ' (Stop, Address, Map URL, trip times).');
    }
    if (!data.rows.length) {
      errors.push('Sheet has a header but no stop rows.');
    }
    for (var i = 0; i < data.rows.length; i++) {
      var row = data.rows[i];
      var sheetRow = i + 2;
      if (row.length > width) {
        warnings.push('Row ' + sheetRow + ' has ' + row.length + ' cells but the header has ' + width + '. Extra cells are ignored.');
      }
      if (!row[0]) {
        warnings.push('Row ' + sheetRow + ' has no stop name.');
        continue;
      }
      if (isBreakRow(row)) continue;
      if (row[2] && !safeUrl(row[2])) {
        warnings.push('Row ' + sheetRow + ' map URL is not an http(s) link and will be dropped.');
      }
      for (var c = 3; c < width; c++) {
        var cell = row[c];
        if (cell === '') {
          warnings.push('Row ' + sheetRow + ', column ' + (c + 1) + ' is empty. Use "--" for no stop.');
        } else if (!NO_STOP_TOKENS[cell] && !looksLikeTime(cell)) {
          warnings.push('Row ' + sheetRow + ', column ' + (c + 1) + ' does not look like a time: "' + cell + '".');
        }
      }
    }
    return { errors: errors, warnings: warnings };
  }

  function timeCellHtml(content) {
    if (NO_STOP_TOKENS[content]) {
      return (
        '<td class="table_cell"><span aria-hidden="true">' + escapeHtml(content) + '</span>' +
        '<span class="schedule-visually-hidden">no stop</span></td>'
      );
    }
    return '<td class="table_cell">' + escapeHtml(content) + '</td>';
  }

  /**
   * Renders the schedule <table>. Expects normalized data.
   * `label` is used for the caption; `urlBase` resolves relative map links.
   */
  function renderTableHtml(data, label, urlBase) {
    var header = data.header;
    var width = header.length;
    var html = '<table class="tablepress">';
    html += '<caption class="schedule-visually-hidden">' + escapeHtml(label) + '</caption>';

    html += '<thead><tr>';
    html += '<th scope="col">Click address for map</th>';
    for (var h = 3; h < width; h++) {
      html += '<th scope="col">' + escapeHtml(header[h]) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var i = 0; i < data.rows.length; i++) {
      var row = data.rows[i];
      var stopName = row[0];
      if (!stopName) continue;
      var address = row[1];
      var url = safeUrl(row[2], urlBase);

      html += '<tr class="table_row ' + (i % 2 === 0 ? 'even' : 'odd') + '">';
      if (isBreakRow(row)) {
        // Rendered columns = 1 stop column + (width - 3) time columns.
        html +=
          '<td class="table_cell restroom-cell" colspan="' + (width - 2) + '">' +
          '<div class="restroom-note"><strong>' + escapeHtml(stopName) + '</strong></div></td>';
      } else {
        // Stop name is the row header so assistive tech associates each
        // departure time with its stop (WCAG 1.3.1).
        html += '<th scope="row" class="table_cell"><div><strong>' + escapeHtml(stopName) + '</strong></div>';
        if (url && address) {
          html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(address) + '</a>';
        } else if (address) {
          html += escapeHtml(address);
        }
        html += '</th>';
        for (var c = 3; c < width; c++) html += timeCellHtml(row[c]);
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function sheetUrlFor(gid) {
    return SHEET_BASE + '?gid=' + encodeURIComponent(gid) + '&output=csv';
  }

  var PointSchedules = {
    version: VERSION,
    routeToGidMap: ROUTE_TO_GID,
    sheetUrlFor: sheetUrlFor,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    parseCsv: parseCsv,
    normalizeRows: normalizeRows,
    validateRows: validateRows,
    renderTableHtml: renderTableHtml
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PointSchedules;
  if (global) global.PointSchedules = PointSchedules;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // ------------------------------------------------------------------
  // Browser only from here down
  // ------------------------------------------------------------------

  var SCHEDULE_ACCENT = '#0b5d8f';

  var SCROLL_UI_CSS =
    '.schedule-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.schedule-status{margin:0 0 8px;font-weight:600}' +
    '.schedule-status[data-state="loaded"],.schedule-status[data-state="idle"]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '.schedule-status[data-state="error"]{color:#8a1c1c}' +
    '.schedule-swipe-hint{display:none;margin:0 0 8px;font-size:0.875rem;font-weight:600;color:' + SCHEDULE_ACCENT + '}' +
    '@media (max-width:900px){.schedule-widget.is-scrollable .schedule-swipe-hint{display:block}}' +
    '.schedule-scrollbar{display:none;position:relative;height:16px;margin:0 0 8px;border-radius:8px;background:#dde5ea;cursor:pointer;touch-action:none}' +
    '.schedule-widget.is-scrollable .schedule-scrollbar{display:block}' +
    '.schedule-scrollbar-thumb{position:absolute;top:3px;bottom:3px;left:0;min-width:44px;border-radius:6px;background:' + SCHEDULE_ACCENT + '}' +
    '.schedule-scroll-outer{position:relative}' +
    '.schedule-scroll-outer::before,.schedule-scroll-outer::after{content:"";position:absolute;top:0;bottom:0;width:28px;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:3}' +
    '@media (prefers-reduced-motion:reduce){.schedule-scroll-outer::before,.schedule-scroll-outer::after{transition:none}}' +
    '.schedule-scroll-outer::before{left:0;background:linear-gradient(to right,rgba(0,0,0,.16),rgba(0,0,0,0))}' +
    '.schedule-scroll-outer::after{right:0;background:linear-gradient(to left,rgba(0,0,0,.16),rgba(0,0,0,0))}' +
    '.schedule-widget.can-scroll-left .schedule-scroll-outer::before{opacity:1}' +
    '.schedule-widget.can-scroll-right .schedule-scroll-outer::after{opacity:1}' +
    '.schedule-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}' +
    '.schedule-scroll:focus-visible{outline:2px solid ' + SCHEDULE_ACCENT + ';outline-offset:2px}' +
    '.schedule-scroll table.tablepress tbody th{background-color:transparent;text-align:left;font-weight:normal}' +
    '.schedule-scroll th:first-child,.schedule-scroll td:first-child{position:sticky;left:0;z-index:2}' +
    '.schedule-widget.can-scroll-left .schedule-scroll th:first-child,.schedule-widget.can-scroll-left .schedule-scroll td:first-child{box-shadow:3px 0 6px rgba(0,0,0,.12)}' +
    '.schedule-scroll td.restroom-cell{position:static}' +
    '.schedule-scroll .restroom-note{position:sticky;left:8px;display:inline-block}';

  // Version-aware so a stale stylesheet from an older script (for example
  // during side-by-side testing) is replaced rather than trusted.
  function injectStyles() {
    var style = document.getElementById('schedule-scroll-styles');
    if (style && style.getAttribute('data-version') === VERSION) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'schedule-scroll-styles';
      document.head.appendChild(style);
    }
    style.setAttribute('data-version', VERSION);
    style.textContent = SCROLL_UI_CSS;
  }

  // --- telemetry -----------------------------------------------------

  function report(eventName, params) {
    var payload = { event: eventName, schedule_version: VERSION, page_path: location.pathname };
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) payload[k] = params[k];
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(payload);
    } catch (e) {}
    try {
      if (typeof window.gtag === 'function') {
        var gaParams = {};
        for (var g in payload) if (g !== 'event') gaParams[g] = payload[g];
        window.gtag('event', eventName, gaParams);
      }
    } catch (e) {}
    try {
      var url = window.POINT_SCHEDULE_BEACON_URL;
      if (url && navigator.sendBeacon) {
        payload.ts = Date.now();
        navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      }
    } catch (e) {}
    if (window.POINT_SCHEDULE_DEBUG) console.info('[schedules]', eventName, payload);
  }

  // --- cache ---------------------------------------------------------

  function cacheGet(key) {
    try {
      var raw = window.localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && typeof obj.csv === 'string' ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, csv) {
    try {
      window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ csv: csv, ts: Date.now() }));
    } catch (e) {}
  }

  // --- network -------------------------------------------------------

  function fetchWithTimeout(url, ms) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, ms);
    var opts = controller ? { signal: controller.signal, credentials: 'omit' } : { credentials: 'omit' };
    return fetch(url, opts).then(
      function (res) {
        clearTimeout(timer);
        return res;
      },
      function (err) {
        clearTimeout(timer);
        throw err;
      }
    );
  }

  function fetchCsv(url) {
    var attempt = 0;
    function once() {
      var delay =
        attempt < FETCH_RETRY_DELAYS_MS.length
          ? FETCH_RETRY_DELAYS_MS[attempt]
          : FETCH_RETRY_DELAYS_MS[FETCH_RETRY_DELAYS_MS.length - 1];
      return new Promise(function (resolve) {
        setTimeout(resolve, delay);
      })
        .then(function () {
          return fetchWithTimeout(url, FETCH_TIMEOUT_MS);
        })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var contentType = res.headers.get('content-type') || '';
          return res.text().then(function (text) {
            if (/text\/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text)) {
              throw new Error('Unexpected HTML response');
            }
            return text;
          });
        })
        .catch(function (err) {
          attempt++;
          if (attempt < FETCH_ATTEMPTS) return once();
          err.attempts = attempt;
          throw err;
        });
    }
    return once();
  }

  // --- DOM: status + host --------------------------------------------

  function ensureParts(container) {
    var status = container.querySelector(':scope > .schedule-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'schedule-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('data-state', 'idle');
      container.insertBefore(status, container.firstChild);
    }
    var host = container.querySelector(':scope > .schedule-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'schedule-host';
      container.appendChild(host);
    }
    return { status: status, host: host };
  }

  function setStatus(status, state, text) {
    status.setAttribute('data-state', state);
    status.textContent = text;
  }

  // --- DOM: scroll widget (unchanged behavior from v2.3.0) -----------

  function paintStickyColumn(scroller) {
    var table = scroller.querySelector('table');
    if (!table) return;
    var isTransparent = function (c) {
      return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    };
    table.querySelectorAll('tr').forEach(function (tr) {
      var cell = tr.querySelector('th:first-child, td:first-child');
      if (!cell || cell.classList.contains('restroom-cell')) return;
      var bg = getComputedStyle(cell).backgroundColor;
      if (isTransparent(bg)) bg = getComputedStyle(tr).backgroundColor;
      if (isTransparent(bg)) bg = '#ffffff';
      cell.style.backgroundColor = bg;
    });
  }

  function buildScrollWidget(host, tableHtml, label) {
    if (typeof host._scheduleCleanup === 'function') host._scheduleCleanup();

    host.innerHTML =
      '<div class="schedule-widget">' +
      '<p class="schedule-swipe-hint"><span aria-hidden="true">↔</span> Scroll horizontally to view the full schedule</p>' +
      '<div class="schedule-scrollbar" aria-hidden="true"><div class="schedule-scrollbar-thumb"></div></div>' +
      '<div class="schedule-scroll-outer">' +
      '<div class="schedule-scroll" tabindex="0" role="region" aria-label="' + escapeHtml(label) + ', scrolls horizontally">' +
      tableHtml +
      '</div></div></div>';

    var widget = host.querySelector('.schedule-widget');
    var scroller = host.querySelector('.schedule-scroll');
    var track = host.querySelector('.schedule-scrollbar');
    var thumb = host.querySelector('.schedule-scrollbar-thumb');

    paintStickyColumn(scroller);

    var raf = null;
    function update() {
      raf = null;
      var maxScroll = scroller.scrollWidth - scroller.clientWidth;
      var scrollable = maxScroll > 1;
      widget.classList.toggle('is-scrollable', scrollable);
      widget.classList.toggle('can-scroll-left', scrollable && scroller.scrollLeft > 1);
      widget.classList.toggle('can-scroll-right', scrollable && scroller.scrollLeft < maxScroll - 1);
      if (!scrollable) return;
      var trackWidth = track.clientWidth;
      var thumbWidth = Math.max(44, (trackWidth * scroller.clientWidth) / scroller.scrollWidth);
      var range = Math.max(0, trackWidth - thumbWidth);
      thumb.style.width = thumbWidth + 'px';
      thumb.style.transform = 'translateX(' + (range * scroller.scrollLeft) / maxScroll + 'px)';
    }
    function requestUpdate() {
      if (raf === null) raf = requestAnimationFrame(update);
    }

    scroller.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    var observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(requestUpdate);
      observer.observe(scroller);
    }
    requestUpdate();

    var dragState = null;
    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragState = { startX: e.clientX, startLeft: scroller.scrollLeft };
      thumb.setPointerCapture(e.pointerId);
    });
    thumb.addEventListener('pointermove', function (e) {
      if (!dragState) return;
      var maxScroll = scroller.scrollWidth - scroller.clientWidth;
      var range = track.clientWidth - thumb.offsetWidth;
      if (range <= 0) return;
      scroller.scrollLeft = dragState.startLeft + ((e.clientX - dragState.startX) * maxScroll) / range;
    });
    thumb.addEventListener('pointerup', function () {
      dragState = null;
    });
    thumb.addEventListener('pointercancel', function () {
      dragState = null;
    });
    track.addEventListener('pointerdown', function (e) {
      if (e.target === thumb) return;
      var rect = track.getBoundingClientRect();
      var maxScroll = scroller.scrollWidth - scroller.clientWidth;
      var range = rect.width - thumb.offsetWidth;
      if (range <= 0) return;
      var x = e.clientX - rect.left - thumb.offsetWidth / 2;
      scroller.scrollLeft = Math.max(0, Math.min(1, x / range)) * maxScroll;
    });

    host._scheduleCleanup = function () {
      window.removeEventListener('resize', requestUpdate);
      if (observer) observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
      host._scheduleCleanup = null;
    };
  }

  // --- orchestration -------------------------------------------------

  function getRouteFromPath() {
    var segments = window.location.pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1].toLowerCase() : '';
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Parses + validates + renders one CSV into the host. Returns true if a
   * table was rendered, false if validation errors blocked it.
   */
  function renderCsv(csv, parts, label, meta) {
    var data = normalizeRows(parseCsv(csv));
    var result = validateRows(data);
    if (result.warnings.length) {
      report('schedule_validation_warning', {
        route: meta.route,
        direction: meta.direction,
        warning_count: result.warnings.length,
        first_warning: result.warnings[0]
      });
      if (window.POINT_SCHEDULE_DEBUG) console.warn('[schedules] ' + label + ' warnings:\n' + result.warnings.join('\n'));
    }
    if (result.errors.length) {
      report('schedule_validation_error', {
        route: meta.route,
        direction: meta.direction,
        error_count: result.errors.length,
        first_error: result.errors[0]
      });
      console.error('[schedules] ' + label + ' cannot be rendered:\n' + result.errors.join('\n'));
      return false;
    }
    buildScrollWidget(parts.host, renderTableHtml(data, label, window.location.origin), label);
    return true;
  }

  function loadSchedule(route, direction, container) {
    var gid = ROUTE_TO_GID[route][direction];
    var label = capitalize(direction) + ' schedule';
    var meta = { route: route, direction: direction };
    var parts = ensureParts(container);
    var url = sheetUrlFor(gid);
    var started = Date.now();

    container.style.display = 'block';

    var cached = cacheGet(gid);
    var renderedFromCache = false;
    if (cached) {
      renderedFromCache = renderCsv(cached.csv, parts, label, meta);
      if (renderedFromCache) {
        setStatus(parts.status, 'loaded', label + ' loaded.');
        report('schedule_loaded', { route: route, direction: direction, source: 'cache', cache_age_ms: Date.now() - (cached.ts || 0) });
      }
    }
    if (!renderedFromCache) {
      container.setAttribute('aria-busy', 'true');
      setStatus(parts.status, 'loading', 'Loading ' + label.toLowerCase() + '…');
    }

    fetchCsv(url)
      .then(function (csv) {
        if (cached && cached.csv === csv && renderedFromCache) {
          report('schedule_revalidated', { route: route, direction: direction, changed: false, ms: Date.now() - started });
          return;
        }
        var ok = renderCsv(csv, parts, label, meta);
        if (!ok) {
          // Validation failed on fresh data. Keep the cached table if we
          // have one; otherwise show the error.
          if (renderedFromCache) {
            report('schedule_load_error', { route: route, direction: direction, reason: 'validation', fallback: 'cache' });
            return;
          }
          throw Object.assign(new Error('Schedule data is not in the expected format.'), { reason: 'validation' });
        }
        cacheSet(gid, csv);
        container.removeAttribute('aria-busy');
        setStatus(parts.status, 'loaded', renderedFromCache ? label + ' updated.' : label + ' loaded.');
        report('schedule_loaded', {
          route: route,
          direction: direction,
          source: 'network',
          ms: Date.now() - started,
          replaced_cache: renderedFromCache
        });
      })
      .catch(function (err) {
        container.removeAttribute('aria-busy');
        var reason = err && err.reason ? err.reason : err && err.name === 'AbortError' ? 'timeout' : 'network';
        report('schedule_load_error', {
          route: route,
          direction: direction,
          reason: reason,
          message: String(err && err.message ? err.message : err).slice(0, 120),
          attempts: err && err.attempts ? err.attempts : FETCH_ATTEMPTS,
          fallback: renderedFromCache ? 'cache' : 'none'
        });
        console.error('[schedules] ' + label + ' failed:', err);
        if (renderedFromCache) {
          // The rider already has a table. Say nothing visible.
          setStatus(parts.status, 'loaded', label + ' loaded.');
          return;
        }
        parts.host.innerHTML = '';
        setStatus(
          parts.status,
          'error',
          'This schedule could not be loaded. Please refresh the page to try again.'
        );
      });
  }

  function init() {
    var route = getRouteFromPath();
    var directions = ROUTE_TO_GID[route];
    if (!directions) {
      if (window.POINT_SCHEDULE_DEBUG) console.info('[schedules] no schedule map for path segment "' + route + '"');
      return;
    }
    injectStyles();
    var found = 0;
    for (var direction in directions) {
      if (!Object.prototype.hasOwnProperty.call(directions, direction)) continue;
      var container = document.getElementById(direction + 'Schedule');
      if (!container) continue;
      found++;
      loadSchedule(route, direction, container);
    }
    if (!found) console.error('[schedules] route "' + route + '" has no schedule containers on this page.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
