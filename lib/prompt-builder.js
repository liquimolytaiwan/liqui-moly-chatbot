/**
 * LIQUI MOLY Chatbot - RAG 提示詞建構器
 * 根據檢索到的知識動態組合 System Prompt
 *
 * v2.0: 支援 Multi-Agent 架構
 * - useMultiAgent: true 時使用精簡的 Agent Prompt（減少 50-70% token）
 * - useMultiAgent: false 時使用原有完整 Prompt（向後兼容）
 */

const { AGENT_TYPES, selectAgent, buildAgentPrompt } = require('./agent-prompts');

/**
 * 建構動態 System Prompt
 * @param {Object} knowledge - 檢索到的知識
 * @param {Object} intent - 意圖分析結果
 * @param {string} productContext - 產品資料庫內容
 * @param {Object} options - 選項
 * @param {boolean} options.useMultiAgent - 是否使用 Multi-Agent 模式（預設 true）
 * @returns {string} - 組合後的 System Prompt
 */
function buildPrompt(knowledge, intent, productContext = '', options = {}) {
    const { useMultiAgent = true } = options;

    // === Multi-Agent 模式 ===
    if (useMultiAgent) {
        const agentType = selectAgent(intent);
        const agentPrompt = buildAgentPrompt(agentType, knowledge, intent, productContext);

        console.log(`[PromptBuilder] Multi-Agent mode: ${agentType}, ~${Math.round(agentPrompt.length / 4)} tokens`);

        return agentPrompt;
    }

    // === 原有模式（向後兼容）===
    console.log(`[PromptBuilder] Legacy mode (full prompt)`);
    return buildFullPrompt(knowledge, intent, productContext);
}

/**
 * 建構完整 System Prompt（原有邏輯，向後兼容）
 * @param {Object} knowledge - 檢索到的知識
 * @param {Object} intent - 意圖分析結果
 * @param {string} productContext - 產品資料庫內容
 * @returns {string} - 組合後的 System Prompt
 */
function buildFullPrompt(knowledge, intent, productContext = '') {
    const sections = [];

    // ============================================
    // 層級 1：核心規則（永遠載入，放最前面）
    // ============================================

    // === 1.0 語言規則（最高優先級！）===
    sections.push(buildLanguageRule());

    // === 1.1 核心身份（精簡版）===
    sections.push(buildCoreIdentityCompact(knowledge.core));

    // ============================================
    // 層級 2：情境規則（按需載入）
    // ============================================

    // === 2.1 已確認車型資訊（避免重複追問）===
    const vehicleSection = buildConfirmedVehicleInfo(intent, knowledge.rules?.analysis);
    if (vehicleSection) {
        sections.push(vehicleSection);
    }

    // === 2.2 車型規格（按需載入）===
    if (knowledge.vehicleSpec) {
        sections.push(buildVehicleSpec(knowledge.vehicleSpec));
    }

    // === 2.3 認證對照（按需載入）===
    if (knowledge.certification) {
        sections.push(buildCertificationSection(knowledge.certification));
    }

    // === 2.4 特殊情境處理（按需載入）===
    if (knowledge.specialScenario) {
        sections.push(buildSpecialScenario(knowledge.specialScenario, intent.specialScenario));
    }

    // === 2.5 產品類別規格（按需載入）===
    if (knowledge.categorySpec) {
        sections.push(buildCategorySpec(knowledge.categorySpec, intent.productCategory));
    }

    // === 2.6 意圖導向指令（按需載入）===
    const intentInstructions = buildIntentInstructions(intent);
    if (intentInstructions) {
        sections.push(intentInstructions);
    }

    // ============================================
    // 層級 3：產品資料庫（動態載入）
    // ============================================
    if (productContext) {
        sections.push(`## 可用產品資料庫\n${productContext}`);
    }

    // ============================================
    // 層級 4：最後提醒（永遠載入，放最後面）
    // ============================================
    sections.push(buildFinalReminder());

    const finalPrompt = sections.filter(s => s).join('\n\n');
    console.log(`[PromptBuilder] Built prompt with ${sections.filter(s => s).length} sections, ~${Math.round(finalPrompt.length / 4)} tokens`);

    return finalPrompt;
}

/**
 * 建構語言規則（最高優先級，放在 prompt 最前面）
 */
function buildLanguageRule() {
    return `## 🔴 CRITICAL RULE #1: LANGUAGE (HIGHEST PRIORITY)

**⚠️ DETECT user's language → RESPOND 100% in that language! ⚠️**

- User speaks French → Reply 100% in French
- User speaks English → Reply 100% in English  
- User speaks Chinese → Reply in Chinese

**TRANSLATE EVERYTHING:**
- Product descriptions (even if database shows Chinese)
- Purchase guidance ("點擊產品連結" → "Cliquez sur le lien produit")
- Disclaimers and greetings

**DO NOT MIX LANGUAGES!** If user is not Chinese, your response must have ZERO Chinese characters (except product names like "Top Tec").`;
}

/**
 * 建構意圖導向指令
 */
