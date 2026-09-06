import type { App } from 'obsidian';

class VaultLocalStorageService {
	private app: App | null = null;

	initialize(app: App): void {
		this.app = app;
	}

	load(key: string): unknown | null {
		return this.app?.loadLocalStorage(key) ?? null;
	}

	save(key: string, value: unknown | null): void {
		this.app?.saveLocalStorage(key, value);
	}
}

export const vaultLocalStorageService = new VaultLocalStorageService();
