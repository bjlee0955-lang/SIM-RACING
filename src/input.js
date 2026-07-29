// 자이로(기울기) 조향 + 터치 가속/브레이크 입력 관리
export class InputManager {
  constructor() {
    this.steer = 0;      // -1 ~ 1
    this.throttle = 0;   // 0 ~ 1
    this.brake = 0;      // 0 ~ 1
    this.sensitivity = 1.0;
    this.calibrationBeta = null; // 캘리브레이션 기준 기울기(정면)
    this._rawGamma = 0;

    this._bindTouch();
    this._bindKeyboard();
    this._bindGyro();
  }

  _bindGyro() {
    window.addEventListener('deviceorientation', (e) => {
      // gamma: 좌우 기울기(-90~90), beta는 앞뒤 기울기(참고용)
      if (e.gamma === null) return;
      this._rawGamma = e.gamma;
      const base = this.calibrationBeta ?? 0;
      const value = (e.gamma - base) / 35; // 대략 ±35도를 풀 조향으로 매핑
      this.steer = Math.max(-1, Math.min(1, value * this.sensitivity));
    });
  }

  async requestPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        return res === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true; // 안드로이드/데스크톱은 기본 허용
  }

  calibrate() {
    this.calibrationBeta = this._rawGamma;
  }

  _bindTouch() {
    const gasBtn = document.getElementById('btnGas');
    const brakeBtn = document.getElementById('btnBrake');

    const bind = (el, onDown, onUp) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
      el.addEventListener('mousedown', onDown);
      el.addEventListener('mouseup', onUp);
      el.addEventListener('mouseleave', onUp);
    };

    bind(gasBtn, () => { this.throttle = 1; }, () => { this.throttle = 0; });
    bind(brakeBtn, () => { this.brake = 1; }, () => { this.brake = 0; });
  }

  _bindKeyboard() {
    // 데스크톱 테스트 편의를 위한 키보드 폴백 (자이로 대체: 좌우 화살표)
    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    setInterval(() => {
      if (keys['ArrowUp'] || keys['KeyW']) this.throttle = 1;
      else if (!this._touchGasActive) this.throttle = this.throttle; // no-op, touch handles it

      if (keys['ArrowDown'] || keys['KeyS']) this.brake = 1;

      if (keys['ArrowLeft'] || keys['KeyA']) this.steer = Math.max(-1, this.steer - 0.06);
      else if (keys['ArrowRight'] || keys['KeyD']) this.steer = Math.min(1, this.steer + 0.06);
      else this.steer *= 0.85;

      if (!(keys['ArrowUp'] || keys['KeyW'])) {
        // 키를 뗐을 때만 0으로 (터치와 충돌 방지 위해 별도 플래그 없이 단순 처리)
      }
    }, 16);

    // 키 뗄 때 스로틀/브레이크 리셋 (터치 우선순위 없이 단순 폴백이므로 keyup에서 처리)
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.throttle = 0;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.brake = 0;
    });
  }
}
