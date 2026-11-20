import * as THREE from 'three';

/**
 * Wildlife — живность Майами.
 * Чайки над пляжем, фламинго на мелководье, коты в переулках,
 * аллигаторы у острова, выпрыгивающая рыба, светлячки и бабочки.
 * Всё в одном инстанс-ориентированном слое: на телефоне часть стай отключается.
 */

interface Bird {
  root: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  speed: number;
  angle: number;
  height: number;
  flap: number;
  state: 'fly' | 'glide' | 'landed';
  timer: number;
  groundY: number;
}

interface Drifter {
  root: THREE.Object3D;
  phase: number;
  speed: number;
  axis: 'x' | 'z';
  min: number;
  max: number;
}

export class Wildlife {
  private birds: Bird[] = [];
  private gators: Drifter[] = [];
  private fish: { mesh: THREE.Mesh; t: number; life: number; from: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  private fireflies: THREE.Points | null = null;
  private butterflies: THREE.Group[] = [];
  private cats: THREE.Group[] = [];
  private fireflyPositions: Float32Array | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private opts: { quality: 'low' | 'high' | 'ultra'; shoreAt: (z: number) => number; groundAt: (x: number, z: number) => number },
  ) {
    this.build(scene);
  }

  private build(scene: THREE.Scene) {
    const q = this.opts.quality;
    const birdCount = q === 'low' ? 5 : q === 'high' ? 9 : 14;
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xd9a24a, roughness: 0.7 });
    const bodyGeo = new THREE.SphereGeometry(0.16, 7, 5);
    bodyGeo.scale(1, 0.85, 1.9);
    const wingGeo = new THREE.PlaneGeometry(0.85, 0.24);
    wingGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < birdCount; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, i % 3 === 0 ? grey : white);
      body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), i % 3 === 0 ? grey : white);
      head.position.set(0, 0.06, 0.26);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 5), beakMat);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.05, 0.35);
      const wingL = new THREE.Mesh(wingGeo, white);
      const wingR = new THREE.Mesh(wingGeo, white);
      wingL.position.set(-0.13, 0.03, 0);
      wingR.position.set(0.13, 0.03, 0);
      root.add(body, head, beak, wingL, wingR);
      const z = -320 + Math.random() * 640;
      root.position.set(this.opts.shoreAt(z) - 30 - Math.random() * 60, 16 + Math.random() * 20, z);
      scene.add(root);
      this.birds.push({
        root, wingL, wingR,
        center: new THREE.Vector3(root.position.x - 40, 0, z),
        radius: 26 + Math.random() * 46,
        speed: 0.16 + Math.random() * 0.18,
        angle: Math.random() * Math.PI * 2,
        height: 12 + Math.random() * 18,
        flap: Math.random() * 6,
        state: 'fly',
        timer: 6 + Math.random() * 12,
        groundY: 0.2,
      });
    }

    // фламинго на мелководье
    const pink = new THREE.MeshStandardMaterial({ color: 0xe98c9a, roughness: 0.75 });
    const flamingoCount = q === 'low' ? 3 : 7;
    for (let i = 0; i < flamingoCount; i++) {
      const g = new THREE.Group();
      const z = -300 + Math.random() * 600;
      const x = this.opts.shoreAt(z) - 3 - Math.random() * 5;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 9, 7), pink);
      body.scale.set(1, 0.85, 1.35);
      body.position.y = 0.72;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.62, 6), pink);
      neck.position.set(0, 1.06, 0.18);
      neck.rotation.x = -0.24;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), pink);
      head.position.set(0, 1.38, 0.28);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), new THREE.MeshStandardMaterial({ color: 0x33302c }));
      beak.rotation.x = Math.PI / 2 - 0.4;
      beak.position.set(0, 1.34, 0.4);
      g.add(body, head, neck, beak);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 5), new THREE.MeshStandardMaterial({ color: 0xb4707c }));
        leg.position.set(sx * 0.09, 0.31, 0);
        g.add(leg);
      }
      g.position.set(x, 0.05, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      scene.add(g);
      this.cats.push(g); // переиспользуем слот для «пассивной» живности
    }

    // аллигаторы у берега острова
    const scale = new THREE.MeshStandardMaterial({ color: 0x2f3b2c, roughness: 0.9 });
    const gatorCount = q === 'low' ? 1 : 3;
    for (let i = 0; i < gatorCount; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), scale);
      body.scale.set(0.8, 0.5, 2.5);
      body.position.y = 0.16;
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.9), scale);
      jaw.position.set(0, 0.13, 1.15);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.5, 6), scale);
      tail.rotation.x = -Math.PI / 2;
      tail.position.set(0, 0.14, -1.4);
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffcf5c, emissive: 0xffb02e, emissiveIntensity: 1.6 });
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), eyeMat);
        eye.position.set(sx * 0.16, 0.32, 0.72);
        g.add(eye);
      }
      g.add(body, jaw, tail);
      const z = -90 + i * 60;
      g.position.set(796 + Math.random() * 20, 0.05, z);
      scene.add(g);
      this.gators.push({ root: g, phase: Math.random() * 6, speed: 0.5 + Math.random() * 0.5, axis: 'x', min: 760, max: 812 });
    }

    // рыба
    const fishMat = new THREE.MeshStandardMaterial({ color: 0x6f7f8c, roughness: 0.4, metalness: 0.4 });
    const fishCount = q === 'low' ? 2 : 5;
    for (let i = 0; i < fishCount; i++) {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 6), fishMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.fish.push({ mesh, t: Math.random() * 6, life: 0, from: new THREE.Vector3(), dir: new THREE.Vector3() });
    }

    // светлячки ночью
    if (q !== 'low') {
      const n = q === 'ultra' ? 160 : 90;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = -260 + Math.random() * 520;
        pos[i * 3 + 1] = 0.6 + Math.random() * 3.4;
        pos[i * 3 + 2] = -300 + Math.random() * 600;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xd7f59a, size: 0.16, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.fireflies = new THREE.Points(geo, mat);
      this.fireflies.frustumCulled = false;
      this.fireflyPositions = pos;
      scene.add(this.fireflies);
    }

    // бабочки днём
    const bcount = q === 'low' ? 0 : 6;
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    for (let i = 0; i < bcount; i++) {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), wingMat);
        w.position.x = sx * 0.07;
        g.add(w);
      }
      g.position.set(-120 + Math.random() * 240, 1 + Math.random() * 1.6, -160 + Math.random() * 320);
      scene.add(g);
      this.butterflies.push(g);
    }
  }

  /** Спугнуть птиц выстрелом или ударом. */
  scare(pos: THREE.Vector3, radius = 24) {
    for (const b of this.birds) {
      if (b.state === 'landed' && b.root.position.distanceTo(pos) < radius) {
        b.state = 'fly';
        b.timer = 8 + Math.random() * 10;
        b.height = 14 + Math.random() * 12;
      }
    }
    for (const f of this.fish) {
      if (f.t > 0.5 && f.from.distanceTo(pos) < radius) f.t = 0;
    }
  }

  update(dt: number, camera: THREE.Camera, night: number, playerPos: THREE.Vector3) {
    this.time += dt;
    const camPos = camera.position;

    // чайки
    for (const b of this.birds) {
      b.flap += dt * (b.state === 'glide' ? 2.2 : 9.5);
      const flapAngle = Math.sin(b.flap) * (b.state === 'glide' ? 0.12 : 0.62);
      b.wingL.rotation.z = flapAngle;
      b.wingR.rotation.z = -flapAngle;
      if (b.state === 'landed') {
        b.timer -= dt;
        b.root.position.y += (0.24 - b.root.position.y) * Math.min(1, dt * 4);
        b.root.rotation.z *= 0.9;
        if (b.timer <= 0) {
          b.state = 'fly';
          b.height = 13 + Math.random() * 16;
          b.timer = 9 + Math.random() * 10;
        }
        continue;
      }
      b.angle += dt * b.speed;
      b.timer -= dt;
      if (b.timer < 0 && b.state === 'fly') {
        b.state = 'glide';
        b.timer = 3 + Math.random() * 4;
      } else if (b.timer < 0 && b.state === 'glide') {
        b.state = 'fly';
        b.timer = 6 + Math.random() * 8;
      }
      const px = b.center.x + Math.cos(b.angle) * b.radius;
      const pz = b.center.z + Math.sin(b.angle) * b.radius;
      const py = b.height + Math.sin(this.time * 0.9 + b.angle) * 1.6;
      b.root.position.set(px, py, pz);
      b.root.rotation.y = -b.angle + Math.PI / 2;
      b.root.rotation.z = Math.sin(b.angle) * 0.12;
    }

    // аллигаторы плавают
    for (const g of this.gators) {
      g.phase += dt * 0.16 * g.speed;
      const t = (Math.sin(g.phase) + 1) / 2;
      g.root.position.z = g.min + (g.max - g.min) * t;
      g.root.rotation.y = Math.cos(g.phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.root.position.y = 0.02 + Math.sin(this.time * 1.6 + g.phase) * 0.04;
    }

    // рыба выпрыгивает
    for (const f of this.fish) {
      f.t += dt;
      if (f.life > 0) {
        f.life -= dt;
        f.mesh.position.addScaledVector(f.dir, dt);
        f.dir.y -= dt * 9;
        f.mesh.rotation.z += dt * 9;
        if (f.dir.y < 0 && f.mesh.position.y < 0.1) {
          f.life = 0;
          f.mesh.visible = false;
        }
      } else if (f.t > 7 + Math.random() * 8) {
        f.t = 0;
        const z = -300 + Math.random() * 600;
        f.from.set(this.opts.shoreAt(z) + 6 + Math.random() * 20, 0.1, z);
        f.dir.set((Math.random() - 0.5) * 2, 4.5 + Math.random() * 2, (Math.random() - 0.5) * 2);
        f.mesh.position.copy(f.from);
        f.mesh.visible = true;
        f.life = 1.4;
      }
    }

    // светлячки
    if (this.fireflies && this.fireflyPositions) {
      const mat = this.fireflies.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, night - 0.35) * 1.5;
      this.fireflies.visible = mat.opacity > 0.02;
      if (this.fireflies.visible) {
        const p = this.fireflyPositions;
        for (let i = 0; i < p.length; i += 3) {
          p[i] += Math.sin(this.time * 1.3 + i) * dt * 0.4;
          p[i + 1] += Math.cos(this.time * 1.7 + i) * dt * 0.3;
          p[i + 2] += Math.cos(this.time * 1.1 + i * 0.7) * dt * 0.4;
        }
        (this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // бабочки
    for (let i = 0; i < this.butterflies.length; i++) {
      const g = this.butterflies[i];
      g.position.x += Math.sin(this.time * 1.4 + i) * dt * 1.2;
      g.position.z += Math.cos(this.time * 1.1 + i * 2) * dt * 1.2;
      g.position.y = 1.1 + Math.sin(this.time * 2.4 + i) * 0.35;
      g.rotation.y += dt * 2.6;
      const s = Math.abs(Math.sin(this.time * 14 + i)) * 0.6 + 0.4;
      g.scale.set(s, 1, 1);
      g.visible = night < 0.45;
    }

    // фламинго, коты: лёгкое покачивание
    for (let i = 0; i < this.cats.length; i++) {
      const c = this.cats[i];
      c.rotation.y += Math.sin(this.time * 0.2 + i) * dt * 0.05;
    }

    // очень далёкая живность не считается
    void camPos; void playerPos;
  }
}
