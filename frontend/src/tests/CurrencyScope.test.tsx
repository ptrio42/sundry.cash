/**
 * Tests for the shared currency-scope control.
 *
 * The component's whole job is to be one implementation of a control that four
 * screens had grown four versions of (F9). So these are tests about the
 * contract, not about any one screen: it renders the options it is handed, in
 * order; it marks exactly one active; it emits the code rather than an index;
 * and the combined option is optional.
 *
 * Each screen's own option set, and whether the control appears at all, stay
 * covered by that screen's suite — deliberately, because the "appears at all"
 * test is not the same question on each. See the component header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CurrencyScope from '../components/CurrencyScope';
import { TEST_CURRENCIES } from './currencies.fixture';

const offered = TEST_CURRENCIES.filter(c => ['USD', 'PLN'].includes(c.code));

describe('CurrencyScope', () => {
  it('renders one button per currency it is given, labelled code and symbol', () => {
    render(<CurrencyScope currencies={offered} value="USD" onChange={vi.fn()} />);

    const labels = screen.getAllByRole('button').map(b => b.textContent);
    expect(labels).toEqual(offered.map(c => `${c.code} (${c.symbol})`));
  });

  it('marks the scope in force, and only that one', () => {
    render(<CurrencyScope currencies={offered} value="PLN" onChange={vi.fn()} />);

    const active = screen.getAllByRole('button').filter(b => b.classList.contains('active'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('PLN');
  });

  it('emits the currency code that was clicked', () => {
    const onChange = vi.fn();
    render(<CurrencyScope currencies={offered} value="USD" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^PLN/ }));

    expect(onChange).toHaveBeenCalledWith('PLN');
  });

  it('puts the combined option first, and emits its own value rather than a code', () => {
    const onChange = vi.fn();
    render(
      <CurrencyScope
        currencies={offered}
        value="USD"
        onChange={onChange}
        combined={{ value: 'primary', label: 'All → PLN', title: 'converted' }}
      />
    );

    expect(screen.getAllByRole('button')[0]).toHaveTextContent('All → PLN');
    fireEvent.click(screen.getByRole('button', { name: 'All → PLN' }));
    expect(onChange).toHaveBeenCalledWith('primary');
  });

  it('marks the combined option active when it is the scope in force', () => {
    render(
      <CurrencyScope
        currencies={offered}
        value="all"
        onChange={vi.fn()}
        combined={{ value: 'all', label: 'All Currencies' }}
      />
    );

    expect(screen.getByRole('button', { name: 'All Currencies' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /^USD/ })).not.toHaveClass('active');
  });

  it('offers no combined option when it is not given one', () => {
    render(<CurrencyScope currencies={offered} value="USD" onChange={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(offered.length);
    expect(screen.queryByRole('button', { name: /all/i })).not.toBeInTheDocument();
  });

  it('renders an empty control rather than failing when nothing is offered', () => {
    const { container } = render(<CurrencyScope currencies={[]} value="USD" onChange={vi.fn()} />);

    expect(container.querySelector('.currency-buttons')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
