// 範例規則表的測試：每個範例（examples/<名稱>/）都要結構合格、驗收通過、全枚舉結果與 expected.js 記下的完全相同
// （還沒寫 expected.js 的範例是設計中的遊戲：只跑結構檢查，驗收交給 npm run check）；dragon-valley 另外要求沒有死規則、沒有單一順序結局、
// 壞結局 4–5 個且每個到得了；根目錄的 spec.js 要結構合格；空白規則表只會被報「空表」那類問題。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../rules/validate.js';
import { enumerate, stats, check, reports, playOrder } from '../solver/run.js';
import { EXAMPLES, NAMES, IN_SKILL } from './helpers/examples.js';
import * as root from '../spec.js';
import * as template from '../spec.template.js';
import * as mini from './helpers/mini.js';

const runs = new Map();
const run = ex => {
  if (!runs.has(ex.name)) {
    const results = enumerate(ex.spec, { collect: true });
    runs.set(ex.name, { results, stats: stats(results, ex.spec), reports: reports(results, ex.spec), check: check(results, ex.spec) });
  }
  return runs.get(ex.name);
};

// expected.js 的正解：ACCEPTANCE.trueEndings 是 1（或省略）時寫 SOLUTION（一條順序）；不是 1 時寫 SOLUTIONS（順序的陣列，照全枚舉的先後）
function pinnedSolutions(spec, X) {
  const target = spec.ACCEPTANCE?.trueEndings ?? 1;
  if (target === 1 && X.SOLUTION) return [X.SOLUTION];
  assert.ok(Array.isArray(X.SOLUTIONS), `ACCEPTANCE.trueEndings 是 ${target}：expected.js 要寫 SOLUTIONS（${target} 條順序的陣列）`);
  assert.equal(X.SOLUTIONS.length, target, `SOLUTIONS 有 ${X.SOLUTIONS.length} 條，ACCEPTANCE.trueEndings 是 ${target}`);
  return X.SOLUTIONS;
}

// 全枚舉的結果與 expected.js 相同：總數、結局分佈、全 MAX 的順序＝走到真結局的順序＝釘下的正解
function assertSameEnumeration(spec, X, results, s) {
  const sols = pinnedSolutions(spec, X);
  assert.equal(results.length, X.TOTAL);
  assert.deepEqual(s.byEnding, X.DISTRIBUTION);
  assert.deepEqual(s.full.map(r => r.order), sols);
  const truth = spec.ENDINGS.find(e => e.kind === 'true');
  for (const r of s.full) assert.equal(r.ending.id, truth.id, `${r.order.join(',')} is all-max`);
  assert.deepEqual(results.filter(r => r.ending.kind === 'true').map(r => r.order), sols);
}

test('expected.js: SOLUTION for one true order, SOLUTIONS (array) when ACCEPTANCE.trueEndings ≠ 1', () => {
  // 迷你表的雙解版：拿掉作亂小鬼踢壞工坊那條、真結局只看全 MAX → 兩條全 MAX 的順序都是真結局
  const d = mini.ITEMS.delta;
  const two = { ...mini, ITEMS: { ...mini.ITEMS, delta: { ...d, onLevel: { 3: d.onLevel[3].slice(0, 1) } } },
    ENDINGS: mini.ENDINGS.map(e => e.kind === 'true' ? { ...e, when: { allMax: true } } : e),
    ACCEPTANCE: { ...mini.ACCEPTANCE, trueEndings: 2 } };
  const results = enumerate(two), s = stats(results, two);
  assert.equal(check(results, two).ok, true);
  const X = { TOTAL: 24, DISTRIBUTION: s.byEnding, SOLUTIONS: [['alpha', 'beta', 'gamma', 'delta'], ['beta', 'alpha', 'gamma', 'delta']] };
  assertSameEnumeration(two, X, results, s);
  assert.throws(() => assertSameEnumeration(two, { ...X, SOLUTIONS: undefined, SOLUTION: X.SOLUTIONS[0] }, results, s), /SOLUTIONS/);
  assert.throws(() => assertSameEnumeration(two, { ...X, SOLUTIONS: X.SOLUTIONS.slice(1) }, results, s), /SOLUTIONS/);
  const one = enumerate(mini);
  assertSameEnumeration(mini, { TOTAL: 24, DISTRIBUTION: stats(one, mini).byEnding, SOLUTION: ['beta', 'alpha', 'gamma', 'delta'] }, one, stats(one, mini));
});