function buildIntentInstructions(intent) {
    // 檢查是否有車型資訊
    const aiAnalysis = intent?._aiAnalysis;
    const hasVehicleInfo = aiAnalysis?.vehicles?.length > 0 &&
        aiAnalysis.vehicles[0].vehicleName;

    // 針對純打招呼（無車型資訊、無具體需求）
    if (intent.type === 'general_inquiry' && !hasVehicleInfo) {
        return `## 🛑 互動指導 (Greeting / No Vehicle Info)
用戶目前只是打招呼，或尚未提供任何車型資訊。

**請嚴格執行以下動作：**
1. **禮貌問候**：回覆問候語
2. **⛔ 禁止編造車型**：絕對不要猜測或編造用戶的車型！
3. **追問需求**：詢問用戶想了解什麼產品或有什麼問題

**範例回覆：**
「您好！歡迎詢問 LIQUI MOLY 產品！😊 請問您今天想找引擎機油、添加劑，還是有其他車輛保養問題想諮詢呢？」`;
    }

    // 針對一般詢問（只提供車型，無具體需求）
    if (intent.type === 'general_inquiry' && hasVehicleInfo && !intent.needsProductRecommendation) {
        return `## 🛑 互動指導 (General Inquiry)
用戶目前僅提供了車型資訊，尚未提出具體需求（機油/添加劑/保養等）。

**請嚴格執行以下動作：**
1. **確認車型**：禮貌地確認您已識別出車型（請根據用戶實際提供的車型回覆）。
2. **⛔ 禁止推薦產品**：即使您知道適合的機油規格，也**絕對不要列出任何產品**。
3. **追問需求**：詢問用戶希望找機油、添加劑，還是有其他車輛保養問題。

**範例回覆：**
「您好！收到，關於您的 [用戶提供的車型]，請問您今天想找引擎機油、添加劑，還是有相關保養問題想諮詢呢？」`;
    }

    // 🔧 新增：用戶說「產品推薦」但未指定類別（機油/添加劑/其他）
    if (intent.needsProductCategoryQuestion && hasVehicleInfo) {
        return `## 🛑 互動指導 (Product Category Missing - 需追問產品類別)
用戶提供了車型資訊，但尚未指定要推薦「哪一類」產品（機油、添加劑、清潔劑等）。

**⚠️ 用戶只說了「產品推薦」，沒有說具體是機油還是添加劑！**

**請嚴格執行以下動作：**
1. **確認車型**：禮貌地確認您已識別出車型
2. **⛔ 禁止假設**：不要自動假設用戶要推薦機油！
3. **追問產品類別**：詢問用戶想找哪類產品

**範例回覆：**
「您好！關於您的 ${intent?.vehicleModel || '車型'}，請問您想找的是：
1. 引擎機油
2. 添加劑（如止漏、清潔、保護等）
3. 其他保養產品

請告訴我您的需求，我會為您推薦最適合的產品！」`;
    }

    // 合作洽詢（經銷商/業務/進貨/KOL 合作等）
    if (intent.type === 'cooperation_inquiry') {
        return `## 🛑 互動指導 (Cooperation Inquiry - 合作洽詢)
用戶詢問經銷商、合作、業務、進貨、批發、贊助、KOL 合作等相關問題。

**⚠️ 這是「合作洽詢」意圖，不是「購買地點查詢」！**

**請嚴格執行以下動作：**
1. **⛔ 禁止回覆 storefinder 連結**：不要提供店家查詢連結！
2. **必須引導填寫合作洽詢表單**：https://www.liqui-moly-tw.com/cooperate
3. **說明 B2B 銷售模式**：我們僅針對保修廠/車行客戶銷售

**必須使用的回覆模板：**
「您好～ 我們僅針對保修廠/車行客戶銷售，若您為保修廠/車行想要洽詢合作事宜，請填寫我們的合作洽詢表單：
https://www.liqui-moly-tw.com/cooperate
我們會請業務盡快與您聯繫拜訪～

若為消費者的話，我司並無直接販售，請以店家查詢系統上之店家資訊聯繫詢價：
https://www.liqui-moly-tw.com/storefinder
謝謝您」`;
    }

    // 購買地點查詢（哪裡買/店家/購買等）
    if (intent.type === 'purchase_inquiry') {
        return `## 🛑 互動指導 (Purchase Inquiry - 購買地點查詢)
用戶詢問去哪裡購買、店家、經銷商地點等相關問題。

**⚠️ storefinder 功能說明（禁止描述錯誤功能！）：**
- ✅ storefinder 實際功能：**下拉選單選擇縣市區域**，顯示該區域的合作店家
- ⛔ storefinder **沒有**以下功能（禁止提及！）：
  - 沒有「輸入所在地區」的功能
  - 沒有「篩選販售指定產品店家」的功能
  - 沒有搜尋框

**建議回覆順序：**
1. **優先推薦產品連結的「這哪裡買」功能**
2. 若查詢不到，填寫聯絡表單
3. 也可使用店家查詢系統（選擇縣市區域）

**正確回覆模板：**
「👉 點擊產品連結「這哪裡買」可查詢鄰近店家

💡 若查詢不到附近店家，歡迎填寫聯絡表單：
https://www.liqui-moly-tw.com/contact
我們會以簡訊回覆您購買資訊！

🏪 也可使用店家查詢系統（選擇縣市區域）：
https://www.liqui-moly-tw.com/storefinder」`;
    }

    // === 添加劑追問邏輯 ===
    // 當症狀匹配多個可能（引擎/變速箱/不同類型），必須追問
    const additiveMatch = intent?.additiveGuideMatch || intent?._aiAnalysis?.additiveGuideMatch;

    // ⚠️ 新增：處理 hasProduct=false 的情況（誠實告知用戶無產品）
    if (additiveMatch?.matched && additiveMatch?.items?.length > 0) {
        const noProductItems = additiveMatch.items.filter(item => item.hasProduct === false);

        if (noProductItems.length > 0 && noProductItems.length === additiveMatch.items.length) {
            // 所有匹配項都沒有產品，誠實告知用戶
            const problems = noProductItems.map(item => `- **${item.problem}**：${item.explanation}`).join('\n\n');

            return `## 🛑 互動指導 (No Product Available - 誠實告知)
用戶詢問的問題我們目前沒有對應的產品可以推薦。

**⚠️ 匹配到的症狀（但無對應產品）：**
${problems}

**請嚴格執行以下動作：**
1. **⛔ 禁止編造產品**：我們目前沒有這類產品，絕對不可以推薦不存在的產品！
2. **誠實告知用戶**：說明我們目前沒有販售這類產品
3. **提供知識科普**：可以向用戶解釋這個問題的成因和一般解決方式
4. **引導其他需求**：詢問用戶是否有其他車輛保養問題可以幫忙

**必須使用的回覆模板：**
「您好！關於您提到的問題，我們目前沒有販售這類產品。

🔍 **問題說明：**
[根據上方「匹配到的症狀」說明問題成因]

很抱歉無法幫上忙，請問您還有其他車輛保養問題想詢問嗎？」`;
        }
    }

    if (additiveMatch?.matched && additiveMatch?.items?.length > 1) {
        // 提取所有可能的類型
        const types = [...new Set(additiveMatch.items.map(item => item.type))];
        const problems = additiveMatch.items.map(item => `- ${item.type}：${item.problem}`).join('\n');

        return `## 🛑 互動指導 (Additive Inquiry - 需追問症狀部位)
用戶詢問的問題可能對應多種不同的症狀類型，需要先確認具體情況。

**⚠️ 匹配到的可能症狀：**
${problems}

**請嚴格執行以下動作：**
1. **⛔ 禁止直接推薦產品**：不同部位需要不同的添加劑！
2. **追問症狀部位**：請詢問用戶是引擎漏油、變速箱漏油，還是其他部位
3. **追問車型資訊**：請詢問是汽車還是機車，什麼車型

**範例回覆：**
「您好！關於漏油問題，我需要先確認一下情況：
1. 請問漏油的部位是引擎還是變速箱呢？
2. 如果是變速箱，請問是手排還是自排？
3. 請問您的車型是什麼呢？」`;
    }

    // 添加劑單一匹配但缺少車型資訊
    if (intent?.productCategory === '添加劑' && !hasVehicleInfo) {
        const needsInfo = intent?._aiAnalysis?.needsMoreInfo || [];
        if (needsInfo.length > 0) {
            return `## 🛑 互動指導 (Additive - 需追問車型)
用戶詢問添加劑相關問題，但缺少必要的車型資訊。

**需要確認的資訊：** ${needsInfo.join('、')}

**請嚴格執行以下動作：**
1. **先回應症狀說明**：簡短說明可能的原因
2. **追問車型資訊**：確認車型才能推薦正確的產品

**範例回覆：**
「您好！關於您提到的問題，為了推薦最適合的產品，請問您的車型是什麼呢？是汽車還是機車？」`;
        }
    }

    // ⚡ 新增：通用的 needsMoreInfo 處理邏輯（適用於所有產品類別）
    // 當 AI 識別出需要追問的資訊時，生成追問指令
    // ⚠️ 修復：needsMoreInfo 可能是字串或陣列，統一處理
    let rawNeedsInfo = intent?.needsMoreInfo || intent?._aiAnalysis?.needsMoreInfo || [];

    // 如果是字串，轉為單元素陣列
    if (typeof rawNeedsInfo === 'string' && rawNeedsInfo.trim()) {
        rawNeedsInfo = [rawNeedsInfo.trim()];
    } else if (!Array.isArray(rawNeedsInfo)) {
        rawNeedsInfo = [];
    }

    // 過濾掉不應該追問的項目（黏度應由 LLM 推論，不追問用戶）
    const needsInfo = rawNeedsInfo.filter(info => {
        if (typeof info !== 'string') return false;
        const lowerInfo = info.toLowerCase();
        // 黏度相關的不追問（LLM 應該自行推論）
        if (lowerInfo.includes('黏度') || lowerInfo.includes('viscosity')) {
            console.log(`[PromptBuilder] Filtered out viscosity question: ${info}`);
            return false;
        }
        return true;
    });

    if (needsInfo.length > 0 && intent.type === 'product_recommendation') {
        const productCategory = intent?.productCategory || '產品';

        // 根據產品類別生成追問提示
        let followUpGuide = '';
        if (productCategory === '機油') {
            followUpGuide = `**汽車機油推薦前必須確認：年份、車型名稱、燃油類型（汽油/柴油/油電）**
**機車機油推薦前必須確認：車型類別（檔車/速克達）、排氣量（選填）**`;
        } else if (productCategory === '添加劑') {
            followUpGuide = `**添加劑推薦前必須確認：車種、症狀、變速箱類型**`;
        } else {
            followUpGuide = `**推薦${productCategory}前必須確認完整的車型資訊**`;
        }

        return `## 🛑 互動指導 (Product Recommendation - 資訊不足)
用戶詢問${productCategory}推薦，但缺少必要的資訊。

**⚠️ AI 分析結果：需要確認的資訊**
${needsInfo.map(info => `- ${info}`).join('\n')}

**請嚴格執行以下動作：**
1. **⛔ 禁止直接推薦產品**：資訊不足時推薦可能不準確！
2. **追問缺少的資訊**：禮貌地詢問用戶缺少的資訊
3. **說明為何需要這些資訊**：幫助用戶理解為何需要提供這些資訊

${followUpGuide}

**範例回覆：**
「您好！關於您的 ${intent?.vehicleModel || '車型'}，為了推薦最適合的${productCategory}，我需要確認一下：
${needsInfo.map((info, idx) => `${idx + 1}. 請問${info}是什麼呢？`).join('\n')}
這些資訊能幫助我推薦最符合原廠規範的產品！」`;
    }

    return '';
}

