/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * 
 * P2P Reminder Scheduled Script (v2 - Decision Table Architecture)
 * Sends reminders for pending approval tasks
 * Recommended schedule: Every 4 hours
 */
define([
    'N/search', 'N/record', 'N/format', 'N/runtime',
    '../lib/p2p_notification_manager_v2',
    '../lib/p2p_token_manager_v2',
    '../lib/p2p_config',
    '../constants/p2p_constants_v2'
], function(search, record, format, runtime, notificationManager, tokenManager, config, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;
    const STATUS = constants.TASK_STATUS;

    /**
     * Main execution
     */
    function execute(context) {
        log.audit('P2P Reminder Script', 'Starting execution');

        try {
            const globalConfig = config.getConfig();
            const reminderHours = globalConfig.reminderHours || [24, 48];

            // Process first reminder (e.g., 24 hours)
            if (reminderHours[0]) {
                sendRemindersForAge(reminderHours[0], 1);
            }

            // Process second reminder (e.g., 48 hours)
            if (reminderHours[1]) {
                sendRemindersForAge(reminderHours[1], 2);
            }

            // Refresh expiring tokens
            refreshExpiringTokens();

            // Cleanup expired tokens
            tokenManager.cleanupExpiredTokens();

            log.audit('P2P Reminder Script', 'Completed successfully');
        } catch (error) {
            log.error('P2P Reminder Script error', error);
        }
    }

    /**
     * Send reminders for tasks older than specified hours
     * 
     * @param {number} ageHours - Minimum age in hours
     * @param {number} maxReminderCount - Maximum reminder count to send
     */
    function sendRemindersForAge(ageHours, maxReminderCount) {
        log.debug('sendRemindersForAge', { ageHours: ageHours, maxCount: maxReminderCount });

        const threshold = new Date();
        threshold.setHours(threshold.getHours() - ageHours);
        const thresholdStr = format.format({ value: threshold, type: format.Type.DATETIME });

        const reminderSearch = search.create({
            type: RT.APPROVAL_TASK,
            filters: [
                [TF.STATUS, 'anyof', STATUS.PENDING],
                'and',
                [TF.CREATED, 'onorbefore', thresholdStr],
                'and',
                [TF.REMINDER_COUNT, 'lessthan', maxReminderCount]
            ],
            columns: [
                'internalid',
                TF.APPROVER,
                TF.ACTING_APPROVER,
                TF.TRAN_ID,
                TF.TRAN_TYPE,
                TF.REMINDER_COUNT,
                TF.PATH,
                TF.PATH_STEP
            ]
        });

        let processed = 0;
        let errors = 0;

        reminderSearch.run().each(function(result) {
            // Check governance
            if (runtime.getCurrentScript().getRemainingUsage() < 100) {
                log.audit('Governance limit approaching', 'Stopping reminder processing');
                return false;
            }

            try {
                const taskId = result.getValue('internalid');
                const approver = result.getValue(TF.ACTING_APPROVER) || result.getValue(TF.APPROVER);
                const tranType = result.getValue(TF.TRAN_TYPE);
                const tranId = result.getValue(TF.TRAN_ID);
                const currentCount = parseInt(result.getValue(TF.REMINDER_COUNT), 10) || 0;

                // Get record type
                const recordType = getRecordTypeFromTranType(tranType);

                // Send reminder
                notificationManager.sendReminder({
                    taskId: taskId,
                    approverId: approver,
                    recordType: recordType,
                    recordId: tranId,
                    reminderNumber: currentCount + 1
                });

                // Update reminder count
                record.submitFields({
                    type: RT.APPROVAL_TASK,
                    id: taskId,
                    values: {
                        [TF.REMINDER_COUNT]: currentCount + 1
                    }
                });

                processed++;
                log.debug('Reminder sent', { taskId: taskId, approver: approver, count: currentCount + 1 });

            } catch (error) {
                errors++;
                log.error('Error sending reminder', { 
                    taskId: result.getValue('internalid'), 
                    error: error.message 
                });
            }

            return true; // Continue to next result
        });

        log.audit('Reminders processed', { 
            ageHours: ageHours, 
            processed: processed, 
            errors: errors 
        });
    }

    /**
     * Refresh tokens that are expiring soon
     */
    function refreshExpiringTokens() {
        log.debug('refreshExpiringTokens', 'Starting token refresh');

        const expiringSoon = new Date();
        expiringSoon.setHours(expiringSoon.getHours() + 24); // Refresh if expiring within 24 hours
        const expiryStr = format.format({ value: expiringSoon, type: format.Type.DATETIME });

        const tokenSearch = search.create({
            type: RT.APPROVAL_TASK,
            filters: [
                [TF.STATUS, 'anyof', STATUS.PENDING],
                'and',
                [TF.TOKEN, 'isnotempty', ''],
                'and',
                [TF.TOKEN_EXPIRY, 'onorbefore', expiryStr],
                'and',
                [TF.TOKEN_EXPIRY, 'isnotempty', '']
            ],
            columns: ['internalid']
        });

        let refreshed = 0;

        tokenSearch.run().each(function(result) {
            if (runtime.getCurrentScript().getRemainingUsage() < 50) {
                return false;
            }

            try {
                const taskId = result.getValue('internalid');
                tokenManager.refreshToken(taskId);
                refreshed++;
            } catch (error) {
                log.error('Error refreshing token', error);
            }

            return true;
        });

        log.debug('Tokens refreshed', { count: refreshed });
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
