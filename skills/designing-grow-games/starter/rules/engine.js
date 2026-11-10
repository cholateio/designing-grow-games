// 連鎖規則引擎：place(state, id, spec) → { state, events }。不可變、純函數，Node 與瀏覽器共用；規則表一律是參數（沒有預設）。
// 一回合的順序：放置 → 放置反應（fx）→ 災害物品（hazard）→ 搗蛋物品（grip，含不抓試跑）
// → 反覆掃描升級到不動為止（每物品每回合一步：+1 或跳級 +2；連 delta 最多比回合開始高 2 級；
//    剛放下的物品也參加，回合開始它是 0 級所以最多到 Lv2）→ 被 delay 擋住的記 stall → 等待（wait）→ 回合結束反應（AFTER_TURN）。
// 跳級：只有規則表寫的 jump[n] 會跳（在 n−2 且條件成立就一回合 +2）；沒有預設跳級，所有物品一視同仁。
import { compile, contextOf } from './conditions.js';

export const SCAN_LIMIT = 64;

const need = spec => {
  if (!spec || !Array.isArray(spec.ORDER) || !spec.ITEMS) throw new Error('spec is required: pass the rules table (ORDER, ITEMS) as the last argument');
  return spec;
};

// 條件裡提到的其他物品（看得見的因果用）。age／always／flag／allMax／finale 不算，自己不算，照 ORDER 排序。
export function condDeps(cond, self, spec) {
  const found = new Set();
  const walk = c => {
    if (!c || typeof c !== 'object') return;
    for (const key of ['minLevel', 'maxLevel']) if (key in c) found.add(c[key][0]);
    for (const key of ['present', 'absent']) if (key in c) found.add(c[key]);
    for (const key of ['and', 'or']) if (key in c) c[key].forEach(walk);
    if ('ltPlus' in c) { found.add(c.ltPlus[0]); found.add(c.ltPlus[1]); }
  };
  walk(cond); found.delete(self);
  return need(spec).ORDER.filter(id => found.has(id));
}

// 幫手：條件裡「要有／要夠高」的物品（minLevel、present），不管成不成立。「要低於／不在」的不是幫手；allMax／finale 也不是。
// grow 事件的 via 用 satisfiedHelpers（只列真的成立的）；這個留給規則設計時問「這條條件有沒有提到幫手」
export function helperDeps(cond, self, spec) {
  const found = new Set();
  const walk = c => {
    if (!c || typeof c !== 'object') return;
    if ('minLevel' in c) found.add(c.minLevel[0]);
    if ('present' in c) found.add(c.present);
    for (const key of ['and', 'or']) if (key in c) c[key].forEach(walk);
  };
  walk(cond); found.delete(self);
  return need(spec).ORDER.filter(id => found.has(id));
}

// 這次真的讓條件成立的幫手（grow 事件的 via；演出層拿 via[0] 當「因為誰」）：
// minLevel／present 成立就算；and 要整條成立才算、列全部；or 只算成立的那幾支（兩支都成立就都列）；
// maxLevel／absent／flag／age／allMax／finale 不是幫手。整條不成立 → []。自己不算，照 ORDER 排序。
// 跳級的 via 從規則表寫的 jump[n] 裡挑（turn() 先列第一級 up[n−1] 也成立的幫手）
const holdsCache = new WeakMap();
const holds = (c, s, ctx) => {
  let byCond = holdsCache.get(ctx);
  if (!byCond) { byCond = new WeakMap(); holdsCache.set(ctx, byCond); }
  let f = byCond.get(c);
  if (!f) { f = compile(c, ctx); byCond.set(c, f); }
  return f(s);
};
export function satisfiedHelpers(cond, s, self, spec) {
  const ctx = contextOf(need(spec)), found = new Set();
  const walk = c => {
    if (!c || typeof c !== 'object' || !holds(c, s, ctx)) return false;
    if ('minLevel' in c) found.add(c.minLevel[0]);
    if ('present' in c) found.add(c.present);
    if ('and' in c) c.and.forEach(walk);
    if ('or' in c) c.or.forEach(walk);
    return true;
  };
  walk(cond); found.delete(self);
  return spec.ORDER.filter(id => found.has(id));
}

