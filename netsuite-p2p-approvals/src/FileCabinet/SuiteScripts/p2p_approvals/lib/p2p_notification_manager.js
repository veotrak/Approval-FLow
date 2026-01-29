/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/email', 'N/url', 'N/runtime', 'N/record', 'N/https', './p2p_token_manager', '../constants/p2p_constants'], function(
    email, url, runtime, record, https, tokenManager, constants
) {
    'use strict';

    const TEAMS_WEBHOOK_PARAM = 'custscript_p2p_teams_webhook';
    const SLACK_WEBHOOK_PARAM = 'custscript_p2p_slack_webhook';

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
                date: tran.getText('trandate') || '',
                aiRiskScore: tran.getValue(constants.BODY_FIELDS.AI_RISK_SCORE) || '',
                aiRiskFlags: tran.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS) || '',
                aiRiskSummary: tran.getValue(constants.BODY_FIELDS.AI_RISK_SUMMARY) || '',
                aiExceptionSuggestion: tran.getText(constants.BODY_FIELDS.AI_EXCEPTION_SUGGESTION) || ''
            };
        } catch (error) {
            log.error('buildTransactionSummary error', error);
            return {
                tranId: recordId,
                entity: '',
                amount: 0,
                date: '',
                aiRiskScore: '',
                aiRiskFlags: '',
                aiRiskSummary: '',
                aiExceptionSuggestion: ''
            };
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

            sendTeamsMessage(buildTeamsApprovalMessage({
                summary: summary,
                recordType: params.recordType,
                links: links,
                heading: 'Approval Request'
            }));
            sendSlackMessage(buildSlackApprovalMessage({
                summary: summary,
                recordType: params.recordType,
                links: links,
                heading: 'Approval Request'
            }));

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

            const token = tokenManager.refreshToken(params.taskId);
            const links = token ? buildApprovalLinks(token) : null;
            sendTeamsMessage(buildTeamsApprovalMessage({
                summary: summary,
                recordType: params.recordType,
                links: links,
                heading: 'Approval Reminder'
            }));
            sendSlackMessage(buildSlackApprovalMessage({
                summary: summary,
                recordType: params.recordType,
                links: links,
                heading: 'Approval Reminder'
            }));
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

            sendTeamsMessage(buildTeamsEscalationMessage({
                summary: summary,
                recordType: params.recordType
            }));
            sendSlackMessage(buildSlackEscalationMessage({
                summary: summary,
                recordType: params.recordType
            }));
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

    function buildTeamsApprovalMessage(params) {
        if (!params || !params.summary) {
            return '';
        }
        const summary = params.summary;
        const lines = [
            '**' + (params.heading || 'Approval') + '**',
            'Type: ' + escapeHtml(params.recordType || ''),
            'Transaction: ' + escapeHtml(summary.tranId || ''),
            summary.entity ? 'Vendor/Entity: ' + escapeHtml(summary.entity) : '',
            summary.amount ? 'Amount: ' + escapeHtml(summary.amount) : '',
            summary.date ? 'Date: ' + escapeHtml(summary.date) : '',
            summary.aiRiskScore ? 'Risk Score: ' + escapeHtml(summary.aiRiskScore) : '',
            summary.aiRiskFlags ? 'Risk Flags: ' + escapeHtml(summary.aiRiskFlags) : '',
            summary.aiRiskSummary ? 'Risk Summary: ' + escapeHtml(summary.aiRiskSummary) : '',
            summary.aiExceptionSuggestion ? 'Suggested Exception: ' + escapeHtml(summary.aiExceptionSuggestion) : ''
        ].filter(function(line) { return line && line.length; });

        if (params.links && params.links.approve && params.links.reject) {
            lines.push('[Approve](' + params.links.approve + ') | [Reject](' + params.links.reject + ')');
        }
        return lines.join('\n');
    }

    function buildTeamsEscalationMessage(params) {
        if (!params || !params.summary) {
            return '';
        }
        const summary = params.summary;
        const lines = [
            '**Approval Escalation**',
            'Type: ' + escapeHtml(params.recordType || ''),
            'Transaction: ' + escapeHtml(summary.tranId || ''),
            summary.entity ? 'Vendor/Entity: ' + escapeHtml(summary.entity) : '',
            summary.amount ? 'Amount: ' + escapeHtml(summary.amount) : '',
            summary.date ? 'Date: ' + escapeHtml(summary.date) : '',
            summary.aiRiskScore ? 'Risk Score: ' + escapeHtml(summary.aiRiskScore) : '',
            summary.aiRiskFlags ? 'Risk Flags: ' + escapeHtml(summary.aiRiskFlags) : '',
            summary.aiRiskSummary ? 'Risk Summary: ' + escapeHtml(summary.aiRiskSummary) : '',
            summary.aiExceptionSuggestion ? 'Suggested Exception: ' + escapeHtml(summary.aiExceptionSuggestion) : ''
        ].filter(function(line) { return line && line.length; });
        return lines.join('\n');
    }

    function buildSlackApprovalMessage(params) {
        if (!params || !params.summary) {
            return '';
        }
        const summary = params.summary;
        const lines = [
            '*' + (params.heading || 'Approval') + '*',
            'Type: ' + escapeHtml(params.recordType || ''),
            'Transaction: ' + escapeHtml(summary.tranId || ''),
            summary.entity ? 'Vendor/Entity: ' + escapeHtml(summary.entity) : '',
            summary.amount ? 'Amount: ' + escapeHtml(summary.amount) : '',
            summary.date ? 'Date: ' + escapeHtml(summary.date) : '',
            summary.aiRiskScore ? 'Risk Score: ' + escapeHtml(summary.aiRiskScore) : '',
            summary.aiRiskFlags ? 'Risk Flags: ' + escapeHtml(summary.aiRiskFlags) : '',
            summary.aiRiskSummary ? 'Risk Summary: ' + escapeHtml(summary.aiRiskSummary) : '',
            summary.aiExceptionSuggestion ? 'Suggested Exception: ' + escapeHtml(summary.aiExceptionSuggestion) : ''
        ].filter(function(line) { return line && line.length; });

        if (params.links && params.links.approve && params.links.reject) {
            lines.push('<' + params.links.approve + '|Approve> | <' + params.links.reject + '|Reject>');
        }
        return lines.join('\n');
    }

    function buildSlackEscalationMessage(params) {
        if (!params || !params.summary) {
            return '';
        }
        const summary = params.summary;
        const lines = [
            '*Approval Escalation*',
            'Type: ' + escapeHtml(params.recordType || ''),
            'Transaction: ' + escapeHtml(summary.tranId || ''),
            summary.entity ? 'Vendor/Entity: ' + escapeHtml(summary.entity) : '',
            summary.amount ? 'Amount: ' + escapeHtml(summary.amount) : '',
            summary.date ? 'Date: ' + escapeHtml(summary.date) : '',
            summary.aiRiskScore ? 'Risk Score: ' + escapeHtml(summary.aiRiskScore) : '',
            summary.aiRiskFlags ? 'Risk Flags: ' + escapeHtml(summary.aiRiskFlags) : ''
        ].filter(function(line) { return line && line.length; });
        return lines.join('\n');
    }

    function sendTeamsMessage(message) {
        try {
            const webhookUrl = getTeamsWebhookUrl();
            if (!webhookUrl || !message) {
                return;
            }
            https.post({
                url: webhookUrl,
                body: JSON.stringify({ text: message }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            log.error('sendTeamsMessage error', error);
        }
    }

    function sendSlackMessage(message) {
        try {
            const webhookUrl = getSlackWebhookUrl();
            if (!webhookUrl || !message) {
                return;
            }
            https.post({
                url: webhookUrl,
                body: JSON.stringify({ text: message }),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            log.error('sendSlackMessage error', error);
        }
    }

    function getTeamsWebhookUrl() {
        try {
            const script = runtime.getCurrentScript();
            if (!script) {
                return '';
            }
            return script.getParameter({ name: TEAMS_WEBHOOK_PARAM }) || '';
        } catch (error) {
            log.error('getTeamsWebhookUrl error', error);
            return '';
        }
    }

    function getSlackWebhookUrl() {
        try {
            const script = runtime.getCurrentScript();
            if (!script) {
                return '';
            }
            return script.getParameter({ name: SLACK_WEBHOOK_PARAM }) || '';
        } catch (error) {
            log.error('getSlackWebhookUrl error', error);
            return '';
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
