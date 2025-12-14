/**
 * LIQUI MOLY Chatbot - Wix Velo HTTP Functions
 * 
 * 整合版本：所有程式碼都在此檔案中
 * 檔案路徑: backend/http-functions.js
 */

import { ok, badRequest, serverError } from 'wix-http-functions';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import wixData from 'wix-data';

// ============================================
// 常數定義
// ============================================

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

const SYSTEM_PROMPT = `你是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的產品諮詢助理。

## 你的能力
你可以回答兩類問題：

### 1. 一般知識問題（使用你的內建知識）
- 汽車機油基礎知識（黏度、認證規格、差異比較等）
- 機車保養知識
- 引擎運作原理
- LIQUI MOLY 品牌介紹和優點
- 機油更換週期建議

### 2. 產品推薦問題（必須使用產品資料庫）
當用戶需要推薦特定產品時，**只能推薦下方「可用產品資料庫」中的產品**。
- 推薦機油、添加劑、化學品等
- 提供產品連結、價格、規格
- ⚠️ 禁止編造不存在於資料庫的產品編號或名稱

## 回覆風格
- **簡潔**：直接給答案
- **專業**：用專業術語但確保消費者能理解
- **格式清晰**：善用條列式

## 🌍 多語言與地區限制
- **偵測語言**：如果用戶使用非繁體中文的語言（如英文、日文、韓文、簡體中文等），請用該語言回覆
- **產品諮詢**：可以正常協助解答產品相關問題（規格、用途、推薦等）
- **購買問題**：當外國用戶詢問購買管道時，才需說明地區限制

### 外語購買問題回覆範本
當外國用戶詢問購買相關問題時（哪裡買、價格、運送等），用該語言回覆：
> (English example)
> Thank you for your interest in LIQUI MOLY! We are the authorized distributor for Taiwan region only, and we do not ship internationally.
> 
> For purchasing in your country, please visit LIQUI MOLY's official website to find your local distributor:
> https://www.liqui-moly.com
> 
> If you have any product-related questions, I'm happy to help!


## 🧠 推理邏輯（非常重要 - 必須遵守）
當用戶詢問特定車型的機油推薦時，**必須根據車主手冊規格推薦**：

### 步驟 1：用你的內建知識判斷車輛規格
你已經具備豐富的汽機車知識，請根據車型判斷需要的：
- **黏度**（如 5W30、5W40、10W40 等）
- **認證規格**（如 ACEA C3、BMW LL-04、VW 504.00、JASO MA2 等）

### 步驟 2：從產品資料庫找出**符合認證**的產品
查看「可用產品資料庫」中的「認證/規格」欄位，找出符合車輛需求的產品。

#### 汽車常見認證對照：
- **BMW**：BMW LL-04、BMW LL-01
- **Mercedes-Benz**：MB 229.51、MB 229.52
- **VW/Audi/Porsche**：VW 504.00/507.00
- **一般日系車**：API SP/SN、ACEA A3/B4
- **柴油車**：ACEA C3

#### 機車常見認證對照：
- **速克達（CVT）**：10W40，JASO MB
- **檔車（濕式離合器）**：10W40，JASO MA/MA2
- **重機**：10W40/10W50，JASO MA2

### 步驟 3：推薦產品（必須說明認證符合）
回覆時**必須說明產品符合的認證**，讓用戶確認符合車主手冊要求。

**範例**：
> Porsche Macan 2020 建議使用符合 **VW 504.00/507.00** 或 **Porsche C30** 認證的機油。
> 
> 從產品資料庫中找到符合的產品：
> - [Top Tec 6200 0W-20](連結) - 符合 VW 508.00/509.00、Porsche C20
> - [Top Tec 4200 5W-30](連結) - 符合 VW 504.00/507.00、Porsche A40
> 
> ⚠️ 請以車主手冊上的規格為準，若不確定請洽詢原廠

### ⚠️ 重要原則
- **不要猜測**：如果不確定車輛規格，請詢問用戶或建議查閱車主手冊
- **認證優先**：推薦產品必須說明認證規格，讓用戶能與車主手冊核對
- **資料庫為準**：產品名稱和連結必須來自產品資料庫

## 核心職責
1. 根據車型推薦合適的機油（汽車、摩托車皆可）
2. 解答產品使用方式
3. 引導購買正品公司貨

## 產品類別
- 汽車機油、摩托車機油
- 添加劑（油精、燃油添加劑）
- 化學品（清潔劑、保養品）

## 🚨 產品推薦規則（最高優先級）

### 核心原則
**推薦產品時，只能使用「可用產品資料庫」區塊中的資訊！**

### 智慧推薦
當用戶問「推薦CBR1100鏈條油」，你應該：
1. 查看「可用產品資料庫」中有哪些鏈條相關產品
2. 從中選擇適合的產品推薦
3. 使用資料庫中的完整產品名稱、編號和連結

### ✅ 正確範例
用戶問「推薦摩托車鏈條油」
資料庫中有：
\`\`\`
### 1. Motorbike Chain Spray Race 摩托車競技型陶瓷鏈條油
- 產品編號: LM21764
- 產品連結: https://www.liqui-moly-tw.com/products/lm21764
\`\`\`
回覆：「為您推薦 [Motorbike Chain Spray Race 摩托車競技型陶瓷鏈條油](https://www.liqui-moly-tw.com/products/lm21764)，適合高性能摩托車使用。」

### ❌ 絕對禁止（會導致嚴重錯誤）
- 禁止編造產品編號（如 LM3012 不存在就不能用）
- 禁止編造產品名稱（只能用資料庫中的完整名稱）
- 禁止自己記憶中的產品知識覆蓋資料庫資訊

### 找不到相關產品時
如果「可用產品資料庫」中確實沒有相關產品，回覆：
「目前資料庫中沒有找到相關產品。建議瀏覽[產品目錄](https://www.liqui-moly-tw.com/catalogue)查看更多產品。」

## 標準回覆範本

### 推薦產品時
> 針對您的 [車型]，推薦：
> - [產品名稱](連結) - 符合 XX 認證，適合 XX 引擎
> 
> 👉 點擊產品頁面「這哪裡買」可查詢鄰近店家

### 購買管道問題（當用戶問到哪裡買、店家、經銷商、門市、實體店、附近、購買等）
> 🏪 推薦使用我們的**[店家查詢系統](https://www.liqui-moly-tw.com/storefinder)**！
> 
> 只要選擇縣市，即可找到您附近的合作保修廠/車行。
> 
> 其他方式：
> - 產品頁面的「這哪裡買」功能
> - 填寫[聯絡表單](https://www.liqui-moly-tw.com/contact)，我們會以簡訊回覆


### 價格查詢（多少錢、價格、售價、價位等）
> 若產品資料庫中有「建議售價」，請直接提供
> 若無建議售價（顯示「請洽店家詢價」），回覆：
> 「此產品建議售價請洽詢合作店家。您可以使用[店家查詢系統](https://www.liqui-moly-tw.com/storefinder)找到附近店家聯繫詢價。」

### 電商平台問題（蝦皮、MOMO、PCHOME、Yahoo、露天等）
> 電商平台非公司貨，無品質保證。建議透過官方管道購買。

### 合作洽詢（保修廠、車行、經銷商、業務、代理、進貨、批發、合作、拜訪、業務拜訪、有業務嗎、業務人員等）
> 請填寫[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)，會有業務盡快與您聯繫拜訪！

### 團購問題（團購、大量購買、批量、揪團等）
> 感謝您的詢問！我們是總代理商，採 B2B 商業模式，並不直接販售給末端消費者。
> 
> 建議您可以：
> - 直接前往合作的保修廠/車行購買
> - 使用[店家查詢系統](https://www.liqui-moly-tw.com/storefinder)找到附近店家
> 
> 合作店家可能提供優惠方案，歡迎直接洽詢！

### 換油週期問題（多久換一次、換油週期、保養週期等）
> 建議換油週期：
> - **礦物油**：3,000-5,000 公里
> - **半合成機油**：5,000-7,000 公里
> - **全合成機油**：7,000-10,000 公里
> 
> ⚠️ 實際週期請參考車主手冊，並依照駕駛環境調整（市區走走停停可縮短、高速公路可延長）

### 常見問題

#### 機油可以混用嗎？
> 不建議混用不同品牌或規格的機油。建議換油時完全更換，以確保最佳潤滑效果。

#### 5W30 和 5W40 差在哪？
> - **5W30**：黏度較低，省油、適合新車和低溫環境
> - **5W40**：黏度較高，保護性更好、適合老車或高溫環境
> 
> 選擇依據：參考車主手冊建議的黏度規格

#### 柴油車和汽油車機油有差嗎？
> 是的，差異主要在認證規格：
> - **柴油車**：需要 ACEA C3/C4 或 API CK-4 等柴油認證
> - **汽油車**：需要 API SP/SN 或 ACEA A3/A5 等汽油認證
> 
> 部分機油為汽柴油共用，請確認產品認證規格

### 防偽驗證查詢（真假、正品、假貨、仿冒、驗證等）
> 公司貨產品都有防偽標籤！驗證方式：
> 
> 1. 找到產品上方的防偽標籤
> 2. 刮開銀色塗層
> 3. 掃描 QR Code 進入驗證頁面
> 4. 系統會顯示是否為正品
> 
> 如有疑慮，歡迎透過[聯絡表單](https://www.liqui-moly-tw.com/contact)向我們查詢！

### 技術支援（複雜技術問題、無法解答的問題）
> 如果您的問題較為複雜，建議透過[聯絡表單](https://www.liqui-moly-tw.com/contact)留下您的問題，我們的技術人員會盡快回覆您！

### 社群媒體（FB、IG、LINE、追蹤、粉專等）
> 歡迎追蹤我們的社群媒體獲取最新資訊：
> - Facebook: https://www.facebook.com/liquimolytaiwan
> - Instagram: https://www.instagram.com/liquimoly_taiwan

## 🔧 常見車廠認證對照（幫助推薦產品）
- **BMW LL-04**：BMW 柴油車
- **BMW LL-01**：BMW 汽油車
- **MB 229.51/229.52**：Mercedes-Benz
- **VW 504.00/507.00**：VW/Audi/Skoda/Seat
- **ACEA C3**：歐系柴油車通用
- **ACEA A3/B4**：歐系汽油車通用
- **JASO MA/MA2**：機車專用
- **API SP/SN**：美系、日系汽油車

## 禁止事項
- 不推薦非 LIQUI MOLY 產品
- 不承諾價格或促銷
- 不編造產品資訊
- 不提供團購服務（總代理是 B2B 業務）

## 📋 更多常見問題回覆範本

### 保固與售後服務（品質、客服、售後、保固、壞掉、瑕疵等）
> 公司貨產品享有完整售後服務！若有品質疑慮，請透過[聯絡表單](https://www.liqui-moly-tw.com/contact)回報，我們會盡速協助處理。

### 產品效期問題（過期、保存期限、有效日期、存放等）
> 若您對產品效期有疑問，請透過[聯絡表單](https://www.liqui-moly-tw.com/contact)與我們聯繫，我們會盡快確認回覆。

### 用量問題（幾公升、一罐夠嗎、要加多少等）
> 機油用量依車型而異，建議參考車主手冊。一般參考值：
> - **汽車**：約 4-6 公升
> - **機車**：約 0.8-1.2 公升
>
> ⚠️ 實際用量請以車主手冊或保修廠建議為準

### 促銷與特價問題（特價、優惠、折扣、活動、划算等）
> 產品建議售價請參考產品頁面資訊。各店家可能有不同優惠方案，建議直接洽詢[合作店家](https://www.liqui-moly-tw.com/storefinder)。

### 店家價格差異（為什麼價格不一樣、價差等）
> 各店家可依市場行情自行定價，價格可能略有差異。建議您多比較，或直接洽詢鄰近的[合作店家](https://www.liqui-moly-tw.com/storefinder)。

### 客服聯繫方式（電話、客服、聯絡方式等）
> 您可以透過以下方式聯繫我們：
> - [聯絡表單](https://www.liqui-moly-tw.com/contact)：填寫問題後，我們會盡快回覆
> - Facebook 粉專：https://www.facebook.com/liquimolytaiwan

## 🏭 保修廠/車行老闆專區

### 進貨與批發（最低訂購量、經銷價、批發價、進貨、訂貨等）
> 感謝您對 LIQUI MOLY 的興趣！合作細節（最低訂購量、經銷價格、運費等）請填寫[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)，專人將與您聯繫說明。

### 運費與物流（貨運、運費、寄送、配送等）
> 運費與物流細節請填寫[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)洽詢，我們會有專人與您說明合作方式。

### 技術支援與培訓（技術手冊、產品培訓、教育訓練、展示架、POS等）
> 我們提供合作店家完整的技術支援與行銷資源！包含：
> - 產品培訓課程
> - 技術手冊與型錄
> - 展示架申請
>
> 請透過[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)洽詢，我們會安排專人服務。

### 熱銷產品推薦（暢銷、推薦組合、熱門、入門等）
> 熱銷產品因店家而異，一般推薦：
> - **汽車機油**：Top Tec 4200、Special Tec AA、Molygen 系列
> - **機車機油**：Motorbike 4T 10W40 系列
> - **添加劑熱銷**：Cera Tec 陶瓷機油精、Injection Cleaner 噴油嘴清潔劑
>
> 詳細合作方案請填寫[合作表單](https://www.liqui-moly-tw.com/cooperate)洽詢。

### 試用與樣品（試用、樣品、先試再決定等）
> 試用與樣品申請請透過[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)洽詢，專人將與您討論合作細節。

## 🔧 產品比較與選擇

### 產品系列差異（Top Tec 4200 vs 4600、特護 vs 頂技等）
> 不同產品系列主要差異在於認證規格和適用車型：
> - **Top Tec 系列**：針對特定車廠認證設計
> - **Special Tec 系列**：針對特定地區車型優化
> - **Molygen 系列**：添加鎢元素，強化保護與抗磨損
>
> 建議以您車主手冊要求的認證規格為主來選擇。

### 產品標籤語言問題（德文、英文、標籤看不懂等）
> LIQUI MOLY 是德國品牌，部分產品標籤為德文屬正常現象。公司貨均附有繁體中文標籤與說明，方便您閱讀使用。

### 競品比較問題（跟 Mobil 比、跟 Shell 比、跟其他品牌比等）
> LIQUI MOLY 來自德國，是全球知名的潤滑油專家，多次獲得德國最佳品牌獎。我們專注於高品質產品，並通過多項國際認證。建議依照您車輛的原廠規格選擇適合的機油。

## 🚗 老車/高里程車專區

### 老車推薦（老車、里程高、十萬公里、二十萬公里、吃機油等）
> 高里程車輛（超過 10 萬公里）建議：
> - 使用較高黏度機油（如 5W40 或 10W40）
> - 可搭配 [Oil Additive 引擎機油添加劑] 減少機油消耗
> - 定期使用 [Engine Flush Plus 引擎內部油泥清洗劑] 清潔積碳
>
> ⚠️ 具體產品請參考產品資料庫

### 機油消耗問題（吃機油、機油減少太快、要一直加機油等）
> 若車輛機油消耗較快，建議：
> 1. 先至保修廠檢查是否有漏油
> 2. 可考慮使用較高黏度機油（如從 5W30 改用 5W40）
> 3. 可搭配機油添加劑改善油封彈性

## 🔍 症狀與解決方案

### 引擎異音問題（異音、敲缸、哒哒聲、噠噠聲、聲音大等）
> 引擎異音可能原因較多，建議先至保修廠檢查。若為汽門頂筒異音，可考慮使用：
> - [Hydraulic Lifter Additive 汽門頂筒添加劑]
>
> ⚠️ 嚴重異音請先就近保修廠診斷

### 油耗變高問題（耗油、油耗變差、吃油等）
> 油耗增加可能原因：
> 1. 噴油嘴堵塞 → 建議使用 [Injection Cleaner 噴油嘴清潔劑]
> 2. 積碳過多 → 建議使用 [Engine Flush Plus 引擎清洗劑]
> 3. 機油老化 → 建議定期更換機油

### 冷車難發動（難發動、發不動、冷車啟動困難等）
> 冷車難發動可能原因較多，建議檢查電瓶與燃油系統。若為燃油相關，可考慮使用燃油添加劑改善。

### 引擎抖動問題（抖動、怠速不穩、抖抖的等）
> 引擎抖動常見原因：
> 1. 積碳過多 → 建議使用引擎清洗相關產品
> 2. 節氣門髒污 → 建議使用 [節氣門清潔劑]
>
> 建議先至保修廠診斷確認原因

### 排氣冒煙問題（冒煙、黑煙、白煙、藍煙等）
> 排氣冒煙類型說明：
> - **黑煙**：燃燒不完全，可用燃油系統清潔劑
> - **白煙**：可能為水氣或冷卻液問題，建議檢修
> - **藍煙**：可能機油進入燃燒室，建議檢修
>
> ⚠️ 持續冒煙請至保修廠檢查

### 變速箱問題（換檔頓挫、變速箱異音、ATF等）
> 變速箱問題建議：
> 1. 定期更換變速箱油（ATF）
> 2. 可使用 [ATF Additive 自動變速箱添加劑] 改善換檔順暢度
>
> ⚠️ 嚴重問題請至保修廠診斷

## 🏍️ 機車專區補充

### 速克達 vs 檔車機油選擇
> - **速克達（無離合器）**：使用 JASO MB 認證機油即可
> - **檔車（濕式離合器）**：必須使用 JASO MA/MA2 認證機油
>
> ⚠️ 檔車誤用 MB 機油會造成離合器打滑！

### 機車鏈條保養（鏈條油、鏈條清潔、上油等）
> 機車鏈條保養建議：
> 1. 先用鏈條清潔劑清潔
> 2. 再噴上鏈條潤滑油
> 3. 建議每 300-500 公里保養一次

### 機車添加劑推薦（機車用添加劑、機車油精等）
> 機車可用的添加劑：
> - [Motorbike Speed Additive 摩托車速度添加劑] - 燃油系統清潔
> - [Motorbike Oil Additive 摩托車機油添加劑] - 引擎保護

## ❓ 其他常見問題

### 什麼是 ACEA、API 認證？
> - **API**：美國石油協會認證（如 API SP、SN 等），主要針對美系、日系車
> - **ACEA**：歐洲汽車製造商協會認證（如 ACEA C3、A3/B4 等），主要針對歐系車
>
> 選擇機油時，請參考車主手冊要求的認證規格。

### 全合成、半合成、礦物油差在哪？
> - **礦物油**：價格較低，換油週期短（3,000-5,000 公里）
> - **半合成機油**：性價比高，換油週期中等（5,000-7,000 公里）
> - **全合成機油**：保護性最佳，換油週期長（7,000-10,000 公里）

### 為什麼要用原廠認證機油？
> 原廠認證機油（如 BMW LL-04、VW 504.00 等）經過車廠測試驗證，能確保：
> - 與引擎完美相容
> - 維持 DPF/GPF 等後處理系統正常運作
> - 保有原廠保固

### 公司貨與水貨差異（公司貨、水貨、平行輸入等）
> 公司貨優勢：
> - ✅ 原廠防偽標籤
> - ✅ 繁體中文標示
> - ✅ 完整售後服務
> - ✅ 品質有保障
>
> 建議透過[合作店家](https://www.liqui-moly-tw.com/storefinder)購買公司貨。`;

