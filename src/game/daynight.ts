import * as THREE from 'three';

export class DayNight {
  sun = new THREE.DirectionalLight(0xffe4bc, 2.6);
  moon = new THREE.DirectionalLight(0x9fb6cf, 0.2);
  hemi = new THREE.HemisphereLight(0xa9c2d2, 0x797365, 1.15);
  ambient = new THREE.AmbientLight(0xb7c4ce, 0.14);
  skyMesh: THREE.Mesh;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  time = 16.8;
  daySpeed = 24 / 1800;
  night = 0;
  dayFactor = 1;
  cloudTime = 0;
  cloudCover = 0.37;
  sunOcclusion = 0;
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
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: 0.5, far: 160, left: -32, right: 32, top: 32, bottom: -32 });
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.018;
    this.sun.shadow.radius = 2;
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi, this.ambient);
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 1, 0) }, night: { value: 0 }, time: { value: 0 }, cover: { value: 0.37 }, occl: { value: 0 } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 sunDir;
        uniform float night, time, cover, occl;
        float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p) {
          vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
        }
        float fbm(vec2 p) {
          float n=0.,a=0.5;
          for(int i=0;i<4;i++){n+=noise(p)*a;p=p*2.03+17.3;a*=0.5;}
          return n;
        }
        void main() {
          vec3 d=normalize(vDir), sun=normalize(sunDir);
          float h=max(0.,d.y);
          float dusk=(1.-smoothstep(0.0,0.56,abs(sun.y)))*(1.-night);
          vec3 horizon=mix(vec3(0.63,0.71,0.75),vec3(0.9,0.57,0.31),dusk*0.75);
          vec3 zenith=vec3(0.135,0.30,0.47);
          vec3 sky=mix(horizon,zenith,pow(h,0.45));
          sky=mix(sky,mix(vec3(0.019,0.031,0.047),vec3(0.004,0.011,0.025),pow(h,0.5)),night);
          float sd=max(dot(d,sun),0.);
          vec3 sunlight=mix(vec3(1.,0.88,0.66),vec3(1.,0.47,0.18),dusk);
          sky+=sunlight*(pow(sd,32.)*0.12+smoothstep(0.99985,0.99996,sd)*6.)*(1.-night)*(1.-occl*.94);
          float md=max(dot(d,-sun),0.);
          sky+=vec3(0.62,0.76,1.)*(smoothstep(0.99984,0.99997,md)*1.4+pow(md,40.)*0.025)*night;
          if(d.y>0.03) {
            vec2 uv=d.xz/(d.y+0.22)*1.1+vec2(time*0.0015,time*0.0005);
            float f=fbm(uv*2.2);
            float density=smoothstep(0.6-cover*0.22,0.82-cover*0.2,f);
            density*=smoothstep(0.02,0.3,d.y);
            float shade=fbm(uv*2.2+0.13);
            vec3 cloud=mix(vec3(0.51,0.57,0.60),vec3(1.03,1.,0.92),shade);
            cloud=mix(cloud,vec3(0.95,0.64,0.40),dusk*0.65);
            cloud=mix(cloud,vec3(0.035,0.046,0.062),night);
            cloud=mix(cloud,vec3(.24,.27,.29),occl*.62);
            sky=mix(sky,cloud,density*0.82);
            float star=step(0.9994,hash(floor(d.xz/(d.y+0.4)*480.)));
            sky+=vec3(0.5,0.57,0.66)*star*night*(1.-density)*smoothstep(0.1,0.5,h);
          }
          if(d.y<0.) sky=mix(sky,vec3(0.09,0.11,0.12),smoothstep(0.,0.6,-d.y));
          gl_FragColor=vec4(sky,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(470, 24, 16), this.mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    scene.add(this.skyMesh);
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 16, 12), this.mat));
  }

  get clock() {
    return `${String(Math.floor(this.time)).padStart(2, '0')}:${String(Math.floor(this.time % 1 * 60)).padStart(2, '0')}`;
  }

  setTime(t: number) { this.time = (t % 24 + 24) % 24; this.envTimer = 0; }

  setQuality(high: boolean) {
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  update(dt: number, focus: THREE.Vector3, scene: THREE.Scene) {
    this.time = (this.time + dt * this.daySpeed) % 24;
    this.cloudTime += dt;
    const angle = (this.time - 6) / 24 * Math.PI * 2;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), -0.28).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.dayFactor = THREE.MathUtils.smoothstep(this.sunDir.y, -0.12, 0.14);
    this.night = 1 - this.dayFactor;
    const warmth = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.05, 0.65);
    this.sun.color.copy(new THREE.Color(0xfff4df).lerp(new THREE.Color(0xffb977), warmth * 0.73));
    const uvx = this.sunDir.x / (Math.max(0.08, this.sunDir.y) + 0.22) * 1.1 + this.cloudTime * 0.0015;
    const uvz = this.sunDir.z / (Math.max(0.08, this.sunDir.y) + 0.22) * 1.1 + this.cloudTime * 0.0005;
    const density = Math.max(0, Math.min(1, (this.fbm2(uvx * 2.2, uvz * 2.2) - (0.6 - this.cloudCover * 0.22)) / 0.22));
    const targetOccl = Math.min(1, this.cloudCover) * (0.42 + density * 0.58) * Math.max(0, Math.min(1, this.sunDir.y * 3 + 0.22)) * (0.55 + this.cloudCover * 0.45);
    this.sunOcclusion += (targetOccl - this.sunOcclusion) * Math.min(1, dt * 1.05);
    this.sun.intensity = 2.5 * this.dayFactor * (1 - this.sunOcclusion * 0.84);
    this.sun.visible = this.dayFactor > 0.012;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 75);
    this.sun.target.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(this.moonDir, 75);
    this.moon.target.position.copy(focus);
    this.moon.intensity = this.night * 0.5;
    this.moon.visible = this.night > 0.035;
    this.hemi.intensity = (0.48 + this.dayFactor * 1.05) * (1 - this.sunOcclusion * 0.36);
    this.ambient.intensity = (0.11 + this.dayFactor * 0.12) * (1 - this.sunOcclusion * 0.24);
    this.skyMesh.position.copy(focus);
    this.mat.uniforms.sunDir.value.copy(this.sunDir);
    this.mat.uniforms.night.value = this.night;
    this.mat.uniforms.time.value = this.cloudTime;
    this.mat.uniforms.cover.value = this.cloudCover;
    this.mat.uniforms.occl.value = this.sunOcclusion;
    const fog = scene.fog as THREE.FogExp2;
    if (fog) {
      fog.color.set(0xb9c9cc).lerp(new THREE.Color(0x1e2d37), this.night);
      fog.density = 0.00165 + this.night * 0.0022;
    }
    scene.environmentIntensity = 0.65;
    this.envTimer -= dt;
    if (this.envTimer <= 0) { this.envTimer = 30; this.updateEnv(scene); }
  }

  updateEnv(scene: THREE.Scene) {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.03, 0.1, 100, { size: 64 });
    scene.environment = this.envRT.texture;
    old?.dispose();
  }

  dispose() {
    this.envRT?.dispose(); this.pmrem.dispose();
    this.skyMesh.geometry.dispose(); this.mat.dispose();
  }
}
