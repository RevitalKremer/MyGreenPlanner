import { TEXT_DARK, TEXT_FAINT, TEXT_LIGHT, BORDER_FAINT, PRIMARY_BG } from '../styles/colors'
import { useLang } from '../i18n/LangContext'
import ProjectForm from './ProjectForm'

// Read-only view of the project's saved settings. Reuses ProjectForm so the
// layout matches the new-project form 1:1; only the caption and the readOnly
// flag differ.
export default function ProjectInfoModal({ project, onClose }: { project: any; onClose: () => void }) {
  const { t } = useLang()
  // Date inputs expect YYYY-MM-DD — strip any ISO timestamp suffix.
  const dateValue = project?.date ? String(project.date).split('T')[0] : ''
  const roofSpec = project?.roofSpec ?? {}
  const formatStamp = (raw: string | null | undefined) => raw
    ? new Date(raw).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null
  const chargedAt           = formatStamp(project?.credits_charged_at)
  const quotationRequestedAt = formatStamp(project?.quotation_requested_at)
  const showCreditsInfo = !!(chargedAt || quotationRequestedAt)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', borderRadius: '16px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          width: '100%', maxWidth: '440px',
          maxHeight: '90vh', overflowY: 'auto',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '1.25rem 1.75rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: TEXT_DARK }}>
            {t('projectInfo.title')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1.5rem', color: TEXT_LIGHT, lineHeight: 1, padding: '0 0.25rem',
            }}
          >×</button>
        </div>

        {/* Credits/quotation status — subtle info pill row, only when the
            project has actually been charged or quoted. Stays hidden on
            fresh projects so the modal isn't noisier than it needs to be. */}
        {showCreditsInfo && (
          <div style={{
            margin: '0.75rem 1.75rem 0',
            padding: '0.55rem 0.75rem',
            background: PRIMARY_BG,
            border: `1px solid ${BORDER_FAINT}`,
            borderRadius: 8,
            display: 'flex', flexDirection: 'column', gap: 4,
            fontSize: '0.78rem', color: TEXT_FAINT,
          }}>
            {chargedAt && (
              <div>
                <strong style={{ color: TEXT_DARK }}>{t('projectInfo.chargedOn')}:</strong>{' '}{chargedAt}
              </div>
            )}
            {quotationRequestedAt && (
              <div>
                <strong style={{ color: TEXT_DARK }}>{t('projectInfo.quotationRequestedOn')}:</strong>{' '}{quotationRequestedAt}
              </div>
            )}
          </div>
        )}

        <ProjectForm
          projectName={project?.name ?? ''}
          clientName={project?.clientName ?? ''}
          location={project?.location ?? ''}
          date={dateValue}
          roofType={roofSpec.type ?? ''}
          distanceBetweenPurlins={roofSpec.distanceBetweenPurlinsCm != null ? String(roofSpec.distanceBetweenPurlinsCm) : ''}
          installationOrientation={roofSpec.installationOrientation ?? ''}
          readOnly
        />
      </div>
    </div>
  )
}
