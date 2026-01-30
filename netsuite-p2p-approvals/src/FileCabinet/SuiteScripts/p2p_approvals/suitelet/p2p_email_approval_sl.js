/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * P2P Email Approval Suitelet (v2 - Decision Table Architecture)
 * Handles one-click approve/reject from email links
 */
define([
    'N/ui/serverWidget', 'N/record', 'N/url',
    '../lib/p2p_token_manager',
    '../lib/p2p_controller',
    '../lib/p2p_history_logger',
    '../constants/p2p_constants_v2'
], function(serverWidget, record, url, tokenManager, controller, historyLogger, constants) {
    'use strict';

    const STATUS = constants.APPROVAL_STATUS;
    const ACTION = constants.APPROVAL_ACTION;
    const METHOD = constants.APPROVAL_METHOD;

    /**
     * Main request handler
     */
    function onRequest(context) {
        const params = context.request.parameters;
        const token = params.token;
        const action = normalizeAction(params.action);

        // Validate token
        const validation = tokenManager.validateToken(token);

        if (!validation.valid) {
            return showErrorPage(context, validation.error || 'Invalid or expired token.');
        }

        if (!action) {
            return showErrorPage(context, 'Invalid approval action.');
        }

        // GET - Show confirmation page
        if (context.request.method === 'GET') {
            return showConfirmationPage(context, validation, action);
        }

        // POST - Process the approval
        if (context.request.method === 'POST') {
            const comment = params.comment || '';
            const ipAddress = context.request.clientIpAddress;

            return processApproval(context, validation, action, comment, ipAddress);
        }
    }

    /**
     * Show confirmation page before processing
     */
    function showConfirmationPage(context, validation, action) {
        const form = serverWidget.createForm({
            title: action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'
        });

        // Get transaction details
        const summary = getTransactionSummary(validation);

        // Build info display
        let infoHtml = '<div style="padding: 20px; background: #f5f5f5; border-radius: 8px; margin-bottom: 20px;">';
        infoHtml += '<h2 style="margin: 0 0 15px 0; color: #333;">Transaction Details</h2>';
        infoHtml += '<table style="width: 100%;">';
        infoHtml += '<tr><td style="padding: 5px 10px 5px 0; font-weight: bold;">Type:</td><td>' + escapeHtml(summary.typeLabel) + '</td></tr>';
        infoHtml += '<tr><td style="padding: 5px 10px 5px 0; font-weight: bold;">Transaction #:</td><td>' + escapeHtml(summary.tranId) + '</td></tr>';
        
        if (summary.entity) {
            infoHtml += '<tr><td style="padding: 5px 10px 5px 0; font-weight: bold;">Vendor/Entity:</td><td>' + escapeHtml(summary.entity) + '</td></tr>';
        }
        if (summary.total) {
            infoHtml += '<tr><td style="padding: 5px 10px 5px 0; font-weight: bold;">Amount:</td><td>$' + escapeHtml(summary.total) + '</td></tr>';
        }
        if (summary.date) {
            infoHtml += '<tr><td style="padding: 5px 10px 5px 0; font-weight: bold;">Date:</td><td>' + escapeHtml(summary.date) + '</td></tr>';
        }
        
        infoHtml += '</table>';
        infoHtml += '</div>';

        // Action-specific message
        if (action === 'approve') {
            infoHtml += '<p style="color: #4CAF50; font-size: 16px;">You are about to <strong>APPROVE</strong> this transaction.</p>';
        } else {
            infoHtml += '<p style="color: #f44336; font-size: 16px;">You are about to <strong>REJECT</strong> this transaction.</p>';
        }

        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = infoHtml;

        // Comment field
        const commentField = form.addField({
            id: 'comment',
            type: serverWidget.FieldType.TEXTAREA,
            label: 'Comment'
        });
        
        if (action === 'reject') {
            commentField.isMandatory = true;
            commentField.setHelpText({ help: 'A comment is required when rejecting.' });
        } else {
            commentField.setHelpText({ help: 'Optional comment for the approval.' });
        }

        // Hidden fields
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

        // Submit button
        const buttonLabel = action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection';
        form.addSubmitButton({ label: buttonLabel });

        // Add cancel link
        form.addButton({
            id: 'custpage_cancel',
            label: 'Cancel',
            functionName: 'window.close()'
        });

        context.response.writePage(form);
    }

    /**
     * Process the approval/rejection
     */
    function processApproval(context, validation, action, comment, ipAddress) {
        try {
            // For rejection, require comment
            if (action === 'reject' && !comment.trim()) {
                return showErrorPage(context, 'A comment is required when rejecting.');
            }

            // Get record type from transaction type
            const recordType = getRecordTypeFromTranType(validation.transactionType);

            // Process via controller
            const result = controller.processApproval({
                taskId: validation.taskId,
                recordType: recordType,
                recordId: validation.transactionId,
                action: action === 'approve' ? ACTION.APPROVE : ACTION.REJECT,
                comment: comment,
                method: METHOD.EMAIL,
                ipAddress: ipAddress,
                approverId: validation.approver
            });

            // Invalidate token after use
            tokenManager.invalidateToken(validation.taskId);

            if (result.success) {
                return showSuccessPage(context, action, validation);
            } else {
                return showErrorPage(context, result.message || 'Failed to process approval.');
            }
        } catch (error) {
            log.error('processApproval error', error);
            return showErrorPage(context, 'An error occurred: ' + error.message);
        }
    }

    /**
     * Show success page
     */
    function showSuccessPage(context, action, validation) {
        const form = serverWidget.createForm({
            title: action === 'approve' ? 'Approval Successful' : 'Rejection Recorded'
        });

        let html = '<div style="padding: 40px; text-align: center;">';
        
        if (action === 'approve') {
            html += '<div style="font-size: 60px; color: #4CAF50;">✓</div>';
            html += '<h1 style="color: #4CAF50;">Approved!</h1>';
            html += '<p>The transaction has been approved successfully.</p>';
        } else {
            html += '<div style="font-size: 60px; color: #f44336;">✗</div>';
            html += '<h1 style="color: #f44336;">Rejected</h1>';
            html += '<p>The transaction has been rejected.</p>';
        }

        html += '<p style="margin-top: 20px; color: #666;">You can close this window.</p>';
        html += '</div>';

        form.addField({
            id: 'custpage_result',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;

        context.response.writePage(form);
    }

    /**
     * Show error page
     */
    function showErrorPage(context, errorMessage) {
        const form = serverWidget.createForm({
            title: 'Approval Error'
        });

        let html = '<div style="padding: 40px; text-align: center;">';
        html += '<div style="font-size: 60px; color: #FF9800;">⚠</div>';
        html += '<h1 style="color: #FF9800;">Unable to Process</h1>';
        html += '<p style="color: #666;">' + escapeHtml(errorMessage) + '</p>';
        html += '<p style="margin-top: 20px; color: #999;">If this issue persists, please approve/reject directly in NetSuite.</p>';
        html += '</div>';

        form.addField({
            id: 'custpage_error',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;

        context.response.writePage(form);
    }

    /**
     * Get transaction summary for display
     */
    function getTransactionSummary(validation) {
        const summary = {
            typeLabel: getTypeLabel(validation.transactionType),
            tranId: validation.transactionId,
            entity: '',
            total: '',
            date: ''
        };

        try {
            const recordType = getRecordTypeFromTranType(validation.transactionType);
            if (!recordType || !validation.transactionId) {
                return summary;
            }

            const tran = record.load({ 
                type: recordType, 
                id: validation.transactionId 
            });

            summary.tranId = tran.getValue('tranid') || validation.transactionId;
            summary.entity = tran.getText('entity') || '';
            summary.total = tran.getValue('total') || '';
            summary.date = tran.getText('trandate') || '';

        } catch (error) {
            log.error('getTransactionSummary error', error);
        }

        return summary;
    }

    /**
     * Normalize action string
     */
    function normalizeAction(value) {
        const action = (value || '').toLowerCase().trim();
        if (action === 'approve' || action === 'approved') return 'approve';
        if (action === 'reject' || action === 'rejected') return 'reject';
        return null;
    }

    /**
     * Get record type from transaction type constant
     */
    function getRecordTypeFromTranType(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) {
            return 'purchaseorder';
        }
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) {
            return 'vendorbill';
        }
        return tranType;
    }

    /**
     * Get type label for display
     */
    function getTypeLabel(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) {
            return 'Purchase Order';
        }
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) {
            return 'Vendor Bill';
        }
        return 'Transaction';
    }

    /**
     * Escape HTML for safe display
     */
    function escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { onRequest: onRequest };
});
