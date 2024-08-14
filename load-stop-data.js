document.addEventListener("DOMContentLoaded", function () {
  // Select the dropdown toggle and text block
  const dropdownToggle = document.querySelector(".select_stop-dropdown-toggle");
  const dropdownText = document.querySelector(
    ".select_stop-dropdown-link-selected"
  );

  // Function to hide all lists
  function hideAllLists() {
    document
      .querySelectorAll(".connection-list-item")
      .forEach((el) => (el.style.display = "none"));
    document
      .querySelectorAll(".parking-list-item")
      .forEach((el) => (el.style.display = "none"));
  }

  // Function to show the selected list
  function showList(selectedStopId) {
    document
      .querySelectorAll(`[data-stop-id="${selectedStopId}"]`)
      .forEach((el) => {
        el.style.display = "block";
      });
  }

  // Select all dropdown links
  const dropdownLinks = document.querySelectorAll(".select_stop-dropdown-link");

  // Add click event listeners to all dropdown links
  dropdownLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault(); // Prevent default link behavior

      // Hide all the lists
      hideAllLists();

      // Get the text of the clicked link
      const selectedStopId = link.textContent.trim();

      // Set the dropdown text to the selected stop name
      dropdownText.textContent = selectedStopId;

      // Show the list for the selected stop
      showList(selectedStopId);

      // Toggle the dropdown to close it
      //  toggleDropdown();
    });
  });
});
