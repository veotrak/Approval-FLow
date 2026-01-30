/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P Notification Manager (v2 - Decision Table Architecture)
 * Handles email, Teams, and Slack notifications
 */
define([
    'N/email', 'N/url', 'N/runtime', 'N/record', 'N/https', 'N/search',
    './p2p_token_manager_v2', './p2p_config',
    '../constants/p2p_constants_v2'
], function(email, url, runtime, record, https, search, tokenManager, config, constants) {
    'use strict';

    const BF = constants.BODY_FIELDS;

    /**
     * Escape HTML for safe rendering
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Build transaction summary for notifications
     */
    function buildTransactionSummary(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return {
                tranId: tran.getValue('tranid'),
                entity: tran.getText('entity') || '',
                amount: tran.getValue('total') || tran.getValue('amount') || 0,
                date: tran.getText('trandate') || '',
                subsidiary: tran.getText('subsidiary') || '',
                department: tran.getText('department') || '',
                memo: tran.getValue('memo') || '',
                aiRiskScore: tran.getValue(BF.AI_RISK_SCORE) || '',
                aiRiskFlags: tran.getValue(BF.AI_RISK_FLAGS) || '',
                aiRiskSummary: tran.getValue(BF.AI_RISK_SUMMARY) || '',
                matchReason: tran.getValue(BF.MATCH_REASON) || ''
            };
        } catch (error) {
            log.error('buildTransactionSummary error', error);
            return {
                tranId: recordId,
                entity: '',
                amount: 0,
                date: '',
                subsidiary: '',
                department: '',
                memo: '',
                aiRiskScore: '',
                aiRiskFlags: '',
                aiRiskSummary: '',
                matchReason: ''
            };
        }
    }

    /**
     * Build secure approval/reject links
     */
    function buildApprovalLinks(token) {
        try {
            const baseUrl = url.resolveScript({
                scriptId: constants.SCRIPTS.EMAIL_APPROVAL_SL,
                deploymentId: constants.SCRIPTS.EMAIL_APPROVAL_DEPLOY,
                returnExternalUrl: true
            });

            return {
                approve: baseUrl + '&token=' + encodeURIComponent(token) + '&action=approve',
                reject: baseUrl + '&token=' + encodeURIComponent(token) + '&action=reject'
            };
        } catch (error) {
            log.error('buildApprovalLinks error', error);
            return { approve: '', reject: '' };
        }
    }

    /**
     * Send approval request notification
     */
    function sendApprovalRequest(params) {
        try {
            if (!params || !params.taskId || !params.approverId) {
                throw new Error('Missing required parameters for approval request');
            }

            // Generate/refresh token
            const token = tokenManager.refreshToken(params.taskId);
            const links = buildApprovalLinks(token);
            const summary = buildTransactionSummary(params.recordType, params.recordId);

            // Build email
            const subject = 'Approval Request: ' + summary.tranId;
            const body = buildApprovalEmailBody(summary, links, params);

            // Send email
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.approverId,
                subject: subject,
                body: body
            });

            // Send Teams notification
            sendTeamsNotification({
                type: 'approval_request',
                summary: summary,
                links: links,
                params: params
            });

            // Send Slack notification
            sendSlackNotification({
                type: 'approval_request',
                summary: summary,
                links: links,
                params: params
            });

            log.audit('Approval request sent', { 
                taskId: params.taskId, 
                approver: params.approverId,
                tranId: summary.tranId
            });
        } catch (error) {
            log.error('sendApprovalRequest error', error);
        }
    }

    /**
     * Build approval email HTML body
     */
    function buildApprovalEmailBody(summary, links, params) {
        const rows = [
            '<p>An approval is requested for the following transaction:</p>',
            '<table style="border-collapse: collapse; width: 100%; max-width: 600px;">',
            buildInfoRow('Transaction Type', escapeHtml(params.recordType)),
            buildInfoRow('Document Number', escapeHtml(summary.tranId)),
            buildInfoRow('Vendor/Entity', escapeHtml(summary.entity)),
            buildInfoRow('Amount', formatCurrency(summary.amount)),
            buildInfoRow('Date', escapeHtml(summary.date)),
            buildInfoRow('Subsidiary', escapeHtml(summary.subsidiary))
        ];

        if (summary.department) {
            rows.push(buildInfoRow('Department', escapeHtml(summary.department)));
        }
        if (summary.memo) {
            rows.push(buildInfoRow('Memo', escapeHtml(summary.memo)));
        }
        if (summary.aiRiskScore) {
            rows.push(buildInfoRow('AI Risk Score', escapeHtml(summary.aiRiskScore)));
        }
        if (summary.aiRiskFlags) {
            rows.push(buildInfoRow('Risk Flags', escapeHtml(summary.aiRiskFlags)));
        }
        if (summary.matchReason) {
            rows.push(buildInfoRow('Routing Reason', escapeHtml(summary.matchReason)));
        }

        rows.push('</table>');
        rows.push('<br/>');
        rows.push('<p>');
        rows.push('<a href="' + links.approve + '" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; margin-right: 10px;">✓ Approve</a>');
        rows.push('<a href="' + links.reject + '" style="background-color: #f44336; color: white; padding: 10px 20px; text-decoration: none;">✗ Reject</a>');
        rows.push('</p>');
        rows.push('<p style="font-size: 12px; color: #666;">This link will expire in ' + config.getValue('tokenExpiryHours', 72) + ' hours.</p>');

        return rows.join('');
    }

    function buildInfoRow(label, value) {
        return '<tr><td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">' + label + '</td>' +
               '<td style="padding: 8px; border-bottom: 1px solid #ddd;">' + value + '</td></tr>';
    }

    function formatCurrency(amount) {
        if (!amount) return '$0.00';
        return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /**
     * Send reminder notification
     */
    function sendReminder(params) {
        try {
            if (!params || !params.taskId || !params.approverId) return;

            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const token = tokenManager.refreshToken(params.taskId);
            const links = buildApprovalLinks(token);

            const subject = 'Reminder: Approval Needed for ' + summary.tranId;
            const body = '<p>This is a reminder that the following transaction is awaiting your approval:</p>' +
                buildApprovalEmailBody(summary, links, params);

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.approverId,
                subject: subject,
                body: body
            });

            sendTeamsNotification({ type: 'reminder', summary: summary, links: links, params: params });
            sendSlackNotification({ type: 'reminder', summary: summary, links: links, params: params });

            log.audit('Reminder sent', { taskId: params.taskId, approver: params.approverId });
        } catch (error) {
            log.error('sendReminder error', error);
        }
    }

    /**
     * Send escalation notification
     */
    function sendEscalation(params) {
        try {
            if (!params || !params.managerId) return;

            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const subject = 'Escalation: Approval Overdue for ' + summary.tranId;
            const body = '<p>The following transaction has been escalated to you due to the original approver not responding:</p>' +
                '<p><strong>' + summary.tranId + '</strong> - ' + escapeHtml(summary.entity) + ' - ' + formatCurrency(summary.amount) + '</p>' +
                '<p>Please review and take action.</p>';

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.managerId,
                subject: subject,
                body: body
            });

            sendTeamsNotification({ type: 'escalation', summary: summary, params: params });
            sendSlackNotification({ type: 'escalation', summary: summary, params: params });

            log.audit('Escalation sent', { manager: params.managerId, tranId: summary.tranId });
        } catch (error) {
            log.error('sendEscalation error', error);
        }
    }

    /**
     * Send approved notification to requestor
     */
    function sendApprovedNotification(params) {
        try {
            if (!params || !params.requestorId) return;

            const summary = buildTransactionSummary(params.recordType, params.recordId);

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.requestorId,
                subject: '✓ Approved: ' + summary.tranId,
                body: '<p>Your transaction <strong>' + escapeHtml(summary.tranId) + '</strong> has been approved.</p>' +
                      '<p>Vendor/Entity: ' + escapeHtml(summary.entity) + '</p>' +
                      '<p>Amount: ' + formatCurrency(summary.amount) + '</p>'
            });

            log.audit('Approved notification sent', { requestor: params.requestorId, tranId: summary.tranId });
        } catch (error) {
            log.error('sendApprovedNotification error', error);
        }
    }

    /**
     * Send rejected notification to requestor
     */
    function sendRejectedNotification(params) {
        try {
            if (!params || !params.requestorId) return;

            const summary = buildTransactionSummary(params.recordType, params.recordId);
            const commentHtml = params.comment ? '<p><strong>Reason:</strong> ' + escapeHtml(params.comment) + '</p>' : '';

            email.send({
                author: runtime.getCurrentUser().id,
                recipients: params.requestorId,
                subject: '✗ Rejected: ' + summary.tranId,
                body: '<p>Your transaction <strong>' + escapeHtml(summary.tranId) + '</strong> has been rejected.</p>' +
                      '<p>Vendor/Entity: ' + escapeHtml(summary.entity) + '</p>' +
                      '<p>Amount: ' + formatCurrency(summary.amount) + '</p>' +
                      commentHtml
            });

            log.audit('Rejected notification sent', { requestor: params.requestorId, tranId: summary.tranId });
        } catch (error) {
            log.error('sendRejectedNotification error', error);
        }
    }

    /**
     * Send Teams notification
     */
    function sendTeamsNotification(data) {
        try {
            const webhookUrl = config.getValue('teamsWebhookUrl', '');
            if (!webhookUrl) return;

            const message = buildTeamsMessage(data);
            if (!message) return;

            https.post({
                url: webhookUrl,
                body: JSON.stringify({ text: message }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            log.error('sendTeamsNotification error', error);
        }
    }

    function buildTeamsMessage(data) {
        const summary = data.summary;
        if (!summary) return null;

        const lines = [];
        
        switch (data.type) {
            case 'approval_request':
                lines.push('**🔔 Approval Request**');
                break;
            case 'reminder':
                lines.push('**⏰ Approval Reminder**');
                break;
            case 'escalation':
                lines.push('**⚠️ Approval Escalation**');
                break;
            default:
                lines.push('**P2P Notification**');
        }

        lines.push('Transaction: ' + summary.tranId);
        if (summary.entity) lines.push('Vendor: ' + summary.entity);
        if (summary.amount) lines.push('Amount: ' + formatCurrency(summary.amount));
        if (summary.aiRiskScore) lines.push('Risk Score: ' + summary.aiRiskScore);
        if (summary.matchReason) lines.push('Routing: ' + summary.matchReason);

        if (data.links && data.links.approve) {
            lines.push('[Approve](' + data.links.approve + ') | [Reject](' + data.links.reject + ')');
        }

        return lines.join('\n\n');
    }

    /**
     * Send Slack notification
     */
    function sendSlackNotification(data) {
        try {
            const webhookUrl = config.getValue('slackWebhookUrl', '');
            if (!webhookUrl) return;

            const message = buildSlackMessage(data);
            if (!message) return;

            https.post({
                url: webhookUrl,
                body: JSON.stringify({ text: message }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            log.error('sendSlackNotification error', error);
        }
    }

    function buildSlackMessage(data) {
        const summary = data.summary;
        if (!summary) return null;

        const lines = [];
        
        switch (data.type) {
            case 'approval_request':
                lines.push('*🔔 Approval Request*');
                break;
            case 'reminder':
                lines.push('*⏰ Approval Reminder*');
                break;
            case 'escalation':
                lines.push('*⚠️ Approval Escalation*');
                break;
            default:
                lines.push('*P2P Notification*');
        }

        lines.push('Transaction: ' + summary.tranId);
        if (summary.entity) lines.push('Vendor: ' + summary.entity);
        if (summary.amount) lines.push('Amount: ' + formatCurrency(summary.amount));
        if (summary.aiRiskScore) lines.push('Risk Score: ' + summary.aiRiskScore);
        if (summary.matchReason) lines.push('Routing: ' + summary.matchReason);

        if (data.links && data.links.approve) {
            lines.push('<' + data.links.approve + '|Approve> | <' + data.links.reject + '|Reject>');
        }

        return lines.join('\n');
    }

    return {
        sendApprovalRequest: sendApprovalRequest,
        sendReminder: sendReminder,
        sendEscalation: sendEscalation,
        sendApprovedNotification: sendApprovedNotification,
        sendRejectedNotification: sendRejectedNotification,
        buildTransactionSummary: buildTransactionSummary,
        buildApprovalLinks: buildApprovalLinks
    };
});
