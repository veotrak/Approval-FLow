/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P Matching Engine (v2 - Decision Table Architecture)
 * Handles 3-way matching for Vendor Bills: PO → Receipt → Invoice
 */
define([
    'N/record', 'N/search', 'N/runtime',
    '../constants/p2p_constants_v2',
    './p2p_config'
], function(record, search, runtime, constants, config) {
    'use strict';

    const MATCH_STATUS = constants.MATCH_STATUS;
    const EXCEPTION_TYPE = constants.EXCEPTION_TYPE;

    /**
     * Perform full 3-way match validation on a Vendor Bill
     * 
     * @param {Object} params
     * @param {number} params.recordId - Vendor Bill internal ID
     * @param {Record} [params.record] - Optional pre-loaded record
     * @returns {Object} Match result with status, exceptions, and details
     */
    function performMatchValidation(params) {
        try {
            if (!params || !params.recordId) {
                throw new Error('Missing recordId for match validation');
            }

            const vbRecord = params.record || record.load({ 
                type: 'vendorbill', 
                id: params.recordId 
            });

            const billTotal = parseFloat(vbRecord.getValue('total')) || 0;
            const subsidiary = vbRecord.getValue('subsidiary');

            // Load matching config for subsidiary
            const matchConfig = loadMatchingConfig(subsidiary);

            // Run all checks
            const poCheck = checkPOLink(vbRecord, billTotal, matchConfig);
            const receiptCheck = checkReceiptStatus(vbRecord, matchConfig);
            const varianceCheck = checkVariance(vbRecord, matchConfig);
            const duplicateCheck = checkDuplicateInvoice(vbRecord, matchConfig);

            // Collect exceptions
            const exceptions = [];
            const details = {};

            if (!poCheck.pass && poCheck.required) {
                exceptions.push(EXCEPTION_TYPE.MISSING_PO);
                details.poCheck = poCheck;
            }

            if (!receiptCheck.pass) {
                exceptions.push(EXCEPTION_TYPE.MISSING_RECEIPT);
                details.receiptCheck = receiptCheck;
            }

            if (!varianceCheck.pass) {
                if (varianceCheck.priceVariance) {
                    exceptions.push(EXCEPTION_TYPE.PRICE_VARIANCE);
                }
                if (varianceCheck.qtyVariance) {
                    exceptions.push(EXCEPTION_TYPE.QTY_VARIANCE);
                }
                details.varianceCheck = varianceCheck;
            }

            if (!duplicateCheck.pass) {
                exceptions.push(EXCEPTION_TYPE.DUPLICATE);
                details.duplicateCheck = duplicateCheck;
            }

            // Detect anomalies (for AI risk flags)
            const anomalies = detectAnomalies(vbRecord, {
                poCheck: poCheck,
                receiptCheck: receiptCheck,
                varianceCheck: varianceCheck
            });

            // Determine overall status
            let status = MATCH_STATUS.MATCHED;
            let primaryException = '';

            if (exceptions.length > 1) {
                status = MATCH_STATUS.PARTIAL_MATCH;
                primaryException = EXCEPTION_TYPE.MULTIPLE;
            } else if (exceptions.length === 1) {
                status = getStatusForException(exceptions[0]);
                primaryException = exceptions[0];
            }

            return {
                success: true,
                status: status,
                exceptions: exceptions,
                primaryException: primaryException,
                anomalies: anomalies,
                details: {
                    poCheck: poCheck,
                    receiptCheck: receiptCheck,
                    varianceCheck: varianceCheck,
                    duplicateCheck: duplicateCheck
                },
                config: {
                    poThreshold: matchConfig.poRequiredThreshold,
                    priceVariancePct: matchConfig.priceVariancePct,
                    priceVarianceAmt: matchConfig.priceVarianceAmt,
                    qtyTolerance: matchConfig.qtyTolerance
                }
            };
        } catch (error) {
            log.error('performMatchValidation error', error);
            return {
                success: false,
                status: MATCH_STATUS.NOT_MATCHED,
                exceptions: [EXCEPTION_TYPE.MULTIPLE],
                primaryException: EXCEPTION_TYPE.MULTIPLE,
                anomalies: [],
                details: { error: error.message }
            };
        }
    }

    /**
     * Load matching configuration for a subsidiary
     */
    function loadMatchingConfig(subsidiaryId) {
        try {
            // Try to load from Global Config first
            const globalConfig = config.getConfig();
            
            // Default values from global config or constants
            const defaults = {
                poRequiredThreshold: globalConfig.poRequiredThreshold || 1000,
                priceVariancePct: globalConfig.priceVariancePct || 5,
                priceVarianceAmt: globalConfig.priceVarianceAmt || 500,
                qtyTolerance: globalConfig.qtyTolerance || 0,
                requireReceipt: globalConfig.requireReceiptForInventory !== false,
                checkDuplicate: globalConfig.checkDuplicateInvoice !== false,
                fxTolerancePct: globalConfig.fxTolerancePct || 3
            };

            // TODO: Load subsidiary-specific config if exists
            // For now, return defaults
            return defaults;
        } catch (error) {
            log.error('loadMatchingConfig error', error);
            return {
                poRequiredThreshold: 1000,
                priceVariancePct: 5,
                priceVarianceAmt: 500,
                qtyTolerance: 0,
                requireReceipt: true,
                checkDuplicate: true,
                fxTolerancePct: 3
            };
        }
    }

    /**
     * Check if PO link is required and present
     */
    function checkPOLink(vbRecord, billTotal, matchConfig) {
        const threshold = matchConfig.poRequiredThreshold || 1000;
        const required = billTotal > threshold;
        
        const poIds = [];
        let linked = false;

        // Check item lines for PO links
        const itemCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        for (let i = 0; i < itemCount; i++) {
            const orderId = vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'orderdoc', line: i })
                || vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'purchaseorder', line: i })
                || vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'createdfrom', line: i });
            
            if (orderId && poIds.indexOf(orderId) === -1) {
                linked = true;
                poIds.push(orderId);
            }
        }

        // Check expense lines for PO links
        const expenseCount = vbRecord.getLineCount({ sublistId: 'expense' }) || 0;
        for (let i = 0; i < expenseCount; i++) {
            const orderId = vbRecord.getSublistValue({ sublistId: 'expense', fieldId: 'orderdoc', line: i });
            if (orderId && poIds.indexOf(orderId) === -1) {
                linked = true;
                poIds.push(orderId);
            }
        }

        return {
            pass: !required || linked,
            required: required,
            linked: linked,
            poIds: poIds,
            threshold: threshold,
            billTotal: billTotal,
            message: required && !linked ? 'PO link required for bills over $' + threshold : ''
        };
    }

    /**
     * Check receipt status for items requiring receipt
     */
    function checkReceiptStatus(vbRecord, matchConfig) {
        if (!matchConfig.requireReceipt) {
            return { pass: true, skipped: true };
        }

        const itemCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        const pendingItems = [];
        let itemsRequiringReceipt = 0;
        let itemsReceived = 0;

        for (let i = 0; i < itemCount; i++) {
            const itemType = vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            
            // Only check inventory, assembly, and fixed asset items
            const requiresReceipt = ['InvtPart', 'Assembly', 'FixedAsset', 'Kit'].indexOf(itemType) !== -1;
            if (!requiresReceipt) continue;

            itemsRequiringReceipt++;
            
            const billedQty = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            const receivedQty = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i })) || 0;

            if (receivedQty >= billedQty) {
                itemsReceived++;
            } else {
                pendingItems.push({
                    line: i + 1,
                    item: vbRecord.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }),
                    billedQty: billedQty,
                    receivedQty: receivedQty,
                    shortage: billedQty - receivedQty
                });
            }
        }

        return {
            pass: pendingItems.length === 0,
            itemsRequiringReceipt: itemsRequiringReceipt,
            itemsReceived: itemsReceived,
            pendingItems: pendingItems,
            message: pendingItems.length > 0 ? pendingItems.length + ' item(s) pending receipt' : ''
        };
    }

    /**
     * Check price and quantity variance
     */
    function checkVariance(vbRecord, matchConfig) {
        const pctLimit = matchConfig.priceVariancePct || 5;
        const amtLimit = matchConfig.priceVarianceAmt || 500;
        const qtyTolerance = matchConfig.qtyTolerance || 0;

        const itemCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        const varianceLines = [];
        let hasPriceVariance = false;
        let hasQtyVariance = false;

        for (let i = 0; i < itemCount; i++) {
            const billedRate = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i })) || 0;
            const billedQty = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            
            // Get PO rate and qty (may be stored in custom columns or need lookup)
            const poRate = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'porate', line: i })) 
                || parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_p2p_po_rate', line: i }))
                || 0;
            const poQty = parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'poqty', line: i }))
                || parseFloat(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_p2p_po_qty', line: i }))
                || billedQty;

            if (!poRate) continue; // Skip if no PO rate to compare

            // Calculate price variance
            const rateDiff = Math.abs(billedRate - poRate);
            const percentDiff = poRate ? (rateDiff / poRate) * 100 : 0;
            const amountDiff = rateDiff * billedQty;

            // Price variance fails if BOTH % and $ limits are exceeded
            const priceFail = percentDiff > pctLimit && amountDiff > amtLimit;

            // Quantity variance - cannot bill more than ordered (with tolerance)
            const maxAllowedQty = poQty * (1 + qtyTolerance / 100);
            const qtyFail = billedQty > maxAllowedQty;

            if (priceFail || qtyFail) {
                varianceLines.push({
                    line: i + 1,
                    item: vbRecord.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }),
                    billedRate: billedRate,
                    poRate: poRate,
                    billedQty: billedQty,
                    poQty: poQty,
                    percentDiff: Math.round(percentDiff * 100) / 100,
                    amountDiff: Math.round(amountDiff * 100) / 100,
                    priceVariance: priceFail,
                    qtyVariance: qtyFail
                });

                if (priceFail) hasPriceVariance = true;
                if (qtyFail) hasQtyVariance = true;
            }
        }

        return {
            pass: varianceLines.length === 0,
            priceVariance: hasPriceVariance,
            qtyVariance: hasQtyVariance,
            varianceLines: varianceLines,
            config: {
                pctLimit: pctLimit,
                amtLimit: amtLimit,
                qtyTolerance: qtyTolerance
            },
            message: varianceLines.length > 0 ? varianceLines.length + ' line(s) with variance' : ''
        };
    }

    /**
     * Check for duplicate invoice
     */
    function checkDuplicateInvoice(vbRecord, matchConfig) {
        if (!matchConfig.checkDuplicate) {
            return { pass: true, skipped: true };
        }

        const vendorId = vbRecord.getValue('entity');
        const tranId = vbRecord.getValue('tranid');
        const currentId = vbRecord.id;

        if (!vendorId || !tranId) {
            return { pass: true, message: 'No vendor or transaction ID to check' };
        }

        try {
            const dupSearch = search.create({
                type: 'vendorbill',
                filters: [
                    ['entity', 'anyof', vendorId],
                    'and',
                    ['tranid', 'is', tranId],
                    'and',
                    ['mainline', 'is', 'T'],
                    'and',
                    ['internalid', 'noneof', currentId]
                ],
                columns: ['internalid', 'tranid', 'trandate', 'total']
            });

            const duplicates = [];
            dupSearch.run().each(function(result) {
                duplicates.push({
                    id: result.getValue('internalid'),
                    tranId: result.getValue('tranid'),
                    date: result.getValue('trandate'),
                    total: result.getValue('total')
                });
                return duplicates.length < 5;
            });

            return {
                pass: duplicates.length === 0,
                duplicates: duplicates,
                message: duplicates.length > 0 ? 'Possible duplicate invoice found' : ''
            };
        } catch (error) {
            log.error('checkDuplicateInvoice error', error);
            return { pass: true, error: error.message };
        }
    }

    /**
     * Detect anomalies for AI risk flagging
     */
    function detectAnomalies(vbRecord, checkResults) {
        const anomalies = [];

        try {
            const vendorId = vbRecord.getValue('entity');

            // Check for new vendor
            if (vendorId && isNewVendor(vendorId, vbRecord.id)) {
                anomalies.push('New vendor (first invoice)');
            }

            // Check for unusual amount
            if (vendorId && isUnusualAmount(vendorId, vbRecord)) {
                anomalies.push('Unusual invoice amount for vendor');
            }

            // Check variance details
            if (checkResults.varianceCheck && !checkResults.varianceCheck.pass) {
                const varLines = checkResults.varianceCheck.varianceLines || [];
                const highVariance = varLines.some(function(v) {
                    return v.percentDiff > 20;
                });
                if (highVariance) {
                    anomalies.push('High price variance (>20%)');
                }
            }

            // Check for round number total
            const total = parseFloat(vbRecord.getValue('total')) || 0;
            if (total > 1000 && total % 1000 === 0) {
                anomalies.push('Round number invoice amount');
            }

            // Check for rush approval pattern (submitted near end of period)
            const tranDate = vbRecord.getValue('trandate');
            if (tranDate) {
                const day = new Date(tranDate).getDate();
                if (day >= 28) {
                    anomalies.push('End of month invoice');
                }
            }

        } catch (error) {
            log.error('detectAnomalies error', error);
        }

        return anomalies;
    }

    /**
     * Check if vendor is new (no prior bills)
     */
    function isNewVendor(vendorId, currentBillId) {
        try {
            const priorSearch = search.create({
                type: 'vendorbill',
                filters: [
                    ['entity', 'anyof', vendorId],
                    'and',
                    ['mainline', 'is', 'T'],
                    'and',
                    ['internalid', 'noneof', currentBillId]
                ],
                columns: ['internalid']
            });

            const results = priorSearch.run().getRange({ start: 0, end: 1 });
            return !results || results.length === 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if invoice amount is unusual for vendor
     */
    function isUnusualAmount(vendorId, vbRecord) {
        try {
            const currentAmount = parseFloat(vbRecord.getValue('total')) || 0;
            const currentId = vbRecord.id;

            // Get average amount for vendor
            const avgSearch = search.create({
                type: 'vendorbill',
                filters: [
                    ['entity', 'anyof', vendorId],
                    'and',
                    ['mainline', 'is', 'T'],
                    'and',
                    ['internalid', 'noneof', currentId]
                ],
                columns: [
                    search.createColumn({ name: 'amount', summary: search.Summary.AVG }),
                    search.createColumn({ name: 'amount', summary: search.Summary.MAX })
                ]
            });

            const results = avgSearch.run().getRange({ start: 0, end: 1 });
            if (!results || !results.length) return false;

            const avgAmount = parseFloat(results[0].getValue({ name: 'amount', summary: search.Summary.AVG })) || 0;
            const maxAmount = parseFloat(results[0].getValue({ name: 'amount', summary: search.Summary.MAX })) || 0;

            // Flag if current amount is >3x average or >1.5x max
            return (avgAmount > 0 && currentAmount > avgAmount * 3) || 
                   (maxAmount > 0 && currentAmount > maxAmount * 1.5);
        } catch (error) {
            return false;
        }
    }

    /**
     * Map exception type to match status
     */
    function getStatusForException(exceptionType) {
        switch (exceptionType) {
            case EXCEPTION_TYPE.PRICE_VARIANCE:
                return MATCH_STATUS.PRICE_VARIANCE;
            case EXCEPTION_TYPE.QTY_VARIANCE:
                return MATCH_STATUS.QTY_VARIANCE;
            case EXCEPTION_TYPE.MISSING_PO:
                return MATCH_STATUS.PO_NOT_FOUND;
            case EXCEPTION_TYPE.MISSING_RECEIPT:
                return MATCH_STATUS.RECEIPT_MISSING;
            default:
                return MATCH_STATUS.NOT_MATCHED;
        }
    }

    /**
     * Update match status fields on vendor bill
     */
    function updateMatchStatus(recordId, matchResult) {
        try {
            const values = {};
            values[constants.BODY_FIELDS.MATCH_STATUS] = matchResult.status;
            
            if (matchResult.primaryException) {
                values[constants.BODY_FIELDS.EXCEPTION_TYPE] = matchResult.primaryException;
            }

            // Update AI risk flags with anomalies
            if (matchResult.anomalies && matchResult.anomalies.length) {
                const existingFlags = record.load({ type: 'vendorbill', id: recordId })
                    .getValue(constants.BODY_FIELDS.AI_RISK_FLAGS) || '';
                const anomalyText = 'Anomalies: ' + matchResult.anomalies.join(', ');
                values[constants.BODY_FIELDS.AI_RISK_FLAGS] = existingFlags 
                    ? existingFlags + ' | ' + anomalyText 
                    : anomalyText;
            }

            record.submitFields({
                type: 'vendorbill',
                id: recordId,
                values: values
            });

            return true;
        } catch (error) {
            log.error('updateMatchStatus error', error);
            return false;
        }
    }

    return {
        performMatchValidation: performMatchValidation,
        checkPOLink: checkPOLink,
        checkReceiptStatus: checkReceiptStatus,
        checkVariance: checkVariance,
        checkDuplicateInvoice: checkDuplicateInvoice,
        detectAnomalies: detectAnomalies,
        updateMatchStatus: updateMatchStatus,
        loadMatchingConfig: loadMatchingConfig
    };
});
