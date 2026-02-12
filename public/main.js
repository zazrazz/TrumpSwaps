import { TrumpSwapScene } from './game.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: 1400,
  height: 900,
  backgroundColor: '#040810',
  scene: [TrumpSwapScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
};

window.addEventListener('load', () => {
  // eslint-disable-next-line no-new
  new Phaser.Game(config);
});
