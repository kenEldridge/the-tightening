import React from 'react';
import type { EdgeType } from '../core/chordPathfinder';

interface Props {
  chordNames: string[];
  edgeTypes: EdgeType[];
  explanations: string[];
  currentStep: number;
  completed: boolean;
}

const EDGE_TYPE_SHORT: Record<EdgeType, string> = {
  dom7: 'V\u2192I',
  relative: 'rel',
  iiVI: 'ii-V-I',
  leadingTone: 'vii\u00B0',
};

export default function PathStrip({ chordNames, edgeTypes, explanations, currentStep, completed }: Props) {
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
                <span className="path-step-chord">{name}</span>
                {i < currentStep && <span className="path-step-check">{'\u2713'}</span>}
              </div>
              {i < edgeTypes.length && (
                <div className="path-arrow" title={explanations[i]}>
                  <span className="path-arrow-line">{'\u2192'}</span>
                  <span className="path-arrow-label">{EDGE_TYPE_SHORT[edgeTypes[i]]}</span>
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
