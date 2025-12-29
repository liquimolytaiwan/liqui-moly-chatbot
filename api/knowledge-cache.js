/**
 * LIQUI MOLY Chatbot - Knowledge Cache Singleton
 * 統一的知識庫快取模組，避免重複 IO 操作
 * 
 * 設計原則：
 * - 單例模式：所有模組共享同一份快取
 * - 延遲載入：首次使用時才載入
 * - 冷啟動友善：Serverless 每次冷啟動會重新初始化
 */

const fs = require('fs');
const path = require('path');

// 知識庫快取（模組級別單例）
const knowledgeCache = {};

/**
 * 載入 JSON 知識庫檔案（帶快取）
 * @param {string} filename - 檔案名稱（不含路徑）
 * @returns {Object|null} - JSON 內容或 null
 */
function loadJSON(filename) {
    // 快取命中
    if (knowledgeCache[filename]) {
        return knowledgeCache[filename];
    }

    // 快取未命中，從磁碟載入
    try {
        const filePath = path.join(process.cwd(), 'data', 'knowledge', filename);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        knowledgeCache[filename] = data;
        console.log(`[KnowledgeCache] Loaded and cached: ${filename}`);
        return data;
    } catch (e) {
        console.warn(`[KnowledgeCache] Failed to load ${filename}:`, e.message);
        return null;
    }
}

/**
 * 取得所有已快取的檔案名稱
 * @returns {string[]} - 快取的檔案名稱列表
 */
function getCachedFiles() {
    return Object.keys(knowledgeCache);
}

/**
 * 清除快取（用於測試或強制重載）
 */
function clearCache() {
    for (const key of Object.keys(knowledgeCache)) {
        delete knowledgeCache[key];
    }
    console.log('[KnowledgeCache] Cache cleared');
}

/**
 * 預載入所有知識庫檔案（可選，用於減少首次請求延遲）
 */
function preloadAll() {
    const files = [
        'core-identity.json',
        'vehicle-specs.json',
        'additive-guide.json',
        'ai-analysis-rules.json',
        'response-templates.json',
        'search-reference.json',
        'urls.json'
    ];

    for (const file of files) {
        loadJSON(file);
    }
    console.log(`[KnowledgeCache] Preloaded ${files.length} files`);
}

module.exports = {
    loadJSON,
    getCachedFiles,
    clearCache,
    preloadAll
};
