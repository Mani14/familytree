import {
  ArrowUpDown,
  BadgeCheck,
  Crown,
  Download,
  GitBranch,
  Languages,
  Link2,
  LocateFixed,
  Map,
  MapPin,
  MessageCircleQuestion,
  Moon,
  Pencil,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Undo2,
  UserPlus,
} from 'lucide-react';
import Modal from './Modal';
import '../styles/FeatureShowcase.css';

// A static reference of what the app can do, grouped the way a new user would
// actually think about it (explore, understand relationships, edit, insights,
// data) — deliberately NOT a live/scripted demo, so it stays accurate regardless
// of what's actually in the family data, and never breaks if a specific person
// it might have referenced gets edited or removed.
const SECTIONS = [
  {
    title: 'Explore the tree',
    items: [
      { icon: GitBranch, title: 'Full Tree & Lineage View', text: "See every family side by side, or one person's whole father-side and mother-side lineage." },
      { icon: Map, title: 'Pan, zoom & MiniMap', text: 'Pinch/drag/wheel to navigate, with a MiniMap overview for jumping around a large tree.' },
      { icon: Search, title: 'Search', text: 'Jump straight to anyone by name.' },
      { icon: MapPin, title: 'Family Map', text: "See everyone's pinned locations on a real map, current or native place." },
    ],
  },
  {
    title: 'Understand relationships',
    items: [
      { icon: Languages, title: 'English + Tamil kinship terms', text: 'Periyappa, Chithi, Machaan and more, shown alongside the English term, relative to you or anyone else.' },
      { icon: Route, title: 'Find Connection', text: 'Pick any two people and watch an animated path trace exactly how they’re related, naming each stop along the way.' },
      { icon: Sparkles, title: 'Highlight Lineage', text: "Trace someone's full ancestor chain back to the root." },
      { icon: MessageCircleQuestion, title: 'Ask About the Family', text: 'Ask in plain English — "How is X related to Y?" or "Who are X\'s cousins?" — and get an instant answer computed from the tree.' },
      { icon: Pencil, title: 'Relationship Rules', text: 'Spot a wrong Tamil term? Correct it once and it applies everywhere that same relationship shape occurs.' },
    ],
  },
  {
    title: 'Build the tree',
    items: [
      { icon: UserPlus, title: 'Add relatives', text: "Add a parent, spouse, child, or sibling from any person's card." },
      { icon: ArrowUpDown, title: 'Reorder children', text: 'Drag-and-drop, or use arrows, to set birth order among siblings.' },
      { icon: Link2, title: 'Link Existing', text: "Attach someone already in the tree instead of creating a duplicate — or jump to a married-in person's own family." },
    ],
  },
  {
    title: 'You, in the tree',
    items: [
      { icon: BadgeCheck, title: 'Add Me', text: 'Link your account to yourself — or add yourself as a brand-new person — in a guided wizard.' },
      { icon: LocateFixed, title: 'Locate Me', text: 'Centre the view on yourself at any time.' },
      { icon: Crown, title: 'Set as Root', text: 'Re-centre relationship labels and Lineage View around anyone.' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { icon: Sparkles, title: 'Family Statistics', text: 'Member counts, generations, married couples, upcoming birthdays & anniversaries.' },
      { icon: ShieldCheck, title: 'Data Health', text: 'Flags broken or inconsistent relationships to fix.' },
    ],
  },
  {
    title: 'Manage your data',
    items: [
      { icon: Download, title: 'Import / Export', text: 'Back up or restore as JSON, or export the whole tree as an Image or PDF.' },
      { icon: Undo2, title: 'Undo / Redo', text: 'Up to 50 steps of history for every edit.' },
      { icon: Moon, title: 'Dark mode', text: 'Switch themes any time from the header.' },
    ],
  },
];

export default function FeatureShowcase({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="What This App Can Do" width={520} className="feature-showcase">
      <h2>What This App Can Do</h2>
      <div className="feature-showcase-sections">
        {SECTIONS.map((section) => (
          <div key={section.title} className="feature-showcase-section">
            <span className="feature-showcase-section-title">{section.title}</span>
            <div className="feature-showcase-items">
              {section.items.map(({ icon: Icon, title, text }) => (
                <div key={title} className="feature-showcase-item">
                  <span className="feature-showcase-item-icon">
                    <Icon size={16} />
                  </span>
                  <div>
                    <span className="feature-showcase-item-title">{title}</span>
                    <p className="feature-showcase-item-text">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
