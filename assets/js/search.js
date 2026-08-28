/* Enhanced search functionality for EU Tracker
   Provides suggestions, filters, and better UX */

(function () {
  'use strict';

  const SEARCH_INPUT_ID = 'search-input';
  const SEARCH_CLEAR_ID = 'search-clear';
  const SEARCH_STATUS_ID = 'search-status';
  const MEP_RESULTS_ID = 'mep-results';

  let input = null;
  let clearBtn = null;
  let statusEl = null;
  let mepResults = null;
  let suggestionsContainer = null;

  let directory = null;
  let index = null;
  let memberIndex = null;

  let activeFilters = {
    type: null, // 'vote', 'mep', 'country'
    institution: null
  };

  // Debounced search
  let searchTimeout = null;
  const SEARCH_DELAY = 300;

  function init(config) {
    input = document.getElementById(SEARCH_INPUT_ID);
    clearBtn = document.getElementById(SEARCH_CLEAR_ID);
    statusEl = document.getElementById(SEARCH_STATUS_ID);
    mepResults = document.getElementById(MEP_RESULTS_ID);

    if (!input) return;

    directory = config.directory;
    index = config.index;
    memberIndex = config.memberIndex;

    // Create suggestions container
    suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'search-suggestions hidden';
    suggestionsContainer.setAttribute('role', 'listbox');
    suggestionsContainer.setAttribute('aria-label', 'Search suggestions');
    input.parentNode.appendChild(suggestionsContainer);

    // Add search icon
    const searchIcon = document.createElement('svg');
    searchIcon.className = 'search-icon';
    searchIcon.setAttribute('width', '18');
    searchIcon.setAttribute('height', '18');
    searchIcon.setAttribute('viewBox', '0 0 24 24');
    searchIcon.setAttribute('fill', 'none');
    searchIcon.setAttribute('stroke', 'currentColor');
    searchIcon.setAttribute('stroke-width', '2');
    searchIcon.innerHTML = '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
    input.parentNode.insertBefore(searchIcon, input);

    // Set up event listeners
    input.addEventListener('input', handleInput);
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    input.addEventListener('keydown', handleKeydown);

    if (clearBtn) {
      clearBtn.addEventListener('click', clearSearch);
    }

    // Listen for data changes
    window.addEventListener('datachange', function(e) {
      if (e.detail && e.detail.directory) {
        directory = e.detail.directory;
      }
      if (e.detail && e.detail.index) {
        index = e.detail.index;
      }
    });
  }

  function handleInput(e) {
    const query = e.target.value;
    
    // Show/hide clear button
    if (clearBtn) {
      clearBtn.hidden = !query;
    }

    // Debounce search
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(query);
    }, SEARCH_DELAY);
  }

  function handleFocus() {
    const query = input.value;
    if (query && query.length >= 2) {
      showSuggestions(query);
    }
  }

  function handleBlur() {
    // Small timeout to allow click on suggestion to work
    setTimeout(() => {
      hideSuggestions();
    }, 200);
  }

  function handleKeydown(e) {
    const suggestions = suggestionsContainer.querySelectorAll('.suggestion-item');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (suggestions.length > 0) {
          suggestions[0].focus();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (suggestions.length > 0) {
          suggestions[suggestions.length - 1].focus();
        }
        break;
      case 'Escape':
        hideSuggestions();
        break;
      case 'Enter':
        if (document.activeElement.classList.contains('suggestion-item')) {
          // Let the click handler deal with it
          e.preventDefault();
        }
        break;
    }
  }

  function performSearch(query) {
    if (!query || query.length < 2) {
      hideSuggestions();
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.hidden = true;
      }
      return;
    }

    const results = searchData(query);
    displaySuggestions(results, query);
  }

  function searchData(query) {
    const results = {
      votes: [],
      meps: [],
      countries: []
    };

    const lowerQuery = query.toLowerCase();

    // Search votes
    if (index && index.votes) {
      results.votes = index.votes
        .filter(vote => 
          vote.title.toLowerCase().includes(lowerQuery) ||
          vote.procedureRef.toLowerCase().includes(lowerQuery) ||
          vote.id.includes(lowerQuery)
        )
        .slice(0, 5);
    }

    // Search MEPs
    if (memberIndex) {
      results.meps = Object.values(memberIndex)
        .filter(mep => 
          mep.name.toLowerCase().includes(lowerQuery) ||
          mep.countryName.toLowerCase().includes(lowerQuery) ||
          (mep.groupName && mep.groupName.toLowerCase().includes(lowerQuery))
        )
        .slice(0, 5);
    }

    // Search countries
    if (directory && directory.countries) {
      results.countries = Object.values(directory.countries)
        .filter(country => 
          country.name.toLowerCase().includes(lowerQuery) ||
          country.code.toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5);
    }

    return results;
  }

  function displaySuggestions(results, query) {
    const totalResults = results.votes.length + results.meps.length + results.countries.length;
    
    if (totalResults === 0) {
      hideSuggestions();
      if (statusEl) {
        statusEl.textContent = 'No results found for "' + query + '"';
        statusEl.hidden = false;
      }
      return;
    }

    // Build suggestions HTML
    let html = '';
    
    if (results.votes.length > 0) {
      html += '<div class="suggestion-group" role="group" aria-label="Votes">';
      results.votes.forEach(vote => {
        html += createSuggestionItem(vote, 'vote', query);
      });
      html += '</div>';
    }

    if (results.meps.length > 0) {
      html += '<div class="suggestion-group" role="group" aria-label="MEPs">';
      results.meps.forEach(mep => {
        html += createSuggestionItem(mep, 'mep', query);
      });
      html += '</div>';
    }

    if (results.countries.length > 0) {
      html += '<div class="suggestion-group" role="group" aria-label="Countries">';
      results.countries.forEach(country => {
        html += createSuggestionItem(country, 'country', query);
      });
      html += '</div>';
    }

    suggestionsContainer.innerHTML = html;
    suggestionsContainer.classList.remove('hidden');
    
    // Add event listeners to suggestions
    suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', function() {
        selectSuggestion(this);
      });
      item.addEventListener('mousemove', function() {
        this.focus();
      });
    });

    if (statusEl) {
      statusEl.textContent = totalResults + ' result' + (totalResults !== 1 ? 's' : '') + ' found';
      statusEl.hidden = false;
    }
  }

  function createSuggestionItem(item, type, query) {
    const lowerQuery = query.toLowerCase();
    let displayName = '';
    let subtitle = '';
    let dataId = '';

    switch (type) {
      case 'vote':
        displayName = highlightMatch(item.title, lowerQuery);
        subtitle = item.procedureRef;
        dataId = item.id;
        break;
      case 'mep':
        displayName = highlightMatch(item.name, lowerQuery);
        subtitle = item.countryName + (item.groupName ? ' • ' + item.groupName : '');
        dataId = item.id;
        break;
      case 'country':
        displayName = highlightMatch(item.name, lowerQuery);
        subtitle = item.code;
        dataId = item.code;
        break;
    }

    return `
      <button class="suggestion-item" 
              role="option" 
              data-type="${type}" 
              data-id="${dataId}"
              tabindex="-1">
        <span class="suggestion-type ${type}">${type}</span>
        <span class="suggestion-text">${displayName}</span>
        ${subtitle ? '<span class="suggestion-subtitle">' + subtitle + '</span>' : ''}
      </button>
    `;
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHTML(text);
    
    const index = text.toLowerCase().indexOf(query);
    if (index === -1) return escapeHTML(text);
    
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);
    
    return escapeHTML(before) + '<span class="suggestion-highlight">' + escapeHTML(match) + '</span>' + escapeHTML(after);
  }

  function selectSuggestion(item) {
    const type = item.getAttribute('data-type');
    const id = item.getAttribute('data-id');
    
    hideSuggestions();
    input.value = item.querySelector('.suggestion-text').textContent;
    
    // Trigger appropriate action based on type
    switch (type) {
      case 'vote':
        // Find and open the vote
        if (window.EUTracker && window.EUTracker.openVote) {
          window.EUTracker.openVote(id);
        }
        break;
      case 'mep':
        // Open MEP profile
        if (window.EUTracker && window.EUTracker.openMEP) {
          window.EUTracker.openMEP(id);
        }
        break;
      case 'country':
        // Open country
        if (window.EUTracker && window.EUTracker.openCountry) {
          window.EUTracker.openCountry(id);
        }
        break;
    }

    // Clear focus to close keyboard
    input.blur();
  }

  function hideSuggestions() {
    suggestionsContainer.classList.add('hidden');
  }

  function clearSearch() {
    input.value = '';
    if (clearBtn) {
      clearBtn.hidden = true;
    }
    hideSuggestions();
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.hidden = true;
    }
    input.focus();
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initialize when DOM is ready and data is available
  function checkAndInit() {
    if (document.readyState !== 'loading') {
      if (window.EUTrackerConfig) {
        init(window.EUTrackerConfig);
      } else {
        // Wait for config
        setTimeout(checkAndInit, 100);
      }
    } else {
      document.addEventListener('DOMContentLoaded', checkAndInit);
    }
  }

  checkAndInit();

  // Expose for debugging
  window.EUSearch = {
    init: init,
    search: performSearch,
    clear: clearSearch
  };
})();
