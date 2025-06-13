// Basic highlight logic for selecting armies
let phase = 'defender';
let defenderCard = null;
let attackerCards = [];
let oppDefenderCard = null;
let oppAttackerCards = [];
let inFinalRound = false;
let origMatrix = [];
let origTeamA = [];
let origTeamB = [];
let matrixData = [];
let teamAList = [];
let teamBList = [];
let origMatrixTable = null;
let origUserHandHTML = '';
let origOppHandHTML = '';
let origBoardHTML = '';
let aiType = null;

function scoreClass(val) {
  if (val <= 4) return 'r-text';
  if (val <= 8) return 'o-text';
  if (val <= 11) return 'y-text';
  if (val <= 15) return 'lg-text';
  return 'dg-text';
}

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

function setupAIChoice() {
  const chooser = document.getElementById('ai-choice');
  if (!chooser) return;
  const btn = document.getElementById('choose-ai');
  const pairArea = document.getElementById('pair-area');
  const uHand = document.getElementById('user-hand');
  const oHand = document.getElementById('opponent-hand');
  const conf = document.getElementById('confirm-buttons');
  pairArea.style.display = 'none';
  uHand.style.display = 'none';
  oHand.style.display = 'none';
  conf.style.display = 'none';
  btn.addEventListener('click', () => {
    const sel = document.getElementById('ai-select');
    aiType = sel.value;
    chooser.style.display = 'none';
    pairArea.style.display = '';
    uHand.style.display = '';
    oHand.style.display = '';
    conf.style.display = '';
  });
}

function setupAverageToggle() {
  const button = document.getElementById('toggle-averages');
  if (!button) return;
  button.addEventListener('click', () => {
    const table = document.querySelector('.matrix-table');
    if (!table) return;
    table.classList.toggle('show-averages');
    button.textContent = table.classList.contains('show-averages') ? 'Hide Averages' : 'Show Averages';
  });
}

function setupLogToggle() {
  const button = document.getElementById('toggle-log');
  const panel = document.querySelector('.log-panel');
  if (!button || !panel) return;
  button.addEventListener('click', () => {
    if (panel.style.display === 'none') {
      panel.style.display = '';
      button.textContent = 'Hide Log';
    } else {
      panel.style.display = 'none';
      button.textContent = 'Show Log';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  origMatrix = window.origMatrix || [];
  origTeamA = window.origTeamA || [];
  origTeamB = window.origTeamB || [];
  matrixData = origMatrix.map(r => r.slice());
  teamAList = origTeamA.slice();
  teamBList = origTeamB.slice();
  origMatrixTable = document.querySelector('.matrix-table').cloneNode(true);
  origUserHandHTML = document.getElementById('user-hand').innerHTML;
  origOppHandHTML = document.getElementById('opponent-hand').innerHTML;
  origBoardHTML = document.getElementById('pairings-board').innerHTML;
  setupAIChoice();
  setupArmySelection();
  setupAverageToggle();
  setupLogToggle();
  setupConfirmButtons();
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetPairings);
  const newBtn = document.getElementById('new-btn');
  if (newBtn) newBtn.addEventListener('click', () => window.location.reload());
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
    adjustPairNames();
  }
}

function chooseRandomCard(selector) {
  const cards = document.querySelectorAll(selector);
  if (cards.length === 0) return null;
  const idx = Math.floor(Math.random() * cards.length);
  return cards[idx];
}

function addLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  document.getElementById('log').appendChild(li);
}

function updateMatrixAfterPair(aName, bName) {
  const rowIdx = teamAList.indexOf(aName);
  const colIdx = teamBList.indexOf(bName);
  if (rowIdx === -1 || colIdx === -1) return;

  teamAList.splice(rowIdx, 1);
  teamBList.splice(colIdx, 1);
  matrixData.splice(rowIdx, 1);
  matrixData.forEach(row => row.splice(colIdx, 1));

  const table = document.querySelector('.matrix-table');
  const bodyRows = table.querySelectorAll('tbody tr:not(.avg-row)');
  if (bodyRows[rowIdx]) bodyRows[rowIdx].remove();

  table.querySelectorAll('tr').forEach(tr => {
    const cells = tr.children;
    if (cells[colIdx + 1]) cells[colIdx + 1].remove();
  });

  updateAverages();
}

