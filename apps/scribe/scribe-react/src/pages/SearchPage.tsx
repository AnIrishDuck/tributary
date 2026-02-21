import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { searchNotes, SearchResult } from 'scribe-data'
import { SearchBar } from '../components/SearchBar'
import { SearchResultCard } from '../components/SearchResultCard'
import { MagnifyingGlassIcon, DocumentTextIcon, PlusIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'

const RESULTS_PER_PAGE = 20

const SearchPage: React.FC = () => {
  const { prefix } = useParams<{ prefix: string }>()
  const navigate = useNavigate()
  const { client } = useTributary()
  const { setFocusedLibrary } = useSyncStatus()
  const [searchParams, setSearchParams] = useSearchParams()

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])
  
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  
  // Get query from URL
  const query = searchParams.get('q') || ''
  
  // Perform search
  const performSearch = useCallback(async (searchQuery: string, pageNum: number = 0) => {
    if (!client || !prefix) {
      return
    }
    
    // Empty query = no results
    if (!searchQuery.trim()) {
      setResults([])
      setHasMore(false)
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const localDb = await client.getLocal('scribe', prefix)
      if (!localDb) {
        throw new Error('Could not get local database')
      }
      
      const searchResults = await searchNotes(localDb, searchQuery, {
        limit: RESULTS_PER_PAGE,
        offset: pageNum * RESULTS_PER_PAGE
      })
      
      setResults(searchResults)
      // If we got a full page, there might be more
      setHasMore(searchResults.length === RESULTS_PER_PAGE)
    } catch (err) {
      console.error('Error searching:', err)
      setError(`Search failed: ${(err as Error).message}`)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [client, prefix])
  
  // Search when query or page changes
  useEffect(() => {
    performSearch(query, page)
  }, [query, page, performSearch])
  
  // Handle search input change
  const handleSearch = useCallback((newQuery: string) => {
    setPage(0) // Reset to first page
    setSearchParams(newQuery ? { q: newQuery } : {}, { replace: true })
  }, [setSearchParams])
  
  // Handle pagination
  const handleNextPage = () => {
    setPage(prev => prev + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  
  const handlePrevPage = () => {
    setPage(prev => Math.max(0, prev - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  
  const handleNewNote = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/new`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => navigate(`/pk/${prefix}/`)}
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1" />
              Notes
            </button>
            <h1 className="text-xl font-bold text-gray-900">Search Notes</h1>
          </div>
          
          <SearchBar
            onSearch={handleSearch}
            initialValue={query}
            loading={loading}
            autoFocus={!query}
          />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Results count */}
        {query && !loading && results.length > 0 && (
          <div className="mb-4 text-sm text-gray-600">
            {results.length} result{results.length !== 1 ? 's' : ''} 
            {page > 0 && ` (page ${page + 1})`}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center mb-6">
            <p className="text-red-800 font-medium text-sm">{error}</p>
          </div>
        )}

        {/* Empty state - no query */}
        {!query && (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <MagnifyingGlassIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Search Your Notes</h3>
            <p className="text-gray-600 mb-6 text-sm">
              Enter keywords to find notes across your collection
            </p>
            <div className="text-xs text-gray-500">
              <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-200">⌘K</kbd>
              {' '}or{' '}
              <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-200">Ctrl+K</kbd>
              {' '}to focus search
            </div>
          </div>
        )}

        {/* No results state */}
        {query && !loading && results.length === 0 && !error && (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <DocumentTextIcon className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Results Found</h3>
            <p className="text-gray-600 mb-6 text-sm">
              Try different keywords or create a new note
            </p>
            <button
              onClick={handleNewNote}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
            >
              <PlusIcon className="w-4 h-4 mr-1.5" />
              Create New Note
            </button>
          </div>
        )}

        {/* Results list */}
        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((result) => (
              <SearchResultCard
                key={result.block_uuid}
                result={result}
                prefix={prefix || ''}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {results.length > 0 && (
          <div className="mt-8 flex items-center justify-between border-t border-gray-200 pt-4">
            <button
              onClick={handlePrevPage}
              disabled={page === 0}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              ← Previous
            </button>
            
            <div className="text-sm text-gray-600">
              Page {page + 1}
            </div>
            
            <button
              onClick={handleNextPage}
              disabled={!hasMore}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPage
