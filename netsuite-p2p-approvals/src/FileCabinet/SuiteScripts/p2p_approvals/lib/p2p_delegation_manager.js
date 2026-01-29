/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/search', 'N/record', 'N/format', '../constants/p2p_constants'], function(
    search, record, format, constants
) {
    'use strict';

    function findActiveDelegation(params) {
        try {
            if (!params || !params.approverId) {
                return null;
            }

            const today = new Date();
            const filters = [
                [constants.DELEGATION_FIELDS.ORIGINAL, 'anyof', params.approverId],
                'and',
                [constants.DELEGATION_FIELDS.ACTIVE, 'is', 'T'],
                'and',
                [constants.DELEGATION_FIELDS.START_DATE, 'onorbefore', format.format({ value: today, type: format.Type.DATE })],
                'and',
                [constants.DELEGATION_FIELDS.END_DATE, 'onorafter', format.format({ value: today, type: format.Type.DATE })]
            ];

            if (params.subsidiary) {
                filters.push('and', [
                    constants.DELEGATION_FIELDS.SUBSIDIARY, 'anyof', params.subsidiary
                ], 'or', [
                    constants.DELEGATION_FIELDS.SUBSIDIARY, 'isempty', ''
                ]);
            }

            if (params.transactionType) {
                filters.push('and', [
                    constants.DELEGATION_FIELDS.TRAN_TYPE, 'anyof', params.transactionType
                ], 'or', [
                    constants.DELEGATION_FIELDS.TRAN_TYPE, 'isempty', ''
                ]);
            }

            const delegationSearch = search.create({
                type: constants.RECORD_TYPES.DELEGATION,
                filters: filters,
                columns: [
                    'internalid',
                    constants.DELEGATION_FIELDS.DELEGATE,
                    constants.DELEGATION_FIELDS.START_DATE,
                    constants.DELEGATION_FIELDS.END_DATE
                ]
            });

            const result = delegationSearch.run().getRange({ start: 0, end: 1 });
            if (!result || !result.length) {
                return null;
            }

            return {
                id: result[0].getValue('internalid'),
                delegateId: result[0].getValue(constants.DELEGATION_FIELDS.DELEGATE),
                startDate: result[0].getValue(constants.DELEGATION_FIELDS.START_DATE),
                endDate: result[0].getValue(constants.DELEGATION_FIELDS.END_DATE)
            };
        } catch (error) {
            log.error('findActiveDelegation error', error);
            return null;
        }
    }

    function createDelegation(params) {
        try {
            if (!params || !params.originalId || !params.delegateId || !params.startDate || !params.endDate) {
                throw new Error('Missing required delegation parameters.');
            }

            const start = params.startDate instanceof Date ? params.startDate : format.parse({
                value: params.startDate,
                type: format.Type.DATE
            });
            const end = params.endDate instanceof Date ? params.endDate : format.parse({
                value: params.endDate,
                type: format.Type.DATE
            });

            const maxDays = constants.CONFIG.MAX_DELEGATION_DAYS;
            const durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            if (durationDays > maxDays) {
                throw new Error('Delegation duration exceeds max days: ' + maxDays);
            }

            const overlapSearch = search.create({
                type: constants.RECORD_TYPES.DELEGATION,
                filters: [
                    [constants.DELEGATION_FIELDS.ORIGINAL, 'anyof', params.originalId],
                    'and',
                    [constants.DELEGATION_FIELDS.ACTIVE, 'is', 'T'],
                    'and',
                    [constants.DELEGATION_FIELDS.START_DATE, 'onorbefore', format.format({ value: end, type: format.Type.DATE })],
                    'and',
                    [constants.DELEGATION_FIELDS.END_DATE, 'onorafter', format.format({ value: start, type: format.Type.DATE })]
                ],
                columns: ['internalid']
            });

            const overlap = overlapSearch.run().getRange({ start: 0, end: 1 });
            if (overlap && overlap.length) {
                throw new Error('Overlapping delegation exists for this approver.');
            }

            const delegation = record.create({ type: constants.RECORD_TYPES.DELEGATION });
            delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.ORIGINAL, value: params.originalId });
            delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.DELEGATE, value: params.delegateId });
            delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.START_DATE, value: start });
            delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.END_DATE, value: end });
            delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.ACTIVE, value: true });

            if (params.subsidiary) {
                delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.SUBSIDIARY, value: params.subsidiary });
            }
            if (params.transactionType) {
                delegation.setValue({ fieldId: constants.DELEGATION_FIELDS.TRAN_TYPE, value: params.transactionType });
            }

            const id = delegation.save();
            log.audit('Delegation created', { id: id, original: params.originalId, delegate: params.delegateId });
            return id;
        } catch (error) {
            log.error('createDelegation error', error);
            throw error;
        }
    }

    function getEmployeeDelegations(employeeId, asDelegate) {
        try {
            const fieldId = asDelegate ? constants.DELEGATION_FIELDS.DELEGATE : constants.DELEGATION_FIELDS.ORIGINAL;
            const delegationSearch = search.create({
                type: constants.RECORD_TYPES.DELEGATION,
                filters: [[fieldId, 'anyof', employeeId]],
                columns: [
                    'internalid',
                    constants.DELEGATION_FIELDS.ORIGINAL,
                    constants.DELEGATION_FIELDS.DELEGATE,
                    constants.DELEGATION_FIELDS.START_DATE,
                    constants.DELEGATION_FIELDS.END_DATE,
                    constants.DELEGATION_FIELDS.ACTIVE
                ]
            });

            const results = [];
            delegationSearch.run().each(function(result) {
                results.push({
                    id: result.getValue('internalid'),
                    original: result.getValue(constants.DELEGATION_FIELDS.ORIGINAL),
                    delegate: result.getValue(constants.DELEGATION_FIELDS.DELEGATE),
                    startDate: result.getValue(constants.DELEGATION_FIELDS.START_DATE),
                    endDate: result.getValue(constants.DELEGATION_FIELDS.END_DATE),
                    active: result.getValue(constants.DELEGATION_FIELDS.ACTIVE) === 'T'
                });
                return true;
            });

            return results;
        } catch (error) {
            log.error('getEmployeeDelegations error', error);
            return [];
        }
    }

    function cleanupExpiredDelegations() {
        try {
            const today = new Date();
            const expiredSearch = search.create({
                type: constants.RECORD_TYPES.DELEGATION,
                filters: [
                    [constants.DELEGATION_FIELDS.ACTIVE, 'is', 'T'],
                    'and',
                    [constants.DELEGATION_FIELDS.END_DATE, 'before', format.format({ value: today, type: format.Type.DATE })]
                ],
                columns: ['internalid']
            });

            const toUpdate = [];
            expiredSearch.run().each(function(result) {
                toUpdate.push(result.getValue('internalid'));
                return true;
            });

            toUpdate.forEach(function(id) {
                record.submitFields({
                    type: constants.RECORD_TYPES.DELEGATION,
                    id: id,
                    values: {
                        [constants.DELEGATION_FIELDS.ACTIVE]: false
                    }
                });
            });

            if (toUpdate.length) {
                log.audit('cleanupExpiredDelegations', { updated: toUpdate.length });
            }
        } catch (error) {
            log.error('cleanupExpiredDelegations error', error);
        }
    }

    return {
        findActiveDelegation: findActiveDelegation,
        createDelegation: createDelegation,
        getEmployeeDelegations: getEmployeeDelegations,
        cleanupExpiredDelegations: cleanupExpiredDelegations
    };
});
