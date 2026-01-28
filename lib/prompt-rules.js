/**
 * LIQUI MOLY Chatbot - AI Prompt 規則模組
 * 
 * 解決 Lost in the Middle 問題：
 * - 按需載入規則（只載入相關規則）
 * - 規則精簡化（移除冗餘）
 * 
 * v1.0: 從 analyze.js 抽取
 */

// ============================================
// 核心規則（永遠載入，放在頭尾）
// ============================================

const CORE_RULES = {
    // 產品類別判斷（最重要）
    PRODUCT_CATEGORY: `**產品類別判斷**：
「機油」「oil」「黏度」→機油 | 「添加劑」「漏油」「吃油」→添加劑 | 「變速箱」「ATF」「DSG」→變速箱油 | 只說「產品」→追問
⛔ 禁止：用戶說「產品推薦」時假設為機油！`,

    // 意圖判斷
    INTENT: `**意圖判斷**：
有推薦需求→needsProductRecommendation=true | 只報車型→general_inquiry | 問價格→price_inquiry`,

    // 結尾強調
    ENDING: `⚠️ 確認：「機油推薦」→機油 | 「產品推薦」→追問 | 歐系車須推論認證 | 禁止追問黏度`
};

// ============================================
// 情境規則（按需載入）
// ============================================

const CONDITIONAL_RULES = {
    // 電動車規則
    EV: `【純電動車】Gogoro/Tesla/BYD→isElectricVehicle=true，推薦齒輪油或煞車油`,

    // 添加劑規則
    ADDITIVE: `【添加劑】
- 引擎添加劑(Cera Tec/MoS2/Oil Additive)→只需車型，不問變速箱
- 變速箱添加劑(ATF Additive)→需問變速箱類型
⚠️ 症狀查詢須確認車型：汽車吃機油→LM1019/2501 | 機車吃機油→LM20597`,

    // 變速箱油規則
    TRANSMISSION: `【變速箱油認證】
須知車型+年份+變速箱類型才能推論認證：
- VW/Audi DSG 6速濕式→Top Tec 1800 | 7速乾式→Top Tec 1700
- BMW ZF 6HP(舊款)→LifeguardFluid 6 | ZF 8HP(新款)→LifeguardFluid 8
- Benz 7G→MB 236.14 | 9G→MB 236.17
- Toyota→WS | Honda→Honda ATF | Hyundai/Kia→SP-IV
⚠️ 資訊不足須追問！`,

    // 機油推論規則
    OIL: `【機油推論】
- 燃油類型必問（除非用戶已說明）
- 黏度用LLM知識推論，禁止追問用戶偏好
- 歐系車須推論車廠認證`
};

// ============================================
// 輔助規則
// ============================================

const HELPER_RULES = {
    // 產品別名
    ALIASES: `魔護→Molygen | 頂技→Top Tec | 特技→Special Tec | 油路清→Engine Flush | 機油精→Oil Additive`,

    // 基本判斷
    BASIC: `全合成/賽道/跑山→recommendSynthetic="full" | 大瓶/4L/5L→preferLargePack=true`
};

// ============================================
// 按需載入函式
// ============================================

/**
 * 根據訊息內容動態載入相關規則
 * @param {string} message - 用戶訊息
 * @param {string} contextText - 對話上下文
 * @returns {string} - 組合後的規則
 */
function getConditionalRules(message, contextText = '') {
    const rules = [];
    const combined = `${message} ${contextText}`.toLowerCase();

    // 電動車規則
    if (/gogoro|ionex|emoving|tesla|byd|taycan|電動車|電動機車|純電/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.EV);
    }

    // 添加劑規則
    if (/漏油|吃油|異音|過熱|抖動|添加劑|cera\s*tec|mos2|機油精|oil\s*additive|engine\s*flush|止漏|清潔/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.ADDITIVE);
    }

    // 變速箱規則
    if (/變速箱|atf|dsg|手排|自排|齒輪油|gear\s*oil|cvt/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.TRANSMISSION);
    }

    // 機油規則（若沒載入其他規則，預設載入）
    if (rules.length === 0 || /機油|oil|推薦/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.OIL);
    }

    return rules.join('\n\n');
}

/**
 * 建構完整的分析 Prompt（Sandwich Pattern）
 * @param {Object} params - 參數
 * @param {string} params.message - 用戶訊息
 * @param {string} params.contextSummary - 對話上下文摘要
 * @param {string} params.symptomContext - 症狀上下文
 * @param {string} params.symptomGuide - 症狀指南
 * @param {string} params.responseFormat - 回應格式
 * @param {string} params.intentTypeRules - 意圖類型規則
 * @returns {string} - 完整 Prompt
 */
function buildAnalysisPrompt(params) {
    const {
        message,
        contextSummary = '',
        symptomContext = '',
        symptomGuide = '',
        responseFormat,
        intentTypeRules = ''
    } = params;

    const conditionalRules = getConditionalRules(message, contextSummary);

    // Sandwich Pattern: 頭尾放核心規則
    return `你是汽機車專家。分析用戶問題並返回 JSON。

【🔴 LAYER 1: 核心規則 - 必須遵守！🔴】
${CORE_RULES.PRODUCT_CATEGORY}

${CORE_RULES.INTENT}
${intentTypeRules}

${HELPER_RULES.ALIASES}
${HELPER_RULES.BASIC}

【LAYER 2: 情境規則】
${conditionalRules}

【LAYER 3: 輸入與輸出】
${contextSummary}${symptomContext}用戶問題：「${message}」
${symptomGuide}

返回格式：
${responseFormat}

【🔴 結尾強調 🔴】
${CORE_RULES.ENDING}
只返回 JSON。`;
}

module.exports = {
    CORE_RULES,
    CONDITIONAL_RULES,
    HELPER_RULES,
    getConditionalRules,
    buildAnalysisPrompt
};
