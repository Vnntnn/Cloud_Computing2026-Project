import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventThumbnail } from '../src/components/event-thumbnail.tsx'

describe('EventThumbnail', () => {
  it('renders a lazy, accessible catalog image', () => {
    const markup = renderToStaticMarkup(
      <EventThumbnail src="https://uploads.example/cover.webp" title="Cloud Native Bangkok" />,
    )

    expect(markup).toContain('alt="Cover for Cloud Native Bangkok"')
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('object-cover')
  })

  it('renders a titled placeholder when no cover exists', () => {
    const markup = renderToStaticMarkup(<EventThumbnail src={null} title="Kubernetes Workshop" />)

    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="No cover image for Kubernetes Workshop"')
    expect(markup).toContain('Kubernetes Workshop')
  })
})
