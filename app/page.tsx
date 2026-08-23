'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Clock3,
  Cpu,
  Gauge,
  MessageSquareText,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Zap,
} from 'lucide-react'

type Message = { id: string; role: 'user' | 'assistant'; content: string; time: string }

interface Stats {
  prompt: number
  response: number
  latency: number
  speed: number
  model: string
}

interface GroqApiError {
  error?: {
    message?: string
  }
}

const INITIAL_STATS: Stats = {
  prompt: 0,
  response: 0,
  latency: 0,
  speed: 0,
  model: 'llama-3.1-8b-instant',
}

const STORAGE_MESSAGES_KEY = 'groq_chat_messages_v1'
const STORAGE_STATS_KEY = 'groq_chat_stats_v1'

const statCards = [
  ['Prompt acumulado', 'Entrada', 'tokens'],
  ['Respuesta acumulada', 'Salida', 'tokens'],
  ['Total consumido', 'Sesión', 'tokens'],
]

const MODEL_CANDIDATES = [
  process.env.NEXT_PUBLIC_GROQ_MODEL,
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
].filter((model, index, array): model is string => {
  return Boolean(model) && array.indexOf(model) === index
})

function canTryNextModel(status: number, message: string) {
  if (status === 401 || status === 403) {
    return false
  }

  const normalized = message.toLowerCase()
  return (
    normalized.includes('decommissioned') ||
    normalized.includes('does not exist') ||
    normalized.includes('no longer supported') ||
    normalized.includes('do not have access') ||
    normalized.includes('not found') ||
    normalized.includes('model')
  )
}

