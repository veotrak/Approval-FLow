/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Purchase Order
 */
define(['N/record', 'N/runtime', 'N/ui/serverWidget',
        '../lib/p2p_approval_engine', '../lib/p2p_history_logger',
        '../constants/p2p_constants'
], function(record, runtime, serverWidget, approvalEngine,
            historyLogger, constants) {
    'use strict';

    function beforeLoad(context) {
        try {
            const form = context.form;
            const recordObj = context.newRecord;

            form.clientScriptModulePath = '../client/p2p_po_cs.js';

            const historyHtml = historyLogger.buildHistoryHtml(
                constants.TRANSACTION_TYPES.PURCHASE_ORDER,
                recordObj.id
            );
            form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'P2P Approval History'
            }).defaultValue = historyHtml;

            if (context.type === context.UserEventType.VIEW) {
                const status = recordObj.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
                const currentApprover = recordObj.getValue(constants.BODY_FIELDS.CURRENT_APPROVER);
                const currentUser = runtime.getCurrentUser().id;

                if (status === constants.APPROVAL_STATUS.DRAFT) {
                    form.addButton({
                        id: 'custpage_p2p_submit',
                        label: 'Submit for Approval',
                        functionName: 'submitForApproval'
                    });
                }
                if (status === constants.APPROVAL_STATUS.PENDING_APPROVAL && String(currentApprover) === String(currentUser)) {
                    form.addButton({
                        id: 'custpage_p2p_approve',
                        label: 'Approve',
                        functionName: 'approveRecord'
                    });
                    form.addButton({
                        id: 'custpage_p2p_reject',
                        label: 'Reject',
                        functionName: 'rejectRecord'
                    });
                }
                if (status === constants.APPROVAL_STATUS.REJECTED) {
                    form.addButton({
                        id: 'custpage_p2p_resubmit',
                        label: 'Resubmit',
                        functionName: 'resubmitForApproval'
                    });
                }
            }
        } catch (error) {
            log.error('beforeLoad error', error);
        }
    }

    function beforeSubmit(context) {
        try {
            const recordObj = context.newRecord;
            if (context.type === context.UserEventType.CREATE) {
                recordObj.setValue({
                    fieldId: constants.BODY_FIELDS.APPROVAL_STATUS,
                    value: constants.APPROVAL_STATUS.DRAFT
                });
            }

            if (context.type === context.UserEventType.EDIT && context.oldRecord) {
                const oldStatus = context.oldRecord.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
                const status = recordObj.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
                const requiresReapproval = oldStatus === constants.APPROVAL_STATUS.APPROVED
                    && status === constants.APPROVAL_STATUS.APPROVED
                    && hasMaterialChanges(context.oldRecord, recordObj);
                if (requiresReapproval) {
                    recordObj.setValue({ fieldId: constants.BODY_FIELDS.APPROVAL_STATUS, value: constants.APPROVAL_STATUS.DRAFT });
                    recordObj.setValue({ fieldId: constants.BODY_FIELDS.CURRENT_STEP, value: '' });
                    recordObj.setValue({ fieldId: constants.BODY_FIELDS.CURRENT_APPROVER, value: '' });
                    recordObj.setValue({ fieldId: constants.BODY_FIELDS.APPROVAL_RULE, value: '' });
                    const currentRevision = parseInt(recordObj.getValue(constants.BODY_FIELDS.REVISION_NUMBER), 10) || 0;
                    recordObj.setValue({ fieldId: constants.BODY_FIELDS.REVISION_NUMBER, value: currentRevision + 1 });
                }
            }
        } catch (error) {
            log.error('beforeSubmit error', error);
        }
    }

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
                return;
            }

            const recordObj = record.load({ type: 'purchaseorder', id: context.newRecord.id });
            const status = recordObj.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
            if (status !== constants.APPROVAL_STATUS.DRAFT) {
                return;
            }

            approvalEngine.routeForApproval({
                recordType: 'purchaseorder',
                recordId: recordObj.id,
                transactionData: {
                    transactionType: constants.TRANSACTION_TYPES.PURCHASE_ORDER,
                    subsidiary: recordObj.getValue('subsidiary'),
                    department: recordObj.getValue('department'),
                    location: recordObj.getValue('location'),
                    amount: Number(recordObj.getValue('total')) || 0,
                    currency: recordObj.getValue('currency'),
                    riskScore: recordObj.getValue(constants.BODY_FIELDS.AI_RISK_SCORE),
                    riskFlags: recordObj.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS)
                }
            });
        } catch (error) {
            log.error('afterSubmit error', error);
        }
    }

    function hasMaterialChanges(oldRecord, newRecord) {
        return hasBodyFieldChanges(oldRecord, newRecord, [
            'entity', 'subsidiary', 'department', 'location', 'currency', 'exchangerate',
            'trandate', 'terms', 'memo', 'otherrefnum', 'class', 'approvalstatus'
        ]) || hasSublistChanges(oldRecord, newRecord, 'item', [
            'item', 'quantity', 'rate', 'amount', 'department', 'location', 'class'
        ]) || hasSublistChanges(oldRecord, newRecord, 'expense', [
            'account', 'amount', 'memo', 'department', 'location', 'class'
        ]);
    }

    function hasBodyFieldChanges(oldRecord, newRecord, fieldIds) {
        for (let i = 0; i < fieldIds.length; i += 1) {
            const fieldId = fieldIds[i];
            const oldValue = oldRecord.getValue(fieldId);
            const newValue = newRecord.getValue(fieldId);
            if (valuesDiffer(oldValue, newValue)) {
                return true;
            }
        }
        return false;
    }

    function hasSublistChanges(oldRecord, newRecord, sublistId, fieldIds) {
        const oldCount = oldRecord.getLineCount({ sublistId: sublistId }) || 0;
        const newCount = newRecord.getLineCount({ sublistId: sublistId }) || 0;
        if (oldCount !== newCount) {
            return true;
        }
        for (let line = 0; line < newCount; line += 1) {
            for (let i = 0; i < fieldIds.length; i += 1) {
                const fieldId = fieldIds[i];
                const oldValue = oldRecord.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: line });
                const newValue = newRecord.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: line });
                if (valuesDiffer(oldValue, newValue)) {
                    return true;
                }
            }
        }
        return false;
    }

    function valuesDiffer(oldValue, newValue) {
        if (isNumeric(oldValue) && isNumeric(newValue)) {
            return Number(oldValue) !== Number(newValue);
        }
        const oldText = normalizeText(oldValue);
        const newText = normalizeText(newValue);
        return oldText !== newText;
    }

    function isNumeric(value) {
        if (value === null || value === undefined || value === '') {
            return false;
        }
        return !isNaN(Number(value));
    }

    function normalizeText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    return { beforeLoad: beforeLoad, beforeSubmit: beforeSubmit, afterSubmit: afterSubmit };
});
