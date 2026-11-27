import * as THREE from 'three';
import { BLOCK, BOUNDS, ROAD_W, ROAD_LINES } from './city-plan';
import type { Car } from './vehicle';
import type { Npc } from './npc';

type Axis = 'x' | 'z';
type Dir = { x: number; z: number; axis: Axis };
const directions: Dir[] = [{ x: 0, z: 1, axis: 'z' }, { x: 1, z: 0, axis: 'x' }, { x: 0, z: -1, axis: 'z' }, { x: -1, z: 0, axis: 'x' }];
const LANE = 3.55, CROSS = 11.8, CURB = ROAD_W / 2 + 1.5;
const clamp = THREE.MathUtils.clamp;

interface Segment {
  start: THREE.Vector3;
  end: THREE.Vector3;
  distance: number;
}
interface TrafficTrip {
  segments: Segment[];
  index: number;
  progress: number;
  junction: THREE.Vector3;
  entry: Dir;
  exit: Dir;
  cruise: number;
}
interface Corner { position: THREE.Vector3; gx: number; gz: number; sx: number; sz: number }
interface PedTrip { current: Corner; next: Corner; rest: number; stuck: number; px: number; pz: number }

const sidewalk = new Map<string, Corner>();
const cornerKey = (x: number, z: number, sx: number, sz: number) => `${x}|${z}|${sx}|${sz}`;
for (const x of ROAD_LINES) for (const z of ROAD_LINES) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  if (Math.abs(x + sx * CURB) > BOUNDS + 6 || Math.abs(z + sz * CURB) > BOUNDS + 6) continue;
  sidewalk.set(cornerKey(x, z, sx, sz), { position: new THREE.Vector3(x + sx * CURB, 0, z + sz * CURB), gx: x, gz: z, sx, sz });
}
const corners = Array.from(sidewalk.values());

function lanePoint(j: THREE.Vector3, dir: Dir, along: number) {
  return new THREE.Vector3(j.x + dir.x * along - dir.z * LANE, 0, j.z + dir.z * along + dir.x * LANE);
}

export class StreetLife {
  private routes = new WeakMap<Car, TrafficTrip>();
  private walking = new WeakMap<Npc, PedTrip>();
  private staging = new THREE.Vector3();

