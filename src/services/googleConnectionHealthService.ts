import type { YouTubeAccountIdentity } from './youtubeAccountIdentityService';
import { YouTubeRequestError } from './youtubeApiClient';

export type GoogleConnectionHealthStepId = 'credentials' | 'authorization' | 'youtube-api';
export type GoogleConnectionHealthStepStatus = 'passed' | 'failed' | 'skipped';

export interface GoogleConnectionHealthStep {
	id: GoogleConnectionHealthStepId;
	label: string;
	status: GoogleConnectionHealthStepStatus;
	detail: string;
}

export interface GoogleConnectionHealthReport {
	status: 'healthy' | 'unhealthy';
	checkedAt: Date;
	steps: readonly GoogleConnectionHealthStep[];
}

export interface GoogleConnectionHealthInput {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}

export interface GoogleConnectionHealthDependencies {
	refreshAuthorization: (clientId: string) => Promise<void>;
	checkYouTubeAccount: () => Promise<YouTubeAccountIdentity>;
}

const STEP_LABELS: Record<GoogleConnectionHealthStepId, string> = {
	credentials: 'OAuth credentials',
	authorization: 'Google authorization',
	'youtube-api': 'YouTube Data API',
};

function step(
	id: GoogleConnectionHealthStepId,
	status: GoogleConnectionHealthStepStatus,
	detail: string,
): GoogleConnectionHealthStep {
	return { id, label: STEP_LABELS[id], status, detail };
}

function report(steps: readonly GoogleConnectionHealthStep[]): GoogleConnectionHealthReport {
	return {
		status: steps.every(item => item.status === 'passed') ? 'healthy' : 'unhealthy',
		checkedAt: new Date(),
		steps,
	};
}

function skipped(id: GoogleConnectionHealthStepId): GoogleConnectionHealthStep {
	return step(id, 'skipped', 'Complete the previous check first.');
}

function getAuthorizationFailure(error: unknown): string {
	if (error instanceof Error && error.message.toLowerCase().includes('timed out')) {
		return 'Google authorization timed out. Check your connection and try again.';
	}
	return 'Google could not renew this authorization. Reconnect your account, then try again.';
}

function getYouTubeFailure(error: unknown): string {
	if (error instanceof YouTubeRequestError) {
		if (error.kind === 'auth') {
			return 'YouTube rejected the Google authorization. Reconnect your account, then try again.';
		}
		if (error.kind === 'timeout') {
			return 'The YouTube Data API timed out. Check your connection and try again.';
		}
		if (error.kind === 'network') {
			return 'Geulo could not reach the YouTube Data API. Check your connection and try again.';
		}
		if (error.reasons.some(reason => reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
			return 'YouTube API quota is exhausted. Try again after the quota resets.';
		}
		if (error.reasons.some(reason => reason === 'accessNotConfigured' || reason === 'serviceDisabled')) {
			return 'Enable YouTube Data API v3 for this Google Cloud project, then try again.';
		}
		if (error.status === 403) {
			return 'YouTube denied this request. Check API enablement and account permissions.';
		}
		if (error.status !== undefined && error.status >= 500) {
			return 'The YouTube Data API is temporarily unavailable. Try again later.';
		}
	}

	return error instanceof Error
		? error.message
		: 'The YouTube Data API check failed. Try again.';
}

export async function checkGoogleConnectionHealth(
	input: GoogleConnectionHealthInput,
	dependencies: GoogleConnectionHealthDependencies,
): Promise<GoogleConnectionHealthReport> {
	const clientId = input.clientId.trim();
	const hasClientSecret = input.clientSecret.trim().length > 0;
	if (!clientId || !hasClientSecret) {
		const missing = !clientId && !hasClientSecret
			? 'Client ID and client secret are missing.'
			: !clientId ? 'Client ID is missing.' : 'Client secret is missing.';
		return report([
			step('credentials', 'failed', `${missing} Import or enter Google OAuth credentials.`),
			skipped('authorization'),
			skipped('youtube-api'),
		]);
	}

	const steps: GoogleConnectionHealthStep[] = [
		step('credentials', 'passed', 'Client ID and client secret are saved.'),
	];
	if (!input.refreshToken) {
		return report([
			...steps,
			step('authorization', 'failed', 'No Google authorization was found. Connect your account first.'),
			skipped('youtube-api'),
		]);
	}

	try {
		await dependencies.refreshAuthorization(clientId);
		steps.push(step('authorization', 'passed', 'Google authorization renewed successfully.'));
	} catch (error: unknown) {
		return report([
			...steps,
			step('authorization', 'failed', getAuthorizationFailure(error)),
			skipped('youtube-api'),
		]);
	}

	try {
		const identity = await dependencies.checkYouTubeAccount();
		const accountLabel = identity.channelTitle?.trim() || identity.channelId;
		steps.push(step('youtube-api', 'passed', `YouTube responded for ${accountLabel}.`));
	} catch (error: unknown) {
		steps.push(step('youtube-api', 'failed', getYouTubeFailure(error)));
	}

	return report(steps);
}
