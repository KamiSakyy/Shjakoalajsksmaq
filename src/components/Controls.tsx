import { useEffect, useRef, useState } from 'react';
import type { Game, HudState } from '../game/Game';
import { DriveControls } from './DriveControls';

interface Props {
  game: Game;
  hud: HudState;
}

const STICK_R = 58;

// Зоны экрана для мультитача: каждая зона обрабатывает свой pointerId
export function Controls({ game, hud }: Props) {
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const stickId = useRef<number | null>(null);
  const stickOrigin = useRef({ x: 0, y: 0 });
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const axeId = useRef<number | null>(null);
  const axeLast = useRef({ x: 0, y: 0 });
  const axeStart = useRef({ x: 0, y: 0 });
  const [steer, setSteer] = useState({ x: 0, y: 0 });
  const [axePress, setAxePress] = useState(false);
  const [firePress, setFirePress] = useState(false);

  // ---------- глобальные обработчики указателя ----------
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === lookId.current) {
        const dx = e.clientX - lookLast.current.x;
        const dy = e.clientY - lookLast.current.y;
        game.look(dx, dy);
        lookLast.current = { x: e.clientX, y: e.clientY };
      } else if (e.pointerId === stickId.current) {
        let dx = e.clientX - stickOrigin.current.x;
        let dy = e.clientY - stickOrigin.current.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
        setStick({ x: stickOrigin.current.x, y: stickOrigin.current.y, dx, dy });
        const strength = Math.max(0, (Math.min(STICK_R, len) - 6) / (STICK_R - 6));
        const radius = Math.max(1, Math.hypot(dx, dy));
        game.setMove(dx / radius * strength, -dy / radius * strength);
      } else if (e.pointerId === axeId.current) {
        const dx = e.clientX - axeLast.current.x;
        const dy = e.clientY - axeLast.current.y;
        axeLast.current = { x: e.clientX, y: e.clientY };
        game.axeMove(dx, dy);
        const sx = Math.max(-1, Math.min(1, (e.clientX - axeStart.current.x) / 110));
        const sy = Math.max(-1, Math.min(1, (e.clientY - axeStart.current.y) / 110));
        setSteer({ x: sx, y: sy });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === lookId.current) lookId.current = null;
      if (e.pointerId === stickId.current) {
        stickId.current = null;
        setStick(null);
        game.setMove(0, 0);
      }
      if (e.pointerId === axeId.current) {
        axeId.current = null;
        if (e.type === 'pointercancel') { game.axe.cancel(); game.pullHold = false; }
        else game.axeUp();
        setAxePress(false);
        setSteer({ x: 0, y: 0 });
      }
    };
    const reset = () => {
      lookId.current = null;
      stickId.current = null;
      axeId.current = null;
      setStick(null);
      setAxePress(false);
      setFirePress(false);
      game.resetInput();
    };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [game]);

  // кнопки захватывают указатель, чтобы палец не «уезжал» с кнопки
  const capture = (e: React.PointerEvent, id: 'axe' | 'fire' | 'ads') => {
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (id === 'axe') {
      if (axeId.current !== null) return;
      axeId.current = e.pointerId;
      axeLast.current = { x: e.clientX, y: e.clientY };
      axeStart.current = { x: e.clientX, y: e.clientY };
      setAxePress(true);
      game.axeDown();
    } else if (id === 'fire') {
      setFirePress(true);
      game.fireDown();
    } else {
      game.toggleAds();
    }
  };
  const release = (e: React.PointerEvent, id: 'axe' | 'fire' | 'ads') => {
    if (id === 'axe') {
      if (axeId.current === e.pointerId) axeId.current = null;
      if (e.type === 'pointercancel') { game.axe.cancel(); game.pullHold = false; }
      else game.axeUp();
      setAxePress(false);
      setSteer({ x: 0, y: 0 });
    } else if (id === 'fire') {
      game.fireUp();
      setFirePress(false);
    } else {
      game.ads(false);
    }
  };

  const inCar = hud.inCar;
  const axeBtn = hud.weapon === 'axe';
  const stuck = hud.axeState === 'stuck';
  const left = hud.axeState === 'left';
  const charge = hud.charge;
  const ringDash = 2 * Math.PI * 44;

  return (
    <div className="absolute inset-0 select-none" style={{ touchAction: 'none' }}>
      {/* зона обзора — правая половина экрана (не перехватывается кнопками) */}
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          lookId.current = e.pointerId;
          lookLast.current = { x: e.clientX, y: e.clientY };
        }}
      />
      {/* переключатель вида от третьего лица (пешком) */}
      {!inCar && (
        <button
          className="absolute right-3 top-24 z-30 rounded-full border border-white/25 bg-black/45 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/70 active:scale-95"
          onPointerDown={() => game.toggleOnFootCam()}
        >
          {hud.onFootCam ? '1-е лицо' : '3-е лицо'}
        </button>
      )}
      {/* зона движения — левая половина */}
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          if (game.vehicle) {
            lookId.current = e.pointerId;
            lookLast.current = { x: e.clientX, y: e.clientY };
            return;
          }
          // перехватываем управление: если старый палец «залип» — просто забираем джойстик
          stickId.current = e.pointerId;
          stickOrigin.current = { x: e.clientX, y: e.clientY };
          setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
          game.setMove(0, 0);
        }}
      />

      {!inCar && (stick ? (
        <div className="pointer-events-none absolute z-20" style={{ left: stick.x - STICK_R - 6, top: stick.y - STICK_R - 6 }}>
          <div className="h-[124px] w-[124px] rounded-full border border-white/25 bg-white/5 backdrop-blur-[2px]" />
          <div
            className="absolute h-14 w-14 rounded-full bg-white/45 shadow-lg"
            style={{ left: STICK_R - 22 + stick.dx, top: STICK_R - 22 + stick.dy }}
          />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-8 left-8 z-10 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 text-[9px] uppercase tracking-widest text-white/35">
          движение
        </div>
      ))}

      {/* положение тела: присед и ползание */}
      {!inCar && (
        <div className="stance-controls">
          <button type="button" className={hud.stance === 'crouch' ? 'active' : ''} onClick={() => game.setStance(hud.stance === 'crouch' ? 'stand' : 'crouch')} aria-pressed={hud.stance === 'crouch'} aria-label="Присесть">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM9 20l2-5 3 2v3M11 15l-3-3 1-4 4 1 3 4h3" /></svg>
            <span>ПРИСЕСТЬ</span>
          </button>
          <button type="button" className={hud.stance === 'prone' ? 'active' : ''} onClick={() => game.setStance(hud.stance === 'prone' ? 'stand' : 'prone')} aria-pressed={hud.stance === 'prone'} aria-label="Лечь и ползти">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 17h13m-13 0 4-4h7l4 4m-3-10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 17v3m5-3v3" /></svg>
            <span>ПОЛЗТИ</span>
          </button>
        </div>
      )}

      {/* ---------- правый кластер кнопок (только пешком) ---------- */}
      {!inCar && (
      <div className="absolute bottom-4 right-4 z-30 flex items-end gap-3">
        {/* вспомогательные */}
        <div className="flex flex-col gap-2 pb-2">
          {hud.weapon !== 'axe' && (
            <button
              className={`h-12 w-12 rounded-full border text-[9px] font-bold uppercase tracking-wider ${
                hud.ads ? 'border-sky-400 bg-sky-900/70 text-sky-100' : 'border-white/40 bg-black/50 text-white/80'
              }`}
              onClick={() => game.toggleAds()}
              aria-pressed={hud.ads}
              aria-label="Переключить прицел"
            >
              {hud.ads ? 'В ПРИЦЕЛЕ' : 'ПРИЦЕЛ'}
            </button>
          )}
          {hud.weapon !== 'axe' && (
            <button
              className={`h-12 w-12 rounded-full border text-[9px] font-bold uppercase tracking-wider ${
                hud.reloading ? 'border-amber-400 bg-amber-900/70 text-amber-100' : 'border-white/40 bg-black/50 text-white/80'
              }`}
              onClick={() => game.reload()}
              aria-label="Перезарядить"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 10a7 7 0 1 0-2 7m2-11v5h-5" /></svg>
            </button>
          )}
            <button
              className="h-12 w-12 rounded-full border border-white/40 bg-black/50 text-[9px] font-bold uppercase tracking-wider text-white/80 active:scale-95"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); game.setSprint(true); }}
              onPointerUp={() => game.setSprint(false)}
              onPointerCancel={() => game.setSprint(false)}
              onLostPointerCapture={() => game.setSprint(false)}
            >
              БЕГ
            </button>
        </div>

        {/* главная кнопка: огонь или топор */}
        <div className="relative flex flex-col items-center gap-2">
          {stuck && (
            <div className="pointer-events-none w-28 overflow-hidden rounded bg-black/50">
              <div className="h-1.5 bg-red-500" style={{ width: `${Math.min(100, hud.pullProgress * 100)}%` }} />
            </div>
          )}
          <button
            className={`relative flex h-28 w-28 items-center justify-center rounded-full border-2 text-center text-[11px] font-bold uppercase leading-tight tracking-wider shadow-2xl transition-transform ${
              axeBtn
                ? stuck ? 'border-red-400 bg-red-900/70 text-red-100'
                  : left ? 'border-yellow-400 bg-yellow-900/60 text-yellow-100'
                  : axePress ? 'scale-95 border-orange-300 bg-orange-700/70 text-white'
                  : 'border-white/40 bg-black/55 text-white/90'
                : firePress ? 'scale-95 border-amber-300 bg-amber-700/70 text-white' : 'border-white/40 bg-black/55 text-white/90'
            }`}
            onPointerDown={(e) => capture(e, axeBtn ? 'axe' : 'fire')}
            onPointerUp={(e) => release(e, axeBtn ? 'axe' : 'fire')}
            onPointerCancel={(e) => release(e, axeBtn ? 'axe' : 'fire')}
            onContextMenu={(e) => e.preventDefault()}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
              {axeBtn && (
                <circle
                  cx="50" cy="50" r="44" fill="none"
                  stroke={hud.overcharge > 0 ? '#ef4444' : charge > 0.85 ? '#fbbf24' : '#f97316'}
                  strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={ringDash}
                  strokeDashoffset={ringDash * (1 - charge)}
                />
              )}
              {hud.weapon === 'pistol' && (
                <circle cx="50" cy="50" r="44" fill="none" stroke="#eab308" strokeWidth="3"
                  strokeDasharray={ringDash} strokeDashoffset={ringDash * (1 - hud.ammo / 15)} />
              )}
              {hud.weapon === 'shotgun' && (
                <circle cx="50" cy="50" r="44" fill="none" stroke="#f97316" strokeWidth="3"
                  strokeDasharray={ringDash} strokeDashoffset={ringDash * (1 - hud.shells / 6)} />
              )}
            </svg>
            <span className="pointer-events-none px-1 drop-shadow">
              {axeBtn
                ? stuck ? 'ДЁРГАЙ!' : left ? 'ВЗЯТЬ ТОПОР' : axePress ? (hud.overcharge > 0 ? 'ПЕРЕТЯНУЛ' : charge > 0.85 ? 'БЕЙ!' : 'ЗАМАХ…') : 'ТОПОР'
                : firePress ? 'ОГОНЬ' : hud.weapon === 'shotgun' ? 'ДРОБОВИК' : 'ПИСТОЛЕТ'}
            </span>
            {axePress && axeBtn && !stuck && (
              <div className="pointer-events-none absolute h-3 w-3 rounded-full bg-white shadow" style={{ transform: `translate(${steer.x * 40}px, ${steer.y * 40}px)` }} />
            )}
          </button>
          {/* переключатель оружия */}
          <button
            className="rounded-full border border-white/30 bg-black/50 px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-white/70 active:scale-95"
            onPointerDown={() => game.cycleWeapon()}
          >
            {hud.weapon === 'axe' ? '→ пистолет' : hud.weapon === 'pistol' ? '→ дробовик' : '→ топор'}
          </button>
        </div>
      </div>)}

      {inCar && <DriveControls game={game} hud={hud} />}

      {/* вход/выход из машины */}
      {hud.nearCar && !inCar && (
        <button
          className="enter-vehicle absolute left-1/2 top-16 z-30 -translate-x-1/2 border px-6 py-3 text-xs font-bold uppercase tracking-widest shadow-xl active:scale-95"
          onClick={() => game.interact()}
        >
          {hud.nearEmergency === 'fire' ? 'пожарная машина' : hud.nearEmergency === 'ambulance' ? 'скорая помощь' : 'сесть в машину'}
        </button>
      )}
    </div>
  );
}
