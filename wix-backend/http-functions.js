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

        console.log('Search Info:', JSON.stringify(searchInfo));

        // 1. 取得 AI 分析的關鍵資訊
        const category = searchInfo?.productCategory || '其他';
        const vehicle = searchInfo?.vehicleType || '汽車';
        const keywords = searchInfo?.searchKeywords || [];

        // 2. 判斷車型
        const isBike = vehicle === '摩托車' || queryLower.includes('機車') || queryLower.includes('重機') || queryLower.includes('jet') || queryLower.includes('勁戰');

        console.log(`搜尋策略啟動: 車型=${isBike ? '摩托車' : '汽車'}, 類別=${category}`);

        // 3. 策略搜尋 (Strategy Pattern)

        // === 策略 A: 摩托車 + 添加劑 (最容易幻覺的案例，優先處理) ===
        if (isBike && (category === '添加劑' || queryLower.includes('添加') || queryLower.includes('油精') || category === '添加劑')) {
            console.log('執行策略 A: 摩托車添加劑專屬搜尋');

            // A1. 【摩托車】添加劑
            const r1 = await wixData.query('products')
                .contains('sort', '【摩托車】添加劑')
                .limit(30)
                .find();

            // A2. 【摩托車】機車養護 (很多添加劑在這裡)
            const r2 = await wixData.query('products')
                .contains('sort', '【摩托車】機車養護')
                .limit(20)
                .find();

            // A3. 標題包含 'Motorbike' 且包含 'Shooter'/'Additive'/'Flush' 的產品 (雙重保險)
            const r3 = await wixData.query('products')
                .contains('title', 'Motorbike')
                .limit(50)
                .find();
            const r3Filtered = r3.items.filter(i =>
                i.title && (i.title.includes('Additive') || i.title.includes('Shooter') || i.title.includes('Flush') || i.title.includes('Cleaner'))
            );

            allResults = [...r1.items, ...r2.items, ...r3Filtered];
        }

        // === 策略 B: 摩托車 + 機油 ===
        else if (isBike && category === '機油') {
            console.log('執行策略 B: 摩托車機油專屬搜尋');

            const subType = searchInfo?.vehicleSubType || '';
            const isScooter = subType.includes('速克達') || queryLower.includes('速克達') || queryLower.includes('jet') || queryLower.includes('勁戰') || queryLower.includes('drg') || queryLower.includes('mmbcu') || queryLower.includes('smax') || queryLower.includes('force');

            if (isScooter) {
                console.log('子策略: 速克達 (Scooter) 機油優先');
                // 1. 優先找標題有 "Scooter" 的
                const scooterOils = await wixData.query('products')
                    .contains('sort', '【摩托車】機油')
                    .contains('title', 'Scooter')
                    .limit(20)
                    .find();

                // 2. 找其他機油做備選
                const otherOils = await wixData.query('products')
                    .contains('sort', '【摩托車】機油')
                    .limit(30)
                    .find();

                allResults = [...scooterOils.items, ...otherOils.items];
            } else {
                // 檔車/重機/一般
                const r1 = await wixData.query('products')
                    .contains('sort', '【摩托車】機油')
                    .limit(50)
                    .find();
                allResults = r1.items;
            }
        }

        // === 策略 C: 汽車 + 添加劑 ===
        else if (!isBike && category === '添加劑') {
            console.log('執行策略 C: 汽車添加劑專屬搜尋');

            const r1 = await wixData.query('products')
                .contains('sort', '【汽車】添加劑')
                .limit(30)
                .find();

            allResults = r1.items;
        }

        // === 策略 D: 汽車 + 機油 ===
        else if (!isBike && category === '機油') {
            console.log('執行策略 D: 汽車機油搜尋');
            const r1 = await wixData.query('products')
                .contains('sort', '【汽車】機油')
                .limit(50)
                .find();
            allResults = r1.items;
        }

        // === 策略 E: 通用/清潔 ===
        else if (category === '清潔' || category === '美容' || queryLower.includes('洗')) {
            console.log('執行策略 E: 清潔美容搜尋');

            const r1 = await wixData.query('products')
                .contains('sort', '車輛美容')
                .limit(20)
                .find();
            const r2 = await wixData.query('products')
                .contains('sort', '【汽車】空調') // 空調清潔
                .limit(10)
                .find();
            allResults = [...r1.items, ...r2.items];
        }

        // === 策略 F: 關鍵字補救 (Fallback) ===
        // 如果上面的策略沒找到東西，或者是其他類別，就用關鍵字搜
        if (allResults.length === 0 && keywords.length > 0) {
            console.log('執行策略 F: 關鍵字搜尋 (Fallback)');
            const limitedKeywords = keywords.slice(0, 3); // 只用前3個關鍵字

            for (const kw of limitedKeywords) {
                let q = wixData.query('products').contains('title', kw);

                // 盡量還是區分車型
                if (isBike) {
                    q = q.contains('sort', '摩托車').or(q.contains('title', 'Motorbike'));
                } else {
                    q = q.not(wixData.query('products').contains('sort', '摩托車')); // 汽車盡量不搜摩托車
                }

                try {
                    const res = await q.limit(10).find();
                    allResults = allResults.concat(res.items);
                } catch (e) {
                    console.log('Keyword search error:', e);
                }
            }
        }

        // 去除重複 (由 _id 判斷)
        const uniqueProducts = [];
        const seenIds = new Set();

        for (const p of allResults) {
            if (p._id && !seenIds.has(p._id)) {
                seenIds.add(p._id);
                uniqueProducts.push(p);
            }
        }

        console.log(`搜尋完成，共找到 ${uniqueProducts.length} 個產品`);

        // 只回傳前 30 個最相關的，避免 Context 太長
        if (uniqueProducts.length > 0) {
            return formatProducts(uniqueProducts.slice(0, 30));
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

    // 強烈警告，防止 AI 編造
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

違規範例（絕對禁止！）：
- LM1580 ❌ 不存在
- LM20852 ❌ 不存在
- Motorbike Speed Shooter ❌ 不存在

**只能使用下方列表中的「產品編號」和「產品連結」！**

---

## 可用產品資料庫

`;

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
