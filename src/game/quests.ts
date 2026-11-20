import { LANDMARKS } from './city-plan';

/**
 * Сюжет и побочные задания.
 *
 * Это не декорация: цели живут в мире (маяк на карте, GPS-маршрут),
 * считаются по реальным действиям игрока — ограбления, угон, фото, розыск,
 * уничтоженная техника. Награда идёт в кошелёк, следующая миссия открывается
 * сама, побочные заказы приходят в телефон.
 */

export type ObjectiveKind = 'goto' | 'talk' | 'rob' | 'kill' | 'photo' | 'deliver' | 'survive' | 'destroy' | 'earn' | 'escape' | 'wanted';

export interface Objective {
  kind: ObjectiveKind;
  text: string;
  count?: number;
  x?: number;
  z?: number;
  r?: number;
  seconds?: number;
  wanted?: number;
  of?: 'zombie' | 'human' | 'officer';
  target?: 'heli' | 'tank';
}

export interface Quest {
  id: string;
  title: string;
  giver: string;
  district: string;
  brief: string;
  objectives: Objective[];
  reward: number;
  xp: number;
  side?: boolean;
  unlockAfter?: string;
  finale?: boolean;
}

export interface QuestState {
  x: number;
  z: number;
  inCar: boolean;
  carKind: string | null;
  wanted: number;
  cash: number;
  earned: number;
  robbed: number;
  killsZombie: number;
  killsHuman: number;
  killsOfficer: number;
  photos: number;
  photoX: number;
  photoZ: number;
  heliKills: number;
  tankKills: number;
  time: number;
}

export interface QuestApi {
  log: (text: string) => void;
  pay: (amount: number, label: string) => void;
  marker: (point: { x: number; z: number } | null) => void;
  notify: (title: string, body: string) => void;
  reward: (xp: number) => void;
}

const at = (id: string) => {
  const l = LANDMARKS.find(k => k.id === id);
  return { x: l?.x ?? 0, z: l?.z ?? 0 };
};

const diner = at('diner');
const motel = at('hotel');
const garage = at('garage');
const ocean = at('ocean');
const beach = at('beach');
const island = at('island');
const bank = at('bank');

export const STORY: Quest[] = [
  {
    id: 'arrival', title: 'Прилёт', giver: 'Рико', district: 'Саут-Бич',
    brief: 'Ты сошёл с трапа в Майами с четырьмястами баксов и чужим номером в телефоне. Рико ждёт у закусочной «Орион».',
    objectives: [
      { kind: 'goto', text: 'Дойти до закусочной «Орион»', ...diner, r: 16 },
      { kind: 'talk', text: 'Поговорить с Рико', ...diner, r: 12 },
      { kind: 'goto', text: 'Пройтись по Ocean Drive', ...ocean, r: 24 },
    ],
    reward: 250, xp: 60,
  },
  {
    id: 'debts', title: 'Долги', giver: 'Рико', district: 'Саут-Бич',
    brief: 'Трое должны Рико. Деньги можно забрать вежливо — а можно и нет. Наведи оружие и обыщи карманы.',
    objectives: [
      { kind: 'rob', text: 'Собрать долг с трёх прохожих', count: 3 },
      { kind: 'talk', text: 'Вернуться к Рико', ...diner, r: 12 },
    ],
    reward: 700, xp: 120,
  },
  {
    id: 'delivery', title: 'Курьер', giver: 'Рико', district: 'Уэстсайд',
    brief: 'Нужна машина — любая, но лучше чужая. Довезёшь до мастерской Уэстсайд целой и получишь наличные.',
    objectives: [
      { kind: 'deliver', text: 'Угнать машину и пригнать в мастерскую', ...garage, r: 16 },
    ],
    reward: 1100, xp: 200,
  },
  {
    id: 'heat', title: 'Горячая ночь', giver: 'Рико', district: 'Пасифик-центр',
    brief: 'Копы не любят, когда стреляют в центре. Продержись в погоне минуту — и Рико это оценит.',
    objectives: [
      { kind: 'survive', text: 'Продержаться в погоне 60 секунд', seconds: 60, wanted: 2 },
      { kind: 'escape', text: 'Оторваться от полиции', seconds: 0 },
    ],
    reward: 1600, xp: 260,
  },
  {
    id: 'postcard', title: 'Открытка с пляжа', giver: 'Мила', district: 'Пляж',
    brief: 'Мила просит пару кадров: бирюзовая вода, белый песок и пальмы. Открой телефон → Камера.',
    objectives: [
      { kind: 'photo', text: 'Сделать фото на пляже', count: 2, ...beach, r: 150 },
      { kind: 'goto', text: 'Показать кадры Миле у отеля', ...motel, r: 20 },
    ],
    reward: 900, xp: 180,
  },
  {
    id: 'shark', title: 'Шум сверху', giver: 'Рико', district: 'Бэйфронт',
    brief: 'Полицейский вертолёт следит за тобой. Сбей его — и город запомнит это имя.',
    objectives: [
      { kind: 'wanted', text: 'Поднять розыск до 4 звёзд', wanted: 4 },
      { kind: 'destroy', text: 'Уничтожить вертолёт полиции', target: 'heli', count: 1 },
    ],
    reward: 3200, xp: 420,
  },
  {
    id: 'armor', title: 'Броня', giver: 'Рико', district: 'Пасифик-центр',
    brief: 'На пять звёзд в город выезжает танк. Керамика и упорство. Уничтожь его.',
    objectives: [
      { kind: 'wanted', text: 'Поднять розыск до 5 звёзд', wanted: 5 },
      { kind: 'destroy', text: 'Уничтожить танк', target: 'tank', count: 1 },
    ],
    reward: 6000, xp: 700,
  },
  {
    id: 'king', title: 'Король города', giver: 'Рико', district: 'Залив',
    brief: 'Деньги, репутация, вода цвета электрик. Приезжай на остров — поговорим о будущем.',
    objectives: [
      { kind: 'earn', text: 'Заработать ещё $4000', count: 4000 },
      { kind: 'goto', text: 'Приехать на остров Миллионеров', ...island, r: 70 },
    ],
    reward: 12000, xp: 1200, finale: true,
  },
];

