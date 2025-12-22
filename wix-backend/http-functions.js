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

        // 取得對話歷史（優先使用傳入的，否則從 sessionId 取得）
        let conversationHistory = body.conversationHistory || [];
        if (conversationHistory.length === 0 && body.sessionId) {
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

        // Step 2: 從 Wix CMS 搜尋產品 (本地搜尋 + Title Expansion)
        let productContext = "目前沒有產品資料";
        try {
            productContext = await searchProducts(body.message, searchInfo);
            console.log('Local search completed');
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
            size: p.size,
            word1: p.word1,
            word2: p.word2,
            viscosity: p.word2,
            cert: p.cert,
            certifications: p.cert,
            sort: p.sort,
            category: p.sort,
            price: p.price,
            content: p.content,
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
    // === 除錯日誌 ===
    console.log('[searchProducts] vehicleType:', searchInfo?.vehicleType);
    console.log('[searchProducts] productCategory:', searchInfo?.productCategory);

    try {
        let allResults = [];

        // 1. 讀取 Vercel 傳來的「搜尋指令」 (Remote Instructions)
        const queries = searchInfo?.wixQueries || [];

        // 執行搜尋
        if (queries.length > 0) {
            // 2. 依序執行 Vercel 指派的任務
            for (const task of queries) {
                try {
                    let q = wixData.query('products');

                    // 2a. 設定主條件
                    if (task.method === 'contains') {
                        q = q.contains(task.field, task.value);
                    } else if (task.method === 'eq') {
                        q = q.eq(task.field, task.value);
                    }

                    // 2b. 設定附加條件
                    if (task.andContains) {
                        q = q.contains(task.andContains.field, task.andContains.value);
                    }

                    // 2c. 執行查詢
                    const res = await q.limit(task.limit || 20).find();
                    let items = res.items;

                    // 日誌：追蹤每個查詢的執行結果
                    if (items.length > 0) {
                        console.log(`[Search] ${task.method}(${task.field}, "${task.value}") => Found ${items.length} items: ${items.map(p => p.partno).join(', ')}`);
                    }

                    // 2d. 記憶體後處理 (Post-processing)
                    if (task.filterTitle && Array.isArray(task.filterTitle)) {
                        items = items.filter(item =>
                            item.title && task.filterTitle.some(keyword => item.title.includes(keyword))
                        );
                    }

                    // 2e. 容量篩選 (Size Filtering)
                    // 當用戶問「有800ml嗎」時，只保留對應容量的產品
                    if (task.filterSize) {
                        const sizeKeyword = task.filterSize.toLowerCase();
                        items = items.filter(item =>
                            item.size && item.size.toLowerCase().includes(sizeKeyword)
                        );
                        console.log(`[Size Filter] Filtered by "${sizeKeyword}", remaining: ${items.length} items`);
                    }

                    allResults = allResults.concat(items);
                } catch (taskError) {
                    console.error(`執行個別指令失敗 [${task.value}]:`, taskError);
                }
            }
        }

        // 如果上述指令沒有找到任何結果，執行 Fallback 搜尋
        // 這能解決某些 SKU 搜尋不到，或者關鍵字太模糊的問題
        if (allResults.length === 0) {
            // console.log('未找到結果，使用預設關鍵字搜尋 (Fallback)');
            const keywords = searchInfo?.searchKeywords || [query];
            // 處理前 4 個關鍵字 (從 2 提升至 4，增加找到產品的機會)
            for (const kw of keywords.slice(0, 4)) {
                if (!kw) continue;
                try {
                    // 同時搜尋 title 和 content 欄位
                    // 使用 contains 增加命中率
                    const resTitle = await wixData.query('products').contains('title', kw).limit(10).find();
                    allResults = allResults.concat(resTitle.items);

                    // 如果還是沒有，嘗試 partno
                    const resPart = await wixData.query('products').contains('partno', kw).limit(10).find();
                    allResults = allResults.concat(resPart.items);
                } catch (e) {
                    console.log('Fallback search error:', e);
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

        // === 同 Title 擴展搜尋 (Title-Based Expansion) ===
        // 若搜到產品，自動搜尋同 title 不同容量的產品
        // 這樣問「9047 有大包裝嗎」就能找到 LM9089 (4L)
        console.log(`[Search] Found ${uniqueProducts.length} unique products before Title Expansion`);

        if (uniqueProducts.length > 0) {
            // 優先找 SKU 匹配的產品（通常是用戶最想查詢的）
            // 從用戶 query 中提取 SKU（4-5 位數字）
            // 支援多個 SKU 同時查詢 (Multi-SKU Support)
            // 支援多個 SKU 同時查詢 (Multi-SKU Support)
            // 修正 Regex: 4位數字必須有 LM 開頭（避免匹配年份 2018），5位數字可單獨存在
            const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];
            let titlesToExpand = [];

            if (allSkuMatches.length > 0) {
                // 為每個 SKU 尋找對應產品
                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1];
                    const fullSku = `LM${skuNum}`;
                    console.log(`[Title Expansion] Looking for SKU: ${fullSku}`);

                    // 在搜尋結果中找到 SKU 完全匹配的產品
                    const skuProduct = uniqueProducts.find(p => p.partno === fullSku);
                    if (skuProduct && skuProduct.title && !titlesToExpand.includes(skuProduct.title)) {
                        titlesToExpand.push(skuProduct.title);
                        console.log(`[Title Expansion] Found SKU product, will expand title: "${skuProduct.title}"`);
                    }
                }
            }

            // 如果沒找到 SKU 產品，不進行標題擴展 (防止擴展到其他黏度造成雜訊)
            if (titlesToExpand.length === 0) {
                console.log('[Title Expansion] No specific SKU match found, skipping expansion to avoid noise.');
            }

            console.log(`[Title Expansion] Titles to expand: ${JSON.stringify(titlesToExpand)}`);

            for (const exactTitle of titlesToExpand) {
                try {
                    // Step 1: 用 contains() 搜尋產品名稱的前 20 個字元
                    const searchKey = exactTitle.substring(0, 20);
                    console.log(`[Title Expansion] Step 1: contains search for "${searchKey}"`);

                    // 提高 limit 到 100，確保找到所有容量版本
                    const res = await wixData.query('products')
                        .contains('title', searchKey)
                        .limit(100)
                        .find();
                    console.log(`[Title Expansion] Step 1 found ${res.items.length} items, titles: ${res.items.map(p => p.partno + ':' + p.size).join(', ')}`);

                    // Step 2: 記憶體精確過濾 - 只保留 title 完全相同的產品
                    // 這樣就不會誤匹配到 DPF 等類似產品
                    for (const p of res.items) {
                        if (p._id && !seenIds.has(p._id) && p.title === exactTitle) {
                            seenIds.add(p._id);
                            uniqueProducts.push(p);
                            console.log(`[Title Expansion] Added: ${p.partno} - ${p.size}`);
                        }
                    }
                } catch (e) {
                    console.log('Title expansion error:', e);
                }
            }
        }

        if (allResults.length > 0) {
            //console.log(`搜尋完成: 找到 ${uniqueProducts.length} 筆`);
        }

        if (uniqueProducts.length > 0) {
            // 如果有 SKU 搜尋，優先返回 SKU 相關產品
            // 支援多個 SKU 同時查詢 (Multi-SKU Support)
            // 支援多個 SKU 同時查詢 (Multi-SKU Support)
            const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];
            if (allSkuMatches.length > 0) {
                let allSkuProducts = [];
                let allMatchedTitles = new Set();

                // 為每個 SKU 收集對應產品
                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1];
                    const fullSku = `LM${skuNum}`;
                    const skuProduct = uniqueProducts.find(p => p.partno === fullSku);

                    if (skuProduct && skuProduct.title) {
                        allMatchedTitles.add(skuProduct.title);
                        // 收集所有與該 SKU 同 title 的產品（不同容量）
                        const sameTitle = uniqueProducts.filter(p => p.title === skuProduct.title);
                        allSkuProducts = allSkuProducts.concat(sameTitle);
                    }
                }

                if (allSkuProducts.length > 0) {
                    // 去重
                    const skuProductsUnique = [...new Map(allSkuProducts.map(p => [p._id, p])).values()];
                    const others = uniqueProducts.filter(p => !allMatchedTitles.has(p.title)).slice(0, 5);
                    const prioritized = [...skuProductsUnique, ...others];
                    console.log(`[Return] Multi-SKU mode: returning ${skuProductsUnique.length} SKU-related products + ${others.length} others`);
                    return formatProducts(prioritized.slice(0, 20));
                }
            }

            // 一般模式：返回前 30 個
            // === 多車型過濾 (Multi-Vehicle Filter) ===
            // 支援同時詢問汽車和摩托車的情況
            const vehicles = searchInfo?.vehicles || [];
            const isMultiVehicle = searchInfo?.isMultiVehicleQuery || vehicles.length > 1;
            const productCategory = searchInfo?.productCategory;

            if (isMultiVehicle && productCategory === '機油') {
                // 檢查是否同時包含汽車和摩托車
                const hasMotorcycle = vehicles.some(v => v.vehicleType === '摩托車');
                const hasCar = vehicles.some(v => v.vehicleType === '汽車');

                if (hasMotorcycle && hasCar) {
                    // 分別過濾汽車和摩托車產品
                    const motorcycleProducts = uniqueProducts.filter(p => {
                        const title = (p.title || '').toLowerCase();
                        const sort = (p.sort || '').toLowerCase();
                        return title.includes('motorbike') || sort.includes('摩托車');
                    });

                    const carProducts = uniqueProducts.filter(p => {
                        const title = (p.title || '').toLowerCase();
                        const sort = (p.sort || '').toLowerCase();
                        return !title.includes('motorbike') && !sort.includes('摩托車') && sort.includes('機油');
                    });

                    console.log(`[Multi-Vehicle Filter] Motorcycle: ${motorcycleProducts.length}, Car: ${carProducts.length}`);

                    // 合併結果，各取前 15 個，標記來源
                    const combinedProducts = [
                        ...motorcycleProducts.slice(0, 15),
                        ...carProducts.slice(0, 15)
                    ];

                    if (combinedProducts.length > 0) {
                        return formatMultiVehicleProducts(motorcycleProducts.slice(0, 15), carProducts.slice(0, 15));
                    }
                }
            }

            // 單一車型模式
            const vehicleType = searchInfo?.vehicleType;

            if (vehicleType === '摩托車' && productCategory === '機油') {
                const filteredProducts = uniqueProducts.filter(p => {
                    const title = (p.title || '').toLowerCase();
                    const sort = (p.sort || '').toLowerCase();
                    return title.includes('motorbike') || sort.includes('摩托車');
                });
                console.log('[Motorcycle Filter] Filtered ' + uniqueProducts.length + ' -> ' + filteredProducts.length + ' products');
                if (filteredProducts.length > 0) {
                    return formatProducts(filteredProducts.slice(0, 30));
                }
            }

            return formatProducts(uniqueProducts.slice(0, 30));
        }

        return '目前沒有匹配的產品資料';

    } catch (error) {
        console.error('searchProducts Global Error:', error);
        return '搜尋產品時發生錯誤';
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

**只能使用下方列表中的「產品編號」和「產品連結」！**

---

## 可用產品資料庫

`;

    products.forEach((p, i) => {
        // 修正連結邏輯：優先使用 partno 或 sku 構造 URL
        // 有些產品可能原本 partno 為空，嘗試使用 sku
        // 增加對不同大小寫 Field Key 的支援
        const pid = p.partno || p.partNo || p.Partno || p.PartNo || p.sku || p.SKU;

        let url = p.productPageUrl || 'https://www.liqui-moly-tw.com/products/';

        if (pid) {
            url = `${PRODUCT_BASE_URL}${pid.toLowerCase()}`;
        } else if (p.title) {
            // 嘗試從標題提取編號 (例如 "LM21730" 或 "9047")
            const match = p.title.match(/(?:LM|lm)?[- ]?(\d{4,5})/);
            if (match) {
                const num = match[1];
                url = `${PRODUCT_BASE_URL}lm${num}`;
            }
        }

        context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
        context += `- 產品編號: ${pid || 'N/A'}\n`;
        context += `- 容量/尺寸: ${p.size || 'N/A'}\n`;
        context += `- 系列/次分類: ${p.word1 || 'N/A'}\n`;
        context += `- 黏度: ${p.word2 || 'N/A'}\n`;
        context += `- 認證/規格: ${p.cert || 'N/A'}\n`;
        context += `- 分類: ${p.sort || 'N/A'}\n`;
        context += `- 建議售價: ${p.price || '請洽店家詢價'}\n`;
        context += `- 產品連結: ${url}\n`;

        const details = p.content || 'N/A';
        context += `- 產品說明: ${details}\n\n`;
    });

    return context;
}

// 格式化多車型產品資料（分別列出摩托車和汽車）
function formatMultiVehicleProducts(motorcycleProducts, carProducts) {
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

---

## 🏍️ 摩托車機油（標題含 Motorbike）

**以下產品專用於摩托車/重機/速克達，請推薦給摩托車用戶：**

`;

    if (motorcycleProducts.length > 0) {
        motorcycleProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.Partno || p.PartNo || p.sku || p.SKU;
            let url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
            context += `- 產品編號: ${pid || 'N/A'}\n`;
            context += `- 容量: ${p.size || 'N/A'}\n`;
            context += `- 黏度: ${p.word2 || 'N/A'}\n`;
            context += `- 認證: ${p.cert || 'N/A'}\n`;
            context += `- 產品連結: ${url}\n\n`;
        });
    } else {
        context += `（無符合的摩托車機油產品）\n\n`;
    }

    context += `---

## 🚗 汽車機油（不含 Motorbike）

**以下產品專用於汽車，請推薦給汽車用戶：**

`;

    if (carProducts.length > 0) {
        carProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.Partno || p.PartNo || p.sku || p.SKU;
            let url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
            context += `- 產品編號: ${pid || 'N/A'}\n`;
            context += `- 容量: ${p.size || 'N/A'}\n`;
            context += `- 黏度: ${p.word2 || 'N/A'}\n`;
            context += `- 認證: ${p.cert || 'N/A'}\n`;
            context += `- 產品連結: ${url}\n\n`;
        });
    } else {
        context += `（無符合的汽車機油產品）\n\n`;
    }

    context += `---

## ⚠️ 多車型推薦規則
- **摩托車/重機/速克達**：只能推薦上方「🏍️ 摩托車機油」區塊的產品
- **汽車**：只能推薦上方「🚗 汽車機油」區塊的產品
- 禁止混用！汽車不可推薦 Motorbike 產品，摩托車不可推薦汽車機油
`;

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

