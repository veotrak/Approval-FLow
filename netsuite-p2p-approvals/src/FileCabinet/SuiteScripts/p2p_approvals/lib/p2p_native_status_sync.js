/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * P2P Native Status Sync - Keeps NetSuite native approvalstatus in sync with P2P custom status.
 * This prevents user confusion (e.g. record showing "Pending Approval" banner after rejection)
 * and ensures proper posting behavior (rejected records should not post).
 *
 * Native approvalstatus values (typical): 1=Pending Approval, 2=Approved, 3=Rejected
 * See: https://www.netsuiterp.com/2019/03/approval-status-list-internal-ids.html
 */
define(['N/record', '../constants/p2p_constants_v2'], function(record, constants) {
    'use strict';

    const BF = constants.BODY_FIELDS;
    const P2P = constants.APPROVAL_STATUS;
    const NATIVE = constants.NATIVE_APPROVAL_STATUS;

    /** Native approvalstatus field ID on PO and Vendor Bill */
    const NATIVE_FIELD = 'approvalstatus';

    /**
     * Map P2P approval status to native approval status internal ID.
     * @param {string} p2pStatus - P2P status internal ID (e.g. APPROVAL_STATUS.APPROVED)
     * @returns {string|null} Native status internal ID, or null if no mapping
     */
    function mapP2pToNative(p2pStatus) {
        if (!p2pStatus) return null;
        switch (String(p2pStatus)) {
            case P2P.APPROVED:
                return NATIVE.APPROVED;
            case P2P.REJECTED:
                return NATIVE.REJECTED;
            case P2P.PENDING_APPROVAL:
            case P2P.PENDING_SUBMISSION:
            case P2P.ESCALATED:
            case P2P.PENDING_EXCEPTION_REVIEW:
                return NATIVE.PENDING_APPROVAL;
            case P2P.DRAFT:
            case P2P.RECALLED:
                return NATIVE.PENDING_APPROVAL;
            default:
                return null;
        }
    }

    /**
     * Update transaction with both P2P custom status and native approvalstatus.
     * Use this when you need to set approval status so the native banner and posting
     * behavior stay in sync with P2P workflow state.
     *
     * @param {Object} params
     * @param {string} params.recordType - NetSuite record type (purchaseorder, vendorbill)
     * @param {number} params.recordId - Transaction internal ID
     * @param {Object} params.values - Field values to submit (must include BF.APPROVAL_STATUS)
     * @returns {void}
     */
    function syncAndSubmit(params) {
        var values = params.values || {};
        var p2pStatus = values[BF.APPROVAL_STATUS];
        var nativeStatus = mapP2pToNative(p2pStatus);

        if (nativeStatus) {
            values[NATIVE_FIELD] = nativeStatus;
        }

        record.submitFields({
            type: params.recordType,
            id: params.recordId,
            values: values
        });
    }

    /**
     * Add native status to an existing values object (for use with record.submitFields).
     * Call this before submitFields when updating approval status.
     *
     * @param {Object} values - Field values object (mutated in place)
     * @param {string} p2pStatus - P2P approval status internal ID
     */
    function addNativeStatusToValues(values, p2pStatus) {
        var nativeStatus = mapP2pToNative(p2pStatus);
        if (nativeStatus) {
            values[NATIVE_FIELD] = nativeStatus;
        }
    }

    return {
        mapP2pToNative: mapP2pToNative,
        syncAndSubmit: syncAndSubmit,
        addNativeStatusToValues: addNativeStatusToValues,
        NATIVE_FIELD: NATIVE_FIELD
    };
});
