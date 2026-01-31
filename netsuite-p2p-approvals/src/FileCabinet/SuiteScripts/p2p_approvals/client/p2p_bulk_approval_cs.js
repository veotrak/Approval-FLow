/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * P2P Bulk Approval Client Script
 * - Validates comment is required when rejecting (blocks submit until comment entered)
 * - Replaces Link column URL text with Tran # as clickable link text (legacy)
 * - Apply Filters: redirects to suitelet with filter params
 */
define([], function() {
    'use strict';

    var BASE_URL = '/app/site/hosting/scriptlet.nl?script=customscript_p2p_bulk_approval_sl&deploy=customdeploy_p2p_bulk_approval';

    function pageInit(context) {
        setTimeout(updateLinkColumnText, 200);
    }

    /**
     * Validate before form submit - require comment when rejecting
     */
    function saveRecord(context) {
        var actionEl = document.getElementById('custpage_action') || document.querySelector('[name="custpage_action"]');
        var commentEl = document.getElementById('custpage_comment') || document.querySelector('[name="custpage_comment"]');
        var action = (actionEl && actionEl.value) ? String(actionEl.value).toLowerCase().trim() : '';
        var comment = (commentEl && commentEl.value) ? String(commentEl.value).trim() : '';

        if (action === 'reject' && !comment) {
            alert('A comment is required when rejecting. Please enter a comment before submitting.');
            if (commentEl) {
                commentEl.focus();
            }
            return false;
        }
        return true;
    }

    function updateLinkColumnText() {
        try {
            var anchors = document.querySelectorAll('a[href*="purchord.nl"], a[href*="vendbill.nl"]');
            if (!anchors || anchors.length === 0) return;
            anchors.forEach(function(anchor) {
                var tranNum = (anchor.textContent || anchor.innerText || '').trim();
                if (!tranNum && anchor.closest('td')) {
                    var prev = anchor.closest('td').previousElementSibling;
                    if (prev) tranNum = (prev.textContent || prev.innerText || '').trim();
                }
                if (tranNum) anchor.textContent = tranNum;
            });
        } catch (e) { /* ignore */ }
    }

    function applyFilters() {
        try {
            var type = (document.getElementById('custpage_filter_type') || {}).value || '';
            var dateFrom = (document.getElementById('custpage_filter_datefrom') || {}).value || '';
            var dateTo = (document.getElementById('custpage_filter_dateto') || {}).value || '';
            var approver = (document.getElementById('custpage_filter_approver') || {}).value || '';
            var params = [];
            if (type) params.push('custpage_filter_type=' + encodeURIComponent(type));
            if (dateFrom) params.push('custpage_filter_datefrom=' + encodeURIComponent(dateFrom));
            if (dateTo) params.push('custpage_filter_dateto=' + encodeURIComponent(dateTo));
            if (approver) params.push('custpage_filter_approver=' + encodeURIComponent(approver));
            var url = BASE_URL + (params.length ? '&' + params.join('&') : '');
            window.location.href = url;
        } catch (e) {
            alert('Error applying filters: ' + (e.message || e));
        }
    }

    return {
        pageInit: pageInit,
        saveRecord: saveRecord,
        applyFilters: applyFilters
    };
});
