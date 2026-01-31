/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Controller - Unified entry point for all approval workflow actions
 */
define([
    'N/record', 'N/search', 'N/runtime',
    './p2p_config', './p2p_rule_matcher', './p2p_path_runner',
    './p2p_history_logger', './p2p_notification_manager', './p2p_native_status_sync',
    '../constants/p2p_constants_v2'
], function(
    record, search, runtime,
    config, ruleMatcher, pathRunner,
    historyLogger, notificationManager, nativeStatusSync, constants
) {
    'use strict';

    const BF = constants.BODY_FIELDS;
    const TF = constants.TASK_FIELDS;
    const ADMIN_ROLE = '3';

    function isAdmin() {
        return String(runtime.getCurrentUser().role) === ADMIN_ROLE;
    }

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
            const context = buildMatchContext(tran, tranType);

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
     * Preview rule match without changing transaction state
     * @param {Object} params
     * @param {string} params.recordType - NetSuite record type
     * @param {number} params.recordId - Transaction internal ID
     * @returns {Object} Result with matched rule/path or fallback
     */
    function previewMatch(params) {
        try {
            const tran = record.load({ type: params.recordType, id: params.recordId });
            const tranType = constants.TRANSACTION_TYPE_MAP[params.recordType];
            const context = buildMatchContext(tran, tranType);
            const match = ruleMatcher.findMatch(context);
            if (!match) {
                return { success: false, message: 'No matching approval rule found and no fallback configured.' };
            }
            return { success: true, match: match };
        } catch (error) {
            log.error('previewMatch error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Debug rule matching with detailed evaluations
     */
    function debugMatch(params) {
        try {
            const tran = record.load({ type: params.recordType, id: params.recordId });
            const tranType = constants.TRANSACTION_TYPE_MAP[params.recordType];
            const context = buildMatchContext(tran, tranType);
            return ruleMatcher.debugMatch(context);
        } catch (error) {
            log.error('debugMatch error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * List path steps for a given approval path (admin debug)
     * @param {Object} params
     * @param {string|number} params.pathId - Approval path internal ID
     * @returns {Object} Result with path info and steps
     */
    function listPathSteps(params) {
        try {
            const pathId = params.pathId;
            if (!pathId) {
                return { success: false, message: 'pathId required' };
            }
            const path = ruleMatcher.loadPath(pathId);
            const steps = ruleMatcher.loadPathSteps(pathId);
            return {
                success: true,
                pathId: pathId,
                path: path || null,
                steps: steps,
                stepCount: steps.length
            };
        } catch (error) {
            log.error('listPathSteps error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle auto-approve for low-risk POs
     */
    function handleAutoApprove(params, tran, context) {
        try {
            var values = {
                [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.APPROVED,
                [BF.CURRENT_STEP]: '',
                [BF.CURRENT_APPROVER]: '',
                [BF.MATCH_REASON]: 'Auto-approved (risk score: ' + (context.riskScore || 0) + ')'
            };
            nativeStatusSync.addNativeStatusToValues(values, constants.APPROVAL_STATUS.APPROVED);
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: values
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
     * Build rule matching context from a transaction record
     */
    function buildMatchContext(tran, tranType) {
        return {
            tranType: tranType,
            subsidiary: tran.getValue('subsidiary'),
            amount: parseFloat(tran.getValue('total')) || 0,
            department: tran.getValue('department'),
            location: tran.getValue('location'),
            riskScore: parseFloat(tran.getValue(BF.AI_RISK_SCORE)) || null,
            exceptionType: tran.getValue(BF.EXCEPTION_TYPE) || null
        };
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

            // Validate user is authorized (admin can process any task)
            const currentUser = runtime.getCurrentUser().id;
            const approver = task.getValue(TF.APPROVER);
            const actingApprover = task.getValue(TF.ACTING_APPROVER);

            if (!isAdmin()) {
                if (String(currentUser) !== String(approver) && String(currentUser) !== String(actingApprover)) {
                    return { success: false, message: 'Not authorized for this task' };
                }
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

            // Segregation of duties check (admins can bypass)
            if (!isAdmin() && !checkSegregationOfDuties(recordType, recordId, currentUser)) {
                return { success: false, message: 'Segregation of duties violation' };
            }

            // Update task
            task.setValue({ fieldId: TF.STATUS, value: constants.TASK_STATUS.APPROVED });
            task.setValue({ fieldId: TF.COMPLETED, value: new Date() });
            task.save();

            // Log history (when admin acts on another's task, show admin as acting approver)
            historyLogger.logAction({
                transactionType: tranType,
                transactionId: recordId,
                stepSequence: sequence,
                approver: approver,
                actingApprover: actingApprover || (isAdmin() && String(currentUser) !== String(approver) ? currentUser : null),
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

            if (!isAdmin()) {
                if (String(currentUser) !== String(approver) && String(currentUser) !== String(actingApprover)) {
                    return { success: false, message: 'Not authorized for this task' };
                }
            }

            const tranType = task.getValue(TF.TRAN_TYPE);
            const recordId = task.getValue(TF.TRAN_ID);
            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const sequence = task.getValue(TF.SEQUENCE);

            // Update task
            task.setValue({ fieldId: TF.STATUS, value: constants.TASK_STATUS.REJECTED });
            task.setValue({ fieldId: TF.COMPLETED, value: new Date() });
            task.save();

            // Log history (when admin acts on another's task, show admin as acting approver)
            historyLogger.logAction({
                transactionType: tranType,
                transactionId: recordId,
                stepSequence: sequence,
                approver: approver,
                actingApprover: actingApprover || (isAdmin() && String(currentUser) !== String(approver) ? currentUser : null),
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

            // Update transaction status (P2P + native approvalstatus for correct banner/posting)
            var values = { [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.REJECTED };
            nativeStatusSync.addNativeStatusToValues(values, constants.APPROVAL_STATUS.REJECTED);
            record.submitFields({
                type: recordType,
                id: recordId,
                values: values
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

            // Reset transaction (sync native status so banner reflects recalled state)
            var values = {
                [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.DRAFT,
                [BF.CURRENT_STEP]: '',
                [BF.CURRENT_APPROVER]: '',
                [BF.MATCHED_RULE]: '',
                [BF.APPROVAL_PATH]: '',
                [BF.MATCH_REASON]: ''
            };
            nativeStatusSync.addNativeStatusToValues(values, constants.APPROVAL_STATUS.DRAFT);
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: values
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
            // Reset to draft first (sync native status before resubmit)
            var values = {
                [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.DRAFT,
                [BF.CURRENT_STEP]: '',
                [BF.CURRENT_APPROVER]: '',
                [BF.MATCHED_RULE]: '',
                [BF.APPROVAL_PATH]: '',
                [BF.MATCH_REASON]: ''
            };
            nativeStatusSync.addNativeStatusToValues(values, constants.APPROVAL_STATUS.DRAFT);
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: values
            });

            // Do NOT increment revision on resubmit - per field description, revision should
            // only increment when an approved PO is edited with material changes (amount,
            // items, etc.). That is handled in p2p_po_ue.js handlePOEdit via hasRelevantChanges.

            // PO: Do NOT call handleSubmit - the submitFields (draft reset) above triggers
            // the PO afterSubmit user event, which already calls handleSubmit when it sees
            // DRAFT status. Calling handleSubmit again would create duplicate tasks.
            // VB: afterSubmit only does matching, so we must call handleSubmit here.
            if (params.recordType === 'purchaseorder') {
                return { success: true, status: 'resubmitted' };
            }
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
        previewMatch: previewMatch,
        debugMatch: debugMatch,
        listPathSteps: listPathSteps,
        findPendingTaskForUser: findPendingTaskForUser,
        checkSegregationOfDuties: checkSegregationOfDuties
    };
});
