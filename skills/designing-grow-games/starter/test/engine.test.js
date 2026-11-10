import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAN_LIMIT, createState, place, advance, foldEvent, lockFlags, grippedBy, isPlaced, isComplete, isAllMax,
  condDeps, helperDeps, satisfiedHelpers,
} from '../rules/engine.js';
import * as mini from './helpers/mini.js';

const grows = r => r.events.filter(e => e.kind === 'grow').map(e => `${e.item}${e.from}>${e.to}${e.jump ? 'J' : ''}`);
const waitOf = (r, item) => r.events.find(e => e.kind === 'wait')?.waits.find(w => w.item === item);
const play = (spec, order) => { let s = createState(spec), r; for (const id of order) { r = place(s, id, spec); s = r.state; } return { r, s }; };

// ── 基本：放置、不可變、決定性、規則表一律是參數 ──
test('placing sets level 1, age 0, records order and a placed event', () => {
  const { state, events } = place(createState(mini), 'gamma', mini);
  assert.equal(state.lv.gamma, 1); assert.equal(state.age.gamma, 0); assert.deepEqual(state.order, ['gamma']); assert.equal(state.turn, 1);
  assert.deepEqual(events[0], { kind: 'placed', item: 'gamma', to: 1, story: '暴風來了' });
});
test('the spec is always a parameter: there is no default spec', () => {
  assert.throws(() => createState(), /spec/);
  assert.throws(() => place(createState(mini), 'alpha'), /spec/);
  assert.throws(() => advance(createState(mini)), /spec/);
});
test('unknown item and placing twice throw', () => {
  assert.throws(() => place(createState(mini), 'nope', mini), /unknown item nope/);
  const s = place(createState(mini), 'alpha', mini).state;
  assert.throws(() => place(s, 'alpha', mini), /already placed/);
});
test('state is immutable', () => {
  const s0 = createState(mini); place(s0, 'alpha', mini);
  assert.equal(s0.lv.alpha, 0); assert.deepEqual(s0.order, []);
});
test('deterministic: same order gives identical event JSON', () => {
  const run = () => { let s = createState(mini); const ev = []; for (const id of ['delta', 'alpha', 'gamma', 'beta']) { const r = place(s, id, mini); s = r.state; ev.push(...r.events); } return JSON.stringify(ev); };
  assert.equal(run(), run());
});
test('isPlaced / isComplete / isAllMax', () => {
  const s = createState(mini);
  assert.equal(isPlaced(s, 'alpha'), false); assert.equal(isComplete(s), false); assert.equal(isAllMax(s, mini), false);
  const full = { ...s, lv: { alpha: 4, beta: 4, gamma: 3, delta: 3 } };
  assert.equal(isPlaced(full, 'alpha'), true); assert.equal(isComplete(full), true); assert.equal(isAllMax(full, mini), true);
  assert.equal(isAllMax({ ...full, lv: { ...full.lv, delta: 2 } }, mini), false);
});

