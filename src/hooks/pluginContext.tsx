import * as React from "react";
import GoogleLikedVideoPlugin from "../main";

const PluginContext = React.createContext<GoogleLikedVideoPlugin | null>(null);

const usePlugin = (): GoogleLikedVideoPlugin | null => {
    return React.useContext(PluginContext);
};

export { PluginContext, usePlugin };
