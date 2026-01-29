# P2P Multi-Currency Enhancement Specification

## Overview

This document specifies the multi-currency handling additions to the P2P Approval Workflow system. These enhancements ensure consistent approval routing regardless of transaction currency and proper variance handling in 3-way matching when exchange rates fluctuate.

---

## 1. New Transaction Body Fields

### 1.1 custbody_p2p_orig_currency

| Property | Value |
|----------|-------|
| Label | P2P Original Currency |
| Script ID | custbody_p2p_orig_currency |
| Type | List/Record (Currency) |
| Applies To | Purchase Order, Vendor Bill |
| Store Value | Yes |
| Display | Inline Text |
| Help Text | Transaction currency at time of submission. Used for audit trail and variance calculations. |

### 1.2 custbody_p2p_base_amount

| Property | Value |
|----------|-------|
| Label | P2P Base Amount |
| Script ID | custbody_p2p_base_amount |
| Type | Currency |
| Applies To | Purchase Order, Vendor Bill |
| Store Value | Yes |
| Display | Normal |
| Help Text | Transaction total converted to subsidiary base currency. Used for approval rule amount matching. |

### 1.3 custbody_p2p_exchange_rate

| Property | Value |
|----------|-------|
| Label | P2P Exchange Rate |
| Script ID | custbody_p2p_exchange_rate |
| Type | Decimal Number |
| Precision | 6 decimal places |
| Applies To | Purchase Order, Vendor Bill |
| Store Value | Yes |
| Display | Normal |
| Help Text | Exchange rate at submission time (orig currency → base currency). Captured for audit and variance analysis. |

---

## 2. New Matching Configuration Field

### 2.1 custrecord_p2p_match_fx_tolerance_pct

Add to `customrecord_p2p_matching_config`:

| Property | Value |
|----------|-------|
| Label | FX Variance Tolerance % |
| Script ID | custrecord_p2p_match_fx_tolerance_pct |
| Type | Percent |
| Default | 3.00% |
| Help Text | Allowed variance percentage due to exchange rate fluctuation between PO and VB. Set to 0 for no FX tolerance. |

---

## 3. Currency Utilities Module

### File: p2p_currency_utils.js

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Multi-currency utilities for P2P Approval Workflow
 */