// ============================================
// 健康檢查 API（最簡單，用於測試）
// ============================================

export function get_health(request) {
    return ok({
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
            service: "LIQUI MOLY Chatbot API"
        })
    });
}

// ============================================
// OPTIONS 處理 (CORS Preflight)
// ============================================

export function options_chat(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// OPTIONS 處理 - startSession
// ============================================

export function options_startSession(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// OPTIONS 處理 - endSession
// ============================================

export function options_endSession(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// POST /startSession - 開始對話
// ============================================

export async function post_startSession(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        // 驗證必填欄位
        if (!body.userName || !body.userEmail || !body.category) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Missing required fields: userName, userEmail, category"
                })
            });
        }

        // 建立 session 記錄
        const sessionData = {
            userName: body.userName,
            userEmail: body.userEmail,
            userPhone: body.userPhone || '',
            category: body.category,
            messages: JSON.stringify([]),
            status: 'active',
            startTime: new Date(),
            lastActivity: new Date()
        };

        const result = await wixData.insert('chatSessions', sessionData);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                sessionId: result._id
            })
        });

    } catch (error) {
        console.error('POST /startSession error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// POST /endSession - 結束對話
// ============================================

export async function post_endSession(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.sessionId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Missing sessionId"
                })
            });
        }

        // 更新 session 狀態
        const session = await wixData.get('chatSessions', body.sessionId);
        if (session) {
            session.status = 'ended';
            session.endTime = new Date();
            await wixData.update('chatSessions', session);
        }

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true
            })
        });

    } catch (error) {
        console.error('POST /endSession error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// GET /cleanupSessions - 清理閒置對話（定時任務呼叫）
// ============================================

export async function get_cleanupSessions(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        // 10 分鐘前的時間
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        // 查詢所有超過 10 分鐘未活動的 active session
        const results = await wixData.query('chatSessions')
            .eq('status', 'active')
            .lt('lastActivity', tenMinutesAgo)
            .limit(100)
            .find();

        let closedCount = 0;

        // 批量更新為 ended
        for (const session of results.items) {
            session.status = 'ended';
            session.endTime = new Date();
            await wixData.update('chatSessions', session);
            closedCount++;
        }

        console.log(`Cleanup: closed ${closedCount} idle sessions`);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                closedSessions: closedCount,
                timestamp: new Date().toISOString()
            })
        });

    } catch (error) {
        console.error('GET /cleanupSessions error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

export function options_products(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// 聊天 API
// ============================================

export async function post_chat(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.message || typeof body.message !== 'string') {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Missing or invalid message parameter"
                })
            });
        }

        if (body.message.length > 1000) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Message too long"
                })
            });
        }

        const conversationHistory = Array.isArray(body.conversationHistory)
            ? body.conversationHistory
            : [];

        // 取得 API Key
        let apiKey;
        try {
            apiKey = await getSecret('GEMINI_API_KEY');
        } catch (e) {
            console.error('Failed to get API key:', e);
            return serverError({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "API configuration error"
                })
            });
        }

        if (!apiKey) {
            return serverError({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "API key not found"
                })
            });
        }

        // Step 1: AI 分析用戶問題，判斷車型類別和需要的規格
        let searchInfo = null;
        try {
            searchInfo = await analyzeUserQuery(apiKey, body.message);
            console.log('AI Analysis:', JSON.stringify(searchInfo));
        } catch (e) {
            console.error('AI analysis failed:', e);
        }

        // Step 2: 根據 AI 分析結果搜尋產品
        let productContext = "目前沒有產品資料";
        try {
            productContext = await searchProductsWithAI(body.message, searchInfo);
        } catch (e) {
            console.error('Product search failed:', e);
        }

        // 建構對話內容
        const contents = buildContents(body.message, conversationHistory, productContext);

        // 呼叫 Gemini API
        const aiResponse = await callGemini(apiKey, contents);

        // 儲存對話紀錄到 CMS（如果有 sessionId）
        if (body.sessionId) {
            try {
                const session = await wixData.get('chatSessions', body.sessionId);
                if (session) {
                    // 解析現有對話紀錄
                    let messages = [];
                    try {
                        messages = JSON.parse(session.messages || '[]');
                    } catch (e) {
                        messages = [];
                    }

                    // 新增用戶訊息和 AI 回覆
                    messages.push({
                        role: 'user',
                        content: body.message,
                        timestamp: new Date().toISOString()
                    });
                    messages.push({
                        role: 'assistant',
                        content: aiResponse,
                        timestamp: new Date().toISOString()
                    });

                    // 更新 session
                    session.messages = JSON.stringify(messages);
                    session.lastActivity = new Date();
                    await wixData.update('chatSessions', session);
                }
            } catch (e) {
                console.error('Failed to save chat message:', e);
                // 不影響主要回應
            }
        }

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                response: aiResponse
            })
        });

    } catch (error) {
        console.error('POST /chat error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// 產品 API
// ============================================

export async function get_products(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const results = await wixData.query('products')
            .ascending('title')
            .limit(1000)
            .find();

        const products = results.items.map(p => ({
            id: p._id,
            title: p.title,
            partno: p.partno,
            viscosity: p.word2,
            certifications: p.cert,
            category: p.sort,
            url: p.partno ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}` : null
        }));

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                products: products
            })
        });

    } catch (error) {
        console.error('GET /products error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// AI 分析與搜尋函數
// ============================================

// AI 分析用戶問題，判斷車型類別和需要的規格
async function analyzeUserQuery(apiKey, message) {
    const analysisPrompt = `你是一個汽機車專家。請分析用戶的問題，並以 JSON 格式返回以下資訊：

用戶問題：「${message}」

請返回以下 JSON 格式（只返回 JSON，不要其他文字）：
{
    "vehicleType": "汽車" 或 "摩托車" 或 "未知",
    "vehicleSubType": "速克達/CVT" 或 "檔車/濕式離合器" 或 "重機" 或 "轎車" 或 "休旅車" 或 "柴油車" 或 "未知",
    "certifications": ["需要的認證，如 JASO MA2, API SP, ACEA C3 等"],
    "viscosity": "建議黏度，如 10W40, 5W30 等",
    "searchKeywords": ["搜尋關鍵字，如 Motorbike, 4T, 機油 等"],
    "productCategory": "機油" 或 "添加劑" 或 "化學品" 或 "其他" 或 "未知",
    "needsProductRecommendation": true 或 false
}

注意：
- 如果是摩托車檔車（如 DR-Z, CBR, Ninja），vehicleSubType 應為 "檔車/濕式離合器"，需要 JASO MA 或 MA2 認證
- 如果是速克達（如 PCX, NMAX, Force），vehicleSubType 應為 "速克達/CVT"，需要 JASO MB 認證
- 如果問題與產品推薦無關（如一般知識問題），needsProductRecommendation 設為 false`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: analysisPrompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 500
                }
            })
        });

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // 嘗試解析 JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch (e) {
        console.error('analyzeUserQuery error:', e);
        return null;
    }
}

// 根據 AI 分析結果搜尋產品
async function searchProductsWithAI(query, searchInfo) {
    try {
        // 如果不需要產品推薦，返回空
        if (searchInfo && searchInfo.needsProductRecommendation === false) {
            return '（此問題不需要產品推薦，請使用內建知識回答）';
        }

        // 先嘗試精確搜尋（產品編號優先）
        const partnoMatch = query.match(/lm\d+/i);
        if (partnoMatch) {
            const partnoResults = await wixData.query('products')
                .contains('partno', partnoMatch[0])
                .limit(10)
                .find();
            if (partnoResults.items.length > 0) {
                return formatProducts(partnoResults.items);
            }
        }

        // 根據 AI 分析結果搜尋
        if (searchInfo) {
            let allResults = [];

            // 根據車型類別搜尋
            if (searchInfo.vehicleType === '摩托車') {
                const motorcycleProducts = await wixData.query('products')
                    .contains('sort', '摩托車')
                    .limit(30)
                    .find();
                allResults = allResults.concat(motorcycleProducts.items);
            } else if (searchInfo.vehicleType === '汽車') {
                const carProducts = await wixData.query('products')
                    .contains('sort', '汽車')
                    .limit(30)
                    .find();
                allResults = allResults.concat(carProducts.items);
            }

            // 根據認證搜尋
            if (searchInfo.certifications && searchInfo.certifications.length > 0) {
                for (const cert of searchInfo.certifications) {
                    const certResults = await wixData.query('products')
                        .contains('cert', cert)
                        .limit(10)
                        .find();
                    allResults = allResults.concat(certResults.items);
                }
            }

            // 根據搜尋關鍵字搜尋
            if (searchInfo.searchKeywords && searchInfo.searchKeywords.length > 0) {
                for (const keyword of searchInfo.searchKeywords) {
                    const keywordResults = await wixData.query('products')
                        .contains('title', keyword)
                        .or(wixData.query('products').contains('content', keyword))
                        .limit(10)
                        .find();
                    allResults = allResults.concat(keywordResults.items);
                }
            }

            // 去除重複
            const uniqueResults = [...new Map(allResults.map(p => [p._id, p])).values()];
            if (uniqueResults.length > 0) {
                return formatProducts(uniqueResults.slice(0, 30));
            }
        }

        // Fallback：使用原始搜尋邏輯
        return await searchProducts(query);

    } catch (error) {
        console.error('searchProductsWithAI error:', error);
        return await searchProducts(query);
    }
}

// ============================================
// 內部函數
// ============================================

async function searchProducts(query) {
    try {
        // 提取查詢中的關鍵字
        const keywords = extractKeywords(query);

        // 先嘗試精確搜尋（產品編號優先）
        const partnoMatch = query.match(/lm\d+/i);
        if (partnoMatch) {
            const partnoResults = await wixData.query('products')
                .contains('partno', partnoMatch[0])
                .limit(10)
                .find();
            if (partnoResults.items.length > 0) {
                return formatProducts(partnoResults.items);
            }
        }

        // 症狀→產品類別對應（智能推薦）
        const symptomKeywords = getSymptomKeywords(query);
        if (symptomKeywords.length > 0) {
            let symptomResults = [];
            for (const keyword of symptomKeywords) {
                const results = await wixData.query('products')
                    .contains('title', keyword)
                    .or(wixData.query('products').contains('content', keyword))
                    .limit(10)
                    .find();
                symptomResults = symptomResults.concat(results.items);
            }
            // 去除重複
            const uniqueSymptomResults = [...new Map(symptomResults.map(p => [p._id, p])).values()];
            if (uniqueSymptomResults.length > 0) {
                return formatProducts(uniqueSymptomResults.slice(0, 20));
            }
        }

        // 全文搜尋所有欄位
        let allResults = [];
        for (const keyword of keywords) {
            const results = await wixData.query('products')
                .contains('title', keyword)
                .or(wixData.query('products').contains('content', keyword))
                .or(wixData.query('products').contains('sort', keyword))
                .or(wixData.query('products').contains('cert', keyword))
                .or(wixData.query('products').contains('partno', keyword))
                .limit(15)
                .find();
            allResults = allResults.concat(results.items);
        }

        // 去除重複
        const uniqueResults = [...new Map(allResults.map(p => [p._id, p])).values()];

        if (uniqueResults.length > 0) {
            return formatProducts(uniqueResults.slice(0, 30));
        }

        // 若無結果，根據查詢類型判斷分類並取得相關產品
        let fallbackProducts = null;

        const queryLower = query.toLowerCase();

        // 常見摩托車品牌和車型關鍵字
        const motorcycleBrands = ['suzuki', 'honda', 'yamaha', 'kawasaki', 'ktm', 'ducati', 'harley', 'bmw', 'triumph', 'aprilia', 'vespa', 'sym', 'kymco', 'gogoro', 'pgo'];
        const motorcycleModels = ['dr-z', 'drz', 'cbr', 'ninja', 'r1', 'r6', 'mt-', 'yzf', 'gsx', 'z900', 'z1000', 'z650', 'crf', 'wr', 'pcx', 'nmax', 'xmax', 'forza', 'burgman', 'address', 'jog', 'force', 'cuxi', 'bws'];

        const isMotorcycleQuery =
            queryLower.includes('機車') ||
            queryLower.includes('摩托') ||
            queryLower.includes('速克達') ||
            queryLower.includes('檔車') ||
            queryLower.includes('重機') ||
            queryLower.includes('motorbike') ||
            queryLower.includes('motorcycle') ||
            queryLower.includes('scooter') ||
            motorcycleBrands.some(brand => queryLower.includes(brand)) ||
            motorcycleModels.some(model => queryLower.includes(model));

        if (isMotorcycleQuery) {
            fallbackProducts = await wixData.query('products')
                .contains('sort', '摩托車')
                .limit(20)
                .find();
        } else if (queryLower.includes('汽車') || queryLower.includes('轎車') || queryLower.includes('休旅')) {
            fallbackProducts = await wixData.query('products')
                .contains('sort', '汽車')
                .limit(20)
                .find();
        } else {
            // 取得所有產品讓 AI 自行選擇
            fallbackProducts = await wixData.query('products')
                .limit(50)
                .find();
        }

        if (fallbackProducts && fallbackProducts.items && fallbackProducts.items.length > 0) {
            return formatProducts(fallbackProducts.items);
        }

        // 最終備援：取得任意產品
        const anyProducts = await wixData.query('products')
            .limit(50)
            .find();
        return formatProducts(anyProducts.items);

    } catch (error) {
        console.error('Product search error:', error);
        return '無法取得產品資料';
    }
}

// 症狀→產品關鍵字對應
function getSymptomKeywords(query) {
    const symptomMap = {
        // 引擎異音相關
        '異音': ['Additive', '添加劑', 'Lifter'],
        '敲缸': ['Additive', '添加劑'],
        '哒哒': ['Lifter', '汽門', 'Additive'],
        '噠噠': ['Lifter', '汽門', 'Additive'],
        '聲音大': ['Additive', '添加劑'],

        // 油耗相關
        '耗油': ['Injection', 'Cleaner', '清潔', '噴油嘴'],
        '油耗': ['Injection', 'Cleaner', '清潔', '噴油嘴'],
        '吃油': ['Injection', 'Cleaner', 'Flush'],

        // 積碳相關
        '積碳': ['Flush', 'Cleaner', '清潔', '清洗'],
        '積炭': ['Flush', 'Cleaner', '清潔', '清洗'],

        // 發動問題
        '難發動': ['Additive', '添加劑', '燃油'],
        '發不動': ['Additive', '添加劑', '燃油'],
        '冷車': ['Additive', '添加劑'],

        // 抖動問題
        '抖動': ['Cleaner', '清潔', 'Flush', '節氣門'],
        '怠速不穩': ['Cleaner', '清潔', 'Flush'],

        // 冒煙問題
        '冒煙': ['Flush', 'Additive', '添加劑'],
        '黑煙': ['Diesel', 'Cleaner', '柴油', '清潔'],
        '藍煙': ['Additive', 'Oil', '機油'],

        // 機油消耗
        '吃機油': ['Additive', 'Oil', '添加劑', '機油精'],
        '機油消耗': ['Additive', 'Oil', '添加劑'],

        // 變速箱問題
        '換檔頓挫': ['ATF', '變速箱', 'Gear'],
        '變速箱異音': ['ATF', '變速箱', 'Gear'],
        '頓挫': ['ATF', '變速箱'],

        // 冷卻系統
        '過熱': ['Coolant', '冷卻', '水箱'],
        '水溫高': ['Coolant', '冷卻', '水箱'],

        // 煞車問題
        '煞車異音': ['Brake', '煞車'],
        '煞車軟': ['Brake', '煞車油'],

        // 鏈條保養
        '鏈條': ['Chain', '鏈條'],

        // 老車相關
        '老車': ['Additive', '添加劑', 'Flush', '清洗'],
        '里程高': ['Additive', '添加劑', 'Flush'],
        '高里程': ['Additive', '添加劑', 'Flush'],

        // 保護相關
        '保護': ['Additive', '添加劑', 'Cera', '陶瓷'],
        '油封': ['Additive', 'Leak', '防漏'],
        '漏油': ['Leak', 'Stop', '防漏']
    };

    const matchedKeywords = [];
    const queryLower = query.toLowerCase();

    for (const [symptom, keywords] of Object.entries(symptomMap)) {
        if (query.includes(symptom) || queryLower.includes(symptom.toLowerCase())) {
            matchedKeywords.push(...keywords);
        }
    }

    // 去除重複
    return [...new Set(matchedKeywords)];
}

// 從查詢中提取有意義的關鍵字
function extractKeywords(query) {
    // 移除常見無意義詞彙
    const stopWords = ['的', '我', '我的', '你', '推薦', '用', '嗎', '可以', '什麼', '哪個', '有沒有', '一下', '請問', '想', '要', '需要', '和', '跟', '差', '在', '哪'];

    // 提取產品相關關鍵字
    const productKeywords = [];

    // 提取產品編號
    const partnoMatch = query.match(/lm\d+/gi);
    if (partnoMatch) {
        productKeywords.push(...partnoMatch);
    }

    // 提取車廠認證規格（VW 504/507/508/509、BMW LL、MB 229、Ford WSS 等）
    const certPatterns = [
        { regex: /(?:vw|福斯|大眾)\s*(\d{3})/gi, prefix: 'VW ' },
        { regex: /(?:mb|賓士|mercedes)\s*(\d{3})/gi, prefix: 'MB ' },
        { regex: /(?:bmw|寶馬)\s*(ll-?\d+)/gi, prefix: 'BMW ' },
        { regex: /acea\s*([a-z]\d)/gi, prefix: 'ACEA ' },
        { regex: /api\s*([a-z]{2})/gi, prefix: 'API ' },
        { regex: /jaso\s*(ma\d?|mb)/gi, prefix: 'JASO ' },
        { regex: /porsche\s*([a-z]\d+)/gi, prefix: 'Porsche ' },
        { regex: /(?:ford|福特)\s*(?:wss)?-?m2c\s*(\d{3})-?([a-z])?/gi, prefix: 'WSS-M2C ' }
    ];

    for (const pattern of certPatterns) {
        let match;
        while ((match = pattern.regex.exec(query)) !== null) {
            productKeywords.push(match[1]); // 只加數字/代碼部分，讓搜尋更寬鬆
            if (match[2]) {
                productKeywords.push(match[1] + '-' + match[2].toUpperCase()); // 如 948-B
                productKeywords.push(match[1] + match[2].toUpperCase()); // 如 948B
            }
        }
    }

    // 直接提取認證碼格式（如 948B, 948-B, 956-A1 等）
    const certCodes = query.match(/\b(\d{3})-?([a-z]\d?)\b/gi);
    if (certCodes) {
        for (const code of certCodes) {
            productKeywords.push(code);
            // 同時加入有無連字號的版本
            if (code.includes('-')) {
                productKeywords.push(code.replace('-', ''));
            } else {
                productKeywords.push(code.replace(/(\d{3})([a-z])/i, '$1-$2'));
            }
        }
    }

    // 直接提取 3 位數認證數字（如 504, 507, 508, 509, 229 等）
    const certNumbers = query.match(/\b(50[4789]|22[0-9]|LL-?\d+)\b/gi);
    if (certNumbers) {
        productKeywords.push(...certNumbers);
    }

    // 提取常見產品系列名稱（優先處理）
    const productSeries = [
        'Top Tec', 'TopTec', 'Special Tec', 'SpecialTec', 'Molygen', 'Leichtlauf',
        'MoS2', 'Cera Tec', 'CeraTec', 'Synthoil', 'Motorbike', 'Motor Protect',
        'Pro-Line', 'Optimal', 'Super Diesel', 'Truck', 'Marine', 'Racing',
        'Engine Flush', 'Injection Cleaner', 'Oil Additive', 'ATF'
    ];

    for (const series of productSeries) {
        if (query.toLowerCase().includes(series.toLowerCase())) {
            productKeywords.push(series);
        }
    }

    // 提取產品型號數字（如 4200, 4600, 6200 等）
    const modelNumbers = query.match(/\d{4}/g);
    if (modelNumbers) {
        productKeywords.push(...modelNumbers);
    }

    // 提取黏度規格（如 5W30, 5W-30, 10W40, 0W20 等）
    const viscosityMatch = query.match(/\d+W-?\d+/gi);
    if (viscosityMatch) {
        productKeywords.push(...viscosityMatch);
    }

    // 提取英文關鍵字（排除已處理的系列名稱中的單字）
    const englishWords = query.match(/[a-zA-Z]{3,}/g);
    if (englishWords) {
        const seriesWordsLower = productSeries.flatMap(s => s.toLowerCase().split(' '));
        for (const word of englishWords) {
            const lower = word.toLowerCase();
            // 只加入非系列名稱單字的英文詞
            if (!seriesWordsLower.includes(lower) && !['and', 'the', 'for'].includes(lower)) {
                productKeywords.push(lower);
            }
        }
    }

    // 提取常見產品類型關鍵字
    const productTypes = ['機油', '煞車油', '剎車油', '冷卻液', '水箱精', '鏈條油', '齒輪油', '添加劑', '油精', '清潔劑',
        '方向機油', '變速箱油', '煞車', '機車', '汽車', '摩托車', '速克達', '檔車', '重機', '頂技', '特護'];
    for (const type of productTypes) {
        if (query.includes(type)) {
            productKeywords.push(type);
        }
    }

    // 如果沒有找到關鍵字，使用原始查詢
    if (productKeywords.length === 0) {
        return [query];
    }

    return [...new Set(productKeywords)];
}

function formatProducts(products) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    let context = '## 可用產品資料庫\n\n';

    products.forEach((p, i) => {
        const url = p.partno
            ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}`
            : 'https://www.liqui-moly-tw.com/catalogue';

        context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
        context += `- 產品編號: ${p.partno || 'N/A'}\n`;
        context += `- 黏度: ${p.word2 || 'N/A'}\n`;
        context += `- 認證/規格: ${p.cert || 'N/A'}\n`;
        context += `- 分類: ${p.sort || 'N/A'}\n`;
        context += `- 建議售價: ${p.price || '請洽店家詢價'}\n`;
        context += `- 使用方法: ${p.use || 'N/A'}\n`;
        context += `- 產品連結: ${url}\n`;
        context += `- 產品說明: ${p.content || 'N/A'}\n\n`;
    });

    return context;
}

function buildContents(message, history, productContext) {
    const contents = [];

    // 建構系統上下文（每次都包含）
    const systemContext = `${SYSTEM_PROMPT}

${productContext}

【重要提醒】
- 你必須從上方「可用產品資料庫」中選擇產品推薦
- 推薦產品時必須使用資料庫中的「產品連結」
- 連結必須是 https://www.liqui-moly-tw.com/products/ 開頭
- 使用 Markdown 格式：[產品名稱](產品連結)`;

    // 加入歷史對話
    if (history && history.length > 0) {
        // 第一條訊息加入系統上下文
        history.forEach((msg, index) => {
            if (index === 0 && msg.role === 'user') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `${systemContext}\n\n用戶問題: ${msg.content}` }]
                });
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content }]
                });
            }
        });

        // 當前訊息（繼續對話時仍帶上產品資料庫提醒）
        contents.push({
            role: 'user',
            parts: [{ text: `${message}\n\n（請記得使用上方產品資料庫中的連結推薦產品）` }]
        });
    } else {
        // 沒有歷史時，第一條訊息加入完整上下文
        contents.push({
            role: 'user',
            parts: [{ text: `${systemContext}\n\n用戶問題: ${message}` }]
        });
    }

    return contents;
}

