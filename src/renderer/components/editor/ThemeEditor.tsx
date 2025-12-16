import React, { useState, useEffect } from 'react';
import ColorPalette from './ColorPalette';
import TerminalPreview from './TerminalPreview';
import type { Theme, ThemeColors, ThemeSettings } from '../../../shared/types/theme';

interface ThemeEditorProps {
  theme: Theme | null;
  onSave: (theme: Partial<Theme>) => void;
  onCancel: () => void;
  onApply?: (themeId: string, target: 'iterm2' | 'terminal' | 'terminal-default' | 'windows-terminal' | 'alacritty' | 'kitty' | 'auto') => void;
  isNew?: boolean;
}

const defaultColors: ThemeColors = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorText: '#282a36',
  selection: '#44475a',
  selectionText: '#f8f8f2',
  ansi: {
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
};

const defaultSettings: ThemeSettings = {
  fontFamily: 'SF Mono',
  fontSize: 13,
  lineHeight: 1.4,
  cursorStyle: 'block',
  cursorBlink: true,
};

const ThemeEditor: React.FC<ThemeEditorProps> = ({ theme, onSave, onCancel, onApply, isNew }) => {
  const [name, setName] = useState(theme?.name || 'New Theme');
  const [author, setAuthor] = useState(theme?.author || '');
  const [description, setDescription] = useState(theme?.description || '');
  const [colors, setColors] = useState<ThemeColors>(theme?.colors || defaultColors);
  const [settings, setSettings] = useState<ThemeSettings>(theme?.settings || defaultSettings);
  const [activeTab, setActiveTab] = useState<'colors' | 'settings'>('colors');

  useEffect(() => {
    if (theme) {
      setName(theme.name);
      setAuthor(theme.author || '');
      setDescription(theme.description || '');
      setColors(theme.colors);
      setSettings(theme.settings);
    }
  }, [theme]);

  const handleSave = () => {
    onSave({
      name,
      author: author || undefined,
      description: description || undefined,
      colors,
      settings,
    });
  };

  const noDragStyle: React.CSSProperties = { WebkitAppRegion: 'no-drag' as const };

  return (
    <div className="h-full flex flex-col bg-surface-solid" style={noDragStyle}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-surface-secondary/50 backdrop-blur-heavy border-b border-white/5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 text-white/50 hover:text-white transition-colors cursor-pointer text-sm"
            style={noDragStyle}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="h-5 w-px bg-white/10" />
          <h2 className="text-base font-medium text-white/90">
            {isNew ? 'Create New Theme' : theme?.name}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Apply button */}
          {!isNew && theme && onApply && (
            <button
              type="button"
              onClick={() => onApply(theme.id, 'auto')}
              className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-2 text-sm font-medium"
              style={noDragStyle}
              title="Apply theme"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" />
              </svg>
              Apply
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-white/50 hover:text-white transition-colors cursor-pointer text-sm"
            style={noDragStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-accent hover:bg-accent-hover rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium shadow-inner-light hover:shadow-glow"
            style={noDragStyle}
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Editor */}
        <div className="w-[380px] border-r border-white/5 overflow-y-auto bg-surface-secondary/30 backdrop-blur-glass">
          {/* Theme Metadata */}
          <div className="p-5 border-b border-white/5">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Theme Info</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
                  style={noDragStyle}
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Author</label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all placeholder:text-white/20"
                  style={noDragStyle}
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  rows={2}
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all placeholder:text-white/20"
                  style={noDragStyle}
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/5">
            <button
              type="button"
              onClick={() => setActiveTab('colors')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
                activeTab === 'colors'
                  ? 'text-white border-b-2 border-accent bg-white/5'
                  : 'text-white/40 hover:text-white/70'
              }`}
              style={noDragStyle}
            >
              Colors
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
                activeTab === 'settings'
                  ? 'text-white border-b-2 border-accent bg-white/5'
                  : 'text-white/40 hover:text-white/70'
              }`}
              style={noDragStyle}
            >
              Settings
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-5">
            {activeTab === 'colors' ? (
              <ColorPalette colors={colors} onChange={setColors} />
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">Font Family</label>
                  <select
                    value={settings.fontFamily || 'SF Mono'}
                    onChange={(e) => setSettings({ ...settings, fontFamily: e.target.value })}
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm cursor-pointer focus:outline-none focus:border-accent/50"
                    style={noDragStyle}
                  >
                    <option value="SF Mono">SF Mono</option>
                    <option value="Monaco">Monaco</option>
                    <option value="Menlo">Menlo</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Fira Code">Fira Code</option>
                    <option value="Source Code Pro">Source Code Pro</option>
                    <option value="Consolas">Consolas</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">
                    Font Size: {settings.fontSize}px
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="24"
                    value={settings.fontSize || 13}
                    onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) })}
                    className="w-full accent-accent"
                    style={noDragStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">Cursor Style</label>
                  <select
                    value={settings.cursorStyle || 'block'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        cursorStyle: e.target.value as 'block' | 'beam' | 'underline',
                      })
                    }
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm cursor-pointer focus:outline-none focus:border-accent/50"
                    style={noDragStyle}
                  >
                    <option value="block">Block</option>
                    <option value="beam">Beam</option>
                    <option value="underline">Underline</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="cursorBlink"
                    checked={settings.cursorBlink !== false}
                    onChange={(e) => setSettings({ ...settings, cursorBlink: e.target.checked })}
                    className="w-4 h-4 accent-accent cursor-pointer rounded"
                    style={noDragStyle}
                  />
                  <label htmlFor="cursorBlink" className="text-sm text-white/60 cursor-pointer">
                    Cursor blink
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Preview */}
        <div className="flex-1 p-6 overflow-y-auto bg-surface-solid">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Live Preview</h3>
          <TerminalPreview colors={colors} settings={settings} />
        </div>
      </div>
    </div>
  );
};

export default ThemeEditor;
