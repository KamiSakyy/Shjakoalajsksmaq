import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addStreetDetails } from './urban-details';

import { BLOCK, BOUNDS, CITY_PLAN, COAST, GRID, ROAD_W, WALK_W } from './city-plan';
import { ASSETS } from '../assets';
import { BEACH_START, beachHeight, shoreX } from './ocean';
import { bridgeY } from './miami';
import { DistrictVisuals } from './district-visuals';
import { addLandmarkStructures } from './landmarks';
import { worldRng } from './worldgen';
/** Детерминированный поток «city»: мир одинаков у всех и при каждом запуске. */
const rnd = worldRng('city');
export { BLOCK, BOUNDS, GRID, ROAD_W, WALK_W } from './city-plan';

export interface Circle { x: number; z: number; r: number; disabled?: boolean }
export interface PoleRef { x: number; z: number; rot: number; index: number; col: Circle; knocked: boolean }
export interface Box3 { min: THREE.Vector3; max: THREE.Vector3 }
export interface Capsule3 { a: THREE.Vector3; b: THREE.Vector3; r: number }
export interface CarWaypoint { x: number; z: number }

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(a: number, b: number) { return a + rnd() * (b - a); }

// ---------------------------------------------------------------------------
export class City {
  group = new THREE.Group();
  colliders: Circle[] = [];
  boxes: Box3[] = [];
  treeCaps: Capsule3[] = [];
  private grid = new Map<string, Circle[]>();
  private boxGrid = new Map<string, Box3[]>();
  private static CELL = 24;
  spawnPoints: THREE.Vector3[] = [];
  streetLightPos: THREE.Vector3[] = [];
  headlightMeshes: THREE.Mesh[] = [];
  roadMesh!: THREE.Mesh;
  buildingMat!: THREE.MeshStandardMaterial;
  streetLightMat!: THREE.MeshStandardMaterial;
  parkMat!: THREE.MeshStandardMaterial;
  neonMat!: THREE.MeshStandardMaterial;
  private trafficLights: THREE.MeshStandardMaterial[][] = [];
  poles: PoleRef[] = [];
  private poleInst: THREE.InstancedMesh | null = null;
  private lampInst: THREE.InstancedMesh | null = null;
  private visuals: DistrictVisuals;
  private landmarkSigns: ReturnType<typeof addLandmarkStructures> | null = null;
  lightPhase = 12.5;
  bounds = BOUNDS;

  constructor(scene: THREE.Scene) {
    this.buildTextures();
    this.buildGround();
    this.buildBlocks();
    this.buildProps();
    const palms = addStreetDetails(this.group, this.boxes, BLOCK, ROAD_W);
    for (const pos of palms) {
      this.colliders.push({ x: pos.x, z: pos.z, r: 0.24 });
      this.treeCaps.push({ a: pos.clone(), b: pos.clone().setY(7), r: 0.24 });
    }
    this.visuals = new DistrictVisuals(this.group);
    this.landmarkSigns = addLandmarkStructures(scene, this.colliders);
    this.streetLightPos.push(...this.visuals.lampPositions);
    this.colliders.push(...this.visuals.streetObstacles);
    this.buildGrid();
    this.updateLights(0);
    scene.add(this.group);
    // remove flat map debris from the previous release

  }

  private key(x: number, z: number) {
    const c = City.CELL;
    return `${Math.floor(x / c)},${Math.floor(z / c)}`;
  }

  /** Индексы коллизий пересобираются после добавления новых кварталов (пляж, дамба). */
  reindex() {
    this.grid.clear();
    this.boxGrid.clear();
    this.buildGrid();
  }

  private buildGrid() {
    for (const o of this.colliders) {
      const k = this.key(o.x, o.z);
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(o);
    }
    for (const b of this.boxes) {
      for (let x = Math.floor(b.min.x / City.CELL); x <= Math.floor(b.max.x / City.CELL); x++) {
        for (let z = Math.floor(b.min.z / City.CELL); z <= Math.floor(b.max.z / City.CELL); z++) {
          const key = `${x},${z}`;
          if (!this.boxGrid.has(key)) this.boxGrid.set(key, []);
          this.boxGrid.get(key)!.push(b);
        }
      }
    }
  }

  private nearCells(x: number, z: number, out: string[]) {
    const c = City.CELL;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    out.length = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(`${cx + i},${cz + j}`);
    return out;
  }

