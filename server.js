const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

const BETTING_PHASES = ['preflopBet', 'flopBet', 'turnBet', 'riverBet'];

const game = {
  players: [],
  phase: 'waiting',
  dealerIndex: 0,
  turnIndex: 0,
  deck: [],
  community: [],
  pot: 0,
  currentBet: 0,
  actedSinceRaise: new Set(),
  trick: { index: 0, leadSuit: null, cards: [], leaderIndex: 0 },
  maxPlayers: 6,
  log: [],
  nextBotId: 1,
};

function log(msg) {
  game.log.push(msg);
  if (game.log.length > 40) game.log.shift();
}

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const cardSuit = (c) => c[1];
const cardRank = (c) => c[0];
const isBot = (p) => p.type === 'bot';
const activePlayers = () => game.players.filter((p) => p.inHand && !p.folded);

function resetTable() {
  game.phase = 'waiting';
  game.turnIndex = 0;
  game.deck = [];
  game.community = [];
  game.pot = 0;
  game.currentBet = 0;
  game.actedSinceRaise = new Set();
  game.trick = { index: 0, leadSuit: null, cards: [], leaderIndex: 0 };
  game.players.forEach((p) => {
    p.hand = [];
    p.inHand = false;
    p.folded = false;
    p.hasSwapped = false;
    p.currentBet = 0;
    p.tricksWon = 0;
  });
  log('Table reset.');
}

function getTrumpSuit() {
  if (!game.community.length) return null;
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of game.community) counts[cardSuit(c)] += 1;
  const maxCount = Math.max(...Object.values(counts));
  const tiedSuits = SUITS.filter((s) => counts[s] === maxCount);
  if (tiedSuits.length === 1) return tiedSuits[0];

  let bestSuit = tiedSuits[0];
  let bestRank = -1;
  for (const s of tiedSuits) {
    const maxRank = Math.max(...game.community.filter((c) => cardSuit(c) === s).map((c) => RANK_VALUE[cardRank(c)]));
    if (maxRank > bestRank) {
      bestSuit = s;
      bestRank = maxRank;
    }
  }
  return bestSuit;
}

function nextActiveIndex(from) {
  for (let i = 0; i < game.players.length; i++) {
    const idx = (from + i) % game.players.length;
    const p = game.players[idx];
    if (p.inHand && !p.folded) return idx;
  }
  return from;
}

function advanceTurn() {
  game.turnIndex = nextActiveIndex((game.turnIndex + 1) % game.players.length);
}

function resetRoundBets() {
  game.currentBet = 0;
  game.actedSinceRaise = new Set();
  game.players.forEach((p) => {
    p.currentBet = 0;
  });
}

function reveal(stage) {
  game.deck.pop();
  const n = stage === 'flop' ? 3 : 2;
  for (let i = 0; i < n; i++) game.community.push(game.deck.pop());
}

function bettingRoundComplete() {
  const actives = activePlayers();
  if (actives.length <= 1) return true;
  return actives.every((p) => p.currentBet === game.currentBet && game.actedSinceRaise.has(p.id));
}

function settleByFold(winner) {
  if (winner) {
    winner.chips += game.pot;
    log(`${winner.name} wins ${game.pot} chips (all others folded).`);
  }
  game.phase = 'waiting';
}

