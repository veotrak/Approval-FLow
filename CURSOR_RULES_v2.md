# NetSuite P2P Approval Workflow - Cursor Implementation Rules

> **Version 2.0** | Updated January 2026
> Aligned with P2P_Data_Dictionary_v2

## Project Overview

Complete Procure-to-Pay (P2P) approval workflow system for NetSuite with:
- Multi-dimensional approval routing (Subsidiary/Department/Location/Amount)
- Delegation with configurable date ranges and scopes
- Secure email approvals with tokenized links
- 3-way matching for Vendor Bills (PO → Receipt → Invoice)
- AI-powered risk scoring with configurable thresholds
- Multi-currency support with FX tolerance handling
- Full audit trail with immutable history

---

## 1. Custom Lists (8 Total)

Static values - changes require developer intervention.

### 1.1 P2P Approval Status
```
Script ID: customlist_p2p_approval_status
Values:
  1: Pending Submission (_pending_submission)
  2: Pending Approval (_pending_approval)
  3: Approved (_approved)
  4: Rejected (_rejected)
  5: Recalled (_recalled)
  6: Escalated (_escalated)
  7: Pending Exception Review (_pending_exception)
```

### 1.2 P2P Match Status
```
Script ID: customlist_p2p_match_status
Values:
  1: Not Matched (_not_matched)
  2: Matched (_matched)
  3: Partial Match (_partial_match)
  4: Price Variance (_price_variance)
  5: Quantity Variance (_qty_variance)
  6: PO Not Found (_po_not_found)
  7: Receipt Missing (_receipt_missing)
  8: Exception Overridden (_exception_overridden)
```

### 1.3 P2P Approval Action
```
Script ID: customlist_p2p_approval_action
Values:
  1: Submitted (_submitted)
  2: Approved (_approved)
  3: Rejected (_rejected)
  4: Delegated (_delegated)
  5: Escalated (_escalated)
  6: Recalled (_recalled)
  7: Reassigned (_reassigned)
  8: Comment Added (_comment)
  9: Exception Override (_exception_override)
  10: Resubmitted (_resubmitted)
```

### 1.4 P2P Approver Type
```
Script ID: customlist_p2p_approver_type
Values:
  1: Specific Employee (_specific_employee)
  2: Supervisor (_supervisor)
  3: Department Manager (_dept_manager)
  4: Subsidiary Manager (_sub_manager)
  5: Role (_role)
  6: Custom Field (_custom_field)
  7: Script (_script)
```

### 1.5 P2P Execution Mode
```
Script ID: customlist_p2p_execution_mode
Values:
  1: Serial (_serial)
  2: Parallel (_parallel)
  3: Parallel Any (_parallel_any)
```

### 1.6 P2P Task Status
```
Script ID: customlist_p2p_task_status
Values:
  1: Pending (_pending)
  2: Approved (_approved)
  3: Rejected (_rejected)
  4: Delegated (_delegated)
  5: Escalated (_escalated)
  6: Cancelled (_cancelled)
  7: Expired (_expired)
```

### 1.7 P2P Transaction Type
```
Script ID: customlist_p2p_tran_type
Values:
  1: Purchase Order (_purchase_order)
  2: Vendor Bill (_vendor_bill)
```

### 1.8 P2P Email Template Type
```
Script ID: customlist_p2p_email_type
Values:
  1: Approval Request (_approval_request)
  2: Reminder (_reminder)
  3: Approved (_approved)
  4: Rejected (_rejected)
  5: Escalated (_escalated)
```

---

## 2. Transaction Body Fields (12 Total)

Custom fields on Purchase Order and Vendor Bill.

### Field Definitions

