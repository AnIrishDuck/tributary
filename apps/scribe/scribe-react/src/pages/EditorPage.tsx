import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

interface EditorPageProps {
  isNew?: boolean
}

const EditorPage: React.FC<EditorPageProps> = ({ isNew = false }) => {
  const [content, setContent] = useState<string>(isNew ? '# New Document\n\nStart writing here...' : '')
  const navigate = useNavigate()
  const { prefix, slug } = useParams()

  const handleSave = () => {
    // Save logic would go here
    console.log('Saving document:', content)
    // After saving, navigate back to the document view
    if (prefix) {
      navigate(`/${prefix}/`)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{isNew ? 'New Document' : 'Edit Document'}</h1>
        <div className="space-x-2">
          <button 
            onClick={handleSave}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Save
          </button>
          <button 
            onClick={() => prefix ? navigate(`/${prefix}/`) : navigate('/')}
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-96 p-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Write your document in Markdown format..."
        />
      </div>
    </div>
  )
}

export default EditorPage
