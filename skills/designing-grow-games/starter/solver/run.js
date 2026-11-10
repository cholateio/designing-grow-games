// 求解器：跑完所有放置順序（N! 種），做統計、依 spec.ACCEPTANCE 驗收、印四個只報告不擋的報告。
// 規則表一律是參數。命令列：
//   node solver/run.js <spec 路徑>           印統計與報告
//   node solver/run.js <spec 路徑> --check   另跑驗收，失敗 exit 1
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createState, place, advance } from '../rules/engine.js';
import { compile, contextOf } from '../rules/conditions.js';
import { resolve, satisfied, endingById } from '../rules/endings.js';
import { validateSpec } from '../rules/validate.js';

const countMax = (state, spec) => spec.ORDER.filter(id => state.lv[id] === spec.ITEMS[id].max).length;
const acceptance = spec => spec.ACCEPTANCE ?? {};

// 全部放完後的收尾回合（spec.CLOSING_TURNS，省略 = 0），和遊戲本體一樣
export function closing(state, spec) {
  const events = [];
  for (let i = 0; i < (spec.CLOSING_TURNS ?? 0); i++) { const r = advance(state, spec); state = r.state; events.push(...r.events); }
  return { state, events };
}

export function playOrder(order, spec) {
  let state = createState(spec);
  const events = [];
  for (const id of order) { const r = place(state, id, spec); state = r.state; events.push(...r.events); }
  { const r = closing(state, spec); state = r.state; events.push(...r.events); }
  return { state, ending: resolve(state, spec), satisfied: satisfied(state, spec), maxCount: countMax(state, spec), events };
}

// ── 死規則的收集 ──
// up／jump 條件：在 DFS 走到的每個狀態上，對還沒成立過的條件求值（成立過一次就移出待查集合）；從沒成立過 = 死規則。
//   另外看 grow 事件記下「真的讓物品升級過」的：同一回合同一物品有 jump 事件 → 用的是 jump[到達級]，否則 up[到達級]。
//   成立過、卻從沒因它而升級的另列 shadowed（多半是永遠被跳級跨過，或只在物品不在 n−1、被擋住、這回合已經長過時成立），只是提醒、不算死規則；
//   只在回合中途成立而真的用過的（狀態節點上看不到）算活的。
// fx／onLevel／stall／AFTER_TURN：引擎的事件不標示是哪一條規則發的，所以收集時用一份「影子規則表」跑：每條的 story
//   換成自己的位置標籤（story 只會被原樣抄進事件，不影響任何判斷），事件上看到標籤就知道那條發過。
function tagged(spec) {
  const rules = [], conds = [], flags = [];
  const tag = (label, a) => {
    rules.push({ label });
    if (a.flag?.name) flags.push(a.flag.name);
    if (a.branch) flags.push(`${a.branch.flag}=${a.branch.then}`, `${a.branch.flag}=${a.branch.else}`);
    if (a.grip && a.delta?.target) flags.push(`gripped_${a.delta.target}`);
    return { ...a, story: `\u0000${label}` };
  };
  const ITEMS = {};
  for (const id of spec.ORDER) {
    const it = spec.ITEMS[id];
    const cond = (label, c) => { const r = { label, test: compile(c, contextOf(spec)) }; rules.push(r); conds.push(r); };
    for (let n = 2; n <= it.max; n++) if (it.up?.[n]) cond(`ITEMS.${id}.up[${n}]`, it.up[n]);
    for (let n = 3; n <= it.max; n++) if (it.jump?.[n]) cond(`ITEMS.${id}.jump[${n}]`, it.jump[n]);
    const copy = { ...it };
    if (it.fx) copy.fx = it.fx.map((a, i) => tag(`ITEMS.${id}.fx[${i}]`, a));
    if (it.stall) copy.stall = it.stall.map((a, i) => tag(`ITEMS.${id}.stall[${i}]`, a));
    if (it.onLevel) copy.onLevel = Object.fromEntries(Object.entries(it.onLevel).map(([n, list]) => [n, list.map((a, i) => tag(`ITEMS.${id}.onLevel[${n}][${i}]`, a))]));
    for (const t of it.grip?.targets ?? []) flags.push(`gripped_${t}`);
    ITEMS[id] = copy;
  }
  const AFTER_TURN = (spec.AFTER_TURN ?? []).map((a, i) => tag(`AFTER_TURN[${i}]`, a));
  return { shadow: { ...spec, ITEMS, AFTER_TURN }, rules, conds, flags: [...new Set(flags)] };
}

