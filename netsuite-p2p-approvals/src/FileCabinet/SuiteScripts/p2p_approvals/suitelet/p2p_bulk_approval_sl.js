/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/runtime',
        '../lib/p2p_approval_engine', '../constants/p2p_constants'
], function(serverWidget, search, runtime, approvalEngine, constants) {
    'use strict';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            return showPendingApprovals(context);
        }

        if (context.request.method === 'POST') {
            return processBulkApprovals(context);
        }
    }

    function showPendingApprovals(context) {
        const currentUser = runtime.getCurrentUser().id;
        const form = serverWidget.createForm({ title: 'P2P Bulk Approvals' });

        const actionField = form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.SELECT,
            label: 'Action'
        });
        actionField.addSelectOption({ value: 'approve', text: 'Approve' });
        actionField.addSelectOption({ value: 'reject', text: 'Reject' });

        form.addField({
            id: 'custpage_comment',
            type: serverWidget.FieldType.TEXTAREA,
            label: 'Comment'
        });

        const sublist = form.addSublist({
            id: 'custpage_tasks',
            type: serverWidget.SublistType.LIST,
            label: 'Pending Tasks'
        });
        sublist.addField({ id: 'select', type: serverWidget.FieldType.CHECKBOX, label: 'Select' });
        sublist.addField({ id: 'taskid', type: serverWidget.FieldType.TEXT, label: 'Task ID' });
        sublist.addField({ id: 'trantype', type: serverWidget.FieldType.TEXT, label: 'Transaction Type' });
        sublist.addField({ id: 'tranid', type: serverWidget.FieldType.TEXT, label: 'Transaction ID' });
        sublist.addField({ id: 'sequence', type: serverWidget.FieldType.TEXT, label: 'Sequence' });

        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                'and',
                [
                    [constants.TASK_FIELDS.APPROVER, 'anyof', currentUser],
                    'or',
                    [constants.TASK_FIELDS.ACTING_APPROVER, 'anyof', currentUser]
                ]
            ],
            columns: [
                'internalid',
                constants.TASK_FIELDS.TRAN_TYPE,
                constants.TASK_FIELDS.TRAN_ID,
                constants.TASK_FIELDS.SEQUENCE
            ]
        });

        let line = 0;
        taskSearch.run().each(function(result) {
            sublist.setSublistValue({ id: 'taskid', line: line, value: result.getValue('internalid') });
            sublist.setSublistValue({ id: 'trantype', line: line, value: result.getValue(constants.TASK_FIELDS.TRAN_TYPE) });
            sublist.setSublistValue({ id: 'tranid', line: line, value: result.getValue(constants.TASK_FIELDS.TRAN_ID) });
            sublist.setSublistValue({ id: 'sequence', line: line, value: result.getValue(constants.TASK_FIELDS.SEQUENCE) });
            line += 1;
            return true;
        });

        form.addSubmitButton({ label: 'Process Selected' });
        context.response.writePage(form);
    }

    function processBulkApprovals(context) {
        const request = context.request;
        const action = normalizeAction(request.parameters.custpage_action);
        const comment = request.parameters.custpage_comment || '';
        const trimmedComment = String(comment).trim();
        const lineCount = request.getLineCount({ group: 'custpage_tasks' }) || 0;
        const bulkLimit = constants.CONFIG.BULK_APPROVAL_LIMIT || 50;
        const governanceThreshold = 200;

        if (!action) {
            return showResultPage(context, 'Invalid action selected.');
        }
        if (action === 'reject' && !trimmedComment) {
            return showResultPage(context, 'Comment required for rejection.');
        }

        let selectedCount = 0;
        for (let i = 0; i < lineCount; i += 1) {
            const selected = request.getSublistValue({
                group: 'custpage_tasks',
                name: 'select',
                line: i
            });
            if (selected === 'T') {
                selectedCount += 1;
            }
        }

        if (selectedCount > bulkLimit) {
            return showResultPage(context, 'Too many selections. Limit is ' + bulkLimit + '.');
        }

        let processed = 0;
        for (let i = 0; i < lineCount; i += 1) {
            if (runtime.getCurrentScript().getRemainingUsage() < governanceThreshold) {
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

            approvalEngine.processApproval({
                taskId: taskId,
                action: action === 'approve' ? constants.APPROVAL_ACTION.APPROVE : constants.APPROVAL_ACTION.REJECT,
                comment: trimmedComment,
                method: constants.APPROVAL_METHOD.BULK
            });
            processed += 1;
        }

        const warning = processed < selectedCount
            ? ' Processing stopped early due to governance limits.'
            : '';
        return showResultPage(context, 'Processed ' + processed + ' task(s).' + warning);
    }

    function normalizeAction(value) {
        const action = (value || '').toLowerCase();
        if (action === 'approve' || action === 'reject') {
            return action;
        }
        return null;
    }

    function showResultPage(context, message) {
        const form = serverWidget.createForm({ title: 'Bulk Approval Results' });
        form.addField({
            id: 'custpage_summary',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>' + message + '</p>';
        context.response.writePage(form);
    }

    return { onRequest: onRequest };
});
