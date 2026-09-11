/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-comment-service-'));
const outputPath = path.join(outputDirectory, 'comment-service-verification.cjs');

await build({
	stdin: {
		contents: `
			export { CommentService, CommentServiceError } from './src/services/commentService.ts';
			export { YouTubeApiClient } from './src/services/youtubeApiClient.ts';
		`,
		resolveDir: process.cwd(),
		sourcefile: 'comment-service-verification-entry.ts',
	},
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outfile: outputPath,
	plugins: [{
		name: 'comment-service-verification-stubs',
		setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({
				path: 'obsidian',
				namespace: 'verification',
			}));
			builder.onResolve({ filter: /^src\/debug$/ }, () => ({
				path: 'debug',
				namespace: 'verification',
			}));
			builder.onLoad({ filter: /.*/, namespace: 'verification' }, (args) => ({
				contents: args.path === 'obsidian'
					? `export const requestUrl = (request) => globalThis.requestUrl(request);`
					: `export const debugLogger = { api() {} };`,
				loader: 'js',
			}));
		},
	}],
});

const require = createRequire(import.meta.url);
const { CommentService, CommentServiceError, YouTubeApiClient } = require(outputPath);
const requests = [];
let commentsResponse = {
	status: 200,
	json: {
		items: [{
			id: 'thread-id',
			snippet: {
				totalReplyCount: 2,
				topLevelComment: {
					id: 'comment-id',
					snippet: {
						authorDisplayName: 'Viewer',
						authorProfileImageUrl: 'https://example.com/avatar.png',
						authorChannelId: { value: 'viewer-channel' },
						textDisplay: 'Helpful comment',
						likeCount: 4,
						publishedAt: '2026-09-06T00:00:00Z',
						viewerRating: 'like',
					},
				},
			},
		}],
	},
};

globalThis.requestUrl = async (request) => {
	requests.push(request);
	if (request.url.includes('/channels?')) {
		return { status: 200, json: { items: [{ id: 'my-channel' }] } };
	}
	return commentsResponse;
};
globalThis.window = {
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const service = new CommentService(new YouTubeApiClient(async () => 'access-token'));
const result = await service.fetchVideoComments('video-id', new AbortController().signal);
assert.equal(result.comments.length, 1);
assert.equal(result.comments[0].id, 'comment-id');
assert.equal(result.comments[0].likedByViewer, true);
assert.equal(result.myChannelId, 'my-channel');
assert.equal(requests[0].method, 'GET');
assert.equal(requests[0].headers.Authorization, 'Bearer access-token');
assert.match(requests[0].url, /commentThreads\?/);

commentsResponse = {
	status: 403,
	json: { error: { errors: [{ reason: 'commentsDisabled' }] } },
};
await assert.rejects(
	service.fetchVideoComments('disabled-video', new AbortController().signal),
	(error) => error instanceof CommentServiceError && error.code === 'comments-disabled',
);

service.resetIdentityCache();
globalThis.requestUrl = () => new Promise(() => {});
const controller = new AbortController();
const abortedRequest = service.fetchVideoComments('slow-video', controller.signal);
controller.abort();
await assert.rejects(
	abortedRequest,
	(error) => error instanceof DOMException && error.name === 'AbortError',
);
service.cleanup();

console.log('comment-service requestUrl verification passed');