define(['N/currency', 'N/record', 'N/search', 'N/runtime', './p2p_constants'],
function(currency, record, search, runtime, constants) {
    
    /**
     * Get the base currency for a subsidiary
     * @param {number} subsidiaryId - Internal ID of subsidiary
     * @returns {number} Currency internal ID
     */
    function getBaseCurrency(subsidiaryId) {
        if (!subsidiaryId) {
            // Single-subsidiary account - get company preference
            var config = N.config.load({ type: N.config.Type.COMPANY_PREFERENCES });
            return config.getValue({ fieldId: 'basecurrency' });
        }
        
        var subLookup = search.lookupFields({
            type: search.Type.SUBSIDIARY,
            id: subsidiaryId,
            columns: ['currency']
        });
        
        return subLookup.currency ? subLookup.currency[0].value : null;
    }
    
    /**
     * Get current exchange rate between two currencies
     * @param {number} sourceCurrency - Source currency ID
     * @param {number} targetCurrency - Target currency ID
     * @param {Date} [effectiveDate] - Date for rate (default: today)
     * @returns {number} Exchange rate
     */
    function getExchangeRate(sourceCurrency, targetCurrency, effectiveDate) {
        if (sourceCurrency === targetCurrency) {
            return 1;
        }
        
        var rateDate = effectiveDate || new Date();
        
        return currency.exchangeRate({
            source: sourceCurrency,
            target: targetCurrency,
            effectiveDate: rateDate
        });
    }
    
    /**
     * Convert amount from one currency to another
     * @param {number} amount - Amount to convert
     * @param {number} sourceCurrency - Source currency ID
     * @param {number} targetCurrency - Target currency ID
     * @param {Date} [effectiveDate] - Date for rate
     * @returns {number} Converted amount
     */
    function convertAmount(amount, sourceCurrency, targetCurrency, effectiveDate) {
        if (!amount || sourceCurrency === targetCurrency) {
            return amount;
        }
        
        var rate = getExchangeRate(sourceCurrency, targetCurrency, effectiveDate);
        return Math.round(amount * rate * 100) / 100; // Round to 2 decimal places
    }
    
    /**
     * Capture currency snapshot on transaction submission
     * @param {Record} transaction - Transaction record
     * @returns {Object} Currency snapshot data
     */
    function captureCurrencySnapshot(transaction) {
        var tranCurrency = transaction.getValue({ fieldId: 'currency' });
        var subsidiary = transaction.getValue({ fieldId: 'subsidiary' });
        var tranTotal = transaction.getValue({ fieldId: 'total' });
        
        var baseCurrency = getBaseCurrency(subsidiary);
        var exchangeRate = 1;
        var baseAmount = tranTotal;
        
        if (tranCurrency && baseCurrency && tranCurrency !== baseCurrency) {
            exchangeRate = getExchangeRate(tranCurrency, baseCurrency);
            baseAmount = convertAmount(tranTotal, tranCurrency, baseCurrency);
        }
        
        // Set fields on transaction
        transaction.setValue({
            fieldId: constants.FIELD.ORIG_CURRENCY,
            value: tranCurrency
        });
        transaction.setValue({
            fieldId: constants.FIELD.EXCHANGE_RATE,
            value: exchangeRate
        });
        transaction.setValue({
            fieldId: constants.FIELD.BASE_AMOUNT,
            value: baseAmount
        });
        
        return {
            originalCurrency: tranCurrency,
            baseCurrency: baseCurrency,
            exchangeRate: exchangeRate,
            originalAmount: tranTotal,
            baseAmount: baseAmount
        };
    }
    
    /**
     * Calculate FX variance between two transactions
     * @param {Object} poData - PO currency data {currency, rate, amount}
     * @param {Object} vbData - VB currency data {currency, rate, amount}
     * @returns {Object} Variance analysis
     */
    function calculateFxVariance(poData, vbData) {
        // If same currency, no FX variance
        if (poData.currency === vbData.currency) {
            return {
                hasFxVariance: false,
                variancePct: 0,
                varianceAmt: 0,
                rateChange: 0
            };
        }
        
        // Calculate what VB amount would be at PO rate
        var vbAtPoRate = vbData.originalAmount * poData.rate;
        var vbAtVbRate = vbData.originalAmount * vbData.rate;
        
        var varianceAmt = Math.abs(vbAtVbRate - vbAtPoRate);
        var variancePct = (varianceAmt / vbAtPoRate) * 100;
        var rateChange = ((vbData.rate - poData.rate) / poData.rate) * 100;
        
        return {
            hasFxVariance: true,
            variancePct: Math.round(variancePct * 100) / 100,
            varianceAmt: Math.round(varianceAmt * 100) / 100,
            rateChange: Math.round(rateChange * 100) / 100,
            poRate: poData.rate,
            vbRate: vbData.rate
        };
    }
    
    /**
     * Check if FX variance is within tolerance
     * @param {number} variancePct - Calculated variance percentage
     * @param {number} tolerancePct - Configured tolerance percentage
     * @returns {boolean} True if within tolerance
     */
    function isWithinFxTolerance(variancePct, tolerancePct) {
        return Math.abs(variancePct) <= tolerancePct;
    }
    
    /**
     * Get base amount for rule matching
     * Always returns amount in subsidiary base currency
     * @param {Record} transaction - Transaction record
     * @returns {number} Base currency amount
     */
    function getAmountForRuleMatching(transaction) {
        // First check if base amount is already captured
        var baseAmount = transaction.getValue({ fieldId: constants.FIELD.BASE_AMOUNT });
        
        if (baseAmount) {
            return parseFloat(baseAmount);
        }
        
        // Calculate on the fly
        var tranCurrency = transaction.getValue({ fieldId: 'currency' });
        var subsidiary = transaction.getValue({ fieldId: 'subsidiary' });
        var tranTotal = parseFloat(transaction.getValue({ fieldId: 'total' })) || 0;
        
        var baseCurrency = getBaseCurrency(subsidiary);
        
        if (!tranCurrency || !baseCurrency || tranCurrency === baseCurrency) {
            return tranTotal;
        }
        
        return convertAmount(tranTotal, tranCurrency, baseCurrency);
    }
    
    /**
     * Format currency amount for display
     * @param {number} amount - Amount
     * @param {number} currencyId - Currency ID
     * @returns {string} Formatted amount with symbol
     */
    function formatCurrency(amount, currencyId) {
        if (!currencyId) {
            return amount.toFixed(2);
        }
        
        var currLookup = search.lookupFields({
            type: 'currency',
            id: currencyId,
            columns: ['symbol', 'displaysymbol']
        });
        
        var symbol = currLookup.displaysymbol || currLookup.symbol || '';
        return symbol + amount.toFixed(2);
    }
    
    /**
     * Get currency info for email templates
     * @param {Record} transaction - Transaction record
     * @returns {Object} Currency data for merge fields
     */
    function getCurrencyMergeData(transaction) {
        var tranCurrency = transaction.getValue({ fieldId: 'currency' });
        var tranTotal = transaction.getValue({ fieldId: 'total' });
        var baseAmount = transaction.getValue({ fieldId: constants.FIELD.BASE_AMOUNT });
        var subsidiary = transaction.getValue({ fieldId: 'subsidiary' });
        var baseCurrency = getBaseCurrency(subsidiary);
        
        var tranCurrLookup = search.lookupFields({
            type: 'currency',
            id: tranCurrency,
            columns: ['symbol', 'name']
        });
        
        var result = {
            CURRENCY: tranCurrLookup.name || '',
            CURRENCY_SYMBOL: tranCurrLookup.symbol || '',
            AMOUNT: formatCurrency(tranTotal, tranCurrency)
        };
        
        // Add base amount if different currency
        if (baseCurrency && tranCurrency !== baseCurrency) {
            var baseCurrLookup = search.lookupFields({
                type: 'currency',
                id: baseCurrency,
                columns: ['symbol', 'name']
            });
            
            result.BASE_CURRENCY = baseCurrLookup.name || '';
            result.BASE_AMOUNT = formatCurrency(baseAmount, baseCurrency);
        }
        
        return result;
    }
    
    return {
        getBaseCurrency: getBaseCurrency,
        getExchangeRate: getExchangeRate,
        convertAmount: convertAmount,
        captureCurrencySnapshot: captureCurrencySnapshot,
        calculateFxVariance: calculateFxVariance,
        isWithinFxTolerance: isWithinFxTolerance,
        getAmountForRuleMatching: getAmountForRuleMatching,
        formatCurrency: formatCurrency,
        getCurrencyMergeData: getCurrencyMergeData
    };
});
```

---

## 4. Integration Points

### 4.1 On Transaction Submit (p2p_approval_engine.js)

Update the `submitForApproval` function:

```javascript
function submitForApproval(transaction) {
    // Capture currency snapshot FIRST
    var currencySnapshot = currencyUtils.captureCurrencySnapshot(transaction);
    
    // Use BASE AMOUNT for rule matching
    var amountForMatching = currencySnapshot.baseAmount;
    
    // Find matching rule using base amount
    var matchedRule = findMatchingRule({
        tranType: transaction.type,
        subsidiary: transaction.getValue({ fieldId: 'subsidiary' }),
        department: transaction.getValue({ fieldId: 'department' }),
        location: transaction.getValue({ fieldId: 'location' }),
        amount: amountForMatching  // Use converted amount
    });
    
    // ... rest of approval logic
}
```

### 4.2 In 3-Way Matching (p2p_matching_engine.js)

Update the `performMatching` function:

```javascript
function performMatching(vendorBill) {
    var matchConfig = loadMatchingConfig(vendorBill.getValue({ fieldId: 'subsidiary' }));
    var fxTolerance = matchConfig.fxTolerancePct || 3; // Default 3%
    
    // Get PO currency data
    var poData = {
        currency: poRecord.getValue({ fieldId: constants.FIELD.ORIG_CURRENCY }),
        rate: poRecord.getValue({ fieldId: constants.FIELD.EXCHANGE_RATE }),
        originalAmount: poRecord.getValue({ fieldId: 'total' })
    };
    
    // Get VB currency data
    var vbData = {
        currency: vendorBill.getValue({ fieldId: 'currency' }),
        rate: currencyUtils.getExchangeRate(
            vendorBill.getValue({ fieldId: 'currency' }),
            currencyUtils.getBaseCurrency(vendorBill.getValue({ fieldId: 'subsidiary' }))
        ),
        originalAmount: vendorBill.getValue({ fieldId: 'total' })
    };
    
    // Calculate FX variance
    var fxVariance = currencyUtils.calculateFxVariance(poData, vbData);
    
    if (fxVariance.hasFxVariance) {
        if (!currencyUtils.isWithinFxTolerance(fxVariance.variancePct, fxTolerance)) {
            // Log FX variance exception
            return {
                status: constants.MATCH_STATUS.PRICE_VARIANCE,
                exception: 'CURRENCY_MISMATCH',
                details: {
                    fxVariancePct: fxVariance.variancePct,
                    fxTolerancePct: fxTolerance,
                    poRate: fxVariance.poRate,
                    vbRate: fxVariance.vbRate
                }
            };
        }
    }
    
    // Continue with standard price/qty matching...
}
```

### 4.3 Email Templates

Add new merge fields for multi-currency:

```
${CURRENCY}        - Transaction currency name (e.g., "Euro")
${CURRENCY_SYMBOL} - Currency symbol (e.g., "€")
${AMOUNT}          - Formatted amount with symbol (e.g., "€10,000.00")
${BASE_CURRENCY}   - Subsidiary base currency name
${BASE_AMOUNT}     - Amount in base currency (e.g., "$10,800.00")
```

---

## 5. SDF Object Definitions

### 5.1 custbody_p2p_orig_currency.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<transactionbodycustomfield scriptid="custbody_p2p_orig_currency">
    <label>P2P Original Currency</label>
    <description>Transaction currency at time of submission</description>
    <fieldtype>SELECT</fieldtype>
    <selectrecordtype>-122</selectrecordtype> <!-- Currency -->
    <storevalue>T</storevalue>
    <showinnewrecord>F</showinnewrecord>
    <displaytype>NORMAL</displaytype>
    <isformula>F</isformula>
    <ismandatory>F</ismandatory>
    <help>Transaction currency at time of submission. Used for audit trail and variance calculations.</help>
    <bodypurchase>T</bodypurchase>
    <bodyvendorbill>T</bodyvendorbill>
</transactionbodycustomfield>
```

