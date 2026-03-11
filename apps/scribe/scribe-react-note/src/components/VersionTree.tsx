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

  // Sort children by insert_datetime ascending (oldest first in tree)
  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => a.insert_datetime.localeCompare(b.insert_datetime))
  }

  const roots = childrenOf.get(null) || []
  roots.sort((a, b) => a.insert_datetime.localeCompare(b.insert_datetime))
  return roots
}

const VersionTree: React.FC<VersionTreeProps> = ({ node, slugPath, prefix, depth = 0 }) => {
  const truncatedUuid = node.version_uuid.slice(0, 8)
  const versionUrl = `/pk/${prefix}/${slugPath}@${node.version_uuid}`
  const isBranch = node.children.length > 1

  return (
    <div className={depth > 0 ? 'ml-6 border-l-2 border-gray-200 pl-4' : ''}>
      <div className="flex items-start gap-3 py-2">
        <div className={`mt-1.5 w-3 h-3 rounded-full flex-shrink-0 ${node.isAuthoritative ? 'bg-blue-500' : 'bg-gray-300'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={versionUrl}
              className="text-sm font-mono text-blue-600 hover:text-blue-800 hover:underline"
              title={node.version_uuid}
            >
              {truncatedUuid}
            </Link>
            {node.isAuthoritative && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                current
              </span>
            )}
            <span className="text-xs text-gray-500">{formatRelativeTime(node.insert_datetime)}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            by {node.inserter}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <VersionTree
          key={child.version_uuid}
          node={child}
          slugPath={slugPath}
          prefix={prefix}
          depth={isBranch ? depth + 1 : depth}
        />
      ))}
    </div>
  )
}

export default VersionTree
