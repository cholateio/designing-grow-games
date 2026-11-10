// 主題中立檢查的測試。禁字一律用合成的詞（zorblax、gnu、甲蟲王），寫在暫存資料夾的清單檔裡；
// starter 自己沒有 neutral-words.txt（預設空清單），所以第一項只確認「沒清單時直接通過」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, appendFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCANNER = fileURLToPath(new URL('../tools/neutral.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [SCANNER, ...args], { encoding: 'utf8' });
const WORDS = '# 合成的禁字\nzorblax\n\ngnu\n甲蟲王\n';
// 在暫存資料夾裡做一份「starter」：tools/neutral.mjs 加上根目錄的 neutral-words.txt
function fakeStarter(base, words = WORDS) {
  mkdirSync(join(base, 'tools'), { recursive: true });
  const copy = join(base, 'tools', 'neutral.mjs');
  copyFileSync(SCANNER, copy);
  if (words !== null) writeFileSync(join(base, 'neutral-words.txt'), words);
  return copy;
}

test('the starter itself passes the check', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('without neutral-words.txt the list is empty and anything passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const copy = fakeStarter(dir, null);
    writeFileSync(join(dir, 'tools', 'x.js'), '// zorblax gnu 甲蟲王\n');
    const r = spawnSync(process.execPath, [copy], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file with a listed word fails the check with its file name and line number (--words)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const list = join(dir, 'words.txt');
    writeFileSync(list, WORDS);
    const src = join(dir, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'clean.js'), 'export const a = 1;\n// gnus and a zorblaxian are not whole-word hits\n');
    assert.equal(run('--words', list, src).status, 0, 'clean: ASCII words match whole words only');
    writeFileSync(join(src, 'bad.js'), 'export const a = 1;\n// the ZORBLAX comes\n');
    const r = run('--words', list, src);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /bad\.js:2/);
    rmSync(join(src, 'bad.js'));
    writeFileSync(join(src, 'zh.md'), '第一行\n第二行\n大甲蟲王來了\n');
    assert.match(run('--words', list, src).stdout, /zh\.md:3/, 'non-ASCII words match as substrings');
    rmSync(join(src, 'zh.md'));
    writeFileSync(join(src, 'word.js'), '// a gnu here\n');
    assert.equal(run('--words', list, src).status, 1, 'whole word');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('neutral-words.txt next to the starter root is read by default, and is itself not scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const copy = fakeStarter(dir);
    const scan = () => spawnSync(process.execPath, [copy, dir], { encoding: 'utf8' });
    assert.equal(scan().status, 0, 'the list file does not hit itself: ' + scan().stdout);
    appendFileSync(copy, '// zorblax\n');
    const dirty = scan();
    assert.equal(dirty.status, 1, 'the scanner scans its own file too');
    assert.match(dirty.stdout, /neutral\.mjs:\d+/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only the top-level examples/ next to the scanner\'s root is exempt; node_modules is skipped anywhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const copy = fakeStarter(dir);
    const scan = () => spawnSync(process.execPath, [copy, dir], { encoding: 'utf8' });
    for (const sub of ['examples', 'node_modules', join('test', 'node_modules')]) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, 'x.js'), '// zorblax\n');
    }
    assert.equal(scan().status, 0, 'root examples/ and node_modules at any depth are skipped: ' + scan().stdout);
    mkdirSync(join(dir, 'test', 'examples'), { recursive: true });
    writeFileSync(join(dir, 'test', 'examples', 'y.js'), '// zorblax\n');
    const r = scan();
    assert.equal(r.status, 1, 'a nested examples/ folder is scanned');
    assert.match(r.stdout, /test\/examples\/y\.js:1/);
    assert.doesNotMatch(r.stdout, /x\.js/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an examples/ folder inside a scanned path is not exempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const list = join(dir, 'words.txt');
    writeFileSync(list, WORDS);
    mkdirSync(join(dir, 'src', 'examples'), { recursive: true });
    writeFileSync(join(dir, 'src', 'examples', 'x.js'), '// zorblax\n');
    assert.equal(run('--words', list, join(dir, 'src')).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// macOS 的暫存目錄 /var 是 /private/var 的連結：從連結路徑掃描時，最上層的 examples/ 照樣豁免（比的是實際路徑）
test('a symlinked path to the starter still exempts its top-level examples/', () => {
  const base = mkdtempSync(join(tmpdir(), 'neutral-'));
  try {
    const dir = join(base, 'real');
    fakeStarter(dir);
    mkdirSync(join(dir, 'examples'));
    writeFileSync(join(dir, 'examples', 'x.js'), '// zorblax\n');
    writeFileSync(join(dir, 'tools', 'ok.js'), 'export const a = 1;\n');
    const link = join(base, 'link');
    symlinkSync(dir, link, 'dir');
    for (const scanner of [join(dir, 'tools', 'neutral.mjs'), join(link, 'tools', 'neutral.mjs')]) {
      const r = spawnSync(process.execPath, [scanner, link], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${scanner} scanning ${link}: ${r.stdout}`);
    }
    writeFileSync(join(dir, 'tools', 'bad.js'), '// zorblax\n');
    const r = spawnSync(process.execPath, [join(dir, 'tools', 'neutral.mjs'), link], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'files outside examples/ are still scanned through the link');
    assert.match(r.stdout, /bad\.js:1/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
