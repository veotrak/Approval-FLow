# NetSuite P2P Approval System - Cursor Implementation Guide

## AI Instructions

You are building a complete NetSuite Procure-to-Pay (P2P) approval workflow system. Follow these specifications exactly. Generate all files in the project structure below. Use SuiteScript 2.1 for all scripts.

---

## Project Overview

**Goal**: Build an approval routing system for Purchase Orders and Vendor Bills with:
- Multi-dimensional approval matrix with wildcards and priority
- Multi-step serial/parallel approvals
- Delegation with date ranges
- Secure email approvals with tokens
- 3-way matching for Vendor Bills
- Full audit history
- AI-powered risk flagging (optional)

**Technology Stack**:
- NetSuite SuiteScript 2.1
- SDF (SuiteCloud Development Framework)
- Custom Records for configuration
- SuiteFlow for basic state management

---

## Project Structure

Create all these files:

```
netsuite-p2p-approvals/
├── src/
│   ├── FileCabinet/
│   │   └── SuiteScripts/
│   │       └── p2p_approvals/
│   │           ├── constants/
│   │           │   └── p2p_constants.js
│   │           ├── lib/
│   │           │   ├── p2p_approval_engine.js
│   │           │   ├── p2p_delegation_manager.js
│   │           │   ├── p2p_matching_engine.js
│   │           │   ├── p2p_notification_manager.js
│   │           │   ├── p2p_history_logger.js
│   │           │   └── p2p_token_manager.js
│   │           ├── user_event/
│   │           │   ├── p2p_po_ue.js
│   │           │   └── p2p_vb_ue.js
│   │           ├── client/
│   │           │   ├── p2p_po_cs.js
│   │           │   └── p2p_vb_cs.js
│   │           ├── suitelet/
│   │           │   ├── p2p_email_approval_sl.js
│   │           │   ├── p2p_bulk_approval_sl.js
│   │           │   └── p2p_delegation_sl.js
│   │           ├── scheduled/
│   │           │   ├── p2p_reminder_ss.js
│   │           │   └── p2p_escalation_ss.js
│   │           ├── map_reduce/
│   │           │   └── p2p_bulk_process_mr.js
│   │           └── restlet/
│   │               └── p2p_ai_integration_rl.js
│   └── Objects/
│       ├── Records/
│       │   ├── customrecord_p2p_approval_rule.xml
│       │   ├── customrecord_p2p_approval_step.xml
│       │   ├── customrecord_p2p_delegation.xml
│       │   ├── customrecord_p2p_approval_task.xml
│       │   ├── customrecord_p2p_approval_history.xml
│       │   ├── customrecord_p2p_dept_group.xml
│       │   ├── customrecord_p2p_dept_group_member.xml
│       │   ├── customrecord_p2p_loc_group.xml
│       │   └── customrecord_p2p_loc_group_member.xml
│       ├── Lists/
│       │   ├── customlist_p2p_approval_status.xml
│       │   ├── customlist_p2p_approval_action.xml
│       │   ├── customlist_p2p_approver_type.xml
│       │   ├── customlist_p2p_execution_mode.xml
│       │   ├── customlist_p2p_task_status.xml
│       │   ├── customlist_p2p_exception_type.xml
│       │   └── customlist_p2p_match_status.xml
│       ├── Fields/
│       │   └── transaction_body_fields.xml
│       ├── Scripts/
│       │   └── script_deployments.xml
│       └── Searches/
│           └── saved_searches.xml
├── deploy.xml
├── manifest.xml
└── README.md
```

---

## PART 1: Custom Lists (Create First - Dependencies)

