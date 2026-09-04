import type { SecretStorage } from 'obsidian';

const ACCESS_TOKEN_SECRET_ID = 'geulo-google-access-token';
const REFRESH_TOKEN_SECRET_ID = 'geulo-google-refresh-token';
const LEGACY_ACCESS_TOKEN_KEY = 'googleYtbLikedVideoAccessToken';
const LEGACY_REFRESH_TOKEN_KEY = 'googleYtbLikedVideoRefreshToken';

class GoogleTokenStorageNotInitializedError extends Error {
	constructor() {
		super('Google token storage has not been initialized');
		this.name = 'GoogleTokenStorageNotInitializedError';
	}
}

export class GoogleTokenStorageService {
	private secretStorage: SecretStorage | null = null;

	initialize(secretStorage: SecretStorage): void {
		this.secretStorage = secretStorage;
		this.migrateLegacyToken(ACCESS_TOKEN_SECRET_ID, LEGACY_ACCESS_TOKEN_KEY);
		this.migrateLegacyToken(REFRESH_TOKEN_SECRET_ID, LEGACY_REFRESH_TOKEN_KEY);
	}

	getAccessToken(): string {
		return this.getSecretStorage().getSecret(ACCESS_TOKEN_SECRET_ID) ?? '';
	}

	getRefreshToken(): string {
		return this.getSecretStorage().getSecret(REFRESH_TOKEN_SECRET_ID) ?? '';
	}

	setAccessToken(value: string): void {
		this.getSecretStorage().setSecret(ACCESS_TOKEN_SECRET_ID, value);
	}

	setRefreshToken(value: string): void {
		this.getSecretStorage().setSecret(REFRESH_TOKEN_SECRET_ID, value);
	}

	private migrateLegacyToken(secretId: string, legacyKey: string): void {
		const legacyValue = window.localStorage.getItem(legacyKey);
		if (legacyValue === null) {
			return;
		}

		const secretStorage = this.getSecretStorage();
		if (secretStorage.getSecret(secretId) !== null) {
			window.localStorage.removeItem(legacyKey);
			return;
		}

		if (legacyValue.length === 0) {
			return;
		}

		secretStorage.setSecret(secretId, legacyValue);
		window.localStorage.removeItem(legacyKey);
	}

	private getSecretStorage(): SecretStorage {
		if (this.secretStorage === null) {
			throw new GoogleTokenStorageNotInitializedError();
		}

		return this.secretStorage;
	}
}

export const googleTokenStorageService = new GoogleTokenStorageService();
