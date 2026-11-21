import * as THREE from 'three';
import type { Game } from './Game';
import type { CharacterRig } from './characters';
import type { Npc } from './npc';
import { audio } from './audio';

/**
 * Мио Такамия — Первый Дух, «Deus Ex Machina».
 *
 * Симулятор её силы: полёт, спиритуальная броня, крылья света и полный набор
 * ангелов, которыми она владеет как источник всех духов — от «Айн» и
 * «Айн Соф Аур» до Сандальфона, Зафкиэля, Метатрона, Михаэля, Камаэля,
 * Задкиэля, Рафаэля, Габриэля и Ханиэля.
 *
 * Всё держится на трёх вещах: спиритуальная энергия (расход/регенерация),
 * перезарядка каждого ангела и физика полёта, которая отключает гравитацию,
 * но оставляет столкновения со стенами.
 */

export interface MioAbility {
  id: string;
  key: string;
  name: string;
  kanji: string;
  angel: string;
  cost: number;
  cd: number;
  desc: string;
}

export const MIO_ABILITIES: MioAbility[] = [
  { id: 'ain', key: '1', name: 'Айн', kanji: '無', angel: 'Ain', cost: 8, cd: 0.55, desc: 'Световой клинок. Рассекает всё в конусе перед собой, головы снимает одним движением.' },
  { id: 'sandalphon', key: '2', name: 'Сандальфон', kanji: '鏖殺公', angel: 'Sandalphon', cost: 16, cd: 2.2, desc: 'Королевский меч света. Вертикальный разрез на тридцать метров — стены, машины, тела.' },
  { id: 'metatron', key: '3', name: 'Метатрон', kanji: '絶滅天使', angel: 'Metatron', cost: 12, cd: 1.6, desc: 'Крылья света. Мгновенный рывок сквозь пространство и веер перьев-клинков.' },
  { id: 'zafkiel', key: '4', name: 'Зафкиэль', kanji: '刻々帝', angel: 'Zafkiel', cost: 20, cd: 6, desc: 'Часы времени. Мир замедляется втрое, всё живое замирает на месте.' },
  { id: 'michael', key: '5', name: 'Михаэль', kanji: '颶風騎士', angel: 'Michael', cost: 18, cd: 5, desc: 'Ключ пространства. Гравитация вдавливает всё в радиусе четырнадцати метров в асфальт.' },
  { id: 'camael', key: '6', name: 'Камаэль', kanji: '灼爛殲鬼', angel: 'Camael', cost: 14, cd: 3, desc: 'Огненный клинок. Волна пламени поджигает машины и людей.' },
  { id: 'zadkiel', key: '7', name: 'Задкиэль', kanji: '氷芽川', angel: 'Zadkiel', cost: 14, cd: 3.4, desc: 'Лёд. Зона вечной мерзлоты: всё живое вмерзает в лёд на четыре секунды.' },
  { id: 'raphael', key: '8', name: 'Рафаэль', kanji: '颶風騎士', angel: 'Raphael', cost: 10, cd: 2.4, desc: 'Ветер. Круговая ударная волна сдувает машины и людей с улицы.' },
  { id: 'gabriel', key: '9', name: 'Габриэль', kanji: '破軍歌姫', angel: 'Gabriel', cost: 12, cd: 5, desc: 'Песня. Люди перестают бояться и идут за тобой, полиция теряет цель.' },
  { id: 'haniel', key: 'H', name: 'Ханиэль', kanji: '囁告篇帙', angel: 'Haniel', cost: 6, cd: 3, desc: 'Книга будущего. Подсвечивает всех живых в радиусе 60 м и обнуляет розыск.' },
  { id: 'ainsoph', key: '0', name: 'Айн Соф Аур', kanji: '無限光', angel: 'Ain Soph Aur', cost: 100, cd: 18, desc: 'Абсолютный свет. Луч, стирающий всё на своём пути: дома, машины, тела. Тратит всю энергию.' },
];

const UP = new THREE.Vector3(0, 1, 0);
const MAX_ALT = 340;

