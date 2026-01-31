/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P Notification Manager (v2 - Decision Table Architecture)
 * Handles email, Teams, and Slack notifications
 */
define([
    'N/email', 'N/url', 'N/runtime', 'N/record', 'N/https', 'N/search',
    './p2p_token_manager', './p2p_config',
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

    function getRecordTypeLabel(recordType) {
        const type = String(recordType || '').toLowerCase();
        if (type === 'purchaseorder') return 'Purchase Order';
        if (type === 'vendorbill') return 'Vendor Bill';
        if (type === 'salesorder') return 'Sales Order';
        if (type === 'invoice') return 'Invoice';
        return 'Transaction';
    }

    function getEmployeeEmail(employeeId) {
        try {
            if (!employeeId) return '';
            const result = search.lookupFields({
                type: 'employee',
                id: employeeId,
                columns: ['email', 'isinactive']
            });
            if (!result || result.isinactive === true || result.isinactive === 'T') {
                return '';
            }
            return result.email || '';
        } catch (error) {
            log.error('getEmployeeEmail error', error);
            return '';
        }
    }

    function resolveEmailAuthor() {
        const currentUserId = runtime.getCurrentUser().id;
        if (currentUserId && getEmployeeEmail(currentUserId)) {
            return currentUserId;
        }
        // Fallback to system user when current user is missing an email
        return -5;
    }

    function buildRecordLink(recordType, recordId) {
        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: recordId,
                returnExternalUrl: true
            });
        } catch (error) {
            log.error('buildRecordLink error', error);
            return '';
        }
    }

    /**
     * Build transaction summary for notifications
     */
    function buildTransactionSummary(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return {
                typeLabel: getRecordTypeLabel(recordType),
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
                typeLabel: getRecordTypeLabel(recordType),
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

            const authorId = resolveEmailAuthor();
            const approverEmail = getEmployeeEmail(params.approverId);
            if (!approverEmail) {
                log.error('sendApprovalRequest missing approver email', {
                    approverId: params.approverId,
                    recordType: params.recordType,
                    recordId: params.recordId
                });
            }

            log.audit('sendApprovalRequest', {
                authorId: authorId,
                approverId: params.approverId,
                recordType: params.recordType,
                recordId: params.recordId
            });

            // Send email
            email.send({
                author: authorId,
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
        const recordLink = buildRecordLink(params.recordType, params.recordId);
        const typeLabel = summary.typeLabel || getRecordTypeLabel(params.recordType);
        const rows = [];

        rows.push('<div style="font-family: Arial, sans-serif; background: #f6f7f9; padding: 24px;">');
        rows.push('<div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">');
        rows.push('<div style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb;">');
        rows.push('<div style="font-size: 18px; font-weight: bold; color: #111827;">Approval Request</div>');
        rows.push('<div style="margin-top: 6px; color: #6b7280; font-size: 13px;">Action needed to keep approvals moving.</div>');
        rows.push('</div>');

        rows.push('<div style="padding: 20px 24px;">');
        rows.push('<table style="border-collapse: collapse; width: 100%;">');
        rows.push(buildInfoRow('Transaction Type', escapeHtml(typeLabel)));
        rows.push(buildInfoRow('Document Number', escapeHtml(summary.tranId)));
        if (summary.entity) rows.push(buildInfoRow('Vendor/Entity', escapeHtml(summary.entity)));
        rows.push(buildInfoRow('Amount', formatCurrency(summary.amount)));
        if (summary.date) rows.push(buildInfoRow('Date', escapeHtml(summary.date)));
        if (summary.subsidiary) rows.push(buildInfoRow('Subsidiary', escapeHtml(summary.subsidiary)));
        if (summary.department) rows.push(buildInfoRow('Department', escapeHtml(summary.department)));
        if (summary.memo) rows.push(buildInfoRow('Memo', escapeHtml(summary.memo)));
        rows.push('</table>');

        if (summary.aiRiskScore || summary.aiRiskFlags || summary.aiRiskSummary || summary.matchReason) {
            rows.push('<div style="margin-top: 16px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 12px; color: #374151;">');
            rows.push('<div style="font-weight: bold; margin-bottom: 6px;">Risk & Routing</div>');
            if (summary.aiRiskScore) rows.push('<div>Risk Score: ' + escapeHtml(summary.aiRiskScore) + '</div>');
            if (summary.aiRiskFlags) rows.push('<div>Risk Flags: ' + escapeHtml(summary.aiRiskFlags) + '</div>');
            if (summary.aiRiskSummary) rows.push('<div>Risk Summary: ' + escapeHtml(summary.aiRiskSummary) + '</div>');
            if (summary.matchReason) rows.push('<div>Routing: ' + escapeHtml(summary.matchReason) + '</div>');
            rows.push('</div>');
        }

        rows.push('</div>');
        rows.push('<div style="padding: 18px 24px; border-top: 1px solid #e5e7eb; background: #fafafa;">');
        rows.push('<a href="' + links.approve + '" style="display: inline-block; background-color: #16a34a; color: white; padding: 10px 18px; text-decoration: none; margin-right: 8px; border-radius: 6px; font-weight: bold;">Approve</a>');
        rows.push('<a href="' + links.reject + '" style="display: inline-block; background-color: #dc2626; color: white; padding: 10px 18px; text-decoration: none; margin-right: 8px; border-radius: 6px; font-weight: bold;">Reject</a>');
        if (recordLink) {
            rows.push('<a href="' + recordLink + '" style="display: inline-block; background-color: #111827; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold;">Open in NetSuite</a>');
        }
        rows.push('<div style="margin-top: 10px; font-size: 12px; color: #6b7280;">Link expires in ' + config.getValue('tokenExpiryHours', 72) + ' hours.</div>');
        rows.push('</div>');
        rows.push('</div>');
        rows.push('</div>');

        return rows.join('');
    }

    function buildInfoRow(label, value) {
        return '<tr><td style="padding: 8px 0; color: #6b7280; font-size: 12px; width: 150px; vertical-align: top;">' + label + '</td>' +
               '<td style="padding: 8px 0; color: #111827;">' + value + '</td></tr>';
    }

    function formatCurrency(amount) {
        if (!amount) return '$0.00';
        const parsed = Number(amount);
        if (!isFinite(parsed)) {
            return escapeHtml(amount);
        }
        return '$' + parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
