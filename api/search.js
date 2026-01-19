/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 統一產品搜尋邏輯（完整版）
 *
 * P0 優化：使用統一服務模組
 * - certification-matcher.js: 認證搜尋（取代 searchWithCertUpgrade）
 * - motorcycle-rules.js: 摩托車規則搜尋（取代 User Defined Rules）
 * - constants.js: 統一常數
 *
 * 功能：
 * - 完整 Title Expansion（含多 SKU 匹配）
 * - 多車型分類輸出
 * - 症狀格式化說明
 * - 產品快取機制
 * - 認證兼容性搜尋（GF-7A → GF-6A 等）
 */

// 導入統一服務模組（CommonJS）- 從 lib 資料夾載入
const { searchWithCertUpgrade, searchWithViscosityFallback, searchWithCertPriority, getScooterCertScore, isAPICertification } = require('../lib/certification-matcher.js');
const { searchMotorcycleOil, filterMotorcycleProducts, getSyntheticScore, sortMotorcycleProducts, isScooter } = require('../lib/motorcycle-rules.js');
const {
    WIX_API_URL,
    PRODUCT_BASE_URL,
    CORS_HEADERS,
    CACHE_DURATION,
    SEARCH_LIMITS,
    LOG_TAGS
} = require('../lib/constants.js');
const { getCategoryToSort } = require('../lib/search-helper.js');