function settleByTricks() {
  const actives = activePlayers();
  const top = Math.max(...actives.map((p) => p.tricksWon));
  const winners = actives.filter((p) => p.tricksWon === top);
  const share = Math.floor(game.pot / winners.length);
  let rem = game.pot % winners.length;

  for (const winner of winners) {
    winner.chips += share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  log(`Hand over. Winner(s): ${winners.map((w) => w.name).join(', ')}.`);
  game.phase = 'waiting';
}

function proceedAfterBetting() {
  const actives = activePlayers();
  if (actives.length <= 1) return settleByFold(actives[0]);

  if (game.phase === 'preflopBet') {
    reveal('flop');
    game.phase = 'flopBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex((game.dealerIndex + 1) % game.players.length);
    log('Flop revealed.');
  } else if (game.phase === 'flopBet') {
    reveal('turn');
    game.phase = 'turnBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex((game.dealerIndex + 1) % game.players.length);
    log('Turn revealed.');
  } else if (game.phase === 'turnBet') {
    reveal('river');
    game.phase = 'riverBet';
    resetRoundBets();
    game.turnIndex = nextActiveIndex((game.dealerIndex + 1) % game.players.length);
    log('River revealed.');
  } else if (game.phase === 'riverBet') {
    game.phase = 'trick';
    game.trick = {
      index: 1,
      leadSuit: null,
      cards: [],
      leaderIndex: nextActiveIndex((game.dealerIndex + 1) % game.players.length),
    };
    game.turnIndex = game.trick.leaderIndex;
    log(`Trick-taking begins. Trump: ${getTrumpSuit()}.`);
  }
}

function evaluateTrickWinner(entries, leadSuit, trump) {
  let best = entries[0];
  for (const entry of entries.slice(1)) {
    const a = best.card;
    const b = entry.card;
    const aSuit = cardSuit(a);
    const bSuit = cardSuit(b);
    const aTrump = trump && aSuit === trump;
    const bTrump = trump && bSuit === trump;

    if (bTrump && !aTrump) {
      best = entry;
      continue;
    }
    if (aTrump && !bTrump) continue;
    if (aTrump && bTrump && RANK_VALUE[cardRank(b)] > RANK_VALUE[cardRank(a)]) {
      best = entry;
      continue;
    }

    if (!aTrump && !bTrump) {
      if (bSuit === leadSuit && aSuit !== leadSuit) {
        best = entry;
        continue;
      }
      if (bSuit === leadSuit && aSuit === leadSuit && RANK_VALUE[cardRank(b)] > RANK_VALUE[cardRank(a)]) {
        best = entry;
      }
    }
  }
  return best.playerId;
}

function startHand() {
  const seated = game.players.filter((p) => p.connected);
  if (seated.length < 2) return false;

  game.deck = createDeck();
  game.community = [];
  game.pot = 0;
  game.currentBet = 0;
  game.actedSinceRaise = new Set();
  game.trick = { index: 0, leadSuit: null, cards: [], leaderIndex: 0 };

  game.players.forEach((p) => {
    p.hand = [];
    p.inHand = p.connected;
    p.folded = false;
    p.hasSwapped = false;
    p.currentBet = 0;
    p.tricksWon = 0;
  });

  for (let i = 0; i < 7; i++) {
    for (const p of game.players) {
      if (p.inHand) p.hand.push(game.deck.pop());
    }
  }

  game.phase = 'preflopBet';
  game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
  game.turnIndex = nextActiveIndex((game.dealerIndex + 1) % game.players.length);
  log('New hand started. Pre-flop betting begins.');
  return true;
}

function asState(playerId) {
  return {
    phase: game.phase,
    dealerIndex: game.dealerIndex,
    turnPlayerId: game.players[game.turnIndex]?.id,
    community: game.community,
    trump: getTrumpSuit(),
    pot: game.pot,
    currentBet: game.currentBet,
    trick: game.trick,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      inHand: p.inHand,
      folded: p.folded,
      handCount: p.hand.length,
      hasSwapped: p.hasSwapped,
      tricksWon: p.tricksWon,
      currentBet: p.currentBet,
      connected: p.connected,
      type: p.type,
      hand: p.id === playerId ? p.hand : undefined,
    })),
    log: game.log,
  };
}

function doBet(player, action, amount = 0) {
  if (game.players[game.turnIndex]?.id !== player.id) return false;
  if (!BETTING_PHASES.includes(game.phase)) return false;

  const toCall = game.currentBet - player.currentBet;

  if (action === 'fold') {
    player.folded = true;
    player.inHand = false;
    log(`${player.name} folds.`);
  } else if (action === 'check') {
    if (toCall !== 0) return false;
    game.actedSinceRaise.add(player.id);
    log(`${player.name} checks.`);
  } else if (action === 'call') {
    if (toCall <= 0) return false;
    if (player.chips < toCall) return false;
    player.chips -= toCall;
    player.currentBet += toCall;
    game.pot += toCall;
    game.actedSinceRaise.add(player.id);
    log(`${player.name} calls ${toCall}.`);
  } else if (action === 'bet') {
    if (game.currentBet !== 0 || amount <= 0 || amount > player.chips) return false;
    player.chips -= amount;
    player.currentBet += amount;
    game.currentBet = amount;
    game.pot += amount;
    game.actedSinceRaise = new Set([player.id]);
    log(`${player.name} bets ${amount}.`);
  } else if (action === 'raise') {
    if (game.currentBet === 0) return false;
    if (amount <= game.currentBet) return false;
    const delta = amount - player.currentBet;
    if (delta <= 0 || delta > player.chips) return false;
    player.chips -= delta;
    player.currentBet = amount;
    game.currentBet = amount;
    game.pot += delta;
    game.actedSinceRaise = new Set([player.id]);
    log(`${player.name} raises to ${amount}.`);
  } else {
    return false;
  }

  const actives = activePlayers();
  if (actives.length <= 1) {
    settleByFold(actives[0]);
    return true;
  }

  if (bettingRoundComplete()) proceedAfterBetting();
  else advanceTurn();

  return true;
}

