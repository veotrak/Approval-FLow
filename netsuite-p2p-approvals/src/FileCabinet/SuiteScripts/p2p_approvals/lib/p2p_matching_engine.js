/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/record', '../constants/p2p_constants'], function(record, constants) {
    'use strict';

    function performMatchValidation(params) {
        try {
            if (!params || !params.recordId) {
                throw new Error('Missing vendor bill id.');
            }

            const vbRecord = record.load({ type: 'vendorbill', id: params.recordId });
            const billTotal = Number(vbRecord.getValue('total')) || 0;

            const poCheck = checkPOLink(vbRecord, billTotal);
            const receiptCheck = checkReceiptStatus(vbRecord);
            const varianceCheck = checkVariance(vbRecord);

            const exceptions = [];
            if (!poCheck.pass && poCheck.required) {
                exceptions.push(constants.EXCEPTION_TYPE.MISSING_PO);
            }
            if (!receiptCheck.pass) {
                exceptions.push(constants.EXCEPTION_TYPE.MISSING_RECEIPT);
            }
            if (!varianceCheck.pass) {
                exceptions.push(constants.EXCEPTION_TYPE.VARIANCE_OVER_LIMIT);
            }

            const status = exceptions.length ? constants.MATCH_STATUS.FAIL : constants.MATCH_STATUS.PASS;
            const primaryException = exceptions.length > 1
                ? constants.EXCEPTION_TYPE.MULTIPLE
                : (exceptions[0] || '');

            return {
                status: status,
                exceptions: exceptions,
                primaryException: primaryException,
                details: {
                    poCheck: poCheck,
                    receiptCheck: receiptCheck,
                    varianceCheck: varianceCheck
                }
            };
        } catch (error) {
            log.error('performMatchValidation error', error);
            return {
                status: constants.MATCH_STATUS.FAIL,
                exceptions: [constants.EXCEPTION_TYPE.MULTIPLE],
                primaryException: constants.EXCEPTION_TYPE.MULTIPLE,
                details: { error: error.message }
            };
        }
    }

    function checkPOLink(vbRecord, billTotal) {
        const required = billTotal > constants.CONFIG.PO_REQUIRED_THRESHOLD;
        let linked = false;
        const poIds = [];

        const lineCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        for (let i = 0; i < lineCount; i += 1) {
            const orderId = vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'orderdoc', line: i })
                || vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'linkedorder', line: i })
                || vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'purchaseorder', line: i });
            if (orderId) {
                linked = true;
                poIds.push(orderId);
            }
        }

        return {
            pass: !required || linked,
            required: required,
            linked: linked,
            poIds: poIds,
            message: required && !linked ? 'PO link required but missing.' : ''
        };
    }

    function checkReceiptStatus(vbRecord) {
        const lineCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        const pendingItems = [];
        let itemsRequiringReceipt = 0;
        let itemsReceived = 0;

        for (let i = 0; i < lineCount; i += 1) {
            const itemType = vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            const requiresReceipt = ['InvtPart', 'Assembly', 'FixedAsset'].indexOf(itemType) !== -1;
            if (!requiresReceipt) {
                continue;
            }

            itemsRequiringReceipt += 1;
            const billedQty = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            const receivedQty = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i })) || 0;
            if (receivedQty >= billedQty) {
                itemsReceived += 1;
            } else {
                pendingItems.push({
                    line: i + 1,
                    billedQty: billedQty,
                    receivedQty: receivedQty
                });
            }
        }

        return {
            pass: pendingItems.length === 0,
            itemsRequiringReceipt: itemsRequiringReceipt,
            itemsReceived: itemsReceived,
            pendingItems: pendingItems
        };
    }

    function checkVariance(vbRecord) {
        const lineCount = vbRecord.getLineCount({ sublistId: 'item' }) || 0;
        const varianceLines = [];

        for (let i = 0; i < lineCount; i += 1) {
            const billedRate = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i })) || 0;
            const billedQty = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            const poRate = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'porate', line: i })) || 0;
            const poQty = Number(vbRecord.getSublistValue({ sublistId: 'item', fieldId: 'poqty', line: i })) || billedQty;

            if (!poRate) {
                continue;
            }

            const rateDiff = Math.abs(billedRate - poRate);
            const percentDiff = poRate ? (rateDiff / poRate) * 100 : 0;
            const amountDiff = rateDiff * billedQty;

            const percentFail = percentDiff > constants.CONFIG.VARIANCE_PERCENT_LIMIT;
            const amountFail = amountDiff > constants.CONFIG.VARIANCE_AMOUNT_LIMIT;
            const qtyFail = billedQty > poQty;

            if ((percentFail && amountFail) || qtyFail) {
                varianceLines.push({
                    line: i + 1,
                    billedRate: billedRate,
                    poRate: poRate,
                    billedQty: billedQty,
                    poQty: poQty,
                    percentDiff: percentDiff,
                    amountDiff: amountDiff
                });
            }
        }

        return {
            pass: varianceLines.length === 0,
            varianceLines: varianceLines
        };
    }

    return {
        performMatchValidation: performMatchValidation,
        checkPOLink: checkPOLink,
        checkReceiptStatus: checkReceiptStatus,
        checkVariance: checkVariance
    };
});
