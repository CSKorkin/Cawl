// Basic highlight logic for selecting armies
function setupArmySelection() {
  document.querySelectorAll('.army-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      document.querySelectorAll('.army-slot').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
    });
  });
}

function setupAverageToggle() {
  const button = document.getElementById('toggle-averages');
  const table = document.querySelector('.matrix-table');
  if (!button || !table) return;
  button.addEventListener('click', () => {
    table.classList.toggle('show-averages');
    button.textContent = table.classList.contains('show-averages') ? 'Hide Averages' : 'Show Averages';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupArmySelection();
  setupAverageToggle();
});
