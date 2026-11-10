import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closing, playOrder, enumerate, greedyOrder, pacing, stats, check, reports } from '../solver/run.js';
import { createState, place } from '../rules/engine.js';
import * as mini from './helpers/mini.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MINI = fileURLToPath(new URL('./helpers/mini.js', import.meta.url));
const node = (...args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
const TRUE_ORDER = ['beta', 'alpha', 'gamma', 'delta'];
const variant = patch => ({ ...mini, ...patch });
const accept = patch => variant({ ACCEPTANCE: { ...mini.ACCEPTANCE, ...patch } });
const withItem = (id, patch) => variant({ ITEMS: { ...mini.ITEMS, [id]: { ...mini.ITEMS[id], ...patch } } });
const kinds = c => c.failures.map(f => f.kind);

const results = enumerate(mini, { collect: true });

// ── 跑一條順序、全枚舉 ──
test('playOrder: places every item, runs CLOSING_TURNS more turns, resolves the ending', () => {
  const r = playOrder(TRUE_ORDER, mini);
  assert.deepEqual(r.state.lv, { alpha: 4, beta: 4, gamma: 3, delta: 3 });
  assert.equal(r.state.turn, 4 + mini.CLOSING_TURNS);
  assert.equal(r.ending.id, 'bloom');
  assert.equal(r.ending.kind, 'true');
  assert.deepEqual(r.satisfied, ['bloom']);
  assert.equal(r.maxCount, 4);
  assert.ok(r.events.some(e => e.kind === 'placed') && r.events.some(e => e.kind === 'grow'));
});
test('closing: advances CLOSING_TURNS turns (0 when the spec leaves it out)', () => {
  let s = createState(mini);
  for (const id of TRUE_ORDER) s = place(s, id, mini).state;
  assert.equal(closing(s, mini).state.turn, s.turn + 1);
  assert.equal(closing(s, variant({ CLOSING_TURNS: undefined })).state.turn, s.turn);
});
test('enumerate: all 24 orders, each matching a single playOrder replay', () => {
  assert.equal(results.length, 24);
  assert.equal(new Set(results.map(r => r.order.join(','))).size, 24);
  for (const r of results) {
    const p = playOrder(r.order, mini);
    assert.equal(r.ending.id, p.ending.id, r.order.join(','));
    assert.deepEqual(r.satisfied, p.satisfied);
    assert.equal(r.maxCount, p.maxCount);
    assert.deepEqual(r.state.lv, p.state.lv);
  }
});
test('enumerate: { collect: true } gives the same results as a plain run', () => {
  const plain = enumerate(mini);
  assert.deepEqual(results.map(r => [r.order, r.ending, r.satisfied, r.maxCount, r.state.lv, r.state.flags]),
    plain.map(r => [r.order, r.ending, r.satisfied, r.maxCount, r.state.lv, r.state.flags]));
  assert.equal(Object.keys(results).includes('collected'), false, 'collected is not enumerable');
});
test('enumerate: an engine error marks every order under that prefix as an error', () => {
  const broken = withItem('gamma', { up: { ...mini.ITEMS.gamma.up, 2: { bogus: 1 } } });
  const rs = enumerate(broken);
  assert.equal(rs.length, 24);
  assert.ok(rs.every(r => r.error && r.ending.id === 'error' && r.maxCount === 0));
});

// ── 統計 ──
test('stats: totals, the full-MAX list, the ending distribution, greedy', () => {
  const s = stats(results, mini);
  assert.equal(s.total, 24);
  assert.equal(Object.values(s.byEnding).reduce((a, b) => a + b, 0), 24);
  assert.deepEqual(s.byEnding, { wild: 2, flooded: 18, bloom: 1, washed: 3 });
  assert.deepEqual(s.full.map(r => r.order.join(',')), [TRUE_ORDER.join(',')]);
  assert.equal(s.maxHist.length, 5);
  assert.equal(s.maxHist.reduce((a, b) => a + b, 0), 24);
  assert.equal(s.avgMax, results.reduce((n, r) => n + r.maxCount, 0) / 24);
  assert.equal(s.greedyReachesTrue, false);
  assert.deepEqual(s.greedy, { order: ['alpha', 'beta', 'delta', 'gamma'], ending: 'wild', maxCount: 2 });
});
test('greedyOrder: each step places the item that makes the level total highest (ties → ORDER)', () => {
  assert.deepEqual(greedyOrder(mini), ['alpha', 'beta', 'delta', 'gamma']);
});
test('pacing: replays the given orders and counts the turns where something reaches MAX', () => {
  const full = stats(results, mini).full;
  const p = pacing(full, mini);
  assert.equal(p.ok, true, 'no minMaxTurns in ACCEPTANCE: nothing to fail');
  assert.ok(p.maxTurns >= 1 && p.maxGrowsPerTurn >= 1 && p.maxMaxesPerTurn >= 1);
  const strict = pacing(full, accept({ minMaxTurns: 99 }));
  assert.equal(strict.ok, false);
  assert.equal(strict.failures[0].kind, 'pacing');
  assert.deepEqual(strict.failures[0].order, TRUE_ORDER);
});

// ── 驗收 ──
test('check: the mini spec passes every ACCEPTANCE item', () => {
  const c = check(results, mini);
  assert.deepEqual(c.failures, []);
  assert.equal(c.ok, true);
});
test('check: trueEndings 2 → a trueCount failure with the count and the target', () => {
  const spec = accept({ trueEndings: 2 });
  const c = check(enumerate(spec), spec);
  assert.equal(c.ok, false);
  assert.deepEqual(kinds(c), ['trueCount']);
  assert.equal(c.failures[0].count, 1);
  assert.equal(c.failures[0].target, 2);
  assert.equal(typeof c.failures[0].message, 'string');
});
test('check: trueEndings defaults to 1 when ACCEPTANCE leaves it out', () => {
  const spec = variant({ ACCEPTANCE: undefined });
  assert.equal(check(enumerate(spec), spec).ok, true);
});
test('check: a full-MAX order that misses the true ending → trueEnding', () => {
  // 拿掉 wild 踢壞工坊那條：alpha,beta,gamma,delta 全 MAX 卻是 wild
  const delta = mini.ITEMS.delta;
  const spec = withItem('delta', { onLevel: { 3: delta.onLevel[3].slice(0, 1) } });
  const c = check(enumerate(spec), spec);
  assert.deepEqual(kinds(c), ['trueEnding']);
  assert.deepEqual(c.failures[0].order, ['alpha', 'beta', 'gamma', 'delta']);
  assert.equal(c.failures[0].ending, 'wild');
});
test('check: a bad ending nothing reaches → badUnreachable (unless everyBadReachable is false)', () => {
  const ENDINGS = [...mini.ENDINGS.slice(0, -1), { id: 'never', title: '不會發生', kind: 'bad', when: { flag: 'never' } }, mini.ENDINGS.at(-1)];
  const spec = variant({ ENDINGS });
  const c = check(enumerate(spec), spec);
  assert.deepEqual(kinds(c), ['badUnreachable']);
  assert.equal(c.failures[0].id, 'never');
  const off = variant({ ENDINGS, ACCEPTANCE: { ...mini.ACCEPTANCE, everyBadReachable: false } });
  assert.equal(check(enumerate(off), off).ok, true);
});
test('check: a bad ending masked in resolve still counts as reachable (looks at satisfied)', () => {
  assert.equal(results.filter(r => r.ending.id === 'fallen').length, 0);
  assert.ok(results.some(r => r.satisfied.includes('fallen')));
  assert.ok(!check(results, mini).failures.some(f => f.kind === 'badUnreachable'));
});
test('check: maxAvgMax and minMaxTurns are only checked when given', () => {
  const s = stats(results, mini);
  const tight = accept({ maxAvgMax: 0 });
  const c = check(results, tight);
  assert.deepEqual(kinds(c), ['avgMax']);
  assert.equal(c.failures[0].avgMax, s.avgMax);
  assert.equal(c.failures[0].limit, 0);
  assert.equal(check(results, accept({ maxAvgMax: s.avgMax })).ok, true);
  assert.deepEqual(kinds(check(results, accept({ minMaxTurns: 99 }))), ['pacing']);
});
test('check: greedy reaching the true ending → greedy (unless greedyMustFail is false)', () => {
  // 真結局放寬到「alpha 在場」：每條順序都是真結局，貪婪也是
  const ENDINGS = mini.ENDINGS.map(e => e.kind === 'true' ? { ...e, when: { present: 'alpha' } } : e);
  const spec = variant({ ENDINGS, ACCEPTANCE: { ...mini.ACCEPTANCE, trueEndings: 24 } });
  const c = check(enumerate(spec), spec);
  assert.ok(kinds(c).includes('greedy'));
  assert.deepEqual(c.failures.find(f => f.kind === 'greedy').order, ['alpha', 'beta', 'delta', 'gamma']);
  const off = variant({ ENDINGS, ACCEPTANCE: { ...spec.ACCEPTANCE, greedyMustFail: false } });
  assert.ok(!kinds(check(enumerate(off), off)).includes('greedy'));
});
test('check: custom tests — any other truthy result is a failure too; null, undefined and false pass', () => {
  const spec = accept({ custom: [
    { id: 'undef', test: () => undefined },
    { id: 'no', test: () => false },
    { id: 'yes', test: () => true },
    { id: 'num', test: () => 3 },
  ] });
  const c = check(results, spec);
  assert.deepEqual(c.failures, [{ kind: 'custom', id: 'yes', message: 'true' }, { kind: 'custom', id: 'num', message: '3' }]);
});
test('check: custom tests — a string is a failure, null passes, a throw is a failure', () => {
  const spec = accept({ custom: [
    { id: 'pass', test: () => null },
    { id: 'shareOfFlooded', test: (rs, sp) => `flooded ${rs.filter(r => r.ending.id === 'flooded').length} of ${rs.length} (${sp.TITLE})` },
    { id: 'boom', test: () => { throw new Error('oops'); } },
  ] });
  const c = check(results, spec);
  assert.deepEqual(kinds(c), ['custom', 'custom']);
  assert.deepEqual(c.failures[0], { kind: 'custom', id: 'shareOfFlooded', message: `flooded 18 of 24 (${mini.TITLE})` });
  assert.equal(c.failures[1].id, 'boom');
  assert.match(c.failures[1].message, /oops/);
});
test('check: engine errors → engineError with the count and an example', () => {
  const broken = withItem('gamma', { up: { ...mini.ITEMS.gamma.up, 2: { bogus: 1 } } });
  const c = check(enumerate(broken), broken);
  const f = c.failures.find(x => x.kind === 'engineError');
  assert.ok(f);
  assert.equal(f.count, 24);
  assert.match(f.error, /bad cond/);
  assert.equal(f.order.length, 4);
});

// ── 報告（只報告不擋） ──
test('reports: singleOrderEndings lists non-true endings whose resolve count is exactly 1', () => {
  assert.deepEqual(reports(results, mini).singleOrderEndings, [], 'bloom is the true ending; wild has 2 orders');
  const oneWild = results.filter(r => r.order.join(',') !== 'alpha,beta,gamma,delta');
  assert.deepEqual(reports(oneWild, mini).singleOrderEndings, ['wild']);
});
test('reports: deadRules — up/jump conditions never true, fx/onLevel/AFTER_TURN never fired, flags never set', () => {
  assert.deepEqual(reports(results, mini).deadRules, ['ITEMS.beta.fx[0]', '旗標 ghost']);
  const spec = withItem('delta', { up: { ...mini.ITEMS.delta.up, 3: { and: [{ present: 'gamma' }, { absent: 'gamma' }] } } });
  const dead = reports(enumerate(spec, { collect: true }), spec).deadRules;
  for (const rule of ['ITEMS.delta.up[3]', 'ITEMS.delta.onLevel[3][0]', 'ITEMS.delta.onLevel[3][1]', '旗標 fate=tame', '旗標 fate=wild']) assert.ok(dead.includes(rule), rule);
  const after = variant({ AFTER_TURN: [...mini.AFTER_TURN, { when: { locked: 'delta' }, flag: { name: 'never' } }] });
  const deadAfter = reports(enumerate(after, { collect: true }), after).deadRules;
  assert.ok(deadAfter.includes('AFTER_TURN[1]') && deadAfter.includes('旗標 never'));
  assert.ok(!deadAfter.includes('AFTER_TURN[0]'));
});
test('reports: shadowed — conditions true somewhere that never caused growth (not dead)', () => {
  // mini 的 alpha.jump[4] 在 alpha 已經 4 級時成立，但從沒讓 alpha 跳級
  const r = reports(results, mini);
  assert.ok(r.shadowed.includes('ITEMS.alpha.jump[4]'));
  assert.ok(!r.deadRules.includes('ITEMS.alpha.jump[4]'));
  // gamma 放下的下一回合一定 jump[3]：up[2]、up[3] 都成立過，卻永遠被跳級跨過
  const spec = withItem('gamma', { jump: { 3: { age: ['gamma', 1] } } });
  const rs = enumerate(spec, { collect: true }), rep = reports(rs, spec);
  for (const rule of ['ITEMS.gamma.up[2]', 'ITEMS.gamma.up[3]']) {
    assert.ok(rep.shadowed.includes(rule), rule);
    assert.ok(!rep.deadRules.includes(rule), rule);
  }
  assert.ok(!rep.shadowed.includes('ITEMS.gamma.jump[3]') && !rep.deadRules.includes('ITEMS.gamma.jump[3]'), 'the jump is used');
});
test('reports: deadRules and shadowed are null when enumerate ran without { collect: true }', () => {
  assert.equal(reports(enumerate(mini), mini).deadRules, null);
  assert.equal(reports(enumerate(mini), mini).shadowed, null);
});
test('reports: topEndingShare is the biggest ending and its share of all orders', () => {
  assert.deepEqual(reports(results, mini).topEndingShare, { id: 'flooded', share: 18 / 24 });
});
test('reports: positionCeiling — the highest final level of each item placed 1st..Nth', () => {
  assert.deepEqual(reports(results, mini).positionCeiling, {
    alpha: [4, 4, 1, 1], beta: [4, 3, 1, 1], gamma: [3, 3, 3, 2], delta: [1, 1, 3, 3],
  });
});

// ── 命令列 ──
test('CLI: run.js <spec> --check prints the stats, the reports and passes', () => {
  const r = node('solver/run.js', MINI, '--check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const s of ['共 24 種順序', '全 MAX：1', '結局分佈', '貪婪順序', '單一順序結局', '死規則', '條件成立過、但沒有因它而升級', 'ITEMS.alpha.jump[4]', '結局集中度', '位置', '驗收：ok']) assert.ok(r.stdout.includes(s), s);
});
test('CLI: run.js exits 1 with the failures when ACCEPTANCE fails, and 2 without a spec path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solver-'));
  try {
    const file = join(dir, 'strict.js');
    writeFileSync(file, `export * from ${JSON.stringify(MINI)};\nexport const ACCEPTANCE = { trueEndings: 2 };\n`);
    const r = node('solver/run.js', file, '--check');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /trueCount/);
    assert.equal(node('solver/run.js').status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLI: run.js stops on validateSpec problems before running the engine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solver-'));
  try {
    const file = join(dir, 'bad.js');
    writeFileSync(file, `export * from ${JSON.stringify(MINI)};\nexport const ORDER = ['alpha', 'beta', 'gamma', 'delta', 'omega'];\n`);
    const r = node('solver/run.js', file);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /omega/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLI: tools/solutions.mjs writes the spoiler sheet titled from spec.TITLE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solutions-'));
  try {
    const out = join(dir, 'docs', 'solutions.md');
    const r = node('tools/solutions.mjs', MINI, out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const md = readFileSync(out, 'utf8');
    assert.ok(md.startsWith(`# ${mini.TITLE}`));
    for (const s of ['工坊 → 基地 → 暴風 → 小鬼', '| 回合 |', '大豐收', '**工坊淹水**（flooded，bad，18 種）', '死規則', 'ITEMS.beta.fx[0]', '條件成立過、但沒有因它而升級', 'ITEMS.alpha.jump[4]']) assert.ok(md.includes(s), s);
    // 代表順序另附 id 陣列，可以直接抄進 expected.js
    assert.ok(md.includes('`["beta","alpha","gamma","delta"]`'), 'representative order as an id array');
    // 有 FINALE：統計列出每種考驗結果的條數
    assert.match(md, /- 收尾考驗（FINALE）結果：.*shield \d+/);
    // 重產時保留手寫的「調參紀錄」
    writeFileSync(out, md + '\n- 手寫紀錄一條\n');
    assert.equal(node('tools/solutions.mjs', MINI, out).status, 0);
    assert.ok(readFileSync(out, 'utf8').includes('- 手寫紀錄一條'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
// 沒有收尾考驗的遊戲（考驗本身是放進順序裡的物品）：FINALE 省略或空陣列，劇透表照樣通順，並說明收尾畫面照結局 id 挑
test('CLI: tools/solutions.mjs reads fine without FINALE (left out or empty)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solutions-'));
  try {
    for (const finale of ['undefined', '[]']) {
      const file = join(dir, `nofinale-${finale === '[]' ? 'empty' : 'none'}.js`);
      writeFileSync(file, [
        `import { ENDINGS as E } from ${JSON.stringify(MINI)};`,
        `export * from ${JSON.stringify(MINI)};`,
        `export const FINALE = ${finale};`,
        `export const ENDINGS = E.filter(e => e.id !== 'fallen');`,
      ].join('\n'));
      const out = join(dir, `${finale}.md`);
      const r = node('tools/solutions.mjs', file, out);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const md = readFileSync(out, 'utf8');
      assert.ok(md.includes('- 收尾考驗：沒有 FINALE'), finale);
      assert.doesNotMatch(md, /null|undefined|收尾考驗[^\n]*：\s*$/m, `${finale}: no empty or null finale line`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
