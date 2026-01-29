/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', '../lib/p2p_token_manager',
        '../lib/p2p_approval_engine', '../constants/p2p_constants'
], function(serverWidget, record, tokenManager, approvalEngine, constants) {
    'use strict';

    function onRequest(context) {
        const params = context.request.parameters;
        const token = params.token;
        const action = normalizeAction(params.action);

        const validation = tokenManager.validateToken(token);
        if (!validation.valid) {
            return showErrorPage(context, validation.error);
        }

        if (!action) {
            return showErrorPage(context, 'Invalid approval action.');
        }

        if (context.request.method === 'GET') {
            return showConfirmationPage(context, validation, action);
        }

        if (context.request.method === 'POST') {
            const comment = params.comment;
            const ipAddress = context.request.clientIpAddress;

            const result = approvalEngine.processApproval({
                taskId: validation.taskId,
                action: action === 'approve' ? constants.APPROVAL_ACTION.APPROVE
                    : constants.APPROVAL_ACTION.REJECT,
                comment: comment,
                method: constants.APPROVAL_METHOD.EMAIL,
                ipAddress: ipAddress
            });

            tokenManager.invalidateToken(validation.taskId);
            return showResultPage(context, result);
        }
    }

    function showConfirmationPage(context, validation, action) {
        const form = serverWidget.createForm({
            title: 'Confirm ' + (action === 'approve' ? 'Approval' : 'Rejection')
        });

        const summary = getTransactionSummary(validation);
        const summaryLines = [
            '<p>Transaction: ' + summary.typeLabel + ' #' + summary.tranId + '</p>',
            summary.entity ? '<p>Vendor: ' + summary.entity + '</p>' : '',
            summary.total ? '<p>Total: ' + summary.total + '</p>' : '',
            '<p>Internal ID: ' + validation.transactionId + '</p>'
        ];
        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = summaryLines.join('');

        const commentField = form.addField({
            id: 'comment',
            type: serverWidget.FieldType.TEXTAREA,
            label: 'Comment'
        });
        if (action === 'reject') {
            commentField.isMandatory = true;
        }

        form.addField({
            id: 'token',
            type: serverWidget.FieldType.TEXT,
            label: 'Token'
        }).updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        }).defaultValue = context.request.parameters.token;

        form.addField({
            id: 'action',
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        }).updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        }).defaultValue = action;

        form.addSubmitButton({
            label: action === 'approve' ? 'Approve' : 'Reject'
        });

        context.response.writePage(form);
    }

    function showResultPage(context, result) {
        const form = serverWidget.createForm({ title: 'Approval Result' });
        const message = result && result.success
            ? 'Your response has been recorded.'
            : 'Unable to process your response: ' + (result.message || 'Unknown error.');
        form.addField({
            id: 'custpage_result',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>' + message + '</p>';
        context.response.writePage(form);
    }

    function showErrorPage(context, errorMessage) {
        const form = serverWidget.createForm({ title: 'Approval Error' });
        form.addField({
            id: 'custpage_error',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>' + (errorMessage || 'Token validation failed.') + '</p>';
        context.response.writePage(form);
    }

    function normalizeAction(value) {
        const action = (value || '').toLowerCase();
        if (action === 'approve' || action === 'reject') {
            return action;
        }
        return null;
    }

    function getRecordTypeByTranType(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) {
            return { recordType: 'purchaseorder', label: 'Purchase Order' };
        }
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) {
            return { recordType: 'vendorbill', label: 'Vendor Bill' };
        }
        return { recordType: null, label: 'Transaction' };
    }

    function getTransactionSummary(validation) {
        const mapping = getRecordTypeByTranType(validation.transactionType);
        const summary = {
            typeLabel: mapping.label,
            tranId: validation.transactionId,
            entity: '',
            total: ''
        };
        if (!mapping.recordType || !validation.transactionId) {
            return summary;
        }
        try {
            const tran = record.load({ type: mapping.recordType, id: validation.transactionId });
            summary.tranId = tran.getValue('tranid') || summary.tranId;
            summary.entity = tran.getText('entity') || '';
            const total = tran.getValue('total');
            if (total !== null && total !== '') {
                summary.total = String(total);
            }
        } catch (error) {
            log.error('getTransactionSummary error', error);
        }
        return summary;
    }

    return { onRequest: onRequest };
});
