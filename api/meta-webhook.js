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
// 真人客服暫停機制 (Human Handover Pause)
// ============================================

// 暫停時間（毫秒）- 預設 30 分鐘
const HUMAN_HANDOVER_PAUSE_DURATION = 30 * 60 * 1000;

// 記憶體快取：記錄哪些用戶正在等待真人客服
// 格式: { senderId: { pauseUntil: timestamp, reason: string } }
// 注意：Vercel Serverless 是 stateless，此快取在冷啟動時會重置
// 未來可改用 Redis 或 Wix CMS 持久化存儲
const humanHandoverCache = new Map();

// 檢查用戶是否在暫停期間
function isUserPaused(senderId) {
    const pauseInfo = humanHandoverCache.get(senderId);
    if (!pauseInfo) return false;

    if (Date.now() < pauseInfo.pauseUntil) {
        console.log(`[Pause] User ${senderId} is paused until ${new Date(pauseInfo.pauseUntil).toISOString()}`);
        return true;
    }

    // 暫停已過期，清除記錄
    humanHandoverCache.delete(senderId);
    console.log(`[Pause] User ${senderId} pause expired, resuming AI`);
    return false;
}

// 將用戶設為暫停狀態
function pauseUserForHumanHandover(senderId, reason = 'image_attachment') {
    const pauseUntil = Date.now() + HUMAN_HANDOVER_PAUSE_DURATION;
    humanHandoverCache.set(senderId, { pauseUntil, reason });
    console.log(`[Pause] User ${senderId} paused for ${HUMAN_HANDOVER_PAUSE_DURATION / 60000} minutes. Reason: ${reason}`);
}

// 手動恢復用戶的 AI 回覆
function resumeUserAI(senderId) {
    humanHandoverCache.delete(senderId);
    console.log(`[Pause] User ${senderId} manually resumed`);
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

    // 忽略 echo 訊息（自己發的）
    if (message?.is_echo) {
        console.log('[Meta Webhook] Ignoring echo message');
        return;
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
        if (isUserPaused(senderId)) {
            console.log(`[Meta Webhook] User ${senderId} is waiting for human agent, skipping AI response`);
            // 記錄對話但不回覆
            const userProfile = await getUserProfile(senderId, source);
            await saveConversation(senderId, message.text || '[附件]', '[等待真人客服中，AI 暫停回覆]', source, userProfile, true);
            return;
        }

        // 取得用戶資料（名稱等）
        const userProfile = await getUserProfile(senderId, source);

        // 檢查是否有附件（圖片、影片等）
        if (message.attachments && message.attachments.length > 0) {
            await handleAttachment(senderId, message.attachments, source, userProfile);
            return;
        }

        // 純文字訊息 → AI 回覆
        if (message.text) {
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
// 處理文字訊息
// ============================================

async function handleTextMessage(senderId, text, source, userProfile) {
    console.log(`[Meta Webhook] Processing text message: "${text.substring(0, 50)}..."`);

    // 呼叫現有的 AI Chatbot 邏輯
    try {
        // Step 1: 呼叫 analyze API
        const analyzeResponse = await fetch(`${VERCEL_API_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                conversationHistory: [] // TODO: 從 Wix CMS 取得對話歷史
            })
        });
        const analyzeData = await analyzeResponse.json();

        // Step 2: 呼叫 Wix 搜尋產品（透過 Wix HTTP Functions）
        let productContext = '目前沒有產品資料';
        try {
            // 這裡需要一個新的 Wix API 端點來處理 Meta 來源的搜尋
            // 暫時跳過，直接使用 chat API
        } catch (e) {
            console.log('[Meta Webhook] Product search skipped');
        }

        // Step 3: 呼叫 chat API 取得 AI 回覆
        const chatResponse = await fetch(`${VERCEL_API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                conversationHistory: [],
                productContext
            })
        });
        const chatData = await chatResponse.json();

        if (chatData.success && chatData.response) {
            // 發送 AI 回覆
            await sendMessage(senderId, chatData.response, source);

            // 記錄對話到 Wix CMS
            await saveConversation(senderId, text, chatData.response, source, userProfile);
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
    const pauseMinutes = HUMAN_HANDOVER_PAUSE_DURATION / 60000;
    const response = `感謝您傳送圖片！🖼️

目前 AI 助理尚未支援圖片辨識功能，系統將自動為您轉接真人客服。

⏰ 服務時間：週一至週五 09:00-18:00
⏱️ AI 助理將暫停回覆 ${pauseMinutes} 分鐘，等待真人客服處理
📝 您也可以填寫聯絡表單：https://www.liqui-moly-tw.com/contact

請稍候，我們會盡快回覆您！`;

    await sendMessage(senderId, response, source);

    // ======= 啟動暫停機制 =======
    // 用戶傳送圖片後，暫停 AI 回覆 30 分鐘
    pauseUserForHumanHandover(senderId, 'image_attachment');

    // 記錄到 CMS（標記為需要真人處理）
    await saveConversation(senderId, '[用戶傳送圖片]', response, source, userProfile, true);

    // TODO: 執行 Handover Protocol 切換真人客服
    // await handoverToInbox(senderId, source);
}

// ============================================
// 發送訊息
// ============================================

async function sendMessage(recipientId, text, source = 'facebook') {
    // 分割長訊息（Facebook 有 2000 字元限制）
    const maxLength = 2000;
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
// 取得用戶資料
// ============================================

async function getUserProfile(userId, source = 'facebook') {
    try {
        const fields = source === 'instagram'
            ? 'name,username'
            : 'first_name,last_name,profile_pic';

        const response = await fetch(
            `https://graph.facebook.com/v18.0/${userId}?fields=${fields}&access_token=${PAGE_ACCESS_TOKEN}`
        );

        if (response.ok) {
            const data = await response.json();
            return {
                name: data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown',
                username: data.username || null,
                profilePic: data.profile_pic || null
            };
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
