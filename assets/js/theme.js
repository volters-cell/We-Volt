/* Theme management for EU Tracker
   Handles light/dark/system theme switching with localStorage persistence
   and proper ARIA attribute management. */

(function () {
  'use strict';

  const THEME_KEY = 'eu-tracker-theme';
  const THEMES = ['light', 'dark', 'system'];

  // Current theme state
  let currentTheme = null;

  // Get the user's system preference
  function getSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Get stored theme or default to system
  function getStoredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    return stored && THEMES.includes(stored) ? stored : 'system';
  }

  // Apply theme to document
  function applyTheme(theme) {
    const html = document.documentElement;
    
    // Remove all theme attributes first
    html.removeAttribute('data-theme');
    
    // Apply the selected theme
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
    } else if (theme === 'dark') {
      html.setAttribute('data-theme', 'dark');
    }
    // 'system' uses no attribute, relying on prefers-color-scheme
    
    currentTheme = theme;
    updateToggleButton();
  }

  // Update the toggle button's appearance and label
  function updateToggleButton() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    const icons = {
      light: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      dark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
      system: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    };

    const labels = {
      light: 'Switch to dark theme',
      dark: 'Switch to light theme',
      system: 'Switch to system theme'
    };

    toggleBtn.innerHTML = icons[theme] || icons.system;
    toggleBtn.setAttribute('aria-label', labels[theme] || labels.system);
    toggleBtn.setAttribute('title', labels[theme] || labels.system);
  }

  // Cycle to next theme
  function cycleTheme() {
    const currentIndex = THEMES.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    const nextTheme = THEMES[nextIndex];
    
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
    
    // Dispatch custom event for other components
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: nextTheme } }));
  }

  // Initialize theme
  function initTheme() {
    const storedTheme = getStoredTheme();
    applyTheme(storedTheme);

    // Set up toggle button
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', cycleTheme);
      
      // Add keyboard support
      toggleBtn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cycleTheme();
        }
      });
    }

    // Listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // Expose for debugging
  window.EUTheme = {
    get: () => currentTheme,
    set: (theme) => {
      if (THEMES.includes(theme)) {
        localStorage.setItem(THEME_KEY, theme);
        applyTheme(theme);
      }
    },
    cycle: cycleTheme
  };
})();