// ── 節奏：每回合每物品一步；剛放下的當回合也長，最多到 Lv2 ──
// 小表：a 放了就自己每回合升；b 的 Lv2 需要 a ≥ 2，Lv3 需要 a ≥ 3（同回合連鎖）；b 升 3 時扣 c；c 在 b 在場時被擋住
const steps = {
  ORDER: ['a', 'b', 'c', 'd'],
  ITEMS: {
    a: { name: 'A', max: 3, up: { 2: { age: ['a', 1] }, 3: { age: ['a', 2] } } },
    b: { name: 'B', max: 3, up: { 2: { minLevel: ['a', 2] }, 3: { minLevel: ['a', 3] } },
         onLevel: { 3: [{ when: { present: 'c' }, delta: { target: 'c', by: -1 }, story: 'b踩到c' }] } },
    c: { name: 'C', max: 2, up: { 2: { always: true } }, stall: [{ when: { present: 'b' }, story: 'c被b擋住' }] },
    d: { name: 'D', max: 1, up: {} },
  },
  AFTER_TURN: [{ when: { and: [{ present: 'a' }, { age: ['a', 1] }] }, flag: { name: 'aOld' }, story: 'a老了' }],
  STORIES: { placed: { a: '放a', b: '放b', c: '放c', d: '放d' }, grow: { a: { 2: 'a2', 3: 'a3' }, b: { 2: 'b2', 3: 'b3' }, c: { 2: 'c2' }, d: {} } },
};
test('ages advance each turn; an item takes one step per turn and a placed item grows in its own turn up to Lv2', () => {
  let s = createState(steps);
  s = place(s, 'a', steps).state;          // a1（age 0：up[2] 要 age 1，放下當回合不成立）
  assert.equal(s.lv.a, 1);
  const t2 = place(s, 'b', steps);         // a2（age 1）；b 剛放，同回合跟著 a ≥ 2 長到 2
  s = t2.state; assert.equal(s.lv.a, 2); assert.equal(s.lv.b, 2);
  assert.deepEqual(t2.events.filter(e => e.kind === 'grow').map(e => `${e.item}${e.to}`), ['a2', 'b2']);
  const t3 = place(s, 'c', steps);         // a3 → b3（b3 的反應想扣 c，c 已經 1 扣不動，但算被打到：這回合不長、不記 stall）
  s = t3.state; assert.equal(s.lv.a, 3); assert.equal(s.lv.b, 3); assert.equal(s.lv.c, 1);
  assert.deepEqual(t3.events.filter(e => e.kind === 'grow').map(e => `${e.item}${e.to}`), ['a3', 'b3']);
  assert.ok(t3.events.some(e => e.kind === 'fx' && e.delta?.target === 'c'), 'b3 knocks the fresh c');
  assert.ok(!t3.events.some(e => e.kind === 'stall'), 'a knocked item sits the turn out: no stall either');
  const t4 = place(s, 'd', steps);         // 沒有人能動：c 被 b 擋住
  assert.equal(t4.state.lv.c, 1); assert.deepEqual(t4.events.filter(e => e.kind === 'grow'), []);
  assert.ok(t4.events.some(e => e.kind === 'stall' && e.item === 'c'), 'the next turn c is stalled by b');
});
test('a cascade within a turn still works: A growing lets B grow in the same scan pass', () => {
  const chain = { ORDER: ['p', 'q', 'r'], ITEMS: {
    p: { name: 'P', max: 2, up: { 2: { age: ['p', 1] } } }, q: { name: 'Q', max: 2, up: { 2: { minLevel: ['p', 2] } } }, r: { name: 'R', max: 1, up: {} } },
    AFTER_TURN: [], STORIES: { placed: { p: '', q: '', r: '' }, grow: { p: { 2: '' }, q: { 2: '' }, r: {} } } };
  let s = place(createState(chain), 'q', chain).state; s = place(s, 'p', chain).state;
  const t = place(s, 'r', chain);          // p 升 2 → 同回合 q 也升 2
  assert.equal(t.state.lv.p, 2); assert.equal(t.state.lv.q, 2);
});
test('stall blocks growth and records one stall event per turn', () => {
  let s = createState(steps);
  s = place(s, 'b', steps).state;          // b1（a 沒放，b 長不了）
  let r = place(s, 'c', steps);            // c 的 up 是 always，但 b 在場 → 剛放下就擋住
  assert.equal(r.state.lv.c, 1); assert.equal(r.events.filter(e => e.kind === 'stall' && e.item === 'c').length, 1);
  assert.equal(r.events.find(e => e.kind === 'stall').story, 'c被b擋住');
  r = place(r.state, 'd', steps);
  assert.equal(r.state.lv.c, 1); assert.equal(r.events.filter(e => e.kind === 'stall' && e.item === 'c').length, 1);
});
test('locked item never grows', () => {
  let s = createState(steps); s = place(s, 'a', steps).state;
  s = { ...s, locked: { ...s.locked, a: true } };
  s = place(s, 'c', steps).state; assert.equal(s.lv.a, 1);
});
test('AFTER_TURN actions evaluate once per turn and set flags', () => {
  let s = createState(steps); s = place(s, 'a', steps).state;
  assert.equal(s.flags.aOld, undefined);
  const r = place(s, 'c', steps); assert.equal(r.state.flags.aOld, true);
  assert.ok(r.events.some(e => e.kind === 'after' && e.story === 'a老了'));
});
test('a mutually knocking-back pair no longer loops: one level per item per turn bounds the scan', () => {
  const bad = { ORDER: ['x', 'y', 'z'], ITEMS: {
    x: { name: 'X', max: 3, up: { 2: { always: true }, 3: { always: true } }, onLevel: { 3: [{ delta: { target: 'y', by: -1 } }] } },
    y: { name: 'Y', max: 3, up: { 2: { always: true }, 3: { always: true } }, onLevel: { 3: [{ delta: { target: 'x', by: -1 } }] } },
    z: { name: 'Z', max: 1, up: {} } },
    AFTER_TURN: [], STORIES: { placed: { x: '', y: '', z: '' }, grow: { x: { 2: '', 3: '' }, y: { 2: '', 3: '' }, z: {} } } };
  let s = place(createState(bad), 'x', bad).state; s = place(s, 'y', bad).state;
  const t = place(s, 'z', bad);
  assert.ok(SCAN_LIMIT > 0); assert.equal(t.state.lv.x, 3); assert.equal(t.state.lv.y, 2);   // x 升 3 想扣 y，y 還在 1 扣不動，接著 y 自己升 2
});
test('a positive delta that crosses a level fires that level\'s onLevel actions', () => {
  const sp = { ORDER: ['p', 'q', 'r'], ITEMS: {
      p: { name: 'P', max: 3, up: { 2: { always: true }, 3: { minLevel: ['p', 9] } }, onLevel: { 3: [{ flag: { name: 'p3' }, story: 'p到3' }] } },
      q: { name: 'Q', max: 2, up: { 2: { minLevel: ['q', 9] } }, fx: [{ delta: { target: 'p', by: 1 }, story: 'q推p' }] },
      r: { name: 'R', max: 1, up: {} } },
    AFTER_TURN: [], STORIES: { placed: { p: '', q: '', r: '' }, grow: { p: { 2: '', 3: '' }, q: { 2: '' }, r: {} } } };
  let s = place(createState(sp), 'p', sp).state; s = place(s, 'r', sp).state;   // p → 2（3 永遠不會自己升）
  assert.equal(s.lv.p, 2);
  const r = place(s, 'q', sp);                       // q 的放置反應把 p 推到 3
  assert.equal(r.state.lv.p, 3); assert.equal(r.state.flags.p3, true);
  const kinds = r.events.map(e => e.kind + (e.story ?? ''));
  assert.ok(kinds.indexOf('fxq推p') < kinds.indexOf('fxp到3'));
});
test('SCAN_LIMIT: a delta↔onLevel cycle throws a chain-limit error naming the item instead of a stack overflow', () => {
  const sp = { ORDER: ['x', 'y', 'z'], ITEMS: {
      x: { name: 'X', max: 3, up: { 2: { always: true }, 3: { always: true } },
           onLevel: { 3: [{ delta: { target: 'x', by: -1 } }, { delta: { target: 'x', by: 1 } }] } },
      y: { name: 'Y', max: 1, up: {} }, z: { name: 'Z', max: 1, up: {} } },
    AFTER_TURN: [], STORIES: { placed: { x: '', y: '', z: '' }, grow: { x: { 2: '', 3: '' }, y: {}, z: {} } } };
  const s = place(createState(sp), 'x', sp).state;   // x 放下當回合就到 2
  assert.equal(s.lv.x, 2);
  assert.throws(() => place(s, 'y', sp), new RegExp(`chain limit ${SCAN_LIMIT} .* x`));
});
// 收尾：全部放完後再長 CLOSING_TURNS 回合，沒有放置、其餘和一般回合一樣
test('advance runs a growth turn without placing anything', () => {
  const s = place(createState(steps), 'a', steps).state;
  const r = advance(s, steps);
  assert.equal(r.state.lv.a, 2); assert.equal(r.state.age.a, 1); assert.equal(r.state.turn, 2); assert.deepEqual(r.state.order, ['a']);
  assert.deepEqual(r.events.map(e => e.kind), ['grow', 'after']);
  assert.equal(advance(r.state, steps).state.lv.a, 3);
});
test('a spec without STORIES still plays (stories are optional, the events keep their shape)', () => {
  const bare = { ORDER: ['p', 'q'], ITEMS: { p: { name: 'P', max: 2, up: { 2: { always: true } } }, q: { name: 'Q', max: 1, up: {} } } };
  const r = place(createState(bare), 'p', bare);
  assert.equal(r.state.lv.p, 2);
  assert.deepEqual(r.events.map(e => e.kind), ['placed', 'grow']);
  assert.equal(r.events[0].story, undefined);
});