### customlist_p2p_approval_status.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_approval_status">
  <name>P2P Approval Status</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Draft</value></customvalue>
    <customvalue scriptid="val_2"><value>Pending Approval</value></customvalue>
    <customvalue scriptid="val_3"><value>Approved</value></customvalue>
    <customvalue scriptid="val_4"><value>Rejected</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_approval_action.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_approval_action">
  <name>P2P Approval Action</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Approve</value></customvalue>
    <customvalue scriptid="val_2"><value>Reject</value></customvalue>
    <customvalue scriptid="val_3"><value>Reassign</value></customvalue>
    <customvalue scriptid="val_4"><value>Escalate</value></customvalue>
    <customvalue scriptid="val_5"><value>Submit</value></customvalue>
    <customvalue scriptid="val_6"><value>Resubmit</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_approver_type.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_approver_type">
  <name>P2P Approver Type</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Role</value></customvalue>
    <customvalue scriptid="val_2"><value>Named Person</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_execution_mode.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_execution_mode">
  <name>P2P Execution Mode</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Serial</value></customvalue>
    <customvalue scriptid="val_2"><value>Parallel</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_task_status.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_task_status">
  <name>P2P Task Status</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Pending</value></customvalue>
    <customvalue scriptid="val_2"><value>Approved</value></customvalue>
    <customvalue scriptid="val_3"><value>Rejected</value></customvalue>
    <customvalue scriptid="val_4"><value>Reassigned</value></customvalue>
    <customvalue scriptid="val_5"><value>Escalated</value></customvalue>
    <customvalue scriptid="val_6"><value>Cancelled</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_exception_type.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_exception_type">
  <name>P2P Exception Type</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Missing PO Link</value></customvalue>
    <customvalue scriptid="val_2"><value>Variance Over Limit</value></customvalue>
    <customvalue scriptid="val_3"><value>Missing Receipt</value></customvalue>
    <customvalue scriptid="val_4"><value>Multiple Exceptions</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_match_status.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_match_status">
  <name>P2P Match Status</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Not Checked</value></customvalue>
    <customvalue scriptid="val_2"><value>Pass</value></customvalue>
    <customvalue scriptid="val_3"><value>Fail</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_tran_type.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_tran_type">
  <name>P2P Transaction Type</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>Purchase Order</value></customvalue>
    <customvalue scriptid="val_2"><value>Vendor Bill</value></customvalue>
  </customvalues>
</customlist>
```

### customlist_p2p_approval_method.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<customlist scriptid="customlist_p2p_approval_method">
  <name>P2P Approval Method</name>
  <customvalues>
    <customvalue scriptid="val_1"><value>UI</value></customvalue>
    <customvalue scriptid="val_2"><value>Email</value></customvalue>
    <customvalue scriptid="val_3"><value>Bulk</value></customvalue>
    <customvalue scriptid="val_4"><value>API</value></customvalue>
  </customvalues>
</customlist>
```

---

## PART 2: Custom Records

### customrecord_p2p_approval_rule.xml

**Purpose**: Stores approval routing rules with matrix conditions

**Fields**:
| Field ID | Label | Type | Required | Notes |
|----------|-------|------|----------|-------|
| custrecord_p2p_ar_tran_type | Transaction Type | List (customlist_p2p_tran_type) | Yes | PO or VB |
| custrecord_p2p_ar_subsidiary | Subsidiary | List (Subsidiary) | Yes | |
| custrecord_p2p_ar_amount_from | Amount From | Currency | Yes | Lower bound |
| custrecord_p2p_ar_amount_to | Amount To | Currency | Yes | Upper bound |
| custrecord_p2p_ar_currency | Currency | List (Currency) | No | Blank = Any |
| custrecord_p2p_ar_department | Department | List (Department) | No | Blank = Any |
| custrecord_p2p_ar_location | Location | List (Location) | No | Blank = Any |
| custrecord_p2p_ar_dept_group | Department Group | List (customrecord_p2p_dept_group) | No | |
| custrecord_p2p_ar_loc_group | Location Group | List (customrecord_p2p_loc_group) | No | |
| custrecord_p2p_ar_priority | Priority | Integer | Yes | Higher wins |
| custrecord_p2p_ar_effective_from | Effective From | Date | Yes | |
| custrecord_p2p_ar_effective_to | Effective To | Date | No | Blank = No end |
| custrecord_p2p_ar_active | Active | Checkbox | Yes | |
| custrecord_p2p_ar_exc_no_po | Exception: Missing PO | Checkbox | No | For VB rules |
| custrecord_p2p_ar_exc_variance | Exception: Variance | Checkbox | No | For VB rules |
| custrecord_p2p_ar_exc_no_receipt | Exception: No Receipt | Checkbox | No | For VB rules |
| custrecord_p2p_ar_sla_hours | SLA Hours | Integer | No | For escalation |