export const SIDE_QUESTS: Quest[] = [
  {
    id: 'cleanup', title: 'Заказ: уборка', giver: 'Мила', district: 'Уэстсайд',
    brief: 'Район заполонили. Зачисти восемь заражённых — Мила платит за каждого.',
    objectives: [{ kind: 'kill', text: 'Устранить 8 заражённых', count: 8, of: 'zombie' }],
    reward: 850, xp: 140, side: true, unlockAfter: 'arrival',
  },
  {
    id: 'vigilante', title: 'Заказ: тишина', giver: 'Рико', district: 'Даунтаун',
    brief: 'Слишком много внимания. Уйди от погони, не поднимая новые звёзды.',
    objectives: [
      { kind: 'survive', text: 'Поднять 2 звезды', seconds: 1, wanted: 2 },
      { kind: 'escape', text: 'Скрыться от полиции', seconds: 0 },
    ],
    reward: 1200, xp: 200, side: true, unlockAfter: 'heat',
  },
  {
    id: 'collect', title: 'Заказ: инкассация', giver: 'Банк «Пасифик»', district: 'Пасифик-центр',
    brief: 'Проверь, как работает охрана банка. Просто подойди и посмотри внимательно.',
    objectives: [
      { kind: 'goto', text: 'Осмотреть банк «Пасифик»', ...bank, r: 22 },
      { kind: 'earn', text: 'Обналичить $500 любым способом', count: 500 },
    ],
    reward: 1500, xp: 240, side: true, unlockAfter: 'delivery',
  },
];

interface Runtime {
  quest: Quest;
  index: number;
  objective: number;
  base: {
    robbed: number; killsZombie: number; killsHuman: number; killsOfficer: number;
    photos: number; heliKills: number; tankKills: number; earned: number; cash: number;
  };
  timer: number;
  startedAt: number;
  inCarSeen: boolean;
  done: boolean;
  paidOut: boolean;
  finishAt: number;
}

export class QuestSystem {
  story: Quest[] = STORY;
  side: Quest[] = SIDE_QUESTS;
  runtime: Runtime | null = null;
  completed = new Set<string>();
  available: Quest[] = [];
  /** Принятые, но ещё не начатые заказы: начнутся сразу после текущего задания. */
  queue: Quest[] = [];
  private lastMarker = '';
  onUpdate?: () => void;
  private markerPoint: { x: number; z: number } | null = null;

