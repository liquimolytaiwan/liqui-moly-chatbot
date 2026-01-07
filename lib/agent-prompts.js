/**
 * LIQUI MOLY Chatbot - Multi-Agent Prompts
 *
 * 將原本一次載入的大型 prompt 拆分成專門的 Agent prompts
 * 每個 Agent 只載入與其任務相關的規則，減少 token 消耗
 *
 * Agent 類型：
 * 1. GREETING - 打招呼/一般問候
 * 2. PRODUCT_OIL - 機油產品推薦
 * 3. PRODUCT_ADDITIVE - 添加劑產品推薦
 * 4. PURCHASE - 購買地點查詢
 * 5. COOPERATION - 合作洽詢
 * 6. PRICE - 價格查詢
 * 7. VEHICLE_SPEC - 車型規格查詢
 * 8. GENERAL - 一般產品諮詢
 *
 * v2.0: 使用統一 prompt-components.js 元件
 */

const {
    buildLanguageRule,
    buildCoreIdentity,
    buildFinalReminder,
    buildVehicleInfo,
    buildElectricVehicleRule,
    buildCooperationTemplate,
    buildPurchaseTemplate,
    buildPriceTemplate,
    buildOilRecommendationRules,
    buildAdditiveRecommendationRules
} = require('./prompt-components');

// Agent 類型定義
const AGENT_TYPES = {
    GREETING: 'greeting',
    PRODUCT_OIL: 'product_oil',
    PRODUCT_ADDITIVE: 'product_additive',
    PURCHASE: 'purchase',
    COOPERATION: 'cooperation',
    PRICE: 'price',
    VEHICLE_SPEC: 'vehicle_spec',
    GENERAL: 'general'
};

/**
 * 根據意圖選擇合適的 Agent
 * @param {Object} intent - 意圖分析結果
 * @returns {string} - Agent 類型
 */
function selectAgent(intent) {
    const type = intent.type;
    const productCategory = intent.productCategory;
    const hasVehicleInfo = intent._aiAnalysis?.vehicles?.length > 0 &&
        intent._aiAnalysis.vehicles[0].vehicleName;

    // 修正：嚴格檢查，避免 undefined 導致的誤判
    // 優先檢查 _aiAnalysis 中的原始判斷
    const needsProductRecommendation = intent.needsProductRecommendation === true ||
        intent._aiAnalysis?.needsProductRecommendation === true;
    const specialScenario = intent.specialScenario;

    // 合作洽詢 (最高優先)
    if (type === 'cooperation_inquiry') {
        return AGENT_TYPES.COOPERATION;
    }

    // 購買地點查詢
    if (type === 'purchase_inquiry') {
        return AGENT_TYPES.PURCHASE;
    }

    // 價格查詢
    if (type === 'price_inquiry') {
        return AGENT_TYPES.PRICE;
    }

    // 純電動車特殊處理（不推薦機油）
    if (specialScenario === 'pure_ev_motorcycle' || specialScenario === 'pure_ev_car') {
        return AGENT_TYPES.GENERAL;  // 使用 GENERAL 處理特殊情境
    }

    // 一般問候（無車型、無具體需求）
    if (type === 'general_inquiry' && !hasVehicleInfo && !needsProductRecommendation) {
        return AGENT_TYPES.GREETING;
    }

    // 產品推薦
    if (type === 'product_recommendation' || needsProductRecommendation) {
        if (productCategory === '添加劑') {
            return AGENT_TYPES.PRODUCT_ADDITIVE;
        }
        // 非機油類別（變速箱油、煞車油等）使用 GENERAL
        if (productCategory && !['機油', '添加劑'].includes(productCategory)) {
            return AGENT_TYPES.GENERAL;
        }
        return AGENT_TYPES.PRODUCT_OIL;
    }

    // 預設為一般諮詢
    return AGENT_TYPES.GENERAL;
}

/**
 * 取得語言規則（使用統一元件）
 */
function getLanguageRule() {
    return buildLanguageRule(true);  // compact = true
}

/**
 * 取得核心身份（使用統一元件）
 */
function getCoreIdentity() {
    return buildCoreIdentity(true);  // compact = true
}

/**
 * GREETING Agent - 打招呼專用
 * Token: ~200
 *
 * ⚠️ 重要：追問階段不需要顯示購買指引！
 */
