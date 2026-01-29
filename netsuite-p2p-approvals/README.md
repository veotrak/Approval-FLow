# NetSuite P2P Approval System

This project implements a Procure-to-Pay approval workflow for Purchase Orders and Vendor Bills in NetSuite. It includes a rule-based approval matrix, delegation, email approvals, three-way matching for Vendor Bills, and full approval history logging.

## Setup

1. Deploy the SDF project to your NetSuite account.
2. Create custom lists and custom records from `src/Objects/Lists` and `src/Objects/Records`.
3. Install scripts and deployments from `src/Objects/Scripts/`.
4. Add transaction body fields from `src/Objects/Fields/`.
5. Verify scripts are deployed to Purchase Order and Vendor Bill records.

## Key Scripts

- User Events: `p2p_po_ue.js`, `p2p_vb_ue.js`
- Suitelets: `p2p_email_approval_sl.js`, `p2p_bulk_approval_sl.js`, `p2p_delegation_sl.js`
- Scheduled: `p2p_reminder_ss.js`, `p2p_escalation_ss.js`
- RESTlet: `p2p_ai_integration_rl.js`
- Map/Reduce: `p2p_bulk_process_mr.js`

## Script Parameters

- RESTlet (`p2p_ai_integration_rl.js`)
  - `custscript_p2p_allowed_roles`: Comma-separated role IDs allowed to execute actions (Admin role `3` is always allowed).
- Map/Reduce (`p2p_bulk_process_mr.js`)
  - `custscript_p2p_task_ids`: JSON array of approval task IDs to process.
  - `custscript_p2p_bulk_limit`: Max tasks to process per run (defaults to `BULK_APPROVAL_LIMIT`).
  - `custscript_p2p_governance_threshold`: Min remaining usage before stopping map processing (default `200`).

## Approval Flow

1. Transaction is created in Draft status.
2. Approval rule is matched by subsidiary, amount, currency, department/location, and exceptions.
3. Approval tasks are created by step sequence (serial or parallel).
4. Approvers act via UI or email links; history is logged.
5. Scheduled reminders/escalations manage pending approvals.

## Vendor Bill Matching

Vendor Bills are validated for:
- PO Link required for bills over $1,000
- Receipt requirement for inventory/assembly/fixed asset items
- Price variance over 5% or $500
- Quantity variance (cannot exceed PO quantity)

## Testing

Use the scenarios listed in `CURSOR_RULES.md` Part 20 to validate:
- Rule matching and escalation
- Delegation routing
- Email approvals and token validation
- 3-way matching exceptions

## Notes

- All SuiteScript modules use 2.1 syntax.
- Searches use `N/search` only.
- Tokens expire after 72 hours by default.
