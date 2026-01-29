/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * P2P Config - Loads and caches global configuration
 */
define(['N/search', 'N/cache', '../constants/p2p_constants_v2'], function(search, cache, constants) {
    'use strict';

    const CACHE_NAME = 'P2P_CONFIG_CACHE';
    const CACHE_KEY = 'GLOBAL_CONFIG';
    const CACHE_TTL = 300; // 5 minutes

    /**
     * Get global configuration (cached)
     * @returns {Object} Configuration object with all settings
     */
    function getConfig() {
        try {
            const configCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
            let config = configCache.get({ key: CACHE_KEY });
            
            if (config) {
                return JSON.parse(config);
            }
            
            config = loadConfigFromRecord();
            configCache.put({
                key: CACHE_KEY,
                value: JSON.stringify(config),
                ttl: CACHE_TTL
            });
            
            return config;
        } catch (error) {
            log.error('getConfig error', error);
            return getDefaultConfig();
        }
    }

    /**
     * Load configuration from the Global Config record
     * @returns {Object} Configuration object
     */
    function loadConfigFromRecord() {
        try {
            const configSearch = search.create({
                type: constants.RECORD_TYPES.GLOBAL_CONFIG,
                filters: [],
                columns: Object.values(constants.CONFIG_FIELDS)
            });

            const results = configSearch.run().getRange({ start: 0, end: 1 });
            
            if (!results || !results.length) {
                log.audit('No Global Config record found, using defaults');
                return getDefaultConfig();
            }

            const result = results[0];
            const CF = constants.CONFIG_FIELDS;

            return {
                // Matching thresholds
                priceVarPct: parseFloat(result.getValue(CF.PRICE_VAR_PCT)) || constants.CONFIG_DEFAULTS.PRICE_VAR_PCT,
                priceVarAmt: parseFloat(result.getValue(CF.PRICE_VAR_AMT)) || constants.CONFIG_DEFAULTS.PRICE_VAR_AMT,
                fxTolerancePct: parseFloat(result.getValue(CF.FX_TOLERANCE_PCT)) || constants.CONFIG_DEFAULTS.FX_TOLERANCE_PCT,
                poThreshold: parseFloat(result.getValue(CF.PO_THRESHOLD)) || constants.CONFIG_DEFAULTS.PO_THRESHOLD,
                
                // Timing
                reminder1Hrs: parseInt(result.getValue(CF.REMINDER_1_HRS), 10) || constants.CONFIG_DEFAULTS.REMINDER_1_HRS,
                reminder2Hrs: parseInt(result.getValue(CF.REMINDER_2_HRS), 10) || constants.CONFIG_DEFAULTS.REMINDER_2_HRS,
                escalationHrs: parseInt(result.getValue(CF.ESCALATION_HRS), 10) || constants.CONFIG_DEFAULTS.ESCALATION_HRS,
                tokenExpiryHrs: parseInt(result.getValue(CF.TOKEN_EXPIRY_HRS), 10) || constants.CONFIG_DEFAULTS.TOKEN_EXPIRY_HRS,
                maxDelegationDays: parseInt(result.getValue(CF.MAX_DELEGATION_DAYS), 10) || constants.CONFIG_DEFAULTS.MAX_DELEGATION_DAYS,
                
                // AI/Risk
                autoApproveEnabled: result.getValue(CF.AUTO_APPROVE_ENABLED) === true || result.getValue(CF.AUTO_APPROVE_ENABLED) === 'T',
                autoApproveThreshold: parseInt(result.getValue(CF.AUTO_APPROVE_THRESHOLD), 10) || null,
                newVendorDays: parseInt(result.getValue(CF.NEW_VENDOR_DAYS), 10) || constants.CONFIG_DEFAULTS.NEW_VENDOR_DAYS,
                minVbAcctAnom: parseInt(result.getValue(CF.MIN_VB_ACCT_ANOM), 10) || constants.CONFIG_DEFAULTS.MIN_VB_ACCT_ANOM,
                
                // Reapproval
                reapprovalMode: result.getValue(CF.REAPPROVAL_MODE) || constants.CONFIG_DEFAULTS.REAPPROVAL_MODE,
                reapprovalBody: parseFieldList(result.getValue(CF.REAPPROVAL_BODY)),
                reapprovalItem: parseFieldList(result.getValue(CF.REAPPROVAL_ITEM)),
                reapprovalExpense: parseFieldList(result.getValue(CF.REAPPROVAL_EXPENSE)),
                
                // Notifications
                teamsWebhook: result.getValue(CF.TEAMS_WEBHOOK) || '',
                slackWebhook: result.getValue(CF.SLACK_WEBHOOK) || '',
                
                // Bulk
                bulkLimit: parseInt(result.getValue(CF.BULK_LIMIT), 10) || constants.CONFIG_DEFAULTS.BULK_LIMIT,
                
                // Fallback
                fallbackPath: result.getValue(CF.FALLBACK_PATH) || null,
                fallbackApprover: result.getValue(CF.FALLBACK_APPROVER) || null,
                
                // Meta
                configId: result.id,
                loadedAt: new Date().toISOString()
            };
        } catch (error) {
            log.error('loadConfigFromRecord error', error);
            return getDefaultConfig();
        }
    }

    /**
     * Get default configuration
     * @returns {Object} Default config values
     */
    function getDefaultConfig() {
        const defaults = constants.CONFIG_DEFAULTS;
        return {
            priceVarPct: defaults.PRICE_VAR_PCT,
            priceVarAmt: defaults.PRICE_VAR_AMT,
            fxTolerancePct: defaults.FX_TOLERANCE_PCT,
            poThreshold: defaults.PO_THRESHOLD,
            reminder1Hrs: defaults.REMINDER_1_HRS,
            reminder2Hrs: defaults.REMINDER_2_HRS,
            escalationHrs: defaults.ESCALATION_HRS,
            tokenExpiryHrs: defaults.TOKEN_EXPIRY_HRS,
            maxDelegationDays: defaults.MAX_DELEGATION_DAYS,
            autoApproveEnabled: false,
            autoApproveThreshold: null,
            newVendorDays: defaults.NEW_VENDOR_DAYS,
            minVbAcctAnom: defaults.MIN_VB_ACCT_ANOM,
            reapprovalMode: defaults.REAPPROVAL_MODE,
            reapprovalBody: [],
            reapprovalItem: [],
            reapprovalExpense: [],
            teamsWebhook: '',
            slackWebhook: '',
            bulkLimit: defaults.BULK_LIMIT,
            fallbackPath: null,
            fallbackApprover: null,
            configId: null,
            loadedAt: new Date().toISOString()
        };
    }

    /**
     * Clear config cache (call after updating Global Config record)
     */
    function clearCache() {
        try {
            const configCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });
            configCache.remove({ key: CACHE_KEY });
            log.audit('P2P Config cache cleared');
        } catch (error) {
            log.error('clearCache error', error);
        }
    }

    /**
     * Parse comma-separated field list
     * @param {string} raw - Raw field list string
     * @returns {string[]} Array of field IDs
     */
    function parseFieldList(raw) {
        if (!raw) {
            return [];
        }
        return String(raw)
            .split(/[,;\s]+/)
            .map(function(s) { return s.trim(); })
            .filter(function(s) { return s.length > 0; });
    }

    /**
     * Get a specific config value
     * @param {string} key - Config key
     * @param {*} defaultValue - Default if not found
     * @returns {*} Config value
     */
    function getValue(key, defaultValue) {
        const config = getConfig();
        return config.hasOwnProperty(key) ? config[key] : defaultValue;
    }

    return {
        getConfig: getConfig,
        getValue: getValue,
        clearCache: clearCache,
        loadConfigFromRecord: loadConfigFromRecord,
        getDefaultConfig: getDefaultConfig
    };
});