// ============================================
// Chatbot 對話記錄 API
// ============================================

// CORS OPTIONS for saveConversation
export function options_saveConversation(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
        },
        body: ""
    });
}

/**
 * POST /saveConversation - 儲存對話記錄
 * 用於 FB/IG Chatbot 記錄對話
 */
export async function post_saveConversation(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        // 驗證 API Key（簡單驗證）
        const apiKey = request.headers['x-api-key'];
        const expectedKey = await getSecret("CHATBOT_API_KEY").catch(() => null);
        if (expectedKey && apiKey !== expectedKey) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Invalid API key" })
            });
        }

        const {
            senderId,
            senderName = '',
            source = 'website',
            userMessage = '',
            aiResponse = '',
            hasAttachment = false,
            isPaused = false,
            pauseUntil = null
        } = body;

        if (!senderId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing senderId" })
            });
        }

        // 儲存到 CMS
        const record = {
            senderId,
            senderName,
            source,
            userMessage,
            aiResponse,
            hasAttachment,
            isPaused,
            pauseUntil: pauseUntil ? new Date(pauseUntil) : null,
            createdAt: new Date()
        };

        const result = await wixData.insert("ChatbotConversations", record);

        console.log('[saveConversation] Record saved:', result._id);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                recordId: result._id
            })
        });

    } catch (error) {
        console.error('POST /saveConversation error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// CORS OPTIONS for checkPauseStatus
export function options_checkPauseStatus(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
        },
        body: ""
    });
}

