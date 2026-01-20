import * as THREE from 'three';
import { PHYSICS, CAMERA, isKeyPressed, getMouseDelta } from '@shared';

// ===========================================
// GAME CONFIG
// ===========================================
const CONFIG = {
  playerSpeed: PHYSICS.playerSpeed,
  jumpForce: PHYSICS.jumpForce,
  doubleJumpForce: PHYSICS.jumpForce * 0.85,
  gravity: PHYSICS.gravity,
  wallJumpForceY: PHYSICS.jumpForce * 0.9,
  wallJumpForceX: 6,
  wallSlideSpeed: 2,
  wallJumpLockTime: 0.15,
  coyoteTime: 0.08,
  jumpBufferTime: 0.1
};

// ===========================================
// SCENE SETUP
// ===========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 15, 60);

// Camera
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far
);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;
scene.add(directionalLight);

// ===========================================
// GAME STATE
// ===========================================
let currentLevel = 1;
let playerHealth = 3;
let maxHealth = 3;
let hasKey = false;
let isInvincible = false;
let invincibleTimer = 0;
let gameOver = false;

// ===========================================
// PLAYER PHYSICS STATE
// ===========================================
const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.6;
const GROUND_Y = 0.8;

let velocityY = 0;
let velocityX = 0;
let velocityZ = 0;
let isGrounded = true;
let canDoubleJump = true;
let hasDoubleJumped = false;
let coyoteTimer = 0;
let jumpBufferTimer = 0;

// Wall jump state
let isTouchingWall = false;
let wallNormal = new THREE.Vector3();
let wallJumpLockTimer = 0;
let wallSliding = false;

// ===========================================
// LEVEL GEOMETRY
// ===========================================
const platforms = [];
const walls = [];
const enemies = [];
let keyObject = null;
let doorObject = null;
let doorPlatform = null;

// Ground
const groundGeometry = new THREE.PlaneGeometry(50, 50);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x333355,
  roughness: 0.8
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.userData.isGround = true;
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(50, 50, 0x444466, 0x222244);
scene.add(grid);

// Player
const playerGeometry = new THREE.CapsuleGeometry(PLAYER_RADIUS, 1, 4, 8);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.position.set(-20, GROUND_Y, -20);
player.castShadow = true;
scene.add(player);

// ===========================================
// LEVEL GENERATION
// ===========================================
function clearLevel() {
  // Remove old platforms
  platforms.forEach(p => scene.remove(p));
  platforms.length = 0;

  // Remove old walls
  walls.forEach(w => scene.remove(w));
  walls.length = 0;

  // Remove old enemies
  enemies.forEach(e => scene.remove(e));
  enemies.length = 0;

  // Remove key and door
  if (keyObject) scene.remove(keyObject);
  if (doorObject) scene.remove(doorObject);
  if (doorPlatform) scene.remove(doorPlatform);

  keyObject = null;
  doorObject = null;
  doorPlatform = null;
}

function createPlatform(x, y, z, width, depth, color = 0x4a4a6a) {
  const geometry = new THREE.BoxGeometry(width, 0.3, depth);
  const material = new THREE.MeshStandardMaterial({ color });
  const platform = new THREE.Mesh(geometry, material);
  platform.position.set(x, y, z);
  platform.castShadow = true;
  platform.receiveShadow = true;
  platform.userData.isPlatform = true;
  platform.userData.width = width;
  platform.userData.depth = depth;
  scene.add(platform);
  platforms.push(platform);
  return platform;
}

function createWall(x, y, z, width, height, depth, color = 0x3a3a5a) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({ color });
  const wall = new THREE.Mesh(geometry, material);
  wall.position.set(x, y, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.userData.isWall = true;
  wall.userData.width = width;
  wall.userData.height = height;
  wall.userData.depth = depth;
  scene.add(wall);
  walls.push(wall);
  return wall;
}

