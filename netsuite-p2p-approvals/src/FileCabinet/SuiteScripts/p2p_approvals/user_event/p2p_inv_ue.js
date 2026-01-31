/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Invoice (Customer Invoice)
 *
 * P2P Invoice User Event
 */
define([
    'N/record', 'N/runtime', 'N/ui/serverWidget', 'N/search', 'N/format',
    '../lib/p2p_controller', '../lib/p2p_history_logger',
    '../constants/p2p_constants_v2'
], function(record, runtime, serverWidget, search, format, controller, historyLogger, constants) {
    'use strict';

    const BF = constants.BODY_FIELDS;
    const DETAILS_SUBTAB_ID = 'custom1904';

    function beforeLoad(context) {
        try {
            const form = context.form;
            const rec = context.newRecord;

            form.clientScriptModulePath = '../client/p2p_inv_cs.js';

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

            const rec = record.load({ type: 'invoice', id: context.newRecord.id });
            const status = rec.getValue(BF.APPROVAL_STATUS);

            if (status !== constants.APPROVAL_STATUS.DRAFT) {
                return;
            }

            const result = controller.handleSubmit({
                recordType: 'invoice',
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
                constants.TRANSACTION_TYPES.INVOICE,
                rec.id
            );

            var matchReason = rec.getValue(BF.MATCH_REASON);
            var routingHtml = matchReason ? buildExplainHtml(rec) : '';
            var pathHtml = buildPathSummaryHtml(rec);

            var content = '<div>';
            if (routingHtml) {
                content += '<div style="margin-bottom: 20px;">' + routingHtml + '</div>';
            }
            if (pathHtml) {
                content += '<div style="margin-bottom: 20px;">' + pathHtml + '</div>';
            }
            content += historyHtml;
            content += '</div>';

            var historyField = form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Approval History',
                container: DETAILS_SUBTAB_ID
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
        var header = '<strong>Current:</strong> ' + escapeHtml(currentLabel) + '&nbsp;&nbsp;<strong>Next:</strong> ' + escapeHtml(nextLabel);
        var slaSummary = buildSlaSummary(steps, currentStep, status);
        if (slaSummary) {
            header += '&nbsp;&nbsp;<span style="color: #6c757d;">' + escapeHtml(slaSummary) + '</span>';
        }
        return header;
    }

    function buildSlaSummary(steps, currentStep, status) {
        if (!steps || !steps.length) return '';
        if (status === constants.APPROVAL_STATUS.APPROVED || status === constants.APPROVAL_STATUS.REJECTED) {
            return '';
        }

        var curSeq = parseInt(currentStep, 10);
        var currentIndex = 0;
        for (var i = 0; i < steps.length; i++) {
            var seq = parseInt(steps[i].sequence, 10);
            if (curSeq && seq === curSeq) {
                currentIndex = i;
                break;
            }
        }

        var total = 0;
        var hasAny = false;
        var currentSla = null;
        for (var j = currentIndex; j < steps.length; j++) {
            var sla = steps[j].slaHours;
            if (sla !== null && sla !== undefined && !isNaN(parseInt(sla, 10))) {
                var hrs = parseInt(sla, 10);
                total += hrs;
                hasAny = true;
                if (j === currentIndex) {
                    currentSla = hrs;
                }
            }
        }

        if (!hasAny) return '';

        var parts = [];
        if (currentSla !== null) parts.push('Current SLA: ' + currentSla + 'h');
        if (total) parts.push('SLA remaining: ' + total + 'h');
        if (total) {
            var eta = new Date();
            eta.setHours(eta.getHours() + total);
            try {
                parts.push('Est. completion: ' + format.format({ value: eta, type: format.Type.DATETIME }));
            } catch (e) {
                parts.push('Est. completion: ' + eta.toISOString());
            }
        }
        return parts.join(' | ');
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
                var slaVal = getVal(stepRec, SF.SLA_HOURS);
                steps.push({
                    id: stepIds[j],
                    sequence: seq !== null && seq !== undefined ? parseInt(String(seq), 10) : (j + 1),
                    name: getVal(stepRec, SF.NAME) || 'Step ' + (j + 1),
                    approverType: getVal(stepRec, SF.APPROVER_TYPE),
                    approverTypeText: getText(stepRec, SF.APPROVER_TYPE),
                    roleText: getText(stepRec, SF.ROLE),
                    employeeText: getText(stepRec, SF.EMPLOYEE),
                    mode: getVal(stepRec, SF.MODE),
                    modeText: getText(stepRec, SF.MODE),
                    slaHours: slaVal !== null && slaVal !== undefined ? parseInt(String(slaVal), 10) : null
                });
            } catch (err) {
                log.warning('loadPathSteps', 'Failed to load step ' + stepIds[j] + ': ' + err.message);
            }
        }

        steps.sort(function(a, b) { return a.sequence - b.sequence; });
        return steps;
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
