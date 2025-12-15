/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題，判斷車型類別和需要的規格
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, conversationHistory = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Missing message parameter' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key not configured' });
        }

        const result = await analyzeUserQuery(apiKey, message, conversationHistory);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({ success: true, analysis: result });

    } catch (error) {
        console.error('Analyze API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// AI 分析用戶問題
async function analyzeUserQuery(apiKey, message, conversationHistory = []) {
    // 建構對話上下文摘要
    let contextSummary = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-4);
        contextSummary = '對話上下文（以此推斷車型）：\n' + recentHistory.map(m =>
            `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 100)}...`
        ).join('\n') + '\n\n';
    }

    const analysisPrompt = `你是一個汽機車專家和產品顧問。你擁有豐富的車輛知識，包括各品牌車款的原廠機油規格。
請分析用戶的問題，**利用你的內建知識** 判斷該車型需要的機油認證和黏度。

${contextSummary}用戶當前問題：「${message}」

請只返回一個 JSON 對象，格式如下：
{
    "isMultiVehicleQuery": false,
    "vehicles": [{
        "vehicleName": "2022 KIA Sportage 1.6",
        "vehicleType": "汽車",
        "vehicleSubType": "未知",
        "isElectricVehicle": false,
        "certifications": ["API SP"],
        "viscosity": "0W-20",
        "searchKeywords": ["0W-20", "API SP", "Special Tec"]
    }],
    "productCategory": "機油",
    "productSubCategory": "",
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}

**多車型查詢支援 (Multi-Vehicle Query) - 重要！**
- 若用戶同時詢問多種車型（如「BMW X3 和 Toyota Camry 分別推薦什麼機油？」），設定 "isMultiVehicleQuery": true
- 在 "vehicles" 陣列中為每個車型分別填入規格：
  - "vehicleName": 車型名稱（用於顯示給用戶）
  - "vehicleType", "certifications", "viscosity", "searchKeywords": 該車型的規格
- 範例：
  {
    "isMultiVehicleQuery": true,
    "vehicles": [
      { "vehicleName": "BMW X3 2020", "vehicleType": "汽車", "certifications": ["BMW LL-01"], "viscosity": "5W-30", "searchKeywords": ["5W30", "LL-01", "Top Tec"] },
      { "vehicleName": "Toyota Camry 2022", "vehicleType": "汽車", "certifications": ["API SP"], "viscosity": "0W-20", "searchKeywords": ["0W-20", "API SP", "Special Tec AA"] }
    ],
    "productCategory": "機油",
    "needsProductRecommendation": true
  }
- 若只有一個車型，設定 "isMultiVehicleQuery": false，"vehicles" 陣列只放一個物件即可。

說明與規則：

0. **🧠 車型規格推理 (Vehicle Spec Inference) - 最重要！**
   - 當用戶提供車型+年份時，**必須利用你的內建知識** 推理該車需要的機油規格！
   - 填入 "certifications" 欄位：該車原廠建議的認證 (如 API SP, ILSAC GF-6A, ACEA C3, BMW LL-04 等)
   - 填入 "viscosity" 欄位：該車原廠建議的黏度 (如 0W-20, 5W-30, 5W-40 等)
   - 填入 "searchKeywords" 欄位：用 certifications + viscosity + 產品系列名 組合搜尋
   - **範例**：
     - 用戶問「2022 KIA Sportage 1.6 汽油」
       - 你知道這款車原廠建議 API SP / ILSAC GF-6A，黏度 0W-20 或 5W-30
       - certifications: ["API SP", "ILSAC GF-6A"]
       - viscosity: "0W-20"
       - searchKeywords: ["0W-20", "0W20", "API SP", "Special Tec", "Top Tec 6300"]
     - 用戶問「2020 BMW X3 xDrive30i」
       - 你知道 BMW 需要 LL-01 或 LL-04 認證
       - certifications: ["BMW LL-01", "BMW LL-04"]
       - viscosity: "5W-30"
       - searchKeywords: ["5W30", "LL-01", "LL-04", "Top Tec 4200", "Top Tec 6600"]
     - 用戶問「2023 Lexus NX 350」
       - 你知道 Toyota/Lexus 新車需要 ILSAC GF-6A，黏度 0W-20
       - certifications: ["ILSAC GF-6A", "API SP"]
       - viscosity: "0W-20"
       - searchKeywords: ["0W-20", "0W20", "GF-6", "Special Tec AA", "Top Tec 6610"]
   - **如果你不確定該車型規格，請根據車系和年份做合理推測**：
     - 亞洲車 (日系/韓系) 2018+ -> 通常 API SP / ILSAC GF-6, 0W-20 或 5W-30
     - 歐系車 -> 通常有車廠認證 (BMW LL, MB 229.X, VW 504/507)
     - 美系車 -> 通常 API SP / SN, 5W-20 或 5W-30

1. **上下文繼承 (Context Inheritance - CRITICAL)**
   - 如果當前問題很短（如「那機油呢？」、「是」），**必須**回溯上方對話紀錄找到車型與**認證規格**。
   - 如果之前提過 "JET", "勁戰", "DRG"，那麼 vehicleSubType **必須** 填入 "速克達"。
   - 如果之前提過 "CBR", "R15", "Ninja"，那麼 vehicleSubType **必須** 填入 "檔車"。
   - **一旦車型確定，除非用戶明確換車，否則後續所有搜尋都必須保留該車型設定。**
   - **關鍵：若歷史紀錄中提及特定認證（如 948B, LL-04, 504/507），務必將其加入 searchKeywords！**

2. **vehicleType (車型判斷)**
   - "摩托車"：出現 機車、摩托車、重機、檔車、速克達、跑山、
     以及熱門車款：JET, 勁戰, MMBCU, DRG, Force, SMAX, BWS, Cygnus, RCS, Racing, RomaGT, RTS, KRV, Like, Many, Nice, Woo, Vivo, Fiddle, Saluto, Swish, Access, Address, Vespa, JBUBU, Tigra, Spring, 4MICA, KRN, Dollar, Augur
   - "船舶"：出現 船, Marine, Boat, Yacht, 艦艇, 遊艇, 船外機, Outboard, Inboard, Jet Ski, 水上摩托車
   - "自行車"：出現 自行車, 腳踏車, 單車, Bike, Bicycle, MTB, 公路車, 登山車
   - "汽車"：預設值，或出現 汽車, 轎車, SUV, MPV, 卡車, 跑車
     以及熱門車款：Toyota, Altis, Corolla Cross, RAV4, Yaris, Vios, Camry, Town Ace, Honda, CRV, HRV, Fit, Civic, Ford, Kuga, Focus, Nissan, X-Trail, Kicks, Sentra, Lexus, NX, RX, UX, LBX, ES, Mazda, CX-5, CX-30, Mazda3, Benz, GLC, C-Class, E-Class, A-Class, BMW, X3, X4, X1, 3 Series, 5 Series, Volvo, XC40, XC60, Hyundai, Tucson, Custin, Kia, Sportage, MG, HS, ZS

2.5 **isElectricVehicle (電動車偵測) - 極重要！**
   - 若出現以下關鍵字，必須設為 true：
     - 電動機車：Gogoro, Ai-1, Ur-1, eMoving, eReady, PBGN, Ionex, 電動機車, 電動速克達
     - 電動汽車：Tesla, Model Y, Model 3, Model S, Model X, EV, 電動車, 純電, BEV, Rivian, Lucid, 極氪, 小鵬, 蔚來
     - 油電混合 (Hybrid)：注意 Hybrid/HEV/PHEV 仍需機油，不算純電動車！
   - 若 isElectricVehicle = true 且用戶只問機油：
     - needsProductRecommendation 設為 false
     - 在 searchKeywords 加入 "電動車不需機油" 作為標記

3. **productCategory (產品主類別)**
   - "添加劑"：Additives, 油精, 快樂跑, 清潔燃油, 通油路, Shooter, Engine Flush, 汽門, 除碳, MOS2, Ceratec
   - "機油"：Motor Oil, 機油, 潤滑油, 5W30, 10W40, 0W20 (若沒特別指添加劑)
   - "美容" (Detailing)：洗車, 打蠟, 鍍膜, 清潔劑, 洗鍊條, 皮革, 塑料, 內裝, 玻璃, 雨刷水, 鐵粉, 柏油, 海綿, 布, Shampoo, Wax, Polish
   - "化學品" (Chemicals)：煞車油 (Brake Fluid), 水箱精 (Coolant), 動力方向油 (Power Steering), 雨刷精, 電瓶水, 噴油嘴清潔
   - "變速箱"：變速箱油, ATF, 齒輪油, Gear Oil, DCT, CVT, Transmission
   - "鏈條"：鏈條, 鍊條, Chain, Lube, 乾式, 濕式, 鍊條油, 鏈條清洗
   - "船舶"：船用機油, 2T, 4T, Marine Oil, Gear Lube
   - "自行車"：單車保養, Bike Lube, Bike Cleaner
   
4. **isGeneralProduct (通用產品判定)**
   - **必填 true**：當類別為「美容」、「化學品」、「清潔」時 (除非明確指定是摩托車專用，如"重機鍊條油")。
   - **必填 true**：煞車油、水箱精、洗手膏、雨刷水通常不分車種。
   
5. **searchKeywords (關鍵字 - 自動化搜尋的核心)**
   - 請提供 **3-5 個** 不同的關鍵字，用於資料庫廣泛搜尋。
   - 包含：中文名稱、英文名稱 (重要!)、同義詞、德文名稱 (若知道)。
   - **👉 症狀轉產品全集 (Universal Symptom Mapping) - CRITICAL!**
     - **[引擎/機油系統]**
       - 吃機油/排藍煙/機油少 -> 搜 "Viscoplus", "Oil Saver", "Motor Oil Saver"
       - 引擎漏油/地上有油漬 -> 搜 "Oil Leak", "Stop Leak", "止漏"
       - 引擎異音/磨損/保護 -> 搜 "Cera Tec", "MOS2", "Oil Additive", "Anti Friction"
       - 油泥/太久沒換油 -> 搜 "Engine Flush", "Oil Sludge"
       - 冒白煙 (水箱水跑到引擎) -> (通常需維修) 搜 "Radiator Stop Leak" (死馬當活馬醫)
     - **[燃油/燃燒系統]**
       - 冒黑煙/耗油/驗車不過 (柴油) -> 搜 "Diesel Purge", "Super Diesel", "Smoke Stop", "燃油", "積碳"
       - 冒黑煙/耗油/驗車不過 (汽油) -> 搜 "Injection Cleaner", "Valve Clean", "Catalytic", "燃油", "積碳"
       - 引擎無力/加速遲緩 -> 搜 "Injection Cleaner", "Valve Clean", "Speed Tec", "Fuel System", "油精"
       - 難發動/怠速不穩 -> 搜 "Injection Cleaner", "Valve Clean", "Carburetor", "怠速"
       - 柴油車DPF阻塞 -> 搜 "DPF", "Diesel Particulate"
     - **[變速箱/動力方向/冷卻]**
       - 換檔頓挫/打滑 (汽車) -> 搜 "ATF Additive", "Gear Oil Additive", "自排"
       - 換檔頓挫/不順 (機車) -> 搜 "Gear Oil", "Motorbike Oil Additive", "4T Additive", "Shooter", "齒輪"
       - 變速箱漏油 -> 搜 "Transmission Stop Leak", "漏油"
       - 方向盤重/漏油 -> 搜 "Power Steering Oil Leak", "方向盤"
       - 水箱漏水 -> 搜 "Radiator Stop Leak", "止漏"
       - 水溫高/水垢 -> 搜 "Radiator Cleaner", "Coolant", "水箱精"
     - **[外觀美容/內裝]**
       - 柏油/瀝青 -> 搜 "Tar Remover", "柏油"
       - 鐵粉/粗糙 -> 搜 "Wheel Cleaner", "鐵粉"
       - 塑料白化 -> 搜 "Plastic Restorer", "Plastic Deep", "塑料"
       - 車內異味/煙味 -> 搜 "Climate Fresh", "AC System Cleaner", "除臭"
       - 皮革龜裂 -> 搜 "Leather Care", "皮革"
     - **[船舶/自行車/通用]**
       - 船外機保養 -> 搜 "Marine Oil", "Gear Lube", "4T", "2T", "船"
       - 鹽分腐蝕/防鏽/卡死 -> 搜 "LM 40", "Multi-Spray", "Marine Grease", "Rust", "防鏽", "潤滑"
       - 鍊條異音/生鏽 -> 搜 "Chain Lube", "Chain Cleaner", "Bike Lube", "LM 40", "鍊條"
       - 煞車異音 (單車) -> 搜 "Brake Cleaner", "煞車"
       - 電子接點氧化 -> 搜 "Electronic Spray", "LM 40", "接點"
   - 當找特定認證 (948B) 時，同時提供拆解版本 ["948B", "948", "948-B"]。
   - **⚠️ 注意車種差異**：
     - 若 'vehicleType' 是「摩托車」，嚴禁搜尋 "ATF Additive", "Hybrid Additive" 等汽車專用詞。
     - 若 'vehicleType' 是「汽車」，嚴禁搜尋 "Scooter", "Shooter" (除非是 Gasoline Shooter), "4T Additive"。
   - **🚗 汽車機油通用搜尋 (Default Car Oil Keywords) - 極重要！**
     - 若 vehicleType 是「汽車」且 productCategory 是「機油」，且用戶沒有明確症狀：
     - **必須** 在 searchKeywords 中加入以下通用關鍵字：
       - 黏度相關：["5W30", "5W40", "0W20", "0W30"] (根據車型年份選擇)
       - 產品系列：["Top Tec", "Special Tec", "Molygen", "Leichtlauf"]
       - 認證相關：["API SP", "ACEA"] (根據車系選擇)
     - 範例：用戶問 "2022 KIA Sportage 1.6 汽油"
       - 推薦 searchKeywords: ["5W30", "5W40", "Top Tec", "Special Tec", "API SP", "ACEA A3"]
   - **🏍️ 機車機油通用搜尋 (Default Motorcycle Oil Keywords)**
     - 若 vehicleType 是「摩托車」且 productCategory 是「機油」：
       - 速克達 -> ["10W40", "Scooter", "JASO MB", "Motorbike 4T"]
       - 檔車/重機 -> ["10W40", "10W50", "JASO MA", "Street", "Race"]

5. 只返回 JSON，不要其他文字。`;

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

        if (!response.ok) {
            console.error('AI analysis API error:', response.status);
            return null;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // 嘗試解析 JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const result = JSON.parse(jsonMatch[0]);

                // ============================================
                // 🛑 強制上下文補救 (Rule-based Context Override)
                // ============================================
                try {
                    // 只有當 AI 沒有明確判斷為其他特定車種時，才執行歷史回溯補救
                    // 避免用戶問「那汽車呢？」時，因歷史紀錄有 JET 而被強制改回摩托車
                    const explicitTypes = ['汽車', '船舶', '自行車'];
                    // 注意：如果 AI 預設回傳 "汽車" (可能是因為用戶只說 "機油"), 我們需要檢查是否誤判
                    const isDefaultCar = result.vehicleType === '汽車';

                    // 檢查用戶是否「顯式切換」回汽車 (如：那汽車呢？ 或 那 Altis 呢？)
                    // 如果用戶當前這句話包含汽車關鍵字，或者 AI 已經明確識別出具體車款(如 Altis)，絕對不要回溯歷史改成機車！
                    const isExplicitKeyword = ['汽車', 'car', 'auto', '轎車', '四輪', 'passenger'].some(k => message.toLowerCase().includes(k));
                    const isSpecificCarModel = result.vehicleType === '汽車' && result.vehicleSubType && result.vehicleSubType !== '未知';
                    const isExplicitCarSwitch = isExplicitKeyword || isSpecificCarModel;

                    if ((!explicitTypes.includes(result.vehicleType) || isDefaultCar) && !isExplicitCarSwitch) {
                        const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();

                        // 1. 檢查速克達/摩托車/重機/檔車 (2025 台灣主流車款庫)
                        const scooterKeywords = [
                            // SYM
                            'jet', 'sl', 'sr', 'sl+', 'drg', 'mmbcu', '4mica', 'fiddle', 'clbc', 'woo', 'vivo', 'z1', 'duke', '迪爵', 'krn', 'ttlbt',
                            // KYMCO
                            'kymco', 'racing', 'rcs', 'roma', 'romagt', 'rts', 'krv', 'like', 'colombo', 'many', 'nice', 'gp', 'freeway', '大地名流', 'dollar', 'ionex',
                            // YAMAHA
                            'yamaha', 'cygnus', 'gryphus', '勁戰', 'force', 'smax', 'augur', 'bws', 'vino', 'limi', 'jog', 'rs neo', 'mt-15', 'r15', 'r3', 'r7', 'mt-03', 'mt-07', 'mt-09', 'xmax', 'tmax',
                            // SUZUKI / PGO / AEON
                            'suzuki', 'saluto', 'swish', 'sui', 'address', 'access', 'gsx', 'pgo', 'jbubu', 'tigra', 'spring', 'ur1', 'aeon', 'ai-1', 'ai-2', 'str',
                            // OTHERS
                            'gogoro', 'emoving', 'vespa', 'scooter', 'motorcycle', 'motorbike', '重機', '檔車', '速克達', '跑山', '環島', '騎', '2t', '4t'
                        ];
                        if (scooterKeywords.some(kw => historyText.includes(kw))) {
                            console.log('Context Override: Detected Scooter keyword in history! Forcing Scooter mode.');
                            result.vehicleType = '摩托車';
                            if (!result.vehicleSubType || result.vehicleSubType === '未知' || !result.vehicleSubType.includes('速克達')) {
                                result.vehicleSubType = (result.vehicleSubType || '') + ' 速克達';
                            }
                        }

                        // 2. 檢查船舶 (Marine)
                        const marineKeywords = ['船', 'marine', 'boat', 'yacht', '艦艇', '遊艇', 'outboard', 'inboard', 'jet ski', '水上摩托車'];
                        if (marineKeywords.some(kw => historyText.includes(kw))) {
                            console.log('Context Override: Detected Marine keyword in history! Forcing Marine mode.');
                            result.vehicleType = '船舶';
                        }

                        // 3. 檢查自行車 (Bicycle)
                        const bikeKeywords = ['自行車', '腳踏車', '單車', 'bike', 'bicycle', 'mtb', 'road bike', 'cycling', '公路車', '登山車'];
                        if (bikeKeywords.some(kw => historyText.includes(kw))) {
                            console.log('Context Override: Detected Bicycle keyword in history! Forcing Bicycle mode.');
                            result.vehicleType = '自行車';
                        }
                    }
                } catch (e) {
                    console.error('Override error:', e);
                }

                // ============================================
                // 生成 Wix 查詢指令 (Logic moved from Wix to here!)
                // ============================================
                result.wixQueries = generateWixQueries(result, result.searchKeywords || [], message);

                return result;
            } catch (parseError) {
                console.error('JSON parse error:', parseError, 'Text:', text);
                return null;
            }
        }
        return null;
    } catch (e) {
        console.error('analyzeUserQuery error:', e);
        return null;
    }
}

