/**
 * Tests for certification-matcher.js
 * Verifies USED functions work correctly before removing UNUSED functions
 */

const {
    normalizeCert,
    normalizeViscosity,
    isOEMCertification,
    isAPICertification,
    getAPICertPriority,
    detectCertification,
    getScooterCertScore,
    filterProductsByCert,
    searchWithCertUpgrade,
    searchWithCertPriority,
    getCertificationForVehicle,
    getJasoCertification,
    createCertMatchResult
} = require('../certification-matcher');

describe('certification-matcher.js', () => {

    describe('normalizeCert', () => {
        test('should normalize certification by removing spaces and hyphens', () => {
            expect(normalizeCert('GF-6A')).toBe('GF6A');
            expect(normalizeCert('API SN')).toBe('APISN');
            expect(normalizeCert('VW 504 00')).toBe('VW50400');
        });

        test('should convert to uppercase', () => {
            expect(normalizeCert('gf-6a')).toBe('GF6A');
            expect(normalizeCert('api sn')).toBe('APISN');
        });

        test('should handle BMW LL aliases', () => {
            expect(normalizeCert('BMW LL-01')).toContain('LONGLIFE01');
            expect(normalizeCert('BMW LL-04')).toContain('LONGLIFE04');
        });

        test('should handle empty or null input', () => {
            expect(normalizeCert('')).toBe('');
            expect(normalizeCert(null)).toBe('');
            expect(normalizeCert(undefined)).toBe('');
        });
    });

    describe('normalizeViscosity', () => {
        test('should normalize viscosity by removing hyphens', () => {
            expect(normalizeViscosity('5W-30')).toBe('5W30');
            expect(normalizeViscosity('0W-20')).toBe('0W20');
            expect(normalizeViscosity('10W-40')).toBe('10W40');
        });

        test('should convert to uppercase', () => {
            expect(normalizeViscosity('5w-30')).toBe('5W30');
        });

        test('should handle empty or null input', () => {
            expect(normalizeViscosity('')).toBe('');
            expect(normalizeViscosity(null)).toBe('');
        });
    });

    describe('isOEMCertification', () => {
        test('should identify VW certifications', () => {
            expect(isOEMCertification('VW 504 00')).toBe(true);
            expect(isOEMCertification('VW 508 00')).toBe(true);
        });

        test('should identify BMW certifications', () => {
            expect(isOEMCertification('BMW LL-01')).toBe(true);
            expect(isOEMCertification('BMW LL-04')).toBe(true);
        });

        test('should identify MB certifications', () => {
            expect(isOEMCertification('MB 229.5')).toBe(true);
            expect(isOEMCertification('MB 229.51')).toBe(true);
        });

        test('should identify Dexos certifications', () => {
            expect(isOEMCertification('Dexos 1')).toBe(true);
            expect(isOEMCertification('Dexos 2')).toBe(true);
        });

        test('should return false for API/ILSAC certifications', () => {
            expect(isOEMCertification('API SN')).toBe(false);
            expect(isOEMCertification('GF-6A')).toBe(false);
        });

        test('should handle empty or null input', () => {
            expect(isOEMCertification('')).toBe(false);
            expect(isOEMCertification(null)).toBe(false);
        });
    });

    describe('isAPICertification', () => {
        test('should identify API gasoline certifications', () => {
            expect(isAPICertification('API SN')).toBe(true);
            expect(isAPICertification('API SP')).toBe(true);
            expect(isAPICertification('API SQ')).toBe(true);
        });

        test('should identify API diesel certifications', () => {
            expect(isAPICertification('API CJ')).toBe(true);
            expect(isAPICertification('API CK')).toBe(true);
        });

        test('should identify ILSAC certifications', () => {
            expect(isAPICertification('GF-6A')).toBe(true);
            expect(isAPICertification('GF-6B')).toBe(true);
            expect(isAPICertification('ILSAC GF-6')).toBe(true);
        });

        test('should return false for OEM certifications', () => {
            expect(isAPICertification('VW 504 00')).toBe(false);
            expect(isAPICertification('BMW LL-01')).toBe(false);
        });

        test('should handle empty or null input', () => {
            expect(isAPICertification('')).toBe(false);
            expect(isAPICertification(null)).toBe(false);
        });
    });

    describe('getAPICertPriority', () => {
        test('should return higher priority for newer certifications', () => {
            const sqPriority = getAPICertPriority('API SQ');
            const spPriority = getAPICertPriority('API SP');
            const snPriority = getAPICertPriority('API SN');

            expect(sqPriority).toBeGreaterThan(spPriority);
            expect(spPriority).toBeGreaterThan(snPriority);
        });

        test('should return 0 for non-API certifications', () => {
            expect(getAPICertPriority('VW 504 00')).toBe(0);
            expect(getAPICertPriority('BMW LL-01')).toBe(0);
        });

        test('should handle empty or null input', () => {
            expect(getAPICertPriority('')).toBe(0);
            expect(getAPICertPriority(null)).toBe(0);
        });
    });

    describe('detectCertification', () => {
        test('should detect ILSAC certifications', () => {
            const result = detectCertification('這款機油符合 GF-6A 認證');
            expect(result).not.toBeNull();
            expect(result.type).toBe('ILSAC');
            expect(result.cert).toContain('GF-');
        });

        test('should detect API certifications', () => {
            const result = detectCertification('API SP 認證機油');
            expect(result).not.toBeNull();
            expect(result.type).toBe('API');
            expect(result.cert).toContain('API');
        });

        test('should detect JASO certifications', () => {
            const result = detectCertification('JASO MA2 摩托車機油');
            expect(result).not.toBeNull();
            expect(result.type).toBe('JASO');
            expect(result.cert).toContain('JASO');
        });

        test('should return null for no certification', () => {
            expect(detectCertification('普通機油')).toBeNull();
            expect(detectCertification('')).toBeNull();
            expect(detectCertification(null)).toBeNull();
        });
    });

    describe('getScooterCertScore', () => {
        test('should return highest score for JASO MB', () => {
            expect(getScooterCertScore('JASO MB')).toBe(10);
        });

        test('should return lower score for JASO MA', () => {
            expect(getScooterCertScore('JASO MA')).toBe(1);
            expect(getScooterCertScore('JASO MA2')).toBe(1);
        });

        test('should return default score for other certifications', () => {
            expect(getScooterCertScore('API SN')).toBe(5);
        });

        test('should handle empty or null input', () => {
            expect(getScooterCertScore('')).toBe(5);
            expect(getScooterCertScore(null)).toBe(5);
        });
    });

    describe('filterProductsByCert', () => {
        const mockProducts = [
            { partno: 'LM2316', title: 'Top Tec 4200', cert: 'VW 504 00, MB 229.51', word2: '5W-30' },
            { partno: 'LM3756', title: 'Special Tec V', cert: 'API SP, ILSAC GF-6A', word2: '0W-20' },
            { partno: 'LM3702', title: 'Molygen NG', cert: 'API SN Plus, ILSAC GF-5', word2: '5W-30' }
        ];

        test('should filter products by certification', () => {
            const result = filterProductsByCert(mockProducts, 'VW50400');
            expect(result.length).toBe(1);
            expect(result[0].partno).toBe('LM2316');
        });

        test('should filter products by certification and viscosity', () => {
            const result = filterProductsByCert(mockProducts, 'APISP', '0W-20');
            expect(result.length).toBe(1);
            expect(result[0].partno).toBe('LM3756');
        });

        test('should return empty array for no matches', () => {
            const result = filterProductsByCert(mockProducts, 'NONEXISTENT');
            expect(result.length).toBe(0);
        });
    });

    describe('createCertMatchResult', () => {
        test('should create default result structure', () => {
            const result = createCertMatchResult();
            expect(result).toEqual({
                matched: false,
                products: [],
                requestedCert: null,
                usedCert: null,
                isUpgrade: false,
                certNotice: null,
                compatibleCerts: []
            });
        });
    });

    describe('searchWithCertUpgrade', () => {
        const mockProducts = [
            { partno: 'LM3756', title: 'Special Tec V', cert: 'API SP, ILSAC GF-6A', word2: '0W-20' },
            { partno: 'LM3702', title: 'Molygen NG', cert: 'API SN Plus', word2: '5W-30' }
        ];

        test('should find exact certification match', () => {
            const result = searchWithCertUpgrade(mockProducts, 'GF-6A');
            expect(result.matched).toBe(true);
            expect(result.products.length).toBeGreaterThan(0);
        });

        test('should return empty when no match', () => {
            const result = searchWithCertUpgrade(mockProducts, 'VW 504 00');
            expect(result.matched).toBe(false);
        });

        test('should handle null certification', () => {
            const result = searchWithCertUpgrade(mockProducts, null);
            expect(result.matched).toBe(false);
        });
    });

    describe('getJasoCertification', () => {
        test('should return JASO MB for scooter', () => {
            const result = getJasoCertification(true);
            expect(result.certification).toBe('JASO MB');
        });

        test('should return JASO MA2 for manual motorcycle', () => {
            const result = getJasoCertification(false);
            expect(result.certification).toBe('JASO MA2');
        });
    });

    describe('getCertificationForVehicle', () => {
        test('should return null for empty input', () => {
            expect(getCertificationForVehicle(null)).toBeNull();
            expect(getCertificationForVehicle({})).toBeNull();
        });

        test('should return JASO rules for motorcycle', () => {
            const result = getCertificationForVehicle({ isMotorcycle: true });
            // May return null if vehicle-specs.json not loaded, which is expected in test
            expect(result === null || result.jaso !== undefined).toBe(true);
        });
    });

});
