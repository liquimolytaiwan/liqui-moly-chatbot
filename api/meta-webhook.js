/**
 * LIQUI MOLY Chatbot - Meta Webhook Handler
 * 處理 Facebook Messenger 和 Instagram DM 的訊息
 * 
 * 功能：
 * 1. Webhook 驗證 (GET)
 * 2. 接收訊息 (POST)
 * 3. 偵測圖片/附件 → 切換真人客服
 * 4. 文字訊息 → AI 回覆
 */

// 環境變數
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.META_INSTAGRAM_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

const { WIX_API_URL, AI_DISCLAIMER } = require('../lib/constants');

// Vercel API URL（用於呼叫現有的 chat 邏輯）
const VERCEL_API_URL = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://liqui-moly-chatbot.vercel.app';

// ============================================
// 真人客服暫停機制 (使用 Wix CMS 持久化)
// ============================================

// 暫停時間（分鐘）- 預設 30 分鐘
const HUMAN_HANDOVER_PAUSE_MINUTES = 30;

// ============================================
// 訊息去重機制 (防止 Meta webhook 重試造成重複回覆)
// ============================================
const processedMessages = new Map(); // 儲存已處理的 message ID
const MESSAGE_CACHE_TTL = 60 * 1000; // 快取 60 秒

/**
 * 檢查訊息是否已處理過
 */
function isMessageProcessed(messageId) {
    if (!messageId) return false;

    // 清理過期的快取
    const now = Date.now();
    for (const [id, timestamp] of processedMessages.entries()) {
        if (now - timestamp > MESSAGE_CACHE_TTL) {
            processedMessages.delete(id);
        }
    }

    if (processedMessages.has(messageId)) {
        console.log(`[Dedup] Message ${messageId} already processed, skipping`);
        return true;
    }

    // 標記為已處理
    processedMessages.set(messageId, now);
    return false;
}

/**
 * 檢查用戶是否在暫停期間（從 Wix CMS 查詢）
 */
async function isUserPaused(senderId) {
    try {
        const response = await fetch(`${WIX_API_URL}/checkPauseStatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId })
        });

        if (!response.ok) {
            console.error('[Pause] Failed to check pause status from Wix');
            return false; // 失敗時預設不暫停，避免阻斷服務
        }

        const result = await response.json();
        if (result.isPaused) {
            console.log(`[Pause] User ${senderId} is paused until ${result.pauseUntil}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('[Pause] Error checking pause status:', error);
        return false; // 異常時預設不暫停
    }
}

/**
 * 將用戶設為暫停狀態（存到 Wix CMS）
 */
async function pauseUserForHumanHandover(senderId, reason = 'image_attachment') {
    try {
        const response = await fetch(`${WIX_API_URL}/setPauseStatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                senderId,
                isPaused: true,
                pauseDurationMinutes: HUMAN_HANDOVER_PAUSE_MINUTES
            })
        });

        if (response.ok) {
            console.log(`[Pause] User ${senderId} paused for ${HUMAN_HANDOVER_PAUSE_MINUTES} minutes. Reason: ${reason}`);
        } else {
            console.error('[Pause] Failed to set pause status to Wix');
        }
    } catch (error) {
        console.error('[Pause] Error setting pause status:', error);
    }
}

/**
 * 儲存對話記錄到 Wix CMS
 */
async function saveConversationToWix(data) {
    try {
        const response = await fetch(`${WIX_API_URL}/saveConversation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`[Conversation] Saved to Wix: ${result.recordId}`);
            return result.recordId;
        } else {
            console.error('[Conversation] Failed to save to Wix');
            return null;
        }
    } catch (error) {
        console.error('[Conversation] Error saving conversation:', error);
        return null;
    }
}

// ============================================
// Vercel Edge/Serverless Handler
// ============================================

