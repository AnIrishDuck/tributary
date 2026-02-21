import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { 
  DocumentTextIcon, 
  UserGroupIcon, 
  PlusIcon, 
  ArrowLeftIcon,
  HomeIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { useSyncStatus } from '../../context/syncStatusContext';

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  description?: string;
  isBack?: boolean;
}

interface NavbarProps {
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
  hideNavItems?: boolean;
}

const Navbar: React.FC<NavbarProps> = ({ 
  showBack = false, 
  onBack, 
  title,
  hideNavItems = false
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { syncStatus, globalSyncStatus } = useSyncStatus();

  // Extract prefix from current path if in library context
  const getPrefix = (): string | null => {
    const match = location.pathname.match(/^\/pk\/([^/]+)/);
    return match ? match[1] : null;
  };

  const prefix = getPrefix();

  // Use per-library status when viewing a library, fall back to global
  const libraryStatus = prefix ? syncStatus[prefix] : undefined;
  const activeStatus = libraryStatus || globalSyncStatus;

  // Determine navbar background color based on sync status
  const getNavbarBgClass = () => {
    if (activeStatus.hasError) {
      return 'bg-red-50 border-red-200';
    }
    if (!activeStatus.synced && activeStatus.isSyncing) {
      return 'bg-yellow-50 border-yellow-200';
    }
    return 'bg-white border-gray-200';
  };

  const getNavItems = (): NavItem[] => {
    const currentPath = location.pathname;
    
    if (currentPath === '/') {
      return [
        { name: 'New Library', href: '/new', icon: PlusIcon, description: 'Create a new encrypted note library' },
        { name: 'Import Library', href: '/import', icon: DocumentTextIcon, description: 'Import an existing library' },
      ];
    }
    
    // Check if we're in a library context (starts with /pk/)
    if (currentPath.startsWith('/pk/')) {
      return [
        { name: 'Back to Home', href: '/', icon: ArrowLeftIcon, isBack: true },
      ];
    }
    
    return [];
  };

  const navItems = getNavItems();

  const showSyncProgress = !activeStatus.synced && activeStatus.finalIndex > 0

  return (
    <nav className={`${getNavbarBgClass()} border-b sticky top-0 z-50 shadow-sm transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4">
        <div className="flex justify-between h-10">
          <div className="flex items-center flex-1 gap-2">
            {showBack && onBack && (
              <button
                onClick={onBack}
                className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
              >
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center">
              {title && (
                <h1 className="text-base font-bold text-gray-900 truncate max-w-[150px] sm:max-w-md">
                  {title}
                </h1>
              )}
              {showSyncProgress && (
                <span className="ml-2 text-xs font-medium text-yellow-700">
                  Syncing {activeStatus.currentIndex}/{activeStatus.finalIndex}
                </span>
              )}
              {activeStatus.hasError && (
                <span className="ml-2 text-xs font-medium text-red-700">
                  Sync error
                </span>
              )}
              
              {!hideNavItems && navItems.length > 0 && (
                <div className="hidden md:flex items-center space-x-0.5">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={`
                        flex items-center px-2 py-1 rounded text-xs font-medium transition-colors
                        ${item.isBack 
                          ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900' 
                          : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }
                      `}
                      title={item.description}
                    >
                      <span className="mr-1.5">{React.createElement(item.icon, { className: "w-3.5 h-3.5" })}</span>
                      <span className="hidden sm:inline">{item.name}</span>
                      <span className="sm:hidden">{item.name.replace(/^(New|Back|Import)/, '').trim()}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-1">
            <div className="flex items-center space-x-1">
              {prefix && (
                <button
                  onClick={() => navigate(`/pk/${prefix}/search`)}
                  className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
                  title="Search notes"
                  aria-label="Search notes"
                >
                  <MagnifyingGlassIcon className="w-4 h-4" />
                </button>
              )}
              
              <Link 
                to="/"
                className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
                title="Home"
              >
                <HomeIcon className="w-4 h-4" />
              </Link>
              
              <a 
                href="https://github.com/block/scribe" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="hidden sm:flex items-center px-2 py-1 text-xs font-medium text-gray-600 hover:text-blue-600 transition-colors hover:bg-gray-50 rounded"
              >
                Docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