// 根據 AI 分析結果，生成具體的 Wix Data Query 指令
function generateWixQueries(analysis, keywords, message = '') {
    const queries = [];
    const { vehicleType, productCategory, vehicleSubType } = analysis;
    const isBike = vehicleType === '摩托車';
    const isScooter = isBike && (
        (vehicleSubType && vehicleSubType.includes('速克達')) ||
        keywords.some(k => ['jet', '勁戰', 'drg', 'mmbcu', 'force', 'smax', 'scooter'].includes(k.toLowerCase()))
    );

    // === 大包裝搜尋邏輯 (Large Package Search) ===
    // 當用戶問「有大包裝嗎」、「4L」、「5L」等，同時有產品編號時
    // 需要額外搜尋產品名稱 (title) 以找到同系列不同容量的產品
    const largePackageKeywords = ['大包裝', '大公升', '4l', '5l', '20l', '經濟包', '大瓶', '大容量'];
    // 同時檢查原始用戶訊息和 AI 生成的 keywords
    const messageLower = message.toLowerCase();
    const isLargePackageQuery =
        largePackageKeywords.some(lpk => messageLower.includes(lpk)) ||
        keywords.some(kw => largePackageKeywords.some(lpk => kw.toLowerCase().includes(lpk)));

    // Helper to add query
    const addQuery = (field, value, limit = 20, method = 'contains') => {
        queries.push({ field, value, limit, method });
    };

    // === 策略 A: 摩托車添加劑 ===
    if (isBike && productCategory === '添加劑') {
        addQuery('sort', '【摩托車】添加劑', 30);
        addQuery('sort', '【摩托車】機車養護', 20);
        // Title backup
        queries.push({ field: 'title', value: 'Motorbike', limit: 30, method: 'contains', filterTitle: ['Additive', 'Shooter', 'Flush', 'Cleaner'] });
    }

    // === 策略 B: 摩托車機油 ===
    else if (isBike && productCategory === '機油') {
        if (isScooter) {
            // 速克達優先
            queries.push({ field: 'sort', value: '【摩托車】機油', limit: 20, method: 'contains', andContains: { field: 'title', value: 'Scooter' } });
            // 其他備選
            addQuery('sort', '【摩托車】機油', 30);
        } else {
            addQuery('sort', '【摩托車】機油', 50);
        }
    }

    // === 策略 C: 汽車添加劑 ===
    else if (!isBike && productCategory === '添加劑') {
        addQuery('sort', '【汽車】添加劑', 30);
    }

    // === 策略 D: 汽車機油 ===
    else if (!isBike && productCategory === '機油') {
        addQuery('sort', '【汽車】機油', 50);
    }

    // === 策略: 鏈條保養 ===
    else if (productCategory === '鏈條') {
        // 是否明確問「油」
        const isOilQuery = keywords.some(k => k.includes('油') || k.toLowerCase().includes('lube') || k.toLowerCase().includes('spray'));

        if (isOilQuery) {
            // 優先找潤滑油
            queries.push({ field: 'title', value: 'Lube', limit: 10, method: 'contains' });
            queries.push({ field: 'title', value: 'Spray', limit: 10, method: 'contains' });
            queries.push({ field: 'title', value: 'Chain', limit: 20, method: 'contains' });
        } else {
            // 一般鏈條 (可能包含清潔)
            queries.push({ field: 'title', value: 'Chain', limit: 30, method: 'contains' });
            queries.push({ field: 'title', value: '鏈條', limit: 20, method: 'contains' });
        }

        queries.push({ field: 'title', value: 'Ketten', limit: 20, method: 'contains' });
        // 最後才放這個大類別，作為補充
        addQuery('sort', '【摩托車】機車養護', 20);
    }

    // === 策略 E: 通用/清潔 ===
    else if (productCategory === '清潔' || productCategory === '美容') {
        addQuery('sort', '車輛美容', 30);
        addQuery('sort', '【汽車】空調', 10);
    }

    // === 策略 F: 船舶產品 ===
    else if (vehicleType === '船舶' || productCategory === '船舶') {
        addQuery('sort', '船舶', 30);
        addQuery('sort', 'Marine', 30);
        queries.push({ field: 'title', value: 'Marine', limit: 30, method: 'contains' });
        queries.push({ field: 'title', value: 'Boat', limit: 20, method: 'contains' });
    }

    // === 策略 G: 自行車產品 ===
    else if (vehicleType === '自行車' || productCategory === '自行車') {
        addQuery('sort', '自行車', 30);
        addQuery('sort', 'Bike', 30);
        queries.push({ field: 'title', value: 'Bike', limit: 30, method: 'contains' });
        queries.push({ field: 'title', value: 'Bicycle', limit: 20, method: 'contains' });
    }

    // === 策略 Z: 智慧動態搜尋 (Universal Smart Search) ===
    // 自動將 AI 建議的關鍵字轉換為查詢指令，不管用戶輸入什麼都能動態適應
    // 如果前面策略未命中(queries.length=0)，搜尋更多關鍵字(4個)；否則只搜前2個作為補充

    const priorityQueries = []; // 優先級最高的查詢 (會排在結果最前面)
    const maxKeywords = queries.length === 0 ? 4 : 2;
    // 簡單去重
    const uniqueKw = keywords.filter((v, i, a) => a.indexOf(v) === i);

    uniqueKw.slice(0, maxKeywords).forEach(kw => {
        if (!kw || kw.length < 2) return; // 跳過過短關鍵字

        // === 0. 產品編號直達車 (SKU Direct Search) ===
        // 檢查是否為產品編號格式：4-5位數字，或 LM 開頭接數字
        // 如：9047, LM9047, lm-9047
        const skuMatch = kw.match(/(?:lm|LM)?[- ]?(\d{4,5})/);
        if (skuMatch) {
            const skuNum = skuMatch[1];
            // 補全 LM 前綴進行精確匹配，避免搜到錯誤產品
            const fullSku = `LM${skuNum}`;
            console.log(`Detected SKU Keyword: ${kw} -> Searching PartNo: ${fullSku}`);
            // 使用 eq 精確匹配 partno，確保找到正確產品
            priorityQueries.push({ field: 'partno', value: fullSku, limit: 5, method: 'eq' });
            // 同時用 contains 作為備援（以防 partno 格式不一致）
            priorityQueries.push({ field: 'partno', value: skuNum, limit: 3, method: 'contains' });

            // === 大包裝搜尋擴展 (Large Package Search Extension) ===
            // 若用戶問「大包裝」，需要找同產品的大容量版本
            // 策略：同產品不同容量的 title 相同，但 partno 不同
            // 所以要額外搜尋 size 欄位找大容量產品
            if (isLargePackageQuery) {
                console.log(`Large package query detected for SKU: ${skuNum}`);

                // 從訊息中提取黏度 (如 5W-30, 10W-40)，用於搜尋同規格大容量產品
                const viscosityMatch = keywords.join(' ').match(/(\d+[Ww]-?\d+)/);
                if (viscosityMatch) {
                    const viscosity = viscosityMatch[1].replace('-', '');
                    console.log(`Searching for ${viscosity} in larger sizes`);
                    // 搜尋同黏度且是大容量的產品
                    priorityQueries.push({
                        field: 'word2', value: viscosity, limit: 20, method: 'contains'
                    });
                }

                // 直接搜尋 size 欄位包含大容量的產品
                priorityQueries.push({ field: 'size', value: '5L', limit: 15, method: 'contains' });
                priorityQueries.push({ field: 'size', value: '4L', limit: 15, method: 'contains' });
                priorityQueries.push({ field: 'size', value: '20L', limit: 10, method: 'contains' });
            }
            // 找到編號後，通常這是最強意圖，這個關鍵字就不需要再走下面的類別搜尋了
            // 但為了保險，讓它繼續跑，只是這是最高優先級
        }

        // === 0.5 通用名星產品直達車 (Universal Product Bypass) ===

        // 如果是摩托車上下文，且不是通用產品 (如洗手膏、清潔類)，才加車型濾鏡
        const isCleaning = productCategory === '清潔' || productCategory === '美容';
        if (isBike && !analysis.isGeneralProduct && !isCleaning) {
            // 摩托車專屬過濾：標題含關鍵字 AND 分類含摩托車
            priorityQueries.push({
                field: 'title', value: kw, limit: 15, method: 'contains',
                andContains: { field: 'sort', value: '摩托車' }
            });

            // 額外嘗試：標題含關鍵字 AND 標題含 Motorbike
            if (/^[a-zA-Z]+$/.test(kw)) {
                priorityQueries.push({
                    field: 'title', value: kw, limit: 10, method: 'contains',
                    andContains: { field: 'title', value: 'Motorbike' }
                });
            }
        } else {
            // 汽車或不分車型
            // === 嚴格類別過濾 (Strict Category Filter) ===
            // 針對容易混淆的類別 (如機油 vs 添加劑)，強制加上類別過濾
            const strictCategories = ['機油', '添加劑', '變速箱', '煞車', '冷卻'];
            if (strictCategories.includes(productCategory) && !analysis.isGeneralProduct) {
                priorityQueries.push({
                    field: 'title', value: kw, limit: 15, method: 'contains',
                    andContains: { field: 'sort', value: productCategory }
                });
            } else {
                priorityQueries.push({ field: 'title', value: kw, limit: 15, method: 'contains' });
            }
        }

        // === Fallback: 寬鬆搜尋 (Relaxed Search) ===
        // 為了避免因分類錯誤或過濾太嚴格而漏掉產品，額外搜尋僅標題匹配的結果
        // 這讓 AI 能夠看到「雖然分類不符但標題吻合」的產品，進而正確引導用戶（而不是說找不到）
        priorityQueries.push({ field: 'title', value: kw, limit: 5, method: 'contains' });

        // === 關鍵修正：針對「認證/規格」類關鍵字，追加搜尋 Description 欄位 ===
        // 判斷方式：含該關鍵字混合了數字與字母 (如 948B, 504.00, LL-04) 或是顯著的特殊規格
        const isCertification = /[a-zA-Z].*[0-9]|[0-9].*[a-zA-Z]|[-.]/.test(kw) && kw.length > 3;

        // === 黏度優化 (Viscosity Optimization & Smart Variants) ===
        // 1. 檢查是否為黏度 (5W30, 10W-40) -> 搜尋 word2 欄位
        // 2. 自動生成變體：5W30 <-> 5W-30，確保資料庫無論存哪種格式都能搜到
        const viscosityMatch = kw.match(/(\d{1,2}W)([- ]?)(\d{2,3})/i);
        if (viscosityMatch) {
            const [full, prefix, sep, suffix] = viscosityMatch;
            const variants = [
                `${prefix}${suffix}`,       // 5W30
                `${prefix}-${suffix}`,      // 5W-30
                `${prefix} ${suffix}`       // 5W 30
            ];
            // 去重並搜尋 word2
            [...new Set(variants)].forEach(v => {
                priorityQueries.push({ field: 'word2', value: v, limit: 20, method: 'contains' });
            });
            console.log(`Smart Viscosity Search: ${kw} -> Variants: ${variants.join(', ')}`);
        }

        // === 系列名稱/次分類優化 (Series Optimization) ===
        // 針對非黏度、非純數字的關鍵字，嘗試搜尋 word1 (次分類/系列)
        // 例如 "Optimal", "Molygen", "Top Tec", "Street"
        if (!viscosityMatch && !isCertification && kw.length > 3 && isNaN(kw)) {
            priorityQueries.push({ field: 'word1', value: kw, limit: 15, method: 'contains' });
        }

        if (isCertification && !viscosityMatch) {
            console.log(`Detected Certification Keyword: ${kw} -> Adding Cert Field Search`);

            // 智慧認證變體 (Smart Certification Variants)
            // MB229.5 <-> MB 229.5
            // BMW LL-04 <-> LL04
            const variants = [kw];
            if (kw.includes(' ')) variants.push(kw.replace(/\s+/g, ''));
            if (!kw.includes(' ')) variants.push(kw.replace(/([a-zA-Z]+)(\d)/, '$1 $2')); // MB229 -> MB 229

            [...new Set(variants)].forEach(v => {
                priorityQueries.push({ field: 'cert', value: v, limit: 20, method: 'contains' });
                priorityQueries.push({ field: 'description', value: v, limit: 10, method: 'contains' });
            });
        }
    });

    // === 大包裝獨立搜尋 (Large Package Standalone Search) ===
    // 當用戶問「大容量包裝」但沒有產品編號時，直接搜尋大容量產品
    if (isLargePackageQuery) {
        console.log('Large package query detected, adding size-based search');
        // 搜尋 size 欄位包含大容量的產品
        priorityQueries.push({ field: 'size', value: '5L', limit: 25, method: 'contains' });
        priorityQueries.push({ field: 'size', value: '4L', limit: 25, method: 'contains' });
        priorityQueries.push({ field: 'size', value: '20L', limit: 15, method: 'contains' });
        // 也搜尋 title 中可能包含容量資訊的產品
        priorityQueries.push({ field: 'title', value: '5L', limit: 15, method: 'contains' });
        priorityQueries.push({ field: 'title', value: '4L', limit: 15, method: 'contains' });
    }

    // 最後保底
    if (queries.length === 0 && priorityQueries.length === 0 && isBike) {
        addQuery('sort', '摩托車', 20);
    }

    // 將優先查詢放在最前面！
    return [...priorityQueries, ...queries];
}
