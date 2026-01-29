/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([
    'N/search', 'N/record', 'N/runtime', 'N/format',
    './p2p_delegation_manager', './p2p_history_logger',
    './p2p_notification_manager', './p2p_token_manager',
    '../constants/p2p_constants'
], function(
    search, record, runtime, format,
    delegationManager, historyLogger,
    notificationManager, tokenManager, constants
) {
    'use strict';

    function routeForApproval(params) {
        try {
            if (!params || !params.recordType || !params.recordId || !params.transactionData) {
                throw new Error('Missing routing parameters.');
            }

            const rule = findMatchingRule({
                transactionType: params.transactionData.transactionType,
                subsidiary: params.transactionData.subsidiary,
                department: params.transactionData.department,
                location: params.transactionData.location,
                amount: params.transactionData.amount,
                currency: params.transactionData.currency,
                exceptionType: params.exceptionType
            });

            if (!rule) {
                log.error('No matching approval rule', params.transactionData);
                return { success: false, message: 'No matching approval rule found.' };
            }

            const steps = getStepsForRule(rule.id);
            if (!steps.length) {
                log.error('No steps for rule', rule.id);
                return { success: false, message: 'No approval steps configured.' };
            }

            const firstSequence = steps[0].sequence;
            const createdTasks = createTasksForSequence({
                ruleId: rule.id,
                sequence: firstSequence,
                transactionType: params.transactionData.transactionType,
                recordType: params.recordType,
                recordId: params.recordId,
                subsidiary: params.transactionData.subsidiary
            });

            record.submitFields({
                type: params.recordType,
                id: params.recordId,
                values: {
                    [constants.BODY_FIELDS.APPROVAL_STATUS]: constants.APPROVAL_STATUS.PENDING_APPROVAL,
                    [constants.BODY_FIELDS.CURRENT_STEP]: firstSequence,
                    [constants.BODY_FIELDS.CURRENT_APPROVER]: createdTasks.firstApprover || '',
                    [constants.BODY_FIELDS.APPROVAL_RULE]: rule.id
                }
            });

            historyLogger.logAction({
                transactionType: params.transactionData.transactionType,
                transactionId: params.recordId,
                stepSequence: firstSequence,
                approver: runtime.getCurrentUser().id,
                action: constants.APPROVAL_ACTION.SUBMIT,
                comment: 'Submitted for approval',
                method: constants.APPROVAL_METHOD.UI
            });

            return { success: true, tasksCreated: createdTasks.count };
        } catch (error) {
            log.error('routeForApproval error', error);
            return { success: false, message: error.message };
        }
    }

    function findMatchingRule(criteria) {
        try {
            if (!criteria || !criteria.transactionType || criteria.subsidiary == null || criteria.amount == null) {
                return null;
            }

            const today = format.format({ value: new Date(), type: format.Type.DATE });
            const baseFilters = [
                [constants.RULE_FIELDS.ACTIVE, 'is', 'T'],
                'and',
                [constants.RULE_FIELDS.TRAN_TYPE, 'anyof', criteria.transactionType],
                'and',
                [constants.RULE_FIELDS.SUBSIDIARY, 'anyof', criteria.subsidiary],
                'and',
                [constants.RULE_FIELDS.AMOUNT_FROM, 'lessthanorequalto', criteria.amount],
                'and',
                [constants.RULE_FIELDS.AMOUNT_TO, 'greaterthanorequalto', criteria.amount],
                'and',
                [constants.RULE_FIELDS.EFFECTIVE_FROM, 'onorbefore', today],
                'and',
                [
                    [constants.RULE_FIELDS.EFFECTIVE_TO, 'isempty', ''],
                    'or',
                    [constants.RULE_FIELDS.EFFECTIVE_TO, 'onorafter', today]
                ]
            ];

            if (criteria.currency) {
                baseFilters.push('and', [
                    [constants.RULE_FIELDS.CURRENCY, 'isempty', ''],
                    'or',
                    [constants.RULE_FIELDS.CURRENCY, 'anyof', criteria.currency]
                ]);
            }

            if (criteria.department) {
                baseFilters.push('and', [
                    [constants.RULE_FIELDS.DEPARTMENT, 'isempty', ''],
                    'or',
                    [constants.RULE_FIELDS.DEPARTMENT, 'anyof', criteria.department]
                ]);
            }

            if (criteria.location) {
                baseFilters.push('and', [
                    [constants.RULE_FIELDS.LOCATION, 'isempty', ''],
                    'or',
                    [constants.RULE_FIELDS.LOCATION, 'anyof', criteria.location]
                ]);
            }

            const ruleSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_RULE,
                filters: baseFilters,
                columns: [
                    'internalid',
                    constants.RULE_FIELDS.CURRENCY,
                    constants.RULE_FIELDS.DEPARTMENT,
                    constants.RULE_FIELDS.LOCATION,
                    constants.RULE_FIELDS.DEPT_GROUP,
                    constants.RULE_FIELDS.LOC_GROUP,
                    constants.RULE_FIELDS.PRIORITY,
                    constants.RULE_FIELDS.EXC_NO_PO,
                    constants.RULE_FIELDS.EXC_VARIANCE,
                    constants.RULE_FIELDS.EXC_NO_RECEIPT
                ]
            });

            const deptGroups = criteria.department ? getDepartmentGroups(criteria.department) : [];
            const locGroups = criteria.location ? getLocationGroups(criteria.location) : [];

            let bestRule = null;
            let bestScore = -1;
            let bestPriority = -1;

            ruleSearch.run().each(function(result) {
                const currency = result.getValue(constants.RULE_FIELDS.CURRENCY);
                const dept = result.getValue(constants.RULE_FIELDS.DEPARTMENT);
                const loc = result.getValue(constants.RULE_FIELDS.LOCATION);
                const deptGroup = result.getValue(constants.RULE_FIELDS.DEPT_GROUP);
                const locGroup = result.getValue(constants.RULE_FIELDS.LOC_GROUP);

                if (criteria.currency && currency && currency !== criteria.currency) {
                    return true;
                }

                if (criteria.department && dept && dept !== criteria.department) {
                    return true;
                }

                if (criteria.location && loc && loc !== criteria.location) {
                    return true;
                }

                if (deptGroup && deptGroups.indexOf(deptGroup) === -1) {
                    return true;
                }

                if (locGroup && locGroups.indexOf(locGroup) === -1) {
                    return true;
                }

                if (criteria.exceptionType) {
                    const excNoPo = result.getValue(constants.RULE_FIELDS.EXC_NO_PO) === 'T';
                    const excVar = result.getValue(constants.RULE_FIELDS.EXC_VARIANCE) === 'T';
                    const excReceipt = result.getValue(constants.RULE_FIELDS.EXC_NO_RECEIPT) === 'T';
                    if (criteria.exceptionType === constants.EXCEPTION_TYPE.MISSING_PO && !excNoPo) {
                        return true;
                    }
                    if (criteria.exceptionType === constants.EXCEPTION_TYPE.VARIANCE_OVER_LIMIT && !excVar) {
                        return true;
                    }
                    if (criteria.exceptionType === constants.EXCEPTION_TYPE.MISSING_RECEIPT && !excReceipt) {
                        return true;
                    }
                }

                const score = calculateSpecificity({
                    dept: dept,
                    loc: loc,
                    deptGroup: deptGroup,
                    locGroup: locGroup
                }, criteria.department, criteria.location, deptGroups, locGroups);
                const priority = parseInt(result.getValue(constants.RULE_FIELDS.PRIORITY), 10) || 0;

                if (score > bestScore || (score === bestScore && priority > bestPriority)) {
                    bestScore = score;
                    bestPriority = priority;
                    bestRule = {
                        id: result.getValue('internalid'),
                        priority: priority
                    };
                }
                return true;
            });

            return bestRule;
        } catch (error) {
            log.error('findMatchingRule error', error);
            return null;
        }
    }

    function calculateSpecificity(rule, dept, loc, deptGroups, locGroups) {
        let score = 0;
        if (rule.dept && dept && rule.dept === dept) {
            score += constants.SPECIFICITY_SCORES.DEPARTMENT_EXACT;
        } else if (rule.deptGroup && deptGroups.indexOf(rule.deptGroup) !== -1) {
            score += constants.SPECIFICITY_SCORES.DEPARTMENT_GROUP;
        }

        if (rule.loc && loc && rule.loc === loc) {
            score += constants.SPECIFICITY_SCORES.LOCATION_EXACT;
        } else if (rule.locGroup && locGroups.indexOf(rule.locGroup) !== -1) {
            score += constants.SPECIFICITY_SCORES.LOCATION_GROUP;
        }

        return score;
    }

    function processApproval(params) {
        try {
            if (!params || !params.taskId || !params.action) {
                throw new Error('Missing approval parameters.');
            }

            const task = record.load({ type: constants.RECORD_TYPES.APPROVAL_TASK, id: params.taskId });
            const status = task.getValue(constants.TASK_FIELDS.STATUS);
            if (status !== constants.TASK_STATUS.PENDING) {
                return { success: false, message: 'Task is not pending.' };
            }

            const approver = task.getValue(constants.TASK_FIELDS.APPROVER);
            const actingApprover = task.getValue(constants.TASK_FIELDS.ACTING_APPROVER);
            const currentUser = runtime.getCurrentUser().id;
            if (currentUser !== approver && currentUser !== actingApprover) {
                return { success: false, message: 'User not authorized for this task.' };
            }

            const recordId = task.getValue(constants.TASK_FIELDS.TRAN_ID);
            const tranType = task.getValue(constants.TASK_FIELDS.TRAN_TYPE);
            if (!checkSegregationOfDuties(tranType, recordId, currentUser)) {
                return { success: false, message: 'Segregation of duties violation.' };
            }

            const stepId = task.getValue(constants.TASK_FIELDS.STEP);
            if (params.action === constants.APPROVAL_ACTION.REJECT && stepId) {
                const stepRecord = record.load({ type: constants.RECORD_TYPES.APPROVAL_STEP, id: stepId });
                const requireComment = stepRecord.getValue(constants.STEP_FIELDS.REQUIRE_COMMENT) === 'T';
                if (requireComment && !params.comment) {
                    return { success: false, message: 'Comment required for rejection.' };
                }
            }

            task.setValue({ fieldId: constants.TASK_FIELDS.STATUS, value: params.action === constants.APPROVAL_ACTION.APPROVE
                ? constants.TASK_STATUS.APPROVED
                : constants.TASK_STATUS.REJECTED
            });
            task.setValue({ fieldId: constants.TASK_FIELDS.COMPLETED, value: new Date() });
            task.save();

            historyLogger.logAction({
                transactionType: tranType,
                transactionId: recordId,
                stepSequence: task.getValue(constants.TASK_FIELDS.SEQUENCE),
                approver: approver,
                actingApprover: actingApprover,
                action: params.action,
                comment: params.comment,
                method: params.method || constants.APPROVAL_METHOD.UI,
                ipAddress: params.ipAddress
            });

            if (params.action === constants.APPROVAL_ACTION.REJECT) {
                cancelPendingTasksForSequence({
                    tranType: tranType,
                    recordId: recordId,
                    sequence: task.getValue(constants.TASK_FIELDS.SEQUENCE),
                    reason: 'Cancelled due to rejection in parallel step.',
                    method: params.method || constants.APPROVAL_METHOD.UI
                });
                record.submitFields({
                    type: getRecordTypeByTranType(tranType),
                    id: recordId,
                    values: {
                        [constants.BODY_FIELDS.APPROVAL_STATUS]: constants.APPROVAL_STATUS.REJECTED
                    }
                });
                notificationManager.sendRejectedNotification({
                    recordType: getRecordTypeByTranType(tranType),
                    recordId: recordId,
                    requestorId: getRequestorId(tranType, recordId),
                    comment: params.comment
                });
                return { success: true, status: 'rejected' };
            }

            const sequence = task.getValue(constants.TASK_FIELDS.SEQUENCE);
            if (!isSequenceComplete(tranType, recordId, sequence)) {
                return { success: true, status: 'pending_parallel' };
            }

            const nextSequence = getNextSequence(task.getValue(constants.TASK_FIELDS.RULE), sequence);
            if (!nextSequence) {
                record.submitFields({
                    type: getRecordTypeByTranType(tranType),
                    id: recordId,
                    values: {
                        [constants.BODY_FIELDS.APPROVAL_STATUS]: constants.APPROVAL_STATUS.APPROVED
                    }
                });
                notificationManager.sendApprovedNotification({
                    recordType: getRecordTypeByTranType(tranType),
                    recordId: recordId,
                    requestorId: getRequestorId(tranType, recordId)
                });
                return { success: true, status: 'approved' };
            }

            const createdTasks = createTasksForSequence({
                ruleId: task.getValue(constants.TASK_FIELDS.RULE),
                sequence: nextSequence,
                transactionType: tranType,
                recordType: getRecordTypeByTranType(tranType),
                recordId: recordId
            });

            record.submitFields({
                type: getRecordTypeByTranType(tranType),
                id: recordId,
                values: {
                    [constants.BODY_FIELDS.CURRENT_STEP]: nextSequence,
                    [constants.BODY_FIELDS.CURRENT_APPROVER]: createdTasks.firstApprover || ''
                }
            });

            return { success: true, status: 'next_step' };
        } catch (error) {
            log.error('processApproval error', error);
            return { success: false, message: error.message };
        }
    }

    function cancelPendingTasksForSequence(params) {
        try {
            const pendingSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                filters: [
                    [constants.TASK_FIELDS.TRAN_TYPE, 'anyof', params.tranType],
                    'and',
                    [constants.TASK_FIELDS.TRAN_ID, 'equalto', params.recordId],
                    'and',
                    [constants.TASK_FIELDS.SEQUENCE, 'equalto', params.sequence],
                    'and',
                    [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
                ],
                columns: [
                    'internalid',
                    constants.TASK_FIELDS.APPROVER,
                    constants.TASK_FIELDS.ACTING_APPROVER
                ]
            });

            pendingSearch.run().each(function(result) {
                const taskId = result.getValue('internalid');
                const approverId = result.getValue(constants.TASK_FIELDS.APPROVER);
                const actingId = result.getValue(constants.TASK_FIELDS.ACTING_APPROVER);

                record.submitFields({
                    type: constants.RECORD_TYPES.APPROVAL_TASK,
                    id: taskId,
                    values: {
                        [constants.TASK_FIELDS.STATUS]: constants.TASK_STATUS.CANCELLED,
                        [constants.TASK_FIELDS.COMPLETED]: new Date(),
                        [constants.TASK_FIELDS.TOKEN]: '',
                        [constants.TASK_FIELDS.TOKEN_EXPIRY]: ''
                    }
                });

                historyLogger.logAction({
                    transactionType: params.tranType,
                    transactionId: params.recordId,
                    stepSequence: params.sequence,
                    approver: approverId,
                    actingApprover: actingId,
                    action: constants.APPROVAL_ACTION.REJECT,
                    comment: params.reason,
                    method: params.method
                });
                return true;
            });
        } catch (error) {
            log.error('cancelPendingTasksForSequence error', error);
        }
    }

    function checkSegregationOfDuties(recordType, recordId, approverId) {
        try {
            const nsRecordType = getRecordTypeByTranType(recordType) || recordType;
            const tran = record.load({ type: nsRecordType, id: recordId });
            const createdBy = tran.getValue('createdby');
            const requestor = tran.getValue('employee') || tran.getValue('requestor') || tran.getValue('entity');

            if (createdBy && String(createdBy) === String(approverId)) {
                return false;
            }
            if (requestor && String(requestor) === String(approverId)) {
                return false;
            }
            return true;
        } catch (error) {
            log.error('checkSegregationOfDuties error', error);
            return false;
        }
    }

    function getStepsForRule(ruleId) {
        const steps = [];
        const stepSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_STEP,
            filters: [[constants.STEP_FIELDS.PARENT_RULE, 'anyof', ruleId]],
            columns: [
                'internalid',
                constants.STEP_FIELDS.SEQUENCE,
                constants.STEP_FIELDS.APPROVER_TYPE,
                constants.STEP_FIELDS.APPROVER_ROLE,
                constants.STEP_FIELDS.APPROVER_EMPLOYEE,
                constants.STEP_FIELDS.EXECUTION_MODE
            ]
        });

        stepSearch.run().each(function(result) {
            steps.push({
                id: result.getValue('internalid'),
                sequence: parseInt(result.getValue(constants.STEP_FIELDS.SEQUENCE), 10),
                approverType: result.getValue(constants.STEP_FIELDS.APPROVER_TYPE),
                approverRole: result.getValue(constants.STEP_FIELDS.APPROVER_ROLE),
                approverEmployee: result.getValue(constants.STEP_FIELDS.APPROVER_EMPLOYEE),
                executionMode: result.getValue(constants.STEP_FIELDS.EXECUTION_MODE)
            });
            return true;
        });

        steps.sort(function(a, b) {
            return a.sequence - b.sequence;
        });
        return steps;
    }

    function createTasksForSequence(params) {
        if (!params.subsidiary) {
            try {
                const tran = record.load({ type: params.recordType, id: params.recordId });
                params.subsidiary = tran.getValue('subsidiary');
            } catch (error) {
                log.error('createTasksForSequence load subsidiary error', error);
            }
        }
        const steps = getStepsForRule(params.ruleId).filter(function(step) {
            return step.sequence === params.sequence;
        });
        let count = 0;
        let firstApprover = null;

        steps.forEach(function(step) {
            const approvers = resolveApproversForStep(step);
            if (!approvers.length) {
                log.error('No approvers resolved', step);
                return;
            }

            const isParallel = step.executionMode === constants.EXECUTION_MODE.PARALLEL;
            const targetApprovers = isParallel ? approvers : [approvers[0]];

            targetApprovers.forEach(function(approverId) {
                const delegation = delegationManager.findActiveDelegation({
                    approverId: approverId,
                    subsidiary: params.subsidiary,
                    transactionType: params.transactionType
                });
                const actingApprover = delegation ? delegation.delegateId : null;

                const task = record.create({ type: constants.RECORD_TYPES.APPROVAL_TASK });
                task.setValue({ fieldId: constants.TASK_FIELDS.TRAN_TYPE, value: params.transactionType });
                task.setValue({ fieldId: constants.TASK_FIELDS.TRAN_ID, value: params.recordId });
                task.setValue({ fieldId: constants.TASK_FIELDS.RULE, value: params.ruleId });
                task.setValue({ fieldId: constants.TASK_FIELDS.STEP, value: step.id });
                task.setValue({ fieldId: constants.TASK_FIELDS.SEQUENCE, value: step.sequence });
                task.setValue({ fieldId: constants.TASK_FIELDS.APPROVER, value: approverId });
                if (actingApprover) {
                    task.setValue({ fieldId: constants.TASK_FIELDS.ACTING_APPROVER, value: actingApprover });
                }
                task.setValue({ fieldId: constants.TASK_FIELDS.STATUS, value: constants.TASK_STATUS.PENDING });
                task.setValue({ fieldId: constants.TASK_FIELDS.CREATED, value: new Date() });
                task.setValue({ fieldId: constants.TASK_FIELDS.REMINDER_COUNT, value: 0 });

                const token = tokenManager.generateToken();
                const expiry = new Date();
                expiry.setHours(expiry.getHours() + constants.CONFIG.TOKEN_EXPIRY_HOURS);
                task.setValue({ fieldId: constants.TASK_FIELDS.TOKEN, value: token });
                task.setValue({ fieldId: constants.TASK_FIELDS.TOKEN_EXPIRY, value: expiry });

                const taskId = task.save();
                count += 1;
                if (!firstApprover) {
                    firstApprover = actingApprover || approverId;
                }

                notificationManager.sendApprovalRequest({
                    taskId: taskId,
                    approverId: actingApprover || approverId,
                    recordType: params.recordType,
                    recordId: params.recordId
                });
            });
        });

        return { count: count, firstApprover: firstApprover };
    }

    function resolveApproversForStep(step) {
        if (step.approverType === constants.APPROVER_TYPE.NAMED_PERSON && step.approverEmployee) {
            return [step.approverEmployee];
        }
        if (step.approverType === constants.APPROVER_TYPE.ROLE && step.approverRole) {
            const employees = [];
            const employeeSearch = search.create({
                type: 'employee',
                filters: [['role', 'anyof', step.approverRole]],
                columns: ['internalid']
            });
            employeeSearch.run().each(function(result) {
                employees.push(result.getValue('internalid'));
                return true;
            });
            return employees;
        }
        return [];
    }

    function isSequenceComplete(tranType, recordId, sequence) {
        const pendingSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [constants.TASK_FIELDS.TRAN_TYPE, 'anyof', tranType],
                'and',
                [constants.TASK_FIELDS.TRAN_ID, 'equalto', recordId],
                'and',
                [constants.TASK_FIELDS.SEQUENCE, 'equalto', sequence],
                'and',
                [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
            ],
            columns: ['internalid']
        });

        const pending = pendingSearch.run().getRange({ start: 0, end: 1 });
        return !pending || !pending.length;
    }

    function getNextSequence(ruleId, currentSequence) {
        const steps = getStepsForRule(ruleId);
        for (let i = 0; i < steps.length; i += 1) {
            if (steps[i].sequence > currentSequence) {
                return steps[i].sequence;
            }
        }
        return null;
    }

    function getDepartmentGroups(deptId) {
        const groupIds = [];
        const groupSearch = search.create({
            type: constants.RECORD_TYPES.DEPT_GROUP_MEMBER,
            filters: [[ 'custrecord_p2p_dgm_department', 'anyof', deptId ]],
            columns: [ 'custrecord_p2p_dgm_group' ]
        });
        groupSearch.run().each(function(result) {
            groupIds.push(result.getValue('custrecord_p2p_dgm_group'));
            return true;
        });
        return groupIds;
    }

    function getLocationGroups(locId) {
        const groupIds = [];
        const groupSearch = search.create({
            type: constants.RECORD_TYPES.LOC_GROUP_MEMBER,
            filters: [[ 'custrecord_p2p_lgm_location', 'anyof', locId ]],
            columns: [ 'custrecord_p2p_lgm_group' ]
        });
        groupSearch.run().each(function(result) {
            groupIds.push(result.getValue('custrecord_p2p_lgm_group'));
            return true;
        });
        return groupIds;
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

    function getRequestorId(tranType, recordId) {
        try {
            const nsType = getRecordTypeByTranType(tranType);
            const tran = record.load({ type: nsType, id: recordId });
            return tran.getValue('employee') || tran.getValue('requestor') || tran.getValue('createdby');
        } catch (error) {
            log.error('getRequestorId error', error);
            return null;
        }
    }

    return {
        routeForApproval: routeForApproval,
        processApproval: processApproval,
        findMatchingRule: findMatchingRule,
        checkSegregationOfDuties: checkSegregationOfDuties
    };
});
