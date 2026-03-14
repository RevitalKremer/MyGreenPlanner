import { useState, useRef } from 'react'

export default function WelcomeScreen({ onCreateProject, onImportProject }) {
  const [mode, setMode] = useState(null) // 'new' | 'import'
  const [projectName, setProjectName] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [importError, setImportError] = useState(null)
  const fileInputRef = useRef(null)

  const canCreate = projectName.trim().length > 0

  const handleCreate = () => {
    if (!canCreate) return
    onCreateProject({ name: projectName.trim(), location: location.trim(), date })
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.version || !data.project) throw new Error('Invalid project file')
        onImportProject(data)
      } catch {
        setImportError('Could not read project file. Make sure it is a valid .mgp file.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #f5f7fa 0%, #e8f0d8 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'inherit'
    }}>
      {/* Logo + title */}
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <img src="/logo.svg" alt="MyGreenPlanner" style={{ width: '72px', height: '72px', marginBottom: '1rem' }} />
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '2.2rem', fontWeight: '800', color: '#333' }}>
          MyGreenPlanner
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#888', fontWeight: '400' }}>
          Solar PV Roof Planning System
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '780px' }}>

        {/* New Project card */}
        <div style={{
          flex: '1 1 320px', maxWidth: '360px',
          background: 'white', borderRadius: '16px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          border: `2px solid ${mode === 'new' ? '#C4D600' : '#e8e8e8'}`,
          overflow: 'hidden', transition: 'border-color 0.15s'
        }}>
          <div
            onClick={() => setMode(mode === 'new' ? null : 'new')}
            style={{
              padding: '1.5rem 1.75rem', cursor: 'pointer',
              background: mode === 'new' ? '#f9fced' : 'white',
              display: 'flex', alignItems: 'center', gap: '1rem',
              borderBottom: mode === 'new' ? '1px solid #e8f0aa' : 'none',
              transition: 'background 0.15s'
            }}
          >
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px',
              background: '#C4D600', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', flexShrink: 0
            }}>＋</div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: '#333' }}>New Project</div>
              <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '2px' }}>Start a new solar planning session</div>
            </div>
          </div>

          {mode === 'new' && (
            <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#555', marginBottom: '0.4rem' }}>
                  Project Name <span style={{ color: '#e53935' }}>*</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Smith Residence"
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: '1.5px solid #e0e0e0', borderRadius: '8px',
                    fontSize: '0.92rem', outline: 'none',
                    borderColor: projectName.trim() ? '#C4D600' : '#e0e0e0'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#555', marginBottom: '0.4rem' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Tel Aviv, Israel"
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: '1.5px solid #e0e0e0', borderRadius: '8px', fontSize: '0.92rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#555', marginBottom: '0.4rem' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: '1.5px solid #e0e0e0', borderRadius: '8px', fontSize: '0.92rem'
                  }}
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!canCreate}
                style={{
                  width: '100%', padding: '0.75rem',
                  background: canCreate ? '#C4D600' : '#e0e0e0',
                  color: canCreate ? '#333' : '#aaa',
                  border: 'none', borderRadius: '8px',
                  cursor: canCreate ? 'pointer' : 'default',
                  fontWeight: '700', fontSize: '0.95rem',
                  transition: 'background 0.15s'
                }}
              >
                Start Planning →
              </button>
            </div>
          )}
        </div>

        {/* Import Project card */}
        <div style={{
          flex: '1 1 320px', maxWidth: '360px',
          background: 'white', borderRadius: '16px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          border: `2px solid ${mode === 'import' ? '#2196F3' : '#e8e8e8'}`,
          overflow: 'hidden', transition: 'border-color 0.15s'
        }}>
          <div
            onClick={() => { setMode(mode === 'import' ? null : 'import'); setImportError(null) }}
            style={{
              padding: '1.5rem 1.75rem', cursor: 'pointer',
              background: mode === 'import' ? '#f0f7ff' : 'white',
              display: 'flex', alignItems: 'center', gap: '1rem',
              borderBottom: mode === 'import' ? '1px solid #BBDEFB' : 'none',
              transition: 'background 0.15s'
            }}
          >
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px',
              background: '#2196F3', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.4rem', flexShrink: 0, color: 'white'
            }}>📂</div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: '#333' }}>Import Project</div>
              <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '2px' }}>Resume from a saved .mgp file</div>
            </div>
          </div>

          {mode === 'import' && (
            <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
              <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666', lineHeight: 1.5 }}>
                Select a <strong>.mgp</strong> project file exported from a previous session.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: '0.75rem',
                  background: '#2196F3', color: 'white',
                  border: 'none', borderRadius: '8px',
                  cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem'
                }}
              >
                Select File…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mgp,.json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {importError && (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#e53935', background: '#FFEBEE', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                  {importError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop: '3rem', fontSize: '0.75rem', color: '#bbb' }}>
        MyGreenPlanner © {new Date().getFullYear()}
      </p>
    </div>
  )
}