function createEnemy(x, y, z, patrolAxis, patrolMin, patrolMax) {
  const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  const enemy = new THREE.Mesh(geometry, material);
  enemy.position.set(x, y, z);
  enemy.castShadow = true;
  enemy.userData.patrolAxis = patrolAxis; // 'x' or 'z'
  enemy.userData.patrolMin = patrolMin;
  enemy.userData.patrolMax = patrolMax;
  enemy.userData.speed = 3 + currentLevel * 0.5;
  enemy.userData.direction = 1;
  scene.add(enemy);
  enemies.push(enemy);
  return enemy;
}

function createKey(x, y, z) {
  const group = new THREE.Group();

  // Key body
  const bodyGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8);
  const keyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.8,
    roughness: 0.2
  });
  const body = new THREE.Mesh(bodyGeometry, keyMaterial);
  body.rotation.z = Math.PI / 2;
  group.add(body);

  // Key head (ring)
  const ringGeometry = new THREE.TorusGeometry(0.2, 0.05, 8, 16);
  const ring = new THREE.Mesh(ringGeometry, keyMaterial);
  ring.position.x = -0.35;
  ring.rotation.y = Math.PI / 2;
  group.add(ring);

  group.position.set(x, y, z);
  group.userData.isKey = true;
  scene.add(group);
  return group;
}

function createDoor(x, y, z) {
  const group = new THREE.Group();

  // Door frame
  const frameGeometry = new THREE.BoxGeometry(1.5, 2.5, 0.3);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  group.add(frame);

  // Door surface
  const doorGeometry = new THREE.BoxGeometry(1.2, 2.2, 0.2);
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x884422 });
  const door = new THREE.Mesh(doorGeometry, doorMaterial);
  door.position.z = 0.1;
  door.userData.doorSurface = true;
  group.add(door);

  group.position.set(x, y, z);
  group.userData.isDoor = true;
  group.userData.locked = true;
  scene.add(group);
  return group;
}

function generateLevel() {
  clearLevel();

  // Seed random for level
  const seed = currentLevel * 12345;
  const random = (min, max) => {
    const x = Math.sin(seed + platforms.length + walls.length + enemies.length) * 10000;
    return min + (x - Math.floor(x)) * (max - min);
  };

  // Arena walls (for wall jumping)
  createWall(-24, 5, 0, 1, 10, 40);   // Left wall
  createWall(24, 5, 0, 1, 10, 40);    // Right wall
  createWall(0, 5, -24, 48, 10, 1);   // Back wall
  createWall(0, 5, 24, 48, 10, 1);    // Front wall

  // Generate platforms based on level
  const numPlatforms = 6 + Math.floor(currentLevel * 1.5);

  for (let i = 0; i < numPlatforms; i++) {
    const x = random(-18, 18);
    const z = random(-18, 18);
    const y = 1 + random(0, 6 + currentLevel * 0.5);
    const width = random(2, 5);
    const depth = random(2, 5);

    // Avoid spawning too close to player start
    if (Math.abs(x + 20) < 5 && Math.abs(z + 20) < 5) continue;

    createPlatform(x, y, z, width, depth);
  }

  // Add some vertical wall sections for wall jumping
  const numWallSections = 2 + Math.floor(currentLevel / 2);
  for (let i = 0; i < numWallSections; i++) {
    const x = random(-15, 15);
    const z = random(-15, 15);
    const height = random(4, 8);
    createWall(x, height / 2, z, 1, height, 1, 0x5a4a7a);
  }

  // Create enemies
  const numEnemies = Math.min(2 + currentLevel, 8);
  for (let i = 0; i < numEnemies; i++) {
    const onGround = random(0, 1) > 0.4;

    if (onGround) {
      const x = random(-15, 15);
      const z = random(-15, 15);
      const axis = random(0, 1) > 0.5 ? 'x' : 'z';
      const min = axis === 'x' ? x - 5 : z - 5;
      const max = axis === 'x' ? x + 5 : z + 5;
      createEnemy(x, 0.4, z, axis, min, max);
    } else if (platforms.length > 0) {
      // Enemy on platform
      const plat = platforms[Math.floor(random(0, platforms.length - 0.01))];
      const axis = random(0, 1) > 0.5 ? 'x' : 'z';
      const halfSize = axis === 'x' ? plat.userData.width / 2 - 0.5 : plat.userData.depth / 2 - 0.5;
      createEnemy(
        plat.position.x,
        plat.position.y + 0.55,
        plat.position.z,
        axis,
        (axis === 'x' ? plat.position.x : plat.position.z) - halfSize,
        (axis === 'x' ? plat.position.x : plat.position.z) + halfSize
      );
    }
  }

  // Create key on a high platform or create a new high platform for it
  const keyPlatform = createPlatform(
    random(-10, 10),
    5 + currentLevel * 0.5,
    random(-10, 10),
    3, 3, 0x4a6a4a
  );
  keyObject = createKey(keyPlatform.position.x, keyPlatform.position.y + 0.8, keyPlatform.position.z);

  // Create door on opposite side
  doorPlatform = createPlatform(20, 2, -20, 4, 4, 0x6a4a4a);
  doorObject = createDoor(20, 3.4, -20);

  // Reset player
  player.position.set(-20, GROUND_Y, -20);
  velocityX = 0;
  velocityY = 0;
  velocityZ = 0;
  hasKey = false;

  updateUI();
}

