import * as THREE from 'three';

/**
 * Ambient — бытовая жизнь города и пляжа.
 * Катера и гидроциклы с кильватерным следом, самолёт в небе с мигающими
 * огнями, зонты и полотенца на песке, тележки с едой, мусор, конусы,
 * летящие по ветру газеты и уличный музыкант.
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

function wakeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(50, 0); ctx.lineTo(64, 128); ctx.lineTo(0, 128);
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Boat {
  root: THREE.Group;
  wake: THREE.Mesh;
  speed: number;
  dir: 1 | -1;
  z: number;
  x: number;
  bob: number;
}

export class Ambient {
  private boats: Boat[] = [];
  private plane: THREE.Group | null = null;
  private planeT = 20;
  private newspapers: THREE.Mesh[] = [];
  private neonMesh: THREE.InstancedMesh | null = null;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private opts: { quality: 'low' | 'high' | 'ultra'; shoreAt: (z: number) => number; groundAt: (x: number, z: number) => number; sandStart: number; oceanDrive: number },
  ) {
    this.buildBeach();
    this.buildBoats();
    this.buildStreet();
    this.buildPlane();
  }

  /* ── пляж: зонты, полотенца, лежаки, купальщики ─────────────────── */
  private buildBeach() {
    const { shoreAt, groundAt } = this.opts;
    const q = this.opts.quality;
    const umbrellas = q === 'low' ? 5 : 12;
    const colors = [0xe0544f, 0x3f7fd6, 0xf2c14e, 0x51a86a, 0xe08a3c, 0xcd5fa6];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 });
    const towelGeo = new THREE.PlaneGeometry(1.1, 2);
    towelGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < umbrellas; i++) {
      const z = -380 + (i / umbrellas) * 760 + Math.random() * 20;
      const shore = shoreAt(z);
      const x = shore - 8 - Math.random() * 26;
      const y = groundAt(x, z);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5), poleMat);
      pole.position.y = 1.05;
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(1.35, 0.42, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.85, side: THREE.DoubleSide }),
      );
      canopy.position.y = 2.05;
      canopy.rotation.z = (Math.random() - 0.5) * 0.18;
      g.add(pole, canopy);
      g.position.set(x, y, z);
      g.rotation.y = Math.random() * 6.28;
      this.scene.add(g);

      if (q !== 'low' && i % 2 === 0) {
        const towel = new THREE.Mesh(towelGeo, new THREE.MeshStandardMaterial({ color: colors[(i + 2) % colors.length], roughness: 0.95, side: THREE.DoubleSide }));
        towel.position.set(x + 0.6, groundAt(x + 0.6, z + 1) + 0.02, z + 1.2);
        towel.rotation.y = Math.random() * 0.6;
        this.scene.add(towel);
        // лежак
        const bed = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.12, 1.9),
          new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.8 }),
        );
        bed.position.set(x - 1.2, groundAt(x - 1.2, z) + 0.42, z);
        this.scene.add(bed);
        for (const dz of [-0.7, 0.7]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), poleMat);
          leg.position.set(x - 1.2, groundAt(x - 1.2, z) + 0.21, z + dz);
          this.scene.add(leg);
        }
        // купальщик
        if (i % 3 === 0) {
          const skin = new THREE.MeshStandardMaterial({ color: [0xd8a37c, 0xb07a52, 0x8d5b3a][i % 3], roughness: 0.7 });
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), skin);
          torso.rotation.z = Math.PI / 2;
          torso.position.set(x - 1.2, groundAt(x - 1.2, z) + 0.58, z);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), skin);
          head.position.set(x - 1.75, groundAt(x - 1.75, z) + 0.6, z);
          torso.castShadow = head.castShadow = true;
          this.scene.add(torso, head);
        }
      }
    }
  }

  /* ── катера и гидроциклы ─────────────────────────────────────────── */
  private buildBoats() {
    const { shoreAt } = this.opts;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ea, roughness: 0.4, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22282c, roughness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0e0, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.65 });
    const wakeTex = wakeTexture();
    const count = this.opts.quality === 'low' ? 2 : 5;

    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      const isJet = i % 3 === 2;
      if (isJet) {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.5, 4, 10), hullMat);
        body.rotation.z = Math.PI / 2;
        body.scale.set(1, 1, 0.7);
        root.add(body);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.7), darkMat);
        seat.position.set(0, 0.28, -0.1);
        root.add(seat);
      } else {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 5.4), hullMat);
        hull.position.y = 0.2;
        const bow = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.9, 4), hullMat);
        bow.rotation.x = Math.PI / 2;
        bow.rotation.y = Math.PI / 4;
        bow.position.set(0, 0.2, 3.1);
        bow.scale.set(1, 0.45, 1);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 2), glassMat);
        cabin.position.set(0, 0.85, -0.4);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 4.6), new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 }));
        deck.position.set(0, 0.52, 0.2);
        root.add(hull, bow, cabin, deck);
      }
      root.castShadow = true;

      const z = -420 + Math.random() * 840;
      const x = shoreAt(z) + 30 + Math.random() * 90;
      root.position.set(x, 0.15, z);
      root.rotation.y = Math.random() < 0.5 ? 0 : Math.PI;
      this.scene.add(root);

      const wake = new THREE.Mesh(
        new THREE.PlaneGeometry(isJet ? 2.6 : 5.2, 16),
        new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.35, blending: THREE.AdditiveBlending }),
      );
      wake.rotation.x = -Math.PI / 2;
      wake.frustumCulled = false;
      this.scene.add(wake);

      this.boats.push({
        root, wake,
        speed: isJet ? 7 + Math.random() * 6 : 3.5 + Math.random() * 3,
        dir: Math.random() < 0.5 ? 1 : -1,
        z, x, bob: Math.random() * 6,
      });
    }
  }

  /* ── уличная мелочь ──────────────────────────────────────────────── */
  private buildStreet() {
    const { groundAt, oceanDrive } = this.opts;
    const q = this.opts.quality;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.9 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xe2622a, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.85 });

    // конусы вдоль Ocean Drive — один инстанс-меш на все
    const cones = q === 'low' ? 6 : 16;
    const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.62, 8), orange, cones);
    for (let i = 0; i < cones; i++) {
      const z = -400 + Math.random() * 800;
      const x = oceanDrive + (Math.random() < 0.5 ? -6 : 6) + (Math.random() - 0.5) * 3;
      _e.set(0, Math.random() * 6, (Math.random() - 0.5) * 0.2);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, groundAt(x, z) + 0.31, z), _q, _s.set(1, 1, 1));
      coneMesh.setMatrixAt(i, _m);
    }
    coneMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(coneMesh);

    // мешки мусора
    const bags = q === 'low' ? 8 : 22;
    const bagMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 7, 6), dark, bags);
    for (let i = 0; i < bags; i++) {
      const z = -420 + Math.random() * 840;
      const x = oceanDrive + (Math.random() < 0.5 ? -13 : 13) + (Math.random() - 0.5) * 4;
      _e.set(0, Math.random() * 6, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, groundAt(x, z) + 0.3, z), _q, _s.set(1, 0.85, 0.95));
      bagMesh.setMatrixAt(i, _m);
    }
    bagMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(bagMesh);

    // тележки с едой (по одной на район)
    for (let i = 0; i < 4; i++) {
      const z = -300 + i * 200;
      const x = oceanDrive - 14;
      const cart = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 0.9), new THREE.MeshStandardMaterial({ color: 0xd8d3c4, roughness: 0.6, metalness: 0.3 }));
      box.position.y = 0.85;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.1), orange);
      roof.position.y = 1.4;
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7), new THREE.MeshStandardMaterial({ color: 0xe8d5a5, roughness: 0.9, side: THREE.DoubleSide }));
      awning.position.set(0, 1.62, 0.35);
      awning.rotation.x = -0.6;
      cart.add(box, roof, awning);
      for (const dz of [-0.3, 0.3]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(-0.6, 0.2, dz);
        cart.add(wheel);
      }
      cart.position.set(x, groundAt(x, z), z);
      cart.rotation.y = Math.PI / 2;
      this.scene.add(cart);
    }

    // летящие газеты — плоскость, которую крутит ветер
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d6, roughness: 0.95, side: THREE.DoubleSide });
    const paperCount = q === 'low' ? 4 : 10;
    for (let i = 0; i < paperCount; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.55), paperMat);
      m.position.set(oceanDrive + (Math.random() - 0.5) * 24, 0.1 + Math.random(), -400 + Math.random() * 800);
      this.scene.add(m);
      this.newspapers.push(m);
    }

    // неоновые отражения на мокром асфальте
    if (q !== 'low') {
      const glowTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,120,190,0.85)');
        g.addColorStop(1, 'rgba(255,120,190,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const neonMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff8fc4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const neonMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 5), neonMat, 26);
      const palette = [new THREE.Color(0xff5fa8), new THREE.Color(0x5fe3ff), new THREE.Color(0xffd166), new THREE.Color(0x9df58e)];
      for (let i = 0; i < 26; i++) {
        _e.set(-Math.PI / 2, 0, 0);
        _q.setFromEuler(_e);
        const z = -420 + i * 33;
        const x = oceanDrive + (Math.random() - 0.5) * 14;
        _m.compose(_p.set(x, groundAt(x, z) + 0.03, z), _q, _s.set(1, 1, 1));
        neonMesh.setMatrixAt(i, _m);
        neonMesh.setColorAt(i, palette[i % palette.length]);
      }
      neonMesh.instanceMatrix.needsUpdate = true;
      if (neonMesh.instanceColor) neonMesh.instanceColor.needsUpdate = true;
      neonMesh.frustumCulled = false;
      this.neonMesh = neonMesh;
      this.scene.add(neonMesh);
    }

    // полоса белой разметки на берегу (маячок для ориентира)
    for (let i = 0; i < 3; i++) {
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: [0xe0544f, 0xf2c14e, 0x51a86a][i], roughness: 0.8, side: THREE.DoubleSide }));
      const z = -260 + i * 260;
      const x = this.opts.shoreAt(z) - 6;
      flag.position.set(x, groundAt(x, z) + 1.5, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), white);
      pole.position.set(x, groundAt(x, z) + 0.8, z);
      this.scene.add(flag, pole);
    }
  }

  private buildPlane() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.5, metalness: 0.4 });
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 12, 4, 8), bodyMat);
    fus.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 2.2), bodyMat);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.24, 1.2), bodyMat);
    tail.position.set(0, 0.5, -5.6);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.2, 1.4), bodyMat);
    fin.position.set(0, 1.1, -5.4);
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.22, 5, 4), new THREE.MeshBasicMaterial({ color: 0xff4a4a }));
    blink.position.set(16 * 0.5, 0, 0);
    const blink2 = blink.clone();
    blink2.position.x = -8;
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 5, 4), new THREE.MeshBasicMaterial({ color: 0x8ff5ff }));
    strobe.position.set(0, 0.6, -5.9);
    g.add(fus, wing, tail, fin, blink, blink2, strobe);
    g.visible = false;
    g.scale.setScalar(1.4);
    this.scene.add(g);
    this.plane = g;
  }

  update(dt: number, night: number, wet: number, wind: number) {
    this.time += dt;
    const { shoreAt } = this.opts;

    // катера
    for (const b of this.boats) {
      b.z += b.speed * b.dir * dt;
      if (b.z > 470) { b.z = -470; b.dir = 1; }
      if (b.z < -470) { b.z = 470; b.dir = -1; }
      b.bob += dt * 1.4;
      b.x = shoreAt(b.z) + 30 + Math.sin(b.z * 0.01) * 12;
      b.root.position.set(b.x, 0.12 + Math.sin(b.bob) * 0.12, b.z);
      b.root.rotation.z = Math.sin(b.bob * 0.8) * 0.05;
      b.root.rotation.y = b.dir > 0 ? 0 : Math.PI;
      b.wake.position.set(b.x, 0.36 + Math.sin(b.bob) * 0.05, b.z - b.dir * 9);
      b.wake.rotation.z = b.dir > 0 ? 0 : Math.PI;
      (b.wake.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(b.bob * 2) * 0.05;
    }

    // самолёт
    if (this.plane) {
      this.planeT -= dt;
      if (this.planeT <= 0 && !this.plane.visible) {
        this.plane.visible = true;
        this.plane.position.set(-700, 150 + Math.random() * 60, -500 + Math.random() * 1000);
        this.plane.rotation.y = Math.random() * 0.4;
        this.planeT = 60 + Math.random() * 90;
      }
      if (this.plane.visible) {
        this.plane.position.x += dt * 62;
        const blink = (Math.sin(this.time * 6) > 0.4) ? 1 : 0.12;
        this.plane.children.forEach((ch, i) => {
          if (i >= 4) ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = blink;
        });
        if (this.plane.position.x > 760) this.plane.visible = false;
      }
    }

    // газеты крутит ветер
    for (let i = 0; i < this.newspapers.length; i++) {
      const n = this.newspapers[i];
      n.position.x += Math.sin(this.time * 0.7 + i) * dt * 1.1 * (1 + wind);
      n.position.z += Math.cos(this.time * 0.5 + i * 1.7) * dt * 0.9 * (1 + wind);
      n.position.y = 0.12 + Math.abs(Math.sin(this.time * 2.2 + i)) * 0.5;
      n.rotation.x += dt * (1.5 + wind * 3);
      n.rotation.y += dt * 0.8;
      if (Math.abs(n.position.x) > 520 || Math.abs(n.position.z) > 520) {
        n.position.set((Math.random() - 0.5) * 200, 0.3, (Math.random() - 0.5) * 200);
      }
    }

    // неон на мокром асфальте: виден только ночью и в дождь
    const neon = Math.max(0, night - 0.25) * (0.35 + wet * 0.85);
    if (this.neonMesh) {
      (this.neonMesh.material as THREE.MeshBasicMaterial).opacity = neon * 0.5;
      this.neonMesh.visible = neon > 0.02;
    }
  }

  /** Ближайший катер — можно угнать (используется Game). */
  nearestBoat(pos: THREE.Vector3, max = 40) {
    let best: Boat | null = null, bd = max;
    for (const b of this.boats) {
      const d = _v.set(b.root.position.x, 0, b.root.position.z).distanceTo(_v2.set(pos.x, 0, pos.z));
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
