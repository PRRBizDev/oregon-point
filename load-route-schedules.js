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

  function loadSchedule(direction, divId) {
      const gid = routeToGidMap[selectedRoute] ? routeToGidMap[selectedRoute][direction] : null;

      if (!gid) {
          console.error('No schedule found for the selected route and direction.');
          return;
      }

      const sheetUrl = `https://docs.google.com/spreadsheets/d/e/2PACX-1vSFxEWKQ2-xBzt3yUZR3N2iCroPtJfmrMcLVXacEVAEaxhUZckJCOOvIshUEuJVi5v7CtlcNq_HjoyC/pub?gid=${gid}&output=csv`;

      fetch(sheetUrl)
          .then(response => response.text())
          .then(data => {
              const rows = data.split('\n').map(row => row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g));

              let html = '<table class="tablepress">';

              // Add table header, show only 'Click address for map' header
              html += '<thead><tr>';
              html += '<th>Click address for map</th>'; // Only display this header for address links
              rows[0].slice(3).forEach((cell) => {
                  html += `<th>${cell ? cell.replace(/^"|"$/g, '') : ''}</th>`;
              });
              html += '</tr></thead>';

              html += '<tbody>';
              rows.slice(1).forEach((row, index) => {
                  if (row) {
                      const stopName = row[0] ? row[0].replace(/^"|"$/g, '').trim() : '';
                      const address = row[1] ? row[1].replace(/^"|"$/g, '').trim() : '';
                      const url = row[2] ? row[2].replace(/^"|"$/g, '').trim() : '';

                      // Check if it's a restroom break (if only the first column has content)
                      const isRestroomBreak = stopName && row.slice(1).every(cell => !cell || cell.replace(/^"|"$/g, '').trim() === '');

                      html += `<tr class="table_row ${index % 2 === 0 ? 'even' : 'odd'}">`;

                      if (isRestroomBreak) {
                          // Adjust colspan to cover all columns (stop name + route times)
                          const colspanValue = rows[0].length - 1; // Correct calculation for all columns
                          html += `<td class="table_cell" colspan="${colspanValue}"><strong>${stopName}</strong></td>`;
                      } else {
                          // Otherwise, render normally
                          html += `<td class="table_cell"><div><strong>${stopName}</strong></div>`;
                          html += `<a href="${url}" target="_blank">${address}</a></td>`;

                          // Render the remaining columns (route times)
                          row.slice(3).forEach((cell) => {
                              let content = cell ? cell.replace(/^"|"$/g, '') : '';
                              // Treat content as HTML
                              html += `<td class="table_cell">${content}</td>`;
                          });
                      }

                      html += '</tr>';
                  }
              });
              html += '</tbody>';

              html += '</table>';
              document.getElementById(divId).innerHTML = html;
          })
          .catch(error => console.error('Error fetching Google Sheets data:', error));
  }

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
