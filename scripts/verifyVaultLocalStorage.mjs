/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-vault-storage-'));
const outputPath = path.join(outputDirectory, 'vault-storage-verification.cjs');

await build({
	stdin: {
		contents: `
			export { vaultLocalStorageService } from './src/services/vaultLocalStorageService.ts';
			export { userPreferencesService } from './src/services/userPreferencesService.ts';
			export { debugLogger } from './src/debug.ts';
		`,
		resolveDir: process.cwd(),
		sourcefile: 'vault-storage-verification-entry.ts',
	},
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outfile: outputPath,
});

globalThis.window = {};

class FakeApp {
	constructor() {
		this.values = new Map();
	}

	loadLocalStorage(key) {
		return this.values.has(key) ? this.values.get(key) : null;
	}

	saveLocalStorage(key, value) {
		if (value === null) {
			this.values.delete(key);
			return;
		}
		this.values.set(key, value);
	}
}

const require = createRequire(import.meta.url);
const { debugLogger, userPreferencesService, vaultLocalStorageService } = require(outputPath);
const app = new FakeApp();
vaultLocalStorageService.initialize(app);
debugLogger.initialize();

assert.deepEqual(userPreferencesService.getPreferences(), {
	skipUnlikeConfirmation: false,
	skipLongVideoSummaryConfirmation: false,
});

userPreferencesService.setSkipUnlikeConfirmation(true);
assert.equal(app.values.get('geulo-user-preferences').skipUnlikeConfirmation, true);
assert.equal(userPreferencesService.shouldSkipUnlikeConfirmation(), true);

const config = globalThis.window.enableGeuloDebug({ logLevel: 'debug', logApiCalls: true });
assert.equal(config.enabled, true);
assert.equal(app.values.get('GEULO_DEBUG'), true);
assert.equal(app.values.get('GEULO_DEBUG_CONFIG').logApiCalls, true);

globalThis.window.disableGeuloDebug();
assert.equal(app.values.has('GEULO_DEBUG'), false);
assert.equal(app.values.has('GEULO_DEBUG_CONFIG'), false);

userPreferencesService.resetPreferences();
assert.equal(app.values.has('geulo-user-preferences'), false);

console.log('vault-local-storage verification passed');
