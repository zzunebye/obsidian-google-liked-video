interface ViewHeaderProps {
	icon: React.ReactNode;
	title: React.ReactNode;
	actions?: React.ReactNode;
}

export const ViewHeader: React.FC<ViewHeaderProps> = ({
	icon,
	title,
	actions,
}) => {
	return (
		<div className="video-view-header">
			<div className="video-view-header__title">
				{icon}
				{title}
			</div>
			{actions && (
				<div className="video-view-header__actions">{actions}</div>
			)}
		</div>
	);
};
