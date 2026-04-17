import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Language registry ────────────────────────────────────────────────────────
const LANGUAGES = {
  en: { name: 'English',  native: 'English',   flag: '🇺🇸', speech: 'en-US' },
  de: { name: 'German',   native: 'Deutsch',   flag: '🇩🇪', speech: 'de-DE' },
  fr: { name: 'French',   native: 'Français',  flag: '🇫🇷', speech: 'fr-FR' },
  hi: { name: 'Hindi',    native: 'हिन्दी',    flag: '🇮🇳', speech: 'hi-IN' },
  es: { name: 'Spanish',  native: 'Español',   flag: '🇪🇸', speech: 'es-ES' },
  pa: { name: 'Punjabi',  native: 'ਪੰਜਾਬੀ',   flag: '🇮🇳', speech: 'pa-IN' },
}

const LANG_KEYS = Object.keys(LANGUAGES)
const API_BASE  = 'https://live-translation-n5cf.onrender.com/'
const MAX_SUBS  = 6

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [sourceLang, setSourceLang]       = useState('en')
  const [targetLang, setTargetLang]       = useState('de')
  const [isListening, setIsListening]     = useState(false)
  const [backendOk, setBackendOk]         = useState(null)
  const [interimText, setInterimText]     = useState('')
  const [subtitles, setSubtitles]         = useState([])     // full history, never trimmed
  const [errorMsg, setErrorMsg]           = useState('')
  const [translating, setTranslating]     = useState(false)
  const [autoSpeak, setAutoSpeak]         = useState(false)
  const [speakingId, setSpeakingId]       = useState(null)
  const [convMode, setConvMode]           = useState(false)
  const [activeSpeaker, setActiveSpeaker] = useState(null)   // 'A' | 'B' | null
  const [copiedId, setCopiedId]           = useState(null)
  const [exportOpen, setExportOpen]       = useState(false)

  const recognitionRef  = useRef(null)
  const sourceLangRef   = useRef(sourceLang)
  const targetLangRef   = useRef(targetLang)
  const debounceTimer   = useRef(null)
  const interimRef      = useRef('')
  const subtitleEndRef  = useRef(null)
  const autoSpeakRef    = useRef(false)
  const speakRef        = useRef(null)
  const convModeRef     = useRef(false)
  const activeSpeakerRef = useRef(null)
  const exportRef       = useRef(null)

  // Keep refs in sync with state
  useEffect(() => { sourceLangRef.current  = sourceLang  }, [sourceLang])
  useEffect(() => { targetLangRef.current  = targetLang  }, [targetLang])
  useEffect(() => { autoSpeakRef.current   = autoSpeak   }, [autoSpeak])
  useEffect(() => { convModeRef.current    = convMode    }, [convMode])
  useEffect(() => { activeSpeakerRef.current = activeSpeaker }, [activeSpeaker])

  // Clear history + cancel TTS on lang change (regular mode only)
  useEffect(() => {
    if (!convModeRef.current) {
      window.speechSynthesis?.cancel()
      setSpeakingId(null)
      setSubtitles([])
    }
  }, [sourceLang, targetLang])

  // Close export dropdown on outside click
  useEffect(() => {
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ─── Backend health polling ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/health`)
        if (!cancelled) setBackendOk(r.ok)
      } catch {
        if (!cancelled) setBackendOk(false)
      }
    }
    check()
    const id = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Auto-scroll
  useEffect(() => {
    subtitleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitles])

  // Stop recognition when source lang changes (regular mode only)
  useEffect(() => {
    if (!convModeRef.current) {
      clearTimeout(debounceTimer.current)
      if (recognitionRef.current) {
        recognitionRef.current.onend = null
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
      interimRef.current = ''
      setInterimText('')
      setIsListening(false)
    }
  }, [sourceLang])

  // ─── TTS ──────────────────────────────────────────────────────────────────
  const speak = useCallback((text, lang, id) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang    = LANGUAGES[lang].speech
    utter.rate    = 0.95
    utter.onstart = () => setSpeakingId(id)
    utter.onend   = () => setSpeakingId(null)
    utter.onerror = () => setSpeakingId(null)
    window.speechSynthesis.speak(utter)
  }, [])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    setSpeakingId(null)
  }, [])

  useEffect(() => { speakRef.current = speak }, [speak])

  // ─── Translation (REST) ────────────────────────────────────────────────────
  // speaker: null (regular mode) | 'A' | 'B' (conversation mode)
  const sendForTranslation = useCallback(async (text, src, tgt, speaker = null) => {
    const clean = text.trim()
    if (!clean || src === tgt) return
    setTranslating(true)
    setErrorMsg('')
    try {
      const res = await fetch(`${API_BASE}/translate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: clean, source_lang: src, target_lang: tgt }),
      })
      const data = await res.json()
      if (data.status === 'success' && data.translated) {
        const newId = `${Date.now()}-${Math.random()}`
        setSubtitles(prev => [
          ...prev,
          { id: newId, original: data.original, translated: data.translated, speaker, timestamp: Date.now() },
        ])
        // Auto-speak: always in conversation mode, or when toggle is on in regular mode
        if (autoSpeakRef.current || convModeRef.current) {
          speakRef.current?.(data.translated, tgt, newId)
        }
      } else if (data.status === 'error') {
        setErrorMsg(`Translation error: ${data.error}`)
      }
    } catch (err) {
      setErrorMsg(`Cannot reach backend: ${err.message}`)
      setBackendOk(false)
    } finally {
      setTranslating(false)
    }
  }, [])

  // ─── Shared recognition builder ────────────────────────────────────────────
  const buildRecognition = useCallback((lang, onFinal, onEnd) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setErrorMsg('Speech recognition not supported — please use Chrome or Edge.')
      return null
    }
    const rec = new SR()
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = LANGUAGES[lang].speech

    // Per-recognition guard: prevents isFinal from re-sending a phrase that the
    // debounce timer already sent.  Both paths (debounce-fires-first and
    // isFinal-fires-first) are covered:
    //   • isFinal first → clearTimeout cancels debounce → no duplicate
    //   • debounce first → sets flag → isFinal branch checks flag and skips
    const debounceJustFired = { current: false }

    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const { transcript } = event.results[i][0]
        if (event.results[i].isFinal) {
          clearTimeout(debounceTimer.current)
          interimRef.current = ''
          if (!debounceJustFired.current) {
            onFinal(transcript)
          }
          debounceJustFired.current = false
          interim = ''
        } else {
          interim += transcript
        }
      }
      setInterimText(interim)
      interimRef.current = interim

      if (interim.trim()) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = setTimeout(() => {
          const text = interimRef.current.trim()
          if (text) {
            debounceJustFired.current = true
            interimRef.current = ''
            onFinal(text)
            // Safety reset: clear the flag if isFinal never arrives
            setTimeout(() => { debounceJustFired.current = false }, 2000)
          }
        }, 800)
      }
    }

    rec.onerror = (evt) => {
      if (evt.error === 'no-speech' || evt.error === 'aborted') return
      setErrorMsg(`Microphone error: ${evt.error}`)
    }

    rec.onend = () => {
      if (recognitionRef.current !== rec) return // superseded by a newer recognition
      clearTimeout(debounceTimer.current)
      const pending = interimRef.current.trim()
      if (pending) { interimRef.current = ''; onFinal(pending) }
      recognitionRef.current = null
      onEnd()
    }

    return rec
  }, [])

  // ─── Regular mode speech ───────────────────────────────────────────────────
  const startListening = useCallback(() => {
    setErrorMsg('')
    const rec = buildRecognition(
      sourceLangRef.current,
      (t) => sendForTranslation(t, sourceLangRef.current, targetLangRef.current, null),
      () => { setIsListening(false); setInterimText('') },
    )
    if (!rec) return
    rec.onstart = () => { setIsListening(true); setErrorMsg('') }
    recognitionRef.current = rec
    rec.start()
  }, [buildRecognition, sendForTranslation])

  const stopListening = useCallback(() => {
    clearTimeout(debounceTimer.current)
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    interimRef.current = ''
    setIsListening(false)
    setInterimText('')
  }, [])

  // ─── Conversation mode speech ──────────────────────────────────────────────
  const startConvSpeaker = useCallback((speaker) => {
    setErrorMsg('')
    // Silence any previous recognition without triggering its onend
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    clearTimeout(debounceTimer.current)
    interimRef.current = ''
    setInterimText('')

    const src = speaker === 'A' ? sourceLangRef.current : targetLangRef.current
    const tgt = speaker === 'A' ? targetLangRef.current : sourceLangRef.current

    const rec = buildRecognition(
      src,
      (t) => sendForTranslation(t, src, tgt, speaker),
      () => { setActiveSpeaker(null); setInterimText('') },
    )
    if (!rec) return
    rec.onstart = () => { setActiveSpeaker(speaker); setErrorMsg('') }
    recognitionRef.current = rec
    rec.start()
  }, [buildRecognition, sendForTranslation])

  const stopConvSpeaker = useCallback(() => {
    clearTimeout(debounceTimer.current)
    if (recognitionRef.current) {
      // Flush any pending interim text before stopping
      const pending = interimRef.current.trim()
      if (pending && activeSpeakerRef.current) {
        const spk = activeSpeakerRef.current
        const src = spk === 'A' ? sourceLangRef.current : targetLangRef.current
        const tgt = spk === 'A' ? targetLangRef.current : sourceLangRef.current
        interimRef.current = ''
        sendForTranslation(pending, src, tgt, spk)
      }
      recognitionRef.current.onend = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    interimRef.current = ''
    setActiveSpeaker(null)
    setInterimText('')
  }, [sendForTranslation])

  // Toggle conversation mode — clears state and stops everything
  const toggleConvMode = () => {
    if (isListening) stopListening()
    if (activeSpeaker) stopConvSpeaker()
    stopSpeaking()
    setSubtitles([])
    setInterimText('')
    setErrorMsg('')
    setConvMode(v => !v)
  }

  // ─── Language switching helpers ────────────────────────────────────────────
  const handleSourceChange = (lang) => {
    if (isListening) stopListening()
    if (lang === targetLang) setTargetLang(sourceLang)
    setSourceLang(lang)
  }

  const handleTargetChange = (lang) => {
    if (lang === sourceLang) setSourceLang(targetLang)
    setTargetLang(lang)
  }

  const handleSwap = () => {
    if (isListening) stopListening()
    setSourceLang(targetLang)
    setTargetLang(sourceLang)
  }

  const clearAll = () => {
    stopSpeaking()
    setSubtitles([])
    setInterimText('')
    setErrorMsg('')
  }

  // ─── Copy helpers ──────────────────────────────────────────────────────────
  const copySubtitle = (sub) => {
    navigator.clipboard.writeText(`${sub.original}\n${sub.translated}`).then(() => {
      setCopiedId(sub.id)
      setTimeout(() => setCopiedId(id => id === sub.id ? null : id), 1500)
    })
  }

  const copyAll = () => {
    const text = subtitles.map(s => {
      const srcName = LANGUAGES[s.speaker === 'B' ? targetLang : sourceLang].name
      const tgtName = LANGUAGES[s.speaker === 'B' ? sourceLang : targetLang].name
      return `[${srcName}] ${s.original}\n[${tgtName}] ${s.translated}`
    }).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId('all')
      setTimeout(() => setCopiedId(id => id === 'all' ? null : id), 1500)
    })
  }

  // ─── Export helpers ────────────────────────────────────────────────────────
  const toSrtTime = (ms) => {
    const h   = Math.floor(ms / 3600000)
    const m   = Math.floor((ms % 3600000) / 60000)
    const s   = Math.floor((ms % 60000) / 1000)
    const ms2 = ms % 1000
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms2).padStart(3,'0')}`
  }

  const triggerDownload = (content, filename, mime = 'text/plain') => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: mime }))
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Compute session metadata from the current subtitles array
  const sessionMeta = () => {
    const first      = subtitles[0]
    const last       = subtitles[subtitles.length - 1]
    const durationMs = first && last ? (last.timestamp - first.timestamp + 3000) : 0
    const dMins      = String(Math.floor(durationMs / 60000)).padStart(2, '0')
    const dSecs      = String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')
    const startDate  = first ? new Date(first.timestamp) : new Date()
    return {
      dateStr:     startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeStr:     startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      duration:    `${dMins}:${dSecs}`,
      durationMs,
      phraseCount: subtitles.length,
      mode:        convMode ? 'Conversation' : 'Subtitle',
    }
  }

  // filename: translation_en-de_20260416-1430.ext
  const sessionFilename = (ext) => {
    const now  = new Date()
    const date = now.toISOString().slice(0, 10)
    const time = now.toTimeString().slice(0, 5).replace(':', '')
    return `translation_${sourceLang}-${targetLang}_${date}_${time}.${ext}`
  }

  const exportTxt = () => {
    const meta = sessionMeta()
    const SEP  = '═'.repeat(44)
    const langBlock = convMode
      ? `  Language A : ${LANGUAGES[sourceLang].name} (Person A)\n  Language B : ${LANGUAGES[targetLang].name} (Person B)`
      : `  Speaking   : ${LANGUAGES[sourceLang].name}\n  Translating: ${LANGUAGES[targetLang].name}`
    const header = [
      'Translation Session Report',
      SEP,
      `  Date      : ${meta.dateStr}`,
      `  Time      : ${meta.timeStr}`,
      `  Mode      : ${meta.mode}`,
      langBlock,
      `  Duration  : ${meta.duration}`,
      `  Phrases   : ${meta.phraseCount}`,
      SEP,
    ].join('\n')

    const base  = subtitles[0]?.timestamp ?? Date.now()
    const lines = subtitles.map(s => {
      const elapsed  = s.timestamp - base
      const mm       = String(Math.floor(elapsed / 60000)).padStart(2, '0')
      const ss       = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')
      const srcName  = LANGUAGES[s.speaker === 'B' ? targetLang : sourceLang].name
      const tgtName  = LANGUAGES[s.speaker === 'B' ? sourceLang : targetLang].name
      const spkLabel = s.speaker ? `Person ${s.speaker} ` : ''
      return `[${mm}:${ss}] ${spkLabel}(${srcName})\n         → ${s.original}\n         ← ${s.translated} (${tgtName})`
    })

    triggerDownload(`${header}\n\n${lines.join('\n\n')}`, sessionFilename('txt'))
    setExportOpen(false)
  }

  const exportSrt = () => {
    const base   = subtitles[0]?.timestamp ?? Date.now()
    const blocks = subtitles.map((s, i) => {
      const start      = s.timestamp - base
      const end        = start + 3000
      const spkLabel   = s.speaker ? `[Person ${s.speaker}] ` : ''
      return `${i + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${spkLabel}${s.original}\n${s.translated}`
    })
    triggerDownload(blocks.join('\n\n'), sessionFilename('srt'))
    setExportOpen(false)
  }

  const exportJson = () => {
    const meta    = sessionMeta()
    const base    = subtitles[0]?.timestamp ?? Date.now()
    const payload = {
      session: {
        date:         subtitles[0] ? new Date(subtitles[0].timestamp).toISOString() : new Date().toISOString(),
        mode:         meta.mode.toLowerCase(),
        source_lang:  sourceLang,
        target_lang:  targetLang,
        duration_ms:  meta.durationMs,
        phrase_count: meta.phraseCount,
      },
      phrases: subtitles.map((s, i) => ({
        index:       i + 1,
        elapsed_ms:  s.timestamp - base,
        speaker:     s.speaker ?? null,
        source_lang: s.speaker === 'B' ? targetLang : sourceLang,
        target_lang: s.speaker === 'B' ? sourceLang : targetLang,
        original:    s.original,
        translated:  s.translated,
      })),
    }
    triggerDownload(JSON.stringify(payload, null, 2), sessionFilename('json'), 'application/json')
    setExportOpen(false)
  }

  // ─── Derived display values ────────────────────────────────────────────────
  const statusColor  = backendOk === null ? '#f59e0b' : backendOk ? '#10b981' : '#ef4444'
  const statusLabel  = backendOk === null ? 'Checking…' : backendOk ? 'Connected' : 'Offline'
  const displayedSubs = convMode ? subtitles : subtitles.slice(-MAX_SUBS)

  return (
    <div className="app">

      {/* ── Header ── */}
      <header className="header">
        <div>
          <h1 className="app-title">Live Translation</h1>
          <p className="app-sub">Real-time multilingual subtitles</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={`conv-toggle ${convMode ? 'active' : ''}`}
            onClick={toggleConvMode}
            title={convMode ? 'Exit conversation mode' : 'Two-way conversation mode'}
          >
            💬 {convMode ? 'Exit Conversation' : 'Conversation'}
          </button>
          <div className="status-pill">
            <span className="status-dot" style={{ background: statusColor }} />
            <span style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </header>

      {/* ── Language selector bar ── */}
      <div className="lang-bar">
        <div className="lang-col">
          <span className="lang-col-label">{convMode ? 'Person A speaks' : 'Speaking in'}</span>
          <LangDropdown value={sourceLang} onChange={handleSourceChange} exclude={targetLang} />
        </div>
        <button className="swap-btn" onClick={handleSwap} title="Swap languages">⇄</button>
        <div className="lang-col">
          <span className="lang-col-label">{convMode ? 'Person B speaks' : 'Translate to'}</span>
          <LangDropdown value={targetLang} onChange={handleTargetChange} exclude={sourceLang} />
        </div>
      </div>

      {/* ── Live speech panel (regular mode only) ── */}
      {!convMode && (
        <section className="panel speech-panel">
          <div className="panel-header">
            <span>
              {LANGUAGES[sourceLang].flag}&nbsp;
              Speaking in <strong>{LANGUAGES[sourceLang].name}</strong>
            </span>
            {isListening && <span className="live-badge">● LIVE</span>}
          </div>
          <div className={`speech-body ${isListening ? 'active' : ''}`}>
            {interimText ? (
              <span className="interim-text">{interimText}</span>
            ) : (
              <span className="placeholder-text">
                {isListening ? 'Listening… speak now' : 'Press Start to begin speaking'}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── Subtitle / Conversation panel ── */}
      <section className={`panel ${convMode ? 'conv-panel' : 'subtitle-panel'}`}>
        <div className="panel-header">
          <span>
            {convMode
              ? '💬 Conversation'
              : <>{LANGUAGES[targetLang].flag}&nbsp;Translation — <strong>{LANGUAGES[targetLang].name}</strong></>
            }
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {translating && <span className="translating-dot">⟳</span>}
            {!convMode && (
              <button
                className={`tts-toggle ${autoSpeak ? 'active' : ''}`}
                onClick={() => { if (autoSpeak) stopSpeaking(); setAutoSpeak(v => !v) }}
                title={autoSpeak ? 'Disable auto-speak' : 'Enable auto-speak'}
              >
                {autoSpeak ? '🔊 Auto-Speak' : '🔇 Auto-Speak'}
              </button>
            )}
            {subtitles.length > 0 && (
              <>
                <button className="text-btn" onClick={copyAll}>
                  {copiedId === 'all' ? '✓ Copied' : '⎘ Copy All'}
                </button>
                <div className="export-wrap" ref={exportRef}>
                  <button
                    className={`export-btn ${exportOpen ? 'open' : ''}`}
                    onClick={() => setExportOpen(v => !v)}
                  >
                    ↓ Export {exportOpen ? '▴' : '▾'}
                  </button>
                  {exportOpen && (
                    <div className="export-menu">
                      <div className="export-summary">
                        {(() => { const m = sessionMeta(); return `${m.phraseCount} phrase${m.phraseCount !== 1 ? 's' : ''} · ${LANGUAGES[sourceLang].name} → ${LANGUAGES[targetLang].name} · ${m.duration}` })()}
                      </div>
                      <button className="export-option" onClick={exportTxt}>
                        <span className="export-icon">📄</span>
                        <div>
                          <div className="export-option-name">Download as .txt</div>
                          <div className="export-option-desc">Session report with header &amp; timestamps</div>
                        </div>
                      </button>
                      <button className="export-option" onClick={exportSrt}>
                        <span className="export-icon">🎬</span>
                        <div>
                          <div className="export-option-name">Download as .srt</div>
                          <div className="export-option-desc">Subtitle file with timecodes</div>
                        </div>
                      </button>
                      <button className="export-option" onClick={exportJson}>
                        <span className="export-icon">📋</span>
                        <div>
                          <div className="export-option-name">Download as .json</div>
                          <div className="export-option-desc">Full session archive, machine-readable</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
                <button className="text-btn" onClick={clearAll}>Clear</button>
              </>
            )}
          </div>
        </div>

        {convMode ? (
          /* ── Conversation chat view ── */
          <div className="conv-list">
            {subtitles.length === 0 && !activeSpeaker ? (
              <div className="placeholder-center">
                Press a speaker button below to start the conversation…
              </div>
            ) : (
              displayedSubs.map(sub => (
                <div
                  key={sub.id}
                  className={`conv-bubble ${sub.speaker === 'B' ? 'bubble-b' : 'bubble-a'} ${speakingId === sub.id ? 'speaking' : ''}`}
                >
                  <div className="bubble-speaker-label">
                    {sub.speaker === 'A'
                      ? `${LANGUAGES[sourceLang].flag} Person A`
                      : `${LANGUAGES[targetLang].flag} Person B`}
                  </div>
                  <div className="bubble-original">{sub.original}</div>
                  <div className="bubble-divider" />
                  <div className="bubble-translated">{sub.translated}</div>
                  <div className="bubble-actions">
                    <button
                      className={`tts-play-btn ${speakingId === sub.id ? 'speaking' : ''}`}
                      onClick={() => speakingId === sub.id
                        ? stopSpeaking()
                        : speak(sub.translated, sub.speaker === 'A' ? targetLang : sourceLang, sub.id)}
                      title={speakingId === sub.id ? 'Stop speaking' : 'Play translation'}
                    >
                      {speakingId === sub.id ? '⏸' : '🔊'}
                    </button>
                    <button
                      className="copy-btn"
                      onClick={() => copySubtitle(sub)}
                      title="Copy"
                    >
                      {copiedId === sub.id ? '✓' : '⎘'}
                    </button>
                  </div>
                </div>
              ))
            )}
            {/* Live interim bubble */}
            {activeSpeaker && interimText && (
              <div className={`conv-bubble ${activeSpeaker === 'B' ? 'bubble-b' : 'bubble-a'} interim`}>
                <div className="bubble-speaker-label">
                  {activeSpeaker === 'A'
                    ? `${LANGUAGES[sourceLang].flag} Person A`
                    : `${LANGUAGES[targetLang].flag} Person B`}
                </div>
                <span className="interim-text">{interimText}</span>
              </div>
            )}
            <div ref={subtitleEndRef} />
          </div>
        ) : (
          /* ── Regular subtitle list ── */
          <div className="subtitle-list">
            {displayedSubs.length === 0 ? (
              <div className="placeholder-center">Translated subtitles will appear here…</div>
            ) : (
              displayedSubs.map((sub, i) => (
                <div
                  key={sub.id}
                  className={`sub-item ${i === displayedSubs.length - 1 ? 'latest' : 'faded'} ${speakingId === sub.id ? 'speaking' : ''}`}
                >
                  <div className="sub-original">{sub.original}</div>
                  <div className="sub-translated-row">
                    <div className="sub-translated">{sub.translated}</div>
                    <button
                      className={`tts-play-btn ${speakingId === sub.id ? 'speaking' : ''}`}
                      onClick={() => speakingId === sub.id ? stopSpeaking() : speak(sub.translated, targetLang, sub.id)}
                      title={speakingId === sub.id ? 'Stop speaking' : 'Play translation'}
                    >
                      {speakingId === sub.id ? '⏸' : '🔊'}
                    </button>
                    <button
                      className="copy-btn"
                      onClick={() => copySubtitle(sub)}
                      title="Copy"
                    >
                      {copiedId === sub.id ? '✓' : '⎘'}
                    </button>
                  </div>
                </div>
              ))
            )}
            <div ref={subtitleEndRef} />
          </div>
        )}
      </section>

      {/* ── Error banner ── */}
      {errorMsg && (
        <div className="error-banner">
          ⚠ {errorMsg}
          <button className="text-btn ml" onClick={() => setErrorMsg('')}>✕</button>
        </div>
      )}

      {/* ── Controls ── */}
      {convMode ? (
        <div className="conv-controls">
          <button
            className={`conv-mic-btn ${activeSpeaker === 'A' ? 'active' : ''}`}
            onClick={() => activeSpeaker === 'A' ? stopConvSpeaker() : startConvSpeaker('A')}
            disabled={!backendOk}
          >
            {activeSpeaker === 'A'
              ? '⏹ Stop'
              : `🎤 ${LANGUAGES[sourceLang].flag} Person A`}
          </button>
          <button
            className={`conv-mic-btn ${activeSpeaker === 'B' ? 'active' : ''}`}
            onClick={() => activeSpeaker === 'B' ? stopConvSpeaker() : startConvSpeaker('B')}
            disabled={!backendOk}
          >
            {activeSpeaker === 'B'
              ? '⏹ Stop'
              : `🎤 ${LANGUAGES[targetLang].flag} Person B`}
          </button>
        </div>
      ) : (
        <div className="controls">
          <button
            className={`mic-btn ${isListening ? 'stop' : 'start'}`}
            onClick={isListening ? stopListening : startListening}
            disabled={!isListening && !backendOk}
          >
            {isListening ? '⏹ Stop Recording' : '🎤 Start Speaking'}
          </button>
        </div>
      )}

      {backendOk === false && (
        <div className="warn-banner">
          Backend not running — start it:&nbsp;
          <code>cd backend &amp;&amp; .venv/bin/uvicorn main:app --reload</code>
        </div>
      )}

      {(isListening || activeSpeaker) && (
        <div className="rec-bar">
          <span className="rec-pulse" />
          {activeSpeaker
            ? `Person ${activeSpeaker} speaking in ${LANGUAGES[activeSpeaker === 'A' ? sourceLang : targetLang].name}…`
            : `Recording in ${LANGUAGES[sourceLang].name}…`}
        </div>
      )}
    </div>
  )
}

// ─── Language Dropdown ────────────────────────────────────────────────────────
function LangDropdown({ value, onChange, exclude }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const lang = LANGUAGES[value]

  return (
    <div className="lang-dropdown-wrap" ref={ref}>
      <button
        className={`lang-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="trig-flag">{lang.flag}</span>
        <div className="trig-text">
          <span className="trig-name">{lang.name}</span>
          <span className="trig-native">{lang.native}</span>
        </div>
        <span className={`trig-chevron ${open ? 'up' : ''}`}>▾</span>
      </button>

      {open && (
        <ul className="lang-menu" role="listbox">
          {LANG_KEYS.filter(k => k !== exclude).map(k => (
            <li
              key={k}
              role="option"
              aria-selected={k === value}
              className={`lang-option ${k === value ? 'selected' : ''}`}
              onClick={() => { onChange(k); setOpen(false) }}
            >
              <span className="opt-flag">{LANGUAGES[k].flag}</span>
              <div className="opt-text">
                <span className="opt-name">{LANGUAGES[k].name}</span>
                <span className="opt-native">{LANGUAGES[k].native}</span>
              </div>
              {k === value && <span className="opt-tick">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