// 產品快取
let productsCache = null;
let cacheTimestamp = 0;

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
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

        // Debug: 輸出 searchInfo 內容
        console.log(`${LOG_TAGS.SEARCH} Received searchInfo:`, JSON.stringify(searchInfo || {}, null, 2));

        if (!products || products.length === 0) {
            Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
            return res.status(200).json({
                success: true,
                productContext: '目前沒有產品資料'
            });
        }

        // 執行完整版搜尋
        const productContext = searchProducts(products, message, searchInfo);

        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(200).json({
            success: true,
            productContext
        });

    } catch (error) {
        console.error('Search API error:', error);
        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================
// 從 Wix 取得產品列表 (使用快取)
// ============================================
async function getProducts() {
    const now = Date.now();

    // 檢查快取是否有效
    if (productsCache && (now - cacheTimestamp) < CACHE_DURATION.products) {
        console.log(`${LOG_TAGS.SEARCH} Using cached products:`, productsCache.length);
        return productsCache;
    }

    try {
        console.log(`${LOG_TAGS.SEARCH} Fetching products from Wix...`);
        const response = await fetch(`${WIX_API_URL}/products`);
        const data = await response.json();

        if (data.success && data.products) {
            productsCache = data.products;
            cacheTimestamp = now;
            console.log(`${LOG_TAGS.SEARCH} Fetched and cached products:`, productsCache.length);
            return productsCache;
        }
    } catch (e) {
        console.error(`${LOG_TAGS.SEARCH} Failed to fetch products:`, e);
    }

    return productsCache || [];
}

// ============================================
// 完整版搜尋邏輯（移植自 Wix searchProducts）
// ============================================

// 注意：searchWithCertUpgrade 已從 certification-matcher.js 匯入
function searchProducts(products, query, searchInfo) {
    try {
        let allResults = [];
        const seenIds = new Set();
        const productCategory = searchInfo?.productCategory || '機油';

        // ============================================
        // 0. 認證搜尋優先處理（當用戶明確詢問認證時）
        // ============================================
        const certSearchRequest = searchInfo?.certificationSearch;
        if (certSearchRequest && certSearchRequest.requestedCert) {
            console.log('[Search] Certification search mode activated:', JSON.stringify(certSearchRequest));

            const certResult = searchWithCertUpgrade(
                products,
                certSearchRequest.requestedCert,
                certSearchRequest.viscosity || null
            );

            if (certResult.products.length > 0) {
                // 將認證搜尋結果加入
                for (const p of certResult.products.slice(0, 30)) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }

                // 傳遞認證通知給格式化函式
                const formattedResult = formatProducts(allResults, {
                    ...searchInfo,
                    certNotice: certResult.certNotice,
                    usedCert: certResult.usedCert,
                    isUpgrade: certResult.isUpgrade,
                    requestedCert: certResult.requestedCert
                });
                return formattedResult;
            } else {
                // 無結果時，返回明確的無結果訊息
                return `## ⚠️ 查無符合條件的產品

${certResult.certNotice || `目前沒有符合 ${certSearchRequest.requestedCert} 認證的產品`}

請確認：
1. 認證名稱是否正確（如 ILSAC GF-6A、API SP 等）
2. 是否可接受更高等級的兼容認證`;
            }
        }

        // 0.5 摩托車機油搜尋（使用統一的摩托車規則引擎）
        const vehicleInfo = searchInfo?.vehicles?.[0];
        if (vehicleInfo && vehicleInfo.vehicleType === '摩托車' && productCategory === '機油') {
            console.log(`${LOG_TAGS.SEARCH} Using Motorcycle Rules Engine:`, JSON.stringify(vehicleInfo));

            // 使用統一的摩托車規則引擎
            const matches = searchMotorcycleOil(products, vehicleInfo);

            if (matches.length > 0) {
                // 全合成優先排序（跑山/賽道場景）
                const recommendSynthetic = searchInfo?.recommendSynthetic;
                let sortedMatches = matches;

                if (recommendSynthetic === 'full') {
                    console.log(`${LOG_TAGS.SEARCH} Applying synthetic priority sorting`);
                    sortedMatches = sortMotorcycleProducts(matches, {
                        preferFullSynthetic: true,
                        isScooter: isScooter(vehicleInfo)
                    });
                }

                return formatProducts(sortedMatches.slice(0, SEARCH_LIMITS.max), searchInfo);
            } else {
                console.log(`${LOG_TAGS.SEARCH} Motorcycle Rules matched 0 products, falling back to query search`);
            }
        }

        // 0.6 汽車機油搜尋（智慧認證搜尋：API最新優先 / OEM精確匹配）
        if (vehicleInfo && vehicleInfo.vehicleType === '汽車' && productCategory === '機油') {
            const requestedCert = vehicleInfo.certifications?.[0];
            const requestedViscosity = vehicleInfo.viscosity;

            if (requestedCert) {
                console.log(`${LOG_TAGS.SEARCH} Using Smart Certification Search: cert=${requestedCert}, viscosity=${requestedViscosity}`);

                // 優先檢查：用戶是否指定了特定 SKU？
                // 如果用戶問「LM9047 能用嗎」，即使 9047 不符合推論的認證，也必須把它找出來給 AI 判斷
                const skuMatch = query.match(/(?:LM|lm)?[- ]?([0-9]{4,5})/);
                let specificSkuProduct = null;
                if (skuMatch) {
                    const skuNum = skuMatch[1];
                    const fullSku = `LM${skuNum}`;
                    specificSkuProduct = products.find(p => p.partno === fullSku || p.partno === skuNum);
                    if (specificSkuProduct) {
                        console.log(`${LOG_TAGS.SEARCH} 🎯 Specific SKU query detected: ${fullSku}, will force include in results.`);
                    }
                }

                // 使用智慧認證搜尋（API認證會自動升級到最新版本，OEM認證則精確匹配）
                const certResult = searchWithCertPriority(
                    products,
                    requestedCert,
                    requestedViscosity
                );

                // ⚡ 強制合併特定 SKU 產品
                if (specificSkuProduct) {
                    // 檢查是否已存在於結果中
                    const exists = certResult.products.some(p => p.id === specificSkuProduct.id);
                    if (!exists) {
                        // 加到最前面
                        certResult.products.unshift(specificSkuProduct);
                        // 如果原本沒結果，現在有結果了，要確保 fallback 標記正確
                        if (certResult.products.length === 1) {
                            // 這是唯一的產品
                        }
                    }
                }

                if (certResult.products.length > 0) {
                    console.log(`${LOG_TAGS.SEARCH} Smart cert search found ${certResult.products.length} products (strategy=${certResult.certStrategy}, fallback=${certResult.fallbackUsed}, type=${certResult.fallbackType})`);

                    // 根據認證策略決定顯示的通知訊息
                    let displayNotice = certResult.notice;
                    let certUpgradeInfo = null;

                    // API認證升級時，提供清楚的說明
                    if (certResult.certStrategy === 'api_newest' && certResult.fallbackType === 'cert_upgrade') {
                        certUpgradeInfo = {
                            originalCert: requestedCert,
                            upgradedCert: certResult.usedCert,
                            explanation: `${certResult.usedCert} 是比 ${requestedCert} 更新的認證版本，向後兼容舊版認證。`
                        };
                    }

                    return formatProducts(certResult.products.slice(0, SEARCH_LIMITS.max), {
                        ...searchInfo,
                        fallbackNotice: displayNotice,
                        fallbackType: certResult.fallbackType,
                        usedCert: certResult.usedCert,
                        requestedViscosity: certResult.requestedViscosity,
                        certStrategy: certResult.certStrategy,
                        certUpgradeInfo: certUpgradeInfo
                    });
                } else {
                    console.log(`${LOG_TAGS.SEARCH} Smart cert search found 0 products, falling back to query search`);
                }
            }
        }

        // 1. 執行 Vercel 傳來的搜尋指令
        const queries = searchInfo?.wixQueries || [];

        // 認證正規化函式（移除空格、連字號和常見後綴詞，統一匹配格式）
        // 例：「MB-Approval 229.71」→「MB229.71」，「MB 229.71」→「MB229.71」
        // 例：「VW 504 00」→「VW50400」，「VW504 00」→「VW50400」
        // 例：「BMW LL-01」→「BMWLONGLIFE01」，「BMW Longlife-01」→「BMWLONGLIFE01」
        const normalizeCertForSearch = (str) => {
            if (!str) return '';
            return str.toUpperCase()
                .replace(/[-\s]/g, '')          // 移除空格和連字號
                .replace(/APPROVAL[S]?/g, '')   // 移除「APPROVAL」後綴
                .replace(/\bLL(\d)/g, 'LONGLIFE$1');  // BMW LL-01 → LONGLIFE01
        };

        if (queries.length > 0) {
            for (const task of queries) {
                try {
                    let matchedProducts = products.filter(p => {
                        const fieldValue = p[task.field];
                        if (!fieldValue) return false;

                        // 認證欄位使用正規化比對（處理空格和連字號差異）
                        if (task.field === 'cert') {
                            const normalizedValue = normalizeCertForSearch(String(fieldValue));
                            const normalizedSearch = normalizeCertForSearch(String(task.value));
                            if (task.method === 'contains') {
                                return normalizedValue.includes(normalizedSearch);
                            } else if (task.method === 'eq') {
                                return normalizedValue === normalizedSearch;
                            }
                        }

                        // 其他欄位使用原本的比對方式
                        const value = String(fieldValue).toLowerCase();
                        const searchValue = String(task.value).toLowerCase();

                        if (task.method === 'contains') {
                            return value.includes(searchValue);
                        } else if (task.method === 'eq') {
                            return value === searchValue;
                        }
                        return false;
                    });

                    // 附加條件 (andContains)
                    if (task.andContains) {
                        matchedProducts = matchedProducts.filter(p => {
                            const fieldValue = p[task.andContains.field];
                            if (!fieldValue) return false;
                            return String(fieldValue).toLowerCase().includes(task.andContains.value.toLowerCase());
                        });
                    }

                    // 標題過濾 (filterTitle)
                    if (task.filterTitle && Array.isArray(task.filterTitle)) {
                        matchedProducts = matchedProducts.filter(p =>
                            p.title && task.filterTitle.some(keyword => p.title.includes(keyword))
                        );
                    }

                    // 容量篩選 (filterSize)
                    if (task.filterSize) {
                        const sizeKeyword = task.filterSize.toLowerCase();
                        matchedProducts = matchedProducts.filter(p =>
                            p.size && p.size.toLowerCase().includes(sizeKeyword)
                        );
                    }

                    // 加入結果
                    for (const p of matchedProducts.slice(0, task.limit || 20)) {
                        if (p.id && !seenIds.has(p.id)) {
                            seenIds.add(p.id);
                            allResults.push(p);
                        }
                    }
                } catch (taskError) {
                    console.error(`[Search] Task error [${task.value}]:`, taskError);
                }
            }
        }

        // 2. Fallback 搜尋（如果沒有結果）- 擴大搜尋欄位範圍
        if (allResults.length === 0) {
            console.log(`${LOG_TAGS.SEARCH} No results from wixQueries, using fallback search`);
            const keywords = searchInfo?.searchKeywords || [query];
            console.log(`${LOG_TAGS.SEARCH} Fallback keywords:`, keywords);

            for (const kw of keywords.slice(0, 4)) {
                if (!kw) continue;
                const kwLower = kw.toLowerCase();

                // 判斷關鍵字類型並對應到正確欄位（修正：使用 [0-9] 替代 \d）
                const isSkuKeyword = /^LM[0-9]{4,5}$/i.test(kw);
                const isViscosity = /^[0-9]+W-?[0-9]+$/i.test(kw);


                const matches = products.filter(p => {
                    // SKU 精確匹配 partno
                    if (isSkuKeyword && p.partno) {
                        return p.partno.toUpperCase() === kw.toUpperCase();
                    }
                    // 黏度優先匹配 word2
                    if (isViscosity && p.word2) {
                        if (p.word2.toLowerCase().includes(kwLower)) return true;
                    }
                    // 全欄位搜尋：title, sort, partno, content, word1, word2
                    const titleMatch = p.title && p.title.toLowerCase().includes(kwLower);
                    const sortMatch = p.sort && p.sort.toLowerCase().includes(kwLower);
                    const partnoMatch = p.partno && p.partno.toLowerCase().includes(kwLower);
                    const contentMatch = p.content && p.content.toLowerCase().includes(kwLower);
                    const word1Match = p.word1 && p.word1.toLowerCase().includes(kwLower);
                    const word2Match = p.word2 && p.word2.toLowerCase().includes(kwLower);
                    return titleMatch || sortMatch || partnoMatch || contentMatch || word1Match || word2Match;
                });

                for (const p of matches.slice(0, 10)) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }
            }
            console.log(`${LOG_TAGS.SEARCH} Fallback found ${allResults.length} products`);
        }

        // 3. Title Expansion（完整版，含多 SKU 匹配）
        if (allResults.length > 0 && allResults.length <= 20) {
            // 從 query 中提取 SKU
            // 修正：簡化正則表達式，移除 lookbehind assertion
            const skuPattern = /[Ll][Mm][ -]?([0-9]{4,5})/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];
            let titlesToExpand = [];

            if (allSkuMatches.length > 0) {
                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1] || skuMatch[2];
                    const fullSku = `LM${skuNum}`;
                    const skuProduct = allResults.find(p => p.partno === fullSku);
                    if (skuProduct && skuProduct.title && !titlesToExpand.includes(skuProduct.title)) {
                        titlesToExpand.push(skuProduct.title);
                    }
                }
            }

            // 擴展同標題產品
            for (const exactTitle of titlesToExpand) {
                const sameTitle = products.filter(p => p.title === exactTitle);
                for (const p of sameTitle) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }
            }
        }

        // 4. 多車型處理
        const vehicles = searchInfo?.vehicles || [];
        const isMultiVehicle = searchInfo?.isMultiVehicleQuery || vehicles.length > 1;
        const vehicleType = searchInfo?.vehicleType;

        if (isMultiVehicle && productCategory === '機油') {
            const hasMotorcycle = vehicles.some(v => v.vehicleType === '摩托車');
            const hasCar = vehicles.some(v => v.vehicleType === '汽車');

            if (hasMotorcycle && hasCar) {
                // 分別過濾
                const motorcycleProducts = allResults.filter(p => {
                    const title = (p.title || '').toLowerCase();
                    const sort = (p.sort || '').toLowerCase();
                    return title.includes('motorbike') || sort.includes('摩托車');
                });

                const carProducts = allResults.filter(p => {
                    const title = (p.title || '').toLowerCase();
                    const sort = (p.sort || '').toLowerCase();
                    return !title.includes('motorbike') && !sort.includes('摩托車') && sort.includes('機油');
                });

                console.log(`${LOG_TAGS.SEARCH} Multi-Vehicle: Motorcycle=${motorcycleProducts.length}, Car=${carProducts.length}`);

                if (motorcycleProducts.length > 0 || carProducts.length > 0) {
                    return formatMultiVehicleProducts(motorcycleProducts.slice(0, 15), carProducts.slice(0, 15));
                }
            }
        }

        // 5. 單一車型摩托車過濾（使用統一的摩托車規則）
        if (vehicleType === '摩托車' && productCategory === '機油') {
            const vehicleSubType = searchInfo?.vehicles?.[0]?.vehicleSubType;
            const isScooterVehicle = isScooter(searchInfo?.vehicles?.[0]);

            // 使用統一的過濾函式
            const filteredResults = filterMotorcycleProducts(allResults, {
                isScooter: isScooterVehicle
            });

            console.log(`${LOG_TAGS.SEARCH} Motorcycle filter (isScooter=${isScooterVehicle}): ${allResults.length} -> ${filteredResults.length}`);

            if (filteredResults.length > 0) {
                // 全合成優先排序
                const recommendSynthetic = searchInfo?.recommendSynthetic;
                let sortedResults = filteredResults;

                if (recommendSynthetic === 'full') {
                    console.log(`${LOG_TAGS.SEARCH} Applying synthetic priority sorting for motorcycle`);
                    sortedResults = sortMotorcycleProducts(filteredResults, {
                        preferFullSynthetic: true,
                        isScooter: isScooterVehicle
                    });
                }

                return formatProducts(sortedResults.slice(0, SEARCH_LIMITS.max), searchInfo);
            }
        }

        // 6. SKU 優先排序
        if (allResults.length > 0) {
            // 修正：簡化正則表達式，移除 lookbehind assertion
            const skuPattern = /[Ll][Mm][ -]?([0-9]{4,5})/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];

            if (allSkuMatches.length > 0) {
                let allSkuProducts = [];
                let allMatchedTitles = new Set();

                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1] || skuMatch[2];
                    const fullSku = `LM${skuNum}`;
                    const skuProduct = allResults.find(p => p.partno === fullSku);

                    if (skuProduct && skuProduct.title) {
                        allMatchedTitles.add(skuProduct.title);
                        const sameTitle = allResults.filter(p => p.title === skuProduct.title);
                        allSkuProducts = allSkuProducts.concat(sameTitle);
                    }
                }

                if (allSkuProducts.length > 0) {
                    const skuProductsUnique = [...new Map(allSkuProducts.map(p => [p.id, p])).values()];
                    const others = allResults.filter(p => !allMatchedTitles.has(p.title)).slice(0, 5);
                    const prioritized = [...skuProductsUnique, ...others];
                    return formatProducts(prioritized.slice(0, 20), searchInfo);
                }
            }
        }

        // 7. 全合成優先排序與強制過濾（使用統一的評分函式）
        const recommendSynthetic = searchInfo?.recommendSynthetic;
        if (recommendSynthetic === 'full') {
            const fullSyntheticProducts = allResults.filter(p => getSyntheticScore(p.title) === 3);

            if (fullSyntheticProducts.length > 0) {
                console.log(`${LOG_TAGS.SEARCH} Strict filter applied: Only showing fully synthetic products (${fullSyntheticProducts.length} items)`);
                // 強制只顯示全合成產品
                allResults = fullSyntheticProducts;
            } else {
                console.log(`${LOG_TAGS.SEARCH} Strict filter returned 0 items, fallback to sorting only`);
                // 無法強制過濾，但保留變數供後續排序使用
            }
        }

        // 8. 綜合排序 (認證優先 + 容量優先 + 全合成優先)
        const isScooterSearch = vehicleType === '摩托車' && isScooter(searchInfo?.vehicles?.[0]);

        // 偵測用戶容量偏好（從訊息或 AI 分析結果）
        const queryLower = query.toLowerCase();
        const preferLargePack = searchInfo?.preferLargePack ||
            queryLower.includes('4l') || queryLower.includes('5l') ||
            queryLower.includes('4公升') || queryLower.includes('5公升') ||
            queryLower.includes('大瓶') || queryLower.includes('大包裝') ||
            queryLower.includes('大容量');

        // 將容量偏好加入 searchInfo，供 formatProducts 使用
        if (preferLargePack && searchInfo) {
            searchInfo.preferLargePack = true;
        }

        if (allResults.length > 0) {
            allResults.sort((a, b) => {
                // A. 全合成優先 (若有開啟，且未被強制過濾掉的情況)
                if (recommendSynthetic === 'full') {
                    const scoreA = getSyntheticScore(a.title);
                    const scoreB = getSyntheticScore(b.title);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                }

                // B. 速克達認證優先 (MB > MA/MA2)
                if (isScooterSearch) {
                    const scoreA = getScooterCertScore(a.cert);
                    const scoreB = getScooterCertScore(b.cert);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                }

                // C. 容量優先 (1L > 4L)
                const sizeScoreA = getSizeScore(a.title, a.size, preferLargePack);
                const sizeScoreB = getSizeScore(b.title, b.size, preferLargePack);
                if (sizeScoreA !== sizeScoreB) return sizeScoreB - sizeScoreA;

                return 0;
            });
        }

        // 9. 最終截斷與格式化
        const finalResults = allResults.slice(0, 20); // 取前 20 個

        // 7.5 添加劑優先排序（根據症狀嚴重度、燃料類型和使用場景）
        const symptomSeverity = searchInfo?.symptomSeverity;
        const fuelTypeForAdditive = searchInfo?.fuelType || searchInfo?.vehicles?.[0]?.fuelType;
        const usageScenario = searchInfo?.usageScenario;

        // ⭐ 優先處理：如果 additiveGuideMatch 有指定解決方案產品，將這些產品提到最前面
        const additiveGuideMatch = searchInfo?.additiveGuideMatch;
        if (additiveGuideMatch?.matched && additiveGuideMatch?.items?.length > 0) {
            const solutionSkus = [];
            for (const item of additiveGuideMatch.items) {
                if (item.solutions && Array.isArray(item.solutions)) {
                    solutionSkus.push(...item.solutions);
                }
            }
            if (solutionSkus.length > 0) {
                console.log(`${LOG_TAGS.SEARCH} AdditiveGuideMatch solution SKUs:`, solutionSkus);

                // 將解決方案產品提到最前面
                const solutionProducts = [];
                const otherProducts = [];

                for (const p of allResults) {
                    const partno = (p.partno || '').toUpperCase();
                    if (solutionSkus.some(sku => sku.toUpperCase() === partno)) {
                        solutionProducts.push(p);
                    } else {
                        otherProducts.push(p);
                    }
                }

                // 如果解決方案產品不在 allResults 中，嘗試從全產品列表搜尋
                if (solutionProducts.length < solutionSkus.length) {
                    for (const sku of solutionSkus) {
                        const found = products.find(p => (p.partno || '').toUpperCase() === sku.toUpperCase());
                        if (found && !solutionProducts.some(sp => sp.id === found.id)) {
                            solutionProducts.push(found);
                        }
                    }
                }

                console.log(`${LOG_TAGS.SEARCH} Solution products found:`, solutionProducts.map(p => p.partno));

                // 重組結果：解決方案產品在前
                allResults = [...solutionProducts, ...otherProducts];
            }
        }

        if ((productCategory === '添加劑' || productCategory === '化學品') && allResults.length > 2) {
            console.log(`${LOG_TAGS.SEARCH} Applying additive priority sorting (severity=${symptomSeverity}, fuel=${fuelTypeForAdditive}, scenario=${usageScenario})`);
            allResults.sort((a, b) => {
                const aScore = getAdditivePriorityScore(a, symptomSeverity, fuelTypeForAdditive, usageScenario);
                const bScore = getAdditivePriorityScore(b, symptomSeverity, fuelTypeForAdditive, usageScenario);

                // Debug: 輸出前幾個產品的評分
                if (Math.random() < 0.1) { // 抽樣 log 避免洗版，或是只在前幾次 log
                    // console.log(`[Score] ${a.partno}: ${aScore}, ${b.partno}: ${bScore}`);
                }

                return bScore - aScore; // 降冪排序
            });

            // 輸出排序後的前 3 名產品名稱和分數，用於驗證
            console.log(`${LOG_TAGS.SEARCH} Top 3 additives after sort:`, allResults.slice(0, 3).map(p => ({
                sku: p.partno,
                title: p.title,
                score: getAdditivePriorityScore(p, symptomSeverity, fuelTypeForAdditive, usageScenario)
            })));
        }

        // 8. 最終 Fallback：如果完全沒有結果，返回對應類別的產品樣本
        if (allResults.length === 0 && products.length > 0) {
            console.log(`${LOG_TAGS.SEARCH} All strategies failed, returning sample products`);

            let sampleProducts = [];
            const vehicleType = searchInfo?.vehicleType;

            // 使用統一的類別對應表（從知識庫讀取 - RAG 架構）
            // 動態處理摩托車/汽車的差異
            let sortValue;
            const categoryToSort = getCategoryToSort();
            const categoryConfig = categoryToSort[productCategory];
            if (categoryConfig) {
                if (categoryConfig.default) {
                    sortValue = categoryConfig.default;
                } else {
                    sortValue = vehicleType === '摩托車' ? categoryConfig.motorcycle : categoryConfig.car;
                }
            }

            if (sortValue) {
                sampleProducts = products.filter(p =>
                    p.sort && p.sort.includes(sortValue.replace('【', '').replace('】', ''))
                ).slice(0, SEARCH_LIMITS.default);
                console.log(`${LOG_TAGS.SEARCH} Fallback by sort "${sortValue}": found ${sampleProducts.length} products`);
            }

            // 如果使用 sort 沒找到，嘗試使用標題關鍵字搜尋
            if (sampleProducts.length === 0) {
                const categoryKeywords = {
                    '變速箱油': ['atf', 'gear', '變速箱', 'transmission', 'dexron', 'cvt', 'dsg', 'top tec atf', 'top tec 1'],
                    '煞車系統': ['brake', 'dot', '煞車', 'dot 4', 'dot 5'],
                    '冷卻系統': ['coolant', 'antifreeze', '冷卻', '水箱', '防凍'],
                    '空調系統': ['空調', 'pag', '冷媒', 'air conditioning'],
                    '美容': ['wash', 'wax', '洗車', '美容', '鍍膜', 'clean', 'polish'],
                    '香氛': ['香氛', '芳香', 'fragrance'],
                    '自行車': ['bike', 'bicycle', '自行車', 'chain'],
                    '船舶': ['marine', 'outboard', '船']
                };

                const keywords = categoryKeywords[productCategory] || [];
                if (keywords.length > 0) {
                    sampleProducts = products.filter(p => {
                        const title = (p.title || '').toLowerCase();
                        const sort = (p.sort || '').toLowerCase();
                        return keywords.some(kw => title.includes(kw) || sort.includes(kw));
                    }).slice(0, SEARCH_LIMITS.default);
                    console.log(`${LOG_TAGS.SEARCH} Fallback by keywords: found ${sampleProducts.length} products`);
                }
            }

            // 如果還是沒有，返回前 20 個產品
            if (sampleProducts.length === 0) {
                sampleProducts = products.slice(0, SEARCH_LIMITS.default);
            }

            for (const p of sampleProducts) {
                if (p.id && !seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    allResults.push(p);
                }
            }
            console.log(`${LOG_TAGS.SEARCH} Final fallback: ${allResults.length} products`);
        }

        // 9. 一般格式化輸出（限制 15 個產品，節省 Token）
        if (allResults.length > 0) {
            return formatProducts(allResults.slice(0, 15), searchInfo);
        }

        return '目前沒有匹配的產品資料';

    } catch (error) {
        console.error('[Search] Global error:', error);
        return '搜尋產品時發生錯誤';
    }
}

