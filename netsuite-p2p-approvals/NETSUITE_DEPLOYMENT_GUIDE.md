# P2P Approval Workflow v2 – NetSuite Deployment Guide

Step-by-step instructions for deploying and updating scripts and fields in NetSuite. Use this guide whenever you pull code changes and need to sync your NetSuite account.

---

## Table of Contents

1. [Script Files to Upload](#1-script-files-to-upload)
2. [Script Deployments](#2-script-deployments)
3. [Custom Records](#3-custom-records)
4. [Custom Fields](#4-custom-fields)
5. [Custom Lists](#5-custom-lists)
6. [Native Approval Status Sync](#6-native-approval-status-sync)
7. [Bulk Approval Client Script (Required)](#7-bulk-approval-client-script-required)
8. [Field ID Verification](#8-field-id-verification)
9. [Hardcoded Script/Deployment IDs](#9-hardcoded-scriptdeployment-ids)

---

## 1. Script Files to Upload

Upload each file to the **exact** path shown. In NetSuite: **Customization > Scripting > Scripts > New** (or edit existing), then set the **File** path.

| # | NetSuite File Path | Local File |
|---|--------------------|------------|
| 1 | `SuiteScripts/p2p_approvals/constants/p2p_constants_v2.js` | `constants/p2p_constants_v2.js` |
| 2 | `SuiteScripts/p2p_approvals/lib/p2p_config.js` | `lib/p2p_config.js` |
| 3 | `SuiteScripts/p2p_approvals/lib/p2p_controller.js` | `lib/p2p_controller.js` |
| 4 | `SuiteScripts/p2p_approvals/lib/p2p_rule_matcher.js` | `lib/p2p_rule_matcher.js` |
| 5 | `SuiteScripts/p2p_approvals/lib/p2p_path_runner.js` | `lib/p2p_path_runner.js` |
| 6 | `SuiteScripts/p2p_approvals/lib/p2p_history_logger.js` | `lib/p2p_history_logger.js` |
| 7 | `SuiteScripts/p2p_approvals/lib/p2p_token_manager.js` | `lib/p2p_token_manager.js` |
| 8 | `SuiteScripts/p2p_approvals/lib/p2p_notification_manager.js` | `lib/p2p_notification_manager.js` |
| 9 | `SuiteScripts/p2p_approvals/lib/p2p_native_status_sync.js` | `lib/p2p_native_status_sync.js` |
| 10 | `SuiteScripts/p2p_approvals/lib/p2p_delegation_manager.js` | `lib/p2p_delegation_manager.js` |
| 11 | `SuiteScripts/p2p_approvals/lib/p2p_matching_engine.js` | `lib/p2p_matching_engine.js` |
| 12 | `SuiteScripts/p2p_approvals/restlet/p2p_action_rl.js` | `restlet/p2p_action_rl.js` |
| 13 | `SuiteScripts/p2p_approvals/suitelet/p2p_bulk_approval_sl.js` | `suitelet/p2p_bulk_approval_sl.js` |
| 14 | `SuiteScripts/p2p_approvals/suitelet/p2p_delegation_sl.js` | `suitelet/p2p_delegation_sl.js` |
| 15 | `SuiteScripts/p2p_approvals/suitelet/p2p_email_approval_sl.js` | `suitelet/p2p_email_approval_sl.js` |
| 16 | `SuiteScripts/p2p_approvals/suitelet/p2p_config_portal_sl.js` | `suitelet/p2p_config_portal_sl.js` |
| 17 | `SuiteScripts/p2p_approvals/suitelet/p2p_analytics_sl.js` | `suitelet/p2p_analytics_sl.js` |
| 18 | `SuiteScripts/p2p_approvals/suitelet/p2p_rule_builder_sl.js` | `suitelet/p2p_rule_builder_sl.js` |
| 18 | `SuiteScripts/p2p_approvals/user_event/p2p_po_ue.js` | `user_event/p2p_po_ue.js` |
| 19 | `SuiteScripts/p2p_approvals/user_event/p2p_vb_ue.js` | `user_event/p2p_vb_ue.js` |
| 20 | `SuiteScripts/p2p_approvals/user_event/p2p_so_ue.js` | `user_event/p2p_so_ue.js` |
| 21 | `SuiteScripts/p2p_approvals/user_event/p2p_inv_ue.js` | `user_event/p2p_inv_ue.js` |
| 22 | `SuiteScripts/p2p_approvals/client/p2p_po_cs.js` | `client/p2p_po_cs.js` |
| 23 | `SuiteScripts/p2p_approvals/client/p2p_vb_cs.js` | `client/p2p_vb_cs.js` |
| 24 | `SuiteScripts/p2p_approvals/client/p2p_so_cs.js` | `client/p2p_so_cs.js` |
| 25 | `SuiteScripts/p2p_approvals/client/p2p_inv_cs.js` | `client/p2p_inv_cs.js` |
| 26 | `SuiteScripts/p2p_approvals/client/p2p_bulk_approval_cs.js` | `client/p2p_bulk_approval_cs.js` |
| 27 | `SuiteScripts/p2p_approvals/scheduled/p2p_escalation_ss.js` | `scheduled/p2p_escalation_ss.js` |
| 28 | `SuiteScripts/p2p_approvals/scheduled/p2p_reminder_ss.js` | `scheduled/p2p_reminder_ss.js` |
| 29 | `SuiteScripts/p2p_approvals/scheduled/p2p_migration_ss.js` | `scheduled/p2p_migration_ss.js` |

---

## 2. Script Deployments

Create or update deployments for each script. **Customization > Scripting > Script Deployments**.

### 2.1 RESTlet – P2P Action

| Setting | Value |
|---------|-------|
| Script | `p2p_action_rl` (or your RESTlet script ID) |
| ID | `customdeploy_p2p_action` |
| Status | Released |
| Log Level | Debug (or Error in prod) |
| Execute As | Administrator (or role with access) |

### 2.2 Suitelet – Bulk Approval

| Setting | Value |
|---------|-------|
| Script | `p2p_bulk_approval_sl` |
| ID | `customdeploy_p2p_bulk_approval` |
| Status | Released |
| Log Level | Debug (or Error in prod) |

### 2.3 Suitelet – Email Approval

| Setting | Value |
|---------|-------|
| Script | `p2p_email_approval_sl` |
| ID | `customdeploy_p2p_email_approval` |
| Status | Released |

### 2.4 Suitelet – Config Portal

| Setting | Value |
|---------|-------|
| Script | `p2p_config_portal_sl` |
| ID | `customdeploy_p2p_config_portal` |
| Status | Released |
| Log Level | Debug (or Error in prod) |

**Access:** Use the deployment URL or add it to a custom menu for admins.

### 2.5 Suitelet – Analytics Dashboard

| Setting | Value |
|---------|-------|
| Script | `p2p_analytics_sl` |
| ID | `customdeploy_p2p_analytics` |
| Status | Released |
| Log Level | Debug (or Error in prod) |

**Access:** Use the deployment URL or add it to a custom menu for admins.

### 2.6 Suitelet – Rule Builder

| Setting | Value |
|---------|-------|
| Script | `p2p_rule_builder_sl` |
| ID | `customdeploy_p2p_rule_builder` |
| Status | Released |
| Log Level | Debug (or Error in prod) |

**Access:** Use the deployment URL or open from Config Portal.

### 2.7 Suitelet – Delegation

| Setting | Value |
|---------|-------|
| Script | `p2p_delegation_sl` |
| ID | `customdeploy_p2p_delegation` |
| Status | Released |

### 2.8 User Event – Purchase Order

| Setting | Value |
|---------|-------|
| Script | `p2p_po_ue` |
| ID | `customdeploy_p2p_po_ue` |
| Status | Released |
| Record Type | Purchase Order |

### 2.9 User Event – Vendor Bill

| Setting | Value |
|---------|-------|
| Script | `p2p_vb_ue` |
| ID | `customdeploy_p2p_vb_ue` |
| Status | Released |
| Log Level | Debug (or Error in prod) |
| Record Type | Vendor Bill |

### 2.10 User Event – Sales Order

| Setting | Value |
|---------|-------|
| Script | `p2p_so_ue` |
| ID | `customdeploy_p2p_so_ue` |
| Status | Released |
| Log Level | Debug (or Error in prod) |
| Record Type | Sales Order |

### 2.11 User Event – Invoice

| Setting | Value |
|---------|-------|
| Script | `p2p_inv_ue` |
| ID | `customdeploy_p2p_inv_ue` |
| Status | Released |
| Log Level | Debug (or Error in prod) |
| Record Type | Invoice (Customer Invoice) |

| Setting | Value |
|---------|-------|
| Script | `p2p_vb_ue` |
| ID | `customdeploy_p2p_vb_ue` |
| Status | Released |
| Record Type | Vendor Bill |

### 2.12 Scheduled Scripts

| Script | Deployment ID | Schedule |
|--------|---------------|----------|
| `p2p_escalation_ss` | `customdeploy_p2p_escalation` | Daily (e.g. 6:00 AM) |
| `p2p_reminder_ss` | `customdeploy_p2p_reminder` | Daily (e.g. 8:00 AM) |
| `p2p_migration_ss` | `customdeploy_p2p_migration` | One-time or manual |

---

## 3. Custom Records

Ensure these custom records exist. **Customization > Lists, Records & Fields > Record Types**.

| Record Type | Internal ID (typical) |
|-------------|------------------------|
| P2P Decision Rule | `customrecord_p2p_decision_rule` |
| P2P Approval Path | `customrecord_p2p_approval_path` |
| P2P Path Step | `customrecord_p2p_path_step` |
| P2P Global Config | `customrecord_p2p_global_config` |
| P2P Approval Task | `customrecord_p2p_approval_task` |
| P2P Approval History | `customrecord_p2p_approval_history` |
| P2P Delegation | `customrecord_p2p_delegation` |

---

## 4. Custom Fields

### 4.1 P2P Path Step – Active Field

If missing, add an **Active** checkbox to the P2P Path Step record:

1. **Customization > Lists, Records & Fields > Record Types > P2P Path Step**
2. **Fields** tab > **Add Field**
3. Type: **Checkbox**
4. ID: `custrecord_ps_active` (or `custrecord_p2p_ps_active` if you use that)
5. Label: **Active**
6. Default: Checked

If your field ID differs, update `STEP_FIELDS.ACTIVE` in `p2p_constants_v2.js`.

### 4.2 Decision Rule – Priority Field

Ensure the Decision Rule record has a **Priority** field:

1. **Customization > Lists, Records & Fields > Record Types > P2P Decision Rule**
2. Field ID: `custrecord_dr_priority` (or `custrecord_p2p_dr_priority`)
3. Type: **Integer**
4. Label: **Priority**

If your field ID differs, update `DECISION_RULE_FIELDS.PRIORITY` in `p2p_constants_v2.js`.

### 4.3 Vendor Bill – Submitted By (Optional)

For VB recall to use a dedicated submitter field:

1. **Customization > Lists, Records & Fields > Transaction Body Fields**
2. Create on **Vendor Bill**
3. ID: `custbody_p2p_submitted_by`
4. Type: **List/Record** (Employee)
5. Label: **Submitted By**

If you skip this, recall uses `createdby` / `employee` as fallback.

### 4.4 Transaction Body Fields (PO, VB, Sales Order, Invoice)

Ensure these exist on **Purchase Order**, **Vendor Bill**, **Sales Order**, and **Invoice** (Customer Invoice):

| Field ID | Type | Label |
|----------|------|-------|
| `custbody_p2p_approval_status` | List/Record (P2P Approval Status) | P2P Approval Status |
| `custbody_p2p_current_step` | Free-Form Text | P2P Current Step |
| `custbody_p2p_current_approver` | List/Record (Employee) | P2P Current Approver |
| `custbody_p2p_matched_rule` | List/Record (P2P Decision Rule) | P2P Matched Rule |
| `custbody_p2p_approval_path` | List/Record (P2P Approval Path) | P2P Approval Path |
| `custbody_p2p_match_reason` | Free-Form Text | P2P Match Reason |
| `custbody_p2p_ai_risk_score` | Decimal | P2P AI Risk Score |
| `custbody_p2p_ai_risk_flags` | Free-Form Text | P2P AI Risk Flags |
| `custbody_p2p_revision_number` | Integer | P2P Revision (PO only) |
| `custbody_p2p_exception_type` | List/Record | P2P Exception Type (VB only) |
| `custbody_p2p_match_status` | List/Record | P2P Match Status (VB only) |

**Notes:**
- `custbody_p2p_revision_number` is only required on **Purchase Order**.
- `custbody_p2p_exception_type` and `custbody_p2p_match_status` are only required on **Vendor Bill**.

---

## 5. Custom Lists

All custom lists and their value internal IDs must match the constants in `p2p_constants_v2.js`. Verified against your NetSuite setup:

### P2P Approval Status (`customlist_p2p_approval_status`)

| Internal ID | Label |
|-------------|-------|
| 1 | Draft |
| 2 | Pending Submission |
| 3 | Pending Approval |
| 4 | Approved |
| 5 | Rejected |
| 6 | Recalled |
| 7 | Escalated |
| 8 | Pending Exception Review |

### P2P Approval Action (`customlist_p2p_approval_action`)

| Internal ID | Label |
|-------------|-------|
| 1 | Submitted |
| 2 | Approved |
| 3 | Rejected |
| 4 | Delegated |
| 5 | Escalated |
| 6 | Recalled |
| 7 | Reassigned |
| 8 | Comment Added |
| 9 | Exception Override |
| 10 | Resubmitted |
| 11 | Auto-Cancelled (Parallel-Any) |

### P2P Approval Method (`customlist_p2p_approval_method`)

| Internal ID | Label |
|-------------|-------|
| 1 | UI |
| 2 | Email |
| 3 | Bulk |
| 4 | API |
| 5 | Mobile |

### P2P Approver Type (`customlist_p2p_approver_type`)

| Internal ID | Label |
|-------------|-------|
| 1 | Specific Employee |
| 2 | Supervisor |
| 3 | Department Manager |
| 4 | Subsidiary Manager |
| 5 | Role |
| 6 | Custom Field |
| 7 | Script |

### P2P Execution Mode (`customlist_p2p_execution_mode`)

| Internal ID | Label |
|-------------|-------|
| 1 | Serial |
| 2 | Parallel |
| 3 | Parallel Any |

### P2P Task Status (`customlist_p2p_task_status`)

| Internal ID | Label |
|-------------|-------|
| 1 | Pending |
| 2 | Approved |
| 3 | Rejected |
| 4 | Delegated |
| 5 | Escalated |
| 6 | Cancelled |
| 7 | Expired |

### P2P Transaction Type (`customlist_p2p_tran_type`)

| Internal ID | Label |
|-------------|-------|
| 1 | Purchase Order |
| 2 | Vendor Bill |
| 3 | Sales Order |
| 4 | Invoice |

### P2P Exception Type List (`customlist_p2p_exception_type_list`)

| Internal ID | Label |
|-------------|-------|
| 1 | None |
| 2 | Price Over Tolerance |
| 3 | Quantity Over |
| 4 | Quantity Under |
| 5 | Missing PO |
| 6 | Missing Receipt |
| 7 | Duplicate Invoice |
| 8 | Vendor Mismatch |
| 9 | Currency Mismatch |
| 10 | Multiple Exceptions |

### P2P Match Status (`customlist_p2p_match_status`)

| Internal ID | Label |
|-------------|-------|
| 1 | Not Matched |
| 2 | Matched |
| 3 | Partial Match |
| 4 | Price Variance |
| 5 | Quantity Variance |
| 6 | PO Not Found |
| 7 | Receipt Missing |
| 8 | Exception Overridden |

### P2P Reapproval Mode (`customlist_p2p_reapproval_mode`)

| Internal ID | Label |
|-------------|-------|
| 1 | Material |
| 2 | Any |

---

## 6. Native Approval Status Sync

The P2P workflow keeps NetSuite's **native** `approvalstatus` field in sync with the P2P custom status. This prevents:

- Records showing "PENDING APPROVAL" banner after rejection
- Confusion when Approval Routing shows "Rejected" but status shows "Pending Approval"
- Posting issues (rejected records should not post)

**Mapping (typical NetSuite values):**

| Native Internal ID | Label | When Set |
|--------------------|-------|----------|
| 1 | Pending Approval | Submit, Recall, Resubmit (before re-submit) |
| 2 | Approved | Full approval, Auto-approve |
| 3 | Rejected | Rejection |

**Verification:** In your account, go to **Setup > Lists > Approval Status** (or search for the Approval Status list). Confirm internal IDs match: 1=Pending Approval, 2=Approved, 3=Rejected. If your account uses different IDs, update `NATIVE_APPROVAL_STATUS` in `p2p_constants_v2.js`.

Reference: [NetSuite Approval Status Internal IDs](https://www.netsuiterp.com/2019/03/approval-status-list-internal-ids.html)

---

## 7. Bulk Approval Client Script (Required)

The Bulk Approval Client Script is attached to the Suitelet form and provides:

- **Mandatory comment when rejecting** – Blocks form submit until a comment is entered
- Tran # as clickable link (when applicable)
- Apply Filters (when filter UI is present)

**Deployment:** The client script does *not* need a separate deployment. It is loaded by the Suitelet via `form.clientScriptModulePath`. Ensure:

1. `p2p_bulk_approval_cs.js` is uploaded to `SuiteScripts/p2p_approvals/client/p2p_bulk_approval_cs.js`
2. The Bulk Approval Suitelet is deployed

If you see `MODULE_DOES_NOT_EXIST` when loading the bulk approval page, verify the client script file exists at the path above.

---

## 8. Field ID Verification

If you see errors like `SSS_INVALID_SRCH_COL` or `invalid column`, your field IDs may differ. Check:

1. **Customization > Lists, Records & Fields > Record Types**
2. Open the record type (e.g. P2P Decision Rule, P2P Path Step)
3. Compare your field IDs with `p2p_constants_v2.js`
4. Update the constants file to match your NetSuite IDs, then re-upload

### P2P Decision Rule (`customrecord_p2p_decision_rule`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `TRAN_TYPE` | `custrecord_p2p_dr_tran_type` | List/Record (P2P Transaction Type) |
| `SUBSIDIARY` | `custrecord_p2p_dr_subsidiary` | List/Record (Subsidiary) |
| `DEPARTMENT` | `custrecord_p2p_dr_department` | List/Record (Department) |
| `LOCATION` | `custrecord_p2p_dr_location` | List/Record (Location) |
| `DEPT_GROUP` | `custrecord_p2p_dr_dept_group` | List/Record (P2P Department Group) |
| `LOC_GROUP` | `custrecord_p2p_dr_loc_group` | List/Record (P2P Location Group) |
| `AMT_MIN` | `custrecord_p2p_dr_amt_from` | Currency |
| `AMT_MAX` | `custrecord_p2p_dr_amt_to` | Currency |
| `CURRENCY` | `custrecord_p2p_dr_currency` | List/Record (Currency) |
| `RISK_MIN` | `custrecord_p2p_dr_min_risk` | Decimal Number |
| `RISK_MAX` | `custrecord_p2p_dr_max_risk` | Decimal Number |
| `EXCEPTION` | `custrecord_p2p_dr_exception` | List/Record (P2P Exception Type List) |
| `CUSTOMER` | `custrecord_p2p_dr_customer` | List/Record (Customer) |
| `SALES_REP` | `custrecord_p2p_dr_sales_rep` | List/Record (Employee) |
| `PROJECT` | `custrecord_p2p_dr_project` | List/Record (Project/Job) |
| `CLASS` | `custrecord_p2p_dr_class` | List/Record (Class) |
| `CUSTOM_SEG_FIELD` | `custrecord_p2p_dr_customseg_field` | Free-Form Text (field ID) |
| `CUSTOM_SEG_VALUES` | `custrecord_p2p_dr_customseg_values` | Free-Form Text (comma-separated IDs) |
| `PRIORITY` | `custrecord_dr_priority` | Integer Number |
| `PATH` | `custrecord_p2p_dr_path` | List/Record (P2P Approval Path) |
| `EFF_FROM` | `custrecord_p2p_dr_eff_from` | Date |
| `EFF_TO` | `custrecord_p2p_dr_eff_to` | Date |
| `ACTIVE` | `custrecord_p2p_dr_active` | Check Box |

Note: For `CUSTOM_SEG_FIELD`, enter the transaction body field ID (for example `custbody_cseg_region`). If your account blocks IDs containing `_cseg`, use the `customseg` IDs above for the decision rule fields (they avoid the reserved prefix).

### P2P Global Config (`customrecord_p2p_global_config`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `PRICE_VAR_PCT` | `custrecord_gc_price_var_pct` | Percent |
| `PRICE_VAR_AMT` | `custrecord_gc_price_var_amt` | Currency |
| `FX_TOLERANCE_PCT` | `custrecord_gc_fx_tolerance_pct` | Percent |
| `PO_THRESHOLD` | `custrecord_gc_po_threshold` | Currency |
| `REMINDER_1_HRS` | `custrecord_gc_reminder_1_hrs` | Integer Number |
| `REMINDER_2_HRS` | `custrecord_gc_reminder_2_hrs` | Integer Number |
| `ESCALATION_HRS` | `custrecord_gc_escalation_hrs` | Integer Number |
| `TOKEN_EXPIRY_HRS` | `custrecord_gc_token_expiry_hrs` | Integer Number |
| `MAX_DELEGATION_DAYS` | `custrecord_gc_max_delegation_days` | Integer Number |
| `AUTO_APPROVE_ENABLED` | `custrecord_gc_auto_approve_enabled` | Check Box |
| `AUTO_APPROVE_THRESHOLD` | `custrecord_gc_auto_approve_threshold` | Integer Number |
| `NEW_VENDOR_DAYS` | `custrecord_gc_new_vendor_days` | Integer Number |
| `MIN_VB_ACCT_ANOM` | `custrecord_gc_min_vb_acct_anom` | Integer Number |
| `REAPPROVAL_MODE` | `custrecord_gc_reapproval_mode` | List/Record (P2P Reapproval Mode) |
| `REAPPROVAL_BODY` | `custrecord_gc_reapproval_body` | Text Area |
| `REAPPROVAL_ITEM` | `custrecord_gc_reapproval_item` | Text Area |
| `REAPPROVAL_EXPENSE` | `custrecord_gc_reapproval_expense` | Text Area |
| `TEAMS_WEBHOOK` | `custrecord_gc_teams_webhook` | Text Area |
| `SLACK_WEBHOOK` | `custrecord_gc_slack_webhook` | Text Area |
| `BULK_LIMIT` | `custrecord_gc_bulk_limit` | Integer Number |
| `FALLBACK_PATH` | `custrecord_gc_fallback_path` | List/Record (P2P Approval Path) |
| `FALLBACK_APPROVER` | `custrecord_gc_fallback_approver` | List/Record (Role) |

### P2P Path Step (`customrecord_p2p_path_step`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `PATH` | `custrecord_p2p_ps_path` | List/Record (P2P Approval Path) |
| `SEQUENCE` | `custrecord_p2p_ps_sequence` | Integer Number |
| `NAME` | `custrecord_p2p_ps_name` | *(optional; falls back to "Step N")* |
| `APPROVER_TYPE` | `custrecord_p2p_ps_approver_type` | List/Record (P2P Approver Type) |
| `ROLE` | `custrecord_p2p_ps_role` | List/Record (Role) |
| `EMPLOYEE` | `custrecord_p2p_ps_employee` | List/Record (Employee) |
| `MODE` | `custrecord_p2p_ps_exec_mode` | List/Record (P2P Execution Mode) |
| `REQUIRE_COMMENT` | `custrecord_p2p_ps_require_comment` | Check Box |
| `SLA_HOURS` | `custrecord_p2p_ps_timeout_hours` | Integer Number |
| `ACTIVE` | `custrecord_ps_active` | Check Box |

### P2P Approval Path (`customrecord_p2p_approval_path`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `DESCRIPTION` | `custrecord_p2p_ap_description` | Text Area |
| `SLA_HOURS` | `custrecord_p2p_ap_sla_hours` | Integer Number |
| `ACTIVE` | `custrecord_p2p_ap_active` | Check Box |
| *(optional)* | `custrecord_p2p_ap_auto_threshold` | Decimal Number |
| *(optional)* | `custrecord_p2p_ap_code` | *(for path name display)* |
| *(optional)* | `custrecord_p2p_ap_step_summary` | *(not in your setup)* |

### P2P Approval Task (`customrecord_p2p_approval_task`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `TRAN_TYPE` | `custrecord_p2p_at_tran_type` | List/Record (P2P Transaction Type) |
| `TRAN_ID` | `custrecord_p2p_at_tran_id` | Integer Number |
| `PATH` | `custrecord_p2p_at_path` | List/Record (P2P Approval Path) |
| `PATH_STEP` | `custrecord_p2p_at_step` | List/Record (P2P Path Step) |
| `SEQUENCE` | `custrecord_p2p_at_sequence` | Integer Number |
| `APPROVER` | `custrecord_p2p_at_approver` | List/Record (Employee) |
| `ACTING_APPROVER` | `custrecord_p2p_at_acting_approver` | List/Record (Employee) |
| `STATUS` | `custrecord_p2p_at_status` | List/Record (P2P Task Status) |
| `CREATED` | `custrecord_p2p_at_created` | Date/Time |
| `COMPLETED` | `custrecord_p2p_at_completed` | Date/Time |
| `TOKEN` | `custrecord_p2p_at_token` | Free-Form Text |
| `TOKEN_EXPIRY` | `custrecord_p2p_at_token_expiry` | Date/Time |
| `REMINDER_COUNT` | `custrecord_p2p_at_reminder_count` | Integer Number |
| `ESCALATED` | `custrecord_p2p_at_escalated` | Check Box |
| `RULE_LEGACY` | `custrecord_p2p_at_rule` | List/Record (P2P Decision Rule) |

### P2P Approval History (`customrecord_p2p_approval_history`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `TRAN_TYPE` | `custrecord_p2p_ah_tran_type` | List/Record (P2P Transaction Type) |
| `TRAN_ID` | `custrecord_p2p_ah_tran_id` | Integer Number |
| `STEP_SEQUENCE` | `custrecord_p2p_ah_step_sequence` | Integer Number |
| `APPROVER` | `custrecord_p2p_ah_approver` | List/Record (Employee) |
| `ACTING_APPROVER` | `custrecord_p2p_ah_acting_approver` | List/Record (Employee) |
| `ACTION` | `custrecord_p2p_ah_action` | List/Record (P2P Approval Action) |
| `TIMESTAMP` | `custrecord_p2p_ah_timestamp` | Date/Time |
| `COMMENT` | `custrecord_p2p_ah_comment` | Text Area |
| `IP_ADDRESS` | `custrecord_p2p_ah_ip_address` | Free-Form Text |
| `METHOD` | `custrecord_p2p_ah_method` | List/Record (P2P Approval Method) |

### P2P Delegation (`customrecord_p2p_delegation`) – Verified Field IDs

| Constant | Field ID | Type |
|----------|----------|------|
| `ORIGINAL` | `custrecord_p2p_del_original` | List/Record (Employee) |
| `DELEGATE` | `custrecord_p2p_del_delegate` | List/Record (Employee) |
| `START_DATE` | `custrecord_p2p_del_start_date` | Date |
| `END_DATE` | `custrecord_p2p_del_end_date` | Date |
| `SUBSIDIARY` | `custrecord_p2p_del_subsidiary` | List/Record (Subsidiary) |
| `TRAN_TYPE` | `custrecord_p2p_del_tran_type` | List/Record (P2P Transaction Type) |
| `ACTIVE` | `custrecord_p2p_del_active` | Check Box |

### P2P Department Group Member (`customrecord_p2p_dept_group_member`) – Verified Field IDs

| Field | Field ID | Type |
|-------|----------|------|
| Group | `custrecord_p2p_dgm_group` | List/Record (P2P Department Group) |
| Department | `custrecord_p2p_dgm_department` | List/Record (Department) |

### P2P Location Group Member (`customrecord_p2p_loc_group_member`) – Verified Field IDs

| Field | Field ID | Type |
|-------|----------|------|
| Group | `custrecord_p2p_lgm_group` | List/Record (P2P Location Group) |
| Location | `custrecord_p2p_lgm_location` | List/Record (Location) |

### Common Field ID Mismatches

| Constant | Default ID | Alternative |
|----------|------------|-------------|
| `STEP_FIELDS.ACTIVE` | `custrecord_ps_active` | `custrecord_p2p_ps_active` |
| `DECISION_RULE_FIELDS.PRIORITY` | `custrecord_dr_priority` | `custrecord_p2p_dr_priority` |
| `TASK_FIELDS.PATH_STEP` | `custrecord_p2p_at_step` | `custrecord_p2p_at_path_step` |

---

## Quick Checklist After Code Changes

- [ ] Upload all changed `.js` files to the correct File Cabinet paths
- [ ] Update script deployments if script IDs changed
- [ ] Add any new custom fields listed above
- [ ] Verify custom list values (P2P Approval Status)
- [ ] Test: Submit PO for approval
- [ ] Test: Bulk Approval Suitelet
- [ ] Test: Approve/Reject from PO/VB form

---

---

## 9. Hardcoded Script/Deployment IDs

These IDs are used in the code. If your NetSuite IDs differ, update the corresponding files:

| Purpose | Script ID | Deployment ID | File |
|---------|-----------|---------------|------|
| RESTlet (PO & VB actions) | `customscript_p2p_action_rl` | `customdeploy_p2p_action` | `client/p2p_po_cs.js`, `client/p2p_vb_cs.js` |
| Bulk Approval Suitelet | `customscript_p2p_bulk_approval_sl` | `customdeploy_p2p_bulk_approval` | `suitelet/p2p_bulk_approval_sl.js`, `client/p2p_bulk_approval_cs.js` |
| Delegation Suitelet | `customscript_p2p_delegation_sl` | `customdeploy_p2p_delegation` | `suitelet/p2p_delegation_sl.js` |
| Email Approval Suitelet | `customscript_p2p_email_approval_sl` | `customdeploy_p2p_email_approval` | *(constants)* |
| P2P PO User Event | `customscript_p2p_po_ue` | `customdeploy_p2p_po_ue` | *(deployment only)* |
| P2P VB User Event | `customscript_p2p_vb_ue` | `customdeploy_p2p_vb_ue` | *(deployment only)* |
| Escalation Scheduled | `customscript_p2p_escalation_ss` | `customdeploy_p2p_escalation` | *(deployment only)* |
| Reminder Scheduled | `customscript_p2p_reminder_ss` | `customdeploy_p2p_reminder` | *(deployment only)* |
| Migration Scheduled | `customscript_p2p_migration_ss` | `customdeploy_p2p_migration` | *(deployment only)* |

**Note:** PO and VB both use `customdeploy_p2p_action` (one RESTlet deployment). If you have separate deployments, update `client/p2p_vb_cs.js` to use `customdeploy_p2p_action_rl`.

---

*Last updated: Based on current codebase. Re-run this checklist after each code sync.*
