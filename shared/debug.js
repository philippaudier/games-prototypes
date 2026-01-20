/**
 * Simple debug utilities for prototypes
 */

export class DebugPanel {
  constructor() {
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 4px;
      min-width: 150px;
      z-index: 9999;
    `;
    document.body.appendChild(this.panel);
    this.values = {};
  }

  set(key, value) {
    this.values[key] = value;
    this.render();
  }

  render() {
    this.panel.innerHTML = Object.entries(this.values)
      .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
      .join('<br>');
  }

  destroy() {
    this.panel.remove();
  }
}

export class FPSCounter {
  constructor() {
    this.frames = 0;
    this.fps = 0;
    this.lastTime = performance.now();

    this.element = document.createElement('div');
    this.element.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.5);
      color: #0f0;
      font-family: monospace;
      font-size: 14px;
      padding: 5px 10px;
      border-radius: 4px;
      z-index: 9999;
    `;
    document.body.appendChild(this.element);

    this.update();
  }

  update() {
    this.frames++;
    const now = performance.now();

    if (now - this.lastTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastTime = now;
      this.element.textContent = `FPS: ${this.fps}`;
    }

    requestAnimationFrame(() => this.update());
  }

  destroy() {
    this.element.remove();
  }
}

// Quick logging with timestamps
export function log(...args) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}]`, ...args);
}
