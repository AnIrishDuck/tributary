import React from 'react'

export interface VersionFooterProps {
  versionUuid: string
  position: number
  total: number
}

const VersionFooter: React.FC<VersionFooterProps> = ({ versionUuid, position, total }) => {
  const truncatedUuid = versionUuid.slice(0, 8)

  return (
    <span className="text-xs text-gray-400">
      version:{' '}
      <span title={versionUuid}>{truncatedUuid}</span>
      {' '}({position}/{total})
    </span>
  )
}

export default VersionFooter