// 這一刻缺的幫手：沒達標的 minLevel／present（or 已經成立就不缺）；其他原語一律略過
function missingHelpers(cond, s, self, out = new Set()) {
  if (!cond || typeof cond !== 'object') return out;
  if ('minLevel' in cond && s.lv[cond.minLevel[0]] < cond.minLevel[1] && cond.minLevel[0] !== self) out.add(cond.minLevel[0]);
  if ('present' in cond && !(s.lv[cond.present] > 0) && cond.present !== self) out.add(cond.present);
  if ('and' in cond) cond.and.forEach(c => missingHelpers(c, s, self, out));
  if ('or' in cond) { const before = out.size, tmp = new Set(); cond.or.forEach(c => missingHelpers(c, s, self, tmp)); if (tmp.size && before === out.size) for (const id of tmp) out.add(id); }
  return out;
}

const compiled = new WeakMap();
function rulesOf(spec) {
  need(spec);
  if (compiled.has(spec)) return compiled.get(spec);
  const ctx = contextOf(spec);
  const cAct = a => ({ ...a, test: a.when ? compile(a.when, ctx) : () => true, branchTest: a.branch ? compile(a.branch.when, ctx) : null });
  const r = { ctx, items: {} };
  for (const id of spec.ORDER) {
    const it = spec.ITEMS[id];
    const up = {}, jump = {}, jumpRaw = {}, delay = {};
    for (const n in it.up) up[n] = compile(it.up[n], ctx);
    // 跳級只編譯規則表寫的 jump[n]（沒有預設跳級）。jumpRaw 留著原條件，升級事件的 via 在決定的那一刻用 satisfiedHelpers 算
    for (let n = 3; n <= it.max; n++) if (it.jump?.[n]) { jump[n] = compile(it.jump[n], ctx); jumpRaw[n] = it.jump[n]; }
    for (const n in it.delay || {}) delay[n] = compile(it.delay[n], ctx);
    const hazard = it.hazard ? compile(it.hazard.while, ctx) : null;
    const grip = it.grip ? { while: compile(it.grip.while, ctx), targets: it.grip.targets, story: it.grip.story } : null;
    const onLevel = {};
    for (const n in it.onLevel || {}) onLevel[n] = it.onLevel[n].map(cAct);
    r.items[id] = { max: it.max, up, jump, jumpRaw, delay, raw: it.up, fx: (it.fx || []).map(cAct), hazard, grip, onLevel, stall: (it.stall || []).map(cAct) };
  }
  r.after = (spec.AFTER_TURN || []).map(cAct);
  compiled.set(spec, r);
  return r;
}

export function createState(spec) {
  need(spec);
  const lv = {}, age = {}, held = {};
  for (const id of spec.ORDER) { lv[id] = 0; age[id] = -1; held[id] = -1; }
  return { lv, age, held, locked: {}, flags: {}, order: [], turn: 0 };
}

// 演出層共用：把一個事件疊到 { lv, flags } 上（舞台的鏡像、逐事件回報全場狀態）。純函數，不改輸入。
export function foldEvent(view, e) {
  let { lv, flags } = view;
  if (e.kind === 'placed') lv = { ...lv, [e.item]: 1 };
  else if (e.kind === 'grow') lv = { ...lv, [e.item]: e.to };
  if (e.delta) lv = { ...lv, [e.delta.target]: e.delta.to };
  if (e.flag) flags = { ...flags, [e.flag.name]: e.flag.value };
  return lv === view.lv && flags === view.flags ? view : { lv, flags };
}

// 規則表裡會把物品鎖住的那幾條：{ 被鎖的物品: 同一條立的旗標 }。
// 演出層只有 lv 與 flags、看不到 locked，旗標立了就當那個物品鎖住了（起因提示、搗蛋物品的目標判斷共用）。每份規則表算一次
const LOCK_FLAGS = new WeakMap();
export function lockFlags(spec) {
  if (!spec) return {};
  if (!LOCK_FLAGS.has(spec)) {
    const acts = [...Object.values(spec.ITEMS ?? {}).flatMap(it => [...Object.values(it.onLevel ?? {}).flat(), ...(it.fx ?? []), ...(it.stall ?? [])]), ...(spec.AFTER_TURN ?? [])];
    LOCK_FLAGS.set(spec, Object.fromEntries(acts.filter(a => a?.lock && a.flag?.name).map(a => [a.lock, a.flag.name])));
  }
  return LOCK_FLAGS.get(spec);
}

