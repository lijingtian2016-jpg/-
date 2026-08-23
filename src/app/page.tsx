'use client';

import { CharacterSelect } from '@/components/CharacterSelect';
import { ChatScreen } from '@/components/ChatScreen';
import { useChat } from '@/context/ChatContext';

export default function Home() {
  const { chatState, selectCharacter } = useChat();
  const { character } = chatState;

  // Conditionally render the correct screen based on whether a character is selected in the context
  return (
    <main>
      {character ? (
        // The ChatScreen component will get all the data it needs from the context itself
        <ChatScreen />
      ) : (
        <CharacterSelect onSelectCharacter={selectCharacter} />
      )}
    </main>
  );
}