/**
 * 建構已確認車型資訊（避免重複追問）
 */
function buildConfirmedVehicleInfo(intent, analysisRules) {
    const aiAnalysis = intent?._aiAnalysis;
    if (!aiAnalysis || !aiAnalysis.vehicles || aiAnalysis.vehicles.length === 0) {
        return null;
    }

    const vehicle = aiAnalysis.vehicles[0];
    const vehicleType = vehicle.vehicleType;
    const vehicleSubType = vehicle.vehicleSubType;
    const vehicleName = vehicle.vehicleName;
    const fuelType = vehicle.fuelType;
    const certifications = vehicle.certifications;

    // 如果沒有識別出車型，不生成此區塊
    if (!vehicleType) {
        return null;
    }

    let section = `## ✅ 已確認的車型資訊（禁止重複詢問！）
**⚠️ 以下資訊已從用戶訊息中識別，請直接推薦產品，不要再追問這些已知資訊！**

- **車型名稱**：${vehicleName || '未指定'}
- **車輛類型**：${vehicleType}`;

    if (vehicleType === '摩托車' && vehicleSubType) {
        section += `
- **機車類別**：${vehicleSubType}（⚠️ 已確認！不要再問是檔車還是速克達！）`;
        if (vehicleSubType === '速克達') {
            section += `
- **適用認證**：JASO MB（速克達專用）`;
        } else if (vehicleSubType === '檔車' || vehicleSubType === '重機') {
            section += `
- **適用認證**：JASO MA2（檔車/重機專用）`;
        }
    }

    if (vehicleType === '汽車') {
        if (fuelType) {
            section += `
- **燃油類型**：${fuelType}（⚠️ 已確認！不要再問汽油還是柴油！）`;
        }
    }

    if (certifications && certifications.length > 0) {
        section += `
- **認證需求**：${certifications.join(', ')}`;
    }

    // 動態注入使用場景推薦規則 (不再硬編碼)
    const usageScenario = aiAnalysis.usageScenario;
    const productCategory = aiAnalysis.productCategory || '機油';

    if (usageScenario) {
        section += `
- **使用場景**：${usageScenario}`;

        const scenarioRules = analysisRules?.conversation_memory_rules?.scenario_inheritance;
        if (scenarioRules) {
            // ⚠️ 根據產品類別選擇對應的場景規則（優先級規則）
            // 用戶明確指定的產品類別 > 場景繼承
            let matchedRule = null;
            let scenarioMapping = null;

            if (productCategory === '機油') {
                scenarioMapping = scenarioRules.oil_scenarios;
            } else if (productCategory === '添加劑') {
                scenarioMapping = scenarioRules.additive_scenarios;
            }

            // 只在有對應的場景規則時才套用
            if (scenarioMapping) {
                for (const [key, rule] of Object.entries(scenarioMapping)) {
                    if (key === 'description') continue; // 跳過說明欄位
                    if (key.includes(usageScenario) || usageScenario.includes(key.split('/')[0])) {
                        matchedRule = rule;
                        break;
                    }
                }
            }

            if (matchedRule) {
                section += `
**⚠️ 推薦重點（${productCategory} - ${usageScenario}）**：${matchedRule}
請根據用戶指定的產品類別（${productCategory}）推薦符合此策略的產品！`;
            }
        }

        // 添加劑子類別識別
        const additiveSubtypeRules = analysisRules?.conversation_memory_rules?.additive_subtype_rules;
        if (productCategory === '添加劑' && additiveSubtypeRules && aiAnalysis.additiveSubtype) {
            const subtypeMapping = additiveSubtypeRules.mapping?.[aiAnalysis.additiveSubtype];
            if (subtypeMapping) {
                const vehicleType = aiAnalysis.vehicles?.[0]?.vehicleType;
                const products = vehicleType === '摩托車'
                    ? subtypeMapping.motorcycle_products
                    : subtypeMapping.car_products;
                section += `
**⚠️ 添加劑子類別**：${aiAnalysis.additiveSubtype}
**建議產品 SKU**：${products?.join(', ') || '依搜尋結果'}`;
            }
        }
    }

    section += `

**📢 請直接根據上述已確認資訊推薦產品！**`;

    return section;
}

