import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Телефон в руке — как в GTA V.
 *
 * Когда открыт интерфейс телефона, персонаж поднимает аппарат: в первом лице
 * он появляется в правом нижнем углу кадра, в третьем — в правой руке модели.
 * Экран светится (emissive), поэтому ночью телефон подсвечивает лицо и ладонь.
 * Анимация — плавный подъём из-за пояса с наклоном.
 */

const W = 0.078;   // ширина корпуса
const H = 0.152;   // высота
const D = 0.009;   // толщина

export class HandyPhone {
  group = new THREE.Group();
  private screen!: THREE.Mesh;
  private screenMat!: THREE.MeshStandardMaterial;
  private glow!: THREE.PointLight;
  /** 0 — в кармане, 1 — поднят к лицу. */
  anim = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);
    this.build();
  }

  private makeScreenTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    // обои
    const g = ctx.createLinearGradient(0, 0, 256, 512);
    g.addColorStop(0, '#12203a');
    g.addColorStop(0.55, '#2a1150');
    g.addColorStop(1, '#07131f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 512);
    // неоновая сетка
    ctx.strokeStyle = 'rgba(90,220,255,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 24) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    }
    // статус-бар
    ctx.fillStyle = 'rgba(6,10,18,0.72)';
    ctx.fillRect(0, 0, 256, 34);
    ctx.fillStyle = '#cfe6ff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('21:40', 14, 23);
    ctx.fillText('▮▮▮ 84%', 168, 23);
    // заголовок
    ctx.fillStyle = '#ff4fa3';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('MAUI OS', 16, 66);
    // иконки приложений
    const icons = [
      ['#ff6b6b', '★'], ['#f0a05a', '⌂'], ['#43d9a3', '$'], ['#7fb8ff', '◉'],
      ['#ffd166', '☎'], ['#b18cff', '✦'], ['#53e0b0', '◈'], ['#9aa4b2', '⚙'],
    ];
    icons.forEach(([color, glyph], i) => {
      const col = i % 4, row = (i / 4) | 0;
      const x = 18 + col * 58, y = 100 + row * 74;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.roundRect(x, y, 46, 46, 12);
      ctx.fill();
      ctx.fillStyle = color as string;
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText(glyph as string, x + 15, y + 31);
    });
    // карточка задания
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(14, 262, 228, 96, 16);
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('АКТИВНОЕ ЗАДАНИЕ', 28, 288);
    ctx.fillStyle = '#e9f2ff';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText('Прилёт · Саут-Бич', 28, 314);
    ctx.fillStyle = 'rgba(233,242,255,0.62)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Дойти до закусочной «Орион»', 28, 338);
    // док-бар
    ctx.fillStyle = 'rgba(8,14,24,0.8)';
    ctx.beginPath();
    ctx.roundRect(20, 444, 216, 44, 18);
    ctx.fill();
    ['#ff6b6b', '#43d9a3', '#ffd166', '#7fb8ff'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(34 + i * 52, 456, 26, 20, 7);
      ctx.fill();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private build() {
    const shell = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.32, metalness: 0.62 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.011), shell);
    body.castShadow = false;
    this.group.add(body);

    // экранная панель чуть впереди корпуса
    this.screenMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220, emissive: 0xffffff, emissiveIntensity: 1.15,
      emissiveMap: this.makeScreenTexture(), map: null,
      roughness: 0.18, metalness: 0.0, toneMapped: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, H * 0.9), this.screenMat);
    screen.position.z = D / 2 + 0.0015;
    this.screen = screen;
    this.group.add(screen);

    // рамка камеры и кнопка
    const trim = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.4, metalness: 0.8 });
    const cam = new THREE.Mesh(new THREE.CircleGeometry(0.0042, 12), trim);
    cam.position.set(0, H / 2 - 0.014, D / 2 + 0.0012);
    this.group.add(cam);
    const btn = new THREE.Mesh(new RoundedBoxGeometry(0.0035, 0.018, 0.0035, 1, 0.001), trim);
    btn.position.set(W / 2 + 0.0012, 0.02, 0);
    this.group.add(btn);

    // свет от экрана: ночью видно, что человек смотрит в телефон
    this.glow = new THREE.PointLight(0x8fd8ff, 0, 1.6, 2);
    this.glow.position.set(0, 0, 0.05);
    this.group.add(this.glow);
  }

  /** Быстрый «толчок» экрана при действии в интерфейсе. */
  tap() { this.time = Math.max(this.time, 0); this.pulse = 1; }
  private pulse = 0;

  update(dt: number, opts: {
    open: boolean;
    camera: THREE.Camera;
    hand: THREE.Object3D | null;
    yaw: number;
    firstPerson: boolean;
    night: number;
  }) {
    this.pulse = Math.max(0, this.pulse - dt * 4);
    const target = opts.open ? 1 : 0;
    this.anim += (target - this.anim) * (1 - Math.exp(-dt * 9));
    const visible = this.anim > 0.02;
    this.group.visible = visible;
    if (!visible) {
      this.glow.intensity = 0;
      return;
    }
    const a = this.anim;
    // наклон и подъём из-за пояса
    const tilt = (1 - a) * 0.9;
    if (opts.firstPerson) {
      const cam = opts.camera;
      const q = cam.quaternion;
      this.group.quaternion.copy(q);
      this.group.rotateY(-0.34);
      this.group.rotateX(-0.12 + tilt * 0.5);
      this.group.rotateZ(0.16);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      this.group.position.copy(cam.position)
        .addScaledVector(right, 0.165)
        .addScaledVector(up, -0.155 - (1 - a) * 0.34)
        .addScaledVector(fwd, 0.36);
    } else if (opts.hand) {
      // в третьем лице аппарат в правой руке персонажа
      const wp = opts.hand.localToWorld(new THREE.Vector3(0, -0.3, 0.02));
      this.group.position.copy(wp);
      this.group.position.y += 0.02 + a * 0.05;
      this.group.rotation.set(-1.15 - (1 - a) * 0.5, opts.yaw + Math.PI, 0.2, 'YXZ');
    }
    // экран светится ярче в темноте, плюс лёгкое мерцание
    const flicker = 1 - Math.abs(Math.sin(this.time * 7.3)) * 0.03;
    this.time += dt;
    this.screenMat.emissiveIntensity = (1.0 + this.pulse * 0.7) * flicker;
    this.screen.rotation.z = Math.sin(this.time * 1.1) * 0.004;
    this.glow.intensity = (0.06 + 0.34 * opts.night) * a;
  }
}
