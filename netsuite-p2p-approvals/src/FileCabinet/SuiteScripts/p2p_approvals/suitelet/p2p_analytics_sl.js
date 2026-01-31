/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * P2P Analytics Dashboard Suitelet
 * - Pending approvals summary
 * - Pending by approver
 * - Oldest pending tasks
 * - Recent approvals (last 30 days)
 */
define([
    'N/ui/serverWidget', 'N/search', 'N/runtime', 'N/url', 'N/format',
    '../constants/p2p_constants_v2'
], function(serverWidget, search, runtime, url, format, constants) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;
    const HF = constants.HISTORY_FIELDS;
    const ACTION = constants.APPROVAL_ACTION;
    const STATUS = constants.TASK_STATUS;
    const ADMIN_ROLE = '3';

    function onRequest(context) {
        const params = context.request.parameters || {};
        const form = serverWidget.createForm({
            title: 'P2P Analytics Dashboard' + (isAdmin() ? ' (Admin)' : '')
        });

        addInfo(form);
        addFilters(form, params);
        addSummary(form, params);
        addPendingByApprover(form, params);
        addOldestPending(form, params);
        addThroughput(form, params);
        form.addSubmitButton({ label: 'Apply Filters' });

        context.response.writePage(form);
    }

    function isAdmin() {
        return String(runtime.getCurrentUser().role) === ADMIN_ROLE;
    }

    function addInfo(form) {
        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue =
            '<div style="margin: 10px 0; padding: 14px; background: #E3F2FD; border-radius: 6px;">' +
            '<strong>Analytics:</strong> Monitor pending approvals, aging, and recent throughput.' +
            '</div>';
    }

    function addFilters(form, params) {
        form.addFieldGroup({ id: 'custpage_filter_group', label: 'Filters' });

        const typeField = form.addField({
            id: 'custpage_tran_type',
            type: serverWidget.FieldType.SELECT,
            label: 'Transaction Type',
            container: 'custpage_filter_group'
        });
        typeField.addSelectOption({ value: '', text: 'All' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.PURCHASE_ORDER, text: 'Purchase Order' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.VENDOR_BILL, text: 'Vendor Bill' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.SALES_ORDER, text: 'Sales Order' });
        typeField.addSelectOption({ value: constants.TRANSACTION_TYPES.INVOICE, text: 'Invoice' });
        if (params.custpage_tran_type) typeField.defaultValue = params.custpage_tran_type;

        const dateFrom = form.addField({
            id: 'custpage_date_from',
            type: serverWidget.FieldType.DATE,
            label: 'Date From (Throughput)',
            container: 'custpage_filter_group'
        });
        if (params.custpage_date_from) dateFrom.defaultValue = params.custpage_date_from;
        dateFrom.setHelpText({ help: 'If empty, Throughput defaults to the last 30 days.' });

        const dateTo = form.addField({
            id: 'custpage_date_to',
            type: serverWidget.FieldType.DATE,
            label: 'Date To (Throughput)',
            container: 'custpage_filter_group'
        });
        if (params.custpage_date_to) dateTo.defaultValue = params.custpage_date_to;
    }

    function addSummary(form, params) {
        const pending = getPendingTasks(params);
        const bucket = bucketizeAges(pending);

        const total = pending.length;
        const html =
            '<div style="margin: 10px 0; padding: 16px; border: 1px solid #e9ecef; border-radius: 6px; background: #fff;">' +
            '<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; margin-bottom: 10px;">Pending Summary</div>' +
            '<div style="display:flex; gap:24px; flex-wrap: wrap;">' +
            summaryCard('Total Pending', total) +
            summaryCard('< 24h', bucket.lt24) +
            summaryCard('24–48h', bucket.h24_48) +
            summaryCard('48–72h', bucket.h48_72) +
            summaryCard('> 72h', bucket.gt72) +
            '</div>' +
            '</div>';

        form.addField({
            id: 'custpage_summary',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;
    }

    function addPendingByApprover(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_pending_by_approver',
            type: serverWidget.SublistType.LIST,
            label: 'Pending by Approver'
        });

        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Pending Count' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.APPROVER, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            const approver = result.getText({ name: TF.APPROVER, summary: search.Summary.GROUP }) || '';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            safeSet(sublist, 'approver', line, approver);
            safeSet(sublist, 'count', line, count);
            line++;
            return true;
        });
    }

    function addOldestPending(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_oldest_pending',
            type: serverWidget.SublistType.LIST,
            label: 'Oldest Pending Tasks'
        });
        sublist.addField({ id: 'tran', type: serverWidget.FieldType.TEXT, label: 'Transaction' });
        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'age', type: serverWidget.FieldType.TEXT, label: 'Age (hrs)' });
        sublist.addField({ id: 'created', type: serverWidget.FieldType.TEXT, label: 'Created' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                'internalid',
                TF.TRAN_TYPE,
                TF.TRAN_ID,
                TF.CREATED,
                TF.APPROVER,
                search.createColumn({ name: TF.CREATED, sort: search.Sort.ASC })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            if (line >= 15) return false;
            const tranType = result.getValue(TF.TRAN_TYPE);
            const tranId = result.getValue(TF.TRAN_ID);
            const approver = result.getText(TF.APPROVER) || '';
            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);

            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const link = recordType && tranId
                ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                : '';
            const tranLink = link ? '<a href="' + link + '">View</a>' : '';

            safeSet(sublist, 'tran', line, tranLink);
            safeSet(sublist, 'type', line, result.getText(TF.TRAN_TYPE) || tranType || '');
            safeSet(sublist, 'approver', line, approver);
            safeSet(sublist, 'age', line, ageHrs.toFixed(1));
            safeSet(sublist, 'created', line, formatDateTime(created));
            line++;
            return true;
        });
    }

    function addThroughput(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_throughput',
            type: serverWidget.SublistType.LIST,
            label: 'Throughput'
        });
        sublist.addField({ id: 'action', type: serverWidget.FieldType.TEXT, label: 'Action' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Count' });

        const dateFromParam = params && params.custpage_date_from ? params.custpage_date_from : null;
        const dateToParam = params && params.custpage_date_to ? params.custpage_date_to : null;
        let dateFrom = dateFromParam;
        if (!dateFrom) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            dateFrom = format.format({ value: thirtyDaysAgo, type: format.Type.DATE });
        }
        const dateTo = dateToParam || null;

        const filters = [
            [HF.ACTION, 'anyof', [ACTION.APPROVE, ACTION.REJECT]]
        ];
        if (dateFrom) {
            filters.push('and', [HF.TIMESTAMP, 'onorafter', dateFrom]);
        }
        if (dateTo) {
            filters.push('and', [HF.TIMESTAMP, 'onorbefore', dateTo]);
        }
        if (params && params.custpage_tran_type) {
            filters.push('and', [HF.TRAN_TYPE, 'anyof', params.custpage_tran_type]);
        }

        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: filters,
            columns: [
                search.createColumn({ name: HF.ACTION, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            const action = result.getText({ name: HF.ACTION, summary: search.Summary.GROUP }) || '';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            safeSet(sublist, 'action', line, action);
            safeSet(sublist, 'count', line, count);
            line++;
            return true;
        });
    }

    function getPendingTasks(params) {
        const tasks = [];
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [TF.CREATED]
        });
        searchObj.run().each(function(result) {
            tasks.push({
                created: result.getValue(TF.CREATED)
            });
            return true;
        });
        return tasks;
    }

    function bucketizeAges(tasks) {
        const buckets = { lt24: 0, h24_48: 0, h48_72: 0, gt72: 0 };
        tasks.forEach(function(t) {
            const hrs = calculateAgeHours(t.created);
            if (hrs < 24) buckets.lt24++;
            else if (hrs < 48) buckets.h24_48++;
            else if (hrs < 72) buckets.h48_72++;
            else buckets.gt72++;
        });
        return buckets;
    }

    function calculateAgeHours(dateValue) {
        if (!dateValue) return 0;
        let d;
        if (dateValue instanceof Date) d = dateValue;
        else d = format.parse({ value: String(dateValue), type: format.Type.DATETIME });
        if (!d || isNaN(d.getTime())) return 0;
        const diffMs = new Date().getTime() - d.getTime();
        return diffMs / (1000 * 60 * 60);
    }

    function formatDateTime(value) {
        if (!value) return '';
        try {
            return format.format({ value: value, type: format.Type.DATETIME });
        } catch (e) {
            return String(value);
        }
    }

    function summaryCard(label, value) {
        return '<div style="min-width: 120px; padding: 10px 12px; border: 1px solid #f1f3f5; border-radius: 6px; background: #fafbfc;">' +
            '<div style="font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">' + label + '</div>' +
            '<div style="font-size: 18px; font-weight: 600; color: #212529;">' + value + '</div>' +
            '</div>';
    }

    function safeSet(sublist, fieldId, line, value) {
        try {
            if (value === null || value === undefined) return;
            sublist.setSublistValue({ id: fieldId, line: line, value: String(value) });
        } catch (e) {
            // ignore optional set errors
        }
    }

    function buildPendingFilters(params) {
        const filters = [[TF.STATUS, 'anyof', STATUS.PENDING]];
        if (params && params.custpage_tran_type) {
            filters.push('and', [TF.TRAN_TYPE, 'anyof', params.custpage_tran_type]);
        }
        return filters;
    }

    return { onRequest: onRequest };
});