// 被抓住：gripped_<id> 記著抓它的那個 w，w 的 grip.while 這一刻還成立 → 回 w；否則 null。
// 引擎的掃描、等待與演出層共用；state 只要有 lv、flags
export function grippedBy(state, id, spec) {
  const w = state.flags?.[`gripped_${id}`];
  if (typeof w !== 'string') return null;
  const g = rulesOf(spec).items[w]?.grip;
  return g && g.while(state) ? w : null;
}
export const isPlaced = (state, id) => state.lv[id] > 0;
export const isComplete = state => Object.values(state.lv).every(n => n > 0);
export const isAllMax = (state, spec) => need(spec).ORDER.every(id => state.lv[id] === spec.ITEMS[id].max);

// 套用一條 Action；成立就把事件推進 events。會直接改 s（呼叫端已拷貝）。
// 正向 delta 跨過的每一級，都會接著觸發那一級的 onLevel（「被加上去」也算升級）。
// 連鎖深度與掃描共用同一個上限，病態規則一律丟出帶物品名的錯誤。
function applyAction(s, a, kind, cause, rules, events, depth = 0) {
  const ev = actionEvent(s, a, kind, cause, rules);
  if (!ev) return;
  events.push(ev);
  if (ev.delta && ev.delta.to > ev.delta.from) {
    const { target, from, to } = ev.delta;
    if (depth >= SCAN_LIMIT) throw new Error(`delta chain limit ${SCAN_LIMIT} exceeded at ${target}`);
    for (let n = from + 1; n <= to; n++) for (const b of rules.items[target].onLevel[n] || []) applyAction(s, b, 'fx', target, rules, events, depth + 1);
  }
}

// 每回合開始時各物品的級數（+2 上限用）；鍵是 turn() 裡的工作狀態，回合結束就沒人引用
const turnStart = new WeakMap();
// 這回合被負向 delta 打到的物品：這回合不再升級、也不列在等待裡（避免「降級」緊接著「升級」）。
// 只要那條負向 delta 發了就算（已經在 Lv1、壓在 1 沒真的掉級也算被打到）。鍵同 turnStart
const knockedOf = new WeakMap();

function actionEvent(s, a, kind, cause, rules) {
  if (!a.test(s)) return null;
  const ev = { kind, item: cause, cause };
  if (a.delta) {
    const { target, by } = a.delta;
    if (!(s.lv[target] > 0)) return null;
    // 每回合每物品最多 +2，delta 也算：正向 delta 壓到「回合開始的級數 +2」，壓到不動就整條不發
    const cap = by > 0 ? (turnStart.get(s)?.[target] ?? s.lv[target]) + 2 : Infinity;
    const from = s.lv[target], to = Math.max(1, Math.min(rules.items[target].max, from + by, Math.max(from, cap)));
    if (by > 0 && to === from) return null;
    s.lv[target] = to; if (to !== from) s.held[target] = 0;
    if (by < 0) knockedOf.get(s)?.add(target);
    ev.item = target;
    ev.delta = { target, from, to };
  }
  // grip: true：這條 delta 同時抓住目標——立 gripped_<目標> = 施動者，grippedBy 讀它；被抓的在施動者 grip.while 成立期間不長
  if (a.grip && ev.delta) { const name = `gripped_${ev.delta.target}`; s.flags[name] = cause; ev.flag = { name, value: cause }; }
  if (a.lock) { s.locked[a.lock] = true; ev.lock = a.lock; }
  if (a.flag) { const value = a.flag.value ?? true; s.flags[a.flag.name] = value; ev.flag = { name: a.flag.name, value }; }
  if (a.branch) { const value = a.branchTest(s) ? a.branch.then : a.branch.else; s.flags[a.branch.flag] = value; ev.flag = { name: a.branch.flag, value }; }
  if (a.story !== undefined) ev.story = a.story;
  return ev;
}

export function place(state, id, spec) {
  const rules = rulesOf(spec);
  if (!(id in rules.items)) throw new Error(`unknown item ${id}`);
  if (state.lv[id] > 0) throw new Error(`${id} already placed`);
  return turn(state, id, spec, rules);
}

