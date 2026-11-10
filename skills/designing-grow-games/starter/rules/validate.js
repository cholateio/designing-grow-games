// 規則表結構檢查：validateSpec(spec) → 問題字串陣列；空陣列 = 合格。
// 測試與 npm run check 開頭都跑：在跑引擎之前就抓出打錯的物品名、超出範圍的級數、壞掉的條件與結局表。
// 每個問題只報一次、標出位置（例如 ITEMS.alpha.up[5]），不因為一個錯連鎖報一堆。
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const KINDS = ['true', 'bad', 'neutral'];
const ACCEPTANCE_FIELDS = {
  trueEndings: v => isNum(v) || '要是數字',
  everyBadReachable: v => typeof v === 'boolean' || '要是 true／false',
  maxAvgMax: v => isNum(v) || '要是數字',
  minMaxTurns: v => isNum(v) || '要是數字',
  greedyMustFail: v => typeof v === 'boolean' || '要是 true／false',
};
// 物品與反應認得的欄位。meta 是給演出層的自由欄位（引擎與求解器不讀）。
// 不在清單裡的欄位引擎會默默忽略，所以一律報出來；早期版本的舊名（rain、bite）與常見打錯（jumps）附上新名。
const ITEM_KEYS = new Set(['name', 'max', 'up', 'jump', 'delay', 'fx', 'onLevel', 'stall', 'hazard', 'grip', 'meta']);
const ACTION_KEYS = new Set(['when', 'delta', 'grip', 'lock', 'flag', 'branch', 'story']);
const RENAMED = { rain: 'hazard', bite: 'grip', jumps: 'jump' };
const unknownKey = (k, where, known) => RENAMED[k] && known.has(RENAMED[k])
  ? `${where}.${k} 要寫成 ${RENAMED[k]}（引擎不認得 ${k}，會默默忽略）`
  : `${where}.${k} 是未知欄位（認得的有 ${[...known].join('、')}）`;