// 注意：getSyntheticScore 已從 motorcycle-rules.js 匯入

// ============================================
// 判斷添加劑優先級（用於症狀嚴重度和使用場景排序）
// ============================================
// ============================================
// 判斷添加劑優先級（用於症狀嚴重度和使用場景排序）
// ============================================
function getAdditivePriorityScore(product, symptomSeverity, fuelType, usageScenario) {
    if (!product) return 0;
    const title = product.title || '';
    const partno = product.partno || '';
    const titleLower = title.toLowerCase();
    let score = 1;

    // 柴油車 + Diesel 產品 = 加分
    if (fuelType === '柴油' && titleLower.includes('diesel')) {
        score += 2;
    }

    // 嚴重症狀 + Pro-Line 產品 = 加分
    if (symptomSeverity === 'severe') {
        if (titleLower.includes('pro-line') || titleLower.includes('proline')) {
            score += 3;  // Pro-Line 最高優先
        } else {
            score += 1;  // 其他產品稍微加分
        }
    }

    // 中度症狀
    if (symptomSeverity === 'moderate') {
        if (titleLower.includes('pro-line') || titleLower.includes('proline')) {
            score += 2;
        }
    }

    // 使用場景排序（跑山/激烈操駕 → 性能提升類優先）
    if (usageScenario === '跑山' || usageScenario === '下賽道') {
        // LM7820 Speed Shooter 性能提升 (檢查標題或料號)
        if (titleLower.includes('speed') || titleLower.includes('7820') || partno.includes('7820')) {
            score += 3;  // 跑山場景最優先 (LM7820)
        }
        // 性能相關產品
        if (titleLower.includes('race') || titleLower.includes('boost') || titleLower.includes('octane')) {
            score += 2;
        }
    }

    // 長途旅行 → 清潔保養類優先
    if (usageScenario === '長途旅行') {
        if (titleLower.includes('shooter') || titleLower.includes('clean') || titleLower.includes('7822') || partno.includes('7822')) {
            score += 2;  // 清潔類優先 (LM7822)
        }
        if (titleLower.includes('stabilizer') || titleLower.includes('21600') || partno.includes('21600')) {
            score += 1.5;  // 穩定劑也適合長途
        }
    }

    // Engine Flush 清積碳產品
    if (titleLower.includes('flush') || titleLower.includes('clean')) {
        score += 0.5;
    }

    return score;
}

