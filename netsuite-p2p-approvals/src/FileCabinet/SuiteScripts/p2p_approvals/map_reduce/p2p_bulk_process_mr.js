/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/runtime', 'N/task', '../lib/p2p_approval_engine', '../constants/p2p_constants'], function(
    runtime, task, approvalEngine, constants
) {
    'use strict';

    const TASK_IDS_PARAM = 'custscript_p2p_task_ids';
    const BULK_LIMIT_PARAM = 'custscript_p2p_bulk_limit';
    const GOV_THRESHOLD_PARAM = 'custscript_p2p_governance_threshold';

    function getInputData() {
        const script = runtime.getCurrentScript();
        const raw = script.getParameter({ name: TASK_IDS_PARAM }) || '[]';
        try {
            const ids = JSON.parse(raw);
            const list = Array.isArray(ids) ? ids : [];
            const limit = getBulkLimit(script);
            return list.slice(0, limit);
        } catch (error) {
            log.error('getInputData error', error);
            return [];
        }
    }

    function map(context) {
        if (isBelowGovernanceThreshold()) {
            log.audit('Skipping task due to governance threshold', {
                remaining: runtime.getCurrentScript().getRemainingUsage()
            });
            context.write({ key: context.value, value: 'skipped' });
            return;
        }
        const taskId = context.value;
        if (!taskId) {
            return;
        }
        const result = approvalEngine.processApproval({
            taskId: taskId,
            action: constants.APPROVAL_ACTION.APPROVE,
            method: constants.APPROVAL_METHOD.BULK
        });
        context.write({ key: taskId, value: result.success ? 'approved' : 'failed' });
    }

    function getBulkLimit(script) {
        const param = script.getParameter({ name: BULK_LIMIT_PARAM });
        const parsed = parseInt(param, 10);
        if (parsed && parsed > 0) {
            return parsed;
        }
        return constants.CONFIG.BULK_APPROVAL_LIMIT || 50;
    }

    function getGovernanceThreshold() {
        const script = runtime.getCurrentScript();
        const param = script.getParameter({ name: GOV_THRESHOLD_PARAM });
        const parsed = parseInt(param, 10);
        return parsed && parsed > 0 ? parsed : 200;
    }

    function isBelowGovernanceThreshold() {
        const remaining = runtime.getCurrentScript().getRemainingUsage();
        return remaining < getGovernanceThreshold();
    }

    function summarize(summary) {
        if (summary.inputSummary.error) {
            log.error('inputSummary error', summary.inputSummary.error);
        }
        summary.mapSummary.errors.iterator().each(function(key, error) {
            log.error('map error for ' + key, error);
            return true;
        });
        const skipped = [];
        summary.output.iterator().each(function(key, value) {
            if (value === 'skipped') {
                skipped.push(key);
            }
            return true;
        });

        if (skipped.length) {
            rescheduleSkippedTasks(skipped);
        }

        log.audit('bulk process complete', { processed: summary.output.length, skipped: skipped.length });
    }

    function rescheduleSkippedTasks(skippedTaskIds) {
        try {
            const script = runtime.getCurrentScript();
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: script.id,
                deploymentId: script.deploymentId,
                params: {
                    [TASK_IDS_PARAM]: JSON.stringify(skippedTaskIds),
                    [BULK_LIMIT_PARAM]: getBulkLimit(script),
                    [GOV_THRESHOLD_PARAM]: getGovernanceThreshold()
                }
            });
            const taskId = mrTask.submit();
            log.audit('Rescheduled skipped tasks', { count: skippedTaskIds.length, taskId: taskId });
        } catch (error) {
            log.error('rescheduleSkippedTasks error', error);
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});
