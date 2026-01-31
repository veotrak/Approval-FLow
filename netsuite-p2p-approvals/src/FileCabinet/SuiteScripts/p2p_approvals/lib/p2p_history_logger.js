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
    const ADMIN_ROLE = '3';

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
     * Format timestamp for display - handles NetSuite search result formats
     */
    function formatTimestamp(value) {
        if (value === null || value === undefined || value === '') return '';
        try {
            var d = parseTimestamp(value);
            if (!d || isNaN(d.getTime())) return String(value);
            return format.format({ value: d, type: format.Type.DATETIME });
        } catch (e) {
            return String(value);
        }
    }

    /**
     * Parse timestamp to Date for sorting - handles NetSuite search result formats
     */
    function parseTimestamp(value) {
        if (value === null || value === undefined || value === '') return null;
        try {
            if (value instanceof Date) return value;
            if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
                return new Date(parseInt(value, 10));
            }
            return format.parse({ value: String(value), type: format.Type.DATETIME });
        } catch (e) {
            return null;
        }
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
                const actionId = result.getValue(HF.ACTION);
                const isAdmin = String(runtime.getCurrentUser().role) === ADMIN_ROLE;
                if (!isAdmin && String(actionId) === String(constants.APPROVAL_ACTION.CANCELLED)) {
                    return true;
                }
                results.push({
                    step: result.getValue(HF.STEP_SEQUENCE),
                    action: result.getText(HF.ACTION) || result.getValue(HF.ACTION),
                    actionId: actionId,
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

            // Sort by timestamp descending (latest on top) - use parseTimestamp for NetSuite date formats
            results.sort(function(a, b) {
                var dateA = parseTimestamp(a.timestamp);
                var dateB = parseTimestamp(b.timestamp);
                var msA = dateA && !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
                var msB = dateB && !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
                return msB - msA;
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

        var emptyStyle = 'padding: 16px; color: #6c757d; font-size: 13px; text-align: center;';
        if (!history.length) {
            return '<div style="' + emptyStyle + '">No approval history available.</div>';
        }

        var cardStyle = 'background: #fff; border: 1px solid #e9ecef; border-radius: 6px; overflow: hidden;';
        var thStyle = 'text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #495057; background: #f8f9fa; border-bottom: 1px solid #dee2e6;';
        var tdStyle = 'padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f1f3f5;';
        var lastTd = 'padding: 10px 12px; font-size: 13px;';

        var html = '<div style="' + cardStyle + '">';
        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<thead><tr>';
        html += '<th style="' + thStyle + ' width: 50px;">Step</th>';
        html += '<th style="' + thStyle + ' width: 100px;">Action</th>';
        html += '<th style="' + thStyle + '">Approver</th>';
        html += '<th style="' + thStyle + ' width: 140px;">Timestamp</th>';
        html += '<th style="' + thStyle + ' width: 70px;">Method</th>';
        html += '<th style="' + thStyle + '">Comment</th>';
        html += '</tr></thead><tbody>';

        history.forEach(function(entry, index) {
            var rowBg = index % 2 === 0 ? '#fff' : '#fafbfc';
            var actionColor = getActionColor(entry.action);
            var timestampDisplay = formatTimestamp(entry.timestamp);
            var isLast = index === history.length - 1;

            html += '<tr style="background: ' + rowBg + ';">';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '">' + escapeHtml(entry.step) + '</td>';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '"><span style="color: ' + actionColor + '; font-weight: 600;">' + escapeHtml(entry.action) + '</span></td>';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '">' + escapeHtml(entry.approver) + '</td>';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '">' + escapeHtml(timestampDisplay) + '</td>';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '">' + escapeHtml(entry.method) + '</td>';
            html += '<td style="' + (isLast ? lastTd : tdStyle) + '">' + escapeHtml(entry.comment || '—') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    /**
     * Get color for action display
     */
    function getActionColor(action) {
        const actionLower = String(action).toLowerCase();
        if (actionLower.indexOf('approve') !== -1) return '#4CAF50';
        if (actionLower.indexOf('exception') !== -1) return '#FF9800';
        if (actionLower.indexOf('reject') !== -1) return '#f44336';
        if (actionLower.indexOf('cancel') !== -1) return '#6c757d';
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
