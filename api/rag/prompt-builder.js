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

### 禁止推薦的產品（幻覺黑名單）
${core.hallucination_blacklist.map(p => `- ❌ ${p.sku} "${p.name}" - ${p.reason}`).join('\n')}

### 連結格式
${core.link_format_rules.rule}
- ❌ 錯誤：${core.link_format_rules.examples.wrong}
- ✅ 正確：${core.link_format_rules.examples.correct}`;

    return section;
}

/**
 * 建構對話規則
 */
function buildConversationRules(rules) {
    if (!rules) return '';

    const conv = rules.conversation_rules || {};
    let section = `## 對話規則`;

    if (conv.vehicle_retention) {
        section += `
### 車型保留
${conv.vehicle_retention.rule}
- ${conv.vehicle_retention.motorcycle_rule}
- ${conv.vehicle_retention.car_rule}`;
    }

    if (conv.polite_response) {
        section += `
### 禮貌性回應
當用戶說「${conv.polite_response.trigger_keywords.join('」「')}」時：${conv.polite_response.rule}
正確回應：「${conv.polite_response.correct_response}」`;
    }

    // 添加劑追問規則
    if (conv.additive_inquiry) {
        const addInq = conv.additive_inquiry;
        section += `
### 🧪 添加劑追問規則
${addInq.rule}
**當用戶問添加劑但沒說明用途時，必須追問：**
「${addInq.smart_inquiry?.inquiry_template || '請問您想解決什麼問題？'}」

**重要：上下文記憶**
${addInq.context_retention?.rule || '必須記住對話中已提到的車型'}
- ${addInq.context_retention?.example || '用戶先問 Ninja 400 機油 → 再問添加劑 → 應記住是摩托車'}`;
    }

    // 安全檢查
    const safety = rules.safety_check_rules || {};

    // 智慧追問規則（重要！）
    if (safety.car_oil_mandatory_inquiry) {
        const inquiry = safety.car_oil_mandatory_inquiry;
        const smartInquiry = inquiry.smart_inquiry || {};
        section += `
### ⚠️ 智慧追問規則（必須遵守）
${inquiry.rule}
**智慧判斷缺少哪些資訊，只追問缺少的部分：**
- 必要資訊：${smartInquiry.required_info?.join('、') || '年份、CC數、燃油種類'}
- 如果用戶已提供年份，不要再問年份
- 如果用戶已提供排氣量，不要再問排氣量
- 禁止詢問：${inquiry.forbidden?.join('、') || '引擎型號、引擎代碼'}

範例：
- 用戶說「2018 Elantra 推薦機油」→ 只問「請問是 1.6L 還是 2.0L？汽油還是柴油款？」
- 用戶說「Focus 推薦機油」→ 問「請問年份、排氣量和燃油種類？」`;
    }

    // 推薦格式規則（重要！）
    if (safety.recommendation_format) {
        const format = safety.recommendation_format;
        section += `
### 📋 推薦格式要求
${format.rule}
**推薦產品前，必須先說明：**
1. 根據用戶提供的車型年份、燃油類型
2. 說明原廠建議的認證標準
3. 說明建議的黏度規格
4. 然後再列出推薦產品

範例格式：
「${format.example}」`;
    }

    if (safety.mandatory_disclaimer) {
        section += `
### 強制提醒語
${safety.mandatory_disclaimer.zh}`;
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
  黏度：${s.viscosity}${s.recommendedSKU ? `\n  推薦產品：${s.recommendedSKU}` : ''}${s.note ? `\n  注意：${s.note}` : ''}`).join('\n')}`;
    } else if (spec.allModels) {
        // 品牌下所有車型
        section += `\n### ${spec.brand} 車型對照`;
        for (const [model, specs] of Object.entries(spec.allModels)) {
            section += `\n**${model}**：`;
            for (const s of specs) {
                section += `${s.years} ${s.fuel} → ${s.certification.join('/')} ${s.viscosity}`;
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
            section += `\n- **${name}**：${data.description}，黏度 ${data.viscosity}${data.recommendedSKU ? `，推薦 ${data.recommendedSKU}` : ''}`;
        }
    }

    if (certs.european) {
        section += `\n### 歐系車認證`;
        for (const [name, data] of Object.entries(certs.european)) {
            section += `\n- **${name}**：${data.description}`;
        }
    }

    if (certs.asian) {
        section += `\n### 日韓系車認證`;
        for (const [name, data] of Object.entries(certs.asian)) {
            section += `\n- **${name}**：${data.description}`;
        }
    }

    if (certs.motorcycle) {
        section += `\n### 機車認證`;
        for (const [name, data] of Object.entries(certs.motorcycle)) {
            section += `\n- **${name}**：${data.description}${data.warning ? `（⚠️ ${data.warning}）` : ''}`;
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
${data.response}`;
    } else if (scenario === 'hybrid') {
        section += `\n### 油電混合車
${data.note}`;
    } else if (scenario === 'high_mileage') {
        section += `\n### 高里程車建議
${data.recommendations.map(r => `- ${r}`).join('\n')}`;
    } else if (scenario === 'harley') {
        section += `\n### Harley-Davidson
認證：${data.certification}
黏度：${data.viscosity}
搜尋關鍵字：${data.searchKeywords.join(', ')}`;
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
            section += `\n### ${key}\n${data.template}`;
        } else if (data.single_vehicle) {
            section += `\n### 產品推薦格式\n${data.single_vehicle.template}`;
        }
    }

    return section;
}

/**
 * 建構最終提醒
 */
function buildFinalReminder() {
    return `## 重要提醒
- 只推薦上方「可用產品資料庫」中的產品
- 連結必須是 https://www.liqui-moly-tw.com/products/ 開頭
- 禁止編造不存在的產品
- 最多推薦 3-5 個產品，控制在 500 字以內`;
}

module.exports = {
    buildPrompt
};
