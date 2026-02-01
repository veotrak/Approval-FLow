/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * P2P Config Portal Suitelet
 * - Admin-friendly view of Decision Rules and Approval Paths
 * - Rule testing by transaction record (previewMatch)
 */
define([
    'N/ui/serverWidget', 'N/search', 'N/runtime', 'N/url',
    '../lib/p2p_controller',
    '../constants/p2p_constants_v2'
], function(serverWidget, search, runtime, url, controller, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const DF = constants.DECISION_RULE_FIELDS;
    const PF = constants.PATH_FIELDS;
    const SF = constants.STEP_FIELDS;
    const ADMIN_ROLE = '3';

    function onRequest(context) {
        if (context.request.method === 'POST') {
            return handleTest(context);
        }
        return renderForm(context);
    }

    function renderForm(context, options) {
        const isAdmin = String(runtime.getCurrentUser().role) === ADMIN_ROLE;
        const form = serverWidget.createForm({
            title: 'P2P Config Portal' + (isAdmin ? ' (Admin)' : '')
        });

        addInfo(form);
        addRuleBuilderLink(form);
        addTestSection(form, options, isAdmin);
        addRuleList(form);
        addPathList(form);

        context.response.writePage(form);
    }

    function addInfo(form) {
        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue =
            '<div style="margin: 10px 0; padding: 14px; background: #E3F2FD; border-radius: 6px;">' +
            '<strong>Config Portal:</strong> View Decision Rules and Approval Paths in one place. ' +
            'Use the Rule Tester to preview which path a transaction will follow.' +
            '</div>';
    }

    function addRuleBuilderLink(form) {
        try {
            const link = url.resolveScript({
                scriptId: 'customscript_p2p_rule_builder_sl',
                deploymentId: 'customdeploy_p2p_rule_builder'
            });
            form.addField({
                id: 'custpage_rule_builder_link',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            }).defaultValue =
                '<div style="margin: 10px 0;">' +
                '<a href="' + link + '" style="display:inline-block; padding:8px 12px; background:#0d6efd; color:#fff; border-radius:4px; text-decoration:none;">Open Rule Builder</a>' +
                '</div>';
        } catch (e) {
            // ignore if deployment not found yet
        }
    }

    function addTestSection(form, options, isAdmin) {
        const testMode = (options && options.testMode) || 'record';
        const testType = (options && options.testType) || '';
        const testId = (options && options.testId) || '';
        const resultHtml = (options && options.resultHtml) || '';
        const adHoc = (options && options.adHoc) || {};
        const debugEnabled = (options && options.debugEnabled) || false;

        form.addFieldGroup({
            id: 'custpage_test_group',
            label: 'Rule Tester'
        });

        const modeField = form.addField({
            id: 'custpage_test_mode',
            type: serverWidget.FieldType.SELECT,
            label: 'Test Mode',
            container: 'custpage_test_group'
        });
        modeField.addSelectOption({ value: 'record', text: 'Record ID' });
        modeField.addSelectOption({ value: 'adhoc', text: 'Ad-hoc (no record)' });
        modeField.defaultValue = testMode;

        if (testMode === 'record') {
            const typeField = form.addField({
                id: 'custpage_test_type',
                type: serverWidget.FieldType.SELECT,
                label: 'Record Type',
                container: 'custpage_test_group'
            });
            typeField.addSelectOption({ value: '', text: '-- Select --' });
            typeField.addSelectOption({ value: 'purchaseorder', text: 'Purchase Order' });
            typeField.addSelectOption({ value: 'vendorbill', text: 'Vendor Bill' });
            typeField.addSelectOption({ value: 'salesorder', text: 'Sales Order' });
            typeField.addSelectOption({ value: 'invoice', text: 'Invoice' });
            typeField.defaultValue = testType;

            const idField = form.addField({
                id: 'custpage_test_id',
                type: serverWidget.FieldType.INTEGER,
                label: 'Record ID',
                container: 'custpage_test_group'
            });
            if (testId) idField.defaultValue = testId;
        } else {
            const tranType = form.addField({
                id: 'custpage_test_tran_type',
                type: serverWidget.FieldType.SELECT,
                label: 'Transaction Type',
                container: 'custpage_test_group'
            });
            tranType.addSelectOption({ value: '', text: '-- Select --' });
            tranType.addSelectOption({ value: 'purchaseorder', text: 'Purchase Order' });
            tranType.addSelectOption({ value: 'vendorbill', text: 'Vendor Bill' });
            tranType.addSelectOption({ value: 'salesorder', text: 'Sales Order' });
            tranType.addSelectOption({ value: 'invoice', text: 'Invoice' });
            if (adHoc.tranType) tranType.defaultValue = adHoc.tranType;

            const amountField = form.addField({
                id: 'custpage_test_amount',
                type: serverWidget.FieldType.CURRENCY,
                label: 'Amount',
                container: 'custpage_test_group'
            });
            if (adHoc.amount) amountField.defaultValue = adHoc.amount;

            const subsField = form.addField({
                id: 'custpage_test_subsidiary',
                type: serverWidget.FieldType.SELECT,
                label: 'Subsidiary',
                source: 'subsidiary',
                container: 'custpage_test_group'
            });
            if (adHoc.subsidiary) subsField.defaultValue = adHoc.subsidiary;

            const deptField = form.addField({
                id: 'custpage_test_department',
                type: serverWidget.FieldType.SELECT,
                label: 'Department',
                source: 'department',
                container: 'custpage_test_group'
            });
            if (adHoc.department) deptField.defaultValue = adHoc.department;

            const locField = form.addField({
                id: 'custpage_test_location',
                type: serverWidget.FieldType.SELECT,
                label: 'Location',
                source: 'location',
                container: 'custpage_test_group'
            });
            if (adHoc.location) locField.defaultValue = adHoc.location;

            const currencyField = form.addField({
                id: 'custpage_test_currency',
                type: serverWidget.FieldType.SELECT,
                label: 'Currency',
                source: 'currency',
                container: 'custpage_test_group'
            });
            if (adHoc.currency) currencyField.defaultValue = adHoc.currency;

            const entityField = form.addField({
                id: 'custpage_test_entity',
                type: serverWidget.FieldType.SELECT,
                label: 'Entity (Vendor/Customer)',
                source: 'entity',
                container: 'custpage_test_group'
            });
            if (adHoc.entity) entityField.defaultValue = adHoc.entity;

            const salesRepField = form.addField({
                id: 'custpage_test_salesrep',
                type: serverWidget.FieldType.SELECT,
                label: 'Sales Rep',
                source: 'employee',
                container: 'custpage_test_group'
            });
            if (adHoc.salesRep) salesRepField.defaultValue = adHoc.salesRep;

            const projectField = form.addField({
                id: 'custpage_test_project',
                type: serverWidget.FieldType.SELECT,
                label: 'Project',
                source: 'job',
                container: 'custpage_test_group'
            });
            if (adHoc.project) projectField.defaultValue = adHoc.project;

            const classField = form.addField({
                id: 'custpage_test_class',
                type: serverWidget.FieldType.SELECT,
                label: 'Class',
                source: 'classification',
                container: 'custpage_test_group'
            });
            if (adHoc.classId) classField.defaultValue = adHoc.classId;

            const riskField = form.addField({
                id: 'custpage_test_risk',
                type: serverWidget.FieldType.INTEGER,
                label: 'Risk Score (optional)',
                container: 'custpage_test_group'
            });
            if (adHoc.riskScore !== undefined && adHoc.riskScore !== null) {
                riskField.defaultValue = String(adHoc.riskScore);
            }

            const exceptionField = form.addField({
                id: 'custpage_test_exception',
                type: serverWidget.FieldType.SELECT,
                label: 'Exception Type (VB only)',
                source: 'customlist_p2p_exception_type_list',
                container: 'custpage_test_group'
            });
            if (adHoc.exceptionType) exceptionField.defaultValue = adHoc.exceptionType;

            const csegField = form.addField({
                id: 'custpage_test_cseg_field',
                type: serverWidget.FieldType.TEXT,
                label: 'Custom Segment Field ID (optional)',
                container: 'custpage_test_group'
            });
            csegField.setHelpText({
                help: 'Enter the transaction body field ID (e.g., custbody_cseg_region).'
            });
            if (adHoc.customSegField) csegField.defaultValue = adHoc.customSegField;

            const csegValues = form.addField({
                id: 'custpage_test_cseg_values',
                type: serverWidget.FieldType.TEXT,
                label: 'Custom Segment Values (comma-separated internal IDs)',
                container: 'custpage_test_group'
            });
            if (adHoc.customSegValues) csegValues.defaultValue = adHoc.customSegValues;
        }

        if (isAdmin) {
            const debugField = form.addField({
                id: 'custpage_test_debug',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Debug Match (admin)',
                container: 'custpage_test_group'
            });
            debugField.defaultValue = debugEnabled ? 'T' : 'F';
        }

        form.addSubmitButton({ label: 'Run Test' });

        if (resultHtml) {
            form.addField({
                id: 'custpage_test_result',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Result',
                container: 'custpage_test_group'
            }).defaultValue = resultHtml;
        }
    }

    function handleTest(context) {
        const params = context.request.parameters;
        const isAdmin = String(runtime.getCurrentUser().role) === ADMIN_ROLE;
        const testMode = params.custpage_test_mode || 'record';
        const debugEnabled = isAdmin && params.custpage_test_debug === 'T';
        const recordType = params.custpage_test_type;
        const recordId = params.custpage_test_id;
        const adHoc = extractAdHocParams(params);

        let resultHtml = '';
        if (testMode === 'record') {
            if (!recordType || !recordId) {
                resultHtml = buildMessageHtml('Please provide both Record Type and Record ID.', 'warn');
                return renderForm(context, {
                    testMode: testMode,
                    testType: recordType,
                    testId: recordId,
                    debugEnabled: debugEnabled,
                    resultHtml: resultHtml
                });
            }

            const preview = controller.previewMatch({
                recordType: recordType,
                recordId: recordId
            });

            if (!preview || !preview.success) {
                resultHtml = buildMessageHtml(preview && preview.message ? preview.message : 'No match found.', 'error');
                return renderForm(context, {
                    testMode: testMode,
                    testType: recordType,
                    testId: recordId,
                    debugEnabled: debugEnabled,
                    resultHtml: resultHtml
                });
            }

            resultHtml = buildMatchHtml(preview.match);
            if (debugEnabled) {
                const debug = controller.debugMatch({ recordType: recordType, recordId: recordId });
                resultHtml += buildDebugHtml(debug);
            }
            return renderForm(context, {
                testMode: testMode,
                testType: recordType,
                testId: recordId,
                debugEnabled: debugEnabled,
                resultHtml: resultHtml
            });
        }

        // Ad-hoc mode
        if (!adHoc.tranType || !adHoc.amount) {
            resultHtml = buildMessageHtml('Please provide Transaction Type and Amount for ad-hoc testing.', 'warn');
            return renderForm(context, {
                testMode: testMode,
                adHoc: adHoc,
                debugEnabled: debugEnabled,
                resultHtml: resultHtml
            });
        }

        const previewAdHoc = controller.previewMatchAdHoc(adHoc);
        if (!previewAdHoc || !previewAdHoc.success) {
            resultHtml = buildMessageHtml(previewAdHoc && previewAdHoc.message ? previewAdHoc.message : 'No match found.', 'error');
            return renderForm(context, {
                testMode: testMode,
                adHoc: adHoc,
                debugEnabled: debugEnabled,
                resultHtml: resultHtml
            });
        }

        resultHtml = buildMatchHtml(previewAdHoc.match);
        if (debugEnabled) {
            const debugAdHoc = controller.debugMatchAdHoc(adHoc);
            resultHtml += buildDebugHtml(debugAdHoc);
        }
        return renderForm(context, {
            testMode: testMode,
            adHoc: adHoc,
            debugEnabled: debugEnabled,
            resultHtml: resultHtml
        });
    }

    function buildMatchHtml(match) {
        const rule = match.rule;
        const path = match.path;
        const steps = match.steps || [];
        const summary = match.explanation && match.explanation.summary ? match.explanation.summary : '';

        let html = '<div style="margin-top: 12px; padding: 14px; border: 1px solid #e9ecef; border-radius: 6px; background: #fff;">';
        html += '<div style="font-weight: 600; margin-bottom: 8px;">Match Result</div>';

        if (summary) {
            html += '<div style="margin-bottom: 8px; color: #495057;">' + escapeHtml(summary) + '</div>';
        }

        if (rule) {
            html += '<div><strong>Rule:</strong> ' + escapeHtml(rule.name || rule.code || ('#' + rule.id)) + ' (Priority ' + escapeHtml(rule.priority) + ')</div>';
        } else {
            html += '<div><strong>Rule:</strong> Fallback (no rule matched)</div>';
        }

        if (path) {
            html += '<div><strong>Path:</strong> ' + escapeHtml(path.name || path.code || ('#' + path.id)) + '</div>';
        }

        if (steps.length) {
            html += '<div style="margin-top: 8px;"><strong>Steps:</strong></div><ol style="margin: 6px 0 0 18px;">';
            steps.forEach(function(step) {
                const name = step.name || ('Step ' + step.sequence);
                html += '<li>' + escapeHtml(name) + ' (Sequence ' + escapeHtml(step.sequence) + ')</li>';
            });
            html += '</ol>';
        }

        if (match.isFallback) {
            html += '<div style="margin-top: 8px; color: #b45309;">Fallback path used.</div>';
        }

        html += '</div>';
        return html;
    }

    function buildDebugHtml(debug) {
        if (!debug) return '';
        if (debug.success === false) {
            return buildMessageHtml(debug.message || 'Debug match failed.', 'error');
        }
        const rules = debug.rules || [];
        const limit = 20;
        let html = '<div style="margin-top: 12px; padding: 12px; border-radius: 6px; border: 1px solid #e9ecef; background: #fafafa;">';
        html += '<div style="font-weight: 600; margin-bottom: 6px;">Debug Match</div>';
        html += '<div style="margin-bottom: 8px; color:#495057;">Rules: ' + escapeHtml(debug.ruleCount) +
            ' | Matched: ' + escapeHtml(debug.matchedCount) + '</div>';

        rules.slice(0, limit).forEach(function(rule) {
            const evals = rule.evaluation && rule.evaluation.checks ? rule.evaluation.checks : [];
            html += '<div style="margin: 10px 0; padding: 8px; border: 1px solid #e9ecef; background:#fff; border-radius:4px;">';
            html += '<div style="font-weight:600;">' + escapeHtml(rule.name || rule.code || ('#' + rule.id)) +
                ' (Priority ' + escapeHtml(rule.priority) + ')' +
                (rule.evaluation && rule.evaluation.matches ? ' ✓' : ' ✗') + '</div>';
            if (evals.length) {
                html += '<ul style="margin:6px 0 0 18px;">';
                evals.forEach(function(check) {
                    html += '<li style="color:' + (check.passed ? '#0f5132' : '#b02a37') + ';">' +
                        (check.passed ? '✓ ' : '✗ ') + escapeHtml(check.field) + ': ' +
                        escapeHtml(check.actual) + ' (expected ' + escapeHtml(check.expected) + ')' +
                        '</li>';
                });
                html += '</ul>';
            }
            html += '</div>';
        });

        if (rules.length > limit) {
            html += '<div style="color:#6c757d;">Showing first ' + limit + ' rules.</div>';
        }
        html += '</div>';
        return html;
    }

    function extractAdHocParams(params) {
        return {
            tranType: params.custpage_test_tran_type || '',
            amount: params.custpage_test_amount || '',
            subsidiary: params.custpage_test_subsidiary || '',
            department: params.custpage_test_department || '',
            location: params.custpage_test_location || '',
            currency: params.custpage_test_currency || '',
            entity: params.custpage_test_entity || '',
            salesRep: params.custpage_test_salesrep || '',
            project: params.custpage_test_project || '',
            classId: params.custpage_test_class || '',
            riskScore: params.custpage_test_risk || '',
            exceptionType: params.custpage_test_exception || '',
            customSegField: params.custpage_test_cseg_field || '',
            customSegValues: params.custpage_test_cseg_values || ''
        };
    }

    function addRuleList(form) {
        form.addFieldGroup({
            id: 'custpage_rules_group',
            label: 'Decision Rules'
        });

        const sublist = form.addSublist({
            id: 'custpage_rules',
            type: serverWidget.SublistType.LIST,
            label: 'Decision Rules'
        });

        sublist.addField({ id: 'rule_link', type: serverWidget.FieldType.TEXT, label: 'Open' });
        sublist.addField({ id: 'rule_name', type: serverWidget.FieldType.TEXT, label: 'Name' });
        sublist.addField({ id: 'rule_active', type: serverWidget.FieldType.TEXT, label: 'Active' });
        sublist.addField({ id: 'rule_priority', type: serverWidget.FieldType.TEXT, label: 'Priority' });
        sublist.addField({ id: 'rule_type', type: serverWidget.FieldType.TEXT, label: 'Tran Type' });
        sublist.addField({ id: 'rule_subs', type: serverWidget.FieldType.TEXT, label: 'Subsidiary' });
        sublist.addField({ id: 'rule_dept', type: serverWidget.FieldType.TEXT, label: 'Department' });
        sublist.addField({ id: 'rule_loc', type: serverWidget.FieldType.TEXT, label: 'Location' });
        sublist.addField({ id: 'rule_amt_min', type: serverWidget.FieldType.TEXT, label: 'Amt Min' });
        sublist.addField({ id: 'rule_amt_max', type: serverWidget.FieldType.TEXT, label: 'Amt Max' });
        sublist.addField({ id: 'rule_path', type: serverWidget.FieldType.TEXT, label: 'Path' });
        sublist.addField({ id: 'rule_eff', type: serverWidget.FieldType.TEXT, label: 'Effective' });

        const ruleSearch = search.create({
            type: RT.DECISION_RULE,
            filters: [],
            columns: [
                'internalid',
                'name',
                DF.ACTIVE,
                DF.PRIORITY,
                DF.TRAN_TYPE,
                DF.SUBSIDIARY,
                DF.DEPARTMENT,
                DF.LOCATION,
                DF.AMT_MIN,
                DF.AMT_MAX,
                DF.PATH,
                DF.EFF_FROM,
                DF.EFF_TO
            ]
        });

        let line = 0;
        ruleSearch.run().each(function(result) {
            const id = result.getValue('internalid');
            const link = url.resolveRecord({
                recordType: RT.DECISION_RULE,
                recordId: id,
                isEditMode: true
            });

            safeSet(sublist, 'rule_link', line, '<a href="' + link + '">Open</a>');
            safeSet(sublist, 'rule_name', line, result.getValue('name') || '');
            safeSet(sublist, 'rule_active', line, result.getValue(DF.ACTIVE) === 'T' ? 'Yes' : 'No');
            safeSet(sublist, 'rule_priority', line, result.getValue(DF.PRIORITY) || '');
            safeSet(sublist, 'rule_type', line, result.getText(DF.TRAN_TYPE) || '');
            safeSet(sublist, 'rule_subs', line, result.getText(DF.SUBSIDIARY) || '');
            safeSet(sublist, 'rule_dept', line, result.getText(DF.DEPARTMENT) || '');
            safeSet(sublist, 'rule_loc', line, result.getText(DF.LOCATION) || '');
            safeSet(sublist, 'rule_amt_min', line, result.getValue(DF.AMT_MIN) || '');
            safeSet(sublist, 'rule_amt_max', line, result.getValue(DF.AMT_MAX) || '');
            safeSet(sublist, 'rule_path', line, result.getText(DF.PATH) || '');
            const effFrom = result.getValue(DF.EFF_FROM) || '';
            const effTo = result.getValue(DF.EFF_TO) || '';
            safeSet(sublist, 'rule_eff', line, (effFrom || effTo) ? (effFrom + ' - ' + effTo) : '');
            line++;
            return true;
        });
    }

    function addPathList(form) {
        form.addFieldGroup({
            id: 'custpage_paths_group',
            label: 'Approval Paths'
        });

        const sublist = form.addSublist({
            id: 'custpage_paths',
            type: serverWidget.SublistType.LIST,
            label: 'Approval Paths'
        });

        sublist.addField({ id: 'path_link', type: serverWidget.FieldType.TEXT, label: 'Open' });
        sublist.addField({ id: 'path_name', type: serverWidget.FieldType.TEXT, label: 'Name' });
        sublist.addField({ id: 'path_active', type: serverWidget.FieldType.TEXT, label: 'Active' });
        sublist.addField({ id: 'path_sla', type: serverWidget.FieldType.TEXT, label: 'SLA (hrs)' });
        sublist.addField({ id: 'path_steps', type: serverWidget.FieldType.TEXT, label: 'Steps' });
        sublist.addField({ id: 'path_desc', type: serverWidget.FieldType.TEXT, label: 'Description' });

        const stepCounts = getStepCounts();

        const pathSearch = search.create({
            type: RT.APPROVAL_PATH,
            filters: [],
            columns: [
                'internalid',
                'name',
                PF.ACTIVE,
                PF.SLA_HOURS,
                PF.DESCRIPTION
            ]
        });

        let line = 0;
        pathSearch.run().each(function(result) {
            const id = result.getValue('internalid');
            const link = url.resolveRecord({
                recordType: RT.APPROVAL_PATH,
                recordId: id,
                isEditMode: true
            });

            safeSet(sublist, 'path_link', line, '<a href="' + link + '">Open</a>');
            safeSet(sublist, 'path_name', line, result.getValue('name') || '');
            safeSet(sublist, 'path_active', line, result.getValue(PF.ACTIVE) === 'T' ? 'Yes' : 'No');
            safeSet(sublist, 'path_sla', line, result.getValue(PF.SLA_HOURS) || '');
            safeSet(sublist, 'path_steps', line, stepCounts[id] || '0');
            safeSet(sublist, 'path_desc', line, result.getValue(PF.DESCRIPTION) || '');
            line++;
            return true;
        });
    }

    function getStepCounts() {
        const counts = {};
        const stepSearch = search.create({
            type: RT.PATH_STEP,
            filters: [],
            columns: [
                search.createColumn({ name: SF.PATH, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        stepSearch.run().each(function(result) {
            const pathId = result.getValue({ name: SF.PATH, summary: search.Summary.GROUP });
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT });
            if (pathId) counts[pathId] = count;
            return true;
        });
        return counts;
    }

    function buildMessageHtml(message, type) {
        const color = type === 'error' ? '#dc3545' : type === 'warn' ? '#b45309' : '#0f5132';
        const bg = type === 'error' ? '#f8d7da' : type === 'warn' ? '#fff3cd' : '#d1e7dd';
        return '<div style="margin-top: 12px; padding: 12px; border-radius: 6px; background: ' + bg + '; color: ' + color + ';">' +
            escapeHtml(message) + '</div>';
    }

    function safeSet(sublist, fieldId, line, value) {
        try {
            if (value === null || value === undefined) return;
            sublist.setSublistValue({ id: fieldId, line: line, value: String(value) });
        } catch (e) {
            // ignore set errors for optional fields
        }
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return {
        onRequest: onRequest
    };
});
