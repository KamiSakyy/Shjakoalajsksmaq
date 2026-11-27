import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCharacter, type CharacterRig } from './characters';
import { audio, type Material } from './audio';
import { MATERIALS, makeTextures } from './materials';
import { Particles } from './particles';
import { Axe, type BladeSample } from './axe';
import { Npc, type Capsule, type PartName } from './npc';
import { City, BLOCK, ROAD_W } from './city';
import { Traffic, type Car } from './vehicle';
import { DayNight } from './daynight';
import { Pistol } from './pistol';
import { Shotgun } from './shotgun';
import { Items } from './items';
import { Police, type Officer } from './police';
import { Weather } from './weather';
import { BodyPhysics } from './body-physics';
import { StreetLife } from './street-life';
import { Emergencies } from './emergency';
import { Radio } from './music';
import { START, BOUNDS, LANDMARKS, cityRoute, distance, districtAt, locationName, streetPoint, type Point } from './city-plan';

export type Weapon = 'axe' | 'pistol' | 'shotgun';
export type GameMode = 'horror' | 'peace' | 'police';
export type WeatherMode = 'auto' | 'clear' | 'rain';
export type Stance = 'stand' | 'crouch' | 'prone';

export interface HudState {
  hp: number;
  stamina: number;
  sharpness: number;
  kills: number;
  charge: number;
  overcharge: number;
  axeState: string;
  pullProgress: number;
  zombiesAlive: number;
  civiliansAlive: number;
  gameOver: boolean;
  lastHit: string;
  weapon: Weapon;
  ammo: number;
  reserve: number;
  reloading: boolean;
  clock: string;
  night: number;
  inCar: boolean;
  speed: number;
  heat: number;
  nearCar: boolean;
  ads: boolean;
  fps: number;
  wanted: number;
  shells: number;
  shellReserve: number;
  raining: boolean;
  level: number;
  xp: number;
  carCam: number;
  onFootCam: boolean;
  gear: string;
  carHealth: number;
  district: string;
  serviceAvailable: boolean;
  stance: Stance;
  fires: number;
  station: string;
  sprinting: boolean;
  dispatch: string;
  cloud: number;
  nearEmergency: string | null;
  carEngine: number;
  carTires: number;
}

export type GameEvent =
  | { type: 'splash'; amount: number }
  | { type: 'hurt' }
  | { type: 'log'; text: string };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();

function segSegDist2(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, outC1: THREE.Vector3, outC2: THREE.Vector3) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s = 0, t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) { outC1.copy(p1); outC2.copy(p2); return outC1.distanceToSquared(outC2); }
  if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  outC1.copy(p1).addScaledVector(_d1, s);
  outC2.copy(p2).addScaledVector(_d2, t);
  return outC1.distanceToSquared(outC2);
}

