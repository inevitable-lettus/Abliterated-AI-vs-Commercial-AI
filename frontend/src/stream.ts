export type StreamEvent =
  | { t: 'delta'; text: string }
  | { t: 'blocked'; reason: string; categories: string[] }
  | { t: 'error'; message: string }
  | { t: 'model'; name: string } // backend fell back to another model
  | { t: 'done' }

const HARD_TIMEOUT_MS = 120_000

/**
 * POST the prompt and feed each NDJSON line to onEvent.
 * Always ends with exactly one terminal event (done / blocked / error),
 * unless the caller aborted, in which case it ends silently.
 */
export async function streamChat(
  endpoint: string,
  prompt: string,
  turn: string,
  signal: AbortSignal,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const timeout = AbortSignal.timeout(HARD_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, timeout])
  let finished = false
  const emit = (e: StreamEvent) => {
    if (finished) return
    if (e.t !== 'delta' && e.t !== 'model') finished = true
    onEvent(e)
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, turn }),
      signal: combined,
    })
    if (!res.ok || !res.body) {
      emit({ t: 'error', message: `Server error ${res.status}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!raw) continue
        try {
          emit(JSON.parse(raw) as StreamEvent)
        } catch {
          /* skip a malformed line rather than kill the answer */
        }
      }
    }
    emit({ t: 'done' })
  } catch (err) {
    if (signal.aborted) return
    emit({
      t: 'error',
      message: timeout.aborted ? 'Timed out' : 'Connection to backend lost',
    })
  }
}
