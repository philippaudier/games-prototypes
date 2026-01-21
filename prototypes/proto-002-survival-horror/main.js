// Survival Horror Prototype - Resident Evil style with fixed cameras and tank controls

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.currentRoom = data.room || 'start';
    this.playerAngle = data.playerAngle || -90; // Face up by default
    this.zombiesKilled = data.zombiesKilled || [];

    // Inventory system - array of item objects
    this.inventory = data.inventory || [];
    this.inventorySize = 8; // Max 8 slots
    this.inventoryOpen = false;
    this.selectedSlot = 0;

    // Item database
    this.itemDatabase = {
      'redKey': { name: 'Red Key', type: 'key', description: 'An old red key. Opens red doors.', icon: '🔑', color: 0xff4444 },
      'blueKey': { name: 'Blue Key', type: 'key', description: 'A blue key with strange markings.', icon: '🔑', color: 0x4444ff },
      'ammo1': { name: 'Handgun Ammo', type: 'ammo', description: 'Standard 9mm rounds. x6', icon: '🔫', color: 0xcccccc, ammoCount: 6 },
      'ammo2': { name: 'Handgun Ammo', type: 'ammo', description: 'Standard 9mm rounds. x6', icon: '🔫', color: 0xcccccc, ammoCount: 6 },
      'herb1': { name: 'Green Herb', type: 'herb', description: 'A medicinal herb. Restores health.', icon: '🌿', color: 0x44aa44, healAmount: 30 },
      'herb2': { name: 'Green Herb', type: 'herb', description: 'A medicinal herb. Restores health.', icon: '🌿', color: 0x44aa44, healAmount: 30 },
      'firstAid': { name: 'First Aid Spray', type: 'healing', description: 'Fully restores health.', icon: '💊', color: 0x44aaaa, healAmount: 100 }
    };
  }

  create() {
    // World size (fixed camera room)
    this.WORLD = {
      width: 640,
      height: 400
    };

    // Config
    this.config = {
      playerSpeed: 120,
      playerRunSpeed: 200,
      turnSpeed: 150, // degrees per second
      zombieSpeed: 40,
      zombieChaseSpeed: 70,
      flashlightAngle: 45, // degrees
      flashlightRange: 200
    };

    // Player state
    this.isRunning = false;
    this.canMove = true;
    this.isTransitioning = false;

    // Create the current room
    this.createRoom(this.currentRoom);

    // Setup input
    this.setupInput();

    // Setup touch controls
    this.initTouchControls();

    // Create darkness overlay and flashlight
    this.createLighting();

    // Create UI
    this.createUI();

    // Ambient sound (simulated with text for now)
    this.ambientTimer = 0;
  }

  // ==========================================
  // ROOM SYSTEM
  // ==========================================

  getRoomData(roomId) {
    const rooms = {
      'start': {
        name: 'Entrance Hall',
        bgColor: 0x1a1410,
        walls: [
          { x: 0, y: 0, w: 640, h: 20 },      // Top
          { x: 0, y: 380, w: 640, h: 20 },    // Bottom
          { x: 0, y: 0, w: 20, h: 400 },      // Left
          { x: 620, y: 0, w: 20, h: 400 }     // Right
        ],
        furniture: [
          { type: 'table', x: 100, y: 100, w: 80, h: 50 },
          { type: 'cabinet', x: 500, y: 80, w: 60, h: 100 },
          { type: 'couch', x: 300, y: 280, w: 120, h: 50 }
        ],
        doors: [
          { x: 300, y: 10, w: 60, h: 20, toRoom: 'corridor', spawnX: 300, spawnY: 360, spawnAngle: -90 }
        ],
        items: [
          { type: 'key', id: 'redKey', x: 530, y: 130, name: 'Red Key' }
        ],
        zombies: [
          { id: 'z1', x: 450, y: 200 }
        ],
        playerStart: { x: 320, y: 300 }
      },
      'corridor': {
        name: 'Dark Corridor',
        bgColor: 0x0f0a08,
        walls: [
          { x: 0, y: 0, w: 640, h: 20 },
          { x: 0, y: 380, w: 640, h: 20 },
          { x: 0, y: 0, w: 20, h: 400 },
          { x: 620, y: 0, w: 20, h: 400 },
          // Corridor walls
          { x: 100, y: 0, w: 20, h: 150 },
          { x: 100, y: 250, w: 20, h: 150 },
          { x: 520, y: 0, w: 20, h: 150 },
          { x: 520, y: 250, w: 20, h: 150 }
        ],
        furniture: [
          { type: 'barrel', x: 50, y: 100, w: 30, h: 30 },
          { type: 'barrel', x: 590, y: 300, w: 30, h: 30 }
        ],
        doors: [
          { x: 300, y: 380, w: 60, h: 20, toRoom: 'start', spawnX: 300, spawnY: 50, spawnAngle: 90 },
          { x: 300, y: 10, w: 60, h: 20, toRoom: 'saferoom', locked: 'redKey', spawnX: 300, spawnY: 360, spawnAngle: -90 }
        ],
        items: [
          { type: 'ammo', id: 'ammo1', x: 580, y: 320, name: 'Handgun Ammo (6)' }
        ],
        zombies: [
          { id: 'z2', x: 300, y: 200 },
          { id: 'z3', x: 200, y: 150 }
        ],
        playerStart: { x: 300, y: 350 }
      },
      'saferoom': {
        name: 'Safe Room',
        bgColor: 0x1a1815,
        walls: [
          { x: 0, y: 0, w: 640, h: 20 },
          { x: 0, y: 380, w: 640, h: 20 },
          { x: 0, y: 0, w: 20, h: 400 },
          { x: 620, y: 0, w: 20, h: 400 }
        ],
        furniture: [
          { type: 'savepoint', x: 320, y: 100, w: 50, h: 50 },
          { type: 'chest', x: 100, y: 200, w: 60, h: 40 },
          { type: 'table', x: 500, y: 200, w: 80, h: 50 }
        ],
        doors: [
          { x: 300, y: 380, w: 60, h: 20, toRoom: 'corridor', spawnX: 300, spawnY: 50, spawnAngle: 90 }
        ],
        items: [
          { type: 'herb', id: 'herb1', x: 530, y: 210, name: 'Green Herb' }
        ],
        zombies: [],
        playerStart: { x: 320, y: 300 },
        isSafe: true
      }
    };
    return rooms[roomId];
  }

  createRoom(roomId) {
    const room = this.getRoomData(roomId);
    if (!room) return;

    // Clear existing objects
    if (this.walls) this.walls.clear(true, true);
    if (this.furniture) this.furniture.clear(true, true);
    if (this.doorZones) this.doorZones.clear(true, true);
    if (this.items) this.items.clear(true, true);
    if (this.zombies) this.zombies.clear(true, true);
    if (this.roomGraphics) this.roomGraphics.destroy();

    // Background
    this.cameras.main.setBackgroundColor(room.bgColor);

    // Graphics for room elements
    this.roomGraphics = this.add.graphics();

    // Groups
    this.walls = this.physics.add.staticGroup();
    this.furniture = this.physics.add.staticGroup();
    this.doorZones = this.physics.add.staticGroup();
    this.items = this.physics.add.group();
    this.zombies = this.physics.add.group();

    // Draw floor pattern (3/4 perspective tiles)
    this.drawFloor(room);

    // Create walls
    room.walls.forEach(w => {
      const wall = this.add.rectangle(w.x + w.w/2, w.y + w.h/2, w.w, w.h, 0x2a2018);
      wall.setStrokeStyle(2, 0x3a3028);
      this.physics.add.existing(wall, true);
      this.walls.add(wall);
    });

    // Create furniture
    room.furniture.forEach(f => {
      const colors = {
        table: 0x4a3828,
        cabinet: 0x3a2818,
        couch: 0x5a4030,
        barrel: 0x6a5040,
        savepoint: 0x2040a0,
        chest: 0x8a6040
      };
      const furn = this.add.rectangle(f.x, f.y, f.w, f.h, colors[f.type] || 0x4a3828);
      furn.setStrokeStyle(2, 0x2a1808);

      // 3/4 perspective effect - add shadow/depth
      const shadow = this.add.rectangle(f.x + 3, f.y + 3, f.w, f.h * 0.3, 0x000000, 0.3);
      shadow.setOrigin(0.5, 0);

      this.physics.add.existing(furn, true);
      this.furniture.add(furn);

      // Savepoint glow
      if (f.type === 'savepoint') {
        this.tweens.add({
          targets: furn,
          alpha: 0.6,
          duration: 1000,
          yoyo: true,
          repeat: -1
        });
      }
    });

    // Create doors
    room.doors.forEach((d, i) => {
      const doorColor = d.locked ? 0x8b0000 : 0x654321;
      const door = this.add.rectangle(d.x + d.w/2, d.y + d.h/2, d.w, d.h, doorColor);
      door.setStrokeStyle(2, 0xffd700);
      door.doorData = d;
      this.physics.add.existing(door, true);
      this.doorZones.add(door);
    });

    // Create items (only if not picked up)
    room.items.forEach(item => {
      if (!this.inventory.includes(item.id)) {
        const colors = {
          key: 0xffd700,
          ammo: 0xc0c0c0,
          herb: 0x00aa00
        };
        const itemSprite = this.add.rectangle(item.x, item.y, 20, 20, colors[item.type] || 0xffffff);
        itemSprite.setStrokeStyle(2, 0xffffff);
        itemSprite.itemData = item;
        this.physics.add.existing(itemSprite, false);
        itemSprite.body.setImmovable(true);
        this.items.add(itemSprite);

        // Item glow
        this.tweens.add({
          targets: itemSprite,
          alpha: 0.5,
          duration: 500,
          yoyo: true,
          repeat: -1
        });
      }
    });

    // Create zombies (only if not killed)
    room.zombies.forEach(z => {
      if (!this.zombiesKilled.includes(z.id)) {
        this.createZombie(z.x, z.y, z.id);
      }
    });

    // Create player
    const spawnX = this.spawnX || room.playerStart.x;
    const spawnY = this.spawnY || room.playerStart.y;
    this.createPlayer(spawnX, spawnY);

    // Reset spawn overrides
    this.spawnX = null;
    this.spawnY = null;

    // Collisions
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.player, this.furniture);
    this.physics.add.collider(this.zombies, this.walls);
    this.physics.add.collider(this.zombies, this.furniture);

    // Overlaps
    this.physics.add.overlap(this.player, this.doorZones, this.handleDoor, null, this);
    this.physics.add.overlap(this.player, this.items, this.handleItem, null, this);
    this.physics.add.overlap(this.player, this.zombies, this.handleZombieAttack, null, this);

    // Room name display
    this.showRoomName(room.name, room.isSafe);
  }

  drawFloor(room) {
    const tileSize = 40;
    const graphics = this.roomGraphics;

    for (let x = 20; x < 620; x += tileSize) {
      for (let y = 20; y < 380; y += tileSize) {
        const shade = ((x + y) / tileSize) % 2 === 0 ? 0x1a1410 : 0x151010;
        graphics.fillStyle(shade, 1);
        graphics.fillRect(x, y, tileSize, tileSize);

        // 3/4 perspective lines
        graphics.lineStyle(1, 0x0a0805, 0.3);
        graphics.lineBetween(x, y + tileSize * 0.7, x + tileSize, y + tileSize * 0.7);
      }
    }
  }

  // ==========================================
  // PLAYER
  // ==========================================

  createPlayer(x, y) {
    // Player body (3/4 view - oval shape)
    this.player = this.add.container(x, y);

    // Shadow
    const shadow = this.add.ellipse(0, 8, 28, 14, 0x000000, 0.4);
    this.player.add(shadow);

    // Body (3/4 perspective)
    const body = this.add.ellipse(0, 0, 24, 32, 0x4a6080);
    body.setStrokeStyle(2, 0x2a4060);
    this.player.add(body);

    // Head
    const head = this.add.circle(0, -12, 10, 0xdda080);
    head.setStrokeStyle(1, 0xaa7060);
    this.player.add(head);

    // Direction indicator (flashlight direction)
    this.directionIndicator = this.add.triangle(0, -20, 0, 0, -6, 12, 6, 12, 0xffff88, 0.8);
    this.player.add(this.directionIndicator);

    // Physics
    this.physics.add.existing(this.player);
    this.player.body.setSize(24, 24);
    this.player.body.setOffset(-12, -12);

    // Initial rotation
    this.player.rotation = Phaser.Math.DegToRad(this.playerAngle);

    // Player stats
    this.playerHealth = 100;
    this.playerAmmo = 12;
  }

  // ==========================================
  // ZOMBIES
  // ==========================================

  createZombie(x, y, id) {
    const zombie = this.add.container(x, y);

    // Shadow
    const shadow = this.add.ellipse(0, 8, 26, 12, 0x000000, 0.4);
    zombie.add(shadow);

    // Body (greenish)
    const body = this.add.ellipse(0, 0, 22, 30, 0x3a5040);
    body.setStrokeStyle(2, 0x2a3030);
    zombie.add(body);

    // Head
    const head = this.add.circle(0, -10, 9, 0x6a8070);
    head.setStrokeStyle(1, 0x4a6050);
    zombie.add(head);

    // Eyes (red)
    const eye1 = this.add.circle(-4, -12, 2, 0xff0000);
    const eye2 = this.add.circle(4, -12, 2, 0xff0000);
    zombie.add(eye1);
    zombie.add(eye2);

    this.physics.add.existing(zombie);
    zombie.body.setSize(22, 22);
    zombie.body.setOffset(-11, -11);

    zombie.zombieId = id;
    zombie.health = 100;
    zombie.state = 'idle'; // idle, chase, attack
    zombie.lastSeen = 0;

    this.zombies.add(zombie);
    return zombie;
  }

  // ==========================================
  // LIGHTING
  // ==========================================

  createLighting() {
    // Dark overlay
    this.darkness = this.add.graphics();
    this.darkness.setDepth(100);

    // Flashlight mask will be drawn in update
  }

  updateLighting() {
    const graphics = this.darkness;
    graphics.clear();

    // Full darkness
    graphics.fillStyle(0x000000, 0.85);
    graphics.fillRect(0, 0, this.WORLD.width, this.WORLD.height);

    // Flashlight cone (cut out from darkness)
    graphics.fillStyle(0x000000, 0); // Transparent
    graphics.blendMode = Phaser.BlendModes.ERASE;

    const px = this.player.x;
    const py = this.player.y;
    const angle = this.player.rotation - Math.PI / 2;
    const range = this.config.flashlightRange;
    const spread = Phaser.Math.DegToRad(this.config.flashlightAngle);

    // Draw flashlight cone
    graphics.beginPath();
    graphics.moveTo(px, py);

    const segments = 20;
    for (let i = 0; i <= segments; i++) {
      const a = angle - spread + (spread * 2 * i / segments);
      const x = px + Math.cos(a) * range;
      const y = py + Math.sin(a) * range;
      graphics.lineTo(x, y);
    }

    graphics.closePath();
    graphics.fillPath();

    // Small circle around player (ambient light)
    graphics.fillCircle(px, py, 40);

    graphics.blendMode = Phaser.BlendModes.NORMAL;
  }

  // ==========================================
  // INPUT
  // ==========================================

  setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = {
      z: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z), // Forward
      s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S), // Backward
      q: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q), // Turn left
      d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D), // Turn right
      space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      x: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      i: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I), // Inventory
      tab: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB), // Inventory alt
      esc: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC) // Close inventory
    };

    // Prevent TAB from changing focus
    this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
  }

  initTouchControls() {
    this.touchInput = {
      forward: false,
      backward: false,
      turnLeft: false,
      turnRight: false,
      action: false,
      actionJustPressed: false,
      shoot: false,
      shootJustPressed: false,
      run: false,
      inventory: false,
      inventoryJustPressed: false
    };

    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isTouchDevice) return;

    const touchButtons = document.querySelectorAll('[data-input]');

    touchButtons.forEach(btn => {
      const input = btn.dataset.input;

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('active');

        if (input === 'action') {
          this.touchInput.action = true;
          this.touchInput.actionJustPressed = true;
        } else if (input === 'shoot') {
          this.touchInput.shoot = true;
          this.touchInput.shootJustPressed = true;
        } else if (input === 'inventory') {
          this.touchInput.inventory = true;
          this.touchInput.inventoryJustPressed = true;
        } else {
          this.touchInput[input] = true;
        }
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.classList.remove('active');

        if (input === 'action') {
          this.touchInput.action = false;
        } else if (input === 'shoot') {
          this.touchInput.shoot = false;
        } else if (input === 'inventory') {
          this.touchInput.inventory = false;
        } else {
          this.touchInput[input] = false;
        }
      }, { passive: false });

      btn.addEventListener('touchcancel', (e) => {
        btn.classList.remove('active');
        this.touchInput[input] = false;
      }, { passive: false });
    });
  }

  resetTouchJustPressed() {
    if (this.touchInput) {
      this.touchInput.actionJustPressed = false;
      this.touchInput.shootJustPressed = false;
      this.touchInput.inventoryJustPressed = false;
    }
  }

  // ==========================================
  // UI
  // ==========================================

  createUI() {
    // Health bar
    this.healthBar = this.add.graphics();
    this.healthBar.setDepth(200);
    this.healthBar.setScrollFactor(0);

    // Ammo display
    this.ammoText = this.add.text(this.WORLD.width - 20, 20, '', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fill: '#aaa'
    }).setOrigin(1, 0).setDepth(200);

    // Inventory hint
    this.invHintText = this.add.text(20, this.WORLD.height - 25, '[TAB] Inventory', {
      fontSize: '11px',
      fontFamily: 'monospace',
      fill: '#555'
    }).setDepth(200);

    // Message display
    this.messageText = this.add.text(this.WORLD.width / 2, this.WORLD.height - 50, '', {
      fontSize: '14px',
      fontFamily: 'monospace',
      fill: '#ddd',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setDepth(200).setAlpha(0);

    // Create inventory UI (hidden by default)
    this.createInventoryUI();

    this.updateUI();
  }

  createInventoryUI() {
    // Inventory container
    this.invContainer = this.add.container(this.WORLD.width / 2, this.WORLD.height / 2);
    this.invContainer.setDepth(500);
    this.invContainer.setVisible(false);

    // Background overlay
    this.invOverlay = this.add.rectangle(0, 0, this.WORLD.width, this.WORLD.height, 0x000000, 0.85);
    this.invContainer.add(this.invOverlay);

    // Inventory panel
    const panelW = 400;
    const panelH = 280;
    this.invPanel = this.add.rectangle(0, 0, panelW, panelH, 0x1a1512);
    this.invPanel.setStrokeStyle(3, 0x8b4513);
    this.invContainer.add(this.invPanel);

    // Title
    this.invTitle = this.add.text(0, -panelH/2 + 20, 'INVENTORY', {
      fontSize: '20px',
      fontFamily: 'serif',
      fill: '#c4a060',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.invContainer.add(this.invTitle);

    // Slots grid (2 rows x 4 cols)
    this.invSlots = [];
    this.invSlotGraphics = [];
    const slotSize = 60;
    const startX = -1.5 * (slotSize + 10);
    const startY = -30;

    for (let i = 0; i < this.inventorySize; i++) {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const x = startX + col * (slotSize + 10);
      const y = startY + row * (slotSize + 10);

      // Slot background
      const slot = this.add.rectangle(x, y, slotSize, slotSize, 0x2a2018);
      slot.setStrokeStyle(2, 0x4a3828);
      slot.slotIndex = i;
      slot.setInteractive();
      this.invContainer.add(slot);
      this.invSlots.push(slot);

      // Item icon (will be updated)
      const icon = this.add.text(x, y, '', {
        fontSize: '28px'
      }).setOrigin(0.5);
      this.invContainer.add(icon);
      this.invSlotGraphics.push(icon);

      // Click handler
      slot.on('pointerdown', () => {
        this.selectedSlot = i;
        this.updateInventoryUI();
      });
    }

    // Selected item info panel
    this.invInfoBg = this.add.rectangle(0, panelH/2 - 50, panelW - 40, 60, 0x0a0805);
    this.invInfoBg.setStrokeStyle(1, 0x3a2818);
    this.invContainer.add(this.invInfoBg);

    this.invItemName = this.add.text(-panelW/2 + 30, panelH/2 - 70, '', {
      fontSize: '14px',
      fontFamily: 'monospace',
      fill: '#c4a060',
      fontStyle: 'bold'
    });
    this.invContainer.add(this.invItemName);

    this.invItemDesc = this.add.text(-panelW/2 + 30, panelH/2 - 50, '', {
      fontSize: '11px',
      fontFamily: 'monospace',
      fill: '#888',
      wordWrap: { width: panelW - 60 }
    });
    this.invContainer.add(this.invItemDesc);

    // Action buttons
    this.invUseBtn = this.add.text(panelW/2 - 80, panelH/2 - 65, '[SPACE] Use', {
      fontSize: '12px',
      fontFamily: 'monospace',
      fill: '#6a6',
      backgroundColor: '#1a2a1a',
      padding: { x: 8, y: 4 }
    }).setOrigin(0.5).setInteractive();
    this.invContainer.add(this.invUseBtn);

    this.invDropBtn = this.add.text(panelW/2 - 80, panelH/2 - 40, '[X] Drop', {
      fontSize: '12px',
      fontFamily: 'monospace',
      fill: '#a66',
      backgroundColor: '#2a1a1a',
      padding: { x: 8, y: 4 }
    }).setOrigin(0.5).setInteractive();
    this.invContainer.add(this.invDropBtn);

    // Button click handlers
    this.invUseBtn.on('pointerdown', () => this.useSelectedItem());
    this.invDropBtn.on('pointerdown', () => this.dropSelectedItem());

    // Close hint
    this.invCloseHint = this.add.text(0, -panelH/2 + 45, 'Press TAB or ESC to close', {
      fontSize: '10px',
      fontFamily: 'monospace',
      fill: '#555'
    }).setOrigin(0.5);
    this.invContainer.add(this.invCloseHint);
  }

  updateUI() {
    // Health bar
    const hb = this.healthBar;
    hb.clear();
    hb.fillStyle(0x333333);
    hb.fillRect(20, 20, 104, 14);
    hb.fillStyle(this.playerHealth > 30 ? 0x00aa00 : 0xaa0000);
    hb.fillRect(22, 22, this.playerHealth, 10);

    // Ammo
    this.ammoText.setText(`AMMO: ${this.playerAmmo}`);
  }

  updateInventoryUI() {
    // Update slot visuals
    for (let i = 0; i < this.inventorySize; i++) {
      const slot = this.invSlots[i];
      const icon = this.invSlotGraphics[i];
      const itemId = this.inventory[i];

      if (itemId && this.itemDatabase[itemId]) {
        const item = this.itemDatabase[itemId];
        icon.setText(item.icon);
        slot.setFillStyle(0x3a3020);
      } else {
        icon.setText('');
        slot.setFillStyle(0x2a2018);
      }

      // Highlight selected slot
      if (i === this.selectedSlot) {
        slot.setStrokeStyle(3, 0xc4a060);
      } else {
        slot.setStrokeStyle(2, 0x4a3828);
      }
    }

    // Update info panel
    const selectedItemId = this.inventory[this.selectedSlot];
    if (selectedItemId && this.itemDatabase[selectedItemId]) {
      const item = this.itemDatabase[selectedItemId];
      this.invItemName.setText(item.name);
      this.invItemDesc.setText(item.description);
      this.invUseBtn.setVisible(item.type === 'herb' || item.type === 'healing' || item.type === 'ammo');
      this.invDropBtn.setVisible(true);
    } else {
      this.invItemName.setText('Empty Slot');
      this.invItemDesc.setText('Select an item to see details.');
      this.invUseBtn.setVisible(false);
      this.invDropBtn.setVisible(false);
    }
  }

  openInventory() {
    if (this.isTransitioning) return;
    this.inventoryOpen = true;
    this.canMove = false;
    this.invContainer.setVisible(true);
    this.updateInventoryUI();
  }

  closeInventory() {
    this.inventoryOpen = false;
    this.canMove = true;
    this.invContainer.setVisible(false);
  }

  toggleInventory() {
    if (this.inventoryOpen) {
      this.closeInventory();
    } else {
      this.openInventory();
    }
  }

  useSelectedItem() {
    const itemId = this.inventory[this.selectedSlot];
    if (!itemId) return;

    const item = this.itemDatabase[itemId];
    if (!item) return;

    if (item.type === 'herb' || item.type === 'healing') {
      // Heal player
      const oldHealth = this.playerHealth;
      this.playerHealth = Math.min(100, this.playerHealth + item.healAmount);
      const healed = this.playerHealth - oldHealth;

      // Remove item from inventory
      this.inventory.splice(this.selectedSlot, 1);

      this.showMessage(`Used ${item.name}. Restored ${healed} health.`);
      this.updateUI();
      this.updateInventoryUI();

      // Visual feedback
      this.cameras.main.flash(300, 0, 100, 0, true);
    } else if (item.type === 'ammo') {
      // Add ammo
      this.playerAmmo += item.ammoCount || 6;

      // Remove item from inventory
      this.inventory.splice(this.selectedSlot, 1);

      this.showMessage(`Loaded ${item.ammoCount || 6} rounds.`);
      this.updateUI();
      this.updateInventoryUI();
    }

    // Adjust selected slot if needed
    if (this.selectedSlot >= this.inventory.length && this.selectedSlot > 0) {
      this.selectedSlot = this.inventory.length - 1;
    }
  }

  dropSelectedItem() {
    const itemId = this.inventory[this.selectedSlot];
    if (!itemId) return;

    const item = this.itemDatabase[itemId];

    // Remove from inventory
    this.inventory.splice(this.selectedSlot, 1);

    this.showMessage(`Dropped ${item.name}.`);
    this.updateInventoryUI();

    // Adjust selected slot
    if (this.selectedSlot >= this.inventory.length && this.selectedSlot > 0) {
      this.selectedSlot = this.inventory.length - 1;
    }
  }

  navigateInventory(direction) {
    if (direction === 'left') {
      this.selectedSlot = (this.selectedSlot - 1 + this.inventorySize) % this.inventorySize;
    } else if (direction === 'right') {
      this.selectedSlot = (this.selectedSlot + 1) % this.inventorySize;
    } else if (direction === 'up') {
      this.selectedSlot = (this.selectedSlot - 4 + this.inventorySize) % this.inventorySize;
    } else if (direction === 'down') {
      this.selectedSlot = (this.selectedSlot + 4) % this.inventorySize;
    }
    this.updateInventoryUI();
  }

  showMessage(text, duration = 2000) {
    this.messageText.setText(text);
    this.messageText.setAlpha(1);

    this.tweens.add({
      targets: this.messageText,
      alpha: 0,
      delay: duration,
      duration: 500
    });
  }

  showRoomName(name, isSafe) {
    const roomText = this.add.text(this.WORLD.width / 2, 50, name, {
      fontSize: '20px',
      fontFamily: 'serif',
      fill: isSafe ? '#4080ff' : '#aa6666',
      fontStyle: 'italic'
    }).setOrigin(0.5).setDepth(200).setAlpha(0);

    this.tweens.add({
      targets: roomText,
      alpha: 1,
      duration: 500,
      yoyo: true,
      hold: 1500,
      onComplete: () => roomText.destroy()
    });
  }

  // ==========================================
  // INTERACTIONS
  // ==========================================

  handleDoor(player, door) {
    const d = door.doorData;

    // Check if pressing action
    const actionPressed = Phaser.Input.Keyboard.JustDown(this.keys.space) ||
                          (this.touchInput && this.touchInput.actionJustPressed);

    if (!actionPressed || this.isTransitioning) return;

    if (d.locked) {
      if (this.inventory.includes(d.locked)) {
        this.showMessage(`Used ${d.locked} to unlock the door`);
        d.locked = null;
        door.setFillStyle(0x654321);
        // Don't transition yet, let player press again
      } else {
        this.showMessage("It's locked. I need a key.");
      }
    } else {
      this.transitionToRoom(d.toRoom, d.spawnX, d.spawnY, d.spawnAngle);
    }
  }

  handleItem(player, item) {
    const actionPressed = Phaser.Input.Keyboard.JustDown(this.keys.space) ||
                          (this.touchInput && this.touchInput.actionJustPressed);

    if (!actionPressed) return;

    // Check if inventory is full
    if (this.inventory.length >= this.inventorySize) {
      this.showMessage("Inventory is full!");
      return;
    }

    const data = item.itemData;
    this.inventory.push(data.id);
    this.showMessage(`Picked up: ${data.name}`);
    item.destroy();
    this.updateUI();
  }

  handleZombieAttack(player, zombie) {
    if (this.isInvincible) return;

    this.playerHealth -= 10;
    this.isInvincible = true;
    this.updateUI();

    // Flash red
    this.cameras.main.flash(200, 100, 0, 0);

    // Knockback
    const angle = Phaser.Math.Angle.Between(zombie.x, zombie.y, player.x, player.y);
    player.body.setVelocity(
      Math.cos(angle) * 200,
      Math.sin(angle) * 200
    );

    // Invincibility frames
    this.time.delayedCall(1000, () => {
      this.isInvincible = false;
    });

    if (this.playerHealth <= 0) {
      this.gameOver();
    }
  }

  // ==========================================
  // COMBAT
  // ==========================================

  shoot() {
    if (this.playerAmmo <= 0) {
      this.showMessage("No ammo!");
      return;
    }

    this.playerAmmo--;
    this.updateUI();

    // Muzzle flash
    const angle = this.player.rotation - Math.PI / 2;
    const flashX = this.player.x + Math.cos(angle) * 30;
    const flashY = this.player.y + Math.sin(angle) * 30;

    const flash = this.add.circle(flashX, flashY, 10, 0xffff00);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2,
      duration: 100,
      onComplete: () => flash.destroy()
    });

    // Check for zombie hits
    const range = 300;
    const spreadAngle = Phaser.Math.DegToRad(15);

    this.zombies.getChildren().forEach(zombie => {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, zombie.x, zombie.y);
      const angleToZombie = Phaser.Math.Angle.Between(this.player.x, this.player.y, zombie.x, zombie.y);
      const angleDiff = Math.abs(Phaser.Math.Angle.Wrap(angleToZombie - angle));

      if (dist < range && angleDiff < spreadAngle) {
        zombie.health -= 50;

        // Blood effect
        const blood = this.add.circle(zombie.x, zombie.y, 15, 0x880000);
        this.tweens.add({
          targets: blood,
          alpha: 0,
          scale: 2,
          duration: 300,
          onComplete: () => blood.destroy()
        });

        if (zombie.health <= 0) {
          this.zombiesKilled.push(zombie.zombieId);
          zombie.destroy();
          this.showMessage("Zombie killed!");
        }
      }
    });
  }

  // ==========================================
  // TRANSITIONS
  // ==========================================

  transitionToRoom(roomId, spawnX, spawnY, spawnAngle) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    // Store spawn position for next room
    this.spawnX = spawnX;
    this.spawnY = spawnY;
    this.playerAngle = spawnAngle;

    // Fade out
    this.cameras.main.fade(500, 0, 0, 0);

    this.time.delayedCall(500, () => {
      this.currentRoom = roomId;
      this.createRoom(roomId);
      this.cameras.main.fadeIn(500);
      this.isTransitioning = false;
    });
  }

  gameOver() {
    this.canMove = false;
    this.showMessage("YOU DIED", 5000);

    this.cameras.main.fade(2000, 80, 0, 0);

    this.time.delayedCall(3000, () => {
      this.scene.restart({ room: 'start', inventory: [], playerAngle: -90, zombiesKilled: [] });
    });
  }

  // ==========================================
  // UPDATE LOOP
  // ==========================================

  update(time, delta) {
    if (!this.player || this.isTransitioning) return;

    const touch = this.touchInput || {};

    // Inventory toggle (TAB, I, or ESC to close)
    const invTogglePressed = Phaser.Input.Keyboard.JustDown(this.keys.tab) ||
                             Phaser.Input.Keyboard.JustDown(this.keys.i) ||
                             touch.inventoryJustPressed;
    const escPressed = Phaser.Input.Keyboard.JustDown(this.keys.esc);

    if (invTogglePressed) {
      this.toggleInventory();
    } else if (escPressed && this.inventoryOpen) {
      this.closeInventory();
    }

    // Handle inventory navigation when open
    if (this.inventoryOpen) {
      // Navigate with arrows or ZQSD
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left) || Phaser.Input.Keyboard.JustDown(this.keys.q)) {
        this.navigateInventory('left');
      }
      if (Phaser.Input.Keyboard.JustDown(this.cursors.right) || Phaser.Input.Keyboard.JustDown(this.keys.d)) {
        this.navigateInventory('right');
      }
      if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.z)) {
        this.navigateInventory('up');
      }
      if (Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.keys.s)) {
        this.navigateInventory('down');
      }

      // Use item with SPACE
      if (Phaser.Input.Keyboard.JustDown(this.keys.space) || touch.actionJustPressed) {
        this.useSelectedItem();
      }

      // Drop item with X
      if (Phaser.Input.Keyboard.JustDown(this.keys.x) || touch.shootJustPressed) {
        this.dropSelectedItem();
      }

      this.resetTouchJustPressed();
      return; // Don't process movement when inventory is open
    }

    // Normal gameplay when inventory is closed
    if (!this.canMove) {
      this.resetTouchJustPressed();
      return;
    }

    // Tank controls (AZERTY: Z=forward, S=backward, Q=turn left, D=turn right)
    const forward = this.cursors.up.isDown || this.keys.z.isDown || touch.forward;
    const backward = this.cursors.down.isDown || this.keys.s.isDown || touch.backward;
    const turnLeft = this.cursors.left.isDown || this.keys.q.isDown || touch.turnLeft;
    const turnRight = this.cursors.right.isDown || this.keys.d.isDown || touch.turnRight;
    const running = this.keys.shift.isDown || touch.run;
    const shootPressed = Phaser.Input.Keyboard.JustDown(this.keys.x) || touch.shootJustPressed;

    // Rotation (tank turning)
    if (turnLeft) {
      this.playerAngle -= this.config.turnSpeed * delta / 1000;
    }
    if (turnRight) {
      this.playerAngle += this.config.turnSpeed * delta / 1000;
    }
    this.player.rotation = Phaser.Math.DegToRad(this.playerAngle);

    // Movement (forward/backward in facing direction)
    const speed = running ? this.config.playerRunSpeed : this.config.playerSpeed;
    const moveAngle = Phaser.Math.DegToRad(this.playerAngle - 90);

    let vx = 0, vy = 0;
    if (forward) {
      vx = Math.cos(moveAngle) * speed;
      vy = Math.sin(moveAngle) * speed;
    } else if (backward) {
      vx = -Math.cos(moveAngle) * speed * 0.6; // Slower backward
      vy = -Math.sin(moveAngle) * speed * 0.6;
    }

    this.player.body.setVelocity(vx, vy);

    // Shooting
    if (shootPressed) {
      this.shoot();
    }

    // Update zombies AI
    this.updateZombies(delta);

    // Update lighting
    this.updateLighting();

    // Reset touch states
    this.resetTouchJustPressed();
  }

  updateZombies(delta) {
    this.zombies.getChildren().forEach(zombie => {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        zombie.x, zombie.y
      );

      // Check if player is in flashlight cone (zombie can "see" player)
      const angleToPlayer = Phaser.Math.Angle.Between(zombie.x, zombie.y, this.player.x, this.player.y);

      if (dist < 200) {
        // Chase player
        zombie.state = 'chase';
        const speed = this.config.zombieChaseSpeed;
        zombie.body.setVelocity(
          Math.cos(angleToPlayer) * speed,
          Math.sin(angleToPlayer) * speed
        );

        // Face player
        zombie.rotation = angleToPlayer + Math.PI / 2;
      } else if (zombie.state === 'chase' && dist < 300) {
        // Continue chasing if was already chasing
        const speed = this.config.zombieSpeed;
        zombie.body.setVelocity(
          Math.cos(angleToPlayer) * speed,
          Math.sin(angleToPlayer) * speed
        );
      } else {
        // Idle - slow random movement
        zombie.state = 'idle';
        if (Math.random() < 0.01) {
          const randAngle = Math.random() * Math.PI * 2;
          zombie.body.setVelocity(
            Math.cos(randAngle) * 20,
            Math.sin(randAngle) * 20
          );
        }
      }
    });
  }
}

// Phaser config
const config = {
  type: Phaser.AUTO,
  width: 640,
  height: 400,
  parent: 'game',
  backgroundColor: '#0a0808',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: GameScene
};

const game = new Phaser.Game(config);