test('examples: dragon-valley is among the examples', () => {
  assert.ok(NAMES.length >= 1, `examples/ has ${NAMES.join(', ')}`);
  assert.ok(NAMES.includes('dragon-valley'));
});

// 釘值不能悄悄消失：dragon-valley 一定要有 expected.js；在 skill 資料夾裡，每個自帶的範例都要有
test('examples: shipped examples are pinned (expected.js present; fails closed inside the skill)', () => {
  assert.ok(EXAMPLES.find(e => e.name === 'dragon-valley')?.expected, 'examples/dragon-valley/expected.js');
  if (!IN_SKILL) return;
  for (const ex of EXAMPLES) assert.ok(ex.expected, `examples/${ex.name}/expected.js is missing`);
});

for (const ex of EXAMPLES) {
  const { name, spec, expected: X } = ex;
  const pinned = X ? false : `${name}: 還沒有 expected.js（npm run check 通過之後照 dragon-valley/expected.js 的格式寫）`;

  test(`${name}: validateSpec is empty`, () => {
    assert.deepEqual(validateSpec(spec), []);
  });

  test(`${name}: same enumeration as recorded in expected.js (total, distribution, the all-max orders)`, { skip: pinned }, () => {
    const { results, stats: s } = run(ex);
    assertSameEnumeration(spec, X, results, s);
  });

  test(`${name}: check passes`, { skip: pinned }, () => {
    const c = run(ex).check;
    assert.deepEqual(c.failures, []);
    assert.equal(c.ok, true);
  });

  test(`${name}: reports match expected.js`, { skip: pinned }, () => {
    const r = run(ex).reports;
    assert.deepEqual(r.deadRules, X.REPORTS.deadRules);
    assert.deepEqual(r.shadowed, X.REPORTS.shadowed);
    assert.deepEqual(r.singleOrderEndings, X.REPORTS.singleOrderEndings);
  });

  test(`${name}: representative orders resolve to their endings`, { skip: pinned }, () => {
    const seen = Object.keys(run(ex).stats.byEnding).sort();
    assert.deepEqual(Object.keys(X.REPRESENTATIVE).sort(), seen, 'one representative per ending that occurs');
    for (const [id, order] of Object.entries(X.REPRESENTATIVE)) {
      assert.equal(playOrder(order, spec).ending.id, id, `${order.join(',')} → ${id}`);
    }
    const truthRep = X.REPRESENTATIVE[spec.ENDINGS.find(e => e.kind === 'true').id];
    assert.ok(pinnedSolutions(spec, X).some(o => o.join() === truthRep.join()), 'the true ending\'s representative is a pinned solution');
  });

  if (X?.NOTABLE) test(`${name}: notable orders in expected.js still play out as recorded`, () => {
    for (const n of X.NOTABLE) {
      const r = playOrder(n.order, spec);
      assert.equal(r.ending.id, n.ending, `${n.order.join(',')} → ${n.ending}（${n.note}）`);
      if (!n.lockedOnPlacement) continue;
      const id = n.lockedOnPlacement;
      const at = r.events.findIndex(e => e.kind === 'placed' && e.item === id);
      const lock = r.events.findIndex((e, i) => i > at && e.kind === 'fx' && e.lock === id);
      assert.ok(at >= 0 && lock > at, `${id} is placed and then locked`);
      assert.ok(!r.events.slice(at + 1, lock).some(e => e.kind === 'placed'), `${id} is locked in the turn it is placed`);
      assert.notEqual(r.events[lock].cause, id, 'locked by another item, not by its own reaction');
    }
  });
}

