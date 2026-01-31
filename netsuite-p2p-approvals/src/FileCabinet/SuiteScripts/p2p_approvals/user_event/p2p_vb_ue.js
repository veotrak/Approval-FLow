/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * 
 * P2P Vendor Bill User Event (v2 - Decision Table Architecture)
 * Handles VB approval workflow initiation, 3-way matching, and UI buttons
 */
define([
    'N/record', 'N/runtime', 'N/ui/serverWidget',
    '../lib/p2p_controller',
    '../lib/p2p_history_logger',
    '../lib/p2p_matching_engine',
    '../constants/p2p_constants_v2'
], function(record, runtime, serverWidget, controller, historyLogger, matchingEngine, constants) {
    'use strict';

    const BF = constants.BODY_FIELDS;
    const STATUS = constants.APPROVAL_STATUS;
    const TRAN_TYPE = constants.TRANSACTION_TYPES.VENDOR_BILL;

    /**
     * Before Load - Add approval buttons and history display
     */
    function beforeLoad(context) {
        try {
            if (context.type !== context.UserEventType.VIEW && 
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            const form = context.form;
            const rec = context.newRecord;
            const currentUser = runtime.getCurrentUser().id;

            // Set client script
            form.clientScriptModulePath = '../client/p2p_vb_cs.js';

            // Add P2P Approval tab content: Match Status first (summary), then History
            addMatchStatusSection(form, rec);
            addHistorySection(form, rec);

            // Only add buttons in VIEW mode
            if (context.type !== context.UserEventType.VIEW) {
                return;
            }

            const status = rec.getValue(BF.APPROVAL_STATUS);
            const currentApprover = rec.getValue(BF.CURRENT_APPROVER);
            const matchStatus = rec.getValue(BF.MATCH_STATUS);

            // Submit button - show when Draft
            if (!status || status === STATUS.DRAFT || status === STATUS.PENDING_SUBMISSION) {
                form.addButton({
                    id: 'custpage_p2p_submit',
                    label: 'Submit for Approval',
                    functionName: 'submitForApproval'
                });

                // Recheck matching button
                form.addButton({
                    id: 'custpage_p2p_recheck',
                    label: 'Recheck Matching',
                    functionName: 'recheckMatching'
                });
            }

            // Approve/Reject buttons - show when Pending and user is approver
            if (status === STATUS.PENDING_APPROVAL && 
                String(currentApprover) === String(currentUser)) {
                
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

            // Exception override button - show when Pending Exception
            if (status === STATUS.PENDING_EXCEPTION && 
                String(currentApprover) === String(currentUser)) {
                
                form.addButton({
                    id: 'custpage_p2p_approve_exception',
                    label: 'Approve with Exception',
                    functionName: 'approveWithException'
                });
                form.addButton({
                    id: 'custpage_p2p_reject',
                    label: 'Reject',
                    functionName: 'rejectRecord'
                });
            }

            // Resubmit button - show when Rejected
            if (status === STATUS.REJECTED) {
                form.addButton({
                    id: 'custpage_p2p_resubmit',
                    label: 'Resubmit for Approval',
                    functionName: 'resubmitForApproval'
                });
            }

            // Recall button - show when Pending and user is submitter
            const submittedBy = rec.getValue(BF.SUBMITTED_BY) || rec.getValue('createdby') || rec.getValue('employee');
            if (status === STATUS.PENDING_APPROVAL && 
                submittedBy && String(submittedBy) === String(currentUser)) {
                
                form.addButton({
                    id: 'custpage_p2p_recall',
                    label: 'Recall',
                    functionName: 'recallSubmission'
                });
            }

        } catch (error) {
            log.error('beforeLoad error', error);
        }
    }

    /**
     * Add approval history section to form (in P2P Approval tab; tab created by addMatchStatusSection)
     */
    function addHistorySection(form, rec) {
        try {
            var historyHtml = historyLogger.buildHistoryHtml(TRAN_TYPE, rec.id);
            var tabId = 'custpage_p2p_approval_tab';

            var historyField = form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Approval History',
                container: tabId
            });
            historyField.defaultValue = historyHtml || '';
        } catch (error) {
            log.error('addHistorySection error', error);
        }
    }

    /**
     * Add match status section to form (in P2P Approval tab, above history)
     */
    function addMatchStatusSection(form, rec) {
        try {
            var tabId = 'custpage_p2p_approval_tab';
            form.addTab({ id: tabId, label: 'P2P Approval' });

            var matchStatus = rec.getValue(BF.MATCH_STATUS);
            var exceptionType = rec.getText(BF.EXCEPTION_TYPE) || rec.getValue(BF.EXCEPTION_TYPE);
            var riskFlags = rec.getValue(BF.AI_RISK_FLAGS);

            var statusColor = '#28a745';
            var statusText = 'Matched';

            if (matchStatus === constants.MATCH_STATUS.NOT_MATCHED) {
                statusColor = '#6c757d';
                statusText = 'Not Checked';
            } else if (matchStatus !== constants.MATCH_STATUS.MATCHED) {
                statusColor = '#dc3545';
                statusText = 'Exception';
            }

            var cardStyle = 'padding: 16px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px; margin-bottom: 20px;';
            var html = '<div style="' + cardStyle + '">';
            html += '<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; margin-bottom: 10px;">3-Way Match Status</div>';
            html += '<div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">';
            html += '<span style="padding: 8px 16px; background: ' + statusColor + '; color: white; border-radius: 6px; font-weight: 600; font-size: 13px;">' + statusText + '</span>';
            if (exceptionType) {
                html += '<span style="font-size: 13px; color: #495057;"><strong>Exception:</strong> ' + escapeHtml(exceptionType) + '</span>';
            }
            html += '</div>';
            if (riskFlags) {
                html += '<div style="margin-top: 12px; padding: 10px; background: #fff8e6; border-radius: 6px; font-size: 13px; color: #495057;">';
                html += '<strong>Risk Flags:</strong> ' + escapeHtml(riskFlags);
                html += '</div>';
            }
            html += '</div>';

            var matchField = form.addField({
                id: 'custpage_p2p_match_status',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Match Status',
                container: 'custpage_p2p_approval_tab'
            });
            matchField.defaultValue = html;
        } catch (error) {
            log.error('addMatchStatusSection error', error);
        }
    }

    /**
     * Helper to escape HTML
     */
    function escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Before Submit - Set initial status for new records
     */
    function beforeSubmit(context) {
        try {
            const rec = context.newRecord;

            if (context.type === context.UserEventType.CREATE) {
                // Reset P2P fields for new record (including copies) - start clean
                rec.setValue({ fieldId: BF.APPROVAL_STATUS, value: STATUS.DRAFT });
                rec.setValue({ fieldId: BF.CURRENT_STEP, value: '' });
                rec.setValue({ fieldId: BF.CURRENT_APPROVER, value: '' });
                rec.setValue({ fieldId: BF.MATCHED_RULE, value: '' });
                rec.setValue({ fieldId: BF.APPROVAL_PATH, value: '' });
                rec.setValue({ fieldId: BF.MATCH_REASON, value: '' });
                rec.setValue({ fieldId: BF.EXCEPTION_TYPE, value: '' });
                rec.setValue({ fieldId: BF.MATCH_STATUS, value: constants.MATCH_STATUS.NOT_MATCHED });
            }

        } catch (error) {
            log.error('beforeSubmit error', error);
        }
    }

    /**
     * After Submit - Perform matching and initiate approval if configured
     */
    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && 
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            const rec = record.load({ 
                type: record.Type.VENDOR_BILL, 
                id: context.newRecord.id 
            });
            
            const status = rec.getValue(BF.APPROVAL_STATUS);

            // Only process if status is Draft
            if (status && status !== STATUS.DRAFT && status !== STATUS.PENDING_SUBMISSION) {
                return;
            }

            // Perform 3-way matching
            const matchResult = matchingEngine.performMatchValidation({
                recordId: rec.id,
                record: rec
            });

            // Update match status on record
            const updateValues = {};
            updateValues[BF.MATCH_STATUS] = matchResult.status;
            
            if (matchResult.primaryException) {
                updateValues[BF.EXCEPTION_TYPE] = matchResult.primaryException;
            }

            // Add anomalies to risk flags
            if (matchResult.anomalies && matchResult.anomalies.length) {
                const existingFlags = rec.getValue(BF.AI_RISK_FLAGS) || '';
                const anomalyText = 'Anomalies: ' + matchResult.anomalies.join(', ');
                updateValues[BF.AI_RISK_FLAGS] = existingFlags 
                    ? existingFlags + ' | ' + anomalyText 
                    : anomalyText;
            }

            record.submitFields({
                type: record.Type.VENDOR_BILL,
                id: rec.id,
                values: updateValues
            });

            log.audit('VB matching complete', {
                id: rec.id,
                status: matchResult.status,
                exceptions: matchResult.exceptions
            });

        } catch (error) {
            log.error('afterSubmit error', error);
        }
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