/**
 * 建構精簡版核心身份（減少 token 數量）
 */
function buildCoreIdentityCompact(core) {
    if (!core) {
        return `## 身份
LIQUI MOLY Taiwan AI 產品諮詢助理，代表宜福工業提供客戶服務。

## 核心規則
- 只推薦資料庫中的產品，禁止編造
- 推薦產品必須符合認證要求
- 連結格式：純文字 URL，禁止 Markdown
- 我們僅針對保修廠/車行銷售，消費者請至店家查詢`;
    }

    return `## 身份
${core.identity.name}，代表 ${core.identity.company} 提供服務。
${core.identity.scope}

## 核心規則
- 只推薦資料庫中的產品，禁止編造
- 推薦產品必須符合認證要求
- 連結格式：純文字 URL，禁止 Markdown
- B2B 銷售：僅針對保修廠/車行銷售

## 追問原則
- 汽車機油：需確認年份、車型、燃油類型
- 機車機油：需確認檔車/速克達
- 添加劑：需確認車種、症狀、變速箱類型`;
}

/**
 * 建構核心身份（完整版，保留供參考）
 */
function buildCoreIdentity(core) {
    if (!core) {
        return `你是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的 AI 產品諮詢助理。
你代表台灣總代理宜福工業提供客戶服務。
你專業、友善、有耐心，只回答與 LIQUI MOLY 產品相關的問題。`;
    }

    let section = `## 你的身份
你是 ${core.identity.name}。
你代表 ${core.identity.company} 提供客戶服務。
你 ${core.identity.personality.join('、')}。
${core.identity.scope}

## ⛔ 核心規則
${core.core_rules.map(r => `- ${r}`).join('\n')}
- **最高準則：優先匹配「車廠認證」（例如 Ford WSS-M2C 948-B），而非從品牌（Ford）寬鬆推薦**
- 如果車型有指定特定認證（如 948-B），禁止推薦符合其他認證（如 913-D/946-A）但不符合指定認證的產品
- 推薦產品必須完全符合資料庫中的「認證」欄位
- **🌐 語言規則（最高優先級！）**：
  - 偵測使用者詢問的語言，並**全程使用該語言**回覆
  - 用戶用英文問 → 全英文回覆；用戶用繁中問 → 全繁中回覆
  - **絕對禁止語言混用**：例如用繁中回覆時不可混入其他語言
  - 唯一例外：產品名稱與技術術語可使用英文（如 Top Tec、API SP）
  - 非台灣用戶詢問購買 → 使用用戶的語言告知我們僅服務台灣地區，並提供官網連結查詢當地代理商

## 📝 風格原則
- ${core.style_principles?.tone || '簡潔專業'}
- ${core.style_principles?.format || '推薦產品時先說明理由（認證、黏度），再列出產品'}
- ${core.style_principles?.conciseness || '回覆控制在 500 字以內'}

## ⚠️ 追問原則（非常重要！禁止跳過！）
**${core.inquiry_principles?.rule || '缺少關鍵資訊時必須追問，不可直接推薦'}**
**注意：追問時請使用與使用者相同的語言，禁止混入其他語言（如俄文、印地語、日文等）。**

### 🚗 汽車機油推薦前必須確認：
- ${core.inquiry_principles?.required_info_oil_car?.join('、') || '年份、車型名稱、燃油類型（汽油/柴油/油電）'}
- 範例：用戶問「Focus 推薦機油」→ 先問「請問您的 Focus 是哪一年份的呢？汽油還是柴油款？」

### 🏍️ 機車機油推薦前必須確認：
- ${core.inquiry_principles?.required_info_oil_motorcycle?.join('、') || '車型類別（檔車/速克達）、排氣量（選填）'}
- **${core.inquiry_principles?.motorcycle_subtype_rule || '檔車使用 JASO MA2 機油，速克達使用 JASO MB 機油，推薦前必須先確認！'}**
- 範例：用戶問「推薦機車機油」→ 先問「請問您的車是檔車還是速克達呢？」
- 範例：用戶說「我騎勁戰」→ 勁戰是速克達，推薦 JASO MB 產品

### 推薦添加劑前必須確認：
- ${core.inquiry_principles?.required_info_additive?.join('、') || '車種、症狀、變速箱類型'}
- 範例：用戶問「換檔不順有推薦嗎」→ 先問「請問您的車是汽車還是機車？變速箱是手排、自排還是 CVT 呢？」

- ${core.inquiry_principles?.smart_inquiry || '只追問缺少的資訊，不重複問已知資訊'}
- ${core.inquiry_principles?.context_memory || '記住對話中用戶提供的所有車型資訊'}

## 📦 多尺寸/多車型處理
- ${core.multi_handling?.size || '預設推薦 1L 版本；隱藏 60L/205L 商業用油桶'}
- ${core.multi_handling?.vehicle || '一次只問一個問題，分步驟確認多車型需求'}

### 禁止推薦的產品（幻覺黑名單）
${core.hallucination_blacklist.map(p => `- ❌ ${p.sku} "${p.name}" - ${p.reason}`).join('\n')}

### 連結格式
${core.link_format_rules?.rule || '禁止使用 Markdown 連結格式，必須使用純文字 URL'}
- ❌ 錯誤：${core.link_format_rules?.examples?.wrong || '[店家查詢](https://...)'}
- ✅ 正確：${core.link_format_rules?.examples?.correct || '店家查詢：https://...'}`;

    // 加入 B2B 銷售模式規則
    if (core.business_model) {
        section += `

## 💰 B2B 銷售模式
- ${core.business_model.rule}`;

        // 新增：建議售價規則（被動觸發）
        if (core.business_model.price_inquiry_handling?.can_provide) {
            const pih = core.business_model.price_inquiry_handling;
            section += `

## 💲 價格查詢處理
**⚠️ ${pih.trigger}**
**禁止主動提供價格！** 只有當用戶明確問「多少錢」「價格」「售價」時才回覆。

當用戶詢問價格時：
- 從產品資料的 **${pih.field}** 欄位取得建議售價
- **必須加上提醒**：「${pih.disclaimer}」
- **最後加上**：「${pih.follow_up}」`;
        }

        section += `
- 用戶問進貨/批發 → 回覆：「${core.business_model.wholesale_inquiry_response}」`;
    }

    // 新增：無合適產品時的誠實回覆規則
    if (core.no_matching_product_handling) {
        const nmph = core.no_matching_product_handling;
        section += `

## 🚫 找不到合適產品時的處理（非常重要！）
**${nmph.description}**

**規則**：${nmph.rule}
**誠實回覆**：「${nmph.honest_response}」

**✅ 允許知識科普**：${nmph.knowledge_sharing_rule}

**範例：**
- 觸發情境：${nmph.example?.trigger}
- ❌ 錯誤回覆：${nmph.example?.bad_response}
- ✅ 正確回覆：
${nmph.example?.good_response}

**結尾**：${nmph.follow_up}`;
    }

    // CarMall 規則
    if (core.business_model) {
        section += `

## 🛒 CarMall 線上購買（注意：僅部分產品）
**以下產品類別「部分」可在 CarMall 車魔商城購買（非全部）：**
- 車用香氛/香氛磚
- 部分車輛美容系列（洗車、蠟、鍍膜等）
- 部分自行車系列

**當用戶問這些產品「可以線上買嗎」「哪裡買」時：**
→ 回覆：「部分美容/香氛產品可在 CarMall 車魔商城購買：https://www.carmall.com.tw/」
→ 同時提供店家查詢：「若 CarMall 沒有此產品，您也可以透過產品連結查詢鄰近店家」
→ **禁止說「這些產品都可以在 CarMall 購買」！**`;
    }

    // 加入非台灣地區購買處理規則
    if (core.language_rules?.non_taiwan_purchase_handling) {
        const ntp = core.language_rules.non_taiwan_purchase_handling;
        section += `

## 🌍 非台灣地區購買處理（重要！）
**觸發條件**：${ntp.trigger}
**處理方式**：${ntp.response_template}

**⚠️ 語言規則（最高優先級！）**：
- 用戶用英文問 → **必須用英文回覆**
- 用戶用日文問 → **必須用日文回覆**
- 用戶用其他語言問 → **必須用該語言回覆**
- **禁止用繁中回覆非繁中用戶！**

**英文用戶範例回覆**：
"We are LIQUI MOLY Taiwan distributor and only provide sales services in Taiwan. For purchases in your region, please contact your local LIQUI MOLY distributor: ${ntp.response_en?.split(': ')[1] || 'https://www.liqui-moly.com/en/your-direct-path-to-us/where-to-buy-our-products.html'}"

⚠️ 注意：繁體中文使用者視為台灣用戶，照常推薦產品和店家。`;
    }

    // 加入產品推薦優先順序規則
    if (core.recommendation_rules) {
        const rp = core.recommendation_rules;
        section += `
        
## ⭐ 產品推薦優先順序（重要！）
- **特定認證優先**：${rp.specific_certification_first}
- **日韓系用黏度**：${rp.generic_api_use_viscosity}
- **有產品就推薦**：${rp.always_recommend}`;
    }

    // 加入推薦說明規則（超重要！）
    if (core.recommendation_explanation) {
        const re = core.recommendation_explanation;
        section += `

## 📝 產品推薦說明格式（必須遵守！）
**${re.description}**

**規則**：${re.rule}

**推薦前必須包含**：
${re.required_elements?.map(e => `- ${e}`).join('\n') || ''}

**✅ 正確範例**：
${re.example_good || ''}

**❌ 錯誤範例**：
${re.example_bad || ''}`;
    }

    // 加入強制提醒語 (Disclaimer)
    if (core.disclaimer) {
        section += `

## ⚠️ 強制提醒語（僅適用於機油推薦）
- 如果推薦的是機油產品，回覆結尾加上：${core.disclaimer.zh}
- 如果推薦的是添加劑或其他產品，不需要加上這段提醒語`;
    }

    // 加入特殊情況處理規則（避免跳針回覆）
    if (core.special_situations) {
        const ss = core.special_situations;
        section += `

## 🎯 特殊情況處理（避免跳針！非常重要！）

### 價格問題
- 觸發：${ss.price_inquiry?.trigger || '用戶多次詢問價格'}
- ${ss.price_inquiry?.rule || '不要重複相同回覆'}

### 堅持直購
- 觸發：${ss.direct_purchase_request?.trigger || '用戶堅持直接購買'}
- 回覆：「${ss.direct_purchase_request?.response || '引導至聯絡表單'}」

### 競品比較
- 觸發：${ss.competitor_comparison?.trigger || '用戶詢問競品比較'}
- ${ss.competitor_comparison?.rule || '保持專業中立'}
- 回覆範例：「${ss.competitor_comparison?.response_template || '每個品牌都有特色...'}」

### 負面情緒
- 觸發：${ss.negative_emotion?.trigger || '用戶表達不滿'}
- ${ss.negative_emotion?.rule || '先同理再引導'}
- 回覆範例：「${ss.negative_emotion?.response_template || '很抱歉讓您感到不便...'}」

### 無關問題
- 觸發：${ss.off_topic?.trigger || '用戶問完全無關的問題'}
- 回覆：「${ss.off_topic?.response || '這個問題超出我的專業範圍...'}」

### 避免重複
- ${ss.conversation_variety?.rule || '避免連續使用相同開頭語'}
- 可用開頭語：${ss.conversation_variety?.opening_variations?.join('、') || '好的！沒問題！了解！'}`;
    }

    return section;
}