| Field ID | Label | Type | Applies To | Notes |
|----------|-------|------|------------|-------|
| `custbody_p2p_approval_status` | P2P Approval Status | List (customlist_p2p_approval_status) | PO, VB | Default: 1 (Pending Submission) |
| `custbody_p2p_current_step` | P2P Current Step | Integer | PO, VB | Default: 0 |
| `custbody_p2p_current_approver` | P2P Current Approver | List/Record (Employee) | PO, VB | May differ if delegated |
| `custbody_p2p_approval_rule` | P2P Approval Rule | List/Record (customrecord_p2p_approval_rule) | PO, VB | Rule matched on submit |
| `custbody_p2p_exception_type` | P2P Exception Type | List/Record (customrecord_p2p_exception_type) | VB only | Matching exception detected |
| `custbody_p2p_match_status` | P2P Match Status | List (customlist_p2p_match_status) | VB only | Default: 1 (Not Matched) |
| `custbody_p2p_ai_risk_score` | P2P AI Risk Score | Decimal (2) | PO, VB | Score 0-100 |
| `custbody_p2p_risk_level` | P2P Risk Level | List/Record (customrecord_p2p_risk_level) | PO, VB | Calculated from score |
| `custbody_p2p_ai_risk_flags` | P2P AI Risk Flags | Text Area | PO, VB | JSON array of flags |
| `custbody_p2p_submitted_by` | P2P Submitted By | List/Record (Employee) | PO, VB | For recall permissions |
| `custbody_p2p_submitted_date` | P2P Submitted Date | Date/Time | PO, VB | SLA tracking |
| `custbody_p2p_final_approver` | P2P Final Approver | List/Record (Employee) | PO, VB | Set when fully approved |

### Multi-Currency Fields (NEW)

| Field ID | Label | Type | Applies To | Notes |
|----------|-------|------|------------|-------|
| `custbody_p2p_orig_currency` | P2P Original Currency | List/Record (Currency) | PO, VB | Transaction currency at submission |
| `custbody_p2p_base_amount` | P2P Base Amount | Currency | PO, VB | Amount in subsidiary base currency |
| `custbody_p2p_exchange_rate` | P2P Exchange Rate | Decimal (6) | PO, VB | Rate at submission time |

---

## 3. Item Sublist Fields (6 Total)

Custom columns on Vendor Bill Item sublist for 3-way matching.

| Field ID | Label | Type | Notes |
|----------|-------|------|-------|
| `custcol_p2p_po_link` | Linked PO | Transaction | PO linked for matching |
| `custcol_p2p_po_rate` | PO Rate | Currency | Unit price from linked PO |
| `custcol_p2p_po_qty` | PO Quantity | Decimal | Quantity on PO |
| `custcol_p2p_qty_received` | Qty Received | Decimal | From Item Receipt |
| `custcol_p2p_variance_amt` | Variance Amount | Currency | (Invoice - PO) × Qty |
| `custcol_p2p_exception_reason` | Exception Reason | Text | Override explanation |

---

## 4. Custom Records - Core Workflow (5 Total)

### 4.1 P2P Approval Rule
```
Script ID: customrecord_p2p_approval_rule
Purpose: Routing rules based on subsidiary, department, location, amount

Fields:
  - name (Text): Rule name
  - custrecord_p2p_rule_tran_type (List): PO or VB
  - custrecord_p2p_rule_subsidiary (List/Record): Subsidiary filter
  - custrecord_p2p_rule_dept (List/Record): Department filter
  - custrecord_p2p_rule_dept_group (List/Record): Department group
  - custrecord_p2p_rule_loc (List/Record): Location filter
  - custrecord_p2p_rule_loc_group (List/Record): Location group
  - custrecord_p2p_rule_amt_from (Currency): Min amount
  - custrecord_p2p_rule_amt_to (Currency): Max amount
  - custrecord_p2p_rule_priority (Integer): Lower = higher priority
  - custrecord_p2p_rule_effective_from (Date): Start date
  - custrecord_p2p_rule_effective_to (Date): End date
  - isinactive (Checkbox)
```