function noteEvents(events, seen) {
  const jumped = new Set(events.filter(e => e.kind === 'grow' && e.jump).map(e => e.item));
  for (const e of events) {
    if (e.kind === 'grow' && !jumped.has(e.item)) seen.add(`ITEMS.${e.item}.up[${e.to}]`);
    if (e.kind === 'grow' && e.jump) seen.add(`ITEMS.${e.item}.jump[${e.to}]`);
    if (typeof e.story === 'string' && e.story.startsWith('\u0000')) seen.add(e.story.slice(1));
    if (e.flag) { seen.add(`flag:${e.flag.name}`); seen.add(`flag:${e.flag.name}=${e.flag.value}`); }
  }
}

// 深度優先走完所有順序，共用前綴的狀態（place 呼叫數約為逐條重播的 1/3）。
// 不保留事件列表（太佔記憶體）；要看事件就單獨呼叫 playOrder。
// { collect: true }：順便記下哪些規則成立過／發過，結果陣列多一個不可列舉的 collected 屬性（{ dead, shadowed }），reports() 讀它
export function enumerate(spec, { collect = false } = {}) {
  const out = [];
  const tags = collect ? tagged(spec) : null;
  const run = tags ? tags.shadow : spec;
  const seen = new Set();
  let unseen = tags ? tags.conds : [];
  const trueSeen = new Set();
  const visit = state => {
    if (!unseen.length) return;
    const left = [];
    for (const c of unseen) (c.test(state) ? trueSeen.add(c.label) : left.push(c));
    unseen = left;
  };
  const step = (state, fn) => { const r = fn(state); if (tags) { noteEvents(r.events, seen); visit(r.state); } return r.state; };
  const fail = (order, e) => {
    // 前綴就出錯：把所有以它開頭的順序都記成錯誤
    const rest = spec.ORDER.filter(id => !order.includes(id));
    const perms = a => a.length ? a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])) : [[]];
    for (const p of perms(rest)) out.push({ order: [...order, ...p], error: e.message, ending: { id: 'error' }, satisfied: [], maxCount: 0 });
  };
  const walk = (state, order) => {
    if (order.length === spec.ORDER.length) {
      try { for (let i = 0; i < (spec.CLOSING_TURNS ?? 0); i++) state = step(state, s => advance(s, run)); } catch (e) { fail(order, e); return; }
      out.push({ order, state, ending: resolve(state, spec), satisfied: satisfied(state, spec), maxCount: countMax(state, spec) });
      return;
    }
    for (const id of spec.ORDER) {
      if (state.lv[id] > 0) continue;
      const next = [...order, id];
      let s;
      try { s = step(state, st => place(st, id, run)); } catch (e) { fail(next, e); continue; }
      walk(s, next);
    }
  };
  walk(createState(spec), []);
  if (tags) {
    const isCond = r => !!r.test, used = r => seen.has(r.label);
    const dead = [
      ...tags.rules.filter(r => !used(r) && !(isCond(r) && trueSeen.has(r.label))).map(r => r.label),
      ...tags.flags.filter(f => !seen.has(`flag:${f}`)).map(f => `旗標 ${f}`),
    ];
    const shadowed = tags.conds.filter(r => !used(r) && trueSeen.has(r.label)).map(r => r.label);
    Object.defineProperty(out, 'collected', { value: { dead, shadowed }, enumerable: false });
  }
  return out;
}

