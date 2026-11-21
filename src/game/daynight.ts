import * as THREE from 'three';

/**
 * Небо, свет и атмосфера Майами.
 *
 * Купол рисует полностью процедурное небо: тропический полдень, розово-оранжевый
 * закат с облаками, подсвеченными снизу, фиолетовую ночь со звёздами, лунной
 * дорожкой и световым куполом города у горизонта. PMREM-окружение
 * пересобирается по этому же шейдеру, поэтому все PBR-материалы получают
 * правильные отражения — бесплатно и без внешних HDR.
 */
export class DayNight {
  sun = new THREE.DirectionalLight(0xffe4bc, 2.6);
  moon = new THREE.DirectionalLight(0x9fb6cf, 0.2);
  hemi = new THREE.HemisphereLight(0xa9c2d2, 0x797365, 1.15);
  ambient = new THREE.AmbientLight(0xb7c4ce, 0.14);
  skyMesh: THREE.Mesh;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  sunColor = new THREE.Color(0xfff4df);
  time = 16.8;
  daySpeed = 24 / 1800;
  night = 0;
  dayFactor = 1;
  cloudTime = 0;
  cloudCover = 0.37;
  sunOcclusion = 0;
  /** Смещение облачной карты в мировых координатах — облака реально плывут. */
  cloudOffset = new THREE.Vector2(0, 0);
  private wind = new THREE.Vector2(2.4, 0.85);
  private cloudMesh: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  private lastCloudX = 1e9;
  private lastCloudZ = 1e9;
  fogBase = 0.0016;
  private noise(px: number, pz: number) {
    const h = Math.sin(px * 127.1 + pz * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }
  private fbm2(x: number, z: number) {
    let n = 0, a = 0.5, px = x, pz = z;
    for (let i = 0; i < 4; i++) {
      const xi = Math.floor(px), zi = Math.floor(pz), fx = px - xi, fz = pz - zi;
      const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
      const n00 = this.noise(xi, zi), n10 = this.noise(xi + 1, zi), n01 = this.noise(xi, zi + 1), n11 = this.noise(xi + 1, zi + 1);
      n += a * ((n00 * (1 - ux) + n10 * ux) * (1 - uz) + (n01 * (1 - ux) + n11 * ux) * uz);
      px = px * 2.03 + 17.3; pz = pz * 2.03 + 17.3; a *= 0.5;
    }
    return n;
  }
  /**
   * Плотность облаков над конкретной точкой мира. Это и есть «тень облака»:
   * если облако накрыло игрока — солнце гаснет, а под ним темнеет улица.
   */
  cloudAt(x: number, z: number) {
    const n = this.fbm2(x * 0.0135 + this.cloudOffset.x, z * 0.0135 + this.cloudOffset.y);
    const edge = 0.62 - this.cloudCover * 0.3;
    return Math.max(0, Math.min(1, (n - edge) / 0.26));
  }

  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private mat: THREE.ShaderMaterial;
  private envMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: 0.5, far: 190, left: -46, right: 46, top: 46, bottom: -46 });
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.022;
    this.sun.shadow.radius = 2;
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi, this.ambient);

    const uniforms = {
      sunDir: { value: new THREE.Vector3(1, 1, 0) },
      night: { value: 0 },
      time: { value: 0 },
      cover: { value: 0.37 },
      occl: { value: 0 },
      cityGlow: { value: 0 },
      camXZ: { value: new THREE.Vector2() },
      cloudOff: { value: new THREE.Vector2() },
      oct: { value: 5 },
    };

    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: SKY_FS,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(880, 32, 20), this.mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    scene.add(this.skyMesh);

    // Пятна облачных теней на земле: один квад, следует за игроком,
    // рисует ту же облачную карту, что и небо. Дёшево даже на слабых GPU.
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.FrontSide,
      uniforms: {
        uOffset: { value: new THREE.Vector2() },
        uCover: { value: this.cloudCover },
        uStrength: { value: 1 },
        uDay: { value: 1 },
        uCam: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: CLOUD_FS,
    });
    const cloudGeo = new THREE.PlaneGeometry(560, 560);
    cloudGeo.rotateX(-Math.PI / 2);
    this.cloudMesh = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.cloudMesh.position.y = 0.075;
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.renderOrder = 2;
    scene.add(this.cloudMesh);

    this.envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        sunDir: uniforms.sunDir, night: uniforms.night, time: uniforms.time, cover: uniforms.cover,
        occl: uniforms.occl, cityGlow: uniforms.cityGlow, camXZ: uniforms.camXZ, cloudOff: uniforms.cloudOff, oct: uniforms.oct,
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: SKY_FS,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 20, 14), this.envMat));
  }

  get clock() {
    return `${String(Math.floor(this.time)).padStart(2, '0')}:${String(Math.floor(this.time % 1 * 60)).padStart(2, '0')}`;
  }

  setTime(t: number) { this.time = (t % 24 + 24) % 24; this.envTimer = 0; }

  setQuality(o: { shadowMapSize: number; shadowRadius: number; shadows: boolean; skyOctaves?: number }) {
    this.mat.uniforms.oct.value = o.skyOctaves ?? 5;
    this.sun.castShadow = o.shadows;
    this.sun.shadow.mapSize.set(o.shadowMapSize, o.shadowMapSize);
    this.sun.shadow.radius = o.shadowRadius;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  update(dt: number, focus: THREE.Vector3, scene: THREE.Scene) {
    this.time = (this.time + dt * this.daySpeed) % 24;
    this.cloudTime += dt;
    const angle = (this.time - 6) / 24 * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), -0.28).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.dayFactor = THREE.MathUtils.smoothstep(this.sunDir.y, -0.14, 0.16);
    this.night = 1 - this.dayFactor;
    const warmth = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.02, 0.55);
    // облачность реально притеняет солнце — тени мягко гаснут
    const uvx = this.sunDir.x / (Math.max(0.08, this.sunDir.y) + 0.22) * 1.1 + this.cloudTime * 0.0015;
    const uvz = this.sunDir.z / (Math.max(0.08, this.sunDir.y) + 0.22) * 1.1 + this.cloudTime * 0.0005;
    const density = Math.max(0, Math.min(1, (this.fbm2(uvx * 2.2, uvz * 2.2) - (0.6 - this.cloudCover * 0.22)) / 0.22));
    const targetOccl = Math.min(1, this.cloudCover) * (0.42 + density * 0.58) * Math.max(0, Math.min(1, this.sunDir.y * 3 + 0.22)) * (0.55 + this.cloudCover * 0.45);
    this.sunOcclusion += (targetOccl - this.sunOcclusion) * Math.min(1, dt * 1.05);

    // Облака плывут в мировых координатах: небо и тени на земле живут в одной
    // системе, поэтому тень приходит ровно тогда, когда туча закрыла солнце.
    this.cloudOffset.x += this.wind.x * dt * 0.0125;
    this.cloudOffset.y += this.wind.y * dt * 0.0125;
    const here = this.cloudAt(focus.x, focus.z);
    this.sunColor.copy(new THREE.Color(0xfff6e6).lerp(new THREE.Color(0xffab6a), warmth * 0.78));
    this.sun.color.copy(this.sunColor);
    const occl = this.sunOcclusion;
    // Прямое солнце гасит именно то облако, что висит над игроком
    const localOccl = Math.max(occl * 0.35, here);
    this.sun.intensity = 2.9 * this.dayFactor * (1 - localOccl * 0.86);
    this.sun.visible = this.dayFactor > 0.012;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 90);
    this.sun.target.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(this.moonDir, 90);
    this.moon.target.position.copy(focus);
    this.moon.intensity = this.night * 0.55;
    this.moon.visible = this.night > 0.035;
    this.hemi.intensity = (0.46 + this.dayFactor * 1.15) * (1 - localOccl * 0.3);
    this.hemi.color.setHex(0x9fc4d8).lerp(new THREE.Color(0x6b7fa8), this.night);
    this.hemi.groundColor.setHex(0x8a8172).lerp(new THREE.Color(0x232a33), this.night);
    this.ambient.intensity = (0.1 + this.dayFactor * 0.12) * (1 - localOccl * 0.2);
    this.skyMesh.position.copy(focus);
    // пятна тени двигаются шагом 8 м — карта мира не «плывёт» под ногами
    const cw = this.cloudMat.uniforms;
    cw.uOffset.value.copy(this.cloudOffset);
    cw.uCover.value = this.cloudCover;
    cw.uDay.value = this.dayFactor;
    cw.uCam.value.set(focus.x, focus.z);
    const snapX = Math.round(focus.x / 8) * 8;
    const snapZ = Math.round(focus.z / 8) * 8;
    if (snapX !== this.lastCloudX || snapZ !== this.lastCloudZ) {
      this.lastCloudX = snapX; this.lastCloudZ = snapZ;
      this.cloudMesh.position.set(snapX, 0.075, snapZ);
    }
    this.mat.uniforms.sunDir.value.copy(this.sunDir);
    this.mat.uniforms.night.value = this.night;
    this.mat.uniforms.time.value = this.cloudTime;
    this.mat.uniforms.cover.value = this.cloudCover;
    this.mat.uniforms.occl.value = Math.min(1, occl * 0.55 + here * 0.75);
    this.mat.uniforms.camXZ.value.set(focus.x, focus.z);
    this.mat.uniforms.cloudOff.value.copy(this.cloudOffset);
    this.mat.uniforms.cityGlow.value = this.night;
    const fog = scene.fog as THREE.FogExp2;
    if (fog) {
      // горизонт теплеет на закате и зеленеет в тропический день
      const dusk = (1 - THREE.MathUtils.smoothstep(Math.abs(this.sunDir.y), 0.0, 0.34)) * (1 - this.night * 0.8);
      fog.color.setHex(0x9fc3c8)
        .lerp(new THREE.Color(0xe8a884), dusk * 0.55)
        .lerp(new THREE.Color(0x141c26), this.night);
      fog.color.multiplyScalar(1 - occl * 0.14);
      // плотность тумана задаёт игровой бюджет качества
      fog.density = this.fogBase + this.night * 0.0009;
    }
    scene.environmentIntensity = 0.72 - this.night * 0.2;
    this.envTimer -= dt;
    if (this.envTimer <= 0) { this.envTimer = 22; this.updateEnv(scene); }
  }

  updateEnv(scene: THREE.Scene) {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 100, { size: 64 });
    scene.environment = this.envRT.texture;
    old?.dispose();
  }

  dispose() {
    this.envRT?.dispose(); this.pmrem.dispose();
    this.skyMesh.geometry.dispose(); this.mat.dispose(); this.envMat.dispose();
    this.cloudMesh.geometry.dispose(); this.cloudMat.dispose();
  }
}