module.exports = async function handler(req, res) {
    // GET: Webhook 驗證
    if (req.method === 'GET') {
        return handleVerification(req, res);
    }

    // POST: 接收訊息
    if (req.method === 'POST') {
        return handleWebhook(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================
// Webhook 驗證 (GET)
// ============================================

function handleVerification(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Meta Webhook] Verification request:', { mode, token });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Meta Webhook] Verification successful!');
        return res.status(200).send(challenge);
    }

    console.log('[Meta Webhook] Verification failed!');
    return res.status(403).json({ error: 'Verification failed' });
}

// ============================================
// 接收訊息 (POST)
// ============================================

async function handleWebhook(req, res) {
    const body = req.body;

    // 確認是來自 Page 的訊息
    if (body.object !== 'page' && body.object !== 'instagram') {
        console.log('[Meta Webhook] Ignoring non-page/instagram event:', body.object);
        return res.status(200).send('EVENT_RECEIVED');
    }

    try {
        // 處理每個 entry
        for (const entry of body.entry || []) {
            // 判斷來源
            const source = body.object === 'instagram' ? 'instagram' : 'facebook';

            // 處理每個 messaging 事件
            for (const event of entry.messaging || []) {
                await processMessagingEvent(event, source);
            }
        }

        return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('[Meta Webhook] Error processing webhook:', error);
        return res.status(200).send('EVENT_RECEIVED'); // 仍回傳 200 避免重試
    }
}

// ============================================
// 處理單一訊息事件
// ============================================