// ============================================
// 格式化產品資料（完整版）
// ============================================
function formatProducts(products, searchInfo = null) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    // === 同產品不同容量去重：優先顯示 1L ===
    // 根據產品標題（去除容量部分）分組，每組只保留最優先的容量
    const deduplicatedProducts = deduplicateBySize(products, searchInfo?.preferLargePack);

    const productCategory = searchInfo?.productCategory || '產品';
    const isAdditive = productCategory === '添加劑';
    const additiveMatch = searchInfo?.additiveGuideMatch;

    // 強烈警告，防止 AI 編造
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**
`;

    // 認證搜尋通知（升級認證說明）
    const certNotice = searchInfo?.certNotice;
    const isUpgrade = searchInfo?.isUpgrade;
    const requestedCert = searchInfo?.requestedCert;
    const usedCert = searchInfo?.usedCert;

    if (certNotice) {
        context += `
## 📋 認證搜尋結果

**用戶詢問:** ${requestedCert} 認證
**實際結果:** ${usedCert || '無'} ${isUpgrade ? '(升級認證，向後兼容)' : '(精確匹配)'}

> ⚠️ ${certNotice}

**回覆要求:**
1. 向用戶說明目前無 ${requestedCert} 認證產品
2. 解釋 ${usedCert} 是更新一代的認證，向後兼容 ${requestedCert}
3. 推薦以下產品

