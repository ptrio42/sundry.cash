/**
 * Keyword-based auto-categorization.
 *
 * Shared by the Excel importer and the receipt scanner so a single keyword list
 * (Polish + English stores and terms) drives category guessing everywhere.
 */

import { ExpenseCategory } from '../types/expense.types';

/**
 * Keyword mapping for auto-categorization
 * Maps keywords (case-insensitive) to expense categories.
 *
 * This map stays in code even though categories are now rows: it is our
 * heuristic, not user data. Every slug it can emit is a *built-in* category,
 * which is precisely why built-ins cannot be deleted — otherwise this could
 * hand the model layer a category that no longer exists.
 */
export const CATEGORY_KEYWORDS: Record<ExpenseCategory, string[]> = {
  groceries: [
    // English
    'grocery', 'groceries', 'food', 'supermarket', 'market', 'shop',
    // Polish stores and keywords
    'lidl', 'biedronka', 'kaufland', 'carrefour', 'auchan', 'tesco', 'żabka',
    'spożywcze', 'spożywczy', 'jedzenie', 'zakupy', 'mięso', 'jabłka',
    // General food
    'restaurant', 'cafe', 'pizza', 'burger', 'lunch', 'dinner', 'breakfast'
  ],
  transport: [
    // English ('gas' intentionally lives under utilities so gas *bills* aren't
    // miscategorized as transport; use fuel/petrol/diesel for vehicles)
    'transport', 'fuel', 'petrol', 'diesel', 'parking', 'toll', 'car',
    'uber', 'taxi', 'bus', 'train', 'metro', 'subway', 'flight', 'ticket',
    // Polish
    'paliwo', 'benzyna', 'olej', 'parkowanie', 'bp', 'orlen', 'shell', 'lotos',
    'uber', 'bolt', 'taxi', 'bilet', 'pkp', 'kolej'
  ],
  media: [
    // English
    'media', 'netflix', 'spotify', 'internet', 'phone', 'mobile', 'cable',
    'subscription', 'streaming', 'tv', 'hbo', 'disney', 'amazon prime',
    // Polish
    'netflix', 'spotify', 'internet', 'telefon', 'komórka', 'abonament',
    'play', 'orange', 'plus', 't-mobile', 'multimedia'
  ],
  entertainment: [
    // English
    'entertainment', 'movie', 'cinema', 'theater', 'concert', 'game', 'sport',
    'gym', 'fitness', 'recreation', 'hobby', 'fun', 'club', 'bar', 'pub',
    // Polish
    'rozrywka', 'kino', 'teatr', 'koncert', 'gra', 'sport', 'multisport',
    'siłownia', 'fitness', 'rekreacja', 'zabawa', 'klub', 'basen'
  ],
  utilities: [
    // English
    'utilities', 'utility', 'electric', 'electricity', 'water', 'gas', 'heating',
    'power', 'energy', 'bill', 'bills', 'sewage', 'trash', 'garbage', 'waste',
    // Polish
    'media', 'prąd', 'energia', 'elektryczność', 'woda', 'gaz', 'ogrzewanie',
    'ciepło', 'ścieki', 'śmieci', 'odpad', 'rachunek', 'opłaty', 'czynsz administracyjny',
    'tauron', 'pge', 'enea', 'energa', 'pgnig'
  ],
  maintenance: [
    // English
    'maintenance', 'repair', 'repairs', 'fix', 'fixing', 'broken', 'paint', 'painting',
    'plumber', 'plumbing', 'electrician', 'carpenter', 'handyman', 'renovation',
    'home improvement', 'diy', 'hardware', 'tools', 'materials', 'construction',
    // Polish
    'naprawa', 'naprawy', 'remont', 'renowacja', 'malowanie', 'malarz', 'hydraulik',
    'elektryk', 'stolarz', 'ślusarz', 'majsterkowanie', 'modernizacja', 'budowa',
    'castorama', 'leroy', 'leroy merlin', 'obi', 'narzędzia', 'materiały'
  ],
  other: [
    // English
    'other', 'misc', 'miscellaneous', 'health', 'medical', 'doctor', 'pharmacy',
    'clothes', 'clothing', 'fashion', 'shoes', 'insurance', 'rent', 'mortgage',
    'installment',
    // Polish
    'inne', 'różne', 'zdrowie', 'lekarz', 'apteka', 'lek', 'wizyta',
    'ubrania', 'odzież', 'buty', 'moda', 'ubezpieczenie', 'czynsz',
    'rata', 'allegro', 'olx'
  ]
};

/**
 * Auto-categorize based on description keywords.
 *
 * Uses whole-word / whole-phrase matching (not raw substring `includes`) so that
 * 'car' no longer matches "scarf", 'bar' no longer matches "barber", and the
 * Polish 'gra' (game) no longer matches "photography". The description is
 * tokenized on any non-letter/digit boundary (Unicode-aware, so Polish
 * diacritics survive), then keywords are matched against the space-padded token
 * stream.
 */
export function autoCategorizeByKeywords(description: string): ExpenseCategory {
  const tokens = description.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const haystack = ` ${tokens.join(' ')} `;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      // Space-pad the keyword so single words and multi-word phrases
      // ("amazon prime", "leroy merlin") both match on word boundaries.
      if (haystack.includes(` ${keyword.toLowerCase()} `)) {
        return category as ExpenseCategory;
      }
    }
  }

  // Default to 'other' if no match
  return 'other';
}