function segAabb(p0: THREE.Vector3, p1: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): THREE.Vector3 | null {
  const d = _d1.subVectors(p1, p0);
  let tmin = 0, tmax = 1;
  for (const ax of ['x', 'y', 'z'] as const) {
    const dd = d[ax];
    const o = p0[ax];
    const lo = min[ax], hi = max[ax];
    if (Math.abs(dd) < 1e-8) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / dd, t2 = (hi - o) / dd;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return new THREE.Vector3().copy(p0).addScaledVector(d, tmin);
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private weaponView = new THREE.PerspectiveCamera();
  city: City;
  traffic: Traffic;
  dayNight: DayNight;
  particles: Particles;
  axe: Axe;
  pistol: Pistol;
  shotgun: Shotgun;
  items: Items;
  police: Police;
  weather: Weather;
  weatherMode: WeatherMode = 'auto';
  emergencies!: Emergencies;
  fireTruck: Car | null = null;
  ambulance: Car | null = null;
  stance: Stance = 'stand';
  sprintActive = false;
  radio = new Radio();
  private lastWitnessCall = -99;
  private crackleTimer = 0;
  private emergencySpot = new THREE.Vector3();
  private routeLine!: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  npcs: Npc[] = [];
  physics: BodyPhysics;
  streetLife = new StreetLife();
  destination: Point | null = null;
  route: Point[] = [];
  private navTimer = 0;
  private trafficRefresh = 0;
  private ambientTrafficTimer = 0;
  private redraw = true;
  private wet = 0.23;
  private collisionWait = 0;
  private lastLookAt = 0;
  private carPitch = 0;
  private cameraAnchor = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  tex = makeTextures();

  pos = new THREE.Vector3(START.x, 0, START.z);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  moveInput = new THREE.Vector2();
  bobPhase = 0;
  lastBobSin = 0;
  hp = 100;
  eyeHeight = 1.68;
  camAngVel = new THREE.Vector2();
  prevYaw = 0;
  prevPitch = 0;
  sprint = false;

  trauma = 0;
  kickPitch = 0;
  kickYaw = 0;
  kickVelP = 0;
  kickVelY = 0;
  fovPunch = 0;
  baseFov = 76;
  camLagYaw = 0;
  camLagPitch = 0;

  weapon: Weapon = 'axe';
  weaponSwitch = 0;
  kills = 0;
  civiliansKilled = 0;
  heat = 0;
  gameOver = false;
  running = false;
  time = 0;
  lastT = 0;
  hudTimer = 0;
  lastHit = '';
  contactCooldown = 0;
  bleedTimer = 0;
  heartT = 0;
  strikeTouch = { x: 0, y: 0 };
  pullHold = false;
  fireHold = false;
  adsHold = false;
  raf = 0;
  vehicle: Car | null = null;
  carYawOffset = 0;
  carYaw = 0;
  handbrake = false;
  carCamMode = 0; // 0 — погоня, 1 — над hood, 2 — кино, 3 — сверху
  carCamDist = 7.2;
  driveBtn = { left: false, right: false, gas: false, brake: false };
  onFootCam = 0; // 0 — от первого лица, 1 — от третьего (за плечом)
  spawnTimer = 0;
  fps = 60;
  private fpsAcc = performance.now();
  private fpsCount = 0;
  wanted = 0;
  mode: GameMode = 'horror';
  quality: 'low' | 'high' = 'high';
  level = 1;
  xp = 0;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;
  private playerRig: CharacterRig;
  private torch = new THREE.SpotLight(0xffecd1, 0, 25, 0.7, 0.6, 1.4);
  private torchTarget = new THREE.Object3D();
  private lampPool = Array.from({ length: 8 }, () => new THREE.PointLight(0xffd7a3, 0, 18, 1.6));
  private carLampPool = Array.from({ length: 4 }, () => new THREE.SpotLight(0xfff2d0, 0, 22, 0.55, 0.7, 1.25));
  private followLampTimer = 0;
  private lampTimer = 0;
  paused = false;
  private tracerPool: THREE.Mesh[] = [];
  private tracerIdx = 0;

  onHud: ((h: HudState) => void) | null = null;
  onEvent: ((e: GameEvent) => void) | null = null;

  private caps: Capsule[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private keys = new Set<string>();
  private kbActive = false;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.FogExp2(0x0a0d14, 0.006);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera, this.weaponView);
    this.playerRig = createCharacter('human', 'normal', 4);
    this.playerRig.root.visible = false;
    this.scene.add(this.playerRig.root, this.torch, this.torchTarget, ...this.lampPool, ...this.carLampPool);
    this.carLampPool.forEach(l => { l.target = new THREE.Object3D(); this.scene.add(l.target); });
    this.torch.target = this.torchTarget;

    this.city = new City(this.scene);
    this.traffic = new Traffic(this.scene);
    this.physics = new BodyPhysics(this.city.boxes);
    this.traffic.spawn('sport', 6.5, 19.7, Math.PI, false, 0x3c615c);
    this.traffic.spawn('sedan', -5.9, -24, 0, false, 0x978877);
    const kinds = ['sedan', 'sport', 'taxi', 'van'] as const;
    for (let i = 0; i < 19; i++) {
      const car = this.traffic.spawn(kinds[i % kinds.length], 0, 0, 0);
      if (!this.streetLife.recycle(car, this.pos, this.traffic.cars)) {
        this.scene.remove(car.root); this.traffic.cars.pop();
      }
    }
    const boulevard = this.traffic.spawn('sedan', 3.55, -47, Math.PI, true, 0x8b4635);
    this.streetLife.seedCar(boulevard, boulevard.pos, { x: 0, z: -1, axis: 'z' }, 7.5);
    this.dayNight = new DayNight(this.scene, this.renderer);
    this.particles = new Particles(this.scene);
    this.axe = new Axe(this.weaponView, this.scene, this.tex);
    this.axe.feedback = {
      shake: (t) => (this.trauma = Math.min(1, this.trauma + t)),
      kick: (p, y) => { this.kickVelP += p * 40; this.kickVelY += y * 40; },
      fovPunch: (a) => (this.fovPunch = Math.min(0.2, this.fovPunch + a)),
    };
    this.axe.onWhoosh = (s) => audio.whoosh(s);
    this.pistol = new Pistol(this.weaponView);
    this.pistol.group.visible = false;
    this.shotgun = new Shotgun(this.weaponView);
    this.shotgun.group.visible = false;
    this.items = new Items(this.scene);
    this.police = new Police(this.scene);
    this.police.onFall = (o, dir) => this.physics.fall(o.rig, dir, o.vel);
    this.police.onRemove = o => this.physics.removeDoll(o.root);
    this.weather = new Weather(this.scene);
    this.emergencies = new Emergencies(this.scene);
    this.fireTruck = this.spawnEmergency('fire', 'fire');
    this.ambulance = this.spawnEmergency('ambulance', 'hospital');
    // разбросать предметы по городу
    this.items.scatter(this.city.spawnPoints, 40, ['medkit', 'ammo', 'shells', 'gasoline', 'whetstone']);

    // трассеры пуль
    const tracerGeo = new THREE.CylinderGeometry(0.012, 0.004, 0.9, 5);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false;
      this.scene.add(m);
      this.tracerPool.push(m);
    }

    // постобработка: мягкое свечение фонарей, окон и вспышек
    try {
      const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 2 });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.16, 0.35, 1.3);
      composer.addPass(bloom);
      this.output = new OutputPass();
      composer.addPass(this.output);
      this.composer = composer;
      this.bloom = bloom;
    } catch { /* без постобработки */ }

    const routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(256 * 3), 3));
    this.routeLine = new THREE.Line(routeGeometry, new THREE.LineDashedMaterial({ color: 0xf0ae7c, dashSize: 1.5, gapSize: 1.15, transparent: true, opacity: 0.85, depthWrite: false }));
    this.routeLine.frustumCulled = false;
    this.routeLine.visible = false;
    this.routeLine.renderOrder = 4;
    this.scene.add(this.routeLine);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.redraw = true;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown') {
      this.keys.add(e.code);
      if (!e.repeat && this.running && !this.paused) {
        if (e.code === 'KeyF') this.interact();
        if (e.code === 'KeyE') this.cycleWeapon();
        if (e.code === 'KeyR') { if (this.vehicle) this.serviceCar(); else this.reload(); }
        if (e.code === 'KeyC') this.vehicle ? this.cycleCarCamera() : this.toggleOnFootCam();
        if (e.code === 'KeyX') this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
        if (e.code === 'KeyZ') this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
        if (e.code === 'KeyQ') this.toggleAds();
      }
    } else this.keys.delete(e.code);
    if (e.code === 'ShiftLeft') this.sprint = e.type === 'keydown';
    if (e.code === 'Space') { this.handbrake = e.type === 'keydown'; if (this.running) e.preventDefault(); }
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.running || this.gameOver || this.paused) return;
    if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    if ((e.target as HTMLElement)?.closest?.('button')) return;
    if (e.button === 0) {
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()?.catch(() => {});
      if (this.weapon === 'axe') this.axeDown(); else this.fireHold = true;
    }
    if (e.button === 2) this.reload();
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      if (this.weapon === 'axe') this.axeUp(); else this.fireHold = false;
    }
  };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) {
      this.look(e.movementX, e.movementY);
      if (this.weapon === 'axe' && this.axe.state === 'windup') this.axeMove(e.movementX * 2, e.movementY * 2);
    }
  };

  // ================= ввод =================
  resetInput() {
    this.keys.clear(); this.moveInput.set(0, 0); this.kbActive = false;
    this.driveBtn = { left: false, right: false, gas: false, brake: false };
    this.fireHold = this.adsHold = this.pullHold = this.handbrake = this.sprint = false;
    this.axe.cancel();
  }

  setPaused(paused: boolean) { if (this.paused !== paused) this.resetInput(); this.paused = paused; this.redraw = true; }

  setDestination(point: Point | null) {
    this.destination = point ? streetPoint(point) : null;
    this.route = this.destination ? cityRoute(this.pos, this.destination) : [];
    this.updateRouteLine();
    this.navTimer = 0;
  }

  setWeather(mode: WeatherMode, immediate = false) {
    this.weatherMode = mode;
    this.weather.setTarget(mode === 'rain' ? 0.9 : 0);
    if (immediate) this.weather.intensity = this.weather.target;
  }

  private updateRoute(dt: number) {
    if (!this.destination) return;
    this.navTimer -= dt;
    if (this.navTimer > 0) return;
    this.navTimer = 0.32;
    if (distance(this.pos, this.destination) < 6.8) {
      this.setLog(`Вы прибыли: ${locationName(this.destination)}`);
      this.setDestination(null);
    } else {
      this.route = cityRoute(this.pos, this.destination);
      if (this.time - (this.lastRoutePaint ?? 0) > 0.14) { this.lastRoutePaint = this.time; this.updateRouteLine(); }
    }
  }
  private lastRoutePaint = 0;
  private updateRouteLine() {
    if (!this.routeLine) return;
    const line = this.route;
    this.routeLine.visible = line.length > 1;
    if (line.length < 2) return;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.5) continue;
      // side of the lane, then interpolate toward the ground surface for long segments
      const nx = dx / distance, nz = dz / distance;
      for (let d = 0; d < distance; d += 2.6) {
        const x = a.x + nx * d + nz * 2.1, z = a.z + nz * d - nx * 2.1;
        points.push(new THREE.Vector3(x, this.city.surfaceAt(x, z) + 0.085, z));
      }
    }
    const attribute = this.routeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 256; i++) {
      const p = points[Math.min(i, points.length - 1)] ?? new THREE.Vector3();
      attribute.setXYZ(i, p.x, p.y, p.z);
    }
    attribute.needsUpdate = true;
    this.routeLine.geometry.setDrawRange(0, Math.min(256, points.length));
    this.routeLine.geometry.computeBoundingSphere();
    this.routeLine.computeLineDistances();
  }

  canServiceCar() {
    const spot = LANDMARKS.find(p => p.id === 'garage')!;
    return !!this.vehicle && distance(this.vehicle.pos, spot) < 16 && Math.abs(this.vehicle.vLong) < 1.05;
  }

  serviceCar() {
    if (!this.canServiceCar() || !this.vehicle) return;
    this.vehicle.hp = 100;
    this.setLog('Мастерская: машина отремонтирована');
    audio.magClick();
  }

  setMove(x: number, y: number) { this.moveInput.set(x, y); }
  setSprint(v: boolean) { this.sprint = v; }
  look(dx: number, dy: number) {
    if (this.gameOver) return;
    if (this.vehicle) {
      this.carYawOffset = clamp(this.carYawOffset - dx * 0.0045, -Math.PI, Math.PI);
      this.carPitch = clamp(this.carPitch - dy * 0.0032, -0.37, 0.52);
      this.lastLookAt = this.time;
    } else {
      this.yaw -= dx * 0.0042;
      this.pitch = clamp(this.pitch - dy * 0.0042, -1.35, 1.35);
    }
  }

  // --- топор ---
  axeDown() {
    if (this.gameOver) return;
    if (this.weapon !== 'axe') { this.setWeapon('axe'); return; }
    if (this.vehicle) return;
    this.strikeTouch.x = 0; this.strikeTouch.y = 0;
    const st = this.axe.state;
    if (st === 'stuck') { this.pullHold = true; this.doYank(0.75); }
    else if (st === 'left') { if (this.nearAxe()) { this.axe.resumePull(); this.pullHold = true; this.doYank(0.5); } }
    else this.axe.beginWindup();
  }
  axeMove(dx: number, dy: number) {
    this.strikeTouch.x += dx; this.strikeTouch.y += dy;
    if (this.axe.state === 'windup') this.axe.steerSwing(this.strikeTouch.x, this.strikeTouch.y);
    else if (this.axe.state === 'stuck' && dy < -14) { this.doYank(0.35); this.strikeTouch.y = 0; }
  }
  axeUp() {
    this.pullHold = false;
    if (this.axe.state === 'windup') this.axe.release();
  }

  // --- пистолет ---
  fireDown() {
    if (this.gameOver) return;
    if (this.weapon === 'axe') { this.setWeapon('pistol'); return; }
    this.fireHold = true;
  }
  fireUp() { this.fireHold = false; }
  ads(on: boolean) { this.adsHold = on; }
  toggleAds() {
    if (this.vehicle) return;
    if (this.weapon === 'axe') this.setWeapon('pistol');
    this.adsHold = !this.adsHold;
  }
  setStance(stance: Stance) {
    if (this.vehicle || this.gameOver) return;
    this.stance = stance;
    this.sprint = false;
    this.axe.cancel();
    this.onEvent?.({ type: 'log', text: stance === 'stand' ? 'Стоя' : stance === 'crouch' ? 'Присел · меньше шума' : 'Ползком · тяжёлое оружие недоступно' });
  }
  cycleStance() { this.setStance(this.stance === 'stand' ? 'crouch' : this.stance === 'crouch' ? 'prone' : 'stand'); }

  private spawnEmergency(kind: 'fire' | 'ambulance', landmark: 'fire' | 'hospital') {
    const spot = LANDMARKS.find(l => l.id === landmark)!;
    const base = streetPoint(spot);
    for (const offset of [18, -18, 33, -33, 6]) {
      const x = base.x + 3.55, z = base.z + offset;
      if (Math.abs(x) > BOUNDS || Math.abs(z) > BOUNDS || this.city.blockedAt(x, z, 2.6)) continue;
      const car = this.traffic.spawn(kind, x, z, offset > 0 ? 0 : Math.PI, false);
      car.ai = false;
      car.gearText = 'P';
      return car;
    }
    return null;
  }

  igniteCar(car: Car, intensity = 1) {
    if (car.exploded) return;
    car.fire = Math.max(car.fire, intensity);
    car.explodeTimer = car.explodeTimer > 0 ? car.explodeTimer : 2.8 + Math.random() * 1.4;
    this.emergencies.ignite(car.pos, car, intensity);
  }

  damageCar(car: Car, amount: number, source = 'impact') {
    if (car.exploded) return;
    car.hp = Math.max(0, car.hp - amount);
    car.damage = Math.max(car.damage, 1 - car.hp / 100);
    if (source === 'impact') car.engineDamage = Math.min(1, car.engineDamage + amount * 0.012);
    if (Math.random() < 0.2) car.tireDamage = Math.min(1, car.tireDamage + amount * 0.009);
    if (car.hp <= 0) this.igniteCar(car, 1);
  }

  explodeCar(car: Car) {
    if (car.exploded) return;
    car.exploded = true; car.burned = true; car.fire = 0; car.explodeTimer = 0;
    car.root.rotation.z = (Math.random() - 0.5) * 0.12;
    this.emergencies.explosion(car.pos);
    this.trauma = Math.min(1, this.trauma + clamp(1 - this.pos.distanceTo(car.pos) / 28, 0.12, 0.9));
    this.kickVelP += 4.6; this.kickVelY += (Math.random() - 0.5) * 4; this.fovPunch += 0.075;
    audio.explosion();
    this.particles.sparkBurst(car.pos.clone().setY(0.7), this.tmp.set(0, 1, 0), 1.2);
    for (let i = 0; i < 8; i++) this.particles.dustPuff(car.pos.clone().setY(0.7 + Math.random()), 2);
    for (const other of this.traffic.cars) {
      if (other === car) continue;
      const d = other.pos.distanceTo(car.pos);
      if (d < 8.4) { this.damageCar(other, (1 - d / 8.4) * 88, 'blast'); if (Math.random() < 0.6) this.igniteCar(other, 0.65); }
    }
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const d = n.position().distanceTo(car.pos);
      if (d < 8.8) { n.applyHit('torso', 380, this.tmp.subVectors(n.position(), car.pos).setY(0).normalize().multiplyScalar(6), 1); n.kill(this.tmp); }
    }
    for (const o of this.police.officers) {
      if (o.state !== 'dead' && o.pos.distanceTo(car.pos) < 8) this.police.hitOfficer(o, 300, new THREE.Vector3());
    }
    const pd = this.pos.distanceTo(car.pos);
    if (pd < 9 && !this.vehicle) { this.hp = Math.max(0, this.hp - (1 - pd / 9) * 44); this.trauma = 1; this.onEvent?.({ type: 'hurt' }); }
    if (this.vehicle === car) { this.hp = Math.max(0, this.hp - 32); this.exitCar(); }
    if (this.hp <= 0) { this.gameOver = true; this.setLog('Ты погиб при взрыве'); }
    this.police.crime(0.35);
    this.setLog(this.vehicle === car ? 'МАШИНА ВЗОРВАЛАСЬ' : 'ВЗРЫВ МАШИНЫ');
  }

  setHandbrake(on: boolean) { this.handbrake = on; }

  cycleCarCamera() {
    this.carCamMode = (this.carCamMode + 1) % 4;
    this.carYawOffset = this.carPitch = 0;
  }

  toggleOnFootCam() { this.onFootCam = this.onFootCam === 0 ? 1 : 0; }

  setDriveBtn(name: 'left' | 'right' | 'gas' | 'brake', on: boolean) {
    this.driveBtn[name] = on;
  }

  horn() {
    audio.horn();
    if (!this.vehicle) return;
    for (const n of this.npcs) if (n.alive && n.kind === 'human' && n.position().distanceTo(this.pos) < 18) n.glanceAt(this.pos);
  }
  reload() {
    if (this.weapon === 'shotgun') {
      if (this.shotgun.startReload()) audio.magClick();
      return;
    }
    if (this.pistol.startReload()) { audio.magClick(); setTimeout(() => audio.slideClack(), 900); }
  }

  setWeapon(w: Weapon) {
    if (this.weapon === w) return;
    if (this.axe.state === 'stuck' && w !== 'axe') return;
    this.weapon = w;
    this.weaponSwitch = 1;
    this.fireHold = false;
    this.axe.setVisible(w === 'axe' && !this.vehicle);
    this.pistol.group.visible = w === 'pistol' && !this.vehicle;
    this.shotgun.group.visible = w === 'shotgun' && !this.vehicle;
  }

  cycleWeapon() {
    const order: Weapon[] = ['axe', 'pistol', 'shotgun'];
    const i = order.indexOf(this.weapon);
    for (let k = 1; k <= 3; k++) {
      const next = order[(i + k) % 3];
      if (next === 'axe' && this.axe.state === 'stuck') continue;
      this.setWeapon(next);
      return;
    }
  }

  interact() {
    if (this.gameOver) return;
    if (this.vehicle) {
      if (Math.abs(this.vehicle.vLong) > 6) this.setLog('Сначала притормози');
      else this.exitCar();
      return;
    }
    const c = this.nearestCar();
    if (c) this.enterCar(c);
  }

  // ================= машина =================
  nearestCar(): Car | null {
    let best: Car | null = null;
    let bd = 4.05;
    for (const c of this.traffic.cars) {
      const dx = this.pos.x - c.pos.x, dz = this.pos.z - c.pos.z;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const d = Math.hypot(Math.max(0, Math.abs(dx * fz - dz * fx) - c.spec.halfWidth), Math.max(0, Math.abs(dx * fx + dz * fz) - c.spec.halfLength));
      if (d < bd && Math.abs(c.vLong) < 3.1) { bd = d; best = c; }
    }
    return best;
  }

  enterCar(c: Car) {
    this.resetInput();
    this.vehicle = c;
    c.isPlayer = true;
    c.ai = false;
    c.vLong = 0; c.vLat = 0; c.yawRate = 0; c.vel.set(0, 0, 0); c.reverseHeld = 0;
    c.steerTarget = 0; c.steer = 0; c.throttle = 0; c.brake = 0;
    this.carCamMode = 0;
    this.carYawOffset = this.carPitch = 0;
    this.carYaw = c.yaw;
    this.camera.position.set(c.pos.x - Math.sin(c.yaw) * 7, 3.3, c.pos.z - Math.cos(c.yaw) * 7);
    this.setWeapon('axe');
    this.axe.setVisible(false);
    audio.engineStart();
    this.onEvent?.({ type: 'log', text: 'За рулём' });
  }

  exitCar() {
    const c = this.vehicle;
    if (!c) return;
    c.isPlayer = false;
    c.throttle = 0; c.brake = 1; c.steerTarget = 0; c.turnSignal = 0;
    c.vLong = 0; c.vLat = 0; c.vel.set(0, 0, 0); c.gearText = 'P';
    this.resetInput();
    this.vehicle = null;
    const side = c.spec.halfWidth + 0.78;
    const x = Math.cos(c.yaw) * side, z = -Math.sin(c.yaw) * side;
    this.pos.set(c.pos.x + x, 0, c.pos.z + z);
    if (this.city.blockedAt(this.pos.x, this.pos.z, 0.44)) this.pos.set(c.pos.x - x, 0, c.pos.z - z);
    this.cityCollide(this.pos, 0.38); this.city.keepOnLand(this.pos);
    this.pos.y = this.city.surfaceAt(this.pos.x, this.pos.z);
    this.yaw = c.yaw + Math.PI; this.camLagYaw = this.yaw; this.pitch = this.camLagPitch = 0;
    this.vel.set(0, 0, 0);
    audio.stopEngine();
    this.onEvent?.({ type: 'log', text: 'Вышел из машины' });
  }

  private driveCar(dt: number) {
    const c = this.vehicle!;
    const inp = this.moveInput;
    const b = this.driveBtn;
    const gas = clamp(Math.max(inp.y, b.gas ? 1 : 0), 0, 1);
    const brake = clamp(Math.max(-inp.y, b.brake ? 1 : 0), 0, 1);
    const steer = clamp(inp.x + (b.right ? 1 : 0) - (b.left ? 1 : 0), -1, 1);
    c.throttle = brake > 0.05 ? 0 : gas;
    c.brake = brake;
    c.steerTarget = -steer;
    c.handbrake = this.handbrake;
    c.turnSignal = Math.abs(steer) > 0.8 && Math.abs(c.vLong) < 11 ? -Math.sign(steer) : 0;

    this.traffic.stepCar(c, dt, (x, z, yaw, strength) => {
      this.traffic.addSkid(x, z, yaw, strength);
      if (Math.random() < dt * 4) this.particles.dustPuff(new THREE.Vector3(x, 0.1, z), 1);
    }, this.wet);

    const beforeX = c.pos.x, beforeZ = c.pos.z;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const fenders = [0, c.spec.halfLength - 0.68, -(c.spec.halfLength - 0.68)];
    for (const along of fenders) {
      const x = c.pos.x + fx * along, z = c.pos.z + fz * along;
      const corner = this.tmp2.set(x, 0, z);
      this.city.collide(corner, c.spec.halfWidth * 0.92);
      c.pos.x += corner.x - x; c.pos.z += corner.z - z;
    }
    this.city.keepOnLand(c.pos, true);
    this.collisionWait = Math.max(0, this.collisionWait - dt);
    const pushed = Math.hypot(c.pos.x - beforeX, c.pos.z - beforeZ);
    if (pushed > 0.001) {
      const nx = (c.pos.x - beforeX) / pushed, nz = (c.pos.z - beforeZ) / pushed;
      const hit = -(c.vel.x * nx + c.vel.z * nz);
      if (hit > 0) {
        c.vLong += hit * 1.18 * (nx * fx + nz * fz);
        c.vLat += hit * 1.18 * (nx * fz - nz * fx);
        if (hit > 2.8 && this.collisionWait === 0) this.carImpact(c, hit);
      }
    }
    for (const other of this.traffic.cars) {
      if (other === c || other.pos.distanceToSquared(c.pos) > 35) continue;
      const ox = other.pos.x - c.pos.x, oz = other.pos.z - c.pos.z;
      const headingX = Math.sin(other.yaw), headingZ = Math.cos(other.yaw);
      const axes = [[fx, fz], [fz, -fx], [headingX, headingZ], [headingZ, -headingX]];
      let penetration = Infinity, nx = 0, nz = 0;
      for (const [ax, az] of axes) {
        const ra = c.spec.halfLength * Math.abs(ax * fx + az * fz) + c.spec.halfWidth * Math.abs(ax * fz - az * fx);
        const rb = other.spec.halfLength * Math.abs(ax * headingX + az * headingZ) + other.spec.halfWidth * Math.abs(ax * headingZ - az * headingX);
        const dot = ox * ax + oz * az, depth = ra + rb - Math.abs(dot);
        if (depth <= 0) { penetration = 0; break; }
        if (depth < penetration) { penetration = depth; nx = -ax * Math.sign(dot || 1); nz = -az * Math.sign(dot || 1); }
      }
      if (penetration <= 0) continue;
      c.pos.x += nx * (penetration + 0.03); c.pos.z += nz * (penetration + 0.03);
      const hit = -((c.vel.x - other.vel.x) * nx + (c.vel.z - other.vel.z) * nz);
      if (hit > 0) {
        c.vLong += hit * (nx * fx + nz * fz) * 0.64;
        c.vLat += hit * (nx * fz - nz * fx) * 0.65;
        other.vLong *= 0.82;
        if (hit > 3.5 && this.collisionWait === 0) this.carImpact(c, hit * 0.7);
      }
    }

    c.pos.y = lerp(c.pos.y, this.city.surfaceAt(c.pos.x, c.pos.z) - 0.015, 1 - Math.exp(-dt * 8));
    c.root.position.copy(c.pos);
    c.root.rotation.y = c.yaw;
    this.pos.copy(c.pos);
    this.vel.copy(c.vel);

    // двигатель
    audio.engineSet(clamp(c.rpm / 6500, 0, 1));
    if (c.slip > 0.25 && Math.abs(c.vLong) > 4) {
      this.trauma = Math.min(1, this.trauma + 0.02);
    }
    this.hitPole(c);
    // сбиваем пешеходов
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const d = n.position().distanceTo(c.pos);
      if (d < 2.6 && Math.abs(c.vLong) > 3) {
        const dir = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        n.applyHit(n.lastHitPart ?? 'torso', 500, dir.clone().multiplyScalar(4), 1);
        this.particles.bloodBurst(n.position().clone().setY(1), dir, 0.95, 46);
        n.kill(dir);
        if (n.kind === 'zombie') { this.kills++; this.addXp(12); }
        else { this.civiliansKilled++; this.police.crime(2); this.witnessed(1.2); }
        c.vLong *= 0.82;
        audio.impact('flesh', 1);
        this.trauma = Math.min(1, this.trauma + 0.32);
      }
    }
    // дым из двигателя при повреждении
    if (c.hp < 40 && Math.random() < dt * 6) {
      this.particles.dustPuff(c.pos.clone().setY(0.8), 1);
    }
  }

  // Civilians within sight of a crime panic and call the police, which raises the wanted level.
  witnessed(weight: number) {
    let count = 0;
    for (const n of this.npcs) {
      if (!n.alive || n.kind !== 'human' || n.position().distanceTo(this.pos) > 26) continue;
      n.panicT = Math.max(n.panicT, 7);
      count++;
    }
    if (!count) return;
    this.police.crime(weight * Math.min(1, 0.25 + count * 0.25));
    if (this.time - this.lastWitnessCall > 8) {
      this.lastWitnessCall = this.time;
      this.emergencies.dispatchText = 'Свидетели вызвали полицию';
      this.emergencies.dispatchTimer = 4;
    }
  }

  // A moving car knocks over lamp posts: the post becomes a rigid body that topples and collides.
  hitPole(c: Car): boolean {
    if (Math.abs(c.vLong) < 4 || c.exploded) return false;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const pole = this.city.takePole(c.pos.x + fx * c.spec.halfLength, c.pos.z + fz * c.spec.halfLength, 2.1);
    if (!pole) return false;
    const mesh = this.city.createPoleMesh(pole);
    this.scene.add(mesh);
    const speed = Math.abs(c.vLong);
    const linear = new THREE.Vector3(fx * c.vLong * 0.55, 2.2, fz * c.vLong * 0.55);
    const angular = new THREE.Vector3(fz, 0, -fx).multiplyScalar(1.4 + speed * 0.09);
    this.physics.addRigid(mesh, new THREE.Vector3(0.24, 6, 0.24), 45, linear, angular);
    this.damageCar(c, 4 + speed * 0.8, 'impact');
    this.trauma = Math.min(1, this.trauma + 0.25);
    audio.impact('stone', clamp(speed / 18, 0.2, 1));
    this.particles.sparkBurst(c.pos.clone().setY(1.2), this.tmp.set(0, 1, 0), 0.5);
    c.vLong *= 0.72;
    this.witnessed(0.3);
    if (c === this.vehicle) this.setLogActive('Столб сбит');
    return true;
  }

  radioCycle() {
    this.radio.cycle();
    this.setLog(this.radio.station.id === 'off' ? 'Радио выключено' : `Радио: ${this.radio.station.name}`);
  }

  private carImpact(c: Car, impact: number) {
    this.collisionWait = 0.3;
    this.damageCar(c, impact * 1.9, 'impact');
    this.trauma = Math.min(1, this.trauma + clamp(impact / 25, 0.04, 0.53));
    audio.impact('stone', clamp(impact / 20, 0.18, 1));
    this.particles.sparkBurst(c.pos.clone().setY(0.6), this.tmp.set(0, 1, 0), clamp(impact / 16, 0.12, 1));
  }

  private updateVehicleFires(dt: number) {
    for (const c of this.traffic.cars) {
      if (c.fire <= 0) continue;
      if (c.exploded) { c.fire = 0; continue; }
      if (c.explodeTimer <= 0) c.explodeTimer = 3.2 + Math.random() * 1.6;
      c.explodeTimer -= dt;
      c.hp -= dt * 5.2; c.damage = Math.max(c.damage, 1 - c.hp / 100);
      if (Math.random() < dt * 6) this.particles.dustPuff(c.pos.clone().setY(1.15), 1);
      if (c.hp <= 0 || c.explodeTimer <= 0) this.explodeCar(c);
      if (this.vehicle === c) {
        this.hp -= dt * 3.2;
        this.trauma = Math.max(this.trauma, 0.22);
        if (this.hp <= 0) { this.gameOver = true; this.setLog('Ты сгорел в машине'); }
        if (c.damage > 0.72) { this.setLog('Машина горит! Покинь её'); this.exitCar(); }
      }
    }
  }

  private driveEmergency(car: Car, target: THREE.Vector3, speed: number, stop: number, dt: number) {
    const dx = target.x - car.pos.x, dz = target.z - car.pos.z;
    const distance = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const delta = Math.atan2(Math.sin(desired - car.yaw), Math.cos(desired - car.yaw));
    car.yaw += clamp(delta, -dt * 2.1, dt * 2.1);
    const wanted = distance > stop ? Math.min(speed, distance * 0.68) : 0;
    car.vLong += clamp(wanted - car.vLong, -dt * 9, dt * 4.2);
    car.steer = clamp(delta * 1.1, -0.75, 0.75);
    car.throttle = wanted > 0.3 ? 0.75 : 0; car.brake = wanted < 0.3 ? 0.8 : 0;
    car.pos.x += Math.sin(car.yaw) * car.vLong * dt;
    car.pos.z += Math.cos(car.yaw) * car.vLong * dt;
    this.city.collide(car.pos, car.spec.halfWidth + 0.13);
    this.city.keepOnLand(car.pos, true);
    car.pos.y = this.city.surfaceAt(car.pos.x, car.pos.z) - 0.015;
    car.root.position.copy(car.pos); car.root.rotation.y = car.yaw;
    this.traffic.syncVisuals(car, dt, (wanted - car.vLong) / Math.max(dt, 0.001), 0);
  }

  private updateEmergencyServices(dt: number) {
    const fires = this.emergencies.fires;
    let active = false;
    const truck = this.fireTruck;
    if (truck && !truck.isPlayer && !truck.exploded) {
      let closest: THREE.Vector3 | null = null; let best = Infinity;
      for (const f of fires) { const d = f.pos.distanceToSquared(truck.pos); if (d < best) { best = d; closest = this.emergencySpot.copy(f.pos); } }
      if (closest && best < 480 * 480) {
        active = true;
        this.driveEmergency(truck, closest, 17, 10.5, dt);
        this.emergencies.extinguishNear(truck.pos, 14, 1.25, dt);
        if (truck.pos.distanceTo(closest) < 14) this.setLogActive('Пожарный расчёт тушит огонь');
      } else this.driveEmergency(truck, this.emergencySpot.set(0, 0, -40), 8, 3, dt);
    }
    const ambulance = this.ambulance;
    if (ambulance && !ambulance.isPlayer && !ambulance.exploded) {
      let target: Npc | null = null; let best = 55 * 55;
      for (const n of this.npcs) if (n.alive && n.hp < 68) {
        const d = n.position().distanceToSquared(ambulance.pos);
        if (d < best) { best = d; target = n; }
      }
      if (target) {
        active = true;
        this.driveEmergency(ambulance, target.position(), 13, 5.8, dt);
        target.hp = Math.min(100, target.hp + dt * 9);
        if (target.hp > 95) target.state = 'walk';
        if (ambulance.pos.distanceTo(target.position()) < 7) this.setLogActive('Скорая оказывает помощь');
      } else if (this.hp < 85 && this.pos.distanceToSquared(ambulance.pos) < 34 * 34) {
        active = true;
        this.driveEmergency(ambulance, this.pos, 13, 4, dt);
        if (ambulance.pos.distanceTo(this.pos) < 5.5) this.hp = Math.min(100, this.hp + dt * 3.8);
      } else {
        this.driveEmergency(ambulance, this.emergencySpot.set(-90, 0, -90), 8, 5, dt);
      }
    }
    if (active) {
      audio.startSiren();
      const nearest = [truck && !truck.isPlayer && !truck.exploded ? truck.pos.distanceTo(this.pos) : 999, ambulance && !ambulance.isPlayer && !ambulance.exploded ? ambulance.pos.distanceTo(this.pos) : 999].sort((a, b) => a - b)[0];
      audio.setSirenVolume(clamp(1 - nearest / 110, 0, 1));
    } else if (this.police.stars === 0) audio.stopSiren();
  }

  private notice = '';
  private noticeTimer = 0;
  private setLogActive(text: string) {
    if (this.notice === text) return;
    this.notice = text; this.noticeTimer = 4;
    this.setLog(text);
  }

  // ================= игрок =================
  private updatePlayer(dt: number) {
    const stanceScale = this.stance === 'crouch' ? 0.52 : this.stance === 'prone' ? 0.24 : 1;
    const targetEye = this.stance === 'crouch' ? 1.12 : this.stance === 'prone' ? 0.42 : 1.68;
    this.eyeHeight = lerp(this.eyeHeight, targetEye, 1 - Math.exp(-dt * 9));
    const moving = Math.hypot(this.moveInput.x, this.moveInput.y) > 0.3;
    this.sprintActive = this.sprint && this.stance === 'stand' && moving && this.axe.stamina > 4 && !this.gameOver && this.axe.state !== 'windup' && !this.vehicle;
    const maxSpeed = (this.gameOver ? 0 : this.axe.state === 'windup' ? 2.0 : this.sprintActive ? 6.2 : 3.6) * stanceScale;
    const inp = this.moveInput;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * inp.y + cos * inp.x) * maxSpeed;
    const wz = (-cos * inp.y - sin * inp.x) * maxSpeed;
    const accel = 12;
    this.vel.x = lerp(this.vel.x, wx, 1 - Math.exp(-accel * dt));
    this.vel.z = lerp(this.vel.z, wz, 1 - Math.exp(-accel * dt));
    this.pos.addScaledVector(this.vel, dt);
    // коллизии с городом
    this.city.collide(this.pos, 0.35);
    this.city.keepOnLand(this.pos);
    this.pos.y = lerp(this.pos.y, this.city.surfaceAt(this.pos.x, this.pos.z), 1 - Math.exp(-dt * 18));
    // не проходить сквозь NPC
    for (const n of this.npcs) {
      if (!n.alive) continue;
      const dx = this.pos.x - n.position().x, dz = this.pos.z - n.position().z;
      const d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4) {
        this.pos.x = n.position().x + (dx / d) * 0.62;
        this.pos.z = n.position().z + (dz / d) * 0.62;
      }
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.3) {
      this.bobPhase += dt * sp * 2.6;
      const s = Math.sin(this.bobPhase);
      if (this.lastBobSin > 0 && s <= 0) audio.footstep();
      if (this.lastBobSin < 0 && s >= 0) audio.footstep();
      this.lastBobSin = s;
    }
  }

  private restrictCamera(origin: THREE.Vector3, target: THREE.Vector3) {
    const length = origin.distanceTo(target);
    if (length < 0.1) return;
    let clear = length;
    const mid = this.tmp2.copy(origin).lerp(target, 0.5);
    for (const box of this.city.boxesNear(mid.x, mid.z)) {
      const hit = segAabb(origin, target, box.min.clone().addScalar(-0.21), box.max.clone().addScalar(0.21));
      if (hit) clear = Math.min(clear, Math.max(0.3, origin.distanceTo(hit) - 0.3));
    }
    if (clear < length) target.lerpVectors(origin, target, clear / length);
  }

  private updateCamera(dt: number) {
    const dyaw = this.yaw - this.prevYaw, dpitch = this.pitch - this.prevPitch;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.camAngVel.x = lerp(this.camAngVel.x, dpitch / Math.max(dt, 1e-3), 0.3);
    this.camAngVel.y = lerp(this.camAngVel.y, dyaw / Math.max(dt, 1e-3), 0.3);

    this.kickVelP += (-this.kickPitch * 300 - this.kickVelP * 18) * dt;
    this.kickVelY += (-this.kickYaw * 300 - this.kickVelY * 18) * dt;
    this.kickPitch += this.kickVelP * dt;
    this.kickYaw += this.kickVelY * dt;

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const t = this.time;
    const n1 = Math.sin(t * 61.3) * 0.6 + Math.sin(t * 97.7) * 0.4;
    const n2 = Math.sin(t * 53.1 + 1) * 0.6 + Math.sin(t * 89.3 + 2) * 0.4;
    const n3 = Math.sin(t * 71.9 + 3);

    if (this.vehicle) {
      const c = this.vehicle;
      const mode = this.carCamMode;
      const speedT = clamp(Math.abs(c.vLong) / 40, 0, 1);
      if (this.time - this.lastLookAt > 1.6 && speedT > 0.09) {
        this.carYawOffset *= Math.exp(-dt * 2.3);
        this.carPitch *= Math.exp(-dt * 2.3);
      }
      const targetYaw = c.yaw + this.carYawOffset + (mode === 2 ? 0.52 : 0);
      const yawDelta = Math.atan2(Math.sin(targetYaw - this.carYaw), Math.cos(targetYaw - this.carYaw));
      this.carYaw += yawDelta * (1 - Math.exp(-dt * 7));
      const yaw = this.carYaw;
      const ranges = [7.1 + speedT * 1.85, 5.45, 10.6, 0.3];
      const heights = [3.36 + speedT * 0.27, 2.66, 4.6, 14.4];
      const range = ranges[mode], height = heights[mode] + this.carPitch * range * 0.8;
      this.cameraAnchor.set(c.pos.x, 1.16, c.pos.z);
      this.cameraTarget.set(c.pos.x - Math.sin(yaw) * range, Math.max(1.55, height), c.pos.z - Math.cos(yaw) * range);
      this.restrictCamera(this.cameraAnchor, this.cameraTarget);
      this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-dt * (mode === 3 ? 9 : 11)));
      this.restrictCamera(this.cameraAnchor, this.camera.position);
      const ahead = mode === 3 ? 0.65 : 2.35 + speedT * 1.7;
      this.camera.lookAt(c.pos.x + Math.sin(c.yaw) * ahead, mode === 3 ? 0 : 1.16, c.pos.z + Math.cos(c.yaw) * ahead);
      this.camera.rotation.z += -c.roll * 0.29 + n3 * sh * 0.012;
      this.camera.fov = lerp(this.camera.fov, this.baseFov - 11 + speedT * 14, 1 - Math.exp(-dt * 5));
      this.camera.updateProjectionMatrix();
      return;
    }

    this.camLagYaw = lerp(this.camLagYaw, this.yaw, 1 - Math.exp(-dt * 30));
    this.camLagPitch = lerp(this.camLagPitch, this.pitch, 1 - Math.exp(-dt * 30));
    if (this.onFootCam === 1) {
      // вид от третьего лица за плечом
      const sp2 = Math.hypot(this.vel.x, this.vel.z);
      const yaw = this.camLagYaw;
      const back = 2.9, up = 0.48, side = 0.65;
      const px = this.pos.x + Math.sin(yaw) * back + Math.cos(yaw) * side;
      const pz = this.pos.z + Math.cos(yaw) * back - Math.sin(yaw) * side;
      this.camera.position.set(px, this.pos.y + this.eyeHeight + up, pz);
      this.restrictCamera(this.cameraAnchor.copy(this.pos).add(this.tmp.set(0, 1.42, 0)), this.camera.position);
      this.camera.lookAt(
        this.pos.x - Math.sin(yaw) * 3,
        this.pos.y + this.eyeHeight - 0.25 + this.camLagPitch * 4,
        this.pos.z - Math.cos(yaw) * 3
      );
      this.camera.rotation.z += Math.sin(this.bobPhase) * 0.012 * Math.min(1, sp2 / 3);
      this.camera.fov = lerp(this.camera.fov, this.baseFov, 1 - Math.exp(-dt * 10));
      this.camera.updateProjectionMatrix();
      return;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.035 * Math.min(1, sp / 3);
    const bobX = Math.sin(this.bobPhase) * 0.018 * Math.min(1, sp / 3);
    const sway = this.axe.state === 'windup' ? -0.03 * this.axe.charge : 0;
    const adsK = this.pistol.ads;
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * bobX * (1 - adsK),
      this.pos.y + this.eyeHeight - bobY * 0.5 + sway - adsK * 0.02,
      this.pos.z - Math.sin(this.yaw) * bobX * (1 - adsK)
    );
    this.camera.rotation.set(
      this.camLagPitch + this.kickPitch + n1 * sh * 0.06 + Math.sin(this.bobPhase * 2) * 0.004 * Math.min(1, sp / 3),
      this.camLagYaw + this.kickYaw + n2 * sh * 0.05,
      n3 * sh * 0.03 + Math.sin(this.bobPhase) * 0.006 * Math.min(1, sp / 3) + this.axe.swayRot.y * 0.3
    );
    this.fovPunch = Math.max(0, this.fovPunch - dt * 0.6);
    const windupF = this.axe.state === 'windup' ? -6 * this.axe.charge : 0;
    const target = this.baseFov + windupF + this.fovPunch * 40 - adsK * 26;
    this.camera.fov = lerp(this.camera.fov, target, 1 - Math.exp(-dt * 12));
    this.camera.updateProjectionMatrix();
  }

  // ================= контакт топора =================
  private checkContacts(dt: number) {
    const camP = this.camera.position;
    type Best = { sample: BladeSample; point: THREE.Vector3; mat: Material; resistance: number; npc?: Npc; cap?: Capsule; tree?: boolean; dist: number };
    const holder: { best: Best | null } = { best: null };
    const c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
    const consider = (sample: BladeSample, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: Material, resistance: number, npc?: Npc, cap?: Capsule, tree?: boolean) => {
      const d2 = segSegDist2(sample.prev, sample.pos, a, b, c1, c2);
      const rr = r + 0.02;
      if (d2 < rr * rr) {
        const dist = Math.sqrt(d2);
        const score = dist - (sample.isBlade ? 1 : 0);
        if (!holder.best || score < holder.best.dist) {
          const point = c2.clone().add(c1.clone().sub(c2).normalize().multiplyScalar(r));
          holder.best = { sample, point, mat, resistance, npc, cap, tree, dist: score };
        }
      }
    };
    for (const n of this.npcs) {
      if (n.position().distanceTo(camP) > 3.8) continue;
      if (n.state === 'dead' && n.deadTime > 6) continue;
      n.getCapsules(this.caps);
      for (const cap of this.caps) for (const s of this.axe.samples) consider(s, cap.a, cap.b, cap.r, cap.mat, cap.resistance, n, cap);
    }
    // машины — металл: рикошет, искры, затупление
    for (const c of this.traffic.cars) {
      const cp = c.root.position;
      if (Math.abs(cp.x - camP.x) > 4.5 || Math.abs(cp.z - camP.z) > 4.5) continue;
      const min = new THREE.Vector3(cp.x - 1.05, 0.25, cp.z - 2.2);
      const max = new THREE.Vector3(cp.x + 1.05, 1.55, cp.z + 2.2);
      for (const s of this.axe.samples) {
        const h = segAabb(s.prev, s.pos, min, max);
        if (h) {
          consider(s, h, h, 0.01, 'stone', 1e9, undefined, undefined, false);
          break;
        }
      }
    }
    for (const t of this.city.treeCaps) {
      const dx = t.a.x - camP.x, dz = t.a.z - camP.z;
      if (dx * dx + dz * dz > 16) continue;
      for (const s of this.axe.samples) consider(s, t.a, t.b, t.r, 'wood', MATERIALS.wood.resistance, undefined, undefined, true);
    }
    const hit = holder.best;
    if (!hit) {
      for (const s of this.axe.samples) {
        if (s.isBlade && s.pos.y < 0.02 && s.prev.y > s.pos.y) {
          const { E } = this.axe.energyAt(s, dt);
          if (E > 3) { this.resolveGround(s, E); return; }
        }
      }
      return;
    }
    const { E } = this.axe.energyAt(hit.sample, dt);
    if (E < 2.5) return;
    this.resolveHit(hit, E);
  }

  private resolveHit(hit: { sample: BladeSample; point: THREE.Vector3; mat: Material; resistance: number; npc?: Npc; cap?: Capsule; tree?: boolean }, E: number) {
    this.contactCooldown = 0.22;
    const camP = this.camera.position;
    const dir = this.tmp.subVectors(hit.sample.pos, hit.sample.prev).normalize();
    const E01 = clamp(E / 300, 0, 1);
    const isBlade = hit.sample.isBlade;
    let mat: Material = isBlade ? hit.mat : 'blunt';
    const mp = MATERIALS[mat];
    const sharpF = 0.3 + 0.7 * this.axe.sharpness;
    const bladeF = this.axe.bladeFactor();
    if (isBlade && bladeF < 0.45 && mat !== 'stone') mat = 'blunt';
    const resistance = mat === 'blunt' || mat === 'stone' ? 1e9 : hit.resistance;
    let depth = clamp((E * MATERIALS[mat].penetration * sharpF * bladeF) / resistance, 0, 1);
    if (mat === 'blunt' || mat === 'stone') depth = 0;
    const dirH = dir.clone(); dirH.y = 0; dirH.normalize();
    const near = hit.point.distanceTo(camP) < 1.9;
    let stuck = false;
    let attachTo: THREE.Object3D | null = null;
    let pullResist = mp.pullResist;

    if (hit.npc && hit.cap) {
      const n = hit.npc;
      const part = hit.cap.part;
      const wasAlive = n.alive;
      const human = n.kind === 'human';
      if (mat === 'blunt') {
        n.applyHit(part, 4 + 6 * E01, dirH.clone().multiplyScalar(0.5 + 1.5 * E01), 0.3 + 0.3 * E01);
        audio.impact('blunt', E01);
        this.setLog(`Удар древком · ${Math.round(E)} Дж`);
        this.particles.dustPuff(hit.point, 2);
      } else {
        const dmg = this.npcDamage(part, depth) * (human ? 0.55 : 1);
        n.addWound(part, hit.point, 0.025 + 0.05 * depth);
        this.particles.bloodBurst(hit.point, dir, E01, 14 + 55 * depth);
        if (near) this.onEvent?.({ type: 'splash', amount: 0.25 + depth * 0.8 + E01 * 0.3 });
        const impulse = dirH.clone().multiplyScalar((0.5 + 2.4 * E01) * (part === 'torso' || part === 'head' ? 1 : 0.6));
        n.applyHit(part, dmg, impulse, 0.25 + 0.6 * depth);
        audio.impact(part === 'head' ? 'bone' : 'flesh', E01, depth);
        const partRu: Record<PartName, string> = { head: 'череп', torso: 'торс', armL: 'рука', armR: 'рука', foreL: 'предплечье', foreR: 'предплечье', thighL: 'бедро', thighR: 'бедро', shinL: 'голень', shinR: 'голень' };
        let txt = `${partRu[part]} · ${Math.round(E)} Дж · глубина ${Math.round(depth * 12)} см`;
        let severed = false;
        if (part === 'head' && depth > 0.55) {
          const obj = n.dismember('head');
          if (obj) { this.spawnDebris(obj, dir, E01, 0.12); severed = true; txt = `РАСКОЛОЛ ЧЕРЕП · ${Math.round(E)} Дж`; }
        } else if ((part === 'armL' || part === 'armR' || part === 'foreL' || part === 'foreR') && depth > 0.6) {
          const obj = n.dismember(part);
          if (obj) { this.spawnDebris(obj, dir, E01, 0.05); severed = true; txt = `ОТРУБИЛ РУКУ · ${Math.round(E)} Дж`; }
        } else if ((part === 'thighL' || part === 'thighR' || part === 'shinL' || part === 'shinR') && depth > 0.58) {
          const obj = n.dismember(part);
          if (obj) { this.spawnDebris(obj, dir, E01, 0.08); severed = true; txt = `ОТРУБИЛ НОГУ · ${Math.round(E)} Дж`; }
        }
        if (part === 'head' && depth > 0.3) this.trauma = Math.min(1, this.trauma + 0.2);
        if (n.hp <= 0 && wasAlive) {
          n.kill(dirH);
          if (n.kind === 'zombie') { this.kills++; this.addXp(12); }
          else { this.civiliansKilled++; this.heat = Math.min(1, this.heat + 0.25); this.police.crime(1.6); txt += ' · ГРАЖДАНСКИЙ УБИТ'; }
          if (!severed) txt += n.kind === 'zombie' ? ' · УБИТ' : '';
        }
        this.setLog(txt);
        if (!severed && !human) {
          const sc = part === 'head' ? 0.45 : part === 'torso' ? 0.3 : 0.12;
          if (depth > 0.5 && Math.random() < sc * (depth + 0.2) + (part === 'head' ? 0.1 : 0)) {
            stuck = true;
            attachTo = hit.cap.obj;
            pullResist = part === 'head' ? 2.6 : 1.7;
            this.axe.stuckData = n;
            this.setLog(txt + ' · ЗАСТРЯЛ');
          }
        }
      }
    } else if (hit.tree) {
      this.particles.woodChips(hit.point, dir, E01);
      audio.impact('wood', E01, depth);
      this.setLog(`дерево · ${Math.round(E)} Дж · врубился на ${Math.round(depth * 12)} см`);
      if (depth > 0.35 && Math.random() < MATERIALS.wood.stuckChance * (0.1 + depth * 0.7)) {
        stuck = true;
        attachTo = null;
        this.axe.stuckData = null;
        this.setLog(`топор ЗАСТРЯЛ в дереве`);
      }
    } else {
      mat = 'stone';
      this.particles.sparkBurst(hit.point, dir, E01);
      audio.impact('stone', E01);
      const dull = MATERIALS.stone.dull * (0.4 + E01);
      this.axe.sharpness = Math.max(0.05, this.axe.sharpness - dull);
      this.trauma = Math.min(1, this.trauma + 0.35 + 0.4 * E01);
      this.kickVelP += 2.2 * E01 + 0.8;
      this.kickVelY += (Math.random() - 0.5) * 2;
      this.setLog(`КАМЕНЬ · рикошет · лезвие затупилось на ${Math.round(dull * 100)}%`);
    }

    if (mat !== 'stone' && mat !== 'blunt') this.axe.sharpness = Math.max(0.05, this.axe.sharpness - MATERIALS[mat].dull * (0.5 + E01));

    const mpFinal = MATERIALS[mat];
    if (depth > 0) {
      this.trauma = Math.min(1, this.trauma + 0.12 + 0.35 * E01);
      this.kickVelP -= 1.2 * depth * (dir.y < 0 ? 1 : -0.6);
      this.fovPunch += 0.03 * depth;
    } else if (mat !== 'stone') {
      this.trauma = Math.min(1, this.trauma + 0.15 + 0.25 * E01);
      this.kickVelP += 1.0 * E01 + 0.4;
    }
    if (stuck) audio.stuck(mat);

    this.axe.applyContact({
      material: mat, depth, stuck, bounce: mpFinal.bounce,
      hitstop: mpFinal.hitstop * (0.5 + depth) * (0.6 + 0.6 * E01),
      attachTo, pullResist,
    });
  }

  private resolveGround(s: BladeSample, E: number) {
    this.contactCooldown = 0.25;
    const E01 = clamp(E / 300, 0, 1);
    const depth = clamp(E / 160, 0, 1);
    const p = s.pos.clone().setY(0.02);
    this.particles.dustPuff(p, 4 + Math.round(8 * E01));
    audio.impact('blunt', E01 * 0.8);
    this.trauma = Math.min(1, this.trauma + 0.1 + 0.3 * E01);
    this.kickVelP -= 0.8 * depth;
    this.setLog(`удар в землю · ${Math.round(E)} Дж`);
    this.axe.applyContact({ material: 'wood', depth, stuck: false, bounce: 0.05, hitstop: 0.07 * (0.5 + depth), attachTo: null, pullResist: 1.4 });
  }

  private checkPickups() {
    for (const p of this.items.list) {
      if (p.taken) continue;
      const dx = p.mesh.position.x - this.pos.x;
      const dz = p.mesh.position.z - this.pos.z;
      if (dx * dx + dz * dz > 2.6 * 2.6) continue;
      if (p.kind === 'gasoline' && !this.vehicle) continue;
      this.items.take(p);
      switch (p.kind) {
        case 'medkit':
          this.hp = Math.min(100, this.hp + 40);
          this.setLog('Аптечка · +40 здоровья');
          audio.magClick();
          break;
        case 'ammo':
          this.pistol.reserve += 30;
          this.shotgun.reserve += 4;
          this.setLog('Патроны 9мм +30 · 12 калибра +4');
          audio.magClick();
          break;
        case 'shells':
          this.shotgun.reserve += 8;
          this.pistol.reserve += 12;
          this.setLog('Патроны 12 калибра +8');
          audio.magClick();
          break;
        case 'gasoline':
          if (this.vehicle) {
            this.vehicle.hp = Math.min(100, this.vehicle.hp + 40);
            this.setLog('Заправил машину');
          } else {
            this.setLog('Канистра — бензин нужен машине');
            this.items.spawn('gasoline', p.mesh.position.x, p.mesh.position.z, 1);
          }
          audio.magClick();
          break;
        case 'whetstone':
          this.axe.sharpness = 1;
          this.setLog('Заточил лезвие — острота 100%');
          audio.sharpen();
          break;
      }
      this.onEvent?.({ type: 'log', text: p.label });
    }
  }

  // попадание по полицейскому
  private hitOfficer(o: Officer, dmg: number, dir: THREE.Vector3) {
    this.police.hitOfficer(o, dmg, dir);
    this.particles.bloodBurst(o.pos.clone().setY(1.2), dir, 0.6, 18);
    if (o.state === 'dead') {
      this.police.crime(2.5);
      this.setLog('Убит полицейский · розыск');
    }
  }

  private addXp(n: number) {
    this.xp += n;
    const need = 60 + this.level * 40;
    if (this.xp >= need) {
      this.xp -= need;
      this.level++;
      this.axe.sharpness = Math.min(1, this.axe.sharpness + 0.15);
      this.hp = Math.min(100, this.hp + 15);
      this.setLog(`УРОВЕНЬ ${this.level} · +15 HP, лезвие острее`);
    }
  }

  private npcDamage(part: PartName, depth: number) {
    switch (part) {
      case 'head': return 20 + 170 * Math.pow(depth, 1.3);
      case 'torso': return 8 + 95 * Math.pow(depth, 1.4);
      case 'armL': case 'armR': case 'foreL': case 'foreR': return 5 + 40 * depth;
      default: return 7 + 55 * depth;
    }
  }

  private spawnDebris(obj: THREE.Object3D, dir: THREE.Vector3, E01: number, groundY: number) {
    this.scene.attach(obj);
    const vel = dir.clone().multiplyScalar(2 + 5 * E01);
    vel.y += 1.5 + 2 * E01;
    this.physics.fragment(obj, vel, new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 9), groundY);
    this.particles.bloodBurst(obj.position, dir, E01, 30);
  }

  private doYank(strength: number) {
    const mat = this.axe.stuckMat;
    const n = this.axe.stuckData as Npc | null;
    audio.yank(mat, this.axe.pullProgress);
    this.trauma = Math.min(1, this.trauma + 0.12 * strength);
    if (n && n.alive) {
      const d = this.tmp.subVectors(this.camera.position, n.position()); d.y = 0; d.normalize();
      const pull = d.clone();
      n.applyHit(n.lastHitPart ?? 'torso', 5 * strength, d.multiplyScalar(1.6 * strength), 0.45);
      this.particles.bloodBurst(this.axe.headWorld(this.tmp2), pull, 0.3, 8);
      if (n.hp <= 0) { n.kill(pull.negate()); this.kills++; }
    }
    const freed = this.axe.yank(strength);
    if (freed) {
      audio.pullOut(mat);
      this.setLog(mat === 'wood' ? 'Вырвал топор из дерева' : 'Вырвал топор');
      if (mat !== 'wood') {
        const p = this.axe.gripWorld(this.tmp);
        this.particles.bloodBurst(p, this.camera.getWorldDirection(this.tmp2).negate(), 0.5, 18);
        this.onEvent?.({ type: 'splash', amount: 0.4 });
      }
    }
  }

  nearAxe() {
    const g = this.axe.gripWorld(this.tmp);
    return Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 1.8;
  }

  setLog(t: string) {
    this.lastHit = t;
    this.onEvent?.({ type: 'log', text: t });
  }

  // ================= пули =================
  private updateProjectiles(dt: number) {
    this.updateBulletList(this.pistol.bullets, dt);
    this.updateBulletList(this.shotgun.pellets as unknown as { pos: THREE.Vector3; vel: THREE.Vector3; life: number; dmg: number; traveled: number }[], dt);
  }

  // шум привлекает зомби
  noise(radius: number) {
    for (const n of this.npcs) {
      if (n.kind === 'zombie' && n.alive && n.position().distanceTo(this.pos) < radius) {
        n.state = 'walk';
        (n as unknown as { panicT: number }).panicT = 6;
      }
    }
  }

  private updateBulletList(bullets: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; dmg: number; traveled: number }[], dt: number) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const step = b.vel.clone().multiplyScalar(dt);
      const p0 = b.pos.clone();
      const p1 = p0.clone().add(step);
      b.life += dt;
      b.traveled += step.length();

      // трассер
      const tr = this.tracerPool[this.tracerIdx];
      this.tracerIdx = (this.tracerIdx + 1) % this.tracerPool.length;
      tr.visible = true;
      tr.position.copy(p0);
      tr.lookAt(p1);
      (tr.material as THREE.MeshBasicMaterial).opacity = 0.8;

      let hitPoint: THREE.Vector3 | null = null;
      let hitKind: 'npc' | 'world' | 'ground' | 'car' | null = null;
      let hitNpc: Npc | null = null;
      let hitPart: PartName = 'torso';

      // полицейские
      for (const o of this.police.officers) {
        if (o.state === 'dead') continue;
        const d2 = segSegDist2(p0, p1, o.pos.clone().setY(0.2), o.pos.clone().setY(1.7), this.tmp, this.tmp2);
        if (d2 < 0.36) {
          hitPoint = this.tmp2.clone();
          hitKind = 'npc';
          hitNpc = null;
          break;
        }
      }
      // NPC
      if (!hitPoint) for (const n of this.npcs) {
        if (!n.alive) continue;
        if (n.position().distanceTo(p0) > 60) continue;
        n.getCapsules(this.caps);
        for (const cap of this.caps) {
          const d2 = segSegDist2(p0, p1, cap.a, cap.b, this.tmp, this.tmp2);
          if (d2 < cap.r * cap.r) {
            hitPoint = this.tmp2.clone();
            hitKind = 'npc';
            hitNpc = n;
            hitPart = cap.part;
            break;
          }
        }
        if (hitKind) break;
      }
      // машины
      if (!hitPoint) {
        for (const c of this.traffic.cars) {
          const cp = c.root.position;
          if (Math.abs(cp.x - p0.x) > 30 || Math.abs(cp.z - p0.z) > 30) continue;
          const min = new THREE.Vector3(cp.x - 1.1, 0.2, cp.z - 2.3);
          const max = new THREE.Vector3(cp.x + 1.1, 1.6, cp.z + 2.3);
          const h = segAabb(p0, p1, min, max);
          if (h) { hitPoint = h; hitKind = 'car'; break; }
        }
      }
      // здания
      if (!hitPoint) {
        for (const box of this.city.boxes) {
          if (Math.abs((box.min.x + box.max.x) / 2 - p0.x) > 40) continue;
          const h = segAabb(p0, p1, box.min, box.max);
          if (h) { hitPoint = h; hitKind = 'world'; break; }
        }
      }
      // деревья
      if (!hitPoint) {
    for (const t of this.city.treeCaps) {
          const d2 = segSegDist2(p0, p1, t.a, t.b, this.tmp, this.tmp2);
          if (d2 < t.r * t.r) { hitPoint = this.tmp2.clone(); hitKind = 'world'; break; }
        }
      }
      // земля
      if (!hitPoint && p1.y < 0.02) {
        const k = (p0.y - 0.02) / Math.max(0.0001, p0.y - p1.y);
        hitPoint = p0.clone().lerp(p1, clamp(k, 0, 1)).setY(0.02);
        hitKind = 'ground';
      }

      if (hitPoint && hitKind) {
        this.bulletImpact(hitPoint, hitKind, hitNpc, hitPart, b.dmg);
        bullets.splice(i, 1);
        tr.visible = false;
        continue;
      }

      b.pos.copy(p1);
      b.vel.y -= 9.8 * dt * 0.6;
      if (b.life > 1.2 || b.traveled > 260) { bullets.splice(i, 1); tr.visible = false; }
    }
    // плавное затухание трассеров
    for (const tr of this.tracerPool) {
      if (!tr.visible) continue;
      const m = tr.material as THREE.MeshBasicMaterial;
      m.opacity -= dt * 6;
      if (m.opacity <= 0) tr.visible = false;
    }
  }

  private bulletImpact(p: THREE.Vector3, kind: 'npc' | 'world' | 'ground' | 'car', npc: Npc | null, part: PartName, dmg: number) {
    if (kind === 'npc' && !npc) {
      // попадание по полицейскому
      for (const o of this.police.officers) {
        if (o.state === 'dead') continue;
        if (Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.2) {
          this.hitOfficer(o, dmg, new THREE.Vector3(0, 0, 1));
          this.particles.bloodBurst(p, new THREE.Vector3(0, 1, 0), 0.6, 16);
          break;
        }
      }
    } else if (kind === 'npc' && npc) {
      const human = npc.kind === 'human';
      let damage = dmg;
      if (part === 'head') damage = 400;
      else if (part === 'torso') damage = 55;
      else damage = 22;
      if (human) damage *= 0.6;
      npc.addWound(part, p, 0.03);
      this.particles.bloodBurst(p, new THREE.Vector3(0, 1, 0), 0.8, 26);
      npc.applyHit(part, damage, new THREE.Vector3(), 0.2);
      if (npc.hp <= 0) {
        npc.kill(new THREE.Vector3(0, 0, 1));
        if (npc.kind === 'zombie') { this.kills++; this.addXp(14); }
        else { this.civiliansKilled++; this.heat = Math.min(1, this.heat + 0.3); this.police.crime(1.8); }
        this.setLog(npc.kind === 'zombie' ? (part === 'head' ? 'ВЫСТРЕЛ В ГОЛОВУ · УБИТ' : 'ЗОМБИ УБИТ') : 'ГРАЖДАНСКИЙ УБИТ');
      } else this.setLog(part === 'head' ? 'попадание в голову' : `попадание · ${part}`);
      this.onEvent?.({ type: 'splash', amount: 0.6 });
      audio.impact(part === 'head' ? 'bone' : 'flesh', 0.9, 0.6);
    } else if (kind === 'car') {
      this.particles.sparkBurst(p, new THREE.Vector3(0, 1, 0), 0.7);
      audio.impact('stone', 0.6);
      audio.ricochet();
      let best: Car | null = null; let near = 3.3;
      for (const c of this.traffic.cars) { const d = c.pos.distanceTo(p); if (d < near && !c.exploded) { near = d; best = c; } }
      if (best) { this.damageCar(best, dmg * 0.52, 'bullet'); this.setLog(best.hp <= 0 ? 'Машина подбита · пожар' : `кузов повреждён · ${Math.round(100 - best.hp)}%`); }

    } else if (kind === 'world') {
      this.particles.sparkBurst(p, new THREE.Vector3(0, 1, 0), 0.5);
      this.particles.dustPuff(p, 3);
      audio.impact('stone', 0.5);
    } else {
      this.particles.dustPuff(p, 4);
      this.particles.addDecal(p, 0.12);
      audio.impact('blunt', 0.4);
    }
  }

  private updateTraffic(dt: number) {
    this.trafficRefresh -= dt;
    const refresh = this.trafficRefresh <= 0;
    if (refresh) this.trafficRefresh = 0.64;
    for (const car of this.traffic.cars) {
      if (!car.ai || car.isPlayer) continue;
      if (refresh && car.pos.distanceToSquared(this.pos) > 270 ** 2) this.streetLife.recycle(car, this.pos, this.traffic.cars);
      const speed = car.vLong;
      this.streetLife.drive(car, dt, this.traffic.cars, this.npcs, axis => this.city.isGreen(axis), this.wet);
      this.hitPole(car);
      this.traffic.syncVisuals(car, dt, (car.vLong - speed) / Math.max(0.001, dt), car.steer * car.vLong * 0.65);
    }
    this.ambientTrafficTimer -= dt;
    if (this.ambientTrafficTimer <= 0) {
      this.ambientTrafficTimer = 0.18;
      let nearest: Car | undefined;
      let near = 38;
      for (const c of this.traffic.cars) {
        if (!c.ai || c.vLong < 2.4) continue;
        const d = c.pos.distanceTo(this.pos);
        if (d < near) { near = d; nearest = c; }
      }
      const side = nearest ? (Math.cos(this.yaw) * (nearest.pos.x - this.pos.x) - Math.sin(this.yaw) * (nearest.pos.z - this.pos.z)) / Math.max(1, near) : 0;
      audio.trafficBed((1 - near / 38) ** 1.65 * (this.vehicle ? 0.55 : 1), clamp(side, -1, 1), Math.min(1, (nearest?.vLong ?? 0) / 16));
    }
  }

  // ================= NPC =================
  private spawnNpc() {
    const p = this.pos;
    const make = (sx: number, sz: number) => {
      let zombieChance = clamp(0.1 + this.heat * 0.6 + this.dayNight.night * 0.25, 0, 0.85);
      if (this.mode === 'peace') zombieChance = 0;
      if (this.mode === 'police') zombieChance = 0;
      const kind = Math.random() < zombieChance ? 'zombie' : 'human';
      let variant: 'normal' | 'runner' | 'brute' = 'normal';
      if (kind === 'zombie') {
        const r = Math.random();
        if (r < 0.12 + this.heat * 0.12) variant = 'brute';
        else if (r < 0.42) variant = 'runner';
      }
      const n = new Npc({ kind, pos: new THREE.Vector3(sx, this.city.surfaceAt(sx, sz), sz), variant,
        onFall: (npc, dir) => this.physics.fall(npc, dir, npc.vel, npc.lastHitPart ?? undefined) });
      this.scene.add(n.root);
      this.npcs.push(n);
    };
    for (let tries = 0; tries < 18; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 14 + Math.random() * 60;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const gx = Math.round(x / BLOCK) * BLOCK, gz = Math.round(z / BLOCK) * BLOCK;
      const alongX = Math.abs(x - gx) <= Math.abs(z - gz);
      const side = Math.random() < 0.5 ? -1 : 1;
      // 70% — тротуар, 30% — проезжая часть
      const off = ROAD_W / 2 + 1.6;
      const sx = alongX ? gx + side * off : x;
      const sz = alongX ? z : gz + side * off;
      if (Math.abs(sx) > BOUNDS || Math.abs(sz) > BOUNDS || this.city.blockedAt(sx, sz, 0.3)) continue;
      if (Math.hypot(sx - p.x, sz - p.z) < 10) continue;
      make(sx, sz);
      return;
    }
    // запасной вариант — прямо на улице
    const a2 = Math.random() * Math.PI * 2;
    const d2 = 18 + Math.random() * 45;
    const safe = streetPoint({ x: p.x + Math.cos(a2) * d2, z: p.z + Math.sin(a2) * d2 });
    if (distance(safe, p) > 11 && !this.city.blockedAt(safe.x, safe.z, .4)) make(safe.x, safe.z);
  }

  private updateNpcs(dt: number) {
    const camP = this.camera.position;
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      this.streetLife.walk(n, dt, this.traffic.cars, axis => this.city.isGreen(axis), p => this.city.blockedAt(p.x, p.z, .3));
      const done = n.update(dt, this.pos, this.npcs, (p, r) => { this.cityCollide(p, r); this.city.keepOnLand(p); }, () => this.npcAttack(n));
      if (n.alive) n.root.position.y = this.city.surfaceAt(n.root.position.x, n.root.position.z);
      if (n.kind === 'zombie' && n.alive && n.wantsGroan()) audio.zombieGroan(clamp(n.position().distanceTo(camP) / 30, 0, 1));
      if (n.state === 'dead' && n.deadTime > 8 && this.axe.stuckData === n) this.axe.dropToWorld();
      if (done || n.position().distanceTo(camP) > 130) {
        if (this.axe.stuckData === n) this.axe.dropToWorld();
        this.physics.removeDoll(n.root);
        this.scene.remove(n.root);
        this.npcs.splice(i, 1);
      }
    }
    // пополнение населения
    this.spawnTimer -= dt;
    const target = this.quality === 'high' ? 28 : 20;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.22;
      if (this.npcs.length < target) this.spawnNpc();
    }
    // кровь из культей
    this.bleedTimer -= dt;
    if (this.bleedTimer <= 0) {
      this.bleedTimer = 0.08;
      for (const n of this.npcs) {
        for (const s of n.stumps) {
          if (s.time <= 0) continue;
          s.time -= 0.08;
          const wp = s.obj.localToWorld(s.local.clone());
          this.particles.bloodDrip(wp);
        }
      }
    }
  }

  private cityCollide(p: THREE.Vector3, r: number) {
    this.city.collide(p, r);
  }

  private npcAttack(n: Npc) {
    if (this.gameOver || this.vehicle) return;
    const dmg = n.crawler ? 8 : 13;
    this.hp = Math.max(0, this.hp - dmg);
    audio.zombieBite();
    audio.playerHurt();
    this.trauma = Math.min(1, this.trauma + 0.5);
    const d = this.tmp.subVectors(this.pos, n.position()); d.y = 0; d.normalize();
    this.vel.addScaledVector(d, 2.5);
    this.kickVelP += (Math.random() - 0.5) * 3;
    this.kickVelY += (Math.random() - 0.5) * 3;
    this.onEvent?.({ type: 'hurt' });
    if (this.hp <= 0) {
      this.gameOver = true;
      this.axe.cancel();
      this.setLog('Ты мёртв');
    }
  }

  // ================= цикл =================
  start() {
    if (this.running) return;
    this.running = true;
    if (!this.npcs.length) for (let i = 0; i < 13; i++) this.spawnNpc();
    this.police.populatePatrol(this.pos, (x, z) => this.city.blockedAt(x, z, 0.35));
    this.radio.start();
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      if (this.paused && !this.redraw) return;
      if (!this.paused) this.update(dt);
      this.redraw = false;
      if (this.composer && this.quality === 'high') this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.physics.clear();
    this.dayNight.dispose();
    this.composer?.dispose(); this.bloom?.dispose(); this.output?.dispose();
    this.renderer.dispose();
  }

  private update(dt: number) {
    if (this.gameOver) this.resetInput();
    this.time += dt;
    const now = performance.now();
    this.fpsCount++;
    if (now - this.fpsAcc > 500) { this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsAcc)); this.fpsAcc = now; this.fpsCount = 0; }

    // клавиатура
    if (this.keys.size) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (x || y) { this.moveInput.set(x, y); this.kbActive = true; }
      else if (this.kbActive) { this.moveInput.set(0, 0); this.kbActive = false; }
    } else if (this.kbActive) { this.moveInput.set(0, 0); this.kbActive = false; }

    // смена оружия
    this.weaponSwitch = Math.max(0, this.weaponSwitch - dt * 4);
    const inVehicle = !!this.vehicle;
    const firstPerson = !inVehicle && this.onFootCam === 0;
    this.axe.setVisible(this.weapon === 'axe' && firstPerson);
    this.pistol.group.visible = this.weapon === 'pistol' && firstPerson;
    this.shotgun.group.visible = this.weapon === 'shotgun' && firstPerson;
    this.playerRig.root.visible = !inVehicle && this.onFootCam === 1;

    this.city.updateLights(dt);
    this.radio.setVolume(this.vehicle ? 0.8 : 0.42);

    // день/ночь
    this.dayNight.cloudCover = 0.36 + this.weather.intensity * 0.52;
    this.dayNight.update(dt, this.pos, this.scene);
    this.dayNight.sun.intensity *= 1 - this.weather.intensity * 0.67;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density += this.weather.intensity * 0.0015;
    this.city.setNight(this.dayNight.night);
    this.traffic.setNight(this.dayNight.night);
    this.renderer.toneMappingExposure = 0.98 - this.dayNight.sunOcclusion * 0.18 - this.weather.intensity * 0.055;

    // машина или пешком
    if (this.vehicle) this.driveCar(dt);
    else this.updatePlayer(dt);
    this.updateCamera(dt);
    this.camera.updateMatrixWorld(true);
    // Combat transforms stay at the player when the visual camera is behind them.
    if (this.onFootCam === 1 && !inVehicle) {
      this.weaponView.position.copy(this.pos).add(this.tmp.set(0, this.eyeHeight, 0));
      this.weaponView.rotation.set(this.camLagPitch + this.kickPitch, this.camLagYaw + this.kickYaw, 0, 'YXZ');
    } else {
      this.weaponView.position.copy(this.camera.position);
      this.weaponView.quaternion.copy(this.camera.quaternion);
    }
    this.weaponView.updateMatrixWorld(true);
    this.updateRoute(dt);
    this.playerRig.root.position.copy(this.pos);
    this.playerRig.root.rotation.y = this.yaw + Math.PI;
    const gait = Math.sin(this.bobPhase) * Math.min(0.5, this.vel.length() * 0.13);
    this.playerRig.parts.thighL.rotation.x = gait;
    this.playerRig.parts.thighR.rotation.x = -gait;
    this.playerRig.parts.armL.rotation.x = -gait * 0.7;
    this.playerRig.parts.armR.rotation.x = gait * 0.7;
    this.torch.position.copy(this.camera.position);
    this.torchTarget.position.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(this.tmp), 20);
    this.torch.intensity = this.dayNight.night * 16;
    this.torch.visible = this.dayNight.night > 0.03;
    if (this.vehicle) {
      const c = this.vehicle, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      this.torch.position.set(c.pos.x + fx * c.spec.halfLength, 0.76, c.pos.z + fz * c.spec.halfLength);
      this.torchTarget.position.set(c.pos.x + fx * 18, 0.2, c.pos.z + fz * 18);
      this.torch.intensity = this.dayNight.night * 98;
    }
    this.lampTimer -= dt;
    if (this.lampTimer < 0) {
      this.lampTimer = 0.33;
      const lamps = [...this.city.streetLightPos].sort((a, b) => a.distanceToSquared(this.pos) - b.distanceToSquared(this.pos));
      this.lampPool.forEach((light, i) => { if (lamps[i]) light.position.copy(lamps[i]); });
    }
    const lampPower = this.dayNight.night * (this.dayNight.sunOcclusion * 0.32 + 0.68);
    this.lampPool.forEach(l => { l.intensity = lampPower * 17; l.visible = this.dayNight.night > 0.037; });
    // Nearby traffic headlights illuminate the street at night.
    this.followLampTimer -= dt;
    const following = this.traffic.cars.filter(c => (c.isPlayer || c.lightsOn) && !c.exploded).sort((a, b) => a.pos.distanceToSquared(this.pos) - b.pos.distanceToSquared(this.pos)).slice(0, this.carLampPool.length);
    this.carLampPool.forEach((lamp, i) => {
      const car = following[i];
      const on = !!car && this.dayNight.night > 0.16;
      lamp.visible = on;
      if (!car || !on) return;
      lamp.position.set(car.pos.x + Math.sin(car.yaw) * (car.spec.halfLength + 0.08), 0.69, car.pos.z + Math.cos(car.yaw) * (car.spec.halfLength + 0.08));
      (lamp.target as THREE.Object3D).position.set(car.pos.x + Math.sin(car.yaw) * 17, 0.05, car.pos.z + Math.cos(car.yaw) * 17);
      lamp.intensity = this.dayNight.night * 80;
    });

    // оружие
    // Sprinting costs 26 stamina per second; the weapon's passive regeneration is overridden while running.
    const staminaBeforeAxe = this.axe.stamina;
    this.axe.update(dt, this.camAngVel, this.vel.length(), this.bobPhase);
    if (this.sprintActive) this.axe.stamina = Math.max(0, staminaBeforeAxe - 26 * dt);
    this.contactCooldown -= dt;
    if (!inVehicle && this.weapon === 'axe' && (this.axe.state === 'strike' || (this.axe.state === 'recover' && Math.abs(this.axe.omega) > 6)) && this.contactCooldown <= 0) {
      this.checkContacts(dt);
    }
    // застрявший топор
    if (this.axe.state === 'stuck') {
      if (!this.nearAxe()) { this.axe.leaveBehind(); this.setLog('Топор остался — вернись за ним'); }
      else if (this.pullHold) {
        this.axe.pullProgress += dt * 0.35 / this.axe.pullNeed;
        if (this.axe.pullProgress >= 1) this.doYank(0.01);
      }
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.pistol.update(dt, this.camera, sp, this.camAngVel, this.adsHold && !this.vehicle && this.weapon === 'pistol');
    this.shotgun.update(dt, this.camera, sp, this.camAngVel, this.adsHold && !this.vehicle && this.weapon === 'shotgun');
    if (this.weapon === 'pistol' && this.fireHold) {
      const spread = (this.pistol.ads > 0.5 ? 0.004 : 0.018) * (this.stance === 'stand' ? 1 : this.stance === 'crouch' ? 0.76 : 0.58);
      const r = this.pistol.tryFire(this.weaponView, spread);
      if (r.ok) {
        audio.gunshot(1);
        audio.shellDrop();
        this.kickVelP -= 5.5;
        this.kickYaw += (Math.random() - 0.5) * 1.6;
        this.trauma = Math.min(1, this.trauma + 0.22);
        this.heat = Math.min(1, this.heat + 0.035);
        // выстрел в городе — преступление
        this.police.crime(0.22);
        this.witnessed(0.2);
        this.noise(40);
      } else if (r.reason === 'empty') {
        audio.dryFire();
        this.fireHold = false;
        this.reload();
      }
    }
    if (this.weapon === 'shotgun' && this.fireHold) {
      const spread = (this.shotgun.ads > 0.5 ? 0.035 : 0.075) * (this.stance === 'stand' ? 1 : this.stance === 'crouch' ? 0.78 : 0.61);
      if (this.shotgun.tryFire(this.weaponView, spread)) {
        audio.gunshot(1.4);
        audio.shellDrop();
        this.kickVelP -= 9;
        this.kickYaw += (Math.random() - 0.5) * 3;
        this.trauma = Math.min(1, this.trauma + 0.4);
        this.heat = Math.min(1, this.heat + 0.05);
        this.police.crime(0.4);
        this.witnessed(0.35);
        this.noise(55);
      } else if (this.shotgun.shells <= 0 && !this.shotgun.reloading) {
        audio.dryFire();
        this.fireHold = false;
        this.reload();
      }
    }
    this.updateProjectiles(dt);

    // предметы
    this.items.update(dt);
    this.checkPickups();

    // полиция
    if (this.mode === 'peace' && this.police.wanted === 0) { /* спокойный город */ }
    this.police.update(dt, this.pos, (x, z) => this.city.blockedAt(x, z, 0.6), (from, dir) => {
      if (this.gameOver) return;
      audio.gunshot(0.7);
      // шанс попасть по игроку
      const dist = from.distanceTo(this.pos);
      const hitChance = clamp(0.55 - dist * 0.012, 0.08, 0.5);
      const tracer = this.tracerPool[this.tracerIdx];
      this.tracerIdx = (this.tracerIdx + 1) % this.tracerPool.length;
      tracer.visible = true;
      tracer.position.copy(from);
      tracer.lookAt(from.clone().addScaledVector(dir, 12));
      (tracer.material as THREE.MeshBasicMaterial).opacity = 0.8;
      if (Math.random() < hitChance) {
        this.hp = Math.max(0, this.hp - 7);
        this.trauma = Math.min(1, this.trauma + 0.3);
        this.onEvent?.({ type: 'hurt' });
        this.onEvent?.({ type: 'splash', amount: 0.3 });
        if (this.hp <= 0) { this.gameOver = true; this.setLog('Ты убит полицией'); }
      }
    });
    this.wanted = this.police.stars;
    // сирена — громче, когда полиция рядом
    if (this.police.stars > 0) {
      const near = this.police.cars.length ? Math.min(...this.police.cars.map((c) => c.pos.distanceTo(this.pos))) : 999;
      audio.startSiren();
      audio.setSirenVolume(clamp(1 - near / 60, 0, 1));
    } else {
      audio.stopSiren();
    }
    audio.setRain(this.weather.intensity);

    // погода: дождь по времени суток
    const hr = this.dayNight.time;
    const rainChance = hr > 20 || hr < 4 ? 0.85 : hr > 13 && hr < 19 ? 0.35 : 0.08;
    if (this.weatherMode === 'auto' && Math.random() < dt * 0.027) this.weather.setTarget(Math.random() < rainChance ? 1 : 0);
    this.weather.update(dt, this.pos);
    this.wet = lerp(this.wet, this.weather.intensity * 0.86 + 0.17, 1 - Math.exp(-dt * 0.22));
    this.city.updateVisuals(dt, this.pos, this.dayNight.night, this.dayNight.sunDir, this.wet);

    // NPC
    this.updateNpcs(dt);

    // трафик
    this.updateTraffic(dt);
    this.traffic.updateSkids(dt);

    this.updateVehicleFires(dt);
    this.updateEmergencyServices(dt);
    this.emergencies.update(dt, this.camera.position, this.traffic.cars, this.npcs, this.pos, this.particles);
    for (const fire of this.emergencies.fires) {
      if (Math.random() < 0.24) {
        audio.fireCrackle();
        this.particles.sparkBurst(fire.pos.clone().setY(fire.pos.y + 0.7), this.tmp.set(0, 1, 0), 0.16);
      }
    }
    for (const c of this.traffic.cars) if (c.fire > 0 && !c.exploded && !this.emergencies.fires.some(f => f.car === c)) c.fire = 0;
    for (const fire of this.emergencies.fires) {
      const d = this.pos.distanceTo(fire.pos);
      if (d < 4.8 && !this.vehicle) {
        const damage = dt * (7.5 * (1 - d / 4.8) + 1.2) * fire.intensity;
        this.hp = Math.max(0, this.hp - damage);
        if (Math.random() < dt * 4) this.onEvent?.({ type: 'hurt' });
        if (this.hp <= 0) { this.gameOver = true; this.setLog('Ты погиб в огне'); }
      }
    }
    this.noticeTimer = Math.max(0, this.noticeTimer - dt);
    if (this.noticeTimer <= 0) this.notice = '';
    this.crackleTimer -= dt;
    if (this.crackleTimer <= 0) {
      const burning = this.traffic.cars.filter(c => c.fire > 0 && c.pos.distanceToSquared(this.pos) < 1500);
      if (burning.length) { this.crackleTimer = 0.3 + Math.random() * 0.7; audio.fireCrackle(); }
    }
    this.physics.step(dt);
    this.particles.update(dt);

    // «жар» растёт со временем и от выстрелов
    this.heat = Math.min(1, this.heat + dt * 0.006);
    if (this.heat > 0.95) this.heat = 0.3;

    // сердцебиение
    if (this.hp < 35 && !this.gameOver) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.heartT = lerp(0.6, 1.1, this.hp / 35); audio.heartbeat(); }
    }

    // HUD
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      let zAlive = 0, cAlive = 0;
      for (const n of this.npcs) { if (n.alive) { if (n.kind === 'zombie') zAlive++; else cAlive++; } }
      this.onHud?.({
        hp: this.hp,
        stamina: this.axe.stamina,
        sharpness: this.axe.sharpness,
        kills: this.kills,
        charge: this.axe.state === 'windup' ? this.axe.charge : 0,
        overcharge: this.axe.overcharge,
        axeState: this.axe.state,
        pullProgress: this.axe.pullProgress,
        zombiesAlive: zAlive,
        civiliansAlive: cAlive,
        gameOver: this.gameOver,
        lastHit: this.lastHit,
        weapon: this.weapon,
        ammo: this.pistol.ammo,
        reserve: this.pistol.reserve,
        reloading: this.weapon === 'shotgun' ? this.shotgun.reloading : this.pistol.reloading,
        clock: this.dayNight.clock,
        night: this.dayNight.night,
        inCar: !!this.vehicle,
        speed: this.vehicle ? Math.abs(this.vehicle.vLong) * 3.6 : 0,
        heat: this.heat,
        nearCar: !this.vehicle && !!this.nearestCar(),
        ads: (this.weapon === 'shotgun' ? this.shotgun.ads : this.pistol.ads) > 0.5,
        fps: this.fps,
        wanted: this.police.stars,
        shells: this.shotgun.shells,
        shellReserve: this.shotgun.reserve,
        raining: this.weather.intensity > 0.25,
        level: this.level,
        xp: this.xp,
        carCam: this.carCamMode,
        onFootCam: this.onFootCam === 1,
        gear: this.vehicle?.gearText ?? 'P',
        carHealth: this.vehicle?.hp ?? 100,
        district: districtAt(this.pos),
        serviceAvailable: this.canServiceCar(),
        stance: this.stance,
        fires: this.emergencies.burningCount,
        station: this.radio.station.name,
        sprinting: this.sprintActive,
        dispatch: this.emergencies.dispatchTimer > 0 ? this.emergencies.dispatchText : (this.noticeTimer > 0 ? this.notice : ''),
        cloud: this.dayNight.sunOcclusion,
        nearEmergency: (() => { const c = this.nearestCar(); return c && (c.kind === 'fire' || c.kind === 'ambulance') ? c.kind : null; })(),
        carEngine: this.vehicle?.engineDamage ?? 0,
        carTires: this.vehicle?.tireDamage ?? 0,
      });
    }
  }

  setMode(m: GameMode) {
    this.mode = m;
    if (m === 'peace') {
      // убрать зомби из города
      for (let i = this.npcs.length - 1; i >= 0; i--) {
        const n = this.npcs[i];
        if (n.kind === 'zombie') {
          this.physics.removeDoll(n.root);
        this.scene.remove(n.root);
          this.npcs.splice(i, 1);
        }
      }
      this.police.wanted = 0;
      this.heat = 0;
    }
    if (m === 'police') {
      this.police.crime(1.2);
    }
    this.setLog(m === 'peace' ? 'Мирный режим: в городе только люди' : m === 'police' ? 'Полицейская смена: нарушитель в городе' : 'Зомби-апокалипсис');
  }

  setQuality(q: 'low' | 'high') {
    this.quality = q;
    this.physics.maxDolls = q === 'high' ? 6 : 4;
    this.dayNight.setQuality(q === 'high');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.35 : 0.85));
    this.renderer.shadowMap.enabled = q === 'high';
    if (q === 'low') {
      this.renderer.shadowMap.type = THREE.BasicShadowMap;
      this.scene.environmentIntensity = 0.7;
    } else {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer.shadowMap.needsUpdate = true;
    if (this.bloom) this.bloom.strength = q === 'high' ? 0.16 : 0;
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.resize();
  }

  restart() {
    for (const n of this.npcs) this.scene.remove(n.root);
    this.npcs = [];
    this.physics.clear();
    if (this.vehicle) this.exitCar();
    this.resetInput();
    for (const o of this.police.officers) this.scene.remove(o.root);
    for (const c of this.police.cars) this.scene.remove(c.root);
    this.police.officers = []; this.police.cars = [];
    this.police.wanted = this.police.stars = this.police.heat = 0;
    this.shotgun.shells = 6; this.shotgun.reserve = 24;
    this.shotgun.pellets = []; this.pistol.bullets = [];
    this.shotgun.reloading = this.pistol.reloading = false;
    audio.stopSiren();
    if (this.axe.state === 'stuck' || this.axe.state === 'left') this.axe.freeFromStuck(false);
    this.axe.sharpness = 1;
    this.axe.stamina = 100;
    this.axe.state = 'idle';
    this.pistol.ammo = 15;
    this.pistol.reserve = 90;
    this.hp = 100;
    this.kills = 0;
    this.civiliansKilled = 0;
    this.heat = 0;
    this.gameOver = false;
    this.emergencies.fires = [];
    for (const c of this.traffic.cars) { c.fire = 0; c.exploded = false; c.burned = false; c.hp = 100; c.damage = 0; c.engineDamage = 0; c.tireDamage = 0; }
    this.stance = 'stand'; this.adsHold = false;
    this.pos.set(START.x, 0, START.z);
    this.yaw = this.pitch = this.camLagYaw = this.camLagPitch = 0;
    this.setDestination(null);
    this.vel.set(0, 0, 0);
    this.dayNight.setTime(16.8);
  }
}

export { BLOCK, ROAD_W };
