/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題，判斷車型類別和需要的規格
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// ============================================
// 添加劑指南資料庫 (Additive Guide Database)
// ============================================
let additiveGuide = [];
try {
    const guidePath = path.join(process.cwd(), 'data', 'additive-guide.json');
    additiveGuide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
    console.log(`[Additive Guide] Loaded ${additiveGuide.length} items`);
} catch (e) {
    console.warn('[Additive Guide] Failed to load:', e.message);
}

/**
 * 匹配添加劑指南
 * 根據用戶訊息中的關鍵字，找出對應的添加劑推薦
 * @param {string} message - 用戶訊息
 * @returns {Array} - 匹配到的指南項目
 */
function matchAdditiveGuide(message) {
    if (!additiveGuide.length) return [];

    const lowerMsg = message.toLowerCase();
    const matched = [];

    // 定義問題關鍵字映射 (擴展匹配能力)
    const keywordMap = {
        '漏油': ['漏油', '滲油', '油封', '止漏'],
        '異音': ['異音', '聲音', '噪音', '達達聲', '敲擊'],
        '吃機油': ['吃機油', '機油消耗', '排藍煙', '冒藍煙'],
        '積碳': ['積碳', '除碳', '清潔', '清洗'],
        '怠速': ['怠速', '抖動', '不穩'],
        '啟動': ['啟動', '發動', '難發'],
        '過熱': ['過熱', '水溫高', '水溫過高'],
        '磨損': ['磨損', '保護', '抗磨'],
        '變速箱': ['變速箱', '換檔', '打滑', '頓挫'],
        '冷卻': ['冷卻', '水箱', '水溫'],
        'DPF': ['dpf', '再生', '柴油濾芯'],
        '黑煙': ['黑煙', '冒煙', '排煙'],
        '油泥': ['油泥', '乳化', '乳黃色'],
        '缸壓': ['缸壓', '壓縮', '活塞環'],
    };

    for (const item of additiveGuide) {
        const problem = (item.problem || '').toLowerCase();
        const explanation = (item.explanation || '').toLowerCase();

        // 直接匹配問題描述
        if (lowerMsg.includes(problem.substring(0, 4))) {
            matched.push(item);
            continue;
        }

        // 關鍵字擴展匹配
        for (const [key, synonyms] of Object.entries(keywordMap)) {
            if (synonyms.some(s => lowerMsg.includes(s))) {
                if (problem.includes(key) || explanation.includes(key) || synonyms.some(s => problem.includes(s))) {
                    if (!matched.find(m => m.problem === item.problem)) {
                        matched.push(item);
                    }
                    break;
                }
            }
        }
    }

    // 最多返回 3 個最相關的結果
    return matched.slice(0, 3);
}


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

