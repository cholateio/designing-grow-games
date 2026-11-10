// 奇幻龍谷範例的期望值（字面值；test/examples.test.js 重算，對不上就失敗）。規則改了就重跑 node solver/run.js、重釘這裡。
export const TOTAL = 720;

export const SOLUTION = ['farm', 'temple', 'mage', 'knight', 'dragon', 'goblin'];

export const DISTRIBUTION = {
  scorched: 336, templeFell: 194, overrun: 120, famine: 30, darkKnight: 20, tryAgain: 19, radiant: 1,
};

// 每個結局一條：全枚舉（深度優先、照 ORDER）裡第一條以它當標題的順序
export const REPRESENTATIVE = {
  radiant: ['farm', 'temple', 'mage', 'knight', 'dragon', 'goblin'],
  // 農田在哥布林之後放、被占住停在乾草田，巨龍降臨那回合一口火燒光
  scorched: ['temple', 'mage', 'knight', 'goblin', 'farm', 'dragon'],
  // 神殿在哥布林之後放、被搬走停在木祭壇，巨龍降臨那回合一尾巴掃倒
  templeFell: ['farm', 'mage', 'knight', 'goblin', 'temple', 'dragon'],
  // 法師最後才來：農田等不到水車磨坊，開墾 4 回合還在穀倉
  famine: ['farm', 'temple', 'knight', 'goblin', 'dragon', 'mage'],
  // 巨龍最後才來：騎士宣誓時法師只有 5
  darkKnight: ['farm', 'temple', 'mage', 'knight', 'goblin', 'dragon'],
  // 騎士最後才來：神殿等不到騎士宣誓，結界沒亮
  overrun: ['farm', 'temple', 'mage', 'goblin', 'dragon', 'knight'],
  // 騎士第 5 個才放、只長到騎士團（4，沒有宣誓、沒有分岔），巨龍還在谷裡；神殿 MAX 擋下魔王——沒有壞結局成立，但也不是全 MAX
  tryAgain: ['farm', 'temple', 'mage', 'goblin', 'knight', 'dragon'],
};

// 其他值得釘住的順序（不是哪個結局的第一條，但示範了某個元件；測試同樣重算，lockedOnPlacement 另查「放下那回合就被鎖」）
export const NOTABLE = [
  // 災害持續（hazard）：巨龍第 4 個放、還在谷裡（Lv1）時才搭木祭壇 → 祭壇放下的同一回合就被尾巴掃倒、鎖住。
  // 不是巨龍降臨那回合的一次檢查（那時神殿還沒放），而是「巨龍在谷裡期間才放下的東西當場遭殃」。
  { order: ['farm', 'mage', 'knight', 'dragon', 'temple', 'goblin'], ending: 'templeFell', note: '災害持續：巨龍還在谷裡時才放神殿', lockedOnPlacement: 'temple' },
];

export const REPORTS = {
  deadRules: [],
  shadowed: [],
  singleOrderEndings: [],
};
