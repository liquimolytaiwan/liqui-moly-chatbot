/**
 * LIQUI MOLY Chatbot - Wix Velo Backend (簡化版)
 * 
 * 主要功能由 Vercel API 處理，Wix 只負責：
 * 1. 從 CMS 取得產品資料
 * 2. 管理對話 session
 * 3. 轉發請求到 Vercel API
 * 
 * 複製此檔案內容到 Wix Velo 的 backend/http-functions.js
 */

import { ok, badRequest, serverError } from 'wix-http-functions';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import wixData from 'wix-data';

// ============================================
// 常數定義
// ============================================

// Vercel API URL - 部署後替換為你的實際 URL
const VERCEL_API_URL = 'https://liqui-moly-chatbot.vercel.app';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

// ============================================
// OPTIONS 處理 - CORS
// ============================================

export function options_chat(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

export function options_startSession(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

export function options_endSession(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// POST /chat - 主要聊天 API（代理到 Vercel）
// ============================================

export async function post_chat(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.message || typeof body.message !== 'string') {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing or invalid message parameter" })
            });
        }

        // 取得對話歷史（如果有 sessionId）
        let conversationHistory = [];
        if (body.sessionId) {
            try {
                const session = await wixData.get('chatSessions', body.sessionId);
                if (session && session.messages) {
                    conversationHistory = JSON.parse(session.messages);
                }
            } catch (e) {
                console.error('Failed to get session:', e);
            }
        }

        // Step 1: 呼叫 Vercel API 進行 AI 分析
        let searchInfo = null;
        try {
            const analyzeResponse = await fetch(`${VERCEL_API_URL}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: body.message, conversationHistory })
            });
            const analyzeData = await analyzeResponse.json();
            if (analyzeData.success) {
                searchInfo = analyzeData.analysis;
            }
        } catch (e) {
            console.error('Vercel analyze API failed:', e);
        }

        // Step 2: 從 Wix CMS 搜尋產品
        let productContext = "目前沒有產品資料";
        try {
            productContext = await searchProducts(body.message, searchInfo);
            console.log('productContext 長度:', productContext.length);
        } catch (e) {
            console.error('Product search failed:', e);
        }

        // Step 3: 呼叫 Vercel API 進行聊天
        const chatResponse = await fetch(`${VERCEL_API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: body.message,
                conversationHistory,
                productContext
            })
        });
        const chatData = await chatResponse.json();

        if (!chatData.success) {
            throw new Error(chatData.error || 'Vercel chat API failed');
        }

        // Step 4: 儲存對話紀錄
        if (body.sessionId) {
            try {
                const session = await wixData.get('chatSessions', body.sessionId);
                if (session) {
                    let messages = [];
                    try {
                        messages = JSON.parse(session.messages || '[]');
                    } catch (e) {
                        messages = [];
                    }
                    messages.push({ role: 'user', content: body.message, timestamp: new Date().toISOString() });
                    messages.push({ role: 'assistant', content: chatData.response, timestamp: new Date().toISOString() });
                    session.messages = JSON.stringify(messages);
                    session.lastActivity = new Date();
                    await wixData.update('chatSessions', session);
                }
            } catch (e) {
                console.error('Failed to save session:', e);
            }
        }

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({ success: true, response: chatData.response })
        });

    } catch (error) {
        console.error('POST /chat error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: "Internal server error: " + error.message })
        });
    }
}

// ============================================
// POST /startSession - 開始新對話
// ============================================

export async function post_startSession(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        // 驗證必填欄位
        if (!body.userName || !body.userEmail || !body.category) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Missing required fields: userName, userEmail, category"
                })
            });
        }

        // 建立 session 記錄（包含用戶資訊）
        const sessionData = {
            userName: body.userName,
            userEmail: body.userEmail,
            userPhone: body.userPhone || '',
            category: body.category,
            messages: JSON.stringify([]),
            status: 'active',
            startTime: new Date(),
            lastActivity: new Date()
        };

        const result = await wixData.insert('chatSessions', sessionData);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                sessionId: result._id
            })
        });

    } catch (error) {
        console.error('POST /startSession error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: "Internal server error: " + error.message })
        });
    }
}

