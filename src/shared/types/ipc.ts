import type { Theme, ThemeSummary, ThemeFormat, Tag } from './theme';

/**
 * Result of theme installation
 */
export interface InstallResult {
  success: boolean;
  path: string;
  instructions?: string;
  error?: string;
}

/**
 * Information about installed themes
 */
export interface InstalledTheme {
  name: string;
  emulator: 'terminal' | 'iterm2' | 'alacritty' | 'kitty' | 'warp';
  path: string;
}

/**
 * IPC channel names
 */
export const IPC_CHANNELS = {
  // Theme operations
  THEMES_GET_ALL: 'themes:getAll',
  THEMES_GET_BY_ID: 'themes:getById',
  THEMES_CREATE: 'themes:create',
  THEMES_UPDATE: 'themes:update',
  THEMES_DELETE: 'themes:delete',
  THEMES_DUPLICATE: 'themes:duplicate',
  THEMES_TOGGLE_FAVORITE: 'themes:toggleFavorite',

  // File operations
  FILES_IMPORT: 'files:import',
  FILES_EXPORT: 'files:export',
  FILES_DRAG_IMPORT: 'files:dragImport',

  // Installation
  INSTALL_TERMINAL_APP: 'install:terminalApp',
  INSTALL_ITERM2: 'install:iterm2',
  INSTALL_WINDOWS_TERMINAL: 'install:windowsTerminal',
  INSTALL_ALACRITTY: 'install:alacritty',
  INSTALL_KITTY: 'install:kitty',
  INSTALL_DETECT: 'install:detect',
  SYSTEM_GET_PLATFORM: 'system:getPlatform',

  // Tags
  TAGS_GET_ALL: 'tags:getAll',
  TAGS_CREATE: 'tags:create',
  TAGS_DELETE: 'tags:delete',
  TAGS_ADD_TO_THEME: 'tags:addToTheme',
  TAGS_REMOVE_FROM_THEME: 'tags:removeFromTheme',

  // System
  SYSTEM_GET_FONTS: 'system:getFonts',
  SYSTEM_OPEN_IN_FINDER: 'system:openInFinder',
  SYSTEM_GET_VERSION: 'system:getVersion',
} as const;

/**
 * Type-safe IPC API exposed to renderer
 */
export interface IpcApi {
  themes: {
    getAll(): Promise<ThemeSummary[]>;
    getById(id: string): Promise<Theme | null>;
    create(theme: Omit<Theme, 'id' | 'createdAt' | 'updatedAt'>): Promise<Theme>;
    update(id: string, updates: Partial<Theme>): Promise<Theme>;
    delete(id: string): Promise<void>;
    duplicate(id: string, newName: string): Promise<Theme>;
    toggleFavorite(id: string): Promise<boolean>;
  };

  files: {
    import(path?: string): Promise<Theme>;
    export(themeId: string, format: ThemeFormat, path?: string): Promise<string>;
    dragImport(filePath: string): Promise<Theme>;
  };

  install: {
    toTerminalApp(themeId: string): Promise<InstallResult>;
    toIterm2(themeId: string): Promise<InstallResult>;
    toWindowsTerminal(themeId: string): Promise<InstallResult>;
    toAlacritty(themeId: string): Promise<InstallResult>;
    toKitty(themeId: string): Promise<InstallResult>;
    setTerminalDefault(themeId: string): Promise<InstallResult>;
    detectInstalled(): Promise<InstalledTheme[]>;
  };

  tags: {
    getAll(): Promise<Tag[]>;
    create(name: string, color?: string): Promise<Tag>;
    delete(id: number): Promise<void>;
    addToTheme(themeId: string, tagId: number): Promise<void>;
    removeFromTheme(themeId: string, tagId: number): Promise<void>;
  };

  system: {
    getFonts(): Promise<string[]>;
    openInFinder(path: string): Promise<void>;
    getVersion(): Promise<string>;
    getPlatform(): Promise<'darwin' | 'win32' | 'linux'>;
  };
}
