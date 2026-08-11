/**
 * Validation middleware for expense data
 * Validates incoming request data before processing
 */

import { Request, Response, NextFunction } from 'express';
import * as CategoryModel from '../models/category';
import * as CurrencyModel from '../models/currency';

/**
 * Categories are rows now, so the valid set is read per request instead of
 * being a literal here. The message still lists them, which is the useful part
 * of the old error — it just lists what the table actually holds.
 */
function categoryError(): string {
  return `Category must be one of: ${CategoryModel.allSlugs().join(', ')}`;
}

function currencyError(): string {
  return `Currency must be one of: ${CurrencyModel.enabledCodes().join(', ')}`;
}

/**
 * Validate expense data for create/update operations
 */
export function validateExpense(req: Request, res: Response, next: NextFunction): void {
  const { amount, date, description, category, currency } = req.body;

  const errors: string[] = [];

  // Validate amount
  if (amount !== undefined) {
    if (typeof amount !== 'number') {
      errors.push('Amount must be a number');
    } else if (amount <= 0) {
      errors.push('Amount must be greater than 0');
    } else if (!isFinite(amount)) {
      errors.push('Amount must be a valid number');
    }
  } else if (req.method === 'POST') {
    // Amount is required for POST (create)
    errors.push('Amount is required');
  }

  // Validate date
  if (date !== undefined) {
    if (typeof date !== 'string') {
      errors.push('Date must be a string');
    } else if (!isValidDate(date)) {
      errors.push('Date must be a valid ISO date (YYYY-MM-DD)');
    }
  } else if (req.method === 'POST') {
    // Date is required for POST (create)
    errors.push('Date is required');
  }

  // Validate description
  if (description !== undefined) {
    if (typeof description !== 'string') {
      errors.push('Description must be a string');
    } else if (description.trim().length === 0) {
      errors.push('Description cannot be empty');
    }
  } else if (req.method === 'POST') {
    // Description is required for POST (create)
    errors.push('Description is required');
  }

  // Validate category
  if (category !== undefined) {
    if (typeof category !== 'string') {
      errors.push('Category must be a string');
    } else if (!CategoryModel.exists(category)) {
      errors.push(categoryError());
    }
  } else if (req.method === 'POST') {
    // Category is required for POST (create)
    errors.push('Category is required');
  }

  // Validate currency.
  //
  // A *new* expense must use an enabled currency; an edit only needs the code
  // to exist. Disabling means "stop offering this for new entries", never
  // "hide the history" — an old expense in a since-disabled currency has to
  // stay editable, and rejecting the PUT would strand it.
  if (currency !== undefined) {
    if (typeof currency !== 'string') {
      errors.push('Currency must be a string');
    } else if (req.method === 'POST' ? !CurrencyModel.isEnabled(currency) : !CurrencyModel.exists(currency)) {
      errors.push(currencyError());
    }
  } else if (req.method === 'POST') {
    // Currency is required for POST (create)
    errors.push('Currency is required');
  }

  // If there are validation errors, return 400
  if (errors.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
    return;
  }

  // Validation passed, continue to next middleware
  next();
}

/**
 * Validate date string in ISO format (YYYY-MM-DD)
 */
export function isValidDate(dateString: string): boolean {
  // Check format with regex
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return false;
  }

  // Check if it's a valid date
  const date = new Date(dateString);
  const timestamp = date.getTime();

  // Check if date is valid (not NaN)
  if (isNaN(timestamp)) {
    return false;
  }

  // Verify the date components match the input. `new Date("YYYY-MM-DD")` parses
  // as UTC midnight, so we must read back UTC components — using local getFullYear/
  // getMonth/getDate here rejected every valid date for users west of UTC.
  const [year, month, day] = dateString.split('-').map(Number);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && // months are 0-indexed
    date.getUTCDate() === day
  );
}

/**
 * Validate query parameters for filtering
 */
export function validateFilters(req: Request, res: Response, next: NextFunction): void {
  const { category, startDate, endDate } = req.query;

  const errors: string[] = [];

  // Validate category filter
  if (category !== undefined) {
    if (typeof category !== 'string') {
      errors.push('Category must be a string');
    } else if (!CategoryModel.exists(category)) {
      errors.push(categoryError());
    }
  }

  // Validate startDate filter
  if (startDate !== undefined) {
    if (typeof startDate !== 'string') {
      errors.push('Start date must be a string');
    } else if (!isValidDate(startDate)) {
      errors.push('Start date must be a valid ISO date (YYYY-MM-DD)');
    }
  }

  // Validate endDate filter
  if (endDate !== undefined) {
    if (typeof endDate !== 'string') {
      errors.push('End date must be a string');
    } else if (!isValidDate(endDate)) {
      errors.push('End date must be a valid ISO date (YYYY-MM-DD)');
    }
  }

  // Validate date range logic
  if (startDate && endDate && typeof startDate === 'string' && typeof endDate === 'string') {
    if (new Date(startDate) > new Date(endDate)) {
      errors.push('Start date must be before or equal to end date');
    }
  }

  // If there are validation errors, return 400
  if (errors.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
    return;
  }

  // Validation passed, continue to next middleware
  next();
}
