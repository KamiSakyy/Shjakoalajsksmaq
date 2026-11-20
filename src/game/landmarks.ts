import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS, type LandmarkKind } from './city-plan';

type Collision = { x: number; z: number; r: number };

function box(list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.rotateX(rx).rotateY(ry).rotateZ(rz);
  g.translate(x, y, z);
  list.push(g);
}

function label(lines: string[], width: number, height: number, bg: string, fg: string, accent?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = Math.round(512 * height / width);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(235,238,218,.45)'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  if (accent) { ctx.fillStyle = accent; ctx.fillRect(0, 0, 18, canvas.height); }
  ctx.fillStyle = fg; ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    const size = i === 0 ? Math.min(74, canvas.width / (line.length * 0.61)) : Math.min(38, canvas.width / (line.length * 0.6));
    ctx.font = `${i === 0 ? 700 : 500} ${size}px Arial`;
    ctx.fillText(line, canvas.width / 2 + (accent ? 9 : 0), canvas.height * (0.51 + i * 0.24));
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08 });
}

export function addLandmarkStructures(scene: THREE.Scene, colliders: Collision[]) {
  const structures: Record<string, { parts: THREE.BufferGeometry[]; material: THREE.Material; sign?: THREE.Mesh }> = {};
  const add = (kind: LandmarkKind, color: number) => {
    structures[kind] ??= { parts: [], material: new THREE.MeshStandardMaterial({ color, roughness: 0.79, metalness: 0.04 }) };
    return structures[kind];
  };
  const addSign = (kind: LandmarkKind, mesh: THREE.Mesh) => { add(kind, 0xffffff).sign = mesh; };
  const at = (id: LandmarkKind) => LANDMARKS.find(l => l.id === id)!;

  const hospital = at('hospital');
  const hosp = add('hospital', 0xe2dfd5);
  box(hosp.parts, 25, 0.34, 10, hospital.x, 4.0, hospital.z + 20);
  for (const x of [-10, 10]) box(hosp.parts, 0.55, 4, 0.55, hospital.x + x, 2, hospital.z + 15.4);
  box(hosp.parts, 12.3, 0.35, 4.1, hospital.x, 4.18, hospital.z + 17.8);
  box(hosp.parts, 0.15, 8, 0.15, hospital.x, 8, hospital.z + 20);
  box(hosp.parts, 3.4, 0.15, 0.15, hospital.x, 10.2, hospital.z + 20);
  box(hosp.parts, 0.15, 3.4, 0.15, hospital.x, 8.7, hospital.z + 20);
  addSign('hospital', new THREE.Mesh(new THREE.PlaneGeometry(16, 4), label(['PACIFIC GENERAL', 'EMERGENCY / ПРИЁМНОЕ'], 16, 4, '#263f42', '#f3efde', '#bb6b61')));
  hosp.sign!.position.set(hospital.x, 5.8, hospital.z + 22.2);

  const fire = at('fire');
  const fireStation = add('fire', 0xa64a3d);
  for (const x of [-8, 8]) box(fireStation.parts, 7.4, 5.2, 0.22, fire.x + x, 2.6, fire.z + 24);
  box(fireStation.parts, 17, 3.2, 1.4, fire.x, 1.6, fire.z + 24.4);
  for (const x of [-8.4, 8.4]) box(fireStation.parts, 0.45, 19, 0.45, fire.x + x, 9.5, fire.z + 19);
  box(fireStation.parts, 17.3, 0.35, 0.35, fire.x, 18.8, fire.z + 19);
  box(fireStation.parts, 16.3, 1.6, 0.32, fire.x, 6.9, fire.z + 24.2);
  addSign('fire', new THREE.Mesh(new THREE.PlaneGeometry(13, 2.6), label(['FIRE STATION 4', 'ПОЖАРНАЯ ЧАСТЬ'], 13, 2.6, '#892d29', '#f3e8d3', '#f0b177')));
  fireStation.sign!.position.set(fire.x, 6.9, fire.z + 24.5);

  const gas = at('gas');
  const gasStation = add('gas', 0xbec6c3);
  for (const x of [-9.5, 9.5]) for (const z of [-4.8, 4.8]) box(gasStation.parts, 0.55, 5.5, 0.55, gas.x + x, 2.75, gas.z + z);
  box(gasStation.parts, 22.5, 0.7, 12.6, gas.x, 5.75, gas.z);
  box(gasStation.parts, 21.4, 0.3, 11.5, gas.x, 5.37, gas.z);
  for (const x of [-4.2, 3.5]) {
    box(gasStation.parts, 0.7, 1.9, 1.1, gas.x + x, 0.95, gas.z + 1);
    box(gasStation.parts, 1.1, 0.3, 1.25, gas.x + x, 1.98, gas.z + 1);
  }
  box(gasStation.parts, 5.2, 0.3, 0.34, gas.x + 14, 3.2, gas.z + 4);
  box(gasStation.parts, 0.22, 6.4, 0.22, gas.x + 14, 3.2, gas.z + 4);
  addSign('gas', new THREE.Mesh(new THREE.PlaneGeometry(6, 3.1), label(['PACIFIC 24', 'FUEL / MARКЕТ'], 6, 3.1, '#1f423d', '#f3ecc7', '#d0a05b')));
  gasStation.sign!.position.set(gas.x + 14, 6.8, gas.z + 4.1);
  colliders.push({ x: gas.x - 9.5, z: gas.z - 4.8, r: 0.42 }, { x: gas.x + 9.5, z: gas.z - 4.8, r: 0.42 }, { x: gas.x - 9.5, z: gas.z + 4.8, r: 0.42 }, { x: gas.x + 9.5, z: gas.z + 4.8, r: 0.42 });

  const bank = at('bank');
  const bankBuilding = add('bank', 0xc9c0ae);
  for (let i = 0; i < 6; i++) box(bankBuilding.parts, 1.15, 7.6, 1.15, bank.x - 12.3 + i * 4.9, 3.85, bank.z + 22.5);
  box(bankBuilding.parts, 30, 1.3, 4.2, bank.x, 7.95, bank.z + 22.2);
  box(bankBuilding.parts, 28, 0.8, 3.8, bank.x, 0.42, bank.z + 22.1);
  addSign('bank', new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2), label(['PACIFIC BANK', 'С 1907 ГОДА'], 10, 2.2, '#e0d7be', '#303c37', undefined)));

  const hotel = at('hotel');
  const hotelBuilding = add('hotel', 0xb8b0a2);
  for (let i = 0; i < 10; i++) box(hotelBuilding.parts, 2.1, 0.18, 1.15, hotel.x - 10.6 + i * 2.35, 7.3, hotel.z + 21.3);
  addSign('hotel', new THREE.Mesh(new THREE.PlaneGeometry(11, 2.4), label(['HOTEL MARINA', 'ОТЕЛЬ · БАР · ПАРКОВКА'], 11, 2.4, '#2e4247', '#f1e6d1', '#c4876e')));

  const diner = at('diner');
  const dinerBuilding = add('diner', 0x9f5b4d);
  box(dinerBuilding.parts, 16, 0.24, 3.5, diner.x, 5.8, diner.z + 21);
  for (let i = 0; i < 8; i++) box(dinerBuilding.parts, 0.08, 5.6, 0.08, diner.x - 7.7 + i * 2.2, 2.8, diner.z + 23.1);
  addSign('diner', new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), label(['ORION DINER', 'ОТКРЫТО КРУГЛОСУТОЧНО'], 9, 2.4, '#45282d', '#f5e3bd', '#e5a069')));

  const stadium = at('stadium');
  const bowl = add('stadium', 0xa8a69a);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    box(bowl.parts, 7.1, 6.6, 1.8, stadium.x + Math.cos(a) * 31, 3.3, stadium.z + Math.sin(a) * 23, 0, -a, 0);
  }
  box(bowl.parts, 4, 0.28, 0.28, stadium.x, 3.8, stadium.z + 23.8);
  addSign('stadium', new THREE.Mesh(new THREE.PlaneGeometry(14, 2.8), label(['PACIFIC STADIUM', 'СПОРТИВНЫЙ КОМПЛЕКС'], 14, 2.8, '#2b3d34', '#f0e7d2', '#c9a46f')));

  const marina = at('marina');
  const docks = add('marina', 0x7d6d57);
  for (let i = 0; i < 6; i++) {
    box(docks.parts, 3.2, 0.22, 14, marina.x + 17 + i * 5.3, 0.04, marina.z);
    box(docks.parts, 0.25, 1.8, 0.25, marina.x + 15.7 + i * 5.3, 0.9, marina.z - 6.6);
    box(docks.parts, 2.2, 0.35, 5, marina.x + 16.8 + i * 5.3, 0.63, marina.z + 1.8);
    box(docks.parts, 1.8, 0.4, 3, marina.x + 16.8 + i * 5.3, 0.64, marina.z - 4.2);
  }
  addSign('marina', new THREE.Mesh(new THREE.PlaneGeometry(8, 1.8), label(['PACIFIC MARINA', 'ПРИЧАЛ 01—06'], 8, 1.8, '#1e3b42', '#e4dfc9', '#a9c4bc')));

  const college = at('college');
  const campus = add('college', 0xbfb6a1);
  for (const x of [-20, 20]) for (const z of [-8, 8]) box(campus.parts, 0.6, 8, 0.6, college.x + x, 4, college.z + z);
  box(campus.parts, 21, 0.25, 16.3, college.x, 8.05, college.z);
  box(campus.parts, 8, 0.25, 8, college.x, 0.25, college.z);
  addSign('college', new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), label(['PACIFIC COLLEGE', 'ГОРОДСКОЙ КОЛЛЕДЖ'], 12, 2.2, '#32463f', '#efe6cd', '#c7a57a')));

  const police = at('station');
  addSign('station', new THREE.Mesh(new THREE.PlaneGeometry(9, 2), label(['PACIFIC POLICE', 'УЧАСТОК 12'], 9, 2, '#1d303c', '#dbe3d5', '#879cb3')));
  addSign('garage', new THREE.Mesh(new THREE.PlaneGeometry(9, 2), label(['WESTSIDE AUTO', 'РЕМОНТ · ТОПЛИВО'], 9, 2, '#34453c', '#f0e5cd', '#c69166')));
  addSign('park', new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), label(['SUNSET PARK', 'ПАРК САНСЕТ'], 6, 1.4, '#3a4f3b', '#e7e7cf', undefined)));

  for (const [kind, s] of Object.entries(structures) as [LandmarkKind, typeof structures[string]][]) {
    if (s.parts.length) {
      const mesh = new THREE.Mesh(mergeGeometries(s.parts)!, s.material);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      s.parts.forEach(p => p.dispose());
    }
    if (s.sign) {
      const l = LANDMARKS.find(x => x.id === kind);
      if (l) scene.add(s.sign);
    }
  }
  const hospitalPole = new THREE.Vector3(hospital.x, 10.4, hospital.z + 20);
  const hotelSign = structures.hotel.sign!;
  hotelSign.position.set(hotel.x, 16.6, hotel.z + 21.6);
  const dinerSign = structures.diner.sign!;
  dinerSign.position.set(diner.x, 6.3, diner.z + 23.4);
  const bankSign = structures.bank.sign!;
  bankSign.position.set(bank.x, 8.9, bank.z + 24.4);
  const stadiumSign = structures.stadium.sign!;
  stadiumSign.position.set(stadium.x, 4.7, stadium.z + 24.2);
  const marinaSign = structures.marina.sign!;
  marinaSign.position.set(marina.x + 17, 3.6, marina.z - 7.6);
  marinaSign.rotation.y = Math.PI;
  const collegeSign = structures.college.sign!;
  collegeSign.position.set(college.x, 8.45, college.z + 8.2);
  const policeSign = structures.station.sign!;
  policeSign.position.set(police.x, 7.5, police.z + 19.6);
  const garageSign = structures.garage.sign!;
  garageSign.position.set(LANDMARKS.find(l => l.id === 'garage')!.x, 6.2, LANDMARKS.find(l => l.id === 'garage')!.z + 12.4);
  const parkSign = structures.park.sign!;
  parkSign.position.set(-78, 2.3, 39 + 16);
  // Blue emergency beacon at the hospital.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3f78a3, emissive: 0x5f96d5, emissiveIntensity: 2.3 }));
  beacon.position.copy(hospitalPole);
  scene.add(beacon);
  return { hospitalPole, structures };
}
