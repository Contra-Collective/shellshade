import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types/ipc';
import type { IpcApi } from '../shared/types/ipc';

/**
 * Electron preload script
 * Exposes a type-safe IPC API to the renderer process via contextBridge
 */

const api: IpcApi = {
  themes: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.THEMES_GET_ALL),
    getById: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_GET_BY_ID, id),
    create: (theme) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_CREATE, theme),
    update: (id: string, updates) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_UPDATE, id, updates),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_DELETE, id),
    duplicate: (id: string, newName: string) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_DUPLICATE, id, newName),
    toggleFavorite: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.THEMES_TOGGLE_FAVORITE, id),
  },

  files: {
    import: (path?: string) => ipcRenderer.invoke(IPC_CHANNELS.FILES_IMPORT, path),
    export: (themeId: string, format, path?: string) => ipcRenderer.invoke(IPC_CHANNELS.FILES_EXPORT, themeId, format, path),
    dragImport: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILES_DRAG_IMPORT, filePath),
  },

  install: {
    toTerminalApp: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_TERMINAL_APP, themeId),
    toIterm2: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_ITERM2, themeId),
    toWindowsTerminal: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_WINDOWS_TERMINAL, themeId),
    toAlacritty: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_ALACRITTY, themeId),
    toKitty: (themeId: string) => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_KITTY, themeId),
    setTerminalDefault: (themeId: string) => ipcRenderer.invoke('install:set-terminal-default', themeId),
    detectInstalled: () => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_DETECT),
  },

  tags: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.TAGS_GET_ALL),
    create: (name: string, color?: string) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, name, color),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id),
    addToTheme: (themeId: string, tagId: number) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_ADD_TO_THEME, themeId, tagId),
    removeFromTheme: (themeId: string, tagId: number) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_THEME, themeId, tagId),
  },

  system: {
    getFonts: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_FONTS),
    openInFinder: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_IN_FINDER, path),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_VERSION),
    getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_PLATFORM),
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('api', api);
