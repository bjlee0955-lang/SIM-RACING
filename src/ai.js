// Simple AI driver: targets a racing line offset and throttle/brake based on
// upcoming curvature, with some per-driver skill variance.
export class AIDriver {
  constructor(vehicle, track, skill = 1.0) {
    this.vehicle = vehicle;
    this.track = track;
    this.skill = skill; // 0.85 - 1.05 typical
    this.targetN = (Math.random() - 0.5) * 2; // slight lane preference
    this.reactionOffset = Math.random() * 0.4;
  }

  update(dt) {
    const v = this.vehicle;
    const track = this.track;

    // Sample curvature ahead to decide braking/throttle
    const lookahead = 25 + v.speed * 0.9;
    const { tan: tanNow } = track.getFrameAtDistance(v.s);
    const { tan: tanAhead } = track.getFrameAtDistance(v.s + lookahead);
    const angleDiff = Math.atan2(
      tanNow.x * tanAhead.z - tanNow.z * tanAhead.x,
      tanNow.x * tanAhead.x + tanNow.z * tanAhead.z
    );
    const curvature = Math.abs(angleDiff);

    // steer toward centerline (targetN) with a lane bias
    const lateralError = this.targetN - v.n;
    v.steer = clamp(lateralError * 0.25 - angleDiff * 1.6, -1, 1);

    // speed target based on curvature (tighter corner = slower)
    const maxCornerSpeed = this.skill * (28 / (1 + curvature * 9));
    const desiredSpeed = Math.min(v.spec.topSpeed / 3.6 * this.skill, Math.max(maxCornerSpeed, 14));

    const speedKmh = v.speed;
    if (v.speed < desiredSpeed - 1) {
      v.throttle = 1;
      v.brake = 0;
    } else if (v.speed > desiredSpeed + 1) {
      v.throttle = 0;
      v.brake = clamp((v.speed - desiredSpeed) / 10, 0.2, 1);
    } else {
      v.throttle = 0.6;
      v.brake = 0;
    }

    // fuel-out handling
    if (v.fuel <= 0) v.throttle = 0;
  }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
