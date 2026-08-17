// A representative sample family for every distinct relationship SHAPE the
// Tamil engine (familyUtils.js) computes a term for — powers the "All
// Relationships" reference list in RelationshipRulesPanel. Each entry is its
// own tiny, self-contained synthetic family (deliberately not one shared mega
// -tree — keeping each row's fixture independent means editing one relation
// can't accidentally break another's birth-order/gender wiring), so the
// SAME getRelationshipLabelTamil/getRelationshipSignature calls used for the
// real tree also drive this table — no separate description of "what the
// default is," so it can never drift out of sync with the actual engine.
function P(id, overrides = {}) {
  return { id, gender: 'male', parentIds: [], childrenIds: [], spouseId: null, dob: '', ...overrides };
}

function tiny(pairs) {
  const persons = {};
  pairs.forEach((p) => { persons[p.id] = p; });
  return persons;
}

export const REFERENCE_RELATIONSHIPS = [
  // --- Parents & grandparents ---
  {
    category: 'Parents & Grandparents',
    description: "Father",
    ...(() => {
      const persons = tiny([P('root', { parentIds: ['dad'] }), P('dad', { childrenIds: ['root'] })]);
      return { persons, personId: 'dad', rootId: 'root' };
    })(),
  },
  {
    category: 'Parents & Grandparents',
    description: "Mother",
    ...(() => {
      const persons = tiny([P('root', { parentIds: [undefined, 'mom'] }), P('mom', { gender: 'female', childrenIds: ['root'] })]);
      return { persons, personId: 'mom', rootId: 'root' };
    })(),
  },
  {
    category: 'Parents & Grandparents',
    description: "Father's Father (Grandfather)",
    ...(() => {
      const persons = tiny([
        P('root', { parentIds: ['dad'] }),
        P('dad', { parentIds: ['gf'], childrenIds: ['root'] }),
        P('gf', { childrenIds: ['dad'] }),
      ]);
      return { persons, personId: 'gf', rootId: 'root' };
    })(),
  },
  {
    category: 'Parents & Grandparents',
    description: "Father's Mother (Grandmother)",
    ...(() => {
      const persons = tiny([
        P('root', { parentIds: ['dad'] }),
        P('dad', { parentIds: [undefined, 'gm'], childrenIds: ['root'] }),
        P('gm', { gender: 'female', childrenIds: ['dad'] }),
      ]);
      return { persons, personId: 'gm', rootId: 'root' };
    })(),
  },
  {
    category: 'Parents & Grandparents',
    description: "Great-Grandfather",
    ...(() => {
      const persons = tiny([
        P('root', { parentIds: ['dad'] }),
        P('dad', { parentIds: ['gf'], childrenIds: ['root'] }),
        P('gf', { parentIds: ['ggf'], childrenIds: ['dad'] }),
        P('ggf', { childrenIds: ['gf'] }),
      ]);
      return { persons, personId: 'ggf', rootId: 'root' };
    })(),
  },
  {
    category: 'Parents & Grandparents',
    description: "Great-Grandmother",
    ...(() => {
      const persons = tiny([
        P('root', { parentIds: ['dad'] }),
        P('dad', { parentIds: ['gf'], childrenIds: ['root'] }),
        P('gf', { parentIds: [undefined, 'ggm'], childrenIds: ['dad'] }),
        P('ggm', { gender: 'female', childrenIds: ['gf'] }),
      ]);
      return { persons, personId: 'ggm', rootId: 'root' };
    })(),
  },

  // --- Children & grandchildren ---
  {
    category: 'Children & Grandchildren',
    description: "Son",
    ...(() => {
      const persons = tiny([P('root', { childrenIds: ['child'] }), P('child', { parentIds: ['root'] })]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },
  {
    category: 'Children & Grandchildren',
    description: "Daughter",
    ...(() => {
      const persons = tiny([P('root', { childrenIds: ['child'] }), P('child', { gender: 'female', parentIds: ['root'] })]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },
  {
    category: 'Children & Grandchildren',
    description: "Grandson (Son's Son)",
    ...(() => {
      const persons = tiny([
        P('root', { childrenIds: ['child'] }),
        P('child', { parentIds: ['root'], childrenIds: ['grandchild'] }),
        P('grandchild', { parentIds: ['child'] }),
      ]);
      return { persons, personId: 'grandchild', rootId: 'root' };
    })(),
  },
  {
    category: 'Children & Grandchildren',
    description: "Granddaughter (Son's Daughter)",
    ...(() => {
      const persons = tiny([
        P('root', { childrenIds: ['child'] }),
        P('child', { parentIds: ['root'], childrenIds: ['grandchild'] }),
        P('grandchild', { gender: 'female', parentIds: ['child'] }),
      ]);
      return { persons, personId: 'grandchild', rootId: 'root' };
    })(),
  },
  {
    category: 'Children & Grandchildren',
    description: "Daughter's Husband (Maapillai)",
    ...(() => {
      const persons = tiny([
        P('root', { childrenIds: ['child'] }),
        P('child', { gender: 'female', parentIds: ['root'], spouseId: 'sonInLaw' }),
        P('sonInLaw', { spouseId: 'child' }),
      ]);
      return { persons, personId: 'sonInLaw', rootId: 'root' };
    })(),
  },

  // --- Siblings ---
  {
    category: 'Siblings',
    description: "Elder Brother",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['sibling', 'root'] }),
        P('sibling', { parentIds: ['parent'] }),
        P('root', { parentIds: ['parent'] }),
      ]);
      return { persons, personId: 'sibling', rootId: 'root' };
    })(),
  },
  {
    category: 'Siblings',
    description: "Younger Brother",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('sibling', { parentIds: ['parent'] }),
        P('root', { parentIds: ['parent'] }),
      ]);
      return { persons, personId: 'sibling', rootId: 'root' };
    })(),
  },
  {
    category: 'Siblings',
    description: "Elder Sister",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['sibling', 'root'] }),
        P('sibling', { gender: 'female', parentIds: ['parent'] }),
        P('root', { parentIds: ['parent'] }),
      ]);
      return { persons, personId: 'sibling', rootId: 'root' };
    })(),
  },
  {
    category: 'Siblings',
    description: "Younger Sister",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('sibling', { gender: 'female', parentIds: ['parent'] }),
        P('root', { parentIds: ['parent'] }),
      ]);
      return { persons, personId: 'sibling', rootId: 'root' };
    })(),
  },

  // --- Uncles & Aunts ---
  {
    category: 'Uncles & Aunts',
    description: "Father's Elder Brother (Periyappa)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['uncle', 'dad'] }),
        P('uncle', { parentIds: ['gp'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
      ]);
      return { persons, personId: 'uncle', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Father's Elder Brother's Wife (Periyamma)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['uncle', 'dad'] }),
        P('uncle', { parentIds: ['gp'], spouseId: 'uncleWife' }),
        P('uncleWife', { gender: 'female', spouseId: 'uncle' }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
      ]);
      return { persons, personId: 'uncleWife', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Father's Younger Brother (Chithappa)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['dad', 'uncle'] }),
        P('uncle', { parentIds: ['gp'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
      ]);
      return { persons, personId: 'uncle', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Father's Sister (Athai)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['dad', 'aunt'] }),
        P('aunt', { gender: 'female', parentIds: ['gp'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
      ]);
      return { persons, personId: 'aunt', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Mother's Elder Sister (Periyamma)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['aunt', 'mom'] }),
        P('aunt', { gender: 'female', parentIds: ['gp'] }),
        P('mom', { gender: 'female', parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: [undefined, 'mom'] }),
      ]);
      return { persons, personId: 'aunt', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Mother's Younger Sister (Chithi)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['mom', 'aunt'] }),
        P('aunt', { gender: 'female', parentIds: ['gp'] }),
        P('mom', { gender: 'female', parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: [undefined, 'mom'] }),
      ]);
      return { persons, personId: 'aunt', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Mother's Brother (Thai Mama)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['mom', 'uncle'] }),
        P('uncle', { parentIds: ['gp'] }),
        P('mom', { gender: 'female', parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: [undefined, 'mom'] }),
      ]);
      return { persons, personId: 'uncle', rootId: 'root' };
    })(),
  },
  {
    category: 'Uncles & Aunts',
    description: "Mother's Brother's Wife (Athai)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['mom', 'uncle'] }),
        P('uncle', { parentIds: ['gp'], spouseId: 'uncleWife' }),
        P('uncleWife', { gender: 'female', spouseId: 'uncle' }),
        P('mom', { gender: 'female', parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: [undefined, 'mom'] }),
      ]);
      return { persons, personId: 'uncleWife', rootId: 'root' };
    })(),
  },

  // --- Nephews & Nieces ---
  {
    category: 'Nephews & Nieces',
    description: "Brother's Son (own-line)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { parentIds: ['parent'], childrenIds: ['child'] }),
        P('child', { parentIds: ['sibling'] }),
      ]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },
  {
    category: 'Nephews & Nieces',
    description: "Brother's Daughter (own-line)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { parentIds: ['parent'], childrenIds: ['child'] }),
        P('child', { gender: 'female', parentIds: ['sibling'] }),
      ]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },
  {
    category: 'Nephews & Nieces',
    description: "Sister's Son (cross-line)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { gender: 'female', parentIds: ['parent'], childrenIds: ['child'] }),
        P('child', { parentIds: ['sibling'] }),
      ]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },
  {
    category: 'Nephews & Nieces',
    description: "Sister's Daughter (cross-line)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['root', 'sibling'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { gender: 'female', parentIds: ['parent'], childrenIds: ['child'] }),
        P('child', { gender: 'female', parentIds: ['sibling'] }),
      ]);
      return { persons, personId: 'child', rootId: 'root' };
    })(),
  },

  // --- Cousins ---
  {
    category: 'Cousins',
    description: "Father's Elder Brother's Child (parallel, elder → Anna)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['uncle', 'dad'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
        P('uncle', { parentIds: ['gp'], childrenIds: ['cousin'] }),
        P('cousin', { parentIds: ['uncle'] }),
      ]);
      return { persons, personId: 'cousin', rootId: 'root' };
    })(),
  },
  {
    category: 'Cousins',
    description: "Father's Younger Brother's Child (parallel, younger → Thambi)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['dad', 'uncle'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
        P('uncle', { parentIds: ['gp'], childrenIds: ['cousin'] }),
        P('cousin', { parentIds: ['uncle'] }),
      ]);
      return { persons, personId: 'cousin', rootId: 'root' };
    })(),
  },
  {
    category: 'Cousins',
    description: "Father's Sister's Child (cross cousin)",
    ...(() => {
      const persons = tiny([
        P('gp', { childrenIds: ['dad', 'aunt'] }),
        P('dad', { parentIds: ['gp'], childrenIds: ['root'] }),
        P('root', { parentIds: ['dad'] }),
        P('aunt', { gender: 'female', parentIds: ['gp'], childrenIds: ['cousin'] }),
        P('cousin', { parentIds: ['aunt'] }),
      ]);
      return { persons, personId: 'cousin', rootId: 'root' };
    })(),
  },

  // --- In-laws ---
  {
    category: 'In-laws',
    description: "Wife's Father (Father-in-law)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['fil'] }),
        P('fil', { childrenIds: ['wife'] }),
      ]);
      return { persons, personId: 'fil', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Mother (Mother-in-law)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: [undefined, 'mil'] }),
        P('mil', { gender: 'female', childrenIds: ['wife'] }),
      ]);
      return { persons, personId: 'mil', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Elder Brother's Wife (Anni)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['sibling', 'root'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { parentIds: ['parent'], spouseId: 'siblingWife' }),
        P('siblingWife', { gender: 'female', spouseId: 'sibling' }),
      ]);
      return { persons, personId: 'siblingWife', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Elder Sister's Husband (Mama)",
    ...(() => {
      const persons = tiny([
        P('parent', { childrenIds: ['sibling', 'root'] }),
        P('root', { parentIds: ['parent'] }),
        P('sibling', { gender: 'female', parentIds: ['parent'], spouseId: 'siblingHusband' }),
        P('siblingHusband', { spouseId: 'sibling' }),
      ]);
      return { persons, personId: 'siblingHusband', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Elder Brother (Machinan)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('gp2', { childrenIds: ['wifeBro', 'wife'] }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['gp2'] }),
        P('wifeBro', { parentIds: ['gp2'] }),
      ]);
      return { persons, personId: 'wifeBro', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Younger Brother (Machaan)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('gp2', { childrenIds: ['wife', 'wifeBro'] }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['gp2'] }),
        P('wifeBro', { parentIds: ['gp2'] }),
      ]);
      return { persons, personId: 'wifeBro', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Elder Sister (Anni)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('gp3', { childrenIds: ['wifeSis', 'wife'] }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['gp3'] }),
        P('wifeSis', { gender: 'female', parentIds: ['gp3'] }),
      ]);
      return { persons, personId: 'wifeSis', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Elder Sister's Husband (Annan)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('gp3', { childrenIds: ['wifeSis', 'wife'] }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['gp3'] }),
        P('wifeSis', { gender: 'female', parentIds: ['gp3'], spouseId: 'wifeSisHusband' }),
        P('wifeSisHusband', { spouseId: 'wifeSis' }),
      ]);
      return { persons, personId: 'wifeSisHusband', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Wife's Younger Sister (Kozhundhi)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'wife' }),
        P('gp4', { childrenIds: ['wife', 'wifeSis'] }),
        P('wife', { gender: 'female', spouseId: 'root', parentIds: ['gp4'] }),
        P('wifeSis', { gender: 'female', parentIds: ['gp4'] }),
      ]);
      return { persons, personId: 'wifeSis', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Husband's Younger Brother (Kozhundhan) — for a wife",
    ...(() => {
      const persons = tiny([
        P('root', { gender: 'female', spouseId: 'husband' }),
        P('gp5', { childrenIds: ['husband', 'husbandBro'] }),
        P('husband', { spouseId: 'root', parentIds: ['gp5'] }),
        P('husbandBro', { parentIds: ['gp5'] }),
      ]);
      return { persons, personId: 'husbandBro', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Husband's Sister (Nathanaar) — for a wife",
    ...(() => {
      const persons = tiny([
        P('root', { gender: 'female', spouseId: 'husband' }),
        P('gp6', { childrenIds: ['husband', 'husbandSis'] }),
        P('husband', { spouseId: 'root', parentIds: ['gp6'] }),
        P('husbandSis', { gender: 'female', parentIds: ['gp6'] }),
      ]);
      return { persons, personId: 'husbandSis', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Two men married to sisters (Orambadi/Sagalai)",
    ...(() => {
      const persons = tiny([
        P('root', { spouseId: 'rootWife' }),
        P('gp7', { childrenIds: ['rootWife', 'otherWife'] }),
        P('rootWife', { gender: 'female', spouseId: 'root', parentIds: ['gp7'] }),
        P('otherWife', { gender: 'female', spouseId: 'other', parentIds: ['gp7'] }),
        P('other', { spouseId: 'otherWife' }),
      ]);
      return { persons, personId: 'other', rootId: 'root' };
    })(),
  },
  {
    category: 'In-laws',
    description: "Your child's spouse's parent (Sambandhi)",
    ...(() => {
      const persons = tiny([
        P('root', { childrenIds: ['rChild'] }),
        P('rChild', { parentIds: ['root'], spouseId: 'pChild' }),
        P('other', { childrenIds: ['pChild'] }),
        P('pChild', { gender: 'female', parentIds: ['other'], spouseId: 'rChild' }),
      ]);
      return { persons, personId: 'other', rootId: 'root' };
    })(),
  },
];
