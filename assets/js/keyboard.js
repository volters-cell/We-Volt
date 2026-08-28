/* Keyboard shortcuts and help modal for EU Tracker */
(function () {
  'use strict';

  const MODAL_ID = 'keyboard-help';
  const SEARCH_ID = 'search-input';

  let modal = null;
  let closeBtn = null;
  let searchInput = null;

  function init() {
    modal = document.getElementById(MODAL_ID);
    closeBtn = document.getElementById('close-help');
    searchInput = document.getElementById(SEARCH_ID);

    if (!modal) return;

    // Close button handler
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
      closeBtn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeModal();
        }
      });
    }

    // Close on overlay click
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', closeModal);
    }

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal && !modal.hidden) {
        closeModal();
        e.stopPropagation();
      }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', handleShortcut);
  }

  function handleShortcut(e) {
    // Ignore if typing in an input
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      // Allow ? to open help even when in search
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openModal();
      }
      return;
    }

    // Ignore if modal is open (except Escape which is handled separately)
    if (modal && !modal.hidden) {
      return;
    }

    switch (e.key) {
      case '?':
        e.preventDefault();
        openModal();
        break;
      case '/':
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
        }
        break;
      case 't':
      case 'T':
        e.preventDefault();
        // Trigger theme toggle
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
          themeBtn.click();
        }
        break;
    }
  }

  function openModal() {
    if (!modal) return;
    
    modal.hidden = false;
    
    // Focus the close button for keyboard users
    if (closeBtn) {
      closeBtn.focus();
    }
    
    // Trap focus within modal
    trapFocus(modal);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    
    modal.hidden = true;
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Return focus to the element that opened the modal or the search box
    if (searchInput) {
      searchInput.focus();
    }
  }

  function trapFocus(element) {
    const focusableElements = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }, { once: false });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.EUKeyboard = {
    open: openModal,
    close: closeModal
  };
})();
