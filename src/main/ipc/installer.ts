import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import {
  installToIterm2,
  installToTerminalApp,
  installToWindowsTerminal,
  installToAlacritty,
  installToKitty,
  setTerminalDefault,
  getPlatform,
} from '../services/installer';
import type { InstallResult, InstalledTheme } from '../../shared/types/ipc';

export function registerInstallHandlers(): void {
  // Install to Terminal.app (macOS)
  ipcMain.handle(IPC_CHANNELS.INSTALL_TERMINAL_APP, async (_, themeId: string): Promise<InstallResult> => {
    return installToTerminalApp(themeId);
  });

  // Install to iTerm2 (macOS)
  ipcMain.handle(IPC_CHANNELS.INSTALL_ITERM2, async (_, themeId: string): Promise<InstallResult> => {
    return installToIterm2(themeId);
  });

  // Install to Windows Terminal
  ipcMain.handle(IPC_CHANNELS.INSTALL_WINDOWS_TERMINAL, async (_, themeId: string): Promise<InstallResult> => {
    return installToWindowsTerminal(themeId);
  });

  // Install to Alacritty (cross-platform)
  ipcMain.handle(IPC_CHANNELS.INSTALL_ALACRITTY, async (_, themeId: string): Promise<InstallResult> => {
    return installToAlacritty(themeId);
  });

  // Install to Kitty (Linux/macOS)
  ipcMain.handle(IPC_CHANNELS.INSTALL_KITTY, async (_, themeId: string): Promise<InstallResult> => {
    return installToKitty(themeId);
  });

  // Set as default Terminal.app profile
  ipcMain.handle('install:set-terminal-default', async (_, themeId: string): Promise<InstallResult> => {
    return setTerminalDefault(themeId);
  });

  // Get platform
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_PLATFORM, async (): Promise<'darwin' | 'win32' | 'linux'> => {
    return getPlatform();
  });

  // Detect installed themes (placeholder)
  ipcMain.handle(IPC_CHANNELS.INSTALL_DETECT, async (): Promise<InstalledTheme[]> => {
    // TODO: Scan for installed themes in various locations
    return [];
  });
}