function updateAverages() {
  const bodyRows = document.querySelectorAll('.matrix-table tbody tr:not(.avg-row)');
  bodyRows.forEach((tr, i) => {
    const avgCell = tr.querySelector('.row-avg');
    if (!avgCell) return;
    const row = matrixData[i];
    const avg = row.reduce((a, b) => a + b, 0) / row.length;
    avgCell.textContent = avg.toFixed(1);
  });

  const avgRow = document.querySelector('.matrix-table .avg-row');
  if (!avgRow) return;
  const cells = avgRow.querySelectorAll('.col-avg');
  if (matrixData.length === 0 || matrixData[0].length === 0) {
    cells.forEach(c => c.textContent = '');
    return;
  }
  for (let j = 0; j < matrixData[0].length; j++) {
    let sum = 0;
    for (let i = 0; i < matrixData.length; i++) {
      sum += matrixData[i][j];
    }
    const avg = sum / matrixData.length;
    if (cells[j]) cells[j].textContent = avg.toFixed(1);
  }
}

function showScores() {
  const slots = document.querySelectorAll('#pairings-board .pair-slot');
  slots.forEach(slot => {
    const a = slot.dataset.a;
    const b = slot.dataset.b;
    if (!a || !b) return;
    const i = origTeamA.indexOf(a);
    const j = origTeamB.indexOf(b);
    if (i === -1 || j === -1) return;
    const val = origMatrix[i][j];
    const overlay = document.createElement('div');
    overlay.className = 'score-overlay ' + scoreClass(val);
    overlay.textContent = val;
    slot.appendChild(overlay);
  });
}

function availableUserNames() {
  return Array.from(document.querySelectorAll('#user-hand .army-slot')).map(
    c => c.dataset.name
  );
}

function availableOppNames() {
  return Array.from(document.querySelectorAll('#opponent-hand .army-slot')).map(
    c => c.dataset.name
  );
}

function rowIndex(name) {
  return teamAList.indexOf(name);
}

function colIndex(name) {
  return teamBList.indexOf(name);
}

function matrixVal(aName, bName) {
  const i = rowIndex(aName);
  const j = colIndex(bName);
  if (i === -1 || j === -1) return 0;
  return matrixData[i][j];
}

function computeMinTotal(aNames, bNames, memo = {}) {
  const key = aNames.join(',') + '|' + bNames.join(',');
  if (memo[key] !== undefined) return memo[key];
  if (aNames.length === 0) return 0;
  const a = aNames[0];
  const restA = aNames.slice(1);
  let best = Infinity;
  for (let i = 0; i < bNames.length; i++) {
    const b = bNames[i];
    const restB = bNames.slice();
    restB.splice(i, 1);
    const val = matrixVal(a, b) + computeMinTotal(restA, restB, memo);
    if (val < best) best = val;
  }
  memo[key] = best;
  return best;
}

function chooseDefenderBasic() {
  const cards = availableOppNames();
  const userNames = availableUserNames();
  const userDef = defenderCard ? defenderCard.dataset.name : null;
  if (userDef) {
    const idx = userNames.indexOf(userDef);
    if (idx !== -1) userNames.splice(idx, 1);
  }
  let best = null;
  let bestVal = Infinity;
  cards.forEach(name => {
    const col = colIndex(name);
    let maxMin = -Infinity;
    for (let i = 0; i < userNames.length; i++) {
      for (let j = i + 1; j < userNames.length; j++) {
        const r1 = rowIndex(userNames[i]);
        const r2 = rowIndex(userNames[j]);
        const val = Math.min(matrixData[r1][col], matrixData[r2][col]);
        if (val > maxMin) maxMin = val;
      }
    }
    if (maxMin < bestVal) {
      bestVal = maxMin;
      best = name;
    }
  });
  if (!best) return chooseRandomCard('#opponent-hand .army-slot');
  return document.querySelector(`#opponent-hand .army-slot[data-name="${best}"]`);
}

function chooseDefenderAdvanced() {
  const cards = availableOppNames();
  let bestCard = null;
  let bestVal = Infinity;
  const userDef = defenderCard ? defenderCard.dataset.name : null;
  const userNames = availableUserNames();
  if (userDef) {
    const idx = userNames.indexOf(userDef);
    if (idx !== -1) userNames.splice(idx, 1);
  }
  cards.forEach(name => {
    const remB = availableOppNames().filter(n => n !== name);
    const score = matrixVal(userDef, name) + computeMinTotal(userNames, remB);
    if (score < bestVal) {
      bestVal = score;
      bestCard = name;
    }
  });
  if (!bestCard) return chooseRandomCard('#opponent-hand .army-slot');
  return document.querySelector(`#opponent-hand .army-slot[data-name="${bestCard}"]`);
}

