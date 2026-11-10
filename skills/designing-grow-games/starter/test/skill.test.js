// skill 文件的檢查清單：只在 starter 還放在 skill 資料夾裡（上一層叫 designing-grow-games）時跑。
// starter 被複製到新專案（例如 <新專案>/rules-lab）之後，上一層沒有 SKILL.md，這一整檔自動略過。
// 檢查：SKILL.md 的 frontmatter（name、description 只寫觸發情境、≤ 500 字元、不摘要流程）、本體 ≤ 300 行、
// 連到的 reference／templates 檔都存在、choices.md 每組都寫了「不用這個元件的代價」、所有 md 不含本機絕對路徑、
// md 裡提到的 npm run 指令都在 package.json 裡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IN_SKILL } from './helpers/examples.js';

const STARTER = fileURLToPath(new URL('..', import.meta.url));
const SKILL_DIR = dirname(STARTER.replace(/\/$/, ''));
const SKILL_MD = join(SKILL_DIR, 'SKILL.md');
const REPO_README = join(SKILL_DIR, '..', '..', 'README.md');
const skip = IN_SKILL ? false : 'starter 已複製出 skill 資料夾，略過 skill 文件檢查';

const read = path => readFileSync(path, 'utf8');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

function* mdFiles(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* mdFiles(full);
    else if (name.endsWith('.md')) yield full;
  }
}

const REQUIRED_LINKS = [
  'reference/invariants.md', 'reference/choices.md', 'reference/process.md', 'reference/presentation.md',
  'reference/history.md', 'templates/outline.md', 'templates/rules-design.md',
];

test('skill: SKILL.md exists next to starter/', { skip }, () => {
  assert.ok(existsSync(SKILL_MD), SKILL_MD);
});

test('skill: frontmatter has name and a trigger-only description (≤ 500 chars, "Use when", no workflow words)', { skip }, () => {
  const fm = frontmatter(read(SKILL_MD));
  assert.ok(fm, 'SKILL.md starts with a --- frontmatter block');
  assert.equal(fm.name, 'designing-grow-games');
  assert.ok(fm.description, 'description present');
  assert.ok(fm.description.length <= 500, `description is ${fm.description.length} chars`);
  assert.match(fm.description, /^Use when /);
  // writing-skills 的規則：description 只寫觸發情境，不摘要流程（摘要了，代理會照 description 做而不讀本體）
  assert.doesNotMatch(fm.description, /\bsteps?\b|步驟|first\b|then\b/i, 'description must not summarize the workflow');
});

test('skill: SKILL.md is at most 300 lines', { skip }, () => {
  const lines = read(SKILL_MD).replace(/\n$/, '').split('\n').length;
  assert.ok(lines <= 300, `${lines} lines`);
});

test('skill: every reference/templates file SKILL.md links to exists, and all seven are linked', { skip }, () => {
  const text = read(SKILL_MD);
  const linked = [...new Set(text.match(/(?:reference|templates)\/[\w.-]+\.md/g) ?? [])];
  for (const rel of linked) assert.ok(existsSync(join(SKILL_DIR, rel)), `${rel} linked but missing`);
  for (const rel of REQUIRED_LINKS) assert.ok(linked.includes(rel), `${rel} not linked from SKILL.md`);
});

// GitHub 式標題錨點：小寫、去掉標點（保留字母、數字、空白、-、_）、空白換成 -
const slug = heading => heading.replace(/`/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchorsOf = file => new Set(read(file).split('\n').filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, ''))));

test('skill: every relative link (and #anchor) in SKILL.md, reference/ and templates/ resolves', { skip }, () => {
  const files = [SKILL_MD, ...['reference', 'templates'].flatMap(d => [...mdFiles(join(SKILL_DIR, d))])];
  let links = 0;
  for (const f of files) {
    for (const [, target] of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      links++;
      const [path, anchor] = target.split('#');
      const dest = path ? join(dirname(f), path) : f;
      assert.ok(existsSync(dest), `${relative(SKILL_DIR, f)}: ${target} → missing file`);
      if (anchor) assert.ok(anchorsOf(dest).has(decodeURIComponent(anchor)), `${relative(SKILL_DIR, f)}: ${target} → no such heading`);
    }
  }
  assert.ok(links >= 10, `${links} links`);
});

test('skill: every component group in choices.md states the cost of not using it', { skip }, () => {
  const text = read(join(SKILL_DIR, 'reference/choices.md'));
  const groups = text.split(/^## /m).slice(1);
  assert.ok(groups.length >= 12, `${groups.length} groups`);
  for (const g of groups) {
    const title = g.split('\n')[0];
    assert.ok(g.includes('不用這個元件的代價'), `group「${title}」lacks 不用這個元件的代價`);
  }
});

test('skill: no markdown file contains a local absolute path', { skip }, () => {
  const files = [...mdFiles(SKILL_DIR), ...(existsSync(REPO_README) ? [REPO_README] : [])];
  assert.ok(files.length >= 8, `${files.length} md files`);
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      assert.doesNotMatch(line, /\/home\/|\/Users\/|\/mnt\/[a-z]\/|[A-Z]:\\/, `${relative(SKILL_DIR, f)}:${i + 1}`);
    });
  }
});

test('skill: every `npm run <script>` mentioned in the docs exists in package.json', { skip }, () => {
  const scripts = JSON.parse(read(join(STARTER, 'package.json'))).scripts;
  const files = [...mdFiles(SKILL_DIR), ...(existsSync(REPO_README) ? [REPO_README] : [])];
  let seen = 0;
  for (const f of files) {
    for (const m of read(f).matchAll(/npm run ([\w:-]+)/g)) {
      seen++;
      assert.ok(scripts[m[1]], `${relative(SKILL_DIR, f)}: npm run ${m[1]} is not a script`);
    }
  }
  assert.ok(seen > 0, 'the docs mention npm run commands');
});
