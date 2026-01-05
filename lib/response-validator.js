/**
 * LIQUI MOLY Chatbot - Response Validator
 * 產品驗證層 - 檢查 AI 回覆中的 SKU 是否存在於產品資料庫
 * 
 * 設計原則：
 * - 從知識庫載入驗證規則（非硬編碼）
 * - 驗證失敗時移除無效產品並加上警告
 * - 不影響正常回覆流程
 */

const { loadJSON } = require('./knowledge-cache');

// 載入驗證規則
const antiHallucinationRules = loadJSON('anti-hallucination-rules.json') || {};
const validationRules = antiHallucinationRules.product_validation || {};

/**
 * 從文字中提取 SKU
 * @param {string} text - AI 回覆文字
 * @returns {string[]} - 提取到的 SKU 列表
 */
function extractSKUs(text) {
    if (!text) return [];

    // 使用知識庫定義的 pattern，或預設值
    const patternStr = validationRules.sku_pattern || 'LM[0-9]{4,5}';
    const pattern = new RegExp(patternStr, 'gi');

    const matches = text.match(pattern) || [];
    // 標準化為大寫並去重
    const uniqueSKUs = [...new Set(matches.map(sku => sku.toUpperCase()))];

    console.log(`[Validator] Extracted ${uniqueSKUs.length} unique SKUs:`, uniqueSKUs);
    return uniqueSKUs;
}

/**
 * 驗證 SKU 是否存在於產品資料庫
 * @param {string} sku - 產品編號
 * @param {Array} productList - 產品列表
 * @returns {boolean} - 是否存在
 */
function validateSKU(sku, productList) {
    if (!productList || productList.length === 0) {
        console.warn('[Validator] Product list is empty, skipping validation');
        return true; // 無法驗證時預設通過
    }

    const normalizedSku = sku.toUpperCase();
    const found = productList.some(p =>
        p.partno && p.partno.toUpperCase() === normalizedSku
    );

    return found;
}

/**
 * 驗證 AI 回覆並處理無效產品
 * @param {string} aiResponse - AI 原始回覆
 * @param {Array} productList - 產品資料庫
 * @returns {Object} - { validatedResponse, hasInvalidSKUs, invalidSKUs }
 */
function validateAIResponse(aiResponse, productList) {
    if (!aiResponse) {
        return { validatedResponse: aiResponse, hasInvalidSKUs: false, invalidSKUs: [] };
    }

    // 提取所有 SKU
    const extractedSKUs = extractSKUs(aiResponse);

    if (extractedSKUs.length === 0) {
        // 沒有 SKU，直接返回
        return { validatedResponse: aiResponse, hasInvalidSKUs: false, invalidSKUs: [] };
    }

    // 驗證每個 SKU
    const invalidSKUs = [];
    const validSKUs = [];

    for (const sku of extractedSKUs) {
        if (validateSKU(sku, productList)) {
            validSKUs.push(sku);
        } else {
            invalidSKUs.push(sku);
        }
    }

    console.log(`[Validator] Valid: ${validSKUs.length}, Invalid: ${invalidSKUs.length}`);

    if (invalidSKUs.length === 0) {
        // 全部有效
        return { validatedResponse: aiResponse, hasInvalidSKUs: false, invalidSKUs: [] };
    }

    // 有無效 SKU，需要處理
    let validatedResponse = aiResponse;
    const action = validationRules.on_invalid_sku?.action || 'remove_and_warn';

    if (action === 'remove_and_warn') {
        // 移除包含無效 SKU 的產品推薦段落
        for (const sku of invalidSKUs) {
            // 嘗試移除包含該 SKU 的整行或整個產品區塊
            // Pattern 1: 列表項目 (1. 產品名稱 (LM9999)...)
            const listPattern = new RegExp(`\\d+\\.\\s*[^\\n]*${sku}[^\\n]*(?:\\n[^\\d\\n][^\\n]*)*`, 'gi');
            validatedResponse = validatedResponse.replace(listPattern, '');

            // Pattern 2: 單行包含 SKU
            const linePattern = new RegExp(`[^\\n]*${sku}[^\\n]*\\n?`, 'gi');
            validatedResponse = validatedResponse.replace(linePattern, '');
        }

        // 清理多餘的空行
        validatedResponse = validatedResponse.replace(/\n{3,}/g, '\n\n');

        // 加上警告訊息
        const warningMessage = validationRules.on_invalid_sku?.warning_message || '';
        if (warningMessage && invalidSKUs.length > 0) {
            validatedResponse = `${warningMessage}\n\n${validatedResponse}`;
        }
    }

    // 如果所有產品都無效
    if (validSKUs.length === 0 && invalidSKUs.length > 0) {
        const fallbackResponse = validationRules.on_all_invalid?.response ||
            '很抱歉，我無法找到符合您需求的產品。請聯繫客服。';
        validatedResponse = fallbackResponse;
    }

    console.log(`[Validator] Response validated, removed ${invalidSKUs.length} invalid SKUs`);

    return {
        validatedResponse: validatedResponse.trim(),
        hasInvalidSKUs: invalidSKUs.length > 0,
        invalidSKUs
    };
}

module.exports = {
    extractSKUs,
    validateSKU,
    validateAIResponse
};
