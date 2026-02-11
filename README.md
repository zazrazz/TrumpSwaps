# Trump Swap Online (Playable Multiplayer MVP)

This is a browser-based implementation of your Trump Swap ruleset for 2–6 players.

## Play locally

```bash
git clone <your-repo-url>
cd repo
npm install
npm start
```

Open `http://localhost:3000`.

## Quick way to play right now

1. Join with your name.
2. Click **Add Bot** (1+ times).
3. Click **Start Hand**.
4. Use betting controls until trick phase.
5. In trick phase, click cards to play.

## What works now

- 2–6 players, each dealt 7 cards.
- Community reveal with burns:
  - Flop (3)
  - Turn (2)
  - River (2)
- Betting rounds: pre-flop, post-flop, post-turn, post-river.
- Actions: bet, call, raise, check, fold.
- Trump suit based on community cards:
  - highest suit count wins
  - suit ties break by highest rank in tied suits
- One swap per player per hand in flop/turn/river betting rounds.
- Swap costs 50% of pot (rounded up), paid immediately into pot.
- Trick-taking with follow-suit enforcement and trump precedence.
- Pot goes to most tricks won, split on tie.

## Added for playability

- **Bot players** so you can play even if no other humans are online yet.
- Leave table and reset table controls.
- Better error reporting for illegal moves or wrong-turn actions.

## Codex workflow (requested)

```bash
git clone repo
cd repo
npm install
codex
# interact with Codex tasks
git add .
git commit -m "changes"
git push
```
