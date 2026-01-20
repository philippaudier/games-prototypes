import * as THREE from 'three';
import { KEYS, MOUSE, PHYSICS, CAMERA, isKeyPressed, getMouseDelta } from '@shared';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

// Camera
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far
);
camera.position.set(0, 2, 5);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(20, 20);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x333355,
  roughness: 0.8
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244);
scene.add(grid);

// Player cube
const playerGeometry = new THREE.BoxGeometry(1, 1, 1);
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.position.y = 0.5;
scene.add(player);

// Some obstacles
for (let i = 0; i < 5; i++) {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
  });
  const box = new THREE.Mesh(geometry, material);
  box.position.set(
    (Math.random() - 0.5) * 15,
    1,
    (Math.random() - 0.5) * 15
  );
  scene.add(box);
}

// Input handling
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

// Mouse look
let yaw = 0;
let pitch = 0;

document.addEventListener('click', () => {
  document.body.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    const delta = getMouseDelta(e.movementX, e.movementY);
    yaw += delta.x;
    pitch -= delta.y;
    pitch = Math.max(CAMERA.thirdPerson.pitchMin, Math.min(CAMERA.thirdPerson.pitchMax, pitch));
  }
});

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Game loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Movement (utilise la config partagée)
  const direction = new THREE.Vector3();

  if (isKeyPressed(keys, 'FORWARD')) direction.z -= 1;
  if (isKeyPressed(keys, 'BACKWARD')) direction.z += 1;
  if (isKeyPressed(keys, 'LEFT')) direction.x -= 1;
  if (isKeyPressed(keys, 'RIGHT')) direction.x += 1;

  direction.normalize();
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  player.position.x += direction.x * PHYSICS.playerSpeed * delta;
  player.position.z += direction.z * PHYSICS.playerSpeed * delta;
  player.rotation.y = yaw;

  // Camera follow (third person)
  const camDist = CAMERA.thirdPerson.distance;
  const camHeight = CAMERA.thirdPerson.height;
  camera.position.x = player.position.x + Math.sin(yaw) * camDist;
  camera.position.z = player.position.z + Math.cos(yaw) * camDist;
  camera.position.y = camHeight - pitch * 2;
  camera.lookAt(player.position.x, 1, player.position.z);

  renderer.render(scene, camera);
}

animate();
