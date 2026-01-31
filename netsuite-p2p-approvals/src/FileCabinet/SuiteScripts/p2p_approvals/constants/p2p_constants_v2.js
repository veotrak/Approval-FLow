/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Approval Workflow - Constants (v2 - Decision Table Architecture)
 */
define([], function() {
    'use strict';
    
    // ===== CUSTOM RECORD TYPES =====
    const RECORD_TYPES = {
        // New Decision Table Architecture
        DECISION_RULE: 'customrecord_p2p_decision_rule',
        APPROVAL_PATH: 'customrecord_p2p_approval_path',
        PATH_STEP: 'customrecord_p2p_path_step',
        GLOBAL_CONFIG: 'customrecord_p2p_global_config',
        
        // Kept from original
        APPROVAL_TASK: 'customrecord_p2p_approval_task',
        APPROVAL_HISTORY: 'customrecord_p2p_approval_history',
        DELEGATION: 'customrecord_p2p_delegation',
        
        // Deprecated (kept for migration reference)
        APPROVAL_RULE_LEGACY: 'customrecord_p2p_approval_rule',
        APPROVAL_STEP_LEGACY: 'customrecord_p2p_approval_step',
        DEPT_GROUP_LEGACY: 'customrecord_p2p_dept_group',
        DEPT_GROUP_MEMBER_LEGACY: 'customrecord_p2p_dept_group_member',
        LOC_GROUP_LEGACY: 'customrecord_p2p_loc_group',
        LOC_GROUP_MEMBER_LEGACY: 'customrecord_p2p_loc_group_member'
    };

    // ===== TRANSACTION TYPES =====
    const TRANSACTION_TYPES = {
        PURCHASE_ORDER: '1',
        VENDOR_BILL: '2',
        SALES_ORDER: '3',
        INVOICE: '4'
    };

    const TRANSACTION_TYPE_MAP = {
        purchaseorder: '1',
        vendorbill: '2',
        salesorder: '3',
        invoice: '4'
    };

    const TRANSACTION_TYPE_REVERSE = {
        '1': 'purchaseorder',
        '2': 'vendorbill',
        '3': 'salesorder',
        '4': 'invoice'
    };

    // ===== LIST VALUES (must match P2P Approval Status custom list) =====
    const APPROVAL_STATUS = {
        DRAFT: '1',
        PENDING_SUBMISSION: '2',
        PENDING_APPROVAL: '3',
        APPROVED: '4',
        REJECTED: '5',
        RECALLED: '6',
        ESCALATED: '7',
        PENDING_EXCEPTION_REVIEW: '8'
    };

    // ===== NATIVE APPROVAL STATUS (NetSuite transaction approvalstatus field) =====
    // Internal IDs for the standard Approval Status list on PO/Vendor Bill.
    // Verify in your account: Setup > Lists > Approval Status (or search for approval status list).
    // Typical values: 1=Pending Approval, 2=Approved, 3=Rejected
    const NATIVE_APPROVAL_STATUS = {
        PENDING_APPROVAL: '1',
        APPROVED: '2',
        REJECTED: '3'
    };

    const APPROVAL_ACTION = {
        SUBMIT: '1',
        APPROVE: '2',
        REJECT: '3',
        DELEGATE: '4',
        ESCALATE: '5',
        RECALLED: '6',
        REASSIGN: '7',
        COMMENT: '8',
        EXCEPTION_OVERRIDE: '9',
        RESUBMIT: '10'
    };

    const APPROVER_TYPE = {
        NAMED_PERSON: '1',
        SUPERVISOR: '2',
        DEPARTMENT_MANAGER: '3',
        SUBSIDIARY_MANAGER: '4',
        ROLE: '5',
        CUSTOM_FIELD: '6',
        SCRIPT: '7'
    };

    const EXECUTION_MODE = {
        SERIAL: '1',
        PARALLEL: '2',
        PARALLEL_ANY: '3'
    };

    const TASK_STATUS = {
        PENDING: '1',
        APPROVED: '2',
        REJECTED: '3',
        DELEGATED: '4',
        ESCALATED: '5',
        CANCELLED: '6',
        EXPIRED: '7'
    };

    const EXCEPTION_TYPE = {
        NONE: '1',
        PRICE_OVER_TOLERANCE: '2',
        QUANTITY_OVER: '3',
        QUANTITY_UNDER: '4',
        MISSING_PO: '5',
        MISSING_RECEIPT: '6',
        DUPLICATE_INVOICE: '7',
        VENDOR_MISMATCH: '8',
        CURRENCY_MISMATCH: '9',
        MULTIPLE: '10',

        // Aliases used in code
        PRICE_VARIANCE: '2',
        QTY_VARIANCE: '3',
        DUPLICATE: '7',
        VARIANCE_OVER_LIMIT: '2'
    };

    const MATCH_STATUS = {
        NOT_MATCHED: '1',
        MATCHED: '2',
        PARTIAL_MATCH: '3',
        PRICE_VARIANCE: '4',
        QTY_VARIANCE: '5',
        PO_NOT_FOUND: '6',
        RECEIPT_MISSING: '7',
        EXCEPTION_OVERRIDDEN: '8'
    };

    const APPROVAL_METHOD = {
        UI: '1',
        EMAIL: '2',
        BULK: '3',
        API: '4',
        MOBILE: '5'
    };

    // ===== DECISION RULE FIELDS =====
    const DECISION_RULE_FIELDS = {
        TRAN_TYPE: 'custrecord_p2p_dr_tran_type',
        SUBSIDIARY: 'custrecord_p2p_dr_subsidiary',
        DEPARTMENT: 'custrecord_p2p_dr_department',
        LOCATION: 'custrecord_p2p_dr_location',
        DEPT_GROUP: 'custrecord_p2p_dr_dept_group',
        LOC_GROUP: 'custrecord_p2p_dr_loc_group',
        AMT_MIN: 'custrecord_p2p_dr_amt_from',
        AMT_MAX: 'custrecord_p2p_dr_amt_to',
        CURRENCY: 'custrecord_p2p_dr_currency',
        RISK_MIN: 'custrecord_p2p_dr_min_risk',
        RISK_MAX: 'custrecord_p2p_dr_max_risk',
        EXCEPTION: 'custrecord_p2p_dr_exception',
        CUSTOMER: 'custrecord_p2p_dr_customer',
        SALES_REP: 'custrecord_p2p_dr_sales_rep',
        PROJECT: 'custrecord_p2p_dr_project',
        CLASS: 'custrecord_p2p_dr_class',
        CUSTOM_SEG_FIELD: 'custrecord_p2p_dr_cseg_field',
        CUSTOM_SEG_VALUES: 'custrecord_p2p_dr_cseg_values',
        PRIORITY: 'custrecord_dr_priority',  // verified: your account uses this (no p2p prefix)
        PATH: 'custrecord_p2p_dr_path',
        EFF_FROM: 'custrecord_p2p_dr_eff_from',
        EFF_TO: 'custrecord_p2p_dr_eff_to',
        ACTIVE: 'custrecord_p2p_dr_active'
    };

    // ===== APPROVAL PATH FIELDS =====
    const PATH_FIELDS = {
        CODE: 'custrecord_p2p_ap_code',
        DESCRIPTION: 'custrecord_p2p_ap_description',
        SLA_HOURS: 'custrecord_p2p_ap_sla_hours',
        ACTIVE: 'custrecord_p2p_ap_active',
        STEP_SUMMARY: 'custrecord_p2p_ap_step_summary'
    };

    // ===== PATH STEP FIELDS =====
    const STEP_FIELDS = {
        PATH: 'custrecord_p2p_ps_path',
        SEQUENCE: 'custrecord_p2p_ps_sequence',
        NAME: 'custrecord_p2p_ps_name',
        APPROVER_TYPE: 'custrecord_p2p_ps_approver_type',
        ROLE: 'custrecord_p2p_ps_role',
        EMPLOYEE: 'custrecord_p2p_ps_employee',
        MODE: 'custrecord_p2p_ps_exec_mode',
        REQUIRE_COMMENT: 'custrecord_p2p_ps_require_comment',
        SLA_HOURS: 'custrecord_p2p_ps_timeout_hours',
        ACTIVE: 'custrecord_ps_active'  // verified: your account uses this (no p2p prefix)
    };

    // ===== GLOBAL CONFIG FIELDS =====
    const CONFIG_FIELDS = {
        PRICE_VAR_PCT: 'custrecord_gc_price_var_pct',
        PRICE_VAR_AMT: 'custrecord_gc_price_var_amt',
        FX_TOLERANCE_PCT: 'custrecord_gc_fx_tolerance_pct',
        PO_THRESHOLD: 'custrecord_gc_po_threshold',
        REMINDER_1_HRS: 'custrecord_gc_reminder_1_hrs',
        REMINDER_2_HRS: 'custrecord_gc_reminder_2_hrs',
        ESCALATION_HRS: 'custrecord_gc_escalation_hrs',
        TOKEN_EXPIRY_HRS: 'custrecord_gc_token_expiry_hrs',
        MAX_DELEGATION_DAYS: 'custrecord_gc_max_delegation_days',
        AUTO_APPROVE_ENABLED: 'custrecord_gc_auto_approve_enabled',
        AUTO_APPROVE_THRESHOLD: 'custrecord_gc_auto_approve_threshold',
        NEW_VENDOR_DAYS: 'custrecord_gc_new_vendor_days',
        MIN_VB_ACCT_ANOM: 'custrecord_gc_min_vb_acct_anom',
        REAPPROVAL_MODE: 'custrecord_gc_reapproval_mode',
        REAPPROVAL_BODY: 'custrecord_gc_reapproval_body',
        REAPPROVAL_ITEM: 'custrecord_gc_reapproval_item',
        REAPPROVAL_EXPENSE: 'custrecord_gc_reapproval_expense',
        TEAMS_WEBHOOK: 'custrecord_gc_teams_webhook',
        SLACK_WEBHOOK: 'custrecord_gc_slack_webhook',
        BULK_LIMIT: 'custrecord_gc_bulk_limit',
        FALLBACK_PATH: 'custrecord_gc_fallback_path',
        FALLBACK_APPROVER: 'custrecord_gc_fallback_approver'
    };

    // ===== TASK FIELDS (unchanged) =====
    const TASK_FIELDS = {
        TRAN_TYPE: 'custrecord_p2p_at_tran_type',
        TRAN_ID: 'custrecord_p2p_at_tran_id',
        PATH: 'custrecord_p2p_at_path',           // NEW: links to path instead of rule
        PATH_STEP: 'custrecord_p2p_at_step',  // verified: your account uses this (not path_step)
        SEQUENCE: 'custrecord_p2p_at_sequence',
        APPROVER: 'custrecord_p2p_at_approver',
        ACTING_APPROVER: 'custrecord_p2p_at_acting_approver',
        STATUS: 'custrecord_p2p_at_status',
        CREATED: 'custrecord_p2p_at_created',
        COMPLETED: 'custrecord_p2p_at_completed',
        TOKEN: 'custrecord_p2p_at_token',
        TOKEN_EXPIRY: 'custrecord_p2p_at_token_expiry',
        REMINDER_COUNT: 'custrecord_p2p_at_reminder_count',
        ESCALATED: 'custrecord_p2p_at_escalated',
        // Legacy fields (for backward compat during migration)
        RULE_LEGACY: 'custrecord_p2p_at_rule',
        STEP_LEGACY: 'custrecord_p2p_at_step'
    };

    // ===== HISTORY FIELDS (unchanged) =====
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

    // ===== DELEGATION FIELDS (unchanged) =====
    const DELEGATION_FIELDS = {
        ORIGINAL: 'custrecord_p2p_del_original',
        DELEGATE: 'custrecord_p2p_del_delegate',
        START_DATE: 'custrecord_p2p_del_start_date',
        END_DATE: 'custrecord_p2p_del_end_date',
        SUBSIDIARY: 'custrecord_p2p_del_subsidiary',
        TRAN_TYPE: 'custrecord_p2p_del_tran_type',
        ACTIVE: 'custrecord_p2p_del_active'
    };

    // ===== TRANSACTION BODY FIELDS =====
    const BODY_FIELDS = {
        // Core workflow
        APPROVAL_STATUS: 'custbody_p2p_approval_status',
        CURRENT_STEP: 'custbody_p2p_current_step',
        CURRENT_APPROVER: 'custbody_p2p_current_approver',
        
        // New explainability fields
        MATCHED_RULE: 'custbody_p2p_matched_rule',
        APPROVAL_PATH: 'custbody_p2p_approval_path',
        MATCH_REASON: 'custbody_p2p_match_reason',
        
        // Matching (VB only)
        EXCEPTION_TYPE: 'custbody_p2p_exception_type',
        MATCH_STATUS: 'custbody_p2p_match_status',
        SUBMITTED_BY: 'custbody_p2p_submitted_by',
        
        // AI/Risk
        AI_RISK_SCORE: 'custbody_p2p_ai_risk_score',
        AI_RISK_FLAGS: 'custbody_p2p_ai_risk_flags',
        AI_RISK_SUMMARY: 'custbody_p2p_ai_risk_summary',
        AI_EXCEPTION_SUGGESTION: 'custbody_p2p_ai_exception_suggestion',
        
        // PO revision tracking
        REVISION_NUMBER: 'custbody_p2p_revision_number',
        
        // Legacy (for migration)
        APPROVAL_RULE_LEGACY: 'custbody_p2p_approval_rule'
    };

    // ===== DEFAULT CONFIG VALUES =====
    // Used when Global Config record not found
    const CONFIG_DEFAULTS = {
        PRICE_VAR_PCT: 5,
        PRICE_VAR_AMT: 500,
        FX_TOLERANCE_PCT: 3,
        PO_THRESHOLD: 1000,
        REMINDER_1_HRS: 24,
        REMINDER_2_HRS: 48,
        ESCALATION_HRS: 72,
        TOKEN_EXPIRY_HRS: 72,
        MAX_DELEGATION_DAYS: 30,
        BULK_LIMIT: 50,
        NEW_VENDOR_DAYS: 14,
        MIN_VB_ACCT_ANOM: 5,
        REAPPROVAL_MODE: 'material'
    };

    // ===== SCRIPTS =====
    const SCRIPTS = {
        EMAIL_APPROVAL_SL: 'customscript_p2p_email_approval_sl',
        EMAIL_APPROVAL_DEPLOY: 'customdeploy_p2p_email_approval',
        BULK_APPROVAL_SL: 'customscript_p2p_bulk_approval_sl',
        BULK_APPROVAL_DEPLOY: 'customdeploy_p2p_bulk_approval'
    };

    return {
        RECORD_TYPES,
        TRANSACTION_TYPES,
        TRANSACTION_TYPE_MAP,
        TRANSACTION_TYPE_REVERSE,
        APPROVAL_STATUS,
        APPROVAL_ACTION,
        APPROVER_TYPE,
        EXECUTION_MODE,
        TASK_STATUS,
        EXCEPTION_TYPE,
        MATCH_STATUS,
        APPROVAL_METHOD,
        DECISION_RULE_FIELDS,
        PATH_FIELDS,
        STEP_FIELDS,
        CONFIG_FIELDS,
        TASK_FIELDS,
        HISTORY_FIELDS,
        DELEGATION_FIELDS,
        BODY_FIELDS,
        CONFIG_DEFAULTS,
        SCRIPTS,
        NATIVE_APPROVAL_STATUS
    };
});
