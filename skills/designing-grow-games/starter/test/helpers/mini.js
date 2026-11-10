// 測試用迷你規則表：4 個物品、24 種順序，每個引擎元件各出現一次。
//   alpha  基地：一般成長，jump 跳級、delay 多等一回合
//   beta   工坊：被 delta 在 Lv1 時擋住（stall）
//   gamma  災害物品：Lv1–2 期間 hazard 一直有效，之後放下的物品套用 fx 裡 lock 指向它的那條
//   delta  搗蛋物品：Lv1–2 期間 grip 抓住之後放下的 alpha；最終級 branch 看工坊開了多久（age beta ≥ 4）決定 fate 旗標，wild 時踢壞工坊一級
// 收尾考驗 FINALE：alpha 滿級擋下（shield）／gamma 還在 Lv1–2 時偏掉（deflect）／否則命中（hit）。
const auto = { always: true };
const and = (...c) => ({ and: c });
const or = (...c) => ({ or: c });
const min = (id, n) => ({ minLevel: [id, n] });
const max = (id, n) => ({ maxLevel: [id, n] });
const age = (id, n) => ({ age: [id, n] });
const present = id => ({ present: id });

export const TITLE = '迷你測試';
export const ORDER = ['alpha', 'beta', 'gamma', 'delta'];
export const CLOSING_TURNS = 1;

export const ITEMS = {
  alpha: {
    name: '基地', max: 4,
    up: { 2: auto, 3: present('beta'), 4: min('beta', 3) },
    jump: { 4: and(present('beta'), min('beta', 3)) },
    delay: { 4: min('gamma', 1) },
  },
  beta: {
    name: '工坊', max: 4,
    up: { 2: min('alpha', 2), 3: auto, 4: min('gamma', 3) },
    stall: [{ when: and(present('delta'), max('delta', 1)), story: 'delta 擋在工坊門口' }],
    // 刻意放的死規則（求解器的 deadRules 報告要抓到）：gamma 不可能同時在場又不在場，這條永遠不發、ghost 旗標永遠不立
    fx: [{ when: and(present('gamma'), { absent: 'gamma' }), flag: { name: 'ghost' }, story: '永遠不會發生' }],
  },
  gamma: {
    name: '暴風', max: 3,
    up: { 2: age('gamma', 1), 3: auto },
    hazard: { while: and(min('gamma', 1), max('gamma', 2)) },
    fx: [
      { when: and(present('beta'), max('beta', 1)), lock: 'beta', flag: { name: 'flooded' }, story: '工坊淹水' },
      { when: and(present('alpha'), max('alpha', 1)), lock: 'alpha', flag: { name: 'washed' }, story: '基地被沖走' },
      { when: present('alpha'), flag: { name: 'gust' }, story: '風吹過基地' },
    ],
  },
  delta: {
    name: '小鬼', max: 3,
    up: { 2: or(min('alpha', 2), min('beta', 2)), 3: min('beta', 3) },
    grip: { while: and(min('delta', 1), max('delta', 2)), targets: ['alpha'], story: { alpha: '小鬼抓住剛蓋的基地' } },
    fx: [{ when: and(present('alpha'), max('alpha', 2)), delta: { target: 'alpha', by: -1 }, grip: true, story: '小鬼踢倒基地' }],
    // 分岔成 wild 的小鬼當場踢壞工坊一級：全 MAX 的順序只剩真結局那一條（check 的 trueEnding 要求全 MAX 必須是真結局）
    onLevel: { 3: [
      { branch: { flag: 'fate', when: age('beta', 4), then: 'tame', else: 'wild' }, story: '小鬼的命運分岔了' },
      { when: { flag: 'fate', is: 'wild' }, delta: { target: 'beta', by: -1 }, story: '作亂的小鬼踢壞工坊' },
    ] },
  },
};

export const AFTER_TURN = [
  { when: and(present('alpha'), max('alpha', 2), age('alpha', 3)), flag: { name: 'stale' }, story: '基地荒廢了' },
];

export const STORIES = {
  placed: { alpha: '放下基地', beta: '放下工坊', gamma: '暴風來了', delta: '小鬼出現' },
  grow: {
    alpha: { 2: '基地擴建', 3: '基地蓋塔', 4: '基地完工' },
    beta: { 2: '工坊開工', 3: '工坊加蓋', 4: '工坊完工' },
    gamma: { 2: '暴風還在', 3: '雨過天晴' },
    delta: { 2: '小鬼變多', 3: '小鬼長大' },
  },
};

export const FINALE = [
  { id: 'shield', when: min('alpha', 4) },
  { id: 'deflect', when: and(min('gamma', 1), max('gamma', 2)) },
  { id: 'hit', when: auto },
];

export const ENDINGS = [
  { id: 'bloom', title: '大豐收', kind: 'true', when: and({ allMax: true }, { flag: 'fate', is: 'tame' }), line: '全部完工，小鬼也成了幫手' },
  { id: 'flooded', title: '工坊淹水', kind: 'bad', when: { flag: 'flooded' } },
  { id: 'washed', title: '基地被沖走', kind: 'bad', when: { flag: 'washed' } },
  { id: 'stale', title: '基地荒廢', kind: 'bad', when: { flag: 'stale' } },
  { id: 'wild', title: '小鬼作亂', kind: 'bad', when: { flag: 'fate', is: 'wild' } },
  { id: 'fallen', title: '擋不住', kind: 'bad', when: { not: { finale: 'shield' } } },
  { id: 'retry', title: '再試一次', kind: 'neutral' },
];

export const ACCEPTANCE = { trueEndings: 1, everyBadReachable: true, greedyMustFail: true };