  constructor() { this.available = [...this.side]; }

  get active() { return this.runtime && !this.runtime.done ? this.runtime.quest : null; }

  currentObjective() {
    const rt = this.runtime;
    if (!rt || rt.done) return null;
    return rt.quest.objectives[rt.objective] ?? null;
  }

  progressText() {
    const rt = this.runtime;
    const obj = this.currentObjective();
    if (!rt || !obj) return '';
    if (obj.kind === 'rob' || obj.kind === 'kill' || obj.kind === 'photo' || obj.kind === 'destroy' || obj.kind === 'earn') {
      const have = this.counterValue(obj.kind, obj, rt);
      return `${Math.min(have, obj.count ?? 1)} / ${obj.count ?? 1}`;
    }
    if (obj.kind === 'survive') return `${Math.floor(rt.timer)} / ${obj.seconds ?? 0} с`;
    if (obj.kind === 'wanted') return `${Math.min(this._state?.wanted ?? 0, obj.wanted ?? 1)} / ${obj.wanted ?? 1} ★`;
    if (obj.kind === 'escape') return 'скрыться';
    return obj.text;
  }

  marker() { return this.markerPoint; }

  reset() {
    this.runtime = null;
    this.completed.clear();
    this.queue = [];
    this.available = [...this.side];
    this.markerPoint = null;
    this.lastMarker = '';
  }

  /** Запуск сюжета. */
  startStory(api: QuestApi, state: QuestState) {
    if (this.runtime) return;
    const next = this.story.find(q => !this.completed.has(q.id));
    if (next) this.begin(next, api, state);
  }

  begin(quest: Quest, api: QuestApi, state: QuestState) {
    this.runtime = {
      quest, index: 0, objective: 0,
      base: {
        robbed: state.robbed, killsZombie: state.killsZombie, killsHuman: state.killsHuman,
        killsOfficer: state.killsOfficer, photos: state.photos, heliKills: state.heliKills,
        tankKills: state.tankKills, earned: state.earned, cash: state.cash,
      },
      timer: 0, startedAt: state.time, inCarSeen: false, done: false, paidOut: false, finishAt: 0,
    };
    api.log(`Новое задание: ${quest.title}`);
    api.notify(quest.title, quest.brief);
    this.syncMarker(api);
    this.onUpdate?.();
  }

  accept(id: string, api: QuestApi, state: QuestState) {
    const quest = this.side.find(q => q.id === id) ?? this.story.find(q => q.id === id);
    if (!quest || this.completed.has(quest.id)) return false;
    if (quest.unlockAfter && !this.completed.has(quest.unlockAfter)) return false;
    this.available = this.available.filter(q => q.id !== id);
    if (this.runtime && !this.runtime.done) {
      if (!this.queue.some(q => q.id === id)) {
        this.queue.push(quest);
        api.notify('Заказ принят', `${quest.title} начнётся после текущего задания`);
      }
      return true;
    }
    this.begin(quest, api, state);
    return true;
  }

  private counterValue(kind: ObjectiveKind, obj: Objective, rt: Runtime) {
    const b = rt.base;
    switch (kind) {
      case 'rob': return this._state?.robbed ? this._state.robbed - b.robbed : 0;
      case 'kill': {
        if (!this._state) return 0;
        if (obj.of === 'human') return this._state.killsHuman - b.killsHuman;
        if (obj.of === 'officer') return this._state.killsOfficer - b.killsOfficer;
        return this._state.killsZombie - b.killsZombie;
      }
      case 'photo': return this._state ? this._state.photos - b.photos : 0;
      case 'destroy': return this._state
        ? (obj.target === 'tank' ? this._state.tankKills - b.tankKills : this._state.heliKills - b.heliKills) : 0;
      case 'earn': return this._state ? this._state.earned - b.earned : 0;
      default: return 0;
    }
  }

  private _state: QuestState | null = null;

