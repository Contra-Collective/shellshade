#!/usr/bin/env node
import Enquirer from 'enquirer';
import chalk from 'chalk';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import yaml from 'yaml';

// OS detection
type Platform = 'macos' | 'windows' | 'linux';
const currentPlatform: Platform = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows'
  : 'linux';

// Database path (platform-specific)
function getDbPath(): string {
  switch (currentPlatform) {
    case 'macos':
      return path.join(os.homedir(), 'Library/Application Support/shellshade/themes.db');
    case 'windows':
      return path.join(process.env.APPDATA || os.homedir(), 'shellshade/themes.db');
    case 'linux':
      return path.join(os.homedir(), '.config/shellshade/themes.db');
  }
}
const dbPath = getDbPath();

// Database migrations (same as main app)
const MIGRATIONS = [
  `
  -- Core theme storage
  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    author TEXT,
    source_url TEXT,
    source_format TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    is_builtin INTEGER DEFAULT 0,
    UNIQUE(name, author)
  );

  -- Theme color data (normalized for flexibility)
  CREATE TABLE IF NOT EXISTS theme_colors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    color_key TEXT NOT NULL,
    hex_value TEXT NOT NULL,
    UNIQUE(theme_id, color_key)
  );

  -- Theme metadata (font, cursor, etc.)
  CREATE TABLE IF NOT EXISTS theme_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    UNIQUE(theme_id, setting_key)
  );

  -- User-defined categories/tags
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS theme_tags (
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (theme_id, tag_id)
  );

  -- Export history
  CREATE TABLE IF NOT EXISTS export_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    format TEXT NOT NULL,
    export_path TEXT NOT NULL,
    exported_at INTEGER NOT NULL
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_themes_favorite ON themes(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_themes_updated ON themes(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_theme_colors_theme ON theme_colors(theme_id);
  `,
];

// Helper to strip JSON comments (JSONC support) while respecting strings
function stripJsonComments(content: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i++;
    } else if (char === '"') {
      inString = true;
      result += char;
      i++;
    } else if (char === '/' && nextChar === '/') {
      // Single-line comment - skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
    } else if (char === '/' && nextChar === '*') {
      // Multi-line comment - skip until */
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      i += 2; // Skip the closing */
    } else {
      result += char;
      i++;
    }
  }

  // Remove trailing commas before } or ]
  return result.replace(/,(\s*[}\]])/g, '$1');
}

