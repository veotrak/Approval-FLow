/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/email', 'N/url', 'N/runtime', 'N/record', './p2p_token_manager', '../constants/p2p_constants'], function(
    email, url, runtime, record, tokenManager, constants
) {
    'use strict';

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildTransactionSummary(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return {
                tranId: tran.getValue('tranid'),
                entity: tran.getText('entity') || '',
                amount: tran.getValue('total') || tran.getValue('amount') || 0,
                date: tran.getText('trandate') || ''
            };
        } catch (error) {
            log.error('buildTransactionSummary error', error);
            return { tranId: recordId, entity: '', amount: 0, date: '' };
        }
    }

    function buildApprovalLinks(token) {
        const baseUrl = url.resolveScript({
            scriptId: constants.SCRIPTS.EMAIL_APPROVAL_SL,
            deploymentId: constants.SCRIPTS.EMAIL_APPROVAL_DEPLOY,
            returnExternalUrl: true
        });

        return {
            approve: baseUrl + '&token=' + encodeURIComponent(token) + '&action=approve',
            reject: baseUrl + '&token=' + encodeURIComponent(token) + '&action=reject'
        };
    }

    function sendApprovalRequest(params) {
        try {
            if (!params || !params.taskId || !params.approverId) {
                throw new Error('Missing params for approval request.');
            }

            const token = tokenManager.refreshToken(params.taskId);
            const links = buildApprovalLinks(token);
            const summary = buildTransactionSummary(params.recordType, params.recordId);

            const safeType = escapeHtml(params.recordType);
            const safeEntity = escapeHtml(summary.entity);
            const safeAmount = escapeHtml(summary.amount);
            const safeDate = escapeHtml(summary.date);
            const subject = 'Approval Request: ' + summary.tranId;
            const body = [
                '<p>An approval is requested.</p>',
                '<p><strong>Type:</strong> ' + safeType + '</p>',
                '<p><strong>Vendor/Entity:</strong> ' + safeEntity + '</p>',
                '<p><strong>Amount:</strong> ' + safeAmount + '</p>',
                '<p><strong>Date:</strong> ' + safeDate + '</p>',
                '<p><a href="' + links.approve + '">Approve</a> | <a href="' + links.reject + '">Reject</a></p>'
            ].join('');

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.approverId,
                subject: subject,
                body: body
            });

            log.audit('Approval request sent', { taskId: params.taskId, approver: params.approverId });
        } catch (error) {
            log.error('sendApprovalRequest error', error);
        }
    }

    function sendReminder(params) {
        try {
            if (!params || !params.taskId || !params.approverId) {
                return;
            }
            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const subject = 'Reminder: Approval Needed for ' + summary.tranId;
            const body = '<p>Please complete your approval for ' + escapeHtml(summary.tranId) + '.</p>';
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.approverId,
                subject: subject,
                body: body
            });
        } catch (error) {
            log.error('sendReminder error', error);
        }
    }

    function sendEscalation(params) {
        try {
            if (!params || !params.managerId) {
                return;
            }
            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const subject = 'Escalation: Approval Overdue for ' + summary.tranId;
            const body = '<p>This approval is overdue. Please review.</p>';
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.managerId,
                subject: subject,
                body: body
            });
        } catch (error) {
            log.error('sendEscalation error', error);
        }
    }

    function sendApprovedNotification(params) {
        try {
            if (!params || !params.requestorId) {
                return;
            }
            const summary = buildTransactionSummary(params.recordType, params.recordId);
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.requestorId,
                subject: 'Approved: ' + summary.tranId,
                body: '<p>Your transaction has been approved.</p>'
            });
        } catch (error) {
            log.error('sendApprovedNotification error', error);
        }
    }

    function sendRejectedNotification(params) {
        try {
            if (!params || !params.requestorId) {
                return;
            }
            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const safeComment = escapeHtml(params.comment || '');
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.requestorId,
                subject: 'Rejected: ' + summary.tranId,
                body: '<p>Your transaction has been rejected.</p><p>' + safeComment + '</p>'
            });
        } catch (error) {
            log.error('sendRejectedNotification error', error);
        }
    }

    return {
        sendApprovalRequest: sendApprovalRequest,
        sendReminder: sendReminder,
        sendEscalation: sendEscalation,
        sendApprovedNotification: sendApprovedNotification,
        sendRejectedNotification: sendRejectedNotification
    };
});
