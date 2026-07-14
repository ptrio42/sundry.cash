/**
 * Tests for the Settings component. The API layer is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from '../components/Settings';
import { updateSettings } from '../services/api';
import { AppSettings } from '../types/expense.types';

vi.mock('../services/api', () => ({ updateSettings: vi.fn() }));

const settings: AppSettings = { defaultCurrency: 'USD', defaultCategory: 'groceries', defaultBtcUnit: 'BTC' };

beforeEach(() => vi.clearAllMocks());

describe('Settings', () => {
  it('renders the preference controls pre-filled from props', () => {
    render(<Settings settings={settings} onSaved={vi.fn()} />);
    expect((screen.getByLabelText(/default currency/i) as HTMLSelectElement).value).toBe('USD');
    expect((screen.getByLabelText(/default category/i) as HTMLSelectElement).value).toBe('groceries');
    expect((screen.getByLabelText(/default bitcoin unit/i) as HTMLSelectElement).value).toBe('BTC');
  });

  it('keeps Save disabled until a value changes, then saves and reports back', async () => {
    (updateSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultCurrency: 'PLN', defaultCategory: 'groceries', defaultBtcUnit: 'BTC',
    });
    const onSaved = vi.fn();
    render(<Settings settings={settings} onSaved={onSaved} />);

    const saveBtn = screen.getByRole('button', { name: /save preferences/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/default currency/i), { target: { value: 'PLN' } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ defaultCurrency: 'PLN', defaultCategory: 'groceries', defaultBtcUnit: 'BTC' })
    );
    expect(onSaved).toHaveBeenCalledWith({ defaultCurrency: 'PLN', defaultCategory: 'groceries', defaultBtcUnit: 'BTC' });
  });
});