### customrecord_p2p_approval_step.xml

**Purpose**: Defines approval steps within a rule

**Fields**:
| Field ID | Label | Type | Required | Notes |
|----------|-------|------|----------|-------|
| custrecord_p2p_as_parent_rule | Parent Rule | List (customrecord_p2p_approval_rule) | Yes | |
| custrecord_p2p_as_sequence | Sequence | Integer | Yes | Order (1,2,3...) |
| custrecord_p2p_as_approver_type | Approver Type | List (customlist_p2p_approver_type) | Yes | |
| custrecord_p2p_as_approver_role | Approver Role | List (Role) | No | If type=Role |
| custrecord_p2p_as_approver_employee | Approver Employee | List (Employee) | No | If type=Named |
| custrecord_p2p_as_execution_mode | Execution Mode | List (customlist_p2p_execution_mode) | Yes | |
| custrecord_p2p_as_require_comment | Require Comment on Reject | Checkbox | No | |

### customrecord_p2p_delegation.xml

**Purpose**: Stores approval delegations

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| custrecord_p2p_del_original | Original Approver | List (Employee) | Yes |
| custrecord_p2p_del_delegate | Delegate | List (Employee) | Yes |
| custrecord_p2p_del_start_date | Start Date | Date | Yes |
| custrecord_p2p_del_end_date | End Date | Date | Yes |
| custrecord_p2p_del_subsidiary | Subsidiary Scope | List (Subsidiary) | No |
| custrecord_p2p_del_tran_type | Transaction Type Scope | List (customlist_p2p_tran_type) | No |
| custrecord_p2p_del_active | Active | Checkbox | Yes |

### customrecord_p2p_approval_task.xml

**Purpose**: Tracks pending approval tasks

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| custrecord_p2p_at_tran_type | Transaction Type | List | Yes |
| custrecord_p2p_at_tran_id | Transaction ID | Integer | Yes |
| custrecord_p2p_at_rule | Approval Rule | List | No |
| custrecord_p2p_at_step | Approval Step | List | No |
| custrecord_p2p_at_sequence | Sequence | Integer | Yes |
| custrecord_p2p_at_approver | Approver | List (Employee) | Yes |
| custrecord_p2p_at_acting_approver | Acting Approver | List (Employee) | No |
| custrecord_p2p_at_status | Status | List (customlist_p2p_task_status) | Yes |
| custrecord_p2p_at_created | Created | Datetime | Yes |
| custrecord_p2p_at_completed | Completed | Datetime | No |
| custrecord_p2p_at_token | Token | Text (200) | No |
| custrecord_p2p_at_token_expiry | Token Expiry | Datetime | No |
| custrecord_p2p_at_reminder_count | Reminder Count | Integer | No |
| custrecord_p2p_at_escalated | Escalated | Checkbox | No |

### customrecord_p2p_approval_history.xml

**Purpose**: Audit trail of all approval actions

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| custrecord_p2p_ah_tran_type | Transaction Type | List | Yes |
| custrecord_p2p_ah_tran_id | Transaction ID | Integer | Yes |
| custrecord_p2p_ah_step_sequence | Step Sequence | Integer | Yes |
| custrecord_p2p_ah_approver | Approver | List (Employee) | Yes |
| custrecord_p2p_ah_acting_approver | Acting Approver | List (Employee) | No |
| custrecord_p2p_ah_action | Action | List (customlist_p2p_approval_action) | Yes |
| custrecord_p2p_ah_timestamp | Timestamp | Datetime | Yes |
| custrecord_p2p_ah_comment | Comment | Textarea | No |
| custrecord_p2p_ah_ip_address | IP Address | Text (50) | No |
| custrecord_p2p_ah_method | Method | List (customlist_p2p_approval_method) | No |

### customrecord_p2p_dept_group.xml

**Purpose**: Department groupings for routing

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| name | Name | Text | Yes |

### customrecord_p2p_dept_group_member.xml

**Purpose**: Maps departments to groups

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| custrecord_p2p_dgm_group | Group | List (customrecord_p2p_dept_group) | Yes |
| custrecord_p2p_dgm_department | Department | List (Department) | Yes |

### customrecord_p2p_loc_group.xml