test('dragon-valley: exactly one all-max order and it is the true ending; every bad ending reachable; no dead rules; no single-order endings; check ok; validateSpec empty', () => {
  const ex = EXAMPLES.find(e => e.name === 'dragon-valley');
  assert.ok(ex, 'examples/dragon-valley exists');
  const { spec } = ex, { results, stats: s, reports: r, check: c } = run(ex);
  assert.equal(spec.ORDER.length, 6);
  assert.equal(results.length, 720);
  assert.equal(s.full.length, 1);
  assert.equal(s.full[0].ending.kind, 'true');
  const bads = spec.ENDINGS.filter(e => e.kind === 'bad');
  assert.ok(bads.length >= 4 && bads.length <= 5, `${bads.length} bad endings`);
  for (const e of bads) assert.ok(results.some(x => x.satisfied.includes(e.id)), `${e.id} reachable`);
  assert.deepEqual(r.deadRules, []);
  assert.deepEqual(r.singleOrderEndings, []);
  assert.equal(c.ok, true);
  assert.deepEqual(validateSpec(spec), []);
  const acc = spec.ACCEPTANCE;
  assert.equal(acc.trueEndings, 1);
  assert.equal(acc.minMaxTurns, 2);
  assert.equal(acc.greedyMustFail, true);
  assert.ok(acc.maxAvgMax <= 2.5 && s.avgMax <= acc.maxAvgMax);
  // 每個元件各出現一次：災害、搗蛋、分岔、收尾考驗、回合結束反應
  const items = Object.values(spec.ITEMS);
  assert.equal(items.filter(it => it.hazard).length, 1);
  assert.equal(items.filter(it => it.grip).length, 1);
  assert.equal(items.flatMap(it => Object.values(it.onLevel ?? {}).flat()).filter(a => a.branch).length, 1);
  assert.equal(spec.FINALE.length, 3);
  assert.ok(spec.AFTER_TURN.length >= 1);
  // STORIES 齊全：每個物品的放下句、每一級（2..max）的升級句
  for (const id of spec.ORDER) {
    assert.equal(typeof spec.STORIES.placed[id], 'string', `STORIES.placed.${id}`);
    for (let n = 2; n <= spec.ITEMS[id].max; n++) assert.equal(typeof spec.STORIES.grow[id]?.[n], 'string', `STORIES.grow.${id}[${n}]`);
  }
});

// 掃描順序 ORDER 會改變結果：騎士 Lv5 的分岔（看法師 ≥6）是升級那一刻判定一次的。法師排在騎士前面，
// 同一回合法師先升到 6、騎士才宣誓；兩個對調，騎士先宣誓、看到法師還是 5 → 黑騎士，真結局 0 條
test('dragon-valley: swapping mage and knight in ORDER breaks the true ending (a branch is decided once, in scan order)', () => {
  const { spec } = EXAMPLES.find(e => e.name === 'dragon-valley');
  const order = [...spec.ORDER];
  const m = order.indexOf('mage'), k = order.indexOf('knight');
  assert.ok(m >= 0 && k >= 0 && m < k, 'mage is scanned before knight');
  [order[m], order[k]] = [order[k], order[m]];
  const swapped = { ...spec, ORDER: order };
  const results = enumerate(swapped), c = check(results, swapped);
  assert.equal(c.ok, false);
  const tc = c.failures.find(f => f.kind === 'trueCount');
  assert.ok(tc, JSON.stringify(c.failures));
  assert.equal(tc.count, 0);
  assert.equal(results.filter(r => r.ending.kind === 'true').length, 0);
});

// 根目錄的 spec.js 是 npm run check／stats／tighten／solutions 讀的那份：預設轉出 dragon-valley，開新遊戲時改成轉出自己的範例資料夾
test('spec.js (what npm run check reads) passes validateSpec', () => {
  assert.ok(Array.isArray(root.ORDER) && root.ORDER.length > 0, 'spec.js exports a rules table');
  assert.deepEqual(validateSpec(root), []);
});

test('template: validateSpec only reports the empty-table problems', () => {
  assert.deepEqual(validateSpec(template), [
    'ORDER 要是非空陣列（物品清單兼掃描順序）',
    'ENDINGS 要恰好一個 true（現在 0 個）',
    'ENDINGS 要恰好一個 neutral（現在 0 個）',
  ]);
});
