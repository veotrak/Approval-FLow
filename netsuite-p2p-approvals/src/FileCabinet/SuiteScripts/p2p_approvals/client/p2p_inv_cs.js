/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * P2P Invoice Client Script
 */
define(['N/currentRecord', 'N/url', 'N/https', 'N/ui/dialog'], function(
    currentRecord, url, https, dialog
) {
    'use strict';

    function submitForApproval() {
        const rec = currentRecord.get();
        callAction('submit', rec.id, rec.type);
    }

    function approveTransaction() {
        dialog.create({
            title: 'Approve Transaction',
            message: 'Add an optional comment:',
            buttons: [
                { label: 'Approve', value: 'approve' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(function(result) {
            if (result === 'approve') {
                const comment = prompt('Optional comment:') || '';
                const rec = currentRecord.get();
                callAction('approve', rec.id, rec.type, comment);
            }
        });
    }

    function rejectTransaction() {
        const comment = prompt('Rejection comment (required):');
        if (!comment) {
            alert('Comment is required for rejection.');
            return;
        }
        const rec = currentRecord.get();
        callAction('reject', rec.id, rec.type, comment);
    }

    function recallTransaction() {
        if (!confirm('Are you sure you want to recall this transaction?')) {
            return;
        }
        const rec = currentRecord.get();
        callAction('recall', rec.id, rec.type);
    }

    function resubmitForApproval() {
        const rec = currentRecord.get();
        callAction('resubmit', rec.id, rec.type);
    }

    function callAction(action, recordId, recordType, comment) {
        try {
            const restletUrl = url.resolveScript({
                scriptId: 'customscript_p2p_action_rl',
                deploymentId: 'customdeploy_p2p_action'
            });

            const response = https.post({
                url: restletUrl,
                body: JSON.stringify({
                    action: action,
                    recordType: recordType,
                    recordId: recordId,
                    comment: comment || ''
                }),
                headers: { 'Content-Type': 'application/json' }
            });

            const result = JSON.parse(response.body);
            if (result.success) {
                location.reload();
            } else {
                alert('Error: ' + (result.message || 'Unknown error'));
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }

    function pageInit(context) {
        // Functions are available globally for button onclick
    }

    return {
        pageInit: pageInit,
        submitForApproval: submitForApproval,
        approveTransaction: approveTransaction,
        rejectTransaction: rejectTransaction,
        recallTransaction: recallTransaction,
        resubmitForApproval: resubmitForApproval
    };
});