**Purpose**: Location groupings for routing

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| name | Name | Text | Yes |

### customrecord_p2p_loc_group_member.xml

**Purpose**: Maps locations to groups

**Fields**:
| Field ID | Label | Type | Required |
|----------|-------|------|----------|
| custrecord_p2p_lgm_group | Group | List (customrecord_p2p_loc_group) | Yes |
| custrecord_p2p_lgm_location | Location | List (Location) | Yes |

---

## PART 3: Transaction Body Fields

Add these custom fields to Purchase Order and Vendor Bill:

| Field ID | Label | Type | Applies To |
|----------|-------|------|------------|
| custbody_p2p_approval_status | P2P Approval Status | List (customlist_p2p_approval_status) | PO, VB |
| custbody_p2p_current_step | P2P Current Step | Integer | PO, VB |
| custbody_p2p_current_approver | P2P Current Approver | List (Employee) | PO, VB |
| custbody_p2p_approval_rule | P2P Approval Rule | List (customrecord_p2p_approval_rule) | PO, VB |
| custbody_p2p_exception_type | P2P Exception Type | List (customlist_p2p_exception_type) | VB only |
| custbody_p2p_match_status | P2P Match Status | List (customlist_p2p_match_status) | VB only |
| custbody_p2p_ai_risk_score | P2P AI Risk Score | Decimal Number | PO, VB |
| custbody_p2p_ai_risk_flags | P2P AI Risk Flags | Long Text | PO, VB |

---

## PART 4: Constants File

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/constants/p2p_constants.js`:

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([], function() {
    
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
        'purchaseorder': '1',
        'vendorbill': '2'
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

    // Field IDs - Approval Rule
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
        EFFECTIVE_FROM: 'custrecord_p2p_ar_effective_from',
        EFFECTIVE_TO: 'custrecord_p2p_ar_effective_to',
        ACTIVE: 'custrecord_p2p_ar_active',
        EXC_NO_PO: 'custrecord_p2p_ar_exc_no_po',
        EXC_VARIANCE: 'custrecord_p2p_ar_exc_variance',
        EXC_NO_RECEIPT: 'custrecord_p2p_ar_exc_no_receipt',
        SLA_HOURS: 'custrecord_p2p_ar_sla_hours'
    };

    // Field IDs - Approval Step
    const STEP_FIELDS = {
        PARENT_RULE: 'custrecord_p2p_as_parent_rule',
        SEQUENCE: 'custrecord_p2p_as_sequence',
        APPROVER_TYPE: 'custrecord_p2p_as_approver_type',
        APPROVER_ROLE: 'custrecord_p2p_as_approver_role',
        APPROVER_EMPLOYEE: 'custrecord_p2p_as_approver_employee',
        EXECUTION_MODE: 'custrecord_p2p_as_execution_mode',
        REQUIRE_COMMENT: 'custrecord_p2p_as_require_comment'
    };

    // Field IDs - Delegation
    const DELEGATION_FIELDS = {
        ORIGINAL: 'custrecord_p2p_del_original',
        DELEGATE: 'custrecord_p2p_del_delegate',
        START_DATE: 'custrecord_p2p_del_start_date',
        END_DATE: 'custrecord_p2p_del_end_date',
        SUBSIDIARY: 'custrecord_p2p_del_subsidiary',
        TRAN_TYPE: 'custrecord_p2p_del_tran_type',
        ACTIVE: 'custrecord_p2p_del_active'
    };

    // Field IDs - Task
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

    // Field IDs - History
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

    // Transaction Body Fields
    const BODY_FIELDS = {
        APPROVAL_STATUS: 'custbody_p2p_approval_status',
        CURRENT_STEP: 'custbody_p2p_current_step',
        CURRENT_APPROVER: 'custbody_p2p_current_approver',
        APPROVAL_RULE: 'custbody_p2p_approval_rule',
        EXCEPTION_TYPE: 'custbody_p2p_exception_type',
        MATCH_STATUS: 'custbody_p2p_match_status',
        AI_RISK_SCORE: 'custbody_p2p_ai_risk_score',
        AI_RISK_FLAGS: 'custbody_p2p_ai_risk_flags'
    };

    // Configuration
    const CONFIG = {
        TOKEN_EXPIRY_HOURS: 72,
        REMINDER_HOURS: [24, 48],
        ESCALATION_HOURS: 72,
        VARIANCE_PERCENT_LIMIT: 5,
        VARIANCE_AMOUNT_LIMIT: 500,
        PO_REQUIRED_THRESHOLD: 1000,
        MAX_DELEGATION_DAYS: 30,
        FALLBACK_APPROVER_ROLE: 3,
        BULK_APPROVAL_LIMIT: 50
    };

    // Specificity scoring
    const SPECIFICITY_SCORES = {
        DEPARTMENT_EXACT: 4,
        DEPARTMENT_GROUP: 3,
        LOCATION_EXACT: 2,
        LOCATION_GROUP: 1
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
        HISTORY_FIELDS, BODY_FIELDS, CONFIG, SPECIFICITY_SCORES, SCRIPTS
    };
});
```