### 4.2 P2P Approval Step
```
Script ID: customrecord_p2p_approval_step
Purpose: Individual step within a rule

Fields:
  - custrecord_p2p_step_rule (List/Record): Parent rule
  - custrecord_p2p_step_sequence (Integer): Step order (1, 2, 3...)
  - custrecord_p2p_step_approver_type (List): How to determine approver
  - custrecord_p2p_step_approver (Employee): Specific employee
  - custrecord_p2p_step_role (Role): Role if type = Role
  - custrecord_p2p_step_exec_mode (List): Serial/Parallel/Parallel Any
  - custrecord_p2p_step_comment_req (Checkbox): Require comment on reject
  - custrecord_p2p_step_timeout_hrs (Integer): Hours before escalation
```

### 4.3 P2P Delegation
```
Script ID: customrecord_p2p_delegation
Purpose: Temporary delegation of approval authority

Fields:
  - custrecord_p2p_del_delegator (Employee): Delegating employee
  - custrecord_p2p_del_delegate (Employee): Receiving employee
  - custrecord_p2p_del_start_date (Date): Start
  - custrecord_p2p_del_end_date (Date): End
  - custrecord_p2p_del_scope (List/Record): Delegation scope
  - custrecord_p2p_del_subsidiary (List/Record): If scope requires
  - isinactive (Checkbox)
```

### 4.4 P2P Approval Task
```
Script ID: customrecord_p2p_approval_task
Purpose: Individual task assigned to an approver

Fields:
  - custrecord_p2p_task_tran_type (List): PO or VB
  - custrecord_p2p_task_tran_id (Integer): Transaction internal ID
  - custrecord_p2p_task_step (Integer): Step number
  - custrecord_p2p_task_approver (Employee): Original approver
  - custrecord_p2p_task_acting (Employee): Acting approver (if delegated)
  - custrecord_p2p_task_status (List): Current status
  - custrecord_p2p_task_created (Date/Time): Created timestamp
  - custrecord_p2p_task_completed (Date/Time): Completed timestamp
  - custrecord_p2p_task_token (Text): Email approval token
  - custrecord_p2p_task_token_exp (Date/Time): Token expiration
  - custrecord_p2p_task_comment (Text Area): Approver comment
```

### 4.5 P2P Approval History
```
Script ID: customrecord_p2p_approval_history
Purpose: Immutable audit log

Fields:
  - custrecord_p2p_hist_tran_type (List): PO or VB
  - custrecord_p2p_hist_tran_id (Integer): Transaction internal ID
  - custrecord_p2p_hist_action (List): Action taken
  - custrecord_p2p_hist_user (Employee): Who performed action
  - custrecord_p2p_hist_timestamp (Date/Time): When
  - custrecord_p2p_hist_step (Integer): Step number at action time
  - custrecord_p2p_hist_old_status (List): Status before
  - custrecord_p2p_hist_new_status (List): Status after
  - custrecord_p2p_hist_comment (Text Area): Comment
  - custrecord_p2p_hist_ip_address (Text): IP for email approvals
  - custrecord_p2p_hist_delegate (Employee): Original if delegated
```

---

## 5. Custom Records - Configuration (6 Total)

Administrator-configurable records.

### 5.1 P2P Exception Type
```
Script ID: customrecord_p2p_exception_type
Purpose: Configurable exception types with tolerances

Fields:
  - name (Text): Exception name
  - custrecord_p2p_exctype_code (Text): Script reference code
  - custrecord_p2p_exctype_tolerance_pct (Percent): % tolerance
  - custrecord_p2p_exctype_tolerance_amt (Currency): $ tolerance
  - custrecord_p2p_exctype_requires_override (Checkbox)
  - custrecord_p2p_exctype_override_role (Role): Required role
  - custrecord_p2p_exctype_severity (Integer): 1-5
  - custrecord_p2p_exctype_description (Text Area)
  - isinactive (Checkbox)

Default Records:
  - NONE, PRICE_OVER (5%, $500), QTY_OVER, QTY_UNDER
  - MISSING_PO, MISSING_RECEIPT, DUPLICATE
  - VENDOR_MISMATCH, CURRENCY_MISMATCH, MULTIPLE
```

