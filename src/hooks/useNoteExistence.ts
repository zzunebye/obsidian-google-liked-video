import { useState, useEffect, useMemo } from "react";
import { TAbstractFile, EventRef } from "obsidian";
import { sanitizeFileName, computeExpectedNotePath } from "src/utils/noteUtils";
import { YouTubeVideo } from "src/types";

/**
 * React hook that efficiently tracks the existence of note files in the Obsidian vault
 * for a batch of YouTube videos.
 *
 * - Accepts a plugin and an array of YouTubeVideo objects.
 * - For each video, computes the path where its note should exist according to the plugin settings.
 * - Returns a reactive Map<String, Boolean> where the key is the video ID.
 *   The value is true if the expected note file currently exists in the vault, false otherwise.
 *
 * Key Features:
 * - Uses a single set of listeners on the vault for all videos, rather than one per video,
 *   providing efficient and centralized file monitoring.
 * - The returned Map updates whenever files are created, deleted, or renamed
 *   in the vault, ensuring consumers always have up-to-date existence info.
 * - Handles any changes in videos or plugin settings, updating the tracking as needed.
 *
 * Example usage:
 *   const existenceMap = useNoteExistenceMap(plugin, videos);
 *   const doesExist = existenceMap.get(videoId) // true if a note file exists for that video
 */
export const useNoteExistenceMap = (
    plugin: any,
    videos: YouTubeVideo[]
): Map<string, boolean> => {
    const videoNotePath = plugin.settings?.videoNotePath || 'Youtube';
    const shouldGroupByChannel = plugin.settings?.organizeByChannel || false;

    // Build a stable lookup: expectedPath → videoId, and videoId → expectedPath
    const { pathToId, idToPath } = useMemo(() => {
        const pathToIdMap = new Map<string, string>();
        const idToPathMap = new Map<string, string>();
        for (const video of videos) {
            const baseFileName = sanitizeFileName(video.snippet.title);
            const expectedPath = computeExpectedNotePath(
                plugin.app,
                baseFileName,
                videoNotePath,
                shouldGroupByChannel,
                video.snippet.channelTitle
            );
            pathToIdMap.set(expectedPath, video.id);
            idToPathMap.set(video.id, expectedPath);
        }
        return { pathToId: pathToIdMap, idToPath: idToPathMap };
    }, [plugin.app, videos, videoNotePath, shouldGroupByChannel]);

    // Compute existence synchronously when paths change
    const initialExistence = useMemo((): Map<string, boolean> => {
        const result = new Map<string, boolean>();
        for (const [videoId, path] of idToPath) {
            result.set(videoId, plugin.app.vault.getAbstractFileByPath(path) !== null);
        }
        return result;
    }, [plugin.app, idToPath]);

    const [existenceMap, setExistenceMap] = useState(initialExistence);
    const [prevIdToPath, setPrevIdToPath] = useState(idToPath);

    // Reset state during render when videos change (React recommended pattern)
    if (idToPath !== prevIdToPath) {
        setPrevIdToPath(idToPath);
        setExistenceMap(initialExistence);
    }

    // Single set of vault listeners for all videos on the current page
    // These listeners subscribe to file creation, deletion, and rename events in the Obsidian Vault to update the [existenceMap] in real time.
    useEffect(() => {
        const handleVaultChange = (file: TAbstractFile) => {
            const videoId = pathToId.get(file.path);
            if (videoId !== undefined) {
                const exists = plugin.app.vault.getAbstractFileByPath(file.path) !== null;
                setExistenceMap(prev => {
                    if (prev.get(videoId) === exists) return prev;
                    const next = new Map(prev);
                    next.set(videoId, exists);
                    return next;
                });
            }
        };

        const handleRename = (file: TAbstractFile, oldPath: string) => {
            const newPathVideoId = pathToId.get(file.path);
            const oldPathVideoId = pathToId.get(oldPath);

            if (newPathVideoId !== undefined || oldPathVideoId !== undefined) {
                setExistenceMap(prev => {
                    const next = new Map(prev);
                    if (newPathVideoId !== undefined) {
                        next.set(newPathVideoId, plugin.app.vault.getAbstractFileByPath(file.path) !== null);
                    }
                    if (oldPathVideoId !== undefined && oldPathVideoId !== newPathVideoId) {
                        next.set(oldPathVideoId, plugin.app.vault.getAbstractFileByPath(oldPath) !== null);
                    }
                    return next;
                });
            }
        };

        const vault = plugin.app.vault;
        const refs: EventRef[] = [
            vault.on('create', handleVaultChange),
            vault.on('delete', handleVaultChange),
            vault.on('rename', handleRename),
        ];

        return () => {
            refs.forEach((ref) => vault.offref(ref));
        };
    }, [plugin.app, pathToId]);

    return existenceMap;
};

