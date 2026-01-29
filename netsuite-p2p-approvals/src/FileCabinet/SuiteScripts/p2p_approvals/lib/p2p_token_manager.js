/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/crypto/random', 'N/encode', 'N/record', 'N/search', 'N/format', '../constants/p2p_constants'], function(
    random, encode, record, search, format, constants
) {
    'use strict';

    function generateToken() {
        try {
            const bytes = random.generateBytes({ size: 32 });
            return encode.convert({
                string: bytes,
                inputEncoding: encode.Encoding.BINARY,
                outputEncoding: encode.Encoding.HEX
            });
        } catch (error) {
            log.error('generateToken error', error);
            throw error;
        }
    }

    function validateToken(token) {
        try {
            if (!token) {
                return { valid: false, error: 'Missing token.' };
            }

            const now = new Date();
            const tokenSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                filters: [
                    [constants.TASK_FIELDS.TOKEN, 'is', token],
                    'and',
                    [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                    'and',
                    [constants.TASK_FIELDS.TOKEN_EXPIRY, 'onorafter',
                        format.format({ value: now, type: format.Type.DATETIME })
                    ]
                ],
                columns: [
                    'internalid',
                    constants.TASK_FIELDS.TRAN_TYPE,
                    constants.TASK_FIELDS.TRAN_ID,
                    constants.TASK_FIELDS.APPROVER,
                    constants.TASK_FIELDS.ACTING_APPROVER
                ]
            });

            const result = tokenSearch.run().getRange({ start: 0, end: 1 });
            if (!result || !result.length) {
                return { valid: false, error: 'Token is invalid or expired.' };
            }

            return {
                valid: true,
                taskId: result[0].getValue('internalid'),
                transactionType: result[0].getValue(constants.TASK_FIELDS.TRAN_TYPE),
                transactionId: result[0].getValue(constants.TASK_FIELDS.TRAN_ID),
                approver: result[0].getValue(constants.TASK_FIELDS.ACTING_APPROVER)
                    || result[0].getValue(constants.TASK_FIELDS.APPROVER)
            };
        } catch (error) {
            log.error('validateToken error', error);
            return { valid: false, error: 'Error validating token.' };
        }
    }

    function refreshToken(taskId) {
        try {
            if (!taskId) {
                throw new Error('Missing taskId.');
            }

            const newToken = generateToken();
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + constants.CONFIG.TOKEN_EXPIRY_HOURS);

            record.submitFields({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                id: taskId,
                values: {
                    [constants.TASK_FIELDS.TOKEN]: newToken,
                    [constants.TASK_FIELDS.TOKEN_EXPIRY]: expiry
                }
            });

            return newToken;
        } catch (error) {
            log.error('refreshToken error', error);
            return null;
        }
    }

    function invalidateToken(taskId) {
        try {
            if (!taskId) {
                return;
            }

            record.submitFields({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                id: taskId,
                values: {
                    [constants.TASK_FIELDS.TOKEN]: '',
                    [constants.TASK_FIELDS.TOKEN_EXPIRY]: ''
                }
            });
        } catch (error) {
            log.error('invalidateToken error', error);
        }
    }

    return {
        generateToken: generateToken,
        validateToken: validateToken,
        refreshToken: refreshToken,
        invalidateToken: invalidateToken
    };
});
