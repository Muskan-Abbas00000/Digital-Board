import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './App.css'

type Action = { type: 'diagram' | 'text' | 'formula' | 'highlight' | 'clear'; content: string; after_sentence: number }
type Scene = { title: string; narration: string; actions: Action[] }
type Block = { id: string; type: Action['type']; content: string }
type Message = { type: string; state?: string; scene?: Scene; index?: number; total?: number; aside?: boolean; message?: string }

const API = (import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://localhost:8000' : window.location.origin)).replace(/\/$/, '')
const WS = API.replace(/^http/, 'ws') + '/ws'
const examples = ['How does photosynthesis work?', 'Explain the TCP handshake', 'Teach me the Pythagorean theorem']
const splitSentences = (value: string) => value.match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [value]

function Diagram({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    mermaid.render(`diagram-${Math.random().toString(36).slice(2)}`, code)
      .then(({ svg: rendered }) => { if (live) { setSvg(rendered); setFailed(false) } })
      .catch(() => { if (live) { setSvg(''); setFailed(true) } })
    return () => { live = false }
  }, [code])
  if (failed) return <pre className="diagram-error">This diagram could not be rendered.</pre>
  return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

function BoardBlock({ block }: { block: Block }) {
  if (block.type === 'diagram') return <Diagram code={block.content} />
  if (block.type === 'formula') {
    try {
      return <div className="formula" dangerouslySetInnerHTML={{ __html: katex.renderToString(block.content, { throwOnError: false, strict: 'ignore' }) }} />
    } catch { return <div className="formula">{block.content}</div> }
  }
  if (block.type === 'text') return <div className="board-note"><span className="note-mark">✳</span>{block.content}</div>
  return null
}

function App() {
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState('beginner')
  const [status, setStatus] = useState('idle')
  const [connected, setConnected] = useState(false)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [sceneTitle, setSceneTitle] = useState('Your lesson will appear here')
  const [sceneIndex, setSceneIndex] = useState(-1)
  const [sceneTotal, setSceneTotal] = useState(0)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [listening, setListening] = useState(false)
  const [question, setQuestion] = useState('')
  const socket = useRef<WebSocket | null>(null)
  const recognition = useRef<any>(null)
  const runId = useRef(0)
  const blockId = useRef(0)
  const blocksRef = useRef<Block[]>([])
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  blocksRef.current = blocks

  const addAction = (action: Action) => {
    if (action.type === 'clear') { setBlocks([]); blocksRef.current = []; return }
    if (action.type === 'highlight') return
    const next = [...blocksRef.current, { id: `block-${blockId.current++}`, type: action.type, content: action.content }]
    blocksRef.current = next
    setBlocks(next)
  }

  const playScene = async (scene: Scene, index: number, total: number, aside = false) => {
    const run = ++runId.current
    setSceneTitle(scene.title)
    if (!aside) { setSceneIndex(index); setSceneTotal(total) }
    setStatus('speaking')
    const sentences = splitSentences(scene.narration)
    for (let i = 0; i < sentences.length; i++) {
      if (run !== runId.current) return
      scene.actions.filter((action) => action.after_sentence === i).forEach(addAction)
      if (!mutedRef.current && 'speechSynthesis' in window) {
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(sentences[i])
          utterance.rate = 0.96
          utterance.onend = () => resolve()
          utterance.onerror = () => resolve()
          window.speechSynthesis.speak(utterance)
        })
      }
    }
    if (run === runId.current) {
      setStatus('waiting')
      socket.current?.readyState === WebSocket.OPEN && socket.current.send(JSON.stringify({ type: 'scene_done' }))
    }
  }

  useEffect(() => {
    let disposed = false
    let retryTimer: number | undefined
    let activeSocket: WebSocket | null = null

    const connect = () => {
      if (disposed) return
      const ws = new WebSocket(WS)
      activeSocket = ws
      socket.current = ws
      ws.onopen = () => { setConnected(true); setError('') }
      ws.onclose = () => {
        if (disposed) return
        setConnected(false)
        setStatus((current) => current === 'idle' ? current : 'disconnected')
        setError('Lesson server disconnected. Reconnecting…')
        retryTimer = window.setTimeout(connect, 1500)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (event) => {
        let message: Message
        try { message = JSON.parse(event.data) as Message }
        catch { setError('Received an invalid response from the lesson server.'); return }
        if (message.type === 'status') { setStatus(message.state || 'thinking'); if (message.state === 'planning') { setBlocks([]); blocksRef.current = []; setSceneIndex(-1); setSceneTotal(0) } }
        else if (message.type === 'scene' && message.scene) void playScene(message.scene, message.index ?? 0, message.total ?? 0, message.aside)
        else if (message.type === 'pause') { runId.current++; window.speechSynthesis?.cancel(); setStatus('listening') }
        else if (message.type === 'resume') setStatus('thinking')
        else if (message.type === 'done') setStatus('complete')
        else if (message.type === 'error') { setError(message.message || 'The lesson could not be generated.'); setStatus('error') }
      }
    }

    connect()
    return () => {
      disposed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      runId.current++
      window.speechSynthesis?.cancel()
      activeSocket?.close()
      socket.current = null
    }
  }, [])

  const send = (message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
    else setError('The lesson server is disconnected. Start the backend and refresh this page.')
  }

  const startLesson = (value = topic) => {
    const clean = value.trim()
    if (!clean) return
    setTopic(clean); setError(''); setBlocks([]); blocksRef.current = []; setSceneTitle('Planning your lesson…'); setStatus('planning')
    send({ type: 'start', topic: clean, level })
  }

  const askQuestion = (value = question) => {
    const clean = value.trim()
    if (!clean) return
    setQuestion(''); window.speechSynthesis?.cancel(); runId.current++
    send({ type: 'interrupt', text: clean })
  }

  const toggleMic = () => {
    if (listening) { recognition.current?.stop(); setListening(false); return }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) { setError('Voice input is not available in this browser. Type your question below.'); return }
    const recognizer = new SpeechRecognition()
    recognition.current = recognizer
    recognizer.lang = 'en-US'; recognizer.interimResults = false
    recognizer.onresult = (event: any) => { const spoken = event.results[0][0].transcript; setQuestion(spoken); askQuestion(spoken) }
    recognizer.onerror = () => setError('Microphone input failed. Check browser microphone permission or type below.')
    recognizer.onend = () => setListening(false)
    try { recognizer.start(); setListening(true); setError('') } catch { setError('Could not start microphone. Check browser permission.') }
  }

  const statusLabel = status === 'idle' ? 'Ready when you are' : status === 'planning' ? 'Planning lesson' : status === 'writing' || status === 'thinking' ? 'Thinking' : status === 'speaking' ? 'Teaching' : status === 'waiting' ? 'Your turn' : status === 'complete' ? 'Lesson complete' : status === 'listening' ? 'Listening' : status === 'disconnected' ? 'Disconnected' : status

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="Chalkboard home"><span className="brand-icon">✳</span><span>chalk<span className="brand-light">board</span></span></a>
      <div className="topbar-right"><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Connected' : 'Connecting'}</span><span className="model-pill"><span className="sparkle">✦</span> Gemini API · Gemma fallback</span></div>
    </header>

    <section className="workspace">
      <aside className="sidebar">
        <div className="eyebrow">YOUR LEARNING SPACE</div>
        <div className="sidebar-heading">What would you<br />like to learn?</div>
        <form className="topic-form" onSubmit={(event) => { event.preventDefault(); startLesson() }}>
          <label htmlFor="topic">TOPIC</label>
          <textarea id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="A concept, question, or idea…" rows={3} />
          <div className="form-row"><label htmlFor="level">LEVEL</label><select id="level" value={level} onChange={(event) => setLevel(event.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div>
          <button className="start-button" type="submit" disabled={!connected || !topic.trim()}><span>Start teaching</span><span>↗</span></button>
        </form>
        <div className="suggestions"><div className="eyebrow">NEED AN IDEA?</div>{examples.map((example, i) => <button className="suggestion" key={example} onClick={() => { setTopic(example); startLesson(example) }}><span className="suggestion-icon">{['◉', '⌘', '△'][i]}</span><span>{example}</span><span className="suggestion-arrow">↗</span></button>)}</div>
        <div className="sidebar-footer"><span className="privacy-dot" />Your API key stays on the server</div>
      </aside>

      <section className="lesson-area">
        <div className="lesson-toolbar"><div className="lesson-status"><span className={`status-orb ${status}`} />{statusLabel}</div><div className="toolbar-actions"><button className={`tool-button ${muted ? 'active' : ''}`} onClick={() => { setMuted(!muted); if (!muted) window.speechSynthesis?.cancel() }} title={muted ? 'Turn voice on' : 'Mute voice'}>{muted ? '◌' : '♫'}<span>{muted ? 'Voice off' : 'Voice on'}</span></button><button className="tool-button" onClick={() => { window.speechSynthesis?.cancel(); runId.current++; setStatus('idle'); setSceneTitle('Your lesson will appear here') }} title="Clear board">↺<span>Reset</span></button></div></div>
        <div className="lesson-meta"><div><div className="eyebrow">LIVE LESSON</div><h1>{sceneTitle}</h1></div>{sceneTotal > 0 && <div className="progress-wrap"><span>SCENE {Math.max(sceneIndex + 1, 1)} OF {sceneTotal}</span><div className="progress-track">{Array.from({ length: sceneTotal }, (_, i) => <i className={i <= sceneIndex ? 'filled' : ''} key={i} />)}</div></div>}</div>
        <div className={`board ${blocks.length === 0 ? 'board-empty' : ''}`}>
          {blocks.length === 0 ? <div className="empty-board"><div className="board-doodle"><span className="doodle-star">✳</span><span className="doodle-line" /><span className="doodle-circle" /></div><div className="empty-title">A little curiosity goes a long way.</div><p>Start a lesson and your ideas will take shape here.</p><div className="board-grid-mark">✳ &nbsp; YOUR INTERACTIVE BOARD</div></div> : <div className="board-content">{blocks.map((block) => <BoardBlock key={block.id} block={block} />)}</div>}
          <div className="board-corner">CHALKBOARD <span>·</span> LIVE</div>
        </div>
        <div className="lesson-footer"><div className="turn-indicator"><span className={status === 'speaking' ? 'wave speaking' : 'wave'}><i/><i/><i/><i/><i/></span>{status === 'speaking' ? 'Your teacher is speaking' : status === 'complete' ? 'Nice work — you made it through' : 'Ask a question anytime'}</div><form className="question-form" onSubmit={(event) => { event.preventDefault(); askQuestion() }}><button type="button" className={`mic-button ${listening ? 'listening' : ''}`} aria-label="Speak a question" onClick={toggleMic}>⌁</button><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question or say ‘explain that again’…" aria-label="Ask your teacher a question"/><button className="send-button" type="submit" disabled={!question.trim()} aria-label="Send question">↑</button></form></div>
        {error && <div className="error-banner" role="alert"><span>!</span>{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      </section>
    </section>
    <footer className="app-footer"><span>Made for the beautifully curious.</span><span>LESSON STUDIO <b>01</b></span></footer>
  </main>
}

export default App
