import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCharacter, preloadCharacterAssets, type CharacterKind, type CharacterRig } from '../game/characters';

const characters: { kind: CharacterKind; name: string; subtitle: string; description: string }[] = [
  { kind: 'human', name: 'Житель города', subtitle: 'ГРАЖДАНСКИЙ', description: 'У каждого своя дорога. Жители гуляют по городу и стараются держаться подальше от опасности.' },
  { kind: 'zombie', name: 'Заражённый', subtitle: 'ИНФИЦИРОВАННЫЙ', description: 'Бледная кожа, тяжёлая походка и реакция на шум. После заката на улицах становится опаснее.' },
  { kind: 'officer', name: 'Офицер патруля', subtitle: 'ПОЛИЦИЯ', description: 'Патрульная форма, бронежилет и служебное оружие. Полиция реагирует на преступления в городе.' },
];

export function CharacterViewer() {
  const holder = useRef<HTMLDivElement>(null);
  const rig = useRef<CharacterRig | null>(null);
  const scene = useRef<THREE.Scene | null>(null);
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!holder.current) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { setFailed(true); return; }
    const host = holder.current;
    host.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    scene.current = world;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 30);
    camera.position.set(0, 1.43, 2.65);
    camera.lookAt(0, 1.19, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(environment, 0.04, 0.1, 100, { size: 64 });
    world.environment = env.texture;
    world.environmentIntensity = 0.65;
    const key = new THREE.DirectionalLight(0xffe6c7, 2.2);
    key.position.set(-2, 4, 3);
    const rim = new THREE.DirectionalLight(0xb1d5e6, 1.3);
    rim.position.set(2, 2.5, -2);
    world.add(key, rim, new THREE.HemisphereLight(0xc0cad0, 0x74634b, 1.15));
    const model = createCharacter('human', 'normal', 6);
    model.root.rotation.y = -0.3;
    rig.current = model;
    world.add(model.root);
    void preloadCharacterAssets();
    let angle = -0.3, dragging = false, lastX = 0;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (dragging) { angle += (e.clientX - lastX) * 0.009; lastX = e.clientX; } };
    const up = () => { dragging = false; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      if (rig.current) {
        rig.current.root.rotation.y = angle;
        rig.current.torso.scale.y = 1 + Math.sin(t * 1.7) * 0.003;
        rig.current.head.rotation.x = Math.sin(t * 0.8) * 0.014;
      }
      renderer.render(world, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderer.dispose(); env.dispose(); pmrem.dispose(); environment.dispose();
      renderer.domElement.remove(); scene.current = null; rig.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scene.current) return;
    if (rig.current) scene.current.remove(rig.current.root);
    const next = createCharacter(characters[selected].kind, 'normal', selected === 1 ? 8 : 6);
    rig.current = next; scene.current.add(next.root);
  }, [selected]);

  return <div className="character-inspector">
    <div className="character-stage" ref={holder}>
      {failed && <p className="viewer-fallback">Для просмотра моделей нужен браузер с WebGL 2.</p>}
      <span className="drag-hint">Потяните, чтобы повернуть модель</span>
    </div>
    <div className="character-info">
      <span className="eyebrow">{characters[selected].subtitle}</span>
      <h3>{characters[selected].name}</h3>
      <p>{characters[selected].description}</p>
      <div className="character-tabs" aria-label="Выбор персонажа">
        {characters.map((c, i) => <button key={c.kind} className={i === selected ? 'selected' : ''} onClick={() => setSelected(i)} aria-pressed={i === selected}>{String(i + 1).padStart(2, '0')}<span>{c.kind === 'human' ? 'Человек' : c.kind === 'zombie' ? 'Зомби' : 'Полиция'}</span></button>)}
      </div>
      <small>Игровая 3D-модель. Те же персонажи используются в городе.</small>
    </div>
  </div>;
}