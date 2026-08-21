import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Download, FileImage, FileText, Upload } from 'lucide-react';
import { validateFamilyData } from '../utils/familyUtils';
import { exportGedcom, parseGedcom } from '../utils/gedcom';
import ConfirmDialog from './ConfirmDialog';
import '../styles/ImportExport.css';

export default function ImportExport({ exportData, onImport, onExportImage, onExportPDF, label = 'Data' }) {
  const fileInputRef = useRef(null);
  const gedFileInputRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  // Rendered via a portal (see below), so its position has to be tracked in JS
  // rather than a plain `position: absolute` against its natural parent.
  const [menuPos, setMenuPos] = useState(null);

  // The header's mobile horizontally-scrolling strip (`.app-header-actions`)
  // sets `overflow-x: auto`, which forces the browser to also clip `overflow-y`
  // — silently hiding this menu instead of showing it. Portal it to <body> and
  // position it with fixed coords so no ancestor's scroll/clipping can hide it.
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

  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'family.json';
    link.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const handleImportClick = () => {
    setError('');
    setOpen(false);
    fileInputRef.current?.click();
  };

  const downloadBlob = (contents, filename, type) => {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleGedcomExport = () => {
    downloadBlob(exportGedcom(exportData()), 'family.ged', 'text/plain;charset=utf-8');
    setOpen(false);
  };

  const handleGedcomImportClick = () => {
    setError('');
    setOpen(false);
    gedFileInputRef.current?.click();
  };

  const handleGedFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = parseGedcom(reader.result);
      } catch {
        setError('That file could not be read as GEDCOM.');
        return;
      }
      const { valid, error: validationError } = validateFamilyData(parsed);
      if (!valid) {
        setError(`GEDCOM imported but looks off: ${validationError}`);
        return;
      }
      setPendingImport(parsed);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        setError('That file is not valid JSON.');
        return;
      }
      const { valid, error: validationError } = validateFamilyData(parsed);
      if (!valid) {
        setError(validationError);
        return;
      }
      setPendingImport(parsed);
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    onImport(pendingImport);
    setPendingImport(null);
    setError('');
  };

  return (
    <div className="import-export">
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn import-export-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Import and export options"
        title="Import / export"
      >
        <Download size={17} />
        <span className="btn-label">{label}</span>
        <ChevronDown size={14} className={`import-export-chevron ${open ? 'is-open' : ''}`} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && menuPos && (
          <motion.div
            ref={menuRef}
            className="import-export-menu glass-surface"
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          >
            <button type="button" role="menuitem" onClick={handleExport}>
              <Download size={15} /> Export JSON
            </button>
            <button type="button" role="menuitem" onClick={handleImportClick}>
              <Upload size={15} /> Import JSON
            </button>
            <button type="button" role="menuitem" onClick={handleGedcomExport}>
              <Download size={15} /> Export GEDCOM
            </button>
            <button type="button" role="menuitem" onClick={handleGedcomImportClick}>
              <Upload size={15} /> Import GEDCOM
            </button>
            {onExportImage && (
              <button type="button" role="menuitem" onClick={() => { onExportImage(); setOpen(false); }}>
                <FileImage size={15} /> Export Image
              </button>
            )}
            {onExportPDF && (
              <button type="button" role="menuitem" onClick={() => { onExportPDF(); setOpen(false); }}>
                <FileText size={15} /> Export PDF
              </button>
            )}
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <input
        ref={gedFileInputRef}
        type="file"
        accept=".ged,.gedcom,text/plain"
        onChange={handleGedFileChange}
        style={{ display: 'none' }}
      />
      {error && <span className="import-export-error" title={error}>{error}</span>}

      {pendingImport && (
        <ConfirmDialog
          isOpen
          title="Import this file?"
          message="This replaces the current family tree with the file's contents. It's covered by Undo, but only until the app is closed."
          confirmLabel="Import"
          danger
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}
