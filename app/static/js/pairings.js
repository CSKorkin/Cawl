// Basic highlight logic for selecting armies
let phase = 'defender';
let defenderCard = null;
let attackerCards = [];
let oppDefenderCard = null;
let oppAttackerCards = [];
let inFinalRound = false;

function clearSelections(container) {
  document.querySelectorAll(container + ' .selected').forEach((el) => {
    el.classList.remove('selected');
  });
}

function setupArmySelection() {
  // User army selection for defenders/attackers
  document.querySelectorAll('#user-hand .army-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      if (phase === 'defender') {
        clearSelections('#user-hand');
        slot.classList.add('selected');
        document.getElementById('confirm-defender').style.display = 'inline-block';
      } else if (phase === 'attackers') {
        slot.classList.toggle('selected');
        const sel = document.querySelectorAll('#user-hand .selected');
        document.getElementById('confirm-attackers').style.display = sel.length === 2 ? 'inline-block' : 'none';
      }
    });
  });

  // Opponent attacker selection (attach once while in opponent-hand)
  document.querySelectorAll('#opponent-hand .army-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      if (phase === 'accept' && slot.closest('#opponent-attackers')) {
        clearSelections('#opponent-attackers');
        slot.classList.add('selected');
        document.getElementById('confirm-accept').style.display = 'inline-block';
      }
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
  setupConfirmButtons();
});

function setupConfirmButtons() {
  const confirmDef = document.getElementById('confirm-defender');
  const confirmAtk = document.getElementById('confirm-attackers');
  const confirmAcc = document.getElementById('confirm-accept');

  if (confirmDef)
    confirmDef.addEventListener('click', confirmDefender);
  if (confirmAtk)
    confirmAtk.addEventListener('click', confirmAttackers);
  if (confirmAcc)
    confirmAcc.addEventListener('click', confirmAccept);
}

function moveCard(card, targetId) {
  const target = document.getElementById(targetId);
  if (target) {
    target.innerHTML = '';
    target.appendChild(card);
  }
}

function chooseRandomCard(selector) {
  const cards = document.querySelectorAll(selector);
  if (cards.length === 0) return null;
  const idx = Math.floor(Math.random() * cards.length);
  return cards[idx];
}

function confirmDefender() {
  const selected = document.querySelector('#user-hand .selected');
  if (!selected) return;
  defenderCard = selected;
  moveCard(selected, 'user-defender');
  selected.classList.remove('selected');
  document.getElementById('confirm-defender').style.display = 'none';
  phase = 'attackers';

  // Opponent defender
  oppDefenderCard = chooseRandomCard('#opponent-hand .army-slot');
  if (oppDefenderCard) moveCard(oppDefenderCard, 'opponent-defender');
}

function confirmAttackers() {
  const selected = document.querySelectorAll('#user-hand .selected');
  if (selected.length !== 2) return;
  attackerCards = Array.from(selected);
  moveCard(attackerCards[0], 'user-attacker1');
  moveCard(attackerCards[1], 'user-attacker2');
  attackerCards.forEach(c => c.classList.remove('selected'));
  document.getElementById('confirm-attackers').style.display = 'none';
  phase = 'accept';

  inFinalRound =
    document.querySelectorAll('#pairings-board .pair-slot.empty').length === 4;

  // Opponent attackers
  oppAttackerCards = [];
  for (let i = 1; i <= 2; i++) {
    const card = chooseRandomCard('#opponent-hand .army-slot');
    if (card) {
      oppAttackerCards.push(card);
      moveCard(card, `opponent-attacker${i}`);
    }
  }

  if (inFinalRound) {
    const lastUser = document.querySelector('#user-hand .army-slot');
    const lastOpp = document.querySelector('#opponent-hand .army-slot');
    if (lastUser && lastOpp) {
      addPairing(lastUser, lastOpp);
    }
  }

}

function confirmAccept() {
  const selectedOpp = document.querySelector('#opponent-attackers .selected');
  if (!selectedOpp) return;

  const refusedOpp = oppAttackerCards.find(c => c !== selectedOpp);
  if (!inFinalRound && refusedOpp) {
    document.getElementById('opponent-hand').appendChild(refusedOpp);
  }
  if (refusedOpp) {
    refusedOpp.classList.remove('selected');
  }

  const oppAccepted = selectedOpp;
  oppAccepted.classList.remove('selected');

  const oppChoiceIdx = Math.floor(Math.random() * attackerCards.length);
  const oppAcceptedUser = attackerCards[oppChoiceIdx];
  const userRefused = attackerCards.find(c => c !== oppAcceptedUser);
  if (!inFinalRound && userRefused) {
    document.getElementById('user-hand').appendChild(userRefused);
  }
  if (userRefused) {
    userRefused.classList.remove('selected');
  }

  addPairing(defenderCard, oppAccepted);
  addPairing(oppDefenderCard, oppAcceptedUser);
  if (inFinalRound && refusedOpp && userRefused) {
    addPairing(userRefused, refusedOpp);
  }

  resetCentral();
  phase = inFinalRound ? 'done' : 'defender';
  attackerCards = [];
  oppAttackerCards = [];
  defenderCard = null;
  oppDefenderCard = null;
  inFinalRound = false;
  document.getElementById('confirm-accept').style.display = 'none';
}

function addPairing(cardA, cardB) {
  const slot = document.querySelector('#pairings-board .pair-slot.empty');
  if (!slot) return;
  slot.classList.remove('empty');
  slot.appendChild(cardA);
  slot.appendChild(cardB);
}

function resetCentral() {
  ['user-defender','user-attacker1','user-attacker2','opponent-defender','opponent-attacker1','opponent-attacker2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}
