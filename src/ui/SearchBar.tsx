export const SearchBar: React.FC<{
    searchTerm: string,
    onSearchTermChange: (searchTerm: string) => void,
    escapeClearsSearch?: boolean,
}> = ({ searchTerm, onSearchTermChange, escapeClearsSearch = false }) => {
    return (
        <div className="search-bar">
            <input
                type="text"
                placeholder="Search by title, tags, or channel..."
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