function doSwap(player, handCard, communityCard) {
  if (game.players[game.turnIndex]?.id !== player.id) return false;
  if (!['flopBet', 'turnBet', 'riverBet'].includes(game.phase)) return false;
  if (player.hasSwapped) return false;

  const handIdx = player.hand.indexOf(handCard);
  const tableIdx = game.community.indexOf(communityCard);
  if (handIdx === -1 || tableIdx === -1) return false;

  const cost = Math.ceil(game.pot * 0.5);
  if (player.chips < cost) return false;

  player.chips -= cost;
  game.pot += cost;
  player.hand[handIdx] = communityCard;
  game.community[tableIdx] = handCard;
  player.hasSwapped = true;

  log(`${player.name} swaps ${handCard} with ${communityCard} (cost ${cost}).`);
  return true;
}

function doPlayCard(player, card) {
  if (game.phase !== 'trick') return false;
  if (game.players[game.turnIndex]?.id !== player.id) return false;

  const idx = player.hand.indexOf(card);
  if (idx === -1) return false;

  if (game.trick.leadSuit) {
    const hasLead = player.hand.some((c) => cardSuit(c) === game.trick.leadSuit);
    if (hasLead && cardSuit(card) !== game.trick.leadSuit) return false;
  }

  player.hand.splice(idx, 1);
  if (!game.trick.leadSuit) game.trick.leadSuit = cardSuit(card);
  game.trick.cards.push({ playerId: player.id, card });
  log(`${player.name} plays ${card}.`);

  const needed = activePlayers().length;
  if (game.trick.cards.length === needed) {
    const winnerId = evaluateTrickWinner(game.trick.cards, game.trick.leadSuit, getTrumpSuit());
    const winner = game.players.find((p) => p.id === winnerId);
    winner.tricksWon += 1;
    log(`${winner.name} wins trick ${game.trick.index}.`);

    if (activePlayers().every((p) => p.hand.length === 0)) {
      settleByTricks();
    } else {
      game.trick = {
        index: game.trick.index + 1,
        leadSuit: null,
        cards: [],
        leaderIndex: game.players.indexOf(winner),
      };
      game.turnIndex = game.trick.leaderIndex;
    }
  } else {
    advanceTurn();
  }

  return true;
}

function botSwapMaybe(bot) {
  if (bot.hasSwapped) return;
  if (!['flopBet', 'turnBet', 'riverBet'].includes(game.phase)) return;
  if (Math.random() > 0.2) return;
  if (game.community.length === 0 || bot.hand.length === 0) return;
  const cost = Math.ceil(game.pot * 0.5);
  if (bot.chips < cost) return;
  doSwap(bot, bot.hand[0], game.community[0]);
}

function botTakeTurn(bot) {
  if (game.players[game.turnIndex]?.id !== bot.id) return;

  if (BETTING_PHASES.includes(game.phase)) {
    botSwapMaybe(bot);
    const toCall = game.currentBet - bot.currentBet;
    if (toCall === 0) {
      if (Math.random() < 0.2 && bot.chips >= 20) {
        const bet = Math.min(20, bot.chips);
        doBet(bot, 'bet', bet);
      } else {
        doBet(bot, 'check', 0);
      }
      return;
    }

    const affordability = bot.chips >= toCall;
    if (!affordability || Math.random() < 0.15) doBet(bot, 'fold', 0);
    else doBet(bot, 'call', 0);
    return;
  }

  if (game.phase === 'trick') {
    let options = [...bot.hand];
    if (game.trick.leadSuit) {
      const follow = bot.hand.filter((c) => cardSuit(c) === game.trick.leadSuit);
      if (follow.length) options = follow;
    }
    options.sort((a, b) => RANK_VALUE[cardRank(a)] - RANK_VALUE[cardRank(b)]);
    doPlayCard(bot, options[0]);
  }
}

