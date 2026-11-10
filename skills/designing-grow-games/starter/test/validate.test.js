import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../rules/validate.js';
import * as mini from './helpers/mini.js';

const spec = patch => ({ ...mini, ...patch });
const item = (id, patch) => spec({ ITEMS: { ...mini.ITEMS, [id]: { ...mini.ITEMS[id], ...patch } } });
// 壞表只回一條訊息、而且是對的那條（不連鎖報一堆）
const one = (s, re) => {
  const problems = validateSpec(s);
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.match(problems[0], re);
};

test('the mini spec is valid', () => {
  assert.deepEqual(validateSpec(mini), []);
});
test('ORDER and ITEMS must agree', () => {
  one(spec({ ORDER: [...mini.ORDER, 'omega'] }), /ORDER.*omega.*ITEMS/);
  one(spec({ ORDER: ['alpha', 'beta', 'gamma'] }), /ITEMS\.delta.*ORDER/);
  one(spec({ ORDER: ['alpha', 'beta', 'gamma', 'delta', 'alpha'] }), /ORDER.*alpha.*重複/);
});
test('up levels are 2..max and none is missing; jump levels are 3..max', () => {
  one(item('alpha', { up: { ...mini.ITEMS.alpha.up, 5: { always: true } } }), /ITEMS\.alpha\.up\[5\].*2\.\.4/);
  one(item('alpha', { up: { 2: { always: true }, 4: { always: true } } }), /ITEMS\.alpha\.up.*3/);
  one(item('alpha', { jump: { 2: { always: true } } }), /ITEMS\.alpha\.jump\[2\].*3\.\.4/);
  one(item('alpha', { max: 0 }), /ITEMS\.alpha\.max/);
});
test('conditions: unknown primitives, unknown ids and malformed arguments are reported with their location', () => {
  one(item('beta', { up: { ...mini.ITEMS.beta.up, 2: { atLeast: ['alpha', 2] } } }), /ITEMS\.beta\.up\[2\].*atLeast/);
  one(item('gamma', { up: { ...mini.ITEMS.gamma.up, 2: { minLevel: ['omega', 2] } } }), /ITEMS\.gamma\.up\[2\].*omega/);
  one(item('gamma', { up: { ...mini.ITEMS.gamma.up, 2: { and: [{ present: 'alpha' }, { minLevel: ['alpha'] }] } } }), /ITEMS\.gamma\.up\[2\].*minLevel/);
  one(spec({ AFTER_TURN: [{ when: { or: [] }, flag: { name: 'x' } }] }), /AFTER_TURN\[0\]\.when.*or/);
});
test('actions: delta.target and lock must name an item', () => {
  one(item('delta', { fx: [{ delta: { target: 'omega', by: -1 } }] }), /ITEMS\.delta\.fx\[0\].*omega/);
  one(item('gamma', { fx: [{ when: { present: 'beta' }, lock: 'omega', flag: { name: 'x' } }] }), /ITEMS\.gamma\.fx\[0\].*lock.*omega/);
  one(item('delta', { onLevel: { 3: [{ branch: { flag: 'fate', when: { present: 'beta' }, then: 'tame' } }] } }), /ITEMS\.delta\.onLevel\[3\]\[0\].*branch/);
});
test('hazard and grip: while is a condition, grip targets name items', () => {
  one(item('delta', { grip: { ...mini.ITEMS.delta.grip, targets: ['omega'] } }), /ITEMS\.delta\.grip.*omega/);
  one(item('gamma', { hazard: {} }), /ITEMS\.gamma\.hazard\.while/);
});
test('ENDINGS: exactly one true, exactly one neutral (last), unique ids, non-neutral endings need when', () => {
  const ends = mini.ENDINGS;
  one(spec({ ENDINGS: ends.map(e => e.id === 'wild' ? { ...e, kind: 'true' } : e) }), /ENDINGS.*true.*2/);
  one(spec({ ENDINGS: ends.filter(e => e.kind !== 'neutral') }), /ENDINGS.*neutral.*0/);
  one(spec({ ENDINGS: [ends.at(-1), ...ends.slice(0, -1)] }), /neutral.*最後/);
  one(spec({ ENDINGS: [...ends.slice(0, -1), { ...ends[1] }, ends.at(-1)] }), /ENDINGS.*flooded.*重複/);
  one(spec({ ENDINGS: ends.map(e => e.id === 'stale' ? { ...e, when: undefined } : e) }), /ENDINGS\.stale\.when/);
  one(spec({ ENDINGS: ends.map(e => e.id === 'stale' ? { ...e, kind: 'meh' } : e) }), /ENDINGS\.stale\.kind/);
});
test('{ finale: id } must name a FINALE entry, and FINALE cannot refer to itself', () => {
  one(spec({ ENDINGS: mini.ENDINGS.map(e => e.id === 'fallen' ? { ...e, when: { not: { finale: 'nope' } } } : e) }), /ENDINGS\.fallen\.when.*nope/);
  one(spec({ FINALE: [...mini.FINALE.slice(0, 2), { id: 'hit', when: { not: { finale: 'shield' } } }] }), /FINALE\[2\]\.when.*finale/);
});
test('ACCEPTANCE field types', () => {
  one(spec({ ACCEPTANCE: { ...mini.ACCEPTANCE, trueEndings: '1' } }), /ACCEPTANCE\.trueEndings/);
  one(spec({ ACCEPTANCE: { ...mini.ACCEPTANCE, everyBadReachable: 'yes' } }), /ACCEPTANCE\.everyBadReachable/);
  one(spec({ ACCEPTANCE: { ...mini.ACCEPTANCE, custom: [{ id: 'x' }] } }), /ACCEPTANCE\.custom\[0\]\.test/);
  one(spec({ ACCEPTANCE: { ...mini.ACCEPTANCE, maxAvgMx: 3 } }), /ACCEPTANCE\.maxAvgMx/);
  assert.deepEqual(validateSpec(spec({ ACCEPTANCE: { trueEndings: 1, maxAvgMax: 3.5, minMaxTurns: 2, custom: [{ id: 'c', test: () => null }] } })), []);
});
test('an empty spec reports the empty-table problems instead of throwing', () => {
  const problems = validateSpec({});
  assert.ok(problems.some(p => /ORDER/.test(p)), problems.join('\n'));
  assert.ok(problems.some(p => /ENDINGS/.test(p)), problems.join('\n'));
  assert.doesNotThrow(() => validateSpec({ ORDER: ['a'], ITEMS: { a: null } }));
});
test('item keys: old names get a rename hint, other unknown keys are reported, meta is free-form', () => {
  one(item('gamma', { rain: { while: { always: true } } }), /ITEMS\.gamma\.rain.*hazard/);
  one(item('delta', { bite: { while: { always: true }, targets: ['alpha'] } }), /ITEMS\.delta\.bite.*grip/);
  one(item('alpha', { jumps: { 4: { always: true } } }), /ITEMS\.alpha\.jumps.*jump/);
  one(item('alpha', { maxLevel: 4 }), /ITEMS\.alpha\.maxLevel.*未知/);
  assert.deepEqual(validateSpec(item('alpha', { meta: { model: 'tower', idle: [1, 2], anything: true } })), []);
});
test('action keys: unknown keys are reported (bite gets a rename hint)', () => {
  one(item('delta', { fx: [{ ...mini.ITEMS.delta.fx[0], grip: undefined, bite: true }] }), /ITEMS\.delta\.fx\[0\]\.bite.*grip/);
  one(spec({ AFTER_TURN: [{ ...mini.AFTER_TURN[0], flags: { name: 'x' } }] }), /AFTER_TURN\[0\]\.flags.*未知/);
  one(item('gamma', { fx: [...mini.ITEMS.gamma.fx.slice(0, 2), { ...mini.ITEMS.gamma.fx[2], lable: 'x' }] }), /ITEMS\.gamma\.fx\[2\]\.lable/);
});
test('a when on the neutral ending is reported (it is ignored at runtime)', () => {
  one(spec({ ENDINGS: mini.ENDINGS.map(e => e.kind === 'neutral' ? { ...e, when: { always: true } } : e) }), /ENDINGS\.retry\.when.*neutral/);
});
test('grip: true has no effect without a grip block on its own item, or in AFTER_TURN', () => {
  const kick = { when: { present: 'alpha' }, delta: { target: 'alpha', by: -1 }, grip: true };
  one(item('beta', { fx: [...mini.ITEMS.beta.fx, kick] }), /ITEMS\.beta\.fx\[1\]\.grip.*beta.*grip/);
  one(item('gamma', { onLevel: { 3: [kick] } }), /ITEMS\.gamma\.onLevel\[3\]\[0\]\.grip.*gamma/);
  one(spec({ AFTER_TURN: [...mini.AFTER_TURN, kick] }), /AFTER_TURN\[1\]\.grip.*AFTER_TURN/);
  assert.deepEqual(validateSpec(item('delta', { fx: [...mini.ITEMS.delta.fx, kick] })), [], 'on the item with the grip block it is fine');
});
