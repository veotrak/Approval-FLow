/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * 
 * P2P Vendor Bill Client Script (v2 - Decision Table Architecture)
 * Handles approval button actions for Vendor Bills
 */
define([
    'N/currentRecord', 'N/url', 'N/https', 'N/ui/dialog'
], function(currentRecord, url, https, dialog) {
    'use strict';

    /**
     * Page Init
     */
    function pageInit(context) {
        // No special initialization needed
    }

    /**
     * Submit for Approval
     */
    function submitForApproval() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        if (!recordId) {
            dialog.alert({
                title: 'Error',
                message: 'Please save the record before submitting for approval.'
            });
            return;
        }

        dialog.confirm({
            title: 'Submit for Approval',
            message: 'Are you sure you want to submit this Vendor Bill for approval?'
        }).then(function(result) {
            if (result) {
                callActionRestlet('submit', recordId, '', function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill submitted for approval.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to submit for approval.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Approve Record
     */
    function approveRecord() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        dialog.create({
            title: 'Approve Vendor Bill',
            message: 'Enter an optional comment:',
            buttons: [
                { label: 'Approve', value: 'approve' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(function(result) {
            if (result === 'approve') {
                // Use prompt for comment since dialog.create doesn't support input
                const comment = prompt('Enter an optional comment for approval:') || '';
                
                callActionRestlet('approve', recordId, comment, function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill approved successfully.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to approve.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Reject Record
     */
    function rejectRecord() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        const comment = prompt('Please enter a reason for rejection (required):');
        
        if (!comment || !comment.trim()) {
            dialog.alert({
                title: 'Comment Required',
                message: 'A comment is required when rejecting a Vendor Bill.'
            });
            return;
        }

        dialog.confirm({
            title: 'Confirm Rejection',
            message: 'Are you sure you want to reject this Vendor Bill?'
        }).then(function(result) {
            if (result) {
                callActionRestlet('reject', recordId, comment, function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill rejected.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to reject.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Approve with Exception Override
     */
    function approveWithException() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        dialog.confirm({
            title: 'Approve with Exception',
            message: 'This Vendor Bill has matching exceptions. Are you sure you want to approve it anyway?'
        }).then(function(result) {
            if (result) {
                const comment = prompt('Please enter a justification for approving with exception (required):');
                
                if (!comment || !comment.trim()) {
                    dialog.alert({
                        title: 'Comment Required',
                        message: 'A justification is required when approving with exception.'
                    });
                    return;
                }

                callActionRestlet('approveException', recordId, comment, function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill approved with exception override.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to approve with exception.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Resubmit for Approval
     */
    function resubmitForApproval() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        dialog.confirm({
            title: 'Resubmit for Approval',
            message: 'Are you sure you want to resubmit this Vendor Bill for approval?'
        }).then(function(result) {
            if (result) {
                callActionRestlet('resubmit', recordId, '', function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill resubmitted for approval.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to resubmit.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Recall Submission
     */
    function recallSubmission() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        dialog.confirm({
            title: 'Recall Submission',
            message: 'Are you sure you want to recall this Vendor Bill from approval?'
        }).then(function(result) {
            if (result) {
                callActionRestlet('recall', recordId, '', function(response) {
                    if (response.success) {
                        dialog.alert({
                            title: 'Success',
                            message: 'Vendor Bill recalled successfully.'
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to recall.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Recheck 3-Way Matching
     */
    function recheckMatching() {
        const rec = currentRecord.get();
        const recordId = rec.id;

        if (!recordId) {
            dialog.alert({
                title: 'Error',
                message: 'Please save the record before checking matching.'
            });
            return;
        }

        dialog.confirm({
            title: 'Recheck Matching',
            message: 'This will re-run 3-way matching validation. Continue?'
        }).then(function(result) {
            if (result) {
                callActionRestlet('recheckMatching', recordId, '', function(response) {
                    if (response.success) {
                        const result = response.result || {};
                        let message = 'Matching check complete.\n\n';
                        message += 'Status: ' + (result.status || 'Unknown') + '\n';
                        
                        if (result.exceptions && result.exceptions.length) {
                            message += 'Exceptions: ' + result.exceptions.join(', ') + '\n';
                        }
                        
                        if (result.anomalies && result.anomalies.length) {
                            message += 'Anomalies: ' + result.anomalies.join(', ');
                        }

                        dialog.alert({
                            title: 'Matching Results',
                            message: message
                        }).then(function() {
                            location.reload();
                        });
                    } else {
                        dialog.alert({
                            title: 'Error',
                            message: response.message || 'Failed to run matching check.'
                        });
                    }
                });
            }
        });
    }

    /**
     * Call Action RESTlet
     */
    function callActionRestlet(action, recordId, comment, callback) {
        try {
            const restletUrl = url.resolveScript({
                scriptId: 'customscript_p2p_action_rl',
                deploymentId: 'customdeploy_p2p_action'  // same as PO; use customdeploy_p2p_action_rl if you have a separate VB deployment
            });

            const payload = {
                action: action,
                recordType: 'vendorbill',
                recordId: recordId,
                comment: comment || ''
            };

            https.post.promise({
                url: restletUrl,
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            }).then(function(response) {
                let result;
                try {
                    result = JSON.parse(response.body);
                } catch (e) {
                    result = { success: false, message: 'Invalid response from server' };
                }
                callback(result);
            }).catch(function(error) {
                callback({ success: false, message: error.message || 'Network error' });
            });
        } catch (error) {
            callback({ success: false, message: error.message || 'Error calling action' });
        }
    }

    return {
        pageInit: pageInit,
        submitForApproval: submitForApproval,
        approveRecord: approveRecord,
        rejectRecord: rejectRecord,
        approveWithException: approveWithException,
        resubmitForApproval: resubmitForApproval,
        recallSubmission: recallSubmission,
        recheckMatching: recheckMatching
    };
});
