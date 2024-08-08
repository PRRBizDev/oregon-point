document.addEventListener('DOMContentLoaded', function() {
    function getRouteFromPath() {
        const pathArray = window.location.pathname.split('/');
        return pathArray[pathArray.length - 1]; // Get the last segment of the URL
    }

    const routeToGidMap = {
        'northwest': {
            'westbound': '936462530', // Replace with actual gid for Northwest Westbound
            'eastbound': '1006324273', // Replace with actual gid for Northwest Eastbound
        },
        'cascades': {
            'southbound': '61645532', // Replace with actual gid for Cascades Southbound
            'northbound': '623966074', // Replace with actual gid for Cascades Northbound
        },
        'eastern': {
            'westbound': '192720227', // Replace with actual gid for Eastern Westbound
            'eastbound': '994232038', // Replace with actual gid for Eastern Eastbound
        },
        'southwest': {
            'westbound': '1727388931', // Replace with actual gid for Eastern Westbound
            'eastbound': '1800641249', // Replace with actual gid for Eastern Eastbound
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
                const rows = data.split('\n').map(row => {
                    return row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
                });

                let html = '<table class="tablepress">';

                // Add table header except for 'Stop details' and 'URL'
                html += '<thead><tr>';
                rows[0].forEach((cell, index) => {
                    if (index !== 1 && index !== 2 && index !== 3) { // Skip 'Stop details', 'Address', and 'URL' headers
                        html += `<th>${cell ? cell.replace(/^"|"$/g, '') : ''}</th>`;
                    }
                });
                html += '</tr></thead>';

                html += '<tbody>';
                rows.slice(1).forEach((row, index) => {
                    if (row) {
                        html += `<tr class="table_row ${index % 2 === 0 ? 'even' : 'odd'}">`;

                        const stopName = row[0] ? row[0].replace(/^"|"$/g, '').trim() : '';
                        const stopDetails = row[1] ? row[1].replace(/^"|"$/g, '').trim() : '';
                        const address = row[2] ? row[2].replace(/^"|"$/g, '').trim() : '';
                        const url = row[3] ? row[3].replace(/^"|"$/g, '').trim() : '';

                        // Combine stop details with the address link
                        html += `<td class="table_cell"><div><strong>${stopName}</strong></div><div>${stopDetails}</div><a href="${url}" target="_blank">${address}</a></td>`;

                        // Render the remaining columns (e.g., times)
                        row.slice(4).forEach((cell) => {
                            let content = cell ? cell.replace(/^"|"$/g, '') : '';
                            content = content.trim().replace(/\n/g, '<br>'); // Handle line breaks
                            html += `<td class="table_cell">${content}</td>`;
                        });

                        html += '</tr>';
                    }
                });
                html += '</tbody>';

                html += '</table>';
                document.getElementById(divId).innerHTML = html;
            })
            .catch(error => console.error('Error fetching Google Sheets data:', error));
    }

    // Check which divs are present and load the corresponding data
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
