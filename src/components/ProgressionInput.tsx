import React, { useState, useRef, useEffect } from 'react';
import type { Progression } from '../types/index';

interface Props {
  onAdd: (name: string, chords: string) => string | null;
  onRemove: (name: string) => void;
  onEdit: (oldName: string, newName: string, chords: string) => string | null;
  progressions: Progression[];
}

export default function ProgressionInput({ onAdd, onRemove, onEdit, progressions }: Props) {
  const [name, setName] = useState('');
  const [chords, setChords] = useState('');
  const [error, setError] = useState<string | null>(null);
  // When editing, stores the original name of the progression being edited
  const [editingName, setEditingName] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const chordsRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Progression name is required');
      return;
    }

    let result: string | null;
    if (editingName) {
      result = onEdit(editingName, trimmedName, chords);
    } else {
      result = onAdd(trimmedName, chords);
    }

    if (result) {
      setError(result);
    } else {
      setName('');
      setChords('');
      setEditingName(null);
    }
  };

  const handleEdit = (prog: Progression) => {
    setEditingName(prog.name);
    setName(prog.name);
    setChords(prog.chords.join(', '));
    setError(null);
    nameRef.current?.focus();
  };

  const handleCancelEdit = () => {
    setEditingName(null);
    setName('');
    setChords('');
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, field: 'name' | 'chords') => {
    if (e.key === 'Enter') {
      if (field === 'name') {
        chordsRef.current?.focus();
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Escape' && editingName) {
      handleCancelEdit();
    }
  };

  return (
    <div className="progression-input">
      <div className="input-group">
        <label>
          Name
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => handleKeyDown(e, 'name')}
            placeholder="e.g. Verse"
          />
        </label>
        <label>
          Chords
          <input
            ref={chordsRef}
            type="text"
            value={chords}
            onChange={e => setChords(e.target.value)}
            onKeyDown={e => handleKeyDown(e, 'chords')}
            placeholder="e.g. G, D, A, G"
          />
        </label>
        <div className="btn-row">
          <button onClick={handleSubmit} className="add-btn">
            {editingName ? 'Save' : 'Add'}
          </button>
          {editingName && (
            <button onClick={handleCancelEdit} className="cancel-btn">
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && <div className="input-error">{error}</div>}

      <div className="progression-list">
        {progressions.map(prog => (
          <div
            key={prog.name}
            className={`progression-row ${editingName === prog.name ? 'editing' : ''}`}
          >
            <span className="prog-bullet" style={{ background: prog.color }} />
            <span className="prog-text">
              {prog.name}: {prog.chords.join(' \u2192 ')}
            </span>
            <button
              className="prog-edit"
              title={`Edit ${prog.name}`}
              onClick={() => handleEdit(prog)}
            >
              \u270E
            </button>
            <button
              className="prog-remove"
              title={`Remove ${prog.name}`}
              onClick={() => onRemove(prog.name)}
            >
              \u2715
            </button>
          </div>
        ))}
      </div>

      <style>{`
        .progression-input {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .input-group label {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .input-group input {
          padding: 6px 8px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.9rem;
          font-family: monospace;
        }
        .btn-row {
          display: flex;
          gap: 6px;
        }
        .add-btn {
          padding: 6px 12px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-primary);
          color: var(--text-primary);
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.15s;
          flex: 1;
        }
        .add-btn:hover {
          background: var(--accent);
          color: #fff;
        }
        .cancel-btn {
          padding: 6px 12px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-primary);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.15s;
        }
        .cancel-btn:hover {
          background: #e74c3c;
          color: #fff;
        }
        .input-error {
          color: #e74c3c;
          font-size: 0.8rem;
        }
        .progression-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .progression-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 0;
        }
        .progression-row.editing {
          opacity: 0.5;
        }
        .prog-bullet {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .prog-text {
          flex: 1;
          font-family: monospace;
          font-size: 0.8rem;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .prog-edit {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0 4px;
          transition: color 0.15s;
        }
        .prog-edit:hover {
          color: var(--accent);
        }
        .prog-remove {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.9rem;
          padding: 0 4px;
          transition: color 0.15s;
        }
        .prog-remove:hover {
          color: #e74c3c;
        }
      `}</style>
    </div>
  );
}
