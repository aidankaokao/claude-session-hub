# Claude Session Hub

把本機所有執行中的 Claude Code session 視覺化成 3D 小島上的角色。零 npm 依賴。

## 執行

- `npm start` → http://127.0.0.1:4317，前景執行（`CLAUDE_HUB_PORT` 改 port，`CLAUDE_HUB_NOTIFY=0` 關 macOS 通知）
- `./start.sh` / `./end.sh`：開啟／關閉，只是 `scripts/hub.sh start|stop` 的包裝
- `npm run hub:start|stop|restart|status|logs`（`scripts/hub.sh`）：背景常駐，pid 與 log 在 `~/.claude/session-hub/`。stop 會認 pid 檔，也會認佔用 port 的本專案 server（例如手動 `npm start` 啟動的）
- `npm run hooks:install` / `hooks:uninstall`：在 `~/.claude/settings.json` 加/移除 hook（會先備份）。新增 hook 事件後要重跑 install；已在跑的 session 不一定會重新載入
- 前端檔案每次請求都從磁碟讀，改 `public/` 只要重新整理頁面；改 `server/` 要 `npm run hub:restart`
- 執行期資料都在 `~/.claude/session-hub/`：`hub.pid`、`hub.log`、`usage.json`、`context/`、`tokens.json`
- `npm run usage:install` / `usage:uninstall`：在使用者的 statusline 腳本 `input=$(cat)` 後插入/移除一段 snippet，把 `rate_limits`（5 小時／週額度）寫到 `~/.claude/session-hub/usage.json`（會先備份，移除後與原檔逐位元相同）

## 架構

後端（`server/`）：

- `sessions.mjs`：讀 `~/.claude/sessions/<pid>.json`（Claude Code 內部、未公開的即時名冊，提供 busy/idle），合併 transcript 與 hook 狀態。busy 判斷：registry busy，或 PreToolUse 後尚未 PostToolUse，或 3 秒寬限；registry 的 idle 若比最後 hook 事件新則以 registry 為準（處理 Esc 中斷）
- `transcript.mjs`：只讀 transcript jsonl 尾端 256KB，取 ai-title、last-prompt、最近 tool_use、context tokens、活躍 subagent 數
- `hooks.mjs`：處理 `hooks/hub-hook.sh` POST 的 hook 事件。waiting 來源：PermissionRequest（即時）、Notification（約 6 秒後才觸發）、AskUserQuestion。已知限制：權限核准後到 PostToolUse 之間沒有事件，長指令會一直顯示 waiting
- `permissions.mjs`：網頁審批。`hooks/hub-permission.sh` 長輪詢 `/permission`，hub 回 allow/deny JSON 或 204（交回終端）。開關預設關；沒開、沒有網頁連線、或最後一個分頁關閉 5 秒後都交回終端；最多等 540 秒（須小於 hook timeout 600 與 curl -m 590）
- `usage.mjs`：讀 `usage.json`，過了 `resets_at` 的時間窗視為已重置
- `context.mjs`：讀 `session-hub/context/<session_id>.json`（statusline 回報的精確 context %）；沒有時 `sessions.mjs` 以 tokens/1M 估計並標 `contextExact:false`
- `conflicts.mjs`：30 分鐘內兩個 session 用 Edit/Write 改同一檔案即為衝突（看不到 Bash 改的檔）
- `inbox.mjs`：傳話。`hooks/hub-inbox.sh` 是 Stop hook（`asyncRewake`，timeout 43200 秒），每輪結束後長輪詢 `/inbox`；回文字 → 腳本 stderr + exit 2 喚醒 session。UserPromptSubmit／SessionEnd 會取消；沒有 listener 時訊息排隊到下一輪結束。逾時順序 hub 43000 < curl 43100 < hook 43200 秒
- `terminal.mjs`：pid → tty → AppleScript 切到 Terminal.app 對應分頁（只支援 Terminal.app；首次會跳自動化權限）
- `tokens.mjs` + `pricing.mjs`：掃描所有 transcript（含 subagent）的 `usage`，記住每個檔案讀到的位置只讀新增部分（首次約 1 秒），每 15 秒更新一次。同一個回應會寫成多行、每行重複同一份 usage，所以一定要以 message id 去除重複（實測不去重會多算約 2.25 倍）。transcript 約 30 天會被 Claude Code 清掉，每日總計存在 `session-hub/tokens.json`（同一天取 token 較多者）。等效金額依 `pricing.mjs` 價格表（含 1h／5m cache 寫入、fast ×2、us ×1.1、Haiku 5.5 長 prompt ×5），未知模型只計 token
- `index.mjs`：HTTP + SSE（`/events`），每秒 tick，有變化才推送；tick 進行中收到事件會補跑一次
- `describe.mjs`（tool 一行摘要）、`notify.mjs`（macOS 通知，無音效）、`paths.mjs`（`CLAUDE_CONFIG_DIR` 可覆寫，測試用）

前端（`public/`，Three.js 走 jsDelivr importmap，無建置步驟）：