// 貪婪玩家：每一步放「讓全場級數總和最高」的那個（同分取 ORDER 前面的）
export function greedyOrder(spec) {
  let state = createState(spec);
  const order = [];
  const total = s => spec.ORDER.reduce((n, id) => n + s.lv[id], 0);
  while (order.length < spec.ORDER.length) {
    let best = null;
    for (const id of spec.ORDER) {
      if (state.lv[id] > 0) continue;
      const next = place(state, id, spec).state;
      if (!best || total(next) > best.score) best = { id, state: next, score: total(next) };
    }
    order.push(best.id); state = best.state;
  }
  return order;
}

// 節奏：給定的順序逐回合重播（含收尾回合），數「有物品到 MAX」的不同回合數。
// ACCEPTANCE.minMaxTurns 有給才檢查（少於它就失敗）；每回合升級數、同回合到 MAX 數只回報
export function pacing(orders, spec) {
  const min = acceptance(spec).minMaxTurns;
  let maxGrowsPerTurn = 0, maxMaxesPerTurn = 0, maxTurns = Infinity;
  const failures = [];
  for (const r of orders) {
    let state = createState(spec);
    const steps = [...r.order.map(id => s => place(s, id, spec)), ...Array.from({ length: spec.CLOSING_TURNS ?? 0 }, () => s => advance(s, spec))];
    const turnsWithMax = new Set(); let worstGrows = 0, worstMaxes = 0;
    steps.forEach((step, t) => {
      const res = step(state); state = res.state;
      worstGrows = Math.max(worstGrows, res.events.filter(e => e.kind === 'grow').length);
      const maxed = new Set(res.events.filter(e => (e.kind === 'grow' && e.to === spec.ITEMS[e.item].max) || (e.delta && e.delta.to === spec.ITEMS[e.delta.target].max)).map(e => e.delta?.target ?? e.item));
      if (maxed.size) turnsWithMax.add(t);
      worstMaxes = Math.max(worstMaxes, maxed.size);
    });
    maxGrowsPerTurn = Math.max(maxGrowsPerTurn, worstGrows); maxMaxesPerTurn = Math.max(maxMaxesPerTurn, worstMaxes); maxTurns = Math.min(maxTurns, turnsWithMax.size);
    if (min !== undefined && turnsWithMax.size < min) {
      failures.push({ kind: 'pacing', message: `節奏：${r.order.join(',')} 只有 ${turnsWithMax.size} 個回合出現 MAX（至少 ${min}）`, order: r.order, turns: turnsWithMax.size, min });
    }
  }
  if (!orders.length) maxTurns = 0;
  return { ok: failures.length === 0, maxGrowsPerTurn, maxMaxesPerTurn, maxTurns, failures };
}

export function stats(results, spec) {
  const byEnding = {}, maxHist = new Array(spec.ORDER.length + 1).fill(0);
  let sumMax = 0;
  for (const r of results) { byEnding[r.ending.id] = (byEnding[r.ending.id] || 0) + 1; maxHist[r.maxCount]++; sumMax += r.maxCount; }
  // greedy：{ order, ending: 結局 id, maxCount }；規則壞掉跑不完時是 null（由 engineError 回報）
  let greedy = null, greedyReachesTrue = false;
  try {
    const order = greedyOrder(spec), r = playOrder(order, spec);
    greedy = { order, ending: r.ending.id, maxCount: r.maxCount };
    greedyReachesTrue = r.ending.kind === 'true';
  } catch { /* 見上 */ }
  return {
    total: results.length,
    full: results.filter(r => !r.error && r.maxCount === spec.ORDER.length),
    byEnding, avgMax: results.length ? sumMax / results.length : 0, maxHist, greedyReachesTrue, greedy,
  };
}

const titleOf = (spec, id) => endingById(spec, id)?.title ?? id;

