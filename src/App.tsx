import {FormEvent, useState} from 'react';

type Message = {
  id: number;
  text: string;
  sender: 'bot' | 'user';
};

const starterMessages: Message[] = [
  {id: 1, text: 'Hi! Chat is now visible. How can I help you today?', sender: 'bot'},
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState('');

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages(prev => [
      ...prev,
      {id: Date.now(), text, sender: 'user'},
      {id: Date.now() + 1, text: 'Message received ✅', sender: 'bot'},
    ]);
    setInput('');
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 flex items-center justify-center">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <header className="border-b border-slate-800 px-5 py-4">
          <h1 className="text-lg font-semibold">BIT Updates Chat</h1>
        </header>

        <div className="h-[420px] overflow-y-auto px-5 py-4 space-y-3" aria-live="polite">
          {messages.map(message => (
            <div
              key={message.id}
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                message.sender === 'user'
                  ? 'ml-auto bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-100'
              }`}>
              {message.text}
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} className="border-t border-slate-800 p-4 flex gap-2">
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Type your message..."
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 transition-colors">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
