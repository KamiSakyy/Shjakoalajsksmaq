import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_W } from './city-plan';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type CarKind = 'sedan' | 'sport' | 'van' | 'taxi' | 'police' | 'fire' | 'ambulance';

const PALETTE = [0xb03a2e, 0x2c4f8a, 0xd8d3c6, 0x22262b, 0x6b6f75, 0x2f6b4f, 0xc9a227, 0x7a3b8f, 0x3fa9c9, 0x8f3f2e];

export interface CarSpec {
  mass: number;
  power: number;      // максимальная тяга
  topSpeed: number;
  grip: number;       // сцепление
  brake: number;
  wheelbase: number;
  halfWidth: number;
  halfLength: number;
  rideHeight: number;
  bodyH: number;
  cabH: number;
}

export const SPECS: Record<CarKind, CarSpec> = {
  sedan: { mass: 1400, power: 9.5, topSpeed: 42, grip: 9.5, brake: 16, wheelbase: 2.7, halfWidth: 0.92, halfLength: 2.2, rideHeight: 0.3, bodyH: 0.62, cabH: 0.46 },
  sport: { mass: 1250, power: 14.5, topSpeed: 58, grip: 11.5, brake: 20, wheelbase: 2.5, halfWidth: 0.88, halfLength: 2.05, rideHeight: 0.22, bodyH: 0.5, cabH: 0.36 },
  van: { mass: 2200, power: 8.0, topSpeed: 34, grip: 7.5, brake: 13, wheelbase: 3.2, halfWidth: 1.02, halfLength: 2.6, rideHeight: 0.42, bodyH: 1.0, cabH: 0.85 },
  taxi: { mass: 1450, power: 9.0, topSpeed: 40, grip: 9.0, brake: 16, wheelbase: 2.75, halfWidth: 0.94, halfLength: 2.25, rideHeight: 0.32, bodyH: 0.66, cabH: 0.5 },
  police: { mass: 1500, power: 13.0, topSpeed: 50, grip: 10.5, brake: 18, wheelbase: 2.8, halfWidth: 0.95, halfLength: 2.3, rideHeight: 0.3, bodyH: 0.64, cabH: 0.48 },
  fire: { mass: 8200, power: 11.8, topSpeed: 28, grip: 6.2, brake: 8, wheelbase: 3.9, halfWidth: 1.16, halfLength: 3.35, rideHeight: 0.38, bodyH: 1.35, cabH: 0.94 },
  ambulance: { mass: 2800, power: 12.0, topSpeed: 38, grip: 8.4, brake: 15, wheelbase: 3.1, halfWidth: 1.03, halfLength: 2.7, rideHeight: 0.32, bodyH: 1.38, cabH: 0.58 },
};

export interface Car {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelHubs: THREE.Group[];
  frontWheels: THREE.Object3D[];
  headlights: THREE.Mesh;
  indicators: THREE.Mesh[];
  turnSignal: number;
  reverseHeld: number;
  gearText: string;
  brakeLight: number;
  rollVel: number;
  pitchVel: number;
  taillights: THREE.Mesh;
  beams: THREE.Mesh[];
  kind: CarKind;
  spec: CarSpec;
  color: number;
  // физика
  pos: THREE.Vector3;
  yaw: number;
  vel: THREE.Vector3;      // мировая скорость
  vLong: number;           // продольная (локальная)
  vLat: number;            // боковая (локальная)
  yawRate: number;
  steer: number;
  steerTarget: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  rpm: number;
  gear: number;
  hp: number;
  smoke: number;
  isPlayer: boolean;
  roll: number;
  pitch: number;
  slip: number;
  // ИИ
  ai: boolean;
  aiTarget: THREE.Vector3;
  aiWait: number;
  aiLane: number;
  aiDir: 1 | -1;
  aiAxis: 'x' | 'z';
  honkT: number;
  lightsOn: boolean;
  damage: number;
  engineDamage: number;
  tireDamage: number;
  fire: number;
  exploded: boolean;
  burned: boolean;
  explodeTimer: number;
  emergencyLights?: THREE.Mesh[];
  sirenPhase: number;
}

