import * as THREE from 'three';

/**
 * Океан, пляж и береговая линия Майами.
 *
 * Вода — полностью кастомный шейдер: волны Герстнера в вершинах, аналитические
 * нормали в фрагменте, френель, отражение неба, солнечные блики, прибойная пена,
 * подводное свечение и каустика у берега. Геометрия следует за игроком и
 * привязана к мировой сетке, поэтому волны не «плывут» при движении камеры.
 */

export const BEACH_START = 531;
export const PROMENADE_END = 520;
export const OCEAN_DRIVE = 487;
export const SHORE_BASE = 600;

/** Кривая береговой линии: Майами-Бич с мысами и бухтами, а не прямая стена. */
export function shoreX(z: number) {
  return SHORE_BASE
    + 34 * Math.sin(z / 232 + 0.4)
    + 18 * Math.sin(z / 103 + 1.3)
    + 8 * Math.sin(z / 47 + 2.1)
    + 4 * Math.sin(z / 23 + 0.9);
}

export const ISLAND = { x: 812, z: -58, rx: 96, rz: 62 };
export const CAUSEWAY_Z = -40;

export function islandDistance(x: number, z: number) {
  const nx = (x - ISLAND.x) / ISLAND.rx;
  const nz = (z - ISLAND.z) / ISLAND.rz;
  return Math.hypot(nx, nz);
}

/** Профиль песка: одна и та же функция для меша и для физики поверхности. */
export function beachHeight(x: number, z: number) {
  const shore = shoreX(z);
  const d = shore - x;
  if (d < 0) return -0.25 - Math.min(2.4, -d * 0.09);
  const slope = Math.min(1, d / 34);
  let y = 0.04 + slope * 0.44;
  y += Math.max(0, 0.45 - d * 0.014) * 0.42;
  y += 0.12 * Math.sin(x * 0.12 + z * 0.07) * Math.min(1, d / 20);
  return y;
}

/** Насколько глубоко вода (0 у кромки, 1 в открытом море). */
export function depthAt(x: number, z: number) {
  const d = Math.max(x - shoreX(z), 0);
  let depth = Math.min(1, d / 220);
  const isl = islandDistance(x, z);
  if (isl < 1.28) depth = Math.min(depth, Math.max(0, (isl - 0.86) / 0.42) * 0.42);
  return depth;
}

export const isWater = (x: number, z: number) => x > shoreX(z) - 1.6 && islandDistance(x, z) > 1.02;

const WATER_VS = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uCenter;
uniform float uChop;
uniform vec2 uIsland;
varying vec3 vWorld;
varying float vHeight;
varying float vShore;

float shoreLine(float z) {
  return 600.0 + 34.0 * sin(z / 232.0 + 0.4) + 18.0 * sin(z / 103.0 + 1.3)
       + 8.0 * sin(z / 47.0 + 2.1) + 4.0 * sin(z / 23.0 + 0.9);
}

float waveH(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.92, 0.38)) * 0.052 + t * 0.55) * 0.62;
  h += sin(dot(p, vec2(-0.42, 0.91)) * 0.091 + t * 0.86) * 0.30;
  h += sin(dot(p, vec2(0.63, -0.78)) * 0.206 + t * 1.32) * 0.115;
  h += sin(dot(p, vec2(-0.95, -0.30)) * 0.452 + t * 2.05) * 0.045;
  return h;
}

void main() {
  vec3 world = position + uCenter;
  float shore = world.x - shoreLine(world.z);
  vec2 isl = vec2((world.x - uIsland.x) / 96.0, (world.z - uIsland.y) / 62.0);
  float islD = length(isl);
  float islandShore = (islD - 1.02) * 96.0;
  float sd = min(shore, islandShore);

  // маска глубины: у берега волны затухают, в открытом море — полные
  float open = smoothstep(6.0, 120.0, sd);
  float amp = mix(0.16, 1.0, open) * (1.0 + uChop * 0.75);
  float h = waveH(world.xz, uTime) * amp;
  // накат: гребень поднимается у самой кромки
  h += smoothstep(70.0, 4.0, sd) * (0.42 + 0.2 * sin(uTime * 1.9 + world.z * 0.05)) * (1.0 - smoothstep(4.0, 0.0, sd) * 0.7);

  world.y += h;
  vWorld = world;
  vHeight = h;
  vShore = sd;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const WATER_FS = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec4 uFog;        // x: density
uniform float uNight;
uniform float uChop;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec2 uIsland;
uniform float uDetail;
varying vec3 vWorld;
varying float vHeight;
varying float vShore;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { n += vnoise(p) * a; p = p * 2.03 + 11.7; a *= 0.5; }
  return n;
}

