// 主題中立檢查：starter 的程式、工具、測試與空白規則表裡（含註解）不得出現你的遊戲主題的名詞。
// 禁字清單：starter 根目錄（spec.js 旁邊）的 neutral-words.txt，一行一個詞；空行與 # 開頭的行略過。
//   檔案不存在 = 空清單（檢查直接通過）。也可以用 --words <檔案> 指定別的清單。
//   比對不分大小寫；純英數的詞只比整個字（清單裡的 dragon 不會命中 dragons），其他（例如 中文）比子字串。
// 用法：node tools/neutral.mjs [--words <檔案>] [路徑…]——不給路徑就掃 starter 的預設範圍；命中就印「檔名:行號: 內容」並 exit 1。
// 略過任何深度的 node_modules／.git、禁字清單檔本身，以及 starter 最上層的 examples/（範例的規則表本來就有主題名詞）；
// 其他位置的 examples 資料夾照掃。比的是實際路徑（realpath）：從連結路徑掃（例如 macOS 的 /var → /private/var），最上層的 examples/ 照樣豁免。
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(SELF, '../..');
const DEFAULT_TARGETS = ['rules', 'solver', 'tools', 'test', 'spec.template.js'];
const SKIP_DIRS = new Set(['node_modules', '.git']);
const real = path => { try { return realpathSync(path); } catch { return path; } };
const EXAMPLES = real(join(ROOT, 'examples'));

const args = process.argv.slice(2);
let wordsFile = join(ROOT, 'neutral-words.txt');
const wi = args.indexOf('--words');
if (wi >= 0) {
  if (!args[wi + 1]) { console.error('--words 後面要接禁字清單的檔案路徑'); process.exit(2); }
  wordsFile = resolve(args[wi + 1]);
  args.splice(wi, 2);
}
const WORDS_REAL = real(wordsFile);
const WORDS = existsSync(wordsFile)
  ? readFileSync(wordsFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  : [];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = WORDS.length
  ? new RegExp(WORDS.map(w => /^[A-Za-z0-9_]+$/.test(w) ? `\\b${escape(w)}\\b` : escape(w)).join('|'), 'i')
  : null;

function* files(path) {
  const st = statSync(path);
  if (st.isFile()) { yield path; return; }
  for (const name of readdirSync(path).sort()) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(name) && real(full) !== EXAMPLES) yield* files(full); }
    else yield full;
  }
}

const targets = (args.length ? args.map(a => resolve(a)) : DEFAULT_TARGETS.map(t => join(ROOT, t)).filter(existsSync)).map(real);
let hits = 0;
if (PATTERN) for (const target of targets) {
  for (const file of files(target)) {
    if (real(file) === WORDS_REAL) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!PATTERN.test(line)) return;
      hits++;
      console.log(`${relative(process.cwd(), file) || file}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (hits) {
  console.log(`\n主題名詞 ${hits} 處：starter 的程式、工具、測試與空白規則表要保持主題中立（範例放 examples/，禁字清單在 neutral-words.txt）。`);
  process.exit(1);
}
