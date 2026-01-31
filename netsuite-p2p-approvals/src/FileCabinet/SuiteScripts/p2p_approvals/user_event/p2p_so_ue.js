/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Sales Order
 *
 * P2P Sales Order User Event
 */
define([
    'N/record', 'N/runtime', 'N/ui/serverWidget',
    '../lib/p2p_controller', '../lib/p2p_history_logger',
    '../constants/p2p_constants_v2'
], function(record, runtime, serverWidget, controller, historyLogger, constants) {
    'use strict';

    const BF = constants.BODY_FIELDS;

    function beforeLoad(context) {
        try {
            const form = context.form;
            const rec = context.newRecord;

            form.clientScriptModulePath = '../client/p2p_so_cs.js';

            if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
                addHistorySection(form, rec);
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
                rec.setValue({ fieldId: BF.APPROVAL_STATUS, value: constants.APPROVAL_STATUS.DRAFT });
                rec.setValue({ fieldId: BF.CURRENT_STEP, value: '' });
                rec.setValue({ fieldId: BF.CURRENT_APPROVER, value: '' });
                rec.setValue({ fieldId: BF.MATCHED_RULE, value: '' });
                rec.setValue({ fieldId: BF.APPROVAL_PATH, value: '' });
                rec.setValue({ fieldId: BF.MATCH_REASON, value: '' });
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

            const rec = record.load({ type: 'salesorder', id: context.newRecord.id });
            const status = rec.getValue(BF.APPROVAL_STATUS);

            if (status !== constants.APPROVAL_STATUS.DRAFT) {
                return;
            }

            const result = controller.handleSubmit({
                recordType: 'salesorder',
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
            if (!rec.id) return;

            var historyHtml = historyLogger.buildHistoryHtml(
                constants.TRANSACTION_TYPES.SALES_ORDER,
                rec.id
            );

            var matchReason = rec.getValue(BF.MATCH_REASON);
            var routingHtml = matchReason ? buildExplainHtml(rec) : '';

            var content = '<div>';
            if (routingHtml) {
                content += '<div style="margin-bottom: 20px;">' + routingHtml + '</div>';
            }
            content += historyHtml;
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

    function addActionButtons(form, rec) {
        const status = rec.getValue(BF.APPROVAL_STATUS);
        const statusStr = status != null ? String(status) : '';
        const currentApprover = rec.getValue(BF.CURRENT_APPROVER);
        const currentUser = runtime.getCurrentUser().id;

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
            const createdBy = rec.getValue('createdby');
            if (String(currentUser) === String(createdBy)) {
                form.addButton({
                    id: 'custpage_p2p_recall',
                    label: 'Recall',
                    functionName: 'recallTransaction'
                });
            }

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