// Helper to generate UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper to slugify theme names
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Find builtin themes directory
function getBuiltinThemesDir(): string | null {
  // Try multiple possible locations
  const possiblePaths = [
    // When running from dist/cli (npm linked or installed)
    path.join(__dirname, '../../resources/builtin-themes'),
    // When installed globally via npm
    path.join(__dirname, '../resources/builtin-themes'),
    // Development - running from project root
    path.join(process.cwd(), 'resources/builtin-themes'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// Initialize database and load themes
function initializeDatabase(): { success: boolean; message: string; themeCount?: number } {
  const dbDir = path.dirname(dbPath);

  // Create directory if needed
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Create/open database
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Run migrations
  for (const migration of MIGRATIONS) {
    db.exec(migration);
  }

  // Find builtin themes
  const themesDir = getBuiltinThemesDir();
  if (!themesDir) {
    db.close();
    return { success: false, message: 'Could not find builtin-themes directory' };
  }

  const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.json'));

  // Get existing slugs
  const existingSlugs = new Set(
    (db.prepare('SELECT slug FROM themes WHERE is_builtin = 1').all() as Array<{ slug: string }>)
      .map(t => t.slug)
  );

  const insertTheme = db.prepare(`
    INSERT INTO themes (id, name, slug, description, author, created_at, updated_at, is_favorite, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `);

  const insertColor = db.prepare(`
    INSERT INTO theme_colors (theme_id, color_key, hex_value) VALUES (?, ?, ?)
  `);

  let loadedCount = 0;
  let newCount = 0;

  const loadThemes = db.transaction(() => {
    for (const file of files) {
      try {
        const filePath = path.join(themesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const theme = JSON.parse(content);

        const slug = slugify(theme.name);

        if (existingSlugs.has(slug)) {
          loadedCount++;
          continue;
        }

        const id = generateUUID();
        const now = Date.now();

        insertTheme.run(
          id,
          theme.name,
          slug,
          theme.description || null,
          theme.author || null,
          now,
          now
        );

        // Insert colors
        const colors = theme.colors;
        insertColor.run(id, 'background', colors.background);
        insertColor.run(id, 'foreground', colors.foreground);
        insertColor.run(id, 'cursor', colors.cursor);
        insertColor.run(id, 'cursorText', colors.cursorText);
        insertColor.run(id, 'selection', colors.selection);
        insertColor.run(id, 'selectionText', colors.selectionText);

        const ansiKeys = [
          'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
          'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
        ];
        for (const key of ansiKeys) {
          insertColor.run(id, `ansi_${key}`, colors.ansi[key]);
        }

        loadedCount++;
        newCount++;
      } catch {
        // Skip invalid files
      }
    }
  });

  loadThemes();
  db.close();

  return {
    success: true,
    message: newCount > 0
      ? `Loaded ${newCount} new themes (${loadedCount} total)`
      : `Database already up to date (${loadedCount} themes)`,
    themeCount: loadedCount
  };
}

// Supported terminals per platform
type Terminal =
  // macOS
  | 'terminal' | 'iterm2' | 'warp'
  // Windows
  | 'windows-terminal' | 'powershell'
  // Cross-platform
  | 'alacritty' | 'kitty'
  // Linux
  | 'gnome-terminal' | 'konsole';

// Terminals available per platform
const platformTerminals: Record<Platform, Terminal[]> = {
  macos: ['terminal', 'iterm2', 'warp', 'alacritty', 'kitty'],
  windows: ['windows-terminal', 'powershell', 'alacritty', 'kitty'],
  linux: ['gnome-terminal', 'konsole', 'alacritty', 'kitty'],
};

// Detect which terminal is currently running
function detectTerminal(): Terminal {
  const term = process.env.TERM_PROGRAM?.toLowerCase() || '';
  const termId = process.env.LC_TERMINAL?.toLowerCase() || '';
  const wtSession = process.env.WT_SESSION;
  const psVersion = process.env.PSModulePath;

  // Windows detection
  if (currentPlatform === 'windows') {
    if (wtSession) return 'windows-terminal';
    if (psVersion) return 'powershell';
    if (term.includes('alacritty')) return 'alacritty';
    if (process.env.KITTY_WINDOW_ID) return 'kitty';
    return 'windows-terminal'; // default on Windows
  }

  // Linux detection
  if (currentPlatform === 'linux') {
    if (process.env.GNOME_TERMINAL_SCREEN) return 'gnome-terminal';
    if (process.env.KONSOLE_VERSION) return 'konsole';
    if (term.includes('alacritty')) return 'alacritty';
    if (process.env.KITTY_WINDOW_ID) return 'kitty';
    return 'gnome-terminal'; // default on Linux
  }

  // macOS detection
  if (term.includes('iterm') || termId.includes('iterm')) return 'iterm2';
  if (term.includes('warp') || process.env.WARP_IS_LOCAL_SHELL_SESSION) return 'warp';
  if (term.includes('alacritty')) return 'alacritty';
  if (term.includes('kitty') || process.env.KITTY_WINDOW_ID) return 'kitty';

  return 'terminal'; // default on macOS
}

// Terminal display names
const terminalNames: Record<Terminal, string> = {
  // macOS
  terminal: 'Terminal.app',
  iterm2: 'iTerm2',
  warp: 'Warp',
  // Windows
  'windows-terminal': 'Windows Terminal',
  powershell: 'PowerShell',
  // Cross-platform
  alacritty: 'Alacritty',
  kitty: 'Kitty',
  // Linux
  'gnome-terminal': 'GNOME Terminal',
  konsole: 'Konsole',
};

// Initialize database connection
function getDatabase(): Database.Database | null {
  if (!fs.existsSync(dbPath)) {
    console.log(chalk.yellow('\nShellShade database not found. Run `shellshade init` to initialize.\n'));
    return null;
  }
  return new Database(dbPath);
}

// Theme type
interface ThemeSummary {
  id: string;
  name: string;
  author: string | null;
  isBuiltin: boolean;
  isFavorite: boolean;
  background: string;
  foreground: string;
  cursor: string;
  ansiColors: string[]; // All 16 ANSI colors
}

// Full color map for installation
interface ThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorText: string;
  selection: string;
  selectionText: string;
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

// Get all themes
function getThemes(db: Database.Database): ThemeSummary[] {
  const themes = db.prepare(`
    SELECT
      t.id, t.name, t.author, t.is_builtin as isBuiltin, t.is_favorite as isFavorite,
      MAX(CASE WHEN tc.color_key = 'background' THEN tc.hex_value END) as background,
      MAX(CASE WHEN tc.color_key = 'foreground' THEN tc.hex_value END) as foreground,
      MAX(CASE WHEN tc.color_key = 'cursor' THEN tc.hex_value END) as cursor,
      MAX(CASE WHEN tc.color_key = 'ansi_black' THEN tc.hex_value END) as ansi_black,
      MAX(CASE WHEN tc.color_key = 'ansi_red' THEN tc.hex_value END) as ansi_red,
      MAX(CASE WHEN tc.color_key = 'ansi_green' THEN tc.hex_value END) as ansi_green,
      MAX(CASE WHEN tc.color_key = 'ansi_yellow' THEN tc.hex_value END) as ansi_yellow,
      MAX(CASE WHEN tc.color_key = 'ansi_blue' THEN tc.hex_value END) as ansi_blue,
      MAX(CASE WHEN tc.color_key = 'ansi_magenta' THEN tc.hex_value END) as ansi_magenta,
      MAX(CASE WHEN tc.color_key = 'ansi_cyan' THEN tc.hex_value END) as ansi_cyan,
      MAX(CASE WHEN tc.color_key = 'ansi_white' THEN tc.hex_value END) as ansi_white,
      MAX(CASE WHEN tc.color_key = 'ansi_brightBlack' THEN tc.hex_value END) as ansi_brightBlack,
      MAX(CASE WHEN tc.color_key = 'ansi_brightRed' THEN tc.hex_value END) as ansi_brightRed,
      MAX(CASE WHEN tc.color_key = 'ansi_brightGreen' THEN tc.hex_value END) as ansi_brightGreen,
      MAX(CASE WHEN tc.color_key = 'ansi_brightYellow' THEN tc.hex_value END) as ansi_brightYellow,
      MAX(CASE WHEN tc.color_key = 'ansi_brightBlue' THEN tc.hex_value END) as ansi_brightBlue,
      MAX(CASE WHEN tc.color_key = 'ansi_brightMagenta' THEN tc.hex_value END) as ansi_brightMagenta,
      MAX(CASE WHEN tc.color_key = 'ansi_brightCyan' THEN tc.hex_value END) as ansi_brightCyan,
      MAX(CASE WHEN tc.color_key = 'ansi_brightWhite' THEN tc.hex_value END) as ansi_brightWhite
    FROM themes t
    LEFT JOIN theme_colors tc ON t.id = tc.theme_id
    GROUP BY t.id
    ORDER BY
      t.is_favorite DESC,
      CASE WHEN t.name LIKE '%Light%' OR t.name LIKE '%Latte%' OR t.name LIKE '%Dawn%' THEN 1 ELSE 0 END,
      t.name
  `).all() as Array<{
    id: string;
    name: string;
    author: string | null;
    isBuiltin: number;
    isFavorite: number;
    background: string;
    foreground: string;
    cursor: string;
    ansi_black: string;
    ansi_red: string;
    ansi_green: string;
    ansi_yellow: string;
    ansi_blue: string;
    ansi_magenta: string;
    ansi_cyan: string;
    ansi_white: string;
    ansi_brightBlack: string;
    ansi_brightRed: string;
    ansi_brightGreen: string;
    ansi_brightYellow: string;
    ansi_brightBlue: string;
    ansi_brightMagenta: string;
    ansi_brightCyan: string;
    ansi_brightWhite: string;
  }>;

  return themes.map(t => ({
    id: t.id,
    name: t.name,
    author: t.author,
    isBuiltin: t.isBuiltin === 1,
    isFavorite: t.isFavorite === 1,
    background: t.background || '#000000',
    foreground: t.foreground || '#ffffff',
    cursor: t.cursor || t.foreground || '#ffffff',
    ansiColors: [
      t.ansi_black, t.ansi_red, t.ansi_green, t.ansi_yellow,
      t.ansi_blue, t.ansi_magenta, t.ansi_cyan, t.ansi_white,
      t.ansi_brightBlack, t.ansi_brightRed, t.ansi_brightGreen, t.ansi_brightYellow,
      t.ansi_brightBlue, t.ansi_brightMagenta, t.ansi_brightCyan, t.ansi_brightWhite
    ].map(c => c || '#888888'),
  }));
}

// Get full theme colors for installation
function getFullThemeColors(db: Database.Database, themeId: string): ThemeColors | null {
  const colors = db.prepare(`
    SELECT color_key, hex_value FROM theme_colors WHERE theme_id = ?
  `).all(themeId) as Array<{ color_key: string; hex_value: string }>;

  if (colors.length === 0) return null;

  const colorMap = new Map(colors.map(c => [c.color_key, c.hex_value]));

  return {
    background: colorMap.get('background') || '#000000',
    foreground: colorMap.get('foreground') || '#ffffff',
    cursor: colorMap.get('cursor') || '#ffffff',
    cursorText: colorMap.get('cursorText') || '#000000',
    selection: colorMap.get('selection') || '#444444',
    selectionText: colorMap.get('selectionText') || '#ffffff',
    ansi: {
      black: colorMap.get('ansi_black') || '#000000',
      red: colorMap.get('ansi_red') || '#ff0000',
      green: colorMap.get('ansi_green') || '#00ff00',
      yellow: colorMap.get('ansi_yellow') || '#ffff00',
      blue: colorMap.get('ansi_blue') || '#0000ff',
      magenta: colorMap.get('ansi_magenta') || '#ff00ff',
      cyan: colorMap.get('ansi_cyan') || '#00ffff',
      white: colorMap.get('ansi_white') || '#ffffff',
      brightBlack: colorMap.get('ansi_brightBlack') || '#666666',
      brightRed: colorMap.get('ansi_brightRed') || '#ff6666',
      brightGreen: colorMap.get('ansi_brightGreen') || '#66ff66',
      brightYellow: colorMap.get('ansi_brightYellow') || '#ffff66',
      brightBlue: colorMap.get('ansi_brightBlue') || '#6666ff',
      brightMagenta: colorMap.get('ansi_brightMagenta') || '#ff66ff',
      brightCyan: colorMap.get('ansi_brightCyan') || '#66ffff',
      brightWhite: colorMap.get('ansi_brightWhite') || '#ffffff',
    },
  };
}

// Toggle favorite status
function toggleFavorite(db: Database.Database, themeId: string): boolean {
  const theme = db.prepare('SELECT is_favorite FROM themes WHERE id = ?').get(themeId) as { is_favorite: number } | undefined;
  if (!theme) return false;
  const newValue = theme.is_favorite === 1 ? 0 : 1;
  db.prepare('UPDATE themes SET is_favorite = ? WHERE id = ?').run(newValue, themeId);
  return newValue === 1;
}

// Render color block
function colorBlock(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return chalk.bgRgb(r, g, b)('  ');
}

// Convert hex to RGB components
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// Render theme preview
function renderThemePreview(theme: ThemeSummary): void {
  const fav = theme.isFavorite ? chalk.yellow(' ★') : '';
  console.log('\n' + chalk.bold(theme.name) + fav);
  if (theme.author) {
    console.log(chalk.dim(`by ${theme.author}`));
  }
  console.log();

  // Color palette - normal colors
  process.stdout.write('  Normal:  ');
  for (let i = 0; i < 8; i++) {
    process.stdout.write(colorBlock(theme.ansiColors[i]) + ' ');
  }
  console.log();

  // Color palette - bright colors
  process.stdout.write('  Bright:  ');
  for (let i = 8; i < 16; i++) {
    process.stdout.write(colorBlock(theme.ansiColors[i]) + ' ');
  }
  console.log('\n');

  // Sample terminal output with actual colors
  const { r: bgR, g: bgG, b: bgB } = hexToRgb(theme.background);
  const { r: fgR, g: fgG, b: fgB } = hexToRgb(theme.foreground);

  const bg = chalk.bgRgb(bgR, bgG, bgB);
  const fg = chalk.rgb(fgR, fgG, fgB);

  // Get ANSI colors for colored output
  const green = hexToRgb(theme.ansiColors[2]);
  const blue = hexToRgb(theme.ansiColors[4]);
  const cyan = hexToRgb(theme.ansiColors[6]);
  const yellow = hexToRgb(theme.ansiColors[3]);

  const pad = '                                          ';

  console.log(bg(fg('  ') + chalk.rgb(green.r, green.g, green.b).bgRgb(bgR, bgG, bgB)('user') + fg('@') + chalk.rgb(cyan.r, cyan.g, cyan.b).bgRgb(bgR, bgG, bgB)('mac') + fg(' ~ $ ls -la') + bg(fg(pad.slice(0, 22)))));
  console.log(bg(fg('  total 32') + fg(pad.slice(0, 32))));
  console.log(bg(chalk.rgb(blue.r, blue.g, blue.b).bgRgb(bgR, bgG, bgB)('  drwxr-xr-x') + fg('  5 user staff  160 ') + chalk.rgb(yellow.r, yellow.g, yellow.b).bgRgb(bgR, bgG, bgB)('src/') + fg(pad.slice(0, 12))));
  console.log(bg(fg('  -rw-r--r--  1 user staff  842 ') + chalk.rgb(green.r, green.g, green.b).bgRgb(bgR, bgG, bgB)('main.ts') + fg(pad.slice(0, 3))));
  console.log();
}

// Apply theme to Terminal.app
function applyToTerminalApp(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const hexToRGB = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) * 257;
    const g = parseInt(hex.slice(3, 5), 16) * 257;
    const b = parseInt(hex.slice(5, 7), 16) * 257;
    return `{${r}, ${g}, ${b}}`;
  };

  const escapedName = themeName.replace(/"/g, '\\"');

  const appleScript = `
    tell application "Terminal"
      if not (exists settings set "${escapedName}") then
        make new settings set with properties {name:"${escapedName}"}
      end if

      set targetSettings to settings set "${escapedName}"
      set background color of targetSettings to ${hexToRGB(colors.background)}
      set normal text color of targetSettings to ${hexToRGB(colors.foreground)}
      set cursor color of targetSettings to ${hexToRGB(colors.cursor)}

      set default settings to targetSettings
      set startup settings to targetSettings

      if (count of windows) > 0 then
        repeat with w in windows
          try
            set current settings of selected tab of w to targetSettings
          end try
        end repeat
      end if
    end tell
  `;

  try {
    execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, { stdio: 'pipe' });
    return { success: true, message: 'Theme applied and set as default!' };
  } catch {
    return { success: false, message: 'Theme saved to profiles. Select in Terminal → Settings → Profiles.' };
  }
}

// Apply theme to iTerm2
function applyToIterm2(colors: ThemeColors, themeName: string, themeId: string): { success: boolean; message: string } {
  const dynamicProfilesDir = path.join(os.homedir(), 'Library/Application Support/iTerm2/DynamicProfiles');

  if (!fs.existsSync(dynamicProfilesDir)) {
    fs.mkdirSync(dynamicProfilesDir, { recursive: true });
  }

  const hexToItermColor = (hex: string) => ({
    'Red Component': parseInt(hex.slice(1, 3), 16) / 255,
    'Green Component': parseInt(hex.slice(3, 5), 16) / 255,
    'Blue Component': parseInt(hex.slice(5, 7), 16) / 255,
    'Alpha Component': 1,
    'Color Space': 'sRGB',
  });

  const profile = {
    Profiles: [{
      Name: themeName,
      Guid: themeId,
      'Background Color': hexToItermColor(colors.background),
      'Foreground Color': hexToItermColor(colors.foreground),
      'Cursor Color': hexToItermColor(colors.cursor),
      'Cursor Text Color': hexToItermColor(colors.cursorText),
      'Selection Color': hexToItermColor(colors.selection),
      'Selected Text Color': hexToItermColor(colors.selectionText),
      'Ansi 0 Color': hexToItermColor(colors.ansi.black),
      'Ansi 1 Color': hexToItermColor(colors.ansi.red),
      'Ansi 2 Color': hexToItermColor(colors.ansi.green),
      'Ansi 3 Color': hexToItermColor(colors.ansi.yellow),
      'Ansi 4 Color': hexToItermColor(colors.ansi.blue),
      'Ansi 5 Color': hexToItermColor(colors.ansi.magenta),
      'Ansi 6 Color': hexToItermColor(colors.ansi.cyan),
      'Ansi 7 Color': hexToItermColor(colors.ansi.white),
      'Ansi 8 Color': hexToItermColor(colors.ansi.brightBlack),
      'Ansi 9 Color': hexToItermColor(colors.ansi.brightRed),
      'Ansi 10 Color': hexToItermColor(colors.ansi.brightGreen),
      'Ansi 11 Color': hexToItermColor(colors.ansi.brightYellow),
      'Ansi 12 Color': hexToItermColor(colors.ansi.brightBlue),
      'Ansi 13 Color': hexToItermColor(colors.ansi.brightMagenta),
      'Ansi 14 Color': hexToItermColor(colors.ansi.brightCyan),
      'Ansi 15 Color': hexToItermColor(colors.ansi.brightWhite),
    }],
  };

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const profilePath = path.join(dynamicProfilesDir, `shellshade-${slugName}.json`);

  try {
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

    // Try to apply via AppleScript
    const appleScript = `
      tell application "iTerm"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              tell s to set profile to "${themeName}"
            end repeat
          end repeat
        end repeat
      end tell
    `;

    try {
      execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, { stdio: 'pipe' });
      return { success: true, message: 'Theme applied to all sessions!' };
    } catch {
      return { success: true, message: 'Profile installed. Select from Profiles menu or restart iTerm2.' };
    }
  } catch {
    return { success: false, message: 'Failed to install profile.' };
  }
}

// Apply theme to Warp
function applyToWarp(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const warpThemesDir = path.join(os.homedir(), '.warp/themes');

  if (!fs.existsSync(warpThemesDir)) {
    fs.mkdirSync(warpThemesDir, { recursive: true });
  }

  const warpTheme = {
    name: themeName,
    accent: colors.ansi.blue,
    background: colors.background,
    foreground: colors.foreground,
    details: 'darker',
    terminal_colors: {
      normal: {
        black: colors.ansi.black,
        red: colors.ansi.red,
        green: colors.ansi.green,
        yellow: colors.ansi.yellow,
        blue: colors.ansi.blue,
        magenta: colors.ansi.magenta,
        cyan: colors.ansi.cyan,
        white: colors.ansi.white,
      },
      bright: {
        black: colors.ansi.brightBlack,
        red: colors.ansi.brightRed,
        green: colors.ansi.brightGreen,
        yellow: colors.ansi.brightYellow,
        blue: colors.ansi.brightBlue,
        magenta: colors.ansi.brightMagenta,
        cyan: colors.ansi.brightCyan,
        white: colors.ansi.brightWhite,
      },
    },
  };

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const themePath = path.join(warpThemesDir, `${slugName}.yaml`);

  try {
    fs.writeFileSync(themePath, yaml.stringify(warpTheme));
    return { success: true, message: `Theme saved to ${themePath}\nSelect in Warp → Settings → Appearance → Themes.` };
  } catch {
    return { success: false, message: 'Failed to write theme file.' };
  }
}

// Apply theme to Alacritty
function applyToAlacritty(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const alacrittyDir = path.join(os.homedir(), '.config/alacritty/themes');

  if (!fs.existsSync(alacrittyDir)) {
    fs.mkdirSync(alacrittyDir, { recursive: true });
  }

  const alacrittyTheme = {
    colors: {
      primary: {
        background: colors.background,
        foreground: colors.foreground,
      },
      cursor: {
        text: colors.cursorText,
        cursor: colors.cursor,
      },
      selection: {
        text: colors.selectionText,
        background: colors.selection,
      },
      normal: {
        black: colors.ansi.black,
        red: colors.ansi.red,
        green: colors.ansi.green,
        yellow: colors.ansi.yellow,
        blue: colors.ansi.blue,
        magenta: colors.ansi.magenta,
        cyan: colors.ansi.cyan,
        white: colors.ansi.white,
      },
      bright: {
        black: colors.ansi.brightBlack,
        red: colors.ansi.brightRed,
        green: colors.ansi.brightGreen,
        yellow: colors.ansi.brightYellow,
        blue: colors.ansi.brightBlue,
        magenta: colors.ansi.brightMagenta,
        cyan: colors.ansi.brightCyan,
        white: colors.ansi.brightWhite,
      },
    },
  };

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const themePath = path.join(alacrittyDir, `${slugName}.toml`);

  // Write as TOML format
  const tomlContent = `# ${themeName} - Generated by ShellShade
[colors.primary]
background = "${colors.background}"
foreground = "${colors.foreground}"

[colors.cursor]
text = "${colors.cursorText}"
cursor = "${colors.cursor}"

[colors.selection]
text = "${colors.selectionText}"
background = "${colors.selection}"

[colors.normal]
black = "${colors.ansi.black}"
red = "${colors.ansi.red}"
green = "${colors.ansi.green}"
yellow = "${colors.ansi.yellow}"
blue = "${colors.ansi.blue}"
magenta = "${colors.ansi.magenta}"
cyan = "${colors.ansi.cyan}"
white = "${colors.ansi.white}"

[colors.bright]
black = "${colors.ansi.brightBlack}"
red = "${colors.ansi.brightRed}"
green = "${colors.ansi.brightGreen}"
yellow = "${colors.ansi.brightYellow}"
blue = "${colors.ansi.brightBlue}"
magenta = "${colors.ansi.brightMagenta}"
cyan = "${colors.ansi.brightCyan}"
white = "${colors.ansi.brightWhite}"
`;

  try {
    fs.writeFileSync(themePath, tomlContent);
    return { success: true, message: `Theme saved to ${themePath}\nImport in alacritty.toml with: import = ["${themePath}"]` };
  } catch {
    return { success: false, message: 'Failed to write theme file.' };
  }
}

// Apply theme to Kitty
function applyToKitty(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const kittyDir = path.join(os.homedir(), '.config/kitty/themes');

  if (!fs.existsSync(kittyDir)) {
    fs.mkdirSync(kittyDir, { recursive: true });
  }

  const kittyTheme = `# ${themeName} - Generated by ShellShade

foreground ${colors.foreground}
background ${colors.background}
cursor ${colors.cursor}
cursor_text_color ${colors.cursorText}
selection_foreground ${colors.selectionText}
selection_background ${colors.selection}

# Normal colors
color0 ${colors.ansi.black}
color1 ${colors.ansi.red}
color2 ${colors.ansi.green}
color3 ${colors.ansi.yellow}
color4 ${colors.ansi.blue}
color5 ${colors.ansi.magenta}
color6 ${colors.ansi.cyan}
color7 ${colors.ansi.white}

# Bright colors
color8 ${colors.ansi.brightBlack}
color9 ${colors.ansi.brightRed}
color10 ${colors.ansi.brightGreen}
color11 ${colors.ansi.brightYellow}
color12 ${colors.ansi.brightBlue}
color13 ${colors.ansi.brightMagenta}
color14 ${colors.ansi.brightCyan}
color15 ${colors.ansi.brightWhite}
`;

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const themePath = path.join(kittyDir, `${slugName}.conf`);

  try {
    fs.writeFileSync(themePath, kittyTheme);
    return { success: true, message: `Theme saved to ${themePath}\nApply with: kitty +kitten themes --reload-in=all ${themeName}` };
  } catch {
    return { success: false, message: 'Failed to write theme file.' };
  }
}

// Apply theme to Windows Terminal
function applyToWindowsTerminal(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  // Windows Terminal settings location
  const wtPaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Windows Terminal/settings.json'),
  ];

  let settingsPath = wtPaths.find(p => fs.existsSync(p));

  // If no settings file exists, create the directory for the preview version
  if (!settingsPath) {
    const previewDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Windows Terminal');
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }
    settingsPath = path.join(previewDir, 'settings.json');
  }

  const colorScheme = {
    name: themeName,
    background: colors.background,
    foreground: colors.foreground,
    cursorColor: colors.cursor,
    selectionBackground: colors.selection,
    black: colors.ansi.black,
    red: colors.ansi.red,
    green: colors.ansi.green,
    yellow: colors.ansi.yellow,
    blue: colors.ansi.blue,
    purple: colors.ansi.magenta,
    cyan: colors.ansi.cyan,
    white: colors.ansi.white,
    brightBlack: colors.ansi.brightBlack,
    brightRed: colors.ansi.brightRed,
    brightGreen: colors.ansi.brightGreen,
    brightYellow: colors.ansi.brightYellow,
    brightBlue: colors.ansi.brightBlue,
    brightPurple: colors.ansi.brightMagenta,
    brightCyan: colors.ansi.brightCyan,
    brightWhite: colors.ansi.brightWhite,
  };

  try {
    let settings: any = { schemes: [], profiles: { defaults: {} } };

    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');

      // Try parsing as regular JSON first (most common case)
      try {
        settings = JSON.parse(content);
      } catch {
        // If that fails, try JSONC parsing (handles comments and trailing commas)
        try {
          const jsonContent = stripJsonComments(content);
          settings = JSON.parse(jsonContent);
        } catch (parseErr) {
          // If parsing still fails, don't overwrite - abort
          return { success: false, message: `Failed to parse Windows Terminal settings. Please check settings.json for syntax errors.` };
        }
      }
    }

    if (!settings.schemes) settings.schemes = [];

    // Remove existing scheme with same name
    settings.schemes = settings.schemes.filter((s: any) => s.name !== themeName);
    settings.schemes.push(colorScheme);

    // Set as default color scheme
    if (!settings.profiles) settings.profiles = {};
    if (!settings.profiles.defaults) settings.profiles.defaults = {};
    settings.profiles.defaults.colorScheme = themeName;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
    return { success: true, message: `Theme added to Windows Terminal and set as default!\nRestart Windows Terminal to see changes.` };
  } catch (err) {
    return { success: false, message: `Failed to update Windows Terminal settings: ${err}` };
  }
}

