import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getDatabase } from '../db/connection';
import type { ThemeColors } from '../../shared/types/theme';
import type { InstallResult } from '../../shared/types/ipc';

const execAsync = promisify(exec);

// Get current platform
export function getPlatform(): 'darwin' | 'win32' | 'linux' {
  return process.platform as 'darwin' | 'win32' | 'linux';
}

// Get theme colors from database
function getThemeColors(themeId: string): ThemeColors | null {
  const db = getDatabase();
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

// Get theme name from database
function getThemeName(themeId: string): string {
  const db = getDatabase();
  const theme = db.prepare('SELECT name FROM themes WHERE id = ?').get(themeId) as { name: string } | undefined;
  return theme?.name || 'Untitled';
}

// Convert hex color to iTerm2 color dict format
function hexToItermColorDict(hex: string): {
  'Red Component': number;
  'Green Component': number;
  'Blue Component': number;
  'Alpha Component': number;
  'Color Space': string;
} {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  return {
    'Red Component': r,
    'Green Component': g,
    'Blue Component': b,
    'Alpha Component': 1,
    'Color Space': 'sRGB',
  };
}

// Install to iTerm2 via Dynamic Profiles and auto-apply
export async function installToIterm2(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  const dynamicProfilesDir = path.join(
    app.getPath('home'),
    'Library/Application Support/iTerm2/DynamicProfiles'
  );

  // Ensure directory exists
  if (!fs.existsSync(dynamicProfilesDir)) {
    fs.mkdirSync(dynamicProfilesDir, { recursive: true });
  }

  // Build iTerm2 profile
  const profile = {
    Profiles: [{
      Name: themeName,
      Guid: themeId,
      'Background Color': hexToItermColorDict(colors.background),
      'Foreground Color': hexToItermColorDict(colors.foreground),
      'Cursor Color': hexToItermColorDict(colors.cursor),
      'Cursor Text Color': hexToItermColorDict(colors.cursorText),
      'Selection Color': hexToItermColorDict(colors.selection),
      'Selected Text Color': hexToItermColorDict(colors.selectionText),
      'Ansi 0 Color': hexToItermColorDict(colors.ansi.black),
      'Ansi 1 Color': hexToItermColorDict(colors.ansi.red),
      'Ansi 2 Color': hexToItermColorDict(colors.ansi.green),
      'Ansi 3 Color': hexToItermColorDict(colors.ansi.yellow),
      'Ansi 4 Color': hexToItermColorDict(colors.ansi.blue),
      'Ansi 5 Color': hexToItermColorDict(colors.ansi.magenta),
      'Ansi 6 Color': hexToItermColorDict(colors.ansi.cyan),
      'Ansi 7 Color': hexToItermColorDict(colors.ansi.white),
      'Ansi 8 Color': hexToItermColorDict(colors.ansi.brightBlack),
      'Ansi 9 Color': hexToItermColorDict(colors.ansi.brightRed),
      'Ansi 10 Color': hexToItermColorDict(colors.ansi.brightGreen),
      'Ansi 11 Color': hexToItermColorDict(colors.ansi.brightYellow),
      'Ansi 12 Color': hexToItermColorDict(colors.ansi.brightBlue),
      'Ansi 13 Color': hexToItermColorDict(colors.ansi.brightMagenta),
      'Ansi 14 Color': hexToItermColorDict(colors.ansi.brightCyan),
      'Ansi 15 Color': hexToItermColorDict(colors.ansi.brightWhite),
    }],
  };

  const slugName = themeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const profilePath = path.join(dynamicProfilesDir, `${slugName}.json`);

  try {
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

    // Auto-apply using AppleScript to all windows/tabs/sessions
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
      await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
      return {
        success: true,
        path: profilePath,
        instructions: `Theme "${themeName}" applied to iTerm2!`,
      };
    } catch (scriptErr) {
      // AppleScript failed, but profile was created
      return {
        success: true,
        path: profilePath,
        instructions: `Theme "${themeName}" installed. Open iTerm2 and select it from Profiles menu, or restart iTerm2.`,
      };
    }
  } catch (err) {
    return {
      success: false,
      path: profilePath,
      error: `Failed to write profile: ${err}`,
    };
  }
}

