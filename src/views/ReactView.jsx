export const LikedVideoView = (
    { videos }
) => {
    return <div>
        <h1>Liked Videos</h1>
        {videos.slice(0, 10).map((video) => (
            <VideoCard
                key={video.id}
                title={video.snippet.title}
                channel={video.snippet.channelTitle}
                date={new Date(video.snippet.publishedAt).toLocaleDateString()}
                thumbnail={video.snippet.thumbnails.default.url}
            />
        ))}
    </div>;
};

const VideoCard = ({ title, channel, date, thumbnail }) => {
    return (
        <div
            className="video-card"
            style={{
                border: "1px solid black",
                borderRadius: "8px",
                padding: "8px",
                margin: "8px",
                display: "flex",
                gap: "8px",
                cursor: "pointer",
                transition: "background-color 0.3s ease",
            }}
            onClick={() => {/* Add your click handler here */ }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f0f0f0"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
        >
            <img className="video-thumbnail" src={thumbnail} alt="Video Thumbnail" />
            <div className="video-details">
                <h2 className="video-title">{title}</h2>
                <span className="video-channel">Channel: {channel}</span>
                <span className="video-date">Published on: {date}</span>
            </div>
        </div>
    );
};
