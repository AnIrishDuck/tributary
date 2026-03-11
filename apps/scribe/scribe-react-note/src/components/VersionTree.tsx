import React from 'react'
import { Link } from 'react-router'
import { VersionTreeNode } from 'scribe-data'

export interface TreeNode extends VersionTreeNode {
  children: TreeNode[]
}

export interface VersionTreeProps {
  node: TreeNode
  slugPath: string
  prefix: string
  depth?: number
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 30) {
    return date.toLocaleDateString()
  }
  if (diffDays > 0) return `${diffDays}d ago`
  if (diffHours > 0) return `${diffHours}h ago`
  if (diffMinutes > 0) return `${diffMinutes}m ago`
  return 'just now'
}

/**
 * Build a tree structure from a flat array of VersionTreeNode.
 * Nodes are linked via prior_version_uuid.
 */
export function buildTree(nodes: VersionTreeNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  const childrenOf = new Map<string | null, TreeNode[]>()

  for (const n of nodes) {
    const treeNode: TreeNode = { ...n, children: [] }
    nodeMap.set(n.version_uuid, treeNode)
  }

  for (const [, treeNode] of nodeMap) {
    const parentId = treeNode.prior_version_uuid
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(treeNode)
    } else {
      const roots = childrenOf.get(null) || []
      roots.push(treeNode)
      childrenOf.set(null, roots)
    }
  }

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => a.insert_datetime.localeCompare(b.insert_datetime))
  }

  const roots = childrenOf.get(null) || []
  roots.sort((a, b) => a.insert_datetime.localeCompare(b.insert_datetime))
  return roots
}

interface FlatEntry {
  node: TreeNode
  depth: number
}

/**
 * Flatten a tree into a list ordered newest-first.
 * Linear chains stay at the same depth; branches increase depth.
 */
function flattenReverse(node: TreeNode, depth: number): FlatEntry[] {
  const entries: FlatEntry[] = []
  if (node.children.length <= 1) {
    // Linear: recurse into the single child (if any), then append self
    if (node.children.length === 1) {
      entries.push(...flattenReverse(node.children[0], depth))
    }
    entries.push({ node, depth })
  } else {
    // Branch: each child gets its own indented section, newest branch first
    const sortedChildren = [...node.children].sort(
      (a, b) => b.insert_datetime.localeCompare(a.insert_datetime)
    )
    for (const child of sortedChildren) {
      entries.push(...flattenReverse(child, depth + 1))
    }
    entries.push({ node, depth })
  }
  return entries
}

const VersionTree: React.FC<VersionTreeProps> = ({ node, slugPath, prefix }) => {
  const entries = flattenReverse(node, 0)

  return (
    <div>
      {entries.map((entry, index) => {
        const { node: n, depth } = entry
        const truncatedUuid = n.version_uuid.slice(0, 8)
        const versionUrl = `/pk/${prefix}/${slugPath}@${n.version_uuid}`
        const isLast = index === entries.length - 1
        // Check if next entry is at a different depth (branch boundary)
        const nextEntry = entries[index + 1]
        const depthChanges = nextEntry && nextEntry.depth !== depth

        return (
          <div key={n.version_uuid} style={{ marginLeft: depth * 24 }}>
            <div className="flex items-stretch">
              {/* Timeline connector */}
              <div className="flex flex-col items-center w-6 flex-shrink-0">
                {/* Line above dot */}
                <div className={`w-0.5 flex-1 ${index === 0 ? 'bg-transparent' : 'bg-gray-300'}`} />
                {/* Dot */}
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${n.isAuthoritative ? 'bg-blue-500' : 'bg-gray-300'}`} />
                {/* Line below dot */}
                <div className={`w-0.5 flex-1 ${isLast || depthChanges ? 'bg-transparent' : 'bg-gray-300'}`} />
              </div>
              {/* Version info */}
              <div className="flex-1 min-w-0 py-2 pl-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={versionUrl}
                    className="text-sm font-mono text-blue-600 hover:text-blue-800 hover:underline"
                    title={n.version_uuid}
                  >
                    {truncatedUuid}
                  </Link>
                  {n.isAuthoritative && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      current
                    </span>
                  )}
                  <span className="text-xs text-gray-500">{formatRelativeTime(n.insert_datetime)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  by {n.inserter}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default VersionTree
