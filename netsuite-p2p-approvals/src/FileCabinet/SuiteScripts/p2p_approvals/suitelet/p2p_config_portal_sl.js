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
        addTestSection(form, options);
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

    function addTestSection(form, options) {
        const testType = (options && options.testType) || '';
        const testId = (options && options.testId) || '';
        const resultHtml = (options && options.resultHtml) || '';

        form.addFieldGroup({
            id: 'custpage_test_group',
            label: 'Rule Tester'
        });

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
        const recordType = params.custpage_test_type;
        const recordId = params.custpage_test_id;

        let resultHtml = '';
        if (!recordType || !recordId) {
            resultHtml = buildMessageHtml('Please provide both Record Type and Record ID.', 'warn');
            return renderForm(context, { testType: recordType, testId: recordId, resultHtml: resultHtml });
        }

        const preview = controller.previewMatch({
            recordType: recordType,
            recordId: recordId
        });

        if (!preview || !preview.success) {
            resultHtml = buildMessageHtml(preview && preview.message ? preview.message : 'No match found.', 'error');
            return renderForm(context, { testType: recordType, testId: recordId, resultHtml: resultHtml });
        }

        resultHtml = buildMatchHtml(preview.match);
        return renderForm(context, { testType: recordType, testId: recordId, resultHtml: resultHtml });
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

        html += '</div>';
        return html;
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