export class Traffic {
  cars: Car[] = [];
  skidMarks: THREE.InstancedMesh;
  private skidData: { x: number; z: number; a: number; life: number }[] = [];
  private bodyGeoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private shadow: THREE.CanvasTexture;
  private trimMat = new THREE.MeshStandardMaterial({ color: 0x22292b, roughness: 0.64, metalness: 0.38 });
  private glassMat = new THREE.MeshStandardMaterial({ color: 0x34454b, roughness: 0.17, metalness: 0.45, envMapIntensity: 0.98 });
  private plateMat: THREE.MeshStandardMaterial;
  private time = 0;
  private fireLivery: THREE.Material;
  private emsLivery: THREE.Material;

  constructor(public scene: THREE.Scene) {
    const shadow = document.createElement('canvas'); shadow.width = shadow.height = 96;
    const cx = shadow.getContext('2d')!;
    const gr = cx.createRadialGradient(48, 48, 12, 48, 48, 47);
    gr.addColorStop(0, 'rgba(6,12,10,.78)'); gr.addColorStop(.64, 'rgba(7,13,11,.45)'); gr.addColorStop(1, 'rgba(8,16,12,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 96, 96);
    this.shadow = new THREE.CanvasTexture(shadow);
    const plate = document.createElement('canvas'); plate.width = 160; plate.height = 74;
    const pc = plate.getContext('2d')!;
    pc.fillStyle = '#dedbc4'; pc.fillRect(0, 0, 160, 74);
    pc.fillStyle = '#87453d'; pc.textAlign = 'center'; pc.font = '600 15px Arial'; pc.fillText('PACIFIC', 80, 20);
    pc.font = '700 27px monospace'; pc.fillStyle = '#2f4548'; pc.fillText('26  PCD', 80, 55);
    const map = new THREE.CanvasTexture(plate); map.colorSpace = THREE.SRGBColorSpace;
    this.plateMat = new THREE.MeshStandardMaterial({ map, roughness: 0.75 });
    const stripe = (text: string, bg: string, fg: string) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const x = c.getContext('2d')!; x.fillStyle = bg; x.fillRect(0, 0, 512, 96); x.fillStyle = fg; x.font = '900 62px Arial'; x.textAlign = 'center'; x.fillText(text, 256, 72);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.61 });
    };
    this.fireLivery = stripe('FIRE  RESCUE', '#d9d6c8', '#7e2523');
    this.emsLivery = stripe('EMS  PACIFIC', '#e5e4d8', '#8e3731');
    // следы шин
    const g = new THREE.PlaneGeometry(0.26, 1.0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.5, depthWrite: false });
    this.skidMarks = new THREE.InstancedMesh(g, m, 300);
    this.skidMarks.frustumCulled = false;
    this.skidMarks.count = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 300; i++) this.skidMarks.setMatrixAt(i, zero);
    this.skidMarks.instanceMatrix.needsUpdate = true;
    scene.add(this.skidMarks);
  }

  private bodyGeo(kind: CarKind): THREE.BufferGeometry {
    const key = 'body' + kind;
    if (this.bodyGeoCache.has(key)) return this.bodyGeoCache.get(key)!;
    const s = SPECS[kind], w = s.halfWidth * 2, l = s.halfLength * 2;
    const parts: THREE.BufferGeometry[] = [];
    const shape = (width: number, height: number, len: number, y: number, z: number, radius: number) => {
      const g = new RoundedBoxGeometry(width, height, len, 2, radius);
      g.translate(0, y, z); parts.push(g);
    };
    const y = s.rideHeight + s.bodyH;
    shape(w, s.bodyH * 0.93, l - 0.06, s.rideHeight + s.bodyH * 0.44, 0, 0.115);
    shape(w * 0.96, 0.18, l * 0.37, y - 0.075, l * 0.29, 0.065);
    shape(w * 0.95, 0.17, l * 0.31, y - 0.08, -l * 0.34, 0.062);
    shape(w * 0.765, 0.069, l * (kind === 'van' ? 0.51 : 0.33), y + s.cabH - 0.018, -l * 0.055, 0.027);
    shape(w * 0.985, 0.16, 0.24, s.rideHeight + 0.14, l / 2 - 0.09, 0.045);
    shape(w * 0.985, 0.16, 0.24, s.rideHeight + 0.14, -l / 2 + 0.09, 0.045);
    const geo = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
    this.bodyGeoCache.set(key, geo); return geo;
  }

  private glassGeo(kind: CarKind): THREE.BufferGeometry {
    const key = 'glass' + kind;
    if (this.bodyGeoCache.has(key)) return this.bodyGeoCache.get(key)!;
    const s = SPECS[kind], w = s.halfWidth * 0.88, h = s.rideHeight + s.bodyH - 0.045;
    const l = s.halfLength * 2, slim = kind === 'van' ? 0.9 : 0.85;
    const vertices = [
      [-w, h, l * 0.23], [w, h, l * 0.23], [w, h, -l * 0.295], [-w, h, -l * 0.295],
      [-w * slim, h + s.cabH, l * (kind === 'van' ? 0.19 : 0.10)], [w * slim, h + s.cabH, l * (kind === 'van' ? 0.19 : 0.10)],
      [w * slim, h + s.cabH, -l * (kind === 'van' ? 0.29 : 0.222)], [-w * slim, h + s.cabH, -l * (kind === 'van' ? 0.29 : 0.222)],
    ];
    const faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(([a, b, c, d]) => [a,b,c,a,c,d].flatMap(i => vertices[i])), 3));
    g.computeVertexNormals(); this.bodyGeoCache.set(key, g); return g;
  }

  spawn(kind: CarKind, x: number, z: number, yaw: number, ai = true, paint?: number): Car {
    const s = SPECS[kind];
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);
    const color = paint ?? (kind === 'taxi' ? 0xe8b820 : kind === 'police' ? 0x101318 : kind === 'fire' ? 0xa7352b : kind === 'ambulance' ? 0xe4e1d5 : PALETTE[(Math.random() * PALETTE.length) | 0]);
    const matKey = `m${color}`;
    let mat = this.matCache.get(matKey);
    if (!mat) {
      mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.33, metalness: 0.35, clearcoat: 0.82, clearcoatRoughness: 0.24, envMapIntensity: 1.05 });
      this.matCache.set(matKey, mat);
    }
    const body = new THREE.Mesh(this.bodyGeo(kind), mat);
    body.castShadow = true;
    bodyGroup.add(body);
    const glass = new THREE.Mesh(this.glassGeo(kind), this.glassMat);
    bodyGroup.add(glass);
    const detail = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.trimMat);
      m.position.set(x, y, z);
      bodyGroup.add(m);
    };
    detail(s.halfWidth * 1.58, 0.22, 0.065, 0, s.rideHeight + 0.33, s.halfLength);
    detail(s.halfWidth * 1.61, 0.16, 0.043, 0, s.rideHeight + 0.34, -s.halfLength);
    for (const side of [-1, 1]) {
      detail(0.034, 0.043, s.halfLength * 1.5, s.halfWidth * side, s.rideHeight + 0.18, 0);
      detail(0.05, 0.055, 0.19, side * (s.halfWidth - 0.01), s.rideHeight + s.bodyH - 0.14, -0.19);
      detail(0.23, 0.088, 0.16, side * s.halfWidth, s.rideHeight + s.bodyH + 0.14, s.halfLength * 0.37);
    }
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.164), this.plateMat);
    plate.rotation.y = Math.PI; plate.position.set(0, s.rideHeight + 0.34, -s.halfLength - 0.028);
    bodyGroup.add(plate);
    if (kind === 'taxi') detail(0.42, 0.13, 0.24, 0, s.rideHeight + s.bodyH + s.cabH + 0.045, -0.08);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(s.halfWidth * 3.05, s.halfLength * 2.72), new THREE.MeshBasicMaterial({ map: this.shadow, transparent: true, opacity: 0.87, depthWrite: false }));
    contact.rotateX(-Math.PI / 2); contact.position.y = 0.032; root.add(contact);

    // колёса
    const wg = new THREE.CylinderGeometry(0.359, 0.359, 0.23, 20);
    wg.rotateZ(Math.PI / 2);
    const wm = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.92 });
    const rims = new THREE.MeshStandardMaterial({ color: 0x858b90, roughness: 0.27, metalness: 0.72 });
    const wheels: THREE.Object3D[] = [];
    const frontWheels: THREE.Object3D[] = [];
    const wheelHubs: THREE.Group[] = [];
    const wx = s.halfWidth - 0.012;
    const wz = s.wheelbase / 2;
    for (const [px, pz, front] of [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]] as number[][]) {
      const hub = new THREE.Group();
      const tire = new THREE.Mesh(wg, wm);
      tire.castShadow = true;
      hub.add(tire);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.231, 0.231, 0.235, 16), this.trimMat);
      rim.rotation.z = Math.PI / 2;
      hub.add(rim);
      const side = Math.sign(px), accents: THREE.BufferGeometry[] = [];
      const lip = new THREE.TorusGeometry(0.223, 0.014, 4, 18);
      lip.rotateY(Math.PI / 2); lip.translate(side * 0.122, 0, 0); accents.push(lip);
      const cap = new THREE.CylinderGeometry(0.065, 0.065, 0.017, 10);
      cap.rotateZ(Math.PI / 2); cap.translate(side * 0.13, 0, 0); accents.push(cap);
      for (let spoke = 0; spoke < 6; spoke++) {
        const a = spoke * Math.PI / 3;
        const inset = new THREE.BoxGeometry(0.017, 0.16, 0.027).translate(0, 0.137, 0);
        inset.rotateX(a); inset.translate(side * 0.121, 0, 0); accents.push(inset);
      }
      hub.add(new THREE.Mesh(mergeGeometries(accents)!, rims));
      accents.forEach(g => g.dispose());
      const steering = new THREE.Group();
      steering.position.set(px, 0.36, pz);
      steering.add(hub); root.add(steering);
      wheels.push(hub); wheelHubs.push(steering);
      if (front) frontWheels.push(steering);
    }

    // фары / стопы / поворотники
    const hl = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: new THREE.Color(0xfff0c0), emissiveIntensity: 0, roughness: 0.2 });
    const headlights = new THREE.Mesh(mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.42, 0.16, 0.1); g.translate(-s.halfWidth * 0.62, s.rideHeight + 0.42, s.halfLength - 0.02); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.42, 0.16, 0.1); g.translate(s.halfWidth * 0.62, s.rideHeight + 0.42, s.halfLength - 0.02); return g; })(),
    ])!, hl);
    bodyGroup.add(headlights);
    const tl = new THREE.MeshStandardMaterial({ color: 0x8a1111, emissive: new THREE.Color(0xff1a00), emissiveIntensity: 0.35, roughness: 0.35 });
    const taillights = new THREE.Mesh(mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.4, 0.14, 0.1); g.translate(-s.halfWidth * 0.64, s.rideHeight + 0.46, -s.halfLength + 0.02); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.4, 0.14, 0.1); g.translate(s.halfWidth * 0.64, s.rideHeight + 0.46, -s.halfLength + 0.02); return g; })(),
    ])!, tl);
    bodyGroup.add(taillights);
    const indicators: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.12, 0.066, 0.07);
      const turns = [g.clone().translate(side * (s.halfWidth - 0.09), s.rideHeight + 0.42, s.halfLength),
        g.translate(side * (s.halfWidth - 0.09), s.rideHeight + 0.42, -s.halfLength)];
      const lamp = new THREE.Mesh(mergeGeometries(turns)!, new THREE.MeshStandardMaterial({ color: 0xb36b22, emissive: 0xff912f, emissiveIntensity: 0.04 }));
      bodyGroup.add(lamp); indicators.push(lamp); turns.forEach(p => p.dispose());
    }

    // световые пучки (аддитивные конусы — дёшево и красиво)
    const emergencyLights: THREE.Mesh[] = [];
    if (kind === 'fire' || kind === 'ambulance') {
      const red = new THREE.MeshStandardMaterial({ color: 0xff3129, emissive: 0xff3129, emissiveIntensity: 2.6, roughness: 0.26 });
      const blue = new THREE.MeshStandardMaterial({ color: 0x3f8cff, emissive: 0x3f8cff, emissiveIntensity: 2.6, roughness: 0.26 });
      for (const [x, mat] of [[-0.34, red], [0.34, blue]] as [number, THREE.Material][]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.22), mat);
        bar.position.set(x * s.halfWidth, s.rideHeight + s.bodyH + s.cabH + 0.09, 0.18);
        bodyGroup.add(bar); emergencyLights.push(bar);
      }
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(s.halfLength * 1.35, 0.48), kind === 'fire' ? this.fireLivery : this.emsLivery);
      for (const side of [-1, 1]) {
        const m = stripe.clone(); m.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        m.position.set(side * (s.halfWidth + 0.012), s.rideHeight + 0.54, -0.12); bodyGroup.add(m);
      }
      if (kind === 'fire') {
        const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, s.halfLength * 1.28), this.trimMat);
        ladder.position.set(0, s.rideHeight + s.bodyH + s.cabH + 0.11, 0.12); bodyGroup.add(ladder);
        for (let i = 0; i < 7; i++) {
          const rung = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.06), this.trimMat);
          rung.position.set(0, s.rideHeight + s.bodyH + s.cabH + 0.16, -s.halfLength * 0.47 + i * 0.44); bodyGroup.add(rung);
        }
      } else {
        const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshStandardMaterial({ color: 0xa93934, roughness: 0.72 }));
        cross.position.set(0, s.rideHeight + 0.72, s.halfLength + 0.012); bodyGroup.add(cross);
      }
    }
    const beams: THREE.Mesh[] = [];
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-s.halfWidth * 0.62, s.halfWidth * 0.62]) {
      const cg = new THREE.ConeGeometry(1.5, 12, 10, 1, true);
      cg.rotateX(-Math.PI / 2);
      cg.translate(0, 0, -6);
      const beam = new THREE.Mesh(cg, beamMat.clone());
      beam.position.set(sx, s.rideHeight + 0.4, s.halfLength);
      beam.visible = false;
      bodyGroup.add(beam);
      beams.push(beam);
    }

    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.scene.add(root);

    const car: Car = {
      root, body: bodyGroup, wheels, wheelHubs, frontWheels, headlights, taillights, beams,
      indicators, turnSignal: 0, reverseHeld: 0, gearText: 'P', brakeLight: 0, rollVel: 0, pitchVel: 0,
      damage: 0, engineDamage: 0, tireDamage: 0, fire: 0, exploded: false, burned: false, explodeTimer: 0, emergencyLights, sirenPhase: 0,
      kind, spec: s, color,
      pos: new THREE.Vector3(x, 0, z), yaw,
      vel: new THREE.Vector3(), vLong: 0, vLat: 0, yawRate: 0,
      steer: 0, steerTarget: 0, throttle: 0, brake: 0, handbrake: false,
      rpm: 800, gear: 1, hp: 100, smoke: 0, isPlayer: false,
      roll: 0, pitch: 0, slip: 0,
      ai, aiTarget: new THREE.Vector3(x, 0, z), aiWait: 0, aiLane: ROAD_W / 4, aiDir: 1, aiAxis: 'x', honkT: 0, lightsOn: false,
    };
    this.cars.push(car);
    return car;
  }

  stepCar(car: Car, dt: number, onSkid: (x: number, z: number, yaw: number, strength: number) => void, wet = 0) {
    const s = car.spec;
    if (car.exploded) { car.vLong *= Math.exp(-dt * 5); return; }
    car.steer += (car.steerTarget - car.steer) * (1 - Math.exp(-dt * (Math.abs(car.steerTarget) > 0.01 ? 8 : 12)));
    const before = car.vLong;
    const speed = Math.abs(before);
    const gas = car.throttle, brake = car.brake;
    const gripScale = 1 - wet * 0.28;
    if (brake > 0.05 && gas < 0.03 && before <= 0.18) car.reverseHeld += dt;
    else car.reverseHeld = 0;
    let drive = 0;
    if (gas > 0.02 && before >= -0.12) drive = gas * s.power * (1 - car.engineDamage * 0.64) * Math.pow(1 - Math.min(1, speed / s.topSpeed), 0.8) * (0.3 + car.hp * 0.007);
    if (brake > 0.05 && car.reverseHeld > 0.36 && !car.handbrake && gas < 0.02) drive = -brake * 3.3 * (1 - Math.min(1, speed / 7.4));
    if (car.handbrake) drive *= 0.55;
    if ((brake > 0.05 && before > 0) || (gas > 0.05 && before < -0.12)) {
      car.vLong -= Math.sign(before) * Math.min(speed, dt * s.brake * gripScale * Math.max(brake, gas * 0.85));
    }
    const drag = (0.19 + (gas < 0.02 && Math.abs(drive) < 0.05 ? 0.42 : 0)) * car.vLong + car.vLong * Math.abs(car.vLong) * 0.0048;
    car.vLong += (drive - drag) * dt;
    if (car.handbrake) car.vLong *= Math.exp(-dt * 0.77);
    if (Math.abs(car.vLong) < 0.043 && Math.abs(drive) < 0.05) car.vLong = 0;

    const wheelAngle = car.steer * 0.54 / (1 + speed * speed * 0.0036);
    const targetYaw = THREE.MathUtils.clamp(Math.tan(wheelAngle) * car.vLong / s.wheelbase, -1.45, 1.45) * (car.handbrake ? 1.42 : gripScale);
    car.yawRate += (targetYaw - car.yawRate) * (1 - Math.exp(-8 * dt));
    car.yaw += car.yawRate * dt;
    const grip = s.grip * gripScale * (car.handbrake ? 0.20 : 0.74) * (1 - car.tireDamage * 0.46);
    car.vLat += (-car.yawRate * car.vLong - car.vLat * grip) * dt;
    car.vLat = THREE.MathUtils.clamp(car.vLat, -13, 13);
    car.slip = Math.min(1, Math.abs(car.vLat) / 4.7);
    if ((car.slip > 0.35 || car.handbrake) && speed > 4.5) {
      onSkid(car.pos.x - Math.sin(car.yaw) * 1.1, car.pos.z - Math.cos(car.yaw) * 1.1, car.yaw, car.slip);
    }
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    car.vel.set(fx * car.vLong + fz * car.vLat, 0, fz * car.vLong - fx * car.vLat);
    car.pos.addScaledVector(car.vel, dt);
    car.brakeLight = (brake > 0.02 && drive >= 0) || car.handbrake ? 1 : 0;
    this.syncVisuals(car, dt, (car.vLong - before) / Math.max(dt, 0.001), car.yawRate * car.vLong, wheelAngle);
  }

  syncVisuals(car: Car, dt: number, acceleration = 0, lateral = 0, steer = car.steer * 0.52) {
    const speed = Math.abs(car.vLong);
    car.damage = Math.max(car.damage, 1 - car.hp / 100);
    if (car.emergencyLights) {
      car.sirenPhase += dt * 8;
      const on = Math.sin(car.sirenPhase) > 0;
      car.emergencyLights.forEach((l, i) => ((l.material as THREE.MeshStandardMaterial).emissiveIntensity = (on ? i === 0 : i === 1) ? 4.2 : 0.16));
    }
    if (car.burned) {
      const m = car.body.children[0] as THREE.Mesh;
      if (m && m.material instanceof THREE.MeshStandardMaterial && !m.material.userData.burned) {
        const charred = m.material.clone() as THREE.MeshStandardMaterial;
        charred.userData.burned = true; charred.color.setHex(0x24201d); charred.roughness = 0.96;
        m.material = charred;
      }
    }
    const thresholds = [8.7, 16, 24.5, 34];
    car.gear = 1 + thresholds.filter(t => speed >= t).length;
    const ratio = [3.45, 2.15, 1.56, 1.18, 0.87][car.gear - 1];
    const rpm = Math.max(844, Math.min(6550, speed * 95 * ratio * 1.48 + car.throttle * 500));
    car.rpm += (rpm - car.rpm) * (1 - Math.exp(-dt * 7));
    car.gearText = car.vLong < -0.14 ? 'R' : car.isPlayer || car.ai ? `D${car.gear}` : 'P';
    car.rollVel += (THREE.MathUtils.clamp(-lateral * 0.007, -0.13, 0.13) - car.roll) * dt * 58 - car.rollVel * dt * 8;
    car.pitchVel += (THREE.MathUtils.clamp(acceleration * 0.006, -0.1, 0.09) - car.pitch) * dt * 58 - car.pitchVel * dt * 8;
    car.roll += car.rollVel * dt; car.pitch += car.pitchVel * dt;
    car.body.rotation.z = car.roll; car.body.rotation.x = car.pitch;
    car.body.position.y = -0.006 + Math.sin(car.vel.length() * 0.35 + car.pos.x * 1.7 + car.pos.z) * Math.min(0.016, speed * 0.0012);
    for (const w of car.wheels) w.rotation.x = (w.rotation.x + car.vLong * dt / 0.36) % (2 * Math.PI);
    for (const w of car.frontWheels) w.rotation.y = steer;
    (car.taillights.material as THREE.MeshStandardMaterial).emissiveIntensity = (car.ai ? car.brake : car.brakeLight) > 0.1 ? 2.8 : (car.lightsOn ? 0.68 : 0.11);
  }

  addSkid(x: number, z: number, yaw: number, strength: number) {
    this.skidData.push({ x, z, a: yaw, life: 0.4 + strength * 0.6 });
    if (this.skidData.length > 300) this.skidData.shift();
    this.skidMarks.count = this.skidData.length;
  }

  updateSkids(dt: number) {
    this.time += dt;
    for (const c of this.cars) c.indicators.forEach((lamp, i) => {
      const phase = Math.sin(this.time * 7) > 0;
      (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = phase && c.turnSignal === (i ? 1 : -1) ? 2.2 : 0.04;
    });
    if (!this.skidData.length) return;
    this.skidData = this.skidData.filter(d => d.life > 0);
    this.skidMarks.count = this.skidData.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.skidData.length; i++) {
      const d = this.skidData[i];
      d.life -= dt * 0.02;
      e.set(0, d.a, 0);
      q.setFromEuler(e);
      v.set(d.x, 0.015, d.z);
      m.compose(v, q, sc);
      this.skidMarks.setMatrixAt(i, m);
    }
    this.skidMarks.instanceMatrix.needsUpdate = true;
    (this.skidMarks.material as THREE.MeshBasicMaterial).opacity = 0.42;
  }

  setNight(n: number) {
    for (const car of this.cars) {
      car.lightsOn = n > 0.25;
      (car.headlights.material as THREE.MeshStandardMaterial).emissiveIntensity = n * 1.85 + (car.ai ? 0.12 : 0);
      for (const b of car.beams) (b.material as THREE.MeshBasicMaterial).opacity = n * 0.16;
    }
  }
}
