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

            form.clientScriptModulePath = '../client/p2p_po_cs.js';

            if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
                addHistorySection(form, rec);
            }

            // Rule explanation is now included in addHistorySection (Approval Routing block)

            // Add action buttons on both VIEW and EDIT so Submit/Recall/Approve/Reject are visible
            if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
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
                // Reset P2P fields for new record (including copies) - start clean
                rec.setValue({ fieldId: BF.APPROVAL_STATUS, value: constants.APPROVAL_STATUS.DRAFT });
                rec.setValue({ fieldId: BF.CURRENT_STEP, value: '' });
                rec.setValue({ fieldId: BF.CURRENT_APPROVER, value: '' });
                rec.setValue({ fieldId: BF.MATCHED_RULE, value: '' });
                rec.setValue({ fieldId: BF.APPROVAL_PATH, value: '' });
                rec.setValue({ fieldId: BF.MATCH_REASON, value: '' });
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

            // Avoid auto-routing on UI saves; submit/resubmit uses RESTlet actions.
            if (runtime.executionContext === runtime.ContextType.USER_INTERFACE) {
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

    function addHistorySection(form, rec) {
        try {
            if (!rec.id) {
                return;
            }

            var historyHtml = historyLogger.buildHistoryHtml(
                constants.TRANSACTION_TYPES.PURCHASE_ORDER,
                rec.id
            );

            // Approval Routing summary at top (when matched), then history below
            var matchReason = rec.getValue(BF.MATCH_REASON);
            var routingHtml = '';
            if (matchReason) {
                routingHtml = buildExplainHtml(rec);
            }

            var wrapperStyle = 'margin: 0; padding: 0;';
            var content = '<div style="' + wrapperStyle + '">';
            if (routingHtml) {
                content += '<div style="margin-bottom: 20px;">' + routingHtml + '</div>';
            }
            content += '<div style="margin-top: ' + (routingHtml ? '0' : '0') + ';">' + historyHtml + '</div>';
            content += '</div>';

            var tabId = 'custpage_p2p_approval_tab';
            form.addTab({ id: tabId, label: 'P2P Approval' });

            var historyField = form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Approval History',
                container: tabId
            });
            historyField.defaultValue = content || '';
        } catch (error) {
            log.error('addHistorySection error', error);
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
        const raw = cfg.reapprovalMode || 'material';
        const mode = (raw === '2' || raw === 2 || raw === 'any') ? 'any' : 'material';
        
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
        if (mode === 'any') {  // ID 2 in P2P Reapproval Mode list
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

        const oldSignatures = [];
        const newSignatures = [];

        for (let line = 0; line < oldCount; line++) {
            oldSignatures.push(buildLineSignature(oldRec, sublistId, line, fieldIds));
        }

        for (let line = 0; line < newCount; line++) {
            newSignatures.push(buildLineSignature(newRec, sublistId, line, fieldIds));
        }

        oldSignatures.sort();
        newSignatures.sort();

        for (let i = 0; i < oldSignatures.length; i++) {
            if (oldSignatures[i] !== newSignatures[i]) {
                log.debug('Sublist lines changed', { sublist: sublistId });
                return true;
            }
        }

        return false;
    }

    function valuesDiffer(oldVal, newVal) {
        return normalizeValueForCompare(oldVal) !== normalizeValueForCompare(newVal);
    }

    function buildLineSignature(rec, sublistId, line, fieldIds) {
        const values = fieldIds.map(function(fieldId) {
            const value = rec.getSublistValue({ sublistId: sublistId, fieldId: fieldId, line: line });
            return normalizeValueForCompare(value);
        });
        return JSON.stringify(values);
    }

    function isNumeric(val) {
        if (val === null || val === undefined || val === '') return false;
        return !isNaN(Number(val));
    }

    function normalizeValueForCompare(val) {
        if (val === null || val === undefined) return '';
        if (isNumeric(val)) return String(Number(val));
        return String(val);
    }

    /**
     * Add action buttons based on current status
     */
    function addActionButtons(form, rec) {
        const status = rec.getValue(BF.APPROVAL_STATUS);
        const statusStr = status != null ? String(status) : '';
        const currentApprover = rec.getValue(BF.CURRENT_APPROVER);
        const currentUser = runtime.getCurrentUser().id;

        // Submit: Draft (1), Pending Submission (2), or empty/not set
        const canSubmit = statusStr === constants.APPROVAL_STATUS.DRAFT
            || statusStr === constants.APPROVAL_STATUS.PENDING_SUBMISSION
            || statusStr === '';
        if (canSubmit) {
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
        var currentStep = rec.getValue(BF.CURRENT_STEP);
        var status = rec.getValue(BF.APPROVAL_STATUS);
        var matchReason = rec.getValue(BF.MATCH_REASON) || '';

        var cardStyle = 'padding: 16px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;';
        var html = '<div style="' + cardStyle + '">';
        html += '<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; margin-bottom: 8px;">Approval Routing</div>';

        if (status === constants.APPROVAL_STATUS.APPROVED) {
            html += '<div style="color: #28a745; font-weight: 600; font-size: 14px;">✓ Fully Approved</div>';
        } else if (status === constants.APPROVAL_STATUS.REJECTED) {
            html += '<div style="color: #dc3545; font-weight: 600; font-size: 14px;">✗ Rejected</div>';
        } else if (status === constants.APPROVAL_STATUS.PENDING_APPROVAL) {
            html += '<div style="color: #0d6efd; font-weight: 600; font-size: 14px;">⏳ Pending Approval (Step ' + escapeHtml(currentStep) + ')</div>';
        }

        if (matchReason) {
            html += '<div style="margin-top: 10px; font-size: 13px; color: #495057; line-height: 1.4;">' + escapeHtml(matchReason) + '</div>';
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
