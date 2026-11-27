import { useEffect, useRef } from 'react';
import type { HudState } from '../game/Game';
import { formatDistance, routeDistance, locationName } from '../game/city-plan';
import { paintRadar, MapIcon, type RadarFrame } from './CityMap';

export interface Drop { id: number; x: number; y: number; s: number; r: number }

interface Props {
  hud: HudState;
  drops: Drop[];
  hurt: number;
  log: { text: string; id: number } | null;
  radar: RadarFrame | null;
  onMap: () => void;
  mapEnabled: boolean;
}

function Bar({ value, color, label, icon }: { value: number; color: string; label: string; icon: string }) {
  return <div className="vital-row"><span className="vital-symbol">{icon}</span><div className="vital-track"><div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div><span className="vital-label">{label}</span></div>;
}

export function HUD({ hud, drops, hurt, log, radar, onMap, mapEnabled }: Props) {
  const stuck = hud.axeState === 'stuck';
  const left = hud.axeState === 'left';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !radar) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    paintRadar(ctx, cv, radar);
  }, [radar]);

  return (
    <div className="game-hud pointer-events-none absolute inset-0">
      <div className="hud-edge-shade" />
      <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: hurt, background: 'radial-gradient(ellipse at center, transparent 40%, rgba(130,20,12,0.65) 100%)' }} />
      {hud.hp < 35 && <div className="low-health" />}
      {drops.map(d => <div key={d.id} className="blood-drop absolute" style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s * 1.3 }} />)}
      {!hud.inCar && <div className={`reticle ${hud.ads ? 'aiming' : ''}`} />}
      <div className="hud-vitals">
        {hud.sprinting && <div className="sprint-tag">БЕГ</div>}
        <Bar value={hud.hp} color="#bb7465" label="ЗДОРОВЬЕ" icon="+" />
        <Bar value={hud.stamina} color="#c6cbb1" label="СИЛЫ" icon="/" />
        {hud.weapon === 'axe' && <Bar value={hud.sharpness * 100} color="#bea77d" label="ЛЕЗВИЕ" icon="|" />}
        <div className="hud-level">УРОВЕНЬ {hud.level}<span>{hud.kills} УСТРАНЕНО</span></div>
        <div className={`hud-stance ${hud.stance}`}>{hud.stance === 'stand' ? 'СТОЯ' : hud.stance === 'crouch' ? 'ПРИСЕЛ' : 'ПОЛЗКОМ'}</div>
      </div>
      <button type="button" className="hud-radar" onClick={onMap} disabled={!mapEnabled} aria-label="Открыть карту города" title="Карта города (M)">
        <canvas ref={canvasRef} width={184} height={184} /><span>N</span><i><MapIcon name="map" size={12} /></i>
      </button>
      {radar?.destination && <div className="hud-route" aria-live="off"><MapIcon name="pin" size={14} /><span><b>{locationName(radar.destination)}</b><small>{formatDistance(routeDistance(radar.route))}</small></span></div>}
      <div className="hud-environment"><div className="hud-clock">{hud.clock}</div><div>{hud.raining ? 'ДОЖДЬ' : hud.night > 0.5 ? 'НОЧЬ' : hud.district}{hud.cloud > 0.32 ? ' · ОБЛАЧНО' : ''}</div>
        <small className="hud-station-name">{hud.station ? `♪ ${hud.station}` : ''}</small>
        {hud.weapon !== 'axe' && !hud.inCar && <p className="hud-ammo"><strong>{hud.weapon === 'shotgun' ? hud.shells : hud.ammo}</strong><span>/ {hud.weapon === 'shotgun' ? hud.shellReserve : hud.reserve}</span></p>}
        {hud.reloading && <span className="reload-status">ПЕРЕЗАРЯДКА</span>}
        {hud.inCar && (hud.carEngine > 0.05 || hud.carTires > 0.05) && <div className="car-condition"><span>ДВС {Math.round((1 - hud.carEngine) * 100)}%</span><span>ШИНЫ {Math.round((1 - hud.carTires) * 100)}%</span></div>}
      </div>
      {hud.wanted > 0 && <div className="hud-wanted">{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < hud.wanted ? 'on' : ''}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6 7 .9-5 5 .9 7-5.9-3-5.9 3 .9-7-5-5L9 8z" /></svg></span>)}</div>}
      {hud.dispatch && <div className="dispatch-banner"><span>СЛУЖБЫ</span>{hud.dispatch}</div>}
      {hud.fires > 0 && <div className="fire-alert"><i />{hud.fires} {hud.fires === 1 ? 'ВОЗГОРАНИЕ' : 'ВОЗГОРАНИЯ'}<small>пожарная часть выехала</small></div>}
      {hud.nearEmergency && !hud.inCar && <div className="emergency-hint">{hud.nearEmergency === 'fire' ? 'ПОЖАРНАЯ МАШИНА' : 'СКОРАЯ ПОМОЩЬ'} · можно сесть за руль</div>}
      {log && <div key={log.id} className="hit-log hud-log">{log.text}</div>}
      {(stuck || left) && <div className="axe-notice"><strong>{stuck ? 'ТОПОР ЗАСТРЯЛ' : 'ТОПОР ОСТАЛСЯ ПОЗАДИ'}</strong><span>{stuck ? 'Нажимай кнопку удара, чтобы вытащить' : 'Вернись за своим оружием'}</span></div>}
    </div>
  );
}
