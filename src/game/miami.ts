import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS } from './city-plan';
import { BEACH_START, ISLAND, CAUSEWAY_Z, OCEAN_DRIVE, shoreX } from './ocean';
import type { Box3, Circle } from './city';
import { worldRng } from './worldgen';
import { markDynamic } from './optimize';
/** Детерминированный поток «miami»: мир одинаков у всех и при каждом запуске. */
const rnd = worldRng('miami');

/**
 * Майами-Бич: Ocean Drive, арт-деко отели, променад, пальмы, спасательные
 * вышки, зонты, марина с яхтами, остров-миллионер с дамбой, неоновые вывески
 * и сверхвысокие башни даунтауна. Всё сведено в несколько merged-мешей,
 * повторяющиеся объекты — InstancedMesh, чтобы Android не тонул в draw calls.
 */

export interface CityHooks {
  colliders: Circle[];
  boxes: Box3[];
  spawnPoints: THREE.Vector3[];
  treeCaps: { a: THREE.Vector3; b: THREE.Vector3; r: number }[];
}

export const BRIDGE_Y = 1.65;

/** Высота покрытия дамбы/острова; используется физикой города. */
export function bridgeY(x: number, z: number) {
  const onCauseway = x > BOUNDS - 6 && x < ISLAND.x + 40 && Math.abs(z - CAUSEWAY_Z) < 9.5;
  if (onCauseway) return BRIDGE_Y;
  const d = Math.hypot((x - ISLAND.x) / ISLAND.rx, (z - ISLAND.z) / ISLAND.rz);
  if (d < 1.0) return BRIDGE_Y + 0.2;
  return null;
}

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture(text: string, bg: string, glow: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = glow; ctx.lineWidth = 6; ctx.strokeRect(10, 10, 492, 108);
  ctx.font = '900 66px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = glow; ctx.shadowBlur = 26;
  ctx.fillStyle = glow;
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const DECO = [0xf2d7c4, 0xd8e6e3, 0xf7e2a8, 0xe9c7d8, 0xc7dcd0, 0xf0b7a4, 0xdfe3ef];
const HOTEL_NAMES = ['OCEAN', 'MARLIN', 'DELANO', 'AVALON', 'CLEVELANDER', 'TIDES', 'BEACON', 'CARLYLE', 'SURFCOMBER', 'PELICAN', 'COLONY', 'RALEIGH'];
const NEON = ['#ff4fa3', '#40e0ff', '#ffd166', '#8cff9c', '#ff8a5c', '#b07bff'];

export class Miami {
  group = new THREE.Group();
  signs: THREE.Mesh[] = [];
  private yachts: { root: THREE.Group; phase: number }[] = [];
  private warningLights: THREE.Mesh[] = [];
  private time = 0;
  private hotelLights: THREE.PointLight[] = [];
  private promenadeMat: THREE.MeshStandardMaterial;
  private neonMats: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene, private city: CityHooks) {
    scene.add(this.group);
    this.promenadeMat = new THREE.MeshStandardMaterial({ color: 0x8b7b63, roughness: 0.95 });
    this.buildBeachFront();
    this.buildOceanDrive();
    this.buildPromenade();
    this.buildBeachProps();
    this.buildMarina();
    this.buildIsland();
    this.buildCauseway();
    this.buildSkyline();
    this.buildBillboards();
  }

  // ---------------------------------------------------------------- набережная
  private buildBeachFront() {
    // газон/плаза между городом и пляжем
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(BEACH_START - BOUNDS + 10, 0.5, BOUNDS * 2 + 120),
      new THREE.MeshStandardMaterial({ color: 0x3e5a34, roughness: 1 })
    );
    lawn.position.set((BOUNDS + BEACH_START) / 2 - 8, 0.14, 0);
    lawn.receiveShadow = true;
    this.group.add(lawn);

    // деревянный променад вдоль пляжа
    const plank = canvasTex(256, (ctx, s) => {
      ctx.fillStyle = '#8a7355'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        const y = i * (s / 16);
        ctx.fillStyle = `rgb(${120 + rnd() * 30 | 0},${96 + rnd() * 24 | 0},${68 + rnd() * 20 | 0})`;
        ctx.fillRect(0, y + 1, s, s / 16 - 2);
        ctx.fillStyle = 'rgba(40,30,20,.35)';
        ctx.fillRect(0, y + s / 16 - 2, s, 2);
      }
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(30,22,14,${rnd() * 0.18})`;
        ctx.fillRect(rnd() * s, rnd() * s, 2, 1);
      }
    }, 1);
    plank.repeat.set(1, 90);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(BEACH_START - 518, 0.42, BOUNDS * 2 + 110),
      new THREE.MeshStandardMaterial({ map: plank, color: 0xa08a6b, roughness: 0.92 })
    );
    deck.position.set((518 + BEACH_START) / 2, 0.3, 0);
    deck.receiveShadow = true;
    this.group.add(deck);

    // перила променада
    const railGeos: THREE.BufferGeometry[] = [];
    const railX = BEACH_START - 1.2;
    for (let z = -BOUNDS - 50; z < BOUNDS + 50; z += 4.2) {
      const p = new THREE.BoxGeometry(0.14, 1.0, 0.14);
      p.translate(railX, 1.0, z);
      railGeos.push(p);
    }
    const top = new THREE.BoxGeometry(0.2, 0.14, BOUNDS * 2 + 100);
    top.translate(railX, 1.5, 0);
    railGeos.push(top);
    const rails = new THREE.Mesh(mergeGeometries(railGeos)!, new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.5, metalness: 0.4 }));
    rails.castShadow = true;
    this.group.add(rails);
  }

  // ---------------------------------------------------------------- Ocean Drive
  private buildOceanDrive() {
    const roadX = OCEAN_DRIVE;
    const asphalt = new THREE.Mesh(
      new THREE.BoxGeometry(19, 0.08, BOUNDS * 2 + 90),
      new THREE.MeshStandardMaterial({ color: 0x54514c, roughness: 0.85, metalness: 0.05 })
    );
    asphalt.position.set(roadX, 0.06, 0);
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    // разделительная линия и парковка
    const marks: THREE.BufferGeometry[] = [];
    for (let z = -BOUNDS - 40; z < BOUNDS + 40; z += 7) {
      const g = new THREE.PlaneGeometry(0.16, 3.4); g.rotateX(-Math.PI / 2); g.translate(roadX, 0.115, z);
      marks.push(g);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(marks)!, new THREE.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.9 })));

    // арт-деко квартал: разноцветные отели ярусами, навесы, неон
    const bodyGeos: THREE.BufferGeometry[] = [];
    const trimGeos: THREE.BufferGeometry[] = [];
    const color = new THREE.Color();
    let nameIndex = 0;
    for (let z = -BOUNDS - 40; z < BOUNDS + 40; z += 46) {
      const jitter = (Math.sin(z * 0.7) * 4);
      const depth = 22 + Math.sin(z * 0.31) * 4;
      const width = 34 + Math.sin(z * 0.19) * 8;
      const floors = 3 + Math.floor(Math.abs(Math.sin(z * 0.13)) * 4);
      const h = 9 + floors * 3.2;
      const cx = OCEAN_DRIVE + 10 + depth / 2 + jitter * 0.35;
      const cz = z;
      const pastel = DECO[nameIndex % DECO.length];
      color.setHex(pastel);

      const base = new THREE.BoxGeometry(depth, h, width);
      base.translate(cx, h / 2, cz);
      this.paint(base, color);
      bodyGeos.push(base);

      // второй ярус/башня
      const towerH = 5 + (nameIndex % 3) * 4;
      const tower = new THREE.BoxGeometry(depth * 0.62, towerH, width * 0.55);
      tower.translate(cx - 1, h + towerH / 2, cz);
      this.paint(tower, color.clone().offsetHSL(0, 0, 0.05));
      bodyGeos.push(tower);

      // вертикальные рёбра арт-деко
      for (let k = 0; k < 5; k++) {
        const fin = new THREE.BoxGeometry(0.5, h + towerH, 0.9);
        fin.translate(cx + depth / 2 - 0.2, (h + towerH) / 2, cz - width / 2 + 3 + k * (width - 6) / 4);
        trimGeos.push(fin);
      }
      // круглое окно-иллюминатор
      const round = new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16);
      round.rotateZ(Math.PI / 2);
      round.translate(cx + depth / 2 + 0.1, h - 3, cz);
      trimGeos.push(round);

      // навес у входа
      const awning = new THREE.BoxGeometry(3.4, 0.24, width * 0.7);
      awning.translate(cx + depth / 2 + 1.4, 3.4, cz);
      this.paint(awning, new THREE.Color(nameIndex % 2 ? 0xf6f2e6 : 0xe8b85c));
      bodyGeos.push(awning);

      // неоновая вывеска
      const name = HOTEL_NAMES[nameIndex % HOTEL_NAMES.length];
      const neon = NEON[nameIndex % NEON.length];
      const tex = signTexture(name, '#120c18', neon);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(neon), emissiveMap: tex, emissiveIntensity: 0.2, roughness: 0.6, side: THREE.DoubleSide });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), mat);
      sign.position.set(cx + depth / 2 + 0.35, h + 1.2, cz);
      sign.rotation.y = -Math.PI / 2;
      this.group.add(sign);
      this.signs.push(sign);
      this.neonMats.push(mat);

      // подсветка входа ночью (тёплые пятна света)
      if (nameIndex % 9 === 0) {
        const light = new THREE.PointLight(0xffb27a, 0, 26, 1.9);
        light.position.set(cx + depth / 2 + 4, 5, cz);
        this.group.add(light);
        this.hotelLights.push(light);
      }

      this.city.boxes.push({
        min: new THREE.Vector3(cx - depth / 2, 0, cz - width / 2),
        max: new THREE.Vector3(cx + depth / 2, h + towerH, cz + width / 2),
      });
      this.city.spawnPoints.push(new THREE.Vector3(cx + depth / 2 + 6, 0.2, cz + 6));
      nameIndex++;
    }
    const bodies = new THREE.Mesh(mergeGeometries(bodyGeos)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, envMapIntensity: 0.5 }));
    bodies.castShadow = true; bodies.receiveShadow = true;
    this.group.add(bodies);
    const trims = new THREE.Mesh(mergeGeometries(trimGeos)!, new THREE.MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.55, metalness: 0.12 }));
    trims.castShadow = true;
    this.group.add(trims);

    // пальмовая аллея по обе стороны Ocean Drive
    const palms: THREE.Matrix4[] = [];
    for (let z = -BOUNDS - 30; z < BOUNDS + 30; z += 17) {
      for (const x of [roadX - 11.5, roadX + 11.5]) {
        palms.push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z + Math.sin(z) * 2),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, 0)),
          new THREE.Vector3(1, 1, 1).multiplyScalar(1.15 + rnd() * 0.35)
        ));
      }
    }
    this.palmField(palms);
  }

  private paint(geo: THREE.BufferGeometry, color: THREE.Color) {
    const count = geo.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const shade = 0.88 + 0.12 * (i % 4 < 2 ? 1 : 0.4);
      arr[i * 3] = color.r * shade;
      arr[i * 3 + 1] = color.g * shade;
      arr[i * 3 + 2] = color.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  // ---------------------------------------------------------------- променад и пляж
  private buildPromenade() {
    // площадка променада
    const plaza = new THREE.Mesh(
      new THREE.BoxGeometry(BEACH_START - 516, 0.36, BOUNDS * 2 + 80),
      this.promenadeMat
    );
    plaza.position.set((516 + BEACH_START) / 2, 0.28, 0);
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // фонари променада
    const poles: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xd8cfae, emissive: 0xffd9a0, emissiveIntensity: 0.1, roughness: 0.6 });
    for (let z = -BOUNDS - 40; z < BOUNDS + 40; z += 24) {
      const x = BEACH_START - 3;
      const m = new THREE.Matrix4().makeTranslation(x, 0, z);
      poles.push(m); lamps.push(m);
      this.city.colliders.push({ x, z, r: 0.4 });
    }
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.2, 6); poleGeo.translate(0, 2.6, 0);
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x4c5157, roughness: 0.6, metalness: 0.4 }), poles.length);
    poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
    poleMesh.castShadow = true;
    this.group.add(poleMesh);
    const lampGeo = new THREE.SphereGeometry(0.3, 8, 6); lampGeo.translate(0, 5.3, 0);
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    this.group.add(lampMesh);

    // спасательные вышки
    const towers: THREE.BufferGeometry[] = [];
    const stripes: THREE.BufferGeometry[] = [];
    const positions = [-320, -150, 20, 190, 360];
    positions.forEach(z => {
      const x = shoreX(z) - 26;
      const h = 3.4;
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        const leg = new THREE.BoxGeometry(0.3, h, 0.3);
        leg.translate(x + dx, h / 2 + 0.3, z + dz);
        towers.push(leg);
      }
      const cab = new THREE.BoxGeometry(4.6, 2.6, 4.2);
      cab.translate(x, h + 1.6, z);
      towers.push(cab);
      const roof = new THREE.BoxGeometry(5.4, 0.3, 5);
      roof.translate(x, h + 3.0, z);
      towers.push(roof);
      for (let k = 0; k < 3; k++) {
        const s = new THREE.BoxGeometry(4.7, 0.5, 0.1);
        s.translate(x, h + 0.8 + k * 0.7, z + 2.12);
        stripes.push(s);
      }
      this.city.colliders.push({ x, z, r: 3.1 });
      this.city.spawnPoints.push(new THREE.Vector3(x + 4, 0.2, z));
    });
    const towerMesh = new THREE.Mesh(mergeGeometries(towers)!, new THREE.MeshStandardMaterial({ color: 0xf3e6d2, roughness: 0.85 }));
    towerMesh.castShadow = true; this.group.add(towerMesh);
    this.group.add(new THREE.Mesh(mergeGeometries(stripes)!, new THREE.MeshStandardMaterial({ color: 0xe8604f, roughness: 0.7 })));

    // зонты и лежаки
    const umbrellaGeo = new THREE.ConeGeometry(1.9, 0.75, 10, 1, true);
    const umbrellaMat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.8, side: THREE.DoubleSide });
    const umbrellas: THREE.Matrix4[] = [];
    const umbrellaColors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xff9ff3, 0x6bcBff];
    const colors: number[] = [];
    for (let z = -BOUNDS - 20; z < BOUNDS + 20; z += 9) {
      if (rnd() < 0.45) continue;
      const x = shoreX(z) - 12 - rnd() * 20;
      umbrellas.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.85, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
      colors.push(umbrellaColors[(rnd() * umbrellaColors.length) | 0]);
    }
    if (umbrellas.length) {
      const inst = new THREE.InstancedMesh(umbrellaGeo, umbrellaMat, umbrellas.length);
      umbrellas.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, new THREE.Color(colors[i])); });
      inst.instanceColor!.needsUpdate = true;
      this.group.add(inst);
    }

    // пальмы вдоль пляжа
    const palms: THREE.Matrix4[] = [];
    for (let z = -BOUNDS - 30; z < BOUNDS + 30; z += 21) {
      const x = shoreX(z) - 34 - rnd() * 8;
      palms.push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0.2, z + rnd() * 6),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0.04 * (rnd() - 0.5))),
        new THREE.Vector3(1, 1, 1).multiplyScalar(1.1 + rnd() * 0.5)
      ));
      this.city.colliders.push({ x, z, r: 0.4 });
    }
    this.palmField(palms);
  }

  private palmField(matrices: THREE.Matrix4[]) {
    if (!matrices.length) return null;
    const trunkParts: THREE.BufferGeometry[] = [];
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const r0 = 0.34 - i * 0.028, r1 = 0.34 - (i + 1) * 0.028;
      const seg = new THREE.CylinderGeometry(r1, r0, 1.5, 6);
      seg.translate(Math.sin(i * 0.5) * 0.22, y + 0.75, 0);
      trunkParts.push(seg);
      y += 1.42;
    }
    const trunkGeo = mergeGeometries(trunkParts)!;
    const leafParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const len = 3.1 + rnd() * 1.1;
      const leaf = new THREE.PlaneGeometry(len, 0.85, 4, 1);
      const pos = leaf.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const px = pos.getX(v);
        pos.setY(v, pos.getY(v) * (1 - Math.abs(px) / len * 0.82) - Math.pow(Math.abs(px) / len, 2) * 1.1);
      }
      leaf.computeVertexNormals();
      leaf.rotateX(-Math.PI / 2);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * len * 0.45, y + 0.2, -Math.sin(a) * len * 0.45);
      leafParts.push(leaf);
    }
    const crown = mergeGeometries(leafParts)!;
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1 }), matrices.length);
    const crownMesh = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f6b33, roughness: 0.92, side: THREE.DoubleSide }), matrices.length);
    matrices.forEach((m, i) => {
      trunkMesh.setMatrixAt(i, m);
      crownMesh.setMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      this.city.treeCaps.push({ a: new THREE.Vector3(p.x, 0, p.z), b: new THREE.Vector3(p.x, y, p.z), r: 0.36 });
    });
    trunkMesh.castShadow = true; crownMesh.castShadow = true;
    this.group.add(trunkMesh, crownMesh);
    return crownMesh;
  }

  private buildBeachProps() {
    // волейбольные площадки, дорожки, флаги
    const netGeos: THREE.BufferGeometry[] = [];
    for (const z of [-210, 90, 300]) {
      const x = shoreX(z) - 30;
      for (const dz of [-5, 5]) {
        const pole = new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6);
        pole.translate(x, 1.5, z + dz);
        netGeos.push(pole);
      }
      const net = new THREE.BoxGeometry(0.06, 0.9, 10);
      net.translate(x, 2.2, z);
      netGeos.push(net);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(netGeos)!, new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 })));
  }

  // ---------------------------------------------------------------- марина
  private buildMarina() {
    const z = -430;
    const baseX = shoreX(z) - 6;
    const dockGeos: THREE.BufferGeometry[] = [];
    const dockMat = new THREE.MeshStandardMaterial({ color: 0xa08a6b, roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.BoxGeometry(46, 0.3, 2.2);
      d.translate(baseX + 23, 0.55, z - 30 + i * 12);
      dockGeos.push(d);
      // сваи
      for (let k = 0; k < 5; k++) {
        const p = new THREE.BoxGeometry(0.3, 2.2, 0.3);
        p.translate(baseX + 4 + k * 10, -0.3, z - 30 + i * 12);
        dockGeos.push(p);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(dockGeos)!, dockMat));

    // яхты
    for (let i = 0; i < 6; i++) {
      const yacht = this.makeYacht(9 + rnd() * 5, i % 2 ? 0xf2f4f2 : 0xe8e2d0);
      yacht.position.set(baseX + 26 + rnd() * 8, 0.1, z - 30 + i * 12 + (i % 2 ? 4.5 : -4.5));
      yacht.rotation.y = Math.PI / 2 + (rnd() - 0.5) * 0.12;
      this.group.add(yacht);
      markDynamic(yacht);
      this.yachts.push({ root: yacht, phase: rnd() * 6.28 });
    }
  }

  private makeYacht(length: number, hullColor: number) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(length, 1.5, length * 0.34), new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.35, metalness: 0.2 }));
    hull.position.y = 0.4; hull.castShadow = true;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(length * 0.17, length * 0.34, 4), hull.material);
    bow.rotation.z = -Math.PI / 2; bow.rotation.y = Math.PI / 4;
    bow.position.set(length * 0.56, 0.4, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.5, 1.2, length * 0.26), new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.4 }));
    cabin.position.set(-length * 0.06, 1.7, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(length * 0.46, 0.55, length * 0.27), new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.12, metalness: 0.8 }));
    glass.position.set(-length * 0.06, 1.95, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), new THREE.MeshStandardMaterial({ color: 0xcfd4d8, metalness: 0.8, roughness: 0.3 }));
    mast.position.set(-length * 0.2, 4.4, 0);
    g.add(hull, bow, cabin, glass, mast);
    return g;
  }

  // ---------------------------------------------------------------- остров
  private buildIsland() {
    const shape = new THREE.Shape();
    const seg = 48;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const wobble = 1 + Math.sin(a * 3.1) * 0.06 + Math.cos(a * 5.3) * 0.04;
      pts.push(new THREE.Vector2(Math.cos(a) * ISLAND.rx * wobble, Math.sin(a) * ISLAND.rz * wobble));
    }
    shape.setFromPoints(pts);
    const geo = new THREE.ShapeGeometry(shape, 24);
    geo.rotateX(-Math.PI / 2);
    const island = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 1 }));
    island.position.set(ISLAND.x, BRIDGE_Y + 0.2, ISLAND.z);
    island.receiveShadow = true;
    this.group.add(island);

    const inner = new THREE.Shape();
    const innerPts = pts.map(p => new THREE.Vector2(p.x * 0.82, p.y * 0.82));
    inner.setFromPoints(innerPts);
    const gGeo = new THREE.ShapeGeometry(inner, 20);
    gGeo.rotateX(-Math.PI / 2);
    const grass = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 1 }));
    grass.position.set(ISLAND.x, BRIDGE_Y + 0.26, ISLAND.z);
    this.group.add(grass);

    // особняк
    const house = new THREE.BoxGeometry(34, 11, 22);
    const houseMesh = new THREE.Mesh(house, new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.7 }));
    houseMesh.position.set(ISLAND.x + 6, BRIDGE_Y + 5.7, ISLAND.z);
    houseMesh.castShadow = true;
    const roof = new THREE.BoxGeometry(38, 0.8, 26);
    const roofMesh = new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: 0xd8c9b0, roughness: 0.8 }));
    roofMesh.position.set(ISLAND.x + 6, BRIDGE_Y + 11.4, ISLAND.z);
    const pool = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x2fd2c8, roughness: 0.08, metalness: 0.75, emissive: 0x0a4a55, emissiveIntensity: 0.4 }));
    pool.position.set(ISLAND.x - 24, BRIDGE_Y + 0.34, ISLAND.z + 12);
    const poolGlow = new THREE.PointLight(0x6fe6ff, 0, 20, 2);
    poolGlow.position.copy(pool.position).setY(pool.position.y + 1.5);
    this.group.add(houseMesh, roofMesh, pool, poolGlow);
    this.hotelLights.push(poolGlow);

    this.city.boxes.push({
      min: new THREE.Vector3(ISLAND.x - 11, 0, ISLAND.z - 11),
      max: new THREE.Vector3(ISLAND.x + 23, BRIDGE_Y + 12, ISLAND.z + 11),
    });
    this.city.spawnPoints.push(new THREE.Vector3(ISLAND.x - 22, BRIDGE_Y + 0.3, ISLAND.z - 14));

    const palms: THREE.Matrix4[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      palms.push(new THREE.Matrix4().compose(
        new THREE.Vector3(ISLAND.x + Math.cos(a) * ISLAND.rx * 0.66, BRIDGE_Y + 0.2, ISLAND.z + Math.sin(a) * ISLAND.rz * 0.66),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a * 2.3, 0)),
        new THREE.Vector3(1.2, 1.2, 1.2)
      ));
    }
    this.palmField(palms);
  }

  private buildCauseway() {
    const startX = BOUNDS + 2;
    const endX = ISLAND.x - 30;
    const len = endX - startX;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 17), new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.9 }));
    deck.position.set(startX + len / 2, BRIDGE_Y - 0.45, CAUSEWAY_Z);
    deck.receiveShadow = true;
    this.group.add(deck);

    const rails: THREE.BufferGeometry[] = [];
    for (const dz of [-8.5, 8.5]) {
      const rail = new THREE.BoxGeometry(len, 0.9, 0.35);
      rail.translate(startX + len / 2, BRIDGE_Y + 0.5, CAUSEWAY_Z + dz);
      rails.push(rail);
      for (let x = startX; x < endX; x += 9) {
        const post = new THREE.BoxGeometry(0.4, 1.6, 0.4);
        post.translate(x, BRIDGE_Y + 0.2, CAUSEWAY_Z + dz);
        rails.push(post);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(rails)!, new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.7 })));

    // опоры
    const pillars: THREE.BufferGeometry[] = [];
    for (let x = startX + 24; x < endX; x += 42) {
      const p = new THREE.BoxGeometry(3, 14, 3);
      p.translate(x, -7, CAUSEWAY_Z);
      pillars.push(p);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(pillars)!, new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 })));

    // фонари на дамбе
    const lampGeo = new THREE.SphereGeometry(0.35, 8, 6);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6b8, emissive: 0xffd79a, emissiveIntensity: 0.3 });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.floor(len / 30) * 2);
    let i = 0;
    for (let x = startX + 20; x < endX; x += 30) for (const dz of [-8, 8]) {
      lamps.setMatrixAt(i++, new THREE.Matrix4().makeTranslation(x, BRIDGE_Y + 4.4, CAUSEWAY_Z + dz));
    }
    lamps.count = i;
    this.group.add(lamps);
  }

  // ---------------------------------------------------------------- скайлайн
  private buildSkyline() {
    // сверхвысокие башни в даунтауне (на севере), с маячками
    const towers: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    const spots = [
      { x: -60, z: -400, w: 26, d: 26, h: 138 },
      { x: 20, z: -420, w: 22, d: 34, h: 112 },
      { x: -130, z: -430, w: 30, d: 24, h: 96 },
      { x: 110, z: -390, w: 24, d: 24, h: 86 },
      { x: -210, z: -400, w: 28, d: 28, h: 78 },
    ];
    const colors = [0x9fb0b4, 0xa9b7ae, 0x8fa2ad, 0xb5aea1, 0x9aa8a6];
    spots.forEach((s, i) => {
      const body = new THREE.BoxGeometry(s.w, s.h, s.d);
      body.translate(s.x, s.h / 2, s.z);
      this.paint(body, new THREE.Color(colors[i]));
      towers.push(body);
      const crown = new THREE.BoxGeometry(s.w * 0.55, s.h * 0.22, s.d * 0.55);
      crown.translate(s.x, s.h + s.h * 0.11, s.z);
      this.paint(crown, new THREE.Color(colors[i]).offsetHSL(0, 0, 0.06));
      towers.push(crown);
      const spire = new THREE.CylinderGeometry(0.4, 1.2, 22, 6);
      spire.translate(s.x, s.h + 15, s.z);
      glass.push(spire);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2010, emissiveIntensity: 3 })
      );
      beacon.position.set(s.x, s.h + 26.4, s.z);
      this.group.add(beacon);
      this.warningLights.push(beacon);
      this.city.boxes.push({
        min: new THREE.Vector3(s.x - s.w / 2, 0, s.z - s.d / 2),
        max: new THREE.Vector3(s.x + s.w / 2, s.h, s.z + s.d / 2),
      });
    });
    const mesh = new THREE.Mesh(mergeGeometries(towers)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15, envMapIntensity: 0.7 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.group.add(new THREE.Mesh(mergeGeometries(glass)!, new THREE.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 0.8, roughness: 0.3 })));
  }

  private buildBillboards() {
    const texts = [
      { t: 'VICE CITY', c: '#ff2f92' }, { t: 'BEACH 24/7', c: '#2fe9ff' },
      { t: 'PALMS', c: '#ffe066' }, { t: 'NO SLEEP', c: '#8cff9c' },
    ];
    for (let i = 0; i < 4; i++) {
      const z = -260 + i * 180;
      const x = OCEAN_DRIVE - 9;
      const tex = signTexture(texts[i].t, '#0d0f14', texts[i].c);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(texts[i].c), emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.6, side: THREE.DoubleSide });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), mat);
      board.position.set(x, 12, z);
      board.rotation.y = -Math.PI / 2;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 19.4), new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.6, roughness: 0.5 }));
      frame.position.set(x + 0.4, 12, z);
      const legs: THREE.BufferGeometry[] = [];
      for (const dz of [-6, 6]) {
        const leg = new THREE.BoxGeometry(0.6, 10, 0.6);
        leg.translate(x + 0.4, 5, z + dz);
        legs.push(leg);
      }
      this.group.add(board, frame, new THREE.Mesh(mergeGeometries(legs)!, frame.material as THREE.Material));
      this.neonMats.push(mat);
      this.signs.push(board);
    }
  }

  update(dt: number, night: number) {
    this.time += dt;
    for (const m of this.neonMats) m.emissiveIntensity = 0.08 + night * 2.1;
    for (const l of this.hotelLights) l.intensity = night * 22;
    // мигающие маячки на башнях
    const blink = (Math.sin(this.time * 2.6) * 0.5 + 0.5) > 0.55 ? 1 : 0.06;
    for (const b of this.warningLights) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = blink * 3.4;
    // яхты покачиваются
    for (const y of this.yachts) {
      y.root.position.y = 0.1 + Math.sin(this.time * 0.9 + y.phase) * 0.18;
      y.root.rotation.z = Math.sin(this.time * 0.7 + y.phase) * 0.03;
    }
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

export const MIAMI_LANDMARKS = [
  { id: 'ocean' as const, name: 'Ocean Drive', district: 'Саут-Бич', x: BEACH_START - 34, z: 40, description: 'Арт-деко отели, неон и пальмы вдоль пляжа.' },
  { id: 'beach' as const, name: 'Пляж Саут-Бич', district: 'Саут-Бич', x: shoreX(60) - 30, z: 60, description: 'Белый песок, спасательные вышки и бирюзовая вода.' },
  { id: 'island' as const, name: 'Остров Миллионеров', district: 'Залив', x: ISLAND.x - 20, z: ISLAND.z, description: 'Особняк, бассейн и дамба через залив.' },
  { id: 'marina' as const, name: 'Марина', district: 'Норт-Бич', x: shoreX(-430) + 24, z: -430, description: 'Причалы и яхты на закате.' },
];