// ===========================================
// COLLISION DETECTION
// ===========================================
function checkGroundCollision(x, y, z) {
  // Check ground
  if (y <= GROUND_Y) {
    return { grounded: true, y: GROUND_Y };
  }

  // Check platforms
  for (const platform of platforms) {
    const halfW = platform.userData.width / 2;
    const halfD = platform.userData.depth / 2;
    const platTop = platform.position.y + 0.15;
    const platBottom = platform.position.y - 0.15;

    const playerBottom = y - PLAYER_HEIGHT / 2;
    const prevBottom = player.position.y - PLAYER_HEIGHT / 2;

    // Check if player is above platform and within XZ bounds
    if (x > platform.position.x - halfW - PLAYER_RADIUS &&
        x < platform.position.x + halfW + PLAYER_RADIUS &&
        z > platform.position.z - halfD - PLAYER_RADIUS &&
        z < platform.position.z + halfD + PLAYER_RADIUS) {

      // Landing on top (was above, now at or below top)
      if (prevBottom >= platTop - 0.1 && playerBottom <= platTop && velocityY <= 0) {
        return { grounded: true, y: platTop + PLAYER_HEIGHT / 2 };
      }
    }
  }

  return { grounded: false, y };
}

function checkWallCollision(x, z, velocityDir) {
  const result = { blocked: false, slideX: x, slideZ: z, wallNormal: null };

  // Check arena walls
  if (x < -23 + PLAYER_RADIUS) {
    result.blocked = true;
    result.slideX = -23 + PLAYER_RADIUS;
    result.wallNormal = new THREE.Vector3(1, 0, 0);
  }
  if (x > 23 - PLAYER_RADIUS) {
    result.blocked = true;
    result.slideX = 23 - PLAYER_RADIUS;
    result.wallNormal = new THREE.Vector3(-1, 0, 0);
  }
  if (z < -23 + PLAYER_RADIUS) {
    result.blocked = true;
    result.slideZ = -23 + PLAYER_RADIUS;
    result.wallNormal = new THREE.Vector3(0, 0, 1);
  }
  if (z > 23 - PLAYER_RADIUS) {
    result.blocked = true;
    result.slideZ = 23 - PLAYER_RADIUS;
    result.wallNormal = new THREE.Vector3(0, 0, -1);
  }

  // Check wall objects
  for (const wall of walls) {
    const halfW = wall.userData.width / 2;
    const halfH = wall.userData.height / 2;
    const halfD = wall.userData.depth / 2;

    // Check if player height overlaps wall
    const playerBottom = player.position.y - PLAYER_HEIGHT / 2;
    const playerTop = player.position.y + PLAYER_HEIGHT / 2;
    const wallBottom = wall.position.y - halfH;
    const wallTop = wall.position.y + halfH;

    if (playerBottom < wallTop && playerTop > wallBottom) {
      // AABB collision
      const dx = x - wall.position.x;
      const dz = z - wall.position.z;

      const overlapX = halfW + PLAYER_RADIUS - Math.abs(dx);
      const overlapZ = halfD + PLAYER_RADIUS - Math.abs(dz);

      if (overlapX > 0 && overlapZ > 0) {
        result.blocked = true;

        // Push out in the smallest overlap direction
        if (overlapX < overlapZ) {
          result.slideX = wall.position.x + (dx > 0 ? 1 : -1) * (halfW + PLAYER_RADIUS);
          result.wallNormal = new THREE.Vector3(dx > 0 ? 1 : -1, 0, 0);
        } else {
          result.slideZ = wall.position.z + (dz > 0 ? 1 : -1) * (halfD + PLAYER_RADIUS);
          result.wallNormal = new THREE.Vector3(0, 0, dz > 0 ? 1 : -1);
        }
      }
    }
  }

  return result;
}