---

## PART 5: Core Library - Approval Engine

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_approval_engine.js`:

**Purpose**: Core routing logic, rule matching, approval processing

**Key Functions**:

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(['N/search', 'N/record', 'N/runtime', 'N/format',
        './p2p_delegation_manager', './p2p_history_logger',
        './p2p_notification_manager', '../constants/p2p_constants'
], function(search, record, runtime, format, delegationManager, 
            historyLogger, notificationManager, constants) {

    /**
     * Main entry: Route transaction for approval
     * @param {Object} params
     * @param {string} params.recordType - 'purchaseorder' or 'vendorbill'
     * @param {number} params.recordId
     * @param {Object} params.transactionData - {subsidiary, department, location, amount, currency}
     * @param {string} [params.exceptionType] - For vendor bills with matching exceptions
     */
    function routeForApproval(params) {
        // 1. Find matching rule using findMatchingRule()
        // 2. Get approval steps for rule
        // 3. Create approval tasks for first step
        // 4. Apply delegation if applicable
        // 5. Update transaction status
        // 6. Log history
        // 7. Send notifications
    }

    /**
     * Find best matching approval rule
     * Uses specificity scoring: exact dept > dept group > exact loc > loc group
     * Then by priority (higher wins)
     */
    function findMatchingRule(criteria) {
        // Query all active rules matching:
        // - Transaction type
        // - Subsidiary
        // - Amount within range
        // - Effective date range includes today
        // - Currency matches OR is blank
        // - Department matches OR is blank
        // - Location matches OR is blank
        // - Exception flags if applicable
        
        // Score each by specificity, sort, return top match
    }

    /**
     * Calculate specificity score
     * +4 for exact department match
     * +3 for department group match
     * +2 for exact location match
     * +1 for location group match
     */
    function calculateSpecificity(rule, dept, loc, deptGroup, locGroup) {}

    /**
     * Process approval action (approve/reject)
     */
    function processApproval(params) {
        // 1. Validate task and user
        // 2. Update task status
        // 3. Log history
        // 4. If reject: update transaction to Rejected, notify requestor
        // 5. If approve: check if step complete (for parallel)
        // 6. If step complete: route to next step or finalize
    }

    /**
     * Check segregation of duties
     * - Requestor cannot approve own PO
     * - Creator cannot approve own VB
     * - Same person cannot approve both PO and related VB
     */
    function checkSegregationOfDuties(recordType, recordId, approverId) {}

    return {
        routeForApproval,
        processApproval,
        findMatchingRule,
        checkSegregationOfDuties
    };
});
```

---

## PART 6: Delegation Manager

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_delegation_manager.js`:

**Key Functions**:

```javascript
/**
 * Find active delegation for approver
 * Checks date range and optional subsidiary/transaction type scope
 */
function findActiveDelegation(params) {
    // params: approverId, subsidiary, transactionType
    // Returns: {id, delegateId, startDate, endDate} or null
}

/**
 * Create new delegation
 * Validates: max 30 days, no overlapping delegations
 */
function createDelegation(params) {}

/**
 * Get all delegations for employee (as delegator or delegate)
 */
function getEmployeeDelegations(employeeId, asDelegate) {}

/**
 * Cleanup expired delegations (for scheduled script)
 */
