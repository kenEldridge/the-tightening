/**
 * Song Search Component
 *
 * Provides a search interface for browsing the song library.
 * Features:
 * - Text search with debouncing
 * - Fuzzy matching on name, filename, and category
 * - Results dropdown with limited results
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { loadSongIndex, isPrimarySong, type SongIndexEntry, type SongIndex } from '../data/loadSongs';

export interface SongSearchProps {
  currentSongName?: string;
  onSongSelect: (entry: SongIndexEntry) => void;
  disabled?: boolean;
}

// Simple fuzzy search - checks if all search terms appear in the text
function fuzzyMatch(text: string, searchTerms: string[]): boolean {
  const lowerText = text.toLowerCase();
  return searchTerms.every(term => lowerText.includes(term));
}

// Score a match (higher = better match)
function scoreMatch(entry: SongIndexEntry, searchTerms: string[]): number {
  let score = 0;
  const lowerName = entry.name.toLowerCase();
  const lowerFilename = entry.filename.toLowerCase();
  const lowerCategory = entry.category.toLowerCase();

  for (const term of searchTerms) {
    // Exact name match = highest score
    if (lowerName === term) score += 100;
    // Name starts with term
    else if (lowerName.startsWith(term)) score += 50;
    // Name contains term
    else if (lowerName.includes(term)) score += 20;
    // Category contains term
    if (lowerCategory.includes(term)) score += 10;
    // Filename contains term
    if (lowerFilename.includes(term)) score += 5;
  }

  return score;
}

// Result with variant count
interface SearchResult {
  entry: SongIndexEntry;
  variantCount: number;
}

export const SongSearch: React.FC<SongSearchProps> = ({
  currentSongName,
  onSongSelect,
  disabled = false,
}) => {
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [songIndex, setSongIndex] = useState<SongIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Load song index on mount
  useEffect(() => {
    loadSongIndex().then(index => {
      setSongIndex(index);
      setIsLoading(false);
    });
  }, []);

  // Pre-compute primary songs and variant counts
  const { primarySongs, variantCounts } = useMemo(() => {
    if (!songIndex) return { primarySongs: [], variantCounts: new Map<string, number>() };

    // Count songs per group
    const counts = new Map<string, number>();
    for (const song of songIndex.songs) {
      counts.set(song.groupKey, (counts.get(song.groupKey) || 0) + 1);
    }

    // Filter to primary songs only
    const primaries = songIndex.songs.filter(song => isPrimarySong(song, songIndex));

    return { primarySongs: primaries, variantCounts: counts };
  }, [songIndex]);

  // Debounced search
  useEffect(() => {
    if (!songIndex || primarySongs.length === 0 || searchText.length < 2) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      const searchTerms = searchText.toLowerCase().split(/\s+/).filter(t => t.length > 0);

      if (searchTerms.length === 0) {
        setResults([]);
        return;
      }

      // Find matches in primary songs only
      const matches: Array<{ entry: SongIndexEntry; score: number }> = [];

      for (const entry of primarySongs) {
        const searchableText = `${entry.name} ${entry.filename} ${entry.category}`.toLowerCase();
        if (fuzzyMatch(searchableText, searchTerms)) {
          matches.push({
            entry,
            score: scoreMatch(entry, searchTerms),
          });
        }

        // Stop after finding enough candidates
        if (matches.length >= 100) break;
      }

      // Sort by score and take top 20, include variant count
      matches.sort((a, b) => b.score - a.score);
      setResults(matches.slice(0, 20).map(m => ({
        entry: m.entry,
        variantCount: variantCounts.get(m.entry.groupKey) || 1,
      })));
      setSelectedIndex(0);
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [searchText, songIndex, primarySongs, variantCounts]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          onSongSelect(results[selectedIndex].entry);
          setSearchText('');
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  }, [isOpen, results, selectedIndex, onSongSelect]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      {/* Current song display */}
      {currentSongName && (
        <div style={{
          marginBottom: '8px',
          padding: '8px',
          backgroundColor: '#1a3a1a',
          borderRadius: '4px',
          fontSize: '13px',
          color: '#8f8',
        }}>
          Now playing: <strong>{currentSongName}</strong>
        </div>
      )}

      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={isLoading ? 'Loading songs...' : `Search ${songIndex?.uniqueGroups || 0} songs...`}
        disabled={disabled || isLoading}
        style={{
          width: '100%',
          padding: '10px 12px',
          backgroundColor: '#2a2a2a',
          color: '#eee',
          border: '1px solid #555',
          borderRadius: '4px',
          fontSize: '14px',
          fontFamily: 'monospace',
          boxSizing: 'border-box',
        }}
      />

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div
          ref={resultsRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: '300px',
            overflowY: 'auto',
            backgroundColor: '#1a1a1a',
            border: '1px solid #555',
            borderRadius: '0 0 4px 4px',
            zIndex: 1000,
          }}
        >
          {results.map(({ entry, variantCount }, index) => (
            <div
              key={entry.id}
              onClick={() => {
                onSongSelect(entry);
                setSearchText('');
                setIsOpen(false);
              }}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                backgroundColor: index === selectedIndex ? '#333' : 'transparent',
                borderBottom: index < results.length - 1 ? '1px solid #333' : 'none',
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 'bold', color: '#eee', fontSize: '13px' }}>
                  {entry.name}
                </div>
                {variantCount > 1 && (
                  <span style={{
                    backgroundColor: '#444',
                    color: '#aaa',
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    marginLeft: '8px',
                  }}>
                    +{variantCount - 1} ver
                  </span>
                )}
              </div>
              <div style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>
                {entry.category} &bull; {entry.filename}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results message */}
      {isOpen && searchText.length >= 2 && results.length === 0 && !isLoading && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            padding: '12px',
            backgroundColor: '#1a1a1a',
            border: '1px solid #555',
            borderRadius: '0 0 4px 4px',
            color: '#888',
            fontSize: '13px',
            zIndex: 1000,
          }}
        >
          No songs found for "{searchText}"
        </div>
      )}
    </div>
  );
};