/**
 * POST /checkPauseStatus - 檢查用戶是否處於 AI 暫停狀態
 * 用於 FB/IG Chatbot 判斷是否回覆
 */
export async function post_checkPauseStatus(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();
        const { senderId } = body;

        if (!senderId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing senderId" })
            });
        }

        // === 新策略：分開查詢暫停和恢復記錄 ===

        // 1. 查詢最近的「明確暫停記錄」（有 pauseUntil 的記錄）
        const pauseResults = await wixData.query("ChatbotConversations")
            .eq("senderId", senderId)
            .isNotEmpty("pauseUntil")
            .descending("createdAt")
            .limit(1)
            .find();

        // 2. 查詢最近的「明確恢復記錄」（isPaused=false 且 source=system 或包含恢復標記）
        const resumeResults = await wixData.query("ChatbotConversations")
            .eq("senderId", senderId)
            .eq("isPaused", false)
            .descending("createdAt")
            .limit(1)
            .find();

        const latestPause = pauseResults.items[0];
        const latestResume = resumeResults.items[0];

        console.log('[checkPauseStatus] Debug:', {
            senderId,
            hasPauseRecord: !!latestPause,
            hasResumeRecord: !!latestResume,
            pauseCreatedAt: latestPause?.createdAt,
            resumeCreatedAt: latestResume?.createdAt
        });

        // 如果沒有任何暫停記錄，表示未暫停
        if (!latestPause) {
            return ok({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    isPaused: false,
                    reason: 'no_pause_record'
                })
            });
        }

        const now = new Date();
        const pauseUntil = new Date(latestPause.pauseUntil);
        const pauseCreatedAt = new Date(latestPause.createdAt);
        const resumeCreatedAt = latestResume ? new Date(latestResume.createdAt) : null;

        // 檢查暫停時間是否已過期
        if (now > pauseUntil) {
            return ok({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    isPaused: false,
                    expired: true
                })
            });
        }

        // 如果有恢復記錄，且恢復時間比暫停時間更新，返回未暫停
        if (resumeCreatedAt && resumeCreatedAt > pauseCreatedAt) {
            return ok({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    isPaused: false,
                    resumed: true
                })
            });
        }

        // 暫停中且未過期
        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                isPaused: true,
                pauseUntil: pauseUntil.toISOString()
            })
        });

    } catch (error) {
        console.error('POST /checkPauseStatus error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// CORS OPTIONS for setPauseStatus
export function options_setPauseStatus(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
        },
        body: ""
    });
}

