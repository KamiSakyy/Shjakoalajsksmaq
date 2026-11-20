import * as THREE from 'three';
import type { Box3 } from './city';
import { worldRng } from './worldgen';
/** Детерминированный поток «roofs»: мир одинаков у всех и при каждом запуске. */
const rnd = worldRng('roofs');

/**
 * Жизнь на крышах. Город теперь можно штурмовать по стенам, и наверху не должно быть
 * пустого бетона: кондиционеры, водяные баки, вентиляция, антенны, солнечные панели
 * и слуховые окна. Всё — инстансами, чтобы не платить за тысячи вызовов отрисовки.
 */
export class RooftopLife {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];

  constructor(scene: THREE.Scene, boxes: Box3[], quality: 'low' | 'high' | 'ultra' = 'ultra') {
    scene.add(this.group);
    const roofCap = quality === 'low' ? 26 : quality === 'high' ? 68 : 116;
    const roofs: Box3[] = [];
    for (const b of boxes) {
      const h = b.max.y - b.min.y;
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (h > 7.5 && h < 95 && w > 7 && d > 7) roofs.push(b);
      if (roofs.length >= roofCap * 3) break;
    }
    // перемешать и оставить нужное число
    for (let i = roofs.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [roofs[i], roofs[j]] = [roofs[j], roofs[i]];
    }
    const chosen = roofs.slice(0, roofCap);

    const acPos: { x: number; y: number; z: number; rot: number }[] = [];
    const tankPos: { x: number; y: number; z: number; s: number }[] = [];
    const ventPos: { x: number; y: number; z: number; h: number }[] = [];
    const antPos: { x: number; y: number; z: number; h: number }[] = [];
    const panelPos: { x: number; y: number; z: number; rot: number }[] = [];
    const hatchPos: { x: number; y: number; z: number; rot: number }[] = [];

    for (const b of chosen) {
      const y = b.max.y;
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const inner = 1.4;
      const rx = (w / 2 - inner), rz = (d / 2 - inner);
      if (rx < 1.2 || rz < 1.2) continue;
      const spot = () => ({
        x: cx + (rnd() * 2 - 1) * rx,
        z: cz + (rnd() * 2 - 1) * rz,
      });
      const n = 2 + ((rnd() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const p = spot();
        const roll = rnd();
        if (roll < 0.4) acPos.push({ ...p, y, rot: rnd() * Math.PI });
        else if (roll < 0.55) tankPos.push({ ...p, y, s: 0.85 + rnd() * 0.35 });
        else if (roll < 0.75) ventPos.push({ ...p, y, h: 0.5 + rnd() * 0.6 });
        else if (roll < 0.88) panelPos.push({ ...p, y, rot: (rnd() - 0.5) * 0.4 });
        else hatchPos.push({ ...p, y, rot: rnd() * Math.PI });
      }
      if (rnd() < 0.5) {
        const p = spot();
        antPos.push({ ...p, y, h: 1.6 + rnd() * 2.6 });
      }
    }

    this.instances(acPos, this.acGeo(), new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.78, metalness: 0.28 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y + 0.42, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1)));

    this.instances(tankPos, this.tankGeo(), new THREE.MeshStandardMaterial({ color: 0x6d6257, roughness: 0.9 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion(), new THREE.Vector3(p.s, p.s, p.s)));

    this.instances(ventPos, this.ventGeo(), new THREE.MeshStandardMaterial({ color: 0x8b9196, roughness: 0.5, metalness: 0.7 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion(), new THREE.Vector3(1, p.h / 0.6, 1)));

    this.instances(antPos, this.antGeo(), new THREE.MeshStandardMaterial({ color: 0x3d4245, roughness: 0.6, metalness: 0.6 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion(), new THREE.Vector3(1, p.h / 2, 1)));

    this.instances(panelPos, this.panelGeo(), new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.22, metalness: 0.75 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y + 0.3, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.36, p.rot, 0)), new THREE.Vector3(1, 1, 1)));

    this.instances(hatchPos, this.hatchGeo(), new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.85 }),
      (m, p) => m.compose(new THREE.Vector3(p.x, p.y + 0.18, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1)));
  }

  private instances<T>(list: T[], geo: THREE.BufferGeometry, mat: THREE.Material, write: (m: THREE.Matrix4, p: T) => void) {
    if (!list.length) { geo.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < list.length; i++) {
      write(m, list[i]);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  private acGeo() {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(1.15, 0.8, 0.95);
    parts.push(body);
    const grill = new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0.04, 0.49);
    parts.push(grill);
    const merged = this.merge(parts);
    return merged;
  }

  private tankGeo() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 14).translate(0, 1.55, 0));
    parts.push(new THREE.ConeGeometry(0.9, 0.4, 14).translate(0, 2.66, 0));
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      parts.push(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6).translate(x, 0.35, z));
    }
    return this.merge(parts);
  }

  private ventGeo() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12).translate(0, 0.3, 0));
    parts.push(new THREE.TorusGeometry(0.33, 0.05, 4, 14).rotateX(Math.PI / 2).translate(0, 0.62, 0));
    return this.merge(parts);
  }

  private antGeo() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.CylinderGeometry(0.045, 0.065, 2, 6).translate(0, 1, 0));
    for (const y of [1.1, 1.5, 1.85]) parts.push(new THREE.BoxGeometry(0.7 - y * 0.15, 0.04, 0.04).translate(0, y, 0));
    return this.merge(parts);
  }

  private panelGeo() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.BoxGeometry(1.7, 0.06, 1.05));
    parts.push(new THREE.BoxGeometry(1.74, 0.1, 0.06).translate(0, -0.08, 0.52));
    parts.push(new THREE.BoxGeometry(1.74, 0.1, 0.06).translate(0, -0.08, -0.52));
    return this.merge(parts);
  }

  private hatchGeo() {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(new THREE.BoxGeometry(1.0, 0.36, 0.86));
    parts.push(new THREE.BoxGeometry(1.06, 0.08, 0.92).translate(0, 0.2, 0));
    return this.merge(parts);
  }

  /** Простое слияние без внешних зависимостей (позиции + нормали + uv). */
  private merge(list: THREE.BufferGeometry[]) {
    const positions: number[] = [];
    const normals: number[] = [];
    for (const g of list) {
      const ng = g.index ? g.toNonIndexed() : g;
      const pos = ng.getAttribute('position');
      const nor = ng.getAttribute('normal');
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      }
      if (ng !== g) ng.dispose();
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.group.remove(m);
    }
    this.meshes.length = 0;
  }
}