function buildGreetingPrompt() {
    return `${getLanguageRule()}

${getCoreIdentity()}

## 任務：問候回覆
用戶正在打招呼，尚未提供車型或需求。

**執行動作：**
1. 禮貌問候
2. ⛔ 禁止編造車型
3. 詢問需求（機油/添加劑/其他）

**⛔ 禁止事項：**
- 禁止顯示購買指引（尚未推薦產品）
- 禁止顯示店家查詢連結
- 禁止推薦任何產品

**範例：**
「您好！歡迎詢問 LIQUI MOLY 產品！😊 請問您想找引擎機油、添加劑，還是有其他問題呢？」`;
}

/**
 * PRODUCT_OIL Agent - 機油推薦專用
 * Token: ~600
 *
 * ⚠️ 機油推薦必須包含免責聲明和購買指引
 */
function buildOilPrompt(knowledge, intent, productContext) {
    const sections = [];

    sections.push(getLanguageRule());
    sections.push(getCoreIdentity());

    // ⚡ 新增：檢查是否需要追問資訊
    const needsInfo = intent?.needsMoreInfo || intent?._aiAnalysis?.needsMoreInfo || [];
    if (needsInfo.length > 0) {
        // 生成追問指令
        sections.push(`## 🛑 互動指導 (Oil Recommendation - 資訊不足)
用戶詢問機油推薦，但缺少必要的資訊。

**⚠️ AI 分析結果：需要確認的資訊**
${needsInfo.map(info => `- ${info}`).join('\n')}

**請嚴格執行以下動作：**
1. **⛔ 禁止直接推薦產品**：資訊不足時推薦可能不符合原廠規範！
2. **追問缺少的資訊**：禮貌地詢問用戶缺少的資訊
3. **說明為何需要這些資訊**：例如「年份會影響認證規範」

**汽車機油推薦前必須確認：年份、車型名稱、燃油類型（汽油/柴油/油電）**
**機車機油推薦前必須確認：車型類別（檔車/速克達）、排氣量（選填）**

**範例回覆：**
「您好！關於您的 ${intent?.vehicleModel || '車型'}，為了推薦最適合的機油，我需要確認一下：
${needsInfo.map((info, idx) => `${idx + 1}. 請問${info}是什麼呢？`).join('\n')}
這些資訊能幫助我推薦最符合原廠規範的產品！」

**⚠️ 禁止顯示購買指引**：尚未推薦產品時不需要購買指引`);

        // ⚠️ 如果需要追問，不顯示產品資料，避免 LLM 直接推薦
        sections.push(buildFinalReminder(true, { includeDisclaimer: false, includePurchaseGuide: false }));
        return sections.filter(s => s).join('\n\n');
    }

    // 已確認車型（如有）- 使用統一元件
    const vehicleInfoSection = buildVehicleInfo(intent);
    if (vehicleInfoSection) {
        sections.push(vehicleInfoSection);
    }

    // 機油推薦專用規則 - 使用統一元件
    sections.push(buildOilRecommendationRules());

    // 認證對照（如有）
    if (knowledge.certification) {
        sections.push(buildCertificationCompact(knowledge.certification));
    }

    // 產品資料庫
    if (productContext) {
        sections.push(`## 可用產品\n${productContext}`);
    }

    // 結尾提醒 - 機油推薦需要免責聲明和購買指引
    sections.push(buildFinalReminder(true, { includeDisclaimer: true, includePurchaseGuide: true }));

    return sections.filter(s => s).join('\n\n');
}

/**
 * PRODUCT_ADDITIVE Agent - 添加劑推薦專用
 * Token: ~500
 *
 * ⚠️ 添加劑推薦需要購買指引，但不需要機油免責聲明
 */
function buildAdditivePrompt(knowledge, intent, productContext) {
    const sections = [];

    sections.push(getLanguageRule());
    sections.push(getCoreIdentity());

    // 已確認車型 - 使用統一元件
    const vehicleInfoSection = buildVehicleInfo(intent);
    if (vehicleInfoSection) {
        sections.push(vehicleInfoSection);
    }

    // 添加劑專用規則 - 使用統一元件
    sections.push(buildAdditiveRecommendationRules());

    // 症狀匹配結果（如有）
    const additiveMatch = intent?.additiveGuideMatch || intent?._aiAnalysis?.additiveGuideMatch;
    if (additiveMatch?.matched) {
        sections.push(buildAdditiveMatchSection(additiveMatch));
    }

    // 產品資料庫
    if (productContext) {
        sections.push(`## 可用產品\n${productContext}`);
    }

    // 結尾提醒 - 添加劑不需要機油免責聲明，但需要購買指引
    sections.push(buildFinalReminder(true, { includeDisclaimer: false, includePurchaseGuide: true }));

    return sections.filter(s => s).join('\n\n');
}