function cleanupExpiredDelegations() {}
```

---

## PART 7: Matching Engine

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_matching_engine.js`:

**Purpose**: 3-way matching for Vendor Bills

**Key Functions**:

```javascript
/**
 * Perform 3-way match validation
 * Returns: {status, exceptions[], details}
 */
function performMatchValidation(params) {
    // 1. Check PO Link (required if bill > $1000)
    // 2. Check Receipt (for inventory/asset items)
    // 3. Check Variance (price 5%/$500, quantity 0%)
}

/**
 * Check PO link requirement
 */
function checkPOLink(vbRecord, billTotal) {
    // Return: {pass, required, linked, poIds[], message}
}

/**
 * Check receipt status for items requiring receipt
 */
function checkReceiptStatus(vbRecord) {
    // Return: {pass, itemsRequiringReceipt, itemsReceived, pendingItems[]}
}

/**
 * Check price and quantity variance
 */
function checkVariance(vbRecord) {
    // Compare billed rate/qty to PO rate/qty
    // Price variance allowed: 5% OR $500 (whichever greater)
    // Quantity variance: 0% (exact match)
}
```

---

## PART 8: Notification Manager

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_notification_manager.js`:

**Key Functions**:

```javascript
/**
 * Send approval request email with secure approve/reject links
 */
function sendApprovalRequest(params) {
    // Build HTML email with:
    // - Transaction summary (type, vendor, amount, date)
    // - Approve button link: /app/site/hosting/scriptlet.nl?script=...&token=X&action=approve
    // - Reject button link: same with action=reject
    // - View in NetSuite link
}

/**
 * Send reminder (24h, 48h)
 */
function sendReminder(params) {}

/**
 * Send escalation notice to manager
 */
function sendEscalation(params) {}

/**
 * Send approved notification to requestor
 */
function sendApprovedNotification(params) {}

/**
 * Send rejected notification to requestor
 */
function sendRejectedNotification(params) {}
```

---

## PART 9: History Logger

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_history_logger.js`:

```javascript
/**
 * Log approval action to history record
 */
function logAction(params) {
    // params: transactionType, transactionId, stepSequence, 
    //         approver, actingApprover, action, comment, method, ipAddress
}

/**
 * Get formatted history for display
 */
function getFormattedHistory(transactionType, transactionId) {
    // Returns array of {step, action, approver, timestamp, comment}
}

/**
 * Build HTML table for transaction form display
 */
function buildHistoryHtml(transactionType, transactionId) {}
```

---

## PART 10: Token Manager

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_token_manager.js`:

```javascript
/**
 * Generate 64-character secure token
 */
function generateToken() {}

/**
 * Validate token and return task details
 * Checks: token exists, task pending, not expired
 */
function validateToken(token) {
    // Returns: {valid, taskId, transactionType, transactionId, approver, error}
}

/**
 * Refresh token (extend expiry)
 */
function refreshToken(taskId) {}

/**
 * Invalidate token after use
 */
function invalidateToken(taskId) {}
```

---

## PART 11: Email Approval Suitelet

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/suitelet/p2p_email_approval_sl.js`:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', '../lib/p2p_token_manager', 
        '../lib/p2p_approval_engine', '../constants/p2p_constants'
], function(serverWidget, tokenManager, approvalEngine, constants) {

    function onRequest(context) {
        const { token, action } = context.request.parameters;
        
        // Validate token
        const validation = tokenManager.validateToken(token);
        
        if (!validation.valid) {
            // Show error page
            return showErrorPage(context, validation.error);
        }
        
        if (context.request.method === 'GET') {
            // Show confirmation page
            return showConfirmationPage(context, validation, action);
        }
        
        if (context.request.method === 'POST') {
            // Process approval
            const comment = context.request.parameters.comment;
            const ipAddress = context.request.clientIpAddress;
            
            const result = approvalEngine.processApproval({
                taskId: validation.taskId,
                action: action === 'approve' ? constants.APPROVAL_ACTION.APPROVE 
                                             : constants.APPROVAL_ACTION.REJECT,
                comment: comment,
                method: constants.APPROVAL_METHOD.EMAIL,
                ipAddress: ipAddress
            });
            
            // Show success/error page
            return showResultPage(context, result);
        }
    }

    function showConfirmationPage(context, validation, action) {
        // HTML form with transaction details and confirm button
    }

    function showResultPage(context, result) {
        // Success or error message
    }

    return { onRequest };
});
```

---

## PART 12: Bulk Approval Suitelet

Create `/src/FileCabinet/SuiteScripts/p2p_approvals/suitelet/p2p_bulk_approval_sl.js`:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/runtime',
        '../lib/p2p_approval_engine', '../constants/p2p_constants'
], function(serverWidget, search, runtime, approvalEngine, constants) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Display list of pending approvals for current user
            return showPendingApprovals(context);
        }
        
        if (context.request.method === 'POST') {
            // Process selected approvals
            return processBulkApprovals(context);
        }
    }

    function showPendingApprovals(context) {
        const currentUser = runtime.getCurrentUser().id;
        
        // Search for pending tasks where user is approver or acting approver
        // Display in sublist with checkboxes
    }

    function processBulkApprovals(context) {
        // Get selected records
        // Process each approval
        // Return summary
    }

    return { onRequest };
});
```

