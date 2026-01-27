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

        // ============================================
        // 統一 AI 邏輯：直接呼叫 Vercel /api/chat
        // 所有 AI 邏輯（analyze, search, chat, 防幻覺驗證）
        // 都在 Vercel 端處理，與 META 端統一
        // ============================================

        // 判斷是否為 session 第一次回答（根據是否有 assistant 消息）
        const hasAssistantMessage = conversationHistory &&
            conversationHistory.some(msg => msg.role === 'assistant' || msg.role === 'model');
        const isFirstResponse = !hasAssistantMessage;

        const chatResponse = await fetch(`${VERCEL_API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: body.message,
                conversationHistory,
                isFirstResponse  // 明確傳入，讓 Vercel 知道要加警語
            })
        });
        const chatData = await chatResponse.json();

        if (!chatData.success) {
            throw new Error(chatData.error || 'Vercel chat API failed');
        }

        // 儲存對話紀錄（Wix 端專屬邏輯）
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
            body: JSON.stringify({
                success: true,
                response: chatData.response,
                isFirstResponse: chatData.isFirstResponse || false
            })
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
            use: p.use,  // 🚨 新增：使用方法/添加比例（含 2T/4T 資訊）
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

        // 取得最近一筆對話的時間（用於判斷是否為今天第一次）
        // items 已經是反轉過的（從舊到新），所以最後一筆是最新的
        // 但原始 results.items 是按 descending，所以第一筆是最新的
        const lastMessageTime = results.items.length > 0 ? results.items[0].createdAt : null;

        console.log(`[getConversationHistory] Found ${conversationHistory.length} messages for ${senderId}, lastMessageTime: ${lastMessageTime}`);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                conversationHistory,
                lastMessageTime: lastMessageTime ? new Date(lastMessageTime).toISOString() : null
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
