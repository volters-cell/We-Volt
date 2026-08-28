/* Country view feature for EU Tracker
   Provides a dedicated view for exploring a single country's voting record */

(function (global) {
  'use strict';

  const state = {
    currentCountry: null,
    countryData: null
  };

  let container = null;
  let directory = null;
  let index = null;

  function init(config) {
    container = document.getElementById(config.containerId);
    directory = config.directory;
    index = config.index;

    if (!container) return;

    // Add country view button to country panel
    const panel = document.getElementById('country-panel');
    if (panel) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'country-view-btn';
      viewBtn.textContent = 'View Full Record';
      viewBtn.setAttribute('aria-label', 'View full voting record for this country');
      viewBtn.hidden = true;
      viewBtn.addEventListener('click', openCountryView);
      panel.appendChild(viewBtn);
      state.viewBtn = viewBtn;
    }

    // Listen for country selection
    window.addEventListener('countrychange', function(e) {
      if (e.detail && e.detail.country) {
        updateViewButton(e.detail.country);
      }
    });
  }

  function updateViewButton(countryCode) {
    if (!state.viewBtn) return;
    
    state.currentCountry = countryCode;
    state.viewBtn.hidden = !countryCode;
    
    if (countryCode && directory) {
      const countryData = directory.countries[countryCode];
      if (countryData) {
        state.countryData = countryData;
        state.viewBtn.textContent = 'View Full Record for ' + countryData.name;
      }
    }
  }

  function openCountryView() {
    if (!state.currentCountry) return;

    const countryCode = state.currentCountry;
    const countryData = state.countryData;
    
    if (!countryData) return;

    // Build country view content
    const content = buildCountryViewContent(countryCode, countryData);
    
    // Show in a modal or dedicated section
    showCountryViewModal(content);
  }

  function buildCountryViewContent(countryCode, countryData) {
    const votes = getCountryVotes(countryCode);
    
    let html = `
      <div class="country-view">
        <header class="country-view-header">
          <h2>${escapeHTML(countryData.name)}</h2>
          <div class="country-meta">
            <span class="country-code">${escapeHTML(countryCode)}</span>
            <span class="country-seats">${(countryData.seats || 'N/A')} seats</span>
          </div>
        </header>
        
        <section class="country-stats">
          <h3>Voting Statistics</h3>
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-value">${(votes.total || 0)}</span>
              <span class="stat-label">Total Votes</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">${(votes.for || 0)}</span>
              <span class="stat-label">For</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">${(votes.against || 0)}</span>
              <span class="stat-label">Against</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">${(votes.abstain || 0)}</span>
              <span class="stat-label">Abstentions</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">${(votes.absent || 0)}</span>
              <span class="stat-label">Absent</span>
            </div>
          </div>
        </section>
        
        <section class="country-votes">
          <h3>Recent Votes</h3>
          <div class="votes-list">
            ${buildVotesList(countryCode)}
          </div>
        </section>
      </div>
    `;
    
    return html;
  }

  function getCountryVotes(countryCode) {
    // This would be populated from actual data
    // For now, return placeholder
    return {
      total: 0,
      for: 0,
      against: 0,
      abstain: 0,
      absent: 0
    };
  }

  function buildVotesList(countryCode) {
    // Build list of recent votes for this country
    // Placeholder implementation
    return '<p class="empty-state">Voting data will be displayed here.</p>';
  }

  function showCountryViewModal(content) {
    // Create or reuse modal
    let modal = document.getElementById('country-view-modal');
    
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'country-view-modal';
      modal.className = 'modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-labelledby', 'country-view-title');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="modal-overlay" tabindex="-1"></div>
        <div class="modal-content country-view-content" tabindex="-1">
          <button class="modal-close" aria-label="Close country view">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div id="country-view-container"></div>
        </div>
      `;
      document.body.appendChild(modal);
      
      // Add close handler
      const closeBtn = modal.querySelector('.modal-close');
      const overlay = modal.querySelector('.modal-overlay');
      
      function close() {
        modal.hidden = true;
        document.body.style.overflow = '';
      }
      
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', close);
      
      modal.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          close();
          e.stopPropagation();
        }
      });
    }
    
    // Update content
    const container = modal.querySelector('#country-view-container');
    if (container) {
      container.innerHTML = content;
    }
    
    // Show modal
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    
    // Focus first focusable element
    const focusable = modal.querySelector('[tabindex="-1"]');
    if (focusable) {
      focusable.focus();
    }
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initialize
  if (typeof EUTrackerConfig !== 'undefined') {
    init(EUTrackerConfig);
  }

  // Expose for debugging
  window.EUCountryView = {
    open: openCountryView,
    init: init
  };
})(window);
