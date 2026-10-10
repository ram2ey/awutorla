import React from 'react';

export interface DockItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface TopNavBarProps {
  items: DockItem[];
  activeId: string;
  className?: string;
}

/**
 * Primary navigation — a persistent bottom icon dock on mobile, with inline
 * text tabs in the page header on larger screens.
 */
export const TopNavBar: React.FC<TopNavBarProps> = ({ items, activeId, className = '' }) => {
  return (
    <nav
      aria-label="Primary navigation"
      className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 sm:static sm:translate-x-0 flex items-center gap-1 p-1.5 rounded-full bg-charcoal-950 shadow-pill max-w-full overflow-x-auto scrollbar-none ${className}`}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            onClick={item.onClick}
            aria-label={item.label}
            className={`flex items-center justify-center gap-2 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 px-3 sm:px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${
              isActive ? 'bg-mustard-400 text-charcoal-950' : 'text-white/70 hover:text-white'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.icon}
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default TopNavBar;
