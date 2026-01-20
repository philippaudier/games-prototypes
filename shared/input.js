/**
 * Unified input handling for prototypes
 */

export class InputManager {
  constructor() {
    this.keys = {};
    this.mouse = {
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      buttons: {}
    };

    this.setupKeyboard();
    this.setupMouse();
  }

  setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  setupMouse() {
    window.addEventListener('mousemove', (e) => {
      this.mouse.dx = e.movementX;
      this.mouse.dy = e.movementY;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      this.mouse.buttons[e.button] = true;
    });

    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons[e.button] = false;
    });
  }

  isKeyDown(code) {
    return !!this.keys[code];
  }

  isMouseDown(button = 0) {
    return !!this.mouse.buttons[button];
  }

  // Get ZQSD/Arrow direction as a normalized vector (AZERTY - codes physiques)
  getDirection() {
    let x = 0;
    let y = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) y -= 1;    // Z sur AZERTY
    if (this.keys['KeyS'] || this.keys['ArrowDown']) y += 1;  // S
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;  // Q sur AZERTY
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1; // D

    // Normalize
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      x /= len;
      y /= len;
    }

    return { x, y };
  }

  // Reset per-frame values (call at end of game loop)
  resetFrame() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }
}
