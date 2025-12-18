/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 搜尋產品並執行 Title Expansion
 * 
 * 這個 API 取代了 Wix 端的搜尋邏輯，讓所有搜尋邏輯都在 Vercel 執行
 */

const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

// 產品快取 (30 分鐘過期)
let productsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 分鐘

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, searchInfo } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Missing message parameter' });
        }

        // 取得產品列表 (使用快取)
        const products = await getProducts();
        if (!products || products.length === 0) {
            Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
            return res.status(200).json({
                success: true,
                productContext: '目前沒有產品資料'
            });
        }

        // 執行搜尋
        const searchResults = searchProducts(products, message, searchInfo);

        // 執行 Title Expansion
        const expandedResults = titleExpansion(products, searchResults);

        // 格式化輸出
        const productContext = formatProducts(expandedResults);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({
            success: true,
            productContext,
            productCount: expandedResults.length
        });

    } catch (error) {
        console.error('Search API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// 從 Wix 取得產品列表 (使用快取)
async function getProducts() {
    const now = Date.now();

    // 檢查快取是否有效
    if (productsCache && (now - cacheTimestamp) < CACHE_DURATION) {
        console.log('Using cached products:', productsCache.length);
        return productsCache;
    }

    try {
        console.log('Fetching products from Wix...');
        const response = await fetch(`${WIX_API_URL}/products`);
        const data = await response.json();

        if (data.success && data.products) {
            productsCache = data.products;
            cacheTimestamp = now;
            console.log('Fetched and cached products:', productsCache.length);
            return productsCache;
        }
    } catch (e) {
        console.error('Failed to fetch products:', e);
    }

    return productsCache || [];
}

// 搜尋產品
function searchProducts(products, message, searchInfo) {
    const results = [];
    const seenIds = new Set();

    // 從 searchInfo 取得搜尋指令
    const queries = searchInfo?.wixQueries || [];
    const keywords = searchInfo?.searchKeywords || [];

    // 偵測是否為大包裝查詢
    const largePackageKeywords = ['大包裝', '大公升', '4l', '5l', '20l', '經濟包', '大瓶', '大容量'];
    const messageLower = message.toLowerCase();
    const isLargePackageQuery =
        largePackageKeywords.some(lpk => messageLower.includes(lpk)) ||
        keywords.some(kw => largePackageKeywords.some(lpk => kw.toLowerCase().includes(lpk)));

    // 1. 執行搜尋指令
    for (const query of queries) {
        const matchedProducts = products.filter(p => {
            const fieldValue = p[query.field];
            if (!fieldValue) return false;

            const value = String(fieldValue).toLowerCase();
            const searchValue = String(query.value).toLowerCase();

            if (query.method === 'eq') {
                return value === searchValue;
            } else {
                return value.includes(searchValue);
            }
        });

        for (const p of matchedProducts.slice(0, query.limit || 20)) {
            if (!seenIds.has(p.id)) {
                seenIds.add(p.id);
                results.push(p);
            }
        }
    }

    // 2. 如果是大包裝查詢，額外搜尋大容量產品
    if (isLargePackageQuery) {
        console.log('Large package query detected');
        const largeSizes = ['4L', '5L', '20L', '60L', '205L'];

        for (const p of products) {
            if (p.size && largeSizes.some(size => p.size.includes(size))) {
                if (!seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    results.push(p);
                }
            }
        }
    }

    console.log('Search results before expansion:', results.length);
    
    // === 摩托車過濾 (Motorcycle Filter) - 最終防線 ===
    // 若 vehicleType = 摩托車 且 productCategory = 機油，過濾掉非 Motorbike 產品
    const vehicleType = searchInfo?.vehicleType;
    const productCategory = searchInfo?.productCategory;
    
    if (vehicleType === '摩托車' && productCategory === '機油') {
        const filteredResults = results.filter(p => {
            const title = (p.title || '').toLowerCase();
            const sort = (p.sort || '').toLowerCase();
            return title.includes('motorbike') || sort.includes('摩托車');
        });
        console.log('[Motorcycle Filter] Filtered', results.length, '->', filteredResults.length, 'products');
        if (filteredResults.length > 0) {
            return filteredResults;
        }
    }
    
    return results;
}

// Title Expansion - 核心邏輯
function titleExpansion(products, searchResults) {
    if (searchResults.length === 0 || searchResults.length > 20) {
        return searchResults;
    }

    const seenIds = new Set(searchResults.map(p => p.id));
    const expandedResults = [...searchResults];

    // 取得要擴展的標題
    const titlesToExpand = [...new Set(searchResults.map(p => p.title).filter(Boolean))];

    console.log('Titles to expand:', titlesToExpand);

    // 搜尋同標題的所有產品
    for (const title of titlesToExpand.slice(0, 3)) {
        const matchedProducts = products.filter(p => p.title === title);
        console.log(`Title "${title}" matched ${matchedProducts.length} products`);

        for (const p of matchedProducts) {
            if (!seenIds.has(p.id)) {
                seenIds.add(p.id);
                expandedResults.push(p);
            }
        }
    }

    console.log('Results after title expansion:', expandedResults.length);
    return expandedResults;
}

// 格式化產品資料 (精簡版，避免 AI 截斷)
function formatProducts(products) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    let context = `## ⚠️ 重要：只能推薦以下產品，禁止編造產品編號！

## 可用產品列表 (共 ${products.length} 筆)

| 編號 | 產品名稱 | 容量 | 連結 |
|------|----------|------|------|
`;

    products.forEach(p => {
        const url = p.partno
            ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}`
            : 'https://www.liqui-moly-tw.com/products/';

        context += `| ${p.partno || 'N/A'} | ${p.title || '未命名'} | ${p.size || 'N/A'} | ${url} |\n`;
    });

    return context;
}
