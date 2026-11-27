import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Game, HudState } from '../game/Game';

type DriveKey = 'left' | 'right' | 'gas' | 'brake' | 'handbrake';
type Symbol = DriveKey | 'cam' | 'horn' | 'door' | 'service';

function DriveIcon({ name, size = 21 }: { name: Symbol; size?: number }) {
  const paths: Record<Symbol, string> = {
    left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7', gas: 'm7 12 5-5 5 5m-10 6 5-5 5 5',
    brake: 'M5 8h14M5 12h14M5 16h14', handbrake: 'M6 13h12M12 8v10m-8-1a8 8 0 0 1 0-10m16 0a8 8 0 0 1 0 10',
    cam: 'M4 7h4l2-2h4l2 2h4v12H4V7Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    horn: 'M4 9v6h4l5 4V5L8 9H4Zm12-1a6 6 0 0 1 0 8m3-10a9 9 0 0 1 0 12',
    door: 'M10 5H5v14h5m3-10 4 3-4 3m-4-3h11', service: 'm7 17 5-5a5 5 0 0 0 6-6l-3 3-2-2 3-3a5 5 0 0 0-6 6l-5 5a1.5 1.5 0 0 0 2 2Z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function DriveControls({ game, hud }: { game: Game; hud: HudState }) {
  const pointers = useRef(new Map<DriveKey, number>());
  const [held, setHeld] = useState<DriveKey[]>([]);
  const on = (key: DriveKey, state: boolean) => key === 'handbrake' ? game.setHandbrake(state) : game.setDriveBtn(key, state);
  const capture = (e: PointerEvent<HTMLButtonElement>, key: DriveKey) => {
    if (e.pointerType === 'mouse' && e.button !== 0 || pointers.current.has(key)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(key, e.pointerId);
    on(key, true);
    setHeld([...pointers.current.keys()]);
  };
  const release = (e: PointerEvent<HTMLButtonElement>, key: DriveKey) => {
    if (pointers.current.get(key) !== e.pointerId) return;
    pointers.current.delete(key);
    on(key, false);
    setHeld([...pointers.current.keys()]);
  };
  const contact = (key: DriveKey) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => capture(e, key),
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => release(e, key),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => release(e, key),
    onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) => release(e, key),
    'data-held': held.includes(key),
  });
  useEffect(() => {
    const keys = pointers.current;
    return () => { keys.clear(); game.resetInput(); };
  }, [game]);

  const gear = hud.gear === 'R' ? 'R' : hud.gear.startsWith('D') ? `D ${hud.gear.slice(1)}` : hud.gear;
  const speed = Math.round(hud.speed);
  const dash = Math.max(1, Math.min(100, speed / 1.45));
  return <div className="road-controls">
    <div className="drive-utilities">
      <button type="button" onClick={() => game.cycleCarCamera()} aria-label="Сменить камеру"><DriveIcon name="cam" size={17} /><span>{['Погоня', 'Ближняя', 'Кино', 'Сверху'][hud.carCam] ?? 'Камера'}</span></button>
      <button type="button" onClick={() => game.horn()} aria-label="Гудок"><DriveIcon name="horn" size={18} /></button>
      {hud.serviceAvailable && <button type="button" onClick={() => game.serviceCar()} className="road-service"><DriveIcon name="service" size={17} /><span>Ремонт</span></button>}
      <button type="button" onClick={() => game.interact()} aria-label="Выйти из машины"><DriveIcon name="door" size={17} /><span>Выйти</span></button>
    </div>
    <div className="road-dial" aria-label={`${speed} километров в час, передача ${gear}`}>
      <svg viewBox="0 0 140 96" aria-hidden="true">
        <path d="M26 78A54 54 0 1 1 114 78" pathLength="100" fill="none" stroke="#a5b8a544" strokeWidth="2" />
        <path d="M26 78A54 54 0 1 1 114 78" pathLength="100" fill="none" stroke="#efab82" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${dash} 100`} />
      </svg>
      <div className="road-gear">{gear}</div><strong>{speed}</strong><span>КМ/Ч</span>
      {hud.carHealth < 98 && <div className="vehicle-integrity" aria-label="Состояние машины"><i style={{ width: `${Math.max(0, hud.carHealth)}%` }} /></div>}
      {(hud.carEngine > 0.04 || hud.carTires > 0.04) && <div className="drive-damage"><span>ДВС {Math.round((1 - hud.carEngine) * 100)}%</span><span>ШИНЫ {Math.round((1 - hud.carTires) * 100)}%</span></div>}
    </div>
    <div className="road-steering">
      <button type="button" className="road-wheel" aria-label="Руль влево" {...contact('left')}><DriveIcon name="left" size={27} /></button>
      <button type="button" className="road-wheel" aria-label="Руль вправо" {...contact('right')}><DriveIcon name="right" size={27} /></button>
    </div>
    <div className="road-pedals">
      <button type="button" className="road-ebrake" aria-label="Ручник" {...contact('handbrake')}><DriveIcon name="handbrake" size={22} /></button>
      <button type="button" className="road-brake" aria-label="Тормоз" {...contact('brake')}><DriveIcon name="brake" /><span>{hud.gear === 'R' ? 'НАЗАД' : 'ТОРМОЗ'}</span></button>
      <button type="button" className="road-accelerate" aria-label="Газ" {...contact('gas')}><DriveIcon name="gas" size={25} /><span>ГАЗ</span></button>
    </div>
  </div>;
}