function maybeRunBots() {
  if (!game.players.length) return;
  const turnPlayer = game.players[game.turnIndex];
  if (!turnPlayer || !isBot(turnPlayer)) return;
  botTakeTurn(turnPlayer);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(path.join(__dirname, 'public', target.slice(1)));
  const pubRoot = path.resolve(path.join(__dirname, 'public'));
  if (!filePath.startsWith(pubRoot)) return sendJson(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath);
    const type = ext === '.html'
      ? 'text/html'
      : ext === '.css'
        ? 'text/css'
        : ext === '.js'
          ? 'application/javascript'
          : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function addPlayer(name, type = 'human') {
  const player = {
    id: `${type === 'bot' ? 'b' : 'p'}_${Math.random().toString(36).slice(2, 9)}`,
    name,
    type,
    chips: 1000,
    hand: [],
    inHand: false,
    folded: false,
    hasSwapped: false,
    tricksWon: 0,
    currentBet: 0,
    connected: true,
  };
  game.players.push(player);
  return player;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && ['/', '/app.js', '/styles.css'].includes(url.pathname)) {
    return serveStatic(res, url.pathname);
  }

  if (req.method === 'POST' && url.pathname === '/join') {
    const body = await parseBody(req);
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return sendJson(res, 400, { error: 'Name required' });

    if (game.players.length >= game.maxPlayers) {
      return sendJson(res, 400, { error: 'Table full (6 max players).' });
    }

    const existing = game.players.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.type === 'human');
    if (existing) return sendJson(res, 400, { error: 'Name already taken.' });

    const player = addPlayer(name, 'human');
    log(`${player.name} joined.`);
    return sendJson(res, 200, { playerId: player.id });
  }

  if (req.method === 'POST' && url.pathname === '/add-bot') {
    if (game.players.length >= game.maxPlayers) {
      return sendJson(res, 400, { error: 'Table full (6 max players).' });
    }
    const bot = addPlayer(`Bot ${game.nextBotId}`, 'bot');
    game.nextBotId += 1;
    log(`${bot.name} joined.`);
    return sendJson(res, 200, { ok: true, playerId: bot.id });
  }

  if (req.method === 'POST' && url.pathname === '/leave') {
    const body = await parseBody(req);
    const idx = game.players.findIndex((p) => p.id === body.playerId && p.type === 'human');
    if (idx === -1) return sendJson(res, 404, { error: 'No player' });
    const [removed] = game.players.splice(idx, 1);
    log(`${removed.name} left.`);
    if (game.turnIndex >= game.players.length) game.turnIndex = 0;
    if (activePlayers().length <= 1 && game.phase !== 'waiting') settleByFold(activePlayers()[0]);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/reset') {
    resetTable();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/state') {
    const playerId = url.searchParams.get('playerId');
    return sendJson(res, 200, asState(playerId));
  }

  if (req.method === 'POST' && url.pathname === '/start') {
    const body = await parseBody(req);
    const player = game.players.find((p) => p.id === body.playerId);
    if (!player) return sendJson(res, 404, { error: 'No player' });
    if (game.phase !== 'waiting') return sendJson(res, 400, { error: 'Hand already in progress.' });
    const started = startHand();
    if (!started) return sendJson(res, 400, { error: 'Need at least 2 connected players.' });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/action') {
    const body = await parseBody(req);
    const player = game.players.find((p) => p.id === body.playerId);
    if (!player) return sendJson(res, 404, { error: 'No player' });

    let ok = false;
    if (body.kind === 'bet') ok = doBet(player, body.action, Number(body.amount || 0));
    else if (body.kind === 'swap') ok = doSwap(player, body.handCard, body.communityCard);
    else if (body.kind === 'playCard') ok = doPlayCard(player, body.card);

    if (!ok) return sendJson(res, 400, { ok: false, error: 'Illegal action for current phase/turn.' });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unknown route' });
}).listen(process.env.PORT || 3000, () => {
  console.log('Trump Swap server running at http://localhost:3000');
});

setInterval(maybeRunBots, 350);
