import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CharacterSelect } from './CharacterSelect';
import { ChatScreen } from './ChatScreen';

Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/context/ChatContext', () => ({
  useChat: () => ({
    chatState: {
      character: { id: 'test', name: '测试角色', avatar: '/avatar.png', tagline: '', tags: [] },
      messages: [],
      isTyping: false,
    },
    sendMessage: vi.fn(),
    resetChat: vi.fn(),
  }),
}));

describe('logout control locations', () => {
  it('renders logout on the character selection screen', () => {
    render(<CharacterSelect onSelectCharacter={vi.fn()} />);

    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });

  it('renders logout in the chat header', () => {
    render(<ChatScreen />);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });
});
