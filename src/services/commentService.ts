import { YouTubeApiClient, YouTubeRequestError } from "./youtubeApiClient";
import { YouTubeAccountIdentityService } from "./youtubeAccountIdentityService";

export const COMMENT_LIMIT = 30;

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

export class CommentService {
	constructor(
		private readonly client: YouTubeApiClient,
		private readonly identityService = new YouTubeAccountIdentityService(client),
	) {}

	resetIdentityCache(): void {
		this.identityService.reset();
	}

	cleanup(): void {
		this.resetIdentityCache();
	}

	async fetchVideoComments(videoId: string, signal: AbortSignal): Promise<VideoCommentsResult> {
		const commentsPromise = this.fetchTopLevelComments(videoId, signal);
		const identityPromise = this.identityService.getCurrentIdentity().then(
			(identity) => ({ myChannelId: identity.channelId, identityUnavailable: false }),
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
		const params = new URLSearchParams({
			part: "snippet",
			videoId,
			order: "relevance",
			maxResults: String(COMMENT_LIMIT),
			textFormat: "plainText",
		});
		const body = await this.get(`commentThreads?${params.toString()}`, signal);
		if (!isRecord(body) || !Array.isArray(body.items)) {
			throw new CommentServiceError("invalid-response", "YouTube returned an invalid comments response.");
		}
		return body.items.flatMap((item) => {
			const comment = parseCommentThread(item);
			return comment ? [comment] : [];
		});
	}

	private async get(path: string, signal: AbortSignal): Promise<unknown> {
		try {
			return (await this.client.request("GET", path, { signal })).json;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") throw error;
			if (error instanceof YouTubeRequestError) {
				if (error.reasons.includes("commentsDisabled")) {
					throw new CommentServiceError("comments-disabled", "Comments are disabled for this video.");
				}
				if (error.status === 404) {
					throw new CommentServiceError("not-found", "This video is no longer available.");
				}
				if (error.status === 403) {
					throw new CommentServiceError("forbidden", "YouTube could not return comments. Check your connection or API quota.");
				}
				throw new CommentServiceError("network", error.message);
			}
			throw new CommentServiceError("network", "Could not connect to YouTube.");
		}
	}
}
