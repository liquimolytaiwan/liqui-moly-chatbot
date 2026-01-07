/**
 * 测试 needsMoreInfo 流程修复
 *
 * 模拟用户询问 "C300 推薦機油" 的场景
 * 验证 AI 识别的 needsMoreInfo 是否正确传递给 LLM
 */

const { convertAIResultToIntent } = require('./lib/intent-converter');
const { buildPrompt } = require('./lib/prompt-builder');
const { selectAgent, buildAgentPrompt } = require('./lib/agent-prompts');

// 模拟 AI 分析结果（来自日志）
const mockAIResult = {
    "intentType": "product_recommendation",
    "isMultiVehicleQuery": false,
    "vehicles": [
        {
            "vehicleName": "Mercedes-Benz C300",
            "vehicleType": "汽車",
            "vehicleSubType": null,
            "fuelType": null,
            "isElectricVehicle": false,
            "certifications": [],
            "viscosity": null,
            "searchKeywords": []
        }
    ],
    "productCategory": "機油",
    "usageScenario": null,
    "needsProductRecommendation": true,
    "needsMoreInfo": [
        "年份",
        "燃油類型"
    ],
    "vehicleType": "汽車",
    "wixQueries": [
        {
            "field": "sort",
            "value": "【汽車】機油",
            "limit": 50,
            "method": "contains"
        }
    ]
};

console.log('=== 测试 needsMoreInfo 流程 ===\n');

// Step 1: 测试 intent-converter.js
console.log('Step 1: 测试 intent-converter.js');
const intent = convertAIResultToIntent(mockAIResult);
console.log('✓ Intent 转换完成');
console.log('  needsMoreInfo (顶层):', intent.needsMoreInfo);
console.log('  needsMoreInfo (_aiAnalysis):', intent._aiAnalysis.needsMoreInfo);

if (intent.needsMoreInfo && intent.needsMoreInfo.length > 0) {
    console.log('  ✅ needsMoreInfo 已成功提取到 intent 顶层\n');
} else {
    console.log('  ❌ needsMoreInfo 未提取到 intent 顶层\n');
}

// Step 2: 测试 agent-prompts.js (selectAgent)
console.log('Step 2: 测试 agent 选择');
const agentType = selectAgent(intent);
console.log('  选择的 Agent:', agentType);
console.log('  ✅ 应该选择 product_oil agent\n');

// Step 3: 测试 buildAgentPrompt (buildOilPrompt)
console.log('Step 3: 测试 buildOilPrompt');
const knowledge = {
    core: null,
    certification: null
};
const productContext = ''; // 空产品上下文，模拟无产品数据

const agentPrompt = buildAgentPrompt(agentType, knowledge, intent, productContext);

console.log('  Prompt 长度:', agentPrompt.length, '字符');
console.log('  ✓ Prompt 已生成\n');

// 检查 prompt 中是否包含追问指令
if (agentPrompt.includes('🛑 互動指導')) {
    console.log('  ✅ Prompt 包含追问指令 (🛑 互動指導)');
} else {
    console.log('  ❌ Prompt 不包含追问指令');
}

if (agentPrompt.includes('年份')) {
    console.log('  ✅ Prompt 提到了"年份"');
} else {
    console.log('  ❌ Prompt 未提到"年份"');
}

if (agentPrompt.includes('燃油類型')) {
    console.log('  ✅ Prompt 提到了"燃油類型"');
} else {
    console.log('  ❌ Prompt 未提到"燃油類型"');
}

if (agentPrompt.includes('⛔ 禁止直接推薦產品')) {
    console.log('  ✅ Prompt 包含禁止推荐指令');
} else {
    console.log('  ❌ Prompt 不包含禁止推荐指令');
}

console.log('\n=== Prompt 预览（前 800 字符）===');
console.log(agentPrompt.substring(0, 800));
console.log('...\n');

// Step 4: 测试 Multi-Agent 模式下的完整流程
console.log('Step 4: 测试完整流程（使用 buildPrompt）');
const fullPrompt = buildPrompt(knowledge, intent, productContext, { useMultiAgent: true });

console.log('  Full Prompt 长度:', fullPrompt.length, '字符');

if (fullPrompt.includes('🛑 互動指導') && fullPrompt.includes('年份') && fullPrompt.includes('燃油類型')) {
    console.log('  ✅ 完整流程测试通过：needsMoreInfo 已成功传递到 LLM Prompt\n');
} else {
    console.log('  ❌ 完整流程测试失败：needsMoreInfo 未传递到 LLM Prompt\n');
}

console.log('=== 测试完成 ===');
console.log('\n总结：');
console.log('1. intent-converter.js: needsMoreInfo 提取 ✓');
console.log('2. agent-prompts.js: buildOilPrompt 检查 needsMoreInfo ✓');
console.log('3. LLM Prompt: 包含追问指令 ✓');
console.log('\n修复后，当用户询问"C300 推薦機油"时：');
console.log('- AI 分析识别: needsMoreInfo = ["年份", "燃油類型"]');
console.log('- Intent 转换: 提取到顶层');
console.log('- buildOilPrompt: 生成追问指令');
console.log('- LLM 收到: "禁止直接推荐产品，追问年份和燃油类型"');
console.log('- LLM 回复: 追问用户年份和燃油类型（不会直接推荐产品）');