  // ---------------- текстуры ----------------
  private facadeTex!: THREE.Texture;
  private facadeEmissive!: THREE.Texture;
  private facadeRoughness!: THREE.Texture;

  private buildTextures() {
    const lit = Array.from({ length: 64 }, (_, i) => ((i * 17 + 11) % 23) < 5);
    this.facadeTex = canvasTex(512, (ctx, size) => {
      ctx.fillStyle = '#c6c2b8'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 20000; i++) {
        ctx.fillStyle = `rgba(75,69,58,${rnd() * 0.07})`;
        ctx.fillRect(rnd() * size, rnd() * size, 1, 2);
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const xx = x * 64, yy = y * 64;
        ctx.fillStyle = '#999b92'; ctx.fillRect(xx + 12, yy + 10, 40, 43);
        const glass = ctx.createLinearGradient(xx, yy, xx + 25, yy + 52);
        glass.addColorStop(0, '#7c9297'); glass.addColorStop(0.5, '#536c73'); glass.addColorStop(1, '#314149');
        ctx.fillStyle = glass; ctx.fillRect(xx + 14, yy + 12, 36, 38);
        if ((x * 7 + y) % 5 === 0) {
          ctx.fillStyle = '#979c91'; ctx.fillRect(xx + 14, yy + 12, 36, 12);
        }
        ctx.fillStyle = '#b6beb9'; ctx.fillRect(xx + 31, yy + 12, 2, 38);
        ctx.fillRect(xx + 14, yy + 29, 36, 1);
        ctx.fillStyle = '#ded9cb'; ctx.fillRect(xx + 10, yy + 51, 44, 3);
        ctx.fillStyle = 'rgba(40,42,40,.19)'; ctx.fillRect(xx + 10, yy + 54, 44, 2);
        ctx.fillStyle = '#b2afa6'; ctx.fillRect(xx, yy + 61, 64, 1);
      }
    });
    this.facadeEmissive = canvasTex(512, (ctx, size) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (!lit[y * 8 + x]) continue;
        ctx.fillStyle = (x + y) % 3 ? '#d7b67d' : '#b8c5ca';
        ctx.fillRect(x * 64 + 14, y * 64 + 12, 36, 38);
        ctx.fillStyle = '#000'; ctx.fillRect(x * 64 + 31, y * 64 + 12, 2, 38);
      }
    });
    this.facadeRoughness = canvasTex(512, (ctx, size) => {
      ctx.fillStyle = '#efefef'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#505050';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) ctx.fillRect(x * 64 + 14, y * 64 + 12, 36, 38);
    });
    this.facadeRoughness.colorSpace = THREE.NoColorSpace;
    this.facadeTex.anisotropy = this.facadeEmissive.anisotropy = 4;
  }

  private buildGround() {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(COAST + this.bounds + 80, this.bounds * 2 + 150),
      new THREE.MeshStandardMaterial({ color: 0x2a2f22, roughness: 1 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set((COAST - this.bounds) / 2 - 20, -0.021, 0);
    grass.receiveShadow = true;
    this.group.add(grass);

    const loader = new THREE.TextureLoader();
    const load = (src: string, color = false) => {
      const texture = loader.load(src);
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      return texture;
    };
    const am = new THREE.MeshStandardMaterial({ map: load(ASSETS.asphaltDiff, true), normalMap: load(ASSETS.asphaltNormal), roughnessMap: load(ASSETS.asphaltRough),
      color: 0xa5a29d, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.95, metalness: 0.018, envMapIntensity: 0.68 });

    // дороги: полосы вдоль сетки
    const roadGeos: THREE.BufferGeometry[] = [];
    const half = ROAD_W / 2;
    const roadUv = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position'), uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 3.7, p.getZ(i) / 3.7);
    };
    for (let i = -GRID; i <= GRID; i++) {
      const p = i * BLOCK;
      const g1 = new THREE.PlaneGeometry(this.bounds * 2 + ROAD_W, ROAD_W);
      g1.rotateX(-Math.PI / 2);
      g1.translate(0, 0.012, p);
      roadUv(g1); roadGeos.push(g1);
      for (let j = -GRID; j < GRID; j++) {
        const g2 = new THREE.PlaneGeometry(ROAD_W, BLOCK - ROAD_W);
        g2.rotateX(-Math.PI / 2);
        g2.translate(p, 0.012, (j + 0.5) * BLOCK);
        roadUv(g2); roadGeos.push(g2);
      }
    }
    this.roadMesh = new THREE.Mesh(mergeGeometries(roadGeos)!, am);
    this.roadMesh.receiveShadow = true;
    this.group.add(this.roadMesh);

    // разметка
    const lineGeos: THREE.BufferGeometry[] = [];
    const yellowGeos: THREE.BufferGeometry[] = [];
    for (let i = -GRID; i <= GRID; i++) {
      const p = i * BLOCK;
      for (let d = -this.bounds; d < this.bounds; d += 9) {
        if (Math.abs(d - Math.round(d / BLOCK) * BLOCK) < 12) continue;
        const a = new THREE.PlaneGeometry(4.8, 0.14);
        a.rotateX(-Math.PI / 2);
        a.translate(d, 0.02, p);
        yellowGeos.push(a);
        const b = new THREE.PlaneGeometry(0.14, 4.8);
        b.rotateX(-Math.PI / 2);
        b.translate(p, 0.021, d);
        yellowGeos.push(b);
      }
      // стоп-линия на подходе к перекрёстку
      for (let j = -GRID; j <= GRID; j++) {
        const q = j * BLOCK;
        for (const sign of [-1, 1]) {
          const stopX = new THREE.PlaneGeometry(0.14, half - 0.6).rotateX(-Math.PI / 2);
          stopX.translate(p + sign * 12, 0.027, q - sign * half * 0.5);
          const stopZ = new THREE.PlaneGeometry(half - 0.6, 0.14).rotateX(-Math.PI / 2);
          stopZ.translate(p + sign * half * 0.5, 0.027, q + sign * 12);
          lineGeos.push(stopX, stopZ);
        }
      }
    }
    const lm = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.9 });
    const mergedMarks = new THREE.Mesh(mergeGeometries(lineGeos)!, lm);
    mergedMarks.receiveShadow = true; this.group.add(mergedMarks);
    const yellow = new THREE.Mesh(mergeGeometries(yellowGeos)!, new THREE.MeshStandardMaterial({ color: 0xb39b5d, roughness: 0.91 }));
    yellow.receiveShadow = true; this.group.add(yellow);

    // тротуары
    const walkGeos: THREE.BufferGeometry[] = [];
    const inner = ROAD_W + 0.3;
    for (let i = -GRID; i < GRID; i++) {
      for (let j = -GRID; j < GRID; j++) {
        const cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK;
        const size = BLOCK - inner;
        const g = new THREE.BoxGeometry(size, 0.18, size);
        g.translate(cx, 0.09, cz);
        const p = g.getAttribute('position'), uv = g.getAttribute('uv'), n = g.getAttribute('normal');
        for (let k = 0; k < p.count; k++) {
          const h = n.getY(k) > 0.5;
          uv.setXY(k, Math.abs(n.getX(k)) > 0.5 ? p.getZ(k) / 2.4 : p.getX(k) / 2.4, h ? p.getZ(k) / 2.4 : p.getY(k) / 2.4);
        }
        walkGeos.push(g);
      }
    }
    const wm = new THREE.MeshStandardMaterial({ color: 0xcabda9, roughness: 0.94, map: load(ASSETS.pavingDiff, true), normalMap: load(ASSETS.pavingNormal), normalScale: new THREE.Vector2(0.27, 0.27) });
    const walk = new THREE.Mesh(mergeGeometries(walkGeos)!, wm);
    walk.receiveShadow = true;
    this.group.add(walk);

    // бордюр
    const curbGeos: THREE.BufferGeometry[] = [];
    for (let i = -GRID; i < GRID; i++) {
      for (let j = -GRID; j < GRID; j++) {
        const cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK;
        const size = BLOCK - inner;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as number[][]) {
          const g = new THREE.BoxGeometry(dx ? 0.4 : size + 0.4, 0.26, dz ? 0.4 : size + 0.4);
          g.translate(cx + dx * (size / 2 + 0.2), 0.13, cz + dz * (size / 2 + 0.2));
          curbGeos.push(g);
        }
      }
    }
    const curb = new THREE.Mesh(mergeGeometries(curbGeos)!, new THREE.MeshStandardMaterial({ color: 0xc9c2b3, roughness: 0.85 }));
    curb.receiveShadow = true;
    this.group.add(curb);

    // зебры на перекрёстках
    const zebraGeos: THREE.BufferGeometry[] = [];
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        const x = i * BLOCK, z = j * BLOCK;
        for (let k = 0; k < 7; k++) {
          const o = -ROAD_W / 2 + 1.6 + k * 2.2;
          const a = new THREE.PlaneGeometry(2.8, 1.1);
          a.rotateX(-Math.PI / 2);
          a.translate(x - ROAD_W / 2 - 1.6, 0.025, z + o);
          zebraGeos.push(a, a.clone().translate(ROAD_W + 3.2, 0, 0));
          const b = new THREE.PlaneGeometry(1.1, 2.8);
          b.rotateX(-Math.PI / 2);
          b.translate(x + o, 0.026, z - ROAD_W / 2 - 1.6);
          zebraGeos.push(b, b.clone().translate(0, 0, ROAD_W + 3.2));
        }
      }
    }
    const zebra = new THREE.Mesh(mergeGeometries(zebraGeos)!, new THREE.MeshStandardMaterial({ color: 0xd8d4c0, roughness: 0.85 }));
    zebra.receiveShadow = true; this.group.add(zebra);
  }

  // ---------------- кварталы и здания ----------------
  private buildBlocks() {
    const buildingGeos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];
    for (const parcel of CITY_PLAN) {
      if (parcel.kind === 'park') { this.buildPark(parcel.x, parcel.z); continue; }
      if (parcel.kind === 'plaza') { this.buildPlaza(parcel.x, parcel.z); continue; }
      for (const { x, z, w, d, h, tower, color } of parcel.buildings) {
        this.addBuilding(buildingGeos, roofGeos, glassGeos, x, z, w, d, h, tower, color);
        this.boxes.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2) });
      }
    }

    this.buildingMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.facadeTex,
      emissiveMap: this.facadeEmissive,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      roughness: 1, roughnessMap: this.facadeRoughness,
      metalness: 0.1, envMapIntensity: 0.55,
    });
    const b = new THREE.Mesh(mergeGeometries(buildingGeos)!, this.buildingMat);
    b.castShadow = true;
    b.receiveShadow = true;
    this.group.add(b);

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x9b968b, roughness: 0.95 });
    const rm = new THREE.Mesh(mergeGeometries(roofGeos)!, roofMat);
    rm.castShadow = true;
    this.group.add(rm);

    const glassMat = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.15, metalness: 0.85 });
    const gm = new THREE.Mesh(mergeGeometries(glassGeos)!, glassMat);
    this.group.add(gm);
  }

  private addBuilding(
    buildingGeos: THREE.BufferGeometry[], roofGeos: THREE.BufferGeometry[], glassGeos: THREE.BufferGeometry[],
    x: number, z: number, w: number, d: number, h: number, downtown: boolean, color: number
  ) {
    const g = new THREE.BoxGeometry(w, h, d);
    // правильная наклейка окон по мировому размеру
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const TILE = 26;
    const su = [d / TILE, d / TILE, w / TILE, w / TILE, w / TILE, w / TILE];
    const sv = [h / TILE, h / TILE, d / TILE, d / TILE, h / TILE, h / TILE];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * su[f], uv.getY(idx) * sv[f]);
      }
    }
    g.translate(x, h / 2, z);
    // цвет фасада (вершинные цвета — один draw call, но разные здания)
    const pal = new THREE.Color(color).lerp(new THREE.Color(0xe0ddd0), 0.18);
    const cnt = g.attributes.position.count;
    const colors = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      const shade = i % 4 < 2 ? 0.98 : 0.8;
      colors[i * 3] = pal.r * shade;
      colors[i * 3 + 1] = pal.g * shade;
      colors[i * 3 + 2] = pal.b * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    buildingGeos.push(g);

    // крыша: бортик + кондиционеры
    const parapet = new THREE.BoxGeometry(w + 0.5, 0.9, d + 0.5);
    parapet.translate(x, h + 0.45, z);
    roofGeos.push(parapet);
    const n = downtown ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const ac = new THREE.BoxGeometry(rand(1.4, 3), rand(0.8, 1.8), rand(1.4, 3));
      ac.translate(x + rand(-w / 3, w / 3), h + 1.2, z + rand(-d / 3, d / 3));
      roofGeos.push(ac);
    }
    // стеклянный ризалт на крыше ( downtown )
    if (downtown && rnd() < 0.75) {
      const t = new THREE.BoxGeometry(w * 0.55, 8.4, d * 0.58);
      t.translate(x, h + 4.25, z);
      glassGeos.push(t);
    }
  }

  private buildPlaza(cx: number, cz: number) {
    const size = BLOCK - ROAD_W - WALK_W * 2;
    const g = new THREE.BoxGeometry(size, 0.22, size);
    g.translate(cx, 0.11, cz);
    const pm = new THREE.MeshStandardMaterial({ color: 0x7a7264, roughness: 0.9 });
    const m = new THREE.Mesh(g, pm);
    m.receiveShadow = true;
    this.group.add(m);
    // фонтан
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.7, 24), new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.85 }));
    basin.position.set(cx, 0.5, cz);
    basin.castShadow = true;
    this.group.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.12, 24), new THREE.MeshStandardMaterial({
      color: 0x1d4a63, roughness: 0.05, metalness: 0.6, envMapIntensity: 2.4,
    }));
    water.position.set(cx, 0.82, cz);
    this.group.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3.4, 12), new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.8 }));
    column.position.set(cx, 2.3, cz);
    column.castShadow = true;
    this.group.add(column);
    this.colliders.push({ x: cx, z: cz, r: 4.6 });
    this.spawnPoints.push(new THREE.Vector3(cx + 7, 0, cz));
  }

  private buildPark(cx: number, cz: number) {
    const size = BLOCK - ROAD_W - WALK_W * 2;
    const g = new THREE.BoxGeometry(size, 0.2, size);
    g.translate(cx, 0.1, cz);
    this.parkMat = new THREE.MeshStandardMaterial({ color: 0x3c5a30, roughness: 1 });
    const m = new THREE.Mesh(g, this.parkMat);
    m.receiveShadow = true;
    this.group.add(m);
    // дорожки
    const path = new THREE.Mesh(new THREE.PlaneGeometry(size, 4), new THREE.MeshStandardMaterial({ color: 0x6a6250, roughness: 1 }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(cx, 0.22, cz);
    this.group.add(path);
    // деревья
    const trunkGeos: THREE.BufferGeometry[] = [];
    const leafGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 10; k++) {
      const tx = cx + rand(-size / 2 + 4, size / 2 - 4);
      const tz = cz + rand(-size / 2 + 4, size / 2 - 4);
      const th = rand(4, 7);
      const tg = new THREE.CylinderGeometry(0.18, 0.28, th, 6);
      tg.translate(tx, th / 2, tz);
      trunkGeos.push(tg);
      const cg = new THREE.IcosahedronGeometry(rand(1.7, 2.9), 1);
      cg.translate(tx, th + 1.2, tz);
      leafGeos.push(cg);
      for (let crown = 0; crown < 3; crown++) {
        const canopy = new THREE.IcosahedronGeometry(rand(1.0, 1.6), 1);
        canopy.translate(tx + Math.cos(crown * 2.09) * 1.25, th + rand(0.29, 1.4), tz + Math.sin(crown * 2.09) * 1.25);
        leafGeos.push(canopy);
      }
      this.colliders.push({ x: tx, z: tz, r: 0.4 });
      this.treeCaps.push({ a: new THREE.Vector3(tx, 0.2, tz), b: new THREE.Vector3(tx, th, tz), r: 0.3 });
      this.spawnPoints.push(new THREE.Vector3(tx + rand(2, 4), 0, tz + rand(2, 4)));
    }
    const tm = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
    const tr = new THREE.Mesh(mergeGeometries(trunkGeos)!, tm);
    tr.castShadow = true;
    this.group.add(tr);
    const lm = new THREE.MeshStandardMaterial({ color: 0x24502a, roughness: 1 });
    const lf = new THREE.Mesh(mergeGeometries(leafGeos)!, lm);
    lf.castShadow = true;
    this.group.add(lf);
  }

  // ---------------- уличная мебель ----------------
  private buildProps() {
    // фонари
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6, 6);
    poleGeo.translate(0, 3, 0);
    const armGeo = new THREE.BoxGeometry(1.6, 0.12, 0.12);
    armGeo.translate(0.8, 5.9, 0);
    const lampGeo = new THREE.BoxGeometry(0.7, 0.18, 0.32);
    lampGeo.translate(1.5, 5.8, 0);
    const poleMerged = mergeGeometries([poleGeo, armGeo])!;
    const lampMerged = lampGeo;

    const poles: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const off = ROAD_W / 2 + WALK_W * 0.5;
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        const x = i * BLOCK, z = j * BLOCK;
        for (const [dx, dz, rot] of [[off, off + 6, Math.PI * 0.25], [-off, -off - 6, Math.PI * 1.25]] as number[][]) {
          const px = x + dx, pz = z + dz;
          const m = new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
          poles.push(m);
          lamps.push(m);
          this.streetLightPos.push(new THREE.Vector3(px + Math.cos(rot) * 1.5, 5.8, pz - Math.sin(rot) * 1.5));
          const col: Circle = { x: px, z: pz, r: 0.35 };
          this.colliders.push(col);
          this.poles.push({ x: px, z: pz, rot, index: poles.length - 1, col, knocked: false });
        }
      }
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.5 });
    const poleMesh = new THREE.InstancedMesh(poleMerged, poleMat, poles.length);
    poleMesh.castShadow = true;
    poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
    poleMesh.instanceMatrix.needsUpdate = true;
    this.group.add(poleMesh);
    this.poleInst = poleMesh;

    this.streetLightMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0, roughness: 0.5 });
    const lampMesh = new THREE.InstancedMesh(lampMerged, this.streetLightMat, lamps.length);
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    lampMesh.instanceMatrix.needsUpdate = true;
    this.group.add(lampMesh);
    this.lampInst = lampMesh;

    // урны, гидранты, скамейки
    const props: THREE.BufferGeometry[] = [];
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        if (rnd() < 0.45) continue;
        const x = i * BLOCK + (rnd() < 0.5 ? -off - 1 : off + 1);
        const z = j * BLOCK + rand(-20, 20);
        const kind = rnd();
        if (kind < 0.4) {
          const g = new THREE.CylinderGeometry(0.28, 0.25, 0.9, 8);
          g.translate(x, 0.6, z);
          props.push(g);
        } else if (kind < 0.7) {
          const g = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6);
          g.translate(x, 0.5, z);
          props.push(g);
          const g2 = new THREE.SphereGeometry(0.14, 6, 5);
          g2.translate(x, 0.85, z);
          props.push(g2);
        } else {
          const g = new THREE.BoxGeometry(1.8, 0.12, 0.5);
          g.translate(x, 0.55, z);
          props.push(g);
          const g2 = new THREE.BoxGeometry(0.12, 0.5, 0.5);
          g2.translate(x - 0.7, 0.28, z);
          props.push(g2);
          const g3 = new THREE.BoxGeometry(0.12, 0.5, 0.5);
          g3.translate(x + 0.7, 0.28, z);
          props.push(g3);
        }
      }
    }
    if (props.length) {
      const pm = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.8, metalness: 0.3 });
      const pmesh = new THREE.Mesh(mergeGeometries(props)!, pm);
      pmesh.castShadow = true;
      this.group.add(pmesh);
    }

    // ---------- светофоры ----------
    const tlPole = new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6);
    tlPole.translate(0, 2.3, 0);
    const tlBox = new THREE.BoxGeometry(0.36, 1.0, 0.3);
    tlBox.translate(0, 4.9, 0);
    const tlMerged = mergeGeometries([tlPole, tlBox])!;
    const tlLampGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const tlMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.7, metalness: 0.4 });
    const tlPoles: THREE.Matrix4[] = [];
    const tlLamps: THREE.Matrix4[][] = [[], []];
    const toff = ROAD_W / 2 + 1.5;
    for (let i = -GRID; i <= GRID; i++) for (let j = -GRID; j <= GRID; j++) {
      const px = i * BLOCK, pz = j * BLOCK;
      const heads = [[toff, toff, 0], [-toff, -toff, Math.PI], [toff, -toff, -Math.PI / 2], [-toff, toff, Math.PI / 2]];
      heads.forEach(([dx, dz, rot], h) => {
        const m = new THREE.Matrix4().makeRotationY(rot).setPosition(px + dx, 0, pz + dz);
        tlPoles.push(m);
        tlLamps[h < 2 ? 1 : 0].push(m);
      });
    }
    const tlMesh = new THREE.InstancedMesh(tlMerged, tlMat, tlPoles.length);
    tlPoles.forEach((m, i) => tlMesh.setMatrixAt(i, m));
    this.group.add(tlMesh);
    for (const matList of tlLamps) {
      const colors = [0xe85e48, 0xeeb45e, 0x59d789];
      const lenses = colors.map((color, stage) => {
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, roughness: 0.5 });
        const mesh = new THREE.InstancedMesh(tlLampGeo, mat, matList.length);
        matList.forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.17 - stage * 0.27, 0.19))));
        this.group.add(mesh); return mat;
      });
      this.trafficLights.push(lenses);
    }

    // точки спавна на тротуарах
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        this.spawnPoints.push(new THREE.Vector3(i * BLOCK + rand(-6, 6), 0, j * BLOCK + rand(-6, 6)));
        this.spawnPoints.push(new THREE.Vector3(i * BLOCK + rand(-6, 6), 0, j * BLOCK + rand(-6, 6)));
      }
    }
  }

  // Finds a standing lamp post in reach, removes it from the scene and returns it for a physics fall.
  takePole(x: number, z: number, radius: number): PoleRef | null {
    let best: PoleRef | null = null, bd = radius;
    for (const p of this.poles) {
      if (p.knocked) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    best.knocked = true;
    best.col.disabled = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.poleInst?.setMatrixAt(best.index, zero);
    this.lampInst?.setMatrixAt(best.index, zero);
    if (this.poleInst) this.poleInst.instanceMatrix.needsUpdate = true;
    if (this.lampInst) this.lampInst.instanceMatrix.needsUpdate = true;
    return best;
  }

  // The falling post is modelled with its centre at mid-height, so the physics body rotates around its middle.
  createPoleMesh(p: PoleRef): THREE.Mesh {
    const shaft = new THREE.CylinderGeometry(0.09, 0.13, 6, 8);
    const arm = new THREE.BoxGeometry(1.6, 0.12, 0.12); arm.translate(0.8, 2.9, 0);
    const head = new THREE.BoxGeometry(0.7, 0.18, 0.32); head.translate(1.5, 2.8, 0);
    const geometry = mergeGeometries([shaft, arm, head])!;
    shaft.dispose(); arm.dispose(); head.dispose();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.5 }));
    mesh.position.set(p.x, 3, p.z);
    mesh.rotation.y = p.rot;
    mesh.castShadow = true;
    return mesh;
  }

  // ---------------- коллизии ----------------
  // круг игрока/NPC против зданий (AABB) и мелких объектов (круги)
  private _cells: string[] = [];
  collide(p: THREE.Vector3, r: number, feetY = -Infinity) {
    const cells = this.nearCells(p.x, p.z, this._cells);
    for (const k of cells) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      for (const o of arr) {
        if (o.disabled) continue;
        const dx = p.x - o.x, dz = p.z - o.z;
        const d2 = dx * dx + dz * dz;
        const min = o.r + r;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          p.x = o.x + (dx / d) * min;
          p.z = o.z + (dz / d) * min;
        }
      }
    }
    for (const b of this.boxesNear(p.x, p.z)) {
      // если мы стоим на этой коробке (крыша, парапет) — она не стена
      if (b.max.y <= feetY + 0.28) continue;
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // центр внутри — выталкиваем по кратчайшей грани
          const dl = p.x - b.min.x, dr = b.max.x - p.x;
          const db = p.z - b.min.z, df = b.max.z - p.z;
          const m = Math.min(dl, dr, db, df);
          if (m === dl) p.x = b.min.x - r;
          else if (m === dr) p.x = b.max.x + r;
          else if (m === db) p.z = b.min.z - r;
          else p.z = b.max.z + r;
        }
      }
    }
  }

  // занята ли точка (для ИИ-машин)
  boxesNear(x: number, z: number): Box3[] {
    const cells = this.nearCells(x, z, this._cells);
    const out: Box3[] = [];
    for (const k of cells) {
      const arr = this.boxGrid.get(k);
      if (arr) for (const b of arr) out.push(b);
    }
    return [...new Set(out)];
  }

  blockedAt(x: number, z: number, pad = 1) {
    const cells = this.nearCells(x, z, this._cells);
    for (const k of cells) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      for (const o of arr) {
        if (o.disabled) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return true;
      }
    }
    for (const b of this.boxesNear(x, z)) {
      if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true;
    }
    return false;
  }

  // ---------------- днём/ночью ----------------
  setNight(n: number) {
    if (this.buildingMat) this.buildingMat.emissiveIntensity = n * 0.65;
    if (this.streetLightMat) this.streetLightMat.emissiveIntensity = n * 1.5;
    if (this.neonMat) this.neonMat.emissiveIntensity = n * 2.2;
  }

  updateLights(dt: number) {
    this.lightPhase = (this.lightPhase + dt) % 24;
    const stage = (axis: 'x' | 'z') => {
      const phase = (this.lightPhase + (axis === 'x' ? 0 : 12)) % 24;
      return phase < 9 ? 2 : phase < 10.4 ? 1 : 0;
    };
    this.trafficLights.forEach((lenses, axis) => lenses.forEach((lens, i) => {
      lens.emissiveIntensity = i === stage(axis === 0 ? 'x' : 'z') ? 2.3 : 0.015;
      lens.color.set(i === stage(axis === 0 ? 'x' : 'z') ? 0xf7efdd : 0x192520);
    }));
  }

  isGreen(axis: 'x' | 'z') {
    return (this.lightPhase + (axis === 'x' ? 0 : 12)) % 24 < 9;
  }

  surfaceAt(x: number, z: number) {
    // дамба и остров
    const bridge = bridgeY(x, z);
    if (bridge !== null) return bridge;
    if (x > BEACH_START) return beachHeight(x, z);
    if (x > BOUNDS + 8) {
      if (x > 517) return 0.51;         // деревянный променад
      if (x > 498) return 0.2;          // тротуар у отелей
      return 0.02;                      // Ocean Drive
    }
    const dx = Math.abs(x - Math.round(x / BLOCK) * BLOCK), dz = Math.abs(z - Math.round(z / BLOCK) * BLOCK);
    if (dx > ROAD_W / 2 + 0.15 && dz > ROAD_W / 2 + 0.15) return 0.18;
    return 0.015;
  }

  updateVisuals(dt: number, focus: THREE.Vector3, night: number, sun: THREE.Vector3, wet: number) {
    const mat = this.roadMesh.material as THREE.MeshStandardMaterial;
    mat.roughness = 0.97 - wet * 0.57;
    mat.envMapIntensity = 0.65 + wet * 0.66;
    mat.color.setScalar(0.64 - wet * 0.14);
    this.visuals.update(dt, focus, night, sun);
    if (this.landmarkSigns) for (const structure of Object.values(this.landmarkSigns.structures)) {
      if (structure.sign && structure.sign.material instanceof THREE.MeshStandardMaterial) structure.sign.material.emissiveIntensity = 0.08 + night * 1.15;
    }
  }

  keepOnLand(p: THREE.Vector3, car = false) {
    const onCauseway = Math.abs(p.z - (-40)) < 8.6 && p.x > BOUNDS - 4;
    const onIsland = Math.hypot((p.x - 812) / 96, (p.z + 58) / 62) < 1.04;
    if (onCauseway || onIsland) {
      p.z = THREE.MathUtils.clamp(p.z, -1500, 1500);
      p.x = THREE.MathUtils.clamp(p.x, -BOUNDS - 8, 1000);
      return;
    }
    // пешком можно дойти до кромки воды, на машине — до променада
    const limit = Math.min(shoreX(p.z) - (car ? 26 : 2.2), BEACH_START + (car ? 0 : 60));
    p.x = THREE.MathUtils.clamp(p.x, -BOUNDS - 8, limit);
    p.z = THREE.MathUtils.clamp(p.z, -BOUNDS - 8, BOUNDS + 8);
  }

  // ---------------- навигация для машин ----------------
  laneWaypoints(): CarWaypoint[] {
    const pts: CarWaypoint[] = [];
    const lane = ROAD_W / 4;
    for (let i = -GRID; i <= GRID; i++) {
      const p = i * BLOCK;
      for (let d = -this.bounds; d < this.bounds; d += BLOCK) {
        pts.push({ x: d + lane, z: p - lane });
        pts.push({ x: p + lane, z: d + lane });
      }
    }
    return pts;
  }

  nearestLane(x: number, z: number): { x: number; z: number; axis: 'x' | 'z' } {
    const gx = Math.round(x / BLOCK) * BLOCK;
    const gz = Math.round(z / BLOCK) * BLOCK;
    const lane = ROAD_W / 4;
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    if (dx < dz) return { x, z: gz + lane, axis: 'z' };
    return { x: gx + lane, z, axis: 'x' };
  }
}