- `main.js`：場景、角色、移動路線、HUD、側欄。一個 cwd = 一座島，一個 session = 一個角色。閒置角色過橋到中央營火；busy 走到工具對應的工作站；waiting 站在橋頭
- `world.js`：廣場、島、工作站（Bash→鍛造爐、Read/Grep→書架、Edit/Write→工作台、Web/MCP→望遠鏡、Agent/Skill→傳送門、其他→中央桌）、橋、煙火（busy 超過 45 秒後結束才放）。島的 local +x 永遠朝向廣場
- `scenery.js`：遠景陸地／山脈／樹／雲。`heightAt()` 決定地形；+z（預設鏡頭背後）留外海缺口，-z 方向山最高
- `permissions-ui.js`：審批卡片與開關
- `tokens-ui.js`：Tokens 與等效金額視窗（每日熱力圖用單一藍色 sequential 色階，零值用底色灰）。只能從 HUD「今日」那行的「明細」按鈕打開
- 右上角 `#ctx-board`：所有 session 的 context % 由高到低（≥60 黃、≥80 紅，估計值標 ≈），側欄開啟時以 CSS 隱藏。compact 由使用者自己在 CLI 下指令，hub 不自動提醒
- 側欄的傳話輸入框（`#compose`）不在 `renderPanel` 的 innerHTML 裡，避免每秒更新洗掉正在打的字
- 操作：兩指滑動平移、捏合縮放（Chrome 是 ctrl+wheel，Safari 是 gesture 事件）、三指拖曳旋轉、方向鍵／WASD 平移。平移正負號是在 Mac 觸控板上實測調出來的（垂直有反轉、水平沒有），不要憑推理改

`npm run screenshots`（`scripts/demo/`）：用虛構 session 啟一個隔離的 hub（port 4396），以 headless Chrome + CDP 重拍 `docs/screenshots/`，README 用的就是這些圖。

目前沒有自動化測試；過去的驗證都是用 `CLAUDE_CONFIG_DIR` 指向假目錄、另開 port（如 4398/4399）跑的一次性腳本。

## 注意

- `~/.claude/sessions` 與 transcript 格式是內部格式，Claude Code 升版可能改變；解析邏輯集中在 sessions.mjs / transcript.mjs
- server 只綁 127.0.0.1；`/hook` 拒絕帶 Origin header 的請求（擋瀏覽器跨站偽造）
- hook script 必須永遠 exit 0、不可阻塞 session
- 所有請求都檢查 Host header 必須是 `127.0.0.1:<port>` 或 `localhost:<port>`（擋 DNS rebinding）；`/api/*`（可核准任意指令）只接受同源 Origin + JSON content-type
- 修改使用者全域設定（settings.json、statusline）一律做成安裝腳本讓使用者執行，並先備份、可完整移除

## 變更紀錄

- **2026-10-23** [MVP] 讀 sessions 名冊 + transcript，3D 島嶼與角色、SSE 推送、hooks 偵測 waiting、macOS 通知
- **2026-10-23** [狀態] busy 改以 PreToolUse 為主、registry 為輔；修正 tick 進行中事件被丟掉的延遲
- **2026-10-23** [互動] 中央營火廣場、橋、工作站、角色走路路線、完成煙火；通知拿掉音效
- **2026-10-23** [審批] PermissionRequest hook + 網頁審批卡片（允許／記住／拒絕／交回終端）；需重跑 hooks:install
- **2026-10-23** [額度] statusline snippet 寫出 rate_limits，HUD 顯示 5 小時／週額度條；需執行 usage:install
- **2026-10-23** [部署] `scripts/hub.sh` 背景常駐 + `start.sh`／`end.sh`；辨識相對路徑啟動的既有 server
- **2026-10-23** [操作] 觸控板兩指平移、捏合縮放、方向鍵平移；遠景陸地山脈、樹、雲，霧拉遠到 340
- **2026-10-23** [協作] 檔案衝突閃電、雙擊角色切到 Terminal、傳話（asyncRewake inbox）、context 門檻自動請它更新文件、活動熱力圖；需重跑 hooks:install、usage:install 並 hub:restart
- **2026-10-23** [簡化] 拿掉 context 自動提醒（reminders.mjs、settings.mjs、/api/remind、/api/settings），改成右上角 context 用量清單；熱力圖 404 時提示可能是 hub 未重啟
- **2026-10-23** [文件] README（含 demo 截圖）與 `npm run screenshots`；修正側欄「送出」按鈕被擠成直排
- **2026-10-23** [用量] transcript usage 統計每日 tokens 與 API 等效金額（HUD 今日、側欄每 session、活動視窗 Tokens 分頁）；新增 pricing.mjs、tokens.mjs，需 hub:restart
- **2026-10-23** [簡化] 拿掉指令熱力圖（activity.mjs、/api/activity），視窗只剩 Tokens，改由「明細」按鈕打開；修正視窗關不掉（目前分頁存在 data-tab，被 closest() 誤判成分頁按鈕）
