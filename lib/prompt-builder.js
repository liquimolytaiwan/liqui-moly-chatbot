/**
 * LIQUI MOLY Chatbot - RAG 提示詞建構器
 * 根據檢索到的知識動態組合 System Prompt
 *
 * v3.0: 移除 Legacy 模式，僅使用 Multi-Agent 架構
 * v3.1: 清理死代碼，移除未使用的 buildFullPrompt 及相關函式
 */

const { AGENT_TYPES, selectAgent, buildAgentPrompt } = require('./agent-prompts');

/**
 * 建構動態 System Prompt（Multi-Agent 模式）
 * @param {Object} knowledge - 檢索到的知識
 * @param {Object} intent - 意圖分析結果
 * @param {string} productContext - 產品資料庫內容
 * @param {Object} options - 選項（保留向後兼容，但不再使用）
 * @returns {string} - 組合後的 System Prompt
 */
function buildPrompt(knowledge, intent, productContext = '', options = {}) {
    const agentType = selectAgent(intent);
    const agentPrompt = buildAgentPrompt(agentType, knowledge, intent, productContext);

    console.log(`[PromptBuilder] Multi-Agent mode: ${agentType}, ~${Math.round(agentPrompt.length / 4)} tokens`);

    return agentPrompt;
}

module.exports = {
    buildPrompt,
    AGENT_TYPES  // 匯出 Agent 類型常數
};
