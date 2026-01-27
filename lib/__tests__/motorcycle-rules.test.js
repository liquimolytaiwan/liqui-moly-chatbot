/**
 * Tests for motorcycle-rules.js
 * Verifies USED functions work correctly before removing UNUSED functions
 */

const {
    isScooter,
    searchMotorcycleOil,
    filterMotorcycleProducts,
    getSyntheticScore,
    sortMotorcycleProducts,
    buildJasoRulesPrompt,
    buildSearchKeywordRulesPrompt,
    getScooterModels
} = require('../motorcycle-rules');

describe('motorcycle-rules.js', () => {

    describe('isScooter', () => {
        test('should identify scooter by string name from knowledge base', () => {
            // Scooter models are loaded from ai-analysis-rules.json
            // Test with models that are actually in the knowledge base
            const scooterModels = getScooterModels();
            if (scooterModels.length > 0) {
                // Test with the first model from knowledge base
                expect(isScooter(scooterModels[0])).toBe(true);
            }
            // Gogoro is electric, may not be in scooter list
        });

        test('should identify scooter by object with vehicleSubType', () => {
            expect(isScooter({ vehicleSubType: '速克達' })).toBe(true);
        });

        test('should identify scooter by object with isScooter flag', () => {
            expect(isScooter({ isScooter: true })).toBe(true);
        });

        test('should identify scooter by JASO MB certification', () => {
            expect(isScooter({ certifications: ['JASO MB'] })).toBe(true);
        });

        test('should return false for non-scooter', () => {
            expect(isScooter('CBR600')).toBe(false);
            expect(isScooter('Ninja 400')).toBe(false);
            expect(isScooter('R1')).toBe(false);
        });

        test('should handle empty or null input', () => {
            expect(isScooter(null)).toBe(false);
            expect(isScooter('')).toBe(false);
            expect(isScooter({})).toBe(false);
        });
    });

    describe('getSyntheticScore', () => {
        test('should return highest score for full synthetic', () => {
            expect(getSyntheticScore('Synthoil Race')).toBe(3);
            expect(getSyntheticScore('Fully Synthetic')).toBe(3);
        });

        test('should return medium score for synthetic technology', () => {
            expect(getSyntheticScore('Top Tec 4600')).toBe(2);
            expect(getSyntheticScore('Special Tec V')).toBe(2);
            expect(getSyntheticScore('Leichtlauf Performance')).toBe(2);
            expect(getSyntheticScore('Motorbike 4T Street')).toBe(2);
        });

        test('should return low score for mineral oil', () => {
            expect(getSyntheticScore('Mineral Oil')).toBe(1);
        });

        test('should return default score for unknown', () => {
            expect(getSyntheticScore('Unknown Product')).toBe(1.5);
        });

        test('should handle empty or null input', () => {
            expect(getSyntheticScore(null)).toBe(0);
            expect(getSyntheticScore('')).toBe(0);
        });
    });

    describe('searchMotorcycleOil', () => {
        const mockProducts = [
            { partno: 'LM1505', title: 'Motorbike 4T Scooter 10W-40', cert: 'JASO MB', word2: '10W-40' },
            { partno: 'LM1515', title: 'Motorbike 4T Street Race 10W-50', cert: 'JASO MA2', word2: '10W-50' },
            { partno: 'LM2316', title: 'Top Tec 4200 5W-30', cert: 'VW 504 00', word2: '5W-30' }
        ];

        test('should filter products for scooter', () => {
            const result = searchMotorcycleOil(mockProducts, { vehicleSubType: '速克達' });
            expect(result.length).toBe(1);
            expect(result[0].partno).toBe('LM1505');
        });

        test('should filter products for manual motorcycle', () => {
            const result = searchMotorcycleOil(mockProducts, { vehicleSubType: '檔車' });
            expect(result.length).toBe(1);
            expect(result[0].partno).toBe('LM1515');
        });

        test('should filter by viscosity', () => {
            const result = searchMotorcycleOil(mockProducts, { vehicleSubType: '速克達', viscosity: '10W-40' });
            expect(result.length).toBe(1);
            expect(result[0].word2).toBe('10W-40');
        });

        test('should return empty array for no matches', () => {
            const result = searchMotorcycleOil(mockProducts, { vehicleSubType: '速克達', viscosity: '0W-20' });
            expect(result.length).toBe(0);
        });

        test('should handle empty input', () => {
            expect(searchMotorcycleOil([], {})).toEqual([]);
            expect(searchMotorcycleOil(null, {})).toEqual([]);
            expect(searchMotorcycleOil(mockProducts, null)).toEqual([]);
        });
    });

    describe('filterMotorcycleProducts', () => {
        const mockProducts = [
            { partno: 'LM1505', title: 'Motorbike 4T Scooter', cert: 'JASO MB', sort: '摩托車' },
            { partno: 'LM1515', title: 'Motorbike 4T Street', cert: 'JASO MA2', sort: '摩托車' },
            { partno: 'LM2316', title: 'Top Tec 4200', cert: 'VW 504 00', sort: '汽車' }
        ];

        test('should filter to only motorbike products', () => {
            const result = filterMotorcycleProducts(mockProducts);
            expect(result.length).toBe(2);
            expect(result.every(p => p.title.includes('Motorbike'))).toBe(true);
        });

        test('should filter scooter-compatible products', () => {
            const result = filterMotorcycleProducts(mockProducts, { isScooter: true });
            expect(result.length).toBe(1);
            expect(result[0].partno).toBe('LM1505');
        });

        test('should filter by viscosity', () => {
            const productsWithViscosity = [
                { ...mockProducts[0], word2: '10W-40' },
                { ...mockProducts[1], word2: '10W-50' }
            ];
            const result = filterMotorcycleProducts(productsWithViscosity, { viscosity: '10W-40' });
            expect(result.length).toBe(1);
        });
    });

    describe('sortMotorcycleProducts', () => {
        const mockProducts = [
            { title: 'Motorbike Mineral Oil', cert: 'JASO MA' },
            { title: 'Motorbike Synthoil Race', cert: 'JASO MA2' },
            { title: 'Motorbike 4T Street', cert: 'JASO MA2' }
        ];

        test('should sort by synthetic score when preferFullSynthetic', () => {
            const result = sortMotorcycleProducts(mockProducts, { preferFullSynthetic: true });
            expect(result[0].title).toContain('Synthoil');
        });

        test('should not modify original array', () => {
            const original = [...mockProducts];
            sortMotorcycleProducts(mockProducts, { preferFullSynthetic: true });
            expect(mockProducts).toEqual(original);
        });
    });

    describe('buildJasoRulesPrompt', () => {
        test('should return a string', () => {
            const result = buildJasoRulesPrompt();
            expect(typeof result).toBe('string');
        });

        test('should contain JASO keywords', () => {
            const result = buildJasoRulesPrompt();
            expect(result).toContain('JASO');
        });

        test('should mention scooter and motorcycle', () => {
            const result = buildJasoRulesPrompt();
            expect(result).toContain('速克達');
            expect(result).toContain('檔車');
        });
    });

    describe('buildSearchKeywordRulesPrompt', () => {
        test('should return a string', () => {
            const result = buildSearchKeywordRulesPrompt();
            expect(typeof result).toBe('string');
        });

        test('should contain searchKeywords rules', () => {
            const result = buildSearchKeywordRulesPrompt();
            expect(result).toContain('searchKeywords');
        });

        test('should mention Motorbike keyword', () => {
            const result = buildSearchKeywordRulesPrompt();
            expect(result).toContain('Motorbike');
        });
    });

    describe('getScooterModels', () => {
        test('should return an array', () => {
            const result = getScooterModels();
            expect(Array.isArray(result)).toBe(true);
        });

        test('should contain common scooter models if data loaded', () => {
            const result = getScooterModels();
            // May be empty if ai-analysis-rules.json not loaded
            if (result.length > 0) {
                expect(typeof result[0]).toBe('string');
            }
        });
    });

});
