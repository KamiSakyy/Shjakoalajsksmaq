import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Footprint = { min: THREE.Vector3; max: THREE.Vector3 };

export function addStreetDetails(group: THREE.Group, buildings: Footprint[], block: number, road: number) {
  const facadeParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const shopParts: THREE.BufferGeometry[] = [];
  const awningParts: THREE.BufferGeometry[] = [];
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 1024; texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d')!;
  const names = ['PACIFIC COFFEE', 'WESTSIDE PHARMACY', 'LUNA HOTEL', 'PALM MARKET', 'AUTO SERVICE', 'SUNSET RECORDS', 'HARBOR DINER', 'PACIFIC POLICE'];
  const backgrounds = ['#3b4944', '#e9e2ca', '#30444c', '#6d5548', '#eee7d6', '#403a3b', '#566355', '#34434c'];
  for (let i = 0; i < 8; i++) {
    const y = i * 64;
    ctx.fillStyle = backgrounds[i]; ctx.fillRect(0, y, 1024, 64);
    ctx.strokeStyle = i % 3 === 1 ? '#7e7766' : '#a8aa92';
    ctx.strokeRect(8, y + 7, 1008, 50);
    ctx.font = '600 30px Arial'; ctx.textAlign = 'center';
    ctx.fillStyle = i % 3 === 1 ? '#4b5548' : '#eee5c9';
    ctx.fillText(names[i], 512, y + 43);
  }
  const signMap = new THREE.CanvasTexture(texCanvas);
  signMap.colorSpace = THREE.SRGBColorSpace;
  signMap.anisotropy = 4;

  function box(list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z); list.push(g);
  }
  buildings.forEach((b, i) => {
    const x = (b.min.x + b.max.x) * 0.5, z = (b.min.z + b.max.z) * 0.5;
    if (Math.hypot(x, z) > 210) return;
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y;
    const signIndex = Math.hypot(x + 117, z + 35) < 5 ? 4 : Math.hypot(x - 39, z + 113) < 5 ? 7 : i % 8;
    // Physical storefronts, window recesses and cornices break up flat facades.
    for (const side of [-1, 1]) {
      const frontZ = z + side * (d / 2 + 0.07);
      const bays = Math.max(1, Math.floor(w / 5));
      const gap = w / bays;
      for (let a = 0; a < bays; a++) {
        const xx = x - w / 2 + gap * (a + 0.5);
        box(glassParts, gap - 0.34, 2.6, 0.045, xx, 1.57, frontZ);
        box(facadeParts, gap - 0.44, 0.06, 0.11, xx, 2.18, frontZ + side * 0.05);
        if (a % 3 === 1) {
          box(facadeParts, 0.059, 2.12, 0.073, xx + 0.53, 1.28, frontZ + side * 0.054);
          box(facadeParts, 0.115, 0.033, 0.15, xx + 0.19, 1.31, frontZ + side * 0.12);
        }
        box(facadeParts, 0.16, 3.25, 0.25, xx - gap / 2, 1.8, frontZ);
        box(facadeParts, 0.065, 2.6, 0.08, xx, 1.57, frontZ + side * 0.04);
      }
      box(facadeParts, w + 0.2, 0.21, 0.42, x, 3.25, frontZ);
      box(facadeParts, w + 0.1, 0.18, 0.35, x, h - 0.13, frontZ);
      for (let y = 7; y < h; y += 3.6) box(facadeParts, w, 0.08, 0.2, x, y, frontZ);
      const awning = new THREE.BoxGeometry(Math.min(w - 0.3, 12), 0.13, 1.5);
      awning.rotateX(side * -0.14);
      awning.translate(x, 3.01, frontZ + side * 0.65);
      awningParts.push(awning);
      const sign = new THREE.PlaneGeometry(Math.min(w - 0.4, 12), 0.74);
      if (side < 0) sign.rotateY(Math.PI);
      sign.translate(x, 3.76, frontZ + side * 0.02);
      const uv = sign.getAttribute('uv');
      for (let p = 0; p < uv.count; p++) uv.setY(p, (7 - signIndex + uv.getY(p)) / 8);
      shopParts.push(sign);
    }
    for (const side of [-1, 1]) {
      const edge = x + side * w / 2;
      box(facadeParts, 0.22, 0.2, d + 0.4, edge, h - 0.13, z);
      for (let y = 3.25; y < h; y += 7.2) box(facadeParts, 0.24, 0.12, d, edge, y, z);
    }
  });

  function merge(parts: THREE.BufferGeometry[], material: THREE.Material) {
    if (!parts.length) return;
    const geometry = mergeGeometries(parts)!;
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    parts.forEach(g => g.dispose());
  }
  merge(facadeParts, new THREE.MeshStandardMaterial({ color: 0xafa898, roughness: 0.88 }));
  merge(glassParts, new THREE.MeshStandardMaterial({ color: 0x3f565b, roughness: 0.21, metalness: 0.35, envMapIntensity: 0.8 }));
  merge(awningParts, new THREE.MeshStandardMaterial({ color: 0x3f554b, roughness: 0.94 }));
  merge(shopParts, new THREE.MeshStandardMaterial({ map: signMap, roughness: 0.8, emissiveMap: signMap, emissive: 0xffffff, emissiveIntensity: 0.13 }));

  const positions: THREE.Vector3[] = [];
  for (let i = -4; i <= 4; i++) for (const side of [-1, 1]) {
    for (const n of [-0.32, 0.32]) {
      positions.push(new THREE.Vector3(side * (road / 2 + 1.8), 0, (i + n) * block));
      positions.push(new THREE.Vector3((i + n) * block, 0, side * (road / 2 + 1.8)));
    }
  }
  const trunk = new THREE.CylinderGeometry(0.13, 0.23, 7.8, 9, 6);
  const tp = trunk.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const t = (tp.getY(i) + 3.9) / 7.8;
    tp.setX(i, tp.getX(i) + t * t * 0.45);
  }
  trunk.translate(0, 3.9, 0);
  trunk.computeVertexNormals();
  const leaves: number[] = [], colors: number[] = [];
  const addTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: THREE.Color) => {
    for (const p of [a, b, c]) { leaves.push(p.x, p.y, p.z); colors.push(tint.r, tint.g, tint.b); }
  };
  for (let f = 0; f < 11; f++) {
    const angle = f / 11 * Math.PI * 2, length = 3.0 + Math.sin(f * 2) * 0.5;
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const cross = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const center = (t: number) => dir.clone().multiplyScalar(t * length)
      .add(new THREE.Vector3(0.45, 7.8 + Math.sin(t * Math.PI) * 1.0 - t * t * 1.55, 0));
    const tint = new THREE.Color([0x596d35, 0x3d5a33, 0x607b3d][f % 3]);
    for (let j = 0; j < 18; j++) {
      const t = j / 18, p = center(t), p2 = center(t + 0.07);
      const width = Math.sin(t * Math.PI) * 0.8 + 0.035;
      for (const side of [-1, 1]) {
        const end = p.clone().addScaledVector(cross, side * width).addScaledVector(dir, 0.3);
        end.y -= 0.18 + t * 0.2;
        addTriangle(p, p2, end, tint);
      }
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(leaves, 3));
  crown.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  crown.computeVertexNormals();
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x73634c, roughness: 1 }), positions.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), positions.length);
  positions.forEach((pos, i) => {
    const scale = 0.87 + (i % 5) * 0.055;
    const mat = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.3), new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(i, mat); crowns.setMatrixAt(i, mat);
  });
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  group.add(trunks, crowns);
  return positions;
}