/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * P2P Bulk Approval Suitelet (v2 - Decision Table Architecture)
 * Allows approvers to process multiple pending approvals at once
 */
define([
    'N/ui/serverWidget', 'N/search', 'N/runtime', 'N/record', 'N/format', 'N/task', 'N/url',
    '../lib/p2p_controller',
    '../lib/p2p_config',
    '../constants/p2p_constants_v2'
], function(serverWidget, search, runtime, record, format, task, url, controller, config, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;
    const STATUS = constants.TASK_STATUS;
    const ACTION = constants.APPROVAL_ACTION;
    const METHOD = constants.APPROVAL_METHOD;

    /**
     * Main request handler
     */
    function onRequest(context) {
        const req = context.request;
        if (req.method === 'GET') {
            return showPendingApprovals(context);
        }
        if (req.method === 'POST') {
            return processBulkApprovals(context);
        }
    }

    const ADMIN_ROLE = '3';

    /**
     * Show pending approvals for current user (or all if admin)
     */
    function showPendingApprovals(context) {
        const currentUser = runtime.getCurrentUser().id;
        const isAdmin = String(runtime.getCurrentUser().role) === ADMIN_ROLE;
        const form = serverWidget.createForm({ 
            title: 'P2P Bulk Approvals' + (isAdmin ? ' (Admin - All Tasks)' : '')
        });
        // Add action selector
        const actionField = form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.SELECT,
            label: 'Action'
        });
        actionField.addSelectOption({ value: '', text: '-- Select Action --' });
        actionField.addSelectOption({ value: 'approve', text: 'Approve Selected' });
        actionField.addSelectOption({ value: 'reject', text: 'Reject Selected' });
        actionField.isMandatory = true;

        // Add comment field
        form.addField({
            id: 'custpage_comment',
            type: serverWidget.FieldType.TEXTAREA,
            label: 'Comment (Required for Rejection)'
        });

        // Create sublist for pending tasks
        const sublist = form.addSublist({
            id: 'custpage_tasks',
            type: serverWidget.SublistType.LIST,
            label: 'Pending Approvals'
        });

        // Add sublist columns
        sublist.addField({ id: 'select', type: serverWidget.FieldType.CHECKBOX, label: 'Select' });
        sublist.addMarkAllButtons();
        sublist.addField({ id: 'taskid', type: serverWidget.FieldType.TEXT, label: 'Task ID' });
        sublist.addField({ id: 'trantype', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'tranlink', type: serverWidget.FieldType.TEXT, label: 'Tran #' });
        sublist.addField({ id: 'entity', type: serverWidget.FieldType.TEXT, label: 'Vendor/Entity' });
        sublist.addField({ id: 'amount', type: serverWidget.FieldType.CURRENCY, label: 'Amount' });
        sublist.addField({ id: 'trandate', type: serverWidget.FieldType.TEXT, label: 'Date' });
        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'approvalpath', type: serverWidget.FieldType.TEXT, label: 'Approval Path' });
        sublist.addField({ id: 'stepname', type: serverWidget.FieldType.TEXT, label: 'Step Name' });
        sublist.addField({ id: 'requestor', type: serverWidget.FieldType.TEXT, label: 'Requestor' });
        sublist.addField({ id: 'step', type: serverWidget.FieldType.INTEGER, label: 'Step' });
        sublist.addField({ id: 'age', type: serverWidget.FieldType.TEXT, label: 'Age' });
        sublist.addField({ id: 'riskflags', type: serverWidget.FieldType.TEXT, label: 'Risk Flags' });

        // Search for pending tasks (admins see all, others see only their own)
        var filters = [
            [TF.STATUS, 'anyof', STATUS.PENDING]
        ];
        if (!isAdmin) {
            filters.push('and');
            filters.push([
                [TF.APPROVER, 'anyof', currentUser],
                'or',
                [TF.ACTING_APPROVER, 'anyof', currentUser]
            ]);
        }
        const taskSearch = search.create({
            type: RT.APPROVAL_TASK,
            filters: filters,
            columns: [
                'internalid',
                TF.TRAN_TYPE,
                TF.TRAN_ID,
                TF.SEQUENCE,
                TF.CREATED,
                TF.APPROVER,
                TF.ACTING_APPROVER
            ]
        });

        const pathStepCache = {};
        let line = 0;
        taskSearch.run().each(function(result) {
            const taskId = result.getValue('internalid');
            const tranType = result.getValue(TF.TRAN_TYPE);
            const tranId = result.getValue(TF.TRAN_ID);
            const sequence = result.getValue(TF.SEQUENCE);
            const created = result.getValue(TF.CREATED);

            // Skip tasks whose transaction was deleted; cancel orphaned task so it won't reappear
            var recordType = getRecordTypeFromTranType(tranType);
            if (recordType && tranId) {
                try {
                    record.load({ type: recordType, id: tranId });
                } catch (e) {
                    try {
                        record.submitFields({
                            type: RT.APPROVAL_TASK,
                            id: taskId,
                            values: { [TF.STATUS]: STATUS.CANCELLED }
                        });
                    } catch (cancelErr) { /* ignore */ }
                    return true; // Skip this task, continue to next
                }
            }

            // Approver: acting approver or original approver (getText for employee name)
            var approverText = result.getText({ name: TF.ACTING_APPROVER }) || result.getText({ name: TF.APPROVER }) || '';

            // Path and step: load task to get path/step IDs (PATH and PATH_STEP may be invalid search columns in some deployments)
            var pathId = null;
            var pathStepId = null;
            var pathName = '';
            var stepName = '';
            try {
                var taskRec = record.load({ type: RT.APPROVAL_TASK, id: taskId });
                pathId = taskRec.getValue(TF.PATH);
                pathStepId = taskRec.getValue(TF.PATH_STEP);
            } catch (e) { /* ignore */ }
            if (!pathName && pathId) {
                var cachedPath = pathStepCache['path_' + pathId];
                if (cachedPath !== undefined) {
                    pathName = cachedPath;
                } else {
                    try {
                        var pathRec = record.load({ type: RT.APPROVAL_PATH, id: pathId });
                        pathName = pathRec.getValue(constants.PATH_FIELDS.CODE) || pathRec.getValue(constants.PATH_FIELDS.DESCRIPTION) || String(pathId);
                        pathStepCache['path_' + pathId] = pathName;
                    } catch (e) {
                        pathStepCache['path_' + pathId] = '';
                        pathName = '';
                    }
                }
            }
            if (!stepName && pathStepId) {
                var cachedStep = pathStepCache['step_' + pathStepId];
                if (cachedStep !== undefined) {
                    stepName = cachedStep;
                } else {
                    try {
                        var stepRec = record.load({ type: RT.PATH_STEP, id: pathStepId });
                        stepName = stepRec.getValue(constants.STEP_FIELDS.NAME) || ('Step ' + (sequence || ''));
                        pathStepCache['step_' + pathStepId] = stepName;
                    } catch (e) {
                        pathStepCache['step_' + pathStepId] = '';
                        stepName = '';
                    }
                }
            }

            // Get transaction details
            const tranDetails = getTransactionDetails(tranType, tranId);

            // Calculate age
            const ageText = calculateAge(created);

            // Build link URL to PO/VB record (URL field renders as clickable link)
            var linkUrl = '';
            try {
                var recordType = getRecordTypeFromTranType(tranType);
                if (recordType && tranId) {
                    linkUrl = url.resolveRecord({
                        recordType: recordType,
                        recordId: tranId,
                        isEditMode: false
                    });
                }
            } catch (e) { /* ignore */ }

            var td = tranDetails || {};
            function setVal(fid, val) {
                var v = (val === undefined || val === null) ? '' : String(val);
                sublist.setSublistValue({ id: fid, line: line, value: v });
            }
            try {
                var tranNum = td.tranNum || tranId || '';
                var tranLinkVal = linkUrl
                    ? '<a href="' + escapeHtml(linkUrl) + '" target="_blank">' + escapeHtml(tranNum) + '</a>'
                    : tranNum;
                setVal('taskid', String(taskId));
                setVal('trantype', td.typeLabel);
                setVal('tranlink', tranLinkVal);
                setVal('entity', td.entity);
                setVal('amount', (td.amount != null && td.amount !== '') ? String(parseFloat(td.amount) || 0) : '0');
                setVal('trandate', td.date);
                setVal('approver', approverText);
                setVal('approvalpath', pathName);
                setVal('stepname', stepName);
                setVal('requestor', td.requestor || '');
                setVal('step', String(sequence || 1));
                setVal('age', ageText);
                setVal('riskflags', td.riskFlags);
            } catch (e) {
                log.error('BulkApproval setSublistValue', 'Line ' + line + ': ' + e.message);
            }

            line++;
            return line < 200; // Limit to 200 records
        });

        // Add summary
        form.addField({
            id: 'custpage_summary',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<div style="margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px;">' +
            '<strong>Total Pending:</strong> ' + line + ' task(s)' +
            '</div>';

        form.addSubmitButton({ id: 'custpage_submit', label: 'Process Selected' });

        form.clientScriptModulePath = 'SuiteScripts/p2p_approvals/client/p2p_bulk_approval_cs';

        context.response.writePage(form);
    }

    /**
     * Process bulk approvals
     */
    function processBulkApprovals(context) {
        const request = context.request;
        const action = normalizeAction(request.parameters.custpage_action);
        const comment = (request.parameters.custpage_comment || '').trim();
        const lineCount = request.getLineCount({ group: 'custpage_tasks' }) || 0;

        // Validation
        if (!action) {
            return showResultPage(context, 'Please select an action (Approve or Reject).', false);
        }

        if (action === 'reject' && !comment) {
            return showResultPage(context, 'A comment is required when rejecting. Please go back and enter a comment before rejecting.', false);
        }

        // Get config for limits
        const globalConfig = config.getConfig();
        const bulkLimit = globalConfig.bulkApprovalLimit || 50;
        const governanceThreshold = 200;

        // Count selected
        let selectedCount = 0;
        for (let i = 0; i < lineCount; i++) {
            const selected = request.getSublistValue({
                group: 'custpage_tasks',
                name: 'select',
                line: i
            });
            if (selected === 'T') {
                selectedCount++;
            }
        }

        if (selectedCount === 0) {
            return showResultPage(context, 'Please select at least one task to process.', false);
        }

        if (selectedCount > bulkLimit) {
            return showResultPage(context, 'Too many selections. Maximum is ' + bulkLimit + ' tasks per batch.', false);
        }

        // Process approvals
        let processed = 0;
        let errors = 0;
        const errorMessages = [];

        for (let i = 0; i < lineCount; i++) {
            // Check governance
            if (runtime.getCurrentScript().getRemainingUsage() < governanceThreshold) {
                errorMessages.push('Stopped early due to governance limits.');
                break;
            }

            const selected = request.getSublistValue({
                group: 'custpage_tasks',
                name: 'select',
                line: i
            });

            if (selected !== 'T') {
                continue;
            }

            const taskId = request.getSublistValue({
                group: 'custpage_tasks',
                name: 'taskid',
                line: i
            });

            try {
                const result = action === 'approve' 
                    ? controller.handleApprove({ taskId: taskId, comment: comment, method: METHOD.BULK })
                    : controller.handleReject({ taskId: taskId, comment: comment, method: METHOD.BULK });

                if (result.success) {
                    processed++;
                } else {
                    errors++;
                    errorMessages.push('Task ' + taskId + ': ' + (result.message || 'Unknown error'));
                }
            } catch (error) {
                errors++;
                errorMessages.push('Task ' + taskId + ': ' + error.message);
            }
        }

        // Build result message
        let message = 'Processed ' + processed + ' task(s).';
        if (errors > 0) {
            message += ' ' + errors + ' error(s) occurred.';
        }
        if (errorMessages.length > 0) {
            message += '\n\nDetails:\n' + errorMessages.slice(0, 5).join('\n');
            if (errorMessages.length > 5) {
                message += '\n... and ' + (errorMessages.length - 5) + ' more';
            }
        }

        return showResultPage(context, message, processed > 0);
    }

    /**
     * Get transaction details for display
     */
    function getTransactionDetails(tranType, tranId) {
        const details = {
            typeLabel: getTypeLabel(tranType),
            tranNum: '',
            entity: '',
            amount: '',
            date: '',
            riskFlags: '',
            requestor: ''
        };

        try {
            const recordType = getRecordTypeFromTranType(tranType);
            if (!recordType || !tranId) return details;

            const tran = record.load({ type: recordType, id: tranId });
            details.tranNum = tran.getValue('tranid') || '';
            details.entity = tran.getText('entity') || '';
            details.amount = tran.getValue('total') || '';
            details.date = tran.getText('trandate') || '';
            details.riskFlags = tran.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS) || '';
            details.requestor = tran.getText('employee') || tran.getText('requestor') || tran.getText('createdby') || '';

            // Truncate risk flags for display
            if (details.riskFlags && details.riskFlags.length > 50) {
                details.riskFlags = details.riskFlags.substring(0, 47) + '...';
            }
        } catch (error) {
            // Ignore errors, return partial details
        }

        return details;
    }

    /**
     * Calculate age text from created date
     */
    function calculateAge(createdStr) {
        if (!createdStr) return '';

        try {
            var created = new Date(createdStr);
            if (isNaN(created.getTime()) && typeof createdStr === 'string') {
                try { created = format.parse({ value: createdStr, type: format.Type.DATETIME }); } catch (e) {}
            }
            if (!created || isNaN(created.getTime())) return '';
            const now = new Date();
            const diffMs = now - created;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            if (isNaN(diffHours) || diffHours < 0) return '';

            if (diffHours < 1) return '< 1 hour';
            if (diffHours < 24) return diffHours + ' hours';

            const diffDays = Math.floor(diffHours / 24);
            if (diffDays === 1) return '1 day';
            return diffDays + ' days';
        } catch (e) {
            return '';
        }
    }

    /**
     * Show result page
     */
    function showResultPage(context, message, success) {
        const form = serverWidget.createForm({ title: 'Bulk Approval Results' });

        const color = success !== false ? '#4CAF50' : '#D32F2F';
        const icon = success !== false ? '✓' : '✗';
        const heading = success !== false ? 'Processing Complete' : 'Action Required';

        let html = '<div style="padding: 40px; text-align: center;">';
        html += '<div style="font-size: 48px; color: ' + color + ';">' + icon + '</div>';
        html += '<h2 style="color: ' + color + ';">' + heading + '</h2>';
        html += '<p style="white-space: pre-wrap;">' + escapeHtml(message) + '</p>';
        html += '<p style="margin-top: 20px;"><a href="' + getReturnUrl() + '">Return to Bulk Approvals</a></p>';
        html += '</div>';

        form.addField({
            id: 'custpage_result',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;

        context.response.writePage(form);
    }

    /**
     * Get URL to return to bulk approvals (base URL for redirects)
     */
    function getBulkApprovalUrl() {
        return '/app/site/hosting/scriptlet.nl?script=customscript_p2p_bulk_approval_sl&deploy=customdeploy_p2p_bulk_approval';
    }

    /**
     * Alias for getBulkApprovalUrl (used by showResultPage)
     */
    function getReturnUrl() {
        return getBulkApprovalUrl();
    }

    /**
     * Normalize action string
     */
    function normalizeAction(value) {
        const action = (value || '').toLowerCase().trim();
        if (action === 'approve') return 'approve';
        if (action === 'reject') return 'reject';
        return null;
    }

    /**
     * Get type label
     */
    function getTypeLabel(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) return 'PO';
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) return 'VB';
        return tranType;
    }

    /**
     * Get record type from transaction type
     */
    function getRecordTypeFromTranType(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) return 'purchaseorder';
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) return 'vendorbill';
        return tranType;
    }

    /**
     * Escape HTML
     */
    function escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return { onRequest: onRequest };
});
