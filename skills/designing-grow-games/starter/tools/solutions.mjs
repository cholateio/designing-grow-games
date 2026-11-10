// 劇透表產生器：node tools/solutions.mjs <spec 路徑> <輸出 md 路徑>
// 內容：真結局的逐回合表（每回合後的物品欄、每個升級「因為誰」）、每個結局的代表順序與條數、統計（含收尾考驗結果；沒有 FINALE 也通順）、四個報告。
// 輸出檔裡已有的「## 調參紀錄」一節原樣保留（手寫的紀錄接在後面），其餘每次重產。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createState, place, advance } from '../rules/engine.js';
import { endingById } from '../rules/endings.js';
import { enumerate, stats, pacing, reports, loadSpec } from '../solver/run.js';

const [specPath, outPath] = process.argv.slice(2);
if (!outPath) { console.error('用法：node tools/solutions.mjs <spec 路徑> <輸出 md 路徑>'); process.exit(2); }
const spec = await loadSpec(specPath);
const O = spec.ORDER, name = id => spec.ITEMS[id]?.name ?? id;
const title = id => endingById(spec, id)?.title ?? id;
const results = enumerate(spec, { collect: true }), s = stats(results, spec), rep = reports(results, spec);
const SHOW = 5;

// 一個事件寫成一小段：升級寫「物品＋級數（因為誰）」，其他有故事句就用故事句，沒有就寫出改了什麼
function describe(e) {
  if (e.kind === 'grow') {
    const note = [e.jump ? '跳級' : '', e.via.map(name).join('、')].filter(Boolean).join('：');
    return `${name(e.item)}${e.to}${note ? `（${note}）` : ''}`;
  }
  if (e.story) return e.story;
  if (e.delta) return `${name(e.delta.target)} ${e.delta.from}→${e.delta.to}`;
  if (e.flag) return `旗標 ${e.flag.name}=${e.flag.value}`;
  if (e.lock) return `${name(e.lock)} 鎖住`;
  return '';
}

function table(order) {
  let state = createState(spec);
  const steps = [...order.map(id => ['place', id]), ...Array.from({ length: spec.CLOSING_TURNS ?? 0 }, () => ['advance'])];
  const rows = steps.map(([kind, id], i) => {
    const r = kind === 'place' ? place(state, id, spec) : advance(state, spec); state = r.state;
    const ev = r.events.filter(e => e.kind === 'grow' || e.delta || e.flag || e.lock).map(describe).filter(Boolean).join('、');
    const cells = O.map(k => state.lv[k] === spec.ITEMS[k].max ? `**${state.lv[k]}**` : state.lv[k]);
    return `| ${i + 1} | ${kind === 'place' ? name(id) : '（收尾回合）'} | ${cells.join(' | ')} | ${ev} |`;
  });
  const head = `| 回合 | 放 | ${O.map(name).join(' | ')} | 事件（括號＝因為誰） |\n|---|---|${O.map(() => '---').join('|')}|---|`;
  return `${head}\n${rows.join('\n')}`;
}

const truth = (spec.ENDINGS ?? []).find(e => e.kind === 'true');
const trueOrders = results.filter(r => !r.error && r.ending.kind === 'true');
const trueSection = trueOrders.length
  ? trueOrders.slice(0, SHOW).map(r => `### ${r.order.map(name).join(' → ')}\n\n${table(r.order)}\n`).join('\n')
    + (trueOrders.length > SHOW ? `\n（另外還有 ${trueOrders.length - SHOW} 條沒列出）\n` : '')
  : '沒有任何順序走到真結局。\n';
const endingLines = (spec.ENDINGS ?? []).map(e => {
  const first = results.find(r => r.ending.id === e.id);
  return `- **${e.title ?? e.id}**（${e.id}，${e.kind}，${s.byEnding[e.id] ?? 0} 種）：${first ? `${first.order.map(name).join(' → ')}　\`${JSON.stringify(first.order)}\`` : '無'}`;
}).join('\n');

const greedyLine = s.greedy ? `${s.greedy.order.map(name).join(' → ')} ⇒ ${title(s.greedy.ending)}（${s.greedy.maxCount} 個 MAX）` : '引擎出錯';
// 收尾考驗：有 FINALE 就列每種結果的條數；沒有（考驗本身是放進順序裡的物品，或根本不需要）就說收尾畫面照結局 id 挑
const finaleLine = spec.FINALE?.length
  ? `收尾考驗（FINALE）結果：${Object.entries(results.filter(r => !r.error).reduce((n, r) => {
      const k = r.ending.finale ?? '（都不成立）'; n[k] = (n[k] ?? 0) + 1; return n;
    }, {})).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join('、')}`
  : '收尾考驗：沒有 FINALE（考驗本身是放進順序裡的物品，或不需要），收尾畫面照結局 id 挑';
const p = pacing(s.full, spec);
const errors = results.filter(r => r.error).length;
const old = await readFile(outPath, 'utf8').catch(() => '');
const log = old.includes('## 調參紀錄') ? old.slice(old.indexOf('## 調參紀錄')) : '## 調參紀錄\n';

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `# ${spec.TITLE ?? '規則表'} 正解與統計（劇透）

由 \`node tools/solutions.mjs\` 產生。規則改了就要重產。

## 真結局${truth ? `：${truth.title ?? truth.id}` : ''}（${trueOrders.length} 條）

${trueSection}
## 每個結局的代表順序

（取全枚舉裡第一條以它當標題的順序；條數看 resolve，也就是玩家實際看到的）

${endingLines}

## 統計

- 共 ${s.total} 種順序${errors ? `（${errors} 種引擎出錯）` : ''}，全 MAX ${s.full.length} 條
- 結局分佈：${Object.entries(s.byEnding).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${title(id)} ${n}`).join('、')}
- MAX 數分佈 0..${O.length}：${s.maxHist.join(' ')}
- 隨機平均 MAX 數：${s.avgMax.toFixed(2)}
- 貪婪順序：${greedyLine}
- ${finaleLine}
- 節奏（全 MAX 的順序）：單回合最多 ${p.maxGrowsPerTurn} 個升級、最多 ${p.maxMaxesPerTurn} 個同時到 MAX、MAX 至少分散在 ${p.maxTurns} 個回合

## 報告（只報告、不擋）

- 單一順序結局：${rep.singleOrderEndings.length ? rep.singleOrderEndings.map(id => `${title(id)}（${id}）`).join('、') : '無'}
- 死規則：${rep.deadRules.length ? rep.deadRules.map(d => `\`${d}\``).join('、') : '無'}
- 條件成立過、但沒有因它而升級（多半是被跳級跨過或時機不對；不算死規則）：${rep.shadowed.length ? rep.shadowed.map(d => `\`${d}\``).join('、') : '無'}
- 結局集中度：${rep.topEndingShare ? `${title(rep.topEndingShare.id)} 佔 ${(rep.topEndingShare.share * 100).toFixed(1)}%` : '無'}
- 位置可行性（放在第 1..${O.length} 位時看到的最高級）：

| 物品 | MAX | ${O.map((_, k) => `第 ${k + 1} 位`).join(' | ')} |
|---|---|${O.map(() => '---').join('|')}|
${O.map(id => `| ${name(id)} | ${spec.ITEMS[id].max} | ${rep.positionCeiling[id].join(' | ')} |`).join('\n')}

${log}`);
console.log(`寫入 ${outPath}：真結局 ${trueOrders.length} 條`);