// ── 看得見的因果：via、wait 的 for ──
const linked = {
  ORDER: ['a', 'c', 'e', 'z'],
  ITEMS: {
    a: { name: 'A', max: 3, up: { 2: { age: ['a', 2] }, 3: { age: ['a', 3] } } },
    c: { name: 'C', max: 2, up: { 2: { age: ['c', 5] } } },
    e: { name: 'E', max: 3, up: { 2: { minLevel: ['a', 2] }, 3: { and: [{ age: ['e', 2] }, { maxLevel: ['c', 1] }] } } },
    z: { name: 'Z', max: 1, up: {} },
  },
  AFTER_TURN: [], STORIES: { placed: { a: '', c: '', e: '', z: '' }, grow: { a: { 2: '', 3: '' }, c: { 2: '' }, e: { 2: '', 3: '' }, z: {} } },
};
test('condDeps lists the other items a condition mentions, in ORDER, without age/self', () => {
  assert.deepEqual(condDeps({ and: [{ age: ['e', 2] }, { maxLevel: ['c', 1] }, { minLevel: ['a', 2] }, { present: 'e' }] }, 'e', linked), ['a', 'c']);
  assert.deepEqual(condDeps({ always: true }, 'a', linked), []);
  assert.deepEqual(condDeps({ or: [{ absent: 'c' }, { flag: 'x' }] }, 'a', linked), ['c']);
});
test('helperDeps lists only the minLevel/present items', () => {
  assert.deepEqual(helperDeps({ and: [{ minLevel: ['a', 2] }, { maxLevel: ['c', 1] }, { or: [{ present: 'z' }, { absent: 'e' }] }] }, 'e', linked), ['a', 'z']);
  assert.deepEqual(helperDeps({ present: 'e' }, 'e', linked), [], 'self is never a helper');
});
test('grow events carry via = the items their condition depends on', () => {
  let s = place(createState(linked), 'a', linked).state; s = place(s, 'e', linked).state;   // a 還是 1（age 1）
  const r = place(s, 'z', linked);                                                         // a → 2，同回合 e → 2（看 a）
  const g = r.events.filter(e => e.kind === 'grow');
  assert.deepEqual(g.map(e => [e.item, e.via]), [['a', []], ['e', ['a']]]);
});
test('wait is one grouped event per turn and absent when nothing waits', () => {
  const s = place(createState(linked), 'a', linked).state;
  let r = place(s, 'e', linked); assert.equal(r.events.filter(e => e.kind === 'wait').length, 0, 'freshly placed e does not wait yet');
  r = place(r.state, 'c', linked);
  assert.equal(r.events.filter(e => e.kind === 'wait').length, 0);
  r = place(r.state, 'z', linked);                                // e 想升 3 需 age 2 且 c ≤ 1：c 是 1 → 成立
  assert.equal(r.state.lv.e, 3);
  // 另一條路：先讓 c 長到 2 再看 e 在等 a
  const blocked = { ...linked, ITEMS: { ...linked.ITEMS, c: { name: 'C', max: 2, up: { 2: { always: true } } } } };
  let b = place(createState(blocked), 'c', blocked).state; b = place(b, 'e', blocked).state; b = place(b, 'a', blocked).state;   // c 2、e 1、a 剛放 1
  const r2 = place(b, 'z', blocked);
  const w = r2.events.filter(e => e.kind === 'wait');
  assert.equal(w.length, 1); assert.deepEqual(w[0].waits.find(x => x.item === 'e'), { item: 'e', for: ['a'] });
  assert.ok(!w[0].waits.some(x => x.item === 'z'), 'freshly placed z is not waiting');
});
// 「要低於／不在」的條件不是幫手：via 只列 minLevel／present，wait 只在缺幫手時發、for 列缺的幫手
const keep = {
  ORDER: ['h', 'x', 'k', 'q'],
  ITEMS: {
    h: { name: 'H', max: 2, up: { 2: { age: ['h', 4] } } },
    x: { name: 'X', max: 2, up: { 2: { always: true } } },
    k: { name: 'K', max: 3, up: { 2: { and: [{ age: ['k', 1] }, { maxLevel: ['x', 1] }] }, 3: { and: [{ minLevel: ['h', 2] }, { maxLevel: ['x', 1] }] } } },
    q: { name: 'Q', max: 1, up: {} },
  },
  AFTER_TURN: [], STORIES: { placed: { h: '', x: '', k: '', q: '' }, grow: { h: { 2: '' }, x: { 2: '' }, k: { 2: '', 3: '' }, q: {} } },
};
test('via lists only helpers (minLevel/present), never the "must stay below" items', () => {
  const s = place(createState(keep), 'k', keep).state;
  const r = place(s, 'q', keep), g = r.events.find(e => e.kind === 'grow' && e.item === 'k');
  assert.deepEqual(g.via, [], 'x ≤ 1 is not a helper');
});
test('wait fires only when a helper is missing, and names the missing helper', () => {
  let s = place(createState(keep), 'k', keep).state; s = place(s, 'q', keep).state;   // k 2；k 3 需 h ≥ 2（h 還沒放）且 x ≤ 1
  let r = place(s, 'h', keep); const w = r.events.find(e => e.kind === 'wait');
  assert.deepEqual(w.waits, [{ item: 'k', for: ['h'] }]);
  // 只被「x 要 ≤ 1」擋住（h 夠了、x 已經 2）：不算在等誰，不發 wait
  const blockedOnlyByMax = { ...keep, ITEMS: { ...keep.ITEMS, h: { name: 'H', max: 2, up: { 2: { always: true } } } } };
  let b = place(createState(blockedOnlyByMax), 'k', blockedOnlyByMax).state; b = place(b, 'h', blockedOnlyByMax).state; b = place(b, 'x', blockedOnlyByMax).state;
  r = place(b, 'q', blockedOnlyByMax); assert.equal(r.state.lv.x, 2); assert.equal(r.events.filter(e => e.kind === 'wait').length, 0);
});

// ── 演出層共用的事件折疊 ──
test('foldEvent applies placed / grow / delta / flag and leaves the input alone', () => {
  const s0 = { lv: { alpha: 0, delta: 2 }, flags: {} };
  const s1 = foldEvent(s0, { kind: 'placed', item: 'alpha', to: 1 });
  assert.equal(s1.lv.alpha, 1); assert.equal(s0.lv.alpha, 0);
  assert.equal(foldEvent(s1, { kind: 'grow', item: 'alpha', from: 1, to: 2 }).lv.alpha, 2);
  assert.equal(foldEvent(s1, { kind: 'fx', item: 'alpha', cause: 'delta', delta: { target: 'alpha', from: 1, to: 1 } }).lv.alpha, 1);
  assert.equal(foldEvent(s1, { kind: 'fx', item: 'delta', delta: { target: 'delta', from: 2, to: 3 } }).lv.delta, 3);
  assert.equal(foldEvent(s1, { kind: 'fx', item: 'gamma', flag: { name: 'flooded', value: true } }).flags.flooded, true);
  assert.equal(foldEvent(s1, { kind: 'wait', item: 'alpha', waits: [] }), s1);
});

