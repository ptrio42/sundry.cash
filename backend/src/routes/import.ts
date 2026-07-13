/**
 * Import routes for Excel file uploads
 * Handles preview and confirmation of expense imports
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { Currency, ExpenseCategory } from '../types/expense.types';
import * as ExpenseModel from '../models/expense';

const router = Router();

/**
 * Keyword mapping for auto-categorization
 * Maps keywords (case-insensitive) to expense categories
 */
const CATEGORY_KEYWORDS: Record<ExpenseCategory, string[]> = {
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

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept Excel and ODS files
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/vnd.oasis.opendocument.spreadsheet' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls') ||
      file.originalname.endsWith('.ods')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and ODS (.ods) files are allowed'));
    }
  },
});

/**
 * Preprocess data to handle merged cells
 * - Detects and fixes column shifts caused by merged cells
 * - Forward-fills values in merged cells
 * - Skips title rows (rows with mostly empty cells)
 */
function preprocessData(data: any[][], merges?: any[]): { headers: any[]; data: any[][] } {
  if (data.length === 0) return { headers: [], data: [] };

  // Find the header row (first row with multiple non-empty values)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const nonEmptyCells = data[i].filter((cell: any) => cell !== null && cell !== undefined && cell !== '');
    if (nonEmptyCells.length >= 3) {
      headerRowIndex = i;
      break;
    }
  }

  const headers = data[headerRowIndex];
  const dataRows = data.slice(headerRowIndex + 1);

  // Create a map of merged cell ranges
  const mergeMap: Map<string, { startRow: number; endRow: number; startCol: number; endCol: number }> = new Map();
  const verticalMerges: Array<{ startRow: number; endRow: number; col: number }> = [];

  if (merges) {
    merges.forEach((merge: any) => {
      const { s, e } = merge; // s = start, e = end

      // Track vertical merges (multiple rows, same column)
      if (e.r > s.r && e.c === s.c) {
        verticalMerges.push({
          startRow: s.r,
          endRow: e.r,
          col: s.c
        });
      }

      for (let r = s.r; r <= e.r; r++) {
        for (let c = s.c; c <= e.c; c++) {
          mergeMap.set(`${r},${c}`, { startRow: s.r, endRow: e.r, startCol: s.c, endCol: e.c });
        }
      }
    });
  }

  // Process data rows to fix column shifts and forward-fill merged cells
  const processedRows: any[][] = [];
  const columnValues: Map<number, any> = new Map(); // Track last value for each column

  dataRows.forEach((row, rowIndex) => {
    const actualRowIndex = headerRowIndex + 1 + rowIndex; // Actual row index in original data
    const finalRow: any[] = [];

    // Process each column in the expected header order
    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const mergeInfo = mergeMap.get(`${actualRowIndex},${colIndex}`);

      if (mergeInfo) {
        // This cell is part of a merge
        if (actualRowIndex === mergeInfo.startRow) {
          // First row of merge - get value from row and store it
          const cell = row[colIndex];
          if (cell !== null && cell !== undefined && cell !== '') {
            columnValues.set(colIndex, cell);
            finalRow.push(cell);
          } else {
            finalRow.push(cell);
          }
        } else {
          // Subsequent rows of merge - use stored value
          // The xlsx library omits this column, so data has shifted left
          const storedValue = columnValues.get(colIndex);
          finalRow.push(storedValue !== undefined ? storedValue : null);
        }
      } else {
        // Not part of a merge - get value from row
        // Account for the shift: if previous columns were merged, the data index is different
        let dataIndex = colIndex;

        // Count how many columns before this one are currently in a merge (and thus omitted from row data)
        let omittedColumns = 0;
        for (let c = 0; c < colIndex; c++) {
          const priorMergeInfo = mergeMap.get(`${actualRowIndex},${c}`);
          if (priorMergeInfo && actualRowIndex > priorMergeInfo.startRow) {
            omittedColumns++;
          }
        }
        dataIndex = colIndex - omittedColumns;

        const cell = row[dataIndex];
        if (cell !== null && cell !== undefined && cell !== '') {
          columnValues.set(colIndex, cell);
        }
        finalRow.push(cell !== undefined ? cell : null);
      }
    }

    processedRows.push(finalRow);
  });

  return { headers, data: processedRows };
}

/**
 * POST /api/import/preview
 * Upload Excel file and get preview of first 5-10 rows
 */
