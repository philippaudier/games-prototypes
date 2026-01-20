import Phaser from 'phaser';

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.currentLevel = data.level || 1;
    this.score = data.score || 0;
    this.levelTime = 0; // Chrono du niveau en ms
    this.totalTime = data.totalTime || 0; // Timer total du run

    // Charger les meilleurs temps depuis localStorage
    this.bestTimes = JSON.parse(localStorage.getItem('platformer-best-times') || '{}');
    this.bestTotalTime = JSON.parse(localStorage.getItem('platformer-best-total') || '{}');
  }

  create() {
    // Config gameplay
    this.config = {
      playerSpeed: 320,
      playerAccel: 2800,     // Accélération plus forte
      playerDecel: 4500,     // Décélération BEAUCOUP plus forte (moins de savonnage)
      jumpForce: 560,
      doubleJumpForce: 480,  // Double saut un peu moins fort
      gravity: 1800,
      coyoteTime: 80,
      jumpBufferTime: 100,
      wallJumpForceX: 350,
      wallJumpForceY: 500,
      wallSlideSpeed: 100
    };

    // Variables joueur
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.maxHealth = 3;
    this.playerHealth = this.maxHealth; // Full vie au début de chaque niveau
    this.isInvincible = true; // Invincible au spawn
    this.hasKey = false;
    this.wallSlideTimer = 0;
    this.lastWallDir = 0;
    this.canDoubleJump = false;
    this.hasDoubleJumped = false;
    this.fallingDeath = false;

    // Invincibilité de spawn (1 seconde)
    this.time.delayedCall(1000, () => {
      this.isInvincible = false;
    });

    // Seed basé sur le niveau pour reproductibilité
    this.rng = new Phaser.Math.RandomDataGenerator([`level-${this.currentLevel}`]);

    // Background parallax
    this.createParallaxBackground();

    // Génération du niveau
    this.generateLevel();

    // UI
    this.levelText = this.add.text(400, 16, `Niveau ${this.currentLevel}`, { fontSize: '20px', fill: '#fff' }).setOrigin(0.5, 0).setScrollFactor(0);
    this.scoreText = this.add.text(16, 16, 'Score: ' + this.score, { fontSize: '16px', fill: '#fff' }).setScrollFactor(0);
    this.healthText = this.add.text(16, 38, '❤️'.repeat(this.playerHealth) + '🖤'.repeat(Math.max(0, this.maxHealth - this.playerHealth)), { fontSize: '16px' }).setScrollFactor(0);
    this.keyText = this.add.text(16, 60, '🔑: ❌', { fontSize: '16px' }).setScrollFactor(0);

    // Chronomètre niveau
    this.timerText = this.add.text(784, 16, '⏱️ 0.00s', { fontSize: '16px', fill: '#fff' }).setOrigin(1, 0).setScrollFactor(0);
    const bestTime = this.bestTimes[this.currentLevel];
    this.bestTimeText = this.add.text(784, 38, bestTime ? `🏆 ${this.formatTime(bestTime)}` : '🏆 --', { fontSize: '14px', fill: '#ffd700' }).setOrigin(1, 0).setScrollFactor(0);

    // Delta vs PB
    this.deltaText = this.add.text(784, 56, '', { fontSize: '12px', fill: '#888' }).setOrigin(1, 0).setScrollFactor(0);

    // Timer total du run
    this.totalTimeText = this.add.text(400, 40, `Total: ${this.formatTime(this.totalTime)}`, { fontSize: '14px', fill: '#aaa' }).setOrigin(0.5, 0).setScrollFactor(0);

    this.add.text(400, 580, 'ZQSD + ESPACE | R = Reset run', { fontSize: '11px', fill: '#555' }).setOrigin(0.5).setScrollFactor(0);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = {
      z: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      q: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      r: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R) // Reset rapide
    };

  }

  createParallaxBackground() {
    // Couleurs de fond selon le niveau
    const bgColors = [
      0x16213e, 0x1a1a2e, 0x0f3460, 0x1b262c, 0x2c003e,
      0x1a0033, 0x0d1b2a, 0x1b2838, 0x1c1c3c, 0x0a1628
    ];
    const bgColor = bgColors[(this.currentLevel - 1) % bgColors.length];
    this.cameras.main.setBackgroundColor(bgColor);

    // Étoiles avec parallax
    this.stars = [];
    for (let i = 0; i < 50; i++) {
      const star = this.add.circle(
        this.rng.between(0, 800),
        this.rng.between(0, 600),
        this.rng.between(1, 3),
        0xffffff,
        this.rng.realInRange(0.3, 0.8)
      );
      star.baseX = star.x;
      star.baseY = star.y;
      star.depth = this.rng.realInRange(0.3, 1); // Profondeur pour parallax varié
      this.stars.push(star);
    }
  }

  generateLevel() {
    const width = 800;
    const height = 600;
    const isBossLevel = this.currentLevel % 5 === 0;

    // Groupes
    this.platforms = this.physics.add.staticGroup();
    this.walls = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.shooters = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.coins = this.physics.add.group();
    this.deathZones = this.physics.add.staticGroup();

    // Sol avec trous (à partir niveau 3)
    const numHoles = this.currentLevel >= 3 ? Math.min(Math.floor((this.currentLevel - 2) / 2), 4) : 0;
    this.groundHoles = []; // Stocker les positions des trous
    this.generateGroundWithHoles(numHoles);

    // Murs gauche et droite (pour wall jump)
    this.walls.add(this.add.rectangle(8, 300, 16, 600, 0x3a3a5a));
    this.walls.add(this.add.rectangle(792, 300, 16, 600, 0x3a3a5a));

    // Générer plateformes procéduralement
    const numPlatforms = 5 + Math.floor(this.currentLevel * 0.5);
    const platformData = [];

    for (let i = 0; i < numPlatforms; i++) {
      let x, y, w;
      let valid = false;
      let attempts = 0;

      while (!valid && attempts < 50) {
        w = this.rng.between(80, 160);
        x = this.rng.between(60 + w/2, width - 60 - w/2);
        y = this.rng.between(120, 520);

        // Vérifier qu'on ne chevauche pas d'autres plateformes
        valid = true;
        for (const p of platformData) {
          const dx = Math.abs(x - p.x);
          const dy = Math.abs(y - p.y);
          if (dx < (w/2 + p.w/2 + 30) && dy < 60) {
            valid = false;
            break;
          }
        }
        attempts++;
      }

      if (valid) {
        platformData.push({ x, y, w });
        this.platforms.add(this.add.rectangle(x, y, w, 14, 0x4a4a6a));
      }
    }

    // Player spawn
    this.player = this.add.rectangle(60, 500, 24, 40, 0x00ff88);
    this.physics.add.existing(this.player);
    // Collision avec les bords sauf en bas (pour tomber dans les trous)
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, 800, 800); // Étendre le monde vers le bas
    this.player.body.setGravityY(this.config.gravity);
    this.player.body.setMaxVelocityX(this.config.playerSpeed);

    // Collisions
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.walls, this.touchWall, null, this);
    this.physics.add.collider(this.enemies, this.platforms);

    // Clé - placée sur une plateforme aléatoire haute (sauf niveau boss)
    if (!isBossLevel) {
      const highPlatforms = platformData.filter(p => p.y < 350).sort((a, b) => a.y - b.y);
      const keyPlatform = highPlatforms.length > 0 ? highPlatforms[0] : platformData[platformData.length - 1];

      if (keyPlatform) {
        this.key = this.add.text(keyPlatform.x, keyPlatform.y - 30, '🔑', { fontSize: '28px' }).setOrigin(0.5);
        this.physics.add.existing(this.key, true);
        this.key.body.setSize(24, 24);
        this.physics.add.overlap(this.player, this.key, this.collectKey, null, this);
      }
    }

    // Porte - en haut à droite
    this.door = this.add.rectangle(740, 100, 40, 60, 0x666666);
    this.door.setStrokeStyle(3, 0x444444);
    this.doorLocked = true;
    this.physics.add.existing(this.door, true);
    this.physics.add.overlap(this.player, this.door, this.enterDoor, null, this);

    // Plateforme pour la porte
    this.platforms.add(this.add.rectangle(740, 138, 80, 14, 0x4a4a6a));

    // Ennemis basiques
    const numEnemies = Math.min(2 + Math.floor(this.currentLevel / 2), 5);
    const usedPlatforms = new Set();

    for (let i = 0; i < numEnemies && platformData.length > 0; i++) {
      const availablePlatforms = platformData.filter((_, idx) => !usedPlatforms.has(idx) && platformData[idx].w >= 100);
      if (availablePlatforms.length === 0) break;

      const idx = this.rng.between(0, availablePlatforms.length - 1);
      const plat = availablePlatforms[idx];
      usedPlatforms.add(platformData.indexOf(plat));

      this.createPatrolEnemy(plat.x, plat.y - 30, plat.x - plat.w/2 + 20, plat.x + plat.w/2 - 20);
    }

    // Ennemi au sol (sauf niveau boss)
    if (!isBossLevel) {
      const groundEnemy = this.createPatrolEnemy(400, 540, 100, 700);
      groundEnemy.isGroundEnemy = true; // Marquer comme ennemi au sol
    }

    // Ennemis tireurs (à partir niveau 2, sauf boss)
    if (this.currentLevel >= 2 && !isBossLevel) {
      const numShooters = Math.min(Math.floor(this.currentLevel / 2), 3);
      for (let i = 0; i < numShooters; i++) {
        // Position aléatoire à chaque partie (Math.random)
        const side = Math.random() < 0.5 ? 60 : 740;
        const shootY = 180 + Math.floor(Math.random() * 200); // 180-380
        // Plateforme d'abord
        this.platforms.add(this.add.rectangle(side, shootY + 20, 60, 12, 0x5a4a6a));
        // Puis le shooter dessus
        this.createShooterEnemy(side, shootY);
      }
    }

    // BOSS tous les 5 niveaux
    if (isBossLevel) {
      this.spawnBoss();
    }

    // Zone de mort (en bas de l'écran pour les trous)
    const deathZone = this.add.rectangle(400, 620, 800, 40, 0xff0000, 0);
    this.deathZones.add(deathZone);
    this.physics.add.overlap(this.player, this.deathZones, this.fallDeath, null, this);

    // Coins
    const numCoins = 3 + this.currentLevel;
    for (let i = 0; i < numCoins; i++) {
      const cx = this.rng.between(50, 750);
      const cy = this.rng.between(100, 500);
      const coin = this.add.circle(cx, cy, 8, 0xffd700);
      this.coins.add(coin);
      coin.body.setAllowGravity(false);
    }

    // Vie bonus (chance aléatoire - reroll à chaque partie)
    const heartChance = Math.min(0.15 + this.currentLevel * 0.03, 0.4); // 15% -> 40% max
    if (Math.random() < heartChance) {  // Math.random() pour un vrai reroll
      // Placer sur une plateforme aléatoire
      const heartPlat = platformData.length > 0
        ? platformData[this.rng.between(0, platformData.length - 1)]
        : null;

      if (heartPlat) {
        this.heartPickup = this.add.text(heartPlat.x, heartPlat.y - 25, '💖', { fontSize: '24px' }).setOrigin(0.5);
        this.physics.add.existing(this.heartPickup, true);
        this.heartPickup.body.setSize(20, 20);
        this.physics.add.overlap(this.player, this.heartPickup, this.collectHeart, null, this);

        // Petite animation de flottement
        this.tweens.add({
          targets: this.heartPickup,
          y: heartPlat.y - 35,
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    }

    // Overlaps
    this.physics.add.overlap(this.player, this.enemies, this.hitEnemy, null, this);
    this.physics.add.overlap(this.player, this.shooters, this.hitEnemy, null, this);
    this.physics.add.overlap(this.player, this.bullets, this.hitBullet, null, this);
    this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
  }

  touchWall(player, wall) {
    // Utilisé pour détecter le contact mur
    this.isTouchingWall = true;
    this.currentWallX = wall.x;
  }

  createPatrolEnemy(x, y, minX, maxX) {
    const enemy = this.add.rectangle(x, y, 28, 28, 0xff4444);
    this.enemies.add(enemy);
    enemy.body.setAllowGravity(true);
    enemy.body.setGravityY(this.config.gravity);
    enemy.body.setVelocityX(60 + this.currentLevel * 5);
    enemy.patrolMin = minX;
    enemy.patrolMax = maxX;
    enemy.body.setCollideWorldBounds(true);
    return enemy;
  }

  createShooterEnemy(x, y) {
    const shooter = this.add.rectangle(x, y, 30, 30, 0xff8800);
    shooter.setStrokeStyle(2, 0xcc6600);
    this.shooters.add(shooter);
    shooter.body.setAllowGravity(false); // Statique, pas de gravité
    shooter.body.setImmovable(true);

    // Timer de tir individuel
    const baseDelay = 2800 - Math.min(this.currentLevel * 100, 1000);
    const initialDelay = 2000 + Phaser.Math.Between(0, 1500); // Délai initial pour éviter tir au spawn

    shooter.shootTimer = this.time.addEvent({
      delay: initialDelay,
      callback: () => {
        this.shooterFire(shooter);
        // Reconfigurer pour les tirs suivants
        shooter.shootTimer = this.time.addEvent({
          delay: baseDelay + Phaser.Math.Between(-300, 500),
          callback: () => this.shooterFire(shooter),
          callbackScope: this,
          loop: true
        });
      },
      callbackScope: this
    });

    return shooter;
  }

  shooterFire(shooter) {
    if (!shooter || !shooter.active) return;

    // Animation de charge - tremblement + grossissement
    const originalX = shooter.x;
    const originalY = shooter.y;

    // Grossissement
    this.tweens.add({
      targets: shooter,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 400,
      ease: 'Quad.easeIn',
      yoyo: true
    });

    // Tremblement
    let shakeCount = 0;
    const shakeInterval = this.time.addEvent({
      delay: 30,
      callback: () => {
        if (!shooter || !shooter.active) return;
        shooter.x = originalX + Phaser.Math.Between(-3, 3);
        shooter.y = originalY + Phaser.Math.Between(-2, 2);
        shakeCount++;
        if (shakeCount > 12) {
          shakeInterval.remove();
          shooter.x = originalX;
          shooter.y = originalY;
        }
      },
      loop: true
    });

    // Flash de couleur
    shooter.setFillStyle(0xffcc00);
    this.time.delayedCall(200, () => {
      if (shooter && shooter.active) shooter.setFillStyle(0xffaa00);
    });

    // Tir après l'animation
    this.time.delayedCall(450, () => {
      if (!shooter || !shooter.active) return;
      shooter.setFillStyle(0xff8800);
      shooter.x = originalX;
      shooter.y = originalY;

      // Limiter le nombre de bullets (max 20)
      if (this.bullets.getLength() >= 20) {
        const oldest = this.bullets.getFirstAlive();
        if (oldest) oldest.destroy();
      }

      // Créer le projectile
      const angle = Phaser.Math.Angle.Between(shooter.x, shooter.y, this.player.x, this.player.y);
      const bullet = this.add.circle(shooter.x, shooter.y, 7, 0xffee00);
      bullet.setStrokeStyle(2, 0xff6600);
      this.bullets.add(bullet);
      bullet.body.setAllowGravity(false);

      const speed = 160 + this.currentLevel * 10;
      bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

      // Destruction après 3s (réduit de 5s)
      this.time.delayedCall(3000, () => {
        if (bullet && bullet.active) bullet.destroy();
      });
    });
  }

  generateGroundWithHoles(numHoles) {
    if (numHoles === 0) {
      // Sol plein
      this.platforms.add(this.add.rectangle(400, 592, 800, 16, 0x4a4a6a));
      return;
    }

    // Générer les positions des trous
    const holeWidth = 80;
    const minGap = 120; // Espace minimum entre les trous
    const holes = [];
    const safeZoneLeft = 100; // Zone safe près du spawn
    const safeZoneRight = 700; // Zone safe près de la porte

    for (let i = 0; i < numHoles; i++) {
      let holeX;
      let valid = false;
      let attempts = 0;

      while (!valid && attempts < 30) {
        holeX = this.rng.between(safeZoneLeft + holeWidth, safeZoneRight - holeWidth);
        valid = true;
        for (const h of holes) {
          if (Math.abs(holeX - h) < holeWidth + minGap) {
            valid = false;
            break;
          }
        }
        attempts++;
      }

      if (valid) holes.push(holeX);
    }

    holes.sort((a, b) => a - b);

    // Stocker les trous pour que les ennemis les évitent
    this.groundHoles = holes.map(holeX => ({
      left: holeX - holeWidth / 2,
      right: holeX + holeWidth / 2
    }));

    // Créer les segments de sol
    let lastX = 0;
    for (const holeX of holes) {
      const segmentStart = lastX;
      const segmentEnd = holeX - holeWidth / 2;
      const segmentWidth = segmentEnd - segmentStart;

      if (segmentWidth > 20) {
        const segmentCenterX = segmentStart + segmentWidth / 2;
        this.platforms.add(this.add.rectangle(segmentCenterX, 592, segmentWidth, 16, 0x4a4a6a));
      }

      lastX = holeX + holeWidth / 2;
    }

    // Dernier segment
    const finalWidth = 800 - lastX;
    if (finalWidth > 20) {
      const finalCenterX = lastX + finalWidth / 2;
      this.platforms.add(this.add.rectangle(finalCenterX, 592, finalWidth, 16, 0x4a4a6a));
    }

    // Indicateurs visuels des trous (danger)
    for (const holeX of holes) {
      // Petits triangles d'avertissement
      const warning = this.add.triangle(holeX, 575, 0, 10, 5, 0, 10, 10, 0xff4444, 0.5);
    }
  }

  spawnBoss() {
    const bossNum = Math.floor(this.currentLevel / 5);
    const bossHealth = 5 + bossNum * 3;
    const bossSpeed = 80 + bossNum * 20;

    // Créer le boss
    this.boss = this.add.rectangle(400, 300, 70, 70, 0xaa00aa);
    this.boss.setStrokeStyle(4, 0xff00ff);
    this.physics.add.existing(this.boss);
    this.boss.body.setAllowGravity(false);
    this.boss.body.setCollideWorldBounds(true);

    this.bossHealth = bossHealth;
    this.bossMaxHealth = bossHealth;
    this.bossPhase = 1;

    // Barre de vie du boss
    this.bossHealthBarBg = this.add.rectangle(400, 50, 204, 16, 0x333333);
    this.bossHealthBar = this.add.rectangle(400, 50, 200, 12, 0xff00ff);
    this.add.text(400, 30, `BOSS Nv.${bossNum}`, { fontSize: '14px', fill: '#ff00ff' }).setOrigin(0.5);

    // Pattern de mouvement
    this.bossMoveTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossChangeDirection,
      callbackScope: this,
      loop: true
    });

    // Pattern de tir
    this.bossShootTimer = this.time.addEvent({
      delay: 1500 - bossNum * 100,
      callback: this.bossShoot,
      callbackScope: this,
      loop: true
    });

    // Collision avec le joueur
    this.physics.add.overlap(this.player, this.boss, this.hitBoss, null, this);

    // Mouvement initial
    this.boss.body.setVelocity(bossSpeed, bossSpeed / 2);
    this.boss.moveSpeed = bossSpeed;
  }

  bossChangeDirection() {
    if (!this.boss || !this.boss.active) return;

    const speed = this.boss.moveSpeed;
    const dirX = this.rng.between(0, 1) ? 1 : -1;
    const dirY = this.rng.between(0, 1) ? 1 : -1;

    // Suivre un peu le joueur
    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;

    this.boss.body.setVelocity(
      (toPlayerX > 0 ? 1 : -1) * speed * 0.7 + dirX * speed * 0.3,
      dirY * speed * 0.5
    );

    // Limiter en hauteur
    if (this.boss.y > 400) this.boss.body.setVelocityY(-speed);
    if (this.boss.y < 100) this.boss.body.setVelocityY(speed);
  }

  bossShoot() {
    if (!this.boss || !this.boss.active) return;

    // Animation de charge
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 300,
      yoyo: true
    });

    this.time.delayedCall(350, () => {
      if (!this.boss || !this.boss.active) return;

      // Limiter les bullets avant d'en créer de nouvelles
      while (this.bullets.getLength() >= 20) {
        const oldest = this.bullets.getFirstAlive();
        if (oldest) oldest.destroy();
        else break;
      }

      // Tir en éventail (3-5 balles selon la phase)
      const numBullets = 3 + this.bossPhase;
      const spreadAngle = Math.PI / 4;
      const baseAngle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);

      for (let i = 0; i < numBullets; i++) {
        const angle = baseAngle - spreadAngle / 2 + (spreadAngle / (numBullets - 1)) * i;
        const bullet = this.add.circle(this.boss.x, this.boss.y, 9, 0xff00ff);
        bullet.setStrokeStyle(2, 0xaa00aa);
        this.bullets.add(bullet);
        bullet.body.setAllowGravity(false);

        const speed = 180 + this.bossPhase * 20;
        bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

        // Destruction après 3s
        this.time.delayedCall(3000, () => {
          if (bullet && bullet.active) bullet.destroy();
        });
      }
    });
  }

  hitBoss(player, boss) {
    if (this.isInvincible) return;

    // Si on saute sur le boss
    if (player.body.velocity.y > 0 && player.y < boss.y - 20) {
      this.bossHealth--;
      this.updateBossHealthBar();
      player.body.setVelocityY(-400);

      // Flash
      boss.setFillStyle(0xffffff);
      this.time.delayedCall(100, () => {
        if (boss.active) boss.setFillStyle(0xaa00aa);
      });

      // Changement de phase
      if (this.bossHealth <= this.bossMaxHealth * 0.5 && this.bossPhase === 1) {
        this.bossPhase = 2;
        this.boss.moveSpeed *= 1.3;
        this.boss.setStrokeStyle(4, 0xff0000);
      }

      // Boss mort
      if (this.bossHealth <= 0) {
        this.defeatBoss();
      }
    } else {
      this.takeDamage();
    }
  }

  updateBossHealthBar() {
    const healthPercent = this.bossHealth / this.bossMaxHealth;
    this.bossHealthBar.width = 200 * healthPercent;
    this.bossHealthBar.x = 400 - (200 - this.bossHealthBar.width) / 2;

    if (healthPercent < 0.5) {
      this.bossHealthBar.setFillStyle(0xff0000);
    }
  }

  defeatBoss() {
    // Explosion visuelle
    for (let i = 0; i < 10; i++) {
      const particle = this.add.circle(
        this.boss.x + Phaser.Math.Between(-30, 30),
        this.boss.y + Phaser.Math.Between(-30, 30),
        Phaser.Math.Between(5, 15),
        0xff00ff
      );
      this.tweens.add({
        targets: particle,
        alpha: 0,
        scale: 2,
        duration: 500,
        onComplete: () => particle.destroy()
      });
    }

    this.boss.destroy();
    this.bossHealthBar.destroy();
    this.bossHealthBarBg.destroy();
    if (this.bossMoveTimer) this.bossMoveTimer.remove();
    if (this.bossShootTimer) this.bossShootTimer.remove();

    this.score +=500;
    this.scoreText.setText('Score: ' + this.score);

    // Faire apparaître la clé
    this.key = this.add.text(400, 300, '🔑', { fontSize: '32px' }).setOrigin(0.5);
    this.physics.add.existing(this.key);
    this.key.body.setSize(24, 24);
    this.key.body.setAllowGravity(true);
    this.key.body.setGravityY(500);
    this.physics.add.collider(this.key, this.platforms);
    this.physics.add.overlap(this.player, this.key, this.collectKey, null, this);
  }

  fallDeath() {
    if (this.isInvincible || this.fallingDeath) return;
    this.fallingDeath = true; // Éviter les appels multiples

    this.takeDamage();

    // Respawn au point de départ (pas en haut pour éviter de tricher)
    this.player.x = 60;
    this.player.y = 500;
    this.player.body.setVelocity(0, 0);

    // Reset le flag après un court délai
    this.time.delayedCall(100, () => {
      this.fallingDeath = false;
    });
  }

  collectKey() {
    if (this.hasKey) return;
    this.hasKey = true;
    this.key.destroy();
    this.keyText.setText('🔑: ✅');
    this.doorLocked = false;
    this.door.setFillStyle(0x00cc66);
    this.door.setStrokeStyle(3, 0x00ff88);
  }

  enterDoor() {
    if (!this.hasKey || this.doorLocked) return;

    // Sauvegarder le meilleur temps du niveau
    const currentBest = this.bestTimes[this.currentLevel];
    if (!currentBest || this.levelTime < currentBest) {
      this.bestTimes[this.currentLevel] = this.levelTime;
      localStorage.setItem('platformer-best-times', JSON.stringify(this.bestTimes));
    }

    // Sauvegarder le meilleur temps total jusqu'à ce niveau
    const newTotalTime = this.totalTime + this.levelTime;
    const currentBestTotal = this.bestTotalTime[this.currentLevel];
    if (!currentBestTotal || newTotalTime < currentBestTotal) {
      this.bestTotalTime[this.currentLevel] = newTotalTime;
      localStorage.setItem('platformer-best-total', JSON.stringify(this.bestTotalTime));
    }

    // Niveau suivant (totalTime inclut le temps du niveau actuel)
    this.scene.restart({ level: this.currentLevel + 1, score: this.score, totalTime: this.totalTime + this.levelTime });
  }

  formatTime(ms) {
    const seconds = ms / 1000;
    if (seconds < 60) {
      return seconds.toFixed(2) + 's';
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  }

  hitEnemy(player, enemy) {
    if (this.isInvincible) return;

    if (player.body.velocity.y > 0 && player.y < enemy.y - 10) {
      enemy.destroy();
      this.score +=50;
      this.scoreText.setText('Score: ' + this.score);
      player.body.setVelocityY(-300);
    } else {
      this.takeDamage();
    }
  }

  hitBullet(player, bullet) {
    if (this.isInvincible) return;
    bullet.destroy();
    this.takeDamage();
  }

  takeDamage() {
    if (this.isInvincible) return;

    this.playerHealth--;
    this.healthText.setText('❤️'.repeat(Math.max(0, this.playerHealth)) + '🖤'.repeat(Math.max(0, this.maxHealth - this.playerHealth)));

    if (this.playerHealth <= 0) {
      this.scene.restart({ level: 1, score: 0 });
      return;
    }

    this.isInvincible = true;
    this.tweens.add({
      targets: this.player,
      alpha: 0.3,
      duration: 100,
      yoyo: true,
      repeat: 5,
      onComplete: () => {
        this.isInvincible = false;
        this.player.alpha = 1;
      }
    });

    const knockbackDir = this.player.body.velocity.x >= 0 ? -1 : 1;
    this.player.body.setVelocity(knockbackDir * 200, -200);
  }

  collectCoin(player, coin) {
    coin.destroy();
    this.score +=10;
    this.scoreText.setText('Score: ' + this.score);
  }

  collectHeart() {
    if (!this.heartPickup || !this.heartPickup.active) return;

    this.heartPickup.destroy();

    // Augmente la vie max ET soigne
    this.maxHealth++;
    this.playerHealth = this.maxHealth;
    this.healthText.setText('❤️'.repeat(this.playerHealth));

    // Effet visuel
    const bonusText = this.add.text(this.player.x, this.player.y - 40, '+1 ❤️ MAX!', {
      fontSize: '18px',
      fill: '#ff6b9d',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: bonusText,
      y: bonusText.y - 50,
      alpha: 0,
      duration: 1000,
      onComplete: () => bonusText.destroy()
    });

    this.score += 100;
    this.scoreText.setText('Score: ' + this.score);
  }

  update(time, delta) {
    // Reset rapide (R)
    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.scene.restart({ level: 1, score: 0, totalTime: 0 });
      return;
    }

    // Mise à jour des chronos
    this.levelTime += delta;
    this.timerText.setText('⏱️ ' + this.formatTime(this.levelTime));
    this.totalTimeText.setText('Total: ' + this.formatTime(this.totalTime + this.levelTime));

    // Delta vs PB (en temps réel)
    const bestTime = this.bestTimes[this.currentLevel];
    if (bestTime) {
      const diff = this.levelTime - bestTime;
      if (diff > 0) {
        this.deltaText.setText(`+${this.formatTime(diff)}`);
        this.deltaText.setFill('#ff6666'); // Rouge = en retard
      } else {
        this.deltaText.setText(`-${this.formatTime(Math.abs(diff))}`);
        this.deltaText.setFill('#66ff66'); // Vert = en avance
      }
    }

    // Vérification fiable de chute dans un trou (backup si overlap rate)
    if (this.player.y > 620) {
      this.fallDeath();
    }

    const body = this.player.body;
    const { playerSpeed, playerAccel, playerDecel, jumpForce, doubleJumpForce, coyoteTime, jumpBufferTime,
            wallJumpForceX, wallJumpForceY, wallSlideSpeed } = this.config;

    const onGround = body.blocked.down || body.touching.down;
    const onWallLeft = body.blocked.left;
    const onWallRight = body.blocked.right;
    const onWall = (onWallLeft || onWallRight) && !onGround;

    // Reset double jump quand on touche le sol ou un mur
    if (onGround || onWall) {
      this.canDoubleJump = true;
      this.hasDoubleJumped = false;
    }

    // Coyote time
    if (onGround) {
      this.coyoteTimer = coyoteTime;
      this.lastWallDir = 0;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= delta;
    }

    // Wall coyote time
    if (onWall) {
      this.wallCoyoteTimer = 100;
      this.lastWallDir = onWallLeft ? -1 : 1;
    } else if (this.wallCoyoteTimer > 0) {
      this.wallCoyoteTimer -= delta;
    }

    // Input
    const left = this.cursors.left.isDown || this.keys.q.isDown;
    const right = this.cursors.right.isDown || this.keys.d.isDown;
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.keys.z) ||
                        Phaser.Input.Keyboard.JustDown(this.keys.space) ||
                        Phaser.Input.Keyboard.JustDown(this.cursors.up);

    // Jump buffer
    if (jumpPressed) {
      this.jumpBufferTimer = jumpBufferTime;
    } else if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    // Wall slide
    if (onWall && body.velocity.y > 0) {
      body.setVelocityY(Math.min(body.velocity.y, wallSlideSpeed));
    }

    // Mouvement horizontal avec friction forte
    const currentVelX = body.velocity.x;

    // Bloquer le mouvement horizontal temporairement après wall jump
    if (this.wallJumpLockTimer > 0) {
      this.wallJumpLockTimer -= delta;
    } else {
      if (left) {
        body.setVelocityX(Math.max(currentVelX - playerAccel * delta / 1000, -playerSpeed));
      } else if (right) {
        body.setVelocityX(Math.min(currentVelX + playerAccel * delta / 1000, playerSpeed));
      } else {
        // Friction forte - arrêt rapide
        if (currentVelX > 0) {
          body.setVelocityX(Math.max(0, currentVelX - playerDecel * delta / 1000));
        } else if (currentVelX < 0) {
          body.setVelocityX(Math.min(0, currentVelX + playerDecel * delta / 1000));
        }
      }
    }

    // Saut normal (depuis le sol)
    const canJump = this.coyoteTimer > 0;
    if (this.jumpBufferTimer > 0 && canJump) {
      body.setVelocityY(-jumpForce);
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    }
    // Wall jump
    else if (this.jumpBufferTimer > 0 && this.wallCoyoteTimer > 0 && this.lastWallDir !== 0) {
      body.setVelocityY(-wallJumpForceY);
      body.setVelocityX(-this.lastWallDir * wallJumpForceX);
      this.wallCoyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.wallJumpLockTimer = 150;
      this.canDoubleJump = true; // Reset double jump après wall jump
      this.hasDoubleJumped = false;
    }
    // Double jump (en l'air)
    else if (this.jumpBufferTimer > 0 && this.canDoubleJump && !this.hasDoubleJumped && !onGround && this.coyoteTimer <= 0) {
      body.setVelocityY(-doubleJumpForce);
      this.jumpBufferTimer = 0;
      this.hasDoubleJumped = true;
      this.canDoubleJump = false;
    }

    // Gravité augmentée en descente
    if (body.velocity.y > 0 && !onWall) {
      body.setGravityY(this.config.gravity * 1.5);
    } else {
      body.setGravityY(this.config.gravity);
    }

    // Nettoyer les bullets hors écran (plus efficace que les timers)
    this.bullets.getChildren().forEach(bullet => {
      if (!bullet.active) return;
      if (bullet.x < -50 || bullet.x > 850 || bullet.y < -50 || bullet.y > 700) {
        bullet.destroy();
      }
    });

    // Update ennemis patrouille
    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.active) return;
      const speed = 60 + this.currentLevel * 5;

      // Vérifier les limites de patrouille
      if (enemy.x <= enemy.patrolMin) {
        enemy.body.setVelocityX(speed);
      } else if (enemy.x >= enemy.patrolMax) {
        enemy.body.setVelocityX(-speed);
      }

      // Les ennemis au sol évitent les trous
      if (enemy.isGroundEnemy && this.groundHoles.length > 0) {
        const margin = 30; // Marge avant le trou
        for (const hole of this.groundHoles) {
          // Si l'ennemi va vers la droite et approche d'un trou
          if (enemy.body.velocity.x > 0 && enemy.x > hole.left - margin && enemy.x < hole.left) {
            enemy.body.setVelocityX(-speed);
          }
          // Si l'ennemi va vers la gauche et approche d'un trou
          if (enemy.body.velocity.x < 0 && enemy.x < hole.right + margin && enemy.x > hole.right) {
            enemy.body.setVelocityX(speed);
          }
        }
      }
    });

    // Visual feedback
    if (onWall && body.velocity.y > 0) {
      // Wall slide = cyan
      this.player.setFillStyle(0x00ccaa);
    } else if (!onGround && this.hasDoubleJumped) {
      // Double jump utilisé = orange clair
      this.player.setFillStyle(0x88cc44);
    } else {
      // Normal = vert
      this.player.setFillStyle(0x00ff88);
    }

    // Parallax étoiles - mouvement basé sur la position du joueur
    const offsetX = (this.player.x - 400) / 400; // -1 à 1
    const offsetY = (this.player.y - 300) / 300; // -1 à 1

    this.stars.forEach(star => {
      // Chaque étoile bouge selon sa profondeur (plus profond = bouge moins)
      const parallaxStrength = 20 * star.depth;
      star.x = star.baseX - offsetX * parallaxStrength;
      star.y = star.baseY - offsetY * parallaxStrength * 0.6;
    });

    this.isTouchingWall = false;
  }

  // Nettoyage lors du changement de scène
  shutdown() {
    // Arrêter tous les timers des shooters
    this.shooters.getChildren().forEach(shooter => {
      if (shooter.shootTimer) {
        shooter.shootTimer.remove();
      }
    });

    // Arrêter les timers du boss
    if (this.bossMoveTimer) this.bossMoveTimer.remove();
    if (this.bossShootTimer) this.bossShootTimer.remove();

    // Arrêter tous les tweens
    this.tweens.killAll();

    // Arrêter tous les timers de la scène
    this.time.removeAllEvents();

    // Détruire tous les objets des groupes
    this.bullets.clear(true, true);
    this.enemies.clear(true, true);
    this.shooters.clear(true, true);
    this.coins.clear(true, true);
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
      debug: false
    }
  },
  scene: GameScene
};

new Phaser.Game(config);