### 5.2 P2P Risk Level
```
Script ID: customrecord_p2p_risk_level
Purpose: Configurable risk score ranges

Fields:
  - name (Text): Level name
  - custrecord_p2p_risk_code (Text): Script reference
  - custrecord_p2p_risk_score_from (Integer): Range start
  - custrecord_p2p_risk_score_to (Integer): Range end
  - custrecord_p2p_risk_badge_color (Text): UI color hex
  - custrecord_p2p_risk_add_step (Checkbox): Add extra step?
  - custrecord_p2p_risk_escalate_to (Role): Escalation role
  - custrecord_p2p_risk_require_comment (Checkbox)
  - custrecord_p2p_risk_description (Text Area)
  - isinactive (Checkbox)

Default Records:
  - Low (0-30, #4CAF50)
  - Medium (31-60, #FF9800)
  - High (61-80, #FF5722, add step → Finance Director)
  - Critical (81-100, #F44336, add step → CFO)
```

### 5.3 P2P Delegation Scope
```
Script ID: customrecord_p2p_delegation_scope
Purpose: Configurable delegation scopes

Fields:
  - name (Text): Scope name
  - custrecord_p2p_scope_code (Text): Script reference
  - custrecord_p2p_scope_include_po (Checkbox)
  - custrecord_p2p_scope_include_vb (Checkbox)
  - custrecord_p2p_scope_require_sub (Checkbox)
  - custrecord_p2p_scope_description (Text Area)
  - isinactive (Checkbox)

Default Records:
  - ALL (PO+VB), PO_ONLY, VB_ONLY, SUBSIDIARY (requires sub)
```

### 5.4 P2P Matching Configuration
```
Script ID: customrecord_p2p_matching_config
Purpose: Per-subsidiary tolerance settings

Fields:
  - name (Text): Config name
  - custrecord_p2p_match_subsidiary (List/Record): Subsidiary
  - custrecord_p2p_match_price_var_pct (Percent): Price % tolerance (default 5%)
  - custrecord_p2p_match_price_var_amt (Currency): Price $ tolerance (default $500)
  - custrecord_p2p_match_qty_tolerance (Decimal): Qty tolerance (default 0)
  - custrecord_p2p_match_po_threshold (Currency): PO required above (default $1000)
  - custrecord_p2p_match_require_receipt (Checkbox): Require receipt for inventory
  - custrecord_p2p_match_check_duplicate (Checkbox): Check duplicate invoices
  - custrecord_p2p_match_fx_tolerance_pct (Percent): FX variance tolerance (NEW)
  - isinactive (Checkbox)
```

### 5.5 P2P Notification Configuration
```
Script ID: customrecord_p2p_notification_config
Purpose: Configurable notification timing

Fields:
  - name (Text): Config name
  - custrecord_p2p_notif_subsidiary (List/Record): Subsidiary
  - custrecord_p2p_notif_remind_1_hrs (Integer): 1st reminder (default 24)
  - custrecord_p2p_notif_remind_2_hrs (Integer): 2nd reminder (default 48)
  - custrecord_p2p_notif_escalate_hrs (Integer): Escalation (default 72)
  - custrecord_p2p_notif_token_exp_hrs (Integer): Token expiry (default 72)
  - custrecord_p2p_notif_max_deleg_days (Integer): Max delegation (default 30)
  - isinactive (Checkbox)
```

