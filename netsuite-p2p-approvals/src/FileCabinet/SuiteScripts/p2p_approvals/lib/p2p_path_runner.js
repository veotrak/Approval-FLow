/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Path Runner - Executes approval path steps, creates tasks, advances workflow
 */
define([
    'N/record', 'N/search', 'N/runtime',
    './p2p_config', './p2p_delegation_manager', './p2p_token_manager',
    './p2p_notification_manager', './p2p_history_logger',
    '../constants/p2p_constants_v2'
], function(
    record, search, runtime,
    config, delegationManager, tokenManager,
    notificationManager, historyLogger, constants
) {
    'use strict';

    const TF = constants.TASK_FIELDS;
    const BF = constants.BODY_FIELDS;

    /**
     * Start executing an approval path for a transaction
     * @param {Object} params
     * @param {string} params.tranType - Transaction type (1=PO, 2=VB)
     * @param {string} params.recordType - NetSuite record type (purchaseorder, vendorbill)
     * @param {number} params.recordId - Transaction internal ID
     * @param {Object} params.match - Match result from rule matcher
     * @param {number} [params.subsidiary] - Subsidiary for delegation lookup
     * @returns {Object} Result with created task count
     */
    function startPath(params) {
        try {
            if (!params || !params.match || !params.match.steps || !params.match.steps.length) {
                return { success: false, message: 'No steps to execute' };
            }

            const firstStep = params.match.steps[0];
            const createdTasks = createTasksForStep({
                tranType: params.tranType,
                recordType: params.recordType,
                recordId: params.recordId,
                pathId: params.match.path.id,
                step: firstStep,
                subsidiary: params.subsidiary
            });

            // Update transaction with path info
            const updateValues = {
                [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.PENDING_APPROVAL,
                [BF.CURRENT_STEP]: firstStep.sequence,
                [BF.CURRENT_APPROVER]: createdTasks.firstApprover || '',
                [BF.APPROVAL_PATH]: params.match.path.id,
                [BF.MATCH_REASON]: params.match.explanation.summary
            };

            if (params.match.rule) {
                updateValues[BF.MATCHED_RULE] = params.match.rule.id;
            }

            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: updateValues
            });

            // Log history
            historyLogger.logAction({
                transactionType: params.tranType,
                transactionId: params.recordId,
                stepSequence: firstStep.sequence,
                approver: runtime.getCurrentUser().id,
                action: constants.APPROVAL_ACTION.SUBMIT,
                comment: params.match.explanation.summary,
                method: constants.APPROVAL_METHOD.UI
            });

            return {
                success: true,
                tasksCreated: createdTasks.count,
                firstApprover: createdTasks.firstApprover,
                currentStep: firstStep.sequence
            };
        } catch (error) {
            log.error('startPath error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Advance to the next step after current step completes
     * @param {Object} params
     * @param {string} params.tranType - Transaction type
     * @param {string} params.recordType - NetSuite record type
     * @param {number} params.recordId - Transaction internal ID
     * @param {string} params.pathId - Approval path ID
     * @param {number} params.currentSequence - Current step sequence number
     * @param {number} [params.subsidiary] - Subsidiary for delegation
     * @returns {Object} Result with next step info or completion status
     */
    function advanceToNextStep(params) {
        try {
            // Load all steps for the path
            const allSteps = loadPathSteps(params.pathId);
            if (!allSteps.length) {
                return completeApproval(params);
            }

            // Find the next step
            const nextStep = allSteps.find(function(step) {
                return step.sequence > params.currentSequence;
            });

            if (!nextStep) {
                // No more steps - approval complete
                return completeApproval(params);
            }

            // Create tasks for next step
            const createdTasks = createTasksForStep({
                tranType: params.tranType,
                recordType: params.recordType,
                recordId: params.recordId,
                pathId: params.pathId,
                step: nextStep,
                subsidiary: params.subsidiary
            });

            // Update transaction
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [BF.CURRENT_STEP]: nextStep.sequence,
                    [BF.CURRENT_APPROVER]: createdTasks.firstApprover || ''
                }
            });

            return {
                success: true,
                status: 'next_step',
                currentStep: nextStep.sequence,
                tasksCreated: createdTasks.count
            };
        } catch (error) {
            log.error('advanceToNextStep error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Complete the approval process
     */
    function completeApproval(params) {
        try {
            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [BF.APPROVAL_STATUS]: constants.APPROVAL_STATUS.APPROVED,
                    [BF.CURRENT_STEP]: '',
                    [BF.CURRENT_APPROVER]: ''
                }
            });

            // Notify requestor
            notificationManager.sendApprovedNotification({
                recordType: params.recordType,
                recordId: params.recordId,
                requestorId: getRequestorId(params.recordType, params.recordId)
            });

            return {
                success: true,
                status: 'approved'
            };
        } catch (error) {
            log.error('completeApproval error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Create approval tasks for a step
     * @param {Object} params
     * @returns {Object} Result with task count and first approver
     */
    function createTasksForStep(params) {
        const step = params.step;
        const approvers = resolveApprovers(step);
        
        if (!approvers.length) {
            log.error('createTasksForStep', 'No approvers resolved for step: ' + step.id);
            return { count: 0, firstApprover: null };
        }

        const cfg = config.getConfig();
        const isParallel = step.mode === constants.EXECUTION_MODE.PARALLEL;
        const targetApprovers = isParallel ? approvers : [approvers[0]];
        
        let count = 0;
        let firstApprover = null;

        targetApprovers.forEach(function(approverId) {
            // Check for delegation
            const delegation = delegationManager.findActiveDelegation({
                approverId: approverId,
                subsidiary: params.subsidiary,
                transactionType: params.tranType
            });
            const actingApprover = delegation ? delegation.delegateId : null;

            // Create task
            const task = record.create({ type: constants.RECORD_TYPES.APPROVAL_TASK });
            task.setValue({ fieldId: TF.TRAN_TYPE, value: params.tranType });
            task.setValue({ fieldId: TF.TRAN_ID, value: params.recordId });
            task.setValue({ fieldId: TF.PATH, value: params.pathId });
            task.setValue({ fieldId: TF.PATH_STEP, value: step.id });
            task.setValue({ fieldId: TF.SEQUENCE, value: step.sequence });
            task.setValue({ fieldId: TF.APPROVER, value: approverId });
            
            if (actingApprover) {
                task.setValue({ fieldId: TF.ACTING_APPROVER, value: actingApprover });
            }
            
            task.setValue({ fieldId: TF.STATUS, value: constants.TASK_STATUS.PENDING });
            task.setValue({ fieldId: TF.CREATED, value: new Date() });
            task.setValue({ fieldId: TF.REMINDER_COUNT, value: 0 });

            // Generate email token
            const token = tokenManager.generateToken();
            const tokenExpiry = new Date();
            tokenExpiry.setHours(tokenExpiry.getHours() + cfg.tokenExpiryHrs);
            task.setValue({ fieldId: TF.TOKEN, value: token });
            task.setValue({ fieldId: TF.TOKEN_EXPIRY, value: tokenExpiry });

            const taskId = task.save();
            count++;

            if (!firstApprover) {
                firstApprover = actingApprover || approverId;
            }

            // Send notification
            notificationManager.sendApprovalRequest({
                taskId: taskId,
                approverId: actingApprover || approverId,
                recordType: params.recordType,
                recordId: params.recordId
            });
        });

        return { count: count, firstApprover: firstApprover };
    }

    /**
     * Resolve approvers for a step based on approver type
     * @param {Object} step - Path step
     * @returns {string[]} Array of employee internal IDs
     */
    function resolveApprovers(step) {
        if (step.approverType === constants.APPROVER_TYPE.NAMED_PERSON) {
            return step.employee ? [step.employee] : [];
        }

        if (step.approverType === constants.APPROVER_TYPE.ROLE) {
            if (!step.role) return [];
            
            const employees = [];
            const empSearch = search.create({
                type: 'employee',
                filters: [
                    ['role', 'anyof', step.role],
                    'and',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['internalid']
            });

            empSearch.run().each(function(result) {
                employees.push(result.getValue('internalid'));
                return true;
            });

            return employees;
        }

        return [];
    }

    /**
     * Check if all tasks for current step are complete
     * @param {string} tranType - Transaction type
     * @param {number} recordId - Transaction ID
     * @param {number} sequence - Step sequence
     * @returns {boolean} True if step is complete
     */
    function isStepComplete(tranType, recordId, sequence) {
        const pendingSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [TF.TRAN_TYPE, 'anyof', tranType],
                'and',
                [TF.TRAN_ID, 'equalto', recordId],
                'and',
                [TF.SEQUENCE, 'equalto', sequence],
                'and',
                [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
            ],
            columns: ['internalid']
        });

        const results = pendingSearch.run().getRange({ start: 0, end: 1 });
        return !results || !results.length;
    }

    /**
     * Cancel all pending tasks for a transaction (used on rejection)
     * @param {Object} params
     */
    function cancelPendingTasks(params) {
        try {
            const pendingSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                filters: [
                    [TF.TRAN_TYPE, 'anyof', params.tranType],
                    'and',
                    [TF.TRAN_ID, 'equalto', params.recordId],
                    'and',
                    [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
                ],
                columns: ['internalid', TF.APPROVER, TF.ACTING_APPROVER, TF.SEQUENCE]
            });

            pendingSearch.run().each(function(result) {
                const taskId = result.getValue('internalid');
                
                record.submitFields({
                    type: constants.RECORD_TYPES.APPROVAL_TASK,
                    id: taskId,
                    values: {
                        [TF.STATUS]: constants.TASK_STATUS.CANCELLED,
                        [TF.COMPLETED]: new Date(),
                        [TF.TOKEN]: '',
                        [TF.TOKEN_EXPIRY]: ''
                    }
                });

                historyLogger.logAction({
                    transactionType: params.tranType,
                    transactionId: params.recordId,
                    stepSequence: result.getValue(TF.SEQUENCE),
                    approver: result.getValue(TF.APPROVER),
                    actingApprover: result.getValue(TF.ACTING_APPROVER),
                    action: constants.APPROVAL_ACTION.REJECT,
                    comment: params.reason || 'Cancelled due to rejection',
                    method: params.method || constants.APPROVAL_METHOD.UI
                });

                return true;
            });
        } catch (error) {
            log.error('cancelPendingTasks error', error);
        }
    }

    /**
     * Load path steps (helper)
     */
    function loadPathSteps(pathId) {
        if (!pathId) return [];

        const SF = constants.STEP_FIELDS;
        const stepSearch = search.create({
            type: constants.RECORD_TYPES.PATH_STEP,
            filters: [
                [SF.PATH, 'anyof', pathId],
                'and',
                [SF.ACTIVE, 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: SF.SEQUENCE, sort: search.Sort.ASC }),
                SF.NAME,
                SF.APPROVER_TYPE,
                SF.ROLE,
                SF.EMPLOYEE,
                SF.MODE,
                SF.REQUIRE_COMMENT,
                SF.SLA_HOURS
            ]
        });

        const steps = [];
        stepSearch.run().each(function(result) {
            steps.push({
                id: result.id,
                sequence: parseInt(result.getValue(SF.SEQUENCE), 10),
                name: result.getValue(SF.NAME),
                approverType: result.getValue(SF.APPROVER_TYPE),
                role: result.getValue(SF.ROLE),
                employee: result.getValue(SF.EMPLOYEE),
                mode: result.getValue(SF.MODE),
                requireComment: result.getValue(SF.REQUIRE_COMMENT) === true || result.getValue(SF.REQUIRE_COMMENT) === 'T',
                slaHours: parseInt(result.getValue(SF.SLA_HOURS), 10) || null
            });
            return true;
        });

        return steps;
    }

    /**
     * Get requestor ID for notifications
     */
    function getRequestorId(recordType, recordId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            return tran.getValue('employee') || tran.getValue('requestor') || tran.getValue('createdby');
        } catch (error) {
            log.error('getRequestorId error', error);
            return null;
        }
    }

    return {
        startPath: startPath,
        advanceToNextStep: advanceToNextStep,
        completeApproval: completeApproval,
        createTasksForStep: createTasksForStep,
        resolveApprovers: resolveApprovers,
        isStepComplete: isStepComplete,
        cancelPendingTasks: cancelPendingTasks
    };
});
