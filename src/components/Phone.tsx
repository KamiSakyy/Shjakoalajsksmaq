import { useEffect, useMemo, useState } from 'react';
import type { Game, HudState, Quality } from '../game/Game';
import { formatMoney } from '../game/economy';

type AppId = 'missions' | 'wallet' | 'camera' | 'contacts' | 'map' | 'settings' | 'profile';

interface Props {
  game: Game | null;
  hud: HudState;
  onClose: () => void;
  onOpenMap: () => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
  photos: string[];
  onPhoto: () => void;
}

const APPS: { id: AppId; label: string; glyph: string; tone: string }[] = [
  { id: 'missions', label: 'Миссии', glyph: '★', tone: '#ff6b6b' },
  { id: 'wallet', label: 'Кошелёк', glyph: '$', tone: '#43d9a3' },
  { id: 'camera', label: 'Камера', glyph: '◉', tone: '#7fb8ff' },
  { id: 'contacts', label: 'Контакты', glyph: '☎', tone: '#ffd166' },
  { id: 'map', label: 'Карта', glyph: '✦', tone: '#b18cff' },
  { id: 'profile', label: 'Профиль', glyph: '◈', tone: '#53e0b0' },
  { id: 'settings', label: 'Настройки', glyph: '⚙', tone: '#9aa4b2' },
];

function QuestCard({ title, giver, district, brief, objectives, reward, progress, onAccept, acceptLabel }: {
  title: string; giver: string; district: string; brief: string; objectives: string[]; reward: number;
  progress?: string; onAccept?: () => void; acceptLabel?: string;
}) {
  return (
    <div className="phone-card">
      <div className="phone-card-top">
        <div>
          <b>{title}</b>
          <small>{giver} · {district}</small>
        </div>
        <span className="phone-reward">{formatMoney(reward)}</span>
      </div>
      <p>{brief}</p>
      <ul className="phone-objectives">
        {objectives.map((o, i) => <li key={i}><i />{o}</li>)}
      </ul>
      {progress && <div className="phone-progress">{progress}</div>}
      {onAccept && <button className="phone-action" onClick={onAccept}>{acceptLabel ?? 'ВЗЯТЬ ЗАКАЗ'}</button>}
    </div>
  );
}