async function processMessagingEvent(event, source) {
    const senderId = event.sender?.id;
    const message = event.message;
    const postback = event.postback;

    // ======= 訊息去重檢查 =======
    // Meta webhook 可能會重試，使用 message ID 防止重複處理
    if (message?.mid && isMessageProcessed(message.mid)) {
        return; // 已處理過，跳過
    }

    // ======= 處理 Postback（按鈕點擊）=======
    if (postback) {
        await handlePostback(senderId, postback, source);
        return;
    }

    // ======= 處理 Quick Reply =======
    if (message?.quick_reply) {
        await handleQuickReply(senderId, message.quick_reply, source);
        return;
    }

    // ======= 處理 Echo 訊息（管理者回覆）=======
    // 當管理者從 FB Page Inbox 回覆時，會收到 is_echo: true 的訊息
    // 真正的管理員回覆特徵：
    // 1. is_echo: true
    // 2. sender.id 是頁面 ID（不是用戶 ID）
    // 3. recipient.id 是用戶 ID
    if (message?.is_echo) {
        // 詳細記錄 is_echo 事件以便調試
        console.log('[Meta Webhook] is_echo event received:', JSON.stringify({
            senderId: event.sender?.id,
            recipientId: event.recipient?.id,
            hasAppId: !!message.app_id,
            appId: message.app_id,
            textPreview: message.text?.substring(0, 30)
        }));

        // 判斷是否為真人管理員回覆
        // 規則：先檢查訊息內容是否像 bot，因為 IG 可能沒有 app_id
        const PAGE_INBOX_APP_ID = '263902037430900';
        const appIdStr = String(message.app_id || '');
        const hasAppId = !!message.app_id;
        const isPageInboxMessage = appIdStr === PAGE_INBOX_APP_ID;

        // 檢查訊息內容是否像 bot 回覆
        // 不管有沒有 app_id，只要訊息內容符合 bot 特徵就視為 bot
        const messageText = message.text || '';
        const isBotMessage =
            messageText.startsWith('🤖') ||
            messageText.startsWith('您好！請問') ||
            messageText.startsWith('好的！請') ||
            messageText.startsWith('AI 助理') ||
            messageText.startsWith('已為您轉接') ||
            messageText.includes('如需更多協助') ||
            messageText.includes('如需恢復 AI 自動回答') ||
            messageText.includes('您好！👋') ||
            messageText.includes('選擇下方選項') ||
            messageText.includes('AI 助理已恢復') ||
            messageText.includes('請直接輸入您的問題') ||
            messageText.includes('我會為您解答') ||
            messageText.includes('為您服務') ||
            // 有 app_id 且不是 Page Inbox 也視為 bot
            (hasAppId && !isPageInboxMessage);

        console.log('[Meta Webhook] is_echo analysis:', { hasAppId, appIdStr, isPageInboxMessage, isBotMessage, textPreview: messageText.substring(0, 50) });

        if (isBotMessage) {
            console.log('[Meta Webhook] Bot echo message detected, skipping');
            return; // 這是 bot 發的訊息，不需要記錄
        }

        // 不是 bot 訊息，視為管理員回覆
        // 取得用戶 ID（在 is_echo 情況下，recipient 是用戶）
        const userId = event.recipient?.id;

        if (!userId) {
            console.log('[Meta Webhook] is_echo missing recipient.id, skipping');
            return;
        }

        console.log(`[Meta Webhook] Admin reply detected to user ${userId}: "${message.text?.substring(0, 30)}..."`);

        // 這是真人管理者手動回覆的訊息
        // 無論用戶是否已在暫停中，都重置暫停時間為 30 分鐘
        console.log('[Meta Webhook] Admin reply detected, setting/resetting pause time to 30 minutes');
        // Echo 訊息格式：sender = page, recipient = user
        const recipientId = event.recipient?.id;

        // 設定（或重置）該用戶的暫停時間為 30 分鐘
        try {
            await fetch(`${WIX_API_URL}/setPauseStatus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    senderId: recipientId, // 用戶的 ID
                    isPaused: true,
                    pauseDurationMinutes: HUMAN_HANDOVER_PAUSE_MINUTES,
                    resetTimer: true // 重置計時器而非延長
                })
            });
            console.log(`[Meta Webhook] AI paused for user ${recipientId} for ${HUMAN_HANDOVER_PAUSE_MINUTES} minutes (reset by admin reply)`);

            // 記錄管理者回覆到 CMS
            // 注意：管理者的訊息存到 userMessage，aiResponse 標記為管理者回覆
            await saveConversationToWix({
                senderId: recipientId,
                senderName: 'Admin',
                source,
                userMessage: message.text || '[管理者發送附件]',
                aiResponse: '[真人客服回覆]',
                isPaused: true
            });
        } catch (error) {
            console.error('[Meta Webhook] Error setting pause:', error);
        }
        return; // Echo 訊息不需要進一步處理
    }

    // 忽略沒有訊息內容的事件
    if (!message) {
        console.log('[Meta Webhook] No message in event');
        return;
    }

    console.log(`[Meta Webhook] Received message from ${source}:`, {
        senderId,
        text: message.text?.substring(0, 50),
        hasAttachments: !!message.attachments
    });

    try {
        // 取得用戶資料（名稱等）
        const userProfile = await getUserProfile(senderId, source);

        // ======= 恢復 AI 關鍵字偵測（優先於暫停檢查！）=======
        // 必須在暫停檢查之前，否則暫停時無法恢復
        if (message.text) {
            const textLower = message.text.toLowerCase();
            // 新增更多恢復關鍵字，包含全形/半形空格
            const resumeKeywords = [
                '恢復ai', '恢復 ai', '恢復ＡＩ', '恢復 ＡＩ',
                'ai回答', 'ai 回答', 'ai諮詢', 'ai 諮詢',
                'ai產品', 'ai 產品', '啟動ai', '啟動 ai',
                '開啟ai', '開啟 ai', '繼續ai', '繼續 ai'
            ];
            if (resumeKeywords.some(kw => textLower.includes(kw))) {
                console.log(`[Meta Webhook] Resume AI keyword detected: "${message.text}"`);
                await resumeAI(senderId, source);
                return;
            }
        }

        // ======= 暫停檢查 (Pause Check) =======
        // 如果用戶已被標記為等待真人客服，則不進行 AI 回覆
        if (await isUserPaused(senderId)) {
            console.log(`[Meta Webhook] User ${senderId} is waiting for human agent, skipping AI response`);

            // 靜默記錄對話，不發送提示訊息（避免打擾真人客服對話）
            await saveConversationToWix({
                senderId,
                senderName: userProfile?.name || '',
                source,
                userMessage: message.text || '[附件]',
                aiResponse: '[等待真人客服中，AI 暫停回覆]',
                hasAttachment: !!message.attachments,
                isPaused: true
            });
            return;
        }

        // 檢查是否有附件（圖片、影片等）
        if (message.attachments && message.attachments.length > 0) {
            await handleAttachment(senderId, message.attachments, source, userProfile);
            return;
        }

        // 純文字訊息
        if (message.text) {
            const textLower = message.text.toLowerCase();

            // ======= 真人客服關鍵字偵測 =======
            const humanKeywords = ['真人', '客服', '人工', '專人', '轉接', '找人', '活人'];
            if (humanKeywords.some(kw => textLower.includes(kw))) {
                console.log(`[Meta Webhook] Human agent keyword detected: "${message.text}"`);
                await switchToHumanAgent(senderId, source);
                // 記錄到 CMS
                await saveConversationToWix({
                    senderId,
                    senderName: userProfile?.name || '',
                    source,
                    userMessage: message.text,
                    aiResponse: '[偵測到真人客服關鍵字，已自動切換]',
                    isPaused: true
                });
                return;
            }

            // AI 回覆
            await handleTextMessage(senderId, message.text, source, userProfile);
            return;
        }

    } catch (error) {
        console.error('[Meta Webhook] Error processing message:', error);
        // 發送錯誤訊息給用戶
        await sendMessage(senderId, '抱歉，系統暫時遇到問題。請稍後再試，或使用官網聯絡表單與我們聯繫。', source);
    }
}

// ============================================
// 處理 Postback（按鈕點擊）
// ============================================

async function handlePostback(senderId, postback, source) {
    const payload = postback.payload;
    console.log(`[Meta Webhook] Postback received: ${payload}`);

    switch (payload) {
        case 'GET_STARTED':
            await sendWelcomeMessage(senderId, source);
            break;
        case 'HUMAN_AGENT':
            await switchToHumanAgent(senderId, source);
            break;
        case 'RESUME_AI':
            await resumeAI(senderId, source);
            break;
        default:
            console.log(`[Meta Webhook] Unknown postback: ${payload}`);
    }
}

// ============================================
// 處理 Quick Reply
// ============================================

async function handleQuickReply(senderId, quickReply, source) {
    const payload = quickReply.payload;
    console.log(`[Meta Webhook] Quick reply received: ${payload}`);

    switch (payload) {
        case 'AI_CONSULT':
            await sendMessage(senderId, '好的！請直接輸入您的問題，我會盡力為您解答。\n\n例如：\n🔹 我的車是 Toyota Camry 2020，適合什麼機油？\n🔹 5W30 和 5W40 有什麼差別？', source);
            break;
        case 'HUMAN_AGENT':
            await switchToHumanAgent(senderId, source);
            break;
        case 'RESUME_AI':
            await resumeAI(senderId, source);
            break;
        default:
            console.log(`[Meta Webhook] Unknown quick reply: ${payload}`);
    }
}

// ============================================
// 發送歡迎訊息
// ============================================

async function sendWelcomeMessage(senderId, source) {
    const welcomeText = `您好！👋 歡迎來到 LIQUI MOLY Taiwan！

我是 AI 產品諮詢助理，可以幫您：
🔹 推薦適合您愛車的機油
🔹 查詢產品資訊與規格
🔹 提供購買管道指引

請直接輸入問題，或選擇下方選項：`;

    await sendMessageWithQuickReplies(senderId, welcomeText, [
        { content_type: 'text', title: '🤖 AI 產品諮詢', payload: 'AI_CONSULT' },
        { content_type: 'text', title: '👤 真人客服', payload: 'HUMAN_AGENT' }
    ], source);
}

// ============================================
// 切換真人客服
// ============================================

async function switchToHumanAgent(senderId, source) {
    // 設定暫停狀態
    await pauseUserForHumanHandover(senderId, 'user_request');

    const confirmText = `已為您轉接真人客服 👤

⏰ AI 助理將暫停 ${HUMAN_HANDOVER_PAUSE_MINUTES} 分鐘
📞 服務時間：週一至週五 09:00-18:00
📝 您也可以填寫聯絡表單：https://www.liqui-moly-tw.com/contact

如需恢復 AI 自動回答，請點擊下方按鈕。`;

    await sendMessageWithQuickReplies(senderId, confirmText, [
        { content_type: 'text', title: '🤖 恢復 AI 自動回答', payload: 'RESUME_AI' }
    ], source);

    // 記錄到 CMS
    await saveConversationToWix({
        senderId,
        source,
        userMessage: '[用戶點擊真人客服]',
        aiResponse: confirmText,
        isPaused: true
    });
}

// ============================================
// 恢復 AI 回覆
// ============================================

async function resumeAI(senderId, source) {
    // 清除暫停狀態（透過設定 isPaused = false）
    try {
        await fetch(`${WIX_API_URL}/setPauseStatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                senderId,
                isPaused: false
            })
        });
        console.log(`[Resume] User ${senderId} AI resumed`);
    } catch (error) {
        console.error('[Resume] Error resuming AI:', error);
    }

    const confirmText = `AI 助理已恢復 🤖

現在可以直接輸入問題，我會為您解答！`;

    await sendMessageWithQuickReplies(senderId, confirmText, [
        { content_type: 'text', title: '🤖 AI 產品諮詢', payload: 'AI_CONSULT' },
        { content_type: 'text', title: '👤 真人客服', payload: 'HUMAN_AGENT' }
    ], source);

    // 記錄到 CMS
    await saveConversationToWix({
        senderId,
        source,
        userMessage: '[用戶恢復 AI]',
        aiResponse: confirmText,
        isPaused: false
    });
}

