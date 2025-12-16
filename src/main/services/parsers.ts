import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { ThemeColors } from '../../shared/types/theme';

export interface ParsedTheme {
  name: string;
  colors: ThemeColors;
}

// Parse iTerm2 .itermcolors (plist XML format)
export function parseItermColors(filePath: string): ParsedTheme {
  const name = path.basename(filePath, '.itermcolors');

  // Convert plist to JSON using plutil (macOS built-in)
  const tempJsonPath = `/tmp/iterm-theme-${Date.now()}.json`;
  try {
    // First check if file exists and is readable
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Try plutil conversion
    try {
      execSync(`plutil -convert json -o "${tempJsonPath}" "${filePath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (plutilErr: unknown) {
      const errMsg = plutilErr instanceof Error ? plutilErr.message : String(plutilErr);
      throw new Error(`Failed to parse plist file. The file may be corrupted or in an unsupported format. Error: ${errMsg}`);
    }

    const jsonContent = fs.readFileSync(tempJsonPath, 'utf-8');
    const plist = JSON.parse(jsonContent);
    fs.unlinkSync(tempJsonPath);

    const getColor = (key: string): string => {
      const colorDict = plist[key];
      if (!colorDict) return '#000000';

      const r = Math.round((colorDict['Red Component'] || 0) * 255);
      const g = Math.round((colorDict['Green Component'] || 0) * 255);
      const b = Math.round((colorDict['Blue Component'] || 0) * 255);

      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    };

    const colors: ThemeColors = {
      background: getColor('Background Color'),
      foreground: getColor('Foreground Color'),
      cursor: getColor('Cursor Color'),
      cursorText: getColor('Cursor Text Color') || getColor('Background Color'),
      selection: getColor('Selection Color'),
      selectionText: getColor('Selected Text Color') || getColor('Foreground Color'),
      ansi: {
        black: getColor('Ansi 0 Color'),
        red: getColor('Ansi 1 Color'),
        green: getColor('Ansi 2 Color'),
        yellow: getColor('Ansi 3 Color'),
        blue: getColor('Ansi 4 Color'),
        magenta: getColor('Ansi 5 Color'),
        cyan: getColor('Ansi 6 Color'),
        white: getColor('Ansi 7 Color'),
        brightBlack: getColor('Ansi 8 Color'),
        brightRed: getColor('Ansi 9 Color'),
        brightGreen: getColor('Ansi 10 Color'),
        brightYellow: getColor('Ansi 11 Color'),
        brightBlue: getColor('Ansi 12 Color'),
        brightMagenta: getColor('Ansi 13 Color'),
        brightCyan: getColor('Ansi 14 Color'),
        brightWhite: getColor('Ansi 15 Color'),
      },
    };

    return { name, colors };
  } catch (err) {
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
    throw new Error(`Failed to parse iTerm colors file: ${err}`);
  }
}

// Parse Terminal.app .terminal (plist XML format)
export function parseTerminalApp(_filePath: string): ParsedTheme {
  // Terminal.app stores colors as NSKeyedArchiver data, which requires native parsing
  // This format is not currently supported for import
  throw new Error(
    'Terminal.app (.terminal) format uses NSKeyedArchiver which requires native parsing. ' +
    'Please export your theme from iTerm2 as .itermcolors instead, or use a different format.'
  );
}

// Parse Alacritty YAML format
export function parseAlacritty(filePath: string): ParsedTheme {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = path.basename(filePath, path.extname(filePath));

  // Simple YAML parser for Alacritty theme format
  const lines = content.split('\n');
  const colors: Record<string, string> = {};

  let currentSection = '';
  let inColors = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for colors section
    if (trimmed === 'colors:') {
      inColors = true;
      continue;
    }

    if (!inColors) continue;

    // Check for subsections
    if (trimmed.endsWith(':') && !trimmed.includes("'") && !trimmed.includes('"')) {
      currentSection = trimmed.replace(':', '').trim();
      continue;
    }

    // Parse color values
    const match = trimmed.match(/^(\w+):\s*['"]?(#?[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6})['"]?/);
    if (match) {
      const key = match[1];
      let value = match[2];

      // Convert 0x format to #
      if (value.startsWith('0x')) {
        value = '#' + value.slice(2);
      }
      if (!value.startsWith('#')) {
        value = '#' + value;
      }

      const fullKey = currentSection ? `${currentSection}.${key}` : key;
      colors[fullKey] = value.toLowerCase();
    }
  }

  // Map Alacritty colors to our format
  const getColor = (key: string, fallback: string): string => colors[key] || fallback;

  const themeColors: ThemeColors = {
    background: getColor('primary.background', '#1d1f21'),
    foreground: getColor('primary.foreground', '#c5c8c6'),
    cursor: getColor('cursor.cursor', getColor('primary.foreground', '#c5c8c6')),
    cursorText: getColor('cursor.text', getColor('primary.background', '#1d1f21')),
    selection: getColor('selection.background', '#373b41'),
    selectionText: getColor('selection.foreground', getColor('primary.foreground', '#c5c8c6')),
    ansi: {
      black: getColor('normal.black', '#1d1f21'),
      red: getColor('normal.red', '#cc6666'),
      green: getColor('normal.green', '#b5bd68'),
      yellow: getColor('normal.yellow', '#f0c674'),
      blue: getColor('normal.blue', '#81a2be'),
      magenta: getColor('normal.magenta', '#b294bb'),
      cyan: getColor('normal.cyan', '#8abeb7'),
      white: getColor('normal.white', '#c5c8c6'),
      brightBlack: getColor('bright.black', '#969896'),
      brightRed: getColor('bright.red', '#de935f'),
      brightGreen: getColor('bright.green', '#b5bd68'),
      brightYellow: getColor('bright.yellow', '#f0c674'),
      brightBlue: getColor('bright.blue', '#81a2be'),
      brightMagenta: getColor('bright.magenta', '#b294bb'),
      brightCyan: getColor('bright.cyan', '#8abeb7'),
      brightWhite: getColor('bright.white', '#ffffff'),
    },
  };

  return { name, colors: themeColors };
}

// Parse JSON theme format (generic or iTerm2 Dynamic Profiles)
export function parseJson(filePath: string): ParsedTheme {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = path.basename(filePath, '.json');
  const data = JSON.parse(content);

  // Check if it's our native format
  if (data.colors && data.colors.ansi) {
    return {
      name: data.name || name,
      colors: data.colors,
    };
  }

  // Check if it's iTerm2 Dynamic Profiles format
  if (data.Profiles && Array.isArray(data.Profiles) && data.Profiles.length > 0) {
    const profile = data.Profiles[0];

    const getColor = (key: string): string => {
      const colorDict = profile[key];
      if (!colorDict) return '#000000';

      const r = Math.round((colorDict['Red Component'] || 0) * 255);
      const g = Math.round((colorDict['Green Component'] || 0) * 255);
      const b = Math.round((colorDict['Blue Component'] || 0) * 255);

      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    };

    const colors: ThemeColors = {
      background: getColor('Background Color'),
      foreground: getColor('Foreground Color'),
      cursor: getColor('Cursor Color'),
      cursorText: getColor('Cursor Text Color') || getColor('Background Color'),
      selection: getColor('Selection Color'),
      selectionText: getColor('Selected Text Color') || getColor('Foreground Color'),
      ansi: {
        black: getColor('Ansi 0 Color'),
        red: getColor('Ansi 1 Color'),
        green: getColor('Ansi 2 Color'),
        yellow: getColor('Ansi 3 Color'),
        blue: getColor('Ansi 4 Color'),
        magenta: getColor('Ansi 5 Color'),
        cyan: getColor('Ansi 6 Color'),
        white: getColor('Ansi 7 Color'),
        brightBlack: getColor('Ansi 8 Color'),
        brightRed: getColor('Ansi 9 Color'),
        brightGreen: getColor('Ansi 10 Color'),
        brightYellow: getColor('Ansi 11 Color'),
        brightBlue: getColor('Ansi 12 Color'),
        brightMagenta: getColor('Ansi 13 Color'),
        brightCyan: getColor('Ansi 14 Color'),
        brightWhite: getColor('Ansi 15 Color'),
      },
    };

    return { name: profile.Name || name, colors };
  }

  throw new Error('Unrecognized JSON theme format');
}

// Parse Kitty config format
export function parseKitty(filePath: string): ParsedTheme {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = path.basename(filePath, path.extname(filePath));

  const colors: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(\w+)\s+(#[0-9a-fA-F]{6})/);
    if (match) {
      colors[match[1]] = match[2].toLowerCase();
    }
  }

  const getColor = (key: string, fallback: string): string => colors[key] || fallback;

  const themeColors: ThemeColors = {
    background: getColor('background', '#1d1f21'),
    foreground: getColor('foreground', '#c5c8c6'),
    cursor: getColor('cursor', getColor('foreground', '#c5c8c6')),
    cursorText: getColor('cursor_text_color', getColor('background', '#1d1f21')),
    selection: getColor('selection_background', '#373b41'),
    selectionText: getColor('selection_foreground', getColor('foreground', '#c5c8c6')),
    ansi: {
      black: getColor('color0', '#1d1f21'),
      red: getColor('color1', '#cc6666'),
      green: getColor('color2', '#b5bd68'),
      yellow: getColor('color3', '#f0c674'),
      blue: getColor('color4', '#81a2be'),
      magenta: getColor('color5', '#b294bb'),
      cyan: getColor('color6', '#8abeb7'),
      white: getColor('color7', '#c5c8c6'),
      brightBlack: getColor('color8', '#969896'),
      brightRed: getColor('color9', '#de935f'),
      brightGreen: getColor('color10', '#b5bd68'),
      brightYellow: getColor('color11', '#f0c674'),
      brightBlue: getColor('color12', '#81a2be'),
      brightMagenta: getColor('color13', '#b294bb'),
      brightCyan: getColor('color14', '#8abeb7'),
      brightWhite: getColor('color15', '#ffffff'),
    },
  };

  return { name, colors: themeColors };
}

// Main parser function that auto-detects format
export function parseThemeFile(filePath: string): ParsedTheme {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.itermcolors':
      return parseItermColors(filePath);
    case '.terminal':
      return parseTerminalApp(filePath);
    case '.yaml':
    case '.yml':
      return parseAlacritty(filePath);
    case '.json':
      return parseJson(filePath);
    case '.conf':
      return parseKitty(filePath);
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}