### 5.6 P2P Email Template
```
Script ID: customrecord_p2p_email_template
Purpose: Customizable email content

Fields:
  - name (Text): Template name
  - custrecord_p2p_email_type (List): Template type
  - custrecord_p2p_email_tran_type (List): PO, VB, or Both
  - custrecord_p2p_email_subject (Text): Subject with merge fields
  - custrecord_p2p_email_body (Text Area): HTML body
  - custrecord_p2p_email_include_link (Checkbox): Include action links
  - custrecord_p2p_email_include_pdf (Checkbox): Attach transaction PDF
  - isinactive (Checkbox)

Merge Fields:
  ${TRAN_TYPE}, ${TRAN_NUM}, ${TRAN_DATE}, ${VENDOR}, ${AMOUNT}
  ${SUBMITTER}, ${APPROVER}, ${APPROVE_URL}, ${REJECT_URL}, ${VIEW_URL}
  ${STEP_NUM}, ${TOTAL_STEPS}, ${COMMENT}, ${CURRENCY}, ${BASE_AMOUNT}
```

---

## 6. Custom Records - Grouping (4 Total)

### 6.1 P2P Department Group
```
Script ID: customrecord_p2p_dept_group
Fields:
  - name (Text): Group name
  - custrecord_p2p_deptgrp_desc (Text Area)
  - isinactive (Checkbox)
```

### 6.2 P2P Department Group Member
```
Script ID: customrecord_p2p_dept_group_member
Fields:
  - custrecord_p2p_deptmem_group (List/Record): Parent group
  - custrecord_p2p_deptmem_dept (List/Record): Department
```

### 6.3 P2P Location Group
```
Script ID: customrecord_p2p_loc_group
Fields:
  - name (Text): Group name
  - custrecord_p2p_locgrp_desc (Text Area)
  - isinactive (Checkbox)
```

### 6.4 P2P Location Group Member
```
Script ID: customrecord_p2p_loc_group_member
Fields:
  - custrecord_p2p_locmem_group (List/Record): Parent group
  - custrecord_p2p_locmem_loc (List/Record): Location
```

---

## 7. Script Inventory

### 7.1 User Event Scripts

| Script | File | Deployed To | Purpose |
|--------|------|-------------|---------|
| customscript_p2p_po_ue | p2p_po_ue.js | Purchase Order | Buttons, workflow trigger, validation |
| customscript_p2p_vb_ue | p2p_vb_ue.js | Vendor Bill | Same + 3-way matching |

### 7.2 Client Scripts

| Script | File | Deployed To | Purpose |
|--------|------|-------------|---------|
| customscript_p2p_po_cs | p2p_po_cs.js | Purchase Order | Submit, Approve, Reject, Recall |
| customscript_p2p_vb_cs | p2p_vb_cs.js | Vendor Bill | Same + Exception Override |

### 7.3 Suitelets

| Script | File | Purpose |
|--------|------|---------|
| customscript_p2p_email_sl | p2p_email_approval_sl.js | One-click email approve/reject |
| customscript_p2p_bulk_sl | p2p_bulk_approval_sl.js | Bulk approval UI |
| customscript_p2p_deleg_sl | p2p_delegation_sl.js | Self-service delegation |

### 7.4 Scheduled Scripts

| Script | File | Schedule | Purpose |
|--------|------|----------|---------|
| customscript_p2p_remind_ss | p2p_reminder_ss.js | Every 4 hours | Send reminders |
| customscript_p2p_escal_ss | p2p_escalation_ss.js | Every 4 hours | Escalate overdue |

### 7.5 Library Modules

| Module | Purpose |
|--------|---------|
| p2p_constants.js | Static list values, field IDs, record types |
| p2p_config_loader.js | Load configuration records |
| p2p_approval_engine.js | Core routing, rule matching, task creation |
| p2p_delegation_manager.js | Find active delegations, resolve approvers |
| p2p_matching_engine.js | 3-way matching with config tolerances |
| p2p_notification_manager.js | Send emails using templates |
| p2p_history_logger.js | Create audit trail records |
| p2p_token_manager.js | Generate/validate email tokens |
| p2p_currency_utils.js | Multi-currency conversion utilities (NEW) |

---

## 8. Constants Module Reference