// ============================================
// 處理文字訊息
// ============================================

async function handleTextMessage(senderId, text, source, userProfile) {
    console.log(`[Meta Webhook] Processing text message: "${text.substring(0, 50)}..."`);

    try {
        // Step 1: 取得對話歷史
        let conversationHistory = [];

        try {
            const historyResponse = await fetch(`${WIX_API_URL}/getConversationHistory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senderId, limit: 10 })
            });
            const historyData = await historyResponse.json();
            if (historyData.success && historyData.conversationHistory) {
                conversationHistory = historyData.conversationHistory;
                console.log(`[Meta Webhook] Loaded ${conversationHistory.length} history messages`);
            }
        } catch (e) {
            console.error('[Meta Webhook] Failed to get conversation history:', e.message);
        }

        // Step 2: 呼叫 Vercel 的 /api/chat（統一使用 Vercel RAG 管線 + 防幻覺驗證）
        // 改用 Vercel API 確保網頁端和 META 端使用相同邏輯
        const chatResponse = await fetch(`${VERCEL_API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                conversationHistory
            })
        });

        // 檢查 HTTP 狀態碼
        if (!chatResponse.ok) {
            const errorText = await chatResponse.text();
            console.error('[Meta Webhook] Vercel Chat API HTTP error:', chatResponse.status, errorText);
            throw new Error(`Vercel Chat API error: ${chatResponse.status}`);
        }

        // 嘗試解析 JSON
        let chatData;
        try {
            chatData = await chatResponse.json();
        } catch (jsonError) {
            console.error('[Meta Webhook] Failed to parse Vercel Chat API response as JSON');
            throw new Error('Invalid JSON response from Vercel Chat API');
        }
        console.log('[Meta Webhook] Chat response received from Vercel:', { success: chatData.success });

        if (chatData.success && chatData.response) {
            // 將 Markdown 格式轉換為純文字（FB/IG 不支援 Markdown）
            // [文字](連結) → 文字\n連結（確保連結獨立一行）
            // **粗體** → 粗體
            let plainTextResponse = chatData.response
                // 移除 Markdown 連結格式，連結後如有標點符號則保留在下一行
                .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)([，。！？、])?/g, (match, text, url, punct) => {
                    return punct ? `${text}\n${url}\n${punct}` : `${text}\n${url}`;
                })
                // 移除粗體標記
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                // 移除斜體標記
                .replace(/\*([^*]+)\*/g, '$1')
                // 清理多餘的連續換行（超過2個換行變成2個）
                .replace(/\n{3,}/g, '\n\n');


            // AI 警語現在由 AI 自動生成並翻譯成用戶語言
            // 不再前端硬編碼加上

            // 在 AI 回覆前加上機器人標註，讓用戶能分辨 AI 和人工回覆
            const aiPrefixedResponse = `🤖 ${plainTextResponse}`;

            // 發送 AI 回覆，最後一段帶真人客服按鈕
            await sendMessageWithButton(senderId, aiPrefixedResponse, [
                { content_type: 'text', title: '👤 真人客服', payload: 'HUMAN_AGENT' }
            ], source);

            // ========================================
            // 🚀 優化：非同步儲存對話（Fire-and-Forget）
            // 用戶已收到回覆，儲存對話在背景執行
            // ========================================
            saveConversationToWix({
                senderId,
                senderName: userProfile?.name || '',
                source,
                userMessage: text,
                aiResponse: chatData.response,
                hasAttachment: false
            }).catch(e => console.error('[Meta Webhook] Background save failed:', e.message));

        } else {
            throw new Error('Chat API failed');
        }

    } catch (error) {
        console.error('[Meta Webhook] AI response error:', error);
        await sendMessage(senderId, '抱歉，我目前無法處理您的問題。請稍後再試，或直接使用官網聯絡表單：https://www.liqui-moly-tw.com/contact', source);
    }
}

