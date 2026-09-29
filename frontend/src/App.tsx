import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Panel, type Health, type Msg } from './Panel'
import { streamChat, type StreamEvent } from './stream'

type Side = 'left' | 'right'
const SIDES: Side[] = ['left', 'right']
const ENDPOINT: Record<Side, string> = { left: '/api/uncensored', right: '/api/guarded' }
const HEALTH_POLL_MS = 10_000

export default function App() {
  const [msgs, setMsgs] = useState<Record<Side, Msg[]>>({ left: [], right: [] })
  const [health, setHealth] = useState<Record<Side, Health>>({ left: null, right: null })
  const [killed, setKilled] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<Record<Side, boolean>>({ left: false, right: false })

  const nextId = useRef(1)
  const controllers = useRef<Partial<Record<Side, AbortController>>>({})
  const activeId = useRef<Partial<Record<Side, number>>>({})
  const pending = useRef(new Map<string, string>()) // "side:id" -> buffered delta text
  const raf = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const patch = useCallback((side: Side, id: number, fn: (m: Msg) => Msg) => {
    setMsgs((prev) => ({ ...prev, [side]: prev[side].map((m) => (m.id === id ? fn(m) : m)) }))
  }, [])

  // Batch token deltas into one React update per animation frame.
  const flush = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
    for (const [key, text] of pending.current) {
      const [side, id] = key.split(':')
      patch(side as Side, Number(id), (m) => ({ ...m, text: m.text + text }))
    }
    pending.current.clear()
  }, [patch])

  const abortAll = useCallback(() => {
    flush()
    for (const side of SIDES) {
      const id = activeId.current[side]
      controllers.current[side]?.abort()
      controllers.current[side] = undefined
      activeId.current[side] = undefined
      if (id !== undefined) {
        patch(side, id, (m) => (m.status === 'streaming' ? { ...m, status: 'cut' } : m))
      }
    }
    setBusy({ left: false, right: false })
  }, [flush, patch])

  const handleEvent = useCallback(
    (side: Side, id: number, ctrl: AbortController, e: StreamEvent) => {
      if (ctrl.signal.aborted) return
      if (e.t === 'delta') {
        const key = `${side}:${id}`
        pending.current.set(key, (pending.current.get(key) ?? '') + e.text)
        if (!raf.current) raf.current = requestAnimationFrame(flush)
        return
      }
      if (e.t === 'model') {
        patch(side, id, (m) => ({ ...m, via: e.name }))
        return
      }
      flush()
      patch(side, id, (m) => {
        if (e.t === 'error') return { ...m, status: 'error', error: e.message }
        if (e.t === 'blocked') return { ...m, status: 'blocked', blocked: e }
        if (!m.text) return { ...m, status: 'error', error: 'Model returned nothing' }
        return { ...m, status: 'done' }
      })
      if (controllers.current[side] === ctrl) {
        controllers.current[side] = undefined
        activeId.current[side] = undefined
        setBusy((b) => ({ ...b, [side]: false }))
      }
    },
    [flush, patch],
  )

  const send = (e?: FormEvent) => {
    e?.preventDefault()
    const prompt = input.trim()
    if (!prompt || killed) return
    abortAll()
    setInput('')

    const turn = `${Date.now()}-${nextId.current}` // pairs both answers in log.md
    const added: Partial<Record<Side, Msg[]>> = {}
    for (const side of SIDES) {
      const aiId = nextId.current + 1
      added[side] = [
        { id: nextId.current, role: 'user', text: prompt, status: 'done' },
        { id: aiId, role: 'ai', text: '', status: 'streaming' },
      ]
      nextId.current += 2

      const ctrl = new AbortController()
      controllers.current[side] = ctrl
      activeId.current[side] = aiId
      streamChat(ENDPOINT[side], prompt, turn, ctrl.signal, (ev) => handleEvent(side, aiId, ctrl, ev))
    }
    setMsgs((prev) => ({ left: [...prev.left, ...added.left!], right: [...prev.right, ...added.right!] }))
    setBusy({ left: true, right: true })
  }

  const clear = () => {
    abortAll()
    setMsgs({ left: [], right: [] })
    inputRef.current?.focus()
  }

  const kill = useCallback(() => {
    abortAll()
    setKilled(true)
  }, [abortAll])

  // Esc = kill switch toggle. Capture phase so it works even while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (killed) setKilled(false)
      else kill()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [killed, kill])

  useEffect(() => {
    if (!killed) inputRef.current?.focus()
  }, [killed])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
        const h = await r.json()
        if (alive) setHealth({ left: h.uncensored, right: h.guarded })
      } catch {
        const down = { ok: false, detail: 'backend down', model: '?' }
        if (alive) setHealth((prev) => ({
          left: { ...down, model: prev.left?.model ?? '?' },
          right: { ...down, model: prev.right?.model ?? '?' },
        }))
      }
    }
    poll()
    const t = setInterval(poll, HEALTH_POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return (
    <div className="app">
      <header className="top">
        <h1 className="title">
          <span className="t-left">UNCENSORED AI</span>
          <span className="t-vs">vs</span>
          <span className="t-right">COMMERCIAL AI</span>
        </h1>
        <div className="controls">
          <button type="button" className="btn clear" onClick={clear}>
            CLEAR
          </button>
          <button type="button" className="btn kill" onClick={kill}>
            KILL <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      <form className="ask" onSubmit={send}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask both AIs the same question…"
          autoFocus
          spellCheck={false}
        />
        <button type="submit" className="btn send" disabled={!input.trim()}>
          {busy.left || busy.right ? 'SEND ↻' : 'SEND'}
        </button>
      </form>

      <main className="split">
        <Panel side="left" label="UNCENSORED" health={health.left} messages={msgs.left} />
        <div className="vs-badge">VS</div>
        <Panel side="right" label="COMMERCIAL" health={health.right} messages={msgs.right} />
      </main>

      {killed && (
        <div className="standby" onDoubleClick={() => setKilled(false)}>
          <div className="standby-text">STANDBY</div>
          <div className="standby-hint">Esc or double-click to resume</div>
        </div>
      )}
    </div>
  )
}
