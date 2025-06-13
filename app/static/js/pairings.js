// Basic highlight logic for selecting armies
function setupArmySelection() {
  document.querySelectorAll('.army-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      document.querySelectorAll('.army-slot').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
    });
  });
}
document.addEventListener('DOMContentLoaded', setupArmySelection);
