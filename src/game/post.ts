import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Финальный грейд кадра. Один проход на GPU:
 *  · радиальное размытие на скорости;
 *  · хроматическая аберрация по краям;
 *  · шарп, контраст, насыщенность, сплит-тонирование Майами;
 *  · виньетка, кровавая пелена с потёками, обесцвечивание на добивании;
 *  · тепловое дрожание, вспышка (молния/взрыв) и зерно.
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
    uBlood: { value: 0 },
    uRadial: { value: 0 },
    uFlash: { value: 0 },
    uKillCam: { value: 0 },
    uHeat: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uContrast, uNight, uHurt;
    uniform float uBlood, uRadial, uFlash, uKillCam, uHeat;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;

      // тепловое дрожание воздуха
      if (uHeat > 0.001) {
        uv += vec2(sin(uv.y * 44.0 + uTime * 3.1), cos(uv.x * 37.0 + uTime * 2.3)) * 0.0016 * uHeat;
      }

      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // база + радиальное размытие от центра (эффект скорости)
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uRadial > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i = 1; i <= 4; i++) {
          float k = float(i) * 0.25;
          acc += texture2D(tDiffuse, uv - d * k * 0.075 * uRadial).rgb;
        }
        col = mix(col, acc * 0.25, clamp(uRadial * 0.6, 0.0, 0.72));
      }

      // хроматическая аберрация по краям
      vec2 off = d * uAberration * (0.4 + r2 * 3.0);
      col.r = texture2D(tDiffuse, uv + off).r;
      col.b = texture2D(tDiffuse, uv - off).b;

      // шарп, чтобы картинка не мылилась на низком разрешении
      vec3 blur = (
        texture2D(tDiffuse, uv + vec2(1.0 / uResolution.x, 0.0)).rgb +
        texture2D(tDiffuse, uv - vec2(1.0 / uResolution.x, 0.0)).rgb +
        texture2D(tDiffuse, uv + vec2(0.0, 1.0 / uResolution.y)).rgb +
        texture2D(tDiffuse, uv - vec2(0.0, 1.0 / uResolution.y)).rgb) * 0.25;
      col += (col - blur) * 0.22;

      // контраст и насыщенность
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // сплит-тонирование: бирюзовые тени, тёплые света
      vec3 shadowTint = mix(vec3(0.94, 1.0, 1.06), vec3(0.82, 0.88, 1.12), uNight);
      vec3 highTint = vec3(1.045, 1.01, 0.965);
      col *= mix(shadowTint, highTint, smoothstep(0.18, 0.85, luma));

      // добивание: холодный контраст и лёгкая десатурация
      if (uKillCam > 0.001) {
        float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, mix(vec3(l2), col, 0.55) * vec3(1.06, 0.97, 0.95), uKillCam * 0.55);
      }

      // виньетка
      float vig = smoothstep(0.92, 0.18, r2 * uVignette * 2.2);
      col *= mix(1.0, vig, 0.82);

      // ранение
      col = mix(col, vec3(0.42, 0.03, 0.02), uHurt * smoothstep(0.08, 0.62, r2));

      // кровавая пелена с потёками после ближнего расчленения
      if (uBlood > 0.002) {
        float column = floor(uv.x * 26.0);
        float streak = hash(vec2(column, 3.7));
        float drip = smoothstep(0.0, 1.0, fract(uv.y * 1.6 + streak * 4.0 + uTime * 0.06));
        float edge = smoothstep(0.30, 0.92, r2 * 1.9);
        float blot = edge * (0.55 + 0.45 * drip) * uBlood;
        col = mix(col, vec3(0.36, 0.02, 0.03), clamp(blot, 0.0, 0.85));
      }

      // вспышка молнии или взрыва
      col += uFlash * vec3(0.92, 0.95, 1.0);

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
