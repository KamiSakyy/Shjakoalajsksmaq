import * as THREE from 'three';
import type { Material } from './audio';
import type { Textures } from './materials';
import { AXE_BY_ID, DEFAULT_AXE, buildAxe, type AxeSpec } from './axes';

export type AxeState = 'idle' | 'windup' | 'strike' | 'recover' | 'stuck' | 'left';

export interface BladeSample {
  pos: THREE.Vector3; // мировая позиция сейчас
  prev: THREE.Vector3; // мировая позиция прошлый кадр
  d: number; // расстояние от хвата по рукояти
  isBlade: boolean;
  valid: boolean;
}

export interface ContactResponse {
  material: Material;
  depth: number; // 0..1 доля глубины лезвия
  stuck: boolean;
  bounce: number;
  hitstop: number;
  attachTo: THREE.Object3D | null;
  pullResist: number;
}

export interface Feedback {
  shake(trauma: number): void;
  kick(pitch: number, yaw: number): void;
  fovPunch(amount: number): void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Axe {
  // ===== физика =====
  spec: AxeSpec = AXE_BY_ID.get(DEFAULT_AXE)!;
  L = 0.82; // длина рукояти, м
  mHead = 1.7; // кг — тяжёлая голова
  mHandle = 0.9; // кг — рукоять
  I: number; // момент инерции относительно хвата
  gravArm: number; // m*L для момента силы тяжести
  private Iref = 1.345; // инерция эталонного топора — база для крутящего момента

  theta = -0.5; // угол в плоскости удара (рад); + назад за плечо, − вперёд/вниз
  omega = 0; // угловая скорость
  psi = 0.9; // наклон плоскости удара (0 — вертикальный сверху, −: справа, +: слева)
  psiTarget = 0.9;
  psiVel = 0;
  roll = 0; // перекос лезвия (ошибка хвата) — влияет на то, лезвием ли попали
  rollTarget = 0;

  thetaIdle = -0.5;
  psiIdle = 0.9;
  thetaTop = 1.45; // максимум замаха
  extend = 0; // вытягивание рук вперёд во время удара

  state: AxeState = 'idle';
  charge = 0; // накопленная сила замаха 0..1 (от реального угла!)
  holdTime = 0;
  overcharge = 0;
  bodyBonus = 0;
  hitstop = 0;
  vibration = 0; // дрожь после удара о камень
  sting = 0; // «отбитые руки» — временная потеря контроля
  sharpness = 1;
  bloodLevel = 0;
  stamina = 100;
  swingPower = 0; // сила последнего удара (для HUD)
  time = 0;
  whooshed = false;
  strikeTorque = 0;

  // застревание
  stuckMat: Material = 'flesh';
  pullProgress = 0;
  pullNeed = 1;
  stuckObject: THREE.Object3D | null = null;
  pullHold = false;
  wiggle = 0;
  stuckData: any = null; // ссылка на объект-владельца (зомби/дерево)

  // ===== сцена =====
  rig = new THREE.Group(); // точка хвата относительно камеры, со sway
  pivot = new THREE.Group(); // ориентация Rz(psi)*Rx(theta)
  axeRoot = new THREE.Group(); // модель топора, рукоять вдоль +Y, лезвие в −Z
  armL: THREE.Group;
  armR: THREE.Group;
  handL: THREE.Mesh;
  handR: THREE.Mesh;
  foreL: THREE.Mesh;
  foreR: THREE.Mesh;
  bloodMesh!: THREE.Mesh;
  edgeMesh!: THREE.Mesh;
  handSlide = 0.38; // позиция верхней руки по рукояти
  handSlideTarget = 0.38;

  swayRot = new THREE.Vector2();
  swayVel = new THREE.Vector2();
  swayPos = new THREE.Vector3();
  rigBase = new THREE.Vector3(0.12, -0.46, -0.44);

  samples: BladeSample[] = [];
  private sampleLocal: { y: number; z: number; d: number; isBlade: boolean }[] = [];
  trail!: THREE.Line;
  private trailPos!: THREE.Float32BufferAttribute;
  private trailLife: number[] = [];
  private trailCount = 26;

  feedback: Feedback | null = null;
  onWhoosh: ((speed01: number) => void) | null = null;

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private X = new THREE.Vector3(1, 0, 0);
  private Z = new THREE.Vector3(0, 0, 1);

  constructor(public camera: THREE.Camera, public scene: THREE.Scene, private tex: Textures) {
    this.I = this.mHead * this.L * this.L + (this.mHandle * this.L * this.L) / 3;
    this.gravArm = (this.mHead * this.L + (this.mHandle * this.L) / 2) * 9.81;

    camera.add(this.rig);
    this.rig.position.copy(this.rigBase);
    this.rig.add(this.pivot);
    this.pivot.add(this.axeRoot);

    // ---- руки ----
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xb98a66, roughness: 0.75 });
    const sleeveMat = new THREE.MeshStandardMaterial({ map: tex.cloth, color: 0x6a6a5a, roughness: 0.95 });
    const mkArm = () => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 1, 10), sleeveMat);
      fore.geometry.translate(0, 0.5, 0);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), skinMat);
      hand.scale.set(1, 1.25, 0.9);
      // пальцы
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), skinMat);
        f.position.set(-0.02 + i * 0.014, 0.01, -0.03);
        f.rotation.x = Math.PI / 2 + 0.6;
        hand.add(f);
      }
      g.add(fore);
      g.add(hand);
      return { g, fore, hand };
    };
    const a1 = mkArm();
    const a2 = mkArm();
    this.armL = a1.g; this.foreL = a1.fore; this.handL = a1.hand;
    this.armR = a2.g; this.foreR = a2.fore; this.handR = a2.hand;
    camera.add(this.armL, this.armR);

    // ---- след лезвия (до первого equip: поза уже его использует) ----
    const tg = new THREE.BufferGeometry();
    this.trailPos = new THREE.Float32BufferAttribute(new Float32Array(this.trailCount * 3), 3);
    tg.setAttribute('position', this.trailPos);
    const tm = new THREE.LineBasicMaterial({ color: 0xcfd8e6, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.trail = new THREE.Line(tg, tm);
    this.trail.frustumCulled = false;
    for (let i = 0; i < this.trailCount; i++) this.trailLife.push(0);
    scene.add(this.trail);

    // ---- точка коллайдера и модель собираются под конкретный топор ----
    this.equip(this.spec, true);

  }

  /**
   * Взять другой топор: пересобираем голову и рукоять, пересчитываем инерцию,
   * точки коллайдера кромки и посадку в руках.
   */
  equip(spec: AxeSpec, initial = false) {
    this.spec = spec;
    this.L = spec.L;
    this.mHead = spec.headMass;
    this.mHandle = spec.handleMass;
    this.I = this.mHead * this.L * this.L + (this.mHandle * this.L * this.L) / 3;
    this.gravArm = (this.mHead * this.L + (this.mHandle * this.L) / 2) * 9.81;

    // чистим прошлую модель
    for (const child of [...this.axeRoot.children]) {
      this.axeRoot.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat?.dispose();
    }
    const built = buildAxe(spec, this.tex);
    for (const child of [...built.root.children]) this.axeRoot.add(child);
    built.root.clear();
    this.bloodMesh = built.blood;
    this.edgeMesh = built.edge;

    // посадка: длинные топоры держим дальше от лица
    this.rigBase.set(0.12, -0.46 - Math.max(0, spec.L - 0.8) * 0.22, -0.44 - Math.max(0, spec.L - 0.8) * 0.16);
    this.rig.position.copy(this.rigBase);

    // точки кромки под новую геометрию
    const bladeZ = -spec.bladeW * 0.97;
    const hy = built.headY;
    this.sampleLocal.length = 0;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      this.sampleLocal.push({ y: built.edgeY0 + t * (built.edgeY1 - built.edgeY0), z: bladeZ + Math.sin(t * Math.PI) * -0.006, d: hy, isBlade: true });
    }
    this.sampleLocal.push({ y: built.tipY, z: -spec.bladeW * 0.62, d: this.L, isBlade: true });
    this.sampleLocal.push({ y: this.L * 0.35, z: 0, d: this.L * 0.35, isBlade: false });
    this.sampleLocal.push({ y: this.L * 0.6, z: 0, d: this.L * 0.6, isBlade: false });
    this.sampleLocal.push({ y: this.L * 0.85, z: 0.03, d: this.L * 0.85, isBlade: false });

    // список мировых сэмплов должен совпадать по длине с локальным
    this.samples.length = 0;
    for (let i = 0; i < this.sampleLocal.length; i++) {
      this.samples.push({ pos: new THREE.Vector3(), prev: new THREE.Vector3(), d: 0, isBlade: false, valid: false });
    }

    this.state = 'idle';
    this.theta = this.thetaIdle;
    this.omega = 0;
    this.sharpness = Math.max(this.sharpness, initial ? 1 : this.sharpness);
    this.updatePose();
    this.refreshSamples(true);
  }

  setVisible(v: boolean) {
    this.rig.visible = v;
    this.armL.visible = v;
    this.armR.visible = v;
    this.trail.visible = v;
  }

  // обновление следа: точки кончика лезвия
  private updateTrail(dt: number) {
    const tip = this.tmpV.set(0, this.L - 0.055, -0.15);
    this.axeRoot.localToWorld(tip);
    const arr = this.trailPos.array as Float32Array;
    // сдвигаем историю
    for (let i = this.trailCount - 1; i > 0; i--) {
      arr[i * 3] = arr[(i - 1) * 3];
      arr[i * 3 + 1] = arr[(i - 1) * 3 + 1];
      arr[i * 3 + 2] = arr[(i - 1) * 3 + 2];
      this.trailLife[i] = this.trailLife[i - 1];
    }
    arr[0] = tip.x; arr[1] = tip.y; arr[2] = tip.z;
    this.trailLife[0] = 1;
    const fast = Math.abs(this.omega) > 6;
    for (let i = 0; i < this.trailCount; i++) {
      this.trailLife[i] = Math.max(0, this.trailLife[i] - dt * (fast ? 2.6 : 5));
    }
    (this.trail.material as THREE.LineBasicMaterial).opacity = fast ? 0.55 : 0.12;
    this.trailPos.needsUpdate = true;
  }

  // ===== управление =====
  beginWindup() {
    if (this.state !== 'idle' && this.state !== 'recover') return;
    this.state = 'windup';
    this.holdTime = 0;
    this.overcharge = 0;
    this.psiTarget = -0.12;
    this.handSlideTarget = 0.62;
    this.whooshed = false;
  }

  // Направление пальца во время замаха задаёт плоскость удара
  steerSwing(dx: number, dy: number) {
    if (this.state !== 'windup') return;
    const h = clamp(dx / 110, -1, 1);
    const v = clamp(-dy / 110, -1, 1);
    // влево — замах слева (+psi), вправо — справа (−psi); вверх — ближе к вертикали
    let psi = -h * 1.35;
    psi *= 1 - 0.6 * clamp(v, 0, 1);
    this.psiTarget = psi;
  }

  release() {
    if (this.state !== 'windup') return;
    const q = clamp((this.theta - this.thetaIdle) / (this.thetaTop - this.thetaIdle), 0, 1);
    this.charge = q;
    this.bodyBonus = clamp((this.holdTime - 0.35) / 0.8, 0, 1) * 0.22;
    const staminaF = 0.5 + 0.5 * clamp(this.stamina / 100, 0, 1);
    // тяжёлый топор разгоняется медленнее: момент масштабируем по инерции,
    // иначе кувалда просто не долетала бы до цели
    const inertiaF = this.I / this.Iref;
    this.strikeTorque = 135 * staminaF * (1 + this.bodyBonus) * inertiaF * this.spec.speed;
    // неточный хват: слабый/торопливый или перетянутый замах → лезвие уходит с линии
    const sloppy = (1 - q) * 0.5 + this.overcharge * 0.5 + (1 - staminaF) * 0.4;
    this.rollTarget = (Math.random() - 0.5) * 2 * sloppy * 1.1;
    this.state = 'strike';
    this.handSlideTarget = 0.16;
    this.stamina = Math.max(0, this.stamina - (6 + 16 * q) * this.spec.stamina);
    this.swingPower = q;
    this.whooshed = false;
    this.feedback?.fovPunch(0.04 + 0.08 * q);
  }

  cancel() {
    if (this.state === 'windup') {
      this.state = 'recover';
      this.handSlideTarget = 0.38;
    }
  }

  // ===== контакт =====
  applyContact(r: ContactResponse) {
    this.hitstop = r.hitstop;
    this.bloodLevel = r.material === 'flesh' || r.material === 'bone' ? Math.min(1, this.bloodLevel + 0.35 + r.depth * 0.5) : this.bloodLevel;
    if (r.stuck && r.attachTo) {
      this.state = 'stuck';
      this.stuckMat = r.material;
      this.pullProgress = 0;
      this.pullNeed = r.pullResist;
      this.stuckObject = r.attachTo;
      this.omega = 0;
      // «отцепляем» топор от рук: он теперь в объекте
      this.axeRoot.updateWorldMatrix(true, false);
      r.attachTo.attach(this.axeRoot);
      return;
    }
    if (r.depth > 0) {
      // лезвие вошло: скорость резко падает, затем мягкий отскок
      this.omega = -this.omega * 0.08 * (1 - r.depth) - Math.sign(this.omega) * 0.6;
      this.omega = this.omega * 0.5;
    } else {
      // рикошет / тупой удар — отражение с потерей энергии
      this.omega = -this.omega * r.bounce;
      if (r.material === 'stone') {
        this.vibration = 1;
        this.sting = 0.5;
      }
    }
    this.state = 'recover';
    this.handSlideTarget = 0.38;
  }

  // ===== выдёргивание =====
  yank(strength: number) {
    if (this.state !== 'stuck') return false;
    this.pullProgress += strength / this.pullNeed;
    this.wiggle = 1;
    this.feedback?.kick(-0.015 * strength, (Math.random() - 0.5) * 0.01);
    if (this.pullProgress >= 1) {
      this.freeFromStuck(true);
      return true;
    }
    return false;
  }

  freeFromStuck(withRecoil: boolean) {
    // вычислим текущий угол рукояти относительно хвата, чтобы не было телепорта
    this.rig.updateWorldMatrix(true, false);
    const axeQ = this.axeRoot.getWorldQuaternion(this.tmpQ);
    const rigQ = this.rig.getWorldQuaternion(this.tmpQ2).invert();
    const qLocal = rigQ.multiply(axeQ);
    this.tmpV.set(0, 1, 0).applyQuaternion(qLocal);
    this.theta = clamp(Math.asin(clamp(this.tmpV.z, -1, 1)), -2.6, 1.8);
    this.psi = Math.atan2(-this.tmpV.x, this.tmpV.y);
    if (!isFinite(this.psi)) this.psi = this.psiIdle;
    this.psiVel = 0;
    this.pivot.add(this.axeRoot);
    this.axeRoot.position.set(0, 0, 0);
    this.axeRoot.scale.set(1, 1, 1);
    this.axeRoot.quaternion.identity();
    this.axeRoot.rotation.y = this.roll;
    this.updatePose();
    this.refreshSamples(true);
    this.omega = withRecoil ? 7 : 0; // отдача назад к себе
    this.state = 'recover';
    this.stuckObject = null;
    this.stuckData = null;
    this.handSlideTarget = 0.38;
    this.feedback?.kick(-0.05, 0.02);
    this.feedback?.shake(0.35);
  }

  // Игрок отошёл — топор остаётся в объекте
  leaveBehind() {
    if (this.state === 'stuck') this.state = 'left';
  }
  resumePull() {
    if (this.state === 'left') this.state = 'stuck';
  }
  // объект, в котором застрял топор, исчез/упал — оставить топор в мире
  dropToWorld() {
    if (this.state === 'stuck' || this.state === 'left') {
      this.scene.attach(this.axeRoot);
      this.stuckObject = null;
      this.stuckData = null;
      this.pullProgress = Math.max(this.pullProgress, 0.85);
    }
  }

  gripWorld(out: THREE.Vector3) {
    return this.axeRoot.getWorldPosition(out);
  }

  headWorld(out: THREE.Vector3) {
    out.set(0, this.L - 0.05, -0.08);
    return this.axeRoot.localToWorld(out);
  }

  // ===== обновление =====
  update(dt: number, camAngVel: THREE.Vector2, moveSpeed: number, bobPhase: number) {
    this.time += dt;
    // sway от массы оружия: хват отстаёт от поворота камеры
    const swayTargetX = clamp(-camAngVel.x * 0.035, -0.18, 0.18);
    const swayTargetY = clamp(-camAngVel.y * 0.045, -0.22, 0.22);
    const k = 60, c = 10;
    this.swayVel.x += ((swayTargetX - this.swayRot.x) * k - this.swayVel.x * c) * dt;
    this.swayVel.y += ((swayTargetY - this.swayRot.y) * k - this.swayVel.y * c) * dt;
    this.swayRot.x += this.swayVel.x * dt;
    this.swayRot.y += this.swayVel.y * dt;
    this.rig.rotation.set(this.swayRot.x, this.swayRot.y, this.swayRot.y * 0.5);
    const bobAmt = moveSpeed * 0.012;
    this.swayPos.set(Math.sin(bobPhase) * bobAmt, Math.abs(Math.cos(bobPhase)) * bobAmt * 0.8 - bobAmt * 0.4, 0);
    this.rig.position.copy(this.rigBase).add(this.swayPos);
    // дыхание
    this.rig.position.y += Math.sin(this.time * 1.3) * 0.004;
    // руки вытягиваются вперёд, корпус идёт за ударом
    const extTarget = this.state === 'strike' || this.state === 'recover' ? clamp((0.2 - this.theta) / 1.4, 0, 1) : this.state === 'windup' ? -0.25 : 0;
    this.extend = lerp(this.extend, extTarget, 1 - Math.exp(-dt * (this.state === 'strike' ? 16 : 7)));
    this.rig.position.z -= this.extend * 0.24;
    this.rig.position.y -= Math.max(0, this.extend) * 0.06;
    this.rig.position.x -= this.extend * 0.04;

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.updatePose();
      this.camera.updateMatrixWorld(true);
      this.updateHands(dt);
      this.refreshSamples(false);
      return;
    }

    const sub = 3;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.step(h, camAngVel);

    // наклон плоскости удара — пружина
    const pk = this.state === 'strike' ? 400 : 90;
    const pc = this.state === 'strike' ? 30 : 14;
    this.psiVel += ((this.psiTarget - this.psi) * pk - this.psiVel * pc) * dt;
    this.psi += this.psiVel * dt;
    // перекос лезвия
    this.roll = lerp(this.roll, this.rollTarget, 1 - Math.exp(-dt * 14));

    this.vibration *= Math.exp(-dt * 5);
    this.sting = Math.max(0, this.sting - dt);
    this.wiggle *= Math.exp(-dt * 9);
    this.bloodLevel = Math.max(0, this.bloodLevel - dt * 0.012);
    (this.bloodMesh.material as THREE.MeshStandardMaterial).opacity = this.bloodLevel * 0.9;
    const em = this.edgeMesh.material as THREE.MeshStandardMaterial;
    em.roughness = 0.15 + (1 - this.sharpness) * 0.6;
    em.color.setScalar(0.6 + 0.4 * this.sharpness);

    // выносливость
    if (this.state === 'windup') this.stamina = Math.max(0, this.stamina - dt * (10 + this.overcharge * 25) * this.spec.stamina);
    else if (this.state === 'idle') this.stamina = Math.min(100, this.stamina + dt * 16);
    else this.stamina = Math.min(100, this.stamina + dt * 7);

    this.updatePose();
    this.camera.updateMatrixWorld(true);
    this.updateHands(dt);
    this.refreshSamples(false);
    this.updateTrail(dt);

    // свист воздуха
    if (this.state === 'strike' && !this.whooshed && Math.abs(this.omega) > 7) {
      this.whooshed = true;
      this.onWhoosh?.(clamp(Math.abs(this.omega) / 22, 0, 1));
    }
  }

  private step(dt: number, camAngVel: THREE.Vector2) {
    if (this.state === 'stuck' || this.state === 'left') return;
    const theta = this.theta;
    // момент силы тяжести в плоскости удара
    const gravity = this.gravArm * Math.sin(theta) * Math.cos(this.psi);
    // возмущение от поворота камеры (тяжёлая голова отстаёт)
    const disturb = -camAngVel.x * 2.5;
    let armT = 0;
    const stF = this.sting > 0 ? 0.35 : 1;
    switch (this.state) {
      case 'idle': {
        // руки знают вес топора — компенсируют гравитацию
        armT = clamp((this.thetaIdle - this.theta) * 55 - this.omega * 11 - gravity, -40, 40);
        this.psiTarget = this.psiIdle;
        break;
      }
      case 'windup': {
        this.holdTime += dt;
        this.overcharge = clamp((this.holdTime - 2.2) / 1.2, 0, 1);
        const staminaF = 0.5 + 0.5 * clamp(this.stamina / 100, 0, 1);
        // руки тянут топор назад — ограниченный момент, инерция и тяжесть ощущаются
        armT = this.pd(this.thetaTop, 70, 9, 24 * staminaF);
        // тремор при перетянутом замахе или усталости
        const tremor = this.overcharge * 0.9 + (1 - staminaF) * 0.6;
        if (tremor > 0) armT += Math.sin(this.time * 31) * tremor * 6 + (Math.random() - 0.5) * tremor * 4;
        this.charge = clamp((this.theta - this.thetaIdle) / (this.thetaTop - this.thetaIdle), 0, 1);
        break;
      }
      case 'strike': {
        // полный момент вперёд; после прохождения нижней точки руки уже не ускоряют
        if (theta > -2.0) armT = -this.strikeTorque * stF;
        else armT = this.pd(-2.3, 30, 6, 40);
        if (theta < -2.25) {
          // прошли мимо — инерция уносит, перезамах
          this.state = 'recover';
          this.handSlideTarget = 0.38;
          this.feedback?.kick(0.03 * this.charge, 0.01);
        }
        break;
      }
      case 'recover': {
        armT = clamp((this.thetaIdle - this.theta) * 45 - this.omega * 13 - gravity, -42 * stF, 42 * stF);
        this.psiTarget = this.psiIdle;
        if (Math.abs(this.theta - this.thetaIdle) < 0.15 && Math.abs(this.omega) < 1.0) {
          this.state = 'idle';
          this.rollTarget = 0;
        }
        break;
      }
    }
    const torque = armT + gravity + disturb;
    this.omega += (torque / this.I) * dt;
    // лёгкое сопротивление воздуха и суставов
    this.omega *= 1 - 0.35 * dt;
    this.theta += this.omega * dt;
    // пределы суставов
    if (this.theta > 1.8) { this.theta = 1.8; this.omega *= -0.2; }
    if (this.theta < -2.6) { this.theta = -2.6; this.omega *= -0.2; }
  }

  private pd(target: number, kp: number, kd: number, max: number) {
    return clamp((target - this.theta) * kp - this.omega * kd, -max, max);
  }

  private updatePose() {
    if (this.state === 'stuck' || this.state === 'left') {
      // покачивание при рывке
      if (this.wiggle > 0.01) {
        this.axeRoot.rotation.z += Math.sin(this.time * 40) * this.wiggle * 0.012;
      }
      return;
    }
    this.tmpQ.setFromAxisAngle(this.Z, this.psi);
    this.tmpQ2.setFromAxisAngle(this.X, this.theta);
    this.pivot.quaternion.copy(this.tmpQ).multiply(this.tmpQ2);
    this.axeRoot.rotation.set(0, this.roll, 0);
    this.axeRoot.position.set(Math.sin(this.time * 85) * this.vibration * 0.012, 0, Math.cos(this.time * 70) * this.vibration * 0.008);
  }

  private updateHands(dt: number) {
    this.handSlide = lerp(this.handSlide, this.handSlideTarget, 1 - Math.exp(-dt * (this.state === 'strike' ? 18 : 7)));
    const cam = this.camera;
    const stuck = this.state === 'stuck';
    const left = this.state === 'left';
    // точки хвата на рукояти в мировых координатах
    const gripR = this.tmpV.set(0, 0.09, 0);
    const gripL = this.tmpV2.set(0, stuck ? 0.3 : this.handSlide, 0);
    this.axeRoot.localToWorld(gripR);
    this.axeRoot.localToWorld(gripL);
    cam.worldToLocal(gripR);
    cam.worldToLocal(gripL);
    if (left) {
      gripR.set(0.3, -0.55, -0.35);
      gripL.set(-0.3, -0.55, -0.35);
    }
    const elbowR = new THREE.Vector3(0.36, -0.62, -0.02);
    const elbowL = new THREE.Vector3(-0.3, -0.62, -0.02);
    this.placeArm(this.armR, this.foreR, this.handR, elbowR, gripR);
    this.placeArm(this.armL, this.foreL, this.handL, elbowL, gripL);
  }

  private placeArm(arm: THREE.Group, fore: THREE.Mesh, hand: THREE.Mesh, elbow: THREE.Vector3, grip: THREE.Vector3) {
    arm.position.copy(elbow);
    const dir = grip.clone().sub(elbow);
    const len = Math.max(0.05, dir.length());
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arm.quaternion.copy(q);
    fore.scale.set(1, len, 1);
    hand.position.set(0, len, 0);
    hand.quaternion.copy(this.axeRoot.getWorldQuaternion(this.tmpQ)).premultiply(this.camera.getWorldQuaternion(this.tmpQ2).invert()).premultiply(q.clone().invert());
  }

  private refreshSamples(init: boolean) {
    this.axeRoot.updateWorldMatrix(true, false);
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const l = this.sampleLocal[i];
      if (!init) s.prev.copy(s.pos);
      s.pos.set(0, l.y, l.z);
      this.axeRoot.localToWorld(s.pos);
      if (init) s.prev.copy(s.pos);
      s.d = l.d;
      s.isBlade = l.isBlade;
      s.valid = true;
    }
  }

  // Эффективная энергия в точке контакта
  energyAt(sample: BladeSample, dt: number) {
    const v = sample.pos.distanceTo(sample.prev) / Math.max(dt, 1e-4);
    const omegaEff = v / Math.max(0.2, sample.d);
    return { E: 0.5 * this.I * omegaEff * omegaEff, speed: v };
  }

  bladeFactor() {
    return Math.max(0, Math.cos(this.roll));
  }
}
