export interface GoogleSecretsPluginDataSplit {
	readonly settingsData: Record<string, unknown>;
	readonly hasLegacyAccessToken: boolean;
	readonly legacyAccessToken: unknown;
	readonly hasLegacyClientSecret: boolean;
	readonly legacyClientSecret: unknown;
}

export interface GoogleSecretMigrationActions {
	readonly migrateAccessToken: (value: unknown) => void;
	readonly migrateClientSecret: (value: unknown) => void;
	readonly persistSanitizedData: () => Promise<void>;
}

function isPluginData(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function splitGoogleSecretsFromPluginData(value: unknown): GoogleSecretsPluginDataSplit {
	if (!isPluginData(value)) {
		return {
			settingsData: {},
			hasLegacyAccessToken: false,
			legacyAccessToken: undefined,
			hasLegacyClientSecret: false,
			legacyClientSecret: undefined,
		};
	}

	const hasLegacyAccessToken = Object.prototype.hasOwnProperty.call(value, 'accessToken');
	const hasLegacyClientSecret = Object.prototype.hasOwnProperty.call(value, 'googleClientSecret');
	const settingsData: Record<string, unknown> = {};
	for (const [key, settingValue] of Object.entries(value)) {
		if (key !== 'accessToken' && key !== 'googleClientSecret') {
			settingsData[key] = settingValue;
		}
	}

	return {
		settingsData,
		hasLegacyAccessToken,
		legacyAccessToken: hasLegacyAccessToken ? value.accessToken : undefined,
		hasLegacyClientSecret,
		legacyClientSecret: hasLegacyClientSecret ? value.googleClientSecret : undefined,
	};
}

export async function migrateLegacyGoogleSecrets(
	splitData: GoogleSecretsPluginDataSplit,
	actions: GoogleSecretMigrationActions,
): Promise<void> {
	if (!splitData.hasLegacyAccessToken && !splitData.hasLegacyClientSecret) {
		return;
	}

	if (splitData.hasLegacyAccessToken) {
		actions.migrateAccessToken(splitData.legacyAccessToken);
	}
	if (splitData.hasLegacyClientSecret) {
		actions.migrateClientSecret(splitData.legacyClientSecret);
	}

	await actions.persistSanitizedData();
}
