const tips = [
  'Облака могут закрыть солнце: улица потемнеет, а тени станут мягче.',
  'Удерживай тормоз после остановки, чтобы включить задний ход.',
  'Присядь или ложись: тебя хуже видно, а выстрелы точнее.',
  'Пожарная машина тушит горящие автомобили автоматически.',
  'Попадание в двигатель может поджечь машину. Держись подальше.',
  'Нажми на мини-карту, чтобы открыть атлас и проложить маршрут.',
  'Скорая помощь лечит раненых жителей и самого игрока.',
  'Кнопка прицела теперь переключается: нажал — прицел включён.',
];
export function LoadingScreen({ progress, stage, tip }: { progress: number; stage: string; tip: string }) {
  return <div className="loading-screen" role="status" aria-live="polite">
    <div className="loading-art" /><div className="loading-shade" /><div className="loading-grain" />
    <div className="loading-top"><span className="loading-brand">ТОПОР<span>.</span>НОЧЬ</span><span className="loading-release">РАЙОН ПАСИФИК · РЕЛИЗ</span></div>
    <div className="loading-center">
      <div className="loading-kicker">ОТКРЫТЫЙ МИР · 144 КВАРТАЛА</div>
      <h2>ГОТОВИМ<br />ПАСИФИК</h2>
      <p className="loading-stage">{stage}</p>
      <div className="loading-track"><div className="loading-fill" style={{ width: `${Math.max(3, Math.min(100, progress))}%` }} /></div>
      <div className="loading-meta"><span>ЗАГРУЗКА ГОРОДА</span><b>{Math.round(progress)}%</b></div>
      <div className="loading-tip"><span>СОВЕТ</span>{tip}</div>
    </div>
    <div className="loading-foot"><span>ПОЖАРНАЯ ЧАСТЬ · СКОРАЯ · ПОЛИЦИЯ · ТРАФИК</span><span>WEST COAST, 2026</span></div>
  </div>;
}
export const loadingTips = tips;
