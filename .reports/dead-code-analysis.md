# Dead Code Analysis Report

**Project:** liqui-moly-chatbot
**Date:** 2026-01-27
**Analysis Method:** Manual cross-reference analysis (no package.json for npm tools)

---

## Summary

| Category | Count | Files Affected |
|----------|-------|----------------|
| Unused Exports | 12 | 3 |
| Duplicate Exports | 1 | 1 |
| Unused Utilities | 4 | 4 |
| **Total** | **17** | **4** |

---

## Findings by Severity

### SAFE - Unused Exports (Can Remove)

#### 1. `lib/certification-matcher.js`

| Export | Status | Reason |
|--------|--------|--------|
| `checkJasoCertification` | UNUSED | Function defined but never called from any file |
| `getCompatibleCerts` | UNUSED | Function defined but never called from any file |
| `isCertCompatible` | UNUSED | Function defined but never called from any file |

**Lines:** 568-660 (checkJasoCertification, getCompatibleCerts, isCertCompatible)

#### 2. `lib/search-helper.js`

| Export | Status | Reason |
|--------|--------|--------|
| `getCertificationCompatibility` | UNUSED | Function defined but never called externally |
| `getKeywordMapping` | UNUSED | Function defined but never called externally |
| `getProductSeries` | UNUSED | Function defined but never called externally |
| `getSymptomToSku` | UNUSED | Function defined but never called externally |

**Lines:** 61-115 (getCertificationCompatibility, getKeywordMapping, getProductSeries, getSymptomToSku)

#### 3. `lib/motorcycle-rules.js`

| Export | Status | Reason |
|--------|--------|--------|
| `isManualMotorcycle` | UNUSED | Function defined but never called from any file |
| `getJasoType` | UNUSED | Function defined but never called from any file |
| `getScooterBrands` | UNUSED | Function defined but never called externally |

**Lines:** 114-173 (isManualMotorcycle, getJasoType), 47-53 (getScooterBrands)

---

### CAUTION - Duplicate Exports

#### 4. `lib/motorcycle-rules.js`

| Export | Status | Reason |
|--------|--------|--------|
| `getScooterCertScore` | DUPLICATE | Re-exported from `certification-matcher.js`. Should import directly from source. |

**Line:** 458 (re-export), 18 (import from certification-matcher)

**Recommendation:** Remove re-export, update consumers to import from `certification-matcher.js` directly.

---

### LOW PRIORITY - Unused Utility Functions

These are cache-clearing utilities that may be used for debugging/maintenance:

| File | Export | Status |
|------|--------|--------|
| `lib/certification-matcher.js` | `clearCache` | Never called (line 800-804) |
| `lib/search-helper.js` | `clearCache` | Never called (line 120-123) |
| `lib/motorcycle-rules.js` | `clearCache` | Never called (line 437-440) |
| `lib/knowledge-cache.js` | `clearCache` | Potentially useful for maintenance |

**Recommendation:** Keep for now, but consider removing if never needed.

---

## Detailed Analysis

### File: `lib/certification-matcher.js`

**Total Exports:** 21
**Used Exports:** 17
**Unused Exports:** 3 + 1 utility

```
Exports Usage Map:
+ searchWithCertUpgrade        [USED by search.js]
+ searchWithViscosityFallback  [USED internally]
+ searchWithCertPriority       [USED by search.js]
+ getCertificationForVehicle   [USED by knowledge-retriever.js]
+ getJasoCertification         [USED by knowledge-retriever.js]
- checkJasoCertification       [UNUSED]
- getCompatibleCerts           [UNUSED]
- isCertCompatible             [UNUSED]
+ isOEMCertification           [USED internally]
+ isAPICertification           [USED by search.js]
+ getAPICertPriority           [USED internally]
+ detectCertification          [USED by analyze.js]
+ getScooterCertScore          [USED by search.js, motorcycle-rules.js]
+ normalizeCert                [USED internally]
+ normalizeViscosity           [USED internally]
+ filterProductsByCert         [USED internally]
+ createCertMatchResult        [USED internally]
- clearCache                   [UNUSED - utility]
```

### File: `lib/search-helper.js`

**Total Exports:** 8
**Used Exports:** 3
**Unused Exports:** 4 + 1 utility

```
Exports Usage Map:
+ getSearchReference           [USED internally only]
+ getCategoryToSort            [USED by search.js, analyze.js]
+ getOilOnlyKeywords           [USED by analyze.js]
- getCertificationCompatibility [UNUSED]
- getKeywordMapping            [UNUSED]
- getProductSeries             [UNUSED]
- getSymptomToSku              [UNUSED]
- clearCache                   [UNUSED - utility]
```

