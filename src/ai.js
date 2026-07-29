// AI 차량 컨트롤러: 레이싱 라인 유지, 추월/방어, 연료·타이어 관리(플레이어와 동일 규칙 적용).
export class AIController {
  constructor(vehicle, personality = {}) {
    this.vehicle = vehicle;
    this.aggression = personality.aggression ?? (0.6 + Math.random() * 0.4);
    this.consistency = personality.consistency ?? (0.85 + Math.random() * 0.15);
    this._targetOffset = 0;
    this._retargetTimer = 0;
  }

  update(dt, others) {
    const v = this.vehicle;

    // 코너 예측: 트랙 곡률이 큰 구간에서 감속 (커브 진입 전 lookahead)
    const lookAheadU = (v.u + 0.02) % 1;
    const curvature = estimateCurvature(v.curve, lookAheadU);

    const cornerSeverity = Math.min(1, curvature * 40);

    // 스로틀/브레이크 결정
    const wearPenalty = v.tireHealthPercent < 0.4 ? 0.85 : 1;
    let throttle = (1 - cornerSeverity * 0.7) * this.consistency * wearPenalty;
    let brake = cornerSeverity > 0.55 ? cornerSeverity * 0.8 : 0;

    // 연료 관리: 연료가 매우 부족하면 약간 보수적으로
    if (v.fuelPercent < 0.08) throttle *= 0.9;

    v.throttle = Math.max(0, Math.min(1, throttle));
    v.brakeInput = Math.max(0, Math.min(1, brake));

    // 좌우 오프셋: 레이싱 라인 근처를 유지하되, 근처 차량 있으면 살짝 회피/블로킹
    this._retargetTimer -= dt;
    if (this._retargetTimer <= 0) {
      this._targetOffset = (Math.random() - 0.5) * 2.0;
      this._retargetTimer = 2 + Math.random() * 2;
    }

    let avoidOffset = 0;
    for (const other of others) {
      if (other === v) continue;
      const du = Math.abs(other.u - v.u);
      const close = du < 0.01 || du > 0.99;
      if (close) {
        const diff = v.lateralOffset - other.lateralOffset;
        if (Math.abs(diff) < 3) {
          avoidOffset += Math.sign(diff || 1) * 1.5 * this.aggression;
        }
      }
    }

    const desired = this._targetOffset + avoidOffset;
    const steerToward = (desired - v.lateralOffset) * 0.08;
    v.steer = Math.max(-1, Math.min(1, steerToward));
  }
}

function estimateCurvature(curve, u) {
  const delta = 0.01;
  const t0 = curve.getTangentAt(Math.max(0, u - delta)).normalize();
  const t1 = curve.getTangentAt(Math.min(1, u + delta)).normalize();
  return t0.distanceTo(t1);
}
