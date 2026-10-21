import { t } from "../i18n";

interface ActiveTagFilterProps {
	tag: string;
	onClear: () => void;
}

export const ActiveTagFilter = ({ tag, onClear }: ActiveTagFilterProps) => (
	<div className="active-tag-filter" aria-label={t("filter.activeTag")}>
		<button
			type="button"
			className="active-tag-filter__chip"
			title={`${t("filter.clearFilter")}: ${tag}`}
			onClick={onClear}
		>
			<span className="active-tag-filter__label">{t("filter.tag")}: {tag}</span>
			<span className="active-tag-filter__remove" aria-hidden="true">
				×
			</span>
		</button>
	</div>
);
