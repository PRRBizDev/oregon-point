document.addEventListener('DOMContentLoaded', function() {
  function getRouteFromPath() {
      const pathArray = window.location.pathname.split('/');
      return pathArray[pathArray.length - 1]; // Get the last segment of the URL
  }

  const routeToGidMap = {
      'northwest': {
          'westbound': '936462530',
          'eastbound': '1006324273',
      },
      'cascades': {
          'southbound': '61645532',
          'northbound': '623966074',
      },
      'eastern': {
          'westbound': '192720227',
          'eastbound': '994232038',
      },
      'southwest': {
          'westbound': '1727388931',
          'eastbound': '1800641249',
      },
  };

  const selectedRoute = getRouteFromPath();

  if (!selectedRoute) {
      console.error('Route not specified.');
      return;
  }

  // ------------------------------------------------------------------
  // Security helpers.
  // Sheet content is data, not markup: everything is escaped before it
  // touches the DOM, and the URL column only accepts http(s) links.
  // Anyone with edit access to the Google Sheet would otherwise be able
  // to inject HTML/scripts into the site.
  // ------------------------------------------------------------------
  function escapeHtml(value) {
      return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
      if (!url) return '';
      try {
          const parsed = new URL(url, window.location.origin);
          return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
      } catch (e) {
          return '';
      }
  }

  // ------------------------------------------------------------------
  // Horizontal-scroll affordances for the schedule tables.
  // Everything (CSS included) ships in this one file so a single
  // jsDelivr update covers every route page. Four pieces:
  //   1. Always-visible scrollbar ABOVE the table (draggable/tappable)
  //   2. Edge fades that show when more columns exist off-screen
  //   3. "Scroll" hint text on narrow viewports
  //   4. Sticky first column so stop names stay visible while scrolling
  // ------------------------------------------------------------------
  const SCHEDULE_ACCENT = '#0b5d8f'; // adjust to match brand blue if needed

  const SCROLL_UI_CSS = `
    .schedule-visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .schedule-load-error { font-weight: 600; }
    .schedule-swipe-hint {
      display: none;
      margin: 0 0 8px;
      font-size: 0.9rem;
      font-weight: 600;
      color: ${SCHEDULE_ACCENT};
    }
    @media (max-width: 900px) {
      .schedule-widget.is-scrollable .schedule-swipe-hint { display: block; }
    }
    .schedule-scrollbar {
      display: none;
      position: relative;
      height: 16px;
      margin: 0 0 8px;
      border-radius: 8px;
      background: #dde5ea;
      cursor: pointer;
      touch-action: none;
    }
    .schedule-widget.is-scrollable .schedule-scrollbar { display: block; }
    .schedule-scrollbar-thumb {
      position: absolute;
      top: 3px;
      bottom: 3px;
      left: 0;
      min-width: 44px;
      border-radius: 6px;
      background: ${SCHEDULE_ACCENT};
    }
    .schedule-scroll-outer { position: relative; }
    .schedule-scroll-outer::before,
    .schedule-scroll-outer::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      width: 28px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 3;
    }
    @media (prefers-reduced-motion: reduce) {
      .schedule-scroll-outer::before,
      .schedule-scroll-outer::after { transition: none; }
    }
    .schedule-scroll-outer::before {
      left: 0;
      background: linear-gradient(to right, rgba(0,0,0,0.16), rgba(0,0,0,0));
    }
    .schedule-scroll-outer::after {
      right: 0;
      background: linear-gradient(to left, rgba(0,0,0,0.16), rgba(0,0,0,0));
    }
    .schedule-widget.can-scroll-left .schedule-scroll-outer::before { opacity: 1; }
    .schedule-widget.can-scroll-right .schedule-scroll-outer::after { opacity: 1; }
    .schedule-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .schedule-scroll:focus-visible {
      outline: 2px solid ${SCHEDULE_ACCENT};
      outline-offset: 2px;
    }
    /* Row headers (stop names) are <th scope="row"> for screen readers;
       neutralize default/site th styling so they render like body cells. */
    .schedule-scroll table.tablepress tbody th {
      background-color: transparent;
      text-align: left;
      font-weight: normal;
    }
    .schedule-scroll th:first-child,
    .schedule-scroll td:first-child {
      position: sticky;
      left: 0;
      z-index: 2;
    }
    .schedule-widget.can-scroll-left .schedule-scroll th:first-child,
    .schedule-widget.can-scroll-left .schedule-scroll td:first-child {
      box-shadow: 3px 0 6px rgba(0, 0, 0, 0.12);
    }
    /* Full-width colspan rows (restroom breaks) can't stick as a cell,
       so the cell stays static and the label inside sticks instead. */
    .schedule-scroll td.restroom-cell { position: static; }
    .schedule-scroll .restroom-note {
      position: sticky;
      left: 8px;
      display: inline-block;
    }
  `;

  function injectScrollStyles() {
      if (document.getElementById('schedule-scroll-styles')) return;
      const style = document.createElement('style');
      style.id = 'schedule-scroll-styles';
      style.textContent = SCROLL_UI_CSS;
      document.head.appendChild(style);
  }

  // The sticky first column needs a solid background so the time columns
  // slide underneath it instead of showing through. Row colors come from
  // the site's existing tablepress styles, so copy each row's computed
  // background onto its first cell rather than hardcoding colors here.
  function paintStickyColumn(scroller) {
      const table = scroller.querySelector('table');
      if (!table) return;
      const isTransparent = function(c) {
          return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      };
      table.querySelectorAll('tr').forEach(function(tr) {
          const cell = tr.querySelector('th:first-child, td:first-child');
          if (!cell || cell.classList.contains('restroom-cell')) return;
          let bg = getComputedStyle(cell).backgroundColor;
          if (isTransparent(bg)) bg = getComputedStyle(tr).backgroundColor;
          if (isTransparent(bg)) bg = '#ffffff';
          cell.style.backgroundColor = bg;
      });
  }

  function buildScrollWidget(container, tableHtml, label) {
      container.innerHTML =
          '<div class="schedule-widget">' +
              '<p class="schedule-swipe-hint">Scroll to view the full schedule <span aria-hidden="true">&rarr;</span></p>' +
              '<div class="schedule-scrollbar" aria-hidden="true"><div class="schedule-scrollbar-thumb"></div></div>' +
              '<div class="schedule-scroll-outer">' +
                  '<div class="schedule-scroll" tabindex="0" role="region" aria-label="' + escapeHtml(label) + ', scrolls horizontally">' +
                      tableHtml +
                  '</div>' +
              '</div>' +
          '</div>';

      const widget = container.querySelector('.schedule-widget');
      const scroller = container.querySelector('.schedule-scroll');
      const track = container.querySelector('.schedule-scrollbar');
      const thumb = container.querySelector('.schedule-scrollbar-thumb');

      paintStickyColumn(scroller);

      let raf = null;
      function update() {
          raf = null;
          const maxScroll = scroller.scrollWidth - scroller.clientWidth;
          const scrollable = maxScroll > 1;
          widget.classList.toggle('is-scrollable', scrollable);
          widget.classList.toggle('can-scroll-left', scrollable && scroller.scrollLeft > 1);
          widget.classList.toggle('can-scroll-right', scrollable && scroller.scrollLeft < maxScroll - 1);
          if (!scrollable) return;
          const trackWidth = track.clientWidth;
          const thumbWidth = Math.max(44, trackWidth * scroller.clientWidth / scroller.scrollWidth);
          const range = Math.max(0, trackWidth - thumbWidth);
          thumb.style.width = thumbWidth + 'px';
          thumb.style.transform = 'translateX(' + (range * scroller.scrollLeft / maxScroll) + 'px)';
      }
      function requestUpdate() {
          if (raf === null) raf = requestAnimationFrame(update);
      }

      scroller.addEventListener('scroll', requestUpdate, { passive: true });
      window.addEventListener('resize', requestUpdate);
      // Re-measures when a hidden direction tab becomes visible.
      if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(requestUpdate).observe(scroller);
      }
      requestUpdate();

      // Make the top scrollbar interactive: drag the thumb, or tap the track.
      let dragState = null;
      thumb.addEventListener('pointerdown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          dragState = { startX: e.clientX, startLeft: scroller.scrollLeft };
          thumb.setPointerCapture(e.pointerId);
      });
      thumb.addEventListener('pointermove', function(e) {
          if (!dragState) return;
          const maxScroll = scroller.scrollWidth - scroller.clientWidth;
          const range = track.clientWidth - thumb.offsetWidth;
          if (range <= 0) return;
          scroller.scrollLeft = dragState.startLeft +
              (e.clientX - dragState.startX) * maxScroll / range;
      });
      thumb.addEventListener('pointerup', function() { dragState = null; });
      thumb.addEventListener('pointercancel', function() { dragState = null; });
      track.addEventListener('pointerdown', function(e) {
          if (e.target === thumb) return;
          const rect = track.getBoundingClientRect();
          const maxScroll = scroller.scrollWidth - scroller.clientWidth;
          const range = rect.width - thumb.offsetWidth;
          if (range <= 0) return;
          const x = e.clientX - rect.left - thumb.offsetWidth / 2;
          scroller.scrollLeft = Math.max(0, Math.min(1, x / range)) * maxScroll;
      });
  }

  function loadSchedule(direction, divId) {
      const gid = routeToGidMap[selectedRoute] ? routeToGidMap[selectedRoute][direction] : null;

      if (!gid) {
          console.error('No schedule found for the selected route and direction.');
          return;
      }

      const label = direction.charAt(0).toUpperCase() + direction.slice(1) + ' schedule';
      const sheetUrl = `https://docs.google.com/spreadsheets/d/e/2PACX-1vSFxEWKQ2-xBzt3yUZR3N2iCroPtJfmrMcLVXacEVAEaxhUZckJCOOvIshUEuJVi5v7CtlcNq_HjoyC/pub?gid=${gid}&output=csv`;

      const clean = function(cell) {
          return cell ? cell.replace(/^"|"$/g, '').trim() : '';
      };

      // "--" in the sheet means "no stop on this trip": keep it visually,
      // but give screen readers real words instead of "dash dash".
      const timeCell = function(content) {
          if (content === '--' || content === '–' || content === '—') {
              return '<td class="table_cell"><span aria-hidden="true">' + escapeHtml(content) + '</span>' +
                     '<span class="schedule-visually-hidden">no stop</span></td>';
          }
          return '<td class="table_cell">' + escapeHtml(content) + '</td>';
      };

      fetch(sheetUrl)
          .then(response => {
              if (!response.ok) {
                  throw new Error('Schedule request failed with status ' + response.status);
              }
              return response.text();
          })
          .then(data => {
              const rows = data.split('\n').map(row => row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g));

              let html = '<table class="tablepress">';
              html += '<caption class="schedule-visually-hidden">' + escapeHtml(label) + '</caption>';

              // Add table header, show only 'Click address for map' header
              html += '<thead><tr>';
              html += '<th scope="col">Click address for map</th>'; // Only display this header for address links
              rows[0].slice(3).forEach((cell) => {
                  html += '<th scope="col">' + escapeHtml(clean(cell)) + '</th>';
              });
              html += '</tr></thead>';

              html += '<tbody>';
              rows.slice(1).forEach((row, index) => {
                  if (row) {
                      const stopName = clean(row[0]);
                      const address = clean(row[1]);
                      const url = safeUrl(clean(row[2]));

                      // Check if it's a restroom break (if only the first column has content)
                      const isRestroomBreak = stopName && row.slice(1).every(cell => !clean(cell));

                      html += '<tr class="table_row ' + (index % 2 === 0 ? 'even' : 'odd') + '">';

                      if (isRestroomBreak) {
                          // Rendered columns = 1 stop column + (total - 3) time columns
                          const colspanValue = rows[0].length - 2;
                          html += '<td class="table_cell restroom-cell" colspan="' + colspanValue + '">' +
                                  '<div class="restroom-note"><strong>' + escapeHtml(stopName) + '</strong></div></td>';
                      } else {
                          // Stop name is the row header so screen readers associate
                          // each departure time with its stop (WCAG 1.3.1)
                          html += '<th scope="row" class="table_cell"><div><strong>' + escapeHtml(stopName) + '</strong></div>';
                          if (url && address) {
                              html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(address) + '</a>';
                          } else if (address) {
                              html += escapeHtml(address);
                          }
                          html += '</th>';

                          // Render the remaining columns (route times)
                          row.slice(3).forEach((cell) => {
                              html += timeCell(clean(cell));
                          });
                      }

                      html += '</tr>';
                  }
              });
              html += '</tbody>';

              html += '</table>';
              buildScrollWidget(document.getElementById(divId), html, label);
          })
          .catch(error => {
              console.error('Error fetching Google Sheets data:', error);
              const el = document.getElementById(divId);
              if (el) {
                  el.innerHTML = '<p class="schedule-load-error">This schedule could not be loaded. ' +
                                 'Please refresh the page to try again.</p>';
              }
          });
  }

  injectScrollStyles();

  if (document.getElementById('westboundSchedule')) {
      loadSchedule('westbound', 'westboundSchedule');
      document.getElementById('westboundSchedule').style.display = 'block';
  }
  if (document.getElementById('eastboundSchedule')) {
      loadSchedule('eastbound', 'eastboundSchedule');
      document.getElementById('eastboundSchedule').style.display = 'block';
  }
  if (document.getElementById('southboundSchedule')) {
      loadSchedule('southbound', 'southboundSchedule');
      document.getElementById('southboundSchedule').style.display = 'block';
  }
  if (document.getElementById('northboundSchedule')) {
      loadSchedule('northbound', 'northboundSchedule');
      document.getElementById('northboundSchedule').style.display = 'block';
  }
});