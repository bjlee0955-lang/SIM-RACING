import * as THREE from 'three';

// ---------------------------------------------------------------------------
// "Monteverde GP" — an original circuit inspired by classic high-speed European
// F1-style layouts (long straights, chicanes, sweeping Parabolica-like final
// corner). All coordinates are original design, not traced from any real track.
// ---------------------------------------------------------------------------

const CONTROL_POINTS = [
  [0, 0],       // start/finish straight
  [0, -420],
  [70, -520],   // Turn 1 (right, tightening)
  [180, -545],
  [260, -500],
  [300, -420],  // Turn 2 apex
  [300, -300],
  [250, -220],  // Turn 3 (chicane left)
  [270, -160],  // Turn 4 (chicane right)
  [340, -110],
  [430, -110],  // long back straight start
  [560, -110],
  [650, -160],  // Turn 5 (fast right, Parabolica-esque lead-in)
  [680, -260],
  [650, -360],
  [560, -410],  // Turn 6
  [470, -390],
  [420, -320],  // Turn 7 (esses left)
  [430, -240],
  [500, -190],  // Turn 8 (esses right)
  [520, -110],
  [480, -30],   // Turn 9 (hairpin left)
  [390, 10],
  [300, -10],
  [230, -60],   // Turn 10
  [200, -140],
  [150, -180],  // Turn 11
  [70, -160],
  [20, -90],
  [0, -30],
];

// Catmull-Rom closed spline through control points
function buildCurve() {
  const pts = CONTROL_POINTS.map(p => new THREE.Vector3(p[0], 0, p[1]));
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

export class Track {
  constructor() {
    this.curve = buildCurve();
    this.length = this.curve.getLength();
    this.samples = 2000;
    this.width = 14; // meters, track width
    this._buildSamples();
  }

  _buildSamples() {
    // Precompute arclength-uniform samples with position, tangent, normal
    this.points = this.curve.getSpacedPoints(this.samples);
    this.tangents = [];
    for (let i = 0; i < this.points.length; i++) {
      const t = i / (this.points.length - 1);
      this.tangents.push(this.curve.getTangent(t).normalize());
    }
  }

  // Get position/tangent at arclength distance s (meters), wrapping
  getFrameAtDistance(s) {
    let u = (s % this.length) / this.length;
    if (u < 0) u += 1;
    const idx = Math.floor(u * (this.samples - 1));
    const pos = this.points[idx];
    const tan = this.tangents[idx];
    return { pos, tan, idx };
  }

  // Find nearest track distance to a world position (coarse search + refine)
  nearestDistance(pos, hintS = null) {
    let bestI = 0, bestD = Infinity;
    const searchStep = hintS !== null ? 1 : 4;
    let startI = 0, endI = this.points.length;
    if (hintS !== null) {
      const centerU = ((hintS % this.length) + this.length) % this.length / this.length;
      const centerI = Math.floor(centerU * (this.samples - 1));
      startI = centerI - 60;
      endI = centerI + 60;
    }
    for (let i = startI; i < endI; i += searchStep) {
      const idx = ((i % this.points.length) + this.points.length) % this.points.length;
      const d = this.points[idx].distanceToSquared(pos);
      if (d < bestD) { bestD = d; bestI = idx; }
    }
    return (bestI / (this.samples - 1)) * this.length;
  }

  buildMesh() {
    const group = new THREE.Group();

    // Road surface as a ribbon mesh
    const roadVerts = [];
    const roadUVs = [];
    const roadIdx = [];
    const kerbVertsL = [];
    const kerbVertsR = [];

    const halfW = this.width / 2;
    const kerbW = 1.4;

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const tan = this.tangents[i];
      const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const left = p.clone().addScaledVector(normal, halfW);
      const right = p.clone().addScaledVector(normal, -halfW);
      roadVerts.push(left.x, 0.02, left.z, right.x, 0.02, right.z);
      roadUVs.push(0, i * 0.3, 1, i * 0.3);

      const leftKerb = p.clone().addScaledVector(normal, halfW + kerbW);
      const rightKerb = p.clone().addScaledVector(normal, -halfW - kerbW);
      kerbVertsL.push(left.x, 0.025, left.z, leftKerb.x, 0.025, leftKerb.z);
      kerbVertsR.push(right.x, 0.025, right.z, rightKerb.x, 0.025, rightKerb.z);
    }

    const n = this.points.length;
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      roadIdx.push(a, c, b, b, c, d);
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeo.setIndex(roadIdx);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2b2b30, roughness: 0.85, metalness: 0.05,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // Kerbs (red/white striped feel via vertex color segments)
    const makeKerb = (verts, flip) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const idx = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const colors = [];
      for (let i = 0; i < n; i++) {
        const stripe = Math.floor(i / 6) % 2 === 0 ? 1 : 0;
        const col = stripe ? [0.85, 0.1, 0.1] : [0.9, 0.9, 0.9];
        colors.push(...col, ...col);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      return mesh;
    };
    group.add(makeKerb(kerbVertsL, false));
    group.add(makeKerb(kerbVertsR, true));

    // Center dashed line
    const dashGeo = new THREE.BufferGeometry();
    const dashVerts = [];
    for (let i = 0; i < n; i += 2) {
      if (Math.floor(i / 4) % 2 !== 0) continue;
      const p = this.points[i];
      dashVerts.push(p.x, 0.03, p.z);
      const p2 = this.points[Math.min(i + 2, n - 1)];
      dashVerts.push(p2.x, 0.03, p2.z);
    }
    dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(dashVerts, 3));
    const dashMat = new THREE.LineBasicMaterial({ color: 0xdddddd });
    group.add(new THREE.LineSegments(dashGeo, dashMat));

    // Ground plane (grass)
    const groundGeo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f5c34, roughness: 1.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);

    // Barriers (simple tube along track edges, offset)
    const barrierOffset = halfW + kerbW + 3;
    const makeBarrier = (sign) => {
      const barPts = this.points.map((p, i) => {
        const tan = this.tangents[i];
        const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
        return p.clone().addScaledVector(normal, sign * barrierOffset).setY(0.6);
      });
      const curve = new THREE.CatmullRomCurve3(barPts, true);
      const geo = new THREE.TubeGeometry(curve, 400, 0.35, 6, true);
      const mat = new THREE.MeshStandardMaterial({ color: 0xdd2222, roughness: 0.5, metalness: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      return mesh;
    };
    group.add(makeBarrier(1));
    group.add(makeBarrier(-1));

    // Start/finish gantry
    const gantry = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const p1 = new THREE.Mesh(postGeo, postMat); p1.position.set(-halfW - 2, 4, 0);
    const p2 = new THREE.Mesh(postGeo, postMat); p2.position.set(halfW + 2, 4, 0);
    const beamGeo = new THREE.BoxGeometry(this.width + 4, 1, 0.6);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshStandardMaterial({ color: 0x111111 }));
    beam.position.set(0, 7.5, 0);
    gantry.add(p1, p2, beam);
    gantry.castShadow = true;
    group.add(gantry);

    return group;
  }
}
