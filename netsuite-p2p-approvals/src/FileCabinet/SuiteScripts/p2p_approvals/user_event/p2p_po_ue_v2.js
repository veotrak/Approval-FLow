/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Purchase Order
 * 
 * P2P PO User Event (v2 - Decision Table Architecture)
 */
define([
    'N/record', 'N/runtime', 'N/ui/serverWidget',
    '../lib/p2p_controller', '../lib/p2p_config', '../lib/p2p_history_logger',
    '../constants/p2p_constants_v2'
], function(
    record, runtime, serverWidget,
    controller, config, historyLogger, constants
) {
    'use strict';

    const BF = constants.BODY_FIELDS;

    function beforeLoad(context) {
        try {
            const form = context.form;
            const rec = context.newRecord;

            form.clientScriptModulePath = '../client/p2p_po_cs_v2.js';

            // Add approval history display
            const historyHtml = historyLogger.buildHistoryHtml(
                constants.TRANSACTION_TYPES.PURCHASE_ORDER,
                rec.id
            );

            const historyField = form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'P2P Approval History'
            });
            historyField.defaultValue = historyHtml;

            // Add match reason display (explainability)
            const matchReason = rec.getValue(BF.MATCH_REASON);
            if (matchReason && context.type === context.UserEventType.VIEW) {
                const explainField = form.addField({
                    id: 'custpage_p2p_explain',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Rule Match Explanation'
                });
                explainField.defaultValue = buildExplainHtml(rec);
            }

            // Add action buttons based on status
            if (context.type === context.UserEventType.VIEW) {
                addActionButtons(form, rec);
            }
        } catch (error) {
            log.error('beforeLoad error', error);
        }
    }

    function beforeSubmit(context) {
        try {
            const rec = context.newRecord;

            if (context.type === context.UserEventType.CREATE) {
                // Set initial status to Draft
                rec.setValue({ fieldId: BF.APPROVAL_STATUS, value: constants.APPROVAL_STATUS.DRAFT });
                rec.setValue({ fieldId: BF.REVISION_NUMBER, value: 1 });
            }

            if (context.type === context.UserEventType.EDIT && context.oldRecord) {
                handlePOEdit(context.oldRecord, rec);
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

            const rec = record.load({ type: 'purchaseorder', id: context.newRecord.id });
            const status = rec.getValue(BF.APPROVAL_STATUS);

            // Only route if in Draft status
            if (status !== constants.APPROVAL_STATUS.DRAFT) {
                return;
            }

            // Route for approval
            const result = controller.handleSubmit({
                recordType: 'purchaseorder',
                recordId: rec.id
            });

            if (!result.success && !result.autoApproved) {
                log.error('Routing failed', result.message);
            }
        } catch (error) {
            log.error('afterSubmit error', error);
        }
    }

    /**
     * Handle PO edit - check if re-approval is needed
     */
    function handlePOEdit(oldRec, newRec) {
        const oldStatus = oldRec.getValue(BF.APPROVAL_STATUS);
        const newStatus = newRec.getValue(BF.APPROVAL_STATUS);

        // Only trigger re-approval if already approved
        if (oldStatus !== constants.APPROVAL_STATUS.APPROVED) {
            return;
        }

        // Don't reset if status was explicitly changed
        if (newStatus !== constants.APPROVAL_STATUS.APPROVED) {
            return;
        }

        const cfg = config.getConfig();
        if (!hasRelevantChanges(oldRec, newRec, cfg)) {
            return;
        }

        // Reset to Draft for re-approval
        log.audit('PO requires re-approval', { id: newRec.id });
        
        newRec.setValue({ fieldId: BF.APPROVAL_STATUS, value: constants.APPROVAL_STATUS.DRAFT });
        newRec.setValue({ fieldId: BF.CURRENT_STEP, value: '' });
        newRec.setValue({ fieldId: BF.CURRENT_APPROVER, value: '' });
        newRec.setValue({ fieldId: BF.MATCHED_RULE, value: '' });
        newRec.setValue({ fieldId: BF.APPROVAL_PATH, value: '' });
        newRec.setValue({ fieldId: BF.MATCH_REASON, value: '' });

        // Increment revision
        const currentRevision = parseInt(newRec.getValue(BF.REVISION_NUMBER), 10) || 0;
        newRec.setValue({ fieldId: BF.REVISION_NUMBER, value: currentRevision + 1 });
    }

    /**
     * Check if material fields changed that require re-approval
     */
    function hasRelevantChanges(oldRec, newRec, cfg) {
        const mode = cfg.reapprovalMode || 'material';
        
        // Body fields to check
        const bodyFields = cfg.reapprovalBody && cfg.reapprovalBody.length 
            ? cfg.reapprovalBody 
            : getDefaultBodyFields(mode);

        // Check body fields
        for (let i = 0; i < bodyFields.length; i++) {
            const fieldId = bodyFields[i];
            if (valuesDiffer(oldRec.getValue(fieldId), newRec.getValue(fieldId))) {
                log.debug('Body field changed', { field: fieldId });
                return true;
            }
        }

        // Item sublist fields
        const itemFields = cfg.reapprovalItem && cfg.reapprovalItem.length
            ? cfg.reapprovalItem
            : getDefaultItemFields(mode);

        if (hasSublistChanges(oldRec, newRec, 'item', itemFields)) {
            return true;
        }

        // Expense sublist fields
        const expenseFields = cfg.reapprovalExpense && cfg.reapprovalExpense.length
            ? cfg.reapprovalExpense
            : getDefaultExpenseFields(mode);

        if (hasSublistChanges(oldRec, newRec, 'expense', expenseFields)) {
            return true;
        }

        return false;
    }

    function getDefaultBodyFields(mode) {
        if (mode === 'any') {
            return ['entity', 'subsidiary', 'department', 'location', 'currency', 
                    'exchangerate', 'trandate', 'terms', 'memo', 'class'];
        }
        // Material mode - key financial fields only
        return ['entity', 'subsidiary', 'currency', 'exchangerate'];
    }

    function getDefaultItemFields(mode) {
        if (mode === 'any') {
            return ['item', 'quantity', 'rate', 'amount', 'department', 'location', 'class'];
        }
        return ['item', 'quantity', 'rate', 'amount'];
    }

    function getDefaultExpenseFields(mode) {
        if (mode === 'any') {
            return ['account', 'amount', 'memo', 'department', 'location', 'class'];
        }
        return ['account', 'amount'];
    }

    function hasSublistChanges(oldRec, newRec, sublistId, fieldIds) {
        const oldCount = oldRec.getLineCount({ sublistId: sublistId }) || 0;
        const newCount = newRec.getLineCount({ sublistId: sublistId }) || 0;

        if (oldCount !== newCount) {
            log.debug('Sublist line count changed', { sublist: sublistId, old: oldCount, new: newCount });
            return true;
        }

        for (let line = 0; line < newCount; line++) {
            for (let i = 0; i < fieldIds.length; i++) {
                const fieldId = fieldIds[i];
                const oldVal = oldRec.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: line });
                const newVal = newRec.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: line });
                
                if (valuesDiffer(oldVal, newVal)) {
                    log.debug('Sublist field changed', { sublist: sublistId, line: line, field: fieldId });
                    return true;
                }
            }
        }

        return false;
    }

    function valuesDiffer(oldVal, newVal) {
        // Handle numeric comparison
        if (isNumeric(oldVal) && isNumeric(newVal)) {
            return Number(oldVal) !== Number(newVal);
        }
        return normalize(oldVal) !== normalize(newVal);
    }

    function isNumeric(val) {
        if (val === null || val === undefined || val === '') return false;
        return !isNaN(Number(val));
    }

    function normalize(val) {
        if (val === null || val === undefined) return '';
        return String(val);
    }

    /**
     * Add action buttons based on current status
     */
    function addActionButtons(form, rec) {
        const status = rec.getValue(BF.APPROVAL_STATUS);
        const currentApprover = rec.getValue(BF.CURRENT_APPROVER);
        const currentUser = runtime.getCurrentUser().id;

        if (status === constants.APPROVAL_STATUS.DRAFT) {
            form.addButton({
                id: 'custpage_p2p_submit',
                label: 'Submit for Approval',
                functionName: 'submitForApproval'
            });
        }

        if (status === constants.APPROVAL_STATUS.PENDING_APPROVAL) {
            // Submitter can recall
            const createdBy = rec.getValue('createdby');
            if (String(currentUser) === String(createdBy)) {
                form.addButton({
                    id: 'custpage_p2p_recall',
                    label: 'Recall',
                    functionName: 'recallTransaction'
                });
            }

            // Approver can approve/reject
            if (String(currentApprover) === String(currentUser)) {
                form.addButton({
                    id: 'custpage_p2p_approve',
                    label: 'Approve',
                    functionName: 'approveTransaction'
                });
                form.addButton({
                    id: 'custpage_p2p_reject',
                    label: 'Reject',
                    functionName: 'rejectTransaction'
                });
            }
        }

        if (status === constants.APPROVAL_STATUS.REJECTED) {
            form.addButton({
                id: 'custpage_p2p_resubmit',
                label: 'Resubmit',
                functionName: 'resubmitForApproval'
            });
        }
    }

    /**
     * Build explainability HTML
     */
    function buildExplainHtml(rec) {
        const matchReason = rec.getValue(BF.MATCH_REASON) || '';
        const pathId = rec.getValue(BF.APPROVAL_PATH);
        const ruleId = rec.getValue(BF.MATCHED_RULE);
        const currentStep = rec.getValue(BF.CURRENT_STEP);
        const status = rec.getValue(BF.APPROVAL_STATUS);

        let html = '<div style="padding:10px; background:#f8f9fa; border-radius:4px; margin:10px 0;">';
        html += '<p style="margin:0 0 10px 0; font-weight:bold;">Approval Routing</p>';
        
        if (status === constants.APPROVAL_STATUS.APPROVED) {
            html += '<p style="color:#28a745; margin:0;">✓ Fully Approved</p>';
        } else if (status === constants.APPROVAL_STATUS.REJECTED) {
            html += '<p style="color:#dc3545; margin:0;">✗ Rejected</p>';
        } else if (status === constants.APPROVAL_STATUS.PENDING_APPROVAL) {
            html += '<p style="margin:0;">⏳ Pending Approval (Step ' + currentStep + ')</p>';
        }

        if (matchReason) {
            html += '<p style="margin:10px 0 0 0; font-size:12px; color:#666;">' + escapeHtml(matchReason) + '</p>';
        }

        html += '</div>';
        return html;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
