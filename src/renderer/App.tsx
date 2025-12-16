import React, { useState, useEffect } from 'react';
import Layout from './components/layout/Layout';
import Sidebar from './components/layout/Sidebar';
import ThemeEditor from './components/editor/ThemeEditor';
import type { Theme, ThemeSummary } from '../shared/types/theme';

type View = 'library' | 'editor' | 'settings';

type Platform = 'darwin' | 'win32' | 'linux';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('library');
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [isNewTheme, setIsNewTheme] = useState(false);
  const [platform, setPlatform] = useState<Platform>('darwin');
  const [appVersion, setAppVersion] = useState('0.0.0');

  useEffect(() => {
    loadThemes();
    loadPlatform();
    loadVersion();
  }, []);

  const loadVersion = async () => {
    try {
      if (window.api?.system.getVersion) {
        const v = await window.api.system.getVersion();
        setAppVersion(v);
      }
    } catch {
      // Use default version
    }
  };

  const loadPlatform = async () => {
    try {
      if (window.api?.system.getPlatform) {
        const p = await window.api.system.getPlatform();
        setPlatform(p);
      }
    } catch (err) {
      // Silently fall back to default platform
    }
  };

  const loadThemes = async () => {
    try {
      if (window.api) {
        const allThemes = await window.api.themes.getAll();
        setThemes(allThemes);
      }
    } catch (err) {
      console.error('Failed to load themes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewTheme = () => {
    setEditingTheme(null);
    setIsNewTheme(true);
    setCurrentView('editor');
  };

  const handleEditTheme = async (themeId: string) => {
    try {
      if (window.api) {
        const theme = await window.api.themes.getById(themeId);
        if (theme) {
          setEditingTheme(theme);
          setIsNewTheme(false);
          setCurrentView('editor');
        }
      }
    } catch (err) {
      console.error('Failed to load theme:', err);
    }
  };

  const handleSaveTheme = async (themeData: Partial<Theme>) => {
    try {
      if (window.api) {
        if (isNewTheme) {
          await window.api.themes.create({
            name: themeData.name || 'Untitled Theme',
            slug: '',
            description: themeData.description,
            author: themeData.author,
            colors: themeData.colors!,
            settings: themeData.settings || {},
            tags: [],
            isFavorite: false,
            isBuiltin: false,
          });
        } else if (editingTheme) {
          await window.api.themes.update(editingTheme.id, themeData);
        }
        await loadThemes();
        setCurrentView('library');
        setEditingTheme(null);
        setIsNewTheme(false);
      }
    } catch (err) {
      console.error('Failed to save theme:', err);
      alert('Failed to save theme. Check console for details.');
    }
  };

  const handleCancelEdit = () => {
    setCurrentView('library');
    setEditingTheme(null);
    setIsNewTheme(false);
  };

  const handleDeleteTheme = async (themeId: string) => {
    if (!confirm('Are you sure you want to delete this theme?')) return;
    try {
      if (window.api) {
        await window.api.themes.delete(themeId);
        await loadThemes();
      }
    } catch (err) {
      console.error('Failed to delete theme:', err);
    }
  };

  const handleToggleFavorite = async (themeId: string) => {
    try {
      if (window.api) {
        await window.api.themes.toggleFavorite(themeId);
        await loadThemes();
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const handleImport = async () => {
    try {
      if (window.api) {
        const result = await window.api.files.import();
        if (result) {
          await loadThemes();
          alert(`Successfully imported "${result.name}"!`);
        }
      }
    } catch (err) {
      console.error('Import failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      alert(`Import failed: ${message}`);
    }
  };

  const handleApplyTheme = async (themeId: string, target: 'iterm2' | 'terminal' | 'terminal-default' | 'windows-terminal' | 'alacritty' | 'kitty' | 'auto') => {
    try {
      if (window.api) {
        let result;

        // Auto-detect: use platform default terminal
        let actualTarget = target;
        if (target === 'auto') {
          if (platform === 'win32') {
            actualTarget = 'windows-terminal';
          } else if (platform === 'darwin') {
            actualTarget = 'terminal';
          } else {
            actualTarget = 'alacritty'; // Default for Linux
          }
        }

        switch (actualTarget) {
          case 'iterm2':
            result = await window.api.install.toIterm2(themeId);
            break;
          case 'terminal-default':
            result = await window.api.install.setTerminalDefault(themeId);
            break;
          case 'windows-terminal':
            result = await window.api.install.toWindowsTerminal(themeId);
            break;
          case 'alacritty':
            result = await window.api.install.toAlacritty(themeId);
            break;
          case 'kitty':
            result = await window.api.install.toKitty(themeId);
            break;
          case 'terminal':
          default:
            result = await window.api.install.toTerminalApp(themeId);
            break;
        }

        if (result.success) {
          alert(result.instructions || 'Theme installed successfully!');
        } else {
          alert(`Installation failed: ${result.error}`);
        }
      }
    } catch (err) {
      alert(`Failed to apply theme: ${err}`);
    }
  };

  const noDragStyle: React.CSSProperties = {
    WebkitAppRegion: 'no-drag' as const,
  };

  const renderContent = () => {
    if (currentView === 'editor') {
      return (
        <ThemeEditor
          theme={editingTheme}
          onSave={handleSaveTheme}
          onCancel={handleCancelEdit}
          onApply={handleApplyTheme}
          isNew={isNewTheme}
        />
      );
    }

    switch (currentView) {
      case 'library':
        return (
          <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Theme Library</h2>
                <p className="text-white/50 text-sm mt-1">{themes.length} themes available</p>
              </div>
              <button
                type="button"
                onClick={handleNewTheme}
                className="px-5 py-2.5 bg-accent hover:bg-accent-hover rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium shadow-inner-light hover:shadow-glow"
                style={noDragStyle}
              >
                + New Theme
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white/40">Loading themes...</div>
              </div>
            ) : themes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 bg-surface-secondary/50 backdrop-blur-glass rounded-2xl border border-white/5">
                <div className="text-5xl mb-4 opacity-50">🎨</div>
                <p className="text-white/50 mb-6">No themes yet</p>
                <button
                  type="button"
                  onClick={handleNewTheme}
                  style={noDragStyle}
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover rounded-xl transition-all duration-200 cursor-pointer font-medium"
                >
                  Create Your First Theme
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {themes.map((theme) => (
                  <div
                    key={theme.id}
                    className="group bg-surface-secondary/60 backdrop-blur-glass rounded-2xl border border-white/5 hover:border-white/20 hover:bg-surface-tertiary/60 transition-all duration-300 hover:shadow-glass-lg hover:-translate-y-0.5 relative"
                    style={noDragStyle}
                  >
                    {/* Theme Preview */}
                    <div
                      className="h-28 p-4 font-mono text-xs cursor-pointer relative overflow-hidden"
                      style={{ backgroundColor: theme.previewColors.background }}
                      onClick={() => handleEditTheme(theme.id)}
                    >
                      <div style={{ color: theme.previewColors.foreground }} className="opacity-80">
                        <span className="text-green-400">~</span> npm run build
                      </div>
                      <div className="flex gap-1.5 mt-3">
                        {theme.previewColors.ansiColors.slice(0, 8).map((color, i) => (
                          <div
                            key={i}
                            className="w-4 h-4 rounded-md shadow-sm"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      {/* Subtle gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                    </div>

                    {/* Theme Info */}
                    <div className="p-4 relative overflow-visible">
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleEditTheme(theme.id)}
                        >
                          <div className="font-medium truncate text-white/90">{theme.name}</div>
                          {theme.author && (
                            <div className="text-xs text-white/40 truncate mt-0.5">
                              by {theme.author}
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                          {/* Apply button - directly installs theme */}
                          <button
                            type="button"
                            onClick={() => handleApplyTheme(theme.id, 'auto')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 cursor-pointer transition-all"
                            style={noDragStyle}
                            title={platform === 'win32' ? 'Apply to Windows Terminal' : platform === 'darwin' ? 'Apply to Terminal.app' : 'Apply to Alacritty'}
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleFavorite(theme.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 cursor-pointer transition-all"
                            style={noDragStyle}
                            title={theme.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            {theme.isFavorite ? (
                              <span className="text-yellow-400">★</span>
                            ) : (
                              <span className="text-white/40">☆</span>
                            )}
                          </button>

                          {!theme.isBuiltin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteTheme(theme.id)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400/70 hover:text-red-400 cursor-pointer transition-all"
                              style={noDragStyle}
                              title="Delete theme"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {theme.isBuiltin && (
                        <div className="mt-3">
                          <span className="text-[10px] px-2 py-1 bg-white/5 rounded-md text-white/40 font-medium uppercase tracking-wider">
                            Built-in
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'settings':
        return (
          <div className="p-8 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight mb-8">Settings</h2>
            <div className="space-y-4">
              <div className="bg-surface-secondary/60 backdrop-blur-glass p-5 rounded-2xl border border-white/5">
                <h3 className="font-medium text-white/90 mb-2">Application</h3>
                <p className="text-sm text-white/40">Version {appVersion}</p>
              </div>
              <div className="bg-surface-secondary/60 backdrop-blur-glass p-5 rounded-2xl border border-white/5">
                <h3 className="font-medium text-white/90 mb-2">Theme Storage</h3>
                <p className="text-sm text-white/40 font-mono">
                  ~/Library/Application Support/shellshade/
                </p>
              </div>
              <div className="bg-surface-secondary/60 backdrop-blur-glass p-5 rounded-2xl border border-white/5">
                <h3 className="font-medium text-white/90 mb-2">Themes Loaded</h3>
                <p className="text-sm text-white/40">{themes.length} themes in library</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-screen flex flex-col bg-surface-solid text-white overflow-hidden">
      {/* Title bar with drag region - glassy */}
      <div
        className="h-12 bg-surface-secondary/80 backdrop-blur-heavy flex items-center justify-center px-20 border-b border-white/5 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <h1 className="text-sm font-medium text-white/70">ShellShade</h1>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden" style={noDragStyle}>
        {/* Sidebar - hide when editing */}
        {currentView !== 'editor' && (
          <Sidebar
            onViewChange={setCurrentView}
            onNewTheme={handleNewTheme}
            onImport={handleImport}
            version={appVersion}
          />
        )}

        {/* Main content */}
        <Layout>{renderContent()}</Layout>
      </div>
    </div>
  );
};

export default App;
