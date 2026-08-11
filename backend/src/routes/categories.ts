/**
 * Category routes — /api/categories
 *   GET    /                          list every category, in display order
 *   POST   /                          create one { slug, label, color }
 *   PUT    /:slug                     rename / recolour / reorder
 *   DELETE /:slug?reassignTo=other    delete, moving anything that used it
 *
 * The slug is the value written onto every expense row, so it is set once at
 * creation and never edited — renaming it would be a data migration, and this
 * API deliberately does not offer one.
 */

import { Router, Request, Response } from 'express';
import * as CategoryModel from '../models/category';

const router = Router();

// Lowercase letters, digits and hyphens: the slug ends up in a URL path and in
// exported spreadsheets, so it stays boring on purpose.
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const MAX_SLUG_LENGTH = 32;
const MAX_LABEL_LENGTH = 40;

// Six-digit hex only. The colour is handed straight to inline chart styles, so
// keeping it to one shape means the frontend never has to sanitise it.
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Words the UI already uses as "no particular category" sentinels — the table
// filter and the analytics selector both compare against 'all'. A real category
// with one of these slugs would be indistinguishable from the sentinel.
const RESERVED_SLUGS = ['all', 'none'];

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(CategoryModel.getAll());
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { slug, label, color, sortOrder } = req.body ?? {};
    const errors: string[] = [];

    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      errors.push('Slug must contain only lowercase letters, digits and hyphens');
    } else if (slug.length > MAX_SLUG_LENGTH) {
      errors.push(`Slug must be at most ${MAX_SLUG_LENGTH} characters`);
    } else if (RESERVED_SLUGS.includes(slug)) {
      errors.push(`Slug "${slug}" is reserved`);
    } else if (CategoryModel.exists(slug)) {
      errors.push(`Category "${slug}" already exists`);
    }

    if (typeof label !== 'string' || label.trim().length === 0) {
      errors.push('Label is required');
    } else if (label.trim().length > MAX_LABEL_LENGTH) {
      errors.push(`Label must be at most ${MAX_LABEL_LENGTH} characters`);
    }

    if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
      errors.push('Color must be a hex value like #34d399');
    }

    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) {
      errors.push('Sort order must be an integer');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.status(201).json(
      CategoryModel.create({ slug, label: label.trim(), color, sortOrder })
    );
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

router.put('/:slug', (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    if (!CategoryModel.exists(slug)) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const { label, color, sortOrder } = req.body ?? {};
    const errors: string[] = [];

    if (label !== undefined) {
      if (typeof label !== 'string' || label.trim().length === 0) {
        errors.push('Label cannot be empty');
      } else if (label.trim().length > MAX_LABEL_LENGTH) {
        errors.push(`Label must be at most ${MAX_LABEL_LENGTH} characters`);
      }
    }
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) {
      errors.push('Color must be a hex value like #34d399');
    }
    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) {
      errors.push('Sort order must be an integer');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    res.json(
      CategoryModel.update(slug, {
        label: typeof label === 'string' ? label.trim() : undefined,
        color,
        sortOrder,
      })
    );
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

/**
 * DELETE /api/categories/:slug?reassignTo=<slug>
 *
 * Two refusals, both deliberate:
 *   403 — the category is built-in. `services/categorize.ts` can emit any
 *         built-in slug and the Excel importer falls back to `other`, so
 *         removing one would break auto-categorization silently.
 *   409 — the category is in use and no `reassignTo` was given. The rows are
 *         reported back so the caller can say what is about to move; letting
 *         the foreign key fail instead would surface as a raw SQLite error.
 */
router.delete('/:slug', (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const category = CategoryModel.getBySlug(slug);

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (category.isBuiltin) {
      res.status(403).json({ error: `"${category.label}" is a built-in category and cannot be deleted` });
      return;
    }

    const reassignTo = req.query.reassignTo;
    const usage = CategoryModel.usage(slug);
    const inUse = usage.expenses > 0 || usage.budgets > 0;

    if (reassignTo !== undefined) {
      if (typeof reassignTo !== 'string' || !CategoryModel.exists(reassignTo)) {
        res.status(400).json({ error: 'reassignTo must name an existing category' });
        return;
      }
      if (reassignTo === slug) {
        res.status(400).json({ error: 'reassignTo must be a different category' });
        return;
      }
    } else if (inUse) {
      res.status(409).json({
        error: `"${category.label}" is still in use — pass reassignTo to move what uses it`,
        usage,
      });
      return;
    }

    CategoryModel.remove(slug, typeof reassignTo === 'string' ? reassignTo : undefined);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
