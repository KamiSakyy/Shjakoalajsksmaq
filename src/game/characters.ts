import * as THREE from 'three';
import { ASSETS } from '../assets';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type CharacterKind = 'human' | 'zombie' | 'officer';
export type BodyPart = 'head' | 'torso' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR';
export interface CharacterRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  parts: Record<BodyPart, THREE.Group>;
}

export const woundMaterial = new THREE.MeshStandardMaterial({ color: 0x54282a, roughness: 0.57 });
export const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xbdb49b, roughness: 0.8 });
const geometries = new Map<string, THREE.BufferGeometry>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let textile: THREE.CanvasTexture | null = null;
let skinMap: THREE.Texture | null = null;
let infectedMap: THREE.Texture | null = null;
let skinNormal: THREE.Texture | null = null;
let scannedHead: THREE.BufferGeometry | null = null;
let preload: Promise<void> | null = null;
const awaitingHeads = new Set<() => void>();

function fabric() {
  if (textile) return textile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e7e5de';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = y % 4 ? '#d1cfc9' : '#dedbd4';
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 3) {
    ctx.fillStyle = 'rgba(98,91,81,0.14)';
    ctx.fillRect(x, 0, 1, 128);
  }
  textile = new THREE.CanvasTexture(c);
  textile.wrapS = textile.wrapT = THREE.RepeatWrapping;
  textile.repeat.set(3, 3);
  textile.colorSpace = THREE.SRGBColorSpace;
  return textile;
}

