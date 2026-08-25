import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginScreen } from './LoginScreen';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authMocks,
}));

afterEach(cleanup);

describe('LoginScreen', () => {
  beforeEach(() => {
    authMocks.login.mockReset();
    authMocks.register.mockReset();
  });

  it('starts in login mode with accessible email and password fields', () => {
    const { container } = render(<LoginScreen />);

    expect(screen.getByRole('heading', { name: '纸片人男友' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '还没有账号？立即注册' })).toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('renders the approved gradient and card design without excluded auth UI', () => {
    const { container } = render(<LoginScreen />);

    expect(container.querySelector('main')).toHaveClass(
      'bg-gradient-to-br',
      'from-pink-100',
      'via-rose-100',
      'to-fuchsia-200',
    );
    expect(container.querySelector('section')).toHaveClass(
      'max-w-sm',
      'rounded-3xl',
      'bg-white/90',
    );
    expect(screen.queryByText(/昵称/)).not.toBeInTheDocument();
    expect(screen.queryByText(/忘记密码/)).not.toBeInTheDocument();
    expect(screen.queryByText(/微信|QQ|Google|社交账号/)).not.toBeInTheDocument();
    expect(screen.queryByText(/邮箱验证|验证邮件|查收邮件/)).not.toBeInTheDocument();
  });

  it('switches to registration mode and exposes password confirmation', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));

    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('确认密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已有账号？返回登录' })).toBeInTheDocument();
  });

  it('clears passwords and errors when returning to login mode', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.type(screen.getByLabelText('确认密码'), 'different123');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致');

    await user.click(screen.getByRole('button', { name: '已有账号？返回登录' }));

    expect(screen.getByLabelText('邮箱')).toHaveValue('person@example.com');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(screen.getByLabelText('确认密码')).toHaveValue('');
  });

  it('clears the password and validation error when switching to registration', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByRole('alert')).toHaveTextContent('密码至少需要 8 位');

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));

    expect(screen.getByLabelText('邮箱')).toHaveValue('person@example.com');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(screen.getByLabelText('确认密码')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an invalid email without attempting login', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), 'invalid-email');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的邮箱地址');
    expect(authMocks.login).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than eight characters', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByRole('alert')).toHaveTextContent('密码至少需要 8 位');
    expect(authMocks.login).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords during registration', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.type(screen.getByLabelText('确认密码'), 'password456');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致');
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('logs in with the trimmed email and exact password', async () => {
    const user = userEvent.setup();
    authMocks.login.mockResolvedValue(undefined);
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), '  person@example.com  ');
    await user.type(screen.getByLabelText('密码'), ' password123 ');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(authMocks.login).toHaveBeenCalledWith('person@example.com', ' password123 ');
  });

  it('registers with the trimmed email and exact password', async () => {
    const user = userEvent.setup();
    authMocks.register.mockResolvedValue(undefined);
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
    await user.type(screen.getByLabelText('邮箱'), '  person@example.com  ');
    await user.type(screen.getByLabelText('密码'), ' password123 ');
    await user.type(screen.getByLabelText('确认密码'), ' password123 ');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(authMocks.register).toHaveBeenCalledWith('person@example.com', ' password123 ');
  });

  it('maps authentication errors to a Chinese message', async () => {
    const user = userEvent.setup();
    authMocks.login.mockRejectedValue(new Error('Invalid login credentials'));
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
  });

  it('disables controls and prevents duplicate submissions while submitting', async () => {
    let resolveLogin!: () => void;
    authMocks.login.mockImplementation(
      () => new Promise<void>((resolve) => { resolveLogin = resolve; }),
    );
    const user = userEvent.setup();
    const { container } = render(<LoginScreen />);

    await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    const submit = screen.getByRole('button', { name: '登录' });
    await user.click(submit);

    expect(screen.getByRole('button', { name: '登录中...' })).toBeDisabled();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeDisabled();
    expect(screen.getByLabelText('密码')).toBeDisabled();
    expect(screen.getByRole('button', { name: '还没有账号？立即注册' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '登录中...' }));
    expect(authMocks.login).toHaveBeenCalledTimes(1);

    resolveLogin();
  });
});
