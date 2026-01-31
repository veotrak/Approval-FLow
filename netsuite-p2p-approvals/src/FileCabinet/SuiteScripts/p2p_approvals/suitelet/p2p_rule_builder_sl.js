/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * P2P Rule Builder Suitelet
 * - Create Decision Rules with basic criteria
 */
define([
    'N/ui/serverWidget', 'N/runtime', 'N/record', 'N/url', 'N/search', 'N/format',
    '../constants/p2p_constants_v2'
], function(serverWidget, runtime, record, url, search, format, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const DF = constants.DECISION_RULE_FIELDS;
    const PF = constants.PATH_FIELDS;
    const SF = constants.STEP_FIELDS;
    const ADMIN_ROLE = '3';

    function onRequest(context) {
        if (context.request.method === 'POST') {
            return handleSubmit(context);
        }
        return renderForm(context);
    }

    function renderForm(context, options) {
        const isAdmin = String(runtime.getCurrentUser().role) === ADMIN_ROLE;
        const form = serverWidget.createForm({
            title: 'P2P Rule Builder' + (isAdmin ? ' (Admin)' : '')
        });

        addInfo(form);
        addRuleFields(form, options);
        addPathPreview(form, options);
        if (options && options.messageHtml) {
            form.addField({
                id: 'custpage_msg',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            }).defaultValue = options.messageHtml;
        }

        form.addSubmitButton({ label: 'Create Rule' });
        context.response.writePage(form);
    }

    function addInfo(form) {
        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue =
            '<div style="margin: 10px 0; padding: 14px; background: #E3F2FD; border-radius: 6px;">' +
            '<strong>Rule Builder:</strong> Create a Decision Rule and link it to an Approval Path. ' +
            'Use Config Portal to manage paths and steps.' +
            '</div>';
    }

    function addRuleFields(form, options) {
        const values = (options && options.values) || {};

        form.addFieldGroup({ id: 'custpage_rule_group', label: 'Rule Details' });

        const nameField = form.addField({
            id: 'custpage_name',
            type: serverWidget.FieldType.TEXT,
            label: 'Rule Name',
            container: 'custpage_rule_group'
        });
        nameField.isMandatory = true;
        if (values.name) nameField.defaultValue = values.name;

        const typeField = form.addField({
            id: 'custpage_tran_type',
            type: serverWidget.FieldType.SELECT,
            label: 'Transaction Type',
            container: 'custpage_rule_group'
        });
        typeField.addSelectOption({ value: '', text: '-- Select --' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.PURCHASE_ORDER, text: 'Purchase Order' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.VENDOR_BILL, text: 'Vendor Bill' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.SALES_ORDER, text: 'Sales Order' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.INVOICE, text: 'Invoice' });
        typeField.isMandatory = true;
        if (values.tranType) typeField.defaultValue = values.tranType;

        const pathField = form.addField({
            id: 'custpage_path',
            type: serverWidget.FieldType.SELECT,
            label: 'Approval Path',
            source: RT.APPROVAL_PATH,
            container: 'custpage_rule_group'
        });
        pathField.isMandatory = true;
        if (values.pathId) pathField.defaultValue = values.pathId;

        const priorityField = form.addField({
            id: 'custpage_priority',
            type: serverWidget.FieldType.INTEGER,
            label: 'Priority (lower = higher priority)',
            container: 'custpage_rule_group'
        });
        if (values.priority) priorityField.defaultValue = values.priority;

        const activeField = form.addField({
            id: 'custpage_active',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Active',
            container: 'custpage_rule_group'
        });
        activeField.defaultValue = values.active === 'F' ? 'F' : 'T';

        const previewOnly = form.addField({
            id: 'custpage_preview_only',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Preview Only (do not create rule)',
            container: 'custpage_rule_group'
        });
        previewOnly.defaultValue = values.previewOnly === 'T' ? 'T' : 'F';

        form.addFieldGroup({ id: 'custpage_criteria_group', label: 'Criteria (Optional)' });

        const subsField = form.addField({
            id: 'custpage_subsidiary',
            type: serverWidget.FieldType.SELECT,
            label: 'Subsidiary',
            source: 'subsidiary',
            container: 'custpage_criteria_group'
        });
        if (values.subsidiary) subsField.defaultValue = values.subsidiary;

        const deptField = form.addField({
            id: 'custpage_department',
            type: serverWidget.FieldType.SELECT,
            label: 'Department',
            source: 'department',
            container: 'custpage_criteria_group'
        });
        if (values.department) deptField.defaultValue = values.department;

        const locField = form.addField({
            id: 'custpage_location',
            type: serverWidget.FieldType.SELECT,
            label: 'Location',
            source: 'location',
            container: 'custpage_criteria_group'
        });
        if (values.location) locField.defaultValue = values.location;

        const currencyField = form.addField({
            id: 'custpage_currency',
            type: serverWidget.FieldType.SELECT,
            label: 'Currency',
            source: 'currency',
            container: 'custpage_criteria_group'
        });
        if (values.currency) currencyField.defaultValue = values.currency;

        const amtMin = form.addField({
            id: 'custpage_amt_min',
            type: serverWidget.FieldType.CURRENCY,
            label: 'Amount Min',
            container: 'custpage_criteria_group'
        });
        if (values.amtMin) amtMin.defaultValue = values.amtMin;

        const amtMax = form.addField({
            id: 'custpage_amt_max',
            type: serverWidget.FieldType.CURRENCY,
            label: 'Amount Max',
            container: 'custpage_criteria_group'
        });
        if (values.amtMax) amtMax.defaultValue = values.amtMax;

        const effFrom = form.addField({
            id: 'custpage_eff_from',
            type: serverWidget.FieldType.DATE,
            label: 'Effective From',
            container: 'custpage_criteria_group'
        });
        if (values.effFrom) effFrom.defaultValue = values.effFrom;

        const effTo = form.addField({
            id: 'custpage_eff_to',
            type: serverWidget.FieldType.DATE,
            label: 'Effective To',
            container: 'custpage_criteria_group'
        });
        if (values.effTo) effTo.defaultValue = values.effTo;

        const customer = form.addField({
            id: 'custpage_customer',
            type: serverWidget.FieldType.SELECT,
            label: 'Customer',
            source: 'customer',
            container: 'custpage_criteria_group'
        });
        if (values.customer) customer.defaultValue = values.customer;

        const salesRep = form.addField({
            id: 'custpage_salesrep',
            type: serverWidget.FieldType.SELECT,
            label: 'Sales Rep',
            source: 'employee',
            container: 'custpage_criteria_group'
        });
        if (values.salesRep) salesRep.defaultValue = values.salesRep;

        const project = form.addField({
            id: 'custpage_project',
            type: serverWidget.FieldType.SELECT,
            label: 'Project',
            source: 'job',
            container: 'custpage_criteria_group'
        });
        if (values.project) project.defaultValue = values.project;

        const classField = form.addField({
            id: 'custpage_class',
            type: serverWidget.FieldType.SELECT,
            label: 'Class',
            source: 'classification',
            container: 'custpage_criteria_group'
        });
        if (values.classId) classField.defaultValue = values.classId;

        const csegField = form.addField({
            id: 'custpage_cseg_field',
            type: serverWidget.FieldType.TEXT,
            label: 'Custom Segment Field ID (optional)',
            container: 'custpage_criteria_group'
        });
        if (values.customSegField) csegField.defaultValue = values.customSegField;

        const csegValues = form.addField({
            id: 'custpage_cseg_values',
            type: serverWidget.FieldType.TEXT,
            label: 'Custom Segment Values (comma-separated internal IDs)',
            container: 'custpage_criteria_group'
        });
        if (values.customSegValues) csegValues.defaultValue = values.customSegValues;

        form.addFieldGroup({ id: 'custpage_sim_group', label: 'Rule Simulation (Optional)' });
        const simType = form.addField({
            id: 'custpage_sim_type',
            type: serverWidget.FieldType.SELECT,
            label: 'Record Type',
            container: 'custpage_sim_group'
        });
        simType.addSelectOption({ value: '', text: '-- Select --' });
        simType.addSelectOption({ value: 'purchaseorder', text: 'Purchase Order' });
        simType.addSelectOption({ value: 'vendorbill', text: 'Vendor Bill' });
        simType.addSelectOption({ value: 'salesorder', text: 'Sales Order' });
        simType.addSelectOption({ value: 'invoice', text: 'Invoice' });
        if (values.simType) simType.defaultValue = values.simType;

        const simId = form.addField({
            id: 'custpage_sim_id',
            type: serverWidget.FieldType.INTEGER,
            label: 'Record ID',
            container: 'custpage_sim_group'
        });
        if (values.simId) simId.defaultValue = values.simId;
    }

    function addPathPreview(form, options) {
        const values = (options && options.values) || {};
        if (!values.pathId) return;

        const previewHtml = buildPathPreviewHtml(values.pathId);
        if (!previewHtml) return;

        form.addFieldGroup({ id: 'custpage_preview_group', label: 'Path Preview' });
        form.addField({
            id: 'custpage_path_preview',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custpage_preview_group'
        }).defaultValue = previewHtml;
    }

    function handleSubmit(context) {
        const params = context.request.parameters;
        const values = {
            name: params.custpage_name,
            tranType: params.custpage_tran_type,
            pathId: params.custpage_path,
            priority: params.custpage_priority,
            active: params.custpage_active,
            previewOnly: params.custpage_preview_only,
            subsidiary: params.custpage_subsidiary,
            department: params.custpage_department,
            location: params.custpage_location,
            currency: params.custpage_currency,
            amtMin: params.custpage_amt_min,
            amtMax: params.custpage_amt_max,
            effFrom: params.custpage_eff_from,
            effTo: params.custpage_eff_to,
            customer: params.custpage_customer,
            salesRep: params.custpage_salesrep,
            project: params.custpage_project,
            classId: params.custpage_class,
            customSegField: params.custpage_cseg_field,
            customSegValues: params.custpage_cseg_values,
            simType: params.custpage_sim_type,
            simId: params.custpage_sim_id
        };

        const errors = validateRule(values);
        if (errors.length) {
            return renderForm(context, {
                values: values,
                messageHtml: buildMessageHtml(errors.join(' '), 'warn')
            });
        }

        if (values.previewOnly === 'T') {
            const simHtml = simulateRule(values);
            return renderForm(context, {
                values: values,
                messageHtml: buildMessageHtml('Preview only. No rule was created.', 'warn') + (simHtml || '')
            });
        }

        try {
            const rule = record.create({ type: RT.DECISION_RULE });
            rule.setValue({ fieldId: 'name', value: values.name });
            rule.setValue({ fieldId: DF.TRAN_TYPE, value: values.tranType });
            rule.setValue({ fieldId: DF.PATH, value: values.pathId });
            rule.setValue({ fieldId: DF.ACTIVE, value: values.active !== 'F' });

            if (values.priority) rule.setValue({ fieldId: DF.PRIORITY, value: parseInt(values.priority, 10) });
            if (values.subsidiary) rule.setValue({ fieldId: DF.SUBSIDIARY, value: values.subsidiary });
            if (values.department) rule.setValue({ fieldId: DF.DEPARTMENT, value: values.department });
            if (values.location) rule.setValue({ fieldId: DF.LOCATION, value: values.location });
            if (values.currency) rule.setValue({ fieldId: DF.CURRENCY, value: values.currency });
            if (values.amtMin) rule.setValue({ fieldId: DF.AMT_MIN, value: parseFloat(values.amtMin) });
            if (values.amtMax) rule.setValue({ fieldId: DF.AMT_MAX, value: parseFloat(values.amtMax) });
            if (values.effFrom) rule.setValue({ fieldId: DF.EFF_FROM, value: values.effFrom });
            if (values.effTo) rule.setValue({ fieldId: DF.EFF_TO, value: values.effTo });
            if (values.customer) rule.setValue({ fieldId: DF.CUSTOMER, value: values.customer });
            if (values.salesRep) rule.setValue({ fieldId: DF.SALES_REP, value: values.salesRep });
            if (values.project) rule.setValue({ fieldId: DF.PROJECT, value: values.project });
            if (values.classId) rule.setValue({ fieldId: DF.CLASS, value: values.classId });
            if (values.customSegField) rule.setValue({ fieldId: DF.CUSTOM_SEG_FIELD, value: values.customSegField });
            if (values.customSegValues) rule.setValue({ fieldId: DF.CUSTOM_SEG_VALUES, value: values.customSegValues });

            const ruleId = rule.save();
            const link = url.resolveRecord({
                recordType: RT.DECISION_RULE,
                recordId: ruleId,
                isEditMode: true
            });

            return renderForm(context, {
                messageHtml: '<div style="margin-top: 12px; padding: 12px; border-radius: 6px; background: #d1e7dd; color: #0f5132;">' +
                    'Rule created successfully. <a href="' + link + '">Open Rule</a>' +
                    '</div>'
            });
        } catch (error) {
            return renderForm(context, {
                values: values,
                messageHtml: buildMessageHtml('Error creating rule: ' + error.message, 'error')
            });
        }
    }

    function simulateRule(values) {
        if (!values.simType || !values.simId) return '';
        try {
            const tran = record.load({ type: values.simType, id: values.simId });
            const context = {
                subsidiary: tran.getValue('subsidiary'),
                amount: parseFloat(tran.getValue('total')) || 0,
                department: tran.getValue('department'),
                location: tran.getValue('location'),
                currency: tran.getValue('currency'),
                customer: tran.getValue('entity'),
                salesRep: tran.getValue('salesrep'),
                project: tran.getValue('job'),
                classId: tran.getValue('class'),
                customSegValue: values.customSegField ? tran.getValue(values.customSegField) : null
            };

            const checks = [];
            let matches = true;

            const min = values.amtMin ? parseFloat(values.amtMin) : 0;
            const max = values.amtMax ? parseFloat(values.amtMax) : null;
            const amountPass = context.amount >= min && (max === null || context.amount <= max);
            checks.push(formatCheck('Amount', amountPass, formatAmountRange(min, max), context.amount));
            if (!amountPass) matches = false;

            matches = applyMultiCheck(checks, matches, 'Subsidiary', values.subsidiary, context.subsidiary);
            matches = applyMultiCheck(checks, matches, 'Department', values.department, context.department);
            matches = applyMultiCheck(checks, matches, 'Location', values.location, context.location);
            matches = applyMultiCheck(checks, matches, 'Currency', values.currency, context.currency);
            matches = applyMultiCheck(checks, matches, 'Customer', values.customer, context.customer);
            matches = applyMultiCheck(checks, matches, 'Sales Rep', values.salesRep, context.salesRep);
            matches = applyMultiCheck(checks, matches, 'Project', values.project, context.project);
            matches = applyMultiCheck(checks, matches, 'Class', values.classId, context.classId);

            if (values.customSegField && values.customSegValues) {
                const allowed = parseCsv(values.customSegValues);
                const actual = context.customSegValue ? String(context.customSegValue) : '';
                const passed = actual && allowed.includes(actual);
                checks.push(formatCheck('Custom Segment ' + values.customSegField, passed, allowed.join(', '), actual || 'None'));
                if (!passed) matches = false;
            }

            let html = '<div style="margin-top: 12px; padding: 12px; border-radius: 6px; border: 1px solid #e9ecef; background: #fff;">';
            html += '<div style="font-weight: 600; margin-bottom: 6px;">Simulation Result</div>';
            html += '<div style="margin-bottom: 8px; color:' + (matches ? '#0f5132' : '#b02a37') + ';">' +
                (matches ? '✓ Rule would match this record.' : '✗ Rule would NOT match this record.') +
                '</div>';
            html += '<ul style="margin:0; padding-left:18px;">';
            checks.forEach(function(c) {
                html += '<li style="color:' + (c.passed ? '#0f5132' : '#b02a37') + ';">' +
                    (c.passed ? '✓ ' : '✗ ') + escapeHtml(c.field) + ': ' +
                    escapeHtml(c.actual) + ' (expected ' + escapeHtml(c.expected) + ')' +
                    '</li>';
            });
            html += '</ul></div>';
            return html;
        } catch (e) {
            return buildMessageHtml('Simulation failed: ' + e.message, 'error');
        }
    }

    function applyMultiCheck(checks, matches, label, ruleValue, actualValue) {
        if (!ruleValue) return matches;
        const allowed = parseCsv(ruleValue);
        if (!allowed.length) return matches;
        const actual = actualValue ? String(actualValue) : '';
        const passed = actual && allowed.includes(actual);
        checks.push(formatCheck(label, passed, allowed.join(', '), actual || 'None'));
        if (!passed) return false;
        return matches;
    }

    function formatCheck(field, passed, expected, actual) {
        return { field: field, passed: passed, expected: expected, actual: String(actual) };
    }

    function parseCsv(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(String);
        return String(value).split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    }

    function formatAmountRange(min, max) {
        if (max === null || max === undefined || isNaN(max)) return '>= ' + min;
        return min + ' to ' + max;
    }

    function validateRule(values) {
        const errors = [];
        if (!values.name) errors.push('Rule Name is required.');
        if (!values.tranType) errors.push('Transaction Type is required.');
        if (!values.pathId) errors.push('Approval Path is required.');

        if (values.amtMin && values.amtMax) {
            const min = parseFloat(values.amtMin);
            const max = parseFloat(values.amtMax);
            if (!isNaN(min) && !isNaN(max) && min > max) {
                errors.push('Amount Min must be less than or equal to Amount Max.');
            }
        }

        if (values.effFrom && values.effTo) {
            try {
                const from = format.parse({ value: values.effFrom, type: format.Type.DATE });
                const to = format.parse({ value: values.effTo, type: format.Type.DATE });
                if (from && to && from.getTime() > to.getTime()) {
                    errors.push('Effective From must be before Effective To.');
                }
            } catch (e) {
                // ignore parse errors
            }
        }

        if (values.pathId) {
            const pathCheck = validatePath(values.pathId);
            if (!pathCheck.ok) {
                errors.push(pathCheck.message);
            }
        }

        if ((values.customSegField && !values.customSegValues) || (!values.customSegField && values.customSegValues)) {
            errors.push('Custom Segment Field ID and Values must both be provided.');
        }

        return errors;
    }

    function validatePath(pathId) {
        try {
            const path = record.load({ type: RT.APPROVAL_PATH, id: pathId });
            const active = path.getValue(PF.ACTIVE);
            if (active === false || active === 'F' || active === '0') {
                return { ok: false, message: 'Selected Approval Path is inactive.' };
            }

            const steps = loadPathSteps(pathId);
            if (!steps.length) {
                return { ok: false, message: 'Selected Approval Path has no active steps.' };
            }

            return { ok: true };
        } catch (e) {
            return { ok: false, message: 'Failed to load Approval Path for validation.' };
        }
    }

    function buildPathPreviewHtml(pathId) {
        try {
            const path = record.load({ type: RT.APPROVAL_PATH, id: pathId });
            const name = path.getValue('name') || path.getValue(PF.DESCRIPTION) || ('Path #' + pathId);
            const sla = path.getValue(PF.SLA_HOURS);
            const active = path.getValue(PF.ACTIVE);
            const steps = loadPathSteps(pathId);

            let html = '<div style="margin-top: 6px; padding: 12px; border: 1px solid #e9ecef; border-radius: 6px; background: #fff;">';
            html += '<div style="font-weight: 600; margin-bottom: 6px;">' + escapeHtml(name) + '</div>';
            html += '<div style="font-size: 12px; color: #6c757d; margin-bottom: 8px;">' +
                'Active: ' + (active === true || active === 'T' ? 'Yes' : 'No') +
                (sla ? ' • SLA: ' + escapeHtml(sla) + ' hrs' : '') +
                '</div>';

            if (!steps.length) {
                html += '<div style="color:#b45309;">No active steps found.</div>';
            } else {
                html += '<ol style="margin: 6px 0 0 18px; padding: 0;">';
                steps.forEach(function(step) {
                    html += '<li>' +
                        escapeHtml(step.sequence) + '. ' + escapeHtml(step.name) +
                        ' — ' + escapeHtml(step.approverType) +
                        (step.approver ? ' (' + escapeHtml(step.approver) + ')' : '') +
                        (step.mode ? ' • ' + escapeHtml(step.mode) : '') +
                        (step.requireComment ? ' • Comment Required' : '') +
                        '</li>';
                });
                html += '</ol>';
            }

            html += '</div>';
            return html;
        } catch (e) {
            return '';
        }
    }

    function loadPathSteps(pathId) {
        if (!pathId) return [];
        const pathFieldIds = [SF.PATH, 'custrecord_ps_path'];
        let stepIds = [];

        for (let i = 0; i < pathFieldIds.length && stepIds.length === 0; i++) {
            try {
                const stepSearch = search.create({
                    type: RT.PATH_STEP,
                    filters: [[pathFieldIds[i], 'anyof', pathId]],
                    columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]
                });
                stepSearch.run().each(function(result) {
                    stepIds.push(result.id);
                    return true;
                });
            } catch (e) {
                // try next field id
            }
        }

        if (!stepIds.length) return [];

        const steps = [];
        for (let j = 0; j < stepIds.length; j++) {
            try {
                const stepRec = record.load({ type: RT.PATH_STEP, id: stepIds[j] });
                const isActive = stepRec.getValue(SF.ACTIVE);
                if (isActive === false || isActive === 'F' || isActive === '0') continue;

                steps.push({
                    id: stepIds[j],
                    sequence: stepRec.getValue(SF.SEQUENCE) || (j + 1),
                    name: stepRec.getValue(SF.NAME) || ('Step ' + (j + 1)),
                    approverType: stepRec.getText(SF.APPROVER_TYPE) || stepRec.getValue(SF.APPROVER_TYPE) || 'Approver',
                    approver: stepRec.getText(SF.EMPLOYEE) || stepRec.getText(SF.ROLE) || '',
                    mode: stepRec.getText(SF.MODE) || stepRec.getValue(SF.MODE) || '',
                    requireComment: stepRec.getValue(SF.REQUIRE_COMMENT) === true || stepRec.getValue(SF.REQUIRE_COMMENT) === 'T'
                });
            } catch (e) {
                // skip invalid step
            }
        }

        steps.sort(function(a, b) { return parseInt(a.sequence, 10) - parseInt(b.sequence, 10); });
        return steps;
    }

    function buildMessageHtml(message, type) {
        const color = type === 'error' ? '#dc3545' : type === 'warn' ? '#b45309' : '#0f5132';
        const bg = type === 'error' ? '#f8d7da' : type === 'warn' ? '#fff3cd' : '#d1e7dd';
        return '<div style="margin-top: 12px; padding: 12px; border-radius: 6px; background: ' + bg + '; color: ' + color + ';">' +
            escapeHtml(message) + '</div>';
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

    return { onRequest: onRequest };
});
