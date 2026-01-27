# 多語言問題分析報告

**問題**: AI 回覆有時會切換回繁體中文，即使使用者使用其他語言

---

## 問題根本原因

### 1. Prompt 中包含大量中文模板

以下檔案包含硬編碼的中文文字，會影響 AI 的語言選擇：

| 檔案 | 問題位置 | 中文內容 |
|------|---------|---------|
| `lib/prompt-components.js` | 第 98-123 行 | 購買指引模板 |
| `lib/prompt-components.js` | 第 171-187 行 | 免責聲明、購買指引 |
| `lib/prompt-components.js` | 第 208-245 行 | 車型資訊區塊 |
| `lib/prompt-builder.js` | 第 531-606 行 | 核心身份、規則說明 |
| `lib/agent-prompts.js` | 第 140-166 行 | 追問模板 |

### 2. 矛盾的指令

```
第 179 行: "購買指引（必須使用此範本，需翻譯成用戶語言）"
第 180-187 行: 接著顯示中文範本 👈 矛盾！
```

AI 看到中文範本後，可能會：
- 直接複製中文內容（而非翻譯）
- 認為中文是預期的輸出格式

### 3. 語言規則位置不夠強調

目前的語言規則放在 prompt 開頭，但：
- prompt 很長（800-1200 tokens）
- AI 可能在處理後半段時「遺忘」語言規則
- 沒有在 prompt 結尾再次強調

### 4. 缺乏明確的語言檢查機制

目前完全依賴 AI 自行偵測語言，沒有：
- 程式碼層級的語言偵測
- 將偵測到的語言作為參數傳遞
- 在回覆驗證層檢查語言一致性

---

## 具體問題範例

### 問題 1: 購買指引模板 (prompt-components.js:180-187)

```javascript
// 問題：說要翻譯，但只提供中文範本
**購買指引（必須使用此範本，需翻譯成用戶語言）：**
👉 點擊產品連結「這哪裡買」可查詢鄰近店家

💡 若查詢不到附近店家，歡迎填寫聯絡表單：
https://www.liqui-moly-tw.com/contact
我們會以簡訊回覆您購買資訊！
```

### 問題 2: 追問模板 (agent-prompts.js:161-166)

```javascript
// 問題：模板是中文，沒有翻譯指示
**必須使用的回覆模板：**
「您好！關於您的 ${vehicleModel}，請問您想找的是：
1. 引擎機油
2. 添加劑（如止漏、清潔、保護等）
3. 其他保養產品
```

### 問題 3: Final Reminder 只檢查一次 (prompt-builder.js:895-904)

```javascript
// 問題：檢查太弱，應該更強制
**⚠️ LANGUAGE CHECK:** Before you send your response:
1. What language did the user use? → Your response must be 100% in THAT language
```

---

## 修復方案

### 方案 A: 強化語言指令（建議優先實施）

修改 `lib/prompt-components.js` 和 `lib/prompt-builder.js`：

1. **提供雙語模板**：
```javascript
**購買指引範本：**
- 中文: 👉 點擊產品連結「這哪裡買」可查詢鄰近店家
- English: 👉 Click the product link "Where to buy" to find nearby stores
- 日本語: 👉 製品リンクの「購入場所」をクリックして近くの店舗を検索

⚠️ 翻譯成用戶使用的語言！不要照抄中文！
```

2. **在 prompt 結尾重複語言規則**：
```javascript
## 🔴🔴🔴 FINAL LANGUAGE CHECK 🔴🔴🔴
STOP! Before sending your response, verify:
□ Did the user write in Chinese?
  - YES → Reply in Chinese
  - NO → Your response must have ZERO Chinese characters (except product names)
□ Did you translate ALL templates?
□ Does your response match the user's language 100%?
```

3. **使用更強烈的禁止語**：
```javascript
**🚫 ABSOLUTE RULE:**
If user is NOT Chinese → Your response CANNOT contain ANY Chinese characters!
Violation = Invalid response!
```

### 方案 B: 程式碼層級語言偵測

修改 `api/chat.js`：

```javascript
// 偵測用戶語言
function detectUserLanguage(message) {
    // 檢測是否包含中文字符
    const hasChinese = /[\u4e00-\u9fff]/.test(message);
    // 檢測是否包含日文假名
    const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(message);
    // 檢測是否包含韓文
    const hasKorean = /[\uac00-\ud7af]/.test(message);

    if (hasChinese && !hasJapanese) return 'zh-TW';
    if (hasJapanese) return 'ja';
    if (hasKorean) return 'ko';
    return 'en'; // 預設英文
}

// 在 systemInstruction 中加入偵測到的語言
const userLanguage = detectUserLanguage(message);
systemInstruction += `\n\n⚠️ DETECTED USER LANGUAGE: ${userLanguage}
Your ENTIRE response MUST be in ${userLanguage}!`;
```

### 方案 C: 回覆驗證層檢查

修改 `lib/response-validator.js`：

```javascript
function validateLanguageConsistency(userMessage, aiResponse) {
    const userHasChinese = /[\u4e00-\u9fff]/.test(userMessage);
    const responseHasChinese = /[\u4e00-\u9fff]/.test(aiResponse);

    // 如果用戶沒用中文，但回覆有中文 → 警告
    if (!userHasChinese && responseHasChinese) {
        console.warn('[ResponseValidator] Language mismatch detected!');
        return {
            valid: false,
            issue: 'Response contains Chinese but user did not use Chinese'
        };
    }
    return { valid: true };
}
```

---

## 建議實施順序

1. **立即實施 (方案 A)**：強化 prompt 中的語言指令
2. **短期實施 (方案 B)**：加入程式碼層級語言偵測
3. **長期實施 (方案 C)**：加入回覆驗證層檢查

---

## 需要修改的檔案

| 檔案 | 修改內容 |
|------|---------|
| `lib/prompt-components.js` | 提供雙語模板、強化語言檢查 |
| `lib/prompt-builder.js` | 在結尾重複語言規則 |
| `lib/agent-prompts.js` | 追問模板加入翻譯指示 |
| `api/chat.js` | 加入程式碼層級語言偵測 |
| `lib/response-validator.js` | 加入語言一致性檢查 (可選) |

---

*報告產生日期: 2026-01-27*