`;
    }

    // 黏度降級通知（認證優先搜尋結果）
    const fallbackNotice = searchInfo?.fallbackNotice;
    const fallbackType = searchInfo?.fallbackType;
    const requestedViscosity = searchInfo?.requestedViscosity;

    if (fallbackNotice && fallbackType === 'viscosity') {
        context += `
## ⚠️ 搜尋說明（黏度降級）

${fallbackNotice}

**用戶需求黏度:** ${requestedViscosity || '未指定'}
**實際搜尋結果:** 符合 ${usedCert || searchInfo?.vehicles?.[0]?.certifications?.[0] || '認證'} 認證的產品（黏度可能不同）

**回覆要求:**
1. 向用戶說明目前沒有 ${requestedViscosity} 黏度且符合認證的產品
2. 解釋以下產品符合原廠認證要求，黏度略有不同
3. 建議用戶確認車主手冊是否允許替代黏度

`;
    }

    // API 認證升級通知（日韓系車推薦最新認證）
    const certUpgradeInfo = searchInfo?.certUpgradeInfo;
    const certStrategy = searchInfo?.certStrategy;

    if (certUpgradeInfo && certStrategy === 'api_newest') {
        context += `
## 🌟 認證升級推薦

**用戶詢問認證:** ${certUpgradeInfo.originalCert}
**推薦產品認證:** ${certUpgradeInfo.upgradedCert}

