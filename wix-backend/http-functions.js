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

## 你的身份
- 你代表台灣總代理宜福工業提供專業客戶服務
- 你是產品專家，回覆簡潔有力、直接切入重點
- 你具備豐富的汽機車知識，能根據車型推理適合的機油規格

## 回覆風格（非常重要）
- **簡潔**：不說廢話，直接給答案
- **專業**：用專業術語但確保消費者能理解
- **有說服力**：強調產品優勢和認證規格
- **格式清晰**：善用條列式，易於閱讀
- 每次回覆控制在 3-5 句話內（除非需要列出多個產品）

## 🧠 推理邏輯（非常重要）
當用戶詢問特定車型的機油推薦時，請使用以下推理流程：

1. **分析車型**：使用你的汽機車知識判斷該車型適合的機油規格
   - 例如：野狼 125cc 檔車 → 傳統氣冷引擎 → 建議 10W40 或 15W40
   - 例如：CUXI 速克達 → CVT 傳動 → 建議 10W40 全合成或半合成

2. **判斷規格**：根據車型判斷適合的黏度和認證
   - 機車常見：JASO MA/MA2、API SL/SM
   - 汽車常見：ACEA C3、BMW LL-04、VW 504.00 等

3. **匹配產品資料庫**：從「可用產品資料庫」中找出符合規格的產品
   - 查看產品的「認證/規格」欄位
   - 查看產品的「黏度」欄位

4. **推薦產品**：提供產品名稱、適合的原因，並附上產品連結

⚠️ 即使車型比較冷門，也要盡量推薦適合的產品，不要輕易說「沒有適合的產品」！

## 核心職責
1. 根據車型推薦合適的機油（汽車、摩托車皆可）
2. 解答產品使用方式
3. 引導購買正品公司貨

## 產品類別
- 汽車機油、摩托車機油
- 添加劑（油精、燃油添加劑）
- 化學品（清潔劑、保養品）

