import { useEffect, useState } from "react";
import { LikedVideoView } from "../views/LikedVideoView";
import { YouTubeVideo } from "../types";
import * as React from "react";
import { localStorageService } from "../storage";

const VideosProvider: React.FC<{ videos: YouTubeVideo[] }> = ({ videos }) => {
    const [videoList, setVideoList] = useState<YouTubeVideo[]>(videos);

	useEffect(() => localStorageService.subscribeLikedVideos(setVideoList), []);

    return (
        <VideosContext.Provider value={[videoList, setVideoList]}>
            <LikedVideoView />
        </VideosContext.Provider>
    );
};

const VideosContext = React.createContext<[YouTubeVideo[], React.Dispatch<React.SetStateAction<YouTubeVideo[]>>]>([[], () => { }]);

const useVideos = (): [YouTubeVideo[], React.Dispatch<React.SetStateAction<YouTubeVideo[]>>] => {
    return React.useContext(VideosContext);
};

export { VideosProvider, VideosContext, useVideos };