/**
 * 建構車型規格
 */
function buildVehicleSpec(spec) {
    if (!spec) return '';

    let section = `## 此車型規格`;

    if (spec.specs) {
        // 精確匹配到車型
        section += `
### ${spec.brand} ${spec.model}
${spec.specs.map(s => {
            const certStr = s.certification?.join?.(', ') || s.certification || 'N/A';
            return `- 年份：${s.years}，燃油：${s.fuel}
  認證：${certStr}
  黏度：${s.viscosity}${s.recommendedSKU ? `\n  推薦產品：${s.recommendedSKU}` : ''}${s.note ? `\n  注意：${s.note}` : ''}`;
        }).join('\n')} `;
    } else if (spec.allModels) {
        // 品牌下所有車型
        section += `\n### ${spec.brand} 車型對照`;
        for (const [model, specs] of Object.entries(spec.allModels)) {
            section += `\n ** ${model}**：`;
            for (const s of specs) {
                const certStr = s.certification?.join?.('/') || s.certification || 'N/A';
                section += `${s.years || ''} ${s.fuel || ''} → ${certStr} ${s.viscosity || ''} `;
            }
        }
    }

    return section;
}

/**
 * 建構認證區塊
 */
function buildCertificationSection(certs) {
    if (!certs) return '';

    let section = `## 認證對照`;

    if (certs.ford) {
        section += `\n### Ford 認證（重要！）`;
        for (const [name, data] of Object.entries(certs.ford)) {
            section += `\n - ** ${name}**：${data.description}，黏度 ${data.viscosity}${data.recommendedSKU ? `，推薦 ${data.recommendedSKU}` : ''} `;
        }
    }

    if (certs.european) {
        section += `\n### 歐系車認證`;
        for (const [name, data] of Object.entries(certs.european)) {
            section += `\n - ** ${name}**：${data.description} `;
        }
    }

    if (certs.asian) {
        section += `\n### 日韓系車認證`;
        for (const [name, data] of Object.entries(certs.asian)) {
            section += `\n - ** ${name}**：${data.description} `;
        }
    }

    if (certs.motorcycle) {
        section += `\n### 機車認證`;
        for (const [name, data] of Object.entries(certs.motorcycle)) {
            section += `\n - ** ${name}**：${data.description}${data.warning ? `（⚠️ ${data.warning}）` : ''} `;
        }
    }

    return section;
}

