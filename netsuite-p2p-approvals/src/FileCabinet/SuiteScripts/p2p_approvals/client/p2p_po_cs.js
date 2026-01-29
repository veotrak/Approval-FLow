/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/url', 'N/https'], function(currentRecord, url, https) {
    'use strict';

    function submitForApproval() {
        const recordId = currentRecord.get().id;
        callRestlet('submit', recordId);
    }

    function approveRecord() {
        const recordId = currentRecord.get().id;
        const comment = prompt('Optional comment for approval:') || '';
        callRestlet('approve', recordId, comment);
    }

    function rejectRecord() {
        const recordId = currentRecord.get().id;
        const comment = prompt('Rejection comment (required):');
        if (!comment) {
            alert('Comment is required to reject.');
            return;
        }
        callRestlet('reject', recordId, comment);
    }

    function resubmitForApproval() {
        const recordId = currentRecord.get().id;
        callRestlet('resubmit', recordId);
    }

    function callRestlet(action, recordId, comment) {
        try {
            const restletUrl = url.resolveScript({
                scriptId: 'customscript_p2p_ai_integration_rl',
                deploymentId: 'customdeploy_p2p_ai_integration'
            });

            https.post({
                url: restletUrl,
                body: JSON.stringify({
                    action: action,
                    recordType: 'purchaseorder',
                    recordId: recordId,
                    comment: comment || ''
                }),
                headers: { 'Content-Type': 'application/json' }
            });
            location.reload();
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }

    return {
        submitForApproval: submitForApproval,
        approveRecord: approveRecord,
        rejectRecord: rejectRecord,
        resubmitForApproval: resubmitForApproval
    };
});
