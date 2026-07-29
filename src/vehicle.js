import * as THREE from 'three';

// 트랙 진행 파라미터(u: 0~1)를 기준으로 한 차량 상태 + 물리 업데이트.
// 자세한 3D 강체 물리 대신, 심레이싱 "느낌"을 내는 아케이드-시뮬 하이브리드 모델.

export class Vehicle {
  constructor({ car, tire, fuelLiters, curve, isPlayer = false, mesh }) {
    this.car = car;
    this.tire = tire;
    this.curve = curve;
    this.isPlayer = isPlayer;
    this.mesh = mesh;

    this.fuel = fuelLiters;          // liters 남은 연료
    this.fuelStart = fuelLiters;
    this.tireWear = 0;               // 0~1 (1 = 완전 마모)

    this.u = 0;                     // 트랙 진행률 0~1 (누적하지 않고 lap마다 리셋)
    this.lapDistance = 0;            // 이번 랩 누적 거리
    this.totalDistance = 0;
    this.lateralOffset = 0;          // 트랙 중심 기준 좌우 오프셋 (-halfWidth ~ +halfWidth)
    this.lateralVel = 0;

    this.speed = 0;                  // km/h
    this.speedMs = 0;                // m/s
    this.rpm = 1000;
    this.gear = 1;

    this.throttle = 0;               // 0~1
    this.brakeInput = 0;             // 0~1
    this.steer = 0;                  // -1~1

    this.lap = 1;
    this.lapTime = 0;
    this.bestLap = null;
    this.lastLapTime = null;
    this.finished = false;

    this.collisionCooldown = 0;
    this.offTrackTimer = 0;

    // 캐시된 트랙 길이 (근사)
    this._trackLength = this._estimateTrackLength();
  }

  _estimateTrackLength() {
    const pts = this.curve.getSpacedPoints(300);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    return len;
  }

  get weight() {
    // 연료 1L ≈ 0.75kg 근사
    return this.car.baseWeight + this.fuel * 0.75;
  }

  get weightRatio() {
    // 풀연료 대비 현재 무게 비율 (가벼울수록 <1)
    const fullWeight = this.car.baseWeight + this.fuelStart * 0.75;
    return this.weight / fullWeight;
  }

  get tireGripMultiplier() {
    // 마모 진행에 따른 그립 감소 (약 3랩 체감 밸런스는 외부 wear rate로 조정)
    const wearPenalty = 1 - this.tireWear * 0.55;
    return this.tire.grip * Math.max(0.35, wearPenalty);
  }

  get fuelPercent() {
    return Math.max(0, this.fuel / this.fuelStart);
  }

  get tireHealthPercent() {
    return Math.max(0, 1 - this.tireWear);
  }

