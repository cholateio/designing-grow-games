// 範例的載入器：starter/examples/ 底下每個有 spec.js 的資料夾就是一個範例。
// 每個範例的期望值（代表順序、結局分佈、正解、報告）以字面值寫在範例自己的 expected.js 裡，跟規則表放在一起：
// 規則改了，就在同一個資料夾重釘（測試重算一次，對不上就失敗）。測試這邊不寫任何範例主題的名詞（主題中立檢查會掃 test/）。
// expected.js 的欄位：
//   TOTAL           全枚舉的順序數（N!）
//   SOLUTION        唯一一條全 MAX 的順序（結局必須是真結局）
//   SOLUTIONS       ACCEPTANCE.trueEndings 不是 1 時用它代替 SOLUTION：全部全 MAX 的順序（都要是真結局），照全枚舉的先後
//   DISTRIBUTION    { 結局 id: 條數 }（resolve，也就是玩家實際看到的）
//   REPRESENTATIVE  { 結局 id: 順序 }：分佈裡出現的每個結局各一條，照順序放完＋收尾回合就是那個結局
//   REPORTS         { deadRules, shadowed, singleOrderEndings }：reports() 的期望值
//   NOTABLE         可省略。[{ order, ending, note, lockedOnPlacement? }]：其他值得釘住的順序（例如示範災害持續的那條）；
//                   lockedOnPlacement: id 表示那個物品在放下的同一回合就被別的物品的反應鎖住
// expected.js 可以先不寫（設計中的新遊戲）：那個範例只跑結構檢查，驗收與釘值的測試標成略過（驗收看 npm run check）。
// 例外：在 skill 資料夾裡（IN_SKILL）跑時，examples/ 底下都是 skill 自帶的範例，少了 expected.js 就失敗，不能悄悄略過。
import { readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXAMPLES_DIR = fileURLToPath(new URL('../../examples/', import.meta.url));

// starter 還放在 skill 資料夾裡（上一層叫 designing-grow-games）？複製到新專案之後就是 false
export const STARTER_DIR = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export const IN_SKILL = basename(dirname(STARTER_DIR)) === 'designing-grow-games';

export const NAMES = existsSync(EXAMPLES_DIR)
  ? readdirSync(EXAMPLES_DIR).filter(n => existsSync(join(EXAMPLES_DIR, n, 'spec.js'))).sort()
  : [];

export async function loadExample(name) {
  const at = file => pathToFileURL(join(EXAMPLES_DIR, name, file)).href;
  const spec = await import(at('spec.js'));
  const expected = existsSync(join(EXAMPLES_DIR, name, 'expected.js')) ? await import(at('expected.js')) : null;
  return { name, spec, expected };
}

export const EXAMPLES = await Promise.all(NAMES.map(loadExample));
