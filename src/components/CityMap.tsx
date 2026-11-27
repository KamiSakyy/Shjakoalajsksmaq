import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BLOCK, BOUNDS, BUILDINGS, CITY_PLAN, COAST, LANDMARKS, ROAD_LINES, START, cityRoute, distance, formatDistance, locationName, routeDistance, streetPoint, type LandmarkKind, type Point } from '../game/city-plan';

export interface MapBlip extends Point { c: string; r: number }
export interface RadarFrame extends Point { yaw: number; blips: MapBlip[]; route: Point[]; destination: Point | null }

const parkMarks = CITY_PLAN.filter(p => p.kind === 'park' || p.kind === 'plaza' || p.kind === 'stadium' || p.kind === 'college');

const pinPaths: Record<LandmarkKind, string> = {
  plaza: 'M6 17h12M9 14h6M12 5v9m-5-4c0-3 5-3 5 0m0 0c0-3 5-3 5 0',
  park: 'm12 4-6 8h4l-4 4h12l-4-4h4l-6-8Zm0 12v4',
  garage: 'm7 17 5-5a5 5 0 0 0 6-6l-3 3-2-2 3-3a5 5 0 0 0-6 6l-5 5a1.5 1.5 0 0 0 2 2Z',
  station: 'M12 4l6 3v5c0 3-2.5 5.5-6 8-3.5-2.5-6-5-6-8V7l6-3Z',
  coast: 'M4 11c3 0 3-2 5-2 2.5 0 3 2 5 2s2.5-2 6-2M4 16c3 0 3-2 5-2 2.5 0 3 2 5 2s2.5-2 6-2',
  market: 'M5 10h14l-2-5H7l-2 5Zm2 0v9h10v-9m-7 9v-5h4v5',
  hospital: 'M5 20V4h14v16M9 8h6m-3-3v6M9 16h6',
  fire: 'm9 20c-3-2-4-5-2-8 1-2 3-3 3-5 3 2 6 5 6 9 0 3-2 5-5 5 2-2 2-4 1-5-1 2-2 3-3 4Zm.5-1.5c-.6-1.2 0-2.4 1-3.2.5 1.2 1.6 2 1.6 3.2a1.4 1.4 0 0 1-2.6 0Z',
  bank: 'M4 9 12 4l8 5H4Zm2 2h2v6H6v-6Zm5 0h2v6h-2v-6Zm5 0h2v6h-2v-6ZM4 18h16M3 21h18',
  hotel: 'M4 21V5h10v16M14 11h6v10M7 8h4M7 12h4M7 16h4M17 14h2M17 18h2',
  diner: 'M5 12h14a7 7 0 0 1-14 0Zm7-7v5m-7 9h14M8 2v1m8-1v1',
  stadium: 'M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7-9-3-9-7Zm4 0c0-2 2.3-3.5 5-3.5s5 1.5 5 3.5-2.3 3.5-5 3.5S7 14 7 12Z',
  marina: 'M4 13h16l-8 8-8-8Zm8 0V4m-3 2h6m-3 1 4 4',
  college: 'M3 9 12 4l9 5-9 5-9-5Zm3 3v5c3 2 9 2 12 0v-5m3 0v7',
  gas: 'M6 21V4h8v17H6Zm2-9h4M3 21h14M14 7h3l2 3v8a1.5 1.5 0 0 1-3 0v-5',
};

