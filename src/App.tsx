/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {FormEvent, useMemo, useState} from 'react';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
};

const starterMessages: ChatMessage[] = [
  {
    id: 1,
    role: 'assistant',
    content: 'Hey there! I am your assistant. Ask me anything to get started.',
  },
];

const quickReplies = ['Summarize my day', 'Write an email', 'Plan a workout'];

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [draft, setDraft] = useState('');

  const canSend = useMemo(() => draft.trim().length > 0, [draft]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();

    const text = draft.trim();
    if (!text) {
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
    };

    const reply: ChatMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: `You said: "${text}". This is a demo chat UI, so you can now wire this up to your real backend.`,
    };

    setMessages((current) => [...current, userMessage, reply]);
    setDraft('');
  };

  return (
    <main className="chat-shell">
      <section className="chat-window" aria-label="Chat conversation">
        <header className="chat-header">
          <div>
            <p className="chat-title">BitUpdate Chat</p>
            <p className="chat-subtitle">Online now</p>
          </div>
        </header>

        <ol className="messages" aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={`bubble-row ${message.role}`}>
              <article className="bubble">{message.content}</article>
            </li>
          ))}
        </ol>

        <footer className="composer">
          <div className="quick-replies">
            {quickReplies.map((item) => (
              <button
                key={item}
                type="button"
                className="chip"
                onClick={() => setDraft(item)}>
                {item}
              </button>
            ))}
          </div>

          <form className="composer-form" onSubmit={sendMessage}>
            <label htmlFor="message" className="sr-only">
              Message
            </label>
            <input
              id="message"
              name="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type a message..."
              autoComplete="off"
            />
            <button type="submit" disabled={!canSend}>
              Send
            </button>
          </form>
        </footer>
      </section>
    </main>
  );
}
