/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P Delegation Manager (v2 - Decision Table Architecture)
 * Handles approval delegation lookup and management
 */
define([
    'N/search', 'N/record', 'N/format',
    '../constants/p2p_constants_v2'
], function(search, record, format, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const DF = constants.DELEGATION_FIELDS;

    /**
     * Find active delegation for an approver
     * 
     * @param {Object} params
     * @param {number} params.approverId - Original approver's employee ID
     * @param {number} [params.subsidiary] - Subsidiary scope filter
     * @param {string} [params.transactionType] - Transaction type scope filter
     * @returns {Object|null} Delegation info or null
     */
    function findActiveDelegation(params) {
        try {
            if (!params || !params.approverId) {
                return null;
            }

            const today = new Date();
            const todayStr = format.format({ value: today, type: format.Type.DATE });

            // Build filters
            const filters = [
                [DF.ORIGINAL, 'anyof', params.approverId],
                'and',
                [DF.ACTIVE, 'is', 'T'],
                'and',
                [DF.START_DATE, 'onorbefore', todayStr],
                'and',
                [DF.END_DATE, 'onorafter', todayStr]
            ];

            // Add subsidiary scope filter if provided
            if (params.subsidiary) {
                filters.push('and');
                filters.push([
                    [DF.SUBSIDIARY, 'anyof', params.subsidiary],
                    'or',
                    [DF.SUBSIDIARY, 'isempty', '']
                ]);
            }

            // Add transaction type scope filter if provided
            if (params.transactionType) {
                filters.push('and');
                filters.push([
                    [DF.TRAN_TYPE, 'anyof', params.transactionType],
                    'or',
                    [DF.TRAN_TYPE, 'isempty', '']
                ]);
            }

            const delegationSearch = search.create({
                type: RT.DELEGATION,
                filters: filters,
                columns: [
                    'internalid',
                    DF.DELEGATE,
                    DF.START_DATE,
                    DF.END_DATE,
                    DF.SUBSIDIARY,
                    DF.TRAN_TYPE
                ]
            });

            const results = delegationSearch.run().getRange({ start: 0, end: 1 });
            
            if (!results || !results.length) {
                return null;
            }

            const result = results[0];
            return {
                id: result.getValue('internalid'),
                delegateId: result.getValue(DF.DELEGATE),
                startDate: result.getValue(DF.START_DATE),
                endDate: result.getValue(DF.END_DATE),
                subsidiary: result.getValue(DF.SUBSIDIARY),
                transactionType: result.getValue(DF.TRAN_TYPE)
            };
        } catch (error) {
            log.error('findActiveDelegation error', error);
            return null;
        }
    }

    /**
     * Create a new delegation
     * 
     * @param {Object} params
     * @param {number} params.originalId - Delegator's employee ID
     * @param {number} params.delegateId - Delegate's employee ID
     * @param {Date|string} params.startDate - Start date
     * @param {Date|string} params.endDate - End date
     * @param {number} [params.subsidiary] - Subsidiary scope
     * @param {string} [params.transactionType] - Transaction type scope
     * @returns {number} Created delegation internal ID
     */
    function createDelegation(params) {
        try {
            if (!params || !params.originalId || !params.delegateId || !params.startDate || !params.endDate) {
                throw new Error('Missing required delegation parameters');
            }

            // Parse dates
            const startDate = params.startDate instanceof Date 
                ? params.startDate 
                : format.parse({ value: params.startDate, type: format.Type.DATE });
            const endDate = params.endDate instanceof Date 
                ? params.endDate 
                : format.parse({ value: params.endDate, type: format.Type.DATE });

            // Validate date range
            if (endDate < startDate) {
                throw new Error('End date must be on or after start date');
            }

            // Check max delegation duration
            const maxDays = constants.CONFIG.MAX_DELEGATION_DAYS;
            const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            if (daysDiff > maxDays) {
                throw new Error('Delegation exceeds maximum allowed duration of ' + maxDays + ' days');
            }

            // Check for overlapping delegations
            if (hasOverlappingDelegation(params.originalId, startDate, endDate, params.subsidiary, params.transactionType)) {
                throw new Error('Overlapping delegation exists for this approver');
            }

            // Create delegation record
            const delegation = record.create({ type: RT.DELEGATION });
            delegation.setValue({ fieldId: DF.ORIGINAL, value: params.originalId });
            delegation.setValue({ fieldId: DF.DELEGATE, value: params.delegateId });
            delegation.setValue({ fieldId: DF.START_DATE, value: startDate });
            delegation.setValue({ fieldId: DF.END_DATE, value: endDate });
            delegation.setValue({ fieldId: DF.ACTIVE, value: true });

            if (params.subsidiary) {
                delegation.setValue({ fieldId: DF.SUBSIDIARY, value: params.subsidiary });
            }
            if (params.transactionType) {
                delegation.setValue({ fieldId: DF.TRAN_TYPE, value: params.transactionType });
            }

            const id = delegation.save();
            log.audit('Delegation created', { 
                id: id, 
                original: params.originalId, 
                delegate: params.delegateId,
                startDate: startDate,
                endDate: endDate
            });

            return id;
        } catch (error) {
            log.error('createDelegation error', error);
            throw error;
        }
    }

    /**
     * Check for overlapping delegations
     */
    function hasOverlappingDelegation(originalId, startDate, endDate, subsidiary, tranType) {
        try {
            const startStr = format.format({ value: startDate, type: format.Type.DATE });
            const endStr = format.format({ value: endDate, type: format.Type.DATE });

            const filters = [
                [DF.ORIGINAL, 'anyof', originalId],
                'and',
                [DF.ACTIVE, 'is', 'T'],
                'and',
                [DF.START_DATE, 'onorbefore', endStr],
                'and',
                [DF.END_DATE, 'onorafter', startStr]
            ];

            // Add subsidiary/tranType filters for scoped overlap check
            if (subsidiary) {
                filters.push('and');
                filters.push([
                    [DF.SUBSIDIARY, 'anyof', subsidiary],
                    'or',
                    [DF.SUBSIDIARY, 'isempty', '']
                ]);
            }
            if (tranType) {
                filters.push('and');
                filters.push([
                    [DF.TRAN_TYPE, 'anyof', tranType],
                    'or',
                    [DF.TRAN_TYPE, 'isempty', '']
                ]);
            }

            const overlapSearch = search.create({
                type: RT.DELEGATION,
                filters: filters,
                columns: ['internalid']
            });

            const results = overlapSearch.run().getRange({ start: 0, end: 1 });
            return results && results.length > 0;
        } catch (error) {
            log.error('hasOverlappingDelegation error', error);
            return false;
        }
    }

    /**
     * Get all delegations for an employee (as delegator or delegate)
     * 
     * @param {number} employeeId - Employee internal ID
     * @param {boolean} asDelegate - If true, get delegations where employee is the delegate
     * @returns {Array} Array of delegation objects
     */
    function getEmployeeDelegations(employeeId, asDelegate) {
        try {
            const fieldId = asDelegate ? DF.DELEGATE : DF.ORIGINAL;

            const delegationSearch = search.create({
                type: RT.DELEGATION,
                filters: [[fieldId, 'anyof', employeeId]],
                columns: [
                    'internalid',
                    DF.ORIGINAL,
                    DF.DELEGATE,
                    DF.START_DATE,
                    DF.END_DATE,
                    DF.SUBSIDIARY,
                    DF.TRAN_TYPE,
                    DF.ACTIVE
                ]
            });

            const delegations = [];
            delegationSearch.run().each(function(result) {
                delegations.push({
                    id: result.getValue('internalid'),
                    original: result.getValue(DF.ORIGINAL),
                    originalText: result.getText(DF.ORIGINAL),
                    delegate: result.getValue(DF.DELEGATE),
                    delegateText: result.getText(DF.DELEGATE),
                    startDate: result.getValue(DF.START_DATE),
                    endDate: result.getValue(DF.END_DATE),
                    subsidiary: result.getValue(DF.SUBSIDIARY),
                    subsidiaryText: result.getText(DF.SUBSIDIARY),
                    transactionType: result.getValue(DF.TRAN_TYPE),
                    transactionTypeText: result.getText(DF.TRAN_TYPE),
                    active: result.getValue(DF.ACTIVE) === 'T'
                });
                return true;
            });

            return delegations;
        } catch (error) {
            log.error('getEmployeeDelegations error', error);
            return [];
        }
    }

    /**
     * Deactivate a delegation
     * 
     * @param {number} delegationId - Delegation record ID
     * @returns {boolean} Success status
     */
    function deactivateDelegation(delegationId) {
        try {
            record.submitFields({
                type: RT.DELEGATION,
                id: delegationId,
                values: {
                    [DF.ACTIVE]: false
                }
            });
            log.audit('Delegation deactivated', { id: delegationId });
            return true;
        } catch (error) {
            log.error('deactivateDelegation error', error);
            return false;
        }
    }

    /**
     * Clean up expired delegations (for scheduled script)
     * Sets active = false for all delegations past their end date
     * 
     * @returns {number} Count of cleaned up delegations
     */
    function cleanupExpiredDelegations() {
        try {
            const today = new Date();
            const todayStr = format.format({ value: today, type: format.Type.DATE });

            const expiredSearch = search.create({
                type: RT.DELEGATION,
                filters: [
                    [DF.ACTIVE, 'is', 'T'],
                    'and',
                    [DF.END_DATE, 'before', todayStr]
                ],
                columns: ['internalid']
            });

            const toDeactivate = [];
            expiredSearch.run().each(function(result) {
                toDeactivate.push(result.getValue('internalid'));
                return true;
            });

            toDeactivate.forEach(function(id) {
                record.submitFields({
                    type: RT.DELEGATION,
                    id: id,
                    values: {
                        [DF.ACTIVE]: false
                    }
                });
            });

            if (toDeactivate.length) {
                log.audit('cleanupExpiredDelegations', { deactivated: toDeactivate.length });
            }

            return toDeactivate.length;
        } catch (error) {
            log.error('cleanupExpiredDelegations error', error);
            return 0;
        }
    }

    /**
     * Resolve effective approver considering delegation
     * 
     * @param {number} approverId - Original approver
     * @param {Object} context - Transaction context
     * @returns {Object} { effectiveApprover, originalApprover, isDelegated }
     */
    function resolveEffectiveApprover(approverId, context) {
        const delegation = findActiveDelegation({
            approverId: approverId,
            subsidiary: context.subsidiary,
            transactionType: context.transactionType
        });

        if (delegation) {
            return {
                effectiveApprover: delegation.delegateId,
                originalApprover: approverId,
                isDelegated: true,
                delegationId: delegation.id
            };
        }

        return {
            effectiveApprover: approverId,
            originalApprover: approverId,
            isDelegated: false,
            delegationId: null
        };
    }

    return {
        findActiveDelegation: findActiveDelegation,
        createDelegation: createDelegation,
        getEmployeeDelegations: getEmployeeDelegations,
        deactivateDelegation: deactivateDelegation,
        cleanupExpiredDelegations: cleanupExpiredDelegations,
        resolveEffectiveApprover: resolveEffectiveApprover
    };
});
