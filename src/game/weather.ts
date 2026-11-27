import * as THREE from 'three';

export class Weather {
  rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private positions!: Float32Array;
  private count = 1150;
  private area = 42;
  intensity = 0;       // 0..1
  target = 0;
  wind = new THREE.Vector2(1.6, 0.4);
  private drops: { x: number; y: number; z: number; v: number }[] = [];
  fogBoost = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbccee1, transparent: true, opacity: 0.46, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    for (let i = 0; i < this.count; i++) {
      this.drops.push({
        x: (Math.random() - 0.5) * this.area,
        y: Math.random() * 22,
        z: (Math.random() - 0.5) * this.area,
        v: 18 + Math.random() * 14,
      });
    }
  }

  setTarget(v: number) { this.target = v; }

  update(dt: number, focus: THREE.Vector3) {
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * 0.35);
    this.rain.material.opacity = 0.36 * this.intensity;
    this.rain.visible = this.intensity > 0.02;
    this.fogBoost = this.intensity;
    if (!this.rain.visible) return;
    this.rain.position.set(focus.x, 0, focus.z);
    const arr = this.positions;
    const n = Math.floor(this.count * this.intensity);
    this.rain.geometry.setDrawRange(0, n * 2);
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      d.y -= d.v * dt;
      d.x += this.wind.x * dt;
      d.z += this.wind.y * dt;
      if (d.y < 0) {
        d.y = 22;
        d.x = (Math.random() - 0.5) * this.area;
        d.z = (Math.random() - 0.5) * this.area;
      }
      const k = i * 6;
      arr[k] = d.x; arr[k + 1] = d.y; arr[k + 2] = d.z;
      arr[k + 3] = d.x - this.wind.x * 0.012; arr[k + 4] = d.y + d.v * 0.012; arr[k + 5] = d.z - this.wind.y * 0.012;
    }
    (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
