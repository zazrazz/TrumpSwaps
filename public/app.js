let state;
let me;
let playerId = localStorage.getItem('trumpSwapPlayerId') || null;
let selectedHand = null;
let selectedCommunity = null;
let lastError = '';

const el = {
  nameInput: document.getElementById('nameInput'),
  joinBtn: document.getElementById('joinBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  addBotBtn: document.getElementById('addBotBtn'),
  resetBtn: document.getElementById('resetBtn'),
  startBtn: document.getElementById('startBtn'),
  amountInput: document.getElementById('amountInput'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  community: document.getElementById('community'),
  hand: document.getElementById('hand'),
  players: document.getElementById('players'),
  log: document.getElementById('log'),
  swapBtn: document.getElementById('swapBtn'),
};

async function post(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
}

async function runAction(fn) {
  try {
    const result = await fn();
    if (result?.error) {
      lastError = result.error;
    } else {
      lastError = '';
    }
  } catch {
    lastError = 'Request failed. Is the server running?';
  }
  await refresh();
}

async function refresh() {
  try {
    const res = await fetch(`/state?playerId=${encodeURIComponent(playerId || '')}`);
    state = await res.json();
    me = state.players.find((p) => p.id === playerId);
    if (playerId && !me) {
      playerId = null;
      localStorage.removeItem('trumpSwapPlayerId');
      selectedHand = null;
      selectedCommunity = null;
    }
    render();
  } catch {
    lastError = 'Unable to fetch state from server.';
    render();
  }
}

function render() {
  if (!state) return;

  const turnName = state.players.find((p) => p.id === state.turnPlayerId)?.name || '-';
  const myTurn = me && state.turnPlayerId === me.id;
  el.status.textContent = `You: ${me?.name || 'not joined'} | Phase: ${state.phase} | Pot: ${state.pot} | Current Bet: ${state.currentBet} | Trump: ${state.trump || 'TBD'} | Turn: ${turnName}${myTurn ? ' (your turn)' : ''}`;
  el.error.textContent = lastError;

  el.players.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    const tag = p.type === 'bot' ? '[BOT] ' : '';
    li.textContent = `${tag}${p.name} | chips ${p.chips} | hand ${p.handCount} | folded ${p.folded} | swapped ${p.hasSwapped} | tricks ${p.tricksWon} | bet ${p.currentBet}`;
    el.players.appendChild(li);
  }

  el.community.innerHTML = '';
  for (const c of state.community) {
    const b = document.createElement('button');
    b.className = `card ${selectedCommunity === c ? 'selected' : ''}`;
    b.textContent = c;
    b.onclick = () => {
      selectedCommunity = c;
      render();
    };
    el.community.appendChild(b);
  }

  el.hand.innerHTML = '';
  for (const c of me?.hand || []) {
    const b = document.createElement('button');
    b.className = `card ${selectedHand === c ? 'selected' : ''}`;
    b.textContent = c;
    b.onclick = async () => {
      if (state.phase === 'trick') {
        await runAction(() => post('/action', { playerId, kind: 'playCard', card: c }));
      } else {
        selectedHand = c;
        render();
      }
    };
    el.hand.appendChild(b);
  }

  el.log.innerHTML = '';
  for (const line of state.log.slice().reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    el.log.appendChild(li);
  }
}

el.joinBtn.onclick = async () => {
  const name = el.nameInput.value.trim();
  if (!name) {
    lastError = 'Enter a name first.';
    render();
    return;
  }
  await runAction(async () => {
    const res = await post('/join', { name });
    if (res.playerId) {
      playerId = res.playerId;
      localStorage.setItem('trumpSwapPlayerId', playerId);
    }
    return res;
  });
};

el.leaveBtn.onclick = async () => {
  if (!playerId) return;
  await runAction(async () => {
    const res = await post('/leave', { playerId });
    if (res.ok) {
      playerId = null;
      localStorage.removeItem('trumpSwapPlayerId');
      selectedHand = null;
      selectedCommunity = null;
    }
    return res;
  });
};

el.addBotBtn.onclick = async () => {
  await runAction(() => post('/add-bot', {}));
};

el.resetBtn.onclick = async () => {
  await runAction(() => post('/reset', {}));
};

el.startBtn.onclick = async () => {
  if (!playerId) return;
  await runAction(() => post('/start', { playerId }));
};

document.querySelectorAll('.bet-actions button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!playerId) return;
    const action = btn.dataset.action;
    const amount = Number(el.amountInput.value || 0);
    await runAction(() => post('/action', { playerId, kind: 'bet', action, amount }));
  });
});

el.swapBtn.onclick = async () => {
  if (!playerId || !selectedHand || !selectedCommunity) {
    lastError = 'Select one hand card and one community card first.';
    render();
    return;
  }
  await runAction(() => post('/action', {
    playerId,
    kind: 'swap',
    handCard: selectedHand,
    communityCard: selectedCommunity,
  }));
};

setInterval(() => {
  refresh().catch(() => {});
}, 700);

refresh().catch(() => {});