> ✅ ${certUpgradeInfo.explanation}

**說明：** API/ILSAC 認證是向後兼容的，新版本認證的機油完全適用於舊版本認證的車輛。例如：API SP 機油可以用於要求 API SN 的車輛，而且性能更好。

**回覆要求:**
1. 告知用戶推薦的是更新版認證 (${certUpgradeInfo.upgradedCert}) 的產品
2. 解釋新版認證向後兼容，性能更優
3. 推薦以下產品

`;
    }

    // 加入產品類別提示和推薦依據
    if (isAdditive) {
        context += `
## 🚨 本次詢問是「添加劑」推薦，不是機油！
`;
        // 如果有匹配到的症狀，顯示說明
        if (additiveMatch && additiveMatch.items && additiveMatch.items.length > 0) {
            context += `
### 📋 症狀分析與推薦依據
用戶描述的問題匹配到以下症狀，請根據說明向用戶解釋推薦原因：

`;
            for (const item of additiveMatch.items) {
                context += `**症狀：${item.problem}**
🔍 原因說明：${item.explanation}
💊 推薦產品：${item.solutions.join(', ')}

`;
            }
            context += `**回覆要求：**
1. 先說明可能的原因（參考上述「原因說明」）
2. 再推薦對應的產品
3. 解釋產品如何解決這個問題