### File: `lib/motorcycle-rules.js`

**Total Exports:** 14
**Used Exports:** 10
**Unused Exports:** 3 + 1 utility + 1 duplicate

```
Exports Usage Map:
+ isScooter                    [USED by search.js, intent-classifier.js]
- isManualMotorcycle           [UNUSED]
- getJasoType                  [UNUSED]
+ searchMotorcycleOil          [USED by search.js]
+ filterMotorcycleProducts     [USED by search.js]
+ getSyntheticScore            [USED by search.js]
+ sortMotorcycleProducts       [USED by search.js]
~ getScooterCertScore          [DUPLICATE - re-exported from certification-matcher.js]
+ buildJasoRulesPrompt         [USED by analyze.js]
+ buildSearchKeywordRulesPrompt [USED by analyze.js]
+ getScooterModels             [USED internally]
- getScooterBrands             [UNUSED]
+ getManualMotorcycleBrands    [USED internally]
+ getManualMotorcycleSeries    [USED internally]
- clearCache                   [UNUSED - utility]
```

---

## Proposed Safe Deletions

### Phase 1: Remove Unused Functions (SAFE)

1. **lib/certification-matcher.js**
   - Remove `checkJasoCertification` function (lines 568-596)
   - Remove `getCompatibleCerts` function (lines 605-625)
   - Remove `isCertCompatible` function (lines 633-660)
   - Remove exports from module.exports

2. **lib/search-helper.js**
   - Remove `getCertificationCompatibility` function (lines 61-64)
   - Remove `getKeywordMapping` function (lines 69-81)
   - Remove `getProductSeries` function (lines 86-98)
   - Remove `getSymptomToSku` function (lines 103-115)
   - Remove exports from module.exports

3. **lib/motorcycle-rules.js**
   - Remove `isManualMotorcycle` function (lines 114-146)
   - Remove `getJasoType` function (lines 153-173)
   - Remove `getScooterBrands` function (lines 47-53)
   - Remove re-export of `getScooterCertScore` (line 458)
   - Remove exports from module.exports

### Phase 2: Remove Utility Functions (LOW PRIORITY)

Consider removing `clearCache` functions from:
- `lib/certification-matcher.js` (lines 800-804)
- `lib/search-helper.js` (lines 120-123)
- `lib/motorcycle-rules.js` (lines 437-440)

---

## Estimated Impact

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Lines of Code | ~3200 | ~3050 | ~150 lines |
| Exports | 43 | 30 | ~30% |
| File Complexity | High | Medium | Improved |

---

## Test Verification Required

Before each deletion, verify:
1. No runtime errors in API endpoints
2. Search functionality works correctly
3. Certification matching works correctly
4. Motorcycle rules work correctly

---

## Cleanup Status: COMPLETED

**Date Completed:** 2026-01-27

### Tests Created
- `lib/__tests__/certification-matcher.test.js` - 41 tests
- `lib/__tests__/search-helper.test.js` - 7 tests
- `lib/__tests__/motorcycle-rules.test.js` - 28 tests
- **Total: 76 tests passing**

### Code Removed

| File | Functions Removed | Lines Removed |
|------|-------------------|---------------|
| `certification-matcher.js` | `checkJasoCertification`, `getCompatibleCerts`, `isCertCompatible`, `clearCache` | ~100 lines |
| `search-helper.js` | `getCertificationCompatibility`, `getKeywordMapping`, `getProductSeries`, `getSymptomToSku`, `clearCache` | ~65 lines |
| `motorcycle-rules.js` | `isManualMotorcycle`, `getJasoType`, `getScooterBrands`, `clearCache`, re-export of `getScooterCertScore` | ~85 lines |
| **Total** | **14 functions** | **~250 lines** |

### Test Coverage Improvement

| File | Before | After | Change |
|------|--------|-------|--------|
| `certification-matcher.js` | 44.11% | 52.52% | +8.41% |
| `motorcycle-rules.js` | 69.67% | 87.80% | +18.13% |
| `search-helper.js` | 37.5% | 100% | +62.5% |

### Verification
- All 76 tests pass after dead code removal
- No runtime errors detected
- Core functionality preserved

---

## Notes

- Test framework (Jest) added via `package.json`
- Analysis was performed via manual cross-reference of all JavaScript files
- Only definitively unused code was removed
- Internal utility functions used only by tests are kept