```javascript
// p2p_constants.js

define([], function() {
    
    return {
        // Custom Lists
        LIST: {
            APPROVAL_STATUS: 'customlist_p2p_approval_status',
            MATCH_STATUS: 'customlist_p2p_match_status',
            APPROVAL_ACTION: 'customlist_p2p_approval_action',
            APPROVER_TYPE: 'customlist_p2p_approver_type',
            EXECUTION_MODE: 'customlist_p2p_execution_mode',
            TASK_STATUS: 'customlist_p2p_task_status',
            TRAN_TYPE: 'customlist_p2p_tran_type',
            EMAIL_TYPE: 'customlist_p2p_email_type'
        },
        
        // Approval Status Values
        APPROVAL_STATUS: {
            PENDING_SUBMISSION: '1',
            PENDING_APPROVAL: '2',
            APPROVED: '3',
            REJECTED: '4',
            RECALLED: '5',
            ESCALATED: '6',
            PENDING_EXCEPTION: '7'
        },
        
        // Match Status Values
        MATCH_STATUS: {
            NOT_MATCHED: '1',
            MATCHED: '2',
            PARTIAL_MATCH: '3',
            PRICE_VARIANCE: '4',
            QTY_VARIANCE: '5',
            PO_NOT_FOUND: '6',
            RECEIPT_MISSING: '7',
            EXCEPTION_OVERRIDDEN: '8'
        },
        
        // Approval Action Values
        APPROVAL_ACTION: {
            SUBMITTED: '1',
            APPROVED: '2',
            REJECTED: '3',
            DELEGATED: '4',
            ESCALATED: '5',
            RECALLED: '6',
            REASSIGNED: '7',
            COMMENT: '8',
            EXCEPTION_OVERRIDE: '9',
            RESUBMITTED: '10'
        },
        
        // Approver Type Values
        APPROVER_TYPE: {
            SPECIFIC_EMPLOYEE: '1',
            SUPERVISOR: '2',
            DEPT_MANAGER: '3',
            SUB_MANAGER: '4',
            ROLE: '5',
            CUSTOM_FIELD: '6',
            SCRIPT: '7'
        },
        
        // Execution Mode Values
        EXECUTION_MODE: {
            SERIAL: '1',
            PARALLEL: '2',
            PARALLEL_ANY: '3'
        },
        
        // Task Status Values
        TASK_STATUS: {
            PENDING: '1',
            APPROVED: '2',
            REJECTED: '3',
            DELEGATED: '4',
            ESCALATED: '5',
            CANCELLED: '6',
            EXPIRED: '7'
        },
        
        // Transaction Type Values
        TRAN_TYPE: {
            PURCHASE_ORDER: '1',
            VENDOR_BILL: '2'
        },
        
        // Custom Records
        RECORD: {
            APPROVAL_RULE: 'customrecord_p2p_approval_rule',
            APPROVAL_STEP: 'customrecord_p2p_approval_step',
            DELEGATION: 'customrecord_p2p_delegation',
            APPROVAL_TASK: 'customrecord_p2p_approval_task',
            APPROVAL_HISTORY: 'customrecord_p2p_approval_history',
            EXCEPTION_TYPE: 'customrecord_p2p_exception_type',
            RISK_LEVEL: 'customrecord_p2p_risk_level',
            DELEGATION_SCOPE: 'customrecord_p2p_delegation_scope',
            MATCHING_CONFIG: 'customrecord_p2p_matching_config',
            NOTIFICATION_CONFIG: 'customrecord_p2p_notification_config',
            EMAIL_TEMPLATE: 'customrecord_p2p_email_template',
            DEPT_GROUP: 'customrecord_p2p_dept_group',
            DEPT_GROUP_MEMBER: 'customrecord_p2p_dept_group_member',
            LOC_GROUP: 'customrecord_p2p_loc_group',
            LOC_GROUP_MEMBER: 'customrecord_p2p_loc_group_member'
        },
        
        // Transaction Body Fields
        FIELD: {
            APPROVAL_STATUS: 'custbody_p2p_approval_status',
            CURRENT_STEP: 'custbody_p2p_current_step',
            CURRENT_APPROVER: 'custbody_p2p_current_approver',
            APPROVAL_RULE: 'custbody_p2p_approval_rule',
            EXCEPTION_TYPE: 'custbody_p2p_exception_type',
            MATCH_STATUS: 'custbody_p2p_match_status',
            AI_RISK_SCORE: 'custbody_p2p_ai_risk_score',
            RISK_LEVEL: 'custbody_p2p_risk_level',
            AI_RISK_FLAGS: 'custbody_p2p_ai_risk_flags',
            SUBMITTED_BY: 'custbody_p2p_submitted_by',
            SUBMITTED_DATE: 'custbody_p2p_submitted_date',
            FINAL_APPROVER: 'custbody_p2p_final_approver',
            ORIG_CURRENCY: 'custbody_p2p_orig_currency',
            BASE_AMOUNT: 'custbody_p2p_base_amount',
            EXCHANGE_RATE: 'custbody_p2p_exchange_rate'
        },
        
        // Item Sublist Columns
        COLUMN: {
            PO_LINK: 'custcol_p2p_po_link',
            PO_RATE: 'custcol_p2p_po_rate',
            PO_QTY: 'custcol_p2p_po_qty',
            QTY_RECEIVED: 'custcol_p2p_qty_received',
            VARIANCE_AMT: 'custcol_p2p_variance_amt',
            EXCEPTION_REASON: 'custcol_p2p_exception_reason'
        }
    };
});
```

