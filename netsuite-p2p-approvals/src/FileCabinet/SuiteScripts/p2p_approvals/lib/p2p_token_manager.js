/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P Token Manager (v2 - Decision Table Architecture)
 * Handles secure token generation and validation for email approvals
 */
define([
    'N/crypto/random', 'N/record', 'N/search', 'N/format',
    '../constants/p2p_constants_v2', './p2p_config'
], function(random, record, search, format, constants, config) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;

    /**
     * Generate a secure random token
     * 
     * @returns {string} 64-character hex token
     */
    function generateToken() {
        try {
            // Generate 32 random bytes (returns Uint8Array - do not pass to N/encode)
            const bytes = random.generateBytes({ size: 32 });
            // Convert Uint8Array to hex string in JS to avoid Java type coercion
            var hex = '';
            for (var i = 0; i < bytes.length; i++) {
                hex += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
            }
            return hex;
        } catch (error) {
            log.error('generateToken error', error);
            throw error;
        }
    }

    /**
     * Validate a token and return task details
     * 
     * @param {string} token - Token to validate
     * @returns {Object} { valid, taskId, transactionType, transactionId, approver, error }
     */
    function validateToken(token) {
        try {
            if (!token) {
                return { valid: false, error: 'Missing token' };
            }

            const now = new Date();
            const nowStr = format.format({ value: now, type: format.Type.DATETIME });

            const tokenSearch = search.create({
                type: RT.APPROVAL_TASK,
                filters: [
                    [TF.TOKEN, 'is', token],
                    'and',
                    [TF.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                    'and',
                    [TF.TOKEN_EXPIRY, 'onorafter', nowStr]
                ],
                columns: [
                    'internalid',
                    TF.TRAN_TYPE,
                    TF.TRAN_ID,
                    TF.APPROVER,
                    TF.ACTING_APPROVER,
                    TF.SEQUENCE,
                    TF.PATH,
                    TF.PATH_STEP
                ]
            });

            const results = tokenSearch.run().getRange({ start: 0, end: 1 });
            
            if (!results || !results.length) {
                return { valid: false, error: 'Token is invalid or expired' };
            }

            const result = results[0];
            return {
                valid: true,
                taskId: result.getValue('internalid'),
                transactionType: result.getValue(TF.TRAN_TYPE),
                transactionId: result.getValue(TF.TRAN_ID),
                approver: result.getValue(TF.ACTING_APPROVER) || result.getValue(TF.APPROVER),
                originalApprover: result.getValue(TF.APPROVER),
                sequence: result.getValue(TF.SEQUENCE),
                pathId: result.getValue(TF.PATH),
                pathStepId: result.getValue(TF.PATH_STEP)
            };
        } catch (error) {
            log.error('validateToken error', error);
            return { valid: false, error: 'Error validating token' };
        }
    }

    /**
     * Refresh token (generate new one and extend expiry)
     * 
     * @param {number} taskId - Approval task internal ID
     * @returns {string|null} New token or null on failure
     */
    function refreshToken(taskId) {
        try {
            if (!taskId) {
                throw new Error('Missing taskId');
            }

            const newToken = generateToken();
            const expiryHours = config.getValue('tokenExpiryHrs', constants.CONFIG_DEFAULTS.TOKEN_EXPIRY_HRS);
            
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + expiryHours);

            record.submitFields({
                type: RT.APPROVAL_TASK,
                id: taskId,
                values: {
                    [TF.TOKEN]: newToken,
                    [TF.TOKEN_EXPIRY]: expiry
                }
            });

            return newToken;
        } catch (error) {
            log.error('refreshToken error', error);
            return null;
        }
    }

    /**
     * Invalidate token (clear from task)
     * Used after token has been used
     * 
     * @param {number} taskId - Approval task internal ID
     */
    function invalidateToken(taskId) {
        try {
            if (!taskId) return;

            record.submitFields({
                type: RT.APPROVAL_TASK,
                id: taskId,
                values: {
                    [TF.TOKEN]: '',
                    [TF.TOKEN_EXPIRY]: ''
                }
            });
        } catch (error) {
            log.error('invalidateToken error', error);
        }
    }

    /**
     * Create initial token for a new task
     * 
     * @param {number} taskId - Task internal ID
     * @returns {string|null} Generated token
     */
    function createTokenForTask(taskId) {
        return refreshToken(taskId);
    }

    /**
     * Check if a token is about to expire (within next hour)
     * 
     * @param {number} taskId - Task internal ID
     * @returns {boolean} True if expiring soon
     */
    function isTokenExpiringSoon(taskId) {
        try {
            const task = search.lookupFields({
                type: RT.APPROVAL_TASK,
                id: taskId,
                columns: [TF.TOKEN_EXPIRY]
            });

            if (!task[TF.TOKEN_EXPIRY]) return true;

            const expiry = format.parse({ 
                value: task[TF.TOKEN_EXPIRY], 
                type: format.Type.DATETIME 
            });
            
            const oneHourFromNow = new Date();
            oneHourFromNow.setHours(oneHourFromNow.getHours() + 1);

            return expiry < oneHourFromNow;
        } catch (error) {
            log.error('isTokenExpiringSoon error', error);
            return true;
        }
    }

    /**
     * Clean up expired tokens (for scheduled script)
     * 
     * @returns {number} Count of tokens cleared
     */
    function cleanupExpiredTokens() {
        try {
            const now = new Date();
            const nowStr = format.format({ value: now, type: format.Type.DATETIME });

            const expiredSearch = search.create({
                type: RT.APPROVAL_TASK,
                filters: [
                    [TF.TOKEN, 'isnotempty', ''],
                    'and',
                    [TF.TOKEN_EXPIRY, 'before', nowStr]
                ],
                columns: ['internalid']
            });

            const toClean = [];
            expiredSearch.run().each(function(result) {
                toClean.push(result.getValue('internalid'));
                return true;
            });

            toClean.forEach(function(taskId) {
                record.submitFields({
                    type: RT.APPROVAL_TASK,
                    id: taskId,
                    values: {
                        [TF.TOKEN]: '',
                        [TF.TOKEN_EXPIRY]: ''
                    }
                });
            });

            if (toClean.length) {
                log.audit('cleanupExpiredTokens', { cleaned: toClean.length });
            }

            return toClean.length;
        } catch (error) {
            log.error('cleanupExpiredTokens error', error);
            return 0;
        }
    }

    /**
     * Get token info for a task (without revealing full token)
     * 
     * @param {number} taskId - Task internal ID
     * @returns {Object} Token metadata
     */
    function getTokenInfo(taskId) {
        try {
            const task = search.lookupFields({
                type: RT.APPROVAL_TASK,
                id: taskId,
                columns: [TF.TOKEN, TF.TOKEN_EXPIRY]
            });

            const hasToken = !!task[TF.TOKEN];
            let expiryDate = null;
            let isExpired = true;

            if (task[TF.TOKEN_EXPIRY]) {
                expiryDate = format.parse({ 
                    value: task[TF.TOKEN_EXPIRY], 
                    type: format.Type.DATETIME 
                });
                isExpired = expiryDate < new Date();
            }

            return {
                hasToken: hasToken,
                expiry: expiryDate,
                isExpired: isExpired,
                isValid: hasToken && !isExpired
            };
        } catch (error) {
            log.error('getTokenInfo error', error);
            return { hasToken: false, expiry: null, isExpired: true, isValid: false };
        }
    }

    return {
        generateToken: generateToken,
        validateToken: validateToken,
        refreshToken: refreshToken,
        invalidateToken: invalidateToken,
        createTokenForTask: createTokenForTask,
        isTokenExpiringSoon: isTokenExpiringSoon,
        cleanupExpiredTokens: cleanupExpiredTokens,
        getTokenInfo: getTokenInfo
    };
});