## ⚠️ 產品推薦規則（必遵守）
- **必須**使用「可用產品資料庫」中的「產品連結」
- 連結格式：[產品名稱](https://www.liqui-moly-tw.com/products/lmXXXX)
- **禁止**編造連結或使用其他網域

## 標準回覆範本

### 推薦產品時
> 針對您的 [車型]，推薦：
> - [產品名稱](連結) - 符合 XX 認證，適合 XX 引擎
> 
> 👉 點擊產品頁面「這哪裡買」可查詢鄰近店家

### 購買管道問題
> 請使用產品頁面的「這哪裡買」功能，或填寫[聯絡表單](https://www.liqui-moly-tw.com/contact)。

### 電商平台問題
> 電商平台非公司貨，無品質保證。建議透過官方管道購買。

## 禁止事項
- 不推薦非 LIQUI MOLY 產品
- 不承諾價格或促銷
- 不編造產品資訊`;

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
        const lowerQuery = query.toLowerCase();

        // ============================================
        // 台灣熱門摩托車關鍵字（近十年暢銷車型）
        // ============================================
        const motorcycleKeywords = [
            // 通用關鍵字
            '摩托車', '機車', '重機', '速克達', '檔車', '打檔車', '二行程', '四行程',
            // SYM 三陽
            'sym', '三陽', '迪爵', 'duke', 'jet', 'woo', '活力', 'clbcu', 'fiddle', 'mio', '悍將', 'fighter', 'z1', 'drgbt', 'drg',
            // Kymco 光陽
            'kymco', '光陽', '名流', 'many', 'gp', 'racing', '雷霆', 'g6', 'kru', 'romeo', '勁多利', 'g5', 'g3', 'a-going', '酷龍', 'nikita', 'ak550', 'downtown',
            // Yamaha 山葉
            'yamaha', '山葉', 'jog', 'cuxi', 'cygnus', '勁戰', '四代戰', '五代戰', '六代戰', 'bws', 'force', 'smax', 'xmax', 'tmax', 'nmax', 'r3', 'r6', 'r15', 'r1', 'mt-03', 'mt-07', 'mt-09', 'mt-15', 'yzf', 'fz', 'fzr', 'fzs', 'tricity', 'limi',
            // Honda 本田
            'honda', '本田', 'pcx', 'dio', 'vario', 'click', 'cb', 'cbr', 'cb650r', 'cb300r', 'nc750', 'adv', 'forza', 'goldwing', 'rebel',
            // 其他品牌
            'kawasaki', 'suzuki', 'vespa', 'piaggio', 'ktm', 'aeon', 'pgo', 'aprilia', 'ducati', 'bmw', 'harley', 'indian', 'triumph',
            // Gogoro 電動車
            'gogoro', 'jego', 'viva', 'supersport', 'delight', 'smartscooter', '電動機車',
            // 經典檔車
            '野狼', 'wolf', 'ktr', '金勇', '追風', '愛將', 'nsr', 'rgv', 'tzr', 'rz', 'ninja', 'z400', 'z650', 'z900', 'versys', 'z1000'
        ];

        // ============================================
        // 台灣熱門汽車關鍵字（近十年暢銷車型）
        // ============================================
        const carKeywords = [
            // 通用關鍵字
            '汽車', '轎車', '休旅車', 'suv', '跑車', '房車', '掀背', 'mpv', '商用車',
            // Toyota 豐田
            'toyota', '豐田', 'corolla', 'altis', 'cross', 'rav4', 'camry', 'yaris', 'vios', 'sienna', 'sienta', 'prius', 'crown', 'supra', 'gr86', 'town ace', 'hiace', 'hilux', 'land cruiser',
            // Lexus
            'lexus', 'nx', 'rx', 'es', 'ux', 'ls', 'lc', 'is', 'ct', 'gx', 'lx',
            // Honda 本田
            'hr-v', 'cr-v', 'fit', 'city', 'civic', 'accord', 'odyssey', 'nsx',
            // Mazda 馬自達
            'mazda', '馬自達', 'mazda3', 'mazda6', 'cx-3', 'cx-30', 'cx-5', 'cx-60', 'cx-9', 'mx-5',
            // Nissan 日產
            'nissan', '日產', '裕隆', 'sentra', 'tiida', 'kicks', 'x-trail', 'juke', 'murano', 'leaf', 'gt-r', '370z',
            // Mitsubishi 三菱
            'mitsubishi', '三菱', 'outlander', 'eclipse', 'colt', 'delica', 'zinger', 'lancer', 'fortis',
            // Hyundai 現代
            'hyundai', '現代', 'tucson', 'santa fe', 'kona', 'venue', 'elantra', 'ioniq', 'custin',
            // Kia 起亞
            'kia', '起亞', 'sportage', 'picanto', 'stonic', 'ev6', 'carnival', 'sorento',
            // Ford 福特
            'ford', '福特', 'focus', 'kuga', 'escape', 'mondeo', 'ranger', 'mustang',
            // Volkswagen 福斯
            'volkswagen', 'vw', '福斯', 'golf', 'tiguan', 'touran', 'passat', 't-cross', 't-roc', 'arteon', 'id.4',
            // BMW
            'bmw', 'x1', 'x3', 'x5', 'x7', '3系列', '5系列', '7系列', 'm3', 'm4', 'm5', 'ix',
            // Mercedes-Benz 賓士
            'benz', 'mercedes', '賓士', 'a-class', 'c-class', 'e-class', 's-class', 'gla', 'glb', 'glc', 'gle', 'gls', 'amg', 'eqe', 'eqs',
            // Audi 奧迪
            'audi', '奧迪', 'a1', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'q2', 'q3', 'q5', 'q7', 'q8', 'e-tron',
            // Porsche 保時捷
            'porsche', '保時捷', 'cayenne', 'macan', 'panamera', '911', 'taycan', 'boxster', 'cayman',
            // Volvo
            'volvo', 'xc40', 'xc60', 'xc90', 's60', 's90', 'v60',
            // 中華汽車
            '中華', 'j space', 'zinger', 'veryca',
            // Subaru 速霸陸
            'subaru', '速霸陸', 'forester', 'outback', 'xv', 'wrx', 'brz', 'levorg',
            // Tesla 特斯拉
            'tesla', '特斯拉', 'model 3', 'model y', 'model s', 'model x'
        ];

        const isMotorcycleQuery = motorcycleKeywords.some(keyword => lowerQuery.includes(keyword));
        const isCarQuery = carKeywords.some(keyword => lowerQuery.includes(keyword));

        // 如果是摩托車相關查詢，優先搜尋摩托車產品
        if (isMotorcycleQuery && !isCarQuery) {
            const motorcycleProducts = await wixData.query('products')
                .contains('sort', '摩托車')
                .limit(20)
                .find();

            if (motorcycleProducts.items.length > 0) {
                return formatProducts(motorcycleProducts.items);
            }
        }

        // 如果是汽車相關查詢，優先搜尋汽車機油
        if (isCarQuery && !isMotorcycleQuery) {
            const carProducts = await wixData.query('products')
                .contains('sort', '汽車')
                .contains('sort', '機油')
                .limit(20)
                .find();

            if (carProducts.items.length > 0) {
                return formatProducts(carProducts.items);
            }
        }

        // 搜尋所有相關欄位
        const results = await wixData.query('products')
            .contains('title', query)
            .or(wixData.query('products').contains('content', query))
            .or(wixData.query('products').contains('cert', query))
            .or(wixData.query('products').contains('word2', query))
            .or(wixData.query('products').contains('sort', query))
            .limit(20)
            .find();

        if (results.items.length > 0) {
            return formatProducts(results.items);
        }

        // 沒有匹配結果時，根據關鍵字判斷類別
        let category = '';

        if (lowerQuery.includes('化學') || lowerQuery.includes('清潔') || lowerQuery.includes('噴劑') || lowerQuery.includes('油脂') || lowerQuery.includes('潤滑')) {
            category = '化學品';
        } else if (lowerQuery.includes('添加劑') || lowerQuery.includes('油精') || lowerQuery.includes('燃油')) {
            category = '添加劑';
        } else if (lowerQuery.includes('自行車') || lowerQuery.includes('腳踏車')) {
            category = '自行車';
        } else if (lowerQuery.includes('美容') || lowerQuery.includes('洗車') || lowerQuery.includes('打蠟')) {
            category = '美容';
        } else {
            category = '機油'; // 預設分類
        }

        const categoryProducts = await wixData.query('products')
            .contains('sort', category)
            .limit(15)
            .find();

        // 如果還是沒有結果，取得任意產品
        if (categoryProducts.items.length === 0) {
            const anyProducts = await wixData.query('products')
                .limit(20)
                .find();
            return formatProducts(anyProducts.items);
        }

        return formatProducts(categoryProducts.items);
    } catch (error) {
        console.error('Product search error:', error);
        return '無法取得產品資料';
    }
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
        generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
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

    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts;
        if (parts && parts[0] && parts[0].text) {
            return parts[0].text;
        }
    }

    throw new Error('Invalid response from Gemini API');
}
