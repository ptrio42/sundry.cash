/**
 * Unit tests for keyword auto-categorization.
 * Guards the whole-word matching fix (no more substring false positives).
 */

import { autoCategorizeByKeywords } from '../routes/import';

describe('autoCategorizeByKeywords', () => {
  it('categorizes a gas bill as utilities, not transport', () => {
    expect(autoCategorizeByKeywords('Gas bill')).toBe('utilities');
  });

  it('still categorizes vehicle fuel as transport', () => {
    expect(autoCategorizeByKeywords('Fuel at Orlen')).toBe('transport');
  });

  it('does not substring-match "car" inside "scarf"', () => {
    expect(autoCategorizeByKeywords('Wool scarf')).toBe('other');
  });

  it('does not substring-match Polish "gra" (game) inside "photography"', () => {
    expect(autoCategorizeByKeywords('Photography services')).toBe('other');
  });

  it('matches whole Polish store names', () => {
    expect(autoCategorizeByKeywords('Biedronka zakupy')).toBe('groceries');
  });

  it('matches streaming services as media', () => {
    expect(autoCategorizeByKeywords('Netflix subscription')).toBe('media');
  });

  it('falls back to "other" when nothing matches', () => {
    expect(autoCategorizeByKeywords('Xyzzy 123')).toBe('other');
  });
});
