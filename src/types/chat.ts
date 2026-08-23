// 角色ID
export type CharacterId = 'warm-boy' | 'cool-guy' | 'sunshine' | 'artsy';

// 角色信息
export interface Character {
  id: CharacterId;
  name: string;
  tagline: string;      // 一句话介绍
  tags: string[];        // 性格标签
  avatar: string;        // 头像URL（AI生成）
  speaker: string;       // TTS 语音ID
  systemPrompt: string;  // 系统提示词
  appearance: string;    // 外貌描述（用于生图一致性）
}

// 消息类型
export type MessageType = 'text' | 'voice' | 'image';

// 消息
export interface Message {
  id: string;
  role: 'user' | 'character';
  type: MessageType;
  content: string;        // 文字内容
  audioUri?: string;      // 语音URL
  imageUri?: string;      // 图片URL
  imagePrompt?: string;   // 图片生成描述（仅内部使用）
  timestamp: number;
}

// 聊天状态
export interface ChatState {
  character: Character | null;
  messages: Message[];
  isTyping: boolean;       // 角色正在输入
  isGeneratingImage: boolean; // 正在生成图片
}
