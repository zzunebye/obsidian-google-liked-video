import { YouTubeApiClient } from './youtubeApiClient';

export interface YouTubeAccountIdentity {
	channelId: string;
	channelTitle?: string;
}

export class CacheOwnershipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CacheOwnershipError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class YouTubeAccountIdentityService {
	private identityPromise: Promise<YouTubeAccountIdentity> | null = null;
	private identityController: AbortController | null = null;

	constructor(private readonly client: YouTubeApiClient) {}

	getCurrentIdentity(): Promise<YouTubeAccountIdentity> {
		if (!this.identityPromise) {
			const controller = new AbortController();
			this.identityController = controller;
			this.identityPromise = this.fetchCurrentIdentity(controller.signal).then(
				(identity) => {
					if (this.identityController === controller) this.identityController = null;
					return identity;
				},
				(error: unknown) => {
					if (this.identityController === controller) {
						this.identityController = null;
						this.identityPromise = null;
					}
					throw error;
				},
			);
		}
		return this.identityPromise;
	}

	reset(): void {
		this.identityController?.abort();
		this.identityController = null;
		this.identityPromise = null;
	}

	private async fetchCurrentIdentity(signal: AbortSignal): Promise<YouTubeAccountIdentity> {
		const params = new URLSearchParams({ part: 'id,snippet', mine: 'true' });
		const body: unknown = (await this.client.request(
			'GET',
			`channels?${params.toString()}`,
			{ signal },
		)).json;
		if (!isRecord(body) || !Array.isArray(body.items)) {
			throw new Error('YouTube returned an invalid account response.');
		}
		if (body.items.length !== 1) {
			throw new Error('Could not identify exactly one YouTube channel for the connected account.');
		}
		const item = body.items[0];
		if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim().length === 0) {
			throw new Error('YouTube returned an invalid account identity.');
		}
		const snippet = item.snippet;
		return {
			channelId: item.id,
			channelTitle: isRecord(snippet) && typeof snippet.title === 'string'
				? snippet.title : undefined,
		};
	}
}