// ── 跳級與 delay ──
const hop = {
  ORDER: ['b', 'a', 'c', 'd'],   // b 先掃：b 這回合長上來，同一輪掃到 a 時 a 就能跳
  ITEMS: {
    a: { name: 'A', max: 5, up: { 2: { always: true }, 3: { always: true }, 4: { minLevel: ['b', 9] }, 5: { always: true } },
         jump: { 4: { minLevel: ['b', 2] } }, onLevel: { 3: [{ flag: { name: 'a3' } }], 4: [{ flag: { name: 'a4' } }] } },
    b: { name: 'B', max: 2, up: { 2: { always: true } } },
    c: { name: 'C', max: 3, up: { 2: { always: true }, 3: { always: true } }, jump: { 3: { always: true } } },
    d: { name: 'D', max: 3, up: { 2: { always: true }, 3: { always: true } }, delay: { 3: { minLevel: ['b', 2] } } },
  },
  AFTER_TURN: [], STORIES: { placed: { a: '', b: '', c: '', d: '' }, grow: { a: { 2: 'a2', 3: 'a3', 4: 'a4', 5: 'a5' }, b: { 2: 'b2' }, c: { 2: 'c2', 3: 'c3' }, d: { 2: 'd2', 3: 'd3' } } },
};
test('jump: an item at n−2 whose jump[n] holds rises two levels in one turn with two grow events, the second marked jump', () => {
  const s = place(createState(hop), 'a', hop).state;  // a 放下當回合 1 → 2
  const r = place(s, 'b', hop);                        // b 先掃、放下就到 2 → a 在 2、jump[4]（b ≥ 2）成立 → 2→3→4
  assert.equal(r.state.lv.a, 4);
  assert.deepEqual(grows(r).filter(g => g.startsWith('a')), ['a2>3', 'a3>4J']);
  const [g1, g2] = r.events.filter(e => e.kind === 'grow' && e.item === 'a');
  assert.deepEqual([g1.story, g2.story], ['a3', 'a4']); assert.deepEqual(g2.via, ['b']); assert.equal(g1.jump, undefined);
  assert.equal(r.state.flags.a3, true, 'the skipped-through level still fires its onLevel'); assert.equal(r.state.flags.a4, true);
  assert.equal(place(r.state, 'c', hop).state.lv.a, 5, 'next turn back to +1');
});
test('a jump only reads jump[n]: up[n] failing (b ≥ 9) does not block it, up[n−1] ∧ up[n] alone never jumps', () => {
  const s = place(createState(hop), 'a', hop).state;   // a2（b 沒放，jump[4] 永遠不成立）
  const r = place(s, 'c', hop);
  assert.deepEqual(grows(r).filter(g => g.startsWith('a')), ['a2>3']);
  // 掃到 a 時跳級還不成立、a 先 +1；之後同回合 b 才長上來也不會再跳
  const late = { ...hop, ORDER: ['a', 'b', 'c', 'd'] };
  const t = place(createState(late), 'a', late).state;   // a2
  const r2 = place(t, 'b', late);
  assert.equal(r2.state.lv.b, 2); assert.deepEqual(grows(r2).filter(g => g.startsWith('a')), ['a2>3']);
});
// 跳級只看 jump[n]：up[n−1] 不成立也照跳（兩個 grow 事件的 via 都是跳級條件的幫手）
test('a jump does not read up[n−1]: up[3] fails, jump[4] holds → 2 → 4 in one turn', () => {
  const sp = { ORDER: ['b', 'a', 'z'], ITEMS: {
    a: { name: 'A', max: 4, up: { 2: { always: true }, 3: { minLevel: ['b', 9] }, 4: { always: true } }, jump: { 4: { present: 'b' } } },
    b: { name: 'B', max: 1, up: {} },
    z: { name: 'Z', max: 1, up: {} } } };
  const s = place(createState(sp), 'a', sp).state;    // a 2
  assert.equal(s.lv.a, 2);
  assert.deepEqual(grows(place(s, 'z', sp)), [], 'without b: up[3] fails and no jump');
  const r = place(s, 'b', sp);
  assert.equal(r.state.lv.a, 4);
  assert.deepEqual(grows(r), ['a2>3', 'a3>4J']);
  for (const e of r.events.filter(e => e.kind === 'grow')) assert.deepEqual(e.via, ['b']);
});
// 每回合每物品最多 +2，連 delta 一起算（正向 delta 被壓到「回合開始的級數 +2」，壓到 0 就不發事件）
const push = {
  ORDER: ['x', 'p', 'q', 'z'],
  ITEMS: {
    x: { name: 'X', max: 9, up: { 2: { always: true }, 3: { always: true }, 4: { always: true }, 5: { always: true }, 6: { always: true }, 7: { always: true }, 8: { always: true }, 9: { always: true } },
         jump: { 3: { always: true }, 4: { always: true }, 5: { always: true }, 6: { always: true }, 7: { always: true }, 8: { always: true }, 9: { always: true } } },
    p: { name: 'P', max: 1, up: {}, fx: [{ delta: { target: 'x', by: 5 }, story: 'p推x' }] },
    q: { name: 'Q', max: 1, up: {}, fx: [{ delta: { target: 'x', by: 1 }, story: 'q推x' }] },
    z: { name: 'Z', max: 1, up: {}, fx: [{ delta: { target: 'x', by: 1 }, story: 'z推x' }, { delta: { target: 'x', by: 1 }, story: 'z再推x' }, { delta: { target: 'x', by: 1 }, story: 'z三推x' }] },
  },
  AFTER_TURN: [], STORIES: { placed: { x: '', p: '', q: '', z: '' }, grow: { x: { 2: '', 3: '', 4: '', 5: '', 6: '', 7: '', 8: '', 9: '' }, p: {}, q: {}, z: {} } },
};
test('+2 cap: a positive delta never lifts an item past its turn-start level + 2, and growth respects the same cap', () => {
  const s = place(createState(push), 'x', push).state;            // x 放下當回合就到 2
  assert.equal(s.lv.x, 2);
  const r = place(s, 'p', push);                                  // +5 → 壓成 +2（2 → 4），x 這回合不再長
  assert.deepEqual(r.events.find(e => e.delta).delta, { target: 'x', from: 2, to: 4 }); assert.equal(r.state.lv.x, 4);
  assert.deepEqual(grows(r), []);
  const q = place(s, 'q', push);                                  // +1（2 → 3），再 +1 → 4（剛好 +2；jump[5] 是 +3 → 不跳）
  assert.equal(q.state.lv.x, 4);
  let t = place(createState(push), 'x', push).state; t = advance(t, push).state; t = advance(t, push).state;   // x 2 → 4 → 6（都是跳級）
  assert.equal(t.lv.x, 6);
  const j = place(t, 'q', push);                                  // delta +1 → 7；jump[9] 是 +3 → 不跳，改 +1 → 8
  assert.equal(j.state.lv.x, 8); assert.deepEqual(grows(j), ['x7>8']);
  const z = place(t, 'z', push);                                  // 三次 +1：第三次壓到 0 → 沒有那個事件
  assert.equal(z.state.lv.x, 8); assert.deepEqual(z.events.filter(e => e.delta).map(e => e.story), ['z推x', 'z再推x']);
});
test('jump fires only from exactly n−2: one level short or past it, the item takes +1 or waits', () => {
  const s0 = createState(hop);
  const at = n => advance({ ...s0, lv: { ...s0.lv, a: n, b: 2 }, age: { ...s0.age, a: 3, b: 3 }, held: { ...s0.held, a: 1, b: 1 }, turn: 4 }, hop);
  assert.deepEqual(grows(at(1)), ['a1>2'], 'one level short: +1');
  assert.deepEqual(grows(at(2)), ['a2>3', 'a3>4J'], 'exactly n−2: jump');
  assert.deepEqual(grows(at(3)), [], 'past it: up[4] (b ≥ 9) waits');
});
test('jump never crosses a locked item and never exceeds max', () => {
  const s0 = createState(hop), s = { ...s0, lv: { ...s0.lv, c: 1 }, age: { ...s0.age, c: 1 }, held: { ...s0.held, c: 1 }, turn: 1 };   // c1：jump[3] 永遠成立
  const locked = advance({ ...s, locked: { c: true } }, hop);
  assert.equal(locked.state.lv.c, 1, 'locked items never jump');
  const r = advance(s, hop);
  assert.equal(r.state.lv.c, 3); assert.deepEqual(grows(r), ['c1>2', 'c2>3J']);
  const big = { ...hop, ITEMS: { ...hop.ITEMS, c: { ...hop.ITEMS.c, jump: { 3: { always: true }, 4: { always: true } } } } };
  let t = place(createState(big), 'c', big).state; t = advance(t, big).state;      // c 2 → 3 = max
  assert.equal(t.lv.c, 3); assert.equal(advance(t, big).state.lv.c, 3, 'jump[max+1] is never taken');
  const two = { ...hop, ITEMS: { ...hop.ITEMS, c: { ...hop.ITEMS.c, max: 2, up: { 2: { always: true } } } } };
  assert.equal(advance(s, two).state.lv.c, 2, 'a jump to 3 is ignored when max is 2');
});
test('placed items grow at most to Lv2 in their placement turn; at most +2 per item per turn', () => {
  const r = place(createState(hop), 'c', hop);                 // c 的 jump[3] 永遠成立，但回合開始是 0 級 → 到 2 為止
  assert.equal(r.state.lv.c, 2); assert.deepEqual(grows(r), ['c1>2']);
  let s = r.state;
  for (const id of ['a', 'b', 'd']) {
    const before = s.lv; const t = place(s, id, hop); s = t.state;
    for (const k of hop.ORDER) assert.ok(s.lv[k] - before[k] <= 2, `${k} grew more than 2`);
    assert.ok(new Set(grows(t).map(g => g[0])).size === grows(t).filter(g => !g.endsWith('J')).length, 'one step (+1 or jump) per item per turn');
  }
});
test('delay[n]: while its condition holds the level waits one extra turn, otherwise it comes on time', () => {
  const s = place(createState(hop), 'd', hop).state;    // d 放下當回合就到 2（b 沒放，delay 不成立）
  assert.equal(s.lv.d, 2);
  assert.equal(advance(s, hop).state.lv.d, 3, 'no delay → Lv3 the next turn');
  let w = place(createState(hop), 'b', hop).state; w = place(w, 'd', hop).state;   // b2；d2（剛長上來，held 0）
  assert.equal(w.lv.d, 2);
  const late = advance(w, hop); assert.equal(late.state.lv.d, 2, 'b ≥ 2 → Lv3 waits one more turn');
  assert.equal(late.events.filter(e => e.kind === 'wait').length, 0, 'a delay is not waiting for a helper');
  assert.deepEqual(late.events.filter(e => e.kind === 'stall').map(e => e.item), ['d'], 'it is recorded as a stall');
  assert.equal(advance(late.state, hop).state.lv.d, 3, 'and then comes');
});
// 剛放下的物品當回合就參加掃描；沒有預設跳級，只有 spec 寫的 jump[n] 會跳
const choice = {
  ORDER: ['h', 'g', 'k', 'm', 'z'],
  ITEMS: {
    g: { name: 'G', max: 5, up: { 2: { always: true }, 3: { always: true }, 4: { minLevel: ['h', 2] }, 5: { minLevel: ['h', 9] } },
         jump: { 4: { present: 'k' } }, onLevel: { 3: [{ flag: { name: 'g3' } }] } },
    h: { name: 'H', max: 2, up: { 2: { always: true } } },
    k: { name: 'K', max: 1, up: {} },
    m: { name: 'M', max: 5, up: { 2: { always: true }, 3: { always: true }, 4: { always: true }, 5: { always: true } }, jump: { 5: { always: true } } },
    z: { name: 'Z', max: 1, up: {} },
  },
  AFTER_TURN: [], STORIES: { placed: { g: '', h: '', k: '', m: '', z: '' }, grow: { g: { 2: 'g2', 3: 'g3', 4: 'g4', 5: 'g5' }, h: { 2: '' }, k: {}, m: { 2: '', 3: '', 4: '', 5: '' }, z: {} } },
};
test('a placed item joins the growth scan in its placement turn: up[2] holds → it ends the turn at Lv2 (never Lv3)', () => {
  const r = place(createState(choice), 'g', choice);
  assert.equal(r.state.lv.g, 2); assert.deepEqual(grows(r), ['g1>2']);
  assert.deepEqual(r.events.map(e => e.kind), ['placed', 'grow']);
  assert.equal(r.state.held.g, 0); assert.equal(r.state.age.g, 0);
  const stuck = place(createState(choice), 'k', choice);       // k 沒有 up[2]：停在 1，也不算在等誰
  assert.equal(stuck.state.lv.k, 1); assert.ok(!stuck.events.some(e => e.kind === 'wait'));
});
test('an item with no jump[n] takes +1 even when up[n−1] and up[n] both hold', () => {
  let s = place(createState(choice), 'h', choice).state; s = place(s, 'g', choice).state;   // h2、g2
  let r = place(s, 'z', choice);
  assert.deepEqual(grows(r), ['g2>3']); assert.equal(r.state.flags.g3, true);
  assert.deepEqual(r.events.find(e => e.kind === 'grow' && e.item === 'g').via, [], 'up[3] is always: nobody to thank');
  s = place(createState(choice), 'g', choice).state;
  r = place(s, 'k', choice);
  assert.deepEqual(grows(r), ['g2>3', 'g3>4J']);
  assert.deepEqual(r.events.find(e => e.jump).via, ['k'], 'via = the written jump (present k)');
  let t = place(createState(choice), 'm', choice).state; assert.equal(t.lv.m, 2);
  t = advance(t, choice).state; assert.equal(t.lv.m, 3, 'no jump[4] → +1');
  assert.deepEqual(grows(advance(t, choice)), ['m3>4', 'm4>5J'], 'its explicit jump[5] works');
});
// via 只列「這次真的讓條件成立」的幫手：or 只算成立的那一支、and 全列、跳級先列第一級的幫手
const cause = {
  ORDER: ['ore', 'gear', 'rail', 'p', 'z'],
  ITEMS: {
    ore: { name: 'O', max: 1, up: {} },
    gear: { name: 'G', max: 3, up: { 2: { always: true }, 3: { always: true } } },
    rail: { name: 'R', max: 4, up: { 2: { always: true }, 3: { always: true }, 4: { always: true } } },
    p: { name: 'P', max: 4, up: { 2: { always: true }, 3: { or: [{ minLevel: ['gear', 3] }, { minLevel: ['rail', 4] }] }, 4: { present: 'ore' } },
         jump: { 4: { and: [{ or: [{ minLevel: ['gear', 3] }, { minLevel: ['rail', 4] }] }, { present: 'ore' }] } } },
    z: { name: 'Z', max: 1, up: {} },
  },
  AFTER_TURN: [], STORIES: { placed: { ore: '', gear: '', rail: '', p: '', z: '' }, grow: { ore: {}, gear: { 2: '', 3: '' }, rail: { 2: '', 3: '', 4: '' }, p: { 2: '', 3: '', 4: '' }, z: {} } },
};
test('satisfiedHelpers: or → only the satisfied alternative(s); and → all; maxLevel/flag/age never; nothing when the condition fails', () => {
  const st = lv => ({ lv: { ore: 0, gear: 0, rail: 0, p: 0, z: 0, ...lv }, age: {}, held: {}, flags: { f: true }, locked: {} });
  const either = { or: [{ minLevel: ['gear', 3] }, { minLevel: ['rail', 4] }] };
  assert.deepEqual(satisfiedHelpers(either, st({ rail: 4 }), 'p', cause), ['rail']);
  assert.deepEqual(satisfiedHelpers(either, st({ gear: 3 }), 'p', cause), ['gear']);
  assert.deepEqual(satisfiedHelpers(either, st({ gear: 3, rail: 4 }), 'p', cause), ['gear', 'rail'], 'both alternatives hold → both listed, in ORDER');
  assert.deepEqual(satisfiedHelpers(either, st({ gear: 2 }), 'p', cause), [], 'condition fails → nobody');
  assert.deepEqual(satisfiedHelpers({ and: [{ present: 'ore' }, { minLevel: ['rail', 2] }, { maxLevel: ['gear', 1] }, { flag: 'f' }] }, st({ ore: 1, rail: 2 }), 'p', cause), ['ore', 'rail']);
  assert.deepEqual(satisfiedHelpers({ or: [{ and: [{ minLevel: ['gear', 3] }, { minLevel: ['ore', 1] }] }, { present: 'rail' }] }, st({ gear: 3, rail: 1 }), 'p', cause), ['rail'], 'a failed and-branch lends none of its helpers');
  assert.deepEqual(satisfiedHelpers({ always: true }, st({}), 'p', cause), []);
  assert.deepEqual(satisfiedHelpers({ minLevel: ['p', 1] }, st({ p: 1 }), 'p', cause), [], 'self is never a helper');
});
test('via lists only the helpers that satisfied the condition; a jump lists the first level\'s helpers first', () => {
  let s = place(createState(cause), 'rail', cause).state; s = advance(s, cause).state; s = advance(s, cause).state;   // rail 2 → 4
  assert.equal(s.lv.rail, 4);
  s = place(s, 'p', cause).state; assert.equal(s.lv.p, 2);
  let r = place(s, 'z', cause), g = r.events.find(e => e.kind === 'grow' && e.item === 'p' && e.to === 3);
  assert.ok(g && !g.jump, 'p takes +1 (up[4] needs ore)'); assert.deepEqual(g.via, ['rail']);
  // 跳級：ore 在場、rail 4 → p 2 → 4 一回合；先列第一級（up[3]）的 rail，再列第二級才有的 ore（不照 ORDER 混排）
  s = place(createState(cause), 'rail', cause).state; s = advance(s, cause).state; s = advance(s, cause).state;
  s = place(s, 'ore', cause).state; s = place(s, 'p', cause).state; assert.equal(s.lv.p, 2);
  r = place(s, 'z', cause);
  const jumps = r.events.filter(e => e.kind === 'grow' && e.item === 'p');
  assert.deepEqual(jumps.map(e => [e.to, !!e.jump]), [[3, false], [4, true]]);
  for (const e of jumps) assert.deepEqual(e.via, ['rail', 'ore'], `jump event to ${e.to}: the first level's helpers first, then the second level's`);
});
// allMax、finale 不是幫手：依賴、幫手、等待一律略過；物品條件裡也能用（引擎把 max、finaleOf 帶進條件）
test('{ allMax } and { finale } are never helpers or dependencies', () => {
  const c = { and: [{ allMax: true }, { finale: 'shield' }, { minLevel: ['beta', 2] }] };
  assert.deepEqual(condDeps(c, 'alpha', mini), ['beta']);
  assert.deepEqual(helperDeps(c, 'alpha', mini), ['beta']);
  const s = { ...createState(mini), lv: { alpha: 4, beta: 4, gamma: 3, delta: 3 } };
  assert.deepEqual(satisfiedHelpers(c, s, 'alpha', mini), ['beta']);
  assert.deepEqual(satisfiedHelpers(c, { ...s, lv: { ...s.lv, delta: 2 } }, 'alpha', mini), [], 'not all max → nothing holds');
});
test('an item condition may use { finale }: it holds once the finale result matches; no via, no wait', () => {
  const fin = { ORDER: ['x', 'y', 'z'], ITEMS: {
      x: { name: 'X', max: 2, up: { 2: { finale: 'win' } } },
      y: { name: 'Y', max: 2, up: { 2: { always: true } } },
      z: { name: 'Z', max: 1, up: {} } },
    FINALE: [{ id: 'win', when: { minLevel: ['y', 2] } }] };
  let s = place(createState(fin), 'x', fin).state;
  const r1 = place(s, 'z', fin); s = r1.state;
  assert.equal(s.lv.x, 1); assert.ok(!r1.events.some(e => e.kind === 'wait'), 'a finale condition names no helper');
  const r2 = place(s, 'y', fin);
  assert.deepEqual(grows(r2), ['y1>2', 'x1>2'], 'y reaches 2 → finale is win → x grows on the next scan pass');
  assert.deepEqual(r2.events.find(e => e.item === 'x').via, []);
});

