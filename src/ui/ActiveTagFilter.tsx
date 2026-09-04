interface ActiveTagFilterProps {
	tag: string;
	onClear: () => void;
}

export const ActiveTagFilter = ({ tag, onClear }: ActiveTagFilterProps) => (
	<div className="active-tag-filter" aria-label="Active video tag filter">
		<button
			type="button"
			className="active-tag-filter__chip"
			title={`Clear video tag filter: ${tag}`}
			onClick={onClear}
		>
			<span className="active-tag-filter__label">Tag: {tag}</span>
			<span className="active-tag-filter__remove" aria-hidden="true">
				×
			</span>
		</button>
	</div>
);
