import { useState, useRef, useEffect } from 'react';
import SegmentTile from './SegmentTile';
import './SongBoard.css';

function SongBoard({ song, onEditSegment, onDuplicateSegment, onUpdateConnections, onUpdatePositions, onAutoArrange, zoom = 100 }) {
  const [dragState, setDragState] = useState(null); // { type: 'tile' | 'connection', ... }
  const [positions, setPositions] = useState({});
  const svgRef = useRef(null);
  const boardRef = useRef(null);

  useEffect(() => {
    if (song && song.segments) {
      // Initialize positions for new segments
      const newPositions = { ...positions };
      let needsUpdate = false;

      song.segments.forEach((segment, index) => {
        if (!newPositions[segment.id]) {
          // New segment - place it in next available spot
          const tilesPerRow = 4;
          const tileWidth = 150;
          const tileHeight = 150;
          const gapX = 100;
          const gapY = 80;
          const row = Math.floor(index / tilesPerRow);
          const col = index % tilesPerRow;

          newPositions[segment.id] = {
            x: 40 + col * (tileWidth + gapX),
            y: 40 + row * (tileHeight + gapY)
          };
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        setPositions(newPositions);
      }
    }
  }, [song?.segments]);

  useEffect(() => {
    if (song?.positions) {
      setPositions(song.positions);
    }
  }, [song]);

  const autoArrange = () => {
    if (!song || !song.segments.length) return;

    const tileWidth = 150;
    const tileHeight = 150;
    const gapX = 100;
    const gapY = 80;
    const startX = 50;
    const startY = 200; // Increased from 50 to 200 for better top margin

    // Build connection graph
    const connections = song.connections || [];
    const outgoing = {}; // Map of segmentId -> [target ids]
    const incoming = {}; // Map of segmentId -> [source ids]

    song.segments.forEach(seg => {
      outgoing[seg.id] = [];
      incoming[seg.id] = [];
    });

    connections.forEach(conn => {
      if (outgoing[conn.from]) outgoing[conn.from].push(conn.to);
      if (incoming[conn.to]) incoming[conn.to].push(conn.from);
    });

    // Find root nodes (no incoming connections)
    const roots = song.segments.filter(seg => incoming[seg.id].length === 0);

    // If no roots found (circular), just use the first segment
    if (roots.length === 0 && song.segments.length > 0) {
      roots.push(song.segments[0]);
    }

    // Assign layers using BFS
    const layers = [];
    const layerMap = {}; // segmentId -> layer index
    const visited = new Set();
    const queue = roots.map(r => ({ id: r.id, layer: 0 }));

    roots.forEach(r => visited.add(r.id));

    while (queue.length > 0) {
      const { id, layer } = queue.shift();

      if (!layers[layer]) layers[layer] = [];
      layers[layer].push(id);
      layerMap[id] = layer;

      // Add children to next layer
      const children = outgoing[id] || [];
      children.forEach(childId => {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push({ id: childId, layer: layer + 1 });
        }
      });
    }

    // Add any unvisited segments (disconnected) to the end
    song.segments.forEach(seg => {
      if (!visited.has(seg.id)) {
        const lastLayer = layers.length;
        if (!layers[lastLayer]) layers[lastLayer] = [];
        layers[lastLayer].push(seg.id);
        layerMap[seg.id] = lastLayer;
      }
    });

    // Position tiles based on layers (horizontal flow: left to right)
    const newPositions = {};

    layers.forEach((layer, layerIndex) => {
      const numInLayer = layer.length;
      const layerHeight = numInLayer * tileHeight + (numInLayer - 1) * gapY;

      // Center tiles vertically within the layer
      // For single tile: start at startY
      // For multiple tiles: center them around startY
      const startYForLayer = startY + Math.max(0, (400 - layerHeight) / 2);

      layer.forEach((segId, indexInLayer) => {
        newPositions[segId] = {
          x: startX + layerIndex * (tileWidth + gapX),
          y: startYForLayer + indexInLayer * (tileHeight + gapY)
        };
      });
    });

    setPositions(newPositions);
    onUpdatePositions(newPositions);
  };

  // Expose autoArrange to parent
  useEffect(() => {
    if (onAutoArrange) {
      onAutoArrange.current = autoArrange;
    }
  }, [song?.segments, onAutoArrange]);

  const handleTileDragStart = (segmentId, e) => {
    if (e.target.closest('.tile-actions')) return;

    const board = boardRef.current.getBoundingClientRect();
    const currentPos = positions[segmentId] || { x: 0, y: 0 };

    setDragState({
      type: 'tile',
      segmentId,
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentPos.x,
      initialY: currentPos.y
    });
  };

  const handleConnectionDragStart = (segmentId, e) => {
    const tile = e.currentTarget.getBoundingClientRect();
    const board = boardRef.current.getBoundingClientRect();

    setDragState({
      type: 'connection',
      segmentId,
      x: tile.left + tile.width / 2 - board.left + boardRef.current.scrollLeft,
      y: tile.top + tile.height / 2 - board.top + boardRef.current.scrollTop,
      currentX: e.clientX,
      currentY: e.clientY
    });
  };

  const handleMouseMove = (e) => {
    if (!dragState) return;

    if (dragState.type === 'tile') {
      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;

      setPositions(prev => ({
        ...prev,
        [dragState.segmentId]: {
          x: dragState.initialX + deltaX,
          y: dragState.initialY + deltaY
        }
      }));
    } else if (dragState.type === 'connection') {
      const board = boardRef.current.getBoundingClientRect();
      setDragState(prev => ({
        ...prev,
        currentX: e.clientX - board.left + boardRef.current.scrollLeft,
        currentY: e.clientY - board.top + boardRef.current.scrollTop
      }));
    }
  };

  const handleMouseUp = (e) => {
    if (!dragState) return;

    if (dragState.type === 'tile') {
      // Save final position
      onUpdatePositions(positions);
    } else if (dragState.type === 'connection') {
      // Check if dropped on another tile
      const target = e.target.closest('.segment-tile');
      if (target) {
        const targetId = song.segments.find(seg =>
          target.querySelector('h3')?.textContent === seg.name
        )?.id;

        if (targetId && targetId !== dragState.segmentId) {
          const label = prompt('Enter transition label (e.g., "Verse to Chorus"):');
          if (label && label.trim()) {
            const newConnection = {
              from: dragState.segmentId,
              to: targetId,
              label: label.trim()
            };
            onUpdateConnections([...(song.connections || []), newConnection]);
          }
        }
      }
    }

    setDragState(null);
  };

  const getSegmentCenter = (segmentId) => {
    const pos = positions[segmentId];
    if (!pos) return { x: 0, y: 0 };
    return {
      x: pos.x + 75,
      y: pos.y + 75
    };
  };

  if (!song || !song.segments || song.segments.length === 0) {
    return (
      <div className="song-board-empty">
        <p>No segments yet. Click "Create Segment" to get started!</p>
      </div>
    );
  }

  const zoomScale = zoom / 100;

  return (
    <div
      className="song-board"
      ref={boardRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="board-content"
        style={{
          transform: `scale(${zoomScale})`,
          transformOrigin: 'top left'
        }}
      >
      <svg className="connections-layer" ref={svgRef}>
        {song.connections?.map((conn, index) => {
          const from = getSegmentCenter(conn.from);
          const to = getSegmentCenter(conn.to);
          const midX = (from.x + to.x) / 2;

          // Position label ABOVE the tiles (not at midpoint)
          // Use the minimum Y of both tiles and offset upward
          const minY = Math.min(from.y, to.y);
          const labelY = minY - 50; // 50px above the higher tile

          return (
            <g key={index}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#4a9eff"
                strokeWidth="4"
                markerEnd="url(#arrowhead)"
              />
              {/* Background rectangle for text */}
              <rect
                x={midX - conn.label.length * 5}
                y={labelY - 16}
                width={conn.label.length * 10 + 20}
                height={32}
                fill="rgba(26, 26, 46, 0.95)"
                stroke="#4a9eff"
                strokeWidth="2"
                rx="6"
              />
              <text
                x={midX}
                y={labelY}
                fill="#fff"
                fontSize="16"
                fontWeight="bold"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {conn.label}
              </text>
            </g>
          );
        })}

        {dragState?.type === 'connection' && (
          <line
            x1={dragState.x}
            y1={dragState.y}
            x2={dragState.currentX}
            y2={dragState.currentY}
            stroke="#4a9eff"
            strokeWidth="4"
            strokeDasharray="8,4"
            opacity="0.7"
          />
        )}

        <defs>
          <marker
            id="arrowhead"
            markerWidth="12"
            markerHeight="12"
            refX="11"
            refY="6"
            orient="auto"
          >
            <polygon points="0 0, 12 6, 0 12" fill="#4a9eff" />
          </marker>
        </defs>
      </svg>

      <div className="tiles-container">
        {song.segments.map((segment) => (
          <div
            key={segment.id}
            className="tile-wrapper"
            style={{
              position: 'absolute',
              left: positions[segment.id]?.x || 0,
              top: positions[segment.id]?.y || 0,
              transition: dragState?.type === 'tile' && dragState.segmentId === segment.id ? 'none' : 'left 0.3s ease, top 0.3s ease'
            }}
          >
            <SegmentTile
              segment={segment}
              onEdit={onEditSegment}
              onDuplicate={onDuplicateSegment}
              onTileDragStart={handleTileDragStart}
              onConnectionStart={handleConnectionDragStart}
            />
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

export default SongBoard;
