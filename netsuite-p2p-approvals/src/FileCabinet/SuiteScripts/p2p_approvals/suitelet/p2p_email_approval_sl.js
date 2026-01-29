/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', '../lib/p2p_token_manager',
        '../lib/p2p_approval_engine', '../constants/p2p_constants'
], function(serverWidget, tokenManager, approvalEngine, constants) {
    'use strict';

    function onRequest(context) {
        const params = context.request.parameters;
        const token = params.token;
        const action = params.action;

        const validation = tokenManager.validateToken(token);
        if (!validation.valid) {
            return showErrorPage(context, validation.error);
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

        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>Transaction ID: ' + validation.transactionId + '</p>';

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
        const form = serverWidget.createForm({ title: 'Invalid Token' });
        form.addField({
            id: 'custpage_error',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>' + (errorMessage || 'Token validation failed.') + '</p>';
        context.response.writePage(form);
    }

    return { onRequest: onRequest };
});