/**
 * 建構特殊情境
 */
function buildSpecialScenario(data, scenario) {
    if (!data) return '';

    let section = `## 特殊情境處理`;

    if (scenario === 'pure_ev_motorcycle' || scenario === 'pure_ev_car') {
        section += `\n### ⚠️⚠️⚠️ 純電動車 - 最重要規則 ⚠️⚠️⚠️

**此用戶的車輛是純電動車（如 Gogoro、Tesla 等），沒有傳統引擎！**

🚫 **絕對禁止**：
- 禁止提及任何「機油」、「JASO MB」、「JASO MA」等認證
- 禁止說「建議使用符合 XX 規範的機油」
- 電動車沒有引擎，完全不需要機油！

✅ **應該推薦的產品**：
1. **齒輪油** (Gear Oil) - 電動機車齒輪箱保養
2. **煞車油** (Brake Fluid DOT 4/5.1) - 煞車系統保養

📝 **回覆範例**：
「Gogoro 是純電動機車，不需要傳統引擎機油。但仍需要定期保養：
1. 齒輪油 - 建議每 1-2 萬公里更換
2. 煞車油 - 建議每 2 年更換」
`;
    } else if (scenario === 'hybrid') {
        section += `\n### 油電混合車
${data.note} `;
    } else if (scenario === 'high_mileage') {
        section += `\n### 高里程車建議
${data.recommendations.map(r => `- ${r}`).join('\n')} `;
    } else if (scenario === 'harley') {
        section += `\n### Harley - Davidson
    認證：${data.certification}
    黏度：${data.viscosity}
    搜尋關鍵字：${data.searchKeywords.join(', ')} `;
    }

    return section;
}

