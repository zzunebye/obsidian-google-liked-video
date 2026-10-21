import { t } from "../i18n";

export const SearchBar: React.FC<{
    searchTerm: string,
    onSearchTermChange: (searchTerm: string) => void,
    escapeClearsSearch?: boolean,
    ariaLabel?: string,
    placeholder?: string,
}> = ({ searchTerm, onSearchTermChange, escapeClearsSearch = false, ariaLabel = t("search.label"), placeholder = t("search.placeholder") }) => {
    return (
        <div className="search-bar">
            <input
                type="text"
				aria-label={ariaLabel}
				placeholder={placeholder}
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
            />
            {searchTerm && (
                <button
                    type="button"
                    onClick={() => onSearchTermChange('')}
                    className="search-bar__button"
					title={escapeClearsSearch ? t("search.clearWithEscape") : t("search.clear")}
					aria-label={t("search.clear")}
                    aria-keyshortcuts={escapeClearsSearch ? "Escape" : undefined}
                >
                    &#x2715;
                </button>
            )}
        </div>
    );
};
