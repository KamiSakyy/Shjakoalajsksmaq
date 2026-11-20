import * as THREE from 'three';

/**
 * Atmosphere — свет на небе и в воздухе.
 *
 *  · солнечное/лунное гало и анаморфная полоса (объектив камеры);
 *  · объёмные лучи света, которые поворачиваются вместе с солнцем;
 *  · молнии с настоящей вспышкой, громом и подсветкой сцены;
 *  · пар из люков и брызги прибоя у кромки воды.
 *
 * Все эффекты — аддитивные спрайты и один PointLight, поэтому стоимость
 * фиксированная и не зависит от числа объектов в кадре.
 */

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface AtmosphereContext {
  night: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  camera: THREE.Camera;
  wet: number;
}

export class Atmosphere {
  private glow: THREE.Sprite;
  private streak: THREE.Mesh;
  private shafts: THREE.Mesh[] = [];
  private sunLight: THREE.PointLight;
  private steam: THREE.Sprite[] = [];
  private steamState: { age: number; life: number; base: THREE.Vector3 }[] = [];
  private spray: THREE.Sprite[] = [];
  private sprayState: { age: number; life: number; pos: THREE.Vector3 }[] = [];
  private bolt: THREE.Line;
  private boltLife = 0;
  flash = 0;
  heat = 0;
  thunderTimer = 0;
  onThunder: (() => void) | null = null;