// 驗收：門檻全部讀 spec.ACCEPTANCE。回 { ok, failures: [{ kind, message, …細節 }] }
//   trueCount      走到真結局的順序數 ≠ trueEndings（預設 1）
//   trueEnding     全 MAX 的順序卻不是真結局（GROW 的真結局就是全 MAX；分岔之類的附加條件不能讓全 MAX 落到別的結局）
//   badUnreachable 壞結局沒有任何順序成立（看 satisfied：被前面結局遮住的也算到得了）；everyBadReachable: false 關掉
//   avgMax         隨機順序平均 MAX 數 > maxAvgMax（有給才檢查）
//   greedy         貪婪順序走到真結局（greedyMustFail: false 關掉）
//   pacing         見 pacing()（minMaxTurns 有給才檢查）
//   engineError    有順序讓引擎丟出錯誤
//   custom         ACCEPTANCE.custom 的 test(results, spec) 回 null／undefined／false 以外的任何值（字串就是訊息，其他值轉成字串），或丟出錯誤
export function check(results, spec) {
  const acc = acceptance(spec), s = stats(results, spec), failures = [];
  const target = acc.trueEndings ?? 1;
  const trueOrders = results.filter(r => !r.error && r.ending.kind === 'true');
  if (trueOrders.length !== target) failures.push({ kind: 'trueCount', message: `走到真結局的順序必須剛好 ${target} 條，目前 ${trueOrders.length}`, count: trueOrders.length, target });
  for (const r of s.full) {
    if (r.ending.kind !== 'true') failures.push({ kind: 'trueEnding', message: `全 MAX 的 ${r.order.join(',')} 結局是「${titleOf(spec, r.ending.id)}」，必須是真結局`, order: r.order, ending: r.ending.id });
  }
  if (acc.everyBadReachable ?? true) {
    for (const e of (spec.ENDINGS ?? []).filter(x => x.kind === 'bad')) {
      if (!results.some(r => r.satisfied.includes(e.id))) failures.push({ kind: 'badUnreachable', message: `壞結局「${e.title ?? e.id}」沒有任何順序到得了`, id: e.id });
    }
  }
  if (acc.maxAvgMax !== undefined && s.avgMax > acc.maxAvgMax) {
    failures.push({ kind: 'avgMax', message: `隨機順序平均 MAX 數必須 ≤ ${acc.maxAvgMax}，目前 ${s.avgMax.toFixed(2)}`, avgMax: s.avgMax, limit: acc.maxAvgMax });
  }
  if ((acc.greedyMustFail ?? true) && s.greedyReachesTrue) {
    failures.push({ kind: 'greedy', message: '貪婪策略不能走到真結局', order: s.greedy.order });
  }
  failures.push(...pacing(s.full, spec).failures);
  const errs = results.filter(r => r.error);
  if (errs.length) failures.push({ kind: 'engineError', message: `${errs.length} 種順序讓引擎出錯，例如 ${errs[0].order.join(',')}：${errs[0].error}`, count: errs.length, order: errs[0].order, error: errs[0].error });
  for (const c of acc.custom ?? []) {
    let res;
    try { res = c.test(results, spec); } catch (e) { res = `執行時出錯：${e.message}`; }
    if (res !== null && res !== undefined && res !== false) failures.push({ kind: 'custom', id: c.id, message: typeof res === 'string' ? res : String(res) });
  }
  return { ok: failures.length === 0, failures };
}

// 只報告、不擋的四項：
//   singleOrderEndings 非真結局裡，resolve 剛好只有 1 條順序的（玩家幾乎看不到，通常該拿掉或放寬）
//   deadRules          全枚舉走到的狀態上從沒成立過的 up／jump 條件、從沒發過的 fx／onLevel／stall／AFTER_TURN、從沒立過的旗標
//                      （分岔旗標照值分開看）——該刪或該改的規則；enumerate 沒開 { collect: true } 時是 null
//   shadowed           （附帶）條件成立過、卻從沒因它而升級的 up／jump（多半是被跳級跨過或時機不對）；不算死規則，同樣要 collect
//   topEndingShare     最大宗結局與它佔全部順序的比例
//   positionCeiling    每個物品放在第 1..N 位時，全枚舉看到的最終最高級
export function reports(results, spec) {
  const count = {};
  for (const r of results) if (!r.error) count[r.ending.id] = (count[r.ending.id] || 0) + 1;
  const endings = spec.ENDINGS ?? [];
  const singleOrderEndings = endings.filter(e => e.kind !== 'true' && count[e.id] === 1).map(e => e.id);
  let top = null;
  for (const e of endings) if ((count[e.id] ?? 0) > (top ? count[top] : 0)) top = e.id;
  const topEndingShare = top ? { id: top, share: count[top] / results.length } : null;
  const positionCeiling = Object.fromEntries(spec.ORDER.map(id => [id, new Array(spec.ORDER.length).fill(0)]));
  for (const r of results) {
    if (r.error) continue;
    r.order.forEach((id, k) => { positionCeiling[id][k] = Math.max(positionCeiling[id][k], r.state.lv[id]); });
  }
  const col = results.collected;
  return { singleOrderEndings, deadRules: col ? col.dead : null, shadowed: col ? col.shadowed : null, topEndingShare, positionCeiling };
}

