export const SearchBar: React.FC<{ searchTerm: string, onSearchTermChange: (searchTerm: string) => void }> = ({ searchTerm, onSearchTermChange }) => {
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
                    onClick={() => onSearchTermChange('')}
                    className="search-bar__button" 
                >
                    &#x2715;
                </button>
            )}
        </div>
    );
};
