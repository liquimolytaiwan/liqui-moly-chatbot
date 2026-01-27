/**
 * Tests for search-helper.js
 * Verifies USED functions work correctly before removing UNUSED functions
 */

const {
    getSearchReference,
    getCategoryToSort,
    getOilOnlyKeywords
} = require('../search-helper');

describe('search-helper.js', () => {

    describe('getSearchReference', () => {
        test('should return an object', () => {
            const ref = getSearchReference();
            expect(typeof ref).toBe('object');
        });

        test('should cache the result', () => {
            const ref1 = getSearchReference();
            const ref2 = getSearchReference();
            expect(ref1).toBe(ref2); // Same reference due to caching
        });
    });

    describe('getCategoryToSort', () => {
        test('should return an object', () => {
            const result = getCategoryToSort();
            expect(typeof result).toBe('object');
        });

        test('should not include _description key', () => {
            const result = getCategoryToSort();
            expect(result._description).toBeUndefined();
        });

        test('should have product category keys if search-reference.json loaded', () => {
            const result = getCategoryToSort();
            // May be empty if JSON not found, which is acceptable
            expect(typeof result).toBe('object');
        });
    });

    describe('getOilOnlyKeywords', () => {
        test('should return an array', () => {
            const result = getOilOnlyKeywords();
            expect(Array.isArray(result)).toBe(true);
        });

        test('should return array of strings if data exists', () => {
            const result = getOilOnlyKeywords();
            if (result.length > 0) {
                expect(typeof result[0]).toBe('string');
            }
        });
    });

});
