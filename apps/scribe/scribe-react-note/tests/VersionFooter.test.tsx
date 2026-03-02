import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VersionFooter from '../src/components/VersionFooter'

describe('VersionFooter', () => {
  it('renders truncated UUID and position string', () => {
    render(
      <VersionFooter
        versionUuid="a1b2c3d4-e5f6-7890-abcd-1234567890ef"
        position={3}
        total={7}
      />
    )

    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument()
    expect(screen.getByText(/\(3\/7\)/)).toBeInTheDocument()
  })

  it('shows full UUID in title attribute on hover', () => {
    const fullUuid = 'a1b2c3d4-e5f6-7890-abcd-1234567890ef'

    render(
      <VersionFooter
        versionUuid={fullUuid}
        position={1}
        total={1}
      />
    )

    const truncatedSpan = screen.getByText('a1b2c3d4')
    expect(truncatedSpan).toHaveAttribute('title', fullUuid)
  })
})
