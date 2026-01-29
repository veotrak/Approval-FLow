/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Vendor Bill
 */
define(['N/record', 'N/runtime', 'N/ui/serverWidget',
        '../lib/p2p_approval_engine', '../lib/p2p_history_logger',
        '../lib/p2p_matching_engine', '../constants/p2p_constants'
], function(record, runtime, serverWidget, approvalEngine,
            historyLogger, matchingEngine, constants) {
    'use strict';

    function beforeLoad(context) {
        try {
            const form = context.form;
            const recordObj = context.newRecord;

            form.clientScriptModulePath = '../client/p2p_vb_cs.js';

            const historyHtml = historyLogger.buildHistoryHtml(
                constants.TRANSACTION_TYPES.VENDOR_BILL,
                recordObj.id
            );
            form.addField({
                id: 'custpage_p2p_history',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'P2P Approval History'
            }).defaultValue = historyHtml;

            if (context.type === context.UserEventType.VIEW) {
                const status = recordObj.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
                const currentApprover = recordObj.getValue(constants.BODY_FIELDS.CURRENT_APPROVER);
                const currentUser = runtime.getCurrentUser().id;

                if (status === constants.APPROVAL_STATUS.DRAFT) {
                    form.addButton({
                        id: 'custpage_p2p_submit',
                        label: 'Submit for Approval',
                        functionName: 'submitForApproval'
                    });
                }
                if (status === constants.APPROVAL_STATUS.PENDING_APPROVAL && String(currentApprover) === String(currentUser)) {
                    form.addButton({
                        id: 'custpage_p2p_approve',
                        label: 'Approve',
                        functionName: 'approveRecord'
                    });
                    form.addButton({
                        id: 'custpage_p2p_reject',
                        label: 'Reject',
                        functionName: 'rejectRecord'
                    });
                }
                if (status === constants.APPROVAL_STATUS.REJECTED) {
                    form.addButton({
                        id: 'custpage_p2p_resubmit',
                        label: 'Resubmit',
                        functionName: 'resubmitForApproval'
                    });
                }
            }
        } catch (error) {
            log.error('beforeLoad error', error);
        }
    }

    function beforeSubmit(context) {
        try {
            const recordObj = context.newRecord;
            if (context.type === context.UserEventType.CREATE) {
                recordObj.setValue({
                    fieldId: constants.BODY_FIELDS.APPROVAL_STATUS,
                    value: constants.APPROVAL_STATUS.DRAFT
                });
            }
        } catch (error) {
            log.error('beforeSubmit error', error);
        }
    }

    function afterSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
                return;
            }

            const recordObj = record.load({ type: 'vendorbill', id: context.newRecord.id });
            const matchResult = matchingEngine.performMatchValidation({ recordId: recordObj.id });
            const existingFlags = recordObj.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS) || '';
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
                id: recordObj.id,
                values: {
                    [constants.BODY_FIELDS.MATCH_STATUS]: matchResult.status,
                    [constants.BODY_FIELDS.EXCEPTION_TYPE]: matchResult.primaryException || '',
                    [constants.BODY_FIELDS.AI_RISK_FLAGS]: mergedWithAnomalies
                }
            });

            const status = recordObj.getValue(constants.BODY_FIELDS.APPROVAL_STATUS);
            if (status !== constants.APPROVAL_STATUS.DRAFT) {
                return;
            }

            approvalEngine.routeForApproval({
                recordType: 'vendorbill',
                recordId: recordObj.id,
                transactionData: {
                    transactionType: constants.TRANSACTION_TYPES.VENDOR_BILL,
                    subsidiary: recordObj.getValue('subsidiary'),
                    department: recordObj.getValue('department'),
                    location: recordObj.getValue('location'),
                    amount: Number(recordObj.getValue('total')) || 0,
                    currency: recordObj.getValue('currency'),
                    riskScore: recordObj.getValue(constants.BODY_FIELDS.AI_RISK_SCORE),
                    riskFlags: recordObj.getValue(constants.BODY_FIELDS.AI_RISK_FLAGS)
                },
                exceptionType: matchResult.primaryException
            });
        } catch (error) {
            log.error('afterSubmit error', error);
        }
    }

    return { beforeLoad: beforeLoad, beforeSubmit: beforeSubmit, afterSubmit: afterSubmit };
});
