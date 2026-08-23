'use client';

import Image from 'next/image';
import { characters } from '@/data/characters';
import { Character } from '@/types/chat';

interface CharacterSelectProps {
  onSelectCharacter: (character: Character) => void;
}

export const CharacterSelect = ({ onSelectCharacter }: CharacterSelectProps) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-pink-100 to-pink-200 p-4 font-sans">
      <h1 className="text-4xl font-bold text-gray-800 mb-2">选择你的纸片人男友</h1>
      <p className="text-gray-600 mb-8">点击卡片开始聊天</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        {characters.map((character) => (
          <div
            key={character.id}
            className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg p-6 flex flex-col items-center text-center cursor-pointer transform hover:scale-105 hover:shadow-2xl transition-all duration-300 border border-white/50"
            onClick={() => onSelectCharacter(character)}
          >
            <div className="relative w-32 h-32 mb-4 shadow-md rounded-full">
              <Image
                src={character.avatar}
                alt={character.name}
                layout="fill"
                objectFit="cover"
                className="rounded-full"
                unoptimized // Using external URLs for avatars without loader config
              />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{character.name}</h2>
            <p className="text-gray-500 mt-1 mb-3">{character.tagline}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {character.tags.map((tag) => (
                <span key={tag} className="bg-pink-100 text-pink-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <footer className="text-center text-sm text-gray-500 mt-12">
        <p>Created by Trae for a coding showcase.</p>
      </footer>
    </div>
  );
};