// Apply theme to PowerShell
function applyToPowerShell(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  // Create PowerShell profile script
  const psProfileDir = path.join(process.env.USERPROFILE || os.homedir(), 'Documents/PowerShell');
  const psProfilePath = path.join(psProfileDir, 'Microsoft.PowerShell_profile.ps1');

  if (!fs.existsSync(psProfileDir)) {
    fs.mkdirSync(psProfileDir, { recursive: true });
  }

  const psColorScript = `
# ShellShade Theme: ${themeName}
# Generated by ShellShade - Terminal Theme Manager

$Host.UI.RawUI.BackgroundColor = [System.ConsoleColor]::Black
$Host.UI.RawUI.ForegroundColor = [System.ConsoleColor]::White

# PSReadLine colors (if available)
if (Get-Module -ListAvailable -Name PSReadLine) {
    Set-PSReadLineOption -Colors @{
        Command            = '${colors.ansi.yellow}'
        Parameter          = '${colors.ansi.cyan}'
        String             = '${colors.ansi.green}'
        Comment            = '${colors.ansi.brightBlack}'
        Keyword            = '${colors.ansi.magenta}'
        Variable           = '${colors.ansi.blue}'
        Operator           = '${colors.foreground}'
        Number             = '${colors.ansi.red}'
        Type               = '${colors.ansi.cyan}'
        Member             = '${colors.ansi.yellow}'
        Error              = '${colors.ansi.brightRed}'
        Selection          = '${colors.selection}'
    }
}

# Set console colors via registry (requires restart)
$regPath = "HKCU:\\Console"
if (Test-Path $regPath) {
    # Note: Console colors require hex values in specific format
    Write-Host "Theme '${themeName}' applied to PSReadLine." -ForegroundColor Green
    Write-Host "For full color support, use Windows Terminal." -ForegroundColor Yellow
}
`;

  try {
    // Read existing profile and check if we should append or create
    let existingProfile = '';
    if (fs.existsSync(psProfilePath)) {
      existingProfile = fs.readFileSync(psProfilePath, 'utf-8');
    }

    // Remove any existing ShellShade theme block
    const shellshadeBlockRegex = /\n?# ShellShade Theme:[\s\S]*?(?=\n# (?!ShellShade)|$)/g;
    existingProfile = existingProfile.replace(shellshadeBlockRegex, '');

    // Append new theme
    const newProfile = existingProfile.trim() + '\n' + psColorScript;
    fs.writeFileSync(psProfilePath, newProfile);

    return {
      success: true,
      message: `Theme applied to PowerShell profile!\nRestart PowerShell to see changes.\nFor full 24-bit color, use Windows Terminal.`
    };
  } catch (err) {
    return { success: false, message: `Failed to update PowerShell profile: ${err}` };
  }
}

