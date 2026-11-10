// 空白規則表：每個欄位的意義、型別、例子，以及範例怎麼用。複製成 examples/<名稱>/spec.js、讓根目錄的 spec.js 轉出它，然後照著填。
// 範例：examples/dragon-valley/spec.js（6 個物品的奇幻山谷，每個元件各示範一次），下面寫成「龍谷」。
// 「原作」指這個 skill 萃取自的那款 8 個物品的 GROW 式遊戲；只引用它的尺度與做法，不引用它的內容。
// 填完先跑 npm test（validateSpec 會指出打錯的物品名與超出範圍的級數），再跑 npm run check。
//
// 流程提醒：先定物品與級數分層（第 k 個放的，不跳級最多到「總回合數 − k + 2」級），寫出正解的逐回合表，
// 再從正解回推每一級的條件——正解上那一回合場上有什麼，就要求什麼；最後用求解器全枚舉，驗「剛好一條全 MAX」。

// ── 條件語言（ITEMS 的 up／jump／delay、反應的 when、FINALE／ENDINGS 的 when 都用它）──
// { always: true }          永遠成立（「自己長」）
// { present: id }           id 已經放了            { absent: id }      id 還沒放
// { minLevel: [id, n] }     id 的級數 ≥ n          { maxLevel: [id, n] } id 的級數 ≤ n（還沒放的 0 也算成立）
// { ltPlus: [a, b, k] }     a 的級數 < b 的級數 + k
// { age: [id, n] }          id 放下至少 n 回合     { locked: id }      id 被鎖住了
// { flag: name }            旗標立了               { flag: name, is: v } 旗標的值是 v（分岔用）
// { allMax: true }          所有物品都 MAX（真結局用）
// { finale: id }            收尾考驗的結果是 id（ENDINGS 用；FINALE 自己不能用）
// { and: [...] } { or: [...] } { not: c }
// 例：龍谷的法師 up[3] = { minLevel: ['farm', 5] }（磨坊有餘糧，養得起一座塔）。
const auto = { always: true };
const and = (...c) => ({ and: c });
const or = (...c) => ({ or: c });
const age = (id, n) => ({ age: [id, n] });
const min = (id, n) => ({ minLevel: [id, n] });
const max = (id, n) => ({ maxLevel: [id, n] });
const present = id => ({ present: id });

// TITLE：字串。劇透表（tools/solutions.mjs）的標題。
// 龍谷：'奇幻龍谷 DRAGON VALLEY'。
export const TITLE = '';

// ORDER：物品 id 的陣列，非空。既是物品清單，也是引擎每回合掃描升級的順序——這是隱藏的設計參數：
// 引擎照 ORDER 反覆掃到不動為止。up 裡的 minLevel／present 跟順序無關（每一輪都重看）。跟順序有關的有兩種：
// 在發生那一刻只判定一次的事（跳級的決定、fx／onLevel 的 when、branch.when、正向 delta），
// 和會在同一回合由真變假的條件（maxLevel、not、ltPlus、flag…is）——排在前面的先看到別人升級前的級數。
// 例：龍谷的法師排在騎士前面，騎士 Lv5 的分岔才看得到法師同回合剛升的 6；兩個對調，真結局 0 條。
// 換順序可能改變解；刻意利用時在檔頭寫明理由（見 reference/process.md 的「掃描順序 ORDER」）。
// 龍谷：['farm', 'temple', 'mage', 'knight', 'goblin', 'dragon']。掃描順序可以跟正解順序不同。
export const ORDER = [];

// CLOSING_TURNS：≥ 0 的整數。全部放完後再長幾回合才進收尾考驗。總回合數 = 物品數 + CLOSING_TURNS。
// 龍谷：1（6 + 1 = 7 回合）。原作：1（8 + 1 = 9 回合；試過全部放完後自動長 3 回合，因為那幾級不是玩家的選擇造成的而拿掉）。
export const CLOSING_TURNS = 1;

