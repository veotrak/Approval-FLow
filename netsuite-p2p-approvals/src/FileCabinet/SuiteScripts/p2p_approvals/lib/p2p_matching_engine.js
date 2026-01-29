/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/record', 'N/search', 'N/runtime', '../constants/p2p_constants'], function(record, search, runtime, constants) {
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

            const anomalies = detectAnomalies(vbRecord, {
                poCheck: poCheck,
                receiptCheck: receiptCheck,
                varianceCheck: varianceCheck
            });

            return {
                status: status,
                exceptions: exceptions,
                primaryException: primaryException,
                anomalies: anomalies,
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

    function detectAnomalies(vbRecord, details) {
        const anomalies = [];
        try {
            const vendorId = vbRecord.getValue('entity');
            const isNew = vendorId && isNewVendor(vendorId, vbRecord.id);
            if (isNew) {
                anomalies.push('New vendor');
            }
            if (details && details.varianceCheck && !details.varianceCheck.pass) {
                anomalies.push('Price variance over limit');
            }
            if (!isNew && hasSufficientVendorHistory(vendorId, vbRecord.id)) {
                const newAccounts = findNewAccountsForVendor(vendorId, vbRecord);
                if (newAccounts.length) {
                    anomalies.push('New account for vendor: ' + newAccounts.join(', '));
                }
            }
        } catch (error) {
            log.error('detectAnomalies error', error);
        }
        return anomalies;
    }

    function isNewVendor(vendorId, currentBillId) {
        if (!vendorId) {
            return false;
        }
        if (!isVendorCreatedRecently(vendorId, getConfigNumber(
            constants.SCRIPT_PARAMS.NEW_VENDOR_DAYS,
            constants.CONFIG.NEW_VENDOR_DAYS
        ))) {
            return false;
        }
        return !hasPriorVendorBills(vendorId, currentBillId);
    }

    function hasPriorVendorBills(vendorId, currentBillId) {
        const vendorSearch = search.create({
            type: 'transaction',
            filters: [
                ['type', 'anyof', 'VendBill'],
                'and',
                ['entity', 'anyof', vendorId],
                'and',
                ['mainline', 'is', 'T'],
                'and',
                ['internalid', 'noneof', currentBillId]
            ],
            columns: ['internalid']
        });
        const result = vendorSearch.run().getRange({ start: 0, end: 1 });
        return !!(result && result.length);
    }

    function isVendorCreatedRecently(vendorId, days) {
        try {
            const vendor = record.load({ type: 'vendor', id: vendorId });
            const created = vendor.getValue('datecreated');
            if (!created) {
                return false;
            }
            const createdDate = created instanceof Date ? created : new Date(created);
            if (isNaN(createdDate.getTime())) {
                return false;
            }
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (days || 0));
            return createdDate >= cutoff;
        } catch (error) {
            log.error('isVendorCreatedRecently error', error);
            return false;
        }
    }

    function hasSufficientVendorHistory(vendorId, currentBillId) {
        if (!vendorId) {
            return false;
        }
        try {
            const historySearch = search.create({
                type: 'transaction',
                filters: [
                    ['type', 'anyof', 'VendBill'],
                    'and',
                    ['entity', 'anyof', vendorId],
                    'and',
                    ['mainline', 'is', 'T'],
                    'and',
                    ['internalid', 'noneof', currentBillId]
                ],
                columns: ['internalid']
            });
            const count = historySearch.runPaged().count || 0;
            const minCount = getConfigNumber(
                constants.SCRIPT_PARAMS.MIN_VENDOR_BILLS_FOR_ACCOUNT_ANOMALY,
                constants.CONFIG.MIN_VENDOR_BILLS_FOR_ACCOUNT_ANOMALY
            );
            return count >= minCount;
        } catch (error) {
            log.error('hasSufficientVendorHistory error', error);
            return false;
        }
    }

    function findNewAccountsForVendor(vendorId, vbRecord) {
        if (!vendorId) {
            return [];
        }
        const accounts = getExpenseAccounts(vbRecord);
        const newAccounts = [];
        for (let i = 0; i < accounts.length; i += 1) {
            const accountId = accounts[i].id;
            const accountName = accounts[i].name || accounts[i].id;
            if (isNewAccountForVendor(vendorId, accountId, vbRecord.id)) {
                newAccounts.push(accountName);
            }
            if (newAccounts.length >= 3) {
                break;
            }
        }
        return newAccounts;
    }

    function getExpenseAccounts(vbRecord) {
        const accounts = [];
        const seen = {};
        const lineCount = vbRecord.getLineCount({ sublistId: 'expense' }) || 0;
        for (let i = 0; i < lineCount; i += 1) {
            const accountId = vbRecord.getSublistValue({ sublistId: 'expense', fieldId: 'account', line: i });
            if (!accountId || seen[accountId]) {
                continue;
            }
            seen[accountId] = true;
            accounts.push({
                id: accountId,
                name: vbRecord.getSublistText({ sublistId: 'expense', fieldId: 'account', line: i }) || accountId
            });
            if (accounts.length >= 5) {
                break;
            }
        }
        return accounts;
    }

    function isNewAccountForVendor(vendorId, accountId, currentBillId) {
        try {
            const accountSearch = search.create({
                type: 'transaction',
                filters: [
                    ['type', 'anyof', 'VendBill'],
                    'and',
                    ['entity', 'anyof', vendorId],
                    'and',
                    ['account', 'anyof', accountId],
                    'and',
                    ['mainline', 'is', 'F'],
                    'and',
                    ['internalid', 'noneof', currentBillId]
                ],
                columns: ['internalid']
            });
            const result = accountSearch.run().getRange({ start: 0, end: 1 });
            return !result || !result.length;
        } catch (error) {
            log.error('isNewAccountForVendor error', error);
            return false;
        }
    }

    function getConfigNumber(paramId, fallback) {
        try {
            const script = runtime.getCurrentScript();
            if (!script) {
                return fallback;
            }
            const raw = script.getParameter({ name: paramId });
            const parsed = Number(raw);
            return isNaN(parsed) ? fallback : parsed;
        } catch (error) {
            log.error('getConfigNumber error', error);
            return fallback;
        }
    }

    return {
        performMatchValidation: performMatchValidation,
        checkPOLink: checkPOLink,
        checkReceiptStatus: checkReceiptStatus,
        checkVariance: checkVariance,
        detectAnomalies: detectAnomalies
    };
});
