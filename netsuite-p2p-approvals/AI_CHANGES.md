# AI + Approval Enhancements (Change Log)

This file summarizes all changes made to support AI risk scoring,
risk-based routing, anomaly detection, and Teams/Slack notifications.

## Overview
- Added AI risk routing support (min risk score on approval rules).
- Added AI summary + exception suggestion fields.
- Added anomaly detection flags for Vendor Bills.
- Added optional auto-approve for low-risk Purchase Orders only.
- Added Teams and Slack webhook notifications with AI context.
- Hardened suitelets with input validation and clearer UI.
- Added PO revision tracking and auto re-approval on changes.

## New/Updated NetSuite Objects
- New approval rule field:
  - `custrecord_p2p_ar_min_risk_score` (Min AI Risk Score)
- New transaction body fields:
  - `custbody_p2p_ai_risk_summary` (P2P AI Risk Summary)
  - `custbody_p2p_ai_exception_suggestion` (P2P AI Exception Suggestion)
  - `custbody_p2p_revision_number` (P2P Revision Number)

## New/Updated Script Parameters
- AI routing / auto-approve:
  - `custscript_p2p_auto_approve_threshold` (decimal, PO only)
- Anomaly tuning:
  - `custscript_p2p_new_vendor_days`
  - `custscript_p2p_min_vendor_bills_account_anom`
- Notifications:
  - `custscript_p2p_teams_webhook`
  - `custscript_p2p_slack_webhook`

## Behavioral Changes
- Risk-based routing:
  - Approval rules can match only when `AI Risk Score >= Min AI Risk Score`.
- Auto-approve:
  - Only for Purchase Orders.
  - Only when `riskScore <= threshold`, no exceptions, and no risk flags.
- Anomaly detection (Vendor Bills):
  - New vendor (created within last N days and no prior bills).
  - Price variance over limit (existing logic).
  - New account for vendor (only after sufficient vendor history).
  - Anomalies are appended to `custbody_p2p_ai_risk_flags`.
- PO revision handling:
  - If an approved PO is edited and material fields or line items change, the
    record is reset to Draft, revision number is incremented, and the approval
    flow restarts automatically.

## Default Thresholds (Conservative)
- `NEW_VENDOR_DAYS`: 14
- `MIN_VENDOR_BILLS_FOR_ACCOUNT_ANOMALY`: 5

## Files Changed / Added
- Updated:
  - `src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_approval_engine.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_matching_engine.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/lib/p2p_notification_manager.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/restlet/p2p_ai_integration_rl.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/user_event/p2p_po_ue.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/user_event/p2p_vb_ue.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/suitelet/p2p_email_approval_sl.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/suitelet/p2p_bulk_approval_sl.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/suitelet/p2p_delegation_sl.js`
  - `src/FileCabinet/SuiteScripts/p2p_approvals/constants/p2p_constants.js`
  - `src/Objects/Records/customrecord_p2p_approval_rule.xml`
  - `src/Objects/Scripts/customscript_p2p_po_ue.xml`
  - `src/Objects/Scripts/customscript_p2p_vb_ue.xml`
  - `src/Objects/Scripts/customscript_p2p_email_approval_sl.xml`
  - `src/Objects/Scripts/customscript_p2p_bulk_approval_sl.xml`
  - `src/Objects/Scripts/customscript_p2p_bulk_process_mr.xml`
  - `src/Objects/Scripts/customscript_p2p_reminder_ss.xml`
  - `src/Objects/Scripts/customscript_p2p_escalation_ss.xml`
  - `src/Objects/Scripts/customscript_p2p_ai_integration_rl.xml`
- Added:
  - `src/Objects/Fields/custbody_p2p_ai_risk_summary.xml`
  - `src/Objects/Fields/custbody_p2p_ai_exception_suggestion.xml`

