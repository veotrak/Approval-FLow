/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * P2P History Logger (v2 - Decision Table Architecture)
 * Handles immutable audit trail for all approval actions
 */
define([
    'N/record', 'N/search', 'N/format', 'N/runtime',
    '../constants/p2p_constants_v2'
], function(record, search, format, runtime, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const HF = constants.HISTORY_FIELDS;

    /**
     * Escape HTML for safe display
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Log an approval action to history
     * 
     * @param {Object} params
     * @param {string} params.transactionType - Transaction type (from constants)
     * @param {number} params.transactionId - Transaction internal ID
     * @param {number} params.stepSequence - Step sequence number
     * @param {number} params.approver - Approver employee ID
     * @param {number} [params.actingApprover] - Acting approver if delegated
     * @param {string} params.action - Action taken (from APPROVAL_ACTION constants)
     * @param {string} [params.comment] - Optional comment
     * @param {string} [params.method] - Method (UI, Email, Bulk, API)
     * @param {string} [params.ipAddress] - IP address for email approvals
     * @param {Date} [params.timestamp] - Override timestamp (default: now)
     * @param {number} [params.pathId] - Approval path ID (v2)
     * @param {number} [params.pathStepId] - Path step ID (v2)
     * @param {number} [params.ruleId] - Decision rule ID (v2)
     * @returns {number|null} History record ID or null on failure
     */
    function logAction(params) {
        try {
            if (!params || !params.transactionType || !params.transactionId || !params.action) {
                throw new Error('Missing required history parameters');
            }

            const history = record.create({ type: RT.APPROVAL_HISTORY });

            // Required fields
            history.setValue({ fieldId: HF.TRAN_TYPE, value: params.transactionType });
            history.setValue({ fieldId: HF.TRAN_ID, value: params.transactionId });
            history.setValue({ fieldId: HF.STEP_SEQUENCE, value: params.stepSequence || 0 });
            history.setValue({ fieldId: HF.ACTION, value: params.action });
            history.setValue({ 
                fieldId: HF.TIMESTAMP, 
                value: params.timestamp || new Date() 
            });

            // Approver info
            if (params.approver) {
                history.setValue({ fieldId: HF.APPROVER, value: params.approver });
            } else {
                // Use current user as fallback
                history.setValue({ fieldId: HF.APPROVER, value: runtime.getCurrentUser().id });
            }

            if (params.actingApprover) {
                history.setValue({ fieldId: HF.ACTING_APPROVER, value: params.actingApprover });
            }

            // Optional fields
            if (params.comment) {
                history.setValue({ fieldId: HF.COMMENT, value: params.comment });
            }
            if (params.method) {
                history.setValue({ fieldId: HF.METHOD, value: params.method });
            }
            if (params.ipAddress) {
                history.setValue({ fieldId: HF.IP_ADDRESS, value: params.ipAddress });
            }

            // V2 fields (path/rule references)
            if (params.pathId && HF.PATH) {
                history.setValue({ fieldId: HF.PATH, value: params.pathId });
            }
            if (params.pathStepId && HF.PATH_STEP) {
                history.setValue({ fieldId: HF.PATH_STEP, value: params.pathStepId });
            }
            if (params.ruleId && HF.RULE) {
                history.setValue({ fieldId: HF.RULE, value: params.ruleId });
            }

            const id = history.save();
            
            log.audit('History logged', { 
                id: id, 
                action: params.action,
                tranId: params.transactionId,
                approver: params.approver
            });

            return id;
        } catch (error) {
            log.error('logAction error', error);
            return null;
        }
    }

    /**
     * Get formatted history for a transaction
     * 
     * @param {string} transactionType - Transaction type
     * @param {number} transactionId - Transaction internal ID
     * @returns {Array} Array of history entries
     */
    function getFormattedHistory(transactionType, transactionId) {
        try {
            const historySearch = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: [
                    [HF.TRAN_TYPE, 'anyof', transactionType],
                    'and',
                    [HF.TRAN_ID, 'equalto', transactionId]
                ],
                columns: [
                    HF.STEP_SEQUENCE,
                    HF.ACTION,
                    HF.APPROVER,
                    HF.ACTING_APPROVER,
                    HF.TIMESTAMP,
                    HF.COMMENT,
                    HF.METHOD,
                    HF.IP_ADDRESS
                ]
            });

            const results = [];
            historySearch.run().each(function(result) {
                results.push({
                    step: result.getValue(HF.STEP_SEQUENCE),
                    action: result.getText(HF.ACTION) || result.getValue(HF.ACTION),
                    approver: result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER),
                    approverId: result.getValue(HF.ACTING_APPROVER) || result.getValue(HF.APPROVER),
                    originalApprover: result.getText(HF.APPROVER),
                    timestamp: result.getValue(HF.TIMESTAMP),
                    comment: result.getValue(HF.COMMENT),
                    method: result.getText(HF.METHOD) || '',
                    ipAddress: result.getValue(HF.IP_ADDRESS) || ''
                });
                return true;
            });

            // Sort by timestamp ascending
            results.sort(function(a, b) {
                return new Date(a.timestamp) - new Date(b.timestamp);
            });

            return results;
        } catch (error) {
            log.error('getFormattedHistory error', error);
            return [];
        }
    }

    /**
     * Build HTML table for displaying history on transaction form
     * 
     * @param {string} transactionType - Transaction type
     * @param {number} transactionId - Transaction internal ID
     * @returns {string} HTML table
     */
    function buildHistoryHtml(transactionType, transactionId) {
        const history = getFormattedHistory(transactionType, transactionId);

        if (!history.length) {
            return '<div style="padding: 10px; color: #666;">No approval history available.</div>';
        }

        let html = '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
        html += '<thead>';
        html += '<tr style="background-color: #f5f5f5;">';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Step</th>';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Action</th>';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Approver</th>';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Timestamp</th>';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Method</th>';
        html += '<th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">Comment</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        history.forEach(function(entry, index) {
            const rowColor = index % 2 === 0 ? '#fff' : '#fafafa';
            const actionColor = getActionColor(entry.action);
            
            const timestampDisplay = entry.timestamp 
                ? format.format({ value: new Date(entry.timestamp), type: format.Type.DATETIME })
                : '';

            html += '<tr style="background-color: ' + rowColor + ';">';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + escapeHtml(entry.step) + '</td>';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee; color: ' + actionColor + '; font-weight: bold;">' + escapeHtml(entry.action) + '</td>';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + escapeHtml(entry.approver) + '</td>';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + escapeHtml(timestampDisplay) + '</td>';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + escapeHtml(entry.method) + '</td>';
            html += '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + escapeHtml(entry.comment || '') + '</td>';
            html += '</tr>';
        });

        html += '</tbody>';
        html += '</table>';

        return html;
    }

    /**
     * Get color for action display
     */
    function getActionColor(action) {
        const actionLower = String(action).toLowerCase();
        if (actionLower.indexOf('approve') !== -1) return '#4CAF50';
        if (actionLower.indexOf('reject') !== -1) return '#f44336';
        if (actionLower.indexOf('escalat') !== -1) return '#FF9800';
        if (actionLower.indexOf('submit') !== -1) return '#2196F3';
        if (actionLower.indexOf('recall') !== -1) return '#9C27B0';
        return '#333';
    }

    /**
     * Get last action for a transaction
     * 
     * @param {string} transactionType
     * @param {number} transactionId
     * @returns {Object|null} Last history entry or null
     */
    function getLastAction(transactionType, transactionId) {
        try {
            const historySearch = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: [
                    [HF.TRAN_TYPE, 'anyof', transactionType],
                    'and',
                    [HF.TRAN_ID, 'equalto', transactionId]
                ],
                columns: [
                    search.createColumn({ name: HF.TIMESTAMP, sort: search.Sort.DESC }),
                    HF.ACTION,
                    HF.APPROVER,
                    HF.ACTING_APPROVER,
                    HF.COMMENT
                ]
            });

            const results = historySearch.run().getRange({ start: 0, end: 1 });
            
            if (!results || !results.length) {
                return null;
            }

            const result = results[0];
            return {
                action: result.getText(HF.ACTION) || result.getValue(HF.ACTION),
                approver: result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER),
                timestamp: result.getValue(HF.TIMESTAMP),
                comment: result.getValue(HF.COMMENT)
            };
        } catch (error) {
            log.error('getLastAction error', error);
            return null;
        }
    }

    /**
     * Count actions by type for a transaction
     * 
     * @param {string} transactionType
     * @param {number} transactionId
     * @returns {Object} Count by action type
     */
    function getActionCounts(transactionType, transactionId) {
        try {
            const historySearch = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: [
                    [HF.TRAN_TYPE, 'anyof', transactionType],
                    'and',
                    [HF.TRAN_ID, 'equalto', transactionId]
                ],
                columns: [
                    search.createColumn({ name: HF.ACTION, summary: search.Summary.GROUP }),
                    search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
                ]
            });

            const counts = {};
            historySearch.run().each(function(result) {
                const action = result.getValue({ name: HF.ACTION, summary: search.Summary.GROUP });
                const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT });
                counts[action] = parseInt(count, 10) || 0;
                return true;
            });

            return counts;
        } catch (error) {
            log.error('getActionCounts error', error);
            return {};
        }
    }

    /**
     * Get approval cycle time (time from submit to final approve/reject)
     * 
     * @param {string} transactionType
     * @param {number} transactionId
     * @returns {Object|null} { submitTime, completeTime, durationHours }
     */
    function getCycleTime(transactionType, transactionId) {
        try {
            const history = getFormattedHistory(transactionType, transactionId);
            if (!history.length) return null;

            let submitTime = null;
            let completeTime = null;

            history.forEach(function(entry) {
                const actionLower = String(entry.action).toLowerCase();
                
                if (actionLower.indexOf('submit') !== -1 && !submitTime) {
                    submitTime = new Date(entry.timestamp);
                }
                
                if (actionLower.indexOf('approve') !== -1 || actionLower.indexOf('reject') !== -1) {
                    completeTime = new Date(entry.timestamp);
                }
            });

            if (!submitTime || !completeTime) return null;

            const durationMs = completeTime - submitTime;
            const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10;

            return {
                submitTime: submitTime,
                completeTime: completeTime,
                durationHours: durationHours
            };
        } catch (error) {
            log.error('getCycleTime error', error);
            return null;
        }
    }

    return {
        logAction: logAction,
        getFormattedHistory: getFormattedHistory,
        buildHistoryHtml: buildHistoryHtml,
        getLastAction: getLastAction,
        getActionCounts: getActionCounts,
        getCycleTime: getCycleTime
    };
});
