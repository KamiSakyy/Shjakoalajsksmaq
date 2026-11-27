import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS, COAST, LANDMARKS } from './city-plan';

export class DistrictVisuals {
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private spray: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private sprayPositions = new Float32Array(96 * 3);
  private time = 0;
  readonly lampPositions: THREE.Vector3[] = [];
  readonly streetObstacles: { x: number; z: number; r: number }[] = [];
  private promenadeLamps = new THREE.MeshStandardMaterial({ color: 0xd8ba8d, emissive: 0xffdb9c, emissiveIntensity: 0 });

  constructor(parent: THREE.Group) {
    const sea = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uSun: { value: new THREE.Vector3(0.6, 0.5, -0.6) } },
      vertexShader: `varying vec3 surface;
        void main(){surface=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(surface,1.);}`,
      fragmentShader: `varying vec3 surface;
        uniform vec3 uSun;
        uniform float uTime,uNight;
        void main(){
          vec2 p=surface.xz;
          float a=dot(p,vec2(.39,.21))-uTime*.9+sin(p.y*.09)*1.13,b=dot(p,vec2(-1.33,.72))+uTime*1.3+cos(p.x*.13+p.y*.08)*1.26;
          float ripple=sin(a)*.45+sin(b)*.22+sin(p.y*2.7-uTime*2.+sin(a))*.12;
          vec3 n=normalize(vec3(cos(a)*.056+cos(b)*.042,1.,cos(b)*.05+sin(a)*.04));
          vec3 eye=normalize(cameraPosition-surface);
          float horizon=pow(1.-max(0.,dot(n,eye)),5.);
          float glint=pow(max(0.,dot(reflect(-normalize(uSun),n),eye)),46.)*(1.-uNight);
          vec3 water=mix(vec3(.055,.155,.172),vec3(.33,.48,.52),horizon);
          water+=ripple*vec3(.009,.017,.019)+glint*vec3(1.2,.82,.42);
          water=mix(water,vec3(.012,.032,.048)+horizon*.04, uNight*.93);
          float mist=smoothstep(40.,480.,distance(surface,cameraPosition));
          water=mix(water,mix(vec3(.4,.54,.58),vec3(.042,.071,.11),uNight),mist*.84);
          gl_FragColor=vec4(water,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1220, 1650), sea);
    this.water.rotateX(-Math.PI / 2);
    this.water.position.set(COAST + 610, -0.68, 0);
    parent.add(this.water);

    const promenade = new THREE.Mesh(new THREE.BoxGeometry(9, 0.45, BOUNDS * 2 + 12), new THREE.MeshStandardMaterial({ color: 0xc3b7a3, roughness: 0.88 }));
    promenade.position.set(COAST - 4.5, -0.06, 0); promenade.receiveShadow = true;
    parent.add(promenade);
    const railGeo: THREE.BufferGeometry[] = [], deckGeo: THREE.BufferGeometry[] = [];
    const garageGeo: THREE.BufferGeometry[] = [];
    const stoneGeo: THREE.BufferGeometry[] = [], woodGeo: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], greens: THREE.BufferGeometry[] = [];
    const makeBox = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g);
    };
    for (let z = -BOUNDS; z <= BOUNDS; z += 4) {
      if (Math.abs(z - 107) < 4) continue;
      makeBox(railGeo, 0.10, 1.05, 0.1, COAST - 0.55, 0.68, z);
      makeBox(railGeo, 0.065, 0.07, 4, COAST - 0.55, 1.18, z + 2);
      makeBox(railGeo, 0.06, 0.046, 4, COAST - 0.55, 0.59, z + 2);
    }
    for (let i = 0; i < 78; i++) makeBox(deckGeo, 0.58, 0.19, 7.2, COAST + i * 0.59, 0.08, 107);
    for (let i = 0; i < 8; i++) for (const side of [-1, 1]) makeBox(railGeo, 0.25, 2.8, 0.25, COAST + i * 6.2, -0.95, 107 + side * 3.12);
    makeBox(railGeo, 46, 0.075, 0.075, COAST + 23, 1.14, 103.65);
    makeBox(railGeo, 46, 0.075, 0.075, COAST + 23, 1.14, 110.35);
    for (let z = -BOUNDS + 14; z < BOUNDS; z += 32) {
      const x = COAST - 3.0;
      makeBox(railGeo, 0.09, 4.3, 0.09, x, 2.3, z);
      makeBox(railGeo, 0.62, 0.08, 0.09, x + 0.27, 4.46, z);
      this.lampPositions.push(new THREE.Vector3(x + 0.53, 4.39, z));
    }
    for (const [x, z] of [[13.5, 16.5], [13.5, 32], [13.5, 49], [-13.5, 16.5], [-13.5, 32], [22.5, 13.5], [53, 14]]) {
      makeBox(stoneGeo, 2, 0.39, 1.24, x, 0.4, z);
      makeBox(stoneGeo, 2.05, 0.074, 1.32, x, 0.62, z);
      for (let i = 0; i < 4; i++) {
        const shrub = new THREE.IcosahedronGeometry(0.49, 1).scale(0.74, 0.6, 0.72);
        shrub.translate(x - 0.59 + i * 0.38, 0.78, z + Math.sin(i * 2.3) * 0.17);
        greens.push(shrub);
      }
      this.streetObstacles.push({ x, z, r: 0.93 });
      makeBox(woodGeo, 1.93, 0.075, 0.44, x, 0.62, z + 1.1);
      makeBox(woodGeo, 1.93, 0.21, 0.06, x, 0.85, z + 1.33);
      for (const end of [-0.74, 0.74]) makeBox(frames, 0.07, 0.47, 0.37, x + end, 0.41, z + 1.1);
    }

    // An identifiable transit stop next to the central northbound sidewalk.
    const shelterX = -12.7, shelterZ = -22;
    for (const z of [shelterZ - 2, shelterZ + 2]) {
      makeBox(frames, 0.067, 2.48, 0.067, shelterX - 0.72, 1.42, z);
      makeBox(frames, 0.067, 2.48, 0.067, shelterX + 0.72, 1.42, z);
    }
    makeBox(frames, 1.56, 0.12, 4.24, shelterX, 2.67, shelterZ);
    makeBox(woodGeo, 0.41, 0.065, 3.25, shelterX - 0.48, 0.61, shelterZ);
    const shelter = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.13, 3.93), new THREE.MeshStandardMaterial({ color: 0x759693, roughness: 0.16, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }));
    shelter.position.set(shelterX - 0.71, 1.57, shelterZ); parent.add(shelter);
    this.streetObstacles.push({ x: shelterX - 0.75, z: shelterZ, r: 0.92 });
    const sign = document.createElement('canvas'); sign.width = 344; sign.height = 96;
    const paint = sign.getContext('2d')!;
    paint.fillStyle = '#243b37'; paint.fillRect(0, 0, 344, 96); paint.fillStyle = '#d5d9bb'; paint.font = '700 31px Arial'; paint.textAlign = 'center';
    paint.fillText('PACIFIC TRANSIT', 172, 41); paint.font = '500 19px Arial'; paint.fillText('04 / BAYFRONT', 172, 73);
    const signMap = new THREE.CanvasTexture(sign); signMap.colorSpace = THREE.SRGBColorSpace;
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.35, 1.47), new THREE.MeshStandardMaterial({ map: signMap, roughness: 0.71 }));
    stop.position.set(shelterX + 0.71, 2.42, shelterZ); parent.add(stop);
    const garage = LANDMARKS.find(x => x.id === 'garage')!;
    makeBox(garageGeo, 11, 0.10, 7, garage.x, 0.11, -12.6);
    makeBox(garageGeo, 10.6, 0.18, 4.0, garage.x, 2.84, -12.8);
    for (const side of [-1, 1]) makeBox(garageGeo, 0.13, 2.75, 0.13, garage.x + side * 5.1, 1.44, -11.05);
    const merge = (parts: THREE.BufferGeometry[], color: number) => {
      const mesh = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ color, roughness: 0.83 }));
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
      parts.forEach(g => g.dispose());
    };
    merge(railGeo, 0x455556); merge(deckGeo, 0x887463); merge(garageGeo, 0x607068);
    merge(stoneGeo, 0x8e8370); merge(woodGeo, 0x786049); merge(frames, 0x3c5149); merge(greens, 0x4b663a);
    const lampFaces = new THREE.InstancedMesh(new THREE.BoxGeometry(0.27, 0.07, 0.155), this.promenadeLamps, this.lampPositions.length);
    this.lampPositions.forEach((p, i) => lampFaces.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    parent.add(lampFaces);

    const spray = new THREE.BufferGeometry();
    spray.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.spray = new THREE.Points(spray, new THREE.PointsMaterial({ color: 0xd2e9e8, size: 0.064, transparent: true, opacity: 0.65, depthWrite: false }));
    this.spray.position.set(39, 0.86, 39);
    this.spray.frustumCulled = false;
    parent.add(this.spray);
  }

  update(dt: number, focus: THREE.Vector3, night: number, sun: THREE.Vector3) {
    this.time += dt;
    this.water.visible = focus.x > 15;
    this.water.material.uniforms.uNight.value = night;
    this.water.material.uniforms.uTime.value = this.time;
    this.water.material.uniforms.uSun.value.copy(sun);
    this.promenadeLamps.emissiveIntensity = night * 2.1;
    this.spray.visible = Math.hypot(focus.x - 39, focus.z - 39) < 105;
    if (!this.spray.visible) return;
    for (let i = 0; i < 96; i++) {
      const t = (i * 0.053 + this.time * 0.8) % 1;
      const a = i * 2.39996;
      const r = t * (0.7 + (i % 5) * 0.26);
      this.sprayPositions[i * 3] = Math.cos(a) * r;
      this.sprayPositions[i * 3 + 1] = Math.max(0, Math.sin(t * Math.PI) * (1.3 + (i % 7) * 0.13));
      this.sprayPositions[i * 3 + 2] = Math.sin(a) * r;
    }
    this.spray.geometry.getAttribute('position').needsUpdate = true;
  }
}