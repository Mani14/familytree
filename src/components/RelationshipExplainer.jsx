import { useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import {
  getFullName,
  getRelationshipLabel,
  getRelationshipLabelTamil,
  getRelationshipPath,
} from '../utils/familyUtils';
import Modal from './Modal';
import '../styles/RelationshipExplainer.css';

// Explains WHY a computed term is what it is, by walking the shortest blood/
// marriage path from the anchor to the person and labelling each single hop
// with the engine's own term — so the chain is always self-consistent with the
// overall label shown on the card (both come from the same functions).
export default function RelationshipExplainer({ persons, fromId, toId, anchorName, overrides = [], isOpen, onClose }) {
  const { steps, overallTa, overallEn } = useMemo(() => {
    if (!isOpen || !fromId || !toId) return { steps: [], overallTa: null, overallEn: null };
    const path = getRelationshipPath(persons, fromId, toId) || [];
    const built = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const cur = path[i];
      const nxt = path[i + 1];
      built.push({
        id: nxt,
        name: getFullName(persons[nxt]),
        ofName: getFullName(persons[cur]),
        ta: getRelationshipLabelTamil(persons, nxt, cur, overrides),
        en: getRelationshipLabel(persons, nxt, cur),
      });
    }
    return {
      steps: built,
      overallTa: getRelationshipLabelTamil(persons, toId, fromId, overrides),
      overallEn: getRelationshipLabel(persons, toId, fromId),
    };
  }, [isOpen, persons, fromId, toId, overrides]);

  const targetName = toId ? getFullName(persons[toId]) : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="How you're related" width="420px" className="rel-explainer">
      <h2>How you're related</h2>

      {(overallTa || overallEn) && (
        <p className="rel-explainer-summary">
          {targetName} is {anchorName ? `${anchorName}'s` : 'your'}{' '}
          <strong>{[overallTa, overallEn].filter(Boolean).join(' · ')}</strong>.
        </p>
      )}

      <ol className="rel-explainer-steps">
        <li className="rel-explainer-anchor">{anchorName || getFullName(persons[fromId])}</li>
        {steps.map((s, i) => (
          <li key={`${s.id}-${i}`}>
            <ArrowDown size={13} className="rel-explainer-arrow" aria-hidden="true" />
            <span className="rel-explainer-name">{s.name}</span>
            <span className="rel-explainer-rel">
              {[s.ta, s.en].filter(Boolean).join(' · ')} of {s.ofName}
            </span>
          </li>
        ))}
      </ol>

      <p className="rel-explainer-note">
        Each step is one direct link; the final term above is computed from the whole chain using Tamil
        (Dravidian) kinship rules — which is why a distant relative can still be an அண்ணன் or மச்சான்.
      </p>
    </Modal>
  );
}