---

## PART 13: Scheduled Scripts

### p2p_reminder_ss.js

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * Run every 4 hours
 */
define(['N/search', '../lib/p2p_notification_manager', '../constants/p2p_constants'
], function(search, notificationManager, constants) {

    function execute(context) {
        // Find pending tasks older than 24h with reminder_count < 1
        // Send first reminder, update count
        
        // Find pending tasks older than 48h with reminder_count < 2
        // Send second reminder, update count
    }

    return { execute };
});
```

### p2p_escalation_ss.js

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * Run every 4 hours
 */
define(['N/search', 'N/record', '../lib/p2p_notification_manager',
        '../constants/p2p_constants'
], function(search, record, notificationManager, constants) {

    function execute(context) {
        // Find pending tasks older than 72h not yet escalated
        // Get approver's manager
        // Add manager as parallel approver
        // Send escalation notification
        // Mark task as escalated
    }

    return { execute };
});
```

---

## PART 14: User Event Scripts

### p2p_po_ue.js

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * Deploy to: Purchase Order
 */
define(['N/record', 'N/runtime', 'N/ui/serverWidget',
        '../lib/p2p_approval_engine', '../lib/p2p_history_logger',
        '../constants/p2p_constants'
], function(record, runtime, serverWidget, approvalEngine, 
            historyLogger, constants) {

    function beforeLoad(context) {
        // VIEW/EDIT: Add approval status field group
        // VIEW/EDIT: Add history sublist
        // VIEW: Add Submit/Approve/Reject/Resubmit buttons based on status
    }

    function beforeSubmit(context) {
        // CREATE: Set status to Draft
        // EDIT: If approved PO amount increased, reset to Draft
    }

    function afterSubmit(context) {
        // CREATE/EDIT: If Draft and auto-submit enabled, route for approval
    }

    return { beforeLoad, beforeSubmit, afterSubmit };
});
```

### p2p_vb_ue.js

Same structure as PO, plus:
- Add matching status field group
- Perform 3-way matching in afterSubmit
- Pass exception type to routing

---

## PART 15: Client Scripts

### p2p_po_cs.js

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/url', 'N/https'], function(currentRecord, url, https) {

    function submitForApproval(recordId) {
        // Call Suitelet or RESTlet to trigger approval routing
        // Refresh page
    }

    function approveRecord(recordId) {
        // Prompt for optional comment
        // Call approval processing
        // Refresh page
    }

    function rejectRecord(recordId) {
        // Require comment
        // Call rejection processing
        // Refresh page
    }

    function resubmitForApproval(recordId) {
        // Reset status to Draft
        // Trigger routing
    }

    return {
        submitForApproval,
        approveRecord,
        rejectRecord,
        resubmitForApproval
    };
});
```

### p2p_vb_cs.js

Same as PO, plus:
- recheckMatching(recordId) function
- approveWithException(recordId) function

---

## PART 16: Saved Searches

Create these saved searches:

### 1. P2P Pending Approvals by Approver
- Type: Custom Record (Approval Task)
- Filters: Status = Pending
- Columns: Approver (Group), Transaction Type, Count, Oldest Created Date

