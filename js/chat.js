/**
 * LIQUI MOLY Chatbot - Main Chat Module
 * 聊天機器人主程式
 */

class LiquiMolyChatbot {
    constructor() {
        // DOM Elements
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.loadingOverlay = document.getElementById('loadingOverlay');

        // State
        this.conversationHistory = [];
        this.isLoading = false;

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

        // 自動調整輸入框高度
        this.setupAutoResize();

        // 載入對話歷史（如有）
        this.loadConversationHistory();

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
        });

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
                    <img src="assets/bot-avatar.svg" alt="助理">
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
                <img src="assets/bot-avatar.svg" alt="助理">
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

            // 儲存對話歷史
            this.saveConversationHistory();

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
        // 轉義 HTML
        let formatted = this.escapeHTML(text);

        // 轉換 Markdown 連結 [text](url)
        formatted = formatted.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>'
        );

        // 轉換 URL 為連結
        formatted = formatted.replace(
            /(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>'
        );

        // 轉換換行
        formatted = formatted.replace(/\n/g, '<br>');

        // 轉換粗體 **text**
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 轉換列表
        formatted = formatted.replace(/^- (.+)$/gm, '<li>$1</li>');
        formatted = formatted.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

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
     * 儲存對話歷史到 localStorage
     */
    saveConversationHistory() {
        try {
            localStorage.setItem('liquiMolyChatHistory', JSON.stringify(this.conversationHistory));
        } catch (e) {
            console.warn('Unable to save chat history:', e);
        }
    }

    /**
     * 載入對話歷史
     */
    loadConversationHistory() {
        try {
            const saved = localStorage.getItem('liquiMolyChatHistory');
            if (saved) {
                this.conversationHistory = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Unable to load chat history:', e);
        }
    }

    /**
     * 清除對話歷史
     */
    clearHistory() {
        this.conversationHistory = [];
        localStorage.removeItem('liquiMolyChatHistory');

        // 清除聊天區域除了歡迎訊息
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
