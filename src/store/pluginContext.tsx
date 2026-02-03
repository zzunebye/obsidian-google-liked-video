import * as React from "react";
import GoogleLikedVideoPlugin from "../main";

const PluginContext = React.createContext<GoogleLikedVideoPlugin | null>(null);

const usePlugin = (): GoogleLikedVideoPlugin => {
    const plugin = React.useContext(PluginContext);
    if (!plugin) {
        throw new Error("usePlugin must be used within a PluginContext.Provider");
    }
    return plugin;
};

export { PluginContext, usePlugin };
