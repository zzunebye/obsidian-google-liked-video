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
				{icon}
				{title}
				{badge && <span className="video-count-badge">{badge}</span>}
			</div>
			{actions && (
				<div className="video-view-header__actions">{actions}</div>
			)}
		</div>
	);
};
