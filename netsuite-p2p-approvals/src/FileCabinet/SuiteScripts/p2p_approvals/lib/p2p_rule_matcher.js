/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Rule Matcher - Evaluates decision table to find matching rule and path
 */
define(['N/search', 'N/record', 'N/format', './p2p_config', '../constants/p2p_constants_v2'], function(
    search, record, format, config, constants
) {
    'use strict';

    const DR = constants.DECISION_RULE_FIELDS;
    const PF = constants.PATH_FIELDS;
    const SF = constants.STEP_FIELDS;

    /**
     * Find matching decision rule for a transaction context
     * @param {Object} context - Transaction context
     * @param {string} context.tranType - Transaction type (1=PO, 2=VB)
     * @param {number} context.subsidiary - Subsidiary internal ID
     * @param {number} context.amount - Transaction amount
     * @param {number} [context.department] - Department internal ID
     * @param {number} [context.location] - Location internal ID
     * @param {number} [context.riskScore] - AI risk score (0-100)
     * @param {string} [context.exceptionType] - Exception type for VB
     * @returns {Object|null} Match result with rule, path, steps, and explanation
     */
    function findMatch(context) {
        try {
            if (!context || !context.tranType || context.amount === undefined) {
                log.error('findMatch', 'Missing required context fields');
                return null;
            }

            const rules = loadActiveRules(context.tranType);
            if (!rules.length) {
                log.audit('findMatch', 'No active decision rules found for tranType: ' + context.tranType);
                return getFallbackResult(context);
            }

            const matchedRules = [];
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                const evaluation = evaluateRule(rule, context);
                
                if (evaluation.matches) {
                    matchedRules.push({
                        rule: rule,
                        evaluation: evaluation,
                        specificity: calculateSpecificityScore(rule)
                    });
                }
            }

            if (!matchedRules.length) {
                log.audit('findMatch', 'No matching rule found for context: ' + JSON.stringify(context));
                return getFallbackResult(context);
            }

            matchedRules.sort(function(a, b) {
                if (b.specificity !== a.specificity) return b.specificity - a.specificity;
                return (a.rule.priority || 999) - (b.rule.priority || 999);
            });

            for (let i = 0; i < matchedRules.length; i++) {
                const candidate = matchedRules[i];
                const path = loadPath(candidate.rule.pathId);
                if (!path) {
                    log.error('findMatch', 'Path not found for rule: ' + candidate.rule.id);
                    continue;
                }

                const steps = loadPathSteps(candidate.rule.pathId);
                
                return {
                    rule: {
                        id: candidate.rule.id,
                        code: candidate.rule.code,
                        name: candidate.rule.name,
                        priority: candidate.rule.priority
                    },
                    path: path,
                    steps: steps,
                    explanation: buildExplanation(candidate.rule, context, candidate.evaluation)
                };
            }

            log.audit('findMatch', 'No valid approval path found for matching rules.');
            return getFallbackResult(context);
        } catch (error) {
            log.error('findMatch error', error);
            return null;
        }
    }

    /**
     * Debug rule matching for a transaction context
     * @param {Object} context - Transaction context
     * @returns {Object} Debug details
     */
    function debugMatch(context) {
        try {
            if (!context || !context.tranType || context.amount === undefined) {
                return { success: false, message: 'Missing required context fields' };
            }

            const rules = loadActiveRules(context.tranType);
            const evaluated = rules.map(function(rule) {
                const evaluation = evaluateRule(rule, context);
                return {
                    id: rule.id,
                    code: rule.code,
                    name: rule.name,
                    priority: rule.priority,
                    pathId: rule.pathId,
                    fields: {
                        subsidiary: rule.subsidiary,
                        amtMin: rule.amtMin,
                        amtMax: rule.amtMax,
                        department: rule.department,
                        location: rule.location,
                        riskMin: rule.riskMin,
                        riskMax: rule.riskMax,
                        exception: rule.exception
                    },
                    specificity: calculateSpecificityScore(rule),
                    evaluation: evaluation
                };
            });

            const matched = evaluated.filter(function(item) {
                return item.evaluation && item.evaluation.matches;
            });

            matched.sort(function(a, b) {
                if (b.specificity !== a.specificity) return b.specificity - a.specificity;
                return (a.priority || 999) - (b.priority || 999);
            });

            const best = matched.length ? matched[0] : null;

            const cfg = config.getConfig();
            const fallbackPathId = cfg.fallbackPath || null;
            const fallbackPath = fallbackPathId ? loadPath(fallbackPathId) : null;

            return {
                success: true,
                context: context,
                ruleCount: rules.length,
                rules: evaluated,
                matchedCount: matched.length,
                bestMatch: best ? {
                    id: best.id,
                    code: best.code,
                    name: best.name,
                    priority: best.priority,
                    specificity: best.specificity,
                    pathId: best.pathId,
                    pathFound: !!loadPath(best.pathId)
                } : null,
                fallback: {
                    configured: !!fallbackPathId,
                    pathId: fallbackPathId,
                    pathFound: !!fallbackPath
                }
            };
        } catch (error) {
            log.error('debugMatch error', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Load all active decision rules for a transaction type, sorted by priority
     * @param {string} tranType - Transaction type
     * @returns {Object[]} Array of rule objects
     */
    function loadActiveRules(tranType) {
        const today = format.format({ value: new Date(), type: format.Type.DATE });
        
        const filters = [
            [DR.ACTIVE, 'is', 'T'],
            'and',
            [DR.TRAN_TYPE, 'anyof', tranType],
            'and',
            [DR.EFF_FROM, 'onorbefore', today],
            'and',
            [
                [DR.EFF_TO, 'isempty', ''],
                'or',
                [DR.EFF_TO, 'onorafter', today]
            ]
        ];

        const rules = [];
        const ruleSearch = search.create({
            type: constants.RECORD_TYPES.DECISION_RULE,
            filters: filters,
            columns: ['internalid', 'name']
        });

        ruleSearch.run().each(function(result) {
            try {
                const ruleRec = record.load({
                    type: constants.RECORD_TYPES.DECISION_RULE,
                    id: result.id
                });

                rules.push({
                    id: result.id,
                    name: result.getValue('name'),
                    code: getRecordValueSafe(ruleRec, DR.CODE),
                    priority: parseInt(getRecordValueSafe(ruleRec, DR.PRIORITY), 10) || 999,
                    subsidiary: parseMultiSelect(getRecordValueSafe(ruleRec, DR.SUBSIDIARY)),
                    amtMin: parseFloat(getRecordValueSafe(ruleRec, DR.AMT_MIN)) || 0,
                    amtMax: parseFloat(getRecordValueSafe(ruleRec, DR.AMT_MAX)) || null,
                    department: parseMultiSelect(getRecordValueSafe(ruleRec, DR.DEPARTMENT)),
                    location: parseMultiSelect(getRecordValueSafe(ruleRec, DR.LOCATION)),
                    riskMin: parseInt(getRecordValueSafe(ruleRec, DR.RISK_MIN), 10),
                    riskMax: parseInt(getRecordValueSafe(ruleRec, DR.RISK_MAX), 10),
                    exception: parseMultiSelect(getRecordValueSafe(ruleRec, DR.EXCEPTION)),
                    pathId: getRecordValueSafe(ruleRec, DR.PATH),
                    description: getRecordValueSafe(ruleRec, DR.DESCRIPTION)
                });
            } catch (error) {
                log.error('loadActiveRules load error', {
                    id: result.id,
                    message: error.message
                });
            }

            return true;
        });

        // Sort by priority ascending (lower number = higher priority)
        rules.sort(function(a, b) {
            return (a.priority || 999) - (b.priority || 999);
        });

        return rules;
    }

    /**
     * Evaluate a single rule against the context
     * @param {Object} rule - Decision rule
     * @param {Object} context - Transaction context
     * @returns {Object} Evaluation result with matches flag and details
     */
    function evaluateRule(rule, context) {
        const checks = [];
        let matches = true;

        // Amount check (required)
        const amountCheck = {
            field: 'Amount',
            passed: context.amount >= rule.amtMin && (rule.amtMax === null || context.amount <= rule.amtMax),
            expected: formatAmountRange(rule.amtMin, rule.amtMax),
            actual: formatCurrency(context.amount)
        };
        checks.push(amountCheck);
        if (!amountCheck.passed) matches = false;

        // Subsidiary check (if specified)
        if (rule.subsidiary.length > 0) {
            const subValue = context.subsidiary ? String(context.subsidiary) : '';
            const subCheck = {
                field: 'Subsidiary',
                passed: subValue && rule.subsidiary.includes(subValue),
                expected: 'One of: ' + rule.subsidiary.join(', '),
                actual: subValue || 'None'
            };
            checks.push(subCheck);
            if (!subCheck.passed) matches = false;
        }

        // Department check (if specified)
        if (rule.department.length > 0) {
            const deptValue = context.department ? String(context.department) : '';
            const deptCheck = {
                field: 'Department',
                passed: deptValue && rule.department.includes(deptValue),
                expected: 'One of: ' + rule.department.join(', '),
                actual: deptValue || 'None'
            };
            checks.push(deptCheck);
            if (!deptCheck.passed) matches = false;
        }

        // Location check (if specified)
        if (rule.location.length > 0) {
            const locValue = context.location ? String(context.location) : '';
            const locCheck = {
                field: 'Location',
                passed: locValue && rule.location.includes(locValue),
                expected: 'One of: ' + rule.location.join(', '),
                actual: locValue || 'None'
            };
            checks.push(locCheck);
            if (!locCheck.passed) matches = false;
        }

        // Risk score check (if specified)
        if (!isNaN(rule.riskMin) || !isNaN(rule.riskMax)) {
            const riskScore = context.riskScore !== undefined ? context.riskScore : null;
            const riskCheck = {
                field: 'Risk Score',
                passed: checkRiskRange(riskScore, rule.riskMin, rule.riskMax),
                expected: formatRiskRange(rule.riskMin, rule.riskMax),
                actual: riskScore !== null ? String(riskScore) : 'N/A'
            };
            checks.push(riskCheck);
            if (!riskCheck.passed) matches = false;
        }

        // Exception check (if specified)
        if (rule.exception.length > 0) {
            const excCheck = {
                field: 'Exception',
                passed: context.exceptionType && rule.exception.includes(String(context.exceptionType)),
                expected: 'One of: ' + rule.exception.join(', '),
                actual: context.exceptionType || 'None'
            };
            checks.push(excCheck);
            if (!excCheck.passed) matches = false;
        }

        return { matches: matches, checks: checks };
    }

    /**
     * Calculate specificity score based on how many optional fields are set
     * Higher score = more specific rule
     * @param {Object} rule - Decision rule
     * @returns {number} Specificity score
     */
    function calculateSpecificityScore(rule) {
        let score = 0;
        if (rule.subsidiary.length > 0) score += 1;
        if (rule.department.length > 0) score += 2;
        if (rule.location.length > 0) score += 1;
        if (!isNaN(rule.riskMin) || !isNaN(rule.riskMax)) score += 1;
        if (rule.exception.length > 0) score += 1;
        return score;
    }

    /**
     * Load an approval path by ID
     * @param {string} pathId - Path internal ID
     * @returns {Object|null} Path object
     */
    function loadPath(pathId) {
        if (!pathId) return null;

        try {
            const pathRec = record.load({
                type: constants.RECORD_TYPES.APPROVAL_PATH,
                id: pathId
            });

            const isActive = getRecordValueSafe(pathRec, PF.ACTIVE);
            if (isActive === false || isActive === 'F' || isActive === '0') {
                return null;
            }

            return {
                id: pathId,
                name: pathRec.getValue('name'),
                code: getRecordValueSafe(pathRec, PF.CODE),
                description: getRecordValueSafe(pathRec, PF.DESCRIPTION),
                slaHours: parseInt(getRecordValueSafe(pathRec, PF.SLA_HOURS), 10) || null,
                stepSummary: getRecordValueSafe(pathRec, PF.STEP_SUMMARY)
            };
        } catch (error) {
            log.error('loadPath error', error);
            return null;
        }
    }

    /**
     * Load steps for an approval path.
     * Uses minimal search (internalid only) then record.load each step to avoid
     * invalid column errors. Tries both PATH field conventions (p2p_ps vs ps).
     * @param {string} pathId - Path internal ID
     * @returns {Object[]} Array of step objects
     */
    function loadPathSteps(pathId) {
        if (!pathId) return [];

        // Try both PATH field conventions (custrecord_p2p_ps_path vs custrecord_ps_path)
        const pathFieldIds = [SF.PATH, 'custrecord_ps_path'];
        let stepIds = [];

        for (let i = 0; i < pathFieldIds.length && stepIds.length === 0; i++) {
            try {
                const stepSearch = search.create({
                    type: constants.RECORD_TYPES.PATH_STEP,
                    filters: [[pathFieldIds[i], 'anyof', pathId]],
                    columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]
                });
                stepSearch.run().each(function(result) {
                    stepIds.push(result.id);
                    return true;
                });
            } catch (err) {
                log.debug('loadPathSteps', 'Search with ' + pathFieldIds[i] + ' failed: ' + err.message);
            }
        }

        if (!stepIds.length) return [];

        const steps = [];
        for (let j = 0; j < stepIds.length; j++) {
            try {
                const stepRec = record.load({ type: constants.RECORD_TYPES.PATH_STEP, id: stepIds[j] });
                const isActive = getRecordValueSafe(stepRec, SF.ACTIVE);
                if (isActive === false || isActive === 'F' || isActive === '0') continue;

                const seq = getRecordValueSafe(stepRec, SF.SEQUENCE);
                const reqComment = getRecordValueSafe(stepRec, SF.REQUIRE_COMMENT);
                const slaVal = getRecordValueSafe(stepRec, SF.SLA_HOURS);
                steps.push({
                    id: stepIds[j],
                    sequence: seq !== null && seq !== undefined ? parseInt(String(seq), 10) : (j + 1),
                    name: getRecordValueSafe(stepRec, SF.NAME) || 'Step ' + (j + 1),
                    approverType: getRecordValueSafe(stepRec, SF.APPROVER_TYPE),
                    role: getRecordValueSafe(stepRec, SF.ROLE),
                    employee: getRecordValueSafe(stepRec, SF.EMPLOYEE),
                    mode: getRecordValueSafe(stepRec, SF.MODE),
                    requireComment: reqComment === true || reqComment === 'T',
                    slaHours: slaVal !== null && slaVal !== undefined ? parseInt(String(slaVal), 10) : null
                });
            } catch (err) {
                log.warning('loadPathSteps', 'Failed to load step ' + stepIds[j] + ': ' + err.message);
            }
        }

        steps.sort(function(a, b) { return a.sequence - b.sequence; });
        return steps;
    }

    /**
     * Build human-readable explanation of why a rule matched
     * @param {Object} rule - Matched rule
     * @param {Object} context - Transaction context
     * @param {Object} evaluation - Evaluation result
     * @returns {Object} Explanation object
     */
    function buildExplanation(rule, context, evaluation) {
        const lines = [];
        
        evaluation.checks.forEach(function(check) {
            if (check.passed) {
                lines.push('✓ ' + check.field + ': ' + check.actual + ' (matches ' + check.expected + ')');
            }
        });

        const summary = 'Matched rule "' + (rule.name || rule.code) + '" (Priority ' + rule.priority + ')';
        
        return {
            summary: summary,
            details: lines,
            html: buildExplanationHtml(rule, context, evaluation)
        };
    }

    /**
     * Build HTML explanation for display on transaction form
     */
    function buildExplanationHtml(rule, context, evaluation) {
        let html = '<div style="padding:10px; background:#f8f9fa; border-radius:4px; margin:10px 0;">';
        html += '<p style="margin:0 0 10px 0; font-weight:bold;">Rule Match Explanation</p>';
        html += '<p style="margin:0 0 5px 0;"><strong>Matched Rule:</strong> ' + escapeHtml(rule.name || rule.code) + '</p>';
        html += '<p style="margin:0 0 10px 0;"><strong>Priority:</strong> ' + rule.priority + '</p>';
        html += '<ul style="margin:0; padding-left:20px;">';
        
        evaluation.checks.forEach(function(check) {
            const icon = check.passed ? '✓' : '✗';
            const color = check.passed ? '#28a745' : '#dc3545';
            html += '<li style="color:' + color + ';">' + icon + ' ' + escapeHtml(check.field) + ': ';
            html += escapeHtml(check.actual) + '</li>';
        });
        
        html += '</ul></div>';
        return html;
    }

    /**
     * Get fallback result when no rules match
     */
    function getFallbackResult(context) {
        const cfg = config.getConfig();
        
        if (cfg.fallbackPath) {
            const path = loadPath(cfg.fallbackPath);
            if (path) {
                const steps = loadPathSteps(cfg.fallbackPath);
                return {
                    rule: null,
                    path: path,
                    steps: steps,
                    explanation: {
                        summary: 'No matching rule - using fallback path',
                        details: ['Transaction did not match any decision rules'],
                        html: '<div style="padding:10px; background:#fff3cd; border-radius:4px;"><p>No matching rule found. Using fallback approval path.</p></div>'
                    },
                    isFallback: true
                };
            }
        }

        return null;
    }

    // ===== UTILITY FUNCTIONS =====

    function parseMultiSelect(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(String);
        return String(value).split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    }

    function getRecordValueSafe(rec, fieldId) {
        if (!fieldId) return null;
        try {
            return rec.getValue(fieldId);
        } catch (error) {
            return null;
        }
    }

    function createSearchWithSafeColumns(type, filters, columns) {
        let safeColumns = columns.slice();
        while (true) {
            try {
                return search.create({
                    type: type,
                    filters: filters,
                    columns: safeColumns
                });
            } catch (error) {
                const invalidColumn = extractInvalidColumn(error && error.message);
                if (!invalidColumn) {
                    throw error;
                }
                const index = safeColumns.findIndex(function(col) {
                    return col === invalidColumn;
                });
                if (index === -1) {
                    throw error;
                }
                safeColumns.splice(index, 1);
                log.error('createSearchWithSafeColumns', 'Removed invalid column: ' + invalidColumn);
                if (!safeColumns.length) {
                    throw error;
                }
            }
        }
    }

    function runSearchWithSafeColumns(type, filters, columns, onResult) {
        let safeColumns = columns.slice();
        while (true) {
            try {
                const safeSearch = search.create({
                    type: type,
                    filters: filters,
                    columns: safeColumns
                });
                safeSearch.run().each(onResult);
                return;
            } catch (error) {
                const invalidColumn = extractInvalidColumn(error && error.message);
                if (!invalidColumn) {
                    throw error;
                }
                const index = safeColumns.findIndex(function(col) {
                    return col === invalidColumn;
                });
                if (index === -1) {
                    throw error;
                }
                safeColumns.splice(index, 1);
                log.error('runSearchWithSafeColumns', 'Removed invalid column: ' + invalidColumn);
                if (!safeColumns.length) {
                    throw error;
                }
            }
        }
    }

    function extractInvalidColumn(message) {
        if (!message) return null;
        const match = String(message).match(/syntax:\s*([A-Za-z0-9_]+)/);
        return match && match[1] ? match[1] : null;
    }

    function checkRiskRange(score, min, max) {
        if (score === null || score === undefined) return false;
        if (!isNaN(min) && score < min) return false;
        if (!isNaN(max) && score > max) return false;
        return true;
    }

    function formatAmountRange(min, max) {
        if (max === null) return formatCurrency(min) + '+';
        return formatCurrency(min) + ' - ' + formatCurrency(max);
    }

    function formatRiskRange(min, max) {
        const parts = [];
        if (!isNaN(min)) parts.push('>= ' + min);
        if (!isNaN(max)) parts.push('<= ' + max);
        return parts.join(' and ') || 'Any';
    }

    function formatCurrency(amount) {
        return '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        findMatch: findMatch,
        debugMatch: debugMatch,
        loadActiveRules: loadActiveRules,
        evaluateRule: evaluateRule,
        loadPath: loadPath,
        loadPathSteps: loadPathSteps
    };
});
