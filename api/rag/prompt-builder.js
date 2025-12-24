/**
 * LIQUI MOLY Chatbot - RAG 提示詞建構器
 * 根據檢索到的知識動態組合 System Prompt
 */

/**
 * 建構動態 System Prompt
 * @param {Object} knowledge - 檢索到的知識
 * @param {Object} intent - 意圖分析結果
 * @param {string} productContext - 產品資料庫內容
 * @returns {string} - 組合後的 System Prompt
 */
function buildPrompt(knowledge, intent, productContext = '') {
    const sections = [];

    // === 1. 核心身份（永遠載入，約 300 tokens）===
    sections.push(buildCoreIdentity(knowledge.core));

    // === 1.5 已確認車型資訊（避免重複追問）===
    const vehicleSection = buildConfirmedVehicleInfo(intent);
    if (vehicleSection) {
        sections.push(vehicleSection);
    }

    // === 2. 對話規則（精簡版，約 200 tokens）===
    if (knowledge.rules?.conversation) {
        sections.push(buildConversationRules(knowledge.rules.conversation));
    }

    // === 3. 車型規格（按需載入）===
    if (knowledge.vehicleSpec) {
        sections.push(buildVehicleSpec(knowledge.vehicleSpec));
    }

    // === 4. 認證對照（按需載入）===
    if (knowledge.certification) {
        sections.push(buildCertificationSection(knowledge.certification));
    }

    // === 5. 特殊情境處理 ===
    if (knowledge.specialScenario) {
        sections.push(buildSpecialScenario(knowledge.specialScenario, intent.specialScenario));
    }

    // === 6. 回覆範本（按需載入）===
    if (Object.keys(knowledge.templates).length > 0) {
        sections.push(buildTemplates(knowledge.templates));
    }

    // === 7. 產品資料庫（動態傳入）===
    if (productContext) {
        sections.push(`## 可用產品資料庫\n${productContext}`);
    }

    // === 8. 最終提醒（約 100 tokens）===
    sections.push(buildFinalReminder());

    const finalPrompt = sections.filter(s => s).join('\n\n');
    console.log(`[PromptBuilder] Built prompt with ${sections.filter(s => s).length} sections, ~${Math.round(finalPrompt.length / 4)} tokens`);

    return finalPrompt;
}

/**
 * 建構已確認車型資訊（避免重複追問）
 */
function buildConfirmedVehicleInfo(intent) {
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

    section += `

**📢 請直接根據上述已確認資訊推薦產品！**`;

    return section;
}

/**
 * 建構核心身份
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
- **語言限制**：除產品名稱與技術術語（英文）外，**必須使用繁體中文**回應。絕對禁止輸出俄文（如 уточнить）、 Cyrillic 字母或其他非繁中語言。將所有思考過程轉化為繁體中文輸出。

## 📝 風格原則
- ${core.style_principles?.tone || '簡潔專業'}
- ${core.style_principles?.format || '推薦產品時先說明理由（認證、黏度），再列出產品'}
- ${core.style_principles?.conciseness || '回覆控制在 500 字以內'}

## ⚠️ 追問原則（非常重要！禁止跳過！）
**${core.inquiry_principles?.rule || '缺少關鍵資訊時必須追問，不可直接推薦'}**
**注意：追問時請務必使用繁體中文，禁止使用其他語言（尤其是俄文「уточнить」）作為結尾。**

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

## 💰 B2B 銷售模式（非常重要！）
- ${core.business_model.rule}
- **禁止說「可以提供報價」或「為您報價」**
- 用戶問價格/整箱/批發 → 回覆：「${core.business_model.price_inquiry_response}」
- 用戶問進貨/批發 → 回覆：「${core.business_model.wholesale_inquiry_response}」`;
    }

    return section;
}



/**
 * 建構對話規則（適配精簡後的新結構）
 */
