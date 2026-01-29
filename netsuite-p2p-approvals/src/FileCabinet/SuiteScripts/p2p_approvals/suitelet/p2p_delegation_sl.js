/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/runtime', '../lib/p2p_delegation_manager', '../constants/p2p_constants'], function(
    serverWidget, runtime, delegationManager, constants
) {
    'use strict';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            return showDelegationForm(context);
        }

        if (context.request.method === 'POST') {
            return createDelegation(context);
        }
    }

    function showDelegationForm(context) {
        const form = serverWidget.createForm({ title: 'P2P Delegations' });
        const currentUser = runtime.getCurrentUser().id;

        form.addField({ id: 'custpage_delegate', type: serverWidget.FieldType.SELECT, label: 'Delegate', source: 'employee' });
        form.addField({ id: 'custpage_start', type: serverWidget.FieldType.DATE, label: 'Start Date' });
        form.addField({ id: 'custpage_end', type: serverWidget.FieldType.DATE, label: 'End Date' });
        form.addField({ id: 'custpage_subsidiary', type: serverWidget.FieldType.SELECT, label: 'Subsidiary', source: 'subsidiary' });
        form.addField({ id: 'custpage_tran_type', type: serverWidget.FieldType.SELECT, label: 'Transaction Type' })
            .addSelectOption({ value: '', text: '' });

        const tranTypeField = form.getField({ id: 'custpage_tran_type' });
        tranTypeField.addSelectOption({ value: constants.TRANSACTION_TYPES.PURCHASE_ORDER, text: 'Purchase Order' });
        tranTypeField.addSelectOption({ value: constants.TRANSACTION_TYPES.VENDOR_BILL, text: 'Vendor Bill' });

        const sublist = form.addSublist({
            id: 'custpage_delegations',
            type: serverWidget.SublistType.LIST,
            label: 'My Delegations'
        });
        sublist.addField({ id: 'col_id', type: serverWidget.FieldType.TEXT, label: 'ID' });
        sublist.addField({ id: 'col_delegate', type: serverWidget.FieldType.TEXT, label: 'Delegate' });
        sublist.addField({ id: 'col_start', type: serverWidget.FieldType.TEXT, label: 'Start' });
        sublist.addField({ id: 'col_end', type: serverWidget.FieldType.TEXT, label: 'End' });
        sublist.addField({ id: 'col_active', type: serverWidget.FieldType.TEXT, label: 'Active' });

        const delegations = delegationManager.getEmployeeDelegations(currentUser, false);
        delegations.forEach(function(item, index) {
            sublist.setSublistValue({ id: 'col_id', line: index, value: String(item.id) });
            sublist.setSublistValue({ id: 'col_delegate', line: index, value: item.delegate || '' });
            sublist.setSublistValue({ id: 'col_start', line: index, value: item.startDate || '' });
            sublist.setSublistValue({ id: 'col_end', line: index, value: item.endDate || '' });
            sublist.setSublistValue({ id: 'col_active', line: index, value: item.active ? 'Yes' : 'No' });
        });

        form.addSubmitButton({ label: 'Create Delegation' });
        context.response.writePage(form);
    }

    function createDelegation(context) {
        const request = context.request;
        const currentUser = runtime.getCurrentUser().id;
        const delegateId = request.parameters.custpage_delegate;
        const startDate = request.parameters.custpage_start;
        const endDate = request.parameters.custpage_end;
        const subsidiary = request.parameters.custpage_subsidiary;
        const tranType = request.parameters.custpage_tran_type;

        let message = '';
        try {
            const id = delegationManager.createDelegation({
                originalId: currentUser,
                delegateId: delegateId,
                startDate: startDate,
                endDate: endDate,
                subsidiary: subsidiary || null,
                transactionType: tranType || null
            });
            message = 'Delegation created (ID: ' + id + ').';
        } catch (error) {
            message = 'Unable to create delegation: ' + error.message;
        }

        const form = serverWidget.createForm({ title: 'Delegation Result' });
        form.addField({
            id: 'custpage_result',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        }).defaultValue = '<p>' + message + '</p>';
        context.response.writePage(form);
    }

    return { onRequest: onRequest };
});
