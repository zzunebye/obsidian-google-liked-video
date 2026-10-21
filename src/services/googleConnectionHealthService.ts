import type { YouTubeAccountIdentity } from './youtubeAccountIdentityService';
import { YouTubeRequestError } from './youtubeApiClient';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n/types';

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

const STEP_LABELS: Record<GoogleConnectionHealthStepId, TranslationKey> = {
	credentials: t('googleHealth.credentials'),
	authorization: t('googleHealth.authorization'),
	'youtube-api': t('googleHealth.youtubeApi'),
};

function step(
	id: GoogleConnectionHealthStepId,
	status: GoogleConnectionHealthStepStatus,
	detail: string,
): GoogleConnectionHealthStep {
	return { id, label: t(STEP_LABELS[id]), status, detail };
}

function report(steps: readonly GoogleConnectionHealthStep[]): GoogleConnectionHealthReport {
	return {
		status: steps.every(item => item.status === 'passed') ? 'healthy' : 'unhealthy',
		checkedAt: new Date(),
		steps,
	};
}

function skipped(id: GoogleConnectionHealthStepId): GoogleConnectionHealthStep {
	return step(id, 'skipped', t('googleHealth.completePreviousFirst'));
}

function getAuthorizationFailure(error: unknown): string {
	if (error instanceof Error && error.message.toLowerCase().includes('timed out')) {
		return t('googleHealth.authorizationTimeout');
	}
	return t('googleHealth.authorizationRenewFailed');
}

function getYouTubeFailure(error: unknown): string {
	if (error instanceof YouTubeRequestError) {
		if (error.kind === 'auth') {
			return t('googleHealth.youtubeAuthRejected');
		}
		if (error.kind === 'timeout') {
			return t('googleHealth.youtubeTimeout');
		}
		if (error.kind === 'network') {
			return t('googleHealth.youtubeConnectionFailed');
		}
		if (error.reasons.some(reason => reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
			return t('googleHealth.quotaExceeded');
		}
		if (error.reasons.some(reason => reason === 'accessNotConfigured' || reason === 'serviceDisabled')) {
			return t('googleHealth.enableApi');
		}
		if (error.status === 403) {
			return t('googleHealth.requestDenied');
		}
		if (error.status !== undefined && error.status >= 500) {
			return t('googleHealth.apiUnavailable');
		}
	}

	return error instanceof Error
		? error.message
		: t('googleHealth.checkFailed');
}

export async function checkGoogleConnectionHealth(
	input: GoogleConnectionHealthInput,
	dependencies: GoogleConnectionHealthDependencies,
): Promise<GoogleConnectionHealthReport> {
	const clientId = input.clientId.trim();
	const hasClientSecret = input.clientSecret.trim().length > 0;
	if (!clientId || !hasClientSecret) {
		const missing = !clientId && !hasClientSecret
			? t('googleHealth.credentialsBothMissing')
			: !clientId ? t('googleHealth.clientIdMissing') : t('googleHealth.clientSecretMissing');
		return report([
			step('credentials', 'failed', `${missing} ${t('googleHealth.importCredentials')}`),
			skipped('authorization'),
			skipped('youtube-api'),
		]);
	}

	const steps: GoogleConnectionHealthStep[] = [
		step('credentials', 'passed', t('googleHealth.credentialsSaved')),
	];
	if (!input.refreshToken) {
		return report([
			...steps,
			step('authorization', 'failed', t('googleHealth.noAuthorization')),
			skipped('youtube-api'),
		]);
	}

	try {
		await dependencies.refreshAuthorization(clientId);
		steps.push(step('authorization', 'passed', t('googleHealth.authorizationRenewed')));
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
		steps.push(step('youtube-api', 'passed', t('googleHealth.youtubeResponded').replace('{account}', accountLabel)));
	} catch (error: unknown) {
		steps.push(step('youtube-api', 'failed', getYouTubeFailure(error)));
	}

	return report(steps);
}
