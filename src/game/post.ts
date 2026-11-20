import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Финальный грейд кадра: тёплые света, холодные тени, лёгкая хроматическая
 * аберрация по краям, виньетка и зерно. Один проход, всё считается на GPU,
 * поэтому эффект почти бесплатный даже на мобильном GPU.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0018 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.045 },
    uNight: { value: 0 },
    uHurt: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uContrast, uNight, uHurt;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      // хроматическая аберрация только по краям
      vec2 off = d * uAberration * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // лёгкий шарп — картинка не «мылится» на мобильном разрешении
      vec3 blur = (
        texture2D(tDiffuse, uv + vec2(1.0 / uResolution.x, 0.0)).rgb +
        texture2D(tDiffuse, uv - vec2(1.0 / uResolution.x, 0.0)).rgb +
        texture2D(tDiffuse, uv + vec2(0.0, 1.0 / uResolution.y)).rgb +
        texture2D(tDiffuse, uv - vec2(0.0, 1.0 / uResolution.y)).rgb) * 0.25;
      col += (col - blur) * 0.24;

      // контраст и насыщенность
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // сплит-тонирование: бирюзовые тени, тёплые света (палитра Майами)
      vec3 shadowTint = mix(vec3(0.94, 1.0, 1.06), vec3(0.82, 0.88, 1.12), uNight);
      vec3 highTint = vec3(1.045, 1.01, 0.965);
      col *= mix(shadowTint, highTint, smoothstep(0.18, 0.85, luma));

      // виньетка + лёгкое покраснение при ранении
      float vig = smoothstep(0.92, 0.18, r2 * uVignette * 2.2);
      col *= mix(1.0, vig, 0.82);
      col = mix(col, vec3(0.42, 0.03, 0.02), uHurt * smoothstep(0.08, 0.62, r2));

      // зерно
      float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class GradePass extends ShaderPass {
  constructor() {
    super(GradeShader);
    this.uniforms.tDiffuse.value = null;
  }
  setSize(w: number, h: number) {
    this.uniforms.uResolution.value.set(w, h);
  }
}
