import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, contextOf } from '../rules/conditions.js';
import { createState, place, advance } from '../rules/engine.js';
import { finaleOf, satisfied, resolve, endingById } from '../rules/endings.js';
import * as mini from './helpers/mini.js';

const st = (lv, flags = {}) => ({ ...createState(mini), lv: { alpha: 0, beta: 0, gamma: 0, delta: 0, ...lv }, flags });
const ALL_MAX = { alpha: 4, beta: 4, gamma: 3, delta: 3 };
const noFinale = { ...mini, FINALE: undefined };

// ── 條件語言 ──
test('compile: every primitive of the condition language', () => {
  const s = { lv: { a: 2, b: 0, c: 3 }, age: { a: 4, b: -1, c: 0 }, held: {}, flags: { on: true, mode: 'x' }, locked: { c: true } };
  const t = c => compile(c, {})(s);
  assert.equal(t({ always: true }), true);
  assert.equal(t({ present: 'a' }), true); assert.equal(t({ present: 'b' }), false);
  assert.equal(t({ absent: 'b' }), true); assert.equal(t({ absent: 'a' }), false);
  assert.equal(t({ minLevel: ['a', 2] }), true); assert.equal(t({ minLevel: ['a', 3] }), false);
  assert.equal(t({ maxLevel: ['b', 1] }), true, 'maxLevel is absolute: an unplaced 0 counts');
  assert.equal(t({ ltPlus: ['a', 'c', 0] }), true); assert.equal(t({ ltPlus: ['c', 'a', 1] }), false);
  assert.equal(t({ age: ['a', 4] }), true); assert.equal(t({ age: ['b', 0] }), false, 'age needs the item placed');
  assert.equal(t({ flag: 'on' }), true); assert.equal(t({ flag: 'off' }), false);
  assert.equal(t({ flag: 'mode', is: 'x' }), true); assert.equal(t({ flag: 'mode', is: 'y' }), false);
  assert.equal(t({ locked: 'c' }), true); assert.equal(t({ locked: 'a' }), false);
  assert.equal(t({ and: [{ present: 'a' }, { locked: 'c' }] }), true); assert.equal(t({ and: [{ present: 'a' }, { present: 'b' }] }), false);
  assert.equal(t({ or: [{ present: 'b' }, { locked: 'c' }] }), true);
  assert.equal(t({ not: { present: 'b' } }), true);
  assert.throws(() => compile({ atLeast: ['a', 1] }, {}), /bad cond/);
  assert.throws(() => compile(null, {}), /bad cond/);
});
test('{ allMax: true } holds when every item is at its max (ctx.max comes from the spec)', () => {
  const allMax = compile({ allMax: true }, contextOf(mini));
  assert.equal(allMax(st(ALL_MAX)), true);
  assert.equal(allMax(st({ ...ALL_MAX, beta: 3 })), false);
  assert.equal(compile({ allMax: true }, { max: { a: 2, b: 1 } })({ lv: { a: 2, b: 1 } }), true);
  assert.throws(() => compile({ allMax: true }, {}), /ctx\.max/);
});
test('{ finale: id } holds when ctx.finaleOf(state) is id; without a finaleOf it never holds', () => {
  assert.equal(compile({ finale: 'x' }, { finaleOf: () => 'x' })({}), true);
  assert.equal(compile({ finale: 'x' }, { finaleOf: () => 'y' })({}), false);
  assert.equal(compile({ finale: 'x' }, {})({}), false);
  const shield = compile({ finale: 'shield' }, contextOf(mini));
  assert.equal(shield(st({ alpha: 4 })), true); assert.equal(shield(st({ alpha: 3 })), false);
  assert.equal(compile({ finale: 'shield' }, contextOf(noFinale))(st({ alpha: 4 })), false, 'no FINALE → never');
});
test('contextOf(spec) is built once per spec', () => {
  assert.equal(contextOf(mini), contextOf(mini));
  assert.deepEqual(contextOf(mini).max, { alpha: 4, beta: 4, gamma: 3, delta: 3 });
});

// ── 收尾考驗 ──
test('finaleOf: the first FINALE entry whose when holds', () => {
  assert.equal(finaleOf(st({ alpha: 4, gamma: 2 }), mini), 'shield', 'first match wins');
  assert.equal(finaleOf(st({ alpha: 3, gamma: 2 }), mini), 'deflect');
  assert.equal(finaleOf(st({ alpha: 3, gamma: 3 }), mini), 'hit');
  assert.equal(finaleOf(st({ alpha: 3 }), mini), 'hit', 'an unplaced gamma does not deflect');
});
test('finaleOf: no FINALE → null; no entry holds → null', () => {
  assert.equal(finaleOf(st({ alpha: 4 }), noFinale), null);
  const partial = { ...mini, FINALE: [{ id: 'shield', when: { minLevel: ['alpha', 4] } }] };
  assert.equal(finaleOf(st({ alpha: 1 }), partial), null);
});

// ── 結局 ──
test('satisfied: every non-neutral ending whose when holds, in ENDINGS order (masked ones included)', () => {
  assert.deepEqual(satisfied(st({ alpha: 3, gamma: 3 }, { stale: true, flooded: true }), mini), ['flooded', 'stale', 'fallen']);
  assert.deepEqual(satisfied(st(ALL_MAX, { fate: 'tame', stale: true }), mini), ['bloom', 'stale'], 'true and bad both listed');
  assert.deepEqual(satisfied(st({ alpha: 4 }), mini), [], 'neutral is never listed');
  assert.deepEqual(satisfied(st({ alpha: 4 }), noFinale), ['fallen'], 'no FINALE: { not: { finale } } always holds');
});
test('resolve: a satisfied true ending wins; extras = the other satisfied bad endings', () => {
  assert.deepEqual(resolve(st(ALL_MAX, { fate: 'tame', stale: true, washed: true }), mini),
    { id: 'bloom', title: '大豐收', kind: 'true', finale: 'shield', extras: ['washed', 'stale'] });
});
test('resolve: otherwise the first satisfied bad ending; extras = the later satisfied bad endings', () => {
  assert.deepEqual(resolve(st({ alpha: 3, gamma: 2 }, { stale: true, flooded: true }), mini),
    { id: 'flooded', title: '工坊淹水', kind: 'bad', finale: 'deflect', extras: ['stale', 'fallen'] });
  assert.deepEqual(resolve(st(ALL_MAX, { fate: 'wild' }), mini),
    { id: 'wild', title: '小鬼作亂', kind: 'bad', finale: 'shield', extras: [] }, 'all max without the true condition is a bad ending');
});
test('resolve: nothing satisfied → the neutral ending with no extras; finale null without FINALE', () => {
  assert.deepEqual(resolve(st({ alpha: 4, beta: 2 }), mini), { id: 'retry', title: '再試一次', kind: 'neutral', finale: 'shield', extras: [] });
  assert.equal(resolve(st({ alpha: 4 }), noFinale).finale, null);
});
test('endingById finds an ending by id, else null', () => {
  assert.equal(endingById(mini, 'wild').title, '小鬼作亂');
  assert.equal(endingById(mini, 'retry').kind, 'neutral');
  assert.equal(endingById(mini, 'nope'), null);
});
test('a played game resolves from its final state (placements and closing turns)', () => {
  let s = createState(mini);
  for (const id of ['gamma', 'beta']) s = place(s, id, mini).state;
  for (let i = 0; i < mini.CLOSING_TURNS; i++) s = advance(s, mini).state;
  const end = resolve(s, mini);
  assert.equal(end.id, 'flooded'); assert.ok(end.extras.includes('fallen'));
});
