import * as THREE from 'three';

/**
 * Заморозка статичной геометрии.
 *
 * Город, набережная и крыши не двигаются, но three.js каждый кадр пересчитывает
 * им матрицы. Пометка `matrixAutoUpdate = false` убирает тысячи умножений
 * матриц из кадра — на Android это заметные миллисекунды, а картинка не меняется.
 * Объекты с `userData.dynamic = true` (яхты, маячки, лифты) остаются живыми.
 */
export function markDynamic(obj: THREE.Object3D) {
  obj.userData.dynamic = true;
  obj.traverse((o) => { o.userData.dynamic = true; });
}

function hasDynamicParent(o: THREE.Object3D | null): boolean {
  let cur = o;
  while (cur) {
    if (cur.userData.dynamic) return true;
    cur = cur.parent;
  }
  return false;
}

export function freezeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.userData.dynamic || hasDynamicParent(o)) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    // статика не нуждается в пересчёте мировой матрицы
    o.matrixWorldNeedsUpdate = false;
  });
  root.matrixWorldAutoUpdate = false;
}

/** Освободить память GPU у выброшенной ветки сцены. */
export function disposeTree(root: THREE.Object3D, keepMaterials = true) {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material;
    if (mat && !keepMaterials) {
      if (Array.isArray(mat)) mat.forEach((x) => materials.add(x));
      else materials.add(mat);
    }
  });
  materials.forEach((m) => m.dispose());
}
