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
| 車廠 | 常見認證 |
|------|----------|
| BMW | BMW LL-04、BMW LL-01 |
| Mercedes-Benz | MB 229.51、MB 229.52 |
| VW/Audi/Porsche | VW 504.00/507.00 |
| 一般日系車 | API SP/SN、ACEA A3/B4 |
| 柴油車 | ACEA C3 |

#### 機車常見認證對照：
| 車型類別 | 黏度 | 認證 |
|----------|------|------|
| 速克達（CVT）| 10W40 | JASO MB |
| 檔車（濕式離合器）| 10W40 | JASO MA/MA2 |
| 重機 | 10W40/10W50 | JASO MA2 |

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

### 合作洽詢（保修廠、車行、經銷商、業務、代理、進貨、批發、合作等）
> 感謝您對 LIQUI MOLY 的興趣！
> 
> 請填寫我們的[合作洽詢表單](https://www.liqui-moly-tw.com/cooperate)，專人將盡速與您聯繫洽談合作事宜。

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

## 🔧 常見車廠認證對照表（幫助推薦產品）
| 車廠認證 | 適用車系 |
|----------|----------|
| BMW LL-04 | BMW 柴油車 |
| BMW LL-01 | BMW 汽油車 |
| MB 229.51/229.52 | Mercedes-Benz |
| VW 504.00/507.00 | VW/Audi/Skoda/Seat |
| ACEA C3 | 歐系柴油車通用 |
| ACEA A3/B4 | 歐系汽油車通用 |
| JASO MA/MA2 | 機車專用 |
| API SP/SN | 美系、日系汽油車 |

## 禁止事項
- 不推薦非 LIQUI MOLY 產品
- 不承諾價格或促銷
- 不編造產品資訊
- 不提供團購服務（總代理是 B2B 業務）`;

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

        // 查詢相關產品
        let productContext = "目前沒有產品資料";
        try {
            productContext = await searchProducts(body.message);
        } catch (e) {
            console.error('Product search failed:', e);
        }

        // 建構對話內容
        const contents = buildContents(body.message, conversationHistory, productContext);

        // 呼叫 Gemini API
        const aiResponse = await callGemini(apiKey, contents);

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
        if (queryLower.includes('機車') || queryLower.includes('摩托') || queryLower.includes('速克達') ||
            queryLower.includes('檔車') || queryLower.includes('重機') || queryLower.includes('motorbike')) {
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

// 從查詢中提取有意義的關鍵字
function extractKeywords(query) {
    // 移除常見無意義詞彙
    const stopWords = ['的', '我', '我的', '你', '推薦', '用', '嗎', '可以', '什麼', '哪個', '有沒有', '一下', '請問', '想', '要', '需要'];

    // 提取產品相關關鍵字
    const productKeywords = [];

    // 提取產品編號
    const partnoMatch = query.match(/lm\d+/gi);
    if (partnoMatch) {
        productKeywords.push(...partnoMatch);
    }

    // 提取英文關鍵字
    const englishWords = query.match(/[a-zA-Z]{2,}/g);
    if (englishWords) {
        productKeywords.push(...englishWords.map(w => w.toLowerCase()));
    }

    // 提取中文關鍵字（移除停用詞）
    const cleanedQuery = query.replace(/[a-zA-Z0-9\s]+/g, '');
    const chineseChars = cleanedQuery.split('').filter(char => !stopWords.some(sw => sw.includes(char)));

    // 提取常見產品類型關鍵字
    const productTypes = ['機油', '煞車油', '剎車油', '冷卻液', '水箱精', '鏈條油', '齒輪油', '添加劑', '油精', '清潔劑',
        '方向機油', '變速箱油', '煞車', '機車', '汽車', '摩托車', '速克達', '檔車', '重機'];
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