### 5.2 custbody_p2p_base_amount.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<transactionbodycustomfield scriptid="custbody_p2p_base_amount">
    <label>P2P Base Amount</label>
    <description>Transaction total in subsidiary base currency</description>
    <fieldtype>CURRENCY</fieldtype>
    <storevalue>T</storevalue>
    <showinnewrecord>F</showinnewrecord>
    <displaytype>NORMAL</displaytype>
    <isformula>F</isformula>
    <ismandatory>F</ismandatory>
    <help>Transaction total converted to subsidiary base currency. Used for approval rule amount matching.</help>
    <bodypurchase>T</bodypurchase>
    <bodyvendorbill>T</bodyvendorbill>
</transactionbodycustomfield>
```

### 5.3 custbody_p2p_exchange_rate.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<transactionbodycustomfield scriptid="custbody_p2p_exchange_rate">
    <label>P2P Exchange Rate</label>
    <description>Exchange rate at submission time</description>
    <fieldtype>FLOAT</fieldtype>
    <storevalue>T</storevalue>
    <showinnewrecord>F</showinnewrecord>
    <displaytype>NORMAL</displaytype>
    <isformula>F</isformula>
    <ismandatory>F</ismandatory>
    <precision>6</precision>
    <help>Exchange rate at submission time (orig currency → base currency). Captured for audit and variance analysis.</help>
    <bodypurchase>T</bodypurchase>
    <bodyvendorbill>T</bodyvendorbill>
</transactionbodycustomfield>
```