/**
 * POST /setPauseStatus - 設定用戶的 AI 暫停狀態
 * 用於圖片觸發真人客服時暫停 AI
 */
export async function post_setPauseStatus(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();
        const { senderId, isPaused, pauseDurationMinutes = 30 } = body;

        if (!senderId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing senderId" })
            });
        }

        const pauseUntil = isPaused
            ? new Date(Date.now() + pauseDurationMinutes * 60 * 1000)
            : null;

        // 建立暫停狀態記錄
        const record = {
            senderId,
            senderName: '',
            source: 'system',
            userMessage: isPaused ? '[系統] AI 暫停' : '[系統] AI 恢復',
            aiResponse: '',
            hasAttachment: false,
            isPaused,
            pauseUntil,
            createdAt: new Date()
        };

        const result = await wixData.insert("ChatbotConversations", record);

        console.log('[setPauseStatus] Status set:', { senderId, isPaused, pauseUntil });

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                isPaused,
                pauseUntil: pauseUntil ? pauseUntil.toISOString() : null,
                recordId: result._id
            })
        });

    } catch (error) {
        console.error('POST /setPauseStatus error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// CORS OPTIONS for getConversationHistory
export function options_getConversationHistory(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Api-Key"
        },
        body: ""
    });
}

/**
 * POST /getConversationHistory - 取得用戶的對話歷史
 * 用於 FB/IG Chatbot 讀取上下文
 */