// ============================================
// 處理附件（圖片、影片等）
// ============================================

async function handleAttachment(senderId, attachments, source, userProfile) {
    console.log(`[Meta Webhook] Received ${attachments.length} attachment(s)`);

    // 目前不支援圖片辨識，切換到真人客服
    const pauseMinutes = HUMAN_HANDOVER_PAUSE_MINUTES;
    const response = `感謝您傳送圖片！🖼️

目前 AI 助理尚未支援圖片辨識功能，系統將自動為您轉接真人客服。

⏰ 服務時間：週一至週五 09:00-18:00
⏱️ AI 助理將暫停回覆 ${pauseMinutes} 分鐘，等待真人客服處理
📝 您也可以填寫聯絡表單：https://www.liqui-moly-tw.com/contact

如需恢復 AI 自動回答，請點擊下方按鈕。`;

    // 發送帶有恢復按鈕的訊息
    await sendMessageWithQuickReplies(senderId, response, [
        { content_type: 'text', title: '🤖 恢復 AI 自動回答', payload: 'RESUME_AI' }
    ], source);

    // ======= 啟動暫停機制 =======
    // 用戶傳送圖片後，暫停 AI 回覆 30 分鐘
    await pauseUserForHumanHandover(senderId, 'image_attachment');

    // 記錄到 CMS（標記為需要真人處理）
    await saveConversationToWix({
        senderId,
        senderName: userProfile?.name || '',
        source,
        userMessage: '[用戶傳送圖片]',
        aiResponse: response,
        hasAttachment: true,
        isPaused: true
    });

    // TODO: 執行 Handover Protocol 切換真人客服
    // await handoverToInbox(senderId, source);
}