async function callGemini(apiKey, contents) {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    const requestBody = {
        contents: contents,
        // 停用 Grounding：改用 AI 內建知識推理車型規格，確保遵循回覆準則
        // 如需上網搜尋功能，請啟用下一行（需付費）
        // tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.4,  // 降低以減少幻覺
            topK: 20,          // 降低以更保守
            topP: 0.8,         // 降低以減少隨機性
            maxOutputTokens: 4096,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', errorText);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();

    // 檢查是否有 candidates
    if (data.candidates && data.candidates[0]) {
        const candidate = data.candidates[0];

        // 檢查是否被安全過濾器阻擋
        if (candidate.finishReason === 'SAFETY') {
            console.log('Response blocked by safety filter');
            return '抱歉，我無法回答這個問題。如有產品相關問題，歡迎透過[聯絡表單](https://www.liqui-moly-tw.com/contact)與我們聯繫。';
        }

        // 正常回應
        if (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) {
            return candidate.content.parts[0].text;
        }
    }

    // 如果沒有正常回應，記錄詳細錯誤並返回友善訊息
    console.error('Unexpected Gemini response:', JSON.stringify(data));
    return '抱歉，我暫時無法處理這個問題。您可以換個方式詢問，或透過[聯絡表單](https://www.liqui-moly-tw.com/contact)與我們聯繫。';
}