// Install to Terminal.app and auto-apply
export async function installToTerminalApp(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  // Use AppleScript to directly set Terminal colors
  const hexToRGB = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) * 257;
    const g = parseInt(hex.slice(3, 5), 16) * 257;
    const b = parseInt(hex.slice(5, 7), 16) * 257;
    return `{${r}, ${g}, ${b}}`;
  };

  // Escape theme name for AppleScript
  const escapedName = themeName.replace(/"/g, '\\"');

  // Step 1: Create the profile and set as default
  const createProfileScript = `
    tell application "Terminal"
      if not (exists settings set "${escapedName}") then
        make new settings set with properties {name:"${escapedName}"}
      end if

      set targetSettings to settings set "${escapedName}"
      set background color of targetSettings to ${hexToRGB(colors.background)}
      set normal text color of targetSettings to ${hexToRGB(colors.foreground)}
      set cursor color of targetSettings to ${hexToRGB(colors.cursor)}

      -- Set as default and startup profile
      set default settings to targetSettings
      set startup settings to targetSettings
    end tell
  `;

  try {
    // Create the profile first
    await execAsync(`osascript -e '${createProfileScript.replace(/'/g, "'\"'\"'")}'`);

    // Step 2: Try to apply to open windows (separate try/catch so profile creation is not affected)
    let appliedToWindows = false;
    try {
      const applyScript = `
        tell application "Terminal"
          set targetSettings to settings set "${escapedName}"
          if (count of windows) > 0 then
            repeat with w in windows
              try
                set current settings of selected tab of w to targetSettings
              end try
            end repeat
          end if
        end tell
      `;
      await execAsync(`osascript -e '${applyScript.replace(/'/g, "'\"'\"'")}'`);
      appliedToWindows = true;
    } catch {
      // Could not apply to open windows - profile still created
    }

    if (appliedToWindows) {
      return {
        success: true,
        path: '',
        instructions: `Theme "${themeName}" applied! All open Terminal windows updated.`,
      };
    } else {
      return {
        success: true,
        path: '',
        instructions: `Theme "${themeName}" saved to Terminal profiles. Select it in Terminal → Settings → Profiles, or open a new window.`,
      };
    }
  } catch (err) {
    return {
      success: false,
      path: '',
      error: `Failed to create Terminal profile. Make sure Terminal.app is running.`,
    };
  }
}

// Set theme as default in Terminal.app
export async function setTerminalDefault(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  const hexToRGB = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) * 257;
    const g = parseInt(hex.slice(3, 5), 16) * 257;
    const b = parseInt(hex.slice(5, 7), 16) * 257;
    return `{${r}, ${g}, ${b}}`;
  };

  const escapedName = themeName.replace(/"/g, '\\"');

  const appleScript = `
    tell application "Terminal"
      -- Create or update the profile (settings set)
      if not (exists settings set "${escapedName}") then
        set newSettings to make new settings set with properties {name:"${escapedName}"}
      end if

      tell settings set "${escapedName}"
        set background color to ${hexToRGB(colors.background)}
        set normal text color to ${hexToRGB(colors.foreground)}
        set cursor color to ${hexToRGB(colors.cursor)}
      end tell

      -- Set as default profile
      set default settings to settings set "${escapedName}"

      -- Also set startup settings (for new windows)
      set startup settings to settings set "${escapedName}"
    end tell
  `;

  try {
    await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);

    return {
      success: true,
      path: '',
      instructions: `Theme "${themeName}" is now the default Terminal.app profile! New windows will use this theme.`,
    };
  } catch (err) {
    return {
      success: false,
      path: '',
      error: `Failed to set default: ${err}`,
    };
  }
}

