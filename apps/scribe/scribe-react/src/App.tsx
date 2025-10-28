import React from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import NewStreamPage from './pages/NewStreamPage'
import { TributaryProvider, createTestTributaryClient } from './context/tributaryContext'

// In a real app, this would be a real client with a real server
// For now we'll set up a test client for testing
const { client: testClient } = createTestTributaryClient()

function App() {
  return (
    <TributaryProvider client={testClient}>
      <Router>
        <div className="min-h-screen bg-gray-50">
          <Routes>
            {/* Creation route - the first user story */}
            <Route path="/new" element={<NewStreamPage />} />
            
            {/* Default route redirects to new stream creation */}
            <Route path="/" element={<NewStreamPage />} />
          </Routes>
        </div>
      </Router>
    </TributaryProvider>
  )
}

export default App
