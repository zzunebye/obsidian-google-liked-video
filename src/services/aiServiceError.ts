export type AIServiceErrorType =
	| 'no_api_key'
	| 'invalid_key'
	| 'network_error'
	| 'rate_limit'
	| 'unknown';

export class AIServiceError extends Error {
	constructor(
		readonly type: AIServiceErrorType,
		message: string,
	) {
		super(message);
		this.name = 'AIServiceError';
	}
}

export function toAIServiceError(error: unknown): AIServiceError {
	if (error instanceof AIServiceError) return error;
	return new AIServiceError(
		'unknown',
		error instanceof Error ? error.message : 'Unknown error',
	);
}
