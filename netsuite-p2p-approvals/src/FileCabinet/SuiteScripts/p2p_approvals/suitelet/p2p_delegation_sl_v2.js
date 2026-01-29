/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * P2P Delegation Suitelet (v2 - Decision Table Architecture)
 * Allows users to manage their approval delegations
 */
define([
    'N/ui/serverWidget', 'N/runtime', 'N/format', 'N/record',
    '../lib/p2p_delegation_manager_v2',
    '../lib/p2p_config',
    '../constants/p2p_constants_v2'
], function(serverWidget, runtime, format, record, delegationManager, config, constants) {
    'use strict';

    const TRAN_TYPE = constants.TRANSACTION_TYPES;

    /**
     * Main request handler
     */
    function onRequest(context) {
        if (context.request.method === 'GET') {
            const action = context.request.parameters.action;
            
            if (action === 'deactivate') {
                return deactivateDelegation(context);
            }
            
            return showDelegationForm(context);
        }

        if (context.request.method === 'POST') {
            return createDelegation(context);
        }
    }

    /**
     * Show delegation management form
     */
    function showDelegationForm(context) {
        const currentUser = runtime.getCurrentUser().id;
        const form = serverWidget.createForm({ title: 'P2P Delegation Management' });

        // Add info section
        form.addField({
            id: 'custpage_info',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<div style="margin: 10px 0; padding: 15px; background: #E3F2FD; border-radius: 4px;">' +
            '<strong>Delegation allows another person to act on your behalf for approvals while you are away.</strong>' +
            '<br>Delegations are time-limited and can be scoped to specific subsidiaries or transaction types.' +
            '</div>';

        // ===== Create New Delegation Section =====
        form.addFieldGroup({
            id: 'custpage_new_group',
            label: 'Create New Delegation'
        });

        // Delegate field
        const delegateField = form.addField({
            id: 'custpage_delegate',
            type: serverWidget.FieldType.SELECT,
            label: 'Delegate To',
            source: 'employee',
            container: 'custpage_new_group'
        });
        delegateField.isMandatory = true;

        // Start date
        const startField = form.addField({
            id: 'custpage_start',
            type: serverWidget.FieldType.DATE,
            label: 'Start Date',
            container: 'custpage_new_group'
        });
        startField.isMandatory = true;
        startField.defaultValue = new Date();

        // End date
        const endField = form.addField({
            id: 'custpage_end',
            type: serverWidget.FieldType.DATE,
            label: 'End Date',
            container: 'custpage_new_group'
        });
        endField.isMandatory = true;

        // Subsidiary scope (optional)
        form.addField({
            id: 'custpage_subsidiary',
            type: serverWidget.FieldType.SELECT,
            label: 'Subsidiary Scope (Optional)',
            source: 'subsidiary',
            container: 'custpage_new_group'
        });

        // Transaction type scope
        const tranTypeField = form.addField({
            id: 'custpage_tran_type',
            type: serverWidget.FieldType.SELECT,
            label: 'Transaction Type Scope (Optional)',
            container: 'custpage_new_group'
        });
        tranTypeField.addSelectOption({ value: '', text: '-- All Types --' });
        tranTypeField.addSelectOption({ value: TRAN_TYPE.PURCHASE_ORDER, text: 'Purchase Order' });
        tranTypeField.addSelectOption({ value: TRAN_TYPE.VENDOR_BILL, text: 'Vendor Bill' });

        // ===== Existing Delegations Section =====
        form.addFieldGroup({
            id: 'custpage_existing_group',
            label: 'Your Existing Delegations'
        });

        // Create sublist for existing delegations
        const sublist = form.addSublist({
            id: 'custpage_delegations',
            type: serverWidget.SublistType.LIST,
            label: 'Active & Recent Delegations'
        });

        sublist.addField({ id: 'col_id', type: serverWidget.FieldType.TEXT, label: 'ID' });
        sublist.addField({ id: 'col_delegate', type: serverWidget.FieldType.TEXT, label: 'Delegate' });
        sublist.addField({ id: 'col_start', type: serverWidget.FieldType.TEXT, label: 'Start Date' });
        sublist.addField({ id: 'col_end', type: serverWidget.FieldType.TEXT, label: 'End Date' });
        sublist.addField({ id: 'col_subsidiary', type: serverWidget.FieldType.TEXT, label: 'Subsidiary' });
        sublist.addField({ id: 'col_trantype', type: serverWidget.FieldType.TEXT, label: 'Tran Type' });
        sublist.addField({ id: 'col_status', type: serverWidget.FieldType.TEXT, label: 'Status' });
        sublist.addField({ id: 'col_action', type: serverWidget.FieldType.TEXT, label: 'Action' });

        // Get existing delegations
        const delegations = delegationManager.getEmployeeDelegations(currentUser, false);
        
        delegations.forEach(function(item, index) {
            sublist.setSublistValue({ id: 'col_id', line: index, value: String(item.id) });
            sublist.setSublistValue({ id: 'col_delegate', line: index, value: item.delegateName || String(item.delegateId) });
            sublist.setSublistValue({ id: 'col_start', line: index, value: item.startDate || '' });
            sublist.setSublistValue({ id: 'col_end', line: index, value: item.endDate || '' });
            sublist.setSublistValue({ id: 'col_subsidiary', line: index, value: item.subsidiaryName || 'All' });
            sublist.setSublistValue({ id: 'col_trantype', line: index, value: item.tranTypeName || 'All' });
            
            // Determine status
            const now = new Date();
            const start = item.startDate ? new Date(item.startDate) : null;
            const end = item.endDate ? new Date(item.endDate) : null;
            let status = 'Unknown';
            
            if (!item.active) {
                status = 'Inactive';
            } else if (start && start > now) {
                status = 'Scheduled';
            } else if (end && end < now) {
                status = 'Expired';
            } else {
                status = 'Active';
            }
            
            sublist.setSublistValue({ id: 'col_status', line: index, value: status });

            // Add deactivate link for active/scheduled delegations
            if (item.active && status !== 'Expired') {
                const deactivateUrl = getDeactivateUrl(item.id);
                sublist.setSublistValue({ 
                    id: 'col_action', 
                    line: index, 
                    value: '<a href="' + deactivateUrl + '">Deactivate</a>'
                });
            }
        });

        // ===== Delegations to You Section =====
        const toYouDelegations = delegationManager.getEmployeeDelegations(currentUser, true);
        
        if (toYouDelegations.length > 0) {
            form.addFieldGroup({
                id: 'custpage_to_you_group',
                label: 'Delegations to You'
            });

            let toYouHtml = '<table style="width: 100%; border-collapse: collapse;">';
            toYouHtml += '<tr style="background: #f5f5f5;">';
            toYouHtml += '<th style="padding: 8px; text-align: left;">From</th>';
            toYouHtml += '<th style="padding: 8px; text-align: left;">Start</th>';
            toYouHtml += '<th style="padding: 8px; text-align: left;">End</th>';
            toYouHtml += '<th style="padding: 8px; text-align: left;">Scope</th>';
            toYouHtml += '</tr>';

            toYouDelegations.forEach(function(item) {
                if (!item.active) return;
                
                toYouHtml += '<tr>';
                toYouHtml += '<td style="padding: 8px;">' + escapeHtml(item.originalName || item.originalId) + '</td>';
                toYouHtml += '<td style="padding: 8px;">' + escapeHtml(item.startDate) + '</td>';
                toYouHtml += '<td style="padding: 8px;">' + escapeHtml(item.endDate) + '</td>';
                
                let scope = [];
                if (item.subsidiaryName) scope.push(item.subsidiaryName);
                if (item.tranTypeName) scope.push(item.tranTypeName);
                toYouHtml += '<td style="padding: 8px;">' + (scope.length ? escapeHtml(scope.join(', ')) : 'All') + '</td>';
                toYouHtml += '</tr>';
            });

            toYouHtml += '</table>';

            form.addField({
                id: 'custpage_to_you_list',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' ',
                container: 'custpage_to_you_group'
            }).defaultValue = toYouHtml;
        }

        // Add submit button
        form.addSubmitButton({ label: 'Create Delegation' });

        context.response.writePage(form);
    }

    /**
     * Create new delegation
     */
    function createDelegation(context) {
        const request = context.request;
        const currentUser = runtime.getCurrentUser().id;

        const delegateId = request.parameters.custpage_delegate;
        const startDate = request.parameters.custpage_start;
        const endDate = request.parameters.custpage_end;
        const subsidiary = request.parameters.custpage_subsidiary || null;
        const tranType = request.parameters.custpage_tran_type || null;

        // Validation
        const validationError = validateDelegationInput({
            currentUser: currentUser,
            delegateId: delegateId,
            startDate: startDate,
            endDate: endDate
        });

        if (validationError) {
            return showResultPage(context, validationError, false);
        }

        try {
            const id = delegationManager.createDelegation({
                originalId: currentUser,
                delegateId: delegateId,
                startDate: startDate,
                endDate: endDate,
                subsidiary: subsidiary,
                transactionType: tranType
            });

            return showResultPage(context, 'Delegation created successfully (ID: ' + id + ').', true);
        } catch (error) {
            return showResultPage(context, 'Error creating delegation: ' + error.message, false);
        }
    }

    /**
     * Deactivate a delegation
     */
    function deactivateDelegation(context) {
        const delegationId = context.request.parameters.id;
        const currentUser = runtime.getCurrentUser().id;

        if (!delegationId) {
            return showResultPage(context, 'Invalid delegation ID.', false);
        }

        try {
            // Verify ownership
            const delegation = record.load({
                type: constants.RECORD_TYPES.DELEGATION,
                id: delegationId
            });

            const originalId = delegation.getValue(constants.DELEGATION_FIELDS.ORIGINAL);
            if (String(originalId) !== String(currentUser)) {
                return showResultPage(context, 'You can only deactivate your own delegations.', false);
            }

            // Deactivate
            delegationManager.deactivateDelegation(delegationId);

            return showResultPage(context, 'Delegation deactivated successfully.', true);
        } catch (error) {
            return showResultPage(context, 'Error deactivating delegation: ' + error.message, false);
        }
    }

    /**
     * Validate delegation input
     */
    function validateDelegationInput(params) {
        if (!params.delegateId) {
            return 'Please select a delegate.';
        }

        if (String(params.delegateId) === String(params.currentUser)) {
            return 'You cannot delegate to yourself.';
        }

        if (!params.startDate || !params.endDate) {
            return 'Start and end dates are required.';
        }

        try {
            const start = format.parse({ value: params.startDate, type: format.Type.DATE });
            const end = format.parse({ value: params.endDate, type: format.Type.DATE });

            if (end < start) {
                return 'End date must be on or after start date.';
            }

            // Check max duration
            const globalConfig = config.getConfig();
            const maxDays = globalConfig.maxDelegationDays || 30;
            const durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

            if (durationDays > maxDays) {
                return 'Delegation duration cannot exceed ' + maxDays + ' days.';
            }
        } catch (e) {
            return 'Invalid date format.';
        }

        return null;
    }

    /**
     * Show result page
     */
    function showResultPage(context, message, success) {
        const form = serverWidget.createForm({ title: 'Delegation Result' });

        const color = success ? '#4CAF50' : '#f44336';
        const icon = success ? '✓' : '✗';

        let html = '<div style="padding: 40px; text-align: center;">';
        html += '<div style="font-size: 48px; color: ' + color + ';">' + icon + '</div>';
        html += '<h2 style="color: ' + color + ';">' + (success ? 'Success' : 'Error') + '</h2>';
        html += '<p>' + escapeHtml(message) + '</p>';
        html += '<p style="margin-top: 20px;"><a href="' + getReturnUrl() + '">Return to Delegation Management</a></p>';
        html += '</div>';

        form.addField({
            id: 'custpage_result',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = html;

        context.response.writePage(form);
    }

    /**
     * Get URL to return to delegation form
     */
    function getReturnUrl() {
        return '/app/site/hosting/scriptlet.nl?script=customscript_p2p_delegation_sl_v2&deploy=customdeploy_p2p_delegation_v2';
    }

    /**
     * Get URL to deactivate delegation
     */
    function getDeactivateUrl(id) {
        return '/app/site/hosting/scriptlet.nl?script=customscript_p2p_delegation_sl_v2&deploy=customdeploy_p2p_delegation_v2&action=deactivate&id=' + id;
    }

    /**
     * Escape HTML
     */
    function escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return { onRequest: onRequest };
});
