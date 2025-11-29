/**
 * Build Song Index with Smart Grouping
 *
 * Scans MIDI folders and creates a searchable JSON index with:
 * - Metadata extraction (key, tempo, version, format)
 * - Smart grouping of variants (same song in different keys/versions)
 * - Primary song selection per group
 *
 * Run with: node scripts/build-song-index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const MIDI_FOLDERS = [
  'public/personally_owned_MIDI/50000midifiles',
  'public/personally_owned_MIDI/Classical Archives - The Greats (MIDI)/extracted',
  'public/songs', // Keep existing songs too
];

const OUTPUT_FILE = 'public/song-index.json';

// File extensions to include
const MIDI_EXTENSIONS = ['.mid', '.midi', '.MID', '.MIDI'];

/**
 * Extract metadata from filename
 */
function extractMetadata(filename) {
  const metadata = {
    key: null,
    tempo: null,
    version: null,
    format: null,
    arrangement: null,
    artist: null
  };

  // Key/tempo: -C120, -F78, -Bb80
  const keyTempo = filename.match(/-([A-G][b#]?)(\d+)/i);
  if (keyTempo) {
    metadata.key = keyTempo[1].toUpperCase();
    metadata.tempo = parseInt(keyTempo[2]);
  }

  // MM format: MM GM, MM XG, MM 3k
  const mmFormat = filename.match(/MM\s*(GM|XG|3k)/i);
  if (mmFormat) metadata.format = mmFormat[1].toUpperCase();

  // Arrangement: -harp, -piano, -words
  const arr = filename.match(/-(harp|piano|words|vocal|instrumental)/i);
  if (arr) metadata.arrangement = arr[1].toLowerCase();

  // Version: trailing digit before extension (imagine2.mid -> 2)
  const version = filename.match(/(\d)\.midi?$/i);
  if (version) metadata.version = parseInt(version[1]);

  // Artist from "Artist - Song" format
  const artistSong = filename.match(/^(.+?)\s+-\s+(.+)\.midi?$/i);
  if (artistSong) metadata.artist = artistSong[1].trim();

  return metadata;
}

/**
 * Generate a normalized base name for grouping
 * Removes key/tempo suffixes, version numbers, format markers
 */
function getBaseName(filename) {
  let name = filename.toLowerCase();

  // Remove extension
  name = name.replace(/\.midi?$/i, '');

  // Remove key/tempo suffix (-C120, -F78, -Bb80)
  name = name.replace(/-[a-g][b#]?\d+(-[\w]+)?$/i, '');

  // Remove MM format suffixes (MM GM, MM XG, MM 3k)
  name = name.replace(/\s+mm\s*(gm|xg|3k)\s*$/i, '');

  // Remove arrangement suffixes
  name = name.replace(/[-_\s](harp|piano|words|vocal|instrumental)$/i, '');

  // Remove trailing single digit version numbers
  name = name.replace(/([a-z])\d$/i, '$1');

  // Normalize separators
  name = name.replace(/_/g, ' ').replace(/[-\s]+/g, ' ').trim();

  // Remove leading special chars
  name = name.replace(/^[-\.]+/, '');

  return name;
}

/**
 * Get the top-level artist/category for grouping
 */
function getGroupCategory(category) {
  // Get first meaningful folder from category
  const parts = category.split('/').filter(p => p && p !== 'Uncategorized');
  if (parts.length === 0) return 'misc';

  // If "By ARTIST", use the artist name
  if (parts[0] === 'By ARTIST' && parts.length > 1) {
    return parts[1].toLowerCase().replace(/\s+/g, '_');
  }

  return parts[0].toLowerCase().replace(/\s+/g, '_');
}

/**
 * Generate a grouping key for a song
 * Songs with the same groupKey are variants of each other
 *
 * AGGRESSIVE grouping: Just use the song name, ignore folder/artist
 * This collapses "Yesterday" from Beatles, Boyz II Men, etc. into ONE result
 */
function generateGroupKey(song) {
  const baseName = getBaseName(song.filename);
  // Just use the base name - all "Yesterday" songs become one group
  return baseName;
}

/**
 * Clean up filename to create a readable song name
 */
function cleanSongName(filename) {
  // Remove extension
  let name = filename.replace(/\.(mid|midi)$/i, '');

  // Replace underscores with spaces
  name = name.replace(/_/g, ' ');

  // Remove common suffixes like -C120, -G100, etc. (key/tempo markers)
  name = name.replace(/[-\s]+[A-G][b#]?\d+(-\w+)?$/i, '');

  // Remove trailing numbers like "1", "2", etc.
  name = name.replace(/\s*\d+$/, '');

  // Clean up multiple spaces
  name = name.replace(/\s+/g, ' ').trim();

  return name || filename;
}

/**
 * Extract category from folder path
 */
function extractCategory(relativePath, filename) {
  // Get folder structure without the filename
  const parts = relativePath.replace(/\\/g, '/').split('/');
  parts.pop(); // Remove filename

  // Remove root folder parts
  const categoryParts = parts.filter(p =>
    !p.includes('personally_owned_MIDI') &&
    !p.includes('50000midifiles') &&
    !p.includes('50000 MIDI FILES') &&
    !p.includes('2009 MIDI') &&
    !p.includes('extracted') &&
    !p.includes('Classical Archives') &&
    !p.includes('Greats') &&
    p !== 'public' &&
    p !== 'songs'
  );

  return categoryParts.join('/') || 'Uncategorized';
}

/**
 * Recursively scan a directory for MIDI files
 */
function scanDirectory(dirPath, basePath, songs) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        scanDirectory(fullPath, basePath, songs);
      } else if (entry.isFile()) {
        // Check if it's a MIDI file
        const ext = path.extname(entry.name);
        if (MIDI_EXTENSIONS.includes(ext)) {
          const relativePath = path.relative(basePath, fullPath);
          const stats = fs.statSync(fullPath);
          const category = extractCategory(relativePath, entry.name);
          const metadata = extractMetadata(entry.name);

          const song = {
            id: Buffer.from(relativePath).toString('base64').replace(/[=+/]/g, ''),
            name: cleanSongName(entry.name),
            filename: entry.name,
            path: relativePath.replace(/\\/g, '/'),
            category: category,
            size: stats.size,
            metadata: metadata,
            groupKey: null, // Will be set after object creation
          };

          song.groupKey = generateGroupKey(song);
          songs.push(song);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning ${dirPath}:`, err.message);
  }
}

/**
 * Main function
 */
function buildIndex() {
  console.log('Building song index...\n');

  const songs = [];
  const projectRoot = path.resolve(__dirname, '..');

  for (const folder of MIDI_FOLDERS) {
    const fullPath = path.join(projectRoot, folder);
    console.log(`Scanning: ${folder}`);

    if (fs.existsSync(fullPath)) {
      const beforeCount = songs.length;
      scanDirectory(fullPath, projectRoot, songs);
      console.log(`  Found ${songs.length - beforeCount} files`);
    } else {
      console.log(`  Folder not found, skipping`);
    }
  }

  // Sort by name
  songs.sort((a, b) => a.name.localeCompare(b.name));

  // Build groups map and song lookup
  console.log('\nBuilding groups...');
  const groups = new Map();
  const songMap = new Map(songs.map(s => [s.id, s]));

  for (const song of songs) {
    const key = song.groupKey;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(song.id);
  }

  // Score function for primary selection
  // Higher score = better candidate for primary
  function scoreSong(song) {
    let score = 0;

    // Prefer no key/tempo suffix
    if (!song.metadata.key) score += 100;

    // Prefer no version number
    if (!song.metadata.version) score += 50;

    // Prefer no format suffix
    if (!song.metadata.format) score += 25;

    // Prefer larger file size (usually more complete)
    score += Math.min(song.size / 10000, 20);

    return score;
  }

  // Select primary song for each group
  function selectPrimary(groupSongIds) {
    if (groupSongIds.length === 1) return groupSongIds[0];

    let bestId = groupSongIds[0];
    let bestScore = scoreSong(songMap.get(bestId));

    for (let i = 1; i < groupSongIds.length; i++) {
      const song = songMap.get(groupSongIds[i]);
      const score = scoreSong(song);
      if (score > bestScore) {
        bestScore = score;
        bestId = groupSongIds[i];
      }
    }

    return bestId;
  }

  // Convert groups to object and add primaryId
  const groupsObj = {};
  for (const [key, songIds] of groups) {
    groupsObj[key] = {
      songIds: songIds,
      primaryId: selectPrimary(songIds),
      count: songIds.length
    };
  }

  // Count groups with multiple songs
  const multiVersionGroups = Array.from(groups.values()).filter(ids => ids.length > 1).length;
  console.log(`Created ${groups.size} groups (${multiVersionGroups} with multiple versions)`);

  // Build simplified index - client will derive groups from groupKey
  // Only store essential fields for each song
  const simplifiedSongs = songs.map(s => ({
    id: s.id,
    name: s.name,
    filename: s.filename,
    path: s.path,
    category: s.category,
    size: s.size,
    groupKey: s.groupKey,
    // Only include metadata if it has values
    ...(s.metadata.key || s.metadata.version || s.metadata.format || s.metadata.arrangement
      ? { meta: {
          ...(s.metadata.key && { k: s.metadata.key }),
          ...(s.metadata.tempo && { t: s.metadata.tempo }),
          ...(s.metadata.version && { v: s.metadata.version }),
          ...(s.metadata.format && { f: s.metadata.format }),
          ...(s.metadata.arrangement && { a: s.metadata.arrangement }),
        }}
      : {})
  }));

  // Create a list of primary song IDs for groups with multiple songs
  const primaries = {};
  for (const [key, songIds] of groups) {
    if (songIds.length > 1) {
      primaries[key] = selectPrimary(songIds);
    }
  }

  const index = {
    songs: simplifiedSongs,
    primaries: primaries,  // Only groups with multiple songs
    totalCount: songs.length,
    uniqueGroups: groups.size,
    indexedAt: new Date().toISOString(),
  };

  // Write to file (compact JSON for smaller size)
  const outputPath = path.join(projectRoot, OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(index));

  console.log(`\nIndex built successfully!`);
  console.log(`Total songs: ${songs.length}`);
  console.log(`Unique groups: ${groups.size}`);
  console.log(`Reduction: ${(100 - (groups.size / songs.length * 100)).toFixed(1)}%`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);

  // Show category breakdown
  const categories = {};
  for (const song of songs) {
    const cat = song.category.split('/')[0] || 'Uncategorized';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  console.log('\nCategories:');
  const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats.slice(0, 10)) {
    console.log(`  ${cat}: ${count}`);
  }
  if (sortedCats.length > 10) {
    console.log(`  ... and ${sortedCats.length - 10} more categories`);
  }
}

// Run
buildIndex();
