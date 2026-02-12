const SUITS = ['C', 'D', 'H', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const CARD_W = 96;
const CARD_H = 134;

const COLOR = {
  navy: 0x071224,
  emerald: 0x2ecc71,
  blue: 0x3b82f6,
  red: 0xe74c3c,
  gold: 0xd4af37,
  white: 0xf8fafc,
  ink: 0x030712,
};

const SUIT_ICON = { C: '♣', D: '♦', H: '♥', S: '♠' };
const SUIT_COLOR = { C: '#F8FAFC', D: '#E74C3C', H: '#E74C3C', S: '#F8FAFC' };
const PHASE_LABEL = {
  waiting: 'Waiting',
  preflopBet: 'Pre-Flop',
  flopBet: 'Flop',
  turnBet: 'Turn',
  riverBet: 'River',
  trick: 'Trick',
};

const DEPTH = {
  BG: 0,
  TABLE: 1,
  SEATS: 2,
  COMMUNITY: 3,
  TRICK: 4,
  HAND: 5,
  BUTTONS: 6,
  TOAST: 7,
  WINNER: 8,
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
      center: { x: 700, y: 470 },
      tableRx: 500,
      tableRy: 290,
      hudY: 58,
      lanes: {
        potY: 108,
        communityY: 292,
        trickY: 450,
        handY: 682,
      },
      deckPos: { x: 1030, y: 292 },
      actionsY: 854,
    };

    this.seatPositions = [];
    this.seatUi = new Map();

    this.hud = {};
    this.controls = {};
    this.toast = {};
    this.winnerFx = {};

    this.communityCards = [];
    this.handCards = [];
    this.trickCardsByPlayer = new Map();

    this.swapMode = false;
    this.swapSelection = { handCard: null, communityIndex: null };
    this.pendingSwapAnimation = null;

    this.prevPot = 0;
    this.prevTrump = null;
    this.potDisplayValue = 0;
    this.potTween = null;
    this.betValue = 20;

    this.handWinnerFxRunning = false;
    this.trickGlowTween = null;
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
    this.createTableLayers();
    this.createSeats();
    this.createActionSystem();
    this.createToastSystem();
    this.createWinnerFxLayer();
    this.setupSocket();

    const startBtn = document.getElementById('startHandBtn');
    startBtn.addEventListener('click', () => this.socket.emit('startHand'));
    this.updateStartHandButtonState();
  }

  createBackground() {
    const { w, h, center, tableRx, tableRy } = this.layout;

    this.add.rectangle(w / 2, h / 2, w, h, COLOR.navy, 1).setDepth(DEPTH.BG);

    const grad = this.add.graphics().setDepth(DEPTH.BG);
    grad.fillGradientStyle(COLOR.navy, COLOR.navy, COLOR.ink, COLOR.ink, 0.6);
    grad.fillRect(0, 0, w, h);

    this.add
      .ellipse(center.x, center.y + 2, tableRx * 2 + 34, tableRy * 2 + 34, 0x0d2b22, 0.95)
      .setDepth(DEPTH.TABLE);

    this.add
      .ellipse(center.x, center.y, tableRx * 2, tableRy * 2, 0x145c40, 0.95)
      .setDepth(DEPTH.TABLE);

    const felt = this.add.graphics().setDepth(DEPTH.TABLE);
    for (let i = 0; i < 280; i += 1) {
      felt.fillStyle(COLOR.white, Phaser.Math.FloatBetween(0.01, 0.035));
      felt.fillCircle(center.x + Phaser.Math.Between(-470, 470), center.y + Phaser.Math.Between(-260, 260), 1);
    }
  }

  createHud() {
    const { w, hudY, center } = this.layout;

    this.hud.strip = this.add.rectangle(w / 2, hudY, w - 40, 74, COLOR.ink, 0.32).setDepth(DEPTH.BUTTONS);

    this.hud.phase = this.add
      .text(34, 28, 'Phase', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '18px',
        color: '#F8FAFC',
        fontStyle: '600',
      })
      .setDepth(DEPTH.BUTTONS);

    this.hud.turn = this.add
      .text(34, 47, 'Turn', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '26px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setDepth(DEPTH.BUTTONS);

    this.hud.potLabel = this.add
      .text(center.x, 22, 'POT', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '16px',
        color: '#F8FAFC',
        fontStyle: '600',
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.BUTTONS);

    this.hud.pot = this.add
      .text(center.x, 52, '0', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '52px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.BUTTONS);

    this.hud.trumpIcon = this.add
      .text(w - 96, 50, '-', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '62px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.BUTTONS);
  }

  createTableLayers() {
    const c = this.layout.center;
    const { lanes } = this.layout;

    this.add
      .text(c.x, lanes.communityY - CARD_H / 2 - 24, 'COMMUNITY', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '17px',
        color: '#F8FAFC',
        fontStyle: '600',
      })
      .setOrigin(0.5)
      .setAlpha(0.75)
      .setDepth(DEPTH.TABLE);

    this.trickZoneGlow = this.add
      .ellipse(c.x, lanes.trickY, 470, 174, COLOR.blue, 0.08)
      .setDepth(DEPTH.TRICK)
      .setVisible(false);

    this.add
      .text(c.x, lanes.trickY - CARD_H / 2 - 24, 'TRICK', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '17px',
        color: '#F8FAFC',
        fontStyle: '600',
      })
      .setOrigin(0.5)
      .setAlpha(0.75)
      .setDepth(DEPTH.TABLE);
  }

  createSeats() {
    const { center, tableRx, tableRy } = this.layout;

    for (let i = 0; i < 6; i += 1) {
      const a = Phaser.Math.DegToRad(90 - i * 60);
      const x = center.x + Math.cos(a) * (tableRx + 78);
      const y = center.y + Math.sin(a) * (tableRy + 56);
      this.seatPositions.push({ x, y });

      const root = this.add.container(x, y).setDepth(DEPTH.SEATS);
      const activeGlow = this.add.ellipse(0, 0, 184, 68, COLOR.emerald, 0.12).setVisible(false);
      const panel = this.add.rectangle(0, 0, 170, 56, COLOR.ink, 0.52);

      const name = this.add.text(-50, -18, 'Seat', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '16px',
        color: '#F8FAFC',
        fontStyle: '700',
      });

      const stack = this.add.text(-50, -2, '$0', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '16px',
        color: '#F8FAFC',
        fontStyle: '700',
      });

      const cards = this.add.text(38, 0, '0 cards', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#F8FAFC',
        fontStyle: '600',
      });

      const dealer = this.add.circle(71, -16, 8, COLOR.white, 1).setVisible(false);
      const dealerT = this.add
        .text(71, -16, 'D', {
          fontFamily: 'Rajdhani, Segoe UI, sans-serif',
          fontSize: '10px',
          color: '#071224',
          fontStyle: '700',
        })
        .setOrigin(0.5)
        .setVisible(false);

      root.add([activeGlow, panel, name, stack, cards, dealer, dealerT]);

      this.seatUi.set(i, {
        root,
        panel,
        activeGlow,
        activeTween: null,
        name,
        stack,
        cards,
        dealer,
        dealerT,
      });
    }
  }

  createActionSystem() {
    const y = this.layout.actionsY;

    this.controls.fold = this.createPillButton(112, y, 96, 40, 'Fold', COLOR.red, () => this.sendAction({ type: 'fold' }));
    this.controls.primary = this.createPillButton(700, y, 210, 54, 'Check', COLOR.blue, () => this.handlePrimaryActionClick());
    this.controls.swap = this.createPillButton(1288, y, 104, 40, 'Swap', COLOR.gold, () => this.handleSwapButton());

    this.controls.sliderTrack = this.add.rectangle(580, y - 52, 240, 8, COLOR.ink, 0.8).setOrigin(0, 0.5).setDepth(DEPTH.BUTTONS);
    this.controls.sliderFill = this.add.rectangle(580, y - 52, 0, 8, COLOR.emerald, 1).setOrigin(0, 0.5).setDepth(DEPTH.BUTTONS);
    this.controls.sliderHandle = this.add
      .circle(580, y - 52, 9, COLOR.white, 1)
      .setDepth(DEPTH.BUTTONS)
      .setInteractive({ draggable: true, useHandCursor: true });

    this.controls.sliderLabel = this.add
      .text(700, y - 73, 'Bet: 20', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '18px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.BUTTONS);

    this.controls.sliderHandle.on('drag', (pointer, dragX) => {
      const min = 580;
      const max = 820;
      this.controls.sliderHandle.x = Phaser.Math.Clamp(dragX, min, max);
      const t = (this.controls.sliderHandle.x - min) / (max - min);
      const me = this.getMe();
      const maxBet = me ? Math.max(1, me.stack) : 1000;
      this.betValue = Math.max(1, Math.floor(1 + t * (maxBet - 1)));
      this.controls.sliderFill.width = 240 * t;
      this.controls.sliderLabel.setText(`Bet: ${this.betValue}`);
      if (!this.controls.wagerMode) this.controls.wagerMode = true;
      this.updateControls();
    });

    this.controls.wagerMode = false;
    this.controls.primaryLongPressTriggered = false;
    this.controls.primaryHoldTimer = null;

    this.controls.primary.hit.on('pointerdown', () => {
      const me = this.getMe();
      if (!me || this.controls.primary.disabled || this.controls.wagerMode) return;
      const need = this.state ? this.state.currentBet - me.roundBet : 0;
      if (!this.canEnterWagerMode(me, need)) return;
      this.controls.primaryHoldTimer = this.time.delayedCall(300, () => {
        this.controls.primaryLongPressTriggered = true;
        this.controls.wagerMode = true;
        this.updateControls();
      });
    });

    this.controls.primary.hit.on('pointerup', () => {
      if (this.controls.primaryHoldTimer) {
        this.controls.primaryHoldTimer.remove(false);
        this.controls.primaryHoldTimer = null;
      }
    });

    this.controls.primary.hit.on('pointerout', () => {
      if (this.controls.primaryHoldTimer) {
        this.controls.primaryHoldTimer.remove(false);
        this.controls.primaryHoldTimer = null;
      }
    });

    this.controls.sliderTrack.setVisible(false);
    this.controls.sliderFill.setVisible(false);
    this.controls.sliderHandle.setVisible(false);
    this.controls.sliderLabel.setVisible(false);
  }

  createPillButton(x, y, w, h, label, color, onClick) {
    const g = this.add.graphics().setDepth(DEPTH.BUTTONS);
    const hit = this.add.zone(x, y, w, h).setOrigin(0.5).setDepth(DEPTH.BUTTONS).setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: `${Math.round(h * 0.42)}px`,
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.BUTTONS);

    const btn = {
      g,
      hit,
      text,
      x,
      y,
      w,
      h,
      baseColor: color,
      disabled: false,
      draw: (state = 'idle') => {
        const off = btn.disabled;
        let fill = btn.baseColor;
        let alpha = 0.95;
        if (off) {
          fill = 0x324055;
          alpha = 0.42;
        }
        if (!off && state === 'hover') alpha = 1;
        if (!off && state === 'pressed') alpha = 0.8;

        g.clear();
        g.fillStyle(fill, alpha);
        g.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
        text.setAlpha(off ? 0.5 : 1);
      },
    };

    btn.draw('idle');
    hit.on('pointerover', () => btn.draw('hover'));
    hit.on('pointerout', () => btn.draw('idle'));
    hit.on('pointerdown', () => {
      if (btn.disabled) return;
      btn.draw('pressed');
    });
    hit.on('pointerup', () => {
      if (btn.disabled) return;
      btn.draw('hover');
      this.tweens.add({ targets: text, scale: 0.96, yoyo: true, duration: 90 });
      onClick();
    });

    return btn;
  }

  createToastSystem() {
    const { center, lanes } = this.layout;
    const container = this.add.container(center.x, lanes.potY + 42).setDepth(DEPTH.TOAST).setAlpha(0).setVisible(false);
    const bg = this.add.rectangle(0, 0, 420, 44, COLOR.ink, 0.82);
    const txt = this.add
      .text(0, 0, '', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '24px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5);
    container.add([bg, txt]);

    this.toast = { container, bg, txt, tween: null };
  }

  showToast(message, duration = 1200) {
    if (!message) return;
    const { container, txt } = this.toast;
    if (this.toast.tween) this.toast.tween.remove(false);

    txt.setText(message);
    container.setVisible(true);
    container.alpha = 0;

    this.tweens.add({ targets: container, alpha: 1, duration: 140, ease: 'Sine.easeOut' });
    this.toast.tween = this.tweens.add({
      targets: container,
      alpha: 0,
      duration: 220,
      delay: duration,
      ease: 'Sine.easeIn',
      onComplete: () => {
        container.setVisible(false);
        this.toast.tween = null;
      },
    });
  }

  createWinnerFxLayer() {
    const { w, h, center } = this.layout;

    const darken = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0).setDepth(DEPTH.WINNER).setVisible(false);
    const banner = this.add.container(center.x, center.y - 20).setDepth(DEPTH.WINNER).setVisible(false);
    const bannerBg = this.add.rectangle(0, 0, 760, 114, COLOR.ink, 0.94);
    const bannerText = this.add
      .text(0, 0, 'WINNER: -', {
        fontFamily: 'Rajdhani, Segoe UI, sans-serif',
        fontSize: '56px',
        color: '#F8FAFC',
        fontStyle: '700',
      })
      .setOrigin(0.5);
    banner.add([bannerBg, bannerText]);

    this.winnerFx = { darken, banner, bannerText, seatGlow: null };
  }

  setupSocket() {
    this.socket = io();
    this.socket.on('state', (nextState) => this.onState(nextState));
  }

  onState(nextState) {
    const prev = this.state;

    this.pendingSwapAnimation = this.detectSwap(nextState);
    this.prevState = this.state;
    this.state = nextState;

    this.renderHud();
    this.renderSeats();
    this.renderCommunity();
    this.renderHand();
    this.renderTrick();
    this.updateControls();
    this.updateSeatActionFeedback(prev, this.state);
    this.updateStartHandButtonState();

    if (this.isHandFinished(this.state, prev)) {
      const winner = this.detectHandWinner();
      if (winner) this.playWinnerSequence(winner);
    }

    this.prevPot = this.state.pot;
    this.prevTrump = this.state.trumpSuit;
  }

  renderHud() {
    const phaseLabel = PHASE_LABEL[this.state.phase] || this.state.phase;
    const turnPlayer = this.state.players.find((p) => p.id === this.state.turnPlayerId);

    this.hud.phase.setText(`Phase: ${phaseLabel}`);
    this.hud.turn.setText(`Turn: ${turnPlayer ? turnPlayer.name : '-'}`);

    this.animatePotTo(this.state.pot ?? 0);

    if (this.state.trumpSuit) {
      this.hud.trumpIcon.setText(SUIT_ICON[this.state.trumpSuit]);
      this.hud.trumpIcon.setColor(SUIT_COLOR[this.state.trumpSuit]);
    } else {
      this.hud.trumpIcon.setText('-');
      this.hud.trumpIcon.setColor('#F8FAFC');
    }

    if (this.prevTrump && this.state.trumpSuit && this.prevTrump !== this.state.trumpSuit) {
      this.tweens.add({ targets: this.hud.trumpIcon, scale: 1.22, yoyo: true, duration: 140 });
    }
  }

  animatePotTo(target) {
    if (this.potTween) this.potTween.remove(false);
    const from = Number.isFinite(this.potDisplayValue) ? this.potDisplayValue : 0;
    this.potTween = this.tweens.addCounter({
      from,
      to: target,
      duration: 320,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        this.potDisplayValue = Math.round(tw.getValue());
        this.hud.pot.setText(`${this.potDisplayValue}`);
      },
      onComplete: () => {
        this.potDisplayValue = target;
        this.hud.pot.setText(`${target}`);
        this.potTween = null;
      },
    });
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
      ui.name.setText(`${p.name}${p.isBot ? ' BOT' : ''}`);
      ui.stack.setText(`$${p.stack}`);
      ui.cards.setText(`${p.handCount} cards`);
      ui.dealer.setVisible(this.state.dealerId === p.id);
      ui.dealerT.setVisible(this.state.dealerId === p.id);

      if (p.folded) {
        ui.root.setAlpha(0.42);
      } else {
        ui.root.setAlpha(1);
      }

      const active = p.id === turnId;
      ui.activeGlow.setVisible(active);
      if (active && !ui.activeTween) {
        ui.activeTween = this.tweens.add({ targets: ui.activeGlow, alpha: 0.22, yoyo: true, duration: 420, repeat: -1 });
      }
      if (!active && ui.activeTween) {
        ui.activeTween.remove(false);
        ui.activeTween = null;
      }
    }
  }

  updateSeatActionFeedback(prev, next) {
    if (!prev || !next) return;

    for (const p of next.players) {
      const old = prev.players.find((x) => x.id === p.id);
      if (!old) continue;
      const delta = old.stack - p.stack;
      if (delta > 0) {
        const idx = next.players.findIndex((x) => x.id === p.id);
        const seat = this.seatPositions[idx];
        if (!seat) continue;

        const t = this.add
          .text(seat.x, seat.y - 34, `-${delta}`, {
            fontFamily: 'Rajdhani, Segoe UI, sans-serif',
            fontSize: '22px',
            color: '#3B82F6',
            fontStyle: '700',
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.TOAST);

        this.tweens.add({
          targets: t,
          y: t.y - 28,
          alpha: 0,
          duration: 650,
          ease: 'Sine.easeOut',
          onComplete: () => t.destroy(),
        });
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
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(-w / 2 + 4, -h / 2 + 6, w, h, 12);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);

    const key = cardCode === 'BACK' ? 'card-BACK' : `card-${cardCode}`;
    const img = this.add.image(0, 0, key);
    this.cropPadding(img, key);
    img.setDisplaySize(w - 12, h - 12);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    if (options.interactive) hit.setInteractive({ useHandCursor: true });

    root.add([g, img, hit]);

    if (options.onClick) hit.on('pointerdown', options.onClick);
    if (options.hover) {
      hit.on('pointerover', () => {
        this.tweens.killTweensOf(root);
        this.tweens.add({ targets: root, y: (options.baseY ?? y) - 20, scale: 1.05, duration: 120, ease: 'Sine.easeOut' });
      });
      hit.on('pointerout', () => {
        this.tweens.killTweensOf(root);
        this.tweens.add({ targets: root, y: options.baseY ?? y, scale: 1, duration: 120, ease: 'Sine.easeOut' });
      });
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
    const gap = 106;
    const startX = this.layout.center.x - ((cards.length - 1) * gap) / 2;
    const y = this.layout.lanes.communityY;

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
        const glow = this.add.rectangle(0, 0, CARD_W + 10, CARD_H + 10, COLOR.gold, 0.22);
        sprite.root.addAt(glow, 0);
      }

      if (this.state.phase === 'trick') sprite.root.setAlpha(0.62);

      if (!prevCommunity[idx]) {
        sprite.root.setPosition(this.layout.deckPos.x, this.layout.deckPos.y);
        sprite.root.setAlpha(0);
        this.tweens.add({ targets: sprite.root, x, y, alpha: 1, duration: 340, delay: idx * 65, ease: 'Cubic.easeOut' });
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
    const baseY = this.layout.lanes.handY;

    const prevMe = this.prevState ? this.prevState.players.find((p) => p.id === this.state.viewerId) : null;
    const prevRaw = prevMe ? prevMe.hand : [];

    sorted.forEach((card, idx) => {
      const t = n <= 1 ? 0 : idx / (n - 1);
      const angle = Phaser.Math.Linear(-7, 7, t);
      const offsetX = (idx - (n - 1) / 2) * 68 + this.suitGapOffset(sorted, idx);
      const arcY = Math.pow((idx - (n - 1) / 2) / Math.max(1, n / 2), 2) * 32;
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
          delay: idx * 54,
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
      if (prevSuit !== suit) gap += 16;
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
        x: this.layout.center.x + Math.cos(angle) * 78,
        y: this.layout.lanes.trickY + Math.sin(angle) * 34,
      };

      const card = this.createCard(from.x, from.y, play.card, { depth: DEPTH.TRICK, w: 100, h: 140 });
      card.root.scale = 0.94;

      this.tweens.add({ targets: card.root, x: target.x, y: target.y, scale: 1.08, duration: 320, ease: 'Cubic.easeOut' });
      this.trickCardsByPlayer.set(play.playerId, card);
    }

    if (this.state.phase === 'trick') {
      this.trickZoneGlow.setVisible(true);
      if (!this.trickGlowTween) {
        this.trickGlowTween = this.tweens.add({ targets: this.trickZoneGlow, alpha: 0.22, yoyo: true, duration: 420, repeat: -1 });
      }
    } else {
      this.trickZoneGlow.setVisible(false);
      if (this.trickGlowTween) {
        this.trickGlowTween.remove(false);
        this.trickGlowTween = null;
      }
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

    const seatIdx = this.state.players.findIndex((p) => p.id === winnerId);
    const winnerSeat = this.seatPositions[seatIdx] || this.layout.center;

    if (winnerId && this.trickCardsByPlayer.has(winnerId)) {
      const win = this.trickCardsByPlayer.get(winnerId);
      const glow = this.add.ellipse(0, 0, 122, 162, COLOR.emerald, 0.2).setDepth(DEPTH.TOAST);
      win.root.addAt(glow, 0);
      this.tweens.add({ targets: win.root, scale: 1.2, yoyo: true, duration: 180 });
      this.showToast(`${this.playerName(winnerId)} wins trick`, 1000);
    }

    for (const card of this.trickCardsByPlayer.values()) {
      this.tweens.add({
        targets: card.root,
        x: winnerSeat.x,
        y: winnerSeat.y,
        alpha: 0,
        duration: 320,
        ease: 'Cubic.easeIn',
        onComplete: () => card.root.destroy(),
      });
    }

    this.time.delayedCall(480, () => this.trickCardsByPlayer.clear());
  }

  playWinnerSequence(winner) {
    if (!winner || this.handWinnerFxRunning) return;
    this.handWinnerFxRunning = true;
    this.updateStartHandButtonState();

    const { darken, banner, bannerText } = this.winnerFx;
    darken.setVisible(true);
    banner.setVisible(true);
    darken.alpha = 0;
    banner.alpha = 0;
    bannerText.setText(`WINNER: ${winner.name}`);

    this.tweens.add({ targets: darken, alpha: 0.36, duration: 220, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: banner, alpha: 1, duration: 220, ease: 'Sine.easeOut' });

    const seatIndex = this.state.players.findIndex((p) => p.id === winner.id);
    const winnerSeatUi = this.seatUi.get(seatIndex);
    if (winnerSeatUi) {
      this.winnerFx.seatGlow = this.add
        .ellipse(winnerSeatUi.root.x, winnerSeatUi.root.y, 214, 82, COLOR.gold, 0.22)
        .setDepth(DEPTH.WINNER);
      this.tweens.add({ targets: this.winnerFx.seatGlow, alpha: 0.34, yoyo: true, duration: 240, repeat: 4 });
    }

    const start = this.hud.pot;
    const target = winnerSeatUi ? { x: winnerSeatUi.root.x, y: winnerSeatUi.root.y } : this.layout.center;
    for (let i = 0; i < 9; i += 1) {
      const chip = this.add
        .circle(start.x + Phaser.Math.Between(-20, 20), start.y + Phaser.Math.Between(-10, 10), 7, COLOR.gold, 1)
        .setDepth(DEPTH.WINNER);
      this.tweens.add({
        targets: chip,
        x: target.x + Phaser.Math.Between(-24, 24),
        y: target.y + Phaser.Math.Between(-12, 12),
        duration: 620,
        delay: i * 42,
        ease: 'Cubic.easeIn',
        onComplete: () => chip.destroy(),
      });
    }

    this.time.delayedCall(1500, () => {
      this.tweens.add({
        targets: [banner, darken, this.winnerFx.seatGlow].filter(Boolean),
        alpha: 0,
        duration: 340,
        ease: 'Sine.easeOut',
        onComplete: () => {
          banner.setVisible(false);
          darken.setVisible(false);
          if (this.winnerFx.seatGlow) {
            this.winnerFx.seatGlow.destroy();
            this.winnerFx.seatGlow = null;
          }
          this.handWinnerFxRunning = false;
          this.updateStartHandButtonState();
        },
      });
    });
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

  animateSwap(handCardValue, communityIndex) {
    const handObj = this.handCards.find((c) => c.cardCode === handCardValue);
    const commObj = this.communityCards[communityIndex];
    if (!handObj || !commObj) return;

    const h = { x: handObj.root.x, y: handObj.root.y };
    const c = { x: commObj.root.x, y: commObj.root.y };

    const ghostH = this.createCard(h.x, h.y, 'BACK', { depth: DEPTH.TOAST });
    const ghostC = this.createCard(c.x, c.y, 'BACK', { depth: DEPTH.TOAST });
    ghostH.root.alpha = 0.84;
    ghostC.root.alpha = 0.84;

    this.tweens.add({ targets: ghostH.root, x: c.x, y: c.y, duration: 270, ease: 'Cubic.easeInOut', onComplete: () => ghostH.root.destroy() });
    this.tweens.add({ targets: ghostC.root, x: h.x, y: h.y, duration: 270, ease: 'Cubic.easeInOut', onComplete: () => ghostC.root.destroy() });
  }

  updateControls() {
    const me = this.getMe();
    if (!me) return;

    const isBetRound = ['preflopBet', 'flopBet', 'turnBet', 'riverBet'].includes(this.state.phase);
    const canAct = this.state.turnPlayerId === me.id && isBetRound;
    const need = this.state.currentBet - me.roundBet;

    this.setButtonState(this.controls.fold, canAct);

    const canSwap = canAct && !me.hasSwapped && this.state.community.length > 0;
    this.controls.swap.g.setVisible(canSwap);
    this.controls.swap.hit.setVisible(canSwap);
    this.controls.swap.text.setVisible(canSwap);
    this.setButtonState(this.controls.swap, canSwap);

    if (!canSwap) {
      this.swapMode = false;
      this.swapSelection.handCard = null;
      this.swapSelection.communityIndex = null;
    }

    if (!canAct) this.controls.wagerMode = false;

    const maxBet = Math.max(1, me.stack);
    if (this.betValue > maxBet) this.betValue = maxBet;

    const min = 580;
    const max = 820;
    const t = maxBet <= 1 ? 0 : (this.betValue - 1) / (maxBet - 1);
    this.controls.sliderHandle.x = Phaser.Math.Linear(min, max, t);
    this.controls.sliderFill.width = 240 * t;
    this.controls.sliderLabel.setText(`Bet: ${this.betValue}`);

    const canWager = canAct && this.canEnterWagerMode(me, need);
    if (this.controls.wagerMode && !canWager) this.controls.wagerMode = false;

    const sliderVisible = this.controls.wagerMode && canWager;
    this.controls.sliderTrack.setVisible(sliderVisible);
    this.controls.sliderFill.setVisible(sliderVisible);
    this.controls.sliderHandle.setVisible(sliderVisible);
    this.controls.sliderLabel.setVisible(sliderVisible);

    const primaryMode = sliderVisible ? (this.state.currentBet > 0 ? 'raise' : 'bet') : need > 0 ? 'call' : 'check';
    const primarySpec = this.getPrimarySpec(primaryMode);
    this.controls.primary.text.setText(primarySpec.label);
    this.controls.primary.baseColor = primarySpec.color;
    this.setButtonState(this.controls.primary, canAct);
  }

  setButtonState(btn, enabled) {
    btn.disabled = !enabled;
    btn.draw('idle');
  }

  canEnterWagerMode(me, need) {
    if (!me) return false;
    if (this.state.currentBet === 0) return me.stack > 0;
    return me.stack > need;
  }

  getPrimarySpec(mode) {
    switch (mode) {
      case 'call':
        return { label: 'Call', color: COLOR.blue };
      case 'bet':
        return { label: 'Bet', color: COLOR.emerald };
      case 'raise':
        return { label: 'Raise', color: COLOR.emerald };
      case 'check':
      default:
        return { label: 'Check', color: COLOR.blue };
    }
  }

  handlePrimaryActionClick() {
    if (!this.state || this.controls.primary.disabled) return;

    if (this.controls.primaryLongPressTriggered) {
      this.controls.primaryLongPressTriggered = false;
      return;
    }

    if (this.controls.wagerMode) {
      const type = this.state.currentBet > 0 ? 'raise' : 'bet';
      this.sendAction({ type, amount: this.getBetAmount() });
      this.controls.wagerMode = false;
      return;
    }

    const me = this.getMe();
    if (!me) return;
    const need = this.state.currentBet - me.roundBet;
    this.sendAction({ type: need > 0 ? 'call' : 'check' });
  }

  handleSwapButton() {
    if (!this.swapMode) {
      this.swapMode = true;
      this.swapSelection.handCard = null;
      this.swapSelection.communityIndex = null;
      this.renderHand();
      this.renderCommunity();
      this.showToast('Select hand + community card', 900);
      return;
    }

    if (this.swapSelection.handCard == null || this.swapSelection.communityIndex == null) {
      this.showToast('Select one hand and one community card', 900);
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

  isHandFinished(nextState, prevState) {
    if (!prevState || !nextState) return false;
    return prevState.phase !== 'waiting' && nextState.phase === 'waiting';
  }

  detectHandWinner() {
    const logs = this.state?.log || [];
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const foldWin = logs[i].match(/^(.+) wins \d+ chips by fold\.$/);
      if (foldWin) return this.findPlayerByName(foldWin[1]);

      const trickWin = logs[i].match(/^Hand over\. Winners?: (.+) \(\d+ tricks\)\.$/);
      if (trickWin) {
        const firstName = trickWin[1].split(',')[0].trim();
        return this.findPlayerByName(firstName);
      }
    }
    return null;
  }

  findPlayerByName(name) {
    if (!name || !this.state) return null;
    return this.state.players.find((p) => p.name === name) || null;
  }

  updateStartHandButtonState() {
    const btn = document.getElementById('startHandBtn');
    if (!btn) return;

    const canStart = Boolean(this.state && this.state.phase === 'waiting' && !this.handWinnerFxRunning);
    btn.disabled = !canStart;
    btn.style.opacity = canStart ? '1' : '0.55';
    btn.style.cursor = canStart ? 'pointer' : 'not-allowed';
  }
}