  constructor(scene: THREE.Scene, spawnPoints: THREE.Vector3[], shoreAt: (x: number) => number, quality: 'low' | 'high' | 'ultra') {
    const soft = radialTexture('rgba(255,244,214,0.95)', 'rgba(255,190,120,0)', 128);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: soft, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true, opacity: 0.0,
    }));
    this.glow.scale.setScalar(160);
    scene.add(this.glow);

    // анаморфная полоса — «объектив»
    const streakTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 32;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, 'rgba(120,190,255,0)');
      g.addColorStop(0.5, 'rgba(190,225,255,0.85)');
      g.addColorStop(1, 'rgba(120,190,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 14, 128, 4);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.streak = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: streakTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.streak.scale.set(420, 34, 1);
    scene.add(this.streak);

    // лучи: аддитивные клинья, растянутые от солнца
    const shaftCount = quality === 'low' ? 4 : 8;
    const shaftTex = radialTexture('rgba(255,238,200,0.30)', 'rgba(255,220,170,0)', 128);
    for (let i = 0; i < shaftCount; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: shaftTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0,
        }),
      );
      m.scale.set(26 + i * 16, 420 + i * 90, 1);
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.shafts.push(m);
      scene.add(m);
    }

    this.sunLight = new THREE.PointLight(0xfff0cf, 0, 400, 0.4);
    scene.add(this.sunLight);

    // молния
    const boltGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    let x = 0, z = 0, y = 0;
    while (y > -260) {
      pts.push(x, y, z);
      y -= 22 + Math.random() * 26;
      x += (Math.random() - 0.5) * 26;
      z += (Math.random() - 0.5) * 26;
    }
    boltGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
    this.bolt.visible = false;
    scene.add(this.bolt);

    // пар из люков
    const steamTex = radialTexture('rgba(220,225,230,0.5)', 'rgba(200,210,220,0)', 64);
    const steamCount = quality === 'low' ? 6 : 14;
    for (let i = 0; i < steamCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.steam.push(s);
      const base = spawnPoints.length ? spawnPoints[Math.floor(Math.random() * spawnPoints.length)].clone() : new THREE.Vector3();
      this.steamState.push({ age: Math.random() * 4, life: 3.4 + Math.random() * 3, base });
    }

    // брызги прибоя
    const sprayTex = radialTexture('rgba(235,250,255,0.6)', 'rgba(220,245,255,0)', 64);
    const sprayCount = quality === 'low' ? 4 : 10;
    for (let i = 0; i < sprayCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprayTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.spray.push(s);
      const z = -470 + Math.random() * 940;
      this.sprayState.push({ age: Math.random() * 3, life: 1.6 + Math.random() * 1.6, pos: new THREE.Vector3(shoreAt(z) - 2, 0.3, z) });
    }
  }

  /** Вспышка от взрыва или молнии. */
  flashBurst(power = 1) {
    this.flash = Math.min(1.4, this.flash + power);
  }

  /** Молния в точку: болт, вспышка, гром через задержку по расстоянию. */
  strike(x: number, y: number, z: number, distance = 120) {
    this.bolt.position.set(x, y, z);
    this.bolt.visible = true;
    this.boltLife = 0.22;
    this.flashBurst(0.9);
    this.sunLight.position.set(x, y + 40, z);
    this.sunLight.color.setHex(0xdcefff);
    this.sunLight.intensity = 900;
    this.thunderTimer = 0.4 + distance * 0.011;
  }

  update(dt: number, ctx: AtmosphereContext) {
    const { night, sunDir, sunColor, camera } = ctx;
    // гало
    const sunUp = Math.max(0, sunDir.y);
    const glowVisible = sunUp > 0.02 ? 1 : 0.35;
    this.glow.position.copy(camera.position).addScaledVector(sunDir, 700);
    (this.glow.material as THREE.SpriteMaterial).color.copy(night > 0.5 ? new THREE.Color(0xcfe0ff) : sunColor);
    (this.glow.material as THREE.SpriteMaterial).opacity = glowVisible * (night > 0.5 ? 0.26 : 0.5) * Math.max(0.25, 1 - night * 0.4);

    // полоса объектива
    this.streak.position.copy(camera.position).addScaledVector(sunDir, 620);
    this.streak.quaternion.copy(camera.quaternion);
    (this.streak.material as THREE.MeshBasicMaterial).opacity = glowVisible * (1 - night) * 0.22 * Math.max(0, sunDir.y * 2.2);

    // лучи
    const shaftStrength = Math.max(0, (sunDir.y - 0.12) * 1.8) * (1 - night * 0.75);
    this.shafts.forEach((m, i) => {
      const a = (i / this.shafts.length) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      m.position.copy(camera.position).addScaledVector(dir, 90).addScaledVector(sunDir, 240);
      m.quaternion.copy(camera.quaternion);
      m.rotateZ(Math.atan2(dir.z, dir.x) + sunDir.y * 0.5);
      (m.material as THREE.MeshBasicMaterial).opacity = shaftStrength * (0.1 + 0.06 * Math.sin(a * 3 + performance.now() * 0.0002));
    });

    // затухание молнии
    if (this.boltLife > 0) {
      this.boltLife -= dt;
      (this.bolt.material as THREE.LineBasicMaterial).opacity = Math.max(0, this.boltLife / 0.22) * 0.95;
      this.sunLight.intensity *= Math.pow(0.0008, dt);
      if (this.boltLife <= 0) this.bolt.visible = false;
    } else if (this.sunLight.intensity > 0.5) {
      this.sunLight.intensity *= Math.pow(0.002, dt);
    } else this.sunLight.intensity = 0;

    this.flash = Math.max(0, this.flash - dt * 3.4);
    if (this.thunderTimer > 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) this.onThunder?.();
    }

    // жара: дрожание воздуха днём у воды
    const targetHeat = (1 - night) * (0.55 + 0.45 * Math.max(0, sunDir.y));
    this.heat += (targetHeat - this.heat) * Math.min(1, dt * 0.7);

    // пар
    for (let i = 0; i < this.steam.length; i++) {
      const st = this.steamState[i];
      const s = this.steam[i];
      st.age += dt;
      if (st.age > st.life) {
        st.age = 0;
        st.life = 3 + Math.random() * 3.4;
        if (Math.random() < 0.35) st.base.set(st.base.x + (Math.random() - 0.5) * 6, 0.05, st.base.z + (Math.random() - 0.5) * 6);
        s.visible = false;
        continue;
      }
      const k = st.age / st.life;
      s.visible = true;
      s.position.set(st.base.x + Math.sin(st.age * 1.7 + i) * 0.5, st.base.y + 0.4 + k * 3.4, st.base.z + Math.cos(st.age * 1.3 + i) * 0.5);
      s.scale.setScalar(1.1 + k * 3.4);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.16 * (0.6 + night * 0.6);
    }

    // брызги прибоя
    for (let i = 0; i < this.spray.length; i++) {
      const st = this.sprayState[i];
      const s = this.spray[i];
      st.age += dt;
      if (st.age > st.life) {
        st.age = 0;
        st.life = 1.5 + Math.random() * 1.8;
        const z = -470 + Math.random() * 940;
        st.pos.set(st.pos.x, 0.3, z);
        s.visible = false;
        continue;
      }
      const k = st.age / st.life;
      s.visible = true;
      s.position.set(st.pos.x, 0.2 + Math.sin(k * Math.PI) * 1.5, st.pos.z);
      s.scale.setScalar(2.6 + k * 4.2);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.22;
    }
  }

  dispose() {
    this.glow.removeFromParent();
    this.streak.removeFromParent();
    this.bolt.removeFromParent();
    this.sunLight.removeFromParent();
    for (const s of this.shafts) s.removeFromParent();
    for (const s of this.steam) s.removeFromParent();
    for (const s of this.spray) s.removeFromParent();
  }
}