function chooseAttackersBasic(defName) {
  const oppCards = availableOppNames().filter(n => n !== (oppDefenderCard ? oppDefenderCard.dataset.name : ''));
  let bestPair = [];
  let bestVal = Infinity;
  const row = rowIndex(defName);
  for (let i = 0; i < oppCards.length; i++) {
    for (let j = i + 1; j < oppCards.length; j++) {
      const c1 = colIndex(oppCards[i]);
      const c2 = colIndex(oppCards[j]);
      const val = Math.max(matrixData[row][c1], matrixData[row][c2]);
      if (val < bestVal) {
        bestVal = val;
        bestPair = [oppCards[i], oppCards[j]];
      }
    }
  }
  if (bestPair.length === 0) {
    bestPair = oppCards.slice(0, 2);
  }
  return bestPair.map(n => document.querySelector(`#opponent-hand .army-slot[data-name="${n}"]`));
}

function chooseAttackersAdvanced(defName) {
  const available = availableOppNames().filter(n => n !== (oppDefenderCard ? oppDefenderCard.dataset.name : ''));
  let bestPair = [];
  let bestVal = Infinity;
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const a1 = available[i];
      const a2 = available[j];
      const keep = matrixVal(defName, a1) >= matrixVal(defName, a2) ? a1 : a2;
      const score = Math.max(matrixVal(defName, a1), matrixVal(defName, a2));
      const remA = availableUserNames().filter(n => n !== defName);
      const remB = availableOppNames().filter(n => n !== keep && n !== (oppDefenderCard ? oppDefenderCard.dataset.name : ''));
      const total = score + computeMinTotal(remA, remB);
      if (total < bestVal) {
        bestVal = total;
        bestPair = [a1, a2];
      }
    }
  }
  if (bestPair.length === 0) {
    bestPair = available.slice(0, 2);
  }
  return bestPair.map(n => document.querySelector(`#opponent-hand .army-slot[data-name="${n}"]`));
}

function chooseAcceptedBasic(userCards) {
  if (!oppDefenderCard) return userCards[Math.floor(Math.random() * userCards.length)];
  const bName = oppDefenderCard.dataset.name;
  const scores = userCards.map(c => matrixVal(c.dataset.name, bName));
  return scores[0] <= scores[1] ? userCards[0] : userCards[1];
}

function chooseAcceptedAdvanced(userCards) {
  if (!oppDefenderCard) return chooseAcceptedBasic(userCards);
  const bName = oppDefenderCard.dataset.name;
  let best = null;
  let bestVal = Infinity;
  userCards.forEach(card => {
    const remA = availableUserNames().filter(n => n !== card.dataset.name);
    const remB = availableOppNames().filter(n => n !== bName);
    const val = matrixVal(card.dataset.name, bName) + computeMinTotal(remA, remB);
    if (val < bestVal) {
      bestVal = val;
      best = card;
    }
  });
  return best || userCards[0];
}

function aiChooseDefender() {
  if (aiType === 'basic') return chooseDefenderBasic();
  if (aiType === 'advanced') return chooseDefenderAdvanced();
  return chooseRandomCard('#opponent-hand .army-slot');
}

function aiChooseAttackers(defName) {
  if (aiType === 'basic') return chooseAttackersBasic(defName);
  if (aiType === 'advanced') return chooseAttackersAdvanced(defName);
  const a = chooseRandomCard('#opponent-hand .army-slot');
  const b = chooseRandomCard('#opponent-hand .army-slot');
  return [a, b];
}