// Apply theme to GNOME Terminal
function applyToGnomeTerminal(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const profileId = `shellshade-${slugName}`;

  // Build dconf color palette
  const palette = [
    colors.ansi.black, colors.ansi.red, colors.ansi.green, colors.ansi.yellow,
    colors.ansi.blue, colors.ansi.magenta, colors.ansi.cyan, colors.ansi.white,
    colors.ansi.brightBlack, colors.ansi.brightRed, colors.ansi.brightGreen, colors.ansi.brightYellow,
    colors.ansi.brightBlue, colors.ansi.brightMagenta, colors.ansi.brightCyan, colors.ansi.brightWhite,
  ].map(c => `'${c}'`).join(', ');

  // Create shell script to apply via dconf/gsettings
  const script = `#!/bin/bash
# ShellShade Theme: ${themeName}

PROFILE_ID="${profileId}"
PROFILE_PATH="/org/gnome/terminal/legacy/profiles:/:$PROFILE_ID/"

# Create new profile
dconf write /org/gnome/terminal/legacy/profiles:/list "[\$(dconf read /org/gnome/terminal/legacy/profiles:/list | tr -d "[]'" | sed "s/,/', '/g"), '$PROFILE_ID']" 2>/dev/null || true

# Set profile properties
dconf write "$PROFILE_PATH/visible-name" "'${themeName}'"
dconf write "$PROFILE_PATH/use-theme-colors" "false"
dconf write "$PROFILE_PATH/background-color" "'${colors.background}'"
dconf write "$PROFILE_PATH/foreground-color" "'${colors.foreground}'"
dconf write "$PROFILE_PATH/cursor-background-color" "'${colors.cursor}'"
dconf write "$PROFILE_PATH/cursor-foreground-color" "'${colors.cursorText}'"
dconf write "$PROFILE_PATH/highlight-background-color" "'${colors.selection}'"
dconf write "$PROFILE_PATH/highlight-foreground-color" "'${colors.selectionText}'"
dconf write "$PROFILE_PATH/palette" "[${palette}]"
dconf write "$PROFILE_PATH/use-theme-transparency" "false"

# Set as default
dconf write /org/gnome/terminal/legacy/profiles:/default "'$PROFILE_ID'"

echo "Theme '${themeName}' applied to GNOME Terminal!"
`;

  const scriptPath = path.join(os.tmpdir(), `shellshade-gnome-${Date.now()}.sh`);

  try {
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    execSync(`bash "${scriptPath}"`, { stdio: 'pipe' });
    fs.unlinkSync(scriptPath);
    return { success: true, message: `Theme applied to GNOME Terminal!` };
  } catch (err) {
    // Fallback: save as script file for manual execution
    const fallbackPath = path.join(os.homedir(), '.config/shellshade', `gnome-${slugName}.sh`);
    const fallbackDir = path.dirname(fallbackPath);
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    fs.writeFileSync(fallbackPath, script, { mode: 0o755 });
    return {
      success: true,
      message: `Script saved to ${fallbackPath}\nRun it manually: bash "${fallbackPath}"`
    };
  }
}