function buildConversationRules(rules) {
    if (!rules) return '';

    let section = `## 對話規則`;

    // 新結構：principles
    if (rules.principles) {
        const p = rules.principles;
        section += `
### 原則
        - ** 車型特例 **：Ford Focus / Kuga EcoBoost 引擎只能用 5W - 20(948 - B)，** 絕對禁止 ** 推薦 5W - 30(913 - D)
            - ** 精確匹配認證 **：Ford 1.5 EcoBoost 必須用 948 - B，不可用 913 - D 或 946 - A
                - ${p.inquiry || '使用你的專業知識判斷需要哪些資訊，缺少則追問'}
    - ${p.context || '記住對話中用戶提供的所有車型資訊'}
    - ${p.format || '推薦前先說明理由（認證、黏度），再列出產品'}
    - ${p.professional_judgment || '使用 AI 內建的汽車知識判斷認證、黏度等'} `;
    }

    // 推薦優先順序規則（新增）
    if (rules.recommendation_priority) {
        const rp = rules.recommendation_priority;
        section += `
### ⭐ 產品推薦優先順序（重要！）
- ** 特定認證優先 **：${rp.specific_certification_first || '若車輛有車廠認證需求，必須優先推薦符合該認證的產品'}
- ** 日韓系用黏度 **：${rp.generic_api_use_viscosity || '日韓系車輛僅需 API 認證時，以符合建議黏度的產品為主'}
- ** 有產品就推薦 **：${rp.always_recommend || '只要資料庫有符合條件的產品就應該推薦，不要說「未顯示完全符合」'} `;
    }

    // 新結構：hard_rules
    if (rules.hard_rules) {
        const hr = rules.hard_rules;
        section += `
### 硬規則
        - ${hr.motorcycle_products || '摩托車用戶只能推薦標題含 Motorbike 的產品'}
    - ${hr.no_repeat || '禮貌性回應時禁止重複推薦產品'}
    - ${hr.category_match || '用戶問機油不可推薦添加劑'} `;
    }

    // 新結構：disclaimer
    if (rules.disclaimer) {
        section += `
### 強制提醒語
${rules.disclaimer.zh || '⚠️ 建議您參閱車主手冊確認適合的黏度與認證標準。'} `;
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
${spec.specs.map(s => `- 年份：${s.years}，燃油：${s.fuel}
  認證：${s.certification.join(', ')}
  黏度：${s.viscosity}${s.recommendedSKU ? `\n  推薦產品：${s.recommendedSKU}` : ''}${s.note ? `\n  注意：${s.note}` : ''}`).join('\n')
            } `;
    } else if (spec.allModels) {
        // 品牌下所有車型
        section += `\n### ${spec.brand} 車型對照`;
        for (const [model, specs] of Object.entries(spec.allModels)) {
            section += `\n ** ${model}**：`;
            for (const s of specs) {
                section += `${s.years} ${s.fuel} → ${s.certification.join('/')} ${s.viscosity} `;
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
        section += `\n### 電動車
${data.response} `;
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
 * 建構最終提醒
 */
function buildFinalReminder() {
    return `## ⚠️ 重要提醒（必須遵守）
    - 只推薦上方「可用產品資料庫」中的產品
        - 連結必須是 https://www.liqui-moly-tw.com/products/ 開頭
    - 禁止編造不存在的產品
        - ** 最多推薦 3 個產品 **（太多會讓用戶混亂）
- ** 回覆控制在 300 字以內 **（過長會導致訊息被截斷）
    - 每個產品只列出：名稱、產品編號、連結（省略詳細說明）

## 🚗🏍️ 多車型推薦規則（重要！）
    - 用戶同時詢問多個車型時，** 必須分別列出每個車型的推薦產品 **
- ** 汽車機油 **：推薦「🚗 汽車機油」區塊的產品（不含 Motorbike）
- ** 摩托車機油 **：推薦「🏍️ 摩托車機油」區塊的產品（標題含 Motorbike）
    - 禁止混用！汽車不可推薦 Motorbike 產品，摩托車不可推薦汽車機油
        - 如果資料庫有符合的產品，** 禁止說「未顯示相關產品」或「資料庫沒有」** `;
}


module.exports = {
    buildPrompt
};
