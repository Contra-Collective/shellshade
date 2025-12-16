import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection';
import type { ThemeColors, ThemeSettings } from '../../shared/types/theme';

interface BuiltinThemeFile {
  name: string;
  author?: string;
  description?: string;
  colors: ThemeColors;
  settings?: ThemeSettings;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function colorsToRows(themeId: string, colors: ThemeColors) {
  const rows: Array<{ theme_id: string; color_key: string; hex_value: string }> = [];

  rows.push({ theme_id: themeId, color_key: 'background', hex_value: colors.background });
  rows.push({ theme_id: themeId, color_key: 'foreground', hex_value: colors.foreground });
  rows.push({ theme_id: themeId, color_key: 'cursor', hex_value: colors.cursor });
  rows.push({ theme_id: themeId, color_key: 'cursorText', hex_value: colors.cursorText });
  rows.push({ theme_id: themeId, color_key: 'selection', hex_value: colors.selection });
  rows.push({ theme_id: themeId, color_key: 'selectionText', hex_value: colors.selectionText });

  const ansiKeys = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
  ] as const;

  for (const key of ansiKeys) {
    rows.push({ theme_id: themeId, color_key: `ansi_${key}`, hex_value: colors.ansi[key] });
  }

  return rows;
}

export async function loadBuiltinThemes(): Promise<number> {
  const db = getDatabase();

  // Check if we already have builtin themes
  const existingCount = db.prepare('SELECT COUNT(*) as count FROM themes WHERE is_builtin = 1').get() as { count: number };
  if (existingCount.count > 0) {
    return existingCount.count;
  }

  // Find the builtin themes directory
  let themesDir: string;
  if (app.isPackaged) {
    // In production, themes are in resources
    themesDir = path.join(process.resourcesPath, 'builtin-themes');
  } else {
    // In development, themes are in the project root
    themesDir = path.join(__dirname, '../../..', 'resources/builtin-themes');
  }

  if (!fs.existsSync(themesDir)) {
    return 0;
  }

  const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.json'));

  const insertTheme = db.prepare(`
    INSERT INTO themes (id, name, slug, description, author, created_at, updated_at, is_favorite, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `);

  const insertColor = db.prepare(`
    INSERT INTO theme_colors (theme_id, color_key, hex_value) VALUES (?, ?, ?)
  `);

  const insertSetting = db.prepare(`
    INSERT INTO theme_settings (theme_id, setting_key, setting_value) VALUES (?, ?, ?)
  `);

  let loadedCount = 0;

  const loadThemes = db.transaction(() => {
    for (const file of files) {
      try {
        const filePath = path.join(themesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const theme: BuiltinThemeFile = JSON.parse(content);

        const id = uuidv4();
        const now = Date.now();
        const slug = slugify(theme.name);

        insertTheme.run(
          id,
          theme.name,
          slug,
          theme.description || null,
          theme.author || null,
          now,
          now
        );

        const colorRows = colorsToRows(id, theme.colors);
        for (const row of colorRows) {
          insertColor.run(row.theme_id, row.color_key, row.hex_value);
        }

        if (theme.settings) {
          const settings = theme.settings;
          if (settings.fontFamily) insertSetting.run(id, 'fontFamily', settings.fontFamily);
          if (settings.fontSize) insertSetting.run(id, 'fontSize', settings.fontSize.toString());
          if (settings.lineHeight) insertSetting.run(id, 'lineHeight', settings.lineHeight.toString());
          if (settings.cursorStyle) insertSetting.run(id, 'cursorStyle', settings.cursorStyle);
          if (settings.cursorBlink !== undefined) insertSetting.run(id, 'cursorBlink', settings.cursorBlink.toString());
        }

        loadedCount++;
      } catch {
        // Skip invalid theme files
      }
    }
  });

  loadThemes();

  return loadedCount;
}