  seedCar(car: Car, start: THREE.Vector3, dir: Dir, initialSpeed = 0) {
    car.pos.copy(start);
    car.root.position.copy(start);
    car.yaw = Math.atan2(dir.x, dir.z);
    car.root.rotation.y = car.yaw;
    car.vLong = initialSpeed;
    car.vLat = 0;
    car.vel.set(dir.x * initialSpeed, 0, dir.z * initialSpeed);
    const gx = Math.round((start.x + dir.x * 14) / BLOCK) * BLOCK;
    const gz = Math.round((start.z + dir.z * 14) / BLOCK) * BLOCK;
    const j = new THREE.Vector3(clamp(gx, -BOUNDS, BOUNDS), 0, clamp(gz, -BOUNDS, BOUNDS));
    if ((j.x - start.x) * dir.x + (j.z - start.z) * dir.z < CROSS + 2) {
      j.x += dir.x * BLOCK; j.z += dir.z * BLOCK;
    }
    if (Math.abs(j.x) > BOUNDS || Math.abs(j.z) > BOUNDS) j.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z), -BLOCK);
    this.routes.set(car, this.makeTrip(start, j, dir));
  }

  // Reuse a distant traffic vehicle instead of accumulating cars across the map.
  recycle(car: Car, focus: THREE.Vector3, cars: Car[]) {
    for (let tries = 0; tries < 20; tries++) {
      const angle = Math.random() * Math.PI * 2, d = 38 + Math.random() * 110;
      const nearX = Math.round((focus.x + Math.cos(angle) * d) / BLOCK) * BLOCK;
      const nearZ = Math.round((focus.z + Math.sin(angle) * d) / BLOCK) * BLOCK;
      const dir = directions[Math.floor(Math.random() * 4)];
      if (Math.abs(nearX) > BOUNDS || Math.abs(nearZ) > BOUNDS) continue;
      const j = new THREE.Vector3(nearX, 0, nearZ);
      if (Math.abs(nearX - dir.x * BLOCK) > BOUNDS || Math.abs(nearZ - dir.z * BLOCK) > BOUNDS) continue;
      const position = lanePoint(j, dir, -22 - Math.random() * 35);
      if (position.distanceTo(focus) < 29 || cars.some(c => c !== car && c.pos.distanceToSquared(position) < 80)) continue;
      this.seedCar(car, position, dir, 5 + Math.random() * 3);
      return true;
    }
    return false;
  }

  private makeTrip(start: THREE.Vector3, j: THREE.Vector3, entry: Dir): TrafficTrip {
    const options = directions.filter(d => d.x * entry.x + d.z * entry.z >= 0 && Math.abs(j.x + d.x * BLOCK) <= BOUNDS && Math.abs(j.z + d.z * BLOCK) <= BOUNDS);
    const straight = options.find(d => d === entry);
    const exit = (straight && Math.random() < 0.68 ? straight : options[Math.floor(Math.random() * options.length)]) ?? entry;
    const before = lanePoint(j, entry, -CROSS), after = lanePoint(j, exit, CROSS);
    const curve = new THREE.CubicBezierCurve3(before, before.clone().add(new THREE.Vector3(entry.x * 9, 0, entry.z * 9)), after.clone().sub(new THREE.Vector3(exit.x * 9, 0, exit.z * 9)), after);
    const nodes = [start.clone(), before, ...curve.getPoints(12).slice(1)];
    const segments: Segment[] = [];
    for (let i = 1; i < nodes.length; i++) {
      const distance = Math.max(0.001, nodes[i - 1].distanceTo(nodes[i]));
      segments.push({ start: nodes[i - 1], end: nodes[i], distance });
    }
    return { segments, index: 0, progress: 0, junction: j, entry, exit, cruise: 10.5 + Math.random() * 3.8 };
  }

  drive(car: Car, dt: number, cars: Car[], walkers: readonly Npc[], green: (a: Axis) => boolean, wet: number) {
    const trip = this.routes.get(car);
    if (!trip) return;
    const seg = trip.segments[trip.index];
    if (!seg) return;
    let goal = trip.cruise * (1 - wet * 0.18);
    const stopping = trip.index === 0 && !green(trip.entry.axis);
    const toEntry = seg.distance - trip.progress;
    if (stopping) goal = Math.min(goal, Math.sqrt(Math.max(0, (toEntry - 0.65) * 7.6)));
    else if (trip.entry !== trip.exit) goal = Math.min(goal, trip.index > 0 ? 6.2 : 6.2 + toEntry * 0.18);

    const heading = this.staging.copy(seg.end).sub(seg.start).normalize();
    const safeDistance = 5.1 + Math.max(0, car.vLong) * 0.65;
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x, dz = other.pos.z - car.pos.z;
      const along = dx * heading.x + dz * heading.z, side = Math.abs(dx * heading.z - dz * heading.x);
      if (along > 0.5 && along < safeDistance + 7 && side < 2.2) {
        const bumper = car.spec.halfLength + other.spec.halfLength + 1.45;
        goal = Math.min(goal, Math.max(0, (along - bumper) * 1.22));
      }
    }
    for (const npc of walkers) {
      if (!npc.alive) continue;
      const p = npc.position(), dx = p.x - car.pos.x, dz = p.z - car.pos.z;
      const along = dx * heading.x + dz * heading.z;
      if (along > 0.2 && along < safeDistance + 3 && Math.abs(dx * heading.z - dz * heading.x) < 1.85)
        goal = Math.min(goal, Math.max(0, (along - car.spec.halfLength - 1.15) * 1.25));
    }
    const before = Math.max(0, car.vLong);
    car.vLong = before + clamp(goal - before, -(goal < 0.8 ? 8.4 : 5.4) * dt, dt * 3.3);
    car.brake = before > car.vLong + dt * 0.28 || goal < 0.1 ? 0.8 : 0;
    let step = car.vLong * dt;
    if (stopping) step = Math.min(step, Math.max(0, toEntry - 0.54));
    while (step > 0) {
      const current = trip.segments[trip.index];
      if (!current) break;
      const move = Math.min(step, current.distance - trip.progress);
      trip.progress += move; step -= move;
      car.pos.lerpVectors(current.start, current.end, clamp(trip.progress / current.distance, 0, 1));
      if (trip.progress + 0.0001 < current.distance) break;
      trip.index++; trip.progress = 0;
      if (trip.index === trip.segments.length) {
        const next = trip.junction.clone().add(new THREE.Vector3(trip.exit.x * BLOCK, 0, trip.exit.z * BLOCK));
        this.routes.set(car, this.makeTrip(car.pos, next, trip.exit));
        break;
      }
    }
    const desired = Math.atan2(heading.x, heading.z);
    const angle = Math.atan2(Math.sin(desired - car.yaw), Math.cos(desired - car.yaw));
    car.yaw += angle * (1 - Math.exp(-dt * 10));
    car.steer = clamp(angle * 1.35, -0.8, 0.8);
    car.vel.set(heading.x * car.vLong, 0, heading.z * car.vLong);
    car.throttle = car.vLong > before ? 0.5 : 0;
    car.aiAxis = trip.entry.axis;
    car.turnSignal = trip.index === 0 && toEntry < 35 && trip.exit !== trip.entry ? Math.sign(trip.entry.z * trip.exit.x - trip.entry.x * trip.exit.z) : 0;
    car.root.position.copy(car.pos); car.root.rotation.y = car.yaw;
  }

  walk(npc: Npc, dt: number, cars: Car[], green: (a: Axis) => boolean, blocked: (p: THREE.Vector3) => boolean) {
    if (npc.kind !== 'human' || !npc.alive) return;
    const p = npc.position();
    let trip = this.walking.get(npc);
    if (!trip || (trip.stuck > 3.2 && trip.next.position.distanceTo(p) > 2 && !npc.walkPlan?.waiting)) {
      let closest = corners[0], dist = Infinity;
      for (const c of corners) {
        const d = c.position.distanceToSquared(p);
        if (d < dist && !blocked(c.position)) { closest = c; dist = d; }
      }
      trip = { current: closest, next: closest, rest: 0, stuck: 0, px: p.x, pz: p.z };
      this.walking.set(npc, trip);
    }
    trip.rest = Math.max(0, trip.rest - dt);
    if (p.distanceToSquared(trip.next.position) < 0.9 && trip.rest <= 0) {
      const a = trip.next;
      const next = [cornerKey(a.gx + a.sx * BLOCK, a.gz, -a.sx, a.sz), cornerKey(a.gx, a.gz + a.sz * BLOCK, a.sx, -a.sz),
        cornerKey(a.gx, a.gz, -a.sx, a.sz), cornerKey(a.gx, a.gz, a.sx, -a.sz)]
        .map(key => sidewalk.get(key)).filter((node): node is Corner => !!node && node !== trip!.current && !blocked(node.position));
      trip.current = a;
      trip.next = next[Math.floor(Math.random() * next.length)] ?? a;
      trip.rest = Math.random() < 0.24 ? 0.8 + Math.random() * 1.8 : 0;
    }
    const crossing = trip.next !== trip.current && trip.next.gx === trip.current.gx && trip.next.gz === trip.current.gz;
    const atCorner = p.distanceToSquared(trip.current.position) < 2.8;
    let waiting = trip.rest > 0;
    if (crossing && atCorner) {
      const dir = trip.next.sx !== trip.current.sx ? 'x' : 'z';
      waiting ||= !green(dir);
      if (!waiting) {
        const midX = (p.x + trip.next.position.x) / 2, midZ = (p.z + trip.next.position.z) / 2;
        waiting = cars.some(c => Math.hypot(c.pos.x + c.vel.x * 0.55 - midX, c.pos.z + c.vel.z * 0.55 - midZ) < 8.5 && c.vLong > 1.7);
      }
    }
    const moved = Math.hypot(p.x - trip.px, p.z - trip.pz);
    trip.stuck = !waiting && moved < dt * 0.16 ? trip.stuck + dt : Math.max(0, trip.stuck - dt * 2);
    trip.px = p.x; trip.pz = p.z;
    npc.walkPlan = { target: trip.next.position, waiting };
  }
}