function checkEnemyCollision() {
  if (isInvincible) return;

  for (const enemy of enemies) {
    const dx = player.position.x - enemy.position.x;
    const dy = player.position.y - enemy.position.y;
    const dz = player.position.z - enemy.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < PLAYER_RADIUS + 0.5) {
      // Check if stomping (player above and moving down)
      if (dy > 0.3 && velocityY < 0) {
        // Kill enemy
        scene.remove(enemy);
        enemies.splice(enemies.indexOf(enemy), 1);
        velocityY = CONFIG.jumpForce * 0.6; // Bounce
      } else {
        takeDamage();
      }
      return;
    }
  }
}

function checkKeyCollision() {
  if (!keyObject || hasKey) return;

  const dx = player.position.x - keyObject.position.x;
  const dy = player.position.y - keyObject.position.y;
  const dz = player.position.z - keyObject.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < PLAYER_RADIUS + 0.5) {
    hasKey = true;
    scene.remove(keyObject);
    keyObject = null;

    // Unlock door (change color)
    if (doorObject) {
      doorObject.userData.locked = false;
      doorObject.children[1].material.color.setHex(0x00cc66);
    }

    updateUI();
  }
}

function checkDoorCollision() {
  if (!doorObject || !hasKey || doorObject.userData.locked) return;

  const dx = player.position.x - doorObject.position.x;
  const dy = player.position.y - doorObject.position.y;
  const dz = player.position.z - doorObject.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < PLAYER_RADIUS + 1) {
    // Next level!
    currentLevel++;
    generateLevel();
  }
}

// ===========================================
// DAMAGE SYSTEM
// ===========================================
function takeDamage() {
  if (isInvincible || gameOver) return;

  playerHealth--;
  updateUI();

  if (playerHealth <= 0) {
    gameOver = true;
    updateUI();
    return;
  }

  // Invincibility frames
  isInvincible = true;
  invincibleTimer = 1.5;

  // Knockback
  velocityY = CONFIG.jumpForce * 0.5;
}

function restartGame() {
  currentLevel = 1;
  playerHealth = 3;
  maxHealth = 3;
  hasKey = false;
  isInvincible = false;
  gameOver = false;
  generateLevel();
}

// ===========================================
// UI
// ===========================================
let uiContainer;

function createUI() {
  uiContainer = document.createElement('div');
  uiContainer.style.cssText = `
    position: fixed;
    top: 20px;
    left: 20px;
    color: white;
    font-family: monospace;
    font-size: 18px;
    text-shadow: 2px 2px 4px black;
    pointer-events: none;
    z-index: 100;
  `;
  document.body.appendChild(uiContainer);
}