function createMessageId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats>(INITIAL_STATS)
  const [isClient, setIsClient] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  // 1. Cargar historial y métricas desde localStorage al iniciar
  useEffect(() => {
    setIsClient(true)
    try {
      const savedMessages = localStorage.getItem(STORAGE_MESSAGES_KEY)
      const savedStats = localStorage.getItem(STORAGE_STATS_KEY)
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages) as Array<Partial<Message>>
        const usedIds = new Set<string>()
        const normalized = parsed
          .filter((message): message is Partial<Message> & { role: 'user' | 'assistant'; content: string } => {
            return (
              (message.role === 'user' || message.role === 'assistant') &&
              typeof message.content === 'string'
            )
          })
          .map((message) => {
            const incoming = typeof message.id === 'string' ? message.id : String(message.id ?? '')
            let id = incoming && !usedIds.has(incoming) ? incoming : createMessageId()
            while (usedIds.has(id)) {
              id = createMessageId()
            }
            usedIds.add(id)
            return {
              id,
              role: message.role,
              content: message.content,
              time:
                typeof message.time === 'string'
                  ? message.time
                  : new Date().toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }),
            }
          })
        setMessages(normalized)
      }
      if (savedStats) setStats(JSON.parse(savedStats))
    } catch (e) {
      console.error('Error al leer de localStorage:', e)
    }
  }, [])

  // 2. Guardar en localStorage tras cada cambio
  useEffect(() => {
    if (isClient) {
      try {
        localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages))
        localStorage.setItem(STORAGE_STATS_KEY, JSON.stringify(stats))
      } catch (e) {
        console.error('Error al guardar en localStorage:', e)
      }
    }
  }, [messages, stats, isClient])

  // Scroll automático
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  // 3. Envío real a la API de Groq con fetch nativo
  async function sendMessage() {
    const content = input.trim()
    if (!content || thinking) return

    const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY
    if (!apiKey) {
      setError('Falta la API Key. Configura NEXT_PUBLIC_GROQ_API_KEY en tu archivo .env.local')
      return
    }

    setError('')
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content,
      time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setThinking(true)

    const startTime = performance.now()

    try {
      let data: any = null
      let usedModel = ''
      let lastError = ''

      for (const model of MODEL_CANDIDATES) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: updatedMessages.map(({ role, content }) => ({ role, content })),
            temperature: 0.7,
          }),
        })

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as GroqApiError
          const errorMsg = errorData.error?.message || `Error ${response.status}: ${response.statusText || 'Fallo en la API de Groq'}`
          lastError = `${model}: ${errorMsg}`

          if (canTryNextModel(response.status, errorMsg)) {
            continue
          }

          throw new Error(errorMsg)
        }

        data = await response.json()
        usedModel = data.model || model
        break
      }

      if (!data) {
        throw new Error(
          `No hay modelos disponibles para tu cuenta. Modelos probados: ${MODEL_CANDIDATES.join(', ')}. Último error: ${lastError || 'sin detalle'}`
        )
      }

      const endTime = performance.now()
      const durationMs = Math.round(endTime - startTime)

      const assistantReply = data.choices?.[0]?.message?.content || 'No se obtuvo respuesta del modelo.'

      const usage = data.usage
      const promptTokens = usage?.prompt_tokens || 0
      const completionTokens = usage?.completion_tokens || 0
      const totalTimeSec = usage?.total_time || durationMs / 1000
      const tokensPerSec = totalTimeSec > 0 ? Math.round(completionTokens / totalTimeSec) : 0

      const assistantMessage: Message = {
        id: createMessageId(),
        role: 'assistant',
        content: assistantReply,
        time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }

      setMessages((prev) => [...prev, assistantMessage])

      setStats((prev) => ({
        prompt: prev.prompt + promptTokens,
        response: prev.response + completionTokens,
        latency: durationMs,
        speed: tokensPerSec,
        model: usedModel,
      }))
    } catch (err: any) {
      console.error('Error en la llamada a Groq:', err)
      setError(err.message || 'No se pudo completar la inferencia. Comprueba tu API Key y conexión.')
    } finally {
      setThinking(false)
    }
  }

  // 4. Limpiar conversación y métricas
  function clearChat() {
    if (confirm('¿Deseas borrar todo el historial y reiniciar las métricas de la sesión?')) {
      setMessages([])
      setError('')
      setStats(INITIAL_STATS)
      localStorage.removeItem(STORAGE_MESSAGES_KEY)
      localStorage.removeItem(STORAGE_STATS_KEY)
    }
  }

  if (!isClient) return null

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col lg:h-full lg:flex-row">
        {/* ================= BARRA LATERAL ================= */}
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900/50 p-5 lg:w-[320px] lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Gauge size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold">Métricas de Sesión</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Live inference monitor</p>
            </div>
          </div>

          {/* Tarjetas de Tokens */}
          <div className="mt-8 grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-3">
            {statCards.map(([label, badge, unit], index) => {
              const shown = index === 0 ? stats.prompt : index === 1 ? stats.response : stats.prompt + stats.response
              return (
                <div
                  key={label}
                  className={`rounded-xl border border-slate-800 p-4 ${
                    index === 2 ? 'bg-indigo-950/40 border-indigo-800/40' : 'bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] leading-4 text-slate-400">{label}</span>
                    <span className="hidden rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[9px] text-slate-300 lg:block">
                      {badge}
                    </span>
                  </div>
                  <p className="mt-2 text-xl font-semibold tracking-tight">
                    {shown.toLocaleString('es-ES')}{' '}
                    <span className="font-mono text-[10px] font-normal text-slate-400">{unit}</span>
                  </p>
                </div>
              )
            })}
          </div>

          {/* Métricas Adicionales */}
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Cpu size={14} />
                <span className="text-[11px]">Modelo activo</span>
              </div>
              <p className="mt-2 text-sm font-medium">
                Llama 3 <span className="text-slate-400">en Groq</span>
              </p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 font-mono text-[9px] text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {stats.model}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock3 size={14} />
                <span className="text-[11px]">Último turno</span>
              </div>
              <p className="mt-2 text-sm font-medium">
                {stats.latency || '—'}{' '}
                <span className="font-mono text-[10px] font-normal text-slate-400">ms</span>
              </p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                <Zap size={12} className="text-indigo-400" />
                {stats.speed || '—'} tok/s
              </div>
            </div>
          </div>

          {/* Botón Borrar Conversación */}
          <div className="mt-auto pt-5">
            <button
              onClick={clearChat}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-800/40 bg-rose-950/30 px-4 py-3 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-900/50"
            >
              <Trash2 size={15} /> Borrar Conversación
            </button>
            <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-widest text-slate-500">
              Session ID · GROQ-LLAMA3
            </p>
          </div>
        </aside>

        {/* ================= PANEL PRINCIPAL ================= */}
        <section className="flex min-h-0 flex-1 flex-col bg-slate-950">
          <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4 lg:px-8 bg-slate-900/30">
            <div className="flex items-center gap-3">
              <div className="relative flex size-10 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-950/40 text-indigo-400">
                <Bot size={21} />
                <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-slate-950 bg-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight">Habla con la Máquina</h1>
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Conversación · turno actual
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 font-mono text-[10px] text-emerald-400 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Groq Cloud Online
            </div>
          </header>

          {/* Mensajes */}
          <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-8 lg:px-16 xl:px-28">
            <div className="mx-auto max-w-3xl space-y-7">
              {messages.length === 0 && (
                <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-950/40 text-indigo-400">
                    <Sparkles size={24} />
                  </div>
                  <h2 className="text-lg font-semibold">Nueva sesión de inferencia</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                    Escribe un mensaje para empezar a conversar con Llama 3 y medir el consumo de tokens en tiempo real.
                  </p>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[85%] gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg ${
                        message.role === 'user' ? 'bg-indigo-600 text-white' : 'border border-slate-700 bg-slate-800 text-indigo-400'
                      }`}
                    >
                      {message.role === 'user' ? <UserRound size={14} /> : <Bot size={15} />}
                    </div>
                    <div className={message.role === 'user' ? 'text-right' : ''}>
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
                          message.role === 'user'
                            ? 'rounded-tr-sm bg-indigo-600 text-white shadow-md'
                            : 'rounded-tl-sm border border-slate-800 bg-slate-900 text-slate-200'
                        }`}
                      >
                        {message.content}
                      </div>
                      <p className="mt-1.5 px-1 font-mono text-[9px] text-slate-500">
                        {message.time} · {message.role === 'user' ? 'Tú' : 'Llama 3'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Estado Pensando... */}
              {thinking && (
                <div className="flex items-center gap-3">
                  <div className="flex size-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-indigo-400">
                    <Bot size={15} />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900 px-4 py-3">
                    <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.2s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.1s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-indigo-400" />
                    <span className="ml-1 font-mono text-[10px] text-slate-400">pensando...</span>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-800/40 bg-rose-950/30 p-4 text-sm text-rose-300">
                  <MessageSquareText size={16} className="mt-0.5 shrink-0 text-rose-400" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Input inferior */}
          <div className="border-t border-slate-800 bg-slate-900/40 px-5 py-5 lg:px-16 xl:px-28">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                sendMessage()
              }}
              className="mx-auto max-w-3xl"
            >
              <div className="flex items-end gap-3 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl focus-within:border-indigo-500">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      sendMessage()
                    }
                  }}
                  disabled={thinking}
                  rows={1}
                  placeholder="Escribe tu mensaje..."
                  aria-label="Mensaje para la máquina"
                  className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-500 disabled:opacity-50 text-slate-100"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || thinking}
                  aria-label="Enviar mensaje"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="mt-2 px-1 font-mono text-[10px] text-slate-500">
                Presiona <kbd className="rounded border border-slate-800 px-1.5 py-0.5 text-[9px] bg-slate-900">Enter</kbd> para enviar · <kbd className="rounded border border-slate-800 px-1.5 py-0.5 text-[9px] bg-slate-900">Shift + Enter</kbd> para una nueva línea
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  )
}