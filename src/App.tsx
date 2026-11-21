import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, type GameEvent, type HudState, type GameMode, type WeatherMode, type Quality } from './game/Game';
import { audio } from './game/audio';
import { preloadCharacterAssets } from './game/characters';
import { Controls } from './components/Controls';
import { HUD, type Drop } from './components/HUD';
import { CharacterViewer } from './components/CharacterViewer';
import { CityMap, MapIcon, type RadarFrame } from './components/CityMap';
import type { Point } from './game/city-plan';
import { LoadingScreen, loadingTips } from './components/LoadingScreen';
import { Phone } from './components/Phone';
import { RELEASE_NOTES } from './game/release-notes';
import { WORLD_SEED, worldSignature } from './game/worldgen';

const initialHud: HudState = {
  hp: 100, stamina: 100, sharpness: 1, kills: 0, charge: 0, overcharge: 0, axeState: 'idle', pullProgress: 0,
  zombiesAlive: 0, civiliansAlive: 0, gameOver: false, lastHit: '', weapon: 'axe', ammo: 15, reserve: 90,
  reloading: false, clock: '16:48', night: 0, inCar: false, speed: 0, heat: 0, nearCar: false, ads: false, fps: 60,
  wanted: 0, shells: 6, shellReserve: 24, raining: false, level: 1, xp: 0, carCam: 0, onFootCam: false, station: 'Пасифик FM', sprinting: false,
  gear: 'P', carHealth: 100, district: 'Пасифик-центр', serviceAvailable: false,
  stance: 'stand', fires: 0, dispatch: '', cloud: 0, nearEmergency: null, carEngine: 0, carTires: 0,
  cash: 420, bank: 1250, questTitle: '', questObjective: '', questProgress: '', questReward: 0,
  photos: 0, heliActive: false, tankActive: false, nearLoot: false, robbed: 0, qualityTier: 'Авто', fpsScale: 100,
  combo: 0, comboTimer: 0, bloodScreen: 0, killCam: 0,
  packages: 0, packagesTotal: 0, raceActive: false, raceGate: '', raceTime: 0, interact: null, skirt: 'stand',
  molotovs: 3, grenades: 2, throwKind: 'molotov', parkour: 'none', height: 0, hitMarker: 0, hitHead: false, armor: 0, armorMax: 100,
  mode: 'normal', peers: 0, world: '00000000', phoneOpen: false,
  axeName: 'Аварийный топор', axeShort: 'АВАРИЙНЫЙ',
};
type Panel = 'settings' | 'controls' | 'characters' | 'about' | 'map' | null;
const WORLD_SIG = worldSignature({ seed: WORLD_SEED, v: 3 });

const modes: { id: GameMode; name: string; text: string; number: string }[] = [
  { id: 'peace', name: 'Мирный режим', text: 'Только люди. Полиция не гоняется, никто не сопротивляется — можно спокойно убивать.', number: '01' },
  { id: 'normal', name: 'Обычный режим', text: 'Как во всех GTA: живой город, розыск, погони и перестрелки.', number: '02' },
  { id: 'zombie', name: 'Зомби-апокалипсис', text: 'Ходоки, бегуны, прыгуны, кровососы. Люди-сталкеры и группировки — как в «Зове Припяти».', number: '03' },
];

