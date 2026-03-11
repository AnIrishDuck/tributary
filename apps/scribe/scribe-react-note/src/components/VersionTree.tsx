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

function NodeRow({ node, versionUrl, isFirst, isLast, isForkPoint }: {
  node: TreeNode
  versionUrl: string
  isFirst: boolean
  isLast: boolean
  isForkPoint?: boolean
}) {
  const truncatedUuid = node.version_uuid.slice(0, 8)
  return (
    <div className="flex items-stretch">
      <div className="flex flex-col items-center w-6 flex-shrink-0">
        <div className={`w-0.5 flex-1 ${isFirst ? 'bg-transparent' : 'bg-gray-300'}`} />
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${node.isAuthoritative ? 'bg-blue-500' : 'bg-gray-300'}`} />
        <div className={`w-0.5 flex-1 ${isLast ? 'bg-transparent' : 'bg-gray-300'}`} />
      </div>
      <div className="flex-1 min-w-0 py-2 pl-3">
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
          {isForkPoint && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
              branched
            </span>
          )}
          <span className="text-xs text-gray-500">{formatRelativeTime(node.insert_datetime)}</span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          by {node.inserter}
        </div>
      </div>
    </div>
  )
}

/**
 * Collect the linear spine of a tree (following single children) in
 * reverse chronological order (newest first). Returns the nodes and
 * any fork points encountered.
 */
function collectLinearSpine(node: TreeNode): TreeNode[] {
  const spine: TreeNode[] = []
  let current: TreeNode | null = node
  while (current) {
    spine.push(current)
    if (current.children.length === 1) {
      current = current.children[0]
    } else {
      break
    }
  }
  spine.reverse()
  return spine
}

const VersionTree: React.FC<VersionTreeProps> = ({ node, slugPath, prefix }) => {
  return <VersionSubtree node={node} slugPath={slugPath} prefix={prefix} isTopLevel />
}

function VersionSubtree({ node, slugPath, prefix, isTopLevel }: {
  node: TreeNode
  slugPath: string
  prefix: string
  isTopLevel?: boolean
}) {
  // Collect the linear spine from this node downward
  const spine = collectLinearSpine(node)
  // The last node in spine (oldest, since spine is newest-first) may be a fork point
  const oldest = spine[spine.length - 1]
  const isForkPoint = oldest.children.length > 1

  return (
    <div>
      {/* Render the linear spine (newest first) */}
      {spine.map((n, i) => {
        const versionUrl = `/pk/${prefix}/${slugPath}@${n.version_uuid}`
        const hasFork = n === oldest && isForkPoint
        const isFirst = i === 0 && !!isTopLevel
        const isLast = i === spine.length - 1 && !isForkPoint

        return (
          <NodeRow
            key={n.version_uuid}
            node={n}
            versionUrl={versionUrl}
            isFirst={isFirst}
            isLast={isLast}
            isForkPoint={hasFork}
          />
        )
      })}

      {/* Render branches if the oldest node is a fork point */}
      {isForkPoint && (
        <div className="ml-6">
          {[...oldest.children]
            .sort((a, b) => b.insert_datetime.localeCompare(a.insert_datetime))
            .map((child, branchIndex) => (
              <div key={child.version_uuid} className={`border-l-2 border-gray-300 pl-4 ${branchIndex > 0 ? 'mt-2' : ''}`}>
                <div className="text-xs text-gray-400 font-medium py-1 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm2.03 0a.75.75 0 1 1 0 1.5H5.75v2.5a.75.75 0 0 1-1.5 0V4.75H2.97a.75.75 0 0 1 0-1.5h4.06ZM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-1.5-3v2.25a2.25 2.25 0 1 0 4.5 0V9.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75Z" />
                  </svg>
                  Branch {branchIndex + 1}
                </div>
                <VersionSubtree node={child} slugPath={slugPath} prefix={prefix} />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export default VersionTree
