import * as THREE from 'three';

export type ItemKind = 'medkit' | 'ammo' | 'shells' | 'gasoline' | 'whetstone';

export interface Pickup {
  kind: ItemKind;
  mesh: THREE.Group;
  amount: number;
  taken: boolean;
  bob: number;
  label: string;
}

const LABEL: Record<ItemKind, string> = {
  medkit: 'АПТЕЧКА · +40 HP',
  ammo: 'ПАТРОНЫ 9мм · +30',
  shells: 'ПАТРОНЫ 12 калибра · +8',
  gasoline: 'КАНИСТРА · машина поедет',
  whetstone: 'ТОЧИЛЬНЫЙ КАМЕНЬ · лезвие острее',
};

export class Items {
  group = new THREE.Group();
  list: Pickup[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  private make(kind: ItemKind): Pickup {
    const g = new THREE.Group();
    // дешёвый ореол (без реального источника света — иначе 40 ламп убьют FPS)
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.42;
    g.add(halo);
    const glow = { color: { setHex: (v: number) => { halo.material.color.setHex(v); } } } as unknown as THREE.PointLight;
    if (kind === 'medkit') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }));
      g.add(box);
      const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.23), new THREE.MeshStandardMaterial({ color: 0xd02020, emissive: 0x501010 }));
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.19, 0.23), new THREE.MeshStandardMaterial({ color: 0xd02020, emissive: 0x501010 }));
      g.add(cross1, cross2);
      glow.color.setHex(0xff6060);
    } else if (kind === 'ammo') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.18), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.5 }));
      g.add(box);
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.25 }));
        b.rotation.z = Math.PI / 2;
        b.position.set(0, 0.1, -0.06 + i * 0.04);
        g.add(b);
      }
      glow.color.setHex(0xffd070);
    } else if (kind === 'shells') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.2), new THREE.MeshStandardMaterial({ color: 0x6b2b2b, roughness: 0.7 }));
      g.add(box);
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.6 }));
        s.position.set(-0.05 + i * 0.05, 0.11, 0);
        g.add(s);
      }
      glow.color.setHex(0xff9060);
    } else if (kind === 'gasoline') {
      const can = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.14), new THREE.MeshStandardMaterial({ color: 0xc02a1a, roughness: 0.5, metalness: 0.3 }));
      g.add(can);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 8), new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 }));
      handle.position.y = 0.17;
      handle.rotation.x = Math.PI / 2;
      g.add(handle);
      glow.color.setHex(0xff5030);
    } else {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x8a8a82, roughness: 0.85 }));
      g.add(stone);
      const dust = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0x6a6a62, roughness: 1 }));
      dust.position.y = 0.045;
      g.add(dust);
      glow.color.setHex(0x90d0ff);
    }
    g.position.y = 0.45;
    this.group.add(g);
    return { kind, mesh: g, amount: 0, taken: false, bob: Math.random() * 6, label: LABEL[kind] };
  }

  spawn(kind: ItemKind, x: number, z: number, amount = 1) {
    const p = this.make(kind);
    p.mesh.position.set(x, 0.45, z);
    p.amount = amount;
    this.list.push(p);
    return p;
  }

  // разбросать предметы по тротуарам рядом с игроком
  scatter(points: THREE.Vector3[], count: number, kinds: ItemKind[]) {
    for (let i = 0; i < count; i++) {
      const p = points[(Math.random() * points.length) | 0];
      if (!p) break;
      const kind = kinds[(Math.random() * kinds.length) | 0];
      const x = p.x + (Math.random() - 0.5) * 3;
      const z = p.z + (Math.random() - 0.5) * 3;
      this.spawn(kind, x, z, kind === 'ammo' ? 30 : kind === 'shells' ? 8 : 1);
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      if (p.taken) continue;
      p.bob += dt;
      p.mesh.rotation.y += dt * 0.8;
      p.mesh.position.y = 0.45 + Math.sin(p.bob * 2) * 0.06;
    }
  }

  take(p: Pickup) {
    p.taken = true;
    this.group.remove(p.mesh);
  }
}
