document.addEventListener('DOMContentLoaded', function() {
    const buses = document.querySelectorAll('.bus-collection-item');
    const stops = document.querySelectorAll('.stop-collection-item');
    const scheduleTable = document.getElementById('schedule-table');

    // Get the current route direction from the page context
    const routeDirection = 'Westbound'; // Update this line to dynamically get the route direction value

    // Filter buses by direction
    const filteredBuses = Array.from(buses)
    .filter(bus => bus.getAttribute('data-direction').trim() === routeDirection)
    .sort((a, b) => parseInt(a.getAttribute('data-bus')) - parseInt(b.getAttribute('data-bus'))); // Sort bus numbers in ascending order

    // Create table header for bus numbers
    let thead = document.createElement('thead');
    thead.classList.add('table_head');

    let headerRow = document.createElement('tr');
    headerRow.classList.add('table_row');

    let headerCell = document.createElement('th');
    headerCell.classList.add('table_header');
    headerCell.textContent = "Click address for map";
    headerRow.appendChild(headerCell); // Add the header for the address column

    filteredBuses.forEach(bus => {
      let th = document.createElement('th');
      th.textContent = bus.getAttribute('data-bus');
      th.classList.add('table_header');
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    scheduleTable.appendChild(thead);

    // Create table body
    let tbody = document.createElement('tbody');
    tbody.classList.add('row-hover');

    // Create rows for stops
    stops.forEach((stop, index) => {
      let row = document.createElement('tr');
      row.classList.add('table_row');
      row.classList.add(index % 2 === 0 ? 'even' : 'odd'); // Apply even/odd classes

      let stopCell = document.createElement('td');
      stopCell.classList.add('table_cell');

      let stopName = stop.getAttribute('data-stop').trim();
      let stopLocationName = stop.querySelector('div:nth-of-type(2)').textContent.trim();
      let stopAddress = stop.querySelector('a').getAttribute('aria-label');
      let stopUrl = stop.querySelector('a').getAttribute('href');

      stopCell.innerHTML = `
<div><strong>${stopName}</strong></div>
<div>${stopLocationName}</div>
<a href="${stopUrl}" target="_blank">${stopAddress}</a>
`;
      row.appendChild(stopCell);

      filteredBuses.forEach(bus => {
        let cell = document.createElement('td');
        cell.classList.add('table_cell');

        let busNumber = bus.getAttribute('data-bus').trim();

        // Fetch the corresponding schedule item using data attributes
        let scheduleItem = document.querySelector(`.schedule-collection-item[data-bus="${busNumber}"][data-stop="${stopName}"][data-direction="${routeDirection}"]`);
        if (scheduleItem) {
          cell.textContent = scheduleItem.querySelector('.time-field').textContent;
        } else {
          cell.textContent = 'N/A'; // or leave it empty if preferred
        }
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    scheduleTable.appendChild(tbody);
  });
