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
    this.maxHealth = data.maxHealth || 3; // Vies max persistantes
    this.currentHealth = data.currentHealth || this.maxHealth; // Vie actuelle (persistante)
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
    this.playerHealth = this.currentHealth; // Vie persistante entre niveaux
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
      ? `BOSS`
      : `NIVEAU ${this.currentLevel}`;

    this.introText = this.add.text(centerX, centerY, levelText, {
      fontSize: isBossLevel ? '64px' : '48px',
      fontFamily: 'Arial Black, sans-serif',
      fill: isBossLevel ? '#ff4444' : '#ffffff',
      stroke: isBossLevel ? '#880000' : '#333333',
      strokeThickness: isBossLevel ? 8 : 4
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0).setAlpha(0).setScale(0.5);

    // Sous-titre pour les boss
    if (isBossLevel) {
      const bossNum = Math.floor(this.currentLevel / 5);
      const bossType = ((bossNum - 1) % 5) + 1;
      const bossNames = ['', 'CHARGER', 'SPINNER', 'SPLITTER', 'GUARDIAN', 'SUMMONER'];
      this.introSubtext = this.add.text(centerX, centerY + 50, bossNames[bossType], {
        fontSize: '28px',
        fontFamily: 'Arial, sans-serif',
        fill: '#ffaaaa',
        stroke: '#440000',
        strokeThickness: 3
      }).setOrigin(0.5).setDepth(1001).setScrollFactor(0).setAlpha(0);
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

    // Animation du sous-texte boss
    if (this.introSubtext) {
      this.tweens.add({
        targets: this.introSubtext,
        alpha: 1,
        y: centerY + 45,
        duration: 500,
        delay: 200,
        ease: 'Power2'
      });
    }
  }

  startLevelFadeIn() {
    const isBossLevel = this.currentLevel % 5 === 0;

    // Fade out du texte
    this.tweens.add({
      targets: [this.introText, this.introSubtext].filter(Boolean),
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
        if (this.introSubtext) this.introSubtext.destroy();

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
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      // Essayer de jouer la musique en attente (HTML5 Audio)
      if (this.currentTrack && this.currentTrack.paused && this.musicPlaying) {
        this.currentTrack.play().catch(() => {});
      }
    };

    this.input.on('pointerdown', enableAudio, this);
    this.input.keyboard.on('keydown', enableAudio, this);
  }

  playSound(type, options = {}) {
    if (!this.audioCtx || !this.audioEnabled) return;

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
        // Clé - son magique ascendant
        for (let i = 0; i < 4; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const freq = 440 * Math.pow(1.25, i);
          const delay = i * 0.08;
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(volume * 0.2, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.15);
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
        'boss1': 'music/bgm_charger.mp3',
        'boss2': 'music/bgm_spinner.mp3',
        'boss3': 'music/bgm_splitter.mp3',
        'boss4': 'music/bgm_guardian.mp3',
        'boss5': 'music/bgm_summoner.mp3'
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

  fadeOutTrack(track, duration) {
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
        track.pause();
        track.currentTime = 0;
      }
    }, stepTime);
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
    // Utiliser les fichiers audio externes
    const trackKey = `boss${bossType}`;
    this.playMusicTrack(trackKey);
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
    this.emitParticles(x, y, {
      count: 8,
      colors: [0xffd700, 0xffee00, 0xffffaa],
      minSpeed: 40,
      maxSpeed: 100,
      minSize: 2,
      maxSize: 5,
      life: 400,
      spread: Math.PI * 2,
      gravity: -100,
      fadeOut: true,
      shape: 'star'
    });
  }

  particleKey(x, y) {
    this.emitParticles(x, y, {
      count: 20,
      colors: [0xffd700, 0xffcc00, 0xffffaa, 0xffffff],
      minSpeed: 60,
      maxSpeed: 150,
      minSize: 3,
      maxSize: 8,
      life: 600,
      spread: Math.PI * 2,
      gravity: -150,
      fadeOut: true,
      shrink: true,
      shape: 'star'
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

    // === ZONE CENTRE-HAUT : Niveau + Vies ===
    const isBossLevel = this.currentLevel % 5 === 0;
    const levelColor = isBossLevel ? '#ff00ff' : '#00ff88';
    const centerX = vw / 2;

    this.levelText = this.add.text(centerX, padding, `NIVEAU ${this.currentLevel}`, {
      ...textStyle,
      fontSize: isBossLevel ? '16px' : '14px',
      fill: levelColor,
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(uiDepth + 1);

    if (isBossLevel) {
      this.add.text(centerX, padding + 18, '[ BOSS ]', {
        ...textStyle, fontSize: '10px', fill: '#ff00ff'
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(uiDepth + 1);
    }

    // Vies - affichage moderne avec icônes
    this.healthContainer = this.add.container(centerX, isBossLevel ? padding + 34 : padding + 20).setScrollFactor(0).setDepth(uiDepth + 1);
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
  }

  createKeySprite(x, y, skipAnimation = false) {
    // Clé stylisée en formes géométriques
    const keyContainer = this.add.container(x, y);

    // Tête de la clé (cercle)
    const head = this.add.circle(0, -8, 10, 0xffd700);
    head.setStrokeStyle(2, 0xcc9900);
    // Trou dans la tête
    const hole = this.add.circle(0, -8, 4, 0x000000, 0.5);

    // Tige
    const stem = this.add.rectangle(0, 8, 5, 20, 0xffd700);
    stem.setStrokeStyle(1, 0xcc9900);

    // Dents
    const tooth1 = this.add.rectangle(5, 14, 6, 4, 0xffd700);
    const tooth2 = this.add.rectangle(5, 20, 8, 4, 0xffd700);

    keyContainer.add([stem, tooth1, tooth2, head, hole]);

    // Animation de flottement (seulement si pas skipAnimation)
    if (!skipAnimation) {
      this.tweens.add({
        targets: keyContainer,
        y: y - 8,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      // Rotation légère
      this.tweens.add({
        targets: keyContainer,
        angle: { from: -5, to: 5 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    return keyContainer;
  }

  updateHealthDisplay() {
    this.healthContainer.removeAll(true);
    const heartSize = 18;
    const spacing = 22;
    const totalWidth = this.maxHealth * spacing;
    const startX = -totalWidth / 2 + spacing / 2;

    for (let i = 0; i < this.maxHealth; i++) {
      const isFilled = i < this.playerHealth;
      const heart = this.add.text(startX + i * spacing, 0, isFilled ? '❤️' : '🖤', {
        fontSize: `${heartSize}px`
      }).setOrigin(0.5);

      if (isFilled) {
        // Petit effet de pulsation sur les coeurs pleins
        this.tweens.add({
          targets: heart,
          scale: 1.1,
          duration: 500 + i * 100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
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
    // Joueur - taille réduite pour meilleur gameplay (style Celeste)
    this.player = this.add.rectangle(60, this.WORLD.groundY - 30, 16, 28, 0x00ff88);
    this.player.setStrokeStyle(2, 0x00cc66);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, this.WORLD.width, this.WORLD.height + 200);
    this.player.body.setGravityY(this.config.gravity);
    this.player.body.setMaxVelocityX(this.config.playerSpeed);
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
      // Hitbox généreuse centrée sur la clé (le container a son origine au centre de la clé)
      this.key.body.setSize(40, 50);
      this.key.body.setOffset(-20, -25);
      this.physics.add.overlap(this.player, this.key, this.collectKey, null, this);
    }

    // Porte - positionnée sur la plateforme déjà créée
    this.door = this.add.rectangle(doorX, doorY, 35, 50, 0x666666);
    this.door.setStrokeStyle(2, 0x444444);
    this.doorLocked = true;
    this.physics.add.existing(this.door, true);
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

    // Ennemis au sol
    if (!isBossLevel) {
      const numGroundEnemies = 1 + Math.floor(this.currentLevel / 4);
      for (let i = 0; i < numGroundEnemies; i++) {
        const gx = 200 + i * (width - 350) / Math.max(1, numGroundEnemies);
        const groundEnemy = this.createPatrolEnemy(gx, groundY - 40, gx - 80, gx + 80);
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

  createPatrolEnemy(x, y, minX, maxX, forceType = null) {
    // Types d'ennemis variés
    const enemyTypes = [
      { shape: 'rect', w: 28, h: 28, color: 0xff4444, stroke: 0xcc2222, speed: 1.0, name: 'basic' },      // Carré rouge
      { shape: 'rect', w: 20, h: 35, color: 0xff6644, stroke: 0xcc4422, speed: 1.3, name: 'tall' },       // Grand fin orange
      { shape: 'rect', w: 40, h: 22, color: 0xcc4466, stroke: 0x992244, speed: 0.7, name: 'wide' },       // Large rose
      { shape: 'triangle', w: 32, h: 28, color: 0xff2266, stroke: 0xcc0044, speed: 1.1, name: 'spike' },  // Triangle pointu
      { shape: 'circle', r: 18, color: 0xff5500, stroke: 0xcc3300, speed: 1.4, name: 'fast' },            // Cercle rapide
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
    enemy.body.setCollideWorldBounds(true);
    return enemy;
  }

  createShooterEnemy(x, y, shooterType = null) {
    // Types de shooters variés
    const shooterTypes = [
      { w: 30, h: 30, color: 0xff8800, stroke: 0xcc6600, delay: 2800, piercing: false },  // Normal
      { w: 25, h: 40, color: 0xff4400, stroke: 0xcc2200, delay: 2200, piercing: false },  // Rapide
      { w: 40, h: 25, color: 0x8800ff, stroke: 0x6600cc, delay: 3500, piercing: true },   // Perçant!
    ];

    const typeIndex = shooterType !== null ? shooterType :
      (this.currentLevel >= 4 && Math.random() < 0.25 ? 2 : (Math.random() < 0.4 ? 1 : 0));
    const type = shooterTypes[Math.min(typeIndex, shooterTypes.length - 1)];

    const shooter = this.add.rectangle(x, y, type.w, type.h, type.color);
    shooter.setStrokeStyle(2, type.stroke);
    shooter.shooterType = type;
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
      const type = shooter.shooterType || { color: 0xff8800, piercing: false };
      shooter.setFillStyle(type.color);
      shooter.x = originalX;
      shooter.y = originalY;

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
      const speed = 160 + this.currentLevel * 10;

      let bullet;
      if (type.piercing) {
        // Projectile perçant - losange avec bordure rouge
        bullet = this.add.polygon(shooter.x, shooter.y, [0, -10, 5, 0, 0, 10, -5, 0], 0x8800ff);
        bullet.setStrokeStyle(2, 0xff0000);
        bullet.piercing = true;
        bullet.setRotation(angle + Math.PI / 2);
      } else {
        // Projectile normal - cercle
        bullet = this.add.circle(shooter.x, shooter.y, 7, 0xffee00);
        bullet.setStrokeStyle(2, 0xff6600);
        bullet.piercing = false;
      }

      this.bullets.add(bullet);
      bullet.body.setAllowGravity(false);
      bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

      this.time.delayedCall(type.piercing ? 4000 : 3000, () => {
        if (bullet && bullet.active) bullet.destroy();
      });
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
    const doorY = doorPixel.y;

    // Plateforme sous la porte (2-3 tiles de large)
    const doorPlatWidth = this.rng.between(2, 3);
    const doorPlatRow = doorRow + 1;
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

    // Spikes
    if (this.spikes.getChildren().length > 0) {
      this.physics.add.overlap(this.player, this.spikes, () => {
        if (!this.isInvincible) {
          this.takeDamage();
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

    // Player spawn - au centre de l'arène au sol
    this.player = this.add.rectangle(centerX, groundY - 30, 16, 28, 0x00ff88);
    this.player.setStrokeStyle(2, 0x00cc66);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, this.WORLD.width, this.WORLD.height + 100);
    this.player.body.setGravityY(this.config.gravity);
    this.player.body.setMaxVelocityX(this.config.playerSpeed);
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

    // Porte (cachée jusqu'à la victoire)
    this.door = this.add.rectangle(this.WORLD.width - 40, this.WORLD.groundY - 35, 30, 45, 0x333333);
    this.door.setStrokeStyle(2, 0x222222);
    this.door.setAlpha(0.3);
    this.doorLocked = true;
    this.physics.add.existing(this.door, true);
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
    const bossType = ((bossNum - 1) % 5) + 1; // Cycle 1-5

    // Config de base selon le type (tailles réduites pour arène 960x540)
    const bossConfigs = {
      1: { name: 'CHARGER', color: 0xaa00aa, stroke: 0xff00ff, health: 5, size: 35 },
      2: { name: 'SPINNER', color: 0x00aaaa, stroke: 0x00ffff, health: 6, size: 32 },
      3: { name: 'SPLITTER', color: 0xaaaa00, stroke: 0xffff00, health: 4, size: 40 },
      4: { name: 'GUARDIAN', color: 0x0066aa, stroke: 0x0099ff, health: 8, size: 38 },
      5: { name: 'SUMMONER', color: 0xaa0066, stroke: 0xff0099, health: 6, size: 30 }
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

    // Créer l'UI du boss
    this.createBossUI(config.name, bossNum, config.stroke);

    // Collision avec le joueur
    this.physics.add.overlap(this.player, this.boss, this.hitBoss, null, this);

    // Spawn le comportement selon le type
    switch (bossType) {
      case 1: this.initBossCharger(); break;
      case 2: this.initBossSpinner(); break;
      case 3: this.initBossSplitter(); break;
      case 4: this.initBossGuardian(); break;
      case 5: this.initBossSummoner(); break;
    }

    // Animation d'apparition
    const eyeElements = [this.boss, this.bossEye, this.bossPupil, this.bossEyeGlint, this.bossEyelidTop, this.bossEyelidBottom];
    eyeElements.forEach(el => {
      el.setAlpha(0);
      el.setScale(0.5);
    });
    this.tweens.add({
      targets: eyeElements,
      alpha: 1,
      scale: 1,
      duration: 500,
      ease: 'Back.easeOut'
    });

    // Démarrer la musique du boss
    this.startBossMusic(bossType);
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
    this.boss.body.setVelocity(this.boss.moveSpeed, this.boss.moveSpeed / 2);

    this.bossMoveTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossChargerMove,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 1800,
      callback: this.bossChargerShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossChargerMove() {
    if (!this.boss || !this.boss.active || this.bossDashing) return;

    const toPlayerX = this.player.x - this.boss.x;
    const toPlayerY = this.player.y - this.boss.y;
    const playerAbove = this.player.y < this.boss.y - 20;
    const playerAligned = Math.abs(toPlayerX) < 80;

    // Esquive si joueur au-dessus
    if (playerAbove && playerAligned && !this.bossDashCooldown) {
      const escapeDir = toPlayerX !== 0 ? -Math.sign(toPlayerX) : (Math.random() < 0.5 ? -1 : 1);
      this.bossDash(escapeDir, 0.3);
      return;
    }

    // Phase 2 : Charge vers le joueur parfois
    if (this.bossPhase >= 2 && Math.random() < 0.4) {
      const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;
      this.bossDash(toPlayerX / dist, toPlayerY / dist * 0.5);
      return;
    }

    // Mouvement normal
    const speed = this.boss.moveSpeed;
    this.boss.body.setVelocity(
      (toPlayerX > 0 ? 1 : -1) * speed * 0.7,
      (Math.random() - 0.5) * speed
    );

    const maxY = this.WORLD.groundY - 200;
    const minY = 150;
    if (this.boss.y > maxY) this.boss.body.setVelocityY(-speed);
    if (this.boss.y < minY) this.boss.body.setVelocityY(speed);
  }

  bossChargerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Fenêtre d'attaque
    const playerAbove = this.player.y < this.boss.y - 30;
    const playerClose = Math.abs(this.player.x - this.boss.x) < 100;
    if (playerAbove && playerClose && this.player.body.velocity.y > 50) return;

    // Animation
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.3, scaleY: 1.3,
      duration: 300,
      yoyo: true
    });

    this.time.delayedCall(350, () => {
      if (!this.boss || !this.boss.active || this.bossShotPaused) return;

      const numBullets = 3 + this.bossPhase;
      const spreadAngle = Math.PI / 4;
      const baseAngle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);

      for (let i = 0; i < numBullets; i++) {
        const angle = baseAngle - spreadAngle / 2 + (spreadAngle / (numBullets - 1)) * i;
        this.createBossBullet(this.boss.x, this.boss.y, angle, 180);
      }
    });
  }

  // ==========================================
  // BOSS 2 : SPINNER - Tirs circulaires + Téléport
  // ==========================================
  initBossSpinner() {
    this.spinnerAngle = 0;

    this.bossMoveTimer = this.time.addEvent({
      delay: 3000,
      callback: this.bossSpinnerTeleport,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 150,
      callback: this.bossSpinnerShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossSpinnerTeleport() {
    if (!this.boss || !this.boss.active) return;

    // Flash avant téléport
    this.boss.setAlpha(0.3);
    this.time.delayedCall(300, () => {
      if (!this.boss || !this.boss.active) return;

      // Nouvelle position (évite le joueur)
      let newX, newY;
      const minX = 200;
      const maxX = this.WORLD.width - 200;
      const minY = 100;
      const maxY = this.WORLD.groundY - 100;
      do {
        newX = Phaser.Math.Between(minX, maxX);
        newY = Phaser.Math.Between(minY, maxY);
      } while (Math.abs(newX - this.player.x) < 150 && Math.abs(newY - this.player.y) < 150);

      this.boss.x = newX;
      this.boss.y = newY;
      this.boss.setAlpha(1);

      // Burst de balles après téléport - PERÇANTES en phase 2!
      if (this.bossPhase >= 2) {
        for (let i = 0; i < 8; i++) {
          this.createPiercingBullet(this.boss.x, this.boss.y, (Math.PI * 2 / 8) * i, 150);
        }
      }
    });
  }

  bossSpinnerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Tir rotatif continu
    const speed = this.bossPhase >= 2 ? 140 : 120;
    this.createBossBullet(this.boss.x, this.boss.y, this.spinnerAngle, speed);

    // Double hélice en phase 2
    if (this.bossPhase >= 2) {
      this.createBossBullet(this.boss.x, this.boss.y, this.spinnerAngle + Math.PI, speed);
    }

    this.spinnerAngle += 0.15;
  }

  // ==========================================
  // BOSS 3 : SPLITTER - Se divise en mini-boss
  // ==========================================
  initBossSplitter() {
    this.splitterMinions = [];

    this.bossMoveTimer = this.time.addEvent({
      delay: 1500,
      callback: this.bossSplitterMove,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossSplitterShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossSplitterMove() {
    if (!this.boss || !this.boss.active || this.bossDashing) return;

    const toPlayerX = this.player.x - this.boss.x;
    const speed = this.boss.moveSpeed;

    // Rebondit sur les bords
    const minX = 150;
    const maxX = this.WORLD.width - 150;
    const minY = 100;
    const maxY = this.WORLD.groundY - 100;
    if (this.boss.x < minX) this.boss.body.setVelocityX(speed);
    else if (this.boss.x > maxX) this.boss.body.setVelocityX(-speed);
    else this.boss.body.setVelocityX((toPlayerX > 0 ? 1 : -1) * speed * 0.5);

    this.boss.body.setVelocityY((Math.random() - 0.5) * speed);
    if (this.boss.y > maxY) this.boss.body.setVelocityY(-speed);
    if (this.boss.y < minY) this.boss.body.setVelocityY(speed);
  }

  bossSplitterShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Tir vers le joueur
    const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
    this.createBossBullet(this.boss.x, this.boss.y, angle, 160);
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
      this.takeDamage();
    }
  }

  // ==========================================
  // BOSS 4 : GUARDIAN - Bouclier + Laser
  // ==========================================
  initBossGuardian() {
    this.guardianShield = true;
    this.guardianShieldSprite = this.add.circle(this.boss.x, this.boss.y, 50, 0x0099ff, 0.3);
    this.guardianShieldSprite.setStrokeStyle(3, 0x00ccff);

    // Le bouclier se désactive périodiquement
    this.bossMoveTimer = this.time.addEvent({
      delay: 4000,
      callback: this.bossGuardianToggleShield,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 2500,
      callback: this.bossGuardianLaser,
      callbackScope: this,
      loop: true
    });

    // Mouvement lent
    this.boss.body.setVelocity(40, 30);
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

  bossGuardianLaser() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

    // Warning line
    const targetY = this.player.y;
    const warningLine = this.add.rectangle(this.WORLD.width / 2, targetY, this.WORLD.width, 4, 0xff0000, 0.5);

    this.tweens.add({
      targets: warningLine,
      alpha: 0,
      duration: 800,
      onComplete: () => {
        warningLine.destroy();
        if (!this.boss || !this.boss.active) return;

        // SFX de laser
        this.playSound('laser');

        // Particules de charge avant le laser
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
        this.physics.add.existing(laser);
        laser.body.setAllowGravity(false);
        this.physics.add.overlap(this.player, laser, () => {
          if (!this.isInvincible) this.takeDamage();
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
    this.summonedEnemies = [];

    // Le boss reste en haut et invoque
    this.boss.body.setVelocity(0, 0);
    this.boss.x = this.WORLD.width / 2;
    this.boss.y = 150;

    this.bossMoveTimer = this.time.addEvent({
      delay: 3500,
      callback: this.bossSummonerSummon,
      callbackScope: this,
      loop: true
    });

    this.bossShootTimer = this.time.addEvent({
      delay: 2000,
      callback: this.bossSummonerShoot,
      callbackScope: this,
      loop: true
    });
  }

  bossSummonerSummon() {
    if (!this.boss || !this.boss.active) return;

    // Limite le nombre d'invocations
    this.summonedEnemies = this.summonedEnemies.filter(e => e.active);
    if (this.summonedEnemies.length >= 3) return;

    // Particules de charge magique
    this.emitParticles(this.boss.x, this.boss.y, {
      count: 20,
      colors: [0xff00ff, 0xff66cc, 0xaa00aa, 0xffffff],
      minSpeed: 50,
      maxSpeed: 150,
      minSize: 3,
      maxSize: 8,
      life: 500,
      spread: Math.PI * 2,
      fadeOut: true,
      shape: 'star'
    });

    // Animation d'invocation
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.3, scaleY: 0.7,
      duration: 300,
      yoyo: true
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

      const enemy = this.add.rectangle(spawnX, spawnY, 25, 25, 0xff4466);
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
  }

  bossSummonerShoot() {
    if (!this.boss || !this.boss.active || this.bossShotPaused) return;

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
  }

  hitSummonedEnemy(player, enemy) {
    if (this.isInvincible) return;

    if (player.body.velocity.y > 0 && player.y < enemy.y - 10) {
      // SFX + Particules
      this.playSound('enemyKill');
      this.particleEnemyDeath(enemy.x, enemy.y, 0xff4466);
      enemy.destroy();
      this.summonedEnemies = this.summonedEnemies.filter(e => e.active);
      this.score += 30;
      this.scoreText.setText(this.score.toString().padStart(6, '0'));
      player.body.setVelocityY(-300);
    } else {
      this.takeDamage();
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
      // Dégâts seulement si joueur pas invincible ET boss pas en cooldown
      this.takeDamage();
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

  defeatBoss() {
    // Éviter les appels multiples
    if (this.bossDefeated) return;
    this.bossDefeated = true;

    // Arrêter la musique du boss
    this.stopMusic();

    // Arrêter les particules ambiantes du boss
    if (this.bossParticleInterval) {
      clearInterval(this.bossParticleInterval);
      this.bossParticleInterval = null;
    }

    // CHECKPOINT : Sauvegarder la progression après avoir battu le boss
    const checkpointData = {
      level: this.currentLevel + 1, // On reprend au niveau suivant
      score: this.score + 500, // Score avec le bonus boss
      totalTime: this.totalTime + this.levelTime,
      maxHealth: this.maxHealth
    };
    localStorage.setItem('platformer-checkpoint', JSON.stringify(checkpointData));
    this.checkpoint = checkpointData;

    // Restaurer la vie au max après avoir battu un boss !
    this.playerHealth = this.maxHealth;
    this.updateHealthDisplay();

    // SFX + Particules de victoire
    this.playSound('bossDefeat');
    this.particleBossDefeat(this.boss.x, this.boss.y, this.bossColor || 0xff00ff);

    // Détruire la hitbox et les visuels
    this.boss.destroy();
    if (this.bossVisuals) {
      this.bossVisuals.destroy();
      this.bossVisuals = null;
    }

    // Détruire les éléments de l'œil
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
        duration: 300,
        onComplete: () => {
          if (this.bossUIContainer) this.bossUIContainer.destroy();
        }
      });
    }
    if (this.bossMoveTimer) this.bossMoveTimer.remove();
    if (this.bossShootTimer) this.bossShootTimer.remove();

    this.score +=500;
    this.scoreText.setText(this.score.toString().padStart(6, '0'));

    // Faire apparaître la clé (sans animation de flottement pendant la chute)
    this.key = this.createKeySprite(400, 300, true);
    this.physics.add.existing(this.key);
    this.key.body.setSize(28, 40);
    this.key.body.setAllowGravity(true);
    this.key.body.setGravityY(200); // Chute lente

    // Quand la clé atterrit, démarrer l'animation de flottement
    this.keyLanded = false;
    this.physics.add.collider(this.key, this.platforms, () => {
      if (!this.keyLanded && this.key) {
        this.keyLanded = true;
        // Arrêter la physique
        this.key.body.setAllowGravity(false);
        this.key.body.setVelocity(0, 0);
        const landY = this.key.y;
        // Démarrer l'animation de flottement
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
    this.doorLocked = false;
    this.door.setFillStyle(0x00cc66);
    this.door.setStrokeStyle(3, 0x00ff88);
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

    // Arrêter la musique avant de changer de niveau
    this.stopMusic();

    // Animation de transition puis niveau suivant
    this.playLevelOutro({
      level: this.currentLevel + 1,
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
      this.particleEnemyDeath(enemy.x, enemy.y, enemy.fillColor || 0xff4444);
      enemy.destroy();
      this.score +=50;
      this.scoreText.setText(this.score.toString().padStart(6, '0'));
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
          currentHealth: this.checkpoint.maxHealth // Full vie au checkpoint
        });
      } else {
        this.scene.restart({ level: 1, score: 0, totalTime: 0, maxHealth: 3, currentHealth: 3 });
      }
      return;
    }

    // SFX + Particules de dégâts
    this.playSound('hurt');
    this.particleHurt(this.player.x, this.player.y);

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

    // Récupérer 1/4 d'un coeur (0.25 vie fixe)
    const healAmount = 0.25;
    this.playerHealth = Math.min(this.playerHealth + healAmount, this.maxHealth);
    this.updateHealthDisplay();
  }

  collectHeart() {
    if (!this.heartPickup || !this.heartPickup.active) return;

    // SFX + Particules
    this.playSound('heart');
    this.particleHeart(this.heartPickup.x, this.heartPickup.y);

    this.heartPickup.destroy();

    // Augmente la vie max ET soigne
    this.maxHealth++;
    this.playerHealth = this.maxHealth;
    this.updateHealthDisplay();

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
    this.scoreText.setText(this.score.toString().padStart(6, '0'));
  }

  update(time, delta) {
    // Reset rapide (R) - efface le checkpoint et recommence à zéro
    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.stopMusic();
      localStorage.removeItem('platformer-checkpoint'); // Effacer le checkpoint
      this.scene.restart({ level: 1, score: 0, totalTime: 0, maxHealth: 3, currentHealth: 3 });
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

    // Update ennemis patrouille
    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.active) return;
      const baseSpeed = 60 + this.currentLevel * 5;
      const speed = baseSpeed * (enemy.speedMultiplier || 1);

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

    // Update Guardian shield position
    if (this.bossType === 4 && this.guardianShieldSprite && this.boss && this.boss.active) {
      this.guardianShieldSprite.x = this.boss.x;
      this.guardianShieldSprite.y = this.boss.y;
    }

    // Visual feedback avec états avancés
    if (this.isDashing) {
      // Dash = blanc cyan brillant
      this.player.setFillStyle(0x88ffff);
    } else if (this.isClimbing) {
      // Climbing = violet
      this.player.setFillStyle(0xaa88ff);
    } else if (onWall && body.velocity.y > 0) {
      // Wall slide = cyan
      this.player.setFillStyle(0x00ccaa);
      // Particules de wall slide (peu fréquentes)
      if (Math.random() < 0.15) {
        const wallX = onWallLeft ? this.player.x - 12 : this.player.x + 12;
        this.particleWallSlide(wallX, this.player.y);
      }
    } else if (!onGround && this.hasDoubleJumped) {
      // Double jump utilisé = vert clair
      this.player.setFillStyle(0x88cc44);
    } else if (!onGround && this.hasDashedInAir) {
      // Dash utilisé en l'air = orange
      this.player.setFillStyle(0xffaa44);
    } else {
      // Normal = vert
      this.player.setFillStyle(0x00ff88);
    }

    // Direction du regard (pour le dash sans direction)
    if (left) this.player.flipX = true;
    else if (right) this.player.flipX = false;

    // Mise à jour des particules
    this.updateParticles(delta);

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
      debug: false
    }
  },
  scene: GameScene,
  pixelArt: false,
  antialias: true
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
