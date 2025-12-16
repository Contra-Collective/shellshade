import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { parseThemeFile } from '../services/parsers';
import { getDatabase } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import type { Theme, ThemeFormat } from '../../shared/types/theme';

// Helper to generate unique slug
function generateUniqueSlug(db: ReturnType<typeof getDatabase>, baseName: string): string {
  const baseSlug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let slug = baseSlug;
  let counter = 1;

  // Check if slug exists
  const checkSlug = db.prepare('SELECT COUNT(*) as count FROM themes WHERE slug = ?');

  while ((checkSlug.get(slug) as { count: number }).count > 0) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

// Helper to generate unique name for author
function generateUniqueName(db: ReturnType<typeof getDatabase>, baseName: string, author: string): string {
  let name = baseName;
  let counter = 1;

  // Check if name+author combo exists
  const checkName = db.prepare('SELECT COUNT(*) as count FROM themes WHERE name = ? AND author = ?');

  while ((checkName.get(name, author) as { count: number }).count > 0) {
    name = `${baseName} (${counter})`;
    counter++;
  }

  return name;
}

export function registerFileHandlers(): void {
  // Import theme from file
  ipcMain.handle(IPC_CHANNELS.FILES_IMPORT, async (_, filePath?: string): Promise<Theme | null> => {
    let targetPath = filePath;

    if (!targetPath) {
      const result = await dialog.showOpenDialog({
        title: 'Import Theme',
        filters: [
          { name: 'All Theme Files', extensions: ['itermcolors', 'yaml', 'yml', 'json', 'conf'] },
          { name: 'iTerm2', extensions: ['itermcolors', 'json'] },
          { name: 'Alacritty', extensions: ['yaml', 'yml'] },
          { name: 'Kitty', extensions: ['conf'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      targetPath = result.filePaths[0];
    }

    try {
      // Parse the theme file
      const parsed = parseThemeFile(targetPath);

      // Generate ID
      const id = uuidv4();
      const db = getDatabase();

      // Generate unique slug and name to avoid constraint violations
      const slug = generateUniqueSlug(db, parsed.name);
      const uniqueName = generateUniqueName(db, parsed.name, 'Imported');

      // Save to database
      db.prepare(`
        INSERT INTO themes (id, name, slug, author, description, is_favorite, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
      `).run(id, uniqueName, slug, 'Imported', `Imported from ${targetPath.split('/').pop()}`);

      // Insert colors
      const insertColor = db.prepare(`
        INSERT INTO theme_colors (theme_id, color_key, hex_value)
        VALUES (?, ?, ?)
      `);

      const colorEntries = [
        ['background', parsed.colors.background],
        ['foreground', parsed.colors.foreground],
        ['cursor', parsed.colors.cursor],
        ['cursorText', parsed.colors.cursorText],
        ['selection', parsed.colors.selection],
        ['selectionText', parsed.colors.selectionText],
        ['ansi_black', parsed.colors.ansi.black],
        ['ansi_red', parsed.colors.ansi.red],
        ['ansi_green', parsed.colors.ansi.green],
        ['ansi_yellow', parsed.colors.ansi.yellow],
        ['ansi_blue', parsed.colors.ansi.blue],
        ['ansi_magenta', parsed.colors.ansi.magenta],
        ['ansi_cyan', parsed.colors.ansi.cyan],
        ['ansi_white', parsed.colors.ansi.white],
        ['ansi_brightBlack', parsed.colors.ansi.brightBlack],
        ['ansi_brightRed', parsed.colors.ansi.brightRed],
        ['ansi_brightGreen', parsed.colors.ansi.brightGreen],
        ['ansi_brightYellow', parsed.colors.ansi.brightYellow],
        ['ansi_brightBlue', parsed.colors.ansi.brightBlue],
        ['ansi_brightMagenta', parsed.colors.ansi.brightMagenta],
        ['ansi_brightCyan', parsed.colors.ansi.brightCyan],
        ['ansi_brightWhite', parsed.colors.ansi.brightWhite],
      ];

      for (const [key, value] of colorEntries) {
        insertColor.run(id, key, value);
      }

      // Return the created theme
      const theme: Theme = {
        id,
        name: uniqueName,
        slug,
        author: 'Imported',
        description: `Imported from ${targetPath.split('/').pop()}`,
        colors: parsed.colors,
        settings: {
          fontFamily: 'SF Mono',
          fontSize: 13,
          lineHeight: 1.4,
          cursorStyle: 'block',
          cursorBlink: true,
        },
        tags: [],
        isFavorite: false,
        isBuiltin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return theme;
    } catch (err) {
      throw new Error(`Failed to import theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Export theme to file
  ipcMain.handle(IPC_CHANNELS.FILES_EXPORT, async (_, _themeId: string, format: ThemeFormat, filePath?: string): Promise<string> => {
    let targetPath = filePath;

    const extensionMap: Record<ThemeFormat, string> = {
      terminal: 'terminal',
      iterm2: 'itermcolors',
      'iterm2-json': 'json',
      alacritty: 'yaml',
      kitty: 'conf',
      base16: 'yaml',
      warp: 'yaml',
      json: 'json',
      css: 'css',
    };

    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: 'Export Theme',
        defaultPath: `theme.${extensionMap[format]}`,
        filters: [
          { name: format, extensions: [extensionMap[format]] },
        ],
      });

      if (result.canceled || !result.filePath) {
        throw new Error('Export cancelled');
      }

      targetPath = result.filePath;
    }

    // TODO: Implement actual serialization with parser registry
    throw new Error('Export not yet implemented. Coming soon!');
  });

  // Drag & drop import
  ipcMain.handle(IPC_CHANNELS.FILES_DRAG_IMPORT, async (_, filePath: string): Promise<Theme> => {
    // Parse and import the dropped file
    const parsed = parseThemeFile(filePath);
    const id = uuidv4();
    const db = getDatabase();

    // Generate unique slug and name to avoid constraint violations
    const slug = generateUniqueSlug(db, parsed.name);
    const uniqueName = generateUniqueName(db, parsed.name, 'Imported');

    db.prepare(`
      INSERT INTO themes (id, name, slug, author, description, is_favorite, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
    `).run(id, uniqueName, slug, 'Imported', `Imported from ${filePath.split('/').pop()}`);

    const insertColor = db.prepare(`
      INSERT INTO theme_colors (theme_id, color_key, hex_value)
      VALUES (?, ?, ?)
    `);

    const colorEntries = [
      ['background', parsed.colors.background],
      ['foreground', parsed.colors.foreground],
      ['cursor', parsed.colors.cursor],
      ['cursorText', parsed.colors.cursorText],
      ['selection', parsed.colors.selection],
      ['selectionText', parsed.colors.selectionText],
      ['ansi_black', parsed.colors.ansi.black],
      ['ansi_red', parsed.colors.ansi.red],
      ['ansi_green', parsed.colors.ansi.green],
      ['ansi_yellow', parsed.colors.ansi.yellow],
      ['ansi_blue', parsed.colors.ansi.blue],
      ['ansi_magenta', parsed.colors.ansi.magenta],
      ['ansi_cyan', parsed.colors.ansi.cyan],
      ['ansi_white', parsed.colors.ansi.white],
      ['ansi_brightBlack', parsed.colors.ansi.brightBlack],
      ['ansi_brightRed', parsed.colors.ansi.brightRed],
      ['ansi_brightGreen', parsed.colors.ansi.brightGreen],
      ['ansi_brightYellow', parsed.colors.ansi.brightYellow],
      ['ansi_brightBlue', parsed.colors.ansi.brightBlue],
      ['ansi_brightMagenta', parsed.colors.ansi.brightMagenta],
      ['ansi_brightCyan', parsed.colors.ansi.brightCyan],
      ['ansi_brightWhite', parsed.colors.ansi.brightWhite],
    ];

    for (const [key, value] of colorEntries) {
      insertColor.run(id, key, value);
    }

    return {
      id,
      name: uniqueName,
      slug,
      author: 'Imported',
      description: `Imported from ${filePath.split('/').pop()}`,
      colors: parsed.colors,
      settings: {
        fontFamily: 'SF Mono',
        fontSize: 13,
        lineHeight: 1.4,
        cursorStyle: 'block',
        cursorBlink: true,
      },
      tags: [],
      isFavorite: false,
      isBuiltin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
}
