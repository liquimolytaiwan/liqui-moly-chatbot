/**
 * LIQUI MOLY Chatbot - 搜尋輔助模組
 *
 * RAG 架構：從知識庫按需讀取搜尋相關資料
 * - categoryToSort: 產品類別對應 Wix sort 欄位
 * - oilOnlyKeywords: 機油專用關鍵字
 * - keywordMapping: 用戶關鍵字映射
 *
 * 設計原則：
 * 1. 從知識庫讀取，不硬編碼
 * 2. 帶快取減少 IO
 * 3. 提供便捷的存取函式
 */

const { loadJSON } = require('./knowledge-cache');

// 快取
let searchReferenceCache = null;

/**
 * 取得搜尋參考資料（帶快取）
 * @returns {Object}
 */
function getSearchReference() {
    if (!searchReferenceCache) {
        searchReferenceCache = loadJSON('search-reference.json') || {};
    }
    return searchReferenceCache;
}

/**
 * 取得產品類別對應 sort 欄位
 * @returns {Object} categoryToSort 對照表
 */
function getCategoryToSort() {
    const ref = getSearchReference();
    const raw = ref.categoryToSort || {};
    // 移除 _description 欄位
    const result = {};
    for (const key of Object.keys(raw)) {
        if (key !== '_description') {
            result[key] = raw[key];
        }
    }
    return result;
}

/**
 * 取得機油專用關鍵字
 * @returns {Array<string>}
 */
function getOilOnlyKeywords() {
    const ref = getSearchReference();
    return ref.oilOnlyKeywords?.keywords || [];
}

/**
 * 取得認證兼容性對照表
 * @returns {Object}
 */
function getCertificationCompatibility() {
    const ref = getSearchReference();
    return ref.certification_compatibility || {};
}

/**
 * 取得關鍵字映射表
 * @returns {Object}
 */
function getKeywordMapping() {
    const ref = getSearchReference();
    const raw = ref.keywordMapping || {};
    // 移除 _description 欄位
    const result = {};
    for (const key of Object.keys(raw)) {
        if (key !== '_description') {
            result[key] = raw[key];
        }
    }
    return result;
}

/**
 * 取得產品系列名稱
 * @returns {Object}
 */
function getProductSeries() {
    const ref = getSearchReference();
    const raw = ref.product_series || {};
    // 移除 _description 欄位
    const result = {};
    for (const key of Object.keys(raw)) {
        if (key !== '_description') {
            result[key] = raw[key];
        }
    }
    return result;
}

/**
 * 取得症狀對應 SKU
 * @returns {Object}
 */
function getSymptomToSku() {
    const ref = getSearchReference();
    const raw = ref.symptom_to_sku || {};
    // 移除 _description 欄位
    const result = {};
    for (const key of Object.keys(raw)) {
        if (key !== '_description') {
            result[key] = raw[key];
        }
    }
    return result;
}

/**
 * 清除快取
 */
function clearCache() {
    searchReferenceCache = null;
    console.log('[SearchHelper] Cache cleared');
}

module.exports = {
    getSearchReference,
    getCategoryToSort,
    getOilOnlyKeywords,
    getCertificationCompatibility,
    getKeywordMapping,
    getProductSeries,
    getSymptomToSku,
    clearCache
};
