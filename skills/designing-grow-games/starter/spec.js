// 目前這個專案的規則表。npm run check／stats／tighten／solutions 都讀這支。
// 預設指向奇幻龍谷範例，讓 starter 複製下來就能直接跑。開新遊戲時：把 spec.template.js 複製成 examples/<名稱>/spec.js、照註解填，
// 再把下面這行改成轉出它（規則表放 examples/ 底下，npm test 會自動測它；寫了 expected.js 之後連驗收與釘值一起測）。
export * from './examples/dragon-valley/spec.js';
