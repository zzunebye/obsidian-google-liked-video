/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-client-secret-storage-'));
const outputPath = path.join(outputDirectory, 'googleTokenStorageService.mjs');

await build({
	entryPoints: ['src/services/googleTokenStorageService.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: outputPath,
});

const { GoogleTokenStorageService } = await import(pathToFileURL(outputPath).href);

class FakeSecretStorage {
	constructor(values = new Map(), failOnSet = false) {
		this.values = values;
		this.failOnSet = failOnSet;
		this.setCalls = [];
	}

	getSecret(id) {
		return this.values.has(id) ? this.values.get(id) : null;
	}

	setSecret(id, value) {
		this.setCalls.push([id, value]);
		if (this.failOnSet) {
			throw new Error('set failed');
		}
		this.values.set(id, value);
	}
}

class EmptyLocalStorage {
	getItem() {
		return null;
	}

	removeItem() {}
}

globalThis.window = { localStorage: new EmptyLocalStorage() };

const secretId = 'geulo-google-client-secret';
const accessTokenSecretId = 'geulo-google-access-token';

{
	const service = new GoogleTokenStorageService();
	assert.throws(() => service.getClientSecret(), /not been initialized/);
}

{
	const storage = new FakeSecretStorage();
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	assert.equal(service.getClientSecret(), '');
	service.setClientSecret('new-secret');
	assert.equal(service.getClientSecret(), 'new-secret');
	assert.deepEqual(storage.setCalls.at(-1), [secretId, 'new-secret']);
}

for (const existingSecret of ['stored-secret', '']) {
	const storage = new FakeSecretStorage(new Map([[secretId, existingSecret]]));
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	service.migrateClientSecret('legacy-secret');
	assert.equal(service.getClientSecret(), existingSecret);
	assert.equal(storage.setCalls.length, 0);
}

{
	const storage = new FakeSecretStorage();
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	service.migrateClientSecret('legacy-secret');
	assert.equal(service.getClientSecret(), 'legacy-secret');
}

{
	const storage = new FakeSecretStorage();
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	service.migrateAccessToken('legacy-access-token');
	assert.equal(service.getAccessToken(), 'legacy-access-token');
	assert.deepEqual(storage.setCalls.at(-1), [accessTokenSecretId, 'legacy-access-token']);
}

for (const ignoredLegacyValue of ['', 42, false, null, undefined, { secret: 'value' }]) {
	const storage = new FakeSecretStorage();
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	service.migrateClientSecret(ignoredLegacyValue);
	assert.equal(storage.getSecret(secretId), null);
	assert.equal(storage.setCalls.length, 0);
}

{
	const storage = new FakeSecretStorage(new Map(), true);
	const service = new GoogleTokenStorageService();
	service.initialize(storage);
	assert.throws(() => service.migrateClientSecret('legacy-secret'), /set failed/);
	assert.equal(storage.getSecret(secretId), null);
}

console.log('google-client-secret storage verification passed');
