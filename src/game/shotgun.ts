import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface ShellHit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  traveled: number;
}

// Помповый дробовик 12 калибра: 8 дробин, сильная отдача, перезарядка по одной
export class Shotgun {
  group = new THREE.Group();
  pump!: THREE.Group;
  muzzle = new THREE.Object3D();
  muzzleFlash!: THREE.Mesh;
  flashLight!: THREE.PointLight;

  shells = 6;
  maxShells = 6;
  reserve = 24;
  damageMul = 1;
  spreadMul = 1;
  reloading = false;
  reloadT = 0;
  cycling = 0;      // перезарядка затвора/помпы
  recoil = 0;
  recoilVel = 0;
  recoilYaw = 0;
  recoilYawVel = 0;
  ads = 0;
  aimSpread = 0;
  swayX = 0;
  swayY = 0;
  swayVX = 0;
  swayVY = 0;
  bobPhase = 0;
  private time = 0;

  pellets: ShellHit[] = [];

  constructor(camera: THREE.Camera) {
    camera.add(this.group);
    this.group.position.set(0.24, -0.26, -0.44);
    this.group.rotation.set(0.04, 0.1, 0);

    // ствол + ложе
    const barrel = new THREE.CylinderGeometry(0.017, 0.017, 0.62, 10);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0.03, -0.42);
    const mag = new THREE.CylinderGeometry(0.014, 0.014, 0.55, 8);
    mag.rotateX(Math.PI / 2);
    mag.translate(0, -0.018, -0.38);
    const stock = new THREE.BoxGeometry(0.05, 0.11, 0.3);
    stock.translate(0, -0.035, 0.09);
    const grip = new THREE.BoxGeometry(0.045, 0.12, 0.07);
    grip.rotateX(0.3);
    grip.translate(0, -0.09, 0.02);
    const receiver = new THREE.BoxGeometry(0.055, 0.075, 0.16);
    receiver.translate(0, 0.015, -0.06);
    const body = new THREE.Mesh(
      mergeGeometries([barrel, mag, stock, grip, receiver])!,
      new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.7, metalness: 0.35 })
    );
    this.group.add(body);

    // цевьё (помпа) — двигается при перезарядке
    const pumpGeo = new THREE.BoxGeometry(0.05, 0.05, 0.13);
    pumpGeo.translate(0, -0.012, -0.26);
    this.pump = new THREE.Group();
    this.pump.add(new THREE.Mesh(pumpGeo, new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 0.6 })));
    this.group.add(this.pump);

    this.muzzle.position.set(0, 0.03, -0.72);
    this.group.add(this.muzzle);
    const flashGeo = new THREE.ConeGeometry(0.05, 0.16, 6);
    flashGeo.rotateX(-Math.PI / 2);
    this.muzzleFlash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.muzzleFlash.position.z = -0.08;
    this.muzzle.add(this.muzzleFlash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2);
    this.flashLight.position.z = -0.1;
    this.muzzle.add(this.flashLight);
  }

  get canFire() { return !this.reloading && this.cycling <= 0 && this.shells > 0; }

  tryFire(camera: THREE.Camera, spreadBase: number): boolean {
    if (!this.canFire) return false;
    this.shells--;
    this.cycling = 0.75;             // перезарядка помпы
    this.time = performance.now() / 1000;

    const dir = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const origin = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.7);
    const spread = (spreadBase + this.aimSpread) * this.spreadMul;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.pellets.push({ pos: origin.clone(), vel: d.multiplyScalar(300 + Math.random() * 40), life: 0, dmg: 15 * this.damageMul, traveled: 0 });
    }
    this.aimSpread = Math.min(0.12, this.aimSpread + 0.02);
    this.recoilVel += 7.5;
    this.recoilYawVel += (Math.random() - 0.5) * 2.4;
    return true;
  }

  startReload(): boolean {
    if (this.reloading || this.shells >= this.maxShells || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    return true;
  }

  update(dt: number, _camera: THREE.Camera, moveSpeed: number, camAngVel: THREE.Vector2, wantAds: boolean) {
    this.time += dt;
    if (this.cycling > 0) this.cycling = Math.max(0, this.cycling - dt);
    this.aimSpread = Math.max(0, this.aimSpread - dt * 0.08);
    const adsTarget = wantAds && !this.reloading ? 1 : 0;
    this.ads += (adsTarget - this.ads) * (1 - Math.exp(-dt * 12));

    if (this.reloading) {
      this.reloadT += dt;
      // патрон за патроном: 0.45 c на гильзу
      if (this.reloadT > 0.45) {
        this.reloadT -= 0.45;
        this.shells++;
        this.reserve--;
        if (this.shells >= this.maxShells || this.reserve <= 0) this.reloading = false;
      }
    }

    // помпа: вперёд-назад
    const cyc = this.cycling / 0.75;
    const pump = this.cycling > 0 ? Math.sin(Math.min(1, cyc) * Math.PI) * 0.09 : 0;
    this.pump.position.z = pump;

    this.recoilVel += (-this.recoil * 240 - this.recoilVel * 20) * dt;
    this.recoil += this.recoilVel * dt;
    this.recoilYawVel += (-this.recoilYaw * 200 - this.recoilYawVel * 18) * dt;
    this.recoilYaw += this.recoilYawVel * dt;

    this.bobPhase += dt * (2 + moveSpeed * 1.6);
    const bob = Math.min(1, moveSpeed / 3.4);
    const bx = Math.sin(this.bobPhase) * 0.014 * bob;
    const by = Math.abs(Math.cos(this.bobPhase)) * 0.016 * bob;
    const tgx = -camAngVel.y * 0.024;
    const tgy = -camAngVel.x * 0.024;
    this.swayVX += ((tgx - this.swayX) * 60 - this.swayVX * 11) * dt;
    this.swayVY += ((tgy - this.swayY) * 60 - this.swayVY * 11) * dt;
    this.swayX += this.swayVX * dt;
    this.swayY += this.swayVY * dt;

    const hipX = 0.24, hipY = -0.26, hipZ = -0.44;
    const adsX = 0.0, adsY = -0.085, adsZ = -0.3;
    this.group.position.set(
      THREE.MathUtils.lerp(hipX, adsX, this.ads) + bx + this.swayX,
      THREE.MathUtils.lerp(hipY, adsY, this.ads) + by + this.swayY - this.recoil * 0.025,
      THREE.MathUtils.lerp(hipZ, adsZ, this.ads) + this.recoil * 0.06
    );
    this.group.rotation.set(
      THREE.MathUtils.lerp(0.04, 0, this.ads) + this.recoil * 0.3 + this.swayY * 0.5,
      THREE.MathUtils.lerp(0.1, 0, this.ads) + this.recoilYaw * 0.1,
      0
    );

    const fm = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    if (this.cycling > 0.68) {
      const k = (this.cycling - 0.68) / 0.07;
      fm.opacity = Math.max(0, k);
      this.muzzleFlash.rotation.z = Math.random() * 6.28;
      this.muzzleFlash.scale.setScalar(0.9 + Math.random() * 0.6);
      this.flashLight.intensity = 18 * k;
    } else {
      fm.opacity = 0;
      this.flashLight.intensity = 0;
    }
  }

  cameraKick() { return { pitch: this.recoil * 0.05, yaw: this.recoilYaw * 0.02 }; }
}
