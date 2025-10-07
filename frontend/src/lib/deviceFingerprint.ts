/**
 * Device Fingerprint Generator
 * 
 * Generates a unique hardware fingerprint for the current device.
 * This fingerprint is stable across different browsers on the same device.
 * 
 * Components used:
 * - Screen resolution and color depth
 * - CPU cores
 * - Device memory
 * - GPU vendor and renderer
 * - Canvas fingerprint
 * - Platform and timezone
 */

/**
 * Get GPU information using WebGL
 */
function getGPUInfo(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) {
      return 'no-webgl';
    }
    
    const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    
    if (debugInfo) {
      const vendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return `${vendor}|${renderer}`;
    }
    
    return 'webgl-limited';
  } catch (err) {
    return 'webgl-error';
  }
}

/**
 * Generate a canvas-based fingerprint
 * Different devices render canvas elements slightly differently
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return 'no-canvas';
    }
    
    // Draw text with specific styling
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Device Fingerprint 🔒', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('متابعة', 4, 35);
    
    // Get data URL and hash it
    const dataURL = canvas.toDataURL();
    
    // Simple hash of the last 100 characters (contains the actual pixel data)
    const relevant = dataURL.slice(-100);
    let hash = 0;
    for (let i = 0; i < relevant.length; i++) {
      const char = relevant.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(36);
  } catch (err) {
    return 'canvas-error';
  }
}

/**
 * Hash a string using SHA-256
 */
async function hashSHA256(text: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    // Fallback to simple hash if crypto.subtle is not available
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }
}

/**
 * Generate device fingerprint
 * 
 * @returns A unique hash representing the physical device
 */
export async function getDeviceFingerprint(): Promise<string> {
  try {
    const components: string[] = [];
    
    // 1. Screen information (stable for a device)
    const screenInfo = `${screen.width}x${screen.height}x${screen.colorDepth}`;
    components.push(`screen:${screenInfo}`);
    
    // 2. CPU cores (stable)
    const cpuCores = navigator.hardwareConcurrency || 0;
    components.push(`cpu:${cpuCores}`);
    
    // 3. Device memory (if available)
    const deviceMemory = (navigator as any).deviceMemory || 'unknown';
    components.push(`mem:${deviceMemory}`);
    
    // 4. GPU information (very stable and unique)
    const gpuInfo = getGPUInfo();
    components.push(`gpu:${gpuInfo}`);
    
    // 5. Canvas fingerprint (unique per device)
    const canvasFP = getCanvasFingerprint();
    components.push(`canvas:${canvasFP}`);
    
    // 6. Platform (OS)
    const platform = navigator.platform || 'unknown';
    components.push(`platform:${platform}`);
    
    // 7. Timezone (stable per location)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    components.push(`tz:${timezone}`);
    
    // 8. Language (usually stable)
    const language = navigator.language;
    components.push(`lang:${language}`);
    
    // Combine all components
    const combined = components.join('|');
    
    // Hash the combined fingerprint
    const fingerprint = await hashSHA256(combined);
    
    // Log for debugging (remove in production if needed)
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Device Fingerprint Components:', {
        screenInfo,
        cpuCores,
        deviceMemory,
        gpuInfo: gpuInfo.slice(0, 50) + '...',
        canvasFP,
        platform,
        timezone,
        language,
        fingerprint: fingerprint.slice(0, 16) + '...',
      });
    }
    
    return fingerprint;
  } catch (err) {
    console.error('Failed to generate device fingerprint:', err);
    
    // Fallback fingerprint based on basic info
    const fallback = `fallback-${screen.width}x${screen.height}-${navigator.hardwareConcurrency || 0}-${Date.now()}`;
    return hashSHA256(fallback);
  }
}

/**
 * Get or create a stored device ID (for additional tracking)
 * This complements the fingerprint for better accuracy
 */
export function getStoredDeviceId(): string | null {
  const KEY = 'web_device_id_v1';
  
  try {
    let deviceId = localStorage.getItem(KEY);
    
    if (!deviceId) {
      // Generate new UUID
      deviceId = crypto.randomUUID();
      localStorage.setItem(KEY, deviceId);
    }
    
    return deviceId;
  } catch (err) {
    // localStorage might be blocked (incognito mode, etc.)
    return null;
  }
}