const CLOUD_FS = /* glsl */`
precision mediump float;
varying vec3 vWorld;
uniform vec2 uOffset, uCam;
uniform float uCover, uStrength, uDay;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 p) {
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { n += noise(p) * a; p = p * 2.07 + 13.1; a *= 0.5; }
  return n;
}

void main() {
  vec2 p = vWorld.xz * 0.0135 + uOffset;
  float d = fbm(p);
  float edge = 0.62 - uCover * 0.3;
  float dens = clamp((d - edge) / 0.26, 0.0, 1.0);
  // мягкий ворс по краю, чтобы пятно не выглядело наклейкой
  dens = smoothstep(0.05, 0.75, dens);
  // к центру пятна — глубже тень; рассеянный свет всё равно пробивается
  float falloff = 1.0 - smoothstep(210.0, 265.0, length(vWorld.xz - uCam));
  float a = dens * falloff * uStrength * (0.10 + 0.34 * uDay);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.03, 0.05, 0.08, a);
  #include <colorspace_fragment>
}
`;

const SKY_FS = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform float night, time, cover, occl, cityGlow, oct;
uniform vec2 camXZ, cloudOff;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 p) {
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= oct) break;
    n += noise(p) * a; p = p * 2.03 + 17.3; a *= 0.5;
  }
  return n;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 sun = normalize(sunDir);
  float h = max(0.0, d.y);
  float dusk = (1.0 - smoothstep(0.0, 0.36, abs(sun.y))) * (1.0 - night * 0.86);
  float golden = (1.0 - smoothstep(0.0, 0.16, abs(sun.y))) * (1.0 - night);

  // тропическая палитра: туркиз у горизонта, глубокая лазурь в зените
  vec3 horizon = mix(vec3(0.58, 0.78, 0.84), vec3(1.16, 0.62, 0.32), dusk);
  vec3 mid = mix(vec3(0.26, 0.55, 0.80), vec3(0.70, 0.38, 0.42), dusk * 0.85);
  vec3 zenith = mix(vec3(0.055, 0.24, 0.58), vec3(0.16, 0.12, 0.33), dusk);
  vec3 sky = mix(horizon, mid, pow(h, 0.34));
  sky = mix(sky, zenith, pow(h, 1.15));
  // ночь: чернильно-синяя с фиолетовым подтоном
  vec3 nightSky = mix(vec3(0.020, 0.030, 0.060), vec3(0.006, 0.010, 0.026), pow(h, 0.55));
  sky = mix(sky, nightSky, night);

  // солнечный диск, гало и горизонтальная дымка
  float sd = max(dot(d, sun), 0.0);
  vec3 sunlight = mix(vec3(1.0, 0.92, 0.74), vec3(1.0, 0.46, 0.16), dusk);
  sky += sunlight * pow(sd, 8.0) * 0.14 * (1.0 - night) * (1.0 - occl * 0.9);
  sky += sunlight * pow(sd, 160.0) * 0.55 * (1.0 - night) * (1.0 - occl * 0.95);
  sky += sunlight * smoothstep(0.99962, 0.99992, sd) * 6.5 * (1.0 - night) * (1.0 - occl * 0.95);
  sky += sunlight * pow(1.0 - h, 9.0) * golden * 0.28;

  // луна и звёзды
  float md = max(dot(d, -sun), 0.0);
  float moonDisc = smoothstep(0.99972, 0.99992, md);
  sky += vec3(0.82, 0.88, 1.0) * (moonDisc * 2.6 + pow(md, 90.0) * 0.06) * night;

  if (d.y > 0.015) {
    // Облака считаются в мировых координатах того же слоя, что и тени на
    // земле. Поэтому туча, которую видно над головой, затемняет именно тебя.
    float H = 190.0;
    vec2 wp = camXZ + d.xz / max(0.10, d.y) * H;
    vec2 cp = wp * 0.0135 + cloudOff;
    float f1 = fbm(cp);
    float f2 = fbm(cp * 2.3 + 11.7);
    float f3 = fbm(cp * 5.1 - 4.3);
    float density = smoothstep(0.60 - cover * 0.30, 0.86 - cover * 0.24, f1 * 0.62 + f2 * 0.28 + f3 * 0.10);
    float dist = length(d.xz / max(0.10, d.y) * H);
    density *= smoothstep(0.01, 0.16, d.y);
    // дальние облака уходят в дымку горизонта
    density *= 1.0 - smoothstep(240.0, 520.0, dist) * 0.75;
    density *= (1.0 - smoothstep(0.72, 1.0, h) * 0.4);
    float shade = fbm(cp * 2.0 + 5.9);
    vec3 cloudLit = mix(vec3(0.52, 0.58, 0.66), vec3(1.10, 1.03, 0.94), 0.35 + shade * 0.8);
    cloudLit = mix(cloudLit, vec3(1.18, 0.66, 0.42), dusk * 0.8);
    cloudLit = mix(cloudLit, vec3(0.20, 0.22, 0.30), occl * 0.55);
    cloudLit = mix(cloudLit, vec3(0.045, 0.055, 0.085), night * 0.92);
    // подсветка краёв облака со стороны солнца
    float rim = pow(max(dot(normalize(d + sun * 0.35), sun), 0.0), 3.0);
    cloudLit += sunlight * rim * 0.35 * (1.0 - night);
    sky = mix(sky, cloudLit, density * 0.92);

    // звездопад-звёзды
    vec2 sp = floor(d.xz / (d.y + 0.45) * 620.0);
    float star = step(0.9988, hash(sp));
    float twinkle = 0.55 + 0.45 * sin(time * 2.0 + hash(sp + 3.1) * 40.0);
    sky += vec3(0.68, 0.76, 1.0) * star * twinkle * night * (1.0 - density) * smoothstep(0.08, 0.42, h) * 1.7;
  }

  // световой купол города у горизонта ночью
  float glow = smoothstep(0.0, 0.24, d.y) * (1.0 - smoothstep(0.14, 0.5, d.y));
  sky += vec3(1.0, 0.55, 0.30) * glow * night * 0.10 * (0.6 + 0.4 * fbm(vec2(atan(d.z, d.x) * 2.4, 1.7)));

  if (d.y < 0.0) sky = mix(sky, mix(vec3(0.16, 0.20, 0.22), vec3(0.04, 0.06, 0.09), night), smoothstep(0.0, 0.55, -d.y));

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