`;
        } else {
            context += `**用戶詢問的是症狀問題，請推薦添加劑產品！**

`;
        }
    } else if (productCategory === '機油') {
        context += `
### 📋 機油推薦依據
**回覆要求：**
1. 說明推薦的黏度依據
2. 說明認證依據
3. 列出推薦產品

⚠️ **認證準確性要求**：
- 回覆時必須使用產品「認證/規格」欄位中顯示的**確切內容**
- 例如：產品顯示 "API SQ, ILSAC GF-7A" 則說 "API SQ, ILSAC GF-7A"
- **禁止**用其他認證名稱替代（如把 SQ 說成 SP）

`;
    } else if (productCategory === '變速箱油') {
        context += `
### 📋 變速箱油推薦依據
**回覆要求：**
1. 說明車型對應的變速箱類型（自排/手排/CVT/DSG 等）
2. 說明適用的規格或認證（如 Dexron VI、ATF+4 等）
3. 列出推薦產品

`;
    } else if (productCategory === '煞車系統' || productCategory === '冷卻系統') {
        context += `
### 📋 ${productCategory}產品推薦
**回覆要求：**
1. 確認車型資訊（如有繼承）
2. 推薦適合的產品

`;
    } else if (productCategory === '美容' || productCategory === '香氛' || productCategory === '自行車') {
        context += `
### 📋 ${productCategory}產品直接推薦
**🛒 購買方式：**
此類產品可直接在 **CarMall 車魔商城** 購買：https://www.carmall.com.tw/
宜福工業官方直營，品質有保障！

**回覆要求：**
1. 直接推薦適合的產品
2. 提供產品連結
3. 補充說明可在 CarMall 車魔商城購買

`;
    } else {
        context += `
### 📋 ${productCategory}產品推薦

`;
    }

    context += `---

## 可用${productCategory}資料庫

