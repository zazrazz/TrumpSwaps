const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const BOT_NAMES = ['Atlas', 'Vega', 'Nova', 'Rook', 'Blaze'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function createPlayer({ id, name, isBot }) {
  return {
    id,
    name,
    isBot,
    socketId: null,
    connected: isBot,
    stack: 1000,
    hand: [],
    folded: false,
    inHand: false,
    hasSwapped: false,
    roundBet: 0,
    tricksWon: 0,
    acted: false,
  };
}

const game = {
  players: [
    createPlayer({ id: 'human', name: 'You', isBot: false }),
    ...BOT_NAMES.map((name, i) => createPlayer({ id: `bot-${i + 1}`, name, isBot: true })),
  ],
  phase: 'waiting',
  dealerIndex: 0,
  turnIndex: 0,
  deck: [],
  community: [],
  pot: 0,
  currentBet: 0,
  trumpSuit: null,
  trick: {
    leadSuit: null,
    plays: [],
    leaderId: null,
  },
  log: [],
  handNumber: 0,
  botTimer: null,
};

function addLog(line) {
  game.log.push(line);
  if (game.log.length > 16) game.log.shift();
}

function cardSuit(card) {
  return card.slice(-1);
}

function cardRank(card) {
  return card.slice(0, -1);
}

function cardScore(card) {
  return RANK_VALUE[cardRank(card)] || 0;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function inHandPlayers() {
  return game.players.filter((p) => p.inHand && !p.folded);
}

function nextActiveIndex(fromIndex) {
  for (let i = 1; i <= game.players.length; i += 1) {
    const idx = (fromIndex + i) % game.players.length;
    const p = game.players[idx];
    if (p.inHand && !p.folded) {
      if (game.phase !== 'trick' || p.hand.length > 0) return idx;
    }
  }
  return fromIndex;
}

function recalculateTrump() {
  if (!game.community.length) {
    game.trumpSuit = null;
    return;
  }

  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const card of game.community) counts[cardSuit(card)] += 1;
  const maxCount = Math.max(...Object.values(counts));
  const tied = SUITS.filter((s) => counts[s] === maxCount);

  if (tied.length === 1) {
    game.trumpSuit = tied[0];
    return;
  }

  let bestSuit = tied[0];
  let bestRank = -1;
  for (const suit of tied) {
    const rankInSuit = Math.max(
      ...game.community
        .filter((c) => cardSuit(c) === suit)
        .map((c) => cardScore(c))
    );
    if (rankInSuit > bestRank) {
      bestRank = rankInSuit;
      bestSuit = suit;
    }
  }

  game.trumpSuit = bestSuit;
}

function resetRoundBets() {
  game.currentBet = 0;
  for (const p of game.players) {
    p.roundBet = 0;
    p.acted = false;
  }
}

function revealCommunityCards(count) {
  for (let i = 0; i < count; i += 1) {
    const card = game.deck.pop();
    if (card) game.community.push(card);
  }
  recalculateTrump();
}

function settleSingleWinner(winner) {
  winner.stack += game.pot;
  addLog(`${winner.name} wins ${game.pot} chips by fold.`);
  game.pot = 0;
  game.phase = 'waiting';
}

function settleByTricks() {
  const contenders = inHandPlayers();
  const maxTricks = Math.max(...contenders.map((p) => p.tricksWon));
  const winners = contenders.filter((p) => p.tricksWon === maxTricks);
  const split = Math.floor(game.pot / winners.length);
  let rem = game.pot % winners.length;

  for (const winner of winners) {
    winner.stack += split + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }

  addLog(
    `Hand over. Winner${winners.length > 1 ? 's' : ''}: ${winners
      .map((w) => w.name)
      .join(', ')} (${maxTricks} tricks).`
  );

  game.pot = 0;
  game.phase = 'waiting';
}

function isBetRoundComplete() {
  const active = inHandPlayers();
  if (active.length <= 1) return true;
  return active.every((p) => p.acted && p.roundBet === game.currentBet);
}

function startTrickPhase() {
  game.phase = 'trick';
  const leader = nextActiveIndex(game.dealerIndex);
  game.turnIndex = leader;
  game.trick = {
    leadSuit: null,
    plays: [],
    leaderId: game.players[leader].id,
  };
  addLog(`Trick-taking begins. Trump is ${game.trumpSuit || '-'} .`);
}

function proceedStage() {
  const active = inHandPlayers();
  if (active.length <= 1) {
    settleSingleWinner(active[0]);
    return;
  }

  if (game.phase === 'preflopBet') {
    revealCommunityCards(3);
    game.phase = 'flopBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex(game.dealerIndex);
    addLog('Flop revealed (3 cards).');
    return;
  }

  if (game.phase === 'flopBet') {
    revealCommunityCards(2);
    game.phase = 'turnBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex(game.dealerIndex);
    addLog('Turn revealed (2 cards).');
    return;
  }

  if (game.phase === 'turnBet') {
    revealCommunityCards(2);
    game.phase = 'riverBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex(game.dealerIndex);
    addLog('River revealed (2 cards).');
    return;
  }

  if (game.phase === 'riverBet') {
    startTrickPhase();
  }
}

function evaluateTrickWinner(plays, leadSuit, trumpSuit) {
  let winning = plays[0];

  for (const challenger of plays.slice(1)) {
    const a = winning.card;
    const b = challenger.card;
    const aSuit = cardSuit(a);
    const bSuit = cardSuit(b);

    const aTrump = trumpSuit && aSuit === trumpSuit;
    const bTrump = trumpSuit && bSuit === trumpSuit;

    if (bTrump && !aTrump) {
      winning = challenger;
      continue;
    }
    if (aTrump && !bTrump) continue;

    if (aTrump && bTrump) {
      if (cardScore(b) > cardScore(a)) winning = challenger;
      continue;
    }

    const aLead = aSuit === leadSuit;
    const bLead = bSuit === leadSuit;

    if (bLead && !aLead) {
      winning = challenger;
      continue;
    }

    if (aLead && bLead && cardScore(b) > cardScore(a)) {
      winning = challenger;
    }
  }

  return winning.playerId;
}

function isHumanTurn(socketId) {
  const current = game.players[game.turnIndex];
  return current && !current.isBot && current.socketId === socketId;
}

function getPlayerBySocket(socketId) {
  return game.players.find((p) => p.socketId === socketId);
}

function resetForNewHand() {
  for (const p of game.players) {
    p.hand = [];
    p.folded = false;
    p.inHand = false;
    p.hasSwapped = false;
    p.roundBet = 0;
    p.tricksWon = 0;
    p.acted = false;
  }
  game.community = [];
  game.pot = 0;
  game.currentBet = 0;
  game.trumpSuit = null;
  game.trick = { leadSuit: null, plays: [], leaderId: null };
}

function startHand() {
  const human = game.players[0];
  if (!human.connected) {
    addLog('Waiting for a human player to connect.');
    return;
  }

  resetForNewHand();
  game.handNumber += 1;
  game.phase = 'preflopBet';
  game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
  game.deck = createDeck();

  for (const p of game.players) {
    p.inHand = p.stack > 0;
  }

  for (let round = 0; round < 7; round += 1) {
    for (const p of game.players) {
      if (p.inHand) p.hand.push(game.deck.pop());
    }
  }

  game.turnIndex = nextActiveIndex(game.dealerIndex);
  addLog(`Hand #${game.handNumber} started. Dealer: ${game.players[game.dealerIndex].name}`);
}

function nextTurn() {
  game.turnIndex = nextActiveIndex(game.turnIndex);
}

function canSwap(player) {
  return (
    !player.hasSwapped &&
    ['flopBet', 'turnBet', 'riverBet', 'preflopBet'].includes(game.phase) &&
    game.community.length > 0
  );
}

function doSwap(player, handIndex, communityIndex) {
  if (!canSwap(player)) return { ok: false, message: 'Swap unavailable.' };
  if (handIndex < 0 || handIndex >= player.hand.length) return { ok: false, message: 'Invalid hand card.' };
  if (communityIndex < 0 || communityIndex >= game.community.length) {
    return { ok: false, message: 'Invalid community card.' };
  }

  const cost = Math.ceil(game.pot * 0.5);
  if (player.stack < cost) return { ok: false, message: 'Not enough chips for swap.' };

  player.stack -= cost;
  game.pot += cost;
  player.hasSwapped = true;

  const handCard = player.hand[handIndex];
  const tableCard = game.community[communityIndex];
  player.hand[handIndex] = tableCard;
  game.community[communityIndex] = handCard;

  recalculateTrump();
  addLog(`${player.name} swapped a card for ${cost} chips.`);
  return { ok: true };
}

function handleBetAction(player, action, amount) {
  const need = game.currentBet - player.roundBet;

  if (action === 'fold') {
    player.folded = true;
    player.acted = true;
    addLog(`${player.name} folds.`);
    return { ok: true };
  }

  if (action === 'check') {
    if (need !== 0) return { ok: false, message: 'Cannot check; call is required.' };
    player.acted = true;
    addLog(`${player.name} checks.`);
    return { ok: true };
  }

  if (action === 'call') {
    if (need <= 0) return { ok: false, message: 'Nothing to call.' };
    if (player.stack < need) return { ok: false, message: 'Not enough chips to call.' };
    player.stack -= need;
    player.roundBet += need;
    game.pot += need;
    player.acted = true;
    addLog(`${player.name} calls ${need}.`);
    return { ok: true };
  }

  if (action === 'bet') {
    if (game.currentBet !== 0) return { ok: false, message: 'Bet not allowed; use raise.' };
    const bet = Math.max(1, Number(amount) || 0);
    if (player.stack < bet) return { ok: false, message: 'Not enough chips to bet.' };

    player.stack -= bet;
    player.roundBet += bet;
    game.pot += bet;
    game.currentBet = bet;

    for (const p of inHandPlayers()) p.acted = false;
    player.acted = true;

    addLog(`${player.name} bets ${bet}.`);
    return { ok: true };
  }

  if (action === 'raise') {
    if (game.currentBet === 0) return { ok: false, message: 'Raise not allowed; use bet.' };
    const raiseBy = Math.max(1, Number(amount) || 0);
    const totalNeed = need + raiseBy;
    if (player.stack < totalNeed) return { ok: false, message: 'Not enough chips to raise.' };

    player.stack -= totalNeed;
    player.roundBet += totalNeed;
    game.pot += totalNeed;
    game.currentBet += raiseBy;

    for (const p of inHandPlayers()) p.acted = false;
    player.acted = true;

    addLog(`${player.name} raises ${raiseBy}.`);
    return { ok: true };
  }

  if (action === 'swap') {
    return { ok: false, message: 'Swap requires card indexes.' };
  }

  return { ok: false, message: 'Unknown action.' };
}

function handlePlayCard(player, card) {
  if (game.phase !== 'trick') return { ok: false, message: 'Not in trick phase.' };
  const idx = player.hand.indexOf(card);
  if (idx === -1) return { ok: false, message: 'Card not in hand.' };

  if (game.trick.leadSuit) {
    const hasLead = player.hand.some((c) => cardSuit(c) === game.trick.leadSuit);
    if (hasLead && cardSuit(card) !== game.trick.leadSuit) {
      return { ok: false, message: 'Must follow lead suit.' };
    }
  }

  player.hand.splice(idx, 1);
  game.trick.plays.push({ playerId: player.id, card });
  if (!game.trick.leadSuit) game.trick.leadSuit = cardSuit(card);

  const activeCount = inHandPlayers().length;
  if (game.trick.plays.length < activeCount) {
    nextTurn();
    return { ok: true };
  }

  const winnerId = evaluateTrickWinner(game.trick.plays, game.trick.leadSuit, game.trumpSuit);
  const winner = game.players.find((p) => p.id === winnerId);
  winner.tricksWon += 1;
  addLog(`${winner.name} wins the trick.`);

  const handsRemaining = inHandPlayers().some((p) => p.hand.length > 0);
  if (!handsRemaining) {
    settleByTricks();
    return { ok: true };
  }

  const winnerIdx = game.players.findIndex((p) => p.id === winnerId);
  game.turnIndex = winnerIdx;
  game.trick = {
    leadSuit: null,
    plays: [],
    leaderId: winnerId,
  };

  return { ok: true };
}

function simpleBotSwapChoice(bot) {
  if (!canSwap(bot) || game.community.length === 0) return null;
  const swapCost = Math.ceil(game.pot * 0.5);
  if (bot.stack < swapCost) return null;

  const lowHand = bot.hand
    .map((card, i) => ({ i, score: cardScore(card) }))
    .sort((a, b) => a.score - b.score)[0];

  const bestTable = game.community
    .map((card, i) => ({ i, score: cardScore(card), suit: cardSuit(card) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!lowHand || !bestTable) return null;

  const trumpBias = game.trumpSuit && bestTable.suit === game.trumpSuit ? 2 : 0;
  const gain = bestTable.score + trumpBias - lowHand.score;
  if (gain < 3) return null;

  if (Math.random() < 0.45) {
    return { handIndex: lowHand.i, communityIndex: bestTable.i };
  }

  return null;
}

function chooseBotBetAction(bot) {
  const need = game.currentBet - bot.roundBet;

  const swapPick = simpleBotSwapChoice(bot);
  if (swapPick) {
    return { type: 'swap', ...swapPick };
  }

  if (need > 0) {
    if (need > bot.stack * 0.35 && Math.random() < 0.45) return { type: 'fold' };
    if (bot.stack > need + 30 && Math.random() < 0.2) return { type: 'raise', amount: 20 };
    return { type: 'call' };
  }

  if (game.currentBet === 0 && bot.stack > 30 && Math.random() < 0.22) {
    return { type: 'bet', amount: 20 };
  }

  return { type: 'check' };
}

function chooseBotTrickCard(bot) {
  const hand = bot.hand.slice();
  if (!hand.length) return null;

  if (!game.trick.leadSuit) {
    return hand.sort((a, b) => cardScore(b) - cardScore(a))[0];
  }

  const leadCards = hand.filter((c) => cardSuit(c) === game.trick.leadSuit);
  if (leadCards.length) {
    return leadCards.sort((a, b) => cardScore(b) - cardScore(a))[0];
  }

  const trumps = game.trumpSuit ? hand.filter((c) => cardSuit(c) === game.trumpSuit) : [];
  if (trumps.length) {
    return trumps.sort((a, b) => cardScore(a) - cardScore(b))[0];
  }

  return hand.sort((a, b) => cardScore(a) - cardScore(b))[0];
}

function emitState(errorBySocketId = null) {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state', buildStateFor(socket.id, errorBySocketId?.[socket.id] || null));
  }
  maybeScheduleBotTurn();
}

function buildStateFor(socketId, errorMessage) {
  const viewer = getPlayerBySocket(socketId);
  const viewerId = viewer ? viewer.id : null;

  return {
    viewerId,
    phase: game.phase,
    handNumber: game.handNumber,
    dealerId: game.players[game.dealerIndex]?.id,
    turnPlayerId: game.players[game.turnIndex]?.id || null,
    pot: game.pot,
    currentBet: game.currentBet,
    trumpSuit: game.trumpSuit,
    community: game.community,
    trick: game.trick,
    log: game.log,
    error: errorMessage,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      stack: p.stack,
      folded: p.folded,
      inHand: p.inHand,
      hasSwapped: p.hasSwapped,
      roundBet: p.roundBet,
      tricksWon: p.tricksWon,
      handCount: p.hand.length,
      hand: viewerId === p.id ? p.hand : [],
    })),
  };
}

