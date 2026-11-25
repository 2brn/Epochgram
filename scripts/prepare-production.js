const fs = require("fs");
const path = require("path");

// Packaging is local only. Vault deployment must copy the three plugin files explicitly.
if (process.argv.length > 2) throw new Error("Packaging does not accept vault deployment options.");
const repoRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error("Invalid plugin id");
const productionDir = path.join(repoRoot, "production");
const packageDir = path.join(productionDir, manifest.id);
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const readmeImages = [...new Set(readme.match(/images\/[^"')\s>]+/g) || [])].sort();
if (readmeImages.some(rel => rel.includes("..") || rel.includes("\\"))) throw new Error("Invalid README image path");
const packagedFiles = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE", ...readmeImages];
for (const rel of packagedFiles) {
	if (!fs.statSync(path.join(repoRoot, rel)).isFile()) throw new Error(`Missing package file: ${rel}`);
}
for (const dir of [productionDir, packageDir]) {
	if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing symlink: ${dir}`);
}
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });
for (const rel of packagedFiles) {
	const destination = path.join(packageDir, rel);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(path.join(repoRoot, rel), destination);
}
process.stdout.write(JSON.stringify({ packageDir: path.relative(repoRoot, packageDir), packagedFiles }, null, 2) + "\n");