export function Phone({ game, hud, onClose, onOpenMap, quality, onQuality, photos, onPhoto }: Props) {
  const [app, setApp] = useState<AppId>('missions');
  const [now, setNow] = useState(() => new Date());
  const [, setTick] = useState(0);
  const [lastShot, setLastShot] = useState(0);

  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); setTick(v => v + 1); }, 1000);
    return () => clearInterval(t);
  }, []);

  const quests = game?.quests;
  const active = quests?.active ?? null;
  const offers = game?.quests.offers() ?? [];
  const completed = useMemo(() => Array.from(quests?.completed ?? []), [quests, hud.questTitle, hud.questObjective]);
  const unread = game?.notifications.length ?? 0;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const battery = Math.max(12, 100 - Math.floor((Date.now() / 1000 / 60) % 80));

  const accept = (id: string) => {
    if (!game) return;
    game.quests.accept(id, {
      log: t => game.setLog(t),
      pay: (amount, label) => game.economy.add(amount, label),
      marker: p => game.setDestination(p),
      notify: (t, b) => game.notify(t, b),
      reward: xp => game.addXp?.(xp),
    }, game.questState());
    setTick(v => v + 1);
  };

  return (
    <div className="phone-layer" role="dialog" aria-modal="true" aria-label="Телефон">
      <div className="phone-shell">
        <div className="phone-status">
          <span>{time}</span>
          <span className="phone-island" />
          <span>▮▮▮ {battery}%</span>
        </div>
        <div className="phone-screen">
          <div className="phone-wallpaper" />
          <header className="phone-head">
            <div>
              <small>{app === 'missions' ? 'ЗАДАНИЯ' : app === 'wallet' ? 'ФИНАНСЫ' : app === 'camera' ? 'КАМЕРА' : app === 'contacts' ? 'КОНТАКТЫ' : app === 'profile' ? 'ПРОФИЛЬ' : app === 'settings' ? 'НАСТРОЙКИ' : 'КАРТА'}</small>
              <h3>{app === 'missions' ? 'Телефон' : app === 'wallet' ? formatMoney(hud.cash + hud.bank) : app === 'camera' ? 'Снимки' : app === 'contacts' ? 'Связь' : app === 'profile' ? `Уровень ${hud.level}` : app === 'settings' ? 'Графика' : 'Навигация'}</h3>
            </div>
            <button className="phone-x" onClick={onClose} aria-label="Закрыть телефон">✕</button>
          </header>

          <div className="phone-body">
            {app === 'missions' && <>
              {active ? (
                <QuestCard
                  title={active.title} giver={active.giver} district={active.district} brief={active.brief}
                  objectives={active.objectives.map(o => o.text)} reward={active.reward}
                  progress={`${hud.questObjective || active.objectives[0]?.text} · ${hud.questProgress}`}
                />
              ) : (
                <div className="phone-card"><b>Сюжет пройден</b><p>Рико больше не звонит. Но город всё ещё полон работы.</p></div>
              )}
              {offers.length > 0 && <div className="phone-section-title">ДОСТУПНЫЕ ЗАКАЗЫ</div>}
              {offers.map(q => (
                <QuestCard key={q.id} title={q.title} giver={q.giver} district={q.district} brief={q.brief}
                  objectives={q.objectives.map(o => o.text)} reward={q.reward} onAccept={() => accept(q.id)} />
              ))}
              {completed.length > 0 && <div className="phone-done">Выполнено заданий: {completed.length}</div>}
              {unread > 0 && <div className="phone-done">Новых уведомлений: {unread}</div>}
            </>}

            {app === 'wallet' && <>
              <div className="phone-wallet">
                <div><small>НАЛИЧНЫЕ</small><b>{formatMoney(hud.cash)}</b></div>
                <div><small>СЧЁТ В БАНКЕ</small><b>{formatMoney(hud.bank)}</b></div>
              </div>
              <div className="phone-row">
                <button className="phone-action" onClick={() => { game?.economy.deposit(500); setTick(v => v + 1); }}>Внести $500</button>
                <button className="phone-action ghost" onClick={() => { game?.economy.withdraw(500); setTick(v => v + 1); }}>Снять $500</button>
              </div>
              <div className="phone-section-title">ИСТОРИЯ</div>
              <ul className="phone-log">
                {(game?.economy.history ?? []).slice(0, 12).map(t => (
                  <li key={t.id}><span>{t.label}</span><b className={t.amount > 0 ? 'plus' : 'minus'}>{t.amount > 0 ? '+' : ''}{formatMoney(t.amount)}</b></li>
                ))}
                {!game?.economy.history.length && <li><span>Пока пусто</span></li>}
              </ul>
              <p className="phone-hint">Обыскивай карманы: подойди к телу и нажми «ОБЫСКАТЬ». С оружием в руках прохожие отдают деньги сами.</p>
            </>}

            {app === 'camera' && <>
              <div className="phone-photo" style={{ backgroundImage: photos[lastShot] ? `url(${photos[lastShot]})` : undefined }}>
                {!photos.length && <span>Нажми на кнопку, чтобы сделать первый кадр Майами</span>}
              </div>
              <div className="phone-row">
                <button className="phone-shutter" onClick={() => { onPhoto(); setLastShot(0); setTick(v => v + 1); }} aria-label="Сделать фото" />
                <span className="phone-hint">Снимков: {hud.photos}</span>
              </div>
              {photos.length > 1 && <div className="phone-thumbs">
                {photos.slice(0, 8).map((p, i) => (
                  <button key={i} onClick={() => setLastShot(i)} style={{ backgroundImage: `url(${p})` }} aria-label={`Снимок ${i + 1}`} />
                ))}
              </div>}
            </>}

            {app === 'contacts' && <ul className="phone-contacts">
              {[
                { n: 'Рико', d: 'Работодатель · Саут-Бич', t: 'Деньги любят тишину. Не подведи.' },
                { n: 'Мила', d: 'Фотограф · Пляж', t: 'Мне нужен закат над водой. И без копов в кадре.' },
                { n: '911', d: 'Полиция Майами', t: 'Не звони. Они и так приедут.' },
                { n: 'Служба спасения', d: 'Пожарные · Город', t: 'Горит? Отойди на двадцать метров.' },
              ].map(c => <li key={c.n}><div className="phone-avatar">{c.n[0]}</div><div><b>{c.n}</b><small>{c.d}</small><p>{c.t}</p></div></li>)}
            </ul>}

            {app === 'map' && <>
              <div className="phone-card">
                <b>Городской атлас</b>
                <p>Пасифик-Бич: 144 квартала, Ocean Drive, пляж, марина и остров Миллионеров.</p>
                <button className="phone-action" onClick={onOpenMap}>ОТКРЫТЬ КАРТУ</button>
              </div>
              <p className="phone-hint">Маршрут до задания прокладывается автоматически и виден на мини-карте.</p>
            </>}

            {app === 'profile' && <>
              <div className="phone-card">
                <div className="phone-card-top">
                  <div><b>Уровень {hud.level}</b><small>опыт {hud.xp} / {60 + hud.level * 40}</small></div>
                  <span className="phone-reward">{hud.kills} устранено</span>
                </div>
                <div className="phone-bar"><i style={{ width: `${Math.min(100, (hud.xp / (60 + hud.level * 40)) * 100)}%` }} /></div>
                <p>Серия добиваний: ×{Math.max(1, hud.combo)} · лучших пакетов: {hud.packages}/{hud.packagesTotal}</p>
              </div>

              <div className="phone-section-title">НАВЫКИ</div>
              <ul className="phone-perks">
                {[
                  ['brutal', 'Мясник', 'урон топором +15%', 2],
                  ['looter', 'Мародёр', 'добыча +35%', 3],
                  ['tough', 'Толстая шкура', 'входящий урон −20%', 5],
                  ['runner', 'Бегун', 'выносливость −25% расхода', 7],
                  ['butcher', 'Профессионал', 'легче отсекать конечности', 9],
                  ['veteran', 'Ветеран', 'опыт +15%', 11],
                  ['medic', 'Полевой медик', 'аптечки ×2', 14],
                ].map(([id, name, desc, lvl]) => {
                  const on = !!game?.perks.has(id as string);
                  return <li key={id as string} className={on ? 'on' : ''}>
                    <i>{on ? '✓' : '🔒'}</i>
                    <div><b>{name as string}</b><small>{desc as string}</small></div>
                    <span>ур. {lvl as number}</span>
                  </li>;
                })}
              </ul>

              <div className="phone-section-title">ЗАНЯТИЯ</div>
              <div className="phone-card small">
                <div className="phone-spec"><span>Спрятанные пакеты</span><b>{hud.packages} / {hud.packagesTotal}</b></div>
                <div className="phone-spec"><span>Уличная гонка</span><b>{hud.raceActive ? `кольцо ${hud.raceGate} · ${hud.raceTime.toFixed(1)} с` : 'на старте Ocean Drive'}</b></div>
                <div className="phone-spec"><span>Бутылки с огнём</span><b>{hud.molotovs}</b></div>
                <div className="phone-spec"><span>Гранаты</span><b>{hud.grenades}</b></div>
              </div>
              <p className="phone-hint">Пакеты разбросаны по кварталам, пляжу и Ocean Drive. Трюки на трамплинах и гонка приносят деньги и опыт.</p>
            </>}

            {app === 'settings' && <>
              <div className="phone-section-title">ГРАФИКА</div>
              <div className="phone-row wrap">
                {([['auto', 'Авто'], ['low', 'Экономия'], ['high', 'Высокое'], ['ultra', 'Ультра']] as [Quality, string][]).map(([q, label]) => (
                  <button key={q} className={`phone-chip ${quality === q ? 'on' : ''}`} onClick={() => { onQuality(q); setTick(v => v + 1); }}>{label}</button>
                ))}
              </div>
              <p className="phone-hint">Авторежим сам держит 60 FPS: разрешение меняется, а графика и шейдеры остаются. Сейчас: {hud.qualityTier} · {hud.fpsScale}%</p>
              <div className="phone-section-title">СИСТЕМА</div>
              <div className="phone-card small">
                <div className="phone-spec"><span>Устройство</span><b>{game?.device.mobile ? 'Мобильное' : 'Настольное'}</b></div>
                <div className="phone-spec"><span>Ядер CPU</span><b>{game?.device.cores ?? '—'}</b></div>
                <div className="phone-spec"><span>WebGL 2</span><b>{game?.device.webgl2 ? 'да' : 'нет'}</b></div>
                <div className="phone-spec"><span>GPU</span><b className="gpu">{(game?.device.gpu || 'скрыт').slice(0, 34)}</b></div>
              </div>
            </>}
          </div>
        </div>

        <nav className="phone-dock" aria-label="Приложения">
          {APPS.map(a => (
            <button key={a.id} className={app === a.id ? 'on' : ''} onClick={() => setApp(a.id)} aria-label={a.label} aria-pressed={app === a.id}>
              <span style={{ background: a.tone }}>{a.glyph}</span>
              <small>{a.label}</small>
            </button>
          ))}
        </nav>
      </div>
      <button className="phone-backdrop" onClick={onClose} aria-label="Закрыть телефон" />
    </div>
  );
}