function Icon({ name, size = 20 }: { name: 'arrow' | 'settings' | 'sound' | 'mute' | 'close' | 'pause' | 'play' | 'axe' | 'full' | 'exitfull' | 'radio' | 'phone'; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="2.5" /><circle cx="16" cy="17" r="2.5" /></>,
    sound: <><path d="M4 9v6h4l5 4V5L8 9H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 5 5m0-5-5 5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    pause: <><path d="M8 5v14m8-14v14" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    axe: <><path d="m6 21 10-18m-4 6 5 3 5-3-1-6-6-1-3 7Z" /></>,
    full: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
    exitfull: <><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></>,
    radio: <><path d="M4 9h16v10H4zM8 9l9-5M8 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" /></>,
    phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.4" /><path d="M10.5 18.6h3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [load, setLoad] = useState({ progress: 0, stage: 'Подготовка', tip: loadingTips[0] });
  const [error, setError] = useState('');
  const [hud, setHud] = useState(initialHud);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [hurt, setHurt] = useState(0);
  const [log, setLog] = useState<{ text: string; id: number } | null>(null);
  const [radar, setRadar] = useState<RadarFrame | null>(null);
  const [plannedDestination, setPlannedDestination] = useState<Point | null>(() => {
    try {
      const point = JSON.parse(sessionStorage.getItem('pacific-destination') ?? 'null');
      if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) return { x: point.x, z: point.z };
    } catch { /* Session storage can be unavailable in embedded browsers. */ }
    return null;
  });
  const [mode, setMode] = useState<GameMode>('normal');
  const [quality, setQuality] = useState<Quality>('auto');
  const [phone, setPhone] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [toasts, setToasts] = useState<{ id: number; title: string; body: string }[]>([]);
  const [, setQuestVersion] = useState(0);
  const [timeOfDay, setTimeOfDay] = useState(16.8);
  const [weather, setWeather] = useState<WeatherMode>('auto');
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [paused, setPaused] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const eventId = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const onEvent = useCallback((e: GameEvent) => {
    if (e.type === 'splash') {
      const fresh = Array.from({ length: Math.min(9, Math.round(2 + e.amount * 5)) }, () => ({
        id: ++eventId.current, x: 8 + Math.random() * 84, y: 8 + Math.random() * 70,
        s: 10 + Math.random() * 25 * e.amount, r: Math.random() * 40,
      }));
      setDrops(d => [...d.slice(-20), ...fresh]);
      const ids = new Set(fresh.map(x => x.id));
      timers.current.push(setTimeout(() => setDrops(d => d.filter(x => !ids.has(x.id))), 4500));
    } else if (e.type === 'hurt') {
      setHurt(0.8); timers.current.push(setTimeout(() => setHurt(0), 350));
    } else {
      const id = ++eventId.current;
      setLog({ text: e.text, id });
      timers.current.push(setTimeout(() => setLog(l => l?.id === id ? null : l), 2200));
    }
  }, []);

  useEffect(() => {
    void preloadCharacterAssets();
    return () => { gameRef.current?.dispose(); timers.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      const g = gameRef.current;
      if (!g || g.paused) return;
      const blips: RadarFrame['blips'] = [];
      g.npcs.forEach(n => {
        if (n.alive && n.position().distanceTo(g.pos) < 80) blips.push({ x: n.position().x, z: n.position().z, c: n.kind === 'zombie' ? '#d98154' : '#bcc7a7', r: n.kind === 'zombie' ? 3 : 2 });
      });
      g.traffic.cars.forEach(c => { if (c.pos.distanceTo(g.pos) < 80) blips.push({ x: c.pos.x, z: c.pos.z, c: '#91b9ba', r: 2 }); });
      g.police.officers.forEach(o => { if (o.state !== 'dead') blips.push({ x: o.pos.x, z: o.pos.z, c: '#84a9cf', r: 3 }); });
      g.items.list.forEach(i => { if (!i.taken && i.mesh.position.distanceTo(g.pos) < 50) blips.push({ x: i.mesh.position.x, z: i.mesh.position.z, c: '#dbb36d', r: 2 }); });
      setRadar({ x: g.pos.x, z: g.pos.z, yaw: g.vehicle ? Math.PI - g.vehicle.yaw : g.yaw, blips, destination: g.destination, route: g.route });
    }, 200);
    return () => clearInterval(id);
  }, [started]);

  useEffect(() => {
    gameRef.current?.setPaused(paused || panel !== null || phone);
    if (paused || panel || phone) document.exitPointerLock?.();
    if (audio.ctx && audio.master) audio.master.gain.setTargetAtTime(muted || paused || panel ? 0 : 0.7, audio.ctx.currentTime, 0.15);
    if (panel) dialogRef.current?.focus();
  }, [paused, panel, muted, phone]);

  // телефон поднимается в руке, пока открыт интерфейс
  useEffect(() => { game?.setPhoneOpen(phone); }, [phone, game]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && !e.repeat && started) setPanel(p => p === 'map' ? null : 'map');
      if ((e.code === 'KeyP' || e.code === 'Tab') && !e.repeat && started && !panel) { e.preventDefault(); setPhone(v => !v); }
      if (e.key === 'Escape') {
        if (phone) setPhone(false);
        else if (panel) setPanel(null);
        else if (started) setPaused(p => !p);
      }
      if (e.key === 'Tab' && panel && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href]'));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const blur = () => { if (started) setPaused(true); };
    window.addEventListener('keydown', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); };
  }, [panel, started, phone]);

  // Fullscreen: browsers only allow it after a user gesture, so every first tap/key re-requests it
  // until the page is fullscreen. The toggle button is always available as a fallback.
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    const lockLandscape = () => { try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not supported */ } };
    const enter = () => {
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      document.documentElement.requestFullscreen().then(lockLandscape).catch(() => {});
    };
    document.addEventListener('fullscreenchange', sync);
    window.addEventListener('pointerdown', enter, { passive: true });
    window.addEventListener('keydown', enter);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      window.removeEventListener('pointerdown', enter);
      window.removeEventListener('keydown', enter);
    };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
    document.documentElement.requestFullscreen?.().then(() => (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {})).catch(() => {});
  };
  const cycleRadio = () => gameRef.current?.radioCycle();

  const start = async () => {
    if (loading || !canvasRef.current) return;
    setLoading(true); setError('');
    const stage = (progress: number, text: string) => setLoad({ progress, stage: text, tip: loadingTips[Math.floor(Math.random() * loadingTips.length)] });
    try {
      stage(6, 'Запуск звукового движка');
      audio.init();
      if (audio.ctx) audio.master.gain.value = muted ? 0 : 0.7;
      await new Promise(resolve => setTimeout(resolve, 90));
      stage(18, 'Загрузка лиц и материалов персонажей');
      await preloadCharacterAssets();
      stage(34, 'Генерация 144 кварталов и 15 районов');
      await new Promise(resolve => setTimeout(resolve, 90));
      gameRef.current?.dispose();
      stage(48, 'Строим улицы, заведения и набережную');
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      const g = new Game(canvasRef.current, quality);
      g.onHud = setHud; g.onEvent = onEvent;
      g.onNotify = n => {
        setToasts(t => [...t.slice(-3), { id: n.id, title: n.title, body: n.body }]);
        window.setTimeout(() => setToasts(t => t.filter(x => x.id !== n.id)), 4200);
      };
      g.onQuestChange = () => setQuestVersion(v => v + 1);
      g.onWallet = () => setQuestVersion(v => v + 1);
      stage(79, 'Расставляем трафик и пешеходов');
      g.setMode(mode); g.setQuality(quality); g.dayNight.setTime(timeOfDay);
      g.setWeather(weather, true);
      stage(88, 'Экстренные службы на дежурстве');
      await new Promise(resolve => setTimeout(resolve, 70));
      gameRef.current = g; setGame(g);
      (window as Window & { __game?: Game }).__game = g;
      setHud(initialHud); setDrops([]); setPaused(false);
      g.setDestination(plannedDestination);
      stage(96, 'Синхронизация городских систем');
      await new Promise(resolve => setTimeout(resolve, 120));
      setStarted(true);
      g.start();
      stage(100, 'Город готов');
      await new Promise(resolve => setTimeout(resolve, 220));
    } catch (e) {
      setError('Не удалось запустить 3D. Попробуйте актуальный Chrome с включённым WebGL.');
      console.error(e);
      setStarted(false);
    } finally { setLoading(false); }
  };

  const leave = () => {
    gameRef.current?.dispose(); gameRef.current = null;
    delete (window as Window & { __game?: Game }).__game;
    setGame(null); setStarted(false); setPaused(false); setPanel(null); setRadar(null); setPhone(false); setPhotos([]);
    audio.stopEngine(); audio.stopSiren();
    if (audio.ctx) audio.master.gain.value = 0;
    document.exitPointerLock?.();
  };
  const setDestination = (p: Point | null) => {
    if (!started) {
      setPlannedDestination(p);
      try { sessionStorage.setItem('pacific-destination', JSON.stringify(p)); } catch { /* Keep the in-memory route. */ }
    }
    else if (gameRef.current) {
      const g = gameRef.current;
      g.setDestination(p);
      setRadar(old => ({ x: g.pos.x, z: g.pos.z, yaw: g.vehicle ? Math.PI - g.vehicle.yaw : g.yaw, blips: old?.blips ?? [], destination: g.destination, route: g.route }));
    }
  };
  const applySettings = () => {
    gameRef.current?.setQuality(quality); gameRef.current?.dayNight.setTime(timeOfDay); gameRef.current?.setWeather(weather);
    setPanel(null);
  };

  return <div className="game-app">
    {loading && <LoadingScreen progress={load.progress} stage={load.stage} tip={load.tip} />}
    <canvas ref={canvasRef} className={`world-canvas ${started ? 'is-visible' : ''}`} aria-label="Игровой мир" />
    {!started && <main className="main-menu">
      <div className="menu-art" />
      <div className="menu-shade" />
      <div className="film-grain" />
      <header className="menu-header">
        <a href="#" className="studio-mark" aria-label="ТОПОР.НОЧЬ, главное меню" onClick={e => { e.preventDefault(); setPanel(null); }}><span className="mark-icon"><Icon name="axe" size={24} /></span><span>ТОПОР<span className="brand-dot">.</span>НОЧЬ</span></a>
        <nav aria-label="Главное меню">
          <button className={!panel ? 'nav-active' : ''} onClick={() => setPanel(null)}>Играть</button>
          <button className={panel === 'map' ? 'nav-active' : ''} onClick={() => setPanel('map')}>Карта</button>
          <button className={panel === 'characters' ? 'nav-active' : ''} onClick={() => setPanel('characters')}>Персонажи</button>
          <button onClick={() => setPanel('controls')}>Управление</button>
        </nav>
        <div className="header-actions"><span className="desktop-note">БРАУЗЕРНАЯ ИГРА</span><button className="icon-button" aria-label={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'} title={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'} onClick={toggleFullscreen}><Icon name={fullscreen ? 'exitfull' : 'full'} /></button><button className="icon-button" aria-label="Настройки" onClick={() => setPanel('settings')}><Icon name="settings" /></button></div>
      </header>
      <section className="menu-content" aria-labelledby="game-title">
        <div className="eyebrow"><span className="orange-line" /> РАЙОН ПАСИФИК</div>
        <h1 id="game-title">ТОПОР<span className="title-dot">.</span><br />НОЧЬ</h1>
        <p className="hero-copy">Открытый город, где у каждой улицы своя история.</p>
        <div className="mode-selector">
          <div className="mode-label">РЕЖИМ ИГРЫ</div>
          <div className="mode-tabs" role="radiogroup" aria-label="Режим игры">
            {modes.map(m => <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'mode-active' : ''} onClick={() => setMode(m.id)}><span className="mode-number">{m.number}</span>{m.name}<span className="mode-indicator" /></button>)}
          </div>
          <p className="mode-description" key={mode}>{modes.find(m => m.id === mode)?.text}</p>
        </div>
        <div className="launch-row"><button className="launch-button" onClick={start} disabled={loading}><span>{loading ? 'ГОТОВИМ ГОРОД' : 'ВОЙТИ В ГОРОД'}</span>{loading ? <span className="loading-ring" /> : <Icon name="arrow" size={25} />}</button><button className="launch-settings" onClick={() => setPanel('map')} aria-label="Карта города"><MapIcon name="map" size={19} /><span>Карта города</span></button></div>
        {error && <p className="launch-error" role="alert">{error}</p>}
        <p className="platform-hint"><span className="key-cap">W A S D</span> или сенсорное управление <span className="hint-dot">/</span> Android · ПК</p>
        <p className="world-note">МИР <b>#{WORLD_SIG}</b> · СТАТИЧНЫЙ, ОДИН ДЛЯ ВСЕХ · ГОТОВ К ОНЛАЙНУ{hud.peers > 0 ? ` · В СЕТИ ${hud.peers}` : ''}</p>
      </section>
      <footer className="menu-footer"><div><span className="live-indicator" /> ОДИНОЧНАЯ ИГРА <span className="footer-slash">/</span> WEST COAST, 2026</div><div className="footer-right"><button onClick={() => setPanel('about')}>Об игре</button><button className="sound-switch" onClick={() => setMuted(m => !m)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}><Icon name={muted ? 'mute' : 'sound'} size={17} /><span>{muted ? 'ЗВУК ВЫКЛ.' : 'ЗВУК ВКЛ.'}</span></button></div></footer>
    </main>}

    {started && game && <>
      <HUD hud={hud} drops={drops} hurt={hurt} log={log} radar={radar} onMap={() => setPanel('map')} onPhone={() => setPhone(true)} mapEnabled={!panel && !paused && !phone && !hud.gameOver} />
      {!paused && !panel && !phone && !hud.gameOver && <Controls game={game} hud={hud} />}
      <button className="pause-button" aria-label="Пауза" onClick={() => setPaused(true)}><Icon name="pause" size={16} /></button>
      <button className="tool-button fs-button" aria-label={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'} onClick={toggleFullscreen}><Icon name={fullscreen ? 'exitfull' : 'full'} size={16} /></button>
      <button className="tool-button radio-button" aria-label="Переключить радио" onClick={cycleRadio}><Icon name="radio" size={16} /></button>
      <button className="tool-button phone-button" aria-label="Телефон (P)" title="Телефон (P)" onClick={() => setPhone(true)}><Icon name="phone" size={17} /></button>
      {toasts.map(t => <div key={t.id} className="phone-toast"><b>{t.title}</b><span>{t.body}</span></div>)}
      {phone && <Phone game={game} hud={hud} onClose={() => setPhone(false)} onOpenMap={() => { setPhone(false); setPanel('map'); }}
        quality={quality} onQuality={q => { setQuality(q); game.setQuality(q); }}
        photos={photos} onPhoto={() => {
          const shot = game.takePhoto();
          if (shot) setPhotos(p => [shot, ...p].slice(0, 8));
        }} />}
    </>}
    {started && paused && !panel && !hud.gameOver && <div className="pause-screen"><div className="pause-content"><div className="eyebrow">ПАУЗА</div><h2>ГОРОД<br />ПОДОЖДЁТ.</h2><button className="launch-button" onClick={() => setPaused(false)}>ПРОДОЛЖИТЬ<Icon name="play" /></button><button className="text-action" onClick={() => setPanel('map')}>Карта города</button><button className="text-action" onClick={() => setPanel('settings')}>Настройки</button><button className="text-action" onClick={() => setPanel('controls')}>Управление</button><button className="text-action muted" onClick={leave}>В главное меню</button></div></div>}
    {started && hud.gameOver && <div className="pause-screen death-screen"><div className="pause-content"><div className="eyebrow">ИСТОРИЯ ЗАКОНЧИЛАСЬ</div><h2>ТЫ МЁРТВ.</h2><p>Заражённых убито: {hud.kills}</p><button className="launch-button" onClick={() => { game?.restart(); setDrops([]); setPaused(false); }}>НАЧАТЬ ЗАНОВО<Icon name="arrow" /></button><button className="text-action" onClick={leave}>В главное меню</button></div></div>}

    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}>
      <div ref={dialogRef} tabIndex={-1} className={`menu-dialog ${panel === 'characters' ? 'model-dialog' : panel === 'map' ? 'atlas-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()}>
        <div className="dialog-header"><div><div className="eyebrow">{panel === 'map' ? 'PACIFIC DISTRICT / НАВИГАЦИЯ' : 'ТОПОР.НОЧЬ'}</div><h2 id="dialog-title">{panel === 'settings' ? 'Настройки' : panel === 'controls' ? 'Как играть' : panel === 'characters' ? 'Лица города' : panel === 'map' ? 'Карта Пасифика' : 'Об игре'}</h2></div><button className="icon-button" aria-label="Закрыть" onClick={() => setPanel(null)}><Icon name="close" size={24} /></button></div>
        {panel === 'characters' && <CharacterViewer />}
        {panel === 'map' && <CityMap radar={started ? radar : null} destination={started ? radar?.destination ?? game?.destination ?? null : plannedDestination} onDestination={setDestination} onReturn={() => setPanel(null)} />}
        {panel === 'settings' && <div className="dialog-body">
          <div className="setting-row"><label>Графика<small>Авто сам держит 60 FPS: разрешение подстраивается, графика остаётся</small></label><div className="segmented four"><button onClick={() => setQuality('auto')} className={quality === 'auto' ? 'active' : ''}>Авто</button><button onClick={() => setQuality('low')} className={quality === 'low' ? 'active' : ''}>Эконом</button><button onClick={() => setQuality('high')} className={quality === 'high' ? 'active' : ''}>Высокое</button><button onClick={() => setQuality('ultra')} className={quality === 'ultra' ? 'active' : ''}>Ультра</button></div></div>
          <div className="setting-row"><label>Время суток<small>После старта время идёт автоматически</small></label><div className="segmented"><button onClick={() => setTimeOfDay(12)} className={timeOfDay === 12 ? 'active' : ''}>День</button><button onClick={() => setTimeOfDay(16.8)} className={timeOfDay === 16.8 ? 'active' : ''}>Закат</button><button onClick={() => setTimeOfDay(22)} className={timeOfDay === 22 ? 'active' : ''}>Ночь</button></div></div>
          <div className="setting-row"><label>Погода<small>В дождь асфальт блестит, а сцепление падает</small></label><div className="segmented">{(['auto', 'clear', 'rain'] as const).map((w, i) => <button key={w} className={weather === w ? 'active' : ''} onClick={() => setWeather(w)}>{['Авто', 'Ясно', 'Дождь'][i]}</button>)}</div></div>
          <div className="setting-row"><label>Звук<small>Окружение, оружие и транспорт</small></label><button className={`toggle ${!muted ? 'on' : ''}`} role="switch" aria-checked={!muted} aria-label="Звук" onClick={() => setMuted(m => !m)}><span /></button></div>
          <button className="launch-button dialog-apply" onClick={applySettings}>ПРИМЕНИТЬ<Icon name="arrow" /></button>
        </div>}
        {panel === 'controls' && <div className="dialog-body control-guide"><p className="guide-lead">Один город. Два способа управления. Удерживай тормоз, чтобы включить задний ход.</p>
          <div className="guide-row"><strong>Движение и обзор</strong><p>На телефоне: слева джойстик, справа обзор. На ПК: <kbd>W A S D</kbd> и мышь.</p></div>
          <div className="guide-row"><strong>Топор и оружие</strong><p>Удерживай кнопку топора для замаха, отпускай для удара. <kbd>E</kbd> сменить оружие, <kbd>R</kbd> перезарядить. Кнопка «Прицел» приближает взгляд.</p></div>
          <div className="guide-row"><strong>За рулём</strong><p><kbd>F</kbd> сесть / выйти. Экранные кнопки: газ, тормоз и руль. Удерживай тормоз на месте для заднего хода. <kbd>Space</kbd> ручник. <kbd>C</kbd> меняет ракурс камеры.</p></div>
          <div className="guide-row"><strong>Стойка и прицел</strong><p>Кнопки «Присесть» и «Ползти» меняют силуэт и точность. Прицел включается одним нажатием, повторное нажатие выключает его. <kbd>C</kbd> переключает камеру, <kbd>Esc</kbd> ставит паузу.</p></div><div className="guide-row"><strong>Огонь и службы</strong><p>Подбей двигатель машины. При возгорании уходи: возможен взрыв. Пожарная машина тушит огонь, скорая помогает раненым.</p></div>
        </div>}
        {panel === 'about' && <div className="dialog-body about-copy"><p>ТОПОР.НОЧЬ: «Район Пасифик» — релизная браузерная 3D-песочница. 144 квартала, 15 заведений, карта атласа, трафик, пешеходы, полиция, пожарная и скорая помощь, огонь, взрывы, погода и физика персонажей.</p><p>Мир статичный и детерминированный: подпись <b>#{WORLD_SIG}</b> одинакова у всех запусков и у всех игроков, поэтому город можно синхронизировать по сети. Снимок состояния — 90 байт на игрока при 20 Гц.</p><div className="release-head"><b>РЕЛИЗНОЕ ОБНОВЛЕНИЕ</b><span>{RELEASE_NOTES.reduce((n, g) => n + g.items.length, 0)} улучшений</span></div><div className="release-notes">{RELEASE_NOTES.map(group => <section key={group.title}><h4>{group.title}</h4><ul>{group.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div><p className="credits">Модель головы: <a href="https://www.triplegangers.com" target="_blank" rel="noreferrer">Lee Perry-Smith / Infinite-Realities</a>, CC BY 3.0. Текстуры асфальта и плитки: Poly Haven, CC0. Иллюстрации меню — художественные, не скриншоты игры.</p></div>}
      </div>
    </div>}
  </div>;
}
