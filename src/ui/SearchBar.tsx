export const SearchBar: React.FC<{ searchTerm: string, onSearchTermChange: (searchTerm: string) => void }> = ({ searchTerm, onSearchTermChange }) => {
    return (
        <div className="search-bar">
            <input
                type="text"
                placeholder="Search videos..."
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
            />
            {searchTerm && (
                <button
                    onClick={() => onSearchTermChange('')}
                    style={{
                        position: "absolute",
                        right: "0px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "16px",
                        color: "#999",
                        borderRadius: "0px 8px 8px 0px",
                        transition: "color 0.3s ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#666"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "#999"}
                >
                    &#x2715;
                </button>
            )}
        </div>
    );
};
