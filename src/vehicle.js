import * as THREE from 'three';

// Build a stylized-but-decent-looking GT3 car mesh procedurally
export function buildCarMesh(spec) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: spec.color, metalness: 0.6, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: spec.accent, metalness: 0.3, roughness: 0.4 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0e12, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.85, transmission: 0.3 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.9, roughness: 0.3 });

  // Main body hull: a side-profile shape (X = across car width isn't used here;
  // shape is drawn in the car's side view: shapeX -> world Z (length),
  // shapeY -> world Y (height)), then extruded along world X for width.
  const carLength = 4.3;
  const halfLen = carLength / 2;
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-halfLen, 0.05);
  hullShape.lineTo(-halfLen + 0.3, 0.45);
  hullShape.lineTo(-halfLen * 0.5, 0.72);
  hullShape.lineTo(halfLen * 0.15, 0.76);
  hullShape.lineTo(halfLen * 0.75, 0.42);
  hullShape.lineTo(halfLen, 0.18);
  hullShape.lineTo(halfLen, 0.05);
  hullShape.lineTo(-halfLen, 0.05);
  const extrudeSettings = { depth: 1.8, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, steps: 1 };
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, extrudeSettings);
  // extrude local axes: X,Y = shape plane, Z = depth (width of car).
  // Rotate so shape's X (length) -> world Z, extrude depth (width) -> world X.
  hullGeo.rotateY(Math.PI / 2);
  hullGeo.translate(0, 0, -extrudeSettings.depth / 2); // center width on car's local X=0
  const hull = new THREE.Mesh(hullGeo, bodyMat);
  hull.castShadow = true; hull.receiveShadow = true;
  group.add(hull);

  // Cabin/greenhouse
  const cabinGeo = new THREE.BoxGeometry(1.05, 0.42, 1.9);
  cabinGeo.translate(0, 0.78, -0.15);
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.castShadow = true;
  group.add(cabin);

  // Front splitter
  const splitterGeo = new THREE.BoxGeometry(1.5, 0.06, 0.4);
  const splitter = new THREE.Mesh(splitterGeo, accentMat);
  splitter.position.set(0, 0.18, 2.15);
  splitter.castShadow = true;
  group.add(splitter);

  // Rear wing
  const wingPostGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06);
  const wingPostL = new THREE.Mesh(wingPostGeo, accentMat);
  wingPostL.position.set(-0.55, 0.75, -2.05);
  const wingPostR = wingPostL.clone(); wingPostR.position.x = 0.55;
  const wingGeo = new THREE.BoxGeometry(1.4, 0.06, 0.42);
  const wing = new THREE.Mesh(wingGeo, accentMat);
  wing.position.set(0, 0.95, -2.05);
  wing.castShadow = true;
  group.add(wingPostL, wingPostR, wing);

  // Headlights
  const lightGeo = new THREE.BoxGeometry(0.22, 0.1, 0.05);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 1.2 });
  const lightL = new THREE.Mesh(lightGeo, lightMat); lightL.position.set(-0.55, 0.42, 2.28);
  const lightR = lightL.clone(); lightR.position.x = 0.55;
  group.add(lightL, lightR);

  // Taillights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.8 });
  const tailGeo = new THREE.BoxGeometry(0.28, 0.1, 0.05);
  const tailL = new THREE.Mesh(tailGeo, tailMat); tailL.position.set(-0.55, 0.5, -2.2);
  const tailR = tailL.clone(); tailR.position.x = 0.55;
  group.add(tailL, tailR);

  // Wheels
  const wheelGroup = new THREE.Group();
  const wheelPositions = [
    [-0.85, 0.38, 1.45], [0.85, 0.38, 1.45], // front L/R
    [-0.85, 0.38, -1.45], [0.85, 0.38, -1.45], // rear L/R
  ];
  const wheels = [];
  wheelPositions.forEach(([x, y, z], i) => {
    const wheel = new THREE.Group();
    const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 16);
    tireGeo.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(tire, rim);
    wheel.position.set(x, y, z);
    wheelGroup.add(wheel);
    wheels.push(wheel);
  });
  group.add(wheelGroup);

  group.scale.set(1, 1, 1);
  return { group, wheels, tireMat, bodyMat };
}

const G = 9.81;
const AIR_DENSITY = 1.225;

export class Vehicle {
  constructor(spec, isPlayer = false) {
    this.spec = spec;
    this.isPlayer = isPlayer;

    // physics state (along-track coordinate model: s = distance, n = lateral offset)
    this.s = 0;            // distance along track centerline (m)
    this.n = 0;             // lateral offset from centerline (m), + = left
    this.heading = 0;       // yaw relative to track tangent (rad)
    this.speed = 0;         // m/s forward
    this.lateralVel = 0;

    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;         // -1..1

    this.gear = 1;
    this.rpm = 1000;

    this.fuel = spec.fuelCapacity;
    this.tireWear = 0;      // 0..1 (1 = fully worn)
    this.lap = 1;
    this.lapTime = 0;
    this.bestLap = null;
    this.lastLapTime = null;
    this.finished = false;
    this.raceTime = 0;
    this.qualyTime = null;

    this.collisionCooldown = 0;
    this.offTrackTime = 0;
  }