// Аналитическое небо — то же, что рисует купол, чтобы отражение совпадало.
vec3 skyTone(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  float dusk = (1.0 - smoothstep(0.0, 0.38, abs(uSunDir.y))) * (1.0 - uNight * 0.85);
  vec3 horizon = mix(vec3(0.60, 0.75, 0.84), vec3(1.05, 0.55, 0.28), dusk);
  vec3 zenith = mix(vec3(0.11, 0.33, 0.63), vec3(0.26, 0.16, 0.36), dusk);
  vec3 col = mix(horizon, zenith, pow(h, 0.44));
  col = mix(col, vec3(0.012, 0.022, 0.048), uNight * 0.94);
  float sd = max(dot(normalize(d), normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 320.0) * 14.0 * (1.0 - uNight * 0.8);
  col += uSunColor * pow(sd, 12.0) * 0.16 * (1.0 - uNight * 0.6);
  return col;
}

float waveCombo(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.92, 0.38)) * 0.052 + t * 0.55) * 0.62;
  h += sin(dot(p, vec2(-0.42, 0.91)) * 0.091 + t * 0.86) * 0.30;
  h += sin(dot(p, vec2(0.63, -0.78)) * 0.206 + t * 1.32) * 0.115;
  h += sin(dot(p, vec2(-0.95, -0.30)) * 0.452 + t * 2.05) * 0.045;
  return h;
}

float shoreLine(float z) {
  return 600.0 + 34.0 * sin(z / 232.0 + 0.4) + 18.0 * sin(z / 103.0 + 1.3)
       + 8.0 * sin(z / 47.0 + 2.1) + 4.0 * sin(z / 23.0 + 0.9);
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  // точная линия прибоя считается во фрагменте: кромка воды гладкая при любой сетке
  float shore = vWorld.x - shoreLine(vWorld.z);
  float islD = length(vec2((vWorld.x - uIsland.x) / 96.0, (vWorld.z - uIsland.y) / 62.0));
  float islandShore = (islD - 1.02) * 96.0;
  float sd = min(shore, islandShore);
  if (sd < -0.7) discard;

  // ---- нормаль: сумма производных волн + мелкая рябь ----
  vec2 grad = vec2(0.0);
  vec2 dirs[4]; float freq[4]; float amp[4]; float spd[4];
  dirs[0] = vec2(0.92, 0.38); freq[0] = 0.052; amp[0] = 0.62; spd[0] = 0.55;
  dirs[1] = vec2(-0.42, 0.91); freq[1] = 0.091; amp[1] = 0.30; spd[1] = 0.86;
  dirs[2] = vec2(0.63, -0.78); freq[2] = 0.206; amp[2] = 0.115; spd[2] = 1.32;
  dirs[3] = vec2(-0.95, -0.30); freq[3] = 0.452; amp[3] = 0.045; spd[3] = 2.05;
  float open = smoothstep(6.0, 120.0, sd);
  float ampScale = mix(0.16, 1.0, open) * (1.0 + uChop * 0.75);
  for (int i = 0; i < 4; i++) {
    float ph = dot(p, dirs[i]) * freq[i] + t * spd[i];
    grad += dirs[i] * cos(ph) * amp[i] * freq[i] * ampScale;
  }
  if (uDetail > 1.5) {
    float e = 0.55;
    vec2 q = p * 0.62 + vec2(t * 0.19, t * 0.11);
    float n1 = fbm(q);
    float n2 = fbm(q + vec2(e, 0.0));
    float n3 = fbm(q + vec2(0.0, e));
    float ripple = mix(0.35, 1.0, uDetail);
    grad += vec2(n1 - n2, n1 - n3) * 0.55 * ripple;
  }
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  fres = mix(0.025, 1.0, fres);

  // ---- глубина и цвет воды ----
  float depth = clamp(sd / 190.0, 0.0, 1.0);
  vec3 water = mix(uShallow, uDeep, pow(depth, 0.62));
  // подводное рассеивание на гребнях
  water += uShallow * smoothstep(0.15, 0.95, vHeight * (1.0 - depth * 0.6)) * 0.55;
  water = mix(water, uShallow * 1.25, smoothstep(26.0, 2.0, sd) * 0.55);

  // ---- отражение неба ----
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyTone(R);
  vec3 col = mix(water, refl, clamp(fres * (0.86 + 0.14 * uDetail), 0.0, 0.97));

  // ---- солнечный блик ----
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(180.0, 620.0, uDetail));
  float glitter = 1.0;
  if (uDetail > 0.5) glitter = smoothstep(0.35, 0.95, fbm(p * 3.1 + t * 0.6));
  col += uSunColor * spec * (2.6 + 2.2 * uDetail) * glitter * (1.0 - uNight * 0.86);
  // лунная дорожка
  vec3 moonDir = normalize(-uSunDir);
  float moonSpec = pow(max(dot(N, normalize(moonDir + V)), 0.0), 220.0);
  col += vec3(0.55, 0.68, 0.92) * moonSpec * 1.4 * uNight;

  // ---- пена: прибой, барашки, кайма у берега ----
  float bandPhase = sd * 0.32 - t * 1.45 + sin(p.y * 0.03) * 1.5;
  float bands = smoothstep(0.45, 0.98, sin(bandPhase) * 0.5 + 0.5);
  bands *= smoothstep(120.0, 3.0, sd) * smoothstep(0.5, 6.0, sd);
  float edge = 1.0 - smoothstep(0.0, 7.0, sd);
  float islEdge = 1.0 - smoothstep(0.0, 6.0, islandShore);
  float breakup = fbm(p * 0.55 + vec2(t * 0.35, -t * 0.22));
  float crest = smoothstep(0.72, 1.02, vHeight) * smoothstep(30.0, 120.0, sd);
  float foam = bands * 0.85 + edge * 1.25 + islEdge * 1.1 + crest * (0.5 + breakup * 0.8);
  foam *= mix(0.55, 1.0, smoothstep(0.15, 0.75, breakup));
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamCol = mix(vec3(0.86, 0.93, 0.95), uSunColor * 0.9, 0.22) * (1.0 - uNight * 0.62);
  col = mix(col, foamCol, foam * 0.9);

  // каустика на мели
  if (sd < 60.0 && uDetail > 1.5) {
    float c = fbm(p * 1.4 + vec2(t * 0.5, -t * 0.43));
    col += vec3(0.35, 0.6, 0.58) * smoothstep(0.62, 0.95, c) * smoothstep(60.0, 0.0, sd) * 0.22;
  }

  // ---- туман ----
  float dist = length(cameraPosition - vWorld);
  float fogF = 1.0 - exp(-uFog.x * uFog.x * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SAND_FS = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogDensity;
uniform float uNight;
varying vec3 vWorld;
varying float vShore;
varying float vWet;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { n += vnoise(p) * a; p = p * 2.03 + 7.3; a *= 0.5; }
  return n;
}

