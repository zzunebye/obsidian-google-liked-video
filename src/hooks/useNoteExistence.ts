import { useState, useEffect, useMemo } from "react";
import { TAbstractFile, EventRef } from "obsidian";
import { sanitizeFileName, computeExpectedNotePath } from "src/utils/noteUtils";
import { YouTubeVideo } from "src/types";

/**
 * Hook that reactively tracks whether video note files exist in the vault
 * for a batch of videos. Uses a single set of vault listeners instead of
 * one per video card.
 *
 * Returns a Map<videoId, boolean> indicating note existence.
 */
export const useNoteExistenceMap = (
    plugin: any,
    videos: YouTubeVideo[]
): Map<string, boolean> => {
    const videoNotePath = plugin.settings?.videoNotePath || 'Youtube';
    const organizeByChannel = plugin.settings?.organizeByChannel || false;

    // Build a stable lookup: expectedPath → videoId, and videoId → expectedPath
    const { pathToId, idToPath } = useMemo(() => {
        const pathToId = new Map<string, string>();
        const idToPath = new Map<string, string>();
        for (const video of videos) {
            const baseFileName = sanitizeFileName(video.snippet.title);
            const expectedPath = computeExpectedNotePath(
                plugin.app,
                baseFileName,
                videoNotePath,
                organizeByChannel,
                video.snippet.channelTitle
            );
            pathToId.set(expectedPath, video.id);
            idToPath.set(video.id, expectedPath);
        }
        return { pathToId, idToPath };
    }, [plugin.app, videos, videoNotePath, organizeByChannel]);

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