/**
 * PURCHASE Agent - 購買地點查詢專用
 * Token: ~300
 */
function buildPurchasePrompt() {
    // 使用統一元件的購買模板
    return `${getLanguageRule()}

${getCoreIdentity()}

## 任務：購買地點查詢
用戶詢問哪裡可以購買產品。

${buildPurchaseTemplate()}`;
}

/**
 * COOPERATION Agent - 合作洽詢專用
 * Token: ~350
 * 包含非台灣地區購買處理
 */
function buildCooperationPrompt() {
    const { loadJSON } = require('./knowledge-cache');
    const templates = loadJSON('response-templates.json');
    const foreignTemplate = templates?.foreign_user_purchase?.template;

    // 使用統一元件的合作洽詢模板
    return `${getLanguageRule()}

${getCoreIdentity()}

## 任務：合作洽詢
用戶詢問經銷商、進貨、批發、KOL 合作等。

**⚠️ 首先判斷：是否為非台灣地區購買/出口詢問？**
若用戶使用非繁體中文，且詢問以下內容：
- 出口、國際運送、海外購買
- 能否寄到 [其他國家]
- export, international shipping, ship to [country]

**→ 則必須使用此回覆（用用戶的語言！）：**
${foreignTemplate || 'We are the authorized distributor for Taiwan region only, and we do not ship internationally. For purchasing in your country, please visit LIQUI MOLY official website: https://www.liqui-moly.com'}

---

**若是台灣保修廠/車行合作洽詢：**
**⛔ 禁止回覆 storefinder 連結！**

${buildCooperationTemplate()}`;
}

/**
 * PRICE Agent - 價格查詢專用
 * Token: ~300
 */
function buildPricePrompt(productContext) {
    const sections = [];

    sections.push(getLanguageRule());
    sections.push(getCoreIdentity());

    // 價格查詢規則 - 使用統一元件
    sections.push(`## 任務：價格查詢
用戶詢問產品價格。

${buildPriceTemplate()}`);

    if (productContext) {
        sections.push(`## 產品資料\n${productContext}`);
    }

    return sections.filter(s => s).join('\n\n');
}

/**
 * GENERAL Agent - 一般諮詢
 * Token: ~400-600 (視情境而定)
 *
 * ⚠️ 根據是否有產品資料決定是否顯示購買指引
 */
function buildGeneralPrompt(knowledge, intent, productContext) {
    const sections = [];

    sections.push(getLanguageRule());
    sections.push(getCoreIdentity());

    // 已確認車型 - 使用統一元件
    const vehicleInfoSection = buildVehicleInfo(intent);
    if (vehicleInfoSection) {
        sections.push(vehicleInfoSection);
    }

    // 特殊情境處理 - 使用統一元件
    const specialScenario = intent.specialScenario;
    if (specialScenario === 'pure_ev_motorcycle' || specialScenario === 'pure_ev_car') {
        sections.push(buildElectricVehicleRule());
    }

    // 非機油類別規格（變速箱油、煞車系統等）
    if (knowledge.categorySpec) {
        sections.push(buildCategorySpecSection(knowledge.categorySpec, intent.productCategory));
    }

    sections.push(`## 一般諮詢規則
- 禮貌回應用戶問題
- 若需推薦產品，先確認車型資訊
- 競品比較：保持中立，強調 LIQUI MOLY 德國製造特色
- 負面情緒：先同理，再引導至聯絡表單
- 無關問題：禮貌告知超出專業範圍`);

    // 判斷是否有產品資料 - 決定是否需要購買指引
    const hasProductContext = productContext && productContext.length > 100;

    if (hasProductContext) {
        sections.push(`## 可用產品\n${productContext}`);
        // 有產品時才加購買指引，一般諮詢不需要機油免責聲明
        sections.push(buildFinalReminder(true, { includeDisclaimer: false, includePurchaseGuide: true }));
    } else {
        // ⚡ 嚴格防幻覺：沒有產品資料時，禁止推薦！
        sections.push(`## ⚠️ 重要限制 (No Product Context)
1. 目前沒有檢索到任何產品資料。
2. **嚴格禁止**推薦任何具體產品型號 (如 Top Tec 4200, Cera Tec 等)！
3. **嚴格禁止**提供任何產品連結！
4. **嚴格禁止**顯示購買指引或店家查詢連結！
5. 你必須**追問用戶的具體需求**（例如：「請問您是想找機油、添加劑，還是有車輛問題需要協助？」）`);
        // 追問時不需要購買指引
        sections.push(buildFinalReminder(true, { includeDisclaimer: false, includePurchaseGuide: false }));
    }

    return sections.filter(s => s).join('\n\n');
}

