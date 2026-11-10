import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, withClause, score, tighten } from '../solver/tighten.js';
import * as mini from './helpers/mini.js';

const accept = patch => ({ ...mini, ACCEPTANCE: { ...mini.ACCEPTANCE, ...patch } });

test('score is 0 for a spec that passes check', () => {
  assert.equal(score(mini), 0);
});
test('score weighs check() failures by kind', () => {
  assert.equal(score(accept({ trueEndings: 2 })), 100, 'trueCount: |1 − 2| × 100');
  assert.equal(score(accept({ trueEndings: 3 })), 200);
  assert.equal(score(accept({ minMaxTurns: 99 })), 10, 'pacing: 10 per failure');
  const broken = { ...mini, ITEMS: { ...mini.ITEMS, gamma: { ...mini.ITEMS.gamma, up: { ...mini.ITEMS.gamma.up, 2: { bogus: 1 } } } } };
  assert.ok(score(broken) >= 1000, 'engineError: 1000');
});
test('candidates never put an item\'s own level into its own clause', () => {
  const cs = candidates(mini);
  assert.ok(cs.length > 0);
  for (const c of cs) {
    if (c.cond.minLevel) assert.notEqual(c.cond.minLevel[0], c.item);
    if (c.cond.maxLevel) assert.notEqual(c.cond.maxLevel[0], c.item);
    assert.ok(c.level >= 2 && c.level <= mini.ITEMS[c.item].max);
  }
  assert.ok(cs.some(c => c.cond.age), 'age of the item itself is a candidate');
});
test('withClause ANDs one clause onto up[level] and leaves the original spec alone', () => {
  const before = JSON.stringify(mini.ITEMS);
  const c = { item: 'beta', level: 3, cond: { minLevel: ['gamma', 2] } };
  const next = withClause(mini, c);
  assert.equal(JSON.stringify(mini.ITEMS), before);
  assert.deepEqual(next.ITEMS.beta.up[3], { and: [mini.ITEMS.beta.up[3], c.cond] });
  assert.equal(next.ITEMS.alpha, mini.ITEMS.alpha);
  assert.equal(next.ENDINGS, mini.ENDINGS);
});
test('tighten: a passing spec needs no clauses', () => {
  const r = tighten(mini);
  assert.deepEqual(r.applied, []);
  assert.equal(r.finalScore, 0);
});
test('tighten: cuts a spec with too many true orders down toward ACCEPTANCE.trueEndings', () => {
  // 真結局放寬到「全 MAX」以外的條件都拿掉，再把 wild 踢壞工坊那條拿掉：兩條全 MAX 都是真結局
  const delta = mini.ITEMS.delta;
  const loose = {
    ...mini,
    ITEMS: { ...mini.ITEMS, delta: { ...delta, onLevel: { 3: delta.onLevel[3].slice(0, 1) } } },
    ENDINGS: mini.ENDINGS.map(e => e.kind === 'true' ? { ...e, when: { allMax: true } } : e),
  };
  assert.equal(score(loose), 100);
  const logs = [];
  const r = tighten(loose, { log: m => logs.push(m) });
  assert.equal(r.finalScore, 0);
  assert.ok(r.applied.length >= 1);
  assert.equal(score(r.spec), 0);
  assert.ok(logs.length >= 2);
});
test('tighten: when it stops, the log names the failure kinds that remain', () => {
  const logs = [];
  const r = tighten(accept({ trueEndings: 2, minMaxTurns: 99 }), { log: m => logs.push(m) });
  assert.ok(r.finalScore > 0);
  const last = logs.at(-1);
  assert.match(last, /trueCount/);
  assert.match(last, /pacing/);
});
