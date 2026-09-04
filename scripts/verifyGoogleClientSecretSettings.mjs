import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-client-secret-settings-'));
const outputPath = path.join(outputDirectory, 'googleClientSecretMigration.mjs');

await build({
	entryPoints: ['src/services/googleClientSecretMigration.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: outputPath,
});

const {
	migrateLegacyGoogleSecrets,
	splitGoogleSecretsFromPluginData,
} = await import(pathToFileURL(outputPath).href);

{
	const source = {
		accessToken: 'legacy-access-token',
		googleClientId: 'client-id',
		googleClientSecret: 'legacy-secret',
	};
	const result = splitGoogleSecretsFromPluginData(source);
	assert.equal(result.hasLegacyAccessToken, true);
	assert.equal(result.legacyAccessToken, 'legacy-access-token');
	assert.equal(result.hasLegacyClientSecret, true);
	assert.equal(result.legacyClientSecret, 'legacy-secret');
	assert.deepEqual(result.settingsData, { googleClientId: 'client-id' });
	assert.deepEqual(source, {
		accessToken: 'legacy-access-token',
		googleClientId: 'client-id',
		googleClientSecret: 'legacy-secret',
	});
}

for (const legacyClientSecret of ['', 42, false, null, { nested: true }]) {
	const source = { googleClientId: 'client-id', googleClientSecret: legacyClientSecret };
	const result = splitGoogleSecretsFromPluginData(source);
	assert.equal(result.hasLegacyClientSecret, true);
	assert.equal(result.legacyClientSecret, legacyClientSecret);
	assert.deepEqual(result.settingsData, { googleClientId: 'client-id' });
	assert.equal(source.googleClientSecret, legacyClientSecret);
}

{
	const inherited = Object.create({ googleClientSecret: 'inherited-secret' });
	inherited.googleClientId = 'client-id';
	const result = splitGoogleSecretsFromPluginData(inherited);
	assert.equal(result.hasLegacyAccessToken, false);
	assert.equal(result.legacyAccessToken, undefined);
	assert.equal(result.hasLegacyClientSecret, false);
	assert.equal(result.legacyClientSecret, undefined);
	assert.deepEqual(result.settingsData, { googleClientId: 'client-id' });
}

for (const invalidData of [null, undefined, [], 'text', 42, false]) {
	const result = splitGoogleSecretsFromPluginData(invalidData);
	assert.equal(result.hasLegacyAccessToken, false);
	assert.equal(result.legacyAccessToken, undefined);
	assert.equal(result.hasLegacyClientSecret, false);
	assert.equal(result.legacyClientSecret, undefined);
	assert.deepEqual(result.settingsData, {});
}

{
	const source = {
		accessToken: 'retry-access-token',
		googleClientSecret: 'retry-secret',
		setting: true,
	};
	const migratedAccessTokens = [];
	const migratedClientSecrets = [];
	let saveAttempts = 0;
	const actions = {
		migrateAccessToken(value) {
			migratedAccessTokens.push(value);
		},
		migrateClientSecret(value) {
			migratedClientSecrets.push(value);
		},
		async persistSanitizedData() {
			saveAttempts += 1;
			if (saveAttempts === 1) {
				throw new Error('save failed');
			}
		},
	};

	const first = splitGoogleSecretsFromPluginData(source);
	await assert.rejects(migrateLegacyGoogleSecrets(first, actions), /save failed/);
	assert.deepEqual(source, {
		accessToken: 'retry-access-token',
		googleClientSecret: 'retry-secret',
		setting: true,
	});

	const retry = splitGoogleSecretsFromPluginData(source);
	await migrateLegacyGoogleSecrets(retry, actions);
	assert.equal(saveAttempts, 2);
	assert.deepEqual(migratedAccessTokens, ['retry-access-token', 'retry-access-token']);
	assert.deepEqual(migratedClientSecrets, ['retry-secret', 'retry-secret']);
	assert.deepEqual(retry.settingsData, { setting: true });
}

console.log('google-client-secret settings verification passed');
