// Handles device tilt (gamma) for steering, plus touch pedals as fallback/companion.
export class InputManager {
  constructor() {
    this.steer = 0;      // -1..1
    this.throttle = 0;
    this.brake = 0;

    this.tiltEnabled = false;
    this.calibrationGamma = 0;
    this.rawGamma = 0;
    this.sensitivity = 1.6; // degrees-to-full-lock scaling (lower = twitchier)
    this.maxTiltDeg = 32;

    this._onOrientation = this._onOrientation.bind(this);
  }

  async requestPermissionAndStart() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', this._onOrientation, true);
      this.tiltEnabled = true;
      return true;
    } catch (e) {
      console.warn('Tilt sensor unavailable', e);
      return false;
    }
  }

  stop() {
    window.removeEventListener('deviceorientation', this._onOrientation, true);
    this.tiltEnabled = false;
  }

  calibrate() {
    this.calibrationGamma = this.rawGamma;
  }

  _onOrientation(e) {
    // gamma: left-right tilt in portrait; on many devices landscape uses beta.
    // We support both by picking whichever axis has more variance is not
    // trivial without history, so we default to gamma (portrait-style hold)
    // and fall back to beta if gamma is unavailable.
    let g = e.gamma;
    if (g === null || g === undefined) g = e.beta || 0;
    this.rawGamma = g;
    if (!this.tiltEnabled) return;

    const delta = g - this.calibrationGamma;
    let norm = delta / this.maxTiltDeg;
    norm = Math.max(-1, Math.min(1, norm));
    this.steer = norm;
  }

  // manual steer override (for desktop testing with keyboard) or touch-drag steering
  setManualSteer(v) { this.steer = Math.max(-1, Math.min(1, v)); }
  setThrottle(v) { this.throttle = v; }
  setBrake(v) { this.brake = v; }
}

export function setupTouchControls(inputMgr) {
  const throttleBtn = document.getElementById('throttleBtn');
  const brakeBtn = document.getElementById('brakeBtn');

  const bind = (el, onDown, onUp) => {
    const down = (ev) => { ev.preventDefault(); onDown(); el.classList.add('pressed'); };
    const up = (ev) => { ev.preventDefault(); onUp(); el.classList.remove('pressed'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  };

  bind(throttleBtn, () => inputMgr.setThrottle(1), () => inputMgr.setThrottle(0));
  bind(brakeBtn, () => inputMgr.setBrake(1), () => inputMgr.setBrake(0));

  // Keyboard fallback for desktop testing
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.key] = true; applyKeys(); });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; applyKeys(); });
  function applyKeys() {
    if (keys['ArrowUp'] || keys['w']) inputMgr.setThrottle(1); else if (!('touchstart' in window)) inputMgr.setThrottle(inputMgr.throttle && keys[' '] ? inputMgr.throttle : 0);
    if (keys['ArrowDown'] || keys['s']) inputMgr.setBrake(1); else inputMgr.setBrake(0);
    let steer = 0;
    if (keys['ArrowLeft'] || keys['a']) steer -= 1;
    if (keys['ArrowRight'] || keys['d']) steer += 1;
    if (steer !== 0 || keys['ArrowLeft'] === false) inputMgr.setManualSteer(steer);
  }
}
