import React from 'react';
import type { EdgeType } from '../core/chordPathfinder';
import { respellChordName } from '../core/chordDefinitions';
import type { NoteSpelling } from '../core/chordDefinitions';
import { edgeTypeColor, edgeTypeShortLabel } from '../core/edgeTypeStyles';

interface Props {
  chordNames: string[];
  edgeTypes: EdgeType[];
  explanations: string[];
  currentStep: number;
  completed: boolean;
  noteSpelling?: NoteSpelling;
}

export default function PathStrip({ chordNames, edgeTypes, explanations, currentStep, completed, noteSpelling = 'sharps' }: Props) {
  if (chordNames.length === 0) return null;

  return (
    <div className="path-strip">
      <div className="path-strip-label">Path ({chordNames.length - 1} step{chordNames.length - 1 !== 1 ? 's' : ''})</div>
      <div className="path-strip-steps">
        {chordNames.map((name, i) => {
          let stepClass = 'path-step';
          if (i < currentStep) stepClass += ' path-step-done';
          else if (i === currentStep) stepClass += ' path-step-active';

          return (
            <React.Fragment key={i}>
              <div className={stepClass}>
                <span className="path-step-num">{i + 1}</span>
                <span className="path-step-chord">{respellChordName(name, noteSpelling)}</span>
                {i < currentStep && <span className="path-step-check">{'✓'}</span>}
              </div>
              {i < edgeTypes.length && (
                <div className="path-arrow" title={explanations[i]} style={{ color: edgeTypeColor(edgeTypes[i]) }}>
                  <span className="path-arrow-line">{'→'}</span>
                  <span className="path-arrow-label">{edgeTypeShortLabel(edgeTypes[i])}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {completed && (
        <div className="path-complete">Path complete!</div>
      )}
    </div>
  );
}
