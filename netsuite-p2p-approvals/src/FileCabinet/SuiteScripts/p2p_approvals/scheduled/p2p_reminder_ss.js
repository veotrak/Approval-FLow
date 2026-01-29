/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * Run every 4 hours
 */
define(['N/search', 'N/record', 'N/format', '../lib/p2p_notification_manager', '../constants/p2p_constants'
], function(search, record, format, notificationManager, constants) {
    'use strict';

    function execute(context) {
        try {
            sendReminderForAge(constants.CONFIG.REMINDER_HOURS[0], 1);
            sendReminderForAge(constants.CONFIG.REMINDER_HOURS[1], 2);
        } catch (error) {
            log.error('p2p_reminder_ss error', error);
        }
    }

    function sendReminderForAge(ageHours, maxCount) {
        const threshold = new Date();
        threshold.setHours(threshold.getHours() - ageHours);

        const reminderSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                'and',
                [constants.TASK_FIELDS.CREATED, 'onorbefore',
                    format.format({ value: threshold, type: format.Type.DATETIME })
                ],
                'and',
                [constants.TASK_FIELDS.REMINDER_COUNT, 'lessthan', maxCount]
            ],
            columns: [
                'internalid',
                constants.TASK_FIELDS.APPROVER,
                constants.TASK_FIELDS.ACTING_APPROVER,
                constants.TASK_FIELDS.TRAN_ID,
                constants.TASK_FIELDS.TRAN_TYPE,
                constants.TASK_FIELDS.REMINDER_COUNT
            ]
        });

        reminderSearch.run().each(function(result) {
            const taskId = result.getValue('internalid');
            const approver = result.getValue(constants.TASK_FIELDS.ACTING_APPROVER)
                || result.getValue(constants.TASK_FIELDS.APPROVER);

            notificationManager.sendReminder({
                taskId: taskId,
                approverId: approver,
                recordType: getRecordTypeByTranType(result.getValue(constants.TASK_FIELDS.TRAN_TYPE)),
                recordId: result.getValue(constants.TASK_FIELDS.TRAN_ID)
            });

            const count = parseInt(result.getValue(constants.TASK_FIELDS.REMINDER_COUNT), 10) || 0;
            record.submitFields({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                id: taskId,
                values: {
                    [constants.TASK_FIELDS.REMINDER_COUNT]: count + 1
                }
            });
            return true;
        });
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