  // dt: seconds
  update(dt, trackHalfWidth) {
    if (this.finished) return;

    const car = this.car;
    const weightRatio = this.weightRatio; // >1 = 무거움
    const grip = this.tireGripMultiplier;

    // ---- 종방향 (가속/제동) ----
    const weightPenalty = 1 + (weightRatio - 1) * car.weightPenalty * 1.6;
    const accelForce = (this.throttle > 0 ? this.throttle : 0) * car.accel * 10.5 / weightPenalty;
    const brakeForce = (this.brakeInput > 0 ? this.brakeInput : 0) * car.brake * 16 / Math.sqrt(weightPenalty);
    const drag = 0.0022 * this.speedMs * this.speedMs;
    const rolling = 0.6;

    let accel = accelForce - drag - rolling;
    if (this.brakeInput > 0.02) accel = -brakeForce - drag;

    this.speedMs = Math.max(0, this.speedMs + accel * dt);
    const maxSpeedMs = (car.maxSpeed / weightPenalty) / 3.6 * (0.85 + 0.15 * grip);
    if (this.speedMs > maxSpeedMs) this.speedMs = Math.max(maxSpeedMs, this.speedMs - 8 * dt);
    this.speed = this.speedMs * 3.6;

    // ---- 연료 소비: 가속(스로틀) 시간에 비례, 브레이크/코스팅은 거의 없음 ----
    if (this.throttle > 0.05) {
      const consumption = this.throttle * 0.0028 * dt * 60; // L per update scaled
      this.fuel = Math.max(0, this.fuel - consumption);
    }

    // ---- 타이어 마모: 주행거리보다 부하(가속/제동/코너링/슬립) 기반 ----
    const lateralLoad = Math.abs(this.steer) * (this.speedMs / 40);
    const brakeLoad = this.brakeInput * (this.speedMs / 50);
    const accelLoad = this.throttle * (this.speedMs / 60);
    const slipLoad = this._slip || 0;
    const wearThisFrame =
      (accelLoad * 0.5 + brakeLoad * 0.8 + lateralLoad * 0.9 + slipLoad * 1.2) *
      this.tire.wearRate * 0.010 * dt * 60;
    this.tireWear = Math.min(1, this.tireWear + wearThisFrame);

    // ---- 횡방향 (조향) ----
    const steerAuthority = 2.6 * grip / Math.sqrt(weightPenalty);
    const speedFactor = Math.min(1, this.speedMs / 8); // 저속에서 조향 민감도 축소
    this.lateralVel += this.steer * steerAuthority * speedFactor * dt * 6;
    this.lateralVel *= 0.86; // 감쇠(그립 복원)

    // 슬립 추정(고속 + 급조향)
    this._slip = Math.max(0, Math.abs(this.steer) * (this.speedMs / 30) - grip * 0.6);

    this.lateralOffset += this.lateralVel * dt * 10;

    // 트랙 이탈 체크
    const limit = trackHalfWidth - 1.2;
    if (Math.abs(this.lateralOffset) > limit) {
      this.lateralOffset = THREE.MathUtils.clamp(this.lateralOffset, -limit, limit);
      this.lateralVel *= -0.3;
      this.speedMs *= 0.985; // 오프트랙 저항
      this.offTrackTimer += dt;
    } else {
      this.offTrackTimer = 0;
    }

    // ---- 진행률 갱신 ----
    const distDelta = this.speedMs * dt;
    this.lapDistance += distDelta;
    this.totalDistance += distDelta;
    this.u = (this.lapDistance / this._trackLength) % 1;

    if (this.lapDistance >= this._trackLength) {
      this._completeLap();
    }

    this.lapTime += dt * 1000;

    // ---- RPM/기어 (시각/사운드용 근사) ----
    const gearCount = 6;
    const gearRatioSpeed = car.maxSpeed / gearCount;
    this.gear = Math.min(gearCount, Math.max(1, Math.ceil(this.speed / gearRatioSpeed)));
    const gearFloor = (this.gear - 1) * gearRatioSpeed;
    const gearSpan = gearRatioSpeed;
    const withinGear = THREE.MathUtils.clamp((this.speed - gearFloor) / gearSpan, 0, 1);
    this.rpm = 1200 + withinGear * 6800;

    if (this.collisionCooldown > 0) this.collisionCooldown -= dt;
  }

  _completeLap() {
    this.lapDistance -= this._trackLength;
    this.lastLapTime = this.lapTime;
    if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
    this.lapTime = 0;
    this.lap += 1;
  }

  getWorldTransform(trackHalfWidth) {
    const p = this.curve.getPointAt(this.u);
    const tangent = this.curve.getTangentAt(this.u).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    if (side.lengthSq() < 0.0001) side = new THREE.Vector3(1, 0, 0);
    const pos = p.clone().add(side.clone().multiplyScalar(this.lateralOffset));
    pos.y += 0.4;
    const yaw = Math.atan2(tangent.x, tangent.z);
    const steerVisual = THREE.MathUtils.clamp(this.lateralVel * 0.3, -0.35, 0.35);
    return { position: pos, yaw: yaw + steerVisual };
  }
}

export function formatTime(ms) {
  if (ms === null || ms === undefined) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msPart = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`;
}
