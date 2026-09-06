import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, moment } from "obsidian";
import { MessageCircle, ThumbsUp } from "lucide-react";
import type { CommentService, VideoComment, VideoCommentsResult } from "../services/commentService";
import { COMMENT_LIMIT, CommentServiceError } from "../services/commentService";
import { ReactModal } from "./ReactModal";

type CommentsState =
	| { readonly kind: "loading" }
	| { readonly kind: "loaded"; readonly result: VideoCommentsResult }
	| { readonly kind: "error"; readonly message: string };

interface VideoCommentsContentProps {
	readonly videoId: string;
	readonly videoTitle: string;
	readonly service: CommentService;
}

interface CommentItemProps {
	readonly comment: VideoComment;
	readonly isOwnComment: boolean;
}

function CommentItem({ comment, isOwnComment }: CommentItemProps) {
	const textId = useId();
	const textRef = useRef<HTMLParagraphElement>(null);
	const [isCollapsible, setIsCollapsible] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);

	useLayoutEffect(() => {
		if (isExpanded) return;
		const textElement = textRef.current;
		if (!textElement) return;

		const updateCollapsibleState = () => {
			setIsCollapsible(textElement.scrollHeight > textElement.clientHeight + 1);
		};
		updateCollapsibleState();

		const observer = new ResizeObserver(updateCollapsibleState);
		observer.observe(textElement);
		return () => observer.disconnect();
	}, [comment.text, isExpanded]);

	return (
		<article className="video-comment">
			<div className="video-comment__avatar" aria-hidden="true">
				{comment.authorProfileImageUrl ? (
					<img src={comment.authorProfileImageUrl} alt="" />
				) : (
					<span>{comment.authorDisplayName.slice(0, 1).toUpperCase()}</span>
				)}
			</div>
			<div className="video-comment__body">
				<div className="video-comment__header">
					<strong>{comment.authorDisplayName}</strong>
					<span>{moment(comment.publishedAt).fromNow()}</span>
				</div>
				{(comment.likedByViewer || isOwnComment) && (
					<div className="video-comment__badges" aria-label="Your activity on this comment">
						{comment.likedByViewer && (
							<span className="video-comment__badge"><ThumbsUp size={12} />Liked by you</span>
						)}
						{isOwnComment && (
							<span className="video-comment__badge"><MessageCircle size={12} />Your comment</span>
						)}
					</div>
				)}
				<p
					ref={textRef}
					id={textId}
					className={`video-comment__text${isExpanded ? "" : " video-comment__text--collapsed"}`}
				>
					{comment.text}
				</p>
				{isCollapsible && (
					<button
						type="button"
						className="video-comment__toggle"
						aria-controls={textId}
						aria-expanded={isExpanded}
						onClick={() => setIsExpanded((expanded) => !expanded)}
					>
						{isExpanded ? "Show less" : "View more"}
					</button>
				)}
				<div className="video-comment__meta">
					<span><ThumbsUp size={13} />{comment.likeCount.toLocaleString()}</span>
					{comment.replyCount > 0 && (
						<span><MessageCircle size={13} />{comment.replyCount.toLocaleString()} {comment.replyCount === 1 ? "reply" : "replies"}</span>
					)}
				</div>
			</div>
		</article>
	);
}

function VideoCommentsContent({ videoId, videoTitle, service }: VideoCommentsContentProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [requestVersion, setRequestVersion] = useState(0);
	const [state, setState] = useState<CommentsState>({ kind: "loading" });

	useEffect(() => {
		contentRef.current?.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		setState({ kind: "loading" });
		void service.fetchVideoComments(videoId, controller.signal).then(
			(result) => setState({ kind: "loaded", result }),
			(error: unknown) => {
				if (error instanceof DOMException && error.name === "AbortError") return;
				const message = error instanceof CommentServiceError
					? error.message
					: "Could not load comments.";
				setState({ kind: "error", message });
			},
		);
		return () => controller.abort();
	}, [requestVersion, service, videoId]);

	const groupedComments = useMemo(() => {
		if (state.kind !== "loaded") return null;
		const myChannelId = state.result.myChannelId;
		const isUserActivity = (comment: VideoComment) =>
			comment.likedByViewer || (myChannelId !== undefined && comment.authorChannelId === myChannelId);
		return {
			activity: state.result.comments.filter(isUserActivity),
			others: state.result.comments.filter((comment) => !isUserActivity(comment)),
		};
	}, [state]);

	return (
		<div
			ref={contentRef}
			className="video-comments-modal"
			tabIndex={-1}
			aria-label={`Comments for ${videoTitle}`}
		>
			<p className="video-comments-modal__video-title" title={videoTitle}>{videoTitle}</p>
			<p className="video-comments-modal__scope">Most relevant · Up to {COMMENT_LIMIT} top-level comments</p>
			{state.kind === "loading" && (
				<div className="video-comments-modal__status" role="status">Loading comments…</div>
			)}
			{state.kind === "error" && (
				<div className="video-comments-modal__status" role="alert">
					<p>{state.message}</p>
					<button type="button" onClick={() => setRequestVersion((version) => version + 1)}>Try again</button>
				</div>
			)}
			{state.kind === "loaded" && groupedComments && (
				<div className="video-comments-modal__content">
					{state.result.identityUnavailable && (
						<p className="video-comments-modal__notice">Your comments could not be identified. Liked comments are still highlighted.</p>
					)}
					{state.result.comments.length === 0 && (
						<div className="video-comments-modal__status">No comments to show.</div>
					)}
					{groupedComments.activity.length > 0 && (
						<section className="video-comments-section">
							<div className="video-comments-section__heading">
								<h3>Your activity</h3>
								<span>Among the comments loaded</span>
							</div>
							{groupedComments.activity.map((comment) => (
								<CommentItem key={comment.id} comment={comment} isOwnComment={comment.authorChannelId === state.result.myChannelId} />
							))}
						</section>
					)}
					{groupedComments.others.length > 0 && (
						<section className="video-comments-section">
							<div className="video-comments-section__heading"><h3>Most relevant</h3></div>
							{groupedComments.others.map((comment) => (
								<CommentItem key={comment.id} comment={comment} isOwnComment={false} />
							))}
						</section>
					)}
				</div>
			)}
		</div>
	);
}

export class VideoCommentsModal extends ReactModal {
	constructor(
		app: App,
		videoId: string,
		videoTitle: string,
		service: CommentService,
		onClose: () => void,
	) {
		super(
			app,
			<VideoCommentsContent videoId={videoId} videoTitle={videoTitle} service={service} />,
			{ title: "Comments", width: "640px", height: "min(760px, 80vh)", onClose },
		);
		this.modalEl.addClass("geulo-video-comments-dialog");
	}
}
