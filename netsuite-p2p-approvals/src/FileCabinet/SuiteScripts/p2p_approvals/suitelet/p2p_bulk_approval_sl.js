/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * P2P Bulk Approval Suitelet (v2 - Decision Table Architecture)
 * Allows approvers to process multiple pending approvals at once
 */
define([
    'N/ui/serverWidget', 'N/search', 'N/runtime', 'N/record', 'N/task',
    '../lib/p2p_controller',
    '../lib/p2p_config',
    '../constants/p2p_constants_v2'
], function(serverWidget, search, runtime, record, task, controller, config, constants) {
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
        if (context.request.method === 'GET') {
            return showPendingApprovals(context);
        }

        if (context.request.method === 'POST') {
            return processBulkApprovals(context);
        }
    }

    /**
     * Show pending approvals for current user
     */
    function showPendingApprovals(context) {
        const currentUser = runtime.getCurrentUser().id;
        const form = serverWidget.createForm({ 
            title: 'P2P Bulk Approvals'
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
        sublist.addField({ id: 'taskid', type: serverWidget.FieldType.TEXT, label: 'Task ID' });
        sublist.addField({ id: 'trantype', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'tranid', type: serverWidget.FieldType.TEXT, label: 'Tran #' });
        sublist.addField({ id: 'entity', type: serverWidget.FieldType.TEXT, label: 'Vendor/Entity' });
        sublist.addField({ id: 'amount', type: serverWidget.FieldType.CURRENCY, label: 'Amount' });
        sublist.addField({ id: 'trandate', type: serverWidget.FieldType.TEXT, label: 'Date' });
        sublist.addField({ id: 'step', type: serverWidget.FieldType.INTEGER, label: 'Step' });
        sublist.addField({ id: 'age', type: serverWidget.FieldType.TEXT, label: 'Age' });
        sublist.addField({ id: 'riskflags', type: serverWidget.FieldType.TEXT, label: 'Risk Flags' });

        // Search for pending tasks
        const taskSearch = search.create({
            type: RT.APPROVAL_TASK,
            filters: [
                [TF.STATUS, 'anyof', STATUS.PENDING],
                'and',
                [
                    [TF.APPROVER, 'anyof', currentUser],
                    'or',
                    [TF.ACTING_APPROVER, 'anyof', currentUser]
                ]
            ],
            columns: [
                'internalid',
                TF.TRAN_TYPE,
                TF.TRAN_ID,
                TF.SEQUENCE,
                TF.CREATED,
                TF.PATH
            ]
        });

        let line = 0;
        taskSearch.run().each(function(result) {
            const taskId = result.getValue('internalid');
            const tranType = result.getValue(TF.TRAN_TYPE);
            const tranId = result.getValue(TF.TRAN_ID);
            const sequence = result.getValue(TF.SEQUENCE);
            const created = result.getValue(TF.CREATED);

            // Get transaction details
            const tranDetails = getTransactionDetails(tranType, tranId);

            // Calculate age
            const ageText = calculateAge(created);

            sublist.setSublistValue({ id: 'taskid', line: line, value: String(taskId) });
            sublist.setSublistValue({ id: 'trantype', line: line, value: tranDetails.typeLabel || '' });
            sublist.setSublistValue({ id: 'tranid', line: line, value: tranDetails.tranNum || String(tranId) });
            sublist.setSublistValue({ id: 'entity', line: line, value: tranDetails.entity || '' });
            sublist.setSublistValue({ id: 'amount', line: line, value: tranDetails.amount || '0' });
            sublist.setSublistValue({ id: 'trandate', line: line, value: tranDetails.date || '' });
            sublist.setSublistValue({ id: 'step', line: line, value: String(sequence || 1) });
            sublist.setSublistValue({ id: 'age', line: line, value: ageText });
            sublist.setSublistValue({ id: 'riskflags', line: line, value: tranDetails.riskFlags || '' });

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

        // Add buttons
        form.addSubmitButton({ label: 'Process Selected' });
        form.addButton({
            id: 'custpage_select_all',
            label: 'Select All',
            functionName: 'selectAll'
        });
        form.addButton({
            id: 'custpage_clear_all',
            label: 'Clear All',
            functionName: 'clearAll'
        });

        // Add client script for select all/clear all
        form.clientScriptModulePath = './p2p_bulk_approval_cs.js';

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
            return showResultPage(context, 'Please select an action (Approve or Reject).');
        }

        if (action === 'reject' && !comment) {
            return showResultPage(context, 'A comment is required when rejecting.');
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
            return showResultPage(context, 'Please select at least one task to process.');
        }

        if (selectedCount > bulkLimit) {
            return showResultPage(context, 'Too many selections. Maximum is ' + bulkLimit + ' tasks per batch.');
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
            riskFlags: ''
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
            const created = new Date(createdStr);
            const now = new Date();
            const diffMs = now - created;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

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

        const color = success !== false ? '#4CAF50' : '#FF9800';
        const icon = success !== false ? '✓' : '⚠';

        let html = '<div style="padding: 40px; text-align: center;">';
        html += '<div style="font-size: 48px; color: ' + color + ';">' + icon + '</div>';
        html += '<h2 style="color: ' + color + ';">Processing Complete</h2>';
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
     * Get URL to return to bulk approvals
     */
    function getReturnUrl() {
        return '/app/site/hosting/scriptlet.nl?script=customscript_p2p_bulk_approval_sl&deploy=customdeploy_p2p_bulk_approval';
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
