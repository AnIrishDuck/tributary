/**
 * Link Utilities for Scribe
 *
 * Handles link resolution for note slugs (hashtag-style links without protocol)
 * vs. external/absolute links.
 */

/**
 * Determines if a link is an absolute internal link.
 *
 * Links that start with `#` and contain a `/` are "absolute" internal links
 * pointing directly at a route (e.g. `#pk/abc123/note` or `#n/my-lib/note`).
 * They should be resolved to `/#/{path}` without applying the current paradigm.
 */
export const isAbsoluteInternalLink = (link: string): boolean => {
  return link.startsWith('#') && link.includes('/');
};

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
  if (protocolRegex.test(link) || link.startsWith('#/') || link.startsWith('/#')) return false;
  // Absolute internal links (#pk/..., #n/...) are not slug links
  if (isAbsoluteInternalLink(link)) return false;
  return true;
};

/**
 * Determines if a link is already a resolved note URL
 *
 * @param link - The link URL to check
 * @returns true if the link is already a resolved note URL
 */
export const isResolvedBlockUrl = (link: string): boolean => {
  // Check if the link starts with #/ or /# (which indicates it's already resolved)
  return link.startsWith('#/') || link.startsWith('/#');
};

/**
 * Resolves a slug link to a note URL
 *
 * Takes a slug link (like "link-target" or "#some-slug") and resolves it
 * to the proper note URL format using the current route base.
 *
 * @param link - The link to resolve
 * @param streamPrefix - The base64url-encoded library prefix (e.g., "_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0")
 * @param routeBase - Optional route base override (e.g. "/n/my-library"). Defaults to "/pk/{streamPrefix}".
 * @returns The fully resolved URL
 */
export const resolveSlugLink = (link: string, streamPrefix: string, routeBase?: string): string => {
  // Remove leading hash if present for internal links (single # without /)
  const cleanLink = link.startsWith('#') && !link.includes('/') ? link.slice(1) : link;

  // Absolute internal links → resolve to /#/{path}
  if (isAbsoluteInternalLink(link)) {
    return `/#/${link.slice(1)}`;
  }

  // If it's already an absolute link, return as-is
  if (!isSlugLink(link)) {
    return link;
  }

  const base = routeBase || `/pk/${streamPrefix}`;
  // Build the note URL: /#/{routeBase}/{slug}
  // Note: We use #/ to maintain client-side routing
  return `/#${base}/${cleanLink}`;
};

/**
 * Resolves a link relative to a note's base URL
 *
 * This function handles both relative links (which should be treated as slugs)
 * and absolute links (which should be preserved).
 *
 * @param link - The link to resolve
 * @param streamPrefix - The base64url-encoded library prefix
 * @param currentSlug - The current note's slug (for relative link resolution)
 * @param routeBase - Optional route base override (e.g. "/n/my-library"). Defaults to "/pk/{streamPrefix}".
 * @returns The fully resolved URL
 */
export const resolveLink = (link: string, streamPrefix: string, currentSlug?: string, routeBase?: string): string => {
  // Absolute internal links (#.../...) → resolve directly
  if (isAbsoluteInternalLink(link)) {
    return resolveSlugLink(link, streamPrefix, routeBase);
  }

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
    return resolveSlugLink(resolvedSlug, streamPrefix, routeBase);
  }

  // Simple slug link (no . or ..)
  return resolveSlugLink(link, streamPrefix, routeBase);
};

/**
 * Extracts the library prefix from a full note URL
 *
 * @param url - The full note URL (e.g., "#/pk/_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0/slug")
 * @returns The library prefix (base64url-encoded public key) or null if not found
 */
export const extractStreamPrefixFromUrl = (url: string): string | null => {
  const regex = /#\/pk\/([^\/]+)\//;
  const match = url.match(regex);
  return match ? match[1] : null;
};

/**
 * Extracts the slug from a full note URL
 *
 * @param url - The full note URL
 * @returns The slug or null if not found
 */
export const extractSlugFromUrl = (url: string): string | null => {
  const regex = /#\/pk\/[^\/]+\/([^\/?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
};