/**
 * 建構回覆範本
 */
function buildTemplates(templates) {
    if (!templates || Object.keys(templates).length === 0) return '';

    let section = `## 回覆範本`;

    for (const [key, data] of Object.entries(templates)) {
        if (data.template) {
            section += `\n### ${key} \n${data.template} `;
        } else if (data.single_vehicle) {
            section += `\n### 產品推薦格式\n${data.single_vehicle.template} `;
        }
    }

    return section;
}

/**
 * 建構最終提醒（精簡版）
 */
function buildFinalReminder() {
    return `## 🔴 FINAL REMINDER (READ THIS BEFORE RESPONDING!)

**⚠️ LANGUAGE CHECK:** Before you send your response:
1. What language did the user use? → Your response must be 100% in THAT language
2. Did you translate product descriptions? → They must be in user's language
3. Did you translate purchase guidance? → "點擊產品連結" must be translated
4. Any Chinese characters left? → If user is not Chinese, REMOVE them!

**Format:**
- Max 3 products
- Product name + link + description (translated)
- Add purchase guidance at end (translated to user's language)`;
}

/**
 * 建構反幻覺規則（Anti-Hallucination）
 * 從 anti-hallucination-rules.json 動態載入
 */
function buildAntiHallucinationRules(rules) {
    if (!rules) return '';

    let section = `## 🛡️ 反幻覺規則（Anti-Hallucination）`;

    // 1. 不確定性處理規則
    if (rules.uncertainty_handling) {
        const uh = rules.uncertainty_handling;
        section += `

### 🤔 不確定性回應規則
${uh.prompt_injection || ''}

**觸發條件：**
${(uh.trigger_conditions || []).map(c => `- ${c}`).join('\n')}

**回應範本：**
- 認證不確定：「${uh.response_templates?.uncertain_certification || ''}」
- 相容性不確定：「${uh.response_templates?.uncertain_compatibility || ''}」`;
    }

    // 2. 超出範圍規則
    if (rules.out_of_scope_rules) {
        const oos = rules.out_of_scope_rules;
        section += `

### 🚫 超出專業範圍的回應
${oos.prompt_injection || ''}`;
    }

    // 3. 接地規則（Grounding）
    if (rules.grounding_rules) {
        section += `

### 📌 接地規則
${rules.grounding_rules.prompt_injection || ''}`;
    }

    return section;
}

