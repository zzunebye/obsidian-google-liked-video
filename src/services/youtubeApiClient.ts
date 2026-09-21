import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { debugLogger } from "src/debug";

const YOUTUBE_API_BASE_URL = "https://youtube.googleapis.com/youtube/v3/";
export const YOUTUBE_REQUEST_TIMEOUT_MS = 90000;

export type YouTubeRequestMethod = "GET" | "POST" | "DELETE";
export type YouTubeRequestErrorKind = "http" | "network" | "timeout" | "auth";

export interface YouTubeRequestOptions extends Pick<RequestUrlParam, "body" | "contentType" | "headers"> {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export class YouTubeRequestError extends Error {
	constructor(
		readonly kind: YouTubeRequestErrorKind,
		message: string,
		readonly status?: number,
		readonly reasons: readonly string[] = [],
		readonly originalError?: unknown,
	) {
		super(message);
		this.name = "YouTubeRequestError";
	}
}

type AccessTokenProvider = () => Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function createAbortError(): DOMException {
	return new DOMException("Request aborted", "AbortError");
}

function readErrorBody(response: RequestUrlResponse): unknown {
	try {
		return response.json;
	} catch {
		return undefined;
	}
}

function readGoogleError(body: unknown): { message?: string; reasons: string[] } {
	if (!isRecord(body) || !isRecord(body.error)) return { reasons: [] };
	const message = typeof body.error.message === "string" ? body.error.message : undefined;
	const errors = body.error.errors;
	if (!Array.isArray(errors)) return { message, reasons: [] };
	const reasons = errors.flatMap((error) =>
		isRecord(error) && typeof error.reason === "string" ? [error.reason] : [],
	);
	return { message, reasons };
}

function createHttpError(response: RequestUrlResponse): YouTubeRequestError {
	const { message, reasons } = readGoogleError(readErrorBody(response));
	return new YouTubeRequestError(
		response.status === 401 ? "auth" : "http",
		message ?? `YouTube API request failed (${response.status}).`,
		response.status,
		reasons,
	);
}

export class YouTubeApiClient {
	constructor(
		private readonly accessTokenProvider: AccessTokenProvider,
		private readonly accessTokenRefresher?: AccessTokenProvider,
	) {}

	async request(
		method: YouTubeRequestMethod,
		path: string,
		options: YouTubeRequestOptions = {},
	): Promise<RequestUrlResponse> {
		if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
			throw new Error("YouTube API requests require a relative path.");
		}

		const normalizedPath = path.replace(/^\/+/, "");
		const signal = options.signal;
		let stopReason: Error | null = signal?.aborted ? createAbortError() : null;
		if (stopReason) throw stopReason;

		let timeoutId: number | undefined;
		let abortListener: (() => void) | undefined;
		const stop = new Promise<never>((_, reject) => {
			timeoutId = window.setTimeout(() => {
				const error = new YouTubeRequestError("timeout", "YouTube request timed out.");
				stopReason = error;
				reject(error);
			}, options.timeoutMs ?? YOUTUBE_REQUEST_TIMEOUT_MS);

			if (signal) {
				abortListener = () => {
					const error = createAbortError();
					stopReason = error;
					reject(error);
				};
				signal.addEventListener("abort", abortListener, { once: true });
			}
		});

		const throwIfStopped = (): void => {
			if (stopReason) throw stopReason;
		};

		const operation = (async (): Promise<RequestUrlResponse> => {
			const getAccessToken = async (
				provider: AccessTokenProvider,
				failureMessage: string,
			): Promise<string> => {
				let accessToken: string;
				try {
					accessToken = await provider();
				} catch (error) {
					throwIfStopped();
					throw new YouTubeRequestError("auth", failureMessage, undefined, [], error);
				}
				throwIfStopped();
				if (!accessToken) {
					throw new YouTubeRequestError("auth", "Google access token is unavailable.");
				}
				return accessToken;
			};
			const sendRequest = async (accessToken: string): Promise<RequestUrlResponse> => {
				debugLogger.api(`${method} request to: ${normalizedPath}`);
				let response: RequestUrlResponse;
				try {
					response = await requestUrl({
						url: YOUTUBE_API_BASE_URL + normalizedPath,
						method,
						headers: {
							...options.headers,
							Authorization: `Bearer ${accessToken}`,
						},
						body: options.body,
						contentType: options.contentType,
						throw: false,
					});
				} catch (error) {
					throwIfStopped();
					throw new YouTubeRequestError("network", "Could not connect to YouTube.", undefined, [], error);
				}
				throwIfStopped();
				debugLogger.api(`Response status: ${response.status}`);
				return response;
			};

			const accessToken = await getAccessToken(
				this.accessTokenProvider,
				"Could not authenticate with Google.",
			);
			let response = await sendRequest(accessToken);
			if (response.status === 401 && this.accessTokenRefresher) {
				const refreshedAccessToken = await getAccessToken(
					this.accessTokenRefresher,
					"Could not refresh Google authorization.",
				);
				response = await sendRequest(refreshedAccessToken);
			}
			if (response.status < 200 || response.status >= 300) throw createHttpError(response);
			return response;
		})();

		try {
			return await Promise.race([operation, stop]);
		} finally {
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			if (signal && abortListener) signal.removeEventListener("abort", abortListener);
		}
	}
}