// ── 災害物品（hazard）：while 成立期間，之後放下的 X 當場套用災害物品 fx 裡 lock === X 的那條 ──
test('hazard: beta placed while gamma is Lv1 is flooded at once (locked, flag, event right after placed), before the growth scan', () => {
  const { r, s } = play(mini, ['gamma', 'beta']);
  assert.equal(s.locked.beta, true); assert.equal(s.flags.flooded, true); assert.equal(s.lv.beta, 1);
  assert.deepEqual(r.events[1], { kind: 'fx', item: 'gamma', cause: 'gamma', lock: 'beta', flag: { name: 'flooded', value: true }, story: '工坊淹水' });
  assert.deepEqual(r.events.map(e => e.kind), ['placed', 'fx', 'grow'], 'gamma grows to 2 after the check');
});
test('hazard reads the turn-start level: gamma 2 → 3 in the same turn still floods the beta placed that turn', () => {
  let s = place(createState(mini), 'gamma', mini).state;
  s = advance(s, mini).state; assert.equal(s.lv.gamma, 2);
  const r = place(s, 'beta', mini);
  assert.equal(r.state.lv.gamma, 3, 'gamma clears this very turn'); assert.equal(r.state.locked.beta, true);
  const kinds = r.events.map(e => `${e.kind}:${e.item}`);
  assert.ok(kinds.indexOf('fx:gamma') < kinds.indexOf('grow:gamma'));
  assert.ok(!place(r.state, 'alpha', mini).state.locked.alpha, 'gamma Lv3: the hazard is over');
});
test('hazard applies only the rule whose lock is the placed item; the placement-turn reactions are not repeated', () => {
  let s = place(createState(mini), 'alpha', mini).state;   // alpha 2
  const g = place(s, 'gamma', mini); s = g.state;
  assert.deepEqual(g.events.filter(e => e.cause === 'gamma').map(e => e.flag.name), ['gust'], 'alpha 2: not washed, just the gust');
  const r = place(s, 'beta', mini);
  assert.deepEqual(r.events.filter(e => e.cause === 'gamma').map(e => e.lock), ['beta'], 'only the beta rule, no second gust');
  assert.ok(!place(createState(mini), 'gamma', mini).events.some(e => e.kind === 'fx'), 'gamma itself is never its own target');
});
test('hazard is declared in the spec, not hard-coded: any item with hazard.while locks a later placement', () => {
  const w = { ORDER: ['w', 'x', 'y'], ITEMS: {
    w: { name: 'W', max: 3, up: { 2: { always: true }, 3: { always: true } }, hazard: { while: { and: [{ minLevel: ['w', 1] }, { maxLevel: ['w', 2] }] } },
         fx: [{ when: { and: [{ present: 'x' }, { maxLevel: ['x', 1] }] }, lock: 'x', flag: { name: 'wet' }, story: 'x 濕了' }] },
    x: { name: 'X', max: 2, up: { 2: { always: true } } }, y: { name: 'Y', max: 2, up: { 2: { always: true } } } },
    AFTER_TURN: [], STORIES: { placed: { w: '', x: '', y: '' }, grow: { w: { 2: '', 3: '' }, x: { 2: '' }, y: { 2: '' } } } };
  const s = place(createState(w), 'w', w).state;    // w 放下當回合長到 2
  const r = place(s, 'x', w);
  assert.equal(r.state.locked.x, true); assert.equal(r.state.lv.x, 1);
  assert.deepEqual(r.events[1], { kind: 'fx', item: 'w', cause: 'w', lock: 'x', flag: { name: 'wet', value: true }, story: 'x 濕了' });
  const t = place(place(createState(w), 'w', w).state, 'y', w).state;   // w 3
  assert.ok(!place(t, 'x', w).state.locked.x, 'w Lv3: no hazard');
});
test('lockFlags(spec) reads the lock ↔ flag pairs from the rules, once per spec', () => {
  assert.deepEqual(lockFlags(mini), { beta: 'flooded', alpha: 'washed' });
  assert.equal(lockFlags(mini), lockFlags(mini), 'computed once per spec');
  assert.deepEqual(lockFlags({ ITEMS: { a: { fx: [{ lock: 'b', flag: { name: 'x' } }] } } }), { b: 'x' });
  assert.deepEqual(lockFlags({ ITEMS: {}, AFTER_TURN: [{ lock: 'c', flag: { name: 'y' } }, { lock: 'd' }] }), { c: 'y' });
  assert.deepEqual(lockFlags(undefined), {});
});