`;

    deduplicatedProducts.forEach((p, i) => {
        const pid = p.partno || p.partNo || p.Partno || p.PartNo || p.sku || p.SKU;
        let url = p.productPageUrl || 'https://www.liqui-moly-tw.com/products/';

        if (pid) {
            url = `${PRODUCT_BASE_URL}${pid.toLowerCase()}`;
        } else if (p.title) {
            const match = p.title.match(/(?:LM|lm)?[- ]?(\d{4,5})/);
            if (match) {
                url = `${PRODUCT_BASE_URL}lm${match[1]}`;
            }
        }

        // 輔助函式：精簡認證列表（解決認證過長問題）
        function truncateCert(certStr) {
            if (!certStr || certStr === 'N/A') return 'N/A';

            // 分割認證（支援逗號或分號分隔）
            const certs = certStr.split(/[,;]/).map(c => c.trim()).filter(c => c);

            // 如果認證少於 5 個，全部顯示
            if (certs.length <= 5) return certStr;

            // 優先保留車廠認證和 API/ACEA 規範
            // 簡單啟發式：保留前 3 個和包含 API/ACEA 的項目
            const priorityCerts = [];
            const otherCerts = [];

            certs.forEach(c => {
                if (/API|ACEA|JASO|ILSAC/i.test(c)) {
                    priorityCerts.push(c);
                } else {
                    otherCerts.push(c);
                }
            });

            // 組合結果：優先顯示通用規範，再補上幾個重要車廠認證
            // 最多顯示 5 個
            const finalCerts = [...priorityCerts, ...otherCerts].slice(0, 5);

            return finalCerts.join(', ') + (certs.length > 5 ? ' ... (等)' : '');
        }

        context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量/尺寸: ${p.size || 'N/A'}
- 系列/次分類: ${p.word1 || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證/規格: ${truncateCert(p.cert)}
- 分類: ${p.sort || 'N/A'}
- 分類: ${p.sort || 'N/A'}
- 建議售價: ${p.price || '請洽店家詢價'}
- 產品連結: ${url}
- 產品說明: ${p.content || 'N/A'}

`;
    });

    return context;
}

// ============================================
// 格式化多車型產品資料
// ============================================
function formatMultiVehicleProducts(motorcycleProducts, carProducts) {
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

---

## 🏍️ 摩托車機油（標題含 Motorbike）

**以下產品專用於摩托車/重機/速克達，請推薦給摩托車用戶：**

`;

    if (motorcycleProducts.length > 0) {
        motorcycleProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.sku;
            const url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量: ${p.size || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證: ${p.cert || 'N/A'}
- 產品連結: ${url}

`;
        });
    } else {
        context += `（無符合的摩托車機油產品）

`;
    }

    context += `---

## 🚗 汽車機油（不含 Motorbike）

**以下產品專用於汽車，請推薦給汽車用戶：**

`;

    if (carProducts.length > 0) {
        carProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.sku;
            const url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量: ${p.size || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證: ${p.cert || 'N/A'}
- 產品連結: ${url}

`;
        });
    } else {
        context += `（無符合的汽車機油產品）

`;
    }

    context += `---

## ⚠️ 多車型推薦規則
- **摩托車/重機/速克達**：只能推薦上方「🏍️ 摩托車機油」區塊的產品
- **汽車**：只能推薦上方「🚗 汽車機油」區塊的產品
- 禁止混用！汽車不可推薦 Motorbike 產品，摩托車不可推薦汽車機油
`;

    return context;
}

// 注意：getScooterCertScore 已從 certification-matcher.js 匯入

// ============================================
// 同產品不同容量去重（預設優先顯示 1L）
// 產品標題 (title) 相同代表同一產品，容量由 size 欄位區分
// ============================================
function deduplicateBySize(products, preferLargePack = false) {
    if (!products || products.length === 0) return products;

    // 根據產品標題 (title) 進行分組
    // 同標題的產品代表同一產品的不同容量版本
    const groups = new Map();

    for (const product of products) {
        const title = product.title || '';

        if (!groups.has(title)) {
            groups.set(title, []);
        }
        groups.get(title).push(product);
    }

    // 每組只保留最優先的容量
    const result = [];
    for (const [title, group] of groups) {
        if (group.length === 1) {
            result.push(group[0]);
        } else {
            // 依容量評分排序，取最高分的
            group.sort((a, b) => {
                const scoreA = getSizeScore(a.title, a.size, preferLargePack);
                const scoreB = getSizeScore(b.title, b.size, preferLargePack);
                return scoreB - scoreA; // 高分優先
            });
            result.push(group[0]);
            // Log 去重資訊
            console.log(`${LOG_TAGS.SEARCH} Dedupe: "${title}" - kept ${group[0].size || '1L'} (${group[0].partno}), removed ${group.length - 1} variants`);
        }
    }

    return result;
}

// ============================================
// 容量評分 (預設 1L > 大包裝)
// ============================================
function getSizeScore(title, size, preferLarge) {
    const text = ((title || '') + ' ' + (size || '')).toLowerCase();

    // 識別大包裝關鍵字
    const isLarge = text.includes('4l') || text.includes('5l') || text.includes('20l') || text.includes('60l') || text.includes('205l');

    if (preferLarge) {
        // 用戶想找大包裝：大包裝(10分) > 小包裝(1分)
        return isLarge ? 10 : 1;
    } else {
        // 預設情況：小包裝/1L(10分) > 大包裝(1分)
        // 假設未標示大包裝即為標準包裝(通常1L)
        return isLarge ? 1 : 10;
    }
}

// ============================================
// 匯出函式供直接呼叫（P0 優化：避免 HTTP 開銷）
// ============================================
module.exports.searchProducts = searchProducts;
module.exports.getProducts = getProducts;
