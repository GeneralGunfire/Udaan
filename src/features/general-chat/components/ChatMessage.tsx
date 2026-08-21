export interface ChatMessageData {
  id: string
  role: 'user' | 'assistant'
  mode: import('./modes').ModeId
  text: string
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser ? 'text-white' : 'glass-surface text-text-primary'
        }`}
        style={isUser ? { background: 'var(--gradient-brand)' } : undefined}
      >
        {!isUser && message.text === '' ? (
          <span className="flex items-center gap-1 py-0.5">
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full" />
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
          </span>
        ) : (
          message.text
        )}
      </div>
    </div>
  )
}