function glowTexture(inner = 'rgba(255,240,190,1)', mid = 'rgba(255,196,92,0.55)', outer = 'rgba(255,150,40,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Крыло света: перьевая дымка с золотым обрезом. */
function wingTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.45, 'rgba(255,206,120,0.5)');
  g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(6, 4);
  ctx.quadraticCurveTo(120, 70, 112, 150);
  ctx.quadraticCurveTo(70, 236, 10, 250);
  ctx.quadraticCurveTo(34, 128, 6, 4);
  ctx.fill();
  // прожилки перьев
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    const y = 24 + i * 25;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(96 - i * 3, y + 28);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addMat(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

interface Fx {
  obj: THREE.Object3D;
  t: number;
  life: number;
  tick: (k: number, dt: number) => void;
}

export class Mio {
  active = false;
  flying = false;
  energy = 100;
  maxEnergy = 100;
  cooldowns: number[] = MIO_ABILITIES.map(() => 0);
  lastCast = '';
  casts = 0;
  kills = 0;
  /** Подсказка на экране при первом превращении. */
  introT = 0;

  private root = new THREE.Group();
  private halo!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private aura!: THREE.Sprite;
  private wings: THREE.Mesh[] = [];
  private dress!: THREE.Mesh;
  private hair!: THREE.Group;
  private bladeFP!: THREE.Mesh;
  private hairMeshes: { mat: THREE.MeshStandardMaterial; color: number }[] = [];
  private glow!: THREE.PointLight;
  private flightVel = new THREE.Vector3();
  private fx: Fx[] = [];
  private time = 0;
  private flap = 0;
  private dashCd = 0;
  private transformT = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private game: Game, private scene: THREE.Scene, private rig: CharacterRig) {
    this.root.name = 'mio-form';
    this.root.visible = false;

    // аура вокруг тела
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffd27a,
    }));
    this.aura.scale.setScalar(2.7);
    this.aura.position.y = 1.05;
    this.root.add(this.aura);

    // нимб над головой
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.011, 6, 40), addMat(0xffe6a3, 0.95));
    this.halo.rotation.x = Math.PI / 2;
    this.halo.position.y = 2.02;
    this.root.add(this.halo);

    // кольцо у ног
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.014, 6, 56), addMat(0xffc061, 0.75));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.06;
    this.root.add(this.ring);

    // крылья света
    const wingGeo = new THREE.PlaneGeometry(1.15, 2.1);
    const wingMat = new THREE.MeshBasicMaterial({
      map: wingTexture(), transparent: true, opacity: 0.8, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, wingMat.clone());
      w.position.set(side * 0.34, 1.42, 0.16);
      w.rotation.y = side * 0.55;
      w.rotation.z = side * -0.18;
      this.root.add(w);
      this.wings.push(w);
    }

    // спиритуальное платье: белое с золотом
    this.dress = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.46, 1.04, 14, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xf7f3ea, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.94,
        side: THREE.DoubleSide, emissive: 0xffdca8, emissiveIntensity: 0.35,
      }),
    );
    this.dress.position.y = 0.58;
    this.root.add(this.dress);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 6, 24), addMat(0xffd489, 0.9));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 1.08;
    this.root.add(trim);

    // длинные серебряные волосы (канонический силуэт Мио)
    this.hair = new THREE.Group();
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ec, roughness: 0.42, metalness: 0.08, emissive: 0x2a2f3c, emissiveIntensity: 0.25 });
    for (let i = 0; i < 5; i++) {
      const len = 0.46 + (i % 3) * 0.1;
      const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.035 - i * 0.003, len, 3, 6), hairMat);
      strand.position.set(-0.11 + i * 0.055, -0.1 - len * 0.35, 0.055 + (i % 2) * 0.03);
      strand.rotation.x = 0.08 + i * 0.02;
      this.hair.add(strand);
    }
    this.hair.position.set(0, 0.12, -0.02);
    this.root.add(this.hair);

    this.glow = new THREE.PointLight(0xffce85, 0, 12, 1.8);
    this.glow.position.y = 1.4;
    this.root.add(this.glow);

    scene.add(this.root);

    // клинок света в руке: в виде от первого лица живёт на камере оружия
    this.bladeFP = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.95, 0.014),
      addMat(0xffe2a6, 0.92),
    );
    this.bladeFP.position.set(0.19, -0.3, -0.52);
    this.bladeFP.rotation.set(-0.42, 0.12, 0.28);
    this.bladeFP.visible = false;
    this.game.fpCamera.add(this.bladeFP);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), addMat(0xfff2cf, 0.85));
    guard.position.y = -0.47;
    this.bladeFP.add(guard);

    // перекрашиваем волосы персонажа в серебро, пока форма активна
    const hairColors = new Set([0x312b25, 0x483a2c, 0x595147]);
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat?.color && hairColors.has(mat.color.getHex())) {
        this.hairMeshes.push({ mat, color: mat.color.getHex() });
      }
    });
  }

  /** Включить/выключить форму Первого Духа. */
  toggle(force?: boolean) {
    const next = force ?? !this.active;
    if (next === this.active) return this.active;
    this.active = next;
    this.root.visible = next;
    this.bladeFP.visible = next;
    this.game.axe.setVisible(!next && this.game.weapon === 'axe' && this.game.onFootCam === 0);
    for (const h of this.hairMeshes) h.mat.color.setHex(next ? 0xe4e8f0 : h.color);
    if (next) {
      this.transformT = 0.9;
      this.introT = 6;
      this.energy = this.maxEnergy;
      this.flying = true;
      this.game.velY = 0;
      this.game.pos.y = Math.max(this.game.pos.y, this.game.city.surfaceAt(this.game.pos.x, this.game.pos.z) + 0.9);
      audio.spirit(1);
      this.game.setLog('МИО ТАКАМИЯ · Первый Дух · Ain Soph Aur');
      this.game.notify('Первый Дух', 'Ты — Мио Такамия. Цифры 1…0 — ангелы, V — назад в человека.');
      this.flash(0.9);
      this.burst(this.game.pos.clone().setY(this.game.pos.y + 1), 1.6);
    } else {
      this.flying = false;
      this.energy = this.maxEnergy;
      this.game.setLog('Ты снова человек');
      audio.spirit(0.4);
      this.flash(0.35);
    }
    return this.active;
  }

  /** Вспышка экрана через пост-обработку. */
  private flash(v: number) {
    this.game.flash(v);
  }

  get abilityList() { return MIO_ABILITIES; }

  /**
   * Спиритуальная броня. Одна единица энергии держит 2,5 урона, но не больше
   * 92% любого попадания: пули и взрывы почти не проходят, пока есть энергия.
   */
  absorb(amount: number) {
    const cover = Math.min(amount * 0.92, this.energy * 2.5);
    const rest = amount - cover;
    this.energy = Math.max(0, this.energy - cover / 2.5);
    if (this.energy <= 0.001) this.flying = false;

    // Мио возвращает себя к жизни — канон: она умеет воскрешать
    if (this.game.hp - rest <= 0 && this.energy >= 30) {
      this.game.hp = 55;
      this.energy -= 30;
      this.flash(0.7);
      this.game.setLog('МИО ВЕРНУЛА СЕБЯ К ЖИЗНИ');
      audio.spirit(0.9);
      return;
    }
    this.game.hp = Math.max(0, this.game.hp - rest);
    if (this.energy <= 0.001) this.game.setLog('ЭНЕРГИЯ ИСЧЕРПАНА · дух снова уязвим');
  }

  /** Каст ангела по индексу (0…10, 0 = «Айн»). */
  cast(index: number) {
    if (!this.active || index < 0 || index >= MIO_ABILITIES.length) return false;
    const a = MIO_ABILITIES[index];
    if (this.cooldowns[index] > 0) {
      this.game.setLog(`${a.name} · перезарядка ${this.cooldowns[index].toFixed(1)} с`);
      return false;
    }
    if (this.energy < a.cost) {
      this.game.setLog(`${a.name} · мало спиритуальной энергии`);
      audio.dryFire();
      return false;
    }
    this.energy -= a.cost;
    this.cooldowns[index] = a.cd;
    this.lastCast = a.name;
    this.casts++;
    this.transformT = Math.max(this.transformT, 0.35);
    switch (a.id) {
      case 'ain': this.ain(); break;
      case 'sandalphon': this.sandalphon(); break;
      case 'metatron': this.metatron(); break;
      case 'zafkiel': this.zafkiel(); break;
      case 'michael': this.michael(); break;
      case 'camael': this.camael(); break;
      case 'zadkiel': this.zadkiel(); break;
      case 'raphael': this.raphael(); break;
      case 'gabriel': this.gabriel(); break;
      case 'haniel': this.haniel(); break;
      case 'ainsoph': this.ainSophAur(); break;
    }
    audio.spirit(Math.min(1, a.cost / 30));
    audio.angel(index);
    this.flash(Math.min(0.5, a.cost / 60));
    return true;
  }

  // ================= полёт =================

  /** Полёт: камера задаёт направление, Space — вверх, X — вниз, Shift — ускорение. */
  fly(dt: number) {
    const g = this.game;
    const dir = g.camera.getWorldDirection(this.tmp);
    const right = this.tmp2.crossVectors(dir, UP).normalize();
    const desired = new THREE.Vector3();
    const inp = g.moveInput;
    desired.addScaledVector(dir, inp.y);
    desired.addScaledVector(right, inp.x);
    if (g.mioKeys.up) desired.addScaledVector(UP, 0.9);
    if (g.mioKeys.down) desired.addScaledVector(UP, -0.9);
    if (desired.lengthSq() > 1e-4) desired.normalize();
    const speed = (g.sprint ? 44 : 20) * (this.energy > 0 ? 1 : 0.35);
    desired.multiplyScalar(speed * (desired.y > 0.2 ? 1 : 1));
    this.flightVel.lerp(desired, 1 - Math.exp(-dt * 3.4));

    // шаг и мягкое выталкивание из стен: летим вокруг домов, а не сквозь них
    const step = this.tmp.copy(this.flightVel).multiplyScalar(dt);
    g.pos.add(step);
    g.city.collide(g.pos, 0.42, g.pos.y);

    const surf = g.city.surfaceAt(g.pos.x, g.pos.z);
    if (g.pos.y < surf + 0.24) { g.pos.y = surf + 0.24; if (this.flightVel.y < 0) this.flightVel.y = 0; }
    if (g.pos.y > MAX_ALT) { g.pos.y = MAX_ALT; this.flightVel.y = Math.min(0, this.flightVel.y); }
    g.vel.set(this.flightVel.x, 0, this.flightVel.z);
    g.velY = 0;
    g.onGround = g.pos.y <= surf + 0.3;
    this.flap += dt * (6 + this.flightVel.length() * 0.18);
  }

  /** Рывок вперёд (Метатрон использует свой, но Space в полёте тоже толкает). */
  impulseUp() {
    this.flightVel.y = Math.max(this.flightVel.y, 9);
    audio.whoosh(0.5);
    this.game.particles.dustPuff(this.game.pos.clone(), 3);
  }

  // ================= обновление =================

  update(dt: number) {
    this.time += dt;
    for (let i = 0; i < this.cooldowns.length; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    if (this.introT > 0) this.introT = Math.max(0, this.introT - dt);
    if (this.dashCd > 0) this.dashCd = Math.max(0, this.dashCd - dt);

    // VFX живут всегда
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = Math.max(0, Math.min(1, f.t / f.life));
      f.tick(k, dt);
      if (k >= 1) { this.scene.remove(f.obj); disposeObj(f.obj); this.fx.splice(i, 1); }
    }

    if (!this.active) {
      if (this.root.visible) this.root.visible = false;
      return;
    }
    // в машине дух «в кармане», в виде от первого лица — только свет вокруг
    const inCar = !!this.game.vehicle;
    const fp = this.game.onFootCam === 0 && !inCar;
    this.root.visible = !inCar;
    this.dress.visible = !fp;
    this.hair.visible = !fp;
    this.halo.visible = !fp;
    for (const w of this.wings) w.visible = !fp;
    this.aura.position.y = fp ? 0.35 : 1.05;
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 7.5);
    if (this.transformT > 0) this.transformT = Math.max(0, this.transformT - dt);

    // форма следует за игроком
    const p = this.game.pos;
    this.root.position.set(p.x, p.y, p.z);
    const t = this.time;
    this.aura.material.opacity = 0.55 + Math.sin(t * 3.1) * 0.12 + (this.flying ? 0.15 : 0);
    this.aura.scale.setScalar((fp ? 1.7 : 2.5) + Math.sin(t * 2.2) * 0.18);
    this.halo.position.y = 2.02 + Math.sin(t * 1.7) * 0.03;
    this.halo.rotation.z += dt * 0.6;
    this.ring.rotation.z += dt * 1.1;
    this.ring.scale.setScalar(1 + Math.sin(t * 2.4) * 0.05);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 3) * 0.16;
    this.glow.intensity = 2.4 + Math.sin(t * 2.6) * 0.7;

    const flap = this.flying ? Math.sin(this.flap) * 0.22 : Math.sin(t * 1.4) * 0.06;
    this.wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      w.rotation.z = side * (-0.18 + flap);
      w.rotation.y = side * (0.55 + (this.flying ? 0.18 : 0.05));
      (w.material as THREE.MeshBasicMaterial).opacity = 0.55 + (this.flying ? 0.35 : 0.1) + Math.sin(t * 4 + i) * 0.08;
    });
    (this.dress.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.sin(t * 2.1) * 0.1;
    this.bladeFP.visible = this.active && this.game.onFootCam === 0 && !this.game.vehicle;
    (this.bladeFP.material as THREE.MeshBasicMaterial).opacity = 0.8 + Math.sin(t * 6) * 0.15;

    // при первом превращении — волна света по земле
    if (this.transformT > 0) this.root.rotation.y += dt * 1.6;
    else this.root.rotation.y = 0;
  }

  // ================= ангелы =================

  private eye() { return this.game.pos.clone().setY(this.game.pos.y + this.game.eyeHeight); }
  private forward() {
    const d = this.game.camera.getWorldDirection(new THREE.Vector3());
    return d;
  }

  /** Кто попал в конус/сферу — общая выборка. */
  private npcsIn(center: THREE.Vector3, radius: number, dir?: THREE.Vector3, cosHalf = -1) {
    const out: { n: Npc; d: number }[] = [];
    const v = new THREE.Vector3();
    for (const n of this.game.npcs) {
      if (!n.alive) continue;
      v.subVectors(n.position(), center);
      const d = v.length();
      if (d > radius) continue;
      if (dir && d > 0.2) {
        v.divideScalar(d);
        if (v.dot(dir) < cosHalf) continue;
      }
      out.push({ n, d });
    }
    return out;
  }

  private hitNpc(n: Npc, dmg: number, dir: THREE.Vector3, sever?: 'head' | 'torso' | 'armL' | 'armR' | 'thighL' | 'thighR') {
    n.applyHit('torso', dmg, dir.clone().multiplyScalar(2.2), 0.8);
    if (sever) this.game.gore.sever(n, sever, dir, 1, 1.5);
    if (n.hp <= 0 && n.alive) {
      n.kill(dir);
      this.game.mioKill(n);
      this.kills++;
      this.game.particles.bloodBurst(n.position().clone().setY(n.position().y + 1), dir, 1, 40);
    }
  }

  private ain() {
    const pos = this.eye();
    const dir = this.forward();
    const reach = 9;
    const arc = this.arcFx(pos, dir, 1.4, 0xfff0c8);
    arc.obj.scale.setScalar(1);
    for (const { n, d } of this.npcsIn(pos, reach, dir, 0.35)) {
      const crit = Math.random() < 0.6 || d < 4;
      this.hitNpc(n, 900, dir, crit ? 'head' : undefined);
    }
    for (const car of this.game.traffic.cars) {
      if (car.exploded) continue;
      if (car.pos.distanceTo(pos) > reach) continue;
      this.game.damageCar(car, 140, 'blast');
      this.game.igniteCar(car, 0.5);
    }
    this.game.particles.sparkBurst(pos.clone().addScaledVector(dir, 2), dir, 1.4);
    this.game.trauma = Math.min(1, this.game.trauma + 0.25);
    this.game.setLog('АЙН · световой клинок');
    audio.impact('bone', 1, 1);
  }

  private sandalphon() {
    const pos = this.eye();
    const dir = this.forward();
    // вертикальный разрез: длинная плоскость вперёд
    const cut = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 34), addMat(0xfff4d2, 0.9));
    cut.position.copy(pos).addScaledVector(dir, 17);
    cut.lookAt(pos.clone().addScaledVector(dir, 34));
    this.scene.add(cut);
    this.fx.push({
      obj: cut, t: 0, life: 0.55, tick: (k, _dt) => {
        cut.scale.set(1 + k * 0.6, 1, 1);
        (cut.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      },
    });
    for (const { n } of this.npcsIn(pos, 34, dir, 0.55)) this.hitNpc(n, 1400, dir, 'torso');
    for (const car of this.game.traffic.cars) {
      if (car.exploded) continue;
      const v = this.tmp.subVectors(car.pos, pos);
      const d = v.length();
      if (d > 34) continue;
      if (v.normalize().dot(dir) < 0.5) continue;
      this.game.damageCar(car, 400, 'blast');
      this.game.igniteCar(car, 1);
    }
    this.game.particles.sparkBurst(pos.clone().addScaledVector(dir, 6), dir, 1.6);
    this.game.trauma = Math.min(1, this.game.trauma + 0.45);
    this.game.setLog('САНДАЛЬФОН · королевский разрез');
    audio.explosion();
  }

  private metatron() {
    const g = this.game;
    const dir = this.forward();
    const from = g.pos.clone();
    const to = from.clone().addScaledVector(dir, 22);
    to.y = Math.max(g.city.surfaceAt(to.x, to.z) + 0.3, Math.min(MAX_ALT, to.y));
    // телепорт-рывок
    g.pos.copy(to);
    this.flightVel.copy(dir).multiplyScalar(0);
    this.dashCd = 0.3;
    audio.whoosh(1);
    // след из света
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.02, from.distanceTo(to), 8, 1, true), addMat(0xffe7b0, 0.75));
    trail.position.copy(from).lerp(to, 0.5);
    trail.quaternion.setFromUnitVectors(UP, this.tmp.subVectors(to, from).normalize());
    this.scene.add(trail);
    this.fx.push({ obj: trail, t: 0, life: 0.4, tick: (k, _dt) => { (trail.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k); } });
    // веер перьев
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = dir.clone().applyAxisAngle(UP, a * 0.22);
      const feather = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), addMat(0xfff2cb, 0.9));
      const start = g.pos.clone().setY(g.pos.y + 1.2);
      feather.position.copy(start);
      this.scene.add(feather);
      const vel = d.clone().multiplyScalar(26 + Math.random() * 8).addScaledVector(UP, (Math.random() - 0.3) * 6);
      let travelled = 0;
      this.fx.push({
        obj: feather, t: 0, life: 1.1, tick: (k, d2) => {
          feather.position.addScaledVector(vel, d2);
          travelled += vel.length() * d2;
          feather.lookAt(feather.position.clone().add(vel));
          (feather.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
          for (const { n } of this.npcsIn(feather.position, 1.1)) this.hitNpc(n, 260, vel.clone().normalize());
        },
      });
    }
    for (const { n } of this.npcsIn(g.pos, 4.5)) this.hitNpc(n, 400, dir);
    this.game.setLog('МЕТАТРОН · рывок света');
  }

  private zafkiel() {
    const g = this.game;
    const pos = this.eye();
    // циферблат из света
    const clock = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.05, 6, 64), addMat(0xd9c6ff, 0.8));
    clock.position.copy(pos);
    this.scene.add(clock);
    const hands = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6 - i * 1.1, 0.02), addMat(0xf0e6ff, 0.9));
      h.position.y = (2.6 - i * 1.1) / 2;
      hands.add(h);
    }
    hands.position.copy(pos);
    this.scene.add(hands);
    this.fx.push({
      obj: clock, t: 0, life: 2.2, tick: (k, _dt) => {
        clock.rotation.x = Math.PI / 2 * (1 - k) * 0.3;
        clock.scale.setScalar(1 + k * 1.4);
        (clock.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        hands.rotation.z += 0.06;
        hands.position.copy(pos);
        for (const h of hands.children) {
          ((h as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        }
      },
    });
    // мир замедляется, живые замирают
    g.gore.slowmo(0.34, 2.4);
    for (const { n } of this.npcsIn(pos, 26)) {
      n.staggerT = Math.max(n.staggerT, 2.6);
      n.state = 'stagger';
    }
    this.game.setLog('ЗАФКИЭЛЬ · время замедлено');
    audio.spirit(0.8);
  }

  private michael() {
    const g = this.game;
    const pos = this.eye();
    const R = 14;
    g.camera.getWorldDirection(this.tmp);
    // гравитационный удар: кольца вниз
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.08, 6, 48), addMat(0xc9a4ff, 0.85));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(pos).setY(g.city.surfaceAt(pos.x, pos.z) + 0.1 + i * 0.4);
      this.scene.add(ring);
      this.fx.push({
        obj: ring, t: -i * 0.12, life: 0.9, tick: (k, _dt) => {
          ring.scale.setScalar(0.4 + k * (R / 2));
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
        },
      });
    }
    for (const { n, d } of this.npcsIn(pos, R)) {
      const dmg = 520 * (1 - d / R * 0.55);
      this.hitNpc(n, dmg, this.tmp.subVectors(n.position(), pos).setY(0).normalize());
      n.staggerT = Math.max(n.staggerT, 1.4);
    }
    for (const car of this.game.traffic.cars) {
      if (car.exploded) continue;
      const d = car.pos.distanceTo(pos);
      if (d > R) continue;
      this.game.damageCar(car, 220 * (1 - d / R * 0.5), 'blast');
      if (d < 7) this.game.explodeCar(car);
    }
    g.particles.dustPuff(pos.clone().setY(g.city.surfaceAt(pos.x, pos.z)), 24);
    g.trauma = Math.min(1, g.trauma + 0.6);
    g.kickVelP += 3;
    this.game.setLog('МИХАЭЛЬ · гравитация');
    audio.explosion();
  }

  private camael() {
    const g = this.game;
    const pos = this.eye();
    const dir = this.forward();
    const len = 18;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4.4, len, 14, 1, true), addMat(0xff8a3c, 0.55));
    cone.position.copy(pos).addScaledVector(dir, len / 2);
    cone.quaternion.setFromUnitVectors(UP, dir.clone().negate());
    this.scene.add(cone);
    this.fx.push({
      obj: cone, t: 0, life: 0.9, tick: (k, _dt) => {
        cone.scale.set(1 + k * 0.5, 1 + k * 0.3, 1 + k * 0.5);
        (cone.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
      },
    });
    for (const { n, d } of this.npcsIn(pos, len, dir, 31 * Math.PI / 180)) {
      this.hitNpc(n, 700 * (1 - d / len * 0.4), dir);
    }
    for (const car of g.traffic.cars) {
      if (car.exploded) continue;
      const v = this.tmp.subVectors(car.pos, pos);
      const d = v.length();
      if (d > len) continue;
      if (v.normalize().dot(dir) < 0.4) continue;
      g.damageCar(car, 90, 'fire');
      g.igniteCar(car, 1);
    }
    for (let i = 0; i < 26; i++) {
      const p = pos.clone().addScaledVector(dir, 2 + Math.random() * len);
      p.y += (Math.random() - 0.3) * 3;
      g.particles.sparkBurst(p, dir, 0.8 + Math.random());
    }
    this.game.setLog('КАМАЭЛЬ · огненный клинок');
    audio.fireCrackle();
  }

  private zadkiel() {
    const g = this.game;
    const pos = this.eye();
    const R = 16;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = pos.x + Math.cos(a) * (4 + Math.random() * R * 0.7);
      const z = pos.z + Math.sin(a) * (4 + Math.random() * R * 0.7);
      const y = g.city.surfaceAt(x, z);
      const h = 1.2 + Math.random() * 3.4;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.34, h, 6), addMat(0xbfe9ff, 0.6));
      spike.position.set(x, y + h / 2, z);
      spike.rotation.z = (Math.random() - 0.5) * 0.3;
      this.scene.add(spike);
      this.fx.push({ obj: spike, t: 0, life: 3.4, tick: (k, _dt) => { (spike.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k * 0.9); } });
    }
    for (const { n, d } of this.npcsIn(pos, R)) {
      this.hitNpc(n, 340 * (1 - d / R * 0.4), this.tmp.subVectors(n.position(), pos).setY(0).normalize());
      n.staggerT = Math.max(n.staggerT, 4);
      n.state = 'stagger';
    }
    this.game.setLog('ЗАДКИЭЛЬ · вечная мерзлота');
    audio.impact('stone', 1);
  }

  private raphael() {
    const g = this.game;
    const pos = this.eye();
    const R = 22;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2, 0.12, 6, 64), addMat(0xd6f7ff, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pos).setY(g.city.surfaceAt(pos.x, pos.z) + 0.2);
    this.scene.add(ring);
    this.fx.push({
      obj: ring, t: 0, life: 0.8, tick: (k, _dt) => {
        ring.scale.setScalar(1 + k * (R / 2));
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      },
    });
    for (const { n, d } of this.npcsIn(pos, R)) {
      const push = this.tmp.subVectors(n.position(), pos).setY(0.3).normalize().multiplyScalar(18 * (1 - d / R * 0.5));
      n.applyHit('torso', 180, push, 1.2);
      n.staggerT = Math.max(n.staggerT, 1.6);
    }
    for (const car of g.traffic.cars) {
      if (car.exploded || car.isPlayer) continue;
      const d = car.pos.distanceTo(pos);
      if (d > R) continue;
      car.vel.addScaledVector(this.tmp.subVectors(car.pos, pos).setY(0).normalize(), 16 * (1 - d / R * 0.5));
      car.rollVel += (Math.random() - 0.5) * 3;
    }
    g.trauma = Math.min(1, g.trauma + 0.3);
    this.game.setLog('РАФАЭЛЬ · ветер');
    audio.whoosh(1);
  }

  private gabriel() {
    const g = this.game;
    const pos = this.eye();
    const R = 24;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.06, 6, 40), addMat(0xffc7e6, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pos).setY(g.city.surfaceAt(pos.x, pos.z) + 0.3);
    this.scene.add(ring);
    this.fx.push({
      obj: ring, t: 0, life: 1.2, tick: (k, _dt) => {
        ring.scale.setScalar(1 + k * (R / 1.6));
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      },
    });
    let charmed = 0;
    for (const { n } of this.npcsIn(pos, R)) {
      if (n.kind !== 'human') continue;
      n.passive = true;
      n.state = 'idle';
      n.attackPlayer = false;
      n.targetEnemy = null;
      charmed++;
    }
    g.police.wanted = 0; g.police.stars = 0; g.police.heat = 0;
    this.game.setLog(`ГАБРИЭЛЬ · песня · ${charmed} человек заворожены`);
    audio.spirit(0.7);
  }

  private haniel() {
    const g = this.game;
    const pos = this.eye();
    let seen = 0;
    for (const { n } of this.npcsIn(pos, 60)) {
      this.hitNpc(n, 1, new THREE.Vector3(0, 0, 1));
      seen++;
    }
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.86, 0.06), addMat(0xfff6d0, 0.7));
    book.position.copy(pos).addScaledVector(this.forward(), 1.4);
    this.scene.add(book);
    this.fx.push({
      obj: book, t: 0, life: 1.4, tick: (k, _dt) => {
        book.rotation.y += 0.05;
        (book.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      },
    });
    g.police.wanted = 0; g.police.stars = 0; g.police.heat = 0;
    this.game.setLog(`ХАНИЭЛЬ · книга · целей рядом: ${seen}`);
  }

  private ainSophAur() {
    const g = this.game;
    const pos = this.eye();
    const dir = this.forward();
    const len = 120;

    // луч
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.35, len, 18, 1, true), addMat(0xfff8e0, 0.95));
    beam.position.copy(pos).addScaledVector(dir, len / 2);
    beam.quaternion.setFromUnitVectors(UP, dir);
    this.scene.add(beam);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.12, len, 12, 1, true), addMat(0xffffff, 1));
    core.position.copy(beam.position);
    core.quaternion.copy(beam.quaternion);
    this.scene.add(core);
    this.fx.push({
      obj: beam, t: 0, life: 1.5, tick: (k, _dt) => {
        const w = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88 * 0.75;
        beam.scale.set(w, 1, w);
        core.scale.set(w, 1, w);
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
        (core.material as THREE.MeshBasicMaterial).opacity = (1 - k);
      },
    });

    // всё вдоль луча
    const step = 1.5;
    const hitNpcs = new Set<Npc>();
    for (let s = 0; s < len; s += step) {
      const p = pos.clone().addScaledVector(dir, s);
      for (const { n } of this.npcsIn(p, 3.2)) {
        if (hitNpcs.has(n)) continue;
        hitNpcs.add(n);
        this.hitNpc(n, 4000, dir, Math.random() < 0.7 ? 'head' : 'torso');
      }
      for (const car of g.traffic.cars) {
        if (car.exploded) continue;
        if (car.pos.distanceTo(p) > 4) continue;
        g.explodeCar(car);
      }
      if (s % 12 === 0) g.particles.sparkBurst(p, dir, 1.4);
    }
    // стены: выжигаем ближайшие — просто искры и урон машинам в радиусе
    g.trauma = 1;
    g.kickVelP += 7;
    g.fovPunch += 0.12;
    g.flash(0.85);
    this.energy = 0;
    this.game.setLog('АЙН СОФ АУР · абсолютный свет');
    g.notify('Ain Soph Aur', 'Всё, чего коснулся свет, перестало существовать.');
    audio.explosion();
    audio.thunder();
  }

  // ================= вспомогательные эффекты =================

  private arcFx(pos: THREE.Vector3, dir: THREE.Vector3, radius: number, color: number) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 6, 48, Math.PI * 0.85), addMat(color, 0.95));
    arc.position.copy(pos).addScaledVector(dir, 1.6);
    arc.quaternion.setFromUnitVectors(UP, this.tmp2.copy(dir).applyAxisAngle(UP, Math.PI / 2));
    this.scene.add(arc);
    const fx: Fx = {
      obj: arc, t: 0, life: 0.32, tick: (k, _dt) => {
        arc.scale.setScalar(0.6 + k * 1.5);
        (arc.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
      },
    };
    this.fx.push(fx);
    return fx;
  }

  private burst(pos: THREE.Vector3, power: number) {
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 6, 40), addMat(0xffe3a8, 0.9));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(pos);
      this.scene.add(ring);
      this.fx.push({
        obj: ring, t: -i * 0.1, life: 0.8 + i * 0.2, tick: (k, _dt) => {
          ring.scale.setScalar(0.6 + k * 9 * power);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        },
      });
    }
    this.game.particles.dustPuff(pos, 10);
    this.game.particles.sparkBurst(pos, new THREE.Vector3(0, 1, 0), 1.2);
  }
}

function disposeObj(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