  get gripFactor() {
    // grip degrades as tires wear; steep after ~3 laps of race stint
    const wearPenalty = 1 - this.tireWear * 0.55;
    return this.spec.grip * wearPenalty;
  }

  get massTotal() {
    // fuel adds mass: ~0.75 kg per liter
    return this.spec.mass + this.fuel * 0.75;
  }

  get fuelPct() { return Math.max(0, this.fuel / this.spec.fuelCapacity); }
  get tireGripPct() { return Math.max(0, 1 - this.tireWear); }

  // Advance physics by dt seconds; trackLength for wrap
  update(dt, track) {
    const spec = this.spec;
    const mass = this.massTotal;

    // Engine force model
    const maxPower = spec.power * 735.5; // hp to watts
    const speedForPower = Math.max(this.speed, 4);
    let engineForce = this.throttle > 0 ? (maxPower / speedForPower) * this.throttle : 0;
    engineForce = Math.min(engineForce, spec.mass * 9.0); // traction-limited accel cap

    // Mass penalty: heavier car (more fuel) accelerates slower
    const massAccelFactor = spec.mass / mass;
    engineForce *= massAccelFactor;

    // Brake force
    const brakeForce = this.brake * spec.brakeForce * mass * 11.0;

    // Aero drag
    const dragCoef = 0.9;
    const frontalArea = 1.9;
    const drag = 0.5 * AIR_DENSITY * dragCoef * frontalArea * this.speed * this.speed;

    // Rolling resistance (scaled by tire wear — worn tires = slightly more resistance, less grip)
    const rolling = 0.02 * mass * G;

    let netForce = engineForce - drag - rolling;
    if (this.brake > 0) netForce -= brakeForce;

    let accel = netForce / mass;
    if (this.speed <= 0.05 && accel < 0 && this.throttle === 0) accel = 0;

    this.speed += accel * dt;
    if (this.speed < 0) this.speed = 0;

    // Steering -> lateral dynamics with grip-limited cornering
    const grip = this.gripFactor;
    const maxLateralAccel = 11.5 * grip; // m/s^2 grip ceiling
    const steerInput = this.steer; // -1..1

    // yaw rate proportional to steer & speed, saturated by grip
    const speedFactor = Math.min(this.speed / 30, 1.4);
    let desiredYawRate = steerInput * 1.8 * speedFactor;
    // reduce authority at low speed (parking) and cap by grip at high speed
    const gripCap = this.speed > 1 ? maxLateralAccel / Math.max(this.speed, 1) : 999;
    desiredYawRate = THREE.MathUtils.clamp(desiredYawRate, -gripCap, gripCap);

    this.heading += desiredYawRate * dt;
    // self-centering damping
    this.heading *= (1 - 0.5 * dt);

    // Move along track: forward progress + lateral drift from heading
    const forwardDist = this.speed * dt;
    this.s += forwardDist * Math.cos(this.heading);
    this.n += forwardDist * Math.sin(this.heading) + steerInput * this.speed * dt * 0.15;

    // clamp lateral offset to track width (soft wall)
    const halfW = track.width / 2 - 1.0;
    if (Math.abs(this.n) > halfW) {
      this.n = THREE.MathUtils.clamp(this.n, -halfW, halfW);
      this.speed *= 0.985; // scrub speed off-line
      this.offTrackTime += dt;
    } else {
      this.offTrackTime = 0;
    }

    // Fuel consumption proportional to throttle & speed
    if (this.throttle > 0) {
      const kmMoved = forwardDist / 1000;
      this.fuel -= kmMoved * spec.fuelConsumption * (0.6 + 0.4 * this.throttle);
      this.fuel = Math.max(0, this.fuel);
    }

    // Tire wear: scales with speed, lateral load (cornering), and braking.
    // Tuned so a race-paced stint (~65-70s/lap) wears tires out by lap 3.
    const corneringLoad = Math.abs(steerInput) * (this.speed / 40);
    const brakingLoad = this.brake * 0.5;
    const wearRate = 0.0024 * (0.4 + corneringLoad + brakingLoad) * (this.speed > 3 ? 1 : 0.2);
    this.tireWear = Math.min(1, this.tireWear + wearRate * dt * 3.0);

    // out of fuel -> engine cuts
    if (this.fuel <= 0) {
      this.throttle = 0;
    }

    // gear/rpm cosmetic simulation
    const gearRatios = [0, 3.6, 2.5, 1.8, 1.35, 1.05, 0.85];
    const speedKmh = this.speed * 3.6;
    let g = 1;
    for (let i = 1; i <= 6; i++) {
      if (speedKmh > i * 42) g = i;
    }
    this.gear = Math.max(1, Math.min(6, g));
    this.rpm = 1000 + (speedKmh % 42) / 42 * 6500;

    this.lapTime += dt;
    this.raceTime += dt;
  }

  crossFinishLine() {
    this.lastLapTime = this.lapTime;
    if (this.bestLap === null || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
    this.lapTime = 0;
    this.lap += 1;
  }
}
