import { TranscriptServiceError } from './transcriptService';
import type { VideoTranscript } from './transcriptService';

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
		return report('inconclusive', 'No saved video is available to test. Fetch liked videos, then try again.');
	}

	try {
		const transcript = await dependencies.fetchTranscript(input.videoId, input.preferredLanguage);
		const videoLabel = input.videoTitle?.trim() || input.videoId;
		return report(
			'healthy',
			`Fetched ${transcript.segments.length.toLocaleString()} transcript segments from “${videoLabel}”.`,
		);
	} catch (error: unknown) {
		if (error instanceof TranscriptServiceError) {
			if (error.code === 'unavailable') {
				return report(
					'inconclusive',
					'The most recently saved video has no usable captions. This does not indicate a service problem.',
				);
			}
			if (error.code === 'blocked') {
				return report('unhealthy', 'YouTube is blocking transcript requests right now. Try again later.');
			}
			if (error.code === 'timeout') {
				return report('unhealthy', 'Transcript fetching timed out. Check your connection and try again.');
			}
			if (error.code === 'network') {
				return report('unhealthy', 'Geulo could not reach YouTube transcript endpoints. Check your connection and try again.');
			}
			return report('unhealthy', 'YouTube returned an unexpected transcript response. Try again later.');
		}
		return report('unhealthy', 'The transcript access check failed. Try again.');
	}
}
