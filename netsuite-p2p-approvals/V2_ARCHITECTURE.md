# P2P Approval Workflow v2 - Decision Table Architecture

## Overview

The v2 architecture refactors the P2P approval workflow to use a **Decision Table** pattern, separating rule matching from approval path execution. This provides:

- **Clearer configuration**: Decision Rules define WHEN to route, Approval Paths define HOW to route
- **Better maintainability**: Changes to routing conditions don't require touching path logic
- **Enhanced auditability**: Match reasons are captured and visible
- **Improved performance**: Rules can be cached and evaluated efficiently

---

## Architecture Components

### Core Records

| Record | Script ID | Purpose |
|--------|-----------|---------|
| Decision Rule | `customrecord_p2p_decision_rule` | Defines conditions (amount, subsidiary, dept, etc.) and priority |
| Approval Path | `customrecord_p2p_approval_path` | Defines the sequence of approval steps |
| Path Step | `customrecord_p2p_path_step` | Individual step within a path (approver, mode, etc.) |
| Global Config | `customrecord_p2p_global_config` | System-wide settings (timeouts, limits, etc.) |
| Approval Task | `customrecord_p2p_approval_task_v2` | Pending approval work items |
| Approval History | `customrecord_p2p_approval_history` | Immutable audit trail |
| Delegation | `customrecord_p2p_delegation` | Temporary delegation records |

### Transaction Fields

| Field | Script ID | Purpose |
|-------|-----------|---------|
| Matched Rule | `custbody_p2p_matched_rule` | Links to the decision rule that was matched |
| Approval Path | `custbody_p2p_approval_path` | Links to the assigned approval path |
| Match Reason | `custbody_p2p_match_reason` | Text explanation of why the rule matched |

### Engine Modules

| Module | File | Purpose |
|--------|------|---------|
| Constants | `p2p_constants_v2.js` | All script IDs, field IDs, and static values |
| Config | `p2p_config.js` | Loads and caches Global Config record |
| Rule Matcher | `p2p_rule_matcher.js` | Evaluates decision rules against transactions |
| Path Runner | `p2p_path_runner.js` | Executes approval paths (creates tasks, advances steps) |
| Controller | `p2p_controller.js` | High-level orchestration of the workflow |

### Supporting Modules

| Module | File | Purpose |
|--------|------|---------|
| Delegation Manager | `p2p_delegation_manager_v2.js` | Handles delegation logic |
| Token Manager | `p2p_token_manager_v2.js` | Generates/validates email approval tokens |
| Notification Manager | `p2p_notification_manager_v2.js` | Sends emails, Teams, and Slack notifications |
| History Logger | `p2p_history_logger_v2.js` | Writes to audit trail |
| Matching Engine | `p2p_matching_engine_v2.js` | 3-way matching for Vendor Bills |

### Scripts

| Script | Type | Purpose |
|--------|------|---------|
| `p2p_po_ue_v2.js` | User Event | PO approval buttons and workflow initiation |
| `p2p_vb_ue_v2.js` | User Event | VB approval buttons, matching, workflow initiation |
| `p2p_po_cs_v2.js` | Client Script | PO approval button handlers |
| `p2p_vb_cs_v2.js` | Client Script | VB approval button handlers |
| `p2p_action_rl.js` | RESTlet | API for approval actions |
| `p2p_email_approval_sl_v2.js` | Suitelet | One-click email approve/reject |
| `p2p_bulk_approval_sl_v2.js` | Suitelet | Bulk approval interface |
| `p2p_delegation_sl_v2.js` | Suitelet | Self-service delegation management |
| `p2p_reminder_ss_v2.js` | Scheduled | Sends approval reminders |
| `p2p_escalation_ss_v2.js` | Scheduled | Escalates overdue approvals |
| `p2p_migration_ss.js` | Scheduled | Migrates v1 rules to v2 format |

---

## Decision Flow

```
1. Transaction Submitted
        │
        ▼
2. Rule Matcher evaluates Decision Rules
   - Filters by: transaction type, subsidiary, amount range
   - Checks: currency, department, location (exact or group)
   - Scores by: specificity + priority
   - Returns: best matching rule + match reason
        │
        ▼
3. Path Runner initializes Approval Path
   - Loads path steps for matched rule's path
   - Creates approval tasks for first step
   - Resolves delegation (if any)
   - Generates email tokens
   - Sends notifications
        │
        ▼
4. Controller processes approvals
   - Validates approver authorization
   - Advances to next step or finalizes
   - Logs all actions to history
```

---

## Key Features

### Rule Matching
- **Specificity scoring**: Exact department (4) > Dept group (3) > Exact location (2) > Location group (1)
- **Priority tiebreaker**: Higher priority wins when specificity is equal
- **Wildcard support**: Blank fields match any value
- **Date-effective rules**: Rules can have effective from/to dates

### Approval Paths
- **Serial mode**: One approver at a time
- **Parallel mode**: All approvers simultaneously (all must approve)
- **Parallel Any mode**: All approvers simultaneously (any one can approve)
- **Step timeout**: Configurable per-step escalation

