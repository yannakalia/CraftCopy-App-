import fs from 'fs';
import os from 'os';
import path from 'path';

export interface ServerFontStatus {
  fontDirs: string[];
  configFile: string;
  hasBundledFonts: boolean;
}

let cachedStatus: ServerFontStatus | null = null;

function resolveExistingFontDirectories(): { dirs: string[]; hasBundledFonts: boolean } {
  const bundledCandidates = [
    path.join(process.cwd(), 'public', 'fonts'),
    path.join(process.cwd(), 'dist', 'fonts'),
    path.join(process.cwd(), 'server', 'fonts'),
    path.join(process.cwd(), 'fonts'),
  ];

  if (typeof __dirname === 'string' && __dirname) {
    bundledCandidates.push(
      path.join(__dirname, 'fonts'),
      path.resolve(__dirname, '../public/fonts'),
      path.resolve(__dirname, '../dist/fonts')
    );
  }

  const systemCandidates = ['/usr/share/fonts', '/usr/local/share/fonts'];

  const seen = new Set<string>();
  const validBundled: string[] = [];
  const validSystem: string[] = [];

  for (const dir of bundledCandidates) {
    try {
      const resolved = path.resolve(dir);
      if (seen.has(resolved)) continue;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const entries = fs.readdirSync(resolved);
        if (entries.some((f) => /\.(ttf|otf|woff2?)$/i.test(f))) {
          seen.add(resolved);
          validBundled.push(resolved);
        }
      }
    } catch {
      // Ignore inaccessible candidate directory
    }
  }

  for (const dir of systemCandidates) {
    try {
      const resolved = path.resolve(dir);
      if (seen.has(resolved)) continue;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        seen.add(resolved);
        validSystem.push(resolved);
      }
    } catch {
      // Ignore inaccessible system font directory
    }
  }

  return {
    dirs: [...validBundled, ...validSystem],
    hasBundledFonts: validBundled.length > 0,
  };
}

function escapeXmlPath(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function ensureServerFontsReady(): ServerFontStatus {
  const tmpDir = os.tmpdir();
  const configFile = path.join(tmpDir, 'craftcopy-fontconfig.conf');
  const cacheDir = path.join(tmpDir, 'craftcopy-fc-cache');

  if (cachedStatus && fs.existsSync(cachedStatus.configFile)) {
    return cachedStatus;
  }

  const { dirs, hasBundledFonts } = resolveExistingFontDirectories();

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    // Ignore cache directory creation errors
  }

  const dirTags = dirs.map((d) => `  <dir>${escapeXmlPath(d)}</dir>`).join('\n');

  const fontConfigXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${dirTags}
  <cachedir>${escapeXmlPath(cacheDir)}</cachedir>
  <config>
    <rescan>
      <int>30</int>
    </rescan>
  </config>
  <alias>
    <family>Noto Serif Display</family>
    <prefer>
      <family>Noto Serif</family>
      <family>DejaVu Serif</family>
      <family>Liberation Serif</family>
    </prefer>
  </alias>
  <alias>
    <family>Noto Sans Display</family>
    <prefer>
      <family>Noto Sans</family>
      <family>DejaVu Sans</family>
      <family>Liberation Sans</family>
    </prefer>
  </alias>
  <alias>
    <family>serif</family>
    <prefer>
      <family>Noto Serif</family>
      <family>DejaVu Serif</family>
      <family>Liberation Serif</family>
    </prefer>
  </alias>
  <alias>
    <family>sans-serif</family>
    <prefer>
      <family>Noto Sans</family>
      <family>DejaVu Sans</family>
      <family>Liberation Sans</family>
    </prefer>
  </alias>
</fontconfig>
`;

  if (dirs.length > 0) {
    fs.writeFileSync(configFile, fontConfigXml, 'utf8');
    process.env.FONTCONFIG_FILE = configFile;
    process.env.FONTCONFIG_PATH = tmpDir;
  }

  cachedStatus = {
    fontDirs: dirs,
    configFile,
    hasBundledFonts,
  };
  return cachedStatus;
}

// Initialize immediately on module import BEFORE sharp/libvips/pango loads
ensureServerFontsReady();
