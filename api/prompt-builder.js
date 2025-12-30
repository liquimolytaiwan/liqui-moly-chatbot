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
    const vehicleSection = buildConfirmedVehicleInfo(intent, knowledge.rules?.analysis);
    if (vehicleSection) {
        sections.push(vehicleSection);
    }

    // (舊的会話規則已合併至核心身份)

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
- **語言一致性（最高優先級！）**：偵測使用者詢問的語言，並**全程使用該語言**回覆。**絕對禁止語言混用**：例如用繁中回覆時不可突然出現印地語（如 यह जानकारी）、俄文（如 уточнить）、日文假名、韓文等其他語言。唯一例外是產品名稱與技術術語（英文）。

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

**範例回覆（英文）**：
"${ntp.response_en}"

**範例回覆（中文，供非台灣繁中使用者）**：
"${ntp.response_zh}"

⚠️ 注意：此規則只在使用者用非繁體中文詢問購買時觸發。繁體中文使用者視為台灣用戶，照常推薦產品和店家。`;
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
 * 建構最終提醒
 */
function buildFinalReminder() {
    return `## ⚠️ 重要提醒（必須遵守）
- **🌐 語言一致性確認**：回覆前請確認全文語言一致！若發現混入其他語言（如俄文、印地語、日文等），必須刪除並以使用者的語言重新撰寫！
- 只推薦上方「可用產品資料庫」中的產品
- **最多推薦 3 個產品**（太多會讓用戶混亂）
- **回覆控制在 300 字以內**（過長會導致訊息被截斷）

## ⛔ 絕對禁止事項（違反將導致嚴重錯誤）
1. **產品名稱必須 100% 忠於資料庫**：
   - **唯一真理是 Product Context**：即便你認為某產品有名稱錯誤或更好的翻譯，也來自內建知識，也**嚴禁修改**。
   - 必須 **一字不差** 地複製 Product Context 中提供的產品標題（包含中文與英文）。
   - 若資料庫標題是 English-Only，就只顯示英文；若包含中文，必須完整保留。
   - 禁止將 "Special Tec F" 改寫為 "Leichtlauf High Tech" 或其他別名。

2. **禁止編造**：
   - 禁止編造產品連結、認證與說明（僅能引用資料庫內容）。


## 📋 產品推薦格式（超重要！）
**推薦格式必須遵守：**

1. **產品名稱 + 編號** 放同一行
2. **產品連結** 放下一行
3. **產品說明** 放下一行（如有需要）
4. 每個產品之間空一行

**正確範例：**
1. Car Wash & Wax 含蠟洗車液（LM1542）
   產品連結：https://www.liqui-moly-tw.com/products/lm1542
   一次保養就能清潔並恢復車輛光澤，快速去除污垢不留痕跡。

2. Car Wash Shampoo 汽車洗車液（LM1545）
   產品連結：https://www.liqui-moly-tw.com/products/lm1545
   專為溫和清潔車體開發，可去除污垢與油性汙染。

**⛔ 禁止格式：**
- 產品名稱
* 產品連結：xxx（使用 * 會造成斷行不自然）

## 🛒 購買引導（推薦產品時必須加上！）
**每次推薦產品後，必須加上這段話：**
👉 點擊產品連結「這哪裡買」可查詢鄰近店家
💡 若查詢不到附近店家，歡迎填寫聯絡表單：https://www.liqui-moly-tw.com/contact

## 🚗🏍️ 多車型推薦規則
- 用戶同時詢問多個車型時，**必須分別列出每個車型的推薦產品**
- **汽車機油**：推薦「🚗 汽車機油」區塊的產品（不含 Motorbike）
- **摩托車機油**：推薦「🏍️ 摩托車機油」區塊的產品（標題含 Motorbike）
- 禁止混用！汽車不可推薦 Motorbike 產品，摩托車不可推薦汽車機油
- 如果資料庫有符合的產品，**禁止說「未顯示相關產品」或「資料庫沒有」**`;
}


module.exports = {
    buildPrompt
};
