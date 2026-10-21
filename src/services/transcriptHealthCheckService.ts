import { TranscriptServiceError } from './transcriptService';
import type { VideoTranscript } from './transcriptService';
import { t } from '../i18n';

export interface TranscriptHealthCheckInput {
	videoId: string | null;
	videoTitle?: string;
	preferredLanguage: string;
}

export interface TranscriptHealthCheckReport {
	status: 'healthy' | 'unhealthy' | 'inconclusive';
	checkedAt: Date;
	detail: string;
}

export interface TranscriptHealthCheckDependencies {
	fetchTranscript: (videoId: string, preferredLanguage: string) => Promise<VideoTranscript>;
}

function report(
	status: TranscriptHealthCheckReport['status'],
	detail: string,
): TranscriptHealthCheckReport {
	return { status, checkedAt: new Date(), detail };
}

export async function checkTranscriptHealth(
	input: TranscriptHealthCheckInput,
	dependencies: TranscriptHealthCheckDependencies,
): Promise<TranscriptHealthCheckReport> {
	if (!input.videoId) {
		return report('inconclusive', t('transcriptHealth.noSavedVideo'));
	}

	try {
		const transcript = await dependencies.fetchTranscript(input.videoId, input.preferredLanguage);
		const videoLabel = input.videoTitle?.trim() || input.videoId;
		return report(
			'healthy',
			t('transcriptHealth.fetchedSegments').replace('{count}', transcript.segments.length.toLocaleString()).replace('{title}', videoLabel),
		);
	} catch (error: unknown) {
		if (error instanceof TranscriptServiceError) {
			if (error.code === 'unavailable') {
				return report(
					'inconclusive',
					t('transcriptHealth.noUsableCaptions'),
				);
			}
			if (error.code === 'blocked') {
				return report('unhealthy', t('transcriptHealth.blocked'));
			}
			if (error.code === 'timeout') {
				return report('unhealthy', t('transcriptHealth.timeout'));
			}
			if (error.code === 'network') {
				return report('unhealthy', t('transcriptHealth.connectionFailed'));
			}
			return report('unhealthy', t('transcriptHealth.unexpectedResponse'));
		}
		return report('unhealthy', t('transcriptHealth.checkFailed'));
	}
}
