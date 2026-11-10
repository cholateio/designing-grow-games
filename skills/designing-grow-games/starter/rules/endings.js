// 結局判定：全部讀規則表的資料（spec.ENDINGS、spec.FINALE），程式裡沒有任何結局名。
// ENDINGS 是有序清單 [{ id, title, kind: 'true'|'bad'|'neutral', when?, line? }]：恰好一個 true、恰好一個 neutral（排最後、不需要 when）。
// FINALE 是有序清單 [{ id, when }]：收尾考驗的結果，第一個成立的就是；可省略（沒有收尾考驗的遊戲）。
import { compile, contextOf } from './conditions.js';

const COMPILED = new WeakMap();
function endingsOf(spec) {
  let list = COMPILED.get(spec);
  if (list) return list;
  const ctx = contextOf(spec);
  list = (spec.ENDINGS ?? []).map(e => ({ ...e, test: e.kind === 'neutral' ? () => true : compile(e.when, ctx) }));
  COMPILED.set(spec, list);
  return list;
}

// 收尾考驗的結果：FINALE 第一個 when 成立的 id；沒有 FINALE 或都不成立 → null
export function finaleOf(state, spec) {
  return contextOf(spec).finaleOf(state);
}

export function endingById(spec, id) {
  return (spec.ENDINGS ?? []).find(e => e.id === id) ?? null;
}

// 所有 when 成立的非 neutral 結局（true 與 bad 都列），照 ENDINGS 順序。
// 被前面結局遮住的也列：「每個壞結局都到得了」看這個；玩家實際看到的是 resolve
export function satisfied(state, spec) {
  return endingsOf(spec).filter(e => e.kind !== 'neutral' && e.test(state)).map(e => e.id);
}

// 玩家看到的結局：成立的 true 優先（extras = 其餘成立的 bad）；否則第一個成立的 bad（extras = 之後成立的 bad）；
// 都沒有 → neutral（extras = []）。finale 一併回傳給演出層
export function resolve(state, spec) {
  const list = endingsOf(spec), sat = new Set(satisfied(state, spec));
  const bad = list.filter(e => e.kind === 'bad' && sat.has(e.id)).map(e => e.id);
  const truth = list.find(e => e.kind === 'true' && sat.has(e.id));
  let ending, extras;
  if (truth) { ending = truth; extras = bad; }
  else if (bad.length) { ending = list.find(e => e.id === bad[0]); extras = bad.slice(1); }
  else {
    ending = list.find(e => e.kind === 'neutral');
    if (!ending) throw new Error('spec.ENDINGS needs one neutral ending (the fallback when nothing else holds)');
    extras = [];
  }
  return { id: ending.id, title: ending.title, kind: ending.kind, finale: finaleOf(state, spec), extras };
}