/**
 * 建構產品類別規格區塊（變速箱油、煞車系統等）
 */
function buildCategorySpecSection(categorySpec, productCategory) {
    if (!categorySpec) return '';

    let section = `## ${productCategory || '產品'}規格指南`;

    if (categorySpec.direct_recommend) {
        section += `\n**可直接推薦，不需車型資訊**`;
    }

    if (categorySpec.prompt_hint) {
        section += `\n**推論規則**：${categorySpec.prompt_hint}`;
    }

    if (categorySpec.types) {
        section += `\n\n**類型對照**：`;
        for (const [typeName, typeInfo] of Object.entries(categorySpec.types)) {
            section += `\n- ${typeName}（${typeInfo.keywords?.join('/')}）→ ${typeInfo.spec}`;
        }
    }

    return section;
}

// ============================================
// 輔助函式（僅保留無法統一的特殊邏輯）
// ============================================

/**
 * 建構認證對照區塊（精簡版）
 * 注意：此函式處理 knowledge.certification 結構，與 prompt-components 不同
 */
function buildCertificationCompact(certs) {
    if (!certs) return '';

    let section = `## 認證對照`;

    if (certs.ford) {
        section += `\n### Ford`;
        for (const [name, data] of Object.entries(certs.ford)) {
            section += `\n- ${name}: ${data.viscosity}`;
        }
    }

    if (certs.european) {
        section += `\n### 歐系`;
        for (const [name, data] of Object.entries(certs.european)) {
            section += `\n- ${name}: ${data.description?.substring(0, 30) || ''}`;
        }
    }

    return section;
}

/**
 * 建構添加劑匹配結果區塊
 */
function buildAdditiveMatchSection(additiveMatch) {
    if (!additiveMatch?.items?.length) return '';

    const items = additiveMatch.items.map(item =>
        `- ${item.problem}: ${item.solutions?.join(', ') || '待確認'}`
    ).join('\n');

    return `## 🎯 症狀匹配結果
${items}

請根據上述匹配結果推薦產品。`;
}

/**
 * 根據 Agent 類型建構完整 Prompt
 * @param {string} agentType - Agent 類型
 * @param {Object} knowledge - 知識
 * @param {Object} intent - 意圖
 * @param {string} productContext - 產品資料
 * @returns {string} - 完整 Prompt
 */
function buildAgentPrompt(agentType, knowledge, intent, productContext) {
    switch (agentType) {
        case AGENT_TYPES.GREETING:
            return buildGreetingPrompt();

        case AGENT_TYPES.PRODUCT_OIL:
            return buildOilPrompt(knowledge, intent, productContext);

        case AGENT_TYPES.PRODUCT_ADDITIVE:
            return buildAdditivePrompt(knowledge, intent, productContext);

        case AGENT_TYPES.PURCHASE:
            return buildPurchasePrompt();

        case AGENT_TYPES.COOPERATION:
            return buildCooperationPrompt();

        case AGENT_TYPES.PRICE:
            return buildPricePrompt(productContext);

        case AGENT_TYPES.GENERAL:
        default:
            return buildGeneralPrompt(knowledge, intent, productContext);
    }
}

module.exports = {
    AGENT_TYPES,
    selectAgent,
    buildAgentPrompt,
    // 匯出個別 prompt 建構函式，方便測試
    buildGreetingPrompt,
    buildOilPrompt,
    buildAdditivePrompt,
    buildPurchasePrompt,
    buildCooperationPrompt,
    buildPricePrompt,
    buildGeneralPrompt
};
