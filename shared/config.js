/**
 * Configuration partagée pour tous les prototypes
 */

// Contrôles clavier (codes physiques - compatible AZERTY)
export const KEYS = {
  FORWARD: ['KeyW', 'ArrowUp'],    // Z sur AZERTY
  BACKWARD: ['KeyS', 'ArrowDown'], // S
  LEFT: ['KeyA', 'ArrowLeft'],     // Q sur AZERTY
  RIGHT: ['KeyD', 'ArrowRight'],   // D
  JUMP: ['Space'],
  ACTION: ['KeyE'],                // E sur AZERTY (même position)
  ESCAPE: ['Escape']
};

// Sensibilité souris
export const MOUSE = {
  sensitivity: 0.002,
  invertX: false,  // true = inverser gauche/droite
  invertY: false   // true = inverser haut/bas (style "flight sim")
};

// Physique par défaut
export const PHYSICS = {
  gravity: 9.81,
  playerSpeed: 8,
  jumpForce: 5
};

// Caméra
export const CAMERA = {
  fov: 75,
  near: 0.1,
  far: 1000,
  thirdPerson: {
    distance: 5,
    height: 2,
    pitchMin: -Math.PI / 3,
    pitchMax: Math.PI / 3
  }
};

// Helper: vérifie si une touche est pressée (supporte plusieurs codes)
export function isKeyPressed(keys, keyName) {
  const codes = KEYS[keyName];
  if (!codes) return false;
  return codes.some(code => keys[code]);
}

// Helper: applique la sensibilité et inversion souris
// Par défaut : droite = regarder droite, haut = regarder haut
export function getMouseDelta(movementX, movementY) {
  return {
    x: -movementX * MOUSE.sensitivity * (MOUSE.invertX ? -1 : 1),
    y: movementY * MOUSE.sensitivity * (MOUSE.invertY ? -1 : 1)
  };
}