### Delegation
- **Date-scoped**: Delegations have explicit start/end dates
- **Subsidiary-scoped**: Optional restriction to specific subsidiary
- **Transaction type-scoped**: Optional restriction to PO or VB
- **Max duration**: Configurable maximum delegation period

### Notifications
- **Email**: HTML formatted with one-click approve/reject buttons
- **Microsoft Teams**: Webhook integration with approval cards
- **Slack**: Webhook integration with approval messages
- **Reminders**: Configurable reminder intervals (default: 24h, 48h)
- **Escalation**: Auto-escalate to manager after timeout (default: 72h)

### 3-Way Matching (Vendor Bills)
- **PO Link Check**: Required for bills over threshold (default: $1,000)
- **Receipt Check**: Required for inventory/assembly/fixed asset items
- **Price Variance**: Configurable % and $ tolerance
- **Quantity Variance**: Cannot bill more than PO quantity
- **Duplicate Detection**: Checks for same vendor + invoice number
- **Anomaly Detection**: Flags new vendors, unusual amounts, etc.

---

## Custom Lists

| List | Script ID | Values |
|------|-----------|--------|
| Transaction Type | `customlist_p2p_tran_type_v2` | Purchase Order, Vendor Bill |
| Approval Status | `customlist_p2p_approval_status_v2` | Draft, Pending, Approved, Rejected, etc. |
| Task Status | `customlist_p2p_task_status_v2` | Pending, Approved, Rejected, Escalated, etc. |
| Approval Action | `customlist_p2p_approval_action_v2` | Submit, Approve, Reject, Escalate, etc. |
| Approver Type | `customlist_p2p_approver_type_v2` | Employee, Supervisor, Role, etc. |
| Execution Mode | `customlist_p2p_execution_mode_v2` | Serial, Parallel, Parallel Any |
| Match Status | `customlist_p2p_match_status_v2` | Matched, Partial, Price Variance, etc. |
| Exception Type | `customlist_p2p_exception_type_v2` | Missing PO, Price Over, Duplicate, etc. |
| Approval Method | `customlist_p2p_approval_method_v2` | UI, Email, Bulk, API |

---

## Migration from v1

The `p2p_migration_ss.js` scheduled script handles migration:

1. Reads existing v1 `customrecord_p2p_approval_rule` records
2. Creates corresponding v2 `customrecord_p2p_decision_rule` records
3. Creates `customrecord_p2p_approval_path` records
4. Creates `customrecord_p2p_path_step` records from v1 steps
5. Preserves mappings for reference

Run the migration script once before switching to v2 scripts.

---

## File Structure

```
src/
├── FileCabinet/SuiteScripts/p2p_approvals/
│   ├── constants/
│   │   └── p2p_constants_v2.js
│   ├── lib/
│   │   ├── p2p_config.js
│   │   ├── p2p_rule_matcher.js
│   │   ├── p2p_path_runner.js
│   │   ├── p2p_controller.js
│   │   ├── p2p_delegation_manager_v2.js
│   │   ├── p2p_token_manager_v2.js
│   │   ├── p2p_notification_manager_v2.js
│   │   ├── p2p_history_logger_v2.js
│   │   └── p2p_matching_engine_v2.js
│   ├── user_event/
│   │   ├── p2p_po_ue_v2.js
│   │   └── p2p_vb_ue_v2.js
│   ├── client/
│   │   ├── p2p_po_cs_v2.js
│   │   └── p2p_vb_cs_v2.js
│   ├── suitelet/
│   │   ├── p2p_email_approval_sl_v2.js
│   │   ├── p2p_bulk_approval_sl_v2.js
│   │   └── p2p_delegation_sl_v2.js
│   ├── scheduled/
│   │   ├── p2p_reminder_ss_v2.js
│   │   ├── p2p_escalation_ss_v2.js
│   │   └── p2p_migration_ss.js
│   └── restlet/
│       └── p2p_action_rl.js
└── Objects/
    ├── Records/
    │   ├── customrecord_p2p_decision_rule.xml
    │   ├── customrecord_p2p_approval_path.xml
    │   ├── customrecord_p2p_path_step.xml
    │   ├── customrecord_p2p_global_config.xml
    │   └── customrecord_p2p_approval_task_v2.xml
    ├── Fields/
    │   ├── custbody_p2p_matched_rule.xml
    │   ├── custbody_p2p_approval_path.xml
    │   └── custbody_p2p_match_reason.xml
    └── Lists/
        ├── customlist_p2p_tran_type_v2.xml
        ├── customlist_p2p_approval_status_v2.xml
        ├── customlist_p2p_task_status_v2.xml
        ├── customlist_p2p_approval_action_v2.xml
        ├── customlist_p2p_approver_type_v2.xml
        ├── customlist_p2p_execution_mode_v2.xml
        ├── customlist_p2p_match_status_v2.xml
        ├── customlist_p2p_exception_type_v2.xml
        └── customlist_p2p_approval_method_v2.xml
```

---

## Deployment Steps

1. Deploy custom lists first (dependencies for records)
2. Deploy custom records
3. Deploy transaction body fields
4. Deploy scripts (library modules first)
5. Create script deployments
6. Run migration script (if upgrading from v1)
7. Test with sample transactions

---

*P2P Approval Workflow v2 - Decision Table Architecture*
*Last Updated: January 2026*
