/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * 
 * P2P Escalation Scheduled Script (v2 - Decision Table Architecture)
 * Escalates overdue approval tasks to managers
 * Recommended schedule: Every 4 hours
 */
define([
    'N/search', 'N/record', 'N/format', 'N/runtime',
    '../lib/p2p_notification_manager',
    '../lib/p2p_token_manager',
    '../lib/p2p_history_logger',
    '../lib/p2p_config',
    '../constants/p2p_constants_v2'
], function(search, record, format, runtime, notificationManager, tokenManager, historyLogger, config, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;
    const STATUS = constants.TASK_STATUS;
    const ACTION = constants.APPROVAL_ACTION;
    const METHOD = constants.APPROVAL_METHOD;

    /**
     * Main execution
     */
    function execute(context) {
        log.audit('P2P Escalation Script', 'Starting execution');

        try {
            const globalConfig = config.getConfig();
            const escalationHours = globalConfig.escalationHours || 72;

            // Find and escalate overdue tasks
            processEscalations(escalationHours);

            // Process expired delegations
            cleanupExpiredDelegations();

            log.audit('P2P Escalation Script', 'Completed successfully');
        } catch (error) {
            log.error('P2P Escalation Script error', error);
        }
    }

    /**
     * Process escalations for overdue tasks
     * 
     * @param {number} escalationHours - Hours after which to escalate
     */
    function processEscalations(escalationHours) {
        log.debug('processEscalations', { hours: escalationHours });

        const threshold = new Date();
        threshold.setHours(threshold.getHours() - escalationHours);
        const thresholdStr = format.format({ value: threshold, type: format.Type.DATETIME });

        const escalationSearch = search.create({
            type: RT.APPROVAL_TASK,
            filters: [
                [TF.STATUS, 'anyof', STATUS.PENDING],
                'and',
                [TF.CREATED, 'onorbefore', thresholdStr],
                'and',
                [TF.ESCALATED, 'is', 'F']
            ],
            columns: [
                'internalid',
                TF.APPROVER,
                TF.ACTING_APPROVER,
                TF.TRAN_ID,
                TF.TRAN_TYPE,
                TF.SEQUENCE,
                TF.PATH,
                TF.PATH_STEP
            ]
        });

        let escalated = 0;
        let errors = 0;

        escalationSearch.run().each(function(result) {
            // Check governance
            if (runtime.getCurrentScript().getRemainingUsage() < 200) {
                log.audit('Governance limit approaching', 'Stopping escalation processing');
                return false;
            }

            try {
                const taskId = result.getValue('internalid');
                const originalApprover = result.getValue(TF.APPROVER);
                const tranType = result.getValue(TF.TRAN_TYPE);
                const tranId = result.getValue(TF.TRAN_ID);
                const sequence = result.getValue(TF.SEQUENCE);
                const pathId = result.getValue(TF.PATH);
                const pathStepId = result.getValue(TF.PATH_STEP);

                // Get manager for escalation
                const managerId = getManagerId(originalApprover);
                
                if (!managerId) {
                    log.debug('No manager found for escalation', { approver: originalApprover });
                    // Mark as escalated anyway to prevent repeated processing
                    record.submitFields({
                        type: RT.APPROVAL_TASK,
                        id: taskId,
                        values: { [TF.ESCALATED]: true }
                    });
                    return true;
                }

                // Create escalation task for manager
                const newTaskId = createEscalationTask({
                    originalTaskId: taskId,
                    originalApprover: originalApprover,
                    managerId: managerId,
                    tranType: tranType,
                    tranId: tranId,
                    sequence: sequence,
                    pathId: pathId,
                    pathStepId: pathStepId
                });

                if (newTaskId) {
                    // Mark original task as escalated
                    record.submitFields({
                        type: RT.APPROVAL_TASK,
                        id: taskId,
                        values: { 
                            [TF.ESCALATED]: true,
                            [TF.STATUS]: STATUS.ESCALATED
                        }
                    });

                    // Log escalation in history
                    historyLogger.logAction({
                        transactionType: tranType,
                        transactionId: tranId,
                        stepSequence: sequence,
                        approver: originalApprover,
                        action: ACTION.ESCALATE,
                        comment: 'Auto-escalated after ' + escalationHours + ' hours to manager',
                        method: METHOD.API
                    });

                    // Send escalation notification
                    const recordType = getRecordTypeFromTranType(tranType);
                    notificationManager.sendEscalation({
                        taskId: newTaskId,
                        managerId: managerId,
                        originalApprover: originalApprover,
                        recordType: recordType,
                        recordId: tranId
                    });

                    escalated++;
                    log.debug('Task escalated', { 
                        taskId: taskId, 
                        newTaskId: newTaskId,
                        from: originalApprover, 
                        to: managerId 
                    });
                }

            } catch (error) {
                errors++;
                log.error('Error escalating task', { 
                    taskId: result.getValue('internalid'), 
                    error: error.message 
                });
            }

            return true;
        });

        log.audit('Escalations processed', { escalated: escalated, errors: errors });
    }

    /**
     * Get manager ID for an employee
     */
    function getManagerId(employeeId) {
        try {
            if (!employeeId) return null;

            const emp = record.load({ type: 'employee', id: employeeId });
            const supervisorId = emp.getValue('supervisor');

            return supervisorId || null;
        } catch (error) {
            log.error('getManagerId error', error);
            return null;
        }
    }

    /**
     * Create escalation task for manager
     */
    function createEscalationTask(params) {
        try {
            const task = record.create({ type: RT.APPROVAL_TASK });

            task.setValue({ fieldId: TF.TRAN_TYPE, value: params.tranType });
            task.setValue({ fieldId: TF.TRAN_ID, value: params.tranId });
            task.setValue({ fieldId: TF.SEQUENCE, value: params.sequence });
            task.setValue({ fieldId: TF.APPROVER, value: params.managerId });
            task.setValue({ fieldId: TF.STATUS, value: STATUS.PENDING });
            task.setValue({ fieldId: TF.CREATED, value: new Date() });
            task.setValue({ fieldId: TF.REMINDER_COUNT, value: 0 });
            task.setValue({ fieldId: TF.ESCALATED, value: true }); // Mark as escalation task

            if (params.pathId) {
                task.setValue({ fieldId: TF.PATH, value: params.pathId });
            }
            if (params.pathStepId) {
                task.setValue({ fieldId: TF.PATH_STEP, value: params.pathStepId });
            }

            // Generate new token
            const globalConfig = config.getConfig();
            const token = tokenManager.generateToken();
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + (globalConfig.tokenExpiryHours || 72));

            task.setValue({ fieldId: TF.TOKEN, value: token });
            task.setValue({ fieldId: TF.TOKEN_EXPIRY, value: expiry });

            return task.save();
        } catch (error) {
            log.error('createEscalationTask error', error);
            return null;
        }
    }

    /**
     * Cleanup expired delegations
     */
    function cleanupExpiredDelegations() {
        try {
            const today = new Date();
            const todayStr = format.format({ value: today, type: format.Type.DATE });

            const expiredSearch = search.create({
                type: RT.DELEGATION,
                filters: [
                    [constants.DELEGATION_FIELDS.ACTIVE, 'is', 'T'],
                    'and',
                    [constants.DELEGATION_FIELDS.END_DATE, 'before', todayStr]
                ],
                columns: ['internalid']
            });

            let deactivated = 0;

            expiredSearch.run().each(function(result) {
                if (runtime.getCurrentScript().getRemainingUsage() < 50) {
                    return false;
                }

                try {
                    record.submitFields({
                        type: RT.DELEGATION,
                        id: result.getValue('internalid'),
                        values: { [constants.DELEGATION_FIELDS.ACTIVE]: false }
                    });
                    deactivated++;
                } catch (error) {
                    log.error('Error deactivating delegation', error);
                }

                return true;
            });

            if (deactivated > 0) {
                log.audit('Delegations deactivated', { count: deactivated });
            }
        } catch (error) {
            log.error('cleanupExpiredDelegations error', error);
        }
    }

    /**
     * Get record type from transaction type
     */
    function getRecordTypeFromTranType(tranType) {
        if (tranType === constants.TRANSACTION_TYPES.PURCHASE_ORDER) {
            return 'purchaseorder';
        }
        if (tranType === constants.TRANSACTION_TYPES.VENDOR_BILL) {
            return 'vendorbill';
        }
        return tranType;
    }

    return { execute: execute };
});