export function MapIcon({ name, size = 20 }: { name: LandmarkKind | 'map' | 'center' | 'plus' | 'minus' | 'arrow' | 'pin'; size?: number }) {
  const paths = { ...pinPaths, map: 'm3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14', center: 'M12 3v4m0 10v4M3 12h4m10 0h4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
    plus: 'M5 12h14m-7-7v14', minus: 'M5 12h14', arrow: 'M4 12h15m-6-6 6 6-6 6', pin: 'M18 9c0 4-6 10-6 10S6 13 6 9a6 6 0 1 1 12 0ZM12 9h.01' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function paintRadar(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, radar: RadarFrame) {
  const side = cv.width, half = side / 2, scale = side / 142;
  ctx.clearRect(0, 0, side, side);
  ctx.save();
  ctx.translate(half, half);
  ctx.beginPath(); ctx.arc(0, 0, half - 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#192422'; ctx.fillRect(-half, -half, side, side);
  const x = (p: number) => (p - radar.x) * scale, y = (p: number) => (p - radar.z) * scale;
  ctx.fillStyle = '#243c42'; ctx.fillRect(x(COAST), -half, side, side);
  for (const p of parkMarks) {
    ctx.fillStyle = p.kind === 'park' ? '#344533' : '#3d3d33';
    const w = (BLOCK - 18) * scale;
    ctx.fillRect(x(p.x) - w / 2, y(p.z) - w / 2, w, w);
  }
  ctx.fillStyle = '#4c544f';
  for (const b of BUILDINGS) {
    if (Math.abs(b.x - radar.x) > 103 || Math.abs(b.z - radar.z) > 103) continue;
    ctx.fillRect(x(b.x - b.w / 2), y(b.z - b.d / 2), b.w * scale, b.d * scale);
  }
  ctx.strokeStyle = '#8d998966'; ctx.lineWidth = 2;
  ctx.beginPath();
  ROAD_LINES.forEach(line => {
    ctx.moveTo(x(line), y(-BOUNDS)); ctx.lineTo(x(line), y(BOUNDS));
    ctx.moveTo(x(-BOUNDS), y(line)); ctx.lineTo(x(BOUNDS), y(line));
  });
  ctx.stroke();
  if (radar.route.length) {
    ctx.lineWidth = 4.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#f4b38b';
    ctx.beginPath(); radar.route.forEach((p, i) => i ? ctx.lineTo(x(p.x), y(p.z)) : ctx.moveTo(x(p.x), y(p.z))); ctx.stroke();
    const p = radar.destination;
    if (p) {
      const dx = x(p.x), dy = y(p.z), factor = Math.min(1, (half - 8) / Math.max(1, Math.hypot(dx, dy)));
      ctx.fillStyle = '#ffbe98'; ctx.fillRect(dx * factor - 3.6, dy * factor - 3.6, 7.2, 7.2);
    }
  }
  for (const b of radar.blips) {
    if (Math.hypot(x(b.x), y(b.z)) > half - 4) continue;
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x(b.x), y(b.z), b.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.rotate(-radar.yaw);
  ctx.fillStyle = '#f3f0da'; ctx.strokeStyle = '#101a16'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
}

interface Props {
  radar: RadarFrame | null;
  destination: Point | null;
  onDestination: (point: Point | null) => void;
  onReturn: () => void;
}

export function CityMap({ radar, destination, onDestination, onReturn }: Props) {
  const origin = radar ?? { ...START, yaw: 0, blips: [] };
  const [selected, setSelected] = useState<Point | null>(destination);
  const [view, setView] = useState({ x: 0, z: 0, zoom: 0.67 });
  const [size, setSize] = useState({ width: 745, height: 702 });
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, panX: 0, panY: 0 });
  const activeLocation = LANDMARKS.find(l => selected && distance(l, selected) < 4);
  const plot = selected ? cityRoute(origin, selected) : [];
  const selectedIsSet = selected !== null && destination !== null && distance(selected, destination) < 1;
  const w = 745 / view.zoom, h = 702 / view.zoom;

  const screenPoint = (x: number, y: number) => {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return { x: 0, z: 0 };
    const p = element.createSVGPoint(); p.x = x; p.y = y;
    const v = p.matrixTransform(matrix.inverse());
    return { x: v.x, z: v.y };
  };

  const zoom = (by: number, center?: Point) => setView(v => {
    const zoom = Math.max(0.6, Math.min(5.5, v.zoom * by));
    const k = 1 - v.zoom / zoom;
    return center ? { zoom, x: v.x + (center.x - v.x) * k, z: v.z + (center.z - v.z) * k } : { ...v, zoom };
  });

  useEffect(() => {
    const map = svg.current;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(Math.max(-180, Math.min(180, -e.deltaY)) * 0.0025), screenPoint(e.clientX, e.clientY)); };
    map?.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(entries => { const rect = entries[0].contentRect; setSize({ width: rect.width, height: rect.height }); });
    if (map) resize.observe(map);
    return () => { map?.removeEventListener('wheel', wheel); resize.disconnect(); };
  }, []);

  const startPan = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!pointers.current.size) gesture.current = { moved: false, panX: 0, panY: 0 };
    if (pointers.current.size) gesture.current.moved = true;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movePan = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const curr = { x: e.clientX, y: e.clientY };
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      const oldGap = Math.hypot(prev.x - other.x, prev.y - other.y);
      if (oldGap > 3) zoom(Math.hypot(curr.x - other.x, curr.y - other.y) / oldGap, screenPoint((curr.x + other.x) / 2, (curr.y + other.y) / 2));
    } else {
      const deltaX = curr.x - prev.x, deltaY = curr.y - prev.y;
      gesture.current.panX += deltaX; gesture.current.panY += deltaY;
      if (Math.hypot(gesture.current.panX, gesture.current.panY) > 6) gesture.current.moved = true;
      if (gesture.current.moved) {
        const a = screenPoint(prev.x, prev.y), b = screenPoint(curr.x, curr.y);
        setView(v => ({ ...v, x: Math.max(-410, Math.min(430, v.x + a.x - b.x)), z: Math.max(-380, Math.min(380, v.z + a.z - b.z)) }));
      }
    }
    pointers.current.set(e.pointerId, curr);
  };
  const endPan = (e: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    if (!pointers.current.delete(e.pointerId) || cancelled || gesture.current.moved) return;
    const p = screenPoint(e.clientX, e.clientY);
    if (Math.abs(p.x) > COAST + 2 || Math.abs(p.z) > BOUNDS + 14) return;
    setSelected(LANDMARKS.find(l => distance(l, p) < 18 / view.zoom) ?? streetPoint(p));
  };

  return <div className="atlas-layout">
    <div className="atlas-stage">
      <svg ref={svg} className="atlas-map" viewBox={`${view.x - w / 2} ${view.z - h / 2} ${w} ${h}`} aria-label="Карта улиц Пасифика" role="img"
        onPointerDown={startPan} onPointerMove={movePan} onPointerUp={e => endPan(e)} onPointerCancel={e => endPan(e, true)}>
        <defs>
          <pattern id="atlas-grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0v26" fill="none" stroke="#adb9a5" opacity=".13" strokeWidth=".48" /></pattern>
          <pattern id="atlas-sea" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0h14" stroke="#8ba8aa" strokeOpacity=".22" strokeWidth="1.1" /></pattern>
          <linearGradient id="atlas-water"><stop stopColor="#244140"/><stop offset="1" stopColor="#172b31"/></linearGradient>
        </defs>
        <rect x="-1000" y="-1000" width="2000" height="2000" fill="#1d2823" />
        <rect x={COAST} y="-1000" width="1000" height="2000" fill="url(#atlas-water)" />
        <rect x={COAST} y="-1000" width="1000" height="2000" fill="url(#atlas-sea)" />
        <rect x="-1000" y="-1000" width="2000" height="2000" fill="url(#atlas-grid)" />
        <rect x={-BOUNDS - 10} y={-BOUNDS - 10} width={BOUNDS * 2 + 20} height={BOUNDS * 2 + 20} rx="3" fill="#2c3730" stroke="#5a6a5a" strokeWidth="1.1" />
        <path d={`M${COAST} -350 V350`} stroke="#9aac96" opacity=".6" strokeWidth="2" />
        <rect x={COAST} y="103.5" width="46" height="7" fill="#657769" stroke="#a5ad94" strokeWidth=".8" />
        {parkMarks.map(p => <g key={`${p.x}-${p.z}`}><rect x={p.x - 28} y={p.z - 28} width="56" height="56" rx="3" fill={p.kind === 'park' ? '#374b39' : '#4c483a'} />
          <path d={`M${p.x - 24} ${p.z}h48m-24-24v48`} stroke="#8a9475" opacity=".35" strokeWidth="1.2" /></g>)}
        {BUILDINGS.map(b => <rect key={`${b.x}-${b.z}`} x={b.x - b.w / 2} y={b.z - b.d / 2} width={b.w} height={b.d} fill={b.tower ? '#697268' : '#505c50'} stroke="#768072" strokeWidth=".45" rx=".6" />)}
        <g fill="none" strokeLinecap="square">{ROAD_LINES.map(line => <g key={line}><path d={`M${-BOUNDS} ${line} H${BOUNDS} M${line} ${-BOUNDS} V${BOUNDS}`} stroke={line === 0 ? '#909783' : '#657368'} strokeWidth="9" /><path d={`M${-BOUNDS} ${line} H${BOUNDS} M${line} ${-BOUNDS} V${BOUNDS}`} stroke="#293530" strokeWidth="6.8" /></g>)}</g>
        <g className="atlas-districts" fill="#a8afa0" textAnchor="middle">
          <text x={-BOUNDS * 0.55} y={-BOUNDS * 0.62}>ДАУНТАУН</text><text x={-BOUNDS * 0.76} y={-BOUNDS * 0.12}>УЭСТСАЙД</text><text x={-78} y={115}>САНСЕТ</text>
          <text x={75} y={10}>ПАСИФИК</text><text x={BOUNDS * 0.86} y={BOUNDS * 0.7}>БЭЙФРОНТ</text><text x={-BOUNDS * 0.72} y={BOUNDS * 0.56}>ОЛД-ТАУН</text>
          <text x={-100} y={BOUNDS * 0.83}>ЮЖНЫЙ ПАСИФИК</text><text x={BOUNDS * 0.9} y={-60} className="atlas-water-label" transform={`rotate(90 ${BOUNDS * 0.9} -60)`}>ЗАЛИВ ПАСИФИК</text>
        </g>
        {plot.length > 1 && <g fill="none" strokeLinejoin="round" strokeLinecap="round"><polyline points={plot.map(p => `${p.x},${p.z}`).join(' ')} stroke="#111a16" strokeWidth={6 / Math.sqrt(view.zoom)} /><polyline points={plot.map(p => `${p.x},${p.z}`).join(' ')} stroke="#f1aa7d" strokeWidth={3.5 / Math.sqrt(view.zoom)} /></g>}
        {radar?.blips.map((b, i) => <circle key={i} cx={b.x} cy={b.z} r="1.9" fill={b.c} opacity=".8" />)}
        {LANDMARKS.map(p => <g key={p.id} transform={`translate(${p.x} ${p.z}) scale(${1 / Math.sqrt(view.zoom)})`}>
          <circle r="11.6" fill={activeLocation?.id === p.id ? '#e4a27c' : '#1e2c26'} stroke={activeLocation?.id === p.id ? '#f7c9a7' : '#98a68d'} strokeWidth="1.15" />
          <path d={pinPaths[p.id]} transform="translate(-9 -9) scale(.75)" fill="none" stroke={activeLocation?.id === p.id ? '#243023' : '#d4d9c8'} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        </g>)}
        {selected && !activeLocation && <path d="M0-8 8 0 0 8-8 0Z" transform={`translate(${selected.x} ${selected.z}) scale(${1 / Math.sqrt(view.zoom)})`} fill="#e4a27c" stroke="#17221c" strokeWidth="1.5" />}
        <g transform={`translate(${origin.x} ${origin.z}) rotate(${-origin.yaw * 180 / Math.PI}) scale(${1 / Math.sqrt(view.zoom)})`}>
          <circle r="12" fill="#a6c8b2" opacity=".19" /><path d="M0-8.5 6.7 6 0 3.4-6.7 6Z" fill="#eaf3db" stroke="#16231f" strokeWidth="1.5" />
        </g>
      </svg>
      <div className="atlas-orientation" aria-hidden="true"><b>N</b><span /></div>
      <div className="atlas-zoom">
        <button type="button" onClick={() => zoom(1.35)} aria-label="Приблизить карту"><MapIcon name="plus" size={17} /></button>
        <button type="button" onClick={() => zoom(1 / 1.35)} aria-label="Отдалить карту"><MapIcon name="minus" size={17} /></button>
        <button type="button" onClick={() => setView({ x: origin.x, z: origin.z, zoom: 2.2 })} aria-label="Центрировать на игроке"><MapIcon name="center" size={17} /></button>
      </div>
      <div className="atlas-scale" aria-hidden="true"><div style={{ width: `${50 * Math.min(size.width / w, size.height / h)}px` }} />50 м</div>
      <div className="atlas-tip">Нажми на улицу, чтобы поставить метку</div>
    </div>
    <div className="atlas-directory">
      <div className="atlas-list-title"><span>МЕСТА ГОРОДА</span><span>{String(LANDMARKS.length).padStart(2, '0')}</span></div>
      <div className="atlas-place-list">
        {LANDMARKS.map(p => <button type="button" key={p.id} aria-pressed={activeLocation?.id === p.id} onClick={() => { setSelected(p); if (view.zoom > 1.4) setView(v => ({ ...v, x: p.x, z: p.z })); }}>
          <span className="atlas-place-icon"><MapIcon name={p.id} size={18} /></span><span><strong>{p.name}</strong><small>{p.district}</small></span>
          <span className="atlas-place-distance">{formatDistance(distance(origin, p))}</span>
        </button>)}
      </div>
      <div className="atlas-trip">
        {selected ? <><div className="atlas-trip-row"><span>{activeLocation?.name ?? `Метка · ${locationName(selected)}`}</span><b>{formatDistance(routeDistance(plot))}</b></div><p>{activeLocation?.description ?? 'Маршрут рассчитан по ближайшим улицам.'}</p></> : <p>Выбери место или точку на карте. Маршрут появится на мини-карте.</p>}
        <button type="button" className="launch-button atlas-route-button" disabled={!selected} onClick={() => { if (selectedIsSet) onReturn(); else if (selected) onDestination(selected); }}>
          {selectedIsSet ? (radar ? 'ВЕРНУТЬСЯ В ГОРОД' : 'К ГЛАВНОМУ МЕНЮ') : 'ПРОЛОЖИТЬ МАРШРУТ'}<MapIcon name={selectedIsSet ? 'pin' : 'arrow'} size={19} />
        </button>
        {destination && <button type="button" className="atlas-clear" onClick={() => { setSelected(null); onDestination(null); }}>Снять метку</button>}
      </div>
    </div>
  </div>;
}