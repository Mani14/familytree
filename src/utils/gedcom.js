// GEDCOM 5.5.1 import/export — the interchange format used by Ancestry,
// MyHeritage, FamilySearch, etc. Pure, dependency-light JS (only imports the
// firebase-free familyUtils helpers) so it's import-safe in plain Node for
// testing. It maps this app's data shape (persons keyed by id, each with
// parentIds/childrenIds/spouseId) to/from GEDCOM's INDI (individual) + FAM
// (family) records, deriving families from spouse pairs and shared parent sets.

import { createEmptyPerson, generateId } from './familyUtils.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// "1990-06-14" -> "14 JUN 1990"; "1990-06" -> "JUN 1990"; "1990" -> "1990".
// Anything that isn't a plain ISO(ish) date is passed through unchanged.
function toGedcomDate(d) {
  const t = (d || '').trim();
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(t);
  if (!m) return t;
  const [, y, mo, da] = m;
  if (mo && da) return `${Number(da)} ${MONTHS[Number(mo) - 1]} ${y}`;
  if (mo) return `${MONTHS[Number(mo) - 1]} ${y}`;
  return y;
}

// "14 JUN 1990" -> "1990-06-14"; "JUN 1990" -> "1990-06"; "1990" -> "1990".
// Strips qualifier prefixes (ABT/BEF/AFT/…). Returns '' if unparseable.
function fromGedcomDate(s) {
  let t = (s || '').trim().toUpperCase().replace(/^(ABT|EST|CAL|BEF|AFT|FROM|TO|BET|AND|INT)\s+/g, '').trim();
  let m = /^(\d{1,2})\s+([A-Z]{3,})\s+(\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3));
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  m = /^([A-Z]{3,})\s+(\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3));
    if (mo >= 0) return `${m[2]}-${String(mo + 1).padStart(2, '0')}`;
  }
  m = /^(\d{4})$/.exec(t);
  if (m) return m[1];
  return '';
}

// Picks which of a family's parents is HUSB vs WIFE. Prefers the recorded
// gender; falls back to first/second position when genders are missing or equal.
function assignSpouses(parentIds, persons) {
  const ps = parentIds.filter((pid) => persons[pid]);
  const male = ps.find((pid) => persons[pid].gender === 'male');
  const female = ps.find((pid) => persons[pid].gender === 'female');
  if (male || female) {
    const rest = ps.filter((pid) => pid !== male && pid !== female);
    return { husb: male || rest[0] || null, wife: female || (male ? rest[0] : null) || null };
  }
  return { husb: ps[0] || null, wife: ps[1] || null };
}

const pushMap = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