// Install to Windows Terminal
export async function installToWindowsTerminal(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  // Windows Terminal settings path
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const settingsPath = path.join(
    localAppData,
    'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'
  );

  // Also check for Windows Terminal Preview and unpackaged version
  const previewSettingsPath = path.join(
    localAppData,
    'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json'
  );
  const unpackagedSettingsPath = path.join(localAppData, 'Microsoft/Windows Terminal/settings.json');

  // Find which settings file exists
  let actualSettingsPath = '';
  if (fs.existsSync(settingsPath)) {
    actualSettingsPath = settingsPath;
  } else if (fs.existsSync(previewSettingsPath)) {
    actualSettingsPath = previewSettingsPath;
  } else if (fs.existsSync(unpackagedSettingsPath)) {
    actualSettingsPath = unpackagedSettingsPath;
  }

  if (!actualSettingsPath) {
    return {
      success: false,
      path: '',
      error: 'Windows Terminal settings not found. Is Windows Terminal installed?',
    };
  }

  try {
    // Read existing settings
    const settingsContent = fs.readFileSync(actualSettingsPath, 'utf-8');

    // Remove comments for JSON parsing (Windows Terminal uses JSONC)
    // We need to be careful not to remove // inside strings (like URLs)
    // Strategy: Process character by character, tracking if we're inside a string
    let jsonWithoutComments = '';
    let inString = false;
    let escaped = false;
    let i = 0;

    while (i < settingsContent.length) {
      const char = settingsContent[i];
      const nextChar = settingsContent[i + 1];

      if (escaped) {
        jsonWithoutComments += char;
        escaped = false;
        i++;
        continue;
      }

      if (char === '\\' && inString) {
        jsonWithoutComments += char;
        escaped = true;
        i++;
        continue;
      }

      if (char === '"' && !escaped) {
        inString = !inString;
        jsonWithoutComments += char;
        i++;
        continue;
      }

      // Handle comments only when not inside a string
      if (!inString) {
        // Single-line comment
        if (char === '/' && nextChar === '/') {
          // Skip until end of line
          while (i < settingsContent.length && settingsContent[i] !== '\n') {
            i++;
          }
          continue;
        }
        // Multi-line comment
        if (char === '/' && nextChar === '*') {
          i += 2; // Skip /*
          while (i < settingsContent.length - 1) {
            if (settingsContent[i] === '*' && settingsContent[i + 1] === '/') {
              i += 2; // Skip */
              break;
            }
            i++;
          }
          continue;
        }
      }

      jsonWithoutComments += char;
      i++;
    }

    // Also remove trailing commas which are allowed in JSONC
    jsonWithoutComments = jsonWithoutComments.replace(/,(\s*[}\]])/g, '$1');

    let settings;
    try {
      settings = JSON.parse(jsonWithoutComments);
    } catch (parseErr) {
      return {
        success: false,
        path: actualSettingsPath,
        error: `Failed to parse Windows Terminal settings: ${parseErr}`,
      };
    }

    // Build Windows Terminal color scheme
    const scheme = {
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

    // Initialize schemes array if it doesn't exist
    if (!settings.schemes) {
      settings.schemes = [];
    }

    // Remove existing scheme with same name
    settings.schemes = settings.schemes.filter((s: { name: string }) => s.name !== themeName);

    // Add the new scheme
    settings.schemes.push(scheme);

    // Apply the scheme to the default profile
    if (!settings.profiles) {
      settings.profiles = { defaults: {} };
    }
    if (!settings.profiles.defaults) {
      settings.profiles.defaults = {};
    }
    settings.profiles.defaults.colorScheme = themeName;

    // Write back to settings file
    fs.writeFileSync(actualSettingsPath, JSON.stringify(settings, null, 4));

    return {
      success: true,
      path: actualSettingsPath,
      instructions: `Theme "${themeName}" applied to Windows Terminal! All open windows updated.`,
    };
  } catch (err) {
    return {
      success: false,
      path: actualSettingsPath,
      error: `Failed to update Windows Terminal settings: ${err}`,
    };
  }
}

