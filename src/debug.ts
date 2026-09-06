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

class DebugLogger {
	private config: DebugConfig;

	constructor() {
		this.config = this.loadDebugConfig();
	}

	private isDebugEnabled(): boolean {
		return localStorage.getItem('GEULO_DEBUG') === 'true';
	}

	private loadDebugConfig(): DebugConfig {
		if (!this.isDebugEnabled()) {
			return DEFAULT_DEBUG_CONFIG;
		}

        const stored = localStorage.getItem('GEULO_DEBUG_CONFIG');
        if (stored) {
            try {
                return { ...DEFAULT_DEBUG_CONFIG, ...JSON.parse(stored) };
            } catch (e) {
                console.error('Failed to parse debug config:', e);
            }
        }
        
		return { ...DEFAULT_DEBUG_CONFIG, enabled: true };
	}

    updateConfig(config: Partial<DebugConfig>) {
        this.config = { ...this.config, ...config };
        localStorage.setItem('GEULO_DEBUG_CONFIG', JSON.stringify(this.config));
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
    localStorage.setItem('GEULO_DEBUG', 'true');
    if (config) {
        debugLogger.updateConfig(config);
    }
    console.log('Geulo debug mode enabled. Reload the plugin to see debug logs.');
    return debugLogger.getConfig();
};

// Helper function to disable debug mode from console
window.disableGeuloDebug = (): void => {
    localStorage.removeItem('GEULO_DEBUG');
    localStorage.removeItem('GEULO_DEBUG_CONFIG');
    console.log('Geulo debug mode disabled. Reload the plugin to stop debug logs.');
};
