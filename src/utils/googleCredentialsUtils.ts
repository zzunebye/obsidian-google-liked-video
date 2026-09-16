export interface GoogleClientCredentials {
	clientId: string;
	clientSecret: string;
	clientType: 'web' | 'installed';
	projectId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseGoogleClientCredentials(text: string): GoogleClientCredentials {
	let data: unknown;
	try {
		data = JSON.parse(text.replace(/^\uFEFF/, ''));
	} catch {
		throw new Error('This file is not valid JSON. Choose the OAuth client JSON downloaded from Google Cloud Console.');
	}

	if (!isRecord(data)) {
		throw new Error('Choose an OAuth client JSON file downloaded from Google Cloud Console.');
	}
	if (data.type === 'service_account') {
		throw new Error('Service account keys cannot connect your YouTube account. Download a Web or Desktop OAuth client JSON instead.');
	}
	const hasWeb = Object.prototype.hasOwnProperty.call(data, 'web');
	const hasInstalled = Object.prototype.hasOwnProperty.call(data, 'installed');
	if (hasWeb === hasInstalled) {
		throw new Error('The JSON must contain exactly one Web or Desktop OAuth client.');
	}
	const clientType = hasWeb ? 'web' : 'installed';
	const client = data[clientType];
	if (!isRecord(client)) {
		throw new Error('The OAuth client details are missing or invalid. Download the client JSON again.');
	}
	const clientId = typeof client.client_id === 'string' ? client.client_id.trim() : '';
	const clientSecret = typeof client.client_secret === 'string' ? client.client_secret.trim() : '';
	if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
		throw new Error('The JSON does not contain a valid Google OAuth client ID.');
	}
	if (!clientSecret) {
		throw new Error('The JSON is missing the client secret. Download the complete JSON when creating the OAuth client or a new client secret.');
	}

	return {
		clientId,
		clientSecret,
		clientType,
		projectId: typeof client.project_id === 'string' ? client.project_id.trim() || undefined : undefined,
	};
}