function maybeScheduleBotTurn() {
  if (game.botTimer) {
    clearTimeout(game.botTimer);
    game.botTimer = null;
  }

  if (!['preflopBet', 'flopBet', 'turnBet', 'riverBet', 'trick'].includes(game.phase)) return;
  const current = game.players[game.turnIndex];
  if (!current || !current.isBot || !current.inHand || current.folded) return;

  game.botTimer = setTimeout(() => {
    game.botTimer = null;
    runBotTurn(current);
  }, 700);
}

function runBotTurn(bot) {
  if (game.players[game.turnIndex]?.id !== bot.id) return;

  if (['preflopBet', 'flopBet', 'turnBet', 'riverBet'].includes(game.phase)) {
    const decision = chooseBotBetAction(bot);
    if (decision.type === 'swap') {
      doSwap(bot, decision.handIndex, decision.communityIndex);
      bot.acted = true;
      nextTurn();
      if (isBetRoundComplete()) proceedStage();
      emitState();
      return;
    }

    const res = handleBetAction(bot, decision.type, decision.amount || 0);
    if (!res.ok) {
      const fallback = handleBetAction(bot, 'check', 0);
      if (!fallback.ok) handleBetAction(bot, 'call', 0);
    }

    if (game.phase === 'waiting') {
      emitState();
      return;
    }

    if (isBetRoundComplete()) {
      proceedStage();
    } else {
      nextTurn();
    }

    emitState();
    return;
  }

  if (game.phase === 'trick') {
    const card = chooseBotTrickCard(bot);
    if (!card) return;
    handlePlayCard(bot, card);
    emitState();
  }
}