// 命令列共用：讀 spec 路徑（相對於目前目錄）、先跑 validateSpec，有問題就印出來並 exit 1
export async function loadSpec(path, usage) {
  if (!path) { console.error(usage); process.exit(2); }
  const spec = await import(pathToFileURL(resolvePath(path)).href);
  const problems = validateSpec(spec);
  if (problems.length) {
    console.log(`規則表有 ${problems.length} 個結構問題：\n${problems.map(p => '  ✖ ' + p).join('\n')}`);
    process.exit(1);
  }
  return spec;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = await loadSpec(process.argv.slice(2).find(a => !a.startsWith('--')), '用法：node solver/run.js <spec 路徑> [--check]');
  const t0 = Date.now(), results = enumerate(spec, { collect: true }), s = stats(results, spec);
  const name = id => spec.ITEMS[id].name ?? id;
  console.log(`共 ${s.total} 種順序（${Date.now() - t0} ms）`);
  console.log(`全 MAX：${s.full.length}`);
  for (const r of s.full.slice(0, 10)) console.log(`  ${r.order.map(name).join(' → ')}  ⇒ ${r.ending.title}`);
  if (s.full.length > 10) console.log(`  …另外 ${s.full.length - 10} 條`);
  console.log('結局分佈：');
  for (const [id, n] of Object.entries(s.byEnding).sort((a, b) => b[1] - a[1])) console.log(`  ${titleOf(spec, id)}（${id}） ${n}`);
  console.log(`MAX 數分佈 0..${spec.ORDER.length}：${s.maxHist.join(' ')}`);
  console.log(`平均 MAX 數：${s.avgMax.toFixed(2)}`);
  console.log(s.greedy ? `貪婪順序：${s.greedy.order.map(name).join(' → ')}  ⇒ ${titleOf(spec, s.greedy.ending)}（${s.greedy.maxCount} 個 MAX）` : '貪婪順序：引擎出錯');
  const rep = reports(results, spec);
  console.log('\n報告（只報告、不擋）：');
  console.log(`  單一順序結局：${rep.singleOrderEndings.length ? rep.singleOrderEndings.map(id => `${titleOf(spec, id)}（${id}）`).join('、') : '無'}`);
  console.log(`  死規則：${rep.deadRules.length ? '' : '無'}`);
  for (const d of rep.deadRules) console.log(`    ${d}`);
  console.log(`  條件成立過、但沒有因它而升級（多半是被跳級跨過或時機不對；不算死規則）：${rep.shadowed.length ? '' : '無'}`);
  for (const d of rep.shadowed) console.log(`    ${d}`);
  if (rep.topEndingShare) console.log(`  結局集中度：最大宗 ${titleOf(spec, rep.topEndingShare.id)}（${rep.topEndingShare.id}）佔 ${(rep.topEndingShare.share * 100).toFixed(1)}%`);
  console.log(`  位置可行性（放在第 1..${spec.ORDER.length} 位時看到的最高級）：`);
  for (const id of spec.ORDER) console.log(`    ${name(id)}（${id}，MAX ${spec.ITEMS[id].max}）：${rep.positionCeiling[id].join(' ')}`);
  if (process.argv.includes('--check')) {
    const c = check(results, spec);
    console.log(c.ok ? '\n驗收：ok' : `\n驗收失敗：\n${c.failures.map(f => `  ✖ [${f.kind}${f.id ? ':' + f.id : ''}] ${f.message}`).join('\n')}`);
    if (!c.ok) process.exit(1);
  }
}
