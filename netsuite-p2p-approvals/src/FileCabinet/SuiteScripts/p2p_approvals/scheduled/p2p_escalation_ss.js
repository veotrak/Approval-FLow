/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * Run every 4 hours
 */
define(['N/search', 'N/record', 'N/format', '../lib/p2p_notification_manager',
        '../constants/p2p_constants', '../lib/p2p_token_manager'
], function(search, record, format, notificationManager, constants, tokenManager) {
    'use strict';

    function execute(context) {
        try {
            const threshold = new Date();
            threshold.setHours(threshold.getHours() - constants.CONFIG.ESCALATION_HOURS);

            const escalationSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                filters: [
                    [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                    'and',
                    [constants.TASK_FIELDS.CREATED, 'onorbefore',
                        format.format({ value: threshold, type: format.Type.DATETIME })
                    ],
                    'and',
                    [constants.TASK_FIELDS.ESCALATED, 'is', 'F']
                ],
                columns: [
                    'internalid',
                    constants.TASK_FIELDS.APPROVER,
                    constants.TASK_FIELDS.TRAN_ID,
                    constants.TASK_FIELDS.TRAN_TYPE,
                    constants.TASK_FIELDS.RULE,
                    constants.TASK_FIELDS.STEP,
                    constants.TASK_FIELDS.SEQUENCE
                ]
            });

            escalationSearch.run().each(function(result) {
                const taskId = result.getValue('internalid');
                const approverId = result.getValue(constants.TASK_FIELDS.APPROVER);
                const managerId = getManagerId(approverId);
                if (!managerId) {
                    return true;
                }

                const newTaskId = createEscalationTask(result, managerId);
                if (newTaskId) {
                    record.submitFields({
                        type: constants.RECORD_TYPES.APPROVAL_TASK,
                        id: taskId,
                        values: {
                            [constants.TASK_FIELDS.ESCALATED]: true
                        }
                    });

                    notificationManager.sendEscalation({
                        managerId: managerId,
                        recordType: getRecordTypeByTranType(result.getValue(constants.TASK_FIELDS.TRAN_TYPE)),
                        recordId: result.getValue(constants.TASK_FIELDS.TRAN_ID)
                    });
                }
                return true;
            });
        } catch (error) {
            log.error('p2p_escalation_ss error', error);
        }
    }

    function getManagerId(approverId) {
        try {
            const emp = record.load({ type: 'employee', id: approverId });
            return emp.getValue('supervisor');
        } catch (error) {
            log.error('getManagerId error', error);
            return null;
        }
    }

    function createEscalationTask(taskResult, managerId) {
        try {
            const task = record.create({ type: constants.RECORD_TYPES.APPROVAL_TASK });
            task.setValue({ fieldId: constants.TASK_FIELDS.TRAN_TYPE, value: taskResult.getValue(constants.TASK_FIELDS.TRAN_TYPE) });
            task.setValue({ fieldId: constants.TASK_FIELDS.TRAN_ID, value: taskResult.getValue(constants.TASK_FIELDS.TRAN_ID) });
            task.setValue({ fieldId: constants.TASK_FIELDS.RULE, value: taskResult.getValue(constants.TASK_FIELDS.RULE) });
            task.setValue({ fieldId: constants.TASK_FIELDS.STEP, value: taskResult.getValue(constants.TASK_FIELDS.STEP) });
            task.setValue({ fieldId: constants.TASK_FIELDS.SEQUENCE, value: taskResult.getValue(constants.TASK_FIELDS.SEQUENCE) });
            task.setValue({ fieldId: constants.TASK_FIELDS.APPROVER, value: managerId });
            task.setValue({ fieldId: constants.TASK_FIELDS.STATUS, value: constants.TASK_STATUS.PENDING });
            task.setValue({ fieldId: constants.TASK_FIELDS.CREATED, value: new Date() });
            task.setValue({ fieldId: constants.TASK_FIELDS.REMINDER_COUNT, value: 0 });
            task.setValue({ fieldId: constants.TASK_FIELDS.ESCALATED, value: true });

            const token = tokenManager.generateToken();
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + constants.CONFIG.TOKEN_EXPIRY_HOURS);
            task.setValue({ fieldId: constants.TASK_FIELDS.TOKEN, value: token });
            task.setValue({ fieldId: constants.TASK_FIELDS.TOKEN_EXPIRY, value: expiry });

            return task.save();
        } catch (error) {
            log.error('createEscalationTask error', error);
            return null;
        }
    }

    function getRecordTypeByTranType(tranType) {
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