function material(color: number, cloth = false, metal = false) {
  const key = `${color}:${cloth}:${metal}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: metal ? 0.42 : cloth ? 0.96 : 0.7,
      metalness: metal ? 0.7 : 0,
      map: cloth ? fabric() : null,
      bumpMap: cloth ? fabric() : null, bumpScale: cloth ? 0.002 : 0,
      envMapIntensity: 0.35,
    }));
  }
  return materials.get(key)!;
}

function ellipsoid() {
  if (!geometries.has('sphere')) geometries.set('sphere', new THREE.SphereGeometry(1, 16, 12));
  return geometries.get('sphere')!;
}

function rounded(w: number, h: number, d: number, radius = 0.015) {
  const key = `box:${w}:${h}:${d}:${radius}`;
  if (!geometries.has(key)) geometries.set(key, new RoundedBoxGeometry(w, h, d, 2, radius));
  return geometries.get(key)!;
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material,
  pos: [number, number, number], scale?: [number, number, number]) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  m.castShadow = !scale || Math.max(...scale) > 0.075;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// All meshes inside a joint move together. Merge matching materials, not the joints.
function batchRigidGroup(parent: THREE.Object3D) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...parent.children]) {
    if ((child as THREE.Mesh).isMesh && !Array.isArray((child as THREE.Mesh).material)) {
      const m = child as THREE.Mesh;
      const mat = m.material as THREE.Material;
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat)!.push(m);
    }
  }
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const parts = meshes.map(m => {
      m.updateMatrix();
      const copy = m.geometry.clone();
      const geometry = copy.index ? copy.toNonIndexed() : copy;
      if (geometry !== copy) copy.dispose();
      return geometry.applyMatrix4(m.matrix);
    });
    const geometry = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, mat);
    merged.castShadow = meshes.some(m => m.castShadow);
    merged.receiveShadow = true;
    for (const m of meshes) parent.remove(m);
    parent.add(merged);
  }
}

// Elliptical cross-sections give shoulders, waist and limbs an anatomical silhouette.
function loft(key: string, rings: [number, number, number][], segments = 14) {
  if (geometries.has(key)) return geometries.get(key)!;
  const curve = new THREE.CatmullRomCurve3(rings.map(([y, x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  rings = curve.getPoints(key === 'torso' ? 19 : 10).map(p => [p.y, Math.max(0, p.x), Math.max(0, p.z)]);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  rings.forEach(([y, rx, rz], row) => {
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      positions.push(Math.cos(a) * rx, y, Math.sin(a) * rz);
      uvs.push(i / segments, row / (rings.length - 1));
      if (row < rings.length - 1 && i < segments) {
        const p = row * (segments + 1) + i;
        indices.push(p, p + segments + 1, p + 1, p + 1, p + segments + 1, p + segments + 2);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  geometries.set(key, g);
  return g;
}

export function preloadCharacterAssets(): Promise<void> {
  if (preload) return preload;
  // Сканированная голова (head.glb) не входит в одиночную сборку: если файла
  // нет, остаётся процедурная модель — preload никогда не блокирует запуск.
  const headModel: Promise<{ scene: THREE.Object3D } | null> = Promise.resolve(null);
  preload = Promise.all([
    headModel,
    new THREE.TextureLoader().loadAsync(ASSETS.skin),
    new THREE.TextureLoader().loadAsync(ASSETS.skinNormal).catch(() => null),
  ]).then(([gltf, map, normal]) => {
    if (!gltf) { awaitingHeads.clear(); return; }
    const source0 = gltf as { scene: THREE.Object3D };
    const original = (source0 as unknown as THREE.Mesh).geometry;
    const g = original.clone();
    const p = g.getAttribute('position');
    const originalIndices = g.index!;
    const indices: number[] = [];
    for (let i = 0; i < originalIndices.count; i += 3) {
      const a = originalIndices.getX(i), b = originalIndices.getX(i + 1), c = originalIndices.getX(i + 2);
      if (Math.min(p.getY(a), p.getY(b), p.getY(c)) > -1.1) indices.push(a, b, c);
    }
    // The licensed scan includes a bust. Keep the head, with its base inside the collar.
    g.setIndex(indices);
    g.translate(0.08, 1.1, -0.15);
    g.scale(0.061, 0.061, 0.056);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    scannedHead = g;
    skinMap = map;
    skinMap.flipY = true;
    skinMap.colorSpace = THREE.SRGBColorSpace;
    skinMap.anisotropy = 4;
    skinNormal = normal;
    if (skinNormal) { skinNormal.flipY = true; skinNormal.colorSpace = THREE.NoColorSpace; }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.filter = 'saturate(0.22) brightness(0.86)';
    ctx.drawImage(map.image, 0, 0, 512, 512);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(61,74,49,0.13)';
    ctx.fillRect(0, 0, 512, 512);
    infectedMap = new THREE.CanvasTexture(canvas);
    infectedMap.flipY = true;
    infectedMap.colorSpace = THREE.SRGBColorSpace;
    for (const mount of awaitingHeads) mount();
    awaitingHeads.clear();
  }).catch(() => {
    // The fully modelled fallback remains visible if an asset cannot be loaded.
    awaitingHeads.clear();
  });
  return preload;
}

function addHead(parent: THREE.Group, kind: CharacterKind, skin: THREE.Material, variation: number) {
  const lod = new THREE.LOD();
  lod.name = 'face-lod';
  parent.add(lod);
  const fallback = new THREE.Group();
  fallback.name = 'face-fallback';
  mesh(fallback, ellipsoid(), skin, [0, 0.175, 0], [0.103, 0.137, 0.105]);
  mesh(fallback, ellipsoid(), skin, [0, 0.095, 0.027], [0.078, 0.068, 0.077]);
  mesh(fallback, ellipsoid(), skin, [0, 0.167, 0.102], [0.018, 0.032, 0.026]);
  const eye = material(kind === 'zombie' ? 0xa29d7a : 0xddd5be);
  for (const sign of [-1, 1]) {
    mesh(fallback, ellipsoid(), skin, [sign * 0.103, 0.164, 0], [0.019, 0.035, 0.017]);
    mesh(fallback, ellipsoid(), material(0x5b4940), [sign * 0.04, 0.194, 0.094], [0.025, 0.011, 0.013]);
    mesh(fallback, ellipsoid(), eye, [sign * 0.04, 0.19, 0.103], [0.015, 0.006, 0.006]);
    mesh(fallback, ellipsoid(), material(0x303025), [sign * 0.04, 0.19, 0.108], [0.004, 0.005, 0.002]);
  }
  mesh(fallback, rounded(0.044, 0.008, 0.008, 0.003), material(0x6b4942), [0, 0.113, 0.095]);
  batchRigidGroup(fallback);
  lod.addLevel(fallback, 0);

  const mountScan = () => {
    if (!scannedHead || !skinMap) return;
    const key = `face:${kind}:${variation % 3}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        map: kind === 'zombie' ? infectedMap : skinMap,
        normalMap: skinNormal, normalScale: new THREE.Vector2(0.65, 0.65),
        color: kind === 'zombie' ? 0xc3c8ac : [0xffffff, 0xe4c7ae, 0xd8aa88][variation % 3],
        roughness: kind === 'zombie' ? 0.88 : 0.72,
        metalness: 0, envMapIntensity: 0.28,
      });
      materials.set(key, mat);
    }
    const face = new THREE.Mesh(scannedHead, mat);
    face.name = 'scanned-face';
    face.castShadow = face.receiveShadow = true;
    face.scale.x = 0.96 + (variation % 3) * 0.04;
    lod.remove(fallback);
    lod.levels.length = 0;
    const fullHead = new THREE.Group();
    fullHead.add(face);
    for (const sign of [-1, 1]) {
      mesh(fullHead, ellipsoid(), material(kind === 'zombie' ? 0xb5b5a3 : 0xc4c2ae),
        [sign * 0.025, 0.177, 0.0935], [0.010, 0.0055, 0.006]);
      mesh(fullHead, ellipsoid(), material(kind === 'zombie' ? 0x697568 : 0x566453),
        [sign * 0.025, 0.177, 0.099], [0.0038, 0.004, 0.001]);
      mesh(fullHead, ellipsoid(), material(0x202725),
        [sign * 0.025, 0.177, 0.1001], [0.0019, 0.0024, 0.0006]);
    }
    batchRigidGroup(fullHead);
    lod.addLevel(fullHead, 0);
    lod.addLevel(fallback, 15);
  };
  if (scannedHead) mountScan();
  else awaitingHeads.add(mountScan);

  if (kind === 'officer') {
    mesh(parent, ellipsoid(), material(0x19212a, true), [0, 0.307, -0.006], [0.111, 0.03, 0.108]);
    mesh(parent, rounded(0.17, 0.012, 0.106, 0.018), material(0x121920), [0, 0.3, 0.105]);
    mesh(parent, ellipsoid(), material(0xb6a475, false, true), [0, 0.319, 0.102], [0.011, 0.015, 0.003]);
  } else if (variation % 4 !== 0) {
    if (!geometries.has('hair-cap')) geometries.set('hair-cap', new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.43));
    mesh(parent, geometries.get('hair-cap')!, material([0x312b25, 0x483a2c, 0x595147][variation % 3]),
      [0, 0.212, -0.012], [0.097, 0.102, 0.102]);
  }
}

