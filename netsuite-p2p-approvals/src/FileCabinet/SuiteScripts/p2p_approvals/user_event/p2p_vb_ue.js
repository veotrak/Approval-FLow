/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * 
 * P2P Vendor Bill User Event (v2 - Decision Table Architecture)
 * Handles VB approval workflow initiation, 3-way matching, and UI buttons
 */
define([
    'N/record', 'N/runtime', 'N/ui/serverWidget', 'N/search',
    '../lib/p2p_controller',
    '../lib/p2p_history_logger',
    '../lib/p2p_matching_engine',
    '../constants/p2p_constants_v2'
], function(record, runtime, serverWidget, search, controller, historyLogger, matchingEngine, constants) {
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
            if (status === STATUS.PENDING_EXCEPTION_REVIEW && 
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

            // Approval Routing summary at top (when matched), then history below
            var matchReason = rec.getValue(BF.MATCH_REASON);
            var routingHtml = '';
            if (matchReason) {
                routingHtml = buildExplainHtml(rec);
            }
            var pathHtml = buildPathSummaryHtml(rec);

            var wrapperStyle = 'margin: 0; padding: 0;';
            var content = '<div style="' + wrapperStyle + '">';
            if (routingHtml) {
                content += '<div style="margin-bottom: 20px;">' + routingHtml + '</div>';
            }
            if (pathHtml) {
                content += '<div style="margin-bottom: 20px;">' + pathHtml + '</div>';
            }
            content += '<div>' + historyHtml + '</div>';
            content += '</div>';

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
     * Build explainability HTML (routing summary)
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

    /**
     * Build approval chain HTML (full path steps)
     */
    function buildPathSummaryHtml(rec) {
        var pathId = rec.getValue(BF.APPROVAL_PATH);
        if (!pathId) return '';

        var steps = loadPathSteps(pathId);
        if (!steps.length) return '';

        var currentStep = rec.getValue(BF.CURRENT_STEP);
        var status = rec.getValue(BF.APPROVAL_STATUS);

        var cardStyle = 'padding: 16px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;';
        var thStyle = 'text-align: left; padding: 8px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; border-bottom: 1px solid #e9ecef;';
        var tdStyle = 'padding: 8px 6px; font-size: 13px; color: #212529; border-bottom: 1px solid #f1f3f5;';

        var html = '<div style="' + cardStyle + '">';
        html += '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px;">';
        html += '<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d;">Approval Chain</div>';
        html += '<div style="font-size: 12px; color: #495057;">' + buildChainHeader(steps, currentStep, status) + '</div>';
        html += '</div>';
        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<thead><tr>';
        html += '<th style="' + thStyle + ' width: 60px;">Step</th>';
        html += '<th style="' + thStyle + '">Approver</th>';
        html += '<th style="' + thStyle + ' width: 110px;">Mode</th>';
        html += '<th style="' + thStyle + ' width: 90px;">Status</th>';
        html += '</tr></thead><tbody>';

        steps.forEach(function(step, idx) {
            var isLast = idx === steps.length - 1;
            var rowTd = isLast ? tdStyle.replace('border-bottom: 1px solid #f1f3f5;', '') : tdStyle;
            var approverLabel = getApproverLabel(step);
            var modeLabel = getModeLabel(step);
            var stepStatus = getStepStatusLabel(step.sequence, currentStep, status);
            html += '<tr>';
            html += '<td style="' + rowTd + '">' + escapeHtml(step.sequence) + '</td>';
            html += '<td style="' + rowTd + '">' + escapeHtml(step.name) + ' — ' + escapeHtml(approverLabel) + '</td>';
            html += '<td style="' + rowTd + '">' + escapeHtml(modeLabel) + '</td>';
            html += '<td style="' + rowTd + '">' + escapeHtml(stepStatus) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function buildChainHeader(steps, currentStep, status) {
        if (!steps || !steps.length) return '';
        if (status === constants.APPROVAL_STATUS.APPROVED) {
            return '<strong>Current:</strong> Approved';
        }
        if (status === constants.APPROVAL_STATUS.REJECTED) {
            return '<strong>Current:</strong> Rejected';
        }

        var curSeq = parseInt(currentStep, 10);
        var current = null;
        var next = null;

        for (var i = 0; i < steps.length; i++) {
            var seq = parseInt(steps[i].sequence, 10);
            if (curSeq && seq === curSeq) {
                current = steps[i];
                if (i + 1 < steps.length) next = steps[i + 1];
                break;
            }
            if (!curSeq && !current) {
                current = steps[0];
                if (steps.length > 1) next = steps[1];
                break;
            }
        }

        if (!current) {
            current = steps[0];
            if (steps.length > 1) next = steps[1];
        }

        var currentLabel = current ? (current.name + ' — ' + getApproverLabel(current)) : '—';
        var nextLabel = next ? (next.name + ' — ' + getApproverLabel(next)) : '—';

        return '<strong>Current:</strong> ' + escapeHtml(currentLabel) + '&nbsp;&nbsp;<strong>Next:</strong> ' + escapeHtml(nextLabel);
    }

    function getStepStatusLabel(stepSeq, currentStep, status) {
        if (status === constants.APPROVAL_STATUS.APPROVED) return 'Approved';
        if (status === constants.APPROVAL_STATUS.REJECTED) return 'Rejected';
        if (!currentStep) return 'Pending';
        var seqNum = parseInt(stepSeq, 10);
        var curNum = parseInt(currentStep, 10);
        if (seqNum < curNum) return 'Done';
        if (seqNum === curNum) return 'Current';
        return 'Pending';
    }

    function getApproverLabel(step) {
        if (step.approverType === constants.APPROVER_TYPE.NAMED_PERSON && step.employeeText) {
            return step.employeeText;
        }
        if (step.approverType === constants.APPROVER_TYPE.ROLE && step.roleText) {
            return 'Role: ' + step.roleText;
        }
        return step.approverTypeText || 'Approver';
    }

    function getModeLabel(step) {
        if (step.modeText) return step.modeText;
        if (step.mode === constants.EXECUTION_MODE.SERIAL) return 'Serial';
        if (step.mode === constants.EXECUTION_MODE.PARALLEL) return 'Parallel';
        if (step.mode === constants.EXECUTION_MODE.PARALLEL_ANY) return 'Parallel Any';
        return '';
    }

    function loadPathSteps(pathId) {
        if (!pathId) return [];

        var SF = constants.STEP_FIELDS;
        var pathFieldIds = [SF.PATH, 'custrecord_ps_path'];
        var stepIds = [];

        for (var i = 0; i < pathFieldIds.length && stepIds.length === 0; i++) {
            try {
                var stepSearch = search.create({
                    type: constants.RECORD_TYPES.PATH_STEP,
                    filters: [[pathFieldIds[i], 'anyof', pathId]],
                    columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]
                });
                stepSearch.run().each(function(result) {
                    stepIds.push(result.id);
                    return true;
                });
            } catch (err) {
                log.debug('loadPathSteps', 'Search with ' + pathFieldIds[i] + ' failed: ' + err.message);
            }
        }

        if (!stepIds.length) return [];

        function getVal(rec, fid) {
            try { return rec.getValue(fid); } catch (e) { return null; }
        }
        function getText(rec, fid) {
            try { return rec.getText(fid); } catch (e) { return ''; }
        }

        var steps = [];
        for (var j = 0; j < stepIds.length; j++) {
            try {
                var stepRec = record.load({ type: constants.RECORD_TYPES.PATH_STEP, id: stepIds[j] });
                var isActive = getVal(stepRec, SF.ACTIVE);
                if (isActive === false || isActive === 'F' || isActive === '0') continue;

                var seq = getVal(stepRec, SF.SEQUENCE);
                steps.push({
                    id: stepIds[j],
                    sequence: seq !== null && seq !== undefined ? parseInt(String(seq), 10) : (j + 1),
                    name: getVal(stepRec, SF.NAME) || 'Step ' + (j + 1),
                    approverType: getVal(stepRec, SF.APPROVER_TYPE),
                    approverTypeText: getText(stepRec, SF.APPROVER_TYPE),
                    roleText: getText(stepRec, SF.ROLE),
                    employeeText: getText(stepRec, SF.EMPLOYEE),
                    mode: getVal(stepRec, SF.MODE),
                    modeText: getText(stepRec, SF.MODE)
                });
            } catch (err) {
                log.warning('loadPathSteps', 'Failed to load step ' + stepIds[j] + ': ' + err.message);
            }
        }

        steps.sort(function(a, b) { return a.sequence - b.sequence; });
        return steps;
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
