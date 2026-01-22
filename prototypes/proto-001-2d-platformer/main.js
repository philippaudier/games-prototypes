// Phaser loaded via CDN in index.html

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.currentLevel = data.level || 1;
    this.score = data.score || 0;
    this.levelTime = 0; // Chrono du niveau en ms
    this.totalTime = data.totalTime || 0; // Timer total du run
    this.maxHealth = data.maxHealth || 3; // Nombre de coeurs max
    // HP en quarts: 4 HP = 1 coeur plein
    this.currentHealth = data.currentHealth !== undefined ? data.currentHealth : this.maxHealth * 4;
    this.isTransitioning = false; // Flag pour éviter les transitions multiples

    // Charger les meilleurs temps depuis localStorage
    this.bestTimes = JSON.parse(localStorage.getItem('platformer-best-times') || '{}');
    this.bestTotalTime = JSON.parse(localStorage.getItem('platformer-best-total') || '{}');

    // Charger le checkpoint depuis localStorage
    this.checkpoint = JSON.parse(localStorage.getItem('platformer-checkpoint') || 'null');

    // Si on commence au niveau 1, effacer tout ancien checkpoint (nouvelle partie)
    if (this.currentLevel === 1) {
      localStorage.removeItem('platformer-checkpoint');
      this.checkpoint = null;
    }
  }

  preload() {
    // Charger les sprites
    this.load.image('player', 'assets/sunday.png');
    this.load.image('key', 'assets/key.png');
    // Coeurs fractionnels
    this.load.image('heart_full', 'assets/heart_full.png');
    this.load.image('heart_3', 'assets/heart_3.png');
    this.load.image('heart_demi', 'assets/heart_demi.png');
    this.load.image('heart_1', 'assets/heart_1.png');
  }

  create() {
    // Config gameplay - Tuné pour un feel "pro" style Celeste/Super Meat Boy
    this.config = {
      // Mouvement horizontal
      playerSpeed: 340,
      playerAccel: 2800,     // Accélération au sol (réduite pour moins de glisse)
      playerDecel: 8000,     // Décélération au sol (augmentée pour arrêt rapide)
      airAccel: 2400,        // Accélération en l'air (légèrement réduite)
      airDecel: 1800,        // Décélération en l'air (beaucoup plus faible = momentum)

      // Saut
      jumpForce: 580,
      doubleJumpForce: 500,
      variableJumpMultiplier: 0.45,  // Relâcher tôt = 45% de la hauteur
      apexGravityMultiplier: 0.5,    // Gravité réduite au sommet du saut
      apexThreshold: 80,             // Vitesse Y sous laquelle on est à l'apex

      // Gravité
      gravity: 1800,
      fastFallSpeed: 900,            // Vitesse max en fast fall
      fastFallGravity: 4500,         // Gravité quand on appuie bas

      // Timing
      coyoteTime: 90,
      jumpBufferTime: 120,

      // Murs
      wallJumpForceX: 380,
      wallJumpForceY: 520,
      wallSlideSpeed: 80,
      wallClimbSpeed: 120,           // Vitesse de grimpe

      // Dash (style Celeste)
      dashSpeed: 550,
      dashDuration: 120,             // Durée du dash en ms
      dashCooldown: 0,               // Pas de cooldown au sol, 1 par saut en l'air

      // Corner correction
      cornerCorrectionPixels: 6      // Pixels de correction sur les rebords
    };

    // Initialiser le système audio
    this.initAudio();

    // Initialiser le système de particules
    this.initParticles();

    // Initialiser le système de musique
    this.initMusic();

    // Variables joueur
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.playerHealth = this.currentHealth; // HP en quarts (4 HP = 1 coeur)
    this.isInvincible = true; // Invincible au spawn
    this.canMove = false; // Freeze au spawn
    this.hasKey = false;
    this.wallSlideTimer = 0;
    this.lastWallDir = 0;
    this.canDoubleJump = false;
    this.hasDoubleJumped = false;
    this.fallingDeath = false;

    // Nouvelles variables pour le feel avancé
    this.isJumping = false;           // Pour variable jump
    this.jumpHeld = false;            // Bouton saut maintenu
    this.isDashing = false;           // En train de dash
    this.canDash = true;              // Peut dasher
    this.dashTimer = 0;               // Timer du dash
    this.dashDir = { x: 0, y: 0 };    // Direction du dash
    this.hasDashedInAir = false;      // A déjà dashé en l'air
    this.isClimbing = false;          // En train de grimper
    this.playerScaleY = 1;            // Pour squash/stretch
    this.playerScaleX = 1;
    this.lastVelocityY = 0;           // Pour détecter l'atterrissage fort
    this.speedTrail = [];             // Pour les speed lines

    // === MONDE ET CAMÉRA ===
    // Monde compact pour niveaux resserrés
    this.WORLD = {
      width: 960,                     // Petit monde
      height: 540,                    // Compact
      groundY: 500                    // Sol près du bas
    };

    // === SYSTÈME DE TILES ===
    this.TILE = {
      SIZE: 32,
      COLS: 30,                       // 960 / 32
      ROWS: 15                        // Zone jouable (480px / 32)
    };

    // Règles de placement basées sur les capacités du joueur (en tiles)
    this.JUMP_RULES = {
      SINGLE_HEIGHT: 3,               // Hauteur max saut simple (tiles)
      DOUBLE_HEIGHT: 6,               // Hauteur max double saut (tiles)
      SINGLE_RANGE: 6,                // Portée horizontale saut simple (tiles)
      DOUBLE_RANGE: 11,               // Portée horizontale double saut (tiles)
      MIN_SPACING: 2,                 // Espacement minimum entre plateformes (tiles)
      MIN_KEY_DOOR_DIST: 8            // Distance minimum clé-porte (tiles)
    };

    // Config caméra
    this.cameraConfig = {
      lerpX: 0.08,                    // Smooth follow horizontal
      lerpY: 0.1,                     // Smooth follow vertical (plus réactif)
      lookAheadX: 100,                // Pixels devant le joueur
      lookAheadY: 50,                 // Pixels au-dessus/dessous
      deadzone: { width: 100, height: 50 }, // Zone morte
      baseZoom: 1.0,                  // Zoom de base
      minZoom: 0.92,                  // Zoom out max (quand rapide) - subtil
      maxZoom: 1.05,                  // Zoom in max (au repos) - subtil
      zoomLerp: 0.006,                // Vitesse de transition zoom - très smooth
      shakeIntensity: 0.005           // Intensité du shake
    };

    this.targetZoom = this.cameraConfig.baseZoom;
    this.currentLookAhead = { x: 0, y: 0 };

    // Le joueur est gelé jusqu'à la fin de l'intro
    this.canMove = false;
    this.isInvincible = true;

    // Seed basé sur le niveau pour reproductibilité
    this.rng = new Phaser.Math.RandomDataGenerator([`level-${this.currentLevel}`]);

    // Background parallax
    this.createParallaxBackground();

    // Génération du niveau
    this.generateLevel();

    // UI - Design moderne avec zones claires
    this.createUI();

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = {
      z: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      q: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      r: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R), // Reset rapide
      shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT), // Dash
      x: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X), // Dash alternatif
      c: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C)  // Dash alternatif 2
    };

    // Mobile touch controls
    this.initTouchControls();

    // Lancer l'animation d'intro du niveau
    this.playLevelIntro();
  }

  // ==========================================
  // MOBILE TOUCH CONTROLS
  // ==========================================

  initTouchControls() {
    // State for touch inputs
    this.touchInput = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      jumpJustPressed: false,
      dash: false,
      dashJustPressed: false
    };

    // Check if touch device
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isTouchDevice) return;

    // Get touch control elements
    const touchButtons = document.querySelectorAll('[data-input]');

    touchButtons.forEach(btn => {
      const input = btn.dataset.input;

      // Touch start
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('active');

        if (input === 'jump') {
          this.touchInput.jump = true;
          this.touchInput.jumpJustPressed = true;
        } else if (input === 'dash') {
          this.touchInput.dash = true;
          this.touchInput.dashJustPressed = true;
        } else {
          this.touchInput[input] = true;
        }
      }, { passive: false });

      // Touch end
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.classList.remove('active');

        if (input === 'jump') {
          this.touchInput.jump = false;
        } else if (input === 'dash') {
          this.touchInput.dash = false;
        } else {
          this.touchInput[input] = false;
        }
      }, { passive: false });

      // Touch cancel (e.g., finger moves off button)
      btn.addEventListener('touchcancel', (e) => {
        btn.classList.remove('active');
        if (input === 'jump') {
          this.touchInput.jump = false;
        } else if (input === 'dash') {
          this.touchInput.dash = false;
        } else {
          this.touchInput[input] = false;
        }
      }, { passive: false });
    });

    // Prevent default touch behaviors on game canvas
    const gameContainer = document.getElementById('game');
    if (gameContainer) {
      gameContainer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      gameContainer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }
  }

  // Reset "just pressed" states (call at end of update)
  resetTouchJustPressed() {
    if (this.touchInput) {
      this.touchInput.jumpJustPressed = false;
      this.touchInput.dashJustPressed = false;
    }
  }

  // ==========================================
  // SYSTÈME DE TRANSITIONS
  // ==========================================

  playLevelIntro() {
    const isBossLevel = this.currentLevel % 5 === 0;
    const centerX = this.WORLD.width / 2;
    const centerY = this.WORLD.height / 2;

    // Overlay noir qui couvre tout l'écran
    this.transitionOverlay = this.add.rectangle(centerX, centerY, this.WORLD.width + 100, this.WORLD.height + 100, 0x000000);
    this.transitionOverlay.setDepth(1000);
    this.transitionOverlay.setScrollFactor(0);

    // Texte du niveau
    const levelText = isBossLevel
      ? `⚠ DANGER ⚠`
      : `NIVEAU ${this.currentLevel}`;

    this.introText = this.add.text(centerX, centerY, levelText, {
      fontSize: isBossLevel ? '56px' : '48px',
      fontFamily: 'Arial Black, sans-serif',
      fill: isBossLevel ? '#ff4444' : '#ffffff',
      stroke: isBossLevel ? '#880000' : '#333333',
      strokeThickness: isBossLevel ? 8 : 4
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0).setAlpha(0).setScale(0.5);

    // Pour les boss: effet de warning clignotant au lieu du nom
    if (isBossLevel) {
      // Créer une tête de mort en pixel art avec des rectangles
      this.bossSkullContainer = this.add.container(centerX, centerY + 55).setDepth(1001).setScrollFactor(0).setAlpha(0);

      // Crâne simplifié (16x16 pixels, scale x3)
      const px = 3; // Taille d'un "pixel"
      const skullColor = 0xffffff;
      const eyeColor = 0xff0000;

      // Forme du crâne
      const skull = [
        // Rangée 1-2: haut du crâne
        this.add.rectangle(-2*px, -6*px, 4*px, 2*px, skullColor),
        // Rangée 3-4: côtés + haut
        this.add.rectangle(-3*px, -4*px, 6*px, 2*px, skullColor),
        // Rangée 5-6: yeux
        this.add.rectangle(-3*px, -2*px, 6*px, 2*px, skullColor),
        this.add.rectangle(-2*px, -2*px, px, 2*px, eyeColor), // Œil gauche
        this.add.rectangle(1*px, -2*px, px, 2*px, eyeColor),  // Œil droit
        // Rangée 7-8: nez + joues
        this.add.rectangle(-3*px, 0, 6*px, 2*px, skullColor),
        this.add.rectangle(0, 0, px, px, 0x000000), // Nez
        // Rangée 9-10: mâchoire
        this.add.rectangle(-2*px, 2*px, 4*px, 2*px, skullColor),
        // Dents
        this.add.rectangle(-1.5*px, 2*px, px*0.5, px, 0x000000),
        this.add.rectangle(0, 2*px, px*0.5, px, 0x000000),
        this.add.rectangle(1.5*px, 2*px, px*0.5, px, 0x000000),
      ];
      skull.forEach(part => this.bossSkullContainer.add(part));

      // Texte "BOSS FIGHT" en dessous
      const fightText = this.add.text(0, 25, 'BOSS FIGHT', {
        fontSize: '18px',
        fontFamily: 'Arial Black, sans-serif',
        fill: '#ff6666',
        stroke: '#440000',
        strokeThickness: 2
      }).setOrigin(0.5);
      this.bossSkullContainer.add(fightText);

      // Animation de clignotement pour l'effet danger
      this.tweens.add({
        targets: this.introText,
        alpha: { from: 1, to: 0.5 },
        duration: 200,
        yoyo: true,
        repeat: -1,
        delay: 400
      });
    }

    // Animation d'entrée du texte
    this.tweens.add({
      targets: this.introText,
      alpha: 1,
      scale: 1,
      duration: 400,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Pause puis fade out
        this.time.delayedCall(isBossLevel ? 800 : 500, () => {
          this.startLevelFadeIn();
        });
      }
    });

    // Animation du skull pour les boss
    if (this.bossSkullContainer) {
      this.tweens.add({
        targets: this.bossSkullContainer,
        alpha: 1,
        scale: { from: 0.5, to: 1 },
        duration: 400,
        delay: 250,
        ease: 'Back.easeOut'
      });
    }
  }

  startLevelFadeIn() {
    const isBossLevel = this.currentLevel % 5 === 0;

    // Fade out du texte et skull
    this.tweens.add({
      targets: [this.introText, this.bossSkullContainer].filter(Boolean),
      alpha: 0,
      scale: 1.2,
      duration: 300,
      ease: 'Power2'
    });

    // Fade out de l'overlay
    this.tweens.add({
      targets: this.transitionOverlay,
      alpha: 0,
      duration: isBossLevel ? 600 : 400,
      ease: 'Power2',
      onComplete: () => {
        // Nettoyer
        if (this.transitionOverlay) this.transitionOverlay.destroy();
        if (this.introText) this.introText.destroy();
        if (this.bossSkullContainer) this.bossSkullContainer.destroy();

        // Activer le joueur
        this.canMove = true;
        this.startLevelMusic(); // Démarrer la musique du niveau
        this.time.delayedCall(500, () => {
          this.isInvincible = false;
        });
      }
    });

    // Effet de zoom dynamique pour les boss
    if (isBossLevel) {
      this.cameras.main.setZoom(1.1);
      this.tweens.add({
        targets: this.cameras.main,
        zoom: 1.0,
        duration: 800,
        ease: 'Power2'
      });
    }
  }

  playLevelOutro(nextLevelData) {
    // Désactiver le joueur
    this.canMove = false;
    this.isInvincible = true;

    const isBossLevel = (this.currentLevel + 1) % 5 === 0;
    const centerX = this.WORLD.width / 2;
    const centerY = this.WORLD.height / 2;

    // Animation du joueur qui entre dans la porte
    this.tweens.add({
      targets: this.player,
      scaleX: 0,
      scaleY: 0,
      alpha: 0.5,
      duration: 300,
      ease: 'Power2'
    });

    // Effet de zoom vers la porte
    this.tweens.add({
      targets: this.cameras.main,
      zoom: isBossLevel ? 1.3 : 1.15,
      duration: 400,
      ease: 'Power2'
    });

    // Flash blanc/rouge selon boss ou non
    const flashColor = isBossLevel ? 0xff2222 : 0xffffff;
    this.transitionFlash = this.add.rectangle(centerX, centerY, this.WORLD.width + 100, this.WORLD.height + 100, flashColor, 0);
    this.transitionFlash.setDepth(999);
    this.transitionFlash.setScrollFactor(0);

    // Overlay noir pour le fade final
    this.transitionOverlay = this.add.rectangle(centerX, centerY, this.WORLD.width + 100, this.WORLD.height + 100, 0x000000, 0);
    this.transitionOverlay.setDepth(1000);
    this.transitionOverlay.setScrollFactor(0);

    // Flash puis fade to black
    this.tweens.add({
      targets: this.transitionFlash,
      alpha: 0.7,
      duration: 150,
      yoyo: true,
      onComplete: () => {
        // Fade to black
        this.tweens.add({
          targets: this.transitionOverlay,
          alpha: 1,
          duration: 300,
          ease: 'Power2',
          onComplete: () => {
            // Passer au niveau suivant
            this.scene.restart(nextLevelData);
          }
        });
      }
    });

    // Screen shake pour les boss
    if (isBossLevel) {
      this.cameras.main.shake(400, 0.015);
    }
  }

  // ==========================================
  // SYSTÈME AUDIO - Web Audio API
  // ==========================================
  initAudio() {
    // Créer le contexte audio (sera activé au premier clic utilisateur)
    this.audioCtx = null;
    this.audioEnabled = false;
    this.masterVolume = 0.3;
    this.pendingBossMusic = null; // Boss type en attente si audio pas encore activé

    // Activer l'audio au premier input utilisateur
    const enableAudio = () => {
      if (!this.audioCtx) {
        try {
          this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          this.audioEnabled = true;
          // Si une musique de boss était en attente, la lancer maintenant
          if (this.pendingBossMusic !== null) {
            this.startBossMusic(this.pendingBossMusic);
            this.pendingBossMusic = null;
          }
          // Si une musique de niveau était en attente
          if (this.pendingMusic) {
            this.playMusicTrack(this.pendingMusic);
            this.pendingMusic = null;
          }
        } catch (e) {
          console.warn('AudioContext creation failed:', e);
        }
      }
      // IMPORTANT pour mobile: toujours essayer de resume
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      // Essayer de jouer la musique en attente (HTML5 Audio)
      if (this.currentTrack && this.currentTrack.paused && this.musicPlaying) {
        this.currentTrack.play().catch(() => {});
      }
    };

    // Événements Phaser
    this.input.on('pointerdown', enableAudio, this);
    this.input.on('pointerup', enableAudio, this);
    this.input.keyboard.on('keydown', enableAudio, this);

    // Événements DOM natifs pour mobile (plus fiables)
    const canvas = this.game.canvas;
    canvas.addEventListener('touchstart', enableAudio, { passive: true });
    canvas.addEventListener('touchend', enableAudio, { passive: true });
    canvas.addEventListener('click', enableAudio, { passive: true });

    // Essayer d'activer immédiatement si possible
    enableAudio();
  }

  playSound(type, options = {}) {
    if (!this.audioCtx || !this.audioEnabled) return;

    // Sur mobile, l'AudioContext peut être suspendu - essayer de le reprendre
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
      return; // Le son sera perdu mais les suivants marcheront
    }

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const volume = (options.volume || 1) * this.masterVolume;

    // Factory de sons procéduraux
    switch (type) {
      case 'jump': {
        // Son de saut - sweep ascendant
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        gain.gain.setValueAtTime(volume * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'doubleJump': {
        // Double saut - plus aigu avec vibrato
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(25, now);
        osc2.connect(osc.frequency);
        gain.gain.setValueAtTime(volume * 0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
        osc2.start(now);
        osc2.stop(now + 0.12);
        break;
      }
      case 'wallJump': {
        // Wall jump - son de rebond
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
        gain.gain.setValueAtTime(volume * 0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }
      case 'dash': {
        // Dash - whoosh rapide avec harmoniques
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const noise = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, now);
        filter.frequency.exponentialRampToValueAtTime(500, now + 0.15);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(600, now);
        osc2.frequency.exponentialRampToValueAtTime(200, now + 0.12);
        gain.gain.setValueAtTime(volume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc2.connect(filter);
        osc.start(now);
        osc.stop(now + 0.15);
        osc2.start(now);
        osc2.stop(now + 0.15);
        break;
      }
      case 'land': {
        // Atterrissage - thud sourd
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
        gain.gain.setValueAtTime(volume * 0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
        break;
      }
      case 'coin': {
        // Pièce - ding brillant
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, now);
        gain.gain.setValueAtTime(volume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        osc2.start(now + 0.05);
        osc2.stop(now + 0.2);
        break;
      }
      case 'key': {
        // Clé - son subtil et satisfaisant (pas trop fort)
        for (let i = 0; i < 2; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const freq = 600 * Math.pow(1.2, i);
          const delay = i * 0.06;
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(volume * 0.1, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.1);
        }
        break;
      }
      case 'heart': {
        // Coeur - son joyeux
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.1);
          gain.gain.setValueAtTime(volume * 0.2, now + i * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.1);
          osc.stop(now + i * 0.1 + 0.2);
        });
        break;
      }
      case 'hurt': {
        // Dégâts - son de douleur
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noise = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);
        noise.type = 'square';
        noise.frequency.setValueAtTime(40, now);
        gain.gain.setValueAtTime(volume * 0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.connect(gain);
        noise.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        noise.start(now);
        noise.stop(now + 0.2);
        break;
      }
      case 'death': {
        // Mort - descente dramatique
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.6);
        gain.gain.setValueAtTime(volume * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.6);
        break;
      }
      case 'enemyKill': {
        // Kill ennemi - pop satisfaisant
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        gain.gain.setValueAtTime(volume * 0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'bossHit': {
        // Hit boss - impact lourd
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(60, now);
        gain.gain.setValueAtTime(volume * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        osc2.start(now);
        osc2.stop(now + 0.15);
        break;
      }
      case 'bossPhase': {
        // Changement de phase - alarme
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(440, now + i * 0.15);
          osc.frequency.setValueAtTime(880, now + i * 0.15 + 0.07);
          gain.gain.setValueAtTime(volume * 0.3, now + i * 0.15);
          gain.gain.setValueAtTime(0.01, now + i * 0.15 + 0.12);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 0.12);
        }
        break;
      }
      case 'bossDefeat': {
        // Défaite boss - fanfare
        const notes = [523, 659, 784, 1047, 784, 1047];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = i < 4 ? 'square' : 'sawtooth';
          osc.frequency.setValueAtTime(freq, now + i * 0.1);
          gain.gain.setValueAtTime(volume * 0.25, now + i * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.1);
          osc.stop(now + i * 0.1 + 0.25);
        });
        break;
      }
      case 'bossHurtCry': {
        // Cri de douleur du boss - son grave et distordu
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const gain = ctx.createGain();
        const distortion = ctx.createWaveShaper();

        // Créer une courbe de distortion
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i / 128) - 1;
          curve[i] = Math.tanh(x * 3);
        }
        distortion.curve = curve;

        // Oscillateurs pour le cri
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(150, now);
        osc1.frequency.exponentialRampToValueAtTime(80, now + 0.3);

        osc2.type = 'square';
        osc2.frequency.setValueAtTime(120, now);
        osc2.frequency.exponentialRampToValueAtTime(60, now + 0.25);

        // Vibrato pour effet de tremblement
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(25, now);
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.setValueAtTime(20, now);
        osc3.connect(vibratoGain);
        vibratoGain.connect(osc1.frequency);

        gain.gain.setValueAtTime(volume * 0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc1.connect(distortion);
        osc2.connect(distortion);
        distortion.connect(gain).connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.35);
        osc2.start(now);
        osc2.stop(now + 0.35);
        osc3.start(now);
        osc3.stop(now + 0.35);
        break;
      }
      case 'bossDeathCry': {
        // Cri de mort du boss - long et dramatique
        const duration = 1.5;

        // Plusieurs couches de son pour un effet épique
        for (let layer = 0; layer < 3; layer++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = layer === 0 ? 'sawtooth' : (layer === 1 ? 'square' : 'triangle');

          // Descente dramatique de fréquence
          const baseFreq = 200 - layer * 40;
          osc.frequency.setValueAtTime(baseFreq, now + layer * 0.1);
          osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.3, now + duration);

          gain.gain.setValueAtTime(volume * (0.3 - layer * 0.05), now + layer * 0.1);
          gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.3);
          gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

          osc.connect(gain).connect(ctx.destination);
          osc.start(now + layer * 0.1);
          osc.stop(now + duration);
        }

        // Ajout d'un effet de "bruit" qui s'estompe
        const noise = ctx.createOscillator();
        const noiseGain = ctx.createGain();
        noise.type = 'sawtooth';
        noise.frequency.setValueAtTime(80, now);
        noise.frequency.setValueAtTime(40, now + 0.5);
        noise.frequency.setValueAtTime(20, now + 1.0);
        noiseGain.gain.setValueAtTime(volume * 0.15, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        noise.connect(noiseGain).connect(ctx.destination);
        noise.start(now);
        noise.stop(now + duration);

        // Réverbération simulée avec échos
        for (let echo = 1; echo <= 3; echo++) {
          const echoOsc = ctx.createOscillator();
          const echoGain = ctx.createGain();
          echoOsc.type = 'sine';
          echoOsc.frequency.setValueAtTime(100 / echo, now + echo * 0.2);
          echoOsc.frequency.exponentialRampToValueAtTime(30, now + duration + echo * 0.1);
          echoGain.gain.setValueAtTime(volume * (0.1 / echo), now + echo * 0.2);
          echoGain.gain.exponentialRampToValueAtTime(0.01, now + duration + echo * 0.1);
          echoOsc.connect(echoGain).connect(ctx.destination);
          echoOsc.start(now + echo * 0.2);
          echoOsc.stop(now + duration + echo * 0.1);
        }
        break;
      }
      case 'door': {
        // Porte - son de progression
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.linearRampToValueAtTime(660, now + 0.3);
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(165, now);
        osc2.frequency.linearRampToValueAtTime(330, now + 0.3);
        gain.gain.setValueAtTime(volume * 0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
        osc2.start(now);
        osc2.stop(now + 0.4);
        break;
      }
      case 'shoot': {
        // Tir ennemi - pew
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        gain.gain.setValueAtTime(volume * 0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'shieldBlock': {
        // Bouclier bloque - clang
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2000, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(40, now);
        gain.gain.setValueAtTime(volume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.connect(gain);
        osc2.connect(osc.frequency);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        osc2.start(now);
        osc2.stop(now + 0.15);
        break;
      }
      case 'laser': {
        // Laser Guardian - zap
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.3);
        gain.gain.setValueAtTime(volume * 0.2, now);
        gain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }
      case 'bossDash': {
        // Charge de boss - whoosh puissant avec grondement
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, now);
        filter.frequency.exponentialRampToValueAtTime(200, now + 0.4);

        // Grondement grave
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(80, now);
        osc1.frequency.exponentialRampToValueAtTime(40, now + 0.35);

        // Whoosh aigu
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(400, now);
        osc2.frequency.exponentialRampToValueAtTime(150, now + 0.3);

        // Sub bass impact
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(60, now);
        osc3.frequency.exponentialRampToValueAtTime(30, now + 0.4);

        gain.gain.setValueAtTime(volume * 0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc1.connect(filter);
        osc2.connect(filter);
        osc3.connect(gain);
        filter.connect(gain).connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.4);
        osc2.start(now);
        osc2.stop(now + 0.35);
        osc3.start(now);
        osc3.stop(now + 0.4);
        break;
      }
      case 'bossBullet': {
        // Tir de boss - son énergétique
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(800, now);
        osc2.frequency.exponentialRampToValueAtTime(200, now + 0.1);

        gain.gain.setValueAtTime(volume * 0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.12);
        osc2.start(now);
        osc2.stop(now + 0.12);
        break;
      }
      case 'bossCharge': {
        // Wind-up de charge - montée de tension
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(60, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.6);

        // Tremblement
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(15, now);
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.setValueAtTime(30, now);
        vibratoGain.gain.linearRampToValueAtTime(80, now + 0.6);
        osc2.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        gain.gain.setValueAtTime(volume * 0.15, now);
        gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.6);

        osc.connect(gain).connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.65);
        osc2.start(now);
        osc2.stop(now + 0.65);
        break;
      }
      case 'bossSlam': {
        // Impact au sol - boom dévastateur
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const noise = ctx.createOscillator();
        const gain = ctx.createGain();

        // Impact principal
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(100, now);
        osc1.frequency.exponentialRampToValueAtTime(20, now + 0.4);

        // Harmonique
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(50, now);
        osc2.frequency.exponentialRampToValueAtTime(15, now + 0.3);

        // Bruit d'impact
        noise.type = 'sawtooth';
        noise.frequency.setValueAtTime(30, now);

        gain.gain.setValueAtTime(volume * 0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc1.connect(gain);
        osc2.connect(gain);
        noise.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.4);
        osc2.start(now);
        osc2.stop(now + 0.35);
        noise.start(now);
        noise.stop(now + 0.15);
        break;
      }
      case 'bossRoar': {
        // Rugissement de boss - intimidant
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const gain = ctx.createGain();
        const distortion = ctx.createWaveShaper();

        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          const x = (i / 128) - 1;
          curve[i] = Math.tanh(x * 4);
        }
        distortion.curve = curve;

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(100, now);
        osc1.frequency.linearRampToValueAtTime(150, now + 0.15);
        osc1.frequency.exponentialRampToValueAtTime(60, now + 0.5);

        osc2.type = 'square';
        osc2.frequency.setValueAtTime(70, now);
        osc2.frequency.exponentialRampToValueAtTime(40, now + 0.5);

        // Vibrato intense
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(20, now);
        osc3.frequency.linearRampToValueAtTime(8, now + 0.5);
        const vibratoGain = ctx.createGain();
        vibratoGain.gain.setValueAtTime(25, now);
        osc3.connect(vibratoGain);
        vibratoGain.connect(osc1.frequency);

        gain.gain.setValueAtTime(volume * 0.45, now);
        gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);

        osc1.connect(distortion);
        osc2.connect(distortion);
        distortion.connect(gain).connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.55);
        osc2.start(now);
        osc2.stop(now + 0.55);
        osc3.start(now);
        osc3.stop(now + 0.55);
        break;
      }
      case 'bossWarning': {
        // Avertissement d'attaque - signal d'alarme court
        for (let i = 0; i < 2; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(600, now + i * 0.12);
          osc.frequency.setValueAtTime(400, now + i * 0.12 + 0.05);
          gain.gain.setValueAtTime(volume * 0.25, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.1);
        }
        break;
      }
    }
  }

  // ==========================================
  // SYSTÈME DE MUSIQUE - Procédural liminal
  // ==========================================
  initMusic() {
    this.musicNodes = [];
    this.musicIntervals = [];
    this.musicPlaying = false;
    this.musicMasterGain = null;
    this.musicVolume = 0.4;

    // Utiliser un stockage global pour persister la musique entre les niveaux
    if (!window.gameMusic) {
      window.gameMusic = {
        tracks: {},
        currentTrack: null,
        currentType: null,
        isPlaying: false
      };

      const musicFiles = {
        'level': 'music/bgm.mp3',
        'low': 'music/low.mp3', // Ambient calme après victoire boss
        'boss1': 'music/bgm_charger.mp3',
        'boss2': 'music/bgm_spinner.mp3',
        'boss3': 'music/bgm_splitter.mp3',
        'boss4': 'music/bgm_guardian.mp3',
        'boss5': 'music/bgm_summoner.mp3',
        'boss6': 'music/bgm_crusher.mp3',
        'boss7': 'music/bgm_phantom.mp3',
        'boss8': 'music/bgm_berserker.mp3',
        'boss9': 'music/bgm_architect.mp3',
        'boss10': 'music/bgm_twins.mp3'
      };

      // Charger toutes les pistes une seule fois
      Object.entries(musicFiles).forEach(([key, path]) => {
        const audio = new Audio(path);
        audio.loop = true;
        audio.volume = this.musicVolume;
        audio.preload = 'auto';
        window.gameMusic.tracks[key] = audio;
      });
    }

    // Référencer le stockage global
    this.musicTracks = window.gameMusic.tracks;
    this.currentTrack = window.gameMusic.currentTrack;
    this.currentMusicType = window.gameMusic.currentType;

    // Mettre à jour le volume si les pistes existent déjà
    Object.values(this.musicTracks).forEach(track => {
      track.volume = this.musicVolume;
    });
  }

  startLevelMusic() {
    // Vérifier si c'est un niveau boss
    const isBossLevel = this.currentLevel % 5 === 0;
    if (isBossLevel) return; // La musique de boss est gérée séparément

    this.playMusicTrack('level');
  }

  playMusicTrack(trackKey) {
    const globalMusic = window.gameMusic;
    const track = this.musicTracks[trackKey];
    if (!track) return;

    // SIMPLE: Si cette piste n'est PAS en pause, elle joue déjà - ne rien faire!
    if (!track.paused) {
      this.currentTrack = track;
      this.currentMusicType = trackKey;
      this.musicPlaying = true;
      globalMusic.currentTrack = track;
      globalMusic.currentType = trackKey;
      return;
    }

    // Arrêter l'ancienne piste si c'est une piste différente qui joue
    Object.entries(this.musicTracks).forEach(([key, otherTrack]) => {
      if (key !== trackKey && !otherTrack.paused) {
        this.fadeOutTrack(otherTrack, 500);
      }
    });

    // Jouer la nouvelle piste
    track.currentTime = 0;
    track.volume = 0;

    this.currentTrack = track;
    this.currentMusicType = trackKey;
    this.musicPlaying = true;

    globalMusic.currentTrack = track;
    globalMusic.currentType = trackKey;

    track.play().catch(e => {
      this.pendingMusic = trackKey;
    });
    this.fadeInTrack(track, 500);
  }

  fadeInTrack(track, duration) {
    const targetVolume = this.musicVolume;
    const steps = 20;
    const stepTime = duration / steps;
    const volumeStep = targetVolume / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      track.volume = Math.min(targetVolume, volumeStep * currentStep);
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
      }
    }, stepTime);
  }

  fadeOutTrack(track, duration, pauseAfter = true) {
    const startVolume = track.volume;
    const steps = 20;
    const stepTime = duration / steps;
    const volumeStep = startVolume / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      track.volume = Math.max(0, startVolume - volumeStep * currentStep);
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        if (pauseAfter) {
          track.pause();
          track.currentTime = 0;
        }
      }
    }, stepTime);
  }

  // Fondu croisé entre deux pistes
  crossfadeTo(newTrackKey, fadeOutDuration = 500, fadeInDuration = 500) {
    const newTrack = this.musicTracks[newTrackKey];
    if (!newTrack) return;

    // Fade out de la piste actuelle
    if (this.currentTrack && !this.currentTrack.paused) {
      this.fadeOutTrack(this.currentTrack, fadeOutDuration);
    }

    // Fade in de la nouvelle piste après un petit délai
    setTimeout(() => {
      newTrack.currentTime = 0;
      newTrack.volume = 0;
      this.currentTrack = newTrack;
      this.currentMusicType = newTrackKey;
      this.musicPlaying = true;

      if (window.gameMusic) {
        window.gameMusic.currentTrack = newTrack;
        window.gameMusic.currentType = newTrackKey;
      }

      newTrack.play().catch(e => {});
      this.fadeInTrack(newTrack, fadeInDuration);
    }, fadeOutDuration * 0.5); // Commence le fade in à mi-chemin
  }

  // Démarrer l'ambiance calme après victoire boss
  startPostBossAmbient() {
    this.isInPostBossAmbient = true;

    // Fade in lent de low.mp3
    const lowTrack = this.musicTracks['low'];
    if (!lowTrack) return;

    lowTrack.currentTime = 0;
    lowTrack.volume = 0;
    this.currentTrack = lowTrack;
    this.currentMusicType = 'low';
    this.musicPlaying = true;

    if (window.gameMusic) {
      window.gameMusic.currentTrack = lowTrack;
      window.gameMusic.currentType = 'low';
    }

    lowTrack.play().catch(e => {});

    // Fade in très lent (3 secondes)
    this.fadeInTrack(lowTrack, 3000);
  }

  // Transition de l'ambiance vers la musique normale (quand le joueur quitte l'arène)
  transitionToLevelMusic() {
    if (!this.isInPostBossAmbient) return;

    this.isInPostBossAmbient = false;

    // Fondu croisé: fade out rapide de low, fade in de level
    this.crossfadeTo('level', 800, 1000);
  }

  // Démarrer une piste INSTANTANÉMENT (sans fondu) - pour musique de boss
  playMusicInstant(trackKey) {
    const track = this.musicTracks[trackKey];
    if (!track) return;

    // Arrêter toutes les autres pistes instantanément
    Object.entries(this.musicTracks).forEach(([key, otherTrack]) => {
      if (key !== trackKey && !otherTrack.paused) {
        otherTrack.pause();
        otherTrack.currentTime = 0;
      }
    });

    // Jouer la nouvelle piste à plein volume immédiatement
    track.currentTime = 0;
    track.volume = this.musicVolume;
    this.currentTrack = track;
    this.currentMusicType = trackKey;
    this.musicPlaying = true;

    if (window.gameMusic) {
      window.gameMusic.currentTrack = track;
      window.gameMusic.currentType = trackKey;
    }

    track.play().catch(e => {
      this.pendingMusic = trackKey;
    });
  }

  // Arrêter la musique INSTANTANÉMENT (sans fondu) - pour fin de combat boss
  stopMusicInstant() {
    this.musicPlaying = false;
    this.pendingBossMusic = null;
    this.pendingMusic = null;

    // Arrêter la piste audio externe instantanément
    if (this.currentTrack) {
      this.currentTrack.pause();
      this.currentTrack.currentTime = 0;
      this.currentTrack = null;
    }

    this.currentMusicType = null;

    // Mettre à jour l'état global
    if (window.gameMusic) {
      window.gameMusic.currentTrack = null;
      window.gameMusic.currentType = null;
      window.gameMusic.isPlaying = false;
    }

    // Arrêter les éléments synthétiques (fallback)
    if (this.musicIntervals) {
      this.musicIntervals.forEach(interval => {
        try { clearInterval(interval); } catch (e) {}
      });
      this.musicIntervals = [];
    }
    if (this.musicNodes) {
      this.musicNodes.forEach(node => {
        try { if (node && node.stop) node.stop(0); } catch (e) {}
        try { if (node && node.disconnect) node.disconnect(); } catch (e) {}
      });
      this.musicNodes = [];
    }
    if (this.musicMasterGain) {
      try { this.musicMasterGain.disconnect(); } catch (e) {}
      this.musicMasterGain = null;
    }
  }

  stopMusic() {
    this.musicPlaying = false;
    this.pendingBossMusic = null;
    this.pendingMusic = null;

    // Arrêter la piste audio externe avec fade out
    if (this.currentTrack) {
      this.fadeOutTrack(this.currentTrack, 300);
      this.currentTrack = null;
    }

    this.currentMusicType = null;

    // Mettre à jour l'état global
    if (window.gameMusic) {
      window.gameMusic.currentTrack = null;
      window.gameMusic.currentType = null;
      window.gameMusic.isPlaying = false;
    }

    // Arrêter tous les intervals (fallback synthétique)
    if (this.musicIntervals && this.musicIntervals.length > 0) {
      this.musicIntervals.forEach(interval => {
        try { clearInterval(interval); } catch (e) {}
      });
      this.musicIntervals = [];
    }

    // Déconnecter et arrêter tous les nodes audio (fallback synthétique)
    if (this.musicNodes && this.musicNodes.length > 0) {
      this.musicNodes.forEach(node => {
        try {
          if (node && node.stop) node.stop(0);
        } catch (e) {}
        try {
          if (node && node.disconnect) node.disconnect();
        } catch (e) {}
      });
      this.musicNodes = [];
    }

    // Déconnecter le master gain
    if (this.musicMasterGain) {
      try { this.musicMasterGain.disconnect(); } catch (e) {}
      this.musicMasterGain = null;
    }
  }


  startBossMusic(bossType) {
    // Utiliser les fichiers audio externes - démarrage INSTANTANÉ (sans fondu)
    const trackKey = `boss${bossType}`;
    this.playMusicInstant(trackKey);
  }

  // CHARGER: Agressif, tempo rapide, beats durs
  createChargerMusic(ctx, master) {
    // Basse agressive pulsante
    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.setValueAtTime(55, ctx.currentTime);
    bassGain.gain.setValueAtTime(0.15, ctx.currentTime);
    bassOsc.connect(bassGain);
    bassGain.connect(master);
    bassOsc.start();
    this.musicNodes.push(bassOsc, bassGain);

    // Rythme de kick simulé
    const kickPattern = [1, 0, 0, 1, 1, 0, 1, 0];
    let kickIndex = 0;
    const kickInterval = setInterval(() => {
      if (!this.musicPlaying || !this.currentMusicType?.startsWith('boss1')) {
        clearInterval(kickInterval);
        return;
      }
      const now = ctx.currentTime;
      if (kickPattern[kickIndex % 8]) {
        const kick = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(150, now);
        kick.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        kickGain.gain.setValueAtTime(0.3, now);
        kickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        kick.connect(kickGain);
        kickGain.connect(master);
        kick.start(now);
        kick.stop(now + 0.15);
      }
      kickIndex++;
    }, 180); // Tempo rapide

    this.musicIntervals = [kickInterval];

    // Lead agressif
    const leadOsc = ctx.createOscillator();
    const leadGain = ctx.createGain();
    const leadFilter = ctx.createBiquadFilter();
    leadOsc.type = 'square';
    leadFilter.type = 'lowpass';
    leadFilter.frequency.setValueAtTime(1000, ctx.currentTime);
    leadGain.gain.setValueAtTime(0.08, ctx.currentTime);
    leadOsc.connect(leadFilter);
    leadFilter.connect(leadGain);
    leadGain.connect(master);
    leadOsc.start();
    this.musicNodes.push(leadOsc, leadGain, leadFilter);

    const chargerNotes = [110, 131, 110, 165, 110, 131, 146, 110];
    let noteIdx = 0;
    const noteInterval = setInterval(() => {
      if (!this.musicPlaying) return;
      leadOsc.frequency.setValueAtTime(chargerNotes[noteIdx % 8], ctx.currentTime);
      noteIdx++;
    }, 360);
    this.musicIntervals.push(noteInterval);
  }

  // SPINNER: Hypnotique, circulaire, tourbillonnant
  createSpinnerMusic(ctx, master) {
    // Arpège circulaire rapide
    const spinNotes = [220, 277, 330, 440, 554, 440, 330, 277];
    let spinIdx = 0;

    const spinOsc = ctx.createOscillator();
    const spinGain = ctx.createGain();
    const spinFilter = ctx.createBiquadFilter();
    spinOsc.type = 'sine';
    spinFilter.type = 'bandpass';
    spinFilter.frequency.setValueAtTime(800, ctx.currentTime);
    spinFilter.Q.setValueAtTime(5, ctx.currentTime);
    spinGain.gain.setValueAtTime(0.1, ctx.currentTime);
    spinOsc.connect(spinFilter);
    spinFilter.connect(spinGain);
    spinGain.connect(master);
    spinOsc.start();
    this.musicNodes.push(spinOsc, spinGain, spinFilter);

    const spinInterval = setInterval(() => {
      if (!this.musicPlaying || !this.currentMusicType?.startsWith('boss2')) {
        clearInterval(spinInterval);
        return;
      }
      spinOsc.frequency.setValueAtTime(spinNotes[spinIdx % 8], ctx.currentTime);
      spinIdx++;
    }, 120);

    this.musicIntervals = [spinInterval];

    // Pad tournoyant
    const padOsc = ctx.createOscillator();
    const padGain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    padOsc.type = 'triangle';
    padOsc.frequency.setValueAtTime(110, ctx.currentTime);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.5, ctx.currentTime);
    lfoGain.gain.setValueAtTime(30, ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(padOsc.frequency);
    padGain.gain.setValueAtTime(0.12, ctx.currentTime);
    padOsc.connect(padGain);
    padGain.connect(master);
    padOsc.start();
    lfo.start();
    this.musicNodes.push(padOsc, padGain, lfo, lfoGain);
  }

  // SPLITTER: Chaotique, fragmenté, dissonant
  createSplitterMusic(ctx, master) {
    // Notes chaotiques
    const chaosNotes = [110, 117, 123, 110, 139, 110, 147, 123];
    let chaosIdx = 0;

    const splitInterval = setInterval(() => {
      if (!this.musicPlaying || !this.currentMusicType?.startsWith('boss3')) {
        clearInterval(splitInterval);
        return;
      }
      const now = ctx.currentTime;

      // Note principale
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(chaosNotes[chaosIdx % 8], now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(master);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Fragment dissonant
      if (Math.random() < 0.4) {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(chaosNotes[(chaosIdx + 3) % 8] * 2, now + 0.05);
        gain2.gain.setValueAtTime(0.06, now + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc2.connect(gain2);
        gain2.connect(master);
        osc2.start(now + 0.05);
        osc2.stop(now + 0.15);
      }

      chaosIdx++;
    }, 280);

    this.musicIntervals = [splitInterval];

    // Drone instable
    const droneOsc = ctx.createOscillator();
    const droneGain = ctx.createGain();
    const droneLfo = ctx.createOscillator();
    const droneLfoGain = ctx.createGain();
    droneOsc.type = 'sawtooth';
    droneOsc.frequency.setValueAtTime(55, ctx.currentTime);
    droneLfo.type = 'square';
    droneLfo.frequency.setValueAtTime(4, ctx.currentTime);
    droneLfoGain.gain.setValueAtTime(5, ctx.currentTime);
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(droneOsc.frequency);
    droneGain.gain.setValueAtTime(0.08, ctx.currentTime);
    droneOsc.connect(droneGain);
    droneGain.connect(master);
    droneOsc.start();
    droneLfo.start();
    this.musicNodes.push(droneOsc, droneGain, droneLfo, droneLfoGain);
  }

  // GUARDIAN: Puissant, lourd, défensif
  createGuardianMusic(ctx, master) {
    // Basse massive
    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    const bassFilter = ctx.createBiquadFilter();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(41, ctx.currentTime); // Mi grave
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(100, ctx.currentTime);
    bassGain.gain.setValueAtTime(0.2, ctx.currentTime);
    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(master);
    bassOsc.start();
    this.musicNodes.push(bassOsc, bassGain, bassFilter);

    // Accord de puissance
    const powerNotes = [82.4, 123.5, 164.8]; // E2 power chord
    powerNotes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      this.musicNodes.push(osc, gain);
    });

    // Pulsation lente et lourde
    const pulseInterval = setInterval(() => {
      if (!this.musicPlaying || !this.currentMusicType?.startsWith('boss4')) {
        clearInterval(pulseInterval);
        return;
      }
      const now = ctx.currentTime;
      const pulse = ctx.createOscillator();
      const pulseGain = ctx.createGain();
      pulse.type = 'sine';
      pulse.frequency.setValueAtTime(82.4, now);
      pulse.frequency.exponentialRampToValueAtTime(41, now + 0.4);
      pulseGain.gain.setValueAtTime(0.2, now);
      pulseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      pulse.connect(pulseGain);
      pulseGain.connect(master);
      pulse.start(now);
      pulse.stop(now + 0.5);
    }, 800);

    this.musicIntervals = [pulseInterval];
  }

  // SUMMONER: Mystérieux, magique, montée en puissance
  createSummonerMusic(ctx, master) {
    // Mélodie mystérieuse
    const summonNotes = [220, 261, 293, 349, 293, 261, 220, 196];
    let summonIdx = 0;

    const summonOsc = ctx.createOscillator();
    const summonGain = ctx.createGain();
    const summonFilter = ctx.createBiquadFilter();
    const reverb = ctx.createConvolver();

    summonOsc.type = 'sine';
    summonFilter.type = 'lowpass';
    summonFilter.frequency.setValueAtTime(600, ctx.currentTime);
    summonGain.gain.setValueAtTime(0.1, ctx.currentTime);
    summonOsc.connect(summonFilter);
    summonFilter.connect(summonGain);
    summonGain.connect(master);
    summonOsc.start();
    this.musicNodes.push(summonOsc, summonGain, summonFilter);

    const summonInterval = setInterval(() => {
      if (!this.musicPlaying || !this.currentMusicType?.startsWith('boss5')) {
        clearInterval(summonInterval);
        return;
      }
      summonOsc.frequency.setValueAtTime(summonNotes[summonIdx % 8], ctx.currentTime);
      summonIdx++;
    }, 400);

    this.musicIntervals = [summonInterval];

    // Accords magiques en arrière-plan
    const magicOsc1 = ctx.createOscillator();
    const magicOsc2 = ctx.createOscillator();
    const magicGain = ctx.createGain();
    const magicLfo = ctx.createOscillator();
    const magicLfoGain = ctx.createGain();

    magicOsc1.type = 'sine';
    magicOsc1.frequency.setValueAtTime(110, ctx.currentTime);
    magicOsc2.type = 'sine';
    magicOsc2.frequency.setValueAtTime(138.6, ctx.currentTime); // Tierce
    magicLfo.type = 'sine';
    magicLfo.frequency.setValueAtTime(0.2, ctx.currentTime);
    magicLfoGain.gain.setValueAtTime(0.05, ctx.currentTime);
    magicLfo.connect(magicLfoGain);
    magicLfoGain.connect(magicGain.gain);
    magicGain.gain.setValueAtTime(0.08, ctx.currentTime);
    magicOsc1.connect(magicGain);
    magicOsc2.connect(magicGain);
    magicGain.connect(master);
    magicOsc1.start();
    magicOsc2.start();
    magicLfo.start();
    this.musicNodes.push(magicOsc1, magicOsc2, magicGain, magicLfo, magicLfoGain);

    // Sons de "convocation" périodiques
    const convokeInterval = setInterval(() => {
      if (!this.musicPlaying) return;
      const now = ctx.currentTime;
      const convoke = ctx.createOscillator();
      const convokeGain = ctx.createGain();
      convoke.type = 'triangle';
      convoke.frequency.setValueAtTime(880, now);
      convoke.frequency.exponentialRampToValueAtTime(220, now + 0.6);
      convokeGain.gain.setValueAtTime(0.06, now);
      convokeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      convoke.connect(convokeGain);
      convokeGain.connect(master);
      convoke.start(now);
      convoke.stop(now + 0.6);
    }, 3000);

    this.musicIntervals.push(convokeInterval);
  }

  // ==========================================
  // SYSTÈME DE PARTICULES
  // ==========================================
  initParticles() {
    this.particles = [];
    this.maxParticles = 200;
  }

  // Émettre des particules
  emitParticles(x, y, config = {}) {
    const {
      count = 5,
      color = 0xffffff,
      colors = null,       // Array de couleurs possibles
      minSpeed = 50,
      maxSpeed = 150,
      minSize = 2,
      maxSize = 6,
      life = 500,
      gravity = 0,
      spread = Math.PI * 2, // Angle de dispersion
      angle = 0,            // Direction centrale
      fadeOut = true,
      shrink = false,
      shape = 'circle'      // circle, square, star
    } = config;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        const oldest = this.particles.shift();
        if (oldest.sprite && oldest.sprite.active) oldest.sprite.destroy();
      }

      const particleColor = colors ? Phaser.Utils.Array.GetRandom(colors) : color;
      const size = Phaser.Math.Between(minSize, maxSize);
      const speed = Phaser.Math.Between(minSpeed, maxSpeed);
      const particleAngle = angle + (Math.random() - 0.5) * spread;

      let sprite;
      if (shape === 'circle') {
        sprite = this.add.circle(x, y, size, particleColor);
      } else if (shape === 'square') {
        sprite = this.add.rectangle(x, y, size * 2, size * 2, particleColor);
      } else if (shape === 'star') {
        const points = [];
        for (let j = 0; j < 5; j++) {
          const a = (j * Math.PI * 2 / 5) - Math.PI / 2;
          points.push(Math.cos(a) * size * 2, Math.sin(a) * size * 2);
          const b = a + Math.PI / 5;
          points.push(Math.cos(b) * size, Math.sin(b) * size);
        }
        sprite = this.add.polygon(x, y, points, particleColor);
      }

      sprite.setDepth(50);
      this.physics.add.existing(sprite);
      sprite.body.setAllowGravity(false);
      sprite.body.setVelocity(
        Math.cos(particleAngle) * speed,
        Math.sin(particleAngle) * speed + gravity * 0.1
      );

      const particle = {
        sprite,
        life,
        maxLife: life,
        gravity,
        fadeOut,
        shrink,
        initialSize: size
      };

      this.particles.push(particle);

      // Auto-destruction après durée de vie
      this.time.delayedCall(life, () => {
        if (sprite && sprite.active) sprite.destroy();
        const idx = this.particles.indexOf(particle);
        if (idx > -1) this.particles.splice(idx, 1);
      });
    }
  }

  // Mise à jour des particules (appelé dans update)
  updateParticles(delta) {
    this.particles.forEach(p => {
      if (!p.sprite || !p.sprite.active) return;

      p.life -= delta;
      const lifeRatio = p.life / p.maxLife;

      // Appliquer la gravité
      if (p.gravity && p.sprite.body) {
        p.sprite.body.velocity.y += p.gravity * delta / 1000;
      }

      // Fade out
      if (p.fadeOut) {
        p.sprite.setAlpha(lifeRatio);
      }

      // Shrink
      if (p.shrink) {
        p.sprite.setScale(lifeRatio);
      }
    });
  }

  // Effets de particules prédéfinis
  particleJump(x, y) {
    this.emitParticles(x, y + 20, {
      count: 6,
      colors: [0x00ff88, 0x88ffaa, 0xffffff],
      minSpeed: 30,
      maxSpeed: 80,
      minSize: 2,
      maxSize: 4,
      life: 300,
      spread: Math.PI / 2,
      angle: -Math.PI / 2,
      gravity: 200,
      fadeOut: true
    });
  }

  particleDoubleJump(x, y) {
    this.emitParticles(x, y, {
      count: 12,
      colors: [0x88cc44, 0xaaff66, 0xffffff],
      minSpeed: 60,
      maxSpeed: 120,
      minSize: 3,
      maxSize: 6,
      life: 400,
      spread: Math.PI * 2,
      gravity: -50,
      fadeOut: true,
      shrink: true
    });
  }

  particleWallJump(x, y, direction) {
    this.emitParticles(x, y, {
      count: 8,
      colors: [0x00ccaa, 0x66ffcc, 0xffffff],
      minSpeed: 50,
      maxSpeed: 100,
      minSize: 2,
      maxSize: 5,
      life: 350,
      spread: Math.PI / 3,
      angle: direction > 0 ? 0 : Math.PI,
      gravity: 100,
      fadeOut: true
    });
  }

  particleLand(x, y) {
    this.emitParticles(x, y + 20, {
      count: 8,
      color: 0x888888,
      minSpeed: 20,
      maxSpeed: 60,
      minSize: 2,
      maxSize: 4,
      life: 250,
      spread: Math.PI,
      angle: -Math.PI / 2,
      gravity: 300,
      fadeOut: true
    });
  }

  particleHurt(x, y) {
    this.emitParticles(x, y, {
      count: 15,
      colors: [0xff0000, 0xff4444, 0xff8888],
      minSpeed: 80,
      maxSpeed: 180,
      minSize: 3,
      maxSize: 7,
      life: 400,
      spread: Math.PI * 2,
      gravity: 200,
      fadeOut: true,
      shrink: true
    });
  }

  particleDeath(x, y) {
    this.emitParticles(x, y, {
      count: 30,
      colors: [0xff0000, 0xff4444, 0x00ff88, 0xffffff],
      minSpeed: 100,
      maxSpeed: 250,
      minSize: 4,
      maxSize: 10,
      life: 600,
      spread: Math.PI * 2,
      gravity: 300,
      fadeOut: true,
      shrink: true
    });
  }

  particleCoin(x, y) {
    // === EFFET PIÈCE - Sobre et efficace ===

    // Flash lumineux subtil
    this.emitParticles(x, y, {
      count: 1,
      colors: [0xffd700],
      minSpeed: 0,
      maxSpeed: 0,
      minSize: 20,
      maxSize: 25,
      life: 120,
      fadeOut: true,
      shape: 'circle'
    });

    // Particules dorées qui s'élèvent
    this.emitParticles(x, y, {
      count: 6,
      colors: [0xffd700, 0xffaa00],
      minSpeed: 40,
      maxSpeed: 80,
      minSize: 2,
      maxSize: 4,
      life: 300,
      spread: Math.PI * 0.5,
      angle: -Math.PI / 2,
      gravity: -50,
      fadeOut: true
    });

    // Quelques étincelles
    this.emitParticles(x, y, {
      count: 4,
      colors: [0xffffcc, 0xffffff],
      minSpeed: 20,
      maxSpeed: 50,
      minSize: 1,
      maxSize: 2,
      life: 250,
      spread: Math.PI * 2,
      fadeOut: true
    });
  }

  particleKey(x, y) {
    // === EFFET CLÉ - Sobre et satisfaisant ===

    // Flash lumineux doré
    this.emitParticles(x, y, {
      count: 1,
      colors: [0xffd700],
      minSpeed: 0,
      maxSpeed: 0,
      minSize: 35,
      maxSize: 40,
      life: 180,
      fadeOut: true,
      shape: 'circle'
    });

    // Rayons qui partent du centre
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 / 6) * i;
      this.emitParticles(x, y, {
        count: 2,
        colors: [0xffd700, 0xffaa00],
        minSpeed: 60,
        maxSpeed: 120,
        minSize: 3,
        maxSize: 5,
        life: 300,
        spread: 0.1,
        angle: angle,
        fadeOut: true
      });
    }

    // Particules dorées montantes
    this.emitParticles(x, y, {
      count: 10,
      colors: [0xffd700, 0xffcc00, 0xffffff],
      minSpeed: 50,
      maxSpeed: 100,
      minSize: 2,
      maxSize: 5,
      life: 400,
      spread: Math.PI * 0.6,
      angle: -Math.PI / 2,
      gravity: -60,
      fadeOut: true
    });
  }

  particleHeart(x, y) {
    this.emitParticles(x, y, {
      count: 15,
      colors: [0xff6b9d, 0xff88aa, 0xffaacc, 0xffffff],
      minSpeed: 50,
      maxSpeed: 120,
      minSize: 3,
      maxSize: 8,
      life: 500,
      spread: Math.PI * 2,
      gravity: -200,
      fadeOut: true
    });
  }

  particleDoorUnlock(x, y) {
    // Effet spectaculaire d'ouverture de porte - particules qui montent
    this.emitParticles(x, y - 50, {
      count: 30,
      colors: [0x00ff88, 0x00ffaa, 0x88ffcc, 0xffffff],
      minSpeed: 80,
      maxSpeed: 200,
      minSize: 4,
      maxSize: 10,
      life: 800,
      spread: Math.PI * 0.8,
      baseAngle: -Math.PI / 2, // Vers le haut
      gravity: -100,
      fadeOut: true,
      shrink: true,
      shape: 'star'
    });
    // Deuxième vague - particules latérales
    this.emitParticles(x, y - 30, {
      count: 20,
      colors: [0x00ff88, 0xffffff],
      minSpeed: 40,
      maxSpeed: 100,
      minSize: 2,
      maxSize: 6,
      life: 600,
      spread: Math.PI,
      baseAngle: 0,
      gravity: 50,
      fadeOut: true
    });
  }

  particleEnemyDeath(x, y, color = 0xff4444) {
    this.emitParticles(x, y, {
      count: 12,
      colors: [color, 0xffffff, 0x888888],
      minSpeed: 60,
      maxSpeed: 140,
      minSize: 3,
      maxSize: 7,
      life: 400,
      spread: Math.PI * 2,
      gravity: 200,
      fadeOut: true,
      shape: 'square'
    });
  }

  particleBossHit(x, y, bossColor) {
    this.emitParticles(x, y, {
      count: 20,
      colors: [bossColor, 0xffffff, 0xffff00],
      minSpeed: 80,
      maxSpeed: 200,
      minSize: 4,
      maxSize: 10,
      life: 500,
      spread: Math.PI * 2,
      gravity: 100,
      fadeOut: true,
      shrink: true
    });
  }

  particleBossDefeat(x, y, bossColor) {
    // Explosion massive
    for (let wave = 0; wave < 3; wave++) {
      this.time.delayedCall(wave * 150, () => {
        this.emitParticles(x, y, {
          count: 25,
          colors: [bossColor, 0xffffff, 0xffff00, 0xff0000],
          minSpeed: 100 + wave * 50,
          maxSpeed: 250 + wave * 50,
          minSize: 5 + wave * 2,
          maxSize: 15 + wave * 3,
          life: 700,
          spread: Math.PI * 2,
          gravity: 50,
          fadeOut: true,
          shrink: true
        });
      });
    }
  }

  particleShoot(x, y) {
    this.emitParticles(x, y, {
      count: 4,
      colors: [0xffee00, 0xff8800, 0xffffff],
      minSpeed: 30,
      maxSpeed: 60,
      minSize: 2,
      maxSize: 4,
      life: 200,
      spread: Math.PI,
      gravity: 0,
      fadeOut: true
    });
  }

  particleWallSlide(x, y) {
    this.emitParticles(x, y, {
      count: 2,
      color: 0xaaaaaa,
      minSpeed: 10,
      maxSpeed: 30,
      minSize: 1,
      maxSize: 3,
      life: 200,
      spread: Math.PI / 4,
      angle: Math.PI / 2,
      gravity: 50,
      fadeOut: true
    });
  }

  createUI() {
    const uiDepth = 100; // Toujours au-dessus du jeu
    const textStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      fill: '#ffffff',
      shadow: { offsetX: 1, offsetY: 1, color: '#000000', blur: 2, fill: true }
    };

    // Dimensions du viewport (compact)
    const vw = 960;
    const vh = 540;
    const padding = 16;

    // === ZONE GAUCHE : Stats joueur ===
    const leftPanel = this.add.rectangle(padding, padding, 100, 40, 0x000000, 0.6)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(uiDepth);
    leftPanel.setStrokeStyle(1, 0x333333);

    this.scoreText = this.add.text(padding + 8, padding + 6, this.score.toString().padStart(6, '0'), {
      ...textStyle, fontSize: '16px', fill: '#ffd700'
    }).setScrollFactor(0).setDepth(uiDepth + 1);
    this.add.text(padding + 8, padding + 26, 'SCORE', { ...textStyle, fontSize: '8px', fill: '#555555' })
      .setScrollFactor(0).setDepth(uiDepth + 1);

    // Clé - icône stylisée
    this.keyIconBg = this.add.circle(padding + 88, padding + 20, 12, 0x000000, 0.5)
      .setScrollFactor(0).setDepth(uiDepth + 1);
    this.keyIconBg.setStrokeStyle(1, 0x444444);
    this.keyIcon = this.add.circle(padding + 88, padding + 20, 6, 0x555555)
      .setScrollFactor(0).setDepth(uiDepth + 2);
    this.keyIconStem = this.add.rectangle(padding + 88, padding + 28, 3, 8, 0x555555)
      .setScrollFactor(0).setDepth(uiDepth + 2);

    // === ZONE CENTRE-HAUT : Vies uniquement ===
    const isBossLevel = this.currentLevel % 5 === 0;
    const centerX = vw / 2;

    // Le nom du niveau est affiché dans l'intro, pas besoin de le garder en permanence
    // Vies - affichage moderne avec icônes
    this.healthContainer = this.add.container(centerX, padding + 16).setScrollFactor(0).setDepth(uiDepth + 1);
    this.updateHealthDisplay();

    // === ZONE DROITE : Timers ===
    const rightX = vw - padding;
    const rightPanel = this.add.rectangle(rightX, padding, 80, 44, 0x000000, 0.6)
      .setOrigin(1, 0).setScrollFactor(0).setDepth(uiDepth);
    rightPanel.setStrokeStyle(1, 0x333333);

    this.timerText = this.add.text(rightX - 8, padding + 5, '0.00', {
      ...textStyle, fontSize: '14px', fill: '#ffffff', fontFamily: 'Courier New, monospace'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(uiDepth + 1);

    const bestTime = this.bestTimes[this.currentLevel];
    this.bestTimeText = this.add.text(rightX - 8, padding + 22, bestTime ? this.formatTime(bestTime) : '--', {
      ...textStyle, fontSize: '10px', fill: '#ffd700', fontFamily: 'Courier New, monospace'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(uiDepth + 1);
    this.add.text(rightX - 68, padding + 22, 'PB', { ...textStyle, fontSize: '8px', fill: '#555555' })
      .setScrollFactor(0).setDepth(uiDepth + 1);

    this.deltaText = this.add.text(rightX - 8, padding + 34, '', {
      ...textStyle, fontSize: '9px', fill: '#888888', fontFamily: 'Courier New, monospace'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(uiDepth + 1);

    // Timer total (discret, en bas à droite)
    this.totalTimeText = this.add.text(rightX, vh - padding, `RUN ${this.formatTime(this.totalTime)}`, {
      ...textStyle, fontSize: '10px', fill: '#555555'
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(uiDepth + 1);

    // Contrôles (très discret, en bas à gauche)
    this.add.text(padding, vh - padding, 'ZQSD + ESPACE | R = Reset', {
      ...textStyle, fontSize: '9px', fill: '#444444'
    }).setOrigin(0, 1).setScrollFactor(0).setDepth(uiDepth + 1);

    // === EFFETS VISUELS POST-PROCESS ===
    this.setupVisualEffects();
  }

  // ==========================================
  // EFFETS VISUELS (Vignette + Aberration Chromatique)
  // ==========================================
  setupVisualEffects() {
    const vw = 960;
    const vh = 540;
    const effectDepth = 95; // Juste sous l'UI

    // === VIGNETTE ===
    // Créer une vignette avec un graphics object (gradient radial simulé)
    this.vignetteGraphics = this.add.graphics();
    this.vignetteGraphics.setScrollFactor(0);
    this.vignetteGraphics.setDepth(effectDepth);
    this.vignetteAlpha = 0;
    this.vignetteTargetAlpha = 0;
    this.vignetteColor = 0x000000;

    // Dessiner la vignette (anneaux concentriques)
    this.drawVignette(0);

    // === ABERRATION CHROMATIQUE ===
    // Overlays colorés décalés (rouge et cyan)
    this.chromaRed = this.add.rectangle(vw / 2, vh / 2, vw + 20, vh + 20, 0xff0000, 0);
    this.chromaRed.setScrollFactor(0);
    this.chromaRed.setDepth(effectDepth - 1);
    this.chromaRed.setBlendMode(Phaser.BlendModes.ADD);

    this.chromaCyan = this.add.rectangle(vw / 2, vh / 2, vw + 20, vh + 20, 0x00ffff, 0);
    this.chromaCyan.setScrollFactor(0);
    this.chromaCyan.setDepth(effectDepth - 1);
    this.chromaCyan.setBlendMode(Phaser.BlendModes.ADD);

    this.chromaIntensity = 0;
    this.chromaOffset = 0;
  }

  drawVignette(intensity) {
    const vw = 960;
    const vh = 540;
    const cx = vw / 2;
    const cy = vh / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);

    this.vignetteGraphics.clear();

    if (intensity <= 0) return;

    // Dessiner des anneaux concentriques pour simuler un gradient radial
    const numRings = 15;
    for (let i = numRings; i >= 0; i--) {
      const ratio = i / numRings;
      const radius = maxRadius * (0.4 + ratio * 0.6); // Commence à 40% du rayon
      const alpha = (1 - ratio) * intensity * 0.8; // Plus opaque vers les bords

      if (alpha > 0.01) {
        this.vignetteGraphics.fillStyle(this.vignetteColor, alpha);
        this.vignetteGraphics.fillRect(0, 0, vw, vh);

        // Découper un cercle au centre (simuler vignette)
        this.vignetteGraphics.fillStyle(0x000000, 0);
        // On ne peut pas vraiment faire un "trou", donc on superpose des rectangles opaques sur les bords
      }
    }

    // Approche simplifiée: dessiner des bords sombres
    this.vignetteGraphics.clear();
    const gradient = 20;
    for (let i = 0; i < gradient; i++) {
      const alpha = (i / gradient) * intensity * 0.6;
      const offset = i * 8;

      this.vignetteGraphics.fillStyle(this.vignetteColor, alpha);
      // Bord gauche
      this.vignetteGraphics.fillRect(0, 0, offset, vh);
      // Bord droit
      this.vignetteGraphics.fillRect(vw - offset, 0, offset, vh);
      // Bord haut
      this.vignetteGraphics.fillRect(0, 0, vw, offset);
      // Bord bas
      this.vignetteGraphics.fillRect(0, vh - offset, vw, offset);
    }

    // Coins plus sombres
    const cornerSize = 150 * intensity;
    const cornerAlpha = intensity * 0.4;
    this.vignetteGraphics.fillStyle(this.vignetteColor, cornerAlpha);
    this.vignetteGraphics.fillTriangle(0, 0, cornerSize, 0, 0, cornerSize);
    this.vignetteGraphics.fillTriangle(vw, 0, vw - cornerSize, 0, vw, cornerSize);
    this.vignetteGraphics.fillTriangle(0, vh, cornerSize, vh, 0, vh - cornerSize);
    this.vignetteGraphics.fillTriangle(vw, vh, vw - cornerSize, vh, vw, vh - cornerSize);
  }

  // Effet de vignette (utilisé avec parcimonie)
  pulseVignette(intensity = 0.5, duration = 300, color = 0x000000) {
    this.vignetteColor = color;
    this.drawVignette(intensity);

    // Fade out progressif
    this.tweens.add({
      targets: this,
      vignetteAlpha: { from: intensity, to: 0 },
      duration: duration,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.drawVignette(this.vignetteAlpha);
      }
    });
  }

  // Vignette persistante (pour santé basse)
  setVignettePersistent(intensity, color = 0x000000) {
    this.vignetteColor = color;
    this.vignetteTargetAlpha = intensity;
  }

  // Aberration chromatique (utilisée avec parcimonie)
  pulseChromatic(intensity = 0.15, offsetPixels = 4, duration = 200) {
    if (this.chromaTween) this.chromaTween.stop();

    const vw = 960;
    const vh = 540;

    // Décaler les overlays
    this.chromaRed.setPosition(vw / 2 - offsetPixels, vh / 2);
    this.chromaCyan.setPosition(vw / 2 + offsetPixels, vh / 2);
    this.chromaRed.setAlpha(intensity);
    this.chromaCyan.setAlpha(intensity);

    // Fade out
    this.chromaTween = this.tweens.add({
      targets: [this.chromaRed, this.chromaCyan],
      alpha: 0,
      duration: duration,
      ease: 'Quad.easeOut'
    });
  }

  // Effet combiné pour les dégâts
  damageVisualEffect() {
    // Vignette rouge
    this.pulseVignette(0.4, 400, 0x330000);
    // Légère aberration chromatique
    this.pulseChromatic(0.08, 3, 250);
  }

  // Effet pour les coups sur le boss
  bossHitVisualEffect() {
    // Légère aberration chromatique seulement
    this.pulseChromatic(0.06, 2, 150);
  }

  // Effet pour la mort du boss
  bossDeathVisualEffect() {
    // Vignette blanche dramatique
    this.pulseVignette(0.6, 2000, 0x000000);
    // Forte aberration chromatique
    this.pulseChromatic(0.2, 6, 800);
  }

  // Mise à jour des effets visuels (appelée dans update)
  updateVisualEffects(delta) {
    // Vignette persistante pour santé basse
    const healthPercent = this.playerHealth / (this.maxHealth * 4);
    if (healthPercent <= 0.25 && healthPercent > 0) {
      // Pulsation de vignette rouge quand vie basse
      const pulse = Math.sin(this.time.now / 500) * 0.1 + 0.3;
      this.setVignettePersistent(pulse * (1 - healthPercent * 4), 0x220000);
    } else {
      this.setVignettePersistent(0);
    }

    // Interpoler vers la vignette cible
    if (Math.abs(this.vignetteAlpha - this.vignetteTargetAlpha) > 0.01) {
      this.vignetteAlpha += (this.vignetteTargetAlpha - this.vignetteAlpha) * 0.1;
      this.drawVignette(this.vignetteAlpha);
    }
  }

  createKeySprite(x, y, skipAnimation = false) {
    // Sprite de clé (16x28 scalé x2)
    const keySprite = this.add.sprite(x, y, 'key');
    keySprite.setScale(2); // 16x28 -> 32x56

    // Animation de flottement (seulement si pas skipAnimation)
    if (!skipAnimation) {
      this.tweens.add({
        targets: keySprite,
        y: y - 8,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      // Rotation légère
      this.tweens.add({
        targets: keySprite,
        angle: { from: -5, to: 5 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    return keySprite;
  }

  updateHealthDisplay() {
    const oldHealth = this.previousHealth || this.playerHealth;
    this.previousHealth = this.playerHealth;
    const healthChanged = oldHealth !== this.playerHealth;
    const tookDamage = this.playerHealth < oldHealth;
    const healed = this.playerHealth > oldHealth;

    this.healthContainer.removeAll(true);
    const spacing = 36; // 16x16 sprite scaled x2 = 32px + 4px gap
    const totalWidth = this.maxHealth * spacing;
    const startX = -totalWidth / 2 + spacing / 2;

    // Stocker les sprites pour les animations
    this.heartSprites = [];

    for (let i = 0; i < this.maxHealth; i++) {
      // Calculer combien de HP ce coeur contient (0-4)
      const heartHp = Math.max(0, Math.min(4, this.playerHealth - i * 4));

      // Choisir le sprite selon les HP
      let spriteKey;
      if (heartHp >= 4) {
        spriteKey = 'heart_full';
      } else if (heartHp === 3) {
        spriteKey = 'heart_3';
      } else if (heartHp === 2) {
        spriteKey = 'heart_demi';
      } else if (heartHp === 1) {
        spriteKey = 'heart_1';
      } else {
        spriteKey = 'heart_full'; // Vide = full avec tint gris
      }

      const heart = this.add.sprite(startX + i * spacing, 0, spriteKey);
      heart.setScale(2);
      heart.setOrigin(0.5);
      this.heartSprites.push(heart);

      if (heartHp === 0) {
        // Coeur vide - gris foncé
        heart.setTint(0x333333);
      } else if (heartHp === 4) {
        // Coeur plein - effet de pulsation
        this.tweens.add({
          targets: heart,
          scale: 2.2,
          duration: 500 + i * 100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }

      // Animation de transition
      if (healthChanged) {
        const oldHeartHp = Math.max(0, Math.min(4, oldHealth - i * 4));
        const heartChanged = oldHeartHp !== heartHp;

        if (heartChanged) {
          if (tookDamage && heartHp < oldHeartHp) {
            // Animation de dégâts - shake et flash rouge
            heart.setTint(0xff0000);
            this.tweens.add({
              targets: heart,
              x: heart.x + 3,
              duration: 30,
              yoyo: true,
              repeat: 5,
              onComplete: () => {
                if (heartHp === 0) {
                  heart.setTint(0x333333);
                } else {
                  heart.clearTint();
                }
              }
            });
          } else if (healed && heartHp > oldHeartHp) {
            // Animation de soin - scale up avec flash vert
            heart.setTint(0x00ff00);
            heart.setScale(0.5);
            this.tweens.add({
              targets: heart,
              scale: 2,
              duration: 200,
              ease: 'Back.easeOut',
              onComplete: () => {
                heart.clearTint();
              }
            });
          }
        }
      }

      this.healthContainer.add(heart);
    }
  }

  createParallaxBackground() {
    const isBossLevel = this.currentLevel % 5 === 0;

    if (isBossLevel) {
      this.createBossBackground();
      return;
    }

    // CITY BACKGROUND pour niveaux normaux - Simple et épuré
    this.cameras.main.setBackgroundColor(0x0a0a18);
    const W = this.WORLD.width;
    const H = this.WORLD.height;
    const gy = this.WORLD.groundY;

    // Étoiles avec plusieurs layers de parallax (moins fort)
    this.stars = [];

    // Layer 1 - Étoiles lointaines (presque pas de parallax)
    for (let i = 0; i < 50; i++) {
      const star = this.add.circle(
        this.rng.between(0, W),
        this.rng.between(0, 300),
        1,
        0xffffff,
        this.rng.realInRange(0.2, 0.5)
      );
      star.baseX = star.x;
      star.baseY = star.y;
      star.parallaxStrength = 2; // Très faible parallax
      star.setDepth(-12);
      this.stars.push(star);
    }

    // Layer 2 - Étoiles moyennes
    for (let i = 0; i < 35; i++) {
      const star = this.add.circle(
        this.rng.between(0, W),
        this.rng.between(0, 280),
        this.rng.between(1, 2),
        0xffffff,
        this.rng.realInRange(0.3, 0.7)
      );
      star.baseX = star.x;
      star.baseY = star.y;
      star.parallaxStrength = 5; // Faible parallax
      star.setDepth(-11);
      this.stars.push(star);
    }

    // Layer 3 - Quelques étoiles brillantes
    for (let i = 0; i < 18; i++) {
      const star = this.add.circle(
        this.rng.between(0, W),
        this.rng.between(0, 250),
        2,
        0xffffff,
        this.rng.realInRange(0.5, 0.9)
      );
      star.baseX = star.x;
      star.baseY = star.y;
      star.parallaxStrength = 8; // Léger parallax
      star.setDepth(-10);
      this.stars.push(star);
    }

    // SKYLINE - Dégradé simple d'immeubles (3 couches)

    // Couche 3 (plus loin) - silhouettes très sombres
    for (let x = -50; x < W + 50; x += this.rng.between(40, 70)) {
      const h = this.rng.between(200, 380);
      const ww = this.rng.between(30, 60);
      const building = this.add.rectangle(x, gy - h/2, ww, h, 0x06060c);
      building.setDepth(-8);
    }

    // Couche 2 (milieu) - silhouettes sombres
    for (let x = -30; x < W + 30; x += this.rng.between(50, 90)) {
      const h = this.rng.between(160, 300);
      const ww = this.rng.between(35, 65);
      const building = this.add.rectangle(x, gy - h/2, ww, h, 0x0c0c16);
      building.setDepth(-7);
    }

    // Couche 1 (devant) - silhouettes
    for (let x = 0; x < W; x += this.rng.between(60, 110)) {
      const h = this.rng.between(120, 220);
      const ww = this.rng.between(45, 80);
      const building = this.add.rectangle(x, gy - h/2, ww, h, 0x14141f);
      building.setDepth(-6);
    }
  }

  createBossBackground() {
    const bossNum = Math.floor(this.currentLevel / 5);
    const bossType = ((bossNum - 1) % 5) + 1;
    const W = this.WORLD.width;
    const H = this.WORLD.height;
    const cx = W / 2;
    const gy = this.WORLD.groundY;

    this.stars = [];

    switch (bossType) {
      case 1: // CHARGER - Arène de combat volcanique
        this.cameras.main.setBackgroundColor(0x1a0000);
        // Lave en arrière-plan
        for (let i = 0; i < 8; i++) {
          const lavaPool = this.add.ellipse(
            this.rng.between(100, W - 100),
            this.rng.between(gy - 300, gy - 100),
            this.rng.between(100, 200),
            this.rng.between(40, 70),
            0xff4400, 0.4
          );
          lavaPool.setDepth(-5);
          this.tweens.add({
            targets: lavaPool,
            scaleX: 1.1, scaleY: 0.9,
            alpha: 0.6,
            duration: 1500 + i * 200,
            yoyo: true,
            repeat: -1
          });
        }
        // Roches
        for (let i = 0; i < 12; i++) {
          const rock = this.add.polygon(
            this.rng.between(50, W - 50),
            this.rng.between(gy - 400, gy - 50),
            [0, -20, 15, 0, 10, 20, -10, 15, -15, -5],
            0x2a1a1a
          );
          rock.setDepth(-4);
        }
        break;

      case 2: // SPINNER - Dimension cosmique
        this.cameras.main.setBackgroundColor(0x000515);
        // Nébuleuse
        for (let i = 0; i < 5; i++) {
          const nebula = this.add.ellipse(
            this.rng.between(100, W - 100),
            this.rng.between(100, gy - 300),
            this.rng.between(250, 500),
            this.rng.between(150, 300),
            0x00aaaa, 0.1
          );
          nebula.setDepth(-8);
        }
        // Étoiles
        for (let i = 0; i < 120; i++) {
          const star = this.add.circle(
            this.rng.between(0, W),
            this.rng.between(0, H),
            this.rng.between(1, 3),
            0xffffff,
            this.rng.realInRange(0.3, 1)
          );
          star.baseX = star.x;
          star.baseY = star.y;
          star.depth = this.rng.realInRange(0.3, 1);
          star.setDepth(-7);
          this.stars.push(star);
        }
        // Anneaux orbitaux
        for (let i = 0; i < 3; i++) {
          const ring = this.add.ellipse(cx, gy - 400, 400 + i * 100, 200 + i * 50, 0x00ffff, 0);
          ring.setStrokeStyle(1, 0x00ffff, 0.2);
          ring.setDepth(-6);
          ring.setRotation(i * 0.3);
        }
        break;

      case 3: // SPLITTER - Marécage toxique
        this.cameras.main.setBackgroundColor(0x0a1a0a);
        // Mare toxique
        for (let i = 0; i < 6; i++) {
          const pool = this.add.ellipse(
            this.rng.between(100, W - 100),
            this.rng.between(gy - 300, gy - 100),
            this.rng.between(120, 250),
            this.rng.between(50, 90),
            0x88aa00, 0.3
          );
          pool.setDepth(-5);
          // Bulles
          this.time.addEvent({
            delay: 800 + i * 300,
            loop: true,
            callback: () => {
              if (pool.active) {
                this.emitParticles(pool.x + this.rng.between(-30, 30), pool.y, {
                  count: 1,
                  color: 0xaacc00,
                  minSpeed: 20,
                  maxSpeed: 40,
                  minSize: 3,
                  maxSize: 8,
                  life: 600,
                  angle: -Math.PI / 2,
                  spread: 0.3,
                  fadeOut: true
                });
              }
            }
          });
        }
        // Arbres morts
        for (let i = 0; i < 10; i++) {
          const tree = this.add.polygon(
            this.rng.between(50, W - 50),
            this.rng.between(gy - 450, gy - 150),
            [0, -60, 5, -40, 15, -30, 5, -20, 10, 0, -10, 0, -5, -20, -15, -35, -5, -45],
            0x2a2a1a
          );
          tree.setDepth(-4);
        }
        break;

      case 4: // GUARDIAN - Forteresse cybernétique
        this.cameras.main.setBackgroundColor(0x000a15);
        // Grille de données
        for (let x = 0; x < W; x += 60) {
          const line = this.add.rectangle(x, H / 2, 1, H, 0x003366, 0.3);
          line.setDepth(-6);
        }
        for (let y = 0; y < H; y += 60) {
          const line = this.add.rectangle(cx, y, W, 1, 0x003366, 0.3);
          line.setDepth(-6);
        }
        // Circuits lumineux
        for (let i = 0; i < 8; i++) {
          const circuit = this.add.rectangle(
            this.rng.between(100, W - 100),
            this.rng.between(100, gy - 200),
            this.rng.between(150, 300),
            3,
            0x00ccff, 0.4
          );
          circuit.setDepth(-5);
          this.tweens.add({
            targets: circuit,
            alpha: 0.1,
            duration: 1000 + i * 200,
            yoyo: true,
            repeat: -1
          });
        }
        // Hexagones tech
        for (let i = 0; i < 6; i++) {
          const hex = this.add.polygon(
            this.rng.between(100, W - 100),
            this.rng.between(100, gy - 300),
            [30, 0, 15, 26, -15, 26, -30, 0, -15, -26, 15, -26],
            0x003344, 0
          );
          hex.setStrokeStyle(2, 0x0099ff, 0.3);
          hex.setDepth(-5);
        }
        break;

      case 5: // SUMMONER - Dimension démoniaque
        this.cameras.main.setBackgroundColor(0x0a0010);
        // Portails
        for (let i = 0; i < 5; i++) {
          const portal = this.add.ellipse(
            this.rng.between(150, W - 150),
            this.rng.between(150, gy - 300),
            80 + i * 25,
            100 + i * 30,
            0x660066, 0.2
          );
          portal.setStrokeStyle(2, 0xff00ff, 0.4);
          portal.setDepth(-5);
          this.tweens.add({
            targets: portal,
            scaleX: 1.2, scaleY: 0.8,
            alpha: 0.4,
            duration: 2000 + i * 300,
            yoyo: true,
            repeat: -1
          });
        }
        // Runes flottantes
        for (let i = 0; i < 12; i++) {
          const rune = this.add.star(
            this.rng.between(50, W - 50),
            this.rng.between(100, gy - 200),
            5, 5, 12, 0xff00ff, 0.3
          );
          rune.setDepth(-4);
          this.tweens.add({
            targets: rune,
            y: rune.y - 20,
            rotation: Math.PI * 2,
            duration: 3000 + i * 500,
            yoyo: true,
            repeat: -1
          });
        }
        // Étoiles sombres
        for (let i = 0; i < 50; i++) {
          const star = this.add.circle(
            this.rng.between(0, W),
            this.rng.between(0, H),
            this.rng.between(1, 2),
            0xaa66aa,
            this.rng.realInRange(0.2, 0.5)
          );
          star.baseX = star.x;
          star.baseY = star.y;
          star.depth = this.rng.realInRange(0.3, 1);
          star.setDepth(-7);
          this.stars.push(star);
        }
        break;
    }
  }

  generateLevel() {
    const width = this.WORLD.width;
    const height = this.WORLD.height;
    const groundY = this.WORLD.groundY;
    const isBossLevel = this.currentLevel % 5 === 0;

    // Groupes
    this.platforms = this.physics.add.staticGroup();
    this.walls = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.shooters = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.coins = this.physics.add.group();
    this.deathZones = this.physics.add.staticGroup();
    this.groundHoles = [];

    // BOSS LEVEL : Arène dédiée
    if (isBossLevel) {
      this.generateBossArena();
      return;
    }

    // Sol avec trous (à partir niveau 3)
    const numHoles = this.currentLevel >= 3 ? Math.min(Math.floor((this.currentLevel - 2) / 2), 4) : 0;
    this.generateGroundWithHoles(numHoles);

    // Murs gauche et droite (pour wall jump) - plus hauts pour le nouveau monde
    this.walls.add(this.add.rectangle(10, height / 2, 20, height, 0x3a3a5a));
    this.walls.add(this.add.rectangle(width - 10, height / 2, 20, height, 0x3a3a5a));

    // === GROUPES MÉCANIQUES (initialisés AVANT la génération) ===
    this.movingPlatforms = [];
    this.fallingPlatforms = [];
    this.bouncePads = [];
    this.spikes = this.physics.add.staticGroup();
    this.oneWayPlatforms = [];

    // === GÉNÉRATION PROCÉDURALE - SYSTÈME DE TILES ===
    // Génération tile-based avec règles d'accessibilité
    const tileResult = this.generateTileBasedLevel();
    const { platformData, doorX, doorY, keyX, keyY } = tileResult;

    // Player spawn
    // Joueur - sprite "Sunday" (16x28 scalé x2)
    this.player = this.add.sprite(60, this.WORLD.groundY - 30, 'player');
    this.player.setScale(2); // 16x28 -> 32x56
    this.physics.add.existing(this.player);
    this.player.body.setSize(14, 26); // Hitbox sur le sprite original (avant scale)
    this.player.body.setOffset(1, 1);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, this.WORLD.width, this.WORLD.height + 200);
    this.player.body.setGravityY(this.config.gravity);
    this.player.body.setMaxVelocity(this.config.playerSpeed, 800); // Limiter vitesse X et Y (évite tunneling)
    this.player.setDepth(50); // Au-dessus de tout

    // === SETUP CAMÉRA ===
    this.cameras.main.setBounds(0, 0, this.WORLD.width, this.WORLD.height);
    this.cameras.main.startFollow(this.player, true, this.cameraConfig.lerpX, this.cameraConfig.lerpY);
    this.cameras.main.setDeadzone(this.cameraConfig.deadzone.width, this.cameraConfig.deadzone.height);
    this.cameras.main.setZoom(this.cameraConfig.baseZoom);

    // Collisions
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.walls, this.touchWall, null, this);
    this.physics.add.collider(this.enemies, this.platforms);
    // Projectiles bloqués par les plateformes (sauf perçants - le process callback empêche la collision)
    this.physics.add.collider(this.bullets, this.platforms, this.bulletHitPlatform, this.shouldBulletCollide, this);
    this.physics.add.collider(this.bullets, this.walls, this.bulletHitPlatform, this.shouldBulletCollide, this);

    // Collisions des nouvelles mécaniques (moving, falling, bounce, spikes, one-way)
    this.setupNewMechanicsCollisions();

    // Clé - placée sur la plateforme de clé (keyX, keyY définis plus haut)
    if (!isBossLevel) {
      this.key = this.createKeySprite(keyX, keyY - 30);
      this.physics.add.existing(this.key, true);
      // Hitbox = taille du sprite original (16x28), centrée automatiquement
      this.key.body.setSize(16, 28);
      this.physics.add.overlap(this.player, this.key, this.collectKey, null, this);
    }

    // Porte - rectangle 32x64 (1x2 tiles), positionnée sur la plateforme
    this.door = this.add.rectangle(doorX, doorY - 32, 32, 64, 0x444444);
    this.door.setStrokeStyle(3, 0x888888);
    this.doorLocked = true;
    this.physics.add.existing(this.door, true);
    // Hitbox petite pour que le joueur soit vraiment dedans
    this.door.body.setSize(20, 50);
    this.physics.add.overlap(this.player, this.door, this.enterDoor, null, this);

    // Ennemis basiques sur plateformes
    const numEnemies = Math.min(2 + Math.floor(this.currentLevel / 3), 4);
    const usedPlatforms = new Set();

    for (let i = 0; i < numEnemies && platformData.length > 0; i++) {
      const availablePlatforms = platformData.filter((_, idx) => !usedPlatforms.has(idx) && platformData[idx].w >= 70);
      if (availablePlatforms.length === 0) break;

      const idx = this.rng.between(0, availablePlatforms.length - 1);
      const plat = availablePlatforms[idx];
      usedPlatforms.add(platformData.indexOf(plat));

      this.createPatrolEnemy(plat.x, plat.y - 25, plat.x - plat.w/2 + 15, plat.x + plat.w/2 - 15);
    }

    // Ennemis au sol - patrouillent sur toute la surface disponible
    if (!isBossLevel) {
      const numGroundEnemies = 1 + Math.floor(this.currentLevel / 4);

      // Calculer les segments de sol entre les trous
      const groundSegments = [];
      let lastRight = 50; // Marge à gauche
      const sortedHoles = [...this.groundHoles].sort((a, b) => a.left - b.left);

      for (const hole of sortedHoles) {
        if (hole.left - lastRight > 100) { // Segment assez large
          groundSegments.push({ left: lastRight, right: hole.left - 20 });
        }
        lastRight = hole.right + 20;
      }
      // Dernier segment jusqu'à la fin du monde
      if (width - 50 - lastRight > 100) {
        groundSegments.push({ left: lastRight, right: width - 50 });
      }

      // Si pas de trous, un seul grand segment
      if (groundSegments.length === 0) {
        groundSegments.push({ left: 50, right: width - 50 });
      }

      for (let i = 0; i < numGroundEnemies; i++) {
        // Répartir les ennemis sur les segments disponibles
        const segmentIndex = i % groundSegments.length;
        const segment = groundSegments[segmentIndex];
        const gx = segment.left + (segment.right - segment.left) / 2;

        const groundEnemy = this.createPatrolEnemy(gx, groundY - 40, segment.left, segment.right);
        groundEnemy.isGroundEnemy = true;
      }
    }

    // Ennemis tireurs
    if (this.currentLevel >= 2 && !isBossLevel) {
      const numShooters = Math.min(Math.floor(this.currentLevel / 3), 2);
      const usedPositions = [];

      const forbiddenZones = [
        { x: doorX, y: doorY, radius: 80 },
        { x: 100, y: groundY - 50, radius: 80 },
      ];

      const possiblePositions = [
        { x: 50, minY: 150, maxY: 350 },
        { x: width - 50, minY: 150, maxY: 350 },
        { x: width / 2, minY: 120, maxY: 300 },
        { x: width * 0.3, minY: 100, maxY: 280 },
        { x: width * 0.7, minY: 100, maxY: 280 },
      ];

      for (let i = 0; i < numShooters; i++) {
        let placed = false;
        let attempts = 0;

        while (!placed && attempts < 20) {
          // Choisir une position aléatoire
          const posConfig = possiblePositions[Math.floor(Math.random() * possiblePositions.length)];
          const shootX = posConfig.x;
          const shootY = posConfig.minY + Math.floor(Math.random() * (posConfig.maxY - posConfig.minY));

          // Vérifier que ce n'est pas dans une zone interdite
          let inForbidden = false;
          for (const zone of forbiddenZones) {
            const dist = Math.sqrt(Math.pow(shootX - zone.x, 2) + Math.pow(shootY - zone.y, 2));
            if (dist < zone.radius) {
              inForbidden = true;
              break;
            }
          }

          // Vérifier que ce n'est pas trop proche d'un autre shooter
          let tooClose = false;
          for (const pos of usedPositions) {
            const dist = Math.sqrt(Math.pow(shootX - pos.x, 2) + Math.pow(shootY - pos.y, 2));
            if (dist < 120) {
              tooClose = true;
              break;
            }
          }

          if (!inForbidden && !tooClose) {
            // Plateforme pour le shooter
            this.addPlatform(shootX, shootY + 20, 60, 12, 0x5a4a6a);
            this.createShooterEnemy(shootX, shootY);
            usedPositions.push({ x: shootX, y: shootY });
            placed = true;
          }

          attempts++;
        }
      }
    }

    // BOSS tous les 5 niveaux
    if (isBossLevel) {
      this.spawnBoss();
    }

    // Zone de mort (en bas de l'écran pour les trous)
    // Zone de mort (sous le niveau)
    const deathZone = this.add.rectangle(this.WORLD.width / 2, this.WORLD.height + 50, this.WORLD.width, 100, 0xff0000, 0);
    this.deathZones.add(deathZone);
    this.physics.add.overlap(this.player, this.deathZones, this.fallDeath, null, this);

    // Coins - dispersés dans le monde
    const numCoins = 3 + Math.floor(this.currentLevel * 0.5);
    for (let i = 0; i < numCoins; i++) {
      const cx = this.rng.between(100, this.WORLD.width - 100);
      const cy = this.rng.between(150, this.WORLD.groundY - 150);
      const coin = this.add.circle(cx, cy, 8, 0xffd700);
      this.coins.add(coin);
      coin.body.setAllowGravity(false);
    }

    // Vie bonus (chance aléatoire - reroll à chaque partie)
    const heartChance = Math.min(0.15 + this.currentLevel * 0.03, 0.4); // 15% -> 40% max
    if (Math.random() < heartChance) {  // Math.random() pour un vrai reroll
      // Placer sur une plateforme aléatoire (exclure la zone de la porte et de la clé)
      const validHeartPlatforms = platformData.filter(p => {
        const distToDoor = Math.abs(p.x - doorX) + Math.abs(p.y - doorY);
        const distToKey = Math.abs(p.x - keyX) + Math.abs(p.y - keyY);
        return distToDoor > 60 && distToKey > 60; // Exclure les plateformes proches de la porte/clé
      });
      const heartPlat = validHeartPlatforms.length > 0
        ? validHeartPlatforms[this.rng.between(0, validHeartPlatforms.length - 1)]
        : null;

      if (heartPlat) {
        this.heartPickup = this.add.sprite(heartPlat.x, heartPlat.y - 25, 'heart_full');
        this.heartPickup.setScale(2);
        this.heartPickup.setOrigin(0.5);
        this.physics.add.existing(this.heartPickup, true);
        this.heartPickup.body.setSize(16, 16);
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

  createPatrolEnemy(x, y, minX, maxX, forceType = null) {
    // Types d'ennemis avec formes géométriques et dégâts de contact
    // contactDamage: 1 = 1/4 coeur, 2 = 1/2 coeur, 3 = 3/4 coeur, 4 = 1 coeur
    const enemyTypes = [
      { shape: 'rect', w: 32, h: 32, color: 0xff4444, stroke: 0xcc2222, speed: 1.0, name: 'basic', contactDamage: 3 },      // Carré rouge - 3/4 coeur
      { shape: 'rect', w: 32, h: 48, color: 0xff6644, stroke: 0xcc4422, speed: 1.3, name: 'tall', contactDamage: 4 },       // Grand orange - 1 coeur
      { shape: 'rect', w: 32, h: 16, color: 0xcc4466, stroke: 0x992244, speed: 0.7, name: 'wide', contactDamage: 2 },       // Large plat - 1/2 coeur
      { shape: 'triangle', w: 32, h: 32, color: 0xff2266, stroke: 0xcc0044, speed: 1.1, name: 'spike', contactDamage: 4 },  // Triangle pointu - 1 coeur
      { shape: 'circle', r: 16, color: 0xff5500, stroke: 0xcc3300, speed: 1.4, name: 'fast', contactDamage: 2 },            // Cercle rapide - 1/2 coeur
    ];

    // Sélection du type selon le niveau ou forcé
    let typeIndex = forceType !== null ? forceType : (this.rng.between(0, Math.min(this.currentLevel - 1, enemyTypes.length - 1)));
    typeIndex = Math.max(0, Math.min(typeIndex, enemyTypes.length - 1));
    const type = enemyTypes[typeIndex];

    let enemy;
    if (type.shape === 'rect') {
      enemy = this.add.rectangle(x, y, type.w, type.h, type.color);
    } else if (type.shape === 'triangle') {
      enemy = this.add.triangle(x, y, type.w/2, 0, type.w, type.h, 0, type.h, type.color);
    } else if (type.shape === 'circle') {
      enemy = this.add.circle(x, y, type.r, type.color);
    }

    enemy.setStrokeStyle(2, type.stroke);
    this.enemies.add(enemy);
    enemy.body.setAllowGravity(true);
    enemy.body.setGravityY(this.config.gravity);

    const baseSpeed = 60 + this.currentLevel * 5;
    enemy.body.setVelocityX(baseSpeed * type.speed);
    enemy.patrolMin = minX;
    enemy.patrolMax = maxX;
    enemy.speedMultiplier = type.speed;
    enemy.enemyType = type.name;
    enemy.contactDamage = type.contactDamage;
    enemy.body.setCollideWorldBounds(true);
    return enemy;
  }

  createShooterEnemy(x, y, shooterType = null) {
    // Types de shooters avec movesets uniques et dégâts de contact
    // contactDamage: 1 = 1/4 coeur, 2 = 1/2 coeur, 3 = 3/4 coeur, 4 = 1 coeur
    const shooterTypes = [
      {
        w: 30, h: 30, color: 0xff8800, stroke: 0xcc6600,
        delay: 2800, piercing: false, name: 'sniper',
        // Sniper: reste immobile, tire précis, recule après le tir
        mobile: false, behavior: 'sniper', contactDamage: 4  // 1 coeur - s'approcher d'un sniper est dangereux
      },
      {
        w: 25, h: 40, color: 0xff4400, stroke: 0xcc2200,
        delay: 1800, piercing: false, name: 'gunner',
        // Gunner: mobile, tirs rapides en rafale, se déplace entre les tirs
        mobile: true, behavior: 'gunner', contactDamage: 3   // 3/4 coeur - mobile, moins dangereux au contact
      },
      {
        w: 40, h: 25, color: 0x8800ff, stroke: 0x6600cc,
        delay: 3500, piercing: true, name: 'mage',
        // Mage: flotte, téléporte, tire des projectiles perçants
        mobile: true, behavior: 'mage', contactDamage: 2     // 1/2 coeur - fragile, flotte au-dessus
      },
    ];

    const typeIndex = shooterType !== null ? shooterType :
      (this.currentLevel >= 4 && Math.random() < 0.25 ? 2 : (Math.random() < 0.4 ? 1 : 0));
    const type = shooterTypes[Math.min(typeIndex, shooterTypes.length - 1)];

    // === VÉRIFICATION DE HAUTEUR POUR GUNNER ===
    // Le gunner est grand (40px), vérifier qu'il y a assez de place
    if (type.behavior === 'gunner') {
      let hasCeilingAbove = false;
      const checkHeight = type.h + 20; // Hauteur du gunner + marge

      this.platforms.getChildren().forEach(platform => {
        if (!platform || !platform.active) return;
        const platBottom = platform.y + platform.height / 2;
        const platLeft = platform.x - platform.width / 2;
        const platRight = platform.x + platform.width / 2;

        // Y a-t-il une plateforme au-dessus dans la zone de spawn?
        if (platBottom > y - checkHeight && platBottom < y &&
            x >= platLeft - 10 && x <= platRight + 10) {
          hasCeilingAbove = true;
        }
      });

      // Si pas assez de place, créer un sniper à la place
      if (hasCeilingAbove) {
        return this.createShooterEnemy(x, y, 0); // Forcer sniper
      }
    }

    const shooter = this.add.rectangle(x, y, type.w, type.h, type.color);
    shooter.setStrokeStyle(2, type.stroke);
    shooter.shooterType = type;
    shooter.originalColor = type.color;
    shooter.contactDamage = type.contactDamage;
    this.shooters.add(shooter);

    // Configuration physique selon le type
    if (type.mobile) {
      shooter.body.setAllowGravity(type.behavior !== 'mage'); // Mage flotte
      shooter.body.setImmovable(false);
      shooter.body.setCollideWorldBounds(true);
    } else {
      shooter.body.setAllowGravity(false);
      shooter.body.setImmovable(true);
    }

    // État IA du shooter
    shooter.aiState = 'idle';
    shooter.aiTimer = 0;
    shooter.homeX = x;
    shooter.homeY = y;
    shooter.shotsFired = 0;
    shooter.canShoot = true;

    // === PATROL BOUNDS POUR GUNNER (comme les ennemis normaux) ===
    if (type.behavior === 'gunner') {
      // Trouver la plateforme sous le shooter
      let platformUnder = null;
      this.platforms.getChildren().forEach(platform => {
        if (!platform || !platform.active) return;
        const platTop = platform.y - platform.height / 2;
        const platLeft = platform.x - platform.width / 2;
        const platRight = platform.x + platform.width / 2;

        // Le shooter est-il sur cette plateforme?
        if (Math.abs(y + type.h / 2 + 10 - platTop) < 20 &&
            x >= platLeft - 5 && x <= platRight + 5) {
          platformUnder = platform;
        }
      });

      if (platformUnder) {
        const halfWidth = platformUnder.width / 2;
        shooter.patrolMin = platformUnder.x - halfWidth + 20; // Marge de sécurité
        shooter.patrolMax = platformUnder.x + halfWidth - 20;
      } else {
        // Pas de plateforme trouvée, utiliser position actuelle
        shooter.patrolMin = x - 30;
        shooter.patrolMax = x + 30;
      }

      shooter.patrolDir = Math.random() > 0.5 ? 1 : -1;
      shooter.patrolPauseTimer = 0;
      shooter.isPatrolPaused = false;
    }

    // Timer de tir individuel
    const baseDelay = type.delay - Math.min(this.currentLevel * 100, 800);
    const initialDelay = 1500 + Phaser.Math.Between(0, 1000);

    shooter.shootTimer = this.time.addEvent({
      delay: initialDelay,
      callback: () => {
        this.shooterRequestFire(shooter);
        shooter.shootTimer = this.time.addEvent({
          delay: baseDelay + Phaser.Math.Between(-200, 400),
          callback: () => this.shooterRequestFire(shooter),
          callbackScope: this,
          loop: true
        });
      },
      callbackScope: this
    });

    return shooter;
  }

  // Demande de tir - vérifie l'état avant de tirer
  shooterRequestFire(shooter) {
    if (!shooter || !shooter.active || !shooter.canShoot) return;
    if (shooter.aiState === 'teleport' || shooter.aiState === 'dash') return;

    const type = shooter.shooterType;

    if (type.behavior === 'gunner') {
      // Gunner: rafale de 3 tirs rapides
      shooter.aiState = 'burst';
      shooter.shotsFired = 0;
      this.shooterBurst(shooter);
    } else if (type.behavior === 'mage') {
      // Mage: téléporte puis tire
      shooter.aiState = 'teleport';
      this.shooterTeleport(shooter);
    } else {
      // Sniper: tir unique précis
      this.shooterFire(shooter);
      shooter.aiState = 'recoil';
      shooter.aiTimer = 0;
    }
  }

  // Rafale du Gunner
  shooterBurst(shooter) {
    if (!shooter || !shooter.active) return;

    this.shooterFire(shooter, true); // Tir rapide
    shooter.shotsFired++;

    if (shooter.shotsFired < 3) {
      this.time.delayedCall(250, () => this.shooterBurst(shooter));
    } else {
      shooter.aiState = 'reposition';
      shooter.aiTimer = 0;
    }
  }

  // Téléportation du Mage
  shooterTeleport(shooter) {
    if (!shooter || !shooter.active) return;

    // Effet de disparition
    this.tweens.add({
      targets: shooter,
      alpha: 0,
      scaleX: 0.3,
      scaleY: 0.3,
      duration: 300,
      onComplete: () => {
        if (!shooter || !shooter.active) return;

        // === ÉVITER LA TRAJECTOIRE DU JOUEUR ===
        // Calculer l'angle de mouvement du joueur
        const playerVelX = this.player.body.velocity.x;
        const playerVelY = this.player.body.velocity.y;
        const playerSpeed = Math.sqrt(playerVelX * playerVelX + playerVelY * playerVelY);

        // Angle vers lequel le joueur se dirige
        let playerMoveAngle = 0;
        if (playerSpeed > 30) {
          playerMoveAngle = Math.atan2(playerVelY, playerVelX);
        }

        // Choisir un angle de téléportation qui évite la trajectoire du joueur
        let angle;
        let attempts = 0;
        const maxAttempts = 10;

        do {
          angle = Math.random() * Math.PI * 2;
          attempts++;

          // Calculer la différence d'angle avec la trajectoire du joueur
          let angleDiff = Math.abs(angle - playerMoveAngle);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

          // Si le joueur bouge vite, éviter de se téléporter dans sa trajectoire
          // (angle différent d'au moins 60° de la direction du joueur)
          if (playerSpeed < 30 || angleDiff > Math.PI / 3) {
            break;
          }
        } while (attempts < maxAttempts);

        const dist = 150 + Math.random() * 100;
        let newX = this.player.x + Math.cos(angle) * dist;
        let newY = this.player.y + Math.sin(angle) * dist - 50;

        // Limites
        newX = Phaser.Math.Clamp(newX, 100, this.WORLD.width - 100);
        newY = Phaser.Math.Clamp(newY, 80, this.WORLD.groundY - 100);

        shooter.x = newX;
        shooter.y = newY;

        // Effet d'apparition
        this.tweens.add({
          targets: shooter,
          alpha: 1,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          onComplete: () => {
            if (!shooter || !shooter.active) return;
            // Tir après téléportation
            this.time.delayedCall(200, () => {
              this.shooterFire(shooter);
              shooter.aiState = 'float';
              shooter.aiTimer = 0;
            });
          }
        });
      }
    });
  }

  shooterFire(shooter, quickFire = false) {
    if (!shooter || !shooter.active) return;

    const type = shooter.shooterType || { color: 0xff8800, piercing: false };
    const originalX = shooter.x;
    const originalY = shooter.y;

    // Animation réduite pour tir rapide (rafale)
    const chargeTime = quickFire ? 100 : 400;
    const fireDelay = quickFire ? 120 : 450;

    if (!quickFire) {
      // Animation de charge complète pour tir normal
      this.tweens.add({
        targets: shooter,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: chargeTime,
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
    } else {
      // Animation rapide pour rafale
      this.tweens.add({
        targets: shooter,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 50,
        yoyo: true
      });
    }

    // Flash de couleur
    shooter.setFillStyle(0xffcc00);
    this.time.delayedCall(quickFire ? 50 : 200, () => {
      if (shooter && shooter.active) shooter.setFillStyle(type.color);
    });

    // Tir après l'animation
    this.time.delayedCall(fireDelay, () => {
      if (!shooter || !shooter.active) return;
      shooter.setFillStyle(type.color);

      // Limiter le nombre de bullets
      if (this.bullets.getLength() >= 30) {
        const oldest = this.bullets.getFirstAlive();
        if (oldest) oldest.destroy();
      }

      // SFX + Particules de tir
      this.playSound('shoot');
      this.particleShoot(shooter.x, shooter.y);

      // Créer le projectile (normal ou perçant)
      const angle = Phaser.Math.Angle.Between(shooter.x, shooter.y, this.player.x, this.player.y);
      const speed = (quickFire ? 140 : 160) + this.currentLevel * 10;

      let bullet;
      if (type.piercing) {
        // Projectile perçant MAGE - losange avec bordure rouge
        bullet = this.add.polygon(shooter.x, shooter.y, [0, -10, 5, 0, 0, 10, -5, 0], 0x8800ff);
        bullet.setStrokeStyle(2, 0xff0000);
        bullet.piercing = true;
        bullet.damage = 2; // 1/2 coeur - perçant mais lent
        bullet.setRotation(angle + Math.PI / 2);
      } else if (type.behavior === 'gunner') {
        // Projectile GUNNER - petit mais rapide
        const bulletSize = quickFire ? 4 : 6;
        bullet = this.add.circle(shooter.x, shooter.y, bulletSize, 0xff4400);
        bullet.setStrokeStyle(2, 0xcc2200);
        bullet.piercing = false;
        bullet.damage = quickFire ? 1 : 2; // 1/4 ou 1/2 coeur selon rafale
      } else {
        // Projectile SNIPER - normal, précis
        const bulletSize = 7;
        bullet = this.add.circle(shooter.x, shooter.y, bulletSize, 0xffee00);
        bullet.setStrokeStyle(2, 0xff6600);
        bullet.piercing = false;
        bullet.damage = 2; // 1/2 coeur - précis mais évitable
      }

      this.bullets.add(bullet);
      bullet.body.setAllowGravity(false);
      bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

      this.time.delayedCall(type.piercing ? 4000 : 3000, () => {
        if (bullet && bullet.active) bullet.destroy();
      });
    });
  }

  // Update IA des shooters (appelé dans update())
  updateShooterAI(delta) {
    this.shooters.getChildren().forEach(shooter => {
      if (!shooter || !shooter.active) return;

      const type = shooter.shooterType;
      if (!type.mobile) return; // Sniper est statique

      shooter.aiTimer += delta;

      const dx = this.player.x - shooter.x;
      const dy = this.player.y - shooter.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy);

      switch (type.behavior) {
        case 'gunner':
          // === GUNNER: Mouvement organique style patrol ===
          const patrolMin = shooter.patrolMin || shooter.homeX - 30;
          const patrolMax = shooter.patrolMax || shooter.homeX + 30;
          const blockedLeft = shooter.x <= patrolMin || shooter.body.blocked.left;
          const blockedRight = shooter.x >= patrolMax || shooter.body.blocked.right;
          const moveSpeed = 50; // Vitesse de base (plus lent que les ennemis normaux)

          // Mettre à jour le timer de pause
          if (shooter.isPatrolPaused) {
            shooter.patrolPauseTimer += delta;
          }

          if (shooter.aiState === 'reposition') {
            // Mode repositionnement actif après une rafale

            // Vérification des bords avec pause naturelle
            if (blockedRight && shooter.patrolDir > 0) {
              shooter.patrolDir = -1;
              shooter.body.setVelocityX(0);
              shooter.isPatrolPaused = true;
              shooter.patrolPauseTimer = 0;
            } else if (blockedLeft && shooter.patrolDir < 0) {
              shooter.patrolDir = 1;
              shooter.body.setVelocityX(0);
              shooter.isPatrolPaused = true;
              shooter.patrolPauseTimer = 0;
            }

            // Si en pause, attendre avant de repartir
            if (shooter.isPatrolPaused) {
              if (shooter.patrolPauseTimer > 300) { // Pause de 300ms aux bords
                shooter.isPatrolPaused = false;
              }
            } else {
              // Mouvement fluide avec interpolation (comme les ennemis normaux)
              const targetVel = shooter.patrolDir * moveSpeed;
              const currentVel = shooter.body.velocity.x;
              shooter.body.setVelocityX(currentVel + (targetVel - currentVel) * 0.08);
            }

            // Après un moment, s'arrêter et passer en idle
            if (shooter.aiTimer > 1200) {
              shooter.body.setVelocityX(0);
              shooter.aiState = 'idle';
              shooter.aiTimer = 0;
            }
          } else if (shooter.aiState === 'idle' || shooter.aiState === 'burst') {
            // En idle ou pendant le tir: ralentir doucement
            const currentVel = shooter.body.velocity.x;
            shooter.body.setVelocityX(currentVel * 0.92);

            // Petit mouvement de "vie" en idle (oscillation subtile)
            if (shooter.aiState === 'idle' && Math.abs(currentVel) < 5) {
              const idleWiggle = Math.sin(this.time.now / 800 + shooter.homeX) * 0.3;
              shooter.body.setVelocityX(idleWiggle * 10);
            }
          }
          break;

        case 'mage':
          // Mage: flotte doucement
          if (shooter.aiState === 'float' || shooter.aiState === 'idle') {
            // Mouvement flottant sinusoïdal
            const floatY = Math.sin(this.time.now / 500) * 0.5;
            shooter.body.setVelocityY(floatY * 30);

            // Légère dérive horizontale
            const driftX = Math.sin(this.time.now / 1500) * 0.3;
            shooter.body.setVelocityX(driftX * 20);

            // S'éloigner si le joueur est trop proche
            if (distToPlayer < 100) {
              const awayX = -dx / distToPlayer * 60;
              const awayY = -dy / distToPlayer * 40;
              shooter.body.setVelocityX(awayX);
              shooter.body.setVelocityY(awayY);
            }
          }
          break;
      }
    });
  }

  // Helper pour ajouter une plateforme avec collision
  addPlatform(x, y, w, h, color = 0x4a4a6a, strokeColor = null) {
    const plat = this.add.rectangle(x, y, w, h, color);
    if (strokeColor) plat.setStrokeStyle(2, strokeColor);
    this.physics.add.existing(plat, true);
    this.platforms.add(plat);
    return plat;
  }

  generateGroundWithHoles(numHoles) {
    const groundY = this.WORLD.groundY;
    const worldWidth = this.WORLD.width;

    if (numHoles === 0) {
      // Sol plein
      this.addPlatform(worldWidth / 2, groundY, worldWidth, 16);
      return;
    }

    // Limiter les trous pour petit monde
    numHoles = Math.min(numHoles, 2);

    // Trous plus petits pour monde compact
    const holeWidth = 80;
    const minGap = 100;
    const holes = [];
    const safeZoneLeft = 120;
    const safeZoneRight = worldWidth - 80;

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
        this.addPlatform(segmentCenterX, groundY, segmentWidth, 20);
      }

      lastX = holeX + holeWidth / 2;
    }

    // Dernier segment
    const finalWidth = worldWidth - lastX;
    if (finalWidth > 20) {
      const finalCenterX = lastX + finalWidth / 2;
      this.addPlatform(finalCenterX, groundY, finalWidth, 20);
    }

    // Indicateurs visuels des trous (danger)
    for (const holeX of holes) {
      const warning = this.add.triangle(holeX, groundY - 30, 0, 15, 7, 0, 14, 15, 0xff4444, 0.6);
    }
  }

  // === GÉNÉRATION TILE-BASED ===

  // Convertit coordonnées pixel en tile
  pixelToTile(px, py) {
    return {
      x: Math.floor(px / this.TILE.SIZE),
      y: Math.floor(py / this.TILE.SIZE)
    };
  }

  // Convertit coordonnées tile en pixel (centre de la tile)
  tileToPixel(tx, ty) {
    return {
      x: tx * this.TILE.SIZE + this.TILE.SIZE / 2,
      y: ty * this.TILE.SIZE + this.TILE.SIZE / 2
    };
  }

  // Vérifie si une plateforme B est accessible depuis A
  isReachable(fromTile, toTile) {
    const dx = Math.abs(toTile.x - fromTile.x);
    const dy = toTile.y - fromTile.y; // Négatif = plus haut

    // Montée: nécessite saut
    if (dy < 0) {
      const height = Math.abs(dy);
      if (height <= this.JUMP_RULES.SINGLE_HEIGHT) {
        return dx <= this.JUMP_RULES.SINGLE_RANGE;
      } else if (height <= this.JUMP_RULES.DOUBLE_HEIGHT) {
        return dx <= this.JUMP_RULES.DOUBLE_RANGE;
      }
      return false;
    }

    // Descente: toujours possible si pas trop loin horizontalement
    return dx <= this.JUMP_RULES.DOUBLE_RANGE + 2;
  }

  // Vérifie si une tile respecte l'espacement minimum avec les plateformes existantes
  hasMinSpacing(grid, tx, ty, platformWidth = 2) {
    const minSpace = this.JUMP_RULES.MIN_SPACING;

    for (let checkY = ty - minSpace; checkY <= ty + minSpace; checkY++) {
      for (let checkX = tx - platformWidth - minSpace; checkX <= tx + platformWidth + minSpace; checkX++) {
        if (checkY < 0 || checkY >= this.TILE.ROWS) continue;
        if (checkX < 0 || checkX >= this.TILE.COLS) continue;
        if (checkX === tx && checkY === ty) continue;

        if (grid[checkY] && grid[checkY][checkX]) {
          return false;
        }
      }
    }
    return true;
  }

  // Génère un niveau basé sur le système de tiles
  generateTileBasedLevel() {
    const platformData = [];

    // 1. Initialiser la grille (false = vide)
    const grid = Array(this.TILE.ROWS).fill(null)
      .map(() => Array(this.TILE.COLS).fill(false));

    // Position du sol en tiles
    const groundRow = this.TILE.ROWS - 1;

    // 2. Placer la PORTE (partie haute: rows 2-7)
    const doorRow = this.rng.between(2, 7);
    const doorCol = this.rng.between(4, this.TILE.COLS - 5);
    const doorPixel = this.tileToPixel(doorCol, doorRow);
    const doorX = doorPixel.x;

    // Plateforme sous la porte (2-3 tiles de large)
    const doorPlatWidth = this.rng.between(2, 3);
    const doorPlatRow = doorRow + 1;
    // doorY = haut de la plateforme (pour que la porte repose dessus)
    const doorY = doorPlatRow * this.TILE.SIZE;
    for (let i = 0; i < doorPlatWidth; i++) {
      const col = doorCol - Math.floor(doorPlatWidth / 2) + i;
      if (col >= 0 && col < this.TILE.COLS) {
        grid[doorPlatRow][col] = true;
      }
    }
    const doorPlatPixel = this.tileToPixel(doorCol, doorPlatRow);
    platformData.push({
      x: doorPlatPixel.x,
      y: doorPlatPixel.y,
      w: doorPlatWidth * this.TILE.SIZE
    });
    this.addPlatformFromTile(doorCol, doorPlatRow, doorPlatWidth);

    // 3. Placer la CLÉ (distance minimum de la porte)
    let keyCol, keyRow;
    let keyAttempts = 0;
    do {
      keyCol = this.rng.between(2, this.TILE.COLS - 3);
      keyRow = this.rng.between(2, this.TILE.ROWS - 4);
      keyAttempts++;
    } while (
      keyAttempts < 50 &&
      (Math.abs(keyCol - doorCol) + Math.abs(keyRow - doorRow) < this.JUMP_RULES.MIN_KEY_DOOR_DIST)
    );

    const keyPixel = this.tileToPixel(keyCol, keyRow);
    const keyX = keyPixel.x;
    const keyY = keyPixel.y;

    // Plateforme sous la clé (2-3 tiles de large)
    const keyPlatWidth = this.rng.between(2, 3);
    const keyPlatRow = keyRow + 1;
    for (let i = 0; i < keyPlatWidth; i++) {
      const col = keyCol - Math.floor(keyPlatWidth / 2) + i;
      if (col >= 0 && col < this.TILE.COLS) {
        grid[keyPlatRow][col] = true;
      }
    }
    const keyPlatPixel = this.tileToPixel(keyCol, keyPlatRow);
    platformData.push({
      x: keyPlatPixel.x,
      y: keyPlatPixel.y,
      w: keyPlatWidth * this.TILE.SIZE
    });
    this.addPlatformFromTile(keyCol, keyPlatRow, keyPlatWidth);

    // 4. Collecter les plateformes existantes pour vérification d'accessibilité
    const existingPlatforms = [
      { x: doorCol, y: doorPlatRow },
      { x: keyCol, y: keyPlatRow },
      { x: Math.floor(this.TILE.COLS / 2), y: groundRow } // Sol (spawn)
    ];

    // 5. Générer des plateformes intermédiaires accessibles
    const numPlats = 4 + Math.floor(this.currentLevel * 0.5);
    let placed = 0;
    let attempts = 0;
    const maxAttempts = 100;

    // Chance de plateforme spéciale: commence à 0% niveau 1, augmente de 2.5% par niveau, cap à 20%
    // Niveau 1: 0%, Niveau 2: 2.5%, Niveau 5: 10%, Niveau 9+: 20% max
    const specialChance = Math.min(0.20, Math.max(0, (this.currentLevel - 1) * 0.025));

    while (placed < numPlats && attempts < maxAttempts) {
      attempts++;

      // Position aléatoire
      const platCol = this.rng.between(2, this.TILE.COLS - 3);
      const platRow = this.rng.between(3, this.TILE.ROWS - 3);
      const platWidth = this.rng.between(2, 3);

      // Vérifier l'espacement minimum
      if (!this.hasMinSpacing(grid, platCol, platRow, platWidth)) {
        continue;
      }

      // Vérifier l'accessibilité depuis au moins une plateforme existante
      const platTile = { x: platCol, y: platRow };
      let isAccessible = false;

      for (const existing of existingPlatforms) {
        if (this.isReachable(existing, platTile) || this.isReachable(platTile, existing)) {
          isAccessible = true;
          break;
        }
      }

      if (!isAccessible) {
        continue;
      }

      // Marquer la grille comme occupée
      for (let i = 0; i < platWidth; i++) {
        const col = platCol - Math.floor(platWidth / 2) + i;
        if (col >= 0 && col < this.TILE.COLS && platRow >= 0 && platRow < this.TILE.ROWS) {
          grid[platRow][col] = true;
        }
      }

      const platPixel = this.tileToPixel(platCol, platRow);
      const platWidthPx = platWidth * this.TILE.SIZE;

      // Décider si c'est une plateforme spéciale
      const isSpecial = this.rng.frac() < specialChance;

      if (isSpecial) {
        // Choisir un type de plateforme spéciale
        // Types disponibles selon le niveau:
        // - one-way: niveau 2+
        // - moving: niveau 3+
        // - falling: niveau 4+
        // - spikes (au sol uniquement): niveau 5+
        const availableTypes = [];
        if (this.currentLevel >= 2) availableTypes.push('one-way');
        if (this.currentLevel >= 3) availableTypes.push('moving');
        if (this.currentLevel >= 4) availableTypes.push('falling');

        if (availableTypes.length > 0) {
          const specialType = availableTypes[this.rng.between(0, availableTypes.length - 1)];

          switch (specialType) {
            case 'moving':
              const horiz = this.rng.frac() > 0.5;
              this.createMovingPlatform(platPixel.x, platPixel.y, platWidthPx, 12, {
                horizontal: horiz,
                vertical: !horiz,
                distance: this.rng.between(40, 80),
                speed: this.rng.between(40, 70)
              });
              break;

            case 'falling':
              this.createFallingPlatform(platPixel.x, platPixel.y, platWidthPx, 12);
              break;

            case 'one-way':
              this.createOneWayPlatform(platPixel.x, platPixel.y, platWidthPx);
              break;
          }

          // Les plateformes spéciales ne sont pas ajoutées à platformData (pas d'ennemis dessus)
        } else {
          // Pas de type spécial disponible, créer une plateforme normale
          platformData.push({ x: platPixel.x, y: platPixel.y, w: platWidthPx });
          this.addPlatformFromTile(platCol, platRow, platWidth);
        }
      } else {
        // Plateforme normale
        platformData.push({ x: platPixel.x, y: platPixel.y, w: platWidthPx });
        this.addPlatformFromTile(platCol, platRow, platWidth);
      }

      existingPlatforms.push({ x: platCol, y: platRow });
      placed++;
    }

    // 6. Ajouter des spikes au sol (niveau 5+, chance basée sur specialChance)
    if (this.currentLevel >= 5 && this.rng.frac() < specialChance * 2) {
      const numSpikes = this.rng.between(1, 2);
      for (let i = 0; i < numSpikes; i++) {
        const spikeX = this.rng.between(150, this.WORLD.width - 150);
        this.createSpikes(spikeX, this.WORLD.groundY - 5, this.rng.between(40, 60));
      }
    }

    return { platformData, doorX, doorY, keyX, keyY };
  }

  // Crée une plateforme depuis des coordonnées tile
  addPlatformFromTile(centerCol, row, widthInTiles) {
    const pixel = this.tileToPixel(centerCol, row);
    const width = widthInTiles * this.TILE.SIZE;
    const height = 14;

    const plat = this.add.rectangle(pixel.x, pixel.y, width, height, 0x4a4a6a);
    plat.setStrokeStyle(2, 0x3a3a5a);
    this.physics.add.existing(plat, true);
    this.platforms.add(plat);

    return plat;
  }

  // === NOUVELLES MÉCANIQUES DE PLATEFORMES ===

  createMovingPlatform(x, y, width, height = 14, options = {}) {
    // Support ancien format: createMovingPlatform(x, y, width, horizontal, range)
    if (typeof height === 'boolean') {
      options = { horizontal: height, distance: options || 150 };
      height = 14;
    }

    const horizontal = options.horizontal !== undefined ? options.horizontal : true;
    const vertical = options.vertical || false;
    const distance = options.distance || 150;
    const speed = options.speed || (80 + this.currentLevel * 5);

    const plat = this.add.rectangle(x, y, width, height, 0x6a5a8a);
    plat.setStrokeStyle(2, 0x8a7aaa);
    this.physics.add.existing(plat);
    plat.body.setImmovable(true);
    plat.body.setAllowGravity(false);

    // Indicateur de direction
    const arrowChar = vertical ? '↕' : (horizontal ? '↔' : '↕');
    const arrow = this.add.text(x, y, arrowChar, { fontSize: '14px', fill: '#aaa' }).setOrigin(0.5);
    arrow.setDepth(10);

    plat.startX = x;
    plat.startY = y;
    plat.range = distance;
    plat.horizontal = horizontal && !vertical;
    plat.speed = speed;
    plat.direction = 1;
    plat.arrow = arrow;

    this.movingPlatforms.push(plat);
    // Collision ajoutée dans setupNewMechanicsCollisions()

    return plat;
  }

  createFallingPlatform(x, y, width, height = 14) {
    const plat = this.add.rectangle(x, y, width, height, 0x8a6a5a);
    plat.setStrokeStyle(2, 0xaa8a7a);
    this.physics.add.existing(plat);
    plat.body.setImmovable(true);
    plat.body.setAllowGravity(false);

    // Indicateur de danger
    const warning = this.add.text(x, y, '!', { fontSize: '12px', fill: '#ff6644', fontStyle: 'bold' }).setOrigin(0.5);
    warning.setDepth(10);

    plat.originalY = y;
    plat.startX = x;
    plat.isFalling = false;
    plat.fallTimer = null;
    plat.respawnTimer = null;
    plat.warning = warning;

    this.fallingPlatforms.push(plat);
    // Collision ajoutée dans setupNewMechanicsCollisions()

    return plat;
  }

  createBouncePad(x, y, width = 60, bounceForce = 700) {
    const pad = this.add.rectangle(x, y, width, 12, 0x44cc44);
    pad.setStrokeStyle(3, 0x66ff66);
    this.physics.add.existing(pad, true);

    // Spring visuel - proportionnel à la largeur
    const spring = this.add.rectangle(x, y + 8, width * 0.65, 8, 0x228822);
    spring.setDepth(9);

    pad.spring = spring;
    pad.padX = x;
    pad.padY = y;
    pad.bounceForce = bounceForce + this.currentLevel * 15;

    this.bouncePads.push(pad);
    // Collision ajoutée dans setupNewMechanicsCollisions()

    return pad;
  }

  createSpikes(x, y, widthOrCount = 60) {
    const spikeGroup = [];
    const spacing = 20;

    // Si la valeur est petite (< 20), c'est un count, sinon c'est une largeur
    const count = widthOrCount < 20 ? widthOrCount : Math.max(1, Math.floor(widthOrCount / spacing));
    const startX = x - (count - 1) * spacing / 2;

    for (let i = 0; i < count; i++) {
      const sx = startX + i * spacing;
      const spike = this.add.triangle(sx, y, 0, 20, 10, 0, 20, 20, 0xcc3333);
      spike.setStrokeStyle(1, 0xff4444);
      this.physics.add.existing(spike, true);
      spike.body.setSize(14, 16);
      spike.body.setOffset(3, 4);

      this.spikes.add(spike);
      spikeGroup.push(spike);
    }
    // Overlap ajouté dans setupNewMechanicsCollisions()

    return spikeGroup;
  }

  createOneWayPlatform(x, y, width) {
    const plat = this.add.rectangle(x, y, width, 10, 0x5588aa);
    plat.setStrokeStyle(2, 0x77aacc);
    plat.setAlpha(0.8);
    this.physics.add.existing(plat);
    plat.body.setImmovable(true);
    plat.body.setAllowGravity(false);
    plat.body.checkCollision.down = false;
    plat.body.checkCollision.left = false;
    plat.body.checkCollision.right = false;

    // Indicateur visuel (lignes pointillées)
    for (let i = 0; i < 3; i++) {
      const dot = this.add.rectangle(x - width/3 + i * width/3, y + 3, 8, 2, 0xaaccee, 0.5);
      dot.setDepth(9);
    }

    this.oneWayPlatforms.push(plat);
    // Collision ajoutée dans setupNewMechanicsCollisions()

    return plat;
  }

  // Configure toutes les collisions des nouvelles mécaniques (appelé APRÈS création du joueur)
  setupNewMechanicsCollisions() {
    // Moving platforms
    this.movingPlatforms.forEach(plat => {
      this.physics.add.collider(this.player, plat);
    });

    // Falling platforms
    this.fallingPlatforms.forEach(plat => {
      this.physics.add.collider(this.player, plat, () => {
        if (!plat.isFalling && !plat.fallTimer) {
          // Commence à trembler
          this.tweens.add({
            targets: [plat, plat.warning],
            x: plat.startX + 2,
            duration: 50,
            yoyo: true,
            repeat: 5
          });

          // Tombe après 0.5s
          plat.fallTimer = this.time.delayedCall(500, () => {
            plat.isFalling = true;
            plat.body.setImmovable(false);
            plat.body.setAllowGravity(true);
            plat.body.setGravityY(800);
            plat.warning.setVisible(false);
            this.playSound('land');
          });
        }
      });
    });

    // Bounce pads - utilise lastVelocityY car velocity.y est déjà 0 après résolution de collision
    this.bouncePads.forEach(pad => {
      this.physics.add.collider(this.player, pad, () => {
        // lastVelocityY stocke la velocity avant la collision
        if (this.lastVelocityY > 50 || this.player.body.touching.down) {
          this.player.body.setVelocityY(-pad.bounceForce);
          this.playSound('jump');
          this.screenShake(0.01, 50);

          // Animation du spring
          this.tweens.add({
            targets: pad.spring,
            scaleY: 0.3,
            duration: 80,
            yoyo: true,
            ease: 'Bounce.easeOut'
          });

          // Particules
          this.emitParticles(pad.padX, pad.padY - 10, {
            count: 8, colors: [0x44ff44, 0x88ff88, 0xffffff],
            minSpeed: 100, maxSpeed: 200, minSize: 3, maxSize: 6,
            life: 200, angle: -Math.PI/2, spread: Math.PI/3, fadeOut: true
          });

          // Reset double jump
          this.canDoubleJump = true;
          this.hasDoubleJumped = false;
          this.hasDashedInAir = false;
        }
      });
    });

    // Spikes - dégâts mineurs (1/2 coeur)
    if (this.spikes.getChildren().length > 0) {
      this.physics.add.overlap(this.player, this.spikes, () => {
        if (!this.isInvincible) {
          this.takeDamage(2); // 1/2 coeur - hazard mineur
          this.player.body.setVelocityY(-300);
          this.screenShake(0.02, 100);
        }
      });
    }

    // One-way platforms
    this.oneWayPlatforms.forEach(plat => {
      this.physics.add.collider(this.player, plat, null, (player, platform) => {
        return player.body.velocity.y > 0 && player.body.bottom <= platform.body.top + 10;
      }, this);
    });
  }

  // Update des plateformes mobiles (appelé dans update)
  updateMovingPlatforms(delta) {
    this.movingPlatforms.forEach(plat => {
      if (!plat.active) return;

      const dt = delta / 1000;

      if (plat.horizontal) {
        plat.x += plat.speed * plat.direction * dt;
        if (plat.x > plat.startX + plat.range) plat.direction = -1;
        if (plat.x < plat.startX - plat.range) plat.direction = 1;
      } else {
        plat.y += plat.speed * plat.direction * dt;
        if (plat.y > plat.startY + plat.range) plat.direction = -1;
        if (plat.y < plat.startY - plat.range) plat.direction = 1;
      }

      // Mettre à jour le body
      plat.body.updateFromGameObject();

      // Mettre à jour l'indicateur
      if (plat.arrow) {
        plat.arrow.setPosition(plat.x, plat.y);
      }

      // Si le joueur est dessus, le déplacer aussi
      if (this.player.body.touching.down && Math.abs(this.player.y - plat.y + 20) < 10) {
        if (plat.horizontal) {
          this.player.x += plat.speed * plat.direction * dt;
        }
      }
    });

    // Reset des plateformes tombées
    this.fallingPlatforms.forEach(plat => {
      if (plat.isFalling && plat.y > this.WORLD.height + 50) {
        // Respawn après 2s
        if (!plat.respawnTimer) {
          plat.respawnTimer = this.time.delayedCall(2000, () => {
            plat.x = plat.body.x = plat.startX || plat.x;
            plat.y = plat.originalY;
            plat.body.reset(plat.x, plat.originalY);
            plat.body.setImmovable(true);
            plat.body.setAllowGravity(false);
            plat.isFalling = false;
            plat.fallTimer = null;
            plat.respawnTimer = null;
            if (plat.warning) plat.warning.setVisible(true);
            plat.warning.setPosition(plat.x, plat.y);
          });
        }
      }
    });
  }

  generateBossArena() {
    // Boss arenas utilisent la même taille que les niveaux normaux
    this.WORLD = {
      width: 960,
      height: 540,
      groundY: 500
    };

    // Initialiser les groupes de mécaniques (nécessaires pour setupNewMechanicsCollisions)
    this.movingPlatforms = [];
    this.fallingPlatforms = [];
    this.bouncePads = [];
    this.spikes = this.physics.add.staticGroup();
    this.oneWayPlatforms = [];

    const bossNum = Math.floor(this.currentLevel / 5); // 1, 2, 3, 4, 5...
    const bossType = ((bossNum - 1) % 5) + 1; // Cycle 1-5
    const W = this.WORLD.width;
    const H = this.WORLD.height;
    const centerX = W / 2;
    const groundY = this.WORLD.groundY;

    // Murs pour tous les boss
    this.walls.add(this.add.rectangle(6, H / 2, 12, H, 0x3a3a5a));
    this.walls.add(this.add.rectangle(W - 6, H / 2, 12, H, 0x3a3a5a));

    // Zone de mort en bas
    const deathZone = this.add.rectangle(centerX, H + 20, W, 40, 0xff0000, 0);
    this.deathZones.add(deathZone);

    // Arène selon le type de boss
    switch (bossType) {
      case 1: this.createArenaCharger(); break;
      case 2: this.createArenaSpinner(); break;
      case 3: this.createArenaSplitter(); break;
      case 4: this.createArenaGuardian(); break;
      case 5: this.createArenaSummoner(); break;
    }

    // Player spawn - au centre de l'arène au sol (sprite "Sunday" 16x28 scalé x2)
    this.player = this.add.sprite(centerX, groundY - 30, 'player');
    this.player.setScale(2); // 16x28 -> 32x56
    this.physics.add.existing(this.player);
    this.player.body.setSize(14, 26);
    this.player.body.setOffset(1, 1);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, this.WORLD.width, this.WORLD.height + 100);
    this.player.body.setGravityY(this.config.gravity);
    this.player.body.setMaxVelocity(this.config.playerSpeed, 800); // Limiter vitesse X et Y (évite tunneling)
    this.player.setDepth(50);

    // === SETUP CAMÉRA BOSS ===
    this.cameras.main.setBounds(0, 0, this.WORLD.width, this.WORLD.height);
    this.cameras.main.startFollow(this.player, true, this.cameraConfig.lerpX, this.cameraConfig.lerpY);
    this.cameras.main.setDeadzone(this.cameraConfig.deadzone.width, this.cameraConfig.deadzone.height);
    this.cameras.main.setZoom(1.0); // Même taille que niveaux normaux

    // Collisions
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.walls, this.touchWall, null, this);
    this.physics.add.overlap(this.player, this.deathZones, this.fallDeath, null, this);
    this.physics.add.overlap(this.player, this.bullets, this.hitBullet, null, this);
    // Projectiles bloqués par les plateformes (sauf perçants - le process callback empêche la collision)
    this.physics.add.collider(this.bullets, this.platforms, this.bulletHitPlatform, this.shouldBulletCollide, this);
    this.physics.add.collider(this.bullets, this.walls, this.bulletHitPlatform, this.shouldBulletCollide, this);

    // Collisions des nouvelles mécaniques (bounce pads, moving, falling, one-way, spikes)
    this.setupNewMechanicsCollisions();

    // Porte (cachée jusqu'à la victoire) - rectangle 32x64
    this.door = this.add.rectangle(this.WORLD.width - 40, this.WORLD.groundY - 32, 32, 64, 0x444444);
    this.door.setStrokeStyle(3, 0x888888);
    this.door.setAlpha(0.3); // Porte cachée jusqu'à la victoire
    this.doorLocked = true;
    this.physics.add.existing(this.door, true);
    // Hitbox petite pour que le joueur soit vraiment dedans
    this.door.body.setSize(20, 50);
    this.physics.add.overlap(this.player, this.door, this.enterDoor, null, this);

    // Spawn le boss après un court délai
    this.time.delayedCall(500, () => this.spawnBoss());
  }

  // === ARÈNE 1 : CHARGER - Arène compacte avec refuges ===
  createArenaCharger() {
    const cx = this.WORLD.width / 2;
    const gy = this.WORLD.groundY;
    const W = this.WORLD.width;

    // Sol avec gaps
    this.addPlatform(80, gy, 140, 16);
    this.addPlatform(cx, gy, 240, 16);
    this.addPlatform(W - 80, gy, 140, 16);

    // Niveau 1 - Refuges bas
    this.addPlatform(140, gy - 72, 70, 12, 0x5a5a7a);
    this.addPlatform(cx - 140, gy - 72, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 140, gy - 72, 70, 12, 0x5a5a7a);
    this.addPlatform(W - 140, gy - 72, 70, 12, 0x5a5a7a);

    // Niveau 2 - Plateformes moyennes
    this.addPlatform(cx - 220, gy - 140, 80, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 128, 100, 12, 0x5a5a7a);
    this.addPlatform(cx + 220, gy - 140, 80, 12, 0x5a5a7a);

    // Niveau 3 - Plateformes hautes
    this.addPlatform(cx - 120, gy - 208, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 120, gy - 208, 70, 12, 0x5a5a7a);

    // Sommet
    this.addPlatform(cx, gy - 272, 90, 12, 0x6a6a8a);

    // Bounce pads
    this.createBouncePad(40, gy - 15, 35, 450);
    this.createBouncePad(W - 40, gy - 15, 35, 450);
  }

  // === ARÈNE 2 : SPINNER - Couvertures contre les tirs circulaires ===
  createArenaSpinner() {
    const cx = this.WORLD.width / 2;
    const gy = this.WORLD.groundY;
    const W = this.WORLD.width;

    // Sol en segments
    this.addPlatform(120, gy, 200, 16);
    this.addPlatform(cx, gy, 160, 16);
    this.addPlatform(W - 120, gy, 200, 16);

    // Piliers - couvertures contre les tirs
    const pillarColor = 0x6a5a7a;
    this.addPlatform(cx - 200, gy - 56, 20, 100, pillarColor);
    this.addPlatform(cx - 60, gy - 56, 20, 100, pillarColor);
    this.addPlatform(cx + 60, gy - 56, 20, 100, pillarColor);
    this.addPlatform(cx + 200, gy - 56, 20, 100, pillarColor);

    // Plateformes sur les piliers
    this.addPlatform(cx - 200, gy - 116, 65, 12, 0x5a5a7a);
    this.addPlatform(cx - 60, gy - 116, 55, 12, 0x5a5a7a);
    this.addPlatform(cx + 60, gy - 116, 55, 12, 0x5a5a7a);
    this.addPlatform(cx + 200, gy - 116, 65, 12, 0x5a5a7a);

    // Niveau intermédiaire
    this.addPlatform(cx - 128, gy - 180, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 128, gy - 180, 70, 12, 0x5a5a7a);

    // Niveau haut
    this.addPlatform(cx - 240, gy - 240, 80, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 232, 80, 12, 0x6a6a8a);
    this.addPlatform(cx + 240, gy - 240, 80, 12, 0x5a5a7a);

    // Micro-piliers hauts
    this.addPlatform(cx - 140, gy - 208, 12, 40, pillarColor);
    this.addPlatform(cx + 140, gy - 208, 12, 40, pillarColor);

    // One-way platforms
    this.createOneWayPlatform(80, gy - 72, 55);
    this.createOneWayPlatform(W - 80, gy - 72, 55);
  }

  // === ARÈNE 3 : SPLITTER - Arène ouverte avec mobilité ===
  createArenaSplitter() {
    const cx = this.WORLD.width / 2;
    const gy = this.WORLD.groundY;
    const W = this.WORLD.width;

    // Sol segmenté
    this.addPlatform(72, gy, 112, 16);
    this.addPlatform(cx - 180, gy, 112, 16);
    this.addPlatform(cx + 180, gy, 112, 16);
    this.addPlatform(W - 72, gy, 112, 16);

    // Niveau 1 - Arc de plateformes basses
    this.addPlatform(cx - 260, gy - 72, 65, 12, 0x5a5a7a);
    this.addPlatform(cx - 140, gy - 80, 65, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 64, 80, 12, 0x5a5a7a);
    this.addPlatform(cx + 140, gy - 80, 65, 12, 0x5a5a7a);
    this.addPlatform(cx + 260, gy - 72, 65, 12, 0x5a5a7a);

    // Niveau 2 - Escaliers montants
    this.addPlatform(cx - 220, gy - 144, 70, 12, 0x5a5a7a);
    this.addPlatform(cx - 80, gy - 152, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 80, gy - 152, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 220, gy - 144, 70, 12, 0x5a5a7a);

    // Niveau 3 - Zone haute
    this.addPlatform(cx - 160, gy - 216, 80, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 208, 90, 12, 0x6a6a8a);
    this.addPlatform(cx + 160, gy - 216, 80, 12, 0x5a5a7a);

    // Sommet
    this.addPlatform(cx - 80, gy - 280, 65, 12, 0x5a5a7a);
    this.addPlatform(cx + 80, gy - 280, 65, 12, 0x5a5a7a);

    // Moving platforms
    this.createMovingPlatform(cx - 280, gy - 112, 55, 12, { horizontal: true, distance: 120, speed: 80 });
    this.createMovingPlatform(cx + 280, gy - 112, 55, 12, { horizontal: true, distance: 120, speed: 80 });

    // Bounce pad central
    this.createBouncePad(cx, gy + 25, 40, 500);
  }

  // === ARÈNE 4 : GUARDIAN - Architecture verticale ===
  createArenaGuardian() {
    const cx = this.WORLD.width / 2;
    const gy = this.WORLD.groundY;
    const W = this.WORLD.width;

    // Sol minimal aux extrémités
    this.addPlatform(60, gy, 100, 16);
    this.addPlatform(W - 60, gy, 100, 16);

    // Niveau 1 - Base
    this.addPlatform(cx - 240, gy - 56, 80, 12, 0x5a5a7a);
    this.addPlatform(cx - 120, gy - 64, 80, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 52, 100, 12, 0x5a5a7a);
    this.addPlatform(cx + 120, gy - 64, 80, 12, 0x5a5a7a);
    this.addPlatform(cx + 240, gy - 56, 80, 12, 0x5a5a7a);

    // Niveau 2 - Intermédiaire
    this.addPlatform(cx - 200, gy - 120, 70, 12, 0x5a5a7a);
    this.addPlatform(cx - 60, gy - 128, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 60, gy - 128, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 200, gy - 120, 70, 12, 0x5a5a7a);

    // Niveau 3 - Progression vers le haut
    this.addPlatform(cx - 140, gy - 188, 80, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 180, 90, 12, 0x6a6a8a);
    this.addPlatform(cx + 140, gy - 188, 80, 12, 0x5a5a7a);

    // Niveau 4 - Zone haute
    this.addPlatform(cx - 220, gy - 240, 70, 12, 0x5a5a7a);
    this.addPlatform(cx - 80, gy - 248, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 80, gy - 248, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 220, gy - 240, 70, 12, 0x5a5a7a);

    // Sommet
    this.addPlatform(cx, gy - 304, 80, 12, 0x6a6a8a);

    // Falling platforms
    this.createFallingPlatform(cx - 280, gy - 88, 50, 12);
    this.createFallingPlatform(cx + 280, gy - 88, 50, 12);

    // One-way
    this.createOneWayPlatform(cx - 180, gy - 212, 50);
    this.createOneWayPlatform(cx + 180, gy - 212, 50);
  }

  // === ARÈNE 5 : SUMMONER - Arène avec couloirs ===
  createArenaSummoner() {
    const cx = this.WORLD.width / 2;
    const gy = this.WORLD.groundY;
    const W = this.WORLD.width;

    // Sol en trois sections
    this.addPlatform(100, gy, 160, 16);
    this.addPlatform(cx, gy, 200, 16);
    this.addPlatform(W - 100, gy, 160, 16);

    // Murs intérieurs - créent des couloirs
    const wallColor = 0x5a4a6a;
    this.addPlatform(cx - 180, gy - 80, 18, 140, wallColor);
    this.addPlatform(cx + 180, gy - 80, 18, 140, wallColor);

    // Niveau 1 - Zone basse
    this.addPlatform(80, gy - 72, 70, 12, 0x5a5a7a);
    this.addPlatform(cx - 80, gy - 80, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 80, gy - 80, 70, 12, 0x5a5a7a);
    this.addPlatform(W - 80, gy - 72, 70, 12, 0x5a5a7a);

    // Niveau 2 - Au-dessus des murs
    this.addPlatform(cx - 180, gy - 160, 70, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 152, 80, 12, 0x6a6a8a);
    this.addPlatform(cx + 180, gy - 160, 70, 12, 0x5a5a7a);

    // Niveau 3 - Zones latérales hautes
    this.addPlatform(cx - 260, gy - 140, 80, 12, 0x5a5a7a);
    this.addPlatform(cx - 100, gy - 208, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 100, gy - 208, 70, 12, 0x5a5a7a);
    this.addPlatform(cx + 260, gy - 140, 80, 12, 0x5a5a7a);

    // Niveau 4 - Zone haute
    this.addPlatform(cx - 200, gy - 260, 70, 12, 0x5a5a7a);
    this.addPlatform(cx, gy - 272, 100, 12, 0x6a6a8a);
    this.addPlatform(cx + 200, gy - 260, 70, 12, 0x5a5a7a);

    // Sommet
    this.addPlatform(cx - 80, gy - 328, 65, 12, 0x5a5a7a);
    this.addPlatform(cx + 80, gy - 328, 65, 12, 0x5a5a7a);

    // Moving platforms dans les couloirs
    this.createMovingPlatform(cx - 260, gy - 200, 50, 12, { vertical: true, distance: 80, speed: 60 });
    this.createMovingPlatform(cx + 260, gy - 200, 50, 12, { vertical: true, distance: 80, speed: 60 });

    // Spikes en bas dans les gaps
    this.createSpikes(cx - 240, gy + 5, 50);
    this.createSpikes(cx + 240, gy + 5, 50);
  }

  spawnBoss() {
    const bossNum = Math.floor(this.currentLevel / 5);
    const bossType = ((bossNum - 1) % 10) + 1; // Cycle 1-10 (10 boss uniques)

    // Config de base selon le type (tailles réduites pour arène 960x540)
    const bossConfigs = {
      // === CYCLE 1 : Boss classiques ===
      1: { name: 'CHARGER', color: 0xaa00aa, stroke: 0xff00ff, health: 5, size: 35 },
      2: { name: 'SPINNER', color: 0x00aaaa, stroke: 0x00ffff, health: 6, size: 32 },
      3: { name: 'SPLITTER', color: 0xaaaa00, stroke: 0xffff00, health: 4, size: 40 },
      4: { name: 'GUARDIAN', color: 0x0066aa, stroke: 0x0099ff, health: 8, size: 38 },
      5: { name: 'SUMMONER', color: 0xaa0066, stroke: 0xff0099, health: 6, size: 30 },
      // === CYCLE 2 : Boss avancés ===
      6: { name: 'CRUSHER', color: 0x884400, stroke: 0xcc6600, health: 7, size: 50 },    // Gros, slams
      7: { name: 'PHANTOM', color: 0x6600aa, stroke: 0x9933ff, health: 5, size: 28 },   // Petit, clones
      8: { name: 'BERSERKER', color: 0xcc0000, stroke: 0xff3333, health: 10, size: 42 }, // Rage mode
      9: { name: 'ARCHITECT', color: 0x00aa44, stroke: 0x00ff66, health: 6, size: 34 }, // Construit
      10: { name: 'TWINS', color: 0xff6600, stroke: 0xffaa00, health: 4, size: 30 }     // Duo (x2)
    };

    const config = bossConfigs[bossType];
    const healthMultiplier = 1 + (bossNum - 1) * 0.5; // Scaling avec les cycles

    // Reset des flags
    this.bossShotPaused = false;
    this.bossHitCooldown = false;
    this.bossVulnerable = true;
    this.bossDashCooldown = false;
    this.bossDashing = false;
    this.bossDefeated = false;
    this.bossType = bossType;

    // Position du boss au centre du monde (adapté pour 960x540)
    const bossX = this.WORLD.width / 2;
    const bossY = this.WORLD.groundY - 200;

    // Créer le boss avec forme primitive simple (hitbox = visuel)
    this.boss = this.add.rectangle(bossX, bossY, config.size, config.size, config.color);
    this.boss.setStrokeStyle(4, config.stroke);
    this.physics.add.existing(this.boss);
    this.boss.body.setAllowGravity(false);
    this.boss.body.setCollideWorldBounds(true);

    // Œil animé au centre du boss
    const eyeRadius = config.size * 0.22;
    this.bossEyeRadius = eyeRadius;
    this.bossEye = this.add.circle(bossX, bossY, eyeRadius, 0xffffff);
    this.bossEye.setDepth(31);
    this.bossPupil = this.add.circle(bossX, bossY, eyeRadius * 0.45, 0x111111);
    this.bossPupil.setDepth(32);
    // Reflet dans l'œil
    this.bossEyeGlint = this.add.circle(bossX + eyeRadius * 0.25, bossY - eyeRadius * 0.25, eyeRadius * 0.15, 0xffffff);
    this.bossEyeGlint.setDepth(33);

    // Paupières (demi-cercles qui recouvrent l'œil pour le clignotement)
    this.bossEyelidTop = this.add.ellipse(bossX, bossY - eyeRadius * 0.5, eyeRadius * 2.4, eyeRadius * 1.2, config.color);
    this.bossEyelidTop.setDepth(34);
    this.bossEyelidTop.setOrigin(0.5, 1);
    this.bossEyelidTop.scaleY = 0;
    this.bossEyelidBottom = this.add.ellipse(bossX, bossY + eyeRadius * 0.5, eyeRadius * 2.4, eyeRadius * 1.2, config.color);
    this.bossEyelidBottom.setDepth(34);
    this.bossEyelidBottom.setOrigin(0.5, 0);
    this.bossEyelidBottom.scaleY = 0;

    // Timer pour le clignotement aléatoire
    this.bossBlinkTimer = this.time.addEvent({
      delay: Phaser.Math.Between(2000, 4500),
      callback: () => {
        if (!this.boss || !this.boss.active) return;
        // Fermer les paupières rapidement puis rouvrir
        this.tweens.add({
          targets: [this.bossEyelidTop, this.bossEyelidBottom],
          scaleY: 1,
          duration: 60,
          yoyo: true,
          hold: 50,
          onComplete: () => {
            if (this.bossBlinkTimer) {
              this.bossBlinkTimer.delay = Phaser.Math.Between(2000, 4500);
            }
          }
        });
      },
      loop: true
    });

    // Pas de bossVisuals séparé - le boss EST le visuel
    this.bossVisuals = null;

    // Particules ambiantes du boss
    this.startBossAmbientParticles(bossType, config);

    this.bossHealth = Math.floor(config.health * healthMultiplier);
    this.bossMaxHealth = this.bossHealth;
    this.bossPhase = 1;
    this.boss.moveSpeed = 80 + bossNum * 15;
    this.bossColor = config.color;

    // === PROPRIÉTÉS PHYSIQUES RÉALISTES ===
    // Chaque boss a des caractéristiques de mouvement uniques
    const physicsProfiles = {
      1: { // CHARGER - Lourd, ancré au sol comme un taureau
        mass: 1.5,
        acceleration: 400,
        maxSpeed: 200,
        drag: 0.92,
        floatAmplitude: 0, // PAS de flottement - il est ANCRÉ
        floatSpeed: 0,
        lungeForce: 600,
        weight: 'heavy'
      },
      2: { // SPINNER - Léger, flottant
        mass: 0.6,
        acceleration: 300,
        maxSpeed: 150,
        drag: 0.96,
        floatAmplitude: 8,
        floatSpeed: 0.004,
        driftForce: 100,
        weight: 'light'
      },
      3: { // SPLITTER - Rebondissant, élastique
        mass: 0.8,
        acceleration: 350,
        maxSpeed: 180,
        drag: 0.88,
        floatAmplitude: 5,
        floatSpeed: 0.003,
        bounceForce: 200,
        weight: 'bouncy'
      },
      4: { // GUARDIAN - Massif, lent mais implacable
        mass: 2.5,
        acceleration: 200,
        maxSpeed: 120,
        drag: 0.85,
        floatAmplitude: 2,
        floatSpeed: 0.001,
        impactForce: 400,
        weight: 'massive'
      },
      5: { // SUMMONER - Mystique, dérive fluide
        mass: 0.5,
        acceleration: 250,
        maxSpeed: 140,
        drag: 0.97,
        floatAmplitude: 12,
        floatSpeed: 0.003,
        warpDrift: 80,
        weight: 'ethereal'
      },
      // === CYCLE 2 : Boss avancés ===
      6: { // CRUSHER - Ultra lourd, slams dévastateurs
        mass: 4.0,
        acceleration: 500,
        maxSpeed: 100,
        drag: 0.75,
        floatAmplitude: 1,
        floatSpeed: 0.001,
        slamForce: 800,
        weight: 'crushing'
      },
      7: { // PHANTOM - Spectral, mouvement imprévisible
        mass: 0.3,
        acceleration: 400,
        maxSpeed: 250,
        drag: 0.98,
        floatAmplitude: 15,
        floatSpeed: 0.006,
        phaseShift: 150,
        weight: 'spectral'
      },
      8: { // BERSERKER - Devient plus rapide avec la rage
        mass: 1.2,
        acceleration: 350,
        maxSpeed: 180,
        drag: 0.90,
        floatAmplitude: 4,
        floatSpeed: 0.002,
        rageMultiplier: 1.5,
        weight: 'raging'
      },
      9: { // ARCHITECT - Précis, méthodique
        mass: 1.0,
        acceleration: 280,
        maxSpeed: 160,
        drag: 0.93,
        floatAmplitude: 3,
        floatSpeed: 0.002,
        buildForce: 100,
        weight: 'calculated'
      },
      10: { // TWINS - Synchronisés, agiles
        mass: 0.7,
        acceleration: 320,
        maxSpeed: 200,
        drag: 0.91,
        floatAmplitude: 6,
        floatSpeed: 0.004,
        syncForce: 120,
        weight: 'synchronized'
      }
    };

    const physics = physicsProfiles[bossType] || physicsProfiles[1];
    this.boss.physics = physics;
    this.boss.targetVelX = 0;
    this.boss.targetVelY = 0;
    this.boss.floatOffset = Math.random() * Math.PI * 2; // Désynchroniser le flottement
    this.boss.baseY = bossY; // Position Y de base pour le flottement

    // Créer l'UI du boss
    this.createBossUI(config.name, bossNum, config.stroke);

    // Collision avec le joueur
    this.physics.add.overlap(this.player, this.boss, this.hitBoss, null, this);

    // === INTRO DU BOSS - Séquence cinématique ===
    this.bossIntroPlaying = true;
    this.bossShotPaused = true; // Pas d'attaque pendant l'intro

    // Animation d'apparition du boss
    const eyeElements = [this.boss, this.bossEye, this.bossPupil, this.bossEyeGlint, this.bossEyelidTop, this.bossEyelidBottom];
    eyeElements.forEach(el => {
      el.setAlpha(0);
      el.setScale(0.3);
    });

    // Phase 1: Le boss apparaît lentement (0 -> 1s)
    this.tweens.add({
      targets: eyeElements,
      alpha: 1,
      scale: 1,
      duration: 800,
      ease: 'Back.easeOut'
    });

    // Phase 2: Afficher "GET READY" (0.5s)
    this.time.delayedCall(500, () => {
      const readyText = this.add.text(this.WORLD.width / 2, this.WORLD.height / 2 - 50, 'GET READY', {
        fontSize: '32px',
        fontFamily: 'Arial Black, sans-serif',
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
      }).setOrigin(0.5).setDepth(100).setAlpha(0);

      this.tweens.add({
        targets: readyText,
        alpha: 1,
        y: readyText.y - 20,
        duration: 300,
        ease: 'Power2',
        onComplete: () => {
          this.time.delayedCall(600, () => {
            this.tweens.add({
              targets: readyText,
              alpha: 0,
              duration: 200,
              onComplete: () => readyText.destroy()
            });
          });
        }
      });
    });

    // Phase 3: Afficher le nom du boss (1.2s)
    this.time.delayedCall(1200, () => {
      const bossNameText = this.add.text(this.WORLD.width / 2, this.WORLD.height / 2, config.name, {
        fontSize: '48px',
        fontFamily: 'Arial Black, sans-serif',
        fill: '#' + config.stroke.toString(16).padStart(6, '0'),
        stroke: '#000000',
        strokeThickness: 6
      }).setOrigin(0.5).setDepth(100).setAlpha(0).setScale(0.5);

      this.tweens.add({
        targets: bossNameText,
        alpha: 1,
        scale: 1.2,
        duration: 400,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.time.delayedCall(800, () => {
            this.tweens.add({
              targets: bossNameText,
              alpha: 0,
              scale: 1.5,
              duration: 300,
              onComplete: () => bossNameText.destroy()
            });
          });
        }
      });
    });

    // Phase 4: Démarrer le combat (2.5s)
    this.time.delayedCall(2500, () => {
      this.bossIntroPlaying = false;
      this.bossShotPaused = false;

      // Démarrer la musique du boss
      this.startBossMusic(bossType);

      // Flash pour signaler le début du combat
      this.cameras.main.flash(200, 255, 255, 255, false);

      // Initialiser le comportement du boss maintenant
      switch (bossType) {
        case 1: this.initBossCharger(); break;
        case 2: this.initBossSpinner(); break;
        case 3: this.initBossSplitter(); break;
        case 4: this.initBossGuardian(); break;
        case 5: this.initBossSummoner(); break;
        case 6: this.initBossCrusher(); break;
        case 7: this.initBossPhantom(); break;
        case 8: this.initBossBerserker(); break;
        case 9: this.initBossArchitect(); break;
        case 10: this.initBossTwins(); break;
      }
    });
  }

  // Créer la forme visuelle unique du boss
  createBossShape(bossType, config) {
    const container = this.add.container(400, 250);
    const s = config.size;

    switch (bossType) {
      case 1: // CHARGER - Taureau/Rhino agressif
        {
          // Corps principal (hexagone allongé)
          const body = this.add.polygon(0, 0, [
            -s*0.6, 0, -s*0.4, -s*0.4, s*0.3, -s*0.35,
            s*0.6, 0, s*0.3, s*0.35, -s*0.4, s*0.4
          ], config.color);
          body.setStrokeStyle(3, config.stroke);

          // Cornes
          const hornL = this.add.triangle(-s*0.2, -s*0.35, 0, 0, -15, -25, 10, -20, 0xff4444);
          const hornR = this.add.triangle(s*0.15, -s*0.35, 0, 0, 15, -25, -10, -20, 0xff4444);

          // Yeux furieux
          const eyeL = this.add.circle(-s*0.15, -s*0.1, 6, 0xff0000);
          const eyeR = this.add.circle(s*0.15, -s*0.1, 6, 0xff0000);

          // Naseaux fumants
          const nostrilL = this.add.circle(s*0.35, s*0.05, 4, 0x220000);
          const nostrilR = this.add.circle(s*0.35, s*0.15, 4, 0x220000);

          container.add([body, hornL, hornR, eyeL, eyeR, nostrilL, nostrilR]);
          container.bossBody = body;
        }
        break;

      case 2: // SPINNER - Forme tourbillonnante
        {
          // Anneaux concentriques
          const ring1 = this.add.circle(0, 0, s*0.5, 0x000000, 0);
          ring1.setStrokeStyle(8, config.color);
          const ring2 = this.add.circle(0, 0, s*0.35, 0x000000, 0);
          ring2.setStrokeStyle(5, config.stroke);
          const ring3 = this.add.circle(0, 0, s*0.2, config.color);

          // Lames rotatives
          const blades = [];
          for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const blade = this.add.triangle(
              Math.cos(angle) * s*0.35, Math.sin(angle) * s*0.35,
              0, -12, 20, 6, -20, 6, config.stroke
            );
            blade.setRotation(angle + Math.PI/2);
            blades.push(blade);
          }

          // Œil central
          const eye = this.add.circle(0, 0, 8, 0x00ffff);
          eye.setStrokeStyle(2, 0xffffff);

          container.add([ring1, ring2, ...blades, ring3, eye]);
          container.blades = blades;
          container.bossBody = ring1;
        }
        break;

      case 3: // SPLITTER - Blob instable
        {
          // Corps amorphe (plusieurs cercles qui se chevauchent)
          const blobs = [];
          const blobPositions = [
            {x: 0, y: 0, r: s*0.4},
            {x: -s*0.25, y: -s*0.15, r: s*0.25},
            {x: s*0.25, y: -s*0.1, r: s*0.28},
            {x: -s*0.15, y: s*0.2, r: s*0.22},
            {x: s*0.2, y: s*0.18, r: s*0.2}
          ];
          blobPositions.forEach(p => {
            const blob = this.add.circle(p.x, p.y, p.r, config.color, 0.8);
            blob.setStrokeStyle(2, config.stroke);
            blobs.push(blob);
          });

          // Noyaux internes (mini-splitters)
          const nuclei = [];
          for (let i = 0; i < 3; i++) {
            const nucleus = this.add.circle(
              (Math.random() - 0.5) * s*0.3,
              (Math.random() - 0.5) * s*0.3,
              6, 0xffff00
            );
            nuclei.push(nucleus);
          }

          container.add([...blobs, ...nuclei]);
          container.blobs = blobs;
          container.nuclei = nuclei;
          container.bossBody = blobs[0];
        }
        break;

      case 4: // GUARDIAN - Forteresse blindée
        {
          // Base hexagonale
          const base = this.add.polygon(0, 0, [
            0, -s*0.5, s*0.45, -s*0.25, s*0.45, s*0.25,
            0, s*0.5, -s*0.45, s*0.25, -s*0.45, -s*0.25
          ], config.color);
          base.setStrokeStyle(4, config.stroke);

          // Plaques de blindage
          const plates = [];
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 - Math.PI/2;
            const plate = this.add.rectangle(
              Math.cos(angle) * s*0.32,
              Math.sin(angle) * s*0.32,
              s*0.2, s*0.12, 0x003366
            );
            plate.setRotation(angle);
            plate.setStrokeStyle(2, 0x0066cc);
            plates.push(plate);
          }

          // Cœur énergétique
          const core = this.add.circle(0, 0, s*0.15, 0x00aaff);
          core.setStrokeStyle(3, 0xffffff);

          // Visière
          const visor = this.add.rectangle(0, -s*0.15, s*0.4, 8, 0x00ffff);

          container.add([base, ...plates, core, visor]);
          container.plates = plates;
          container.core = core;
          container.bossBody = base;
        }
        break;

      case 5: // SUMMONER - Entité mystique
        {
          // Robe/Cape flottante
          const robe = this.add.triangle(0, s*0.15, 0, -s*0.3, s*0.4, s*0.35, -s*0.4, s*0.35, config.color);
          robe.setStrokeStyle(3, config.stroke);

          // Capuche
          const hood = this.add.circle(0, -s*0.2, s*0.25, 0x220033);
          hood.setStrokeStyle(2, config.stroke);

          // Yeux lumineux dans l'ombre
          const eyeL = this.add.circle(-s*0.1, -s*0.2, 5, 0xff00ff);
          const eyeR = this.add.circle(s*0.1, -s*0.2, 5, 0xff00ff);

          // Mains avec orbes magiques
          const handL = this.add.circle(-s*0.35, 0, 8, config.color);
          const orbL = this.add.circle(-s*0.35, 0, 12, 0xff00ff, 0.5);
          const handR = this.add.circle(s*0.35, 0, 8, config.color);
          const orbR = this.add.circle(s*0.35, 0, 12, 0xff00ff, 0.5);

          // Symboles mystiques flottants
          const symbols = [];
          for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 - Math.PI/2;
            const symbol = this.add.star(
              Math.cos(angle) * s*0.5,
              Math.sin(angle) * s*0.5,
              5, 4, 8, 0xff66cc, 0.6
            );
            symbols.push(symbol);
          }

          container.add([robe, hood, eyeL, eyeR, handL, orbL, handR, orbR, ...symbols]);
          container.symbols = symbols;
          container.orbs = [orbL, orbR];
          container.bossBody = robe;
        }
        break;

      case 6: // CRUSHER - Masse colossale
        {
          // Corps principal massif (bloc lourd)
          const body = this.add.rectangle(0, 0, s*1.2, s*0.9, config.color);
          body.setStrokeStyle(5, config.stroke);

          // Plaques de métal/roche
          const plateTop = this.add.rectangle(0, -s*0.35, s*0.9, s*0.15, 0x553311);
          plateTop.setStrokeStyle(2, 0x886633);
          const plateBot = this.add.rectangle(0, s*0.35, s*0.9, s*0.15, 0x553311);
          plateBot.setStrokeStyle(2, 0x886633);

          // Fissures/détails
          const crack1 = this.add.line(0, 0, -s*0.3, -s*0.2, s*0.1, s*0.15, 0x221100);
          crack1.setLineWidth(3);
          const crack2 = this.add.line(0, 0, s*0.2, -s*0.1, s*0.4, s*0.2, 0x221100);
          crack2.setLineWidth(2);

          // Yeux menaçants profonds
          const eyeL = this.add.circle(-s*0.25, -s*0.1, 10, 0x000000);
          const pupilL = this.add.circle(-s*0.25, -s*0.1, 6, 0xff3300);
          const eyeR = this.add.circle(s*0.25, -s*0.1, 10, 0x000000);
          const pupilR = this.add.circle(s*0.25, -s*0.1, 6, 0xff3300);

          // Poids/chaînes
          const chain1 = this.add.rectangle(-s*0.5, s*0.45, 8, 20, 0x444444);
          const chain2 = this.add.rectangle(s*0.5, s*0.45, 8, 20, 0x444444);

          container.add([body, plateTop, plateBot, crack1, crack2, eyeL, pupilL, eyeR, pupilR, chain1, chain2]);
          container.bossBody = body;
        }
        break;

      case 7: // PHANTOM - Entité spectrale
        {
          // Corps translucide principal
          const ghostBody = this.add.ellipse(0, 0, s*0.8, s*1.0, config.color, 0.6);
          ghostBody.setStrokeStyle(3, config.stroke);

          // Queue spectrale
          const tail = this.add.triangle(0, s*0.4, -s*0.25, 0, s*0.25, 0, 0, s*0.5, config.color, 0.4);

          // Capuche/tête
          const hood = this.add.ellipse(0, -s*0.2, s*0.6, s*0.5, 0x330066, 0.8);
          hood.setStrokeStyle(2, config.stroke);

          // Yeux fantomatiques (vides mais lumineux)
          const eyeL = this.add.ellipse(-s*0.12, -s*0.2, 12, 16, 0x000000);
          const glowL = this.add.ellipse(-s*0.12, -s*0.22, 6, 8, 0xcc66ff);
          const eyeR = this.add.ellipse(s*0.12, -s*0.2, 12, 16, 0x000000);
          const glowR = this.add.ellipse(s*0.12, -s*0.22, 6, 8, 0xcc66ff);

          // Mains spectrales
          const handL = this.add.ellipse(-s*0.4, s*0.1, 15, 20, config.color, 0.5);
          const handR = this.add.ellipse(s*0.4, s*0.1, 15, 20, config.color, 0.5);

          container.add([tail, ghostBody, hood, eyeL, glowL, eyeR, glowR, handL, handR]);
          container.ghostBody = ghostBody;
          container.bossBody = ghostBody;
        }
        break;

      case 8: // BERSERKER - Guerrier enragé
        {
          // Corps musclé (trapèze inversé)
          const torso = this.add.polygon(0, 0, [
            -s*0.4, -s*0.35, s*0.4, -s*0.35,
            s*0.5, s*0.3, -s*0.5, s*0.3
          ], config.color);
          torso.setStrokeStyle(4, config.stroke);

          // Tête avec casque
          const head = this.add.circle(0, -s*0.45, s*0.22, 0x660000);
          head.setStrokeStyle(3, 0xaa0000);

          // Cornes du casque
          const hornL = this.add.triangle(-s*0.2, -s*0.55, 0, 0, -10, -30, 8, -25, 0xaa0000);
          const hornR = this.add.triangle(s*0.2, -s*0.55, 0, 0, 10, -30, -8, -25, 0xaa0000);

          // Yeux de rage (rouges brillants)
          const eyeL = this.add.circle(-s*0.1, -s*0.45, 7, 0xff0000);
          const eyeR = this.add.circle(s*0.1, -s*0.45, 7, 0xff0000);

          // Bras musclés
          const armL = this.add.rectangle(-s*0.55, 0, 15, s*0.5, config.color);
          armL.setStrokeStyle(2, config.stroke);
          const armR = this.add.rectangle(s*0.55, 0, 15, s*0.5, config.color);
          armR.setStrokeStyle(2, config.stroke);

          // Arme (masse/hache)
          const weapon = this.add.rectangle(s*0.7, -s*0.1, 12, s*0.6, 0x444444);
          const blade = this.add.triangle(s*0.85, -s*0.3, 0, 0, 25, 15, 25, -15, 0x888888);

          // Aura de rage
          container.rageGlow = this.add.circle(0, 0, s*0.6, 0xff0000, 0.1);

          container.add([container.rageGlow, torso, head, hornL, hornR, eyeL, eyeR, armL, armR, weapon, blade]);
          container.eyes = [eyeL, eyeR];
          container.bossBody = torso;
        }
        break;

      case 9: // ARCHITECT - Constructeur mécanique
        {
          // Corps géométrique parfait (octogone)
          const body = this.add.polygon(0, 0, [
            -s*0.2, -s*0.45, s*0.2, -s*0.45,
            s*0.45, -s*0.2, s*0.45, s*0.2,
            s*0.2, s*0.45, -s*0.2, s*0.45,
            -s*0.45, s*0.2, -s*0.45, -s*0.2
          ], config.color);
          body.setStrokeStyle(3, config.stroke);

          // Grille de construction interne
          const gridH1 = this.add.line(0, 0, -s*0.3, 0, s*0.3, 0, 0x006622);
          gridH1.setLineWidth(2);
          const gridV1 = this.add.line(0, 0, 0, -s*0.3, 0, s*0.3, 0x006622);
          gridV1.setLineWidth(2);

          // Œil central (scanner)
          const scanner = this.add.circle(0, 0, s*0.12, 0x00ff44);
          scanner.setStrokeStyle(3, 0xffffff);
          const scanLine = this.add.rectangle(0, 0, s*0.2, 3, 0x00ff00);

          // Bras mécaniques (rétractés)
          const arm1 = this.add.rectangle(-s*0.5, 0, s*0.2, 8, 0x336633);
          arm1.setStrokeStyle(2, config.stroke);
          const arm2 = this.add.rectangle(s*0.5, 0, s*0.2, 8, 0x336633);
          arm2.setStrokeStyle(2, config.stroke);
          const arm3 = this.add.rectangle(0, -s*0.5, 8, s*0.2, 0x336633);
          arm3.setStrokeStyle(2, config.stroke);
          const arm4 = this.add.rectangle(0, s*0.5, 8, s*0.2, 0x336633);
          arm4.setStrokeStyle(2, config.stroke);

          container.add([body, gridH1, gridV1, scanner, scanLine, arm1, arm2, arm3, arm4]);
          container.scanner = scanner;
          container.scanLine = scanLine;
          container.arms = [arm1, arm2, arm3, arm4];
          container.bossBody = body;
        }
        break;

      case 10: // TWINS - Deux entités liées
        {
          // Premier jumeau (gauche, agressif)
          const twin1 = this.add.circle(-s*0.4, 0, s*0.35, config.color);
          twin1.setStrokeStyle(3, config.stroke);
          const eye1L = this.add.circle(-s*0.5, -s*0.05, 5, 0xff0000);
          const eye1R = this.add.circle(-s*0.3, -s*0.05, 5, 0xff0000);
          const mouth1 = this.add.arc(-s*0.4, s*0.1, 8, 0, 180, false, 0x660000);

          // Deuxième jumeau (droite, défensif)
          const twin2 = this.add.circle(s*0.4, 0, s*0.35, 0xff9900);
          twin2.setStrokeStyle(3, 0xffcc00);
          const eye2L = this.add.circle(s*0.3, -s*0.05, 5, 0x0066ff);
          const eye2R = this.add.circle(s*0.5, -s*0.05, 5, 0x0066ff);
          const mouth2 = this.add.arc(s*0.4, s*0.1, 8, 180, 360, false, 0x003366);

          // Lien entre les jumeaux (chaîne d'énergie)
          const link = this.add.rectangle(0, 0, s*0.3, 6, 0xffff00, 0.7);
          link.setStrokeStyle(2, 0xffffff);

          // Particules du lien
          const linkGlow = this.add.circle(0, 0, 10, 0xffff00, 0.5);

          container.add([link, linkGlow, twin1, eye1L, eye1R, mouth1, twin2, eye2L, eye2R, mouth2]);
          container.twin1 = twin1;
          container.twin2 = twin2;
          container.link = link;
          container.linkGlow = linkGlow;
          container.bossBody = twin1; // Primary target
        }
        break;
    }

    container.setDepth(30);
    return container;
  }

  // Particules ambiantes du boss
  startBossAmbientParticles(bossType, config) {
    // Nettoyer les anciennes particules
    if (this.bossParticleInterval) {
      clearInterval(this.bossParticleInterval);
    }

    const emitAmbient = () => {
      if (!this.boss || !this.boss.active) {
        clearInterval(this.bossParticleInterval);
        return;
      }

      const x = this.boss.x;
      const y = this.boss.y;

      const size = config.size || 50;

      switch (bossType) {
        case 1: // CHARGER - Aura de rage enflammée
          // Particules orbite autour du boss
          for (let i = 0; i < 3; i++) {
            const angle = Date.now() * 0.003 + (i / 3) * Math.PI * 2;
            const dist = size * 0.7 + Math.sin(Date.now() * 0.01 + i) * 5;
            this.emitParticles(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, {
              count: 1, colors: [0xff4400, 0xff6600, 0xffaa00],
              minSpeed: 5, maxSpeed: 15, minSize: 3, maxSize: 6,
              life: 400, fadeOut: true, shrink: true
            });
          }
          // Fumée s'échappant
          if (Math.random() < 0.4) {
            this.emitParticles(x + (Math.random() - 0.5) * size, y + (Math.random() - 0.5) * size, {
              count: 1, colors: [0x333333, 0x444444],
              minSpeed: 20, maxSpeed: 40, minSize: 4, maxSize: 8,
              life: 500, angle: -Math.PI/2, spread: Math.PI/4, gravity: -80, fadeOut: true
            });
          }
          break;

        case 2: // SPINNER - Traînées circulaires multiples
          for (let i = 0; i < 4; i++) {
            const spinAngle = Date.now() * 0.006 + (i / 4) * Math.PI * 2;
            const dist = size * 0.6;
            this.emitParticles(x + Math.cos(spinAngle) * dist, y + Math.sin(spinAngle) * dist, {
              count: 1, colors: [0x00ffff, 0x00dddd, 0xffffff],
              minSpeed: 5, maxSpeed: 15, minSize: 2, maxSize: 5,
              life: 350, fadeOut: true, shrink: true
            });
          }
          break;

        case 3: // SPLITTER - Bulles instables autour
          for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = size * 0.5 + Math.random() * size * 0.3;
            this.emitParticles(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, {
              count: 1, colors: [0xffff00, 0xdddd00, 0xaaaa00],
              minSpeed: 10, maxSpeed: 30, minSize: 3, maxSize: 8,
              life: 400, fadeOut: true, shape: 'circle'
            });
          }
          break;

        case 4: // GUARDIAN - Champ d'énergie englobant
          for (let i = 0; i < 4; i++) {
            const angle = Date.now() * 0.002 + (i / 4) * Math.PI * 2;
            const dist = size * 0.65;
            this.emitParticles(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, {
              count: 1, colors: [0x0099ff, 0x00bbff, 0x66ddff],
              minSpeed: 3, maxSpeed: 10, minSize: 2, maxSize: 4,
              life: 500, fadeOut: true
            });
          }
          // Étincelles centrales
          if (Math.random() < 0.3) {
            this.emitParticles(x, y, {
              count: 1, color: 0xffffff,
              minSpeed: 20, maxSpeed: 50, minSize: 1, maxSize: 3,
              life: 200, spread: Math.PI * 2
            });
          }
          break;

        case 5: // SUMMONER - Runes magiques orbitales
          for (let i = 0; i < 5; i++) {
            const runeAngle = Date.now() * 0.0025 + (i / 5) * Math.PI * 2;
            const dist = size * 0.7 + Math.sin(Date.now() * 0.005 + i) * 8;
            this.emitParticles(x + Math.cos(runeAngle) * dist, y + Math.sin(runeAngle) * dist, {
              count: 1, colors: [0xff00ff, 0xcc00cc, 0xff66ff],
              minSpeed: 3, maxSpeed: 12, minSize: 2, maxSize: 5,
              life: 600, fadeOut: true
            });
          }
          break;

        case 6: // CRUSHER - Poussière et débris lourds
          // Particules de débris tombant
          if (Math.random() < 0.5) {
            this.emitParticles(x + (Math.random() - 0.5) * size, y + size * 0.3, {
              count: 2, colors: [0x884422, 0x553311, 0x665533],
              minSpeed: 30, maxSpeed: 80, minSize: 4, maxSize: 10,
              life: 500, angle: Math.PI/2, spread: Math.PI/4,
              gravity: 200, fadeOut: true
            });
          }
          // Aura de poids écrasant
          for (let i = 0; i < 2; i++) {
            const angle = Date.now() * 0.001 + (i / 2) * Math.PI;
            this.emitParticles(x + Math.cos(angle) * size * 0.5, y + Math.sin(angle) * size * 0.3, {
              count: 1, colors: [0xcc6600, 0x884400],
              minSpeed: 5, maxSpeed: 15, minSize: 3, maxSize: 6,
              life: 400, fadeOut: true
            });
          }
          break;

        case 7: // PHANTOM - Traînées spectrales et brume
          // Traînée fantomatique
          for (let i = 0; i < 3; i++) {
            const ghostAngle = Date.now() * 0.004 + (i / 3) * Math.PI * 2;
            const dist = size * 0.5 + Math.sin(Date.now() * 0.008 + i * 2) * 15;
            this.emitParticles(x + Math.cos(ghostAngle) * dist, y + Math.sin(ghostAngle) * dist, {
              count: 1, colors: [0x9933ff, 0x6600aa, 0xcc66ff, 0xffffff],
              minSpeed: 5, maxSpeed: 20, minSize: 2, maxSize: 6,
              life: 700, fadeOut: true
            });
          }
          // Effet de phase (apparition/disparition)
          if (Math.random() < 0.2) {
            this.emitParticles(x, y, {
              count: 5, colors: [0xcc66ff, 0x9933ff],
              minSpeed: 50, maxSpeed: 100, minSize: 2, maxSize: 4,
              life: 300, spread: Math.PI * 2, fadeOut: true
            });
          }
          break;

        case 8: // BERSERKER - Aura de rage enflammée
          // Flammes de rage autour
          for (let i = 0; i < 4; i++) {
            const flameAngle = Date.now() * 0.005 + (i / 4) * Math.PI * 2;
            const dist = size * 0.6;
            this.emitParticles(x + Math.cos(flameAngle) * dist, y + Math.sin(flameAngle) * dist, {
              count: 1, colors: [0xff0000, 0xff3300, 0xff6600, 0xffaa00],
              minSpeed: 30, maxSpeed: 80, minSize: 3, maxSize: 8,
              life: 350, angle: -Math.PI/2, spread: Math.PI/3,
              gravity: -100, fadeOut: true
            });
          }
          // Étincelles de fureur
          if (Math.random() < 0.3) {
            this.emitParticles(x + (Math.random() - 0.5) * size * 0.8, y + (Math.random() - 0.5) * size * 0.8, {
              count: 3, colors: [0xffff00, 0xffffff],
              minSpeed: 80, maxSpeed: 150, minSize: 1, maxSize: 3,
              life: 200, spread: Math.PI * 2
            });
          }
          break;

        case 9: // ARCHITECT - Grille holographique et données
          // Particules de données/code
          for (let i = 0; i < 4; i++) {
            const dataAngle = (i / 4) * Math.PI * 2;
            const dist = size * 0.6;
            this.emitParticles(x + Math.cos(dataAngle) * dist, y + Math.sin(dataAngle) * dist, {
              count: 1, colors: [0x00ff44, 0x00aa33, 0x00ff00],
              minSpeed: 10, maxSpeed: 30, minSize: 2, maxSize: 4,
              life: 500, fadeOut: true, shape: 'square'
            });
          }
          // Scan laser
          if (Math.random() < 0.15) {
            const scanY = y + (Math.random() - 0.5) * size;
            this.emitParticles(x, scanY, {
              count: 8, colors: [0x00ff00, 0xffffff],
              minSpeed: 100, maxSpeed: 200, minSize: 1, maxSize: 2,
              life: 200, angle: 0, spread: 0.2
            });
            this.emitParticles(x, scanY, {
              count: 8, colors: [0x00ff00, 0xffffff],
              minSpeed: 100, maxSpeed: 200, minSize: 1, maxSize: 2,
              life: 200, angle: Math.PI, spread: 0.2
            });
          }
          break;

        case 10: // TWINS - Énergie synchronisée entre jumeaux
          // Particules sur le lien
          for (let i = 0; i < 3; i++) {
            const linkX = x + (Math.random() - 0.5) * size * 0.3;
            this.emitParticles(linkX, y, {
              count: 1, colors: [0xffff00, 0xffaa00, 0xffffff],
              minSpeed: 20, maxSpeed: 50, minSize: 2, maxSize: 5,
              life: 400, fadeOut: true
            });
          }
          // Aura twin 1 (orange)
          const t1Angle = Date.now() * 0.004;
          this.emitParticles(x - size * 0.4 + Math.cos(t1Angle) * 15, y + Math.sin(t1Angle) * 15, {
            count: 1, colors: [0xff6600, 0xffaa00],
            minSpeed: 10, maxSpeed: 25, minSize: 2, maxSize: 4,
            life: 350, fadeOut: true
          });
          // Aura twin 2 (bleu)
          const t2Angle = Date.now() * 0.004 + Math.PI;
          this.emitParticles(x + size * 0.4 + Math.cos(t2Angle) * 15, y + Math.sin(t2Angle) * 15, {
            count: 1, colors: [0x0066ff, 0x00aaff],
            minSpeed: 10, maxSpeed: 25, minSize: 2, maxSize: 4,
            life: 350, fadeOut: true
          });
          break;
      }
    };

    // Émettre des particules régulièrement
    this.bossParticleInterval = setInterval(emitAmbient, 100);
  }

  // Animation continue des éléments du boss
  updateBossVisuals(delta) {
    if (!this.boss || !this.boss.active) return;

    // Positionner l'œil au centre du boss
    if (this.bossEye && this.player) {
      const bx = this.boss.x;
      const by = this.boss.y;
      const eyeRadius = this.bossEyeRadius || 12;

      // Positionner l'œil
      this.bossEye.x = bx;
      this.bossEye.y = by;

      // La pupille suit le joueur
      const dx = this.player.x - bx;
      const dy = this.player.y - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxOffset = eyeRadius * 0.4; // La pupille reste dans l'œil
      const offsetX = dist > 0 ? (dx / dist) * maxOffset : 0;
      const offsetY = dist > 0 ? (dy / dist) * maxOffset : 0;
      this.bossPupil.x = bx + offsetX;
      this.bossPupil.y = by + offsetY;

      // Reflet (légèrement décalé, en haut à droite)
      this.bossEyeGlint.x = bx + eyeRadius * 0.25;
      this.bossEyeGlint.y = by - eyeRadius * 0.25;

      // Paupières suivent l'œil
      this.bossEyelidTop.x = bx;
      this.bossEyelidTop.y = by - eyeRadius * 0.5;
      this.bossEyelidBottom.x = bx;
      this.bossEyelidBottom.y = by + eyeRadius * 0.5;
    }

    // Anciennes animations pour bossVisuals (désactivées car on utilise des primitives)
    const time = this.time.now;
    const visuals = this.bossVisuals;
    if (!visuals) return;

    switch (this.bossType) {
      case 2: // SPINNER - Rotation des lames
        if (visuals.blades) {
          visuals.blades.forEach((blade, i) => {
            const baseAngle = (i / 4) * Math.PI * 2;
            blade.setRotation(baseAngle + time * 0.005 + Math.PI/2);
            const dist = 20;
            blade.x = Math.cos(baseAngle + time * 0.005) * dist;
            blade.y = Math.sin(baseAngle + time * 0.005) * dist;
          });
        }
        break;

      case 3: // SPLITTER - Pulsation des blobs
        if (visuals.blobs) {
          visuals.blobs.forEach((blob, i) => {
            const pulse = 1 + Math.sin(time * 0.008 + i) * 0.1;
            blob.setScale(pulse);
          });
        }
        if (visuals.nuclei) {
          visuals.nuclei.forEach((n, i) => {
            n.x = Math.sin(time * 0.003 + i * 2) * 15;
            n.y = Math.cos(time * 0.004 + i * 2) * 15;
          });
        }
        break;

      case 4: // GUARDIAN - Pulsation du cœur
        if (visuals.core) {
          const pulse = 1 + Math.sin(time * 0.01) * 0.15;
          visuals.core.setScale(pulse);
        }
        break;

      case 5: // SUMMONER - Orbite des symboles
        if (visuals.symbols) {
          visuals.symbols.forEach((sym, i) => {
            const angle = (i / 3) * Math.PI * 2 + time * 0.002;
            const dist = 40 + Math.sin(time * 0.005 + i) * 5;
            sym.x = Math.cos(angle) * dist;
            sym.y = Math.sin(angle) * dist;
            sym.setRotation(time * 0.003);
          });
        }
        if (visuals.orbs) {
          visuals.orbs.forEach((orb, i) => {
            const pulse = 0.5 + Math.sin(time * 0.008 + i * Math.PI) * 0.3;
            orb.setAlpha(pulse);
          });
        }
        break;
    }
  }

  // === MISE À JOUR PHYSIQUE DU BOSS (appelée chaque frame) ===
  updateBossPhysics(delta) {
    if (!this.boss || !this.boss.active || !this.boss.physics) return;
    if (this.bossIntroPlaying) return; // Pas de mouvement pendant l'intro

    const phys = this.boss.physics;
    const body = this.boss.body;
    const time = this.time.now;

    // === FLOTTEMENT NATUREL ===
    // Tous les boss flottent légèrement pour un effet vivant
    const floatY = Math.sin(time * phys.floatSpeed + this.boss.floatOffset) * phys.floatAmplitude;
    const floatX = Math.cos(time * phys.floatSpeed * 0.7 + this.boss.floatOffset) * (phys.floatAmplitude * 0.3);

    // === ACCÉLÉRATION PROGRESSIVE ===
    // Au lieu de set velocity directement, on accélère vers la target velocity
    const currentVelX = body.velocity.x;
    const currentVelY = body.velocity.y;

    // Calculer l'accélération nécessaire
    const deltaTime = delta / 1000; // Convertir en secondes
    const accelRate = phys.acceleration * deltaTime;

    // Appliquer l'accélération avec inertie (différent selon le poids)
    let newVelX, newVelY;

    if (phys.weight === 'heavy') {
      // Mouvement lourd: accélération lente, décélération lente
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      newVelX = currentVelX + diffX * 0.03;
      newVelY = currentVelY + diffY * 0.03;
    } else if (phys.weight === 'light') {
      // Mouvement léger: très réactif mais avec dérive
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      newVelX = currentVelX + diffX * 0.08;
      newVelY = currentVelY + diffY * 0.08;
      // Ajout de dérive aléatoire
      newVelX += Math.sin(time * 0.003) * phys.driftForce * deltaTime;
      newVelY += Math.cos(time * 0.004) * phys.driftForce * 0.5 * deltaTime;
    } else if (phys.weight === 'bouncy') {
      // Mouvement élastique: rebondit, overshoot
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Effet ressort
      const springFactor = 0.06;
      newVelX = currentVelX + diffX * springFactor;
      newVelY = currentVelY + diffY * springFactor;
      // Légère oscillation
      if (Math.abs(diffX) < 10) newVelX += Math.sin(time * 0.01) * 20;
    } else if (phys.weight === 'massive') {
      // Mouvement massif: très lent à démarrer et à s'arrêter
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      newVelX = currentVelX + diffX * 0.015;
      newVelY = currentVelY + diffY * 0.015;
      // Tremblement de poids
      if (Math.abs(currentVelX) > 50 || Math.abs(currentVelY) > 50) {
        this.boss.setScale(1 + Math.sin(time * 0.02) * 0.02, 1 - Math.sin(time * 0.02) * 0.02);
      } else {
        this.boss.setScale(1, 1);
      }
    } else if (phys.weight === 'ethereal') {
      // Mouvement éthéré: flotte, dérive mystérieuse
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      newVelX = currentVelX + diffX * 0.05;
      newVelY = currentVelY + diffY * 0.05;
      // Dérive en spirale
      const spiralAngle = time * 0.002;
      newVelX += Math.cos(spiralAngle) * phys.warpDrift * deltaTime;
      newVelY += Math.sin(spiralAngle) * phys.warpDrift * 0.5 * deltaTime;
    } else if (phys.weight === 'crushing') {
      // CRUSHER: Ultra lourd, énorme inertie, slams dévastateurs
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Accélération très lente
      newVelX = currentVelX + diffX * 0.01;
      newVelY = currentVelY + diffY * 0.01;
      // Tremblement constant de poids
      const shakeIntensity = Math.min(speed / 100, 0.03);
      this.boss.setScale(1 + Math.sin(time * 0.03) * shakeIntensity, 1 - Math.sin(time * 0.03) * shakeIntensity);
      // Effet de poussière quand il bouge
      if (speed > 30 && Math.random() < 0.1) {
        this.emitParticles(this.boss.x, this.boss.y + 30, {
          count: 2, colors: [0x884422, 0x553311],
          minSpeed: 20, maxSpeed: 50, minSize: 3, maxSize: 6,
          life: 400, angle: Math.PI/2, spread: Math.PI/3, fadeOut: true
        });
      }
    } else if (phys.weight === 'spectral') {
      // PHANTOM: Phase through reality, imprévisible
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Mouvement fluide mais avec "sauts" spectraux
      newVelX = currentVelX + diffX * 0.06;
      newVelY = currentVelY + diffY * 0.06;
      // Téléportation visuelle micro (shimmer)
      const phaseOffset = Math.sin(time * 0.01) * phys.phaseShift * 0.01;
      newVelX += phaseOffset;
      // Alpha fluctuant
      if (this.boss.alpha !== undefined) {
        this.boss.setAlpha(0.6 + Math.sin(time * 0.005) * 0.3);
      }
    } else if (phys.weight === 'raging') {
      // BERSERKER: Plus rapide quand blessé, momentum rage
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Facteur de rage basé sur la santé perdue
      const healthPercent = this.bossHealth / this.bossMaxHealth;
      const rageFactor = 1 + (1 - healthPercent) * (phys.rageMultiplier - 1);
      newVelX = currentVelX + diffX * 0.045 * rageFactor;
      newVelY = currentVelY + diffY * 0.045 * rageFactor;
      // Effets visuels de rage (tremblement, rougeur)
      if (rageFactor > 1.2) {
        const rageShake = (rageFactor - 1) * 0.05;
        this.boss.x += (Math.random() - 0.5) * rageShake * 5;
      }
    } else if (phys.weight === 'calculated') {
      // ARCHITECT: Précis, pas de dérive, mouvement méthodique
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Mouvement par paliers (pas fluide, mais précis)
      const stepFactor = 0.04;
      if (Math.abs(diffX) > 5) newVelX = currentVelX + Math.sign(diffX) * Math.min(Math.abs(diffX) * stepFactor, 10);
      else newVelX = this.boss.targetVelX;
      if (Math.abs(diffY) > 5) newVelY = currentVelY + Math.sign(diffY) * Math.min(Math.abs(diffY) * stepFactor, 10);
      else newVelY = this.boss.targetVelY;
    } else if (phys.weight === 'synchronized') {
      // TWINS: Mouvement synchronisé, rebond entre jumeaux
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      // Mouvement agile avec oscillation synchronisée
      newVelX = currentVelX + diffX * 0.055;
      newVelY = currentVelY + diffY * 0.055;
      // Oscillation perpendiculaire au mouvement
      const perpAngle = Math.atan2(newVelY, newVelX) + Math.PI/2;
      const syncOscillation = Math.sin(time * 0.008) * phys.syncForce * 0.3 * deltaTime;
      newVelX += Math.cos(perpAngle) * syncOscillation;
      newVelY += Math.sin(perpAngle) * syncOscillation;
    } else {
      // Défaut: mouvement standard
      const diffX = this.boss.targetVelX - currentVelX;
      const diffY = this.boss.targetVelY - currentVelY;
      newVelX = currentVelX + diffX * 0.05;
      newVelY = currentVelY + diffY * 0.05;
    }

    // Appliquer le drag (friction de l'air)
    newVelX *= phys.drag;
    newVelY *= phys.drag;

    // Limiter à la vitesse max
    const speed = Math.sqrt(newVelX * newVelX + newVelY * newVelY);
    if (speed > phys.maxSpeed) {
      const scale = phys.maxSpeed / speed;
      newVelX *= scale;
      newVelY *= scale;
    }

    // Ajouter le flottement à la vélocité
    body.setVelocity(newVelX + floatX * 10, newVelY + floatY * 10);

    // === LIMITES DE LA ZONE ===
    const minX = 100;
    const maxX = this.WORLD.width - 100;
    const minY = 100;
    const maxY = this.WORLD.groundY - 80;

    // Rebond doux sur les bords (pas instant)
    if (this.boss.x < minX) {
      this.boss.targetVelX = Math.abs(this.boss.targetVelX) + 50;
      if (phys.weight === 'bouncy') body.velocity.x *= -0.8;
    }
    if (this.boss.x > maxX) {
      this.boss.targetVelX = -Math.abs(this.boss.targetVelX) - 50;
      if (phys.weight === 'bouncy') body.velocity.x *= -0.8;
    }
    if (this.boss.y < minY) {
      this.boss.targetVelY = Math.abs(this.boss.targetVelY) + 30;
      if (phys.weight === 'bouncy') body.velocity.y *= -0.8;
    }
    if (this.boss.y > maxY) {
      this.boss.targetVelY = -Math.abs(this.boss.targetVelY) - 30;
      if (phys.weight === 'bouncy') body.velocity.y *= -0.8;
    }

    // === EFFETS VISUELS SELON LE POIDS ===
    // Squash & Stretch subtil basé sur la vélocité
    if (phys.weight !== 'massive') {
      const velMagnitude = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
      const stretchFactor = Math.min(velMagnitude / 300, 0.15);
      const moveAngle = Math.atan2(body.velocity.y, body.velocity.x);

      // Appliquer stretch dans la direction du mouvement
      const scaleX = 1 + Math.abs(Math.cos(moveAngle)) * stretchFactor;
      const scaleY = 1 + Math.abs(Math.sin(moveAngle)) * stretchFactor;
      this.boss.setScale(scaleX, scaleY);
    }
  }

  // Helper pour définir la target velocity du boss (appelé par les fonctions de move)
  setBossTargetVelocity(vx, vy) {
    if (!this.boss || !this.boss.active) return;
    this.boss.targetVelX = vx;
    this.boss.targetVelY = vy;
  }

  // Helper pour un mouvement soudain (lunge/dash) avec momentum
  bossLunge(dirX, dirY, force) {
    if (!this.boss || !this.boss.active || !this.boss.physics) return;

    const phys = this.boss.physics;
    const actualForce = force || phys.lungeForce || 400;

    // Appliquer une impulsion directe (bypass l'accélération progressive)
    this.boss.body.velocity.x += dirX * actualForce / phys.mass;
    this.boss.body.velocity.y += dirY * actualForce / phys.mass;

    // Effet visuel de lunge
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.8,
      scaleY: 1.3,
      duration: 100,
      yoyo: true,
      ease: 'Quad.easeOut'
    });

    // Particules de thrust
    this.emitParticles(this.boss.x - dirX * 30, this.boss.y - dirY * 30, {
      count: 8,
      colors: [this.bossColor, 0xffffff],
      minSpeed: 50,
      maxSpeed: 150,
      minSize: 3,
      maxSize: 8,
      life: 300,
      spread: Math.PI / 3,
      angle: Math.atan2(-dirY, -dirX),
      fadeOut: true
    });
  }

  createBossUI(name, bossNum, color) {
    const uiDepth = 100;
    const barWidth = 300;
    const barHeight = 12;
    const barY = 75;

    this.bossUIContainer = this.add.container(400, barY).setScrollFactor(0).setDepth(uiDepth + 2);

    const bgBar = this.add.rectangle(0, 0, barWidth + 4, barHeight + 4, 0x000000, 0.6);
    bgBar.setStrokeStyle(2, color);

    this.bossHealthBarBg = this.add.rectangle(0, 0, barWidth, barHeight, 0x222222);
    this.bossHealthBar = this.add.rectangle(-barWidth/2, 0, barWidth, barHeight - 2, color);
    this.bossHealthBar.setOrigin(0, 0.5);

    const colorHex = '#' + color.toString(16).padStart(6, '0');
    this.bossNameText = this.add.text(0, -16, `${name}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      fill: colorHex,
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000000', blur: 2, fill: true }
    }).setOrigin(0.5);

    this.bossPhaseText = this.add.text(barWidth/2 + 8, 0, 'I', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      fill: colorHex
    }).setOrigin(0, 0.5);

    this.bossUIContainer.add([bgBar, this.bossHealthBarBg, this.bossHealthBar, this.bossNameText, this.bossPhaseText]);

    this.bossUIContainer.setAlpha(0);
    this.bossUIContainer.y = 60;
    this.tweens.add({
      targets: this.bossUIContainer,
      alpha: 1,
      y: barY,
      duration: 500,
      ease: 'Back.easeOut'
    });
  }

  // ==========================================
  // BOSS 1 : CHARGER - Dash + Tirs en éventail
  // ==========================================
  initBossCharger() {
    // === CHARGER: LE TAUREAU LÉGENDAIRE ===
    // Premier boss - doit être MÉMORABLE et IMPRESSIONNANT
    // - Cercle autour du joueur comme un prédateur
    // - Charges dévastatrices avec wind-up clair
    // - Tirs en éventail puissants
    // - Recovery windows pour punir

    this.chargerState = 'idle'; // idle, circling, winding, charging, recovering, shooting, evading
    this.chargerComboCount = 0;
    this.chargerOrbitAngle = Math.random() * Math.PI * 2; // Angle d'orbite initial
    this.chargerOrbitDir = Math.random() < 0.5 ? 1 : -1; // Direction d'orbite
    this.chargerOrbitRadius = 200; // Distance du joueur

    // Commence à cercler
    this.setBossTargetVelocity(0, 0);

    // Timer d'état idle (vérification périodique pour animations)
    this.bossMoveTimer = this.time.addEvent({
      delay: 400, // Check fréquent pour animations idle
      callback: this.bossChargerMove,
      callbackScope: this,
      loop: true
    });

    // Tir en éventail - AGRESSIF
    this.bossShootTimer = this.time.addEvent({
      delay: 1800, // Tirs fréquents!
      callback: this.bossChargerShoot,
      callbackScope: this,
      loop: true
    });

    // Charge DÉVASTATRICE - attaque signature FRÉQUENTE
    this.chargerChargeTimer = this.time.addEvent({
      delay: 2800, // Charges très fréquentes!
      callback: this.bossChargerWindUp,
      callbackScope: this,
      loop: true
    });

    // Rugissement périodique (intimidation)
    this.chargerRoarTimer = this.time.addEvent({
      delay: 5000,
      callback: this.bossChargerRoar,
      callbackScope: this,
      loop: true
    });
  }

  bossChargerRoar() {
    if (!this.boss || !this.boss.active) return;
    if (this.chargerState !== 'idle') return;

    // Animation de rugissement
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.15,
      scaleY: 0.9,
      duration: 200,
      yoyo: true,
      repeat: 2
    });

    // SFX de rugissement intimidant
    this.playSound('bossRoar');

    // Particules de rage
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      this.emitParticles(this.boss.x + Math.cos(angle) * 40, this.boss.y + Math.sin(angle) * 40, {
        count: 2,
        colors: [0xff4400, 0xff0000, 0xff6600],
        minSpeed: 30,
        maxSpeed: 60,
        minSize: 3,
        maxSize: 7,
        life: 400,
        angle: angle,
        spread: 0.5,
        fadeOut: true
      });
    }

    // Screen shake léger
    this.cameras.main.shake(200, 0.005);
  }

  bossChargerMove() {
    if (!this.boss || !this.boss.active) return;
    if (this.chargerState !== 'idle') return;

    // === CHARGER: LE TAUREAU - Cercle autour du joueur comme un prédateur ===

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // === COMPORTEMENT DE CERCLE AUTOUR DU JOUEUR ===
    // Le boss orbite autour du joueur, maintenant la pression

    // Mettre à jour l'angle d'orbite
    const orbitSpeed = 0.015 + this.bossPhase * 0.005; // Plus rapide selon la phase
    this.chargerOrbitAngle += orbitSpeed * this.chargerOrbitDir;

    // Changer parfois de direction pour être imprévisible
    if (Math.random() < 0.005) {
      this.chargerOrbitDir *= -1;
    }

    // Position cible sur l'orbite (autour du joueur)
    const targetRadius = this.chargerOrbitRadius - this.bossPhase * 20; // Plus proche selon phase
    const targetX = this.player.x + Math.cos(this.chargerOrbitAngle) * targetRadius;
    const targetY = this.player.y + Math.sin(this.chargerOrbitAngle) * Math.min(targetRadius * 0.4, 80); // Orbite aplatie (plus horizontal)

    // Limiter dans l'arène
    const clampedX = Phaser.Math.Clamp(targetX, 100, this.WORLD.width - 100);
    const clampedY = Phaser.Math.Clamp(targetY, 150, this.WORLD.groundY - 80);

    // Mouvement vers la position cible
    const moveToX = clampedX - this.boss.x;
    const moveToY = clampedY - this.boss.y;
    const moveDist = Math.sqrt(moveToX * moveToX + moveToY * moveToY) || 1;

    // Vitesse de mouvement (modérée, menaçante)
    const moveSpeed = 80 + this.bossPhase * 20;
    if (moveDist > 10) {
      this.setBossTargetVelocity(
        (moveToX / moveDist) * moveSpeed,
        (moveToY / moveDist) * moveSpeed * 0.6 // Moins vertical
      );
    } else {
      this.setBossTargetVelocity(0, 0);
    }

    // Animation de respiration/pulsation menaçante pendant le mouvement
    if (!this.chargerBreathingTween || !this.chargerBreathingTween.isPlaying()) {
      this.chargerBreathingTween = this.tweens.add({
        targets: this.boss,
        scaleX: { from: 1, to: 1.05 },
        scaleY: { from: 1, to: 0.97 },
        duration: 600,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.easeInOut'
      });
    }

    // Particules de fumée des naseaux pendant le mouvement
    if (Math.random() < 0.08) {
      const facing = Math.sign(this.player.x - this.boss.x) || 1;
      const noseX = this.boss.x + facing * 25;
      this.emitParticles(noseX, this.boss.y + 5, {
        count: 2,
        colors: [0x333333, 0x555555, 0xff4400],
        minSpeed: 15,
        maxSpeed: 35,
        minSize: 3,
        maxSize: 6,
        life: 350,
        angle: facing > 0 ? 0 : Math.PI,
        spread: 0.5,
        fadeOut: true
      });
    }

    // === ESQUIVE DÉFENSIVE: Si joueur au-dessus et proche ===
    const playerAbove = this.player.y < this.boss.y - 20;
    const playerDescending = this.player.body.velocity.y > 50;
    const playerClose = distToPlayer < 180; // Détection plus large

    if (playerAbove && playerClose && playerDescending && !this.bossDashCooldown) {
      const escapeDir = toPlayerX !== 0 ? -Math.sign(toPlayerX) : (Math.random() < 0.5 ? -1 : 1);

      this.chargerState = 'evading';

      // Inverser direction d'orbite après esquive
      this.chargerOrbitDir *= -1;

      // Grognement d'agacement
      this.playSound('bossHurtCry');

      // Animation d'esquive rapide
      this.tweens.add({
        targets: this.boss,
        scaleX: 0.7,
        scaleY: 1.2,
        duration: 100,
        yoyo: true
      });

      // Esquive rapide
      this.bossLunge(escapeDir, -0.3, 450);
      this.bossDashCooldown = true;

      // === CONTRE-ATTAQUE SURPRISE après esquive ===
      this.time.delayedCall(400, () => {
        if (!this.boss || !this.boss.active) return;

        // Tir rapide de représailles (surprise!)
        this.playSound('bossWarning');
        const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
        for (let i = -1; i <= 1; i++) {
          this.createBossBullet(this.boss.x, this.boss.y, angle + i * 0.3, 200);
        }

        // Particules de rage
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 8,
          colors: [0xff4400, 0xff0000],
          minSpeed: 60,
          maxSpeed: 120,
          minSize: 4,
          maxSize: 8,
          life: 300,
          spread: Math.PI * 2,
          fadeOut: true
        });
      });

      // Retour à idle après esquive + contre-attaque
      this.time.delayedCall(600, () => {
        this.chargerState = 'idle';
      });
      this.time.delayedCall(1500, () => this.bossDashCooldown = false);
    }
  }

  bossChargerWindUp() {
    if (!this.boss || !this.boss.active) return;
    if (this.chargerState !== 'idle') return;

    this.chargerState = 'winding';
    this.setBossTargetVelocity(0, 0); // Arrêt complet

    // SFX de préparation de charge
    this.playSound('bossCharge');
    this.playSound('bossWarning');

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // === WIND-UP ANIMATION (CLEAR TELL) ===
    // Le boss recule et se prépare - le joueur peut réagir
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.7,
      scaleY: 1.3,
      x: this.boss.x - Math.sign(toPlayerX) * 30,
      duration: 800, // Long wind-up pour que le joueur voit
      ease: 'Quad.easeIn',
      onUpdate: () => {
        // Particules de charge pendant le wind-up
        if (Math.random() < 0.3) {
          this.emitParticles(this.boss.x + Math.sign(toPlayerX) * 20, this.boss.y, {
            count: 2,
            colors: [0xff4400, 0xff0000],
            minSpeed: 30,
            maxSpeed: 60,
            minSize: 3,
            maxSize: 6,
            life: 300,
            angle: Math.atan2(toPlayerY, toPlayerX),
            spread: 0.5,
            fadeOut: true
          });
        }
      },
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;
        this.bossChargerCharge(toPlayerX / dist, toPlayerY / dist);
      }
    });

    // Flash d'avertissement (screen effet)
    this.cameras.main.flash(100, 255, 100, 100, false);
  }

  bossChargerCharge(dirX, dirY) {
    if (!this.boss || !this.boss.active) return;

    this.chargerState = 'charging';

    // === SFX DE CHARGE DÉVASTATRICE ===
    this.playSound('bossDash');

    // === CHARGE TRAVERSE TOUT! ===
    // Désactiver les collisions avec les murs pendant la charge
    this.boss.body.setCollideWorldBounds(false);

    // === CHARGE! - Plus puissante et impressionnante ===
    const chargeForce = 750 + (this.bossPhase - 1) * 150;
    this.bossLunge(dirX, dirY * 0.2, chargeForce);

    // Screen shake pendant la charge
    this.cameras.main.shake(400, 0.02);

    // Animation d'étirement pendant la charge
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.4,
      scaleY: 0.7,
      duration: 150,
      yoyo: true,
      repeat: 2
    });

    // Traînée de particules INTENSE pendant la charge
    for (let i = 0; i < 12; i++) {
      this.time.delayedCall(i * 40, () => {
        if (this.boss && this.boss.active && this.chargerState === 'charging') {
          // Particules de feu/rage
          this.emitParticles(this.boss.x, this.boss.y, {
            count: 6,
            colors: [0xff4400, 0xff0000, 0xffaa00, 0xffff00],
            minSpeed: 40,
            maxSpeed: 100,
            minSize: 5,
            maxSize: 14,
            life: 300,
            spread: Math.PI * 0.8,
            angle: Math.atan2(-dirY, -dirX),
            fadeOut: true,
            shape: 'star'
          });

          // Traînée de poussière au sol
          if (this.boss.y > this.WORLD.groundY - 100) {
            this.emitParticles(this.boss.x, this.WORLD.groundY - 20, {
              count: 3,
              colors: [0x886644, 0xaa8866, 0x664422],
              minSpeed: 30,
              maxSpeed: 70,
              minSize: 4,
              maxSize: 10,
              life: 400,
              angle: -Math.PI / 2,
              spread: Math.PI / 2,
              fadeOut: true
            });
          }
        }
      });
    }

    // === IMPACT AU MUR (si applicable) ===
    this.time.delayedCall(500, () => {
      if (!this.boss || !this.boss.active) return;

      // Vérifier si proche d'un mur
      if (this.boss.x < 120 || this.boss.x > this.WORLD.width - 120) {
        // IMPACT AU MUR - effet dévastateur
        this.playSound('bossHit');
        this.cameras.main.shake(300, 0.025);

        // Explosion de particules à l'impact
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 20,
          colors: [0xff4400, 0xffaa00, 0xffffff],
          minSpeed: 100,
          maxSpeed: 250,
          minSize: 4,
          maxSize: 12,
          life: 400,
          spread: Math.PI * 2,
          fadeOut: true
        });
      }
    });

    // === RECOVERY WINDOW (OPENING) ===
    this.time.delayedCall(650, () => {
      if (!this.boss || !this.boss.active) return;

      this.chargerState = 'recovering';
      this.setBossTargetVelocity(0, 0);
      this.boss.body.setVelocity(0, 0);

      // Réactiver les collisions avec les bords
      this.boss.body.setCollideWorldBounds(true);

      // Si le boss est sorti de l'arène, le téléporter de l'autre côté (effet wrap-around)
      if (this.boss.x < 50) {
        // Sorti à gauche -> réapparaît à droite
        this.boss.x = this.WORLD.width - 100;
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 15,
          colors: [0xff4400, 0xff0000, 0xffaa00],
          minSpeed: 80,
          maxSpeed: 180,
          minSize: 5,
          maxSize: 12,
          life: 400,
          spread: Math.PI * 2,
          fadeOut: true
        });
      } else if (this.boss.x > this.WORLD.width - 50) {
        // Sorti à droite -> réapparaît à gauche
        this.boss.x = 100;
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 15,
          colors: [0xff4400, 0xff0000, 0xffaa00],
          minSpeed: 80,
          maxSpeed: 180,
          minSize: 5,
          maxSize: 12,
          life: 400,
          spread: Math.PI * 2,
          fadeOut: true
        });
      }

      // Garder le boss dans les limites Y
      this.boss.y = Phaser.Math.Clamp(this.boss.y, 100, this.WORLD.groundY - 80);

      // SFX de récupération (essoufflement)
      this.playSound('bossHurtCry');

      // Animation de récupération (boss vulnérable)
      this.tweens.add({
        targets: this.boss,
        scaleX: 1.2,
        scaleY: 0.8,
        duration: 300,
        yoyo: true,
        repeat: 1
      });

      // Particules de fatigue/vapeur
      this.emitParticles(this.boss.x, this.boss.y - 20, {
        count: 8,
        colors: [0xffff00, 0xffffff, 0xaaaaaa],
        minSpeed: 15,
        maxSpeed: 40,
        minSize: 3,
        maxSize: 6,
        life: 600,
        angle: -Math.PI / 2,
        spread: Math.PI / 2,
        fadeOut: true
      });

      // Retour à idle après recovery (plus court!)
      this.time.delayedCall(800, () => {
        if (this.boss && this.boss.active) {
          this.chargerState = 'idle';
          this.tweens.add({
            targets: this.boss,
            scaleX: 1,
            scaleY: 1,
            duration: 200
          });
        }
      });
    });
  }

  bossChargerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;
    if (this.chargerState !== 'idle') return;

    this.chargerState = 'shooting';

    // SFX d'avertissement de tir
    this.playSound('bossWarning');

    // Choisir un pattern d'attaque aléatoire (variété!)
    const attackPattern = Math.floor(Math.random() * 3);

    // === TELEGRAPH VISUEL ===
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 400,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        if (Math.random() < 0.5) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 45;
          this.emitParticles(this.boss.x + Math.cos(angle) * dist, this.boss.y + Math.sin(angle) * dist, {
            count: 2,
            colors: [0xff00ff, 0xaa00aa, 0xff4400],
            minSpeed: 50,
            maxSpeed: 100,
            minSize: 3,
            maxSize: 6,
            life: 250,
            angle: angle + Math.PI,
            spread: 0.4,
            fadeOut: true
          });
        }
      }
    });

    // Flash d'avertissement
    this.cameras.main.flash(100, 255, 100, 100, false);

    this.time.delayedCall(450, () => {
      if (!this.boss || !this.boss.active || this.bossShotPaused) return;

      const baseAngle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);

      if (attackPattern === 0) {
        // === PATTERN 1: ÉVENTAIL LARGE ===
        const numBullets = 5 + this.bossPhase * 2;
        const spreadAngle = Math.PI * 0.6; // 108 degrés

        for (let i = 0; i < numBullets; i++) {
          const angle = baseAngle - spreadAngle / 2 + (spreadAngle / (numBullets - 1)) * i;
          this.createBossBullet(this.boss.x, this.boss.y, angle, 180);
        }
      } else if (attackPattern === 1) {
        // === PATTERN 2: TRIPLE VAGUE ===
        for (let wave = 0; wave < 3; wave++) {
          this.time.delayedCall(wave * 150, () => {
            if (!this.boss || !this.boss.active) return;
            const numBullets = 3 + this.bossPhase;
            const spreadAngle = Math.PI * 0.3;
            const waveOffset = (wave - 1) * 0.15; // Décalage entre vagues

            for (let i = 0; i < numBullets; i++) {
              const angle = baseAngle + waveOffset - spreadAngle / 2 + (spreadAngle / (numBullets - 1)) * i;
              this.createBossBullet(this.boss.x, this.boss.y, angle, 160 + wave * 30);
            }
          });
        }
      } else {
        // === PATTERN 3: CERCLE EXPLOSIF ===
        const numBullets = 8 + this.bossPhase * 2;
        for (let i = 0; i < numBullets; i++) {
          const angle = (i / numBullets) * Math.PI * 2;
          this.createBossBullet(this.boss.x, this.boss.y, angle, 140);
        }
        // Deuxième cercle décalé
        this.time.delayedCall(200, () => {
          if (!this.boss || !this.boss.active) return;
          for (let i = 0; i < numBullets; i++) {
            const angle = (i / numBullets) * Math.PI * 2 + Math.PI / numBullets;
            this.createBossBullet(this.boss.x, this.boss.y, angle, 120);
          }
        });
      }

      // SFX de tir puissant
      this.playSound('bossBullet');

      // Animation de recul puissant
      this.tweens.add({
        targets: this.boss,
        scaleX: 0.85,
        scaleY: 0.85,
        duration: 100,
        yoyo: true,
        repeat: 1
      });

      // Screen shake
      this.cameras.main.shake(150, 0.008);

      // Recovery après tir
      this.time.delayedCall(400, () => {
        if (this.boss && this.boss.active) {
          this.chargerState = 'idle';
        }
      });
    });
  }

  // ==========================================
  // BOSS 2 : SPINNER - Tirs circulaires + Téléport
  // ==========================================
  initBossSpinner() {
    // === DARK SOULS STYLE: SPINNER ===
    // - Predictable rotation patterns
    // - Clear telegraph before burst attacks
    // - Recovery "dizzy" period after burst

    this.spinnerAngle = 0;
    this.spinnerState = 'spinning'; // spinning, charging, bursting, dizzy
    this.spinnerBurstCount = 0;
    this.spinnerOrbitAngle = Math.random() * Math.PI * 2;
    this.spinnerOrbitDir = Math.random() < 0.5 ? 1 : -1;

    // Mouvement orbital continu autour du joueur
    this.spinnerDriftTimer = this.time.addEvent({
      delay: 100,
      callback: this.bossSpinnerDrift,
      callbackScope: this,
      loop: true
    });

    // Téléportation avec telegraph
    this.bossMoveTimer = this.time.addEvent({
      delay: 4500, // Plus long pour apprendre le pattern
      callback: this.bossSpinnerTeleport,
      callbackScope: this,
      loop: true
    });

    // Tir rotatif (plus lent)
    this.bossShootTimer = this.time.addEvent({
      delay: 200, // Plus lent
      callback: this.bossSpinnerShoot,
      callbackScope: this,
      loop: true
    });

    // Burst périodique (nouvelle attaque)
    this.spinnerBurstTimer = this.time.addEvent({
      delay: 6000,
      callback: this.bossSpinnerBurstWindUp,
      callbackScope: this,
      loop: true
    });
  }

  bossSpinnerDrift() {
    if (!this.boss || !this.boss.active) return;
    if (this.spinnerState !== 'spinning') return;

    // === SPINNER: LA TOURELLE - Reste en place, tourne et tire ===
    // Ne bouge PAS - la rotation EST le mouvement
    // Téléportation gérée séparément

    // Immobile
    this.setBossTargetVelocity(0, 0);

    // Légère lévitation sur place (flottement subtil)
    if (!this.spinnerFloatTween || !this.spinnerFloatTween.isPlaying()) {
      const baseY = this.boss.y;
      this.spinnerFloatTween = this.tweens.add({
        targets: this.boss,
        y: baseY - 8,
        duration: 1500,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.easeInOut'
      });
    }

    // Rotation continue (l'essence du SPINNER)
    if (this.bossVisuals) {
      this.bossVisuals.rotation += 0.03 + (this.bossPhase - 1) * 0.01;
    }

    // Particules d'énergie tournoyante
    if (Math.random() < 0.05) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25;
      this.emitParticles(
        this.boss.x + Math.cos(angle) * dist,
        this.boss.y + Math.sin(angle) * dist,
        {
          count: 1,
          colors: [0x00ffff, 0x00cccc, 0x66ffff],
          minSpeed: 20,
          maxSpeed: 40,
          minSize: 2,
          maxSize: 5,
          life: 300,
          angle: angle + Math.PI / 2,
          spread: 0.3,
          fadeOut: true
        }
      );
    }
  }

  bossSpinnerTeleport() {
    if (!this.boss || !this.boss.active || this.bossHitCooldown) return;
    if (this.spinnerState !== 'spinning') return;

    // === TELEGRAPH: Visible warning ===
    this.spinnerState = 'charging';

    // Particules de charge qui convergent
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const startX = this.boss.x + Math.cos(angle) * 60;
      const startY = this.boss.y + Math.sin(angle) * 60;
      this.emitParticles(startX, startY, {
        count: 2,
        colors: [0x00ffff, 0x00cccc],
        minSpeed: 60,
        maxSpeed: 100,
        minSize: 3,
        maxSize: 6,
        life: 400,
        angle: angle + Math.PI,
        spread: 0.3,
        fadeOut: true
      });
    }

    // Animation de charge (boss visible qui prépare)
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.6,
      scaleY: 0.6,
      alpha: 0.4,
      duration: 600,
      ease: 'Quad.easeIn'
    });

    this.time.delayedCall(700, () => {
      if (!this.boss || !this.boss.active) return;

      // === TELEPORT ===
      // Particules de disparition
      this.emitParticles(this.boss.x, this.boss.y, {
        count: 20,
        colors: [0x00ffff, 0x00cccc, 0xffffff],
        minSpeed: 100,
        maxSpeed: 200,
        minSize: 3,
        maxSize: 8,
        life: 400,
        spread: Math.PI * 2,
        fadeOut: true
      });

      // === PLAYER-CENTERED TELEPORT ===
      // Téléporte autour du joueur à une distance stratégique
      const teleportDist = 180 + Math.random() * 80; // Distance du joueur
      const teleportAngle = Math.random() * Math.PI * 2; // Angle aléatoire autour du joueur

      let newX = this.player.x + Math.cos(teleportAngle) * teleportDist;
      let newY = this.player.y + Math.sin(teleportAngle) * teleportDist;

      // Clamper dans les limites de l'arène
      const minX = 100;
      const maxX = this.WORLD.width - 100;
      const minY = 100;
      const maxY = this.WORLD.groundY - 100;

      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));

      this.boss.x = newX;
      this.boss.y = newY;

      // Réapparition
      this.tweens.add({
        targets: this.boss,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut'
      });

      // Particules de réapparition
      this.emitParticles(newX, newY, {
        count: 15,
        colors: [0x00ffff, 0xffffff],
        minSpeed: 50,
        maxSpeed: 100,
        minSize: 2,
        maxSize: 5,
        life: 300,
        spread: Math.PI * 2,
        fadeOut: true
      });

      this.spinnerState = 'spinning';
    });
  }

  bossSpinnerBurstWindUp() {
    if (!this.boss || !this.boss.active) return;
    if (this.spinnerState !== 'spinning') return;

    this.spinnerState = 'charging';

    // === WIND-UP pour burst ===
    // Animation visuelle claire
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 800,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        // Particules qui convergent (tell visuel)
        if (Math.random() < 0.5) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 80;
          this.emitParticles(this.boss.x + Math.cos(angle) * dist, this.boss.y + Math.sin(angle) * dist, {
            count: 1,
            colors: [0x00ffff, 0xff0000],
            minSpeed: 80,
            maxSpeed: 120,
            minSize: 3,
            maxSize: 6,
            life: 300,
            angle: angle + Math.PI,
            spread: 0.2,
            fadeOut: true
          });
        }
      }
    });

    // Flash d'avertissement
    this.cameras.main.flash(100, 0, 200, 200, false);

    this.time.delayedCall(900, () => {
      if (!this.boss || !this.boss.active) return;
      this.bossSpinnerBurst();
    });
  }

  bossSpinnerBurst() {
    if (!this.boss || !this.boss.active) return;

    this.spinnerState = 'bursting';

    // === BURST! ===
    const numWaves = this.bossPhase >= 2 ? 3 : 2;

    for (let wave = 0; wave < numWaves; wave++) {
      this.time.delayedCall(wave * 300, () => {
        if (!this.boss || !this.boss.active) return;

        const bulletsPerWave = 8;
        const offset = wave * (Math.PI / 8);

        for (let i = 0; i < bulletsPerWave; i++) {
          const angle = (i / bulletsPerWave) * Math.PI * 2 + offset;
          if (this.bossPhase >= 2) {
            this.createPiercingBullet(this.boss.x, this.boss.y, angle, 130);
          } else {
            this.createBossBullet(this.boss.x, this.boss.y, angle, 120);
          }
        }

        // Animation de contraction à chaque vague
        this.tweens.add({
          targets: this.boss,
          scaleX: 0.9,
          scaleY: 0.9,
          duration: 100,
          yoyo: true
        });
      });
    }

    // === DIZZY RECOVERY (Opening) ===
    this.time.delayedCall(numWaves * 300 + 200, () => {
      if (!this.boss || !this.boss.active) return;

      this.spinnerState = 'dizzy';
      this.spinnerAngle = 0; // Reset rotation

      // Animation de vertige
      this.tweens.add({
        targets: this.boss,
        scaleX: 0.8,
        scaleY: 1.1,
        duration: 200,
        yoyo: true,
        repeat: 2
      });

      // Particules de vertige
      for (let i = 0; i < 5; i++) {
        this.time.delayedCall(i * 150, () => {
          if (this.boss && this.boss.active) {
            const angle = (i / 5) * Math.PI * 2;
            this.emitParticles(this.boss.x + Math.cos(angle) * 25, this.boss.y - 20, {
              count: 2,
              colors: [0xffff00, 0xffffff],
              minSpeed: 10,
              maxSpeed: 30,
              minSize: 3,
              maxSize: 5,
              life: 400,
              angle: -Math.PI / 2,
              spread: 0.5,
              fadeOut: true
            });
          }
        });
      }

      // Retour à la normale après recovery
      this.time.delayedCall(1500, () => {
        if (this.boss && this.boss.active) {
          this.spinnerState = 'spinning';
          this.tweens.add({
            targets: this.boss,
            scaleX: 1,
            scaleY: 1,
            duration: 200
          });
        }
      });
    });
  }

  bossSpinnerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused || this.bossHitCooldown) return;
    if (this.spinnerState !== 'spinning') return; // Ne tire pas pendant les autres états

    // Tir rotatif continu (plus lent)
    const speed = this.bossPhase >= 2 ? 120 : 100;
    this.createBossBullet(this.boss.x, this.boss.y, this.spinnerAngle, speed);

    // Double hélice en phase 2
    if (this.bossPhase >= 2) {
      this.createBossBullet(this.boss.x, this.boss.y, this.spinnerAngle + Math.PI, speed);
    }

    this.spinnerAngle += 0.12; // Plus lent
  }

  // ==========================================
  // BOSS 3 : SPLITTER - Se divise en mini-boss
  // ==========================================
  initBossSplitter() {
    // === DARK SOULS STYLE: SPLITTER ===
    // - Wind-up before splitting
    // - Recovery after spawning minions
    // - Clear tells before bounces

    this.splitterMinions = [];
    this.splitterState = 'idle'; // idle, charging, splitting, recovering
    this.splitterBounceCount = 0;

    // Mouvement élastique plus lent
    this.setBossTargetVelocity(40, 30);

    this.bossMoveTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossSplitterMove,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 2500,
      callback: this.bossSplitterShoot,
      callbackScope: this,
      loop: true
    });

    // Timer de split (spawn minions)
    this.splitterSplitTimer = this.time.addEvent({
      delay: 7000,
      callback: this.bossSplitterWindUp,
      callbackScope: this,
      loop: true
    });
  }

  bossSplitterMove() {
    if (!this.boss || !this.boss.active) return;
    if (this.splitterState !== 'idle') return;

    // === SPLITTER: LE BLOB - Reste en place, palpite, puis BONDIT ===
    // Ne bouge PAS sauf pour:
    // 1. Attaques de rebond vers le joueur
    // 2. Split (création de minions)

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // === IDLE: Reste immobile, pulsation gluante ===
    this.setBossTargetVelocity(0, 0);

    // Animation de pulsation blob (comme de la gelée)
    if (!this.splitterPulseTween || !this.splitterPulseTween.isPlaying()) {
      this.splitterPulseTween = this.tweens.add({
        targets: this.boss,
        scaleX: { from: 1, to: 1.1 },
        scaleY: { from: 1, to: 0.92 },
        duration: 600,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.easeInOut'
      });
    }

    // Particules de goo qui dégouline
    if (Math.random() < 0.04) {
      const offsetX = (Math.random() - 0.5) * 40;
      this.emitParticles(this.boss.x + offsetX, this.boss.y + 20, {
        count: 1,
        colors: [0xaaaa00, 0x888800, 0xcccc00],
        minSpeed: 5,
        maxSpeed: 15,
        minSize: 3,
        maxSize: 7,
        life: 600,
        angle: Math.PI / 2,
        spread: 0.3,
        fadeOut: true
      });
    }

    // === ATTAQUE BOUNCE: Bondit vers le joueur périodiquement ===
    // Chance de bondir augmente si le joueur est proche
    const bounceChance = distToPlayer < 200 ? 0.08 : 0.03;

    if (Math.random() < bounceChance && this.splitterBounceCount < 2) {
      this.splitterState = 'charging';
      this.splitterBounceCount++;

      // Wind-up animation (tell)
      this.tweens.add({
        targets: this.boss,
        scaleX: 0.7,
        scaleY: 1.3,
        duration: 400,
        ease: 'Quad.easeIn',
        onComplete: () => {
          if (!this.boss || !this.boss.active) return;

          const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;
          this.bossLunge(toPlayerX / dist * 0.7, toPlayerY / dist * 0.4, 300);

          // Squash après bounce
          this.tweens.add({
            targets: this.boss,
            scaleX: 1.2,
            scaleY: 0.8,
            duration: 150,
            yoyo: true,
            onComplete: () => {
              this.splitterState = 'idle';
              this.time.delayedCall(800, () => this.splitterBounceCount = 0);
            }
          });
        }
      });
      return;
    }

    // Si pas de bounce, reste immobile (déjà géré au début)
  }

  bossSplitterWindUp() {
    if (!this.boss || !this.boss.active) return;
    if (this.splitterState !== 'idle') return;
    if (this.splitterMinions.filter(m => m.active).length >= 3) return; // Max minions

    this.splitterState = 'charging';

    // === WIND-UP: Gonflement avant split ===
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 1000,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        // Particules de charge
        if (Math.random() < 0.4) {
          this.emitParticles(this.boss.x + (Math.random() - 0.5) * 40, this.boss.y + (Math.random() - 0.5) * 40, {
            count: 2,
            colors: [0xffff00, 0xcccc00],
            minSpeed: 20,
            maxSpeed: 50,
            minSize: 3,
            maxSize: 6,
            life: 300,
            fadeOut: true
          });
        }
      }
    });

    // Flash d'avertissement
    this.cameras.main.flash(100, 200, 200, 0, false);

    this.time.delayedCall(1100, () => {
      if (!this.boss || !this.boss.active) return;
      this.bossSplitterSplit();
    });
  }

  bossSplitterSplit() {
    if (!this.boss || !this.boss.active) return;

    this.splitterState = 'splitting';

    // === SPLIT! ===
    // Animation de contraction rapide
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.6,
      scaleY: 0.6,
      duration: 150,
      ease: 'Quad.easeOut'
    });

    // Spawn minion avec délai
    const spawnX = this.boss.x + (Math.random() - 0.5) * 60;
    const spawnY = this.boss.y + (Math.random() - 0.5) * 40;
    this.spawnSplitterMinion(spawnX, spawnY);

    // === RECOVERY (Opening) ===
    this.time.delayedCall(300, () => {
      if (!this.boss || !this.boss.active) return;

      this.splitterState = 'recovering';

      // Animation de fatigue
      this.tweens.add({
        targets: this.boss,
        scaleX: 1.1,
        scaleY: 0.9,
        duration: 200,
        yoyo: true,
        repeat: 2
      });

      // Particules de fatigue
      this.emitParticles(this.boss.x, this.boss.y - 15, {
        count: 5,
        colors: [0xffff00, 0xffffff],
        minSpeed: 10,
        maxSpeed: 30,
        minSize: 2,
        maxSize: 4,
        life: 500,
        angle: -Math.PI / 2,
        spread: Math.PI / 3,
        fadeOut: true
      });

      // Retour à idle après recovery
      this.time.delayedCall(1200, () => {
        if (this.boss && this.boss.active) {
          this.splitterState = 'idle';
          this.tweens.add({
            targets: this.boss,
            scaleX: 1,
            scaleY: 1,
            duration: 200
          });
        }
      });
    });
  }

  bossSplitterShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;
    if (this.splitterState !== 'idle') return;

    // Telegraph du tir
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: 300,
      yoyo: true
    });

    this.time.delayedCall(350, () => {
      if (!this.boss || !this.boss.active) return;
      const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
      this.createBossBullet(this.boss.x, this.boss.y, angle, 140);
    });
  }

  spawnSplitterMinion(x, y) {
    // Particules de division/spawn
    this.emitParticles(x, y, {
      count: 15,
      colors: [0xffff00, 0xcccc00, 0xaaaa00],
      minSpeed: 80,
      maxSpeed: 180,
      minSize: 4,
      maxSize: 10,
      life: 350,
      spread: Math.PI * 2,
      fadeOut: true,
      shape: 'circle'
    });

    const minion = this.add.rectangle(x, y, 35, 35, 0xcccc00);
    minion.setStrokeStyle(2, 0xffff00);
    this.physics.add.existing(minion);
    minion.body.setAllowGravity(false);
    minion.body.setCollideWorldBounds(true);
    minion.health = 1;
    minion.body.setVelocity(Phaser.Math.Between(-100, 100), Phaser.Math.Between(-100, 100));

    // Animation d'apparition
    minion.setAlpha(0);
    minion.setScale(0);
    this.tweens.add({
      targets: minion,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 200,
      ease: 'Back.easeOut'
    });

    this.splitterMinions.push(minion);
    this.physics.add.overlap(this.player, minion, (p, m) => this.hitSplitterMinion(p, m), null, this);

    // Tir périodique du minion
    minion.shootTimer = this.time.addEvent({
      delay: 2500,
      callback: () => {
        if (!minion.active) return;
        const angle = Phaser.Math.Angle.Between(minion.x, minion.y, this.player.x, this.player.y);
        this.createBossBullet(minion.x, minion.y, angle, 140);
      },
      loop: true
    });
  }

  hitSplitterMinion(player, minion) {
    if (this.isInvincible) return;

    if (player.body.velocity.y > 0 && player.y < minion.y - 10) {
      minion.health--;
      player.body.setVelocityY(-350);

      if (minion.health <= 0) {
        // SFX + Particules
        this.playSound('enemyKill');
        this.particleEnemyDeath(minion.x, minion.y, 0xcccc00);
        if (minion.shootTimer) minion.shootTimer.remove();
        minion.destroy();
        this.splitterMinions = this.splitterMinions.filter(m => m.active);
        this.score += 50;
        this.scoreText.setText(this.score.toString().padStart(6, '0'));
      }
    } else {
      this.takeDamage(2); // Minions Splitter = 1/2 coeur (petits)
    }
  }

  // ==========================================
  // BOSS 4 : GUARDIAN - Bouclier + Laser
  // ==========================================
  initBossGuardian() {
    // === DARK SOULS STYLE: GUARDIAN ===
    // - Predictable shield pattern (opens for attack)
    // - Clear laser telegraph with long wind-up
    // - Heavy slam with long recovery

    this.guardianShield = true;
    this.guardianState = 'guarding'; // guarding, vulnerable, charging, slamming, recovering
    this.guardianShieldSprite = this.add.circle(this.boss.x, this.boss.y, 50, 0x0099ff, 0.3);
    this.guardianShieldSprite.setStrokeStyle(3, 0x00ccff);

    // Le bouclier se désactive périodiquement (plus long pour pattern learning)
    this.bossMoveTimer = this.time.addEvent({
      delay: 5000,
      callback: this.bossGuardianToggleShield,
      callbackScope: this,
      loop: true
    });

    // Laser avec plus de telegraph
    this.bossShootTimer = this.time.addEvent({
      delay: 4000,
      callback: this.bossGuardianLaserWindUp,
      callbackScope: this,
      loop: true
    });

    // Mouvement très lent et massif
    this.setBossTargetVelocity(20, 15);

    // Timer de mouvement lent
    this.guardianMoveTimer = this.time.addEvent({
      delay: 3500,
      callback: this.bossGuardianMove,
      callbackScope: this,
      loop: true
    });

    // Timer de slam (nouvelle attaque)
    this.guardianSlamTimer = this.time.addEvent({
      delay: 6000,
      callback: this.bossGuardianSlamWindUp,
      callbackScope: this,
      loop: true
    });
  }

  bossGuardianMove() {
    if (!this.boss || !this.boss.active) return;
    if (this.guardianState !== 'guarding' && this.guardianState !== 'vulnerable') return;

    // === GUARDIAN: LE MUR - Avance LENTEMENT et IMPLACABLEMENT ===
    // Mouvement TRÈS lent mais constant vers le joueur
    // Comme un mur qui se rapproche inexorablement

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // Direction vers le joueur (horizontale seulement, le Guardian reste au sol)
    const dirX = toPlayerX / distToPlayer;

    // === MARCHE IMPLACABLE ===
    // Vitesse TRÈS lente - comme un tank ou un mur
    const speed = this.boss.moveSpeed * 0.15; // Très lent

    // Seulement horizontal - le Guardian est ancré
    const velX = dirX * speed;

    // Animation de pas lourds
    if (!this.guardianStepTween || !this.guardianStepTween.isPlaying()) {
      this.guardianStepTween = this.tweens.add({
        targets: this.boss,
        y: this.boss.y - 3,
        scaleY: { from: 1, to: 0.97 },
        duration: 400,
        yoyo: true,
        repeat: 0,
        ease: 'Quad.easeInOut',
        onYoyo: () => {
          // Son de pas lourd
          if (Math.random() < 0.5) {
            this.playSound('land');
          }
          // Particules de poussière
          this.emitParticles(this.boss.x, this.boss.y + 25, {
            count: 3,
            colors: [0x666666, 0x888888, 0x444444],
            minSpeed: 10,
            maxSpeed: 30,
            minSize: 3,
            maxSize: 6,
            life: 400,
            angle: -Math.PI / 2,
            spread: Math.PI / 2,
            fadeOut: true
          });
        }
      });
    }

    // Le bouclier scintille périodiquement
    if (Math.random() < 0.02 && this.guardianState === 'guarding') {
      if (this.guardianShieldSprite) {
        this.tweens.add({
          targets: this.guardianShieldSprite,
          alpha: { from: 0.8, to: 1 },
          duration: 100,
          yoyo: true
        });
      }
    }

    // S'arrête si très proche du joueur (prépare un slam)
    if (distToPlayer < 80) {
      this.setBossTargetVelocity(0, 0);
    } else {
      this.setBossTargetVelocity(velX, 0);
    }
  }

  bossGuardianSlamWindUp() {
    if (!this.boss || !this.boss.active) return;
    if (this.guardianState !== 'guarding' && this.guardianState !== 'vulnerable') return;

    this.guardianState = 'charging';

    // === WIND-UP: Rise up before slam ===
    this.tweens.add({
      targets: this.boss,
      y: this.boss.y - 50,
      scaleX: 0.9,
      scaleY: 1.2,
      duration: 800,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        // Particules de charge
        if (Math.random() < 0.4) {
          this.emitParticles(this.boss.x, this.boss.y + 30, {
            count: 2,
            colors: [0x0099ff, 0x00ccff],
            minSpeed: 50,
            maxSpeed: 100,
            minSize: 3,
            maxSize: 6,
            life: 300,
            angle: Math.PI / 2,
            spread: 0.5,
            fadeOut: true
          });
        }
      }
    });

    // Flash d'avertissement
    this.cameras.main.flash(100, 0, 100, 200, false);

    this.time.delayedCall(900, () => {
      if (!this.boss || !this.boss.active) return;
      this.bossGuardianSlam();
    });
  }

  bossGuardianSlam() {
    if (!this.boss || !this.boss.active) return;

    this.guardianState = 'slamming';

    // === SLAM DOWN! ===
    const targetY = this.WORLD.groundY - 120;

    this.tweens.add({
      targets: this.boss,
      y: targetY,
      scaleX: 1.3,
      scaleY: 0.7,
      duration: 200,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // Impact!
        this.cameras.main.shake(300, 0.025);

        // Onde de choc
        this.emitParticles(this.boss.x, targetY + 20, {
          count: 30,
          colors: [0x0099ff, 0x00ccff, 0xffffff],
          minSpeed: 100,
          maxSpeed: 250,
          minSize: 4,
          maxSize: 12,
          life: 500,
          angle: -Math.PI / 2,
          spread: Math.PI * 0.6,
          gravity: 200,
          fadeOut: true
        });

        // Projectiles en éventail
        for (let i = 0; i < 5; i++) {
          const angle = -Math.PI / 2 + (i - 2) * 0.4;
          this.createBossBullet(this.boss.x, this.boss.y + 20, angle + Math.PI, 100);
        }

        // === RECOVERY (Long opening!) ===
        this.time.delayedCall(300, () => {
          if (!this.boss || !this.boss.active) return;

          this.guardianState = 'recovering';

          // Animation de récupération lente
          this.tweens.add({
            targets: this.boss,
            scaleX: 1.1,
            scaleY: 0.9,
            duration: 300,
            yoyo: true,
            repeat: 2
          });

          // Particules de fatigue
          this.emitParticles(this.boss.x, this.boss.y - 20, {
            count: 8,
            colors: [0x0066aa, 0xffffff],
            minSpeed: 10,
            maxSpeed: 30,
            minSize: 2,
            maxSize: 5,
            life: 600,
            angle: -Math.PI / 2,
            spread: Math.PI / 3,
            fadeOut: true
          });

          // Retour à la normale après long recovery
          this.time.delayedCall(1800, () => {
            if (this.boss && this.boss.active) {
              this.guardianState = this.guardianShield ? 'guarding' : 'vulnerable';
              this.tweens.add({
                targets: this.boss,
                scaleX: 1,
                scaleY: 1,
                y: 200,
                duration: 500,
                ease: 'Quad.easeOut'
              });
            }
          });
        });
      }
    });
  }

  bossGuardianToggleShield() {
    if (!this.boss || !this.boss.active) return;

    this.guardianShield = !this.guardianShield;

    if (this.guardianShield) {
      // Bouclier activé - particules d'énergie convergentes
      this.guardianShieldSprite.setAlpha(0.3);
      this.guardianShieldSprite.setStrokeStyle(3, 0x00ccff);

      // Particules qui convergent vers le boss
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const startX = this.boss.x + Math.cos(angle) * 80;
        const startY = this.boss.y + Math.sin(angle) * 80;
        this.emitParticles(startX, startY, {
          count: 2,
          colors: [0x00ccff, 0x0099ff, 0xffffff],
          minSpeed: 60,
          maxSpeed: 100,
          minSize: 3,
          maxSize: 6,
          life: 300,
          angle: angle + Math.PI,
          spread: 0.3,
          fadeOut: true
        });
      }
    } else {
      // Bouclier désactivé - particules qui explosent
      this.emitParticles(this.boss.x, this.boss.y, {
        count: 20,
        colors: [0x0066aa, 0x003366, 0x00ccff],
        minSpeed: 100,
        maxSpeed: 200,
        minSize: 4,
        maxSize: 10,
        life: 400,
        spread: Math.PI * 2,
        fadeOut: true
      });

      this.guardianShieldSprite.setAlpha(0.1);
      this.guardianShieldSprite.setStrokeStyle(1, 0x333333);

      this.time.delayedCall(2000, () => {
        if (this.boss && this.boss.active) {
          this.guardianShield = true;
          this.guardianShieldSprite.setAlpha(0.3);
          this.guardianShieldSprite.setStrokeStyle(3, 0x00ccff);

          // Particules de réactivation
          this.emitParticles(this.boss.x, this.boss.y, {
            count: 15,
            colors: [0x00ccff, 0xffffff],
            minSpeed: 80,
            maxSpeed: 150,
            minSize: 3,
            maxSize: 7,
            life: 300,
            spread: Math.PI * 2,
            fadeOut: true
          });
        }
      });
    }
  }

  bossGuardianLaserWindUp() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;
    if (this.guardianState !== 'guarding' && this.guardianState !== 'vulnerable') return;

    // SFX d'avertissement
    this.playSound('bossWarning');
    this.playSound('bossCharge');

    // === LONG TELEGRAPH for laser ===
    const targetY = this.player.y;

    // Warning line qui pulse (très visible)
    const warningLine = this.add.rectangle(this.WORLD.width / 2, targetY, this.WORLD.width, 6, 0xff0000, 0.3);
    warningLine.setDepth(50);

    // Animation de warning longue et claire
    this.tweens.add({
      targets: warningLine,
      alpha: 0.8,
      duration: 200,
      yoyo: true,
      repeat: 4, // Long telegraph
      onComplete: () => {
        warningLine.destroy();
        if (!this.boss || !this.boss.active) return;

        // === FIRE LASER ===
        this.playSound('laser');

        // Particules de charge
        for (let i = 0; i < 5; i++) {
          this.emitParticles(this.boss.x, this.boss.y, {
            count: 5,
            colors: [0x00ccff, 0x00ffff, 0xffffff],
            minSpeed: 200,
            maxSpeed: 400,
            minSize: 3,
            maxSize: 8,
            life: 150,
            angle: 0,
            spread: 0.2,
            fadeOut: true
          });
          this.emitParticles(this.boss.x, this.boss.y, {
            count: 5,
            colors: [0x00ccff, 0x00ffff, 0xffffff],
            minSpeed: 200,
            maxSpeed: 400,
            minSize: 3,
            maxSize: 8,
            life: 150,
            angle: Math.PI,
            spread: 0.2,
            fadeOut: true
          });
        }

        // Laser horizontal
        const laser = this.add.rectangle(this.WORLD.width / 2, targetY, this.WORLD.width, 20, 0x00ccff, 0.8);
        laser.setDepth(51);
        this.physics.add.existing(laser);
        laser.body.setAllowGravity(false);
        this.physics.add.overlap(this.player, laser, () => {
          if (!this.isInvincible) this.takeDamage(6); // Laser de boss = 1.5 coeurs
        });

        // Particules le long du laser
        for (let x = 50; x < this.WORLD.width - 50; x += 50) {
          this.emitParticles(x, targetY, {
            count: 3,
            colors: [0x00ccff, 0x00ffff],
            minSpeed: 50,
            maxSpeed: 100,
            minSize: 2,
            maxSize: 5,
            life: 250,
            angle: -Math.PI / 2,
            spread: Math.PI / 4,
            fadeOut: true
          });
        }

        this.time.delayedCall(300, () => laser.destroy());
      }
    });
  }

  // ==========================================
  // BOSS 5 : SUMMONER - Invoque des ennemis
  // ==========================================
  initBossSummoner() {
    // === DARK SOULS STYLE: SUMMONER ===
    // - Long ritual wind-up for summoning
    // - Recovery after summoning (vulnerable)
    // - Predictable movement patterns

    this.summonedEnemies = [];
    this.summonerState = 'drifting'; // drifting, channeling, summoning, recovering

    // Le boss commence en haut avec dérive éthérée
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 150;
    this.setBossTargetVelocity(0, 0);

    // Timer de mouvement éthéré (plus lent)
    this.summonerDriftTimer = this.time.addEvent({
      delay: 2500,
      callback: this.bossSummonerDrift,
      callbackScope: this,
      loop: true
    });

    // Invocation avec long wind-up
    this.bossMoveTimer = this.time.addEvent({
      delay: 5000, // Plus long pour apprendre le pattern
      callback: this.bossSummonerSummonWindUp,
      callbackScope: this,
      loop: true
    });

    // Tir avec telegraph
    this.bossShootTimer = this.time.addEvent({
      delay: 3000,
      callback: this.bossSummonerShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossSummonerDrift() {
    if (!this.boss || !this.boss.active) return;
    if (this.summonerState !== 'drifting') return;

    // === SUMMONER: LE MAGE - Flotte immobile, channel son pouvoir ===
    // Ne bouge PAS sauf pour:
    // 1. Repositionnement occasionnel (téléportation)
    // 2. Les invocations

    // === IDLE: Flotte sur place, aura mystique ===
    this.setBossTargetVelocity(0, 0);

    // Lévitation subtile sur place
    if (!this.summonerFloatTween || !this.summonerFloatTween.isPlaying()) {
      const baseY = this.boss.y;
      this.summonerFloatTween = this.tweens.add({
        targets: this.boss,
        y: baseY - 10,
        duration: 2000,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.easeInOut'
      });
    }

    // Aura mystique qui pulse
    if (!this.summonerAuraTween || !this.summonerAuraTween.isPlaying()) {
      this.summonerAuraTween = this.tweens.add({
        targets: this.boss,
        alpha: { from: 1, to: 0.85 },
        duration: 1200,
        yoyo: true,
        repeat: 0,
        ease: 'Sine.easeInOut'
      });
    }

    // Particules de magie qui orbitent autour du mage
    if (Math.random() < 0.06) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 35;
      this.emitParticles(
        this.boss.x + Math.cos(angle) * dist,
        this.boss.y + Math.sin(angle) * dist,
        {
          count: 1,
          colors: [0xff00ff, 0xaa00aa, 0xff66ff, 0xcc00cc],
          minSpeed: 15,
          maxSpeed: 35,
          minSize: 2,
          maxSize: 5,
          life: 500,
          angle: angle + Math.PI / 2, // Orbite
          spread: 0.2,
          fadeOut: true
        }
      );
    }

    // === REPOSITIONNEMENT OCCASIONNEL ===
    // Téléporte vers une meilleure position si joueur trop proche ou trop loin
    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY);

    // Si joueur trop proche, téléportation défensive
    if (distToPlayer < 100 && !this.summonerTeleportCooldown) {
      this.summonerRepositionTeleport();
    }
  }

  summonerRepositionTeleport() {
    if (!this.boss || !this.boss.active) return;
    if (this.summonerTeleportCooldown) return;

    this.summonerTeleportCooldown = true;
    this.summonerState = 'repositioning';

    // Particules de disparition
    this.emitParticles(this.boss.x, this.boss.y, {
      count: 15,
      colors: [0xff00ff, 0xaa00aa, 0xffffff],
      minSpeed: 50,
      maxSpeed: 100,
      minSize: 3,
      maxSize: 7,
      life: 400,
      spread: Math.PI * 2,
      fadeOut: true
    });

    // Fade out
    this.tweens.add({
      targets: this.boss,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // Nouvelle position: loin du joueur, en hauteur
        const side = this.player.x < this.WORLD.width / 2 ? 1 : -1;
        const newX = this.WORLD.width / 2 + side * (150 + Math.random() * 100);
        const newY = 100 + Math.random() * 80;

        this.boss.x = Math.max(100, Math.min(this.WORLD.width - 100, newX));
        this.boss.y = newY;

        // Fade in
        this.tweens.add({
          targets: this.boss,
          alpha: 1,
          duration: 300,
          onComplete: () => {
            this.summonerState = 'drifting';
          }
        });

        // Particules de réapparition
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 12,
          colors: [0xff00ff, 0xaa00aa],
          minSpeed: 30,
          maxSpeed: 70,
          minSize: 2,
          maxSize: 5,
          life: 300,
          spread: Math.PI * 2,
          fadeOut: true
        });
      }
    });

    // Cooldown de téléportation
    this.time.delayedCall(4000, () => this.summonerTeleportCooldown = false);
  }

  bossSummonerSummonWindUp() {
    if (!this.boss || !this.boss.active) return;
    if (this.summonerState !== 'drifting') return;

    // Limite le nombre d'invocations
    this.summonedEnemies = this.summonedEnemies.filter(e => e.active);
    if (this.summonedEnemies.length >= 2) return; // Max 2 minions

    this.summonerState = 'channeling';

    // === LONG WIND-UP: Rituel de channeling ===
    this.setBossTargetVelocity(0, 0); // Arrêt

    // Animation de channeling (très visible)
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 1200,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        // Particules de rituel qui convergent
        if (Math.random() < 0.5) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 80;
          this.emitParticles(this.boss.x + Math.cos(angle) * dist, this.boss.y + Math.sin(angle) * dist, {
            count: 2,
            colors: [0xff00ff, 0xaa00aa, 0xff66cc],
            minSpeed: 60,
            maxSpeed: 100,
            minSize: 3,
            maxSize: 6,
            life: 400,
            angle: angle + Math.PI,
            spread: 0.3,
            fadeOut: true
          });
        }
      }
    });

    // Flash d'avertissement
    this.cameras.main.flash(100, 200, 0, 200, false);

    this.time.delayedCall(1300, () => {
      if (!this.boss || !this.boss.active) return;
      this.bossSummonerSummon();
    });
  }

  bossSummonerSummon() {
    if (!this.boss || !this.boss.active) return;

    this.summonerState = 'summoning';

    // === SUMMON! ===
    // Explosion de particules
    this.emitParticles(this.boss.x, this.boss.y, {
      count: 30,
      colors: [0xff00ff, 0xff66cc, 0xaa00aa, 0xffffff],
      minSpeed: 80,
      maxSpeed: 180,
      minSize: 4,
      maxSize: 10,
      life: 500,
      spread: Math.PI * 2,
      fadeOut: true,
      shape: 'star'
    });

    // Animation de contraction
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.7, scaleY: 0.7,
      duration: 150,
      ease: 'Quad.easeOut'
    });

    // Spawn ennemi avec particules
    this.time.delayedCall(400, () => {
      const spawnX = Phaser.Math.Between(200, this.WORLD.width - 200);
      const spawnY = 200;

      // Portail d'invocation
      this.emitParticles(spawnX, spawnY, {
        count: 25,
        colors: [0xff0099, 0xff00ff, 0xaa0066],
        minSpeed: 80,
        maxSpeed: 180,
        minSize: 4,
        maxSize: 10,
        life: 400,
        angle: Math.PI / 2,
        spread: Math.PI,
        fadeOut: true,
        shape: 'star'
      });

      const enemy = this.add.rectangle(spawnX, spawnY, 28, 28, 0xff4466);
      enemy.setStrokeStyle(2, 0xcc2244);
      this.physics.add.existing(enemy);
      enemy.body.setGravityY(this.config.gravity);
      enemy.body.setCollideWorldBounds(true);
      enemy.body.setVelocityX(Phaser.Math.Between(-80, 80));

      // Animation d'apparition
      enemy.setAlpha(0);
      enemy.setScale(0);
      this.tweens.add({
        targets: enemy,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 300,
        ease: 'Back.easeOut'
      });

      this.summonedEnemies.push(enemy);
      this.physics.add.collider(enemy, this.platforms);
      this.physics.add.overlap(this.player, enemy, (p, e) => this.hitSummonedEnemy(p, e), null, this);
    });

    // === RECOVERY (OPENING - Dark Souls style) ===
    this.time.delayedCall(800, () => {
      if (!this.boss || !this.boss.active) return;

      this.summonerState = 'recovering';

      // Visuel d'épuisement - boss vulnérable
      this.boss.setAlpha(0.6);
      this.tweens.add({
        targets: this.boss,
        scaleX: 0.9, scaleY: 1.1,
        duration: 200,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut'
      });

      // Particules d'énergie qui s'échappent (signe de faiblesse)
      const exhaustTimer = this.time.addEvent({
        delay: 150,
        callback: () => {
          if (this.boss && this.boss.active && this.summonerState === 'recovering') {
            this.emitParticles(this.boss.x + Phaser.Math.Between(-30, 30), this.boss.y, {
              count: 3,
              colors: [0xff00ff, 0xaa0088],
              minSpeed: 20,
              maxSpeed: 50,
              minSize: 2,
              maxSize: 5,
              life: 400,
              angle: -Math.PI / 2,
              spread: Math.PI / 3,
              fadeOut: true
            });
          }
        },
        repeat: 8
      });

      // Fin de la récupération - retour au combat
      this.time.delayedCall(1500, () => {
        if (!this.boss || !this.boss.active) return;

        this.summonerState = 'drifting';
        this.boss.setAlpha(1);

        // Animation de réveil
        this.tweens.add({
          targets: this.boss,
          scaleX: 1.2, scaleY: 0.8,
          duration: 150,
          yoyo: true,
          ease: 'Quad.easeOut'
        });
      });
    });
  }

  bossSummonerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // === DARK SOULS: Ne tire que pendant drifting ===
    if (this.summonerState !== 'drifting') return;

    // === TELEGRAPH (Wind-up) ===
    // Flash d'avertissement
    this.boss.setTint(0xff66ff);
    this.tweens.add({
      targets: this.boss,
      scaleY: 1.15,
      duration: 300,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (this.boss && this.boss.active) {
          this.boss.clearTint();
        }
      }
    });

    // Particules de charge avant tir
    this.emitParticles(this.boss.x, this.boss.y + 20, {
      count: 8,
      colors: [0xff00ff, 0xff66cc],
      minSpeed: 30,
      maxSpeed: 60,
      minSize: 3,
      maxSize: 6,
      life: 300,
      angle: Math.PI / 2,
      spread: Math.PI / 4,
      fadeOut: true
    });

    // Délai avant le tir réel (temps de réaction pour le joueur)
    this.time.delayedCall(350, () => {
      if (!this.boss || !this.boss.active || this.summonerState !== 'drifting') return;

      // Pluie de projectiles - un perçant au milieu en phase 2
      const numBullets = this.bossPhase >= 2 ? 5 : 3;
      for (let i = 0; i < numBullets; i++) {
        const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.8;
        this.time.delayedCall(i * 120, () => {
          if (this.boss && this.boss.active) {
            const isPiercing = this.bossPhase >= 2 && i === Math.floor(numBullets / 2);
            const x = this.boss.x + Phaser.Math.Between(-50, 50);
            if (isPiercing) {
              this.createPiercingBullet(x, this.boss.y + 30, Math.PI / 2, 160);
            } else {
              this.createBossBullet(x, this.boss.y + 30, angle, 140);
            }
          }
        });
      }
    });
  }

  hitSummonedEnemy(player, enemy) {
    if (this.isInvincible) return;

    if (player.body.velocity.y > 0 && player.y < enemy.y - 10) {
      // SFX + Particules
      this.playSound('enemyKill');
      this.particleEnemyDeath(enemy.x, enemy.y, enemy.deathColor || 0xff4466);
      enemy.destroy();
      this.summonedEnemies = this.summonedEnemies.filter(e => e.active);
      this.score += 30;
      this.scoreText.setText(this.score.toString().padStart(6, '0'));
      player.body.setVelocityY(-300);
    } else {
      this.takeDamage(3); // Ennemis invoqués = 3/4 coeur
    }
  }

  // ==========================================
  // BOSS 6 : CRUSHER - Écraseur gravitationnel
  // ==========================================
  initBossCrusher() {
    // CRUSHER est lent mais dévastateur - slams au sol, ondes de choc
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 200;
    this.setBossTargetVelocity(0, 0);

    // État du slam
    this.crusherSlamming = false;
    this.crusherShockwaves = [];

    // Timer de mouvement lent et menaçant
    this.bossMoveTimer = this.time.addEvent({
      delay: 2500,
      callback: this.bossCrusherMove,
      callbackScope: this,
      loop: true
    });

    // Timer de slam (attaque principale)
    this.bossShootTimer = this.time.addEvent({
      delay: 4000,
      callback: this.bossCrusherSlam,
      callbackScope: this,
      loop: true
    });

    // Timer de projectiles lourds
    this.crusherRockTimer = this.time.addEvent({
      delay: 3000,
      callback: this.bossCrusherThrowRock,
      callbackScope: this,
      loop: true
    });
  }

  bossCrusherMove() {
    if (!this.boss || !this.boss.active || this.crusherSlamming) return;

    const toPlayerX = this.player.x - this.boss.x;
    const speed = this.boss.moveSpeed * 0.3; // Très lent

    // Se positionner au-dessus du joueur lentement
    if (Math.abs(toPlayerX) > 80) {
      this.setBossTargetVelocity(Math.sign(toPlayerX) * speed, 0);
    } else {
      // Au-dessus du joueur - préparation du slam
      this.setBossTargetVelocity(0, -speed * 0.5);
    }

    // Rester dans la zone haute
    if (this.boss.y > 280) {
      this.setBossTargetVelocity(this.boss.targetVelX, -speed);
    }
    if (this.boss.y < 120) {
      this.setBossTargetVelocity(this.boss.targetVelX, speed * 0.3);
    }
  }

  bossCrusherSlam() {
    if (!this.boss || !this.boss.active || this.crusherSlamming) return;

    this.crusherSlamming = true;

    // SFX de préparation
    this.playSound('bossWarning');
    this.playSound('bossCharge');

    // Animation de préparation (monte légèrement)
    this.tweens.add({
      targets: this.boss,
      y: this.boss.y - 40,
      scaleX: 0.9,
      scaleY: 1.2,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // SLAM DOWN!
        const targetY = this.WORLD.groundY - 100;
        this.tweens.add({
          targets: this.boss,
          y: targetY,
          scaleX: 1.3,
          scaleY: 0.7,
          duration: 200,
          ease: 'Quad.easeIn',
          onComplete: () => {
            if (!this.boss || !this.boss.active) return;

            // SFX d'impact dévastateur
            this.playSound('bossSlam');

            // Impact au sol
            this.cameras.main.shake(400, 0.03);

            // Onde de choc au sol
            this.createCrusherShockwave(this.boss.x, targetY + 30);

            // Particules d'impact
            this.emitParticles(this.boss.x, targetY + 30, {
              count: 40,
              colors: [0x884422, 0x553311, 0xaa6633, 0xffffff],
              minSpeed: 150,
              maxSpeed: 350,
              minSize: 5,
              maxSize: 15,
              life: 600,
              angle: -Math.PI / 2,
              spread: Math.PI * 0.8,
              gravity: 300,
              fadeOut: true
            });

            // Retour à la normale
            this.time.delayedCall(400, () => {
              if (this.boss && this.boss.active) {
                this.tweens.add({
                  targets: this.boss,
                  scaleX: 1,
                  scaleY: 1,
                  y: 200,
                  duration: 800,
                  ease: 'Quad.easeOut'
                });
                this.crusherSlamming = false;
              }
            });
          }
        });
      }
    });
  }

  createCrusherShockwave(x, y) {
    // Onde de choc visuelle qui se propage
    const wave = this.add.ellipse(x, y, 30, 15, 0xcc6600, 0.6);
    wave.setStrokeStyle(4, 0xff8800);
    wave.setDepth(25);

    this.tweens.add({
      targets: wave,
      scaleX: 15,
      scaleY: 3,
      alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => wave.destroy()
    });

    // Dégâts sur l'onde (vérification périodique)
    const checkDamage = this.time.addEvent({
      delay: 50,
      repeat: 10,
      callback: () => {
        if (!this.player || this.isInvincible) return;
        const waveLeft = x - wave.scaleX * 15;
        const waveRight = x + wave.scaleX * 15;
        const playerOnGround = this.player.body.blocked.down || this.player.body.touching.down;

        if (playerOnGround && this.player.x > waveLeft && this.player.x < waveRight) {
          this.takeDamage(6); // Onde de choc de CRUSHER = 1.5 coeurs
        }
      }
    });
  }

  bossCrusherThrowRock() {
    if (!this.boss || !this.boss.active || this.crusherSlamming) return;

    // Lancer un gros projectile lent
    const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);

    // Animation de lancer
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.2,
      scaleY: 0.8,
      duration: 200,
      yoyo: true
    });

    this.time.delayedCall(250, () => {
      if (!this.boss || !this.boss.active) return;

      // Créer le rocher
      const rock = this.add.circle(this.boss.x, this.boss.y, 18, 0x884422);
      rock.setStrokeStyle(4, 0xcc6600);
      this.physics.add.existing(rock);
      rock.body.setAllowGravity(false);
      rock.body.setCircle(18);

      const speed = 120;
      rock.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

      // Rotation du rocher
      this.tweens.add({
        targets: rock,
        angle: 360,
        duration: 1000,
        repeat: -1
      });

      // Collision avec joueur
      this.physics.add.overlap(this.player, rock, () => {
        if (!this.isInvincible) {
          this.takeDamage(6); // Rocher de CRUSHER = 1.5 coeurs
          // Explosion du rocher
          this.emitParticles(rock.x, rock.y, {
            count: 15,
            colors: [0x884422, 0x553311],
            minSpeed: 80,
            maxSpeed: 180,
            minSize: 4,
            maxSize: 10,
            life: 400,
            spread: Math.PI * 2,
            fadeOut: true
          });
          rock.destroy();
        }
      });

      // Auto-destruction après un temps
      this.time.delayedCall(5000, () => {
        if (rock.active) rock.destroy();
      });
    });
  }

  // ==========================================
  // BOSS 7 : PHANTOM - Maître des illusions
  // ==========================================
  initBossPhantom() {
    // PHANTOM crée des clones et se téléporte
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 200;
    this.boss.setAlpha(0.8);
    this.setBossTargetVelocity(0, 0);

    // Clones actifs
    this.phantomClones = [];
    this.phantomRealIndex = 0; // Lequel est le vrai

    // Timer de mouvement spectral
    this.bossMoveTimer = this.time.addEvent({
      delay: 1500,
      callback: this.bossPhantomDrift,
      callbackScope: this,
      loop: true
    });

    // Timer de téléportation
    this.phantomTeleportTimer = this.time.addEvent({
      delay: 3500,
      callback: this.bossPhantomTeleport,
      callbackScope: this,
      loop: true
    });

    // Timer de création de clones
    this.bossShootTimer = this.time.addEvent({
      delay: 5000,
      callback: this.bossPhantomCreateClones,
      callbackScope: this,
      loop: true
    });

    // Timer de tirs spectraux
    this.phantomShootTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossPhantomShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossPhantomDrift() {
    if (!this.boss || !this.boss.active) return;

    // Mouvement imprévisible, comme un fantôme
    const randAngle = Math.random() * Math.PI * 2;
    const speed = this.boss.moveSpeed * 0.5;

    this.setBossTargetVelocity(
      Math.cos(randAngle) * speed,
      Math.sin(randAngle) * speed * 0.5
    );

    // Garder dans la zone
    if (this.boss.x < 150) this.setBossTargetVelocity(speed, this.boss.targetVelY);
    if (this.boss.x > this.WORLD.width - 150) this.setBossTargetVelocity(-speed, this.boss.targetVelY);
    if (this.boss.y < 120) this.setBossTargetVelocity(this.boss.targetVelX, speed * 0.5);
    if (this.boss.y > 300) this.setBossTargetVelocity(this.boss.targetVelX, -speed * 0.5);
  }

  bossPhantomTeleport() {
    if (!this.boss || !this.boss.active) return;

    // Effet de disparition
    this.tweens.add({
      targets: this.boss,
      alpha: 0,
      scaleX: 0.5,
      scaleY: 1.5,
      duration: 300,
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // Particules de disparition
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 20,
          colors: [0x9933ff, 0x6600aa, 0xcc66ff],
          minSpeed: 80,
          maxSpeed: 180,
          minSize: 3,
          maxSize: 8,
          life: 400,
          spread: Math.PI * 2,
          fadeOut: true
        });

        // Nouvelle position (loin du joueur ou derrière)
        const behindPlayer = this.player.x < this.WORLD.width / 2;
        this.boss.x = behindPlayer ?
          Phaser.Math.Between(this.WORLD.width / 2 + 100, this.WORLD.width - 150) :
          Phaser.Math.Between(150, this.WORLD.width / 2 - 100);
        this.boss.y = Phaser.Math.Between(150, 280);

        // Effet de réapparition
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 25,
          colors: [0xcc66ff, 0x9933ff, 0xffffff],
          minSpeed: 50,
          maxSpeed: 120,
          minSize: 2,
          maxSize: 6,
          life: 350,
          spread: Math.PI * 2,
          fadeOut: true
        });

        this.tweens.add({
          targets: this.boss,
          alpha: 0.8,
          scaleX: 1,
          scaleY: 1,
          duration: 300
        });
      }
    });
  }

  bossPhantomCreateClones() {
    if (!this.boss || !this.boss.active) return;

    // Détruire les anciens clones
    this.phantomClones.forEach(c => {
      if (c && c.active) {
        this.emitParticles(c.x, c.y, {
          count: 10,
          colors: [0x9933ff, 0x6600aa],
          minSpeed: 50,
          maxSpeed: 100,
          minSize: 2,
          maxSize: 5,
          life: 300,
          spread: Math.PI * 2,
          fadeOut: true
        });
        c.destroy();
      }
    });
    this.phantomClones = [];

    // Créer 2-3 clones en phase 2+
    const numClones = this.bossPhase >= 2 ? 3 : 2;

    // Flash pour signaler la création
    this.cameras.main.flash(100, 150, 50, 200, false);

    for (let i = 0; i < numClones; i++) {
      this.time.delayedCall(i * 200, () => {
        if (!this.boss || !this.boss.active) return;

        const clone = this.add.ellipse(
          this.boss.x + (Math.random() - 0.5) * 200,
          this.boss.y + (Math.random() - 0.5) * 100,
          28 * 0.8,
          28,
          0x6600aa,
          0.5
        );
        clone.setStrokeStyle(2, 0x9933ff);
        this.physics.add.existing(clone);
        clone.body.setAllowGravity(false);
        clone.isClone = true;
        clone.health = 1;

        // Animation d'apparition
        clone.setAlpha(0);
        clone.setScale(0);
        this.tweens.add({
          targets: clone,
          alpha: 0.5,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          ease: 'Back.easeOut'
        });

        // Mouvement autonome du clone
        clone.moveTimer = this.time.addEvent({
          delay: 1000,
          loop: true,
          callback: () => {
            if (!clone.active) return;
            const angle = Math.random() * Math.PI * 2;
            clone.body.setVelocity(
              Math.cos(angle) * 60,
              Math.sin(angle) * 40
            );
          }
        });

        // Tir du clone
        clone.shootTimer = this.time.addEvent({
          delay: 2500,
          loop: true,
          callback: () => {
            if (!clone.active || !this.player) return;
            const angle = Phaser.Math.Angle.Between(clone.x, clone.y, this.player.x, this.player.y);
            this.createBossBullet(clone.x, clone.y, angle, 100);
          }
        });

        this.phantomClones.push(clone);

        // Collision avec le joueur (sauter dessus détruit le clone)
        this.physics.add.overlap(this.player, clone, (p, c) => {
          if (this.isInvincible) return;

          if (p.body.velocity.y > 0 && p.y < c.y - 10) {
            // Détruire le clone
            this.playSound('enemyKill');
            this.emitParticles(c.x, c.y, {
              count: 15,
              colors: [0x9933ff, 0x6600aa, 0xcc66ff],
              minSpeed: 80,
              maxSpeed: 180,
              minSize: 3,
              maxSize: 8,
              life: 400,
              spread: Math.PI * 2,
              fadeOut: true
            });
            if (c.moveTimer) c.moveTimer.remove();
            if (c.shootTimer) c.shootTimer.remove();
            c.destroy();
            this.phantomClones = this.phantomClones.filter(x => x.active);
            p.body.setVelocityY(-300);
          } else {
            this.takeDamage(3); // Clone Phantom = 3/4 coeur
          }
        });
      });
    }
  }

  bossPhantomShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Tir spectral avec trajectoire courbe
    const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);

    // Animation
    this.tweens.add({
      targets: this.boss,
      alpha: 1,
      duration: 100,
      yoyo: true,
      onYoyo: () => this.boss.setAlpha(0.8)
    });

    // Tir principal
    this.createBossBullet(this.boss.x, this.boss.y, angle, 140);

    // Phase 2+: tir en arc
    if (this.bossPhase >= 2) {
      this.time.delayedCall(150, () => {
        if (this.boss && this.boss.active) {
          this.createBossBullet(this.boss.x, this.boss.y, angle - 0.3, 130);
          this.createBossBullet(this.boss.x, this.boss.y, angle + 0.3, 130);
        }
      });
    }
  }

  // ==========================================
  // BOSS 8 : BERSERKER - Rage incontrôlable
  // ==========================================
  initBossBerserker() {
    // BERSERKER devient plus rapide et dangereux quand blessé
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 250;
    this.setBossTargetVelocity(0, 0);

    // État de rage
    this.berserkerRage = 0; // 0-1, augmente avec les dégâts
    this.berserkerCharging = false;

    // Timer de mouvement agressif
    this.bossMoveTimer = this.time.addEvent({
      delay: 1800,
      callback: this.bossBerserkerMove,
      callbackScope: this,
      loop: true
    });

    // Timer de charge
    this.bossShootTimer = this.time.addEvent({
      delay: 3500,
      callback: this.bossBerserkerCharge,
      callbackScope: this,
      loop: true
    });

    // Timer de frappe au sol
    this.berserkerSlamTimer = this.time.addEvent({
      delay: 4500,
      callback: this.bossBerserkerGroundSlam,
      callbackScope: this,
      loop: true
    });
  }

  bossBerserkerMove() {
    if (!this.boss || !this.boss.active || this.berserkerCharging) return;

    // Calculer le niveau de rage basé sur la santé
    this.berserkerRage = 1 - (this.bossHealth / this.bossMaxHealth);

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // Vitesse augmente avec la rage
    const baseSpeed = this.boss.moveSpeed;
    const rageBonus = this.berserkerRage * 1.5;
    const speed = baseSpeed * (1 + rageBonus);

    // Mouvement agressif vers le joueur
    this.setBossTargetVelocity(
      (toPlayerX / dist) * speed,
      (toPlayerY / dist) * speed * 0.5
    );

    // Garder dans les limites
    const maxY = this.WORLD.groundY - 100;
    if (this.boss.y > maxY) {
      this.setBossTargetVelocity(this.boss.targetVelX, -speed * 0.5);
    }
    if (this.boss.y < 120) {
      this.setBossTargetVelocity(this.boss.targetVelX, speed * 0.3);
    }

    // Effet visuel de rage
    if (this.berserkerRage > 0.5) {
      // Aura de rage plus intense
      this.emitParticles(this.boss.x, this.boss.y, {
        count: 2,
        colors: [0xff0000, 0xff3300],
        minSpeed: 50,
        maxSpeed: 100,
        minSize: 3,
        maxSize: 6,
        life: 300,
        spread: Math.PI * 2,
        fadeOut: true
      });
    }
  }

  bossBerserkerCharge() {
    if (!this.boss || !this.boss.active || this.berserkerCharging) return;

    this.berserkerCharging = true;

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

    // Animation de préparation
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.8,
      scaleY: 1.2,
      duration: 500,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // CHARGE!
        const chargeSpeed = 500 + this.berserkerRage * 300;
        this.bossLunge(toPlayerX / dist, toPlayerY / dist * 0.3, chargeSpeed);

        // Traînée de rage
        for (let i = 0; i < 5; i++) {
          this.time.delayedCall(i * 50, () => {
            if (this.boss && this.boss.active) {
              this.emitParticles(this.boss.x, this.boss.y, {
                count: 5,
                colors: [0xff0000, 0xff3300, 0xff6600],
                minSpeed: 30,
                maxSpeed: 80,
                minSize: 4,
                maxSize: 10,
                life: 300,
                spread: Math.PI,
                angle: Math.atan2(-toPlayerY, -toPlayerX),
                fadeOut: true
              });
            }
          });
        }

        this.time.delayedCall(800, () => {
          this.berserkerCharging = false;
          this.tweens.add({
            targets: this.boss,
            scaleX: 1,
            scaleY: 1,
            duration: 200
          });
        });
      }
    });
  }

  bossBerserkerGroundSlam() {
    if (!this.boss || !this.boss.active || this.berserkerCharging) return;

    // Coup de poing au sol - crée une onde de feu
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.3,
      scaleY: 0.7,
      y: this.boss.y + 30,
      duration: 300,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (!this.boss || !this.boss.active) return;

        // Shake
        this.cameras.main.shake(200, 0.02);

        // Particules de frappe
        this.emitParticles(this.boss.x, this.boss.y + 40, {
          count: 25,
          colors: [0xff0000, 0xff3300, 0xff6600, 0xffaa00],
          minSpeed: 100,
          maxSpeed: 250,
          minSize: 4,
          maxSize: 12,
          life: 500,
          angle: -Math.PI / 2,
          spread: Math.PI * 0.7,
          gravity: 200,
          fadeOut: true
        });

        // Créer des projectiles en ligne au sol
        const numProjectiles = 3 + Math.floor(this.berserkerRage * 3);
        for (let i = 0; i < numProjectiles; i++) {
          this.time.delayedCall(i * 100, () => {
            if (this.boss && this.boss.active) {
              // Projectile gauche
              this.createBossBullet(this.boss.x - 30, this.boss.y + 30, Math.PI, 150 + i * 20);
              // Projectile droite
              this.createBossBullet(this.boss.x + 30, this.boss.y + 30, 0, 150 + i * 20);
            }
          });
        }

        // Retour à la normale
        this.time.delayedCall(300, () => {
          if (this.boss && this.boss.active) {
            this.tweens.add({
              targets: this.boss,
              scaleX: 1,
              scaleY: 1,
              y: this.boss.y - 30,
              duration: 400,
              ease: 'Quad.easeOut'
            });
          }
        });
      }
    });
  }

  // ==========================================
  // BOSS 9 : ARCHITECT - Maître de l'arène
  // ==========================================
  initBossArchitect() {
    // ARCHITECT construit des obstacles et modifie l'arène
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 180;
    this.setBossTargetVelocity(0, 0);

    // Structures créées
    this.architectStructures = [];
    this.architectLasers = [];

    // Timer de mouvement méthodique
    this.bossMoveTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossArchitectMove,
      callbackScope: this,
      loop: true
    });

    // Timer de construction
    this.bossShootTimer = this.time.addEvent({
      delay: 4000,
      callback: this.bossArchitectBuild,
      callbackScope: this,
      loop: true
    });

    // Timer de laser de scan
    this.architectLaserTimer = this.time.addEvent({
      delay: 3000,
      callback: this.bossArchitectLaser,
      callbackScope: this,
      loop: true
    });
  }

  bossArchitectMove() {
    if (!this.boss || !this.boss.active) return;

    // Mouvement précis et calculé - se positionne stratégiquement
    const positions = [
      { x: this.WORLD.width * 0.25, y: 180 },
      { x: this.WORLD.width * 0.5, y: 160 },
      { x: this.WORLD.width * 0.75, y: 180 },
      { x: this.WORLD.width * 0.5, y: 220 }
    ];

    const target = positions[Math.floor(Math.random() * positions.length)];
    const toTargetX = target.x - this.boss.x;
    const toTargetY = target.y - this.boss.y;
    const dist = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY) || 1;
    const speed = this.boss.moveSpeed * 0.4;

    this.setBossTargetVelocity(
      (toTargetX / dist) * speed,
      (toTargetY / dist) * speed
    );
  }

  bossArchitectBuild() {
    if (!this.boss || !this.boss.active) return;

    // Nettoyer les vieilles structures
    this.architectStructures = this.architectStructures.filter(s => {
      if (!s || !s.active) return false;
      return true;
    });

    // Limiter le nombre de structures
    if (this.architectStructures.length >= 4) {
      // Détruire la plus ancienne
      const oldest = this.architectStructures.shift();
      if (oldest && oldest.active) {
        this.emitParticles(oldest.x, oldest.y, {
          count: 15,
          colors: [0x00ff44, 0x00aa33],
          minSpeed: 80,
          maxSpeed: 150,
          minSize: 3,
          maxSize: 8,
          life: 400,
          spread: Math.PI * 2,
          fadeOut: true
        });
        oldest.destroy();
      }
    }

    // Animation de construction
    this.tweens.add({
      targets: this.boss,
      scaleX: 0.9,
      scaleY: 1.1,
      duration: 300,
      yoyo: true
    });

    // Construire un obstacle/tourelle
    const buildX = Phaser.Math.Between(150, this.WORLD.width - 150);
    const buildY = Phaser.Math.Between(200, this.WORLD.groundY - 150);

    // Effet de construction
    this.emitParticles(buildX, buildY, {
      count: 20,
      colors: [0x00ff44, 0x00ff00, 0xffffff],
      minSpeed: 50,
      maxSpeed: 120,
      minSize: 2,
      maxSize: 6,
      life: 500,
      spread: Math.PI * 2,
      fadeOut: true
    });

    this.time.delayedCall(400, () => {
      if (!this.boss || !this.boss.active) return;

      // Type de structure (tourelle ou mur)
      const isTurret = Math.random() < 0.6;

      if (isTurret) {
        // Tourelle qui tire
        const turret = this.add.polygon(buildX, buildY, [
          -15, 15, 15, 15, 10, -10, 0, -20, -10, -10
        ], 0x00aa44);
        turret.setStrokeStyle(3, 0x00ff66);
        this.physics.add.existing(turret, true); // Static

        turret.isTurret = true;

        // Timer de tir de la tourelle
        turret.shootTimer = this.time.addEvent({
          delay: 2000,
          loop: true,
          callback: () => {
            if (!turret.active || !this.player) return;
            const angle = Phaser.Math.Angle.Between(turret.x, turret.y, this.player.x, this.player.y);
            this.createBossBullet(turret.x, turret.y - 15, angle, 120);

            // Animation de tir
            this.emitParticles(turret.x, turret.y - 15, {
              count: 5,
              colors: [0x00ff44, 0xffffff],
              minSpeed: 40,
              maxSpeed: 80,
              minSize: 2,
              maxSize: 4,
              life: 200,
              angle: angle,
              spread: 0.5,
              fadeOut: true
            });
          }
        });

        this.architectStructures.push(turret);

        // Collision pour détruire la tourelle
        this.physics.add.overlap(this.player, turret, (p, t) => {
          if (p.body.velocity.y > 0 && p.y < t.y - 10) {
            this.playSound('enemyKill');
            this.emitParticles(t.x, t.y, {
              count: 20,
              colors: [0x00ff44, 0x00aa33, 0xffffff],
              minSpeed: 100,
              maxSpeed: 200,
              minSize: 4,
              maxSize: 10,
              life: 400,
              spread: Math.PI * 2,
              fadeOut: true
            });
            if (t.shootTimer) t.shootTimer.remove();
            t.destroy();
            this.architectStructures = this.architectStructures.filter(s => s.active);
            p.body.setVelocityY(-300);
          }
        });
      } else {
        // Mur/obstacle
        const wall = this.add.rectangle(buildX, buildY, 60, 80, 0x006633);
        wall.setStrokeStyle(3, 0x00ff66);
        this.physics.add.existing(wall, true);

        wall.isWall = true;

        this.architectStructures.push(wall);

        // Le mur disparaît après un temps
        this.time.delayedCall(8000, () => {
          if (wall.active) {
            this.emitParticles(wall.x, wall.y, {
              count: 15,
              colors: [0x00ff44, 0x006633],
              minSpeed: 60,
              maxSpeed: 120,
              minSize: 3,
              maxSize: 8,
              life: 400,
              spread: Math.PI * 2,
              fadeOut: true
            });
            wall.destroy();
            this.architectStructures = this.architectStructures.filter(s => s.active);
          }
        });

        // Collision physique avec le joueur
        this.physics.add.collider(this.player, wall);
      }
    });
  }

  bossArchitectLaser() {
    if (!this.boss || !this.boss.active) return;

    // Laser de scan horizontal
    const laserY = this.boss.y;

    // Ligne de visée (warning)
    const warning = this.add.rectangle(this.WORLD.width / 2, laserY, this.WORLD.width, 4, 0xff0000, 0.3);
    warning.setDepth(25);

    // Animation de warning
    this.tweens.add({
      targets: warning,
      alpha: 0.6,
      duration: 200,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        warning.destroy();

        if (!this.boss || !this.boss.active) return;

        // Tir du laser!
        const laser = this.add.rectangle(this.WORLD.width / 2, laserY, this.WORLD.width, 12, 0x00ff00, 0.8);
        laser.setStrokeStyle(2, 0xffffff);
        laser.setDepth(26);

        // Dégâts du laser
        const checkDamage = this.time.addEvent({
          delay: 50,
          repeat: 5,
          callback: () => {
            if (!this.player || this.isInvincible) return;
            if (Math.abs(this.player.y - laserY) < 20) {
              this.takeDamage(6); // Laser de TWINS = 1.5 coeurs
            }
          }
        });

        // Particules le long du laser
        for (let i = 0; i < 10; i++) {
          this.emitParticles(100 + i * 70, laserY, {
            count: 3,
            colors: [0x00ff00, 0x00ff44, 0xffffff],
            minSpeed: 30,
            maxSpeed: 80,
            minSize: 2,
            maxSize: 5,
            life: 300,
            spread: Math.PI * 2,
            fadeOut: true
          });
        }

        this.time.delayedCall(300, () => laser.destroy());
      }
    });
  }

  // ==========================================
  // BOSS 10 : TWINS - Combat synchronisé
  // ==========================================
  initBossTwins() {
    // TWINS: deux boss qui combattent ensemble
    this.boss.x = this.WORLD.width / 2 - 80;
    this.boss.y = 200;
    this.setBossTargetVelocity(0, 0);

    // Créer le deuxième jumeau
    this.twin2 = this.add.circle(this.WORLD.width / 2 + 80, 200, 30, 0xff9900);
    this.twin2.setStrokeStyle(3, 0xffcc00);
    this.physics.add.existing(this.twin2);
    this.twin2.body.setAllowGravity(false);
    this.twin2.body.setCollideWorldBounds(true);
    this.twin2.targetVelX = 0;
    this.twin2.targetVelY = 0;
    this.twin2.health = this.bossMaxHealth;
    this.twin2.alive = true;

    // Lien visuel entre les jumeaux
    this.twinsLink = this.add.graphics();
    this.twinsLink.setDepth(24);

    // Timer de mouvement synchronisé
    this.bossMoveTimer = this.time.addEvent({
      delay: 1500,
      callback: this.bossTwinsMove,
      callbackScope: this,
      loop: true
    });

    // Timer d'attaque alternée
    this.bossShootTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossTwinsAttack,
      callbackScope: this,
      loop: true
    });

    // Timer d'attaque combinée
    this.twinsComboTimer = this.time.addEvent({
      delay: 5000,
      callback: this.bossTwinsComboAttack,
      callbackScope: this,
      loop: true
    });

    // Collision avec le twin2
    this.physics.add.overlap(this.player, this.twin2, () => this.hitTwin2(), null, this);
  }

  bossTwinsMove() {
    if (!this.boss || !this.boss.active) return;

    const centerX = this.WORLD.width / 2;
    const time = this.time.now;

    // Mouvement orbital autour du centre
    const orbitRadius = 120;
    const orbitSpeed = 0.002;

    // Twin 1 (orange agressif)
    const angle1 = time * orbitSpeed;
    const target1X = centerX + Math.cos(angle1) * orbitRadius;
    const target1Y = 200 + Math.sin(angle1 * 2) * 50;

    const toTarget1X = target1X - this.boss.x;
    const toTarget1Y = target1Y - this.boss.y;
    this.setBossTargetVelocity(toTarget1X * 0.1, toTarget1Y * 0.1);

    // Twin 2 (bleu défensif) - opposé
    if (this.twin2 && this.twin2.alive) {
      const angle2 = time * orbitSpeed + Math.PI;
      const target2X = centerX + Math.cos(angle2) * orbitRadius;
      const target2Y = 200 + Math.sin(angle2 * 2) * 50;

      const toTarget2X = target2X - this.twin2.x;
      const toTarget2Y = target2Y - this.twin2.y;
      this.twin2.targetVelX = toTarget2X * 0.1;
      this.twin2.targetVelY = toTarget2Y * 0.1;

      // Appliquer le mouvement au twin2
      const diffX = this.twin2.targetVelX - this.twin2.body.velocity.x;
      const diffY = this.twin2.targetVelY - this.twin2.body.velocity.y;
      this.twin2.body.velocity.x += diffX * 0.05;
      this.twin2.body.velocity.y += diffY * 0.05;
    }

    // Mettre à jour le lien visuel
    this.updateTwinsLink();
  }

  updateTwinsLink() {
    if (!this.twinsLink || !this.boss || !this.boss.active) return;

    this.twinsLink.clear();

    if (this.twin2 && this.twin2.alive) {
      // Dessiner le lien entre les jumeaux
      this.twinsLink.lineStyle(4, 0xffff00, 0.6);
      this.twinsLink.beginPath();
      this.twinsLink.moveTo(this.boss.x, this.boss.y);
      this.twinsLink.lineTo(this.twin2.x, this.twin2.y);
      this.twinsLink.strokePath();

      // Points d'énergie sur le lien
      const midX = (this.boss.x + this.twin2.x) / 2;
      const midY = (this.boss.y + this.twin2.y) / 2;
      this.twinsLink.fillStyle(0xffff00, 0.8);
      this.twinsLink.fillCircle(midX, midY, 6 + Math.sin(this.time.now * 0.01) * 2);
    }
  }

  bossTwinsAttack() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Attaque alternée entre les jumeaux
    const twin1Turn = Math.random() < 0.5;

    if (twin1Turn || !this.twin2 || !this.twin2.alive) {
      // Twin 1 attaque (burst rapide)
      const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
      for (let i = 0; i < 3; i++) {
        this.time.delayedCall(i * 100, () => {
          if (this.boss && this.boss.active) {
            this.createBossBullet(this.boss.x, this.boss.y, angle + (Math.random() - 0.5) * 0.2, 160);
          }
        });
      }
    } else {
      // Twin 2 attaque (tir défensif en cercle)
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.createBossBullet(this.twin2.x, this.twin2.y, angle, 100);
      }
    }
  }

  bossTwinsComboAttack() {
    if (!this.boss || !this.boss.active) return;
    if (!this.twin2 || !this.twin2.alive) return;

    // Attaque combinée: les deux jumeaux tirent vers le joueur en même temps
    // avec un laser sur le lien

    // Animation de charge
    this.tweens.add({
      targets: [this.boss, this.twin2],
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 400,
      yoyo: true
    });

    this.time.delayedCall(500, () => {
      if (!this.boss || !this.boss.active) return;
      if (!this.twin2 || !this.twin2.alive) return;

      // Laser sur le lien
      const linkGraphics = this.add.graphics();
      linkGraphics.setDepth(27);
      linkGraphics.lineStyle(15, 0xffff00, 0.8);
      linkGraphics.beginPath();
      linkGraphics.moveTo(this.boss.x, this.boss.y);
      linkGraphics.lineTo(this.twin2.x, this.twin2.y);
      linkGraphics.strokePath();

      // Vérifier si le joueur est touché par le lien
      const linkDamage = this.time.addEvent({
        delay: 50,
        repeat: 6,
        callback: () => {
          if (!this.player || this.isInvincible) return;
          // Vérifier la distance du joueur à la ligne
          const dist = this.pointToLineDistance(
            this.player.x, this.player.y,
            this.boss.x, this.boss.y,
            this.twin2.x, this.twin2.y
          );
          if (dist < 25) {
            this.takeDamage(8); // Lien électrique de TWINS = 2 coeurs (attaque spéciale)
          }
        }
      });

      this.time.delayedCall(350, () => linkGraphics.destroy());

      // Tirs simultanés
      const angle1 = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
      const angle2 = Phaser.Math.Angle.Between(this.twin2.x, this.twin2.y, this.player.x, this.player.y);

      this.createBossBullet(this.boss.x, this.boss.y, angle1, 180);
      this.createBossBullet(this.twin2.x, this.twin2.y, angle2, 180);
    });
  }

  pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  hitTwin2() {
    if (this.isInvincible || !this.twin2 || !this.twin2.alive) return;

    if (this.player.body.velocity.y > 0 && this.player.y < this.twin2.y - 10) {
      // Dégâts au twin2
      this.twin2.health--;
      this.player.body.setVelocityY(-350);

      // Effet de dégât
      this.emitParticles(this.twin2.x, this.twin2.y, {
        count: 15,
        colors: [0xff9900, 0xffcc00, 0xffffff],
        minSpeed: 80,
        maxSpeed: 180,
        minSize: 3,
        maxSize: 8,
        life: 400,
        spread: Math.PI * 2,
        fadeOut: true
      });

      this.tweens.add({
        targets: this.twin2,
        alpha: 0.3,
        duration: 100,
        yoyo: true,
        repeat: 3
      });

      // Vérifier si twin2 est mort
      if (this.twin2.health <= 0) {
        this.twin2.alive = false;

        // Mort du twin2
        this.emitParticles(this.twin2.x, this.twin2.y, {
          count: 40,
          colors: [0xff9900, 0xffcc00, 0xffffff],
          minSpeed: 100,
          maxSpeed: 250,
          minSize: 4,
          maxSize: 12,
          life: 600,
          spread: Math.PI * 2,
          fadeOut: true
        });

        this.playSound('bossHit');
        this.twin2.destroy();

        // Le boss restant devient enragé
        this.boss.moveSpeed *= 1.5;
        this.bossShootTimer.delay = 1500;
      }
    } else {
      this.takeDamage(6); // Contact avec TWINS = 1.5 coeurs
    }
  }

  // ==========================================
  // UTILITAIRES BOSS
  // ==========================================
  // Callback quand un projectile touche une plateforme
  // Process callback - retourne false pour empêcher la collision des balles perforantes
  shouldBulletCollide(bullet, platform) {
    return !bullet.piercing; // false = pas de collision pour les perçants
  }

  bulletHitPlatform(bullet, platform) {
    // Ce callback n'est appelé que si shouldBulletCollide a retourné true (non-perçant)
    // Petit effet d'impact
    const spark = this.add.circle(bullet.x, bullet.y, 5, bullet.fillColor || 0xffffff);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 2,
      duration: 150,
      onComplete: () => spark.destroy()
    });

    bullet.destroy();
  }

  // Projectile normal (bloqué par obstacles)
  createBossBullet(x, y, angle, speed) {
    return this.createProjectile(x, y, angle, speed, false);
  }

  // Projectile perçant (traverse tout)
  createPiercingBullet(x, y, angle, speed) {
    return this.createProjectile(x, y, angle, speed, true);
  }

  // Factory de projectiles
  createProjectile(x, y, angle, speed, piercing = false) {
    if (this.bullets.getLength() >= 40) {
      const oldest = this.bullets.getFirstAlive();
      if (oldest) oldest.destroy();
    }

    // SFX de tir (throttlé pour ne pas spammer)
    if (!this.lastBulletSfxTime || this.time.now - this.lastBulletSfxTime > 80) {
      this.playSound('bossBullet');
      this.lastBulletSfxTime = this.time.now;
    }

    const colors = {
      1: { fill: 0xff00ff, stroke: 0xaa00aa },
      2: { fill: 0x00ffff, stroke: 0x00aaaa },
      3: { fill: 0xffff00, stroke: 0xaaaa00 },
      4: { fill: 0x00ccff, stroke: 0x0066aa },
      5: { fill: 0xff0099, stroke: 0xaa0066 }
    };
    const color = colors[this.bossType] || colors[1];

    let bullet;
    if (piercing) {
      // Projectile perçant : forme losange, plus gros, avec trainée
      bullet = this.add.polygon(x, y, [0, -12, 6, 0, 0, 12, -6, 0], color.fill);
      bullet.setStrokeStyle(2, 0xff0000); // Bordure rouge = danger perçant
      bullet.piercing = true;
      bullet.setRotation(angle + Math.PI / 2);
    } else {
      // Projectile normal : cercle
      bullet = this.add.circle(x, y, 7, color.fill);
      bullet.setStrokeStyle(2, color.stroke);
      bullet.piercing = false;
    }

    this.bullets.add(bullet);
    bullet.body.setAllowGravity(false);
    bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

    // Dégâts des projectiles de boss (basé sur type de boss et perçant)
    // 1 HP = 1/4 coeur, 2 HP = 1/2 coeur, 4 HP = 1 coeur
    if (piercing) {
      // Projectiles perçants = 3/4 coeur (dangereux car traversent)
      bullet.damage = 3;
    } else {
      // Projectiles normaux par type de boss
      const bossDamage = {
        1: 2,  // CHARGER: 1/2 coeur
        2: 2,  // SPINNER: 1/2 coeur
        3: 2,  // SPLITTER: 1/2 coeur
        4: 3,  // GUARDIAN: 3/4 coeur (tir lourd)
        5: 2,  // SUMMONER: 1/2 coeur
        6: 3,  // CRUSHER: 3/4 coeur (tir puissant)
        7: 2,  // PHANTOM: 1/2 coeur
        8: 2   // BERSERKER: 1/2 coeur (compense par le volume)
      };
      bullet.damage = bossDamage[this.bossType] || 2;
    }

    // Particules de tir (muzzle flash)
    this.particleBossShoot(x, y, angle, color.fill, piercing);

    this.time.delayedCall(piercing ? 5000 : 4000, () => {
      if (bullet && bullet.active) bullet.destroy();
    });

    return bullet;
  }

  // Particules de tir du boss
  particleBossShoot(x, y, angle, color, piercing) {
    if (piercing) {
      // Tir perçant : éclat énergétique intense
      this.emitParticles(x, y, {
        count: 8,
        colors: [color, 0xff0000, 0xffffff],
        minSpeed: 80,
        maxSpeed: 200,
        minSize: 3,
        maxSize: 8,
        life: 250,
        angle: angle + Math.PI,
        spread: Math.PI / 2,
        fadeOut: true,
        shape: 'star'
      });
    } else {
      // Tir normal : petit flash
      this.emitParticles(x, y, {
        count: 4,
        colors: [color, 0xffffff],
        minSpeed: 40,
        maxSpeed: 100,
        minSize: 2,
        maxSize: 5,
        life: 150,
        angle: angle + Math.PI,
        spread: Math.PI / 3,
        fadeOut: true
      });
    }
  }

  bossDash(dirX, dirY) {
    if (!this.boss || !this.boss.active) return;

    this.bossDashing = true;
    this.bossDashCooldown = true;

    // Feedback visuel - couleur vive
    const brightColors = { 1: 0xff00ff, 2: 0x00ffff, 3: 0xffff00, 4: 0x00ccff, 5: 0xff0099 };
    const dashColor = brightColors[this.bossType] || 0xff00ff;

    // Particules de charge au départ
    this.emitParticles(this.boss.x, this.boss.y, {
      count: 15,
      colors: [dashColor, 0xffffff, this.bossColor],
      minSpeed: 100,
      maxSpeed: 250,
      minSize: 4,
      maxSize: 12,
      life: 400,
      angle: Math.atan2(-dirY, -dirX),
      spread: Math.PI / 2,
      fadeOut: true,
      shape: 'square'
    });

    // Traînée de particules pendant le dash
    const trailInterval = setInterval(() => {
      if (!this.boss || !this.boss.active || !this.bossDashing) {
        clearInterval(trailInterval);
        return;
      }
      this.emitParticles(this.boss.x, this.boss.y, {
        count: 3,
        colors: [dashColor, this.bossColor],
        minSpeed: 20,
        maxSpeed: 60,
        minSize: 5,
        maxSize: 10,
        life: 200,
        fadeOut: true,
        shrink: true
      });
    }, 30);

    // Dash rapide
    const dashSpeed = 400;
    this.boss.body.setVelocity(dirX * dashSpeed, dirY * dashSpeed);

    // Fin du dash
    this.time.delayedCall(250, () => {
      this.bossDashing = false;
      clearInterval(trailInterval);
      if (this.boss && this.boss.active) {
        this.boss.body.setVelocity(0, 0);
        // Particules d'impact à l'arrivée
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 10,
          colors: [dashColor, 0xffffff],
          minSpeed: 50,
          maxSpeed: 150,
          minSize: 3,
          maxSize: 8,
          life: 300,
          spread: Math.PI * 2,
          fadeOut: true
        });
      }
    });

    // Cooldown du dash
    this.time.delayedCall(800, () => {
      this.bossDashCooldown = false;
    });
  }

  hitBoss(player, boss) {
    // Si on saute sur le boss (fenêtre agrandie et fonctionne même en invincible!)
    if (player.body.velocity.y > 0 && player.y < boss.y - 10) {
      // Cooldown pour éviter les hits multiples
      if (this.bossHitCooldown) return;

      // GUARDIAN : Vérifier le bouclier
      if (this.bossType === 4 && this.guardianShield) {
        player.body.setVelocityY(-400); // Rebond mais pas de dégâts
        // SFX de bouclier
        this.playSound('shieldBlock');
        // Effet visuel de bouclier
        this.tweens.add({
          targets: this.guardianShieldSprite,
          alpha: 0.8,
          duration: 100,
          yoyo: true
        });
        return;
      }

      this.bossHitCooldown = true;

      // Effet de clignotement pendant l'invincibilité (1 seconde) sur le boss et l'œil
      const blinkTargets = [this.boss, this.bossEye, this.bossPupil, this.bossEyeGlint].filter(t => t);
      const blinkTween = this.tweens.add({
        targets: blinkTargets,
        alpha: 0.3,
        duration: 80,
        yoyo: true,
        repeat: 5,
        onComplete: () => {
          blinkTargets.forEach(t => { if (t && t.active !== false) t.alpha = 1; });
        }
      });
      this.bossBlinkTween = blinkTween;

      this.time.delayedCall(1000, () => {
        this.bossHitCooldown = false;
        if (this.bossBlinkTween) this.bossBlinkTween.stop();
        blinkTargets.forEach(t => { if (t && t.active !== false) t.alpha = 1; });
      });

      // SFX + Particules de hit boss
      this.playSound('bossHit');
      this.particleBossHit(boss.x, boss.y, this.bossColor);

      // === CRI DE DOULEUR DU BOSS ===
      this.bossHurtCry(boss);

      this.bossHealth--;
      this.updateBossHealthBar();
      player.body.setVelocityY(-550); // Rebond plus fort pour éloigner le joueur

      // SPLITTER : Spawn minions quand touché
      if (this.bossType === 3 && this.bossHealth > 0) {
        this.spawnSplitterMinion(boss.x - 50, boss.y);
        this.spawnSplitterMinion(boss.x + 50, boss.y);
      }

      // Pause des tirs pendant la contre-attaque
      this.bossShotPaused = true;

      // Contre-attaque (seulement pour certains boss)
      if (this.bossType === 1 || this.bossType === 3) {
        // Dasher et Splitter : dash vers le joueur
        this.time.delayedCall(300, () => {
          if (!this.boss || !this.boss.active) return;

          const toPlayerX = this.player.x - this.boss.x;
          const toPlayerY = this.player.y - this.boss.y;
          const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;

          // Effet visuel de rage (scale up)
          if (this.bossVisuals) {
            this.tweens.add({
              targets: this.bossVisuals,
              scaleX: 1.2, scaleY: 1.2,
              duration: 150,
              yoyo: true
            });
          }
          this.bossDashing = true;

          const dashSpeed = 350 + this.bossPhase * 50;
          this.boss.body.setVelocity(
            (toPlayerX / dist) * dashSpeed,
            (toPlayerY / dist) * dashSpeed * 0.7
          );

          this.time.delayedCall(400, () => {
            this.bossDashing = false;
            this.bossShotPaused = false;
          });
        });
      } else if (this.bossType === 2) {
        // SPINNER : Téléportation défensive après les dégâts
        this.time.delayedCall(200, () => {
          if (!this.boss || !this.boss.active) return;

          // Effet de disparition
          this.boss.setAlpha(0.3);
          this.emitParticles(this.boss.x, this.boss.y, {
            count: 15,
            colors: [this.bossColor, 0xffffff],
            minSpeed: 50,
            maxSpeed: 150,
            minSize: 3,
            maxSize: 8,
            life: 300,
            spread: Math.PI * 2,
            fadeOut: true
          });

          this.time.delayedCall(150, () => {
            if (!this.boss || !this.boss.active) return;

            // Nouvelle position (loin du joueur)
            let newX, newY;
            const minX = 150;
            const maxX = this.WORLD.width - 150;
            const minY = 100;
            const maxY = this.WORLD.groundY - 100;

            // Chercher une position éloignée du joueur
            let attempts = 0;
            do {
              newX = Phaser.Math.Between(minX, maxX);
              newY = Phaser.Math.Between(minY, maxY);
              attempts++;
            } while (Math.sqrt(Math.pow(newX - this.player.x, 2) + Math.pow(newY - this.player.y, 2)) < 200 && attempts < 20);

            this.boss.x = newX;
            this.boss.y = newY;
            this.boss.setAlpha(1);

            // Effet d'apparition
            this.emitParticles(this.boss.x, this.boss.y, {
              count: 15,
              colors: [this.bossColor, 0xffffff],
              minSpeed: 50,
              maxSpeed: 150,
              minSize: 3,
              maxSize: 8,
              life: 300,
              spread: Math.PI * 2,
              fadeOut: true
            });

            this.bossShotPaused = false;
          });
        });
      } else {
        // Autres boss : juste reset après le flash
        this.time.delayedCall(300, () => {
          this.bossShotPaused = false;
        });
      }

      // Changement de phase
      if (this.bossHealth <= this.bossMaxHealth * 0.5 && this.bossPhase === 1) {
        this.bossPhase = 2;
        this.boss.moveSpeed *= 1.3;
        // Effet visuel de phase 2 - particules de rage
        this.emitParticles(this.boss.x, this.boss.y, {
          count: 30,
          colors: [0xff0000, 0xff6600, 0xffff00],
          minSpeed: 100,
          maxSpeed: 250,
          minSize: 4,
          maxSize: 12,
          life: 500,
          spread: Math.PI * 2,
          fadeOut: true
        });
        // SFX de changement de phase
        this.playSound('bossPhase');
      }

      // Boss mort
      if (this.bossHealth <= 0) {
        this.defeatBoss();
      }
    } else if (!this.isInvincible && !this.bossHitCooldown) {
      // Dégâts dynamiques selon le boss et son état
      let damage = 6; // Contact normal = 1.5 coeurs

      // CHARGER en charge = 2 coeurs
      if (this.bossType === 1 && this.chargerState === 'charging') {
        damage = 8;
      }
      // CRUSHER slam = 2.5 coeurs
      else if (this.bossType === 6 && this.crusherSlamming) {
        damage = 10;
      }
      // BERSERKER enragé = 2 coeurs
      else if (this.bossType === 8 && this.berserkerRage > 0.5) {
        damage = 8;
      }

      this.takeDamage(damage);
    }
  }

  updateBossHealthBar() {
    const healthPercent = this.bossHealth / this.bossMaxHealth;
    const barWidth = 300;

    // Animation fluide de la barre
    this.tweens.add({
      targets: this.bossHealthBar,
      width: barWidth * healthPercent,
      duration: 200,
      ease: 'Quad.easeOut'
    });

    // Changement de couleur selon la vie
    if (healthPercent < 0.3) {
      this.bossHealthBar.setFillStyle(0xff0000);
      this.bossPhaseText.setText('II').setFill('#ff0000');
    } else if (healthPercent < 0.5) {
      this.bossHealthBar.setFillStyle(0xff6600);
      this.bossPhaseText.setText('II').setFill('#ff6600');
    }

    // Shake de la barre quand touché
    this.tweens.add({
      targets: this.bossUIContainer,
      x: 400 + Phaser.Math.Between(-5, 5),
      duration: 50,
      yoyo: true,
      repeat: 2,
      onComplete: () => { if (this.bossUIContainer) this.bossUIContainer.x = 400; }
    });
  }

  // === CRI DE DOULEUR DU BOSS ===
  bossHurtCry(boss) {
    if (!boss || !boss.active) return;

    // === SON DE CRI DE DOULEUR ===
    this.playSound('bossHurtCry');

    // Animation de "cri" - le boss se contracte et émet des particules de douleur
    // Utiliser boss directement car bossVisuals peut être un container sans setTint
    const visualTarget = boss;

    // Contraction rapide (comme une réaction à la douleur)
    this.tweens.add({
      targets: visualTarget,
      scaleX: 0.85, scaleY: 1.15,
      duration: 80,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (visualTarget && visualTarget.active) {
          this.tweens.add({
            targets: visualTarget,
            scaleX: 1.1, scaleY: 0.9,
            duration: 60,
            yoyo: true,
            ease: 'Quad.easeIn'
          });
        }
      }
    });

    // Particules de "cri" - ondes qui émanent du boss
    for (let wave = 0; wave < 3; wave++) {
      this.time.delayedCall(wave * 50, () => {
        if (!boss || !boss.active) return;

        // Particules en forme d'arc vers le haut (comme un cri)
        const numParticles = 8;
        for (let i = 0; i < numParticles; i++) {
          const angle = -Math.PI / 2 + (i - numParticles / 2) * 0.15;
          const speed = 60 + wave * 30;

          const particle = this.add.circle(
            boss.x,
            boss.y - 20,
            3 + wave,
            this.bossColor || 0xff0000
          );
          particle.setAlpha(0.8 - wave * 0.2);

          this.tweens.add({
            targets: particle,
            x: boss.x + Math.cos(angle) * speed,
            y: boss.y - 20 + Math.sin(angle) * speed,
            alpha: 0,
            scale: 0.3,
            duration: 300 + wave * 50,
            ease: 'Quad.easeOut',
            onComplete: () => { if (particle && particle.active) particle.destroy(); }
          });
        }
      });
    }

    // Léger flash de douleur sur le boss (seulement si setTint existe)
    if (visualTarget && typeof visualTarget.setTint === 'function') {
      visualTarget.setTint(0xffffff);
      this.time.delayedCall(100, () => {
        if (visualTarget && visualTarget.active && typeof visualTarget.clearTint === 'function') {
          visualTarget.clearTint();
        }
      });
    }

    // Tremblement de caméra subtil
    this.cameras.main.shake(100, 0.005);

    // Effet visuel (aberration chromatique légère)
    if (this.chromaRed) {
      this.bossHitVisualEffect();
    }
  }

  defeatBoss() {
    // Éviter les appels multiples
    if (this.bossDefeated) return;
    this.bossDefeated = true;

    // Sauvegarder la position du boss pour l'animation
    const bossX = this.boss.x;
    const bossY = this.boss.y;
    const bossColor = this.bossColor || 0xff00ff;

    // Arrêter la musique du boss INSTANTANÉMENT (sans fondu)
    this.stopMusicInstant();

    // Arrêter les particules ambiantes du boss
    if (this.bossParticleInterval) {
      clearInterval(this.bossParticleInterval);
      this.bossParticleInterval = null;
    }

    // Arrêter les timers du boss
    if (this.bossMoveTimer) this.bossMoveTimer.remove();
    if (this.bossShootTimer) this.bossShootTimer.remove();

    // === DARK SOULS DEATH ANIMATION ===
    // 1. Freeze le boss et ralentir le temps
    this.boss.body.setVelocity(0, 0);
    this.boss.body.setAllowGravity(false);

    // SFX du cri de mort (son dramatique)
    this.playSound('bossDeathCry');

    // 2. CRI DE MORT - Le boss émet un dernier cri déchirant
    this.bossDeathCry(bossX, bossY, bossColor);

    // Fanfare de victoire après un délai (quand l'animation est terminée)
    this.time.delayedCall(2500, () => {
      this.playSound('bossDefeat');
    });

    // Effets visuels dramatiques (vignette + aberration chromatique forte)
    if (this.chromaRed) {
      this.bossDeathVisualEffect();
    }

    // 3. Flash initial de douleur
    this.cameras.main.flash(200, 255, 255, 255);
    this.cameras.main.shake(500, 0.02);

    // 4. Animation de mort lente et dramatique
    const visualTargets = [this.boss, this.bossVisuals, this.bossEye, this.bossPupil].filter(t => t && t.active !== false);

    // Phase 1: Expansion de douleur (0-800ms)
    this.tweens.add({
      targets: visualTargets,
      scaleX: 1.5,
      scaleY: 0.7,
      duration: 400,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => {
        // Phase 2: Contraction d'agonie (800-1600ms)
        this.tweens.add({
          targets: visualTargets,
          scaleX: 0.6,
          scaleY: 1.4,
          duration: 400,
          ease: 'Quad.easeIn',
          yoyo: true
        });
      }
    });

    // 5. Particules d'essence qui s'échappent pendant l'agonie
    const essenceInterval = setInterval(() => {
      if (!this.boss || !this.boss.active) {
        clearInterval(essenceInterval);
        return;
      }

      // Lumière qui s'échappe du boss
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 30;

        // Couleur alternée entre la couleur du boss et blanc
        const essenceColor = Math.random() > 0.5 ? bossColor : 0xffffff;

        const essence = this.add.circle(
          this.boss.x + Math.cos(angle) * dist,
          this.boss.y + Math.sin(angle) * dist,
          2 + Math.random() * 4,
          essenceColor
        );

        this.tweens.add({
          targets: essence,
          x: essence.x + (Math.random() - 0.5) * 100,
          y: essence.y - 50 - Math.random() * 100,
          alpha: 0,
          scale: 0,
          duration: 800 + Math.random() * 400,
          ease: 'Quad.easeOut',
          onComplete: () => { if (essence && essence.active) essence.destroy(); }
        });
      }
    }, 100);

    // 6. Fade progressif du boss
    this.tweens.add({
      targets: visualTargets,
      alpha: 0.3,
      duration: 1500,
      ease: 'Sine.easeIn'
    });

    // 7. Après 2 secondes - Désintégration finale
    this.time.delayedCall(2000, () => {
      clearInterval(essenceInterval);

      // Animation de désintégration finale
      const finalX = this.boss ? this.boss.x : bossX;
      const finalY = this.boss ? this.boss.y : bossY;

      // Vagues de particules qui s'échappent
      for (let wave = 0; wave < 4; wave++) {
        this.time.delayedCall(wave * 150, () => {
          // Explosion de particules en cercle
          const numParticles = 20;
          for (let i = 0; i < numParticles; i++) {
            const angle = (i / numParticles) * Math.PI * 2;
            const speed = 100 + wave * 50;

            const particle = this.add.circle(finalX, finalY, 4 + wave * 2, bossColor);
            particle.setAlpha(0.9 - wave * 0.15);

            this.tweens.add({
              targets: particle,
              x: finalX + Math.cos(angle) * speed * 2,
              y: finalY + Math.sin(angle) * speed * 2,
              alpha: 0,
              scale: 0.2,
              duration: 600 + wave * 100,
              ease: 'Quad.easeOut',
              onComplete: () => { if (particle && particle.active) particle.destroy(); }
            });
          }

          // Trainées de lumière vers le haut (âme qui s'échappe)
          for (let i = 0; i < 8; i++) {
            const offsetX = (Math.random() - 0.5) * 60;
            const light = this.add.circle(finalX + offsetX, finalY, 3 + Math.random() * 5, 0xffffff);
            light.setAlpha(0.8);

            this.tweens.add({
              targets: light,
              y: finalY - 200 - Math.random() * 150,
              x: finalX + offsetX + (Math.random() - 0.5) * 50,
              alpha: 0,
              scale: 0.1,
              duration: 1200 + Math.random() * 600,
              ease: 'Sine.easeOut',
              onComplete: () => { if (light && light.active) light.destroy(); }
            });
          }
        });
      }

      // 8. Flash final et destruction du boss
      this.time.delayedCall(600, () => {
        // Flash blanc dramatique
        this.cameras.main.flash(400, 255, 255, 255);

        // Détruire tous les éléments du boss
        if (this.boss && this.boss.active) this.boss.destroy();
        if (this.bossVisuals) { this.bossVisuals.destroy(); this.bossVisuals = null; }
        if (this.bossEye) { this.bossEye.destroy(); this.bossEye = null; }
        if (this.bossPupil) { this.bossPupil.destroy(); this.bossPupil = null; }
        if (this.bossEyeGlint) { this.bossEyeGlint.destroy(); this.bossEyeGlint = null; }
        if (this.bossEyelidTop) { this.bossEyelidTop.destroy(); this.bossEyelidTop = null; }
        if (this.bossEyelidBottom) { this.bossEyelidBottom.destroy(); this.bossEyelidBottom = null; }
        if (this.bossBlinkTimer) { this.bossBlinkTimer.remove(); this.bossBlinkTimer = null; }

        // Nettoyage spécifique à chaque boss
        if (this.bossType === 3 && this.splitterMinions) {
          this.splitterMinions.forEach(m => {
            if (m.shootTimer) m.shootTimer.remove();
            if (m.active) m.destroy();
          });
          this.splitterMinions = [];
        }
        if (this.bossType === 4 && this.guardianShieldSprite) {
          this.guardianShieldSprite.destroy();
        }
        if (this.bossType === 5 && this.summonedEnemies) {
          this.summonedEnemies.forEach(e => { if (e.active) e.destroy(); });
          this.summonedEnemies = [];
        }

        // Animation de sortie de l'UI boss
        if (this.bossUIContainer) {
          this.tweens.add({
            targets: this.bossUIContainer,
            alpha: 0,
            y: 60,
            duration: 500,
            onComplete: () => {
              if (this.bossUIContainer) this.bossUIContainer.destroy();
            }
          });
        }

        // === AFTERMATH - Clé et récompenses ===
        this.time.delayedCall(500, () => {
          // CHECKPOINT : Sauvegarder la progression
          const checkpointData = {
            level: this.currentLevel + 1,
            score: this.score + 500,
            totalTime: this.totalTime + this.levelTime,
            maxHealth: this.maxHealth
          };
          localStorage.setItem('platformer-checkpoint', JSON.stringify(checkpointData));
          this.checkpoint = checkpointData;

          // Restaurer la vie
          this.playerHealth = this.maxHealth * 4;
          this.updateHealthDisplay();

          this.score += 500;
          this.scoreText.setText(this.score.toString().padStart(6, '0'));

          // Faire apparaître la clé avec un effet dramatique
          this.spawnKeyAfterBoss(finalX, finalY);
        });
      });
    });
  }

  // === CRI DE MORT DU BOSS (Dark Souls style) ===
  bossDeathCry(x, y, color) {
    // Ondes de choc concentriques (utiliser scale au lieu de radius)
    for (let ring = 0; ring < 5; ring++) {
      this.time.delayedCall(ring * 120, () => {
        const shockwave = this.add.circle(x, y, 20, color, 0);
        shockwave.setStrokeStyle(4 - ring * 0.5, color);
        shockwave.setAlpha(1 - ring * 0.15);

        this.tweens.add({
          targets: shockwave,
          scaleX: 8 + ring * 2,
          scaleY: 8 + ring * 2,
          alpha: 0,
          duration: 600 + ring * 100,
          ease: 'Quad.easeOut',
          onComplete: () => { if (shockwave && shockwave.active) shockwave.destroy(); }
        });
      });
    }

    // Particules qui montent comme un cri visuel
    for (let i = 0; i < 30; i++) {
      const delay = Math.random() * 300;
      this.time.delayedCall(delay, () => {
        const offsetX = (Math.random() - 0.5) * 80;
        const particleColor = Math.random() > 0.5 ? color : 0xffffff;
        const particle = this.add.circle(
          x + offsetX,
          y,
          2 + Math.random() * 4,
          particleColor
        );

        this.tweens.add({
          targets: particle,
          y: y - 100 - Math.random() * 150,
          x: x + offsetX + (Math.random() - 0.5) * 40,
          alpha: 0,
          scale: 0.3,
          duration: 800 + Math.random() * 600,
          ease: 'Quad.easeOut',
          onComplete: () => { if (particle && particle.active) particle.destroy(); }
        });
      });
    }
  }

  // === SPAWN DE LA CLÉ APRÈS BOSS (avec effet) ===
  spawnKeyAfterBoss(x, y) {
    // Particules de lumière avant l'apparition de la clé
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const dist = 80;
      const light = this.add.circle(
        x + Math.cos(angle) * dist,
        y + Math.sin(angle) * dist,
        4,
        0xffdd44
      );
      light.setAlpha(0.8);

      this.tweens.add({
        targets: light,
        x: x,
        y: y - 50,
        alpha: 0,
        scale: 0,
        duration: 600,
        ease: 'Quad.easeIn',
        onComplete: () => { if (light && light.active) light.destroy(); }
      });
    }

    this.time.delayedCall(500, () => {
      // Flash de lumière doré
      this.cameras.main.flash(200, 255, 220, 100);

      // Création de la clé avec animation d'apparition
      this.key = this.createKeySprite(x, y - 50, true);
      this.key.setAlpha(0);
      this.key.setScale(0);
      this.physics.add.existing(this.key);
      this.key.body.setSize(16, 28);
      this.key.body.setAllowGravity(false);

      // Animation d'apparition
      this.tweens.add({
        targets: this.key,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 400,
        ease: 'Back.easeOut',
        onComplete: () => {
          // La clé est matérialisée - démarrer l'ambiance calme
          this.startPostBossAmbient();

          // Puis gravité et chute
          this.key.body.setAllowGravity(true);
          this.key.body.setGravityY(200);

          // Collision avec le sol
          this.keyLanded = false;
          this.physics.add.collider(this.key, this.platforms, () => {
            if (!this.keyLanded && this.key) {
              this.keyLanded = true;
              this.key.body.setAllowGravity(false);
              this.key.body.setVelocity(0, 0);
              const landY = this.key.y;

              this.tweens.add({
                targets: this.key,
                y: landY - 8,
                duration: 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
              });
              this.tweens.add({
                targets: this.key,
                angle: { from: -5, to: 5 },
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
              });
            }
          });
          this.physics.add.overlap(this.player, this.key, this.collectKey, null, this);
        }
      });
    });
  }

  fallDeath() {
    if (this.isInvincible || this.fallingDeath) return;
    this.fallingDeath = true; // Éviter les appels multiples

    this.takeDamage();

    // Respawn au point de départ, légèrement en l'air pour éviter les glitchs
    this.player.x = 60;
    this.player.y = this.WORLD.groundY - 60;
    this.player.body.reset(this.player.x, this.player.y);
    this.player.body.setVelocity(0, 0);

    // Reset le flag après un court délai
    this.time.delayedCall(100, () => {
      this.fallingDeath = false;
    });
  }

  collectKey() {
    if (this.hasKey) return;

    // SFX + Particules
    this.playSound('key');
    this.particleKey(this.key.x, this.key.y);

    this.hasKey = true;
    this.key.destroy();
    // Clé collectée - passer en doré
    this.keyIcon.setFillStyle(0xffd700);
    this.keyIconStem.setFillStyle(0xffd700);
    this.keyIconBg.setStrokeStyle(2, 0xffd700);
    // Ouvrir la porte (changer la couleur)
    this.doorLocked = false;
    this.door.setFillStyle(0x00ff88); // Vert quand ouverte
    this.door.setStrokeStyle(3, 0x00cc66);
    this.door.setAlpha(1); // S'assurer que la porte est visible
    // Particules d'ouverture
    this.particleDoorUnlock(this.door.x, this.door.y);
  }

  enterDoor() {
    if (!this.hasKey || this.doorLocked || this.isTransitioning) return;
    this.isTransitioning = true;

    // SFX
    this.playSound('door');

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

    // Gestion de la musique lors de la transition
    const nextLevel = this.currentLevel + 1;
    const nextIsBoss = nextLevel % 5 === 0;
    const currentIsBoss = this.currentLevel % 5 === 0;

    if (currentIsBoss && this.isInPostBossAmbient) {
      // Quitter l'arène du boss - transition de l'ambiance vers musique normale
      this.transitionToLevelMusic();
    } else if (nextIsBoss) {
      // Prochain niveau est un boss - arrêter la musique (silence pour l'intro)
      this.stopMusic();
    }

    // Animation de transition puis niveau suivant
    this.playLevelOutro({
      level: nextLevel,
      score: this.score,
      totalTime: this.totalTime + this.levelTime,
      maxHealth: this.maxHealth,
      currentHealth: this.playerHealth
    });
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
      // SFX + Particules de mort ennemi
      this.playSound('enemyKill');
      this.particleEnemyDeath(enemy.x, enemy.y, enemy.deathColor || enemy.fillColor || 0xff4444);
      enemy.destroy();
      this.score +=50;
      this.scoreText.setText(this.score.toString().padStart(6, '0'));
      player.body.setVelocityY(-300);
    } else {
      // Dégâts variables selon le type d'ennemi (défaut: 3 = 3/4 coeur)
      const damage = enemy.contactDamage || 3;
      this.takeDamage(damage);
    }
  }

  hitBullet(player, bullet) {
    if (this.isInvincible) return;

    // Récupérer les dégâts du projectile (défaut: 2 = 1/2 coeur)
    const damage = bullet.damage || 2;

    // Les projectiles perçants ne sont pas détruits
    if (!bullet.piercing) {
      bullet.destroy();
    }

    this.takeDamage(damage);
  }

  takeDamage(amount = 4) {
    // amount: 4 = 1 coeur, 2 = demi-coeur, 6 = 1.5 coeurs, 8 = 2 coeurs
    if (this.isInvincible) return;

    this.playerHealth -= amount;
    this.updateHealthDisplay();

    if (this.playerHealth <= 0) {
      // SFX + Particules de mort
      this.playSound('death');
      this.particleDeath(this.player.x, this.player.y);
      this.stopMusic();

      // Redémarrer au checkpoint si disponible, sinon niveau 1
      if (this.checkpoint) {
        this.scene.restart({
          level: this.checkpoint.level,
          score: this.checkpoint.score,
          totalTime: this.checkpoint.totalTime,
          maxHealth: this.checkpoint.maxHealth,
          currentHealth: this.checkpoint.maxHealth * 4 // Full vie au checkpoint
        });
      } else {
        this.scene.restart({ level: 1, score: 0, totalTime: 0, maxHealth: 3, currentHealth: 12 });
      }
      return;
    }

    // SFX + Particules de dégâts
    this.playSound('hurt');
    this.particleHurt(this.player.x, this.player.y);

    // Effets visuels (vignette rouge + aberration chromatique)
    if (this.vignetteGraphics) {
      this.damageVisualEffect();
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
    // SFX + Particules
    this.playSound('coin');
    this.particleCoin(coin.x, coin.y);
    coin.destroy();
    this.score +=10;
    this.scoreText.setText(this.score.toString().padStart(6, '0'));

    // Récupérer 1/4 d'un coeur (1 HP)
    this.playerHealth = Math.min(this.playerHealth + 1, this.maxHealth * 4);
    this.updateHealthDisplay();
  }

  collectHeart() {
    if (!this.heartPickup || !this.heartPickup.active) return;

    // SFX + Particules
    this.playSound('heart');
    this.particleHeart(this.heartPickup.x, this.heartPickup.y);

    this.heartPickup.destroy();

    // Augmente la vie max ET soigne complètement
    this.maxHealth++;
    this.playerHealth = this.maxHealth * 4;
    this.updateHealthDisplay();

    // Effet visuel
    const bonusText = this.add.text(this.player.x, this.player.y - 40, '+1 MAX!', {
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
    this.scoreText.setText(this.score.toString().padStart(6, '0'));
  }

  update(time, delta) {
    // Reset rapide (R) - efface le checkpoint et recommence à zéro
    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.stopMusic();
      localStorage.removeItem('platformer-checkpoint'); // Effacer le checkpoint
      this.scene.restart({ level: 1, score: 0, totalTime: 0, maxHealth: 3, currentHealth: 12 });
      return;
    }

    // Mise à jour des chronos
    this.levelTime += delta;
    this.timerText.setText(this.formatTime(this.levelTime));
    this.totalTimeText.setText('RUN ' + this.formatTime(this.totalTime + this.levelTime));

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

    // Mise à jour des effets visuels (vignette santé basse)
    if (this.vignetteGraphics) {
      this.updateVisualEffects(delta);
    }

    // Vérification fiable de chute dans un trou (backup si overlap rate)
    if (this.player.y > this.WORLD.height + 20) {
      this.fallDeath();
    }

    const body = this.player.body;
    const cfg = this.config;

    const onGround = body.blocked.down || body.touching.down;
    const onWallLeft = body.blocked.left;
    const onWallRight = body.blocked.right;
    const onWall = (onWallLeft || onWallRight) && !onGround;

    // === ATTERRISSAGE (SFX, particules, squash, shake) ===
    if (!this.wasOnGround && onGround && body.velocity.y >= 0) {
      this.playSound('land');
      this.particleLand(this.player.x, this.player.y);
      // Squash à l'atterrissage (proportionnel à la vitesse de chute)
      const impactStrength = Math.min(Math.abs(this.lastVelocityY) / 800, 0.4);
      this.playerScaleX = 1 + impactStrength * 0.5;
      this.playerScaleY = 1 - impactStrength;
      // Screen shake si atterrissage fort
      if (Math.abs(this.lastVelocityY) > 400) {
        this.screenShake(impactStrength * 0.015, 80);
      }
    }
    this.wasOnGround = onGround;
    this.lastVelocityY = body.velocity.y;

    // === RESETS AU SOL/MUR ===
    if (onGround) {
      this.canDoubleJump = true;
      this.hasDoubleJumped = false;
      this.hasDashedInAir = false;
      this.canDash = true;
      this.isJumping = false;
    }
    if (onWall) {
      this.canDoubleJump = true;
      this.hasDoubleJumped = false;
      this.hasDashedInAir = false;
      this.canDash = true;
    }

    // === COYOTE TIME ===
    if (onGround) {
      this.coyoteTimer = cfg.coyoteTime;
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

    // === INPUT (Keyboard + Touch) ===
    const touch = this.touchInput || {};
    const left = this.canMove && (this.cursors.left.isDown || this.keys.q.isDown || touch.left);
    const right = this.canMove && (this.cursors.right.isDown || this.keys.d.isDown || touch.right);
    const down = this.canMove && (this.cursors.down.isDown || this.keys.s.isDown || touch.down);
    const up = this.canMove && (this.cursors.up.isDown || this.keys.z.isDown || touch.up);
    const jumpJustPressed = this.canMove && (Phaser.Input.Keyboard.JustDown(this.keys.z) ||
                            Phaser.Input.Keyboard.JustDown(this.keys.space) ||
                            Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
                            touch.jumpJustPressed);
    const jumpHeld = this.canMove && (this.keys.z.isDown || this.keys.space.isDown || this.cursors.up.isDown || touch.jump);
    const dashPressed = this.canMove && (Phaser.Input.Keyboard.JustDown(this.keys.shift) ||
                        Phaser.Input.Keyboard.JustDown(this.keys.x) ||
                        Phaser.Input.Keyboard.JustDown(this.keys.c) ||
                        touch.dashJustPressed);

    // === JUMP BUFFER ===
    if (jumpJustPressed) {
      this.jumpBufferTimer = cfg.jumpBufferTime;
    } else if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta;
    }

    // === DASH (style Celeste) ===
    if (this.isDashing) {
      this.dashTimer -= delta;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
        // Garder un peu de momentum après le dash
        body.setVelocity(this.dashDir.x * cfg.dashSpeed * 0.3, this.dashDir.y * cfg.dashSpeed * 0.3);
      } else {
        // Pendant le dash: vélocité fixe, pas de gravité
        body.setVelocity(this.dashDir.x * cfg.dashSpeed, this.dashDir.y * cfg.dashSpeed);
        body.setAllowGravity(false);
        // Particules de dash
        if (Math.random() < 0.5) {
          this.emitParticles(this.player.x, this.player.y, {
            count: 1, colors: [0x00ffff, 0xffffff],
            minSpeed: 20, maxSpeed: 50, minSize: 3, maxSize: 6,
            life: 150, fadeOut: true, shrink: true
          });
        }
      }
    } else {
      body.setAllowGravity(true);

      // Démarrer un dash
      if (dashPressed && this.canDash && (!this.hasDashedInAir || onGround)) {
        this.isDashing = true;
        this.dashTimer = cfg.dashDuration;
        if (!onGround) this.hasDashedInAir = true;

        // Direction du dash (8 directions)
        let dx = 0, dy = 0;
        if (left) dx = -1;
        else if (right) dx = 1;
        if (up) dy = -1;
        else if (down) dy = 1;
        // Si aucune direction, dash horizontal dans la direction du regard
        if (dx === 0 && dy === 0) dx = this.player.flipX ? -1 : 1;
        // Normaliser pour les diagonales
        const len = Math.sqrt(dx * dx + dy * dy);
        this.dashDir = { x: dx / len, y: dy / len };

        // SFX + effet visuel + shake
        this.playSound('dash');
        this.screenShake(0.008, 60);
        this.emitParticles(this.player.x, this.player.y, {
          count: 12, colors: [0x00ffff, 0x88ffff, 0xffffff],
          minSpeed: 80, maxSpeed: 180, minSize: 4, maxSize: 10,
          life: 250, spread: Math.PI * 2, fadeOut: true, shrink: true
        });

        // Stretch dans la direction du dash
        this.playerScaleX = 1.4;
        this.playerScaleY = 0.65;
      }
    }

    // === WALL SLIDE & WALL CLIMB ===
    if (onWall && !this.isDashing) {
      if (up) {
        // Wall climb
        body.setVelocityY(-cfg.wallClimbSpeed);
        this.isClimbing = true;
      } else if (body.velocity.y > 0) {
        // Wall slide
        body.setVelocityY(Math.min(body.velocity.y, cfg.wallSlideSpeed));
        this.isClimbing = false;
      }
    } else {
      this.isClimbing = false;
    }

    // === MOUVEMENT HORIZONTAL ===
    if (!this.isDashing) {
      const currentVelX = body.velocity.x;
      const inAir = !onGround;
      const accel = inAir ? cfg.airAccel : cfg.playerAccel;
      const decel = inAir ? cfg.airDecel : cfg.playerDecel;

      if (this.wallJumpLockTimer > 0) {
        this.wallJumpLockTimer -= delta;
      } else {
        if (left) {
          body.setVelocityX(Math.max(currentVelX - accel * delta / 1000, -cfg.playerSpeed));
        } else if (right) {
          body.setVelocityX(Math.min(currentVelX + accel * delta / 1000, cfg.playerSpeed));
        } else {
          // Friction
          if (currentVelX > 0) {
            body.setVelocityX(Math.max(0, currentVelX - decel * delta / 1000));
          } else if (currentVelX < 0) {
            body.setVelocityX(Math.min(0, currentVelX + decel * delta / 1000));
          }
        }
      }
    }

    // === SAUTS ===
    const canJump = this.coyoteTimer > 0;

    // Saut normal
    if (this.jumpBufferTimer > 0 && canJump && !this.isDashing) {
      body.setVelocityY(-cfg.jumpForce);
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.isJumping = true;
      this.playSound('jump');
      this.particleJump(this.player.x, this.player.y);
      // Stretch au saut
      this.playerScaleX = 0.7;
      this.playerScaleY = 1.3;
    }
    // Wall jump
    else if (this.jumpBufferTimer > 0 && this.wallCoyoteTimer > 0 && this.lastWallDir !== 0 && !this.isDashing) {
      body.setVelocityY(-cfg.wallJumpForceY);
      body.setVelocityX(-this.lastWallDir * cfg.wallJumpForceX);
      this.wallCoyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.wallJumpLockTimer = 150;
      this.canDoubleJump = true;
      this.hasDoubleJumped = false;
      this.isJumping = true;
      this.playSound('wallJump');
      this.particleWallJump(this.player.x, this.player.y, -this.lastWallDir);
      this.playerScaleX = 0.7;
      this.playerScaleY = 1.3;
    }
    // Double jump
    else if (this.jumpBufferTimer > 0 && this.canDoubleJump && !this.hasDoubleJumped && !onGround && this.coyoteTimer <= 0 && !this.isDashing) {
      body.setVelocityY(-cfg.doubleJumpForce);
      this.jumpBufferTimer = 0;
      this.hasDoubleJumped = true;
      this.canDoubleJump = false;
      this.isJumping = true;
      this.playSound('doubleJump');
      this.particleDoubleJump(this.player.x, this.player.y);
      this.playerScaleX = 0.7;
      this.playerScaleY = 1.3;
    }

    // === VARIABLE JUMP HEIGHT ===
    if (this.isJumping && !jumpHeld && body.velocity.y < 0) {
      // Relâcher le bouton = réduire la vélocité
      body.setVelocityY(body.velocity.y * cfg.variableJumpMultiplier);
      this.isJumping = false;
    }

    // === FAST FALL ===
    if (down && !onGround && body.velocity.y > 0 && !this.isDashing) {
      body.setVelocityY(Math.min(body.velocity.y + cfg.fastFallGravity * delta / 1000, cfg.fastFallSpeed));
    }

    // === GRAVITÉ DYNAMIQUE ===
    if (!this.isDashing) {
      const velY = body.velocity.y;
      if (down && velY > 0) {
        // Fast fall gravity
        body.setGravityY(cfg.fastFallGravity);
      } else if (Math.abs(velY) < cfg.apexThreshold && !onGround) {
        // Apex du saut - gravité réduite (feeling floaty)
        body.setGravityY(cfg.gravity * cfg.apexGravityMultiplier);
      } else if (velY > 0 && !onWall) {
        // Descente - gravité augmentée
        body.setGravityY(cfg.gravity * 1.6);
      } else {
        body.setGravityY(cfg.gravity);
      }
    }

    // === SQUASH & STRETCH ANIMATION ===
    // Retour progressif à la normale
    this.playerScaleX = Phaser.Math.Linear(this.playerScaleX, 1, 0.15);
    this.playerScaleY = Phaser.Math.Linear(this.playerScaleY, 1, 0.15);
    this.player.setScale(this.playerScaleX, this.playerScaleY);

    // === SPEED TRAIL ===
    const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
    if (speed > 300 || this.isDashing) {
      this.speedTrail.push({
        x: this.player.x,
        y: this.player.y,
        alpha: 0.6,
        scale: this.playerScaleX
      });
      if (this.speedTrail.length > 5) this.speedTrail.shift();
    } else if (this.speedTrail.length > 0) {
      this.speedTrail.shift();
    }

    // Dessiner le trail (réutiliser ou créer des sprites)
    this.speedTrail.forEach((t, i) => {
      t.alpha -= 0.1;
      if (!this.trailSprites) this.trailSprites = [];
      if (!this.trailSprites[i]) {
        this.trailSprites[i] = this.add.rectangle(t.x, t.y, 16, 28, 0x00ff88, t.alpha);
        this.trailSprites[i].setDepth(45);
      }
      this.trailSprites[i].setPosition(t.x, t.y);
      this.trailSprites[i].setAlpha(Math.max(0, t.alpha));
      this.trailSprites[i].setScale(t.scale, this.playerScaleY);
    });
    // Cacher les sprites inutilisés
    if (this.trailSprites) {
      for (let i = this.speedTrail.length; i < this.trailSprites.length; i++) {
        this.trailSprites[i].setAlpha(0);
      }
    }

    // === CORNER CORRECTION ===
    // Si on frappe un plafond par le côté, on se décale
    if (body.blocked.up && body.velocity.y < 0) {
      const correction = cfg.cornerCorrectionPixels;
      // Tester si on peut passer en se décalant
      if (!body.blocked.left) {
        this.player.x -= correction;
      } else if (!body.blocked.right) {
        this.player.x += correction;
      }
    }

    // Nettoyer les bullets hors écran (plus efficace que les timers)
    this.bullets.getChildren().forEach(bullet => {
      if (!bullet.active) return;
      if (bullet.x < -50 || bullet.x > this.WORLD.width + 50 || bullet.y < -50 || bullet.y > this.WORLD.groundY + 100) {
        bullet.destroy();
      }
    });

    // Update ennemis avec IA style Dark Souls
    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.active) return;

      // Initialiser l'état IA si nécessaire
      if (!enemy.aiState) {
        enemy.aiState = 'patrol';
        enemy.aiTimer = 0;
        enemy.patrolDir = enemy.patrolDir || 1;
        enemy.actionCooldown = 0;
        enemy.currentAction = null;
      }

      const baseSpeed = 60 + this.currentLevel * 5;
      const speed = baseSpeed * (enemy.speedMultiplier || 1);
      const acceleration = 6;

      // Distance et direction vers le joueur
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy);
      const dirToPlayer = dx > 0 ? 1 : -1;

      // Ranges selon le type d'ennemi
      const detectionRange = 180 + this.currentLevel * 8;
      const attackRange = enemy.enemyType === 'fast' ? 40 : 60;
      const comfortZone = enemy.enemyType === 'wide' ? 120 : (enemy.enemyType === 'spike' ? 80 : 100);

      // Détection du joueur (même niveau vertical)
      const canSeePlayer = distToPlayer < detectionRange && Math.abs(dy) < 80 && !this.isInvincible;

      // === DÉTECTION DES OBSTACLES (trous et bords) ===
      let blockedLeft = enemy.x <= enemy.patrolMin;
      let blockedRight = enemy.x >= enemy.patrolMax;

      // Vérifier les trous pour les ennemis au sol
      if (enemy.isGroundEnemy && this.groundHoles.length > 0) {
        const holeMargin = 35;
        for (const hole of this.groundHoles) {
          if (enemy.x > hole.left - holeMargin && enemy.x < hole.left + 10) {
            blockedRight = true;
          }
          if (enemy.x < hole.right + holeMargin && enemy.x > hole.right - 10) {
            blockedLeft = true;
          }
        }
      }

      // Sauvegarder les directions bloquées
      enemy.blockedLeft = blockedLeft;
      enemy.blockedRight = blockedRight;

      // Mise à jour du cooldown
      if (enemy.actionCooldown > 0) enemy.actionCooldown -= delta;
      if (enemy.dodgeCooldown > 0) enemy.dodgeCooldown -= delta;
      enemy.aiTimer += delta;

      // Couleur par défaut
      if (!enemy.originalColor) enemy.originalColor = enemy.fillColor;

      // === SYSTÈME D'ESQUIVE ===
      // Détecter si le joueur dash vers l'ennemi
      const playerDashingTowardsMe = this.isDashing &&
        distToPlayer < 150 &&
        ((this.player.body.velocity.x > 0 && dx < 0) || (this.player.body.velocity.x < 0 && dx > 0));

      // Détecter les bullets qui arrivent
      let bulletIncoming = false;
      this.bullets.getChildren().forEach(bullet => {
        if (!bullet.active) return;
        const bDx = enemy.x - bullet.x;
        const bDy = enemy.y - bullet.y;
        const bDist = Math.sqrt(bDx * bDx + bDy * bDy);
        // Bullet proche et qui se dirige vers l'ennemi
        if (bDist < 100 && bDist > 20) {
          const bulletDir = Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
          const toEnemyDir = Math.atan2(bDy, bDx);
          const angleDiff = Math.abs(bulletDir - toEnemyDir);
          if (angleDiff < 0.5 || angleDiff > Math.PI * 2 - 0.5) {
            bulletIncoming = true;
          }
        }
      });

      // Chance d'esquive (selon le type et le niveau)
      const dodgeChance = enemy.enemyType === 'fast' ? 0.7 :
                          enemy.enemyType === 'spike' ? 0.5 :
                          enemy.enemyType === 'tall' ? 0.3 : 0.4;

      // Déclencher l'esquive
      if ((playerDashingTowardsMe || bulletIncoming) &&
          enemy.aiState !== 'dodge' &&
          (!enemy.dodgeCooldown || enemy.dodgeCooldown <= 0) &&
          Math.random() < dodgeChance) {

        enemy.aiState = 'dodge';
        enemy.aiTimer = 0;
        enemy.dodgeCooldown = 1500 + Math.random() * 500; // Cooldown entre esquives

        // Direction de l'esquive (opposée à la menace)
        if (playerDashingTowardsMe) {
          enemy.dodgeDir = this.player.body.velocity.x > 0 ? -1 : 1;
        } else {
          // Esquiver perpendiculairement aux bullets
          enemy.dodgeDir = Math.random() > 0.5 ? 1 : -1;
        }

        // Vérifier si on peut esquiver dans cette direction
        if ((enemy.dodgeDir < 0 && blockedLeft) || (enemy.dodgeDir > 0 && blockedRight)) {
          enemy.dodgeDir = -enemy.dodgeDir;
        }

        // Effet visuel d'anticipation
        enemy.setFillStyle(0x00ffff); // Cyan = esquive
      }

      // === MACHINE À ÉTATS DARK SOULS ===
      switch (enemy.aiState) {

        case 'patrol':
          // Patrouille tranquille
          enemy.setFillStyle(enemy.originalColor);

          // Mouvement de patrouille
          if (blockedRight && enemy.patrolDir > 0) {
            enemy.patrolDir = -1;
            enemy.body.setVelocityX(0); // Pause avant demi-tour
            enemy.aiTimer = 0;
          } else if (blockedLeft && enemy.patrolDir < 0) {
            enemy.patrolDir = 1;
            enemy.body.setVelocityX(0);
            enemy.aiTimer = 0;
          } else if (enemy.aiTimer > 200) {
            // Mouvement fluide
            const targetVel = enemy.patrolDir * speed * 0.6;
            const currentVel = enemy.body.velocity.x;
            enemy.body.setVelocityX(currentVel + (targetVel - currentVel) * 0.1);
          }

          // Transition vers alerte si joueur détecté
          if (canSeePlayer) {
            enemy.aiState = 'alert';
            enemy.aiTimer = 0;
            enemy.setFillStyle(0xffaa00); // Orange = alerte
          }
          break;

        case 'alert':
          // Alerte ! L'ennemi a vu le joueur, s'arrête brièvement
          enemy.setFillStyle(0xffaa00);
          enemy.body.setVelocityX(enemy.body.velocity.x * 0.8); // Ralentit

          // Après un court délai, décide quoi faire
          if (enemy.aiTimer > 400) {
            if (!canSeePlayer) {
              enemy.aiState = 'patrol';
            } else if (distToPlayer < attackRange) {
              enemy.aiState = 'attack';
            } else if (distToPlayer < comfortZone) {
              // Trop proche - comportement selon le type
              if (enemy.enemyType === 'wide' || enemy.enemyType === 'basic') {
                enemy.aiState = 'circle'; // Tourner autour
              } else {
                enemy.aiState = 'approach';
              }
            } else {
              enemy.aiState = 'approach';
            }
            enemy.aiTimer = 0;
          }
          break;

        case 'approach':
          // S'approcher prudemment du joueur
          enemy.setFillStyle(0xff6600);

          // Vérifier si bloqué dans la direction du joueur
          const approachBlocked = (dirToPlayer > 0 && blockedRight) || (dirToPlayer < 0 && blockedLeft);

          if (approachBlocked) {
            // Bloqué - attendre ou reculer
            enemy.body.setVelocityX(0);
            if (enemy.aiTimer > 800) {
              enemy.aiState = 'circle';
              enemy.aiTimer = 0;
            }
          } else {
            // Approche graduelle avec pauses
            const approachSpeed = speed * 0.8;
            if (enemy.aiTimer % 1500 < 1000) {
              // Avancer
              const targetVel = dirToPlayer * approachSpeed;
              const currentVel = enemy.body.velocity.x;
              enemy.body.setVelocityX(currentVel + (targetVel - currentVel) * 0.08);
            } else {
              // Pause - évaluer
              enemy.body.setVelocityX(enemy.body.velocity.x * 0.9);
            }
          }

          // Transitions
          if (!canSeePlayer) {
            enemy.aiState = 'patrol';
            enemy.aiTimer = 0;
          } else if (distToPlayer < attackRange && enemy.actionCooldown <= 0) {
            enemy.aiState = 'attack';
            enemy.aiTimer = 0;
          } else if (distToPlayer < comfortZone * 0.6) {
            // Trop proche, reculer
            enemy.aiState = 'retreat';
            enemy.aiTimer = 0;
          }
          break;

        case 'circle':
          // Tourner autour du joueur (maintenir la distance)
          enemy.setFillStyle(0xff8844);

          const circleDir = enemy.circleDir || (Math.random() > 0.5 ? 1 : -1);
          enemy.circleDir = circleDir;

          // Vérifier si on peut bouger dans cette direction
          const circleBlocked = (circleDir > 0 && blockedRight) || (circleDir < 0 && blockedLeft);

          if (circleBlocked) {
            enemy.circleDir = -circleDir; // Inverser
            enemy.body.setVelocityX(0);
          } else {
            enemy.body.setVelocityX(circleDir * speed * 0.5);
          }

          // Après un moment, réagir
          if (enemy.aiTimer > 1200) {
            if (distToPlayer > comfortZone * 1.3) {
              enemy.aiState = 'approach';
            } else if (distToPlayer < attackRange && enemy.actionCooldown <= 0) {
              enemy.aiState = 'attack';
            }
            enemy.aiTimer = 0;
          }

          if (!canSeePlayer) {
            enemy.aiState = 'patrol';
            enemy.aiTimer = 0;
          }
          break;

        case 'attack':
          // Attaque ! Dash vers le joueur
          enemy.setFillStyle(0xff0000);

          if (enemy.aiTimer < 150) {
            // Wind-up - reculer légèrement
            const retreatDir = -dirToPlayer;
            const retreatBlocked = (retreatDir > 0 && blockedRight) || (retreatDir < 0 && blockedLeft);
            if (!retreatBlocked) {
              enemy.body.setVelocityX(retreatDir * speed * 0.3);
            }
          } else if (enemy.aiTimer < 450) {
            // Dash !
            const dashBlocked = (dirToPlayer > 0 && blockedRight) || (dirToPlayer < 0 && blockedLeft);
            if (!dashBlocked) {
              const dashSpeed = speed * (enemy.enemyType === 'fast' ? 2.5 : 1.8);
              enemy.body.setVelocityX(dirToPlayer * dashSpeed);
            } else {
              enemy.body.setVelocityX(0);
            }
          } else {
            // Recovery - reculer après l'attaque
            enemy.aiState = 'retreat';
            enemy.aiTimer = 0;
            enemy.actionCooldown = enemy.enemyType === 'fast' ? 800 : 1200;
          }
          break;

        case 'retreat':
          // Reculer après une attaque ou si trop proche
          enemy.setFillStyle(0xcc4444);

          const retreatDir = -dirToPlayer;
          const canRetreat = !((retreatDir > 0 && blockedRight) || (retreatDir < 0 && blockedLeft));

          if (canRetreat && distToPlayer < comfortZone) {
            const retreatSpeed = speed * 0.7;
            enemy.body.setVelocityX(retreatDir * retreatSpeed);
          } else {
            enemy.body.setVelocityX(enemy.body.velocity.x * 0.85);
          }

          // Après le recul, retourner à l'approche ou tourner
          if (enemy.aiTimer > 600 || distToPlayer > comfortZone) {
            if (canSeePlayer) {
              enemy.aiState = distToPlayer > comfortZone ? 'approach' : 'circle';
            } else {
              enemy.aiState = 'patrol';
            }
            enemy.aiTimer = 0;
          }
          break;

        case 'dodge':
          // Esquive rapide - roulade/dash latéral
          enemy.setFillStyle(0x00ffff); // Cyan = esquive

          const dodgeSpeed = speed * 2.5;
          const canDodge = !((enemy.dodgeDir < 0 && blockedLeft) || (enemy.dodgeDir > 0 && blockedRight));

          if (enemy.aiTimer < 50) {
            // Phase 1: Anticipation (squash)
            if (enemy.scaleY === undefined) enemy.scaleY = 1;
            enemy.setScale(1.2, 0.8);
          } else if (enemy.aiTimer < 250) {
            // Phase 2: Esquive rapide
            enemy.setScale(0.8, 1.2); // Stretch pendant le mouvement
            if (canDodge) {
              enemy.body.setVelocityX(enemy.dodgeDir * dodgeSpeed);
              // Petit saut pour les types rapides
              if (enemy.enemyType === 'fast' && enemy.body.blocked.down && enemy.aiTimer < 100) {
                enemy.body.setVelocityY(-200);
              }
            }
            // Particules de poussière
            if (enemy.aiTimer < 100 && Math.random() < 0.5) {
              this.emitParticles(enemy.x, enemy.y + 10, {
                count: 3,
                colors: [0xaaaaaa, 0x888888],
                minSpeed: 20,
                maxSpeed: 50,
                minSize: 3,
                maxSize: 6,
                life: 200,
                spread: Math.PI / 4,
                angle: enemy.dodgeDir > 0 ? Math.PI : 0,
                fadeOut: true
              });
            }
          } else if (enemy.aiTimer < 400) {
            // Phase 3: Recovery
            enemy.setScale(1, 1);
            enemy.body.setVelocityX(enemy.body.velocity.x * 0.8); // Décélération
          } else {
            // Fin de l'esquive
            enemy.setScale(1, 1);
            enemy.aiState = canSeePlayer ? 'alert' : 'patrol';
            enemy.aiTimer = 0;
          }
          break;
      }

      // Friction naturelle quand pas de mouvement intentionnel
      if (Math.abs(enemy.body.velocity.x) < 5) {
        enemy.body.setVelocityX(0);
      }
    });

    // Update Guardian shield position
    if (this.bossType === 4 && this.guardianShieldSprite && this.boss && this.boss.active) {
      this.guardianShieldSprite.x = this.boss.x;
      this.guardianShieldSprite.y = this.boss.y;
    }

    // Visual feedback avec états avancés (tint pour sprites)
    if (this.isDashing) {
      // Dash = blanc cyan brillant
      this.player.setTint(0x88ffff);
    } else if (this.isClimbing) {
      // Climbing = violet
      this.player.setTint(0xaa88ff);
    } else if (onWall && body.velocity.y > 0) {
      // Wall slide = cyan
      this.player.setTint(0x00ccaa);
      // Particules de wall slide (peu fréquentes)
      if (Math.random() < 0.15) {
        const wallX = onWallLeft ? this.player.x - 12 : this.player.x + 12;
        this.particleWallSlide(wallX, this.player.y);
      }
    } else if (!onGround && this.hasDoubleJumped) {
      // Double jump utilisé = vert clair
      this.player.setTint(0x88cc44);
    } else if (!onGround && this.hasDashedInAir) {
      // Dash utilisé en l'air = orange
      this.player.setTint(0xffaa44);
    } else {
      // Normal = couleur originale du sprite
      this.player.clearTint();
    }

    // Direction du regard (pour le dash sans direction)
    if (left) this.player.flipX = true;
    else if (right) this.player.flipX = false;

    // Mise à jour des particules
    this.updateParticles(delta);

    // Mise à jour IA des shooters
    this.updateShooterAI(delta);

    // Mise à jour physique du boss (mouvement réaliste)
    this.updateBossPhysics(delta);

    // Mise à jour des visuels du boss
    this.updateBossVisuals(delta);

    // === MISE À JOUR DES PLATEFORMES MOBILES ===
    this.updateMovingPlatforms(delta);

    // === CAMERA UPDATE ===
    this.updateCamera(delta);

    // Parallax étoiles basé sur la caméra
    const camX = this.cameras.main.scrollX;
    const camY = this.cameras.main.scrollY;
    const parallaxOffsetX = camX / this.WORLD.width;
    const parallaxOffsetY = camY / this.WORLD.height;

    this.stars.forEach(star => {
      const strength = star.parallaxStrength || (star.depth * 5);
      star.x = star.baseX - parallaxOffsetX * strength * 50;
      star.y = star.baseY - parallaxOffsetY * strength * 30;
    });

    this.isTouchingWall = false;

    // Reset touch "just pressed" states at end of frame
    this.resetTouchJustPressed();
  }

  // === SYSTÈME DE CAMÉRA AVANCÉ ===
  updateCamera(delta) {
    const cam = this.cameras.main;
    const cfg = this.cameraConfig;
    const body = this.player.body;

    // Look-ahead basé sur la vélocité
    const targetLookX = (body.velocity.x / this.config.playerSpeed) * cfg.lookAheadX;
    const targetLookY = (body.velocity.y / 500) * cfg.lookAheadY;

    this.currentLookAhead.x = Phaser.Math.Linear(this.currentLookAhead.x, targetLookX, 0.05);
    this.currentLookAhead.y = Phaser.Math.Linear(this.currentLookAhead.y, targetLookY, 0.08);

    // Appliquer l'offset de look-ahead
    cam.setFollowOffset(-this.currentLookAhead.x, -this.currentLookAhead.y);
  }

  // Screen shake
  screenShake(intensity = 0.01, duration = 100) {
    this.cameras.main.shake(duration, intensity);
  }

  // Nettoyage lors du changement de scène
  shutdown() {
    // Arrêter la musique
    this.stopMusic();

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
  width: 960,
  height: 540,
  parent: 'game',
  backgroundColor: '#0a0a18',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    min: { width: 480, height: 270 },
    max: { width: 1920, height: 1080 }
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
      overlapBias: 16,
      tileBias: 16
    }
  },
  scene: GameScene,
  pixelArt: true,
  antialias: false,
  roundPixels: true
};

// Créer le jeu
const game = new Phaser.Game(config);

// Fullscreen toggle avec F ou F11
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
    if (game.scale.isFullscreen) {
      game.scale.stopFullscreen();
    } else {
      game.scale.startFullscreen();
    }
  }
});

// Double-tap for fullscreen on mobile
let lastTap = 0;
document.getElementById('game').addEventListener('touchend', (e) => {
  const currentTime = new Date().getTime();
  const tapLength = currentTime - lastTap;
  if (tapLength < 300 && tapLength > 0) {
    if (game.scale.isFullscreen) {
      game.scale.stopFullscreen();
    } else {
      game.scale.startFullscreen();
    }
    e.preventDefault();
  }
  lastTap = currentTime;
});