export async function post_getConversationHistory(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();
        const { senderId, limit = 10 } = body;

        if (!senderId) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: "Missing senderId" })
            });
        }

        // 查詢最近的對話記錄（排除系統訊息）
        const results = await wixData.query("ChatbotConversations")
            .eq("senderId", senderId)
            .ne("source", "system")
            .descending("createdAt")
            .limit(limit)
            .find();

        // 轉換為對話歷史格式
        const conversationHistory = [];
        // 反轉順序（從舊到新）
        const items = results.items.reverse();

        // 用於去重
        const seenUserMessages = new Set();

        for (const item of items) {
            // 添加用戶訊息（去重）
            if (item.userMessage && item.userMessage.trim() && !item.userMessage.startsWith('[')) {
                const userContent = item.userMessage.trim();
                if (!seenUserMessages.has(userContent)) {
                    seenUserMessages.add(userContent);

                    // 提取用戶訊息中的車型相關資訊
                    let enhancedUserContent = userContent;
                    const extractedInfo = [];

                    // 提取年份 (2015-2025)
                    const yearMatch = userContent.match(/20[1-2]\d/);
                    if (yearMatch) extractedInfo.push(`年份:${yearMatch[0]}`);

                    // 提取 CC 數 (1.0-5.0 或 1000-5000cc)
                    const ccMatch = userContent.match(/(\d+\.?\d*)\s*(cc|公升|L)/i) ||
                        userContent.match(/(\d+\.\d+)\s*(汽油|柴油)?/);
                    if (ccMatch && parseFloat(ccMatch[1]) >= 0.8 && parseFloat(ccMatch[1]) <= 6.0) {
                        extractedInfo.push(`排氣量:${ccMatch[1]}L`);
                    }

                    // 提取燃油類型
                    if (/汽油|gasoline/i.test(userContent)) extractedInfo.push('燃油:汽油');
                    if (/柴油|diesel/i.test(userContent)) extractedInfo.push('燃油:柴油');
                    if (/油電|hybrid/i.test(userContent)) extractedInfo.push('燃油:油電');
                    if (/電動|EV|electric/i.test(userContent)) extractedInfo.push('燃油:電動');

                    // 提取常見車型品牌
                    const carBrands = ['Toyota', 'Honda', 'Mazda', 'Ford', 'BMW', 'Benz', 'Mercedes',
                        'Lexus', 'Nissan', 'Mitsubishi', 'VW', 'Volkswagen', 'Audi',
                        'Hyundai', 'Kia', 'Subaru', 'Suzuki', 'Porsche', 'Volvo',
                        'Camry', 'Altis', 'RAV4', 'CRV', 'Civic', 'Elantra', 'Kuga'];
                    for (const brand of carBrands) {
                        if (new RegExp(brand, 'i').test(userContent)) {
                            extractedInfo.push(`車型:${brand}`);
                            break;
                        }
                    }

                    // 如果有提取到資訊，附加到訊息末尾（幫助 AI 記憶）
                    if (extractedInfo.length > 0) {
                        enhancedUserContent = `${userContent} [${extractedInfo.join(', ')}]`;
                    }

                    conversationHistory.push({
                        role: 'user',
                        content: enhancedUserContent
                    });

                    // 添加對應的 AI 回覆（摘要）
                    if (item.aiResponse && item.aiResponse.trim() && !item.aiResponse.startsWith('[')) {
                        let assistantContent = item.aiResponse.trim();

                        // 提取產品編號（LM + 數字），確保 AI 記得討論過哪個產品
                        const productNumbers = assistantContent.match(/LM\d{4,5}/gi) || [];
                        const uniqueProducts = [...new Set(productNumbers.map(p => p.toUpperCase()))];

                        // 如果太長，智慧截取
                        if (assistantContent.length > 300) {
                            // 保留前 250 字 + 產品編號提示
                            assistantContent = assistantContent.substring(0, 250);
                            if (uniqueProducts.length > 0) {
                                assistantContent += `...（提到的產品：${uniqueProducts.join(', ')}）`;
                            } else {
                                assistantContent += '...';
                            }
                        }
                        conversationHistory.push({
                            role: 'assistant',
                            content: assistantContent
                        });
                    }
                }
            }
        }

        console.log(`[getConversationHistory] Found ${conversationHistory.length} messages for ${senderId}`);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                conversationHistory
            })
        });

    } catch (error) {
        console.error('POST /getConversationHistory error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}