### 2. P2P Pending Approvals by Age
- Type: Custom Record (Approval Task)
- Filters: Status = Pending
- Columns: Age Bucket (formula), Count
- Age buckets: 0-24h, 24-48h, 48-72h, 72h+

### 3. P2P Approval Bottlenecks
- Type: Custom Record (Approval History)
- Filters: Last 90 days
- Columns: Rule, Step Sequence, Avg Days to Complete

### 4. P2P Matching Exceptions
- Type: Vendor Bill
- Filters: Exception Type is not empty
- Columns: Document Number, Vendor, Amount, Exception Type, Date

### 5. P2P Approvals by Month
- Type: Custom Record (Approval History)
- Filters: Last 12 months
- Columns: Month (Group), Approver, Approved Count, Rejected Count

---

## PART 17: Deployment Configuration

### Script Deployments

| Script | Deployment ID | Type | Applies To |
|--------|--------------|------|------------|
| p2p_po_ue.js | customdeploy_p2p_po_ue | User Event | Purchase Order |
| p2p_vb_ue.js | customdeploy_p2p_vb_ue | User Event | Vendor Bill |
| p2p_email_approval_sl.js | customdeploy_p2p_email_approval | Suitelet | Public |
| p2p_bulk_approval_sl.js | customdeploy_p2p_bulk_approval | Suitelet | Logged in |
| p2p_delegation_sl.js | customdeploy_p2p_delegation | Suitelet | Logged in |
| p2p_reminder_ss.js | customdeploy_p2p_reminder | Scheduled | Every 4 hours |
| p2p_escalation_ss.js | customdeploy_p2p_escalation | Scheduled | Every 4 hours |

---

## PART 18: Rule Matching Algorithm

**Specificity Order (most specific wins)**:

1. Subsidiary + Department (exact) + Location (exact) + Amount
2. Subsidiary + Department Group + Location (exact) + Amount
3. Subsidiary + Department (exact) + Location Group + Amount
4. Subsidiary + Department Group + Location Group + Amount
5. Subsidiary + Department Group + Amount (no location)
6. Subsidiary + Location Group + Amount (no department)
7. Subsidiary + Amount (fallback)

**Within same specificity**: Higher priority number wins

**Wildcard support**: Blank field = match any

---

## PART 19: Vendor Bill 3-Way Matching Rules

| Check | Condition | Tolerance |
|-------|-----------|-----------|
| PO Link | Required if bill > $1,000 | Must have at least one line linked to PO |
| Receipt | Required for Inventory, Assembly, Fixed Asset items | Must have quantity received >= quantity billed |
| Price Variance | Billed rate vs PO rate | 5% OR $500, whichever is greater (both must be exceeded to fail) |
| Quantity Variance | Billed qty vs received qty | 0% (cannot bill more than received) |

---

## PART 20: Test Cases

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | PO $5K, US Ops, Corporate dept | Dept Manager approves |
| 2 | PO $25K, US Ops, Commercial dept | Dept Manager → Sr Manager (2 steps) |
| 3 | PO $150K, US Ops, Technical dept | 3-step approval chain |
| 4 | PO $75K, UK Ops (GBP) | Multi-step, currency rule applies |
| 5 | PO with active delegation | Routes to delegate, logs both |
| 6 | VB passes all matching | Standard approval routing |
| 7 | VB missing PO link | Exception rule triggers |
| 8 | VB with 10% price variance | Exception rule triggers |
| 9 | VB missing receipt | Exception rule triggers |
| 10 | Rejection with resubmit | Returns to Draft, can resubmit |
| 11 | Email approval (approve) | Token validates, approval logged |
| 12 | Expired token | Shows error, suggests refresh |

---

## Summary

Generate all files following this specification. Each library module should be complete and functional. Use proper error handling with try/catch blocks. Log appropriately with log.debug, log.audit, and log.error.

**Critical Implementation Notes**:
1. Always use SuiteScript 2.1 syntax
2. Use N/search for queries (never N/query for this project)
3. Handle all edge cases (null values, missing records)
4. Log all audit events (approvals, rejections, escalations)
5. Validate tokens before processing email approvals
6. Check segregation of duties before allowing approvals
7. Support both serial and parallel approval modes