void main() {
  vec2 p = vWorld.xz;
  float grain = fbm(p * 2.6);
  float coarse = fbm(p * 0.32 + 4.0);
  vec3 dry = mix(vec3(0.78, 0.70, 0.55), vec3(0.90, 0.83, 0.68), coarse);
  dry *= 0.9 + grain * 0.22;
  vec3 wet = dry * 0.56 + vec3(0.02, 0.05, 0.06);
  // полоса наката: мокрый песок + пена, которая набегает и уходит
  float wave = sin(vShore * 0.16 - uTime * 1.35) * 0.5 + 0.5;
  float wetBand = smoothstep(0.0, 1.0, vWet) * (0.7 + 0.3 * wave);
  vec3 col = mix(dry, wet, clamp(wetBand, 0.0, 1.0));
  col = mix(col, dry * 1.08, smoothstep(14.0, 34.0, vShore) * 0.6);

  float foamPattern = fbm(p * 0.9 + vec2(uTime * 0.25, -uTime * 0.19));
  float foam = smoothstep(0.62, 0.94, foamPattern) * smoothstep(9.0, 0.0, vShore) * smoothstep(0.0, 1.4, vShore + 0.6);
  foam += smoothstep(0.55, 0.95, fbm(p * 0.55 - uTime * 0.12)) * smoothstep(4.0, 0.0, vShore);
  col = mix(col, vec3(0.92, 0.95, 0.95), clamp(foam, 0.0, 1.0) * 0.85 * (1.0 - uNight * 0.5));

  // мягкий свет: песок почти ламбертов, но с бликом на мокром
  float diff = clamp(dot(normalize(vec3(0.0, 1.0, 0.0)), normalize(uSunDir)), 0.0, 1.0);
  col *= (0.36 + diff * 0.9) * (1.0 - uNight * 0.72);
  col += uSunColor * 0.06 * (1.0 - uNight);
  col += vec3(0.05, 0.09, 0.12) * uNight;

  float dist = length(cameraPosition - vWorld);
  float fogF = 1.0 - exp(-uFogDensity.x * uFogDensity.x * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface OceanContext {
  time: number;
  night: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  chop: number;
  detail: number;
}

export class Ocean {
  /** Аналитическая линия берега — та же формула, что и в шейдере. */
  shoreAt(z: number) { return shoreX(z); }

  water: THREE.Mesh;
  backdrop: THREE.Mesh;
  sand: THREE.Mesh;
  foam: THREE.Mesh | null = null;
  private waterMat: THREE.ShaderMaterial;
  private sandMat: THREE.ShaderMaterial;
  private backdropMat: THREE.MeshBasicMaterial;
  private group = new THREE.Group();
  private center = new THREE.Vector3();
  private sandGeo: THREE.BufferGeometry;
  private sandVerts: number[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, segments: number, _detail: 0 | 1 | 2) {
    scene.add(this.group);

    // --- песчаный пляж: полоса от променада до кромки воды ---
    this.sandGeo = this.buildSand();
    this.sandMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff0d6) },
        uFogColor: { value: new THREE.Color(0xb9c9cc) },
        uFogDensity: { value: new THREE.Vector3(0.0016, 0, 0) },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        varying float vShore;
        varying float vWet;
        attribute float aShore;
        attribute float aWet;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vShore = aShore;
          vWet = aWet;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: SAND_FS,
    });
    this.sand = new THREE.Mesh(this.sandGeo, this.sandMat);
    this.sand.frustumCulled = false;
    this.sand.renderOrder = 1;
    this.group.add(this.sand);

    // --- вода ---
    const size = 2600;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2) },
        uSunColor: { value: new THREE.Color(0xffe9c4) },
        uFogColor: { value: new THREE.Color(0xb9c9cc) },
        uFog: { value: new THREE.Vector4(0.0016, 0, 0, 0) },
        uNight: { value: 0 },
        uChop: { value: 0 },
        uDeep: { value: new THREE.Color(0x05344f) },
        uShallow: { value: new THREE.Color(0x2ba9a1) },
        uIsland: { value: new THREE.Vector2(ISLAND.x, ISLAND.z) },
        uDetail: { value: _detail },
      },
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      transparent: false,
      depthWrite: true,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.frustumCulled = false;
    this.water.renderOrder = 2;
    this.group.add(this.water);

    // --- бесконечное море за туманом ---
    const bgeo = new THREE.PlaneGeometry(9000, 9000);
    bgeo.rotateX(-Math.PI / 2);
    this.backdropMat = new THREE.MeshBasicMaterial({ color: 0x123c4d, fog: true });
    this.backdrop = new THREE.Mesh(bgeo, this.backdropMat);
    this.backdrop.position.y = -7;
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = 0;
    this.group.add(this.backdrop);

    // --- прибойная кайма на песке ---
    const foamGeo = this.buildFoamStrip();
    const foamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying float vShore;
        attribute float aShore;
        void main() { vUv = uv; vShore = aShore; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime, uNight;
        varying vec2 vUv; varying float vShore;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+1.),f.x), f.y); }
        void main() {
          float t = uTime;
          float band = sin(vShore * 0.55 - t * 1.8) * 0.5 + 0.5;
          float f = n(vec2(vUv.x * 26.0, vUv.y * 5.0 + t * 0.4)) * 0.6 + n(vec2(vUv.x * 70.0, vUv.y * 9.0 - t * 0.7)) * 0.4;
          float alpha = smoothstep(0.35, 0.85, band * 0.7 + f * 0.6) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          gl_FragColor = vec4(mix(vec3(0.93, 0.97, 0.98), vec3(0.7, 0.8, 0.85), uNight), alpha * 0.55);
        }`,
    });
    this.foam = new THREE.Mesh(foamGeo, foamMat);
    this.foam.frustumCulled = false;
    this.foam.renderOrder = 3;
    this.group.add(this.foam);
  }

  private buildSand() {
    const zMin = -1500, zMax = 1500, dz = 8;
    const cols = 10;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [], shores: number[] = [], wets: number[] = [];
    const rows = Math.round((zMax - zMin) / dz) + 1;
    for (let r = 0; r < rows; r++) {
      const z = zMin + r * dz;
      const shore = shoreX(z);
      const start = BEACH_START - 6;
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1);
        const x = start + (shore - start + 3) * Math.pow(t, 1.15);
        const d = shore - x;
        positions.push(x, beachHeight(x, z), z);
        uvs.push(x / 22, z / 22);
        shores.push(d);
        wets.push(THREE.MathUtils.clamp(1 - d / 16, 0, 1));
      }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shores, 1));
    geo.setAttribute('aWet', new THREE.Float32BufferAttribute(wets, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private buildFoamStrip() {
    const zMin = -900, zMax = 900, dz = 6;
    const cols = 3;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [], shores: number[] = [];
    const rows = Math.round((zMax - zMin) / dz) + 1;
    for (let r = 0; r < rows; r++) {
      const z = zMin + r * dz;
      const shore = shoreX(z);
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1);
        const d = -2 + t * 16; // от воды вглубь пляжа
        const x = shore - d;
        const y = d < 0 ? -0.1 : 0.02 + Math.max(0, 0.22 - d * 0.012);
        positions.push(x, y, z);
        uvs.push(r / rows, t);
        shores.push(d);
      }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shores, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  update(dt: number, focus: THREE.Vector3, ctx: OceanContext) {
    this.time += dt;
    // привязка к мировой сетке, чтобы волны не «плавали» при движении
    const snap = 16;
    this.center.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
    this.water.position.set(this.center.x, 0, this.center.z);
    this.backdrop.position.set(this.center.x, -7, this.center.z);
    this.sand.position.set(0, 0, 0);
    this.sand.visible = Math.abs(focus.x - 540) < 900;

    const wu = this.waterMat.uniforms;
    wu.uTime.value = ctx.time;
    wu.uCenter.value.set(this.center.x, 0, this.center.z);
    wu.uSunDir.value.copy(ctx.sunDir);
    wu.uSunColor.value.copy(ctx.sunColor);
    wu.uFogColor.value.copy(ctx.fogColor);
    wu.uFog.value.x = ctx.fogDensity;
    wu.uNight.value = ctx.night;
    wu.uChop.value = ctx.chop;
    wu.uDetail.value = ctx.detail;
    // цвет воды меняется с погодой и временем: тёплый закатный, бирюзовый днём, чернильный ночью
    const dusk = 1 - THREE.MathUtils.smoothstep(Math.abs(ctx.sunDir.y), 0.0, 0.3);
    wu.uDeep.value.setHex(0x05344f).lerp(new THREE.Color(0x0b1c33), ctx.night);
    wu.uShallow.value.setHex(0x2ba9a1)
      .lerp(new THREE.Color(0x1f8f9c), ctx.night * 0.6)
      .lerp(new THREE.Color(0x2f7f86), ctx.chop * 0.45)
      .lerp(new THREE.Color(0x39b6a8), dusk * 0.35);

    const su = this.sandMat.uniforms;
    su.uTime.value = ctx.time;
    su.uSunDir.value.copy(ctx.sunDir);
    su.uSunColor.value.copy(ctx.sunColor);
    su.uFogColor.value.copy(ctx.fogColor);
    su.uFogDensity.value.x = ctx.fogDensity;
    su.uNight.value = ctx.night;
    if (this.foam) {
      const fm = this.foam.material as THREE.ShaderMaterial;
      fm.uniforms.uTime.value = ctx.time;
      fm.uniforms.uNight.value = ctx.night;
    }
    this.backdropMat.color.setHex(0x123c4d).lerp(new THREE.Color(0x061520), ctx.night).lerp(ctx.fogColor, 0.35);

    // Пляж должен перекрываться водой корректно: песок выше ватерлинии
    this.foam?.position.set(0, 0, 0);
    this.sandVerts.length = 0;
  }

  setBudget(segments: number, detail: 0 | 1 | 2) {
    const geo = this.water.geometry;
    geo.dispose();
    const size = 2600;
    const g = new THREE.PlaneGeometry(size, size, segments, segments);
    g.rotateX(-Math.PI / 2);
    this.water.geometry = g;
    this.waterMat.uniforms.uDetail.value = detail;
  }

  dispose() {
    this.sandGeo.dispose();
    this.sandMat.dispose();
    this.water.geometry.dispose();
    this.waterMat.dispose();
    this.backdrop.geometry.dispose();
    this.backdropMat.dispose();
    this.foam?.geometry.dispose();
  }
}