// Install to Alacritty (Linux/macOS/Windows)
export async function installToAlacritty(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  // Alacritty config paths by platform
  let configPath: string;
  const platform = getPlatform();

  if (platform === 'win32') {
    configPath = path.join(process.env.APPDATA || '', 'alacritty', 'alacritty.toml');
  } else if (platform === 'darwin') {
    configPath = path.join(os.homedir(), '.config', 'alacritty', 'alacritty.toml');
  } else {
    // Linux - check XDG_CONFIG_HOME first
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    configPath = path.join(xdgConfig, 'alacritty', 'alacritty.toml');
  }

  // Ensure directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Build Alacritty TOML color config
  const tomlContent = `# ShellShade Theme: ${themeName}
# Generated by ShellShade

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
    // Read existing config if it exists
    let existingContent = '';
    if (fs.existsSync(configPath)) {
      existingContent = fs.readFileSync(configPath, 'utf-8');
      // Remove existing color sections
      existingContent = existingContent
        .replace(/\[colors\.primary\][\s\S]*?(?=\[|$)/g, '')
        .replace(/\[colors\.cursor\][\s\S]*?(?=\[|$)/g, '')
        .replace(/\[colors\.selection\][\s\S]*?(?=\[|$)/g, '')
        .replace(/\[colors\.normal\][\s\S]*?(?=\[|$)/g, '')
        .replace(/\[colors\.bright\][\s\S]*?(?=\[|$)/g, '')
        .replace(/# ShellShade Theme:.*\n# Generated by ShellShade\n*/g, '')
        .trim();
    }

    // Combine existing config with new colors
    const finalContent = existingContent ? `${existingContent}\n\n${tomlContent}` : tomlContent;
    fs.writeFileSync(configPath, finalContent);

    return {
      success: true,
      path: configPath,
      instructions: `Theme "${themeName}" applied to Alacritty! Restart Alacritty to see changes.`,
    };
  } catch (err) {
    return {
      success: false,
      path: configPath,
      error: `Failed to update Alacritty config: ${err}`,
    };
  }
}

// Install to Kitty (Linux/macOS)
export async function installToKitty(themeId: string): Promise<InstallResult> {
  const colors = getThemeColors(themeId);
  const themeName = getThemeName(themeId);

  if (!colors) {
    return { success: false, path: '', error: 'Theme not found' };
  }

  // Kitty config path
  const platform = getPlatform();
  let configDir: string;

  if (platform === 'darwin') {
    configDir = path.join(os.homedir(), '.config', 'kitty');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    configDir = path.join(xdgConfig, 'kitty');
  }

  const themePath = path.join(configDir, 'current-theme.conf');
  const configPath = path.join(configDir, 'kitty.conf');

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Build Kitty color config
  const kittyTheme = `# ShellShade Theme: ${themeName}
# Generated by ShellShade

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

  try {
    // Write theme file
    fs.writeFileSync(themePath, kittyTheme);

    // Ensure kitty.conf includes the theme
    let kittyConf = '';
    if (fs.existsSync(configPath)) {
      kittyConf = fs.readFileSync(configPath, 'utf-8');
    }

    const includeStatement = 'include current-theme.conf';
    if (!kittyConf.includes(includeStatement)) {
      kittyConf = `${includeStatement}\n${kittyConf}`;
      fs.writeFileSync(configPath, kittyConf);
    }

    return {
      success: true,
      path: themePath,
      instructions: `Theme "${themeName}" applied to Kitty! Press Ctrl+Shift+F5 to reload or restart Kitty.`,
    };
  } catch (err) {
    return {
      success: false,
      path: themePath,
      error: `Failed to update Kitty config: ${err}`,
    };
  }
}
