import { useState, useEffect, useCallback } from "react";
import { TAbstractFile, EventRef } from "obsidian";
import { sanitizeFileName, computeExpectedNotePath } from "src/utils/noteUtils";

/**
 * Hook that reactively tracks whether a video note file exists in the vault.
 * Listens to vault create/delete/rename events and re-checks only when
 * the affected file path matches the expected note path.
 */
export const useNoteExistence = (
    plugin: any,
    videoTitle: string,
    channelTitle: string
): boolean => {
    const baseFileName = sanitizeFileName(videoTitle);
    const videoNotePath = plugin.settings?.videoNotePath || 'Youtube';
    const organizeByChannel = plugin.settings?.organizeByChannel || false;

    const checkExists = useCallback((): boolean => {
        const expectedPath = computeExpectedNotePath(
            plugin.app,
            baseFileName,
            videoNotePath,
            organizeByChannel,
            channelTitle
        );
        return plugin.app.vault.getAbstractFileByPath(expectedPath) !== null;
    }, [plugin.app, baseFileName, videoNotePath, organizeByChannel, channelTitle]);

    const [exists, setExists] = useState(() => checkExists());

    // Re-check when checkExists dependencies change (e.g. settings update)
    useEffect(() => {
        setExists(checkExists());
    }, [checkExists]);

    useEffect(() => {
        const expectedPath = computeExpectedNotePath(
            plugin.app,
            baseFileName,
            videoNotePath,
            organizeByChannel,
            channelTitle
        );

        const handleVaultChange = (file: TAbstractFile) => {
            if (file.path === expectedPath) {
                setExists(checkExists());
            }
        };

        const handleRename = (file: TAbstractFile, oldPath: string) => {
            if (file.path === expectedPath || oldPath === expectedPath) {
                setExists(checkExists());
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
    }, [plugin.app, baseFileName, videoNotePath, organizeByChannel, channelTitle, checkExists]);

    return exists;
};
