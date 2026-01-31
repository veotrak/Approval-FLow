/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * 
 * P2P Action RESTlet (v2 - Decision Table Architecture)
 * Handles all approval workflow actions
 */
define([
    'N/record', 'N/runtime', 'N/search',
    '../lib/p2p_controller', '../lib/p2p_matching_engine',
    '../constants/p2p_constants_v2'
], function(
    record, runtime, search,
    controller, matchingEngine, constants
) {
    'use strict';

    const ADMIN_ROLE = '3';
    const BF = constants.BODY_FIELDS;
    const TF = constants.TASK_FIELDS;

    function get(params) {
        try {
            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                message: 'P2P Approval RESTlet. Use POST with JSON body: { action, recordType, recordId, ... }',
                actions: ['submit', 'approve', 'reject', 'recall', 'resubmit', 'previewMatch', 'debugMatch', 'listPathSteps']
            };
        } catch (e) {
            log.error('get error', e);
            return { status: 'error', message: e.message };
        }
    }

    function post(body) {
        try {
            if (body === undefined || body === null) {
                return { success: false, message: 'Request body required. Use POST with JSON: { action, recordType, recordId, ... }' };
            }
            const payload = typeof body === 'string' ? (body.trim() ? JSON.parse(body) : null) : body;
            if (!payload || typeof payload !== 'object') {
                return { success: false, message: 'Invalid request body. Expected JSON object with action field.' };
            }
            const action = payload.action;
            const recordType = payload.recordType;
            const recordId = payload.recordId;
            const pathId = payload.pathId;
            const comment = payload.comment;

            if (!action) {
                return { success: false, message: 'Missing required parameters' };
            }
            if (action !== 'listPathSteps' && (!recordType || !recordId)) {
                return { success: false, message: 'Missing required parameters (recordType, recordId)' };
            }
            if (action === 'listPathSteps' && !pathId) {
                return { success: false, message: 'Missing required parameter (pathId)' };
            }

            // Authorization check
            if (!isAuthorized(action, recordType, recordId)) {
                return { success: false, message: 'Not authorized for this action' };
            }

            // Route to appropriate handler
            switch (action) {
                case 'submit':
                    return controller.handleSubmit({ recordType, recordId });

                case 'approve':
                    return handleApproveAction(recordType, recordId, comment);

                case 'reject':
                    return handleRejectAction(recordType, recordId, comment);

                case 'recall':
                    return controller.handleRecall({ recordType, recordId });

                case 'resubmit':
                    return controller.handleResubmit({ recordType, recordId });

                case 'previewMatch':
                    return controller.previewMatch({ recordType, recordId });

                case 'debugMatch':
                    return controller.debugMatch({ recordType, recordId });

                case 'listPathSteps':
                    return controller.listPathSteps({ pathId: pathId });

                case 'parallelAnyScenario':
                    return handleParallelAnyScenario(recordType, recordId, payload);

                case 'recheckMatching':
                    return handleRecheckMatching(recordId);

                case 'approveException':
                    return handleApproveWithException(recordType, recordId, comment);

                case 'score':
                    return handleRiskScore(recordType, recordId, payload);

                default:
                    return { success: false, message: 'Unknown action: ' + action };
            }
        } catch (error) {
            log.error('post error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle approve action - find task and delegate to controller
     */
    function handleApproveAction(recordType, recordId, comment, actionOverride) {
        const taskId = controller.findPendingTaskForUser(recordType, recordId);
        
        if (!taskId) {
            // Check if admin can take over any pending task
            if (isAdmin()) {
                const anyTask = findAnyPendingTask(recordType, recordId);
                if (anyTask) {
                    assignActingApprover(anyTask, runtime.getCurrentUser().id);
                    return controller.handleApprove({
                        taskId: anyTask,
                        comment: comment,
                        method: constants.APPROVAL_METHOD.UI,
                        actionOverride: actionOverride
                    });
                }
            }
            return { success: false, message: 'No pending task found for user' };
        }

        return controller.handleApprove({
            taskId: taskId,
            comment: comment,
            method: constants.APPROVAL_METHOD.UI,
            actionOverride: actionOverride
        });
    }

    /**
     * Handle reject action
     */
    function handleRejectAction(recordType, recordId, comment) {
        if (!comment) {
            return { success: false, message: 'Comment required for rejection' };
        }

        const taskId = controller.findPendingTaskForUser(recordType, recordId);
        
        if (!taskId) {
            if (isAdmin()) {
                const anyTask = findAnyPendingTask(recordType, recordId);
                if (anyTask) {
                    assignActingApprover(anyTask, runtime.getCurrentUser().id);
                    return controller.handleReject({
                        taskId: anyTask,
                        comment: comment,
                        method: constants.APPROVAL_METHOD.UI
                    });
                }
            }
            return { success: false, message: 'No pending task found for user' };
        }

        return controller.handleReject({
            taskId: taskId,
            comment: comment,
            method: constants.APPROVAL_METHOD.UI
        });
    }

    /**
     * Recheck 3-way matching for Vendor Bill
     */
    function handleRecheckMatching(recordId) {
        try {
            const result = matchingEngine.performMatchValidation({ recordId: recordId });
            
            const vbRec = record.load({ type: 'vendorbill', id: recordId });
            const existingFlags = vbRec.getValue(BF.AI_RISK_FLAGS) || '';
            
            // Build exception flags
            const exceptionFlags = result.exceptions && result.exceptions.length
                ? 'Matching Exceptions: ' + result.exceptions.join(', ')
                : '';
            
            // Build anomaly flags
            const anomalyFlags = result.anomalies && result.anomalies.length
                ? 'Anomalies: ' + result.anomalies.join(', ')
                : '';

            // Merge flags
            let mergedFlags = existingFlags;
            if (exceptionFlags) {
                mergedFlags = mergedFlags ? mergedFlags + ' | ' + exceptionFlags : exceptionFlags;
            }
            if (anomalyFlags) {
                mergedFlags = mergedFlags ? mergedFlags + ' | ' + anomalyFlags : anomalyFlags;
            }

            record.submitFields({
                type: 'vendorbill',
                id: recordId,
                values: {
                    [BF.MATCH_STATUS]: result.status,
                    [BF.EXCEPTION_TYPE]: result.primaryException || '',
                    [BF.AI_RISK_FLAGS]: mergedFlags
                }
            });

            return { success: true, result: result };
        } catch (error) {
            log.error('handleRecheckMatching error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Approve with exception override
     */
    function handleApproveWithException(recordType, recordId, comment) {
        if (!comment) {
            return { success: false, message: 'Comment required for exception override' };
        }

        // Clear exception and proceed with normal approve
        record.submitFields({
            type: recordType,
            id: recordId,
            values: {
                [BF.EXCEPTION_TYPE]: '',
                [BF.MATCH_STATUS]: constants.MATCH_STATUS.EXCEPTION_OVERRIDDEN
            }
        });

        return handleApproveAction(
            recordType,
            recordId,
            'Exception Override: ' + comment,
            constants.APPROVAL_ACTION.EXCEPTION_OVERRIDE
        );
    }

    /**
     * Scenario runner for Parallel Any steps
     * - Optionally submit if not pending
     * - Approve one task
     * - Verify remaining tasks auto-cancel
     */
    function handleParallelAnyScenario(recordType, recordId, payload) {
        try {
            if (!recordType || !recordId) {
                return { success: false, message: 'Missing recordType or recordId' };
            }

            const submitIfNeeded = payload && Object.prototype.hasOwnProperty.call(payload, 'submitIfNeeded')
                ? payload.submitIfNeeded !== false
                : true;
            const comment = payload && payload.comment
                ? String(payload.comment)
                : 'Parallel Any scenario runner';

            if (submitIfNeeded) {
                const tran = record.load({ type: recordType, id: recordId });
                if (tran.getValue(BF.APPROVAL_STATUS) !== constants.APPROVAL_STATUS.PENDING_APPROVAL) {
                    const submitResult = controller.handleSubmit({ recordType, recordId });
                    if (!submitResult.success) {
                        return submitResult;
                    }
                }
            }

            const targetTaskId = resolveScenarioTaskId(recordType, recordId, payload && payload.taskId);
            if (!targetTaskId) {
                return { success: false, message: 'No pending task found to approve' };
            }

            const task = record.load({ type: constants.RECORD_TYPES.APPROVAL_TASK, id: targetTaskId });
            const stepId = task.getValue(TF.PATH_STEP);
            const sequence = task.getValue(TF.SEQUENCE);
            let stepMode = null;

            if (stepId) {
                const step = record.load({ type: constants.RECORD_TYPES.PATH_STEP, id: stepId });
                stepMode = step.getValue(constants.STEP_FIELDS.MODE);
            }

            if (stepMode !== constants.EXECUTION_MODE.PARALLEL_ANY) {
                return { 
                    success: false, 
                    message: 'Current step is not Parallel Any',
                    stepMode: stepMode
                };
            }

            const currentUser = runtime.getCurrentUser().id;
            const approverId = task.getValue(TF.APPROVER);
            const actingApproverId = task.getValue(TF.ACTING_APPROVER);
            if (String(currentUser) !== String(approverId) && String(currentUser) !== String(actingApproverId)) {
                assignActingApprover(targetTaskId, currentUser);
            }

            const approveResult = controller.handleApprove({
                taskId: targetTaskId,
                comment: comment,
                method: constants.APPROVAL_METHOD.API
            });

            if (!approveResult.success) {
                return approveResult;
            }

            return {
                success: true,
                approvedTaskId: targetTaskId,
                pendingTasksForSequence: countPendingTasks(recordType, recordId, sequence),
                pendingTasksTotal: countPendingTasks(recordType, recordId)
            };
        } catch (error) {
            log.error('handleParallelAnyScenario error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle AI risk score update
     */
    function handleRiskScore(recordType, recordId, payload) {
        try {
            record.submitFields({
                type: recordType,
                id: recordId,
                values: {
                    [BF.AI_RISK_SCORE]: payload.riskScore || 0,
                    [BF.AI_RISK_FLAGS]: payload.riskFlags || '',
                    [BF.AI_RISK_SUMMARY]: payload.riskSummary || '',
                    [BF.AI_EXCEPTION_SUGGESTION]: payload.exceptionSuggestion || ''
                }
            });
            return { success: true, riskScore: payload.riskScore };
        } catch (error) {
            log.error('handleRiskScore error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Authorization check
     */
    function isAuthorized(action, recordType, recordId) {
        const user = runtime.getCurrentUser();

        // Admin always authorized
        if (isAdmin()) return true;

        // Check based on action type
        if (action === 'approve' || action === 'reject' || action === 'approveException') {
            return isApprover(recordType, recordId, user.id);
        }

        if (action === 'submit' || action === 'resubmit' || action === 'recall') {
            return isSubmitter(recordType, recordId, user.id);
        }

        if (action === 'recheckMatching') {
            return isApprover(recordType, recordId, user.id);
        }

        if (action === 'previewMatch') {
            return isAdmin();
        }

        if (action === 'debugMatch') {
            return isAdmin();
        }

        if (action === 'listPathSteps') {
            return isAdmin();
        }

        if (action === 'parallelAnyScenario') {
            return isAdmin();
        }

        if (action === 'score') {
            return isAdmin();
        }

        return false;
    }

    function isAdmin() {
        return String(runtime.getCurrentUser().role) === ADMIN_ROLE;
    }

    function isApprover(recordType, recordId, userId) {
        return !!controller.findPendingTaskForUser(recordType, recordId);
    }

    function isSubmitter(recordType, recordId, userId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            const createdBy = tran.getValue('createdby');
            const requestor = tran.getValue('employee') || tran.getValue('requestor');
            
            return String(userId) === String(createdBy) || String(userId) === String(requestor);
        } catch (error) {
            return false;
        }
    }

    function findAnyPendingTask(recordType, recordId) {
        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];

        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [TF.TRAN_TYPE, 'anyof', tranType],
                'and',
                [TF.TRAN_ID, 'equalto', recordId],
                'and',
                [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
            ],
            columns: [
                search.createColumn({ name: TF.SEQUENCE, sort: search.Sort.ASC }),
                'internalid'
            ]
        });

        const results = taskSearch.run().getRange({ start: 0, end: 1 });
        return results && results.length ? results[0].getValue('internalid') : null;
    }

    function resolveScenarioTaskId(recordType, recordId, requestedTaskId) {
        if (requestedTaskId) {
            return requestedTaskId;
        }

        const taskId = controller.findPendingTaskForUser(recordType, recordId);
        if (taskId) {
            return taskId;
        }

        if (isAdmin()) {
            const anyTask = findAnyPendingTask(recordType, recordId);
            if (anyTask) {
                assignActingApprover(anyTask, runtime.getCurrentUser().id);
                return anyTask;
            }
        }

        return null;
    }

    function countPendingTasks(recordType, recordId, sequence) {
        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];
        const filters = [
            [TF.TRAN_TYPE, 'anyof', tranType],
            'and',
            [TF.TRAN_ID, 'equalto', recordId],
            'and',
            [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
        ];

        if (sequence !== undefined && sequence !== null && sequence !== '') {
            filters.push('and', [TF.SEQUENCE, 'equalto', sequence]);
        }

        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: filters,
            columns: ['internalid']
        });

        const results = taskSearch.run().getRange({ start: 0, end: 1 });
        if (results && results.length) {
            return taskSearch.runPaged({ pageSize: 1000 }).count;
        }
        return 0;
    }

    function assignActingApprover(taskId, userId) {
        try {
            record.submitFields({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                id: taskId,
                values: {
                    [constants.TASK_FIELDS.ACTING_APPROVER]: userId
                }
            });
        } catch (error) {
            log.error('assignActingApprover error', error);
        }
    }

    return { get: get, post: post };
});