// ITEMS：{ id: 物品 }。每個物品的欄位：
//   name      字串，求解器與劇透表顯示用。
//   max       ≥ 1 的整數，最高級。級數分層本身就是線索：級數少的晚放。龍谷 9／7／6／5／3／3。
//   up        { 2..max: 條件 }，每一級都要有：從 n−1 升到 n 的條件。放下那一刻是 Lv1；剛放下的當回合也參加，最多到 Lv2。
//             例：龍谷的農田 up[3] = present('temple')（神殿的祭司來祈福）。
//   jump      { 3..max: 條件 }，可省略。在 n−2 時成立就一回合 +2。沒有預設跳級：只寫正解需要的幾條。
//             跳級不看 up[n−1]——跨過的那一級要擋的東西，也要寫進跳級的條件（跳級是捷徑）。
//             例：龍谷的神殿 jump[5] = and(present('knight'), min('farm', 5), min('mage', 2))，最後一支是跨過的 up[4]。原作 8 個物品約十條跳級。
//   delay     { 2..max: 條件 }，可省略。成立時，第 n 級要在上一級多停一回合。範例沒用到。
//   fx        反應陣列，可省略：放下這個物品時檢查。
//   onLevel   { 2..max: 反應陣列 }，可省略：升到第 n 級時（跳級跨過的那一級也算）。
//   stall     反應陣列，可省略：成立時這回合不升級（記一個 stall 事件）。
//   hazard    { while: 條件 }，可省略：災害物品。while 成立期間（看回合開始的級數）才放下的物品 X，當場套用自己 fx 裡 lock === X 的那幾條。
//             例：龍谷的巨龍 hazard.while = and(min('dragon', 1), max('dragon', 2))：還在谷裡（Lv1–2）時才放的農田、神殿當場遭殃。
//             龍谷的巨龍 3 級：放下那回合一次檢查農田與神殿，Lv1–2 還在谷裡、Lv3 回巢。
//   grip      { while: 條件, targets: [id…], story?: { id: 句子 } }，可省略：搗蛋物品。while 成立期間才放下的 targets 被抓住
//             （旗標 gripped_<id> = 這個物品），抓它的那個 while 不再成立之前長不上去。
//             例：龍谷的哥布林 Lv1–2 占住之後才放的農田／神殿，騎士團收編（Lv3）才放開。另一種寫法：搗蛋物品放下時的 fx 帶 grip: true，當場抓住已經在場、還不夠高的目標。
//   meta      任意物件，可省略：給演出層的資料（模型名、外觀、閒置動畫……）。引擎、求解器、結構檢查都不讀它。
//             其他欄位名結構檢查會報「未知欄位」（引擎會默默忽略打錯的欄位，所以一律擋下）；早期版本的舊名 rain／bite 與常見打錯 jumps 會提示改成 hazard／grip／jump。
//
// 反應（fx／onLevel／stall／AFTER_TURN 的每一條）：{ when?, delta?: { target, by }, grip?: true, lock?: id, flag?: { name, value? }, branch?, story? }
//   when      條件；省略 = 永遠成立。
//   delta     改別人的級數（by 可正可負；一回合連 delta 最多比回合開始高 2 級；被負向 delta 打到的當回合不升級）。
//   grip      true：同時抓住 delta 的目標（要搭配 delta，而且只能寫在有 grip 區塊的物品的 fx／onLevel：放開靠那個物品的 grip.while；
//             寫在 AFTER_TURN 或沒有 grip 區塊的物品上沒有作用，結構檢查會報）。
//   lock      鎖住這個物品，永遠不再長。鎖住時立的旗標通常就是壞結局。
//   flag      立旗標（value 省略 = true）。
//   branch    { flag, when, then, else }：分岔旗標，when 成立立 then，否則立 else。
//             例：龍谷的騎士 onLevel[5] 看法師 ≥6 → knightPath 'paladin'，否則 'dark'。分岔常放在某個物品的最終級。
//   story     一句話（除錯、劇透表用；引擎不印）。
//   反應只認得 when、delta、grip、lock、flag、branch、story；其他欄位結構檢查會報「未知欄位」。
// 每一條條件、每一條反應上面都寫一行故事註解：誰來了、誰夠高了。說不出故事的條件就是該拿掉的條件。
export const ITEMS = {};

// AFTER_TURN：反應陣列，可省略。每回合結束時檢查（過期、荒廢這類「放太久」的旗標）。
// 龍谷：農田開墾 4 回合還 ≤4 → famine。
export const AFTER_TURN = [];

// STORIES：可省略。{ placed: { id: 放下時的句子 }, grow: { id: { 級數: 升級時的句子 } } }。畫面上不印（GROW 式不用文字），
// 給除錯、劇透表、演出設計用。龍谷每個物品每一級都有一句。
export const STORIES = { placed: {}, grow: {} };

// FINALE：可省略（沒有收尾考驗的遊戲）。有序 [{ id, when }]：全部放完、收尾回合結束後的考驗，第一個成立的 id 就是結果，都不成立 → null。
// ENDINGS 用 { finale: id } 讀它；演出層也拿它決定收尾畫面。
// 龍谷：魔王來襲——repelled（神殿 MAX）／dragon（巨龍還在 Lv1–2）／hit（always）。
export const FINALE = [];

// ENDINGS：有序 [{ id, title, kind, when, line? }]，恰好一個 kind 'true'、恰好一個 kind 'neutral'（不寫 when——寫了也不看，結構檢查會報——排最後）。
//   判定：成立的 true 優先；否則第一個成立的 bad 當標題（其餘成立的列為附註）；都不成立 → neutral。
//   true 的 when 通常是 and({ allMax: true }, …附加條件)；bad 的 when 通常是一個旗標，或 { not: { finale: … } }。
//   排序：具體的災難排前面（玩家看得到的那件事當標題），「考驗沒擋下」這種總結排最後。
//   line：一句話描述結局畫面（給演出設計；可省略）。
// 龍谷：radiant（true：全 MAX 且聖騎士）、scorched、templeFell、famine、darkKnight、overrun（not finale repelled）、tryAgain（neutral）。
// neutral 可能只有極少數順序走得到，照樣要留著當安全網。
export const ENDINGS = [];

// ACCEPTANCE：npm run check 的驗收門檻（求解器全枚舉之後檢查）。欄位：
//   trueEndings        走到真結局的順序要剛好幾條（預設 1）。
//   everyBadReachable  每個壞結局至少一條順序成立（看 satisfied，被前面結局遮住的也算；預設 true）。
//   maxAvgMax          隨機順序的平均 MAX 數上限（有給才查）。先跑一次看實測值，訂在略高一點。龍谷 1.1（實測 1.05）。
//   minMaxTurns        正解至少幾個不同回合出現 MAX（有給才查；節奏）。龍谷是 2。
//   greedyMustFail     每步選「總級數最高」的貪婪玩家不能走到真結局（預設 true）。
//   custom             [{ id, test(results, spec) → 失敗訊息|null }]：主題自己的檢查。例：「擋下考驗的物品沒 MAX 的局要佔一定比例」。
// 只報告、不擋（npm run stats 會印）：單一順序結局、死規則（從沒成立的條件、從沒發過的反應、從沒立過的旗標）、結局集中度、位置可行性表。
export const ACCEPTANCE = { trueEndings: 1, everyBadReachable: true, greedyMustFail: true };
