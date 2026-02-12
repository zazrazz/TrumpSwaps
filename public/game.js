const SUITS = ['C', 'D', 'H', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const CARD_W = 100;
const CARD_H = 140;

const SUIT_ICON = { C: '♣', D: '♦', H: '♥', S: '♠' };
const SUIT_COLOR = { C: '#f1f5f9', D: '#fb7185', H: '#fb7185', S: '#f1f5f9' };
const PHASE_LABEL = {
  waiting: 'Waiting',
  preflopBet: 'Pre-Flop',
  flopBet: 'Flop',
  turnBet: 'Turn',
  riverBet: 'River',
  trick: 'Trick Phase',
};

const DEPTH = {
  BG: 0,
  TABLE: 1,
  SEATS: 2,
  COMMUNITY: 3,
  TRICK: 4,
  HAND: 5,
  HUD: 6,
  OVERLAY: 7,
};

const suitOrder = Object.fromEntries(SUITS.map((s, i) => [s, i]));
const rankOrder = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function sortHand(cards) {
  return [...cards].sort((a, b) => {
    const sa = suitOrder[a.slice(-1)] ?? 99;
    const sb = suitOrder[b.slice(-1)] ?? 99;
    if (sa !== sb) return sa - sb;
    const ra = rankOrder[a.slice(0, -1)] ?? 99;
    const rb = rankOrder[b.slice(0, -1)] ?? 99;
    return ra - rb;
  });
}

export class TrumpSwapScene extends Phaser.Scene {
  constructor() {
    super('TrumpSwapScene');

    this.socket = null;
    this.state = null;
    this.prevState = null;

    this.layout = {
      w: 1400,
      h: 900,
      center: { x: 700, y: 450 },
      tableRx: 500,
      tableRy: 300,
      hudY: 56,
      potY: 180,
      communityY: 300,
      trickY: 430,
      handY: 700,
      controlsY: 818,
      deckPos: { x: 1025, y: 312 },
    };

    this.seatPositions = [];
    this.seatUi = new Map();

    this.hud = {};
    this.controls = {};
    this.logUi = {};

    this.communityCards = [];
    this.handCards = [];
    this.trickCardsByPlayer = new Map();

    this.swapMode = false;
    this.swapSelection = { handCard: null, communityIndex: null };
    this.pendingSwapAnimation = null;

    this.prevPot = 0;
    this.prevTrump = null;
    this.betValue = 20;
    this.logScroll = 0;
  }

  preload() {
    this.load.image('card-BACK', '/cards/BACK.png');
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (const rank of RANKS) {
        const code = `${rank}${suit}`;
        this.load.image(`card-${code}`, `/cards/${code}.png`);
      }
    }
  }

  create() {
    this.createBackground();
    this.createHud();
    this.createTableZones();
    this.createSeats();
    this.createActionBar();
    this.createLogPanel();
    this.setupSocket();

    const startBtn = document.getElementById('startHandBtn');
    startBtn.addEventListener('click', () => this.socket.emit('startHand'));
  }

  createBackground() {
    const { w, h, center, tableRx, tableRy } = this.layout;

    this.add.rectangle(w / 2, h / 2, w, h, 0x050913).setDepth(DEPTH.BG);

    this.add
      .ellipse(center.x, center.y, tableRx * 2 + 75, tableRy * 2 + 70, 0x2a1d12, 0.95)
      .setStrokeStyle(4, 0x7b5b3e, 0.55)
      .setDepth(DEPTH.TABLE);

    this.add
      .ellipse(center.x, center.y, tableRx * 2 + 20, tableRy * 2 + 20, 0x0c331d, 0.95)
      .setStrokeStyle(8, 0x113922, 0.9)
      .setDepth(DEPTH.TABLE);

    this.add
      .ellipse(center.x, center.y, tableRx * 2, tableRy * 2, 0x15643a, 0.97)
      .setStrokeStyle(1, 0x1f8c52, 0.5)
      .setDepth(DEPTH.TABLE);

    const noise = this.add.graphics().setDepth(DEPTH.TABLE);
    for (let i = 0; i < 220; i += 1) {
      noise.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.02, 0.07));
      noise.fillCircle(
        center.x + Phaser.Math.Between(-470, 470),
        center.y + Phaser.Math.Between(-260, 260),
        Phaser.Math.Between(1, 2)
      );
    }
  }

  createHud() {
    const { w, hudY, potY, center } = this.layout;

    const top = this.add.rectangle(w / 2, hudY, w - 40, 84, 0x0a1323, 0.9).setDepth(DEPTH.HUD);
    top.setStrokeStyle(1, 0x3d5066, 0.9);

    this.hud.phase = this.add
      .text(36, 30, 'Phase: Waiting', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '28px',
        color: '#f8fafc',
        fontStyle: '700',
      })
      .setDepth(DEPTH.HUD);

    this.hud.turn = this.add
      .text(36, 60, 'Turn: -', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '22px',
        color: '#cbd5e1',
        fontStyle: '600',
      })
      .setDepth(DEPTH.HUD);

    this.hud.pot = this.add
      .text(center.x - 75, 40, 'POT 0', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '44px',
        color: '#fde68a',
        fontStyle: '700',
      })
      .setDepth(DEPTH.HUD);

    this.hud.trumpIcon = this.add
      .text(w - 120, 39, '-', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '56px',
        color: '#f1f5f9',
        fontStyle: '700',
      })
      .setDepth(DEPTH.HUD);

    this.hud.trumpLabel = this.add
      .text(w - 228, 30, 'Trump', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '24px',
        color: '#d1d5db',
        fontStyle: '600',
      })
      .setDepth(DEPTH.HUD);

    this.hud.status = this.add
      .text(38, 98, '', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '20px',
        color: '#93c5fd',
        fontStyle: '600',
      })
      .setDepth(DEPTH.HUD);

    this.hud.potChips = this.add.container(center.x + 88, potY).setDepth(DEPTH.HUD);
    this.hud.potChips.add([
      this.add.circle(-10, 7, 18, 0x1d4ed8, 1).setStrokeStyle(2, 0xdbeafe, 0.8),
      this.add.circle(10, 7, 18, 0xb91c1c, 1).setStrokeStyle(2, 0xfee2e2, 0.8),
      this.add.circle(0, -7, 18, 0x0f766e, 1).setStrokeStyle(2, 0xccfbf1, 0.8),
    ]);

    this.hud.event = this.add
      .text(center.x - 160, 535, '', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '24px',
        color: '#f8fafc',
        fontStyle: '700',
      })
      .setDepth(DEPTH.OVERLAY);
  }

  createTableZones() {
    const c = this.layout.center;

    this.add
      .rectangle(c.x, this.layout.potY, 320, 60, 0x0b1220, 0.2)
      .setStrokeStyle(1, 0xe2e8f0, 0.18)
      .setDepth(DEPTH.TABLE);

    this.add
      .rectangle(c.x, this.layout.communityY, 720, 170, 0x0b1220, 0.2)
      .setStrokeStyle(1, 0xe2e8f0, 0.2)
      .setDepth(DEPTH.TABLE);

    this.trickZone = this.add
      .ellipse(c.x, this.layout.trickY, 460, 160, 0x0f172a, 0.22)
      .setStrokeStyle(2, 0xcbd5e1, 0.28)
      .setDepth(DEPTH.TRICK);
  }

  createSeats() {
    const { center, tableRx, tableRy } = this.layout;

    for (let i = 0; i < 6; i += 1) {
      const a = Phaser.Math.DegToRad(90 - i * 60);
      const x = center.x + Math.cos(a) * tableRx;
      const y = center.y + Math.sin(a) * tableRy;
      this.seatPositions.push({ x, y });

      const root = this.add.container(x, y).setDepth(DEPTH.SEATS);
      const activeGlow = this.add.ellipse(0, 0, 182, 78, 0x22c55e, 0.12).setVisible(false);
      activeGlow.setStrokeStyle(2, 0x4ade80, 0.9);

      const panel = this.add
        .rectangle(0, 0, 170, 62, 0x081220, 0.74)
        .setStrokeStyle(1, 0x475569, 0.45);

      const avatar = this.add.circle(-65, 0, 17, 0x1f2937, 1).setStrokeStyle(2, 0x94a3b8, 0.7);
      const avatarLetter = this.add
        .text(-65, -1, '?', {
          fontFamily: 'Rajdhani, Segoe UI, sans-serif',
          fontSize: '15px',
          color: '#f8fafc',
          fontStyle: '700',
        })
        .setOrigin(0.5);

      const name = this.add.text(-42, -18, 'Seat', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '17px',
        color: '#f8fafc',
        fontStyle: '700',
      });

      const stack = this.add.text(-42, 4, '0', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '18px',
        color: '#fcd34d',
        fontStyle: '700',
      });

      const cards = this.add.text(43, 8, '0', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#cbd5e1',
        fontStyle: '600',
      });

      const dealer = this.add.circle(70, -20, 9, 0xffffff, 1).setVisible(false);
      const dealerT = this.add
        .text(70, -20, 'D', {
          fontFamily: 'Rajdhani, Segoe UI, sans-serif',
          fontSize: '11px',
          color: '#111827',
          fontStyle: '700',
        })
        .setOrigin(0.5)
        .setVisible(false);

      root.add([activeGlow, panel, avatar, avatarLetter, name, stack, cards, dealer, dealerT]);

      this.seatUi.set(i, { root, activeGlow, panel, avatarLetter, name, stack, cards, dealer, dealerT });
    }
  }

  createActionBar() {
    const c = this.layout.center;

    const panel = this.add.container(c.x, this.layout.controlsY).setDepth(DEPTH.HUD);
    const bg = this.add.graphics();
    bg.fillStyle(0x081120, 0.92);
    bg.lineStyle(2, 0x3a4f66, 0.9);
    bg.fillRoundedRect(-500, -68, 1000, 136, 18);
    bg.strokeRoundedRect(-500, -68, 1000, 136, 18);
    panel.add(bg);

    this.controls.fold = this.createButton(panel, -390, -20, 'Fold', 0xb91c1c, () => this.sendAction({ type: 'fold' }));
    this.controls.check = this.createButton(panel, -255, -20, 'Check', 0x2563eb, () => this.sendAction({ type: 'check' }));
    this.controls.call = this.createButton(panel, -120, -20, 'Call', 0x1d4ed8, () => this.sendAction({ type: 'call' }));
    this.controls.bet = this.createButton(panel, 15, -20, 'Bet', 0x15803d, () => this.sendAction({ type: 'bet', amount: this.getBetAmount() }));
    this.controls.raise = this.createButton(panel, 150, -20, 'Raise', 0x16a34a, () => this.sendAction({ type: 'raise', amount: this.getBetAmount() }));
    this.controls.swap = this.createButton(panel, 285, -20, 'Swap', 0xb7791f, () => this.handleSwapButton());

    const sliderTrack = this.add.rectangle(-20, 28, 360, 10, 0x1f2937, 1).setOrigin(0.5);
    const sliderFill = this.add.rectangle(-200, 28, 0, 10, 0x22c55e, 1).setOrigin(0, 0.5);
    const sliderHandle = this.add
      .circle(-200, 28, 12, 0xe5e7eb, 1)
      .setStrokeStyle(2, 0x94a3b8, 0.9)
      .setInteractive({ draggable: true, useHandCursor: true });

    const sliderLabel = this.add
      .text(250, 17, 'Bet: 20', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '24px',
        color: '#e2e8f0',
        fontStyle: '700',
      })
      .setOrigin(0.5);

    sliderHandle.on('drag', (pointer, dragX) => {
      const min = -200;
      const max = 160;
      sliderHandle.x = Phaser.Math.Clamp(dragX, min, max);
      const t = (sliderHandle.x - min) / (max - min);
      const me = this.getMe();
      const maxBet = me ? Math.max(1, me.stack) : 1000;
      this.betValue = Math.max(1, Math.floor(1 + t * (maxBet - 1)));
      sliderFill.width = 360 * t;
      sliderLabel.setText(`Bet: ${this.betValue}`);
    });

    panel.add([sliderTrack, sliderFill, sliderHandle, sliderLabel]);

    this.controls.panel = panel;
    this.controls.sliderFill = sliderFill;
    this.controls.sliderHandle = sliderHandle;
    this.controls.sliderLabel = sliderLabel;
  }

  createButton(parent, x, y, label, color, onClick) {
    const g = this.add.graphics();
    const hit = this.add.zone(x, y, 120, 48).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '22px',
        color: '#f8fafc',
        fontStyle: '700',
      })
      .setOrigin(0.5);

    const btn = {
      g,
      hit,
      text,
      x,
      y,
      w: 120,
      h: 48,
      baseColor: color,
      disabled: false,
      draw: (hover = false) => {
        const fill = btn.disabled ? 0x334155 : btn.baseColor;
        const alpha = btn.disabled ? 0.45 : 0.96;
        g.clear();
        g.fillStyle(fill, alpha);
        g.lineStyle(1, 0xe2e8f0, btn.disabled ? 0.2 : 0.35);
        g.fillRoundedRect(x - 60, y - 24, 120, 48, 12);
        g.strokeRoundedRect(x - 60, y - 24, 120, 48, 12);
        if (hover && !btn.disabled) {
          g.lineStyle(2, 0xffffff, 0.35);
          g.strokeRoundedRect(x - 61, y - 25, 122, 50, 12);
        }
        text.setAlpha(btn.disabled ? 0.5 : 1);
      },
    };

    btn.draw(false);

    hit.on('pointerover', () => btn.draw(true));
    hit.on('pointerout', () => btn.draw(false));
    hit.on('pointerdown', () => {
      if (btn.disabled) return;
      this.tweens.add({ targets: [g, text], scale: 0.96, yoyo: true, duration: 90 });
      onClick();
    });

    parent.add([g, hit, text]);
    return btn;
  }

  createLogPanel() {
    const x = this.layout.w - 22;
    const y = this.layout.h - 16;

    const container = this.add.container(x, y).setDepth(DEPTH.OVERLAY);
    const toggle = this.add
      .text(-232, -210, 'LOG ▾', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '18px',
        color: '#e2e8f0',
        backgroundColor: '#0b1220',
        padding: { x: 10, y: 4 },
      })
      .setInteractive({ useHandCursor: true });

    const panel = this.add.rectangle(-145, -105, 290, 190, 0x0b1220, 0.92);
    panel.setStrokeStyle(1, 0x3b4c63, 0.9);
    const content = this.add.text(-275, -190, '', {
      fontFamily: 'Rajdhani, Segoe UI, sans-serif',
      fontSize: '16px',
      color: '#a3b8cf',
      lineSpacing: 2,
      wordWrap: { width: 255 },
    });

    const maskG = this.add.graphics();
    maskG.fillRect(this.layout.w - 284, this.layout.h - 206, 255, 164);
    content.setMask(maskG.createGeometryMask());

    container.add([panel, content, toggle]);

    let open = true;
    toggle.on('pointerdown', () => {
      open = !open;
      panel.setVisible(open);
      content.setVisible(open);
      toggle.setText(open ? 'LOG ▾' : 'LOG ▸');
    });

    this.input.on('wheel', (pointer, gameObjects, dx, dy) => {
      if (!open) return;
      const within = pointer.x > this.layout.w - 290 && pointer.x < this.layout.w - 20 && pointer.y > this.layout.h - 210;
      if (!within) return;
      this.logScroll = Phaser.Math.Clamp(this.logScroll + dy * 0.3, 0, 800);
      content.y = -190 - this.logScroll;
    });

    this.logUi = { container, panel, content, toggle, open: () => open };
  }

  setupSocket() {
    this.socket = io();
    this.socket.on('state', (nextState) => this.onState(nextState));
  }

  onState(nextState) {
    this.pendingSwapAnimation = this.detectSwap(nextState);

    this.prevState = this.state;
    this.state = nextState;

    this.renderHud();
    this.renderSeats();
    this.renderCommunity();
    this.renderHand();
    this.renderTrick();
    this.updateControls();
    this.updateSwapBadge();

    this.prevPot = this.state.pot;
    this.prevTrump = this.state.trumpSuit;
  }

  renderHud() {
    const phaseLabel = PHASE_LABEL[this.state.phase] || this.state.phase;
    const turnPlayer = this.state.players.find((p) => p.id === this.state.turnPlayerId);

    this.hud.phase.setText(`Phase: ${phaseLabel}`);
    this.hud.turn.setText(`Turn: ${turnPlayer ? turnPlayer.name : '-'}`);

    this.hud.pot.setText(`POT ${this.state.pot}`);
    if (this.state.pot !== this.prevPot) {
      this.tweens.add({ targets: [this.hud.pot, this.hud.potChips], scale: 1.12, yoyo: true, duration: 180 });
    }

    if (this.state.trumpSuit) {
      this.hud.trumpIcon.setText(SUIT_ICON[this.state.trumpSuit]);
      this.hud.trumpIcon.setColor(SUIT_COLOR[this.state.trumpSuit]);
    } else {
      this.hud.trumpIcon.setText('-');
      this.hud.trumpIcon.setColor('#e2e8f0');
    }

    if (this.prevTrump && this.state.trumpSuit && this.prevTrump !== this.state.trumpSuit) {
      this.tweens.add({ targets: this.hud.trumpIcon, scale: 1.25, yoyo: true, duration: 120, repeat: 2 });
      this.tweens.add({ targets: this.hud.trumpIcon, alpha: 0.4, yoyo: true, duration: 95, repeat: 2 });
    }

    if (this.state.error) {
      this.hud.status.setColor('#fca5a5');
      this.hud.status.setText(`Error: ${this.state.error}`);
    } else if (this.swapMode) {
      this.hud.status.setColor('#fcd34d');
      this.hud.status.setText('Swap mode: pick one hand card and one community card, then click Swap.');
    } else if (this.state.phase === 'trick') {
      this.hud.status.setColor('#93c5fd');
      this.hud.status.setText('Trick zone active: play a card and follow lead suit.');
    } else {
      this.hud.status.setColor('#93c5fd');
      this.hud.status.setText('Betting: Fold, Check, Call, Bet, Raise, or Swap.');
    }

    const logLines = (this.state.log || []).join('\n');
    this.logUi.content.setText(logLines);
  }

  renderSeats() {
    const turnId = this.state.turnPlayerId;

    for (let i = 0; i < 6; i += 1) {
      const p = this.state.players[i];
      const ui = this.seatUi.get(i);
      if (!p) {
        ui.root.setVisible(false);
        continue;
      }

      ui.root.setVisible(true);
      ui.avatarLetter.setText((p.name || '?').slice(0, 1).toUpperCase());
      ui.name.setText(`${p.name}${p.isBot ? ' [BOT]' : ''}`);
      ui.stack.setText(`${p.stack}`);
      ui.cards.setText(`${p.handCount} cards`);

      ui.dealer.setVisible(this.state.dealerId === p.id);
      ui.dealerT.setVisible(this.state.dealerId === p.id);

      if (p.folded) {
        ui.root.setAlpha(0.5);
        ui.panel.setFillStyle(0x18181b, 0.45);
        ui.name.setColor('#71717a');
        ui.stack.setColor('#71717a');
      } else {
        ui.root.setAlpha(1);
        ui.panel.setFillStyle(0x081220, 0.74);
        ui.name.setColor('#f8fafc');
        ui.stack.setColor('#fcd34d');
      }

      const active = p.id === turnId;
      ui.activeGlow.setVisible(active);
      ui.panel.setStrokeStyle(active ? 2 : 1, active ? 0x22c55e : 0x475569, active ? 0.95 : 0.45);
      if (active) {
        this.tweens.add({ targets: ui.activeGlow, alpha: 0.25, yoyo: true, duration: 420, repeat: -1 });
      } else {
        this.tweens.killTweensOf(ui.activeGlow);
        ui.activeGlow.alpha = 1;
      }
    }
  }

  clearCardList(list) {
    for (const c of list) c.root.destroy();
    list.length = 0;
  }

  createCard(x, y, cardCode, options = {}) {
    const w = options.w || CARD_W;
    const h = options.h || CARD_H;
    const root = this.add.container(x, y).setDepth(options.depth || DEPTH.COMMUNITY);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 4, w, h, 10);
    g.fillStyle(0xffffff, 1);
    g.lineStyle(1, 0xd1d5db, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);

    const key = cardCode === 'BACK' ? 'card-BACK' : `card-${cardCode}`;
    const img = this.add.image(0, 0, key);
    this.cropPadding(img, key);
    img.setDisplaySize(w - 10, h - 10);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    if (options.interactive) hit.setInteractive({ useHandCursor: true });

    root.add([g, img, hit]);

    if (options.onClick) hit.on('pointerdown', options.onClick);
    if (options.hover) {
      hit.on('pointerover', () => this.tweens.add({ targets: root, y: root.y - 12, scale: 1.04, duration: 100 }));
      hit.on('pointerout', () => this.tweens.add({ targets: root, y: options.baseY ?? y, scale: 1, duration: 100 }));
    }

    return { root, hit, cardCode };
  }

  cropPadding(image, key) {
    const tex = this.textures.get(key);
    if (!tex) return;
    const source = tex.getSourceImage();
    if (!source) return;
    const m = Math.floor(Math.min(source.width, source.height) * 0.06);
    image.setCrop(m, m, source.width - m * 2, source.height - m * 2);
  }

  renderCommunity() {
    this.clearCardList(this.communityCards);

    const cards = this.state.community || [];
    const gap = 108;
    const startX = this.layout.center.x - ((cards.length - 1) * gap) / 2;
    const y = this.layout.communityY;

    const prevCommunity = this.prevState ? this.prevState.community || [] : [];

    cards.forEach((card, idx) => {
      const x = startX + idx * gap;
      const selected = this.swapMode && this.swapSelection.communityIndex === idx;

      const sprite = this.createCard(x, y, card, {
        depth: DEPTH.COMMUNITY,
        interactive: true,
        onClick: () => {
          if (!this.swapMode) return;
          this.swapSelection.communityIndex = idx;
          this.renderCommunity();
        },
      });

      if (selected) {
        const glow = this.add.rectangle(0, 0, CARD_W + 8, CARD_H + 8, 0xf59e0b, 0.2).setStrokeStyle(3, 0xfbbf24, 1);
        sprite.root.addAt(glow, 0);
      }

      if (!prevCommunity[idx]) {
        sprite.root.setPosition(this.layout.deckPos.x, this.layout.deckPos.y);
        sprite.root.setAlpha(0);
        sprite.root.rotation = Phaser.Math.FloatBetween(-0.1, 0.1);
        this.tweens.add({
          targets: sprite.root,
          x,
          y,
          alpha: 1,
          rotation: Phaser.Math.FloatBetween(-0.02, 0.02),
          duration: 360,
          delay: idx * 65,
          ease: 'Cubic.easeOut',
        });
      }

      this.communityCards.push(sprite);
    });

    if (this.pendingSwapAnimation) {
      this.animateSwap(this.pendingSwapAnimation.handCard, this.pendingSwapAnimation.communityIndex);
      this.pendingSwapAnimation = null;
    }
  }

  renderHand() {
    this.clearCardList(this.handCards);

    const me = this.getMe();
    const raw = me ? me.hand : [];
    const sorted = sortHand(raw);
    const n = sorted.length;
    const cx = this.layout.center.x;
    const baseY = this.layout.handY;

    const prevMe = this.prevState ? this.prevState.players.find((p) => p.id === this.state.viewerId) : null;
    const prevRaw = prevMe ? prevMe.hand : [];

    sorted.forEach((card, idx) => {
      const t = n <= 1 ? 0 : idx / (n - 1);
      const angle = Phaser.Math.Linear(-5, 5, t);
      const offsetX = (idx - (n - 1) / 2) * 74 + this.suitGapOffset(sorted, idx);
      const arcY = Math.pow((idx - (n - 1) / 2) / Math.max(1, n / 2), 2) * 22;
      const x = cx + offsetX;
      const y = baseY + arcY;

      const selected = this.swapMode && this.swapSelection.handCard === card;

      const sprite = this.createCard(x, y, card, {
        depth: DEPTH.HAND,
        interactive: true,
        hover: true,
        baseY: selected ? y - 16 : y,
        onClick: () => {
          if (this.state.phase === 'trick') {
            this.sendAction({ type: 'playCard', card });
            return;
          }
          if (this.swapMode) {
            this.swapSelection.handCard = card;
            this.renderHand();
          }
        },
      });

      sprite.root.rotation = Phaser.Math.DegToRad(angle);
      if (selected) sprite.root.y -= 16;

      if (!prevRaw.includes(card)) {
        sprite.root.setPosition(this.layout.deckPos.x, this.layout.deckPos.y);
        sprite.root.alpha = 0;
        this.tweens.add({
          targets: sprite.root,
          x,
          y: selected ? y - 16 : y,
          alpha: 1,
          rotation: Phaser.Math.DegToRad(angle),
          duration: 340,
          delay: idx * 52,
          ease: 'Cubic.easeOut',
        });
      }

      this.handCards.push(sprite);
    });
  }

  suitGapOffset(sorted, idx) {
    let gap = 0;
    for (let i = 1; i <= idx; i += 1) {
      const prevSuit = sorted[i - 1].slice(-1);
      const suit = sorted[i].slice(-1);
      if (prevSuit !== suit) gap += 12;
    }
    return gap;
  }

  renderTrick() {
    const trick = this.state.trick || { plays: [] };
    const prevTrick = this.prevState ? this.prevState.trick || { plays: [] } : { plays: [] };

    for (const play of trick.plays) {
      if (this.trickCardsByPlayer.has(play.playerId)) continue;

      const seatIdx = this.state.players.findIndex((p) => p.id === play.playerId);
      const from = this.seatPositions[seatIdx] || this.layout.center;
      const idx = trick.plays.findIndex((p) => p.playerId === play.playerId);
      const angle = (Math.PI * 2 * idx) / Math.max(1, trick.plays.length);
      const target = {
        x: this.layout.center.x + Math.cos(angle) * 58,
        y: this.layout.trickY + Math.sin(angle) * 28,
      };

      const card = this.createCard(from.x, from.y, play.card, { depth: DEPTH.TRICK, w: 90, h: 126 });
      card.root.scale = 0.9;

      this.tweens.add({
        targets: card.root,
        x: target.x,
        y: target.y,
        scale: 1,
        duration: 290,
        ease: 'Cubic.easeOut',
      });

      this.trickCardsByPlayer.set(play.playerId, card);
    }

    if (prevTrick.plays.length > 0 && trick.plays.length === 0 && this.state.phase === 'trick') {
      const winnerId = this.detectTrickWinnerFromLog();
      this.collectTrick(winnerId);
    }

    if (this.state.phase !== 'trick' && this.trickCardsByPlayer.size > 0) {
      for (const c of this.trickCardsByPlayer.values()) c.root.destroy();
      this.trickCardsByPlayer.clear();
    }
  }

  detectTrickWinnerFromLog() {
    const log = this.state.log || [];
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const m = log[i].match(/^(.*) wins the trick\.$/);
      if (m) {
        const p = this.state.players.find((x) => x.name === m[1]);
        if (p) return p.id;
      }
    }
    return null;
  }

  collectTrick(winnerId) {
    if (!this.trickCardsByPlayer.size) return;

    const winnerSeat = this.seatPositions[this.state.players.findIndex((p) => p.id === winnerId)] || this.layout.center;

    if (winnerId && this.trickCardsByPlayer.has(winnerId)) {
      const win = this.trickCardsByPlayer.get(winnerId);
      const glow = this.add.ellipse(0, 0, 110, 150, 0xfacc15, 0.18).setStrokeStyle(3, 0xfbbf24, 1).setDepth(DEPTH.OVERLAY);
      win.root.addAt(glow, 0);
      this.tweens.add({ targets: win.root, scale: 1.15, yoyo: true, duration: 170 });
      this.showEvent(`${this.playerName(winnerId)} wins trick`);
    }

    for (const [pid, card] of this.trickCardsByPlayer.entries()) {
      this.tweens.add({
        targets: card.root,
        x: winnerSeat.x,
        y: winnerSeat.y,
        alpha: 0,
        rotation: Phaser.Math.FloatBetween(-0.2, 0.2),
        duration: 300,
        delay: pid === winnerId ? 140 : 70,
        ease: 'Cubic.easeIn',
        onComplete: () => card.root.destroy(),
      });
    }

    this.time.delayedCall(460, () => this.trickCardsByPlayer.clear());
  }

  showEvent(message) {
    this.hud.event.setText(message);
    this.hud.event.setAlpha(1);
    this.tweens.killTweensOf(this.hud.event);
    this.tweens.add({ targets: this.hud.event, alpha: 0, duration: 1500, ease: 'Sine.easeOut' });
  }

  animateSwap(handCardValue, communityIndex) {
    const handObj = this.handCards.find((c) => c.cardCode === handCardValue);
    const commObj = this.communityCards[communityIndex];
    if (!handObj || !commObj) return;

    const h = { x: handObj.root.x, y: handObj.root.y };
    const c = { x: commObj.root.x, y: commObj.root.y };

    const ghostH = this.createCard(h.x, h.y, 'BACK', { depth: DEPTH.OVERLAY });
    const ghostC = this.createCard(c.x, c.y, 'BACK', { depth: DEPTH.OVERLAY });
    ghostH.root.alpha = 0.85;
    ghostC.root.alpha = 0.85;

    this.tweens.add({ targets: ghostH.root, x: c.x, y: c.y, duration: 260, ease: 'Cubic.easeInOut', onComplete: () => ghostH.root.destroy() });
    this.tweens.add({ targets: ghostC.root, x: h.x, y: h.y, duration: 260, ease: 'Cubic.easeInOut', onComplete: () => ghostC.root.destroy() });

    this.tweens.add({ targets: [handObj.root, commObj.root], scale: 1.14, yoyo: true, duration: 130 });
  }

  detectSwap(nextState) {
    if (!this.state) return null;

    const prevMe = this.state.players.find((p) => p.id === this.state.viewerId);
    const nextMe = nextState.players.find((p) => p.id === nextState.viewerId);
    if (!prevMe || !nextMe) return null;

    if (prevMe.hand.length !== nextMe.hand.length) return null;
    if ((this.state.community || []).length !== (nextState.community || []).length) return null;

    const changedHandCards = nextMe.hand.filter((c) => !prevMe.hand.includes(c));
    const commDiff = [];
    for (let i = 0; i < nextState.community.length; i += 1) {
      if (nextState.community[i] !== this.state.community[i]) commDiff.push(i);
    }

    if (changedHandCards.length === 1 && commDiff.length === 1) {
      return { handCard: changedHandCards[0], communityIndex: commDiff[0] };
    }
    return null;
  }

  updateControls() {
    const me = this.getMe();
    if (!me) return;

    const isBetRound = ['preflopBet', 'flopBet', 'turnBet', 'riverBet'].includes(this.state.phase);
    const canAct = this.state.turnPlayerId === me.id && isBetRound;
    const need = this.state.currentBet - me.roundBet;

    this.setButtonState(this.controls.fold, canAct);
    this.setButtonState(this.controls.check, canAct && need <= 0);
    this.setButtonState(this.controls.call, canAct && need > 0);
    this.setButtonState(this.controls.bet, canAct && this.state.currentBet === 0);
    this.setButtonState(this.controls.raise, canAct && this.state.currentBet > 0);

    const canSwap = canAct && !me.hasSwapped && this.state.community.length > 0;
    this.setButtonState(this.controls.swap, canSwap);

    if (!canSwap) {
      this.swapMode = false;
      this.swapSelection.handCard = null;
      this.swapSelection.communityIndex = null;
    }

    const maxBet = Math.max(1, me.stack);
    if (this.betValue > maxBet) this.betValue = maxBet;

    const min = -200;
    const max = 160;
    const t = maxBet <= 1 ? 0 : (this.betValue - 1) / (maxBet - 1);
    this.controls.sliderHandle.x = Phaser.Math.Linear(min, max, t);
    this.controls.sliderFill.width = 360 * t;
    this.controls.sliderLabel.setText(`Bet: ${this.betValue}`);
  }

  setButtonState(btn, enabled) {
    btn.disabled = !enabled;
    btn.draw(false);
  }

  updateSwapBadge() {
    const me = this.getMe();
    if (!me) return;

    const canSwap =
      ['preflopBet', 'flopBet', 'turnBet', 'riverBet'].includes(this.state.phase) &&
      this.state.turnPlayerId === me.id &&
      !me.hasSwapped &&
      this.state.community.length > 0;

    if (!this.hud.swapBadge) {
      this.hud.swapBadge = this.add
        .text(this.layout.center.x - 108, this.layout.potY + 34, 'SWAP AVAILABLE', {
          fontFamily: 'Rajdhani, Segoe UI, sans-serif',
          fontSize: '20px',
          color: '#fef3c7',
          backgroundColor: '#92400e',
          fontStyle: '700',
          padding: { x: 12, y: 6 },
        })
        .setDepth(DEPTH.HUD)
        .setVisible(false);
    }

    this.hud.swapBadge.setVisible(canSwap);
    this.tweens.killTweensOf(this.hud.swapBadge);
    if (canSwap) {
      this.tweens.add({ targets: this.hud.swapBadge, alpha: 0.35, yoyo: true, duration: 520, repeat: -1 });
    } else {
      this.hud.swapBadge.alpha = 1;
    }
  }

  handleSwapButton() {
    if (!this.swapMode) {
      this.swapMode = true;
      this.swapSelection.handCard = null;
      this.swapSelection.communityIndex = null;
      this.renderHand();
      this.renderCommunity();
      return;
    }

    if (this.swapSelection.handCard == null || this.swapSelection.communityIndex == null) {
      this.hud.status.setColor('#fcd34d');
      this.hud.status.setText('Swap mode: select one hand card and one community card first.');
      return;
    }

    const me = this.getMe();
    const handIndex = me ? me.hand.indexOf(this.swapSelection.handCard) : -1;
    if (handIndex < 0) return;

    this.sendAction({
      type: 'swap',
      handIndex,
      communityIndex: this.swapSelection.communityIndex,
    });

    this.swapMode = false;
    this.swapSelection.handCard = null;
    this.swapSelection.communityIndex = null;
  }

  getBetAmount() {
    return Math.max(1, Math.floor(this.betValue));
  }

  sendAction(payload) {
    if (!this.socket) return;
    this.socket.emit('playerAction', payload);
  }

  getMe() {
    if (!this.state) return null;
    return this.state.players.find((p) => p.id === this.state.viewerId) || null;
  }

  playerName(id) {
    const p = this.state.players.find((x) => x.id === id);
    return p ? p.name : 'Player';
  }
}
