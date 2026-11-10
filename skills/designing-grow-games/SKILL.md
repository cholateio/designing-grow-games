---
name: designing-grow-games
description: Use when designing or building a GROW-style (Eyezmaze GROW Island / Cube / Valley) placement-order puzzle game — a fixed set of items placed one per turn, each growing through levels, where the placement order decides how they interact and which ending plays — in any theme or setting, or when the user hands over an outline of a scenario, growable items and wanted endings and asks for a game like GROW.
---

# 設計 GROW 式遊戲（規則層）

**GROW 式**：一組固定物品，玩家一回合放一個；每回合所有已放下的東西照規則各自長一步、互相帶動；放的順序是唯一的輸入，只有一條順序能讓全部 MAX。

這個 skill 只管**遊戲邏輯**：規則設計 → 規則資料 → 全枚舉驗證 → 劇透表 → 交給演出層。畫面風格、顏色、UI、引擎選擇不在範圍內，由新專案自己決定。
所有數字（8 個物品、約 60 級、平均 MAX ≤ 3.5……）都是原作（作者先前做的一款 GROW 式遊戲）的**起點**，不是規定；每個都寫了怎麼重新決定。

## 十條不變量（換掉任何一條就不是 GROW）

細節與來源：[reference/invariants.md](reference/invariants.md)。

1. 一組固定物品，每個放一次；放的順序是唯一的輸入（沒有悔棋、沒有亂數，N 個物品 = N! 局）。
2. 每回合放一個，然後所有已放下的東西各自長一步、互相帶動；升級的常常不是剛放的那個。
3. 等級是唯一的回饋；全部 MAX 才是真結局。
4. 只有一條路能全滿；其他順序要看得出「長不全」。
5. 線索只來自看得到的狀態（級數多寡、誰停住、誰一口氣長兩級、壞結局的畫面），不用文字或提示。
6. 因果看得見、失敗讀得懂：壞掉的東西拖垮依賴它的東西。
7. 無字：畫面上只有 LEVEL UP（有降級才有 LEVEL DOWN）和 UI 上的等級。
8. 一回合一條主線、一個主角，結果長在主角停下的地方。
9. 全部放完後有一段收尾（考驗可以在收尾時來，也可以本身就是順序裡的一個物品）；每個結局有自己的畫面。
10. 規則是純資料，每次改都全枚舉驗證「剛好一條走到真結局」。

## 流程（複製成待辦，照順序做）

```
- [ ] 1. 收大綱
- [ ] 2. 定尺度、填可行性表
- [ ] 3. 挑結構元件
- [ ] 4. 寫正解逐回合表，再從正解回推規則資料
- [ ] 5. 全枚舉驗證（npm run check）
- [ ] 6. 不是剛好一解 → 照階梯救回
- [ ] 7. 釘代表順序、產劇透表、把分佈寫回規則表
- [ ] 8. 交給演出層
- [ ] 9. 把「一定要問」的裁決拿去問使用者（第 1 步問一次，第 5 步有數字後再確認一次）
```

**1. 收大綱。** 用 [templates/outline.md](templates/outline.md) 一次問齊：情境與語氣（含禁區）、物品清單與每樣的故事弧（從什麼長成什麼）、真結局、壞結局與各自的畫面、玩家族群與難度。缺的一次問完。標 ★ 的題目一定要使用者本人回答。