router.post('/preview', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Parse Excel file from buffer
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });

    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Get merge information
    const merges = sheet['!merges'];

    // Convert to JSON with header row
    const rawData: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (rawData.length === 0) {
      res.status(400).json({ error: 'Excel file is empty' });
      return;
    }

    // Preprocess to handle merged cells
    const { headers, data } = preprocessData(rawData, merges);

    if (data.length === 0) {
      res.status(400).json({ error: 'No data rows found in Excel file' });
      return;
    }

    // Get preview rows (up to 10 rows)
    const previewRows = data.slice(0, 10);

    res.json({
      columns: headers,
      preview: previewRows,
      totalRows: data.length,
    });
  } catch (error) {
    console.error('Error parsing Excel file:', error);
    res.status(500).json({
      error: 'Failed to parse Excel file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/import/confirm
 * Process full import with column mapping and currency
 */
router.post('/confirm', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Parse request body
    const { dateColumn, amountColumn, descriptionColumn, currency, categoryColumn } = req.body;

    // Validate required fields
    if (!dateColumn || !amountColumn || !descriptionColumn || !currency) {
      res.status(400).json({
        error: 'Missing required fields',
        details: 'dateColumn, amountColumn, descriptionColumn, and currency are required'
      });
      return;
    }

    // Validate currency (must stay in sync with VALID_CURRENCIES in middleware/validation.ts)
    const validCurrencies: Currency[] = ['USD', 'PLN', 'BTC'];
    if (!validCurrencies.includes(currency as Currency)) {
      res.status(400).json({
        error: 'Invalid currency',
        details: `Currency must be one of: ${validCurrencies.join(', ')}`
      });
      return;
    }

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Get merge information
    const merges = sheet['!merges'];

    // Convert to JSON
    const rawData: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (rawData.length < 2) {
      res.status(400).json({ error: 'Excel file must have at least a header row and one data row' });
      return;
    }

    // Preprocess to handle merged cells
    const preprocessed = preprocessData(rawData, merges);
    const headers = preprocessed.headers as string[];
    const data = preprocessed.data;
    const dateIndex = parseInt(dateColumn);
    const amountIndex = parseInt(amountColumn);
    const descriptionIndex = parseInt(descriptionColumn);
    const categoryIndex = categoryColumn ? parseInt(categoryColumn) : null;

    // Validate column indices
    if (
      isNaN(dateIndex) || isNaN(amountIndex) || isNaN(descriptionIndex) ||
      dateIndex < 0 || amountIndex < 0 || descriptionIndex < 0 ||
      dateIndex >= headers.length || amountIndex >= headers.length || descriptionIndex >= headers.length
    ) {
      res.status(400).json({ error: 'Invalid column indices' });
      return;
    }

    // Process rows
    const results = {
      total: 0,       // real data rows we attempted to import
      success: 0,
      failed: 0,
      skipped: 0,     // empty/summary rows ignored on purpose (reported separately)
      errors: [] as Array<{ row: number; error: string; data: any }>,
    };

    // Process all data rows
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      const dateValue = row[dateIndex];
      const amountValue = row[amountIndex];
      const descriptionValue = row[descriptionIndex];

      const hasAmount = amountValue !== null && amountValue !== undefined && String(amountValue).trim() !== '';
      const description = String(descriptionValue ?? '').trim();

      // A row with neither an amount nor a description is an empty/summary row.
      // Skip it silently, but count it separately so nothing vanishes unexplained.
      if (!hasAmount && description.length === 0) {
        results.skipped++;
        continue;
      }

      // A real data row: count it, then validate. Invalid rows are reported as
      // errors rather than being silently dropped.
      results.total++;
      const amount = parseFloat(String(amountValue ?? '').replace(/[^0-9.-]/g, ''));

      try {
        if (isNaN(amount) || amount <= 0) {
          throw new Error('Amount must be a positive number');
        }
        if (description.length === 0) {
          throw new Error('Description is required');
        }

        const categoryValue = categoryIndex !== null ? row[categoryIndex] : null;

        // Parse date (handle various formats)
        let dateStr: string;
        if (typeof dateValue === 'number') {
          // Excel date serial number
          const excelDate = xlsx.SSF.parse_date_code(dateValue);
          dateStr = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
        } else if (typeof dateValue === 'string') {
          // Try to parse string date in various formats
          let parsedDate: Date | null = null;

          // Try DD-MM-YYYY format (e.g., "16-10-2025")
          const ddmmyyyyMatch = dateValue.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
          if (ddmmyyyyMatch) {
            const [, day, month, year] = ddmmyyyyMatch;
            parsedDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
          }

          // Try DD/MM/YYYY format (e.g., "16/10/2025")
          if (!parsedDate || isNaN(parsedDate.getTime())) {
            const ddmmyyyySlashMatch = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (ddmmyyyySlashMatch) {
              const [, day, month, year] = ddmmyyyySlashMatch;
              parsedDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
            }
            // Try DD.MM.YY and DD.MM.YYYY formats (e.g., "16.10.25", "16.10.2025")
            const ddmmyyDotMatch = dateValue.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
            if (ddmmyyDotMatch) {
              const [, day, month, year] = ddmmyyDotMatch;
              // Handle 2-digit years: assume 20XX for values 00-99
              const fullYear = year.length === 2 ? `20${year}` : year;
              parsedDate = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
            }
          }

          // Try standard date parsing (ISO format, etc.)
          if (!parsedDate || isNaN(parsedDate.getTime())) {
            parsedDate = new Date(dateValue);
          }

          if (isNaN(parsedDate.getTime())) {
            throw new Error('Invalid date format');
          }
          dateStr = parsedDate.toISOString().split('T')[0];
        } else {
          throw new Error('Date is required');
        }

        // Parse category
        let category: ExpenseCategory = 'other';

        // First, try to use explicit category value if provided
        if (categoryValue !== null && categoryValue !== undefined && String(categoryValue).trim() !== '') {
          const categoryStr = String(categoryValue).toLowerCase().trim();
          const validCategories: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];
          if (validCategories.includes(categoryStr as ExpenseCategory)) {
            category = categoryStr as ExpenseCategory;
          } else {
            // If category value is invalid, fall back to keyword matching
            category = autoCategorizeByKeywords(description);
          }
        } else {
          // No explicit category provided, use keyword-based auto-categorization
          category = autoCategorizeByKeywords(description);
        }

        // Create expense
        await ExpenseModel.create({
          amount,
          date: dateStr,
          description,
          category,
          currency: currency as Currency,
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 1, // +1 for Excel row number (1-indexed)
          error: error instanceof Error ? error.message : 'Unknown error',
          data: row,
        });
      }
    }

    res.json({
      message: 'Import completed',
      results,
    });
  } catch (error) {
    console.error('Error importing Excel file:', error);
    res.status(500).json({
      error: 'Failed to import Excel file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
