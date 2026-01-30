# P2P Approval Workflow v2 - Complete Deployment Documentation

**Version:** 2.0  
**Last Updated:** January 31, 2026  
**Architecture:** Decision Table Pattern  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Custom Lists](#3-custom-lists)
4. [Custom Records](#4-custom-records)
5. [Transaction Body Fields](#5-transaction-body-fields)
6. [Script Files](#6-script-files)
7. [Script Deployments](#7-script-deployments)
8. [Configuration Guide](#8-configuration-guide)
9. [Testing Guide](#9-testing-guide)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

The P2P Approval Workflow v2 system provides automated approval routing for Purchase Orders and Vendor Bills in NetSuite. It uses a **Decision Table** architecture that separates:

- **Decision Rules**: Define WHEN to route (conditions like amount, subsidiary, department)
- **Approval Paths**: Define HOW to route (the sequence of approvers)

### Key Features

- Multi-dimensional approval routing (subsidiary, department, location, amount)
- Delegation management with date ranges
- One-click email approvals with secure tokens
- 3-way matching for Vendor Bills (PO → Receipt → Invoice)
- AI-powered risk scoring and anomaly detection
- Bulk approval interface
- Automated reminders and escalations
- Complete audit trail

---

## 2. Architecture

### Decision Flow

```
Transaction Submitted
        │
        ▼
Rule Matcher evaluates Decision Rules
   - Filters by: transaction type, subsidiary, amount
   - Checks: department, location, risk score
   - Scores by: specificity + priority
   - Returns: best matching rule + approval path
        │
        ▼
Path Runner initializes Approval Path
   - Creates approval tasks for first step
   - Resolves delegation (if any)
   - Generates email tokens
   - Sends notifications
        │
        ▼
Controller processes approvals
   - Validates approver authorization
   - Checks segregation of duties
   - Advances to next step or finalizes
   - Logs all actions to history
```

### File Cabinet Structure

```
SuiteScripts/
└── p2p_approvals/
    ├── constants/
    │   └── p2p_constants_v2.js
    ├── lib/
    │   ├── p2p_config.js
    │   ├── p2p_controller.js
    │   ├── p2p_delegation_manager.js
    │   ├── p2p_history_logger.js
    │   ├── p2p_matching_engine.js
    │   ├── p2p_notification_manager.js
    │   ├── p2p_path_runner.js
    │   ├── p2p_rule_matcher.js
    │   └── p2p_token_manager.js
    ├── user_event/
    │   ├── p2p_po_ue.js
    │   └── p2p_vb_ue.js
    ├── client/
    │   ├── p2p_po_cs.js
    │   └── p2p_vb_cs.js
    ├── suitelet/
    │   ├── p2p_bulk_approval_sl.js
    │   ├── p2p_delegation_sl.js
    │   └── p2p_email_approval_sl.js
    ├── scheduled/
    │   ├── p2p_escalation_ss.js
    │   ├── p2p_migration_ss.js
    │   └── p2p_reminder_ss.js
    ├── restlet/
    │   └── p2p_action_rl.js
    └── map_reduce/
        └── (empty - reserved for future use)
```

---

## 3. Custom Lists

| # | Name | Script ID | Values |
|---|------|-----------|--------|
| 1 | P2P Approval Action | `customlist_p2p_approval_action` | Submitted, Approved, Rejected, Delegated, Escalated, Recalled, Reassigned, Comment Added, Exception Override, Resubmitted |
| 2 | P2P Approval Method | `customlist_p2p_approval_method` | UI, Email, Bulk, API, Mobile |
| 3 | P2P Approval Status | `customlist_p2p_approval_status` | Pending Submission, Pending Approval, Approved, Rejected, Recalled, Escalated, Pending Exception Review, Draft |
| 4 | P2P Approver Type | `customlist_p2p_approver_type` | Specific Employee, Supervisor, Department Manager, Subsidiary Manager, Role, Custom Field, Script |
| 5 | P2P Exception Type List | `customlist_p2p_exception_type_list` | None, Price Over Tolerance, Quantity Over, Quantity Under, Missing PO, Missing Receipt, Duplicate Invoice, Vendor Mismatch, Currency Mismatch, Multiple Exceptions |
| 6 | P2P Execution Mode | `customlist_p2p_execution_mode` | Serial, Parallel, Parallel Any |
| 7 | P2P Match Status | `customlist_p2p_match_status` | Not Matched, Matched, Partial Match, Price Variance, Quantity Variance, PO Not Found, Receipt Missing, Exception Overridden |
| 8 | P2P Reapproval Mode | `customlist_p2p_reapproval_mode` | Material Changes Only, Any Change |
| 9 | P2P Task Status | `customlist_p2p_task_status` | Pending, Approved, Rejected, Delegated, Escalated, Cancelled, Expired |
| 10 | P2P Transaction Type | `customlist_p2p_tran_type` | Purchase Order, Vendor Bill |

---

## 4. Custom Records

### 4.1 Core Workflow Records

| # | Name | Script ID | Purpose |
|---|------|-----------|---------|
| 1 | P2P Decision Rule | `customrecord_p2p_decision_rule` | Defines conditions and maps to approval path |
| 2 | P2P Approval Path | `customrecord_p2p_approval_path` | Reusable approval chain definition |
| 3 | P2P Path Step | `customrecord_p2p_path_step` | Individual step within a path |
| 4 | P2P Approval Task | `customrecord_p2p_approval_task` | Pending approval work items |
| 5 | P2P Approval History | `customrecord_p2p_approval_history` | Immutable audit trail |
| 6 | P2P Delegation | `customrecord_p2p_delegation` | Temporary delegation records |
| 7 | P2P Global Config | `customrecord_p2p_global_config` | System-wide settings (singleton) |

### 4.2 Grouping Records (Optional)

| # | Name | Script ID | Purpose |
|---|------|-----------|---------|
| 8 | P2P Department Group | `customrecord_p2p_dept_group` | Groups departments for rule matching |
| 9 | P2P Department Group Member | `customrecord_p2p_dept_group_member` | Members of department groups |
| 10 | P2P Location Group | `customrecord_p2p_loc_group` | Groups locations for rule matching |
| 11 | P2P Location Group Member | `customrecord_p2p_loc_group_member` | Members of location groups |
| 12 | P2P Delegation Scope | `customrecord_p2p_delegation_scope` | Scoping options for delegations |

### 4.3 Decision Rule Fields

| Field | Script ID | Type | Required | Description |
|-------|-----------|------|----------|-------------|
| Rule Code | `custrecord_dr_code` | Text | Yes | Unique identifier (e.g., US_HIGH_VALUE_PO) |
| Transaction Type | `custrecord_dr_tran_type` | Multi-Select | Yes | PO, VB, or both |
| Subsidiary | `custrecord_dr_subsidiary` | Multi-Select | No | Blank = all subsidiaries |
| Amount Minimum | `custrecord_dr_amt_min` | Currency | Yes | Inclusive minimum (use 0 for no min) |
| Amount Maximum | `custrecord_dr_amt_max` | Currency | No | Blank = no maximum |
| Department | `custrecord_dr_department` | Multi-Select | No | Blank = all departments |
| Location | `custrecord_dr_location` | Multi-Select | No | Blank = all locations |
| Risk Score Min | `custrecord_dr_risk_min` | Integer | No | 0-100, blank = no minimum |
| Risk Score Max | `custrecord_dr_risk_max` | Integer | No | 0-100, blank = no maximum |
| Exception Types | `custrecord_dr_exception` | Multi-Select | No | Match only with these exceptions |
| Priority | `custrecord_dr_priority` | Integer | Yes | Lower = higher priority |
| Approval Path | `custrecord_dr_path` | Select | Yes | The path to execute |
| Effective From | `custrecord_dr_eff_from` | Date | Yes | Start date |
| Effective To | `custrecord_dr_eff_to` | Date | No | Blank = no end date |
| Active | `custrecord_dr_active` | Checkbox | Yes | Default: checked |
| Description | `custrecord_dr_description` | Textarea | No | Admin notes |

### 4.4 Approval Path Fields

| Field | Script ID | Type | Description |
|-------|-----------|------|-------------|
| Path Code | `custrecord_ap_code` | Text | Unique code (e.g., 3LVL_EXEC) |
| Description | `custrecord_ap_description` | Textarea | Human-readable description |
| Default SLA Hours | `custrecord_ap_sla_hours` | Integer | Hours before escalation |
| Active | `custrecord_ap_active` | Checkbox | Default: checked |
| Step Summary | `custrecord_ap_step_summary` | Text | Auto-generated summary |

### 4.5 Path Step Fields

| Field | Script ID | Type | Description |
|-------|-----------|------|-------------|
| Approval Path | `custrecord_ps_path` | Select | Parent path |
| Sequence | `custrecord_ps_sequence` | Integer | Order (1, 2, 3...) |
| Step Name | `custrecord_ps_name` | Text | Display name |
| Approver Type | `custrecord_ps_approver_type` | Select | Employee, Role, etc. |
| Approver Role | `custrecord_ps_role` | Select | If type = Role |
| Approver Employee | `custrecord_ps_employee` | Select | If type = Employee |
| Execution Mode | `custrecord_ps_mode` | Select | Serial, Parallel, Parallel Any |
| Require Comment | `custrecord_ps_require_comment` | Checkbox | On rejection |
| SLA Hours Override | `custrecord_ps_sla_hours` | Integer | Step-level override |
| Active | `custrecord_ps_active` | Checkbox | Default: checked |

### 4.6 Global Config Fields

| Field | Script ID | Type | Default | Description |
|-------|-----------|------|---------|-------------|
| Price Variance % | `custrecord_gc_price_var_pct` | Percent | 5% | Max price variance |
| Price Variance $ | `custrecord_gc_price_var_amt` | Currency | $500 | Max $ variance |
| FX Tolerance % | `custrecord_gc_fx_tolerance_pct` | Percent | 3% | Exchange rate tolerance |
| PO Required Threshold | `custrecord_gc_po_threshold` | Currency | $1,000 | VB amount requiring PO |
| First Reminder Hours | `custrecord_gc_reminder_1_hrs` | Integer | 24 | Hours before 1st reminder |
| Second Reminder Hours | `custrecord_gc_reminder_2_hrs` | Integer | 48 | Hours before 2nd reminder |
| Escalation Hours | `custrecord_gc_escalation_hrs` | Integer | 72 | Hours before escalation |
| Token Expiry Hours | `custrecord_gc_token_expiry_hrs` | Integer | 72 | Email token validity |
| Max Delegation Days | `custrecord_gc_max_delegation_days` | Integer | 30 | Maximum delegation period |
| Auto-Approve Enabled | `custrecord_gc_auto_approve_enabled` | Checkbox | No | Enable auto-approve |
| Auto-Approve Threshold | `custrecord_gc_auto_approve_threshold` | Integer | - | Max risk score for auto-approve |
| New Vendor Days | `custrecord_gc_new_vendor_days` | Integer | 14 | Days to flag as "new" |
| Min VBs for Anomaly | `custrecord_gc_min_vb_acct_anom` | Integer | 5 | Min bills for anomaly detection |
| Reapproval Mode | `custrecord_gc_reapproval_mode` | Text | material | "material" or "any" |
| Reapproval Body Fields | `custrecord_gc_reapproval_body` | Textarea | - | Comma-separated field IDs |
| Reapproval Item Fields | `custrecord_gc_reapproval_item` | Textarea | - | Comma-separated field IDs |
| Reapproval Expense Fields | `custrecord_gc_reapproval_expense` | Textarea | - | Comma-separated field IDs |
| Teams Webhook URL | `custrecord_gc_teams_webhook` | Textarea | - | MS Teams integration |
| Slack Webhook URL | `custrecord_gc_slack_webhook` | Textarea | - | Slack integration |
| Bulk Approval Limit | `custrecord_gc_bulk_limit` | Integer | 50 | Max bulk approvals |
| Fallback Approval Path | `custrecord_gc_fallback_path` | Select | - | Path when no rule matches |
| Fallback Approver Role | `custrecord_gc_fallback_approver` | Select | - | Role when no path found |

---

## 5. Transaction Body Fields

### Applied to: Purchase Order and Vendor Bill

| # | Name | Script ID | Type | Description |
|---|------|-----------|------|-------------|
| 1 | P2P Approval Status | `custbody_p2p_approval_status` | List/Record | Current workflow status |
| 2 | P2P Current Step | `custbody_p2p_current_step` | Integer | Current step sequence |
| 3 | P2P Current Approver | `custbody_p2p_current_approver` | List/Record (Employee) | Current assigned approver |
| 4 | P2P Matched Rule | `custbody_p2p_matched_rule` | List/Record | Decision rule that matched |
| 5 | P2P Approval Path | `custbody_p2p_approval_path` | List/Record | Approval path in use |
| 6 | P2P Match Reason | `custbody_p2p_match_reason` | Textarea | Explanation of rule match |
| 7 | P2P Exception Type | `custbody_p2p_exception_type` | List/Record | Matching exception (VB) |
| 8 | P2P Match Status | `custbody_p2p_match_status` | List/Record | 3-way match status (VB) |
| 9 | P2P AI Risk Score | `custbody_p2p_ai_risk_score` | Integer | Risk score (0-100) |
| 10 | P2P AI Risk Flags | `custbody_p2p_ai_risk_flags` | Textarea | Risk flag details |
| 11 | P2P AI Risk Summary | `custbody_p2p_ai_risk_summary` | Textarea | Risk assessment summary |
| 12 | P2P AI Exception Suggestion | `custbody_p2p_ai_exception_suggestion` | Textarea | AI-suggested actions |
| 13 | P2P Revision Number | `custbody_p2p_revision_number` | Integer | PO revision tracking |
| 14 | P2P Submitted By | `custbody_p2p_submitted_by` | List/Record (Employee) | Who submitted |
| 15 | P2P Submitted Date | `custbody_p2p_submitted_date` | Date/Time | When submitted |
| 16 | P2P Final Approver | `custbody_p2p_final_approver` | List/Record (Employee) | Last approver |
| 17 | P2P Base Amount | `custbody_p2p_base_amount` | Currency | Amount in base currency |
| 18 | P2P Exchange Rate | `custbody_p2p_exchange_rate` | Decimal | Exchange rate used |
| 19 | P2P Original Currency | `custbody_p2p_orig_currency` | List/Record | Original currency |

---

## 6. Script Files

### 6.1 Library Modules (lib/)

| File | Internal ID | Purpose |
|------|-------------|---------|
| p2p_constants_v2.js | 61908 | All script IDs, field IDs, constants |
| p2p_config.js | 61915 | Loads and caches Global Config |
| p2p_controller.js | 61916 | Main workflow orchestration |
| p2p_rule_matcher.js | 61918 | Evaluates decision rules |
| p2p_path_runner.js | 61917 | Executes approval paths |
| p2p_delegation_manager.js | 61910 | Handles delegations |
| p2p_token_manager.js | 61914 | Email approval tokens |
| p2p_notification_manager.js | 61930 | Email, Teams, Slack notifications |
| p2p_history_logger.js | 61913 | Audit trail logging |
| p2p_matching_engine.js | 61909 | 3-way matching for VB |

### 6.2 User Event Scripts (user_event/)

| File | Internal ID | Applies To |
|------|-------------|------------|
| p2p_po_ue.js | 61919 | Purchase Order |
| p2p_vb_ue.js | 61920 | Vendor Bill |

### 6.3 Client Scripts (client/)

| File | Internal ID | Applies To |
|------|-------------|------------|
| p2p_po_cs.js | 61921 | Purchase Order |
| p2p_vb_cs.js | 61922 | Vendor Bill |

### 6.4 Suitelets (suitelet/)

| File | Internal ID | Purpose |
|------|-------------|---------|
| p2p_email_approval_sl.js | 61923 | One-click email approve/reject |
| p2p_bulk_approval_sl.js | 61924 | Bulk approval interface |
| p2p_delegation_sl.js | 61925 | Self-service delegation management |

### 6.5 Scheduled Scripts (scheduled/)

| File | Internal ID | Purpose |
|------|-------------|---------|
| p2p_reminder_ss.js | 61926 | Sends approval reminders |
| p2p_escalation_ss.js | 61927 | Escalates overdue approvals |
| p2p_migration_ss.js | 61928 | Migrates v1 rules to v2 |

### 6.6 RESTlet (restlet/)

| File | Internal ID | Purpose |
|------|-------------|---------|
| p2p_action_rl.js | 61929 | API for approval actions |

---

## 7. Script Deployments

### 7.1 User Event Scripts

| Script | Script ID | Deploy ID | Applied To | Status | Execute As |
|--------|-----------|-----------|------------|--------|------------|
| P2P PO User Event | `customscript_p2p_po_ue` | `customdeploy_p2p_po_ue` | Purchase Order | Testing | Administrator |
| P2P VB User Event | `customscript_p2p_vb_ue` | `customdeploy_p2p_vb_ue` | Vendor Bill | Testing | Administrator |

### 7.2 Suitelets

| Script | Script ID | Deploy ID | Status | Available Without Login |
|--------|-----------|-----------|--------|------------------------|
| P2P Email Approval | `customscript_p2p_email_approval_sl` | `customdeploy_p2p_email_approval` | Released | **YES** (Critical) |
| P2P Bulk Approval | `customscript_p2p_bulk_approval_sl` | `customdeploy_p2p_bulk_approval` | Released | No |
| P2P Delegation | `customscript_p2p_delegation_sl` | `customdeploy_p2p_delegation` | Released | No |

### 7.3 Scheduled Scripts

| Script | Script ID | Deploy ID | Status | Schedule | Start Time |
|--------|-----------|-----------|--------|----------|------------|
| P2P Reminder | `customscript_p2p_reminder_ss` | `customdeploy_p2p_reminder` | Released | Every 4 hours | 6:00 AM |
| P2P Escalation | `customscript_p2p_escalation_ss` | `customdeploy_p2p_escalation` | Released | Every 4 hours | 7:00 AM |
| P2P Migration | `customscript_p2p_migration_ss` | `customdeploy_p2p_migration` | Not Scheduled | Manual | - |

### 7.4 RESTlet

| Script | Script ID | Deploy ID | Status | All Roles |
|--------|-----------|-----------|--------|-----------|
| P2P Action API | `customscript_p2p_action_rl` | `customdeploy_p2p_action` | Released | Yes |

---

## 8. Configuration Guide

### 8.1 Initial Setup Steps

1. **Verify Global Config Record**
   - Navigate to: Lists > Custom > P2P Global Config
   - Ensure one record exists (created by migration script)
   - Review and adjust default values as needed

2. **Create Approval Paths**
   - Navigate to: Lists > Custom > P2P Approval Path
   - Create paths like:
     - "Single Approver" - one manager
     - "Two-Level" - manager → director
     - "Three-Level" - manager → director → VP

3. **Create Path Steps**
   - For each path, create steps with sequence numbers
   - Set approver type (Employee, Role, Supervisor)
   - Set execution mode (Serial or Parallel)

4. **Create Decision Rules**
   - Navigate to: Lists > Custom > P2P Decision Rule
   - Create rules for different scenarios:
     - Low value POs ($0-$5,000) → Single Approver path
     - Medium value POs ($5,000-$25,000) → Two-Level path
     - High value POs ($25,000+) → Three-Level path

5. **Set Deployment Status to Released**
   - Change PO and VB User Event deployments from Testing to Released

### 8.2 Example Decision Rule Configuration

**Rule: Standard PO Under $5,000**
```
Code: STD_PO_LOW
Transaction Type: Purchase Order
Subsidiary: (blank = all)
Amount Min: 0
Amount Max: 4999.99
Priority: 100
Approval Path: Single Manager Approval
Active: Yes
```

**Rule: High Value PO Over $25,000**
```
Code: HIGH_VALUE_PO
Transaction Type: Purchase Order
Subsidiary: (blank = all)
Amount Min: 25000
Amount Max: (blank = no max)
Priority: 10
Approval Path: Three-Level Executive
Active: Yes
```

### 8.3 Webhook Configuration (Optional)

**Microsoft Teams:**
1. Create incoming webhook in Teams channel
2. Copy webhook URL
3. Paste into Global Config > Teams Webhook URL

**Slack:**
1. Create incoming webhook in Slack workspace
2. Copy webhook URL
3. Paste into Global Config > Slack Webhook URL

---

## 9. Testing Guide

### 9.1 Test Checklist

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create PO under $5,000 | Routes to single approver |
| 2 | Create PO over $25,000 | Routes to 3-level path |
| 3 | Approve via UI button | Task completed, advances to next step |
| 4 | Reject via UI button | Transaction rejected, requestor notified |
| 5 | Approve via email link | One-click approval works |
| 6 | Create delegation | Approvals route to delegate |
| 7 | Bulk approve multiple | All selected items processed |
| 8 | VB 3-way matching | Exceptions flagged correctly |
| 9 | Wait 24+ hours | Reminder email sent |
| 10 | Wait 72+ hours | Escalation to manager |

### 9.2 Viewing Execution Logs

1. Go to: Customization > Scripting > Script Deployments
2. Click on deployment name
3. Go to "Execution Log" tab
4. Filter by Type: Error, Debug, or Audit

### 9.3 Checking Approval History

1. Open a Purchase Order or Vendor Bill
2. Scroll down to find "P2P Approval History" section
3. View all actions taken with timestamps

---

## 10. Troubleshooting

### 10.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "No matching approval rule found" | No rule covers the transaction criteria | Create a rule or set fallback path in Global Config |
| Email approval link not working | Available Without Login = No | Edit Email Approval deployment, set to Yes |
| MODULE_DOES_NOT_EXIST error | Import path has _v2 suffix | Update import to remove _v2 suffix |
| Buttons not appearing | Deployment status = Testing | Change to Released |
| Approval not advancing | Parallel mode waiting for all | Check if other approvers have pending tasks |

### 10.2 Useful Searches

**Find Pending Approval Tasks:**
```
Type: P2P Approval Task
Filters: Status = Pending
```

**Find Approval History for Transaction:**
```
Type: P2P Approval History
Filters: Transaction ID = [ID]
```

### 10.3 Script Parameter Reference

The RESTlet accepts these actions:
- `submit` - Submit for approval
- `approve` - Approve pending task
- `reject` - Reject pending task
- `recall` - Recall submitted transaction
- `resubmit` - Resubmit rejected transaction
- `previewMatch` - Preview rule/path match without submission
- `parallelAnyScenario` - Admin-only Parallel Any scenario runner
- `recheckMatching` - Re-run 3-way matching (VB only)
- `approveException` - Approve with exception override

---

## Appendix A: Field ID Quick Reference

### Transaction Body Fields
```
custbody_p2p_approval_status
custbody_p2p_current_step
custbody_p2p_current_approver
custbody_p2p_matched_rule
custbody_p2p_approval_path
custbody_p2p_match_reason
custbody_p2p_exception_type
custbody_p2p_match_status
custbody_p2p_ai_risk_score
custbody_p2p_ai_risk_flags
custbody_p2p_ai_risk_summary
custbody_p2p_ai_exception_suggestion
custbody_p2p_revision_number
custbody_p2p_submitted_by
custbody_p2p_submitted_date
custbody_p2p_final_approver
custbody_p2p_base_amount
custbody_p2p_exchange_rate
custbody_p2p_orig_currency
```

### Custom Record Type IDs
```
customrecord_p2p_decision_rule
customrecord_p2p_approval_path
customrecord_p2p_path_step
customrecord_p2p_approval_task
customrecord_p2p_approval_history
customrecord_p2p_delegation
customrecord_p2p_global_config
customrecord_p2p_dept_group
customrecord_p2p_dept_group_member
customrecord_p2p_loc_group
customrecord_p2p_loc_group_member
customrecord_p2p_delegation_scope
```

### Custom List IDs
```
customlist_p2p_approval_action
customlist_p2p_approval_method
customlist_p2p_approval_status
customlist_p2p_approver_type
customlist_p2p_exception_type_list
customlist_p2p_execution_mode
customlist_p2p_match_status
customlist_p2p_reapproval_mode
customlist_p2p_task_status
customlist_p2p_tran_type
```

---

## Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | Jan 31, 2026 | Initial v2 deployment with Decision Table architecture |

---

*P2P Approval Workflow v2 - Decision Table Architecture*
*© 2026 - Documentation generated for NetSuite deployment*
