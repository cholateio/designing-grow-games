// 條件語言：把規則表裡的條件物件編譯成 (state) => boolean。
// state 形狀：{ lv: {id: n}, age: {id: n|-1}, held: {id: n|-1}, flags: {}, locked: {id: bool} }，0 = 未放置。
// ctx：{ max: {id: 最高級}, finaleOf(state) → 收尾結果 id|null }，由 contextOf(spec) 建；引擎與結局判定共用同一份。
export function compile(cond, ctx) {
  if (!cond || typeof cond !== 'object') throw new Error('bad cond ' + JSON.stringify(cond));
  if (cond.always) return () => true;
  if ('present' in cond) { const id = cond.present; return s => s.lv[id] > 0; }
  if ('absent' in cond) { const id = cond.absent; return s => s.lv[id] === 0; }
  if (cond.minLevel) { const [id, n] = cond.minLevel; return s => s.lv[id] >= n; }
  // maxLevel 是絕對語意：未放置的 0 也算成立
  if (cond.maxLevel) { const [id, n] = cond.maxLevel; return s => s.lv[id] <= n; }
  if (cond.ltPlus) { const [a, b, k] = cond.ltPlus; return s => s.lv[a] < s.lv[b] + k; }
  if (cond.age) { const [id, n] = cond.age; return s => s.lv[id] > 0 && s.age[id] >= n; }
  if ('flag' in cond) { const name = cond.flag; if ('is' in cond) { const v = cond.is; return s => s.flags[name] === v; } return s => !!s.flags[name]; }
  if ('locked' in cond) { const id = cond.locked; return s => !!s.locked[id]; }
  // 所有物品都到最高級（真結局常用）。不是幫手：引擎的 via／wait 一律略過
  if (cond.allMax === true) {
    if (!ctx?.max) throw new Error('allMax needs ctx.max (use contextOf(spec))');
    const entries = Object.entries(ctx.max);
    return s => entries.every(([id, n]) => s.lv[id] === n);
  }
  // 收尾考驗的結果是 id。規則表沒有 FINALE（ctx 沒有 finaleOf）時永遠不成立。也不是幫手
  if ('finale' in cond) { const id = cond.finale; return s => (ctx?.finaleOf ? ctx.finaleOf(s) : null) === id; }
  if (cond.and) { const fs = cond.and.map(c => compile(c, ctx)); return s => fs.every(f => f(s)); }
  if (cond.or) { const fs = cond.or.map(c => compile(c, ctx)); return s => fs.some(f => f(s)); }
  if (cond.not) { const f = compile(cond.not, ctx); return s => !f(s); }
  throw new Error('bad cond ' + JSON.stringify(cond));
}

// 每份規則表一個 ctx：max 照 ORDER 取各物品最高級；finaleOf 第一次用到才編譯 FINALE，回第一個 when 成立的 id，都不成立回 null
const CONTEXTS = new WeakMap();
export function contextOf(spec) {
  let ctx = CONTEXTS.get(spec);
  if (ctx) return ctx;
  ctx = { max: Object.fromEntries(spec.ORDER.map(id => [id, spec.ITEMS[id].max])) };
  let finale = null;
  ctx.finaleOf = s => {
    finale ??= (spec.FINALE ?? []).map(f => ({ id: f.id, test: compile(f.when, ctx) }));
    for (const f of finale) if (f.test(s)) return f.id;
    return null;
  };
  CONTEXTS.set(spec, ctx);
  return ctx;
}