// Apply theme to Konsole
function applyToKonsole(colors: ThemeColors, themeName: string): { success: boolean; message: string } {
  const konsoleDir = path.join(os.homedir(), '.local/share/konsole');

  if (!fs.existsSync(konsoleDir)) {
    fs.mkdirSync(konsoleDir, { recursive: true });
  }

  // Konsole uses .colorscheme files
  const konsoleTheme = `[Background]
Color=${hexToKonsoleRgb(colors.background)}

[BackgroundFaint]
Color=${hexToKonsoleRgb(colors.background)}

[BackgroundIntense]
Color=${hexToKonsoleRgb(colors.background)}

[Color0]
Color=${hexToKonsoleRgb(colors.ansi.black)}

[Color0Faint]
Color=${hexToKonsoleRgb(colors.ansi.black)}

[Color0Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightBlack)}

[Color1]
Color=${hexToKonsoleRgb(colors.ansi.red)}

[Color1Faint]
Color=${hexToKonsoleRgb(colors.ansi.red)}

[Color1Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightRed)}

[Color2]
Color=${hexToKonsoleRgb(colors.ansi.green)}

[Color2Faint]
Color=${hexToKonsoleRgb(colors.ansi.green)}

[Color2Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightGreen)}

[Color3]
Color=${hexToKonsoleRgb(colors.ansi.yellow)}

[Color3Faint]
Color=${hexToKonsoleRgb(colors.ansi.yellow)}

[Color3Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightYellow)}

[Color4]
Color=${hexToKonsoleRgb(colors.ansi.blue)}

[Color4Faint]
Color=${hexToKonsoleRgb(colors.ansi.blue)}

[Color4Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightBlue)}

[Color5]
Color=${hexToKonsoleRgb(colors.ansi.magenta)}

[Color5Faint]
Color=${hexToKonsoleRgb(colors.ansi.magenta)}

[Color5Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightMagenta)}

[Color6]
Color=${hexToKonsoleRgb(colors.ansi.cyan)}

[Color6Faint]
Color=${hexToKonsoleRgb(colors.ansi.cyan)}

[Color6Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightCyan)}

[Color7]
Color=${hexToKonsoleRgb(colors.ansi.white)}

[Color7Faint]
Color=${hexToKonsoleRgb(colors.ansi.white)}

[Color7Intense]
Color=${hexToKonsoleRgb(colors.ansi.brightWhite)}

[Foreground]
Color=${hexToKonsoleRgb(colors.foreground)}

[ForegroundFaint]
Color=${hexToKonsoleRgb(colors.foreground)}

[ForegroundIntense]
Color=${hexToKonsoleRgb(colors.foreground)}

[General]
Anchor=0.5,0.5
Blur=false
ColorRandomization=false
Description=${themeName}
FillStyle=Tile
Opacity=1
Wallpaper=
WallpaperFlipType=NoFlip
WallpaperOpacity=1
`;

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const themePath = path.join(konsoleDir, `${slugName}.colorscheme`);

  try {
    fs.writeFileSync(themePath, konsoleTheme);
    return {
      success: true,
      message: `Theme saved to ${themePath}\nSelect in Konsole → Settings → Edit Current Profile → Appearance`
    };
  } catch {
    return { success: false, message: 'Failed to write colorscheme file.' };
  }
}

