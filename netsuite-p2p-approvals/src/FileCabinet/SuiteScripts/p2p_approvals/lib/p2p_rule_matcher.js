/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Rule Matcher - Evaluates decision table to find matching rule and path
 */
define(['N/search', 'N/format', './p2p_config', '../constants/p2p_constants_v2'], function(
    search, format, config, constants
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

            // Evaluate each rule in priority order
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                const evaluation = evaluateRule(rule, context);
                
                if (evaluation.matches) {
                    const path = loadPath(rule.pathId);
                    if (!path) {
                        log.error('findMatch', 'Path not found for rule: ' + rule.id);
                        continue;
                    }

                    const steps = loadPathSteps(rule.pathId);
                    
                    return {
                        rule: {
                            id: rule.id,
                            code: rule.code,
                            name: rule.name,
                            priority: rule.priority
                        },
                        path: path,
                        steps: steps,
                        explanation: buildExplanation(rule, context, evaluation)
                    };
                }
            }

            log.audit('findMatch', 'No matching rule found for context: ' + JSON.stringify(context));
            return getFallbackResult(context);
        } catch (error) {
            log.error('findMatch error', error);
            return null;
        }
    }

    /**
     * Load all active decision rules for a transaction type, sorted by priority
     * @param {string} tranType - Transaction type
     * @returns {Object[]} Array of rule objects
     */
    function loadActiveRules(tranType) {
        const today = format.format({ value: new Date(), type: format.Type.DATE });
        
        const ruleSearch = search.create({
            type: constants.RECORD_TYPES.DECISION_RULE,
            filters: [
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
            ],
            columns: [
                search.createColumn({ name: DR.PRIORITY, sort: search.Sort.ASC }),
                'name',
                DR.CODE,
                DR.SUBSIDIARY,
                DR.AMT_MIN,
                DR.AMT_MAX,
                DR.DEPARTMENT,
                DR.LOCATION,
                DR.RISK_MIN,
                DR.RISK_MAX,
                DR.EXCEPTION,
                DR.PATH,
                DR.DESCRIPTION
            ]
        });

        const rules = [];
        ruleSearch.run().each(function(result) {
            rules.push({
                id: result.id,
                name: result.getValue('name'),
                code: result.getValue(DR.CODE),
                priority: parseInt(result.getValue(DR.PRIORITY), 10) || 999,
                subsidiary: parseMultiSelect(result.getValue(DR.SUBSIDIARY)),
                amtMin: parseFloat(result.getValue(DR.AMT_MIN)) || 0,
                amtMax: parseFloat(result.getValue(DR.AMT_MAX)) || null,
                department: parseMultiSelect(result.getValue(DR.DEPARTMENT)),
                location: parseMultiSelect(result.getValue(DR.LOCATION)),
                riskMin: parseInt(result.getValue(DR.RISK_MIN), 10),
                riskMax: parseInt(result.getValue(DR.RISK_MAX), 10),
                exception: parseMultiSelect(result.getValue(DR.EXCEPTION)),
                pathId: result.getValue(DR.PATH),
                description: result.getValue(DR.DESCRIPTION)
            });
            return true;
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
            const subCheck = {
                field: 'Subsidiary',
                passed: rule.subsidiary.includes(String(context.subsidiary)),
                expected: 'One of: ' + rule.subsidiary.join(', '),
                actual: String(context.subsidiary)
            };
            checks.push(subCheck);
            if (!subCheck.passed) matches = false;
        }

        // Department check (if specified)
        if (rule.department.length > 0 && context.department) {
            const deptCheck = {
                field: 'Department',
                passed: rule.department.includes(String(context.department)),
                expected: 'One of: ' + rule.department.join(', '),
                actual: String(context.department)
            };
            checks.push(deptCheck);
            if (!deptCheck.passed) matches = false;
        }

        // Location check (if specified)
        if (rule.location.length > 0 && context.location) {
            const locCheck = {
                field: 'Location',
                passed: rule.location.includes(String(context.location)),
                expected: 'One of: ' + rule.location.join(', '),
                actual: String(context.location)
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
     * Load an approval path by ID
     * @param {string} pathId - Path internal ID
     * @returns {Object|null} Path object
     */
    function loadPath(pathId) {
        if (!pathId) return null;

        try {
            const pathSearch = search.create({
                type: constants.RECORD_TYPES.APPROVAL_PATH,
                filters: [
                    ['internalid', 'anyof', pathId],
                    'and',
                    [PF.ACTIVE, 'is', 'T']
                ],
                columns: ['name', PF.CODE, PF.DESCRIPTION, PF.SLA_HOURS, PF.STEP_SUMMARY]
            });

            const results = pathSearch.run().getRange({ start: 0, end: 1 });
            if (!results || !results.length) return null;

            const result = results[0];
            return {
                id: result.id,
                name: result.getValue('name'),
                code: result.getValue(PF.CODE),
                description: result.getValue(PF.DESCRIPTION),
                slaHours: parseInt(result.getValue(PF.SLA_HOURS), 10) || null,
                stepSummary: result.getValue(PF.STEP_SUMMARY)
            };
        } catch (error) {
            log.error('loadPath error', error);
            return null;
        }
    }

    /**
     * Load steps for an approval path
     * @param {string} pathId - Path internal ID
     * @returns {Object[]} Array of step objects
     */
    function loadPathSteps(pathId) {
        if (!pathId) return [];

        try {
            const stepSearch = search.create({
                type: constants.RECORD_TYPES.PATH_STEP,
                filters: [
                    [SF.PATH, 'anyof', pathId],
                    'and',
                    [SF.ACTIVE, 'is', 'T']
                ],
                columns: [
                    search.createColumn({ name: SF.SEQUENCE, sort: search.Sort.ASC }),
                    SF.NAME,
                    SF.APPROVER_TYPE,
                    SF.ROLE,
                    SF.EMPLOYEE,
                    SF.MODE,
                    SF.REQUIRE_COMMENT,
                    SF.SLA_HOURS
                ]
            });

            const steps = [];
            stepSearch.run().each(function(result) {
                steps.push({
                    id: result.id,
                    sequence: parseInt(result.getValue(SF.SEQUENCE), 10),
                    name: result.getValue(SF.NAME),
                    approverType: result.getValue(SF.APPROVER_TYPE),
                    role: result.getValue(SF.ROLE),
                    employee: result.getValue(SF.EMPLOYEE),
                    mode: result.getValue(SF.MODE),
                    requireComment: result.getValue(SF.REQUIRE_COMMENT) === true || result.getValue(SF.REQUIRE_COMMENT) === 'T',
                    slaHours: parseInt(result.getValue(SF.SLA_HOURS), 10) || null
                });
                return true;
            });

            return steps;
        } catch (error) {
            log.error('loadPathSteps error', error);
            return [];
        }
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
        loadActiveRules: loadActiveRules,
        evaluateRule: evaluateRule,
        loadPath: loadPath,
        loadPathSteps: loadPathSteps
    };
});