// ============================================
// POST /endSession - 結束對話
// ============================================

export async function post_endSession(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.sessionId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing sessionId" })
            });
        }

        const session = await wixData.get('chatSessions', body.sessionId);
        if (session) {
            session.status = 'ended';
            session.endTime = new Date();
            await wixData.update('chatSessions', session);
        }

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({ success: true, message: '對話已結束' })
        });

    } catch (error) {
        console.error('POST /endSession error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: "Internal server error: " + error.message })
        });
    }
}

// ============================================
// POST /rateSession - 對話評分
// ============================================

export function options_rateSession(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

export async function post_rateSession(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.sessionId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing sessionId" })
            });
        }

        const session = await wixData.get('chatSessions', body.sessionId);
        if (session) {
            session.rating = body.rating || 0;
            await wixData.update('chatSessions', session);
        }

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({ success: true })
        });

    } catch (error) {
        console.error('POST /rateSession error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: "Internal server error: " + error.message })
        });
    }
}

// ============================================
// GET /products - 取得產品列表
// ============================================

export function options_products(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

export async function get_products(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const results = await wixData.query('products')
            .ascending('title')
            .limit(1000)
            .find();

        const products = results.items.map(p => ({
            id: p._id,
            title: p.title,
            partno: p.partno,
            viscosity: p.word2,
            certifications: p.cert,
            category: p.sort,
            url: p.partno ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}` : null
        }));

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({ success: true, products: products })
        });

    } catch (error) {
        console.error('GET /products error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: "Internal server error: " + error.message })
        });
    }
}

// ============================================
// 產品搜尋邏輯
// ============================================

async function searchProducts(query, searchInfo) {
    try {
        let allResults = [];
        const queryLower = query.toLowerCase();

        // 摩托車品牌和車型關鍵字
        const motorcycleBrands = ['suzuki', 'honda', 'yamaha', 'kawasaki', 'ktm', 'ducati', 'harley', 'triumph', 'aprilia', 'vespa', 'sym', 'kymco', 'gogoro', 'pgo'];
        const motorcycleModels = ['dr-z', 'drz', 'cbr', 'ninja', 'r1', 'r6', 'mt-', 'yzf', 'gsx', 'z900', 'z1000', 'crf', 'pcx', 'nmax', 'xmax', 'forza', 'jet'];

        // 判斷車型
        const isMotorcycleQuery =
            queryLower.includes('機車') ||
            queryLower.includes('摩托車') ||
            queryLower.includes('速克達') ||
            queryLower.includes('檔車') ||
            queryLower.includes('重機') ||
            motorcycleBrands.some(brand => queryLower.includes(brand)) ||
            motorcycleModels.some(model => queryLower.includes(model)) ||
            (searchInfo && searchInfo.vehicleType === '摩托車');

        // 判斷是否為通用產品
        const hasGeneralKeywords = queryLower.includes('洗車') || queryLower.includes('洗') ||
            queryLower.includes('煞車') || queryLower.includes('船') ||
            queryLower.includes('冷卻') || queryLower.includes('自行車');

        // === 改進：先根據車型搜尋，確保摩托車查詢不會返回汽車產品 ===

        // Step 1: 根據車型載入基礎產品池
        if (isMotorcycleQuery || (searchInfo && searchInfo.vehicleType === '摩托車')) {
            // 摩托車優先搜尋 - 包含機車養護類別
            const motorcycleProducts = await wixData.query('products')
                .contains('sort', '摩托車')
                .limit(50)
                .find();
            allResults = motorcycleProducts.items;
            console.log('優先載入摩托車產品:', allResults.length);

            // 額外搜尋：標題包含 Motorbike 的產品（可能在其他分類）
            const motorbikeTitle = await wixData.query('products')
                .contains('title', 'Motorbike')
                .limit(30)
                .find();
            allResults = allResults.concat(motorbikeTitle.items);
            console.log('Motorbike 標題產品:', motorbikeTitle.items.length);

            // 如果用戶問添加劑，也搜尋汽車添加劑（部分適用於機車）
            if (queryLower.includes('添加') || queryLower.includes('油精') || 
                (searchInfo && searchInfo.productCategory === '添加劑')) {
                const additiveProducts = await wixData.query('products')
                    .contains('sort', '添加劑')
                    .limit(30)
                    .find();
                // 只加入標題含 Motorbike 或 MoS2 的添加劑
                const motorbikeAdditives = additiveProducts.items.filter(p => 
                    p.title && (p.title.includes('Motorbike') || p.title.includes('MoS2') || p.title.includes('二硫化鉬'))
                );
                allResults = allResults.concat(motorbikeAdditives);
                console.log('摩托車相關添加劑:', motorbikeAdditives.length);
            }
        } else if (hasGeneralKeywords) {
            // 通用產品搜尋
            const generalCategories = ['車輛美容', '化學品', '煞車', '冷卻', '船舶', '自行車'];
            for (const cat of generalCategories) {
                if (queryLower.includes(cat.replace('系列', '').replace('系統', '')) ||
                    (cat === '車輛美容' && queryLower.includes('洗')) ||
                    (cat === '船舶' && queryLower.includes('船'))) {
                    const catResults = await wixData.query('products')
                        .contains('sort', cat)
                        .limit(20)
                        .find();
                    allResults = allResults.concat(catResults.items);
                }
            }
        } else {
            // 預設搜尋汽車產品
            const carProducts = await wixData.query('products')
                .contains('sort', '汽車')
                .limit(50)
                .find();
            allResults = carProducts.items;
        }

        // Step 2: 如果 AI 有提供 searchKeywords，用它來過濾/補充結果
        if (searchInfo && searchInfo.searchKeywords && searchInfo.searchKeywords.length > 0) {
            const limitedKeywords = searchInfo.searchKeywords.slice(0, 2);
            for (const keyword of limitedKeywords) {
                // 搜尋標題包含關鍵字的產品（不限制車型）
                const keywordResults = await wixData.query('products')
                    .contains('title', keyword)
                    .limit(10)
                    .find();
                allResults = allResults.concat(keywordResults.items);
            }
        }

        // 去除重複
        const uniqueResults = [...new Map(allResults.map(p => [p._id, p])).values()];

        if (uniqueResults.length > 0) {
            return formatProducts(uniqueResults.slice(0, 30));
        }

        return '目前沒有匹配的產品資料';

    } catch (error) {
        console.error('Product search error:', error);
        return '無法取得產品資料';
    }
}

// 格式化產品資料
function formatProducts(products) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    let context = '## 可用產品資料庫\n\n';

    products.forEach((p, i) => {
        const url = p.partno
            ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}`
            : 'https://www.liqui-moly-tw.com/catalogue';

        context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
        context += `- 產品編號: ${p.partno || 'N/A'}\n`;
        context += `- 黏度: ${p.word2 || 'N/A'}\n`;
        context += `- 認證/規格: ${p.cert || 'N/A'}\n`;
        context += `- 分類: ${p.sort || 'N/A'}\n`;
        context += `- 建議售價: ${p.price || '請洽店家詢價'}\n`;
        context += `- 產品連結: ${url}\n`;
        context += `- 產品說明: ${p.content || 'N/A'}\n\n`;
    });

    return context;
}

// ============================================
// GET /cleanupSessions - 清理閒置對話（由外部 Cron 呼叫）
// ============================================

export async function get_cleanupSessions(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        // 10 分鐘前的時間
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        // 查詢所有超過 10 分鐘未活動的 active session
        const results = await wixData.query('chatSessions')
            .eq('status', 'active')
            .lt('lastActivity', tenMinutesAgo)
            .limit(100)
            .find();

        let closedCount = 0;

        // 批量更新為 ended
        for (const session of results.items) {
            session.status = 'ended';
            session.endTime = new Date();
            await wixData.update('chatSessions', session);
            closedCount++;
        }

        console.log(`Cleanup: closed ${closedCount} idle sessions at ${new Date().toISOString()}`);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                closedSessions: closedCount,
                timestamp: new Date().toISOString()
            })
        });

    } catch (error) {
        console.error('GET /cleanupSessions error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}
