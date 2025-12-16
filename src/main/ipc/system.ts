import { ipcMain, shell, app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IPC_CHANNELS } from '../../shared/types/ipc';

const execAsync = promisify(exec);

export function registerSystemHandlers(): void {
  // Get system fonts (macOS)
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_FONTS, async (): Promise<string[]> => {
    try {
      // Use macOS font list command
      const { stdout } = await execAsync(
        'system_profiler SPFontsDataType -json 2>/dev/null | grep -o \'"_name" : "[^"]*"\' | cut -d\'"\' -f4 | sort -u'
      );

      const fonts = stdout
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      // Add common monospace fonts that should be prioritized
      const monospaceFonts = [
        'SF Mono',
        'Monaco',
        'Menlo',
        'Consolas',
        'Courier New',
        'JetBrains Mono',
        'Fira Code',
        'Source Code Pro',
        'IBM Plex Mono',
        'Hack',
        'Cascadia Code',
        'Roboto Mono',
        'Ubuntu Mono',
        'Inconsolata',
      ];

      // Combine and deduplicate
      const allFonts = [...new Set([...monospaceFonts, ...fonts])];

      return allFonts.sort();
    } catch {
      // Return fallback list if font detection fails
      return [
        'SF Mono',
        'Monaco',
        'Menlo',
        'Consolas',
        'Courier New',
      ];
    }
  });

  // Open path in Finder
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_IN_FINDER, async (_, path: string): Promise<void> => {
    await shell.showItemInFolder(path);
  });

  // Get app version
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_VERSION, async (): Promise<string> => {
    return app.getVersion();
  });
}
