/* Data export functionality for EU Tracker
   Allows users to export vote data, country records, and more */

(function () {
  'use strict';

  let directory = null;
  let index = null;
  let currentVote = null;
  let currentCountry = null;

  function init(config) {
    directory = config.directory;
    index = config.index;

    // Add export button to various panels
    addExportButtons();

    // Listen for data changes
    window.addEventListener('datachange', function(e) {
      if (e.detail && e.detail.directory) {
        directory = e.detail.directory;
      }
      if (e.detail && e.detail.index) {
        index = e.detail.index;
      }
    });

    // Listen for vote/country changes
    window.addEventListener('votechange', function(e) {
      if (e.detail && e.detail.vote) {
        currentVote = e.detail.vote;
      }
    });

    window.addEventListener('countrychange', function(e) {
      if (e.detail && e.detail.country) {
        currentCountry = e.detail.country;
      }
    });
  }

  function addExportButtons() {
    // Export button for decision panel
    const decisionSection = document.getElementById('decision-section');
    if (decisionSection) {
      const exportBtn = createExportButton('Export Vote Data', 'vote');
      exportBtn.className = 'export-btn';
      exportBtn.addEventListener('click', () => exportVoteData(currentVote));
      decisionSection.appendChild(exportBtn);
    }

    // Export button for country panel
    const countryPanel = document.getElementById('country-panel');
    if (countryPanel) {
      const exportBtn = createExportButton('Export Country Record', 'country');
      exportBtn.className = 'export-btn';
      exportBtn.addEventListener('click', () => exportCountryData(currentCountry));
      countryPanel.appendChild(exportBtn);
    }

    // Export all data button in header or sidebar
    const header = document.querySelector('.site-header');
    if (header) {
      const exportAllBtn = createExportButton('Export All Data', 'all');
      exportAllBtn.className = 'export-btn export-all-btn';
      exportAllBtn.addEventListener('click', exportAllData);
      header.appendChild(exportAllBtn);
    }
  }

  function createExportButton(text, type) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.setAttribute('aria-label', 'Export ' + type + ' data as JSON');
    btn.setAttribute('title', 'Export as JSON');
    
    const icon = document.createElement('svg');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
    
    btn.prepend(icon);
    btn.prepend(document.createTextNode(' '));
    
    return btn;
  }

  function exportVoteData(voteId) {
    if (!voteId || !index) return;

    const vote = index.votes.find(v => v.id === voteId);
    if (!vote) {
      alert('Vote not found');
      return;
    }

    // Get full vote data with ballots
    fetchVoteWithBallots(voteId).then(data => {
      const filename = `eu-tracker-vote-${voteId}-${formatDate(new Date())}.json`;
      downloadJSON(data, filename);
    }).catch(error => {
      console.error('Error exporting vote:', error);
      alert('Error exporting vote data');
    });
  }

  function exportCountryData(countryCode) {
    if (!countryCode || !directory) return;

    const country = directory.countries[countryCode];
    if (!country) {
      alert('Country not found');
      return;
    }

    // Get all votes for this country
    const countryVotes = getCountryVotes(countryCode);
    
    const data = {
      country: country,
      votes: countryVotes,
      statistics: calculateCountryStats(countryVotes),
      exportedAt: new Date().toISOString()
    };

    const filename = `eu-tracker-country-${countryCode}-${formatDate(new Date())}.json`;
    downloadJSON(data, filename);
  }

  function exportAllData() {
    if (!index || !directory) {
      alert('Data not loaded yet');
      return;
    }

    const data = {
      metadata: {
        source: 'EU Tracker',
        url: window.location.origin + window.location.pathname,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      },
      countries: directory.countries,
      votes: index.votes,
      summary: {
        totalVotes: index.votes.length,
        totalCountries: Object.keys(directory.countries).length
      }
    };

    const filename = `eu-tracker-full-export-${formatDate(new Date())}.json`;
    downloadJSON(data, filename);
  }

  async function fetchVoteWithBallots(voteId) {
    // In a real implementation, this would fetch the full vote data
    // For now, return a simplified structure
    const vote = index.votes.find(v => v.id === voteId);
    
    return {
      vote: vote,
      ballots: [], // Would be populated from actual data
      exportedAt: new Date().toISOString()
    };
  }

  function getCountryVotes(countryCode) {
    // This would query the actual vote data for a country
    // For now, return placeholder
    return [];
  }

  function calculateCountryStats(votes) {
    return {
      total: votes.length,
      for: votes.filter(v => v.position === 'for').length,
      against: votes.filter(v => v.position === 'against').length,
      abstain: votes.filter(v => v.position === 'abstain').length,
      absent: votes.filter(v => v.position === 'absent').length
    };
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  // Also provide CSV export option
  function exportAsCSV(data, filename) {
    // Convert JSON to CSV
    const headers = Object.keys(data[0] || {});
    let csv = headers.join(',') + '\n';
    
    data.forEach(row => {
      csv += headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
      }).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace('.json', '.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Initialize when ready
  function checkAndInit() {
    if (document.readyState !== 'loading') {
      if (window.EUTrackerConfig) {
        init(window.EUTrackerConfig);
      } else {
        setTimeout(checkAndInit, 100);
      }
    } else {
      document.addEventListener('DOMContentLoaded', checkAndInit);
    }
  }

  checkAndInit();

  // Expose for debugging
  window.EUExport = {
    init: init,
    exportVote: exportVoteData,
    exportCountry: exportCountryData,
    exportAll: exportAllData,
    exportCSV: exportAsCSV
  };
})();