---

## 9. Rule Matching Algorithm

```javascript
/**
 * Find matching approval rule for a transaction
 * @param {Object} params - {tranType, subsidiary, department, location, amount}
 * @returns {Object} Matched rule or null
 */
function findMatchingRule(params) {
    var filters = [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_p2p_rule_tran_type', 'anyof', params.tranType],
        'AND',
        [
            ['custrecord_p2p_rule_effective_from', 'isempty', ''],
            'OR',
            ['custrecord_p2p_rule_effective_from', 'onorbefore', 'today']
        ],
        'AND',
        [
            ['custrecord_p2p_rule_effective_to', 'isempty', ''],
            'OR',
            ['custrecord_p2p_rule_effective_to', 'onorafter', 'today']
        ]
    ];
    
    // Add subsidiary filter
    if (params.subsidiary) {
        filters.push('AND');
        filters.push([
            ['custrecord_p2p_rule_subsidiary', 'isempty', ''],
            'OR',
            ['custrecord_p2p_rule_subsidiary', 'anyof', params.subsidiary]
        ]);
    }
    
    // Add amount filter
    if (params.amount) {
        filters.push('AND');
        filters.push([
            ['custrecord_p2p_rule_amt_from', 'isempty', ''],
            'OR',
            ['custrecord_p2p_rule_amt_from', 'lessthanorequalto', params.amount]
        ]);
        filters.push('AND');
        filters.push([
            ['custrecord_p2p_rule_amt_to', 'isempty', ''],
            'OR',
            ['custrecord_p2p_rule_amt_to', 'greaterthanorequalto', params.amount]
        ]);
    }
    
    // Search and sort by priority
    var search = N.search.create({
        type: 'customrecord_p2p_approval_rule',
        filters: filters,
        columns: [
            N.search.createColumn({ name: 'custrecord_p2p_rule_priority', sort: N.search.Sort.ASC }),
            'name',
            'custrecord_p2p_rule_dept',
            'custrecord_p2p_rule_dept_group',
            'custrecord_p2p_rule_loc',
            'custrecord_p2p_rule_loc_group'
        ]
    });
    
    // Check department/location matching
    var result = null;
    search.run().each(function(row) {
        if (matchesDeptLoc(row, params)) {
            result = {
                id: row.id,
                name: row.getValue('name'),
                priority: row.getValue('custrecord_p2p_rule_priority')
            };
            return false; // Stop at first match (lowest priority number)
        }
        return true;
    });
    
    return result;
}
```