function updateUI() {
  const hearts = '❤️'.repeat(playerHealth) + '🖤'.repeat(Math.max(0, maxHealth - playerHealth));
  const keyStatus = hasKey ? '🔑 ✅' : '🔑 ❌';

  let html = `
    <div>Niveau ${currentLevel}</div>
    <div>${hearts}</div>
    <div>${keyStatus}</div>
  `;

  if (gameOver) {
    html += `
      <div style="margin-top: 20px; color: #ff4444; font-size: 24px;">GAME OVER</div>
      <div style="font-size: 14px;">Appuie sur R pour recommencer</div>
    `;
  }

  uiContainer.innerHTML = html;
}

function createControlsHelp() {
  const help = document.createElement('div');
  help.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    color: #666;
    font-family: monospace;
    font-size: 12px;
    text-align: center;
    pointer-events: none;
    z-index: 100;
  `;
  help.innerHTML = 'ZQSD: Move | ESPACE: Jump/Double Jump | Murs: Wall Jump | R: Restart';
  document.body.appendChild(help);
}

// ===========================================
// INPUT
// ===========================================
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') {
    restartGame();
  }
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

// Track jump press for buffer
let jumpJustPressed = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    jumpJustPressed = true;
  }
});

// Mouse look
let yaw = 0;
let pitch = 0;

document.addEventListener('click', () => {
  if (!gameOver) {
    document.body.requestPointerLock();
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    const delta = getMouseDelta(e.movementX, e.movementY);
    yaw += delta.x;
    pitch -= delta.y;
    pitch = Math.max(CAMERA.thirdPerson.pitchMin, Math.min(CAMERA.thirdPerson.pitchMax, pitch));
  }
});

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ===========================================
// GAME LOOP
// ===========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  if (gameOver) {
    renderer.render(scene, camera);
    return;
  }

  // Update invincibility
  if (isInvincible) {
    invincibleTimer -= delta;
    if (invincibleTimer <= 0) {
      isInvincible = false;
    }
    // Flash effect
    player.visible = Math.floor(invincibleTimer * 10) % 2 === 0;
  } else {
    player.visible = true;
  }

  // Update wall jump lock
  if (wallJumpLockTimer > 0) {
    wallJumpLockTimer -= delta;
  }

  // Coyote time
  if (isGrounded) {
    coyoteTimer = CONFIG.coyoteTime;
  } else {
    coyoteTimer -= delta;
  }

  // Jump buffer
  if (jumpJustPressed) {
    jumpBufferTimer = CONFIG.jumpBufferTime;
    jumpJustPressed = false;
  } else {
    jumpBufferTimer -= delta;
  }

  // Check if we want to jump
  const wantsToJump = jumpBufferTimer > 0;

  // Grounded jump
  if (wantsToJump && coyoteTimer > 0) {
    velocityY = CONFIG.jumpForce;
    isGrounded = false;
    coyoteTimer = 0;
    jumpBufferTimer = 0;
    canDoubleJump = true;
    hasDoubleJumped = false;
  }
  // Wall jump
  else if (wantsToJump && isTouchingWall && !isGrounded) {
    velocityY = CONFIG.wallJumpForceY;
    // Push away from wall
    velocityX = wallNormal.x * CONFIG.wallJumpForceX;
    velocityZ = wallNormal.z * CONFIG.wallJumpForceX;
    wallJumpLockTimer = CONFIG.wallJumpLockTime;
    jumpBufferTimer = 0;
    canDoubleJump = true;
    hasDoubleJumped = false;
  }
  // Double jump
  else if (wantsToJump && canDoubleJump && !hasDoubleJumped && !isGrounded && coyoteTimer <= 0) {
    velocityY = CONFIG.doubleJumpForce;
    jumpBufferTimer = 0;
    hasDoubleJumped = true;
    canDoubleJump = false;
  }

  // Apply gravity
  velocityY -= CONFIG.gravity * delta;

  // Wall slide
  wallSliding = false;
  if (isTouchingWall && !isGrounded && velocityY < 0) {
    velocityY = Math.max(velocityY, -CONFIG.wallSlideSpeed);
    wallSliding = true;
  }

  // Movement input
  const direction = new THREE.Vector3();

  if (wallJumpLockTimer <= 0) {
    if (isKeyPressed(keys, 'FORWARD')) direction.z -= 1;
    if (isKeyPressed(keys, 'BACKWARD')) direction.z += 1;
    if (isKeyPressed(keys, 'LEFT')) direction.x -= 1;
    if (isKeyPressed(keys, 'RIGHT')) direction.x += 1;

    direction.normalize();
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // Apply horizontal movement
    velocityX = direction.x * CONFIG.playerSpeed;
    velocityZ = direction.z * CONFIG.playerSpeed;
  } else {
    // During wall jump lock, decay horizontal velocity
    velocityX *= 0.95;
    velocityZ *= 0.95;
  }

  // Calculate new position
  let newX = player.position.x + velocityX * delta;
  let newY = player.position.y + velocityY * delta;
  let newZ = player.position.z + velocityZ * delta;

  // Wall collision
  const wallResult = checkWallCollision(newX, newZ, direction);
  isTouchingWall = wallResult.blocked;
  if (wallResult.blocked) {
    newX = wallResult.slideX;
    newZ = wallResult.slideZ;
    if (wallResult.wallNormal) {
      wallNormal.copy(wallResult.wallNormal);
    }
  }

  // Ground/platform collision
  const groundResult = checkGroundCollision(newX, newY, newZ);
  if (groundResult.grounded) {
    newY = groundResult.y;
    velocityY = 0;
    isGrounded = true;
    canDoubleJump = true;
    hasDoubleJumped = false;
  } else {
    isGrounded = false;
  }

  // Death pit
  if (newY < -10) {
    takeDamage();
    player.position.set(-20, GROUND_Y, -20);
    velocityX = 0;
    velocityY = 0;
    velocityZ = 0;
    return;
  }

  // Apply position
  player.position.set(newX, newY, newZ);
  player.rotation.y = yaw;

  // Check collisions
  checkEnemyCollision();
  checkKeyCollision();
  checkDoorCollision();

  // Update enemies (patrol)
  enemies.forEach(enemy => {
    const axis = enemy.userData.patrolAxis;
    const pos = axis === 'x' ? enemy.position.x : enemy.position.z;
    const min = enemy.userData.patrolMin;
    const max = enemy.userData.patrolMax;

    if (pos <= min) enemy.userData.direction = 1;
    if (pos >= max) enemy.userData.direction = -1;

    const move = enemy.userData.speed * enemy.userData.direction * delta;
    if (axis === 'x') {
      enemy.position.x += move;
    } else {
      enemy.position.z += move;
    }

    // Rotate enemy to face movement direction
    enemy.rotation.y += delta * 2;
  });

  // Animate key
  if (keyObject) {
    keyObject.rotation.y += delta * 2;
    keyObject.position.y += Math.sin(Date.now() * 0.003) * 0.003;
  }

  // Player color based on state
  if (wallSliding) {
    playerMaterial.color.setHex(0x00ccaa); // Cyan = wall sliding
  } else if (hasDoubleJumped) {
    playerMaterial.color.setHex(0x88cc44); // Yellow-green = double jumped
  } else {
    playerMaterial.color.setHex(0x00ff88); // Green = normal
  }

  // Third person camera (follows player height)
  const camDist = CAMERA.thirdPerson.distance;
  const camHeight = CAMERA.thirdPerson.height;
  camera.position.x = player.position.x + Math.sin(yaw) * camDist;
  camera.position.z = player.position.z + Math.cos(yaw) * camDist;
  camera.position.y = player.position.y + camHeight - pitch * 2;
  camera.lookAt(player.position.x, player.position.y, player.position.z);

  renderer.render(scene, camera);
}

// ===========================================
// START GAME
// ===========================================
createUI();
createControlsHelp();
generateLevel();
animate();