// Helper: Convert hex to Konsole RGB format (r,g,b)
function hexToKonsoleRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// Unified apply function
function applyTheme(db: Database.Database, themeId: string, themeName: string, terminal: Terminal): { success: boolean; message: string } {
  const colors = getFullThemeColors(db, themeId);
  if (!colors) {
    return { success: false, message: 'Theme not found' };
  }

  switch (terminal) {
    // macOS
    case 'terminal':
      return applyToTerminalApp(colors, themeName);
    case 'iterm2':
      return applyToIterm2(colors, themeName, themeId);
    case 'warp':
      return applyToWarp(colors, themeName);
    // Windows
    case 'windows-terminal':
      return applyToWindowsTerminal(colors, themeName);
    case 'powershell':
      return applyToPowerShell(colors, themeName);
    // Linux
    case 'gnome-terminal':
      return applyToGnomeTerminal(colors, themeName);
    case 'konsole':
      return applyToKonsole(colors, themeName);
    // Cross-platform
    case 'alacritty':
      return applyToAlacritty(colors, themeName);
    case 'kitty':
      return applyToKitty(colors, themeName);
    default:
      return { success: false, message: 'Unsupported terminal' };
  }
}

// Current terminal state
let currentTerminal: Terminal = detectTerminal();

// Main menu
async function mainMenu(db: Database.Database): Promise<void> {
  const themes = getThemes(db);
  const favorites = themes.filter(t => t.isFavorite);

  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ ShellShade') + chalk.dim(' - Terminal Theme Manager\n'));
  console.log(chalk.dim(`  Platform: ${platformNames[currentPlatform]} | Terminal: ${terminalNames[currentTerminal]}\n`));

  const choices = [
    { name: 'browse', message: `Browse Themes (${themes.length} available)` },
    { name: 'apply', message: 'Quick Apply Theme' },
    { name: 'search', message: 'Search Themes' },
  ];

  if (favorites.length > 0) {
    choices.splice(1, 0, { name: 'favorites', message: `Favorites (${favorites.length})` });
  }

  choices.push(
    { name: 'terminal', message: `Change Terminal (${terminalNames[currentTerminal]})` },
    { name: 'exit', message: 'Exit' }
  );

  const { action } = await Enquirer.prompt<{ action: string }>({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices,
  });

  switch (action) {
    case 'browse':
      await browseThemes(db, themes);
      break;
    case 'favorites':
      await browseFavorites(db, favorites);
      break;
    case 'apply':
      await quickApply(db, themes);
      break;
    case 'search':
      await searchThemes(db, themes);
      break;
    case 'terminal':
      await selectTerminal();
      break;
    case 'exit':
      console.log(chalk.dim('\nGoodbye!\n'));
      process.exit(0);
  }

  await mainMenu(db);
}