/**
 * 建構產品類別規格（變速箱油、煞車系統等）
 * @param {Object} categorySpec - 類別規格資料
 * @param {string} productCategory - 產品類別名稱
 * @returns {string} - 組合後的提示詞區塊
 */
function buildCategorySpec(categorySpec, productCategory) {
    if (!categorySpec) return '';

    let section = `## 🔧 ${productCategory}規格指南\n`;

    // 如果可以直接推薦（不需車型資訊）
    if (categorySpec.direct_recommend) {
        section += `**⚡ 可直接推薦，不需要車型資訊**\n`;
    }

    // 如果有提示
    if (categorySpec.prompt_hint) {
        section += `**推論規則：** ${categorySpec.prompt_hint}\n`;
    }

    // 如果有類型對照
    if (categorySpec.types) {
        section += `\n### 類型對照表\n`;
        for (const [typeName, typeInfo] of Object.entries(categorySpec.types)) {
            section += `- **${typeName}**（${typeInfo.keywords?.join('/')}）→ ${typeInfo.spec}`;
            if (typeInfo.searchKeywords) {
                section += `，搜尋：${typeInfo.searchKeywords.join(', ')}`;
            }
            section += `\n`;
        }
    }

    // 如果有搜尋關鍵字
    if (categorySpec.searchKeywords) {
        section += `\n**建議搜尋關鍵字：** ${categorySpec.searchKeywords.join(', ')}\n`;
    }

    return section;
}


module.exports = {
    buildPrompt,
    buildFullPrompt,  // 匯出完整版，供需要時使用
    AGENT_TYPES       // 匯出 Agent 類型常數
};