export function validateSpec(spec) {
  const out = [];
  const add = m => { out.push(m); };
  if (!isObj(spec)) return ['規則表要是物件'];

  // ── ORDER 與 ITEMS ──
  const order = Array.isArray(spec.ORDER) && spec.ORDER.length ? spec.ORDER : null;
  if (!order) add('ORDER 要是非空陣列（物品清單兼掃描順序）');
  const items = isObj(spec.ITEMS) ? spec.ITEMS : null;
  if (!items) add('ITEMS 要是物件（每個物品的級數與條件）');
  const ids = new Set(items ? Object.keys(items) : []);
  if (order) {
    const seen = new Set();
    for (const id of order) {
      if (seen.has(id)) add(`ORDER 裡的 ${id} 重複`);
      else if (items && !ids.has(id)) add(`ORDER 的 ${id} 不在 ITEMS`);
      seen.add(id);
    }
    for (const id of ids) if (!seen.has(id)) add(`ITEMS.${id} 不在 ORDER（不在 ORDER 的物品永遠不會被掃描）`);
  }
  const finaleIds = Array.isArray(spec.FINALE) ? spec.FINALE.map(f => f?.id) : [];

  // ── 條件：遞迴檢查原語名稱、參數形狀、引用的物品與收尾結果 ──
  const item = (v, prim, where) => { if (!ids.has(v)) add(`${where}：${prim} 引用不存在的物品 ${v}`); };
  const cond = (c, where, { inFinale = false } = {}) => {
    if (!isObj(c)) return add(`${where}：條件要是物件（拿到 ${JSON.stringify(c)}）`);
    const keys = Object.keys(c).filter(k => k !== 'is');
    if ('is' in c && !('flag' in c)) return add(`${where}：is 只能搭配 flag`);
    if (keys.length !== 1) return add(`${where}：一個條件物件只能有一個原語（拿到 ${keys.join('、') || '空物件'}；多個請用 and）`);
    const [k] = keys, v = c[k];
    switch (k) {
      case 'always': case 'allMax':
        if (v !== true) add(`${where}：${k} 要寫成 { ${k}: true }`);
        return;
      case 'present': case 'absent': case 'locked':
        return item(v, k, where);
      case 'minLevel': case 'maxLevel': case 'age':
        if (!Array.isArray(v) || v.length !== 2 || !isNum(v[1])) return add(`${where}：${k} 要是 [物品, 級數]`);
        return item(v[0], k, where);
      case 'ltPlus':
        if (!Array.isArray(v) || v.length !== 3 || !isNum(v[2])) return add(`${where}：ltPlus 要是 [物品 a, 物品 b, k]（a 的級數 < b 的級數 + k）`);
        item(v[0], k, where); item(v[1], k, where);
        return;
      case 'flag':
        if (typeof v !== 'string' || !v) add(`${where}：flag 要是旗標名稱字串`);
        return;
      case 'finale':
        if (inFinale) return add(`${where}：FINALE 的條件不能用 finale（會自己引用自己）`);
        if (!finaleIds.includes(v)) add(`${where}：finale 引用不存在的收尾結果 ${v}（FINALE 有 ${finaleIds.join('、') || '（沒有 FINALE）'}）`);
        return;
      case 'and': case 'or':
        if (!Array.isArray(v) || !v.length) return add(`${where}：${k} 要是非空陣列`);
        v.forEach(x => cond(x, where, { inFinale }));
        return;
      case 'not':
        return cond(v, where, { inFinale });
      default:
        add(`${where}：未知的條件 ${k}`);
    }
  };

  // ── 反應（fx、onLevel、stall、AFTER_TURN 的每一條）──
  // owner：這條反應屬於哪個物品（AFTER_TURN 是 null）。grip: true 抓住的目標要靠施動者自己的 grip 區塊（while）才放得開，
  // 所以只在有 grip 區塊的物品身上有作用
  const action = (a, where, owner = null) => {
    if (!isObj(a)) return add(`${where}：反應要是物件`);
    for (const k of Object.keys(a)) if (!ACTION_KEYS.has(k)) add(unknownKey(k, where, ACTION_KEYS));
    if ('when' in a && a.when !== undefined) cond(a.when, `${where}.when`);
    if ('delta' in a) {
      const d = a.delta;
      if (!isObj(d)) add(`${where}.delta 要是 { target, by }`);
      else {
        if (!ids.has(d.target)) add(`${where}.delta.target 引用不存在的物品 ${d.target}`);
        if (!isNum(d.by) || d.by === 0) add(`${where}.delta.by 要是非零數字`);
      }
    }
    if (a.grip && !isObj(a.delta)) add(`${where}.grip 要搭配 delta（抓住的是 delta 的目標）`);
    else if (a.grip && owner === null) add(`${where}.grip 在 AFTER_TURN 沒有作用（沒有施動者的 grip 區塊；抓人的反應寫在有 grip 的物品的 fx／onLevel）`);
    else if (a.grip && !isObj(items?.[owner]?.grip)) add(`${where}.grip 沒有作用：${owner} 沒有 grip 區塊（{ while, targets }），被抓的放不開也抓不住`);
    if ('lock' in a && !ids.has(a.lock)) add(`${where}.lock 引用不存在的物品 ${a.lock}`);
    if ('flag' in a && !(isObj(a.flag) && typeof a.flag.name === 'string' && a.flag.name)) add(`${where}.flag 要是 { name, value? }`);
    if ('branch' in a) {
      const b = a.branch;
      if (!isObj(b) || typeof b.flag !== 'string' || !('then' in b) || !('else' in b) || !b.when) add(`${where}.branch 要有 flag、when、then、else`);
      else cond(b.when, `${where}.branch.when`);
    }
  };
  const actions = (list, where, owner = null) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return add(`${where} 要是陣列`);
    list.forEach((a, i) => action(a, `${where}[${i}]`, owner));
  };
  const levels = (table, where, lo, max, each) => {
    if (table === undefined) return;
    if (!isObj(table)) return add(`${where} 要是 { 級數: … } 物件`);
    for (const key of Object.keys(table)) {
      const n = Number(key);
      if (max !== null && !(Number.isInteger(n) && n >= lo && n <= max)) add(`${where}[${key}] 超出 ${lo}..${max}`);
      else each(table[key], `${where}[${key}]`);
    }
  };

  // ── 每個物品 ──
  for (const id of ids) {
    const it = items[id], at = `ITEMS.${id}`;
    if (!isObj(it)) { add(`${at} 要是物件`); continue; }
    for (const k of Object.keys(it)) if (!ITEM_KEYS.has(k)) add(unknownKey(k, at, ITEM_KEYS));
    const max = Number.isInteger(it.max) && it.max >= 1 ? it.max : null;
    if (max === null) add(`${at}.max 要是 ≥ 1 的整數`);
    levels(it.up, `${at}.up`, 2, max, cond);
    if (max !== null) {
      const missing = [];
      for (let n = 2; n <= max; n++) if (!isObj(it.up) || !(n in it.up)) missing.push(n);
      if (missing.length) add(`${at}.up 缺第 ${missing.join('、')} 級（從 n−1 升到 n 的條件，每一級都要有）`);
    }
    levels(it.jump, `${at}.jump`, 3, max, cond);
    levels(it.delay, `${at}.delay`, 2, max, cond);
    levels(it.onLevel, `${at}.onLevel`, 2, max, (list, where) => actions(list, where, id));
    actions(it.fx, `${at}.fx`, id);
    actions(it.stall, `${at}.stall`, id);
    if (it.hazard !== undefined) {
      if (!isObj(it.hazard)) add(`${at}.hazard 要是 { while }`);
      else cond(it.hazard.while, `${at}.hazard.while`);
    }
    if (it.grip !== undefined) {
      const g = it.grip;
      if (!isObj(g)) add(`${at}.grip 要是 { while, targets, story? }`);
      else {
        cond(g.while, `${at}.grip.while`);
        if (!Array.isArray(g.targets) || !g.targets.length) add(`${at}.grip.targets 要是非空的物品陣列`);
        else for (const t of g.targets) if (!ids.has(t)) add(`${at}.grip.targets 引用不存在的物品 ${t}`);
        if (g.story !== undefined && !isObj(g.story)) add(`${at}.grip.story 要是 { 物品: 句子 } 物件`);
      }
    }
  }
  actions(spec.AFTER_TURN, 'AFTER_TURN');
  if (spec.CLOSING_TURNS !== undefined && !(Number.isInteger(spec.CLOSING_TURNS) && spec.CLOSING_TURNS >= 0)) add('CLOSING_TURNS 要是 ≥ 0 的整數');
  if (spec.TITLE !== undefined && typeof spec.TITLE !== 'string') add('TITLE 要是字串');

  // ── 收尾考驗 ──
  if (spec.FINALE !== undefined) {
    if (!Array.isArray(spec.FINALE)) add('FINALE 要是有序陣列 [{ id, when }]');
    else {
      const seen = new Set();
      spec.FINALE.forEach((f, i) => {
        if (!isObj(f) || typeof f.id !== 'string' || !f.id) return add(`FINALE[${i}] 要是 { id, when }`);
        if (seen.has(f.id)) add(`FINALE 的 id ${f.id} 重複`);
        seen.add(f.id);
        cond(f.when, `FINALE[${i}].when`, { inFinale: true });
      });
    }
  }

  // ── 結局 ──
  if (!Array.isArray(spec.ENDINGS)) add('ENDINGS 要是有序陣列 [{ id, title, kind, when }]（恰好一個 true、恰好一個 neutral）');
  else {
    const seen = new Set();
    spec.ENDINGS.forEach((e, i) => {
      if (!isObj(e) || typeof e.id !== 'string' || !e.id) return add(`ENDINGS[${i}] 要是 { id, title, kind, when }`);
      const at = `ENDINGS.${e.id}`;
      if (seen.has(e.id)) add(`ENDINGS 的 id ${e.id} 重複`);
      seen.add(e.id);
      if (typeof e.title !== 'string') add(`${at}.title 要是字串`);
      if (!KINDS.includes(e.kind)) add(`${at}.kind 要是 true／bad／neutral（拿到 ${JSON.stringify(e.kind)}）`);
      if (e.kind !== 'neutral') {
        if (e.when === undefined) add(`${at}.when 缺少（非 neutral 的結局要有條件）`);
        else cond(e.when, `${at}.when`);
      } else if (e.when !== undefined) add(`${at}.when 沒有作用：neutral 結局不看條件（其他結局都不成立時才用它），拿掉`);
    });
    const count = k => spec.ENDINGS.filter(e => e?.kind === k).length;
    if (count('true') !== 1) add(`ENDINGS 要恰好一個 true（現在 ${count('true')} 個）`);
    if (count('neutral') !== 1) add(`ENDINGS 要恰好一個 neutral（現在 ${count('neutral')} 個）`);
    else if (spec.ENDINGS.at(-1)?.kind !== 'neutral') add(`ENDINGS 的 neutral 結局（${spec.ENDINGS.find(e => e?.kind === 'neutral').id}）要排最後`);
  }

  // ── 驗收門檻 ──
  if (spec.ACCEPTANCE !== undefined) {
    const acc = spec.ACCEPTANCE;
    if (!isObj(acc)) add('ACCEPTANCE 要是物件');
    else for (const [k, v] of Object.entries(acc)) {
      if (k === 'custom') {
        if (!Array.isArray(v)) { add('ACCEPTANCE.custom 要是 [{ id, test }] 陣列'); continue; }
        v.forEach((c, i) => {
          if (!isObj(c) || typeof c.id !== 'string') add(`ACCEPTANCE.custom[${i}].id 要是字串`);
          if (typeof c?.test !== 'function') add(`ACCEPTANCE.custom[${i}].test 要是函式 (results, spec) → 失敗訊息|null`);
        });
      } else if (!(k in ACCEPTANCE_FIELDS)) add(`ACCEPTANCE.${k} 不是已知欄位（${[...Object.keys(ACCEPTANCE_FIELDS), 'custom'].join('、')}）`);
      else if (v !== undefined) { const ok = ACCEPTANCE_FIELDS[k](v); if (ok !== true) add(`ACCEPTANCE.${k} ${ok}`); }
    }
  }
  return out;
}