// Platform names
const platformNames: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

// Select terminal
async function selectTerminal(): Promise<void> {
  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ Select Terminal') + chalk.dim(` (${platformNames[currentPlatform]})\n`));

  const availableTerminals = platformTerminals[currentPlatform];
  const choices = availableTerminals.map(t => ({
    name: t,
    message: terminalNames[t],
    hint: currentTerminal === t ? chalk.green('(current)') : '',
  }));

  choices.push({ name: 'back' as any, message: chalk.dim('← Back'), hint: '' });

  const { terminal } = await Enquirer.prompt<{ terminal: Terminal | 'back' }>({
    type: 'select',
    name: 'terminal',
    message: 'Which terminal are you using?',
    choices,
  } as any);

  if (terminal === 'back') return;

  currentTerminal = terminal;
  console.log(chalk.green(`\n✓ Terminal set to ${terminalNames[terminal]}\n`));
  await new Promise(resolve => setTimeout(resolve, 800));
}

// Browse favorites
async function browseFavorites(db: Database.Database, favorites: ThemeSummary[]): Promise<void> {
  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ Favorites') + chalk.yellow(' ★\n'));

  const choices = favorites.map(t => ({
    name: t.id,
    message: `${t.name}${t.author ? chalk.dim(` - ${t.author}`) : ''}`,
    hint: t.ansiColors.slice(0, 4).map(c => colorBlock(c)).join(''),
  }));

  choices.push({ name: 'back', message: chalk.dim('← Back to menu'), hint: '' });

  const { themeId } = await Enquirer.prompt<{ themeId: string }>({
    type: 'select',
    name: 'themeId',
    message: 'Select a theme:',
    choices,
  } as any);

  if (themeId === 'back') return;

  const theme = favorites.find(t => t.id === themeId);
  if (!theme) return;

  await showThemeActions(db, theme, favorites);
}

