// 收緊器：在 up[] 上逐步 AND 一條子句，讓 score 降到 0（= check 通過）。
// 只動升級條件，不碰災害、搗蛋、分岔、結局這些謎題骨架。不改檔，只印建議。
// 命令列：node solver/tighten.js <spec 路徑>
//
// score = check() 的每個失敗照 kind 加權相加；0 ⇔ check 通過。權重：
//   trueCount       |走到真結局的條數 − ACCEPTANCE.trueEndings| × 100
//   trueEnding      每條「全 MAX 卻不是真結局」50
//   greedy          20
//   avgMax          (平均 MAX 數 − maxAvgMax) × 10
//   badUnreachable  每個到不了的壞結局 30
//   pacing          每條節奏不及格的順序 10
//   engineError     1000
//   custom          每個 ACCEPTANCE.custom 失敗 30
//   其他未知的 kind  30
import { fileURLToPath } from 'node:url';
import { enumerate, check, playOrder, loadSpec } from './run.js';

// 候選子句：每個物品的每一級，AND 上「另一個物品至少／至多幾級」或「自己放下至少幾回合」
export function candidates(spec) {
  const out = [];
  for (const item of spec.ORDER) {
    const max = spec.ITEMS[item].max;
    for (let level = 2; level <= max; level++) {
      for (const other of spec.ORDER) {
        if (other === item) continue;
        for (let n = 1; n <= spec.ITEMS[other].max; n++) out.push({ item, level, cond: { minLevel: [other, n] } });
        for (let n = 0; n < spec.ITEMS[other].max; n++) out.push({ item, level, cond: { maxLevel: [other, n] } });
      }
      for (let n = 2; n <= 4; n++) out.push({ item, level, cond: { age: [item, n] } });
    }
  }
  return out;
}

// 回一份新的規則表（原物件不動）：ITEMS[item].up[level] 變成 { and: [原條件, cond] }
export function withClause(spec, { item, level, cond }) {
  const it = spec.ITEMS[item];
  return { ...spec, ITEMS: { ...spec.ITEMS, [item]: { ...it, up: { ...it.up, [level]: { and: [it.up[level], cond] } } } } };
}

// 分數 = check() 每個失敗照 kind 加權的總和；0 ⇔ check 通過。
// 門檻都在 check() 裡讀 spec.ACCEPTANCE，這裡只看失敗的種類與細節
const WEIGHTS = {
  trueCount: f => Math.abs(f.count - f.target) * 100,
  trueEnding: () => 50,
  greedy: () => 20,
  avgMax: f => Math.max(0, f.avgMax - f.limit) * 10,
  badUnreachable: () => 30,
  pacing: () => 10,
  engineError: () => 1000,
  custom: () => 30,
};
export function scoreOf(failures) {
  return failures.reduce((n, f) => n + (WEIGHTS[f.kind] ?? (() => 30))(f), 0);
}
export function score(spec) {
  return scoreOf(check(enumerate(spec), spec).failures);
}

const trueOrders = spec => enumerate(spec).filter(r => !r.error && r.ending.kind === 'true').map(r => r.order);
const fmt = c => `${c.item} up[${c.level}] += ${JSON.stringify(c.cond)}`;

// 便宜的預篩：走到真結局的順序等距抽最多 SAMPLE 條重播，估計加了子句後還剩幾條。
// 什麼都沒擋、或把真結局擋光的子句直接淘汰；離目標條數最近的排前面
const SAMPLE = 200;
function shortlist(spec, cands, orders, k) {
  const target = spec.ACCEPTANCE?.trueEndings ?? 1;
  const step = Math.max(1, Math.floor(orders.length / SAMPLE));
  const sample = orders.filter((_, i) => i % step === 0), scale = orders.length / Math.max(1, sample.length);
  const ranked = [];
  for (const c of cands) {
    const next = withClause(spec, c);
    let left = 0, broken = false;
    for (const order of sample) {
      try { if (playOrder(order, next).ending.kind === 'true') left++; } catch { broken = true; break; }
    }
    if (broken || (sample.length && left === 0) || left === sample.length) continue;
    ranked.push({ c, gap: Math.abs(left * scale - target) });
  }
  ranked.sort((a, b) => a.gap - b.gap);
  return ranked.slice(0, k).map(r => r.c);
}

// filter：只考慮通過的候選子句（例如只動 Lv3 以上，保住「Lv2 自己長」的節奏）
export function tighten(spec, { maxSteps = 40, candidateLimit = Infinity, shortlistSize = 30, filter = () => true, log = () => {} } = {}) {
  const target = spec.ACCEPTANCE?.trueEndings ?? 1;
  let cur = spec, curScore = score(spec);
  const applied = [];
  log(`起始 score ${curScore.toFixed(1)}`);
  for (let step = 0; step < maxSteps && curScore > 0; step++) {
    const orders = trueOrders(cur);
    if (orders.length <= target) { log(`走到真結局的順序只剩 ${orders.length} 條（目標 ${target}），加條件無法再改善`); break; }
    const pool = shortlist(cur, candidates(cur).filter(filter).slice(0, candidateLimit), orders, shortlistSize);
    let best = null;
    for (const c of pool) {
      const next = withClause(cur, c), sc = score(next);
      if (sc < curScore && (!best || sc < best.score)) best = { c, spec: next, score: sc };
    }
    if (!best) { log('沒有候選能再降低 score'); break; }
    cur = best.spec; curScore = best.score; applied.push(best.c);
    log(`第 ${step + 1} 步：${fmt(best.c)}  → score ${curScore.toFixed(1)}`);
  }
  if (curScore > 0) {
    const left = {};
    for (const f of check(enumerate(cur), cur).failures) left[f.kind] = (left[f.kind] ?? 0) + 1;
    log(`停在 score ${curScore.toFixed(1)}，還沒過的：${Object.entries(left).map(([k, n]) => `${k} ×${n}`).join('、')}`);
  }
  return { spec: cur, applied, finalScore: curScore };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = await loadSpec(process.argv[2], '用法：node solver/tighten.js <spec 路徑>');
  const r = tighten(spec, { log: m => console.log(m) });
  console.log(`\n最終 score ${r.finalScore.toFixed(1)}`);
  console.log(r.applied.length ? '建議貼進規則表的子句（AND 到原條件上）：' : '不需要加子句');
  for (const c of r.applied) console.log('  ' + fmt(c));
  const c = check(enumerate(r.spec), r.spec);
  console.log(c.ok ? '驗收：ok' : `仍未通過：\n${c.failures.map(f => `  ✖ [${f.kind}] ${f.message}`).join('\n')}`);
}
