export const SearchBar: React.FC<{ searchTerm: string, onSearchTermChange: (searchTerm: string) => void }> = ({ searchTerm, onSearchTermChange }) => {
    return (
        <div style={{
            position: "relative",
            width: "100%",
        }}
        >
            <input
                type="text"
                placeholder="Search videos..."
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                style={{
                    width: "100%",
                    fontSize: "16px",
                    outline: "none",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    transition: "border-color 0.3s ease, box-shadow 0.3s ease",
                    padding: "12px 20px",
                }}
                onFocus={(e) => {
                    e.target.style.borderColor = "#007BFF";
                    e.target.style.boxShadow = "0 2px 8px rgba(0, 123, 255, 0.2)";
                }}
                onBlur={(e) => {
                    e.target.style.borderColor = "#ddd";
                    e.target.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)";
                }}
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
