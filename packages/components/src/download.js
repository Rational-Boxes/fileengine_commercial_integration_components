// SPDX-License-Identifier: MIT
// FileEngine embedding kit — download helper (§7 <fe-download>). (c) 2026 James Hickman.
//
// Import-free. Fetches a file's content WITH the bearer (an <a download> can't carry
// Authorization), returning the blob + a filename parsed from Content-Disposition. The
// element turns this into a browser save. fetch is injectable, so this is unit-testable.

/** Parse a filename from a Content-Disposition header (RFC 6266; filename or filename*). */
export function parseFilename(contentDisposition) {
  if (!contentDisposition) return "";
  const star = /filename\*\s*=\s*(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  if (star) { try { return decodeURIComponent(star[1]); } catch { return star[1]; } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
  return plain ? plain[1] : "";
}

/**
 * @param {{base?: string, tenant?: string, getToken?: Function}} provider
 * @param {string} uid  file uid
 * @param {{fetchImpl?: Function}} [opts]
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function fetchContent(provider, uid, opts = {}) {
  const f = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  const base = (provider && provider.base) || "";
  const headers = {};
  const token = provider && provider.getToken && provider.getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const tenant = provider && provider.tenant;
  if (tenant) headers["X-Tenant"] = tenant;

  const r = await f(`${base}/v1/files/${encodeURIComponent(uid)}/content`, { headers });
  if (!r.ok) throw new Error("download failed: " + r.status);
  const blob = await r.blob();
  const cd = r.headers && r.headers.get && r.headers.get("Content-Disposition");
  return { blob, filename: parseFilename(cd) || uid };
}
