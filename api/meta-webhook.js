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

// Vercel API URL（用於呼叫現有的 chat 邏輯）
const VERCEL_API_URL = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://liqui-moly-chatbot.vercel.app';

// Wix API URL
const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';

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

export default async function handler(req, res) {
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
    if (message?.is_echo) {
        // 檢查是否為管理者手動回覆（非 app 發送的訊息）
        // app_id 存在時表示是 bot/app 發送的，我們只處理人工回覆
        if (!message.app_id) {
            console.log('[Meta Webhook] Admin reply detected, extending pause time');
            // 取得用戶 ID（echo 訊息的 recipient 是用戶）
            const recipientId = event.recipient?.id;
            const userId = senderId; // 在 echo 中，sender 是 Page，recipient 是用戶
            // 但實際上我們需要從 message 中取得原始用戶
            // Facebook echo 訊息格式：sender = page, recipient = user

            // 延長該用戶的暫停時間
            try {
                await fetch(`${WIX_API_URL}/setPauseStatus`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        senderId: recipientId, // 用戶的 ID
                        isPaused: true,
                        pauseDurationMinutes: HUMAN_HANDOVER_PAUSE_MINUTES
                    })
                });
                console.log(`[Meta Webhook] Pause extended for user ${recipientId} by admin reply`);

                // 記錄管理者回覆到 CMS
                await saveConversationToWix({
                    senderId: recipientId,
                    senderName: 'Admin',
                    source,
                    userMessage: '[管理者回覆]',
                    aiResponse: message.text || '[附件]',
                    isPaused: true,
                    needsHumanReview: false
                });
            } catch (error) {
                console.error('[Meta Webhook] Error extending pause:', error);
            }
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
        // ======= 暫停檢查 (Pause Check) =======
        // 如果用戶已被標記為等待真人客服，則不進行 AI 回覆
        if (await isUserPaused(senderId)) {
            console.log(`[Meta Webhook] User ${senderId} is waiting for human agent, skipping AI response`);
            // 記錄對話但不回覆
            const userProfile = await getUserProfile(senderId, source);
            await saveConversationToWix({
                senderId,
                senderName: userProfile?.name || '',
                source,
                userMessage: message.text || '[附件]',
                aiResponse: '[等待真人客服中，AI 暫停回覆]',
                hasAttachment: !!message.attachments,
                needsHumanReview: true,
                isPaused: true
            });
            return;
        }

        // 取得用戶資料（名稱等）
        const userProfile = await getUserProfile(senderId, source);

        // 檢查是否有附件（圖片、影片等）
        if (message.attachments && message.attachments.length > 0) {
            await handleAttachment(senderId, message.attachments, source, userProfile);
            return;
        }

        // 純文字訊息
        if (message.text) {
            // ======= 真人客服關鍵字偵測 =======
            const humanKeywords = ['真人', '客服', '人工', '專人', '轉接', '找人', '活人'];
            const textLower = message.text.toLowerCase();
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
                    needsHumanReview: true,
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
        needsHumanReview: true,
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
                body: JSON.stringify({ senderId, limit: 5 })
            });
            const historyData = await historyResponse.json();
            if (historyData.success && historyData.conversationHistory) {
                conversationHistory = historyData.conversationHistory;
                console.log(`[Meta Webhook] Loaded ${conversationHistory.length} history messages`);
            }
        } catch (e) {
            console.error('[Meta Webhook] Failed to get conversation history:', e.message);
        }

        // Step 2: 呼叫 Wix 的 chat API（完整包含產品搜尋邏輯）
        const chatResponse = await fetch(`${WIX_API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                conversationHistory
            })
        });

        const chatData = await chatResponse.json();
        console.log('[Meta Webhook] Chat response received:', { success: chatData.success });

        if (chatData.success && chatData.response) {
            // 在 AI 回覆前加上機器人標註，讓用戶能分辨 AI 和人工回覆
            const aiPrefixedResponse = `🤖 ${chatData.response}`;

            // 發送 AI 回覆
            await sendMessage(senderId, aiPrefixedResponse, source);

            // 記錄對話到 Wix CMS
            await saveConversationToWix({
                senderId,
                senderName: userProfile?.name || '',
                source,
                userMessage: text,
                aiResponse: chatData.response,
                hasAttachment: false,
                needsHumanReview: false
            });
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
        needsHumanReview: true,
        isPaused: true
    });

    // TODO: 執行 Handover Protocol 切換真人客服
    // await handoverToInbox(senderId, source);
}

// ============================================
// 發送訊息
// ============================================

async function sendMessage(recipientId, text, source = 'facebook') {
    // 根據平台設定訊息長度限制（減少發送時間避免 webhook 超時）
    // Instagram: 800 字元, Facebook: 1500 字元
    const maxLength = source === 'instagram' ? 800 : 1500;
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
            // 找最近的換行符號
            let splitIndex = remaining.lastIndexOf('\n', maxLength);
            if (splitIndex === -1 || splitIndex < maxLength / 2) {
                splitIndex = maxLength;
            }
            messages.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }
    }

    // 發送每段訊息
    for (const msg of messages) {
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

async function saveConversation(senderId, userMessage, aiResponse, source, userProfile, needsHumanReview = false) {
    try {
        // 呼叫 Wix HTTP Function 儲存對話
        // TODO: 需要在 Wix 建立對應的 API 端點
        console.log('[Meta Webhook] Saving conversation:', {
            senderId,
            source,
            userName: userProfile?.name,
            needsHumanReview
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
                needsHumanReview,
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
