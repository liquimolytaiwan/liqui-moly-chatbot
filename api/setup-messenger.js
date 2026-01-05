/**
 * LIQUI MOLY Chatbot - Setup Messenger Profile API
 * 設定 Facebook Messenger 的 Persistent Menu 和 Get Started Button
 * 
 * 使用方法：GET /api/setup-messenger
 */

const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!PAGE_ACCESS_TOKEN) {
        return res.status(500).json({
            success: false,
            error: 'META_PAGE_ACCESS_TOKEN not configured'
        });
    }

    const results = {
        getStarted: null,
        persistentMenu: null
    };

    // 1. 設定 Get Started Button
    try {
        const getStartedResponse = await fetch(
            `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    get_started: {
                        payload: 'GET_STARTED'
                    }
                })
            }
        );
        const getStartedData = await getStartedResponse.json();
        results.getStarted = getStartedData;
        console.log('Get Started Button:', getStartedData);
    } catch (error) {
        results.getStarted = { error: error.message };
        console.error('Get Started Button Error:', error);
    }

    // 2. 設定 Persistent Menu
    try {
        const menuResponse = await fetch(
            `https://graph.facebook.com/v18.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    persistent_menu: [{
                        locale: 'default',
                        composer_input_disabled: false,
                        call_to_actions: [
                            {
                                type: 'postback',
                                title: '🤖 AI 產品諮詢',
                                payload: 'RESUME_AI'
                            },
                            {
                                type: 'postback',
                                title: '👤 真人客服',
                                payload: 'HUMAN_AGENT'
                            },
                            {
                                type: 'web_url',
                                title: '📝 聯絡我們',
                                url: 'https://www.liqui-moly-tw.com/contact'
                            }
                        ]
                    }]
                })
            }
        );
        const menuData = await menuResponse.json();
        results.persistentMenu = menuData;
        console.log('Persistent Menu:', menuData);
    } catch (error) {
        results.persistentMenu = { error: error.message };
        console.error('Persistent Menu Error:', error);
    }

    // 返回結果
    const success =
        results.getStarted?.result === 'success' &&
        results.persistentMenu?.result === 'success';

    return res.status(success ? 200 : 500).json({
        success,
        message: success
            ? 'Messenger profile configured successfully!'
            : 'Some configurations failed, check details',
        details: results
    });
}