// ============================================
// 發送訊息（最後一段帶 Quick Reply 按鈕）
// ============================================

async function sendMessageWithButton(recipientId, text, quickReplies, source = 'facebook') {
    // 根據平台設定訊息長度限制（保留緩衝空間）
    // Instagram: 800 字元, Facebook: 1800 字元
    const maxLength = source === 'instagram' ? 800 : 1800;
    const messages = [];

    if (text.length <= maxLength) {
        messages.push(text);
    } else {
        // 依段落分割
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                messages.push(remaining);
                break;
            }
            // 優先找換行符號分割，確保語意完整
            let splitIndex = remaining.lastIndexOf('\n', maxLength);
            // 如果找不到換行，嘗試找句號或逗號
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = remaining.lastIndexOf('。', maxLength);
            }
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = remaining.lastIndexOf('，', maxLength);
            }
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = maxLength;
            }
            messages.push(remaining.substring(0, splitIndex + 1));
            remaining = remaining.substring(splitIndex + 1).trim();
        }
    }

    console.log(`[Meta Webhook] Sending ${messages.length} message segment(s) with button to ${source}`);

    const endpoint = 'https://graph.facebook.com/v18.0/me/messages';
    const accessToken = source === 'instagram'
        ? (INSTAGRAM_ACCESS_TOKEN || PAGE_ACCESS_TOKEN)
        : PAGE_ACCESS_TOKEN;

    // 依序發送每段訊息
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const isLastMessage = (i === messages.length - 1);

        // 第二段以後加入延遲，避免順序錯亂
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        try {
            // 最後一段帶 Quick Reply 按鈕，其他段落不帶
            const messageBody = isLastMessage
                ? { text: msg, quick_replies: quickReplies }
                : { text: msg };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: messageBody,
                    access_token: accessToken
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error(`[Meta Webhook] Send message error (${source}):`, error);
            } else {
                console.log(`[Meta Webhook] Message segment ${i + 1}/${messages.length} sent to ${source}${isLastMessage ? ' (with button)' : ''}`);
            }
        } catch (error) {
            console.error('[Meta Webhook] Send message failed:', error);
        }
    }
}

