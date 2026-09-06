/* eslint-disable no-console -- Console output is the explicit opt-in interface of this debug logger. */

import { vaultLocalStorageService } from './services/vaultLocalStorageService';

export interface DebugConfig {
    enabled: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug' | 'verbose';
    logApiCalls: boolean;
    logStateChanges: boolean;
    logAutoFetch: boolean;
    showDebugPanel: boolean;
    mockApiResponses: boolean;
    autoFetchIntervalOverride?: number;
}

declare global {
    interface Window {
        enableGeuloDebug: (config?: Partial<DebugConfig>) => DebugConfig;
        disableGeuloDebug: () => void;
    }
}

const DEFAULT_DEBUG_CONFIG: DebugConfig = {
    enabled: false,
    logLevel: 'info',
    logApiCalls: false,
    logStateChanges: false,
    logAutoFetch: false,
    showDebugPanel: false,
    mockApiResponses: false,
};

const DEBUG_ENABLED_KEY = 'GEULO_DEBUG';
const DEBUG_CONFIG_KEY = 'GEULO_DEBUG_CONFIG';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDebugConfig(value: unknown): value is DebugConfig {
    return isRecord(value)
        && typeof value.enabled === 'boolean'
        && (value.logLevel === 'error'
            || value.logLevel === 'warn'
            || value.logLevel === 'info'
            || value.logLevel === 'debug'
            || value.logLevel === 'verbose')
        && typeof value.logApiCalls === 'boolean'
        && typeof value.logStateChanges === 'boolean'
        && typeof value.logAutoFetch === 'boolean'
        && typeof value.showDebugPanel === 'boolean'
        && typeof value.mockApiResponses === 'boolean'
        && (value.autoFetchIntervalOverride === undefined
            || typeof value.autoFetchIntervalOverride === 'number');
}

class DebugLogger {
	private config: DebugConfig;

	constructor() {
		this.config = { ...DEFAULT_DEBUG_CONFIG };
	}

	initialize(): void {
		this.config = this.loadDebugConfig();
	}

	private isDebugEnabled(): boolean {
		return vaultLocalStorageService.load(DEBUG_ENABLED_KEY) === true;
	}

	private loadDebugConfig(): DebugConfig {
		if (!this.isDebugEnabled()) {
			return DEFAULT_DEBUG_CONFIG;
		}

        const stored = vaultLocalStorageService.load(DEBUG_CONFIG_KEY);
        if (isDebugConfig(stored)) {
            return { ...DEFAULT_DEBUG_CONFIG, ...stored, enabled: true };
        }
        
		return { ...DEFAULT_DEBUG_CONFIG, enabled: true };
	}

    updateConfig(config: Partial<DebugConfig>) {
        this.config = { ...this.config, ...config };
        vaultLocalStorageService.save(DEBUG_CONFIG_KEY, this.config);
    }

    enable(config?: Partial<DebugConfig>): DebugConfig {
        vaultLocalStorageService.save(DEBUG_ENABLED_KEY, true);
        this.config = { ...this.config, enabled: true };
        if (config) {
            this.updateConfig(config);
        }
        return this.config;
    }

    disable(): void {
        vaultLocalStorageService.save(DEBUG_ENABLED_KEY, null);
        vaultLocalStorageService.save(DEBUG_CONFIG_KEY, null);
        this.config = { ...DEFAULT_DEBUG_CONFIG };
    }

    getConfig(): DebugConfig {
        return this.config;
    }

    private shouldLog(level: string): boolean {
        if (!this.config.enabled) return false;
        
        const levels = ['error', 'warn', 'info', 'debug', 'verbose'];
        const currentLevelIndex = levels.indexOf(this.config.logLevel);
        const messageLevelIndex = levels.indexOf(level);
        
        return messageLevelIndex <= currentLevelIndex;
    }

    error(message: string, ...args: unknown[]): void {
        if (this.shouldLog('error')) {
            console.error(`[Geulo ERROR] ${message}`, ...args);
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (this.shouldLog('warn')) {
            console.warn(`[Geulo WARN] ${message}`, ...args);
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (this.shouldLog('info')) {
            console.info(`[Geulo INFO] ${message}`, ...args);
        }
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.shouldLog('debug')) {
            console.log(`[Geulo DEBUG] ${message}`, ...args);
        }
    }

    verbose(message: string, ...args: unknown[]): void {
        if (this.shouldLog('verbose')) {
            console.log(`[Geulo VERBOSE] ${message}`, ...args);
        }
    }

    api(message: string, data?: unknown): void {
        if (this.config.logApiCalls && this.shouldLog('debug')) {
            console.log(`[Geulo API] ${message}`, data || '');
        }
    }

    state(message: string, data?: unknown): void {
        if (this.config.logStateChanges && this.shouldLog('debug')) {
            console.log(`[Geulo STATE] ${message}`, data || '');
        }
    }

    autoFetch(message: string, data?: unknown): void {
        if (this.config.logAutoFetch && this.shouldLog('debug')) {
            console.log(`[Geulo AUTO-FETCH] ${message}`, data || '');
        }
    }

    time(label: string): void {
        if (this.config.enabled) {
            console.time(`[Geulo TIMER] ${label}`);
        }
    }

    timeEnd(label: string): void {
        if (this.config.enabled) {
            console.timeEnd(`[Geulo TIMER] ${label}`);
        }
    }

    group(label: string): void {
        if (this.config.enabled) {
            console.group(`[Geulo] ${label}`);
        }
    }

    groupEnd(): void {
        if (this.config.enabled) {
            console.groupEnd();
        }
    }
}

export const debugLogger = new DebugLogger();

// Helper function to enable debug mode from console
window.enableGeuloDebug = (config?: Partial<DebugConfig>): DebugConfig => {
    const updatedConfig = debugLogger.enable(config);
    console.log('Geulo debug mode enabled. Reload the plugin to see debug logs.');
    return updatedConfig;
};

// Helper function to disable debug mode from console
window.disableGeuloDebug = (): void => {
    debugLogger.disable();
    console.log('Geulo debug mode disabled. Reload the plugin to stop debug logs.');
};