**2. 定尺度。** 物品數 N、收尾回合 `CLOSING_TURNS`（預設 1）、總回合數 T = N + CLOSING_TURNS、每樣的 MAX。
- 可行性算式：**第 k 個放的，不跳級最多到 T − k + 2 級**（放下當回合可到 Lv2，之後每回合 +1）；每用一次跳級 +1；放下當回合不長的（`up[2]` 要 `age ≥ 1`）−1。
- 先把正解上每樣都到得了 MAX 的表填進 [templates/rules-design.md](templates/rules-design.md) 的可行性表，**再**寫任何條件。
- 級數分層本身是線索：級數少的晚放。
- **MAX 頂著位置上限，全 MAX 的順序就趨近一條。** 每樣的 MAX 都等於它在正解位置的上限時，換到更後面就長不滿，能全滿的排法只剩極少數；MAX 低於上限（有餘裕）的物品可以跟別人換位置，全 MAX 的順序就多（壓力測試：MAX 留餘裕 16 條，頂上限後 2 條）。這是一個選擇，不是規定：頂上限之後，唯一性主要由分層決定，條件的工作變成控制難度與失敗的可讀性（見 [process.md 第 4 節](reference/process.md#4-唯一性從哪裡來)）；想讓條件多扛一點唯一性，就留餘裕、再用條件擋。
- N 決定全枚舉的成本（N! 種順序）：`npm run check` 8 個約 1 秒；從 N 個加到 N+1 個，順序數乘以 N+1（9 個約 10 秒，視機器）；10 個以上不實際。

**3. 挑結構元件。** 從 [reference/choices.md](reference/choices.md) 的選單挑：災害（放下那回合一次檢查＋期間持續有效）、搗蛋（抓住直到離開窗口）、連鎖樞紐、分岔旗標、過期旗標、時間窗口條件、收尾考驗。每組開頭寫了「不用這個元件的代價」，拿去跟大綱對照；每組最後列了原作試過又拿掉的做法。選擇記進 rules-design.md 的元件表。
- 收尾考驗（`FINALE`）可以不用：大綱裡的「考驗」本身就是玩家放下的物品時（例如一場流星雨、一隻怪獸），把它做成災害物品放進順序，不寫 `FINALE`；結局全靠 `ENDINGS` 判定，收尾畫面照 `resolve().id` 挑。

**4. 寫規則資料。**
- 先寫**正解逐回合表**（每回合放什麼、每樣到幾級、誰帶動誰），再從它回推：正解那一回合場上有什麼，就要求什麼。
- 每條條件都要說得出故事（誰來了、誰夠高了），寫成條件上面的一行註解。說不出故事的條件就拿掉。
- 跳級只留正解需要的；跳級不看 `up[n−1]`，所以**跨過的那一級的阻擋要同時寫進跳級**。
- 正 delta 會讓物品繞過升級條件，盡量不用；降級要不要有，是使用者的裁決。
- 欄位的意義、型別、例子都在 starter 的 `spec.template.js`；完整範例看 `examples/dragon-valley/spec.js`（6 個物品，每個元件各一次）。

**5. 全枚舉驗證。** `npm test && npm run check`。
- 驗收（`ACCEPTANCE`，寫在規則表裡）：走到真結局的順序剛好 1 條、每個壞結局至少一條順序成立、貪婪策略走不到真結局、隨機平均 MAX 上限、正解有 MAX 的回合數下限、沒有引擎錯誤，另可加 `custom`。
- 報告（不擋，但每一條都要看）：只有一條順序走得到的非真結局、死規則（從未成立的條件、從未發出的反應、從未立過的旗標）、結局集中度、位置可行性表。
- **結局分佈裡沒出現的壞結局**（劇透表寫「0 種」）：驗收只看它「成立過」，但它永遠被前面的結局蓋掉、當不了標題。跟死規則一樣處理：調門檻、調 `ENDINGS` 的順序，或拿掉。
- 數字出來之後，難度與集中度拿去問使用者（見下面「一定要停下來問使用者」），不要自己訂。
- 輸出怎麼讀：[reference/process.md](reference/process.md)。

**6. 驗收沒過時照階梯救回。** 先調有故事的門檻（數字和故事一起改）→ 再加減條件 → 最後才動級數。不要加回合來湊。
- 這個順序是給**後期微調**的：正解逐回合表、故事、演出都定了，動級數會牽動整張表。**設計初期**（表剛寫好、全 MAX 有很多條，而且位置可行性報告顯示好幾樣的 MAX 比上限低）多解多半來自 MAX 的餘裕，這時直接回第 2 步把 MAX 調到上限是合理的第一步，比一條條加條件省事。
- `npm run tighten` 適合**最後 1–2 條**的收尾（結構已對、只差一兩條多解），不適合新表前期的結構問題。它只印建議，而且建議常常說不出故事——說不出就不要用。
- **貪婪走得到真結局**（`greedy`）＝謎題太直線：每一步「總級數長最多」的選擇剛好就是正解。讓正解上有一步**看起來虧**，兩種做法可以一起用：
  - 放下當回合不長的物品（`up[2]` 要 `age ≥ 1`，災害物品最自然）排在一個別的選擇當下長得更多的位置。dragon-valley 的巨龍就是這樣；可行性表要跟著重算。
  - 在關鍵那一步讓**錯的選擇看起來更賺**：有故事地放寬另一個物品的早期條件，讓它在那一步放下時當下長得比正解多（壓力測試：通訊天線 `up[2]` 從太陽能板 ≥7 放寬到 ≥5，第 5 步放天線 +2 比放流星雨 +1 多，貪婪就被騙走）。改完確認仍然一解。
- 物品少時，級數分層加一兩條跳級本身就可能擋出唯一解；這時條件的工作是壓平均 MAX、讓失敗連鎖得看得懂（dragon-valley：條件全拿掉仍然一解，但平均 MAX 1.05 → 3.33）。「已經一解」不代表條件可以省。

**7. 釘住結果。**
- `npm run check` 通過後，在規則表旁寫 `expected.js`（`TOTAL`、`SOLUTION`（`ACCEPTANCE.trueEndings` 不是 1 時改寫 `SOLUTIONS` 陣列）、`DISTRIBUTION`、每個出現過的結局一條 `REPRESENTATIVE`、`REPORTS`，可選 `NOTABLE`），格式照 `examples/dragon-valley/expected.js`；數字抄 `npm run check`，代表順序抄劇透表（每條附 id 陣列）。`npm test` 會重算，規則一改就逼你重釘。
- `npm run solutions` 產劇透表 `docs/solutions.md`（正解逐回合、每個升級因為誰、各結局代表順序）。
- 把分佈數字與調參紀錄寫回規則表的檔頭註解；裁決記進 rules-design.md 的帳本。
- **小專案**（物品少、一兩輪就定案）可以不填 rules-design.md，把尺度、可行性、元件選擇、調參紀錄寫在規則表檔頭（dragon-valley 就是這樣）。但這幾樣仍值得留在檔頭以外：**正解逐回合表**（劇透表就是）、**裁決帳本**（日期、使用者怎麼說、數字）、**待使用者確認**的問題與假設。

**8. 交給演出層。** 照 [reference/presentation.md](reference/presentation.md) 第 0 節寫一份「演出層要知道的事」：事件種類與欄位、哪些旗標是鎖（`lockFlags`）、`{ lv, flags }` 純函數原則、收尾畫面照 `finale` 挑（沒有 `FINALE` 就照結局 `id` 挑）、代表順序、節奏上限起點。然後回到一般開發流程（brainstorming → 設計 → 計畫）做演出層。

## 一定要停下來問使用者

這些在原作裡全是作者本人的裁決。skill 不替新專案決定；問了就記進裁決帳本（日期、使用者怎麼說、數字）。

- **難度目標**：隨機亂放的人平均看到幾個 MAX（`maxAvgMax`）；最大宗壞結局最多佔幾 %。拿 `npm run check` 的實測數字去問。
- **語氣禁區**：政治、真人、宗教、噁心、暴力程度。避免可能被讀成影射真實衝突的元素——原作就是做完才發現、整個換掉過。
- **要不要有降級**（LEVEL DOWN）。
- **壞結局數量**，以及每個的畫面。使用者說的「N 個壞結局」不含 neutral（「再試一次」「還在建設中」那種都不成立時的安全網）；neutral 一定要有，另外算。
- **只有一條順序走得到的非真結局**要不要留（報告列出來就問）。
- **使用者說某個機制「可以參考」時**，問清楚套用範圍，不要推廣到每一級。
- **想加回合、加文字、加提示時**——這些碰到不變量或被拒絕過，先說明代價再問。

**使用者不在場時**（例如在背景跑、或只交了大綱）：不要卡住，也不要默默替他決定。把每個問題寫下來，附上先採用的假設與理由（「假設平均 MAX ≤ 1.2，因為……」），照假設往前做；全部收進 rules-design.md 的「待使用者確認」一節（小專案就收在規則表檔頭），交付時列在最前面請他確認。假設被推翻時，照第 6 步重調。

## 程式起點（starter）

`starter/` 是零依賴的 Node（≥ 18）ES module 專案：條件語言、引擎、資料化結局、結構檢查、全枚舉求解器、收緊器、劇透表、一個完整範例（`examples/dragon-valley`）。

開新遊戲（`<skill>` 是這個 skill 所在的資料夾；`garden` 換成你的遊戲名）：

```bash
cp -r <skill>/starter <新專案>/rules-lab
cd <新專案>/rules-lab
mkdir examples/garden
cp spec.template.js examples/garden/spec.js
echo "export * from './examples/garden/spec.js';" > spec.js
# 照 examples/garden/spec.js 裡的註解填 TITLE、ORDER、ITEMS、FINALE、ENDINGS、ACCEPTANCE
npm test && npm run check && npm run solutions
```

- 遊戲的規則表放 `examples/<名稱>/`：主題中立檢查（`npm test` 的第一步）不掃 `examples/`，`npm test` 也會自動測到它。
- 主題中立檢查的禁字清單是 starter 根目錄的 `neutral-words.txt`（一行一個詞，`#` 開頭是註解；沒有這個檔＝空清單）。把你的遊戲的物品名寫進去，`npm test` 就會擋下 starter 本身的程式、測試、空白規則表裡出現這些詞（主題名詞只該在 `examples/` 裡）。
- 根目錄的 `spec.js` 是 `npm run check／stats／tighten／solutions` 讀的那份，一行轉出你的規則表就好。
- 剛複製的空白表跑 `npm run check` 會先被結構檢查擋下（ORDER 空、ENDINGS 缺 true／neutral），這是正常的：填完就過。
- 設計中途（還沒寫 `expected.js`）`npm test` 只對你的規則表做結構檢查，驗收看 `npm run check`；寫了 `expected.js` 之後，驗收與釘值也進 `npm test`。
- 複製出來的 starter 跑 `npm test` 會有 **skipped**，這是正常的：skill 文件檢查（`test/skill.test.js` 的 8 項；上一層沒有 SKILL.md 就略過）；每個還沒寫 `expected.js` 的範例另略過 4 項（全枚舉結果、驗收、報告、代表順序）。skipped 比這多才要查。
- `examples/dragon-valley` 保留著當參考，不要刪：測試用它。
- 試作表（丟棄式）可以放任何路徑，用 `node solver/run.js <路徑> --check` 單獨跑。

## 參考檔索引

| 檔案 | 什麼時候讀 |
|---|---|
| [reference/invariants.md](reference/invariants.md) | 開工前；使用者的點子可能碰到不變量時 |
| [reference/choices.md](reference/choices.md) | 第 2–4 步：照元件分組的選單，每條「決定／為什麼／可調性」，含原作試過又拿掉的做法 |
| [reference/process.md](reference/process.md) | 第 4–7 步：工具輸出怎麼讀、唯一性從哪裡來、救回階梯、引擎踩過的坑、裁決帳本 |
| [reference/presentation.md](reference/presentation.md) | 第 8 步：交接清單、回合怎麼播、節奏上限起點、允許的文字 |
| [reference/history.md](reference/history.md) | 開工前看一遍：原作走過又退回來的路 |
| [templates/outline.md](templates/outline.md) | 第 1 步：給使用者的大綱問卷 |
| [templates/rules-design.md](templates/rules-design.md) | 第 2–7 步：規則設計文件骨架（尺度、可行性、元件、正解表、驗收、分佈、裁決帳本） |

## 最常犯的三個錯

1. **把「每一級都要有觸發者」當成規則。** 原作曾把「GROW 的不升級可以參考」套到每一級，整批重做（[choices.md](reference/choices.md) 的 B-X3）：自己長的級數（`{ always: true }`）完全可以有。反過來，「大多自己長」也不是規則——原作最後的表大約八成的升級帶條件，dragon-valley 27 個裡 24 個。條件從正解逐回合表回推，每條要說得出故事；寫幾條是難度與可讀性的選擇（隨機平均 MAX、壞結局讀不讀得懂），拿 `npm run check` 的數字跟使用者講好。
2. **預設跳級。** 「每一級都可以跳」讓最後幾回合一回合長 9–11 級、錯的順序也有七個 MAX、錯在哪看不出來。跳級只留正解需要的幾條，每條有故事，跨過的阻擋寫進去。
3. **用文字或提示補可讀性。** 提示泡泡、說明字、起因光、撲空、拜訪、結局卡，原作全部試過又拿掉。失敗要靠場景本身讀出來：災害鎖住、連鎖停住、搗蛋角色守門口、每個結局自己的收尾。規則層的對應是災害、樞紐、搗蛋與分得開的結局——規則讀不出來時改規則，不加字。