// Show theme actions
async function showThemeActions(db: Database.Database, theme: ThemeSummary, allThemes: ThemeSummary[]): Promise<void> {
  console.clear();
  renderThemePreview(theme);

  const favLabel = theme.isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
  const favIcon = theme.isFavorite ? '★' : '☆';

  const { action } = await Enquirer.prompt<{ action: string }>({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: 'apply', message: `Apply to ${terminalNames[currentTerminal]}` },
      { name: 'favorite', message: `${favIcon} ${favLabel}` },
      { name: 'back', message: '← Back' },
    ],
  });

  if (action === 'apply') {
    console.log(chalk.dim(`\nApplying to ${terminalNames[currentTerminal]}...`));
    const result = applyTheme(db, theme.id, theme.name, currentTerminal);
    if (result.success) {
      console.log(chalk.green(`\n✓ ${result.message}\n`));
    } else {
      console.log(chalk.yellow(`\n! ${result.message}\n`));
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  } else if (action === 'favorite') {
    const isFav = toggleFavorite(db, theme.id);
    theme.isFavorite = isFav;
    if (isFav) {
      console.log(chalk.yellow(`\n★ Added "${theme.name}" to favorites!\n`));
    } else {
      console.log(chalk.dim(`\n☆ Removed "${theme.name}" from favorites.\n`));
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    await showThemeActions(db, theme, allThemes);
  }
}

// Browse themes
async function browseThemes(db: Database.Database, themes: ThemeSummary[]): Promise<void> {
  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ Browse Themes\n'));

  const choices = themes.map(t => {
    const fav = t.isFavorite ? chalk.yellow('★ ') : '  ';
    return {
      name: t.id,
      message: `${fav}${t.name}${t.author ? chalk.dim(` - ${t.author}`) : ''}`,
      hint: t.ansiColors.slice(0, 4).map(c => colorBlock(c)).join(''),
    };
  });

  choices.push({ name: 'back', message: chalk.dim('← Back to menu'), hint: '' });

  const { themeId } = await Enquirer.prompt<{ themeId: string }>({
    type: 'select',
    name: 'themeId',
    message: 'Select a theme to preview:',
    choices,
  } as any);

  if (themeId === 'back') return;

  const theme = themes.find(t => t.id === themeId);
  if (!theme) return;

  await showThemeActions(db, theme, themes);
  await browseThemes(db, getThemes(db));
}

// Quick apply
async function quickApply(db: Database.Database, themes: ThemeSummary[]): Promise<void> {
  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ Quick Apply') + chalk.dim(` → ${terminalNames[currentTerminal]}\n`));

  const choices = themes.map(t => {
    const fav = t.isFavorite ? chalk.yellow('★ ') : '  ';
    return {
      name: t.id,
      message: `${fav}${t.name}`,
      hint: t.ansiColors.slice(0, 4).map(c => colorBlock(c)).join(''),
    };
  });

  choices.push({ name: 'back', message: chalk.dim('← Back to menu'), hint: '' });

  const { themeId } = await Enquirer.prompt<{ themeId: string }>({
    type: 'select',
    name: 'themeId',
    message: 'Select a theme to apply:',
    choices,
  } as any);

  if (themeId === 'back') return;

  const theme = themes.find(t => t.id === themeId);
  if (!theme) return;

  console.log(chalk.dim(`\nApplying to ${terminalNames[currentTerminal]}...`));
  const result = applyTheme(db, theme.id, theme.name, currentTerminal);
  if (result.success) {
    console.log(chalk.green(`\n✓ ${result.message}\n`));
  } else {
    console.log(chalk.yellow(`\n! ${result.message}\n`));
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}

// Search themes
async function searchThemes(db: Database.Database, themes: ThemeSummary[]): Promise<void> {
  console.clear();
  console.log(chalk.hex('#8B5CF6').bold('\n  ▶ Search Themes\n'));

  const { query } = await Enquirer.prompt<{ query: string }>({
    type: 'input',
    name: 'query',
    message: 'Search:',
  });

  if (!query.trim()) return;

  const filtered = themes.filter(t =>
    t.name.toLowerCase().includes(query.toLowerCase()) ||
    (t.author && t.author.toLowerCase().includes(query.toLowerCase()))
  );

  if (filtered.length === 0) {
    console.log(chalk.yellow(`\nNo themes found matching "${query}"\n`));
    await new Promise(resolve => setTimeout(resolve, 1500));
    return;
  }

  console.log(chalk.dim(`\nFound ${filtered.length} theme(s):\n`));

  const choices = filtered.map(t => ({
    name: t.id,
    message: `${t.name}${t.author ? chalk.dim(` - ${t.author}`) : ''}`,
  }));

  choices.push({ name: 'back', message: chalk.dim('← Back to menu') });

  const { themeId } = await Enquirer.prompt<{ themeId: string }>({
    type: 'select',
    name: 'themeId',
    message: 'Select a theme:',
    choices,
  });

  if (themeId === 'back') return;

  const theme = filtered.find(t => t.id === themeId);
  if (!theme) return;

  renderThemePreview(theme);

  const { action } = await Enquirer.prompt<{ action: string }>({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: 'apply', message: 'Apply this theme' },
      { name: 'back', message: '← Back' },
    ],
  });

  if (action === 'apply') {
    console.log(chalk.dim(`\nApplying to ${terminalNames[currentTerminal]}...`));
    const result = applyTheme(db, theme.id, theme.name, currentTerminal);
    if (result.success) {
      console.log(chalk.green(`\n✓ ${result.message}\n`));
    } else {
      console.log(chalk.yellow(`\n! ${result.message}\n`));
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

// CLI entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle init command (no database required)
  if (args[0] === 'init') {
    console.log(chalk.hex('#8B5CF6').bold('\n  ▶ ShellShade Init\n'));
    console.log(chalk.dim('  Initializing database and loading themes...\n'));

    const result = initializeDatabase();

    if (result.success) {
      console.log(chalk.green(`  ✓ ${result.message}`));
      console.log(chalk.dim(`  Database: ${dbPath}\n`));
    } else {
      console.log(chalk.red(`  ✗ ${result.message}\n`));
      process.exit(1);
    }
    return;
  }

  // Handle direct commands
  if (args[0] === 'list' || args[0] === 'ls') {
    const db = getDatabase();
    if (!db) process.exit(1);
    const themes = getThemes(db);
    console.log(chalk.hex('#8B5CF6').bold('\nShellShade Themes:\n'));
    themes.forEach(t => {
      const colors = t.ansiColors.slice(0, 8).map(c => colorBlock(c)).join('');
      console.log(`  ${colors}  ${t.name}`);
    });
    console.log();
    db.close();
    return;
  }

  if (args[0] === 'apply' && args[1]) {
    const db = getDatabase();
    if (!db) process.exit(1);
    const themes = getThemes(db);

    // Parse optional --terminal flag
    let targetTerminal = currentTerminal;
    const terminalFlagIndex = args.findIndex(a => a === '--terminal' || a === '-t');
    if (terminalFlagIndex !== -1 && args[terminalFlagIndex + 1]) {
      const termArg = args[terminalFlagIndex + 1].toLowerCase();
      const matchedTerminal = (Object.keys(terminalNames) as Terminal[]).find(t =>
        t === termArg || terminalNames[t].toLowerCase().includes(termArg)
      );
      if (matchedTerminal) {
        targetTerminal = matchedTerminal;
      }
    }

    // Find theme (exclude --terminal flag from search)
    const themeName = args.slice(1).filter((_, i) =>
      i !== terminalFlagIndex - 1 && i !== terminalFlagIndex
    ).join(' ') || args[1];

    const theme = themes.find(t =>
      t.name.toLowerCase() === themeName.toLowerCase() ||
      t.name.toLowerCase().includes(themeName.toLowerCase())
    );
    if (!theme) {
      console.log(chalk.red(`\nTheme "${themeName}" not found\n`));
      db.close();
      process.exit(1);
    }
    console.log(chalk.dim(`\nApplying "${theme.name}" to ${terminalNames[targetTerminal]}...`));
    const result = applyTheme(db, theme.id, theme.name, targetTerminal);
    if (result.success) {
      console.log(chalk.green(`✓ ${result.message}\n`));
    } else {
      console.log(chalk.yellow(`! ${result.message}\n`));
    }
    db.close();
    return;
  }

  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(chalk.hex('#8B5CF6').bold('\n  ▶ ShellShade CLI') + chalk.dim(` (${platformNames[currentPlatform]})\n`));
    console.log('  Usage:');
    console.log('    shellshade                              Interactive TUI');
    console.log('    shellshade init                         Initialize database and load themes');
    console.log('    shellshade list                         List all themes');
    console.log('    shellshade apply <name>                 Apply theme (auto-detect terminal)');
    console.log('    shellshade apply <name> -t <terminal>   Apply theme to specific terminal');
    console.log('    shellshade help                         Show this help\n');

    console.log('  Supported terminals:');
    platformTerminals[currentPlatform].forEach(t => {
      const current = t === currentTerminal ? chalk.green(' (detected)') : '';
      console.log(`    ${terminalNames[t]}${current}`);
    });
    console.log();
    return;
  }

  // Interactive mode
  const db = getDatabase();
  if (!db) process.exit(1);

  try {
    await mainMenu(db);
  } catch (err) {
    // User cancelled (Ctrl+C)
    console.log(chalk.dim('\n\nGoodbye!\n'));
  } finally {
    db.close();
  }
}

main().catch(console.error);
