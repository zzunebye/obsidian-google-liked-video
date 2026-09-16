import { ChevronDown } from "lucide-react";

interface FilterOption {
	value: string;
	label: string;
	count?: number;
	disabled?: boolean;
}

interface LikedVideoFilterSelectProps {
	label: string;
	ariaLabel: string;
	value: string;
	options: readonly FilterOption[];
	onChange: (value: string) => void;
	description?: string;
	disabled?: boolean;
	showLabel?: boolean;
}

export const LikedVideoFilterSelect = ({
	label,
	ariaLabel,
	value,
	options,
	onChange,
	description,
	disabled = false,
	showLabel = true,
}: LikedVideoFilterSelectProps) => {
	const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

	return (
		<label className={`liked-video-filter ${value !== "all" ? "liked-video-filter--active" : ""}`}>
			{showLabel && <span className="liked-video-filter__label">{label}</span>}
			<span className="liked-video-filter__select-wrapper">
				<select
					className="liked-video-filter__control liked-video-filter__select"
					aria-label={ariaLabel}
					title={description}
					value={value}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				>
					{options.map((option) => (
						<option key={option.value} value={option.value} disabled={option.disabled}>
							{option.label}{option.count === undefined ? "" : ` (${option.count})`}
						</option>
					))}
				</select>
				<span className="liked-video-filter__select-value" aria-hidden="true">{selectedLabel}</span>
				<ChevronDown className="liked-video-filter__chevron" size={16} aria-hidden="true" />
			</span>
		</label>
	);
};
