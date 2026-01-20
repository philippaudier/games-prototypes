import Phaser from 'phaser';
import { PHYSICS } from '@shared';

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    // Load assets here
  }

  create() {
    // Create game objects
    this.add.text(400, 280, '{{NAME}}', {
      fontSize: '32px',
      fill: '#fff'
    }).setOrigin(0.5);

    this.add.text(400, 340, 'ZQSD/Flèches pour bouger', {
      fontSize: '18px',
      fill: '#888'
    }).setOrigin(0.5);

    // Example: Create a player
    this.player = this.add.rectangle(400, 450, 40, 40, 0x00ff88);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);

    // Input ZQSD (AZERTY) + flèches
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = {
      z: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      q: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
    };
  }

  update() {
    const speed = PHYSICS.playerSpeed * 30;
    const body = this.player.body;

    // Movement
    body.setVelocity(0);

    const left = this.cursors.left.isDown || this.keys.q.isDown;
    const right = this.cursors.right.isDown || this.keys.d.isDown;
    const up = this.cursors.up.isDown || this.keys.z.isDown;
    const down = this.cursors.down.isDown || this.keys.s.isDown;

    if (left) body.setVelocityX(-speed);
    else if (right) body.setVelocityX(speed);

    if (up) body.setVelocityY(-speed);
    else if (down) body.setVelocityY(speed);
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game',
  backgroundColor: '#16213e',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: true // Set to false for production
    }
  },
  scene: GameScene
};

new Phaser.Game(config);
