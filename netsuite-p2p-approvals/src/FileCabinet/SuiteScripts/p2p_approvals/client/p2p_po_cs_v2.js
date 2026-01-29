/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * 
 * P2P PO/VB Client Script (v2 - Decision Table Architecture)
 */
define(['N/currentRecord', 'N/url', 'N/https', 'N/ui/dialog'], function(
    currentRecord, url, https, dialog
) {
    'use strict';

    /**
     * Submit transaction for approval
     */
    function submitForApproval() {
        const rec = currentRecord.get();
        callAction('submit', rec.id, rec.type);
    }

    /**
     * Approve the current transaction
     */
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

    /**
     * Reject the current transaction
     */
    function rejectTransaction() {
        const comment = prompt('Rejection comment (required):');
        if (!comment) {
            alert('Comment is required for rejection.');
            return;
        }
        const rec = currentRecord.get();
        callAction('reject', rec.id, rec.type, comment);
    }

    /**
     * Recall a submitted transaction
     */
    function recallTransaction() {
        if (!confirm('Are you sure you want to recall this transaction?')) {
            return;
        }
        const rec = currentRecord.get();
        callAction('recall', rec.id, rec.type);
    }

    /**
     * Resubmit a rejected transaction
     */
    function resubmitForApproval() {
        const rec = currentRecord.get();
        callAction('resubmit', rec.id, rec.type);
    }

    /**
     * Recheck matching for Vendor Bill
     */
    function recheckMatching() {
        const rec = currentRecord.get();
        callAction('recheckMatching', rec.id, rec.type);
    }

    /**
     * Approve with exception override
     */
    function approveWithException() {
        const comment = prompt('Exception override comment (required):');
        if (!comment) {
            alert('Comment is required for exception override.');
            return;
        }
        const rec = currentRecord.get();
        callAction('approveException', rec.id, rec.type, comment);
    }

    /**
     * Call RESTlet to perform action
     */
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
                // Reload the page to show updated status
                location.reload();
            } else {
                alert('Error: ' + (result.message || 'Unknown error'));
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }

    /**
     * Page init - register custom functions
     */
    function pageInit(context) {
        // Functions are available globally for button onclick
    }

    return {
        pageInit: pageInit,
        submitForApproval: submitForApproval,
        approveTransaction: approveTransaction,
        rejectTransaction: rejectTransaction,
        recallTransaction: recallTransaction,
        resubmitForApproval: resubmitForApproval,
        recheckMatching: recheckMatching,
        approveWithException: approveWithException
    };
});
