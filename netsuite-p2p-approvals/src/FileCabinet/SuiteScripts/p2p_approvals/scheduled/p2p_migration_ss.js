/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope Public
 * 
 * P2P Migration Script - Converts legacy rules/steps to decision table architecture
 * 
 * Run this script ONCE after deploying new record types.
 * Creates:
 * - Global Config record with values from script parameters
 * - Approval Paths from unique step combinations
 * - Decision Rules pointing to appropriate paths
 * 
 * Does NOT delete old records (kept for audit trail).
 */
define([
    'N/record', 'N/search', 'N/runtime', 'N/format'
], function(record, search, runtime, format) {
    'use strict';

    // Old record types
    const LEGACY = {
        APPROVAL_RULE: 'customrecord_p2p_approval_rule',
        APPROVAL_STEP: 'customrecord_p2p_approval_step',
        DEPT_GROUP: 'customrecord_p2p_dept_group',
        DEPT_GROUP_MEMBER: 'customrecord_p2p_dept_group_member',
        LOC_GROUP: 'customrecord_p2p_loc_group',
        LOC_GROUP_MEMBER: 'customrecord_p2p_loc_group_member'
    };

    // New record types
    const NEW = {
        DECISION_RULE: 'customrecord_p2p_decision_rule',
        APPROVAL_PATH: 'customrecord_p2p_approval_path',
        PATH_STEP: 'customrecord_p2p_path_step',
        GLOBAL_CONFIG: 'customrecord_p2p_global_config'
    };

    function execute(context) {
        log.audit('Migration Started', 'Converting legacy P2P records to Decision Table architecture');

        try {
            // Step 1: Create Global Config record
            const configId = createGlobalConfig();
            log.audit('Global Config Created', { id: configId });

            // Step 2: Load all legacy rules and steps
            const legacyRules = loadLegacyRules();
            log.audit('Legacy Rules Loaded', { count: legacyRules.length });

            // Step 3: Identify unique step combinations and create Approval Paths
            const pathMap = createApprovalPaths(legacyRules);
            log.audit('Approval Paths Created', { count: Object.keys(pathMap).length });

            // Step 4: Create Decision Rules pointing to paths
            const decisionRuleCount = createDecisionRules(legacyRules, pathMap);
            log.audit('Decision Rules Created', { count: decisionRuleCount });

            // Step 5: Expand department/location groups into multi-select
            log.audit('Migration Complete', {
                globalConfig: configId,
                paths: Object.keys(pathMap).length,
                decisionRules: decisionRuleCount
            });

        } catch (error) {
            log.error('Migration Failed', error);
        }
    }

    /**
     * Create Global Config record from script parameters
     */
    function createGlobalConfig() {
        // Check if already exists
        const existingSearch = search.create({
            type: NEW.GLOBAL_CONFIG,
            filters: [],
            columns: ['internalid']
        });
        const existing = existingSearch.run().getRange({ start: 0, end: 1 });
        if (existing && existing.length) {
            log.audit('Global Config already exists', { id: existing[0].id });
            return existing[0].id;
        }

        const script = runtime.getCurrentScript();
        const config = record.create({ type: NEW.GLOBAL_CONFIG });

        // Set values from script parameters or defaults
        config.setValue({ fieldId: 'name', value: 'P2P Global Configuration' });
        config.setValue({ fieldId: 'custrecord_gc_price_var_pct', value: getParam(script, 'custscript_mig_price_var_pct', 5) });
        config.setValue({ fieldId: 'custrecord_gc_price_var_amt', value: getParam(script, 'custscript_mig_price_var_amt', 500) });
        config.setValue({ fieldId: 'custrecord_gc_fx_tolerance_pct', value: getParam(script, 'custscript_mig_fx_tolerance', 3) });
        config.setValue({ fieldId: 'custrecord_gc_po_threshold', value: getParam(script, 'custscript_mig_po_threshold', 1000) });
        config.setValue({ fieldId: 'custrecord_gc_reminder_1_hrs', value: 24 });
        config.setValue({ fieldId: 'custrecord_gc_reminder_2_hrs', value: 48 });
        config.setValue({ fieldId: 'custrecord_gc_escalation_hrs', value: 72 });
        config.setValue({ fieldId: 'custrecord_gc_token_expiry_hrs', value: 72 });
        config.setValue({ fieldId: 'custrecord_gc_max_delegation_days', value: 30 });
        config.setValue({ fieldId: 'custrecord_gc_bulk_limit', value: 50 });
        config.setValue({ fieldId: 'custrecord_gc_new_vendor_days', value: getParam(script, 'custscript_mig_new_vendor_days', 14) });
        config.setValue({ fieldId: 'custrecord_gc_min_vb_acct_anom', value: getParam(script, 'custscript_mig_min_vb_anom', 5) });
        config.setValue({ fieldId: 'custrecord_gc_reapproval_mode', value: 'material' });

        // Auto-approve settings
        const autoApproveThreshold = getParam(script, 'custscript_mig_auto_approve', null);
        if (autoApproveThreshold) {
            config.setValue({ fieldId: 'custrecord_gc_auto_approve_enabled', value: true });
            config.setValue({ fieldId: 'custrecord_gc_auto_approve_threshold', value: autoApproveThreshold });
        }

        // Webhook URLs
        const teamsWebhook = getParam(script, 'custscript_mig_teams_webhook', '');
        const slackWebhook = getParam(script, 'custscript_mig_slack_webhook', '');
        if (teamsWebhook) config.setValue({ fieldId: 'custrecord_gc_teams_webhook', value: teamsWebhook });
        if (slackWebhook) config.setValue({ fieldId: 'custrecord_gc_slack_webhook', value: slackWebhook });

        return config.save();
    }

    /**
     * Load all legacy rules with their steps
     */
    function loadLegacyRules() {
        const rules = [];

        const ruleSearch = search.create({
            type: LEGACY.APPROVAL_RULE,
            filters: [],
            columns: [
                'name',
                'custrecord_p2p_ar_tran_type',
                'custrecord_p2p_ar_subsidiary',
                'custrecord_p2p_ar_amount_from',
                'custrecord_p2p_ar_amount_to',
                'custrecord_p2p_ar_currency',
                'custrecord_p2p_ar_department',
                'custrecord_p2p_ar_location',
                'custrecord_p2p_ar_dept_group',
                'custrecord_p2p_ar_loc_group',
                'custrecord_p2p_ar_priority',
                'custrecord_p2p_ar_min_risk_score',
                'custrecord_p2p_ar_effective_from',
                'custrecord_p2p_ar_effective_to',
                'custrecord_p2p_ar_active',
                'custrecord_p2p_ar_exc_no_po',
                'custrecord_p2p_ar_exc_variance',
                'custrecord_p2p_ar_exc_no_receipt',
                'custrecord_p2p_ar_sla_hours'
            ]
        });

        ruleSearch.run().each(function(result) {
            const rule = {
                id: result.id,
                name: result.getValue('name'),
                tranType: result.getValue('custrecord_p2p_ar_tran_type'),
                subsidiary: result.getValue('custrecord_p2p_ar_subsidiary'),
                amountFrom: result.getValue('custrecord_p2p_ar_amount_from'),
                amountTo: result.getValue('custrecord_p2p_ar_amount_to'),
                currency: result.getValue('custrecord_p2p_ar_currency'),
                department: result.getValue('custrecord_p2p_ar_department'),
                location: result.getValue('custrecord_p2p_ar_location'),
                deptGroup: result.getValue('custrecord_p2p_ar_dept_group'),
                locGroup: result.getValue('custrecord_p2p_ar_loc_group'),
                priority: result.getValue('custrecord_p2p_ar_priority'),
                minRiskScore: result.getValue('custrecord_p2p_ar_min_risk_score'),
                effectiveFrom: result.getValue('custrecord_p2p_ar_effective_from'),
                effectiveTo: result.getValue('custrecord_p2p_ar_effective_to'),
                active: result.getValue('custrecord_p2p_ar_active'),
                excNoPo: result.getValue('custrecord_p2p_ar_exc_no_po'),
                excVariance: result.getValue('custrecord_p2p_ar_exc_variance'),
                excNoReceipt: result.getValue('custrecord_p2p_ar_exc_no_receipt'),
                slaHours: result.getValue('custrecord_p2p_ar_sla_hours'),
                steps: []
            };

            // Load steps for this rule
            rule.steps = loadStepsForRule(result.id);
            rules.push(rule);
            return true;
        });

        return rules;
    }

    /**
     * Load steps for a specific rule
     */
    function loadStepsForRule(ruleId) {
        const steps = [];

        const stepSearch = search.create({
            type: LEGACY.APPROVAL_STEP,
            filters: [['custrecord_p2p_as_parent_rule', 'anyof', ruleId]],
            columns: [
                search.createColumn({ name: 'custrecord_p2p_as_sequence', sort: search.Sort.ASC }),
                'custrecord_p2p_as_approver_type',
                'custrecord_p2p_as_approver_role',
                'custrecord_p2p_as_approver_employee',
                'custrecord_p2p_as_execution_mode',
                'custrecord_p2p_as_require_comment'
            ]
        });

        stepSearch.run().each(function(result) {
            steps.push({
                id: result.id,
                sequence: result.getValue('custrecord_p2p_as_sequence'),
                approverType: result.getValue('custrecord_p2p_as_approver_type'),
                approverRole: result.getValue('custrecord_p2p_as_approver_role'),
                approverEmployee: result.getValue('custrecord_p2p_as_approver_employee'),
                executionMode: result.getValue('custrecord_p2p_as_execution_mode'),
                requireComment: result.getValue('custrecord_p2p_as_require_comment')
            });
            return true;
        });

        return steps;
    }

    /**
     * Create Approval Paths from unique step combinations
     * Returns map of stepSignature -> pathId
     */
    function createApprovalPaths(legacyRules) {
        const pathMap = {};
        const seenSignatures = {};

        legacyRules.forEach(function(rule) {
            if (!rule.steps.length) return;

            // Create signature for step combination
            const signature = createStepSignature(rule.steps);

            if (seenSignatures[signature]) {
                pathMap[rule.id] = seenSignatures[signature];
                return;
            }

            // Create new path
            const pathName = generatePathName(rule.steps);
            const path = record.create({ type: NEW.APPROVAL_PATH });
            path.setValue({ fieldId: 'name', value: pathName });
            path.setValue({ fieldId: 'custrecord_ap_code', value: 'PATH_' + Object.keys(seenSignatures).length });
            path.setValue({ fieldId: 'custrecord_ap_description', value: 'Migrated from rule: ' + rule.name });
            path.setValue({ fieldId: 'custrecord_ap_sla_hours', value: rule.slaHours || 72 });
            path.setValue({ fieldId: 'custrecord_ap_active', value: true });

            const pathId = path.save();

            // Create path steps
            rule.steps.forEach(function(step, index) {
                const pathStep = record.create({ type: NEW.PATH_STEP });
                pathStep.setValue({ fieldId: 'custrecord_ps_path', value: pathId });
                pathStep.setValue({ fieldId: 'custrecord_ps_sequence', value: step.sequence || (index + 1) });
                pathStep.setValue({ fieldId: 'custrecord_ps_approver_type', value: step.approverType });
                pathStep.setValue({ fieldId: 'custrecord_ps_role', value: step.approverRole || '' });
                pathStep.setValue({ fieldId: 'custrecord_ps_employee', value: step.approverEmployee || '' });
                pathStep.setValue({ fieldId: 'custrecord_ps_mode', value: step.executionMode || '1' });
                pathStep.setValue({ fieldId: 'custrecord_ps_require_comment', value: step.requireComment === 'T' || step.requireComment === true });
                pathStep.setValue({ fieldId: 'custrecord_ps_active', value: true });
                pathStep.save();
            });

            seenSignatures[signature] = pathId;
            pathMap[rule.id] = pathId;

            log.debug('Created Path', { name: pathName, id: pathId, signature: signature });
        });

        return pathMap;
    }

    /**
     * Create signature for step combination to identify duplicates
     */
    function createStepSignature(steps) {
        return steps.map(function(step) {
            return [
                step.sequence,
                step.approverType,
                step.approverRole || '',
                step.approverEmployee || '',
                step.executionMode,
                step.requireComment ? 'Y' : 'N'
            ].join(':');
        }).join('|');
    }

    /**
     * Generate human-readable path name from steps
     */
    function generatePathName(steps) {
        if (steps.length === 1) {
            return steps[0].approverType === '1' ? 'Single Role Approval' : 'Single Person Approval';
        }
        return steps.length + '-Level Approval Chain';
    }

    /**
     * Create Decision Rules from legacy rules
     */
    function createDecisionRules(legacyRules, pathMap) {
        let count = 0;

        legacyRules.forEach(function(rule) {
            const pathId = pathMap[rule.id];
            if (!pathId) {
                log.error('No path for rule', { ruleId: rule.id });
                return;
            }

            const dr = record.create({ type: NEW.DECISION_RULE });
            dr.setValue({ fieldId: 'name', value: rule.name });
            dr.setValue({ fieldId: 'custrecord_dr_code', value: 'DR_' + rule.id });
            
            // Transaction type (convert to multi-select format)
            if (rule.tranType) {
                dr.setValue({ fieldId: 'custrecord_dr_tran_type', value: [rule.tranType] });
            }

            // Subsidiary - expand from single to multi-select
            if (rule.subsidiary) {
                dr.setValue({ fieldId: 'custrecord_dr_subsidiary', value: [rule.subsidiary] });
            }

            // Amount range
            dr.setValue({ fieldId: 'custrecord_dr_amt_min', value: rule.amountFrom || 0 });
            if (rule.amountTo) {
                dr.setValue({ fieldId: 'custrecord_dr_amt_max', value: rule.amountTo });
            }

            // Department - expand group if needed
            const departments = expandDepartmentGroup(rule.department, rule.deptGroup);
            if (departments.length) {
                dr.setValue({ fieldId: 'custrecord_dr_department', value: departments });
            }

            // Location - expand group if needed
            const locations = expandLocationGroup(rule.location, rule.locGroup);
            if (locations.length) {
                dr.setValue({ fieldId: 'custrecord_dr_location', value: locations });
            }

            // Risk score
            if (rule.minRiskScore) {
                dr.setValue({ fieldId: 'custrecord_dr_risk_min', value: rule.minRiskScore });
            }

            // Exception types
            const exceptions = [];
            if (rule.excNoPo === 'T') exceptions.push('1');
            if (rule.excVariance === 'T') exceptions.push('2');
            if (rule.excNoReceipt === 'T') exceptions.push('3');
            if (exceptions.length) {
                dr.setValue({ fieldId: 'custrecord_dr_exception', value: exceptions });
            }

            // Priority
            dr.setValue({ fieldId: 'custrecord_dr_priority', value: rule.priority || 999 });

            // Output: Approval Path
            dr.setValue({ fieldId: 'custrecord_dr_path', value: pathId });

            // Effective dates
            if (rule.effectiveFrom) {
                const fromDate = format.parse({ value: rule.effectiveFrom, type: format.Type.DATE });
                dr.setValue({ fieldId: 'custrecord_dr_eff_from', value: fromDate });
            } else {
                dr.setValue({ fieldId: 'custrecord_dr_eff_from', value: new Date() });
            }

            if (rule.effectiveTo) {
                const toDate = format.parse({ value: rule.effectiveTo, type: format.Type.DATE });
                dr.setValue({ fieldId: 'custrecord_dr_eff_to', value: toDate });
            }

            // Active
            dr.setValue({ fieldId: 'custrecord_dr_active', value: rule.active === 'T' || rule.active === true });

            // Description
            dr.setValue({ fieldId: 'custrecord_dr_description', value: 'Migrated from legacy rule ID: ' + rule.id });

            dr.save();
            count++;
        });

        return count;
    }

    /**
     * Expand department group to list of department IDs
     */
    function expandDepartmentGroup(deptId, groupId) {
        const departments = [];
        
        if (deptId) {
            departments.push(deptId);
        }

        if (groupId) {
            const memberSearch = search.create({
                type: LEGACY.DEPT_GROUP_MEMBER,
                filters: [['custrecord_p2p_dgm_group', 'anyof', groupId]],
                columns: ['custrecord_p2p_dgm_department']
            });

            memberSearch.run().each(function(result) {
                const dept = result.getValue('custrecord_p2p_dgm_department');
                if (dept && departments.indexOf(dept) === -1) {
                    departments.push(dept);
                }
                return true;
            });
        }

        return departments;
    }

    /**
     * Expand location group to list of location IDs
     */
    function expandLocationGroup(locId, groupId) {
        const locations = [];
        
        if (locId) {
            locations.push(locId);
        }

        if (groupId) {
            const memberSearch = search.create({
                type: LEGACY.LOC_GROUP_MEMBER,
                filters: [['custrecord_p2p_lgm_group', 'anyof', groupId]],
                columns: ['custrecord_p2p_lgm_location']
            });

            memberSearch.run().each(function(result) {
                const loc = result.getValue('custrecord_p2p_lgm_location');
                if (loc && locations.indexOf(loc) === -1) {
                    locations.push(loc);
                }
                return true;
            });
        }

        return locations;
    }

    /**
     * Get script parameter with default
     */
    function getParam(script, name, defaultValue) {
        const value = script.getParameter({ name: name });
        return value !== null && value !== '' ? value : defaultValue;
    }

    return { execute: execute };
});
