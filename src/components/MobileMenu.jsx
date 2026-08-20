import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, GitBranch, LogOut, Map, MessageCircleQuestion, Menu, ShieldAlert } from 'lucide-react';
import ImportExport from './ImportExport';
import '../styles/MobileMenu.css';

// Mobile-only (<=640px, see App.css) stand-in for the header's Stats/Data
// Health/Pedigree View/Data/Sign Out buttons, which don't all fit as individual
// icon buttons on a phone-width header — folded into one hamburger dropdown
// instead. Desktop keeps the original individual buttons untouched; this and
// they're simply hidden/shown via CSS at the same breakpoint, never both at once.
// Portal + fixed positioning for the same reason as ImportExport's own dropdown:
// an ancestor with `overflow-x: auto` would otherwise clip it.
export default function MobileMenu({
  viewMode,
  onToggleViewMode,
  onOpenStats,
  onOpenFeatures,
  onOpenFamilyMap,
  onOpenAsk,
  onOpenAdmin,
  isAdmin,
  familyMapEnabled = true,
  onSignOut,
  userEmail,
  userPicture,
  exportData,
  onImport,
  onExportImage,
  onExportPDF,
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="mobile-menu">
      {userPicture && <img className="mobile-menu-avatar" src={userPicture} alt="" title={userEmail} />}
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn mobile-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        title="More options"
      >
        <Menu size={18} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && menuPos && (
            <motion.div
              ref={menuRef}
              className="mobile-menu-panel glass-surface"
              role="menu"
              style={{ top: menuPos.top, right: menuPos.right }}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
            >
              {familyMapEnabled && (
                <button type="button" role="menuitem" onClick={() => { onOpenFamilyMap(); close(); }}>
                  <Map size={15} /> Family Map
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { onOpenStats(); close(); }}>
                <Menu size={15} /> Full Stats
              </button>
              <button type="button" role="menuitem" onClick={() => { onOpenAsk(); close(); }}>
                <MessageCircleQuestion size={15} /> Ask About the Family
              </button>
              <div className="mobile-menu-nested" role="menuitem">
                <ImportExport
                  exportData={exportData}
                  onImport={onImport}
                  onExportImage={onExportImage}
                  onExportPDF={onExportPDF}
                  label="Download"
                />
              </div>
              <button type="button" role="menuitem" onClick={() => { onToggleViewMode(); close(); }}>
                <GitBranch size={15} /> {viewMode === 'forest' ? 'Lineage View' : 'Full Tree View'}
              </button>
              <button type="button" role="menuitem" onClick={() => { onOpenFeatures(); close(); }}>
                <Compass size={15} /> Demo
              </button>
              {isAdmin && (
                <button type="button" role="menuitem" onClick={() => { onOpenAdmin(); close(); }}>
                  <ShieldAlert size={15} /> Admin Settings
                </button>
              )}
              <button type="button" role="menuitem" className="mobile-menu-signout" onClick={() => { onSignOut(); close(); }}>
                <LogOut size={15} /> Sign Out
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
