import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LogoutButton } from './LogoutButton';

const logout = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ logout }),
}));

afterEach(cleanup);

describe('LogoutButton', () => {
  beforeEach(() => {
    logout.mockReset();
    logout.mockResolvedValue(undefined);
  });

  it('logs out once when clicked', async () => {
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: '退出登录' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('disables while logout is pending and prevents duplicate requests', async () => {
    let resolveLogout!: () => void;
    logout.mockReturnValue(new Promise<void>((resolve) => { resolveLogout = resolve; }));
    render(<LogoutButton />);

    const button = screen.getByRole('button', { name: '退出登录' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(logout).toHaveBeenCalledTimes(1);

    await act(async () => resolveLogout());
    expect(button).toBeEnabled();
  });

  it('shows generic feedback after failure and clears it when retrying', async () => {
    const user = userEvent.setup();
    logout.mockRejectedValueOnce(new Error('private provider detail'));
    render(<LogoutButton />);

    const button = screen.getByRole('button', { name: '退出登录' });
    await user.click(button);

    expect(button).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('退出失败，请稍后重试');
    expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();

    await user.click(button);
    expect(logout).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
