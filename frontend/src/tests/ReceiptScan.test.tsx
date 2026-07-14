/**
 * Tests for the ReceiptScan component.
 * The API layer is mocked so we exercise the capture → review flow in isolation.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiptScan from '../components/ReceiptScan';
import { scanReceipt } from '../services/api';

vi.mock('../services/api', () => ({
  scanReceipt: vi.fn(),
  createReceiptExpense: vi.fn(),
}));

beforeAll(() => {
  // jsdom has no object-URL support.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const selectFile = () => {
  const file = new File(['receipt bytes'], 'receipt.png', { type: 'image/png' });
  const input = screen.getByLabelText(/receipt photo/i);
  fireEvent.change(input, { target: { files: [file] } });
};

describe('ReceiptScan', () => {
  it('renders the capture UI with a disabled scan button', () => {
    render(<ReceiptScan onExpenseAdded={vi.fn()} />);
    expect(screen.getByText('Scan a Receipt')).toBeInTheDocument();
    expect(screen.getByLabelText(/receipt photo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan receipt/i })).toBeDisabled();
  });

  it('enables scanning once a photo is chosen', () => {
    render(<ReceiptScan onExpenseAdded={vi.fn()} />);
    selectFile();
    expect(screen.getByRole('button', { name: /scan receipt/i })).not.toBeDisabled();
  });

  it('shows a pre-filled review form after a successful scan', async () => {
    (scanReceipt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      amount: 11.18,
      date: '2024-01-15',
      merchant: 'Biedronka',
      currency: 'PLN',
      category: 'groceries',
      rawText: 'SUMA PLN 11,18',
      confidence: 0.9,
      warnings: [],
    });

    render(<ReceiptScan onExpenseAdded={vi.fn()} />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /scan receipt/i }));

    // Review form appears, pre-filled with the extracted values.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save expense/i })).toBeInTheDocument();
    });
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('11.18');
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Biedronka');
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('groceries');
    expect((screen.getByLabelText(/currency/i) as HTMLSelectElement).value).toBe('PLN');
  });

  it('surfaces warnings from the OCR result', async () => {
    (scanReceipt as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      amount: null,
      date: null,
      merchant: null,
      currency: null,
      category: 'other',
      rawText: '',
      confidence: 0.2,
      warnings: ['Could not detect the total amount — please enter it manually.'],
    });

    render(<ReceiptScan onExpenseAdded={vi.fn()} />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /scan receipt/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not detect the total amount/i)).toBeInTheDocument();
    });
  });
});
