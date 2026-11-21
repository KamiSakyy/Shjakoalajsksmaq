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
  onPhone: () => void;
  mapEnabled: boolean;
}

function Bar({ value, color, label, icon }: { value: number; color: string; label: string; icon: string }) {
  return <div className="vital-row"><span className="vital-symbol">{icon}</span><div className="vital-track"><div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div><span className="vital-label">{label}</span></div>;
}

export function HUD({ hud, drops, hurt, log, radar, onMap, onPhone, mapEnabled }: Props) {
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
      {hud.bloodScreen > 0.02 && <div className="blood-screen" style={{ opacity: Math.min(0.85, hud.bloodScreen) }} />}
      {hud.combo > 1 && (
        <div className={`hud-combo ${hud.combo >= 5 ? 'hot' : ''}`}>
          <b>×{hud.combo}</b>
          <span>комбо</span>
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, hud.comboTimer / 3.6))})` }} />
        </div>
      )}
      {hud.phoneOpen && <div className="hud-phone-hint"><b>ТЕЛЕФОН В РУКЕ</b><span>P — убрать · Esc — закрыть</span></div>}
      {hud.interact && !hud.inCar && <div className="hud-interact"><kbd>F</kbd>{hud.interact}</div>}
      {!hud.inCar && (hud.parkour === 'climb' || hud.parkour === 'wallrun' || hud.parkour === 'vault' || hud.parkour === 'mantle' || hud.parkour === 'slide') && (
        <div className={`hud-parkour ${hud.parkour}`}>
          {hud.parkour === 'climb' ? 'ЛАЗАНИЕ · держи ПРОБЕЛ'
            : hud.parkour === 'wallrun' ? 'БЕГ ПО СТЕНЕ'
            : hud.parkour === 'vault' ? 'ВОЛЬТ'
            : hud.parkour === 'mantle' ? 'ПОДТЯГИВАНИЕ'
            : 'СКОЛЬЖЕНИЕ'}
        </div>
      )}
      {!hud.inCar && hud.parkour === 'air' && hud.height > 2.2 && <div className="hud-height">{hud.height.toFixed(1)} м<br /><span>СПРАВА — ПЕРЕКАТ</span></div>}
      {hud.raceActive && <div className="hud-race"><b>ГОНКА</b><span>кольцо {hud.raceGate}</span><em>{hud.raceTime.toFixed(1)} с</em></div>}
      {!hud.inCar && !hud.phoneOpen && (
        <div className={`reticle ${hud.ads ? 'aiming' : ''} ${hud.weapon === 'shotgun' ? 'wide' : hud.weapon === 'axe' ? 'melee' : ''}`} />
      )}
      {hud.hitMarker > 0.02 && (
        <div className={`hit-marker ${hud.hitHead ? 'head' : ''}`} style={{ opacity: Math.min(1, hud.hitMarker * 1.4) }}>
          <i /><i /><i /><i />
        </div>
      )}
      <div className="hud-vitals">
        {hud.sprinting && <div className="sprint-tag">БЕГ</div>}
        <Bar value={hud.hp} color="#bb7465" label="ЗДОРОВЬЕ" icon="+" />
        <Bar value={hud.stamina} color="#c6cbb1" label="СИЛЫ" icon="/" />
        {hud.armor > 0.5 && <Bar value={(hud.armor / hud.armorMax) * 100} color="#6f9fd8" label="БРОНЯ" icon="▲" />}
        {hud.weapon === 'axe' && <Bar value={hud.sharpness * 100} color="#bea77d" label="ЛЕЗВИЕ" icon="|" />}
        {hud.weapon === 'axe' && <div className="hud-axe">{hud.axeShort}</div>}
        <div className="hud-level">УРОВЕНЬ {hud.level}<span>{hud.kills} УСТРАНЕНО</span><span className="hud-packs">ПАКЕТЫ {hud.packages}/{hud.packagesTotal}</span></div>
        <button type="button" className="hud-cash pointer-events-auto" onClick={onPhone} title="Открыть телефон (P)">
          <b>${Math.round(hud.cash).toLocaleString('ru-RU')}</b><span>телефон</span>
        </button>
        <div className={`hud-stance ${hud.stance}`}>{hud.stance === 'stand' ? 'СТОЯ' : hud.stance === 'crouch' ? 'ПРИСЕЛ' : 'ПОЛЗКОМ'}</div>
      </div>
      <button type="button" className="hud-radar" onClick={onMap} disabled={!mapEnabled} aria-label="Открыть карту города" title="Карта города (M)">
        <canvas ref={canvasRef} width={184} height={184} /><span>N</span><i><MapIcon name="map" size={12} /></i>
      </button>
      {radar?.destination && <div className="hud-route" aria-live="off"><MapIcon name="pin" size={14} /><span><b>{locationName(radar.destination)}</b><small>{formatDistance(routeDistance(radar.route))}</small></span></div>}
      <div className="hud-environment"><div className="hud-clock">{hud.clock}</div><div>{hud.raining ? 'ДОЖДЬ' : hud.night > 0.5 ? 'НОЧЬ' : hud.district}{hud.cloud > 0.32 ? ' · ОБЛАЧНО' : ''}</div>
        <div className={`hud-mode ${hud.mode}`}>
          {hud.mode === 'peace' ? 'МИРНЫЙ' : hud.mode === 'zombie' ? 'АПОКАЛИПСИС' : 'ОБЫЧНЫЙ'}
          {hud.peers > 0 && <em>{hud.peers} в сети</em>}
        </div>
        <small className="hud-station-name">{hud.station ? `♪ ${hud.station}` : ''}</small>
        {hud.weapon !== 'axe' && !hud.inCar && <p className="hud-ammo"><strong>{hud.weapon === 'shotgun' ? hud.shells : hud.ammo}</strong><span>/ {hud.weapon === 'shotgun' ? hud.shellReserve : hud.reserve}</span></p>}
        {hud.reloading && <span className="reload-status">ПЕРЕЗАРЯДКА</span>}
        <p className="hud-throwables"><b>{hud.throwKind === 'molotov' ? '🍾' : '💣'}</b><span>{hud.throwKind === 'molotov' ? hud.molotovs : hud.grenades}</span></p>
        {hud.inCar && (hud.carEngine > 0.05 || hud.carTires > 0.05) && <div className="car-condition"><span>ДВС {Math.round((1 - hud.carEngine) * 100)}%</span><span>ШИНЫ {Math.round((1 - hud.carTires) * 100)}%</span></div>}
      </div>
      {(hud.questTitle || hud.questObjective) && (
        <div className="hud-quest" role="status">
          <small>ЗАДАНИЕ · {hud.questTitle}</small>
          <b>{hud.questObjective}</b>
          {hud.questProgress && <span>{hud.questProgress}</span>}
          {hud.questReward > 0 && <em>${hud.questReward.toLocaleString('ru-RU')}</em>}
        </div>
      )}
      {hud.heliActive && <div className="air-alert heli"><i />ВЕРТОЛЁТ ПОЛИЦИИ<small>сбей его или уходи под крышу</small></div>}
      {hud.tankActive && <div className="air-alert tank"><i />ТАНК НА УЛИЦАХ<small>5 звёзд · броня не пробивается топором</small></div>}
      {hud.nearLoot && !hud.inCar && <div className="loot-hint">ОБЫСКАТЬ · кнопка «сесть в машину»</div>}
      {hud.wanted > 0 && <div className="hud-wanted">{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < hud.wanted ? 'on' : ''}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 6 7 .9-5 5 .9 7-5.9-3-5.9 3 .9-7-5-5L9 8z" /></svg></span>)}</div>}
      {hud.dispatch && <div className="dispatch-banner"><span>СЛУЖБЫ</span>{hud.dispatch}</div>}
      {hud.fires > 0 && <div className="fire-alert"><i />{hud.fires} {hud.fires === 1 ? 'ВОЗГОРАНИЕ' : 'ВОЗГОРАНИЯ'}<small>пожарная часть выехала</small></div>}
      {hud.nearEmergency && !hud.inCar && <div className="emergency-hint">{hud.nearEmergency === 'fire' ? 'ПОЖАРНАЯ МАШИНА' : 'СКОРАЯ ПОМОЩЬ'} · можно сесть за руль</div>}
      {log && <div key={log.id} className="hit-log hud-log">{log.text}</div>}
      {(stuck || left) && <div className="axe-notice"><strong>{stuck ? 'ТОПОР ЗАСТРЯЛ' : 'ТОПОР ОСТАЛСЯ ПОЗАДИ'}</strong><span>{stuck ? 'Нажимай кнопку удара, чтобы вытащить' : 'Вернись за своим оружием'}</span></div>}
    </div>
  );
}
