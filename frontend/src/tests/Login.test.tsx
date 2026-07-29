/**
 * Tests for the Login screen (shown when the backend has APP_PASSWORD set).
 * The API layer is mocked: token storage lives inside services/api's `login`,
 * so what the component owns is *delegating* to it and reacting to the outcome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from '../components/Login';
import { login } from '../services/api';

vi.mock('../services/api', () => ({ login: vi.fn() }));

const loginMock = login as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

const typePassword = (value: string) =>
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value } });

describe('Login', () => {
  it('focuses the password field on mount so the user can type straight away', () => {
    render(<Login onSuccess={vi.fn()} />);
    const field = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(field).toHaveAttribute('type', 'password');
    expect(document.activeElement).toBe(field);
  });

  it('keeps Sign in disabled until a password is typed', () => {
    render(<Login onSuccess={vi.fn()} />);
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeDisabled();

    typePassword('hunter2');
    expect(button).not.toBeDisabled();
  });

  it('submits the typed password and notifies the parent on success', async () => {
    loginMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);

    typePassword('correct horse');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(loginMock).toHaveBeenCalledWith('correct horse');
  });

  it("shows the server's error message and stays put when the password is wrong", async () => {
    loginMock.mockRejectedValue(new Error('Invalid password'));
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);

    typePassword('nope');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    // The component must never persist a token of its own on a failed attempt.
    expect(localStorage.getItem('sundry-token')).toBeNull();
    // Still usable for a second attempt.
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });

  it('clears a previous error when the next attempt starts', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid password')).mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);

    typePassword('nope');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid password')).toBeInTheDocument();

    typePassword('right');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByText('Invalid password')).not.toBeInTheDocument();
  });

  it('disables the button and shows progress while the request is in flight', async () => {
    let resolveLogin: () => void = () => {};
    loginMock.mockReturnValue(new Promise<void>((resolve) => { resolveLogin = resolve; }));
    render(<Login onSuccess={vi.fn()} />);

    typePassword('hunter2');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const pending = await screen.findByRole('button', { name: /signing in/i });
    expect(pending).toBeDisabled();

    resolveLogin();
    await waitFor(() => expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument());
  });
});