// ============================================
// 發送訊息
// ============================================

async function sendMessage(recipientId, text, source = 'facebook') {
    // 根據平台設定訊息長度限制（保留緩衝空間）
    // Instagram: 800 字元, Facebook: 1800 字元
    const maxLength = source === 'instagram' ? 800 : 1800;
    const messages = [];

    if (text.length <= maxLength) {
        messages.push(text);
    } else {
        // 依段落分割
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                messages.push(remaining);
                break;
            }
            // 優先找換行符號分割，確保語意完整
            let splitIndex = remaining.lastIndexOf('\n', maxLength);
            // 如果找不到換行，嘗試找句號或逗號
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = remaining.lastIndexOf('。', maxLength);
            }
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = remaining.lastIndexOf('，', maxLength);
            }
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = maxLength;
            }
            messages.push(remaining.substring(0, splitIndex + 1));
            remaining = remaining.substring(splitIndex + 1).trim();
        }
    }

    console.log(`[Meta Webhook] Sending ${messages.length} message segment(s) to ${source}, total length: ${text.length}`);

    // 依序發送每段訊息（加入延遲確保順序）
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // 第二段以後加入延遲，避免順序錯亂
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Instagram 和 Facebook 使用相同的 endpoint
        const endpoint = 'https://graph.facebook.com/v18.0/me/messages';

        // 根據來源選擇正確的 Access Token
        const accessToken = source === 'instagram'
            ? (INSTAGRAM_ACCESS_TOKEN || PAGE_ACCESS_TOKEN)
            : PAGE_ACCESS_TOKEN;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: { text: msg },
                    access_token: accessToken
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error(`[Meta Webhook] Send message error (${source}):`, error);
            } else {
                console.log(`[Meta Webhook] Message sent successfully to ${source}`);
            }
        } catch (error) {
            console.error('[Meta Webhook] Send message failed:', error);
        }
    }
}

