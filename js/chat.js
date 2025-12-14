/**
 * LIQUI MOLY Chatbot - Main Chat Module
 * 聊天機器人主程式（含用戶資料收集與對話管理）
 */

class LiquiMolyChatbot {
    constructor() {
        // DOM Elements
        this.formOverlay = document.getElementById('formOverlay');
        this.userInfoForm = document.getElementById('userInfoForm');
        this.chatContainer = document.getElementById('chatContainer');
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.endChatBtn = document.getElementById('endChatBtn');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.sessionEndedOverlay = document.getElementById('sessionEndedOverlay');
        this.restartBtn = document.getElementById('restartBtn');

        // Rating Elements
        this.starRating = document.getElementById('starRating');
        this.skipRatingBtn = document.getElementById('skipRatingBtn');
        this.ratingStep = document.getElementById('ratingStep');
        this.thankYouStep = document.getElementById('thankYouStep');

        // State
        this.conversationHistory = [];
        this.isLoading = false;
        this.sessionId = null;
        this.userInfo = null;
        this.idleTimer = null;
        this.selectedRating = 0;
        this.IDLE_TIMEOUT = 10 * 60 * 1000; // 10 分鐘

        // Initialize
        this.init();
    }

    /**
     * 初始化聊天機器人
     */
    init() {
        // 檢查是否為 iframe 模式
        this.checkIframeMode();

        // 綁定事件
        this.bindEvents();

        // 設定輸入框自動調整高度
        this.setupAutoResize();

        console.log('LIQUI MOLY Chatbot initialized');
    }

    /**
     * 檢查是否以 iframe 方式嵌入
     */
    checkIframeMode() {
        try {
            if (window.self !== window.top) {
                document.body.classList.add('iframe-mode');
            }
        } catch (e) {
            // 跨域情況，視為 iframe 模式
            document.body.classList.add('iframe-mode');
        }
    }

