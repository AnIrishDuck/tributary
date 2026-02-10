import React from 'react';
import { Link, useLocation } from 'react-router';
import { 
  DocumentTextIcon, 
  UserGroupIcon, 
  PlusIcon, 
  ArrowLeftIcon,
  HomeIcon
} from '@heroicons/react/24/outline';

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

  const getNavItems = (): NavItem[] => {
    const currentPath = location.pathname;
    
    if (currentPath === '/') {
      return [
        { name: 'New Stream', href: '/new', icon: PlusIcon, description: 'Create a new encrypted document stream' },
        { name: 'Import Stream', href: '/import', icon: DocumentTextIcon, description: 'Import an existing stream' },
      ];
    }
    
    // Check if we're in a stream context (starts with /pk/)
    if (currentPath.startsWith('/pk/')) {
      return [
        { name: 'Back to Home', href: '/', icon: ArrowLeftIcon, isBack: true },
      ];
    }
    
    return [];
  };

  const navItems = getNavItems();

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center flex-1">
            {showBack && onBack && (
              <button
                onClick={onBack}
                className="mr-3 p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
            )}
            
            <div className="flex items-center">
              {title && (
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate max-w-[200px] sm:max-w-md">
                  {title}
                </h1>
              )}
              
              {!hideNavItems && navItems.length > 0 && (
                <div className="hidden md:flex ml-4 items-center space-x-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={`
                        flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                        ${item.isBack 
                          ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900' 
                          : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }
                      `}
                      title={item.description}
                    >
                      <span className="mr-2">{React.createElement(item.icon, { className: "w-4 h-4" })}</span>
                      {item.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-2">
              <Link 
                to="/"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                title="Home"
              >
                <HomeIcon className="w-5 h-5" />
              </Link>
              
              <a 
                href="https://github.com/block/scribe" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="hidden sm:flex items-center px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors hover:bg-gray-50 rounded-lg"
              >
                Documentation
              </a>
            </div>
          </div>
        </div>
        
        {/* Mobile navigation items */}
        <div className="md:hidden border-t border-gray-100 py-2 space-y-1">
          {!hideNavItems && navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={`
                flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${item.isBack 
                  ? 'text-gray-600 hover:bg-gray-100' 
                  : 'text-gray-700 hover:bg-blue-50'
                }
              `}
            >
              <span className="mr-2">{React.createElement(item.icon, { className: "w-5 h-5" })}</span>
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
