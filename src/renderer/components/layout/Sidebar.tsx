import React, { useState } from 'react';

type View = 'library' | 'editor' | 'settings';

interface SidebarProps {
  onViewChange?: (view: View) => void;
  onNewTheme?: () => void;
  onImport?: () => void;
  version?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ onViewChange, onNewTheme, onImport, version = '0.0.0' }) => {
  const [activeView, setActiveView] = useState<View>('library');

  const navItems: { id: View; label: string; icon: React.ReactNode }[] = [
    {
      id: 'library',
      label: 'Library',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  const handleViewChange = (view: View) => {
    setActiveView(view);
    onViewChange?.(view);
  };

  const handleNewTheme = () => {
    onNewTheme?.();
  };

  const handleImport = () => {
    onImport?.();
  };

  const noDragStyle: React.CSSProperties = {
    WebkitAppRegion: 'no-drag' as const,
  };

  return (
    <aside
      className="w-56 bg-surface-secondary/50 backdrop-blur-heavy border-r border-white/5 flex flex-col"
      style={noDragStyle}
    >
      {/* Logo */}
      <div className="p-4 pb-2 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1a1625] to-[#0d0b12] flex items-center justify-center shadow-lg border border-purple-500/20">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8B5CF6"/>
                <stop offset="50%" stopColor="#06B6D4"/>
                <stop offset="100%" stopColor="#10B981"/>
              </linearGradient>
            </defs>
            <path d="M6 8l5 4-5 4" stroke="url(#logoGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="13" y="10" width="3" height="6" rx="1" fill="url(#logoGrad)" opacity="0.9"/>
          </svg>
        </div>
        <span className="text-sm font-semibold text-white/90">ShellShade</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 pt-2">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleViewChange(item.id)}
                style={noDragStyle}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                  transition-all duration-200 text-left cursor-pointer
                  ${
                    activeView === item.id
                      ? 'bg-white/10 text-white shadow-inner-light'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                  }
                `}
              >
                <span className={activeView === item.id ? 'text-accent' : 'text-white/40'}>
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Quick Actions */}
        <div className="mt-8">
          <h3 className="text-[10px] font-semibold text-white/30 uppercase tracking-wider px-3 mb-2">
            Quick Actions
          </h3>
          <div className="space-y-1">
            <button
              type="button"
              onClick={handleNewTheme}
              style={noDragStyle}
              className="w-full px-3 py-2 text-left text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              New Theme
            </button>
            <button
              type="button"
              onClick={handleImport}
              style={noDragStyle}
              className="w-full px-3 py-2 text-left text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import
            </button>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5">
        <div className="text-[10px] text-white/20 text-center font-medium tracking-wide">
          v{version}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