---

## 10. Test Cases

### TC-001: Basic PO Approval
```
Given: PO $5,000, IT Department, US Subsidiary
When: User clicks "Submit for Approval"
Then:
  - Status changes to "Pending Approval"
  - Matching rule found based on criteria
  - Task created for first approver
  - Email sent with approve/reject links
  - History record created
```

### TC-002: Multi-Step Approval
```
Given: PO $50,000 requiring 2-step approval
When: First approver approves
Then:
  - Task status = Approved
  - Current step = 2
  - New task created for second approver
  - Email sent to second approver
```

### TC-003: Delegation
```
Given: Active delegation from User A to User B
When: Task assigned to User A
Then:
  - Task.approver = User A
  - Task.acting = User B
  - Email sent to User B
```

### TC-004: 3-Way Matching Pass
```
Given: VB linked to PO, receipt exists
When: Matching runs
       VB rate = $100, PO rate = $102 (2% variance)
       Config tolerance = 5%
Then:
  - Match status = "Matched"
  - No exception created
```

### TC-005: 3-Way Matching Fail
```
Given: VB linked to PO
When: VB rate = $120, PO rate = $100 (20% variance)
       Config tolerance = 5%
Then:
  - Match status = "Price Variance"
  - Exception type = "PRICE_OVER"
  - Approval status = "Pending Exception Review"
```

### TC-006: Email Approval
```
Given: Valid token in email link
When: User clicks approve link
Then:
  - Token validated
  - Task approved
  - History logged with IP address
  - Token invalidated
```

### TC-007: High Risk Escalation
```
Given: AI risk score = 85 (Critical)
When: Transaction submitted
Then:
  - Risk level record matched (Critical)
  - Additional approval step added
  - CFO added as approver
```

### TC-008: Recall
```
Given: PO in "Pending Approval" status
When: Submitter clicks "Recall"
Then:
  - Status = "Recalled"
  - All pending tasks cancelled
  - History logged
```

### TC-009: Rejection with Resubmit
```
Given: Rejected PO
When: User modifies and clicks "Resubmit"
Then:
  - Status = "Pending Approval"
  - New rule matching performed
  - Action logged as "Resubmitted"
```

### TC-010: Escalation Timeout
```
Given: Task pending > 72 hours
When: Scheduled script runs
Then:
  - Task escalated to supervisor
  - Status = "Escalated"
  - Notification sent
```

### TC-011: Multi-Currency Handling
```
Given: PO in EUR, subsidiary base = USD
       Amount = €10,000, Rate = 1.08
When: Submitted for approval
Then:
  - custbody_p2p_orig_currency = EUR
  - custbody_p2p_exchange_rate = 1.08
  - custbody_p2p_base_amount = $10,800
  - Rule matching uses base amount
```

### TC-012: FX Variance in Matching
```
Given: PO amount €10,000 at rate 1.08 = $10,800
       VB amount €10,000 at rate 1.12 = $11,200
       FX tolerance = 5%
When: Matching runs
Then:
  - FX variance = 3.7% (within tolerance)
  - Match status = "Matched"
```

---

## 11. Summary

### Object Counts (v2)

| Type | Count |
|------|-------|
| Custom Lists | 8 |
| Transaction Body Fields | 12 (+3 multi-currency = 15) |
| Item Sublist Fields | 6 |
| Custom Records - Core | 5 |
| Custom Records - Config | 6 |
| Custom Records - Grouping | 4 |
| **TOTAL** | **44** |

### Scripts

| Type | Count |
|------|-------|
| User Event | 2 |
| Client | 2 |
| Suitelet | 3 |
| Scheduled | 2 |
| Library Modules | 9 |
| **TOTAL SCRIPTS** | **18** |

---

*End of CURSOR_RULES v2.0*
