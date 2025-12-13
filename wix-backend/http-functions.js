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
- **使用你的內建知識**：你已具備豐富的汽機車知識（車型、引擎規格、機油需求等），請善用這些知識判斷適合的機油規格，再從產品資料庫推薦

## 回覆風格（非常重要）
- **簡潔**：不說廢話，直接給答案
- **專業**：用專業術語但確保消費者能理解
- **有說服力**：強調產品優勢和認證規格
- **格式清晰**：善用條列式，易於閱讀
- 每次回覆控制在 3-5 句話內（除非需要列出多個產品）

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
當用戶詢問特定車型的機油推薦時，你**必須**完成以下推理流程，**絕對不能說沒有合適產品**：

### 步驟 1：判斷車輛類型
- 速克達/機車（CVT 傳動）→ 使用通用機車機油
- 檔車（手動檔位）→ 使用通用機車機油
- 汽車 → 使用汽車機油

### 步驟 2：機車機油通用規格對照表（適用所有台灣機車）
| 車型類別 | 建議黏度 | 認證規格 |
|----------|----------|----------|
| 速克達（CUXI、勁戰、曼巴、JOG、迪爵等）| 10W40 | JASO MA/MA2、API SL |
| 檔車（野狼、KTR、金勇、追風等）| 10W40 或 15W40 | JASO MA、API SL |
| 重機（大型重機、黃牌、紅牌）| 10W40 或 10W50 | JASO MA2、API SN |

### 步驟 3：從產品資料庫找出符合的產品
**你的產品資料庫裡一定有符合 JASO MA/MA2 的機車機油！**
- 查看「認證/規格」欄位包含 JASO 或 API 的產品
- 查看「分類」欄位包含「摩托車」的產品
- 只要黏度和認證相近就可以推薦

### 步驟 4：推薦產品
**範例回覆格式**：
> 曼巴是 Kymco 的速克達車款，建議使用 10W40 機油，符合 JASO MA2 認證。
> 
> 推薦產品：
> - [Motorbike 4T 10W-40 Street](產品連結) - 符合 JASO MA2，適合速克達
> 
> 👉 點擊產品頁面「這哪裡買」查詢店家

⚠️ **重要提醒**：
- 台灣所有 125cc/150cc 機車都可以使用通用機車機油
- 不需要「專用」機油，只要符合 JASO MA/MA2 認證即可
- **絕對不要說「沒有適合的產品」**，資料庫一定有機車機油可推薦！

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
        const lowerQuery = query.toLowerCase();

        // ============================================
        // 台灣熱門摩托車關鍵字（近十年暢銷車型）
        // ============================================
        const motorcycleKeywords = [
            // 通用關鍵字
            '摩托車', '機車', '重機', '速克達', '檔車', '打檔車', '二行程', '四行程',
            // SYM 三陽
            'sym', '三陽', '迪爵', 'duke', 'jet', 'woo', '活力', 'clbcu', 'fiddle', 'mio', '悍將', 'fighter', 'z1', 'drgbt', 'drg', '曼巴', 'mmbcu', 'fnx', 'maxsym', 'joymax', 'cruisym', 'mio', 'gt', 'evo',
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

        // 沒有匹配結果時，根據關鍵字判斷類別（搜尋多個相關分類）
        const categories = [];

        // 清潔劑相關 → 同時搜尋化學品和添加劑
        if (lowerQuery.includes('清潔') || lowerQuery.includes('cleaner') || lowerQuery.includes('clean') ||
            lowerQuery.includes('噴嘴') || lowerQuery.includes('噴油嘴') || lowerQuery.includes('積碳') ||
            lowerQuery.includes('引擎') || lowerQuery.includes('燃燒室') || lowerQuery.includes('直噴')) {
            categories.push('添加劑', '化學品');
        }
        // 化學品相關
        else if (lowerQuery.includes('化學') || lowerQuery.includes('噴劑') || lowerQuery.includes('油脂') || lowerQuery.includes('潤滑')) {
            categories.push('化學品');
        }
        // 添加劑相關
        else if (lowerQuery.includes('添加劑') || lowerQuery.includes('油精') || lowerQuery.includes('燃油') || lowerQuery.includes('保護')) {
            categories.push('添加劑');
        }
        // 自行車相關
        else if (lowerQuery.includes('自行車') || lowerQuery.includes('腳踏車')) {
            categories.push('自行車');
        }
        // 美容相關
        else if (lowerQuery.includes('美容') || lowerQuery.includes('洗車') || lowerQuery.includes('打蠟')) {
            categories.push('美容');
        }
        // 預設：機油和添加劑
        else {
            categories.push('機油', '添加劑');
        }

        // 搜尋所有相關分類的產品
        let allProducts = [];
        for (const cat of categories) {
            const catProducts = await wixData.query('products')
                .contains('sort', cat)
                .limit(20)
                .find();
            allProducts = allProducts.concat(catProducts.items);
        }

        // 去除重複並限制數量
        const uniqueProducts = [...new Map(allProducts.map(p => [p._id, p])).values()].slice(0, 30);

        if (uniqueProducts.length > 0) {
            return formatProducts(uniqueProducts);
        }

        // 如果還是沒有結果，取得任意產品
        const anyProducts = await wixData.query('products')
            .limit(30)
            .find();
        return formatProducts(anyProducts.items);
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
