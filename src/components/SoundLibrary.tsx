import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sampler, SoundSource } from '../audio/sampler';
import { loadInstrument, scanFolder, type Instrument } from '../audio/soundLibrary';

const LS_SOURCE = 'tt.soundLibrary.source';
const LS_DIR = 'tt.soundLibrary.dir';
const LS_INSTRUMENT = 'tt.soundLibrary.instrument';
const LS_ENABLED = 'tt.soundLibrary.enabled';
const LS_VOLUME = 'tt.soundLibrary.volume';

interface SoundLibraryProps {
  sampler: Sampler;
}

type BuiltinStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type ImportStatus =
  | { kind: 'none' }
  | { kind: 'scanning' }
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'ready'; name: string; count: number; layers: number }
  | { kind: 'error'; message: string };

export default function SoundLibrary({ sampler }: SoundLibraryProps) {
  const [enabled, setEnabled] = useState<boolean>(() => localStorage.getItem(LS_ENABLED) !== 'false');
  const [volume, setVolume] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem(LS_VOLUME) ?? '');
    return Number.isFinite(v) ? v : sampler.volume;
  });
  const [source, setSource] = useState<SoundSource>(
    () => (localStorage.getItem(LS_SOURCE) as SoundSource) || 'synth',
  );
  const [builtin, setBuiltin] = useState<BuiltinStatus>({ kind: 'idle' });
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [imp, setImp] = useState<ImportStatus>({ kind: 'none' });

  const dirRef = useRef<string | null>(localStorage.getItem(LS_DIR));

  const loadBuiltin = useCallback(async () => {
    sampler.resume();
    if (sampler.builtinLoaded) {
      setBuiltin({ kind: 'ready' });
      return;
    }
    setBuiltin({ kind: 'loading', loaded: 0, total: 0 });
    try {
      await sampler.loadBuiltInPiano((loaded, total) => setBuiltin({ kind: 'loading', loaded, total }));
      setBuiltin({ kind: 'ready' });
    } catch (e) {
      setBuiltin({ kind: 'error', message: (e as Error).message });
    }
  }, [sampler]);

  const loadInstr = useCallback(
    async (instrs: Instrument[], name: string, dir: string) => {
      const inst = instrs.find((i) => i.name === name) ?? instrs[0];
      if (!inst) return;
      setSelected(inst.name);
      setImp({ kind: 'loading', done: 0, total: inst.samples.length });
      try {
        const { count, layers } = await loadInstrument(inst, sampler, (done, total) =>
          setImp({ kind: 'loading', done, total }),
        );
        setImp({ kind: 'ready', name: inst.name, count, layers });
        localStorage.setItem(LS_DIR, dir);
        localStorage.setItem(LS_INSTRUMENT, inst.name);
      } catch (e) {
        setImp({ kind: 'error', message: (e as Error).message });
      }
    },
    [sampler],
  );

  const loadSavedFolder = useCallback(async () => {
    const dir = dirRef.current;
    if (!dir || !window.electronAPI?.scanSoundLibrary) return;
    setImp({ kind: 'scanning' });
    try {
      const instrs = await scanFolder(dir);
      if (instrs.length === 0) {
        setImp({ kind: 'none' });
        return;
      }
      setInstruments(instrs);
      await loadInstr(instrs, localStorage.getItem(LS_INSTRUMENT) ?? instrs[0].name, dir);
    } catch (e) {
      setImp({ kind: 'error', message: (e as Error).message });
    }
  }, [loadInstr]);

  // Apply persisted settings once and kick off loading for the chosen source.
  useEffect(() => {
    sampler.setEnabled(enabled);
    sampler.setVolume(volume);
    sampler.setSource(source);
    if (source === 'builtin') void loadBuiltin();
    else if (source === 'samples') void loadSavedFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSource = useCallback(
    (s: SoundSource) => {
      sampler.resume();
      setSource(s);
      sampler.setSource(s);
      localStorage.setItem(LS_SOURCE, s);
      if (s === 'builtin') void loadBuiltin();
      else if (s === 'samples' && !sampler.hasSamples) void loadSavedFolder();
    },
    [sampler, loadBuiltin, loadSavedFolder],
  );

  const handleImport = useCallback(async () => {
    sampler.resume();
    if (!window.electronAPI?.pickSoundLibrary) {
      setImp({ kind: 'error', message: 'Import is only available in the desktop app.' });
      return;
    }
    const dir = await window.electronAPI.pickSoundLibrary();
    if (!dir) return;
    dirRef.current = dir;
    setImp({ kind: 'scanning' });
    try {
      const instrs = await scanFolder(dir);
      if (instrs.length === 0) {
        setImp({ kind: 'error', message: 'No note-mapped samples found in that folder.' });
        return;
      }
      setInstruments(instrs);
      await loadInstr(instrs, instrs[0].name, dir);
    } catch (e) {
      setImp({ kind: 'error', message: (e as Error).message });
    }
  }, [loadInstr, sampler]);

  const handleToggle = useCallback(
    (v: boolean) => {
      sampler.resume();
      setEnabled(v);
      sampler.setEnabled(v);
      localStorage.setItem(LS_ENABLED, String(v));
    },
    [sampler],
  );

  const handleVolume = useCallback(
    (v: number) => {
      sampler.resume();
      setVolume(v);
      sampler.setVolume(v);
      localStorage.setItem(LS_VOLUME, String(v));
    },
    [sampler],
  );

  const pct = builtin.kind === 'loading' && builtin.total > 0 ? Math.round((builtin.loaded / builtin.total) * 100) : null;

  return (
    <div className="recorder">
      <div className="recorder-header">
        <span className="recorder-title">Sound</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => handleToggle(e.target.checked)} />
          On
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: enabled ? 1 : 0.5 }}>
        <span style={{ fontSize: 12 }}>Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={!enabled}
          onChange={(e) => handleVolume(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>

      <select
        className="walk-select"
        value={source}
        onChange={(e) => changeSource(e.target.value as SoundSource)}
        style={{ marginTop: 6 }}
      >
        <option value="synth">Synth (built-in)</option>
        <option value="builtin">Grand Piano</option>
        <option value="samples">Imported library</option>
      </select>

      {source === 'synth' && (
        <div className="recorder-status" style={{ marginTop: 4 }}>
          Simple built-in synth — always available, no download.
        </div>
      )}

      {source === 'builtin' && (
        <div className="recorder-status" style={{ marginTop: 4 }}>
          {builtin.kind === 'idle' && 'Preparing…'}
          {builtin.kind === 'loading' && `Loading grand piano… ${pct !== null ? pct + '%' : ''}`}
          {builtin.kind === 'ready' && 'Grand Piano ready'}
          {builtin.kind === 'error' && (
            <span className="recorder-error">
              {builtin.message} <button className="recorder-new-btn" onClick={loadBuiltin}>Retry</button>
            </span>
          )}
        </div>
      )}

      {source === 'samples' && (
        <>
          {instruments.length > 1 && (
            <select
              className="walk-select"
              value={selected}
              onChange={(e) => {
                const dir = dirRef.current;
                if (dir) void loadInstr(instruments, e.target.value, dir);
              }}
              style={{ marginTop: 6 }}
            >
              {instruments.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} ({i.noteCount} notes{i.layerCount > 1 ? `, ${i.layerCount} layers` : ''})
                </option>
              ))}
            </select>
          )}

          <button className="recorder-btn recorder-btn-start" style={{ marginTop: 6 }} onClick={handleImport}>
            Import sound library…
          </button>

          <div className="recorder-status" style={{ marginTop: 4 }}>
            {imp.kind === 'none' && 'Point at a folder of samples (.wav/.flac/.mp3).'}
            {imp.kind === 'scanning' && 'Scanning folder…'}
            {imp.kind === 'loading' && `Loading samples… ${imp.done}/${imp.total}`}
            {imp.kind === 'ready' &&
              `${imp.name} — ${imp.count} samples${imp.layers > 1 ? `, ${imp.layers} velocity layers` : ''}`}
          </div>

          {imp.kind === 'error' && <div className="recorder-error">{imp.message}</div>}
        </>
      )}
    </div>
  );
}
