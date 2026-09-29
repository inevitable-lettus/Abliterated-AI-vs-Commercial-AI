import { Component, memo, useLayoutEffect, useRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type Msg = {
  id: number
  role: 'user' | 'ai'
  text: string
  status: 'streaming' | 'done' | 'error' | 'blocked' | 'cut'
  error?: string
  via?: string // model actually used, when the backend fell back
  blocked?: { reason: string; categories: string[] }
}

export type Health = { ok: boolean; detail: string; model: string } | null

type Props = {
  side: 'left' | 'right'
  label: string
  health: Health
  messages: Msg[]
}

/** If markdown rendering ever throws, show the raw text instead of blanking the panel. */
class SafeMarkdown extends Component<{ text: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render(): ReactNode {
    if (this.state.failed) return <p className="plain">{this.props.text}</p>
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ img: ({ alt }) => <span>[image: {alt}]</span> }}
      >
        {this.props.text}
      </ReactMarkdown>
    )
  }
}

const AiMessage = memo(function AiMessage({ m }: { m: Msg }) {
  const waiting = m.status === 'streaming' && !m.text
  return (
    <div className={`msg ai${m.status === 'blocked' && !m.text ? ' bare' : ''}`}>
      {waiting && (
        <div className="dots" aria-label="thinking">
          <span />
          <span />
          <span />
        </div>
      )}
      {m.text && (
        <div className="md">
          <SafeMarkdown text={m.text} />
          {m.status === 'streaming' && <span className="cursor" />}
        </div>
      )}
      {m.status === 'blocked' && m.blocked && (
        <div className="blocked-card">
          <div className="blocked-title">⛔ RESPONSE BLOCKED</div>
          <div className="blocked-sub">
            SAFETY FILTER{m.blocked.reason !== 'SAFETY' && ` · ${m.blocked.reason}`}
          </div>
          {m.blocked.categories.length > 0 && (
            <div className="chips">
              {m.blocked.categories.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {m.status === 'error' && <div className="err">⚠ {m.error}</div>}
      {m.status === 'cut' && <div className="cut">[ cut ]</div>}
      {m.via && <div className="via">via {m.via}</div>}
    </div>
  )
})

export function Panel({ side, label, health, messages }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)

  const onScroll = () => {
    const el = scroller.current
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const dot = health === null ? 'unknown' : health.ok ? 'ok' : 'bad'

  return (
    <section className={`panel ${side}`}>
      <header className="panel-head">
        <h2 className="panel-label" data-text={label}>
          {label}
        </h2>
        <div className="panel-meta">
          <span className={`status-dot ${dot}`} />
          <span className="model-tag">
            {health?.model.split('/').pop() ?? '…'}
            {health && !health.ok && ` · ${health.detail}`}
          </span>
        </div>
      </header>
      <div className="panel-body" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="empty">{side === 'left' ? '› awaiting input' : 'Ask me anything.'}</div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.text}
            </div>
          ) : (
            <AiMessage key={m.id} m={m} />
          ),
        )}
      </div>
    </section>
  )
}