function aiChooseAccepted(cards) {
  if (aiType === 'basic') return chooseAcceptedBasic(cards);
  if (aiType === 'advanced') return chooseAcceptedAdvanced(cards);
  return cards[Math.floor(Math.random() * cards.length)];
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
  oppDefenderCard = aiChooseDefender();
  if (oppDefenderCard) moveCard(oppDefenderCard, 'opponent-defender');
  addLog(`Defenders: ${defenderCard.dataset.name} vs ${oppDefenderCard ? oppDefenderCard.dataset.name : 'None'}`);
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
  oppAttackerCards = aiChooseAttackers(defenderCard.dataset.name);
  oppAttackerCards.forEach((card, idx) => {
    if (card) moveCard(card, `opponent-attacker${idx + 1}`);
  });
  addLog(`Attackers offered: ${attackerCards.map(c => c.dataset.name).join(' & ')} vs ${oppAttackerCards.map(c => c.dataset.name).join(' & ')}`);

  if (inFinalRound) {
    const lastUser = document.querySelector('#user-hand .army-slot');
    const lastOpp = document.querySelector('#opponent-hand .army-slot');
    if (lastUser && lastOpp) {
      addPairing(lastUser, lastOpp);
      addLog(`The forgotten pairing is ${lastUser.dataset.name} vs ${lastOpp.dataset.name}`);
      updateMatrixAfterPair(lastUser.dataset.name, lastOpp.dataset.name);
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

  const oppAcceptedUser = aiChooseAccepted(attackerCards);
  const userRefused = attackerCards.find(c => c !== oppAcceptedUser);
  if (!inFinalRound && userRefused) {
    document.getElementById('user-hand').appendChild(userRefused);
  }
  if (userRefused) {
    userRefused.classList.remove('selected');
  }

  // Our army should always be displayed on top in the pairing board
  addPairing(defenderCard, oppAccepted);
  addLog(`Accepted pairing: ${defenderCard.dataset.name} vs ${oppAccepted.dataset.name}`);
  updateMatrixAfterPair(defenderCard.dataset.name, oppAccepted.dataset.name);
  // show our attacker on top when paired with the opponent defender
  addPairing(oppAcceptedUser, oppDefenderCard);
  addLog(`Accepted pairing: ${oppAcceptedUser.dataset.name} vs ${oppDefenderCard.dataset.name}`);
  updateMatrixAfterPair(oppAcceptedUser.dataset.name, oppDefenderCard.dataset.name);
  if (inFinalRound && refusedOpp && userRefused) {
    addPairing(userRefused, refusedOpp);
    addLog(`The refused pairing is ${userRefused.dataset.name} vs ${refusedOpp.dataset.name}`);
    updateMatrixAfterPair(userRefused.dataset.name, refusedOpp.dataset.name);
  }

  resetCentral();
  phase = inFinalRound ? 'done' : 'defender';
  attackerCards = [];
  oppAttackerCards = [];
  defenderCard = null;
  oppDefenderCard = null;
  inFinalRound = false;
  document.getElementById('confirm-accept').style.display = 'none';
  if (phase === 'done') {
    finishPairings();
  }
}

function addPairing(cardA, cardB) {
  const slot = document.querySelector('#pairings-board .pair-slot.empty');
  if (!slot) return;
  slot.classList.remove('empty');
  slot.appendChild(cardA);
  slot.appendChild(cardB);
  slot.dataset.a = cardA.dataset.name;
  slot.dataset.b = cardB.dataset.name;
  adjustPairNames();
}

function resetCentral() {
  ['user-defender','user-attacker1','user-attacker2','opponent-defender','opponent-attacker1','opponent-attacker2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function restoreMatrix() {
  const current = document.querySelector('.matrix-table');
  if (current && origMatrixTable) {
    current.replaceWith(origMatrixTable.cloneNode(true));
  }
  matrixData = origMatrix.map(r => r.slice());
  teamAList = origTeamA.slice();
  teamBList = origTeamB.slice();
}

function resetPairings() {
  restoreMatrix();
  document.getElementById('user-hand').innerHTML = origUserHandHTML;
  document.getElementById('opponent-hand').innerHTML = origOppHandHTML;
  document.getElementById('pairings-board').innerHTML = origBoardHTML;
  adjustPairNames();
  document.getElementById('log').innerHTML = '';
  const panel = document.querySelector('.log-panel');
  if (panel) panel.style.display = '';
  const toggleBtn = document.getElementById('toggle-log');
  if (toggleBtn) toggleBtn.textContent = 'Hide Log';
  document.getElementById('user-hand').style.display = '';
  document.getElementById('opponent-hand').style.display = '';
  const area = document.getElementById('pair-area');
  if (area) area.style.display = '';
  const conf = document.getElementById('confirm-buttons');
  if (conf) conf.style.display = '';
  document.getElementById('user-heading').style.display = '';
  document.getElementById('opp-heading').style.display = '';
  resetCentral();
  phase = 'defender';
  attackerCards = [];
  oppAttackerCards = [];
  defenderCard = null;
  oppDefenderCard = null;
  inFinalRound = false;
  document.querySelectorAll('.confirm-btn').forEach(btn => btn.style.display = 'none');
  document.getElementById('end-buttons').style.display = 'none';
  const back = document.getElementById('back-btn');
  if (back) back.style.display = 'none';
  document.body.classList.remove('finished');
  setupArmySelection();
}

function finishPairings() {
  showScores();
  adjustPairNames();
  restoreMatrix();
  document.getElementById('user-hand').style.display = 'none';
  document.getElementById('opponent-hand').style.display = 'none';
  const area = document.getElementById('pair-area');
  if (area) area.style.display = 'none';
  const conf = document.getElementById('confirm-buttons');
  if (conf) conf.style.display = 'none';
  document.getElementById('user-heading').style.display = 'none';
  document.getElementById('opp-heading').style.display = 'none';
  document.getElementById('end-buttons').style.display = 'block';
  const back = document.getElementById('back-btn');
  if (back) back.style.display = 'block';
  document.body.classList.add('finished');
}

function adjustPairNames() {
  document
    .querySelectorAll('#pairings-board .army-name, #pair-area .army-name')
    .forEach(name => {
      if (name.scrollHeight > 14) {
        name.style.marginTop = '-4px';
      } else {
        name.style.marginTop = '0';
      }
    });
}