function processHumanAction(socketId, payload) {
  const errors = {};
  const actor = getPlayerBySocket(socketId);
  if (!actor) {
    errors[socketId] = 'You are a spectator.';
    emitState(errors);
    return;
  }

  if (!isHumanTurn(socketId) && payload.type !== 'startHand') {
    errors[socketId] = 'Not your turn.';
    emitState(errors);
    return;
  }

  if (payload.type === 'startHand') {
    if (game.phase !== 'waiting') {
      errors[socketId] = 'Hand already in progress.';
    } else {
      startHand();
    }
    emitState(errors);
    return;
  }

  if (['preflopBet', 'flopBet', 'turnBet', 'riverBet'].includes(game.phase)) {
    if (payload.type === 'swap') {
      const res = doSwap(actor, Number(payload.handIndex), Number(payload.communityIndex));
      if (!res.ok) {
        errors[socketId] = res.message;
        emitState(errors);
        return;
      }
      actor.acted = true;
      if (isBetRoundComplete()) {
        proceedStage();
      } else {
        nextTurn();
      }
      emitState();
      return;
    }

    const res = handleBetAction(actor, payload.type, payload.amount || 0);
    if (!res.ok) {
      errors[socketId] = res.message;
      emitState(errors);
      return;
    }

    if (game.phase === 'waiting') {
      emitState();
      return;
    }

    if (isBetRoundComplete()) {
      proceedStage();
    } else {
      nextTurn();
    }

    emitState();
    return;
  }

  if (game.phase === 'trick') {
    if (payload.type !== 'playCard') {
      errors[socketId] = 'Only card play is allowed now.';
      emitState(errors);
      return;
    }

    const res = handlePlayCard(actor, payload.card);
    if (!res.ok) {
      errors[socketId] = res.message;
      emitState(errors);
      return;
    }

    emitState();
  }
}

io.on('connection', (socket) => {
  const human = game.players[0];

  if (!human.connected) {
    human.connected = true;
    human.socketId = socket.id;
    socket.emit('assignment', { role: 'player', playerId: human.id, name: human.name });
    addLog('Human player connected.');
  } else {
    socket.emit('assignment', { role: 'spectator' });
  }

  socket.on('startHand', () => {
    processHumanAction(socket.id, { type: 'startHand' });
  });

  socket.on('playerAction', (payload) => {
    processHumanAction(socket.id, payload || {});
  });

  socket.on('disconnect', () => {
    const player = getPlayerBySocket(socket.id);
    if (player && !player.isBot) {
      player.connected = false;
      player.socketId = null;
      addLog('Human player disconnected.');
      if (game.phase !== 'waiting') {
        game.phase = 'waiting';
        addLog('Current hand stopped. Reconnect to start a new hand.');
      }
    }
    emitState();
  });

  emitState();
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`TrumpSwap server running at http://localhost:${PORT}`);
});
