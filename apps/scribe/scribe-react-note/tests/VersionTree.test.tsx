import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import VersionTree, { buildTree, TreeNode } from '../src/components/VersionTree'
import { VersionTreeNode } from 'scribe-data'

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('buildTree', () => {
  it('builds a linear chain from flat nodes', () => {
    const nodes: VersionTreeNode[] = [
      { version_uuid: 'v3', prior_version_uuid: 'v2', insert_datetime: '2024-01-03T00:00:00Z', inserter: 'alice', isAuthoritative: true },
      { version_uuid: 'v2', prior_version_uuid: 'v1', insert_datetime: '2024-01-02T00:00:00Z', inserter: 'alice', isAuthoritative: false },
      { version_uuid: 'v1', prior_version_uuid: null, insert_datetime: '2024-01-01T00:00:00Z', inserter: 'alice', isAuthoritative: false },
    ]
    const roots = buildTree(nodes)
    expect(roots).toHaveLength(1)
    expect(roots[0].version_uuid).toBe('v1')
    expect(roots[0].children).toHaveLength(1)
    expect(roots[0].children[0].version_uuid).toBe('v2')
    expect(roots[0].children[0].children).toHaveLength(1)
    expect(roots[0].children[0].children[0].version_uuid).toBe('v3')
  })

  it('builds a branching tree', () => {
    const nodes: VersionTreeNode[] = [
      { version_uuid: 'v1', prior_version_uuid: null, insert_datetime: '2024-01-01T00:00:00Z', inserter: 'alice', isAuthoritative: false },
      { version_uuid: 'v2a', prior_version_uuid: 'v1', insert_datetime: '2024-01-02T00:00:00Z', inserter: 'alice', isAuthoritative: false },
      { version_uuid: 'v2b', prior_version_uuid: 'v1', insert_datetime: '2024-01-02T01:00:00Z', inserter: 'bob', isAuthoritative: true },
    ]
    const roots = buildTree(nodes)
    expect(roots).toHaveLength(1)
    expect(roots[0].version_uuid).toBe('v1')
    expect(roots[0].children).toHaveLength(2)
    expect(roots[0].children[0].version_uuid).toBe('v2a')
    expect(roots[0].children[1].version_uuid).toBe('v2b')
  })
})

describe('VersionTree', () => {
  it('renders a single node', () => {
    const node: TreeNode = {
      version_uuid: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
      prior_version_uuid: null,
      insert_datetime: '2024-01-01T00:00:00Z',
      inserter: 'alice',
      isAuthoritative: true,
      children: [],
    }

    renderWithRouter(
      <VersionTree node={node} slugPath="cooking/pasta" prefix="test-prefix" />
    )

    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
    expect(screen.getByText(/alice/)).toBeInTheDocument()
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it('renders a linear chain of 3 nodes', () => {
    const leaf: TreeNode = {
      version_uuid: 'cccccccc-0000-0000-0000-000000000000',
      prior_version_uuid: 'bbbbbbbb-0000-0000-0000-000000000000',
      insert_datetime: '2024-01-03T00:00:00Z',
      inserter: 'charlie',
      isAuthoritative: true,
      children: [],
    }
    const middle: TreeNode = {
      version_uuid: 'bbbbbbbb-0000-0000-0000-000000000000',
      prior_version_uuid: 'aaaaaaaa-0000-0000-0000-000000000000',
      insert_datetime: '2024-01-02T00:00:00Z',
      inserter: 'bob',
      isAuthoritative: false,
      children: [leaf],
    }
    const root: TreeNode = {
      version_uuid: 'aaaaaaaa-0000-0000-0000-000000000000',
      prior_version_uuid: null,
      insert_datetime: '2024-01-01T00:00:00Z',
      inserter: 'alice',
      isAuthoritative: false,
      children: [middle],
    }

    renderWithRouter(
      <VersionTree node={root} slugPath="cooking/pasta" prefix="test-prefix" />
    )

    expect(screen.getByText('aaaaaaaa')).toBeInTheDocument()
    expect(screen.getByText('bbbbbbbb')).toBeInTheDocument()
    expect(screen.getByText('cccccccc')).toBeInTheDocument()
  })

  it('renders a branch with two children', () => {
    const child1: TreeNode = {
      version_uuid: 'child1111-0000-0000-0000-000000000000',
      prior_version_uuid: 'rootuuid-0000-0000-0000-000000000000',
      insert_datetime: '2024-01-02T00:00:00Z',
      inserter: 'bob',
      isAuthoritative: false,
      children: [],
    }
    const child2: TreeNode = {
      version_uuid: 'child2222-0000-0000-0000-000000000000',
      prior_version_uuid: 'rootuuid-0000-0000-0000-000000000000',
      insert_datetime: '2024-01-03T00:00:00Z',
      inserter: 'charlie',
      isAuthoritative: true,
      children: [],
    }
    const root: TreeNode = {
      version_uuid: 'rootuuid-0000-0000-0000-000000000000',
      prior_version_uuid: null,
      insert_datetime: '2024-01-01T00:00:00Z',
      inserter: 'alice',
      isAuthoritative: false,
      children: [child1, child2],
    }

    renderWithRouter(
      <VersionTree node={root} slugPath="cooking/pasta" prefix="test-prefix" />
    )

    expect(screen.getByText('rootuuid')).toBeInTheDocument()
    expect(screen.getByText('child111')).toBeInTheDocument()
    expect(screen.getByText('child222')).toBeInTheDocument()
  })

  it('links contain correct @version_uuid suffix', () => {
    const node: TreeNode = {
      version_uuid: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
      prior_version_uuid: null,
      insert_datetime: '2024-01-01T00:00:00Z',
      inserter: 'alice',
      isAuthoritative: false,
      children: [],
    }

    renderWithRouter(
      <VersionTree node={node} slugPath="cooking/pasta" prefix="test-prefix" />
    )

    const link = screen.getByText('a1b2c3d4').closest('a')
    expect(link).toHaveAttribute('href', '/pk/test-prefix/cooking/pasta@a1b2c3d4-e5f6-7890-abcd-1234567890ef')
  })
})
