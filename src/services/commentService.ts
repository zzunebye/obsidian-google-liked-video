import { getValidAccessToken } from "../auth";
import type { ObsidianGoogleLikedVideoSettings } from "../types";

const YOUTUBE_API_BASE_URL = "https://youtube.googleapis.com/youtube/v3/";
const COMMENT_LIMIT = 10;

type JsonRecord = Record<string, unknown>;

export interface VideoComment {
	readonly id: string;
	readonly authorDisplayName: string;
	readonly authorProfileImageUrl: string;
	readonly authorChannelId?: string;
	readonly text: string;
	readonly likeCount: number;
	readonly publishedAt: string;
	readonly replyCount: number;
	readonly likedByViewer: boolean;
}

export interface VideoCommentsResult {
	readonly comments: readonly VideoComment[];
	readonly myChannelId?: string;
	readonly identityUnavailable: boolean;
}

export type CommentServiceErrorCode =
	| "comments-disabled"
	| "not-found"
	| "forbidden"
	| "network"
	| "invalid-response";

export class CommentServiceError extends Error {
	constructor(
		readonly code: CommentServiceErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CommentServiceError";
	}
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function readString(record: JsonRecord, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readNumber(record: JsonRecord, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" ? value : undefined;
}

function parseCommentThread(value: unknown): VideoComment | null {
	if (!isRecord(value)) return null;
	const threadSnippet = value.snippet;
	if (!isRecord(threadSnippet)) return null;
	const topLevelComment = threadSnippet.topLevelComment;
	if (!isRecord(topLevelComment)) return null;
	const commentSnippet = topLevelComment.snippet;
	if (!isRecord(commentSnippet)) return null;

	const id = readString(topLevelComment, "id");
	const authorDisplayName = readString(commentSnippet, "authorDisplayName");
	const text = readString(commentSnippet, "textDisplay");
	const publishedAt = readString(commentSnippet, "publishedAt");
	if (!id || !authorDisplayName || text === undefined || !publishedAt) return null;

	const authorChannel = commentSnippet.authorChannelId;
	const authorChannelId = isRecord(authorChannel)
		? readString(authorChannel, "value")
		: undefined;

	return {
		id,
		authorDisplayName,
		authorProfileImageUrl: readString(commentSnippet, "authorProfileImageUrl") ?? "",
		authorChannelId,
		text,
		likeCount: readNumber(commentSnippet, "likeCount") ?? 0,
		publishedAt,
		replyCount: readNumber(threadSnippet, "totalReplyCount") ?? 0,
		likedByViewer: readString(commentSnippet, "viewerRating") === "like",
	};
}

function readApiErrorReason(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.error)) return undefined;
	const errors = value.error.errors;
	if (!Array.isArray(errors)) return undefined;
	for (const error of errors) {
		if (isRecord(error)) {
			const reason = readString(error, "reason");
			if (reason) return reason;
		}
	}
	return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

export class CommentService {
	private myChannelIdPromise: Promise<string | null> | null = null;
	private identityController: AbortController | null = null;

	constructor(private readonly settings: ObsidianGoogleLikedVideoSettings) {}

	resetIdentityCache(): void {
		this.identityController?.abort();
		this.identityController = null;
		this.myChannelIdPromise = null;
	}

	cleanup(): void {
		this.resetIdentityCache();
	}

	async fetchVideoComments(videoId: string, signal: AbortSignal): Promise<VideoCommentsResult> {
		const commentsPromise = this.fetchTopLevelComments(videoId, signal);
		const identityPromise = this.getMyChannelId().then(
			(myChannelId) => ({ myChannelId, identityUnavailable: false }),
			(error: unknown) => {
				if (error instanceof DOMException && error.name === "AbortError") throw error;
				return { myChannelId: null, identityUnavailable: true };
			},
		);
		const [comments, identity] = await Promise.all([commentsPromise, identityPromise]);
		if (signal.aborted) throw new DOMException("The request was aborted.", "AbortError");

		return {
			comments,
			myChannelId: identity.myChannelId ?? undefined,
			identityUnavailable: identity.identityUnavailable,
		};
	}

	private async fetchTopLevelComments(videoId: string, signal: AbortSignal): Promise<readonly VideoComment[]> {
		const url = new URL(YOUTUBE_API_BASE_URL + "commentThreads");
		url.searchParams.set("part", "snippet");
		url.searchParams.set("videoId", videoId);
		url.searchParams.set("order", "relevance");
		url.searchParams.set("maxResults", String(COMMENT_LIMIT));
		url.searchParams.set("textFormat", "plainText");
		const body = await this.get(url, signal);
		if (!isRecord(body) || !Array.isArray(body.items)) {
			throw new CommentServiceError("invalid-response", "YouTube returned an invalid comments response.");
		}
		return body.items.flatMap((item) => {
			const comment = parseCommentThread(item);
			return comment ? [comment] : [];
		});
	}

	private getMyChannelId(): Promise<string | null> {
		if (!this.myChannelIdPromise) {
			const controller = new AbortController();
			this.identityController = controller;
			this.myChannelIdPromise = this.fetchMyChannelId(controller.signal).then(
				(channelId) => {
					if (this.identityController === controller) {
						this.identityController = null;
					}
					return channelId;
				},
				(error: unknown) => {
					if (this.identityController === controller) {
						this.identityController = null;
						this.myChannelIdPromise = null;
					}
					throw error;
				},
			);
		}
		return this.myChannelIdPromise;
	}

	private async fetchMyChannelId(signal: AbortSignal): Promise<string | null> {
		const url = new URL(YOUTUBE_API_BASE_URL + "channels");
		url.searchParams.set("part", "id");
		url.searchParams.set("mine", "true");
		const body = await this.get(url, signal);
		if (!isRecord(body) || !Array.isArray(body.items)) {
			throw new CommentServiceError("invalid-response", "YouTube returned an invalid channel response.");
		}
		for (const item of body.items) {
			if (isRecord(item)) {
				const id = readString(item, "id");
				if (id) return id;
			}
		}
		return null;
	}

	private async get(url: URL, signal: AbortSignal): Promise<unknown> {
		const accessToken = await getValidAccessToken(this.settings.googleClientId);
		let response: Response;
		try {
			response = await fetch(url.toString(), {
				method: "GET",
				headers: { Authorization: `Bearer ${accessToken}` },
				signal,
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") throw error;
			throw new CommentServiceError("network", "Could not connect to YouTube.");
		}

		const body = await readResponseBody(response);
		if (response.ok) return body;
		const reason = readApiErrorReason(body);
		if (reason === "commentsDisabled") {
			throw new CommentServiceError("comments-disabled", "Comments are disabled for this video.");
		}
		if (response.status === 404) {
			throw new CommentServiceError("not-found", "This video is no longer available.");
		}
		if (response.status === 403) {
			throw new CommentServiceError("forbidden", "YouTube could not return comments. Check your connection or API quota.");
		}
		throw new CommentServiceError("network", `YouTube request failed (${response.status}).`);
	}
}
