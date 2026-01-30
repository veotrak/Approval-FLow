/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Controller - Unified entry point for all approval workflow actions
 */
define([
    'N/record', 'N/search', 'N/runtime',
    './p2p_config', './p2p_rule_matcher', './p2p_path_runner',
    './p2p_history_logger', './p2p_notification_manager',
    '../constants/p2p_constants_v2'
], function(
    record, search, runtime,
    config, ruleMatcher, pathRunner,
    historyLogger, notificationManager, constants
) {
    'use strict';

    const BF = constants.BODY_FIELDS;
    const TF = constants.TASK_FIELDS;

    /**
     * Submit a transaction for approval
     * @param {Object} params
     * @param {string} params.recordType - NetSuite record type
     * @param {number} params.recordId - Transaction internal ID
     * @returns {Object} Result
     */
    function handleSubmit(params) {
        try {
            const tran = record.load({ type: params.recordType, id: params.recordId });
            const tranType = constants.TRANSACTION_TYPE_MAP[params.recordType];
            
            // Build context for rule matching
            const context = {
                tranType: tranType,
                subsidiary: tran.getValue('subsidiary'),
                amount: parseFloat(tran.getValue('total')) || 0,
                department: tran.getValue('department'),
                location: tran.getValue('location'),
                riskScore: parseFloat(tran.getValue(BF.AI_RISK_SCORE)) || null,
                exceptionType: tran.getValue(BF.EXCEPTION_TYPE) || null
            };

            // Check for auto-approve (PO only, low risk, no exceptions)
            const cfg = config.getConfig();
            if (shouldAutoApprove(params.recordType, context, cfg)) {
                return handleAutoApprove(params, tran, context);
            }

            // Find matching rule
            const match = ruleMatcher.findMatch(context);
            if (!match) {
                return {
                    success: false,
                    message: 'No matching approval rule found and no fallback configured.'
                };
            }

            // Start the approval path
            const result = pathRunner.startPath({
                tranType: tranType,
                recordType: params.recordType,
                recordId: params.recordId,
                match: match,
                subsidiary: context.subsidiary
            });

            return result;
        } catch (error) {
            log.error('handleSubmit error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle auto-approve for low-risk POs
     */
    function handleAutoApprove(params, tran, context) {
        try {
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.APPROVED,
                    [BF.CURRENT_STEP]: '',
                    [BF.CURRENT_APPROVER]: '',
                    [BF.MATCH_REASON]: 'Auto-approved (risk score: ' + (context.riskScore || 0) + ')'
                }
            });

            historyLogger.logAction({
                transactionType: context.tranType,
                transactionId: params.recordId,
                stepSequence: 0,
                approver: runtime.getCurrentUser().id,
                action: constants.APPROVAL_ACTION.APPROVE,
                comment: 'Auto-approved - low risk',
                method: constants.APPROVAL_METHOD.API
            });

            notificationManager.sendApprovedNotification({
                recordType: params.recordType,
                recordId: params.recordId,
                requestorId: tran.getValue('createdby')
            });

            return { success: true, autoApproved: true };
        } catch (error) {
            log.error('handleAutoApprove error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Check if transaction qualifies for auto-approve
     */
    function shouldAutoApprove(recordType, context, cfg) {
        // Only POs
        if (recordType !== 'purchaseorder') return false;
        
        // Feature must be enabled
        if (!cfg.autoApproveEnabled) return false;
        
        // Must have threshold configured
        if (!cfg.autoApproveThreshold) return false;
        
        // No exceptions
        if (context.exceptionType) return false;
        
        // Risk score must be at or below threshold
        if (context.riskScore === null || context.riskScore > cfg.autoApproveThreshold) return false;
        
        return true;
    }

    /**
     * Approve a pending task
     * @param {Object} params
     * @param {number} params.taskId - Task internal ID
     * @param {string} [params.comment] - Optional comment
     * @param {string} [params.method] - Approval method
     * @param {string} [params.ipAddress] - IP for email approvals
     * @returns {Object} Result
     */
    function handleApprove(params) {
        try {
            const task = record.load({ type: constants.RECORD_TYPES.APPROVAL_TASK, id: params.taskId });
            
            // Validate task is pending
            if (task.getValue(TF.STATUS) !== constants.TASK_STATUS.PENDING) {
                return { success: false, message: 'Task is not pending' };
            }

            // Validate user is authorized
            const currentUser = runtime.getCurrentUser().id;
            const approver = task.getValue(TF.APPROVER);
            const actingApprover = task.getValue(TF.ACTING_APPROVER);
            
            if (String(currentUser) !== String(approver) && String(currentUser) !== String(actingApprover)) {
                return { success: false, message: 'Not authorized for this task' };
            }

            const tranType = task.getValue(TF.TRAN_TYPE);
            const recordId = task.getValue(TF.TRAN_ID);
            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const sequence = task.getValue(TF.SEQUENCE);
            const pathId = task.getValue(TF.PATH);
            const stepId = task.getValue(TF.PATH_STEP);
            let stepMode = null;
            if (stepId) {
                const step = record.load({ type: constants.RECORD_TYPES.PATH_STEP, id: stepId });
                stepMode = step.getValue(constants.STEP_FIELDS.MODE);
            }

            // Segregation of duties check
            if (!checkSegregationOfDuties(recordType, recordId, currentUser)) {
                return { success: false, message: 'Segregation of duties violation' };
            }

            // Update task
            task.setValue({ fieldId: TF.STATUS, value: constants.TASK_STATUS.APPROVED });
            task.setValue({ fieldId: TF.COMPLETED, value: new Date() });
            task.save();

            // Log history
            historyLogger.logAction({
                transactionType: tranType,
                transactionId: recordId,
                stepSequence: sequence,
                approver: approver,
                actingApprover: actingApprover,
                action: constants.APPROVAL_ACTION.APPROVE,
                comment: params.comment,
                method: params.method || constants.APPROVAL_METHOD.UI,
                ipAddress: params.ipAddress
            });

            if (stepMode === constants.EXECUTION_MODE.PARALLEL_ANY) {
                pathRunner.cancelPendingTasks({
                    tranType: tranType,
                    recordId: recordId,
                    sequence: sequence,
                    excludeTaskId: params.taskId,
                    reason: 'Auto-cancelled - parallel any step approved by another approver',
                    method: params.method || constants.APPROVAL_METHOD.UI,
                    skipHistory: true
                });
            }

            // Check if step is complete
            if (!pathRunner.isStepComplete(tranType, recordId, sequence)) {
                return { success: true, status: 'pending_parallel' };
            }

            // Advance to next step
            return pathRunner.advanceToNextStep({
                tranType: tranType,
                recordType: recordType,
                recordId: recordId,
                pathId: pathId,
                currentSequence: sequence,
                subsidiary: getSubsidiary(recordType, recordId)
            });
        } catch (error) {
            log.error('handleApprove error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Reject a pending task
     * @param {Object} params
     * @param {number} params.taskId - Task internal ID
     * @param {string} params.comment - Required comment
     * @param {string} [params.method] - Approval method
     * @param {string} [params.ipAddress] - IP for email approvals
     * @returns {Object} Result
     */
    function handleReject(params) {
        try {
            const task = record.load({ type: constants.RECORD_TYPES.APPROVAL_TASK, id: params.taskId });
            
            // Validate task is pending
            if (task.getValue(TF.STATUS) !== constants.TASK_STATUS.PENDING) {
                return { success: false, message: 'Task is not pending' };
            }

            // Check if comment is required
            const stepId = task.getValue(TF.PATH_STEP);
            if (stepId) {
                const step = record.load({ type: constants.RECORD_TYPES.PATH_STEP, id: stepId });
                const requireComment = step.getValue(constants.STEP_FIELDS.REQUIRE_COMMENT);
                if ((requireComment === true || requireComment === 'T') && !params.comment) {
                    return { success: false, message: 'Comment required for rejection' };
                }
            }

            const currentUser = runtime.getCurrentUser().id;
            const approver = task.getValue(TF.APPROVER);
            const actingApprover = task.getValue(TF.ACTING_APPROVER);

            if (String(currentUser) !== String(approver) && String(currentUser) !== String(actingApprover)) {
                return { success: false, message: 'Not authorized for this task' };
            }

            const tranType = task.getValue(TF.TRAN_TYPE);
            const recordId = task.getValue(TF.TRAN_ID);
            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const sequence = task.getValue(TF.SEQUENCE);

            // Update task
            task.setValue({ fieldId: TF.STATUS, value: constants.TASK_STATUS.REJECTED });
            task.setValue({ fieldId: TF.COMPLETED, value: new Date() });
            task.save();

            // Log history
            historyLogger.logAction({
                transactionType: tranType,
                transactionId: recordId,
                stepSequence: sequence,
                approver: approver,
                actingApprover: actingApprover,
                action: constants.APPROVAL_ACTION.REJECT,
                comment: params.comment,
                method: params.method || constants.APPROVAL_METHOD.UI,
                ipAddress: params.ipAddress
            });

            // Cancel other pending tasks for this transaction
            pathRunner.cancelPendingTasks({
                tranType: tranType,
                recordId: recordId,
                reason: 'Cancelled due to rejection',
                method: params.method || constants.APPROVAL_METHOD.UI,
                action: constants.APPROVAL_ACTION.REJECT
            });

            // Update transaction status
            record.submitFields({
                type: recordType,
                id: recordId,
                values: {
                    [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.REJECTED
                }
            });

            // Notify requestor
            notificationManager.sendRejectedNotification({
                recordType: recordType,
                recordId: recordId,
                requestorId: getRequestorId(recordType, recordId),
                comment: params.comment
            });

            return { success: true, status: 'rejected' };
        } catch (error) {
            log.error('handleReject error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Recall a submitted transaction (submitter only)
     * @param {Object} params
     * @param {string} params.recordType - NetSuite record type
     * @param {number} params.recordId - Transaction internal ID
     * @returns {Object} Result
     */
    function handleRecall(params) {
        try {
            const tran = record.load({ type: params.recordType, id: params.recordId });
            const tranType = constants.TRANSACTION_TYPE_MAP[params.recordType];
            const currentUser = runtime.getCurrentUser().id;

            // Only submitter or creator can recall
            const createdBy = tran.getValue('createdby');
            const requestor = tran.getValue('employee') || tran.getValue('requestor');
            
            if (String(currentUser) !== String(createdBy) && String(currentUser) !== String(requestor)) {
                return { success: false, message: 'Only the submitter can recall' };
            }

            // Must be in Pending Approval status
            if (tran.getValue(BF.APPROVAL_STATUS) !== constants.APPROVAL_STATUS.PENDING_APPROVAL) {
                return { success: false, message: 'Can only recall pending transactions' };
            }

            // Cancel pending tasks
            pathRunner.cancelPendingTasks({
                tranType: tranType,
                recordId: params.recordId,
                reason: 'Recalled by submitter',
                method: constants.APPROVAL_METHOD.UI,
                action: constants.APPROVAL_ACTION.RECALLED
            });

            // Reset transaction
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.DRAFT,
                    [BF.CURRENT_STEP]: '',
                    [BF.CURRENT_APPROVER]: '',
                    [BF.MATCHED_RULE]: '',
                    [BF.APPROVAL_PATH]: '',
                    [BF.MATCH_REASON]: ''
                }
            });

            historyLogger.logAction({
                transactionType: tranType,
                transactionId: params.recordId,
                stepSequence: 0,
                approver: currentUser,
                action: constants.APPROVAL_ACTION.RECALLED,
                comment: 'Recalled by submitter',
                method: constants.APPROVAL_METHOD.UI
            });

            return { success: true, status: 'recalled' };
        } catch (error) {
            log.error('handleRecall error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Resubmit a rejected transaction
     */
    function handleResubmit(params) {
        try {
            // Reset to draft first
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.DRAFT,
                    [BF.CURRENT_STEP]: '',
                    [BF.CURRENT_APPROVER]: '',
                    [BF.MATCHED_RULE]: '',
                    [BF.APPROVAL_PATH]: '',
                    [BF.MATCH_REASON]: ''
                }
            });

            // Increment revision for PO
            if (params.recordType === 'purchaseorder') {
                const tran = record.load({ type: params.recordType, id: params.recordId });
                const revision = parseInt(tran.getValue(BF.REVISION_NUMBER), 10) || 0;
                record.submitFields({
                    type: params.recordType,
                    id: params.recordId,
                    values: {
                        [BF.REVISION_NUMBER]: revision + 1
                    }
                });
            }

            // Submit again
            return handleSubmit(params);
        } catch (error) {
            log.error('handleResubmit error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Find pending task for current user
     */
    function findPendingTaskForUser(recordType, recordId) {
        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];
        const currentUser = runtime.getCurrentUser().id;

        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [TF.TRAN_TYPE, 'anyof', tranType],
                'and',
                [TF.TRAN_ID, 'equalto', recordId],
                'and',
                [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                'and',
                [
                    [TF.APPROVER, 'anyof', currentUser],
                    'or',
                    [TF.ACTING_APPROVER, 'anyof', currentUser]
                ]
            ],
            columns: ['internalid']
        });

        const results = taskSearch.run().getRange({ start: 0, end: 1 });
        return results && results.length ? results[0].getValue('internalid') : null;
    }

    /**
     * Segregation of duties check
     */
    function checkSegregationOfDuties(recordType, recordId, approverId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            const createdBy = tran.getValue('createdby');
            const requestor = tran.getValue('employee') || tran.getValue('requestor');

            if (createdBy && String(createdBy) === String(approverId)) return false;
            if (requestor && String(requestor) === String(approverId)) return false;

            return true;
        } catch (error) {
            log.error('checkSegregationOfDuties error', error);
            return false;
        }
    }

    /**
     * Get subsidiary from transaction
     */
    function getSubsidiary(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return tran.getValue('subsidiary');
        } catch (error) {
            return null;
        }
    }

    /**
     * Get requestor ID
     */
    function getRequestorId(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return tran.getValue('employee') || tran.getValue('requestor') || tran.getValue('createdby');
        } catch (error) {
            return null;
        }
    }

    return {
        handleSubmit: handleSubmit,
        handleApprove: handleApprove,
        handleReject: handleReject,
        handleRecall: handleRecall,
        handleResubmit: handleResubmit,
        findPendingTaskForUser: findPendingTaskForUser,
        checkSegregationOfDuties: checkSegregationOfDuties
    };
});