// ============================================
// 發送帶有 Quick Replies 的訊息
// ============================================

async function sendMessageWithQuickReplies(recipientId, text, quickReplies, source = 'facebook') {
    const endpoint = 'https://graph.facebook.com/v18.0/me/messages';

    // 根據來源選擇正確的 Access Token
    const accessToken = source === 'instagram'
        ? (INSTAGRAM_ACCESS_TOKEN || PAGE_ACCESS_TOKEN)
        : PAGE_ACCESS_TOKEN;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: {
                    text: text,
                    quick_replies: quickReplies
                },
                access_token: accessToken
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error(`[Meta Webhook] Send quick reply error (${source}):`, error);
        } else {
            console.log(`[Meta Webhook] Quick reply message sent successfully to ${source}`);
        }
    } catch (error) {
        console.error('[Meta Webhook] Send quick reply failed:', error);
    }
}

// ============================================
// 取得用戶資料
// ============================================

async function getUserProfile(userId, source = 'facebook') {
    try {
        const fields = source === 'instagram'
            ? 'name,username'
            : 'first_name,last_name,profile_pic';

        // 根據來源選擇正確的 Access Token
        const accessToken = source === 'instagram'
            ? (INSTAGRAM_ACCESS_TOKEN || PAGE_ACCESS_TOKEN)
            : PAGE_ACCESS_TOKEN;

        const response = await fetch(
            `https://graph.facebook.com/v18.0/${userId}?fields=${fields}&access_token=${accessToken}`
        );

        if (response.ok) {
            const data = await response.json();
            return {
                name: data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown',
                username: data.username || null,
                profilePic: data.profile_pic || null
            };
        } else {
            // 記錄錯誤以便調試
            const error = await response.json();
            console.error(`[Meta Webhook] Get user profile error (${source}):`, error);
        }
    } catch (error) {
        console.log('[Meta Webhook] Could not fetch user profile:', error.message);
    }

    return { name: 'Unknown', username: null, profilePic: null };
}

// ============================================
// 儲存對話到 Wix CMS
// ============================================

async function saveConversation(senderId, userMessage, aiResponse, source, userProfile) {
    try {
        // 呼叫 Wix HTTP Function 儲存對話
        // TODO: 需要在 Wix 建立對應的 API 端點
        console.log('[Meta Webhook] Saving conversation:', {
            senderId,
            source,
            userName: userProfile?.name
        });

        // 暫時只記錄 log，等 Wix API 建立後再實作
        /*
        await fetch(`${WIX_API_URL}/saveMetaConversation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                externalUserId: senderId,
                source,
                userName: userProfile?.name || 'Unknown',
                userMessage,
                aiResponse,
                timestamp: new Date().toISOString()
            })
        });
        */

    } catch (error) {
        console.error('[Meta Webhook] Save conversation error:', error);
    }
}

// ============================================
// Handover Protocol - 切換真人客服
// ============================================

async function handoverToInbox(userId, source = 'facebook') {
    // 使用 Handover Protocol 將對話控制權交給 Facebook/Instagram 原生收件匣
    // 這允許真人客服接管對話

    try {
        // Facebook Page Inbox 的 App ID (固定值)
        const PAGE_INBOX_APP_ID = '263902037430900';

        const response = await fetch(
            `https://graph.facebook.com/v18.0/me/pass_thread_control`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: userId },
                    target_app_id: PAGE_INBOX_APP_ID,
                    metadata: 'Handover: User sent image, needs human review',
                    access_token: PAGE_ACCESS_TOKEN
                })
            }
        );

        if (response.ok) {
            console.log('[Meta Webhook] Handover successful for user:', userId);
        } else {
            const error = await response.json();
            console.error('[Meta Webhook] Handover failed:', error);
        }
    } catch (error) {
        console.error('[Meta Webhook] Handover error:', error);
    }
}