export function createCharacter(kind: CharacterKind, variant = 'normal', seed = Math.floor(Math.random() * 1000)): CharacterRig {
  const root = new THREE.Group();
  root.name = `character-${kind}`;
  const hips = new THREE.Group(), torso = new THREE.Group(), neck = new THREE.Group(), head = new THREE.Group();
  hips.name = 'hips'; torso.name = 'torso'; neck.name = 'neck'; head.name = 'head';
  hips.position.y = 1.0;
  root.add(hips);
  hips.add(torso);
  neck.position.y = 0.54;
  // A single rooted chain is essential: root > hips > torso > neck > head.
  torso.add(neck);
  neck.add(head);
  const zombie = kind === 'zombie';
  const skin = material(zombie ? 0x9a9980 : [0xc7a183, 0xaa7f60, 0xb8886b][seed % 3]);
  const shirt = material(kind === 'officer' ? 0x303f4d : [0x555e52, 0x8c7c68, 0x4b5c68, 0x77655b, 0x3d4141][seed % 5], true);
  const trousers = material(kind === 'officer' ? 0x25313e : [0x35424b, 0x4a4841, 0x393f42][seed % 3], true);
  const leather = material(0x242526);
  const torsoMesh = mesh(torso, loft('torso', [[0, 0.15, 0.1], [0.1, 0.17, 0.115], [0.28, 0.21, 0.128],
    [0.43, 0.221, 0.118], [0.49, 0.182, 0.09], [0.53, 0.074, 0.062], [0.535, 0, 0]]), shirt, [0, 0, 0]);
  torsoMesh.scale.x = variant === 'brute' ? 1.25 : 1;
  mesh(hips, rounded(0.32, 0.17, 0.22, 0.05), trousers, [0, -0.018, 0]);
  mesh(torso, rounded(0.32, 0.035, 0.228, 0.014), leather, [0, 0.024, 0]);
  mesh(torso, rounded(0.043, 0.033, 0.014, 0.004), material(0x85847c, false, true), [0, 0.024, 0.119]);
  mesh(neck, ellipsoid(), skin, [0, 0.025, -0.008], [0.052, 0.08, 0.049]);
  addHead(head, kind, skin, seed);

  const mkLimb = (name: string, length: number, top: number, bottom: number, mat: THREE.Material) => {
    const group = new THREE.Group();
    group.name = name;
    mesh(group, loft(`limb:${length}:${top}:${bottom}`, [[-length, bottom * 0.8, bottom * 0.7],
      [-length * 0.87, bottom, bottom * 0.88], [-length * 0.42, top * 0.95, top * 0.88],
      [-length * 0.15, top, top * 0.9], [0, top * 0.77, top * 0.72], [0.006, 0, 0]]), mat, [0, 0, 0]);
    return group;
  };
  const armL = mkLimb('armL', 0.3, 0.075, 0.054, shirt);
  const armR = mkLimb('armR', 0.3, 0.075, 0.054, shirt);
  const foreL = mkLimb('foreL', 0.28, 0.057, 0.036, kind === 'officer' ? shirt : skin);
  const foreR = mkLimb('foreR', 0.28, 0.057, 0.036, kind === 'officer' ? shirt : skin);
  const thighL = mkLimb('thighL', 0.45, 0.096, 0.068, trousers);
  const thighR = mkLimb('thighR', 0.45, 0.096, 0.068, trousers);
  const shinL = mkLimb('shinL', 0.43, 0.072, 0.048, trousers);
  const shinR = mkLimb('shinR', 0.43, 0.072, 0.048, trousers);
  armL.position.set(-0.213, 0.46, 0); armR.position.set(0.213, 0.46, 0);
  foreL.position.y = foreR.position.y = -0.3;
  thighL.position.set(-0.095, -0.065, 0); thighR.position.set(0.095, -0.065, 0);
  shinL.position.y = shinR.position.y = -0.45;
  torso.add(armL, armR); armL.add(foreL); armR.add(foreR);
  hips.add(thighL, thighR); thighL.add(shinL); thighR.add(shinR);
  for (const fore of [foreL, foreR]) {
    mesh(fore, ellipsoid(), kind === 'officer' ? shirt : skin, [0, -0.006, 0], [0.049, 0.045, 0.044]);
    mesh(fore, ellipsoid(), skin, [0, -0.305, 0.009], [0.035, 0.052, 0.021]);
    for (let i = 0; i < 4; i++) mesh(fore, ellipsoid(), skin,
      [-0.023 + i * 0.015, -0.346, 0.006], [0.008, 0.023, 0.009]);
  }
  for (const shin of [shinL, shinR]) {
    mesh(shin, ellipsoid(), trousers, [0, 0, 0], [0.067, 0.05, 0.057]);
    mesh(shin, rounded(0.114, 0.092, 0.236, 0.033), leather, [0, -0.427, 0.05]);
    mesh(shin, rounded(0.116, 0.025, 0.238, 0.009), material(0x353333), [0, -0.461, 0.05]);
  }
  for (const sx of [-1, 1]) {
    const collar = mesh(torso, rounded(0.075, 0.09, 0.018, 0.009), shirt, [sx * 0.064, 0.465, 0.075]);
    collar.rotation.z = sx * 0.35;
    mesh(torso, rounded(0.087, 0.095, 0.014, 0.009), shirt, [sx * 0.115, 0.328, 0.128]);
  }
  mesh(torso, rounded(0.012, 0.39, 0.01, 0.003), material(0x5b5b51), [0, 0.26, 0.129]);
  if (kind === 'officer') {
    mesh(torso, rounded(0.348, 0.32, 0.075, 0.035), material(0x232c30, true), [0, 0.31, 0.119]);
    for (const sx of [-1, 1]) {
      mesh(torso, rounded(0.065, 0.38, 0.04, 0.01), material(0x303c42), [sx * 0.13, 0.3, 0.153]);
      mesh(torso, rounded(0.068, 0.11, 0.045, 0.008), leather, [sx * 0.17, 0.04, 0.11]);
    }
    mesh(torso, ellipsoid(), material(0xbaa975, false, true), [-0.077, 0.395, 0.162], [0.02, 0.028, 0.004]);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128; labelCanvas.height = 32;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = '#263136'; ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#c8ccbb'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText('POLICE', 64, 25);
    const label = new THREE.CanvasTexture(labelCanvas);
    label.colorSpace = THREE.SRGBColorSpace;
    mesh(torso, new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshStandardMaterial({ map: label, roughness: 0.9 }), [0, 0.285, 0.16]);
    mesh(foreR, rounded(0.04, 0.052, 0.16, 0.007), material(0x1c2023, false, true), [0, -0.337, 0.06]);
  } else if (zombie) {
    for (let i = 0; i < 3; i++) {
      const patch = mesh(torso, ellipsoid(), woundMaterial,
        [Math.sin(seed + i * 2.5) * 0.13, 0.15 + i * 0.1, 0.129], [0.022 + i * 0.008, 0.032, 0.003]);
      patch.rotation.z = i * 0.8;
    }
  }
  armL.rotation.z = 0.045; armR.rotation.z = -0.045;
  foreL.rotation.x = foreR.rotation.x = -0.08;
  for (const joint of [hips, torso, neck, head, armL, armR, foreL, foreR, thighL, thighR, shinL, shinR]) batchRigidGroup(joint);
  return { root, hips, torso, neck, head, parts: { head, torso, armL, armR, foreL, foreR, thighL, thighR, shinL, shinR } };
}