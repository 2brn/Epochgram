const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

function sha256Hex(value) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableStringifyJson(value) {
	if (value == null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringifyJson(entry)).join(",")}]`;
	if (!isRecord(value)) return "null";
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringifyJson(value[key])}`).join(",")}}`;
}

function computeBuildHashFromPackagedFiles(outDir) {
	const mainJsPath = path.join(outDir, "main.js");
	const manifestPath = path.join(outDir, "manifest.json");
	if (!fs.existsSync(mainJsPath) || !fs.existsSync(manifestPath)) return null;

	const mainJsBuf = fs.readFileSync(mainJsPath);
	const mainJsDigest = sha256Hex(mainJsBuf);

	const manifestRaw = fs.readFileSync(manifestPath, "utf8");
	let manifestObj;
	try {
		manifestObj = JSON.parse(manifestRaw);
	} catch {
		return null;
	}
	if (!isRecord(manifestObj)) return null;

	const manifestForHash = { ...manifestObj };
	delete manifestForHash.epochgramBuildHash;
	const canonicalManifestForHash = stableStringifyJson(manifestForHash);
	const manifestDigest = sha256Hex(Buffer.from(canonicalManifestForHash, "utf8"));
	const buildHash = sha256Hex(`${mainJsDigest}:${manifestDigest}`);
	return buildHash;
}

function writePackagedManifestBuildHash(outDir) {
	try {
		return computeBuildHashFromPackagedFiles(outDir);
	} catch {
		return null;
	}
}

function parseArgs(argv) {
	const args = {
		deployVault: false,
		requireVault: false,
		vaultPluginsDir: null
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--deploy-vault") {
			args.deployVault = true;
			continue;
		}
		if (a === "--require-vault") {
			args.requireVault = true;
			continue;
		}
		if (a === "--vault-plugins" || a === "--plugins-dir") {
			args.vaultPluginsDir = argv[i + 1] || null;
			i++;
			continue;
		}
		if (a.startsWith("--vault-plugins=")) {
			args.vaultPluginsDir = a.slice("--vault-plugins=".length) || null;
			continue;
		}
		if (a.startsWith("--plugins-dir=")) {
			args.vaultPluginsDir = a.slice("--plugins-dir=".length) || null;
			continue;
		}
	}
	return args;
}

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function copyFileIfExists(src, dst) {
	if (!fs.existsSync(src)) return false;
	ensureDir(path.dirname(dst));
	fs.copyFileSync(src, dst);
	return true;
}

function copyDirContents(srcDir, dstDir) {
	if (!fs.existsSync(srcDir)) return 0;
	const stat = fs.statSync(srcDir);
	if (!stat.isDirectory()) return 0;

	ensureDir(dstDir);
	let copied = 0;
	for (const name of fs.readdirSync(srcDir)) {
		const src = path.join(srcDir, name);
		const dst = path.join(dstDir, name);
		const st = fs.statSync(src);
		if (st.isDirectory()) {
			copied += copyDirContents(src, dst);
		} else if (st.isFile()) {
			ensureDir(path.dirname(dst));
			fs.copyFileSync(src, dst);
			copied++;
		}
	}
	return copied;
}

function getReadmeImageFiles(repoRoot) {
	const readmePath = path.join(repoRoot, "README.md");
	if (!fs.existsSync(readmePath)) return [];

	let raw;
	try {
		raw = fs.readFileSync(readmePath, "utf8");
	} catch {
		return [];
	}

	const files = new Set();
	const re = /images\/([^"')\s>]+)/gi;
	for (const match of raw.matchAll(re)) {
		const rel = match[1];
		if (!rel) continue;
		if (rel.includes("..")) continue;
		if (rel.includes("\\")) continue;
		const lower = rel.toLowerCase();
		if (lower.endsWith(".zip")) continue;
		files.add(rel);
	}

	return [...files].sort();
}

function normalizePath(p) {
	if (!p || typeof p !== "string") return null;
	return path.resolve(p);
}

function isDirectory(p) {
	try {
		return fs.existsSync(p) && fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findDefaultVaultPluginsDirs(repoRoot) {
	// Note: These are default vault folder names for local development/testing.
	const expectedRels = [
		path.join("AKUPARA", ".obsidian", "plugins"),
		path.join("nicolevanderhoeven_202204", ".obsidian", "plugins"),
		path.join("Timestripe", ".obsidian", "plugins"),
		path.join("epoch-demo-vault", ".obsidian", "plugins")
	];

	const found = [];
	const seen = new Set();
	const addIfDir = (candidate) => {
		const normalized = normalizePath(candidate);
		if (!normalized) return;
		if (!isDirectory(normalized)) return;
		const key = normalized.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		found.push(normalized);
	};

	// 1) Explicit override
	const envOverride = normalizePath(process.env.EPOCHGRAM_OBSIDIAN_PLUGINS_DIR);
	if (envOverride && isDirectory(envOverride)) return [envOverride];

	// 2) A few common locations (prefer user vault locations)
	const home = os.homedir();
	const bases = [
		path.join(home, "OneDrive", "Documents"),
		path.join(home, "Documents"),
		home,
		path.join(home, "Desktop")
	];
	for (const base of bases) {
		if (!base) continue;
		for (const expectedRel of expectedRels) {
			const candidate = path.join(base, expectedRel);
			addIfDir(candidate);
		}
	}

	// 3) Walk up from repo root (common when vault is sibling of repo folder)
	let cur = repoRoot;
	while (true) {
		for (const expectedRel of expectedRels) {
			const candidate = path.join(cur, expectedRel);
			addIfDir(candidate);
		}
		const parent = path.dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}

	// 4) Drive root (fallback)
	const root = path.parse(repoRoot).root;
	if (root) {
		for (const expectedRel of expectedRels) {
			const candidate = path.join(root, expectedRel);
			addIfDir(candidate);
		}
	}

	return found;
}

function replaceDir(dstDir, options = {}) {
	const preserve = Array.isArray(options.preserve) ? options.preserve : [];
	const preserved = new Map();
	const isSelfDir = (() => {
		try {
			return path.resolve(dstDir) === path.resolve(process.cwd());
		} catch {
			return false;
		}
	})();
	if (fs.existsSync(dstDir) && preserve.length > 0) {
		for (const name of preserve) {
			try {
				const p = path.join(dstDir, name);
				if (fs.existsSync(p) && fs.statSync(p).isFile()) {
					preserved.set(name, fs.readFileSync(p));
				}
			} catch {
				// ignore
			}
		}
	}
	// If deploying into the repo directory itself (common when developing inside a vault plugin dir),
	// never delete the directory. Just overwrite the packaged files in-place.
	if (fs.existsSync(dstDir) && !isSelfDir) {
		fs.rmSync(dstDir, { recursive: true, force: true });
	}
	ensureDir(dstDir);
	if (preserved.size > 0) {
		for (const [name, buf] of preserved.entries()) {
			try {
				fs.writeFileSync(path.join(dstDir, name), buf);
			} catch {
				// ignore
			}
		}
	}
}

function copyPackagedFiles(repoRoot, outDir, options = {}) {
	replaceDir(outDir, options);

	const copiedFiles = [];
	const maybeCopy = (rel) => {
		const ok = copyFileIfExists(path.join(repoRoot, rel), path.join(outDir, rel));
		if (ok) copiedFiles.push(rel);
	};

	// Core plugin files
	maybeCopy("manifest.json");
	maybeCopy("main.js");
	maybeCopy("styles.css");
	maybeCopy("README.md");
	maybeCopy("CHANGELOG");
	maybeCopy("versions.json");
	maybeCopy("LICENSE");

	// README image assets (used by README.md on GitHub and in packaged plugin)
	const readmeImages = getReadmeImageFiles(repoRoot);
	if (readmeImages.length > 0) {
		const imagesSrcDir = path.join(repoRoot, "images");
		const imagesDstDir = path.join(outDir, "images");
		let imagesCopied = 0;
		for (const rel of readmeImages) {
			const ok = copyFileIfExists(path.join(imagesSrcDir, rel), path.join(imagesDstDir, rel));
			if (!ok) continue;
			copiedFiles.push(`images/${rel}`);
			imagesCopied++;
		}
		if (imagesCopied === 0) {
			try {
				fs.rmSync(imagesDstDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	}

	const buildHash = writePackagedManifestBuildHash(outDir);

	return { copiedFiles, buildHash };
}

function touchHotReloadFile(dir) {
	if (!dir) return false;
	try {
		ensureDir(dir);
		const p = path.join(dir, ".hotreload");
		const stamp = new Date().toISOString() + "\n";
		fs.writeFileSync(p, stamp);
		return true;
	} catch {
		return false;
	}
}

function main() {
	const repoRoot = process.cwd();
	const pluginName = "epochgram";
	const args = parseArgs(process.argv.slice(2));
	const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

	const packageDir = path.join(repoRoot, "production", pluginName);
	const packaged = copyPackagedFiles(repoRoot, packageDir);
	const packagedFiles = packaged.copiedFiles;
	const packagedBuildHash = packaged.buildHash;

	let deployedDir = null;
	let deployedFiles = null;
	let deployedDirs = null;
	if (args.deployVault || args.requireVault) {
		const explicitPluginsDir = normalizePath(args.vaultPluginsDir);
		const pluginsDirs = explicitPluginsDir && isDirectory(explicitPluginsDir)
			? [explicitPluginsDir]
			: findDefaultVaultPluginsDirs(repoRoot);

		if (!pluginsDirs || pluginsDirs.length === 0) {
			const msg =
				"Could not find a default Obsidian vault plugins dir (AKUPARA or nicolevanderhoeven_202204). " +
				"Set EPOCHGRAM_OBSIDIAN_PLUGINS_DIR or pass --vault-plugins <path>.";
			if (args.requireVault && !isCI) {
				process.stderr.write(msg + "\n");
				process.exitCode = 1;
			} else {
				process.stderr.write(msg + " (skipping deploy)\n");
			}
		} else {
			deployedDirs = [];
			for (const pluginsDir of pluginsDirs) {
				const dir = path.join(pluginsDir, pluginName);
				const deployed = copyPackagedFiles(repoRoot, dir, { preserve: ["data.json"] });
				const files = deployed.copiedFiles;
				touchHotReloadFile(dir);
				deployedDirs.push({ dir, files, buildHash: deployed.buildHash });
			}
			// Back-compat: keep single-dir fields when only one deploy target exists.
			if (deployedDirs.length === 1) {
				deployedDir = deployedDirs[0].dir;
				deployedFiles = deployedDirs[0].files;
			}
		}
	}
    
	const summary = {
		buildHash: packagedBuildHash,
		packageDir: path.relative(repoRoot, packageDir).replace(/\\/g, "/"),
		packagedFiles,
		deployedDir: deployedDir ? deployedDir : null,
		deployedFiles,
		deployedDirs: deployedDirs
	};

	process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main();