// ── 搗蛋物品（grip）：while 成立期間放下的目標被抓住（gripped_<id> = 抓它的物品），直到那個物品的 while 不成立 ──
test('grip: alpha placed while delta is Lv1 is gripped (flag, fx event after placed), does not grow and waits for delta', () => {
  const { r, s } = play(mini, ['delta', 'alpha']);
  assert.deepEqual(r.events[1], { kind: 'fx', item: 'alpha', cause: 'delta', flag: { name: 'gripped_alpha', value: 'delta' }, story: '小鬼抓住剛蓋的基地' });
  assert.equal(s.flags.gripped_alpha, 'delta');
  assert.equal(s.lv.alpha, 1, 'alpha up[2] is always, but delta holds it');
  assert.deepEqual(waitOf(r, 'alpha'), { item: 'alpha', for: ['delta'] }, 'listed as waiting for delta even in its placement turn');
  assert.deepEqual(waitOf(r, 'delta'), { item: 'delta', for: ['alpha', 'beta'] });
  const next = advance(s, mini);
  assert.equal(next.state.lv.alpha, 1, 'still held');
  assert.ok(!next.events.some(e => e.flag?.name === 'gripped_alpha'), 'gripped once, at placement');
  assert.equal(grippedBy(s, 'alpha', mini), 'delta');
});
test('an action with grip: true grips the target of its delta (knocked down and held)', () => {
  const s0 = place(createState(mini), 'alpha', mini).state;   // alpha 2
  const r = place(s0, 'delta', mini);
  assert.deepEqual(r.events[1], { kind: 'fx', item: 'alpha', cause: 'delta', delta: { target: 'alpha', from: 2, to: 1 }, flag: { name: 'gripped_alpha', value: 'delta' }, story: '小鬼踢倒基地' });
  assert.equal(r.state.lv.alpha, 1); assert.equal(waitOf(r, 'alpha'), undefined, 'a knocked item sits the turn out and is not listed as waiting');
  const t = advance(r.state, mini);
  assert.equal(t.state.lv.alpha, 1, 'held: no regrow while delta is Lv1–2');
  assert.deepEqual(waitOf(t, 'alpha'), { item: 'alpha', for: ['delta'] });
});
test('grippedBy(state, id, spec): the recorded gripper while its grip.while holds, else null', () => {
  const lv = d => ({ alpha: 1, beta: 0, gamma: 0, delta: d });
  assert.equal(grippedBy({ lv: lv(2), flags: { gripped_alpha: 'delta' } }, 'alpha', mini), 'delta');
  assert.equal(grippedBy({ lv: lv(3), flags: { gripped_alpha: 'delta' } }, 'alpha', mini), null, 'delta grew out of its while');
  assert.equal(grippedBy({ lv: lv(2), flags: {} }, 'alpha', mini), null, 'not gripped');
  assert.equal(grippedBy({ lv: lv(2), flags: { gripped_alpha: 'beta' } }, 'alpha', mini), null, 'beta has no grip');
});
test('grip: a gripped item scanned before its gripper still grows in the turn the gripper leaves (the scan repeats)', () => {
  const m = { ORDER: ['m', 'r', 't'], ITEMS: {
    m: { name: 'M', max: 3, up: { 2: { always: true }, 3: { always: true } } },
    r: { name: 'R', max: 3, up: { 2: { always: true }, 3: { present: 't' } }, grip: { while: { and: [{ minLevel: ['r', 1] }, { maxLevel: ['r', 2] }] }, targets: ['m'], story: { m: 'r 抓住 m' } } },
    t: { name: 'T', max: 1, up: {} } },
    AFTER_TURN: [], STORIES: { placed: { m: '', r: '', t: '' }, grow: { m: { 2: 'm2', 3: 'm3' }, r: { 2: 'r2', 3: 'r3' }, t: {} } } };
  let s = place(createState(m), 'r', m).state;      // r 2
  const gripped = place(s, 'm', m); s = gripped.state;
  assert.equal(s.lv.m, 1); assert.equal(gripped.events[1].story, 'r 抓住 m');
  assert.deepEqual(waitOf(gripped, 'm'), { item: 'm', for: ['r'] });
  const free = place(s, 't', m);
  assert.deepEqual(free.events.filter(e => e.kind === 'grow').map(e => `${e.item}${e.to}`), ['r3', 'm2'], 'm is skipped in the first pass, grows in the second');
  assert.equal(free.state.flags.gripped_m, 'r', 'the flag stays (value: who gripped it)');
});
test('grip trial run: a gripper that leaves its while during this very turn does not grip at all', () => {
  const sp = { ORDER: ['m', 'g'], ITEMS: {
    m: { name: 'M', max: 2, up: { 2: { always: true } } },
    g: { name: 'G', max: 3, up: { 2: { always: true }, 3: { present: 'm' } }, grip: { while: { maxLevel: ['g', 2] }, targets: ['m'] } } } };
  const s = place(createState(sp), 'g', sp).state;  // g 2：while 成立
  const r = place(s, 'm', sp);                       // 試跑：m 放下 → g 的 up[3]（m 在場）成立 → g 3 → while 不成立 → 不抓
  assert.ok(!r.state.flags.gripped_m && !r.events.some(e => e.flag?.name === 'gripped_m'), 'no grip-and-release in one turn');
  assert.equal(r.state.lv.g, 3); assert.equal(r.state.lv.m, 2, 'm grows as usual');
});
test('grip: an item is gripped only by the first gripper in ORDER, once', () => {
  const sp = { ORDER: ['m', 'r', 'q'], ITEMS: {
    m: { name: 'M', max: 2, up: { 2: { always: true } } },
    r: { name: 'R', max: 1, up: {}, grip: { while: { present: 'r' }, targets: ['m'], story: { m: 'r 抓' } } },
    q: { name: 'Q', max: 1, up: {}, grip: { while: { present: 'q' }, targets: ['m'], story: { m: 'q 抓' } } } } };
  const { r, s } = play(sp, ['q', 'r', 'm']);
  assert.equal(s.flags.gripped_m, 'r');
  assert.deepEqual(r.events.filter(e => e.flag?.name === 'gripped_m').map(e => e.story), ['r 抓']);
});
test('grip: only the recorded gripper holds; another gripper whose while holds does not', () => {
  const two = { ORDER: ['m', 'r', 'q'], ITEMS: {
    m: { name: 'M', max: 2, up: { 2: { always: true } } },
    r: { name: 'R', max: 3, up: { 2: { always: true }, 3: { present: 'q' } }, grip: { while: { maxLevel: ['r', 2] }, targets: ['m'], story: { m: 'r 抓' } } },
    q: { name: 'Q', max: 3, up: { 2: { minLevel: ['r', 3] }, 3: { always: true } }, grip: { while: { maxLevel: ['q', 1] }, targets: ['m'], story: { m: 'q 抓' } } } },
    AFTER_TURN: [], STORIES: { placed: { m: '', r: '', q: '' }, grow: { m: { 2: '' }, r: { 2: '', 3: '' }, q: { 2: '', 3: '' } } } };
  let s = place(createState(two), 'r', two).state;
  const b = place(s, 'm', two); s = b.state;
  assert.equal(b.events[1].story, 'r 抓'); assert.equal(s.flags.gripped_m, 'r');
  assert.equal(grippedBy(s, 'm', two), 'r');
  const after = place(s, 'q', two);
  assert.equal(after.state.lv.r, 3); assert.equal(grippedBy(after.state, 'm', two), null, 'only the recorded gripper holds it');
  assert.equal(after.state.lv.m, 2, 'free once its own gripper left');
});
test('grip: an item locked by a hazard the moment it is placed is not gripped as well', () => {
  const sp = { ORDER: ['h', 'g', 'm'], ITEMS: {
    h: { name: 'H', max: 2, up: { 2: { minLevel: ['h', 9] } }, hazard: { while: { present: 'h' } }, fx: [{ when: { present: 'm' }, lock: 'm', flag: { name: 'gone' } }] },
    g: { name: 'G', max: 2, up: { 2: { minLevel: ['g', 9] } }, grip: { while: { present: 'g' }, targets: ['m'] } },
    m: { name: 'M', max: 2, up: { 2: { always: true } } } } };
  const { s } = play(sp, ['h', 'g', 'm']);
  assert.equal(s.locked.m, true); assert.equal(s.flags.gone, true); assert.equal(s.flags.gripped_m, undefined);
});
