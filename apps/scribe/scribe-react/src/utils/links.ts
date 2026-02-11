/**
 * Link Utilities for Scribe
 * 
 * Handles link resolution for block slugs (hashtag-style links without protocol)
 * vs. external/absolute links.
 */

/**
 * Determines if a link is a slug link (internal, no protocol)
 * vs. an absolute/external link (has protocol like http://, https://, mailto:, etc.)
 * 
 * @param link - The link URL to check
 * @returns true if the link is a slug link (no protocol), false if it has a protocol
 */
export const isSlugLink = (link: string): boolean => {
  // Check if the link has a protocol (http://, https://, mailto:, tel:, etc.)
  // or if it's a protocol-relative URL (//example.com)
  // Also consider links that already start with #/ or /# as resolved
  const protocolRegex = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//;
  return !protocolRegex.test(link) && !link.startsWith('#/') && !link.startsWith('/#');
};

/**
 * Determines if a link is already a resolved block URL
 * 
 * @param link - The link URL to check
 * @returns true if the link is already a resolved block URL
 */
export const isResolvedBlockUrl = (link: string): boolean => {
  // Check if the link starts with #/ or /# (which indicates it's already resolved)
  return link.startsWith('#/') || link.startsWith('/#');
};

/**
 * Resolves a slug link to a block URL
 * 
 * Takes a slug link (like "link-target" or "#some-slug") and resolves it
 * to the proper block URL format using the current stream prefix.
 * 
 * @param link - The link to resolve
 * @param streamPrefix - The base64url-encoded stream prefix (e.g., "_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0")
 * @returns The fully resolved URL
 */
export const resolveSlugLink = (link: string, streamPrefix: string): string => {
  // Remove leading hash if present for internal links
  const cleanLink = link.startsWith('#') ? link.slice(1) : link;
  
  // If it's already an absolute link, return as-is
  if (!isSlugLink(link)) {
    return link;
  }
  
  // Build the block URL: /#/pk/{streamPrefix}/{slug}
  // Note: We use #/ to maintain client-side routing
  return `/#/pk/${streamPrefix}/${cleanLink}`;
};

/**
 * Resolves a link relative to a document's base URL
 * 
 * This function handles both relative links (which should be treated as slugs)
 * and absolute links (which should be preserved).
 * 
 * @param link - The link to resolve
 * @param streamPrefix - The base64url-encoded stream prefix
 * @param currentSlug - The current document's slug (for relative link resolution)
 * @returns The fully resolved URL
 */
export const resolveLink = (link: string, streamPrefix: string, currentSlug?: string): string => {
  // Absolute links with protocol - return as-is
  if (!isSlugLink(link)) {
    return link;
  }
  
  // Relative link (no protocol) - treat as slug reference
  // Handle links like "./other" or "../other" by resolving relative to current slug
  if (link.startsWith('.')) {
    if (!currentSlug) {
      // If we don't have current slug, just use as-is (will fail gracefully)
      return link;
    }
    
    // Resolve relative path
    const currentPath = currentSlug.split('/');
    const linkPath = link.split('/');
    
    // Determine the base path based on first segment
    let basePath: string[] = [];
    
    if (linkPath[0] === '.') {
      // . means replace current slug with what follows
      basePath = currentPath.slice(0, -1); // Remove last element (current slug)
      linkPath.shift(); // Remove the '.' from linkPath
    } else if (linkPath[0] === '..') {
      // .. means go up one level
      basePath = currentPath.slice(0, -1); // Remove last element
      linkPath.shift(); // Remove the '..' from linkPath
    }
    
    // Now append the remaining segments from linkPath
    for (const segment of linkPath) {
      if (segment === '.') {
        continue;
      } else if (segment === '..') {
        basePath.pop();
      } else {
        basePath.push(segment);
      }
    }
    
    const resolvedSlug = basePath.filter(s => s).join('/');
    return resolveSlugLink(resolvedSlug, streamPrefix);
  }
  
  // Simple slug link (no . or ..)
  return resolveSlugLink(link, streamPrefix);
};

/**
 * Extracts the stream prefix from a full block URL
 * 
 * @param url - The full block URL (e.g., "#/pk/_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0/slug")
 * @returns The stream prefix (base64url-encoded public key) or null if not found
 */
export const extractStreamPrefixFromUrl = (url: string): string | null => {
  const regex = /#\/pk\/([^\/]+)\//;
  const match = url.match(regex);
  return match ? match[1] : null;
};

/**
 * Extracts the slug from a full block URL
 * 
 * @param url - The full block URL
 * @returns The slug or null if not found
 */
export const extractSlugFromUrl = (url: string): string | null => {
  const regex = /#\/pk\/[^\/]+\/([^\/?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
};