2. **vehicleType (車型判斷) - 利用你的內建知識！**
   - **重要：請用你對全球汽機車品牌的知識來判斷，不要只依賴下方列表！**
   - "摩托車"：出現 機車、摩托車、重機、檔車、街車、仿賽、速克達、跑山、
     - 🛵 **速克達**：JET, 勁戰, MMBCU, DRG, Force, SMAX, BWS, Cygnus, RCS, Racing, RomaGT, RTS, KRV, Like, Many, Nice, Woo, Vivo, Fiddle, Saluto, Swish, Access, Address, Vespa, JBUBU, Tigra, Spring, 4MICA, KRN, Dollar, Augur, Burgman, PCX, Forza, ADV
     - 🏍️ **檔車/街車**：MT-03, MT-07, MT-09, MT-10, MT-15, XSR, Tracer, Tenere (YAMAHA), Z400, Z650, Z900, ER, Versys, W800, Vulcan (KAWASAKI), CB300, CB500, CB650, CB1000, Rebel, NC750 (HONDA), SV650, GSX-S, V-Strom, Katana (SUZUKI), Duke, Svartpilen, Vitpilen (KTM), Street Triple, Trident, Speed Twin (TRIUMPH), Monster, Scrambler (DUCATI), R nineT, F900 (BMW)
     - 🏁 **仿賽/跑車**：R1, R3, R6, R7, R15, YZF (YAMAHA), Ninja, ZX-6R, ZX-10R, ZX-4R (KAWASAKI), CBR, RC (HONDA), GSX-R, Hayabusa (SUZUKI), RC, RC8 (KTM), Daytona (TRIUMPH), Panigale, SuperSport (DUCATI), S1000RR (BMW)
     - 🛣️ **多功能/ADV**：Africa Twin, Goldwing (HONDA), Super Adventure (KTM), Tiger, Scrambler XE (TRIUMPH), Multistrada, DesertX (DUCATI), GS, R1250GS, F850GS (BMW)
     - 🇺🇸 **美式/巡航**：Harley, Sportster, Iron, Softail, Fat Boy, Street Glide, Electra Glide, Indian, Scout, Chief
   - "船舶"：出現 船, Marine, Boat, Yacht, 艦艇, 遊艇, 船外機, Outboard, Inboard, Jet Ski, 水上摩托車
   - "自行車"：出現 自行車, 腳踏車, 單車, Bike, Bicycle, MTB, 公路車, 登山車
   - "汽車"：預設值，或出現 汽車, 轎車, SUV, MPV, 卡車, 跑車
     以及熱門車款：Toyota, Altis, Corolla Cross, RAV4, Yaris, Vios, Camry, Town Ace, Honda CRV, Honda HRV, Fit, Civic, Ford, Kuga, Focus, Nissan, X-Trail, Kicks, Sentra, Lexus, NX, RX, UX, LBX, ES, Mazda, CX-5, CX-30, Mazda3, Benz, GLC, C-Class, E-Class, A-Class, BMW X3, BMW X4, BMW X1, BMW 3 Series, BMW 5 Series, Volvo, XC40, XC60, Hyundai, Tucson, Custin, Kia, Sportage, MG, HS, ZS
   - **注意區分**：Honda CBR, Honda CB = 摩托車；Honda CRV, Honda Civic = 汽車
   - **注意區分**：BMW S1000RR, BMW R1250GS = 摩托車；BMW X3, BMW 3 Series = 汽車

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

3.5 **🧠 產品名稱智慧識別 (Product Name Intelligence) - 極重要！**
   **你必須利用你對 LIQUI MOLY 產品線的知識來識別產品！**
   
   - 若用戶提到以下 LIQUI MOLY 產品系列，**必須**將它們加入 searchKeywords：
     - **添加劑系列**：Shooter (4T/2T), Engine Flush, Cera Tec, MOS2, Viscoplus, Oil Additiv, Speed Tec, Super Diesel, Injection Cleaner, Valve Clean, Catalytic-System Clean, Pro-Line, Fuel Protect, Oil Saver, Stop Leak, ATF Additive
     - **機油系列**：Molygen, Special Tec, Top Tec, Synthoil, Leichtlauf, MoS2, Racing Synth, Longtime, Optimal, Super Leichtlauf
     - **摩托車系列**：Motorbike, Street, Offroad, Scooter, 4T, 2T, Chain Lube, Chain Cleaner
     - **化學品系列**：DOT, Brake Fluid, Coolant, Kühlerfrostschutz, ATF
   
   - **用戶輸入分析**：
     - 當用戶輸入可能是產品名稱但你不確定時，**直接將其加入 searchKeywords** 讓資料庫搜尋
     - 範例：用戶說「SHOOTER」→ searchKeywords 加入 ["Shooter", "4T Shooter", "2T Shooter"]
     - 範例：用戶說「Molygen」→ searchKeywords 加入 ["Molygen", "Molygen New Generation"]
     - 範例：用戶說「快樂跑」→ searchKeywords 加入 ["快樂跑", "Fuel Additive", "Speed Tec"]
   
   - **容錯機制**：即使你不認識的詞彙，只要看起來像產品名稱，就加入 searchKeywords！
    
4. **isGeneralProduct (通用產品判定)**
   - **必填 true**：當類別為「美容」、「化學品」、「清潔」時 (除非明確指定是摩托車專用，如"重機鍊條油")。
   - **必填 true**：煞車油、水箱精、洗手膏、雨刷水通常不分車種。
   