export function exportGedcom(data) {
  const persons = (data && data.persons) || {};
  const ids = Object.keys(persons);
  const indi = new Map();
  ids.forEach((id, i) => indi.set(id, `I${i + 1}`));

  const famKeyOf = (parentIds) => parentIds.filter(Boolean).slice().sort().join('|');
  const families = new Map(); // key -> { husb, wife, children:[], marriageDate }
  const ensureFamily = (parentIds) => {
    const key = famKeyOf(parentIds);
    if (!key) return null;
    if (!families.has(key)) families.set(key, { ...assignSpouses(parentIds, persons), children: [], marriageDate: '' });
    return families.get(key);
  };

  // Spouse couples (even childless ones) become families.
  const seen = new Set();
  for (const id of ids) {
    const p = persons[id];
    if (p.spouseId && persons[p.spouseId]) {
      const key = famKeyOf([id, p.spouseId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const fam = ensureFamily([id, p.spouseId]);
      if (fam) fam.marriageDate = p.marriageDate || persons[p.spouseId].marriageDate || '';
    }
  }
  // Attach each child to their parents' family.
  for (const id of ids) {
    const parents = (persons[id].parentIds || []).filter((pid) => persons[pid]);
    if (!parents.length) continue;
    const fam = ensureFamily(parents);
    if (fam) fam.children.push(id);
  }

  const famKeys = [...families.keys()];
  const famXref = new Map();
  famKeys.forEach((key, i) => famXref.set(key, `F${i + 1}`));

  const spouseInFams = new Map();
  const childInFams = new Map();
  for (const [key, fam] of families) {
    const fx = famXref.get(key);
    if (fam.husb) pushMap(spouseInFams, fam.husb, fx);
    if (fam.wife) pushMap(spouseInFams, fam.wife, fx);
    for (const c of fam.children) pushMap(childInFams, c, fx);
  }

  const lines = ['0 HEAD', '1 SOUR FamilyTreeApp', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];

  for (const id of ids) {
    const p = persons[id];
    lines.push(`0 @${indi.get(id)}@ INDI`);
    const given = (p.firstName || '').trim();
    const sur = (p.lastName || '').trim();
    lines.push(`1 NAME ${given} /${sur}/`);
    if (given) lines.push(`2 GIVN ${given}`);
    if (sur) lines.push(`2 SURN ${sur}`);
    lines.push(`1 SEX ${p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U'}`);
    if (p.dob) { lines.push('1 BIRT'); lines.push(`2 DATE ${toGedcomDate(p.dob)}`); }
    if (p.isAlive === false || p.dod) {
      if (p.dod) { lines.push('1 DEAT'); lines.push(`2 DATE ${toGedcomDate(p.dod)}`); }
      else lines.push('1 DEAT Y');
    }
    if (p.work) lines.push(`1 OCCU ${oneLine(p.work)}`);
    if (p.location) { lines.push('1 RESI'); lines.push(`2 PLAC ${oneLine(p.location)}`); }
    if (p.notes) lines.push(...noteLines(p.notes));
    for (const fx of childInFams.get(id) || []) lines.push(`1 FAMC @${fx}@`);
    for (const fx of spouseInFams.get(id) || []) lines.push(`1 FAMS @${fx}@`);
  }

  for (const key of famKeys) {
    const fam = families.get(key);
    lines.push(`0 @${famXref.get(key)}@ FAM`);
    if (fam.husb) lines.push(`1 HUSB @${indi.get(fam.husb)}@`);
    if (fam.wife) lines.push(`1 WIFE @${indi.get(fam.wife)}@`);
    for (const c of fam.children) lines.push(`1 CHIL @${indi.get(c)}@`);
    if (fam.marriageDate) { lines.push('1 MARR'); lines.push(`2 DATE ${toGedcomDate(fam.marriageDate)}`); }
  }

  lines.push('0 TRLR');
  return lines.join('\n');
}

const oneLine = (s) => String(s).replace(/\r?\n/g, ' ').trim();

// A NOTE that may span multiple lines is emitted with CONT continuation lines,
// the GEDCOM way to carry embedded newlines (a raw line can't contain one).
function noteLines(text) {
  const parts = String(text).split(/\r?\n/);
  const out = [`1 NOTE ${parts[0]}`];
  for (let i = 1; i < parts.length; i += 1) out.push(`2 CONT ${parts[i]}`);
  return out;
}

const stripAt = (v) => (v || '').replace(/@/g, '').trim();

function applyName(o, value) {
  const m = /^(.*?)\s*\/([^/]*)\/\s*(.*)$/.exec(value);
  if (m) {
    o.firstName = `${m[1]}${m[3] ? ` ${m[3]}` : ''}`.trim();
    o.lastName = m[2].trim();
  } else {
    o.firstName = value.trim();
  }
}

export function parseGedcom(text) {
  const rawLines = String(text).split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '')).filter((l) => l.trim());
  const indi = {}; // xref -> parsed INDI
  const fams = []; // { husb, wife, children[], marr }
  let cur = null; // { type, obj }
  let ctx = null; // active level-1 tag ('BIRT'|'DEAT'|'MARR'|'RESI'|'NAME'|'NOTE')

  for (const raw of rawLines) {
    const m = /^(\d+)\s+(?:@([^@]+)@\s+)?(\S+)(?:\s+(.*))?$/.exec(raw.trim());
    if (!m) continue;
    const level = Number(m[1]);
    const xref = m[2] || null;
    const tag = m[3];
    const value = (m[4] || '').trim();

    if (level === 0) {
      ctx = null;
      if (tag === 'INDI' && xref) {
        indi[xref] = { firstName: '', lastName: '', gender: 'other', dob: '', dod: '', isAlive: true, work: '', location: '', notes: '' };
        cur = { type: 'INDI', obj: indi[xref] };
      } else if (tag === 'FAM' && xref) {
        const f = { husb: null, wife: null, children: [], marr: '' };
        fams.push(f);
        cur = { type: 'FAM', obj: f };
      } else {
        cur = null;
      }
      continue;
    }
    if (!cur) continue;

    if (level === 1) {
      ctx = null;
      if (cur.type === 'INDI') {
        const o = cur.obj;
        if (tag === 'NAME') { applyName(o, value); ctx = 'NAME'; }
        else if (tag === 'SEX') o.gender = value === 'M' ? 'male' : value === 'F' ? 'female' : 'other';
        else if (tag === 'BIRT') ctx = 'BIRT';
        else if (tag === 'DEAT') { o.isAlive = false; ctx = 'DEAT'; }
        else if (tag === 'OCCU') o.work = value;
        else if (tag === 'RESI') ctx = 'RESI';
        else if (tag === 'NOTE') { o.notes = value; ctx = 'NOTE'; }
      } else {
        const f = cur.obj;
        if (tag === 'HUSB') f.husb = stripAt(value);
        else if (tag === 'WIFE') f.wife = stripAt(value);
        else if (tag === 'CHIL') f.children.push(stripAt(value));
        else if (tag === 'MARR') ctx = 'MARR';
      }
      continue;
    }

    if (level >= 2) {
      if (cur.type === 'INDI') {
        const o = cur.obj;
        if (ctx === 'BIRT' && tag === 'DATE') o.dob = fromGedcomDate(value);
        else if (ctx === 'DEAT' && tag === 'DATE') o.dod = fromGedcomDate(value);
        else if (ctx === 'RESI' && tag === 'PLAC') o.location = value;
        else if (ctx === 'NAME' && tag === 'GIVN' && !o.firstName) o.firstName = value;
        else if (ctx === 'NAME' && tag === 'SURN' && !o.lastName) o.lastName = value;
        else if (ctx === 'NOTE' && tag === 'CONT') o.notes += `\n${value}`;
        else if (ctx === 'NOTE' && tag === 'CONC') o.notes += value;
      } else if (ctx === 'MARR' && tag === 'DATE') {
        cur.obj.marr = fromGedcomDate(value);
      }
    }
  }

  const order = Object.keys(indi);
  const persons = {};
  const xrefToId = {};
  for (const xref of order) {
    const id = generateId(persons);
    persons[id] = createEmptyPerson(id);
    xrefToId[xref] = id;
  }
  for (const xref of order) {
    const src = indi[xref];
    const p = persons[xrefToId[xref]];
    p.firstName = src.firstName || 'Unknown';
    p.lastName = src.lastName || 'Unknown';
    p.gender = src.gender || 'other';
    p.dob = src.dob;
    p.dod = src.dod;
    p.isAlive = src.isAlive !== false;
    p.work = src.work;
    p.location = src.location;
    p.notes = src.notes;
  }
  for (const f of fams) {
    const husbId = f.husb && xrefToId[f.husb];
    const wifeId = f.wife && xrefToId[f.wife];
    if (husbId && wifeId && persons[husbId] && persons[wifeId]) {
      persons[husbId].spouseId = wifeId;
      persons[wifeId].spouseId = husbId;
      if (f.marr) { persons[husbId].marriageDate = f.marr; persons[wifeId].marriageDate = f.marr; }
    }
    const parentIds = [husbId, wifeId].filter((pid) => pid && persons[pid]);
    for (const cx of f.children) {
      const cid = xrefToId[cx];
      if (!cid || !persons[cid]) continue;
      persons[cid].parentIds = parentIds.slice();
      for (const pid of parentIds) {
        if (!persons[pid].childrenIds.includes(cid)) persons[pid].childrenIds.push(cid);
      }
    }
  }

  const rootPersonId = order.length ? xrefToId[order[0]] : null;
  return { rootPersonId, persons };
}