  update(dt: number, state: QuestState, api: QuestApi) {
    this._state = state;
    const rt = this.runtime;
    if (!rt) {
      const next = this.story.find(q => !this.completed.has(q.id));
      if (next) this.begin(next, api, state);
      return;
    }
    if (rt.done) {
      if (state.time - rt.finishAt > 4) {
        this.runtime = null;
        const queued = this.queue.shift();
        const next = queued ?? this.story.find(q => !this.completed.has(q.id));
        if (next) this.begin(next, api, state);
        else api.log('Сюжет пройден. Побочные заказы — в телефоне.');
      }
      return;
    }
    const obj = rt.quest.objectives[rt.objective];
    if (!obj) { this.completeQuest(rt, state, api); return; }

    let passed = false;
    const dist = Math.hypot(state.x - (obj.x ?? 0), state.z - (obj.z ?? 0));
    switch (obj.kind) {
      case 'goto':
      case 'talk':
        passed = obj.x !== undefined && dist <= (obj.r ?? 12);
        break;
      case 'rob':
      case 'kill':
      case 'photo':
      case 'destroy':
        passed = this.counterValue(obj.kind, obj, rt) >= (obj.count ?? 1);
        break;
      case 'earn':
        passed = this.counterValue('earn', obj, rt) >= (obj.count ?? 1);
        break;
      case 'deliver':
        passed = state.inCar && dist <= (obj.r ?? 16) && Math.abs(state.wanted) < 5;
        break;
      case 'wanted':
        passed = state.wanted >= (obj.wanted ?? 1);
        break;
      case 'survive': {
        const need = obj.wanted ?? 0;
        if (state.wanted >= need && need > 0) rt.timer += dt;
        passed = rt.timer >= (obj.seconds ?? 1);
        break;
      }
      case 'escape':
        passed = state.wanted === 0;
        break;
    }

    if (passed) {
      rt.objective++;
      rt.timer = 0;
      rt.base = {
        robbed: state.robbed, killsZombie: state.killsZombie, killsHuman: state.killsHuman,
        killsOfficer: state.killsOfficer, photos: state.photos, heliKills: state.heliKills,
        tankKills: state.tankKills, earned: state.earned, cash: state.cash,
      };
      if (rt.objective >= rt.quest.objectives.length) this.completeQuest(rt, state, api);
      else { api.log(`Цель: ${rt.quest.objectives[rt.objective].text}`); this.syncMarker(api); }
      this.onUpdate?.();
    } else {
      const objNow = rt.quest.objectives[rt.objective];
      if (objNow && (objNow.kind === 'goto' || objNow.kind === 'talk' || objNow.kind === 'deliver')) {
        const key = `${rt.quest.id}:${rt.objective}:${objNow.x}:${objNow.z}`;
        if (key !== this.lastMarker) { this.lastMarker = key; this.syncMarker(api); }
      } else if (this.markerPoint) {
        this.markerPoint = null;
        api.marker(null);
      }
    }
  }

  private syncMarker(api: QuestApi) {
    const obj = this.currentObjective();
    if (obj && obj.x !== undefined && obj.z !== undefined) {
      this.markerPoint = { x: obj.x, z: obj.z };
      api.marker(this.markerPoint);
    } else {
      this.markerPoint = null;
      api.marker(null);
    }
  }

  private completeQuest(rt: Runtime, _state: QuestState, api: QuestApi) {
    if (rt.paidOut) return;
    rt.done = true;
    rt.paidOut = true;
    rt.finishAt = _state.time;
    this.completed.add(rt.quest.id);
    this.available = [...this.side].filter(q => !this.completed.has(q.id) && (!q.unlockAfter || this.completed.has(q.unlockAfter)));
    api.pay(rt.quest.reward, `Задание: ${rt.quest.title}`);
    api.reward(rt.quest.xp);
    api.log(`Задание выполнено: ${rt.quest.title} · +$${rt.quest.reward}`);
    api.notify('Задание выполнено', `${rt.quest.title} — награда $${rt.quest.reward}`);
    api.marker(null);
    this.markerPoint = null;
    this.onUpdate?.();
  }

  /** Побочные заказы, доступные к принятию. */
  offers() {
    return [...this.side].filter(q =>
      !this.completed.has(q.id) && !this.queue.some(k => k.id === q.id) &&
      (!q.unlockAfter || this.completed.has(q.unlockAfter)));
  }
}