5. **searchKeywords (關鍵字 - 自動化搜尋的核心)**
   - 請提供 **3-5 個** 不同的關鍵字，用於資料庫廣泛搜尋。
   - 包含：中文名稱、英文名稱 (重要!)、同義詞、德文名稱 (若知道)。
   
   - **🔢 產品編號識別 (SKU Detection) - 極重要！**
     - 若用戶提供產品編號（如 LM21730, 21730, LM9047, 9047），**必須**將該編號加入 searchKeywords！
     - 格式：4-5 位數字，可能有 LM 前綴
     - 範例：用戶說「LM21730 這個不是有寫EV嗎」→ searchKeywords 必須包含 "LM21730" 和 "21730"
     - 當用戶提供產品編號時，這是最強意圖，productCategory 應設為該產品的類別
   
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

   - **🔄 跨品牌產品比對 (Cross-Brand Product Matching) - 智慧推薦！**
     **當用戶提到其他品牌產品時，利用你的知識分析該產品特性，推薦類似的 LIQUI MOLY 產品：**
     
     - **用戶問法範例**：「有類似嘉實多磁護的產品嗎？」「跟 Mobil 1 差不多的？」
     - **你的任務**：
       1. 分析該競品的特性（合成/礦物、黏度、定位、認證）
       2. 找出 LIQUI MOLY 中定位相近的產品
       3. 將對應的 LIQUI MOLY 產品名加入 searchKeywords
     
     - **常見競品對應（利用你的知識擴展）**：
       - 嘉實多磁護 (Castrol Magnatec) → Molygen New Generation
       - 嘉實多極護 (Castrol EDGE) → Synthoil
       - 美孚1號 (Mobil 1) → Top Tec / Synthoil
       - Shell Helix Ultra → Top Tec / Special Tec
       - 出光 (Idemitsu) → Special Tec AA
       - Motul (機車) → Motorbike Racing Synth
       - YAMALUBE/原廠油 → Motorbike 4T
     
     - **重要**：即使競品不在列表，請用你的知識推斷！
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

                    // ============================================
                    // 🏍️ 當前訊息摩托車關鍵字優先檢查 (Current Message Priority)
                    // 如果當前訊息包含摩托車車型（如 MT-03, R3），直接強制摩托車模式
                    // ============================================
                    const currentMessageLower = message.toLowerCase();
                    const motorcycleKeywordsInMessage = [
                        // YAMAHA 檔車/重機
                        'mt-03', 'mt-07', 'mt-09', 'mt-10', 'mt-15', 'r1', 'r3', 'r6', 'r7', 'r15', 'xsr', 'tracer', 'tenere', 'fz', 'xmax', 'tmax', 'nmax',
                        // KAWASAKI
                        'ninja', 'z400', 'z650', 'z900', 'zx-6r', 'zx-10r', 'versys', 'vulcan', 'w800', 'er-6n',
                        // HONDA
                        'cbr', 'cb300', 'cb500', 'cb650', 'cb1000', 'crf', 'rebel', 'nc750', 'africa twin', 'goldwing', 'forza', 'pcx', 'adv',
                        // SUZUKI
                        'gsx-r', 'gsx-s', 'sv650', 'v-strom', 'katana', 'hayabusa', 'burgman',
                        // DUCATI / BMW / KTM / TRIUMPH / HARLEY
                        'ducati', 'panigale', 'monster', 'scrambler', 'multistrada', 'bmw gs', 'r1250', 's1000', 'ktm', 'duke', 'rc', 'adventure', 'triumph', 'street triple', 'tiger', 'harley', 'sportster', 'iron', 'softail',
                        // 通用摩托車關鍵字
                        'yamaha', '機車', '摩托車', 'motorcycle', 'motorbike', '重機', '檔車', '速克達', 'scooter'
                    ];
                    const hasMotorcycleInCurrentMessage = motorcycleKeywordsInMessage.some(kw => currentMessageLower.includes(kw));

                    if (hasMotorcycleInCurrentMessage && !isExplicitCarSwitch) {
                        console.log(`Context Override: Detected motorcycle keyword in CURRENT message! Forcing Motorcycle mode. (keyword found in: "${message.substring(0, 50)}...")`);
                        result.vehicleType = '摩托車';
                        // 重置可能錯誤的 productCategory
                    }

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
                // 🔢 自動 SKU 偵測 (Automatic SKU Detection)
                // 無論 AI 是否識別，都從用戶訊息中提取 SKU
                // ============================================
                const skuPattern = /(?:LM|lm)?[- ]?(\d{4,5})/g;
                const skuMatches = [...message.matchAll(skuPattern)];
                for (const match of skuMatches) {
                    const skuNum = match[1];
                    const fullSku = `LM${skuNum}`;
                    console.log(`Auto SKU Detection: Found ${skuNum} -> Adding ${fullSku} to searchKeywords`);
                    // 確保 searchKeywords 存在
                    if (!result.searchKeywords) result.searchKeywords = [];
                    // 如果還沒有這個 SKU，加入
                    if (!result.searchKeywords.includes(fullSku)) {
                        result.searchKeywords.unshift(fullSku); // 放在最前面，優先搜尋
                    }
                    if (!result.searchKeywords.includes(skuNum)) {
                        result.searchKeywords.unshift(skuNum);
                    }
                }

                // ============================================
                // 📦 容量/包裝 Follow-up 偵測 (Volume Follow-up Detection)
                // 當用戶問「60L」「4L」「有大容量嗎」時，從歷史提取產品名重新搜尋
                // ============================================
                const volumeKeywords = ['1l', '4l', '5l', '20l', '60l', '205l', '大容量', '大包裝', '小包裝', '有幾升', '有幾公升', '容量', '包裝', 'liter', 'litre'];
                const lowerMessage = message.toLowerCase();
                const hasVolumeQuestion = volumeKeywords.some(kw => lowerMessage.includes(kw));

                if (hasVolumeQuestion && conversationHistory && conversationHistory.length > 0) {
                    console.log('[Volume Follow-up] Detected volume question, scanning history for product name...');

                    // 從對話歷史中提取產品名稱
                    // 尋找常見的產品系列名稱
                    const productPatterns = [
                        /Special Tec[^,\n]*/gi,
                        /Top Tec[^,\n]*/gi,
                        /Molygen[^,\n]*/gi,
                        /Leichtlauf[^,\n]*/gi,
                        /Synthoil[^,\n]*/gi,
                        /Motor Oil[^,\n]*/gi,
                        /Motorbike[^,\n]*/gi,
                        /\d+W-?\d+/gi  // 黏度規格如 0W-20, 5W-30
                    ];

                    const historyText = conversationHistory.map(m => m.content).join(' ');
                    let foundProductNames = [];

                    for (const pattern of productPatterns) {
                        const matches = historyText.match(pattern);
                        if (matches) {
                            foundProductNames = foundProductNames.concat(matches);
                        }
                    }

                    // 去重並取前 3 個
                    foundProductNames = [...new Set(foundProductNames)].slice(0, 3);

                    if (foundProductNames.length > 0) {
                        console.log(`[Volume Follow-up] Found product names in history: ${foundProductNames.join(', ')}`);
                        if (!result.searchKeywords) result.searchKeywords = [];

                        // 將產品名稱加入搜尋關鍵字
                        for (const name of foundProductNames) {
                            if (!result.searchKeywords.includes(name)) {
                                result.searchKeywords.push(name);
                            }
                        }

                        // 標記這是容量查詢，讓回覆時列出所有容量
                        result.isVolumeQuery = true;
                        console.log(`[Volume Follow-up] Added to searchKeywords: ${foundProductNames.join(', ')}`);
                    }
                }

                // ============================================
                // 🧪 添加劑指南匹配 (Additive Guide Matching)
                // ============================================
                const additiveMatches = matchAdditiveGuide(message);
                if (additiveMatches.length > 0) {
                    console.log(`[Additive Guide] Matched ${additiveMatches.length} items for: "${message.substring(0, 30)}..."`);
                    result.additiveGuideMatch = {
                        matched: true,
                        items: additiveMatches.map(item => ({
                            problem: item.problem,
                            explanation: item.explanation,
                            solutions: item.solutions,
                            hasProduct: item.hasProduct,
                            area: item.area,
                            type: item.type
                        }))
                    };
                    // 將產品編號加入搜尋關鍵字
                    if (!result.searchKeywords) result.searchKeywords = [];
                    for (const item of additiveMatches) {
                        for (const sku of item.solutions) {
                            if (!result.searchKeywords.includes(sku)) {
                                result.searchKeywords.push(sku);
                            }
                        }
                    }
                    // 如果有匹配添加劑，更新產品類別
                    if (result.productCategory !== '添加劑') {
                        result.productCategory = '添加劑';
                    }
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

    // === 容量提取邏輯 (Volume Extraction) ===
    // 提取用戶詢問的具體容量 (如 800ml, 1L, 4L)
    let requestedSize = null;
    const sizePatterns = [
        /(\d+)\s*(ml|毫升)/i,   // 800ml, 800毫升
        /(\d+)\s*(l|公升|升)/i, // 4L, 4公升, 4升
    ];
    for (const pattern of sizePatterns) {
        const match = messageLower.match(pattern);
        if (match) {
            const num = match[1];
            const unit = match[2].toLowerCase();
            if (unit === 'ml' || unit === '毫升') {
                requestedSize = `${num}ml`;
            } else {
                requestedSize = `${num}L`;
            }
            console.log(`[Volume Extraction] Detected size request: ${requestedSize}`);
            break;
        }
    }

    // Helper to add query (now includes optional filterSize)
    const addQuery = (field, value, limit = 20, method = 'contains', filterSize = null) => {
        const query = { field, value, limit, method };
        if (filterSize || requestedSize) {
            query.filterSize = filterSize || requestedSize;
        }
        queries.push(query);
    };

    // === 策略 0: SHOOTER 關鍵字專用搜尋 ===
    // 當用戶提到 SHOOTER 時，直接搜尋 Shooter 產品標題
    const hasShooterKeyword = messageLower.includes('shooter') || keywords.some(k => k.toLowerCase().includes('shooter'));
    if (hasShooterKeyword) {
        console.log('[generateWixQueries] SHOOTER keyword detected, adding Shooter title search');
        queries.push({ field: 'title', value: 'Shooter', limit: 20, method: 'contains' });
    }

    // === 策略 A: 摩托車添加劑 ===
    if (isBike && productCategory === '添加劑') {
        addQuery('sort', '【摩托車】添加劑', 30);
        addQuery('sort', '【摩托車】機車養護', 20);
        // Title backup
        queries.push({ field: 'title', value: 'Motorbike', limit: 30, method: 'contains', filterTitle: ['Additive', 'Shooter', 'Flush', 'Cleaner'] });
    }

    // === 策略 B: 摩托車機油 ===
    else if (isBike && productCategory === '機油') {
        console.log('[策略B] 摩托車機油搜尋! vehicleType:', vehicleType, 'isBike:', isBike);
        
        // 優先搜尋標題含 Motorbike 的機油 (最精確)
        queries.push({ field: 'title', value: 'Motorbike', limit: 50, method: 'contains' });
        
        if (isScooter) {
            queries.push({ field: 'sort', value: '【摩托車】機油', limit: 20, method: 'contains', andContains: { field: 'title', value: 'Scooter' } });
        }
        addQuery('sort', '【摩托車】機油', 30);
        console.log('[策略B] 已加入 Motorbike 標題搜尋');
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

    // === EV 電動車特殊處理 (EV Context Hook) ===
    // 偵測是否為電動車相關查詢
    const evKeywords = ['ev', 'electric', 'tesla', 'model 3', 'model y', 'model s', 'model x', 'ionic', 'kona', 'taycan', 'etron', 'i4', 'ix', 'eqe', 'eqs', '電動車', '純電'];
    const isEV = uniqueKw.some(k => evKeywords.some(evK => k.toLowerCase().includes(evK)));

    if (isEV) {
        console.log('Context Hook: EV Detected! Adjusting search strategy.');
        // 如果是 EV 且問煞車油，優先找 DOT 5.1 EV
        if (uniqueKw.some(k => k.includes('煞車') || k.includes('brake'))) {
            priorityQueries.push({ field: 'title', value: 'DOT 5.1 EV', limit: 5, method: 'contains' });
            priorityQueries.push({ field: 'title', value: 'DOT 5.1', limit: 5, method: 'contains' });
        }
    }

    // === SKU 優先處理 (SKU Priority Search) ===
    // 在 maxKeywords 限制之前，先為所有 SKU 格式的關鍵字生成搜尋指令
    // 這確保「LM7820跟LM7822」這類查詢能找到所有產品
    const skuPattern = /^(?:lm|LM)?(\d{4,5})$/;
    const processedSkus = new Set();

    for (const kw of uniqueKw) {
        const match = kw.match(skuPattern);
        if (match) {
            const skuNum = match[1];
            const fullSku = `LM${skuNum}`;

            // 避免重複處理同一個 SKU
            if (processedSkus.has(skuNum)) continue;
            processedSkus.add(skuNum);

            console.log(`[SKU Priority] Processing SKU: ${kw} -> ${fullSku}`);

            // 直接用 partno 精確搜尋
            priorityQueries.push({ field: 'partno', value: fullSku, limit: 5, method: 'eq' });
            priorityQueries.push({ field: 'partno', value: skuNum, limit: 5, method: 'contains' });
            // 標題搜尋備份
            priorityQueries.push({ field: 'title', value: fullSku, limit: 5, method: 'contains' });
        }
    }

    uniqueKw.slice(0, maxKeywords).forEach(kw => {
        if (!kw || kw.length < 2) return; // 跳過過短關鍵字

        // === 0. 產品編號直達車 (SKU Direct Search) ===
        // 檢查是否為產品編號格式：4-5位數字，或 LM 開頭接數字
        // 如：9047, LM9047, lm-9047
        // 支援多個 SKU 同時查詢 (Multi-SKU Support)
        const skuPattern = /(?:lm|LM)?[- ]?(\d{4,5})/g;
        const skuMatches = [...kw.matchAll(skuPattern)];
        for (const skuMatch of skuMatches) {
            const skuNum = skuMatch[1];
            // 補全 LM 前綴進行精確匹配
            const fullSku = `LM${skuNum}`;
            console.log(`Detected SKU Keyword: ${kw} -> Searching: ${fullSku}, ${skuNum}`);

            // 搜尋 partno 欄位 (主要)
            priorityQueries.push({ field: 'partno', value: fullSku, limit: 5, method: 'eq' });
            priorityQueries.push({ field: 'partno', value: skuNum, limit: 5, method: 'contains' });

            // 搜尋 title 欄位 (產品名稱可能包含編號)
            priorityQueries.push({ field: 'title', value: fullSku, limit: 5, method: 'contains' });
            priorityQueries.push({ field: 'title', value: skuNum, limit: 5, method: 'contains' });

            // 搜尋 cert 欄位 (認證資訊可能包含編號)
            priorityQueries.push({ field: 'cert', value: skuNum, limit: 3, method: 'contains' });

            // 搜尋 content 欄位 (產品說明可能包含編號)
            priorityQueries.push({ field: 'content', value: skuNum, limit: 3, method: 'contains' });

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
        } else if (!isBike) {
            // 汽車或不分車型 (修正: 加入 !isBike 雙重檢查，確保不會對摩托車執行汽車搜尋)
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
        // 修正: 對摩托車加入 Motorbike 過濾，避免返回汽車產品
        if (isBike && productCategory === '機油') {
            priorityQueries.push({ field: 'title', value: kw, limit: 5, method: 'contains', andContains: { field: 'title', value: 'Motorbike' } });
        } else {
            priorityQueries.push({ field: 'title', value: kw, limit: 5, method: 'contains' });
        }

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
                priorityQueries.push({ field: 'content', value: v, limit: 10, method: 'contains' });
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
