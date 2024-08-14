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

              // Add table header, skipping 'Stop details' and 'URL'
              html += '<thead><tr>';
              rows[0].forEach((cell, index) => {
                  if (index !== 1 && index !== 2 && index !== 3) { // Skip 'Stop details' and 'URL'
                      html += `<th>${cell ? cell.replace(/^"|"$/g, '') : ''}</th>`;
                  }
              });
              html += '</tr></thead>';

              html += '<tbody>';
              rows.slice(1).forEach((row, index) => {
                  if (row) {
                      const stopName = row[0] ? row[0].replace(/^"|"$/g, '').trim() : '';
                      const address = row[2] ? row[2].replace(/^"|"$/g, '').trim() : '';
                      const url = row[3] ? row[3].replace(/^"|"$/g, '').trim() : '';

                      // Check if only the first column has content (e.g., for a restroom break)
                      const isRestroomBreak = stopName && row.slice(1).every(cell => !cell || cell.replace(/^"|"$/g, '').trim() === '');

                      html += `<tr class="table_row ${index % 2 === 0 ? 'even' : 'odd'}">`;

                      if (isRestroomBreak) {
                          // If it's a restroom break, stretch the content across all columns
                          html += `<td class="table_cell" colspan="${rows[0].length - 3}"><strong>${stopName}</strong></td>`;
                      } else {
                          // Otherwise, render normally
                          html += `<td class="table_cell"><div><strong>${stopName}</strong></div>`;
                          html += `<a href="${url}" target="_blank">${address}</a></td>`;

                          // Render the remaining columns (e.g., times)
                          row.slice(4).forEach((cell) => {
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
