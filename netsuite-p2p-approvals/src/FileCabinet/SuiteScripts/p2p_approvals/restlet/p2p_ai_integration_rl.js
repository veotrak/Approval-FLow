/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/runtime', 'N/search',
        '../lib/p2p_approval_engine', '../lib/p2p_matching_engine',
        '../constants/p2p_constants'
], function(record, runtime, search, approvalEngine, matchingEngine, constants) {
    'use strict';

    const ADMIN_ROLE_ID = '3';
    const ALLOWED_ROLES_PARAM = 'custscript_p2p_allowed_roles';

    function get(requestParams) {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }

    function post(requestBody) {
        try {
            const payload = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
            const action = payload.action;
            const recordType = payload.recordType;
            const recordId = payload.recordId;
            const comment = payload.comment || '';

            if (!action || !recordType || !recordId) {
                return { success: false, message: 'Missing action or record info.' };
            }

            if (!isAuthorized(action, recordType, recordId)) {
                return { success: false, message: 'Not authorized for this action.' };
            }

            if (action === 'recheckMatching') {
                return recheckMatching(recordId);
            }

            if (action === 'submit' || action === 'resubmit') {
                return submitForApproval(recordType, recordId);
            }

            if (action === 'approve' || action === 'reject' || action === 'approveException') {
                return processApprovalAction(recordType, recordId, action, comment);
            }

            if (action === 'score') {
                return scoreRisk(recordType, recordId, payload);
            }

            return { success: false, message: 'Unknown action.' };
        } catch (error) {
            log.error('post error', error);
            return { success: false, message: error.message };
        }
    }

    function submitForApproval(recordType, recordId) {
        const tran = record.load({ type: recordType, id: recordId });
        record.submitFields({
            type: recordType,
            id: recordId,
            values: {
                [constants.BODY_FIELDS.APPROVAL_STATUS]: constants.APPROVAL_STATUS.DRAFT
            }
        });

        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];
        const data = {
            transactionType: tranType,
            subsidiary: tran.getValue('subsidiary'),
            department: tran.getValue('department'),
            location: tran.getValue('location'),
            amount: Number(tran.getValue('total')) || 0,
            currency: tran.getValue('currency'),
            riskScore: tran.getValue(constants.BODY_FIELDS.AI_RISK_SCORE),
            riskFlags: tran.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS)
        };

        const exceptionType = recordType === 'vendorbill'
            ? tran.getValue(constants.BODY_FIELDS.EXCEPTION_TYPE)
            : null;

        return approvalEngine.routeForApproval({
            recordType: recordType,
            recordId: recordId,
            transactionData: data,
            exceptionType: exceptionType
        });
    }

    function processApprovalAction(recordType, recordId, action, comment) {
        const userId = runtime.getCurrentUser().id;
        let taskId = findPendingTaskForUser(recordType, recordId, userId);
        if (!taskId && isAllowedRole(String(runtime.getCurrentUser().role))) {
            taskId = findPendingTaskForRecord(recordType, recordId);
            if (taskId) {
                assignActingApprover(taskId, userId);
            }
        }
        if (!taskId) {
            return { success: false, message: 'No pending task found for user.' };
        }
        const approvalAction = action === 'approve' || action === 'approveException'
            ? constants.APPROVAL_ACTION.APPROVE
            : constants.APPROVAL_ACTION.REJECT;

        return approvalEngine.processApproval({
            taskId: taskId,
            action: approvalAction,
            comment: comment,
            method: constants.APPROVAL_METHOD.UI
        });
    }

    function findPendingTaskForUser(recordType, recordId, userId) {
        const effectiveUserId = userId || runtime.getCurrentUser().id;
        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];

        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [constants.TASK_FIELDS.TRAN_TYPE, 'anyof', tranType],
                'and',
                [constants.TASK_FIELDS.TRAN_ID, 'equalto', recordId],
                'and',
                [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING],
                'and',
                [
                    [constants.TASK_FIELDS.APPROVER, 'anyof', effectiveUserId],
                    'or',
                    [constants.TASK_FIELDS.ACTING_APPROVER, 'anyof', effectiveUserId]
                ]
            ],
            columns: ['internalid']
        });

        const result = taskSearch.run().getRange({ start: 0, end: 1 });
        return result && result.length ? result[0].getValue('internalid') : null;
    }

    function isAuthorized(action, recordType, recordId) {
        const user = runtime.getCurrentUser();
        const userId = user.id;
        const roleId = String(user.role);

        if (isAllowedRole(roleId)) {
            return true;
        }

        if (action === 'approve' || action === 'reject' || action === 'approveException') {
            return isApproverForRecord(recordType, recordId, userId);
        }

        if (action === 'submit' || action === 'resubmit') {
            return isRequestorOrCreator(recordType, recordId, userId);
        }

        if (action === 'recheckMatching') {
            return isApproverForRecord(recordType, recordId, userId);
        }

        if (action === 'score') {
            return isAllowedRole(roleId);
        }

        return false;
    }

    function isAllowedRole(roleId) {
        const allowedRoles = getAllowedRoles();
        return allowedRoles.indexOf(String(roleId)) !== -1;
    }

    function getAllowedRoles() {
        const script = runtime.getCurrentScript();
        const param = script.getParameter({ name: ALLOWED_ROLES_PARAM }) || '';
        const parsed = param.split(/[,;\s]+/).filter(function(value) {
            return value && value.length;
        });
        if (parsed.indexOf(ADMIN_ROLE_ID) === -1) {
            parsed.push(ADMIN_ROLE_ID);
        }
        return parsed;
    }

    function isApproverForRecord(recordType, recordId, userId) {
        return !!findPendingTaskForUser(recordType, recordId, userId);
    }

    function isRequestorOrCreator(recordType, recordId, userId) {
        try {
            const tran = record.load({ type: recordType, id: recordId });
            const createdBy = tran.getValue('createdby');
            const requestor = tran.getValue('employee') || tran.getValue('requestor');
            if (createdBy && String(createdBy) === String(userId)) {
                return true;
            }
            if (requestor && String(requestor) === String(userId)) {
                return true;
            }
            return false;
        } catch (error) {
            log.error('isRequestorOrCreator error', error);
            return false;
        }
    }

    function findPendingTaskForRecord(recordType, recordId) {
        const tranType = constants.TRANSACTION_TYPE_MAP[recordType];
        const taskSearch = search.create({
            type: constants.RECORD_TYPES.APPROVAL_TASK,
            filters: [
                [constants.TASK_FIELDS.TRAN_TYPE, 'anyof', tranType],
                'and',
                [constants.TASK_FIELDS.TRAN_ID, 'equalto', recordId],
                'and',
                [constants.TASK_FIELDS.STATUS, 'anyof', constants.TASK_STATUS.PENDING]
            ],
            columns: [
                search.createColumn({ name: constants.TASK_FIELDS.SEQUENCE, sort: search.Sort.ASC }),
                search.createColumn({ name: constants.TASK_FIELDS.CREATED, sort: search.Sort.ASC }),
                'internalid'
            ]
        });

        const result = taskSearch.run().getRange({ start: 0, end: 1 });
        return result && result.length ? result[0].getValue('internalid') : null;
    }

    function assignActingApprover(taskId, userId) {
        try {
            record.submitFields({
                type: constants.RECORD_TYPES.APPROVAL_TASK,
                id: taskId,
                values: {
                    [constants.TASK_FIELDS.ACTING_APPROVER]: userId
                }
            });
        } catch (error) {
            log.error('assignActingApprover error', error);
        }
    }

    function recheckMatching(recordId) {
        const matchResult = matchingEngine.performMatchValidation({ recordId: recordId });
        const vbRecord = record.load({ type: 'vendorbill', id: recordId });
        const existingFlags = vbRecord.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS) || '';
        const exceptionFlags = matchResult.exceptions && matchResult.exceptions.length
            ? 'Matching Exceptions: ' + matchResult.exceptions.join(',')
            : '';
        const anomalyFlags = matchResult.anomalies && matchResult.anomalies.length
            ? 'Anomalies: ' + matchResult.anomalies.join(', ')
            : '';
        const mergedFlags = exceptionFlags
            ? (existingFlags ? existingFlags + ' | ' + exceptionFlags : exceptionFlags)
            : existingFlags;
        const mergedWithAnomalies = anomalyFlags
            ? (mergedFlags ? mergedFlags + ' | ' + anomalyFlags : anomalyFlags)
            : mergedFlags;
        record.submitFields({
            type: 'vendorbill',
            id: recordId,
            values: {
                [constants.BODY_FIELDS.MATCH_STATUS]: matchResult.status,
                [constants.BODY_FIELDS.EXCEPTION_TYPE]: matchResult.primaryException || '',
                [constants.BODY_FIELDS.AI_RISK_FLAGS]: mergedWithAnomalies
            }
        });
        return { success: true, result: matchResult };
    }

    function scoreRisk(recordType, recordId, payload) {
        const riskScore = payload.riskScore || 0;
        const riskFlags = payload.riskFlags || '';
        const riskSummary = payload.riskSummary || '';
        const exceptionSuggestion = payload.exceptionSuggestion || '';
        record.submitFields({
            type: recordType,
            id: recordId,
            values: {
                [constants.BODY_FIELDS.AI_RISK_SCORE]: riskScore,
                [constants.BODY_FIELDS.AI_RISK_FLAGS]: riskFlags,
                [constants.BODY_FIELDS.AI_RISK_SUMMARY]: riskSummary,
                [constants.BODY_FIELDS.AI_EXCEPTION_SUGGESTION]: exceptionSuggestion
            }
        });
        return { success: true, riskScore: riskScore };
    }

    return {
        get: get,
        post: post
    };
});
