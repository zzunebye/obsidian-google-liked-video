import { OpenYouTubeButton } from "./OpenYouTubeButton";

interface ViewHeaderProps {
	icon: React.ReactNode;
	title: React.ReactNode;
	badge?: React.ReactNode;
	actions?: React.ReactNode;
}

export const ViewHeader: React.FC<ViewHeaderProps> = ({
	icon,
	title,
	badge,
	actions,
}) => {

	return (
		<div className="video-view-header">
			<div className="video-view-header__title">
				<span aria-hidden="true">{icon}</span>
				<h2 className="video-view-header__heading">{title}</h2>
				{badge && <span className="video-count-badge">{badge}</span>}
			</div>
			<div className="video-view-header__actions">
				<OpenYouTubeButton />
				{actions}
			</div>
		</div>
	);
};
