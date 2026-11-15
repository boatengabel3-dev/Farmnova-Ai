import React, { useEffect, useRef, useState } from 'react';
import { Layers, MessageSquare, Send, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { ChatMessage, Farm } from '../types';

interface Props {
  farm: Farm;
}

const STARTER_QUESTIONS = [
  'Why is this rotation being suggested for my farm?',
  'What does my vegetation and soil moisture context mean?',
  'How could reduced rainfall affect my next growing season?',
  'Why might legumes be useful in my crop rotation?',
  'Which information is missing before making this decision?',
];

export function AiAssistantPanel({ farm }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingHistory(true);
    api
      .getChatHistory(farm.id)
      .then((res) => {
        if (active) setMessages(res.messages);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, [farm.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function askQuestion(questionText: string) {
    const q = questionText.trim();
    if (!q || loading) return;
    setError(null);
    setInput('');
    const optimisticId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, farmId: farm.id, role: 'user', content: q, createdAt: new Date().toISOString() },
    ]);
    setLoading(true);
    try {
      const res = await api.sendChatMessage(farm.id, q);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        res.userMessage,
        res.assistantMessage,
      ]);
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    await api.clearChatHistory(farm.id);
    setMessages([]);
  }

  async function handleEdgeBriefing() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.invokeEdge('rotation-brief', {}, farm.id);
      const summary = String(res.data?.summary || 'Edge briefing generated.');
      setMessages((prev) => [
        ...prev,
        {
          id: `edge-${Date.now()}`,
          farmId: farm.id,
          role: 'assistant',
          content: `${summary}\n\n[Executed via ${res.functionSlug} · ${res.runtime}]`,
          createdAt: res.executedAt || new Date().toISOString(),
        },
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden flex flex-col h-[640px]">
      <div className="px-5 py-4 border-b border-[#E2DDD1] bg-[#FAF8F3] flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <MessageSquare className="w-5 h-5 text-[#0E4D3A]" />
          <div>
            <h2 className="font-display text-lg font-semibold text-[#132A20]">
              Agricultural Intelligence Assistant
            </h2>
            <p className="text-xs text-[#5E6D64]">
              Grounded strictly in {farm.name}’s soil profile, NASA observations, and rotation strategies
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleEdgeBriefing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0E4D3A] text-[#0E4D3A] hover:bg-[#0E4D3A]/5 disabled:opacity-50"
          >
            <Layers className="w-3.5 h-3.5" /> Edge Briefing
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] text-[#5E6D64] hover:text-[#8C2D19]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear Thread
            </button>
          )}
        </div>
      </div>

      {/* Chat Viewport */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FAF8F3]/50">
        {loadingHistory ? (
          <div className="text-xs text-[#5E6D64]">Loading saved conversation...</div>
        ) : messages.length === 0 ? (
          <div className="max-w-2xl mx-auto py-8 space-y-5">
            <div className="text-center space-y-2">
              <h3 className="font-display text-xl font-semibold text-[#132A20]">
                Ask about your NASA observations or rotation choices
              </h3>
              <p className="text-xs text-[#5E6D64]">
                Every answer separates direct satellite observations from derived indicators and highlights missing soil or local field data before you commit to planting.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => askQuestion(q)}
                  className="text-left p-3.5 rounded-xl bg-white border border-[#E2DDD1] hover:border-[#0E4D3A] text-xs font-medium text-[#132A20] transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-2xl rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[#0E4D3A] text-[#FAF8F3]'
                    : 'bg-white border border-[#E2DDD1] text-[#132A20]'
                }`}
              >
                <div className={`text-[11px] font-semibold mb-1 ${msg.role === 'user' ? 'text-[#E4C37A]' : 'text-[#5E6D64]'}`}>
                  {msg.role === 'user' ? 'You' : 'FarmNova AI Agronomic Assistant'}
                </div>
                {msg.content}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-[#E2DDD1] rounded-xl px-4 py-3 text-xs text-[#5E6D64]">
              Reviewing NASA observations, soil gaps, and rotation trade-offs...
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-5 py-2.5 bg-[#FDF2F0] border-t border-[#E5B8B0] text-xs text-[#8C2D19]">
          {error}
        </div>
      )}

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askQuestion(input);
        }}
        className="p-4 bg-white border-t border-[#E2DDD1] flex items-center gap-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about dry spells, legume benefits, missing soil pH, or rotation trade-offs..."
          className="flex-1 px-4 py-2.5 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B] disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Ask
        </button>
      </form>
    </div>
  );
}
