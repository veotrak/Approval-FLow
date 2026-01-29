/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([], function() {
    'use strict';
    
    const RECORD_TYPES = {
        APPROVAL_RULE: 'customrecord_p2p_approval_rule',
        APPROVAL_STEP: 'customrecord_p2p_approval_step',
        DELEGATION: 'customrecord_p2p_delegation',
        APPROVAL_TASK: 'customrecord_p2p_approval_task',
        APPROVAL_HISTORY: 'customrecord_p2p_approval_history',
        DEPT_GROUP: 'customrecord_p2p_dept_group',
        DEPT_GROUP_MEMBER: 'customrecord_p2p_dept_group_member',
        LOC_GROUP: 'customrecord_p2p_loc_group',
        LOC_GROUP_MEMBER: 'customrecord_p2p_loc_group_member'
    };

    const TRANSACTION_TYPES = {
        PURCHASE_ORDER: '1',
        VENDOR_BILL: '2'
    };

    const TRANSACTION_TYPE_MAP = {
        purchaseorder: '1',
        vendorbill: '2'
    };

    const APPROVAL_STATUS = {
        DRAFT: '1',
        PENDING_APPROVAL: '2',
        APPROVED: '3',
        REJECTED: '4'
    };

    const APPROVAL_ACTION = {
        APPROVE: '1',
        REJECT: '2',
        REASSIGN: '3',
        ESCALATE: '4',
        SUBMIT: '5',
        RESUBMIT: '6'
    };

    const APPROVER_TYPE = {
        ROLE: '1',
        NAMED_PERSON: '2'
    };

    const EXECUTION_MODE = {
        SERIAL: '1',
        PARALLEL: '2'
    };

    const TASK_STATUS = {
        PENDING: '1',
        APPROVED: '2',
        REJECTED: '3',
        REASSIGNED: '4',
        ESCALATED: '5',
        CANCELLED: '6'
    };

    const EXCEPTION_TYPE = {
        NONE: '',
        MISSING_PO: '1',
        VARIANCE_OVER_LIMIT: '2',
        MISSING_RECEIPT: '3',
        MULTIPLE: '4'
    };

    const MATCH_STATUS = {
        NOT_CHECKED: '1',
        PASS: '2',
        FAIL: '3'
    };

    const APPROVAL_METHOD = {
        UI: '1',
        EMAIL: '2',
        BULK: '3',
        API: '4'
    };

    const RULE_FIELDS = {
        TRAN_TYPE: 'custrecord_p2p_ar_tran_type',
        SUBSIDIARY: 'custrecord_p2p_ar_subsidiary',
        AMOUNT_FROM: 'custrecord_p2p_ar_amount_from',
        AMOUNT_TO: 'custrecord_p2p_ar_amount_to',
        CURRENCY: 'custrecord_p2p_ar_currency',
        DEPARTMENT: 'custrecord_p2p_ar_department',
        LOCATION: 'custrecord_p2p_ar_location',
        DEPT_GROUP: 'custrecord_p2p_ar_dept_group',
        LOC_GROUP: 'custrecord_p2p_ar_loc_group',
        PRIORITY: 'custrecord_p2p_ar_priority',
        MIN_RISK_SCORE: 'custrecord_p2p_ar_min_risk_score',
        EFFECTIVE_FROM: 'custrecord_p2p_ar_effective_from',
        EFFECTIVE_TO: 'custrecord_p2p_ar_effective_to',
        ACTIVE: 'custrecord_p2p_ar_active',
        EXC_NO_PO: 'custrecord_p2p_ar_exc_no_po',
        EXC_VARIANCE: 'custrecord_p2p_ar_exc_variance',
        EXC_NO_RECEIPT: 'custrecord_p2p_ar_exc_no_receipt',
        SLA_HOURS: 'custrecord_p2p_ar_sla_hours'
    };

    const STEP_FIELDS = {
        PARENT_RULE: 'custrecord_p2p_as_parent_rule',
        SEQUENCE: 'custrecord_p2p_as_sequence',
        APPROVER_TYPE: 'custrecord_p2p_as_approver_type',
        APPROVER_ROLE: 'custrecord_p2p_as_approver_role',
        APPROVER_EMPLOYEE: 'custrecord_p2p_as_approver_employee',
        EXECUTION_MODE: 'custrecord_p2p_as_execution_mode',
        REQUIRE_COMMENT: 'custrecord_p2p_as_require_comment'
    };

    const DELEGATION_FIELDS = {
        ORIGINAL: 'custrecord_p2p_del_original',
        DELEGATE: 'custrecord_p2p_del_delegate',
        START_DATE: 'custrecord_p2p_del_start_date',
        END_DATE: 'custrecord_p2p_del_end_date',
        SUBSIDIARY: 'custrecord_p2p_del_subsidiary',
        TRAN_TYPE: 'custrecord_p2p_del_tran_type',
        ACTIVE: 'custrecord_p2p_del_active'
    };

    const TASK_FIELDS = {
        TRAN_TYPE: 'custrecord_p2p_at_tran_type',
        TRAN_ID: 'custrecord_p2p_at_tran_id',
        RULE: 'custrecord_p2p_at_rule',
        STEP: 'custrecord_p2p_at_step',
        SEQUENCE: 'custrecord_p2p_at_sequence',
        APPROVER: 'custrecord_p2p_at_approver',
        ACTING_APPROVER: 'custrecord_p2p_at_acting_approver',
        STATUS: 'custrecord_p2p_at_status',
        CREATED: 'custrecord_p2p_at_created',
        COMPLETED: 'custrecord_p2p_at_completed',
        TOKEN: 'custrecord_p2p_at_token',
        TOKEN_EXPIRY: 'custrecord_p2p_at_token_expiry',
        REMINDER_COUNT: 'custrecord_p2p_at_reminder_count',
        ESCALATED: 'custrecord_p2p_at_escalated'
    };

    const HISTORY_FIELDS = {
        TRAN_TYPE: 'custrecord_p2p_ah_tran_type',
        TRAN_ID: 'custrecord_p2p_ah_tran_id',
        STEP_SEQUENCE: 'custrecord_p2p_ah_step_sequence',
        APPROVER: 'custrecord_p2p_ah_approver',
        ACTING_APPROVER: 'custrecord_p2p_ah_acting_approver',
        ACTION: 'custrecord_p2p_ah_action',
        TIMESTAMP: 'custrecord_p2p_ah_timestamp',
        COMMENT: 'custrecord_p2p_ah_comment',
        IP_ADDRESS: 'custrecord_p2p_ah_ip_address',
        METHOD: 'custrecord_p2p_ah_method'
    };

    const BODY_FIELDS = {
        APPROVAL_STATUS: 'custbody_p2p_approval_status',
        CURRENT_STEP: 'custbody_p2p_current_step',
        CURRENT_APPROVER: 'custbody_p2p_current_approver',
        APPROVAL_RULE: 'custbody_p2p_approval_rule',
        EXCEPTION_TYPE: 'custbody_p2p_exception_type',
        MATCH_STATUS: 'custbody_p2p_match_status',
        AI_RISK_SCORE: 'custbody_p2p_ai_risk_score',
        AI_RISK_FLAGS: 'custbody_p2p_ai_risk_flags',
        AI_RISK_SUMMARY: 'custbody_p2p_ai_risk_summary',
        AI_EXCEPTION_SUGGESTION: 'custbody_p2p_ai_exception_suggestion',
        REVISION_NUMBER: 'custbody_p2p_revision_number'
    };

    const CONFIG = {
        TOKEN_EXPIRY_HOURS: 72,
        REMINDER_HOURS: [24, 48],
        ESCALATION_HOURS: 72,
        VARIANCE_PERCENT_LIMIT: 5,
        VARIANCE_AMOUNT_LIMIT: 500,
        PO_REQUIRED_THRESHOLD: 1000,
        MAX_DELEGATION_DAYS: 30,
        FALLBACK_APPROVER_ROLE: 3,
        BULK_APPROVAL_LIMIT: 50,
        NEW_VENDOR_DAYS: 14,
        MIN_VENDOR_BILLS_FOR_ACCOUNT_ANOMALY: 5
    };

    const SPECIFICITY_SCORES = {
        DEPARTMENT_EXACT: 4,
        DEPARTMENT_GROUP: 3,
        LOCATION_EXACT: 2,
        LOCATION_GROUP: 1,
        RISK_THRESHOLD: 1
    };

    const SCRIPT_PARAMS = {
        AUTO_APPROVE_THRESHOLD: 'custscript_p2p_auto_approve_threshold',
        NEW_VENDOR_DAYS: 'custscript_p2p_new_vendor_days',
        MIN_VENDOR_BILLS_FOR_ACCOUNT_ANOMALY: 'custscript_p2p_min_vendor_bills_account_anom'
    };

    const SCRIPTS = {
        EMAIL_APPROVAL_SL: 'customscript_p2p_email_approval_sl',
        EMAIL_APPROVAL_DEPLOY: 'customdeploy_p2p_email_approval',
        BULK_APPROVAL_SL: 'customscript_p2p_bulk_approval_sl',
        BULK_APPROVAL_DEPLOY: 'customdeploy_p2p_bulk_approval'
    };

    return {
        RECORD_TYPES, TRANSACTION_TYPES, TRANSACTION_TYPE_MAP,
        APPROVAL_STATUS, APPROVAL_ACTION, APPROVER_TYPE, EXECUTION_MODE,
        TASK_STATUS, EXCEPTION_TYPE, MATCH_STATUS, APPROVAL_METHOD,
        RULE_FIELDS, STEP_FIELDS, DELEGATION_FIELDS, TASK_FIELDS,
        HISTORY_FIELDS, BODY_FIELDS, CONFIG, SPECIFICITY_SCORES, SCRIPTS, SCRIPT_PARAMS
    };
});
