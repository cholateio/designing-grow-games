# designing-grow-games

A [Claude Code](https://docs.claude.com/en/docs/claude-code) skill for designing GROW-style placement-order puzzle games (in the spirit of Eyezmaze's GROW Island / Cube / Valley) in any theme. You give it a scenario, a handful of growable items and the endings you want; it walks you through scale and feasibility, picking structural components (hazards, troublemakers, hubs, branches, expiry, a finale), writing the rules as pure data, and exhaustively checking all N! placement orders so that exactly one order reaches the true ending. It ships a zero-dependency Node starter (condition language, engine, data-driven endings, spec validator, exhaustive solver, tightener, spoiler-table generator) and a complete worked example. Every number and mechanism in it is presented as a *choice with reasons and knobs*, not a rule. The docs are in Traditional Chinese.

<img width="3837" height="2160" alt="image" src="https://github.com/user-attachments/assets/11f31766-9670-4a99-a558-4714a4bbb6ad" />

做 GROW 式（Eyezmaze GROW Island／Cube／Valley）放置順序解謎遊戲的 Claude Code skill：`designing-grow-games`。

**GROW 式**：一組固定物品，玩家一回合放一個；每回合所有已放下的東西照規則各自長一步、互相帶動；放的順序是唯一的輸入，只有一條順序能讓全部 MAX，其他順序走到各自的壞結局。

這個 skill 萃取自作者先前做的一款 GROW 式遊戲（8 個物品、40,320 種順序、唯一正解、多個壞結局）的開發經驗，專注在**遊戲邏輯**：交代情境、物品、想要的結局之後，照流程做出一份通過全枚舉驗收的規則層。畫面風格、顏色、UI、引擎不在範圍內，由你的專案自己決定。

文件裡的每個數字與機制都寫成「**選擇**」：當初怎麼決定、為什麼、新專案什麼時候該改、怎麼改——不是規定。

## 安裝

```bash
git clone <這個 repo 的網址> designing-grow-games
cd designing-grow-games
./install.sh
```

`install.sh` 建立符號連結 `~/.claude/skills/designing-grow-games` → `skills/designing-grow-games`，可以重複執行（已存在的連結會被換成指向這裡）。

## 使用

在 Claude Code 裡說「我想做一款像 GROW 那樣的遊戲」，或交出一份大綱（情境、會長大的物品、想要的結局），skill 就會被用上。它會：

1. 用問卷（`templates/outline.md`）一次問齊情境、語氣禁區、物品與故事弧、結局、難度；
2. 定尺度、填可行性表，從選單挑結構元件；
3. 寫正解逐回合表，再從正解回推每一級的條件，寫成純資料的規則表；
4. 用 starter 全枚舉驗證「剛好一條順序走到真結局」，沒過就照救回階梯調；
5. 釘住代表順序、產劇透表，寫一份交接清單給演出層。

難度、語氣禁區、要不要降級、壞結局數量這類裁決，skill 會停下來問你，不替你決定；你不在場時會寫下假設往前做，交付時列在最前面請你確認。

## 目錄

```
skills/designing-grow-games/
  SKILL.md              進入點：定義、十條不變量、流程、一定要問使用者的事、starter 用法、參考檔索引
  reference/
    invariants.md       十條不變量（換掉就不是 GROW）
    choices.md          照元件分組的選單：每個選擇（決定／為什麼／可調性）與試過又拿掉的做法
    process.md          工具輸出怎麼讀、唯一性從哪裡來、救回唯一解的階梯、引擎踩過的坑、裁決帳本
    presentation.md     演出結構（無視覺實作）：交接清單、回合怎麼播、節奏上限起點、允許的文字
    history.md          原作走過又退回來的路
  templates/
    outline.md          給使用者的大綱問卷
    rules-design.md     規則設計文件骨架
  starter/              可直接複製的規則層程式起點（零依賴，Node ≥ 18）
    rules/              條件語言、引擎、資料化結局、結構檢查
    solver/             全枚舉求解器（驗收與報告）、收緊器
    tools/              劇透表產生器、主題中立檢查
    spec.template.js    註解完整的空白規則表
    spec.js             npm 指令讀的規則表（預設轉出 dragon-valley）
    examples/           範例（spec.js＋expected.js）
    test/               node:test 測試
install.sh
```

## 跑 starter

```bash
cd skills/designing-grow-games/starter
npm test              # 主題中立檢查＋全部測試（引擎、求解器、範例、skill 文件檢查）
npm run check         # 對 spec.js（預設 dragon-valley）全枚舉並驗收
npm run stats         # 只印統計與報告
npm run tighten       # 收緊器：只印建議
npm run solutions     # 劇透表 → docs/solutions.md
```

沒有任何依賴，不用 `npm install`。開新遊戲的步驟寫在 `SKILL.md` 的「程式起點」一節。

- 在這個 repo 裡跑 `npm run solutions` 產生的 `starter/docs/` 被 `.gitignore` 略過；複製到新專案之後，劇透表要不要進版控由新專案決定。
- 在 skill 資料夾裡跑 `npm test` 應該 0 skipped。把 starter 複製到新專案之後會有 skipped，這是正常的：`test/skill.test.js` 的 8 項 skill 文件檢查（上一層沒有 SKILL.md，整檔略過）；每個還沒寫 `expected.js` 的範例另略過 4 項（全枚舉結果、驗收、報告、代表順序）。
- **主題中立檢查**（`npm test` 的第一步）：starter 根目錄放一個 `neutral-words.txt`（一行一個詞，`#` 開頭是註解），裡面的詞就不准出現在 starter 本身的程式、工具、測試與空白規則表裡（`examples/` 不掃）。沒有這個檔＝空清單、直接通過。比對不分大小寫；純英數的詞只比整個字，其他（例如中文）比子字串。也可以用 `node tools/neutral.mjs --words <檔案>` 指定別的清單。

## 範例：dragon-valley（奇幻龍谷）

| 物品 | 順序數 | 結果 |
|---|---|---|
| 6 個（農田、神殿、法師、騎士、哥布林、巨龍） | 720 | 唯一正解、5 個壞結局＋1 個 neutral；災害、搗蛋、分岔、樞紐、過期、收尾考驗各示範一次 |

`starter/examples/dragon-valley/spec.js` 的檔頭有正解逐回合表、全枚舉的結局分佈、報告與調參紀錄（**有劇透**）；`expected.js` 釘住這些數字，`npm test` 每次重算。它示範了：

- 級數分層（第 k 個放的最多到 9 − k 級）怎麼跟可行性表對上；
- 災害物品（巨龍）放下當回合不長，讓貪婪策略走偏；
- 掃描順序 `ORDER` 會改變分岔的結果（法師排在騎士前面；對調之後真結局變 0 條，測試釘著這個實驗）；
- 把巨龍以外的條件全換成「自己長」仍然一解、但平均 MAX 從 1.05 變 3.33——條件的工作不只是擋出唯一解。

## 授權

MIT，見 [LICENSE](LICENSE)。GROW 系列是 Eyezmaze 的作品；這個 skill 與它無關，只是致敬並分析其玩法。
