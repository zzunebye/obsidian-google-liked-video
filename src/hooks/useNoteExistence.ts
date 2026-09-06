import { useState, useEffect, useMemo } from "react";
import { TFile, EventRef } from "obsidian";
import { sanitizeFileName, computeExpectedNotePath } from "src/utils/noteUtils";
import { getVideoNoteId, indexVideoNotesById } from "src/utils/videoNoteUtils";
import { YouTubeVideo } from "src/types";
import type GoogleLikedVideoPlugin from "src/main";

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
    plugin: GoogleLikedVideoPlugin,
    videos: YouTubeVideo[]
): Map<string, boolean> => {
    const configuredPath = plugin.settings?.videoNotePath?.trim() || '';
    const videoNotePath = configuredPath;
    const shouldGroupByChannel = configuredPath.length > 0 && (plugin.settings?.organizeByChannel || false);

    const idToPaths = useMemo(() => {
        const idToPathsMap = new Map<string, readonly string[]>();
        for (const video of videos) {
            const baseFileName = sanitizeFileName(video.snippet.title);
            const expectedPath = computeExpectedNotePath(
                plugin.app,
                baseFileName,
                videoNotePath,
                shouldGroupByChannel,
                video.snippet.channelTitle
            );
            const legacyPaths = configuredPath
                ? [expectedPath]
                : [
                    expectedPath,
                    computeExpectedNotePath(
                        plugin.app,
                        baseFileName,
                        'Youtube',
                        shouldGroupByChannel,
                        video.snippet.channelTitle,
                    ),
                ];
            idToPathsMap.set(video.id, legacyPaths);
        }
        return idToPathsMap;
    }, [plugin.app, videos, configuredPath, videoNotePath, shouldGroupByChannel]);

    const computeExistence = (notesById = indexVideoNotesById(plugin.app)): Map<string, boolean> => {
        const result = new Map<string, boolean>();
        for (const [videoId, paths] of idToPaths) {
            if (notesById.has(videoId)) {
                result.set(videoId, true);
                continue;
            }
            const hasLegacyNote = paths.some((path) => {
                const noteAtLegacyPath = plugin.app.vault.getAbstractFileByPath(path);
                if (!(noteAtLegacyPath instanceof TFile)) return false;
                const pathVideoId = getVideoNoteId(plugin.app, noteAtLegacyPath);
                return pathVideoId === null || pathVideoId === videoId;
            });
            result.set(videoId, hasLegacyNote);
        }
        return result;
    };

    const initialExistence = useMemo((): Map<string, boolean> => {
        return computeExistence();
    }, [plugin.app, idToPaths]);

    const [existenceMap, setExistenceMap] = useState(initialExistence);
    const [prevIdToPaths, setPrevIdToPaths] = useState(idToPaths);

    // Reset state during render when videos change (React recommended pattern)
    if (idToPaths !== prevIdToPaths) {
        setPrevIdToPaths(idToPaths);
        setExistenceMap(initialExistence);
    }

    useEffect(() => {
        const trackedVideoIds = new Set(idToPaths.keys());
        const expectedPaths = new Set([...idToPaths.values()].flat());
        let trackedNotePaths = new Set(
            [...indexVideoNotesById(plugin.app)]
                .filter(([videoId]) => trackedVideoIds.has(videoId))
                .map(([, file]) => file.path),
        );
        const refreshExistence = () => {
            const notesById = indexVideoNotesById(plugin.app);
            trackedNotePaths = new Set(
                [...notesById]
                    .filter(([videoId]) => trackedVideoIds.has(videoId))
                    .map(([, file]) => file.path),
            );
            setExistenceMap(computeExistence(notesById));
        };

        const vault = plugin.app.vault;
        const vaultRefs: EventRef[] = [
            vault.on('create', refreshExistence),
            vault.on('delete', refreshExistence),
            vault.on('rename', refreshExistence),
        ];
        const metadataRef = plugin.app.metadataCache.on('changed', (file: TFile) => {
            const videoId = getVideoNoteId(plugin.app, file);
            if (trackedNotePaths.has(file.path)
                || (videoId !== null && trackedVideoIds.has(videoId))
                || expectedPaths.has(file.path)) {
                refreshExistence();
            }
        });

        return () => {
            vaultRefs.forEach((ref) => vault.offref(ref));
            plugin.app.metadataCache.offref(metadataRef);
        };
    }, [plugin.app, idToPaths]);

    return existenceMap;
};