    /**
     * 綁定事件處理器
     */
    bindEvents() {
        // 表單提交
        this.userInfoForm.addEventListener('submit', (e) => this.handleFormSubmit(e));

        // 發送按鈕點擊
        this.sendButton.addEventListener('click', () => this.handleSend());

        // 輸入框鍵盤事件
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        // 輸入框內容變化
        this.messageInput.addEventListener('input', () => {
            this.updateSendButtonState();
            this.resetIdleTimer();
        });

        // 離開按鈕
        this.endChatBtn.addEventListener('click', () => this.handleEndChat());

        // 重新開始按鈕
        this.restartBtn.addEventListener('click', () => this.handleRestart());

        // 快速操作按鈕
        document.querySelectorAll('.quick-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const message = btn.dataset.message;
                if (message) {
                    this.messageInput.value = message;
                    this.handleSend();
                }
            });
        });

        // 監聯用戶活動以重置閒置計時器
        document.addEventListener('mousemove', () => this.resetIdleTimer());
        document.addEventListener('keypress', () => this.resetIdleTimer());

        // 監聽頁面關閉事件，嘗試結束對話
        window.addEventListener('beforeunload', (e) => this.handlePageUnload(e));

        // pagehide 事件在頁面卸載時觸發（比 beforeunload 更可靠）
        window.addEventListener('pagehide', (e) => {
            if (this.sessionId) {
                this.sendEndSessionBeacon();
            }
        });

        // 星級評分事件
        if (this.starRating) {
            const stars = this.starRating.querySelectorAll('.star');
            stars.forEach(star => {
                // Hover 效果
                star.addEventListener('mouseenter', () => {
                    const rating = parseInt(star.dataset.rating);
                    this.highlightStars(rating);
                });

                star.addEventListener('mouseleave', () => {
                    this.highlightStars(this.selectedRating);
                });

                // 點擊選擇評分
                star.addEventListener('click', () => {
                    const rating = parseInt(star.dataset.rating);
                    this.selectedRating = rating;
                    this.highlightStars(rating);
                    // 選擇後自動提交
                    this.submitRating(rating);
                });
            });
        }

        // 略過評分按鈕
        if (this.skipRatingBtn) {
            this.skipRatingBtn.addEventListener('click', () => this.submitRating(0));
        }
    }

    /**
     * 高亮星星
     */
    highlightStars(rating) {
        if (!this.starRating) return;
        const stars = this.starRating.querySelectorAll('.star');
        stars.forEach(star => {
            const starRating = parseInt(star.dataset.rating);
            if (starRating <= rating) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        });
    }

    /**
     * 提交評分
     */
    async submitRating(rating) {
        try {
            // 發送評分到後端
            if (this.sessionId) {
                await fetch(CONFIG.API_ENDPOINT + '/rateSession', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: this.sessionId,
                        rating: rating
                    })
                });
            }
        } catch (e) {
            console.error('Submit rating error:', e);
        }

        // 顯示感謝畫面
        if (this.ratingStep) this.ratingStep.style.display = 'none';
        if (this.thankYouStep) this.thankYouStep.style.display = 'block';
    }

    /**
     * 處理頁面關閉/離開
     */
    handlePageUnload(e) {
        if (this.sessionId) {
            // 使用 sendBeacon 在頁面關閉時發送請求
            this.sendEndSessionBeacon();
        }
    }

    /**
     * 使用 sendBeacon 發送結束對話請求（頁面關閉時也能成功發送）
     */
    sendEndSessionBeacon() {
        if (!this.sessionId) return;

        const url = CONFIG.API_ENDPOINT + '/endSession';
        const data = JSON.stringify({ sessionId: this.sessionId });

        // navigator.sendBeacon 在頁面關閉時也能發送
        if (navigator.sendBeacon) {
            const blob = new Blob([data], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
        } else {
            // 備援：使用同步 XMLHttpRequest（舊瀏覽器）
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, false); // 同步請求
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(data);
        }
    }

    /**
     * 處理表單提交
     */
    async handleFormSubmit(e) {
        e.preventDefault();

        const formData = new FormData(this.userInfoForm);
        this.userInfo = {
            userName: formData.get('userName'),
            userEmail: formData.get('userEmail'),
            userPhone: formData.get('userPhone') || '',
            category: formData.get('category')
        };

        // 開始對話 session
        await this.startSession();
    }

    /**
     * 開始對話 session
     */
    async startSession() {
        try {
            this.showLoading(true);

            const response = await fetch(CONFIG.API_ENDPOINT + '/startSession', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.userInfo)
            });

            const data = await response.json();

            if (data.success && data.sessionId) {
                this.sessionId = data.sessionId;

                // 隱藏表單，顯示聊天區域
                this.formOverlay.style.display = 'none';
                this.chatContainer.style.display = 'flex';

                // 開始閒置計時器
                this.startIdleTimer();

                console.log('Session started:', this.sessionId);
            } else {
                throw new Error(data.error || 'Failed to start session');
            }
        } catch (error) {
            console.error('Start session error:', error);
            alert('無法開始對話，請稍後再試。');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 結束對話
     */
    async endSession() {
        if (!this.sessionId) return;

        try {
            await fetch(CONFIG.API_ENDPOINT + '/endSession', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId })
            });

            console.log('Session ended:', this.sessionId);
        } catch (error) {
            console.error('End session error:', error);
        }

        // 清除狀態
        this.clearIdleTimer();
        this.sessionId = null;
        this.conversationHistory = [];
    }

    /**
     * 處理離開對話
     */
    async handleEndChat() {
        if (confirm('確定要離開對話嗎？')) {
            await this.endSession();
            this.showSessionEnded();
        }
    }

    /**
     * 處理重新開始
     */
    handleRestart() {
        // 隱藏結束畫面
        this.sessionEndedOverlay.style.display = 'none';

        // 重置評分介面
        if (this.ratingStep) this.ratingStep.style.display = 'block';
        if (this.thankYouStep) this.thankYouStep.style.display = 'none';
        this.selectedRating = 0;
        this.highlightStars(0);

        // 重置表單
        this.userInfoForm.reset();

        // 清除聊天訊息（保留歡迎訊息）
        this.clearChatMessages();

        // 顯示表單
        this.formOverlay.style.display = 'flex';
        this.chatContainer.style.display = 'none';
    }

    /**
     * 顯示對話結束畫面
     */
    showSessionEnded() {
        this.chatContainer.style.display = 'none';
        this.sessionEndedOverlay.style.display = 'flex';
    }

    /**
     * 開始閒置計時器
     */
    startIdleTimer() {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.handleIdleTimeout();
        }, this.IDLE_TIMEOUT);
    }

    /**
     * 重置閒置計時器
     */
    resetIdleTimer() {
        if (this.sessionId) {
            this.startIdleTimer();
        }
    }

    /**
     * 清除閒置計時器
     */
    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * 處理閒置超時
     */
    async handleIdleTimeout() {
        console.log('Idle timeout, ending session...');
        await this.endSession();
        this.showSessionEnded();
    }

    /**
     * 設定輸入框自動調整高度
     */
    setupAutoResize() {
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
        });
    }

    /**
     * 更新發送按鈕狀態
     */
    updateSendButtonState() {
        const hasContent = this.messageInput.value.trim().length > 0;
        this.sendButton.disabled = !hasContent || this.isLoading;
    }

    /**
     * 處理發送訊息
     */
    async handleSend() {
        const message = this.messageInput.value.trim();

        if (!message || this.isLoading) return;

        // 清空輸入框
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.updateSendButtonState();

        // 隱藏快速操作
        this.hideQuickActions();

        // 顯示用戶訊息
        this.addMessage(message, 'user');

        // 加入對話歷史
        this.conversationHistory.push({
            role: 'user',
            content: message
        });

        // 重置閒置計時器
        this.resetIdleTimer();

        // 取得 AI 回覆
        await this.getAIResponse(message);
    }

    /**
     * 隱藏快速操作按鈕
     */
    hideQuickActions() {
        const quickActions = document.querySelector('.quick-actions');
        if (quickActions) {
            quickActions.style.display = 'none';
        }
    }

    /**
     * 清除聊天訊息（保留歡迎訊息）
     */
    clearChatMessages() {
        const messages = this.chatMessages.querySelectorAll('.message');
        messages.forEach((msg, index) => {
            if (index > 0) {
                msg.remove();
            }
        });

        // 重新顯示快速操作
        const quickActions = document.querySelector('.quick-actions');
        if (quickActions) {
            quickActions.style.display = 'flex';
        }
    }

    /**
     * 新增訊息到聊天區域
     */
    addMessage(content, sender, isHTML = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;

        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

        if (sender === 'bot') {
            messageDiv.innerHTML = `
                <div class="message-avatar">
                    <img src="assets/bot-avatar.jpg" alt="助理">
                </div>
                <div class="message-content">
                    <div class="message-bubble">${isHTML ? content : this.formatMessage(content)}</div>
                    <span class="message-time">${timeStr}</span>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-bubble">${this.escapeHTML(content)}</div>
                    <span class="message-time">${timeStr}</span>
                </div>
            `;
        }

        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();

        return messageDiv;
    }

    /**
     * 顯示打字指示器
     */
    showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message typing-message';
        typingDiv.innerHTML = `
            <div class="message-avatar">
                <img src="assets/bot-avatar.jpg" alt="助理">
            </div>
            <div class="message-content">
                <div class="message-bubble">
                    <div class="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;

        this.chatMessages.appendChild(typingDiv);
        this.scrollToBottom();

        return typingDiv;
    }

    /**
     * 移除打字指示器
     */
    removeTypingIndicator(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }

    /**
     * 取得 AI 回應
     */
    async getAIResponse(message) {
        this.isLoading = true;
        this.updateSendButtonState();

        const typingIndicator = this.showTypingIndicator();

        try {
            let response;

            if (CONFIG.DEV_MODE) {
                // 開發模式：使用模擬回應
                await this.sleep(1000);
                response = CONFIG.MOCK_RESPONSES.default;
            } else {
                // 正式模式：呼叫 Wix Backend API
                response = await this.callChatAPI(message);
            }

            // 移除打字指示器
            this.removeTypingIndicator(typingIndicator);

            // 顯示回應
            this.addMessage(response, 'bot');

            // 加入對話歷史
            this.conversationHistory.push({
                role: 'assistant',
                content: response
            });

            // 限制對話歷史長度
            this.trimConversationHistory();

        } catch (error) {
            console.error('Chat error:', error);
            this.removeTypingIndicator(typingIndicator);
            this.addMessage('抱歉，目前服務暫時無法使用，請稍後再試。如有緊急需求，請透過<a href="' + CONFIG.CONTACT_URL + '" target="_blank">聯絡我們</a>頁面與我們聯繫。', 'bot', true);
        } finally {
            this.isLoading = false;
            this.updateSendButtonState();
        }
    }

    /**
     * 呼叫聊天 API
     */
    async callChatAPI(message) {
        const apiUrl = CONFIG.API_ENDPOINT + CONFIG.ENDPOINTS.CHAT;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                sessionId: this.sessionId,
                conversationHistory: this.conversationHistory.slice(-CONFIG.CONVERSATION.MAX_HISTORY)
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.response;
    }

    /**
     * 格式化訊息內容
     */
    formatMessage(text) {
        // 先處理 Markdown 連結 [text](url) - 在轉義前處理
        // 保存連結為暫存標記
        const links = [];
        let formatted = text.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (match, linkText, url) => {
                const index = links.length;
                links.push({ text: linkText, url: url });
                return `__LINK_PLACEHOLDER_${index}__`;
            }
        );

        // 轉義 HTML 特殊字元
        formatted = this.escapeHTML(formatted);

        // 還原連結（使用 HTML 格式）
        links.forEach((link, index) => {
            formatted = formatted.replace(
                `__LINK_PLACEHOLDER_${index}__`,
                `<a href="${link.url}" target="_blank" rel="noopener">${this.escapeHTML(link.text)}</a>`
            );
        });

        // 轉換獨立的 URL 為連結（排除已經在 <a> 標籤內的）
        formatted = formatted.replace(
            /(?<!href="|">)(https?:\/\/[^\s<]+)(?![^<]*<\/a>)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>'
        );

        // 轉換換行
        formatted = formatted.replace(/\n/g, '<br>');

        // 轉換粗體 **text**
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 轉換列表項目
        formatted = formatted.replace(/^- (.+)$/gm, '<li>$1</li>');

        // 包裝連續的列表項目
        formatted = formatted.replace(/(<li>.*?<\/li>)(\s*<br>\s*<li>.*?<\/li>)*/gs, (match) => {
            return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
        });

        return formatted;
    }

    /**
     * 轉義 HTML 特殊字元
     */
    escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 捲動到底部
     */
    scrollToBottom() {
        setTimeout(() => {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }, CONFIG.UI.SCROLL_DELAY);
    }

    /**
     * 限制對話歷史長度
     */
    trimConversationHistory() {
        if (this.conversationHistory.length > CONFIG.CONVERSATION.MAX_HISTORY) {
            this.conversationHistory = this.conversationHistory.slice(-CONFIG.CONVERSATION.MAX_HISTORY);
        }
    }

    /**
     * 顯示/隱藏載入狀態
     */
    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.add('active');
        } else {
            this.loadingOverlay.classList.remove('active');
        }
    }

    /**
     * 延遲函數
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 頁面載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    window.chatbot = new LiquiMolyChatbot();
});
