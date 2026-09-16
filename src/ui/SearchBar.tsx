export const SearchBar: React.FC<{
    searchTerm: string,
    onSearchTermChange: (searchTerm: string) => void,
    escapeClearsSearch?: boolean,
    ariaLabel?: string,
    placeholder?: string,
}> = ({ searchTerm, onSearchTermChange, escapeClearsSearch = false, ariaLabel = "Search liked videos", placeholder = "Search by title, tags, or channel..." }) => {
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
                    title={escapeClearsSearch ? "Clear search (Esc)" : "Clear search"}
                    aria-label="Clear search"
                    aria-keyshortcuts={escapeClearsSearch ? "Escape" : undefined}
                >
                    &#x2715;
                </button>
            )}
        </div>
    );
};
