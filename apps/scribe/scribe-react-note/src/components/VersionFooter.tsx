import React from 'react'
import { Link } from 'react-router'

export interface VersionFooterProps {
  versionUuid: string
  position: number
  total: number
  slugPath?: string
  prefix?: string
}

const VersionFooter: React.FC<VersionFooterProps> = ({ versionUuid, position, total, slugPath, prefix }) => {
  const truncatedUuid = versionUuid.slice(0, 8)
  const historyUrl = slugPath && prefix ? `/pk/${prefix}/${slugPath}&history` : null

  const content = (
    <>
      version:{' '}
      <span title={versionUuid}>{truncatedUuid}</span>
      {' '}({position}/{total})
    </>
  )

  if (historyUrl) {
    return (
      <Link to={historyUrl} className="text-xs text-gray-400 hover:text-blue-500 hover:underline">
        {content}
      </Link>
    )
  }

  return (
    <span className="text-xs text-gray-400">
      {content}
    </span>
  )
}

export default VersionFooter
