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
    'N/ui/serverWidget', 'N/search', 'N/runtime', 'N/url', 'N/format', 'N/file', 'N/record',
    '../constants/p2p_constants_v2', '../lib/p2p_history_logger'
], function(serverWidget, search, runtime, url, format, file, record, constants, historyLogger) {
    'use strict';

    const RT = constants.RECORD_TYPES;
    const TF = constants.TASK_FIELDS;
    const HF = constants.HISTORY_FIELDS;
    const ACTION = constants.APPROVAL_ACTION;
    const STATUS = constants.TASK_STATUS;
    const SF = constants.STEP_FIELDS;
    const BF = constants.BODY_FIELDS;
    const ADMIN_ROLE = '3';

    function onRequest(context) {
        const params = context.request.parameters || {};
        if (params.action === 'export_pending' || params.action === 'export_pending_all') {
            return exportPendingCsv(context, params);
        }
        if (params.action === 'export_throughput') {
            return exportThroughputCsv(context, params);
        }
        if (params.action === 'export_summary') {
            return exportSummaryExcel(context, params);
        }
        const form = serverWidget.createForm({
            title: 'P2P Analytics Dashboard' + (isAdmin() ? ' (Admin)' : '')
        });

        const view = getView(params);
        const showCharts = getShowCharts(params);
        const pending = getPendingTasks(params);
        const totalPendingCount = getPendingCount(params, { ignoreType: true });
        const slaBreachCount = getSlaBreachCount(params);
        const avgCycleHrs = getAverageCycleTime(params);
        const medianCycleHrs = getMedianCycleTime(params);
        const p95CycleHrs = getPercentileCycleTime(params, 0.95);
        const summaryTabId = 'custpage_summary_tab';
        form.addSubtab({
            id: summaryTabId,
            label: 'Summary'
        });
        const throughputCount = getThroughputCount(params);
        const summaryCounts = getSummaryExportCounts(params, view);
        addFilters(form, params, pending.length, totalPendingCount, throughputCount, summaryCounts, view);
        addOverview(form, pending, slaBreachCount, avgCycleHrs, medianCycleHrs, p95CycleHrs, params);
        addInlineBreakdown(form, params, view, showCharts, summaryTabId);
        if (view === 'all' || view === 'pending') {
            addPendingByApprover(form, params);
            addOldestPending(form, params);
            addSlaBreaches(form, params);
        }
        if (view === 'all' || view === 'throughput') {
            addThroughputDetail(form, params);
        }
        form.addSubmitButton({ label: 'Apply Filters' });

        context.response.writePage(form);
    }

    function isAdmin() {
        return String(runtime.getCurrentUser().role) === ADMIN_ROLE;
    }

    function addFilters(form, params, pendingCount, totalPendingCount, throughputCount, summaryCounts, view) {
        form.addFieldGroup({ id: 'custpage_filter_group', label: 'Filters' });

        const viewField = form.addField({
            id: 'custpage_view',
            type: serverWidget.FieldType.SELECT,
            label: 'View',
            container: 'custpage_filter_group'
        });
        viewField.addSelectOption({ value: 'all', text: 'All Sections' });
        viewField.addSelectOption({ value: 'pending', text: 'Pending Only' });
        viewField.addSelectOption({ value: 'throughput', text: 'Throughput Only' });
        viewField.defaultValue = view || 'all';

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

        const showCharts = form.addField({
            id: 'custpage_show_charts',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Show Charts',
            container: 'custpage_filter_group'
        });
        showCharts.defaultValue = params.custpage_show_charts === 'F' ? 'F' : 'T';

        const exportUrl = buildSuiteletUrl(params, { action: 'export_pending' });
        const exportAllUrl = buildSuiteletUrl(params, { action: 'export_pending_all' });
        const exportThroughputUrl = buildSuiteletUrl(params, { action: 'export_throughput' });
        const exportSummaryUrl = buildSuiteletUrl(params, { action: 'export_summary' });
        const resetUrl = buildSuiteletUrl({}, {});
        const emptyNote = pendingCount === 0
            ? '<div style="margin-top:6px; color:#6c757d; font-size:12px;">No pending tasks match the current filter.</div>'
            : '';
        const warnBanner = pendingCount === 0
            ? '<div style="margin-top:6px; padding:6px 8px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:4px; font-size:12px;">0 pending tasks for the current filter. Export will be empty.</div>'
            : '';
        const warnBannerAll = totalPendingCount === 0
            ? '<div style="margin-top:6px; padding:6px 8px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:4px; font-size:12px;">0 pending tasks in the account. Export will be empty.</div>'
            : '';
        const exportField = form.addField({
            id: 'custpage_export_pending',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custpage_filter_group'
        }).defaultValue =
            '<div style="margin-top: 8px; text-align: right;">' +
            '<a href="' + exportUrl + '" style="display:inline-block; padding:6px 10px; background:#0d6efd; color:#fff; border-radius:4px; text-decoration:none; margin-right:8px;">Export Pending CSV (' + pendingCount + ')</a>' +
            '<a href="' + exportAllUrl + '" style="display:inline-block; padding:6px 10px; background:#6c757d; color:#fff; border-radius:4px; text-decoration:none; margin-right:8px;">Export All Pending (' + totalPendingCount + ')</a>' +
            '<a href="' + exportThroughputUrl + '" style="display:inline-block; padding:6px 10px; background:#198754; color:#fff; border-radius:4px; text-decoration:none; margin-right:8px;">Export Throughput CSV (' + throughputCount + ')</a>' +
            '<a href="' + exportSummaryUrl + '" style="display:inline-block; padding:6px 10px; background:#6f42c1; color:#fff; border-radius:4px; text-decoration:none; margin-right:8px;">Export Summary (Excel) (' + summaryCounts.sheets + ' tabs)</a>' +
            '<a href="' + resetUrl + '" style="display:inline-block; padding:6px 10px; background:#f8f9fa; color:#495057; border:1px solid #dee2e6; border-radius:4px; text-decoration:none;">Reset Filters</a>' +
            emptyNote +
            warnBanner +
            warnBannerAll +
            '</div>';

        try {
            viewField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });
            typeField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.MIDROW });
            dateFrom.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.MIDROW });
            dateTo.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.ENDROW });
            showCharts.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });
            exportField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.ENDROW });
            exportField.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });
        } catch (e) {
            // ignore layout errors
        }
    }

    function addOverview(form, pending, slaBreachCount, avgCycleHrs, medianCycleHrs, p95CycleHrs, params) {
        const bucket = bucketizeAges(pending);
        const total = pending.length;
        const pendingUrl = buildSuiteletUrl(withView(params, 'pending'), {});
        const throughputUrl = buildSuiteletUrl(withView(params, 'throughput'), {});
        const generatedAt = format.format({ value: new Date(), type: format.Type.DATETIME });
        const scopeText = buildScopeText(params, generatedAt);
        const html =
            '<div style="margin: 10px 0;">' +
            '<div style="padding: 12px; background: #E3F2FD; border-radius: 6px; margin-bottom: 10px;">' +
            '<strong>Analytics:</strong> Monitor pending approvals, aging, and recent throughput.' +
            '<div style="margin-top:4px; font-size:11px; color:#6c757d;">' + escapeHtml(scopeText) + '</div>' +
            '</div>' +
            '<div style="padding: 16px; border: 1px solid #e9ecef; border-radius: 6px; background: #fff;">' +
            '<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c757d; margin-bottom: 10px;">Pending Summary</div>' +
            '<div style="display:flex; gap:8px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px;">' +
            summaryCard('Total Pending', total) +
            summaryCard('< 24h', bucket.lt24) +
            summaryCard('24–48h', bucket.h24_48) +
            summaryCard('48–72h', bucket.h48_72) +
            summaryCard('> 72h', bucket.gt72) +
            summaryCard('SLA Breached', slaBreachCount || 0, 'danger') +
            summaryCard('Avg Approval Time (hrs)', formatHours(avgCycleHrs)) +
            summaryCard('Median Approval Time (hrs)', formatHours(medianCycleHrs)) +
            summaryCard('P95 Approval Time (hrs)', formatHours(p95CycleHrs)) +
            '</div>' +
            '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
            '<a href="' + pendingUrl + '" style="display:inline-block; padding:6px 10px; background:#0d6efd; color:#fff; border-radius:4px; text-decoration:none;">View Pending Details</a>' +
            '<a href="' + throughputUrl + '" style="display:inline-block; padding:6px 10px; background:#198754; color:#fff; border-radius:4px; text-decoration:none;">View Throughput Details</a>' +
            '</div>' +
            '</div>' +
            '</div>';

        const overviewField = form.addField({
            id: 'custpage_overview',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;
        try {
            overviewField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDE });
            overviewField.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });
        } catch (e) {
            // ignore layout errors
        }
    }

    function addInlineBreakdown(form, params, view, showCharts, containerId) {
        const sections = [];
        if (view === 'all' || view === 'pending') {
            sections.push({
                title: 'Pending by Path',
                headers: ['Path', 'Count'],
                rows: getPendingByPathData(params)
            });
            sections.push({
                title: 'Pending by Step',
                headers: ['Step', 'Count'],
                rows: getPendingByStepData(params)
            });
            sections.push({
                title: 'Pending by Type',
                headers: ['Type', 'Count'],
                rows: getPendingByTypeData(params)
            });
            sections.push({
                title: 'Pending by Approver (Top 10)',
                headers: ['Approver', 'Pending'],
                rows: getPendingByApproverData(params)
            });
            sections.push({
                title: 'Pending by Age Bucket',
                headers: ['Age', 'Count'],
                rows: getPendingByAgeBucketData(params)
            });
            sections.push({
                title: 'Pending Actions (Summary)',
                headers: ['Metric', 'Value'],
                rows: getPendingActionSummaryData(params)
            });
            sections.push({
                title: 'SLA Breaches by Path',
                headers: ['Path', 'Breaches'],
                rows: getSlaBreachesByPathData(params)
            });
            sections.push({
                title: 'SLA Breaches by Approver',
                headers: ['Approver', 'Breaches'],
                rows: getSlaBreachesByApproverData(params)
            });
        }
        if (view === 'all' || view === 'throughput') {
            sections.push({
                title: 'Throughput Summary',
                headers: ['Action', 'Count'],
                rows: getThroughputSummaryData(params)
            });
            if (showCharts) {
                sections.push({
                    title: 'Throughput Trend (Last 8 Weeks)',
                    type: 'chart',
                    rows: getThroughputByWeekData(params)
                });
                sections.push({
                    title: 'Throughput Trend (Approved vs Rejected)',
                    type: 'stacked',
                    rows: getThroughputByWeekData(params)
                });
            }
            sections.push({
                title: 'Slowest Approvals (Top 10)',
                headers: ['Transaction', 'Hours', 'Completed'],
                rows: getSlowestApprovalsData(params)
            });
            sections.push({
                title: 'Approval Rate (Last 8 Weeks)',
                headers: ['Week', 'Approval %', 'Total'],
                rows: getApprovalRateByWeekData(params)
            });
            sections.push({
                title: 'Throughput by Week (Last 8)',
                headers: ['Week', 'Approved', 'Rejected', 'Total'],
                rows: getThroughputByWeekData(params)
            });
            sections.push({
                title: 'Avg Approval Time by Path',
                headers: ['Path', 'Avg Hours', 'Count'],
                rows: getAvgCycleByPathData(params)
            });
            sections.push({
                title: 'Throughput by Type',
                headers: ['Type', 'Approved', 'Rejected', 'Total'],
                rows: getThroughputByTypeData(params)
            });
            sections.push({
                title: 'Throughput by Approver (Top 10)',
                headers: ['Approver', 'Approved', 'Rejected', 'Total'],
                rows: getThroughputByApproverData(params)
            });
            sections.push({
                title: 'Throughput by Method',
                headers: ['Method', 'Count'],
                rows: getThroughputByMethodData(params)
            });
            sections.push({
                title: 'Avg Approval Time by Approver',
                headers: ['Approver', 'Avg Hours', 'Count'],
                rows: getAvgCycleByApproverData(params)
            });
        }

        if (!sections.length) return;

        let html = '<div style="margin: 12px 0; display:flex; flex-wrap:wrap; gap:12px;">';
        sections.forEach(function(sec) {
            if (sec.type === 'chart') {
                html += buildBarChart(sec.title, sec.rows);
            } else if (sec.type === 'stacked') {
                html += buildStackedBarChart(sec.title, sec.rows);
            } else {
                html += buildMiniTable(sec.title, sec.headers, sec.rows);
            }
        });
        html += '</div>';

        const field = form.addField({
            id: 'custpage_inline_breakdown',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: containerId
        });
        field.defaultValue = html;
        try {
            field.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDE });
            field.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });
        } catch (e) {
            // ignore layout errors
        }
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

    function addPendingByPath(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_pending_by_path',
            type: serverWidget.SublistType.LIST,
            label: 'Pending by Path'
        });

        sublist.addField({ id: 'path', type: serverWidget.FieldType.TEXT, label: 'Approval Path' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Pending Count' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.PATH, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            const path = result.getText({ name: TF.PATH, summary: search.Summary.GROUP }) || '';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            safeSet(sublist, 'path', line, path || '—');
            safeSet(sublist, 'count', line, count);
            line++;
            return true;
        });
    }

    function getPendingByPathData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.PATH, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const path = result.getText({ name: TF.PATH, summary: search.Summary.GROUP }) || '—';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([path, count]);
            return true;
        });
        return rows;
    }

    function getPendingByApproverData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.APPROVER, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const approver = result.getText({ name: TF.APPROVER, summary: search.Summary.GROUP }) || '—';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([approver, count]);
            return true;
        });
        rows.sort(function(a, b) { return parseInt(b[1], 10) - parseInt(a[1], 10); });
        return rows.slice(0, 10);
    }

    function getPendingByStepData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.PATH_STEP, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const step = result.getText({ name: TF.PATH_STEP, summary: search.Summary.GROUP }) || '—';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([step, count]);
            return true;
        });
        return rows;
    }

    function addPendingByType(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_pending_by_type',
            type: serverWidget.SublistType.LIST,
            label: 'Pending by Transaction Type'
        });

        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Pending Count' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.TRAN_TYPE, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            const type = result.getText({ name: TF.TRAN_TYPE, summary: search.Summary.GROUP }) || '';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            safeSet(sublist, 'type', line, type || '—');
            safeSet(sublist, 'count', line, count);
            line++;
            return true;
        });
    }

    function getPendingByTypeData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: TF.TRAN_TYPE, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const type = result.getText({ name: TF.TRAN_TYPE, summary: search.Summary.GROUP }) || '—';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([type, count]);
            return true;
        });
        return rows;
    }

    function addPendingByAgeBucket(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_pending_by_age',
            type: serverWidget.SublistType.LIST,
            label: 'Pending by Age Bucket'
        });

        sublist.addField({ id: 'bucket', type: serverWidget.FieldType.TEXT, label: 'Age Bucket' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Count' });

        const buckets = { '< 24h': 0, '24–48h': 0, '48–72h': 0, '> 72h': 0 };
        const tasks = getPendingTasks(params);
        tasks.forEach(function(t) {
            const hrs = calculateAgeHours(t.created);
            if (hrs < 24) buckets['< 24h']++;
            else if (hrs < 48) buckets['24–48h']++;
            else if (hrs < 72) buckets['48–72h']++;
            else buckets['> 72h']++;
        });

        const order = ['< 24h', '24–48h', '48–72h', '> 72h'];
        order.forEach(function(label, idx) {
            safeSet(sublist, 'bucket', idx, label);
            safeSet(sublist, 'count', idx, buckets[label]);
        });
    }

    function getPendingByAgeBucketData(params) {
        const buckets = { '< 24h': 0, '24–48h': 0, '48–72h': 0, '> 72h': 0 };
        const tasks = getPendingTasks(params);
        tasks.forEach(function(t) {
            const hrs = calculateAgeHours(t.created);
            if (hrs < 24) buckets['< 24h']++;
            else if (hrs < 48) buckets['24–48h']++;
            else if (hrs < 72) buckets['48–72h']++;
            else buckets['> 72h']++;
        });
        const order = ['< 24h', '24–48h', '48–72h', '> 72h'];
        return order.map(function(label) {
            return [label, buckets[label]];
        });
    }

    function addPendingActionSummary(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_pending_action_summary',
            type: serverWidget.SublistType.LIST,
            label: 'Pending Actions (Summary)'
        });
        sublist.addField({ id: 'metric', type: serverWidget.FieldType.TEXT, label: 'Metric' });
        sublist.addField({ id: 'value', type: serverWidget.FieldType.INTEGER, label: 'Value' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT }),
                search.createColumn({ name: TF.APPROVER, summary: search.Summary.GROUP })
            ]
        });

        let totalTasks = 0;
        let uniqueApprovers = 0;
        searchObj.run().each(function(result) {
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT });
            const approver = result.getValue({ name: TF.APPROVER, summary: search.Summary.GROUP });
            totalTasks += parseInt(count, 10) || 0;
            if (approver) uniqueApprovers++;
            return true;
        });

        const metrics = [
            { label: 'Total Pending Tasks', value: totalTasks },
            { label: 'Unique Approvers', value: uniqueApprovers }
        ];
        metrics.forEach(function(m, idx) {
            safeSet(sublist, 'metric', idx, m.label);
            safeSet(sublist, 'value', idx, m.value);
        });
    }

    function getPendingActionSummaryData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT }),
                search.createColumn({ name: TF.APPROVER, summary: search.Summary.GROUP })
            ]
        });
        let totalTasks = 0;
        let uniqueApprovers = 0;
        searchObj.run().each(function(result) {
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT });
            const approver = result.getValue({ name: TF.APPROVER, summary: search.Summary.GROUP });
            totalTasks += parseInt(count, 10) || 0;
            if (approver) uniqueApprovers++;
            return true;
        });
        return [
            ['Total Pending Tasks', totalTasks],
            ['Unique Approvers', uniqueApprovers]
        ];
    }

    function addOldestPending(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_oldest_pending',
            type: serverWidget.SublistType.LIST,
            label: 'Oldest Pending Tasks'
        });
        sublist.addField({ id: 'tran', type: serverWidget.FieldType.TEXT, label: 'Transaction' });
        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'step', type: serverWidget.FieldType.TEXT, label: 'Step' });
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
                TF.PATH_STEP,
                search.createColumn({ name: TF.CREATED, sort: search.Sort.ASC })
            ]
        });

        const stepCache = {};
        let line = 0;
        searchObj.run().each(function(result) {
            if (line >= 15) return false;
            const tranType = result.getValue(TF.TRAN_TYPE);
            const tranId = result.getValue(TF.TRAN_ID);
            const approver = result.getText(TF.APPROVER) || '';
            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);
            const stepId = result.getValue(TF.PATH_STEP);
            const stepInfo = getStepInfo(stepId, stepCache);

            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const link = recordType && tranId
                ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                : '';
            const tranLink = link ? '<a href="' + link + '">View</a>' : '';

            safeSet(sublist, 'tran', line, tranLink);
            safeSet(sublist, 'type', line, result.getText(TF.TRAN_TYPE) || tranType || '');
            safeSet(sublist, 'step', line, stepInfo && stepInfo.name ? stepInfo.name : '—');
            safeSet(sublist, 'approver', line, approver);
            safeSet(sublist, 'age', line, ageHrs.toFixed(1));
            safeSet(sublist, 'created', line, formatDateTime(created));
            line++;
            return true;
        });
    }

    function addSlaBreaches(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_sla_breaches',
            type: serverWidget.SublistType.LIST,
            label: 'SLA Breaches (Pending)'
        });
        sublist.addField({ id: 'tran', type: serverWidget.FieldType.TEXT, label: 'Transaction' });
        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'age', type: serverWidget.FieldType.TEXT, label: 'Age (hrs)' });
        sublist.addField({ id: 'sla', type: serverWidget.FieldType.TEXT, label: 'SLA (hrs)' });
        sublist.addField({ id: 'over', type: serverWidget.FieldType.TEXT, label: 'Over By (hrs)' });
        sublist.addField({ id: 'created', type: serverWidget.FieldType.TEXT, label: 'Created' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                TF.TRAN_TYPE,
                TF.TRAN_ID,
                TF.CREATED,
                TF.APPROVER,
                TF.SEQUENCE,
                TF.PATH_STEP,
                search.createColumn({ name: TF.CREATED, sort: search.Sort.ASC })
            ]
        });

        const slaCache = {};
        let line = 0;
        searchObj.run().each(function(result) {
            if (line >= 20) return false;

            const stepId = result.getValue(TF.PATH_STEP);
            const slaHrs = getStepSlaHours(stepId, slaCache);
            if (!slaHrs) return true;

            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);
            if (ageHrs <= slaHrs) return true;

            const tranType = result.getValue(TF.TRAN_TYPE);
            const tranId = result.getValue(TF.TRAN_ID);
            const approver = result.getText(TF.APPROVER) || '';
            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const link = recordType && tranId
                ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                : '';
            const tranLink = link ? '<a href="' + link + '">View</a>' : '';

            safeSet(sublist, 'tran', line, tranLink);
            safeSet(sublist, 'type', line, result.getText(TF.TRAN_TYPE) || tranType || '');
            safeSet(sublist, 'approver', line, approver);
            safeSet(sublist, 'age', line, ageHrs.toFixed(1));
            safeSet(sublist, 'sla', line, parseFloat(slaHrs).toFixed(1));
            safeSet(sublist, 'over', line, (ageHrs - slaHrs).toFixed(1));
            safeSet(sublist, 'created', line, formatDateTime(created));
            line++;
            return true;
        });
    }

    function addSlaBreachesByPath(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_sla_breaches_by_path',
            type: serverWidget.SublistType.LIST,
            label: 'SLA Breaches by Path'
        });
        sublist.addField({ id: 'path', type: serverWidget.FieldType.TEXT, label: 'Approval Path' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Breach Count' });

        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [
                TF.PATH,
                TF.PATH_STEP,
                TF.CREATED
            ]
        });

        const slaCache = {};
        const byPath = {};
        searchObj.run().each(function(result) {
            const stepId = result.getValue(TF.PATH_STEP);
            const slaHrs = getStepSlaHours(stepId, slaCache);
            if (!slaHrs) return true;
            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);
            if (ageHrs <= slaHrs) return true;

            const pathId = result.getValue(TF.PATH) || 'unknown';
            const pathName = result.getText(TF.PATH) || 'Unknown';
            if (!byPath[pathId]) byPath[pathId] = { name: pathName, count: 0 };
            byPath[pathId].count++;
            return true;
        });

        const rows = Object.keys(byPath).map(function(key) {
            return byPath[key];
        }).sort(function(a, b) { return b.count - a.count; });

        let line = 0;
        rows.forEach(function(r) {
            if (line >= 20) return;
            safeSet(sublist, 'path', line, r.name);
            safeSet(sublist, 'count', line, r.count);
            line++;
        });
    }

    function getSlaBreachesByPathData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [TF.PATH, TF.PATH_STEP, TF.CREATED]
        });
        const slaCache = {};
        const byPath = {};
        searchObj.run().each(function(result) {
            const stepId = result.getValue(TF.PATH_STEP);
            const slaHrs = getStepSlaHours(stepId, slaCache);
            if (!slaHrs) return true;
            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);
            if (ageHrs <= slaHrs) return true;

            const pathId = result.getValue(TF.PATH) || 'unknown';
            const pathName = result.getText(TF.PATH) || 'Unknown';
            if (!byPath[pathId]) byPath[pathId] = { name: pathName, count: 0 };
            byPath[pathId].count++;
            return true;
        });
        return Object.keys(byPath).map(function(key) {
            return [byPath[key].name, byPath[key].count];
        }).sort(function(a, b) { return b[1] - a[1]; });
    }

    function getSlaBreachesByApproverData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_TASK,
            filters: buildPendingFilters(params),
            columns: [TF.APPROVER, TF.PATH_STEP, TF.CREATED]
        });
        const slaCache = {};
        const byApprover = {};
        searchObj.run().each(function(result) {
            const stepId = result.getValue(TF.PATH_STEP);
            const slaHrs = getStepSlaHours(stepId, slaCache);
            if (!slaHrs) return true;
            const created = result.getValue(TF.CREATED);
            const ageHrs = calculateAgeHours(created);
            if (ageHrs <= slaHrs) return true;

            const approverId = result.getValue(TF.APPROVER) || 'unknown';
            const approverName = result.getText(TF.APPROVER) || 'Unknown';
            if (!byApprover[approverId]) byApprover[approverId] = { name: approverName, count: 0 };
            byApprover[approverId].count++;
            return true;
        });

        return Object.keys(byApprover).map(function(key) {
            return [byApprover[key].name, byApprover[key].count];
        }).sort(function(a, b) { return b[1] - a[1]; });
    }

    function addThroughput(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_throughput',
            type: serverWidget.SublistType.LIST,
            label: 'Throughput'
        });
        sublist.addField({ id: 'action', type: serverWidget.FieldType.TEXT, label: 'Action' });
        sublist.addField({ id: 'count', type: serverWidget.FieldType.INTEGER, label: 'Count' });

        const filters = buildThroughputFilters(params);

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

    function getThroughputSummaryData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [
                search.createColumn({ name: HF.ACTION, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const action = result.getText({ name: HF.ACTION, summary: search.Summary.GROUP }) || '';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([action, count]);
            return true;
        });
        return rows;
    }

    function addThroughputByType(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_throughput_by_type',
            type: serverWidget.SublistType.LIST,
            label: 'Throughput by Transaction Type'
        });

        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'approved', type: serverWidget.FieldType.INTEGER, label: 'Approved' });
        sublist.addField({ id: 'rejected', type: serverWidget.FieldType.INTEGER, label: 'Rejected' });
        sublist.addField({ id: 'total', type: serverWidget.FieldType.INTEGER, label: 'Total' });

        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [
                HF.TRAN_TYPE,
                HF.ACTION
            ]
        });

        const byType = {};
        searchObj.run().each(function(result) {
            const action = result.getValue(HF.ACTION);
            const typeId = result.getValue(HF.TRAN_TYPE) || 'unknown';
            const typeName = result.getText(HF.TRAN_TYPE) || 'Unknown';

            if (!byType[typeId]) {
                byType[typeId] = { name: typeName, approved: 0, rejected: 0, total: 0 };
            }
            if (String(action) === String(ACTION.APPROVE)) byType[typeId].approved++;
            if (String(action) === String(ACTION.REJECT)) byType[typeId].rejected++;
            byType[typeId].total++;
            return true;
        });

        const rows = Object.keys(byType).map(function(key) {
            return byType[key];
        }).sort(function(a, b) { return b.total - a.total; });

        let line = 0;
        rows.forEach(function(r) {
            if (line >= 10) return;
            safeSet(sublist, 'type', line, r.name);
            safeSet(sublist, 'approved', line, r.approved);
            safeSet(sublist, 'rejected', line, r.rejected);
            safeSet(sublist, 'total', line, r.total);
            line++;
        });
    }

    function getThroughputByTypeData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [HF.TRAN_TYPE, HF.ACTION]
        });
        const byType = {};
        searchObj.run().each(function(result) {
            const action = result.getValue(HF.ACTION);
            const typeId = result.getValue(HF.TRAN_TYPE) || 'unknown';
            const typeName = result.getText(HF.TRAN_TYPE) || 'Unknown';
            if (!byType[typeId]) {
                byType[typeId] = { name: typeName, approved: 0, rejected: 0, total: 0 };
            }
            if (String(action) === String(ACTION.APPROVE)) byType[typeId].approved++;
            if (String(action) === String(ACTION.REJECT)) byType[typeId].rejected++;
            byType[typeId].total++;
            return true;
        });
        return Object.keys(byType).map(function(key) {
            const r = byType[key];
            return [r.name, r.approved, r.rejected, r.total];
        }).sort(function(a, b) { return b[3] - a[3]; });
    }

    function addThroughputByApprover(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_throughput_by_approver',
            type: serverWidget.SublistType.LIST,
            label: 'Throughput by Approver'
        });

        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'approved', type: serverWidget.FieldType.INTEGER, label: 'Approved' });
        sublist.addField({ id: 'rejected', type: serverWidget.FieldType.INTEGER, label: 'Rejected' });
        sublist.addField({ id: 'total', type: serverWidget.FieldType.INTEGER, label: 'Total' });

        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [
                HF.APPROVER,
                HF.ACTING_APPROVER,
                HF.ACTION
            ]
        });

        const byApprover = {};
        searchObj.run().each(function(result) {
            const action = result.getValue(HF.ACTION);
            const actingId = result.getValue(HF.ACTING_APPROVER);
            const approverId = result.getValue(HF.APPROVER);
            const key = actingId || approverId || 'unknown';
            const name = result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER) || 'Unknown';

            if (!byApprover[key]) {
                byApprover[key] = { name: name, approved: 0, rejected: 0, total: 0 };
            }
            if (String(action) === String(ACTION.APPROVE)) byApprover[key].approved++;
            if (String(action) === String(ACTION.REJECT)) byApprover[key].rejected++;
            byApprover[key].total++;
            return true;
        });

        const rows = Object.keys(byApprover).map(function(key) {
            return byApprover[key];
        }).sort(function(a, b) { return b.total - a.total; });

        let line = 0;
        rows.forEach(function(r) {
            if (line >= 20) return;
            safeSet(sublist, 'approver', line, r.name);
            safeSet(sublist, 'approved', line, r.approved);
            safeSet(sublist, 'rejected', line, r.rejected);
            safeSet(sublist, 'total', line, r.total);
            line++;
        });
    }

    function getThroughputByApproverData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [HF.APPROVER, HF.ACTING_APPROVER, HF.ACTION]
        });
        const byApprover = {};
        searchObj.run().each(function(result) {
            const action = result.getValue(HF.ACTION);
            const actingId = result.getValue(HF.ACTING_APPROVER);
            const approverId = result.getValue(HF.APPROVER);
            const key = actingId || approverId || 'unknown';
            const name = result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER) || 'Unknown';
            if (!byApprover[key]) {
                byApprover[key] = { name: name, approved: 0, rejected: 0, total: 0 };
            }
            if (String(action) === String(ACTION.APPROVE)) byApprover[key].approved++;
            if (String(action) === String(ACTION.REJECT)) byApprover[key].rejected++;
            byApprover[key].total++;
            return true;
        });
        return Object.keys(byApprover).map(function(key) {
            const r = byApprover[key];
            return [r.name, r.approved, r.rejected, r.total];
        }).sort(function(a, b) { return b[3] - a[3]; });
    }

    function getThroughputByMethodData(params) {
        const rows = [];
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [
                search.createColumn({ name: HF.METHOD, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        });
        searchObj.run().each(function(result) {
            const method = result.getText({ name: HF.METHOD, summary: search.Summary.GROUP }) || 'Unknown';
            const count = result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0';
            rows.push([method, count]);
            return true;
        });
        return rows;
    }

    function getAvgCycleByPathData(params) {
        const filters = buildCycleFilters(params);
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: filters,
            columns: [HF.TRAN_TYPE, HF.TRAN_ID, HF.ACTION, HF.TIMESTAMP]
        });

        const map = {};
        searchObj.run().each(function(result) {
            const tranType = result.getValue(HF.TRAN_TYPE);
            const tranId = result.getValue(HF.TRAN_ID);
            const key = tranType + '|' + tranId;
            const action = result.getValue(HF.ACTION);
            const ts = parseDate(result.getValue(HF.TIMESTAMP));
            if (!ts) return true;
            if (!map[key]) map[key] = { tranType: tranType, tranId: tranId, submit: null, complete: null };

            if (String(action) === String(ACTION.SUBMIT)) {
                if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
            }
            if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                if (!map[key].complete || ts > map[key].complete) map[key].complete = ts;
            }
            return true;
        });

        const byPath = {};
        Object.keys(map).forEach(function(key) {
            const item = map[key];
            if (!item.submit || !item.complete || item.complete < item.submit) return;
            const recordType = constants.TRANSACTION_TYPE_REVERSE[item.tranType];
            if (!recordType) return;

            let pathId = null;
            let pathName = null;
            try {
                const lookup = search.lookupFields({
                    type: recordType,
                    id: item.tranId,
                    columns: [BF.APPROVAL_PATH]
                });
                if (lookup && lookup[BF.APPROVAL_PATH] && lookup[BF.APPROVAL_PATH].length) {
                    pathId = lookup[BF.APPROVAL_PATH][0].value;
                    pathName = lookup[BF.APPROVAL_PATH][0].text;
                }
            } catch (e) {
                // ignore lookup errors
            }
            if (!pathId) return;

            const diffHrs = (item.complete.getTime() - item.submit.getTime()) / (1000 * 60 * 60);
            if (!byPath[pathId]) byPath[pathId] = { name: pathName || 'Path ' + pathId, total: 0, count: 0 };
            byPath[pathId].total += diffHrs;
            byPath[pathId].count += 1;
        });

        return Object.keys(byPath).map(function(key) {
            const r = byPath[key];
            const avg = r.count ? (r.total / r.count) : 0;
            return [r.name, formatHours(avg), r.count];
        }).sort(function(a, b) { return parseFloat(b[1]) - parseFloat(a[1]); });
    }

    function getAvgCycleByApproverData(params) {
        const filters = buildCycleFilters(params);
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: filters,
            columns: [HF.TRAN_TYPE, HF.TRAN_ID, HF.ACTION, HF.TIMESTAMP, HF.APPROVER, HF.ACTING_APPROVER]
        });

        const map = {};
        searchObj.run().each(function(result) {
            const tranType = result.getValue(HF.TRAN_TYPE);
            const tranId = result.getValue(HF.TRAN_ID);
            const key = tranType + '|' + tranId;
            const action = result.getValue(HF.ACTION);
            const ts = parseDate(result.getValue(HF.TIMESTAMP));
            if (!ts) return true;
            if (!map[key]) map[key] = { submit: null, complete: null, approverName: null };

            if (String(action) === String(ACTION.SUBMIT)) {
                if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
            }
            if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                if (!map[key].complete || ts > map[key].complete) {
                    map[key].complete = ts;
                    map[key].approverName = result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER) || 'Unknown';
                }
            }
            return true;
        });

        const byApprover = {};
        Object.keys(map).forEach(function(key) {
            const item = map[key];
            if (!item.submit || !item.complete || item.complete < item.submit) return;
            const diffHrs = (item.complete.getTime() - item.submit.getTime()) / (1000 * 60 * 60);
            const name = item.approverName || 'Unknown';
            if (!byApprover[name]) byApprover[name] = { total: 0, count: 0 };
            byApprover[name].total += diffHrs;
            byApprover[name].count += 1;
        });

        return Object.keys(byApprover).map(function(name) {
            const r = byApprover[name];
            const avg = r.count ? (r.total / r.count) : 0;
            return [name, formatHours(avg), r.count];
        }).sort(function(a, b) { return parseFloat(b[1]) - parseFloat(a[1]); });
    }

    function getThroughputByWeekData(params) {
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [HF.ACTION, HF.TIMESTAMP]
        });

        const byWeek = {};
        searchObj.run().each(function(result) {
            const action = result.getValue(HF.ACTION);
            const ts = parseDate(result.getValue(HF.TIMESTAMP));
            if (!ts) return true;
            const weekKey = getWeekKey(ts);
            if (!byWeek[weekKey]) byWeek[weekKey] = { approved: 0, rejected: 0, total: 0 };
            if (String(action) === String(ACTION.APPROVE)) byWeek[weekKey].approved++;
            if (String(action) === String(ACTION.REJECT)) byWeek[weekKey].rejected++;
            byWeek[weekKey].total++;
            return true;
        });

        const keys = Object.keys(byWeek).sort();
        const lastKeys = keys.slice(-8);
        return lastKeys.map(function(k) {
            const r = byWeek[k];
            return [k, r.approved, r.rejected, r.total];
        });
    }

    function getApprovalRateByWeekData(params) {
        const rows = getThroughputByWeekData(params);
        return rows.map(function(r) {
            const approved = parseFloat(r[1]) || 0;
            const total = parseFloat(r[3]) || 0;
            const pct = total ? Math.round((approved / total) * 1000) / 10 : 0;
            return [r[0], pct + '%', total];
        });
    }

    function getSlowestApprovalsData(params) {
        const filters = buildCycleFilters(params);
        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: filters,
            columns: [HF.TRAN_TYPE, HF.TRAN_ID, HF.ACTION, HF.TIMESTAMP]
        });

        const map = {};
        searchObj.run().each(function(result) {
            const tranType = result.getValue(HF.TRAN_TYPE);
            const tranId = result.getValue(HF.TRAN_ID);
            const key = tranType + '|' + tranId;
            const action = result.getValue(HF.ACTION);
            const ts = parseDate(result.getValue(HF.TIMESTAMP));
            if (!ts) return true;
            if (!map[key]) map[key] = { tranType: tranType, tranId: tranId, submit: null, complete: null };

            if (String(action) === String(ACTION.SUBMIT)) {
                if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
            }
            if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                if (!map[key].complete || ts > map[key].complete) map[key].complete = ts;
            }
            return true;
        });

        const items = [];
        const labelCache = {};
        Object.keys(map).forEach(function(key) {
            const item = map[key];
            if (!item.submit || !item.complete || item.complete < item.submit) return;
            const diffHrs = (item.complete.getTime() - item.submit.getTime()) / (1000 * 60 * 60);
            const recordType = constants.TRANSACTION_TYPE_REVERSE[item.tranType];
            const label = buildTranLabel(recordType, item.tranId, labelCache);
            items.push({
                label: label,
                hours: diffHrs,
                completed: formatDateTime(item.complete)
            });
        });

        items.sort(function(a, b) { return b.hours - a.hours; });
        return items.slice(0, 10).map(function(i) {
            return [i.label, formatHours(i.hours), i.completed];
        });
    }

    function buildTranLabel(recordType, recordId, cache) {
        if (!recordType || !recordId) return 'Transaction ' + (recordId || '');
        const key = recordType + '|' + recordId;
        if (cache && cache[key]) return cache[key];
        let label = recordTypeLabel(recordType) + ' #' + recordId;
        try {
            const lookup = search.lookupFields({
                type: recordType,
                id: recordId,
                columns: ['tranid']
            });
            if (lookup && lookup.tranid) {
                label = recordTypeLabel(recordType) + ' ' + lookup.tranid;
            }
        } catch (e) {
            // ignore lookup errors
        }
        if (cache) cache[key] = label;
        return label;
    }

    function recordTypeLabel(recordType) {
        switch (recordType) {
            case 'purchaseorder': return 'PO';
            case 'vendorbill': return 'Vendor Bill';
            case 'salesorder': return 'Sales Order';
            case 'invoice': return 'Invoice';
            default: return recordType || 'Transaction';
        }
    }

    function getWeekKey(dateObj) {
        const d = new Date(dateObj.getTime());
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const diff = (day === 0 ? -6 : 1) - day; // Monday start
        d.setDate(d.getDate() + diff);
        return format.format({ value: d, type: format.Type.DATE });
    }

    function addThroughputDetail(form, params) {
        const sublist = form.addSublist({
            id: 'custpage_throughput_detail',
            type: serverWidget.SublistType.LIST,
            label: 'Throughput Detail'
        });
        sublist.addField({ id: 'tran', type: serverWidget.FieldType.TEXT, label: 'Transaction' });
        sublist.addField({ id: 'type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        sublist.addField({ id: 'action', type: serverWidget.FieldType.TEXT, label: 'Action' });
        sublist.addField({ id: 'approver', type: serverWidget.FieldType.TEXT, label: 'Approver' });
        sublist.addField({ id: 'timestamp', type: serverWidget.FieldType.TEXT, label: 'Timestamp' });
        sublist.addField({ id: 'method', type: serverWidget.FieldType.TEXT, label: 'Method' });

        const searchObj = search.create({
            type: RT.APPROVAL_HISTORY,
            filters: buildThroughputFilters(params),
            columns: [
                HF.TRAN_TYPE,
                HF.TRAN_ID,
                HF.ACTION,
                HF.APPROVER,
                HF.ACTING_APPROVER,
                HF.TIMESTAMP,
                HF.METHOD,
                search.createColumn({ name: HF.TIMESTAMP, sort: search.Sort.DESC })
            ]
        });

        let line = 0;
        searchObj.run().each(function(result) {
            if (line >= 50) return false;
            const tranType = result.getValue(HF.TRAN_TYPE);
            const tranId = result.getValue(HF.TRAN_ID);
            const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
            const link = recordType && tranId
                ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                : '';
            const tranLink = link ? '<a href="' + link + '">View</a>' : '';

            safeSet(sublist, 'tran', line, tranLink);
            safeSet(sublist, 'type', line, result.getText(HF.TRAN_TYPE) || tranType || '');
            safeSet(sublist, 'action', line, result.getText(HF.ACTION) || result.getValue(HF.ACTION) || '');
            safeSet(sublist, 'approver', line, result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER) || '');
            safeSet(sublist, 'timestamp', line, formatDateTime(result.getValue(HF.TIMESTAMP)));
            safeSet(sublist, 'method', line, result.getText(HF.METHOD) || '');
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

    function summaryCard(label, value, tone) {
        const border = tone === 'danger' ? '#f5c2c7' : '#f1f3f5';
        const bg = tone === 'danger' ? '#f8d7da' : '#fafbfc';
        const valueColor = tone === 'danger' ? '#b02a37' : '#212529';
        return '<div style="flex:0 0 auto; min-width: 90px; padding: 8px 10px; border: 1px solid ' + border + '; border-radius: 6px; background: ' + bg + ';">' +
            '<div style="font-size: 10px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; white-space: normal; line-height: 1.2;">' + label + '</div>' +
            '<div style="font-size: 17px; font-weight: 600; color: ' + valueColor + ';">' + value + '</div>' +
            '</div>';
    }

    function buildMiniTable(title, headers, rows) {
        const headCells = headers.map(function(h) {
            return '<th style="text-align:left; padding:6px 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; color:#6c757d; border-bottom:1px solid #eef0f2;">' + escapeHtml(h) + '</th>';
        }).join('');

        let body = '';
        if (!rows || !rows.length) {
            body = '<tr><td colspan="' + headers.length + '" style="padding:8px; color:#6c757d; font-size:12px;">No data</td></tr>';
        } else {
            rows.slice(0, 10).forEach(function(r) {
                const cells = r.map(function(c) {
                    return '<td style="padding:6px 8px; font-size:12px; border-bottom:1px solid #f5f6f7;">' + escapeHtml(c) + '</td>';
                }).join('');
                body += '<tr>' + cells + '</tr>';
            });
        }

        return '<div style="flex: 1 1 320px; min-width: 280px; border:1px solid #e9ecef; border-radius:6px; background:#fff;">' +
            '<div style="padding:8px 10px; font-weight:700; font-size:12px; color:#495057; border-bottom:1px solid #eef0f2;">' + escapeHtml(title) + '</div>' +
            '<table style="width:100%; border-collapse:collapse;"><thead><tr>' + headCells + '</tr></thead><tbody>' + body + '</tbody></table>' +
            '</div>';
    }

    function buildBarChart(title, rows) {
        const max = (rows || []).reduce(function(acc, r) {
            const total = parseFloat(r[3]) || 0;
            return total > acc ? total : acc;
        }, 0);

        let body = '';
        if (!rows || !rows.length) {
            body = '<div style="padding:8px; color:#6c757d; font-size:12px;">No data</div>';
        } else {
            rows.slice(0, 8).forEach(function(r) {
                const label = r[0];
                const total = parseFloat(r[3]) || 0;
                const pct = max ? Math.round((total / max) * 100) : 0;
                body += '<div style="display:flex; align-items:center; gap:8px; padding:4px 8px;">' +
                    '<div style="width:90px; font-size:11px; color:#6c757d;">' + escapeHtml(label) + '</div>' +
                    '<div style="flex:1; background:#f1f3f5; border-radius:4px; height:8px; position:relative;">' +
                    '<div style="width:' + pct + '%; background:#0d6efd; height:8px; border-radius:4px;"></div>' +
                    '</div>' +
                    '<div style="width:30px; text-align:right; font-size:11px; color:#495057;">' + escapeHtml(total) + '</div>' +
                    '</div>';
            });
        }

        return '<div style="flex: 1 1 320px; min-width: 280px; border:1px solid #e9ecef; border-radius:6px; background:#fff;">' +
            '<div style="padding:8px 10px; font-weight:700; font-size:12px; color:#495057; border-bottom:1px solid #eef0f2;">' + escapeHtml(title) + '</div>' +
            '<div>' + body + '</div>' +
            '</div>';
    }

    function buildStackedBarChart(title, rows) {
        const maxTotal = (rows || []).reduce(function(acc, r) {
            const total = parseFloat(r[3]) || 0;
            return total > acc ? total : acc;
        }, 0);

        let body = '';
        if (!rows || !rows.length) {
            body = '<div style="padding:8px; color:#6c757d; font-size:12px;">No data</div>';
        } else {
            rows.slice(0, 8).forEach(function(r) {
                const label = r[0];
                const approved = parseFloat(r[1]) || 0;
                const rejected = parseFloat(r[2]) || 0;
                const total = parseFloat(r[3]) || 0;
                const outerPct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
                const approvedPct = total ? Math.round((approved / total) * 100) : 0;
                const rejectedPct = 100 - approvedPct;

                body += '<div style="display:flex; align-items:center; gap:8px; padding:4px 8px;">' +
                    '<div style="width:90px; font-size:11px; color:#6c757d;">' + escapeHtml(label) + '</div>' +
                    '<div style="flex:1; background:#f1f3f5; border-radius:4px; height:8px; position:relative;">' +
                    '<div style="width:' + outerPct + '%; height:8px; display:flex; border-radius:4px; overflow:hidden;">' +
                    '<div style="width:' + approvedPct + '%; background:#198754; height:8px;"></div>' +
                    '<div style="width:' + rejectedPct + '%; background:#dc3545; height:8px;"></div>' +
                    '</div>' +
                    '</div>' +
                    '<div style="width:30px; text-align:right; font-size:11px; color:#495057;">' + escapeHtml(total) + '</div>' +
                    '</div>';
            });
        }

        const legend =
            '<div style="padding:4px 8px 8px 8px; font-size:11px; color:#6c757d;">' +
            '<span style="display:inline-block; width:10px; height:10px; background:#198754; margin-right:4px; border-radius:2px;"></span>Approved ' +
            '<span style="display:inline-block; width:10px; height:10px; background:#dc3545; margin:0 4px 0 12px; border-radius:2px;"></span>Rejected' +
            '</div>';

        return '<div style="flex: 1 1 320px; min-width: 280px; border:1px solid #e9ecef; border-radius:6px; background:#fff;">' +
            '<div style="padding:8px 10px; font-weight:700; font-size:12px; color:#495057; border-bottom:1px solid #eef0f2;">' + escapeHtml(title) + '</div>' +
            '<div>' + body + '</div>' +
            legend +
            '</div>';
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

    function formatHours(value) {
        if (value === null || value === undefined || isNaN(value)) return '—';
        return (Math.round(value * 10) / 10).toFixed(1);
    }

    function buildScopeText(params, generatedAt) {
        const view = getView(params);
        const type = getTypeLabel(params && params.custpage_tran_type);
        const dateRange = getDateRangeLabel(params);
        const generated = generatedAt ? ' | Generated: ' + generatedAt : '';
        return 'View: ' + view + ' | Type: ' + type + ' | Throughput range: ' + dateRange + generated;
    }

    function getTypeLabel(value) {
        switch (String(value || '')) {
            case constants.TRANSACTION_TYPES.PURCHASE_ORDER:
                return 'Purchase Order';
            case constants.TRANSACTION_TYPES.VENDOR_BILL:
                return 'Vendor Bill';
            case constants.TRANSACTION_TYPES.SALES_ORDER:
                return 'Sales Order';
            case constants.TRANSACTION_TYPES.INVOICE:
                return 'Invoice';
            default:
                return 'All';
        }
    }

    function getDateRangeLabel(params) {
        const from = params && params.custpage_date_from ? String(params.custpage_date_from) : '';
        const to = params && params.custpage_date_to ? String(params.custpage_date_to) : '';
        if (from || to) {
            return (from || 'Any') + ' → ' + (to || 'Any');
        }
        return 'Last 30 days';
    }

    function safeSet(sublist, fieldId, line, value) {
        try {
            if (value === null || value === undefined) return;
            sublist.setSublistValue({ id: fieldId, line: line, value: String(value) });
        } catch (e) {
            // ignore optional set errors
        }
    }

    function getStepSlaHours(stepId, cache) {
        const info = getStepInfo(stepId, cache);
        return info ? info.slaHours : null;
    }

    function getStepInfo(stepId, cache) {
        if (!stepId) return null;
        if (cache && cache.hasOwnProperty(stepId)) return cache[stepId];
        let info = { name: null, slaHours: null };
        try {
            const stepRec = record.load({ type: RT.PATH_STEP, id: stepId });
            const rawName = stepRec.getValue(SF.NAME);
            const raw = stepRec.getValue(SF.SLA_HOURS);
            if (rawName) info.name = String(rawName);
            if (raw !== null && raw !== undefined && raw !== '') {
                const parsed = parseFloat(raw);
                info.slaHours = isNaN(parsed) ? null : parsed;
            }
        } catch (e) {
            info = null;
        }
        if (cache) cache[stepId] = info;
        return info;
    }

    function getSlaBreachCount(params) {
        try {
            const searchObj = search.create({
                type: RT.APPROVAL_TASK,
                filters: buildPendingFilters(params),
                columns: [TF.CREATED, TF.PATH_STEP]
            });
            const slaCache = {};
            let count = 0;
            searchObj.run().each(function(result) {
                const stepId = result.getValue(TF.PATH_STEP);
                const slaHrs = getStepSlaHours(stepId, slaCache);
                if (!slaHrs) return true;
                const created = result.getValue(TF.CREATED);
                const ageHrs = calculateAgeHours(created);
                if (ageHrs > slaHrs) count++;
                return true;
            });
            return count;
        } catch (e) {
            return 0;
        }
    }

    function buildPendingFilters(params, options) {
        const filters = [[TF.STATUS, 'anyof', STATUS.PENDING]];
        if (!options || !options.ignoreType) {
            if (params && params.custpage_tran_type) {
                filters.push('and', [TF.TRAN_TYPE, 'anyof', params.custpage_tran_type]);
            }
        }
        return filters;
    }

    function getThroughputCount(params) {
        try {
            const searchObj = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: buildThroughputFilters(params),
                columns: [
                    search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
                ]
            });
            const results = searchObj.run().getRange({ start: 0, end: 1 });
            if (results && results.length) {
                const count = results[0].getValue({ name: 'internalid', summary: search.Summary.COUNT });
                return parseInt(count, 10) || 0;
            }
        } catch (e) {
            // ignore count errors
        }
        return 0;
    }

    function getSummaryExportCounts(params, view) {
        const sheets = [];
        if (view === 'all' || view === 'pending') {
            sheets.push(getPendingByPathData(params));
            sheets.push(getPendingByApproverData(params));
            sheets.push(getPendingByStepData(params));
            sheets.push(getPendingByTypeData(params));
            sheets.push(getPendingByAgeBucketData(params));
            sheets.push(getPendingActionSummaryData(params));
            sheets.push(getSlaBreachesByPathData(params));
            sheets.push(getSlaBreachesByApproverData(params));
        }
        if (view === 'all' || view === 'throughput') {
            sheets.push(getThroughputSummaryData(params));
            sheets.push(getThroughputByWeekData(params));
            sheets.push(getApprovalRateByWeekData(params));
            sheets.push(getAvgCycleByPathData(params));
            sheets.push(getThroughputByTypeData(params));
            sheets.push(getThroughputByApproverData(params));
            sheets.push(getThroughputByMethodData(params));
            sheets.push(getAvgCycleByApproverData(params));
            sheets.push(getSlowestApprovalsData(params));
        }
        return { sheets: sheets.length };
    }

    function getPendingCount(params, options) {
        try {
            const searchObj = search.create({
                type: RT.APPROVAL_TASK,
                filters: buildPendingFilters(params, options),
                columns: [
                    search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
                ]
            });
            const results = searchObj.run().getRange({ start: 0, end: 1 });
            if (results && results.length) {
                const count = results[0].getValue({ name: 'internalid', summary: search.Summary.COUNT });
                return parseInt(count, 10) || 0;
            }
        } catch (e) {
            // ignore count errors
        }
        return 0;
    }

    function buildThroughputFilters(params) {
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
        return filters;
    }

    function getAverageCycleTime(params) {
        try {
            const filters = buildCycleFilters(params);
            const searchObj = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: filters,
                columns: [
                    HF.TRAN_TYPE,
                    HF.TRAN_ID,
                    HF.ACTION,
                    HF.TIMESTAMP
                ]
            });

            const map = {};
            searchObj.run().each(function(result) {
                const tranType = result.getValue(HF.TRAN_TYPE);
                const tranId = result.getValue(HF.TRAN_ID);
                const key = tranType + '|' + tranId;
                const action = result.getValue(HF.ACTION);
                const ts = parseDate(result.getValue(HF.TIMESTAMP));
                if (!ts) return true;
                if (!map[key]) map[key] = { submit: null, complete: null };

                if (String(action) === String(ACTION.SUBMIT)) {
                    if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
                }
                if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                    if (!map[key].complete || ts > map[key].complete) map[key].complete = ts;
                }
                return true;
            });

            let totalHrs = 0;
            let count = 0;
            Object.keys(map).forEach(function(key) {
                const item = map[key];
                if (item.submit && item.complete && item.complete >= item.submit) {
                    const diffMs = item.complete.getTime() - item.submit.getTime();
                    totalHrs += diffMs / (1000 * 60 * 60);
                    count++;
                }
            });
            if (!count) return null;
            return totalHrs / count;
        } catch (e) {
            return null;
        }
    }

    function getMedianCycleTime(params) {
        try {
            const filters = buildCycleFilters(params);
            const searchObj = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: filters,
                columns: [HF.TRAN_TYPE, HF.TRAN_ID, HF.ACTION, HF.TIMESTAMP]
            });

            const map = {};
            searchObj.run().each(function(result) {
                const tranType = result.getValue(HF.TRAN_TYPE);
                const tranId = result.getValue(HF.TRAN_ID);
                const key = tranType + '|' + tranId;
                const action = result.getValue(HF.ACTION);
                const ts = parseDate(result.getValue(HF.TIMESTAMP));
                if (!ts) return true;
                if (!map[key]) map[key] = { submit: null, complete: null };

                if (String(action) === String(ACTION.SUBMIT)) {
                    if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
                }
                if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                    if (!map[key].complete || ts > map[key].complete) map[key].complete = ts;
                }
                return true;
            });

            const durations = [];
            Object.keys(map).forEach(function(key) {
                const item = map[key];
                if (item.submit && item.complete && item.complete >= item.submit) {
                    const diffMs = item.complete.getTime() - item.submit.getTime();
                    durations.push(diffMs / (1000 * 60 * 60));
                }
            });
            if (!durations.length) return null;
            durations.sort(function(a, b) { return a - b; });
            const mid = Math.floor(durations.length / 2);
            if (durations.length % 2 === 0) {
                return (durations[mid - 1] + durations[mid]) / 2;
            }
            return durations[mid];
        } catch (e) {
            return null;
        }
    }

    function getPercentileCycleTime(params, percentile) {
        try {
            const filters = buildCycleFilters(params);
            const searchObj = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: filters,
                columns: [HF.TRAN_TYPE, HF.TRAN_ID, HF.ACTION, HF.TIMESTAMP]
            });

            const map = {};
            searchObj.run().each(function(result) {
                const tranType = result.getValue(HF.TRAN_TYPE);
                const tranId = result.getValue(HF.TRAN_ID);
                const key = tranType + '|' + tranId;
                const action = result.getValue(HF.ACTION);
                const ts = parseDate(result.getValue(HF.TIMESTAMP));
                if (!ts) return true;
                if (!map[key]) map[key] = { submit: null, complete: null };

                if (String(action) === String(ACTION.SUBMIT)) {
                    if (!map[key].submit || ts < map[key].submit) map[key].submit = ts;
                }
                if (String(action) === String(ACTION.APPROVE) || String(action) === String(ACTION.REJECT)) {
                    if (!map[key].complete || ts > map[key].complete) map[key].complete = ts;
                }
                return true;
            });

            const durations = [];
            Object.keys(map).forEach(function(key) {
                const item = map[key];
                if (item.submit && item.complete && item.complete >= item.submit) {
                    const diffMs = item.complete.getTime() - item.submit.getTime();
                    durations.push(diffMs / (1000 * 60 * 60));
                }
            });
            if (!durations.length) return null;
            durations.sort(function(a, b) { return a - b; });
            const rank = Math.max(0, Math.min(durations.length - 1, Math.ceil(percentile * durations.length) - 1));
            return durations[rank];
        } catch (e) {
            return null;
        }
    }

    function buildCycleFilters(params) {
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
            [HF.ACTION, 'anyof', [ACTION.SUBMIT, ACTION.APPROVE, ACTION.REJECT]]
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
        return filters;
    }

    function parseDate(value) {
        if (!value) return null;
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

    function exportThroughputCsv(context, params) {
        try {
            const rows = [];
            const searchObj = search.create({
                type: RT.APPROVAL_HISTORY,
                filters: buildThroughputFilters(params),
                columns: [
                    HF.TRAN_TYPE,
                    HF.TRAN_ID,
                    HF.ACTION,
                    HF.APPROVER,
                    HF.ACTING_APPROVER,
                    HF.TIMESTAMP,
                    HF.METHOD
                ]
            });

            searchObj.run().each(function(result) {
                const tranType = result.getValue(HF.TRAN_TYPE);
                const tranId = result.getValue(HF.TRAN_ID);
                const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
                const recordUrl = recordType && tranId
                    ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                    : '';
                rows.push({
                    type: result.getText(HF.TRAN_TYPE) || tranType || '',
                    tranId: tranId || '',
                    url: recordUrl,
                    action: result.getText(HF.ACTION) || result.getValue(HF.ACTION) || '',
                    approver: result.getText(HF.ACTING_APPROVER) || result.getText(HF.APPROVER) || '',
                    timestamp: formatDateTime(result.getValue(HF.TIMESTAMP)),
                    method: result.getText(HF.METHOD) || ''
                });
                return true;
            });

            let csv = [
                'Transaction Type,Transaction ID,Record URL,Action,Approver,Timestamp,Method'
            ].join('\n');
            rows.forEach(function(r) {
                csv += '\n' + [
                    csvEscape(r.type),
                    csvEscape(r.tranId),
                    csvEscape(r.url),
                    csvEscape(r.action),
                    csvEscape(r.approver),
                    csvEscape(r.timestamp),
                    csvEscape(r.method)
                ].join(',');
            });

            const dateStamp = format.format({ value: new Date(), type: format.Type.DATE }).replace(/\//g, '-');
            const csvFile = file.create({
                name: 'p2p_throughput_' + dateStamp + '.csv',
                fileType: file.Type.CSV,
                contents: csv
            });
            context.response.writeFile({ file: csvFile, isInline: false });
        } catch (e) {
            context.response.write('Export failed: ' + e.message);
        }
    }

    function exportSummaryExcel(context, params) {
        try {
            const view = getView(params);
            const sheets = [];

            if (view === 'all' || view === 'pending') {
                sheets.push({
                    name: 'Pending by Path',
                    headers: ['Path', 'Count'],
                    rows: getPendingByPathData(params)
                });
                sheets.push({
                    name: 'Pending by Approver',
                    headers: ['Approver', 'Pending'],
                    rows: getPendingByApproverData(params)
                });
                sheets.push({
                    name: 'Pending by Step',
                    headers: ['Step', 'Count'],
                    rows: getPendingByStepData(params)
                });
                sheets.push({
                    name: 'Pending by Type',
                    headers: ['Type', 'Count'],
                    rows: getPendingByTypeData(params)
                });
                sheets.push({
                    name: 'Pending by Age',
                    headers: ['Age', 'Count'],
                    rows: getPendingByAgeBucketData(params)
                });
                sheets.push({
                    name: 'Pending Summary',
                    headers: ['Metric', 'Value'],
                    rows: getPendingActionSummaryData(params)
                });
                sheets.push({
                    name: 'SLA Breaches by Path',
                    headers: ['Path', 'Breaches'],
                    rows: getSlaBreachesByPathData(params)
                });
                sheets.push({
                    name: 'SLA Breaches by Approver',
                    headers: ['Approver', 'Breaches'],
                    rows: getSlaBreachesByApproverData(params)
                });
            }

            if (view === 'all' || view === 'throughput') {
                sheets.push({
                    name: 'Throughput Summary',
                    headers: ['Action', 'Count'],
                    rows: getThroughputSummaryData(params)
                });
                sheets.push({
                    name: 'Slowest Approvals',
                    headers: ['Transaction', 'Hours', 'Completed'],
                    rows: getSlowestApprovalsData(params)
                });
                sheets.push({
                    name: 'Throughput by Week',
                    headers: ['Week', 'Approved', 'Rejected', 'Total'],
                    rows: getThroughputByWeekData(params)
                });
                sheets.push({
                    name: 'Approval Rate by Week',
                    headers: ['Week', 'Approval %', 'Total'],
                    rows: getApprovalRateByWeekData(params)
                });
                sheets.push({
                    name: 'Avg Approval Time by Path',
                    headers: ['Path', 'Avg Hours', 'Count'],
                    rows: getAvgCycleByPathData(params)
                });
                sheets.push({
                    name: 'Throughput by Type',
                    headers: ['Type', 'Approved', 'Rejected', 'Total'],
                    rows: getThroughputByTypeData(params)
                });
                sheets.push({
                    name: 'Throughput by Approver',
                    headers: ['Approver', 'Approved', 'Rejected', 'Total'],
                    rows: getThroughputByApproverData(params)
                });
                sheets.push({
                    name: 'Throughput by Method',
                    headers: ['Method', 'Count'],
                    rows: getThroughputByMethodData(params)
                });
                sheets.push({
                    name: 'Avg Approval Time by Approver',
                    headers: ['Approver', 'Avg Hours', 'Count'],
                    rows: getAvgCycleByApproverData(params)
                });
            }

            if (!sheets.length) {
                sheets.push({
                    name: 'Summary',
                    headers: ['Message'],
                    rows: [['No data']]
                });
            }

            const xml = buildWorkbookXml(sheets);
            const dateStamp = format.format({ value: new Date(), type: format.Type.DATE }).replace(/\//g, '-');
            const excelFile = file.create({
                name: 'p2p_summary_' + dateStamp + '.xls',
                fileType: file.Type.XMLDOC,
                contents: xml
            });
            context.response.writeFile({ file: excelFile, isInline: false });
        } catch (e) {
            context.response.write('Export failed: ' + e.message);
        }
    }


    function buildWorkbookXml(sheets) {
        let xml = '<?xml version="1.0"?>';
        xml += '<?mso-application progid="Excel.Sheet"?>';
        xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
        sheets.forEach(function(sheet) {
            const name = sanitizeSheetName(sheet.name || 'Sheet');
            xml += '<Worksheet ss:Name="' + xmlEscape(name) + '"><Table>';
            if (sheet.headers && sheet.headers.length) {
                xml += '<Row>';
                sheet.headers.forEach(function(h) {
                    xml += cellXml(h);
                });
                xml += '</Row>';
            }
            const rows = sheet.rows || [];
            if (!rows.length) {
                xml += '<Row>' + cellXml('No data') + '</Row>';
            } else {
                rows.forEach(function(r) {
                    xml += '<Row>';
                    r.forEach(function(c) {
                        xml += cellXml(c);
                    });
                    xml += '</Row>';
                });
            }
            xml += '</Table></Worksheet>';
        });
        xml += '</Workbook>';
        return xml;
    }

    function cellXml(value) {
        const isNumber = typeof value === 'number' && !isNaN(value);
        const type = isNumber ? 'Number' : 'String';
        const content = isNumber ? String(value) : xmlEscape(value);
        return '<Cell><Data ss:Type="' + type + '">' + content + '</Data></Cell>';
    }

    function sanitizeSheetName(name) {
        const cleaned = String(name).replace(/[:\\\/\?\*\[\]]/g, ' ').trim();
        if (!cleaned) return 'Sheet';
        return cleaned.length > 31 ? cleaned.substring(0, 31) : cleaned;
    }

    function xmlEscape(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function exportPendingCsv(context, params) {
        try {
            const ignoreType = params && params.action === 'export_pending_all';
            const rows = [];
            const searchObj = search.create({
                type: RT.APPROVAL_TASK,
                filters: buildPendingFilters(params, { ignoreType: ignoreType }),
                columns: [
                    TF.TRAN_TYPE,
                    TF.TRAN_ID,
                    TF.APPROVER,
                    TF.CREATED,
                    TF.SEQUENCE
                ]
            });

            searchObj.run().each(function(result) {
                const tranType = result.getValue(TF.TRAN_TYPE);
                const tranId = result.getValue(TF.TRAN_ID);
                const approver = result.getText(TF.APPROVER) || '';
                const created = result.getValue(TF.CREATED);
                const ageHrs = calculateAgeHours(created);
                const seq = result.getValue(TF.SEQUENCE);
                const recordType = constants.TRANSACTION_TYPE_REVERSE[tranType];
                const recordUrl = recordType && tranId
                    ? url.resolveRecord({ recordType: recordType, recordId: tranId, isEditMode: false })
                    : '';

                rows.push({
                    type: result.getText(TF.TRAN_TYPE) || tranType || '',
                    tranId: tranId || '',
                    url: recordUrl,
                    approver: approver,
                    created: formatDateTime(created),
                    ageHrs: ageHrs.toFixed(1),
                    step: seq || ''
                });
                return true;
            });

            let csv = [
                'Transaction Type,Transaction ID,Record URL,Approver,Created,Age Hours,Step'
            ].join('\n');
            rows.forEach(function(r) {
                csv += '\n' + [
                    csvEscape(r.type),
                    csvEscape(r.tranId),
                    csvEscape(r.url),
                    csvEscape(r.approver),
                    csvEscape(r.created),
                    csvEscape(r.ageHrs),
                    csvEscape(r.step)
                ].join(',');
            });

            const dateStamp = format.format({ value: new Date(), type: format.Type.DATE }).replace(/\//g, '-');
            const csvName = ignoreType
                ? 'p2p_pending_tasks_all_' + dateStamp + '.csv'
                : 'p2p_pending_tasks_' + dateStamp + '.csv';
            const csvFile = file.create({
                name: csvName,
                fileType: file.Type.CSV,
                contents: csv
            });
            context.response.writeFile({ file: csvFile, isInline: false });
        } catch (e) {
            context.response.write('Export failed: ' + e.message);
        }
    }

    function csvEscape(value) {
        if (value === null || value === undefined) return '';
        const s = String(value);
        if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function buildSuiteletUrl(params, overrides) {
        const q = [];
        function add(name, value) {
            if (value === null || value === undefined || value === '') return;
            q.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
        }
        const p = params || {};
        add('custpage_view', p.custpage_view);
        add('custpage_show_charts', p.custpage_show_charts);
        add('custpage_tran_type', p.custpage_tran_type);
        add('custpage_date_from', p.custpage_date_from);
        add('custpage_date_to', p.custpage_date_to);
        if (overrides) {
            Object.keys(overrides).forEach(function(key) {
                add(key, overrides[key]);
            });
        }
        const baseUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId
        });
        return baseUrl + (q.length ? '&' + q.join('&') : '');
    }

    function withView(params, view) {
        const p = {};
        if (params) {
            Object.keys(params).forEach(function(key) {
                p[key] = params[key];
            });
        }
        p.custpage_view = view;
        return p;
    }

    function getView(params) {
        const value = params && params.custpage_view ? String(params.custpage_view) : 'all';
        if (value === 'pending' || value === 'throughput' || value === 'all') return value;
        return 'all';
    }

    function getShowCharts(params) {
        return !(params && params.custpage_show_charts === 'F');
    }

    return { onRequest: onRequest };
});
