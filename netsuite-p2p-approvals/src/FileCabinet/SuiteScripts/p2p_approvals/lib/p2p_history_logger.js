/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/record', 'N/search', 'N/format', '../constants/p2p_constants'], function(
    record, search, format, constants
) {
    'use strict';

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function logAction(params) {
        try {
            if (!params || !params.transactionType || !params.transactionId || !params.stepSequence) {
                throw new Error('Missing required history parameters.');
            }

            const history = record.create({ type: constants.RECORD_TYPES.APPROVAL_HISTORY });
            history.setValue({ fieldId: constants.HISTORY_FIELDS.TRAN_TYPE, value: params.transactionType });
            history.setValue({ fieldId: constants.HISTORY_FIELDS.TRAN_ID, value: params.transactionId });
            history.setValue({ fieldId: constants.HISTORY_FIELDS.STEP_SEQUENCE, value: params.stepSequence });
            history.setValue({ fieldId: constants.HISTORY_FIELDS.APPROVER, value: params.approver });
            if (params.actingApprover) {
                history.setValue({ fieldId: constants.HISTORY_FIELDS.ACTING_APPROVER, value: params.actingApprover });
            }
            history.setValue({ fieldId: constants.HISTORY_FIELDS.ACTION, value: params.action });
            history.setValue({
                fieldId: constants.HISTORY_FIELDS.TIMESTAMP,
                value: params.timestamp || new Date()
            });
            if (params.comment) {
                history.setValue({ fieldId: constants.HISTORY_FIELDS.COMMENT, value: params.comment });
            }
            if (params.ipAddress) {
                history.setValue({ fieldId: constants.HISTORY_FIELDS.IP_ADDRESS, value: params.ipAddress });
            }
            if (params.method) {
                history.setValue({ fieldId: constants.HISTORY_FIELDS.METHOD, value: params.method });
            }

            const id = history.save();
            log.audit('History logged', { id: id, action: params.action });
            return id;
        } catch (error) {
            log.error('logAction error', error);
            return null;
        }
    }

    function getFormattedHistory(transactionType, transactionId) {
        try {
            const historySearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_HISTORY,
                filters: [
                    [constants.HISTORY_FIELDS.TRAN_TYPE, 'anyof', transactionType],
                    'and',
                    [constants.HISTORY_FIELDS.TRAN_ID, 'equalto', transactionId]
                ],
                columns: [
                    constants.HISTORY_FIELDS.STEP_SEQUENCE,
                    constants.HISTORY_FIELDS.ACTION,
                    constants.HISTORY_FIELDS.APPROVER,
                    constants.HISTORY_FIELDS.ACTING_APPROVER,
                    constants.HISTORY_FIELDS.TIMESTAMP,
                    constants.HISTORY_FIELDS.COMMENT,
                    constants.HISTORY_FIELDS.METHOD
                ]
            });

            const results = [];
            historySearch.run().each(function(result) {
                results.push({
                    step: result.getValue(constants.HISTORY_FIELDS.STEP_SEQUENCE),
                    action: result.getText(constants.HISTORY_FIELDS.ACTION) || result.getValue(constants.HISTORY_FIELDS.ACTION),
                    approver: result.getText(constants.HISTORY_FIELDS.ACTING_APPROVER)
                        || result.getText(constants.HISTORY_FIELDS.APPROVER),
                    timestamp: result.getValue(constants.HISTORY_FIELDS.TIMESTAMP),
                    comment: result.getValue(constants.HISTORY_FIELDS.COMMENT),
                    method: result.getText(constants.HISTORY_FIELDS.METHOD) || ''
                });
                return true;
            });

            results.sort(function(a, b) {
                return new Date(a.timestamp) - new Date(b.timestamp);
            });

            return results;
        } catch (error) {
            log.error('getFormattedHistory error', error);
            return [];
        }
    }

    function buildHistoryHtml(transactionType, transactionId) {
        const history = getFormattedHistory(transactionType, transactionId);
        if (!history.length) {
            return '<div>No approval history available.</div>';
        }

        let html = '<table style="width:100%; border-collapse:collapse;">';
        html += '<tr>'
            + '<th style="text-align:left; border-bottom:1px solid #ccc;">Step</th>'
            + '<th style="text-align:left; border-bottom:1px solid #ccc;">Action</th>'
            + '<th style="text-align:left; border-bottom:1px solid #ccc;">Approver</th>'
            + '<th style="text-align:left; border-bottom:1px solid #ccc;">Timestamp</th>'
            + '<th style="text-align:left; border-bottom:1px solid #ccc;">Comment</th>'
            + '</tr>';

        history.forEach(function(entry) {
            const timestamp = entry.timestamp
                ? format.format({ value: new Date(entry.timestamp), type: format.Type.DATETIME })
                : '';
            const safeAction = escapeHtml(entry.action);
            const safeApprover = escapeHtml(entry.approver);
            const safeComment = escapeHtml(entry.comment || '');
            html += '<tr>'
                + '<td style="border-bottom:1px solid #eee;">' + entry.step + '</td>'
                + '<td style="border-bottom:1px solid #eee;">' + safeAction + '</td>'
                + '<td style="border-bottom:1px solid #eee;">' + safeApprover + '</td>'
                + '<td style="border-bottom:1px solid #eee;">' + timestamp + '</td>'
                + '<td style="border-bottom:1px solid #eee;">' + safeComment + '</td>'
                + '</tr>';
        });

        html += '</table>';
        return html;
    }

    return {
        logAction: logAction,
        getFormattedHistory: getFormattedHistory,
        buildHistoryHtml: buildHistoryHtml
    };
});