---

## 6. Test Cases

### TC-MC-001: Basic Currency Capture
```
Given: PO in EUR, subsidiary base = USD
       Amount = €10,000
       Current EUR/USD rate = 1.08
When: User submits for approval
Then:
  - custbody_p2p_orig_currency = EUR
  - custbody_p2p_exchange_rate = 1.080000
  - custbody_p2p_base_amount = $10,800.00
```

### TC-MC-002: Rule Matching Uses Base Amount
```
Given: Approval rule for amounts $5,000 - $15,000
       PO in GBP for £8,000 (= ~$10,400 at 1.30 rate)
When: Rule matching runs
Then:
  - Rule matches based on $10,400 base amount
  - Not based on £8,000 original amount
```

### TC-MC-003: FX Variance Within Tolerance
```
Given: PO submitted at EUR/USD 1.08
       VB submitted at EUR/USD 1.11
       FX tolerance = 3%
       Variance = 2.78%
When: 3-way matching runs
Then:
  - Match status = "Matched" (within tolerance)
  - No FX exception created
```

### TC-MC-004: FX Variance Exceeds Tolerance
```
Given: PO submitted at EUR/USD 1.08
       VB submitted at EUR/USD 1.15
       FX tolerance = 3%
       Variance = 6.48%
When: 3-way matching runs
Then:
  - Match status = "Price Variance"
  - Exception type = "CURRENCY_MISMATCH"
  - Transaction routed for exception review
```

### TC-MC-005: Same Currency - No FX Check
```
Given: PO and VB both in USD
When: 3-way matching runs
Then:
  - FX variance calculation skipped
  - Standard price/qty matching only
```

---

## 7. Summary

### New Objects

| Object Type | Count |
|-------------|-------|
| Transaction Body Fields | 3 |
| Custom Record Fields | 1 |
| Library Modules | 1 |
| **Total New Objects** | **5** |

### Updated Object Count

| Category | Previous | Added | New Total |
|----------|----------|-------|-----------|
| Transaction Body Fields | 12 | 3 | 15 |
| Matching Config Fields | 8 | 1 | 9 |
| Library Modules | 8 | 1 | 9 |

---

*End of Multi-Currency Specification*