// 沒有放置的回合（全部放完後再長 spec.CLOSING_TURNS 回合，才進收尾考驗）
export function advance(state, spec) { return turn(state, null, spec, rulesOf(spec)); }

// noGrip：試跑用——這回合不抓、也不再試跑
function turn(state, id, spec, rules, { noGrip = false } = {}) {
  const s = { lv: { ...state.lv }, age: { ...state.age }, held: { ...state.held }, locked: { ...state.locked }, flags: { ...state.flags }, order: id ? [...state.order, id] : [...state.order], turn: state.turn + 1 };
  const events = [];

  // age = 放下幾回合；held = 停在目前這一級幾回合（delay 用；升級或被 delta 改級就歸零）
  for (const k of spec.ORDER) if (s.lv[k] > 0) { s.age[k] += 1; s.held[k] = (s.held[k] ?? 0) + 1; }
  turnStart.set(s, { ...s.lv });
  const knocked = new Set(); knockedOf.set(s, knocked);
  if (id) {
    s.lv[id] = 1; s.age[id] = 0; s.held[id] = 0;
    events.push({ kind: 'placed', item: id, to: 1, story: spec.STORIES?.placed?.[id] });
    for (const a of rules.items[id].fx) applyAction(s, a, 'fx', id, rules, events);
    // 災害物品：hazard.while 成立的物品 w（看的是回合開始的級數——成長掃描還沒跑），
    // 對剛放下的 id 跑 w 的 fx 裡 lock === id 的那幾條（照常測 when），事件照一般 fx 格式（cause w）。物品不寫死，全由規則表宣告
    for (const w of spec.ORDER) {
      const hz = rules.items[w];
      if (w === id || !hz.hazard?.(s)) continue;
      for (const a of hz.fx) if (a.lock === id) applyAction(s, a, 'fx', w, rules, events);
    }
    // 搗蛋物品：grip.while 成立的物品 w 抓住剛放下的 id（在 grip.targets 裡）：立 gripped_<id> = w（記下是誰抓的）、
    // 發 fx 事件（item 是被抓的那個，cause w；故事句在規則表 grip.story）。被抓的在 w 的 grip.while 還成立期間不長（見 grippedBy）。
    // 不抓：剛放下就被災害鎖住的；這回合結束時 w 已經離開 grip.while 的（不演「抓了當回合又放開」）。
    // 後者先「不抓」試跑一次這回合（同一個 turn()、從回合開始的 state 再跑一份工作狀態、事件不往外發；試跑裡不抓、也不再試跑），
    // 試跑結束時看 w 的 grip.while。一個物品只被抓一次（ORDER 裡第一個抓的）
    let trial = null;
    for (const w of spec.ORDER) {
      const g = rules.items[w].grip;
      if (noGrip || w === id || !g?.targets.includes(id) || !g.while(s) || s.locked[id]) continue;
      trial ??= turn(state, id, spec, rules, { noGrip: true }).state;
      if (!g.while(trial)) continue;
      const name = `gripped_${id}`;
      s.flags[name] = w;
      const ev = { kind: 'fx', item: id, cause: w, flag: { name, value: w } };
      if (g.story?.[id] !== undefined) ev.story = g.story[id];
      events.push(ev);
      break;
    }
  }
  // 被抓住的物品：抓它的那個（旗標值）的 grip.while 這一刻還成立 → 回它（擋著）；否則 null。
  // 每次都照這一刻的狀態算：同一回合 w 離開 grip.while 之後，k 在同一輪或下一輪掃描就長
  const gripperOf = k => grippedBy(s, k, spec);

  // 每回合每個物品只走一步：在 n−2 且 jump[n] 成立就跳（+2；只有規則表寫的 jump[n]），否則 up 成立就 +1；
  // 連 delta 在內一回合最多比回合開始高 2 級。剛放下的物品當回合也參加掃描（回合開始它是 0 級，所以最多到 Lv2）。
  // 照 ORDER 反覆掃到不動為止（A 升了讓 B 升的連鎖還在），掃到誰就當場決定，不為了等跳級延後 +1。
  // delay[n] 成立時，第 n 級要在上一級多停一回合（held ≥ 2）。
  // 這回合被負向 delta 打到的（knocked）不參加掃描；掃描途中才被打到的（onLevel 的負向 delta）從那一刻起也不再長。
  const stalled = new Set(), grown = new Set(), start = turnStart.get(s);
  const delayed = (k, n) => { const d = rules.items[k].delay[n]; return !!d && d(s) && s.held[k] < 2; };
  let lastGrown = null;
  for (let scan = 0; ; scan++) {
    if (scan >= SCAN_LIMIT) throw new Error(`scan limit ${SCAN_LIMIT} exceeded while growing ${lastGrown}`);
    let changed = false;
    for (const k of spec.ORDER) {
      const it = rules.items[k], lv = s.lv[k];
      if (lv === 0 || lv >= it.max || s.locked[k] || grown.has(k) || knocked.has(k) || gripperOf(k)) continue;
      const st = it.stall.find(r => r.test(s));
      if (st) {
        if (!stalled.has(k)) { stalled.add(k); const e = { kind: 'stall', item: k }; if (st.story !== undefined) e.story = st.story; events.push(e); }
        continue;
      }
      const room = start[k] + 2, ready = n => n <= room && !delayed(k, n);
      const jump = lv + 2 <= it.max && it.jump[lv + 2] && ready(lv + 2) && it.jump[lv + 2](s);
      if (!jump && !(ready(lv + 1) && it.up[lv + 1](s))) continue;
      const to = jump ? lv + 2 : lv + 1;
      // via 在改級之前算（條件是照這一刻的全場狀態成立的）；跳級的兩個事件共用同一份。
      // 跳級：先列第一級（up[n−1]）成立的幫手、再列只有第二級才有的（各自照 ORDER）——演出層拿 via[0] 當第一級的起因，
      // 照 ORDER 混排的話常常是第二級的幫手跑去當第一級的原因。都只從整條跳級條件真的成立的那幾支裡挑
      const all = satisfiedHelpers(jump ? it.jumpRaw[to] : it.raw[to], s, k, spec);
      const first = jump ? satisfiedHelpers(it.raw[lv + 1], s, k, spec).filter(h => all.includes(h)) : all;
      const via = [...first, ...all.filter(h => !first.includes(h))];
      lastGrown = k; changed = true; grown.add(k);
      for (let n = lv + 1; n <= to; n++) {
        s.lv[k] = n; s.held[k] = 0;
        const e = { kind: 'grow', item: k, from: n - 1, to: n, story: spec.STORIES?.grow?.[k]?.[n], via: [...via] };
        if (jump && n === to) e.jump = true;
        events.push(e);
        for (const a of it.onLevel[n] || []) applyAction(s, a, 'fx', k, rules, events);
      }
    }
    if (!changed) break;
  }

  // 只差多等一回合的物品（+1 條件成立、delay[n] 擋著）：記一個 stall 事件；不算在等誰
  for (const k of spec.ORDER) {
    const it = rules.items[k], lv = s.lv[k], n = lv + 1;
    if (lv === 0 || lv >= it.max || s.locked[k] || grown.has(k) || knocked.has(k) || stalled.has(k) || k === id || gripperOf(k)) continue;
    if (delayed(k, n) && it.up[n](s)) { stalled.add(k); events.push({ kind: 'stall', item: k }); }
  }

  // 等不到幫手的物品：整回合合成一個 wait 事件，for = 這一刻缺的幫手（剛放的、這回合升過的、被負向 delta 打到的、卡在 stall 的不算；
  // 只被「要低於／不在」擋住的不算在等誰；剛放的照舊不算——它當回合也參加掃描，但「還沒開始等」）
  const waits = [];
  for (const k of spec.ORDER) {
    const it = rules.items[k], lv = s.lv[k];
    if (lv === 0 || lv >= it.max || s.locked[k] || grown.has(k) || knocked.has(k) || stalled.has(k)) continue;
    // 被抓住的等的是抓它的那個，連放下那回合也列
    const gripper = gripperOf(k);
    if (gripper) { waits.push({ item: k, for: [gripper] }); continue; }
    if (k === id || it.up[lv + 1](s)) continue;
    const missing = missingHelpers(it.raw[lv + 1], s, k);
    if (missing.size) waits.push({ item: k, for: spec.ORDER.filter(id => missing.has(id)) });
  }
  if (waits.length) events.push({ kind: 'wait', item: waits[0].item, waits });

  for (const a of rules.after) applyAction(s, a, 'after', id ?? 'turn', rules, events);
  return { state: s, events };
}
